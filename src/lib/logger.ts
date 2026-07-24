import pino from 'pino';

/**
 * Structured JSON logger. Attach a correlation id per request/job so a single
 * operation can be traced across request → runner → evaluation.
 *
 * Never log secrets, tokens, full LLM prompts with PII, or raw payment data.
 */

const isDev = process.env.NODE_ENV !== 'production';

// pino-pretty runs in a worker thread (thread-stream). Next.js bundling breaks
// its worker path resolution, so only use the pretty transport OUTSIDE the Next
// runtime (i.e. in tsx scripts). Inside Next we emit plain JSON lines.
const usePretty = isDev && !process.env.NEXT_RUNTIME;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  redact: {
    paths: [
      'password',
      '*.password',
      'token',
      '*.token',
      'authorization',
      '*.authorization',
      'secret',
      '*.secret',
      'apiKey',
      '*.apiKey',
    ],
    remove: true,
  },
  ...(usePretty
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        },
      }
    : {}),
});

export type Logger = typeof logger;

/** Create a child logger bound to a correlation id (and optional context). */
export function withCorrelation(
  correlationId: string,
  context: Record<string, unknown> = {},
): Logger {
  return logger.child({ correlationId, ...context });
}
