import Link from 'next/link';
import { requireAdmin } from '@/server/modules/auth';
import { listProblems } from '@/server/modules/problem';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { PageHeader, formatIst } from '@/components/ui/page-header';
import {
  EmptyState,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableShell,
} from '@/components/ui/table';
import { ArchiveProblemButton, PublishProblemButton } from './problem-actions';

export const metadata = { title: 'Challenges — Blitz It Admin' };
export const dynamic = 'force-dynamic';

export default async function ChallengesPage() {
  const admin = await requireAdmin('/admin/challenges');
  const problems = await listProblems(admin, { take: 200 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Challenges"
        description="Author problems, manage hidden tests, and publish challenges for assignment."
        actions={
          <Link
            href="/admin/challenges/new"
            className={buttonVariants({ variant: 'primary' })}
          >
            Create challenge
          </Link>
        }
      />

      {problems.length === 0 ? (
        <EmptyState
          title="No challenges yet"
          hint="Create a REST_API challenge, add hidden tests, then publish it for assignment."
        />
      ) : (
        <TableShell>
          <THead>
            <TH>Challenge</TH>
            <TH>Category</TH>
            <TH>Status</TH>
            <TH numeric>Tests</TH>
            <TH numeric>Rounds</TH>
            <TH>Updated</TH>
            <TH numeric>Actions</TH>
          </THead>
          <TBody>
            {problems.map((problem) => (
              <TR key={problem.id}>
                <TD>
                  <Link
                    href={`/admin/challenges/${problem.id}`}
                    className="focus-visible:ring-ring rounded-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {problem.title}
                  </Link>
                  <span className="text-muted-foreground block font-mono text-xs">
                    {problem.slug}
                  </span>
                </TD>
                <TD>{problem.category}</TD>
                <TD>
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
                </TD>
                <TD numeric>{problem.hiddenTests}</TD>
                <TD numeric>{problem.assignedRounds}</TD>
                <TD>{formatIst(problem.updatedAt)}</TD>
                <TD numeric>
                  <div className="flex justify-end gap-1">
                    {problem.visibility === 'DRAFT' ? (
                      <PublishProblemButton problemId={problem.id} />
                    ) : null}
                    {problem.visibility !== 'ARCHIVED' ? (
                      <ArchiveProblemButton problemId={problem.id} />
                    ) : null}
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </TableShell>
      )}
    </div>
  );
}
