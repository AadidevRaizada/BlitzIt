import { DEFAULT_WEIGHTS, type ScoreWeights } from './types';

/**
 * Weighted blend (D2): Functional 60 · Performance 15 · Security/Reliability 10
 * · AI 15. Pure function — no I/O — so it is trivially testable and the same
 * inputs always produce the same score.
 */

export interface ScoreInputs {
  functional: number;
  performance: number;
  securityReliability: number;
  ai: number;
}

const clamp = (value: number): number => Math.min(100, Math.max(0, value));

export function computeOverallScore(
  inputs: ScoreInputs,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  const total =
    weights.functional +
    weights.performance +
    weights.securityReliability +
    weights.ai;

  if (total <= 0) throw new Error('Score weights must sum to a positive value');

  const weighted =
    clamp(inputs.functional) * weights.functional +
    clamp(inputs.performance) * weights.performance +
    clamp(inputs.securityReliability) * weights.securityReliability +
    clamp(inputs.ai) * weights.ai;

  // Normalise by the actual sum so custom weights can't inflate the scale.
  return Math.round((weighted / total) * 100) / 100;
}
