'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/server/modules/auth';
import {
  configureTournament,
  createTournament,
  listRegistrations,
  removeRegistration,
  recomputePrizePool,
  setTournamentArchived,
  startSuddenDeath,
  updateTournament,
  updateTournamentSchedule,
} from '@/server/modules/tournament';
import {
  addHiddenTest,
  archiveProblem,
  assignProblemToRound,
  createProblem,
  publishProblem,
  removeHiddenTest,
  updateProblem,
} from '@/server/modules/problem';
import { recordAudit } from '@/server/modules/admin/audit';
import {
  deleteUser,
  listAuditLog,
  listUsers,
  setTesterRole,
} from '@/server/modules/admin/directory';
import {
  cancelRegistrationForAdmin,
  getPaymentForAdmin,
  listPaymentsForAdmin,
  listWebhookEventsForAdmin,
  markManualPaymentPaidForAdmin,
  refundPaymentForAdmin,
} from '@/server/modules/payment';
import {
  adminPaymentIdSchema,
  addHiddenTestFormSchema,
  archiveTournamentSchema,
  assignProblemSchema,
  createProblemFormSchema,
  configureTournamentFormSchema,
  createTournamentFormSchema,
  deleteUserSchema,
  hiddenTestIdSchema,
  listAuditSchema,
  listPaymentsSchema,
  listUsersSchema,
  paymentAdminMutationSchema,
  prizePoolFormSchema,
  problemIdSchema,
  removeRegistrationSchema,
  scheduleFormSchema,
  setTesterRoleSchema,
  startSuddenDeathSchema,
  updateProblemFormSchema,
  updateTournamentFormSchema,
} from '@/lib/validation/admin.schema';
import { tournamentIdSchema } from '@/lib/validation/tournament.schema';
import { db } from '@/server/db';
import { NotFoundError, ok, toErr, type Result } from '@/lib/errors';
import { captureException } from '@/lib/observability';

/**
 * Admin actions (E5).
 *
 * Thin adapters, every one: validate (Zod) → authorize (`requireAdminOrThrow`)
 * → delegate to a module → revalidate → typed `Result`. No business rule lives
 * here. Authorization is enforced twice on purpose — once at the boundary and
 * again inside each module — so a module stays safe if it is ever called from
 * somewhere new.
 */

function validationError(issues: { message: string }[]): Result<never> {
  return {
    ok: false,
    error: {
      code: 'VALIDATION',
      message: issues[0]?.message ?? 'Please check the form and try again',
    },
  };
}

/** Form values arrive as strings; schemas decide whether blanks mean omit or clear. */
function formObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    out[key] = value;
  }
  return out;
}

function revalidateAdmin(tournamentId?: string) {
  revalidatePath('/admin');
  revalidatePath('/admin/tournaments');
  if (tournamentId) revalidatePath(`/admin/tournaments/${tournamentId}`);
}

// ───────────────────────── Tournaments ─────────────────────────

export async function createTournamentAdminAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ id: string; slug: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = createTournamentFormSchema.safeParse(formObject(formData));
    if (!parsed.success) return validationError(parsed.error.issues);

    const tournament = await createTournament(
      {
        name: parsed.data.name,
        slug: parsed.data.slug,
        bracketSize: parsed.data.bracketSize,
        thirdPlaceEnabled: parsed.data.thirdPlaceEnabled,
        minRegistrations: parsed.data.minRegistrations,
        maxRegistrations: parsed.data.maxRegistrations,
        passPriceMinor: parsed.data.passPriceMinor,
      },
      { actorId: admin.id },
    );

    // `description` and `visibility` are E5 columns the E3 CRUD does not know
    // about; applied here rather than widening the E3 module's input type.
    if (parsed.data.description || parsed.data.visibility) {
      await db.$transaction(async (tx) => {
        const before = {
          description: tournament.description,
          visibility: tournament.visibility,
        };
        const after = await tx.tournament.update({
          where: { id: tournament.id },
          data: {
            description: parsed.data.description,
            visibility: parsed.data.visibility,
          },
          select: { description: true, visibility: true },
        });
        await recordAudit(
          {
            actorId: admin.id,
            action: 'tournament.updateAdminFields',
            entityType: 'Tournament',
            entityId: tournament.id,
            before,
            after,
          },
          tx,
        );
      });
    }

    revalidateAdmin(tournament.id);
    return ok({ id: tournament.id, slug: tournament.slug });
  } catch (error) {
    captureException(error, { where: 'createTournamentAdminAction' });
    return toErr(error);
  }
}

