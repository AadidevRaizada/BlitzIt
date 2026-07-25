import type { SubmissionStatus } from '@/generated/prisma/client';

/**
 * The submission state machine (E4). PURE — no database, no clock.
 *
 * ## Domain states vs the persisted enum
 *
 * The E4 brief sketches the lifecycle as
 * `DRAFT → READY → QUEUED → EVALUATING → EVALUATED → FAILED → RESUBMITTED`.
 * The `SubmissionStatus` enum that E2 and E3 already read and write uses
 * different spellings for the same things, so this module keeps the domain
 * vocabulary and maps it onto the persisted values rather than adding a second
 * set of enum members that would mean the same thing:
 *
 * | Domain state | Persisted `SubmissionStatus` |
 * |---|---|
 * | `READY`         | `RECEIVED`      |
 * | `QUEUED`        | `QUEUED`        |
 * | `EVALUATING`    | `JUDGING`       |
 * | `EVALUATED`     | `SCORED`        |
 * | `FAILED`        | `FAILED`        |
 * | `DISQUALIFIED`  | `DISQUALIFIED`  |
 *
 * Two states from the sketch are deliberately absent from the persisted set:
 *
 * - **DRAFT** is not persisted. A `Submission` row exists only once an entry
 *   has been accepted; before that the draft lives in the form. Persisting
 *   drafts would put unsubmitted rows inside the `(userId, roundId)` unique key
 *   that E3's advancement reads through, and would make "did they submit?"
 *   ambiguous at the deadline. It is modelled here as the start state so the
 *   graph is total, but nothing ever *rests* in it.
 * - **RESUBMITTED** is a transition, not a state. After resubmitting, an entry
 *   is queued for evaluation — it is not sitting in some "resubmitted" limbo.
 *   Recording it as a state would mean a submission could be left there
 *   forever. The history of replacements lives in `SubmissionRevision`.
 *
 * Adding `DRAFT`/`READY`/`EVALUATING`/`EVALUATED`/`RESUBMITTED` to the Postgres
 * enum would have left two vocabularies for one concept — precisely the schema
 * drift the epic brief forbids — and would have silently broken E3's
 * `PENDING_SUBMISSION_STATUSES` and the `CLOSE_SIMULATION` guard, both of which
 * enumerate the current values.
 */

export type SubmissionState =
  | 'DRAFT'
  | 'READY'
  | 'QUEUED'
  | 'EVALUATING'
  | 'EVALUATED'
  | 'FAILED'
  | 'DISQUALIFIED';

export type SubmissionTransition =
  /** An accepted entry is created. */
  | 'SUBMIT'
  /** Handed to the queue. */
  | 'ENQUEUE'
  /** The runner picked it up. */
  | 'START'
  /** Scored successfully. */
  | 'COMPLETE'
  /** Evaluation exhausted its attempts. */
  | 'FAIL'
  /** Transient failure with attempts left — back to the queue. */
  | 'REQUEUE'
  /** Admin re-runs a finished or failed evaluation. */
  | 'RETRY'
  /** Competitor replaces their entry while the window is open. */
  | 'RESUBMIT'
  /** Admin removes an entry from competition (D19). */
  | 'DISQUALIFY';

export const SUBMISSION_TRANSITIONS: readonly SubmissionTransition[] = [
  'SUBMIT',
  'ENQUEUE',
  'START',
  'COMPLETE',
  'FAIL',
  'REQUEUE',
  'RETRY',
  'RESUBMIT',
  'DISQUALIFY',
] as const;

/** Domain state → the value actually stored on `Submission.status`. */
const TO_PERSISTED: Record<
  Exclude<SubmissionState, 'DRAFT'>,
  SubmissionStatus
> = {
  READY: 'RECEIVED',
  QUEUED: 'QUEUED',
  EVALUATING: 'JUDGING',
  EVALUATED: 'SCORED',
  FAILED: 'FAILED',
  DISQUALIFIED: 'DISQUALIFIED',
};

const FROM_PERSISTED: Record<SubmissionStatus, SubmissionState> = {
  RECEIVED: 'READY',
  QUEUED: 'QUEUED',
  JUDGING: 'EVALUATING',
  SCORED: 'EVALUATED',
  FAILED: 'FAILED',
  DISQUALIFIED: 'DISQUALIFIED',
};

export function toPersistedStatus(state: SubmissionState): SubmissionStatus {
  if (state === 'DRAFT') {
    throw new SubmissionStateError(
      'DRAFT is not a persisted state — a Submission row exists only once an entry is accepted',
    );
  }
  return TO_PERSISTED[state];
}

