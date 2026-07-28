import type { TournamentStatus } from '@/generated/prisma/client';
import type { TournamentTransition } from './lifecycle';

/**
 * The schedule/lifecycle relationship, as one model (D33).
 *
 * ## The question this file answers
 *
 * A tournament has two descriptions of itself: a **plan** (five schedule
 * timestamps) and a **position** (`status` + `currentStage`). They can
 * disagree, and when they did, production broke in four different-looking ways
 * that were all the same bug — a page reading "REGISTRATION OPEN" directly
 * above "registration has not opened yet", tournaments wedged with no exit, an
 * `OPEN_REGISTRATION` firing half an hour after the window it opened had shut,
 * and drafts publishing themselves 35 seconds after creation.
 *
 * ## Derived, cached, or reconciled?
 *
 * **Not derived.** Status cannot be a pure function of the schedule, because
 * transitions do irreversible work: `CLOSE_REGISTRATION` creates the simulation
 * rounds, `CLOSE_SIMULATION` computes seeding, `GENERATE_BRACKET` writes the
 * whole match tree. A derived status would claim a tournament was SEEDING while
 * no seeding had ever run. Status also depends on facts outside the schedule —
 * `CLOSE_REGISTRATION` refuses below `minRegistrations` — so the clock alone
 * cannot decide it.
 *
 * **Not cached.** That is precisely what it was. The schedule wrote the status
 * once, at transition time, and nothing ever invalidated it. Editing the plan
 * afterwards left a stale position with no mechanism to notice.
 *
 * **Reconciled.** Status stays stored, because it records work that really
 * happened. But the schedule is the *plan*, so this module computes the state
 * the plan justifies — `targetStatusFor` — and convergence happens by applying
 * real transitions through the real state machine, guards and audit intact. The
 * stored status is therefore never authoritative about *where the tournament
 * should be*; it is only authoritative about *what has already been done*.
 *
 * Two invariants make the divergence class impossible rather than merely fixed:
 *
 *   1. **Forward drift self-heals.** The sweep reconciles continuously, so a
 *      schedule that has moved ahead of the status converges on its own — in
 *      ONE pass, not one milestone per sweep tick.
 *   2. **Backward drift is refused at the door.** A milestone that has already
 *      been passed cannot have its anchor moved into the future
 *      (`scheduleEditConflicts`). The plan may be rewritten freely ahead of the
 *      tournament and never behind it.
 *
 * Everything here is PURE. The sweep, the schedule editor, the admin panel and
 * the public countdown all read these same functions, so there is exactly one
 * definition of "what happens next" in the product.
 */

/**
 * The minimum a caller must supply. Deliberately does NOT include
 * `currentStage`: nothing here reads it (stage progression is round-driven,
 * not schedule-driven), and requiring it forced every read model to widen its
 * own `string` stage column to `RoundStage` just to call a schedule function.
 */
export interface ScheduledTournament {
  status: TournamentStatus;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  simulationOpensAt: Date | null;
  simulationClosesAt: Date | null;
  liveStartsAt: Date | null;
}

/** The schedule columns, by name, so edits can be checked field by field. */
export type ScheduleAnchor =
  | 'registrationOpensAt'
  | 'registrationClosesAt'
  | 'simulationOpensAt'
  | 'simulationClosesAt'
  | 'liveStartsAt';

export type ScheduleInput = Partial<Record<ScheduleAnchor, Date | null>>;

/**
 * The automatic path, in order.
 *
 * `DRAFT` is deliberately absent. Creating a tournament is not the same as
 * saying it is ready, and auto-publishing made that mistake: a draft still
 * being configured went public 35 seconds after creation because its
 * `registrationOpensAt` happened to be in the past. **The schedule becomes
 * authoritative only once an operator has published.**
 */
