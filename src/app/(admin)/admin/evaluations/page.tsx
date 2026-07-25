import { requireAdmin } from '@/server/modules/auth';
import { listAllSubmissions } from '@/server/modules/submission';
import { PageHeader } from '@/components/ui/page-header';
import { SubmissionsTable } from '@/components/features/submissions-table';

export const metadata = { title: 'Evaluations — Blitz It Admin' };
export const dynamic = 'force-dynamic';

export default async function EvaluationsPage() {
  const admin = await requireAdmin('/admin/evaluations');
  const submissions = await listAllSubmissions(admin, { take: 200 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evaluations"
        description="Read-only score and evidence inspection. Retry and disqualification stay in the submission actions."
      />
      <SubmissionsTable
        submissions={submissions}
        emptyTitle="No evaluations yet"
        emptyHint="Evaluation rows appear after the runner processes queued submissions."
      />
    </div>
  );
}
