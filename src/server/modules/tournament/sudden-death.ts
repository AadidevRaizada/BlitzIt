import 'server-only';
import type { Match, Round } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { recordAudit } from '@/server/modules/admin/audit';
import { isAdmin } from '@/server/modules/auth/roles';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { resolveTournamentConfig, type TournamentConfig } from './config';
import { openRound } from './rounds';

/**
 * Sudden death (D5.6 / D14) — E6.3.
 *
 * When the win rule and every D5 tie-break fail to separate two competitors,
 * `advancement.ts` flags the match `tieUnresolved` and holds it at JUDGING.
 * This module is what unsticks it.
 *
 * ## Shape of the mechanism
 *
 * D14 is specific: sudden death is a **new short challenge** — not a shortened
 * replay of the round just played — lasting **10 minutes** by default, decided
 * on **Functional score alone**.
 *
 * A tie produces a new `Match` in a `SUDDEN_DEATH` round, pointing back at the
 * deadlocked match through `resolvesMatchId`. When that match is decided, its
 * winner is written onto the ORIGINAL match with `winReason = SUDDEN_DEATH` and
 * normal advancement continues from there. The main bracket topology therefore
 * never has to know sudden death happened — `nextMatchId` / `loserNextMatchId`
 * are read exactly as before.
 *
 * ## One sudden-death round per stage
 *
 * All ties from the same stage share one `SUDDEN_DEATH` round, so they get the
 * same problem and the same window. That is both simpler than a round per tie
 * and fairer: identical conditions for everyone resolving a tie at that stage,
 * which is the principle D26 makes explicit for future environment profiles.
 */

export interface StartSuddenDeathResult {
  suddenDeathMatch: Match;
  round: Round;
  /** True when this call created the round rather than joining an existing one. */
  createdRound: boolean;
}

/**
 * Open a sudden-death challenge for a deadlocked match.
 *
 * The problem must be published and must NOT be the one the deadlocked round
 * used — D14 calls for a new challenge, and re-using the previous one would
 * reward whoever had already built against it.
 */
export async function startSuddenDeath(
  matchId: string,
  problemId: string,
  actor: { id: string; role: 'USER' | 'ADMIN' },
): Promise<StartSuddenDeathResult> {
  if (!isAdmin(actor)) throw new ForbiddenError('Admin access required');

  return db.$transaction(async (tx) => {
    const match = await tx.match.findUnique({
      where: { id: matchId },
      include: {
        round: true,
        tournament: true,
        suddenDeathMatch: { select: { id: true } },
      },
    });
    if (!match) throw new NotFoundError('That match does not exist');

    if (!match.tieUnresolved) {
      throw new ConflictError(
        'That match is not deadlocked — sudden death only resolves a match the D5 tie-breaks could not separate',
      );
    }
    if (match.status === 'DECIDED') {
      throw new ConflictError('That match has already been decided');
    }
    if (match.suddenDeathMatch) {
      throw new ConflictError(
        'A sudden-death challenge is already under way for that match',
      );
    }
    if (!match.competitorAId || !match.competitorBId) {
      // A tie needs two competitors by definition; this would mean corrupt state.
      throw new ConflictError(
        'That match does not have two competitors to separate',
      );
    }

    const problem = await tx.problem.findUnique({
      where: { id: problemId },
      select: { id: true, visibility: true },
    });
    if (!problem) throw new NotFoundError('That problem does not exist');
    if (problem.visibility !== 'PUBLISHED') {
      throw new ConflictError('Only a published problem can be used');
    }
    if (match.round.problemId === problemId) {
      throw new ConflictError(
        'Sudden death needs a NEW challenge (D14) — pick a problem the deadlocked round did not use',
      );
    }

    const config = resolveTournamentConfig(match.tournament);

    // One sudden-death round per originating stage: the round is keyed by the
    // originating round's sequence, so a second tie in the same stage joins it
    // instead of creating a parallel round with a different problem.
    const existing = await tx.round.findUnique({
      where: {
        tournamentId_stage_sequence: {
          tournamentId: match.tournamentId,
          stage: 'SUDDEN_DEATH',
          sequence: match.round.sequence,
        },
      },
    });

    let round = existing;
    let createdRound = false;
    if (!round) {
      round = await tx.round.create({
        data: {
          tournamentId: match.tournamentId,
          type: 'KNOCKOUT',
          stage: 'SUDDEN_DEATH',
          sequence: match.round.sequence,
          durationSeconds: config.stageDurationsSeconds.SUDDEN_DEATH,
          problemId,
          status: 'PENDING',
        },
      });
      createdRound = true;
    } else if (round.problemId !== problemId) {
      throw new ConflictError(
        'A sudden-death round for this stage already exists with a different problem; every tie at a stage plays the same challenge',
      );
    }

    // `bracketPosition` is unique per round — mirror the deadlocked match's
    // position so the sudden-death match is traceable to its origin.
    const suddenDeathMatch = await tx.match.create({
      data: {
        roundId: round.id,
        tournamentId: match.tournamentId,
        bracketPosition: match.bracketPosition,
        competitorAId: match.competitorAId,
        competitorBId: match.competitorBId,
        seedA: match.seedA,
        seedB: match.seedB,
        status: 'PENDING',
        resolvesMatchId: match.id,
        // Deliberately no nextMatchId: the winner is written onto the ORIGINAL
        // match, which owns the onward topology.
      },
    });

    await openRound(tx, round.id);
    const opened = await tx.round.findUniqueOrThrow({
      where: { id: round.id },
    });

    await recordAudit(
      {
        actorId: actor.id,
        action: 'tournament.startSuddenDeath',
        entityType: 'Match',
        entityId: match.id,
        before: { stage: match.round.stage, tieUnresolved: true },
        after: {
          suddenDeathMatchId: suddenDeathMatch.id,
          roundId: round.id,
          problemId,
        },
      },
      tx,
    );

    logger.info(
      {
        matchId: match.id,
        suddenDeathMatchId: suddenDeathMatch.id,
        stage: match.round.stage,
        problemId,
      },
      'sudden-death challenge opened',
    );

    return { suddenDeathMatch, round: opened, createdRound };
  });
}

