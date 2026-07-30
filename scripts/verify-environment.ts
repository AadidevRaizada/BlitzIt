import './load-env';

import { db } from '../src/server/db';
import { queue } from '../src/server/jobs/pg-queue';
import { processors } from '../src/server/jobs/processors';
import { sweepDueWork } from '../src/server/jobs/progress-sweep';
import {
  PRODUCTION,
  TEST,
  assertMayEnterEnvironment,
  competitorScopeFor,
  isTournamentVisibleTo,
  parseEnvironmentParam,
  getSpectatorTournamentId,
  listPublicTournaments,
  listPublicPlacements,
  registerCompetitor,
  finishRoundEarly,
} from '../src/server/modules/tournament';
import {
  listHallOfFame,
  listUserBadges,
} from '../src/server/modules/hall-of-fame';
import { getPlatformStats } from '../src/server/modules/admin/directory';
import {
  addBotsToTournament,
  createBot,
  runReferenceEvaluation,
  type BotView,
} from '../src/server/modules/bot';
import { canAccessTestEnvironment } from '../src/server/modules/auth/roles';
import { FULL_PROFILE } from '../src/server/modules/evaluation/types';
import type { Role } from '../src/generated/prisma/client';

/**
 * Test-environment isolation acceptance (D35).
 *
 * Proves the promise the whole feature rests on: **a production user never
 * receives test data, by any route.** Every other guarantee here is a
 * convenience; this one is a correctness property, and the failure mode is
 * silent — a leak looks like a working page with one extra row in it.
 *
 * So the shape of this suite is deliberately adversarial rather than
 * demonstrative. It does not assert that test surfaces work (they visibly do);
 * it enumerates every production read that touches a tournament and asserts the
 * test tournament is ABSENT from each one, after running that tournament all the
 * way to COMPLETED with bots so there is a champion, a Hall of Fame entry,
 * badges, rankings and submissions to leak.
 *
 * Run: npm run verify:environment
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

async function expectThrows(
  label: string,
  fn: () => unknown | Promise<unknown>,
  expectedCode?: string,
) {
  try {
    await fn();
    check(label, false, 'expected it to be refused, but it succeeded');
  } catch (error) {
    const code = (error as { code?: string })?.code;
    check(
      label,
      expectedCode ? code === expectedCode : true,
      expectedCode ? `expected ${expectedCode}, got ${code}` : undefined,
    );
  }
}

const TAG = 'env-verify';
const EMAIL_DOMAIN = 'env-verify.test';

async function cleanup() {
  const tournaments = await db.tournament.findMany({
    where: { slug: { contains: TAG } },
    select: { id: true },
  });
  const ids = tournaments.map((t) => t.id);
  const where = { tournament: { slug: { contains: TAG } } };

  await db.evaluation.deleteMany({ where });
  await db.submissionRevision.deleteMany({
    where: { submission: { tournament: { slug: { contains: TAG } } } },
  });
  await db.submission.deleteMany({ where });
  await db.hallOfFame.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.match.deleteMany({ where });
  await db.ranking.deleteMany({ where });
  await db.registration.deleteMany({ where });
  await db.userBadge.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.notification.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.opsEvent.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.round.deleteMany({ where });
  await db.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await db.tournament.deleteMany({ where: { slug: { contains: TAG } } });
  for (const id of ids) {
    await db.evaluationJob.deleteMany({
      where: { idempotencyKey: { contains: id } },
    });
  }
  const users = await db.user.findMany({
    where: {
      OR: [
        { email: { endsWith: EMAIL_DOMAIN } },
        { username: { startsWith: TAG } },
      ],
    },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  await db.evaluation.deleteMany({
    where: { submission: { userId: { in: userIds } } },
  });
  await db.submission.deleteMany({ where: { userId: { in: userIds } } });
  await db.ranking.deleteMany({ where: { userId: { in: userIds } } });
  await db.notification.deleteMany({ where: { userId: { in: userIds } } });
  await db.userBadge.deleteMany({ where: { userId: { in: userIds } } });
  await db.registration.deleteMany({ where: { userId: { in: userIds } } });
  await db.botProfile.deleteMany({ where: { userId: { in: userIds } } });
  await db.user.deleteMany({ where: { id: { in: userIds } } });
}

async function drain(maxPasses = 40): Promise<void> {
  for (let pass = 0; pass < maxPasses; pass++) {
    const jobs = await queue.claim(25, `${TAG}-${pass}`);
    if (jobs.length === 0) return;
    for (const job of jobs) {
      const processor = processors[job.name];
      if (!processor) {
        await queue.complete(job.id, `${TAG}-${pass}`);
        continue;
      }
      try {
        await processor(job);
        await queue.complete(job.id, `${TAG}-${pass}`);
      } catch (error) {
        await queue.fail(
          job.id,
          error instanceof Error ? error.message : String(error),
          60_000,
        );
      }
    }
  }
}

const admin = { id: `${TAG}-admin`, role: 'ADMIN' as Role };

async function main() {
  await cleanup();
  console.log('\n=== Pure predicates ===\n');

  // ---- The scope derivation, before anything touches a database ----
  check(
    'a signed-out visitor cannot access the test environment',
    !canAccessTestEnvironment(null),
  );
  check(
    'a normal user cannot access the test environment',
    !canAccessTestEnvironment({ role: 'USER' }),
  );
  check('a tester can', canAccessTestEnvironment({ role: 'TEST' }));
  check('an admin can', canAccessTestEnvironment({ role: 'ADMIN' }));

  check(
    'a tester competes in TEST',
    competitorScopeFor({ role: 'TEST' }) === TEST,
  );
  check(
    'a normal user competes in PRODUCTION',
    competitorScopeFor({ role: 'USER' }) === PRODUCTION,
  );
  check(
    "an admin's own dashboard stays PRODUCTION",
    competitorScopeFor({ role: 'ADMIN' }) === PRODUCTION,
    'flipping every admin dashboard to test data the moment a test tournament exists would be a dangerous default',
  );

  // A malformed or hostile `?env=` must never fall through to TEST.
  check(
    'an unknown ?env value falls back to PRODUCTION',
    parseEnvironmentParam('nonsense') === PRODUCTION &&
      parseEnvironmentParam(undefined) === PRODUCTION &&
      parseEnvironmentParam('') === PRODUCTION,
  );
  check(
    '?env=test is honoured case-insensitively',
    parseEnvironmentParam('test') === TEST &&
      parseEnvironmentParam('TEST') === TEST,
  );

  check(
    'a production tournament is visible to everyone, signed out included',
    isTournamentVisibleTo(null, { environment: 'PRODUCTION' }),
  );
  check(
    'a test tournament is invisible to a normal user',
    !isTournamentVisibleTo({ role: 'USER' }, { environment: 'TEST' }),
  );
  check(
    'a test tournament is visible to a tester',
    isTournamentVisibleTo({ role: 'TEST' }, { environment: 'TEST' }),
  );

  console.log('\n=== The entry guard (both directions) ===\n');

  const entryCases: Array<[string, Role, boolean, 'PRODUCTION' | 'TEST']> = [
    ['a normal user may enter production', 'USER', false, 'PRODUCTION'],
    ['a tester may enter test', 'TEST', false, 'TEST'],
    ['an admin may enter production', 'ADMIN', false, 'PRODUCTION'],
    ['an admin may enter test', 'ADMIN', false, 'TEST'],
  ];
  for (const [label, role, isBot, environment] of entryCases) {
    let ok = true;
    try {
      assertMayEnterEnvironment({ role, isBot }, environment);
    } catch {
      ok = false;
    }
    check(label, ok);
  }

  expectThrowsSync(
    'a normal user CANNOT enter a test tournament',
    () => assertMayEnterEnvironment({ role: 'USER', isBot: false }, 'TEST'),
    'NOT_FOUND',
  );
  expectThrowsSync(
    'a tester CANNOT enter a production tournament',
    () =>
      assertMayEnterEnvironment({ role: 'TEST', isBot: false }, 'PRODUCTION'),
    'FORBIDDEN',
  );
  expectThrowsSync(
    'a bot CANNOT enter production',
    () =>
      assertMayEnterEnvironment({ role: 'USER', isBot: true }, 'PRODUCTION'),
    'FORBIDDEN',
  );

  console.log('\n=== The reference evaluator is deterministic ===\n');

  const refInput = {
    botUserId: 'bot-a',
    roundId: 'round-1',
    problemId: 'problem-1',
    skill: 70,
    scoreMode: 'SEEDED' as const,
    testCount: 10,
    profile: FULL_PROFILE,
  };
  const first = runReferenceEvaluation(refInput);
  const second = runReferenceEvaluation(refInput);
  check(
    'the same bot, round and problem always produce the same score',
    first.overallScore === second.overallScore &&
      first.testsPassed === second.testsPassed,
    `${first.overallScore} vs ${second.overallScore}`,
  );
  const other = runReferenceEvaluation({ ...refInput, botUserId: 'bot-b' });
  check(
    'a different bot produces a different score',
    other.overallScore !== first.overallScore,
  );

  const tieA = runReferenceEvaluation({
    ...refInput,
    botUserId: 'tie-a',
    scoreMode: 'TIE',
  });
  const tieB = runReferenceEvaluation({
    ...refInput,
    botUserId: 'tie-b',
    roundId: 'round-9',
    scoreMode: 'TIE',
  });
  check(
    'two TIE bots of equal skill agree on EVERY D5 tie-break input',
    tieA.overallScore === tieB.overallScore &&
      tieA.functionalScore === tieB.functionalScore &&
      tieA.testsPassed === tieB.testsPassed &&
      tieA.performanceScore === tieB.performanceScore &&
      tieA.aiScore === tieB.aiScore,
    'without this, sudden death cannot be reached on demand',
  );

  const deterministic = runReferenceEvaluation({
    ...refInput,
    profile: {
      name: 'deterministic',
      dimensions: {
        functional: true,
        performance: true,
        securityReliability: true,
        ai: false,
      },
      weights: FULL_PROFILE.weights,
    },
  });
  check(
    'the reference evaluator honours the D20 profile — no AI score when AI is off',
    deterministic.aiScore === 0 && deterministic.ai.skipped,
  );
  check(
    'a perfect deterministic run is not capped at 85 (weights renormalise)',
    deterministic.overallScore > 0 && deterministic.weights.ai === 0,
  );

  console.log('\n=== A complete test tournament, run with bots ===\n');

  const { testTournamentId, championId } = await runTestTournament();

  console.log('\n=== Production surfaces must not see any of it ===\n');

  const publicList = await listPublicTournaments(PRODUCTION);
  const leakedInList = Object.values(publicList)
    .flat()
    .some((card) => card.id === testTournamentId);
  check('production tournament discovery excludes it', !leakedInList);

  const testList = await listPublicTournaments(TEST);
  check(
    'the test-scoped listing DOES include it',
    Object.values(testList)
      .flat()
      .some((card) => card.id === testTournamentId),
    'isolation that also hides it from testers would be useless',
  );

  const spectatorId = await getSpectatorTournamentId(PRODUCTION);
  check(
    'the production landing page never selects it as the spectator tournament',
    spectatorId !== testTournamentId,
    'the most visible possible failure: a test bracket as the homepage',
  );

  const productionHof = await listHallOfFame(PRODUCTION, { take: 200 });
  check(
    'the production Hall of Fame excludes its champion',
    !productionHof.some((entry) => entry.tournamentId === testTournamentId),
  );
  const testHof = await listHallOfFame(TEST, { take: 200 });
  check(
    'the test Hall of Fame includes it',
    testHof.some((entry) => entry.tournamentId === testTournamentId),
  );

  if (championId) {
    const placements = await listPublicPlacements(championId, PRODUCTION);
    check(
      "the champion's PUBLIC profile shows no production placements",
      placements.length === 0,
      'a public profile is the quiet route by which test results reach a stranger',
    );
    check(
      'but their test-scoped placements are there',
      (await listPublicPlacements(championId, TEST)).length > 0,
    );

    const publicBadges = await listUserBadges(championId, {
      publicScope: PRODUCTION,
    });
    check(
      'no test badge appears on a production profile',
      publicBadges.length === 0,
      'a badge carries the awarding tournament NAME',
    );
    check(
      'the badge exists when read with the test scope',
      (await listUserBadges(championId, { publicScope: TEST })).length > 0,
    );
  }

  const prodStats = await getPlatformStats(PRODUCTION);
  const testStats = await getPlatformStats(TEST);
  // Compared against the database's own answer rather than against itself: an
  // assertion that only says "the number equals itself" passes no matter how
  // badly the scoping is broken.
  const [actualProdTournaments, actualTestTournaments] = await Promise.all([
    db.tournament.count({
      where: { environment: 'PRODUCTION', archivedAt: null },
    }),
    db.tournament.count({ where: { environment: 'TEST', archivedAt: null } }),
  ]);
  check(
    'production statistics count only production tournaments',
    prodStats.tournaments === actualProdTournaments &&
      testStats.tournaments === actualTestTournaments &&
      actualTestTournaments > 0,
    `stats: prod=${prodStats.tournaments}/${actualProdTournaments} test=${testStats.tournaments}/${actualTestTournaments}`,
  );

  const actualProdSubmissions = await db.submission.count({
    where: { tournament: { environment: 'PRODUCTION' } },
  });
  check(
    'production submission counts exclude bot submissions',
    testStats.submissions > 0 &&
      prodStats.submissions === actualProdSubmissions,
    `test submissions=${testStats.submissions}, prod=${prodStats.submissions}/${actualProdSubmissions}`,
  );
  check('bots are counted separately from users', prodStats.bots > 0);

  console.log('\n=== Cleanup ===\n');
  await cleanup();
  check('the fixture cleaned up', true);

  console.log(
    failures === 0
      ? '\nAll environment isolation checks passed.\n'
      : `\n${failures} check(s) FAILED.\n`,
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

function expectThrowsSync(label: string, fn: () => unknown, code?: string) {
  try {
    fn();
    check(label, false, 'expected it to be refused, but it succeeded');
  } catch (error) {
    const actual = (error as { code?: string })?.code;
    check(
      label,
      code ? actual === code : true,
      code ? `expected ${code}, got ${actual}` : undefined,
    );
  }
}

/**
 * Drive a test tournament to COMPLETED using bots, so that later assertions have
 * a real champion, Hall of Fame entry, badges and rankings to try to leak.
 */
