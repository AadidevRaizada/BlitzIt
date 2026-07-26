import Link from 'next/link';
import { requireUser } from '@/server/modules/auth';
import { listMyResults } from '@/server/modules/tournament';
import { listUserBadges } from '@/server/modules/hall-of-fame';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/table';

export const metadata = { title: 'My results - The Circuit' };
export const dynamic = 'force-dynamic';

/**
 * Screen [13] — my results and history (E8.2).
 *
 * A competitor's own record: every tournament they entered, where they
 * finished, and every score with the evidence behind it. D28 shapes what is
 * here — they own their code, and this is the surface that proves what was
 * measured against it rather than asking them to take a number on trust.
 */
export default async function ResultsPage() {
  const user = await requireUser('/results');
  const [results, badges] = await Promise.all([
    listMyResults(user.id),
    listUserBadges(user.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="My results"
        description="Every tournament you have entered, and what was measured."
      />

      {badges.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase">
            Badges
          </h2>
          <ul className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <li key={`${badge.slug}-${badge.tournamentId ?? 'global'}`}>
                <Badge tone={badge.slug === 'champion' ? 'success' : 'brand'}>
                  {badge.name}
                  {badge.tournamentName ? ` · ${badge.tournamentName}` : ''}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {results.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          hint="Your first tournament will appear once you register."
        />
      ) : (
        <ul className="space-y-4">
          {results.map((result) => (
            <li
              key={result.tournamentId}
              className="border-border bg-card rounded-lg border p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="font-semibold">
                    <Link
                      href={`/bracket/${result.tournamentId}`}
                      className="hover:text-primary hover:underline"
                    >
                      {result.tournamentName}
                    </Link>
                  </h2>
                  <p className="text-muted-foreground text-xs">
                    {result.status.replace(/_/g, ' ').toLowerCase()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {result.placement ? (
                    <Badge tone={result.placement === 1 ? 'success' : 'brand'}>
                      {result.placement === 1
                        ? 'Champion'
                        : `Finished #${result.placement}`}
                    </Badge>
                  ) : null}
                  {result.eliminatedAtStage ? (
                    <Badge tone="neutral">
                      out · {result.eliminatedAtStage.replace(/_/g, ' ')}
                    </Badge>
                  ) : null}
                  {result.seed ? (
                    <Badge tone="outline">seed #{result.seed}</Badge>
                  ) : null}
                </div>
              </div>

              {result.submissions.length > 0 ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-border border-b text-left text-xs">
                        <th scope="col" className="py-2 pr-3 font-medium">
                          Round
                        </th>
                        <th scope="col" className="py-2 pr-3 font-medium">
                          Challenge
                        </th>
                        <th
                          scope="col"
                          className="py-2 pr-3 text-right font-medium"
                        >
                          Functional
                        </th>
                        <th
                          scope="col"
                          className="py-2 pr-3 text-right font-medium"
                        >
                          Tests
                        </th>
                        <th
                          scope="col"
                          className="py-2 pr-3 text-right font-medium"
                        >
                          Overall
                        </th>
                        <th scope="col" className="py-2 font-medium">
                          Profile
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.submissions.map((submission) => (
                        <tr
                          key={submission.submissionId}
                          className="border-border/60 border-b last:border-0"
                        >
                          <td className="py-2 pr-3">
                            {submission.stage.replace(/_/g, ' ')}
                          </td>
                          <td className="text-muted-foreground py-2 pr-3">
                            {submission.problemTitle ?? '—'}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {submission.functionalScore?.toFixed(1) ?? '—'}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">
                            {submission.testsTotal
                              ? `${submission.testsPassed}/${submission.testsTotal}`
                              : '—'}
                          </td>
                          <td className="py-2 pr-3 text-right font-medium tabular-nums">
                            {submission.overallScore?.toFixed(1) ?? '—'}
                          </td>
                          <td className="text-muted-foreground py-2">
                            <Link
                              href={`/submissions/${submission.submissionId}`}
                              className="text-primary hover:underline"
                            >
                              {submission.profileName ?? 'evidence'} →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted-foreground mt-3 text-sm">
                  No scored entries in this tournament.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
