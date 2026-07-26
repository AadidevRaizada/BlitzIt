import { z } from 'zod';
import { db } from '@/server/db';
import {
  getLiveSnapshot,
  type LiveSnapshot,
} from '@/server/modules/tournament';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * `GET /api/live/[tournamentId]` — the live spectator feed (E7.3).
 *
 * Two transports, one payload:
 *
 * | Request | Response |
 * |---|---|
 * | default | `text/event-stream` — a `snapshot` event on connect, then one on every change |
 * | `?mode=poll` | `application/json` — a single snapshot |
 *
 * The polling fallback is not a degraded mode: it returns the identical
 * `LiveSnapshot`, so a client behind a proxy that mangles SSE sees exactly the
 * same data a little less promptly.
 *
 * **Public by design** (D10 — the landing page is the spectator experience).
 * The snapshot therefore carries only already-public facts, and withholds the
 * challenge of any round that has not opened. Unlisted tournaments 404 outright.
 *
 * This is a Route Handler rather than a Server Action because it streams and
 * has an external caller (`EventSource`) — exactly the split
 * `docs/05-api-architecture.md` describes.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const paramsSchema = z.object({
  tournamentId: z.string().uuid(),
});

/** Sleep that wakes early when the client goes away. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function sseFrame(event: string, data: unknown): string {
  // A payload must never contain a bare newline mid-frame, so it is serialised
  // as one JSON line. `JSON.stringify` escapes any newline inside the data.
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ tournamentId: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return Response.json(
      { error: { code: 'VALIDATION', message: 'Invalid tournament id' } },
      { status: 400 },
    );
  }
  const { tournamentId } = parsed.data;

  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, visibility: true },
  });
  // An unlisted tournament is a rehearsal: it must not be observable from a
  // public URL, and "does not exist" is the only answer that does not confirm
  // one is running.
  if (!tournament || tournament.visibility === 'UNLISTED') {
    return Response.json(
      { error: { code: 'NOT_FOUND', message: 'No such tournament' } },
      { status: 404 },
    );
  }

  const env = serverEnv();
  const url = new URL(request.url);

  if (url.searchParams.get('mode') === 'poll') {
    const snapshot = await getLiveSnapshot(tournamentId, {
      leaderboardTake: env.LIVE_LEADERBOARD_TAKE,
    });
    return Response.json(snapshot, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const encoder = new TextEncoder();
  const signal = request.signal;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The client vanished between the abort check and the write.
          open = false;
        }
      };

      // Tell the browser how long to wait before reconnecting. EventSource
      // reconnects on its own; this just keeps a herd of tabs from stampeding.
      send(`retry: 5000\n\n`);

      const startedAt = Date.now();
      let lastVersion: string | null = null;
      let lastHeartbeat = Date.now();

      try {
        while (open && !signal.aborted) {
          let snapshot: LiveSnapshot;
          try {
            snapshot = await getLiveSnapshot(tournamentId, {
              leaderboardTake: env.LIVE_LEADERBOARD_TAKE,
            });
          } catch (error) {
            // A transient read failure must not kill the stream — the client
            // would reconnect anyway, and a blip during a live event should
            // cost one interval, not a reconnect storm.
            logger.warn(
              {
                tournamentId,
                err: error instanceof Error ? error.message : String(error),
              },
              'live snapshot read failed; retrying next interval',
            );
            await sleep(env.LIVE_STREAM_POLL_MS, signal);
            continue;
          }

          if (snapshot.version !== lastVersion) {
            send(sseFrame('snapshot', snapshot));
            lastVersion = snapshot.version;
            lastHeartbeat = Date.now();
          } else if (
            Date.now() - lastHeartbeat >=
            env.LIVE_STREAM_HEARTBEAT_MS
          ) {
            // A comment frame: ignored by EventSource, but enough traffic to
            // stop an idle-timeout proxy from cutting a quiet stream.
            send(`: heartbeat ${new Date().toISOString()}\n\n`);
            lastHeartbeat = Date.now();
          }

          if (Date.now() - startedAt >= env.LIVE_STREAM_MAX_DURATION_MS) {
            send(sseFrame('reconnect', { reason: 'max-duration' }));
            break;
          }

          await sleep(env.LIVE_STREAM_POLL_MS, signal);
        }
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed by the runtime when the client disconnected.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // nginx buffers proxied responses by default, which would hold every
      // frame until the stream ends — the exact opposite of the point.
      'X-Accel-Buffering': 'no',
    },
  });
}
