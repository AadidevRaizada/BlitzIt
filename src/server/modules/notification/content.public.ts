import { z } from 'zod';
import type { NotificationType } from '@/generated/prisma/client';

/**
 * Notification copy — pure (E8.3).
 *
 * The words are separated from the rendering on purpose: the subject line, the
 * body and the call to action are product decisions worth reading and testing
 * on their own, and they must be identical whether the notification arrives as
 * an email or as a row in the in-app list. `templates.tsx` only decides what
 * the HTML looks like.
 *
 * Nothing here throws. A payload that is missing a field falls back to neutral
 * wording rather than failing a send — a notification that says slightly less
 * is infinitely better than one that never arrives, and the payload is written
 * by the caller, whose typo must not break a competitor's inbox.
 */

/**
 * The payload a notification may carry. Every field optional and validated on
 * read: it is persisted as JSON, so what comes back is whatever was stored,
 * possibly by an older version of this code.
 */
export const notificationPayloadSchema = z
  .object({
    tournamentName: z.string().optional(),
    tournamentSlug: z.string().optional(),
    tournamentId: z.string().optional(),
    roundId: z.string().optional(),
    matchId: z.string().optional(),
    stage: z.string().optional(),
    opponent: z.string().optional(),
    placement: z.number().int().optional(),
    seed: z.number().int().optional(),
    /** Minor units (paise), matching every other money field. */
    amountMinor: z.number().int().optional(),
    deadlineAt: z.string().optional(),
    championName: z.string().optional(),
  })
  .partial();

export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

export function parseNotificationPayload(value: unknown): NotificationPayload {
  const parsed = notificationPayloadSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : {};
}

export interface NotificationContent {
  /** Email subject; also the in-app title. */
  subject: string;
  heading: string;
  /** Body paragraphs, already ordered. */
  lines: string[];
  /** Where the recipient should go next. Path only — the base URL is added at render. */
  cta: { label: string; path: string } | null;
}

/** Money for humans: 250000 paise → "₹2,500". */
export function formatMinor(amountMinor: number, currency = 'INR'): string {
  const symbol = currency === 'INR' ? '₹' : '';
  return `${symbol}${(amountMinor / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`;
}

function stageLabel(stage?: string): string {
  if (!stage) return 'your round';
  return stage.replace(/_/g, ' ').toLowerCase();
}

function ordinal(place: number): string {
  const suffix =
    place % 100 >= 11 && place % 100 <= 13
      ? 'th'
      : place % 10 === 1
        ? 'st'
        : place % 10 === 2
          ? 'nd'
          : place % 10 === 3
            ? 'rd'
            : 'th';
  return `${place}${suffix}`;
}

/**
 * The copy for one notification.
 *
 * Tone follows D21: BlitzIt measures whether software survives realistic use,
 * so results are stated in terms of what the submission did, never in terms of
 * how good the person is.
 */
