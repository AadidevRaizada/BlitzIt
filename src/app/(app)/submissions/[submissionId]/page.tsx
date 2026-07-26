import { notFound } from 'next/navigation';
import { requireUser } from '@/server/modules/auth';
import { isAdmin } from '@/server/modules/auth/roles';
import {
  getSubmission,
  getSubmissionHistory,
} from '@/server/modules/submission';
import { AppError } from '@/lib/errors';
import { Card } from '@/components/ui/card';
import { PageHeader, SectionTitle } from '@/components/ui/page-header';
import { EvaluationStatus } from './evaluation-status';

export const metadata = { title: 'Submission - The Circuit' };

/**
 * Screen [9b] - Submission detail, evaluation status and results (E4).
 *
 * Authorisation is the module's (`getSubmission` refuses anyone but the owner
 * or an admin); this page just renders what it is allowed to see.
 */
export default async function SubmissionDetailPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = await params;
  const user = await requireUser(`/submissions/${submissionId}`);

  let submission;
  try {
    submission = await getSubmission(submissionId, user);
  } catch (error) {
    // A competitor must not be able to distinguish "does not exist" from
    // "belongs to someone else" - both are a 404 to them.
    if (
      error instanceof AppError &&
      (error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN')
    ) {
      notFound();
    }
    throw error;
  }

  const history = await getSubmissionHistory(submissionId, user);
  const evaluation = submission.evaluation;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Submission detail"
        back={{ href: '/submissions', label: 'My submissions' }}
        description={
          <>
            {submission.category} / revision {submission.version}
            {submission.sealedAt ? ' / sealed' : null}
            {isAdmin(user) && submission.userId !== user.id
              ? ' / viewing as admin'
              : null}
          </>
        }
      />

      <EvaluationStatus
        submissionId={submission.id}
        initial={{
          state: submission.state,
          job: submission.job,
          evaluation: submission.evaluation,
          version: submission.version,
        }}
      />

      <Card className="space-y-2 p-4">
        <SectionTitle>Entry</SectionTitle>
        <Detail label="Repository" value={submission.repoUrl} link />
        <Detail label="Deployment" value={submission.deploymentUrl} link />
        <Detail label="Commit" value={submission.commitSha ?? '-'} />
        <Detail
          label="Submitted"
          value={`${submission.submittedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`}
        />
      </Card>

      {evaluation ? (
        <Card className="space-y-3 p-4">
          <div className="flex items-baseline justify-between">
            <SectionTitle>Results</SectionTitle>
            <p className="text-2xl font-bold tabular-nums">
              {evaluation.overallScore.toFixed(2)}
              <span className="text-muted-foreground text-sm font-normal">
                {' '}
                / 100
              </span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Score label="Functional" value={evaluation.functionalScore} />
            <Score label="Performance" value={evaluation.performanceScore} />
            <Score
              label="Security"
              value={evaluation.securityReliabilityScore}
            />
            <Score label="AI quality" value={evaluation.aiScore} />
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 pt-2 text-sm sm:grid-cols-3">
            <Meta
              label="Hidden tests"
              value={`${evaluation.testsPassed} / ${evaluation.testsTotal}`}
            />
            <Meta
              label="Deployment reachable"
              value={evaluation.deploymentReachable ? 'Yes' : 'No'}
            />
            <Meta label="Profile" value={evaluation.profileName ?? '-'} />
            <Meta
              label="Scored revision"
              value={`v${evaluation.submissionVersion}`}
            />
            <Meta label="Provider" value={evaluation.llmProvider ?? '-'} />
            <Meta label="Model" value={evaluation.modelId ?? '-'} />
          </dl>

          <p className="text-muted-foreground text-xs">
            Which dimensions count is decided by the round&apos;s evaluation
            profile (D20). AI quality applies only from the semi-finals onward.
            Every score is stored with the exact weights used.
          </p>

          {evaluation.overriddenBy ? (
            <p className="border-warning/40 bg-warning/10 rounded-md border px-3 py-2 text-xs">
              Manually overridden. Reason: {evaluation.overrideReason ?? '-'}
            </p>
          ) : null}
        </Card>
      ) : null}

      {history.length > 1 ? (
        <Card className="space-y-2 p-4">
          <SectionTitle>Revision history</SectionTitle>
          <ul className="divide-border divide-y text-sm">
            {history.map((revision) => (
              <li key={revision.id} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium tabular-nums">
                    v{revision.version}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {revision.submittedAt
                      .toISOString()
                      .replace('T', ' ')
                      .slice(0, 19)}{' '}
                    UTC
                  </span>
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  {revision.repoUrl} to {revision.deploymentUrl}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function Detail({
  label,
  value,
  link = false,
}: {
  label: string;
  value: string;
  link?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 text-sm">
      <span className="text-muted-foreground w-24 shrink-0 text-xs">
        {label}
      </span>
      {link ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-primary truncate hover:underline"
        >
          {value}
        </a>
      ) : (
        <span className="truncate">{value}</span>
      )}
    </div>
  );
}

function Score({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-border bg-muted/20 rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value.toFixed(2)}</p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
