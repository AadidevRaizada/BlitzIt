import 'server-only';
import { lookup } from 'node:dns/promises';
import { lookup as dnsLookupCb } from 'node:dns';
import { isIP } from 'node:net';
import { Agent } from 'undici';

/**
 * Egress-controlled HTTP client for probing competitor-supplied URLs (risk T1).
 *
 * The deployment URL is fully attacker-controlled, so every request is:
 *  - restricted to http/https,
 *  - DNS-resolved and rejected if it points at a private/loopback/link-local
 *    address (SSRF into our own infrastructure or cloud metadata),
 *  - re-validated on EVERY redirect hop (redirects are followed manually so a
 *    public host cannot bounce us to 169.254.169.254),
 *  - hard-capped on time and response size,
 *  - sent with no credentials, cookies or ambient auth.
 */

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_000_000; // 1 MB

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

/** Private, loopback, link-local and other non-routable ranges. */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a = 0, b = 0] = parts;
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // "this" network
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (v === '::1' || v === '::') return true;
  if (v.startsWith('fe80')) return true; // link-local
  if (/^f[cd]/.test(v)) return true; // unique local fc00::/7
  // IPv4-mapped (::ffff:10.0.0.1) — validate the embedded address.
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true; // not a literal IP → caller must resolve first
}

/**
 * Validate a URL and confirm every address its hostname resolves to is public.
 * Throws `BlockedUrlError` when unsafe.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError('Malformed URL');
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedUrlError(`Protocol not allowed: ${url.protocol}`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');

  // Literal IP: check directly, no DNS.
  if (isIP(host)) {
    if (isBlockedAddress(host)) {
      throw new BlockedUrlError('URL resolves to a non-public address');
    }
    return url;
  }

  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new BlockedUrlError('URL resolves to a non-public address');
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError(`Could not resolve host: ${host}`);
  }

  if (addresses.length === 0) {
    throw new BlockedUrlError(`Host has no addresses: ${host}`);
  }
  // ALL addresses must be public — a single private answer is disqualifying.
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new BlockedUrlError('URL resolves to a non-public address');
    }
  }

  return url;
}

/**
 * Dispatcher that re-checks the resolved address **at connect time**.
 *
 * `assertPublicUrl()` alone is not sufficient: it performs its own DNS lookup,
 * and `fetch()` then resolves independently. A DNS-rebinding host (TTL 0) can
 * answer with a public IP for the check and a private/metadata IP for the real
 * connection — defeating the guard entirely (TOCTOU).
 *
 * Injecting the validation into the socket `lookup` means the address we
 * approve is exactly the address we connect to.
 */
const guardedAgent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dnsLookupCb(hostname, options, (err, address, family) => {
        if (err) {
          callback(err, '', 0);
          return;
        }
        // `all: true` yields an array; otherwise a single address string.
        const candidates = Array.isArray(address)
          ? address.map((entry) => entry.address)
          : [address];

        for (const candidate of candidates) {
          if (isBlockedAddress(candidate)) {
            callback(
              new BlockedUrlError(
                'URL resolved to a non-public address at connect time',
              ),
              '',
              0,
            );
            return;
          }
        }
        callback(
          null,
          address as unknown as string,
          family as unknown as number,
        );
      });
    },
  },
});

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface SafeResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: string;
  /** True when the body hit `maxBytes` and was cut short. */
  truncated: boolean;
  durationMs: number;
  url: string;
}

/**
 * Fetch a competitor URL with full egress control. Redirects are followed
 * manually so each hop is re-validated.
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
  } = options;

  const startedAt = Date.now();
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(currentUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          // Identify ourselves; never send cookies or credentials.
          'user-agent': 'BlitzIt-Evaluator/1.0 (+https://blitzit.dev)',
          ...headers,
        },
        body,
        redirect: 'manual',
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        // Re-validates the resolved IP at connect time (anti DNS-rebinding).
        dispatcher: guardedAgent,
      } as RequestInit & { dispatcher: Agent });

      // Manual redirect handling so the next hop is validated too.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return toSafeResponse(response, '', false, startedAt, url.toString());
        }
        if (hop === MAX_REDIRECTS) {
          throw new BlockedUrlError('Too many redirects');
        }
        currentUrl = new URL(location, url).toString();
        continue;
      }

      const { text, truncated } = await readCapped(response, maxBytes);
      return toSafeResponse(
        response,
        text,
        truncated,
        startedAt,
        url.toString(),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  throw new BlockedUrlError('Too many redirects');
}

/** Read a response body but stop at `maxBytes` so a huge payload can't OOM us. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: '', truncated: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.length > maxBytes) {
        chunks.push(value.slice(0, maxBytes - total));
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder().decode(merged), truncated };
}

function toSafeResponse(
  response: Response,
  bodyText: string,
  truncated: boolean,
  startedAt: number,
  url: string,
): SafeResponse {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    headers,
    body: bodyText,
    truncated,
    durationMs: Date.now() - startedAt,
    url,
  };
}
