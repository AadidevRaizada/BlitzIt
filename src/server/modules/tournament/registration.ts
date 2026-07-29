import 'server-only';
import type { Registration } from '@/generated/prisma/client';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { recordAudit } from '@/server/modules/admin/audit';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { AUTOMATION_ACTOR } from '@/server/modules/auth/roles';
import { resolveTournamentConfig } from './config';
import { recomputePrizePool } from './prize-pool';

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

export interface RegisterCompetitorOptions {
  actorId?: string | null;
  /** E9: paid-pass activation links the registration to the payment in the same transaction. */
  paymentId?: string | null;
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
  options: RegisterCompetitorOptions = {},
): Promise<RegistrationResult> {
  return db.$transaction((tx) =>
    registerCompetitorInTransaction(tx, tournamentId, userId, options),
  );
}

/**
 * E9 payment activation path. Payment confirmation calls this with the same
 * transaction handle that marks the payment paid, so a captured payment cannot
 * unlock a registration unless the capacity claim commits too.
 */
export async function registerCompetitorInTransaction(
  tx: Prisma.TransactionClient,
  tournamentId: string,
  userId: string,
  options: RegisterCompetitorOptions = {},
): Promise<RegistrationResult> {
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
  if (tournament.registrationOpensAt && now < tournament.registrationOpensAt) {
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
      data: {
        status: 'ACTIVE',
        registeredAt: now,
        holdExpiresAt: null,
        ...(options.paymentId ? { paymentId: options.paymentId } : {}),
      },
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
      data: {
        userId,
        tournamentId,
        status: 'ACTIVE',
        ...(options.paymentId ? { paymentId: options.paymentId } : {}),
      },
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

  await recomputePrizePool(tournamentId, tx);

  return { registration, participantCount: after.participantCount };
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

    await recomputePrizePool(tournamentId, tx);

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

/**
 * Raw ACTIVE rows reserve capacity while registration is open. In paid
 * tournaments this can include a pending/unpaid entry that still holds a seat,
 * but is not yet part of the competitive field.
 */
export async function countActiveSeatReservations(
  tournamentId: string,
  client: DbClient = db,
): Promise<number> {
  const now = new Date();
  return client.registration.count({
    where: {
      tournamentId,
      status: 'ACTIVE',
      OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: now } }],
    },
  });
}

/** Live count of competitors who may submit, seed and advance in the field. */
export async function countCompetitionEligibleRegistrations(
  tournamentId: string,
  client: DbClient = db,
): Promise<number> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: { passPriceMinor: true },
  });
  if (!tournament)
    throw new NotFoundError(`tournament ${tournamentId} not found`);

  return client.registration.count({
    where: competitionEligibleRegistrationWhere(
      tournamentId,
      tournament.passPriceMinor,
    ),
  });
}

export async function isRegistered(
  tournamentId: string,
  userId: string,
  client: DbClient = db,
): Promise<boolean> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: { passPriceMinor: true },
  });
  if (!tournament)
    throw new NotFoundError(`tournament ${tournamentId} not found`);

  return (
    (await client.registration.count({
      where: {
        ...competitionEligibleRegistrationWhere(
          tournamentId,
          tournament.passPriceMinor,
        ),
        userId,
      },
    })) === 1
  );
}

export function competitionEligibleRegistrationWhere(
  tournamentId: string,
  passPriceMinor: number,
): Prisma.RegistrationWhereInput {
  return {
    tournamentId,
    status: 'ACTIVE',
    ...(passPriceMinor > 0 ? { payment: { status: 'PAID' } } : {}),
  };
}

export async function listCompetitionEligibleRegistrations(
  tournamentId: string,
  client: DbClient = db,
): Promise<Array<{ userId: string; user: { city: string | null } }>> {
  const tournament = await client.tournament.findUnique({
    where: { id: tournamentId },
    select: { passPriceMinor: true },
  });
  if (!tournament)
    throw new NotFoundError(`tournament ${tournamentId} not found`);

  return client.registration.findMany({
    where: competitionEligibleRegistrationWhere(
      tournamentId,
      tournament.passPriceMinor,
    ),
    select: { userId: true, user: { select: { city: true } } },
    orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }],
  });
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
 * Reconcile the denormalised counter against the meaning it has in the current
 * lifecycle state. While registration is open it is the capacity reservation
 * count, including unpaid rows and unexpired checkout holds. Once registration
 * closes it is frozen to the competitive paid/free field.
 */
export async function reconcileParticipantCount(
  tournamentId: string,
): Promise<{ before: number; after: number }> {
  return db.$transaction(async (tx) => {
    const tournament = await tx.tournament.findUnique({
      where: { id: tournamentId },
      select: { participantCount: true, status: true },
    });
    if (!tournament) {
      throw new NotFoundError(`tournament ${tournamentId} not found`);
    }
    const actual =
      tournament.status === 'REGISTRATION_OPEN'
        ? await countActiveSeatReservations(tournamentId, tx)
        : await countCompetitionEligibleRegistrations(tournamentId, tx);
    await tx.tournament.update({
      where: { id: tournamentId },
      data: { participantCount: actual },
    });
    await recomputePrizePool(tournamentId, tx);
    return { before: tournament.participantCount, after: actual };
  });
}

/**
 * Refund every paid entry for a cancelled tournament (D34).
 *
 * A thin loop over the EXISTING per-payment refund, deliberately: no second
 * refund implementation, no bulk gateway call, no new money-moving code. Each
 * `refundPaymentForAdmin` claims an idempotent refund intent, so a payment that
 * has already been refunded is a no-op and this whole function is safe to run
 * again — which the cleanup job's retry policy depends on.
 *
 * One competitor's refund failing must not strand the rest, so failures are
 * counted and reported rather than thrown. The caller decides whether the
 * remainder justifies a retry.
 */
export async function refundRegistrationPayments(
  tournamentId: string,
  reason: string,
  client: DbClient = db,
): Promise<{ refunded: number; failed: number; failures: string[] }> {
  const { refundPaymentForAdmin } =
    await import('@/server/modules/payment/payments');

  // Only PAID payments are refundable, which also makes a free tournament a
  // natural no-op — it has no Payment rows to match.
  const registrations = await client.registration.findMany({
    where: { tournamentId, payment: { status: 'PAID' } },
    select: { paymentId: true },
  });

  let refunded = 0;
  const failures: string[] = [];

  for (const { paymentId } of registrations) {
    if (!paymentId) continue;
    try {
      await refundPaymentForAdmin(paymentId, AUTOMATION_ACTOR, reason);
      refunded++;
    } catch (error) {
      // Named, not swallowed. An operator asking "why is this tournament still
      // unarchived" must be able to read the answer, and the whole point of the
      // admin diagnostics is that nobody opens psql to find out.
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${paymentId}: ${message}`);
      logger.error(
        { err: error, tournamentId, paymentId },
        'entry fee refund failed',
      );
    }
  }

  return { refunded, failed: failures.length, failures };
}
