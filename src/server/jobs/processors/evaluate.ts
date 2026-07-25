import 'server-only';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { runEvaluation } from '@/server/modules/evaluation';
import { UnsupportedCategoryError } from '@/server/modules/evaluation';
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
    },
  });

  if (!submission) {
    // The submission was deleted — nothing to evaluate, and retrying will not
    // help, so complete rather than fail.
    log.warn('submission no longer exists; skipping evaluation');
    return;
  }

  await db.submission.update({
    where: { id: submissionId },
    data: { status: 'JUDGING' },
  });

  const startedAt = new Date();

  try {
    const outcome = await runEvaluation({
      submissionId: submission.id,
      repoUrl: submission.repoUrl,
      deploymentUrl: submission.deploymentUrl,
      commitSha: submission.commitSha,
      category: submission.problem.category,
      contractSpec: submission.problem.contractSpec,
      hiddenTests: submission.problem.hiddenTests.map((test) => ({
        id: test.id,
        name: test.name,
        kind: test.kind,
        spec: test.spec,
        weight: test.weight,
        timeoutMs: test.timeoutMs,
      })),
    });

    const finishedAt = new Date();

    const data = {
      tournamentId: submission.tournamentId,
      attempt: job.attempts,
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
      probeEvidence: outcome.probeEvidence as unknown as Prisma.InputJsonValue,
      repoTextSnapshot:
        outcome.repoTextSnapshot as unknown as Prisma.InputJsonValue,
      rubricVersion: outcome.ai.rubricVersion,
      modelId: outcome.ai.modelId,
      modelPromptHash: outcome.ai.promptHash,
      llmRaw: outcome.ai.raw as unknown as Prisma.InputJsonValue,
      startedAt,
      finishedAt,
      error: null,
    };

    // One evaluation per submission; a retry updates in place.
    await db.$transaction([
      db.evaluation.upsert({
        where: { submissionId },
        create: { submissionId, ...data },
        update: data,
      }),
      db.submission.update({
        where: { id: submissionId },
        data: { status: 'SCORED' },
      }),
    ]);

    log.info({ overallScore: outcome.overallScore }, 'submission scored');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';

    // An unsupported category (D17) will never succeed on retry — record it and
    // stop rather than burning attempts.
    if (error instanceof UnsupportedCategoryError) {
      await db.submission.update({
        where: { id: submissionId },
        data: { status: 'FAILED' },
      });
      log.error({ err: message }, 'category not enabled for evaluation');
      return;
    }

    await db.submission.update({
      where: { id: submissionId },
      data: { status: 'QUEUED' },
    });
    // Rethrow so the runner applies backoff / dead-letters after maxAttempts.
    throw error;
  }
}
