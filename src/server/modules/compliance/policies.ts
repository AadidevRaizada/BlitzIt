import 'server-only';
import type { Payment } from '@/generated/prisma/client';

export const CURRENT_TERMS_VERSION = '2026-07-26';

export interface RefundPolicyDecision {
  allowed: boolean;
  reason: string;
}

/**
 * Refund policy seam (E9.7).
 *
 * The first implementation is deliberately small: paid, non-refunded payments
 * may enter the gateway refund flow. Keeping this as a function gives later
 * legal/ops work one documented hook without scattering policy checks through
 * admin actions.
 */
export function evaluateRefundPolicy(
  payment: Pick<Payment, 'status' | 'providerPaymentId'>,
): RefundPolicyDecision {
  if (payment.status === 'REFUNDED') {
    return { allowed: false, reason: 'Payment is already refunded' };
  }
  if (payment.status !== 'PAID') {
    return { allowed: false, reason: 'Only paid payments can be refunded' };
  }
  if (!payment.providerPaymentId) {
    return {
      allowed: false,
      reason: 'Payment has no provider payment id to refund',
    };
  }
  return { allowed: true, reason: 'Paid payment is eligible for refund' };
}
