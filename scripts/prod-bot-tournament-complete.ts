import './load-env';
import type { RoundStage } from '../src/generated/prisma/client';
import { db } from '../src/server/db';
import { enqueueEvaluation, queue, type JobName } from '../src/server/jobs';
import { evaluateProcessor } from '../src/server/jobs/processors/evaluate';
import { submitSolution } from '../src/server/modules/submission';
import {
  applyTransition,
  getLeaderboard,
  getLifecycleState,
  openRound,
  progressTournament,
} from '../src/server/modules/tournament';

const TARGET_SLUG =
  process.env.BOT_TOURNAMENT_SLUG ?? 'prod-bot-score-20260729164038';
const DEPLOYMENT_BASE =
  process.env.BOT_TOURNAMENT_DEPLOYMENT_BASE ??
  'https://blitzit-production.up.railway.app/api/health';

const KNOCKOUT_STAGE_ORDER: RoundStage[] = [
  'R64',
  'R32',
  'R16',
  'QF',
  'SF',
  'THIRD_PLACE',
  'FINAL',
];

async function claimExactJob(jobId: string, lockedBy: string) {
  await db.evaluationJob.updateMany({
    where: { id: jobId, status: 'QUEUED' },
    data: {
      status: 'CLAIMED',
      lockedBy,
      claimedAt: new Date(),
      attempts: { increment: 1 },
    },
  });

  const job = await db.evaluationJob.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      id: true,
      name: true,
      payload: true,
      attempts: true,
      maxAttempts: true,
    },
  });

  return {
    id: job.id,
    name: job.name as JobName,
    payload: (job.payload as Record<string, unknown> | null) ?? {},
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
  };
}