const MILESTONES: ReadonlyArray<{
  from: TournamentStatus;
  to: TournamentStatus;
  transition: TournamentTransition;
  /** Null for a milestone that fires as soon as the guards allow. */
  anchor: ScheduleAnchor | null;
  label: string;
}> = [
  {
    from: 'PUBLISHED',
    to: 'REGISTRATION_OPEN',
    transition: 'OPEN_REGISTRATION',
    anchor: 'registrationOpensAt',
    label: 'Registration opens',
  },
  {
    from: 'REGISTRATION_OPEN',
    to: 'REGISTRATION_CLOSED',
    transition: 'CLOSE_REGISTRATION',
    anchor: 'registrationClosesAt',
    label: 'Registration closes',
  },
  {
    from: 'REGISTRATION_CLOSED',
    to: 'SIMULATION',
    transition: 'START_SIMULATION',
    anchor: 'simulationOpensAt',
    label: 'Qualifiers open',
  },
  {
    from: 'SIMULATION',
    to: 'SEEDING',
    transition: 'CLOSE_SIMULATION',
    anchor: 'simulationClosesAt',
    label: 'Qualifiers close and seeding runs',
  },
  {
    from: 'SEEDING',
    to: 'BRACKET_GENERATED',
    transition: 'GENERATE_BRACKET',
    anchor: null,
    label: 'Bracket generates',
  },
  {
    from: 'BRACKET_GENERATED',
    to: 'LIVE',
    transition: 'START_KNOCKOUT',
    anchor: 'liveStartsAt',
    label: 'Knockout begins',
  },
] as const;

/** Position on the automatic path. CANCELLED is off it entirely. */
const STATUS_ORDER: readonly TournamentStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SIMULATION',
  'SEEDING',
  'BRACKET_GENERATED',
  'LIVE',
  'COMPLETED',
] as const;

function orderOf(status: TournamentStatus): number {
  return STATUS_ORDER.indexOf(status);
}

/** Statuses the reconciler will look at. Everything else is off the path. */
export const AUTOMATED_STATUSES: readonly TournamentStatus[] = [
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SIMULATION',
  'SEEDING',
  'BRACKET_GENERATED',
] as const;

// ---------------------------------------------------------------------------
// Where the plan says the tournament should be
// ---------------------------------------------------------------------------

/**
 * The furthest status the schedule currently justifies.
 *
 * Walks the milestone chain from wherever the tournament is, consuming every
 * anchor already in the past, and stops at the first one still in the future.
 * That single behaviour is what fixes missed windows: a server that was down
 * overnight computes REGISTRATION_CLOSED (or further) immediately, rather than
 * opening registration and then closing it thirty seconds later.
 *
 * `LIVE` is the end of the line here. Stages advance on round completion, not
 * on the clock, so the schedule has nothing to say past kickoff.
 */
export function targetStatusFor(
  tournament: ScheduledTournament,
  now: Date,
): TournamentStatus {
  let status = tournament.status;
  if (!AUTOMATED_STATUSES.includes(status)) return status;

  // Bounded by the chain length; each step strictly advances.
  for (let step = 0; step < MILESTONES.length; step++) {
    const milestone = MILESTONES.find((m) => m.from === status);
    if (!milestone) break;
    const anchor = milestone.anchor
      ? tournament[milestone.anchor]
      : // No anchor: due the moment the tournament arrives in this state.
        now;
    if (anchor === null || anchor > now) break;
    status = milestone.to;
  }
  return status;
}

export interface ScheduledStep {
  transition: TournamentTransition;
  /** Null means "as soon as the guards allow". */
  dueAt: Date | null;
  anchor: ScheduleAnchor | null;
  label: string;
}

/**
 * The next milestone the schedule will fire, due or not. Null when the
 * tournament is off the automatic path or has no anchor set for its next step.
 */
export function nextScheduledStep(
  tournament: ScheduledTournament,
): ScheduledStep | null {
  const milestone = MILESTONES.find((m) => m.from === tournament.status);
  if (!milestone) return null;
  const dueAt = milestone.anchor ? tournament[milestone.anchor] : null;
  if (milestone.anchor && dueAt === null) return null;
  return {
    transition: milestone.transition,
    dueAt,
    anchor: milestone.anchor,
    label: milestone.label,
  };
}

/**
 * The ordered transitions that carry a tournament from where it is to where the
 * plan says it should be. Empty when already converged.
 *
 * Every intermediate transition is still applied — they are not ceremony, they
 * are the work (creating rounds, seeding, building the bracket). What changed is
 * that they all run in ONE reconciliation pass instead of one per sweep tick.
 */
