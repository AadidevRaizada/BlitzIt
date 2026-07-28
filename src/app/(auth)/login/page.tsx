import Link from 'next/link';
import { redirect } from 'next/navigation';
import { enabledProviders } from '@/server/auth';
import { getSession } from '@/server/modules/auth';
import { DisplayHeading } from '@/components/ui/display-heading';
import { Eyebrow } from '@/components/ui/eyebrow';
import { LoginButtons } from './login-buttons';

export const metadata = { title: 'Sign in - The Circuit' };

/**
 * Login screen (E1). Functional, not styled — visual polish comes later.
 * Already-authenticated visitors are bounced to their intended destination.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    callbackURL?: string;
    next?: string;
    error?: string;
  }>;
}) {
  const { callbackURL, next, error } = await searchParams;
  const returnTo = safeCallback(next ?? callbackURL);
  const session = await getSession();
  if (session) redirect(returnTo);

  return (
    // `data-surface` puts the sign-in screen on the same near-black broadcast
    // palette as the rest of the product. It previously rendered on the bare
    // light `:root` tokens with no shell, so arriving here from the marketing
    // site meant a jarring white flash and a different-looking product.
    <div
      data-surface="broadcast"
      className="bg-background text-foreground flex min-h-screen items-center justify-center p-8"
    >
      <main className="w-full max-w-sm">
        <div className="text-center">
          <Eyebrow tone="primary" className="justify-center">
            The Circuit
          </Eyebrow>
          <DisplayHeading as="h1" size="compact" className="mx-auto mt-3">
            Sign in to compete
          </DisplayHeading>
          <p className="text-muted-foreground mt-2 text-sm">
            15 minutes. One shot. Just ship.
          </p>
        </div>

        {error ? (
          <p
            role="alert"
            className="border-destructive/40 bg-destructive/10 text-destructive mt-6 rounded-md border px-3 py-2 text-sm"
          >
            Sign-in failed. Please try again.
          </p>
        ) : null}

        <div className="mt-7">
          {enabledProviders.length > 0 ? (
            <LoginButtons providers={enabledProviders} callbackURL={returnTo} />
          ) : (
            <div className="border-border bg-surface-raised rounded-md border px-3 py-3 text-sm">
              <p className="font-medium">No sign-in providers configured.</p>
              <p className="text-muted-foreground mt-1">
                Add GitHub/Google OAuth credentials to <code>.env.local</code>.
                See <code>docs/oauth-setup.md</code>.
              </p>
            </div>
          )}
        </div>

        {/*
         * Browsing does not require an account — only registering and paying
         * does. Saying so here reduces the number of people who bounce at a
         * sign-in wall they did not actually need to clear.
         */}
        <p className="text-muted-foreground mt-6 text-center text-xs leading-5">
          You only need an account to register or pay.{' '}
          <Link
            href="/tournaments"
            className="text-primary rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            Browse tournaments
          </Link>{' '}
          without signing in.
        </p>
      </main>
    </div>
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
