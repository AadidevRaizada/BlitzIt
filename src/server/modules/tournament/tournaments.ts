import 'server-only';
import type {
  ChallengeCategory,
  Prisma,
  Tournament,
  TournamentEnvironment,
  TournamentStatus,
} from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { recordAudit } from '@/server/modules/admin/audit';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { scheduleEditConflicts } from './schedule.public';
import {
  tournamentEnvironmentFilter,
  type EnvironmentScope,
} from './environment.public';
import { evaluationProfileConfigSchema } from './evaluation-profiles';
import {
  getPrizePoolDisplay,
  recomputePrizePool,
  type PrizePoolDisplay,
} from './prize-pool';
import type {
  ConfigureTournamentInput,
  CreateTournamentInput,
  TournamentScheduleInput,
  UpdateTournamentInput,
} from '@/lib/validation/tournament.schema';

/**
 * Tournament CRUD (E3).
 *
 * Deliberately does NOT write `status` or `currentStage` — every lifecycle
 * change goes through `applyTransition` in `state.ts`, which is what keeps the
 * state machine the single source of truth. CRUD here means the descriptive
 * and configurable parts of a tournament: identity, schedule, shape, prize
 * parameters.
 */

/** Structural edits are only safe before the field is committed to a shape. */
const EDITABLE_STATUSES: readonly TournamentStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'REGISTRATION_OPEN',
];

function assertEditable(tournament: Tournament, what: string): void {
  if (!EDITABLE_STATUSES.includes(tournament.status)) {
    throw new ConflictError(
      `${what} cannot be changed once the tournament is ${tournament.status}`,
    );
  }
}

/** Prisma's unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

export async function createTournament(
  input: CreateTournamentInput,
  options: { actorId?: string | null } = {},
): Promise<Tournament> {
  try {
    return await createTournamentUnchecked(input, options);
  } catch (error) {
    // The pre-check below is only a nicety; the unique index is the real
    // guarantee. Two admins creating the same slug at once would otherwise
    // surface a raw Prisma error instead of a typed CONFLICT.
    if (isUniqueViolation(error)) {
      throw new ConflictError(
        `a tournament with slug "${input.slug}" already exists`,
      );
    }
    throw error;
  }
}

async function createTournamentUnchecked(
  input: CreateTournamentInput,
  options: { actorId?: string | null },
): Promise<Tournament> {
  const existing = await db.tournament.findUnique({
    where: { slug: input.slug },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError(
      `a tournament with slug "${input.slug}" already exists`,
    );
  }

  return db.$transaction(async (tx) => {
    const tournament = await tx.tournament.create({
      data: {
        slug: input.slug,
        name: input.name,
        status: 'DRAFT',
        passPriceMinor: input.passPriceMinor,
        currency: input.currency,
        bracketSize: input.bracketSize,
        thirdPlaceEnabled: input.thirdPlaceEnabled,
        minRegistrations: input.minRegistrations,
        maxRegistrations: input.maxRegistrations,
        timezoneDisplay: input.timezoneDisplay,
        youtubeStreamUrl: input.youtubeStreamUrl,
        environment: input.environment,
        createdBy: options.actorId ?? null,
      },
    });

    await recordAudit(
      {
        actorId: options.actorId ?? null,
        action: 'tournament.create',
        entityType: 'Tournament',
        entityId: tournament.id,
        after: {
          slug: tournament.slug,
          name: tournament.name,
          environment: tournament.environment,
        },
      },
      tx,
    );

    return tournament;
  });
}

export async function updateTournament(
  tournamentId: string,
  input: UpdateTournamentInput,
  options: { actorId?: string | null } = {},
): Promise<Tournament> {
  return db.$transaction(async (tx) => {
    const before = await requireTournament(tournamentId, tx);
    assertEditable(before, 'tournament details');
    await assertPaidPriceChangeDoesNotStrandEntries(tx, before, input);

    const after = await tx.tournament.update({
      where: { id: tournamentId },
      data: {
        name: input.name,
        passPriceMinor: input.passPriceMinor,
        currency: input.currency,
        bracketSize: input.bracketSize,
        thirdPlaceEnabled: input.thirdPlaceEnabled,
        minRegistrations: input.minRegistrations,
        maxRegistrations: input.maxRegistrations,
        timezoneDisplay: input.timezoneDisplay,
        youtubeStreamUrl: input.youtubeStreamUrl,
      },
    });

    await recordAudit(
      {
        actorId: options.actorId ?? null,
        action: 'tournament.update',
        entityType: 'Tournament',
        entityId: tournamentId,
        before: { name: before.name, bracketSize: before.bracketSize },
        after: { name: after.name, bracketSize: after.bracketSize },
      },
      tx,
    );

    await recomputePrizePool(tournamentId, tx);

    return after;
  });
}

async function assertPaidPriceChangeDoesNotStrandEntries(
  tx: Prisma.TransactionClient,
  before: Tournament,
  input: UpdateTournamentInput,
): Promise<void> {
  const newPrice = input.passPriceMinor ?? before.passPriceMinor;
  if (before.passPriceMinor > 0 || newPrice <= 0) return;

  const stranded = await tx.registration.count({
    where: {
      tournamentId: before.id,
      status: 'ACTIVE',
      payment: { isNot: { status: 'PAID' } },
    },
  });
  if (stranded > 0) {
    throw new ConflictError(
      `cannot introduce a paid pass while ${stranded} active registration(s) have no paid or comped payment; mark them paid manually or cancel them first`,
    );
  }
}

/**
 * Set the UTC schedule (D8). Stored as authoritative timestamps the reconciler
 * reads; display in IST is a presentation concern.
 *
 * ## The invariant this enforces (D33)
 *
 * A milestone that has already happened cannot be scheduled for the future.
 *
 * Without that rule the schedule and the lifecycle could contradict each other,
 * and in production they did: a tournament sat in REGISTRATION_OPEN with a
 * `registrationOpensAt` of the following day, so the page rendered
 * "REGISTRATION OPEN" directly above "registration has not opened yet" — both
 * statements true, read from two different sources. The reconciler cannot
 * repair that, because transitions are forward-only and the work they did
 * (rounds created, seeding computed) cannot be un-done.
 *
 * So it is refused at the door instead. Anything AHEAD of the tournament may be
 * rewritten freely; anything behind it may be corrected, but only to another
 * past time — which is also the recovery path for a schedule that was entered
 * wrongly in the first place.
 */
