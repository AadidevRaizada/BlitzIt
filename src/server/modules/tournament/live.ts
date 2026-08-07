import 'server-only';
import { createHash } from 'node:crypto';
import type {
  MatchStatus,
  RoundStage,
  RoundStatus,
  SubmissionStatus,
  PaymentStatus,
  TournamentStatus,
} from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { CURRENT_TERMS_VERSION } from '@/server/modules/compliance';
import { NotFoundError } from '@/lib/errors';
import { listBracketRounds, type BracketRoundView } from './admin-ops';
import { STRUCTURAL_MATCH_FILTER, isStructuralMatch } from './bye';
import {
  tournamentEnvironmentFilter,
  type EnvironmentScope,
} from './environment.public';
import { getPrizePoolDisplay, type PrizePoolDisplay } from './prize-pool';
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
  prizePool: PrizePoolDisplay;
  currency: string;
  youtubeStreamUrl: string | null;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  simulationOpensAt: string | null;
  simulationClosesAt: string | null;
  liveStartsAt: string | null;
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

  const [
    leaderboard,
    bracket,
    decidedMatches,
    structuralMatches,
    tiedMatches,
    prizePool,
  ] = await Promise.all([
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
    round
      ? client.match.count({
          where: { roundId: round.id, ...STRUCTURAL_MATCH_FILTER },
        })
      : Promise.resolve(0),
    client.match.count({
      where: {
        tournamentId,
        tieUnresolved: true,
        status: { not: 'DECIDED' },
      },
    }),
    getPrizePoolDisplay(tournamentId, client),
  ]);

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
        // Byes are excluded from BOTH halves of this fraction. They are decided
        // before the round opens, so counting them made the public progress bar
        // start part-filled — a 16-draw with 7 byes opened its first round
        // reading "7/8 decided" while nobody had submitted a line. What a
        // spectator wants to know is how much of the round is left to WATCH.
        matchesTotal: round._count.matches - structuralMatches,
        matchesDecided: decidedMatches - structuralMatches,
      }
    : null;

  const snapshot: Omit<LiveSnapshot, 'version' | 'serverTime'> = {
    tournamentId: tournament.id,
    slug: tournament.slug,
    name: tournament.name,
    status: tournament.status,
    currentStage: tournament.currentStage,
    participantCount: tournament.participantCount,
    prizePoolMinor: prizePool.prizePoolMinor,
    prizePool,
    currency: tournament.currency,
    youtubeStreamUrl: tournament.youtubeStreamUrl,
    registrationOpensAt: tournament.registrationOpensAt?.toISOString() ?? null,
    registrationClosesAt:
      tournament.registrationClosesAt?.toISOString() ?? null,
    simulationOpensAt: tournament.simulationOpensAt?.toISOString() ?? null,
    simulationClosesAt: tournament.simulationClosesAt?.toISOString() ?? null,
    liveStartsAt: tournament.liveStartsAt?.toISOString() ?? null,
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

export interface MyTournamentState {
  tournamentId: string;
  isRegistered: boolean;
  registrationId: string | null;
  registrationStatus: string | null;
  registeredAt: Date | null;
  payment: {
    id: string;
    status: PaymentStatus;
    amountMinor: number;
    currency: string;
    providerOrderId: string;
    providerPaymentId: string | null;
    failureReason: string | null;
    paidAt: Date | null;
  } | null;
  seed: number | null;
  placement: number | null;
  qualified: boolean;
  eliminatedAtStage: RoundStage | null;
  simulationScore: number;
  currentRound: {
    id: string;
    stage: RoundStage;
    status: RoundStatus;
    opensAt: Date | null;
    deadlineAt: Date | null;
    submitted: boolean;
    submissionStatus: SubmissionStatus | null;
    submissionId: string | null;
  } | null;
  currentMatch: {
    id: string;
    stage: RoundStage;
    status: MatchStatus;
    roundStatus: RoundStatus;
    opensAt: Date | null;
    deadlineAt: Date | null;
    opponentUsername: string | null;
    /**
     * This match was won without being played — the slot opposite was empty.
     * Nothing to submit, nothing to wait for. Surfaces exist to tell the
     * competitor that rather than sending them to an arena with no opponent.
     */
    byeAwarded: boolean;
  } | null;
  readiness: {
    githubConnected: boolean;
    avatarSet: boolean;
    profileLocationSet: boolean;
    profileComplete: boolean;
    termsAccepted: boolean;
    registered: boolean;
    paymentSettled: boolean;
  };
}

/**
 * One competitor's tournament state, scoped by user and tournament.
 *
 * This powers the public tournament page and the dashboard without exposing
 * submissions or private opponent facts. Each row is derived from existing
 * persisted state; when a fact is not tracked, it is absent from this shape.
 */
export async function getMyTournamentState(
  userId: string,
  tournamentId: string,
  client: DbClient = db,
): Promise<MyTournamentState> {
  const [
    user,
    registration,
    payment,
    ranking,
    round,
    match,
    termsAcceptance,
    tournament,
  ] = await Promise.all([
    client.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        avatarUrl: true,
        displayName: true,
        city: true,
        authUserId: true,
      },
    }),
    client.registration.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
      select: { id: true, status: true, registeredAt: true },
    }),
    client.payment.findFirst({
      where: { userId, tournamentId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        amountMinor: true,
        currency: true,
        providerOrderId: true,
        providerPaymentId: true,
        refundReason: true,
        paidAt: true,
      },
    }),
    client.ranking.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
      select: {
        seed: true,
        placement: true,
        qualified: true,
        eliminatedAtStage: true,
        simulationScore: true,
      },
    }),
    client.round.findFirst({
      where: {
        tournamentId,
        type: 'SIMULATION',
        status: { in: ['OPEN', 'JUDGING', 'PENDING'] },
      },
      orderBy: [{ sequence: 'asc' }],
      select: {
        id: true,
        stage: true,
        status: true,
        opensAt: true,
        deadlineAt: true,
        submissions: {
          where: { userId },
          select: { id: true, status: true },
          take: 1,
        },
      },
    }),
    client.match.findFirst({
      where: {
        tournamentId,
        OR: [{ competitorAId: userId }, { competitorBId: userId }],
        round: { status: { not: 'COMPLETED' } },
      },
      // Furthest-along round first — see the same fix in `arena.ts`. Ordering
      // by `createdAt` was a coin flip, because the bracket is written in a
      // single transaction.
      orderBy: [{ round: { sequence: 'desc' } }, { bracketPosition: 'asc' }],
      select: {
        id: true,
        status: true,
        winReason: true,
        competitorAId: true,
        competitorBId: true,
        round: {
          select: {
            stage: true,
            status: true,
            opensAt: true,
            deadlineAt: true,
          },
        },
      },
    }),
    client.termsAcceptance.findUnique({
      where: {
        userId_version: {
          userId,
          version: CURRENT_TERMS_VERSION,
        },
      },
      select: { id: true },
    }),
    client.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      select: { passPriceMinor: true },
    }),
  ]);

  const opponentId =
    match?.competitorAId === userId
      ? match.competitorBId
      : match?.competitorBId === userId
        ? match.competitorAId
        : null;
  const opponent = opponentId
    ? await client.user.findUnique({
        where: { id: opponentId },
        select: { username: true },
      })
    : null;
  const githubAccount = await client.authAccount.findFirst({
    where: { userId: user.authUserId, providerId: 'github' },
    select: { id: true },
  });
  const submission = round?.submissions[0] ?? null;

  const isPaidOrFree =
    tournament.passPriceMinor === 0 || payment?.status === 'PAID';
  const isRegistered = registration?.status === 'ACTIVE' && isPaidOrFree;

  return {
    tournamentId,
    isRegistered,
    registrationId: isRegistered ? (registration?.id ?? null) : null,
    registrationStatus: registration?.status ?? null,
    registeredAt: isRegistered ? (registration?.registeredAt ?? null) : null,
    payment: payment
      ? {
          id: payment.id,
          status: payment.status,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          providerOrderId: payment.providerOrderId,
          providerPaymentId: payment.providerPaymentId,
          failureReason:
            payment.status === 'FAILED'
              ? (payment.refundReason ?? 'Payment failed')
              : null,
          paidAt: payment.paidAt,
        }
      : null,
    seed: ranking?.seed ?? null,
    placement: ranking?.placement ?? null,
    qualified: ranking?.qualified ?? false,
    eliminatedAtStage: ranking?.eliminatedAtStage ?? null,
    simulationScore: ranking?.simulationScore ?? 0,
    currentRound: round
      ? {
          id: round.id,
          stage: round.stage,
          status: round.status,
          opensAt: round.opensAt,
          deadlineAt: round.deadlineAt,
          submitted: submission !== null,
          submissionStatus: submission?.status ?? null,
          submissionId: submission?.id ?? null,
        }
      : null,
    currentMatch: match
      ? {
          id: match.id,
          stage: match.round.stage,
          status: match.status,
          roundStatus: match.round.status,
          opensAt: match.round.opensAt,
          deadlineAt: match.round.deadlineAt,
          opponentUsername: opponent?.username ?? null,
          byeAwarded: isStructuralMatch(match),
        }
      : null,
    readiness: {
      githubConnected: githubAccount !== null,
      avatarSet: Boolean(user.avatarUrl),
      profileLocationSet: Boolean(user.displayName && user.city),
      profileComplete: Boolean(user.displayName && user.city && githubAccount),
      termsAccepted: termsAcceptance !== null,
      registered: isRegistered,
      paymentSettled:
        payment?.status === 'PAID' ||
        payment?.status === 'REFUNDED' ||
        payment === null,
    },
  };
}

