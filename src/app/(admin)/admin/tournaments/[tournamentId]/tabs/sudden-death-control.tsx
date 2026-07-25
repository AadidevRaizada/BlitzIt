'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { startSuddenDeathAction } from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';

/**
 * Open a sudden-death challenge for a deadlocked match (D5.6 / D14, E6.3).
 *
 * D14 requires a **new** challenge, so the picker excludes the problem the tied
 * round used — the module enforces that too; this only keeps the operator from
 * choosing something that will be refused.
 */
export function SuddenDeathControl({
  matchId,
  tournamentId,
  problems,
  excludeProblemId,
}: {
  matchId: string;
  tournamentId: string;
  problems: Array<{ id: string; title: string; category: string }>;
  excludeProblemId: string | null;
}) {
  const router = useRouter();
  const [problemId, setProblemId] = useState('');
  const [pending, startTransition] = useTransition();

  const choices = problems.filter((problem) => problem.id !== excludeProblemId);

  if (choices.length === 0) {
    return (
      <span className="text-muted-foreground text-xs">
        Publish another challenge to run sudden death
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="sr-only" htmlFor={`sd-${matchId}`}>
        Sudden-death challenge
      </label>
      <select
        id={`sd-${matchId}`}
        value={problemId}
        onChange={(event) => setProblemId(event.target.value)}
        className="border-input bg-background focus-visible:ring-ring h-7 max-w-[12rem] rounded-md border px-2 text-xs focus-visible:ring-2 focus-visible:outline-none"
      >
        <option value="">New challenge…</option>
        {choices.map((problem) => (
          <option key={problem.id} value={problem.id}>
            {problem.title} ({problem.category})
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="primary"
        disabled={!problemId || pending}
        aria-busy={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await startSuddenDeathAction(
              matchId,
              problemId,
              tournamentId,
            );
            if (result.ok) {
              toast.success('Sudden-death challenge opened');
              router.refresh();
            } else {
              toast.error(result.error.message);
            }
          })
        }
      >
        Start sudden death
      </Button>
    </div>
  );
}