export async function updateTournamentAdminAction(
  tournamentId: string,
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ id: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const id = tournamentIdSchema.safeParse({ tournamentId });
    if (!id.success) return validationError(id.error.issues);

    const parsed = updateTournamentFormSchema.safeParse(formObject(formData));
    if (!parsed.success) return validationError(parsed.error.issues);

    const current = await db.tournament.findUnique({
      where: { id: id.data.tournamentId },
      select: {
        name: true,
        bracketSize: true,
        thirdPlaceEnabled: true,
        minRegistrations: true,
        maxRegistrations: true,
        passPriceMinor: true,
        description: true,
        visibility: true,
      },
    });
    if (!current) throw new NotFoundError('That tournament does not exist');

    const structuralInput = {
      name: parsed.data.name,
      bracketSize: parsed.data.bracketSize,
      thirdPlaceEnabled: parsed.data.thirdPlaceEnabled,
      minRegistrations: parsed.data.minRegistrations,
      maxRegistrations: parsed.data.maxRegistrations,
      passPriceMinor: parsed.data.passPriceMinor,
    };
    const structuralChanged = Object.entries(structuralInput).some(
      ([key, value]) =>
        value !== undefined &&
        value !== current[key as keyof typeof structuralInput],
    );

    if (structuralChanged) {
      await updateTournament(id.data.tournamentId, structuralInput, {
        actorId: admin.id,
      });
    }

    if (
      (parsed.data.description !== undefined &&
        parsed.data.description !== current.description) ||
      (parsed.data.visibility !== undefined &&
        parsed.data.visibility !== current.visibility)
    ) {
      await db.$transaction(async (tx) => {
        const after = await tx.tournament.update({
          where: { id: id.data.tournamentId },
          data: {
            description: parsed.data.description,
            visibility: parsed.data.visibility,
          },
          select: { description: true, visibility: true },
        });
        await recordAudit(
          {
            actorId: admin.id,
            action: 'tournament.updateAdminFields',
            entityType: 'Tournament',
            entityId: id.data.tournamentId,
            before: {
              description: current.description,
              visibility: current.visibility,
            },
            after,
          },
          tx,
        );
      });
    }

    revalidateAdmin(id.data.tournamentId);
    return ok({ id: id.data.tournamentId });
  } catch (error) {
    captureException(error, { where: 'updateTournamentAdminAction' });
    return toErr(error);
  }
}

export async function updateScheduleAdminAction(
  tournamentId: string,
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ id: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const id = tournamentIdSchema.safeParse({ tournamentId });
    if (!id.success) return validationError(id.error.issues);

    const parsed = scheduleFormSchema.safeParse(formObject(formData));
    if (!parsed.success) return validationError(parsed.error.issues);

    await updateTournamentSchedule(id.data.tournamentId, parsed.data, {
      actorId: admin.id,
    });

    revalidateAdmin(id.data.tournamentId);
    return ok({ id: id.data.tournamentId });
  } catch (error) {
    captureException(error, { where: 'updateScheduleAdminAction' });
    return toErr(error);
  }
}