export function reconciliationPath(
  tournament: ScheduledTournament,
  now: Date,
): TournamentTransition[] {
  const target = targetStatusFor(tournament, now);
  const path: TournamentTransition[] = [];
  let status = tournament.status;

  // The milestone chain IS the path — walking it directly avoids reasoning
  // about the `LIVE:<stage>` encoding, which only matters once the knockout has
  // started and the schedule no longer drives anything.
  for (let step = 0; step < MILESTONES.length; step++) {
    if (orderOf(status) >= orderOf(target)) break;
    const milestone = MILESTONES.find((m) => m.from === status);
    if (!milestone) break;
    path.push(milestone.transition);
    status = milestone.to;
  }
  return path;
}

// ---------------------------------------------------------------------------
// Schedule edits
// ---------------------------------------------------------------------------

export interface ScheduleConflict {
  anchor: ScheduleAnchor;
  label: string;
  message: string;
}

/**
 * Why an edit would leave the tournament contradicting itself.
 *
 * The rule is one sentence: **a milestone that has already happened cannot be
 * scheduled for the future.** Anything ahead of the tournament may be rewritten
 * freely; anything behind it may be corrected, but only to another past time.
 *
 * This is the invariant that makes the whole bug class unreachable. Forward
 * drift is repaired automatically by the reconciler, and backward drift — the
 * kind that produced "REGISTRATION OPEN / registration has not opened yet" —
 * can no longer be written to the database at all.
 *
 * Rejecting rather than auto-correcting is deliberate. Silently rewriting an
 * operator's timestamps to satisfy an invariant is how you get a schedule
 * nobody believes; a refusal that names the field and says why leaves them in
 * control, and the recovery is always available (move the anchor to a past
 * time, or move the FUTURE anchors instead).
 */
export function scheduleEditConflicts(
  tournament: ScheduledTournament,
  proposed: ScheduleInput,
  now: Date,
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  const reached = orderOf(tournament.status);

  for (const milestone of MILESTONES) {
    if (!milestone.anchor) continue;
    // Has the tournament already moved past this milestone?
    if (reached < orderOf(milestone.to)) continue;

    const value = proposed[milestone.anchor];
    if (value === undefined || value === null) continue;
    if (value <= now) continue;

    conflicts.push({
      anchor: milestone.anchor,
      label: milestone.label,
      message:
        `${milestone.label} already happened — the tournament is ${tournament.status}. ` +
        'It cannot be scheduled for the future. Correct it to a past time, or ' +
        'edit the milestones that have not happened yet.',
    });
  }

  return conflicts;
}

// ---------------------------------------------------------------------------
// One definition of "what is true right now"
// ---------------------------------------------------------------------------

/**
 * Can a competitor register at this instant?
 *
 * The single source the registration guard, the badge and the register panel
 * all read. Previously the badge rendered `status` while the guard checked the
 * window, which is how one page asserted both halves of a contradiction.
 */
export function registrationOpenNow(
  tournament: ScheduledTournament,
  now: Date,
): boolean {
  if (tournament.status !== 'REGISTRATION_OPEN') return false;
  if (tournament.registrationOpensAt && now < tournament.registrationOpensAt) {
    return false;
  }
  if (
    tournament.registrationClosesAt &&
    now > tournament.registrationClosesAt
  ) {
    return false;
  }
  return true;
}

export interface RealEvent {
  label: string;
  /** Null when the event is due but waiting on a guard rather than a clock. */
  at: Date | null;
  /** True when the anchor has passed and the transition is pending. */
  overdue: boolean;
}

/**
 * The next thing that will genuinely happen.
 *
 * Countdowns must be driven by this and never by `status` alone. The old
 * `resolveCountdown` read the status, saw REGISTRATION_OPEN, and counted down
 * to `registrationClosesAt` — for a registration that was not open and could
 * not be joined. A countdown is a promise; this is the only function allowed to
 * make one.
 */
export function nextRealEvent(
  tournament: ScheduledTournament,
  now: Date,
): RealEvent | null {
  const step = nextScheduledStep(tournament);
  if (!step) return null;
  if (step.dueAt === null) {
    return { label: step.label, at: null, overdue: true };
  }
  return {
    label: step.label,
    at: step.dueAt,
    overdue: step.dueAt <= now,
  };
}
