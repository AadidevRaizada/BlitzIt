import 'server-only';
import { db } from '@/server/db';
import { logger } from '@/lib/logger';
import { queue } from './pg-queue';
import {
  AUTOMATED_STATUSES,
  reconciliationPath,
} from '@/server/modules/tournament/schedule.public';
import { AUTOMATION_ACTOR } from '@/server/modules/auth/roles';

/**
 * Deadline sweep — the trigger that makes the tournament run itself.
 *
 * Two kinds of "due" pass through here, on one timer:
 *
 *   1. **Round windows.** A round whose `deadlineAt` has passed needs sealing
 *      and advancing.
 *   2. **Lifecycle milestones.** A tournament whose `registrationOpensAt` (or
 *      any other schedule anchor) has passed needs its transition applied.
 *
 * The second was missing entirely. The schedule columns were read as gates —
 * "you may not register yet" — but nothing ever noticed the gate had opened, so
 * a tournament sat in PUBLISHED while the public page counted down to an event
 * no code was going to cause. See `schedule.public.ts` for the mapping.
 *
 * ## Why this exists
 *
 * A round's deadline is an instant in the database, not an event. Something has
 * to notice that it has passed. Until this sweep, nothing did: the queue, the
 * runner and the `advanceBracket` processor were all built and healthy, but no
 * code ever produced the job they were waiting for, so a simulation round sat
 * OPEN past its deadline forever and the rounds behind it never started.
 *
 * ## Why not Railway Cron
 *
 * The architecture originally called for it (`docs/01-technical-architecture.md`),
 * and it cannot work for this. Railway's minimum cron interval is 5 minutes, and
 * a cron service must terminate when its task finishes — which a Next.js server
 * with an in-process runner never does, so it would need a second service. The
 * shortest rounds are 600s (simulation round 3, and sudden death), where a
 * 5-minute lag is half the round. Coarse, day-scale transitions could still be
 * cron's job; round boundaries never could. See `docs/DECISIONS.md`.
 *
 * ## What it does and does not do
 *
 * It only ever *enqueues*. Deciding matches, closing rounds and advancing the
 * lifecycle stay in the `advanceBracket` processor, where they run under the
 * runner's concurrency cap and retry policy. That keeps a single path into
 * progression rather than a second one that bypasses the queue.
 */

/** How often the sweep looks for expired windows. */
export const SWEEP_INTERVAL_MS = 30_000;

/** Cadence of the sweep's idempotency bucket, in milliseconds. */
export const PROGRESSION_BUCKET_MS = 60_000;

/**
 * Idempotency bucket for LIFECYCLE transitions — deliberately coarser than the
 * round bucket.
 *
 * The bucket does not delay the first attempt: the sweep enqueues on its next
 * tick after the anchor passes, so latency is still bounded by
 * `SWEEP_INTERVAL_MS`. What it controls is the RETRY cadence when a guard keeps
 * refusing — waiting for evaluations to drain, or for an operator to attach a
 * problem to a round. Five minutes keeps the operator's job list readable while
 * staying far below the scale a schedule milestone is measured in.
 *
 * The example this constant was originally written for — a window closing with 3
 * competitors against a minimum of 8, failing every attempt all night — is no
 * longer reachable from the schedule: D34 makes that outcome a cancellation
 * rather than an indefinite retry.
 */
export const LIFECYCLE_BUCKET_MS = 300_000;

/**
 * How long a cancelled tournament stays visible before it is archived (D34).
 *
 * Long enough for the cancellation email to land and a refund to settle, so the
 * first thing a competitor does after reading "cancelled" is not hunting for a
 * tournament page that has already vanished.
 */
export const ARCHIVE_GRACE_MS = 24 * 60 * 60_000;

/**
 * Enqueue an advancement pass for a round whose deadline has passed.
 *
 * This cannot reuse `enqueueAdvanceBracket`: that key is permanent per round
 * (`advance:{roundId}`) and a duplicate enqueue is an upsert no-op, so a sweep
 * sharing it would fire once per round *ever* — and if that single pass ran with
 * nothing yet to do, the key would be spent and the round could never advance.
 * Bucketing by minute re-arms the trigger each minute while still collapsing
 * concurrent replicas within the same minute into one row, via the unique index
 * on `idempotencyKey`.
 */
export function enqueueRoundProgression(
  tournamentId: string,
  roundId: string,
  now: Date = new Date(),
): Promise<string> {
  const bucket = Math.floor(now.getTime() / PROGRESSION_BUCKET_MS);
  return queue.enqueue(
    'advanceBracket',
    { tournamentId, roundId },
    { idempotencyKey: `progress:${roundId}:${bucket}`, priority: 15 },
  );
}

interface ExpiredRound {
  roundId: string;
  tournamentId: string;
}

/**
 * Rounds that are open but whose deadline has passed, in tournaments still in
 * play. `now()` is the database's clock, not this process's — the same clock
 * that wrote the deadline.
 */
