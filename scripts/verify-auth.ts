import './load-env';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { db } from '../src/server/db';
import {
  syncDomainUser,
  ensureProfile,
  slugifyUsername,
} from '../src/server/modules/auth/sync';
import { isAdmin, hasRole, canAccess } from '../src/server/modules/auth/roles';
import { updateProfile } from '../src/server/modules/auth/profile';
import { updateProfileSchema } from '../src/lib/validation/profile.schema';

/**
 * Epic E1 acceptance checks for domain user mapping + role handling.
 *
 * Exercises the same `syncDomainUser` the Better Auth create-hook and the
 * session helper call, so the sign-in path is covered without needing live
 * OAuth credentials (the OAuth redirect itself is verified manually).
 *
 * Run: npm run verify:auth   (requires DATABASE_URL + `prisma db push`)
 */

let failures = 0;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) failures++;
}

async function main() {
  const run = Date.now();
  const authId = `auth-${run}`;
  const email = `tester-${run}@blitzit.test`;

  await db.user.deleteMany({ where: { email: { contains: '@blitzit.test' } } });

  // 1. First sign-in creates User + Profile
  const first = await syncDomainUser({
    authUserId: authId,
    email,
    name: 'Ada Lovelace',
    image: 'https://example.com/a.png',
  });
  const profile = await db.profile.findUnique({ where: { userId: first.id } });
  check('first sign-in creates domain User', Boolean(first.id));
  check('first sign-in creates Profile', Boolean(profile));
  check(
    'username generated from provider name',
    first.username === 'ada-lovelace',
  );
  check(
    'displayName seeded from provider',
    first.displayName === 'Ada Lovelace',
  );
  check('default role is USER', first.role === 'USER');

  // 2. Repeated sign-in reuses the same records (idempotent)
  const second = await syncDomainUser({
    authUserId: authId,
    email,
    name: 'Ada Lovelace',
    image: 'https://example.com/a.png',
  });
  const userCount = await db.user.count({ where: { authUserId: authId } });
  const profileCount = await db.profile.count({ where: { userId: first.id } });
  check('repeat sign-in reuses the same User row', second.id === first.id);
  check('repeat sign-in creates no duplicate User', userCount === 1);
  check('repeat sign-in creates no duplicate Profile', profileCount === 1);

  // 3. Concurrent first sign-ins collapse to one row (race safety)
  const raceAuthId = `auth-race-${run}`;
  const raceEmail = `race-${run}@blitzit.test`;
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      syncDomainUser({
        authUserId: raceAuthId,
        email: raceEmail,
        name: 'Race Condition',
        image: null,
      }).catch((e) => e as Error),
    ),
  );
  const raceRows = await db.user.count({ where: { authUserId: raceAuthId } });
  const raceErrors = results.filter((r) => r instanceof Error);
  check('concurrent first sign-ins create exactly one User', raceRows === 1);
  check('concurrent first sign-ins do not error', raceErrors.length === 0);

  // 4. Username collision gets a distinct username
  const collide = await syncDomainUser({
    authUserId: `auth-collide-${run}`,
    email: `collide-${run}@blitzit.test`,
    name: 'Ada Lovelace', // same stem as user #1
    image: null,
  });
  check(
    'colliding username is made unique',
    collide.username !== first.username &&
      collide.username.startsWith('ada-lovelace'),
  );

  // 5. Provider-owned fields refresh; user-edited fields are preserved
  await db.user.update({
    where: { id: first.id },
    data: { displayName: 'Edited By User' },
  });
  const refreshed = await syncDomainUser({
    authUserId: authId,
    email,
    name: 'Ada Lovelace',
    image: 'https://example.com/NEW.png',
  });
  check(
    'avatar refreshes from provider',
    refreshed.avatarUrl === 'https://example.com/NEW.png',
  );
  check(
    'user-edited displayName is not overwritten by sign-in',
    refreshed.displayName === 'Edited By User',
  );

  // 6. Role helpers
  const adminUser = { ...first, role: 'ADMIN' as const };
  check('isAdmin() true for ADMIN', isAdmin(adminUser));
  check('isAdmin() false for USER', !isAdmin(first));
  check(
    'hasRole() matches',
    hasRole(first, 'USER') && !hasRole(first, 'ADMIN'),
  );
  check('canAccess(): owner allowed', canAccess(first, first.id));
  check('canAccess(): stranger denied', !canAccess(first, 'someone-else'));
  check('canAccess(): admin allowed', canAccess(adminUser, 'someone-else'));

  // 7. ensureProfile is a safe no-op when a profile exists
  await ensureProfile(first.id);
  check(
    'ensureProfile does not duplicate',
    (await db.profile.count({ where: { userId: first.id } })) === 1,
  );

  // 8. Profile update + validation
  const parsed = updateProfileSchema.safeParse({
    username: 'ada-blitz',
    displayName: 'Ada B',
    bio: '  hello  ',
    city: '',
    githubUsername: 'ada',
    twitterHandle: '',
    websiteUrl: 'https://ada.dev',
  });
  check('valid profile input parses', parsed.success);
  if (parsed.success) {
    const updated = await updateProfile(first.id, parsed.data);
    const p = await db.profile.findUnique({ where: { userId: first.id } });
    check('updateProfile writes username', updated.username === 'ada-blitz');
    check('bio is trimmed', p?.bio === 'hello');
    check('empty optional becomes null', p?.twitterHandle === null);
  }

  check(
    'invalid username rejected',
    !updateProfileSchema.safeParse({
      username: 'Bad Username!',
      displayName: 'x',
    }).success,
  );
  check(
    'non-http website rejected',
    !updateProfileSchema.safeParse({
      username: 'ok-name',
      displayName: 'x',
      websiteUrl: 'javascript:alert(1)',
    }).success,
  );

  // 9. Duplicate username is rejected with a typed ConflictError
  const other = await syncDomainUser({
    authUserId: `auth-other-${run}`,
    email: `other-${run}@blitzit.test`,
    name: 'Other Person',
    image: null,
  });
  const conflict = await updateProfile(other.id, {
    username: 'ada-blitz', // taken by `first`
    displayName: 'Other',
    bio: null,
    city: null,
    githubUsername: null,
    twitterHandle: null,
    websiteUrl: null,
  }).catch((e: unknown) => e);
  check(
    'duplicate username raises ConflictError',
    conflict instanceof Error && conflict.name === 'ConflictError',
  );

  // 10. slugify edge cases
  check(
    'slugify strips punctuation',
    slugifyUsername('Ada!! Lovelace') === 'ada-lovelace',
  );
  check(
    'slugify falls back for short input',
    slugifyUsername('!') === 'player',
  );

  // 11. Better Auth's Prisma adapter must resolve our namespaced Auth* models.
  //     Uses the SAME modelName mapping as src/server/auth.ts, so a future
  //     adapter change that broke the mapping would fail here rather than at
  //     the first real sign-in.
  const adapterAuth = betterAuth({
    database: prismaAdapter(db, { provider: 'postgresql' }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
    user: { modelName: 'AuthUser' },
    session: { modelName: 'AuthSession' },
    account: { modelName: 'AuthAccount' },
    verification: { modelName: 'AuthVerification' },
    emailAndPassword: { enabled: true },
  });

  const adapterEmail = `adapter-${run}@blitzit.test`;
  const signUp = await adapterAuth.api.signUpEmail({
    body: {
      email: adapterEmail,
      password: 'probe-password-12345',
      name: 'Probe',
    },
    asResponse: true,
  });
  check(
    'Better Auth adapter resolves the Auth* models (sign-up succeeds)',
    signUp.status === 200,
  );
  check(
    'Better Auth issues a session cookie',
    Boolean(signUp.headers.get('set-cookie')),
  );
  const authRows: Array<{ n: bigint }> = await db.$queryRawUnsafe(
    `SELECT count(*) AS n FROM auth_user WHERE email = $1`,
    adapterEmail,
  );
  check(
    'Better Auth wrote to the auth_user table',
    Number(authRows[0]?.n ?? 0) === 1,
  );

  await db.user.deleteMany({ where: { email: { contains: '@blitzit.test' } } });
  await db.$executeRawUnsafe(
    `DELETE FROM auth_user WHERE email LIKE '%@blitzit.test'`,
  );

  console.log(
    failures === 0
      ? '\nAll auth checks passed.'
      : `\n${failures} check(s) FAILED.`,
  );
}

main()
  .catch((e) => {
    console.error('\nFAIL —', e);
    failures++;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit(failures > 0 ? 1 : 0);
  });
