'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { signIn } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { GitHubIcon, GoogleIcon } from '@/components/ui/brand-icons';

type Provider = 'github' | 'google';

const LABELS: Record<Provider, string> = {
  github: 'Continue with GitHub',
  google: 'Continue with Google',
};

function ProviderIcon({ provider }: { provider: Provider }) {
  const Icon = provider === 'github' ? GitHubIcon : GoogleIcon;
  return <Icon className="size-4" />;
}

/**
 * OAuth sign-in. Only providers configured on the server are shown.
 *
 * GitHub is the primary path and gets the filled button — this is a developer
 * competition, so it is the account virtually every competitor already has,
 * and it is the same identity the submission flow reads from. Any other
 * provider renders as a secondary option so there is one obvious way in
 * rather than a row of equal-weight choices.
 */
export function LoginButtons({
  providers,
  callbackURL,
}: {
  providers: Provider[];
  callbackURL: string;
}) {
  const [pending, setPending] = useState<Provider | null>(null);

  async function handleSignIn(provider: Provider) {
    setPending(provider);
    try {
      await signIn.social({ provider, callbackURL });
    } catch {
      toast.error('Could not start sign-in. Please try again.');
      setPending(null);
    }
  }

  const primary = providers.includes('github') ? 'github' : providers[0];
  const others = providers.filter((provider) => provider !== primary);

  return (
    <div className="flex flex-col gap-3">
      {primary ? (
        <Button
          variant="broadcast"
          size="broadcast"
          onClick={() => handleSignIn(primary)}
          disabled={pending !== null}
          aria-busy={pending === primary}
          className="w-full"
        >
          <ProviderIcon provider={primary} />
          {pending === primary ? 'Redirecting…' : LABELS[primary]}
        </Button>
      ) : null}

      {others.map((provider) => (
        <Button
          key={provider}
          variant="secondary"
          size="lg"
          onClick={() => handleSignIn(provider)}
          disabled={pending !== null}
          aria-busy={pending === provider}
          className="w-full"
        >
          <ProviderIcon provider={provider} />
          {pending === provider ? 'Redirecting…' : LABELS[provider]}
        </Button>
      ))}
    </div>
  );
}