/** Matches still waiting on a sudden-death challenge to be opened. */
export async function listDeadlockedMatches(
  tournamentId: string,
  client: DbClient = db,
) {
  return client.match.findMany({
    where: {
      tournamentId,
      tieUnresolved: true,
      status: { not: 'DECIDED' },
      suddenDeathMatch: null,
    },
    include: {
      round: {
        select: { id: true, stage: true, sequence: true, problemId: true },
      },
    },
    orderBy: { bracketPosition: 'asc' },
  });
}

/**
 * Write a decided sudden-death result onto the match it was created to settle.
 *
 * Called by `advancement.ts` immediately after the sudden-death match is
 * decided, inside the same transaction, so a tie is never left half-resolved.
 */
export async function applySuddenDeathResult(
  client: DbClient,
  suddenDeathMatch: Pick<
    Match,
    'id' | 'resolvesMatchId' | 'winnerId' | 'loserId'
  >,
): Promise<Match | null> {
  if (!suddenDeathMatch.resolvesMatchId || !suddenDeathMatch.winnerId) {
    return null;
  }

  const original = await client.match.findUnique({
    where: { id: suddenDeathMatch.resolvesMatchId },
  });
  if (!original) return null;
  if (original.status === 'DECIDED') return original;

  const resolved = await client.match.update({
    where: { id: original.id },
    data: {
      status: 'DECIDED',
      winnerId: suddenDeathMatch.winnerId,
      loserId: suddenDeathMatch.loserId,
      // The enum value exists precisely for this: the match was settled by a
      // sudden-death challenge, not by any D5 tie-break.
      winReason: 'SUDDEN_DEATH',
      tieUnresolved: false,
      decidedAt: new Date(),
    },
  });

  logger.info(
    {
      matchId: original.id,
      suddenDeathMatchId: suddenDeathMatch.id,
      winnerId: suddenDeathMatch.winnerId,
    },
    'sudden death resolved the deadlocked match',
  );

  return resolved;
}

/** The sudden-death rounds of a tournament, for the bracket surfaces. */
export async function listSuddenDeathRounds(
  tournamentId: string,
  client: DbClient = db,
): Promise<Round[]> {
  return client.round.findMany({
    where: { tournamentId, stage: 'SUDDEN_DEATH' },
    orderBy: { sequence: 'asc' },
  });
}

export type { TournamentConfig };
