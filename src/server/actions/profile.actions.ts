'use server';

import { revalidatePath } from 'next/cache';
import { requireUserOrThrow } from '@/server/modules/auth';
import { updateProfile as updateProfileService } from '@/server/modules/auth/profile';
import { updateProfileSchema } from '@/lib/validation/profile.schema';
import { ok, toErr, type Result } from '@/lib/errors';
import { captureException } from '@/lib/observability';

/**
 * Update the signed-in user's profile.
 *
 * Thin adapter: validate (zod) → authorize (session) → delegate to the module →
 * revalidate. Returns a typed Result rather than throwing across the boundary.
 */
export async function updateProfileAction(
  _prevState: unknown,
  formData: FormData,
): Promise<Result<{ username: string }>> {
  try {
    const user = await requireUserOrThrow();

    const parsed = updateProfileSchema.safeParse({
      username: formData.get('username'),
      displayName: formData.get('displayName'),
      bio: formData.get('bio'),
      city: formData.get('city'),
      githubUsername: formData.get('githubUsername'),
      twitterHandle: formData.get('twitterHandle'),
      websiteUrl: formData.get('websiteUrl'),
    });

    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: first?.message ?? 'Please check the form and try again',
        },
      };
    }

    // Authorization: always the caller's own row, never a client-supplied id.
    const updated = await updateProfileService(user.id, parsed.data);

    revalidatePath('/settings');
    revalidatePath(`/u/${updated.username}`);
    if (updated.username !== user.username) {
      revalidatePath(`/u/${user.username}`);
    }

    return ok({ username: updated.username });
  } catch (error) {
    captureException(error, { where: 'updateProfileAction' });
    return toErr(error);
  }
}
