import './load-env';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import type { Prisma, RoundStage } from '../src/generated/prisma/client';
import { db } from '../src/server/db';
import {
  applyTransition,
  computeSeeding,
  configureTournament,
  createTournament,
  deleteTournament,
  getBracket,
  getLifecycleState,
  getRoundCompletion,
  getSubmissionWindow,
  isSubmissionWindowOpen,
  listTournaments,
  progressSimulation,
  progressTournament,
  registerCompetitor,
  updateTournament,
  updateTournamentSchedule,
  withdrawRegistration,
  InvalidTransitionError,
  openRound,
  closeRound,
} from '../src/server/modules/tournament';
import { AppError } from '../src/lib/errors';

/**
 * Epic E3 end-to-end acceptance — the DoD.
 *
 * Drives real tournaments through the real engine against a real database:
 * CRUD, every lifecycle transition, refusal of every invalid one, registration
 * limits, submission windows, seeding from persisted evaluations, bracket
 * generation with and without byes, automatic advancement, third place,
 * completion with placements, and recovery in a COLD PROCESS mid-bracket.
 *
 * Submissions and evaluations are written directly here: creating them is the
 * Submission module's job (E5) and scoring them is the Evaluation Engine's
 * (E2). E3's contract is that it works from whatever is persisted, which is
 * exactly what seeding them by hand proves.
 *
 * Requires DATABASE_URL + migrations. Run: npm run verify:tournament:e2e
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

/** Assert a call is rejected, and with the error we expect. */
async function checkRejects(
  label: string,
  fn: () => Promise<unknown>,
  expect: { code?: string; type?: 'invalid-transition' } = {},
) {
  let rejected = false;
  let detail = '';
  try {
    await fn();
  } catch (error) {
    rejected = true;
    if (expect.type === 'invalid-transition') {
      rejected = error instanceof InvalidTransitionError;
      if (!rejected)
        detail = `threw ${(error as Error).name}: ${(error as Error).message}`;
    } else if (expect.code) {
      rejected = error instanceof AppError && error.code === expect.code;
      if (!rejected)
        detail = `threw ${(error as Error).name}: ${(error as Error).message}`;
    }
  }
  check(label, rejected, detail || 'was accepted');
}

const TAG = `e3-${Date.now()}`;
const EMAIL_DOMAIN = 'e3-tournament.test';

async function cleanup() {
  await db.opsEvent.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.evaluation.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.evaluationJob.deleteMany({
    where: { idempotencyKey: { contains: TAG } },
  });
  await db.submission.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  // Matches self-reference, so break the links before deleting.
  await db.match.updateMany({
    where: { tournament: { slug: { contains: TAG } } },
    data: { nextMatchId: null, loserNextMatchId: null },
  });
  await db.match.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.ranking.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.round.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.registration.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.auditLog.deleteMany({ where: { entityType: 'TournamentE3Test' } });
  await db.tournament.deleteMany({ where: { slug: { contains: TAG } } });
  await db.hiddenTest.deleteMany({
    where: { problem: { slug: { contains: TAG } } },
  });
  await db.problem.deleteMany({ where: { slug: { contains: TAG } } });
  await db.user.deleteMany({ where: { email: { contains: EMAIL_DOMAIN } } });
}

/** Deterministic competitor pool, reused across the scenarios. */
async function createUsers(count: number, prefix: string) {
  const users = [];
  for (let index = 0; index < count; index++) {
    users.push(
      await db.user.create({
        data: {
          authUserId: `auth-${TAG}-${prefix}-${index}`,
          email: `${prefix}-${index}@${EMAIL_DOMAIN}`,
          username: `${prefix}-${index}-${TAG}`,
          displayName: `Competitor ${index}`,
          profile: { create: {} },
        },
      }),
    );
  }
  return users;
}

async function createProblem(prefix: string) {
  return db.problem.create({
    data: {
      title: 'E3 harness problem',
      slug: `p-${TAG}-${prefix}`,
      statementMarkdown: 'Build something.',
      category: 'REST_API',
      evaluationStrategy: 'REST_API',
      contractSpec: {},
      visibility: 'PUBLISHED',
    },
  });
}

interface ScoreShape {
  overall: number;
  functional?: number;
  testsPassed?: number;
  performance?: number;
  ai?: number;
  submittedAt?: Date;
}

