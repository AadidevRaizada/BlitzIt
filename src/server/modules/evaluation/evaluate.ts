import 'server-only';
import { getStrategy } from './strategies';
import { warmUpDeployment } from './reachability';
import { readRepoAsText } from './github-text';
import { evaluateQuality } from './llm/quality';
import { computeOverallScore } from './score';
import { DEFAULT_WEIGHTS } from './types';
import type {
  EvaluationContext,
  EvaluationOutcome,
  FunctionalResult,
  PerformanceResult,
  SecurityReliabilityResult,
} from './types';
import { logger } from '@/lib/logger';

/**
 * Evaluation orchestrator (E2.6).
 *
 * Given a submission's repo + deployment URL, produce a reproducible
 * `EvaluationOutcome` with four dimensions and full evidence. Nothing is
 * cloned, built or executed (D1).
 *
 * Order matters: reachability gates the deployment-facing probes (D15), while
 * the repo/LLM pass runs regardless so an unreachable deployment still yields a
 * quality score instead of a blank row.
 */

const UNREACHABLE_FUNCTIONAL: FunctionalResult = {
  score: 0,
  testsPassed: 0,
  testsTotal: 0,
  results: [],
  deploymentReachable: false,
};

const UNREACHABLE_PERFORMANCE: PerformanceResult = {
  score: 0,
  p50Ms: null,
  p95Ms: null,
  samples: 0,
  failures: 0,
};

const UNREACHABLE_SECURITY: SecurityReliabilityResult = {
  score: 0,
  checks: [
    {
      id: 'reachable',
      label: 'Deployment responds',
      passed: false,
      weight: 1,
      detail: 'Deployment was unreachable after warm-up and retries',
    },
  ],
};

export async function runEvaluation(
  ctx: EvaluationContext,
): Promise<EvaluationOutcome> {
  const strategy = getStrategy(ctx.category); // throws for disabled categories (D17)
  const log = logger.child({ submissionId: ctx.submissionId });

  // 1. Reachability first — a cold start must not be scored as failure (D15).
  const warmup = await warmUpDeployment(ctx.deploymentUrl);

  // 2. Deployment-facing probes, and the repo read, in parallel. The repo pass
  //    is independent of reachability, so it always runs.
  const [functional, performance, security, snapshot] = await Promise.all([
    warmup.reachable
      ? strategy.runFunctional(ctx).catch((error: unknown) => {
          log.error({ err: error }, 'functional probe failed');
          return UNREACHABLE_FUNCTIONAL;
        })
      : Promise.resolve(UNREACHABLE_FUNCTIONAL),
    warmup.reachable
      ? strategy.probePerformance(ctx).catch((error: unknown) => {
          log.error({ err: error }, 'performance probe failed');
          return UNREACHABLE_PERFORMANCE;
        })
      : Promise.resolve(UNREACHABLE_PERFORMANCE),
    warmup.reachable
      ? strategy.probeSecurity(ctx).catch((error: unknown) => {
          log.error({ err: error }, 'security probe failed');
          return UNREACHABLE_SECURITY;
        })
      : Promise.resolve(UNREACHABLE_SECURITY),
    readRepoAsText(ctx.repoUrl, ctx.commitSha).catch((error: unknown) => {
      log.warn({ err: error }, 'repo read failed');
      return null;
    }),
  ]);

  // 3. LLM quality pass over the repo text (degrades to a neutral score).
  const ai = snapshot
    ? await evaluateQuality(snapshot)
    : await evaluateQuality({
        owner: '',
        repo: '',
        ref: '',
        commitSha: null,
        files: [],
        totalFiles: 0,
        readFiles: 0,
        totalBytes: 0,
        warnings: ['repository unavailable'],
      });

  // 4. Weighted blend (D2).
  const overallScore = computeOverallScore(
    {
      functional: functional.score,
      performance: performance.score,
      securityReliability: security.score,
      ai: ai.score,
    },
    DEFAULT_WEIGHTS,
  );

  log.info(
    {
      functional: functional.score,
      performance: performance.score,
      security: security.score,
      ai: ai.score,
      overall: overallScore,
      reachable: warmup.reachable,
      aiDegraded: ai.degraded,
    },
    'evaluation complete',
  );

  return {
    functionalScore: functional.score,
    performanceScore: performance.score,
    securityReliabilityScore: security.score,
    aiScore: ai.score,
    overallScore,
    weights: DEFAULT_WEIGHTS,
    testsPassed: functional.testsPassed,
    testsTotal: functional.testsTotal,
    deploymentReachable: warmup.reachable,
    testResults: functional.results,
    probeEvidence: {
      performance,
      security,
      warmup: {
        attempts: warmup.attempts,
        reachableAfterMs: warmup.reachableAfterMs,
      },
    },
    repoTextSnapshot: snapshot
      ? {
          owner: snapshot.owner,
          repo: snapshot.repo,
          commitSha: snapshot.commitSha,
          readFiles: snapshot.readFiles,
          totalFiles: snapshot.totalFiles,
          totalBytes: snapshot.totalBytes,
          // Paths only — the full text lives in the LLM audit payload.
          paths: snapshot.files.map((f) => f.path),
          warnings: snapshot.warnings,
        }
      : { warnings: ['repository unavailable'] },
    ai,
  };
}
