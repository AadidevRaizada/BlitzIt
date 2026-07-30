import { z } from 'zod';

export const adminPlatformSettingsSchema = z.object({
  communityWhatsAppUrl: z
    .string()
    .trim()
    .max(200)
    .transform((value) => (value.length === 0 ? null : value))
    .refine(
      (value) =>
        value === null ||
        /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+$/.test(value),
      'Community link must start with https://chat.whatsapp.com/',
    ),
});

export type AdminPlatformSettingsData = z.output<
  typeof adminPlatformSettingsSchema
>;
