import 'server-only';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@/generated/prisma/client';
import type { Payment, PaymentStatus } from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { recordAudit } from '@/server/modules/admin/audit';
import { isAdmin } from '@/server/modules/auth/roles';
import {
  assertCurrentTermsAccepted,
  evaluateRefundPolicy,
} from '@/server/modules/compliance';
import {
  removeRegistration,
  recomputePrizePool,
  registerCompetitorInTransaction,
} from '@/server/modules/tournament';
import { resolveTournamentConfig } from '@/server/modules/tournament/config';
import { razorpayWebhookSchema } from '@/lib/validation/payment.schema';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors';
import {
  checkoutSecret,
  getRazorpayGateway,
  razorpayFakeModeEnabled,
  razorpayKeyId,
  webhookSecret,
  type RazorpayGateway,
  type RazorpayPayment,
} from './gateway';
import { checkoutSignaturePayload, verifyHmacSha256Hex } from './signature';

/**
 * Payment core (E9).
 *
 * Razorpay order/payment state and tournament registration activation live
 * together here, but the registration rules stay in the Tournament module.
 * Confirmation calls `registerCompetitorInTransaction` inside the same
 * transaction that marks the payment paid.
 */

const REUSABLE_STATUSES: PaymentStatus[] = ['CREATED', 'PENDING'];

export interface CheckoutOrder {
  paymentId: string;
  razorpayKeyId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  reused: boolean;
}

export interface ConfirmCheckoutInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

export interface PaymentActivationResult {
  payment: Payment;
  registrationId: string | null;
  participantCount: number | null;
  applied: boolean;
}

export interface PaymentListFilters {
  tournamentId?: string;
  status?: PaymentStatus;
  user?: string;
  take?: number;
}

export interface AdminPaymentRow {
  id: string;
  tournamentId: string;
  tournamentName: string;
  userId: string;
  username: string;
  email: string;
  provider: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  signatureVerified: boolean;
  paidAt: Date | null;
  refundedAt: Date | null;
  providerRefundId: string | null;
  refundIntentId: string | null;
  refundIntentAt: Date | null;
  refundFailedAt: Date | null;
  refundRequiredAt: Date | null;
  refundReason: string | null;
  registrationStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebhookEventRow {
  id: string;
  providerEventId: string;
  eventType: string;
  paymentId: string | null;
  paymentLabel: string | null;
  signatureVerified: boolean;
  outcome: 'APPLIED' | 'DEDUPED' | 'IGNORED' | 'REJECTED';
  errorMessage: string | null;
  receivedAt: Date;
}

export type RazorpayWebhookEventName =
  | 'payment.captured'
  | 'payment.authorized'
  | 'payment.failed'
  | 'refund.processed';

export interface RazorpayWebhookPayload {
  event: RazorpayWebhookEventName | string;
  id?: string;
  payload?: {
    payment?: { entity?: Record<string, unknown> };
    refund?: { entity?: Record<string, unknown> };
  };
}

function paymentEventId(payload: RazorpayWebhookPayload): string {
  const id = payload.id;
  if (typeof id === 'string' && id.length > 0) return id;
  throw new ValidationError('Razorpay webhook is missing an event id');
}

function fallbackEventId(rawBody: string): string {
  return `unparseable:${Buffer.from(rawBody).toString('base64url').slice(0, 96)}`;
}

function unsafeWebhookEventId(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as { id?: unknown };
    return typeof parsed.id === 'string' && parsed.id.length > 0
      ? parsed.id
      : fallbackEventId(rawBody);
  } catch {
    return fallbackEventId(rawBody);
  }
}

function rejectedWebhookEventId(rawBody: string): string {
  const digest = createHash('sha256').update(rawBody).digest('hex');
  return `rejected:${digest}:${unsafeWebhookEventId(rawBody)}:${randomUUID()}`;
}

function rawPayloadJson(rawBody: string): Prisma.InputJsonValue {
  try {
    return JSON.parse(rawBody) as Prisma.InputJsonValue;
  } catch {
    return { rawBody };
  }
}

async function recordRejectedWebhookEvent(
  rawBody: string,
  signatureVerified: boolean,
  errorMessage: string,
): Promise<void> {
  await db.webhookEvent.create({
    data: {
      providerEventId: rejectedWebhookEventId(rawBody),
      eventType: 'unknown',
      rawPayload: rawPayloadJson(rawBody),
      signatureVerified,
      outcome: 'REJECTED',
      errorMessage,
    },
  });
}

function providerPaymentFromEntity(
  entity: Record<string, unknown> | undefined,
): RazorpayPayment {
  if (!entity) throw new ValidationError('Razorpay webhook is missing payment');
  return {
    id: String(entity.id ?? ''),
    orderId: String(entity.order_id ?? ''),
    amount: Number(entity.amount ?? 0),
    currency: String(entity.currency ?? 'INR'),
    status: String(entity.status ?? 'created') as RazorpayPayment['status'],
  };
}

function refundPaymentId(entity: Record<string, unknown> | undefined): string {
  const paymentId = entity?.payment_id;
  if (typeof paymentId !== 'string' || paymentId.length === 0) {
    throw new ValidationError('Razorpay refund webhook is missing payment_id');
  }
  return paymentId;
}

function isPaidState(status: RazorpayPayment['status']): boolean {
  return status === 'captured';
}

function isAuthorizedState(status: RazorpayPayment['status']): boolean {
  return status === 'authorized';
}

function isPostCaptureRegistrationConflict(
  error: unknown,
): error is ConflictError {
  if (!(error instanceof ConflictError)) return false;
  return [
    'already registered',
    'registration is not open',
    'registration has closed',
    'registration has not opened',
    'tournament is full',
  ].some((message) => error.message.includes(message));
}

