import { notFound } from 'next/navigation';
import { requireAdmin } from '@/server/modules/auth';
import {
  getAdminSubmission,
  getSubmissionHistory,
} from '@/server/modules/submission';
import { AppError } from '@/lib/errors';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  DataRow,
  PageHeader,
  SectionTitle,
  formatIst,
} from '@/components/ui/page-header';
import {
  JobStatusBadge,
  SubmissionStatusBadge,
} from '@/components/features/submission-status-badge';
import { SubmissionRowActions } from '@/components/features/submission-row-actions';

export const metadata = { title: 'Evaluation - The Circuit Admin' };
export const dynamic = 'force-dynamic';

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="bg-muted max-h-80 overflow-auto rounded-md p-3 text-xs">
      {JSON.stringify(value ?? null, null, 2)}
    </pre>
  );
}

export default async function EvaluationDetailPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const admin = await requireAdmin('/admin/evaluations');
  const { submissionId } = await params;

  let submission;
  let history;
  try {
    [submission, history] = await Promise.all([
      getAdminSubmission(submissionId, admin),
      getSubmissionHistory(submissionId, admin),
    ]);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const evaluation = submission.evaluation;

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/admin/evaluations', label: 'Evaluations' }}
        title={`Submission ${submission.id.slice(0, 8)}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <SubmissionStatusBadge state={submission.state} />
            {submission.job ? (
              <JobStatusBadge state={submission.job.state} />
            ) : null}
            <Badge tone="outline">v{submission.version}</Badge>
          </span>
        }
        actions={
          <SubmissionRowActions
            submissionId={submission.id}
            state={submission.state}
          />
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          <section className="grid gap-3 md:grid-cols-4">
            <Card>
              <CardContent className="pt-4">
                <DataRow
                  label="Overall"
                  value={evaluation ? evaluation.overallScore.toFixed(2) : '-'}
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <DataRow
                  label="Functional"
                  value={
                    evaluation ? evaluation.functionalScore.toFixed(2) : '-'
                  }
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <DataRow
                  label="Performance"
                  value={
                    evaluation ? evaluation.performanceScore.toFixed(2) : '-'
                  }
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <DataRow
                  label="AI"
                  value={evaluation ? evaluation.aiScore.toFixed(2) : '-'}
                />
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <SectionTitle>Evaluation metadata</SectionTitle>
            <Card>
              <CardContent className="grid gap-3 pt-4 md:grid-cols-3">
                <DataRow
                  label="Profile"
                  value={evaluation?.profileName ?? '-'}
                />
                <DataRow
                  label="Provider"
                  value={evaluation?.llmProvider ?? '-'}
                />
                <DataRow label="Model" value={evaluation?.modelId ?? '-'} />
                <DataRow
                  label="Prompt hash"
                  value={evaluation?.modelPromptHash ?? '-'}
                />
                <DataRow
                  label="Rubric version"
                  value={evaluation?.rubricVersion ?? '-'}
                />
                <DataRow
                  label="Submission version"
                  value={evaluation?.submissionVersion ?? '-'}
                />
                <DataRow
                  label="Started"
                  value={formatIst(evaluation?.startedAt)}
                />
                <DataRow
                  label="Finished"
                  value={formatIst(evaluation?.finishedAt)}
                />
                <DataRow
                  label="Deployment reachable"
                  value={
                    evaluation ? String(evaluation.deploymentReachable) : '-'
                  }
                />
              </CardContent>
            </Card>
          </section>

          {evaluation ? (
            <section className="space-y-3">
              <SectionTitle>Audit evidence</SectionTitle>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardContent className="space-y-2 pt-4">
                    <h3 className="font-medium">Test results</h3>
                    <JsonBlock value={evaluation.testResults} />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="space-y-2 pt-4">
                    <h3 className="font-medium">Probe evidence</h3>
                    <JsonBlock value={evaluation.probeEvidence} />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="space-y-2 pt-4">
                    <h3 className="font-medium">Dimensions</h3>
                    <JsonBlock value={evaluation.dimensions} />
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="space-y-2 pt-4">
                    <h3 className="font-medium">LLM raw</h3>
                    <JsonBlock value={evaluation.llmRaw} />
                  </CardContent>
                </Card>
              </div>
            </section>
          ) : (
            <Card>
              <CardContent className="text-muted-foreground py-8 text-sm">
                No evaluation has been persisted yet.
              </CardContent>
            </Card>
          )}
        </div>

        <aside className="space-y-6">
          <section className="space-y-3">
            <SectionTitle>Submission</SectionTitle>
            <Card>
              <CardContent className="grid gap-3 pt-4">
                <DataRow label="Category" value={submission.category} />
                <DataRow
                  label="Submitted"
                  value={formatIst(submission.submittedAt)}
                />
                <DataRow
                  label="Sealed"
                  value={formatIst(submission.sealedAt)}
                />
                <DataRow
                  label="Repository"
                  value={
                    <a
                      href={submission.repoUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-primary break-all hover:underline"
                    >
                      {submission.repoUrl}
                    </a>
                  }
                />
                <DataRow
                  label="Deployment"
                  value={
                    <a
                      href={submission.deploymentUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-primary break-all hover:underline"
                    >
                      {submission.deploymentUrl}
                    </a>
                  }
                />
              </CardContent>
            </Card>
          </section>

          <section className="space-y-3">
            <SectionTitle>Revisions</SectionTitle>
            <Card>
              <CardContent className="space-y-3 pt-4">
                {history.map((revision) => (
                  <div
                    key={revision.id}
                    className="border-border border-b pb-3 last:border-0 last:pb-0"
                  >
                    <p className="text-sm font-medium">v{revision.version}</p>
                    <p className="text-muted-foreground text-xs">
                      {formatIst(revision.submittedAt)}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {revision.repoUrl}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        </aside>
      </div>
    </div>
  );
}
