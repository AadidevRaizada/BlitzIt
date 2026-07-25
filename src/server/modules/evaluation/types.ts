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
  /** True when the model was unavailable and a neutral score was substituted. */
  degraded: boolean;
}

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
  weights: ScoreWeights;
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
