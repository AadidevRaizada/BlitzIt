import { toNextJsHandler } from 'better-auth/next-js';
import { NextResponse } from 'next/server';
import { auth } from '@/server/auth';
import { assertRateLimit, clientIpFromHeaders } from '@/server/ops/rate-limit';
import { AppError } from '@/lib/errors';

/** Better Auth endpoints: OAuth start/callback, session, sign-out. */
const handlers = toNextJsHandler(auth);

export async function GET(request: Request) {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  return handlers.GET(request);
}

export async function POST(request: Request) {
  const limited = rateLimitResponse(request);
  if (limited) return limited;
  return handlers.POST(request);
}

function rateLimitResponse(request: Request): NextResponse | null {
  try {
    assertRateLimit('auth', clientIpFromHeaders(request.headers));
    return null;
  } catch (error) {
    if (error instanceof AppError && error.code === 'RATE_LIMITED') {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 429 },
      );
    }
    throw error;
  }
}
