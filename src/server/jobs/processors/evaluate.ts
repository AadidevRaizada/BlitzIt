import 'server-only';
import type { Prisma, SubmissionStatus } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { runEvaluation } from '@/server/modules/evaluation';
import { UnsupportedCategoryError } from '@/server/modules/evaluation';
import { resolveEvaluationProfile } from '@/server/modules/tournament/evaluation-profiles';
import { runReferenceEvaluation } from '@/server/modules/bot/reference-evaluator';
import { isEvaluationResultCurrent } from '@/server/modules/submission/state';
import type { ClaimedJob } from '../queue';
import { logger } from '@/lib/logger';

/**
 * `evaluate` job processor (E2).
 *
 * Loads a submission, runs the Evaluation Engine, and persists the result plus
 * full evidence. Idempotent: re-running replaces the evaluation for the same
 * submission rather than creating a duplicate (the row is unique per
 * submission), so a retried job converges instead of double-writing.
 */
/** Pull the provider name out of the engine's audit payload, if present. */
function readProvider(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const provider = (raw as { provider?: unknown }).provider;
  return typeof provider === 'string' ? provider : null;
}

/**
 * Write a submission status ONLY while this job still owns the entry.
 *
 * Every status write in this processor has to be conditional, not just the
 * success path. Two things can happen while an evaluation is out probing the
 * network:
 *
 *  - an admin **disqualifies** the entry — a struck submission must not be
 *    dragged back to JUDGING/SCORED/FAILED by a job that was already running;
 *  - the competitor **replaces** the entry — the in-flight result describes a
 *    revision nobody is competing with, and a fresh job is already queued for
 *    the new one. Marking the *new* revision FAILED because the *old* one threw
 *    would cost a competitor their score (E3's seeding counts only SCORED).
 *
 * Returns false when the write was skipped because the entry moved on.
 */
async function writeStatusIfCurrent(
  submissionId: string,
  evaluatedVersion: number,
  status: SubmissionStatus,
): Promise<boolean> {
  const result = await db.submission.updateMany({
    where: {
      id: submissionId,
      version: evaluatedVersion,
      status: { not: 'DISQUALIFIED' },
    },
    data: { status },
  });
  return result.count > 0;
}

