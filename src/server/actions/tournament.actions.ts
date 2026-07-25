'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow } from '@/server/modules/auth';
import {
  applyTransition,
  configureTournament,
  createTournament,
  deleteTournament,
  getTournamentProgress,
  progressTournament,
  updateTournament,
  updateTournamentSchedule,
  type TournamentTransition,
} from '@/server/modules/tournament';
import {
  configureTournamentSchema,
  createTournamentSchema,
  tournamentIdSchema,
  tournamentScheduleSchema,
  transitionTournamentSchema,
  updateTournamentSchema,
} from '@/lib/validation/tournament.schema';
import { ok, toErr, type Result } from '@/lib/errors';
import { captureException } from '@/lib/observability';

/**
 * Admin tournament actions (E3).
 *
 * Thin adapters, every one of them: validate (Zod) → authorize
 * (`requireAdminOrThrow`) → delegate to the tournament module → revalidate →
 * typed `Result`. No business rule lives here; the state machine, the guards
 * and the audit trail are all inside the module, so a future admin UI, a cron
 * job and a script all get identical behaviour.
 */

function firstIssue(issues: { message: string }[]): string {
  return issues[0]?.message ?? 'Please check the form and try again';
}

function validationError(issues: { message: string }[]): Result<never> {
  return {
    ok: false,
    error: { code: 'VALIDATION', message: firstIssue(issues) },
  };
}

function revalidateTournament(slug?: string) {
  revalidatePath('/admin');
  revalidatePath('/admin/tournaments');
  if (slug) revalidatePath(`/t/${slug}`);
}

export async function createTournamentAction(
  input: unknown,
): Promise<Result<{ id: string; slug: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = createTournamentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: firstIssue(parsed.error.issues) },
      };
    }

    const tournament = await createTournament(parsed.data, {
      actorId: admin.id,
    });
    revalidateTournament(tournament.slug);
    return ok({ id: tournament.id, slug: tournament.slug });
  } catch (error) {
    captureException(error, { where: 'createTournamentAction' });
    return toErr(error);
  }
}

export async function updateTournamentAction(
  tournamentId: unknown,
  input: unknown,
): Promise<Result<{ id: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const id = tournamentIdSchema.safeParse({ tournamentId });
    if (!id.success) return validationError(id.error.issues);
    const parsed = updateTournamentSchema.safeParse(input);
    if (!parsed.success) return validationError(parsed.error.issues);

    const tournament = await updateTournament(
      id.data.tournamentId,
      parsed.data,
      { actorId: admin.id },
    );
    revalidateTournament(tournament.slug);
    return ok({ id: tournament.id });
  } catch (error) {
    captureException(error, { where: 'updateTournamentAction' });
    return toErr(error);
  }
}

export async function updateTournamentScheduleAction(
  tournamentId: unknown,
  input: unknown,
): Promise<Result<{ id: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const id = tournamentIdSchema.safeParse({ tournamentId });
    if (!id.success) return validationError(id.error.issues);
    const parsed = tournamentScheduleSchema.safeParse(input);
    if (!parsed.success) return validationError(parsed.error.issues);

    const tournament = await updateTournamentSchedule(
      id.data.tournamentId,
      parsed.data,
      { actorId: admin.id },
    );
    revalidateTournament(tournament.slug);
    return ok({ id: tournament.id });
  } catch (error) {
    captureException(error, { where: 'updateTournamentScheduleAction' });
    return toErr(error);
  }
}

export async function configureTournamentAction(
  tournamentId: unknown,
  input: unknown,
): Promise<Result<{ id: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const id = tournamentIdSchema.safeParse({ tournamentId });
    if (!id.success) return validationError(id.error.issues);
    const parsed = configureTournamentSchema.safeParse(input);
    if (!parsed.success) return validationError(parsed.error.issues);

    const tournament = await configureTournament(
      id.data.tournamentId,
      parsed.data,
      { actorId: admin.id },
    );
    revalidateTournament(tournament.slug);
    return ok({ id: tournament.id });
  } catch (error) {
    captureException(error, { where: 'configureTournamentAction' });
    return toErr(error);
  }
}

export async function deleteTournamentAction(
  tournamentId: unknown,
): Promise<Result<{ deleted: true }>> {
  try {
    const admin = await requireAdminOrThrow();
    const id = tournamentIdSchema.safeParse({ tournamentId });
    if (!id.success) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: firstIssue(id.error.issues) },
      };
    }

    await deleteTournament(id.data.tournamentId, { actorId: admin.id });
    revalidateTournament();
    return ok({ deleted: true });
  } catch (error) {
    captureException(error, { where: 'deleteTournamentAction' });
    return toErr(error);
  }
}

/**
 * Drive the lifecycle. `force` skips the *business* guards only — an illegal
 * transition is rejected regardless of who asks, which is what makes the state
 * machine trustworthy as the tournament's source of truth.
 */
export async function transitionTournamentAction(
  input: unknown,
): Promise<
  Result<{ from: string; to: string; applied: boolean; opsEventId: string }>
> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = transitionTournamentSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: firstIssue(parsed.error.issues) },
      };
    }

    const result = await applyTransition(
      parsed.data.tournamentId,
      parsed.data.transition as TournamentTransition,
      {
        actorId: admin.id,
        runBy: 'admin',
        reason: parsed.data.reason ?? null,
        force: parsed.data.force ?? false,
      },
    );

    revalidateTournament();
    return ok({
      from: result.from,
      to: result.to,
      applied: result.applied,
      opsEventId: result.opsEventId,
    });
  } catch (error) {
    captureException(error, { where: 'transitionTournamentAction' });
    return toErr(error);
  }
}

/** Ops button: run an advancement pass now instead of waiting for the job. */
export async function progressTournamentAction(
  tournamentId: unknown,
): Promise<Result<{ decided: number; tied: number; completed: boolean }>> {
  try {
    const admin = await requireAdminOrThrow();
    const id = tournamentIdSchema.safeParse({ tournamentId });
    if (!id.success) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: firstIssue(id.error.issues) },
      };
    }

    const result = await progressTournament(id.data.tournamentId, {
      actorId: admin.id,
      runBy: 'admin',
    });
    revalidateTournament();
    return ok({
      decided: result.matchesDecided,
      tied: result.matchesTied,
      completed: result.completed,
    });
  } catch (error) {
    captureException(error, { where: 'progressTournamentAction' });
    return toErr(error);
  }
}

/** Read: current lifecycle position + round completion. */
export async function getTournamentProgressAction(
  tournamentId: unknown,
): Promise<Result<Awaited<ReturnType<typeof getTournamentProgress>>>> {
  try {
    await requireAdminOrThrow();
    const id = tournamentIdSchema.safeParse({ tournamentId });
    if (!id.success) {
      return {
        ok: false,
        error: { code: 'VALIDATION', message: firstIssue(id.error.issues) },
      };
    }
    return ok(await getTournamentProgress(id.data.tournamentId));
  } catch (error) {
    captureException(error, { where: 'getTournamentProgressAction' });
    return toErr(error);
  }
}
