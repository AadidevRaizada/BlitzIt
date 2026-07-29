import 'server-only';
import { db } from '@/server/db';
import { notifyTournamentCancelled } from '@/server/modules/tournament/notifications';
import { refundRegistrationPayments } from '@/server/modules/tournament/registration';
import type { ClaimedJob } from '../queue';
import { logger } from '@/lib/logger';

/**
 * What a cancellation owes people (D34).
 *
 * `CANCEL` itself only moves the tournament's state, inside a transaction. The
 * two things a cancellation actually owes its competitors — being told, and
 * being repaid — happen here instead, for the same reason notifications are
 * dispatched after commit rather than inside it: neither a mail provider nor a
 * payment gateway belongs in a database transaction, where their latency is held
 * open and their failure would roll back a state change that was correct.
 *
 * ## Idempotency
 *
 * Enqueued under the stable key `cancel-cleanup:{tournamentId}`, so it exists at
 * most once per tournament and retries are the runner's business. Both halves
 * tolerate being run again: notification intents collapse on their unique
 * `dedupeKey`, and each refund claims an idempotent intent before it calls the
 * gateway, so an already-refunded payment is a no-op rather than a second
 * transfer.
 *
 * ## Why it throws on a partial refund failure
 *
 * A tournament that has told everyone it is cancelled but has repaid only some
 * of them is not finished. Throwing puts the job back in the retry queue and —
 * because archival waits for this job to report DONE — keeps the tournament
 * visible on the admin panel with the gateway's own error attached, instead of
 * quietly filing it away still owing money.
 */
export async function cancelTournamentCleanupProcessor(
  job: ClaimedJob,
): Promise<void> {
  const tournamentId =
    typeof job.payload.tournamentId === 'string'
      ? job.payload.tournamentId
      : null;
  if (!tournamentId) {
    throw new Error('cancelTournamentCleanup job is missing tournamentId');
  }

  const log = logger.child({ jobId: job.id, tournamentId });

  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { status: true, cancellationReason: true },
  });
  if (!tournament) {
    log.warn('tournament no longer exists; nothing to clean up');
    return;
  }
  // Not an error worth retrying: the tournament is not cancelled, so there is
  // nothing owed. Returning marks the job DONE and stops the sweep re-offering.
  if (tournament.status !== 'CANCELLED') {
    log.warn(
      { status: tournament.status },
      'tournament is not cancelled; skipping cleanup',
    );
    return;
  }

  const reason = tournament.cancellationReason ?? 'Tournament cancelled';

  // Tell people first. If refunds then fail and the job retries, competitors
  // have at least already been told the tournament is off — which is the part
  // that changes what they do next.
  const notified = await notifyTournamentCancelled(tournamentId, db);
  log.info(
    { notified: notified.notified, emailsQueued: notified.emailsQueued },
    'cancellation notifications raised',
  );

  const refunds = await refundRegistrationPayments(tournamentId, reason, db);
  log.info(
    { refunded: refunds.refunded, failed: refunds.failed },
    'entry fee refunds processed',
  );

  if (refunds.failed > 0) {
    // The message becomes the job's `lastError`, which the admin panel shows
    // verbatim — so it has to name the payments, not just count them.
    throw new Error(
      `${refunds.failed} of ${refunds.refunded + refunds.failed} refund(s) failed: ` +
        refunds.failures.join('; '),
    );
  }
}
