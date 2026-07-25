import type { RoundStage } from '@/generated/prisma/client';

/**
 * The isomorphic half of the tournament configuration (E3).
 *
 * Everything here is a pure constant or a pure function — no `server-only`, no
 * env, no database — so shared Zod schemas in `lib/validation` and (later)
 * client components can use the same bracket vocabulary the engine uses.
 * Anything that reads the environment lives in `config.ts` instead.
 */

/** Bracket sizes the engine can build (D6). Never hardcoded elsewhere. */
export const SUPPORTED_BRACKET_SIZES = [8, 16, 32, 64] as const;
export type BracketSize = (typeof SUPPORTED_BRACKET_SIZES)[number];

export function isBracketSize(value: unknown): value is BracketSize {
  return (
    typeof value === 'number' &&
    (SUPPORTED_BRACKET_SIZES as readonly number[]).includes(value)
  );
}

/**
 * Knockout stages in the order they are played, largest bracket first. The
 * stage list for a given bracket size is a suffix of this array, which makes
 * "which round comes next" a pure lookup instead of a special case per size.
 * THIRD_PLACE is inserted between SF and FINAL only when it is enabled.
 */
export const KNOCKOUT_STAGE_ORDER: readonly RoundStage[] = [
  'R64',
  'R32',
  'R16',
  'QF',
  'SF',
  'FINAL',
] as const;

/** How many competitors are still alive when each stage begins. */
export const STAGE_FIELD_SIZE: Readonly<Partial<Record<RoundStage, number>>> = {
  R64: 64,
  R32: 32,
  R16: 16,
  QF: 8,
  SF: 4,
  FINAL: 2,
  THIRD_PLACE: 2,
};

/**
 * The ordered stage list for a bracket of this size.
 * e.g. 16 with third place -> [R16, QF, SF, THIRD_PLACE, FINAL].
 */
export function stagesForBracketSize(
  size: BracketSize,
  thirdPlaceEnabled: boolean,
): RoundStage[] {
  const firstIndex = KNOCKOUT_STAGE_ORDER.findIndex(
    (stage) => STAGE_FIELD_SIZE[stage] === size,
  );
  if (firstIndex < 0) {
    throw new Error(`no knockout stage corresponds to bracket size ${size}`);
  }
  const stages = [...KNOCKOUT_STAGE_ORDER.slice(firstIndex)];
  if (thirdPlaceEnabled && stages.includes('SF')) {
    stages.splice(stages.indexOf('FINAL'), 0, 'THIRD_PLACE');
  }
  return stages;
}

/**
 * Choose a bracket size from the eligible field (D6 "chosen by registration
 * volume", D13 "top N qualify where N = the selected bracket size").
 *
 * The rule is the LARGEST supported size the field can fill, so a field of 20
 * plays a full 16 rather than a 32 padded with 12 byes. Byes therefore only
 * appear when an organizer deliberately oversizes the bracket — which stays
 * supported, it is just never the automatic choice.
 *
 * Returns null when the field cannot fill the smallest bracket; the caller
 * decides whether that blocks the transition or cancels the tournament.
 */
export function autoBracketSize(eligibleCount: number): BracketSize | null {
  let chosen: BracketSize | null = null;
  for (const size of SUPPORTED_BRACKET_SIZES) {
    if (eligibleCount >= size) chosen = size;
  }
  return chosen;
}

/** Default round durations in seconds (D7). All configurable per tournament. */
export const DEFAULT_SIMULATION_DURATIONS: readonly number[] = [
  1800, 1200, 600,
];

export const DEFAULT_STAGE_DURATIONS: Readonly<Record<RoundStage, number>> = {
  SIMULATION: 1800,
  R64: 1200,
  R32: 1200,
  R16: 1800,
  QF: 2400,
  SF: 3000,
  THIRD_PLACE: 3000,
  FINAL: 3600,
  SUDDEN_DEATH: 600,
};
