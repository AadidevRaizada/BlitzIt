import 'server-only';
import { createHash } from 'node:crypto';
import type {
  RoundStage,
  RoundStatus,
  TournamentStatus,
} from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { NotFoundError } from '@/lib/errors';
import { listBracketRounds, type BracketRoundView } from './admin-ops';
import { computeCountdown, type Countdown } from './timers.public';

/**
 * The live/spectator read model (E7.3).
 *
 * One function assembles everything the live surfaces need — the arena, the
 * bracket page, and (in E8) the landing page — into a single serialisable
 * snapshot. Both transports serve the *same* snapshot: the SSE stream pushes it
 * when it changes, the polling fallback returns it on request. That is
 * deliberate; two shapes would drift and the fallback would quietly become a
 * second-class citizen.
 *
 * ## Change detection without a message bus
 *
 * D3 rules out Redis, so there is no pub/sub to subscribe to. Instead the
 * snapshot carries a `version` — a hash over everything in it that a human
 * would notice changing — and the stream re-reads on an interval, emitting only
 * when that hash moves. The cost is one bounded query set per interval per
 * connection; the benefit is no new infrastructure and a fallback that is
 * exactly as correct as the stream.
 *
 * ## What a spectator may see
 *
 * This snapshot is **public** (D10: the landing page is the spectator
 * experience), so it carries only what is already public: usernames, seeds,
 * placements, match outcomes, counts. Never emails, never submission contents,
 * never hidden tests — and never the challenge of a round that has not opened,
 * which is why the bracket is read with `revealProblems: false`.
 */

export interface LeaderboardEntry {
  userId: string;
  username: string;
  displayName: string | null;
  city: string | null;
  seed: number | null;
  simulationScore: number;
  placement: number | null;
  qualified: boolean;
  currentStage: RoundStage | null;
  eliminatedAtStage: RoundStage | null;
}

export type LeaderboardOrder = 'score' | 'seed' | 'city';

export interface LeaderboardOptions {
  by?: LeaderboardOrder;
  take?: number;
}

/** Default page size for the public leaderboard. */
export const LEADERBOARD_DEFAULT_TAKE = 25;

/**
 * Public standings.
 *
 * `placement` sorts first when present — once a tournament finishes, the final
 * order is the truth and simulation score is only a historical detail.
 */
export async function getLeaderboard(
  tournamentId: string,
  options: LeaderboardOptions = {},
  client: DbClient = db,
): Promise<LeaderboardEntry[]> {
  const take = options.take ?? LEADERBOARD_DEFAULT_TAKE;
  const by = options.by ?? 'score';

  const orderBy =
    by === 'seed'
      ? ([
          { seed: 'asc' },
          { simulationScore: 'desc' },
          { userId: 'asc' },
        ] as const)
      : by === 'city'
        ? ([
            { city: 'asc' },
            { simulationScore: 'desc' },
            { userId: 'asc' },
          ] as const)
        : ([
            { placement: 'asc' },
            { simulationScore: 'desc' },
            { userId: 'asc' },
          ] as const);

  const rankings = await client.ranking.findMany({
    where: { tournamentId },
    include: {
      user: { select: { id: true, username: true, displayName: true } },
    },
    // A tie broken by `userId` keeps the order stable between reads, so the
    // snapshot hash does not flap and push a spurious update every interval.
    orderBy: [...orderBy],
    take,
  });

  return rankings.map((ranking) => ({
    userId: ranking.userId,
    username: ranking.user.username,
    displayName: ranking.user.displayName,
    city: ranking.city,
    seed: ranking.seed,
    simulationScore: ranking.simulationScore,
    placement: ranking.placement,
    qualified: ranking.qualified,
    currentStage: ranking.currentStage,
    eliminatedAtStage: ranking.eliminatedAtStage,
  }));
}

export interface LiveRoundView {
  id: string;
  stage: RoundStage;
  status: RoundStatus;
  opensAt: string | null;
  deadlineAt: string | null;
  /** True once the round has opened (simultaneous reveal). */
  revealed: boolean;
  /** Withheld until the round opens. */
  problemTitle: string | null;
  matchesTotal: number;
  matchesDecided: number;
}

export interface LiveSnapshot {
  tournamentId: string;
  slug: string;
  name: string;
  status: TournamentStatus;
  currentStage: RoundStage | null;
  participantCount: number;
  prizePoolMinor: number;
  currency: string;
  youtubeStreamUrl: string | null;
  /** The next thing that happens, and when. Null once the tournament is over. */
  countdown: (Countdown & { of: string }) | null;
  currentRound: LiveRoundView | null;
  leaderboard: LeaderboardEntry[];
  bracket: BracketRoundView[];
  /** Matches held on an unresolved tie, awaiting a decider (D14). */
  tiedMatches: number;
  /** Hash of everything above; changes exactly when the snapshot does. */
  version: string;
  /** The server's clock at the read, so clients can correct their own. */
  serverTime: string;
}

export interface LiveSnapshotOptions {
  leaderboardTake?: number;
  now?: Date;
}

/**
 * What the tournament is counting down to, given where it is in its lifecycle.
 *
 * Falls back to the scheduled milestone when no round is open, so a spectator
 * always sees the next real moment rather than a blank panel.
 */
