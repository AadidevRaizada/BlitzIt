'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSubmissionStatusAction } from '@/server/actions/submission.actions';
import {
  JobStatusBadge,
  SubmissionStatusBadge,
} from '@/components/features/submission-status-badge';
import type { SubmissionView } from '@/server/modules/submission';

type Snapshot = {
  state: SubmissionView['state'];
  job: SubmissionView['job'];
  evaluation: SubmissionView['evaluation'];
  version: number;
};

/**
 * Live evaluation status (E4).
 *
 * Polls a read action while the entry is still moving and stops as soon as it
 * settles. The polling lives HERE, in the view — no business module ever waits
 * on a job, and the server has no long-lived request. SSE replaces this for the
 * live surfaces in a later epic; a 3s poll is the right amount of machinery for
 * one competitor watching one submission.
 */
export function EvaluationStatus({
  submissionId,
  initial,
}: {
  submissionId: string;
  initial: Snapshot;
}) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const settledRef = useRef(false);

  const isSettled = (s: Snapshot) =>
    s.state === 'EVALUATED' ||
    s.state === 'FAILED' ||
    s.state === 'DISQUALIFIED';

  const poll = useCallback(async () => {
    const result = await getSubmissionStatusAction(submissionId);
    if (!result.ok) return;
    setSnapshot(result.data);
    if (isSettled(result.data) && !settledRef.current) {
      settledRef.current = true;
      // Refresh the server components once, so the results panel renders with
      // the full evaluation rather than the polled subset.
      router.refresh();
    }
  }, [submissionId, router]);

  useEffect(() => {
    if (isSettled(snapshot)) return;
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [snapshot, poll]);

  const job = snapshot.job;

  return (
    <div
      className="border-border rounded-md border p-4"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-eyebrow text-muted-foreground font-semibold uppercase">
          Evaluation status
        </h2>
        <div className="flex items-center gap-2">
          <SubmissionStatusBadge state={snapshot.state} />
          {job ? <JobStatusBadge state={job.state} /> : null}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <Row label="Revision" value={`v${snapshot.version}`} />
        {job ? (
          <>
            <Row
              label="Attempts"
              value={`${job.attempts} of ${job.maxAttempts}`}
            />
            {job.nextAttemptAt ? (
              <Row
                label="Next attempt"
                value={new Date(job.nextAttemptAt)
                  .toISOString()
                  .replace('T', ' ')
                  .slice(0, 19)}
              />
            ) : null}
          </>
        ) : null}
      </dl>

      {job?.lastError ? (
        <p className="text-muted-foreground mt-3 text-xs">
          Last error: {job.lastError}
        </p>
      ) : null}

      {!isSettled(snapshot) ? (
        <p className="text-muted-foreground mt-3 text-xs">
          Checking every few seconds…
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
