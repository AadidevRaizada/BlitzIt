import './load-env';
import type { Prisma } from '../src/generated/prisma/client';
import { db } from '../src/server/db';
import { enqueueEvaluation, queue, type JobName } from '../src/server/jobs';
import { evaluateProcessor } from '../src/server/jobs/processors/evaluate';
import { computeSeeding } from '../src/server/modules/tournament';

interface GithubRepo {
  html_url: string;
  full_name: string;
  owner: { login: string };
}

const RUN_TAG = `prod-bot-score-${new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, '')
  .slice(0, 14)}`;
const BOT_COUNT = Number(process.env.BOT_TOURNAMENT_BOTS ?? 8);
const DEPLOYMENT_BASE =
  process.env.BOT_TOURNAMENT_DEPLOYMENT_BASE ??
  'https://blitzit-production.up.railway.app/api/health';

const FALLBACK_REPOS: GithubRepo[] = [
  {
    html_url: 'https://github.com/vercel/next.js',
    full_name: 'vercel/next.js',
    owner: { login: 'vercel' },
  },
  {
    html_url: 'https://github.com/fastify/fastify',
    full_name: 'fastify/fastify',
    owner: { login: 'fastify' },
  },
  {
    html_url: 'https://github.com/honojs/hono',
    full_name: 'honojs/hono',
    owner: { login: 'honojs' },
  },
  {
    html_url: 'https://github.com/trpc/trpc',
    full_name: 'trpc/trpc',
    owner: { login: 'trpc' },
  },
  {
    html_url: 'https://github.com/nestjs/nest',
    full_name: 'nestjs/nest',
    owner: { login: 'nestjs' },
  },
  {
    html_url: 'https://github.com/expressjs/express',
    full_name: 'expressjs/express',
    owner: { login: 'expressjs' },
  },
  {
    html_url: 'https://github.com/remix-run/remix',
    full_name: 'remix-run/remix',
    owner: { login: 'remix-run' },
  },
  {
    html_url: 'https://github.com/redwoodjs/redwood',
    full_name: 'redwoodjs/redwood',
    owner: { login: 'redwoodjs' },
  },
];