async function processSubmissionJob(submissionId: string, lockedBy: string) {
  const existingQueued = await db.evaluationJob.findFirst({
    where: { submissionId, name: 'evaluate', status: 'QUEUED' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  const jobId = existingQueued?.id ?? (await enqueueEvaluation(submissionId));
  const job = await claimExactJob(jobId, lockedBy);
  try {
    await evaluateProcessor(job);
    await queue.complete(jobId, lockedBy);
  } catch (error) {
    await queue.fail(
      jobId,
      error instanceof Error ? error.message : String(error),
      0,
      lockedBy,
    );
    throw error;
  }
}

async function ensureLifecycleAtKnockout(tournamentId: string) {
  for (let guard = 0; guard < 5; guard++) {
    const tournament = await db.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      select: { status: true, currentStage: true },
    });

    if (tournament.status === 'LIVE' || tournament.status === 'COMPLETED') {
      return;
    }
    if (tournament.status === 'SIMULATION') {
      await applyTransition(tournamentId, 'CLOSE_SIMULATION', {
        runBy: 'prod-bot-complete',
        force: true,
      });
      continue;
    }
    if (tournament.status === 'SEEDING') {
      await applyTransition(tournamentId, 'GENERATE_BRACKET', {
        runBy: 'prod-bot-complete',
        force: true,
      });
      continue;
    }
    if (tournament.status === 'BRACKET_GENERATED') {
      await applyTransition(tournamentId, 'START_KNOCKOUT', {
        runBy: 'prod-bot-complete',
        force: true,
      });
      continue;
    }

    throw new Error(`cannot continue tournament from ${tournament.status}`);
  }
}

async function repoForUser(tournamentId: string, userId: string) {
  const simulation = await db.submission.findFirst({
    where: {
      tournamentId,
      userId,
      round: { type: 'SIMULATION' },
    },
    orderBy: { createdAt: 'asc' },
    select: { repoUrl: true },
  });
  if (simulation) return simulation.repoUrl;

  const profile = await db.profile.findUnique({
    where: { userId },
    select: { websiteUrl: true },
  });
  if (
    profile?.websiteUrl &&
    /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(profile.websiteUrl)
  ) {
    return profile.websiteUrl;
  }

  return 'https://github.com/vercel/next.js';
}

async function ensureProblem(roundId: string, tournamentId: string) {
  const round = await db.round.findUniqueOrThrow({
    where: { id: roundId },
    select: { problemId: true },
  });
  if (round.problemId) return round.problemId;

  const fallback = await db.problem.findFirst({
    where: {
      submissions: { some: { tournamentId, round: { type: 'SIMULATION' } } },
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!fallback) {
    throw new Error('no smoke problem exists to attach to the knockout round');
  }
  await db.round.update({
    where: { id: roundId },
    data: { problemId: fallback.id },
  });
  return fallback.id;
}

async function playCurrentStage(tournamentId: string, stage: RoundStage) {
  const round = await db.round.findFirstOrThrow({
    where: { tournamentId, stage },
    select: { id: true, status: true, deadlineAt: true },
  });
  await ensureProblem(round.id, tournamentId);

  const now = new Date();
  if (
    round.status !== 'OPEN' ||
    (round.deadlineAt && round.deadlineAt <= now)
  ) {
    await db.round.update({
      where: { id: round.id },
      data: {
        status: 'PENDING',
        opensAt: null,
        deadlineAt: null,
      },
    });
    await openRound(db, round.id, now);
  }

  const matches = await db.match.findMany({
    where: {
      tournamentId,
      roundId: round.id,
      status: { not: 'DECIDED' },
    },
    orderBy: { bracketPosition: 'asc' },
    select: {
      id: true,
      bracketPosition: true,
      competitorAId: true,
      competitorBId: true,
    },
  });

  const competitors = [
    ...new Set(
      matches
        .flatMap((match) => [match.competitorAId, match.competitorBId])
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const lockedBy = `prod-bot-complete-${TARGET_SLUG}-${stage}`;
  const submitted = [];
  for (const [index, userId] of competitors.entries()) {
    const repoUrl = await repoForUser(tournamentId, userId);
    const deploymentUrl = `${DEPLOYMENT_BASE}?stage=${stage}&slot=${index}&user=${userId.slice(
      0,
      8,
    )}&run=${TARGET_SLUG}`;

    const accepted = await submitSolution({
      userId,
      roundId: round.id,
      repoUrl,
      deploymentUrl,
    });
    await processSubmissionJob(accepted.submission.id, lockedBy);

    submitted.push({
      userId,
      repoUrl,
      submissionId: accepted.submission.id,
      replaced: accepted.replaced,
    });
  }

  await db.round.update({
    where: { id: round.id },
    data: { deadlineAt: new Date(Date.now() - 1000) },
  });

  const progress = await progressTournament(tournamentId, {
    runBy: 'prod-bot-complete',
  });

  return { stage, roundId: round.id, submitted, progress };
}

async function main() {
  const tournament = await db.tournament.findUniqueOrThrow({
    where: { slug: TARGET_SLUG },
    select: { id: true, slug: true, visibility: true },
  });

  if (tournament.visibility !== 'PUBLIC') {
    await db.tournament.update({
      where: { id: tournament.id },
      data: { visibility: 'PUBLIC' },
    });
  }

  await ensureLifecycleAtKnockout(tournament.id);

  const stageRuns = [];
  for (let guard = 0; guard < KNOCKOUT_STAGE_ORDER.length + 3; guard++) {
    const current = await db.tournament.findUniqueOrThrow({
      where: { id: tournament.id },
      select: { status: true, currentStage: true },
    });
    if (current.status === 'COMPLETED') break;
    if (current.status !== 'LIVE' || !current.currentStage) {
      await ensureLifecycleAtKnockout(tournament.id);
      continue;
    }
    stageRuns.push(await playCurrentStage(tournament.id, current.currentStage));
  }

  const finalState = await db.tournament.findUniqueOrThrow({
    where: { id: tournament.id },
    select: {
      id: true,
      slug: true,
      status: true,
      currentStage: true,
      visibility: true,
      completedAt: true,
    },
  });
  const leaderboard = await getLeaderboard(tournament.id, {
    by: 'score',
    take: 20,
  });
  const placements = await db.ranking.findMany({
    where: { tournamentId: tournament.id, qualified: true },
    orderBy: [{ placement: 'asc' }, { seed: 'asc' }],
    select: {
      seed: true,
      placement: true,
      simulationScore: true,
      user: { select: { username: true, displayName: true } },
    },
  });
  const jobCounts = await db.evaluationJob.groupBy({
    by: ['status'],
    where: { submission: { tournamentId: tournament.id } },
    _count: { _all: true },
  });

  console.log(
    JSON.stringify(
      {
        lifecycle: await getLifecycleState(tournament.id),
        tournament: finalState,
        stageRuns,
        leaderboard,
        placements,
        jobCounts,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
