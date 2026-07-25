import type { RoundStage, TournamentStatus } from '@/generated/prisma/client';
import { stagesForBracketSize, type BracketSize } from './config.public';

/**
 * The tournament state machine (E3.1).
 *
 * PURE. No database, no Next.js, no clock — every function here is a total
 * function of its arguments, which is what makes the whole lifecycle
 * exhaustively testable and makes `applyTransition` (in `state.ts`) a thin
 * persistence shell around a decision that was already made here.
 *
 * ## The lifecycle
 *
 * ```
 *   DRAFT
 *     ↓ PUBLISH
 *   PUBLISHED
 *     ↓ OPEN_REGISTRATION
 *   REGISTRATION_OPEN
 *     ↓ CLOSE_REGISTRATION
 *   REGISTRATION_CLOSED
 *     ↓ START_SIMULATION
 *   SIMULATION
 *     ↓ CLOSE_SIMULATION
 *   SEEDING                    ← simulation scores collapse into a seed list
 *     ↓ GENERATE_BRACKET
 *   BRACKET_GENERATED          ← full match tree materialised
 *     ↓ START_KNOCKOUT
 *   LIVE:R64 → LIVE:R32 → LIVE:R16 → LIVE:QF → LIVE:SF
 *            → LIVE:THIRD_PLACE (optional) → LIVE:FINAL
 *     ↓ COMPLETE
 *   COMPLETED
 * ```
 *
 * `CANCELLED` is reachable from every non-terminal state. `COMPLETED` and
 * `CANCELLED` are terminal: nothing leaves them.
 *
 * ## Why the state is a pair
 *
 * `TournamentStatus` alone cannot express "we are in the quarter-finals" — all
 * knockout rounds share `LIVE`. So the lifecycle state is the pair
 * (`status`, `currentStage`), flattened here into a single string key like
 * `LIVE:QF`. Both halves are persisted columns, so the engine can be killed at
 * any point and resume from exactly where it stopped.
 */

/** A flattened lifecycle state. `LIVE` is always qualified by its stage. */
export type LifecycleState =
  | 'DRAFT'
  | 'PUBLISHED'
  | 'REGISTRATION_OPEN'
  | 'REGISTRATION_CLOSED'
  | 'SIMULATION'
  | 'SEEDING'
  | 'BRACKET_GENERATED'
  | `LIVE:${RoundStage}`
  | 'COMPLETED'
  | 'CANCELLED';

export type TournamentTransition =
  | 'PUBLISH'
  | 'OPEN_REGISTRATION'
  | 'CLOSE_REGISTRATION'
  | 'START_SIMULATION'
  | 'CLOSE_SIMULATION'
  | 'GENERATE_BRACKET'
  | 'START_KNOCKOUT'
  | 'ADVANCE_STAGE'
  | 'COMPLETE'
  | 'CANCEL';

export const TOURNAMENT_TRANSITIONS: readonly TournamentTransition[] = [
  'PUBLISH',
  'OPEN_REGISTRATION',
  'CLOSE_REGISTRATION',
  'START_SIMULATION',
  'CLOSE_SIMULATION',
  'GENERATE_BRACKET',
  'START_KNOCKOUT',
  'ADVANCE_STAGE',
  'COMPLETE',
  'CANCEL',
] as const;

export const TERMINAL_STATES: readonly LifecycleState[] = [
  'COMPLETED',
  'CANCELLED',
] as const;

/** Compose the flattened state from the two persisted columns. */
export function toLifecycleState(
  status: TournamentStatus,
  currentStage: RoundStage | null,
): LifecycleState {
  if (status !== 'LIVE') return status as LifecycleState;
  if (!currentStage) {
    // LIVE without a stage is not a representable lifecycle state. Rather than
    // invent one, surface it as an error at the call site.
    throw new LifecycleError(
      'tournament is LIVE but has no currentStage; the row is inconsistent',
    );
  }
  return `LIVE:${currentStage}`;
}

/** Split a flattened state back into the two persisted columns. */
export function fromLifecycleState(state: LifecycleState): {
  status: TournamentStatus;
  currentStage: RoundStage | null;
} {
  if (state.startsWith('LIVE:')) {
    return {
      status: 'LIVE',
      currentStage: state.slice('LIVE:'.length) as RoundStage,
    };
  }
  return { status: state as TournamentStatus, currentStage: null };
}

export class LifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifecycleError';
  }
}

export class InvalidTransitionError extends LifecycleError {
  readonly from: LifecycleState;
  readonly transition: TournamentTransition;

