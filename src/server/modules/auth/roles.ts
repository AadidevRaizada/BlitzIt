import type { Role, User } from '@/generated/prisma/client';

/**
 * Pure role predicates — no Next.js or database coupling, so they are trivially
 * unit-testable and usable from scripts. Guards that redirect live in
 * `session.ts`; this file only answers "is this allowed?".
 */

export function isAdmin(user: Pick<User, 'role'>): boolean {
  return user.role === 'ADMIN';
}

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
