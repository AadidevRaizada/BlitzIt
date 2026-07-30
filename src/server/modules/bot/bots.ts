import 'server-only';
import { randomUUID } from 'node:crypto';
import type {
  BotScoreMode,
  BotSubmitBehaviour,
  Role,
} from '@/generated/prisma/client';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import { recordAudit } from '@/server/modules/admin/audit';
import { isAdmin } from '@/server/modules/auth/roles';
import { registerCompetitor } from '@/server/modules/tournament/registration';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';

/**
 * Test bots (D35).
 *
 * A bot fills a bracket slot so a test tournament can reach the D6 minimum of 8
 * without eight real testers. It is NOT a way around that minimum: bots hold
 * genuine `Registration` rows and are counted by
 * `countCompetitionEligibleRegistrations` like anybody else, so "3 testers and 5
 * bots" really is a field of 8. The rule is unchanged; the field is filled.
 *
 * ## A bot is a User
 *
 * See the schema comment for the full argument. In short: every table the engine
 * touches keys on a user id, so the alternative is a polymorphic rewrite of
 * Ranking, Submission, Match, Notification, UserBadge and HallOfFame. As a User,
 * a bot travels the real registration, submission, evaluation and advancement
 * paths — which is the entire point.
 *
 * ## Three things a bot must never do
 *
 * 1. **Sign in.** It has no `AuthUser` row, and its `authUserId` carries a
 *    `bot:` prefix that Better Auth — which issues cuids — cannot produce. The
 *    session path resolves `AuthUser.id → domain User`, and no session will ever
 *    carry this id.
 * 2. **Receive email.** Its address is on a `.invalid` domain, reserved by RFC
 *    2606 and unroutable by construction, and `send-email` refuses bots outright.
 *    Belt and braces, because email is the one thing here that leaves the
 *    building.
 * 3. **Enter production.** `assertMayEnterEnvironment` refuses it, and
 *    `addBotsToTournament` refuses a non-TEST tournament before it gets there.
 */

/** Marks a bot's synthetic auth id. Unforgeable through the real auth flow. */
const BOT_AUTH_PREFIX = 'bot:';

/**
 * RFC 2606 reserves `.invalid` permanently, so this address can never resolve
 * and can never be delivered to, even if every other guard failed.
 */
const BOT_EMAIL_DOMAIN = 'bots.test.invalid';

export interface BotView {
  userId: string;
  username: string;
  displayName: string | null;
  skill: number;
  submitBehaviour: BotSubmitBehaviour;
  scoreMode: BotScoreMode;
  createdAt: Date;
  /** Test tournaments this bot is currently registered for. */
  registrations: Array<{ tournamentId: string; tournamentName: string }>;
}

export interface CreateBotInput {
  /** Display handle. Uniqueness is enforced by the `User.username` index. */
  username: string;
  displayName?: string | null;
  skill?: number;
  submitBehaviour?: BotSubmitBehaviour;
  scoreMode?: BotScoreMode;
}

export async function createBot(
  input: CreateBotInput,
  admin: { id: string; role: Role },
): Promise<BotView> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  const skill = input.skill ?? 50;
  if (skill < 0 || skill > 100) {
    throw new ConflictError('Bot skill must be between 0 and 100');
  }

  const id = randomUUID();

  const created = await db.$transaction(async (tx) => {
    const clash = await tx.user.findUnique({
      where: { username: input.username },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictError(`The handle "${input.username}" is taken`);
    }

    const user = await tx.user.create({
      data: {
        id,
        // No AuthUser is created to match this. That is deliberate: the absence
        // of the row is what makes signing in as a bot impossible, rather than a
        // password nobody knows.
        authUserId: `${BOT_AUTH_PREFIX}${id}`,
        email: `${id}@${BOT_EMAIL_DOMAIN}`,
        username: input.username,
        displayName: input.displayName ?? input.username,
        isBot: true,
        role: 'USER',
        // Bots skip onboarding: they are created complete. Leaving this null
        // would make them look like abandoned signups on every readiness read.
        onboardingCompletedAt: new Date(),
        botProfile: {
          create: {
            skill,
            submitBehaviour: input.submitBehaviour ?? 'ALWAYS',
            scoreMode: input.scoreMode ?? 'SEEDED',
            createdBy: admin.id,
          },
        },
      },
      include: { botProfile: true },
    });

    await recordAudit(
      {
        actorId: admin.id,
        action: 'bot.create',
        entityType: 'User',
        entityId: user.id,
        after: {
          username: user.username,
          skill,
          submitBehaviour: input.submitBehaviour ?? 'ALWAYS',
          scoreMode: input.scoreMode ?? 'SEEDED',
        },
      },
      tx,
    );

    return user;
  });

  logger.info(
    { botId: created.id, username: created.username, by: admin.id },
    'bot created',
  );

  return {
    userId: created.id,
    username: created.username,
    displayName: created.displayName,
    skill: created.botProfile!.skill,
    submitBehaviour: created.botProfile!.submitBehaviour,
    scoreMode: created.botProfile!.scoreMode,
    createdAt: created.createdAt,
    registrations: [],
  };
}

/**
 * Delete a bot outright.
 *
 * Bots are the one identity on this platform that IS hard-deletable. The
 * delete/anonymise policy that protects a real competitor exists to defend the
 * competitive record (D19/D28); a bot has no record worth defending, and leaving
 * anonymised husks in a test environment would make it harder to read, not
 * safer.
 *
 * Its submissions, rankings and matches in past test tournaments go with it. A
 * test tournament is not a permanent record.
 */
