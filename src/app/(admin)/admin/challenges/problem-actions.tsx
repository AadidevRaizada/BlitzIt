'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  archiveProblemAction,
  publishProblemAction,
  removeHiddenTestAction,
} from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export function PublishProblemButton({ problemId }: { problemId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      size="sm"
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        start(async () => {
          const result = await publishProblemAction(problemId);
          if (result.ok) {
            toast.success('Challenge published');
            router.refresh();
          } else {
            toast.error(result.error.message);
          }
        })
      }
    >
      Publish challenge
    </Button>
  );
}

export function ArchiveProblemButton({ problemId }: { problemId: string }) {
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="secondary">
          Archive
        </Button>
      }
      title="Archive this challenge?"
      description="Archived challenges are hidden from authoring lists and cannot be assigned to new rounds."
      confirmLabel="Archive challenge"
      successMessage="Challenge archived"
      action={() => archiveProblemAction(problemId)}
    />
  );
}

export function RemoveHiddenTestButton({
  testId,
  problemId,
}: {
  testId: string;
  problemId: string;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-destructive">
          Remove
        </Button>
      }
      title="Remove hidden test?"
      description="This cannot be undone. The test spec is permanently deleted."
      confirmLabel="Remove test"
      successMessage="Hidden test removed"
      action={() => removeHiddenTestAction(testId, problemId)}
    />
  );
}