async function fetchRepos(): Promise<GithubRepo[]> {
  const query = encodeURIComponent(
    'topic:api topic:web framework language:TypeScript stars:>500',
  );
  const page = 1 + Math.floor(Math.random() * 3);
  const url = `https://api.github.com/search/repositories?q=${query}&sort=updated&order=desc&per_page=20&page=${page}`;

  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'blitzit-production-bot-smoke',
      },
    });
    if (!response.ok)
      throw new Error(`GitHub search returned ${response.status}`);
    const body = (await response.json()) as { items?: GithubRepo[] };
    const repos = (body.items ?? []).filter((repo) =>
      /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(repo.html_url),
    );
    if (repos.length >= BOT_COUNT) return shuffle(repos).slice(0, BOT_COUNT);
  } catch (error) {
    console.warn(
      `GitHub search failed, using fallback repos: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return shuffle(FALLBACK_REPOS).slice(0, BOT_COUNT);
}

function shuffle<T>(items: readonly T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

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

async function main() {
  const repos = await fetchRepos();
  if (repos.length < BOT_COUNT) {
    throw new Error(`expected ${BOT_COUNT} repos, got ${repos.length}`);
  }

  const tournament = await db.tournament.create({
    data: {
      slug: RUN_TAG,
      name: `Production Bot Scoring Smoke ${RUN_TAG}`,
      description:
        'Unlisted production scoring smoke run with bot competitors and random GitHub repositories.',
      visibility: 'UNLISTED',
      status: 'SIMULATION',
      passPriceMinor: 0,
      minRegistrations: BOT_COUNT,
      maxRegistrations: BOT_COUNT,
      bracketSize: BOT_COUNT,
      registrationOpensAt: new Date(Date.now() - 10 * 60_000),
      registrationClosesAt: new Date(Date.now() - 5 * 60_000),
      simulationOpensAt: new Date(Date.now() - 60_000),
      simulationClosesAt: new Date(Date.now() + 30 * 60_000),
      evaluationProfiles: { stages: { SIMULATION: 'full' } },
    },
  });

  const problem = await db.problem.create({
    data: {
      title: `Production Bot REST Smoke ${RUN_TAG}`,
      slug: `problem-${RUN_TAG}`,
      statementMarkdown:
        'Bot-only smoke problem that checks a public HTTPS health endpoint.',
      category: 'REST_API',
      evaluationStrategy: 'REST_API',
      contractSpec: {
        healthPath: '',
        performanceSamples: 3,
      } as Prisma.InputJsonValue,
      visibility: 'PUBLISHED',
      hiddenTests: {
        create: [
          {
            sequence: 1,
            name: 'submitted health URL returns 200',
            kind: 'HTTP_ASSERTION',
            spec: { path: '', expect: { status: 200 } },
            weight: 3,
            timeoutMs: 10_000,
          },
          {
            sequence: 2,
            name: 'health response includes status field',
            kind: 'HTTP_ASSERTION',
            spec: { path: '', expect: { bodyContains: ['status'] } },
            weight: 1,
            timeoutMs: 10_000,
          },
        ],
      },
    },
  });

  const round = await db.round.create({
    data: {
      tournamentId: tournament.id,
      type: 'SIMULATION',
      stage: 'SIMULATION',
      sequence: 1,
      problemId: problem.id,
      status: 'OPEN',
      durationSeconds: 1800,
      opensAt: new Date(Date.now() - 60_000),
      deadlineAt: new Date(Date.now() + 30 * 60_000),
    },
  });

  const submissions = [];
  for (const [index, repo] of repos.entries()) {
    const bot = await db.user.create({
      data: {
        authUserId: `auth-${RUN_TAG}-bot-${index}`,
        email: `bot-${index}@${RUN_TAG}.blitzit.internal`,
        username: `${RUN_TAG}-bot-${index}`,
        displayName: `Bot ${index + 1} ${repo.full_name}`,
        profile: {
          create: {
            githubUsername: repo.owner.login,
            websiteUrl: repo.html_url,
          },
        },
      },
    });

    await db.registration.create({
      data: {
        userId: bot.id,
        tournamentId: tournament.id,
        status: 'ACTIVE',
      },
    });

    const deploymentUrl = `${DEPLOYMENT_BASE}?bot=${index}&run=${RUN_TAG}`;
    const submission = await db.submission.create({
      data: {
        userId: bot.id,
        tournamentId: tournament.id,
        roundId: round.id,
        problemId: problem.id,
        category: 'REST_API',
        repoUrl: repo.html_url,
        deploymentUrl,
        status: 'RECEIVED',
      },
    });

    await db.submissionRevision.create({
      data: {
        submissionId: submission.id,
        version: 1,
        repoUrl: repo.html_url,
        deploymentUrl,
      },
    });

    submissions.push({ bot, repo, submission });
  }

  const lockedBy = `prod-bot-smoke-${RUN_TAG}`;
  for (const entry of submissions) {
    const jobId = await enqueueEvaluation(entry.submission.id);
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

  await db.round.update({
    where: { id: round.id },
    data: { status: 'COMPLETED', deadlineAt: new Date() },
  });
  const seeding = await computeSeeding(tournament.id, {
    bracketSize: BOT_COUNT,
  });

  const rows = await db.submission.findMany({
    where: { tournamentId: tournament.id },
    orderBy: { createdAt: 'asc' },
    include: {
      user: true,
      evaluation: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        runTag: RUN_TAG,
        tournament: {
          id: tournament.id,
          slug: tournament.slug,
          status: tournament.status,
          visibility: tournament.visibility,
        },
        round: { id: round.id, status: 'COMPLETED' },
        submissions: rows.map((row) => ({
          bot: row.user.username,
          repoUrl: row.repoUrl,
          deploymentUrl: row.deploymentUrl,
          submissionStatus: row.status,
          profile: row.evaluation?.profileName ?? null,
          tests: row.evaluation
            ? `${row.evaluation.testsPassed}/${row.evaluation.testsTotal}`
            : null,
          functionalScore: row.evaluation?.functionalScore ?? null,
          performanceScore: row.evaluation?.performanceScore ?? null,
          securityReliabilityScore:
            row.evaluation?.securityReliabilityScore ?? null,
          aiScore: row.evaluation?.aiScore ?? null,
          overallScore: row.evaluation?.overallScore ?? null,
          llmProvider: row.evaluation?.llmProvider ?? null,
          modelId: row.evaluation?.modelId ?? null,
          repoSnapshot: row.evaluation?.repoTextSnapshot ?? null,
        })),
        seeding,
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
