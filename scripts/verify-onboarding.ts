import './load-env';
import { randomUUID } from 'node:crypto';
import { db } from '../src/server/db';
import {
  assertOnboardingComplete,
  completeOnboarding,
  getOnboardingState,
} from '../src/server/modules/auth/onboarding';
import { acceptTerms } from '../src/server/modules/compliance';
import { AppError } from '../src/lib/errors';

let failures = 0;
const TAG = `onboarding-${Date.now()}`;

function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

async function cleanup() {
  await db.auditLog.deleteMany({
    where: { actorId: { in: await userIds() } },
  });
  await db.termsAcceptance.deleteMany({
    where: { user: { email: { contains: TAG } } },
  });
  await db.authAccount.deleteMany({
    where: { user: { email: { contains: TAG } } },
  });
  await db.authUser.deleteMany({ where: { email: { contains: TAG } } });
  await db.user.deleteMany({ where: { email: { contains: TAG } } });
}

async function userIds() {
  const users = await db.user.findMany({
    where: { email: { contains: TAG } },
    select: { id: true },
  });
  return users.map((user) => user.id);
}

async function createDomainUser(name: string) {
  const authUser = await db.authUser.create({
    data: {
      email: `${name}@${TAG}.test`,
      name,
      emailVerified: true,
    },
  });
  const user = await db.user.create({
    data: {
      authUserId: authUser.id,
      email: authUser.email,
      username: `${name}-${randomUUID().slice(0, 8)}`,
      displayName: name,
      profile: { create: {} },
    },
  });
  return { authUser, user };
}

async function main() {
  await cleanup();

  const incomplete = await createDomainUser('incomplete');
  const state = await getOnboardingState(incomplete.user.id);
  check('new user starts incomplete', !state.completed);

  try {
    await assertOnboardingComplete(incomplete.user.id);
    check('incomplete user is blocked by the gate', false, 'was accepted');
  } catch (error) {
    check(
      'incomplete user is blocked by the gate',
      error instanceof AppError && error.code === 'VALIDATION',
      error instanceof Error ? error.message : String(error),
    );
  }

  const token =
    process.env.GITHUB_ONBOARDING_TEST_TOKEN ?? process.env.GITHUB_API_TOKEN;
  if (token) {
    await db.authAccount.create({
      data: {
        userId: incomplete.authUser.id,
        providerId: 'github',
        accountId: `github-${TAG}`,
        accessToken: token,
      },
    });
    const result = await completeOnboarding(incomplete.user.id, {
      username: `ready-${randomUUID().slice(0, 8)}`,
      displayName: 'Ready Player',
      city: 'Bengaluru',
      termsAccepted: true,
    });
    const completed = await getOnboardingState(incomplete.user.id);
    check(
      'completeOnboarding writes the user identity',
      Boolean(result.username),
    );
    check(
      'completeOnboarding stores terms acceptance',
      completed.termsAccepted,
    );
    check(
      'completeOnboarding stores GitHub username',
      completed.profile.githubUsername !== null,
    );
    await assertOnboardingComplete(incomplete.user.id);
    check('completed user passes the gate', true);
  } else {
    console.log(
      'SKIP  live completeOnboarding path needs GITHUB_ONBOARDING_TEST_TOKEN or GITHUB_API_TOKEN',
    );
  }

  const backfilled = await createDomainUser('backfilled');
  await db.user.update({
    where: { id: backfilled.user.id },
    data: { city: 'Bengaluru', onboardingCompletedAt: new Date() },
  });
  await db.profile.update({
    where: { userId: backfilled.user.id },
    data: { githubUsername: 'vercel' },
  });
  await acceptTerms({ userId: backfilled.user.id });
  await assertOnboardingComplete(backfilled.user.id);
  check('existing complete user is not blocked', true);

  await cleanup();
  console.log(
    failures === 0
      ? '\nOnboarding verification passed.'
      : `\n${failures} check(s) FAILED.`,
  );
}

main()
  .catch(async (error) => {
    console.error('\nFAIL', error);
    failures++;
    await cleanup().catch(() => {});
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(failures > 0 ? 1 : 0);
  });
