import 'server-only';
import type { Role } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { isAdmin } from '@/server/modules/auth/roles';
import {
  tournamentEnvironmentFilter,
  type EnvironmentScope,
} from '@/server/modules/tournament/environment.public';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { recordAudit, type DbClient } from './audit';

/**
 * Operator directory: users, their roles, and the audit trail.
 *
 * The audit trail remains read-only — it is append-only by design. User
 * management is not: an operator can now grant and revoke the TEST role, and
 * remove an account. ADMIN is deliberately NOT grantable here and stays with the
 * `make:admin` script; handing out the role that can hand out roles is a
 * different class of decision from marking somebody a tester, and it should not
 * be one click away in the same table.
 */

export interface UserRow {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  role: Role;
  isBot: boolean;
  city: string | null;
  createdAt: Date;
  registrations: number;
  submissions: number;
  /**
   * Whether this account has a competitive record. Drives the admin UI's
   * delete/anonymise choice, so an operator sees which one applies before
   * clicking rather than after being refused.
   */
  hasCompetitiveRecord: boolean;
}

export async function listUsers(
  admin: { id: string; role: Role },
  options: { search?: string; take?: number; includeBots?: boolean } = {},
  client: DbClient = db,
): Promise<UserRow[]> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  const search = options.search?.trim();
  const users = await client.user.findMany({
    where: {
      // Bots are users, but they are not PEOPLE, and an operator scanning the
      // directory for a competitor should not have to read past them. They have
      // their own admin surface; this one lists humans unless asked otherwise.
      ...(options.includeBots ? {} : { isBot: false }),
      ...(search
        ? {
            OR: [
              { username: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { displayName: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: options.take ?? 100,
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      role: true,
      isBot: true,
      city: true,
      createdAt: true,
      _count: {
        select: {
          registrations: true,
          submissions: true,
          rankings: true,
          payments: true,
          payouts: true,
        },
      },
    },
  });

  return users.map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    isBot: user.isBot,
    city: user.city,
    createdAt: user.createdAt,
    registrations: user._count.registrations,
    submissions: user._count.submissions,
    // Must stay in step with `hasCompetitiveRecord`, which is the authority —
    // this is the list view's preview of the answer, computed from counts the
    // query already loads rather than N+1 calls into it.
    hasCompetitiveRecord:
      user._count.submissions > 0 ||
      user._count.rankings > 0 ||
      user._count.payments > 0 ||
      user._count.payouts > 0 ||
      user._count.registrations > 0,
  }));
}

// ───────────────────────── User management ─────────────────────────

/**
 * Does this account carry anything the competitive record depends on?
 *
 * The relations checked here are the ones with non-cascading foreign keys, which
 * is not a coincidence: the schema was built so that a competitor's results
 * cannot be deleted out from under a tournament. This function is the readable
 * form of that constraint, so an operator learns the answer from the UI instead
 * of from a foreign-key violation.
 *
 * **`Registration` counts, and it is the one that is easy to leave out.** An
 * entrant who has registered but not yet submitted has no submission, no
 * ranking and — in a free tournament — no payment, so the other four checks all
 * pass and the account looks empty. It is not: the registration is part of a
 * live field, counted by `countCompetitionEligibleRegistrations` and therefore
 * by the D6 bracket sizing. Converting that account to TEST would leave a TEST
 * user holding a seat in a production draw; deleting it would silently shrink a
 * field that may already have been sized around it.
 */
export async function hasCompetitiveRecord(
  userId: string,
  client: DbClient = db,
): Promise<boolean> {
  const [submissions, rankings, payments, payouts, registrations] =
    await Promise.all([
      client.submission.count({ where: { userId } }),
      client.ranking.count({ where: { userId } }),
      client.payment.count({ where: { userId } }),
      client.payout.count({ where: { userId } }),
      client.registration.count({ where: { userId } }),
    ]);
  return submissions + rankings + payments + payouts + registrations > 0;
}

/**
 * Grant or revoke the TEST role.
 *
 * Only ever moves between USER and TEST. An ADMIN is never demoted by this call
 * and a TEST user is never promoted to ADMIN — the admin role is granted out of
 * band (`make:admin`) precisely so it cannot be reached from a UI that operators
 * use every day.
 *
 * ## Why granting TEST to an existing competitor is refused
 *
 * `Role` is single-valued, so making somebody a tester REPLACES their USER
 * identity — and `assertMayEnterEnvironment` then bars them from every
 * production tournament, including ones they are already registered for and
 * have submitted to. Their history would not be deleted, but they would be
 * locked out of finishing the event they are in the middle of, and the
 * production leaderboard would keep listing a competitor who can no longer
 * compete.
 *
 * Rather than let an operator discover that afterwards, the grant is refused
 * while a production record exists. Testers are new accounts; that is a
 * deliberate cost of keeping the two worlds genuinely separate. Revoking TEST is
 * unrestricted in the same way for the mirror reason: a test record does not
 * bind anything in production.
 */
export async function setTesterRole(
  userId: string,
  isTester: boolean,
  admin: { id: string; role: Role },
): Promise<{ id: string; role: Role }> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  // Owns its transaction rather than accepting a client, like `updateTournament`
  // and `deleteTournament`: this is a top-level operator action, not a
  // composable step, and `Prisma.TransactionClient` cannot open one anyway.
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, isBot: true, username: true },
    });
    if (!user) throw new NotFoundError('That user does not exist');
    if (user.isBot) {
      throw new ConflictError(
        'Bots already live in the test environment; their role is not editable',
      );
    }
    if (user.role === 'ADMIN') {
      throw new ConflictError(
        'Admins already have full test access; changing their role here would remove their admin rights',
      );
    }

    const target: Role = isTester ? 'TEST' : 'USER';
    if (user.role === target) return { id: user.id, role: user.role };

    if (isTester && (await hasCompetitiveRecord(userId, tx))) {
      throw new ConflictError(
        `${user.username} has a production competitive record. Granting TEST would bar them from the production tournaments they are already part of. Create a separate test account instead.`,
      );
    }

    const updated = await tx.user.update({
      where: { id: userId },
      data: { role: target },
      select: { id: true, role: true },
    });

    await recordAudit(
      {
        actorId: admin.id,
        action: isTester ? 'user.grantTestRole' : 'user.revokeTestRole',
        entityType: 'User',
        entityId: userId,
        before: { role: user.role },
        after: { role: target },
      },
      tx,
    );

    logger.info(
      { userId, username: user.username, from: user.role, to: target },
      'test role changed',
    );
    return updated;
  });
}

