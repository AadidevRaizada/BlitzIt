import 'server-only';
import {
  applyTransition,
  InvalidTransitionError,
  TOURNAMENT_TRANSITIONS,
  type TournamentTransition,
} from '@/server/modules/tournament';
import { AppError } from '@/lib/errors';
import type { ClaimedJob } from '../queue';
import { logger } from '@/lib/logger';

/**
 * `tournamentTransition` job (E3.2).
 *
 * Runs one lifecycle transition. Triggered by cron (the DB-authoritative
 * schedule) or by an admin who wants the change to happen out of band.
 *
 * The transition itself is already idempotent via its `OpsEvent` key, so a
 * retried or duplicated job converges instead of double-applying. What this
 * processor adds is retry *policy*: a transition that is illegal from the
 * current state will never become legal by retrying, so it completes rather
 * than burning attempts — the same rule E2 applies to an unsupported category.
 */
export async function tournamentTransitionProcessor(
  job: ClaimedJob,
): Promise<void> {
  const tournamentId =
    typeof job.payload.tournamentId === 'string'
      ? job.payload.tournamentId
      : null;
  const transition = job.payload.transition;

  if (!tournamentId) {
    throw new Error('tournamentTransition job is missing tournamentId');
  }
  if (
    typeof transition !== 'string' ||
    !(TOURNAMENT_TRANSITIONS as readonly string[]).includes(transition)
  ) {
    throw new Error(
      `tournamentTransition job has an unknown transition: ${String(transition)}`,
    );
  }

  const log = logger.child({ jobId: job.id, tournamentId, transition });

  try {
    const result = await applyTransition(
      tournamentId,
      transition as TournamentTransition,
      {
        runBy:
          typeof job.payload.runBy === 'string' ? job.payload.runBy : 'cron',
        actorId:
          typeof job.payload.actorId === 'string' ? job.payload.actorId : null,
        reason:
          typeof job.payload.reason === 'string' ? job.payload.reason : null,
        force: job.payload.force === true,
        // Reuse the job's own key so a scheduled OpsEvent and the job that runs
        // it are the same record rather than two views of one change.
        idempotencyKey:
          typeof job.payload.idempotencyKey === 'string'
            ? job.payload.idempotencyKey
            : undefined,
      },
    );

    log.info(
      { from: result.from, to: result.to, applied: result.applied },
      result.applied
        ? 'tournament transition applied'
        : 'tournament transition was already applied',
    );
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      // The tournament moved on (an admin did it by hand, or an earlier run of
      // this job succeeded and the state advanced). Retrying cannot help.
      log.warn(
        { err: error.message },
        'transition is no longer legal from the current state; not retrying',
      );
      return;
    }
    if (error instanceof AppError && error.code === 'CONFLICT') {
      // A business guard said "not yet" — e.g. evaluations still draining.
      // Retrying is exactly right here, so let the runner back off.
      log.warn({ err: error.message }, 'transition guard rejected; will retry');
    }
    throw error;
  }
}
