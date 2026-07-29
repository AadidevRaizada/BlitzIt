import type { Role, User } from '@/generated/prisma/client';

/**
 * Pure role predicates — no Next.js or database coupling, so they are trivially
 * unit-testable and usable from scripts. Guards that redirect live in
 * `session.ts`; this file only answers "is this allowed?".
 */

export function isAdmin(user: Pick<User, 'role'>): boolean {
  return user.role === 'ADMIN';
}

/**
 * The actor for work the platform does to itself (D34) — auto-cancellation
 * refunds, auto-archival. Not a `User` row and deliberately not one: nobody can
 * sign in as it, and it exists only to satisfy the admin-gated module functions
 * that automation legitimately needs to call.
 *
 * Safe to write to audit trails: `AuditLog.actorId` and `OpsEvent.runBy` are
 * both plain nullable strings with no foreign key to `User`, so this id lands in
 * the log as an origin marker. The `system:` prefix keeps it impossible to
 * confuse with a real uuid actor when reading an audit row.
 */
export const AUTOMATION_ACTOR = {
  id: 'system:automation',
  role: 'ADMIN',
} as const satisfies Pick<User, 'id' | 'role'>;

export function hasRole(user: Pick<User, 'role'>, role: Role): boolean {
  return user.role === role;
}

/** True when the user owns the resource, or is an admin. */
export function canAccess(
  user: Pick<User, 'id' | 'role'>,
  ownerId: string,
): boolean {
  return user.id === ownerId || isAdmin(user);
}
