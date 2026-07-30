import 'server-only';
import type { Role } from '@/generated/prisma/client';
import { db } from '@/server/db';
import { isAdmin } from '@/server/modules/auth/roles';
import {
  tournamentEnvironmentFilter,
  type EnvironmentScope,
} from '@/server/modules/tournament/environment.public';
import { ForbiddenError } from '@/lib/errors';
import type { DbClient } from './audit';

/**
 * Read-only operator directory (E5): users and the audit trail.
 *
 * Deliberately read-only. Changing a user's role, or editing the audit log, are
 * not operations this epic exposes — the audit trail is append-only by design,
 * and role changes stay with the `make:admin` script until there is a reviewed
 * flow for them.
 */

export interface UserRow {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  role: Role;
  city: string | null;
  createdAt: Date;
  registrations: number;
  submissions: number;
}

export async function listUsers(
  admin: { id: string; role: Role },
  options: { search?: string; take?: number } = {},
  client: DbClient = db,
): Promise<UserRow[]> {
  if (!isAdmin(admin)) throw new ForbiddenError('Admin access required');

  const search = options.search?.trim();
  const users = await client.user.findMany({
    where: search
      ? {
          OR: [
            { username: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { displayName: { contains: search, mode: 'insensitive' } },
          ],
        }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: options.take ?? 100,
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      role: true,
      city: true,
      createdAt: true,
      _count: { select: { registrations: true, submissions: true } },
    },
  });

  return users.map((user) => ({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    city: user.city,
    createdAt: user.createdAt,
    registrations: user._count.registrations,
    submissions: user._count.submissions,
  }));
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
