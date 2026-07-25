import 'server-only';
import type {
  ChallengeCategory,
  Prisma,
  Problem,
  ProblemVisibility,
  Role,
} from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { recordAudit } from '@/server/modules/admin/audit';
import { isAdmin } from '@/server/modules/auth/roles';
import { enabledCategories } from '@/server/modules/evaluation';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Problem Delivery module (module 5 in docs/04-module-breakdown; blueprint
 * E3.4). Authoring lives here; *revealing* a problem stays with the Tournament
 * module, which owns `opensAt`.
 *
 * ## The one rule that matters
 *
 * **Hidden tests never leave the server.** Every read in this module comes in
 * two forms: an authoring view that includes the test specs (admin only) and a
 * competitor view that cannot express them at all. The separation is in the
 * return types, not in a caller remembering to strip a field.
 */

type Actor = { id: string; role: Role };

function assertAdmin(actor: Actor) {
  if (!isAdmin(actor)) throw new ForbiddenError('Admin access required');
}

export interface ProblemSummary {
  id: string;
  title: string;
  slug: string;
  category: ChallengeCategory;
  evaluationStrategy: string;
  difficulty: string | null;
  visibility: ProblemVisibility;
  hiddenTests: number;
  /** Rounds this problem is assigned to. */
  assignedRounds: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Authoring view — includes the hidden tests. Admin only. */
export interface ProblemDetail extends ProblemSummary {
  statementMarkdown: string;
  contractSpec: unknown;
  starterRepoUrl: string | null;
  tests: Array<{
    id: string;
    sequence: number;
    name: string;
    kind: string;
    spec: unknown;
    weight: number;
    timeoutMs: number;
  }>;
}

function toSummary(
  problem: Problem & { _count: { hiddenTests: number; rounds: number } },
): ProblemSummary {
  return {
    id: problem.id,
    title: problem.title,
    slug: problem.slug,
    category: problem.category,
    evaluationStrategy: problem.evaluationStrategy,
    difficulty: problem.difficulty,
    visibility: problem.visibility,
    hiddenTests: problem._count.hiddenTests,
    assignedRounds: problem._count.rounds,
    createdAt: problem.createdAt,
    updatedAt: problem.updatedAt,
  };
}

export interface CreateProblemInput {
  title: string;
  slug: string;
  statementMarkdown: string;
  category: ChallengeCategory;
  evaluationStrategy?: string;
  difficulty?: string | null;
  contractSpec?: unknown;
  starterRepoUrl?: string | null;
}

/**
 * A problem may only be authored in a category the engine can actually
 * evaluate (D17). Refusing here means an organizer finds out while writing the
 * problem, not when the first competitor's evaluation dead-letters.
 */
function assertCategoryAuthorable(category: ChallengeCategory) {
  const enabled = enabledCategories();
  if (!enabled.includes(category)) {
    throw new ValidationError(
      `Challenge category ${category} is not enabled for evaluation yet. Enabled: ${enabled.join(', ')}`,
    );
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === 'P2002'
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

export async function createProblem(
  input: CreateProblemInput,
  actor: Actor,
): Promise<Problem> {
  assertAdmin(actor);
  assertCategoryAuthorable(input.category);

  try {
    return await db.$transaction(async (tx) => {
      const problem = await tx.problem.create({
        data: {
          title: input.title,
          slug: input.slug,
          statementMarkdown: input.statementMarkdown,
          category: input.category,
          // The strategy key defaults to the category; D4 allows them to differ
          // but nothing yet needs them to.
          evaluationStrategy: input.evaluationStrategy ?? input.category,
          difficulty: input.difficulty ?? null,
          contractSpec: (input.contractSpec ?? {}) as Prisma.InputJsonValue,
          starterRepoUrl: input.starterRepoUrl ?? null,
          visibility: 'DRAFT',
          authorId: actor.id,
        },
      });

      await recordAudit(
        {
          actorId: actor.id,
          action: 'problem.create',
          entityType: 'Problem',
          entityId: problem.id,
          after: { slug: problem.slug, category: problem.category },
        },
        tx,
      );

      return problem;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError(
        `A problem with slug "${input.slug}" already exists`,
      );
    }
    throw error;
  }
}

export interface UpdateProblemInput {
  title?: string;
  statementMarkdown?: string;
  category?: ChallengeCategory;
  evaluationStrategy?: string;
  difficulty?: string | null;
  contractSpec?: unknown;
  starterRepoUrl?: string | null;
}

/**
 * Edit a problem. Published problems may still be edited — a typo in a live
 * statement has to be fixable — but the CATEGORY is frozen once published,
 * because it selects the evaluation strategy and changing it would rescore
 * competitors against a different set of rules mid-tournament.
 */
export async function updateProblem(
  problemId: string,
  input: UpdateProblemInput,
  actor: Actor,
): Promise<Problem> {
  assertAdmin(actor);

  return db.$transaction(async (tx) => {
    const before = await tx.problem.findUnique({ where: { id: problemId } });
    if (!before) throw new NotFoundError('That problem does not exist');

    if (input.category !== undefined && input.category !== before.category) {
      if (before.visibility !== 'DRAFT') {
        throw new ConflictError(
          'The category of a published problem cannot be changed — it selects the evaluation strategy',
        );
      }
      assertCategoryAuthorable(input.category);
    }

    if (
      input.contractSpec !== undefined &&
      !sameJson(input.contractSpec, before.contractSpec)
    ) {
      const activeRounds = await tx.round.count({
        where: { problemId, status: { in: ['OPEN', 'JUDGING'] } },
      });
      if (activeRounds > 0) {
        throw new ConflictError(
          'The contract spec cannot change while a round using this problem is running',
        );
      }
    }

    const after = await tx.problem.update({
      where: { id: problemId },
      data: {
        title: input.title,
        statementMarkdown: input.statementMarkdown,
        category: input.category,
        evaluationStrategy: input.evaluationStrategy,
        difficulty: input.difficulty,
        contractSpec:
          input.contractSpec === undefined
            ? undefined
            : (input.contractSpec as Prisma.InputJsonValue),
        starterRepoUrl: input.starterRepoUrl,
      },
    });

    await recordAudit(
      {
        actorId: actor.id,
        action: 'problem.update',
        entityType: 'Problem',
        entityId: problemId,
        before: { title: before.title, category: before.category },
        after: { title: after.title, category: after.category },
      },
      tx,
    );

    return after;
  });
}

/**
 * Publish a problem so it can be assigned to a round.
 *
 * Refused without at least one hidden test: a published problem with no tests
 * scores every competitor 0 on the 60%-weighted Functional dimension (D2), and
 * the failure would only surface after a whole round had been played.
 */
export async function publishProblem(
  problemId: string,
  actor: Actor,
): Promise<Problem> {
  assertAdmin(actor);

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${problemId}))`;

    const problem = await tx.problem.findUnique({
      where: { id: problemId },
      include: { _count: { select: { hiddenTests: true } } },
    });
    if (!problem) throw new NotFoundError('That problem does not exist');
    if (problem.visibility === 'ARCHIVED') {
      throw new ConflictError('An archived problem cannot be published');
    }
    if (problem._count.hiddenTests === 0) {
      throw new ConflictError(
        'Add at least one hidden test before publishing — a problem with none scores every competitor 0 on Functional',
      );
    }
    assertCategoryAuthorable(problem.category);

    const published = await tx.problem.update({
      where: { id: problemId },
      data: { visibility: 'PUBLISHED' },
    });

    await recordAudit(
      {
        actorId: actor.id,
        action: 'problem.publish',
        entityType: 'Problem',
        entityId: problemId,
        before: { visibility: problem.visibility },
        after: { visibility: 'PUBLISHED' },
      },
      tx,
    );

    logger.info({ problemId, actorId: actor.id }, 'problem published');
    return published;
  });
}

/**
 * Archive a problem so it stops appearing in the authoring list.
 * Refused while it is assigned to a round that has not finished — archiving a
 * problem competitors are actively solving would be invisible to them but
 * confusing to every operator afterwards.
 */
export async function archiveProblem(
  problemId: string,
  actor: Actor,
): Promise<Problem> {
  assertAdmin(actor);

  return db.$transaction(async (tx) => {
    const problem = await tx.problem.findUnique({ where: { id: problemId } });
    if (!problem) throw new NotFoundError('That problem does not exist');

    const liveRounds = await tx.round.count({
      where: { problemId, status: { in: ['PENDING', 'OPEN', 'JUDGING'] } },
    });
    if (liveRounds > 0) {
      throw new ConflictError(
        'This problem is assigned to a round that has not finished',
      );
    }

    const archived = await tx.problem.update({
      where: { id: problemId },
      data: { visibility: 'ARCHIVED' },
    });

    await recordAudit(
      {
        actorId: actor.id,
        action: 'problem.archive',
        entityType: 'Problem',
        entityId: problemId,
        before: { visibility: problem.visibility },
        after: { visibility: 'ARCHIVED' },
      },
      tx,
    );

    return archived;
  });
}

// ───────────────────────── Hidden tests ─────────────────────────

export interface HiddenTestInput {
  name: string;
  kind: string;
  spec: unknown;
  weight?: number;
  timeoutMs?: number;
}

/**
 * Append a hidden test. The sequence is assigned server-side so two admins
 * adding tests concurrently cannot collide on `(problemId, sequence)`.
 */
export async function addHiddenTest(
  problemId: string,
  input: HiddenTestInput,
  actor: Actor,
) {
  assertAdmin(actor);

  return db.$transaction(async (tx) => {
    const problem = await tx.problem.findUnique({
      where: { id: problemId },
      select: { id: true, visibility: true },
    });
    if (!problem) throw new NotFoundError('That problem does not exist');
    if (problem.visibility === 'ARCHIVED') {
      throw new ConflictError('An archived problem cannot be edited');
    }

    const activeRounds = await tx.round.count({
      where: { problemId, status: { in: ['OPEN', 'JUDGING'] } },
    });
    if (activeRounds > 0) {
      throw new ConflictError(
        'Cannot add hidden tests while a round using this problem is running',
      );
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${problemId}))`;

    const last = await tx.hiddenTest.findFirst({
      where: { problemId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });

    const test = await tx.hiddenTest.create({
      data: {
        problemId,
        sequence: (last?.sequence ?? 0) + 1,
        name: input.name,
        kind: input.kind,
        spec: input.spec as Prisma.InputJsonValue,
        weight: input.weight ?? 1,
        timeoutMs: input.timeoutMs ?? 10_000,
      },
    });

    await recordAudit(
      {
        actorId: actor.id,
        action: 'problem.addHiddenTest',
        entityType: 'Problem',
        entityId: problemId,
        // The spec itself is deliberately NOT audited — the audit log is
        // readable in the admin UI, and a hidden test must stay hidden.
        after: { testId: test.id, name: test.name, weight: test.weight },
      },
      tx,
    );

    return test;
  });
}

export async function removeHiddenTest(
  testId: string,
  actor: Actor,
): Promise<void> {
  assertAdmin(actor);

  await db.$transaction(async (tx) => {
    const test = await tx.hiddenTest.findUnique({
      where: { id: testId },
      include: { problem: { select: { id: true, visibility: true } } },
    });
    if (!test) throw new NotFoundError('That hidden test does not exist');

    const liveRounds = await tx.round.count({
      where: { problemId: test.problemId, status: { in: ['OPEN', 'JUDGING'] } },
    });
    if (liveRounds > 0) {
      throw new ConflictError(
        'Cannot change hidden tests while a round using this problem is running',
      );
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${test.problemId}))`;

    if (test.problem.visibility === 'PUBLISHED') {
      const hiddenTestCount = await tx.hiddenTest.count({
        where: { problemId: test.problemId },
      });
      if (hiddenTestCount <= 1) {
        throw new ConflictError(
          'A published problem must keep at least one hidden test; archive or edit the problem first',
        );
      }
    }

    await tx.hiddenTest.delete({ where: { id: testId } });

    await recordAudit(
      {
        actorId: actor.id,
        action: 'problem.removeHiddenTest',
        entityType: 'Problem',
        entityId: test.problemId,
        before: { testId, name: test.name },
      },
      tx,
    );
  });
}

// ───────────────────────── Assignment ─────────────────────────

/**
 * Assign a published problem to a round. The problem is only *revealed* at the
 * round's `opensAt` — that gate belongs to the Tournament module and is not
 * re-implemented here.
 */
export async function assignProblemToRound(
  roundId: string,
  problemId: string,
  actor: Actor,
) {
  assertAdmin(actor);

  return db.$transaction(async (tx) => {
    const [round, problem] = await Promise.all([
      tx.round.findUnique({
        where: { id: roundId },
        select: { id: true, status: true, problemId: true, stage: true },
      }),
      tx.problem.findUnique({
        where: { id: problemId },
        select: { id: true, visibility: true, category: true },
      }),
    ]);
    if (!round) throw new NotFoundError('That round does not exist');
    if (!problem) throw new NotFoundError('That problem does not exist');

    if (problem.visibility !== 'PUBLISHED') {
      throw new ConflictError('Only a published problem can be assigned');
    }
    if (round.status !== 'PENDING') {
      throw new ConflictError(
        `A problem can only be assigned before the round opens (this round is ${round.status})`,
      );
    }

    const updated = await tx.round.update({
      where: { id: roundId },
      data: { problemId },
    });

    await recordAudit(
      {
        actorId: actor.id,
        action: 'problem.assignToRound',
        entityType: 'Round',
        entityId: roundId,
        before: { problemId: round.problemId },
        after: { problemId, stage: round.stage },
      },
      tx,
    );

    return updated;
  });
}

// ───────────────────────── Reads ─────────────────────────

export async function listProblems(
  actor: Actor,
  options: {
    visibility?: ProblemVisibility;
    includeArchived?: boolean;
    take?: number;
  } = {},
  client: DbClient = db,
): Promise<ProblemSummary[]> {
  assertAdmin(actor);

  const problems = await client.problem.findMany({
    where: options.visibility
      ? { visibility: options.visibility }
      : options.includeArchived
        ? undefined
        : { visibility: { not: 'ARCHIVED' } },
    orderBy: { createdAt: 'desc' },
    take: options.take ?? 100,
    include: { _count: { select: { hiddenTests: true, rounds: true } } },
  });
  return problems.map(toSummary);
}

/** Authoring view — INCLUDES hidden test specs. Admin only, never for a competitor. */
export async function getProblemDetail(
  problemId: string,
  actor: Actor,
  client: DbClient = db,
): Promise<ProblemDetail> {
  assertAdmin(actor);

  const problem = await client.problem.findUnique({
    where: { id: problemId },
    include: {
      _count: { select: { hiddenTests: true, rounds: true } },
      hiddenTests: { orderBy: { sequence: 'asc' } },
    },
  });
  if (!problem) throw new NotFoundError('That problem does not exist');

  return {
    ...toSummary(problem),
    statementMarkdown: problem.statementMarkdown,
    contractSpec: problem.contractSpec,
    starterRepoUrl: problem.starterRepoUrl,
    tests: problem.hiddenTests.map((test) => ({
      id: test.id,
      sequence: test.sequence,
      name: test.name,
      kind: test.kind,
      spec: test.spec,
      weight: test.weight,
      timeoutMs: test.timeoutMs,
    })),
  };
}

/** Published problems, for the round-assignment picker. */
export async function listAssignableProblems(
  actor: Actor,
  client: DbClient = db,
): Promise<ProblemSummary[]> {
  return listProblems(actor, { visibility: 'PUBLISHED' }, client);
}
