import 'server-only';
import { randomBytes } from 'node:crypto';
import { db } from '@/server/db';
import type { User } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';

/**
 * Mirrors a Better Auth user into our domain `User` + `Profile`.
 *
 * Invariants:
 *  - Idempotent: repeated sign-ins never create duplicate rows (keyed on the
 *    unique `authUserId`).
 *  - Race-safe: concurrent first sign-ins collapse via the unique constraint;
 *    a P2002 conflict is resolved by re-reading the winner's row.
 *  - Non-destructive: fields the user can edit (displayName, username, city…)
 *    are seeded on create and never overwritten by a later sign-in. Only
 *    provider-authoritative fields (email, avatarUrl) are refreshed.
 */

const UNIQUE_VIOLATION = 'P2002';
const USERNAME_MAX = 24;
const USERNAME_MIN = 3;
const MAX_USERNAME_ATTEMPTS = 10;

export interface AuthUserInput {
  authUserId: string;
  email: string;
  name?: string | null;
  image?: string | null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/** Provider display name or email local-part → a safe username stem. */
export function slugifyUsername(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, USERNAME_MAX);

  return slug.length >= USERNAME_MIN ? slug : 'player';
}

/**
 * Find an unused username. Best-effort only — the unique index is the real
 * guarantee, and the caller retries on conflict.
 */
async function allocateUsername(base: string): Promise<string> {
  for (let attempt = 0; attempt < MAX_USERNAME_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await db.user.findUnique({
      where: { username: candidate },
      select: { id: true },
    });
    if (!taken) return candidate;
  }
  // Crowded stem — fall back to a random suffix.
  return `${base}-${randomBytes(3).toString('hex')}`;
}

async function createDomainUser(input: AuthUserInput): Promise<User> {
  const stem = slugifyUsername(
    input.name?.trim() || input.email.split('@')[0] || 'player',
  );
  const username = await allocateUsername(stem);

  // User + Profile are created together so a domain user always has a profile.
  return db.user.create({
    data: {
      authUserId: input.authUserId,
      email: input.email,
      username,
      displayName: input.name?.trim() || username,
      avatarUrl: input.image ?? null,
      profile: { create: {} },
    },
  });
}

/**
 * Create-or-refresh the domain user for a Better Auth user. Safe to call on
 * every request; returns the canonical domain `User`.
 */
export async function syncDomainUser(input: AuthUserInput): Promise<User> {
  const existing = await db.user.findUnique({
    where: { authUserId: input.authUserId },
  });

  if (existing) {
    // Only refresh what the provider owns; never clobber user edits.
    const needsUpdate =
      existing.email !== input.email ||
      existing.avatarUrl !== (input.image ?? null);

    if (!needsUpdate) return existing;

    try {
      return await db.user.update({
        where: { id: existing.id },
        data: { email: input.email, avatarUrl: input.image ?? null },
      });
    } catch (error) {
      // Another account already owns this email — keep the existing row rather
      // than failing the request.
      if (isUniqueViolation(error)) {
        logger.warn(
          { authUserId: input.authUserId },
          'email already in use by another domain user; skipping refresh',
        );
        return existing;
      }
      throw error;
    }
  }

  try {
    return await createDomainUser(input);
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Concurrent first sign-in (or a username collision) — re-read the winner.
      const winner = await db.user.findUnique({
        where: { authUserId: input.authUserId },
      });
      if (winner) return winner;

      // Username collided rather than authUserId: retry once with a random stem.
      const stem = slugifyUsername(
        input.name?.trim() || input.email.split('@')[0] || 'player',
      );
      return db.user.create({
        data: {
          authUserId: input.authUserId,
          email: input.email,
          username: `${stem}-${randomBytes(3).toString('hex')}`,
          displayName: input.name?.trim() || stem,
          avatarUrl: input.image ?? null,
          profile: { create: {} },
        },
      });
    }
    throw error;
  }
}

/**
 * Guarantee the domain user has a Profile. Cheap safety net for rows created
 * before the profile write, or by an admin script.
 */
export async function ensureProfile(userId: string): Promise<void> {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (profile) return;

  try {
    await db.profile.create({ data: { userId } });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}
