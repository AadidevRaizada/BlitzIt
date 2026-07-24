'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { updateProfileAction } from '@/server/actions/profile.actions';
import type { Result } from '@/lib/errors';

interface Initial {
  username: string;
  displayName: string;
  bio: string;
  city: string;
  githubUsername: string;
  twitterHandle: string;
  websiteUrl: string;
}

type State = Result<{ username: string }> | null;

/** Profile edit form. Validation is enforced server-side by the same schema. */
export function ProfileForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<State, FormData>(
    updateProfileAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success('Profile updated');
      router.refresh();
    } else {
      toast.error(state.error.message);
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <Field
        name="username"
        label="Username"
        defaultValue={initial.username}
        required
        hint="Lowercase letters, numbers and hyphens. 3–24 characters."
      />
      <Field
        name="displayName"
        label="Display name"
        defaultValue={initial.displayName}
        required
      />
      <Field
        name="bio"
        label="Bio"
        defaultValue={initial.bio}
        textarea
        hint="Up to 280 characters."
      />
      <Field name="city" label="City" defaultValue={initial.city} />
      <Field
        name="githubUsername"
        label="GitHub username"
        defaultValue={initial.githubUsername}
      />
      <Field
        name="twitterHandle"
        label="X / Twitter handle"
        defaultValue={initial.twitterHandle}
      />
      <Field
        name="websiteUrl"
        label="Website"
        defaultValue={initial.websiteUrl}
        hint="Must start with http:// or https://"
      />

      {state && !state.ok ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  hint,
  required,
  textarea,
}: {
  name: string;
  label: string;
  defaultValue: string;
  hint?: string;
  required?: boolean;
  textarea?: boolean;
}) {
  const className =
    'border-border bg-background w-full rounded-md border px-3 py-2 text-sm';
  return (
    <div className="space-y-1">
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
      </label>
      {textarea ? (
        <textarea
          id={name}
          name={name}
          defaultValue={defaultValue}
          rows={3}
          className={className}
        />
      ) : (
        <input
          id={name}
          name={name}
          defaultValue={defaultValue}
          required={required}
          className={className}
        />
      )}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}
