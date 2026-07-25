import 'server-only';
import type { Registration } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { recordAudit } from '@/server/modules/admin/audit';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { resolveTournamentConfig } from './config';

/**
 * Registration (E3).
 *
 * Entry into a tournament as a *state*: who is allowed to compete. E3 owns the
 * window, the limits and the count. It does NOT own paying for it — Razorpay,
 * `Payment` and the paid-pass unlock are E4, which will attach a `paymentId` to
 * the row this module creates. Nothing here assumes money has changed hands.
 */

export interface RegistrationResult {
  registration: Registration;
  participantCount: number;
}

/**
 * Register a competitor.
 *
 * The capacity check and the counter increment are one conditional UPDATE
 * inside the transaction, so two simultaneous registrations for the last slot
 * cannot both succeed — a plain read-then-write would let them.
 */
export async function registerCompetitor(
  tournamentId: string,
  userId: string,
  options: { actorId?: string | null } = {},
): Promise<RegistrationResult> {
  return db.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
      select: {
        id: true,
        status: true,
        registrationOpensAt: true,
        registrationClosesAt: true,
        participantCount: true,
        bracketSize: true,
        thirdPlaceEnabled: true,
        minRegistrations: true,
        maxRegistrations: true,
        roundDurations: true,
      },
    });
    if (!tournament) {
      throw new NotFoundError(`tournament ${tournamentId} not found`);
    }
    if (tournament.status !== 'REGISTRATION_OPEN') {
      throw new ConflictError(
        `registration is not open (tournament is ${tournament.status})`,
      );
    }

    const now = new Date();
    if (
      tournament.registrationOpensAt &&
      now < tournament.registrationOpensAt
    ) {
      throw new ConflictError('registration has not opened yet');
    }
    if (
      tournament.registrationClosesAt &&
      now > tournament.registrationClosesAt
    ) {
      throw new ConflictError('registration has closed');
    }

    const existing = await tx.registration.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
    });
    if (existing?.status === 'ACTIVE') {
      throw new ConflictError('already registered for this tournament');
    }

    const config = resolveTournamentConfig(tournament);

    // CLAIM THE ENTRY FIRST, then the capacity slot.
    //
    // A new registration is protected by the unique (userId, tournamentId)
    // index: a racing duplicate fails the insert and rolls back. Reactivating a
    // withdrawn entry had no such protection — two concurrent re-registers
    // could both read the same REVOKED row, both increment the counter, and
    // both write it ACTIVE, so ONE competitor would consume TWO capacity slots.
    // The conditional update makes exactly one of them the winner.
    let registration;
    if (existing) {
      const reactivated = await tx.registration.updateMany({
        where: { id: existing.id, status: { not: 'ACTIVE' } },
        data: { status: 'ACTIVE', registeredAt: now },
      });
      if (reactivated.count === 0) {
        // Someone else reactivated it between our read and our write.
        throw new ConflictError('already registered for this tournament');
      }
      registration = await tx.registration.findUniqueOrThrow({
        where: { id: existing.id },
      });
    } else {
      registration = await tx.registration.create({
        data: { userId, tournamentId, status: 'ACTIVE' },
      });
    }

    const claimed = await tx.tournament.updateMany({
      where: {
        id: tournamentId,
        status: 'REGISTRATION_OPEN',
        participantCount: { lt: config.maxRegistrations },
      },
      data: { participantCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      // Rolls the entry claim back with the rest of the transaction.
      throw new ConflictError(
        `tournament is full (${config.maxRegistrations} registrations)`,
      );
    }

    const after = await tx.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      select: { participantCount: true },
    });

    await recordAudit(
      {
        actorId: options.actorId ?? userId,
        action: 'tournament.register',
        entityType: 'Registration',
        entityId: registration.id,
        after: { userId, tournamentId, status: 'ACTIVE' },
      },
      tx,
    );

    return { registration, participantCount: after.participantCount };
  });
}

/**
 * Withdraw before the field is locked. Allowed only while registration is
 * open: once the tournament has moved on, the field is part of the seeding
 * input and removing a competitor would change results retroactively.
 */
export async function withdrawRegistration(
  tournamentId: string,
  userId: string,
  options: { actorId?: string | null } = {},
): Promise<RegistrationResult> {
  return db.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true, status: true },
    });
    if (!tournament) {
      throw new NotFoundError(`tournament ${tournamentId} not found`);
    }
    if (tournament.status !== 'REGISTRATION_OPEN') {
      throw new ConflictError(
        `cannot withdraw once registration has closed (tournament is ${tournament.status})`,
      );
    }

    const existing = await tx.registration.findUnique({
      where: { userId_tournamentId: { userId, tournamentId } },
    });
    if (!existing || existing.status !== 'ACTIVE') {
      throw new NotFoundError('no active registration to withdraw');
    }

    const registration = await tx.registration.update({
      where: { id: existing.id },
      data: { status: 'REVOKED' },
    });

    // Floor at zero: the counter is a denormalisation, and a negative one would
    // be worse than a slightly stale one.
    await tx.tournament.updateMany({
      where: { id: tournamentId, participantCount: { gt: 0 } },
      data: { participantCount: { decrement: 1 } },
    });

    const after = await tx.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      select: { participantCount: true },
    });

    await recordAudit(
      {
        actorId: options.actorId ?? userId,
        action: 'tournament.withdraw',
        entityType: 'Registration',
        entityId: registration.id,
        before: { status: 'ACTIVE' },
        after: { status: 'REVOKED' },
      },
      tx,
    );

    return { registration, participantCount: after.participantCount };
  });
}

/** Live count of competitors who may take part. */
export async function countActiveRegistrations(
  tournamentId: string,
  client: DbClient = db,
): Promise<number> {
  return client.registration.count({
    where: { tournamentId, status: 'ACTIVE' },
  });
}

export async function isRegistered(
  tournamentId: string,
  userId: string,
  client: DbClient = db,
): Promise<boolean> {
  const registration = await client.registration.findUnique({
    where: { userId_tournamentId: { userId, tournamentId } },
    select: { status: true },
  });
  return registration?.status === 'ACTIVE';
}

/**
 * Guard for anything that requires an entry — the seam the Submission module
 * (E5) calls instead of reimplementing the rule.
 */
export async function assertRegistered(
  tournamentId: string,
  userId: string,
  client: DbClient = db,
): Promise<void> {
  if (!(await isRegistered(tournamentId, userId, client))) {
    throw new ForbiddenError('not registered for this tournament');
  }
}

/**
 * Reconcile the denormalised counter against the registration rows. The
 * counter drives capacity checks and (in E4) the prize pool, so ops needs a
 * way to repair it without hand-written SQL.
 */
export async function reconcileParticipantCount(
  tournamentId: string,
): Promise<{ before: number; after: number }> {
  return db.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
      select: { participantCount: true },
    });
    if (!tournament) {
      throw new NotFoundError(`tournament ${tournamentId} not found`);
    }
    const actual = await countActiveRegistrations(tournamentId, tx);
    await tx.tournament.update({
      where: { id: tournamentId },
      data: { participantCount: actual },
    });
    return { before: tournament.participantCount, after: actual };
  });
}
