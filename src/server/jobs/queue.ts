import 'server-only';

/**
 * Queue abstraction (D3).
 *
 * V1 uses a Postgres-backed implementation (`pg-queue.ts`) claimed by an
 * in-process runner. This interface is the seam that lets us swap in Redis +
 * BullMQ later WITHOUT touching call sites. Do not leak implementation details
 * (Prisma models, SQL) through this interface.
 */

export type JobName =
  | 'noop'
  | 'evaluate'
  // E3 — tournament lifecycle. `tournamentTransition` runs a scheduled or
  // admin-requested state change; `seedTournament` and `advanceBracket` are
  // the two long-running steps that must survive a restart.
  | 'tournamentTransition'
  | 'seedTournament'
  | 'advanceBracket'
  // E8 — deliver one notification over email. The queue is the only path from
  // a notification intent to a send, so no business module ever waits on a
  // mail provider.
  | 'sendEmail';

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

  /**
   * Recover jobs abandoned mid-flight (process crash, redeploy, OOM). A job
   * claimed longer ago than `timeoutMs` is requeued so another runner picks it
   * up — or dead-lettered if it has exhausted `maxAttempts`. Without this,
   * CLAIMED rows are invisible to future claims and strand forever.
   *
   * Returns how many jobs were requeued vs dead-lettered.
   */
  reclaimStale(
    timeoutMs: number,
  ): Promise<{ requeued: number; failed: number }>;

  /**
   * Refresh the claim on in-flight jobs so a long-but-healthy job is never
   * mistaken for an abandoned one. Without this, any job outliving the claim
   * timeout would be requeued and executed a second time — concurrently, even
   * with a single runner. Only jobs still held by `lockedBy` are refreshed, so
   * a runner cannot resurrect a claim that was already reclaimed from it.
   */
  heartbeat(jobIds: string[], lockedBy: string): Promise<void>;
}

/** A processor handles one job name. Registered in `processors/index.ts`. */
export type JobProcessor = (job: ClaimedJob) => Promise<void>;