/** Write a scored submission exactly as E5 + E2 would leave it. */
async function scoreSubmission(
  tournamentId: string,
  roundId: string,
  problemId: string,
  userId: string,
  score: ScoreShape,
) {
  const submission = await db.submission.create({
    data: {
      userId,
      tournamentId,
      roundId,
      problemId,
      category: 'REST_API',
      repoUrl: `https://github.com/blitzit/${TAG}`,
      // Distinct per competitor: (roundId, deploymentUrl) is unique, because
      // two entries sharing one deployment is exactly what D19 catches.
      deploymentUrl: `https://example.com/${userId}`,
      submittedAt: score.submittedAt ?? new Date(),
      status: 'SCORED',
    },
  });

  await db.evaluation.create({
    data: {
      submissionId: submission.id,
      tournamentId,
      functionalScore: score.functional ?? score.overall,
      testsPassed: score.testsPassed ?? 5,
      testsTotal: 5,
      deploymentReachable: true,
      performanceScore: score.performance ?? score.overall,
      securityReliabilityScore: score.overall,
      aiScore: score.ai ?? 0,
      overallScore: score.overall,
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

// ───────────────────────── Scenario 1: the full lifecycle ─────────────────────────

async function fullLifecycle() {
  console.log(
    '\n── Scenario 1: full lifecycle, 8-team bracket with third place ──',
  );

  const users = await createUsers(8, 's1');
  const problem = await createProblem('s1');

  // ---- CRUD ----
  const tournament = await createTournament(
    {
      slug: `t-${TAG}-s1`,
      name: 'E3 Full Lifecycle',
      bracketSize: 8,
      thirdPlaceEnabled: true,
      minRegistrations: 8,
      maxRegistrations: 8,
    },
    { actorId: null },
  );
  check('tournament created in DRAFT', tournament.status === 'DRAFT');
  check('bracket size persisted', tournament.bracketSize === 8);

  await checkRejects(
    'a duplicate slug is refused',
    () =>
      createTournament({
        slug: `t-${TAG}-s1`,
        name: 'Duplicate',
      }),
    { code: 'CONFLICT' },
  );

  const renamed = await updateTournament(tournament.id, {
    name: 'E3 Full Lifecycle (renamed)',
  });
  check(
    'tournament can be renamed while DRAFT',
    renamed.name.endsWith('(renamed)'),
  );

  await updateTournamentSchedule(tournament.id, {
    registrationOpensAt: new Date('2026-08-01T00:00:00Z'),
    registrationClosesAt: new Date('2026-08-03T00:00:00Z'),
    simulationOpensAt: new Date('2026-08-04T00:00:00Z'),
    simulationClosesAt: new Date('2026-08-04T02:00:00Z'),
    liveStartsAt: new Date('2026-08-05T00:00:00Z'),
  });
  const scheduled = await db.tournament.findUniqueOrThrow({
    where: { id: tournament.id },
  });
  check('UTC schedule persisted (D8)', scheduled.liveStartsAt !== null);

  await configureTournament(tournament.id, {
    roundDurations: { simulation: [60, 60, 60], stages: { FINAL: 300 } },
  });
  check(
    'per-tournament round durations persisted',
    (await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } }))
      .roundDurations !== null,
  );

  check(
    'the tournament is listable by status',
    (await listTournaments({ status: 'DRAFT' })).some(
      (t) => t.id === tournament.id,
    ),
  );

  // ---- Invalid transitions are refused against real state ----
  await checkRejects(
    'DRAFT cannot open registration directly',
    () => applyTransition(tournament.id, 'OPEN_REGISTRATION'),
    { type: 'invalid-transition' },
  );
  await checkRejects(
    'DRAFT cannot generate a bracket',
    () => applyTransition(tournament.id, 'GENERATE_BRACKET'),
    { type: 'invalid-transition' },
  );
  await checkRejects(
    'force does NOT let an illegal transition through',
    () => applyTransition(tournament.id, 'COMPLETE', { force: true }),
    { type: 'invalid-transition' },
  );

  // ---- PUBLISH ----
  const published = await applyTransition(tournament.id, 'PUBLISH', {
    runBy: 'admin',
  });
  check('DRAFT → PUBLISHED', published.to === 'PUBLISHED' && published.applied);

  const replay = await applyTransition(tournament.id, 'PUBLISH');
  check(
    'replaying a transition is idempotent (no second application)',
    replay.applied === false,
  );
  check(
    'the idempotent replay returns the recorded OpsEvent',
    replay.opsEventId === published.opsEventId,
    `${replay.opsEventId} vs ${published.opsEventId}`,
  );

  const opsEvents = await db.opsEvent.count({
    where: { tournamentId: tournament.id, type: 'PUBLISH' },
  });
  check(
    'exactly one OpsEvent exists for the replayed transition',
    opsEvents === 1,
  );

  // ---- Registration ----
  await applyTransition(tournament.id, 'OPEN_REGISTRATION');
  check(
    'PUBLISHED → REGISTRATION_OPEN',
    (await getLifecycleState(tournament.id)) === 'REGISTRATION_OPEN',
  );

  await checkRejects(
    'registration is refused before it opens',
    () => registerCompetitor(tournament.id, users[0]!.id),
    { code: 'CONFLICT' },
  );

  // Move the window to now so registration is genuinely open.
  await db.tournament.update({
    where: { id: tournament.id },
    data: {
      registrationOpensAt: new Date(Date.now() - 60_000),
      registrationClosesAt: new Date(Date.now() + 3_600_000),
    },
  });

  await checkRejects(
    'the minimum-registration guard blocks CLOSE_REGISTRATION',
    () => applyTransition(tournament.id, 'CLOSE_REGISTRATION'),
    { code: 'CONFLICT' },
  );

  for (const user of users) {
    await registerCompetitor(tournament.id, user.id);
  }
  check(
    'all 8 competitors registered',
    (await db.registration.count({
      where: { tournamentId: tournament.id, status: 'ACTIVE' },
    })) === 8,
  );
  check(
    'participantCount tracks registrations',
    (await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } }))
      .participantCount === 8,
  );

  await checkRejects(
    'registering twice is refused',
    () => registerCompetitor(tournament.id, users[0]!.id),
    { code: 'CONFLICT' },
  );

  // Capacity: maxRegistrations is 8 and 8 are in.
  const extra = await createUsers(1, 's1-extra');
  await checkRejects(
    'registration beyond the configured maximum is refused',
    () => registerCompetitor(tournament.id, extra[0]!.id),
    { code: 'CONFLICT' },
  );

  // Withdraw + re-register frees and re-takes the slot.
  await withdrawRegistration(tournament.id, users[7]!.id);
  check(
    'withdrawing frees a slot',
    (await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } }))
      .participantCount === 7,
  );
  await registerCompetitor(tournament.id, users[7]!.id);
  check(
    'a withdrawn competitor can re-register',
    (await db.registration.count({
      where: { tournamentId: tournament.id, status: 'ACTIVE' },
    })) === 8,
  );

  // REGRESSION (Codex): two concurrent re-registrations of the SAME withdrawn
  // entry could both read the REVOKED row, both increment the counter and both
  // write it ACTIVE — one competitor consuming two capacity slots. The entry is
  // now claimed with a conditional update, so exactly one caller wins.
  await withdrawRegistration(tournament.id, users[7]!.id);
  const countBeforeRace = (
    await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } })
  ).participantCount;
  const raceResults = await Promise.allSettled([
    registerCompetitor(tournament.id, users[7]!.id),
    registerCompetitor(tournament.id, users[7]!.id),
    registerCompetitor(tournament.id, users[7]!.id),
  ]);
  const fulfilled = raceResults.filter((r) => r.status === 'fulfilled').length;
  const countAfterRace = (
    await db.tournament.findUniqueOrThrow({ where: { id: tournament.id } })
  ).participantCount;
  check(
    'REGRESSION: concurrent re-registration succeeds exactly once',
    fulfilled === 1,
    `${fulfilled} of 3 succeeded`,
  );
  check(
    'REGRESSION: one re-registration consumes exactly one capacity slot',
    countAfterRace === countBeforeRace + 1,
    `${countBeforeRace} → ${countAfterRace}`,
  );
  check(
    'the participant count still matches the active registrations',
    countAfterRace ===
      (await db.registration.count({
        where: { tournamentId: tournament.id, status: 'ACTIVE' },
      })),
  );

  await applyTransition(tournament.id, 'CLOSE_REGISTRATION');
  check(
    'REGISTRATION_OPEN → REGISTRATION_CLOSED',
    (await getLifecycleState(tournament.id)) === 'REGISTRATION_CLOSED',
  );

  await checkRejects(
    'registration is refused once closed',
    () => registerCompetitor(tournament.id, extra[0]!.id),
    { code: 'CONFLICT' },
  );

  // ---- Simulation ----
  await applyTransition(tournament.id, 'START_SIMULATION');
  const simRounds = await db.round.findMany({
    where: { tournamentId: tournament.id, type: 'SIMULATION' },
    orderBy: { sequence: 'asc' },
  });
  check('three simulation rounds created (D13)', simRounds.length === 3);
  check(
    'configured simulation durations were used',
    simRounds.every((r) => r.durationSeconds === 60),
    simRounds.map((r) => r.durationSeconds).join(','),
  );
  check('the first simulation round is open', simRounds[0]!.status === 'OPEN');
  check(
    'later simulation rounds stay PENDING until started',
    simRounds[1]!.status === 'PENDING' && simRounds[2]!.status === 'PENDING',
  );

  // Submission windows are the tournament module's authority.
  const window = await getSubmissionWindow(simRounds[0]!.id);
  check('the open round reports an open submission window', window.isOpen);
  check(
    'a PENDING round reports a closed window',
    !(await getSubmissionWindow(simRounds[1]!.id)).isOpen,
  );
  check(
    'a window is closed once the deadline passes',
    !isSubmissionWindowOpen(
      {
        status: 'OPEN',
        opensAt: new Date(Date.now() - 120_000),
        deadlineAt: new Date(Date.now() - 60_000),
      },
      new Date(),
    ),
  );

  // REGRESSION (Codex): seconds after START_SIMULATION nobody has submitted
  // anything, so a guard that only counts outstanding evaluations passes
  // trivially — and would seed the entire tournament off an empty field.
  await checkRejects(
    'REGRESSION: CLOSE_SIMULATION is refused while the windows are still open',
    () => applyTransition(tournament.id, 'CLOSE_SIMULATION'),
    { code: 'CONFLICT' },
  );

  // REGRESSION (Codex): START_SIMULATION opens only round 1. Rounds 2 and 3
  // must be opened by the simulation driver, or D13's "sum of three rounds" is
  // unplayable — only the first round would ever accept a submission.
  for (const [roundIndex, round] of simRounds.entries()) {
    const live = await db.round.findUniqueOrThrow({ where: { id: round.id } });
    check(
      `simulation round ${roundIndex + 1} is open when its turn comes`,
      live.status === 'OPEN',
      `status=${live.status}`,
    );

    for (const [userIndex, user] of users.entries()) {
      await scoreSubmission(tournament.id, round.id, problem.id, user.id, {
        overall: 100 - userIndex - roundIndex * 0.1,
      });
    }

    // Expire the window, then let the driver seal it and open the next round.
    await db.round.update({
      where: { id: round.id },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    });
    const simProgress = await progressSimulation(tournament.id);
    check(
      `the driver sealed simulation round ${roundIndex + 1}`,
      simProgress.closed === 1,
      JSON.stringify(simProgress),
    );
    check(
      roundIndex < simRounds.length - 1
        ? `the driver opened simulation round ${roundIndex + 2}`
        : 'no round is opened after the last simulation round',
      simProgress.opened === (roundIndex < simRounds.length - 1 ? 1 : 0),
      JSON.stringify(simProgress),
    );
    check(
      `allComplete is ${roundIndex === simRounds.length - 1} after round ${roundIndex + 1}`,
      simProgress.allComplete === (roundIndex === simRounds.length - 1),
    );
  }

  check(
    'all three simulation rounds ended up COMPLETED',
    (await db.round.count({
      where: {
        tournamentId: tournament.id,
        type: 'SIMULATION',
        status: 'COMPLETED',
      },
    })) === 3,
  );

  // A still-judging submission must block seeding.
  const blocker = await db.submission.create({
    data: {
      userId: extra[0]!.id,
      tournamentId: tournament.id,
      roundId: simRounds[0]!.id,
      problemId: problem.id,
      category: 'REST_API',
      repoUrl: `https://github.com/blitzit/${TAG}-blocker`,
      deploymentUrl: 'https://example.com',
      status: 'JUDGING',
    },
  });
  await checkRejects(
    'CLOSE_SIMULATION is blocked while an evaluation is outstanding',
    () => applyTransition(tournament.id, 'CLOSE_SIMULATION'),
    { code: 'CONFLICT' },
  );
  await db.submission.delete({ where: { id: blocker.id } });

  // ---- Seeding ----
  await applyTransition(tournament.id, 'CLOSE_SIMULATION');
  check(
    'SIMULATION → SEEDING',
    (await getLifecycleState(tournament.id)) === 'SEEDING',
  );

  const rankings = await db.ranking.findMany({
    where: { tournamentId: tournament.id },
    orderBy: { seed: 'asc' },
  });
  check('a Ranking row exists per competitor', rankings.length === 8);
  check(
    'seeds are 1..8 with no gaps or repeats',
    rankings.map((r) => r.seed).join(',') === '1,2,3,4,5,6,7,8',
    rankings.map((r) => r.seed).join(','),
  );
  check(
    'seeding follows the summed simulation score (D13)',
    rankings[0]!.userId === users[0]!.id &&
      rankings[7]!.userId === users[7]!.id,
  );
  check(
    'simulationScore is the SUM of the three rounds, not the best',
    Math.abs(rankings[0]!.simulationScore - (100 + 99.9 + 99.8)) < 0.001,
    `${rankings[0]!.simulationScore}`,
  );
  check(
    'all 8 qualified',
    rankings.every((r) => r.qualified),
  );

  // ---- Bracket generation ----
  await checkRejects(
    'the knockout cannot start before the bracket exists',
    () => applyTransition(tournament.id, 'START_KNOCKOUT'),
    { type: 'invalid-transition' },
  );

  const generated = await applyTransition(tournament.id, 'GENERATE_BRACKET');
  check('SEEDING → BRACKET_GENERATED', generated.to === 'BRACKET_GENERATED');

  const bracket = await getBracket(tournament.id);
  check(
    'four knockout rounds created (QF, SF, THIRD_PLACE, FINAL)',
    bracket.map((r) => r.stage).join(',') === 'QF,SF,THIRD_PLACE,FINAL',
    bracket.map((r) => r.stage).join(','),
  );
  check(
    '8 matches created (7 elimination + 1 third place)',
    bracket.reduce((sum, r) => sum + r.matches.length, 0) === 8,
  );
  check(
    'no orphan rounds — every round has matches',
    bracket.every((r) => r.matches.length > 0),
  );
  check(
    'no duplicate participants in the first round',
    (() => {
      const qf = bracket.find((r) => r.stage === 'QF')!;
      const ids = qf.matches
        .flatMap((m) => [m.competitorAId, m.competitorBId])
        .filter(Boolean);
      return new Set(ids).size === ids.length && ids.length === 8;
    })(),
  );
  check(
    'the top seed faces the bottom seed (1 v 8)',
    (() => {
      const qf = bracket.find((r) => r.stage === 'QF')!;
      const first = qf.matches.find((m) => m.bracketPosition === 0)!;
      return first.seedA === 1 && first.seedB === 8;
    })(),
  );
  check(
    'the semi-finals route their losers to the third-place match',
    (() => {
      const sf = bracket.find((r) => r.stage === 'SF')!;
      const third = bracket.find((r) => r.stage === 'THIRD_PLACE')!;
      const thirdId = third.matches[0]!.id;
      return sf.matches.every((m) => m.loserNextMatchId === thirdId);
    })(),
  );
  check(
    'the final has no onward link',
    bracket.find((r) => r.stage === 'FINAL')!.matches[0]!.nextMatchId === null,
  );
  check(
    'the bracket size can no longer be changed',
    await (async () => {
      try {
        await configureTournament(tournament.id, { bracketSize: 16 });
        return false;
      } catch {
        return true;
      }
    })(),
  );

  // Generating again must not duplicate anything.
  const regenerated = await applyTransition(tournament.id, 'GENERATE_BRACKET');
  check(
    'regenerating the bracket is a no-op',
    regenerated.applied === false &&
      (await db.match.count({ where: { tournamentId: tournament.id } })) === 8,
  );

  // ---- Knockout ----
  await applyTransition(tournament.id, 'START_KNOCKOUT');
  check(
    'BRACKET_GENERATED → LIVE:QF (an 8-team bracket starts at the quarter-finals)',
    (await getLifecycleState(tournament.id)) === 'LIVE:QF',
  );

  const qfRound = await db.round.findFirstOrThrow({
    where: { tournamentId: tournament.id, stage: 'QF' },
  });
  check(
    'the QF round opened with a window',
    qfRound.status === 'OPEN' && qfRound.deadlineAt !== null,
  );

  await checkRejects(
    'the stage cannot advance while matches are undecided',
    () => applyTransition(tournament.id, 'ADVANCE_STAGE'),
    { code: 'CONFLICT' },
  );

  // Quarter-finals, with a deliberate tie-break and a deliberate walkover.
  const qfMatches = await db.match.findMany({
    where: { roundId: qfRound.id },
    orderBy: { bracketPosition: 'asc' },
  });

  for (const match of qfMatches) {
    const a = { id: match.competitorAId!, seed: match.seedA! };
    const b = { id: match.competitorBId!, seed: match.seedB! };

    if (match.bracketPosition === 0) {
      // Identical overall score: the functional tie-break must separate them.
      await scoreSubmission(tournament.id, qfRound.id, problem.id, a.id, {
        overall: 80,
        functional: 90,
      });
      await scoreSubmission(tournament.id, qfRound.id, problem.id, b.id, {
        overall: 80,
        functional: 70,
      });
    } else if (match.bracketPosition === 1) {
      // Walkover: only the better seed submits.
      await scoreSubmission(tournament.id, qfRound.id, problem.id, a.id, {
        overall: 60,
      });
    } else {
      await scoreSubmission(tournament.id, qfRound.id, problem.id, a.id, {
        overall: 100 - a.seed,
      });
      await scoreSubmission(tournament.id, qfRound.id, problem.id, b.id, {
        overall: 100 - b.seed,
      });
    }
  }

  // While the window is open, the walkover match must NOT be decided — the
  // absent competitor can still submit. (Regression: this once walked the whole
  // bracket over on seed order the moment the round opened.)
  const midWindow = await progressTournament(tournament.id);
  check(
    'an open window does not award the walkover yet',
    midWindow.transitions.length === 0 &&
      (
        await db.match.findFirstOrThrow({
          where: { roundId: qfRound.id, bracketPosition: 1 },
        })
      ).status !== 'DECIDED',
  );
  // CHANGED in E6 (Codex review): NOTHING is decided on scores until the window
  // closes. E4 lets a competitor replace their entry until the deadline, so
  // deciding a fully-scored match early silently voided the right to improve.
  check(
    'REGRESSION: even fully-scored matches wait for the window to close',
    (await db.match.count({
      where: { roundId: qfRound.id, status: 'DECIDED' },
    })) === 0,
    `${await db.match.count({ where: { roundId: qfRound.id, status: 'DECIDED' } })}`,
  );

  // Expire the window. The engine seals it itself — the deadline is enforced by
  // the same pull that advances the bracket, not by a separate timer.
  await db.round.update({
    where: { id: qfRound.id },
    data: { deadlineAt: new Date(Date.now() - 1000) },
  });

  const qfProgress = await progressTournament(tournament.id);
  check(
    'the quarter-finals were decided automatically once the window closed',
    qfProgress.matchesDecided === 4,
    `${qfProgress.matchesDecided}`,
  );
  check(
    'the round completing advanced the stage automatically',
    qfProgress.transitions.map((t) => t.transition).join(',') ===
      'ADVANCE_STAGE',
  );
  check(
    'LIVE:QF → LIVE:SF',
    (await getLifecycleState(tournament.id)) === 'LIVE:SF',
  );

  const decidedQf = await db.match.findMany({
    where: { roundId: qfRound.id },
    orderBy: { bracketPosition: 'asc' },
  });
  check(
    'the functional tie-break decided match 0 and recorded why',
    decidedQf[0]!.winReason === 'TIEBREAK_FUNCTIONAL',
    `${decidedQf[0]!.winReason}`,
  );
  check(
    'the no-show lost by walkover',
    decidedQf[1]!.winReason === 'WALKOVER' &&
      decidedQf[1]!.winnerId === decidedQf[1]!.competitorAId,
  );
  check(
    'every quarter-final is DECIDED with a winner',
    decidedQf.every((m) => m.status === 'DECIDED' && m.winnerId),
  );
  check(
    'the QF round is marked COMPLETED',
    (await db.round.findUniqueOrThrow({ where: { id: qfRound.id } })).status ===
      'COMPLETED',
  );

  const sfRound = await db.round.findFirstOrThrow({
    where: { tournamentId: tournament.id, stage: 'SF' },
  });
  check('the SF round opened automatically', sfRound.status === 'OPEN');

  const sfMatches = await db.match.findMany({
    where: { roundId: sfRound.id },
    orderBy: { bracketPosition: 'asc' },
  });
  check(
    'the quarter-final winners were propagated into the semi-finals',
    sfMatches.every((m) => m.competitorAId && m.competitorBId),
  );
  check(
    'seeds travelled with the competitors',
    sfMatches[0]!.seedA === 1 && sfMatches[0]!.seedB === 4,
    `${sfMatches[0]!.seedA} v ${sfMatches[0]!.seedB}`,
  );
  check(
    'eliminated competitors were marked out at the QF stage',
    (await db.ranking.count({
      where: { tournamentId: tournament.id, eliminatedAtStage: 'QF' },
    })) === 4,
  );

  // ---- Restart recovery: a COLD process finishes the semi-finals ----
  for (const match of sfMatches) {
    await scoreSubmission(
      tournament.id,
      sfRound.id,
      problem.id,
      match.competitorAId!,
      { overall: 100 - match.seedA! },
    );
    await scoreSubmission(
      tournament.id,
      sfRound.id,
      problem.id,
      match.competitorBId!,
      { overall: 100 - match.seedB! },
    );
  }

  // The SF round opened with a fresh window; expire it so the round can be
  // decided (scores alone are no longer enough).
  await db.round.update({
    where: { id: sfRound.id },
    data: { deadlineAt: new Date(Date.now() - 1000) },
  });

  const resumed = runInFreshProcess(tournament.id);
  check(
    'a cold process resumed the tournament from persisted state alone',
    resumed.before.state === 'LIVE:SF' && resumed.decided === 2,
    JSON.stringify(resumed),
  );
  check(
    'the cold process advanced the lifecycle (SF → THIRD_PLACE)',
    resumed.after.state === 'LIVE:THIRD_PLACE',
    resumed.after.state,
  );
  check(
    'the parent process sees the state the child committed',
    (await getLifecycleState(tournament.id)) === 'LIVE:THIRD_PLACE',
  );

  // ---- Third place ----
  const thirdRound = await db.round.findFirstOrThrow({
    where: { tournamentId: tournament.id, stage: 'THIRD_PLACE' },
  });
  const thirdMatch = await db.match.findFirstOrThrow({
    where: { roundId: thirdRound.id },
  });
  check(
    'the losing semi-finalists were routed into the third-place match',
    Boolean(thirdMatch.competitorAId && thirdMatch.competitorBId),
  );
  check(
    'the third-place match pairs seeds 3 and 4',
    [thirdMatch.seedA, thirdMatch.seedB].sort().join(',') === '3,4',
    `${thirdMatch.seedA},${thirdMatch.seedB}`,
  );

  await scoreSubmission(
    tournament.id,
    thirdRound.id,
    problem.id,
    thirdMatch.competitorAId!,
    { overall: 100 - thirdMatch.seedA! },
  );
  await scoreSubmission(
    tournament.id,
    thirdRound.id,
    problem.id,
    thirdMatch.competitorBId!,
    { overall: 100 - thirdMatch.seedB! },
  );

  await db.round.update({
    where: { id: thirdRound.id },
    data: { deadlineAt: new Date(Date.now() - 1000) },
  });
  await progressTournament(tournament.id);
  check(
    'LIVE:THIRD_PLACE → LIVE:FINAL',
    (await getLifecycleState(tournament.id)) === 'LIVE:FINAL',
  );

  // ---- Final ----
  const finalRound = await db.round.findFirstOrThrow({
    where: { tournamentId: tournament.id, stage: 'FINAL' },
  });
  const finalMatch = await db.match.findFirstOrThrow({
    where: { roundId: finalRound.id },
  });
  check(
    'the final pairs seeds 1 and 2',
    [finalMatch.seedA, finalMatch.seedB].sort().join(',') === '1,2',
    `${finalMatch.seedA},${finalMatch.seedB}`,
  );
  check(
    'the final round uses its configured duration (300s)',
    finalRound.durationSeconds === 300,
    `${finalRound.durationSeconds}`,
  );

  await scoreSubmission(
    tournament.id,
    finalRound.id,
    problem.id,
    finalMatch.competitorAId!,
    { overall: 100 - finalMatch.seedA! },
  );
  await scoreSubmission(
    tournament.id,
    finalRound.id,
    problem.id,
    finalMatch.competitorBId!,
    { overall: 100 - finalMatch.seedB! },
  );

  await db.round.update({
    where: { id: finalRound.id },
    data: { deadlineAt: new Date(Date.now() - 1000) },
  });
  const finalProgress = await progressTournament(tournament.id);
  check('the tournament completed automatically', finalProgress.completed);
  check(
    'LIVE:FINAL → COMPLETED',
    (await getLifecycleState(tournament.id)) === 'COMPLETED',
  );

  const completed = await db.tournament.findUniqueOrThrow({
    where: { id: tournament.id },
  });
  check('completedAt was stamped', completed.completedAt !== null);
  check(
    'currentStage was cleared on completion',
    completed.currentStage === null,
  );

  const placements = await db.ranking.findMany({
    where: { tournamentId: tournament.id, placement: { not: null } },
    orderBy: { placement: 'asc' },
  });
  check(
    'the champion is the top seed',
    placements[0]?.userId === users[0]!.id && placements[0]?.placement === 1,
  );
  check(
    'the runner-up is seed 2',
    placements[1]?.userId === users[1]!.id && placements[1]?.placement === 2,
  );
  check(
    'third and fourth come from the play-off',
    placements[2]?.userId === users[2]!.id &&
      placements[2]?.placement === 3 &&
      placements[3]?.userId === users[3]!.id &&
      placements[3]?.placement === 4,
    placements.map((p) => `${p.placement}`).join(','),
  );
  check(
    'quarter-final losers share the 5th-place band',
    placements.filter((p) => p.placement === 5).length === 4,
    placements.map((p) => p.placement).join(','),
  );

  // ---- Terminal ----
  await checkRejects(
    'a completed tournament cannot be transitioned again',
    () => applyTransition(tournament.id, 'CANCEL'),
    { type: 'invalid-transition' },
  );
  await checkRejects(
    'a completed tournament cannot be deleted',
    () => deleteTournament(tournament.id),
    { code: 'CONFLICT' },
  );

  check(
    'every transition left an audit entry',
    (await db.auditLog.count({
      where: {
        entityType: 'Tournament',
        entityId: tournament.id,
        action: { startsWith: 'tournament.transition.' },
      },
    })) >= 9,
  );
  check(
    'every applied transition left a DONE OpsEvent',
    (await db.opsEvent.count({
      where: { tournamentId: tournament.id, status: 'DONE' },
    })) >= 9,
  );
}

