'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/server/modules/auth';
import { updateCommunityWhatsAppUrl } from '@/server/modules/admin/settings';
import { adminPlatformSettingsSchema } from '@/lib/validation/admin-settings.schema';
import { ok, toErr, type Result } from '@/lib/errors';
import { captureException } from '@/lib/observability';

export async function updatePlatformSettingsAction(
  _prevState: unknown,
  formData: FormData,
): Promise<Result<{ communityWhatsAppUrl: string | null }>> {
  try {
    await requireAdminOrThrow();
    const parsed = adminPlatformSettingsSchema.safeParse({
      communityWhatsAppUrl: formData.get('communityWhatsAppUrl'),
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

    const settings = await updateCommunityWhatsAppUrl(
      parsed.data.communityWhatsAppUrl,
    );
    revalidatePath('/admin/settings');
    revalidatePath('/');
    revalidatePath('/dashboard');
    return ok(settings);
  } catch (error) {
    captureException(error, { where: 'updatePlatformSettingsAction' });
    return toErr(error);
  }
}
