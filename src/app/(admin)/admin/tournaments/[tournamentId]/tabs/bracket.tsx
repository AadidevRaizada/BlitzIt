import Link from 'next/link';
import {
  listBracketRounds,
  type TournamentSummary,
} from '@/server/modules/tournament';
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
  const rounds = await listBracketRounds(summary.id);

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
