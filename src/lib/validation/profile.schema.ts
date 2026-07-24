import { z } from 'zod';

/**
 * Profile validation — shared by the client form and the Server Action, so both
 * sides enforce identical rules.
 */

/** Optional free-text field: '' from a form input becomes null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional();

export const usernameSchema = z
  .string()
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(24, 'Username must be at most 24 characters')
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Use lowercase letters, numbers and hyphens only',
  );

export const updateProfileSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1, 'Display name is required').max(50),
  bio: optionalText(280),
  city: optionalText(80),
  githubUsername: optionalText(39),
  twitterHandle: optionalText(15),
  websiteUrl: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (v.length === 0 ? null : v))
    .nullable()
    .optional()
    .refine(
      (v) => v === null || v === undefined || /^https?:\/\/.+/.test(v),
      'Website must start with http:// or https://',
    ),
});

export type UpdateProfileInput = z.input<typeof updateProfileSchema>;
export type UpdateProfileData = z.output<typeof updateProfileSchema>;
