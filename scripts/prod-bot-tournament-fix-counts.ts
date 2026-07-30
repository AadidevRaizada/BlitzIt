import './load-env';
import { db } from '../src/server/db';

const slugPrefix = process.env.BOT_TOURNAMENT_SLUG_PREFIX ?? 'prod-bot-score-';

async function main() {
  const tournaments = await db.tournament.findMany({
    where: { slug: { startsWith: slugPrefix } },
    select: { id: true, slug: true },
  });

  const updated = [];
  for (const tournament of tournaments) {
    const active = await db.registration.count({
      where: { tournamentId: tournament.id, status: 'ACTIVE' },
    });
    await db.tournament.update({
      where: { id: tournament.id },
      data: { participantCount: active },
    });
    updated.push({ slug: tournament.slug, participantCount: active });
  }

  console.log(JSON.stringify({ updated }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
