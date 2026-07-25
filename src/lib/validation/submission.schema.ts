import { z } from 'zod';

/**
 * Shared submission schemas (E4).
 *
 * These are the *shape* rules — the ones a browser can check to give instant
 * feedback. The *domain* rules (github.com only, https only, publicly
 * reachable host, category enabled) live in
 * `server/modules/submission/validation.ts` and run again on the server, where
 * they are the ones that actually decide. Nothing here is trusted.
 */

const urlField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(2048, `${label} is too long`)
    .url(`${label} must be a valid URL`);

export const submitSolutionSchema = z.object({
  roundId: z.string().uuid('Invalid round'),
  repoUrl: urlField('Repository URL'),
  deploymentUrl: urlField('Deployment URL'),
  commitSha: z
    .string()
    .trim()
    .regex(
      /^[0-9a-fA-F]{7,40}$/,
      'Commit SHA must be 7–40 hexadecimal characters',
    )
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export type SubmitSolutionInput = z.infer<typeof submitSolutionSchema>;

export const submissionIdSchema = z.object({
  submissionId: z.string().uuid('Invalid submission'),
});

export const roundIdSchema = z.object({
  roundId: z.string().uuid('Invalid round'),
});

export const listSubmissionsSchema = z.object({
  tournamentId: z.string().uuid().optional(),
  take: z.number().int().positive().max(200).optional(),
});

export const disqualifySubmissionSchema = z.object({
  submissionId: z.string().uuid('Invalid submission'),
  reason: z.string().trim().min(3, 'A reason is required').max(500),
});
