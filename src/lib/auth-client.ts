'use client';

import { createAuthClient } from 'better-auth/react';
import { publicEnv } from '@/lib/env';

/**
 * Browser-side Better Auth client (sign-in/out, session hooks).
 *
 * The base URL is the origin in the address bar, not `NEXT_PUBLIC_APP_URL`.
 * That var is inlined at build time, so a bundle built before a domain was
 * attached keeps naming the old host — every auth request then leaves the
 * page's origin and dies in CORS preflight with no `Access-Control-Allow-Origin`
 * header, which is exactly what a custom domain in front of the generated
 * `*.up.railway.app` host produced. Same-origin needs no such header and cannot
 * drift from wherever the app is actually being served. Server-side renders have
 * no `window`, so they keep the configured URL.
 */
export const authClient = createAuthClient({
  baseURL:
    typeof window === 'undefined'
      ? publicEnv.NEXT_PUBLIC_APP_URL
      : window.location.origin,
});

export const { signIn, signOut, useSession } = authClient;
