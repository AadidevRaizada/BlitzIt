import 'server-only';
import type { JobName } from './queue';

export interface JobRetryPolicy {
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

export const JOB_RETRY_POLICIES: Record<JobName, JobRetryPolicy> = {
  noop: { maxAttempts: 1, baseBackoffMs: 0, maxBackoffMs: 0 },
  evaluate: { maxAttempts: 3, baseBackoffMs: 5_000, maxBackoffMs: 60_000 },
  tournamentTransition: {
    maxAttempts: 8,
    baseBackoffMs: 10_000,
    maxBackoffMs: 5 * 60_000,
  },
  // Few attempts on purpose. A reconciliation that stops short has almost
  // always hit a business guard ("too few registrations"), which no amount of
  // retrying inside one job will change — the sweep re-enqueues a fresh pass
  // every bucket anyway, and THAT is the retry loop. Burning eight attempts
  // here only buries the reason in a longer job history.
  reconcileTournament: {
    maxAttempts: 2,
    baseBackoffMs: 15_000,
    maxBackoffMs: 60_000,
  },
  seedTournament: {
    maxAttempts: 3,
    baseBackoffMs: 10_000,
    maxBackoffMs: 2 * 60_000,
  },
  advanceBracket: {
    maxAttempts: 5,
    baseBackoffMs: 10_000,
    maxBackoffMs: 2 * 60_000,
  },
  sendEmail: {
    maxAttempts: 4,
    baseBackoffMs: 30_000,
    maxBackoffMs: 10 * 60_000,
  },
  // D34: post-cancel cleanup (notify + refund). Retries allow for transient
  // failures in email delivery or payment gateway. Each retry is independent:
  // already-refunded payments no-op safely, and notifications dedupe by scopeId.
  cancelTournamentCleanup: {
    maxAttempts: 5,
    baseBackoffMs: 60_000,
    maxBackoffMs: 30 * 60_000,
  },
  // D35: bot submissions. Few attempts, short backoff — the sweep re-enqueues
  // on the next bucket while the round is still open, so THAT is the retry
  // loop, exactly as it is for reconciliation. A round that closes before a bot
  // submits is a no-show, which is a legitimate outcome rather than a failure.
  botSubmit: { maxAttempts: 2, baseBackoffMs: 5_000, maxBackoffMs: 30_000 },
};

export function retryPolicyFor(name: JobName): JobRetryPolicy {
  return JOB_RETRY_POLICIES[name];
}

export function backoffForAttempt(name: JobName, attempt: number): number {
  const policy = retryPolicyFor(name);
  if (policy.baseBackoffMs === 0) return 0;
  return Math.min(
    policy.maxBackoffMs,
    policy.baseBackoffMs * 2 ** Math.max(0, attempt - 1),
  );
}
