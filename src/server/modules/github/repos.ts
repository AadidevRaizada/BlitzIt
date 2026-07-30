import 'server-only';
import { db } from '@/server/db';
import {
  authHeaders,
  parseRepoUrl,
} from '@/server/modules/evaluation/github-text';
import { ValidationError } from '@/lib/errors';

const GITHUB_API = 'https://api.github.com';
const CACHE_TTL_MS = 2 * 60 * 1000;

export interface PublicRepoOption {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  pushedAt: string | null;
  description: string | null;
}

interface CacheEntry {
  expiresAt: number;
  repos: PublicRepoOption[];
}

const cache = new Map<string, CacheEntry>();

function normalizedLogin(login: string): string {
  return login.trim().toLowerCase();
}

export async function listPublicRepos(
  login: string,
  options: { refresh?: boolean } = {},
): Promise<PublicRepoOption[]> {
  const key = normalizedLogin(login);
  if (!key) return [];

  const cached = cache.get(key);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) {
    return cached.repos;
  }

  const response = await fetch(
    `${GITHUB_API}/users/${encodeURIComponent(key)}/repos?type=owner&sort=updated&per_page=100`,
    {
      headers: authHeaders(),
      cache: 'no-store',
    },
  );

  if (!response.ok) {
    return cached?.repos ?? [];
  }

  const rows = (await response.json()) as Array<{
    id: number;
    name: string;
    full_name: string;
    html_url: string;
    private: boolean;
    fork: boolean;
    pushed_at: string | null;
    description: string | null;
  }>;

  const repos = rows
    .filter((row) => row.private === false)
    .map((row) => ({
      id: row.id,
      name: row.name,
      fullName: row.full_name,
      htmlUrl: row.html_url,
      pushedAt: row.pushed_at,
      description: row.description,
    }));

  cache.set(key, { repos, expiresAt: Date.now() + CACHE_TTL_MS });
  return repos;
}

export async function listPublicReposForUser(
  userId: string,
): Promise<PublicRepoOption[]> {
  const profile = await db.profile.findUnique({
    where: { userId },
    select: { githubUsername: true },
  });
  if (!profile?.githubUsername) return [];
  return listPublicRepos(profile.githubUsername);
}

export async function assertRepoOwnedAndPublic(input: {
  repoUrl: string;
  githubUsername: string | null | undefined;
}): Promise<void> {
  if (!input.githubUsername) {
    throw new ValidationError('Link GitHub before submitting.');
  }

  const { owner, repo } = parseRepoUrl(input.repoUrl);
  if (normalizedLogin(owner) !== normalizedLogin(input.githubUsername)) {
    throw new ValidationError(
      `Repository owner must match your linked GitHub account (${input.githubUsername}).`,
    );
  }

  const response = await fetch(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    {
      headers: authHeaders(),
      cache: 'no-store',
    },
  );

  if (response.status === 404) {
    throw new ValidationError('Repository must be public at submit time.');
  }
  if (!response.ok) {
    throw new ValidationError('GitHub could not verify this repository.');
  }

  const body = (await response.json()) as { private?: unknown; fork?: unknown };
  if (body.private !== false) {
    throw new ValidationError('Repository must be public at submit time.');
  }
}
