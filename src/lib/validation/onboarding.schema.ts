import { z } from 'zod';
import { usernameSchema } from './profile.schema';

export const onboardingSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1, 'Display name is required').max(50),
  city: z.string().trim().min(1, 'City is required').max(80),
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: 'Accept the rules and terms to continue' }),
  }),
});

export type OnboardingInput = z.input<typeof onboardingSchema>;
export type OnboardingData = z.output<typeof onboardingSchema>;
