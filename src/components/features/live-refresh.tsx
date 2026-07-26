'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveTournament } from '@/hooks/use-live-tournament';
import { cn } from '@/lib/utils';

/**
 * Keeps a server-rendered page live (E7.3).
 *
 * Rather than re-implementing the arena and the bracket as client components
 * fed by the snapshot, this island watches the stream and asks Next to re-run
 * the server render when the snapshot's version changes. One rendering path,
 * one authorization path, one set of reveal rules — the live channel decides
 * *when* to re-render, never *what* is rendered.
 *
 * The trade is an extra round trip per change. That is the right trade here:
 * the alternative duplicates the reveal gate on the client, where it would
 * eventually disagree with the server.
 */

const CONNECTION_LABEL = {
  connecting: 'Connecting…',
  live: 'Live',
  polling: 'Live (polling)',
  offline: 'Reconnecting…',
} as const;

export function LiveRefresh({
  tournamentId,
  /**
   * The version this page was rendered from.
   *
   * **Required.** An earlier draft let a page omit it and adopted the first
   * frame as the baseline instead — which silently swallowed any change that
   * landed between the server render and the stream connecting. If that was the
   * last change for a while, the page stayed stale indefinitely while the
   * indicator cheerfully read "Live". The caller pays one snapshot read so the
   * baseline is the version actually rendered.
   */
  initialVersion,
  showIndicator = true,
  className,
}: {
  tournamentId: string;
  initialVersion: string;
  showIndicator?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const { connection, version } = useLiveTournament(tournamentId);
  const lastAppliedRef = useRef(initialVersion);
  const refreshingRef = useRef(false);

  useEffect(() => {
    if (!version) return;
    if (version === lastAppliedRef.current) return;
    if (refreshingRef.current) return;

    refreshingRef.current = true;
    lastAppliedRef.current = version;
    router.refresh();
    // A short guard so a burst of changes (a whole round being decided at once)
    // coalesces into one refresh instead of queueing several.
    const id = setTimeout(() => {
      refreshingRef.current = false;
    }, 1000);
    return () => clearTimeout(id);
  }, [version, router]);

  if (!showIndicator) return null;

  return (
    <span
      className={cn(
        'text-muted-foreground inline-flex items-center gap-1.5 text-xs',
        className,
      )}
      aria-live="polite"
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          connection === 'live' && 'bg-success',
          connection === 'polling' && 'bg-warning',
          connection === 'connecting' && 'bg-muted-foreground animate-pulse',
          connection === 'offline' && 'bg-destructive',
        )}
      />
      {CONNECTION_LABEL[connection]}
    </span>
  );
}
