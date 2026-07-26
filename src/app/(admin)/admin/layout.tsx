import Link from 'next/link';
import { requireAdmin } from '@/server/modules/auth';
import { SignOutButton } from '@/components/features/sign-out-button';
import { AdminNav } from './admin-nav';

/**
 * Guarded layout for the admin platform (E5). Requires an ADMIN role;
 * signed-in non-admins are redirected to the dashboard, signed-out users to
 * /login.
 *
 * Layout: a persistent sidebar on desktop and tablet, collapsing to a
 * horizontal scroller on narrow screens. Dense and quiet — the application
 * surface optimises for scanning, not decoration (design-system §1).
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin('/admin');

  return (
    <div className="bg-background min-h-screen">
      <header className="border-border bg-card sticky top-0 z-20 flex items-center justify-between border-b px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="focus-visible:ring-ring rounded-sm text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
          >
            The Circuit
            <span className="text-muted-foreground ml-1.5 font-normal">
              Admin
            </span>
          </Link>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href="/dashboard"
            className="text-muted-foreground hover:text-foreground hidden sm:inline"
          >
            Back to app
          </Link>
          <span className="text-muted-foreground hidden md:inline">
            {user.username}
          </span>
          <SignOutButton />
        </div>
      </header>

      <div className="md:grid md:grid-cols-[13rem_1fr]">
        <AdminNav />
        <main className="min-w-0 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
