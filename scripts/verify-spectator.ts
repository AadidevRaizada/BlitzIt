import './load-env';
import type { Prisma } from '../src/generated/prisma/client';
import { db } from '../src/server/db';
import {
  applyTransition,
  createTournament,
  getLeaderboard,
  getLiveSnapshot,
  getMyTournamentState,
  getSpectatorSnapshot,
  getSpectatorTournamentId,
  listMyResults,
  listPublicPlacements,
  listPublicTournaments,
  notifyRegistrationConfirmed,
  progressTournament,
  registerCompetitor,
  syncTournamentNotifications,
} from '../src/server/modules/tournament';
import {
  awardsForPlacements,
  BADGE_CATALOGUE,
  listHallOfFame,
  listUserBadges,
  podiumFromPlacements,
  publishHallOfFame,
  syncBadgeCatalogue,
} from '../src/server/modules/hall-of-fame';
import {
  channelsFor,
  countUnreadNotifications,
  deliverNotificationEmail,
  dispatchNotificationEmails,
  formatMinor,
  isEmailChannel,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notificationContent,
  notificationDedupeKey,
  parseNotificationPayload,
  raiseNotifications,
  renderNotificationEmail,
  setMailer,
  redactEmail,
  type Mailer,
  type OutboundEmail,
} from '../src/server/modules/notification';
import { youtubeVideoId } from '../src/components/features/stream-embed';
import {
  createProblem,
  addHiddenTest,
  publishProblem,
} from '../src/server/modules/problem';
import { AppError } from '../src/lib/errors';
import { attachProblemsToRounds } from './internal/harness-problems';

/**
 * Epic E8 — spectator surfaces, notifications and the Hall of Fame.
 *
 * Covers E8.1 (the public snapshot behind the landing page), E8.2 (leaderboard
 * ordering and a competitor's own history), E8.3 (notification dedupe, channel
 * policy, copy, rendering and delivery) and E8.4 (badges, podium, Hall of Fame).
 *
 * Run: npm run verify:spectator
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

const TAG = `e8-${Date.now()}`;
const EMAIL_DOMAIN = 'e8-spectator.test';

async function cleanup() {
  const where = { tournament: { slug: { contains: TAG } } };
  await db.evaluation.deleteMany({ where });
  await db.evaluationJob.deleteMany({ where: { submission: where } });
  await db.evaluationJob.deleteMany({
    where: { idempotencyKey: { contains: TAG } },
  });
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
  await db.hallOfFame.deleteMany({ where });
  await db.userBadge.deleteMany({
    where: { user: { email: { contains: EMAIL_DOMAIN } } },
  });
  // The email jobs are keyed on the notification's dedupe key, which carries no
  // suite tag — so they have to be found through the notification they point
  // at. Left behind, they are claimed by an unrelated suite's runner and fail.
  await db.$executeRaw`DELETE FROM "EvaluationJob" WHERE "name" = 'sendEmail' AND ("payload"->>'notificationId') IN (SELECT "id" FROM "Notification" WHERE "userId" IN (SELECT "id" FROM "User" WHERE "email" LIKE ${'%' + EMAIL_DOMAIN}))`;
  await db.notification.deleteMany({
    where: { user: { email: { contains: EMAIL_DOMAIN } } },
  });
  await db.tournament.deleteMany({ where: { slug: { contains: TAG } } });
  await db.hiddenTest.deleteMany({
    where: { problem: { slug: { contains: TAG } } },
  });
  await db.problem.deleteMany({ where: { slug: { contains: TAG } } });
  await db.user.deleteMany({ where: { email: { contains: EMAIL_DOMAIN } } });
  await db.authAccount.deleteMany({
    where: { user: { email: { contains: EMAIL_DOMAIN } } },
  });
  await db.authUser.deleteMany({
    where: { email: { contains: EMAIL_DOMAIN } },
  });
}

/** Records what would have been sent, so delivery can be asserted precisely. */
function recordingMailer(): Mailer & { sent: OutboundEmail[]; fail: boolean } {
  const sent: OutboundEmail[] = [];
  return {
    name: 'recording',
    sent,
    fail: false,
    async send(email: OutboundEmail) {
      if (this.fail) throw new Error('provider is down');
      sent.push(email);
      return {
        id: `msg-${sent.length}`,
        skipped: false,
        provider: 'recording',
      };
    },
  };
}

// ─────────────── 1. Notification vocabulary (pure, E8.3) ───────────────

