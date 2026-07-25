'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { assignProblemToRoundAction } from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';

/**
 * Assign a published problem to a round that has not opened yet.
 *
 * Only published problems are listed, and the module refuses anything else —
 * the picker is a convenience, not the rule.
 */
export function AssignProblemControl({
  roundId,
  tournamentId,
  problems,
}: {
  roundId: string;
  tournamentId: string;
  problems: Array<{ id: string; title: string; category: string }>;
}) {
  const router = useRouter();
  const [problemId, setProblemId] = useState('');
  const [pending, startTransition] = useTransition();

  if (problems.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        No published problems
      </span>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <label className="sr-only" htmlFor={`assign-${roundId}`}>
        Problem for this round
      </label>
      <select
        id={`assign-${roundId}`}
        value={problemId}
        onChange={(event) => setProblemId(event.target.value)}
        className="border-input bg-background focus-visible:ring-ring h-7 max-w-[12rem] rounded-md border px-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
      >
        <option value="">Choose…</option>
        {problems.map((problem) => (
          <option key={problem.id} value={problem.id}>
            {problem.title} ({problem.category})
          </option>
        ))}
      </select>
      <Button
        size="sm"
        disabled={!problemId || pending}
        aria-busy={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await assignProblemToRoundAction(
              roundId,
              problemId,
              tournamentId,
            );
            if (result.ok) {
              toast.success('Problem assigned');
              router.refresh();
            } else {
              toast.error(result.error.message);
            }
          })
        }
      >
        Assign
      </Button>
    </div>
  );
}
