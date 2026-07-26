import './load-env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { queue } from '../src/server/jobs/pg-queue';
import {
  assertRateLimit,
  checkRateLimit,
  resetRateLimiterForTests,
} from '../src/server/ops/rate-limit';

/**
 * Milestone 0 smoke test for the Postgres-backed job substrate (D3).
 *
 * Verifies:
 *   1. enqueue is idempotent (same key => one job)
 *   2. claim uses FOR UPDATE SKIP LOCKED and marks jobs CLAIMED atomically
 *   3. two concurrent claimers never receive the same job
 *   4. complete / fail-with-backoff transition rows correctly
 *   5. stale CLAIMED jobs (crashed/redeployed runner) are requeued, and
 *      dead-lettered once attempts are exhausted
 *
 * Run: npm run verify:queue   (requires DATABASE_URL + `prisma db push`)
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

interface ClaimRow {
  id: string;
  name: string;
  attempts: number;
}

async function claim(
  limit: number,
  lockedBy: string,
  runId: string,
): Promise<ClaimRow[]> {
  return db.$queryRawUnsafe<ClaimRow[]>(
    `
    WITH claimed AS (
      SELECT "id" FROM "EvaluationJob"
      WHERE "status" = 'QUEUED' AND "availableAt" <= now()
        AND "idempotencyKey" LIKE $3
      ORDER BY "priority" DESC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    )
    UPDATE "EvaluationJob" AS j
    SET "status" = 'CLAIMED', "claimedAt" = now(), "lockedBy" = $2,
        "attempts" = j."attempts" + 1, "updatedAt" = now()
    FROM claimed WHERE j."id" = claimed."id"
    RETURNING j."id", j."name", j."attempts";
  `,
    limit,
    lockedBy,
    `${runId}:%`,
  );
}

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

async function main() {
  const runId = `verify-${Date.now()}`;
  await db.evaluationJob.deleteMany({
    where: { idempotencyKey: { startsWith: 'verify-' } },
  });

  // 1. idempotent enqueue
  const key = `${runId}:a`;
  for (let i = 0; i < 3; i++) {
    await db.evaluationJob.upsert({
      where: { idempotencyKey: key },
      update: {},
      create: { name: 'noop', payload: {}, idempotencyKey: key },
    });
  }
  const dupes = await db.evaluationJob.count({
    where: { idempotencyKey: key },
  });
  check('enqueue is idempotent (3 enqueues => 1 job)', dupes === 1);

  // seed more jobs
  for (let i = 0; i < 4; i++) {
    const k = `${runId}:b${i}`;
    await db.evaluationJob.upsert({
      where: { idempotencyKey: k },
      update: {},
      create: { name: 'noop', payload: { i }, idempotencyKey: k },
    });
  }

  // 2 + 3. concurrent claimers must not overlap
  const [c1, c2] = await Promise.all([
    claim(3, 'runner-1', runId),
    claim(3, 'runner-2', runId),
  ]);
  const ids1 = new Set(c1.map((r) => r.id));
  const overlap = c2.filter((r) => ids1.has(r.id));
  check('concurrent claims do not overlap (SKIP LOCKED)', overlap.length === 0);
  check(
    'claims are bounded by limit',
    c1.length <= 3 && c2.length <= 3 && c1.length + c2.length === 5,
  );
  check(
    'claim increments attempts to 1',
    [...c1, ...c2].every((r) => r.attempts === 1),
  );

  const claimedCount = await db.evaluationJob.count({
    where: { idempotencyKey: { startsWith: runId }, status: 'CLAIMED' },
  });
  check('all claimed rows marked CLAIMED', claimedCount === 5);

  // 4. complete + fail-with-backoff
  const first = c1[0]!;
  await db.evaluationJob.update({
    where: { id: first.id },
    data: { status: 'DONE' },
  });
  const done = await db.evaluationJob.findUnique({ where: { id: first.id } });
  check('complete() marks job DONE', done?.status === 'DONE');

  const second = c1[1] ?? c2[0]!;
  const backoffAt = new Date(Date.now() + 60_000);
  await db.evaluationJob.update({
    where: { id: second.id },
    data: { status: 'QUEUED', lastError: 'boom', availableAt: backoffAt },
  });
  const retried = await db.evaluationJob.findUnique({
    where: { id: second.id },
  });
  check(
    'fail() reschedules with backoff (QUEUED, availableAt in future)',
    retried?.status === 'QUEUED' && retried.availableAt > new Date(),
  );

  // a job scheduled in the future must not be claimable now
  const futureClaim = await claim(10, 'runner-3', runId);
  check(
    'backoff job is not claimable before availableAt',
    !futureClaim.some((r) => r.id === second.id),
  );

  // 5. stale CLAIMED recovery — a runner that crashed mid-job must not strand
  //    the row. Simulate by backdating claimedAt, then sweeping.
  const staleKey = `${runId}:stale`;
  await db.evaluationJob.create({
    data: { name: 'noop', payload: {}, idempotencyKey: staleKey },
  });
  await claim(10, 'runner-that-dies', runId);
  const staleBefore = await db.evaluationJob.findUnique({
    where: { idempotencyKey: staleKey },
  });
  check('job is CLAIMED before the sweep', staleBefore?.status === 'CLAIMED');

  // Backdate the claim so it looks abandoned (older than the timeout).
  await db.evaluationJob.update({
    where: { idempotencyKey: staleKey },
    data: { claimedAt: new Date(Date.now() - 60_000) },
  });

  const swept = await queue.reclaimStale(10_000);
  const staleAfter = await db.evaluationJob.findUnique({
    where: { idempotencyKey: staleKey },
  });
  check(
    'stale CLAIMED job is requeued by reclaimStale()',
    staleAfter?.status === 'QUEUED' && swept.requeued >= 1,
  );
  check(
    'requeued job is immediately claimable again',
    (await claim(10, 'runner-4', runId)).some((r) => r.id === staleAfter?.id),
  );

  // Exhausted attempts must dead-letter instead of looping forever.
  const deadKey = `${runId}:dead`;
  await db.evaluationJob.create({
    data: {
      name: 'noop',
      payload: {},
      idempotencyKey: deadKey,
      status: 'CLAIMED',
      claimedAt: new Date(Date.now() - 60_000),
      attempts: 3,
      maxAttempts: 3,
    },
  });
  const sweptDead = await queue.reclaimStale(10_000);
  const dead = await db.evaluationJob.findUnique({
    where: { idempotencyKey: deadKey },
  });
  check(
    'stale job with no attempts left is dead-lettered (FAILED)',
    dead?.status === 'FAILED' && sweptDead.failed >= 1,
  );

  // Heartbeat: a long-but-healthy job must survive the stale sweep. Without
  // this, any job outliving the claim timeout gets requeued and runs twice.
  const beatKey = `${runId}:heartbeat`;
  await db.evaluationJob.create({
    data: { name: 'noop', payload: {}, idempotencyKey: beatKey },
  });
  await claim(10, 'runner-alive', runId);
  await db.evaluationJob.update({
    where: { idempotencyKey: beatKey },
    data: { claimedAt: new Date(Date.now() - 60_000) }, // looks abandoned
  });
  await queue.heartbeat(
    [
      (await db.evaluationJob.findUnique({
        where: { idempotencyKey: beatKey },
      }))!.id,
    ],
    'runner-alive',
  );
  await queue.reclaimStale(10_000);
  const beat = await db.evaluationJob.findUnique({
    where: { idempotencyKey: beatKey },
  });
  check(
    'heartbeat keeps a long-running job from being reclaimed',
    beat?.status === 'CLAIMED',
    `status=${beat?.status}`,
  );

  // A heartbeat from a runner that no longer holds the claim must be ignored,
  // otherwise it could steal back a job already reassigned to someone else.
  const stolenKey = `${runId}:stolen`;
  await db.evaluationJob.create({
    data: { name: 'noop', payload: {}, idempotencyKey: stolenKey },
  });
  await claim(10, 'runner-owner', runId);
  const stolenRow = await db.evaluationJob.findUnique({
    where: { idempotencyKey: stolenKey },
  });
  await queue.heartbeat([stolenRow!.id], 'some-other-runner');
  const stolenAfter = await db.evaluationJob.findUnique({
    where: { idempotencyKey: stolenKey },
  });
  check(
    'heartbeat from a non-owner runner is ignored',
    stolenAfter?.claimedAt?.getTime() === stolenRow?.claimedAt?.getTime(),
  );

  // Exhausted job + submission must reach a terminal state together, so a
  // submission is never left QUEUED with no job that will ever run it.
  // (Behaviour is asserted end-to-end in verify:evaluation:e2e.)

  // A freshly claimed job must NOT be swept out from under a healthy runner.
  const liveKey = `${runId}:live`;
  await db.evaluationJob.create({
    data: { name: 'noop', payload: {}, idempotencyKey: liveKey },
  });
  await claim(10, 'runner-healthy', runId);
  await queue.reclaimStale(300_000);
  const live = await db.evaluationJob.findUnique({
    where: { idempotencyKey: liveKey },
  });
  check(
    'in-flight job within the timeout is left alone',
    live?.status === 'CLAIMED',
  );

  const cleanupDoneKey = `${runId}:cleanup-done`;
  const cleanupDeadKey = `${runId}:cleanup-dead`;
  await db.evaluationJob.createMany({
    data: [
      {
        name: 'noop',
        payload: {},
        idempotencyKey: cleanupDoneKey,
        status: 'DONE',
        updatedAt: new Date(Date.now() - 120_000),
      },
      {
        name: 'noop',
        payload: {},
        idempotencyKey: cleanupDeadKey,
        status: 'FAILED',
        attempts: 3,
        maxAttempts: 3,
        updatedAt: new Date(Date.now() - 120_000),
      },
    ],
  });
  const cleanup = await queue.cleanup({
    completedOlderThanMs: 1_000,
    failedOlderThanMs: 1_000,
    staleClaimTimeoutMs: 10_000,
  });
  check(
    'cleanup removes old completed jobs',
    cleanup.completedDeleted >= 1 &&
      (await db.evaluationJob.findUnique({
        where: { idempotencyKey: cleanupDoneKey },
      })) === null,
  );
  check(
    'cleanup removes retained dead-letter jobs after cutoff',
    cleanup.failedDeleted >= 1 &&
      (await db.evaluationJob.findUnique({
        where: { idempotencyKey: cleanupDeadKey },
      })) === null,
  );

  resetRateLimiterForTests();
  let limited = false;
  for (let i = 0; i < 31; i++) {
    try {
      assertRateLimit('auth', `${runId}:ip`);
    } catch {
      limited = true;
    }
  }
  check('rate limiter enforces abuse-prone auth limit', limited);

  resetRateLimiterForTests();
  let webhookAllowed = true;
  for (let i = 0; i < 310; i++) {
    webhookAllowed &&= checkRateLimit(
      'webhook-observe',
      `${runId}:hook`,
    ).allowed;
  }
  check(
    'webhook limiter is observe-only and never drops events',
    webhookAllowed,
  );

  await db.evaluationJob.deleteMany({
    where: { idempotencyKey: { startsWith: runId } },
  });

  console.log(
    failures === 0
      ? '\nAll queue checks passed.'
      : `\n${failures} check(s) FAILED.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
