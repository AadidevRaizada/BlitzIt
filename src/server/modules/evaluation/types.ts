import type { ChallengeCategory } from '@/generated/prisma/client';

/**
 * Evaluation Engine contracts (D1/D2/D4).
 *
 * We never execute competitor code. A strategy probes the competitor's own
 * live deployment as a black box and reads their repo as text; nothing is
 * cloned, built or run.
 */

/** Scoring weights (D2). Stored per evaluation so a score is reproducible. */
export interface ScoreWeights {
  functional: number;
  performance: number;
  securityReliability: number;
  ai: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  functional: 0.6,
  performance: 0.15,
  securityReliability: 0.1,
  ai: 0.15,
};

/** The four independently-selectable scoring dimensions. */
export type EvaluationDimension =
  'functional' | 'performance' | 'securityReliability' | 'ai';

export const EVALUATION_DIMENSIONS: readonly EvaluationDimension[] = [
  'functional',
  'performance',
  'securityReliability',
  'ai',
] as const;

/**
 * Which dimensions to evaluate, and how to weight them (D20).
 *
 * The engine is **stage-agnostic**: it never asks what round this is, it only
 * honours the profile it is handed. The tournament layer owns the
 * stage → profile decision (see `server/modules/tournament/evaluation-profiles`).
 *
 * A dimension that is `false` is **not evaluated at all** — no probe, no API
 * call — which is what makes disabling AI in early rounds actually save money
 * and latency rather than merely zeroing its weight.
 */
export interface EvaluationProfile {
  /** Recorded on the Evaluation row so a score can be explained later. */
  name: string;
  dimensions: Record<EvaluationDimension, boolean>;
  /** Relative weights. Inactive dimensions are forced to 0 before blending. */
  weights: ScoreWeights;
}

/**
 * Weights with every inactive dimension zeroed. `computeOverallScore`
 * renormalises by the surviving total, so removing AI rescales the remaining
 * dimensions instead of capping the maximum achievable score at 85.
 */
export function effectiveWeights(profile: EvaluationProfile): ScoreWeights {
  return {
    functional: profile.dimensions.functional ? profile.weights.functional : 0,
    performance: profile.dimensions.performance
      ? profile.weights.performance
      : 0,
    securityReliability: profile.dimensions.securityReliability
      ? profile.weights.securityReliability
      : 0,
    ai: profile.dimensions.ai ? profile.weights.ai : 0,
  };
}

/** Profile used when a caller does not specify one — all four dimensions (D2). */
export const FULL_PROFILE: EvaluationProfile = {
  name: 'full',
  dimensions: {
    functional: true,
    performance: true,
    securityReliability: true,
    ai: true,
  },
  weights: DEFAULT_WEIGHTS,
};

/** Result of one hidden test run against the deployment. */
export interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  weight: number;
  durationMs: number;
  /** Why it failed — safe to show an admin, never leaks the assertion body. */
  message?: string;
}

export interface FunctionalResult {
  /** 0–100, weighted by each test's `weight`. */
  score: number;
  testsPassed: number;
  testsTotal: number;
  results: TestResult[];
  /** False when the deployment never became reachable (D15 → functional = 0). */
  deploymentReachable: boolean;
}

export interface PerformanceResult {
  score: number;
  p50Ms: number | null;
  p95Ms: number | null;
  samples: number;
  failures: number;
}

export interface SecurityReliabilityResult {
  score: number;
  /** Individual checks, each contributing to the score. */
  checks: Array<{
    id: string;
    label: string;
    passed: boolean;
    weight: number;
    detail?: string;
  }>;
}

/** Subjective quality pass. Never decides a winner alone (D2). */
export interface AiQualityResult {
  score: number;
  breakdown: {
    codeOrganization: number;
    architecture: number;
    documentation: number;
    uiPolish: number | null;
  };
  summary: string;
  modelId: string;
  promptHash: string;
  rubricVersion: string;
  /** Full prompt + raw response, retained for dispute audit. */
  raw: unknown;
  /**
   * True when the model was unavailable and a neutral score was substituted.
   * Distinct from `skipped`: degraded means "we wanted AI and could not get it"
   * (an incident worth alerting on), skipped means "policy said not to run it".
   */
  degraded: boolean;
  /** True when the profile did not request the AI dimension (D20). */
  skipped: boolean;
}

/** AI result used when the active profile excludes the AI dimension (D20). */
export const SKIPPED_AI: AiQualityResult = {
  score: 0,
  breakdown: {
    codeOrganization: 0,
    architecture: 0,
    documentation: 0,
    uiPolish: null,
  },
  summary:
    'AI evaluation is not part of this round (deterministic profile). No model was called.',
  modelId: 'none',
  promptHash: '',
  rubricVersion: 'n/a',
  raw: null,
  degraded: false,
  skipped: true,
};

/** Everything a strategy needs. Nothing here is executed. */
export interface EvaluationContext {
  submissionId: string;
  repoUrl: string;
  deploymentUrl: string;
  commitSha?: string | null;
  category: ChallengeCategory;
  /** Category-specific config authored with the problem. */
  contractSpec: unknown;
  hiddenTests: Array<{
    id: string;
    name: string;
    kind: string;
    spec: unknown;
    weight: number;
    timeoutMs: number;
  }>;
}

/**
 * One implementation per challenge category (D4). Only REST_API is enabled for
 * Week 1 (D17); the rest are registered but gated until individually validated.
 */
export interface EvaluationStrategy {
  readonly category: ChallengeCategory;
  /** Gate from D17 — disabled strategies refuse to run. */
  readonly enabled: boolean;

  runFunctional(ctx: EvaluationContext): Promise<FunctionalResult>;
  probePerformance(ctx: EvaluationContext): Promise<PerformanceResult>;
  probeSecurity(ctx: EvaluationContext): Promise<SecurityReliabilityResult>;
}

/** Final blended outcome written to the `Evaluation` row. */
export interface EvaluationOutcome {
  functionalScore: number;
  performanceScore: number;
  securityReliabilityScore: number;
  aiScore: number;
  overallScore: number;
  /** Effective weights actually applied (inactive dimensions are 0). */
  weights: ScoreWeights;
  /** Profile that governed this evaluation — recorded for audit (D20). */
  profileName: string;
  /** Dimensions that were actually evaluated. */
  dimensions: Record<EvaluationDimension, boolean>;
  testsPassed: number;
  testsTotal: number;
  deploymentReachable: boolean;
  testResults: TestResult[];
  probeEvidence: {
    performance: PerformanceResult;
    security: SecurityReliabilityResult;
    warmup: { attempts: number; reachableAfterMs: number | null };
  };
  repoTextSnapshot: unknown;
  ai: AiQualityResult;
}