export async function updateTournamentSchedule(
  tournamentId: string,
  input: TournamentScheduleInput,
  options: { actorId?: string | null } = {},
): Promise<Tournament> {
  return db.$transaction(async (tx) => {
    const before = await requireTournament(tournamentId, tx);
    if (before.status === 'COMPLETED' || before.status === 'CANCELLED') {
      throw new ConflictError(
        `cannot reschedule a ${before.status} tournament`,
      );
    }

    const conflicts = scheduleEditConflicts(before, input, new Date());
    if (conflicts.length > 0) {
      throw new ConflictError(
        conflicts.map((conflict) => conflict.message).join(' '),
      );
    }

    const after = await tx.tournament.update({
      where: { id: tournamentId },
      data: {
        registrationOpensAt: input.registrationOpensAt,
        registrationClosesAt: input.registrationClosesAt,
        simulationOpensAt: input.simulationOpensAt,
        simulationClosesAt: input.simulationClosesAt,
        liveStartsAt: input.liveStartsAt,
      },
    });

    await recordAudit(
      {
        actorId: options.actorId ?? null,
        action: 'tournament.schedule',
        entityType: 'Tournament',
        entityId: tournamentId,
        before: {
          registrationOpensAt: before.registrationOpensAt,
          liveStartsAt: before.liveStartsAt,
        },
        after: {
          registrationOpensAt: after.registrationOpensAt,
          liveStartsAt: after.liveStartsAt,
        },
      },
      tx,
    );

    return after;
  });
}

/**
 * Shape + policy configuration: bracket size, third place, limits, round
 * durations (D7) and the stage → evaluation-profile overrides (D20).
 *
 * The evaluation-profile JSON is validated here even though
 * `resolveEvaluationProfile` tolerates garbage at read time — rejecting a
 * malformed override at write time gives the organizer an error they can act
 * on, instead of a tournament that quietly scores on the defaults.
 */