async function assertCanCreateOrder(
  tx: DbClient,
  tournamentId: string,
  userId: string,
) {
  const tournament = await tx.tournament.findUnique({
    where: { id: tournamentId },
    select: {
      id: true,
      status: true,
      registrationOpensAt: true,
      registrationClosesAt: true,
      passPriceMinor: true,
      currency: true,
      participantCount: true,
      bracketSize: true,
      thirdPlaceEnabled: true,
      minRegistrations: true,
      maxRegistrations: true,
      roundDurations: true,
    },
  });
  if (!tournament) throw new NotFoundError('Tournament not found');
  if (tournament.status !== 'REGISTRATION_OPEN') {
    throw new ConflictError('Registration is not open for this tournament');
  }
  if (tournament.passPriceMinor <= 0) {
    throw new ConflictError(
      'This tournament is free. Use the free registration path instead of creating a payment order.',
    );
  }
  await assertCurrentTermsAccepted(userId, tx);

  const now = new Date();
  if (tournament.registrationOpensAt && now < tournament.registrationOpensAt) {
    throw new ConflictError('Registration has not opened yet');
  }
  if (
    tournament.registrationClosesAt &&
    now > tournament.registrationClosesAt
  ) {
    throw new ConflictError('Registration has closed');
  }

  const active = await tx.registration.findUnique({
    where: { userId_tournamentId: { userId, tournamentId } },
    select: { status: true, paymentId: true },
  });
  if (active?.status === 'ACTIVE') {
    throw new ConflictError('Already registered for this tournament');
  }

  const config = resolveTournamentConfig(tournament);
  if (tournament.participantCount >= config.maxRegistrations) {
    throw new ConflictError(
      `Tournament is full (${config.maxRegistrations} registrations)`,
    );
  }

  return tournament;
}

async function recordPaymentOpsEvent(
  client: DbClient,
  payment: Payment,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.opsEvent.upsert({
    where: { idempotencyKey: `payment:${payment.id}:${type}` },
    update: {
      status: 'DONE',
      completedAt: new Date(),
      result: payload as Prisma.InputJsonValue,
    },
    create: {
      tournamentId: payment.tournamentId,
      type,
      scheduledFor: new Date(),
      status: 'DONE',
      idempotencyKey: `payment:${payment.id}:${type}`,
      runBy: 'payment',
      payload: payload as Prisma.InputJsonValue,
      completedAt: new Date(),
    },
  });
}

async function createWebhookEvent(
  client: DbClient,
  input: {
    eventId: string;
    eventType: string;
    paymentId: string | null;
    rawBody: string;
    outcome: WebhookEventRow['outcome'];
    errorMessage?: string | null;
  },
): Promise<void> {
  await client.webhookEvent.create({
    data: {
      providerEventId: input.eventId,
      eventType: input.eventType,
      paymentId: input.paymentId,
      rawPayload: rawPayloadJson(input.rawBody),
      signatureVerified: true,
      outcome: input.outcome,
      errorMessage: input.errorMessage ?? null,
    },
  });
}

async function markCapturedPaymentRefundRequired(
  client: DbClient,
  payment: Payment,
  providerPayment: RazorpayPayment,
  eventId: string | null,
  reason: string,
  options: { actorId?: string | null } = {},
): Promise<PaymentActivationResult> {
  const paidAt = new Date();
  const updated = await client.payment.update({
    where: { id: payment.id },
    data: {
      status: 'PAID',
      providerPaymentId: providerPayment.id,
      signatureVerified: true,
      webhookEventId: eventId ?? payment.webhookEventId,
      paidAt: payment.paidAt ?? paidAt,
      refundRequiredAt: paidAt,
      refundReason: reason,
    },
  });
  await recordAudit(
    {
      actorId: options.actorId ?? payment.userId,
      action: 'payment.activationConflict',
      entityType: 'Payment',
      entityId: payment.id,
      before: { status: payment.status },
      after: {
        status: 'PAID',
        providerPaymentId: providerPayment.id,
        refundRequiredAt: paidAt,
        reason,
      },
    },
    client,
  );
  await recordPaymentOpsEvent(client, updated, 'payment.refundRequired', {
    providerPaymentId: providerPayment.id,
    reason,
  });
  return {
    payment: updated,
    registrationId: null,
    participantCount: null,
    applied: false,
  };
}

async function markPaymentSuperseded(
  client: DbClient,
  payment: Payment,
  type: string,
  reason: string,
  supersededByPaymentId: string | null = null,
): Promise<Payment> {
  const updated = await client.payment.update({
    where: { id: payment.id },
    data: {
      status: 'FAILED',
      supersededAt: new Date(),
      supersededByPaymentId,
      refundReason: reason,
    },
  });
  await recordAudit(
    {
      actorId: payment.userId,
      action: type,
      entityType: 'Payment',
      entityId: payment.id,
      before: {
        status: payment.status,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
      },
      after: {
        status: 'FAILED',
        supersededByPaymentId,
        reason,
      },
    },
    client,
  );
  await recordPaymentOpsEvent(client, updated, type, {
    reason,
    supersededByPaymentId,
  });
  return updated;
}

export async function createPassOrder(
  tournamentId: string,
  userId: string,
  options: { gateway?: RazorpayGateway; actorId?: string | null } = {},
): Promise<CheckoutOrder> {
  const gateway = options.gateway ?? getRazorpayGateway();

  const reusable = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`payment:${userId}:${tournamentId}`}))`,
      );

      const tournament = await assertCanCreateOrder(tx, tournamentId, userId);
      const existing = await tx.payment.findFirst({
        where: {
          userId,
          tournamentId,
          status: { in: REUSABLE_STATUSES },
        },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        if (
          existing.amountMinor === tournament.passPriceMinor &&
          existing.currency === tournament.currency
        ) {
          return {
            payment: existing,
            create: null,
            reused: true,
          };
        }

        await markPaymentSuperseded(
          tx,
          existing,
          'payment.orderSuperseded',
          'Tournament pass price or currency changed before checkout',
        );
      }

      return {
        payment: null,
        create: {
          amountMinor: tournament.passPriceMinor,
          currency: tournament.currency,
          receipt: `pass:${tournamentId}:${userId}`,
        },
        reused: false,
      };
    },
    { timeout: 15_000, maxWait: 15_000 },
  );

  if (reusable.payment) {
    return {
      paymentId: reusable.payment.id,
      razorpayKeyId: razorpayKeyId(),
      orderId: reusable.payment.providerOrderId,
      amountMinor: reusable.payment.amountMinor,
      currency: reusable.payment.currency,
      reused: true,
    };
  }

  const order = await gateway.createOrder(reusable.create!);

  const payment = await db.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`payment:${userId}:${tournamentId}`}))`,
    );
    const existing = await tx.payment.findFirst({
      where: { userId, tournamentId, status: { in: REUSABLE_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      const tournament = await assertCanCreateOrder(tx, tournamentId, userId);
      if (
        existing.amountMinor === tournament.passPriceMinor &&
        existing.currency === tournament.currency
      ) {
        return existing;
      }
      await markPaymentSuperseded(
        tx,
        existing,
        'payment.orderSuperseded',
        'Tournament pass price or currency changed before checkout',
      );
    }

    const created = await tx.payment.create({
      data: {
        userId,
        tournamentId,
        providerOrderId: order.id,
        amountMinor: order.amount,
        currency: order.currency,
        status: 'CREATED',
      },
    });
    await recordAudit(
      {
        actorId: options.actorId ?? userId,
        action: 'payment.orderCreated',
        entityType: 'Payment',
        entityId: created.id,
        after: {
          userId,
          tournamentId,
          providerOrderId: order.id,
          amountMinor: order.amount,
          currency: order.currency,
        },
      },
      tx,
    );
    await recordPaymentOpsEvent(tx, created, 'payment.orderCreated', {
      providerOrderId: order.id,
    });
    return created;
  });

  return {
    paymentId: payment.id,
    razorpayKeyId: razorpayKeyId(),
    orderId: payment.providerOrderId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    reused: false,
  };
}

