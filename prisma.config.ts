import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Load local env first (.env.local wins), fall back to .env. Never overrides
// values already present in the real shell environment.
config({ path: ['.env.local', '.env'] });

/**
 * `prisma generate` runs from `postinstall`, which must succeed on a fresh
 * clone BEFORE any .env file exists. Prisma's `env()` helper resolves eagerly
 * and would abort the whole install, so we fall back to an unreachable
 * placeholder instead: codegen needs no connection, while commands that do
 * touch the database (`migrate`, `db push`) still fail loudly against it.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://DATABASE_URL:is-not-set@localhost:1/unset';
const SHADOW_DATABASE_URL =
  process.env.SHADOW_DATABASE_URL ?? shadowDatabaseUrl(DATABASE_URL);

function shadowDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const database = url.pathname.replace(/^\//, '') || 'shadow';
  url.pathname = `/${database}_shadow`;
  return url.toString();
}

// Prisma 7: connection config lives here, NOT in schema.prisma's datasource block.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: DATABASE_URL,
    shadowDatabaseUrl: SHADOW_DATABASE_URL,
  },
});