export async function updatePrizePoolAdminAction(
  tournamentId: string,
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ id: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const id = tournamentIdSchema.safeParse({ tournamentId });
    if (!id.success) return validationError(id.error.issues);

    const parsed = prizePoolFormSchema.safeParse(formObject(formData));
    if (!parsed.success) return validationError(parsed.error.issues);

    // Prize-pool RECOMPUTATION is E4's (payments) job; this only stores the
    // parameters the recompute will use.
    await db.$transaction(async (tx) => {
      const before = await tx.tournament.findUniqueOrThrow({
        where: { id: id.data.tournamentId },
        select: {
          basePrizePoolMinor: true,
          prizePerRegistrationMinor: true,
          sponsorContributionMinor: true,
          bonusContributionMinor: true,
          firstPrizeCapMinor: true,
        },
      });
      const after = {
        basePrizePoolMinor: parsed.data.basePrizePoolMinor,
        prizePerRegistrationMinor: parsed.data.prizePerRegistrationMinor,
        sponsorContributionMinor: parsed.data.sponsorContributionMinor,
        bonusContributionMinor: parsed.data.bonusContributionMinor,
        firstPrizeCapMinor: parsed.data.firstPrizeCapMinor,
      };

      await tx.tournament.update({
        where: { id: id.data.tournamentId },
        data: after,
      });
      const prizePool = await recomputePrizePool(id.data.tournamentId, tx);

      await recordAudit(
        {
          actorId: admin.id,
          action: 'tournament.updatePrizePoolSettings',
          entityType: 'Tournament',
          entityId: id.data.tournamentId,
          before,
          after: { ...after, prizePoolMinor: prizePool.prizePoolMinor },
        },
        tx,
      );
    });

    revalidateAdmin(id.data.tournamentId);
    return ok({ id: id.data.tournamentId });
  } catch (error) {
    captureException(error, { where: 'updatePrizePoolAdminAction' });
    return toErr(error);
  }
}

/**
 * Tournament configuration: third-place play-off (D6), round durations (D7) and
 * stage evaluation profiles (D20).
 *
 * Previously this took `unknown` and passed it through with `as never`, which
 * skipped Zod entirely — a server action is a network boundary, so an admin
 * could have written a `bracketSize` of 7 or a negative duration straight into
 * the row. Everything now goes through `configureTournamentFormSchema`, and the
 * module's own guards (no shape changes once the bracket exists, D20 profile
 * validation) still apply on top.
 */
export async function configureTournamentAdminAction(
  tournamentId: string,
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ id: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const id = tournamentIdSchema.safeParse({ tournamentId });
    if (!id.success) return validationError(id.error.issues);

    const parsed = configureTournamentFormSchema.safeParse(
      formObject(formData),
    );
    if (!parsed.success) return validationError(parsed.error.issues);

    await configureTournament(
      id.data.tournamentId,
      {
        thirdPlaceEnabled: parsed.data.thirdPlaceEnabled,
        roundDurations: parsed.data.roundDurations,
        evaluationProfiles: parsed.data.evaluationProfiles,
      },
      { actorId: admin.id },
    );

    revalidateAdmin(id.data.tournamentId);
    return ok({ id: id.data.tournamentId });
  } catch (error) {
    captureException(error, { where: 'configureTournamentAdminAction' });
    return toErr(error);
  }
}

export async function archiveTournamentAction(
  tournamentId: string,
  archived: boolean,
): Promise<Result<{ archived: boolean }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = archiveTournamentSchema.safeParse({
      tournamentId,
      archived,
    });
    if (!parsed.success) return validationError(parsed.error.issues);

    const updated = await setTournamentArchived(
      parsed.data.tournamentId,
      parsed.data.archived,
      admin,
    );
    revalidateAdmin(parsed.data.tournamentId);
    return ok({ archived: updated.archivedAt !== null });
  } catch (error) {
    captureException(error, { where: 'archiveTournamentAction' });
    return toErr(error);
  }
}

// ───────────────────────── Sudden death (D5.6 / D14) ─────────────────────────

/**
 * Open a sudden-death challenge for a match the D5 tie-breaks could not
 * separate. The module owns every rule — that the match is genuinely deadlocked,
 * that the problem is published and is NOT the one the tied round used (D14
 * calls for a new challenge), and that all ties at a stage share one round.
 */
