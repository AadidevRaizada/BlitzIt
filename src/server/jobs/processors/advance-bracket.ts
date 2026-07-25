import 'server-only';
import { progressTournament } from '@/server/modules/tournament';
import type { ClaimedJob } from '../queue';
import { logger } from '@/lib/logger';

/**
 * `advanceBracket` job (E3, blueprint E6.2).
 *
 * Enqueued once a round's evaluations are in. Decides every decidable match,
 * pushes winners into the next round, and advances the lifecycle when the round
 * completes — repeating until the bracket stops moving.
 *
 * Everything it does is derived from persisted state, so a duplicate job, a
 * retry, or a run after a process restart all converge on the same result. It
 * is deliberately safe to over-schedule: a pass with nothing to do is cheap.
 */
export async function advanceBracketProcessor(job: ClaimedJob): Promise<void> {
  const tournamentId =
    typeof job.payload.tournamentId === 'string'
      ? job.payload.tournamentId
      : null;
  if (!tournamentId) {
    throw new Error('advanceBracket job is missing tournamentId');
  }

  const log = logger.child({ jobId: job.id, tournamentId });

  const result = await progressTournament(tournamentId, { runBy: 'runner' });

  log.info(
    {
      startedAtStage: result.startedAtStage,
      decided: result.matchesDecided,
      tied: result.matchesTied,
      transitions: result.transitions.map((t) => t.transition),
      completed: result.completed,
    },
    'bracket advancement pass finished',
  );

  if (result.matchesTied > 0) {
    // D5's last tie-break is a sudden-death challenge, which is a later epic.
    // Surfacing it loudly beats advancing an arbitrary competitor.
    log.warn(
      { tied: result.matchesTied },
      'matches are tied after every tie-break and need a sudden-death challenge',
    );
  }
}