export async function evaluateProcessor(job: ClaimedJob): Promise<void> {
  const submissionId =
    typeof job.payload.submissionId === 'string'
      ? job.payload.submissionId
      : null;

  if (!submissionId) {
    throw new Error('evaluate job is missing submissionId');
  }

  const log = logger.child({ jobId: job.id, submissionId });

  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    include: {
      problem: { include: { hiddenTests: { orderBy: { sequence: 'asc' } } } },
      round: { select: { stage: true } },
      tournament: { select: { evaluationProfiles: true } },
      user: { select: { isBot: true, botProfile: true } },
    },
  });

  if (!submission) {
    // The submission was deleted — nothing to evaluate, and retrying will not
    // help, so complete rather than fail.
    log.warn('submission no longer exists; skipping evaluation');
    return;
  }

  // A struck entry must not be re-scored by a job that was already in flight.
  if (submission.status === 'DISQUALIFIED') {
    log.warn('submission is disqualified; skipping evaluation');
    return;
  }

  // The revision being scored. A competitor may replace their entry while the
  // window is still open, so the version is captured here and re-checked before
  // the result is written (E4).
  const evaluatedVersion = submission.version;

  const claimed = await writeStatusIfCurrent(
    submissionId,
    evaluatedVersion,
    'JUDGING',
  );
  if (!claimed) {
    // Disqualified or replaced between the read above and this write.
    log.warn(
      { evaluatedVersion },
      'submission moved on before evaluation started; skipping',
    );
    return;
  }

  const startedAt = new Date();

  // The TOURNAMENT layer decides which dimensions are active for this round
  // (D20); the engine below is stage-agnostic and just honours the profile.
  const profile = resolveEvaluationProfile(
    submission.round.stage,
    submission.tournament.evaluationProfiles,
  );
  log.info(
    { stage: submission.round.stage, profile: profile.name },
    'resolved evaluation profile',
  );

  try {
    // WHERE the measurements come from is resolved here, at the same altitude
    // as the profile above and for the same reason: the engine must stay free of
    // competitor-shaped special cases (D20's architectural rule). A bot has no
    // deployment to probe and no repository to read, so its numbers come from
    // the deterministic internal reference evaluator instead — which honours the
    // very same profile, and produces a complete outcome that everything
    // downstream treats identically. There is no `if (isBot)` inside
    // `runEvaluation`, and there must never be one.
    const outcome = submission.user.isBot
      ? runReferenceEvaluation({
          botUserId: submission.userId,
          roundId: submission.roundId,
          problemId: submission.problemId,
          skill: submission.user.botProfile?.skill ?? 50,
          scoreMode: submission.user.botProfile?.scoreMode ?? 'SEEDED',
          testCount: submission.problem.hiddenTests.length,
          profile,
        })
      : await runEvaluation(
          {
            submissionId: submission.id,
            repoUrl: submission.repoUrl,
            deploymentUrl: submission.deploymentUrl,
            commitSha: submission.commitSha,
            // The category the entry was ACCEPTED under, not the problem's current
            // one. Re-categorising a problem mid-tournament must not retroactively
            // change how an already-accepted entry is scored — or fail it outright
            // as unsupported. The snapshot is the whole reason the column exists.
            category: submission.category,
            contractSpec: submission.problem.contractSpec,
            hiddenTests: submission.problem.hiddenTests.map((test) => ({
              id: test.id,
              name: test.name,
              kind: test.kind,
              spec: test.spec,
              weight: test.weight,
              timeoutMs: test.timeoutMs,
            })),
          },
          profile,
        );

    const finishedAt = new Date();

    const data = {
      tournamentId: submission.tournamentId,
      attempt: job.attempts,
      submissionVersion: evaluatedVersion,
      functionalScore: outcome.functionalScore,
      testsPassed: outcome.testsPassed,
      testsTotal: outcome.testsTotal,
      testResults: outcome.testResults as unknown as Prisma.InputJsonValue,
      deploymentReachable: outcome.deploymentReachable,
      performanceScore: outcome.performanceScore,
      securityReliabilityScore: outcome.securityReliabilityScore,
      aiScore: outcome.aiScore,
      overallScore: outcome.overallScore,
      weights: outcome.weights as unknown as Prisma.InputJsonValue,
      profileName: outcome.profileName,
      dimensions: outcome.dimensions as unknown as Prisma.InputJsonValue,
      probeEvidence: outcome.probeEvidence as unknown as Prisma.InputJsonValue,
      repoTextSnapshot:
        outcome.repoTextSnapshot as unknown as Prisma.InputJsonValue,
      rubricVersion: outcome.ai.rubricVersion,
      // The engine already records the provider inside its audit payload; this
      // lifts it into a column so "which backend scored this?" is queryable.
      llmProvider: readProvider(outcome.ai.raw),
      modelId: outcome.ai.modelId,
      modelPromptHash: outcome.ai.promptHash,
      llmRaw: outcome.ai.raw as unknown as Prisma.InputJsonValue,
      startedAt,
      finishedAt,
      error: null,
    };

    // One evaluation per submission; a retry updates in place.
    //
    // The write is conditional on the submission still being the revision we
    // scored. A competitor who replaces their entry mid-evaluation already has
    // a fresh job queued; letting this one land would overwrite the new
    // revision's score with the old revision's result.
    const written = await db.$transaction(async (tx) => {
      const current = await tx.submission.findUnique({
        where: { id: submissionId },
        select: { version: true, status: true },
      });
      if (!isEvaluationResultCurrent({ evaluatedVersion, current })) {
        return false;
      }

      await tx.evaluation.upsert({
        where: { submissionId },
        create: { submissionId, ...data },
        update: data,
      });
      await tx.submission.update({
        where: { id: submissionId },
        data: { status: 'SCORED' },
      });
      return true;
    });

    if (!written) {
      log.warn(
        { evaluatedVersion },
        'submission changed while it was being evaluated; discarding the stale result',
      );
      return;
    }

    log.info({ overallScore: outcome.overallScore }, 'submission scored');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';

    // An unsupported category (D17) will never succeed on retry — record it and
    // stop rather than burning attempts.
    if (error instanceof UnsupportedCategoryError) {
      await writeStatusIfCurrent(submissionId, evaluatedVersion, 'FAILED');
      log.error({ err: message }, 'category not enabled for evaluation');
      return;
    }

    // If this was the last attempt the job is about to be dead-lettered, so
    // the submission must not be left looking QUEUED forever — nothing would
    // ever pick it up again. Mirror the job's terminal state instead.
    const exhausted = job.attempts >= job.maxAttempts;
    await writeStatusIfCurrent(
      submissionId,
      evaluatedVersion,
      exhausted ? 'FAILED' : 'QUEUED',
    );

    if (exhausted) {
      log.error(
        { err: message, attempts: job.attempts },
        'evaluation exhausted all attempts; submission marked FAILED',
      );
    }

    // Rethrow so the runner applies backoff / dead-letters after maxAttempts.
    throw error;
  }
}