export async function configureTournament(
  tournamentId: string,
  input: ConfigureTournamentInput,
  options: { actorId?: string | null } = {},
): Promise<Tournament> {
  return db.$transaction(async (tx) => {
    const before = await requireTournament(tournamentId, tx);

    if (input.bracketSize !== undefined && before.bracketGeneratedAt) {
      throw new ConflictError(
        'the bracket has already been generated; its size can no longer change',
      );
    }
    if (input.thirdPlaceEnabled !== undefined && before.bracketGeneratedAt) {
      throw new ConflictError(
        'the bracket has already been generated; the third-place play-off can no longer be toggled',
      );
    }

    let evaluationProfiles: Prisma.InputJsonValue | undefined;
    if (input.evaluationProfiles !== undefined) {
      const parsed = evaluationProfileConfigSchema.safeParse(
        input.evaluationProfiles,
      );
      if (!parsed.success) {
        throw new ValidationError(
          'evaluationProfiles is not a valid stage → profile configuration (D20)',
          parsed.error.issues,
        );
      }
      evaluationProfiles = parsed.data as Prisma.InputJsonValue;
    }

    const after = await tx.tournament.update({
      where: { id: tournamentId },
      data: {
        bracketSize: input.bracketSize,
        thirdPlaceEnabled: input.thirdPlaceEnabled,
        minRegistrations: input.minRegistrations,
        maxRegistrations: input.maxRegistrations,
        roundDurations:
          input.roundDurations === undefined
            ? undefined
            : (input.roundDurations as Prisma.InputJsonValue),
        evaluationProfiles,
      },
    });

    await recordAudit(
      {
        actorId: options.actorId ?? null,
        action: 'tournament.configure',
        entityType: 'Tournament',
        entityId: tournamentId,
        before: {
          bracketSize: before.bracketSize,
          thirdPlaceEnabled: before.thirdPlaceEnabled,
          roundDurations: before.roundDurations,
        },
        after: {
          bracketSize: after.bracketSize,
          thirdPlaceEnabled: after.thirdPlaceEnabled,
          roundDurations: after.roundDurations,
        },
      },
      tx,
    );

    return after;
  });
}

/**
 * Delete a tournament. Only a DRAFT with no registrations may be deleted —
 * anything further along is part of the competitive record and is cancelled
 * (a lifecycle transition), never erased.
 */
export async function deleteTournament(
  tournamentId: string,
  options: { actorId?: string | null } = {},
): Promise<void> {
  await db.$transaction(async (tx) => {
    const tournament = await requireTournament(tournamentId, tx);
    if (tournament.status !== 'DRAFT') {
      throw new ConflictError(
        `only a DRAFT tournament can be deleted; cancel the tournament instead (it is ${tournament.status})`,
      );
    }
    const registrations = await tx.registration.count({
      where: { tournamentId },
    });
    if (registrations > 0) {
      throw new ConflictError(
        'this tournament has registrations; cancel it instead of deleting it',
      );
    }

    await recordAudit(
      {
        actorId: options.actorId ?? null,
        action: 'tournament.delete',
        entityType: 'Tournament',
        entityId: tournamentId,
        before: { slug: tournament.slug, name: tournament.name },
      },
      tx,
    );

    await tx.tournament.delete({ where: { id: tournamentId } });
  });
}

export async function getTournament(
  tournamentId: string,
  client: DbClient = db,
): Promise<Tournament | null> {
  return client.tournament.findUnique({ where: { id: tournamentId } });
}

export async function getTournamentBySlug(
  slug: string,
  client: DbClient = db,
): Promise<Tournament | null> {
  return client.tournament.findUnique({ where: { slug } });
}

export interface ListTournamentsOptions {
  status?: TournamentStatus | TournamentStatus[];
  take?: number;
  skip?: number;
}

export type PublicTournamentBucket =
  'LIVE_NOW' | 'REGISTERING' | 'COMING_SOON' | 'PAST';

export interface PublicTournamentCard {
  id: string;
  slug: string;
  name: string;
  status: TournamentStatus;
  /** Which world produced this card. Carried so a detail page can label it. */
  environment: TournamentEnvironment;
  currentStage: string | null;
  participantCount: number;
  bracketSize: number | null;
  maxRegistrations: number | null;
  thirdPlaceEnabled: boolean;
  passPriceMinor: number;
  prizePoolMinor: number;
  prizePool: PrizePoolDisplay;
  currency: string;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  simulationOpensAt: Date | null;
  simulationClosesAt: Date | null;
  liveStartsAt: Date | null;
  completedAt: Date | null;
  youtubeStreamUrl: string | null;
  categories: ChallengeCategory[];
}

export interface ListPublicTournamentsOptions {
  slug?: string;
  take?: number;
}

export async function listTournaments(
  options: ListTournamentsOptions = {},
  client: DbClient = db,
): Promise<Tournament[]> {
  const status = Array.isArray(options.status)
    ? { in: options.status }
    : options.status;

  return client.tournament.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: options.take ?? 50,
    skip: options.skip ?? 0,
  });
}

