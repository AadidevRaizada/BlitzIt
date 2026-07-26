import Link from 'next/link';
import { requireUser } from '@/server/modules/auth';
import { isAdmin } from '@/server/modules/auth';
import { countUnreadNotifications } from '@/server/modules/notification';
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
  const unread = await countUnreadNotifications(user.id);

  return (
    <div className="min-h-screen">
      <header className="border-border flex items-center justify-between border-b px-6 py-3">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/dashboard" className="font-semibold">
            The Circuit
          </Link>
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
          <Link href="/tournaments" className="hover:underline">
            Tournaments
          </Link>
          <Link href="/leaderboard" className="hover:underline">
            Leaderboard
          </Link>
          <Link href="/hall-of-fame" className="hover:underline">
            Hall of Fame
          </Link>
          <Link href="/submissions" className="hover:underline">
            Submissions
          </Link>
          <Link href="/results" className="hover:underline">
            Results
          </Link>
          {/* The unread count is read here rather than inside the link so the
              whole header stays one server render (E8.3). */}
          <Link
            href="/notifications"
            className="inline-flex items-center gap-1.5 hover:underline"
          >
            Notifications
            {unread > 0 ? (
              <span className="bg-primary text-primary-foreground inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] leading-none font-semibold tabular-nums">
                {unread > 99 ? '99+' : unread}
              </span>
            ) : null}
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
