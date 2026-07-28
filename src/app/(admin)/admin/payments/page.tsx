import Link from 'next/link';
import { requireAdmin } from '@/server/modules/auth';
import {
  listPaymentsForAdmin,
  listWebhookEventsForAdmin,
} from '@/server/modules/payment';
import { formatMinor } from '@/server/modules/notification';
import { Badge } from '@/components/ui/badge';
import { PageHeader, formatIst } from '@/components/ui/page-header';
import {
  EmptyState,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableShell,
} from '@/components/ui/table';
import {
  CancelRegistrationButton,
  MarkManualPaidButton,
  RefundPaymentButton,
} from './payment-actions';

export const metadata = { title: 'Payments - The Circuit Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tournamentId?: string;
    status?: string;
    user?: string;
  }>;
}) {
  await requireAdmin('/admin/payments');
  const filters = await searchParams;
  const [payments, webhooks] = await Promise.all([
    listPaymentsForAdmin({
      tournamentId: filters.tournamentId,
      status: paymentStatus(filters.status),
      user: filters.user,
      take: 200,
    }),
    listWebhookEventsForAdmin({ take: 25 }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description={`${payments.length} payment rows. Gateway failures, refunds, manual confirmations and webhook receipts are visible here.`}
      />

      {payments.length === 0 ? (
        <EmptyState
          title="No payments"
          hint="Payments appear after a competitor creates a pass order."
        />
      ) : (
        <TableShell>
          <THead>
            <TH>Payment</TH>
            <TH>Competitor</TH>
            <TH>Status</TH>
            <TH numeric>Amount</TH>
            <TH>Created</TH>
            <TH numeric>Actions</TH>
          </THead>
          <TBody>
            {payments.map((payment) => (
              <TR key={payment.id}>
                <TD>
                  <Link
                    href={`/admin/payments/${payment.id}`}
                    className="hover:text-primary font-medium underline-offset-2 hover:underline"
                  >
                    {payment.providerOrderId}
                  </Link>
                  <span className="text-muted-foreground block text-xs">
                    {payment.tournamentName}
                  </span>
                  {payment.providerPaymentId ? (
                    <span className="text-muted-foreground block text-xs">
                      {payment.providerPaymentId}
                    </span>
                  ) : null}
                </TD>
                <TD>
                  <span className="font-medium">{payment.username}</span>
                  <span className="text-muted-foreground block text-xs">
                    {payment.email}
                  </span>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge status={payment.status} />
                    {payment.registrationStatus ? (
                      <Badge tone="outline">{payment.registrationStatus}</Badge>
                    ) : null}
                    {payment.refundRequiredAt ? (
                      <Badge tone="warning">Refund due</Badge>
                    ) : null}
                  </div>
                  {payment.status === 'FAILED' ? (
                    <p className="text-destructive mt-1 text-xs">
                      Payment failed
                    </p>
                  ) : null}
                </TD>
                <TD numeric>
                  {formatMinor(payment.amountMinor, payment.currency)}
                </TD>
                <TD>
                  <span className="text-xs">
                    {formatIst(payment.createdAt)}
                  </span>
                </TD>
                <TD numeric>
                  <div className="flex flex-wrap justify-end gap-1">
                    <MarkManualPaidButton
                      paymentId={payment.id}
                      disabled={
                        payment.status === 'PAID' ||
                        payment.status === 'REFUNDED'
                      }
                    />
                    <RefundPaymentButton
                      paymentId={payment.id}
                      disabled={
                        payment.status !== 'PAID' ||
                        payment.refundIntentAt !== null
                      }
                    />
                    <CancelRegistrationButton
                      tournamentId={payment.tournamentId}
                      userId={payment.userId}
                      disabled={payment.registrationStatus !== 'ACTIVE'}
                    />
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </TableShell>
      )}

      <section className="space-y-3">
        <h2 className="text-eyebrow text-muted-foreground font-semibold uppercase">
          Webhook history
        </h2>
        {webhooks.length === 0 ? (
          <EmptyState
            title="No webhook events"
            hint="Every received Razorpay webhook is recorded here, including rejected signatures."
          />
        ) : (
          <TableShell>
            <THead>
              <TH>Event</TH>
              <TH>Payment</TH>
              <TH>Signature</TH>
              <TH>Outcome</TH>
              <TH>Received</TH>
            </THead>
            <TBody>
              {webhooks.map((event) => (
                <TR key={event.id}>
                  <TD>
                    <span className="font-medium">{event.eventType}</span>
                    <span className="text-muted-foreground block text-xs">
                      {event.providerEventId}
                    </span>
                    {event.errorMessage ? (
                      <span className="text-destructive block text-xs">
                        {event.errorMessage}
                      </span>
                    ) : null}
                  </TD>
                  <TD>{event.paymentLabel ?? 'Unknown order'}</TD>
                  <TD>
                    <Badge
                      tone={event.signatureVerified ? 'success' : 'danger'}
                    >
                      {event.signatureVerified ? 'Verified' : 'Rejected'}
                    </Badge>
                  </TD>
                  <TD>
                    <WebhookOutcomeBadge outcome={event.outcome} />
                  </TD>
                  <TD>
                    <span className="text-xs">
                      {formatIst(event.receivedAt)}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        )}
      </section>
    </div>
  );
}

function paymentStatus(value: string | undefined) {
  return [
    'CREATED',
    'PENDING',
    'PAID',
    'PENDING_REFUND',
    'REFUND_FAILED',
    'FAILED',
    'REFUNDED',
  ].includes(value ?? '')
    ? (value as
        | 'CREATED'
        | 'PENDING'
        | 'PAID'
        | 'PENDING_REFUND'
        | 'REFUND_FAILED'
        | 'FAILED'
        | 'REFUNDED')
    : undefined;
}

function StatusBadge({
  status,
}: {
  status:
    | 'CREATED'
    | 'PENDING'
    | 'PAID'
    | 'PENDING_REFUND'
    | 'REFUND_FAILED'
    | 'FAILED'
    | 'REFUNDED';
}) {
  const tone =
    status === 'PAID'
      ? 'success'
      : status === 'FAILED' || status === 'REFUND_FAILED'
        ? 'danger'
        : status === 'REFUNDED' || status === 'PENDING_REFUND'
          ? 'warning'
          : 'neutral';
  return <Badge tone={tone}>{status}</Badge>;
}

function WebhookOutcomeBadge({
  outcome,
}: {
  outcome: 'APPLIED' | 'DEDUPED' | 'IGNORED' | 'REJECTED';
}) {
  const tone =
    outcome === 'APPLIED'
      ? 'success'
      : outcome === 'REJECTED'
        ? 'danger'
        : outcome === 'IGNORED'
          ? 'warning'
          : 'neutral';
  return <Badge tone={tone}>{outcome}</Badge>;
}
