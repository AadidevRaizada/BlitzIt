'use server';

import { revalidatePath } from 'next/cache';
import { requireUserOrThrow } from '@/server/modules/auth';
import { db } from '@/server/db';
import { recordAudit } from '@/server/modules/admin/audit';
import {
  acceptTerms,
  assertCurrentTermsAccepted,
} from '@/server/modules/compliance';
import {
  notifyRegistrationConfirmed,
  registerCompetitor,
  withdrawRegistration,
} from '@/server/modules/tournament';
import { tournamentIdSchema } from '@/lib/validation/tournament.schema';
import { err, ok, toErr, type Result } from '@/lib/errors';
import { captureException } from '@/lib/observability';

/**
 * Competitor registration actions (E3).
 *
 * The user id always comes from the session, never from the caller — the whole
 * authorization story here is "you may only register yourself".
 *
 * E3 registers a competitor as a *state*. Paying for the pass is E4: that epic
 * will attach a `Payment` to the row these actions create and gate them behind
 * a completed webhook. Nothing here should be read as "registration is free
 * forever"; it is simply not yet coupled to money.
 */

export async function registerForTournamentAction(
  tournamentId: unknown,
  options: { acceptedRules?: boolean } = {},
): Promise<Result<{ registrationId: string; participantCount: number }>> {
  try {
    const user = await requireUserOrThrow();
    if (options.acceptedRules !== true) {
      return err(
        'VALIDATION',
        'You must accept the tournament rules to enter.',
      );
    }
    await acceptTerms({ userId: user.id });

    const parsed = tournamentIdSchema.safeParse({ tournamentId });
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: parsed.error.issues[0]?.message ?? 'Invalid tournament',
        },
      };
    }

    const tournament = await db.tournament.findUnique({
      where: { id: parsed.data.tournamentId },
      select: { passPriceMinor: true },
    });
    if (tournament?.passPriceMinor && tournament.passPriceMinor > 0) {
      return err(
        'PAYMENT_REQUIRED',
        'This tournament requires a paid pass before registration.',
      );
    }

    await assertCurrentTermsAccepted(user.id);
    const result = await registerCompetitor(parsed.data.tournamentId, user.id, {
      actorId: user.id,
    });

    await recordAudit(
      {
        actorId: user.id,
        action: 'tournament.registerAccepted',
        entityType: 'Registration',
        entityId: result.registration.id,
        after: {
          userId: user.id,
          tournamentId: parsed.data.tournamentId,
          acceptedRules: true,
        },
      },
      db,
    );

    // After the registration transaction commits, never inside it (E8.3): an
    // email job enqueued in a transaction that rolls back would point at a
    // notification row that never existed. Non-fatal — a competitor who is
    // registered but did not get the email is registered, and telling them the
    // registration failed would be a lie.
    try {
      await notifyRegistrationConfirmed(parsed.data.tournamentId, user.id);
    } catch (error) {
      captureException(error, { where: 'registerForTournamentAction.notify' });
    }

    revalidatePath('/dashboard');
    revalidatePath('/tournaments');
    return ok({
      registrationId: result.registration.id,
      participantCount: result.participantCount,
    });
  } catch (error) {
    captureException(error, { where: 'registerForTournamentAction' });
    return toErr(error);
  }
}

export async function withdrawFromTournamentAction(
  tournamentId: unknown,
): Promise<Result<{ registrationId: string; participantCount: number }>> {
  try {
    const user = await requireUserOrThrow();
    const parsed = tournamentIdSchema.safeParse({ tournamentId });
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: 'VALIDATION',
          message: parsed.error.issues[0]?.message ?? 'Invalid tournament',
        },
      };
    }

    const result = await withdrawRegistration(
      parsed.data.tournamentId,
      user.id,
      { actorId: user.id },
    );

    revalidatePath('/dashboard');
    return ok({
      registrationId: result.registration.id,
      participantCount: result.participantCount,
    });
  } catch (error) {
    captureException(error, { where: 'withdrawFromTournamentAction' });
    return toErr(error);
  }
}
