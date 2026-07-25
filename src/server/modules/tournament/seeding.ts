import 'server-only';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { autoBracketSize, isBracketSize, type BracketSize } from './config';
import { rankByWinRule, type CompetitorResult } from './win-rule';

/**
 * Simulation → seeding (D13). E3.
 *
 * "All three simulation rounds count. Final simulation score = sum of the three
 * round overall scores. Rank competitors by total desc; top N qualify where
 * N = the selected bracket size. Ties at the qualification cutline are broken
 * by the D5 tie-break order."
 *
 * ## Responsibility boundary
 *
 * Seeding **reads** evaluations that already exist; it never triggers, waits
 * for, or performs an evaluation. If a submission has not been scored yet it
 * simply contributes nothing — the caller is expected to have closed the
 * simulation phase and let the evaluation queue drain first, which the
 * `CLOSE_SIMULATION` guard enforces.
 *
 * Bracket generation, in turn, reads only the seed list this module writes. The
 * two never call each other.
 */

/** One competitor's aggregated simulation performance. */
export interface SeedingEntry {
  userId: string;
  /** Sum of `overallScore` across every scored simulation round (D13). */
  simulationScore: number;
  roundsScored: number;
  /** Aggregates used only to break ties at the cutline (D5 order). */
  functionalTotal: number;
  testsPassedTotal: number;
  performanceTotal: number;
  aiTotal: number;
  /** When they finished their last simulation round — earlier is faster. */
  lastSubmittedAt: Date | null;
  city: string | null;
}

export interface SeedingResult {
  tournamentId: string;
  bracketSize: BracketSize;
  eligibleCount: number;
  qualifiedCount: number;
  /** Ordered best-first. Seed `n` is at index `n - 1`. */
  seeds: Array<{ userId: string; seed: number; simulationScore: number }>;
  /** Ranked but below the cutline. */
  eliminated: Array<{ userId: string; simulationScore: number }>;
}

/**
 * Aggregate simulation results into one entry per eligible competitor.
 *
 * Eligibility is an ACTIVE registration, not "submitted something": a
 * registrant who never submitted still appears, with a score of 0, so the
 * standings show the whole field.
 */
export async function collectSimulationResults(
  tournamentId: string,
  client: DbClient = db,
): Promise<SeedingEntry[]> {
  // ORDER MATTERS. `rankByWinRule` is stable, so competitors who tie on every
  // aggregate D5 field keep their input order — and two registrants who never
  // submitted tie on all of them. Without an explicit order the database is
  // free to return them differently between runs, which would make seeding
  // (and therefore the whole bracket) non-deterministic. Registration time is
  // the documented final tie-break; `id` settles even that.
  const registrations = await client.registration.findMany({
    where: { tournamentId, status: 'ACTIVE' },
    select: { userId: true, user: { select: { city: true } } },
    orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }],
  });

  const entries = new Map<string, SeedingEntry>();
  for (const registration of registrations) {
    entries.set(registration.userId, {
      userId: registration.userId,
      simulationScore: 0,
      roundsScored: 0,
      functionalTotal: 0,
      testsPassedTotal: 0,
      performanceTotal: 0,
      aiTotal: 0,
      lastSubmittedAt: null,
      city: registration.user.city,
    });
  }

  const submissions = await client.submission.findMany({
    where: {
      tournamentId,
      round: { type: 'SIMULATION' },
      status: 'SCORED',
    },
    select: {
      userId: true,
      submittedAt: true,
      evaluation: {
        select: {
          overallScore: true,
          functionalScore: true,
          testsPassed: true,
          performanceScore: true,
          aiScore: true,
        },
      },
    },
  });

  for (const submission of submissions) {
    const evaluation = submission.evaluation;
    if (!evaluation) continue;

    const entry = entries.get(submission.userId);
    if (!entry) {
      // Scored a simulation round without an active registration — possible
      // after a revocation. Excluded from seeding, but worth surfacing.
      logger.warn(
        { tournamentId, userId: submission.userId },
        'scored simulation submission from a competitor without an active registration; excluded from seeding',
      );
      continue;
    }

    entry.simulationScore += evaluation.overallScore;
    entry.roundsScored += 1;
    entry.functionalTotal += evaluation.functionalScore;
    entry.testsPassedTotal += evaluation.testsPassed;
    entry.performanceTotal += evaluation.performanceScore;
    entry.aiTotal += evaluation.aiScore;
    if (
      !entry.lastSubmittedAt ||
      submission.submittedAt > entry.lastSubmittedAt
    ) {
      entry.lastSubmittedAt = submission.submittedAt;
    }
  }

  return [...entries.values()];
}

/**
 * Rank entries best-first using the D5 chain over the aggregated totals.
 * PURE — exported so the ordering can be tested without a database.
 */
