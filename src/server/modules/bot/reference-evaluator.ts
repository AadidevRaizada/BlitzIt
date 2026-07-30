import 'server-only';
import { createHash } from 'node:crypto';
import type { BotScoreMode } from '@/generated/prisma/client';
import { computeOverallScore } from '@/server/modules/evaluation/score';
import {
  effectiveWeights,
  SKIPPED_AI,
  type EvaluationOutcome,
  type EvaluationProfile,
  type TestResult,
} from '@/server/modules/evaluation/types';

/**
 * Deterministic internal reference evaluation for bot submissions.
 *
 * ## Why this exists rather than an evaluator bypass
 *
 * The obvious implementation is `if (isBot) skip evaluation`. It was rejected
 * twice over. First, it puts a competitor-shaped special case inside the
 * Evaluation Engine, which D20's architectural rule forbids in as many words:
 * the engine is stage-agnostic and provider-agnostic, and the layer above owns
 * every policy decision. Second, and worse, it would mean the bots do not
 * exercise the evaluation pipeline at all — and exercising it is most of the
 * reason they exist.
 *
 * What differs for a bot is not HOW a result is scored but WHERE the raw
 * measurements come from. That is a question about the submission's source, and
 * it is answered before the engine is ever called — at exactly the altitude
 * where `evaluateProcessor` already resolves the `EvaluationProfile` from the
 * tournament layer. So this sits beside that call, not inside the engine.
 *
 * ## Why not real seeded repositories
 *
 * They were the other serious candidate: real repos, real deployments, genuine
 * end-to-end truth. Rejected because it makes the reliability of the test
 * harness depend on GitHub, on our hosting, and on eight live deployments
 * somebody has to keep alive forever. A harness whose green run depends on
 * third-party uptime stops being trusted the first week it flakes.
 *
 * ## Reproducibility
 *
 * Every number is derived from `sha256(botId, roundId, problemId)`, so a bot's
 * score is a pure function of who it is and what it was asked to do. Re-running
 * a test tournament with the same bots produces the same bracket — which is the
 * property you actually want when validating a feature twice. This is the same
 * principle D25 sets out for future environment profiles: an evaluation that
 * cannot be re-derived is not evidence.
 *
 * The outcome is a COMPLETE `EvaluationOutcome`, blended by the real
 * `computeOverallScore` under the real `effectiveWeights`. Nothing downstream —
 * persistence, the D5 tie-break chain, advancement, sudden death, seeding,
 * rankings — can tell the difference, which is precisely the point.
 */

/** Marks every piece of evidence this module produces. Never a real probe. */
export const REFERENCE_EVIDENCE_SOURCE = 'internal-reference';

/**
 * A deterministic [0, 1) stream from a seed.
 *
 * Counter-based rather than stateful-PRNG so that each named draw is independent
 * of how many draws came before it. Adding a new dimension later therefore does
 * not shift every existing bot's score and silently invalidate a saved
 * expectation.
 */
function draw(seed: string, label: string): number {
  const digest = createHash('sha256').update(`${seed}:${label}`).digest();
  // 48 bits is ample and stays inside a safe integer.
  const value = digest.readUIntBE(0, 6);
  return value / 2 ** 48;
}

/** Clamp into the 0-100 score range. */
const clamp = (value: number): number => Math.min(100, Math.max(0, value));

export interface ReferenceEvaluationInput {
  botUserId: string;
  roundId: string;
  problemId: string;
  /** Target score band, 0-100. */
  skill: number;
  scoreMode: BotScoreMode;
  /** Hidden tests the real problem carries, so the counts are truthful. */
  testCount: number;
  profile: EvaluationProfile;
}

/**
 * The score this bot lands on, before dimensions are split out.
 *
 * - `FIXED` returns the skill exactly — a bot you can reason about arithmetically.
 * - `TIE` also returns the skill exactly, and is the mode that makes a deadlock
 *   reachable on demand: two TIE bots of equal skill agree on overall score,
 *   functional score, tests passed, performance and AI, so the whole D5 chain
 *   runs out and the match holds for a sudden-death challenge (D14). Waiting for
 *   a natural tie to validate that path is waiting for something that may never
 *   happen.
 * - `SEEDED` spreads +/-12 points around the skill, deterministically, so a field
 *   of bots produces a believable ordering rather than a flat one.
 */
function baseScore(input: ReferenceEvaluationInput, seed: string): number {
  if (input.scoreMode === 'FIXED' || input.scoreMode === 'TIE') {
    return clamp(input.skill);
  }
  const jitter = (draw(seed, 'jitter') - 0.5) * 24;
  return clamp(input.skill + jitter);
}

