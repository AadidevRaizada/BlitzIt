import './load-env';
import type { Prisma } from '../src/generated/prisma/client';
import { db } from '../src/server/db';
import {
  allowedSubmissionTransitions,
  canSubmissionTransition,
  disqualifySubmission,
  getMySubmission,
  getSubmission,
  getSubmissionHistory,
  listAllSubmissions,
  listMySubmissions,
  nextSubmissionState,
  retryEvaluation,
  sealRoundSubmissions,
  submitSolution,
  isEvaluationResultCurrent,
  toPersistedStatus,
  toSubmissionState,
  validateCommitSha,
  validateDeploymentUrl,
  validateRepoUrl,
  InvalidSubmissionTransitionError,
  SUBMISSION_TRANSITIONS,
  type SubmissionState,
  type SubmissionTransition,
} from '../src/server/modules/submission';
import { describeJob } from '../src/server/jobs/status';
import { evaluateProcessor } from '../src/server/jobs/processors/evaluate';
import { queue } from '../src/server/jobs/pg-queue';
import { AppError } from '../src/lib/errors';

/**
 * Epic E4 — submission system & evaluation pipeline acceptance.
 *
 * Covers the pure layers (state machine, job lifecycle, URL validation) and the
 * full persisted path against a real database: accept → queue → runner →
 * Evaluation Engine → persisted result, plus every refusal along the way.
 *
 * Run: npm run verify:submission
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

async function checkRejects(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode?: string,
) {
  let rejected = false;
  let detail = '';
  try {
    await fn();
  } catch (error) {
    if (expectedCode) {
      rejected = error instanceof AppError && error.code === expectedCode;
      if (!rejected) {
        detail = `threw ${(error as Error).name}${
          error instanceof AppError ? ` (${error.code})` : ''
        }: ${(error as Error).message}`;
      }
    } else {
      rejected = true;
    }
  }
  check(label, rejected, detail || 'was accepted');
}

const TAG = `e4-${Date.now()}`;
const EMAIL_DOMAIN = 'e4-submission.test';

async function cleanup() {
  await db.evaluation.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.evaluationJob.deleteMany({
    where: { submission: { tournament: { slug: { contains: TAG } } } },
  });
  await db.submissionRevision.deleteMany({
    where: { submission: { tournament: { slug: { contains: TAG } } } },
  });
  await db.submission.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.registration.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.match.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.ranking.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.round.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.opsEvent.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.tournament.deleteMany({ where: { slug: { contains: TAG } } });
  await db.hiddenTest.deleteMany({
    where: { problem: { slug: { contains: TAG } } },
  });
  await db.problem.deleteMany({ where: { slug: { contains: TAG } } });
  // E8 added notifications, badges and a Hall of Fame entry to anything that
  // runs a tournament. They reference `User`, so a suite that deletes its users
  // without clearing them first fails on a foreign key — and a `sendEmail` job
  // whose notification is gone would be claimed by an unrelated suite.
  await db.$executeRaw`DELETE FROM "EvaluationJob" WHERE "name" = 'sendEmail' AND ("payload"->>'notificationId') IN (SELECT "id" FROM "Notification" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE ${'%' + EMAIL_DOMAIN}))`;
  await db.notification.deleteMany({
    where: { user: { email: { contains: EMAIL_DOMAIN } } },
  });
  await db.userBadge.deleteMany({
    where: { user: { email: { contains: EMAIL_DOMAIN } } },
  });
  await db.hallOfFame.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.user.deleteMany({ where: { email: { contains: EMAIL_DOMAIN } } });
}

// ───────────────────────── 1. Pure: the state machine ─────────────────────────

function pureStateMachine() {
  console.log('\n── 1. Submission state machine (pure) ──');

  const path: Array<[SubmissionState, SubmissionTransition, SubmissionState]> =
    [
      ['DRAFT', 'SUBMIT', 'READY'],
      ['READY', 'ENQUEUE', 'QUEUED'],
      ['QUEUED', 'START', 'EVALUATING'],
      ['EVALUATING', 'COMPLETE', 'EVALUATED'],
    ];
  for (const [from, transition, expected] of path) {
    check(
      `${from} --${transition}--> ${expected}`,
      nextSubmissionState(from, transition) === expected,
    );
  }

  check(
    'a transient failure returns to the queue',
    nextSubmissionState('EVALUATING', 'REQUEUE') === 'QUEUED',
  );
  check(
    'an exhausted evaluation fails',
    nextSubmissionState('EVALUATING', 'FAIL') === 'FAILED',
  );
  check(
    'an admin can retry a failed evaluation',
    nextSubmissionState('FAILED', 'RETRY') === 'QUEUED',
  );
  check(
    'an admin can re-run a completed evaluation',
    nextSubmissionState('EVALUATED', 'RETRY') === 'QUEUED',
  );
  check(
    'resubmitting from any live state returns to READY',
    (['READY', 'QUEUED', 'EVALUATING', 'EVALUATED', 'FAILED'] as const).every(
      (s) => nextSubmissionState(s, 'RESUBMIT') === 'READY',
    ),
  );

  // The exhaustive legal/illegal matrix.
  const legal: Record<SubmissionState, SubmissionTransition[]> = {
    DRAFT: ['SUBMIT'],
    READY: ['ENQUEUE', 'RESUBMIT', 'DISQUALIFY'],
    QUEUED: ['START', 'RESUBMIT', 'DISQUALIFY'],
    EVALUATING: ['COMPLETE', 'FAIL', 'REQUEUE', 'RESUBMIT', 'DISQUALIFY'],
    EVALUATED: ['RETRY', 'RESUBMIT', 'DISQUALIFY'],
    FAILED: ['RETRY', 'RESUBMIT', 'DISQUALIFY'],
    DISQUALIFIED: [],
  };

  for (const [state, allowed] of Object.entries(legal) as Array<
    [SubmissionState, SubmissionTransition[]]
  >) {
    const actual = allowedSubmissionTransitions(state).sort();
    check(
      `${state}: exactly [${allowed.slice().sort().join(', ')}] are legal`,
      JSON.stringify(actual) === JSON.stringify(allowed.slice().sort()),
      `got [${actual.join(', ')}]`,
    );

    for (const transition of SUBMISSION_TRANSITIONS) {
      if (allowed.includes(transition)) continue;
      let threw = false;
      try {
        nextSubmissionState(state, transition);
      } catch (error) {
        threw = error instanceof InvalidSubmissionTransitionError;
      }
      check(`${state} rejects ${transition}`, threw);
    }
  }

  check(
    'DISQUALIFIED is terminal — a struck entry can never re-enter the queue',
    !canSubmissionTransition('DISQUALIFIED', 'RETRY') &&
      !canSubmissionTransition('DISQUALIFIED', 'RESUBMIT') &&
      allowedSubmissionTransitions('DISQUALIFIED').length === 0,
  );

  // Domain ↔ persisted mapping must round-trip for every persisted value.
  const persisted = [
    'RECEIVED',
    'QUEUED',
    'JUDGING',
    'SCORED',
    'FAILED',
    'DISQUALIFIED',
  ] as const;
  check(
    'every persisted status round-trips through the domain vocabulary',
    persisted.every((s) => toPersistedStatus(toSubmissionState(s)) === s),
  );
  check(
    'DRAFT has no persisted representation (it is never stored)',
    (() => {
      try {
        toPersistedStatus('DRAFT');
        return false;
      } catch {
        return true;
      }
    })(),
  );
}

// ───────────────────────── 2. Pure: validation ─────────────────────────

function pureValidation() {
  console.log('\n── 2. Submission validation (pure) ──');

  check(
    'a valid GitHub URL is accepted and normalised',
    validateRepoUrl('https://github.com/vercel/next.js') ===
      'https://github.com/vercel/next.js',
  );
  check(
    'a .git suffix is normalised away',
    validateRepoUrl('https://github.com/vercel/next.js.git') ===
      'https://github.com/vercel/next.js',
  );
  check(
    'trailing path segments are normalised away',
    validateRepoUrl('https://github.com/vercel/next.js/tree/main') ===
      'https://github.com/vercel/next.js',
  );

  const badRepos: Array<[string, string]> = [
    ['', 'empty'],
    ['not-a-url', 'not a URL'],
    ['http://github.com/a/b', 'plain http'],
    ['https://gitlab.com/a/b', 'not github'],
    ['https://github.com/onlyowner', 'missing repo'],
    ['ftp://github.com/a/b', 'wrong scheme'],
  ];
  for (const [url, why] of badRepos) {
    let threw = false;
    try {
      validateRepoUrl(url);
    } catch (error) {
      threw = error instanceof AppError && error.code === 'VALIDATION';
    }
    check(`repo URL rejected: ${why}`, threw, url);
  }

  check(
    'a valid https deployment URL is accepted',
    validateDeploymentUrl('https://example.com') === 'https://example.com/',
  );
  check(
    'a deployment sub-path is preserved',
    validateDeploymentUrl('https://example.com/api/v1').includes('/api/v1'),
  );

  const badDeployments: Array<[string, string]> = [
    ['', 'empty'],
    ['http://example.com', 'plain http'],
    ['https://localhost', 'localhost'],
    ['https://127.0.0.1', 'loopback'],
    ['https://10.0.0.5', 'private class A'],
    ['https://192.168.1.10', 'private class C'],
    ['https://172.16.4.4', 'private class B'],
    ['https://169.254.169.254', 'cloud metadata'],
    ['https://100.64.0.1', 'CGNAT'],
    ['https://my-app.local', '.local'],
    ['https://svc.internal', '.internal'],
    ['https://user:pass@example.com', 'embedded credentials'],
  ];
  for (const [url, why] of badDeployments) {
    let threw = false;
    try {
      validateDeploymentUrl(url);
    } catch (error) {
      threw = error instanceof AppError && error.code === 'VALIDATION';
    }
    check(`deployment URL rejected: ${why}`, threw, url);
  }

  check('a null commit SHA is fine', validateCommitSha(null) === null);
  check('an empty commit SHA is fine', validateCommitSha('  ') === null);
  check(
    'a valid commit SHA is lowercased',
    validateCommitSha('ABCDEF1234') === 'abcdef1234',
  );
  check(
    'a bogus commit SHA is refused',
    (() => {
      try {
        validateCommitSha('not-a-sha');
        return false;
      } catch {
        return true;
      }
    })(),
  );
}

// ───────────────────────── 3. Pure: job lifecycle ─────────────────────────

function pureJobLifecycle() {
  console.log('\n── 3. Job lifecycle helpers (pure) ──');

  const base = {
    status: 'QUEUED' as const,
    attempts: 0,
    maxAttempts: 3,
    availableAt: new Date('2026-01-01T00:00:00Z'),
    lastError: null,
  };
  const now = new Date('2026-01-01T01:00:00Z');

  check('a fresh job is QUEUED', describeJob(base, now).state === 'QUEUED');
  check(
    'a queued job with backoff in the future is a scheduled retry',
    describeJob(
      { ...base, attempts: 1, availableAt: new Date('2026-01-01T02:00:00Z') },
      now,
    ).state === 'RETRY_SCHEDULED',
  );
  check(
    'a scheduled retry reports when it next runs',
    describeJob(
      { ...base, attempts: 1, availableAt: new Date('2026-01-01T02:00:00Z') },
      now,
    ).nextAttemptAt?.toISOString() === '2026-01-01T02:00:00.000Z',
  );
  check(
    'a retry whose backoff has elapsed is simply QUEUED again',
    describeJob({ ...base, attempts: 1 }, now).state === 'QUEUED',
  );
  check(
    'CLAIMED and RUNNING pass through',
    describeJob({ ...base, status: 'CLAIMED' }, now).state === 'CLAIMED' &&
      describeJob({ ...base, status: 'RUNNING' }, now).state === 'RUNNING',
  );
  check(
    'DONE is COMPLETED and terminal',
    (() => {
      const d = describeJob({ ...base, status: 'DONE' }, now);
      return d.state === 'COMPLETED' && d.isTerminal && !d.isActive;
    })(),
  );
  check(
    'FAILED with attempts left is recoverable, not dead-lettered',
    (() => {
      const d = describeJob({ ...base, status: 'FAILED', attempts: 1 }, now);
      return d.state === 'FAILED' && !d.isTerminal && d.attemptsRemaining === 2;
    })(),
  );
  check(
    'FAILED with attempts exhausted is a dead letter',
    (() => {
      const d = describeJob({ ...base, status: 'FAILED', attempts: 3 }, now);
      return (
        d.state === 'DEAD_LETTER' && d.isTerminal && d.attemptsRemaining === 0
      );
    })(),
  );
}

// ───────────────────────── 4. The persisted pipeline ─────────────────────────

async function pipeline() {
  console.log('\n── 4. Submission pipeline (database) ──');

  const [competitor, rival, stranger, admin] = await Promise.all([
    db.user.create({
      data: {
        authUserId: `auth-${TAG}-c`,
        email: `competitor@${EMAIL_DOMAIN}`,
        username: `competitor-${TAG}`,
        profile: { create: {} },
      },
    }),
    db.user.create({
      data: {
        authUserId: `auth-${TAG}-r`,
        email: `rival@${EMAIL_DOMAIN}`,
        username: `rival-${TAG}`,
        profile: { create: {} },
      },
    }),
    db.user.create({
      data: {
        authUserId: `auth-${TAG}-s`,
        email: `stranger@${EMAIL_DOMAIN}`,
        username: `stranger-${TAG}`,
        profile: { create: {} },
      },
    }),
    db.user.create({
      data: {
        authUserId: `auth-${TAG}-a`,
        email: `admin@${EMAIL_DOMAIN}`,
        username: `admin-${TAG}`,
        role: 'ADMIN',
        profile: { create: {} },
      },
    }),
  ]);

  const tournament = await db.tournament.create({
    data: {
      slug: `t-${TAG}`,
      name: 'E4 Submission Pipeline',
      status: 'SIMULATION',
    },
  });

  const problem = await db.problem.create({
    data: {
      title: 'E4 REST problem',
      slug: `p-${TAG}`,
      statementMarkdown: 'Build an API.',
      category: 'REST_API',
      evaluationStrategy: 'REST_API',
      contractSpec: { healthPath: '/', performanceSamples: 2 },
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

  const openRound = await db.round.create({
    data: {
      tournamentId: tournament.id,
      type: 'SIMULATION',
      stage: 'SIMULATION',
      sequence: 1,
      durationSeconds: 1800,
      problemId: problem.id,
      status: 'OPEN',
      opensAt: new Date(Date.now() - 60_000),
      deadlineAt: new Date(Date.now() + 3_600_000),
    },
  });

  for (const user of [competitor, rival]) {
    await db.registration.create({
      data: { userId: user.id, tournamentId: tournament.id, status: 'ACTIVE' },
    });
  }

  // ---- Registration is the access gate ----
  await checkRejects(
    'an unregistered user cannot submit',
    () =>
      submitSolution({
        userId: stranger.id,
        roundId: openRound.id,
        repoUrl: 'https://github.com/vercel/next.js',
        deploymentUrl: 'https://example.com',
      }),
    'FORBIDDEN',
  );

  // ---- Invalid input is refused before anything is written ----
  await checkRejects(
    'an invalid repository URL is refused',
    () =>
      submitSolution({
        userId: competitor.id,
        roundId: openRound.id,
        repoUrl: 'https://gitlab.com/a/b',
        deploymentUrl: 'https://example.com',
      }),
    'VALIDATION',
  );
  await checkRejects(
    'a private deployment URL is refused',
    () =>
      submitSolution({
        userId: competitor.id,
        roundId: openRound.id,
        repoUrl: 'https://github.com/vercel/next.js',
        deploymentUrl: 'https://127.0.0.1',
      }),
    'VALIDATION',
  );
  check(
    'nothing was persisted by the refused attempts',
    (await db.submission.count({ where: { roundId: openRound.id } })) === 0,
  );

  // ---- The happy path ----
  const first = await submitSolution({
    userId: competitor.id,
    roundId: openRound.id,
    repoUrl: 'https://github.com/vercel/next.js.git',
    deploymentUrl: 'https://example.com',
    commitSha: 'ABC1234',
  });

  check('a valid submission is accepted', Boolean(first.submission.id));
  check('the first submission is version 1', first.version === 1);
  check('it is not flagged as a replacement', first.replaced === false);
  check(
    'the repo URL was normalised',
    first.submission.repoUrl === 'https://github.com/vercel/next.js',
  );
  check(
    'the commit SHA was normalised',
    first.submission.commitSha === 'abc1234',
  );
  check(
    'the challenge category was snapshotted from the problem',
    first.submission.category === 'REST_API',
  );

  const afterSubmit = await getMySubmission(competitor.id, openRound.id);
  check(
    'the submission is QUEUED for evaluation',
    afterSubmit?.state === 'QUEUED',
  );

  // ---- Queue creation: Submission → Queue, never a direct engine call ----
  const jobs = await db.evaluationJob.findMany({
    where: { submissionId: first.submission.id },
  });
  check(
    'exactly one evaluation job was created',
    jobs.length === 1,
    `${jobs.length}`,
  );
  check('the job targets the evaluate processor', jobs[0]?.name === 'evaluate');
  check(
    'the job payload carries the submission id',
    (jobs[0]?.payload as { submissionId?: string } | null)?.submissionId ===
      first.submission.id,
  );
  check(
    'the job is queued and runnable',
    describeJob(jobs[0]!).state === 'QUEUED',
  );

  // ---- Revision history ----
  const historyV1 = await getSubmissionHistory(first.submission.id, competitor);
  check(
    'revision 1 was recorded',
    historyV1.length === 1 && historyV1[0]?.version === 1,
  );

  // ---- Editing before the deadline creates a new revision ----
  const second = await submitSolution({
    userId: competitor.id,
    roundId: openRound.id,
    repoUrl: 'https://github.com/sindresorhus/p-limit',
    deploymentUrl: 'https://example.com',
  });
  check('editing before the deadline is allowed', second.replaced === true);
  check('the version was bumped', second.version === 2);
  check(
    'the current entry reflects the new revision',
    second.submission.repoUrl === 'https://github.com/sindresorhus/p-limit',
  );
  check(
    'there is still exactly ONE submission row for this round',
    (await db.submission.count({
      where: { userId: competitor.id, roundId: openRound.id },
    })) === 1,
  );

  const historyV2 = await getSubmissionHistory(first.submission.id, competitor);
  check(
    'both revisions are kept, newest first',
    historyV2.length === 2 && historyV2[0]?.version === 2,
  );
  check(
    'the original revision is preserved verbatim',
    historyV2[1]?.repoUrl === 'https://github.com/vercel/next.js',
  );
  check(
    'a second job was queued for the new revision',
    (await db.evaluationJob.count({
      where: { submissionId: first.submission.id },
    })) === 2,
  );

  // ---- Duplicate deployment URL across competitors (D19) ----
  await checkRejects(
    'another competitor cannot reuse the same deployment URL in a round',
    () =>
      submitSolution({
        userId: rival.id,
        roundId: openRound.id,
        repoUrl: 'https://github.com/vercel/next.js',
        deploymentUrl: 'https://example.com',
      }),
    'CONFLICT',
  );

  // ---- Authorisation ----
  await checkRejects(
    'a competitor cannot view another competitor’s submission',
    () => getSubmission(first.submission.id, rival),
    'FORBIDDEN',
  );
  check(
    'an admin can view any submission',
    (await getSubmission(first.submission.id, admin)).id ===
      first.submission.id,
  );
  check(
    'my submissions list only contains my own',
    (await listMySubmissions(rival.id)).length === 0,
  );
  await checkRejects(
    'a non-admin cannot list all submissions',
    () => listAllSubmissions(competitor),
    'FORBIDDEN',
  );
  await checkRejects(
    'a non-admin cannot retry an evaluation',
    () => retryEvaluation(first.submission.id, competitor),
    'FORBIDDEN',
  );
  await checkRejects(
    'a competitor cannot read another competitor’s history',
    () => getSubmissionHistory(first.submission.id, rival),
    'FORBIDDEN',
  );

  // ---- Run the pipeline: Queue → Runner → Evaluation Engine ----
  const claimed = await queue.claim(5, `e4-runner-${TAG}`);
  const mine = claimed.filter(
    (job) =>
      (job.payload as { submissionId?: string }).submissionId ===
      first.submission.id,
  );
  check('the runner can claim the queued jobs', mine.length >= 1);

  await evaluateProcessor(mine[mine.length - 1]!);

  const scored = await getSubmission(first.submission.id, competitor);
  check(
    'the submission reached EVALUATED',
    scored.state === 'EVALUATED',
    scored.state,
  );
  check('an evaluation was persisted', scored.evaluation !== null);

  if (scored.evaluation) {
    const e = scored.evaluation;
    check(
      'overall score persisted',
      e.overallScore > 0 && e.overallScore <= 100,
      `${e.overallScore}`,
    );
    check(
      'dimension scores persisted',
      e.functionalScore > 0 &&
        e.performanceScore > 0 &&
        e.securityReliabilityScore > 0,
    );
    check('test counts persisted', e.testsTotal === 2 && e.testsPassed === 1);
    check('weights persisted for reproducibility', e.weights !== null);
    check(
      'the governing profile was recorded (D20)',
      e.profileName === 'deterministic',
    );
    check('the active dimensions were recorded', e.dimensions !== null);
    check(
      'timestamps persisted',
      e.startedAt !== null && e.finishedAt !== null,
    );
    check(
      'the evaluated revision was recorded',
      e.submissionVersion === 2,
      `${e.submissionVersion}`,
    );
    check(
      'a deterministic round records no model/prompt/provider (no paid call)',
      e.modelPromptHash === null || e.modelPromptHash === '',
    );
  }

  const evidence = await db.evaluation.findUnique({
    where: { submissionId: first.submission.id },
  });
  check('probe evidence persisted for audit', evidence?.probeEvidence !== null);
  check('per-test results persisted', Array.isArray(evidence?.testResults));
  check(
    'repo snapshot metadata persisted',
    evidence?.repoTextSnapshot !== null,
  );

  const doneJob = await db.evaluationJob.findFirst({
    where: { submissionId: first.submission.id },
    orderBy: { createdAt: 'desc' },
  });
  check(
    'the job row still describes its own lifecycle',
    doneJob !== null && describeJob(doneJob).attempts >= 1,
  );

  // ---- A stale result must not overwrite a newer revision ----
  // The freshness rule is tested as a PURE predicate rather than by racing a
  // real evaluation: a race depends on how long a network probe happens to
  // take, so it can pass vacuously (and did, on the first attempt) without ever
  // exercising the guard.
  {
    check(
      'a result for the revision that was evaluated is written',
      isEvaluationResultCurrent({
        evaluatedVersion: 2,
        current: { version: 2, status: 'JUDGING' },
      }),
    );
    check(
      'a result for a SUPERSEDED revision is discarded',
      !isEvaluationResultCurrent({
        evaluatedVersion: 1,
        current: { version: 2, status: 'RECEIVED' },
      }),
    );
    check(
      'a result for a deleted submission is discarded',
      !isEvaluationResultCurrent({ evaluatedVersion: 1, current: null }),
    );
    check(
      'a result for a disqualified entry is discarded',
      !isEvaluationResultCurrent({
        evaluatedVersion: 1,
        current: { version: 1, status: 'DISQUALIFIED' },
      }),
    );

    // And the integration side of the same rule: after a replacement, a fresh
    // evaluation records the NEW revision, so a stale row is always detectable.
    const freshRound = await db.round.create({
      data: {
        tournamentId: tournament.id,
        type: 'SIMULATION',
        stage: 'SIMULATION',
        sequence: 2,
        durationSeconds: 1800,
        problemId: problem.id,
        status: 'OPEN',
        opensAt: new Date(Date.now() - 60_000),
        deadlineAt: new Date(Date.now() + 3_600_000),
      },
    });
    await submitSolution({
      userId: competitor.id,
      roundId: freshRound.id,
      repoUrl: 'https://github.com/vercel/next.js',
      deploymentUrl: 'https://example.org',
    });
    const replacedSub = await submitSolution({
      userId: competitor.id,
      roundId: freshRound.id,
      repoUrl: 'https://github.com/sindresorhus/p-limit',
      deploymentUrl: 'https://example.org',
    });
    const freshJobs = await queue.claim(5, `e4-fresh-${TAG}`);
    const freshJob = freshJobs.find(
      (j) =>
        (j.payload as { submissionId?: string }).submissionId ===
        replacedSub.submission.id,
    );
    if (freshJob) await evaluateProcessor(freshJob);

    const freshEval = await db.evaluation.findUnique({
      where: { submissionId: replacedSub.submission.id },
    });
    check(
      'an evaluation records the revision it actually scored',
      freshEval?.submissionVersion === 2,
      `submissionVersion=${freshEval?.submissionVersion}`,
    );
  }

  // ---- REGRESSION (Codex): every processor status write must be conditional ----
  // A job that is already in flight must not drag a struck or replaced entry
  // back to JUDGING / SCORED / FAILED. Previously only the SUCCESS path was
  // guarded; the initial JUDGING write and both failure writes were not.
  {
    const guardRound = await db.round.create({
      data: {
        tournamentId: tournament.id,
        type: 'SIMULATION',
        stage: 'SIMULATION',
        sequence: 6,
        durationSeconds: 1800,
        problemId: problem.id,
        status: 'OPEN',
        opensAt: new Date(Date.now() - 60_000),
        deadlineAt: new Date(Date.now() + 3_600_000),
      },
    });
    const guarded = await submitSolution({
      userId: competitor.id,
      roundId: guardRound.id,
      repoUrl: 'https://github.com/vercel/next.js',
      deploymentUrl: 'https://example.guard',
    });

    const guardJobs = await queue.claim(5, `e4-guard-${TAG}`);
    const guardJob = guardJobs.find(
      (j) =>
        (j.payload as { submissionId?: string }).submissionId ===
        guarded.submission.id,
    );

    // Disqualify AFTER the job was claimed but BEFORE it runs — exactly the
    // window the unconditional JUDGING write used to reopen.
    await disqualifySubmission(guarded.submission.id, admin, 'guard test');
    if (guardJob) await evaluateProcessor(guardJob);

    const afterGuard = await db.submission.findUniqueOrThrow({
      where: { id: guarded.submission.id },
    });
    check(
      'REGRESSION: an in-flight job cannot revive a disqualified entry',
      afterGuard.status === 'DISQUALIFIED',
      `status=${afterGuard.status}`,
    );
    check(
      'REGRESSION: no score is written for a disqualified entry',
      (await db.evaluation.findUnique({
        where: { submissionId: guarded.submission.id },
      })) === null,
    );

    // And the same guard on the FAILURE path: a job for a superseded revision
    // must not mark the current revision FAILED.
    const supersededRound = await db.round.create({
      data: {
        tournamentId: tournament.id,
        type: 'SIMULATION',
        stage: 'SIMULATION',
        sequence: 7,
        durationSeconds: 1800,
        problemId: problem.id,
        status: 'OPEN',
        opensAt: new Date(Date.now() - 60_000),
        deadlineAt: new Date(Date.now() + 3_600_000),
      },
    });
    const superseded = await submitSolution({
      userId: competitor.id,
      roundId: supersededRound.id,
      repoUrl: 'https://github.com/vercel/next.js',
      deploymentUrl: 'https://example.superseded',
    });
    const supersededJobs = await queue.claim(5, `e4-superseded-${TAG}`);
    const supersededJob = supersededJobs.find(
      (j) =>
        (j.payload as { submissionId?: string }).submissionId ===
        superseded.submission.id,
    );
    // Replace the entry, so the claimed job now describes revision 1 of 2.
    await submitSolution({
      userId: competitor.id,
      roundId: supersededRound.id,
      repoUrl: 'https://github.com/sindresorhus/p-limit',
      deploymentUrl: 'https://example.superseded',
    });
    // Force that stale job down the exhausted-failure path.
    if (supersededJob) {
      await evaluateProcessor({
        ...supersededJob,
        payload: { submissionId: 'not-a-real-id-forcing-failure' },
        attempts: 3,
        maxAttempts: 3,
      }).catch(() => undefined);
      await evaluateProcessor({
        ...supersededJob,
        attempts: 3,
        maxAttempts: 3,
      }).catch(() => undefined);
    }
    const afterSuperseded = await db.submission.findUniqueOrThrow({
      where: { id: superseded.submission.id },
    });
    check(
      'REGRESSION: a stale job never marks the CURRENT revision FAILED',
      afterSuperseded.status !== 'FAILED',
      `status=${afterSuperseded.status} version=${afterSuperseded.version}`,
    );
  }

  // ---- REGRESSION (Codex): deployment-URL reuse is enforced by the DATABASE ----
  {
    const raceRound = await db.round.create({
      data: {
        tournamentId: tournament.id,
        type: 'SIMULATION',
        stage: 'SIMULATION',
        sequence: 8,
        durationSeconds: 1800,
        problemId: problem.id,
        status: 'OPEN',
        opensAt: new Date(Date.now() - 60_000),
        deadlineAt: new Date(Date.now() + 3_600_000),
      },
    });

    // Both competitors submit the SAME deployment URL simultaneously. The
    // application check is read-then-write, so both can pass it; only the
    // unique index stops the duplicate — and the violation must come back as
    // the same typed CONFLICT the friendly check produces.
    const outcomes = await Promise.allSettled([
      submitSolution({
        userId: competitor.id,
        roundId: raceRound.id,
        repoUrl: 'https://github.com/vercel/next.js',
        deploymentUrl: 'https://example.race',
      }),
      submitSolution({
        userId: rival.id,
        roundId: raceRound.id,
        repoUrl: 'https://github.com/sindresorhus/p-limit',
        deploymentUrl: 'https://example.race',
      }),
    ]);
    const accepted = outcomes.filter((o) => o.status === 'fulfilled').length;
    const rejections = outcomes.flatMap((o) =>
      o.status === 'rejected' ? [o.reason] : [],
    );
    check(
      'REGRESSION: concurrent identical deployment URLs — only one is accepted',
      accepted === 1,
      `${accepted} accepted`,
    );
    check(
      'REGRESSION: the loser gets a typed CONFLICT, not a raw Prisma error',
      rejections.every((e) => e instanceof AppError && e.code === 'CONFLICT'),
      rejections.map((e) => `${(e as Error).name}`).join(','),
    );
    // Note the trailing slash: deployment URLs are NORMALISED on the way in,
    // which is what makes two spellings of one deployment collide.
    check(
      'only one row exists for that deployment URL in the round',
      (await db.submission.count({
        where: {
          roundId: raceRound.id,
          deploymentUrl: 'https://example.race/',
        },
      })) === 1,
      `rows=${await db.submission.count({ where: { roundId: raceRound.id } })}`,
    );
  }

  // ---- Admin retry ----
  const retried = await retryEvaluation(first.submission.id, admin);
  check('an admin can retry a completed evaluation', Boolean(retried.jobId));
  check('the retry re-queued the submission', retried.state === 'QUEUED');
  check(
    'the retry created a distinct job',
    (await db.evaluationJob.count({
      where: { submissionId: first.submission.id },
    })) === 3,
  );

  // ---- Failed evaluation: an unsupported category dead-ends cleanly ----
  {
    await db.problem.update({
      where: { id: problem.id },
      data: { category: 'WEB_APP' },
    });
    const failRound = await db.round.create({
      data: {
        tournamentId: tournament.id,
        type: 'SIMULATION',
        stage: 'SIMULATION',
        sequence: 3,
        durationSeconds: 1800,
        problemId: problem.id,
        status: 'OPEN',
        opensAt: new Date(Date.now() - 60_000),
        deadlineAt: new Date(Date.now() + 3_600_000),
      },
    });

    await checkRejects(
      'a submission to a disabled category is refused up front (D17)',
      () =>
        submitSolution({
          userId: rival.id,
          roundId: failRound.id,
          repoUrl: 'https://github.com/vercel/next.js',
          deploymentUrl: 'https://example.net',
        }),
      'VALIDATION',
    );

    // Now force the failure path through the processor itself.
    await db.problem.update({
      where: { id: problem.id },
      data: { category: 'REST_API' },
    });
    const accepted = await submitSolution({
      userId: rival.id,
      roundId: failRound.id,
      repoUrl: 'https://github.com/vercel/next.js',
      deploymentUrl: 'https://example.net',
    });

    // REGRESSION (Codex): the processor scores the category the entry was
    // ACCEPTED under, not the problem's current one. Re-categorising the
    // PROBLEM must therefore NOT change how this entry is evaluated — only
    // disabling the snapshot on the submission itself can.
    await db.problem.update({
      where: { id: problem.id },
      data: { category: 'WEB_APP' },
    });
    const untouched = await queue.claim(5, `e4-untouched-${TAG}`);
    const untouchedJob = untouched.find(
      (j) =>
        (j.payload as { submissionId?: string }).submissionId ===
        accepted.submission.id,
    );
    if (untouchedJob) await evaluateProcessor(untouchedJob);
    const stillScored = await db.submission.findUnique({
      where: { id: accepted.submission.id },
    });
    check(
      'REGRESSION: re-categorising the PROBLEM does not fail an accepted entry',
      stillScored?.status === 'SCORED',
      `status=${stillScored?.status}`,
    );

    // Only the snapshot on the entry itself decides.
    await db.submission.update({
      where: { id: accepted.submission.id },
      data: { category: 'WEB_APP' },
    });

    const { enqueueEvaluation } = await import('../src/server/jobs');
    await enqueueEvaluation(accepted.submission.id, 99);
    const failJobs = await queue.claim(5, `e4-fail-${TAG}`);
    const failJob = failJobs.find(
      (j) =>
        (j.payload as { submissionId?: string }).submissionId ===
        accepted.submission.id,
    );
    if (failJob) await evaluateProcessor(failJob);

    const failed = await db.submission.findUnique({
      where: { id: accepted.submission.id },
    });
    check(
      'an unevaluable submission ends FAILED rather than pending forever',
      failed?.status === 'FAILED',
      `status=${failed?.status}`,
    );
    check(
      'the failed submission maps to the FAILED domain state',
      toSubmissionState(failed!.status) === 'FAILED',
    );

    await db.problem.update({
      where: { id: problem.id },
      data: { category: 'REST_API' },
    });
  }

  // ---- Closed window ----
  {
    const closedRound = await db.round.create({
      data: {
        tournamentId: tournament.id,
        type: 'SIMULATION',
        stage: 'SIMULATION',
        sequence: 4,
        durationSeconds: 1800,
        problemId: problem.id,
        status: 'OPEN',
        opensAt: new Date(Date.now() - 7_200_000),
        deadlineAt: new Date(Date.now() - 60_000),
      },
    });
    await checkRejects(
      'a submission after the deadline is refused',
      () =>
        submitSolution({
          userId: competitor.id,
          roundId: closedRound.id,
          repoUrl: 'https://github.com/vercel/next.js',
          deploymentUrl: 'https://example.dev',
        }),
      'WINDOW_CLOSED',
    );

    const pendingRound = await db.round.create({
      data: {
        tournamentId: tournament.id,
        type: 'SIMULATION',
        stage: 'SIMULATION',
        sequence: 5,
        durationSeconds: 1800,
        problemId: problem.id,
        status: 'PENDING',
      },
    });
    await checkRejects(
      'a submission to a round that has not opened is refused',
      () =>
        submitSolution({
          userId: competitor.id,
          roundId: pendingRound.id,
          repoUrl: 'https://github.com/vercel/next.js',
          deploymentUrl: 'https://example.dev',
        }),
      'WINDOW_CLOSED',
    );
  }

  // ---- Sealing locks the entry ----
  await checkRejects(
    'entries cannot be sealed while the window is open',
    () => sealRoundSubmissions(openRound.id),
    'CONFLICT',
  );

  await db.round.update({
    where: { id: openRound.id },
    data: { status: 'JUDGING', deadlineAt: new Date(Date.now() - 1000) },
  });
  const sealed = await sealRoundSubmissions(openRound.id);
  check(
    'sealing stamps the open round’s entries',
    sealed.sealed === 1,
    `${sealed.sealed}`,
  );
  check(
    'sealing is idempotent',
    (await sealRoundSubmissions(openRound.id)).sealed === 0,
  );

  await checkRejects(
    'a sealed submission can no longer be edited',
    () =>
      submitSolution({
        userId: competitor.id,
        roundId: openRound.id,
        repoUrl: 'https://github.com/vercel/next.js',
        deploymentUrl: 'https://example.com',
      }),
    'WINDOW_CLOSED',
  );

  // ---- Tournament state gate ----
  {
    const draftTournament = await db.tournament.create({
      data: {
        slug: `t-${TAG}-draft`,
        name: 'E4 Draft',
        status: 'REGISTRATION_OPEN',
      },
    });
    const draftRound = await db.round.create({
      data: {
        tournamentId: draftTournament.id,
        type: 'SIMULATION',
        stage: 'SIMULATION',
        sequence: 1,
        durationSeconds: 1800,
        problemId: problem.id,
        status: 'OPEN',
        opensAt: new Date(Date.now() - 60_000),
        deadlineAt: new Date(Date.now() + 3_600_000),
      },
    });
    await db.registration.create({
      data: {
        userId: competitor.id,
        tournamentId: draftTournament.id,
        status: 'ACTIVE',
      },
    });
    await checkRejects(
      'a tournament not in SIMULATION/LIVE refuses submissions',
      () =>
        submitSolution({
          userId: competitor.id,
          roundId: draftRound.id,
          repoUrl: 'https://github.com/vercel/next.js',
          deploymentUrl: 'https://example.io',
        }),
      'CONFLICT',
    );
  }

  // ---- Knockout rounds are per-match ----
  {
    const knockoutTournament = await db.tournament.create({
      data: {
        slug: `t-${TAG}-ko`,
        name: 'E4 Knockout',
        status: 'LIVE',
        bracketSize: 8,
        currentStage: 'QF',
      },
    });
    const koRound = await db.round.create({
      data: {
        tournamentId: knockoutTournament.id,
        type: 'KNOCKOUT',
        stage: 'QF',
        sequence: 1,
        durationSeconds: 2400,
        problemId: problem.id,
        status: 'OPEN',
        opensAt: new Date(Date.now() - 60_000),
        deadlineAt: new Date(Date.now() + 3_600_000),
      },
    });
    for (const user of [competitor, rival]) {
      await db.registration.create({
        data: {
          userId: user.id,
          tournamentId: knockoutTournament.id,
          status: 'ACTIVE',
        },
      });
    }
    const match = await db.match.create({
      data: {
        roundId: koRound.id,
        tournamentId: knockoutTournament.id,
        bracketPosition: 0,
        competitorAId: competitor.id,
        seedA: 1,
        status: 'PENDING',
      },
    });

    await checkRejects(
      'a registered competitor not paired into the round is refused',
      () =>
        submitSolution({
          userId: rival.id,
          roundId: koRound.id,
          repoUrl: 'https://github.com/vercel/next.js',
          deploymentUrl: 'https://example.co',
        }),
      'FORBIDDEN',
    );

    const koSubmission = await submitSolution({
      userId: competitor.id,
      roundId: koRound.id,
      repoUrl: 'https://github.com/vercel/next.js',
      deploymentUrl: 'https://example.co',
    });
    check(
      'a paired competitor can submit to a knockout round',
      Boolean(koSubmission.submission.id),
    );
    check(
      'the submission is linked to the match',
      koSubmission.submission.matchId === match.id,
    );
  }

  // ---- Disqualification is terminal ----
  {
    const target = await db.submission.findFirstOrThrow({
      where: { userId: rival.id, tournamentId: tournament.id },
    });
    const state = await disqualifySubmission(target.id, admin, 'test');
    check('an admin can disqualify an entry', state === 'DISQUALIFIED');
    await checkRejects(
      'a disqualified entry cannot be retried (typed CONFLICT, not a raw throw)',
      () => retryEvaluation(target.id, admin),
      'CONFLICT',
    );
    await checkRejects(
      'a disqualified entry cannot be resubmitted',
      () =>
        submitSolution({
          userId: rival.id,
          roundId: target.roundId,
          repoUrl: 'https://github.com/vercel/next.js',
          deploymentUrl: 'https://example.net',
        }),
      'CONFLICT',
    );
  }

  // ---- Listing ----
  const mySubs = await listMySubmissions(competitor.id);
  check('my submissions are listed newest first', mySubs.length >= 3);
  check(
    'every listed submission belongs to me',
    mySubs.every((s) => s.userId === competitor.id),
  );
  const allSubs = await listAllSubmissions(admin, {
    tournamentId: tournament.id,
  });
  const owners = new Set(allSubs.map((s) => s.userId));
  check(
    'an admin sees submissions from every competitor',
    owners.has(competitor.id) && owners.has(rival.id),
    `owners=${owners.size} submissions=${allSubs.length}`,
  );
}

async function main() {
  await cleanup();
  pureStateMachine();
  pureValidation();
  pureJobLifecycle();
  await pipeline();
  await cleanup();

  console.log(
    failures === 0
      ? '\nSubmission pipeline verified.'
      : `\n${failures} check(s) FAILED.`,
  );
}

main()
  .catch(async (error) => {
    console.error('\nFAIL —', error);
    failures++;
    await cleanup().catch(() => {});
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(failures > 0 ? 1 : 0);
  });

// Keep the Prisma type import meaningful for future filters.
export type { Prisma };
