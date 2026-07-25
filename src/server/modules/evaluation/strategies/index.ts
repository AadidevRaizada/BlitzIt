import 'server-only';
import type { ChallengeCategory } from '@/generated/prisma/client';
import type { EvaluationStrategy } from '../types';
import { restApiStrategy } from './rest-api';

/**
 * Strategy registry (D4) with the Week-1 launch gate (D17).
 *
 * All eight challenge categories exist in the schema, but only REST_API is
 * validated and enabled. The others are deliberately absent until each has a
 * strategy that has been proven — an unvalidated category must never score a
 * real submission (risk T7).
 */

const registry: Partial<Record<ChallengeCategory, EvaluationStrategy>> = {
  REST_API: restApiStrategy,
  // WEB_APP, AI_AGENT, OCR, AUTOMATION, INTERNAL_TOOL, CLI_APP,
  // CHROME_EXTENSION — enabled individually once validated (D17 / T7).
};

export class UnsupportedCategoryError extends Error {
  constructor(category: ChallengeCategory) {
    super(
      `Challenge category "${category}" is not enabled for evaluation yet. ` +
        `Only REST_API is validated for Week 1 (D17).`,
    );
    this.name = 'UnsupportedCategoryError';
  }
}

/** Resolve the strategy for a category, or throw if it is not enabled. */
export function getStrategy(category: ChallengeCategory): EvaluationStrategy {
  const strategy = registry[category];
  if (!strategy || !strategy.enabled) {
    throw new UnsupportedCategoryError(category);
  }
  return strategy;
}

/** Categories that can currently be evaluated (used by admin problem authoring). */
export function enabledCategories(): ChallengeCategory[] {
  return (Object.keys(registry) as ChallengeCategory[]).filter(
    (category) => registry[category]?.enabled,
  );
}

export { restApiStrategy };
