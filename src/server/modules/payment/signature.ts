import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Razorpay signature checks (E9).
 *
 * Both checkout callbacks and webhooks are rejected before any state mutation.
 * `timingSafeEqual` keeps the comparison constant-time once the expected and
 * received buffers are the same length.
 */

export function hmacSha256Hex(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyHmacSha256Hex(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = Buffer.from(hmacSha256Hex(payload, secret), 'hex');
  const received = Buffer.from(signature, 'hex');
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

export function checkoutSignaturePayload(
  orderId: string,
  paymentId: string,
): string {
  return `${orderId}|${paymentId}`;
}
