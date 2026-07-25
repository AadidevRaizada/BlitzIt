import { NextResponse } from 'next/server';
import { db } from '@/server/db';
import { runnerHeartbeat, runnerStarted } from '@/server/jobs/runner';

export const dynamic = 'force-dynamic';

/**
 * Liveness/readiness for Railway. Checks the DB connection and reports the
 * in-process runner heartbeat. Returns 200 only if the DB is reachable.
 */
export async function GET() {
  const startedAt = Date.now();
  let dbOk = false;
  let schemaOk = false;
  try {
    await db.$queryRaw`SELECT 1`;
    dbOk = true;
    // Connectivity alone is not readiness: a deploy that never ran migrations
    // answers SELECT 1 happily and then fails on the first real query. Touch a
    // core table (LIMIT 1, so it stays cheap) to prove the schema is applied.
    await db.$queryRaw`SELECT 1 FROM "User" LIMIT 1`;
    schemaOk = true;
  } catch {
    // dbOk keeps whatever it reached; schemaOk stays false.
  }

  const healthy = dbOk && schemaOk;

  const heartbeat = runnerHeartbeat();
  const runnerAgeMs = heartbeat === 0 ? null : Date.now() - heartbeat;

  const body = {
    status: healthy ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    checks: {
      db: dbOk,
      schema: schemaOk,
      runner: {
        started: runnerStarted(),
        lastHeartbeatAgeMs: runnerAgeMs,
      },
    },
    latencyMs: Date.now() - startedAt,
  };

  return NextResponse.json(body, { status: healthy ? 200 : 503 });
}
