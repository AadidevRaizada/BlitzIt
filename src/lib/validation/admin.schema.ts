import { z } from 'zod';
import { SUPPORTED_BRACKET_SIZES } from '@/server/modules/tournament/config.public';

/**
 * Admin-surface schemas (E5).
 *
 * Shared between the forms and the actions so the browser and the server agree
 * on shape. The server re-validates and is the one that decides; nothing here
 * is trusted.
 */

export const CHALLENGE_CATEGORIES = [
  'REST_API',
  'WEB_APP',
  'AI_AGENT',
  'OCR',
  'AUTOMATION',
  'INTERNAL_TOOL',
  'CLI_APP',
  'CHROME_EXTENSION',
] as const;

export const TOURNAMENT_VISIBILITIES = ['PUBLIC', 'UNLISTED'] as const;

const slug = z
  .string()
  .trim()
  .min(3, 'Slug must be at least 3 characters')
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Slug may contain lowercase letters, numbers and single hyphens',
  );

const bracketSize = z.coerce
  .number()
  .int()
  .refine(
    (value) => (SUPPORTED_BRACKET_SIZES as readonly number[]).includes(value),
    { message: 'Bracket size must be 8, 16, 32 or 64 (D6)' },
  );

/**
 * A `datetime-local` input yields `YYYY-MM-DDTHH:mm` with no zone. The admin
 * schedules in UTC (D8), so the value is interpreted as UTC explicitly rather
 * than through the server's local timezone — which would silently shift every
 * schedule by the deployment's offset.
 */
const utcDateTime = z.preprocess((value) => {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;

  // `YYYY-MM-DDTHH:mm` (no zone) is pinned to UTC by appending seconds + `Z`.
  // Passing it to `new Date()` unqualified would use the SERVER's timezone and
  // silently shift every schedule by the deployment's offset.
  const iso = value.endsWith('Z') ? value : `${value.slice(0, 16)}:00Z`;
  const parsed = new Date(iso);
  // Return the raw value on a parse failure so Zod reports it as invalid
  // rather than silently dropping the field.
  return Number.isNaN(parsed.getTime()) ? value : parsed;
}, z.date().optional());

/** Empty string → undefined, so an untouched optional field is simply absent. */
const optionalText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().max(max).optional(),
  );

const clearableText = (max = 500) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

const clearableUrl = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().url('Starter repo must be a valid URL').nullable().optional(),
);

const optionalPositiveInt = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.coerce.number().int().positive().optional(),
);

const optionalNonNegativeInt = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.coerce.number().int().min(0).optional(),
);

const clearablePositiveInt = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.union([z.coerce.number().int().positive(), z.null()]).optional(),
);

const clearableNonNegativeInt = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.union([z.coerce.number().int().min(0), z.null()]).optional(),
);

const clearableBracketSize = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.union([bracketSize, z.null()]).optional(),
);

const formBoolean = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const normalized = v.trim().toLowerCase();
  if (normalized === '') return undefined;
  if (['true', '1', 'on', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'off', 'no'].includes(normalized)) return false;
  return v;
}, z.boolean());

export const createTournamentFormSchema = z.object({
  name: z.string().trim().min(3, 'Name must be at least 3 characters').max(120),
  slug,
  description: optionalText(1000),
  bracketSize: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    bracketSize.optional(),
  ),
  thirdPlaceEnabled: formBoolean.optional(),
  minRegistrations: optionalNonNegativeInt,
  maxRegistrations: optionalPositiveInt,
  passPriceMinor: optionalNonNegativeInt,
  visibility: z.enum(TOURNAMENT_VISIBILITIES).optional(),
});

export type CreateTournamentFormInput = z.infer<
  typeof createTournamentFormSchema
>;

export const updateTournamentFormSchema = createTournamentFormSchema
  .partial()
  .omit({ slug: true })
  .extend({
    description: clearableText(1000),
    bracketSize: clearableBracketSize,
    minRegistrations: clearableNonNegativeInt,
    maxRegistrations: clearablePositiveInt,
  });

