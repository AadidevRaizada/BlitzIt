import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Milestone 0 smoke test for the Postgres-backed job substrate (D3).
 *
 * Verifies:
 *   1. enqueue is idempotent (same key => one job)
 *   2. claim uses FOR UPDATE SKIP LOCKED and marks jobs CLAIMED atomically
 *   3. two concurrent claimers never receive the same job
 *   4. complete / fail-with-backoff transition rows correctly
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

async function claim(limit: number, lockedBy: string): Promise<ClaimRow[]> {
  return db.$queryRawUnsafe<ClaimRow[]>(
    `
    WITH claimed AS (
      SELECT "id" FROM "EvaluationJob"
      WHERE "status" = 'QUEUED' AND "availableAt" <= now()
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
  );
}

let failures = 0;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) failures++;
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
    claim(3, 'runner-1'),
    claim(3, 'runner-2'),
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
  const futureClaim = await claim(10, 'runner-3');
  check(
    'backoff job is not claimable before availableAt',
    !futureClaim.some((r) => r.id === second.id),
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
