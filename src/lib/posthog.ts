import 'server-only';
import { PostHog } from 'posthog-node';

/**
 * Server-side PostHog client (shell). Returns a singleton when a key is set,
 * otherwise `null` so callers no-op cleanly in dev/CI without analytics.
 */

let client: PostHog | null | undefined;

export function getPostHogServer(): PostHog | null {
  if (client !== undefined) return client;
  const key =
    process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) {
    client = null;
    return client;
  }
  client = new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    flushAt: 1,
    flushInterval: 0,
  });
  return client;
}

export function captureServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  getPostHogServer()?.capture({ distinctId, event, properties });
}
