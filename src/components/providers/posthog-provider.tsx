'use client';

import { useEffect } from 'react';
import posthog from 'posthog-js';
import { publicEnv } from '@/lib/env';

/**
 * Browser PostHog init (shell). No-ops when the key isn't configured, so the
 * app runs cleanly in dev/CI. Wraps the app in the root layout.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = publicEnv.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key || posthog.__loaded) return;
    posthog.init(key, {
      api_host:
        publicEnv.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      capture_pageview: true,
      person_profiles: 'identified_only',
    });
  }, []);

  return <>{children}</>;
}
