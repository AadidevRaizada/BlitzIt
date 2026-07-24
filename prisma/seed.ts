import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Dev seed. Idempotent. Expands in later epics (admin user, sample REST_API
 * problem + hidden tests, a demo tournament). Minimal for Milestone 0.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const badges = [
    {
      slug: 'champion',
      name: 'Champion',
      description: 'Won a Blitz It tournament',
    },
    { slug: 'finalist', name: 'Finalist', description: 'Reached the finals' },
    {
      slug: 'first-blood',
      name: 'First Blood',
      description: 'Won your first match',
    },
  ];

  for (const b of badges) {
    await db.badge.upsert({
      where: { slug: b.slug },
      update: {},
      create: b,
    });
  }

  console.log(`Seeded ${badges.length} badges.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
