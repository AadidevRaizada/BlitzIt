import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { ClaimedJob, EnqueueOptions, JobName, Queue } from './queue';
import { retryPolicyFor } from './retry-policy';

/**
 * Postgres-backed Queue implementation (D3). Jobs are claimed atomically with
 * `FOR UPDATE SKIP LOCKED` so multiple runner loops (or a future extracted
 * worker) never process the same job twice. No Redis.
 */

/** Recorded on `lastError` when a job is recovered from an abandoned claim. */
export const STALE_CLAIM_ERROR =
  'Reclaimed: claim expired (runner crashed, redeployed, or stalled)';

interface ClaimRow {
  id: string;
  name: string;
  payload: Prisma.JsonValue | null;
  attempts: number;
  maxAttempts: number;
}

/**
 * The persisted `JobType` for a job name.
 *
 * `name` is what the runner dispatches on; `type` is the coarse enum stored
 * alongside it for reporting. Deriving it here rather than asking every call
 * site keeps the two from disagreeing. Anything without an explicit mapping
 * stays `EVALUATE`, which is the column's default and what every pre-E8 row
 * already carries.
 */
const JOB_TYPE_BY_NAME: Partial<Record<JobName, 'EVALUATE' | 'SEND_EMAIL'>> = {
  sendEmail: 'SEND_EMAIL',
};

export class PgQueue implements Queue {
  async enqueue(
    name: JobName,
    payload: Record<string, unknown>,
    options: EnqueueOptions,
  ): Promise<string> {
    const submissionId =
      typeof payload.submissionId === 'string' ? payload.submissionId : null;

    const job = await db.evaluationJob.upsert({
      where: { idempotencyKey: options.idempotencyKey },
      // Duplicate enqueue with the same key is a no-op (collapses to one job).
      update: {},
      create: {
        name,
        type: JOB_TYPE_BY_NAME[name] ?? 'EVALUATE',
        payload: payload as Prisma.InputJsonValue,
        submissionId,
        idempotencyKey: options.idempotencyKey,
        priority: options.priority ?? 0,
        availableAt: options.availableAt ?? new Date(),
        maxAttempts: options.maxAttempts ?? retryPolicyFor(name).maxAttempts,
      },
      select: { id: true },
    });
    return job.id;
  }

  async claim(limit: number, lockedBy: string): Promise<ClaimedJob[]> {
    const rows = await db.$queryRaw<ClaimRow[]>(Prisma.sql`
      WITH claimed AS (
        SELECT "id"
        FROM "EvaluationJob"
        WHERE "status" = 'QUEUED' AND "availableAt" <= now()
        ORDER BY "priority" DESC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "EvaluationJob" AS j
      SET "status" = 'CLAIMED',
          "claimedAt" = now(),
          "lockedBy" = ${lockedBy},
          "attempts" = j."attempts" + 1,
          "updatedAt" = now()
      FROM claimed
      WHERE j."id" = claimed."id"
      RETURNING j."id", j."name", j."payload", j."attempts", j."maxAttempts";
    `);

    return rows.map((r) => ({
      id: r.id,
      name: r.name as JobName,
      payload: (r.payload as Record<string, unknown> | null) ?? {},
      attempts: r.attempts,
      maxAttempts: r.maxAttempts,
    }));
  }

  async complete(jobId: string, lockedBy?: string): Promise<void> {
    await db.evaluationJob.updateMany({
      where: {
        id: jobId,
        ...(lockedBy
          ? { lockedBy, status: { in: ['CLAIMED', 'RUNNING'] } }
          : {}),
      },
      data: {
        status: 'DONE',
        lockedBy: null,
        claimedAt: null,
        updatedAt: new Date(),
      },
    });
  }

