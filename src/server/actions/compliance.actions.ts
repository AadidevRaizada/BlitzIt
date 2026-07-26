'use server';

import { headers } from 'next/headers';
import { requireUserOrThrow } from '@/server/modules/auth';
import { acceptTerms, exportUserData } from '@/server/modules/compliance';
import { ok, toErr, type Result } from '@/lib/errors';
import { captureException } from '@/lib/observability';

export async function acceptCurrentTermsAction(): Promise<
  Result<{ version: string; acceptedAt: Date }>
> {
  try {
    const user = await requireUserOrThrow();
    const h = await headers();
    const result = await acceptTerms({
      userId: user.id,
      ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
      userAgent: h.get('user-agent'),
    });
    return ok(result);
  } catch (error) {
    captureException(error, { where: 'acceptCurrentTermsAction' });
    return toErr(error);
  }
}

export async function exportMyDataAction(): Promise<
  Result<Awaited<ReturnType<typeof exportUserData>>>
> {
  try {
    const user = await requireUserOrThrow();
    return ok(await exportUserData(user.id));
  } catch (error) {
    captureException(error, { where: 'exportMyDataAction' });
    return toErr(error);
  }
}
