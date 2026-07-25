import 'server-only';
import { getStrategy } from './strategies';
import { warmUpDeployment } from './reachability';
import { readRepoAsText } from './github-text';
import { evaluateQuality } from './llm/quality';
import { computeOverallScore } from './score';
import { effectiveWeights, FULL_PROFILE, SKIPPED_AI } from './types';
import type {
  EvaluationContext,
  EvaluationOutcome,
  EvaluationProfile,
  FunctionalResult,
  PerformanceResult,
  SecurityReliabilityResult,
} from './types';
import { logger } from '@/lib/logger';

/**
 * Evaluation orchestrator (E2.6).
 *
 * Given a submission's repo + deployment URL, produce a reproducible
 * `EvaluationOutcome` and full evidence. Nothing is cloned, built or executed
 * (D1).
 *
 * Order matters: reachability gates the deployment-facing probes (D15), while
 * the repo/LLM pass runs independently so an unreachable deployment still
 * yields a quality score instead of a blank row.
 *
 * **Stage-agnostic (D20).** The orchestrator never asks what round this is; it
 * evaluates exactly the dimensions the supplied `profile` requests. The
 * tournament layer decides the profile. An inactive dimension is skipped
 * outright — no probe, no GitHub read, no model call — so early rounds are
 * genuinely cheaper and faster rather than merely zero-weighted.
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
  profile: EvaluationProfile = FULL_PROFILE,
): Promise<EvaluationOutcome> {
  const strategy = getStrategy(ctx.category); // throws for disabled categories (D17)
  const log = logger.child({
    submissionId: ctx.submissionId,
    profile: profile.name,
  });

  const active = profile.dimensions;
  // The repo read exists solely to feed the LLM pass, so it follows the AI
  // dimension. Skipping it is where the latency saving in early rounds comes
  // from; the submission's commit SHA is pinned on the Submission row already.
  const needsRepo = active.ai;

  // 1. Reachability first — a cold start must not be scored as failure (D15).
  //    Only needed when something actually probes the deployment.
  const needsDeployment =
    active.functional || active.performance || active.securityReliability;
  const warmup = needsDeployment
    ? await warmUpDeployment(ctx.deploymentUrl)
    : { reachable: false, attempts: 0, reachableAfterMs: null };

  const probe = warmup.reachable;

  // 2. Requested deployment probes and the repo read, in parallel.
  const [functional, performance, security, snapshot] = await Promise.all([
    active.functional && probe
      ? strategy.runFunctional(ctx).catch((error: unknown) => {
          log.error({ err: error }, 'functional probe failed');
          return UNREACHABLE_FUNCTIONAL;
        })
      : Promise.resolve(UNREACHABLE_FUNCTIONAL),
    active.performance && probe
      ? strategy.probePerformance(ctx).catch((error: unknown) => {
          log.error({ err: error }, 'performance probe failed');
          return UNREACHABLE_PERFORMANCE;
        })
      : Promise.resolve(UNREACHABLE_PERFORMANCE),
    active.securityReliability && probe
      ? strategy.probeSecurity(ctx).catch((error: unknown) => {
          log.error({ err: error }, 'security probe failed');
          return UNREACHABLE_SECURITY;
        })
      : Promise.resolve(UNREACHABLE_SECURITY),
    needsRepo
      ? readRepoAsText(ctx.repoUrl, ctx.commitSha).catch((error: unknown) => {
          log.warn({ err: error }, 'repo read failed');
          return null;
        })
      : Promise.resolve(null),
  ]);

  // 3. LLM quality pass over the repo text — only when requested (D20).
  //    Degrades to a neutral score if the model is unavailable.
  let ai = SKIPPED_AI;
  if (active.ai) {
    ai = snapshot
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
  }

  // 4. Weighted blend over the ACTIVE dimensions only (D2/D20). Inactive
  //    weights are zeroed and the remainder renormalised by the scorer.
  const weights = effectiveWeights(profile);
  const overallScore = computeOverallScore(
    {
      functional: functional.score,
      performance: performance.score,
      securityReliability: security.score,
      ai: ai.score,
    },
    weights,
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
      aiSkipped: ai.skipped,
      dimensions: active,
    },
    'evaluation complete',
  );

  return {
    functionalScore: functional.score,
    performanceScore: performance.score,
    securityReliabilityScore: security.score,
    aiScore: ai.score,
    overallScore,
    weights,
    profileName: profile.name,
    dimensions: { ...active },
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
      : needsRepo
        ? { warnings: ['repository unavailable'] }
        : {
            skipped: true,
            warnings: [
              'repository not read: the AI dimension is not active for this round',
            ],
          },
    ai,
  };
}
