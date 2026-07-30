import './load-env';
import { db } from '../src/server/db';

/**
 * Does Better Auth actually persist a usable GitHub identity for our users?
 *
 * Onboarding wants a competitor's GitHub `login` so the repo picker can list
 * their public repositories, and the tempting shortcut is to read it off the
 * stored OAuth token. Two assumptions sit under that: (1) that
 * `AuthAccount.accessToken` is populated for `github`, and (2) that enough
 * users sign in with GitHub for it to matter. The column exists because Better
 * Auth defines it — that is not evidence it is filled, and nothing in this
 * codebase has ever read it.
 *
 * Run this before trusting either assumption. It is READ-ONLY: it aggregates
 * counts and never prints a token.
 *
 * Run: npm run verify:github-identity
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

async function main() {
  const accounts = await db.authAccount.findMany({
    select: { providerId: true, accessToken: true, scope: true },
  });

  const byProvider = new Map<
    string,
    { total: number; withToken: number; withScope: number }
  >();
  for (const account of accounts) {
    const entry = byProvider.get(account.providerId) ?? {
      total: 0,
      withToken: 0,
      withScope: 0,
    };
    entry.total += 1;
    if (account.accessToken) entry.withToken += 1;
    if (account.scope) entry.withScope += 1;
    byProvider.set(account.providerId, entry);
  }

  console.log('\nLinked accounts by provider:');
  if (byProvider.size === 0) {
    console.log('  (none — nobody has signed in against this database)');
  }
  for (const [provider, entry] of [...byProvider].sort()) {
    console.log(
      `  ${provider}: ${entry.total} accounts, ${entry.withToken} with an ` +
        `accessToken, ${entry.withScope} with a scope`,
    );
  }
  console.log('');

  const github = byProvider.get('github');
  const total = accounts.length;

  if (!github || github.total === 0) {
    // An empty or GitHub-less database says nothing either way, and calling
    // that a failure would push the design onto the manual path for the wrong
    // reason.
    console.log(
      'INCONCLUSIVE  no github accounts here — run against a database where a ' +
        'real GitHub sign-in has happened.',
    );
    process.exit(0);
  }

  check(
    'every github account carries an accessToken',
    github.withToken === github.total,
    `${github.withToken}/${github.total} populated`,
  );

  // The finding that actually shapes onboarding. If most competitors arrive
  // through a non-GitHub provider, then deriving the login from a GitHub token
  // is a convenience for a minority and cannot be the only path — the step has
  // to accept a typed username too. Listing PUBLIC repositories needs only
  // that username, never a token, so this costs nothing.
  const share = github.total / total;
  console.log(
    `github is ${github.total}/${total} of linked accounts (${Math.round(share * 100)}%).`,
  );
  if (share < 0.5) {
    console.log(
      '      → most users arrive without a GitHub link. Auto-detection is a ' +
        'convenience; the typed-username path is the primary one.',
    );
  }

  console.log(
    `\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
