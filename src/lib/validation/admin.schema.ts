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
 * A `datetime-local` input yields `YYYY-MM-DDTHH:mm` with no zone.
 *
 * The operator schedules in **IST**, so the value is pinned to +05:30
 * explicitly. Two things this is deliberately NOT doing:
 *
 *   - It is not passing the bare string to `new Date()`, which would apply the
 *     SERVER's timezone and shift every schedule by the deployment's offset.
 *   - It is not interpreting the value as UTC, which is what it used to do.
 *     The field is labelled and rendered in IST, so reading it back as UTC put
 *     every schedule 5h30m into the future: `2026-w2` showed "registration
 *     closes in 6:29:35" while simultaneously refusing entries with
 *     "registration has not opened yet".
 *
 * Storage stays UTC (D8) — `new Date` returns an absolute instant. Only the
 * interpretation of the operator's keystrokes changed. Must stay in step with
 * `toDateTimeLocal`, which renders the other half of this round trip.
 */
const istDateTime = z.preprocess((value) => {
  if (value instanceof Date) return value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;

  // Already-zoned values (an ISO string with `Z`) are taken at face value.
  const iso = value.endsWith('Z') ? value : `${value.slice(0, 16)}:00+05:30`;
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
  sponsorContributionMinor: optionalNonNegativeInt,
  bonusContributionMinor: optionalNonNegativeInt,
  firstPrizeCapMinor: optionalNonNegativeInt,
});

export const scheduleFormSchema = z
  .object({
    registrationOpensAt: istDateTime,
    registrationClosesAt: istDateTime,
    simulationOpensAt: istDateTime,
    simulationClosesAt: istDateTime,
    liveStartsAt: istDateTime,
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
  // `formBoolean`, never `z.coerce.boolean()`: JS coercion makes EVERY non-empty
  // string truthy, so "false" and "0" would both archive. A server action is a
  // network boundary, so the argument is not guaranteed to arrive as a real
  // boolean just because the current caller sends one.
  archived: formBoolean,
});

// ───────────────────────── Tournament configuration (D7 / D20) ─────────────────

/**
 * Knockout stages an operator can retime.
 *
 * `SUDDEN_DEATH` joined the list in E7: it was withheld while the feature was
 * unimplemented (a control for a round that never runs is a lie in the UI), and
 * E6 shipped it. It stays last because it is not a stage of the bracket — it is
 * the decider that unsticks one. D14's ten minutes remains the default; this
 * only exposes the override `resolveTournamentConfig` already honoured.
 */
export const RETIMEABLE_STAGES = [
  'R64',
  'R32',
  'R16',
  'QF',
  'SF',
  'THIRD_PLACE',
  'FINAL',
  'SUDDEN_DEATH',
] as const;

/** How many simulation rounds a tournament plays (D13). */
export const SIMULATION_ROUND_COUNT = 3;

/** A round duration in seconds. Blank means "leave at the default". */
const durationSeconds = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.coerce
    .number()
    .int()
    .min(30, 'A round must last at least 30 seconds')
    .max(86_400, 'A round cannot last longer than 24 hours')
    .optional(),
);

/**
 * Evaluation-profile overrides arrive as JSON text. An empty box means "no
 * overrides" and is stored as `{}` rather than null — both resolve to the D20
 * defaults, and `{}` keeps the column's type uniform.
 */
const evaluationProfilesJson = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return {};
    try {
      const parsed: unknown = JSON.parse(value);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Evaluation profiles must be a JSON object',
        });
        return z.NEVER;
      }
      return parsed;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Evaluation profiles must be valid JSON',
      });
      return z.NEVER;
    }
  });

/**
 * The tournament configuration a form can submit (D7 round durations, D20 stage
 * profiles, and the third-place toggle).
 *
 * Durations arrive as flat, explicitly-named fields and are folded into the
 * nested `{ simulation, stages }` shape the tournament module stores. Flat
 * fields keep the form plain HTML — no JSON editing for a setting that is
 * really just a list of numbers — and writing them out rather than generating
 * them keeps the parsed type precise.
 */
export const configureTournamentFormSchema = z
  .object({
    thirdPlaceEnabled: formBoolean.optional(),
    evaluationProfiles: evaluationProfilesJson,

    simulationDuration1: durationSeconds,
    simulationDuration2: durationSeconds,
    simulationDuration3: durationSeconds,

    stageDurationR64: durationSeconds,
    stageDurationR32: durationSeconds,
    stageDurationR16: durationSeconds,
    stageDurationQF: durationSeconds,
    stageDurationSF: durationSeconds,
    stageDurationTHIRD_PLACE: durationSeconds,
    stageDurationFINAL: durationSeconds,
    stageDurationSUDDEN_DEATH: durationSeconds,
  })
  .transform((value) => {
    const simulation = [
      value.simulationDuration1,
      value.simulationDuration2,
      value.simulationDuration3,
    ];

    const stageEntries: Array<[string, number | undefined]> = [
      ['R64', value.stageDurationR64],
      ['R32', value.stageDurationR32],
      ['R16', value.stageDurationR16],
      ['QF', value.stageDurationQF],
      ['SF', value.stageDurationSF],
      ['THIRD_PLACE', value.stageDurationTHIRD_PLACE],
      ['FINAL', value.stageDurationFINAL],
      ['SUDDEN_DEATH', value.stageDurationSUDDEN_DEATH],
    ];

    const stages: Record<string, number> = {};
    for (const [stage, seconds] of stageEntries) {
      if (seconds !== undefined) stages[stage] = seconds;
    }

    // A partially-filled simulation list would serialise holes as null and fail
    // the module's positive-integer check, so it is only sent when complete.
    const simulationComplete = simulation.every(
      (seconds): seconds is number => typeof seconds === 'number',
    );

    return {
      thirdPlaceEnabled: value.thirdPlaceEnabled,
      evaluationProfiles: value.evaluationProfiles,
      roundDurations: {
        ...(simulationComplete ? { simulation } : {}),
        ...(Object.keys(stages).length > 0 ? { stages } : {}),
      },
    };
  });

export type ConfigureTournamentFormInput = z.infer<
  typeof configureTournamentFormSchema
>;

export const startSuddenDeathSchema = z.object({
  matchId: z.string().uuid('Invalid match'),
  problemId: z.string().uuid('Invalid problem'),
});

export const removeRegistrationSchema = z.object({
  tournamentId: z.string().uuid('Invalid tournament'),
  userId: z.string().uuid('Invalid competitor'),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
});

export const adminPaymentIdSchema = z.object({
  paymentId: z.string().uuid('Invalid payment'),
});

export const listPaymentsSchema = z.object({
  tournamentId: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().uuid('Invalid tournament').optional(),
    )
    .optional(),
  status: z
    .preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.enum(['CREATED', 'PENDING', 'PAID', 'FAILED', 'REFUNDED']).optional(),
    )
    .optional(),
  user: optionalText(120),
  take: z.coerce.number().int().positive().max(200).optional(),
});

export const paymentAdminMutationSchema = z.object({
  paymentId: z.string().uuid('Invalid payment'),
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
