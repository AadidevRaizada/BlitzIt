import 'server-only';
import { z } from 'zod';
import type { RoundStage } from '@/generated/prisma/client';
import {
  DEFAULT_WEIGHTS,
  type EvaluationProfile,
} from '@/server/modules/evaluation/types';
import { logger } from '@/lib/logger';

/**
 * Tournament-layer policy: which evaluation dimensions are active at each
 * stage (D20).
 *
 * This is the ONLY place that knows about rounds. The Evaluation Engine is
 * stage-agnostic — it receives a resolved `EvaluationProfile` and evaluates
 * exactly the dimensions it names. Adding a stage or re-weighting a round is a
 * configuration change here (or per-tournament JSON), never a change to
 * scoring logic.
 *
 * Why AI is reserved for the closing rounds:
 *  - **Cost.** The LLM pass is the only per-submission paid API call. A 64-player
 *    bracket runs ~127 knockout submissions plus 3 qualifying rounds for every
 *    registrant; restricting AI to SF/3rd/Final cuts LLM spend by well over 90%.
 *  - **Latency.** Deterministic probes finish in seconds; a model call adds
 *    seconds to tens of seconds per submission. Early rounds must judge a whole
 *    field inside a short round timer.
 *  - **Deterministic early rankings.** Qualification and the early bracket are
 *    decided purely by reproducible measurements, so seeding and eliminations
 *    can be recomputed exactly and are trivially defensible in a dispute.
 *  - **AI where it earns its place.** Subjective quality is most valuable in
 *    close, high-stakes matches — precisely the late rounds.
 *  - **Reproducibility.** Fewer non-deterministic inputs across the majority of
 *    the tournament (see the D18 temperature caveat).
 */

/** Built-in profiles. Organizers may add their own per tournament. */
export const BUILT_IN_PROFILES: Record<string, EvaluationProfile> = {
  /** Qualifiers + early knockout: reproducible measurements only, no model call. */
  deterministic: {
    name: 'deterministic',
    dimensions: {
      functional: true,
      performance: true,
      securityReliability: true,
      ai: false,
    },
    weights: DEFAULT_WEIGHTS,
  },
  /** Semifinals onwards: AI joins the weighted score (D2 weights). */
  full: {
    name: 'full',
    dimensions: {
      functional: true,
      performance: true,
      securityReliability: true,
      ai: true,
    },
    weights: DEFAULT_WEIGHTS,
  },
  /** Sudden death is decided on Functional score alone (D14). */
  'functional-only': {
    name: 'functional-only',
    dimensions: {
      functional: true,
      performance: false,
      securityReliability: false,
      ai: false,
    },
    weights: DEFAULT_WEIGHTS,
  },
};

/**
 * Default stage → profile mapping (D20). AI is intentionally absent until the
 * semifinals.
 */
export const DEFAULT_STAGE_PROFILES: Record<RoundStage, string> = {
  SIMULATION: 'deterministic',
  R64: 'deterministic',
  R32: 'deterministic',
  R16: 'deterministic',
  QF: 'deterministic',
  SF: 'full',
  THIRD_PLACE: 'full',
  FINAL: 'full',
  SUDDEN_DEATH: 'functional-only',
};

/**
 * Per-tournament override, stored on `Tournament.evaluationProfiles`.
 * Both fields are optional: an organizer can remap stages, define new named
 * profiles, or both — without a code change.
 */
const weightsSchema = z.object({
  functional: z.number().min(0),
  performance: z.number().min(0),
  securityReliability: z.number().min(0),
  ai: z.number().min(0),
});

const profileSchema = z.object({
  name: z.string().min(1),
  dimensions: z.object({
    functional: z.boolean(),
    performance: z.boolean(),
    securityReliability: z.boolean(),
    ai: z.boolean(),
  }),
  weights: weightsSchema,
});

export const evaluationProfileConfigSchema = z.object({
  /** Extra or overriding named profiles. */
  profiles: z.record(z.string(), profileSchema).optional(),
  /** Stage → profile name. Partial: unlisted stages keep the default. */
  stages: z.record(z.string(), z.string()).optional(),
});

export type EvaluationProfileConfig = z.infer<
  typeof evaluationProfileConfigSchema
>;

/**
 * Resolve the profile for a stage, honouring a tournament's stored config.
 *
 * Never throws: a malformed or unknown configuration falls back to the safe
 * default for that stage and logs, because an evaluation must not be blocked by
 * a bad admin edit mid-tournament.
 */
export function resolveEvaluationProfile(
  stage: RoundStage,
  rawConfig?: unknown,
): EvaluationProfile {
  const fallbackName = DEFAULT_STAGE_PROFILES[stage] ?? 'full';

  let config: EvaluationProfileConfig | undefined;
  if (rawConfig !== null && rawConfig !== undefined) {
    const parsed = evaluationProfileConfigSchema.safeParse(rawConfig);
    if (parsed.success) {
      config = parsed.data;
    } else {
      logger.warn(
        { stage, issues: parsed.error.issues.length },
        'invalid evaluationProfiles config; using defaults',
      );
    }
  }

  const profileName = config?.stages?.[stage] ?? fallbackName;
  const profile =
    config?.profiles?.[profileName] ?? BUILT_IN_PROFILES[profileName];

  if (!profile) {
    logger.warn(
      { stage, profileName },
      'unknown evaluation profile; falling back to the stage default',
    );
    return (
      BUILT_IN_PROFILES[fallbackName] ??
      BUILT_IN_PROFILES.full ??
        // Unreachable in practice — BUILT_IN_PROFILES.full is always defined.
        {
          name: 'full',
          dimensions: {
            functional: true,
            performance: true,
            securityReliability: true,
            ai: true,
          },
          weights: DEFAULT_WEIGHTS,
        }
    );
  }

  return profile;
}

/** True when the stage's resolved profile includes the AI dimension. */
export function isAiActiveForStage(
  stage: RoundStage,
  rawConfig?: unknown,
): boolean {
  return resolveEvaluationProfile(stage, rawConfig).dimensions.ai;
}