  async reclaimStale(
    timeoutMs: number,
  ): Promise<{ requeued: number; failed: number }> {
    const seconds = Math.max(1, Math.floor(timeoutMs / 1000));

    // A single atomic UPDATE: rows are locked as they are matched, so
    // concurrent runners re-evaluate the WHERE clause and never double-apply.
    // Jobs with attempts left go back to QUEUED; exhausted ones dead-letter.
    const rows = await db.$queryRaw<{ status: string }[]>(Prisma.sql`
      UPDATE "EvaluationJob"
      SET "status" = CASE
            WHEN "attempts" >= "maxAttempts" THEN 'FAILED'::"JobStatus"
            ELSE 'QUEUED'::"JobStatus"
          END,
          "lockedBy" = NULL,
          "claimedAt" = NULL,
          "availableAt" = now(),
          "lastError" = ${STALE_CLAIM_ERROR},
          "updatedAt" = now()
      WHERE "status" IN ('CLAIMED', 'RUNNING')
        AND "claimedAt" IS NOT NULL
        AND "claimedAt" < now() - make_interval(secs => ${seconds}::double precision)
      RETURNING "status";
    `);

    let requeued = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.status === 'FAILED') failed++;
      else requeued++;
    }
    return { requeued, failed };
  }

  async heartbeat(jobIds: string[], lockedBy: string): Promise<void> {
    if (jobIds.length === 0) return;
    // Scoped to this runner's own claims: if a sweep already took the job away,
    // `lockedBy` no longer matches and the heartbeat is a no-op rather than
    // stealing it back.
    await db.evaluationJob.updateMany({
      where: {
        id: { in: jobIds },
        lockedBy,
        status: { in: ['CLAIMED', 'RUNNING'] },
      },
      data: { claimedAt: new Date(), updatedAt: new Date() },
    });
  }

  async fail(
    jobId: string,
    error: string,
    backoffMs: number,
    lockedBy?: string,
  ): Promise<void> {
    const job = await db.evaluationJob.findUnique({
      where: { id: jobId },
      select: { attempts: true, maxAttempts: true, lockedBy: true },
    });
    if (!job) return;
    if (lockedBy && job.lockedBy !== lockedBy) return;

    const exhausted = job.attempts >= job.maxAttempts;
    await db.evaluationJob.updateMany({
      where: { id: jobId, ...(lockedBy ? { lockedBy } : {}) },
      data: exhausted
        ? {
            status: 'FAILED',
            lastError: error,
            lockedBy: null,
            claimedAt: null,
            updatedAt: new Date(),
          }
        : {
            status: 'QUEUED',
            lastError: error,
            availableAt: new Date(Date.now() + backoffMs),
            lockedBy: null,
            updatedAt: new Date(),
          },
    });
  }

  async cleanup(
    options: {
      completedOlderThanMs?: number;
      failedOlderThanMs?: number;
      staleClaimTimeoutMs?: number;
    } = {},
  ): Promise<{
    completedDeleted: number;
    failedDeleted: number;
    staleRequeued: number;
    staleFailed: number;
  }> {
    const stale = await this.reclaimStale(
      options.staleClaimTimeoutMs ?? 15 * 60_000,
    );
    const completedCutoff = new Date(
      Date.now() - (options.completedOlderThanMs ?? 24 * 60 * 60_000),
    );
    const failedCutoff = new Date(
      Date.now() - (options.failedOlderThanMs ?? 30 * 24 * 60 * 60_000),
    );

    const [completedDeleted, failedDeleted] = await Promise.all([
      db.evaluationJob.deleteMany({
        where: { status: 'DONE', updatedAt: { lt: completedCutoff } },
      }),
      db.evaluationJob.deleteMany({
        where: { status: 'FAILED', updatedAt: { lt: failedCutoff } },
      }),
    ]);

    return {
      completedDeleted: completedDeleted.count,
      failedDeleted: failedDeleted.count,
      staleRequeued: stale.requeued,
      staleFailed: stale.failed,
    };
  }
}

export const queue: Queue = new PgQueue();