async function activatePaidPayment(
  tx: Prisma.TransactionClient,
  paymentId: string,
  providerPayment: RazorpayPayment,
  eventId: string | null,
  options: { actorId?: string | null } = {},
): Promise<PaymentActivationResult> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`payment:${paymentId}`}))`,
  );
  const payment = await tx.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new NotFoundError('Payment not found');

  if (payment.status === 'PAID') {
    const activeRegistration = await tx.registration.findUnique({
      where: {
        userId_tournamentId: {
          userId: payment.userId,
          tournamentId: payment.tournamentId,
        },
      },
      select: { id: true, status: true, paymentId: true },
    });
    return {
      payment,
      registrationId:
        activeRegistration?.status === 'ACTIVE' &&
        activeRegistration.paymentId === payment.id
          ? activeRegistration.id
          : null,
      participantCount: null,
      applied: false,
    } as PaymentActivationResult;
  }
  if (
    payment.status === 'REFUNDED' ||
    payment.status === 'PENDING_REFUND' ||
    payment.status === 'REFUND_FAILED'
  ) {
    return {
      payment,
      registrationId: null,
      participantCount: null,
      applied: false,
    };
  }
  if (payment.amountMinor !== providerPayment.amount) {
    throw new ConflictError(
      'Payment amount does not match the tournament pass',
    );
  }
  if (payment.currency !== providerPayment.currency) {
    throw new ConflictError(
      'Payment currency does not match the tournament pass',
    );
  }

  const paidAt = new Date();
  const activeRegistration = await tx.registration.findUnique({
    where: {
      userId_tournamentId: {
        userId: payment.userId,
        tournamentId: payment.tournamentId,
      },
    },
    select: { id: true, status: true, paymentId: true },
  });
  if (
    activeRegistration?.status === 'ACTIVE' &&
    activeRegistration.paymentId === payment.id
  ) {
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        providerPaymentId: providerPayment.id,
        signatureVerified: true,
        webhookEventId: eventId ?? payment.webhookEventId,
        paidAt: payment.paidAt ?? paidAt,
      },
    });
    return {
      payment: updated,
      registrationId: activeRegistration.id,
      participantCount: null,
      applied: false,
    };
  }
  if (
    activeRegistration?.status === 'ACTIVE' &&
    activeRegistration.paymentId !== payment.id
  ) {
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PAID',
        providerPaymentId: providerPayment.id,
        signatureVerified: true,
        webhookEventId: eventId ?? payment.webhookEventId,
        paidAt,
        supersededAt: paidAt,
        supersededByPaymentId: activeRegistration.paymentId,
        refundRequiredAt: paidAt,
        refundReason:
          'Late captured payment arrived after another payment activated this registration',
      },
    });
    await recordAudit(
      {
        actorId: payment.userId,
        action: 'payment.paidSuperseded',
        entityType: 'Payment',
        entityId: payment.id,
        before: { status: payment.status },
        after: {
          status: 'PAID',
          providerPaymentId: providerPayment.id,
          registrationId: activeRegistration.id,
          supersededByPaymentId: activeRegistration.paymentId,
          refundRequiredAt: paidAt,
        },
      },
      tx,
    );
    await recordPaymentOpsEvent(tx, updated, 'payment.refundRequired', {
      providerPaymentId: providerPayment.id,
      registrationId: activeRegistration.id,
      supersededByPaymentId: activeRegistration.paymentId,
      reason:
        'Late captured payment arrived after another payment activated this registration',
    });
    return {
      payment: updated,
      registrationId: activeRegistration.id,
      participantCount: null,
      applied: false,
    };
  }

  const updated = await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: 'PAID',
      providerPaymentId: providerPayment.id,
      signatureVerified: true,
      webhookEventId: eventId ?? payment.webhookEventId,
      paidAt,
    },
  });
  const registration = await registerCompetitorInTransaction(
    tx,
    payment.tournamentId,
    payment.userId,
    { actorId: payment.userId, paymentId: payment.id },
  );
  await recordAudit(
    {
      actorId: options.actorId ?? payment.userId,
      action: 'payment.paid',
      entityType: 'Payment',
      entityId: payment.id,
      before: { status: payment.status },
      after: {
        status: 'PAID',
        providerPaymentId: providerPayment.id,
        registrationId: registration.registration.id,
      },
    },
    tx,
  );
  await recordPaymentOpsEvent(tx, updated, 'payment.paid', {
    providerPaymentId: providerPayment.id,
    registrationId: registration.registration.id,
  });
  await recomputePrizePool(payment.tournamentId, tx);
  return {
    payment: updated,
    registrationId: registration.registration.id,
    participantCount: registration.participantCount,
    applied: true,
  };
}

async function activateCapturedPayment(
  paymentId: string,
  providerPayment: RazorpayPayment,
  eventId: string | null,
  options: { actorId?: string | null } = {},
): Promise<PaymentActivationResult> {
  try {
    return await db.$transaction((tx) =>
      activatePaidPayment(tx, paymentId, providerPayment, eventId, options),
    );
  } catch (error) {
    if (!isPostCaptureRegistrationConflict(error)) throw error;
    const payment = await db.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundError('Payment not found');
    return db.$transaction((tx) =>
      markCapturedPaymentRefundRequired(
        tx,
        payment,
        providerPayment,
        eventId,
        error.message,
        options,
      ),
    );
  }
}

async function markPaymentFailedInTransaction(
  tx: Prisma.TransactionClient,
  payment: Payment,
  providerPaymentId: string | null,
  eventId?: string | null,
): Promise<{ payment: Payment; applied: boolean }> {
  if (
    payment.status === 'PAID' ||
    payment.status === 'REFUNDED' ||
    payment.status === 'PENDING_REFUND' ||
    payment.status === 'REFUND_FAILED'
  ) {
    return { payment, applied: false };
  }
  if (payment.status === 'FAILED') {
    return { payment, applied: false };
  }
  const failed = await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: 'FAILED',
      providerPaymentId: providerPaymentId ?? payment.providerPaymentId,
      webhookEventId: eventId ?? payment.webhookEventId,
    },
  });
  await recordAudit(
    {
      actorId: payment.userId,
      action: 'payment.failed',
      entityType: 'Payment',
      entityId: payment.id,
      before: { status: payment.status },
      after: { status: 'FAILED', providerPaymentId },
    },
    tx,
  );
  await recordPaymentOpsEvent(tx, failed, 'payment.failed', {
    providerPaymentId,
  });
  return { payment: failed, applied: true };
}

async function markPaymentPendingInTransaction(
  tx: Prisma.TransactionClient,
  payment: Payment,
  providerPaymentId: string | null,
  eventId?: string | null,
): Promise<{ payment: Payment; applied: boolean }> {
  if (
    payment.status === 'PAID' ||
    payment.status === 'REFUNDED' ||
    payment.status === 'PENDING_REFUND' ||
    payment.status === 'REFUND_FAILED'
  ) {
    return { payment, applied: false };
  }
  if (payment.status === 'PENDING') {
    return { payment, applied: false };
  }
  const pending = await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: 'PENDING',
      providerPaymentId: providerPaymentId ?? payment.providerPaymentId,
      signatureVerified: true,
      webhookEventId: eventId ?? payment.webhookEventId,
    },
  });
  await recordAudit(
    {
      actorId: payment.userId,
      action: 'payment.authorized',
      entityType: 'Payment',
      entityId: payment.id,
      before: { status: payment.status },
      after: { status: 'PENDING', providerPaymentId },
    },
    tx,
  );
  await recordPaymentOpsEvent(tx, pending, 'payment.authorized', {
    providerPaymentId,
  });
  return { payment: pending, applied: true };
}

async function refundPaymentInTransaction(
  tx: Prisma.TransactionClient,
  payment: Payment,
  options: {
    actorId?: string | null;
    providerPaymentId?: string | null;
    providerRefundId?: string | null;
    eventId?: string | null;
    reason?: string | null;
  } = {},
): Promise<{ payment: Payment; applied: boolean }> {
  if (payment.status === 'REFUNDED') {
    return { payment, applied: false };
  }
  if (payment.status !== 'PAID' && payment.status !== 'PENDING_REFUND') {
    return { payment, applied: false };
  }
  const refundedAt = new Date();
  const refunded = await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: 'REFUNDED',
      webhookEventId: options.eventId ?? payment.webhookEventId,
      refundedAt,
      providerRefundId: options.providerRefundId,
      refundReason: options.reason ?? payment.refundReason,
    },
  });
  const registrationUpdate = await tx.registration.updateMany({
    where: { paymentId: payment.id, status: 'ACTIVE' },
    data: { status: 'REFUNDED' },
  });
  if (registrationUpdate.count > 0) {
    await tx.tournament.updateMany({
      where: {
        id: payment.tournamentId,
        participantCount: { gt: 0 },
      },
      data: { participantCount: { decrement: 1 } },
    });
  }
  await recomputePrizePool(payment.tournamentId, tx);
  await recordAudit(
    {
      actorId: options.actorId ?? payment.userId,
      action: 'payment.refunded',
      entityType: 'Payment',
      entityId: payment.id,
      before: { status: 'PAID' },
      after: { status: 'REFUNDED', reason: options.reason ?? null },
    },
    tx,
  );
  await recordPaymentOpsEvent(tx, refunded, 'payment.refunded', {
    providerPaymentId: options.providerPaymentId ?? payment.providerPaymentId,
    reason: options.reason ?? null,
  });
  return { payment: refunded, applied: true };
}

export async function confirmCheckout(
  input: ConfirmCheckoutInput,
  options: { gateway?: RazorpayGateway } = {},
): Promise<PaymentActivationResult> {
  const verified = verifyHmacSha256Hex(
    checkoutSignaturePayload(input.razorpayOrderId, input.razorpayPaymentId),
    input.razorpaySignature,
    checkoutSecret(),
  );
  if (!verified) {
    throw new ForbiddenError('Invalid Razorpay checkout signature');
  }

  const gateway = options.gateway ?? getRazorpayGateway();
  const providerPayment = await gateway.fetchPayment(input.razorpayPaymentId);
  const payment = await db.payment.findUnique({
    where: { providerOrderId: input.razorpayOrderId },
  });
  if (!payment) throw new NotFoundError('Payment order not found');
  if (providerPayment.orderId !== payment.providerOrderId) {
    throw new ConflictError('Payment does not belong to this order');
  }

  if (isAuthorizedState(providerPayment.status)) {
    await db.$transaction((tx) =>
      markPaymentPendingInTransaction(tx, payment, providerPayment.id),
    );
    throw new ConflictError('Payment was authorized but not captured');
  }

  if (!isPaidState(providerPayment.status)) {
    await markPaymentFailed(payment, providerPayment.id);
    throw new ConflictError('Payment was not captured');
  }

  return activateCapturedPayment(payment.id, providerPayment, null);
}

export async function markPaymentFailed(
  payment: Payment,
  providerPaymentId: string | null,
  eventId?: string | null,
): Promise<Payment> {
  const result = await db.$transaction((tx) =>
    markPaymentFailedInTransaction(tx, payment, providerPaymentId, eventId),
  );
  return result.payment;
}

async function verifiedWebhookProviderPayment(
  gateway: RazorpayGateway,
  payloadPayment: RazorpayPayment,
  allowedStatuses: RazorpayPayment['status'][],
): Promise<RazorpayPayment> {
  if (razorpayFakeModeEnabled()) {
    if (!allowedStatuses.includes(payloadPayment.status)) {
      throw new ConflictError('Webhook payment state does not match event');
    }
    return payloadPayment;
  }
  const providerPayment = await gateway.fetchPayment(payloadPayment.id);
  if (providerPayment.id !== payloadPayment.id) {
    throw new ConflictError('Webhook payment id does not match Razorpay');
  }
  if (providerPayment.orderId !== payloadPayment.orderId) {
    throw new ConflictError('Webhook order id does not match Razorpay');
  }
  if (providerPayment.amount !== payloadPayment.amount) {
    throw new ConflictError('Webhook amount does not match Razorpay');
  }
  if (providerPayment.currency !== payloadPayment.currency) {
    throw new ConflictError('Webhook currency does not match Razorpay');
  }
  if (!allowedStatuses.includes(providerPayment.status)) {
    throw new ConflictError('Webhook payment state does not match Razorpay');
  }
  return providerPayment;
}

async function processAuthorizedRazorpayWebhook(input: {
  rawBody: string;
  payload: RazorpayWebhookPayload;
  eventId: string;
  gateway: RazorpayGateway;
}): Promise<{ processed: boolean; paymentId: string | null }> {
  const payloadPayment = providerPaymentFromEntity(
    input.payload.payload?.payment?.entity,
  );
  const providerPayment = await verifiedWebhookProviderPayment(
    input.gateway,
    payloadPayment,
    ['authorized'],
  );
  return db.$transaction(async (tx) => {
    const existingEvent = await tx.webhookEvent.findFirst({
      where: {
        providerEventId: input.eventId,
        signatureVerified: true,
        outcome: { in: ['APPLIED', 'DEDUPED', 'IGNORED'] },
      },
      select: { paymentId: true },
    });
    if (existingEvent) {
      return { processed: false, paymentId: existingEvent.paymentId };
    }

    const payment = await tx.payment.findUnique({
      where: { providerOrderId: providerPayment.orderId },
    });
    if (!payment) {
      await createWebhookEvent(tx, {
        eventId: input.eventId,
        eventType: input.payload.event,
        paymentId: null,
        rawBody: input.rawBody,
        outcome: 'IGNORED',
        errorMessage: 'Payment order not found',
      });
      return { processed: false, paymentId: null };
    }

    const result = await markPaymentPendingInTransaction(
      tx,
      payment,
      providerPayment.id,
      input.eventId,
    );
    await createWebhookEvent(tx, {
      eventId: input.eventId,
      eventType: input.payload.event,
      paymentId: payment.id,
      rawBody: input.rawBody,
      outcome: result.applied ? 'APPLIED' : 'DEDUPED',
    });
    return { processed: result.applied, paymentId: payment.id };
  });
}

async function processCapturedRazorpayWebhook(input: {
  rawBody: string;
  payload: RazorpayWebhookPayload;
  eventId: string;
  gateway: RazorpayGateway;
}): Promise<{ processed: boolean; paymentId: string | null }> {
  const payloadPayment = providerPaymentFromEntity(
    input.payload.payload?.payment?.entity,
  );
  const providerPayment = await verifiedWebhookProviderPayment(
    input.gateway,
    payloadPayment,
    ['captured'],
  );
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`webhook:${input.eventId}`}))`,
      );

      const existingEvent = await tx.webhookEvent.findFirst({
        where: {
          providerEventId: input.eventId,
          signatureVerified: true,
          outcome: { in: ['APPLIED', 'DEDUPED', 'IGNORED'] },
        },
        select: { paymentId: true },
      });
      if (existingEvent) {
        return { processed: false, paymentId: existingEvent.paymentId };
      }

      const payment = await tx.payment.findUnique({
        where: { providerOrderId: providerPayment.orderId },
      });
      if (!payment) {
        await createWebhookEvent(tx, {
          eventId: input.eventId,
          eventType: input.payload.event,
          paymentId: null,
          rawBody: input.rawBody,
          outcome: 'IGNORED',
          errorMessage: 'Payment order not found',
        });
        return { processed: false, paymentId: null };
      }

      const result = await activatePaidPayment(
        tx,
        payment.id,
        providerPayment,
        input.eventId,
      );
      await createWebhookEvent(tx, {
        eventId: input.eventId,
        eventType: input.payload.event,
        paymentId: payment.id,
        rawBody: input.rawBody,
        outcome:
          result.applied || result.payment.status !== payment.status
            ? 'APPLIED'
            : 'DEDUPED',
      });
      return { processed: result.applied, paymentId: payment.id };
    });
  } catch (error) {
    if (!isPostCaptureRegistrationConflict(error)) throw error;
    return db.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`webhook:${input.eventId}`}))`,
      );
      const existingEvent = await tx.webhookEvent.findFirst({
        where: {
          providerEventId: input.eventId,
          signatureVerified: true,
          outcome: { in: ['APPLIED', 'DEDUPED', 'IGNORED'] },
        },
        select: { paymentId: true },
      });
      if (existingEvent) {
        return { processed: false, paymentId: existingEvent.paymentId };
      }
      const payment = await tx.payment.findUnique({
        where: { providerOrderId: providerPayment.orderId },
      });
      if (!payment) {
        await createWebhookEvent(tx, {
          eventId: input.eventId,
          eventType: input.payload.event,
          paymentId: null,
          rawBody: input.rawBody,
          outcome: 'IGNORED',
          errorMessage: 'Payment order not found',
        });
        return { processed: false, paymentId: null };
      }
      const result = await markCapturedPaymentRefundRequired(
        tx,
        payment,
        providerPayment,
        input.eventId,
        error.message,
      );
      await createWebhookEvent(tx, {
        eventId: input.eventId,
        eventType: input.payload.event,
        paymentId: payment.id,
        rawBody: input.rawBody,
        outcome: 'APPLIED',
      });
      return { processed: result.applied, paymentId: payment.id };
    });
  }
}

export async function processRazorpayWebhook(
  rawBody: string,
  signature: string | null,
): Promise<{ processed: boolean; paymentId: string | null }> {
  if (!signature || !verifyHmacSha256Hex(rawBody, signature, webhookSecret())) {
    await recordRejectedWebhookEvent(
      rawBody,
      false,
      'Invalid Razorpay webhook signature',
    );
    throw new ForbiddenError('Invalid Razorpay webhook signature');
  }

  const rawPayload = rawPayloadJson(rawBody);
  const parsed = razorpayWebhookSchema.safeParse(rawPayload);
  if (!parsed.success) {
    await recordRejectedWebhookEvent(
      rawBody,
      true,
      parsed.error.issues[0]?.message ?? 'Invalid Razorpay webhook payload',
    );
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? 'Invalid Razorpay webhook payload',
    );
  }
  const payload = parsed.data as RazorpayWebhookPayload;
  const eventId = paymentEventId(payload);
  const gateway = getRazorpayGateway();

  if (payload.event === 'payment.authorized') {
    return processAuthorizedRazorpayWebhook({
      rawBody,
      payload,
      eventId,
      gateway,
    });
  }

  if (payload.event === 'payment.captured') {
    return processCapturedRazorpayWebhook({
      rawBody,
      payload,
      eventId,
      gateway,
    });
  }

  return db.$transaction(async (tx) => {
    const existingEvent = await tx.webhookEvent.findFirst({
      where: {
        providerEventId: eventId,
        signatureVerified: true,
        outcome: { in: ['APPLIED', 'DEDUPED', 'IGNORED'] },
      },
      select: { paymentId: true },
    });
    if (existingEvent) {
      return { processed: false, paymentId: existingEvent.paymentId };
    }

    const recordWebhook = (
      outcome: WebhookEventRow['outcome'],
      paymentId: string | null,
      errorMessage?: string | null,
    ) =>
      createWebhookEvent(tx, {
        eventId,
        eventType: payload.event,
        paymentId,
        rawBody,
        outcome,
        errorMessage,
      });

    switch (payload.event) {
      case 'payment.failed': {
        const providerPayment = providerPaymentFromEntity(
          payload.payload?.payment?.entity,
        );
        const payment = await tx.payment.findUnique({
          where: { providerOrderId: providerPayment.orderId },
        });
        if (!payment) {
          await recordWebhook('IGNORED', null, 'Payment order not found');
          return { processed: false, paymentId: null };
        }
        const result = await markPaymentFailedInTransaction(
          tx,
          payment,
          providerPayment.id,
          eventId,
        );
        await recordWebhook(result.applied ? 'APPLIED' : 'DEDUPED', payment.id);
        return { processed: result.applied, paymentId: payment.id };
      }

      case 'refund.processed': {
        const paymentId = refundPaymentId(payload.payload?.refund?.entity);
        const payment = await tx.payment.findUnique({
          where: { providerPaymentId: paymentId },
        });
        if (!payment) {
          await recordWebhook('IGNORED', null, 'Payment not found');
          return { processed: false, paymentId: null };
        }
        const result = await refundPaymentInTransaction(tx, payment, {
          providerPaymentId: paymentId,
          eventId,
        });
        await recordWebhook(result.applied ? 'APPLIED' : 'DEDUPED', payment.id);
        return { processed: result.applied, paymentId: payment.id };
      }

      default:
        await recordWebhook('IGNORED', null, 'Unhandled webhook event');
        return { processed: false, paymentId: null };
    }
  });
}

function paymentRow(
  payment: Payment & {
    tournament: { name: string };
    user: { username: string; email: string };
    registration: { status: string } | null;
  },
): AdminPaymentRow {
  return {
    id: payment.id,
    tournamentId: payment.tournamentId,
    tournamentName: payment.tournament.name,
    userId: payment.userId,
    username: payment.user.username,
    email: payment.user.email,
    provider: payment.provider,
    providerOrderId: payment.providerOrderId,
    providerPaymentId: payment.providerPaymentId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    status: payment.status,
    signatureVerified: payment.signatureVerified,
    paidAt: payment.paidAt,
    refundedAt: payment.refundedAt,
    providerRefundId: payment.providerRefundId,
    refundIntentId: payment.refundIntentId,
    refundIntentAt: payment.refundIntentAt,
    refundFailedAt: payment.refundFailedAt,
    refundRequiredAt: payment.refundRequiredAt,
    refundReason: payment.refundReason,
    registrationStatus: payment.registration?.status ?? null,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

export async function listPaymentsForAdmin(
  filters: PaymentListFilters = {},
  client: DbClient = db,
): Promise<AdminPaymentRow[]> {
  const userFilter = filters.user?.trim();
  const payments = await client.payment.findMany({
    where: {
      tournamentId: filters.tournamentId,
      status: filters.status,
      ...(userFilter
        ? {
            user: {
              OR: [
                { username: { contains: userFilter, mode: 'insensitive' } },
                { email: { contains: userFilter, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    },
    include: {
      tournament: { select: { name: true } },
      user: { select: { username: true, email: true } },
      registration: { select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: filters.take ?? 100,
  });
  return payments.map(paymentRow);
}

export async function getPaymentForAdmin(
  paymentId: string,
  client: DbClient = db,
): Promise<{
  payment: AdminPaymentRow;
  audit: Array<{
    action: string;
    before: unknown;
    after: unknown;
    createdAt: Date;
  }>;
  webhooks: WebhookEventRow[];
}> {
  const payment = await client.payment.findUnique({
    where: { id: paymentId },
    include: {
      tournament: { select: { name: true } },
      user: { select: { username: true, email: true } },
      registration: { select: { status: true } },
    },
  });
  if (!payment) throw new NotFoundError('Payment not found');
  const [audit, webhooks] = await Promise.all([
    client.auditLog.findMany({
      where: { entityType: 'Payment', entityId: payment.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { action: true, before: true, after: true, createdAt: true },
    }),
    listWebhookEventsForAdmin({ paymentId: payment.id, take: 50 }, client),
  ]);
  return { payment: paymentRow(payment), audit, webhooks };
}

export async function listWebhookEventsForAdmin(
  filters: { paymentId?: string; take?: number } = {},
  client: DbClient = db,
): Promise<WebhookEventRow[]> {
  const events = await client.webhookEvent.findMany({
    where: { paymentId: filters.paymentId },
    include: {
      payment: {
        select: {
          providerOrderId: true,
          user: { select: { username: true } },
        },
      },
    },
    orderBy: { receivedAt: 'desc' },
    take: filters.take ?? 100,
  });
  return events.map((event) => ({
    id: event.id,
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    paymentId: event.paymentId,
    paymentLabel: event.payment
      ? `${event.payment.user.username} / ${event.payment.providerOrderId}`
      : null,
    signatureVerified: event.signatureVerified,
    outcome: event.outcome,
    errorMessage: event.errorMessage,
    receivedAt: event.receivedAt,
  }));
}

function adminRefundIdempotencyKey(paymentId: string): string {
  return `payment:${paymentId}:admin-refund`;
}

async function claimAdminRefundIntent(
  paymentId: string,
  admin: { id: string; role: 'USER' | 'ADMIN' },
  reason: string,
): Promise<{
  payment: Payment;
  providerPaymentId: string | null;
  idempotencyKey: string;
  shouldCallProvider: boolean;
}> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`payment:${paymentId}:refund`}))`,
    );

    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundError('Payment not found');
    if (payment.status === 'REFUNDED') {
      return {
        payment,
        providerPaymentId: payment.providerPaymentId,
        idempotencyKey: adminRefundIdempotencyKey(payment.id),
        shouldCallProvider: false,
      };
    }
    if (payment.status === 'PENDING_REFUND') {
      const idempotencyKey =
        payment.refundIntentId ?? adminRefundIdempotencyKey(payment.id);
      const intent = await tx.opsEvent.findUnique({
        where: { idempotencyKey },
      });
      return {
        payment,
        providerPaymentId: payment.providerPaymentId,
        idempotencyKey,
        shouldCallProvider:
          intent?.status !== 'DONE' && intent?.status !== 'RUNNING',
      };
    }
    if (payment.status === 'REFUND_FAILED') {
      const providerPaymentId = payment.providerPaymentId;
      if (!providerPaymentId) {
        throw new ConflictError(
          'Payment cannot be refunded without provider id',
        );
      }
      const idempotencyKey =
        payment.refundIntentId ?? adminRefundIdempotencyKey(payment.id);
      const now = new Date();
      const pending = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PENDING_REFUND',
          refundIntentId: idempotencyKey,
          refundIntentAt: payment.refundIntentAt ?? now,
          refundFailedAt: null,
          refundReason: reason,
        },
      });
      await tx.opsEvent.upsert({
        where: { idempotencyKey },
        update: {
          status: 'SCHEDULED',
          scheduledFor: now,
          startedAt: null,
          completedAt: null,
          error: null,
          result: Prisma.JsonNull,
          payload: {
            paymentId: payment.id,
            providerPaymentId,
            amountMinor: payment.amountMinor,
            reason,
          },
        },
        create: {
          tournamentId: payment.tournamentId,
          type: 'payment.refundIntent',
          scheduledFor: now,
          status: 'SCHEDULED',
          idempotencyKey,
          runBy: admin.id,
          payload: {
            paymentId: payment.id,
            providerPaymentId,
            amountMinor: payment.amountMinor,
            reason,
          },
        },
      });
      await recordAudit(
        {
          actorId: admin.id,
          action: 'payment.refundRetryPending',
          entityType: 'Payment',
          entityId: payment.id,
          before: { status: payment.status },
          after: { status: 'PENDING_REFUND', refundIntentId: idempotencyKey },
        },
        tx,
      );
      return {
        payment: pending,
        providerPaymentId,
        idempotencyKey,
        shouldCallProvider: true,
      };
    }

    const policy = evaluateRefundPolicy(payment);
    if (!policy.allowed) throw new ConflictError(policy.reason);
    const providerPaymentId = payment.providerPaymentId;
    if (!providerPaymentId) throw new ConflictError(policy.reason);

    const idempotencyKey = adminRefundIdempotencyKey(payment.id);
    const now = new Date();
    const pending = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'PENDING_REFUND',
        refundIntentId: idempotencyKey,
        refundIntentAt: now,
        refundFailedAt: null,
        refundReason: reason,
      },
    });
    await tx.opsEvent.upsert({
      where: { idempotencyKey },
      update: {
        status: 'SCHEDULED',
        scheduledFor: now,
        startedAt: null,
        completedAt: null,
        error: null,
        result: Prisma.JsonNull,
        payload: {
          paymentId: payment.id,
          providerPaymentId,
          amountMinor: payment.amountMinor,
          reason,
        },
      },
      create: {
        tournamentId: payment.tournamentId,
        type: 'payment.refundIntent',
        scheduledFor: now,
        status: 'SCHEDULED',
        idempotencyKey,
        runBy: admin.id,
        payload: {
          paymentId: payment.id,
          providerPaymentId,
          amountMinor: payment.amountMinor,
          reason,
        },
      },
    });
    await recordAudit(
      {
        actorId: admin.id,
        action: 'payment.refundPending',
        entityType: 'Payment',
        entityId: payment.id,
        before: { status: payment.status },
        after: { status: 'PENDING_REFUND', refundIntentId: idempotencyKey },
      },
      tx,
    );
    return {
      payment: pending,
      providerPaymentId,
      idempotencyKey,
      shouldCallProvider: true,
    };
  });
}

