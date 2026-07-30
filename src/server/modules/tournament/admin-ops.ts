import 'server-only';
import type {
  ChallengeCategory,
  Role,
  MatchStatus,
  Registration,
  RegistrationStatus,
  RoundStage,
  RoundStatus,
  Tournament,
  TournamentEnvironment,
  TournamentStatus,
  WinReason,
} from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { recordAudit } from '@/server/modules/admin/audit';
import { isAdmin } from '@/server/modules/auth/roles';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { describeJob, type JobLifecycleState } from '@/server/jobs/status';
import { toLifecycleState, type LifecycleState } from './lifecycle';
import { allowedTransitions, type TournamentTransition } from './lifecycle';
import { isBracketSize } from './config';
import { countCompetitionEligibleRegistrations } from './registration';
import {
  isSlotPermanentlyEmpty,
  isStructuralMatch,
  STRUCTURAL_MATCH_FILTER,
} from './bye';
import {
  getPrizePoolDisplay,
  recomputePrizePool,
  type PrizePoolDisplay,
} from './prize-pool';

/**
 * Operator-facing reads and operations for the Tournament module (E5).
 *
 * The admin UI needs aggregate views no competitor surface ever asked for —
 * how many entries are still evaluating, who is registered, which lifecycle
 * buttons should be enabled. Those aggregates belong here, next to the data
 * they summarise, so a page never assembles them out of raw Prisma calls.
 *
 * Nothing here duplicates a rule: lifecycle changes still go through
 * `applyTransition`, and which transitions are legal still comes from the pure
 * state machine.
 */

export interface TournamentSummary {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  status: TournamentStatus;
  visibility: Tournament['visibility'];
  /** Which world this tournament belongs to. Surfaced so the admin list can
   * label and filter it, and so entity pages can refuse it to the wrong
   * viewer without a second query. */
  environment: Tournament['environment'];
  archivedAt: Date | null;
  currentStage: Tournament['currentStage'];
  /** Flattened lifecycle state, or null when the row is inconsistent. */
  state: LifecycleState | null;
  bracketSize: number | null;
  thirdPlaceEnabled: boolean;
  minRegistrations: number | null;
  maxRegistrations: number | null;
  passPriceMinor: number;
  basePrizePoolMinor: number;
  prizePerRegistrationMinor: number;
  sponsorContributionMinor: number;
  bonusContributionMinor: number;
  firstPrizeCapMinor: number;
  /** Per-tournament round durations (D7). Null = deployment defaults. */
  roundDurations: unknown;
  /** Stage -> evaluation-profile overrides (D20). Null = built-in defaults. */
  evaluationProfiles: unknown;
  /**
   * Once set, the bracket exists and its shape is frozen — `configureTournament`
   * refuses size and third-place changes from here on. Surfaced so the settings
   * UI can disable those controls with an explanation instead of letting the
   * operator submit a change that will be rejected.
   */
  bracketGeneratedAt: Date | null;
  participantCount: number;
  prizePool: PrizePoolDisplay;
  registrations: number;
  submissions: number;
  /** Submissions that have reached a score. */
  evaluated: number;
  /** Submissions still moving through the pipeline. */
  pendingEvaluation: number;
  failedEvaluation: number;
  rounds: number;
  matches: number;
  matchesDecided: number;
  /** Matches won without being played — byes and void slots. */
  matchesBye: number;
  /**
   * Competitors who may actually seed and advance — ACTIVE, paid where a pass
   * costs money, hold unexpired. This is the number the bracket is sized from,
   * and it is often smaller than `registrations`. Surfaced so the operator can
   * see a draw refusal coming instead of meeting it as an error on submit.
   */
  eligibleCount: number;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  simulationOpensAt: Date | null;
  simulationClosesAt: Date | null;
  liveStartsAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  /** Transitions the state machine currently permits (excluding CANCEL). */
  availableTransitions: TournamentTransition[];
}

/** Lifecycle state, tolerating an inconsistent row rather than throwing. */
function safeLifecycleState(tournament: Tournament): LifecycleState | null {
  try {
    return toLifecycleState(tournament.status, tournament.currentStage);
  } catch {
    logger.warn(
      { tournamentId: tournament.id, status: tournament.status },
      'tournament row has an inconsistent lifecycle state',
    );
    return null;
  }
}

