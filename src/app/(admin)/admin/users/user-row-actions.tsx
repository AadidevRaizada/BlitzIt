'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import type { Role } from '@/generated/prisma/client';
import {
  deleteUserAction,
  setTesterRoleAction,
} from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Per-row admin actions on a user.
 *
 * Nothing here decides whether an action is allowed — `directory.ts` owns every
 * rule, and this component only avoids offering buttons that would certainly be
 * refused. A stale page that still shows one gets a typed error back rather than
 * a surprise, which is the same contract `SubmissionRowActions` works under.
 *
 * The delete/anonymise choice is made HERE rather than by the server picking
 * one, because they are different decisions with different consequences and the
 * operator has to know which one they are making. `hasCompetitiveRecord` is
 * computed in the list query so the right dialog is shown before the click, not
 * after a refusal.
 */
export function UserRowActions({
  userId,
  username,
  role,
  isBot,
  hasCompetitiveRecord,
  isSelf,
}: {
  userId: string;
  username: string;
  role: Role;
  isBot: boolean;
  hasCompetitiveRecord: boolean;
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // An admin's role is not editable from this table by design: granting the
  // role that grants roles belongs out of band (`make:admin`), not one click
  // away in a directory an operator uses daily.
  const roleEditable = !isBot && role !== 'ADMIN';
  const isTester = role === 'TEST';

  return (
    <div className="flex items-center justify-end gap-1">
      {roleEditable ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          aria-busy={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await setTesterRoleAction(userId, !isTester);
              if (result.ok) {
                toast.success(
                  isTester
                    ? `${username} is no longer a tester`
                    : `${username} can now access the test environment`,
                );
                router.refresh();
              } else {
                toast.error(result.error.message);
              }
            })
          }
        >
          {isTester ? 'Revoke TEST' : 'Grant TEST'}
        </Button>
      ) : null}

      {isSelf ? (
        <span className="text-muted-foreground text-xs">You</span>
      ) : hasCompetitiveRecord ? (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="ghost" className="text-destructive">
              Anonymise
            </Button>
          }
          title={`Anonymise ${username}?`}
          description="This account has submissions, rankings or payments on record, so it cannot be deleted — doing so would rewrite finished tournaments and leave Hall of Fame entries pointing at nobody. Anonymising scrubs their email, name, avatar, location and profile, and leaves the competitive record standing. It cannot be undone."
          confirmLabel="Anonymise"
          requireReason
          successMessage="Account anonymised"
          action={() => deleteUserAction(userId, true)}
        />
      ) : (
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="ghost" className="text-destructive">
              Delete
            </Button>
          }
          title={`Delete ${username}?`}
          description={
            isBot
              ? 'This bot and its configuration will be removed permanently. Bots hold no competitive record worth preserving.'
              : 'This account has no submissions, rankings or payments, so it can be removed permanently along with its profile and sign-in. This cannot be undone.'
          }
          confirmLabel="Delete"
          requireReason
          successMessage="Account deleted"
          action={() => deleteUserAction(userId, false)}
        />
      )}
    </div>
  );
}
