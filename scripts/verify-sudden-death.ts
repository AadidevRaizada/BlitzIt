import './load-env';
import type { Prisma } from '../src/generated/prisma/client';
import { db } from '../src/server/db';
import {
  applyTransition,
  createTournament,
  decideMatch,
  getTournamentSummary,
  listBracketRounds,
  listDeadlockedMatches,
  progressTournament,
  registerCompetitor,
  startSuddenDeath,
  SUDDEN_DEATH_CHAIN,
  TIE_BREAK_CHAIN,
  type CompetitorResult,
} from '../src/server/modules/tournament';
import {
  addHiddenTest,
  createProblem,
  publishProblem,
} from '../src/server/modules/problem';
import { AppError } from '../src/lib/errors';

/**
 * Epic E6 — sudden death (D5.6 / D14) acceptance.
 *
 * Proves the DoD the roadmap set for E6: "full bracket runs to a champion in
 * fast-forward **including a forced tie -> sudden-death**".
 *
 * Run: npm run verify:sudden-death
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

async function checkRejects(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode?: string,
) {
  let rejected = false;
  let detail = '';
  try {
    await fn();
  } catch (error) {
    rejected = expectedCode
      ? error instanceof AppError && error.code === expectedCode
      : true;
    if (!rejected) {
      detail = `threw ${(error as Error).name}${
        error instanceof AppError ? ` (${error.code})` : ''
      }: ${(error as Error).message}`;
    }
  }
  check(label, rejected, detail || 'was accepted');
}

const TAG = `e6-${Date.now()}`;
const EMAIL_DOMAIN = 'e6-sudden-death.test';

async function cleanup() {
  const where = { tournament: { slug: { contains: TAG } } };
  await db.evaluation.deleteMany({ where });
  await db.evaluationJob.deleteMany({ where: { submission: where } });
  await db.submissionRevision.deleteMany({ where: { submission: where } });
  await db.submission.deleteMany({ where });
  await db.registration.deleteMany({ where });
  // Matches self-reference (bracket topology + sudden-death link).
  await db.match.updateMany({
    where,
    data: { nextMatchId: null, loserNextMatchId: null, resolvesMatchId: null },
  });
  await db.match.deleteMany({ where });
  await db.ranking.deleteMany({ where });
  await db.round.deleteMany({ where });
  await db.opsEvent.deleteMany({ where });
  await db.tournament.deleteMany({ where: { slug: { contains: TAG } } });
  await db.hiddenTest.deleteMany({
    where: { problem: { slug: { contains: TAG } } },
  });
  await db.problem.deleteMany({ where: { slug: { contains: TAG } } });
  await db.user.deleteMany({ where: { email: { contains: EMAIL_DOMAIN } } });
}

function competitor(
  userId: string,
  overrides: Partial<CompetitorResult> = {},
): CompetitorResult {
  return {
    userId,
    seed: null,
    submissionId: `sub-${userId}`,
    submittedAt: new Date('2026-07-26T10:00:00Z'),
    evaluationPending: false,
    overallScore: 50,
    functionalScore: 50,
    testsPassed: 5,
    performanceScore: 50,
    aiScore: 50,
    ...overrides,
  };
}

async function makeProblem(slug: string, title: string) {
  const admin = await db.user.findFirstOrThrow({
    where: { email: `admin@${EMAIL_DOMAIN}` },
  });
  const problem = await createProblem(
    {
      title,
      slug,
      statementMarkdown: 'Build something that works.',
      category: 'REST_API',
      contractSpec: {},
    },
    admin,
  );
  await addHiddenTest(
    problem.id,
    {
      name: 'root 200',
      kind: 'HTTP_ASSERTION',
      spec: { path: '/', expect: { status: 200 } },
    },
    admin,
  );
  await publishProblem(problem.id, admin);
  return problem;
}

/** Write a scored submission exactly as E4 + E2 would leave it. */
async function score(
  tournamentId: string,
  roundId: string,
  problemId: string,
  userId: string,
  scores: { overall: number; functional?: number; tests?: number; at?: Date },
) {
  const submission = await db.submission.create({
    data: {
      userId,
      tournamentId,
      roundId,
      problemId,
      category: 'REST_API',
      repoUrl: `https://github.com/blitzit/${TAG}`,
      deploymentUrl: `https://${userId}.${TAG}.example.com`,
      submittedAt: scores.at ?? new Date(),
      status: 'SCORED',
    },
  });
  await db.evaluation.create({
    data: {
      submissionId: submission.id,
      tournamentId,
      functionalScore: scores.functional ?? scores.overall,
      testsPassed: scores.tests ?? 5,
      testsTotal: 5,
      deploymentReachable: true,
      performanceScore: scores.overall,
      securityReliabilityScore: scores.overall,
      aiScore: 0,
      overallScore: scores.overall,
      weights: {
        functional: 0.6,
        performance: 0.15,
        securityReliability: 0.1,
        ai: 0,
      } as Prisma.InputJsonValue,
      profileName: 'deterministic',
    },
  });
  return submission;
}