export function rankSeedingEntries(
  entries: readonly SeedingEntry[],
): SeedingEntry[] {
  const byUser = new Map(entries.map((entry) => [entry.userId, entry]));

  const competitors: CompetitorResult[] = entries.map((entry) => ({
    userId: entry.userId,
    seed: null,
    // The aggregate stands in for a submission: a competitor who scored
    // nothing still ranks, just last.
    submissionId: entry.roundsScored > 0 ? entry.userId : null,
    submittedAt: entry.lastSubmittedAt,
    evaluationPending: false,
    overallScore: entry.simulationScore,
    functionalScore: entry.functionalTotal,
    testsPassed: entry.testsPassedTotal,
    performanceScore: entry.performanceTotal,
    aiScore: entry.aiTotal,
  }));

  return rankByWinRule(competitors).map((competitor) => {
    const entry = byUser.get(competitor.userId);
    if (!entry) {
      throw new Error(
        `ranking produced an unknown competitor ${competitor.userId}`,
      );
    }
    return entry;
  });
}

/**
 * Compute and persist the seeding for a tournament.
 *
 * Idempotent: re-running recomputes from the same persisted evaluations and
 * overwrites the same `Ranking` rows, so a retried job converges rather than
 * double-seeding. Deterministic for identical inputs.
 */
export async function computeSeeding(
  tournamentId: string,
  options: { bracketSize?: number | null } = {},
  client: DbClient = db,
): Promise<SeedingResult> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, bracketSize: true },
  });
  if (!tournament) {
    throw new NotFoundError(`tournament ${tournamentId} not found`);
  }

  const entries = await collectSimulationResults(tournamentId, client);
  const ranked = rankSeedingEntries(entries);

  const requested = options.bracketSize ?? tournament.bracketSize ?? null;
  let bracketSize: BracketSize | null;
  if (requested !== null && requested !== undefined) {
    if (!isBracketSize(requested)) {
      throw new ConflictError(
        `unsupported bracket size ${requested}; supported sizes are 8, 16, 32, 64 (D6)`,
      );
    }
    bracketSize = requested;
  } else {
    bracketSize = autoBracketSize(ranked.length);
  }

  if (bracketSize === null) {
    throw new ConflictError(
      `only ${ranked.length} competitor(s) are eligible; the smallest supported bracket needs 8 (D6)`,
    );
  }

  // Top N qualify (D13). An oversized bracket leaves the tail seeds empty,
  // which bracket generation turns into byes.
  const qualifiedCount = Math.min(ranked.length, bracketSize);
  const qualified = ranked.slice(0, qualifiedCount);
  const eliminated = ranked.slice(qualifiedCount);

  await client.tournament.update({
    where: { id: tournamentId },
    data: { bracketSize, seededAt: new Date() },
  });

  for (const [index, entry] of ranked.entries()) {
    const isQualified = index < qualifiedCount;
    const data = {
      simulationScore: entry.simulationScore,
      seed: isQualified ? index + 1 : null,
      qualified: isQualified,
      currentStage: null,
      eliminatedAtStage: isQualified ? null : ('SIMULATION' as const),
      city: entry.city,
    };
    await client.ranking.upsert({
      where: { tournamentId_userId: { tournamentId, userId: entry.userId } },
      update: data,
      create: { tournamentId, userId: entry.userId, ...data },
    });
  }

  return {
    tournamentId,
    bracketSize,
    eligibleCount: ranked.length,
    qualifiedCount,
    seeds: qualified.map((entry, index) => ({
      userId: entry.userId,
      seed: index + 1,
      simulationScore: entry.simulationScore,
    })),
    eliminated: eliminated.map((entry) => ({
      userId: entry.userId,
      simulationScore: entry.simulationScore,
    })),
  };
}

/**
 * The final seeding list — the ONLY input bracket generation is allowed to
 * consume. Returned seed-ascending (seed 1 first) and validated to be a
 * contiguous 1..N with no duplicates, because a gap or a repeat would place a
 * competitor twice or leave a slot unfillable.
 */
export async function getSeedingList(
  tournamentId: string,
  client: DbClient = db,
): Promise<Array<{ userId: string; seed: number }>> {
  const rankings = await client.ranking.findMany({
    where: { tournamentId, qualified: true, seed: { not: null } },
    orderBy: { seed: 'asc' },
    select: { userId: true, seed: true },
  });

  const seeds = rankings.map((row) => ({
    userId: row.userId,
    seed: row.seed as number,
  }));

  seeds.forEach((entry, index) => {
    if (entry.seed !== index + 1) {
      throw new ConflictError(
        `seeding list is not contiguous: expected seed ${index + 1}, found ${entry.seed}`,
      );
    }
  });

  const unique = new Set(seeds.map((entry) => entry.userId));
  if (unique.size !== seeds.length) {
    throw new ConflictError('seeding list contains a duplicate competitor');
  }

  return seeds;
}
