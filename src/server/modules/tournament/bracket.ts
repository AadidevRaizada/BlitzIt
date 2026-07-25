import type { MatchSlot, RoundStage } from '@/generated/prisma/client';
import {
  isBracketSize,
  stagesForBracketSize,
  type BracketSize,
} from './config.public';

/**
 * Bracket topology (E3, blueprint E6.1).
 *
 * PURE — no database, no randomness, no clock. `buildBracketPlan` is a total
 * function of (size, third-place flag, qualified count), so the same inputs
 * always produce byte-identical output. That determinism is the whole point:
 * a bracket must be reproducible from the seed list alone if it is ever
 * disputed, and it must be re-derivable after a crash.
 *
 * ## Responsibility boundary
 *
 * This module consumes a **seed count** and nothing else. It never reads
 * scores, never calls the Evaluation Engine, and never decides who qualified —
 * that is `seeding.ts`. Bracket generation takes the final seeding list as
 * given (see the E3 brief: "Bracket generation consumes only the final seeding
 * list").
 *
 * ## The whole tree is built at once
 *
 * Every match of every knockout round is materialised up-front, with empty
 * competitor slots upstream and `nextMatchId`/`nextMatchSlot` links already
 * wired. Advancement then *fills* slots rather than *creating* matches. This
 * is what guarantees the invariants the brief asks for — no duplicate matches,
 * no orphan rounds, a single deterministic topology — and it means a restart
 * mid-bracket has nothing to reconstruct.
 */

/**
 * Standard single-elimination seed order: the sequence of seeds reading down
 * the first round, so that seed 1 and seed 2 can only meet in the final and
 * every round pairs the best surviving seed against the worst.
 *
 * Built by repeated reflection: `[1] → [1,2] → [1,4,2,3] → [1,8,4,5,2,7,3,6]`.
 * At each doubling, every seed `s` in a bracket of `n` is followed by its new
 * complement `n+1-s`.
 */
export function seedOrder(size: number): number[] {
  if (size < 1 || (size & (size - 1)) !== 0) {
    throw new Error(`seedOrder requires a power of two, got ${size}`);
  }
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const seed of order) {
      next.push(seed, n + 1 - seed);
    }
    order = next;
  }
  return order;
}

export interface MatchPlan {
  stage: RoundStage;
  /** 0-based slot within its own round. Unique per (round, position). */
  bracketPosition: number;
  /** Seed occupying each side, or null when the slot is a bye. */
  seedA: number | null;
  seedB: number | null;
  /** Where the winner goes. Null for the terminal match of a line. */
  nextStage: RoundStage | null;
  nextPosition: number | null;
  nextSlot: MatchSlot | null;
  /** Where the loser goes — semi-finals only, and only with third place on. */
  loserNextStage: RoundStage | null;
  loserNextPosition: number | null;
  loserNextSlot: MatchSlot | null;
}

export interface RoundPlan {
  stage: RoundStage;
  /** Play order across the tournament, 0-based. */
  sequence: number;
  matchCount: number;
}

export interface BracketPlan {
  bracketSize: BracketSize;
  thirdPlaceEnabled: boolean;
  qualifiedCount: number;
  /** Number of first-round matches decided by a bye. */
  byeCount: number;
  stages: RoundStage[];
  rounds: RoundPlan[];
  matches: MatchPlan[];
}

export interface BuildBracketInput {
  bracketSize: number;
  thirdPlaceEnabled: boolean;
  /** How many of the `bracketSize` seeds are actually occupied. */
  qualifiedCount: number;
}

export class BracketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BracketError';
  }
}

export function buildBracketPlan(input: BuildBracketInput): BracketPlan {
  const { bracketSize, thirdPlaceEnabled, qualifiedCount } = input;

  if (!isBracketSize(bracketSize)) {
    throw new BracketError(
      `unsupported bracket size ${bracketSize}; supported sizes are 8, 16, 32, 64 (D6)`,
    );
  }
  if (qualifiedCount < 2) {
    throw new BracketError(
      `a bracket needs at least 2 competitors, got ${qualifiedCount}`,
    );
  }
  if (qualifiedCount > bracketSize) {
    throw new BracketError(
      `${qualifiedCount} competitors do not fit a ${bracketSize}-slot bracket`,
    );
  }

  const stages = stagesForBracketSize(bracketSize, thirdPlaceEnabled);
  // The "main line" is the elimination path; third place hangs off it.
  const mainStages = stages.filter((stage) => stage !== 'THIRD_PLACE');

  const rounds: RoundPlan[] = stages.map((stage, index) => ({
    stage,
    sequence: index,
    matchCount:
      stage === 'THIRD_PLACE'
        ? 1
        : bracketSize / 2 ** (mainStages.indexOf(stage) + 1),
  }));

  const order = seedOrder(bracketSize);
  const matches: MatchPlan[] = [];
  let byeCount = 0;

  for (const [mainIndex, stage] of mainStages.entries()) {
    const matchCount = bracketSize / 2 ** (mainIndex + 1);
    const nextStage = mainStages[mainIndex + 1] ?? null;
    // Third place is fed by the losers of the round that precedes the final.
    const feedsThirdPlace = thirdPlaceEnabled && nextStage === 'FINAL';

    for (let position = 0; position < matchCount; position++) {
      const isFirstRound = mainIndex === 0;
      const rawSeedA = isFirstRound ? (order[position * 2] ?? null) : null;
      const rawSeedB = isFirstRound ? (order[position * 2 + 1] ?? null) : null;

      // A seed beyond the qualified field is an empty slot: its opponent
      // receives a bye. Seeds are stored only when occupied, so a null seed
      // and a null competitor always agree.
      const seedA =
        rawSeedA !== null && rawSeedA <= qualifiedCount ? rawSeedA : null;
      const seedB =
        rawSeedB !== null && rawSeedB <= qualifiedCount ? rawSeedB : null;
      if (isFirstRound && (seedA === null) !== (seedB === null)) byeCount++;

      matches.push({
        stage,
        bracketPosition: position,
        seedA,
        seedB,
        nextStage,
        nextPosition: nextStage === null ? null : Math.floor(position / 2),
        nextSlot: nextStage === null ? null : position % 2 === 0 ? 'A' : 'B',
        loserNextStage: feedsThirdPlace ? 'THIRD_PLACE' : null,
        loserNextPosition: feedsThirdPlace ? 0 : null,
        loserNextSlot: feedsThirdPlace ? (position === 0 ? 'A' : 'B') : null,
      });
    }
  }

  if (thirdPlaceEnabled && stages.includes('THIRD_PLACE')) {
    matches.push({
      stage: 'THIRD_PLACE',
      bracketPosition: 0,
      seedA: null,
      seedB: null,
      nextStage: null,
      nextPosition: null,
      nextSlot: null,
      loserNextStage: null,
      loserNextPosition: null,
      loserNextSlot: null,
    });
  }

  const plan: BracketPlan = {
    bracketSize,
    thirdPlaceEnabled,
    qualifiedCount,
    byeCount,
    stages,
    rounds,
    matches,
  };

  assertBracketPlanValid(plan);
  return plan;
}

