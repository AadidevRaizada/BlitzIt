import type { MatchStatus } from '@/generated/prisma/client';
import type { TimerPhase } from './timers.public';

/**
 * The Knockout Arena's state vocabulary — the pure half (E7.2).
 *
 * Screen [10] shows one of a handful of clearly different things: a countdown
 * to the reveal, a live round, "we are judging", a deadlock waiting on sudden
 * death, or a result. Which one is a *derivation* from persisted facts, never a
 * stored column — there is no arena state in the database and nothing to keep
 * in sync.
 *
 * Kept pure and free of `server-only` so both the page and the verification
 * suite can exercise every combination without a database.
 */

export type ArenaState =
  /** Scheduled; the problem is still withheld and the countdown runs to the reveal. */
  | 'WAITING'
  /** The window is open — submit, replace, iterate. */
  | 'LIVE'
  /** The window has closed and evaluations are still landing. */
  | 'JUDGING'
  /** Every tie-break failed; the match is held until an operator opens a decider (D14). */
  | 'TIED'
  /** A sudden-death challenge is under way for this match. */
  | 'SUDDEN_DEATH'
  | 'WON'
  | 'LOST'
  /** The match exists but was never scheduled (bracket built, round not opened). */
  | 'NOT_STARTED';

export interface ArenaStateInput {
  phase: TimerPhase;
  matchStatus: MatchStatus;
  tieUnresolved: boolean;
  /** True when a sudden-death challenge has been opened for this match. */
  suddenDeathOpen: boolean;
  /** Null while undecided. */
  winnerId: string | null;
  viewerId: string;
}

/**
 * Decide what the arena is showing.
 *
 * Order matters: a decided match is a result no matter what its window says
 * (a walkover is decided before the deadline), and a deadlock outranks
 * "judging" because it needs an operator, not more time.
 */
export function deriveArenaState(input: ArenaStateInput): ArenaState {
  if (input.matchStatus === 'DECIDED') {
    // A decided match with no winner cannot happen through advancement, but a
    // result screen that silently claims a loss would be worse than admitting
    // the state is unusual.
    if (!input.winnerId) return 'JUDGING';
    return input.winnerId === input.viewerId ? 'WON' : 'LOST';
  }

  if (input.suddenDeathOpen) return 'SUDDEN_DEATH';
  if (input.tieUnresolved) return 'TIED';

  switch (input.phase) {
    case 'UNSCHEDULED':
      return 'NOT_STARTED';
    case 'BEFORE_OPEN':
      return 'WAITING';
    case 'OPEN':
      return 'LIVE';
    case 'CLOSED':
      // The window is over but nothing has been decided yet: evaluations are
      // still running. This is the "evaluation outlasts the timer" case the
      // roadmap calls out — it is a normal state, not an error.
      return 'JUDGING';
  }
}

/**
 * Whether an opponent's progress may be shown yet.
 *
 * Hidden while the window is open. A competitor who learns their rival has
 * already submitted plays the person instead of the problem — they rush, or
 * they stop iterating — and nothing in the rules entitles them to that. Once
 * the window closes the same fact only explains a result.
 *
 * `UNSCHEDULED` and `BEFORE_OPEN` are safe: nobody can have submitted to a
 * round that has not opened.
 */
export function mayRevealOpponentProgress(phase: TimerPhase): boolean {
  return phase !== 'OPEN';
}

/** True while a competitor may still act; everything else is watching. */
export function isArenaActionable(state: ArenaState): boolean {
  return state === 'LIVE' || state === 'SUDDEN_DEATH';
}

export const ARENA_STATE_LABEL: Readonly<Record<ArenaState, string>> = {
  WAITING: 'Waiting for the round to open',
  LIVE: 'Round is live',
  JUDGING: 'Judging',
  TIED: 'Tied — awaiting sudden death',
  SUDDEN_DEATH: 'Sudden death',
  WON: 'You advanced',
  LOST: 'Eliminated',
  NOT_STARTED: 'Not scheduled yet',
};
