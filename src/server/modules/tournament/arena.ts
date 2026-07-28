import 'server-only';
import type {
  ChallengeCategory,
  MatchStatus,
  RoundStage,
  RoundStatus,
  TournamentStatus,
  WinReason,
} from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { NotFoundError } from '@/lib/errors';
import { isSubmissionWindowOpen, type SubmissionWindow } from './rounds';
import {
  computeCountdown,
  timerPhase,
  type Countdown,
  type TimerPhase,
} from './timers.public';
import {
  deriveArenaState,
  mayRevealOpponentProgress,
  type ArenaState,
} from './arena.public';

/**
 * The Knockout Arena read model (E7.1 / E7.2).
 *
 * Screen [10] is head-to-head: one match, two competitors, one window. This
 * module assembles exactly what that screen needs and nothing more.
 *
 * ## Per-match windows
 *
 * A window is *scheduled* per round and *applied* per match. The schedule stays
 * round-level on purpose: every match at a stage must open at the same instant
 * or the simultaneous-reveal guarantee is gone, and a competitor who happened
 * to be paired into a later-opening match would get a different amount of
 * thinking time on the same problem. `getMatchWindow` therefore derives a
 * match's window from its round rather than storing a second schedule — one
 * source of truth, no drift, and the fairness property (D26's principle) holds
 * by construction.
 *
 * ## Disconnects
 *
 * There is nothing to restore. Every fact the arena shows is persisted, and the
 * countdown is derived from `deadlineAt` plus a server time anchor, so a
 * competitor who closes the tab, loses the network or reboots gets exactly the
 * same state back on reload — with the same amount of time left, because the
 * deadline never moved.
 *
 * ## Ownership
 *
 * This module reads rounds, matches and users. It never reads `Submission` —
 * that belongs to the Submission module. Where the arena needs to know whether
 * somebody submitted, this module decides only whether that may be *shown*
 * (`mayRevealOpponentProgress`) and the page asks the Submission module for the
 * fact. `Match.submissionAId`/`submissionBId` are deliberately not used for it:
 * advancement writes them when a match is DECIDED, so they are null during the
 * round and would report "no entry" for a competitor who had already submitted.
 */

export interface MatchWindow extends SubmissionWindow {
  matchId: string;
  /** Where the window sits relative to the server clock right now. */
  phase: TimerPhase;
  countdown: Countdown;
  /** The server's own clock at the moment of the read, for client correction. */
  serverTime: string;
}

/**
 * The submission window as it applies to one match.
 *
 * Derived from the match's round — see the note above on why the schedule is
 * not stored per match.
 */
export async function getMatchWindow(
  matchId: string,
  now: Date = new Date(),
  client: DbClient = db,
): Promise<MatchWindow> {
  const match = await client.match.findUnique({
    where: { id: matchId },
    select: { id: true, round: true },
  });
  if (!match) throw new NotFoundError(`match ${matchId} not found`);

  const round = match.round;
  return {
    matchId: match.id,
    roundId: round.id,
    stage: round.stage,
    opensAt: round.opensAt,
    deadlineAt: round.deadlineAt,
    status: round.status,
    isOpen: isSubmissionWindowOpen(round, now),
    secondsRemaining: round.deadlineAt
      ? Math.round((round.deadlineAt.getTime() - now.getTime()) / 1000)
      : null,
    phase: timerPhase(round, now),
    countdown: computeCountdown(round, now),
    serverTime: now.toISOString(),
  };
}

export interface ArenaOpponent {
  userId: string;
  username: string;
  displayName: string | null;
  seed: number | null;
}

