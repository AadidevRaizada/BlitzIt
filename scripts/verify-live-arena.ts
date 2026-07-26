import './load-env';
import type { Prisma } from '../src/generated/prisma/client';
import { db } from '../src/server/db';
import {
  applyTransition,
  createTournament,
  getKnockoutArena,
  getLeaderboard,
  getLiveSnapshot,
  getMatchWindow,
  listMyLiveMatches,
  openRound,
  progressTournament,
  registerCompetitor,
  snapshotVersion,
  startSuddenDeath,
  computeCountdown,
  classifySubmissionTiming,
  clockSkewMs,
  deriveArenaState,
  formatDuration,
  isArenaActionable,
  mayRevealOpponentProgress,
  secondsUntil,
  serverNowFromClient,
  timerPhase,
  type ArenaStateInput,
  type LiveSnapshot,
} from '../src/server/modules/tournament';
import {
  addHiddenTest,
  createProblem,
  publishProblem,
} from '../src/server/modules/problem';
import {
  hasSubmission,
  submitSolution,
} from '../src/server/modules/submission';
import { evaluateFlag, envVarNameForFlag, FLAGS } from '../src/lib/flags';
import { AppError } from '../src/lib/errors';

/**
 * Epic E7 — live knockout arena acceptance.
 *
 * Covers E7.1 (server-authoritative timers, simultaneous reveal, per-match
 * windows), E7.2 (the arena read model, disconnect and late-submit rules,
 * judging past the timer), E7.3 (the live snapshot behind SSE and its polling
 * fallback) and E7.4 (the feature flag).
 *
 * Run: npm run verify:live-arena
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

const TAG = `e7-${Date.now()}`;
const EMAIL_DOMAIN = 'e7-live-arena.test';

async function cleanup() {
  const where = { tournament: { slug: { contains: TAG } } };
  await db.evaluation.deleteMany({ where });
  await db.evaluationJob.deleteMany({ where: { submission: where } });
  await db.submissionRevision.deleteMany({ where: { submission: where } });
  await db.submission.deleteMany({ where });
  await db.registration.deleteMany({ where });
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
  // E8 added notifications, badges and a Hall of Fame entry to anything that
  // runs a tournament. They reference `User`, so a suite that deletes its users
  // without clearing them first fails on a foreign key — and a `sendEmail` job
  // whose notification is gone would be claimed by an unrelated suite.
  await db.$executeRaw`DELETE FROM "EvaluationJob" WHERE "name" = 'sendEmail' AND ("payload"->>'notificationId') IN (SELECT "id" FROM "Notification" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE ${'%' + EMAIL_DOMAIN}))`;
  await db.notification.deleteMany({
    where: { user: { email: { contains: EMAIL_DOMAIN } } },
  });
  await db.userBadge.deleteMany({
    where: { user: { email: { contains: EMAIL_DOMAIN } } },
  });
  await db.hallOfFame.deleteMany({ where });
  await db.user.deleteMany({ where: { email: { contains: EMAIL_DOMAIN } } });
}

// ───────────────── 1. Server-authoritative timers (pure, E7.1) ─────────────

function pureTimers() {
  console.log('\n── 1. Timers (pure, E7.1) ──');

  const opensAt = new Date('2026-07-26T10:00:00.000Z');
  const deadlineAt = new Date('2026-07-26T10:30:00.000Z');
  const window = { opensAt, deadlineAt };

  check(
    'a window with no schedule is UNSCHEDULED',
    timerPhase({ opensAt: null, deadlineAt: null }, opensAt) === 'UNSCHEDULED',
  );
  check(
    'a half-scheduled window is UNSCHEDULED, not open',
    timerPhase({ opensAt, deadlineAt: null }, deadlineAt) === 'UNSCHEDULED',
  );
  check(
    'before opensAt the phase is BEFORE_OPEN',
    timerPhase(window, new Date('2026-07-26T09:59:59.999Z')) === 'BEFORE_OPEN',
  );
  check(
    'the opening instant itself is OPEN (inclusive)',
    timerPhase(window, opensAt) === 'OPEN',
  );
  check(
    'the deadline instant itself is still OPEN (inclusive)',
    timerPhase(window, deadlineAt) === 'OPEN',
  );
  check(
    'one millisecond past the deadline is CLOSED',
    timerPhase(window, new Date('2026-07-26T10:30:00.001Z')) === 'CLOSED',
  );

  check(
    'secondsUntil rounds up so a partial second still reads as remaining',
    secondsUntil(deadlineAt, new Date('2026-07-26T10:29:59.500Z')) === 1,
  );
  check(
    'secondsUntil never goes negative',
    secondsUntil(deadlineAt, new Date('2026-07-26T11:00:00Z')) === 0,
  );
  check('secondsUntil(null) is null', secondsUntil(null, opensAt) === null);

  const before = computeCountdown(window, new Date('2026-07-26T09:50:00Z'));
  check(
    'before the reveal the countdown targets opensAt',
    before.label === 'OPENS' &&
      before.targetAt === opensAt.toISOString() &&
      before.secondsRemaining === 600,
  );
  const during = computeCountdown(window, new Date('2026-07-26T10:20:00Z'));
  check(
    'during the round the countdown targets the deadline',
    during.label === 'DEADLINE' &&
      during.targetAt === deadlineAt.toISOString() &&
      during.secondsRemaining === 600,
  );
  const after = computeCountdown(window, new Date('2026-07-26T11:00:00Z'));
  check(
    'after the deadline the countdown reads zero and ENDED',
    after.label === 'ENDED' && after.secondsRemaining === 0,
  );

  check(
    'a submission inside the window is ON_TIME',
    classifySubmissionTiming(window, new Date('2026-07-26T10:15:00Z')) ===
      'ON_TIME',
  );
  check(
    'a submission on the deadline millisecond is ON_TIME',
    classifySubmissionTiming(window, deadlineAt) === 'ON_TIME',
  );
  check(
    'a submission past the deadline is LATE',
    classifySubmissionTiming(window, new Date('2026-07-26T10:30:01Z')) ===
      'LATE',
  );
  check(
    'a submission before the reveal is BEFORE_OPEN',
    classifySubmissionTiming(window, new Date('2026-07-26T09:00:00Z')) ===
      'BEFORE_OPEN',
  );
  check(
    'timing is UNKNOWN without a schedule',
    classifySubmissionTiming(
      { opensAt: null, deadlineAt: null },
      new Date(),
    ) === 'UNKNOWN',
  );

  // The whole point of the clock anchor: a competitor's wrong clock must not
  // change how much time they get.
  const serverNow = new Date('2026-07-26T10:00:00Z');
  const fastClient = new Date('2026-07-26T10:05:00Z'); // 5 minutes fast
  const skew = clockSkewMs(serverNow, fastClient);
  check(
    'clock skew is measured in the client-ahead direction',
    skew === 300_000,
  );
  check(
    'correcting a fast client clock recovers the server time',
    serverNowFromClient(fastClient, skew).getTime() === serverNow.getTime(),
  );
  check(
    'a client five minutes fast still sees the true time remaining',
    Math.floor(
      (deadlineAt.getTime() - serverNowFromClient(fastClient, skew).getTime()) /
        1000,
    ) === 1800,
  );
  const slowClient = new Date('2026-07-26T09:57:00Z');
  check(
    'a client three minutes slow also sees the true time remaining',
    Math.floor(
      (deadlineAt.getTime() -
        serverNowFromClient(
          slowClient,
          clockSkewMs(serverNow, slowClient),
        ).getTime()) /
        1000,
    ) === 1800,
  );

  check('formatDuration pads mm:ss', formatDuration(65) === '01:05');
  check('formatDuration grows to h:mm:ss', formatDuration(3661) === '1:01:01');
  check(
    'formatDuration clamps negatives to zero',
    formatDuration(-5) === '00:00',
  );
}

// ───────────────── 2. Arena state derivation (pure, E7.2) ─────────────────

function pureArenaState() {
  console.log('\n── 2. Arena state (pure, E7.2) ──');

  const base: ArenaStateInput = {
    phase: 'OPEN',
    matchStatus: 'LIVE',
    tieUnresolved: false,
    suddenDeathOpen: false,
    winnerId: null,
    viewerId: 'me',
  };

  check('an open window is LIVE', deriveArenaState(base) === 'LIVE');
  check(
    'before the reveal the arena is WAITING',
    deriveArenaState({ ...base, phase: 'BEFORE_OPEN' }) === 'WAITING',
  );
  check(
    'an unscheduled match is NOT_STARTED',
    deriveArenaState({ ...base, phase: 'UNSCHEDULED' }) === 'NOT_STARTED',
  );
  check(
    'a closed window with no decision is JUDGING — evaluation outlasting the timer is normal',
    deriveArenaState({ ...base, phase: 'CLOSED' }) === 'JUDGING',
  );
  check(
    'a deadlock outranks judging: it needs an operator, not more time',
    deriveArenaState({ ...base, phase: 'CLOSED', tieUnresolved: true }) ===
      'TIED',
  );
  check(
    'an open decider outranks the deadlock that produced it',
    deriveArenaState({
      ...base,
      phase: 'CLOSED',
      tieUnresolved: true,
      suddenDeathOpen: true,
    }) === 'SUDDEN_DEATH',
  );
  check(
    'a decided match reads as a result whatever its window says',
    deriveArenaState({
      ...base,
      phase: 'OPEN',
      matchStatus: 'DECIDED',
      winnerId: 'me',
    }) === 'WON',
  );
  check(
    'the loser sees LOST',
    deriveArenaState({
      ...base,
      matchStatus: 'DECIDED',
      winnerId: 'someone-else',
    }) === 'LOST',
  );
  check(
    'a decided match with no winner degrades to JUDGING rather than claiming a loss',
    deriveArenaState({ ...base, matchStatus: 'DECIDED', winnerId: null }) ===
      'JUDGING',
  );

  check(
    'only LIVE and SUDDEN_DEATH are actionable',
    isArenaActionable('LIVE') &&
      isArenaActionable('SUDDEN_DEATH') &&
      !isArenaActionable('WAITING') &&
      !isArenaActionable('JUDGING') &&
      !isArenaActionable('TIED') &&
      !isArenaActionable('WON') &&
      !isArenaActionable('LOST') &&
      !isArenaActionable('NOT_STARTED'),
  );
}

// ───────────────── 3. Feature flag (E7.4) ─────────────────

async function featureFlag() {
  console.log('\n── 3. Feature flag (E7.4) ──');

  const flag = FLAGS.LIVE_ARENA;
  const varName = envVarNameForFlag(flag);
  const original = process.env[varName];

  check(
    'the flag maps to a predictable env var name',
    varName === 'FEATURE_LIVE_ARENA',
    varName,
  );

  try {
    delete process.env[varName];
    const fallback = await evaluateFlag(flag, { id: 'u1', role: 'USER' });
    check(
      'with no override and no analytics the arena defaults ON',
      fallback.enabled && fallback.source === 'default',
      `${fallback.enabled} via ${fallback.source}`,
    );

    process.env[varName] = 'false';
    const off = await evaluateFlag(flag, { id: 'u1', role: 'USER' });
    check(
      'the env kill switch turns the arena off',
      !off.enabled && off.source === 'env',
    );

    const offForAdmin = await evaluateFlag(flag, { id: 'a1', role: 'ADMIN' });
    check(
      'the env kill switch beats the admin bypass — off means off for everyone',
      !offForAdmin.enabled && offForAdmin.source === 'env',
    );

    process.env[varName] = 'true';
    check(
      'the env override can force it on',
      (await evaluateFlag(flag, { id: 'u1', role: 'USER' })).enabled,
    );

    process.env[varName] = 'nonsense';
    const bogus = await evaluateFlag(flag, { id: 'u1', role: 'USER' });
    check(
      'an unparseable override is ignored rather than read as false',
      bogus.enabled && bogus.source !== 'env',
      bogus.source,
    );

    delete process.env[varName];
    const admin = await evaluateFlag(flag, { id: 'a1', role: 'ADMIN' });
    check(
      'admins are never gated out of a surface they must support',
      admin.enabled && admin.source === 'admin',
    );

    const anonymous = await evaluateFlag(flag, null);
    check(
      'an anonymous viewer resolves without throwing',
      typeof anonymous.enabled === 'boolean',
    );

    // Codex finding 1 (P1): the kill switch has to reach the TRANSPORT. The
    // live route is public and anonymous, so it evaluates the flag with no
    // viewer — which must still see the deployment-wide override.
    process.env[varName] = 'false';
    const transport = await evaluateFlag(flag, null);
    check(
      'REGRESSION: the anonymous evaluation the live route uses honours the kill switch',
      !transport.enabled && transport.source === 'env',
      `${transport.enabled} via ${transport.source}`,
    );
    delete process.env[varName];
    check(
      'REGRESSION: with the switch cleared the live transport is allowed again',
      (await evaluateFlag(flag, null)).enabled,
    );
  } finally {
    if (original === undefined) delete process.env[varName];
    else process.env[varName] = original;
  }
}

// ───────────────── 4. The persisted arena & live snapshot ─────────────────

async function makeProblem(slug: string, title: string) {
  const admin = await db.user.findFirstOrThrow({
    where: { email: `admin@${EMAIL_DOMAIN}` },
  });
  const problem = await createProblem(
    {
      title,
      slug,
      statementMarkdown: 'Build something that survives realistic usage.',
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

async function pipeline() {
  console.log('\n── 4. Arena and live snapshot (persisted) ──');

  const admin = await db.user.create({
    data: {
      authUserId: `auth-${TAG}-admin`,
      email: `admin@${EMAIL_DOMAIN}`,
      username: `admin-${TAG}`,
      role: 'ADMIN',
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
          city: index % 2 === 0 ? 'Pune' : 'Bengaluru',
          profile: { create: {} },
        },
      }),
    );
  }
  const outsider = await db.user.create({
    data: {
      authUserId: `auth-${TAG}-outsider`,
      email: `outsider@${EMAIL_DOMAIN}`,
      username: `outsider-${TAG}`,
      profile: { create: {} },
    },
  });

  const qualifier = await makeProblem(`p-${TAG}-main`, 'E7 main challenge');
  const decider = await makeProblem(`p-${TAG}-sd`, 'E7 decider');

  const tournament = await createTournament(
    {
      name: 'E7 Live Arena',
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

  // ── The leaderboard is public standings, ordered by placement then score ──
  const leaderboard = await getLeaderboard(tournament.id, { take: 8 });
  check(
    'the leaderboard returns the seeded field',
    leaderboard.length === 8,
    String(leaderboard.length),
  );
  check(
    'the leaderboard is ordered by simulation score, best first',
    leaderboard.every(
      (entry, index) =>
        index === 0 ||
        entry.simulationScore <= leaderboard[index - 1]!.simulationScore,
    ),
  );
  check(
    'the leaderboard carries only public identity — never an email',
    !JSON.stringify(leaderboard).includes(EMAIL_DOMAIN),
  );
  const bySeed = await getLeaderboard(tournament.id, { by: 'seed', take: 8 });
  check(
    'ordering by seed puts seed 1 first',
    bySeed[0]?.seed === 1,
    String(bySeed[0]?.seed),
  );

  // ── Before the knockout opens ──
  const beforeStart = await getLiveSnapshot(tournament.id);
  check(
    'a snapshot before the knockout reports BRACKET_GENERATED',
    beforeStart.status === 'BRACKET_GENERATED',
    beforeStart.status,
  );
  check(
    'the snapshot carries the participant count and prize pool for the spectator page',
    beforeStart.participantCount === 8 &&
      typeof beforeStart.prizePoolMinor === 'number',
  );

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
  const match0 = qfMatches[0]!;
  const playerA = match0.competitorAId!;
  const playerB = match0.competitorBId!;

  // ── E7.1: the reveal gate ──
  // START_KNOCKOUT opens the first round immediately, so the round is pushed
  // back to a future reveal to exercise the gate a scheduled round really has.
  const futureOpen = new Date(Date.now() + 3_600_000);
  await db.round.update({
    where: { id: qfRound.id },
    data: {
      opensAt: futureOpen,
      deadlineAt: new Date(futureOpen.getTime() + 2_400_000),
    },
  });

  const sealed = await getKnockoutArena(match0.id, playerA);
  check('the arena resolves for a competitor in the match', sealed !== null);
  check(
    'before opensAt the challenge is withheld even from a competitor in the match',
    sealed?.problem === null && sealed?.revealed === false,
  );
  check(
    'a scheduled but unopened round reads as WAITING, not LIVE',
    sealed?.state === 'WAITING',
    sealed?.state,
  );
  check(
    'a window that has not opened refuses submissions',
    sealed?.window.isOpen === false && sealed.window.phase === 'BEFORE_OPEN',
  );
  check(
    'the countdown before the reveal targets opensAt, not the deadline',
    sealed?.window.countdown.targetAt === futureOpen.toISOString(),
  );
  check(
    'a competitor who is not in the match gets nothing back',
    (await getKnockoutArena(match0.id, outsider.id)) === null,
  );

  const sealedSnapshot = await getLiveSnapshot(tournament.id);
  check(
    'the public snapshot withholds an unopened round’s challenge title',
    sealedSnapshot.currentRound?.problemTitle === null &&
      sealedSnapshot.bracket.every((round) => round.problem === null),
  );

  // ── E7.1: opening the round ──
  await db.round.update({
    where: { id: qfRound.id },
    data: { status: 'PENDING', opensAt: null, deadlineAt: null },
  });
  await openRound(db, qfRound.id);
  const live = await getKnockoutArena(match0.id, playerA);
  check(
    'once the round opens the challenge is revealed',
    live?.revealed === true && live.problem?.id === qualifier.id,
  );
  check('an open window makes the arena LIVE', live?.state === 'LIVE');
  check(
    'the arena carries a server clock anchor for the countdown',
    typeof live?.serverTime === 'string' &&
      !Number.isNaN(Date.parse(live.serverTime)),
  );
  check(
    'the countdown targets the persisted deadline, not a computed one',
    live?.window.countdown.targetAt === live?.window.deadlineAt?.toISOString(),
  );

  // ── E7.1: per-match windows are the round's window, identically ──
  const windows = await Promise.all(
    qfMatches.map((match) => getMatchWindow(match.id)),
  );
  check(
    'every match in a round shares one window — nobody gets more time on the same problem',
    windows.every(
      (window) =>
        window.opensAt?.getTime() === windows[0]!.opensAt?.getTime() &&
        window.deadlineAt?.getTime() === windows[0]!.deadlineAt?.getTime(),
    ),
  );
  check(
    'a match window is attributed to its own match',
    windows[0]!.matchId === qfMatches[0]!.id &&
      windows[1]!.matchId === qfMatches[1]!.id,
  );
  check(
    'the match window reports the round it derives from',
    windows[0]!.roundId === qfRound.id,
  );
  await checkRejects(
    'an unknown match has no window',
    () => getMatchWindow('00000000-0000-0000-0000-000000000000'),
    'NOT_FOUND',
  );

  // ── E7.2: opponent progress is withheld while the window is open ──
  const accepted = await submitSolution({
    userId: playerA,
    roundId: qfRound.id,
    repoUrl: `https://github.com/blitzit/${TAG}-a`,
    deploymentUrl: `https://a.${TAG}.example.com`,
  });
  check(
    'a competitor can submit inside the window',
    accepted.submission.userId === playerA && accepted.version === 1,
  );

  const duringRound = await getKnockoutArena(match0.id, playerB);
  check(
    'while the window is open an opponent’s progress stays sealed',
    duringRound?.mayRevealOpponentProgress === false,
    String(duringRound?.mayRevealOpponentProgress),
  );
  check(
    'the reveal rule is a pure function of the window phase',
    !mayRevealOpponentProgress('OPEN') &&
      mayRevealOpponentProgress('CLOSED') &&
      mayRevealOpponentProgress('BEFORE_OPEN'),
  );
  check(
    'the arena never carries the opponent’s entry itself, only whether it may be asked for',
    !Object.prototype.hasOwnProperty.call(duringRound, 'opponentSubmitted'),
  );
  check(
    'the arena names the opponent',
    duringRound?.opponent?.userId === playerA,
  );

  // ── E7.2: the arena entry point ──
  const myMatches = await listMyLiveMatches(playerA);
  check(
    'a competitor can find their live match without knowing a match id',
    myMatches.some((match) => match.matchId === match0.id),
  );
  check(
    'the entry point does not list matches a competitor is not in',
    (await listMyLiveMatches(outsider.id)).length === 0,
  );

  // ── E7.1 / E7.2: the deadline is enforced by the server, not the UI ──
  await db.round.update({
    where: { id: qfRound.id },
    data: { deadlineAt: new Date(Date.now() - 1000) },
  });
  await checkRejects(
    'a late submission is refused by the server whatever the client renders',
    () =>
      submitSolution({
        userId: playerB,
        roundId: qfRound.id,
        repoUrl: `https://github.com/blitzit/${TAG}-b`,
        deploymentUrl: `https://b.${TAG}.example.com`,
      }),
    'WINDOW_CLOSED',
  );

  const afterDeadline = await getKnockoutArena(match0.id, playerB);
  check(
    'once the window closes the opponent’s entry state may be shown',
    afterDeadline?.mayRevealOpponentProgress === true,
  );
  check(
    'and the Submission module confirms the entry the arena would surface',
    (await hasSubmission(playerA, qfRound.id)) === true &&
      (await hasSubmission(playerB, qfRound.id)) === false,
  );
  check(
    'a closed window with an undecided match reads as JUDGING, not an error',
    afterDeadline?.state === 'JUDGING',
    afterDeadline?.state,
  );
  check(
    'the closed window still reports the deadline that was enforced',
    afterDeadline?.window.phase === 'CLOSED' &&
      afterDeadline.window.isOpen === false,
  );

  // ── Disconnect: two independent reads produce identical state ──
  const reconnectA = await getKnockoutArena(match0.id, playerA);
  const reconnectB = await getKnockoutArena(match0.id, playerA);
  check(
    'reloading after a disconnect restores the same deadline — nothing lives in memory',
    reconnectA?.window.deadlineAt?.getTime() ===
      reconnectB?.window.deadlineAt?.getTime(),
  );

  // ── Force a deadlock so the sudden-death surfaces can be exercised ──
  await db.submission.deleteMany({ where: { roundId: qfRound.id } });
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
  await progressTournament(tournament.id);

  const tiedArena = await getKnockoutArena(match0.id, playerA);
  check(
    'a deadlocked match tells the competitor a decider is coming',
    tiedArena?.state === 'TIED' && tiedArena.tieUnresolved,
    tiedArena?.state,
  );
  check(
    'no decider is linked until an operator opens one',
    tiedArena?.suddenDeath === null,
  );

  const started = await startSuddenDeath(match0.id, decider.id, {
    id: admin.id,
    role: 'ADMIN',
  });
  const withDecider = await getKnockoutArena(match0.id, playerA);
  check(
    'once the decider is open the arena points at it',
    withDecider?.state === 'SUDDEN_DEATH' &&
      withDecider.suddenDeath?.matchId === started.suddenDeathMatch.id,
  );

  const deciderArena = await getKnockoutArena(
    started.suddenDeathMatch.id,
    playerA,
  );
  check(
    'the decider’s own arena explains which match it settles',
    deciderArena?.resolves?.matchId === match0.id &&
      deciderArena.resolves.stage === 'QF',
  );
  check(
    'the decider is playable — its window is open and it is actionable',
    deciderArena?.state === 'LIVE' &&
      isArenaActionable(deciderArena.state) &&
      deciderArena.window.isOpen,
  );
  check(
    'the decider uses a DIFFERENT challenge (D14)',
    deciderArena?.problem?.id === decider.id,
  );
  check(
    'the decider appears in the competitor’s match list',
    (await listMyLiveMatches(playerA)).some(
      (match) => match.matchId === started.suddenDeathMatch.id,
    ),
  );

  // ── E7.3: the live snapshot ──
  const snapshot = await getLiveSnapshot(tournament.id);
  check(
    'the snapshot reports the tournament as LIVE',
    snapshot.status === 'LIVE',
  );
  check(
    'the snapshot counts matches held on an unresolved tie',
    snapshot.tiedMatches >= 1,
    String(snapshot.tiedMatches),
  );
  check(
    'the snapshot carries the bracket for the spectator surfaces',
    snapshot.bracket.length > 0 &&
      snapshot.bracket.some((round) => round.stage === 'SUDDEN_DEATH'),
  );
  check(
    'the snapshot never leaks an email address',
    !JSON.stringify(snapshot).includes(EMAIL_DOMAIN),
  );
  check(
    'the snapshot never carries a hidden test',
    !JSON.stringify(snapshot).toLowerCase().includes('hiddentest'),
  );
  check(
    'the snapshot carries a server clock anchor',
    typeof snapshot.serverTime === 'string',
  );

  // Version stability is what makes the SSE loop a push rather than a poll.
  const again = await getLiveSnapshot(tournament.id);
  check(
    'an unchanged tournament produces an unchanged version — no spurious pushes',
    snapshot.version === again.version,
    `${snapshot.version} vs ${again.version}`,
  );
  // The seconds ticking down are excluded from the hash on purpose: including
  // them would make every interval look like a change and turn the stream into
  // a poll with extra steps.
  check(
    'a ticking countdown does NOT move the version',
    snapshot.countdown === null ||
      snapshotVersion({
        ...snapshot,
        countdown: {
          ...snapshot.countdown,
          secondsRemaining: (snapshot.countdown.secondsRemaining ?? 0) + 60,
        },
      }) === snapshotVersion(snapshot),
  );
  check(
    'but a deadline actually MOVING does',
    snapshot.countdown === null ||
      snapshotVersion({
        ...snapshot,
        countdown: {
          ...snapshot.countdown,
          targetAt: new Date(Date.now() + 999_000).toISOString(),
        },
      }) !== snapshotVersion(snapshot),
  );

  await db.tournament.update({
    where: { id: tournament.id },
    data: { participantCount: 9 },
  });
  const changed = await getLiveSnapshot(tournament.id);
  check(
    'a real change moves the version',
    changed.version !== snapshot.version,
  );
  await db.tournament.update({
    where: { id: tournament.id },
    data: { participantCount: 8 },
  });

  // Codex finding 2 (P2): a page that renders at version V and connects a
  // moment later must be able to tell that the first frame is NEWER than what
  // it rendered. That is only possible if the page captured V as its baseline —
  // adopting the first frame instead silently swallows the change, and if it
  // was the last change for a while the page stays stale while the indicator
  // still reads "Live". `LiveRefresh.initialVersion` is now required so a page
  // cannot omit it; this proves the versions actually differ across the race.
  const atRender = (await getLiveSnapshot(tournament.id)).version;
  await db.tournament.update({
    where: { id: tournament.id },
    data: { participantCount: 6 },
  });
  const firstFrame = (await getLiveSnapshot(tournament.id)).version;
  check(
    'REGRESSION: a change between the render and the first frame is detectable from the render baseline',
    firstFrame !== atRender,
  );
  await db.tournament.update({
    where: { id: tournament.id },
    data: { participantCount: 8 },
  });
  check(
    'REGRESSION: and reverting the change returns the original version',
    (await getLiveSnapshot(tournament.id)).version === atRender,
  );

  await checkRejects(
    'a snapshot of an unknown tournament is a typed NOT_FOUND',
    () => getLiveSnapshot('00000000-0000-0000-0000-000000000000'),
    'NOT_FOUND',
  );

  // ── Resolve the decider and confirm the arena reports the result ──
  const sdRound = await db.round.findUniqueOrThrow({
    where: { id: started.suddenDeathMatch.roundId },
  });
  await score(tournament.id, sdRound.id, decider.id, playerA, {
    overall: 40,
    functional: 90,
    tests: 5,
  });
  await score(tournament.id, sdRound.id, decider.id, playerB, {
    overall: 95,
    functional: 60,
    tests: 3,
  });
  await db.round.update({
    where: { id: sdRound.id },
    data: { deadlineAt: new Date(Date.now() - 1000) },
  });
  await progressTournament(tournament.id);

  const wonArena = await getKnockoutArena(match0.id, playerA);
  const lostArena = await getKnockoutArena(match0.id, playerB);
  check(
    'the winner of a sudden death sees WON on the ORIGINAL match',
    wonArena?.state === 'WON' && wonArena.winReason === 'SUDDEN_DEATH',
    `${wonArena?.state} / ${wonArena?.winReason}`,
  );
  check(
    'the loser sees LOST on the same match',
    lostArena?.state === 'LOST',
    lostArena?.state,
  );
  check(
    'a decided match is no longer actionable',
    !isArenaActionable(wonArena!.state),
  );

  const finalSnapshot: LiveSnapshot = await getLiveSnapshot(tournament.id);
  check(
    'resolving the deadlock clears it from the snapshot',
    finalSnapshot.tiedMatches === 0,
    String(finalSnapshot.tiedMatches),
  );
  check(
    'the decided match changed the snapshot version',
    finalSnapshot.version !== snapshot.version,
  );
}

async function main() {
  await cleanup();
  pureTimers();
  pureArenaState();
  await featureFlag();
  await pipeline();
  await cleanup();

  console.log(
    failures === 0
      ? '\nLive arena verified.'
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