function resolveCountdown(
  tournament: {
    status: TournamentStatus;
    registrationOpensAt: Date | null;
    registrationClosesAt: Date | null;
    simulationOpensAt: Date | null;
    simulationClosesAt: Date | null;
    liveStartsAt: Date | null;
  },
  round: { opensAt: Date | null; deadlineAt: Date | null } | null,
  now: Date,
): (Countdown & { of: string }) | null {
  // A round in progress always wins: it is the most immediate deadline anyone
  // is watching.
  if (round && (round.opensAt || round.deadlineAt)) {
    const countdown = computeCountdown(round, now);
    if (countdown.phase !== 'CLOSED' && countdown.phase !== 'UNSCHEDULED') {
      return { ...countdown, of: 'ROUND' };
    }
  }

  const milestone = (at: Date | null, of: string) =>
    at
      ? { ...computeCountdown({ opensAt: at, deadlineAt: at }, now), of }
      : null;

  switch (tournament.status) {
    case 'DRAFT':
    case 'PUBLISHED':
      return milestone(tournament.registrationOpensAt, 'REGISTRATION_OPENS');
    case 'REGISTRATION_OPEN':
      return milestone(tournament.registrationClosesAt, 'REGISTRATION_CLOSES');
    case 'REGISTRATION_CLOSED':
      return milestone(tournament.simulationOpensAt, 'SIMULATION_OPENS');
    case 'SIMULATION':
      return milestone(tournament.simulationClosesAt, 'SIMULATION_CLOSES');
    case 'SEEDING':
    case 'BRACKET_GENERATED':
      return milestone(tournament.liveStartsAt, 'KNOCKOUT_STARTS');
    case 'LIVE':
      // LIVE with no open round means evaluations are still landing; there is
      // no honest countdown for "when the judges finish".
      return null;
    case 'COMPLETED':
    case 'CANCELLED':
      return null;
  }
}

/**
 * Assemble the public live snapshot.
 *
 * Throws `NotFoundError` for an unknown tournament. Visibility is the caller's
 * decision — the route refuses UNLISTED tournaments, the admin surfaces do not.
 */
export async function getLiveSnapshot(
  tournamentId: string,
  options: LiveSnapshotOptions = {},
  client: DbClient = db,
): Promise<LiveSnapshot> {
  const now = options.now ?? new Date();

  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      currentStage: true,
      participantCount: true,
      prizePoolMinor: true,
      currency: true,
      youtubeStreamUrl: true,
      registrationOpensAt: true,
      registrationClosesAt: true,
      simulationOpensAt: true,
      simulationClosesAt: true,
      liveStartsAt: true,
    },
  });
  if (!tournament) {
    throw new NotFoundError(`tournament ${tournamentId} not found`);
  }

  // The round currently in play: the knockout stage while LIVE, otherwise the
  // open simulation round.
  const round = await client.round.findFirst({
    where: {
      tournamentId,
      ...(tournament.status === 'LIVE' && tournament.currentStage
        ? { stage: tournament.currentStage }
        : { status: { in: ['OPEN', 'JUDGING'] } }),
    },
    orderBy: [{ status: 'asc' }, { sequence: 'asc' }],
    include: {
      problem: { select: { title: true } },
      _count: { select: { matches: true } },
    },
  });

  const [leaderboard, bracket, decidedMatches, tiedMatches] = await Promise.all(
    [
      getLeaderboard(
        tournamentId,
        { take: options.leaderboardTake ?? LEADERBOARD_DEFAULT_TAKE },
        client,
      ),
      // `revealProblems: false` — the snapshot is public, and a spectator seeing
      // the final's challenge before it opens would leak it to competitors too.
      listBracketRounds(tournamentId, { revealProblems: false }, client),
      round
        ? client.match.count({
            where: { roundId: round.id, status: 'DECIDED' },
          })
        : Promise.resolve(0),
      client.match.count({
        where: {
          tournamentId,
          tieUnresolved: true,
          status: { not: 'DECIDED' },
        },
      }),
    ],
  );

  const revealed = round?.opensAt != null && now >= round.opensAt;
  const currentRound: LiveRoundView | null = round
    ? {
        id: round.id,
        stage: round.stage,
        status: round.status,
        opensAt: round.opensAt?.toISOString() ?? null,
        deadlineAt: round.deadlineAt?.toISOString() ?? null,
        revealed,
        problemTitle: revealed ? (round.problem?.title ?? null) : null,
        matchesTotal: round._count.matches,
        matchesDecided: decidedMatches,
      }
    : null;

  const snapshot: Omit<LiveSnapshot, 'version' | 'serverTime'> = {
    tournamentId: tournament.id,
    slug: tournament.slug,
    name: tournament.name,
    status: tournament.status,
    currentStage: tournament.currentStage,
    participantCount: tournament.participantCount,
    prizePoolMinor: tournament.prizePoolMinor,
    currency: tournament.currency,
    youtubeStreamUrl: tournament.youtubeStreamUrl,
    countdown: resolveCountdown(tournament, round, now),
    currentRound,
    leaderboard,
    bracket,
    tiedMatches,
  };

  return {
    ...snapshot,
    version: snapshotVersion(snapshot),
    serverTime: now.toISOString(),
  };
}

/**
 * A stable fingerprint of a snapshot's *content*.
 *
 * `serverTime` and the countdown's `secondsRemaining` are excluded on purpose:
 * both change every single read, so including them would make every interval
 * look like a change and turn the stream into a poll with extra steps. The
 * countdown's `targetAt` IS included, because a deadline actually moving is
 * news — a client ticks the seconds down locally from the target.
 */
export function snapshotVersion(
  snapshot: Omit<LiveSnapshot, 'version' | 'serverTime'>,
): string {
  const material = {
    ...snapshot,
    countdown: snapshot.countdown
      ? {
          phase: snapshot.countdown.phase,
          targetAt: snapshot.countdown.targetAt,
          label: snapshot.countdown.label,
          of: snapshot.countdown.of,
        }
      : null,
  };
  return createHash('sha1')
    .update(JSON.stringify(material))
    .digest('hex')
    .slice(0, 16);
}
