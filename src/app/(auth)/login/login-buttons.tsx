'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { signIn } from '@/lib/auth-client';

type Provider = 'github' | 'google';

const LABELS: Record<Provider, string> = {
  github: 'Continue with GitHub',
  google: 'Continue with Google',
};

/** OAuth sign-in buttons. Only providers configured on the server are shown. */
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

  return (
    <div className="flex flex-col gap-3">
      {providers.map((provider) => (
        <button
          key={provider}
          type="button"
          onClick={() => handleSignIn(provider)}
          disabled={pending !== null}
          className="border-border bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
        >
          {pending === provider ? 'Redirecting…' : LABELS[provider]}
        </button>
      ))}
    </div>
  );
}
