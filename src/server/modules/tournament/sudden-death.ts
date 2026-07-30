import 'server-only';
import { Prisma } from '@/generated/prisma/client';
import type { Match, Role, Round } from '@/generated/prisma/client';
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
  actor: { id: string; role: Role },
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

    // Serialise concurrent starts on this tournament. Without it two admins
    // resolving two ties in the same stage could both decide to create the
    // round and collide on (tournamentId, stage, sequence), failing a start
    // that should simply have joined.
    await tx.$queryRaw(
      Prisma.sql`SELECT "id" FROM "Tournament" WHERE "id" = ${match.tournamentId} FOR UPDATE`,
    );

    // Ties from the SAME originating round share a round, so they face the same
    // challenge and window. A round is identified by what it resolves, not by a
    // derived sequence — which is what lets a sudden death that ITSELF ties get
    // a fresh round rather than colliding with the one it came from.
    const candidateRounds = await tx.round.findMany({
      where: {
        tournamentId: match.tournamentId,
        stage: 'SUDDEN_DEATH',
        status: { not: 'COMPLETED' },
        problemId,
      },
      include: {
        matches: {
          select: { resolvesMatch: { select: { roundId: true } } },
        },
      },
      orderBy: { sequence: 'asc' },
    });

    let round =
      candidateRounds.find((candidate) =>
        candidate.matches.some(
          (sibling) => sibling.resolvesMatch?.roundId === match.roundId,
        ),
      ) ?? null;

    let createdRound = false;
    if (!round) {
      // A new decider round. `sequence` only has to be unique per stage, so it
      // is allocated from the existing sudden-death rounds rather than derived
      // from the originating round — a nested sudden death would otherwise
      // always collide with its own parent.
      const last = await tx.round.findFirst({
        where: { tournamentId: match.tournamentId, stage: 'SUDDEN_DEATH' },
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
      });

      round = await tx.round.create({
        data: {
          tournamentId: match.tournamentId,
          type: 'KNOCKOUT',
          stage: 'SUDDEN_DEATH',
          sequence: (last?.sequence ?? 0) + 1,
          durationSeconds: config.stageDurationsSeconds.SUDDEN_DEATH,
          problemId,
          status: 'PENDING',
        },
        include: {
          matches: {
            select: { resolvesMatch: { select: { roundId: true } } },
          },
        },
      });
      createdRound = true;
    }

    // `bracketPosition` is unique per round — mirror the deadlocked match's
    // position so the sudden-death match is traceable to its origin.
    //
    // `resolvesMatchId` is UNIQUE, so if a concurrent start slipped past the
    // read above the insert is what actually stops a second decider. Translate
    // that into the same typed conflict the read produces, rather than letting
    // a raw Prisma error escape the module.
    let suddenDeathMatch;
    try {
      suddenDeathMatch = await tx.match.create({
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
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictError(
          'A sudden-death challenge is already under way for that match',
        );
      }
      throw error;
    }

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

/**
 * Matches still waiting on a sudden-death challenge to be opened.
 *
 * Includes a sudden-death match that ITSELF tied: that is a legitimate (if
 * vanishingly rare) state, and it gets a fresh decider round of its own rather
 * than being a dead end.
 */
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

/**
 * Mark every sudden-death round whose matches are all decided as COMPLETED.
 *
 * Sudden-death rounds sit outside the main stage list, so no lifecycle
 * transition ever closes them — `COMPLETE` finishes the FINAL round only. Left
 * alone, a tournament could reach COMPLETED with a sudden-death round still
 * flagged OPEN, and `progressTournament` short-circuits once the tournament is
 * no longer LIVE, so nothing would ever tidy it.
 */
export async function completeSettledSuddenDeathRounds(
  client: DbClient,
  tournamentId: string,
): Promise<number> {
  const rounds = await client.round.findMany({
    where: {
      tournamentId,
      stage: 'SUDDEN_DEATH',
      status: { not: 'COMPLETED' },
    },
    include: { matches: { select: { status: true } } },
  });

  let completed = 0;
  for (const round of rounds) {
    if (round.matches.length === 0) continue;
    if (!round.matches.every((match) => match.status === 'DECIDED')) continue;

    await client.round.update({
      where: { id: round.id },
      data: { status: 'COMPLETED' },
    });
    completed++;
  }

  if (completed > 0) {
    logger.info({ tournamentId, completed }, 'sudden-death rounds completed');
  }
  return completed;
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
