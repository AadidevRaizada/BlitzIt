'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { addHiddenTestAction } from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { FormError, TextAreaField, TextField } from '@/components/ui/field';
import type { Result } from '@/lib/errors';

type State = Result<{ testId: string }> | null;

export function HiddenTestForm({ problemId }: { problemId: string }) {
  const router = useRouter();
  const action = addHiddenTestAction.bind(null, problemId);
  const [state, formAction, pending] = useActionState<State, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success('Hidden test added');
      router.refresh();
    } else {
      toast.error(state.error.message);
    }
  }, [state, router]);

  return (
    <Card>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <TextField name="name" label="Name" required />
            <TextField
              name="kind"
              label="Kind"
              defaultValue="HTTP_ASSERTION"
              required
            />
            <TextField
              name="weight"
              label="Weight"
              type="number"
              defaultValue={1}
            />
            <TextField
              name="timeoutMs"
              label="Timeout"
              type="number"
              defaultValue={10000}
            />
            <TextAreaField
              name="spec"
              label="Spec JSON"
              rows={6}
              required
              className="font-mono md:col-span-3"
              defaultValue={JSON.stringify(
                { path: '/', expect: { status: 200 } },
                null,
                2,
              )}
            />
          </div>

          {state && !state.ok ? (
            <FormError message={state.error.message} />
          ) : null}

          <Button type="submit" disabled={pending} aria-busy={pending}>
            Add hidden test
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
