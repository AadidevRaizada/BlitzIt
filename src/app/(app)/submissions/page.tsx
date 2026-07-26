import Link from 'next/link';
import { requireUser } from '@/server/modules/auth';
import { listMySubmissions } from '@/server/modules/submission';
import { SubmissionStatusBadge } from '@/components/features/submission-status-badge';

export const metadata = { title: 'My submissions - The Circuit' };

/**
 * Screen [13b] — My Submissions (E4).
 *
 * RSC read straight through the module. Dense and quiet per the design system:
 * the application surface optimises for scanning, not for decoration.
 */
export default async function SubmissionsPage() {
  const user = await requireUser('/submissions');
  const submissions = await listMySubmissions(user.id);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My submissions</h1>
        <p className="text-muted-foreground text-sm">
          Every entry you have made, newest first. Scores appear once the
          evaluator has finished.
        </p>
      </div>

      {submissions.length === 0 ? (
        <div className="border-border rounded-md border border-dashed p-8 text-center">
          <p className="font-medium">No submissions yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            When a round opens, you will find the problem and the submission
            form in the arena.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {submissions.map((submission) => (
            <li key={submission.id}>
              <Link
                href={`/submissions/${submission.id}`}
                className="border-border hover:bg-accent/40 focus-visible:ring-ring block rounded-md border p-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <SubmissionStatusBadge state={submission.state} />
                    <span className="text-muted-foreground text-xs">
                      {submission.category} · v{submission.version}
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
                  {submission.sealedAt ? ' · sealed' : null}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