/**
 * Run the advancement in a genuinely separate `node` process — not a worker,
 * not a re-import. If any tournament state were held in memory, this child
 * would not be able to continue, which is precisely what makes it a real
 * restart-recovery test.
 */
function runInFreshProcess(tournamentId: string) {
  const output = execFileSync(
    process.execPath,
    [
      path.join('node_modules', 'tsx', 'dist', 'cli.mjs'),
      '--conditions=react-server',
      path.join('scripts', 'internal', 'resume-tournament.ts'),
      tournamentId,
    ],
    { encoding: 'utf8', cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const match = /__RESUME_RESULT__(.*)__RESUME_RESULT__/s.exec(output);
  if (!match?.[1]) {
    throw new Error(`resume helper produced no result:\n${output}`);
  }
  return JSON.parse(match[1]) as {
    before: { state: string };
    after: { state: string };
    decided: number;
    transitions: string[];
    completed: boolean;
  };
}

// ───────────────────────── Scenario 2: byes ─────────────────────────

async function byeBracket() {
  console.log('\n── Scenario 2: 16-slot bracket with 11 competitors (byes) ──');

  const users = await createUsers(11, 's2');
  const problem = await createProblem('s2');

  const tournament = await createTournament({
    slug: `t-${TAG}-s2`,
    name: 'E3 Bye Bracket',
    // Deliberately oversized: 11 competitors would auto-size to 8, so byes only
    // happen because the organizer asked for a 16.
    bracketSize: 16,
    thirdPlaceEnabled: false,
    minRegistrations: 8,
    maxRegistrations: 32,
  });

  await applyTransition(tournament.id, 'PUBLISH');
  await applyTransition(tournament.id, 'OPEN_REGISTRATION');
  for (const user of users) {
    await registerCompetitor(tournament.id, user.id);
  }
  await applyTransition(tournament.id, 'CLOSE_REGISTRATION');
  await applyTransition(tournament.id, 'START_SIMULATION');

  const simRounds = await db.round.findMany({
    where: { tournamentId: tournament.id, type: 'SIMULATION' },
    orderBy: { sequence: 'asc' },
  });
  for (const round of simRounds) {
    await openRound(db, round.id);
    for (const [index, user] of users.entries()) {
      await scoreSubmission(tournament.id, round.id, problem.id, user.id, {
        overall: 100 - index,
      });
    }
    await closeRound(db, round.id);
  }

  await applyTransition(tournament.id, 'CLOSE_SIMULATION');
  await applyTransition(tournament.id, 'GENERATE_BRACKET');

  const bracket = await getBracket(tournament.id);
  check(
    'no third-place round when it is disabled',
    !bracket.some((r) => r.stage === 'THIRD_PLACE'),
  );
  check(
    '15 matches for a 16-slot bracket without third place',
    bracket.reduce((sum, r) => sum + r.matches.length, 0) === 15,
  );

  const r16 = bracket.find((r) => r.stage === 'R16')!;
  const byes = r16.matches.filter(
    (m) => (m.competitorAId === null) !== (m.competitorBId === null),
  );
  check(
    '5 first-round byes for 11 competitors in 16 slots',
    byes.length === 5,
    `${byes.length}`,
  );
  check(
    'bye matches were decided immediately at generation',
    byes.every((m) => m.status === 'DECIDED' && m.winReason === 'BYE'),
  );

  const qf = bracket.find((r) => r.stage === 'QF')!;
  const filledQfSlots = qf.matches
    .flatMap((m) => [m.competitorAId, m.competitorBId])
    .filter(Boolean).length;
  check(
    'all 5 bye winners are already sitting in the quarter-finals',
    filledQfSlots === 5,
    `${filledQfSlots} filled slots`,
  );
  check(
    'a QF match fed by two byes is fully paired before R16 is played',
    qf.matches.some((m) => m.competitorAId && m.competitorBId),
  );
  check(
    'the top seed received a bye',
    (() => {
      const top = r16.matches.find((m) => m.seedA === 1);
      return top?.winReason === 'BYE' && top.competitorBId === null;
    })(),
  );
  check(
    'no competitor appears twice anywhere in the bracket',
    (() => {
      const ids = bracket
        .flatMap((r) => r.matches)
        .flatMap((m) => [m.competitorAId, m.competitorBId])
        .filter((id): id is string => Boolean(id));
      // A competitor legitimately appears once per round they reach, so count
      // per round instead of globally.
      return (
        bracket.every((round) => {
          const roundIds = round.matches
            .flatMap((m) => [m.competitorAId, m.competitorBId])
            .filter(Boolean);
          return new Set(roundIds).size === roundIds.length;
        }) && ids.length > 0
      );
    })(),
  );

  await applyTransition(tournament.id, 'START_KNOCKOUT');
  check(
    'a 16-slot bracket starts at R16',
    (await getLifecycleState(tournament.id)) === 'LIVE:R16',
  );

  const completion = await getRoundCompletion(tournament.id, 'R16');
  check(
    'the bye matches already count towards round completion',
    completion.decided === 5 && completion.total === 8,
    `${completion.decided}/${completion.total}`,
  );

  // Play the remaining rounds out mechanically: better seed always wins.
  await playToCompletion(tournament.id, problem.id);

  check(
    'the bye bracket ran to completion',
    (await getLifecycleState(tournament.id)) === 'COMPLETED',
  );
  const champion = await db.ranking.findFirstOrThrow({
    where: { tournamentId: tournament.id, placement: 1 },
  });
  check('the top seed won the bye bracket', champion.userId === users[0]!.id);
}

/** Score every open match by seed, then advance, until the tournament ends. */
async function playToCompletion(tournamentId: string, problemId: string) {
  for (let guard = 0; guard < 12; guard++) {
    const tournament = await db.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
    });
    if (tournament.status !== 'LIVE' || !tournament.currentStage) break;

    const round = await db.round.findFirstOrThrow({
      where: { tournamentId, stage: tournament.currentStage as RoundStage },
    });
    const matches = await db.match.findMany({
      where: { roundId: round.id, status: { not: 'DECIDED' } },
    });

    for (const match of matches) {
      for (const [id, seed] of [
        [match.competitorAId, match.seedA],
        [match.competitorBId, match.seedB],
      ] as const) {
        if (!id || seed === null) continue;
        const already = await db.submission.findUnique({
          where: { userId_roundId: { userId: id, roundId: round.id } },
        });
        if (already) continue;
        await scoreSubmission(tournamentId, round.id, problemId, id, {
          overall: 100 - seed,
        });
      }
    }

    // Expire the window: scores alone no longer decide a match.
    await db.round.update({
      where: { id: round.id },
      data: { deadlineAt: new Date(Date.now() - 1000) },
    });

    const progress = await progressTournament(tournamentId);
    if (progress.transitions.length === 0 && progress.matchesDecided === 0)
      break;
  }
}

