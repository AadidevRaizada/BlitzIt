import Link from 'next/link';
import { requireUser } from '@/server/modules/auth';
import { isAdmin } from '@/server/modules/auth';
import { SignOutButton } from '@/components/features/sign-out-button';

/**
 * Guarded layout for the authenticated app. Every route in this group requires
 * a session; unauthenticated visitors are redirected to /login.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  return (
    <div className="min-h-screen">
      <header className="border-border flex items-center justify-between border-b px-6 py-3">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="font-semibold">
            Blitz It
          </Link>
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <Link href={`/u/${user.username}`} className="hover:underline">
            Profile
          </Link>
          <Link href="/settings" className="hover:underline">
            Settings
          </Link>
          {isAdmin(user) ? (
            <Link href="/admin" className="text-primary hover:underline">
              Admin
            </Link>
          ) : null}
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{user.username}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