// ───────────────────── 1. The D14 chain (pure) ─────────────────────

function pureChain() {
  console.log('\n── 1. Sudden-death win rule (pure, D14) ──');

  const options = {
    advanceHigherSeedOnDoubleNoShow: true,
    windowClosed: true,
    chain: SUDDEN_DEATH_CHAIN,
  };

  check(
    'D14 chain is exactly functional -> tests passed -> earliest submission',
    JSON.stringify(SUDDEN_DEATH_CHAIN.map((s) => s.reason)) ===
      JSON.stringify([
        'TIEBREAK_FUNCTIONAL',
        'TIEBREAK_TESTS',
        'TIEBREAK_TIME',
      ]),
    SUDDEN_DEATH_CHAIN.map((s) => s.reason).join(','),
  );
  check(
    'the D14 chain is SHORTER than the D5 chain',
    SUDDEN_DEATH_CHAIN.length === 3 && TIE_BREAK_CHAIN.length === 6,
  );

  check(
    'sudden death is decided on functional score alone',
    (() => {
      const outcome = decideMatch(
        competitor('a', { overallScore: 10, functionalScore: 90 }),
        competitor('b', { overallScore: 99, functionalScore: 80 }),
        options,
      );
      return (
        outcome.winnerId === 'a' && outcome.reason === 'TIEBREAK_FUNCTIONAL'
      );
    })(),
    'the higher OVERALL score must not win a sudden death',
  );

  check(
    'equal functional falls to tests passed',
    (() => {
      const outcome = decideMatch(
        competitor('a', { functionalScore: 80, testsPassed: 9 }),
        competitor('b', { functionalScore: 80, testsPassed: 8 }),
        options,
      );
      return outcome.winnerId === 'a' && outcome.reason === 'TIEBREAK_TESTS';
    })(),
  );

  check(
    'equal functional and tests falls to the earliest submission',
    (() => {
      const outcome = decideMatch(
        competitor('a', {
          functionalScore: 80,
          submittedAt: new Date('2026-07-26T10:00:00Z'),
        }),
        competitor('b', {
          functionalScore: 80,
          submittedAt: new Date('2026-07-26T10:05:00Z'),
        }),
        options,
      );
      return outcome.winnerId === 'a' && outcome.reason === 'TIEBREAK_TIME';
    })(),
  );

  check(
    'performance and AI are ignored in sudden death',
    decideMatch(
      competitor('a', { functionalScore: 80, performanceScore: 1, aiScore: 1 }),
      competitor('b', {
        functionalScore: 80,
        performanceScore: 99,
        aiScore: 99,
      }),
      options,
    ).kind === 'TIE',
    'identical functional + tests + time must tie regardless of perf/AI',
  );

  check(
    'the D5 chain still separates the same pair on performance',
    decideMatch(
      competitor('a', { functionalScore: 80, performanceScore: 1 }),
      competitor('b', { functionalScore: 80, performanceScore: 99 }),
      { advanceHigherSeedOnDoubleNoShow: true, windowClosed: true },
    ).winnerId === 'b',
  );
}

// ───────────────────── 2. The persisted path ─────────────────────

