/**
 * The isomorphic half of the job lifecycle helpers (E4).
 *
 * Pure functions and constants only — no `server-only`, no Prisma client, no
 * database — so a client component can render a job's state without dragging
 * server code into the browser bundle. The server-side surface (and the
 * compile-time check that this mirror still matches the Prisma enum) lives in
 * `status.ts`.
 *
 * ## Why the last two states are derived, not stored
 *
 * The E4 brief asks for `queued · claimed · running · completed · failed ·
 * retry · dead-letter`. The persisted `JobStatus` enum (E0) has five values:
 *
 * | Lifecycle state    | Derived from                                            |
 * |--------------------|---------------------------------------------------------|
 * | `QUEUED`           | `status = QUEUED`, runnable now                          |
 * | `RETRY_SCHEDULED`  | `status = QUEUED`, `attempts > 0`, `availableAt` future   |
 * | `CLAIMED`          | `status = CLAIMED`                                       |
 * | `RUNNING`          | `status = RUNNING`                                       |
 * | `COMPLETED`        | `status = DONE`                                          |
 * | `FAILED`           | `status = FAILED`, attempts remain                       |
 * | `DEAD_LETTER`      | `status = FAILED`, `attempts >= maxAttempts`             |
 *
 * "Is this a retry?" is a question about `attempts` and `availableAt`.
 * Duplicating the answer into the enum would let the two disagree after a
 * stale-claim reclaim, and would mean a migration to the queue substrate that
 * E0/E2/E3 all depend on — for no new information.
 */

/** Mirror of the persisted `JobStatus` enum, usable on the client. */
export type PersistedJobStatus =
  'QUEUED' | 'CLAIMED' | 'RUNNING' | 'DONE' | 'FAILED';

export type JobLifecycleState =
  | 'QUEUED'
  | 'RETRY_SCHEDULED'
  | 'CLAIMED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'DEAD_LETTER';

/** Structural — anything shaped like a job row, including a plain object. */
export interface JobStatusSource {
  status: PersistedJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lastError: string | null;
}

export interface JobLifecycle {
  state: JobLifecycleState;
  attempts: number;
  maxAttempts: number;
  attemptsRemaining: number;
  /** When a retry becomes runnable. Null unless the state is RETRY_SCHEDULED. */
  nextAttemptAt: Date | null;
  /** True when nothing further will happen without operator action. */
  isTerminal: boolean;
  /** True while the job is expected to progress on its own. */
  isActive: boolean;
  lastError: string | null;
}

export function describeJob(
  job: JobStatusSource,
  now: Date = new Date(),
): JobLifecycle {
  const attemptsRemaining = Math.max(0, job.maxAttempts - job.attempts);
  const state = resolveState(job, now);

  return {
    state,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    attemptsRemaining,
    nextAttemptAt: state === 'RETRY_SCHEDULED' ? job.availableAt : null,
    isTerminal: state === 'COMPLETED' || state === 'DEAD_LETTER',
    isActive:
      state === 'QUEUED' ||
      state === 'RETRY_SCHEDULED' ||
      state === 'CLAIMED' ||
      state === 'RUNNING',
    lastError: job.lastError,
  };
}

function resolveState(job: JobStatusSource, now: Date): JobLifecycleState {
  switch (job.status) {
    case 'DONE':
      return 'COMPLETED';

    case 'FAILED':
      // The queue dead-letters by leaving the row FAILED once attempts are
      // spent; a FAILED row with attempts left was reclaimed, not abandoned.
      return job.attempts >= job.maxAttempts ? 'DEAD_LETTER' : 'FAILED';

    case 'CLAIMED':
      return 'CLAIMED';

    case 'RUNNING':
      return 'RUNNING';

    case 'QUEUED':
      // A future `availableAt` after at least one attempt is backoff.
      return job.attempts > 0 && job.availableAt > now
        ? 'RETRY_SCHEDULED'
        : 'QUEUED';

    default:
      return 'QUEUED';
  }
}

export const JOB_STATE_LABEL: Record<JobLifecycleState, string> = {
  QUEUED: 'Queued',
  RETRY_SCHEDULED: 'Retry scheduled',
  CLAIMED: 'Claimed',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  DEAD_LETTER: 'Failed permanently',
};
