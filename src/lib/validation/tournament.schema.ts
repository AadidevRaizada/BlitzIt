import { z } from 'zod';
import { SUPPORTED_BRACKET_SIZES } from '@/server/modules/tournament/config.public';

/**
 * Shared tournament schemas (E3).
 *
 * Lives in `lib/validation` so the same rules run on the client and the server
 * and cannot drift. Nothing here imports server-only code — the bracket-size
 * list comes from `config.public`, which is the isomorphic half of the
 * tournament configuration module.
 */

const slugSchema = z
  .string()
  .min(3, 'Slug must be at least 3 characters')
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Slug may contain lowercase letters, numbers and single hyphens',
  );

const bracketSizeSchema = z
  .number()
  .int()
  .refine(
    (value) => (SUPPORTED_BRACKET_SIZES as readonly number[]).includes(value),
    { message: 'Bracket size must be 8, 16, 32 or 64 (D6)' },
  );

/** Optional UTC timestamp accepted as a Date or an ISO string. */
const timestampSchema = z.preprocess((value) => {
  if (value === '' || value === null) return undefined;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed;
  }
  return value;
}, z.date().optional());

export const createTournamentSchema = z.object({
  slug: slugSchema,
  name: z.string().min(3, 'Name must be at least 3 characters').max(120),
  passPriceMinor: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  bracketSize: bracketSizeSchema.optional(),
  thirdPlaceEnabled: z.boolean().optional(),
  minRegistrations: z.number().int().min(0).optional(),
  maxRegistrations: z.number().int().positive().optional(),
  timezoneDisplay: z.string().min(1).optional(),
  youtubeStreamUrl: z.string().url().optional(),
});

export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;

/**
 * Schedule. Stored in UTC (D8) and validated for order, because an
 * out-of-order schedule would let cron fire transitions in the wrong sequence.
 */
export const tournamentScheduleSchema = z
  .object({
    registrationOpensAt: timestampSchema,
    registrationClosesAt: timestampSchema,
    simulationOpensAt: timestampSchema,
    simulationClosesAt: timestampSchema,
    liveStartsAt: timestampSchema,
  })
  .refine(
    (value) => ordered(value.registrationOpensAt, value.registrationClosesAt),
    {
      message: 'Registration must close after it opens',
      path: ['registrationClosesAt'],
    },
  )
  .refine(
    (value) => ordered(value.registrationClosesAt, value.simulationOpensAt),
    {
      message: 'Simulation must open after registration closes',
      path: ['simulationOpensAt'],
    },
  )
  .refine(
    (value) => ordered(value.simulationOpensAt, value.simulationClosesAt),
    {
      message: 'Simulation must close after it opens',
      path: ['simulationClosesAt'],
    },
  )
  .refine((value) => ordered(value.simulationClosesAt, value.liveStartsAt), {
    message: 'The knockout stage must start after simulation closes',
    path: ['liveStartsAt'],
  });

function ordered(earlier?: Date, later?: Date): boolean {
  if (!earlier || !later) return true;
  return earlier.getTime() < later.getTime();
}

export type TournamentScheduleInput = z.infer<typeof tournamentScheduleSchema>;

export const updateTournamentSchema = createTournamentSchema
  .partial()
  .omit({ slug: true });

export type UpdateTournamentInput = z.infer<typeof updateTournamentSchema>;

/** Per-tournament round durations (D7). Both halves optional. */
export const roundDurationsSchema = z.object({
  simulation: z.array(z.number().int().positive()).optional(),
  stages: z.record(z.string(), z.number().int().positive()).optional(),
});

export const configureTournamentSchema = z.object({
  bracketSize: bracketSizeSchema.nullable().optional(),
  thirdPlaceEnabled: z.boolean().optional(),
  minRegistrations: z.number().int().min(0).optional(),
  maxRegistrations: z.number().int().positive().optional(),
  roundDurations: roundDurationsSchema.optional(),
  /** D20 stage → evaluation-profile overrides; validated by the tournament module. */
  evaluationProfiles: z.unknown().optional(),
});

export type ConfigureTournamentInput = z.infer<
  typeof configureTournamentSchema
>;

export const TOURNAMENT_TRANSITION_NAMES = [
  'PUBLISH',
  'OPEN_REGISTRATION',
  'CLOSE_REGISTRATION',
  'START_SIMULATION',
  'CLOSE_SIMULATION',
  'GENERATE_BRACKET',
  'START_KNOCKOUT',
  'ADVANCE_STAGE',
  'COMPLETE',
  'CANCEL',
] as const;

export const transitionTournamentSchema = z.object({
  tournamentId: z.string().uuid(),
  transition: z.enum(TOURNAMENT_TRANSITION_NAMES),
  reason: z.string().max(500).optional(),
  force: z.boolean().optional(),
});

export type TransitionTournamentInput = z.infer<
  typeof transitionTournamentSchema
>;

export const tournamentIdSchema = z.object({
  tournamentId: z.string().uuid(),
});
