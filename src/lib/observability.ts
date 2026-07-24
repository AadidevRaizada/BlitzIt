import 'server-only';
import { logger } from './logger';

/**
 * Error/exception monitoring seam (Sentry).
 *
 * Foundation shell: routes to the structured logger today. The `SENTRY_DSN` env
 * var is recognized; wiring the `@sentry/nextjs` SDK is a small follow-up that
 * plugs in behind this stable interface without changing call sites.
 */

const dsn = process.env.SENTRY_DSN;

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  logger.error({ err: error, ...context }, 'captureException');
  // TODO(observability): forward to Sentry when SDK is wired and `dsn` is set.
  void dsn;
}

export function captureMessage(
  message: string,
  context?: Record<string, unknown>,
): void {
  logger.warn({ ...context }, message);
  void dsn;
}

export const sentryEnabled = Boolean(dsn);