/**
 * Structural invariants the brief requires, asserted at build time rather than
 * trusted. A malformed bracket would be discovered mid-event otherwise.
 */
export function assertBracketPlanValid(plan: BracketPlan): void {
  const positions = new Set<string>();
  for (const match of plan.matches) {
    const key = `${match.stage}#${match.bracketPosition}`;
    if (positions.has(key)) {
      throw new BracketError(`duplicate match at ${key}`);
    }
    positions.add(key);
  }

  // No orphan rounds: every planned round has the matches it claims, and every
  // match belongs to a planned round.
  for (const round of plan.rounds) {
    const actual = plan.matches.filter((m) => m.stage === round.stage).length;
    if (actual !== round.matchCount) {
      throw new BracketError(
        `round ${round.stage} plans ${round.matchCount} matches but ${actual} were built`,
      );
    }
    if (actual === 0) {
      throw new BracketError(`round ${round.stage} is orphaned (no matches)`);
    }
  }

  // No duplicate participants: each seed appears in exactly one slot.
  const seen = new Map<number, string>();
  for (const match of plan.matches) {
    for (const seed of [match.seedA, match.seedB]) {
      if (seed === null) continue;
      const key = `${match.stage}#${match.bracketPosition}`;
      const prior = seen.get(seed);
      if (prior) {
        throw new BracketError(
          `seed ${seed} appears in both ${prior} and ${key}`,
        );
      }
      seen.set(seed, key);
    }
  }
  for (let seed = 1; seed <= plan.qualifiedCount; seed++) {
    if (!seen.has(seed)) {
      throw new BracketError(`seed ${seed} was never placed in the bracket`);
    }
  }

  // Every winner link must point at a match that exists, and no two matches may
  // feed the same slot.
  const slots = new Set<string>();
  for (const match of plan.matches) {
    if (match.nextStage === null) continue;
    const target = `${match.nextStage}#${match.nextPosition}`;
    if (!positions.has(target)) {
      throw new BracketError(
        `${match.stage}#${match.bracketPosition} advances into ${target}, which does not exist`,
      );
    }
    const slotKey = `${target}:${match.nextSlot}`;
    if (slots.has(slotKey)) {
      throw new BracketError(`two matches feed ${slotKey}`);
    }
    slots.add(slotKey);
  }

  // Loser links follow the same rules.
  const loserSlots = new Set<string>();
  for (const match of plan.matches) {
    if (match.loserNextStage === null) continue;
    const target = `${match.loserNextStage}#${match.loserNextPosition}`;
    if (!positions.has(target)) {
      throw new BracketError(
        `${match.stage}#${match.bracketPosition} routes its loser into ${target}, which does not exist`,
      );
    }
    const slotKey = `${target}:${match.loserNextSlot}`;
    if (loserSlots.has(slotKey)) {
      throw new BracketError(`two matches feed loser slot ${slotKey}`);
    }
    loserSlots.add(slotKey);
  }

  // Exactly one terminal match on the main line (the final), plus third place.
  const terminal = plan.matches.filter((m) => m.nextStage === null);
  const expectedTerminal = plan.thirdPlaceEnabled ? 2 : 1;
  if (terminal.length !== expectedTerminal) {
    throw new BracketError(
      `expected ${expectedTerminal} terminal match(es), found ${terminal.length}`,
    );
  }
}

/** Total matches a bracket of this shape contains. */
export function matchCountForBracket(
  bracketSize: BracketSize,
  thirdPlaceEnabled: boolean,
): number {
  return bracketSize - 1 + (thirdPlaceEnabled ? 1 : 0);
}