  constructor(from: LifecycleState, transition: TournamentTransition) {
    super(`transition ${transition} is not allowed from state ${from}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.transition = transition;
  }
}

/**
 * Static edges — everything except the knockout progression, whose targets
 * depend on the bracket's stage list and so are computed in `nextState`.
 */
const STATIC_EDGES: Partial<
  Record<LifecycleState, Partial<Record<TournamentTransition, LifecycleState>>>
> = {
  DRAFT: { PUBLISH: 'PUBLISHED' },
  PUBLISHED: { OPEN_REGISTRATION: 'REGISTRATION_OPEN' },
  REGISTRATION_OPEN: { CLOSE_REGISTRATION: 'REGISTRATION_CLOSED' },
  REGISTRATION_CLOSED: { START_SIMULATION: 'SIMULATION' },
  SIMULATION: { CLOSE_SIMULATION: 'SEEDING' },
  SEEDING: { GENERATE_BRACKET: 'BRACKET_GENERATED' },
};

/** Every state a tournament can be cancelled from (i.e. all non-terminal ones). */
function isTerminal(state: LifecycleState): boolean {
  return TERMINAL_STATES.includes(state);
}

/**
 * The knockout stage order this tournament actually plays. Required as soon as
 * the bracket exists, because `START_KNOCKOUT`/`ADVANCE_STAGE` targets differ
 * between an 8-team and a 64-team bracket, and between third-place on and off.
 */
export interface BracketShape {
  bracketSize: BracketSize;
  thirdPlaceEnabled: boolean;
}

export function knockoutStages(shape: BracketShape): RoundStage[] {
  return stagesForBracketSize(shape.bracketSize, shape.thirdPlaceEnabled);
}

/**
 * Resolve the state a transition leads to, or throw `InvalidTransitionError`.
 *
 * `shape` is only consulted for the knockout transitions; the earlier half of
 * the lifecycle runs before a bracket size is even known.
 */
export function nextState(
  from: LifecycleState,
  transition: TournamentTransition,
  shape?: BracketShape,
): LifecycleState {
  // CANCEL is universal but still validated: a completed or already-cancelled
  // tournament cannot be cancelled again.
  if (transition === 'CANCEL') {
    if (isTerminal(from)) throw new InvalidTransitionError(from, transition);
    return 'CANCELLED';
  }

  if (isTerminal(from)) throw new InvalidTransitionError(from, transition);

  const staticTarget = STATIC_EDGES[from]?.[transition];
  if (staticTarget) return staticTarget;

  if (transition === 'START_KNOCKOUT') {
    if (from !== 'BRACKET_GENERATED') {
      throw new InvalidTransitionError(from, transition);
    }
    const stages = requireShape(shape, transition);
    const first = stages[0];
    if (!first) throw new LifecycleError('bracket has no knockout stages');
    return `LIVE:${first}`;
  }

  if (transition === 'ADVANCE_STAGE') {
    const stage = liveStage(from, transition);
    const stages = requireShape(shape, transition);
    // A stage this bracket never plays (R16 in an 8-team draw, THIRD_PLACE
    // when the play-off is off) is not a state you can advance FROM. That is an
    // invalid transition, not an internal inconsistency.
    const index = stages.indexOf(stage);
    if (index < 0) throw new InvalidTransitionError(from, transition);
    const next = stages[index + 1];
    if (!next) {
      // The last stage advances by COMPLETE, not ADVANCE_STAGE.
      throw new InvalidTransitionError(from, transition);
    }
    return `LIVE:${next}`;
  }

  if (transition === 'COMPLETE') {
    const stage = liveStage(from, transition);
    const stages = requireShape(shape, transition);
    if (stages[stages.length - 1] !== stage) {
      // Completing before the final round is over would strand matches.
      throw new InvalidTransitionError(from, transition);
    }
    return 'COMPLETED';
  }

  throw new InvalidTransitionError(from, transition);
}

function liveStage(
  from: LifecycleState,
  transition: TournamentTransition,
): RoundStage {
  if (!from.startsWith('LIVE:')) {
    throw new InvalidTransitionError(from, transition);
  }
  return from.slice('LIVE:'.length) as RoundStage;
}

function requireShape(
  shape: BracketShape | undefined,
  transition: TournamentTransition,
): RoundStage[] {
  if (!shape) {
    throw new LifecycleError(
      `${transition} needs the bracket shape (size + third-place flag) to resolve its target state`,
    );
  }
  return knockoutStages(shape);
}

/** Non-throwing form — useful for UI gating and for exhaustive tests. */
export function canTransition(
  from: LifecycleState,
  transition: TournamentTransition,
  shape?: BracketShape,
): boolean {
  try {
    nextState(from, transition, shape);
    return true;
  } catch {
    return false;
  }
}

/** Every transition legal from `from`, in declaration order. */
export function allowedTransitions(
  from: LifecycleState,
  shape?: BracketShape,
): TournamentTransition[] {
  return TOURNAMENT_TRANSITIONS.filter((t) => canTransition(from, t, shape));
}

/**
 * The single transition that drives a tournament forward from `from`, ignoring
 * `CANCEL`. Used by the scheduler so cron never has to encode the graph.
 * Returns null in terminal states.
 */
export function forwardTransition(
  from: LifecycleState,
  shape?: BracketShape,
): TournamentTransition | null {
  return allowedTransitions(from, shape).find((t) => t !== 'CANCEL') ?? null;
}