function summarise(
  tournament: Tournament,
  counts: {
    prizePool: PrizePoolDisplay;
    registrations: number;
    submissions: number;
    evaluated: number;
    pendingEvaluation: number;
    failedEvaluation: number;
    rounds: number;
    matches: number;
    matchesDecided: number;
    matchesBye: number;
    eligibleCount: number;
  },
): TournamentSummary {
  const state = safeLifecycleState(tournament);
  const shape = isBracketSize(tournament.bracketSize)
    ? {
        bracketSize: tournament.bracketSize,
        thirdPlaceEnabled: tournament.thirdPlaceEnabled,
      }
    : undefined;

  return {
    id: tournament.id,
    slug: tournament.slug,
    name: tournament.name,
    description: tournament.description,
    status: tournament.status,
    visibility: tournament.visibility,
    environment: tournament.environment,
    archivedAt: tournament.archivedAt,
    currentStage: tournament.currentStage,
    state,
    bracketSize: tournament.bracketSize,
    thirdPlaceEnabled: tournament.thirdPlaceEnabled,
    minRegistrations: tournament.minRegistrations,
    maxRegistrations: tournament.maxRegistrations,
    passPriceMinor: tournament.passPriceMinor,
    basePrizePoolMinor: tournament.basePrizePoolMinor,
    prizePerRegistrationMinor: tournament.prizePerRegistrationMinor,
    sponsorContributionMinor: tournament.sponsorContributionMinor,
    bonusContributionMinor: tournament.bonusContributionMinor,
    firstPrizeCapMinor: tournament.firstPrizeCapMinor,
    roundDurations: tournament.roundDurations,
    evaluationProfiles: tournament.evaluationProfiles,
    bracketGeneratedAt: tournament.bracketGeneratedAt,
    participantCount: tournament.participantCount,
    ...counts,
    registrationOpensAt: tournament.registrationOpensAt,
    registrationClosesAt: tournament.registrationClosesAt,
    simulationOpensAt: tournament.simulationOpensAt,
    simulationClosesAt: tournament.simulationClosesAt,
    liveStartsAt: tournament.liveStartsAt,
    completedAt: tournament.completedAt,
    createdAt: tournament.createdAt,
    availableTransitions: state
      ? allowedTransitions(state, shape).filter((t) => t !== 'CANCEL')
      : [],
  };
}

async function countsFor(tournamentId: string, client: DbClient) {
  const [
    prizePool,
    registrations,
    submissions,
    evaluated,
    pendingEvaluation,
    failedEvaluation,
    rounds,
    matches,
    matchesDecided,
    matchesBye,
    eligibleCount,
  ] = await Promise.all([
    getPrizePoolDisplay(tournamentId, client),
    client.registration.count({
      where: { tournamentId, status: 'ACTIVE' },
    }),
    client.submission.count({ where: { tournamentId } }),
    client.submission.count({ where: { tournamentId, status: 'SCORED' } }),
    client.submission.count({
      where: {
        tournamentId,
        status: { in: ['RECEIVED', 'QUEUED', 'JUDGING'] },
      },
    }),
    client.submission.count({ where: { tournamentId, status: 'FAILED' } }),
    client.round.count({ where: { tournamentId } }),
    client.match.count({ where: { tournamentId } }),
    client.match.count({ where: { tournamentId, status: 'DECIDED' } }),
    client.match.count({
      where: { tournamentId, ...STRUCTURAL_MATCH_FILTER },
    }),
    countCompetitionEligibleRegistrations(tournamentId, client),
  ]);

  return {
    prizePool,
    registrations,
    submissions,
    evaluated,
    pendingEvaluation,
    failedEvaluation,
    rounds,
    matches,
    matchesDecided,
    matchesBye,
    eligibleCount,
  };
}

export interface ListTournamentSummariesOptions {
  status?: TournamentStatus | TournamentStatus[];
  /** Archived tournaments are hidden unless explicitly asked for. */
  includeArchived?: boolean;
  /** Only archived tournaments; applied before `take`. */
  archivedOnly?: boolean;
  /**
   * Restrict to one environment. Optional, unlike every public read's required
   * scope: an operator browsing the admin list legitimately wants to see both
   * worlds, and this surface is already behind `requireAdmin`.
   */
  environment?: TournamentEnvironment;
  take?: number;
}

