import { INSUFFICIENT_REGISTRATIONS } from '@/server/modules/tournament/lifecycle';
import type { LifecycleDiagnostics } from '@/server/modules/tournament/schedule-status';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { formatIst } from '@/components/ui/page-header';

/**
 * "Why is nothing happening?" — answered on screen (D33, D34).
 *
 * The reconciler is allowed to stop short: a guard refusing is a normal outcome
 * and the sweep retries. But that refusal lived only in the job table, so an
 * operator watching a motionless tournament had no information at all and no
 * way to get any short of running psql against production. This shows the whole
 * story: position, plan, what is being attempted, what refused, when it will be
 * tried again, and what to do.
 *
 * A cancelled tournament gets the same treatment for its aftermath: why it was
 * cancelled, whether the refunds went through, and when it disappears from the
 * public site. All of it read from the work's own records — this component never
 * asserts that something happened, it reports what did.
 */
export function LifecycleStatus({
  diagnostics,
}: {
  diagnostics: LifecycleDiagnostics;
}) {
  const {
    status,
    targetStatus,
    drifted,
    pendingPath,
    nextStep,
    blockedReason,
    attempts,
    retryEveryMs,
    recommendation,
    cancellation,
  } = diagnostics;

  const blocked = blockedReason !== null;
  const retryMinutes = Math.round(retryEveryMs / 60_000);

  return (
    <Card
      emphasis={
        cancellation || blocked ? 'live' : drifted ? 'primary' : 'default'
      }
    >
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow tone="muted">Lifecycle</Eyebrow>
          {cancellation ? (
            <Badge tone="danger">Cancelled</Badge>
          ) : blocked ? (
            <Badge tone="danger">Blocked</Badge>
          ) : drifted ? (
            <Badge tone="active">Catching up</Badge>
          ) : (
            <Badge tone="success">On schedule</Badge>
          )}
        </div>

        <dl className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-0.5">
            <dt className="text-muted-foreground text-xs">Currently</dt>
            <dd className="font-display text-lg font-bold">
              {status.replace(/_/g, ' ')}
            </dd>
          </div>
          <div className="space-y-0.5">
            <dt className="text-muted-foreground text-xs">
              {drifted ? 'Schedule says it should be' : 'Next milestone'}
            </dt>
            <dd className="font-display text-lg font-bold">
              {drifted
                ? targetStatus.replace(/_/g, ' ')
                : (nextStep?.label ?? 'Nothing scheduled')}
            </dd>
            {!drifted && nextStep?.dueAt ? (
              <p className="text-muted-foreground text-xs tabular-nums">
                {formatIst(nextStep.dueAt)}
              </p>
            ) : null}
          </div>
        </dl>

        {pendingPath.length > 0 ? (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">
              Reconciliation will apply, in order:
            </p>
            <p className="font-mono text-xs">{pendingPath.join(' → ')}</p>
          </div>
        ) : null}

        {cancellation ? (
          <div className="border-destructive/40 bg-destructive/5 space-y-3 rounded-md border p-3">
            <div className="space-y-1">
              <p className="text-xs font-medium">
                {cancellation.reason === INSUFFICIENT_REGISTRATIONS
                  ? 'Cancelled automatically — not enough competitors'
                  : 'Cancelled'}
              </p>
              {cancellation.reason &&
              cancellation.reason !== INSUFFICIENT_REGISTRATIONS ? (
                <p className="text-sm">{cancellation.reason}</p>
              ) : null}
              {cancellation.cancelledAt ? (
                <p className="text-muted-foreground text-xs tabular-nums">
                  {formatIst(cancellation.cancelledAt)}
                </p>
              ) : null}
            </div>

            {/* Refund state, read from the payment rows rather than assumed. A
                free tournament reports nothing here instead of "0 refunded". */}
            {cancellation.refunds ? (
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">Entry fees</p>
                <p className="text-sm tabular-nums">
                  {cancellation.refunds.refunded} refunded
                  {cancellation.refunds.inFlight > 0
                    ? ` · ${cancellation.refunds.inFlight} in flight`
                    : ''}
                  {cancellation.refunds.awaitingRefund > 0
                    ? ` · ${cancellation.refunds.awaitingRefund} awaiting`
                    : ''}
                  {cancellation.refunds.failed > 0
                    ? ` · ${cancellation.refunds.failed} failed`
                    : ''}
                </p>
              </div>
            ) : null}

            {cancellation.cleanupError ? (
              <div className="space-y-1">
                <p className="text-xs font-medium">
                  Cancellation follow-up has not finished:
                </p>
                <p className="text-sm">{cancellation.cleanupError}</p>
              </div>
            ) : null}

            <p className="text-muted-foreground text-xs">
              {cancellation.archivedAt
                ? `Archived ${formatIst(cancellation.archivedAt)}.`
                : cancellation.cleanup !== 'DONE'
                  ? 'Stays listed until notifications and refunds have completed.'
                  : cancellation.archiveAt
                    ? `Archives ${formatIst(cancellation.archiveAt)}.`
                    : null}
            </p>
          </div>
        ) : blocked ? (
          <div className="border-destructive/40 bg-destructive/5 space-y-2 rounded-md border p-3">
            <div className="space-y-1">
              <p className="text-xs font-medium">
                The last attempt was refused
                {attempts > 0 ? ` (attempt ${attempts})` : ''}:
              </p>
              {/* Verbatim from the guard. Paraphrasing it here would create a
                  second wording to keep in step with the engine. */}
              <p className="text-sm">{blockedReason}</p>
            </div>
            <p className="text-muted-foreground text-xs">
              This retries automatically about every {retryMinutes} minute
              {retryMinutes === 1 ? '' : 's'}. Nothing is lost — the tournament
              simply waits.
            </p>
          </div>
        ) : null}

        {recommendation && !cancellation ? (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">What to do</p>
            <p className="text-sm">{recommendation}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