export interface MyResultSubmission {
  submissionId: string;
  stage: RoundStage;
  problemTitle: string | null;
  overallScore: number | null;
  functionalScore: number | null;
  testsPassed: number | null;
  testsTotal: number | null;
  profileName: string | null;
  submittedAt: Date;
}

export interface MyTournamentResult {
  tournamentId: string;
  tournamentName: string;
  tournamentSlug: string;
  status: TournamentStatus;
  seed: number | null;
  placement: number | null;
  qualified: boolean;
  eliminatedAtStage: RoundStage | null;
  simulationScore: number;
  submissions: MyResultSubmission[];
}

/**
 * One competitor's own history — screen [13] (E8.2).
 *
 * Their entries and their scores, with the evidence one click away. This is
 * scoped to `userId` in every query rather than filtered after the fact: a
 * results page that fetched broadly and narrowed in the view is one refactor
 * away from leaking somebody else's submission.
 */
export async function listMyResults(
  userId: string,
  options: { take?: number } = {},
  client: DbClient = db,
): Promise<MyTournamentResult[]> {
  const registrations = await client.registration.findMany({
    where: { userId },
    orderBy: { registeredAt: 'desc' },
    take: options.take ?? 25,
    select: {
      tournamentId: true,
      tournament: {
        select: { id: true, name: true, slug: true, status: true },
      },
    },
  });
  if (registrations.length === 0) return [];

  const tournamentIds = registrations.map((row) => row.tournamentId);

  const [rankings, submissions] = await Promise.all([
    client.ranking.findMany({
      where: { userId, tournamentId: { in: tournamentIds } },
    }),
    client.submission.findMany({
      where: { userId, tournamentId: { in: tournamentIds } },
      orderBy: { submittedAt: 'asc' },
      select: {
        id: true,
        tournamentId: true,
        submittedAt: true,
        round: { select: { stage: true } },
        problem: { select: { title: true } },
        evaluation: {
          select: {
            overallScore: true,
            functionalScore: true,
            testsPassed: true,
            testsTotal: true,
            profileName: true,
          },
        },
      },
    }),
  ]);

  const rankingByTournament = new Map(
    rankings.map((ranking) => [ranking.tournamentId, ranking]),
  );
  const submissionsByTournament = new Map<string, MyResultSubmission[]>();
  for (const submission of submissions) {
    const list = submissionsByTournament.get(submission.tournamentId) ?? [];
    list.push({
      submissionId: submission.id,
      stage: submission.round.stage,
      problemTitle: submission.problem?.title ?? null,
      overallScore: submission.evaluation?.overallScore ?? null,
      functionalScore: submission.evaluation?.functionalScore ?? null,
      testsPassed: submission.evaluation?.testsPassed ?? null,
      testsTotal: submission.evaluation?.testsTotal ?? null,
      profileName: submission.evaluation?.profileName ?? null,
      submittedAt: submission.submittedAt,
    });
    submissionsByTournament.set(submission.tournamentId, list);
  }

  return registrations.map((registration) => {
    const ranking = rankingByTournament.get(registration.tournamentId);
    return {
      tournamentId: registration.tournament.id,
      tournamentName: registration.tournament.name,
      tournamentSlug: registration.tournament.slug,
      status: registration.tournament.status,
      seed: ranking?.seed ?? null,
      placement: ranking?.placement ?? null,
      qualified: ranking?.qualified ?? false,
      eliminatedAtStage: ranking?.eliminatedAtStage ?? null,
      simulationScore: ranking?.simulationScore ?? 0,
      submissions: submissionsByTournament.get(registration.tournamentId) ?? [],
    };
  });
}