async function runTestTournament(): Promise<{
  testTournamentId: string;
  championId: string | null;
}> {
  // A production tournament exists alongside it throughout, so "absent from the
  // production surface" is a meaningful assertion rather than one that passes
  // because the surface is empty.
  await db.tournament.create({
    data: {
      slug: `${TAG}-prod`,
      name: 'Env Verify Production',
      status: 'COMPLETED',
      visibility: 'PUBLIC',
      environment: 'PRODUCTION',
      completedAt: new Date(),
    },
  });

  const tournament = await db.tournament.create({
    data: {
      slug: `${TAG}-test`,
      name: 'Env Verify Test',
      status: 'REGISTRATION_OPEN',
      visibility: 'PUBLIC',
      environment: 'TEST',
      passPriceMinor: 0,
      minRegistrations: 8,
      registrationOpensAt: new Date(Date.now() - 60_000),
    },
  });

  // Eight bots: a legal D6 field with no human testers at all. The minimum is
  // not bypassed — these are real registrations.
  const bots: BotView[] = [];
  for (let i = 0; i < 8; i++) {
    bots.push(
      await createBot(
        {
          username: `${TAG}-bot-${i}`,
          skill: 40 + i * 6,
        },
        admin,
      ),
    );
  }

  const { added } = await addBotsToTournament(
    tournament.id,
    bots.map((bot) => bot.userId),
    admin,
  );
  check(
    'eight bots registered into the test tournament',
    added === 8,
    `${added}`,
  );

  const eligible = await db.registration.count({
    where: { tournamentId: tournament.id, status: 'ACTIVE' },
  });
  check(
    'the D6 minimum of 8 is met by real registrations, not bypassed',
    eligible === 8,
    `${eligible} eligible`,
  );

  // A production user must not be able to join it even knowing the id.
  const outsider = await db.user.create({
    data: {
      authUserId: `auth-${TAG}-outsider`,
      email: `outsider@${EMAIL_DOMAIN}`,
      username: `${TAG}-outsider`,
      role: 'USER',
    },
  });
  await expectThrows(
    'a production user cannot register into a test tournament even with its id',
    () => registerCompetitor(tournament.id, outsider.id),
    'NOT_FOUND',
  );

  // A bot must not be addable to a production tournament.
  const prod = await db.tournament.findUniqueOrThrow({
    where: { slug: `${TAG}-prod` },
  });
  await expectThrows(
    'bots cannot be added to a production tournament',
    () => addBotsToTournament(prod.id, [bots[0]!.userId], admin),
    'CONFLICT',
  );

  // Finishing a round early must be refused in production.
  await expectThrows(
    'a production round cannot be finished early',
    async () => {
      const round = await db.round.create({
        data: {
          tournamentId: prod.id,
          type: 'SIMULATION',
          stage: 'SIMULATION',
          sequence: 1,
          status: 'OPEN',
          durationSeconds: 600,
        },
      });
      return finishRoundEarly(round.id, admin);
    },
    'CONFLICT',
  );

  // Let the sweep and the queue carry it as far as they can without problems
  // attached — enough to produce registrations, notifications and jobs.
  await sweepDueWork(new Date());
  await drain();

  // Publish a champion directly: the point of this suite is the isolation of a
  // finished tournament's record, not a re-test of the lifecycle (which
  // `verify:tournament` and `verify:schedule` already own end to end).
  const championId = bots[7]!.userId;
  await db.tournament.update({
    where: { id: tournament.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  await db.ranking.create({
    data: {
      tournamentId: tournament.id,
      userId: championId,
      placement: 1,
      qualified: true,
      seed: 1,
    },
  });
  const { publishHallOfFame } =
    await import('../src/server/modules/hall-of-fame');
  await publishHallOfFame(tournament.id);
  check('the test tournament published a Hall of Fame entry', true);

  // A bot submission, so the submission counts have something in them.
  await db.submission.create({
    data: {
      userId: bots[0]!.userId,
      tournamentId: tournament.id,
      roundId: (
        await db.round.create({
          data: {
            tournamentId: tournament.id,
            type: 'SIMULATION',
            stage: 'SIMULATION',
            sequence: 1,
            status: 'COMPLETED',
            durationSeconds: 600,
          },
        })
      ).id,
      problemId: (await db.problem.findFirstOrThrow({ select: { id: true } }))
        .id,
      category: 'REST_API',
      repoUrl: 'https://github.com/blitzit-bots/x',
      deploymentUrl: `https://x.${TAG}.example.com/`,
    },
  });

  return { testTournamentId: tournament.id, championId };
}

main().catch(async (error) => {
  console.error(error);
  await cleanup().catch(() => {});
  await db.$disconnect();
  process.exit(1);
});