async function markRefundProviderCallStarted(input: {
  payment: Payment;
  idempotencyKey: string;
}): Promise<boolean> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`payment:${input.payment.id}:refund`}))`,
    );
    const payment = await tx.payment.findUnique({
      where: { id: input.payment.id },
    });
    if (!payment || payment.status !== 'PENDING_REFUND') return false;
    const intent = await tx.opsEvent.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (intent?.status === 'DONE' || intent?.status === 'RUNNING') {
      return false;
    }
    await tx.opsEvent.update({
      where: { idempotencyKey: input.idempotencyKey },
      data: {
        status: 'RUNNING',
        runBy: intent?.runBy ?? payment.userId,
        startedAt: new Date(),
        error: null,
      },
    });
    return true;
  });
}

async function recordRefundProviderSuccess(input: {
  payment: Payment;
  idempotencyKey: string;
  refund: Awaited<ReturnType<RazorpayGateway['refund']>>;
}): Promise<void> {
  await db.opsEvent.update({
    where: { idempotencyKey: input.idempotencyKey },
    data: {
      status: 'DONE',
      completedAt: new Date(),
      result: {
        refundId: input.refund.id,
        providerPaymentId: input.refund.paymentId,
        amountMinor: input.refund.amount,
        currency: input.refund.currency,
        status: input.refund.status,
      },
    },
  });
}

async function markRefundProviderFailure(input: {
  payment: Payment;
  idempotencyKey: string;
  error: unknown;
}): Promise<Payment> {
  const message =
    input.error instanceof Error ? input.error.message : String(input.error);
  return db.$transaction(async (tx) => {
    const failed = await tx.payment.update({
      where: { id: input.payment.id },
      data: {
        status: 'REFUND_FAILED',
        refundFailedAt: new Date(),
        refundReason: message,
      },
    });
    await tx.opsEvent.update({
      where: { idempotencyKey: input.idempotencyKey },
      data: { status: 'FAILED', error: message },
    });
    await recordAudit(
      {
        actorId: input.payment.userId,
        action: 'payment.refundFailed',
        entityType: 'Payment',
        entityId: input.payment.id,
        before: { status: 'PENDING_REFUND' },
        after: { status: 'REFUND_FAILED', reason: message },
      },
      tx,
    );
    return failed;
  });
}

async function finalizePendingRefund(input: {
  paymentId: string;
  admin: { id: string; role: 'USER' | 'ADMIN' };
  providerPaymentId: string | null;
  providerRefundId?: string | null;
  reason: string;
  simulateFinalizeFailure?: boolean;
}): Promise<Payment> {
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`payment:${input.paymentId}:refund`}))`,
    );
    if (input.simulateFinalizeFailure) {
      throw new Error('Injected refund finalization failure');
    }
    const payment = await tx.payment.findUnique({
      where: { id: input.paymentId },
    });
    if (!payment) throw new NotFoundError('Payment not found');
    return refundPaymentInTransaction(tx, payment, {
      actorId: input.admin.id,
      providerPaymentId: input.providerPaymentId,
      providerRefundId: input.providerRefundId,
      reason: input.reason,
    });
  });
  return result.payment;
}