// ───────────────────────── Scenario 3: cancellation ─────────────────────────

async function cancellation() {
  console.log('\n── Scenario 3: cancellation and the ops escape hatch ──');

  const users = await createUsers(3, 's3');
  const tournament = await createTournament({
    slug: `t-${TAG}-s3`,
    name: 'E3 Cancellation',
    minRegistrations: 8,
  });

  await applyTransition(tournament.id, 'PUBLISH');
  await applyTransition(tournament.id, 'OPEN_REGISTRATION');
  for (const user of users) {
    await registerCompetitor(tournament.id, user.id);
  }

  await checkRejects(
    'the minimum-registration guard holds with only 3 registrations',
    () => applyTransition(tournament.id, 'CLOSE_REGISTRATION'),
    { code: 'CONFLICT' },
  );

  const forced = await applyTransition(tournament.id, 'CLOSE_REGISTRATION', {
    force: true,
    runBy: 'admin',
  });
  check(
    'force bypasses a BUSINESS guard (the documented ops escape hatch)',
    forced.to === 'REGISTRATION_CLOSED',
  );

  const cancelled = await applyTransition(tournament.id, 'CANCEL', {
    reason: 'not enough competitors',
    runBy: 'admin',
  });
  check(
    'a tournament can be cancelled mid-lifecycle',
    cancelled.to === 'CANCELLED',
  );

  const row = await db.tournament.findUniqueOrThrow({
    where: { id: tournament.id },
  });
  check(
    'the cancellation reason was persisted',
    row.cancellationReason === 'not enough competitors',
  );
  check('cancelledAt was stamped', row.cancelledAt !== null);

  await checkRejects(
    'a cancelled tournament is terminal',
    () => applyTransition(tournament.id, 'START_SIMULATION'),
    { type: 'invalid-transition' },
  );

  // A DRAFT with no registrations may be deleted outright.
  const draft = await createTournament({
    slug: `t-${TAG}-s3-draft`,
    name: 'E3 Deletable Draft',
  });
  await deleteTournament(draft.id);
  check(
    'an empty DRAFT can be deleted',
    (await db.tournament.findUnique({ where: { id: draft.id } })) === null,
  );
}

