import 'server-only';
import { z } from 'zod';
import type { RoundStage } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';
import { serverEnv } from '@/lib/env';
import {
  DEFAULT_SIMULATION_DURATIONS,
  DEFAULT_STAGE_DURATIONS,
  isBracketSize,
  SUPPORTED_BRACKET_SIZES,
  type BracketSize,
} from './config.public';

/**
 * Tournament configuration (E3).
 *
 * Nothing about a tournament's shape is hardcoded at a call site. Values are
 * resolved in three layers, most specific winning:
 *
 *   1. per-tournament columns / JSON  (`bracketSize`, `thirdPlaceEnabled`,
 *      `roundDurations`, `minRegistrations`, `maxRegistrations`)
 *   2. environment                    (`TOURNAMENT_*`)
 *   3. built-in defaults              (D6, D7, D13)
 *
 * A malformed per-tournament override never blocks an operation: it is logged
 * and the next layer down is used. Same principle as `resolveEvaluationProfile`
 * (D20) — an organizer's typo must not brick a running tournament.
 *
 * The pure vocabulary (bracket sizes, stage order) lives in `config.public.ts`
 * so validation schemas can share it without pulling in `server-only`.
 */

export {
  SUPPORTED_BRACKET_SIZES,
  KNOCKOUT_STAGE_ORDER,
  STAGE_FIELD_SIZE,
  isBracketSize,
  stagesForBracketSize,
  autoBracketSize,
  type BracketSize,
} from './config.public';

export interface TournamentConfig {
  /** Bracket sizes this deployment can build. */
  supportedBracketSizes: readonly number[];
  /** Explicit size, or null to size automatically from the qualified field. */
  bracketSize: BracketSize | null;
  thirdPlaceEnabled: boolean;
  minRegistrations: number;
  maxRegistrations: number;
  /** Number of simulation rounds that feed seeding (D13: three). */
  simulationRounds: number;
  /** Duration of each simulation round, by index. */
  simulationDurationsSeconds: readonly number[];
  /** Duration of each knockout stage. */
  stageDurationsSeconds: Readonly<Record<RoundStage, number>>;
  /**
   * When neither competitor in a match submitted anything, advance the better
   * seed rather than stalling the bracket. Deterministic and resumable; the
   * alternative (leaving the match undecided) blocks the whole tournament on a
   * pair of no-shows.
   */
  advanceHigherSeedOnDoubleNoShow: boolean;
}

/** Deployment-wide defaults, from env. */
export function baseTournamentConfig(): TournamentConfig {
  const env = serverEnv();
  return {
    supportedBracketSizes: SUPPORTED_BRACKET_SIZES,
    bracketSize: isBracketSize(env.TOURNAMENT_BRACKET_SIZE)
      ? env.TOURNAMENT_BRACKET_SIZE
      : null,
    thirdPlaceEnabled: env.TOURNAMENT_THIRD_PLACE_ENABLED,
    minRegistrations: env.TOURNAMENT_MIN_REGISTRATIONS,
    maxRegistrations: env.TOURNAMENT_MAX_REGISTRATIONS,
    simulationRounds: env.TOURNAMENT_SIMULATION_ROUNDS,
    simulationDurationsSeconds: DEFAULT_SIMULATION_DURATIONS,
    stageDurationsSeconds: DEFAULT_STAGE_DURATIONS,
    advanceHigherSeedOnDoubleNoShow:
      env.TOURNAMENT_ADVANCE_HIGHER_SEED_ON_NO_SHOW,
  };
}

/**
 * Per-tournament `roundDurations` JSON. Both halves optional so an organizer
 * can retime only the final without restating everything.
 */
const roundDurationsSchema = z.object({
  simulation: z.array(z.number().int().positive()).optional(),
  stages: z.record(z.string(), z.number().int().positive()).optional(),
});

/** The subset of `Tournament` columns that participate in configuration. */
export interface TournamentConfigSource {
  bracketSize?: number | null;
  thirdPlaceEnabled?: boolean | null;
  minRegistrations?: number | null;
  maxRegistrations?: number | null;
  roundDurations?: unknown;
}

/**
 * Merge a tournament's stored overrides over the deployment defaults.
 * Never throws — an invalid override degrades to the layer beneath it.
 */
export function resolveTournamentConfig(
  source?: TournamentConfigSource | null,
): TournamentConfig {
  const base = baseTournamentConfig();
  if (!source) return base;

  const simulation = [...base.simulationDurationsSeconds];
  const stages = { ...base.stageDurationsSeconds };

  if (source.roundDurations !== null && source.roundDurations !== undefined) {
    const parsed = roundDurationsSchema.safeParse(source.roundDurations);
    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.issues.length },
        'invalid roundDurations config; using defaults',
      );
    } else {
      if (parsed.data.simulation) {
        // Positional: index i overrides simulation round i+1. Extra entries are
        // ignored rather than silently creating rounds nobody scheduled.
        parsed.data.simulation.forEach((seconds, index) => {
          if (index < simulation.length) simulation[index] = seconds;
        });
      }
      for (const [stage, seconds] of Object.entries(parsed.data.stages ?? {})) {
        if (stage in stages) {
          stages[stage as RoundStage] = seconds;
        } else {
          logger.warn(
            { stage },
            'unknown round stage in roundDurations config',
          );
        }
      }
    }
  }

  if (
    source.bracketSize !== null &&
    source.bracketSize !== undefined &&
    !isBracketSize(source.bracketSize)
  ) {
    logger.warn(
      { bracketSize: source.bracketSize },
      'unsupported bracketSize on tournament; falling back to configuration',
    );
  }

  return {
    ...base,
    bracketSize: isBracketSize(source.bracketSize)
      ? source.bracketSize
      : base.bracketSize,
    thirdPlaceEnabled: source.thirdPlaceEnabled ?? base.thirdPlaceEnabled,
    minRegistrations: source.minRegistrations ?? base.minRegistrations,
    maxRegistrations: source.maxRegistrations ?? base.maxRegistrations,
    simulationDurationsSeconds: simulation,
    stageDurationsSeconds: stages,
  };
}