export async function findExpiredRounds(): Promise<ExpiredRound[]> {
  return db.$queryRaw<ExpiredRound[]>`
    SELECT r."id" AS "roundId", r."tournamentId"
    FROM "Round" r
    JOIN "Tournament" t ON t."id" = r."tournamentId"
    WHERE t."status" IN ('SIMULATION', 'LIVE')
      AND r."status" = 'OPEN'
      AND r."deadlineAt" IS NOT NULL
      AND r."deadlineAt" <= now()
  `;
}

/**
 * One pass. Returns how many rounds were enqueued, so a caller (and the
 * verification suite) can assert on it.
 */
export async function sweepExpiredRounds(): Promise<number> {
  const expired = await findExpiredRounds();
  if (expired.length === 0) return 0;

  let enqueued = 0;
  for (const round of expired) {
    try {
      await enqueueRoundProgression(round.tournamentId, round.roundId);
      enqueued++;
    } catch (error) {
      // One unhealthy tournament must not stop the others, nor the sweep.
      logger.error(
        {
          err: error,
          tournamentId: round.tournamentId,
          roundId: round.roundId,
        },
        'failed to enqueue round progression',
      );
    }
  }

  if (enqueued > 0) {
    logger.info({ enqueued }, 'deadline sweep enqueued progression passes');
  }
  return enqueued;
}

// ---------------------------------------------------------------------------
// Lifecycle transitions on the schedule
// ---------------------------------------------------------------------------

/**
 * Enqueue a reconciliation pass.
 *
 * One job per tournament, not one per transition. The job works out the whole
 * path itself and applies it in a single pass, which is what stops a tournament
 * that has fallen behind from performing its own history one milestone every
 * thirty seconds.
 *
 * The key therefore carries no transition name: "reconcile this tournament" is
 * the whole instruction, so two sweeps in the same bucket asking for it are
 * genuinely the same request.
 */
export function enqueueReconciliation(
  tournamentId: string,
  now: Date = new Date(),
): Promise<string> {
  const bucket = Math.floor(now.getTime() / LIFECYCLE_BUCKET_MS);
  return queue.enqueue(
    'reconcileTournament',
    { tournamentId },
    {
      idempotencyKey: `reconcile:${tournamentId}:${bucket}`,
      // Above round progression: a phase boundary gates everything behind it,
      // and a tournament that cannot start makes every round job moot.
      priority: 20,
    },
  );
}

/**
 * Tournaments whose stored status has fallen behind their schedule.
 *
 * The candidate set is narrowed in SQL — only non-archived tournaments in a
 * status the schedule drives — and the decision is made in TypeScript by
 * `reconciliationPath`, the same pure function the processor and the admin UI
 * read. Encoding the mapping twice, once as SQL and once as a switch, is
 * exactly how the UI and the engine drifted apart in the first place.
 *
 * The row count here is bounded by the number of live tournaments, which is a
 * handful — this is not a table scan worth optimising into SQL.
 */
export async function findDriftedTournaments(
  now: Date = new Date(),
): Promise<string[]> {
  const candidates = await db.tournament.findMany({
    where: {
      status: { in: [...AUTOMATED_STATUSES] },
      archivedAt: null,
    },
    select: {
      id: true,
      status: true,
      currentStage: true,
      registrationOpensAt: true,
      registrationClosesAt: true,
      simulationOpensAt: true,
      simulationClosesAt: true,
      liveStartsAt: true,
    },
  });

  return candidates
    .filter((tournament) => reconciliationPath(tournament, now).length > 0)
    .map((tournament) => tournament.id);
}

/**
 * One lifecycle pass. Returns how many reconciliations were enqueued so the
 * verification suite can assert on it.
 */
export async function sweepDueTransitions(
  now: Date = new Date(),
): Promise<number> {
  const drifted = await findDriftedTournaments(now);
  if (drifted.length === 0) return 0;

  let enqueued = 0;
  for (const tournamentId of drifted) {
    try {
      await enqueueReconciliation(tournamentId, now);
      enqueued++;
    } catch (error) {
      // One unhealthy tournament must not stop the others, nor the sweep.
      logger.error(
        { err: error, tournamentId },
        'failed to enqueue tournament reconciliation',
      );
    }
  }

  if (enqueued > 0) {
    logger.info({ enqueued }, 'schedule sweep enqueued reconciliations');
  }
  return enqueued;
}

/**
 * Enqueue cleanup jobs for cancelled tournaments (D34).
 *
 * When a tournament reaches CANCELLED, a follow-up cleanup job handles:
 * - Notifying every registered competitor
 * - Refunding all paid entry fees
 *
 * After the cleanup completes, the tournament auto-archives 24 hours later
 * (via the archival sweep below). This gives refunds time to clear.
 */