export function toSubmissionState(status: SubmissionStatus): SubmissionState {
  return FROM_PERSISTED[status];
}

export class SubmissionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmissionStateError';
  }
}

export class InvalidSubmissionTransitionError extends SubmissionStateError {
  readonly from: SubmissionState;
  readonly transition: SubmissionTransition;

  constructor(from: SubmissionState, transition: SubmissionTransition) {
    super(`transition ${transition} is not allowed from state ${from}`);
    this.name = 'InvalidSubmissionTransitionError';
    this.from = from;
    this.transition = transition;
  }
}

/**
 * The transition graph.
 *
 * `DISQUALIFIED` is terminal — an entry removed from competition is not
 * re-evaluated, and letting it re-enter the queue would quietly restore a score
 * an admin deliberately struck.
 */
const EDGES: Record<
  SubmissionState,
  Partial<Record<SubmissionTransition, SubmissionState>>
> = {
  DRAFT: { SUBMIT: 'READY' },
  READY: {
    ENQUEUE: 'QUEUED',
    RESUBMIT: 'READY',
    DISQUALIFY: 'DISQUALIFIED',
  },
  QUEUED: {
    START: 'EVALUATING',
    // A resubmission supersedes whatever is queued; the new revision is
    // enqueued in its place.
    RESUBMIT: 'READY',
    DISQUALIFY: 'DISQUALIFIED',
  },
  EVALUATING: {
    COMPLETE: 'EVALUATED',
    FAIL: 'FAILED',
    REQUEUE: 'QUEUED',
    RESUBMIT: 'READY',
    DISQUALIFY: 'DISQUALIFIED',
  },
  EVALUATED: {
    RETRY: 'QUEUED',
    RESUBMIT: 'READY',
    DISQUALIFY: 'DISQUALIFIED',
  },
  FAILED: {
    RETRY: 'QUEUED',
    RESUBMIT: 'READY',
    DISQUALIFY: 'DISQUALIFIED',
  },
  DISQUALIFIED: {},
};

/** Resolve the state a transition leads to, or throw. */
export function nextSubmissionState(
  from: SubmissionState,
  transition: SubmissionTransition,
): SubmissionState {
  const target = EDGES[from]?.[transition];
  if (!target) throw new InvalidSubmissionTransitionError(from, transition);
  return target;
}

/** Non-throwing form — for UI gating and exhaustive tests. */
export function canSubmissionTransition(
  from: SubmissionState,
  transition: SubmissionTransition,
): boolean {
  return Boolean(EDGES[from]?.[transition]);
}

export function allowedSubmissionTransitions(
  from: SubmissionState,
): SubmissionTransition[] {
  return SUBMISSION_TRANSITIONS.filter((t) => canSubmissionTransition(from, t));
}

/** True while a score could still arrive for this entry. */
export function isSubmissionPending(state: SubmissionState): boolean {
  return state === 'READY' || state === 'QUEUED' || state === 'EVALUATING';
}

/** True when the entry has reached a state that will not change on its own. */
export function isSubmissionSettled(state: SubmissionState): boolean {
  return (
    state === 'EVALUATED' || state === 'FAILED' || state === 'DISQUALIFIED'
  );
}

/**
 * May an evaluation result still be written?
 *
 * A competitor can replace their entry while an evaluation is in flight. The
 * processor captures the revision it loaded and asks this before persisting: if
 * the submission has moved on, the result describes code nobody is competing
 * with any more, and a fresh job is already queued for the new revision.
 * Writing it anyway would overwrite the new revision's score with the old one's.
 *
 * A disqualified entry is likewise never written back — that would restore a
 * score an admin deliberately struck.
 *
 * PURE and exported so the rule is unit-testable without racing a real
 * evaluation, which is inherently timing-dependent.
 */
export function isEvaluationResultCurrent(input: {
  /** Revision the evaluation was run against. */
  evaluatedVersion: number;
  /** The submission as it stands now, or null if it was deleted. */
  current: { version: number; status: SubmissionStatus } | null;
}): boolean {
  if (!input.current) return false;
  if (input.current.status === 'DISQUALIFIED') return false;
  return input.current.version === input.evaluatedVersion;
}

/** Human-readable label for the UI. Kept next to the machine so they agree. */
export const SUBMISSION_STATE_LABEL: Record<SubmissionState, string> = {
  DRAFT: 'Draft',
  READY: 'Accepted',
  QUEUED: 'Queued',
  EVALUATING: 'Evaluating',
  EVALUATED: 'Scored',
  FAILED: 'Evaluation failed',
  DISQUALIFIED: 'Disqualified',
};
