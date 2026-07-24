import { z } from 'zod';

/**
 * Environment validation. Fails fast at boot if required vars are missing/invalid.
 * Split into server-only (`serverEnv`) and browser-safe (`publicEnv`) surfaces so
 * secrets never leak into client bundles.
 *
 * Vars for features not yet implemented (auth, payments, AI, email) are optional
 * for now and will be tightened to required in their respective epics.
 */

const serverSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  DATABASE_URL: z.string().url(),

  // Auth (Epic E1) — optional until wired
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Payments (Epic E4)
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // AI evaluator (Epic E2)
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GITHUB_API_TOKEN: z.string().optional(),

  // Email (Epic E8)
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // Analytics / monitoring
  POSTHOG_API_KEY: z.string().optional(),
  SENTRY_DSN: z.string().optional(),

  // Evaluation runner
  RUNNER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  RUNNER_ENABLED: z
    .string()
    .transform((v) => v !== 'false')
    .default('true'),
});

const publicSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_RAZORPAY_KEY_ID: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
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
function loadServerEnv() {
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment variables:\n${format(parsed.error)}`,
    );
  }
  return parsed.data;
}

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

/** Access validated server-only env. Throws if called in a browser context. */
export function serverEnv(): ServerEnv {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() must not be called on the client');
  }
  cached ??= loadServerEnv();
  return cached;
}