export interface ArenaView {
  matchId: string;
  tournament: {
    id: string;
    name: string;
    slug: string;
    status: TournamentStatus;
    currentStage: RoundStage | null;
  };
  round: { id: string; stage: RoundStage; status: RoundStatus };
  window: MatchWindow;
  /** Withheld until `opensAt` — the same simultaneous-reveal gate as [9]. */
  revealed: boolean;
  problem: {
    id: string;
    title: string;
    category: ChallengeCategory;
    statementMarkdown: string;
  } | null;
  viewer: { userId: string; slot: 'A' | 'B'; seed: number | null };
  /** Null on a bye — there is nobody on the other side. */
  opponent: ArenaOpponent | null;
  /**
   * Whether the opponent's entry may be shown yet.
   *
   * **False while the window is open.** Knowing a rival has already submitted
   * is strategic information that would change how a competitor spends the rest
   * of their round, and nothing in the rules gives them the right to it. Once
   * the window closes it can only explain a result rather than shape one.
   *
   * Whether they actually submitted is a fact about a `Submission`, which this
   * module does not own — the page asks the Submission module, gated on this.
   */
  mayRevealOpponentProgress: boolean;
  matchStatus: MatchStatus;
  state: ArenaState;
  winnerId: string | null;
  loserId: string | null;
  winReason: WinReason | null;
  tieUnresolved: boolean;
  /** The decider opened for this match, if any (E6). */
  suddenDeath: { matchId: string; roundId: string; decided: boolean } | null;
  /** Set when THIS match is itself a sudden-death decider. */
  resolves: { matchId: string; stage: RoundStage } | null;
  serverTime: string;
}

/**
 * Assemble the arena for one competitor's match.
 *
 * Returns null when the viewer is not one of the two competitors: the arena is
 * a private, head-to-head surface, and a spectator's view of the same match is
 * the bracket ([11]) or the live stream, not this page. Admins observe through
 * the admin bracket tab, which already carries operator context.
 */
export async function getKnockoutArena(
  matchId: string,
  viewerId: string,
  now: Date = new Date(),
  client: DbClient = db,
): Promise<ArenaView | null> {
  const match = await client.match.findUnique({
    where: { id: matchId },
    include: {
      round: {
        include: {
          problem: {
            select: {
              id: true,
              title: true,
              category: true,
              statementMarkdown: true,
            },
          },
        },
      },
      tournament: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          currentStage: true,
        },
      },
      suddenDeathMatch: { select: { id: true, roundId: true, status: true } },
      resolvesMatch: {
        select: { id: true, round: { select: { stage: true } } },
      },
    },
  });
  if (!match) return null;

  const isA = match.competitorAId === viewerId;
  const isB = match.competitorBId === viewerId;
  if (!isA && !isB) return null;

  const round = match.round;
  const opponentId = isA ? match.competitorBId : match.competitorAId;

  let opponent: ArenaOpponent | null = null;
  if (opponentId) {
    const [user, ranking] = await Promise.all([
      client.user.findUnique({
        where: { id: opponentId },
        select: { id: true, username: true, displayName: true },
      }),
      client.ranking.findUnique({
        where: {
          tournamentId_userId: {
            tournamentId: match.tournamentId,
            userId: opponentId,
          },
        },
        select: { seed: true },
      }),
    ]);
    if (user) {
      opponent = {
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        seed: ranking?.seed ?? (isA ? match.seedB : match.seedA),
      };
    }
  }

  const window: MatchWindow = {
    matchId: match.id,
    roundId: round.id,
    stage: round.stage,
    opensAt: round.opensAt,
    deadlineAt: round.deadlineAt,
    status: round.status,
    isOpen: isSubmissionWindowOpen(round, now),
    secondsRemaining: round.deadlineAt
      ? Math.round((round.deadlineAt.getTime() - now.getTime()) / 1000)
      : null,
    phase: timerPhase(round, now),
    countdown: computeCountdown(round, now),
    serverTime: now.toISOString(),
  };

  const revealed = round.opensAt !== null && now >= round.opensAt;
  const suddenDeath = match.suddenDeathMatch
    ? {
        matchId: match.suddenDeathMatch.id,
        roundId: match.suddenDeathMatch.roundId,
        decided: match.suddenDeathMatch.status === 'DECIDED',
      }
    : null;

  const state = deriveArenaState({
    phase: window.phase,
    matchStatus: match.status,
    tieUnresolved: match.tieUnresolved,
    suddenDeathOpen: suddenDeath !== null && !suddenDeath.decided,
    winnerId: match.winnerId,
    viewerId,
  });

  return {
    matchId: match.id,
    tournament: match.tournament,
    round: { id: round.id, stage: round.stage, status: round.status },
    window,
    revealed,
    problem: revealed ? round.problem : null,
    viewer: {
      userId: viewerId,
      slot: isA ? 'A' : 'B',
      seed: isA ? match.seedA : match.seedB,
    },
    opponent,
    mayRevealOpponentProgress: mayRevealOpponentProgress(window.phase),
    matchStatus: match.status,
    state,
    winnerId: match.winnerId,
    loserId: match.loserId,
    winReason: match.winReason,
    tieUnresolved: match.tieUnresolved,
    suddenDeath,
    resolves: match.resolvesMatch
      ? {
          matchId: match.resolvesMatch.id,
          stage: match.resolvesMatch.round.stage,
        }
      : null,
    serverTime: now.toISOString(),
  };
}

