import 'server-only';
import { db } from '@/server/db';
import { logger } from '@/lib/logger';
import { queue } from './pg-queue';

/**
 * Deadline sweep — the trigger that makes rounds advance on their own.
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
