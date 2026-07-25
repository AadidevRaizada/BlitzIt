import 'server-only';
import { safeFetch } from './safe-fetch';
import { logger } from '@/lib/logger';

/**
 * Deployment reachability (D15).
 *
 * Competitors host their own deployment, so a cold start must not be scored as
 * a failure. We send a warm-up request, then retry up to 3 times with
 * exponential backoff. If it is still unreachable the functional score is 0 and
 * the probe evidence explains why.
 */

const MAX_ATTEMPTS = 4; // 1 warm-up + 3 retries
const BASE_BACKOFF_MS = 2_000;
const WARMUP_TIMEOUT_MS = 15_000;

export interface WarmupResult {
  reachable: boolean;
  attempts: number;
  reachableAfterMs: number | null;
  /** Per-attempt record, retained as evidence for disputes. */
  log: Array<{
    attempt: number;
    status: number | null;
    durationMs: number;
    error?: string;
  }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function warmUpDeployment(url: string): Promise<WarmupResult> {
  const startedAt = Date.now();
  const log: WarmupResult['log'] = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptStart = Date.now();
    try {
      const response = await safeFetch(url, {
        timeoutMs: WARMUP_TIMEOUT_MS,
        maxBytes: 64_000,
      });

      log.push({
        attempt,
        status: response.status,
        durationMs: Date.now() - attemptStart,
      });

      // Any HTTP answer means the host is alive — even a 404 or 500. Only a
      // transport failure counts as unreachable; correctness is the tests' job.
      return {
        reachable: true,
        attempts: attempt,
        reachableAfterMs: Date.now() - startedAt,
        log,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      log.push({
        attempt,
        status: null,
        durationMs: Date.now() - attemptStart,
        error: message,
      });

      // A blocked URL is a hard failure — retrying will not make it public.
      if (error instanceof Error && error.name === 'BlockedUrlError') {
        logger.warn(
          { url, message },
          'deployment URL blocked by egress policy',
        );
        return {
          reachable: false,
          attempts: attempt,
          reachableAfterMs: null,
          log,
        };
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
    }
  }

  return {
    reachable: false,
    attempts: MAX_ATTEMPTS,
    reachableAfterMs: null,
    log,
  };
}