export async function startSuddenDeathAction(
  matchId: string,
  problemId: string,
  tournamentId: string,
): Promise<Result<{ suddenDeathMatchId: string; roundId: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = startSuddenDeathSchema.safeParse({ matchId, problemId });
    if (!parsed.success) return validationError(parsed.error.issues);

    const result = await startSuddenDeath(
      parsed.data.matchId,
      parsed.data.problemId,
      admin,
    );

    revalidateAdmin(tournamentId);
    revalidatePath(`/bracket/${tournamentId}`);
    return ok({
      suddenDeathMatchId: result.suddenDeathMatch.id,
      roundId: result.round.id,
    });
  } catch (error) {
    captureException(error, { where: 'startSuddenDeathAction' });
    return toErr(error);
  }
}

// ───────────────────────── Registrations ─────────────────────────

export async function listRegistrationsAction(
  tournamentId: string,
): Promise<Result<Awaited<ReturnType<typeof listRegistrations>>>> {
  try {
    await requireAdminOrThrow();
    const id = tournamentIdSchema.safeParse({ tournamentId });
    if (!id.success) return validationError(id.error.issues);
    return ok(await listRegistrations(id.data.tournamentId));
  } catch (error) {
    captureException(error, { where: 'listRegistrationsAction' });
    return toErr(error);
  }
}

export async function removeRegistrationAction(
  tournamentId: string,
  userId: string,
  reason: string,
): Promise<Result<{ removed: true }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = removeRegistrationSchema.safeParse({
      tournamentId,
      userId,
      reason,
    });
    if (!parsed.success) return validationError(parsed.error.issues);

    await removeRegistration(
      parsed.data.tournamentId,
      parsed.data.userId,
      admin,
      parsed.data.reason,
    );
    revalidateAdmin(parsed.data.tournamentId);
    return ok({ removed: true });
  } catch (error) {
    captureException(error, { where: 'removeRegistrationAction' });
    return toErr(error);
  }
}

// ───────────────────────── Payments ─────────────────────────

export async function listPaymentsAction(
  input: unknown = {},
): Promise<Result<Awaited<ReturnType<typeof listPaymentsForAdmin>>>> {
  try {
    await requireAdminOrThrow();
    const parsed = listPaymentsSchema.safeParse(input ?? {});
    if (!parsed.success) return validationError(parsed.error.issues);
    return ok(await listPaymentsForAdmin(parsed.data));
  } catch (error) {
    captureException(error, { where: 'listPaymentsAction' });
    return toErr(error);
  }
}

export async function getPaymentAction(
  paymentId: string,
): Promise<Result<Awaited<ReturnType<typeof getPaymentForAdmin>>>> {
  try {
    await requireAdminOrThrow();
    const parsed = adminPaymentIdSchema.safeParse({ paymentId });
    if (!parsed.success) return validationError(parsed.error.issues);
    return ok(await getPaymentForAdmin(parsed.data.paymentId));
  } catch (error) {
    captureException(error, { where: 'getPaymentAction' });
    return toErr(error);
  }
}

export async function listWebhookEventsAction(): Promise<
  Result<Awaited<ReturnType<typeof listWebhookEventsForAdmin>>>
> {
  try {
    await requireAdminOrThrow();
    return ok(await listWebhookEventsForAdmin());
  } catch (error) {
    captureException(error, { where: 'listWebhookEventsAction' });
    return toErr(error);
  }
}

export async function refundPaymentAction(
  paymentId: string,
  reason: string,
): Promise<Result<{ id: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = paymentAdminMutationSchema.safeParse({ paymentId, reason });
    if (!parsed.success) return validationError(parsed.error.issues);

    const payment = await refundPaymentForAdmin(
      parsed.data.paymentId,
      admin,
      parsed.data.reason,
    );
    revalidateAdmin(payment.tournamentId);
    revalidatePath('/admin/payments');
    revalidatePath(`/admin/payments/${payment.id}`);
    return ok({ id: payment.id });
  } catch (error) {
    captureException(error, { where: 'refundPaymentAction' });
    return toErr(error);
  }
}