export async function refundPaymentForAdmin(
  paymentId: string,
  admin: { id: string; role: 'USER' | 'ADMIN' },
  reason: string,
  options: {
    gateway?: RazorpayGateway;
    simulateInterruptAfterIntent?: boolean;
    simulateFinalizeFailure?: boolean;
  } = {},
): Promise<Payment> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');
  const gateway = options.gateway ?? getRazorpayGateway();
  const intent = await claimAdminRefundIntent(paymentId, admin, reason);
  if (!intent.shouldCallProvider) return intent.payment;
  if (!intent.providerPaymentId) {
    throw new ConflictError('Payment cannot be refunded without provider id');
  }
  if (options.simulateInterruptAfterIntent) {
    throw new Error('Injected refund interruption after intent claim');
  }
  const providerCallStarted = await markRefundProviderCallStarted({
    payment: intent.payment,
    idempotencyKey: intent.idempotencyKey,
  });
  if (!providerCallStarted) return intent.payment;

  let refund: Awaited<ReturnType<RazorpayGateway['refund']>>;
  try {
    refund = await gateway.refund({
      paymentId: intent.providerPaymentId,
      amountMinor: intent.payment.amountMinor,
      idempotencyKey: intent.idempotencyKey,
    });
  } catch (error) {
    return markRefundProviderFailure({
      payment: intent.payment,
      idempotencyKey: intent.idempotencyKey,
      error,
    });
  }
  await recordRefundProviderSuccess({
    payment: intent.payment,
    idempotencyKey: intent.idempotencyKey,
    refund,
  });
  return finalizePendingRefund({
    paymentId: intent.payment.id,
    admin,
    providerPaymentId: refund.paymentId,
    providerRefundId: refund.id,
    reason,
    simulateFinalizeFailure: options.simulateFinalizeFailure,
  });
}

