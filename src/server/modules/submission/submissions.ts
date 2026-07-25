import 'server-only';
import type {
  Prisma,
  Round,
  Submission,
  Tournament,
  TournamentStatus,
  User,
} from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { recordAudit } from '@/server/modules/admin/audit';
import {
  assertRegistered,
  isSubmissionWindowOpen,
} from '@/server/modules/tournament';
import { enqueueEvaluation } from '@/server/jobs';
import { describeJob, type JobLifecycle } from '@/server/jobs/status';
// The pure predicate, not the auth barrel: `session.ts` pulls in
// `next/navigation`, which cannot be loaded outside a Next runtime (scripts,
// the runner). `roles.ts` exists for exactly this reason.
import { isAdmin } from '@/server/modules/auth/roles';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@/lib/errors';
import { logger } from '@/lib/logger';
import { assertCategorySupported, validateSubmissionInput } from './validation';
import {
  nextSubmissionState,
  toPersistedStatus,
  toSubmissionState,
  InvalidSubmissionTransitionError,
  SUBMISSION_STATE_LABEL,
  type SubmissionState,
  type SubmissionTransition,
} from './state';

/**
 * The Submission module (E4) — module 6 in docs/04-module-breakdown.
 *
 * Owns: accepting an entry, replacing it while the window is open, sealing it
 * at the deadline, and handing it to the queue. It owns **no** scheduling and
 * **no** scoring:
 *
 * - *When* a competitor may submit is the Tournament module's answer
 *   (`isSubmissionWindowOpen`) — this module asks, it never re-derives a
 *   schedule.
 * - *How* an entry scores is the Evaluation Engine's answer, reached only
 *   through the `Queue` interface. Nothing here imports `runEvaluation`.
 *
 * The path is strictly `Submission → Queue → Runner → Evaluation Engine`.
 */

/**
 * Apply a state transition, translating a machine violation into a typed
 * `ConflictError`.
 *
 * `nextSubmissionState` throws `InvalidSubmissionTransitionError`, which is a
 * plain `Error`. Letting it escape the module would surface as `INTERNAL` at
 * the action boundary — a 500 for what is really "you cannot do that to a
 * submission in this state". Nothing raw crosses this boundary.
 */
function transition(
  from: SubmissionState,
  name: SubmissionTransition,
): SubmissionState {
  try {
    return nextSubmissionState(from, name);
  } catch (error) {
    if (error instanceof InvalidSubmissionTransitionError) {
      throw new ConflictError(
        `This submission is ${SUBMISSION_STATE_LABEL[from].toLowerCase()}; it cannot be ${TRANSITION_VERB[name]}`,
      );
    }
    throw error;
  }
}

const TRANSITION_VERB: Record<SubmissionTransition, string> = {
  SUBMIT: 'submitted',
  ENQUEUE: 'queued',
  START: 'started',
  COMPLETE: 'completed',
  FAIL: 'failed',
  REQUEUE: 're-queued',
  RETRY: 'retried',
  RESUBMIT: 'replaced',
  DISQUALIFY: 'disqualified',
};

/** Tournament states during which entries may be accepted. */
const SUBMITTABLE_TOURNAMENT_STATUSES: readonly TournamentStatus[] = [
  'SIMULATION',
  'LIVE',
] as const;

export interface SubmitInput {
  userId: string;
  roundId: string;
  repoUrl: string;
  deploymentUrl: string;
  commitSha?: string | null;
}

export interface SubmissionResult {
  submission: Submission;
  /** True when this call replaced an existing entry rather than creating one. */
  replaced: boolean;
  version: number;
  jobId: string;
}

type RoundContext = Round & {
  tournament: Tournament;
  problem: {
    id: string;
    category: Parameters<typeof assertCategorySupported>[0];
  } | null;
};

/**
 * Everything that must be true before an entry is accepted, in one place so
 * create and replace cannot drift apart.
 */
