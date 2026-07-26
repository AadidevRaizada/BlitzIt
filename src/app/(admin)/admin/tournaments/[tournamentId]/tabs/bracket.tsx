import Link from 'next/link';
import {
  listBracketRounds,
  listDeadlockedMatches,
  type TournamentSummary,
} from '@/server/modules/tournament';
import { listAssignableProblems } from '@/server/modules/problem';
import { requireAdminOrThrow } from '@/server/modules/auth';
import { BracketTree } from '@/components/features/bracket-tree';
import { SuddenDeathControl } from './sudden-death-control';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, StatCard } from '@/components/ui/card';
import { SectionTitle } from '@/components/ui/page-header';
import { TableShell, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { buttonVariants } from '@/components/ui/button';

/**
 * Bracket status tab (E5).
 *
 * This is an operator table, not the public bracket visualization. The E3
 * bracket engine owns topology and advancement; the admin surface only shows
 * persisted match state and links to submissions/evaluations for inspection.
 */
export async function BracketTab({ summary }: { summary: TournamentSummary }) {
  const admin = await requireAdminOrThrow();
  const [rounds, deadlocked, problems] = await Promise.all([
    listBracketRounds(summary.id),
    listDeadlockedMatches(summary.id),
    listAssignableProblems(admin),
  ]);

  // Deadlocked matches carry competitor ids; the bracket read model already
  // resolved every name, so reuse that rather than querying users again.
  const nameById = new Map(
    rounds
      .flatMap((round) => round.matches)
      .flatMap((match) => [
        [match.competitorAId, match.competitorA] as const,
        [match.competitorBId, match.competitorB] as const,
      ])
      .filter(
        (entry): entry is readonly [string, string] =>
          typeof entry[0] === 'string' && typeof entry[1] === 'string',
      ),
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Matches" value={summary.matches} />
        <StatCard label="Decided" value={summary.matchesDecided} />
        <StatCard
          label="Open"
          value={Math.max(0, summary.matches - summary.matchesDecided)}
        />
        <StatCard label="Bracket size" value={summary.bracketSize ?? 'Auto'} />
      </div>

      {deadlocked.length > 0 ? (
        <section className="space-y-3">
          <SectionTitle>
            Deadlocked matches — sudden death required
          </SectionTitle>
          <Card>
            <CardContent className="space-y-3 pt-4">
              <p className="text-muted-foreground text-sm">
                The win rule and every D5 tie-break failed to separate these
                competitors. D14 calls for a <strong>new</strong> 10-minute
                challenge decided on Functional score alone. All ties at a stage
                share one sudden-death round, so they face the same challenge.
              </p>
              <ul className="divide-border divide-y">
                {deadlocked.map((match) => (
                  <li
                    key={match.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2"
                  >
                    <div className="text-sm">
                      <span className="font-medium">
                        {match.round.stage.replace('_', ' ')} · #
                        {match.bracketPosition + 1}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {nameById.get(match.competitorAId ?? '') ?? '—'} vs{' '}
                        {nameById.get(match.competitorBId ?? '') ?? '—'}
                      </span>
                    </div>
                    <SuddenDeathControl
                      matchId={match.id}
                      tournamentId={summary.id}
                      problems={problems.map((problem) => ({
                        id: problem.id,
                        title: problem.title,
                        category: problem.category,
                      }))}
                      excludeProblemId={match.round.problemId}
                    />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionTitle>Bracket</SectionTitle>
        <BracketTree rounds={rounds} />
      </section>

      <section className="space-y-3">
        <SectionTitle>Rounds</SectionTitle>
        {rounds.length === 0 ? (
          <Card>
            <CardContent className="text-muted-foreground py-8 text-sm">
              No bracket has been generated yet.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {rounds.map((round) => (
              <Card key={round.id}>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">{round.stage}</h3>
                      <p className="text-muted-foreground text-sm">
                        {round.problem
                          ? `${round.problem.title} · ${round.problem.category}`
                          : 'No problem assigned'}
                      </p>
                    </div>
                    <Badge
                      tone={
                        round.status === 'COMPLETED' ? 'success' : 'neutral'
                      }
                    >
                      {round.status}
                    </Badge>
                  </div>

                  <TableShell>
                    <THead>
                      <TH>Match</TH>
                      <TH>Competitors</TH>
                      <TH>Status</TH>
                      <TH>Winner</TH>
                      <TH numeric>Evidence</TH>
                    </THead>
                    <TBody>
                      {round.matches.map((match) => (
                        <TR key={match.id}>
                          <TD className="font-mono text-xs">
                            #{match.bracketPosition}
                          </TD>
                          <TD>
                            <span>{match.competitorA ?? 'TBD'}</span>
                            <span className="text-muted-foreground mx-2">
                              vs
                            </span>
                            <span>{match.competitorB ?? 'TBD'}</span>
                          </TD>
                          <TD>
                            <Badge
                              tone={
                                match.status === 'DECIDED'
                                  ? 'success'
                                  : 'neutral'
                              }
                            >
                              {match.status}
                            </Badge>
                            {match.tieUnresolved ? (
                              <Badge tone="warning" className="ml-2">
                                Tie
                              </Badge>
                            ) : null}
                          </TD>
                          <TD>{match.winner ?? '-'}</TD>
                          <TD numeric>
                            {match.submissionAId ? (
                              <Link
                                href={`/admin/evaluations/${match.submissionAId}`}
                                className={buttonVariants({
                                  variant: 'ghost',
                                  size: 'sm',
                                })}
                              >
                                A
                              </Link>
                            ) : null}
                            {match.submissionBId ? (
                              <Link
                                href={`/admin/evaluations/${match.submissionBId}`}
                                className={buttonVariants({
                                  variant: 'ghost',
                                  size: 'sm',
                                })}
                              >
                                B
                              </Link>
                            ) : null}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </TableShell>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