export function notificationContent(
  type: NotificationType,
  rawPayload: unknown,
): NotificationContent {
  const payload = parseNotificationPayload(rawPayload);
  const tournament = payload.tournamentName ?? 'the tournament';

  switch (type) {
    case 'REGISTRATION_CONFIRMED':
      return {
        subject: `You're in — ${tournament}`,
        heading: "You're registered",
        lines: [
          `Your place in ${tournament} is confirmed.`,
          'The qualifiers open first: three timed rounds, scored on deterministic measurements only. Your total across all three decides your seed.',
        ],
        cta: { label: 'Open your dashboard', path: '/dashboard' },
      };

    case 'SEEDED':
      return {
        subject: `You qualified — seed #${payload.seed ?? '?'}`,
        heading: 'You made the bracket',
        lines: [
          payload.seed
            ? `You qualified for ${tournament} as seed #${payload.seed}.`
            : `You qualified for ${tournament}.`,
          'The knockout rounds are head to head. One match at a time.',
        ],
        cta: payload.tournamentId
          ? {
              label: 'See the bracket',
              path: `/bracket/${payload.tournamentId}`,
            }
          : { label: 'Open your dashboard', path: '/dashboard' },
      };

    case 'ROUND_OPEN':
      return {
        subject: `${stageLabel(payload.stage)} is live`,
        heading: 'Your round is open',
        lines: [
          payload.opponent
            ? `You're up against ${payload.opponent} in the ${stageLabel(payload.stage)}.`
            : `The ${stageLabel(payload.stage)} has opened.`,
          'The challenge is revealed to everyone at the same instant. The deadline is server-side and will not move.',
        ],
        cta: payload.matchId
          ? {
              label: 'Enter the arena',
              path: `/arena/knockout/${payload.matchId}`,
            }
          : payload.roundId
            ? { label: 'Open the round', path: `/submit/${payload.roundId}` }
            : { label: 'Open your dashboard', path: '/dashboard' },
      };

    case 'MATCH_REMINDER':
      return {
        subject: `Time is running out — ${stageLabel(payload.stage)}`,
        heading: 'Your window is closing',
        lines: [
          'Your entry has to be in before the deadline. A late submission is refused.',
          'You can replace your entry as many times as you like until then — the last one counts.',
        ],
        cta: payload.matchId
          ? {
              label: 'Back to the arena',
              path: `/arena/knockout/${payload.matchId}`,
            }
          : { label: 'Open your dashboard', path: '/dashboard' },
      };

    case 'ADVANCED':
      return {
        subject: `You advanced — ${stageLabel(payload.stage)}`,
        heading: 'Your submission held up',
        lines: [
          payload.opponent
            ? `You beat ${payload.opponent} in the ${stageLabel(payload.stage)}.`
            : `You came through the ${stageLabel(payload.stage)}.`,
          'The next round opens on schedule.',
        ],
        cta: payload.tournamentId
          ? {
              label: 'See the bracket',
              path: `/bracket/${payload.tournamentId}`,
            }
          : { label: 'Open your dashboard', path: '/dashboard' },
      };

    case 'RESULT':
      return {
        subject: `Your ${stageLabel(payload.stage)} result`,
        heading: 'Your match has been decided',
        lines: [
          `The ${stageLabel(payload.stage)} has been scored and the result is on the bracket.`,
          'Every score comes with its evidence — you can see exactly what was measured.',
        ],
        cta: payload.tournamentId
          ? {
              label: 'See the bracket',
              path: `/bracket/${payload.tournamentId}`,
            }
          : { label: 'Open your dashboard', path: '/dashboard' },
      };

    case 'ELIMINATED':
      return {
        subject: `Your run ends at the ${stageLabel(payload.stage)}`,
        heading: 'Knocked out',
        lines: [
          payload.placement
            ? `You finished ${ordinal(payload.placement)} in ${tournament}.`
            : `Your run in ${tournament} ends at the ${stageLabel(payload.stage)}.`,
          'Your scores and the evidence behind them stay available under your results.',
        ],
        cta: { label: 'See your results', path: '/results' },
      };

    case 'TOURNAMENT_COMPLETE':
      return {
        subject: `${tournament} is done`,
        heading: 'That is a wrap',
        lines: [
          payload.championName
            ? `${payload.championName} took ${tournament}.`
            : `${tournament} has finished.`,
          'Final standings and every placement are published.',
        ],
        cta: { label: 'Hall of Fame', path: '/hall-of-fame' },
      };

    case 'PAYOUT_SENT':
      return {
        subject: 'Your prize is on its way',
        heading: 'Payout sent',
        lines: [
          payload.amountMinor
            ? `${formatMinor(payload.amountMinor)} has been sent for your finish in ${tournament}.`
            : `Your prize for ${tournament} has been sent.`,
          'Settlement time depends on your bank.',
        ],
        cta: { label: 'See your results', path: '/results' },
      };

    case 'PRIZE_POOL_UPDATE':
      return {
        subject: 'The prize pool grew',
        heading: 'Prize pool update',
        lines: [
          payload.amountMinor
            ? `${tournament} is now playing for ${formatMinor(payload.amountMinor)}.`
            : `The pool for ${tournament} has grown.`,
        ],
        cta: { label: 'See the tournament', path: '/' },
      };
  }
}
