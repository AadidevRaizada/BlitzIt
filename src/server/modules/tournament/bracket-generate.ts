import 'server-only';
import type { RoundStage } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { buildBracketPlan, type BracketPlan } from './bracket';
import { isBracketSize, type TournamentConfig } from './config';
import { getSeedingList } from './seeding';
import { resolveDeterminedMatches } from './advancement';

/**
 * Persist a bracket plan (E3).
 *
 * The only input is the **final seeding list** (`getSeedingList`) plus the
 * bracket shape. No evaluation happens here, no scores are read, and no
 * ranking is recomputed — bracket generation is pure topology plus a seed →
 * competitor mapping, exactly as the E3 brief requires.
 *
 * The whole tree is written in one transaction. A partially-generated bracket
 * is not a state the engine ever has to reason about.
 */

export interface BracketGenerationResult {
  tournamentId: string;
  bracketSize: number;
  thirdPlaceEnabled: boolean;
  roundsCreated: number;
  matchesCreated: number;
  /** First-round matches whose opponent slot was empty. */
  byeCount: number;
  /** Matches auto-decided by the bye pass (may exceed `byeCount` in a deep bye cascade). */
  byesResolved: number;
  /** True when a bracket already existed and this call changed nothing. */
  alreadyExisted: boolean;
}

/**
 * Knockout rounds are numbered by play order so a client can sort rounds
 * without knowing the stage vocabulary. Simulation rounds use `sequence` for
 * "which of the three", which is why knockout numbering starts fresh at 1 —
 * the unique key is (tournamentId, stage, sequence) and no knockout stage
 * repeats.
 */
function knockoutSequence(plan: BracketPlan, stage: RoundStage): number {
  return plan.stages.indexOf(stage) + 1;
}

export async function generateBracket(
  client: DbClient,
  tournamentId: string,
  config: TournamentConfig,
): Promise<BracketGenerationResult> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, bracketSize: true, thirdPlaceEnabled: true },
  });
  if (!tournament) {
    throw new NotFoundError(`tournament ${tournamentId} not found`);
  }

  const existing = await client.match.count({ where: { tournamentId } });
  if (existing > 0) {
    logger.info(
      { tournamentId, matches: existing },
      'bracket already exists; generation is a no-op',
    );
    return {
      tournamentId,
      bracketSize: tournament.bracketSize ?? 0,
      thirdPlaceEnabled: tournament.thirdPlaceEnabled,
      roundsCreated: 0,
      matchesCreated: 0,
      byeCount: 0,
      byesResolved: 0,
      alreadyExisted: true,
    };
  }

  const bracketSize = tournament.bracketSize ?? config.bracketSize;
  if (!isBracketSize(bracketSize)) {
    throw new ConflictError(
      'bracket size has not been chosen; run seeding before generating the bracket',
    );
  }

  const seeds = await getSeedingList(tournamentId, client);
  if (seeds.length === 0) {
    throw new ConflictError(
      'no seeded competitors; run seeding before generating the bracket',
    );
  }
  if (seeds.length > bracketSize) {
    throw new ConflictError(
      `${seeds.length} seeded competitors do not fit a ${bracketSize}-slot bracket`,
    );
  }

  const thirdPlaceEnabled =
    tournament.thirdPlaceEnabled && config.thirdPlaceEnabled;

  const plan = buildBracketPlan({
    bracketSize,
    thirdPlaceEnabled,
    qualifiedCount: seeds.length,
  });

  const seedToUser = new Map(seeds.map((entry) => [entry.seed, entry.userId]));

  // ---- Rounds ----
  const roundIdByStage = new Map<RoundStage, string>();
  for (const round of plan.rounds) {
    const created = await client.round.create({
      data: {
        tournamentId,
        type: 'KNOCKOUT',
        stage: round.stage,
        sequence: knockoutSequence(plan, round.stage),
        status: 'PENDING',
        durationSeconds: config.stageDurationsSeconds[round.stage],
      },
    });
    roundIdByStage.set(round.stage, created.id);
  }

  // ---- Matches, pass 1: create every node ----
  // Links are written in pass 2 because a match cannot reference an id that
  // does not exist yet.
  const matchIdByKey = new Map<string, string>();
  for (const match of plan.matches) {
    const roundId = roundIdByStage.get(match.stage);
    if (!roundId) {
      throw new ConflictError(`no round was created for stage ${match.stage}`);
    }
    const created = await client.match.create({
      data: {
        roundId,
        tournamentId,
        bracketPosition: match.bracketPosition,
        seedA: match.seedA,
        seedB: match.seedB,
        competitorAId:
          match.seedA !== null ? (seedToUser.get(match.seedA) ?? null) : null,
        competitorBId:
          match.seedB !== null ? (seedToUser.get(match.seedB) ?? null) : null,
        status: 'PENDING',
      },
    });
    matchIdByKey.set(`${match.stage}#${match.bracketPosition}`, created.id);
  }

  // ---- Matches, pass 2: wire the topology ----
  for (const match of plan.matches) {
    const id = matchIdByKey.get(`${match.stage}#${match.bracketPosition}`);
    if (!id) throw new ConflictError('bracket generation lost a match id');

    const nextId =
      match.nextStage !== null
        ? matchIdByKey.get(`${match.nextStage}#${match.nextPosition}`)
        : null;
    const loserNextId =
      match.loserNextStage !== null
        ? matchIdByKey.get(`${match.loserNextStage}#${match.loserNextPosition}`)
        : null;

    await client.match.update({
      where: { id },
      data: {
        nextMatchId: nextId ?? null,
        nextMatchSlot: nextId ? match.nextSlot : null,
        loserNextMatchId: loserNextId ?? null,
        loserNextMatchSlot: loserNextId ? match.loserNextSlot : null,
      },
    });
  }

  await client.tournament.update({
    where: { id: tournamentId },
    data: { bracketSize, bracketGeneratedAt: new Date() },
  });

  // Byes are resolved immediately so the bracket a spectator sees after
  // generation already shows who walked into the next round.
  const byeDecisions = await resolveDeterminedMatches(
    client,
    tournamentId,
    config,
  );

  logger.info(
    {
      tournamentId,
      bracketSize,
      rounds: plan.rounds.length,
      matches: plan.matches.length,
      byes: plan.byeCount,
    },
    'bracket generated',
  );

  return {
    tournamentId,
    bracketSize,
    thirdPlaceEnabled,
    roundsCreated: plan.rounds.length,
    matchesCreated: plan.matches.length,
    byeCount: plan.byeCount,
    byesResolved: byeDecisions.length,
    alreadyExisted: false,
  };
}

/**
 * Read the bracket back as a tree. Used by verification and, later, by the
 * spectator surface; kept here so nothing else has to know the link columns.
 */
export async function getBracket(tournamentId: string, client: DbClient = db) {
  const rounds = await client.round.findMany({
    where: { tournamentId, type: 'KNOCKOUT' },
    orderBy: { sequence: 'asc' },
    include: {
      matches: {
        orderBy: { bracketPosition: 'asc' },
      },
    },
  });
  return rounds;
}