export interface DeleteUserResult {
  /** 'DELETED' when the row is gone, 'ANONYMISED' when the record was kept. */
  outcome: 'DELETED' | 'ANONYMISED';
  userId: string;
}

/**
 * Remove a user.
 *
 * The policy mirrors `deleteTournament`, which already established the
 * platform's stance: a DRAFT with no registrations may be deleted, and anything
 * further along is cancelled rather than erased. The same reasoning applies to
 * people, and more strongly — D19 makes submissions and server timestamps the
 * anti-cheat anchor, and D28 keeps evidence for dispute resolution. Cascading a
 * deletion through them would rewrite finished brackets and leave Hall of Fame
 * entries pointing at nobody.
 *
 * So:
 *
 * - **No competitive record** → the row is genuinely deleted, along with the
 *   cascading Profile, TermsAcceptance and BotProfile.
 * - **A competitive record exists** → refused, unless `anonymise` is set, which
 *   scrubs the identifying fields and leaves the results standing.
 *
 * `AuditLog.actorId` has no foreign key by design, so this user's trail — and
 * the record of this deletion — survives either way.
 */
export async function deleteUser(
  userId: string,
  admin: { id: string; role: Role },
  options: { anonymise?: boolean } = {},
): Promise<DeleteUserResult> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');
  if (userId === admin.id) {
    throw new ConflictError('You cannot delete your own account');
  }

  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isBot: true,
        authUserId: true,
      },
    });
    if (!user) throw new NotFoundError('That user does not exist');

    const record = await hasCompetitiveRecord(userId, tx);

    if (record && !options.anonymise) {
      throw new ConflictError(
        `${user.username} has submissions, rankings or payments on record. Deleting them would rewrite finished tournaments. Anonymise the account instead, which scrubs their identity and leaves the results intact.`,
      );
    }

    if (record) {
      // Anonymise. The unique columns must stay unique, so they are replaced
      // with a value derived from the id rather than blanked — two anonymised
      // accounts would otherwise collide on the empty string. `.invalid` is
      // reserved by RFC 2606 and can never be routed, so the address is
      // unusable rather than merely unused.
      await tx.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${user.id}@deleted.invalid`,
          username: `deleted-${user.id.slice(0, 8)}`,
          displayName: null,
          avatarUrl: null,
          city: null,
        },
      });
      // The profile carries the free-text and the GitHub handle — the parts a
      // person would actually recognise. It is the point of the exercise.
      await tx.profile.deleteMany({ where: { userId } });

      await recordAudit(
        {
          actorId: admin.id,
          action: 'user.anonymise',
          entityType: 'User',
          entityId: userId,
          before: { username: user.username, email: user.email },
          after: { anonymised: true },
        },
        tx,
      );

      logger.info(
        { userId, by: admin.id },
        'user anonymised; competitive record retained',
      );
      return { outcome: 'ANONYMISED' as const, userId };
    }

    await recordAudit(
      {
        actorId: admin.id,
        action: 'user.delete',
        entityType: 'User',
        entityId: userId,
        before: {
          username: user.username,
          email: user.email,
          role: user.role,
          isBot: user.isBot,
        },
      },
      tx,
    );

    await tx.user.delete({ where: { id: userId } });

    // Better Auth owns `AuthUser`, and deleting it cascades its sessions and
    // accounts — which is what actually signs the person out and releases their
    // GitHub link. A bot has no AuthUser to remove.
    if (!user.isBot) {
      await tx.authUser.deleteMany({ where: { id: user.authUserId } });
    }

    logger.info({ userId, by: admin.id }, 'user deleted');
    return { outcome: 'DELETED' as const, userId };
  });
}

export interface AuditRow {
  id: string;
  actorId: string | null;
  actorUsername: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

export async function listAuditLog(
  admin: { id: string; role: Role },
  options: {
    entityType?: string;
    entityId?: string;
    action?: string;
    take?: number;
  } = {},
  client: DbClient = db,
): Promise<AuditRow[]> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  const entries = await client.auditLog.findMany({
    where: {
      ...(options.entityType ? { entityType: options.entityType } : {}),
      ...(options.entityId ? { entityId: options.entityId } : {}),
      ...(options.action ? { action: { startsWith: options.action } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: options.take ?? 100,
  });

  // `AuditLog.actorId` has no foreign key — an actor may be a system process,
  // and an entry must survive the user being deleted. Resolve names separately
  // and fall back to the raw id.
  const actorIds = [
    ...new Set(
      entries.map((e) => e.actorId).filter((id): id is string => !!id),
    ),
  ];
  const actors = actorIds.length
    ? await client.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, username: true },
      })
    : [];
  const usernameById = new Map(actors.map((a) => [a.id, a.username]));

  return entries.map((entry) => ({
    id: entry.id,
    actorId: entry.actorId,
    actorUsername: entry.actorId
      ? (usernameById.get(entry.actorId) ?? null)
      : null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before,
    after: entry.after,
    createdAt: entry.createdAt,
  }));
}

export interface PlatformStats {
  users: number;
  admins: number;
  testers: number;
  bots: number;
  tournaments: number;
  activeTournaments: number;
  submissions: number;
  evaluations: number;
}

const ACTIVE_TOURNAMENT_STATUSES = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SIMULATION',
  'SEEDING',
  'BRACKET_GENERATED',
  'LIVE',
] as const;

/**
 * Operator statistics for ONE environment.
 *
 * Scoped, because an unscoped count is a lie in both directions: a rehearsal
 * with five bots would inflate the production tournament count an operator uses
 * to judge real activity, and a test run's submissions would land in the same
 * total as real ones. "Statistics" is named explicitly in the isolation
 * requirement for exactly this reason.
 *
 * People are counted separately from tournaments and never scoped by
 * environment, because a `User` has no environment — it has a role. `users`
 * therefore excludes bots and testers rather than filtering them: an operator
 * asking "how many users do we have?" means humans competing for real, and
 * silently including seven bots in that number is the same class of falsehood.
 */
export async function getPlatformStats(
  scope: EnvironmentScope,
  client: DbClient = db,
): Promise<PlatformStats> {
  const environment = tournamentEnvironmentFilter(scope);

  const [
    users,
    admins,
    testers,
    bots,
    tournaments,
    activeTournaments,
    submissions,
    evaluations,
  ] = await Promise.all([
    client.user.count({ where: { isBot: false, role: 'USER' } }),
    client.user.count({ where: { isBot: false, role: 'ADMIN' } }),
    client.user.count({ where: { isBot: false, role: 'TEST' } }),
    client.user.count({ where: { isBot: true } }),
    client.tournament.count({ where: { ...environment, archivedAt: null } }),
    client.tournament.count({
      where: {
        ...environment,
        archivedAt: null,
        status: { in: [...ACTIVE_TOURNAMENT_STATUSES] },
      },
    }),
    client.submission.count({ where: { tournament: environment } }),
    client.evaluation.count({ where: { tournament: environment } }),
  ]);

  return {
    users,
    admins,
    testers,
    bots,
    tournaments,
    activeTournaments,
    submissions,
    evaluations,
  };
}
