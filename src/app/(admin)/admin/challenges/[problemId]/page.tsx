import { notFound } from 'next/navigation';
import { requireAdmin } from '@/server/modules/auth';
import { getProblemDetail } from '@/server/modules/problem';
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
  EmptyState,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableShell,
} from '@/components/ui/table';
import { HiddenTestForm } from '../hidden-test-form';
import {
  ArchiveProblemButton,
  PublishProblemButton,
  RemoveHiddenTestButton,
} from '../problem-actions';
import { ProblemForm } from '../problem-form';

export const metadata = { title: 'Challenge — Blitz It Admin' };
export const dynamic = 'force-dynamic';

export default async function ChallengeDetailPage({
  params,
}: {
  params: Promise<{ problemId: string }>;
}) {
  const admin = await requireAdmin('/admin/challenges');
  const { problemId } = await params;

  let problem;
  try {
    problem = await getProblemDetail(problemId, admin);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/admin/challenges', label: 'Challenges' }}
        title={problem.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{problem.slug}</span>
            <Badge
              tone={
                problem.visibility === 'PUBLISHED'
                  ? 'success'
                  : problem.visibility === 'ARCHIVED'
                    ? 'neutral'
                    : 'warning'
              }
            >
              {problem.visibility}
            </Badge>
            <Badge tone="outline">{problem.category}</Badge>
          </span>
        }
        actions={
          <>
            {problem.visibility === 'DRAFT' ? (
              <PublishProblemButton problemId={problem.id} />
            ) : null}
            {problem.visibility !== 'ARCHIVED' ? (
              <ArchiveProblemButton problemId={problem.id} />
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          <section className="space-y-3">
            <SectionTitle>Edit challenge</SectionTitle>
            <ProblemForm initial={problem} />
          </section>

          <section className="space-y-3">
            <SectionTitle>Hidden tests</SectionTitle>
            {problem.tests.length === 0 ? (
              <EmptyState
                title="No hidden tests"
                hint="A challenge cannot be published until at least one hidden test exists."
              />
            ) : (
              <TableShell>
                <THead>
                  <TH>Seq</TH>
                  <TH>Name</TH>
                  <TH>Kind</TH>
                  <TH numeric>Weight</TH>
                  <TH numeric>Timeout</TH>
                  <TH>Spec</TH>
                  <TH numeric>Actions</TH>
                </THead>
                <TBody>
                  {problem.tests.map((test) => (
                    <TR key={test.id}>
                      <TD className="font-mono text-xs">{test.sequence}</TD>
                      <TD>{test.name}</TD>
                      <TD>{test.kind}</TD>
                      <TD numeric>{test.weight}</TD>
                      <TD numeric>{test.timeoutMs}ms</TD>
                      <TD>
                        <pre className="bg-muted max-w-md overflow-x-auto rounded-md p-2 text-xs">
                          {JSON.stringify(test.spec, null, 2)}
                        </pre>
                      </TD>
                      <TD numeric>
                        <RemoveHiddenTestButton
                          testId={test.id}
                          problemId={problem.id}
                        />
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </TableShell>
            )}
          </section>

          {problem.visibility !== 'ARCHIVED' ? (
            <section className="space-y-3">
              <SectionTitle>Add hidden test</SectionTitle>
              <HiddenTestForm problemId={problem.id} />
            </section>
          ) : null}
        </div>

        <aside className="space-y-3">
          <SectionTitle>Metadata</SectionTitle>
          <Card>
            <CardContent className="grid gap-3">
              <DataRow label="Difficulty" value={problem.difficulty ?? '-'} />
              <DataRow label="Strategy" value={problem.evaluationStrategy} />
              <DataRow label="Assigned rounds" value={problem.assignedRounds} />
              <DataRow label="Created" value={formatIst(problem.createdAt)} />
              <DataRow label="Updated" value={formatIst(problem.updatedAt)} />
              <DataRow
                label="Starter repository"
                value={
                  problem.starterRepoUrl ? (
                    <a
                      href={problem.starterRepoUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-primary hover:underline"
                    >
                      Open starter
                    </a>
                  ) : (
                    '-'
                  )
                }
              />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
