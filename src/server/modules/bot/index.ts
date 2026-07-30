import 'server-only';

/**
 * Test bots (D35) — the module boundary.
 *
 * Bots exist to exercise registration, scheduling, bracket generation,
 * advancement, sudden death, notifications, Mission Control, the evaluation
 * pipeline, rankings and the UI. They deliberately do NOT exercise GitHub, which
 * is the one dependency a test harness must not inherit.
 *
 * Import from here rather than reaching into individual files.
 */

export {
  createBot,
  deleteBot,
  addBotsToTournament,
  listBots,
  botUserIds,
  type BotView,
  type CreateBotInput,
} from './bots';

export {
  runBotSubmissionsForRound,
  botRepoUrl,
  botDeploymentUrl,
  type BotSubmissionResult,
} from './bot-submit';

export {
  runReferenceEvaluation,
  REFERENCE_EVIDENCE_SOURCE,
  type ReferenceEvaluationInput,
} from './reference-evaluator';
