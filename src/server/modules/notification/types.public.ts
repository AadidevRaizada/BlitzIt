import type {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from '@/generated/prisma/client';

/**
 * Notification vocabulary — the pure half (E8.3).
 *
 * No database, no clock, no `server-only`, so the dedupe rule and the channel
 * policy can be exercised without a connection and shared with client badges.
 *
 * ## Dedupe is the whole design
 *
 * A notification pipeline's only real hazard is sending the same thing twice.
 * Rather than guarding each call site, every intent carries a `dedupeKey` built
 * from *what happened*, and the column is `@unique`. Raising the same intent
 * twice — a replayed job, an overlapping cron, an admin who also clicked —
 * collapses to one row in the database, and one row is one email.
 *
 * The key must therefore be derived from facts that do not change when the
 * event is re-derived. `ROUND_OPEN` for round R and user U is the same event
 * however many times the progress driver notices it; the timestamp of the
 * noticing is not part of it.
 */

export type { NotificationChannel, NotificationStatus, NotificationType };

/** What a notification is about, in the form the dedupe key is built from. */
export interface NotificationSubject {
  type: NotificationType;
  userId: string;
  /** The entity the event is about: a round, a match, a tournament. */
  scopeId: string;
}

/**
 * The idempotency key for one notification.
 *
 * Format: `<type>:<userId>:<scopeId>`. Deliberately readable — an operator
 * looking at a stuck row should be able to tell what it was without decoding a
 * hash, and the pieces are already opaque uuids.
 *
 * Channel is **not** part of the key. A competitor gets one notification per
 * event, rendered into whichever channels are configured for that type; keying
 * per channel would let an email and an in-app entry drift apart and be marked
 * read independently.
 */
export function notificationDedupeKey(subject: NotificationSubject): string {
  return `${subject.type}:${subject.userId}:${subject.scopeId}`;
}

/**
 * Which channels a type is delivered over.
 *
 * Every type is in-app: the list at [14] is the competitor's record of what
 * happened, and an event missing from it looks like a bug. Email is reserved
 * for things worth interrupting someone for — the round opening, a result,
 * elimination, a payout. `PRIZE_POOL_UPDATE` is deliberately in-app only: it
 * changes on every registration and would be spam.
 */
export const CHANNEL_POLICY: Readonly<
  Record<NotificationType, readonly NotificationChannel[]>
> = {
  REGISTRATION_CONFIRMED: ['EMAIL', 'IN_APP'],
  SEEDED: ['EMAIL', 'IN_APP'],
  ROUND_OPEN: ['EMAIL', 'IN_APP'],
  MATCH_REMINDER: ['EMAIL', 'IN_APP'],
  RESULT: ['EMAIL', 'IN_APP'],
  ADVANCED: ['EMAIL', 'IN_APP'],
  ELIMINATED: ['EMAIL', 'IN_APP'],
  TOURNAMENT_COMPLETE: ['EMAIL', 'IN_APP'],
  // A tournament someone entered is not happening, and their money is coming
  // back. Email is not optional for this one — it is the only channel that
  // reaches someone who is not going to open the site again precisely because
  // the event they were coming for is off.
  TOURNAMENT_CANCELLED: ['EMAIL', 'IN_APP'],
  PAYOUT_SENT: ['EMAIL', 'IN_APP'],
  PRIZE_POOL_UPDATE: ['IN_APP'],
};

export function channelsFor(
  type: NotificationType,
): readonly NotificationChannel[] {
  return CHANNEL_POLICY[type] ?? ['IN_APP'];
}

export function isEmailChannel(type: NotificationType): boolean {
  return channelsFor(type).includes('EMAIL');
}

/** Terminal states — a notification in one of these will not be sent again. */
export function isNotificationSettled(status: NotificationStatus): boolean {
  return status === 'SENT' || status === 'READ' || status === 'FAILED';
}

/** Short labels for the in-app list. */
export const NOTIFICATION_LABEL: Readonly<Record<NotificationType, string>> = {
  REGISTRATION_CONFIRMED: 'Registered',
  SEEDED: 'Seeded',
  ROUND_OPEN: 'Round open',
  MATCH_REMINDER: 'Match reminder',
  RESULT: 'Result',
  ADVANCED: 'Advanced',
  ELIMINATED: 'Eliminated',
  TOURNAMENT_COMPLETE: 'Tournament complete',
  TOURNAMENT_CANCELLED: 'Tournament cancelled',
  PAYOUT_SENT: 'Payout sent',
  PRIZE_POOL_UPDATE: 'Prize pool',
};
