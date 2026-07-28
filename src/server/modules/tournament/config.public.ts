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
 * The smallest bracket the engine will ever build (D6). Below this the draw is
 * not a tournament, it is a handful of people watching each other, so the
 * transition is refused outright rather than papered over with byes.
 */
export const MIN_BRACKET_SIZE = SUPPORTED_BRACKET_SIZES[0];

/** The largest draw the stage vocabulary can express. */
export const MAX_BRACKET_SIZE: BracketSize =
  SUPPORTED_BRACKET_SIZES.reduce<BracketSize>(
    (largest, size) => (size > largest ? size : largest),
    SUPPORTED_BRACKET_SIZES[0],
  );

/**
 * Choose a bracket size from the eligible field (D6).
 *
 * The rule is the SMALLEST supported size that fits the whole field, so nobody
 * who qualified is cut: 9 competitors play a 16 with 7 byes rather than a 16th
 * of them being told they missed a cut they never knew about. This replaced the
 * old "largest size the field can fill" rule, which silently dropped everyone
 * past the nearest power of two — a field of 15 played an 8 and eliminated 7
 * people before a single match.
 *
 * Byes are the price of that, and they are cheap: a bye is an ordinary match
 * with an empty slot that `decideMatch` resolves at generation time. They land
 * on the highest seeds automatically — `seedOrder` pairs seed 1 with seed N,
 * seed 2 with N-1, and so on, so the seeds left unfilled are always the worst
 * ones, and their absent opponents are always the best ones. Nothing allocates
 * byes; the topology does it.
 *
 * Returns null when the field cannot fill the smallest bracket; the caller
 * decides whether that blocks the transition or cancels the tournament.
 *
 * Above MAX_BRACKET_SIZE the draw caps and the top MAX_BRACKET_SIZE seeds
 * qualify — the only case where a cut still exists.
 */
export function autoBracketSize(eligibleCount: number): BracketSize | null {
  if (eligibleCount < MIN_BRACKET_SIZE) return null;
  for (const size of SUPPORTED_BRACKET_SIZES) {
    if (eligibleCount <= size) return size;
  }
  return MAX_BRACKET_SIZE;
}

/**
 * The outcome of sizing a draw, as data rather than an exception.
 *
 * Seeding used to express "too few competitors" by throwing, which meant the
 * admin UI could only ever render the thrown sentence — no eligible count, no
 * minimum, no advice. This returns the same facts to both callers so the guard
 * and the screen explaining the guard can never disagree.
 *
 * PURE, and in the isomorphic half of the config on purpose: the admin client
 * calls it to pre-empt the failure before the operator submits.
 */
export type BracketSizing =
  | {
      ok: true;
      bracketSize: BracketSize;
      eligibleCount: number;
      /** How many of the eligible field actually enter the draw. */
      qualifiedCount: number;
      /** Empty slots. Each becomes a bye for the seed opposite it. */
      byeCount: number;
      /** Eligible competitors left out — only ever above MAX_BRACKET_SIZE. */
      cutCount: number;
    }
  | {
      ok: false;
      reason: 'BELOW_MINIMUM';
      eligibleCount: number;
      minimum: number;
      /** How many more competitors are needed. */
      shortfall: number;
    }
  | {
      ok: false;
      reason: 'UNSUPPORTED_SIZE';
      requested: number;
      supported: readonly number[];
    };

export function decideBracketSizing(
  eligibleCount: number,
  requestedSize?: number | null,
): BracketSizing {
  // The minimum is checked BEFORE the requested size is honoured. An explicit
  // bracketSize used to bypass every check, which is how a tournament with two
  // competitors could be forced into an 8-slot draw and stall: six byes, one
  // real match, and a "champion" who beat one person.
  if (eligibleCount < MIN_BRACKET_SIZE) {
    return {
      ok: false,
      reason: 'BELOW_MINIMUM',
      eligibleCount,
      minimum: MIN_BRACKET_SIZE,
      shortfall: MIN_BRACKET_SIZE - eligibleCount,
    };
  }

  let bracketSize: BracketSize;
  if (requestedSize !== null && requestedSize !== undefined) {
    if (!isBracketSize(requestedSize)) {
      return {
        ok: false,
        reason: 'UNSUPPORTED_SIZE',
        requested: requestedSize,
        supported: SUPPORTED_BRACKET_SIZES,
      };
    }
    bracketSize = requestedSize;
  } else {
    // Non-null: the minimum was already cleared above.
    bracketSize = autoBracketSize(eligibleCount) as BracketSize;
  }

  const qualifiedCount = Math.min(eligibleCount, bracketSize);
  return {
    ok: true,
    bracketSize,
    eligibleCount,
    qualifiedCount,
    byeCount: bracketSize - qualifiedCount,
    cutCount: eligibleCount - qualifiedCount,
  };
}

/** One sentence explaining a refusal, shared by the server guard and the UI. */
export function explainBracketSizing(sizing: BracketSizing): string {
  if (sizing.ok) {
    const parts = [`${sizing.bracketSize}-competitor draw`];
    if (sizing.byeCount > 0) {
      parts.push(
        `${sizing.byeCount} bye${sizing.byeCount === 1 ? '' : 's'} to the top seeds`,
      );
    }
    if (sizing.cutCount > 0) {
      parts.push(`${sizing.cutCount} below the cutline`);
    }
    return parts.join(', ');
  }
  if (sizing.reason === 'UNSUPPORTED_SIZE') {
    return `Bracket size ${sizing.requested} is not supported. Choose one of ${sizing.supported.join(', ')} (D6).`;
  }
  return (
    `${sizing.eligibleCount} competitor${sizing.eligibleCount === 1 ? '' : 's'} ` +
    `${sizing.eligibleCount === 1 ? 'is' : 'are'} eligible, but a draw needs at least ` +
    `${sizing.minimum} (D6). ${sizing.shortfall} more ` +
    `${sizing.shortfall === 1 ? 'is' : 'are'} needed — extend registration and reopen ` +
    `the simulation, or cancel the tournament. The bracket cannot be generated ` +
    `below ${sizing.minimum}, with or without byes.`
  );
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