/**
 * Enqueue the notify-and-refund follow-up for a cancelled tournament (D34).
 *
 * Shared by the reconciler, which calls it the instant a cancellation commits,
 * and by the sweep below, which is the safety net. Both use the same stable key
 * so the two paths can never produce two jobs.
 */
export async function enqueueCancellationCleanup(
  tournamentId: string,
): Promise<void> {
  await queue.enqueue(
    'cancelTournamentCleanup',
    { tournamentId },
    {
      // Stable, unbucketed: `enqueue` upserts with `update: {}`, so once this
      // job exists — queued, running or DONE — enqueueing again is a no-op.
      // Retries belong to the runner's retry policy, not to the caller.
      idempotencyKey: `cancel-cleanup:${tournamentId}`,
      // Ahead of routine progression: this one owes people money.
      priority: 10,
    },
  );
}

async function sweepCancelledTournaments(): Promise<number> {
  // Selected by STATE, not by a recency window. An earlier version asked for
  // tournaments cancelled in the last 30 minutes, which quietly made refunds
  // conditional on the process being alive during that window: a deploy or
  // crash spanning it meant nobody was ever told and nobody was ever repaid.
  // "Cancelled and not yet archived" is a bounded set (archival closes it 24h
  // later) and cannot lose a tournament to downtime.
  const cancelled = await db.tournament.findMany({
    where: { status: 'CANCELLED', archivedAt: null },
    select: { id: true, cancelledAt: true },
  });

  let enqueued = 0;
  for (const tournament of cancelled) {
    try {
      await enqueueCancellationCleanup(tournament.id);
      enqueued++;
    } catch (error) {
      logger.error(
        { err: error, tournamentId: tournament.id },
        'failed to enqueue tournament cancellation cleanup',
      );
    }
  }

  return enqueued;
}

/**
 * Auto-archive cancelled tournaments after a 24-hour grace period (D34).
 *
 * This gives time for notifications to arrive and refunds to process.
 * Archived tournaments are hidden from public listings.
 */
async function sweepDueArchival(now: Date = new Date()): Promise<number> {
  const due = await db.tournament.findMany({
    where: {
      status: 'CANCELLED',
      cancelledAt: { lte: new Date(now.getTime() - ARCHIVE_GRACE_MS) },
      archivedAt: null,
    },
    select: { id: true },
  });
  if (due.length === 0) return 0;

  // Archiving hides a tournament from every public surface, so it must not
  // happen while the tournament still owes somebody money. The grace period is
  // 24h to give refunds time to settle; if they have NOT settled, the right
  // move is to keep the tournament visible — and keep it in the admin's list of
  // things that are wrong — rather than tidy it away and let a failed refund
  // become invisible. It archives on a later tick once cleanup reports DONE.
  const cleanupDone = await db.evaluationJob.findMany({
    where: {
      name: 'cancelTournamentCleanup',
      status: 'DONE',
      idempotencyKey: { in: due.map((t) => `cancel-cleanup:${t.id}`) },
    },
    select: { idempotencyKey: true },
  });
  const settled = new Set(cleanupDone.map((j) => j.idempotencyKey));

  const { setTournamentArchived } =
    await import('@/server/modules/tournament/admin-ops');

  let count = 0;
  for (const tournament of due) {
    if (!settled.has(`cancel-cleanup:${tournament.id}`)) {
      logger.info(
        { tournamentId: tournament.id },
        'archival deferred: cancellation cleanup has not completed',
      );
      continue;
    }
    try {
      await setTournamentArchived(tournament.id, true, AUTOMATION_ACTOR);
      count++;
    } catch (error) {
      logger.error(
        { err: error, tournamentId: tournament.id },
        'failed to archive cancelled tournament',
      );
    }
  }

  if (count > 0) {
    logger.info({ archived: count }, 'auto-archived cancelled tournaments');
  }
  return count;
}

/**
 * The whole sweep: expired round windows, due lifecycle transitions, cancellation cleanup, and archival.
 *
 * All independent, and one failing must not suppress the others. They are all
 * part of the same concern: "something in the database became due and nothing
 * has noticed". One timer drives all on purpose.
 */
export async function sweepDueWork(now: Date = new Date()): Promise<{
  rounds: number;
  transitions: number;
  cleanups: number;
  archives: number;
}> {
  const [rounds, transitions, cleanups, archives] = await Promise.all([
    sweepExpiredRounds().catch((error) => {
      logger.error({ err: error }, 'round deadline sweep failed');
      return 0;
    }),
    sweepDueTransitions(now).catch((error) => {
      logger.error({ err: error }, 'lifecycle schedule sweep failed');
      return 0;
    }),
    sweepCancelledTournaments().catch((error) => {
      logger.error({ err: error }, 'cancellation cleanup sweep failed');
      return 0;
    }),
    sweepDueArchival(now).catch((error) => {
      logger.error({ err: error }, 'archival sweep failed');
      return 0;
    }),
  ]);
  return { rounds, transitions, cleanups, archives };
}
