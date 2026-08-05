import { NextResponse } from 'next/server';
import {
  PaymentGatewayNotConfiguredError,
  processRazorpayWebhook,
} from '@/server/modules/payment';
import { checkRateLimit, clientIpFromHeaders } from '@/server/ops/rate-limit';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  checkRateLimit('webhook-observe', clientIpFromHeaders(request.headers));
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  try {
    const result = await processRazorpayWebhook(rawBody, signature);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    /*
     * No credentials means we cannot verify a signature, so we must not accept
     * the event — but this is our fault, not Razorpay's, and it is fixed by an
     * environment change rather than a redeploy of their request. 503 says
     * exactly that and keeps Razorpay retrying, so events queued during the
     * outage still land once the secret is set.
     *
     * Previously this fell through to the generic branch below and answered
     * with an opaque 500 "retryable server error", which is what a genuine
     * crash returns — so a completely unconfigured gateway looked identical to
     * a bug, and every payment silently failed to settle.
     */
    if (error instanceof PaymentGatewayNotConfiguredError) {
      captureException(error, {
        where: 'razorpayWebhook',
        missing: error.missing.join(','),
      });
      return NextResponse.json(
        { ok: false, error: 'payment gateway is not configured' },
        { status: 503, headers: { 'retry-after': '300' } },
      );
    }

    if (error instanceof AppError) {
      const status =
        error.code === 'FORBIDDEN'
          ? 401
          : error.code === 'VALIDATION'
            ? 400
            : error.code === 'NOT_FOUND'
              ? 200
              : 409;
      return NextResponse.json(
        { ok: status === 200, error: error.message },
        { status },
      );
    }
    captureException(error, { where: 'razorpayWebhook' });
    return NextResponse.json(
      { ok: false, error: 'retryable server error' },
      { status: 500 },
    );
  }
}
