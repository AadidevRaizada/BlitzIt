'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  disqualifySubmissionAction,
  retryEvaluationAction,
} from '@/server/actions/submission.actions';
import type { SubmissionState } from '@/server/modules/submission/state';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Per-row admin actions on a submission (E5).
 *
 * Both actions are E4's; nothing here decides whether they are allowed. The
 * buttons are hidden when the module would refuse anyway — a disqualified entry
 * is terminal — but the module remains the authority, and a stale page that
 * still shows a button gets a typed error rather than a surprise.
 */
export function SubmissionRowActions({
  submissionId,
  state,
}: {
  submissionId: string;
  state: SubmissionState;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (state === 'DISQUALIFIED') {
    return <span className="text-muted-foreground text-xs">Disqualified</span>;
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await retryEvaluationAction(submissionId);
            if (result.ok) {
              toast.success('Evaluation re-queued');
              router.refresh();
            } else {
              toast.error(result.error.message);
            }
          })
        }
      >
        Retry
      </Button>

      <ConfirmDialog
        trigger={
          <Button size="sm" variant="ghost" className="text-destructive">
            Disqualify
          </Button>
        }
        title="Disqualify this submission?"
        description="Disqualification is terminal: the entry is removed from competition, its score no longer counts, and it can never be re-evaluated."
        confirmLabel="Disqualify"
        requireReason
        successMessage="Submission disqualified"
        action={(reason) =>
          disqualifySubmissionAction({ submissionId, reason })
        }
      />
    </div>
  );
}
