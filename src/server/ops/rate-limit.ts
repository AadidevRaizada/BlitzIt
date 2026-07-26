import 'server-only';
import { AppError } from '@/lib/errors';
import { logger } from '@/lib/logger';

export type RateLimitScope =
  'auth' | 'submission' | 'payment-order' | 'webhook-observe';

export interface RateLimitRule {
  limit: number;
  windowMs: number;
  mode?: 'enforce' | 'observe';
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  observed: boolean;
}

const RULES: Record<RateLimitScope, RateLimitRule> = {
  auth: { limit: 30, windowMs: 60_000 },
  submission: { limit: 12, windowMs: 60_000 },
  'payment-order': { limit: 10, windowMs: 60_000 },
  // Razorpay webhooks must never be dropped by local rate limiting. We still
  // count them so abuse is visible in logs/health without losing a payment.
  'webhook-observe': { limit: 300, windowMs: 60_000, mode: 'observe' },
};

const buckets = new Map<string, { count: number; resetAt: number }>();

export function clientIpFromHeaders(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}

export function rateLimitKey(input: {
  scope: RateLimitScope;
  identifier: string;
}): string {
  return `${input.scope}:${input.identifier}`;
}

export function checkRateLimit(
  scope: RateLimitScope,
  identifier: string,
): RateLimitResult {
  try {
    const rule = RULES[scope];
    const now = Date.now();
    const key = rateLimitKey({ scope, identifier });
    const current = buckets.get(key);
    const bucket =
      current && current.resetAt > now
        ? current
        : { count: 0, resetAt: now + rule.windowMs };
    bucket.count++;
    buckets.set(key, bucket);

    const overLimit = bucket.count > rule.limit;
    const observed = rule.mode === 'observe';
    const allowed = observed || !overLimit;
    const result = {
      allowed,
      observed,
      remaining: Math.max(0, rule.limit - bucket.count),
      resetAt: new Date(bucket.resetAt),
    };

    if (overLimit) {
      logger.warn(
        { scope, identifier, observed, resetAt: result.resetAt },
        observed ? 'rate limit observed' : 'rate limit exceeded',
      );
    }
    return result;
  } catch (error) {
    logger.error({ err: error, scope }, 'rate limiter failed open');
    return {
      allowed: true,
      observed: true,
      remaining: 0,
      resetAt: new Date(Date.now() + 1000),
    };
  }
}

export function assertRateLimit(
  scope: RateLimitScope,
  identifier: string,
): RateLimitResult {
  const result = checkRateLimit(scope, identifier);
  if (!result.allowed) {
    throw new AppError(
      'RATE_LIMITED',
      'Too many attempts. Try again shortly.',
      {
        resetAt: result.resetAt.toISOString(),
      },
    );
  }
  return result;
}

export function resetRateLimiterForTests(): void {
  buckets.clear();
}
