'use client';

import { useActionState, useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { submitSolutionAction } from '@/server/actions/submission.actions';
import type { PublicRepoOption } from '@/server/modules/github/repos';
import type { Result } from '@/lib/errors';

type State = Result<{
  submissionId: string;
  version: number;
  replaced: boolean;
}> | null;

interface Props {
  roundId: string;
  /** Present when the competitor already has an entry for this round. */
  existing: {
    repoUrl: string;
    deploymentUrl: string;
    commitSha: string | null;
    version: number;
  } | null;
  /** False once the window has closed or the entry has been sealed. */
  editable: boolean;
  repos: PublicRepoOption[];
  /**
   * Where to go after a successful submit. Defaults to the submission detail
   * page ([9]'s behaviour); the arena ([10]) passes its own URL so a competitor
   * mid-round is never navigated away from their timer.
   */
  redirectTo?: string;
  /** Copy for the closed state, which differs between the two screens. */
  closedHint?: string;
}

/**
 * The submission form — screen [9], reused by the Knockout Arena [10].
 *
 * The same form creates and replaces: the server decides which, because "does
 * an entry already exist?" is a question about persisted state, not about which
 * button the browser rendered. Validation here is only for fast feedback; the
 * server re-validates everything and is the one that decides.
 */
export function SubmissionForm({
  roundId,
  existing,
  editable,
  redirectTo,
  closedHint,
  repos,
}: Props) {
  const router = useRouter();
  const existingInList = useMemo(
    () => repos.some((repo) => repo.htmlUrl === existing?.repoUrl),
    [existing?.repoUrl, repos],
  );
  const [manual, setManual] = useState(
    repos.length === 0 || Boolean(existing?.repoUrl && !existingInList),
  );
  const [state, formAction, pending] = useActionState<State, FormData>(
    submitSolutionAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(
        state.data.replaced
          ? `Entry replaced — now version ${state.data.version}`
          : 'Entry accepted and queued for evaluation',
      );
      router.push(redirectTo ?? `/submissions/${state.data.submissionId}`);
      router.refresh();
    } else {
      toast.error(state.error.message);
    }
  }, [state, router, redirectTo]);

  if (!editable) {
    return (
      <div className="border-border bg-muted/40 rounded-md border p-4 text-sm">
        <p className="font-medium">This round is closed</p>
        <p className="text-muted-foreground mt-1">
          {closedHint ??
            (existing
              ? 'Your entry has been sealed and can no longer be changed.'
              : 'The submission window has passed.')}
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="roundId" value={roundId} />

      <RepoPicker
        repos={repos}
        existingRepoUrl={existing?.repoUrl ?? ''}
        manual={manual}
        onManualChange={setManual}
        onRefresh={() => router.refresh()}
      />
      <Field
        name="deploymentUrl"
        label="Deployment URL"
        type="url"
        defaultValue={existing?.deploymentUrl ?? ''}
        placeholder="https://your-project.example.com"
        hint="A live https:// URL the evaluator can reach from the public internet."
        required
      />
      <Field
        name="commitSha"
        label="Commit SHA"
        defaultValue={existing?.commitSha ?? ''}
        placeholder="optional"
        hint="Optional. Pins the exact commit evaluated (D19)."
      />

      {state && !state.ok ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {state.error.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex h-9 items-center rounded-md px-4 text-sm font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-50"
      >
        {pending
          ? 'Submitting…'
          : existing
            ? `Replace entry (v${existing.version} → v${existing.version + 1})`
            : 'Submit entry'}
      </button>

      {existing ? (
        <p className="text-muted-foreground text-xs">
          Replacing keeps every earlier version in your submission history and
          queues a fresh evaluation.
        </p>
      ) : null}
    </form>
  );
}

function RepoPicker({
  repos,
  existingRepoUrl,
  manual,
  onManualChange,
  onRefresh,
}: {
  repos: PublicRepoOption[];
  existingRepoUrl: string;
  manual: boolean;
  onManualChange: (manual: boolean) => void;
  onRefresh: () => void;
}) {
  const id = useId();
  const hintId = `${id}-hint`;

  if (manual) {
    return (
      <div className="space-y-2">
        <Field
          name="repoUrl"
          label="GitHub repository"
          type="url"
          defaultValue={existingRepoUrl}
          placeholder="https://github.com/you/your-project"
          hint="Must be an owned public github.com repository."
          required
        />
        {repos.length > 0 ? (
          <button
            type="button"
            onClick={() => onManualChange(false)}
            className="text-primary rounded-md text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            Select repository instead
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-medium">
          GitHub repository
          <span className="text-destructive ml-0.5" aria-hidden="true">
            *
          </span>
        </label>
        <select
          id={id}
          name="repoUrl"
          required
          defaultValue={existingRepoUrl || repos[0]?.htmlUrl || ''}
          aria-describedby={hintId}
          className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          {repos.map((repo) => (
            <option key={repo.id} value={repo.htmlUrl}>
              {repo.fullName}
            </option>
          ))}
        </select>
        <p id={hintId} className="text-muted-foreground text-xs">
          Showing public repositories owned by your linked GitHub account.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted-foreground">Can&apos;t find it?</span>
        <button
          type="button"
          onClick={onRefresh}
          className="text-primary rounded-md font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => onManualChange(true)}
          className="text-primary rounded-md font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Enter repository manually
        </button>
      </div>
    </div>
  );
}

function Field({
  name,
  label,
  hint,
  type = 'text',
  ...rest
}: {
  name: string;
  label: string;
  hint?: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {rest.required ? (
          <span className="text-destructive ml-0.5" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        aria-describedby={hintId}
        className="border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
