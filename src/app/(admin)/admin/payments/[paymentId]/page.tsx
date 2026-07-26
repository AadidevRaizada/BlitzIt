import { notFound } from 'next/navigation';
import { requireAdmin } from '@/server/modules/auth';
import { getPaymentForAdmin } from '@/server/modules/payment';
import { formatMinor } from '@/server/modules/notification';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  DataRow,
  PageHeader,
  SectionTitle,
  formatIst,
} from '@/components/ui/page-header';
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
} from '../payment-actions';

export const metadata = { title: 'Payment detail - The Circuit Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminPaymentDetailPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  await requireAdmin('/admin/payments');
  const { paymentId } = await params;
  const detail = await getPaymentForAdmin(paymentId).catch(() => null);
  if (!detail) notFound();
  const { payment, audit, webhooks } = detail;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment detail"
        description={payment.providerOrderId}
        back={{ href: '/admin/payments', label: 'Payments' }}
        actions={
          <>
            <MarkManualPaidButton
              paymentId={payment.id}
              disabled={
                payment.status === 'PAID' || payment.status === 'REFUNDED'
              }
            />
            <RefundPaymentButton
              paymentId={payment.id}
              retry={payment.status === 'PENDING_REFUND'}
              disabled={
                !['PAID', 'PENDING_REFUND', 'REFUND_FAILED'].includes(
                  payment.status,
                )
              }
            />
            <CancelRegistrationButton
              tournamentId={payment.tournamentId}
              userId={payment.userId}
              disabled={payment.registrationStatus !== 'ACTIVE'}
            />
          </>
        }
      />

      <Card className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <DataRow label="Tournament" value={payment.tournamentName} />
        <DataRow label="Competitor" value={payment.username} />
        <DataRow
          label="Amount"
          value={formatMinor(payment.amountMinor, payment.currency)}
        />
        <DataRow
          label="Status"
          value={<StatusBadge status={payment.status} />}
        />
        <DataRow label="Provider" value={payment.provider} />
        <DataRow
          label="Provider payment"
          value={payment.providerPaymentId ?? 'None'}
        />
        <DataRow
          label="Signature verified"
          value={payment.signatureVerified ? 'Yes' : 'No'}
        />
        <DataRow
          label="Registration"
          value={payment.registrationStatus ?? 'None'}
        />
        <DataRow label="Paid" value={formatIst(payment.paidAt)} />
        <DataRow label="Refunded" value={formatIst(payment.refundedAt)} />
        <DataRow
          label="Provider refund"
          value={payment.providerRefundId ?? 'None'}
        />
        <DataRow
          label="Refund intent"
          value={payment.refundIntentId ?? 'None'}
        />
        <DataRow
          label="Refund pending"
          value={formatIst(payment.refundIntentAt)}
        />
        <DataRow
          label="Refund failed"
          value={formatIst(payment.refundFailedAt)}
        />
        <DataRow
          label="Refund required"
          value={formatIst(payment.refundRequiredAt)}
        />
        <DataRow label="Created" value={formatIst(payment.createdAt)} />
      </Card>

      {payment.refundReason ? (
        <p className="border-border bg-muted/40 rounded-md border px-3 py-2 text-sm">
          {payment.refundReason}
        </p>
      ) : null}

      <section className="space-y-3">
        <SectionTitle>Payment history</SectionTitle>
        {audit.length === 0 ? (
          <EmptyState
            title="No audit rows"
            hint="Payment state changes and privileged actions appear here."
          />
        ) : (
          <TableShell>
            <THead>
              <TH>Action</TH>
              <TH>Before</TH>
              <TH>After</TH>
              <TH>When</TH>
            </THead>
            <TBody>
              {audit.map((row) => (
                <TR key={`${row.action}-${row.createdAt.toISOString()}`}>
                  <TD>{row.action}</TD>
                  <TD className="max-w-xs">
                    <JsonSummary value={row.before} />
                  </TD>
                  <TD className="max-w-xs">
                    <JsonSummary value={row.after} />
                  </TD>
                  <TD>
                    <span className="text-xs">{formatIst(row.createdAt)}</span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Webhook history</SectionTitle>
        {webhooks.length === 0 ? (
          <EmptyState
            title="No webhook rows"
            hint="Webhook receipts for this payment appear here."
          />
        ) : (
          <TableShell>
            <THead>
              <TH>Event</TH>
              <TH>Signature</TH>
              <TH>Outcome</TH>
              <TH>Error</TH>
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
                  </TD>
                  <TD>{event.signatureVerified ? 'Verified' : 'Rejected'}</TD>
                  <TD>{event.outcome}</TD>
                  <TD>{event.errorMessage ?? 'None'}</TD>
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

function JsonSummary({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground text-xs">None</span>;
  }
  return (
    <code className="text-muted-foreground block truncate text-xs">
      {JSON.stringify(value)}
    </code>
  );
}