export async function listTournamentSummaries(
  options: ListTournamentSummariesOptions = {},
  client: DbClient = db,
): Promise<TournamentSummary[]> {
  const status = Array.isArray(options.status)
    ? { in: options.status }
    : options.status;

  const tournaments = await client.tournament.findMany({
    where: {
      ...(status ? { status } : {}),
      // Admin surfaces are the ONE place both worlds are legitimately
      // browsable, so this filter is optional rather than required. Omitting it
      // is a deliberate "show me everything", available only behind
      // requireAdmin — never on a public path.
      ...(options.environment ? { environment: options.environment } : {}),
      ...(options.archivedOnly
        ? { archivedAt: { not: null } }
        : options.includeArchived
          ? {}
          : { archivedAt: null }),
    },
    orderBy: { createdAt: 'desc' },
    take: options.take ?? 100,
  });

  // Sequential rather than parallel: a handful of tournaments, and eight counts
  // each fired at once would be a needless burst on a small connection pool.
  const summaries: TournamentSummary[] = [];
  for (const tournament of tournaments) {
    summaries.push(
      summarise(tournament, await countsFor(tournament.id, client)),
    );
  }
  return summaries;
}

export async function getTournamentSummary(
  tournamentId: string,
  client: DbClient = db,
): Promise<TournamentSummary> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
  });
  if (!tournament) throw new NotFoundError('That tournament does not exist');
  return summarise(tournament, await countsFor(tournamentId, client));
}

// ───────────────────────── Registrations ─────────────────────────

export interface RegistrationView {
  id: string;
  userId: string;
  username: string;
  displayName: string | null;
  email: string;
  city: string | null;
  status: RegistrationStatus;
  registeredAt: Date;
  /** Whether a pass has been paid for (E4 payments will populate this). */
  paid: boolean;
  submissions: number;
  seed: number | null;
  qualified: boolean;
  eliminatedAtStage: string | null;
}

export async function listRegistrations(
  tournamentId: string,
  options: { status?: RegistrationStatus } = {},
  client: DbClient = db,
): Promise<RegistrationView[]> {
  const registrations = await client.registration.findMany({
    where: {
      tournamentId,
      ...(options.status ? { status: options.status } : {}),
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          email: true,
          city: true,
        },
      },
    },
    orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }],
  });

  const [rankings, submissionCounts] = await Promise.all([
    client.ranking.findMany({
      where: { tournamentId },
      select: {
        userId: true,
        seed: true,
        qualified: true,
        eliminatedAtStage: true,
      },
    }),
    client.submission.groupBy({
      by: ['userId'],
      where: { tournamentId },
      _count: { _all: true },
    }),
  ]);

  const rankingByUser = new Map(rankings.map((r) => [r.userId, r]));
  const countByUser = new Map(
    submissionCounts.map((row) => [row.userId, row._count._all]),
  );

  return registrations.map((registration) => {
    const ranking = rankingByUser.get(registration.userId);
    return {
      id: registration.id,
      userId: registration.userId,
      username: registration.user.username,
      displayName: registration.user.displayName,
      email: registration.user.email,
      city: registration.user.city,
      status: registration.status,
      registeredAt: registration.registeredAt,
      paid: registration.paymentId !== null,
      submissions: countByUser.get(registration.userId) ?? 0,
      seed: ranking?.seed ?? null,
      qualified: ranking?.qualified ?? false,
      eliminatedAtStage: ranking?.eliminatedAtStage ?? null,
    };
  });
}

/**
 * Remove a competitor from a tournament (admin).
 *
 * Deliberately a REVOKE, not a delete: their submissions, evaluations and audit
 * trail stay intact. Refused once the field has been sealed into a seeding —
 * removing someone after seeding would leave a bracket slot referencing a
 * competitor who is no longer in the tournament, and E3 has no way to re-seed
 * around it.
 */
