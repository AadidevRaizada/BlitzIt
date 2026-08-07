import 'server-only';
import { request } from 'undici';
import { serverEnv } from '@/lib/env';

export type RazorpayPaymentState =
  'created' | 'authorized' | 'captured' | 'failed' | 'refunded';

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

export interface RazorpayPayment {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: RazorpayPaymentState;
}

export interface RazorpayRefund {
  id: string;
  paymentId: string;
  amount: number;
  currency: string;
  status: string;
}

export interface RazorpayGateway {
  createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
  }): Promise<RazorpayOrder>;
  fetchPayment(paymentId: string): Promise<RazorpayPayment>;
  refund(input: {
    paymentId: string;
    amountMinor: number;
    idempotencyKey?: string;
  }): Promise<RazorpayRefund>;
}

export const FAKE_RAZORPAY_KEY_ID = 'rzp_test_fake_blitzit';
export const FAKE_RAZORPAY_SECRET = 'blitzit-fake-razorpay-secret';
export const FAKE_RAZORPAY_WEBHOOK_SECRET =
  'blitzit-fake-razorpay-webhook-secret';

function basicAuth(keyId: string, keySecret: string): string {
  return Buffer.from(`${keyId}:${keySecret}`).toString('base64');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export class HttpRazorpayGateway implements RazorpayGateway {
  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
  ) {}

  async createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
  }): Promise<RazorpayOrder> {
    const response = await request('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        authorization: `Basic ${basicAuth(this.keyId, this.keySecret)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt,
      }),
    });
    if (response.statusCode >= 400) {
      throw new Error(`Razorpay order create failed (${response.statusCode})`);
    }
    const body = asRecord(await response.body.json());
    return {
      id: String(body.id),
      amount: Number(body.amount),
      currency: String(body.currency),
      receipt: String(body.receipt),
      status: String(body.status),
    };
  }

  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    const response = await request(
      `https://api.razorpay.com/v1/payments/${paymentId}`,
      {
        headers: {
          authorization: `Basic ${basicAuth(this.keyId, this.keySecret)}`,
        },
      },
    );
    if (response.statusCode >= 400) {
      throw new Error(`Razorpay payment fetch failed (${response.statusCode})`);
    }
    const body = asRecord(await response.body.json());
    return {
      id: String(body.id),
      orderId: String(body.order_id),
      amount: Number(body.amount),
      currency: String(body.currency),
      status: String(body.status) as RazorpayPaymentState,
    };
  }

  async refund(input: {
    paymentId: string;
    amountMinor: number;
    idempotencyKey?: string;
  }): Promise<RazorpayRefund> {
    const response = await request(
      `https://api.razorpay.com/v1/payments/${input.paymentId}/refund`,
      {
        method: 'POST',
        headers: {
          authorization: `Basic ${basicAuth(this.keyId, this.keySecret)}`,
          'content-type': 'application/json',
          ...(input.idempotencyKey
            ? { 'x-razorpay-idempotency-key': input.idempotencyKey }
            : {}),
        },
        body: JSON.stringify({ amount: input.amountMinor }),
      },
    );
    if (response.statusCode >= 400) {
      throw new Error(`Razorpay refund failed (${response.statusCode})`);
    }
    const body = asRecord(await response.body.json());
    return {
      id: String(body.id),
      paymentId: input.paymentId,
      amount: Number(body.amount),
      currency: String(body.currency),
      status: String(body.status),
    };
  }
}

export class FakeRazorpayGateway implements RazorpayGateway {
  private orders = new Map<string, RazorpayOrder>();
  private payments = new Map<string, RazorpayPayment>();
  private refunds = new Map<string, RazorpayRefund>();
  private orderSeq = 0;
  private paymentSeq = 0;
  private refundSeq = 0;

  async createOrder(input: {
    amountMinor: number;
    currency: string;
    receipt: string;
  }): Promise<RazorpayOrder> {
    const order: RazorpayOrder = {
      id: `order_fake_${++this.orderSeq}`,
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt,
      status: 'created',
    };
    this.orders.set(order.id, order);
    return order;
  }

  async fetchPayment(paymentId: string): Promise<RazorpayPayment> {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error(`fake payment ${paymentId} not found`);
    return payment;
  }

