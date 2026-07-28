import 'server-only';
import { db } from '@/server/db';
import {
  applyTransition,
  InvalidTransitionError,
  reconciliationPath,
  targetStatusFor,
} from '@/server/modules/tournament';
import { AppError } from '@/lib/errors';
import type { ClaimedJob } from '../queue';
import { logger } from '@/lib/logger';

/**
 * `reconcileTournament` job (D33).
 *
 * Brings one tournament to the state its schedule justifies, applying every
 * intervening transition **in a single pass**.
 *
 * ## Why one job and not one per transition
 *
 * The sweep used to enqueue a single `tournamentTransition` per tick, so a
 * tournament that had fallen several milestones behind — a server down
 * overnight, a schedule written in the past — crawled forward one step every
 * thirty seconds. Registration would open, and half a minute later close.
 * Spectators watched a tournament perform its own history in slow motion.
 *
 * Reconciling in one job makes the catch-up atomic from the outside: a
 * tournament that should be seeding by now becomes seeding, once, rather than
 * broadcasting four intermediate states nobody was ever meant to see.
 *
 * The intermediate transitions still all RUN. They are not ceremony — they are
 * the work. `CLOSE_REGISTRATION` creates the simulation rounds,
 * `CLOSE_SIMULATION` computes seeding, `GENERATE_BRACKET` writes the match
 * tree. Skipping any of them would produce a tournament in a state whose
 * preconditions had never been established.
 *
 * ## Stopping
 *
 * Convergence stops at the first transition that will not apply, and that is a
 * normal outcome rather than a failure:
 *
 *   - **A guard refuses** (too few registrations, evaluations still draining).
 *     The tournament stays where it is and the next sweep tries again. The
 *     reason is recorded on the job so the admin panel can show it instead of
 *     the operator needing SQL.
 *   - **The state moved underneath us** (an operator acted, a concurrent job
 *     won). Re-read and stop; the next pass sees the new truth.
 *
 * Only an unexpected error propagates, so the runner's retry policy applies to
 * genuine faults and not to "not yet".
 */
export async function reconcileTournamentProcessor(
  job: ClaimedJob,
): Promise<void> {
  const tournamentId =
    typeof job.payload.tournamentId === 'string'
      ? job.payload.tournamentId
      : null;
  if (!tournamentId) {
    throw new Error('reconcileTournament job is missing tournamentId');
  }

  const log = logger.child({ jobId: job.id, tournamentId });
  const now = new Date();

  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      status: true,
      currentStage: true,
      registrationOpensAt: true,
      registrationClosesAt: true,
      simulationOpensAt: true,
      simulationClosesAt: true,
      liveStartsAt: true,
    },
  });
  if (!tournament) {
    log.warn('tournament no longer exists; nothing to reconcile');
    return;
  }

  const target = targetStatusFor(tournament, now);
  const path = reconciliationPath(tournament, now);
  if (path.length === 0) return;

  log.info(
    { from: tournament.status, target, path },
    'reconciling tournament onto its schedule',
  );

  for (const transition of path) {
    try {
      const result = await applyTransition(tournamentId, transition, {
        runBy: 'schedule',
        actorId: null,
      });
      log.info(
        { transition, from: result.from, to: result.to },
        'reconciliation applied a transition',
      );
    } catch (error) {
      if (error instanceof InvalidTransitionError) {
        // Someone else moved it. Not a fault — the next pass re-reads.
        log.info(
          { transition, err: error.message },
          'tournament moved during reconciliation; stopping this pass',
        );
        return;
      }
      if (error instanceof AppError && error.code === 'CONFLICT') {
        // A business guard said "not yet". This is the expected way a
        // reconciliation stops short, and the message is the single most
        // useful thing an operator can be told — it is surfaced verbatim on
        // the admin lifecycle panel via `lastError`.
        log.warn(
          { transition, err: error.message },
          'reconciliation blocked by a guard; will retry on the next sweep',
        );
        throw error;
      }
      throw error;
    }
  }
}
