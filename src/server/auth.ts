import 'server-only';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from '@/server/db';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { syncDomainUser } from '@/server/modules/auth/sync';

/**
 * Better Auth server instance (D3/D7 - Better Auth, not NextAuth).
 *
 * Next imports route modules during `next build` to collect config. Keep env
 * validation and adapter construction lazy so Railway builds do not require
 * runtime-only secrets before the deployment starts.
 */

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : undefined;
}

function configuredSocialProviders(): Record<
  string,
  { clientId: string; clientSecret: string }
> {
  const providers: Record<string, { clientId: string; clientSecret: string }> =
    {};

  const githubClientId = optionalEnv('GITHUB_CLIENT_ID');
  const githubClientSecret = optionalEnv('GITHUB_CLIENT_SECRET');
  if (githubClientId && githubClientSecret) {
    providers.github = {
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    };
  }

  const googleClientId = optionalEnv('GOOGLE_CLIENT_ID');
  const googleClientSecret = optionalEnv('GOOGLE_CLIENT_SECRET');
  if (googleClientId && googleClientSecret) {
    providers.google = {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    };
  }

  return providers;
}

/** Which social providers are configured - used to render the login page. */
export const enabledProviders = Object.keys(
  configuredSocialProviders(),
) as Array<'github' | 'google'>;

let authInstance: ReturnType<typeof createAuth> | undefined;
let warnedNoProviders = false;

/**
 * Every origin the app is legitimately served from.
 *
 * Better Auth derives its OAuth `redirect_uri` AND its origin check from
 * `baseURL`. When the two disagree with the host in the address bar, sign-in and
 * sign-out both appear to hang and neither reports why: the OAuth callback lands
 * on the configured host, the session cookie is written for that host, and the
 * browser returns to the *other* host still signed out. Sign-out then posts to a
 * host that holds no cookie and whose origin is untrusted, so it fails silently.
 *
 * That is exactly what happened when a custom domain (`circuit.devhub.wtf`) was
 * put in front of a deployment whose `BETTER_AUTH_URL` still named the generated
 * `*.up.railway.app` host. Railway injects `RAILWAY_PUBLIC_DOMAIN` itself, so
 * trusting it here means attaching or changing a domain cannot silently break
 * authentication again while the env var catches up.
 */
function trustedOriginsFor(baseUrl: string): string[] {
  const origins = new Set<string>();

  const add = (value: string | undefined) => {
    if (!value) return;
    try {
      origins.add(
        new URL(value.includes('://') ? value : `https://${value}`).origin,
      );
    } catch {
      // A malformed origin is dropped rather than crashing auth entirely.
      logger.warn({ value }, 'ignoring malformed trusted origin');
    }
  };

  add(baseUrl);
  add(optionalEnv('RAILWAY_PUBLIC_DOMAIN'));
  add(optionalEnv('NEXT_PUBLIC_APP_URL'));
  // Explicit escape hatch: comma-separated, for a domain we do not yet know.
  for (const extra of (optionalEnv('BETTER_AUTH_TRUSTED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    add(extra);
  }

  return [...origins];
}

function createAuth() {
  const env = serverEnv();
  const socialProviders = configuredSocialProviders();
  const trustedOrigins = trustedOriginsFor(env.BETTER_AUTH_URL);

  // A mismatch is survivable now, but it still means the OAuth callback and the
  // cookie are being written for a host nobody is browsing — so say so loudly
  // rather than leaving someone to debug a hanging login button.
  const publicDomain = optionalEnv('RAILWAY_PUBLIC_DOMAIN');
  if (publicDomain) {
    const expected = new URL(`https://${publicDomain}`).origin;
    if (new URL(env.BETTER_AUTH_URL).origin !== expected) {
      logger.warn(
        { betterAuthUrl: env.BETTER_AUTH_URL, publicDomain, trustedOrigins },
        'BETTER_AUTH_URL does not match the public domain — OAuth callbacks and ' +
          'session cookies will be issued for a host users are not on. Set ' +
          'BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL to the public domain, and ' +
          'register that callback URL with each OAuth provider.',
      );
    }
  }

  if (Object.keys(socialProviders).length === 0 && !warnedNoProviders) {
    warnedNoProviders = true;
    logger.warn(
      'No OAuth providers configured - set GITHUB_/GOOGLE_ client id+secret. See docs/oauth-setup.md',
    );
  }

  return betterAuth({
    database: prismaAdapter(db, { provider: 'postgresql' }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins,

    // Our domain profile model is already named `User`, so Better Auth's own
    // tables are mapped to the namespaced `Auth*` models (see schema.prisma).
    user: { modelName: 'AuthUser' },
    session: { modelName: 'AuthSession' },
    verification: { modelName: 'AuthVerification' },
    account: {
      modelName: 'AuthAccount',
      // Signing in with Google using an email that already signed up via GitHub
      // must attach to the SAME account, not create a second one. Both providers
      // verify email ownership, so implicit linking is safe and is what we want;
      // stated explicitly rather than relying on the library default.
      accountLinking: {
        enabled: true,
        trustedProviders: ['github', 'google'],
        allowDifferentEmails: false,
      },
    },

    emailAndPassword: { enabled: false },
    socialProviders,

    // Send OAuth failures (denied consent, expired/mismatched state, provider
    // errors) back to our own login screen instead of Better Auth's built-in
    // error page, which renders outside the app shell.
    onAPIError: {
      // Better Auth appends `?error=<reason>`; the login page renders a generic
      // failure message for any value (reasons are logged, not shown to users).
      errorURL: '/login',
      onError: (error) => {
        logger.warn({ err: error }, 'auth API error');
      },
    },

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
}

function getAuth() {
  if (!authInstance) {
    authInstance = createAuth();
  }

  return authInstance;
}

export const auth = new Proxy({} as ReturnType<typeof createAuth>, {
  get(_target, prop) {
    const instance = getAuth();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});

export type Auth = typeof auth;
