'use client';

import { useEffect, useState } from 'react';
import {
  clockSkewMs,
  formatDuration,
  serverNowFromClient,
  type TimerPhase,
} from '@/server/modules/tournament/timers.public';
import { cn } from '@/lib/utils';

/**
 * A server-authoritative countdown (E7.1).
 *
 * The browser is told two things: the absolute instant the round ends, and what
 * the server's clock read when the page was built. It measures its own offset
 * from that anchor **once**, then renders `deadline - (localNow - offset)`.
 *
 * Consequences that matter during a live event:
 *
 * - A competitor whose machine clock is wrong (or deliberately changed) sees
 *   the same time remaining as everyone else.
 * - A laptop that sleeps and wakes does not "resume" the countdown from where
 *   it paused — the next render recomputes from absolute time and snaps to the
 *   truth.
 * - Nothing here can extend a deadline. The clock is decoration; the server
 *   refuses a late submission whatever this component displays.
 */

export function Countdown({
  targetAt,
  serverTime,
  phase,
  label,
  size = 'md',
  className,
}: {
  /** The instant being counted down to, ISO-8601. Null renders a dash. */
  targetAt: string | null;
  /** The server's clock when this page was rendered, ISO-8601. */
  serverTime: string;
  phase?: TimerPhase;
  label?: string;
  /**
   * Visual scale only — it does not change the clock. `hero` is for the one
   * countdown that anchors a page; `inline` for timers inside rows and cards.
   */
  size?: 'inline' | 'md' | 'hero';
  className?: string;
}) {
  // Measured on mount, not on every tick: a per-tick measurement would drift
  // with render jitter and defeat the point of anchoring at all.
  const [skew, setSkew] = useState<number | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    setSkew(clockSkewMs(new Date(serverTime), new Date()));
  }, [serverTime]);

  useEffect(() => {
    if (!targetAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetAt]);

  if (!targetAt) {
    return (
      <span className={cn('text-muted-foreground tabular-nums', className)}>
        —
      </span>
    );
  }

  // Until the skew is measured (first paint, before effects run) the server's
  // own reading is used, so SSR and the first client render agree and React
  // does not report a hydration mismatch.
  const effectiveNow =
    skew === null
      ? new Date(serverTime)
      : serverNowFromClient(new Date(now), skew);
  const remaining = Math.max(
    0,
    Math.floor((new Date(targetAt).getTime() - effectiveNow.getTime()) / 1000),
  );

  const urgent = remaining <= 60 && remaining > 0 && phase === 'OPEN';
  const expired = remaining === 0;

  return (
    <span
      className={cn('inline-flex items-baseline gap-2', className)}
      // Announced only when it matters; a per-second live region would be
      // unusable with a screen reader.
      aria-live={urgent ? 'assertive' : 'off'}
    >
      {label ? (
        <span className="text-eyebrow text-muted-foreground font-semibold uppercase">
          {label}
        </span>
      ) : null}
      <span
        className={cn(
          // Tabular figures are load-bearing: without them the digits change
          // width every second and the whole line jitters.
          'font-display font-bold tabular-nums',
          size === 'inline' && 'text-base',
          size === 'md' && 'text-lg',
          size === 'hero' &&
            'text-[clamp(2.5rem,6vw,4.25rem)] leading-none tracking-[-0.03em]',
          // Under a minute the clock turns red and breathes. This is the
          // clearest case of red being earned: something is about to close.
          urgent &&
            'text-destructive motion-safe:animate-[var(--animate-live-pulse)]',
          expired && 'text-muted-foreground',
          !urgent && !expired && size === 'hero' && 'text-foreground',
        )}
      >
        {formatDuration(remaining)}
      </span>
    </span>
  );
}