// ───────────────────────── Scenario 4: transition jobs ─────────────────────────

async function transitionJob() {
  console.log(
    '\n── Scenario 4: lifecycle transitions through the job runner ──',
  );

  const { queue } = await import('../src/server/jobs/pg-queue');
  const { tournamentTransitionProcessor } =
    await import('../src/server/jobs/processors/tournament-transition');
  const { enqueueTournamentTransition } = await import('../src/server/jobs');

  const tournament = await createTournament({
    slug: `t-${TAG}-s4`,
    name: 'E3 Job-Driven',
  });

  const jobId = await enqueueTournamentTransition(tournament.id, 'PUBLISH', {
    fromState: 'DRAFT',
    runBy: 'cron',
  });
  const duplicate = await enqueueTournamentTransition(
    tournament.id,
    'PUBLISH',
    {
      fromState: 'DRAFT',
      runBy: 'cron',
    },
  );
  check(
    'a duplicate scheduled transition collapses to one job',
    jobId === duplicate,
  );

  const claimed = await queue.claim(1, 'e3-runner');
  check(
    'the transition job is claimable',
    claimed.length === 1 && claimed[0]?.name === 'tournamentTransition',
  );

  await tournamentTransitionProcessor(claimed[0]!);
  check(
    'the runner applied the transition',
    (await getLifecycleState(tournament.id)) === 'PUBLISHED',
  );

  // REGRESSION (Codex): ADVANCE_STAGE happens once per stage. If every stage
  // advance shared one job key, `PgQueue.enqueue`'s upsert would make each one
  // after the first a silent no-op and the tournament would stall at the first
  // knockout round. The key must be stage-scoped, and omitting the stage must
  // be a loud error rather than a silent collapse.
  let missingStageThrew = false;
  try {
    await enqueueTournamentTransition(tournament.id, 'ADVANCE_STAGE');
  } catch {
    missingStageThrew = true;
  }
  check(
    'REGRESSION: ADVANCE_STAGE without a fromState is refused, not silently collapsed',
    missingStageThrew,
  );

  const advanceQf = await enqueueTournamentTransition(
    tournament.id,
    'ADVANCE_STAGE',
    { fromState: 'LIVE:QF' },
  );
  const advanceSf = await enqueueTournamentTransition(
    tournament.id,
    'ADVANCE_STAGE',
    { fromState: 'LIVE:SF' },
  );
  const advanceQfAgain = await enqueueTournamentTransition(
    tournament.id,
    'ADVANCE_STAGE',
    { fromState: 'LIVE:QF' },
  );
  check(
    'REGRESSION: each stage advance gets its own job',
    advanceQf !== advanceSf,
    `${advanceQf} vs ${advanceSf}`,
  );
  check(
    'the same stage advance still collapses to one job',
    advanceQf === advanceQfAgain,
  );
  await db.evaluationJob.deleteMany({
    where: { id: { in: [advanceQf, advanceSf] } },
  });

  // The tournament has moved on; re-running must not fail the job.
  let threw = false;
  try {
    await tournamentTransitionProcessor({
      ...claimed[0]!,
      payload: { tournamentId: tournament.id, transition: 'PUBLISH' },
    });
  } catch {
    threw = true;
  }
  check(
    'replaying a now-illegal transition completes instead of burning retries',
    !threw,
  );

  await db.evaluationJob.deleteMany({ where: { id: { in: [jobId] } } });
  await applyTransition(tournament.id, 'CANCEL', { reason: 'test cleanup' });
}

