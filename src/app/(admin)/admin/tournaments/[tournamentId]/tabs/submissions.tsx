import Link from 'next/link';
import { requireAdminOrThrow } from '@/server/modules/auth';
import { listAllSubmissions } from '@/server/modules/submission';
import {
  listRegistrations,
  type TournamentSummary,
} from '@/server/modules/tournament';
import { StatCard } from '@/components/ui/card';
import { SectionTitle } from '@/components/ui/page-header';
import { buttonVariants } from '@/components/ui/button';
import { SubmissionsTable } from '@/components/features/submissions-table';

/**
 * Submissions tab (E5) — the same table the global admin list uses, scoped to
 * this tournament, with the evaluation progress an operator watches during a
 * round.
 */
export async function SubmissionsTab({
  summary,
}: {
  summary: TournamentSummary;
}) {
  const admin = await requireAdminOrThrow();
  const [submissions, registrations] = await Promise.all([
    listAllSubmissions(admin, { tournamentId: summary.id, take: 200 }),
    listRegistrations(summary.id),
  ]);

  const nameByUserId = new Map(
    registrations.map((r) => [r.userId, r.username]),
  );

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle
          actions={
            <Link
              href={`/admin/submissions?tournamentId=${summary.id}`}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              Open in submissions
            </Link>
          }
        >
          Evaluation progress
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total" value={summary.submissions} />
          <StatCard label="Scored" value={summary.evaluated} />
          <StatCard label="In flight" value={summary.pendingEvaluation} />
          <StatCard
            label="Failed"
            value={
              <span
                className={
                  summary.failedEvaluation > 0 ? 'text-destructive' : undefined
                }
              >
                {summary.failedEvaluation}
              </span>
            }
            hint={
              summary.failedEvaluation > 0
                ? 'Retry from the table below'
                : undefined
            }
          />
        </div>
      </section>

      <SubmissionsTable
        submissions={submissions}
        competitorByUserId={nameByUserId}
        emptyTitle="No submissions yet"
        emptyHint="Entries appear as competitors submit during an open round."
      />
    </div>
  );
}
