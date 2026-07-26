import 'server-only';
import { getPostHogServer } from '@/lib/posthog';
import { logger } from '@/lib/logger';

/**
 * Feature flags (E7.4).
 *
 * A single place that answers "is this feature on for this person?", resolved
 * in a fixed order so the answer is always explicable:
 *
 *   1. **Environment override** — `FEATURE_<FLAG>=true|false`. Absolute, and
 *      the only lever that works when PostHog is unreachable. This is the
 *      kill switch: an operator must be able to turn the live arena off during
 *      an event without waiting on a third party.
 *   2. **Admins** — always on. An operator cannot support a surface they are
 *      not allowed to open.
 *   3. **PostHog** — the actual rollout control (percentage, cohort, manual).
 *   4. **Default on** — when PostHog is not configured at all (dev, CI, and any
 *      deployment that never wired analytics). A missing analytics vendor must
 *      not be able to disable the product; step 1 is how you turn it off.
 *
 * Note that a PostHog *outage* is not the same as PostHog being unconfigured:
 * an error from a configured client falls back to the default rather than
 * failing the request, and is logged.
 */

export const FLAGS = {
  /** Screen [10] and the SSE-backed live surfaces (E7). */
  LIVE_ARENA: 'live-arena',
} as const;

export type FlagKey = (typeof FLAGS)[keyof typeof FLAGS];

export interface FlagViewer {
  id: string;
  role: 'USER' | 'ADMIN';
}

/** How a flag decision was reached — surfaced in logs and the verify suite. */
export type FlagSource = 'env' | 'admin' | 'posthog' | 'default';

export interface FlagDecision {
  enabled: boolean;
  source: FlagSource;
}

/** `live-arena` -> `FEATURE_LIVE_ARENA`. */
export function envVarNameForFlag(flag: FlagKey): string {
  return `FEATURE_${flag.replace(/-/g, '_').toUpperCase()}`;
}

/**
 * Read the env override. Deliberately parsed here rather than in `env.ts`:
 * flags come and go, and each one should not require a schema change and a
 * redeploy of the validation module.
 */
export function envOverride(flag: FlagKey): boolean | null {
  const raw = process.env[envVarNameForFlag(flag)];
  if (raw === undefined) return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '') return null;
  if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'off', 'no'].includes(normalized)) return false;
  logger.warn(
    { flag, value: raw },
    'unrecognised feature-flag override; ignoring',
  );
  return null;
}

export async function evaluateFlag(
  flag: FlagKey,
  viewer: FlagViewer | null,
): Promise<FlagDecision> {
  const override = envOverride(flag);
  if (override !== null) return { enabled: override, source: 'env' };

  if (viewer?.role === 'ADMIN') return { enabled: true, source: 'admin' };

  const posthog = getPostHogServer();
  if (!posthog || !viewer) return { enabled: true, source: 'default' };

  try {
    const enabled = await posthog.isFeatureEnabled(flag, viewer.id);
    if (typeof enabled === 'boolean') {
      return { enabled, source: 'posthog' };
    }
    return { enabled: true, source: 'default' };
  } catch (error) {
    logger.warn(
      { flag, err: error instanceof Error ? error.message : String(error) },
      'feature flag lookup failed; falling back to the default',
    );
    return { enabled: true, source: 'default' };
  }
}

export async function isFlagEnabled(
  flag: FlagKey,
  viewer: FlagViewer | null,
): Promise<boolean> {
  return (await evaluateFlag(flag, viewer)).enabled;
}

/** Convenience for the arena surfaces. */
export async function isLiveArenaEnabled(
  viewer: FlagViewer | null,
): Promise<boolean> {
  return isFlagEnabled(FLAGS.LIVE_ARENA, viewer);
}