export async function deleteBot(
  botUserId: string,
  admin: { id: string; role: Role },
): Promise<void> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  await db.$transaction(async (tx) => {
    const bot = await tx.user.findUnique({
      where: { id: botUserId },
      select: { id: true, username: true, isBot: true },
    });
    if (!bot) throw new NotFoundError('That bot does not exist');
    if (!bot.isBot) {
      throw new ConflictError(
        'That account is a real user, not a bot; delete it from the users page',
      );
    }

    await recordAudit(
      {
        actorId: admin.id,
        action: 'bot.delete',
        entityType: 'User',
        entityId: botUserId,
        before: { username: bot.username },
      },
      tx,
    );

    // Rows that reference a user WITHOUT a cascade have to go first, in
    // dependency order. Only reachable for a bot: a real user is never deleted
    // while any of these exist (`hasCompetitiveRecord` refuses), so this is not
    // a general-purpose user teardown and must not be reused as one.
    await tx.evaluation.deleteMany({
      where: { submission: { userId: botUserId } },
    });
    await tx.submission.deleteMany({ where: { userId: botUserId } });
    await tx.ranking.deleteMany({ where: { userId: botUserId } });
    await tx.notification.deleteMany({ where: { userId: botUserId } });
    await tx.userBadge.deleteMany({ where: { userId: botUserId } });
    await tx.registration.deleteMany({ where: { userId: botUserId } });
    // Match slots are plain string columns with no foreign key, so a deleted
    // bot would leave a dangling id rather than fail. Blanked explicitly, which
    // reads downstream exactly like a withdrawn competitor.
    await tx.match.updateMany({
      where: { competitorAId: botUserId },
      data: { competitorAId: null, seedA: null },
    });
    await tx.match.updateMany({
      where: { competitorBId: botUserId },
      data: { competitorBId: null, seedB: null },
    });

    await tx.user.delete({ where: { id: botUserId } });
  });

  logger.info({ botId: botUserId, by: admin.id }, 'bot deleted');
}

/**
 * Register bots into a test tournament, filling slots up to the bracket minimum.
 *
 * Goes through the ordinary `registerCompetitor`, deliberately: the capacity
 * claim, the participant counter, the audit entry and the environment guard are
 * all rules that must apply to a bot exactly as they apply to a person. A second
 * registration path would be a second set of rules to keep in step.
 */
export async function addBotsToTournament(
  tournamentId: string,
  botUserIds: readonly string[],
  admin: { id: string; role: Role },
): Promise<{ added: number; skipped: string[] }> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  const tournament = await db.tournament.findUnique({
    where: { id: tournamentId },
    select: { id: true, environment: true, passPriceMinor: true, name: true },
  });
  if (!tournament) throw new NotFoundError('That tournament does not exist');

  // Checked here as well as inside `assertMayEnterEnvironment`, so the operator
  // gets a sentence about what they tried to do rather than a per-bot refusal.
  if (tournament.environment !== 'TEST') {
    throw new ConflictError(
      'Bots exist only inside test tournaments; they can never enter production',
    );
  }
  // A paid test tournament would mean bots holding unpaid registrations that
  // `competitionEligibleRegistrationWhere` filters straight back out — they
  // would appear to register and then silently not count toward the minimum.
  // Refusing is honest; comping them would invent a second payment path.
  if (tournament.passPriceMinor > 0) {
    throw new ConflictError(
      'Bots cannot enter a tournament with an entry fee. Set the test tournament pass price to 0.',
    );
  }

  const bots = await db.user.findMany({
    where: { id: { in: [...botUserIds] }, isBot: true },
    select: { id: true, username: true },
  });
  const known = new Set(bots.map((bot) => bot.id));

  const skipped: string[] = [];
  let added = 0;

  for (const botUserId of botUserIds) {
    if (!known.has(botUserId)) {
      skipped.push(`${botUserId}: not a bot`);
      continue;
    }
    try {
      await registerCompetitor(tournamentId, botUserId, { actorId: admin.id });
      added++;
    } catch (error) {
      // One bot already being registered must not abandon the rest — this is
      // routinely called to top a field up.
      const message = error instanceof Error ? error.message : String(error);
      skipped.push(`${botUserId}: ${message}`);
    }
  }

  if (added > 0) {
    await recordAudit({
      actorId: admin.id,
      action: 'bot.addToTournament',
      entityType: 'Tournament',
      entityId: tournamentId,
      after: { added, skipped },
    });
  }

  logger.info(
    { tournamentId, added, skipped: skipped.length, by: admin.id },
    'bots added to test tournament',
  );
  return { added, skipped };
}

// ───────────────────────────── Reads ─────────────────────────────

export async function listBots(
  admin: { id: string; role: Role },
  client: DbClient = db,
): Promise<BotView[]> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  const bots = await client.user.findMany({
    where: { isBot: true },
    orderBy: { createdAt: 'desc' },
    include: {
      botProfile: true,
      registrations: {
        where: { status: 'ACTIVE' },
        select: { tournamentId: true, tournament: { select: { name: true } } },
      },
    },
  });

  return bots.map((bot) => ({
    userId: bot.id,
    username: bot.username,
    displayName: bot.displayName,
    skill: bot.botProfile?.skill ?? 50,
    submitBehaviour: bot.botProfile?.submitBehaviour ?? 'ALWAYS',
    scoreMode: bot.botProfile?.scoreMode ?? 'SEEDED',
    createdAt: bot.createdAt,
    registrations: bot.registrations.map((registration) => ({
      tournamentId: registration.tournamentId,
      tournamentName: registration.tournament.name,
    })),
  }));
}

/** Which user ids in a set are bots — for BOT badges on competitor surfaces. */
export async function botUserIds(
  userIds: readonly string[],
  client: DbClient = db,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await client.user.findMany({
    where: { id: { in: [...userIds] }, isBot: true },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}
