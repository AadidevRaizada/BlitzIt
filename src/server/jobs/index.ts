import 'server-only';
import { randomUUID } from 'node:crypto';
import { queue } from './pg-queue';

export { queue } from './pg-queue';
export { startRunner, runnerHeartbeat } from './runner';
export type { Queue, JobName, ClaimedJob, EnqueueOptions } from './queue';

/**
 * Enqueue a no-op job. Used to verify the job loop end-to-end (Milestone 0),
 * and by the health/dev tooling. Each call is a distinct job (random key).
 */
export function enqueueNoop(
  payload: Record<string, unknown> = {},
): Promise<string> {
  return queue.enqueue('noop', payload, {
    idempotencyKey: `noop:${randomUUID()}`,
  });
}

/**
 * Queue a submission for evaluation (E2). Idempotent per submission+attempt, so
 * a double-submit or duplicate enqueue collapses to one job.
 */
export function enqueueEvaluation(
  submissionId: string,
  attempt = 1,
): Promise<string> {
  return queue.enqueue(
    'evaluate',
    { submissionId },
    {
      idempotencyKey: `eval:${submissionId}:${attempt}`,
      priority: 10, // ahead of housekeeping jobs
    },
  );
}

/**
 * Queue a lifecycle transition (E3.2). The key mirrors the `OpsEvent` key the
 * transition itself uses, so scheduling the same change twice — a cron replay,
 * or an admin who also clicked the button — collapses to one job AND one
 * transition rather than two of each.
 *
 * `ADVANCE_STAGE` is the exception that has to be handled explicitly: it
 * happens ONCE PER STAGE, so it needs the stage in its key. A shared key would
 * be an upsert no-op in `PgQueue.enqueue`, and every stage advance after the
 * first would silently collapse into the first job and never run — the
 * tournament would simply stop at the first knockout round. Requiring
 * `fromState` makes that impossible to get wrong by omission.
 */
export function enqueueTournamentTransition(
  tournamentId: string,
  transition: string,
  options: {
    /** The lifecycle state the transition runs FROM. Required for ADVANCE_STAGE. */
    fromState?: string;
    actorId?: string | null;
    runBy?: string;
    reason?: string | null;
    force?: boolean;
    availableAt?: Date;
  } = {},
): Promise<string> {
  if (transition === 'ADVANCE_STAGE' && !options.fromState) {
    throw new Error(
      'enqueueTournamentTransition(ADVANCE_STAGE) requires `fromState`: ' +
        'without it every stage advance shares one idempotency key and only the first would run',
    );
  }

  // Mirrors `transitionIdempotencyKey` in the tournament module: stable across
  // the transition itself, and stage-scoped only where the transition repeats.
  const idempotencyKey =
    transition === 'ADVANCE_STAGE'
      ? `optransition:${tournamentId}:ADVANCE_STAGE:${options.fromState}`
      : `optransition:${tournamentId}:${transition}`;

  return queue.enqueue(
    'tournamentTransition',
    {
      tournamentId,
      transition,
      actorId: options.actorId ?? null,
      runBy: options.runBy ?? 'cron',
      reason: options.reason ?? null,
      force: options.force ?? false,
    },
    {
      idempotencyKey,
      priority: 20, // lifecycle changes gate everything else
      availableAt: options.availableAt,
    },
  );
}

/** Recompute seeding from persisted evaluations (E3 ops path). */
export function enqueueSeedTournament(
  tournamentId: string,
  attempt = 1,
): Promise<string> {
  return queue.enqueue(
    'seedTournament',
    { tournamentId },
    { idempotencyKey: `seed:${tournamentId}:${attempt}`, priority: 15 },
  );
}

/**
 * Run an advancement pass. Keyed per (tournament, round) so the many
 * evaluations finishing in one round collapse into a single pass instead of
 * one per submission.
 */
export function enqueueAdvanceBracket(
  tournamentId: string,
  roundId: string,
): Promise<string> {
  return queue.enqueue(
    'advanceBracket',
    { tournamentId, roundId },
    { idempotencyKey: `advance:${roundId}`, priority: 15 },
  );
}

// The deadline-driven counterpart lives in `progress-sweep` beside the sweep
// that calls it: the runner imports that module, so defining it here would
// close a cycle (runner → progress-sweep → index → runner).
export {
  enqueueRoundProgression,
  sweepExpiredRounds,
  findExpiredRounds,
  PROGRESSION_BUCKET_MS,
  SWEEP_INTERVAL_MS,
} from './progress-sweep';
