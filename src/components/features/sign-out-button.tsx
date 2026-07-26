'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { signOut } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

/** Signs the user out and returns them to the landing page. */
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await signOut();
      // Refresh so server components re-render without the session.
      router.push('/');
      router.refresh();
    } catch {
      toast.error('Sign out failed. Please try again.');
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className={cn(
        'border-border hover:bg-muted inline-flex rounded-md border px-3 py-1.5 text-sm disabled:opacity-60',
        className,
      )}
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