export async function markManualPaymentPaidAction(
  paymentId: string,
  reason: string,
): Promise<Result<{ id: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = paymentAdminMutationSchema.safeParse({ paymentId, reason });
    if (!parsed.success) return validationError(parsed.error.issues);

    const result = await markManualPaymentPaidForAdmin(
      parsed.data.paymentId,
      admin,
    );
    await recordAudit({
      actorId: admin.id,
      action: 'payment.manualPaidAdmin',
      entityType: 'Payment',
      entityId: parsed.data.paymentId,
      after: { reason: parsed.data.reason, applied: result.applied },
    });
    revalidateAdmin(result.payment.tournamentId);
    revalidatePath('/admin/payments');
    revalidatePath(`/admin/payments/${result.payment.id}`);
    return ok({ id: result.payment.id });
  } catch (error) {
    captureException(error, { where: 'markManualPaymentPaidAction' });
    return toErr(error);
  }
}

export async function cancelRegistrationPaymentAdminAction(
  tournamentId: string,
  userId: string,
  reason: string,
): Promise<Result<{ cancelled: true }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = removeRegistrationSchema.safeParse({
      tournamentId,
      userId,
      reason,
    });
    if (!parsed.success) return validationError(parsed.error.issues);

    await cancelRegistrationForAdmin(
      parsed.data.tournamentId,
      parsed.data.userId,
      admin,
      parsed.data.reason,
    );
    revalidateAdmin(parsed.data.tournamentId);
    revalidatePath('/admin/payments');
    return ok({ cancelled: true });
  } catch (error) {
    captureException(error, { where: 'cancelRegistrationPaymentAdminAction' });
    return toErr(error);
  }
}

// ───────────────────────── Problems ─────────────────────────

export async function createProblemAction(
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ id: string; slug: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = createProblemFormSchema.safeParse(formObject(formData));
    if (!parsed.success) return validationError(parsed.error.issues);

    const problem = await createProblem(parsed.data, admin);
    revalidatePath('/admin/challenges');
    return ok({ id: problem.id, slug: problem.slug });
  } catch (error) {
    captureException(error, { where: 'createProblemAction' });
    return toErr(error);
  }
}

export async function updateProblemAction(
  problemId: string,
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ id: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const id = problemIdSchema.safeParse({ problemId });
    if (!id.success) return validationError(id.error.issues);

    const parsed = updateProblemFormSchema.safeParse(formObject(formData));
    if (!parsed.success) return validationError(parsed.error.issues);

    await updateProblem(id.data.problemId, parsed.data, admin);
    revalidatePath('/admin/challenges');
    revalidatePath(`/admin/challenges/${id.data.problemId}`);
    return ok({ id: id.data.problemId });
  } catch (error) {
    captureException(error, { where: 'updateProblemAction' });
    return toErr(error);
  }
}

export async function publishProblemAction(
  problemId: string,
): Promise<Result<{ visibility: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const id = problemIdSchema.safeParse({ problemId });
    if (!id.success) return validationError(id.error.issues);

    const problem = await publishProblem(id.data.problemId, admin);
    revalidatePath('/admin/challenges');
    revalidatePath(`/admin/challenges/${id.data.problemId}`);
    return ok({ visibility: problem.visibility });
  } catch (error) {
    captureException(error, { where: 'publishProblemAction' });
    return toErr(error);
  }
}

export async function archiveProblemAction(
  problemId: string,
): Promise<Result<{ visibility: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const id = problemIdSchema.safeParse({ problemId });
    if (!id.success) return validationError(id.error.issues);

    const problem = await archiveProblem(id.data.problemId, admin);
    revalidatePath('/admin/challenges');
    revalidatePath(`/admin/challenges/${id.data.problemId}`);
    return ok({ visibility: problem.visibility });
  } catch (error) {
    captureException(error, { where: 'archiveProblemAction' });
    return toErr(error);
  }
}