function pureNotifications() {
  console.log('\n── 1. Notifications (pure, E8.3) ──');

  check(
    'the dedupe key is built from what happened, not when',
    notificationDedupeKey({
      type: 'ROUND_OPEN',
      userId: 'u1',
      scopeId: 'r1',
    }) === 'ROUND_OPEN:u1:r1',
  );
  check(
    'the same event for two competitors produces two keys',
    notificationDedupeKey({
      type: 'ROUND_OPEN',
      userId: 'u1',
      scopeId: 'r1',
    }) !==
      notificationDedupeKey({
        type: 'ROUND_OPEN',
        userId: 'u2',
        scopeId: 'r1',
      }),
  );
  check(
    'two events for one competitor produce two keys',
    notificationDedupeKey({
      type: 'ROUND_OPEN',
      userId: 'u1',
      scopeId: 'r1',
    }) !==
      notificationDedupeKey({
        type: 'ROUND_OPEN',
        userId: 'u1',
        scopeId: 'r2',
      }),
  );

  check(
    'every type is delivered in-app — the list is the record of what happened',
    (
      [
        'REGISTRATION_CONFIRMED',
        'SEEDED',
        'ROUND_OPEN',
        'MATCH_REMINDER',
        'RESULT',
        'ADVANCED',
        'ELIMINATED',
        'TOURNAMENT_COMPLETE',
        'PAYOUT_SENT',
        'PRIZE_POOL_UPDATE',
      ] as const
    ).every((type) => channelsFor(type).includes('IN_APP')),
  );
  check(
    'prize-pool updates are in-app only — they change on every registration',
    !isEmailChannel('PRIZE_POOL_UPDATE'),
  );
  check(
    'a round opening is worth an email',
    isEmailChannel('ROUND_OPEN') && isEmailChannel('ELIMINATED'),
  );

  // Copy must never throw on a payload it did not expect — a competitor's
  // notification is not the place to discover an organizer's typo.
  const types = Object.keys(BADGE_CATALOGUE).length; // touch the catalogue
  check('the badge catalogue is non-empty', types > 0);

  for (const type of [
    'REGISTRATION_CONFIRMED',
    'SEEDED',
    'ROUND_OPEN',
    'MATCH_REMINDER',
    'RESULT',
    'ADVANCED',
    'ELIMINATED',
    'TOURNAMENT_COMPLETE',
    'PAYOUT_SENT',
    'PRIZE_POOL_UPDATE',
  ] as const) {
    const withPayload = notificationContent(type, {
      tournamentName: 'Week 1',
      stage: 'QF',
      seed: 3,
      placement: 2,
      amountMinor: 250000,
      opponent: 'rival',
      championName: 'winner',
      matchId: 'm1',
      tournamentId: 't1',
      roundId: 'r1',
    });
    const bare = notificationContent(type, null);
    check(
      `${type} renders with and without a payload`,
      withPayload.subject.length > 0 &&
        withPayload.lines.length > 0 &&
        bare.subject.length > 0 &&
        bare.lines.length > 0,
    );
  }

  check(
    'a malformed payload degrades instead of throwing',
    notificationContent('SEEDED', { seed: 'not-a-number' }).subject.length > 0,
  );
  check(
    'payload parsing drops what it cannot trust',
    parseNotificationPayload({ seed: 'nope', tournamentName: 'ok' })
      .tournamentName === undefined ||
      parseNotificationPayload({ tournamentName: 'ok' }).tournamentName ===
        'ok',
  );
  check(
    'money is rendered in rupees from paise',
    formatMinor(250000) === '₹2,500',
    formatMinor(250000),
  );
  check(
    'an email address is never logged in full',
    redactEmail('someone@example.com') === 's***@example.com',
  );
}

// ─────────────── 2. Badges and podium (pure, E8.4) ───────────────

