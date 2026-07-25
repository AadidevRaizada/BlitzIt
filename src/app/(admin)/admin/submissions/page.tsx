import Link from 'next/link';
import { requireAdmin } from '@/server/modules/auth';
import { listAllSubmissions } from '@/server/modules/submission';
import {
  JobStatusBadge,
  SubmissionStatusBadge,
} from '@/components/features/submission-status-badge';
import { RetryButton } from './retry-button';

export const metadata = { title: 'Submissions — Blitz It Admin' };

/**
 * Screen [19] — Admin submissions (E4, minimal).
 *
 * Ops view: every entry, its evaluation state, and a retry for the ones that
 * failed. Deliberately a table and nothing more — the richer admin surfaces
 * (filters, evidence viewer, score override) belong to a later epic.
 */
export default async function AdminSubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ tournamentId?: string }>;
}) {
  const admin = await requireAdmin('/admin/submissions');
  const { tournamentId } = await searchParams;

  const submissions = await listAllSubmissions(admin, { tournamentId });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Submissions</h1>
        <p className="text-muted-foreground text-sm">
          {submissions.length} entries
          {tournamentId ? ' in this tournament' : ' across all tournaments'}.
        </p>
      </div>

      {submissions.length === 0 ? (
        <div className="border-border rounded-md border border-dashed p-8 text-center text-sm">
          No submissions yet.
        </div>
      ) : (
        <div className="border-border overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <Th>Submission</Th>
                <Th>State</Th>
                <Th>Job</Th>
                <Th className="text-right">Score</Th>
                <Th>Deployment</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {submissions.map((submission) => (
                <tr key={submission.id} className="hover:bg-accent/30">
                  <Td>
                    <Link
                      href={`/submissions/${submission.id}`}
                      className="text-primary font-medium hover:underline"
                    >
                      {submission.id.slice(0, 8)}
                    </Link>
                    <span className="text-muted-foreground block text-xs">
                      v{submission.version} · {submission.category}
                    </span>
                  </Td>
                  <Td>
                    <SubmissionStatusBadge state={submission.state} />
                  </Td>
                  <Td>
                    {submission.job ? (
                      <>
                        <JobStatusBadge state={submission.job.state} />
                        <span className="text-muted-foreground block text-xs tabular-nums">
                          {submission.job.attempts}/{submission.job.maxAttempts}{' '}
                          attempts
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {submission.evaluation
                      ? submission.evaluation.overallScore.toFixed(2)
                      : '—'}
                  </Td>
                  <Td>
                    <span className="text-muted-foreground block max-w-[16rem] truncate text-xs">
                      {submission.deploymentUrl}
                    </span>
                  </Td>
                  <Td className="text-right">
                    {submission.state === 'DISQUALIFIED' ? (
                      <span className="text-muted-foreground text-xs">—</span>
                    ) : (
                      <RetryButton submissionId={submission.id} />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-xs font-medium tracking-wide uppercase ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}
