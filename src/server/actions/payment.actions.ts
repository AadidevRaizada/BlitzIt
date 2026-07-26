'use server';

import { revalidatePath } from 'next/cache';
import { requireUserOrThrow } from '@/server/modules/auth';
import { confirmCheckout, createPassOrder } from '@/server/modules/payment';
import { assertRateLimit } from '@/server/ops/rate-limit';
import {
  confirmCheckoutSchema,
  createPassOrderSchema,
} from '@/lib/validation/payment.schema';
import { err, ok, toErr, type Result } from '@/lib/errors';
import { captureException } from '@/lib/observability';

export async function createPassOrderAction(input: unknown): Promise<
  Result<{
    paymentId: string;
    razorpayKeyId: string;
    orderId: string;
    amountMinor: number;
    currency: string;
    reused: boolean;
  }>
> {
  try {
    const user = await requireUserOrThrow();
    assertRateLimit('payment-order', user.id);
    const parsed = createPassOrderSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        'VALIDATION',
        parsed.error.issues[0]?.message ?? 'Invalid checkout request',
      );
    }

    const order = await createPassOrder(parsed.data.tournamentId, user.id, {
      actorId: user.id,
    });
    return ok(order);
  } catch (error) {
    captureException(error, { where: 'createPassOrderAction' });
    return toErr(error);
  }
}

export async function confirmCheckoutAction(input: unknown): Promise<
  Result<{
    paymentId: string;
    registrationId: string | null;
    participantCount: number | null;
    applied: boolean;
  }>
> {
  try {
    await requireUserOrThrow();
    const parsed = confirmCheckoutSchema.safeParse(input);
    if (!parsed.success) {
      return err(
        'VALIDATION',
        parsed.error.issues[0]?.message ?? 'Invalid checkout confirmation',
      );
    }

    const result = await confirmCheckout(parsed.data);
    revalidatePath('/dashboard');
    revalidatePath('/tournaments');
    return ok({
      paymentId: result.payment.id,
      registrationId: result.registrationId,
      participantCount: result.participantCount,
      applied: result.applied,
    });
  } catch (error) {
    captureException(error, { where: 'confirmCheckoutAction' });
    return toErr(error);
  }
}
