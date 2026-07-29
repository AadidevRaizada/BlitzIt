import 'server-only';
import { db } from '@/server/db';
import {
  applyTransition,
  INSUFFICIENT_REGISTRATIONS,
  InvalidTransitionError,
  reconciliationPath,
  targetStatusFor,
  type TournamentTransition,
} from '@/server/modules/tournament';
import { countCompetitionEligibleRegistrations } from '@/server/modules/tournament/registration';
import { resolveTournamentConfig } from '@/server/modules/tournament/config';
import { AppError } from '@/lib/errors';
import type { ClaimedJob } from '../queue';
import { enqueueCancellationCleanup } from '../progress-sweep';
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

  for (const planned of path) {
    let transition: TournamentTransition = planned;
    let reason: string | null = null;

    // D34 — a registration window that closes under-subscribed is a RESULT, not
    // a fault. Rather than attempt CLOSE_REGISTRATION and let its guard refuse
    // forever, decide here: too few eligible competitors means the tournament
    // cancels. The guard in `state.ts` still stands behind the manual path.
    if (planned === 'CLOSE_REGISTRATION') {
      const config = resolveTournamentConfig(tournament);
      const eligible = await countCompetitionEligibleRegistrations(
        tournamentId,
        db,
      );
      if (eligible < config.minRegistrations) {
        log.info(
          { eligible, required: config.minRegistrations },
          'registration closed under the minimum; cancelling instead of retrying forever',
        );
        transition = 'CANCEL';
        reason = INSUFFICIENT_REGISTRATIONS;
      }
    }

    try {
      const result = await applyTransition(tournamentId, transition, {
        runBy: 'schedule',
        actorId: null,
        reason,
      });
      log.info(
        { transition, from: result.from, to: result.to },
        'reconciliation applied a transition',
      );

      if (transition === 'CANCEL') {
        // Enqueue the follow-up here rather than waiting for the sweep to
        // notice. The sweep still looks for cancelled tournaments every tick and
        // is the safety net that covers an admin-initiated cancel, or a crash
        // between this commit and this enqueue — but it queries concurrently
        // with the transition sweep, so on the very tick a tournament cancels it
        // has already looked and found nothing. Relying on it alone left
        // competitors un-notified and un-refunded for a whole tick for no
        // reason. Same stable key, so the two paths collapse to one job.
        await enqueueCancellationCleanup(tournamentId);

        // CANCELLED is terminal (D34). Every remaining step in the path was
        // computed for a tournament that was going to close registration and
        // carry on; none of them are legal now. Stop rather than let the next
        // one throw and be logged as "someone else moved it".
        return;
      }
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
