'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createTournamentAdminAction } from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';
import {
  CheckboxField,
  FormError,
  SelectField,
  TextAreaField,
  TextField,
} from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SUPPORTED_BRACKET_SIZES } from '@/server/modules/tournament/config.public';
import type { Result } from '@/lib/errors';

type State = Result<{ id: string; slug: string }> | null;

/**
 * Create-tournament form (E5).
 *
 * Only the fields that define the tournament's *shape*. Schedule, prize pool
 * and evaluation profiles are set on the detail page once it exists — asking
 * for all of them at once would make the first step of A1 a wall, and every one
 * of them is editable afterwards anyway.
 */
export function NewTournamentForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<State, FormData>(
    createTournamentAdminAction,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success('Tournament created');
      router.push(`/admin/tournaments/${state.data.id}`);
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={formAction} className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TextField
            name="name"
            label="Name"
            required
            placeholder="Blitz It — Week 30"
            maxLength={120}
          />
          <TextField
            name="slug"
            label="Slug"
            required
            placeholder="2026-w30"
            hint="Lowercase letters, numbers and single hyphens. Used in public URLs and cannot be changed later."
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
          <TextAreaField
            name="description"
            label="Description"
            hint="Shown to operators, and later on the public page."
            maxLength={1000}
          />
          <SelectField
            name="visibility"
            label="Visibility"
            defaultValue="PUBLIC"
            hint="Unlisted tournaments run the full lifecycle without appearing on public surfaces — use for rehearsals."
            options={[
              { value: 'PUBLIC', label: 'Public' },
              { value: 'UNLISTED', label: 'Unlisted' },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Shape</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SelectField
            name="bracketSize"
            label="Bracket size"
            defaultValue=""
            hint="Leave automatic to size from the qualified field — the largest bracket it can fill (D6)."
            options={[
              { value: '', label: 'Automatic' },
              ...SUPPORTED_BRACKET_SIZES.map((size) => ({
                value: String(size),
                label: `${size} competitors`,
              })),
            ]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              name="minRegistrations"
              label="Minimum registrations"
              type="number"
              min={0}
              placeholder="8"
              hint="Registration cannot close below this."
            />
            <TextField
              name="maxRegistrations"
              label="Maximum registrations"
              type="number"
              min={1}
              placeholder="512"
              hint="Hard cap; further entries are refused."
            />
          </div>
          <TextField
            name="passPriceMinor"
            label="Entry price (paise)"
            type="number"
            min={0}
            placeholder="10000"
            hint="₹100 = 10000 paise. Money is always stored as an integer."
          />
          <div>
            <input type="hidden" name="thirdPlaceEnabled" value="false" />
            <CheckboxField
              name="thirdPlaceEnabled"
              label="Third-place play-off"
              hint="The losing semi-finalists play off between the semi-finals and the final."
              defaultChecked
              value="true"
            />
          </div>
        </CardContent>
      </Card>

      {state && !state.ok ? <FormError message={state.error.message} /> : null}

      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? 'Creating…' : 'Create tournament'}
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
