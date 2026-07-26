import Link from 'next/link';
import { requireUser } from '@/server/modules/auth';
import {
  countUnreadNotifications,
  listMyNotifications,
  NOTIFICATION_LABEL,
} from '@/server/modules/notification';
import { PageHeader } from '@/components/ui/page-header';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { MarkAllReadButton, MarkReadButton } from './notification-actions';

export const metadata = { title: 'Notifications — Blitz It' };
export const dynamic = 'force-dynamic';

/**
 * Screen [14] — in-app notifications (E8.3).
 *
 * Every notification appears here, whether or not it was also emailed: this
 * list is the competitor's record of what happened to them, and an event
 * missing from it looks like a bug in the tournament rather than in the mailer.
 *
 * The copy is rendered from the same pure `notificationContent` the emails use,
 * so a competitor reading their inbox and their notification list is never told
 * two different things about one event.
 */
export default async function NotificationsPage() {
  const user = await requireUser('/notifications');
  const [notifications, unread] = await Promise.all([
    listMyNotifications(user.id, { take: 100 }),
    countUnreadNotifications(user.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description={unread > 0 ? `${unread} unread` : 'You are up to date.'}
        actions={<MarkAllReadButton disabled={unread === 0} />}
      />

      {notifications.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          hint="Round openings, results and prize news land here."
        />
      ) : (
        <ul className="space-y-2">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={cn(
                'border-border bg-card rounded-lg border p-4',
                !notification.read && 'border-primary/40 bg-primary/5',
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={TONE[notification.type] ?? 'neutral'}>
                      {NOTIFICATION_LABEL[notification.type]}
                    </Badge>
                    {!notification.read ? (
                      <span className="text-primary text-xs font-medium">
                        New
                      </span>
                    ) : null}
                    {notification.status === 'FAILED' ? (
                      // Honest rather than silent: something was meant to reach
                      // them by email and did not.
                      <Badge tone="danger">Email failed</Badge>
                    ) : null}
                  </div>
                  <p className="mt-1.5 font-medium">{notification.title}</p>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    {notification.body}
                  </p>
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <time
                    dateTime={notification.createdAt.toISOString()}
                    className="text-muted-foreground text-xs tabular-nums"
                  >
                    {notification.createdAt
                      .toISOString()
                      .replace('T', ' ')
                      .slice(0, 16)}
                    Z
                  </time>
                  {!notification.read ? (
                    <MarkReadButton notificationId={notification.id} />
                  ) : null}
                </div>
              </div>

              {notification.cta ? (
                <p className="mt-3 text-sm">
                  <Link
                    href={notification.cta.path}
                    className="text-primary hover:underline"
                  >
                    {notification.cta.label} →
                  </Link>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const TONE: Readonly<Record<string, BadgeTone>> = {
  REGISTRATION_CONFIRMED: 'success',
  SEEDED: 'brand',
  ROUND_OPEN: 'brand',
  MATCH_REMINDER: 'warning',
  RESULT: 'info',
  ADVANCED: 'success',
  ELIMINATED: 'neutral',
  TOURNAMENT_COMPLETE: 'info',
  PAYOUT_SENT: 'success',
  PRIZE_POOL_UPDATE: 'neutral',
};
