import 'server-only';
import { z } from 'zod';
import { safeFetch } from '../safe-fetch';
import type {
  EvaluationContext,
  EvaluationStrategy,
  FunctionalResult,
  PerformanceResult,
  SecurityReliabilityResult,
  TestResult,
} from '../types';

/**
 * REST_API strategy — the only category enabled for Week 1 (D17).
 *
 * Grades the competitor's running deployment purely over HTTP. Nothing is
 * cloned, built or executed (D1).
 */

/** Shape of a hidden test's `spec`, authored with the problem. */
const httpAssertionSchema = z.object({
  method: z.string().default('GET'),
  path: z.string().default('/'),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  expect: z.object({
    status: z.number().int().optional(),
    /** Every entry must appear at the given JSON path. */
    jsonPath: z
      .array(z.object({ path: z.string(), equals: z.unknown() }))
      .optional(),
    bodyContains: z.array(z.string()).optional(),
    maxDurationMs: z.number().int().positive().optional(),
  }),
});

const contractSpecSchema = z
  .object({
    /** Path used for warm-up/performance sampling. */
    healthPath: z.string().default('/'),
    performanceSamples: z.number().int().min(1).max(20).default(6),
  })
  .partial()
  .passthrough();

/** Resolve `a.b[0].c` against a parsed JSON value. */
function readJsonPath(value: unknown, path: string): unknown {
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let current: unknown = value;
  for (const segment of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function joinUrl(base: string, path: string): string {
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
}

export const restApiStrategy: EvaluationStrategy = {
  category: 'REST_API',
  enabled: true,

  async runFunctional(ctx: EvaluationContext): Promise<FunctionalResult> {
    const results: TestResult[] = [];

    for (const test of ctx.hiddenTests) {
      const startedAt = Date.now();
      const parsed = httpAssertionSchema.safeParse(test.spec);

      if (!parsed.success) {
        results.push({
          id: test.id,
          name: test.name,
          passed: false,
          weight: test.weight,
          durationMs: 0,
          message: 'Malformed test specification',
        });
        continue;
      }

      const assertion = parsed.data;
      try {
        const response = await safeFetch(
          joinUrl(ctx.deploymentUrl, assertion.path),
          {
            method: assertion.method,
            headers: {
              accept: 'application/json',
              ...(assertion.body !== undefined
                ? { 'content-type': 'application/json' }
                : {}),
              ...assertion.headers,
            },
            body:
              assertion.body !== undefined
                ? JSON.stringify(assertion.body)
                : undefined,
            timeoutMs: test.timeoutMs,
          },
        );

        const failures = evaluateAssertion(assertion, response);
        results.push({
          id: test.id,
          name: test.name,
          passed: failures.length === 0,
          weight: test.weight,
          durationMs: Date.now() - startedAt,
          ...(failures.length > 0 ? { message: failures.join('; ') } : {}),
        });
      } catch (error) {
        results.push({
          id: test.id,
          name: test.name,
          passed: false,
          weight: test.weight,
          durationMs: Date.now() - startedAt,
          message: error instanceof Error ? error.message : 'Request failed',
        });
      }
    }

    const totalWeight = results.reduce((sum, r) => sum + r.weight, 0);
    const earned = results.reduce(
      (sum, r) => sum + (r.passed ? r.weight : 0),
      0,
    );

    return {
      score: totalWeight === 0 ? 0 : round2((earned / totalWeight) * 100),
      testsPassed: results.filter((r) => r.passed).length,
      testsTotal: results.length,
      results,
      deploymentReachable: true,
    };
  },

  async probePerformance(ctx: EvaluationContext): Promise<PerformanceResult> {
    const spec = contractSpecSchema.safeParse(ctx.contractSpec);
    const healthPath = spec.success ? (spec.data.healthPath ?? '/') : '/';
    const samples = spec.success ? (spec.data.performanceSamples ?? 6) : 6;
    const target = joinUrl(ctx.deploymentUrl, healthPath);

    const durations: number[] = [];
    let failures = 0;

    // Sequential, so we measure latency rather than our own concurrency limits
    // — and so we never resemble a load test against someone's free tier.
    for (let i = 0; i < samples; i++) {
      try {
        const response = await safeFetch(target, {
          timeoutMs: 10_000,
          maxBytes: 256_000,
        });
        if (response.status >= 500) failures++;
        else durations.push(response.durationMs);
      } catch {
        failures++;
      }
    }

    if (durations.length === 0) {
      return { score: 0, p50Ms: null, p95Ms: null, samples, failures };
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const p50 = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);

    // Bands rather than a curve: predictable and explainable to competitors.
    // <=150ms full marks, degrading to 0 by ~3s.
    const latencyScore =
      p95 <= 150
        ? 100
        : p95 <= 300
          ? 90
          : p95 <= 600
            ? 75
            : p95 <= 1000
              ? 60
              : p95 <= 2000
                ? 40
                : p95 <= 3000
                  ? 20
                  : 5;

    const reliabilityPenalty = (failures / samples) * 100;

    return {
      score: round2(Math.max(0, latencyScore - reliabilityPenalty)),
      p50Ms: round2(p50),
      p95Ms: round2(p95),
      samples,
      failures,
    };
  },

  async probeSecurity(
    ctx: EvaluationContext,
  ): Promise<SecurityReliabilityResult> {
    const checks: SecurityReliabilityResult['checks'] = [];
    const target = joinUrl(ctx.deploymentUrl, '/');

    let response: Awaited<ReturnType<typeof safeFetch>> | null = null;
    try {
      response = await safeFetch(target, { timeoutMs: 10_000 });
    } catch {
      return {
        score: 0,
        checks: [
          {
            id: 'reachable',
            label: 'Deployment responds',
            passed: false,
            weight: 1,
            detail: 'No response during the security probe',
          },
        ],
      };
    }

    const headers = response.headers;
    const isHttps = new URL(response.url).protocol === 'https:';

    checks.push({
      id: 'https',
      label: 'Served over HTTPS',
      passed: isHttps,
      weight: 3,
      detail: isHttps ? undefined : 'Deployment is served over plain HTTP',
    });
    checks.push({
      id: 'hsts',
      label: 'Strict-Transport-Security present',
      passed: Boolean(headers['strict-transport-security']),
      weight: 1,
    });
    checks.push({
      id: 'content-type-options',
      label: 'X-Content-Type-Options: nosniff',
      passed: headers['x-content-type-options']?.toLowerCase() === 'nosniff',
      weight: 1,
    });
    checks.push({
      id: 'frame-protection',
      label: 'Clickjacking protection (CSP frame-ancestors or X-Frame-Options)',
      passed:
        Boolean(headers['x-frame-options']) ||
        (headers['content-security-policy']?.includes('frame-ancestors') ??
          false),
      weight: 1,
    });
    checks.push({
      id: 'no-server-banner',
      label: 'No verbose server/technology banner',
      passed: !headers['x-powered-by'],
      weight: 1,
      detail: headers['x-powered-by']
        ? `x-powered-by: ${headers['x-powered-by']}`
        : undefined,
    });
    checks.push({
      id: 'no-5xx',
      label: 'Root does not return a server error',
      passed: response.status < 500,
      weight: 2,
      detail: `status ${response.status}`,
    });
    checks.push({
      id: 'no-stack-trace',
      label: 'No stack trace leaked in the response body',
      passed: !looksLikeStackTrace(response.body),
      weight: 2,
    });

    const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
    const earned = checks.reduce(
      (sum, c) => sum + (c.passed ? c.weight : 0),
      0,
    );

    return { score: round2((earned / totalWeight) * 100), checks };
  },
};

function evaluateAssertion(
  assertion: z.infer<typeof httpAssertionSchema>,
  response: Awaited<ReturnType<typeof safeFetch>>,
): string[] {
  const failures: string[] = [];
  const { expect } = assertion;

  if (expect.status !== undefined && response.status !== expect.status) {
    failures.push(`expected status ${expect.status}, got ${response.status}`);
  }

  if (
    expect.maxDurationMs !== undefined &&
    response.durationMs > expect.maxDurationMs
  ) {
    failures.push(
      `took ${response.durationMs}ms, limit ${expect.maxDurationMs}ms`,
    );
  }

  if (expect.bodyContains?.length) {
    for (const needle of expect.bodyContains) {
      if (!response.body.includes(needle)) {
        failures.push('response body missing an expected value');
        break;
      }
    }
  }

  if (expect.jsonPath?.length) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body);
    } catch {
      failures.push('response was not valid JSON');
      return failures;
    }
    for (const rule of expect.jsonPath) {
      const actual = readJsonPath(parsed, rule.path);
      if (JSON.stringify(actual) !== JSON.stringify(rule.equals)) {
        failures.push(`JSON path "${rule.path}" did not match`);
      }
    }
  }

  return failures;
}

function looksLikeStackTrace(body: string): boolean {
  const sample = body.slice(0, 4000);
  return (
    /\bat\s+[\w$.<>]+\s+\(.*:\d+:\d+\)/.test(sample) ||
    /Traceback \(most recent call last\)/.test(sample) ||
    /\b(?:NullPointerException|SQLSTATE|ORA-\d{5})\b/.test(sample)
  );
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
