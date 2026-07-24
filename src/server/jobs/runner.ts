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

class Runner {
  private readonly instanceId = `runner-${randomUUID().slice(0, 8)}`;
  private readonly concurrency: number;
  private running = false;
  private stopped = false;
  private lastHeartbeat = 0;

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, concurrency);
  }

  get heartbeat(): number {
    return this.lastHeartbeat;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.stopped = false;
    logger.info(
      { instanceId: this.instanceId, concurrency: this.concurrency },
      'evaluation runner started',
    );
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      this.lastHeartbeat = Date.now();
      try {
        const jobs = await queue.claim(this.concurrency, this.instanceId);
        if (jobs.length === 0) {
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
        await Promise.all(jobs.map((job) => this.run(job)));
      } catch (error) {
        // A claim failure (e.g. DB not reachable yet) should not kill the loop.
        captureException(error, { where: 'runner.loop' });
        await sleep(POLL_INTERVAL_MS);
      }
    }
    this.running = false;
    logger.info({ instanceId: this.instanceId }, 'evaluation runner stopped');
  }

  private async run(job: ClaimedJob): Promise<void> {
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
      const message = error instanceof Error ? error.message : 'unknown error';
      const backoff = BASE_BACKOFF_MS * 2 ** Math.max(0, job.attempts - 1);
      await queue.fail(job.id, message, backoff);
      captureException(error, { where: 'runner.run', jobId: job.id });
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
  runner = new Runner(concurrency);
  runner.start();
}

/** Runner heartbeat (ms epoch) for the health check. 0 if never started. */
export function runnerHeartbeat(): number {
  return runner?.heartbeat ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