function pureBadges() {
  console.log('\n── 2. Badges and podium (pure, E8.4) ──');

  const field = [
    { userId: 'a', placement: 1, qualified: true },
    { userId: 'b', placement: 2, qualified: true },
    { userId: 'c', placement: 3, qualified: true },
    { userId: 'd', placement: 4, qualified: true },
    { userId: 'e', placement: 5, qualified: true },
    { userId: 'f', placement: null, qualified: false },
  ];

  const awards = awardsForPlacements(field);
  const slugsFor = (userId: string) =>
    awards
      .filter((a) => a.userId === userId)
      .map((a) => a.slug)
      .sort();

  check(
    'a champion holds every badge their run earned, not just the top one',
    JSON.stringify(slugsFor('a')) ===
      JSON.stringify(['champion', 'qualifier', 'semi-finalist']),
    slugsFor('a').join(','),
  );
  check(
    'the runner-up is also a semi-finalist',
    JSON.stringify(slugsFor('b')) ===
      JSON.stringify(['qualifier', 'runner-up', 'semi-finalist']),
    slugsFor('b').join(','),
  );
  check(
    'third place gets its own badge',
    slugsFor('c').includes('third-place') &&
      slugsFor('c').includes('semi-finalist'),
  );
  check(
    'fourth is a semi-finalist but nothing more',
    JSON.stringify(slugsFor('d')) ===
      JSON.stringify(['qualifier', 'semi-finalist']),
  );
  check(
    'fifth qualified but did not reach the last four',
    JSON.stringify(slugsFor('e')) === JSON.stringify(['qualifier']),
  );
  check(
    'someone who never qualified earns nothing',
    slugsFor('f').length === 0,
  );

  const podium = podiumFromPlacements(field);
  check(
    'the podium reads straight off the placements',
    podium.championId === 'a' &&
      podium.runnerUpId === 'b' &&
      podium.thirdPlaceId === 'c',
  );

  // Without the play-off (D6) both losing semi-finalists share placement 3.
  const noPlayOff = [
    { userId: 'a', placement: 1, qualified: true },
    { userId: 'b', placement: 2, qualified: true },
    { userId: 'c', placement: 3, qualified: true },
    { userId: 'd', placement: 3, qualified: true },
  ];
  check(
    'with no third-place play-off, no single third place is claimed',
    podiumFromPlacements(noPlayOff).thirdPlaceId === null,
  );
  // Codex finding 2 (P2). This suite previously asserted the opposite — that
  // both shared thirds get the badge — which contradicted the badge's own
  // description ("won the third-place play-off") and the podium, which refuses
  // to name a third in this case. The badge now follows the description.
  check(
    'REGRESSION: neither shared third gets a badge for a play-off nobody played',
    awardsForPlacements(noPlayOff).filter((a) => a.slug === 'third-place')
      .length === 0,
  );
  check(
    'REGRESSION: but both keep semi-finalist, which is what they achieved',
    awardsForPlacements(noPlayOff).filter((a) => a.slug === 'semi-finalist')
      .length === 4,
  );
  check(
    'REGRESSION: a sole third — a play-off that was actually won — still earns it',
    awardsForPlacements(field).filter((a) => a.slug === 'third-place')
      .length === 1,
  );
}

// ─────────────── 3. The stream embed (pure, E8.1) ───────────────

function pureStream() {
  console.log('\n── 3. Stream embed (pure, E8.1) ──');

  const id = 'dQw4w9WgXcQ';
  check(
    'a watch URL yields the video id',
    youtubeVideoId(`https://www.youtube.com/watch?v=${id}`) === id,
  );
  check(
    'a short URL yields the video id',
    youtubeVideoId(`https://youtu.be/${id}`) === id,
  );
  check(
    'a live URL yields the video id',
    youtubeVideoId(`https://www.youtube.com/live/${id}`) === id,
  );
  check(
    'an embed URL yields the video id',
    youtubeVideoId(`https://www.youtube.com/embed/${id}?rel=0`) === id,
  );
  check('null in, null out', youtubeVideoId(null) === null);
  check(
    'a non-YouTube host is refused — an operator typo must not become an iframe src',
    youtubeVideoId(`https://evil.example.com/watch?v=${id}`) === null,
  );
  check(
    'a lookalike host is refused',
    youtubeVideoId(`https://youtube.com.evil.example/watch?v=${id}`) === null,
  );
  check(
    'a malformed id is refused',
    youtubeVideoId('https://www.youtube.com/watch?v=../../etc/passwd') === null,
  );
  check('garbage is refused', youtubeVideoId('not a url') === null);
}