export async function removeRegistration(
  tournamentId: string,
  userId: string,
  admin: Pick<Tournament, never> & { id: string; role: Role },
  reason: string,
): Promise<Registration> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  return db.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, status: true, seededAt: true },
    });
    if (!tournament) throw new NotFoundError('That tournament does not exist');
    if (tournament.seededAt) {
      throw new ConflictError(
        'This tournament has already been seeded; removing a competitor now would leave an unfillable bracket slot',
      );
    }

    const existing = await tx.registration.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
    });
    if (!existing || existing.status !== 'ACTIVE') {
      throw new NotFoundError('That competitor is not actively registered');
    }

    const revoked = await tx.registration.updateMany({
      where: { id: existing.id, status: 'ACTIVE' },
      data: { status: 'REVOKED' },
    });
    if (revoked.count !== 1) {
      throw new NotFoundError('That competitor is not actively registered');
    }

    const registration = await tx.registration.findUniqueOrThrow({
      where: { id: existing.id },
    });

    await tx.tournament.updateMany({
      where: { id: tournamentId, participantCount: { gt: 0 } },
      data: { participantCount: { decrement: 1 } },
    });
    await recomputePrizePool(tournamentId, tx);

    await recordAudit(
      {
        actorId: admin.id,
        action: 'tournament.removeRegistration',
        entityType: 'Registration',
        entityId: registration.id,
        before: { status: existing.status },
        after: { status: 'REVOKED', reason, removedUserId: userId },
      },
      tx,
    );

    logger.info(
      { tournamentId, userId, actorId: admin.id },
      'registration revoked by admin',
    );
    return registration;
  });
}

// ───────────────────────── Archiving ─────────────────────────

/**
 * Shelve or un-shelve a finished tournament.
 *
 * Only COMPLETED or CANCELLED tournaments may be archived — archiving a running
 * one would hide an event that still needs operating. This is not a lifecycle
 * transition (see the schema comment on `archivedAt`).
 */
export async function setTournamentArchived(
  tournamentId: string,
  archived: boolean,
  admin: { id: string; role: Role },
): Promise<Tournament> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  return db.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
    });
    if (!tournament) throw new NotFoundError('That tournament does not exist');

    if (
      archived &&
      tournament.status !== 'COMPLETED' &&
      tournament.status !== 'CANCELLED'
    ) {
      throw new ConflictError(
        `Only a completed or cancelled tournament can be archived (this one is ${tournament.status})`,
      );
    }

    const updated = await tx.tournament.update({
      where: { id: tournamentId },
      data: { archivedAt: archived ? new Date() : null },
    });

    await recordAudit(
      {
        actorId: admin.id,
        action: archived ? 'tournament.archive' : 'tournament.unarchive',
        entityType: 'Tournament',
        entityId: tournamentId,
        before: { archivedAt: tournament.archivedAt },
        after: { archivedAt: updated.archivedAt },
      },
      tx,
    );

    return updated;
  });
}

// ───────────────────────── Ops health ─────────────────────────

export interface QueueHealth {
  byState: Record<JobLifecycleState, number>;
  total: number;
  /** Jobs that will not run again without operator action. */
  deadLettered: number;
  oldestPendingAt: Date | null;
}

export interface BracketRoundView {
  id: string;
  stage: RoundStage;
  status: RoundStatus;
  opensAt: Date | null;
  /** True once the round has opened — the simultaneous-reveal gate (E3). */
  revealed: boolean;
  /**
   * Null until the round has opened when the caller is a competitor. The
   * problem TITLE is part of the reveal: knowing the final's challenge early
   * would be exactly the head start `opensAt` exists to prevent.
   */
  problem: { title: string; category: ChallengeCategory } | null;
  /** The problem the round is played on, once assigned. */
  matches: Array<{
    id: string;
    bracketPosition: number;
    /** Display names. */
    competitorA: string | null;
    competitorB: string | null;
    winner: string | null;
    /** Ids, so a viewer's own path can be highlighted without name matching. */
    competitorAId: string | null;
    competitorBId: string | null;
    seedA: number | null;
    seedB: number | null;
    /**
     * This slot will never hold anyone — it is an unfilled seed in the opening
     * round, not a slot awaiting an upstream winner. Consumers need the
     * distinction because they render identically otherwise: the bracket showed
     * "TBD" against a top seed's bye, promising a name that was never coming.
     */
    slotAEmpty: boolean;
    slotBEmpty: boolean;
    /** Won without being played. True for both byes and void matches. */
    isBye: boolean;
    winReason: WinReason | null;
    status: MatchStatus;
    tieUnresolved: boolean;
    /** Set on a SUDDEN_DEATH match: the deadlocked match it settles (E6). */
    resolvesMatchId: string | null;
    submissionAId: string | null;
    submissionBId: string | null;
  }>;
}

