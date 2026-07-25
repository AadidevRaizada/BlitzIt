import './load-env';
import { db } from '../src/server/db';
import { evaluateProcessor } from '../src/server/jobs/processors/evaluate';
import { enqueueEvaluation } from '../src/server/jobs';
import { queue } from '../src/server/jobs/pg-queue';

/**
 * Epic E2 end-to-end acceptance (the DoD).
 *
 * Seeds a real tournament/problem/submission, runs the `evaluate` job through
 * the actual processor, and asserts a complete `Evaluation` row with all four
 * dimensions plus audit evidence — proving the whole path, not just the units.
 *
 * Requires DATABASE_URL + migrations. Uses a public deployment target so no
 * LLM/GitHub credentials are needed (those paths degrade gracefully).
 *
 * Run: npm run verify:evaluation:e2e
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

const TAG = `e2e-eval-${Date.now()}`;

async function cleanup() {
  await db.evaluationJob.deleteMany({
    where: { idempotencyKey: { contains: TAG } },
  });
  await db.submission.deleteMany({ where: { repoUrl: { contains: TAG } } });
  await db.hiddenTest.deleteMany({
    where: { problem: { slug: { contains: TAG } } },
  });
  await db.problem.deleteMany({ where: { slug: { contains: TAG } } });
  await db.ranking.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.round.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.tournament.deleteMany({ where: { slug: { contains: TAG } } });
  await db.user.deleteMany({
    where: { email: { contains: '@e2e-eval.test' } },
  });
}

async function main() {
  await cleanup();

  // ---- Seed a realistic submission ----
  const user = await db.user.create({
    data: {
      authUserId: `auth-${TAG}`,
      email: `competitor@e2e-eval.test`,
      username: `competitor-${Date.now()}`,
      displayName: 'E2E Competitor',
      profile: { create: {} },
    },
  });

  const tournament = await db.tournament.create({
    data: { slug: `t-${TAG}`, name: 'E2E Tournament', status: 'SIMULATION' },
  });

  const problem = await db.problem.create({
    data: {
      title: 'E2E REST problem',
      slug: `p-${TAG}`,
      statementMarkdown: 'Build an API.',
      category: 'REST_API',
      evaluationStrategy: 'REST_API',
      contractSpec: { healthPath: '/', performanceSamples: 3 },
      visibility: 'PUBLISHED',
      hiddenTests: {
        create: [
          {
            sequence: 1,
            name: 'root 200',
            kind: 'HTTP_ASSERTION',
            spec: { path: '/', expect: { status: 200 } },
            weight: 3,
            timeoutMs: 10_000,
          },
          {
            sequence: 2,
            name: 'body marker',
            kind: 'HTTP_ASSERTION',
            spec: { path: '/', expect: { bodyContains: ['Example Domain'] } },
            weight: 1,
            timeoutMs: 10_000,
          },
          {
            sequence: 3,
            name: 'deliberately fails',
            kind: 'HTTP_ASSERTION',
            spec: { path: '/', expect: { status: 418 } },
            weight: 1,
            timeoutMs: 10_000,
          },
        ],
      },
    },
  });

  const round = await db.round.create({
    data: {
      tournamentId: tournament.id,
      type: 'SIMULATION',
      stage: 'SIMULATION',
      sequence: 1,
      durationSeconds: 1800,
      problemId: problem.id,
      status: 'OPEN',
    },
  });

  const submission = await db.submission.create({
    data: {
      userId: user.id,
      tournamentId: tournament.id,
      roundId: round.id,
      problemId: problem.id,
      repoUrl: `https://github.com/vercel/next.js?${TAG}`,
      deploymentUrl: 'https://example.com',
      status: 'RECEIVED',
    },
  });

  // ---- Enqueue + verify idempotency ----
  const jobId1 = await enqueueEvaluation(submission.id);
  const jobId2 = await enqueueEvaluation(submission.id);
  check('duplicate enqueue collapses to one job', jobId1 === jobId2);

  const claimed = await queue.claim(1, 'e2e-runner');
  check(
    'evaluation job is claimable',
    claimed.length === 1 && claimed[0]?.name === 'evaluate',
  );

  // ---- Run the real processor ----
  const job = claimed[0]!;
  await evaluateProcessor(job);

  const evaluation = await db.evaluation.findUnique({
    where: { submissionId: submission.id },
  });
  const after = await db.submission.findUnique({
    where: { id: submission.id },
  });

  check('Evaluation row was created', Boolean(evaluation));
  check('submission marked SCORED', after?.status === 'SCORED');

  if (evaluation) {
    check(
      'functional score is weighted (3+1 of 5 => 80)',
      evaluation.functionalScore === 80,
      `got ${evaluation.functionalScore}`,
    );
    check(
      'tests counted correctly (2/3)',
      evaluation.testsPassed === 2 && evaluation.testsTotal === 3,
    );
    check('deployment recorded reachable', evaluation.deploymentReachable);
    check('performance dimension populated', evaluation.performanceScore > 0);
    check(
      'security dimension populated',
      evaluation.securityReliabilityScore > 0,
    );
    check(
      'AI dimension present (degrades to neutral without a key)',
      evaluation.aiScore >= 0 && evaluation.aiScore <= 100,
    );
    check(
      'overall score is a valid blend',
      evaluation.overallScore > 0 && evaluation.overallScore <= 100,
      `overall=${evaluation.overallScore}`,
    );

    // Reproducibility: the exact weights used are stored on the row.
    const weights = evaluation.weights as Record<string, number> | null;
    check(
      'weights stored for reproducibility',
      weights?.functional === 0.6 && weights?.ai === 0.15,
      JSON.stringify(weights),
    );

    // Audit evidence
    const probe = evaluation.probeEvidence as Record<string, unknown> | null;
    check(
      'probe evidence stored (performance + security + warmup)',
      Boolean(probe?.performance && probe?.security && probe?.warmup),
    );
    check('per-test results stored', Array.isArray(evaluation.testResults));
    check(
      'repo snapshot metadata stored',
      evaluation.repoTextSnapshot !== null,
    );
    check(
      'rubric version + prompt hash stored for audit',
      Boolean(evaluation.rubricVersion) && Boolean(evaluation.modelPromptHash),
    );

    // Hand-verify the blend maths against the stored dimensions.
    const expected =
      Math.round(
        (evaluation.functionalScore * 0.6 +
          evaluation.performanceScore * 0.15 +
          evaluation.securityReliabilityScore * 0.1 +
          evaluation.aiScore * 0.15) *
          100,
      ) / 100;
    check(
      'overall equals the 60/15/10/15 blend of its parts',
      Math.abs(evaluation.overallScore - expected) < 0.02,
      `stored=${evaluation.overallScore} expected=${expected}`,
    );
  }

  // ---- Re-run: must update in place, never duplicate ----
  await evaluateProcessor({ ...job, attempts: 2 });
  const count = await db.evaluation.count({
    where: { submissionId: submission.id },
  });
  check('re-running the job does not duplicate the evaluation', count === 1);

  // ---- Unsupported category is refused (D17) ----
  await db.problem.update({
    where: { id: problem.id },
    data: { category: 'WEB_APP' },
  });
  const sub2 = await db.submission.create({
    data: {
      userId: user.id,
      tournamentId: tournament.id,
      roundId: (
        await db.round.create({
          data: {
            tournamentId: tournament.id,
            type: 'SIMULATION',
            stage: 'SIMULATION',
            sequence: 2,
            durationSeconds: 600,
            problemId: problem.id,
          },
        })
      ).id,
      problemId: problem.id,
      repoUrl: `https://github.com/a/b?${TAG}`,
      deploymentUrl: 'https://example.com',
      status: 'RECEIVED',
    },
  });
  await evaluateProcessor({
    id: 'x',
    name: 'evaluate',
    payload: { submissionId: sub2.id },
    attempts: 1,
    maxAttempts: 3,
  });
  const sub2After = await db.submission.findUnique({ where: { id: sub2.id } });
  check(
    'disabled category marks submission FAILED without retrying',
    sub2After?.status === 'FAILED',
    `status=${sub2After?.status}`,
  );

  await cleanup();
  console.log(
    failures === 0
      ? '\nEvaluation E2E verified.'
      : `\n${failures} check(s) FAILED.`,
  );
}

main()
  .catch(async (e) => {
    console.error('\nFAIL —', e);
    failures++;
    await cleanup().catch(() => {});
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(failures > 0 ? 1 : 0);
  });
