import './load-env';
import { db } from '../src/server/db';

const slugPrefix = process.env.BOT_TOURNAMENT_SLUG_PREFIX ?? 'prod-bot-score-';

async function main() {
  const tournaments = await db.tournament.findMany({
    where: { slug: { startsWith: slugPrefix } },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      slug: true,
      status: true,
      visibility: true,
      bracketSize: true,
      participantCount: true,
      rounds: {
        select: { id: true, status: true, stage: true },
        orderBy: { createdAt: 'asc' },
      },
      submissions: {
        select: {
          status: true,
          repoUrl: true,
          evaluation: {
            select: {
              overallScore: true,
              aiScore: true,
              llmProvider: true,
              modelId: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      rankings: {
        select: {
          seed: true,
          simulationScore: true,
          user: { select: { username: true } },
        },
        orderBy: { seed: 'asc' },
      },
    },
  });

  const jobCounts = await db.evaluationJob.groupBy({
    by: ['status'],
    where: {
      submission: { tournament: { slug: { startsWith: slugPrefix } } },
    },
    _count: { _all: true },
  });

  console.log(JSON.stringify({ tournaments, jobCounts }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