export interface MyMatchSummary {
  matchId: string;
  tournamentId: string;
  tournamentName: string;
  tournamentSlug: string;
  stage: RoundStage;
  roundStatus: RoundStatus;
  matchStatus: MatchStatus;
  state: ArenaState;
  opponentUsername: string | null;
  countdown: Countdown;
  /** True when this is a sudden-death decider rather than a bracket match. */
  isSuddenDeath: boolean;
}

/**
 * Every match a competitor is still involved in, most recent stage first.
 *
 * This is the arena's entry point: without it a competitor would have to know a
 * match id to reach screen [10]. Decided matches are included only while their
 * round is unfinished, so the page can show "you advanced" immediately after a
 * result without accumulating a history — that is what `/results` is for.
 */
export async function listMyLiveMatches(
  userId: string,
  now: Date = new Date(),
  client: DbClient = db,
): Promise<MyMatchSummary[]> {
  const matches = await client.match.findMany({
    where: {
      OR: [{ competitorAId: userId }, { competitorBId: userId }],
      tournament: { status: 'LIVE' },
      round: { status: { not: 'COMPLETED' } },
    },
    include: {
      round: {
        select: {
          id: true,
          stage: true,
          status: true,
          opensAt: true,
          deadlineAt: true,
        },
      },
      tournament: { select: { id: true, name: true, slug: true } },
      suddenDeathMatch: { select: { id: true, status: true } },
    },
    // Furthest-along round first. `createdAt` used to lead this ordering, which
    // was degenerate: the entire bracket is inserted in one transaction, so
    // every match shares a timestamp and the tie-break (`bracketPosition asc`)
    // decided the stage — arbitrarily. A competitor who received a bye could be
    // shown their already-decided first-round match instead of the quarter-final
    // they were actually due to play.
    orderBy: [{ round: { sequence: 'desc' } }, { bracketPosition: 'asc' }],
  });

  const opponentIds = [
    ...new Set(
      matches
        .map((match) =>
          match.competitorAId === userId
            ? match.competitorBId
            : match.competitorAId,
        )
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const opponents = await client.user.findMany({
    where: { id: { in: opponentIds } },
    select: { id: true, username: true },
  });
  const usernameById = new Map(
    opponents.map((user) => [user.id, user.username]),
  );

  return matches.map((match) => {
    const suddenDeathOpen =
      match.suddenDeathMatch !== null &&
      match.suddenDeathMatch.status !== 'DECIDED';
    const opponentId =
      match.competitorAId === userId
        ? match.competitorBId
        : match.competitorAId;

    return {
      matchId: match.id,
      tournamentId: match.tournament.id,
      tournamentName: match.tournament.name,
      tournamentSlug: match.tournament.slug,
      stage: match.round.stage,
      roundStatus: match.round.status,
      matchStatus: match.status,
      state: deriveArenaState({
        phase: timerPhase(match.round, now),
        matchStatus: match.status,
        tieUnresolved: match.tieUnresolved,
        suddenDeathOpen,
        winnerId: match.winnerId,
        viewerId: userId,
      }),
      opponentUsername: opponentId
        ? (usernameById.get(opponentId) ?? null)
        : null,
      countdown: computeCountdown(match.round, now),
      isSuddenDeath: match.round.stage === 'SUDDEN_DEATH',
    };
  });
}
