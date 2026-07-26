import Link from 'next/link';
import { requireUser } from '@/server/modules/auth';
import { listMySubmissions } from '@/server/modules/submission';
import { SubmissionStatusBadge } from '@/components/features/submission-status-badge';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/table';

export const metadata = { title: 'My submissions - The Circuit' };

/**
 * Screen [13b] - My Submissions (E4).
 *
 * RSC read straight through the module. Dense and quiet per the design system:
 * the application surface optimises for scanning, not for decoration.
 */
export default async function SubmissionsPage() {
  const user = await requireUser('/submissions');
  const submissions = await listMySubmissions(user.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="My submissions"
        description="Every entry you have made, newest first. Scores appear once the evaluator has finished."
      />

      {submissions.length === 0 ? (
        <EmptyState
          title="No submissions yet"
          hint="When a round opens, you will find the problem and the submission form in the arena."
        />
      ) : (
        <ul className="space-y-2">
          {submissions.map((submission) => (
            <li key={submission.id}>
              <Card interactive>
                <Link
                  href={`/submissions/${submission.id}`}
                  className="focus-visible:ring-ring block rounded-lg p-4 focus-visible:ring-2 focus-visible:outline-none"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <SubmissionStatusBadge state={submission.state} />
                      <span className="text-muted-foreground text-xs">
                        {submission.category} / v{submission.version}
                      </span>
                    </div>
                    {submission.evaluation ? (
                      <span className="text-sm font-semibold tabular-nums">
                        {submission.evaluation.overallScore.toFixed(2)}
                        <span className="text-muted-foreground font-normal">
                          {' '}
                          / 100
                        </span>
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-2 truncate text-sm">
                    {submission.deploymentUrl}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Submitted{' '}
                    <time dateTime={submission.submittedAt.toISOString()}>
                      {submission.submittedAt
                        .toISOString()
                        .replace('T', ' ')
                        .slice(0, 16)}{' '}
                      UTC
                    </time>
                    {submission.sealedAt ? ' / sealed' : null}
                  </p>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
