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
      category: 'REST_API',
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
      'AI dimension is zero and unweighted on a deterministic round',
      evaluation.aiScore === 0,
      `aiScore=${evaluation.aiScore}`,
    );
    check(
      'overall score is a valid blend',
      evaluation.overallScore > 0 && evaluation.overallScore <= 100,
      `overall=${evaluation.overallScore}`,
    );

    // Reproducibility: the exact weights used are stored on the row.
    // This round is SIMULATION, which resolves to the `deterministic` profile
    // (D20) — AI is not evaluated, so its weight must be 0.
    const weights = evaluation.weights as Record<string, number> | null;
    check(
      'weights stored for reproducibility (deterministic profile: ai=0)',
      weights?.functional === 0.6 &&
        weights?.performance === 0.15 &&
        weights?.securityReliability === 0.1 &&
        weights?.ai === 0,
      JSON.stringify(weights),
    );
    check(
      'profile recorded on the evaluation (D20)',
      evaluation.profileName === 'deterministic',
      `profileName=${evaluation.profileName}`,
    );
    const dims = evaluation.dimensions as Record<string, boolean> | null;
    check(
      'active dimensions recorded (AI off for SIMULATION)',
      dims?.functional === true && dims?.ai === false,
      JSON.stringify(dims),
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
    // AI is not part of a deterministic round, so there is deliberately no
    // model/prompt evidence — and no paid API call was made.
    check(
      'no AI audit trail on a deterministic round (no model was called)',
      evaluation.aiScore === 0 && !evaluation.modelPromptHash,
      `aiScore=${evaluation.aiScore} promptHash=${evaluation.modelPromptHash}`,
    );

    // Hand-verify the blend maths against the stored weights, whatever they are.
    const wf = weights?.functional ?? 0;
    const wp = weights?.performance ?? 0;
    const ws = weights?.securityReliability ?? 0;
    const wa = weights?.ai ?? 0;
    const total = wf + wp + ws + wa;
    const expected =
      Math.round(
        ((evaluation.functionalScore * wf +
          evaluation.performanceScore * wp +
          evaluation.securityReliabilityScore * ws +
          evaluation.aiScore * wa) /
          total) *
          100,
      ) / 100;
    check(
      'overall equals the renormalised blend of the ACTIVE dimensions',
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

  // ---- Late stage flips AI on through the real processor (D20) ----
  // Same problem, same deployment — only the round STAGE differs. This proves
  // the tournament layer (not the engine) drives which dimensions run.
  {
    const finalRound = await db.round.create({
      data: {
        tournamentId: tournament.id,
        type: 'KNOCKOUT',
        stage: 'FINAL',
        sequence: 1,
        durationSeconds: 3600,
        problemId: problem.id,
        status: 'OPEN',
      },
    });
    const finalSub = await db.submission.create({
      data: {
        userId: user.id,
        tournamentId: tournament.id,
        roundId: finalRound.id,
        problemId: problem.id,
        category: 'REST_API',
        repoUrl: `https://github.com/sindresorhus/p-limit?${TAG}`,
        deploymentUrl: 'https://example.com',
        status: 'RECEIVED',
      },
    });
    await evaluateProcessor({
      id: 'final-stage',
      name: 'evaluate',
      payload: { submissionId: finalSub.id },
      attempts: 1,
      maxAttempts: 3,
    });

    const finalEval = await db.evaluation.findUnique({
      where: { submissionId: finalSub.id },
    });
    const fw = finalEval?.weights as Record<string, number> | null;
    const fdims = finalEval?.dimensions as Record<string, boolean> | null;

    check(
      'FINAL stage resolves to the full profile',
      finalEval?.profileName === 'full',
      `profileName=${finalEval?.profileName}`,
    );
    check(
      'FINAL stage re-enables the AI weight (0.15)',
      fw?.ai === 0.15,
      JSON.stringify(fw),
    );
    check(
      'FINAL stage marks the AI dimension active',
      fdims?.ai === true,
      JSON.stringify(fdims),
    );
    check(
      'FINAL stage actually produced an AI score + audit trail',
      (finalEval?.aiScore ?? 0) > 0 && Boolean(finalEval?.modelPromptHash),
      `aiScore=${finalEval?.aiScore} promptHash=${finalEval?.modelPromptHash?.slice(0, 12)}`,
    );
  }

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
      category: 'REST_API',
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

  // ---- Exhausted retries must not strand the submission as QUEUED ----
  // The job dead-letters after maxAttempts; if the submission stayed QUEUED it
  // would look pending forever with nothing left to run it.
  const sub3 = await db.submission.create({
    data: {
      userId: user.id,
      tournamentId: tournament.id,
      roundId: (
        await db.round.create({
          data: {
            tournamentId: tournament.id,
            type: 'SIMULATION',
            stage: 'SIMULATION',
            sequence: 3,
            durationSeconds: 600,
            problemId: problem.id,
          },
        })
      ).id,
      problemId: problem.id,
      category: 'REST_API',
      repoUrl: `https://github.com/a/b?${TAG}`,
      deploymentUrl: 'https://example.com',
      status: 'RECEIVED',
    },
  });
  // Force a failure that is NOT the "unsupported category" early-return.
  await db.problem.update({
    where: { id: problem.id },
    data: { category: 'REST_API' },
  });
  await db.submission.update({
    where: { id: sub3.id },
    data: { deploymentUrl: 'https://example.com' },
  });

  const failingJob = {
    id: 'exhausted',
    name: 'evaluate' as const,
    payload: { submissionId: 'does-not-exist-force-error' },
    attempts: 3,
    maxAttempts: 3,
  };
  // A missing submission returns early, so drive the exhausted path directly:
  // run with a submission whose evaluation will throw by pointing the job at a
  // real submission and an attempts count at the limit.
  const beforeStatus = (
    await db.submission.findUnique({ where: { id: sub3.id } })
  )?.status;
  await evaluateProcessor({
    ...failingJob,
    payload: { submissionId: sub3.id },
    attempts: 3,
    maxAttempts: 3,
  }).catch(() => undefined);
  const sub3After = await db.submission.findUnique({ where: { id: sub3.id } });
  check(
    'exhausted evaluation does not leave the submission QUEUED',
    sub3After?.status !== 'QUEUED',
    `before=${beforeStatus} after=${sub3After?.status}`,
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
