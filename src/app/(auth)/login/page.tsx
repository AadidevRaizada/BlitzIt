import { redirect } from 'next/navigation';
import { enabledProviders } from '@/server/auth';
import { getSession } from '@/server/modules/auth';
import { LoginButtons } from './login-buttons';

export const metadata = { title: 'Sign in — Blitz It' };

/**
 * Login screen (E1). Functional, not styled — visual polish comes later.
 * Already-authenticated visitors are bounced to their intended destination.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string; error?: string }>;
}) {
  const { callbackURL, error } = await searchParams;
  const session = await getSession();
  if (session) redirect(safeCallback(callbackURL));

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold">Sign in to Blitz It</h1>
          <p className="text-muted-foreground text-sm">
            15 Minutes. One Shot. Just Ship.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
          >
            Sign-in failed. Please try again.
          </p>
        ) : null}

        {enabledProviders.length > 0 ? (
          <LoginButtons
            providers={enabledProviders}
            callbackURL={safeCallback(callbackURL)}
          />
        ) : (
          <div className="border-border bg-muted rounded-md border px-3 py-3 text-sm">
            <p className="font-medium">No sign-in providers configured.</p>
            <p className="text-muted-foreground mt-1">
              Add GitHub/Google OAuth credentials to <code>.env.local</code>.
              See <code>docs/oauth-setup.md</code>.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * Only allow same-site relative paths as a post-login redirect, so a crafted
 * `?callbackURL=https://evil.example` cannot turn login into an open redirect.
 */
function safeCallback(value: string | undefined): string {
  if (!value) return '/dashboard';
  if (!value.startsWith('/') || value.startsWith('//')) return '/dashboard';
  return value;
}
