import 'server-only';
import type { JobStatus } from '@/generated/prisma/client';
import type { PersistedJobStatus } from './status.public';

/**
 * Server-side job lifecycle surface (E4).
 *
 * The helpers themselves are pure and live in `status.public.ts` so client
 * components can render a job's state without pulling `server-only` into the
 * browser bundle. This module re-exports them for server callers and pins the
 * public mirror to the real Prisma enum.
 */

export {
  describeJob,
  JOB_STATE_LABEL,
  type JobLifecycle,
  type JobLifecycleState,
  type JobStatusSource,
  type PersistedJobStatus,
} from './status.public';

/**
 * Compile-time guard: the hand-written mirror in `status.public.ts` must stay
 * exactly the Prisma `JobStatus` enum. If someone adds a status to the schema
 * without updating the mirror — or vice versa — this fails to typecheck rather
 * than silently mis-classifying a job at runtime.
 */
type MirrorMatchesPrisma = PersistedJobStatus extends JobStatus
  ? JobStatus extends PersistedJobStatus
    ? true
    : never
  : never;
const _mirrorIsExhaustive: MirrorMatchesPrisma = true;
void _mirrorIsExhaustive;

/** Persisted statuses that mean the job has not finished. */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
  'QUEUED',
  'CLAIMED',
  'RUNNING',
] as const;
