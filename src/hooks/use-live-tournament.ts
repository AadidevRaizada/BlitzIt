'use client';

import { useEffect, useRef, useState } from 'react';
import type { LiveSnapshot } from '@/server/modules/tournament/live';

/**
 * Subscribe to `/api/live/[tournamentId]` (E7.3).
 *
 * SSE first, polling second. The fallback is not an afterthought: corporate
 * proxies, some mobile networks and a few CDNs buffer or drop `text/event-
 * stream`, and a spectator on one of those must still see a live event. Both
 * paths return the same `LiveSnapshot`, so nothing downstream knows which one
 * is in use.
 *
 * The hook holds a snapshot, not a subscription list — a component re-renders
 * when the data changes and that is the whole contract.
 *
 * The type import is type-only, so no `server-only` module is pulled into the
 * client bundle.
 */

export type LiveConnection =
  | 'connecting'
  | 'live'
  /** SSE failed; the same data is being fetched on an interval instead. */
  | 'polling'
  | 'offline';

export interface UseLiveTournament {
  snapshot: LiveSnapshot | null;
  connection: LiveConnection;
  /** Bumps whenever a genuinely new snapshot arrives. */
  version: string | null;
}

/** How many SSE failures to tolerate before switching to polling for good. */
const SSE_FAILURE_LIMIT = 2;
const POLL_INTERVAL_MS = 5000;

export function useLiveTournament(
  tournamentId: string,
  initial: LiveSnapshot | null = null,
): UseLiveTournament {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(initial);
  const [connection, setConnection] = useState<LiveConnection>('connecting');
  const failuresRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let source: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const apply = (next: LiveSnapshot) => {
      if (cancelled) return;
      // Compare versions rather than replacing blindly: an identical snapshot
      // would re-render every consumer for nothing.
      setSnapshot((current) =>
        current && current.version === next.version ? current : next,
      );
    };

    const startPolling = () => {
      if (cancelled || pollTimer) return;
      setConnection('polling');
      const fetchOnce = async () => {
        try {
          const response = await fetch(`/api/live/${tournamentId}?mode=poll`, {
            cache: 'no-store',
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          apply((await response.json()) as LiveSnapshot);
          if (!cancelled) setConnection('polling');
        } catch {
          if (!cancelled) setConnection('offline');
        }
      };
      void fetchOnce();
      pollTimer = setInterval(fetchOnce, POLL_INTERVAL_MS);
    };

    if (typeof EventSource === 'undefined') {
      startPolling();
      return () => {
        cancelled = true;
        if (pollTimer) clearInterval(pollTimer);
      };
    }

    source = new EventSource(`/api/live/${tournamentId}`);

    source.addEventListener('snapshot', (event) => {
      failuresRef.current = 0;
      if (!cancelled) setConnection('live');
      try {
        apply(JSON.parse((event as MessageEvent<string>).data) as LiveSnapshot);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    });

    // The server closes long-lived streams deliberately; EventSource reconnects
    // on its own, so this must NOT count as a failure.
    source.addEventListener('reconnect', () => {
      failuresRef.current = 0;
    });

    source.onerror = () => {
      failuresRef.current += 1;
      if (failuresRef.current >= SSE_FAILURE_LIMIT) {
        source?.close();
        source = null;
        startPolling();
      } else if (!cancelled) {
        setConnection('connecting');
      }
    };

    return () => {
      cancelled = true;
      source?.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [tournamentId]);

  return { snapshot, connection, version: snapshot?.version ?? null };
}
