import { db } from '../../src/server/db';

/**
 * Give every round of a tournament a problem, so it is allowed to open.
 *
 * `openRound` refuses a round with no problem assigned: opening one would start
 * a countdown against a statement that does not exist, and
 * `assignProblemToRound` cannot repair it afterwards because it only accepts a
 * PENDING round. The verification suites drive real lifecycle transitions, so
 * they have to satisfy the same invariant an operator does.
 *
 * The problem is created once per tag and reused. Slugs carry the caller's tag
 * so each suite's own cleanup (`slug: { contains: TAG }`) still collects it —
 * tournaments are deleted first, which cascades the rounds referencing it.
 */
export async function attachProblemsToRounds(
  tournamentId: string,
  tag: string,
): Promise<string> {
  const slug = `p-${tag}-rounds`;

  const problem = await db.problem.upsert({
    where: { slug },
    update: {},
    create: {
      title: 'Harness round problem',
      slug,
      statementMarkdown: 'Build something.',
      category: 'REST_API',
      evaluationStrategy: 'REST_API',
      contractSpec: {},
      visibility: 'PUBLISHED',
    },
    select: { id: true },
  });

  await db.round.updateMany({
    where: { tournamentId, problemId: null },
    data: { problemId: problem.id },
  });

  return problem.id;
}
