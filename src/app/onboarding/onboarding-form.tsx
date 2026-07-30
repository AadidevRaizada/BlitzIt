'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { completeOnboardingAction } from '@/server/actions/onboarding.actions';
import { authClient } from '@/lib/auth-client';
import type { Result } from '@/lib/errors';
import type { OnboardingState } from '@/server/modules/auth/onboarding';
import { GitHubIcon } from '@/components/ui/brand-icons';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckboxField, FormError, TextField } from '@/components/ui/field';

type State = Result<{ username: string }> | null;

export function OnboardingForm({ initial }: { initial: OnboardingState }) {
  const router = useRouter();
  const [linking, setLinking] = useState(false);
  const [state, formAction, pending] = useActionState<State, FormData>(
    completeOnboardingAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success('Onboarding complete');
      router.replace('/dashboard');
      router.refresh();
    } else {
      toast.error(state.error.message);
    }
  }, [state, router]);

  async function linkGitHub() {
    setLinking(true);
    try {
      await authClient.linkSocial({
        provider: 'github',
        callbackURL: '/onboarding',
      });
    } catch {
      toast.error('Could not start GitHub linking. Please try again.');
      setLinking(false);
    }
  }

  return (
    <form action={formAction} className="space-y-4">
      <Card className="space-y-4 p-4">
        <SectionHeader
          index="1"
          title="Profile"
          complete={Boolean(
            initial.profile.displayName && initial.profile.city,
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            name="displayName"
            label="Display name"
            defaultValue={initial.profile.displayName}
            required
          />
          <TextField
            name="username"
            label="Username"
            defaultValue={initial.profile.username}
            required
            hint="Lowercase letters, numbers and hyphens."
          />
          <TextField
            name="city"
            label="City"
            defaultValue={initial.profile.city}
            required
            className="sm:col-span-2"
          />
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <SectionHeader
          index="2"
          title="GitHub"
          complete={initial.githubLinked}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {initial.githubLinked
                ? `Linked as ${initial.profile.githubUsername ?? 'GitHub'}`
                : 'Link the GitHub account you will submit from.'}
            </p>
            <p className="text-muted-foreground text-sm">
              Submissions must come from an owned public repository.
            </p>
          </div>
          <Button
            type="button"
            variant={initial.githubLinked ? 'secondary' : 'primary'}
            onClick={linkGitHub}
            disabled={linking}
            aria-busy={linking}
          >
            {linking ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <GitHubIcon className="size-4" />
            )}
            {initial.githubLinked ? 'Relink GitHub' : 'Link GitHub'}
          </Button>
        </div>
      </Card>

      <Card className="space-y-4 p-4">
        <SectionHeader
          index="3"
          title="Rules and terms"
          complete={initial.termsAccepted}
        />
        <CheckboxField
          name="termsAccepted"
          label="I accept the current rules and terms"
          hint="This is required before entering a tournament."
          defaultChecked={initial.termsAccepted}
          required
        />
      </Card>

      <FormError message={state && !state.ok ? state.error.message : null} />

      <div className="flex justify-end">
        <Button
          type="submit"
          variant="broadcast"
          size="broadcast"
          disabled={pending || !initial.githubLinked}
          aria-busy={pending}
        >
          {pending ? 'Saving...' : 'Enter Mission Control'}
        </Button>
      </div>
    </form>
  );
}

function SectionHeader({
  index,
  title,
  complete,
}: {
  index: string;
  title: string;
  complete: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <span className="border-border text-muted-foreground flex size-6 items-center justify-center rounded-md border text-xs tabular-nums">
          {index}
        </span>
        {title}
      </h2>
      {complete ? (
        <span className="text-success inline-flex items-center gap-1.5 text-xs font-medium">
          <CheckCircle2 className="size-4" aria-hidden />
          Complete
        </span>
      ) : null}
    </div>
  );
}
