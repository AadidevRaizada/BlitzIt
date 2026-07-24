import './load-env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

/**
 * Promote a user to ADMIN (or demote with --demote).
 *
 * There is no self-service path to the admin role by design — it is granted
 * out of band by an operator.
 *
 *   npm run make:admin -- you@example.com
 *   npm run make:admin -- you@example.com --demote
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const args = process.argv.slice(2);
  const email = args.find((a) => !a.startsWith('--'));
  const demote = args.includes('--demote');

  if (!email) {
    console.error('Usage: npm run make:admin -- <email> [--demote]');
    process.exit(1);
  }

  const role = demote ? 'USER' : 'ADMIN';
  const user = await db.user
    .update({ where: { email }, data: { role }, select: { username: true } })
    .catch(() => null);

  if (!user) {
    console.error(
      `No user with email "${email}". Sign in once first so the account exists.`,
    );
    process.exit(1);
  }

  console.log(`${user.username} (${email}) is now ${role}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