async function loadSubmittableRound(
  client: DbClient,
  roundId: string,
  userId: string,
  now: Date,
): Promise<RoundContext> {
  const round = await client.round.findUnique({
    where: { id: roundId },
    include: {
      tournament: true,
      problem: { select: { id: true, category: true } },
    },
  });
  if (!round) throw new NotFoundError('That round does not exist');

  if (!SUBMITTABLE_TOURNAMENT_STATUSES.includes(round.tournament.status)) {
    throw new ConflictError(
      `This tournament is not accepting submissions (it is ${round.tournament.status})`,
    );
  }

  // Registration is the access gate (E3 owns it).
  await assertRegistered(round.tournamentId, userId, client);

  if (!isSubmissionWindowOpen(round, now)) {
    throw new AppError(
      'WINDOW_CLOSED',
      round.status === 'OPEN'
        ? 'The submission window for this round has closed'
        : 'This round is not open for submissions',
    );
  }

  if (!round.problem) {
    throw new ConflictError('This round has no problem assigned yet');
  }
  assertCategorySupported(round.problem.category);

  // Knockout rounds are per-match: a competitor may only submit to a round they
  // were actually paired into. Authorisation is derived from the bracket, never
  // from the client having navigated to the page.
  if (round.type === 'KNOCKOUT') {
    const match = await client.match.findFirst({
      where: {
        roundId: round.id,
        OR: [{ competitorAId: userId }, { competitorBId: userId }],
      },
      select: { id: true },
    });
    if (!match) {
      throw new ForbiddenError('You are not competing in this round');
    }
  }

  return round as RoundContext;
}

/** The match this competitor plays in this round, if it is a knockout round. */
async function findMatchId(
  client: DbClient,
  round: Round,
  userId: string,
): Promise<string | null> {
  if (round.type !== 'KNOCKOUT') return null;
  const match = await client.match.findFirst({
    where: {
      roundId: round.id,
      OR: [{ competitorAId: userId }, { competitorBId: userId }],
    },
    select: { id: true },
  });
  return match?.id ?? null;
}

/** Postgres unique-constraint violation, surfaced by Prisma. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

/**
 * Which constraint a P2002 was raised on.
 *
 * Prisma reports this in more than one shape depending on the driver. With the
 * `@prisma/adapter-pg` driver adapter (what we run) `meta.target` is absent
 * entirely and the detail lives under `meta.driverAdapterError.cause` — as a
 * `constraint.fields` array of *quoted* names plus the raw Postgres message.
 * Reading only `meta.target`, as the obvious implementation does, silently
 * matches nothing and lets a raw Prisma error escape the module.
 */
function violatedTarget(error: unknown): string {
  const meta = (error as { meta?: Record<string, unknown> } | null)?.meta;
  if (!meta) return '';

  const parts: string[] = [];

  const target = meta.target;
  if (Array.isArray(target)) parts.push(target.join(','));
  else if (typeof target === 'string') parts.push(target);

  const cause = (
    meta.driverAdapterError as { cause?: Record<string, unknown> } | undefined
  )?.cause;
  if (cause) {
    const fields = (cause.constraint as { fields?: unknown } | undefined)
      ?.fields;
    if (Array.isArray(fields)) parts.push(fields.join(','));
    if (typeof cause.originalMessage === 'string') {
      parts.push(cause.originalMessage);
    }
  }

  return parts.join(' ');
}

/**
 * Refuse a deployment URL already claimed by a different competitor in the same
 * round (D19 — deployment-URL reuse detection). Two entries pointing at one
 * deployment are either collusion or a copy-paste mistake; both deserve to fail
 * loudly at submit time rather than produce two identical scores.
 *
 * This is the FRIENDLY half of the rule. It is read-then-write, so two
 * competitors submitting the same URL at once would both pass it; the
 * `(roundId, deploymentUrl)` unique index is what actually prevents the
 * duplicate, and `submitSolution` translates that violation back into the same
 * error. Both halves exist because a constraint alone gives a competitor a
 * useless message, and a check alone gives a race.
 */
