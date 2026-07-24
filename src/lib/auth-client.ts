'use client';

import { createAuthClient } from 'better-auth/react';
import { publicEnv } from '@/lib/env';

/** Browser-side Better Auth client (sign-in/out, session hooks). */
export const authClient = createAuthClient({
  baseURL: publicEnv.NEXT_PUBLIC_APP_URL,
});

export const { signIn, signOut, useSession } = authClient;
