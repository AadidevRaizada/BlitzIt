'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUserOrThrow } from '@/server/modules/auth';
import {
  markAllNotificationsRead,
  markNotificationRead,
} from '@/server/modules/notification';
import { ok, toErr, type Result } from '@/lib/errors';
import { captureException } from '@/lib/observability';

/**
 * Notification actions (E8.3).
 *
 * Read state only — nothing here creates a notification. Intents are raised by
 * the module that owns the event, never by a click.
 *
 * Ownership is enforced inside the module, in the WHERE clause of the update.
 * These actions pass the session's user id and cannot be talked into passing
 * somebody else's.
 */

const notificationIdSchema = z.object({
  notificationId: z.string().uuid('Invalid notification'),
});

export async function markNotificationReadAction(
  notificationId: unknown,
): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUserOrThrow();
    const parsed = notificationIdSchema.safeParse({ notificationId });
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: parsed.error.issues[0]?.message ?? 'Invalid notification',
        },
      };
    }

    const view = await markNotificationRead(
      parsed.data.notificationId,
      user.id,
    );
    revalidatePath('/notifications');
    return ok({ id: view.id });
  } catch (error) {
    captureException(error, { where: 'markNotificationReadAction' });
    return toErr(error);
  }
}

export async function markAllNotificationsReadAction(): Promise<
  Result<{ count: number }>
> {
  try {
    const user = await requireUserOrThrow();
    const count = await markAllNotificationsRead(user.id);
    revalidatePath('/notifications');
    return ok({ count });
  } catch (error) {
    captureException(error, { where: 'markAllNotificationsReadAction' });
    return toErr(error);
  }
}
