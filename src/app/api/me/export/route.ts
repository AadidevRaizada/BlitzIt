import { NextResponse } from 'next/server';
import { requireUserOrThrow } from '@/server/modules/auth';
import { exportUserData } from '@/server/modules/compliance';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUserOrThrow();
    const data = await exportUserData(user.id);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="blitzit-export-${user.username}.json"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHORIZED') {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 401 },
      );
    }
    throw error;
  }
}
