'use client';

import {
  cancelRegistrationPaymentAdminAction,
  markManualPaymentPaidAction,
  refundPaymentAction,
} from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export function RefundPaymentButton({
  paymentId,
  disabled,
  retry = false,
}: {
  paymentId: string;
  disabled?: boolean;
  retry?: boolean;
}) {
  const label = retry ? 'Retry refund' : 'Refund';
  if (disabled) {
    return (
      <Button size="sm" variant="ghost" disabled>
        {label}
      </Button>
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-destructive">
          {label}
        </Button>
      }
      title={retry ? 'Retry refund?' : 'Refund payment?'}
      description="The gateway refund uses the same idempotency key, then the payment, registration and prize pool are updated together."
      confirmLabel={retry ? 'Retry refund' : 'Refund payment'}
      requireReason
      successMessage={retry ? 'Refund retry requested' : 'Payment refunded'}
      action={(reason) => refundPaymentAction(paymentId, reason)}
    />
  );
}

export function MarkManualPaidButton({
  paymentId,
  disabled,
}: {
  paymentId: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <Button size="sm" variant="ghost" disabled>
        Mark paid
      </Button>
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost">
          Mark paid
        </Button>
      }
      title="Mark manual payment paid?"
      description="This activates registration through the same atomic payment path used by gateway confirmations."
      confirmLabel="Mark paid"
      variant="secondary"
      requireReason
      successMessage="Payment marked paid"
      action={(reason) => markManualPaymentPaidAction(paymentId, reason)}
    />
  );
}

export function CancelRegistrationButton({
  tournamentId,
  userId,
  disabled,
}: {
  tournamentId: string;
  userId: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <Button size="sm" variant="ghost" disabled>
        Cancel registration
      </Button>
    );
  }
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-destructive">
          Cancel registration
        </Button>
      }
      title="Cancel registration?"
      description="The capacity slot is released and the prize pool is recomputed. The payment row and audit trail are retained."
      confirmLabel="Cancel registration"
      requireReason
      successMessage="Registration cancelled"
      action={(reason) =>
        cancelRegistrationPaymentAdminAction(tournamentId, userId, reason)
      }
    />
  );
}