export function runReferenceEvaluation(
  input: ReferenceEvaluationInput,
): EvaluationOutcome {
  // TIE deliberately drops the round and problem from the seed. Two TIE bots
  // must agree on EVERY tie-break input, and a seed carrying their distinct
  // user ids would separate them at the first decimal place.
  const seed =
    input.scoreMode === 'TIE'
      ? `tie:${input.skill}`
      : `${input.botUserId}:${input.roundId}:${input.problemId}`;

  const base = baseScore(input, seed);
  const { dimensions } = input.profile;

  // Each dimension varies around the base, so a bot is not uniformly good at
  // everything — which is what makes the tie-break chain meaningful rather than
  // decorative. TIE mode collapses the spread to zero.
  const spread = input.scoreMode === 'TIE' ? 0 : 8;
  const dimensionScore = (label: string): number =>
    clamp(base + (draw(seed, label) - 0.5) * spread);

  const functionalScore = dimensions.functional ? dimensionScore('func') : 0;
  const performanceScore = dimensions.performance ? dimensionScore('perf') : 0;
  const securityReliabilityScore = dimensions.securityReliability
    ? dimensionScore('sec')
    : 0;
  const aiScore = dimensions.ai ? dimensionScore('ai') : 0;

  // Tests passed follows the functional score, so `TIEBREAK_TESTS` sees a
  // number consistent with the score above it in the chain. A bot that scored
  // 80% functional having passed 20% of tests would be incoherent evidence.
  const testsTotal = input.testCount;
  const testsPassed = dimensions.functional
    ? Math.round((functionalScore / 100) * testsTotal)
    : 0;

  const testResults: TestResult[] = Array.from(
    { length: testsTotal },
    (_, index) => ({
      id: `reference-${index + 1}`,
      name: `Reference check ${index + 1}`,
      passed: index < testsPassed,
      weight: 1,
      durationMs: Math.round(20 + draw(seed, `t${index}`) * 180),
      ...(index < testsPassed
        ? {}
        : { message: 'Reference evaluation: simulated failure' }),
    }),
  );

  const weights = effectiveWeights(input.profile);
  const overallScore = computeOverallScore(
    {
      functional: functionalScore,
      performance: performanceScore,
      securityReliability: securityReliabilityScore,
      ai: aiScore,
    },
    weights,
  );

  return {
    functionalScore,
    performanceScore,
    securityReliabilityScore,
    aiScore,
    overallScore,
    weights,
    profileName: input.profile.name,
    dimensions,
    testsPassed,
    testsTotal,
    // A bot has no deployment. Reporting it reachable keeps the D15 semantics
    // honest for everything downstream — an unreachable deployment forces
    // functional to 0, which would make every bot score zero and no bracket
    // would ever be decided on merit.
    deploymentReachable: true,
    testResults,
    probeEvidence: {
      performance: {
        score: performanceScore,
        p50Ms: Math.round(40 + draw(seed, 'p50') * 200),
        p95Ms: Math.round(180 + draw(seed, 'p95') * 500),
        samples: 10,
        failures: 0,
      },
      security: {
        score: securityReliabilityScore,
        checks: [
          {
            id: 'reference',
            label: 'Internal reference security profile',
            passed: securityReliabilityScore >= 50,
            weight: 1,
            detail: REFERENCE_EVIDENCE_SOURCE,
          },
        ],
      },
      warmup: { attempts: 0, reachableAfterMs: 0 },
    },
    // Stamped so an operator reading an evaluation can never mistake a bot's
    // evidence for a real probe against a real deployment.
    repoTextSnapshot: {
      source: REFERENCE_EVIDENCE_SOURCE,
      seed,
      note: 'Synthetic bot submission. No repository was read and no deployment was contacted.',
    },
    ai: dimensions.ai
      ? {
          score: aiScore,
          breakdown: {
            codeOrganization: dimensionScore('ai-org'),
            architecture: dimensionScore('ai-arch'),
            documentation: dimensionScore('ai-docs'),
            uiPolish: null,
          },
          summary:
            'Internal reference evaluation. No model was called; this score is derived deterministically from the bot seed.',
          modelId: REFERENCE_EVIDENCE_SOURCE,
          promptHash: '',
          rubricVersion: 'reference-1',
          raw: { provider: REFERENCE_EVIDENCE_SOURCE, seed },
          // Not degraded: no model was WANTED. Degraded means "we wanted AI and
          // could not get it", which is an incident (D20). This is policy.
          degraded: false,
          skipped: false,
        }
      : SKIPPED_AI,
  };
}
