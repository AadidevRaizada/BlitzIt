import 'server-only';
import { randomUUID } from 'node:crypto';
import { queue } from './pg-queue';

export { queue } from './pg-queue';
export { startRunner, runnerHeartbeat } from './runner';
export type { Queue, JobName, ClaimedJob, EnqueueOptions } from './queue';

/**
 * Enqueue a no-op job. Used to verify the job loop end-to-end (Milestone 0),
 * and by the health/dev tooling. Each call is a distinct job (random key).
 */
export function enqueueNoop(
  payload: Record<string, unknown> = {},
): Promise<string> {
  return queue.enqueue('noop', payload, {
    idempotencyKey: `noop:${randomUUID()}`,
  });
}
