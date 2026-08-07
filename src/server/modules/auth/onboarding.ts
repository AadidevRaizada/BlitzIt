import 'server-only';
import { db } from '@/server/db';
import type { DbClient } from '@/server/modules/admin/audit';
import {
  acceptTerms,
  hasAcceptedCurrentTerms,
} from '@/server/modules/compliance';
import { ConflictError, ValidationError } from '@/lib/errors';
import type { OnboardingData } from '@/lib/validation/onboarding.schema';

const UNIQUE_VIOLATION = 'P2002';
const GITHUB_USER_API = 'https://api.github.com/user';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

export interface OnboardingState {
  completed: boolean;
  profile: {
    username: string;
    displayName: string;
    city: string;
    githubUsername: string | null;
  };
  githubLinked: boolean;
  termsAccepted: boolean;
}

export async function getOnboardingState(
  userId: string,
  client: DbClient = db,
): Promise<OnboardingState> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      authUserId: true,
      username: true,
      displayName: true,
      city: true,
      onboardingCompletedAt: true,
      profile: { select: { githubUsername: true } },
    },
  });
  if (!user) throw new ValidationError('User not found');

  const [githubAccount, termsAccepted] = await Promise.all([
    client.authAccount.findFirst({
      where: { userId: user.authUserId, providerId: 'github' },
      select: { id: true },
    }),
    hasAcceptedCurrentTerms(userId, client),
  ]);

  return {
    completed: user.onboardingCompletedAt !== null,
    profile: {
      username: user.username,
      displayName: user.displayName ?? '',
      city: user.city ?? '',
      githubUsername: user.profile?.githubUsername ?? null,
    },
    githubLinked: githubAccount !== null,
    termsAccepted,
  };
}

async function resolveLinkedGitHubLogin(
  authUserId: string,
  client: DbClient,
): Promise<string> {
  const account = await client.authAccount.findFirst({
    where: { userId: authUserId, providerId: 'github' },
    select: { accessToken: true },
  });

  if (!account) {
    throw new ValidationError('Link GitHub before continuing.');
  }
  if (!account.accessToken) {
    throw new ValidationError('GitHub needs to be linked again.');
  }

  const response = await fetch(GITHUB_USER_API, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${account.accessToken}`,
      'user-agent': 'BlitzIt-Onboarding/1.0',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new ValidationError('GitHub could not confirm your linked account.');
  }

  const body = (await response.json()) as { login?: unknown };
  if (typeof body.login !== 'string' || body.login.trim().length === 0) {
    throw new ValidationError('GitHub did not return a username.');
  }
  return body.login.trim();
}

export async function completeOnboarding(
  userId: string,
  data: OnboardingData,
): Promise<{ username: string }> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, authUserId: true },
    });
    if (!user) throw new ValidationError('User not found');

    const githubUsername = await resolveLinkedGitHubLogin(user.authUserId, db);

    return await db.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          username: data.username,
          displayName: data.displayName,
          city: data.city,
          onboardingCompletedAt: new Date(),
        },
        select: { username: true },
      });

      await tx.profile.upsert({
        where: { userId },
        create: { userId, githubUsername },
        update: { githubUsername },
      });

      await acceptTerms({ userId }, tx);
      return updated;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('That username is already taken');
    }
    throw error;
  }
}

export async function assertOnboardingComplete(
  userId: string,
  client: DbClient = db,
): Promise<void> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { onboardingCompletedAt: true, city: true },
  });
  if (!user?.onboardingCompletedAt || !user.city) {
    throw new ValidationError(
      'Complete onboarding and add your city before continuing.',
    );
  }
}
