import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { ClaimedJob, EnqueueOptions, JobName, Queue } from './queue';

/**
 * Postgres-backed Queue implementation (D3). Jobs are claimed atomically with
 * `FOR UPDATE SKIP LOCKED` so multiple runner loops (or a future extracted
 * worker) never process the same job twice. No Redis.
 */

interface ClaimRow {
  id: string;
  name: string;
  payload: Prisma.JsonValue | null;
  attempts: number;
  maxAttempts: number;
}

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
        payload: payload as Prisma.InputJsonValue,
        submissionId,
        idempotencyKey: options.idempotencyKey,
        priority: options.priority ?? 0,
        availableAt: options.availableAt ?? new Date(),
        maxAttempts: options.maxAttempts ?? 3,
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

  async complete(jobId: string): Promise<void> {
    await db.evaluationJob.update({
      where: { id: jobId },
      data: { status: 'DONE', updatedAt: new Date() },
    });
  }

  async fail(jobId: string, error: string, backoffMs: number): Promise<void> {
    const job = await db.evaluationJob.findUnique({
      where: { id: jobId },
      select: { attempts: true, maxAttempts: true },
    });
    if (!job) return;

    const exhausted = job.attempts >= job.maxAttempts;
    await db.evaluationJob.update({
      where: { id: jobId },
      data: exhausted
        ? { status: 'FAILED', lastError: error, updatedAt: new Date() }
        : {
            status: 'QUEUED',
            lastError: error,
            availableAt: new Date(Date.now() + backoffMs),
            lockedBy: null,
            updatedAt: new Date(),
          },
    });
  }
}

export const queue: Queue = new PgQueue();