// ───────────────── Scenario 5: seeding determinism & configured size ─────────────────

async function seedingRegressions() {
  console.log(
    '\n── Scenario 5: seeding determinism and configured bracket size ──',
  );

  const users = await createUsers(10, 's5');

  const tournament = await createTournament({
    slug: `t-${TAG}-s5`,
    name: 'E3 Seeding Regressions',
    minRegistrations: 8,
  });
  await applyTransition(tournament.id, 'PUBLISH');
  await applyTransition(tournament.id, 'OPEN_REGISTRATION');
  for (const user of users) {
    await registerCompetitor(tournament.id, user.id);
  }
  await applyTransition(tournament.id, 'CLOSE_REGISTRATION');
  await applyTransition(tournament.id, 'START_SIMULATION');

  // Nobody submits anything: every competitor ties on every aggregate D5 field.
  // This is the exact case where a non-deterministic input order would produce
  // a different seeding on each run.
  const simRounds = await db.round.findMany({
    where: { tournamentId: tournament.id, type: 'SIMULATION' },
    orderBy: { sequence: 'asc' },
  });
  for (const round of simRounds) {
    await db.round.update({
      where: { id: round.id },
      data: { status: 'COMPLETED' },
    });
  }

  const first = await computeSeeding(tournament.id);
  const firstOrder = first.seeds.map((s) => s.userId).join(',');

  // REGRESSION (Codex): re-seeding must reproduce the SAME order. Without an
  // explicit orderBy on the registration query, competitors who tie on every
  // field come back in whatever order the database chooses.
  let stable = true;
  for (let run = 0; run < 4; run++) {
    const again = await computeSeeding(tournament.id);
    if (again.seeds.map((s) => s.userId).join(',') !== firstOrder)
      stable = false;
  }
  check(
    'REGRESSION: seeding a fully-tied field is deterministic across runs',
    stable,
    firstOrder,
  );
  check(
    'a fully-tied field still seeds every competitor exactly once',
    new Set(first.seeds.map((s) => s.userId)).size === first.qualifiedCount,
  );
  check(
    'a fully-tied field falls back to registration order',
    firstOrder ===
      users
        .slice(0, first.qualifiedCount)
        .map((u) => u.id)
        .join(','),
    firstOrder,
  );

  // REGRESSION (Codex): with the tournament column null, the CONFIGURED bracket
  // size must still win. Auto-sizing 10 competitors would pick 8; an explicit
  // configured 16 must be honoured instead (leaving 6 byes).
  check(
    'auto-sizing picks 8 for a field of 10 when nothing is configured',
    first.bracketSize === 8,
    `${first.bracketSize}`,
  );

  await db.tournament.update({
    where: { id: tournament.id },
    data: { bracketSize: null, seededAt: null },
  });
  const configured = await computeSeeding(tournament.id, { bracketSize: 16 });
  check(
    'REGRESSION: an explicitly configured bracket size overrides auto-sizing',
    configured.bracketSize === 16 && configured.qualifiedCount === 10,
    `size=${configured.bracketSize} qualified=${configured.qualifiedCount}`,
  );

  await applyTransition(tournament.id, 'CANCEL', {
    reason: 'regression fixture',
  });
}

async function main() {
  await cleanup();
  await fullLifecycle();
  await byeBracket();
  await cancellation();
  await transitionJob();
  await seedingRegressions();
  await cleanup();

  console.log(
    failures === 0
      ? '\nTournament lifecycle E2E verified.'
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
