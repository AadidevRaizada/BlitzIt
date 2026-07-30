import 'server-only';
import { db } from '@/server/db';
import { queue } from '@/server/jobs';
import { NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { isEmailChannel } from './types.public';
import { createMailer, redactEmail } from './mailer';
import { renderNotificationEmail } from './templates';

/**
 * Notification delivery (E8.3).
 *
 * The bridge between a recorded intent and an actual send — and the only place
 * that touches the queue. Business modules raise intents; they never enqueue,
 * never render, and never wait.
 */

/**
 * Queue the email for each newly-raised notification.
 *
 * **Call this after the transaction that raised the intents commits.** A job
 * enqueued inside a transaction that later rolls back would point at a
 * notification row that never existed — the same rule E4 follows when it
 * enqueues an evaluation after the submission commits.
 *
 * Keys that belong to in-app-only types are skipped here rather than filtered
 * by the caller, so a caller can pass everything it raised without knowing the
 * channel policy.
 */
export async function dispatchNotificationEmails(
  dedupeKeys: string[],
): Promise<number> {
  if (dedupeKeys.length === 0) return 0;

  const rows = await db.notification.findMany({
    where: { dedupeKey: { in: dedupeKeys }, status: 'PENDING' },
    select: { id: true, type: true, dedupeKey: true },
  });

  let queued = 0;
  for (const row of rows) {
    if (!isEmailChannel(row.type)) continue;
    await queue.enqueue(
      'sendEmail',
      { notificationId: row.id },
      {
        // Keyed on the notification's own dedupe key, so the job inherits the
        // same idempotency: one event, one row, one job, one email.
        idempotencyKey: `email:${row.dedupeKey}`,
        // Below evaluation (10) and lifecycle (20): an email that lands a few
        // seconds later costs nothing, a delayed round advance costs the event.
        priority: 5,
      },
    );
    queued++;
  }

  if (queued > 0) logger.info({ queued }, 'notification emails queued');
  return queued;
}

/**
 * Render and send one notification. Called by the `sendEmail` processor.
 *
 * Throws on a provider failure so the queue's retry and dead-letter machinery
 * applies unchanged — the notification is marked FAILED only once the job has
 * exhausted its attempts, which the processor decides, not this function.
 */
export async function deliverNotificationEmail(
  notificationId: string,
): Promise<{ sent: boolean; skipped: boolean }> {
  const notification = await db.notification.findUnique({
    where: { id: notificationId },
    include: {
      user: {
        select: {
          email: true,
          displayName: true,
          username: true,
          isBot: true,
        },
      },
    },
  });
  if (!notification) {
    throw new NotFoundError(`notification ${notificationId} not found`);
  }

  // A bot receives NOTIFICATION ROWS — that is deliberate, it is how the
  // notification pipeline gets exercised end to end — but never an email. Its
  // address is already on an unroutable `.invalid` domain, so this is the second
  // of two independent guards. Email is the one thing on this platform that
  // leaves the building, and the cost of being wrong once is a real message to a
  // real address; two guards is proportionate.
  if (notification.user.isBot) {
    await db.notification.update({
      where: { id: notification.id },
      // Terminal, not left PENDING: the intent has been processed as far as it
      // can be, and a PENDING row would be retried by every future sweep.
      data: { status: 'SENT', sentAt: new Date(), lastError: null },
    });
    logger.debug(
      { notificationId, type: notification.type },
      'notification belongs to a bot; no email sent',
    );
    return { sent: false, skipped: true };
  }

  // Already delivered, or already read by the recipient in-app. Either way
  // there is nothing to send, and re-sending would be the exact duplicate the
  // dedupe key exists to prevent.
  if (notification.status === 'SENT' || notification.status === 'READ') {
    logger.debug(
      { notificationId, status: notification.status },
      'notification already delivered; skipping',
    );
    return { sent: false, skipped: true };
  }
  if (!isEmailChannel(notification.type)) {
    return { sent: false, skipped: true };
  }

  const rendered = renderNotificationEmail(
    notification.type,
    notification.payload,
    notification.user.displayName ?? notification.user.username,
  );

  const mailer = createMailer();
  try {
    const result = await mailer.send({
      to: notification.user.email,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });

    await db.notification.update({
      where: { id: notification.id },
      data: {
        // A skipped send (no provider configured) is still terminal: the
        // intent has been processed as far as this deployment can process it,
        // and leaving it PENDING would have every future sweep retry it
        // forever.
        status: 'SENT',
        sentAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
      },
    });

    logger.info(
      {
        notificationId,
        type: notification.type,
        to: redactEmail(notification.user.email),
        provider: result.provider,
        skipped: result.skipped,
      },
      result.skipped ? 'notification email skipped' : 'notification email sent',
    );
    return { sent: !result.skipped, skipped: result.skipped };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.notification.update({
      where: { id: notification.id },
      data: { attempts: { increment: 1 }, lastError: message.slice(0, 500) },
    });
    // Rethrow: the queue owns retry and dead-lettering.
    throw error;
  }
}

/**
 * Mark a notification permanently failed. Called by the processor when the job
 * has exhausted its attempts, so a competitor's list can show that something
 * was meant to reach them and did not.
 */
export async function markNotificationFailed(
  notificationId: string,
  error: string,
): Promise<void> {
  await db.notification.updateMany({
    where: { id: notificationId, status: 'PENDING' },
    data: { status: 'FAILED', lastError: error.slice(0, 500) },
  });
}

/**
 * Sweep notifications that were raised but never queued — a crash between the
 * commit and the enqueue, most likely a redeploy.
 *
 * Cheap and idempotent (the job key is the notification's dedupe key), so it is
 * safe to run from cron alongside the other housekeeping passes.
 */
export async function dispatchUndeliveredEmails(
  olderThanMs = 60_000,
  limit = 100,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stranded = await db.notification.findMany({
    where: { status: 'PENDING', sentAt: null, createdAt: { lt: cutoff } },
    select: { dedupeKey: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  if (stranded.length === 0) return 0;

  return dispatchNotificationEmails(stranded.map((row) => row.dedupeKey));
}
