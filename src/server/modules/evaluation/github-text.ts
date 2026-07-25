import 'server-only';
import { logger } from '@/lib/logger';

/**
 * Read a competitor's repository as TEXT via the GitHub API (D1).
 *
 * We never clone, install or build. Files are fetched through the API, capped
 * hard in count and size, and only source-like extensions are considered. The
 * result feeds the LLM quality pass and is stored as audit evidence.
 *
 * V1 requires PUBLIC repositories (D16), so no user token is needed; an
 * optional `GITHUB_API_TOKEN` only raises the rate limit.
 */

const GITHUB_API = 'https://api.github.com';
const MAX_FILES = 40;
const MAX_FILE_BYTES = 60_000;
const MAX_TOTAL_BYTES = 400_000;
const REQUEST_TIMEOUT_MS = 15_000;

/** Extensions worth reading for a quality review. */
const SOURCE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'go',
  'rs',
  'rb',
  'java',
  'kt',
  'cs',
  'php',
  'swift',
  'sql',
  'prisma',
  'graphql',
  'css',
  'scss',
  'html',
  'vue',
  'svelte',
  'md',
  'json',
  'yml',
  'yaml',
  'toml',
]);

/** Never worth reading — lockfiles, builds, vendored deps, binaries. */
const IGNORED_PATH = [
  /(^|\/)node_modules\//,
  /(^|\/)\.git\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)vendor\//,
  /(^|\/)__pycache__\//,
  /(^|\/)target\//,
  /(^|\/)coverage\//,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /poetry\.lock$/,
  /Cargo\.lock$/,
  /\.min\.(js|css)$/,
  /\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|pdf|zip|mp4)$/i,
];

/** Files that most inform an architecture/quality judgement, read first. */
const PRIORITY_PATTERNS = [
  /^readme\.md$/i,
  /^package\.json$/,
  /^(src\/)?(index|main|app)\.[jt]sx?$/,
  /^(src\/)?app\//,
  /^(src\/)?routes?\//,
  /^(src\/)?server\//,
  /^(src\/)?lib\//,
  /^prisma\/schema\.prisma$/,
  /^(src\/)?models?\//,
  /^(src\/)?api\//,
];

export interface RepoFile {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
}

export interface RepoSnapshot {
  owner: string;
  repo: string;
  ref: string;
  /** Commit the snapshot was taken at — pins the evaluation (D19). */
  commitSha: string | null;
  files: RepoFile[];
  totalFiles: number;
  readFiles: number;
  totalBytes: number;
  /** Non-fatal problems (rate limit, missing repo) — evaluation still proceeds. */
  warnings: string[];
}

export class InvalidRepoUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRepoUrlError';
  }
}

/** Parse `https://github.com/owner/repo(.git)` into its parts. */
export function parseRepoUrl(rawUrl: string): { owner: string; repo: string } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new InvalidRepoUrlError('Repository URL is not a valid URL');
  }

  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    throw new InvalidRepoUrlError('Only github.com repositories are supported');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const owner = segments[0];
  const repoRaw = segments[1];
  if (!owner || !repoRaw) {
    throw new InvalidRepoUrlError(
      'Repository URL must be github.com/owner/repo',
    );
  }

  return { owner, repo: repoRaw.replace(/\.git$/, '') };
}

function authHeaders(): Record<string, string> {
  const token = process.env.GITHUB_API_TOKEN;
  return {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'BlitzIt-Evaluator/1.0',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function githubJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${GITHUB_API}${path}`, {
      headers: authHeaders(),
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} for ${path}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function isReadable(path: string): boolean {
  if (IGNORED_PATH.some((pattern) => pattern.test(path))) return false;
  const ext = path.split('.').pop()?.toLowerCase();
  return Boolean(ext && SOURCE_EXTENSIONS.has(ext));
}

function priorityOf(path: string): number {
  const index = PRIORITY_PATTERNS.findIndex((p) => p.test(path));
  return index === -1 ? PRIORITY_PATTERNS.length : index;
}

/**
 * Fetch a bounded, source-only text snapshot of a public repository.
 * Never throws for a missing/rate-limited repo — returns an empty snapshot with
 * a warning so the rest of the evaluation still produces a score.
 */
export async function readRepoAsText(
  repoUrl: string,
  commitSha?: string | null,
): Promise<RepoSnapshot> {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const warnings: string[] = [];

  const empty: RepoSnapshot = {
    owner,
    repo,
    ref: commitSha ?? 'HEAD',
    commitSha: commitSha ?? null,
    files: [],
    totalFiles: 0,
    readFiles: 0,
    totalBytes: 0,
    warnings,
  };

  // Resolve the ref so the snapshot is pinned to an immutable commit.
  let ref = commitSha ?? '';
  let resolvedSha: string | null = commitSha ?? null;
  if (!ref) {
    try {
      const meta = await githubJson<{ default_branch: string }>(
        `/repos/${owner}/${repo}`,
      );
      ref = meta.default_branch;
      const branch = await githubJson<{ commit: { sha: string } }>(
        `/repos/${owner}/${repo}/branches/${encodeURIComponent(ref)}`,
      );
      resolvedSha = branch.commit.sha;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      warnings.push(`Could not resolve repository: ${message}`);
      logger.warn({ owner, repo, message }, 'repo metadata unavailable');
      return empty;
    }
  }

  let tree: { tree: Array<{ path: string; type: string; size?: number }> };
  try {
    tree = await githubJson(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(resolvedSha ?? ref)}?recursive=1`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    warnings.push(`Could not list repository tree: ${message}`);
    return { ...empty, ref, commitSha: resolvedSha };
  }

  const blobs = tree.tree.filter((entry) => entry.type === 'blob');
  const candidates = blobs
    .filter((entry) => isReadable(entry.path))
    .sort(
      (a, b) =>
        priorityOf(a.path) - priorityOf(b.path) || a.path.localeCompare(b.path),
    )
    .slice(0, MAX_FILES);

  const files: RepoFile[] = [];
  let totalBytes = 0;

  for (const entry of candidates) {
    if (totalBytes >= MAX_TOTAL_BYTES) {
      warnings.push('Total size cap reached; remaining files were skipped');
      break;
    }
    if ((entry.size ?? 0) > MAX_FILE_BYTES) continue;

    try {
      const raw = await fetchRawFile(
        owner,
        repo,
        resolvedSha ?? ref,
        entry.path,
      );
      if (raw === null) continue;
      const capped = raw.slice(0, MAX_FILE_BYTES);
      files.push({
        path: entry.path,
        content: capped,
        bytes: capped.length,
        truncated: capped.length < raw.length,
      });
      totalBytes += capped.length;
    } catch {
      // A single unreadable file must not fail the evaluation.
      continue;
    }
  }

  return {
    owner,
    repo,
    ref,
    commitSha: resolvedSha,
    files,
    totalFiles: blobs.length,
    readFiles: files.length,
    totalBytes,
    warnings,
  };
}

async function fetchRawFile(
  owner: string,
  repo: string,
  ref: string,
  path: string,
): Promise<string | null> {
  const contents = await githubJson<{
    content?: string;
    encoding?: string;
    size?: number;
  }>(
    `/repos/${owner}/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
  );

  if (!contents.content || contents.encoding !== 'base64') return null;
  const decoded = Buffer.from(contents.content, 'base64').toString('utf8');
  // Skip anything binary that slipped past the extension filter (NUL byte).
  if (decoded.includes(' ')) return null;
  return decoded;
}
