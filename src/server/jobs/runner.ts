import 'server-only';
import { randomUUID } from 'node:crypto';
import { queue } from './pg-queue';
import type { ClaimedJob } from './queue';
import { processors } from './processors';
import { logger } from '@/lib/logger';
import { captureException } from '@/lib/observability';

/**
 * In-process Evaluation Runner (D3). Booted once from `instrumentation.ts`.
 * Polls the Postgres job table, claims runnable jobs (SKIP LOCKED), and runs
 * their processors with a concurrency cap. Behind the `Queue` interface, so it
 * can be extracted to a dedicated worker (or swapped for BullMQ) later.
 */

const POLL_INTERVAL_MS = 2000;
const BASE_BACKOFF_MS = 5000;

/**
 * How long a job may sit CLAIMED before we assume its runner died and requeue
 * it. Must exceed the longest expected job duration, or healthy in-flight jobs
 * get reclaimed and run twice. Configurable via RUNNER_CLAIM_TIMEOUT_MS.
 */
// A full evaluation can legitimately run for many minutes (repo fetches +
// probes + LLM), so this sits well above the realistic worst case. The claim
// heartbeat below is the actual protection; this is defence in depth for a
// process that dies without releasing its claims.
const DEFAULT_CLAIM_TIMEOUT_MS = 900_000; // 15 minutes

/** How often to sweep for abandoned claims (cheap single UPDATE). */
const RECLAIM_INTERVAL_MS = 30_000;

/** How often in-flight claims are refreshed. Must be << the claim timeout. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Runner state lives on globalThis, not in module scope. Next.js bundles
 * `instrumentation.ts` and route handlers as SEPARATE module instances, so a
 * module-level variable set at boot is invisible to /api/health. globalThis is
 * shared across those bundles within the same Node process.
 */
const globalForRunner = globalThis as unknown as {
  __blitzRunner?: { started: boolean; heartbeat: number };
};

const runnerState = (globalForRunner.__blitzRunner ??= {
  started: false,
  heartbeat: 0,
});

class Runner {
  private readonly instanceId = `runner-${randomUUID().slice(0, 8)}`;
  private readonly concurrency: number;
  private readonly claimTimeoutMs: number;
  private running = false;
  private stopped = false;
  private lastReclaimAt = 0;
  /** Jobs this runner currently holds — refreshed by the claim heartbeat. */
  private readonly inFlight = new Set<string>();
  private heartbeatTimer: NodeJS.Timeout | undefined;

  constructor(concurrency: number, claimTimeoutMs: number) {
    this.concurrency = Math.max(1, concurrency);
    this.claimTimeoutMs = Math.max(1000, claimTimeoutMs);
  }

  private set lastHeartbeat(value: number) {
    runnerState.heartbeat = value;
  }

  get heartbeat(): number {
    return runnerState.heartbeat;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    runnerState.started = true;
    logger.info(
      {
        instanceId: this.instanceId,
        concurrency: this.concurrency,
        claimTimeoutMs: this.claimTimeoutMs,
      },
      'evaluation runner started',
    );

    // Keep this runner's claims fresh for as long as it is actually working.
    this.heartbeatTimer = setInterval(() => {
      const ids = [...this.inFlight];
      if (ids.length === 0) return;
      void queue
        .heartbeat(ids, this.instanceId)
        .catch((error: unknown) =>
          captureException(error, { where: 'runner.heartbeat' }),
        );
    }, HEARTBEAT_INTERVAL_MS);
    // Never hold the process open just for the heartbeat.
    this.heartbeatTimer.unref?.();

    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      this.lastHeartbeat = Date.now();
      try {
        await this.reclaimStaleJobs();

        // Only claim what we can actually start now. Awaiting the whole batch
        // would idle free capacity behind the slowest job in it — an
        // evaluation can run for minutes, during which newly submitted work
        // would sit unclaimed despite an open slot.
        const capacity = this.concurrency - this.inFlight.size;
        if (capacity <= 0) {
          await sleep(POLL_INTERVAL_MS);
          continue;
        }

        const jobs = await queue.claim(capacity, this.instanceId);
        if (jobs.length === 0) {
          await sleep(POLL_INTERVAL_MS);
          continue;
        }

        // Start them and keep polling; `run()` clears its own slot when done.
        // Errors are handled inside run(), so these never reject.
        for (const job of jobs) {
          void this.run(job);
        }
      } catch (error) {
        // A claim failure (e.g. DB not reachable yet) should not kill the loop.
        captureException(error, { where: 'runner.loop' });
        await sleep(POLL_INTERVAL_MS);
      }
    }
    this.running = false;
    logger.info({ instanceId: this.instanceId }, 'evaluation runner stopped');
  }

  /**
   * Periodically requeue jobs abandoned by a crashed/redeployed runner. Runs on
   * an interval rather than every poll so the sweep stays cheap.
   */
  private async reclaimStaleJobs(): Promise<void> {
    if (Date.now() - this.lastReclaimAt < RECLAIM_INTERVAL_MS) return;
    this.lastReclaimAt = Date.now();

    const { requeued, failed } = await queue.reclaimStale(this.claimTimeoutMs);
    if (requeued > 0 || failed > 0) {
      logger.warn(
        { instanceId: this.instanceId, requeued, failed },
        'reclaimed stale jobs from abandoned claims',
      );
    }
  }

  private async run(job: ClaimedJob): Promise<void> {
    // Reserve the slot SYNCHRONOUSLY, before the first await. The poll loop no
    // longer awaits this method, so it computes free capacity immediately
    // after; adding later would let it over-claim. Also keeps the claim
    // heartbeated so a long-but-healthy job is never reclaimed and run twice.
    this.inFlight.add(job.id);
    try {
      const processor = processors[job.name];
      if (!processor) {
        await queue.fail(job.id, `No processor for job "${job.name}"`, 0);
        logger.error(
          { jobId: job.id, name: job.name },
          'no processor registered',
        );
        return;
      }

      try {
        await processor(job);
        await queue.complete(job.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown error';
        const backoff = BASE_BACKOFF_MS * 2 ** Math.max(0, job.attempts - 1);
        await queue.fail(job.id, message, backoff);
        captureException(error, { where: 'runner.run', jobId: job.id });
      }
    } finally {
      this.inFlight.delete(job.id);
    }
  }
}

let runner: Runner | undefined;

/** Start the runner once. Safe to call multiple times (idempotent). */
export function startRunner(): void {
  if (process.env.RUNNER_ENABLED === 'false') {
    logger.warn('evaluation runner disabled via RUNNER_ENABLED=false');
    return;
  }
  if (runner) return;
  const concurrency = Number(process.env.RUNNER_CONCURRENCY ?? '2');
  const claimTimeoutMs = Number(
    process.env.RUNNER_CLAIM_TIMEOUT_MS ?? DEFAULT_CLAIM_TIMEOUT_MS,
  );
  runner = new Runner(concurrency, claimTimeoutMs);
  runner.start();
}

/**
 * Runner heartbeat (ms epoch) for the health check. 0 if never started.
 * Reads shared globalThis state so it is accurate from route handlers, which
 * Next bundles separately from `instrumentation.ts`.
 */
export function runnerHeartbeat(): number {
  return runnerState.heartbeat;
}

/** Whether the runner was started in this process. */
export function runnerStarted(): boolean {
  return runnerState.started;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
