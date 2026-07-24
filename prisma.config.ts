import { config } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// Load local env first (.env.local wins), fall back to .env. Never overrides
// values already present in the real shell environment.
config({ path: ['.env.local', '.env'] });

// Prisma 7: connection config lives here, NOT in schema.prisma's datasource block.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
