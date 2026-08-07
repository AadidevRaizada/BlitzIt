/**
 * Server-authoritative round timers — the pure half (E7.1).
 *
 * Every function here is total, deterministic and takes `now` explicitly: no
 * clock, no database, no `server-only`. That is deliberate — the countdown in
 * the browser and the driver on the server must agree on what "open", "late"
 * and "closed" mean, and the only way to guarantee that is to share the code
 * rather than write it twice.
 *
 * ## What "server-authoritative" means here
 *
 * The server owns two absolute instants per round (`opensAt`, `deadlineAt`) and
 * publishes them alongside its own current time. The client never contributes a
 * deadline; it only *renders* one, correcting its own clock against the server
 * anchor (`clockSkewMs`). A competitor with a fast, slow, paused or
 * deliberately-tampered clock therefore sees the same remaining time as
 * everyone else, and nothing they can do in the browser moves a deadline.
 *
 * The persisted half (reading rounds, matches and submissions) lives in
 * `timers.ts`; keeping the arithmetic here is what lets a verification suite
 * exercise every boundary case without a database.
 */

/** Where a window sits relative to a given instant. */
export type TimerPhase =
  /** Scheduled but not yet open — the problem is still withheld. */
  | 'BEFORE_OPEN'
  /** Accepting submissions right now. */
  | 'OPEN'
  /** The deadline has passed (or the round was sealed early). */
  | 'CLOSED'
  /** No schedule at all: the round has never been opened. */
  | 'UNSCHEDULED';

export interface TimerWindow {
  opensAt: Date | null;
  deadlineAt: Date | null;
}

/**
 * Which phase a window is in at `now`.
 *
 * Boundaries are inclusive at the open and inclusive at the deadline, matching
 * `isSubmissionWindowOpen` exactly (`now >= opensAt`, `now <= deadlineAt`) — a
 * submission landing on the deadline millisecond is on time, and the two
 * functions must never disagree about it.
 */
export function timerPhase(window: TimerWindow, now: Date): TimerPhase {
  if (!window.opensAt || !window.deadlineAt) return 'UNSCHEDULED';
  if (now < window.opensAt) return 'BEFORE_OPEN';
  if (now > window.deadlineAt) return 'CLOSED';
  return 'OPEN';
}

/**
 * Whole seconds from `now` until `target`, never negative.
 *
 * Clamped at zero because a countdown is what a competitor reads under
 * pressure: "-3s" is noise. Callers that need the signed value subtract the
 * timestamps themselves.
 */
export function secondsUntil(target: Date | null, now: Date): number | null {
  if (!target) return null;
  const delta = Math.ceil((target.getTime() - now.getTime()) / 1000);
  return delta > 0 ? delta : 0;
}

/**
 * How the countdown should be presented: the number of seconds left and what
 * that number is counting down *to*.
 */
export interface Countdown {
  phase: TimerPhase;
  /** Seconds until the next boundary (open, then deadline). Null when unscheduled. */
  secondsRemaining: number | null;
  /** The instant being counted down to, as an ISO string. */
  targetAt: string | null;
  /** What happens when it reaches zero. */
  label: 'OPENS' | 'DEADLINE' | 'ENDED' | 'UNSCHEDULED';
}

export function computeCountdown(window: TimerWindow, now: Date): Countdown {
  const phase = timerPhase(window, now);

  if (phase === 'UNSCHEDULED') {
    return {
      phase,
      secondsRemaining: null,
      targetAt: null,
      label: 'UNSCHEDULED',
    };
  }
  if (phase === 'BEFORE_OPEN') {
    return {
      phase,
      secondsRemaining: secondsUntil(window.opensAt, now),
      targetAt: window.opensAt?.toISOString() ?? null,
      label: 'OPENS',
    };
  }
  if (phase === 'OPEN') {
    return {
      phase,
      secondsRemaining: secondsUntil(window.deadlineAt, now),
      targetAt: window.deadlineAt?.toISOString() ?? null,
      label: 'DEADLINE',
    };
  }
  return {
    phase,
    secondsRemaining: 0,
    targetAt: window.deadlineAt?.toISOString() ?? null,
    label: 'ENDED',
  };
}

/**
 * How a submission timestamp relates to the window it was made against.
 *
 * The Submission module already *refuses* anything that is not `ON_TIME` — this
 * classifies rather than enforces, so the arena can explain to a competitor why
 * an entry was refused, and so an operator can answer "was that late?" after
 * the fact from the persisted window.
 */
export type SubmissionTiming = 'ON_TIME' | 'LATE' | 'BEFORE_OPEN' | 'UNKNOWN';

export function classifySubmissionTiming(
  window: TimerWindow,
  submittedAt: Date | null,
): SubmissionTiming {
  if (!submittedAt || !window.opensAt || !window.deadlineAt) return 'UNKNOWN';
  if (submittedAt < window.opensAt) return 'BEFORE_OPEN';
  if (submittedAt > window.deadlineAt) return 'LATE';
  return 'ON_TIME';
}

/**
 * The client's clock offset from the server's, in milliseconds.
 *
 * Computed once from a single server anchor rather than continuously, so a
 * browser that sleeps and resumes does not drift the countdown: on resume the
 * new wall-clock reading is corrected by the *same* offset and the remaining
 * time snaps to the truth instead of continuing from where it paused.
 *
 * Positive means the client clock runs ahead of the server.
 */
export function clockSkewMs(serverNow: Date, clientNow: Date): number {
  return clientNow.getTime() - serverNow.getTime();
}

/** Apply a measured skew to a client reading to get the server's view of now. */
export function serverNowFromClient(clientNow: Date, skewMs: number): Date {
  return new Date(clientNow.getTime() - skewMs);
}

const SECONDS_PER_DAY = 86_400;

/**
 * `mm:ss`, `h:mm:ss` past an hour, and `Nd hh:mm:ss` past a day.
 *
 * The day part is the whole point of the last form. A registration window that
 * closes in nine days used to render as `224:12:47`, which is not a duration
 * anybody can read — it looks like a bug, or like a clock that has run away.
 * Nobody counts in 224 hours.
 *
 * Under a day the format is unchanged, because that is where this is actually
 * a clock: a fifteen-minute round has to read as `14:59`, and a knockout timer
 * must not gain a leading `0d`.
 *
 * Width is stable within each form, so a ticking timer never shifts the layout.
 */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / SECONDS_PER_DAY);
  const hours = Math.floor((seconds % SECONDS_PER_DAY) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');

  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(remainder)}`;
  }
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(remainder)}`
    : `${pad(minutes)}:${pad(remainder)}`;
}
