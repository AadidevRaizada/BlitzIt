import Link from 'next/link';
import type { TournamentSummary } from '@/server/modules/tournament';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TournamentStatusBadge } from '@/components/features/tournament-status-badge';
import { LifecycleControls } from '@/components/features/lifecycle-controls';
import { formatIst } from '@/components/ui/page-header';

/**
 * Tournament card (design-system §8) — status pill, schedule, and the counts an
 * operator scans for: who is registered, how far evaluation has got, how much
 * of the bracket is decided.
 *
 * Quick actions are the *same* `LifecycleControls` the detail page uses, in
 * compact mode. One implementation, so the dashboard can never offer a
 * transition the detail page would refuse.
 */
export function TournamentCard({
  tournament,
}: {
  tournament: TournamentSummary;
}) {
  const evaluationTotal = tournament.submissions;
  const evaluationDone = tournament.evaluated;
  const evaluationPct =
    evaluationTotal === 0
      ? 0
      : Math.round((evaluationDone / evaluationTotal) * 100);

  return (
    <Card interactive className="flex flex-col">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <Link
              href={`/admin/tournaments/${tournament.id}`}
              className="focus-visible:ring-ring block truncate rounded-sm font-semibold hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              {tournament.name}
            </Link>
            <p className="text-muted-foreground truncate font-mono text-xs">
              {tournament.slug}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <TournamentStatusBadge
              status={tournament.status}
              stage={tournament.currentStage}
            />
            {tournament.visibility === 'UNLISTED' ? (
              <Badge tone="warning">Unlisted</Badge>
            ) : null}
            {tournament.archivedAt ? (
              <Badge tone="neutral">Archived</Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-3">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <Metric label="Registered" value={tournament.registrations} />
          <Metric label="Submissions" value={tournament.submissions} />
          <Metric
            label="Bracket"
            value={
              tournament.matches === 0
                ? '—'
                : `${tournament.matchesDecided}/${tournament.matches}`
            }
          />
        </dl>

        {evaluationTotal > 0 ? (
          <div className="space-y-1">
            <div className="text-muted-foreground flex justify-between text-xs">
              <span>Evaluation</span>
              <span className="tabular-nums">
                {evaluationDone}/{evaluationTotal}
                {tournament.failedEvaluation > 0
                  ? ` · ${tournament.failedEvaluation} failed`
                  : ''}
              </span>
            </div>
            <div
              className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={evaluationPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Evaluation progress"
            >
              <div
                className="bg-primary h-full rounded-full"
                style={{ width: `${evaluationPct}%` }}
              />
            </div>
          </div>
        ) : null}

        <p className="text-muted-foreground text-xs">
          {tournament.liveStartsAt
            ? `Live ${formatIst(tournament.liveStartsAt)}`
            : tournament.registrationOpensAt
              ? `Registration ${formatIst(tournament.registrationOpensAt)}`
              : 'No schedule set'}
        </p>

        {tournament.availableTransitions.length > 0 &&
        !tournament.archivedAt ? (
          <LifecycleControls
            tournamentId={tournament.id}
            transitions={tournament.availableTransitions.slice(0, 1)}
            compact
            canCancel={false}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
