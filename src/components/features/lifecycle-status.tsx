import type { LifecycleDiagnostics } from '@/server/modules/tournament/schedule-status';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { formatIst } from '@/components/ui/page-header';

/**
 * "Why is nothing happening?" — answered on screen (D33).
 *
 * The reconciler is allowed to stop short: a guard refusing is a normal outcome
 * and the sweep retries. But that refusal lived only in the job table, so an
 * operator watching a motionless tournament had no information at all and no
 * way to get any short of running psql against production. This shows the whole
 * story: position, plan, what is being attempted, what refused, when it will be
 * tried again, and what to do.
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
  } = diagnostics;

  const blocked = blockedReason !== null;
  const retryMinutes = Math.round(retryEveryMs / 60_000);

  return (
    <Card emphasis={blocked ? 'live' : drifted ? 'primary' : 'default'}>
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow tone="muted">Lifecycle</Eyebrow>
          {blocked ? (
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

        {blocked ? (
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

        {recommendation ? (
          <div className="space-y-1">
            <p className="text-muted-foreground text-xs">What to do</p>
            <p className="text-sm">{recommendation}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
