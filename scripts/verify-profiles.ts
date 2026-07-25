import './load-env';
import {
  BUILT_IN_PROFILES,
  DEFAULT_STAGE_PROFILES,
  resolveEvaluationProfile,
  isAiActiveForStage,
} from '../src/server/modules/tournament/evaluation-profiles';
import {
  effectiveWeights,
  FULL_PROFILE,
  type EvaluationProfile,
} from '../src/server/modules/evaluation/types';
import { computeOverallScore } from '../src/server/modules/evaluation/score';
import { runEvaluation } from '../src/server/modules/evaluation/evaluate';
import type { RoundStage } from '../src/generated/prisma/client';

/**
 * D20 acceptance: stage-driven evaluation profiles.
 *
 * Verifies the tournament layer decides the active dimensions, the engine
 * honours them, AI is genuinely NOT called in early rounds, and the blend
 * renormalises so a deterministic round can still score 100.
 *
 * Run: npm run verify:profiles
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

const DETERMINISTIC_STAGES: RoundStage[] = [
  'SIMULATION',
  'R64',
  'R32',
  'R16',
  'QF',
];
const AI_STAGES: RoundStage[] = ['SF', 'THIRD_PLACE', 'FINAL'];

async function main() {
  // ---- 1. Stage → profile policy (tournament layer) ----
  for (const stage of DETERMINISTIC_STAGES) {
    const p = resolveEvaluationProfile(stage);
    check(
      `${stage}: AI disabled`,
      p.dimensions.ai === false,
      `profile=${p.name} ai=${p.dimensions.ai}`,
    );
    check(
      `${stage}: functional + performance + security active`,
      p.dimensions.functional &&
        p.dimensions.performance &&
        p.dimensions.securityReliability,
    );
  }

  for (const stage of AI_STAGES) {
    const p = resolveEvaluationProfile(stage);
    check(
      `${stage}: AI enabled`,
      p.dimensions.ai === true,
      `profile=${p.name}`,
    );
    check(
      `${stage}: all four dimensions active`,
      p.dimensions.functional &&
        p.dimensions.performance &&
        p.dimensions.securityReliability &&
        p.dimensions.ai,
    );
  }

  check(
    'SUDDEN_DEATH is functional-only (D14)',
    (() => {
      const p = resolveEvaluationProfile('SUDDEN_DEATH');
      return (
        p.dimensions.functional &&
        !p.dimensions.performance &&
        !p.dimensions.securityReliability &&
        !p.dimensions.ai
      );
    })(),
  );

  check(
    'every RoundStage has a default profile',
    Object.keys(DEFAULT_STAGE_PROFILES).length >= 9 &&
      Object.values(DEFAULT_STAGE_PROFILES).every((n) =>
        Boolean(BUILT_IN_PROFILES[n]),
      ),
  );

  check(
    'isAiActiveForStage matches the profile',
    !isAiActiveForStage('QF') && isAiActiveForStage('FINAL'),
  );

  // ---- 2. Weight maths ----
  const det = BUILT_IN_PROFILES.deterministic!;
  const detW = effectiveWeights(det);
  check('deterministic profile zeroes the AI weight', detW.ai === 0);
  check(
    'deterministic keeps 60/15/10 for the rest',
    detW.functional === 0.6 &&
      detW.performance === 0.15 &&
      detW.securityReliability === 0.1,
  );

  check(
    'a perfect deterministic run still scores 100 (renormalised, not capped at 85)',
    computeOverallScore(
      { functional: 100, performance: 100, securityReliability: 100, ai: 0 },
      detW,
    ) === 100,
  );

  check(
    'AI score is ignored entirely when the dimension is off',
    computeOverallScore(
      { functional: 100, performance: 100, securityReliability: 100, ai: 0 },
      detW,
    ) ===
      computeOverallScore(
        {
          functional: 100,
          performance: 100,
          securityReliability: 100,
          ai: 100,
        },
        detW,
      ),
  );

  check(
    'full profile still applies the D2 60/15/10/15 blend',
    computeOverallScore(
      { functional: 100, performance: 0, securityReliability: 0, ai: 0 },
      effectiveWeights(FULL_PROFILE),
    ) === 60,
  );

  // ---- 3. Per-tournament configuration (no code change) ----
  const orgConfig = {
    profiles: {
      'ai-heavy': {
        name: 'ai-heavy',
        dimensions: {
          functional: true,
          performance: false,
          securityReliability: false,
          ai: true,
        },
        weights: {
          functional: 0.5,
          performance: 0,
          securityReliability: 0,
          ai: 0.5,
        },
      },
    },
    stages: { QF: 'ai-heavy', FINAL: 'deterministic' },
  };

  check(
    'organizer can enable AI earlier via config',
    resolveEvaluationProfile('QF', orgConfig).dimensions.ai === true,
  );
  check(
    'organizer can disable AI in the final via config',
    resolveEvaluationProfile('FINAL', orgConfig).dimensions.ai === false,
  );
  check(
    'unlisted stages keep their default',
    resolveEvaluationProfile('R16', orgConfig).name === 'deterministic',
  );
  check(
    'custom weights are honoured',
    resolveEvaluationProfile('QF', orgConfig).weights.ai === 0.5,
  );

  // ---- 4. Bad config must never block an evaluation ----
  check(
    'malformed config falls back to defaults',
    resolveEvaluationProfile('QF', { stages: 42 }).name === 'deterministic',
  );
  check(
    'unknown profile name falls back to the stage default',
    resolveEvaluationProfile('SF', { stages: { SF: 'does-not-exist' } })
      .name === 'full',
  );
  check(
    'null config is fine',
    resolveEvaluationProfile('FINAL', null).name === 'full',
  );

  // Regression (Codex review): a schema-VALID but degenerate profile must not
  // reach the scorer. effectiveWeights would sum to 0, computeOverallScore
  // would throw, and the submission would be retried and finally FAILED — a
  // competitor losing their score to an organizer's typo.
  const allDimensionsOff = {
    profiles: {
      dead: {
        name: 'dead',
        dimensions: {
          functional: false,
          performance: false,
          securityReliability: false,
          ai: false,
        },
        weights: {
          functional: 0.6,
          performance: 0.15,
          securityReliability: 0.1,
          ai: 0.15,
        },
      },
    },
    stages: { QF: 'dead' },
  };
  const recoveredA = resolveEvaluationProfile('QF', allDimensionsOff);
  check(
    'profile with every dimension off falls back (never unscorable)',
    recoveredA.name === 'deterministic',
    `got ${recoveredA.name}`,
  );

  const zeroWeighted = {
    profiles: {
      zeroed: {
        name: 'zeroed',
        dimensions: {
          functional: false,
          performance: false,
          securityReliability: false,
          ai: true,
        },
        weights: {
          functional: 0.6,
          performance: 0.15,
          securityReliability: 0.1,
          ai: 0,
        },
      },
    },
    stages: { FINAL: 'zeroed' },
  };
  const recoveredB = resolveEvaluationProfile('FINAL', zeroWeighted);
  check(
    'profile whose only active dimension has weight 0 falls back',
    recoveredB.name === 'full',
    `got ${recoveredB.name}`,
  );

  // The real proof: the resolved profile must always be scorable.
  for (const [label, cfg] of [
    ['all-off', allDimensionsOff],
    ['zero-weighted', zeroWeighted],
  ] as const) {
    const stage: RoundStage = label === 'all-off' ? 'QF' : 'FINAL';
    const w = effectiveWeights(resolveEvaluationProfile(stage, cfg));
    let threw = false;
    try {
      computeOverallScore(
        {
          functional: 100,
          performance: 100,
          securityReliability: 100,
          ai: 100,
        },
        w,
      );
    } catch {
      threw = true;
    }
    check(`scoring never throws for a ${label} config`, !threw);
  }

  // ---- 5. Engine honours the profile (the point of the whole change) ----
  // A deterministic profile must not call the LLM or read the repo. We use an
  // unreachable deployment + a bogus repo: if the engine were still calling
  // GitHub/OpenAI, the AI result would be `degraded`, not `skipped`.
  const deterministicOutcome = await runEvaluation(
    {
      submissionId: 'profile-check-deterministic',
      repoUrl: 'https://github.com/blitzit-does-not-exist/nope',
      deploymentUrl: 'https://blitzit-unreachable.invalid',
      commitSha: null,
      category: 'REST_API',
      contractSpec: {},
      hiddenTests: [],
    },
    det,
  );

  check(
    'deterministic run reports AI as SKIPPED (not degraded)',
    deterministicOutcome.aiScore === 0 && deterministicOutcome.weights.ai === 0,
    `ai=${deterministicOutcome.aiScore} weight=${deterministicOutcome.weights.ai}`,
  );
  check(
    'deterministic run records the profile name for audit',
    deterministicOutcome.profileName === 'deterministic',
  );
  check(
    'deterministic run records which dimensions ran',
    deterministicOutcome.dimensions.ai === false &&
      deterministicOutcome.dimensions.functional === true,
  );
  check(
    'deterministic run did not read the repository',
    JSON.stringify(deterministicOutcome.repoTextSnapshot).includes(
      'AI dimension is not active',
    ),
    JSON.stringify(deterministicOutcome.repoTextSnapshot).slice(0, 120),
  );

  // A functional-only profile must skip the perf/security probes too.
  const suddenDeath = BUILT_IN_PROFILES['functional-only'] as EvaluationProfile;
  const sdOutcome = await runEvaluation(
    {
      submissionId: 'profile-check-sudden-death',
      repoUrl: 'https://github.com/blitzit-does-not-exist/nope',
      deploymentUrl: 'https://blitzit-unreachable.invalid',
      commitSha: null,
      category: 'REST_API',
      contractSpec: {},
      hiddenTests: [],
    },
    suddenDeath,
  );
  check(
    'sudden-death weights only functional',
    sdOutcome.weights.functional > 0 &&
      sdOutcome.weights.performance === 0 &&
      sdOutcome.weights.securityReliability === 0 &&
      sdOutcome.weights.ai === 0,
  );

  console.log(
    failures === 0
      ? '\nAll evaluation-profile checks passed.'
      : `\n${failures} check(s) FAILED.`,
  );
}

main()
  .catch((e) => {
    console.error('\nFAIL —', e);
    failures++;
  })
  .finally(() => process.exit(failures > 0 ? 1 : 0));
