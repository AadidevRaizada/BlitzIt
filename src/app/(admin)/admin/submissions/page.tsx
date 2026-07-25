import { requireAdmin } from '@/server/modules/auth';
import { listAllSubmissions } from '@/server/modules/submission';
import { listRegistrations } from '@/server/modules/tournament';
import { PageHeader } from '@/components/ui/page-header';
import { SubmissionsTable } from '@/components/features/submissions-table';

export const metadata = { title: 'Submissions — Blitz It Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tournamentId?: string }>;
}) {
  const admin = await requireAdmin('/admin/submissions');
  const { tournamentId } = await searchParams;

  const [submissions, registrations] = await Promise.all([
    listAllSubmissions(admin, { tournamentId, take: 200 }),
    tournamentId ? listRegistrations(tournamentId) : Promise.resolve([]),
  ]);
  const competitorByUserId = new Map(
    registrations.map((registration) => [
      registration.userId,
      registration.username,
    ]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Submissions"
        description={`${submissions.length} entries${
          tournamentId ? ' in this tournament' : ' across all tournaments'
        }.`}
      />
      <SubmissionsTable
        submissions={submissions}
        competitorByUserId={competitorByUserId}
        emptyTitle="No submissions"
        emptyHint="Entries appear here when competitors submit during an open round."
      />
    </div>
  );
}
