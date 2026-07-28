import 'server-only';
import { db } from '@/server/db';
import { logger } from '@/lib/logger';
import { queue } from './pg-queue';
import {
  AUTOMATED_STATUSES,
  dueScheduledTransition,
} from '@/server/modules/tournament/schedule.public';

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
 * refusing — and some refusals are permanent from the schedule's point of view.
 * A tournament whose registration window closes with 3 competitors when the
 * minimum is 8 will fail `CLOSE_REGISTRATION` every time it is attempted. At a
 * one-minute bucket that is a failed job every minute, all night. Five minutes
 * keeps the operator's job list readable while staying far below the scale a
 * schedule milestone is measured in.
 */
export const LIFECYCLE_BUCKET_MS = 300_000;

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
 * Enqueue a scheduled lifecycle transition.
 *
 * Reuses the existing `tournamentTransition` processor rather than adding a
 * path into `applyTransition`, so scheduled transitions inherit the retry
 * policy that processor already encodes: an illegal transition completes
 * without retrying (it will never become legal), a guard rejection backs off
 * and retries (it might).
 *
 * The key includes the transition name. Without it, two different transitions
 * becoming due in the same bucket — which happens the moment a DRAFT with a due
 * `registrationOpensAt` is published — would collide and the second would be
 * silently dropped as a duplicate.
 */
export function enqueueScheduledTransition(
  tournamentId: string,
  transition: string,
  now: Date = new Date(),
): Promise<string> {
  const bucket = Math.floor(now.getTime() / LIFECYCLE_BUCKET_MS);
  return queue.enqueue(
    'tournamentTransition',
    { tournamentId, transition, runBy: 'schedule' },
    {
      idempotencyKey: `lifecycle:${tournamentId}:${transition}:${bucket}`,
      // Above round progression: a phase boundary gates everything behind it,
      // and a tournament that cannot start makes every round job moot.
      priority: 20,
    },
  );
}

interface DueTransition {
  tournamentId: string;
  transition: string;
}

/**
 * Tournaments whose next scheduled step is due.
 *
 * The candidate set is narrowed in SQL — only non-archived tournaments in a
 * status the schedule drives — and the actual decision is made in TypeScript by
 * `dueScheduledTransition`, the same pure function the admin UI calls to say
 * what happens next. Encoding the mapping twice, once as SQL and once as a
 * switch, is exactly how the UI and the engine drifted apart in the first place.
 *
 * The row count here is bounded by the number of live tournaments, which is a
 * handful — this is not a table scan worth optimising into SQL.
 */
export async function findDueTransitions(
  now: Date = new Date(),
): Promise<DueTransition[]> {
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

  const due: DueTransition[] = [];
  for (const tournament of candidates) {
    const transition = dueScheduledTransition(tournament, now);
    if (transition) due.push({ tournamentId: tournament.id, transition });
  }
  return due;
}

/**
 * One lifecycle pass. Returns how many transitions were enqueued so the
 * verification suite can assert on it.
 */
export async function sweepDueTransitions(
  now: Date = new Date(),
): Promise<number> {
  const due = await findDueTransitions(now);
  if (due.length === 0) return 0;

  let enqueued = 0;
  for (const item of due) {
    try {
      await enqueueScheduledTransition(item.tournamentId, item.transition, now);
      enqueued++;
    } catch (error) {
      // One unhealthy tournament must not stop the others, nor the sweep.
      logger.error(
        {
          err: error,
          tournamentId: item.tournamentId,
          transition: item.transition,
        },
        'failed to enqueue scheduled lifecycle transition',
      );
    }
  }

  if (enqueued > 0) {
    logger.info({ enqueued }, 'schedule sweep enqueued lifecycle transitions');
  }
  return enqueued;
}

/**
 * The whole sweep: expired round windows AND due lifecycle transitions.
 *
 * One tick drives both on purpose. They are the same concern — "something in
 * the database became due and nothing has noticed" — and a second timer would
 * be a second thing to boot, monitor and get wrong. This is what the runner
 * calls.
 */
export async function sweepDueWork(now: Date = new Date()): Promise<{
  rounds: number;
  transitions: number;
}> {
  // Independent, and one failing must not suppress the other.
  const [rounds, transitions] = await Promise.all([
    sweepExpiredRounds().catch((error) => {
      logger.error({ err: error }, 'round deadline sweep failed');
      return 0;
    }),
    sweepDueTransitions(now).catch((error) => {
      logger.error({ err: error }, 'lifecycle schedule sweep failed');
      return 0;
    }),
  ]);
  return { rounds, transitions };
}
