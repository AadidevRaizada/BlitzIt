'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { updateScheduleAdminAction } from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';
import { FormError, TextField } from '@/components/ui/field';
import { toDateTimeLocal } from '@/components/ui/page-header';
import type { Result } from '@/lib/errors';

type State = Result<{ id: string }> | null;

/**
 * Schedule editor (E5).
 *
 * `datetime-local` inputs carry no timezone, so these are rendered from — and
 * parsed back as — **IST**, and labelled as such. The Zod schema pins the
 * offset explicitly rather than letting `new Date()` apply the server's local
 * offset, which would shift every schedule by the deployment's timezone.
 *
 * Storage is still UTC. Only what the operator sees and types is IST.
 */
export function ScheduleForm({
  tournamentId,
  initial,
}: {
  tournamentId: string;
  initial: {
    registrationOpensAt: Date | null;
    registrationClosesAt: Date | null;
    simulationOpensAt: Date | null;
    simulationClosesAt: Date | null;
    liveStartsAt: Date | null;
  };
}) {
  const router = useRouter();
  const action = updateScheduleAdminAction.bind(null, tournamentId);
  const [state, formAction, pending] = useActionState<State, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success('Schedule saved');
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          name="registrationOpensAt"
          label="Registration opens (IST)"
          type="datetime-local"
          defaultValue={toDateTimeLocal(initial.registrationOpensAt)}
        />
        <TextField
          name="registrationClosesAt"
          label="Registration closes (IST)"
          type="datetime-local"
          defaultValue={toDateTimeLocal(initial.registrationClosesAt)}
        />
        <TextField
          name="simulationOpensAt"
          label="Simulation opens (IST)"
          type="datetime-local"
          defaultValue={toDateTimeLocal(initial.simulationOpensAt)}
        />
        <TextField
          name="simulationClosesAt"
          label="Simulation closes (IST)"
          type="datetime-local"
          defaultValue={toDateTimeLocal(initial.simulationClosesAt)}
        />
        <TextField
          name="liveStartsAt"
          label="Knockout starts (IST)"
          type="datetime-local"
          defaultValue={toDateTimeLocal(initial.liveStartsAt)}
          className="sm:col-span-2"
        />
      </div>

      {state && !state.ok ? <FormError message={state.error.message} /> : null}

      <Button
        type="submit"
        variant="primary"
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? 'Saving…' : 'Save schedule'}
      </Button>
    </form>
  );
}