/**
 * Bracket read model. Topology and advancement remain owned by E3.
 *
 * `revealProblems` defaults to true for the operator surfaces. A competitor
 * surface must pass `false`, which withholds the problem of any round that has
 * not opened yet — the same simultaneous-reveal rule `getRevealedRound`
 * enforces on the submit page.
 */
export async function listBracketRounds(
  tournamentId: string,
  options: { revealProblems?: boolean } = {},
  client: DbClient = db,
): Promise<BracketRoundView[]> {
  const revealProblems = options.revealProblems ?? true;
  const now = new Date();
  const rounds = await client.round.findMany({
    where: { tournamentId, type: 'KNOCKOUT' },
    orderBy: [{ sequence: 'asc' }, { stage: 'asc' }],
    include: {
      matches: { orderBy: { bracketPosition: 'asc' } },
      problem: { select: { title: true, category: true } },
    },
  });

  const userIds = [
    ...new Set(
      rounds.flatMap((round) =>
        round.matches.flatMap((match) => [
          match.competitorAId,
          match.competitorBId,
          match.winnerId,
        ]),
      ),
    ),
  ].filter((id): id is string => Boolean(id));

  const users = await client.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true },
  });
  const usernameById = new Map(users.map((user) => [user.id, user.username]));

  // Only the opening round assigns competitors by seed; every later round is
  // fed by a winner. That is what separates "empty forever" from "not yet".
  const firstRoundId = rounds[0]?.id ?? null;

  return rounds.map((round) => {
    const revealed = round.opensAt !== null && now >= round.opensAt;
    const hasFeeder = round.id !== firstRoundId;
    return {
      id: round.id,
      stage: round.stage,
      status: round.status,
      opensAt: round.opensAt,
      revealed,
      problem: revealProblems || revealed ? round.problem : null,
      matches: round.matches.map((match) => ({
        id: match.id,
        bracketPosition: match.bracketPosition,
        competitorA: match.competitorAId
          ? (usernameById.get(match.competitorAId) ?? 'Unknown')
          : null,
        competitorB: match.competitorBId
          ? (usernameById.get(match.competitorBId) ?? 'Unknown')
          : null,
        winner: match.winnerId
          ? (usernameById.get(match.winnerId) ?? 'Unknown')
          : null,
        competitorAId: match.competitorAId,
        competitorBId: match.competitorBId,
        seedA: match.seedA,
        seedB: match.seedB,
        slotAEmpty: isSlotPermanentlyEmpty({
          competitorId: match.competitorAId,
          seed: match.seedA,
          hasFeeder,
        }),
        slotBEmpty: isSlotPermanentlyEmpty({
          competitorId: match.competitorBId,
          seed: match.seedB,
          hasFeeder,
        }),
        isBye: isStructuralMatch(match),
        winReason: match.winReason,
        status: match.status,
        tieUnresolved: match.tieUnresolved,
        resolvesMatchId: match.resolvesMatchId,
        submissionAId: match.submissionAId,
        submissionBId: match.submissionBId,
      })),
    };
  });
}

/**
 * Queue depth by *lifecycle* state, not raw status — the dashboard needs to
 * distinguish "retry scheduled" from "queued" and "failed" from "dead
 * lettered", which the persisted enum alone cannot express.
 */
export async function getQueueHealth(
  client: DbClient = db,
): Promise<QueueHealth> {
  const byState: Record<JobLifecycleState, number> = {
    QUEUED: 0,
    RETRY_SCHEDULED: 0,
    CLAIMED: 0,
    RUNNING: 0,
    COMPLETED: 0,
    FAILED: 0,
    DEAD_LETTER: 0,
  };

  const [total, completed, jobs] = await Promise.all([
    client.evaluationJob.count(),
    client.evaluationJob.count({ where: { status: 'DONE' } }),
    client.evaluationJob.findMany({
      where: { status: { in: ['QUEUED', 'CLAIMED', 'RUNNING', 'FAILED'] } },
      select: {
        status: true,
        attempts: true,
        maxAttempts: true,
        availableAt: true,
        lastError: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  byState.COMPLETED = completed;

  let oldestPendingAt: Date | null = null;
  const now = new Date();

  for (const job of jobs) {
    const described = describeJob(job, now);
    byState[described.state] += 1;
    if (described.isActive && oldestPendingAt === null) {
      oldestPendingAt = job.createdAt;
    }
  }

  return {
    byState,
    total,
    deadLettered: byState.DEAD_LETTER,
    oldestPendingAt,
  };
}
