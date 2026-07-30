import 'server-only';
import { runBotSubmissionsForRound } from '@/server/modules/bot/bot-submit';
import type { ClaimedJob } from '../queue';
import { logger } from '@/lib/logger';

/**
 * `botSubmit` job processor (D35).
 *
 * Makes every bot in an open test round submit. Runs through the queue rather
 * than inline in the sweep for the same reason D30 gives for round progression:
 * one path, under the runner's concurrency cap and retry policy, instead of a
 * second one that bypasses both.
 */
export async function botSubmitProcessor(job: ClaimedJob): Promise<void> {
  const roundId =
    typeof job.payload.roundId === 'string' ? job.payload.roundId : null;
  if (!roundId) throw new Error('botSubmit job is missing roundId');

  const result = await runBotSubmissionsForRound(roundId);
  logger.info(
    { jobId: job.id, roundId, ...result },
    'bot submission pass complete',
  );
}
