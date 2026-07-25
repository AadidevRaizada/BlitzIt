'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  createProblemAction,
  updateProblemAction,
} from '@/server/actions/admin.actions';
import type { ProblemDetail } from '@/server/modules/problem';
import { CHALLENGE_CATEGORIES } from '@/lib/validation/admin.schema';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  FormError,
  SelectField,
  TextAreaField,
  TextField,
} from '@/components/ui/field';
import type { Result } from '@/lib/errors';

type State = Result<{ id: string; slug?: string }> | null;

function jsonValue(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

export function ProblemForm({ initial }: { initial?: ProblemDetail }) {
  const router = useRouter();
  const action = initial
    ? updateProblemAction.bind(null, initial.id)
    : createProblemAction;
  const [state, formAction, pending] = useActionState<State, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(initial ? 'Challenge saved' : 'Challenge created');
      router.push(`/admin/challenges/${state.data.id}`);
      router.refresh();
    } else {
      toast.error(state.error.message);
    }
  }, [state, router, initial]);

  return (
    <Card>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              name="title"
              label="Title"
              required
              defaultValue={initial?.title ?? ''}
            />
            {!initial ? (
              <TextField
                name="slug"
                label="Slug"
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                defaultValue=""
              />
            ) : null}
            <SelectField
              name="category"
              label="Category"
              required
              defaultValue={initial?.category ?? 'REST_API'}
              options={CHALLENGE_CATEGORIES.map((category) => ({
                value: category,
                label: category,
              }))}
            />
            <TextField
              name="difficulty"
              label="Difficulty"
              defaultValue={initial?.difficulty ?? ''}
            />
            <TextField
              name="starterRepoUrl"
              label="Starter repo URL"
              type="url"
              className="md:col-span-2"
              defaultValue={initial?.starterRepoUrl ?? ''}
            />
            <TextAreaField
              name="statementMarkdown"
              label="Statement"
              rows={10}
              required
              className="md:col-span-2"
              defaultValue={initial?.statementMarkdown ?? ''}
            />
            <TextAreaField
              name="contractSpec"
              label="Contract spec JSON"
              rows={8}
              required
              className="font-mono md:col-span-2"
              defaultValue={jsonValue(initial?.contractSpec)}
            />
          </div>

          {state && !state.ok ? (
            <FormError message={state.error.message} />
          ) : null}

          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending
              ? 'Saving...'
              : initial
                ? 'Save challenge'
                : 'Create challenge'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