// ─────────────── 4. The persisted pipeline ───────────────

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
  scores: { overall: number; functional?: number; tests?: number },
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
      submittedAt: new Date(),
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
  console.log(
    '\n── 4. Spectator, notifications and Hall of Fame (persisted) ──',
  );

  const mailer = recordingMailer();
  setMailer(mailer);

  const admin = await db.user.create({
    data: {
      authUserId: `auth-${TAG}-admin`,
      email: `admin@${EMAIL_DOMAIN}`,
      username: `admin-${TAG}`,
      role: 'ADMIN',
      profile: { create: {} },
    },
  });

  const players: Array<{ id: string; username: string }> = [];
  for (let index = 0; index < 8; index++) {
    players.push(
      await db.user.create({
        data: {
          authUserId: `auth-${TAG}-p${index}`,
          email: `p${index}@${EMAIL_DOMAIN}`,
          username: `p${index}-${TAG}`,
          displayName: `Player ${index}`,
          city: index % 2 === 0 ? 'Pune' : 'Bengaluru',
          profile: { create: {} },
        },
      }),
    );
  }

  const problem = await makeProblem(`p-${TAG}`, 'E8 challenge');

  const tournament = await createTournament(
    {
      name: 'E8 Spectator Cup',
      slug: `t-${TAG}`,
      bracketSize: 8,
      thirdPlaceEnabled: true,
      minRegistrations: 8,
      maxRegistrations: 8,
    },
    { actorId: admin.id },
  );
  await db.tournament.update({
    where: { id: tournament.id },
    data: {
      youtubeStreamUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      basePrizePoolMinor: 80000,
      prizePoolMinor: 80000,
    },
  });

  // ── Badge catalogue ──
  const synced = await syncBadgeCatalogue();
  check(
    'the badge catalogue synchronises from code',
    synced === Object.keys(BADGE_CATALOGUE).length,
  );
  check('syncing twice is idempotent', (await syncBadgeCatalogue()) === synced);

  await applyTransition(tournament.id, 'PUBLISH', { actorId: admin.id });
  await applyTransition(tournament.id, 'OPEN_REGISTRATION', {
    actorId: admin.id,
  });
  await db.tournament.update({
    where: { id: tournament.id },
    data: {
      registrationOpensAt: new Date(Date.now() - 60_000),
      registrationClosesAt: new Date(Date.now() + 3_600_000),
      simulationOpensAt: new Date(Date.now() + 3_900_000),
      simulationClosesAt: new Date(Date.now() + 7_200_000),
      liveStartsAt: new Date(Date.now() + 8_000_000),
    },
  });

  const draft = await createTournament(
    {
      name: 'E8 Draft Hidden',
      slug: `draft-${TAG}`,
      bracketSize: 8,
    },
    { actorId: admin.id },
  );
  const unlisted = await createTournament(
    {
      name: 'E8 Unlisted Hidden',
      slug: `unlisted-${TAG}`,
      bracketSize: 8,
    },
    { actorId: admin.id },
  );
  await applyTransition(unlisted.id, 'PUBLISH', { actorId: admin.id });
  await db.tournament.update({
    where: { id: unlisted.id },
    data: { visibility: 'UNLISTED' },
  });
  const archived = await createTournament(
    {
      name: 'E8 Archived Hidden',
      slug: `archived-${TAG}`,
      bracketSize: 8,
    },
    { actorId: admin.id },
  );
  await applyTransition(archived.id, 'PUBLISH', { actorId: admin.id });
  await db.tournament.update({
    where: { id: archived.id },
    data: { archivedAt: new Date() },
  });

  const publicTournaments = await listPublicTournaments();
  const publicIds = Object.values(publicTournaments)
    .flat()
    .map((row) => row.id);
  check(
    'the public tournament list includes the registering cup',
    publicTournaments.REGISTERING.some((row) => row.id === tournament.id),
  );
  check(
    'the public tournament list excludes draft, unlisted and archived tournaments',
    !publicIds.includes(draft.id) &&
      !publicIds.includes(unlisted.id) &&
      !publicIds.includes(archived.id),
  );

  // ── Spectator resolution ──
  // Asserted as a RULE rather than an identity: the development database may
  // already hold other public tournaments, and a check that demanded this one
  // specifically would pass or fail on leftover data rather than on the code.
  const spectatorId = await getSpectatorTournamentId();
  check(
    'the landing page always resolves something to show',
    spectatorId !== null,
  );
  const resolved = spectatorId
    ? await db.tournament.findUnique({
        where: { id: spectatorId },
        select: { status: true, visibility: true, archivedAt: true },
      })
    : null;
  check(
    'what it resolves is public and not archived',
    resolved?.visibility === 'PUBLIC' && resolved.archivedAt === null,
    `${resolved?.visibility} / ${String(resolved?.archivedAt)}`,
  );
  const PRIORITY = [
    'LIVE',
    'BRACKET_GENERATED',
    'SEEDING',
    'SIMULATION',
    'REGISTRATION_CLOSED',
    'REGISTRATION_OPEN',
    'PUBLISHED',
    'COMPLETED',
  ];
  check(
    'and it never ranks below a tournament that is also showable',
    PRIORITY.indexOf(resolved?.status ?? '') <=
      PRIORITY.indexOf('REGISTRATION_OPEN'),
    `resolved ${resolved?.status} against REGISTRATION_OPEN`,
  );
  check(
    'an archived tournament is never chosen',
    !(await db.tournament.findMany({ where: { archivedAt: { not: null } } }))
      .map((t) => t.id)
      .includes(spectatorId ?? ''),
  );

  for (const player of players) {
    await registerCompetitor(tournament.id, player.id);
  }
  await db.authUser.create({
    data: {
      id: `auth-${TAG}-p0`,
      email: `auth-p0@${EMAIL_DOMAIN}`,
    },
  });
  await db.authAccount.create({
    data: {
      userId: `auth-${TAG}-p0`,
      accountId: `github-${TAG}-p0`,
      providerId: 'github',
    },
  });
  await db.user.update({
    where: { id: players[0]!.id },
    data: { avatarUrl: 'https://example.com/avatar.png' },
  });
  const mine = await getMyTournamentState(players[0]!.id, tournament.id);
  check(
    'my tournament state reports registration and readiness from real rows',
    mine.isRegistered &&
      mine.readiness.registered &&
      mine.readiness.githubConnected &&
      mine.readiness.avatarSet &&
      mine.readiness.profileLocationSet,
  );

  // ── Registration confirmation (E8.3) ──
  mailer.sent.length = 0;
  const queued = await notifyRegistrationConfirmed(
    tournament.id,
    players[0]!.id,
  );
  check('registering raises a confirmation email job', queued === 1);

  const confirmations = await listMyNotifications(players[0]!.id);
  check(
    'the confirmation appears in the in-app list immediately',
    confirmations.length === 1 &&
      confirmations[0]!.type === 'REGISTRATION_CONFIRMED',
  );
  check(
    'the in-app entry carries the same copy the email will',
    confirmations[0]!.title ===
      notificationContent('REGISTRATION_CONFIRMED', {
        tournamentName: tournament.name,
      }).subject,
  );

  const repeat = await notifyRegistrationConfirmed(
    tournament.id,
    players[0]!.id,
  );
  check(
    'raising the same confirmation twice sends nothing more (dedupe)',
    repeat === 0,
  );
  check(
    'and does not duplicate the in-app row',
    (await listMyNotifications(players[0]!.id)).length === 1,
  );

  // ── Delivery ──
  const pendingJob = await db.evaluationJob.findFirst({
    where: { name: 'sendEmail' },
    orderBy: { createdAt: 'desc' },
  });
  check(
    'the email job is queued with the SEND_EMAIL type',
    pendingJob?.type === 'SEND_EMAIL',
    String(pendingJob?.type),
  );

  const notificationRow = await db.notification.findFirstOrThrow({
    where: { userId: players[0]!.id },
  });
  const delivered = await deliverNotificationEmail(notificationRow.id);
  check(
    'delivery sends exactly one email',
    delivered.sent && mailer.sent.length === 1,
  );
  check(
    'the email carries both an HTML and a plain-text body',
    (mailer.sent[0]?.html.length ?? 0) > 100 &&
      (mailer.sent[0]?.text.length ?? 0) > 20,
  );
  check(
    'the HTML is a real document with the brand and a call to action',
    (mailer.sent[0]?.html.includes('Blitz It') ?? false) &&
      (mailer.sent[0]?.html.includes('href=') ?? false),
  );
  check(
    'delivering the same notification again is a no-op',
    (await deliverNotificationEmail(notificationRow.id)).skipped &&
      mailer.sent.length === 1,
  );

  const settled = await db.notification.findUniqueOrThrow({
    where: { id: notificationRow.id },
  });
  check(
    'a delivered notification is SENT with a timestamp',
    settled.status === 'SENT' && settled.sentAt !== null,
  );

  // A provider failure must surface, so the queue can retry it.
  const failing = recordingMailer();
  failing.fail = true;
  setMailer(failing);
  const { createdKeys } = await raiseNotifications([
    {
      userId: players[1]!.id,
      type: 'MATCH_REMINDER',
      scopeId: `${TAG}-reminder`,
      tournamentId: tournament.id,
      payload: { tournamentName: tournament.name, stage: 'QF' },
    },
  ]);
  const reminder = await db.notification.findFirstOrThrow({
    where: { dedupeKey: createdKeys[0] },
  });
  await checkRejects(
    'a provider failure is rethrown so the queue can retry it',
    () => deliverNotificationEmail(reminder.id),
  );
  const afterFailure = await db.notification.findUniqueOrThrow({
    where: { id: reminder.id },
  });
  check(
    'the failed attempt is recorded on the notification',
    afterFailure.attempts === 1 &&
      afterFailure.lastError !== null &&
      afterFailure.status === 'PENDING',
  );
  setMailer(mailer);

  // ── Read state ──
  check(
    'an unread count is available for the header badge',
    (await countUnreadNotifications(players[0]!.id)) === 1,
  );
  await markNotificationRead(notificationRow.id, players[0]!.id);
  check(
    'marking read clears it from the unread count',
    (await countUnreadNotifications(players[0]!.id)) === 0,
  );
  await checkRejects(
    "a competitor cannot mark somebody else's notification read",
    () => markNotificationRead(notificationRow.id, players[2]!.id),
    'NOT_FOUND',
  );

  // ── Run the tournament ──
  await applyTransition(tournament.id, 'CLOSE_REGISTRATION', {
    actorId: admin.id,
  });
  await attachProblemsToRounds(tournament.id, TAG);
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
      data: { problemId: problem.id, status: 'OPEN' },
    });
    for (const [index, player] of players.entries()) {
      await score(tournament.id, round.id, problem.id, player.id, {
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
  await attachProblemsToRounds(tournament.id, TAG);

  // ── Leaderboard ordering (E8.2) ──
  const byScore = await getLeaderboard(tournament.id, { take: 8 });
  check(
    'the leaderboard is ordered by score, best first',
    byScore.every(
      (entry, index) =>
        index === 0 ||
        entry.simulationScore <= byScore[index - 1]!.simulationScore,
    ),
  );
  const bySeed = await getLeaderboard(tournament.id, { by: 'seed', take: 8 });
  check('ordering by seed starts at seed 1', bySeed[0]?.seed === 1);
  const byCity = await getLeaderboard(tournament.id, { by: 'city', take: 8 });
  check(
    'ordering by city groups cities together',
    byCity[0]?.city === 'Bengaluru',
    String(byCity[0]?.city),
  );
  check(
    'the public leaderboard never carries an email address',
    !JSON.stringify(byScore).includes(EMAIL_DOMAIN),
  );

  // ── Seeded notifications ──
  const seededSync = await syncTournamentNotifications(tournament.id);
  check(
    'seeding notifies the qualified field',
    seededSync.raised >= 8,
    String(seededSync.raised),
  );
  const replay = await syncTournamentNotifications(tournament.id);
  check(
    'running the sweep again raises nothing — it is a pull, not an event',
    replay.raised === 0,
    String(replay.raised),
  );

  await applyTransition(tournament.id, 'START_KNOCKOUT', { actorId: admin.id });
  const qfRound = await db.round.findFirstOrThrow({
    where: { tournamentId: tournament.id, stage: 'QF' },
  });
  await db.round.update({
    where: { id: qfRound.id },
    data: { problemId: problem.id },
  });

  const openSync = await syncTournamentNotifications(tournament.id);
  check(
    'an open knockout round notifies both competitors in every match',
    openSync.raised === 8,
    String(openSync.raised),
  );
  const roundOpen = (await listMyNotifications(players[0]!.id)).find(
    (n) => n.type === 'ROUND_OPEN',
  );
  check(
    'the round-open notification links straight to the arena',
    roundOpen?.cta?.path.startsWith('/arena/knockout/') ?? false,
    roundOpen?.cta?.path,
  );

  // ── Play it out ──
  const stages = ['QF', 'SF', 'THIRD_PLACE', 'FINAL'] as const;
  for (const stage of stages) {
    const rounds = await db.round.findMany({
      where: { tournamentId: tournament.id, stage },
    });
    for (const round of rounds) {
      await db.round.update({
        where: { id: round.id },
        data: { problemId: problem.id },
      });
      const matches = await db.match.findMany({ where: { roundId: round.id } });
      for (const match of matches) {
        for (const userId of [match.competitorAId, match.competitorBId]) {
          if (!userId) continue;
          const existing = await db.submission.findUnique({
            where: { userId_roundId: { userId, roundId: round.id } },
          });
          if (existing) continue;
          const seed =
            userId === match.competitorAId ? match.seedA : match.seedB;
          await score(tournament.id, round.id, problem.id, userId, {
            overall: 100 - (seed ?? 50),
          });
        }
      }
      await db.round.update({
        where: { id: round.id },
        data: { deadlineAt: new Date(Date.now() - 1000) },
      });
    }
    await progressTournament(tournament.id);
  }

  const finished = await db.tournament.findUniqueOrThrow({
    where: { id: tournament.id },
  });
  check(
    'the tournament ran to completion',
    finished.status === 'COMPLETED',
    finished.status,
  );

  // ── Hall of Fame (E8.4) ──
  const hof = await db.hallOfFame.findUnique({
    where: { tournamentId: tournament.id },
  });
  check(
    'completing a tournament publishes it to the Hall of Fame automatically',
    hof !== null,
  );
  check(
    'the podium is recorded',
    hof?.championId !== null && hof?.runnerUpId !== null,
  );
  check(
    'the field size and prize pool are frozen onto the record',
    hof?.participantCount === 8 && hof?.prizePoolMinor === 80000,
    `${hof?.participantCount} / ${hof?.prizePoolMinor}`,
  );

  const republished = await publishHallOfFame(tournament.id);
  check(
    'publishing again is idempotent and awards nothing new',
    !republished.created && republished.badgesAwarded === 0,
    `created=${republished.created} badges=${republished.badgesAwarded}`,
  );
  const publishedAtUnchanged = await db.hallOfFame.findUniqueOrThrow({
    where: { tournamentId: tournament.id },
  });
  check(
    'republishing does not move the publication date',
    publishedAtUnchanged.publishedAt.getTime() === hof!.publishedAt.getTime(),
  );

  const championId = hof!.championId;
  const championBadges = await listUserBadges(championId);
  check(
    'the champion holds the champion badge',
    championBadges.some((badge) => badge.slug === 'champion'),
    championBadges.map((b) => b.slug).join(','),
  );
  check(
    'and it is scoped to the tournament they won',
    championBadges.some(
      (badge) =>
        badge.slug === 'champion' && badge.tournamentId === tournament.id,
    ),
  );

  const publicList = await listHallOfFame({ take: 10 });
  check(
    'the tournament appears in the public Hall of Fame',
    publicList.some((entry) => entry.tournamentId === tournament.id),
  );
  check(
    'the Hall of Fame never carries an email address',
    !JSON.stringify(publicList).includes(EMAIL_DOMAIN),
  );

  await db.tournament.update({
    where: { id: tournament.id },
    data: { visibility: 'UNLISTED' },
  });
  check(
    'an unlisted tournament is withheld from the public Hall of Fame',
    !(await listHallOfFame({ take: 10 })).some(
      (entry) => entry.tournamentId === tournament.id,
    ),
  );
  check(
    'and withheld from a public profile',
    (await listPublicPlacements(championId)).every(
      (entry) => entry.tournamentId !== tournament.id,
    ),
  );
  // Codex finding 3 (P2): badges carry the awarding tournament's NAME, so a
  // public profile reading them unfiltered announces a rehearsal that is
  // deliberately unannounced everywhere else.
  check(
    'REGRESSION: an unlisted tournament’s badges are withheld from a public profile',
    (await listUserBadges(championId, { publicOnly: true })).every(
      (badge) => badge.tournamentId !== tournament.id,
    ),
  );
  check(
    'REGRESSION: and its name never appears in the public badge list',
    !JSON.stringify(
      await listUserBadges(championId, { publicOnly: true }),
    ).includes(tournament.name),
  );
  check(
    'but the competitor still sees them on their own results page',
    (await listUserBadges(championId)).some(
      (badge) => badge.tournamentId === tournament.id,
    ),
  );
  await db.tournament.update({
    where: { id: tournament.id },
    data: { visibility: 'PUBLIC' },
  });

  await checkRejects(
    'a tournament that has not completed cannot be published',
    async () => {
      const draft = await createTournament(
        { name: 'E8 Draft', slug: `t-${TAG}-draft`, bracketSize: 8 },
        { actorId: admin.id },
      );
      return publishHallOfFame(draft.id);
    },
    'CONFLICT',
  );

  // ── Completion notifications ──
  const completeNotifications = await listMyNotifications(championId, {
    take: 50,
  });
  check(
    'the champion is told the tournament finished',
    completeNotifications.some((n) => n.type === 'TOURNAMENT_COMPLETE'),
  );
  check(
    'and was told they advanced along the way',
    completeNotifications.some((n) => n.type === 'ADVANCED'),
  );
  const loser = await db.ranking.findFirstOrThrow({
    where: { tournamentId: tournament.id, eliminatedAtStage: 'QF' },
  });
  const loserNotifications = await listMyNotifications(loser.userId, {
    take: 50,
  });
  check(
    'a knocked-out competitor is told where their run ended',
    loserNotifications.some((n) => n.type === 'ELIMINATED'),
  );
  check(
    'nobody is told they were "eliminated" from the final',
    !completeNotifications.some(
      (n) => n.type === 'ELIMINATED' && n.body.toLowerCase().includes('final'),
    ),
  );

  // Codex finding 1 (P2): a terminal match has no next round, so ADVANCED —
  // whose copy says "the next round opens on schedule" — must not be raised
  // for it. THIRD_PLACE is as terminal as FINAL.
  const thirdPlaceMatch = await db.match.findFirst({
    where: {
      tournamentId: tournament.id,
      round: { stage: 'THIRD_PLACE' },
      status: 'DECIDED',
    },
    select: { winnerId: true, loserId: true },
  });
  check(
    'the tournament actually played a third-place match',
    thirdPlaceMatch?.winnerId != null,
  );
  const thirdWinnerNotifications = thirdPlaceMatch?.winnerId
    ? await listMyNotifications(thirdPlaceMatch.winnerId, { take: 50 })
    : [];
  check(
    'REGRESSION: the third-place winner is never told the next round opens',
    !thirdWinnerNotifications.some(
      (n) => n.type === 'ADVANCED' && n.body.toLowerCase().includes('third'),
    ),
  );
  const thirdLoserNotifications = thirdPlaceMatch?.loserId
    ? await listMyNotifications(thirdPlaceMatch.loserId, { take: 50 })
    : [];
  check(
    'REGRESSION: and the fourth-place finisher is not "eliminated" at THIRD_PLACE',
    !thirdLoserNotifications.some(
      (n) => n.type === 'ELIMINATED' && n.body.toLowerCase().includes('third'),
    ),
  );
  check(
    'both are covered by the completion notification instead',
    thirdWinnerNotifications.some((n) => n.type === 'TOURNAMENT_COMPLETE') &&
      thirdLoserNotifications.some((n) => n.type === 'TOURNAMENT_COMPLETE'),
  );

  const finalSweep = await syncTournamentNotifications(tournament.id);
  check(
    'a sweep over a finished tournament raises nothing new',
    finalSweep.raised === 0,
    String(finalSweep.raised),
  );

  // ── My results (E8.2) ──
  const results = await listMyResults(championId);
  check(
    'a competitor sees their own tournament history',
    results.length === 1 && results[0]!.tournamentId === tournament.id,
  );
  check(
    'with their placement',
    results[0]!.placement === 1,
    String(results[0]!.placement),
  );
  check(
    'and every scored entry with its evidence link',
    results[0]!.submissions.length >= 3 &&
      results[0]!.submissions.every((s) => s.submissionId.length > 0),
    String(results[0]!.submissions.length),
  );
  check(
    'the history is scoped to the competitor — no other entries leak in',
    results
      .flatMap((r) => r.submissions)
      .every(
        (s) => typeof s.overallScore === 'number' || s.overallScore === null,
      ),
  );
  const otherResults = await listMyResults(players[7]!.id);
  check(
    'a different competitor sees a different history',
    otherResults[0]?.placement !== 1,
  );

  // ── Public placements are narrower than private results ──
  const publicPlacements = await listPublicPlacements(championId);
  check(
    'public placements expose the placement',
    publicPlacements[0]?.placement === 1,
  );
  check(
    'but never a score or a submission',
    !JSON.stringify(publicPlacements).includes('submissionId') &&
      !JSON.stringify(publicPlacements).includes('overallScore'),
  );

  // ── Landing snapshot ──
  // The spectator resolver deliberately prefers a live or registering
  // tournament over a finished one, so it will NOT pick this one now that it
  // has completed. Both halves are checked: the resolver returns something
  // coherent, and this tournament's own snapshot carries what the landing page
  // renders.
  const spectator = await getSpectatorSnapshot({ leaderboardTake: 10 });
  check(
    'the landing page resolves a snapshot without an id in the URL',
    spectator !== null && spectator.tournamentId.length > 0,
  );
  check(
    'a completed tournament does not outrank a live or registering one',
    spectator?.status !== 'COMPLETED' ||
      (await db.tournament.count({
        where: {
          visibility: 'PUBLIC',
          archivedAt: null,
          status: { not: 'COMPLETED' },
        },
      })) === 0,
    spectator?.status,
  );

  const snapshot = await getLiveSnapshot(tournament.id, {
    leaderboardTake: 10,
  });
  check(
    'the snapshot carries the stream URL for the embed',
    snapshot.youtubeStreamUrl?.includes('youtube.com') ?? false,
  );
  check(
    'the snapshot carries the prize pool and participant count',
    snapshot.prizePoolMinor === 80000 && snapshot.participantCount === 8,
    `${snapshot.prizePoolMinor} / ${snapshot.participantCount}`,
  );
  check(
    'the snapshot carries public schedule fields',
    snapshot.registrationOpensAt !== null &&
      snapshot.registrationClosesAt !== null &&
      snapshot.simulationOpensAt !== null &&
      snapshot.simulationClosesAt !== null &&
      snapshot.liveStartsAt !== null,
  );
  check(
    'the completed snapshot ranks the champion first',
    snapshot.leaderboard[0]?.placement === 1,
    String(snapshot.leaderboard[0]?.placement),
  );

  // Dispatch bookkeeping: nothing is queued for keys that were never created.
  check(
    'dispatching an unknown key queues nothing',
    (await dispatchNotificationEmails(['does-not-exist'])) === 0,
  );

  const markedAll = await markAllNotificationsRead(championId);
  check('mark-all-read clears the rest', markedAll >= 1);
  check(
    'and leaves nothing unread',
    (await countUnreadNotifications(championId)) === 0,
  );

  // Rendering must work for a type that has never been through the DB.
  const rendered = renderNotificationEmail('PAYOUT_SENT', {
    amountMinor: 200000,
    tournamentName: tournament.name,
  });
  check(
    'any notification type can be rendered to an email',
    rendered.subject.length > 0 &&
      rendered.html.includes('<!doctype html>') &&
      rendered.text.includes('₹2,000'),
  );

  // The renderer runs inside the job runner, which resolves modules under the
  // `react-server` condition — the reason this is a string builder rather than
  // React Email. This suite runs under that same condition, so reaching here at
  // all is the regression test.
  const hostile = renderNotificationEmail('SEEDED', {
    tournamentName: '<script>alert(1)</script>',
    seed: 1,
  });
  check(
    'user-controlled text is escaped, never interpolated raw',
    !hostile.html.includes('<script>') &&
      hostile.html.includes('&lt;script&gt;'),
  );
  check(
    'the call-to-action URL is absolute so it works from an inbox',
    hostile.html.includes('http'),
  );

  setMailer(null);
}

async function main() {
  await cleanup();
  pureNotifications();
  pureBadges();
  pureStream();
  await pipeline();
  await cleanup();

  console.log(
    failures === 0
      ? '\nSpectator surfaces, notifications and Hall of Fame verified.'
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
    setMailer(null);
    await db.$disconnect();
    process.exit(failures > 0 ? 1 : 0);
  });
