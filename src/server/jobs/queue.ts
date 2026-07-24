import 'server-only';

/**
 * Queue abstraction (D3).
 *
 * V1 uses a Postgres-backed implementation (`pg-queue.ts`) claimed by an
 * in-process runner. This interface is the seam that lets us swap in Redis +
 * BullMQ later WITHOUT touching call sites. Do not leak implementation details
 * (Prisma models, SQL) through this interface.
 */

export type JobName = 'noop' | 'evaluate';

export interface EnqueueOptions {
  /** Idempotency key — duplicate enqueues with the same key collapse to one job. */
  idempotencyKey: string;
  /** Higher runs first. Default 0. */
  priority?: number;
  /** Earliest time the job may run (for backoff/scheduling). Default now. */
  availableAt?: Date;
  /** Max attempts before the job is marked FAILED. Default 3. */
  maxAttempts?: number;
}

export interface ClaimedJob {
  id: string;
  name: JobName;
  /** Domain payload (e.g. { submissionId }). Kept small; look up entities by id. */
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export interface Queue {
  /** Insert a job. Idempotent by `idempotencyKey`. Returns the job id. */
  enqueue(
    name: JobName,
    payload: Record<string, unknown>,
    options: EnqueueOptions,
  ): Promise<string>;

  /** Atomically claim up to `limit` runnable jobs (FOR UPDATE SKIP LOCKED). */
  claim(limit: number, lockedBy: string): Promise<ClaimedJob[]>;

  /** Mark a claimed job as successfully completed. */
  complete(jobId: string): Promise<void>;

  /**
   * Mark a claimed job as failed. If attempts remain, it is rescheduled with
   * backoff; otherwise it is marked FAILED (dead-letter).
   */
  fail(jobId: string, error: string, backoffMs: number): Promise<void>;
}

/** A processor handles one job name. Registered in `processors/index.ts`. */
export type JobProcessor = (job: ClaimedJob) => Promise<void>;
