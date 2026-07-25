import 'server-only';
import type { ChallengeCategory } from '@/generated/prisma/client';
import {
  parseRepoUrl,
  InvalidRepoUrlError,
  enabledCategories,
} from '@/server/modules/evaluation';
import { ValidationError } from '@/lib/errors';

/**
 * Submission input validation (E4).
 *
 * Runs at submit time, in front of a deadline burst, so it must be **fast and
 * purely syntactic** — no DNS, no HTTP. The real egress defence is the SSRF
 * guard the Evaluation Engine applies at probe time (E2); duplicating it here
 * would double the network cost and still be a TOCTOU check.
 *
 * The repository rules are borrowed from the engine's own `parseRepoUrl` rather
 * than reimplemented. If the two disagreed, we would accept entries at the
 * deadline that the evaluator later refuses to read — the worst possible time
 * to discover it.
 */

/** Anything that clearly cannot be a public deployment we could probe. */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
]);

const BLOCKED_TLDS = [
  '.local',
  '.internal',
  '.localdomain',
  '.invalid',
  '.test',
  '.example',
];

/**
 * Obvious private literals. This is a usability check that gives the competitor
 * a clear error immediately — NOT the security boundary. `assertPublicUrl`
 * (E2) re-resolves and re-validates every address at connect time.
 */
function isObviouslyPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_TLDS.some((tld) => host.endsWith(tld))) return true;

  // IPv4 literals in the private/loopback/link-local/CGNAT ranges.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }

  // IPv6 loopback / link-local / unique-local.
  if (host === '::1' || host === '::') return true;
  if (/^fe[89ab][0-9a-f]/.test(host)) return true;
  if (/^f[cd][0-9a-f]{2}/.test(host)) return true;

  return false;
}

/**
 * Validate the competitor's public GitHub repository URL (D16).
 * Returns the normalised `https://github.com/owner/repo` form so two spellings
 * of the same repository cannot masquerade as different entries.
 */
export function validateRepoUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new ValidationError('A GitHub repository URL is required');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationError('Repository URL is not a valid URL');
  }

  // `parseRepoUrl` checks the host but not the scheme; an `http://` or
  // `ftp://` GitHub URL would slip past it.
  if (url.protocol !== 'https:') {
    throw new ValidationError('Repository URL must use https://');
  }

  try {
    const { owner, repo } = parseRepoUrl(trimmed);
    return `https://github.com/${owner}/${repo}`;
  } catch (error) {
    if (error instanceof InvalidRepoUrlError) {
      throw new ValidationError(error.message);
    }
    throw error;
  }
}

/**
 * Validate the competitor's live deployment URL. Must be an https origin we
 * could plausibly reach from the public internet.
 */
export function validateDeploymentUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new ValidationError('A deployment URL is required');
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationError('Deployment URL is not a valid URL');
  }

  if (url.protocol !== 'https:') {
    throw new ValidationError(
      'Deployment URL must use https:// so the evaluator can reach it securely',
    );
  }
  if (!url.hostname) {
    throw new ValidationError('Deployment URL must include a hostname');
  }
  if (isObviouslyPrivateHost(url.hostname)) {
    throw new ValidationError(
      'Deployment URL must be publicly reachable — private, loopback and local addresses are refused',
    );
  }
  if (url.username || url.password) {
    throw new ValidationError('Deployment URL must not embed credentials');
  }

  // Normalise: keep path (some deployments live under a sub-path), drop the
  // fragment, which is meaningless to a server.
  url.hash = '';
  return url.toString();
}

/** Optional commit SHA pinning (D19). Full 40-char or short 7–40 hex. */
export function validateCommitSha(
  rawSha: string | null | undefined,
): string | null {
  if (rawSha === null || rawSha === undefined) return null;
  const trimmed = rawSha.trim();
  if (!trimmed) return null;
  if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) {
    throw new ValidationError('Commit SHA must be 7–40 hexadecimal characters');
  }
  return trimmed.toLowerCase();
}

/**
 * The problem's category must be one the engine can actually evaluate (D17 —
 * only REST_API is enabled for Week 1). Refusing at submit time gives the
 * competitor an actionable error instead of an entry that dead-letters later.
 */
export function assertCategorySupported(category: ChallengeCategory): void {
  const enabled = enabledCategories();
  if (!enabled.includes(category)) {
    throw new ValidationError(
      `Challenge category ${category} is not currently accepted for evaluation`,
    );
  }
}

export interface ValidatedSubmissionInput {
  repoUrl: string;
  deploymentUrl: string;
  commitSha: string | null;
}

/** Validate and normalise everything a competitor supplies, in one call. */
export function validateSubmissionInput(input: {
  repoUrl: string;
  deploymentUrl: string;
  commitSha?: string | null;
}): ValidatedSubmissionInput {
  return {
    repoUrl: validateRepoUrl(input.repoUrl),
    deploymentUrl: validateDeploymentUrl(input.deploymentUrl),
    commitSha: validateCommitSha(input.commitSha),
  };
}
