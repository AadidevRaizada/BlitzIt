import 'server-only';

/**
 * Submission module — the public surface (module 6 in docs/04-module-breakdown).
 *
 * Owns: accepting an entry, replacing it before the deadline, revision history,
 * sealing at the deadline, and handing work to the queue.
 *
 * Does NOT own: the schedule (Tournament decides when a window is open),
 * scoring (the Evaluation Engine, reached only via the `Queue`), or identity
 * (Authentication). Import from here rather than reaching into files.
 */

export {
  submitSolution,
  sealRoundSubmissions,
  getAdminSubmission,
  getSubmission,
  getMySubmission,
  listMySubmissions,
  getSubmissionHistory,
  listAllSubmissions,
  retryEvaluation,
  disqualifySubmission,
  type SubmitInput,
  type SubmissionResult,
  type SubmissionView,
  type EvaluationView,
  type AdminSubmissionView,
  type AdminEvaluationView,
} from './submissions';

export {
  nextSubmissionState,
  canSubmissionTransition,
  allowedSubmissionTransitions,
  toSubmissionState,
  toPersistedStatus,
  isSubmissionPending,
  isSubmissionSettled,
  isEvaluationResultCurrent,
  SUBMISSION_TRANSITIONS,
  SUBMISSION_STATE_LABEL,
  SubmissionStateError,
  InvalidSubmissionTransitionError,
  type SubmissionState,
  type SubmissionTransition,
} from './state';

export {
  validateRepoUrl,
  validateDeploymentUrl,
  validateCommitSha,
  validateSubmissionInput,
  assertCategorySupported,
  type ValidatedSubmissionInput,
} from './validation';
