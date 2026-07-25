import 'server-only';

/**
 * Problem Delivery module — the public surface (module 5 in
 * docs/04-module-breakdown).
 *
 * Owns: authoring problems and their hidden tests, publishing, archiving, and
 * assigning a problem to a round.
 *
 * Does NOT own: revealing a problem to competitors — that is gated on the
 * round's `opensAt`, which the Tournament module owns (`getRevealedRound`).
 *
 * **Hidden tests never leave the server.** `getProblemDetail` is the only read
 * that carries test specs, and it requires an admin.
 */

export {
  createProblem,
  updateProblem,
  publishProblem,
  archiveProblem,
  addHiddenTest,
  removeHiddenTest,
  assignProblemToRound,
  listProblems,
  listAssignableProblems,
  getProblemDetail,
  type CreateProblemInput,
  type UpdateProblemInput,
  type HiddenTestInput,
  type ProblemSummary,
  type ProblemDetail,
} from './problems';
