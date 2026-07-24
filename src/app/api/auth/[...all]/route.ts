import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/server/auth';

/** Better Auth endpoints: OAuth start/callback, session, sign-out. */
export const { GET, POST } = toNextJsHandler(auth);
