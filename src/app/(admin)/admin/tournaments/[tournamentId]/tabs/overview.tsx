import type { TournamentSummary } from '@/server/modules/tournament';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  StatCard,
} from '@/components/ui/card';
import {
  DataRow,
  SectionTitle,
  formatIst,
  formatUtc,
} from '@/components/ui/page-header';
import { LifecycleControls } from '@/components/features/lifecycle-controls';

/**
 * Overview tab — where the tournament is, and what the operator can do next.
 *
 * The lifecycle controls render exactly the transitions the state machine
 * permits; the list comes from the server so the UI can never offer an illegal
 * move.
 */
export function OverviewTab({ summary }: { summary: TournamentSummary }) {
  const terminal =
    summary.status === 'COMPLETED' || summary.status === 'CANCELLED';

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle>Controls</SectionTitle>
        {summary.availableTransitions.length === 0 && terminal ? (
          <p className="text-muted-foreground text-sm">
            This tournament is {summary.status.toLowerCase()}. Nothing further
            to drive.
          </p>
        ) : (
          <Card>
            <CardContent className="pt-4">
              <LifecycleControls
                tournamentId={summary.id}
                transitions={summary.availableTransitions}
                canCancel={!terminal}
              />
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>At a glance</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Registered"
            value={summary.registrations}
            hint={`counter reads ${summary.participantCount}`}
          />
          <StatCard
            label="Submissions"
            value={summary.submissions}
            hint={`${summary.evaluated} scored`}
          />
          <StatCard
            label="Awaiting evaluation"
            value={summary.pendingEvaluation}
            hint={
              summary.failedEvaluation > 0
                ? `${summary.failedEvaluation} failed`
                : 'none failed'
            }
          />
          <StatCard
            label="Bracket"
            value={
              summary.matches === 0
                ? '—'
                : `${summary.matchesDecided}/${summary.matches}`
            }
            hint={
              summary.bracketSize
                ? `${summary.bracketSize}-competitor draw`
                : 'not sized yet'
            }
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <DataRow label="Lifecycle state" value={summary.state ?? '—'} />
              <DataRow
                label="Bracket size"
                value={summary.bracketSize ?? 'Automatic'}
              />
              <DataRow
                label="Third place"
                value={summary.thirdPlaceEnabled ? 'Enabled' : 'Disabled'}
              />
              <DataRow label="Visibility" value={summary.visibility} />
              <DataRow
                label="Created"
                value={formatIst(summary.createdAt)}
                className="col-span-2"
              />
              {summary.description ? (
                <DataRow
                  label="Description"
                  value={summary.description}
                  className="col-span-2"
                />
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Schedule</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              <ScheduleRow
                label="Registration opens"
                value={summary.registrationOpensAt}
              />
              <ScheduleRow
                label="Registration closes"
                value={summary.registrationClosesAt}
              />
              <ScheduleRow
                label="Simulation opens"
                value={summary.simulationOpensAt}
              />
              <ScheduleRow
                label="Knockout starts"
                value={summary.liveStartsAt}
              />
              <ScheduleRow label="Completed" value={summary.completedAt} />
            </dl>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

/** Both zones: the operator schedules in UTC (D8) but thinks in IST. */
function ScheduleRow({ label, value }: { label: string; value: Date | null }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm font-medium">{formatIst(value)}</dd>
      <dd className="text-muted-foreground font-mono text-xs">
        {formatUtc(value)}
      </dd>
    </div>
  );
}
