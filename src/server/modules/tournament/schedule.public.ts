import type { RoundStage, TournamentStatus } from '@/generated/prisma/client';
import type { TournamentTransition } from './lifecycle';

/**
 * The schedule as the source of truth for lifecycle progression (D8).
 *
 * ## The inconsistency this resolves
 *
 * A tournament's schedule columns were only ever read as **gates** — permission
 * checks that refuse an action before its time — and never as **triggers**.
 * Nothing anywhere noticed that `registrationOpensAt` had passed. Meanwhile the
 * public pages rendered a countdown to that instant, so the product promised an
 * event that no code was going to cause: the clock reached 00:00, and the
 * tournament sat in PUBLISHED until an operator happened to press a button.
 *
 * The schedule now drives the lifecycle. This module is the mapping, and it is
 * PURE — a total function of (row, now) with no database and no clock of its
 * own — so the sweep that fires transitions and the UI that promises them read
 * the same rule and cannot drift.
 *
 * ## Anchors, not commands
 *
 * A due transition is still only *offered*. `applyTransition` re-checks every
 * business guard, so "the clock says close registration" never overrides "only
 * 3 competitors registered and the minimum is 8". The schedule decides WHEN a
 * transition is attempted; the state machine decides whether it is allowed.
 *
 * ## What stays manual
 *
 * - `CANCEL` — never automatic, by definition.
 * - `ADVANCE_STAGE` / `COMPLETE` — driven by round completion in `progress.ts`,
 *   not by wall-clock time. A stage ends when its matches are decided.
 *
 * Everything else on the happy path runs itself.
 */

export interface ScheduledTournament {
  status: TournamentStatus;
  currentStage: RoundStage | null;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  simulationOpensAt: Date | null;
  simulationClosesAt: Date | null;
  liveStartsAt: Date | null;
}

export interface ScheduledStep {
  transition: TournamentTransition;
  /**
   * The instant that authorises it. Null means "as soon as the guards allow" —
   * used for `GENERATE_BRACKET`, which has no anchor of its own because seeding
   * finishing is the only thing it waits for.
   */
  dueAt: Date | null;
  /** Which schedule column this reads, for explaining it on screen. */
  anchor: keyof ScheduledTournament | null;
  /** What a person should understand is about to happen. */
  label: string;
}

/**
 * The next transition the schedule will fire, regardless of whether it is due
 * yet. Null when the tournament is not on the automatic path.
 *
 * `DRAFT` is included deliberately, but only once a `registrationOpensAt` has
 * been set: choosing when registration opens IS the statement that the draft is
 * finished. A draft with no schedule stays a draft forever, which is what a
 * draft is for.
 */
export function nextScheduledStep(
  tournament: ScheduledTournament,
): ScheduledStep | null {
  switch (tournament.status) {
    case 'DRAFT':
      if (!tournament.registrationOpensAt) return null;
      return {
        transition: 'PUBLISH',
        dueAt: tournament.registrationOpensAt,
        anchor: 'registrationOpensAt',
        label: 'Publish',
      };

    case 'PUBLISHED':
      if (!tournament.registrationOpensAt) return null;
      return {
        transition: 'OPEN_REGISTRATION',
        dueAt: tournament.registrationOpensAt,
        anchor: 'registrationOpensAt',
        label: 'Registration opens',
      };

    case 'REGISTRATION_OPEN':
      if (!tournament.registrationClosesAt) return null;
      return {
        transition: 'CLOSE_REGISTRATION',
        dueAt: tournament.registrationClosesAt,
        anchor: 'registrationClosesAt',
        label: 'Registration closes',
      };

    case 'REGISTRATION_CLOSED':
      if (!tournament.simulationOpensAt) return null;
      return {
        transition: 'START_SIMULATION',
        dueAt: tournament.simulationOpensAt,
        anchor: 'simulationOpensAt',
        label: 'Simulation starts',
      };

    case 'SIMULATION':
      // Individual simulation rounds open and close on their own deadlines via
      // the round sweep. This is the phase boundary: it needs BOTH the clock
      // and every round finished, and the guard enforces the latter.
      if (!tournament.simulationClosesAt) return null;
      return {
        transition: 'CLOSE_SIMULATION',
        dueAt: tournament.simulationClosesAt,
        anchor: 'simulationClosesAt',
        label: 'Simulation closes and seeding runs',
      };

    case 'SEEDING':
      // No anchor. Seeding is the only prerequisite and it has just happened,
      // so the bracket is built immediately rather than idling until the next
      // wall-clock milestone.
      return {
        transition: 'GENERATE_BRACKET',
        dueAt: null,
        anchor: null,
        label: 'Bracket generates',
      };

    case 'BRACKET_GENERATED':
      if (!tournament.liveStartsAt) return null;
      return {
        transition: 'START_KNOCKOUT',
        dueAt: tournament.liveStartsAt,
        anchor: 'liveStartsAt',
        label: 'Knockout begins',
      };

    // LIVE advances on round completion, not on the clock — a stage ends when
    // its matches are decided. `progressTournament` owns that.
    case 'LIVE':
    case 'COMPLETED':
    case 'CANCELLED':
      return null;
  }
}

/**
 * The transition to attempt right now, or null. A `dueAt` of null means the
 * step is due the moment the tournament enters that state.
 */
export function dueScheduledTransition(
  tournament: ScheduledTournament,
  now: Date,
): TournamentTransition | null {
  const step = nextScheduledStep(tournament);
  if (!step) return null;
  if (step.dueAt !== null && step.dueAt > now) return null;
  return step.transition;
}

/**
 * Every status the sweep needs to look at. Kept next to the mapping so the SQL
 * filter and the switch above cannot fall out of step — a status added here but
 * missing from the query would simply never fire.
 */
export const AUTOMATED_STATUSES: readonly TournamentStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SIMULATION',
  'SEEDING',
  'BRACKET_GENERATED',
] as const;
