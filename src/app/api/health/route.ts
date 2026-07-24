import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { runnerHeartbeat } from '@/server/jobs/runner';

export const dynamic = 'force-dynamic';

/**
 * Liveness/readiness for Railway. Checks the DB connection and reports the
 * in-process runner heartbeat. Returns 200 only if the DB is reachable.
 */
export async function GET() {
  const startedAt = Date.now();
  let dbOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const heartbeat = runnerHeartbeat();
  const runnerAgeMs = heartbeat === 0 ? null : Date.now() - heartbeat;

  const body = {
    status: dbOk ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    checks: {
      db: dbOk,
      runner: {
        started: heartbeat !== 0,
        lastHeartbeatAgeMs: runnerAgeMs,
      },
    },
    latencyMs: Date.now() - startedAt,
  };

  return NextResponse.json(body, { status: dbOk ? 200 : 503 });
}