/** Prize pool (D9/D12). Money is always integer paise. */
export const prizePoolFormSchema = z.object({
  basePrizePoolMinor: optionalNonNegativeInt,
  prizePerRegistrationMinor: optionalNonNegativeInt,
  firstPrizeCapMinor: optionalNonNegativeInt,
});

export const scheduleFormSchema = z
  .object({
    registrationOpensAt: utcDateTime,
    registrationClosesAt: utcDateTime,
    simulationOpensAt: utcDateTime,
    simulationClosesAt: utcDateTime,
    liveStartsAt: utcDateTime,
  })
  .refine((v) => ordered(v.registrationOpensAt, v.registrationClosesAt), {
    message: 'Registration must close after it opens',
    path: ['registrationClosesAt'],
  })
  .refine((v) => ordered(v.registrationClosesAt, v.simulationOpensAt), {
    message: 'Simulation must open after registration closes',
    path: ['simulationOpensAt'],
  })
  .refine((v) => ordered(v.simulationOpensAt, v.simulationClosesAt), {
    message: 'Simulation must close after it opens',
    path: ['simulationClosesAt'],
  })
  .refine((v) => ordered(v.simulationClosesAt, v.liveStartsAt), {
    message: 'The knockout stage must start after simulation closes',
    path: ['liveStartsAt'],
  });

function ordered(earlier?: Date, later?: Date): boolean {
  if (!earlier || !later) return true;
  return earlier.getTime() < later.getTime();
}

export const archiveTournamentSchema = z.object({
  tournamentId: z.string().uuid('Invalid tournament'),
  archived: z.coerce.boolean(),
});

export const removeRegistrationSchema = z.object({
  tournamentId: z.string().uuid('Invalid tournament'),
  userId: z.string().uuid('Invalid competitor'),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
});

// ───────────────────────── Problems ─────────────────────────

export const createProblemFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, 'Title must be at least 3 characters')
    .max(160),
  slug,
  category: z.enum(CHALLENGE_CATEGORIES),
  statementMarkdown: z
    .string()
    .trim()
    .min(20, 'A problem statement needs at least 20 characters')
    .max(20_000),
  difficulty: optionalText(32),
  starterRepoUrl: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().url('Starter repo must be a valid URL').optional(),
  ),
  contractSpec: z
    .string()
    .trim()
    .optional()
    .transform((value, ctx) => {
      if (!value) return {};
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Contract spec must be valid JSON',
        });
        return z.NEVER;
      }
    }),
});

export const updateProblemFormSchema = createProblemFormSchema
  .partial()
  .omit({ slug: true })
  .extend({
    difficulty: clearableText(32),
    starterRepoUrl: clearableUrl,
  });

export const problemIdSchema = z.object({
  problemId: z.string().uuid('Invalid problem'),
});

export const addHiddenTestFormSchema = z.object({
  problemId: z.string().uuid('Invalid problem'),
  name: z.string().trim().min(1, 'A test name is required').max(120),
  kind: z.string().trim().min(1).max(40).default('HTTP_ASSERTION'),
  weight: z.coerce.number().int().min(1).max(100).default(1),
  timeoutMs: z.coerce.number().int().min(100).max(120_000).default(10_000),
  spec: z
    .string()
    .trim()
    .min(2, 'A test spec is required')
    .transform((value, ctx) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Test spec must be valid JSON',
        });
        return z.NEVER;
      }
    }),
});

export const hiddenTestIdSchema = z.object({
  testId: z.string().uuid('Invalid test'),
});

export const assignProblemSchema = z.object({
  roundId: z.string().uuid('Invalid round'),
  problemId: z.string().uuid('Invalid problem'),
});

// ───────────────────────── Directory ─────────────────────────

export const listUsersSchema = z.object({
  search: optionalText(120),
  take: z.coerce.number().int().positive().max(200).optional(),
});

export const listAuditSchema = z.object({
  entityType: optionalText(60),
  entityId: optionalText(64),
  action: optionalText(80),
  take: z.coerce.number().int().positive().max(200).optional(),
});
