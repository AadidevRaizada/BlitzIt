import 'server-only';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from '@/server/db';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { syncDomainUser } from '@/server/modules/auth/sync';

/**
 * Better Auth server instance (D3/D7 — Better Auth, not NextAuth).
 *
 * Providers are registered only when their credentials are present, so local
 * development works before OAuth apps exist (see docs/oauth-setup.md). The
 * login UI reflects which providers are actually enabled.
 */

const env = serverEnv();

const socialProviders: Record<
  string,
  { clientId: string; clientSecret: string }
> = {};

if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
  socialProviders.github = {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
  };
}

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  socialProviders.google = {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
  };
}

/** Which social providers are configured — used to render the login page. */
export const enabledProviders = Object.keys(socialProviders) as Array<
  'github' | 'google'
>;

if (enabledProviders.length === 0) {
  logger.warn(
    'No OAuth providers configured — set GITHUB_/GOOGLE_ client id+secret. See docs/oauth-setup.md',
  );
}

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,

  // Our domain profile model is already named `User`, so Better Auth's own
  // tables are mapped to the namespaced `Auth*` models (see schema.prisma).
  user: { modelName: 'AuthUser' },
  session: { modelName: 'AuthSession' },
  account: { modelName: 'AuthAccount' },
  verification: { modelName: 'AuthVerification' },

  emailAndPassword: { enabled: false },
  socialProviders,

  databaseHooks: {
    user: {
      create: {
        // Mirror the auth user into our domain User + Profile as soon as it
        // exists. `syncDomainUser` is idempotent, and the session helpers
        // re-run it, so a failure here self-heals on the next request.
        after: async (user) => {
          try {
            await syncDomainUser({
              authUserId: user.id,
              email: user.email,
              name: user.name ?? null,
              image: user.image ?? null,
            });
          } catch (error) {
            logger.error(
              { err: error, authUserId: user.id },
              'domain user sync failed on create; will retry on next session',
            );
          }
        },
      },
    },
  },

  // MUST be last: lets Better Auth set cookies from Server Actions.
  plugins: [nextCookies()],
});

export type Auth = typeof auth;