const PUBLIC_TOURNAMENT_STATUSES: readonly TournamentStatus[] = [
  'PUBLISHED',
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SIMULATION',
  'SEEDING',
  'BRACKET_GENERATED',
  'LIVE',
  'COMPLETED',
];

export function publicTournamentBucket(
  status: TournamentStatus,
): PublicTournamentBucket | null {
  switch (status) {
    case 'SIMULATION':
    case 'SEEDING':
    case 'BRACKET_GENERATED':
    case 'LIVE':
      return 'LIVE_NOW';
    case 'REGISTRATION_OPEN':
      return 'REGISTERING';
    case 'PUBLISHED':
    case 'REGISTRATION_CLOSED':
      return 'COMING_SOON';
    case 'COMPLETED':
      return 'PAST';
    default:
      return null;
  }
}

/**
 * Public-safe tournament discovery, within ONE environment.
 *
 * This is intentionally narrower than `listTournaments`: unlisted, archived,
 * draft and cancelled tournaments are excluded at the query boundary so public
 * pages cannot accidentally reveal rehearsals or shelved records.
 *
 * `scope` is required and has no default. Production callers pass PRODUCTION;
 * the gated `/test` routes pass TEST. Forcing the decision at every call site is
 * what stops a future surface from silently inheriting whichever default seemed
 * reasonable the day this was written.
 */
export async function listPublicTournaments(
  scope: EnvironmentScope,
  options: ListPublicTournamentsOptions = {},
  client: DbClient = db,
): Promise<Record<PublicTournamentBucket, PublicTournamentCard[]>> {
  const tournaments = await client.tournament.findMany({
    where: {
      slug: options.slug,
      ...tournamentEnvironmentFilter(scope),
      visibility: 'PUBLIC',
      archivedAt: null,
      status: { in: [...PUBLIC_TOURNAMENT_STATUSES] },
    },
    orderBy: [
      { liveStartsAt: 'asc' },
      { registrationOpensAt: 'asc' },
      { createdAt: 'desc' },
    ],
    take: options.take ?? 100,
    select: {
      id: true,
      slug: true,
      name: true,
      status: true,
      environment: true,
      currentStage: true,
      participantCount: true,
      bracketSize: true,
      maxRegistrations: true,
      thirdPlaceEnabled: true,
      passPriceMinor: true,
      prizePoolMinor: true,
      currency: true,
      registrationOpensAt: true,
      registrationClosesAt: true,
      simulationOpensAt: true,
      simulationClosesAt: true,
      liveStartsAt: true,
      completedAt: true,
      youtubeStreamUrl: true,
      rounds: {
        select: { problem: { select: { category: true } } },
      },
    },
  });

  const grouped: Record<PublicTournamentBucket, PublicTournamentCard[]> = {
    LIVE_NOW: [],
    REGISTERING: [],
    COMING_SOON: [],
    PAST: [],
  };

  for (const tournament of tournaments) {
    const bucket = publicTournamentBucket(tournament.status);
    if (!bucket) continue;
    const prizePool = await getPrizePoolDisplay(tournament.id, client);

    grouped[bucket].push({
      id: tournament.id,
      slug: tournament.slug,
      name: tournament.name,
      status: tournament.status,
      environment: tournament.environment,
      currentStage: tournament.currentStage,
      participantCount: tournament.participantCount,
      bracketSize: tournament.bracketSize,
      maxRegistrations: tournament.maxRegistrations,
      thirdPlaceEnabled: tournament.thirdPlaceEnabled,
      passPriceMinor: tournament.passPriceMinor,
      prizePoolMinor: prizePool.prizePoolMinor,
      prizePool,
      currency: tournament.currency,
      registrationOpensAt: tournament.registrationOpensAt,
      registrationClosesAt: tournament.registrationClosesAt,
      simulationOpensAt: tournament.simulationOpensAt,
      simulationClosesAt: tournament.simulationClosesAt,
      liveStartsAt: tournament.liveStartsAt,
      completedAt: tournament.completedAt,
      youtubeStreamUrl: tournament.youtubeStreamUrl,
      categories: [
        ...new Set(
          tournament.rounds
            .map((round) => round.problem?.category)
            .filter((category): category is ChallengeCategory =>
              Boolean(category),
            ),
        ),
      ],
    });
  }

  return grouped;
}

export async function requireTournament(
  tournamentId: string,
  client: DbClient = db,
): Promise<Tournament> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
  });
  if (!tournament) {
    throw new NotFoundError(`tournament ${tournamentId} not found`);
  }
  return tournament;
}
