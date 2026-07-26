import 'server-only';
import type { Notification, NotificationType } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { ForbiddenError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import {
  channelsFor,
  isEmailChannel,
  notificationDedupeKey,
} from './types.public';
import { notificationContent } from './content.public';

/**
 * Notifications — the persisted half (E8.3).
 *
 * ## The pipeline
 *
 * ```
 * something happens  ──►  raiseNotification()  ──►  Notification row (PENDING)
 *                                                        │
 *                                                   Queue (D3)
 *                                                        │
 *                                              sendEmail processor
 *                                                        │
 *                                                  Mailer (Resend)
 * ```
 *
 * Exactly the shape E4 used for evaluation: the caller records an *intent* and
 * returns. Nothing in a business module ever waits on an email, and a mail
 * provider being slow or down cannot stall a lifecycle transition.
 *
 * ## Idempotency
 *
 * `dedupeKey` is `@unique` and derived from what happened, so raising the same
 * intent twice collapses to one row. `raiseNotification` uses `createMany` with
 * `skipDuplicates`, which makes the collapse a database property rather than a
 * check-then-insert race between two runners.
 *
 * The enqueue therefore happens ONLY when a row was actually created. A replay
 * that inserted nothing must not enqueue a second send.
 */

export interface NotificationIntent {
  userId: string;
  type: NotificationType;
  /** The entity this is about — a round, a match, a tournament. */
  scopeId: string;
  tournamentId?: string | null;
  payload?: Record<string, unknown>;
}

export interface RaiseResult {
  /** Rows actually created; already-raised intents are not counted. */
  created: number;
  /** Dedupe keys that were newly created, in input order. */
  createdKeys: string[];
}

/**
 * Record one or more notification intents.
 *
 * Safe to call inside a transaction — pass the transaction client. The email
 * enqueue is deliberately NOT done here: a job enqueued inside a transaction
 * that later rolls back would reference a row that never existed. Callers use
 * `dispatchPendingEmails` after commit, exactly as E4 enqueues evaluation after
 * its submission transaction commits.
 */
export async function raiseNotifications(
  intents: NotificationIntent[],
  client: DbClient = db,
): Promise<RaiseResult> {
  if (intents.length === 0) return { created: 0, createdKeys: [] };

  const rows = intents.map((intent) => ({
    userId: intent.userId,
    type: intent.type,
    // One row per event. `channel` records the PRIMARY channel; the in-app list
    // shows every notification regardless, and `channelsFor` decides whether an
    // email is also sent. Splitting into a row per channel would let the two
    // drift apart and be marked read independently.
    channel: isEmailChannel(intent.type)
      ? ('EMAIL' as const)
      : ('IN_APP' as const),
    payload: (intent.payload ?? {}) as never,
    dedupeKey: notificationDedupeKey({
      type: intent.type,
      userId: intent.userId,
      scopeId: intent.scopeId,
    }),
    tournamentId: intent.tournamentId ?? null,
  }));

  const result = await client.notification.createMany({
    data: rows,
    // The whole idempotency guarantee, in one flag: a duplicate key is a
    // no-op rather than an error, so two runners racing on the same event
    // produce one notification between them.
    skipDuplicates: true,
  });

  // Which keys are new cannot be read off `createMany`, so they are read back.
  // Only rows that have never been dispatched are eligible.
  const createdKeys =
    result.count > 0
      ? (
          await client.notification.findMany({
            where: {
              dedupeKey: { in: rows.map((row) => row.dedupeKey) },
              status: 'PENDING',
              sentAt: null,
            },
            select: { dedupeKey: true },
          })
        ).map((row) => row.dedupeKey)
      : [];

  if (result.count > 0) {
    logger.info(
      { raised: result.count, requested: intents.length },
      'notifications raised',
    );
  }
  return { created: result.count, createdKeys };
}

/** Convenience for the common single-intent case. */
export async function raiseNotification(
  intent: NotificationIntent,
  client: DbClient = db,
): Promise<RaiseResult> {
  return raiseNotifications([intent], client);
}

// ───────────────────────── Reading (screen [14]) ─────────────────────────

export interface NotificationView {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  cta: { label: string; path: string } | null;
  status: Notification['status'];
  read: boolean;
  readAt: Date | null;
  tournamentId: string | null;
  createdAt: Date;
}

function toView(row: Notification): NotificationView {
  // The stored payload is rendered through the same pure copy the email uses,
  // so the in-app list and the inbox never say different things about one event.
  const content = notificationContent(row.type, row.payload);
  return {
    id: row.id,
    type: row.type,
    title: content.subject,
    body: content.lines.join(' '),
    cta: content.cta,
    status: row.status,
    read: row.readAt !== null,
    readAt: row.readAt,
    tournamentId: row.tournamentId,
    createdAt: row.createdAt,
  };
}

export async function listMyNotifications(
  userId: string,
  options: { take?: number; unreadOnly?: boolean } = {},
  client: DbClient = db,
): Promise<NotificationView[]> {
  const rows = await client.notification.findMany({
    where: {
      userId,
      ...(options.unreadOnly ? { readAt: null } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.take ?? 50,
  });
  return rows.map(toView);
}

export async function countUnreadNotifications(
  userId: string,
  client: DbClient = db,
): Promise<number> {
  return client.notification.count({ where: { userId, readAt: null } });
}

/**
 * Mark one notification read.
 *
 * Ownership is enforced in the WHERE clause rather than by reading first and
 * comparing: a conditional update cannot be raced, and it never reveals whether
 * somebody else's notification id exists.
 */
export async function markNotificationRead(
  notificationId: string,
  userId: string,
  client: DbClient = db,
): Promise<NotificationView> {
  const updated = await client.notification.updateMany({
    where: { id: notificationId, userId, readAt: null },
    data: { readAt: new Date(), status: 'READ' },
  });

  const row = await client.notification.findFirst({
    where: { id: notificationId, userId },
  });
  if (!row) throw new NotFoundError('That notification does not exist');

  if (updated.count === 0 && row.readAt === null) {
    // Row exists, belongs to the user, and still is not read: something else
    // is wrong, and silently reporting success would hide it.
    throw new ForbiddenError('That notification could not be updated');
  }
  return toView(row);
}

export async function markAllNotificationsRead(
  userId: string,
  client: DbClient = db,
): Promise<number> {
  const now = new Date();
  const result = await client.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: now, status: 'READ' },
  });
  return result.count;
}

/** Channels a type is delivered over — re-exported so callers need one import. */
export { channelsFor };