  async refund(input: {
    paymentId: string;
    amountMinor: number;
    idempotencyKey?: string;
  }): Promise<RazorpayRefund> {
    if (input.idempotencyKey) {
      const existing = this.refunds.get(input.idempotencyKey);
      if (existing) return existing;
    }
    const payment = await this.fetchPayment(input.paymentId);
    payment.status = 'refunded';
    this.payments.set(payment.id, payment);
    const refund = {
      id: `rfnd_fake_${++this.refundSeq}`,
      paymentId: input.paymentId,
      amount: input.amountMinor,
      currency: payment.currency,
      status: 'processed',
    };
    if (input.idempotencyKey) this.refunds.set(input.idempotencyKey, refund);
    return refund;
  }

  simulatePayment(
    orderId: string,
    status: Exclude<RazorpayPaymentState, 'created'> = 'captured',
  ): RazorpayPayment {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`fake order ${orderId} not found`);
    const payment: RazorpayPayment = {
      id: `pay_fake_${++this.paymentSeq}`,
      orderId,
      amount: order.amount,
      currency: order.currency,
      status,
    };
    this.payments.set(payment.id, payment);
    return payment;
  }

  setPaymentStatus(paymentId: string, status: RazorpayPaymentState): void {
    const payment = this.payments.get(paymentId);
    if (!payment) throw new Error(`fake payment ${paymentId} not found`);
    payment.status = status;
  }
}

const fakeGateway = new FakeRazorpayGateway();

export function razorpayFakeModeEnabled(): boolean {
  return (
    process.env.RAZORPAY_USE_FAKE === 'true' &&
    process.env.NODE_ENV !== 'production'
  );
}

/**
 * The gateway has no credentials.
 *
 * A distinct type because this is an operator problem, not a caller problem,
 * and the two want opposite handling: a caller error is final, whereas this one
 * fixes itself the moment the environment is corrected. It used to be a bare
 * `Error`, so the webhook answered Razorpay with an opaque 500 "retryable
 * server error" — indistinguishable from a crash, and silent about the one
 * thing anybody needed to know.
 */
export class PaymentGatewayNotConfiguredError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `Razorpay is not configured: ${missing.join(', ')} missing. ` +
        'Set them in the deployment environment (or RAZORPAY_USE_FAKE=true outside production).',
    );
    this.name = 'PaymentGatewayNotConfiguredError';
    this.missing = missing;
  }
}

function requireRazorpayCredentials(): {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
} {
  const {
    RAZORPAY_KEY_ID: keyId,
    RAZORPAY_KEY_SECRET: keySecret,
    RAZORPAY_WEBHOOK_SECRET: webhookSecret,
  } = serverEnv();

  // Every missing variable is reported at once. Naming them one at a time turns
  // a single misconfiguration into three deploys.
  const missing = [
    !keyId && 'RAZORPAY_KEY_ID',
    !keySecret && 'RAZORPAY_KEY_SECRET',
    !webhookSecret && 'RAZORPAY_WEBHOOK_SECRET',
  ].filter((name): name is string => typeof name === 'string');

  // Written as three explicit checks rather than `missing.length > 0` so the
  // compiler can see they are set on the way out.
  if (!keyId || !keySecret || !webhookSecret) {
    throw new PaymentGatewayNotConfiguredError(missing);
  }

  return { keyId, keySecret, webhookSecret };
}

export function getRazorpayGateway(): RazorpayGateway {
  if (razorpayFakeModeEnabled()) {
    return fakeGateway;
  }
  const env = requireRazorpayCredentials();
  return new HttpRazorpayGateway(env.keyId, env.keySecret);
}

export function getFakeRazorpayGateway(): FakeRazorpayGateway {
  return fakeGateway;
}

export function razorpayKeyId(): string {
  if (razorpayFakeModeEnabled()) return FAKE_RAZORPAY_KEY_ID;
  return requireRazorpayCredentials().keyId;
}

export function checkoutSecret(): string {
  if (razorpayFakeModeEnabled()) return FAKE_RAZORPAY_SECRET;
  return requireRazorpayCredentials().keySecret;
}

export function webhookSecret(): string {
  if (razorpayFakeModeEnabled()) return FAKE_RAZORPAY_WEBHOOK_SECRET;
  return requireRazorpayCredentials().webhookSecret;
}
