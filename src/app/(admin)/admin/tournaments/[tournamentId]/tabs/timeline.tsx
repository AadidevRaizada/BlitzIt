import {
  listRounds,
  type TournamentSummary,
} from '@/server/modules/tournament';
import { listAssignableProblems } from '@/server/modules/problem';
import { requireAdminOrThrow } from '@/server/modules/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import {
  EmptyState,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableShell,
} from '@/components/ui/table';
import { SectionTitle, formatIst } from '@/components/ui/page-header';
import { ScheduleForm } from './schedule-form';
import { AssignProblemControl } from './assign-problem';

const ROUND_TONE: Record<string, BadgeTone> = {
  PENDING: 'neutral',
  OPEN: 'success',
  JUDGING: 'brand',
  COMPLETED: 'outline',
};

/**
 * Timeline tab — the schedule an operator edits, and the rounds it produces.
 *
 * Rounds are created by the lifecycle (simulation rounds at START_SIMULATION,
 * knockout rounds at bracket generation), so this tab reads them rather than
 * offering a "create round" button that would duplicate E3's logic.
 */
export async function TimelineTab({ summary }: { summary: TournamentSummary }) {
  const admin = await requireAdminOrThrow();
  const [rounds, problems] = await Promise.all([
    listRounds(summary.id),
    listAssignableProblems(admin),
  ]);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle>Schedule</SectionTitle>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Times are entered and shown in IST; stored in UTC (D8)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScheduleForm
              tournamentId={summary.id}
              initial={{
                registrationOpensAt: summary.registrationOpensAt,
                registrationClosesAt: summary.registrationClosesAt,
                simulationOpensAt: summary.simulationOpensAt,
                simulationClosesAt: summary.simulationClosesAt,
                liveStartsAt: summary.liveStartsAt,
              }}
            />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>Rounds</SectionTitle>
        {rounds.length === 0 ? (
          <EmptyState
            title="No rounds yet"
            hint="Simulation rounds are created when the tournament starts its simulation phase; knockout rounds when the bracket is generated."
          />
        ) : (
          <TableShell>
            <THead>
              <TH>Stage</TH>
              <TH>Status</TH>
              <TH>Problem</TH>
              <TH>Window</TH>
              <TH numeric>Submissions</TH>
              <TH numeric>Matches</TH>
            </THead>
            <TBody>
              {rounds.map((round) => (
                <TR key={round.id}>
                  <TD>
                    <span className="font-medium">
                      {round.stage.replace('_', ' ')}
                    </span>
                    <span className="text-muted-foreground block text-xs">
                      {round.type === 'SIMULATION'
                        ? `Round ${round.sequence}`
                        : 'Knockout'}{' '}
                      · {Math.round(round.durationSeconds / 60)} min
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={ROUND_TONE[round.status] ?? 'neutral'}>
                      {round.status}
                    </Badge>
                  </TD>
                  <TD>
                    {round.problem ? (
                      <>
                        <span className="block truncate">
                          {round.problem.title}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {round.problem.category}
                        </span>
                      </>
                    ) : round.status === 'PENDING' ? (
                      <AssignProblemControl
                        roundId={round.id}
                        tournamentId={summary.id}
                        problems={problems.map((p) => ({
                          id: p.id,
                          title: p.title,
                          category: p.category,
                        }))}
                      />
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        None assigned
                      </span>
                    )}
                  </TD>
                  <TD>
                    <span className="text-xs">
                      {round.opensAt ? formatIst(round.opensAt) : 'Not opened'}
                    </span>
                    {round.deadlineAt ? (
                      <span className="text-muted-foreground block text-xs">
                        until {formatIst(round.deadlineAt)}
                      </span>
                    ) : null}
                  </TD>
                  <TD numeric>{round._count.submissions}</TD>
                  <TD numeric>{round._count.matches || '—'}</TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        )}
      </section>
    </div>
  );
}
