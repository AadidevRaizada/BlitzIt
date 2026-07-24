import './load-env';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from '../src/server/db';

/**
 * DEV ONLY — mint a real Better Auth session cookie without OAuth.
 *
 * Local verification of the authenticated/admin routes needs a valid signed
 * session cookie, which OAuth would normally produce. This builds a throwaway
 * Better Auth instance against the SAME database and secret with
 * email+password enabled, signs a user up, and prints the resulting cookie.
 * The real app instance (OAuth-only) accepts the session because sessions are
 * just rows plus a signature over the shared secret.
 *
 *   npm run dev:session -- someone@example.com
 *
 * Refuses to run in production.
 */
if (process.env.NODE_ENV === 'production') {
  throw new Error('dev-session is not allowed in production');
}

const testAuth = betterAuth({
  database: prismaAdapter(db, { provider: 'postgresql' }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  user: { modelName: 'AuthUser' },
  session: { modelName: 'AuthSession' },
  account: { modelName: 'AuthAccount' },
  verification: { modelName: 'AuthVerification' },
  emailAndPassword: { enabled: true },
});

async function main() {
  const email = process.argv[2] ?? `dev-${Date.now()}@blitzit.test`;
  const password = 'dev-password-12345';

  const response = await testAuth.api
    .signUpEmail({
      body: { email, password, name: 'Dev Tester' },
      asResponse: true,
    })
    .catch(async () =>
      testAuth.api.signInEmail({
        body: { email, password },
        asResponse: true,
      }),
    );

  const setCookie = response.headers.get('set-cookie');
  if (!setCookie) {
    console.error('No session cookie returned:', await response.text());
    process.exit(1);
  }

  // "name=value; Path=/; ..." -> "name=value"
  const cookie = setCookie.split(';')[0];
  console.log(`EMAIL=${email}`);
  console.log(`COOKIE=${cookie}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
