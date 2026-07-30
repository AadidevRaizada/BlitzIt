'use server';

import { revalidatePath } from 'next/cache';
import { requireUserOrThrow } from '@/server/modules/auth';
import { completeOnboarding } from '@/server/modules/auth/onboarding';
import { onboardingSchema } from '@/lib/validation/onboarding.schema';
import { ok, toErr, type Result } from '@/lib/errors';
import { captureException } from '@/lib/observability';

export async function completeOnboardingAction(
  _prevState: unknown,
  formData: FormData,
): Promise<Result<{ username: string }>> {
  try {
    const user = await requireUserOrThrow();
    const parsed = onboardingSchema.safeParse({
      username: formData.get('username'),
      displayName: formData.get('displayName'),
      city: formData.get('city'),
      termsAccepted: formData.get('termsAccepted') === 'on',
    });

    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message:
            parsed.error.issues[0]?.message ??
            'Please check the form and try again',
        },
      };
    }

    const updated = await completeOnboarding(user.id, parsed.data);
    revalidatePath('/onboarding');
    revalidatePath('/dashboard');
    revalidatePath('/settings');
    revalidatePath(`/u/${updated.username}`);

    return ok({ username: updated.username });
  } catch (error) {
    captureException(error, { where: 'completeOnboardingAction' });
    return toErr(error);
  }
}