async function pipeline() {
  console.log('\n── 2. Sudden death end to end (database) ──');

  const admin = await db.user.create({
    data: {
      authUserId: `auth-${TAG}-admin`,
      email: `admin@${EMAIL_DOMAIN}`,
      username: `admin-${TAG}`,
      role: 'ADMIN',
      profile: { create: {} },
    },
  });
  const nonAdmin = await db.user.create({
    data: {
      authUserId: `auth-${TAG}-plain`,
      email: `plain@${EMAIL_DOMAIN}`,
      username: `plain-${TAG}`,
      profile: { create: {} },
    },
  });

  const players = [];
  for (let index = 0; index < 8; index++) {
    players.push(
      await db.user.create({
        data: {
          authUserId: `auth-${TAG}-p${index}`,
          email: `p${index}@${EMAIL_DOMAIN}`,
          username: `p${index}-${TAG}`,
          profile: { create: {} },
        },
      }),
    );
  }

  const qualifier = await makeProblem(`p-${TAG}-main`, 'E6 main challenge');
  const decider = await makeProblem(`p-${TAG}-sd`, 'E6 sudden-death challenge');

  const tournament = await createTournament(
    {
      name: 'E6 Sudden Death',
      slug: `t-${TAG}`,
      bracketSize: 8,
      thirdPlaceEnabled: false,
      minRegistrations: 8,
      maxRegistrations: 8,
    },
    { actorId: admin.id },
  );

  await applyTransition(tournament.id, 'PUBLISH', { actorId: admin.id });
  await applyTransition(tournament.id, 'OPEN_REGISTRATION', {
    actorId: admin.id,
  });
  await db.tournament.update({
    where: { id: tournament.id },
    data: {
      registrationOpensAt: new Date(Date.now() - 60_000),
      registrationClosesAt: new Date(Date.now() + 3_600_000),
    },
  });
  for (const player of players) {
    await registerCompetitor(tournament.id, player.id);
  }
  await applyTransition(tournament.id, 'CLOSE_REGISTRATION', {
    actorId: admin.id,
  });
  await applyTransition(tournament.id, 'START_SIMULATION', {
    actorId: admin.id,
  });

  // Distinct simulation scores so seeding is unambiguous.
  const simRounds = await db.round.findMany({
    where: { tournamentId: tournament.id, type: 'SIMULATION' },
    orderBy: { sequence: 'asc' },
  });
  for (const round of simRounds) {
    await db.round.update({
      where: { id: round.id },
      data: { problemId: qualifier.id, status: 'OPEN' },
    });
    for (const [index, player] of players.entries()) {
      await score(tournament.id, round.id, qualifier.id, player.id, {
        overall: 100 - index,
      });
    }
    await db.round.update({
      where: { id: round.id },
      data: { status: 'COMPLETED' },
    });
  }

  await applyTransition(tournament.id, 'CLOSE_SIMULATION', {
    actorId: admin.id,
  });
  await applyTransition(tournament.id, 'GENERATE_BRACKET', {
    actorId: admin.id,
  });
  await applyTransition(tournament.id, 'START_KNOCKOUT', { actorId: admin.id });

  const qfRound = await db.round.findFirstOrThrow({
    where: { tournamentId: tournament.id, stage: 'QF' },
  });
  await db.round.update({
    where: { id: qfRound.id },
    data: { problemId: qualifier.id },
  });

  const qfMatches = await db.match.findMany({
    where: { roundId: qfRound.id },
    orderBy: { bracketPosition: 'asc' },
  });

  // Force match 0 into a genuine deadlock: identical on EVERY D5 dimension,
  // including submission time. Every other match gets a clean result.
  const tiedAt = new Date();
  for (const match of qfMatches) {
    const a = match.competitorAId!;
    const b = match.competitorBId!;
    if (match.bracketPosition === 0) {
      for (const userId of [a, b]) {
        await score(tournament.id, qfRound.id, qualifier.id, userId, {
          overall: 75,
          functional: 75,
          tests: 4,
          at: tiedAt,
        });
      }
    } else {
      await score(tournament.id, qfRound.id, qualifier.id, a, {
        overall: 100 - match.seedA!,
      });
      await score(tournament.id, qfRound.id, qualifier.id, b, {
        overall: 100 - match.seedB!,
      });
    }
  }

  await db.round.update({
    where: { id: qfRound.id },
    data: { deadlineAt: new Date(Date.now() - 1000) },
  });
  const firstPass = await progressTournament(tournament.id);

  const tiedMatch = await db.match.findFirstOrThrow({
    where: { roundId: qfRound.id, bracketPosition: 0 },
  });
  check(
    'a match identical on every D5 dimension is flagged as a tie',
    tiedMatch.tieUnresolved && tiedMatch.status !== 'DECIDED',
    `tieUnresolved=${tiedMatch.tieUnresolved} status=${tiedMatch.status}`,
  );
  check(
    'the progress pass reports the unresolved tie',
    firstPass.matchesTied === 1,
    `${firstPass.matchesTied}`,
  );
  check(
    'the deadlocked round cannot advance',
    (await getTournamentSummary(tournament.id)).currentStage === 'QF',
  );
  check(
    'the deadlock is listed for the operator',
    (await listDeadlockedMatches(tournament.id)).some(
      (match) => match.id === tiedMatch.id,
    ),
  );

  // ---- Guards ----
  await checkRejects(
    'a non-admin cannot start sudden death',
    () => startSuddenDeath(tiedMatch.id, decider.id, nonAdmin),
    'FORBIDDEN',
  );
  await checkRejects(
    'sudden death is refused on a match that is not deadlocked',
    () =>
      startSuddenDeath(
        qfMatches.find((m) => m.bracketPosition === 1)!.id,
        decider.id,
        admin,
      ),
    'CONFLICT',
  );
  await checkRejects(
    'D14: sudden death is refused when it reuses the tied round’s challenge',
    () => startSuddenDeath(tiedMatch.id, qualifier.id, admin),
    'CONFLICT',
  );
  {
    const draft = await createProblem(
      {
        title: 'Unpublished decider',
        slug: `p-${TAG}-draft`,
        statementMarkdown: 'Not published yet, so not usable.',
        category: 'REST_API',
      },
      admin,
    );
    await checkRejects(
      'an unpublished challenge cannot be used for sudden death',
      () => startSuddenDeath(tiedMatch.id, draft.id, admin),
      'CONFLICT',
    );
  }

  // ---- Start it ----
  const started = await startSuddenDeath(tiedMatch.id, decider.id, admin);
  check(
    'sudden death creates a SUDDEN_DEATH round',
    started.round.stage === 'SUDDEN_DEATH',
  );
  check(
    'the round is opened with a window',
    started.round.status === 'OPEN' && started.round.deadlineAt !== null,
  );
  check(
    'D14: the sudden-death round lasts 10 minutes by default',
    started.round.durationSeconds === 600,
    `${started.round.durationSeconds}s`,
  );
  check(
    'the sudden-death match points back at the deadlocked match',
    started.suddenDeathMatch.resolvesMatchId === tiedMatch.id,
  );
  check(
    'both deadlocked competitors carry over',
    started.suddenDeathMatch.competitorAId === tiedMatch.competitorAId &&
      started.suddenDeathMatch.competitorBId === tiedMatch.competitorBId,
  );
  check(
    'the sudden-death match owns no onward topology',
    started.suddenDeathMatch.nextMatchId === null,
    'the winner is written onto the ORIGINAL match, which owns the links',
  );
  check(
    'the deadlock disappears from the operator list once started',
    (await listDeadlockedMatches(tournament.id)).length === 0,
  );

  await checkRejects(
    'a second sudden death cannot be opened for the same match',
    () => startSuddenDeath(tiedMatch.id, decider.id, admin),
    'CONFLICT',
  );

  // ---- Resolve it ----
  // Deliberately give the LOSER the better overall score: D14 says functional
  // alone decides, so the higher overall must not win.
  const sdMatch = started.suddenDeathMatch;
  await score(
    tournament.id,
    started.round.id,
    decider.id,
    sdMatch.competitorAId!,
    {
      overall: 20,
      functional: 95,
    },
  );
  await score(
    tournament.id,
    started.round.id,
    decider.id,
    sdMatch.competitorBId!,
    {
      overall: 99,
      functional: 60,
    },
  );
  await db.round.update({
    where: { id: started.round.id },
    data: { deadlineAt: new Date(Date.now() - 1000) },
  });

  const resolvingPass = await progressTournament(tournament.id);
  check(
    'the progress pass reports the sudden death as resolved',
    resolvingPass.suddenDeathResolved === 1,
    `${resolvingPass.suddenDeathResolved}`,
  );

  const settled = await db.match.findUniqueOrThrow({
    where: { id: tiedMatch.id },
  });
  check('the deadlocked match is now DECIDED', settled.status === 'DECIDED');
  check(
    'it records winReason = SUDDEN_DEATH',
    settled.winReason === 'SUDDEN_DEATH',
    `${settled.winReason}`,
  );
  check('the tie flag is cleared', settled.tieUnresolved === false);
  check(
    'the winner is the higher FUNCTIONAL score, not the higher overall',
    settled.winnerId === sdMatch.competitorAId,
    `winner=${settled.winnerId} expected=${sdMatch.competitorAId}`,
  );

  // ---- The bracket keeps moving ----
  check(
    'the QF round completed once the tie was settled',
    (await db.round.findUniqueOrThrow({ where: { id: qfRound.id } })).status ===
      'COMPLETED',
  );
  const afterStage = await getTournamentSummary(tournament.id);
  check(
    'the tournament advanced past the deadlocked stage',
    afterStage.currentStage === 'SF',
    `${afterStage.currentStage}`,
  );

  const sfMatches = await db.match.findMany({
    where: { round: { tournamentId: tournament.id, stage: 'SF' } },
    orderBy: { bracketPosition: 'asc' },
  });
  check(
    'the sudden-death winner was propagated into the semi-finals',
    sfMatches.some(
      (match) =>
        match.competitorAId === settled.winnerId ||
        match.competitorBId === settled.winnerId,
    ),
  );
  check(
    'the sudden-death LOSER did not advance',
    !sfMatches.some(
      (match) =>
        match.competitorAId === settled.loserId ||
        match.competitorBId === settled.loserId,
    ),
  );

  // ---- Elimination is recorded at the ORIGINAL stage ----
  const loserRanking = await db.ranking.findFirstOrThrow({
    where: { tournamentId: tournament.id, userId: settled.loserId! },
  });
  check(
    'the sudden-death loser is eliminated at QF, not at SUDDEN_DEATH',
    loserRanking.eliminatedAtStage === 'QF',
    `${loserRanking.eliminatedAtStage}`,
  );

  // ---- Run to a champion ----
  const remainingProblem = qualifier.id;
  for (let guard = 0; guard < 8; guard++) {
    const current = await db.tournament.findUniqueOrThrow({
      where: { id: tournament.id },
    });
    if (current.status !== 'LIVE' || !current.currentStage) break;

    const round = await db.round.findFirstOrThrow({
      where: { tournamentId: tournament.id, stage: current.currentStage },
    });
    await db.round.update({
      where: { id: round.id },
      data: { problemId: remainingProblem },
    });
    const open = await db.match.findMany({
      where: { roundId: round.id, status: { not: 'DECIDED' } },
    });
    for (const match of open) {
      for (const [userId, seed] of [
        [match.competitorAId, match.seedA],
        [match.competitorBId, match.seedB],
      ] as const) {
        if (!userId || seed === null) continue;
        const already = await db.submission.findUnique({
          where: { userId_roundId: { userId, roundId: round.id } },
        });
        if (already) continue;
        await score(tournament.id, round.id, remainingProblem, userId, {
          overall: 100 - seed,
        });
      }
    }
    await db.round.update({
      where: { id: round.id },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    });
    const pass = await progressTournament(tournament.id);
    if (pass.transitions.length === 0 && pass.matchesDecided === 0) break;
  }

  const final = await getTournamentSummary(tournament.id);
  check(
    'DoD: the bracket ran to a champion through a sudden death',
    final.status === 'COMPLETED',
    `status=${final.status} stage=${final.currentStage}`,
  );
  const champion = await db.ranking.findFirstOrThrow({
    where: { tournamentId: tournament.id, placement: 1 },
  });
  check('a champion was crowned', Boolean(champion.userId));
  check(
    'placement bands were not corrupted by the SUDDEN_DEATH round',
    (await db.ranking.count({
      where: { tournamentId: tournament.id, placement: { not: null } },
    })) >= 4,
  );

  // ---- The bracket read model shows it ----
  const bracket = await listBracketRounds(tournament.id);
  check(
    'the bracket read model includes the sudden-death round',
    bracket.some((round) => round.stage === 'SUDDEN_DEATH'),
  );
  check(
    'the settled match reports its sudden-death reason to the UI',
    bracket
      .flatMap((round) => round.matches)
      .some((match) => match.winReason === 'SUDDEN_DEATH'),
  );
  check(
    'the bracket read model exposes competitor ids for path highlighting',
    bracket
      .flatMap((round) => round.matches)
      .some((match) => match.competitorAId !== null),
  );
}

async function main() {
  await cleanup();
  pureChain();
  await pipeline();
  await cleanup();

  console.log(
    failures === 0
      ? '\nSudden death verified.'
      : `\n${failures} check(s) FAILED.`,
  );
}

main()
  .catch(async (error) => {
    console.error('\nFAIL —', error);
    failures++;
    await cleanup().catch(() => {});
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(failures > 0 ? 1 : 0);
  });
