import type { SubmissionState } from '@/server/modules/submission/state';
import { SUBMISSION_STATE_LABEL } from '@/server/modules/submission/state';
// The isomorphic half — importing `status.ts` here would drag `server-only`
// into every client component that renders a badge.
import type { JobLifecycleState } from '@/server/jobs/status.public';
import { JOB_STATE_LABEL } from '@/server/jobs/status.public';
import { cn } from '@/lib/utils';

/**
 * Status pills for a submission and its evaluation job.
 *
 * Colour is reserved for action and state (design-system §2), so these are the
 * only place in the submission UI that carries an accent. `--success` is the
 * brand secondary, which per the design system **always** takes a black
 * foreground — hence `text-success-foreground` rather than a hand-picked value.
 */

const SUBMISSION_TONE: Record<SubmissionState, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  READY: 'bg-muted text-foreground',
  QUEUED: 'bg-accent text-accent-foreground',
  EVALUATING: 'bg-primary/15 text-primary',
  EVALUATED: 'bg-success text-success-foreground',
  FAILED: 'bg-destructive/15 text-destructive',
  DISQUALIFIED: 'bg-destructive text-destructive-foreground',
};

const JOB_TONE: Record<JobLifecycleState, string> = {
  QUEUED: 'bg-muted text-muted-foreground',
  RETRY_SCHEDULED: 'bg-warning/20 text-warning-foreground',
  CLAIMED: 'bg-accent text-accent-foreground',
  RUNNING: 'bg-primary/15 text-primary',
  COMPLETED: 'bg-success text-success-foreground',
  FAILED: 'bg-warning/20 text-warning-foreground',
  DEAD_LETTER: 'bg-destructive/15 text-destructive',
};

const base =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap';

export function SubmissionStatusBadge({
  state,
  className,
}: {
  state: SubmissionState;
  className?: string;
}) {
  return (
    <span className={cn(base, SUBMISSION_TONE[state], className)}>
      {SUBMISSION_STATE_LABEL[state]}
    </span>
  );
}

export function JobStatusBadge({
  state,
  className,
}: {
  state: JobLifecycleState;
  className?: string;
}) {
  return (
    <span className={cn(base, JOB_TONE[state], className)}>
      {JOB_STATE_LABEL[state]}
    </span>
  );
}
