import 'server-only';
import type { ClaimedJob } from '../queue';
import {
  deliverNotificationEmail,
  markNotificationFailed,
} from '@/server/modules/notification/delivery';
import { logger } from '@/lib/logger';
import { AppError } from '@/lib/errors';

/**
 * `sendEmail` processor (E8.3).
 *
 * Thin by design: the module owns rendering, sending and bookkeeping, and this
 * only translates between the queue's contract and the module's.
 *
 * Retry is the queue's job, not this one's — a provider blip rethrows and the
 * runner reschedules with backoff. The one thing that belongs here is the
 * *last* attempt: when a job is out of attempts the notification would
 * otherwise sit PENDING forever, invisible in the competitor's list and
 * indistinguishable from one that has not been tried yet.
 */
export async function sendEmailProcessor(job: ClaimedJob): Promise<void> {
  const notificationId = job.payload.notificationId;
  if (typeof notificationId !== 'string') {
    // Unrecoverable: no amount of retrying will produce an id. Complete rather
    // than throw, so it does not occupy a retry slot for something it can
    // never fix.
    logger.error(
      { jobId: job.id, payload: job.payload },
      'sendEmail job has no notificationId; discarding',
    );
    return;
  }

  try {
    const result = await deliverNotificationEmail(notificationId);
    logger.debug(
      { jobId: job.id, notificationId, ...result },
      'sendEmail done',
    );
  } catch (error) {
    // A notification that no longer exists will never exist again. Retrying
    // burns three attempts and ends in a dead-letter row that an operator has
    // to triage, for a job that was already unrunnable on the first attempt.
    // Discard it instead — the same treatment as a payload with no id.
    if (error instanceof AppError && error.code === 'NOT_FOUND') {
      logger.warn(
        { jobId: job.id, notificationId },
        'sendEmail job references a notification that no longer exists; discarding',
      );
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (job.attempts >= job.maxAttempts) {
      // Final attempt. Record the outcome on the notification before rethrowing
      // so the row does not stay PENDING after the job is dead-lettered.
      await markNotificationFailed(notificationId, message);
    }
    throw error;
  }
}