export async function reconcilePendingRefundForAdmin(
  paymentId: string,
  admin: { id: string; role: 'USER' | 'ADMIN' },
  reason = 'Reconciled pending provider refund',
): Promise<Payment> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new NotFoundError('Payment not found');
  if (payment.status === 'REFUNDED') return payment;
  if (payment.status !== 'PENDING_REFUND' || !payment.refundIntentId) {
    throw new ConflictError('Payment does not have a pending refund intent');
  }
  const intent = await db.opsEvent.findUnique({
    where: { idempotencyKey: payment.refundIntentId },
  });
  const result =
    typeof intent?.result === 'object' && intent.result !== null
      ? (intent.result as Record<string, unknown>)
      : null;
  const providerPaymentId =
    typeof result?.providerPaymentId === 'string'
      ? result.providerPaymentId
      : payment.providerPaymentId;
  const providerRefundId =
    typeof result?.refundId === 'string' ? result.refundId : null;
  if (intent?.status !== 'DONE' || !providerPaymentId) {
    throw new ConflictError(
      'Pending refund has no provider success to finalize',
    );
  }
  return finalizePendingRefund({
    paymentId,
    admin,
    providerPaymentId,
    providerRefundId,
    reason,
  });
}

export async function markManualPaymentPaidForAdmin(
  paymentId: string,
  admin: { id: string; role: 'USER' | 'ADMIN' },
): Promise<PaymentActivationResult> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');
  const payment = await db.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new NotFoundError('Payment not found');
  if (payment.status === 'REFUNDED') {
    throw new ConflictError('Refunded payments cannot be marked paid');
  }
  const providerPayment: RazorpayPayment = {
    id: payment.providerPaymentId ?? `manual:${payment.id}`,
    orderId: payment.providerOrderId,
    amount: payment.amountMinor,
    currency: payment.currency,
    status: 'captured',
  };
  return db.$transaction((tx) =>
    activatePaidPayment(tx, payment.id, providerPayment, null, {
      actorId: admin.id,
    }),
  );
}

export async function cancelRegistrationForAdmin(
  tournamentId: string,
  userId: string,
  admin: { id: string; role: 'USER' | 'ADMIN' },
  reason: string,
) {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');
  return removeRegistration(tournamentId, userId, admin, reason);
}
