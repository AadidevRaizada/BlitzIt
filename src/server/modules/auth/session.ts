import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/server/auth';
import { db } from '@/server/db';
import type { User } from '@/generated/prisma/client';
import { ForbiddenError, UnauthorizedError } from '@/lib/errors';
import { syncDomainUser } from './sync';
import { isAdmin } from './roles';

export { isAdmin, hasRole, canAccess } from './roles';

/**
 * Session + authorization helpers.
 *
 * Every server-side entry point (RSC, Server Action, Route Handler) derives the
 * caller from here. Never trust a client-supplied user id.
 */

export interface SessionContext {
  /** Better Auth session user id (AuthUser.id). */
  authUserId: string;
  /** Our domain user — the object the rest of the app works with. */
  user: User;
}

/**
 * Current session, or null when signed out.
 *
 * Wrapped in React `cache` so multiple guards in one render/request share a
 * single auth lookup + domain sync instead of re-querying per call.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;

  // Self-healing: if the create-hook failed, this materializes the domain user.
  const user = await syncDomainUser({
    authUserId: session.user.id,
    email: session.user.email,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
  });

  return { authUserId: session.user.id, user };
});

/** Current domain user, or null when signed out. */
export async function getCurrentUser(): Promise<User | null> {
  return (await getSession())?.user ?? null;
}

/**
 * Require an authenticated user, redirecting to login otherwise.
 * Use in layouts/pages. `callbackURL` returns the user where they intended.
 */
export async function requireUser(callbackURL?: string): Promise<User> {
  const session = await getSession();
  if (!session) {
    const target = callbackURL
      ? `/login?callbackURL=${encodeURIComponent(callbackURL)}`
      : '/login';
    redirect(target);
  }
  return session.user;
}

/** Require an ADMIN user, redirecting non-admins to the dashboard. */
export async function requireAdmin(callbackURL?: string): Promise<User> {
  const user = await requireUser(callbackURL);
  if (!isAdmin(user)) {
    redirect('/dashboard?error=forbidden');
  }
  return user;
}

/**
 * Server Action / Route Handler variants: throw typed errors instead of
 * redirecting, so callers can return a `Result` to the client.
 */
export async function requireUserOrThrow(): Promise<User> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError('You must be signed in');
  return session.user;
}

export async function requireAdminOrThrow(): Promise<User> {
  const user = await requireUserOrThrow();
  if (!isAdmin(user)) throw new ForbiddenError('Admin access required');
  return user;
}

/** Look up a public profile by username (used by the public profile page). */
export async function getUserByUsername(username: string) {
  return db.user.findUnique({
    where: { username },
    include: { profile: true },
  });
}
