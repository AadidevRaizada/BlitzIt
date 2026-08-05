'use server';

import { revalidatePath } from 'next/cache';
import { requireUserOrThrow } from '@/server/modules/auth';
import {
  PaymentGatewayNotConfiguredError,
  confirmCheckout,
  createPassOrder,
} from '@/server/modules/payment';
import { assertRateLimit } from '@/server/ops/rate-limit';
import {
  confirmCheckoutSchema,
  createPassOrderSchema,
} from '@/lib/validation/payment.schema';
import { err, ok, toErr, type Err, type Result } from '@/lib/errors';
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
    return gatewayDown(error) ?? toErr(error);
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
    return gatewayDown(error) ?? toErr(error);
  }
}

/**
 * A missing gateway configuration, said out loud to the competitor.
 *
 * `toErr` would flatten it to "Unexpected error", which invites someone to try
 * again and again against an outage no retry can fix. This names it as ours
 * without leaking which variable an operator forgot.
 */
function gatewayDown(error: unknown): Err | null {
  if (!(error instanceof PaymentGatewayNotConfiguredError)) return null;
  return err(
    'PAYMENT_FAILED',
    'Payments are temporarily unavailable. Nothing was charged - please try again shortly.',
  );
}
