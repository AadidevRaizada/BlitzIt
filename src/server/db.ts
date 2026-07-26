import 'server-only';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/prisma/client';
import { serverEnv } from '@/lib/env';

/**
 * Prisma singleton.
 *
 * Prisma 7 REQUIRES a driver adapter (or an Accelerate URL). We connect
 * directly to Railway Postgres via `@prisma/adapter-pg`, which owns the
 * connection pool. Cached on globalThis so dev HMR doesn't exhaust connections.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

let localPrisma: PrismaClient | undefined;

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: serverEnv().DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

function getClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;
  if (localPrisma) return localPrisma;

  const client = createClient();
  localPrisma = client;

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
  }

  return client;
}

/**
 * Lazy Prisma singleton.
 *
 * Next imports route modules during `next build` to collect config. Creating the
 * Prisma client at import time makes that scan require DATABASE_URL even for
 * fully dynamic pages. The proxy preserves the existing `db.user.findMany()`
 * call surface while delaying env validation and pool creation until the first
 * real database operation.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
