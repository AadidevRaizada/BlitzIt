import 'server-only';
import { db } from '@/server/db';
import { computeSeeding } from '@/server/modules/tournament';
import type { ClaimedJob } from '../queue';
import { logger } from '@/lib/logger';

/**
 * `seedTournament` job (E3, blueprint E6.1).
 *
 * Recomputes the seeding from persisted evaluations. The normal path seeds as
 * a side effect of `CLOSE_SIMULATION`; this job exists for the ops case —
 * a late evaluation landed, an admin overrode a score, or the transition ran
 * before the queue had drained.
 *
 * It is a pure re-aggregation: idempotent, deterministic, and it never
 * evaluates anything. It refuses to run once the bracket exists, because
 * re-seeding under a built bracket would silently disagree with the matches
 * competitors are already playing.
 */
export async function seedTournamentProcessor(job: ClaimedJob): Promise<void> {
  const tournamentId =
    typeof job.payload.tournamentId === 'string'
      ? job.payload.tournamentId
      : null;
  if (!tournamentId) {
    throw new Error('seedTournament job is missing tournamentId');
  }

  const log = logger.child({ jobId: job.id, tournamentId });

  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, bracketSize: true, bracketGeneratedAt: true },
  });
  if (!tournament) {
    log.warn('tournament no longer exists; skipping seeding');
    return;
  }
  if (tournament.bracketGeneratedAt) {
    log.warn(
      'bracket already generated; refusing to re-seed under a live bracket',
    );
    return;
  }

  const result = await computeSeeding(tournamentId, {
    bracketSize:
      typeof job.payload.bracketSize === 'number'
        ? job.payload.bracketSize
        : tournament.bracketSize,
  });

  log.info(
    {
      bracketSize: result.bracketSize,
      eligible: result.eligibleCount,
      qualified: result.qualifiedCount,
    },
    'tournament seeded',
  );
}
