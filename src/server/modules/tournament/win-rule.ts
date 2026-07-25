import type { WinReason } from '@/generated/prisma/client';

/**
 * The win rule and its tie-break chain (D5). PURE.
 *
 * Winner = highest overall score. If tied, in order:
 *   1. higher Functional score
 *   2. more hidden tests passed
 *   3. faster submission
 *   4. better Performance
 *   5. higher AI score
 *   6. sudden-death challenge
 *
 * Everything here is a total function over two competitor records, so the
 * entire decision table is unit-testable without a database and a disputed
 * result can be recomputed exactly from the stored evaluation rows.
 */

/** One side of a match, as read from persisted state. */
export interface CompetitorResult {
  userId: string;
  /** Bracket seed, 1 = best. Null when the slot is empty. */
  seed: number | null;
  submissionId: string | null;
  submittedAt: Date | null;
  /** True while an evaluation for this submission is still outstanding. */
  evaluationPending: boolean;
  overallScore: number | null;
  functionalScore: number | null;
  testsPassed: number | null;
  performanceScore: number | null;
  aiScore: number | null;
}

export type MatchOutcome =
  /** Neither slot is occupied — nothing advances (deep-bye cascade). */
  | { kind: 'VOID'; winnerId: null; loserId: null; reason: null }
  /** One slot occupied: the occupant advances unopposed. */
  | { kind: 'BYE'; winnerId: string; loserId: null; reason: 'BYE' }
  /** Both occupied, but at least one never produced a scored submission. */
  | { kind: 'WALKOVER'; winnerId: string; loserId: string; reason: 'WALKOVER' }
  /** Decided on scores or a tie-break. */
  | { kind: 'DECIDED'; winnerId: string; loserId: string; reason: WinReason }
  /** Evaluations are still outstanding — do not decide yet. */
  | { kind: 'PENDING'; winnerId: null; loserId: null; reason: null }
  /** Every tie-break exhausted; needs a sudden-death challenge (D5.6). */
  | { kind: 'TIE'; winnerId: null; loserId: null; reason: null };

export interface WinRuleOptions {
  /**
   * When neither competitor submitted, advance the better seed instead of
   * leaving the match — and therefore the whole bracket — undecided.
   */
  advanceHigherSeedOnDoubleNoShow: boolean;
  /**
   * Which tie-break chain to apply. Defaults to the D5 chain; sudden death
   * passes `SUDDEN_DEATH_CHAIN` (D14, functional-only).
   */
  chain?: ReadonlyArray<{ reason: WinReason; compare: Comparator }>;
  /**
   * Has the round's submission window closed?
   *
   * A missing submission only *means* something once nobody can submit any
   * more. While the window is open an absent submission is simply "not yet",
   * and deciding on it would hand the match to whoever submitted first — or,
   * worse, walk an entire freshly-opened bracket over on seed order the instant
   * the round started. Byes and void matches are structural, so they are
   * decided regardless of the window.
   */
  windowClosed: boolean;
}

/** Scores are persisted rounded to 2dp; this only absorbs float representation noise. */
const EPSILON = 1e-9;

type Comparator = (a: CompetitorResult, b: CompetitorResult) => number;

/** Higher wins. Missing values sort last. */
const higher =
  (pick: (r: CompetitorResult) => number | null): Comparator =>
  (a, b) => {
    const av = pick(a) ?? Number.NEGATIVE_INFINITY;
    const bv = pick(b) ?? Number.NEGATIVE_INFINITY;
    if (Math.abs(av - bv) < EPSILON) return 0;
    return av > bv ? -1 : 1;
  };

/** Earlier wins. Missing timestamps sort last. */
const earlier: Comparator = (a, b) => {
  const av = a.submittedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bv = b.submittedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (av === bv) return 0;
  return av < bv ? -1 : 1;
};

/**
 * The D5 chain, in order, each paired with the `WinReason` recorded when it is
 * the step that separated the competitors. Declared as data so the chain is
 * impossible to reorder accidentally and trivially enumerable in tests.
 */
export const TIE_BREAK_CHAIN: ReadonlyArray<{
  reason: WinReason;
  compare: Comparator;
}> = [
  { reason: 'SCORE', compare: higher((r) => r.overallScore) },
  {
    reason: 'TIEBREAK_FUNCTIONAL',
    compare: higher((r) => r.functionalScore),
  },
  { reason: 'TIEBREAK_TESTS', compare: higher((r) => r.testsPassed) },
  { reason: 'TIEBREAK_TIME', compare: earlier },
  {
    reason: 'TIEBREAK_PERFORMANCE',
    compare: higher((r) => r.performanceScore),
  },
  { reason: 'TIEBREAK_AI', compare: higher((r) => r.aiScore) },
] as const;

