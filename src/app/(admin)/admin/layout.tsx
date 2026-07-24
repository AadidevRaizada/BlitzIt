import Link from 'next/link';
import { requireAdmin } from '@/server/modules/auth';
import { SignOutButton } from '@/components/features/sign-out-button';

/**
 * Guarded layout for the admin panel. Requires an ADMIN role; signed-in
 * non-admins are redirected to the dashboard, signed-out users to /login.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin('/admin');

  return (
    <div className="min-h-screen">
      <header className="border-border bg-muted flex items-center justify-between border-b px-6 py-3">
        <nav className="flex items-center gap-4 text-sm">
          <span className="font-semibold">Blitz It · Admin</span>
          <Link href="/admin" className="hover:underline">
            Overview
          </Link>
          <Link href="/dashboard" className="hover:underline">
            Back to app
          </Link>
        </nav>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{user.username} (admin)</span>
          <SignOutButton />
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
