import { z } from 'zod';

/**
 * Environment validation. Fails fast at boot if required vars are missing/invalid.
 * Split into server-only (`serverEnv`) and browser-safe (`publicEnv`) surfaces so
 * secrets never leak into client bundles.
 *
 * Vars for features not yet implemented (auth, payments, AI, email) are optional
 * for now and will be tightened to required in their respective epics.
 */

/**
 * Optional env var. `.env` files commonly carry placeholder keys with empty
 * values; an empty string means "not configured", not "configured as ''".
 */
const optionalVar = (minLength = 1) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().min(minLength).optional(),
  );

const optionalUrl = () =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().url().optional(),
  );

const serverSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.string().url(),

  // Auth (Epic E1). The secret is REQUIRED in production (enforced below); in
  // development a fixed fallback keeps local setup frictionless.
  BETTER_AUTH_SECRET: optionalVar(32),
  BETTER_AUTH_URL: optionalUrl(),
  // OAuth credentials stay optional: providers register only when present, so
  // the app runs before the OAuth apps exist. See docs/oauth-setup.md.
  GITHUB_CLIENT_ID: optionalVar(),
  GITHUB_CLIENT_SECRET: optionalVar(),
  GOOGLE_CLIENT_ID: optionalVar(),
  GOOGLE_CLIENT_SECRET: optionalVar(),

  // Payments (Epic E4)
  RAZORPAY_KEY_ID: optionalVar(),
  RAZORPAY_KEY_SECRET: optionalVar(),
  RAZORPAY_WEBHOOK_SECRET: optionalVar(),

  // AI evaluator (Epic E2). The backend is selected entirely by configuration —
  // switching providers must never require a code change.
  LLM_PROVIDER: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.enum(['openai', 'anthropic']).optional(),
    )
    .transform((v) => v ?? 'openai'),
  LLM_MODEL: optionalVar(),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
  ANTHROPIC_API_KEY: optionalVar(),
  OPENAI_API_KEY: optionalVar(),
  GITHUB_API_TOKEN: optionalVar(),

  // Email (Epic E8)
  RESEND_API_KEY: optionalVar(),
  EMAIL_FROM: optionalVar(),

  // Analytics / monitoring
  POSTHOG_API_KEY: optionalVar(),
  SENTRY_DSN: optionalVar(),

  // Tournament lifecycle & bracket engine (Epic E3). Deployment-wide defaults;
  // every one of these can be overridden per tournament in the database, so an
  // organizer never needs a redeploy to change a tournament's shape.
  /** Force a bracket size (8|16|32|64). Unset = size automatically from the field (D6). */
  TOURNAMENT_BRACKET_SIZE: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.coerce.number().int().optional(),
  ),
  /** Do the losing semi-finalists play off for third place? */
  TOURNAMENT_THIRD_PLACE_ENABLED: z
    .string()
    .transform((v) => v !== 'false')
    .default('true'),
  /** Registrations required before a tournament may leave REGISTRATION_OPEN. */
  TOURNAMENT_MIN_REGISTRATIONS: z.coerce.number().int().min(0).default(8),
  /** Hard cap on registrations. Further attempts are refused, not queued. */
  TOURNAMENT_MAX_REGISTRATIONS: z.coerce.number().int().positive().default(512),
  /** Simulation rounds feeding the seeding sum (D13: three). */
  TOURNAMENT_SIMULATION_ROUNDS: z.coerce.number().int().positive().default(3),
  /** Advance the better seed when neither competitor submitted, instead of stalling. */
  TOURNAMENT_ADVANCE_HIGHER_SEED_ON_NO_SHOW: z
    .string()
    .transform((v) => v !== 'false')
    .default('true'),

  // Evaluation runner
  RUNNER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  // How long a job may stay CLAIMED before it is assumed abandoned and
  // requeued. Must exceed the longest expected job duration.
  RUNNER_CLAIM_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  RUNNER_ENABLED: z
    .string()
    .transform((v) => v !== 'false')
    .default('true'),
});

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z
    .preprocess(
      (value) =>
        typeof value === 'string' && value.trim() === '' ? undefined : value,
      z.string().url().optional(),
    )
    .transform((v) => v ?? 'http://localhost:3000'),
  NEXT_PUBLIC_RAZORPAY_KEY_ID: optionalVar(),
  NEXT_PUBLIC_POSTHOG_KEY: optionalVar(),
  NEXT_PUBLIC_POSTHOG_HOST: optionalVar(),
  NEXT_PUBLIC_SENTRY_DSN: optionalVar(),
});

function format(error: z.ZodError): string {
  return error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
}

// Public env must be referenced statically so Next inlines the values client-side.
const rawPublic = {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_RAZORPAY_KEY_ID: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
  NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
  NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
};

const publicParsed = publicSchema.safeParse(rawPublic);
if (!publicParsed.success) {
  throw new Error(
    `Invalid public environment variables:\n${format(publicParsed.error)}`,
  );
}

export const publicEnv = publicParsed.data;

// Server env is only validated on the server. Guard so this never runs client-side.
/** Dev-only Better Auth secret. Production must supply a real one. */
const DEV_AUTH_SECRET = 'blitzit-development-only-secret-do-not-use-in-prod';

function loadServerEnv() {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment variables:\n${format(parsed.error)}`,
    );
  }
  const env = parsed.data;

  if (env.NODE_ENV === 'production' && !env.BETTER_AUTH_SECRET) {
    throw new Error(
      'BETTER_AUTH_SECRET is required in production (min 32 chars). ' +
        'Generate one with: openssl rand -base64 32',
    );
  }

  return {
    ...env,
    // Resolved values so consumers never deal with undefined.
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET ?? DEV_AUTH_SECRET,
    BETTER_AUTH_URL:
      env.BETTER_AUTH_URL ??
      process.env.NEXT_PUBLIC_APP_URL ??
      'http://localhost:3000',
  };
}

export type ServerEnv = ReturnType<typeof loadServerEnv>;

let cached: ServerEnv | undefined;

/** Access validated server-only env. Throws if called in a browser context. */
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() must not be called on the client');
  }
  cached ??= loadServerEnv();
  return cached;
}