/**
 * The SUDDEN-DEATH chain (D14). Deliberately shorter and different from D5:
 * a sudden-death challenge is decided on **Functional score alone**, then more
 * hidden tests passed, then the earliest submission.
 *
 * Performance, security and AI are NOT consulted — D20 gives sudden death the
 * `functional-only` profile, so those dimensions are never even evaluated and
 * comparing them would be comparing zeroes.
 */
export const SUDDEN_DEATH_CHAIN: ReadonlyArray<{
  reason: WinReason;
  compare: Comparator;
}> = [
  { reason: 'TIEBREAK_FUNCTIONAL', compare: higher((r) => r.functionalScore) },
  { reason: 'TIEBREAK_TESTS', compare: higher((r) => r.testsPassed) },
  { reason: 'TIEBREAK_TIME', compare: earlier },
] as const;

/** A competitor counts as having played only once their submission is scored. */
function hasScore(result: CompetitorResult): boolean {
  return result.submissionId !== null && result.overallScore !== null;
}

export function decideMatch(
  a: CompetitorResult | null,
  b: CompetitorResult | null,
  options: WinRuleOptions,
): MatchOutcome {
  if (!a && !b) {
    return { kind: 'VOID', winnerId: null, loserId: null, reason: null };
  }
  const solo = a ?? b;
  if (!a || !b) {
    return {
      kind: 'BYE',
      winnerId: solo!.userId,
      loserId: null,
      reason: 'BYE',
    };
  }

  // Never decide while a score could still arrive — an early decision would be
  // wrong and, because advancement is idempotent-by-winner, hard to undo.
  if (a.evaluationPending || b.evaluationPending) {
    return { kind: 'PENDING', winnerId: null, loserId: null, reason: null };
  }

  const aPlayed = hasScore(a);
  const bPlayed = hasScore(b);

  // Both competitors scored: decidable immediately, even mid-window — there is
  // nothing left to wait for. Anything else waits for the deadline.
  if (!options.windowClosed && !(aPlayed && bPlayed)) {
    return { kind: 'PENDING', winnerId: null, loserId: null, reason: null };
  }

  if (aPlayed !== bPlayed) {
    const winner = aPlayed ? a : b;
    const loser = aPlayed ? b : a;
    return {
      kind: 'WALKOVER',
      winnerId: winner.userId,
      loserId: loser.userId,
      reason: 'WALKOVER',
    };
  }

  if (!aPlayed && !bPlayed) {
    if (!options.advanceHigherSeedOnDoubleNoShow) {
      return { kind: 'TIE', winnerId: null, loserId: null, reason: null };
    }
    // Lower seed number = better. Unseeded sorts last.
    const aSeed = a.seed ?? Number.POSITIVE_INFINITY;
    const bSeed = b.seed ?? Number.POSITIVE_INFINITY;
    if (aSeed === bSeed) {
      return { kind: 'TIE', winnerId: null, loserId: null, reason: null };
    }
    const winner = aSeed < bSeed ? a : b;
    const loser = aSeed < bSeed ? b : a;
    return {
      kind: 'WALKOVER',
      winnerId: winner.userId,
      loserId: loser.userId,
      reason: 'WALKOVER',
    };
  }

  for (const step of options.chain ?? TIE_BREAK_CHAIN) {
    const order = step.compare(a, b);
    if (order === 0) continue;
    const winner = order < 0 ? a : b;
    const loser = order < 0 ? b : a;
    return {
      kind: 'DECIDED',
      winnerId: winner.userId,
      loserId: loser.userId,
      reason: step.reason,
    };
  }

  // Every tie-break exhausted. D5 says this goes to a sudden-death challenge,
  // which is a later epic; the match is flagged rather than silently resolved.
  return { kind: 'TIE', winnerId: null, loserId: null, reason: null };
}

/**
 * Rank competitors by the same chain, for seeding cutlines and final
 * standings. Stable: equal competitors keep their input order.
 */
export function rankByWinRule(
  competitors: readonly CompetitorResult[],
): CompetitorResult[] {
  return competitors
    .map((competitor, index) => ({ competitor, index }))
    .sort((left, right) => {
      for (const step of TIE_BREAK_CHAIN) {
        const order = step.compare(left.competitor, right.competitor);
        if (order !== 0) return order;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.competitor);
}
