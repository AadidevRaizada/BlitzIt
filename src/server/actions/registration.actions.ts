'use server';

import { revalidatePath } from 'next/cache';
import { requireUserOrThrow } from '@/server/modules/auth';
import {
  registerCompetitor,
  withdrawRegistration,
} from '@/server/modules/tournament';
import { tournamentIdSchema } from '@/lib/validation/tournament.schema';
import { ok, toErr, type Result } from '@/lib/errors';
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

    const result = await registerCompetitor(parsed.data.tournamentId, user.id, {
      actorId: user.id,
    });

    revalidatePath('/dashboard');
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