async function assertDeploymentNotReused(
  client: DbClient,
  roundId: string,
  userId: string,
  deploymentUrl: string,
): Promise<void> {
  const clash = await client.submission.findFirst({
    where: {
      roundId,
      deploymentUrl,
      userId: { not: userId },
      status: { not: 'DISQUALIFIED' },
    },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError(
      'That deployment URL has already been submitted by another competitor in this round',
    );
  }
}

/**
 * Enqueue an evaluation for a submission.
 *
 * The attempt number is the count of jobs already created for this submission,
 * so each accepted revision — and each admin retry — gets its own job while a
 * duplicate call collapses onto the existing one through the queue's
 * idempotency key.
 */
async function enqueueForSubmission(
  client: DbClient,
  submissionId: string,
): Promise<string> {
  const priorJobs = await client.evaluationJob.count({
    where: { submissionId, name: 'evaluate' },
  });
  return enqueueEvaluation(submissionId, priorJobs + 1);
}

/**
 * Accept an entry, or replace the competitor's existing entry for this round.
 *
 * One `Submission` per (user, round) — the unique key E3's advancement reads
 * through — with every accepted version appended to `SubmissionRevision`.
 */
export async function submitSolution(
  input: SubmitInput,
  options: { now?: Date } = {},
): Promise<SubmissionResult> {
  const now = options.now ?? new Date();
  const validated = validateSubmissionInput(input);

  let accepted;
  try {
    accepted = await db.$transaction(async (tx) => {
      const round = await loadSubmittableRound(
        tx,
        input.roundId,
        input.userId,
        now,
      );
      await assertDeploymentNotReused(
        tx,
        round.id,
        input.userId,
        validated.deploymentUrl,
      );

      const existing = await tx.submission.findUnique({
        where: { userId_roundId: { userId: input.userId, roundId: round.id } },
      });

      if (existing) {
        return replaceSubmission(tx, existing, validated, now);
      }
      return createSubmission(tx, input.userId, round, validated, now);
    });
  } catch (error) {
    // The checks above are read-then-write, so a concurrent submission can slip
    // between them and the insert. The unique indexes are what actually hold
    // the line; translate their violations into the SAME typed errors the
    // friendly checks produce, so a race is indistinguishable to the caller.
    if (isUniqueViolation(error)) {
      const target = violatedTarget(error);
      if (target.includes('deploymentUrl')) {
        throw new ConflictError(
          'That deployment URL has already been submitted by another competitor in this round',
        );
      }
      if (target.includes('roundId')) {
        throw new ConflictError(
          'You already have an entry for this round; refresh and try again',
        );
      }
    }
    throw error;
  }

  const { submission, replaced, version } = accepted;

  // Enqueue AFTER the entry is committed. Enqueuing inside the transaction
  // would let the runner claim a job for a row that has not landed yet — the
  // classic dual-write race — and a rollback would strand a job pointing at a
  // submission that never existed.
  const jobId = await enqueueForSubmission(db, submission.id);
  await db.submission.update({
    where: { id: submission.id },
    data: { status: toPersistedStatus(transition('READY', 'ENQUEUE')) },
  });

  logger.info(
    {
      submissionId: submission.id,
      userId: input.userId,
      roundId: input.roundId,
      version,
      replaced,
      jobId,
    },
    replaced ? 'submission replaced' : 'submission accepted',
  );

  return { submission, replaced, version, jobId };
}

async function createSubmission(
  tx: DbClient,
  userId: string,
  round: RoundContext,
  validated: ReturnType<typeof validateSubmissionInput>,
  now: Date,
) {
  const matchId = await findMatchId(tx, round, userId);

  const submission = await tx.submission.create({
    data: {
      userId,
      tournamentId: round.tournamentId,
      roundId: round.id,
      matchId,
      problemId: round.problem!.id,
      category: round.problem!.category,
      repoUrl: validated.repoUrl,
      deploymentUrl: validated.deploymentUrl,
      commitSha: validated.commitSha,
      version: 1,
      submittedAt: now,
      status: toPersistedStatus(transition('DRAFT', 'SUBMIT')),
      revisions: {
        create: {
          version: 1,
          repoUrl: validated.repoUrl,
          deploymentUrl: validated.deploymentUrl,
          commitSha: validated.commitSha,
          submittedAt: now,
        },
      },
    },
  });

  await recordAudit(
    {
      actorId: userId,
      action: 'submission.create',
      entityType: 'Submission',
      entityId: submission.id,
      after: {
        roundId: round.id,
        version: 1,
        repoUrl: validated.repoUrl,
        deploymentUrl: validated.deploymentUrl,
      },
    },
    tx,
  );

  return { submission, replaced: false, version: 1 };
}

async function replaceSubmission(
  tx: DbClient,
  existing: Submission,
  validated: ReturnType<typeof validateSubmissionInput>,
  now: Date,
) {
  if (existing.sealedAt) {
    throw new AppError(
      'WINDOW_CLOSED',
      'This submission has been sealed and can no longer be changed',
    );
  }

  const state = toSubmissionState(existing.status);
  // Throws InvalidSubmissionTransitionError for a DISQUALIFIED entry — a struck
  // entry must not be quietly resurrected by resubmitting.
  const target = transition(state, 'RESUBMIT');
  const version = existing.version + 1;

  const submission = await tx.submission.update({
    where: { id: existing.id },
    data: {
      repoUrl: validated.repoUrl,
      deploymentUrl: validated.deploymentUrl,
      commitSha: validated.commitSha,
      version,
      submittedAt: now,
      status: toPersistedStatus(target),
      revisions: {
        create: {
          version,
          repoUrl: validated.repoUrl,
          deploymentUrl: validated.deploymentUrl,
          commitSha: validated.commitSha,
          submittedAt: now,
        },
      },
    },
  });

  await recordAudit(
    {
      actorId: existing.userId,
      action: 'submission.replace',
      entityType: 'Submission',
      entityId: existing.id,
      before: {
        version: existing.version,
        repoUrl: existing.repoUrl,
        deploymentUrl: existing.deploymentUrl,
      },
      after: {
        version,
        repoUrl: validated.repoUrl,
        deploymentUrl: validated.deploymentUrl,
      },
    },
    tx,
  );

  return { submission, replaced: true, version };
}

/**
 * Seal every entry in a round once its window has closed. A sealed submission
 * is immutable — this is the anti-cheat anchor that makes "no edits after the
 * deadline" a property of the data, not of the UI.
 *
 * Idempotent: already-sealed rows are left alone.
 */
export async function sealRoundSubmissions(
  roundId: string,
  options: { now?: Date; client?: DbClient } = {},
): Promise<{ sealed: number }> {
  const client = options.client ?? db;
  const now = options.now ?? new Date();

  const round = await client.round.findUnique({
    where: { id: roundId },
    select: { id: true, status: true, deadlineAt: true },
  });
  if (!round) throw new NotFoundError('That round does not exist');

  const windowOver =
    round.status === 'JUDGING' ||
    round.status === 'COMPLETED' ||
    (round.deadlineAt !== null && round.deadlineAt <= now);

  if (!windowOver) {
    throw new ConflictError(
      'The submission window is still open; entries cannot be sealed yet',
    );
  }

  const result = await client.submission.updateMany({
    where: { roundId, sealedAt: null },
    data: { sealedAt: round.deadlineAt ?? now },
  });

  if (result.count > 0) {
    logger.info({ roundId, sealed: result.count }, 'submissions sealed');
  }
  return { sealed: result.count };
}

// ───────────────────────────── Reads ─────────────────────────────

export interface SubmissionView {
  id: string;
  userId: string;
  tournamentId: string;
  roundId: string;
  matchId: string | null;
  problemId: string;
  category: Submission['category'];
  repoUrl: string;
  deploymentUrl: string;
  commitSha: string | null;
  version: number;
  submittedAt: Date;
  sealedAt: Date | null;
  state: SubmissionState;
  /** Present once the engine has written a result. */
  evaluation: EvaluationView | null;
  /** Lifecycle of the most recent evaluation job, if any. */
  job: JobLifecycle | null;
}

export interface EvaluationView {
  overallScore: number;
  functionalScore: number;
  performanceScore: number;
  securityReliabilityScore: number;
  aiScore: number;
  testsPassed: number;
  testsTotal: number;
  deploymentReachable: boolean;
  weights: unknown;
  profileName: string | null;
  dimensions: unknown;
  llmProvider: string | null;
  modelId: string | null;
  modelPromptHash: string | null;
  rubricVersion: string | null;
  submissionVersion: number;
  attempt: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  overriddenBy: string | null;
  overrideReason: string | null;
}

const SUBMISSION_INCLUDE = {
  evaluation: true,
  jobs: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.SubmissionInclude;

type SubmissionWithRelations = Prisma.SubmissionGetPayload<{
  include: typeof SUBMISSION_INCLUDE;
}>;

function toView(
  row: SubmissionWithRelations,
  now = new Date(),
): SubmissionView {
  const job = row.jobs[0];
  return {
    id: row.id,
    userId: row.userId,
    tournamentId: row.tournamentId,
    roundId: row.roundId,
    matchId: row.matchId,
    problemId: row.problemId,
    category: row.category,
    repoUrl: row.repoUrl,
    deploymentUrl: row.deploymentUrl,
    commitSha: row.commitSha,
    version: row.version,
    submittedAt: row.submittedAt,
    sealedAt: row.sealedAt,
    state: toSubmissionState(row.status),
    evaluation: row.evaluation
      ? {
          overallScore: row.evaluation.overallScore,
          functionalScore: row.evaluation.functionalScore,
          performanceScore: row.evaluation.performanceScore,
          securityReliabilityScore: row.evaluation.securityReliabilityScore,
          aiScore: row.evaluation.aiScore,
          testsPassed: row.evaluation.testsPassed,
          testsTotal: row.evaluation.testsTotal,
          deploymentReachable: row.evaluation.deploymentReachable,
          weights: row.evaluation.weights,
          profileName: row.evaluation.profileName,
          dimensions: row.evaluation.dimensions,
          llmProvider: row.evaluation.llmProvider,
          modelId: row.evaluation.modelId,
          modelPromptHash: row.evaluation.modelPromptHash,
          rubricVersion: row.evaluation.rubricVersion,
          submissionVersion: row.evaluation.submissionVersion,
          attempt: row.evaluation.attempt,
          startedAt: row.evaluation.startedAt,
          finishedAt: row.evaluation.finishedAt,
          error: row.evaluation.error,
          overriddenBy: row.evaluation.overriddenBy,
          overrideReason: row.evaluation.overrideReason,
        }
      : null,
    job: job ? describeJob(job, now) : null,
  };
}

/** Authorisation: a competitor sees their own entries, an admin sees all. */
function assertCanView(viewer: Pick<User, 'id' | 'role'>, ownerId: string) {
  if (viewer.id !== ownerId && !isAdmin(viewer)) {
    throw new ForbiddenError('You can only view your own submissions');
  }
}

export async function getSubmission(
  submissionId: string,
  viewer: Pick<User, 'id' | 'role'>,
): Promise<SubmissionView> {
  const row = await db.submission.findUnique({
    where: { id: submissionId },
    include: SUBMISSION_INCLUDE,
  });
  if (!row) throw new NotFoundError('That submission does not exist');
  assertCanView(viewer, row.userId);
  return toView(row);
}

/** The competitor's current entry for a round, if any. */
export async function getMySubmission(
  userId: string,
  roundId: string,
): Promise<SubmissionView | null> {
  const row = await db.submission.findUnique({
    where: { userId_roundId: { userId, roundId } },
    include: SUBMISSION_INCLUDE,
  });
  return row ? toView(row) : null;
}

export async function listMySubmissions(
  userId: string,
  filter: { tournamentId?: string; take?: number } = {},
): Promise<SubmissionView[]> {
  const rows = await db.submission.findMany({
    where: {
      userId,
      ...(filter.tournamentId ? { tournamentId: filter.tournamentId } : {}),
    },
    include: SUBMISSION_INCLUDE,
    orderBy: { submittedAt: 'desc' },
    take: filter.take ?? 50,
  });
  return rows.map((row) => toView(row));
}

/** Append-only history of every accepted version. */
export async function getSubmissionHistory(
  submissionId: string,
  viewer: Pick<User, 'id' | 'role'>,
) {
  const row = await db.submission.findUnique({
    where: { id: submissionId },
    select: { userId: true },
  });
  if (!row) throw new NotFoundError('That submission does not exist');
  assertCanView(viewer, row.userId);

  return db.submissionRevision.findMany({
    where: { submissionId },
    orderBy: { version: 'desc' },
  });
}

// ───────────────────────────── Admin ─────────────────────────────

export async function listAllSubmissions(
  admin: Pick<User, 'id' | 'role'>,
  filter: {
    tournamentId?: string;
    roundId?: string;
    state?: SubmissionState;
    take?: number;
  } = {},
): Promise<SubmissionView[]> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  const rows = await db.submission.findMany({
    where: {
      ...(filter.tournamentId ? { tournamentId: filter.tournamentId } : {}),
      ...(filter.roundId ? { roundId: filter.roundId } : {}),
      ...(filter.state ? { status: toPersistedStatus(filter.state) } : {}),
    },
    include: SUBMISSION_INCLUDE,
    orderBy: { submittedAt: 'desc' },
    take: filter.take ?? 100,
  });
  return rows.map((row) => toView(row));
}

/**
 * Re-run an evaluation (the `reEnqueueEvaluation` ops escape hatch from the API
 * spec). Allowed from a settled state only — re-queueing something already in
 * flight would produce two concurrent evaluations of one entry.
 */
export async function retryEvaluation(
  submissionId: string,
  admin: Pick<User, 'id' | 'role'>,
): Promise<{ jobId: string; state: SubmissionState }> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, status: true, version: true },
  });
  if (!submission) throw new NotFoundError('That submission does not exist');

  const from = toSubmissionState(submission.status);
  const target = transition(from, 'RETRY');

  const jobId = await enqueueForSubmission(db, submissionId);
  await db.submission.update({
    where: { id: submissionId },
    data: { status: toPersistedStatus(target) },
  });

  await recordAudit({
    actorId: admin.id,
    action: 'submission.retryEvaluation',
    entityType: 'Submission',
    entityId: submissionId,
    before: { state: from },
    after: { state: target, jobId },
  });

  logger.info(
    { submissionId, jobId, from, to: target },
    'evaluation re-queued',
  );
  return { jobId, state: target };
}

/** Remove an entry from competition (D19). Terminal. */
export async function disqualifySubmission(
  submissionId: string,
  admin: Pick<User, 'id' | 'role'>,
  reason: string,
): Promise<SubmissionState> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, status: true },
  });
  if (!submission) throw new NotFoundError('That submission does not exist');

  const from = toSubmissionState(submission.status);
  const target = transition(from, 'DISQUALIFY');

  await db.submission.update({
    where: { id: submissionId },
    data: { status: toPersistedStatus(target) },
  });

  await recordAudit({
    actorId: admin.id,
    action: 'submission.disqualify',
    entityType: 'Submission',
    entityId: submissionId,
    before: { state: from },
    after: { state: target, reason },
  });

  return target;
}
