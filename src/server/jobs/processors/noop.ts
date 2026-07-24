import 'server-only';
import type { ClaimedJob } from '../queue';
import { logger } from '@/lib/logger';

/**
 * No-op processor. Exists to prove the job loop end-to-end in Milestone 0.
 * Later epics register real processors (evaluate, advanceBracket, sendEmail…).
 */
export async function noopProcessor(job: ClaimedJob): Promise<void> {
  logger.info({ jobId: job.id, payload: job.payload }, 'noop job processed');
}
