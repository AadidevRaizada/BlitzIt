import './load-env';
import {
  assertRepoOwnedAndPublic,
  listPublicRepos,
} from '../src/server/modules/github/repos';
import { AppError } from '../src/lib/errors';

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

async function rejects(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, 'was accepted');
  } catch (error) {
    check(
      label,
      error instanceof AppError && error.code === 'VALIDATION',
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function main() {
  const repos = await listPublicRepos('vercel', { refresh: true });
  check(
    'listPublicRepos returns owned public repos',
    repos.some((repo) => repo.fullName.toLowerCase() === 'vercel/next.js'),
    `returned ${repos.length} repos`,
  );

  await assertRepoOwnedAndPublic({
    repoUrl: 'https://github.com/vercel/next.js',
    githubUsername: 'vercel',
  });
  check('owned public repo is accepted', true);

  await rejects('unowned repo is rejected', () =>
    assertRepoOwnedAndPublic({
      repoUrl: 'https://github.com/vercel/next.js',
      githubUsername: 'facebook',
    }),
  );

  await rejects('private or missing repo is rejected', () =>
    assertRepoOwnedAndPublic({
      repoUrl: 'https://github.com/vercel/not-a-real-private-test-repo',
      githubUsername: 'vercel',
    }),
  );

  console.log(
    failures === 0
      ? '\nGitHub repo verification passed.'
      : `\n${failures} check(s) FAILED.`,
  );
}

main()
  .catch((error) => {
    console.error('\nFAIL', error);
    failures++;
  })
  .finally(() => process.exit(failures > 0 ? 1 : 0));