export async function addHiddenTestAction(
  problemId: string,
  _prev: unknown,
  formData: FormData,
): Promise<Result<{ testId: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = addHiddenTestFormSchema.safeParse({
      ...formObject(formData),
      problemId,
    });
    if (!parsed.success) return validationError(parsed.error.issues);

    const test = await addHiddenTest(
      parsed.data.problemId,
      {
        name: parsed.data.name,
        kind: parsed.data.kind,
        spec: parsed.data.spec,
        weight: parsed.data.weight,
        timeoutMs: parsed.data.timeoutMs,
      },
      admin,
    );
    revalidatePath(`/admin/challenges/${problemId}`);
    return ok({ testId: test.id });
  } catch (error) {
    captureException(error, { where: 'addHiddenTestAction' });
    return toErr(error);
  }
}

export async function removeHiddenTestAction(
  testId: string,
  problemId: string,
): Promise<Result<{ removed: true }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = hiddenTestIdSchema.safeParse({ testId });
    if (!parsed.success) return validationError(parsed.error.issues);

    await removeHiddenTest(parsed.data.testId, admin);
    revalidatePath(`/admin/challenges/${problemId}`);
    return ok({ removed: true });
  } catch (error) {
    captureException(error, { where: 'removeHiddenTestAction' });
    return toErr(error);
  }
}

export async function assignProblemToRoundAction(
  roundId: string,
  problemId: string,
  tournamentId: string,
): Promise<Result<{ roundId: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = assignProblemSchema.safeParse({ roundId, problemId });
    if (!parsed.success) return validationError(parsed.error.issues);

    await assignProblemToRound(
      parsed.data.roundId,
      parsed.data.problemId,
      admin,
    );
    revalidateAdmin(tournamentId);
    return ok({ roundId: parsed.data.roundId });
  } catch (error) {
    captureException(error, { where: 'assignProblemToRoundAction' });
    return toErr(error);
  }
}

// ───────────────────────── Directory ─────────────────────────

export async function listUsersAction(
  input: unknown = {},
): Promise<Result<Awaited<ReturnType<typeof listUsers>>>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = listUsersSchema.safeParse(input ?? {});
    if (!parsed.success) return validationError(parsed.error.issues);
    return ok(await listUsers(admin, parsed.data));
  } catch (error) {
    captureException(error, { where: 'listUsersAction' });
    return toErr(error);
  }
}

/**
 * Grant or revoke the TEST role. The module owns every rule — that ADMIN is not
 * reachable from here, that bots have no editable role, and that a competitor
 * with a production record cannot be converted.
 */
export async function setTesterRoleAction(
  userId: string,
  isTester: boolean,
): Promise<Result<{ role: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = setTesterRoleSchema.safeParse({ userId, isTester });
    if (!parsed.success) return validationError(parsed.error.issues);

    const user = await setTesterRole(
      parsed.data.userId,
      parsed.data.isTester,
      admin,
    );
    revalidatePath('/admin/users');
    return ok({ role: user.role });
  } catch (error) {
    captureException(error, { where: 'setTesterRoleAction' });
    return toErr(error);
  }
}

export async function deleteUserAction(
  userId: string,
  anonymise = false,
): Promise<Result<{ outcome: 'DELETED' | 'ANONYMISED' }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = deleteUserSchema.safeParse({ userId, anonymise });
    if (!parsed.success) return validationError(parsed.error.issues);

    const result = await deleteUser(parsed.data.userId, admin, {
      anonymise: parsed.data.anonymise,
    });
    revalidatePath('/admin/users');
    revalidatePath('/admin');
    return ok({ outcome: result.outcome });
  } catch (error) {
    captureException(error, { where: 'deleteUserAction' });
    return toErr(error);
  }
}

export async function listAuditLogAction(
  input: unknown = {},
): Promise<Result<Awaited<ReturnType<typeof listAuditLog>>>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = listAuditSchema.safeParse(input ?? {});
    if (!parsed.success) return validationError(parsed.error.issues);
    return ok(await listAuditLog(admin, parsed.data));
  } catch (error) {
    captureException(error, { where: 'listAuditLogAction' });
    return toErr(error);
  }
}
