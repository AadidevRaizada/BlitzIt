'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminOrThrow, requireUserOrThrow } from '@/server/modules/auth';
import {
  disqualifySubmission,
  getMySubmission,
  getSubmission,
  getSubmissionHistory,
  listAllSubmissions,
  listMySubmissions,
  retryEvaluation,
  submitSolution,
  type SubmissionView,
} from '@/server/modules/submission';
import {
  disqualifySubmissionSchema,
  listSubmissionsSchema,
  submissionIdSchema,
  submitSolutionSchema,
  roundIdSchema,
} from '@/lib/validation/submission.schema';
import { ok, toErr, type Result } from '@/lib/errors';
import { captureException } from '@/lib/observability';

/**
 * Submission actions (E4).
 *
 * Thin adapters: validate (Zod) → authenticate → delegate to the module →
 * revalidate → typed `Result`. No business rule lives here; ownership,
 * windows, state transitions and queueing are all decided inside the module so
 * a future API surface behaves identically.
 *
 * The competitor id always comes from the session — never from the caller.
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

export async function submitSolutionAction(
  _prevState: unknown,
  formData: FormData,
): Promise<
  Result<{ submissionId: string; version: number; replaced: boolean }>
> {
  try {
    const user = await requireUserOrThrow();

    const parsed = submitSolutionSchema.safeParse({
      roundId: formData.get('roundId'),
      repoUrl: formData.get('repoUrl'),
      deploymentUrl: formData.get('deploymentUrl'),
      commitSha: formData.get('commitSha') ?? undefined,
    });
    if (!parsed.success) return validationError(parsed.error.issues);

    const result = await submitSolution({
      userId: user.id,
      roundId: parsed.data.roundId,
      repoUrl: parsed.data.repoUrl,
      deploymentUrl: parsed.data.deploymentUrl,
      commitSha: parsed.data.commitSha ?? null,
    });

    revalidatePath('/submissions');
    revalidatePath(`/submit/${parsed.data.roundId}`);
    revalidatePath(`/submissions/${result.submission.id}`);

    return ok({
      submissionId: result.submission.id,
      version: result.version,
      replaced: result.replaced,
    });
  } catch (error) {
    captureException(error, { where: 'submitSolutionAction' });
    return toErr(error);
  }
}

export async function getMySubmissionsAction(
  input: unknown = {},
): Promise<Result<SubmissionView[]>> {
  try {
    const user = await requireUserOrThrow();
    const parsed = listSubmissionsSchema.safeParse(input ?? {});
    if (!parsed.success) return validationError(parsed.error.issues);
    return ok(await listMySubmissions(user.id, parsed.data));
  } catch (error) {
    captureException(error, { where: 'getMySubmissionsAction' });
    return toErr(error);
  }
}

export async function getSubmissionAction(
  submissionId: unknown,
): Promise<Result<SubmissionView>> {
  try {
    const user = await requireUserOrThrow();
    const parsed = submissionIdSchema.safeParse({ submissionId });
    if (!parsed.success) return validationError(parsed.error.issues);
    return ok(await getSubmission(parsed.data.submissionId, user));
  } catch (error) {
    captureException(error, { where: 'getSubmissionAction' });
    return toErr(error);
  }
}

/**
 * Poll target for the evaluation status panel. The polling lives in the client
 * component; this is a plain read, and no business module ever waits on a job.
 */
export async function getSubmissionStatusAction(submissionId: unknown): Promise<
  Result<{
    state: SubmissionView['state'];
    job: SubmissionView['job'];
    evaluation: SubmissionView['evaluation'];
    version: number;
  }>
> {
  try {
    const user = await requireUserOrThrow();
    const parsed = submissionIdSchema.safeParse({ submissionId });
    if (!parsed.success) return validationError(parsed.error.issues);

    const view = await getSubmission(parsed.data.submissionId, user);
    return ok({
      state: view.state,
      job: view.job,
      evaluation: view.evaluation,
      version: view.version,
    });
  } catch (error) {
    captureException(error, { where: 'getSubmissionStatusAction' });
    return toErr(error);
  }
}

export async function getMyRoundSubmissionAction(
  roundId: unknown,
): Promise<Result<SubmissionView | null>> {
  try {
    const user = await requireUserOrThrow();
    const parsed = roundIdSchema.safeParse({ roundId });
    if (!parsed.success) return validationError(parsed.error.issues);
    return ok(await getMySubmission(user.id, parsed.data.roundId));
  } catch (error) {
    captureException(error, { where: 'getMyRoundSubmissionAction' });
    return toErr(error);
  }
}

export async function getSubmissionHistoryAction(
  submissionId: unknown,
): Promise<Result<Awaited<ReturnType<typeof getSubmissionHistory>>>> {
  try {
    const user = await requireUserOrThrow();
    const parsed = submissionIdSchema.safeParse({ submissionId });
    if (!parsed.success) return validationError(parsed.error.issues);
    return ok(await getSubmissionHistory(parsed.data.submissionId, user));
  } catch (error) {
    captureException(error, { where: 'getSubmissionHistoryAction' });
    return toErr(error);
  }
}

// ───────────────────────────── Admin ─────────────────────────────

export async function listAllSubmissionsAction(
  input: unknown = {},
): Promise<Result<SubmissionView[]>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = listSubmissionsSchema.safeParse(input ?? {});
    if (!parsed.success) return validationError(parsed.error.issues);
    return ok(await listAllSubmissions(admin, parsed.data));
  } catch (error) {
    captureException(error, { where: 'listAllSubmissionsAction' });
    return toErr(error);
  }
}

export async function retryEvaluationAction(
  submissionId: unknown,
): Promise<Result<{ jobId: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = submissionIdSchema.safeParse({ submissionId });
    if (!parsed.success) return validationError(parsed.error.issues);

    const result = await retryEvaluation(parsed.data.submissionId, admin);
    revalidatePath('/admin/submissions');
    revalidatePath(`/submissions/${parsed.data.submissionId}`);
    return ok({ jobId: result.jobId });
  } catch (error) {
    captureException(error, { where: 'retryEvaluationAction' });
    return toErr(error);
  }
}

export async function disqualifySubmissionAction(
  input: unknown,
): Promise<Result<{ state: string }>> {
  try {
    const admin = await requireAdminOrThrow();
    const parsed = disqualifySubmissionSchema.safeParse(input);
    if (!parsed.success) return validationError(parsed.error.issues);

    const state = await disqualifySubmission(
      parsed.data.submissionId,
      admin,
      parsed.data.reason,
    );
    revalidatePath('/admin/submissions');
    return ok({ state });
  } catch (error) {
    captureException(error, { where: 'disqualifySubmissionAction' });
    return toErr(error);
  }
}
