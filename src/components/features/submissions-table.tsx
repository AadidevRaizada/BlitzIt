import Link from 'next/link';
import type { SubmissionView } from '@/server/modules/submission';
import {
  JobStatusBadge,
  SubmissionStatusBadge,
} from '@/components/features/submission-status-badge';
import {
  EmptyState,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableShell,
} from '@/components/ui/table';
import { formatIst } from '@/components/ui/page-header';
import { SubmissionRowActions } from './submission-row-actions';

/**
 * Shared submissions table (E5), used by the global admin list and by the
 * tournament detail tab.
 *
 * One implementation so the two surfaces can never drift on what an operator is
 * allowed to do. All business rules — who may retry, whether an entry can be
 * disqualified — live in the E4 module; this only renders and calls.
 */
export function SubmissionsTable({
  submissions,
  competitorByUserId,
  emptyTitle = 'No submissions',
  emptyHint,
}: {
  submissions: SubmissionView[];
  /** Optional id → display name map, so the table can show who submitted. */
  competitorByUserId?: Map<string, string>;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  if (submissions.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <TableShell>
      <THead>
        <TH>Competitor</TH>
        <TH>Entry</TH>
        <TH>State</TH>
        <TH>Job</TH>
        <TH numeric>Score</TH>
        <TH>Submitted</TH>
        <TH numeric>Actions</TH>
      </THead>
      <TBody>
        {submissions.map((submission) => (
          <TR key={submission.id}>
            <TD>
              <Link
                href={`/admin/evaluations/${submission.id}`}
                className="focus-visible:ring-ring rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                {competitorByUserId?.get(submission.userId) ??
                  submission.id.slice(0, 8)}
              </Link>
              <span className="text-muted-foreground block text-xs">
                v{submission.version} · {submission.category}
              </span>
            </TD>
            <TD>
              <a
                href={submission.repoUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-primary block max-w-[14rem] truncate text-xs hover:underline"
              >
                {submission.repoUrl.replace('https://github.com/', '')}
              </a>
              <a
                href={submission.deploymentUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-muted-foreground block max-w-[14rem] truncate text-xs hover:underline"
              >
                {submission.deploymentUrl}
              </a>
            </TD>
            <TD>
              <SubmissionStatusBadge state={submission.state} />
            </TD>
            <TD>
              {submission.job ? (
                <>
                  <JobStatusBadge state={submission.job.state} />
                  <span className="text-muted-foreground block text-xs tabular-nums">
                    {submission.job.attempts}/{submission.job.maxAttempts}
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground text-xs">—</span>
              )}
            </TD>
            <TD numeric>
              {submission.evaluation
                ? submission.evaluation.overallScore.toFixed(2)
                : '—'}
            </TD>
            <TD>
              <span className="text-xs">
                {formatIst(submission.submittedAt)}
              </span>
              {submission.sealedAt ? (
                <span className="text-muted-foreground block text-xs">
                  sealed
                </span>
              ) : null}
            </TD>
            <TD numeric>
              <SubmissionRowActions
                submissionId={submission.id}
                state={submission.state}
              />
            </TD>
          </TR>
        ))}
      </TBody>
    </TableShell>
  );
}
