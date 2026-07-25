'use client';

import { removeRegistrationAction } from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Remove a competitor from a tournament.
 *
 * A reason is mandatory — the blueprint requires one on every intervention, and
 * it lands in the audit log alongside the change.
 */
export function RemoveRegistrationButton({
  tournamentId,
  userId,
  username,
}: {
  tournamentId: string;
  userId: string;
  username: string;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-destructive">
          Remove
        </Button>
      }
      title={`Remove ${username}?`}
      description="Their registration is revoked, not deleted — submissions, evaluations and the audit trail are kept. They can be re-registered while the window is still open."
      confirmLabel="Remove competitor"
      requireReason
      successMessage={`${username} removed`}
      action={(reason) =>
        removeRegistrationAction(tournamentId, userId, reason)
      }
    />
  );
}
