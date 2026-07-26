'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/server/actions/notification.actions';
import { Button } from '@/components/ui/button';

/**
 * The only interactive parts of screen [14] (E8.3).
 *
 * Kept as two tiny islands rather than making the list a client component: the
 * list itself is a read model, and marking something read is the sole thing a
 * competitor can actually do to a notification.
 */

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAllNotificationsReadAction();
          if (result.ok) {
            if (result.data.count > 0) {
              toast.success(
                `${result.data.count} notification${result.data.count === 1 ? '' : 's'} marked read`,
              );
            }
            router.refresh();
          } else {
            toast.error(result.error.message);
          }
        })
      }
    >
      {pending ? 'Marking…' : 'Mark all read'}
    </Button>
  );
}

export function MarkReadButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-xs focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
      onClick={() =>
        startTransition(async () => {
          const result = await markNotificationReadAction(notificationId);
          if (result.ok) router.refresh();
          else toast.error(result.error.message);
        })
      }
    >
      {pending ? 'Marking…' : 'Mark read'}
    </button>
  );
}
