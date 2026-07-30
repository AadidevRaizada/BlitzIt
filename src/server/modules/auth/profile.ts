import 'server-only';
import { db } from '@/server/db';
import type { User } from '@/generated/prisma/client';
import { ConflictError } from '@/lib/errors';
import type { UpdateProfileData } from '@/lib/validation/profile.schema';

/** Profile read/write for the domain user. */

const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export async function getProfileByUsername(username: string) {
  return db.user.findUnique({
    where: { username },
    select: {
      id: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      city: true,
      country: true,
      createdAt: true,
      // Selected so the public profile page can refuse a bot. This page is keyed
      // by username, which makes it the one public surface the environment
      // filter cannot reach.
      isBot: true,
      profile: {
        select: {
          bio: true,
          githubUsername: true,
          websiteUrl: true,
          twitterHandle: true,
        },
      },
    },
  });
}

export async function getEditableProfile(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      username: true,
      displayName: true,
      city: true,
      profile: {
        select: {
          bio: true,
          githubUsername: true,
          websiteUrl: true,
          twitterHandle: true,
        },
      },
    },
  });
}

/**
 * Update the caller's own User + Profile in one transaction.
 * `userId` always comes from the session — never from client input.
 */
export async function updateProfile(
  userId: string,
  data: UpdateProfileData,
): Promise<User> {
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          username: data.username,
          displayName: data.displayName,
          city: data.city ?? null,
        },
      });

      // upsert: a profile should always exist, but never fail if it doesn't.
      await tx.profile.upsert({
        where: { userId },
        create: {
          userId,
          bio: data.bio ?? null,
          githubUsername: data.githubUsername ?? null,
          websiteUrl: data.websiteUrl ?? null,
          twitterHandle: data.twitterHandle ?? null,
        },
        update: {
          bio: data.bio ?? null,
          githubUsername: data.githubUsername ?? null,
          websiteUrl: data.websiteUrl ?? null,
          twitterHandle: data.twitterHandle ?? null,
        },
      });

      return user;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('That username is already taken');
    }
    throw error;
  }
}
