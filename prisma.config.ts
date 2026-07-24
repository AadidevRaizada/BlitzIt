import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

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
