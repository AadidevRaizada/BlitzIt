import 'server-only';

/**
 * Tournament module — the public surface (module 4 in docs/04-module-breakdown).
 *
 * Owns: the lifecycle state machine, scheduling, registration, submission
 * windows, seeding, bracket topology, match advancement, and the stage →
 * evaluation-profile policy (D20).
 *
 * Does NOT own: evaluation (the Evaluation Engine), users/permissions
 * (Authentication), payments (E4), or submissions themselves (E5). Import from
 * here rather than reaching into individual files, so the boundary stays a
 * boundary.
 */

// ---- Configuration ----
export {
  SUPPORTED_BRACKET_SIZES,
  KNOCKOUT_STAGE_ORDER,
  STAGE_FIELD_SIZE,
  isBracketSize,
  stagesForBracketSize,
  autoBracketSize,
  baseTournamentConfig,
  resolveTournamentConfig,
  type BracketSize,
  type TournamentConfig,
  type TournamentConfigSource,
} from './config';

// ---- Lifecycle (pure state machine) ----
export {
  toLifecycleState,
  fromLifecycleState,
  nextState,
  canTransition,
  allowedTransitions,
  forwardTransition,
  knockoutStages,
  LifecycleError,
  InvalidTransitionError,
  TOURNAMENT_TRANSITIONS,
  TERMINAL_STATES,
  type LifecycleState,
  type TournamentTransition,
  type BracketShape,
} from './lifecycle';

// ---- Lifecycle (persisted) ----
export {
  applyTransition,
  getLifecycleState,
  transitionIdempotencyKey,
  type TransitionOptions,
  type TransitionResult,
} from './state';

// ---- CRUD ----
export {
  createTournament,
  updateTournament,
  updateTournamentSchedule,
  configureTournament,
  deleteTournament,
  getTournament,
  getTournamentBySlug,
  listTournaments,
  requireTournament,
  type ListTournamentsOptions,
} from './tournaments';

// ---- Registration ----
export {
  registerCompetitor,
  withdrawRegistration,
  countActiveRegistrations,
  isRegistered,
  assertRegistered,
  reconcileParticipantCount,
  type RegistrationResult,
} from './registration';

// ---- Rounds & submission windows ----
export {
  isSubmissionWindowOpen,
  getSubmissionWindow,
  createSimulationRounds,
  openRound,
  closeRound,
  completeRound,
  getStageRound,
  getSimulationRounds,
  loadTournamentConfig,
  type SubmissionWindow,
} from './rounds';

// ---- Seeding (D13) ----
export {
  collectSimulationResults,
  rankSeedingEntries,
  computeSeeding,
  getSeedingList,
  type SeedingEntry,
  type SeedingResult,
} from './seeding';

// ---- Bracket ----
export {
  seedOrder,
  buildBracketPlan,
  assertBracketPlanValid,
  matchCountForBracket,
  BracketError,
  type BracketPlan,
  type MatchPlan,
  type RoundPlan,
} from './bracket';

export {
  generateBracket,
  getBracket,
  type BracketGenerationResult,
} from './bracket-generate';

// ---- Win rule & advancement (D5) ----
export {
  decideMatch,
  rankByWinRule,
  TIE_BREAK_CHAIN,
  type CompetitorResult,
  type MatchOutcome,
  type WinRuleOptions,
} from './win-rule';

export {
  decideAndPropagate,
  advanceStage,
  resolveDeterminedMatches,
  getRoundCompletion,
  assignFinalPlacements,
  type MatchDecision,
  type RoundCompletion,
} from './advancement';

export {
  progressTournament,
  progressSimulation,
  getTournamentProgress,
  type ProgressResult,
} from './progress';

// ---- Evaluation policy (D20) ----
export {
  BUILT_IN_PROFILES,
  DEFAULT_STAGE_PROFILES,
  resolveEvaluationProfile,
  isAiActiveForStage,
  evaluationProfileConfigSchema,
  type EvaluationProfileConfig,
} from './evaluation-profiles';
