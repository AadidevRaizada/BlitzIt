import './load-env';
import { queue } from '../src/server/jobs/pg-queue';
import { processors } from '../src/server/jobs/processors';
import { startRunner } from '../src/server/jobs/runner';
import { db } from '../src/server/db';

/**
 * Milestone 0 acceptance check (E0.5 DoD): prove the Postgres-backed job loop.
 *
 * Runs the REAL runner (not a manual claim) and asserts that:
 *   - queued jobs are claimed via FOR UPDATE SKIP LOCKED and driven to DONE
 *   - each job's processor actually executed
 *   - a job whose processor throws is retried/dead-lettered, never dropped
 *
 * Prerequisites: DATABASE_URL set + schema applied (`npx prisma db push`).
 * Run: npm run verify:runner
 */

let failures = 0;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const runId = `verify-runner-${Date.now()}`;
  await db.evaluationJob.deleteMany({
    where: { idempotencyKey: { startsWith: 'verify-runner-' } },
  });

  // Count real processor executions, and register a always-throwing processor
  // to exercise the retry/backoff path.
  let noopRuns = 0;
  const realNoop = processors.noop!;
  processors.noop = async (job) => {
    noopRuns++;
    await realNoop(job);
  };
  processors.evaluate = async () => {
    throw new Error('intentional failure');
  };

  const goodKeys = [0, 1, 2].map((i) => `${runId}:ok${i}`);
  for (const key of goodKeys) {
    await queue.enqueue('noop', { key }, { idempotencyKey: key });
  }
  const badKey = `${runId}:bad`;
  await queue.enqueue(
    'evaluate',
    { key: badKey },
    { idempotencyKey: badKey, maxAttempts: 2 },
  );

  startRunner();

  const deadline = Date.now() + 30_000;
  let doneCount = 0;
  while (Date.now() < deadline) {
    doneCount = await db.evaluationJob.count({
      where: { idempotencyKey: { in: goodKeys }, status: 'DONE' },
    });
    if (doneCount === goodKeys.length) break;
    await sleep(500);
  }

  check('runner claims and completes queued jobs', doneCount === 3);
  check('processor actually executed for each job', noopRuns >= 3);

  const bad = await db.evaluationJob.findUnique({
    where: { idempotencyKey: badKey },
  });
  check(
    'failing job records its error',
    bad?.lastError?.includes('intentional') === true,
  );
  check(
    'failing job is retried or dead-lettered, never silently dropped',
    bad?.status === 'QUEUED' || bad?.status === 'FAILED',
  );
  check('failing job incremented attempts', (bad?.attempts ?? 0) >= 1);

  await db.evaluationJob.deleteMany({
    where: { idempotencyKey: { startsWith: runId } },
  });

  console.log(
    failures === 0
      ? '\nRunner verified end-to-end.'
      : `\n${failures} check(s) FAILED.`,
  );
}

main()
  .catch((e) => {
    console.error('\nFAIL —', e);
    failures++;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(failures > 0 ? 1 : 0);
  });
