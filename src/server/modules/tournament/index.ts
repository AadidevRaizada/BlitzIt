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
  MIN_BRACKET_SIZE,
  MAX_BRACKET_SIZE,
  decideBracketSizing,
  explainBracketSizing,
  type BracketSizing,
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
  listPublicTournaments,
  publicTournamentBucket,
  requireTournament,
  type ListTournamentsOptions,
  type ListPublicTournamentsOptions,
  type PublicTournamentBucket,
  type PublicTournamentCard,
} from './tournaments';

// ---- Registration ----
export {
  registerCompetitor,
  registerCompetitorInTransaction,
  withdrawRegistration,
  countActiveSeatReservations,
  countCompetitionEligibleRegistrations,
  isRegistered,
  assertRegistered,
  reconcileParticipantCount,
  type RegistrationResult,
  type RegisterCompetitorOptions,
} from './registration';

// ---- Prize pool (E9.2) ----
export {
  countPaidEntries,
  derivePrizePoolBreakdown,
  getPrizePoolDisplay,
  recomputePrizePool,
  type PrizeAllocation,
  type PrizePoolBreakdown,
  type PrizePoolDisplay,
} from './prize-pool';

// ---- Rounds & submission windows ----
export {
  isSubmissionWindowOpen,
  getSubmissionWindow,
  createSimulationRounds,
  openRound,
  closeRound,
  completeRound,
  getRevealedRound,
  getStageRound,
  getSimulationRounds,
  listRounds,
  loadTournamentConfig,
  type SubmissionWindow,
  type RevealedRound,
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
  SUDDEN_DEATH_CHAIN,
  type CompetitorResult,
  type MatchOutcome,
  type WinRuleOptions,
} from './win-rule';

export {
  decideAndPropagate,
  advanceStage,
  resolveDeterminedMatches,
  getRoundCompletion,
  resolveSuddenDeathMatches,
  assignFinalPlacements,
  type MatchDecision,
  type RoundCompletion,
} from './advancement';

// ---- Sudden death (D5.6 / D14, E6) ----
export {
  startSuddenDeath,
  listDeadlockedMatches,
  applySuddenDeathResult,
  completeSettledSuddenDeathRounds,
  listSuddenDeathRounds,
  type StartSuddenDeathResult,
} from './sudden-death';

// ---- Server-authoritative timers (E7.1, pure) ----
export {
  timerPhase,
  secondsUntil,
  computeCountdown,
  classifySubmissionTiming,
  clockSkewMs,
  serverNowFromClient,
  formatDuration,
  type TimerPhase,
  type TimerWindow,
  type Countdown,
  type SubmissionTiming,
} from './timers.public';

// ---- Knockout Arena (E7.2) ----
export {
  deriveArenaState,
  isArenaActionable,
  mayRevealOpponentProgress,
  ARENA_STATE_LABEL,
  type ArenaState,
  type ArenaStateInput,
} from './arena.public';

export {
  getMatchWindow,
  getKnockoutArena,
  listMyLiveMatches,
  type MatchWindow,
  type ArenaView,
  type ArenaOpponent,
  type MyMatchSummary,
} from './arena';

// ---- Live / spectator read model (E7.3) ----
export {
  getLiveSnapshot,
  getSpectatorSnapshot,
  getSpectatorTournamentId,
  getLeaderboard,
  listMyResults,
  getMyTournamentState,
  listPublicPlacements,
  snapshotVersion,
  LEADERBOARD_DEFAULT_TAKE,
  type MyTournamentResult,
  type MyTournamentState,
  type MyResultSubmission,
  type PublicPlacement,
  type LiveSnapshot,
  type LiveSnapshotOptions,
  type LiveRoundView,
  type LeaderboardEntry,
  type LeaderboardOptions,
  type LeaderboardOrder,
} from './live';

// ---- Notification triggers (E8.3) ----
export {
  syncTournamentNotifications,
  notifyRegistrationConfirmed,
  type NotificationSyncResult,
} from './notifications';

export {
  progressTournament,
  progressSimulation,
  getTournamentProgress,
  type ProgressResult,
} from './progress';

// ---- Admin operations & aggregate reads (E5) ----
export {
  listTournamentSummaries,
  getTournamentSummary,
  listBracketRounds,
  listRegistrations,
  removeRegistration,
  setTournamentArchived,
  getQueueHealth,
  type TournamentSummary,
  type ListTournamentSummariesOptions,
  type RegistrationView,
  type QueueHealth,
  type BracketRoundView,
} from './admin-ops';

// ---- Evaluation policy (D20) ----
export {
  BUILT_IN_PROFILES,
  DEFAULT_STAGE_PROFILES,
  resolveEvaluationProfile,
  isAiActiveForStage,
  evaluationProfileConfigSchema,
  type EvaluationProfileConfig,
} from './evaluation-profiles';
