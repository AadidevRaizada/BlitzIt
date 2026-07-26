import { NextResponse } from 'next/server';
import { processRazorpayWebhook } from '@/server/modules/payment';
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
