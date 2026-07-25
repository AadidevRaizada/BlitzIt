'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { retryEvaluationAction } from '@/server/actions/submission.actions';

/**
 * Admin: re-queue an evaluation (the `reEnqueueEvaluation` escape hatch).
 * Authorisation is enforced in the action and again in the module — this button
 * only exists to call it.
 */
export function RetryButton({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
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
      className="border-border hover:bg-accent focus-visible:ring-ring inline-flex h-7 items-center rounded-md border px-2 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
    >
      {pending ? 'Queueing…' : 'Retry'}
    </button>
  );
}