export interface PublicPlacement {
  tournamentId: string;
  tournamentName: string;
  placement: number | null;
  seed: number | null;
  eliminatedAtStage: RoundStage | null;
}

/**
 * A competitor's placements, as anyone may see them — screen [4] (E8.4).
 *
 * Deliberately narrower than `listMyResults`: placements and seeds are public
 * (D10 puts them on the leaderboard), scores and submissions are not. This
 * returns no submission, no evidence and no score, so a public page physically
 * cannot render one.
 *
 * Unlisted tournaments are excluded — a rehearsal must not surface through a
 * participant's profile — and so is every environment but `scope`. Without the
 * latter, a tester's public profile would list their test placements to any
 * visitor, which is the same leak by a quieter route.
 */
export async function listPublicPlacements(
  userId: string,
  scope: EnvironmentScope,
  options: { take?: number } = {},
  client: DbClient = db,
): Promise<PublicPlacement[]> {
  const rankings = await client.ranking.findMany({
    where: {
      userId,
      tournament: {
        ...tournamentEnvironmentFilter(scope),
        visibility: 'PUBLIC',
        archivedAt: null,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: options.take ?? 25,
    select: {
      placement: true,
      seed: true,
      eliminatedAtStage: true,
      tournament: { select: { id: true, name: true } },
    },
  });

  return rankings.map((ranking) => ({
    tournamentId: ranking.tournament.id,
    tournamentName: ranking.tournament.name,
    placement: ranking.placement,
    seed: ranking.seed,
    eliminatedAtStage: ranking.eliminatedAtStage,
  }));
}

/**
 * Which tournament the public surfaces should be showing (E8.1).
 *
 * The landing page has no id in its URL, so something has to answer "what is
 * happening right now?". The order below is what a visitor cares about, most
 * urgent first: a live event beats one taking registrations, which beats one
 * that has been announced, which beats the last one that finished.
 *
 * Unlisted and archived tournaments never qualify — a rehearsal must not become
 * the homepage — and neither does another environment. A test tournament that
 * happened to be the most recently LIVE one would otherwise become the
 * production landing page, which is the single most visible way this feature
 * could fail.
 */
const SPECTATOR_STATUS_PRIORITY: readonly TournamentStatus[] = [
  'LIVE',
  'BRACKET_GENERATED',
  'SEEDING',
  'SIMULATION',
  'REGISTRATION_CLOSED',
  'REGISTRATION_OPEN',
  'PUBLISHED',
  'COMPLETED',
];

export async function getSpectatorTournamentId(
  scope: EnvironmentScope,
  client: DbClient = db,
): Promise<string | null> {
  for (const status of SPECTATOR_STATUS_PRIORITY) {
    const tournament = await client.tournament.findFirst({
      where: {
        status,
        ...tournamentEnvironmentFilter(scope),
        visibility: 'PUBLIC',
        archivedAt: null,
      },
      // Within a status, the most recently started one. `createdAt` rather than
      // a schedule field because the schedule is optional and a tournament with
      // no dates set must still be findable.
      orderBy: [{ liveStartsAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true },
    });
    if (tournament) return tournament.id;
  }
  return null;
}

/** The live snapshot for whatever the public surfaces should be showing. */
export async function getSpectatorSnapshot(
  scope: EnvironmentScope,
  options: LiveSnapshotOptions = {},
  client: DbClient = db,
): Promise<LiveSnapshot | null> {
  const tournamentId = await getSpectatorTournamentId(scope, client);
  if (!tournamentId) return null;
  return getLiveSnapshot(tournamentId, options, client);
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
