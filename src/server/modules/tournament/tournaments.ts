import 'server-only';
import type {
  Prisma,
  Tournament,
  TournamentStatus,
} from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { recordAudit } from '@/server/modules/admin/audit';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/errors';
import { evaluationProfileConfigSchema } from './evaluation-profiles';
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
        createdBy: options.actorId ?? null,
      },
    });

    await recordAudit(
      {
        actorId: options.actorId ?? null,
        action: 'tournament.create',
        entityType: 'Tournament',
        entityId: tournament.id,
        after: { slug: tournament.slug, name: tournament.name },
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

    return after;
  });
}

/**
 * Set the UTC schedule (D8). Stored as authoritative timestamps that cron and
 * the scheduler read; display in IST is a presentation concern.
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
