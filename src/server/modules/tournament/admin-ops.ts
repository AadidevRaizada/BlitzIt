import 'server-only';
import type {
  ChallengeCategory,
  MatchStatus,
  Registration,
  RegistrationStatus,
  RoundStage,
  RoundStatus,
  Tournament,
  TournamentStatus,
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
  archivedAt: Date | null;
  currentStage: Tournament['currentStage'];
  /** Flattened lifecycle state, or null when the row is inconsistent. */
  state: LifecycleState | null;
  bracketSize: number | null;
  thirdPlaceEnabled: boolean;
  minRegistrations: number | null;
  maxRegistrations: number | null;
  passPriceMinor: number;
  participantCount: number;
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
    registrations: number;
    submissions: number;
    evaluated: number;
    pendingEvaluation: number;
    failedEvaluation: number;
    rounds: number;
    matches: number;
    matchesDecided: number;
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
    archivedAt: tournament.archivedAt,
    currentStage: tournament.currentStage,
    state,
    bracketSize: tournament.bracketSize,
    thirdPlaceEnabled: tournament.thirdPlaceEnabled,
    minRegistrations: tournament.minRegistrations,
    maxRegistrations: tournament.maxRegistrations,
    passPriceMinor: tournament.passPriceMinor,
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
    registrations,
    submissions,
    evaluated,
    pendingEvaluation,
    failedEvaluation,
    rounds,
    matches,
    matchesDecided,
  ] = await Promise.all([
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
  ]);

  return {
    registrations,
    submissions,
    evaluated,
    pendingEvaluation,
    failedEvaluation,
    rounds,
    matches,
    matchesDecided,
  };
}

export interface ListTournamentSummariesOptions {
  status?: TournamentStatus | TournamentStatus[];
  /** Archived tournaments are hidden unless explicitly asked for. */
  includeArchived?: boolean;
  /** Only archived tournaments; applied before `take`. */
  archivedOnly?: boolean;
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
  admin: Pick<Tournament, never> & { id: string; role: 'USER' | 'ADMIN' },
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
  admin: { id: string; role: 'USER' | 'ADMIN' },
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
  problem: { title: string; category: ChallengeCategory } | null;
  matches: Array<{
    id: string;
    bracketPosition: number;
    competitorA: string | null;
    competitorB: string | null;
    winner: string | null;
    status: MatchStatus;
    tieUnresolved: boolean;
    submissionAId: string | null;
    submissionBId: string | null;
  }>;
}

/** Operator bracket read model. Topology and advancement remain owned by E3. */
export async function listBracketRounds(
  tournamentId: string,
  client: DbClient = db,
): Promise<BracketRoundView[]> {
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

  return rounds.map((round) => ({
    id: round.id,
    stage: round.stage,
    status: round.status,
    problem: round.problem,
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
      status: match.status,
      tieUnresolved: match.tieUnresolved,
      submissionAId: match.submissionAId,
      submissionBId: match.submissionBId,
    })),
  }));
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
