import Link from 'next/link';
import { Radio, Trophy } from 'lucide-react';
import { getCurrentUser } from '@/server/modules/auth';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Competitions' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/hall-of-fame', label: 'Hall of Fame' },
  { href: '/rules', label: 'Rules' },
];

export default async function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <div
      data-surface="broadcast"
      className="bg-background text-foreground min-h-screen"
    >
      <header className="border-hairline bg-surface-deep/95 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/"
            className="focus-visible:ring-ring inline-flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="bg-secondary text-secondary-foreground flex size-8 items-center justify-center rounded-md">
              <Radio className="size-4" aria-hidden />
            </span>
            <span className="text-lg font-extrabold tracking-[-0.03em]">
              Blitz It
            </span>
          </Link>

          <nav
            aria-label="Marketing navigation"
            className="hidden items-center gap-1 md:flex"
          >
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-md px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <Link
            href={user ? '/dashboard' : '/login'}
            className={cn(buttonVariants({ variant: 'broadcast', size: 'sm' }))}
          >
            {user ? 'Dashboard' : 'Sign In'}
          </Link>
        </div>
      </header>

      {children}

      <footer className="border-hairline bg-surface-deep border-t">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.5fr_1fr]">
          <div>
            <div className="flex items-center gap-2 font-extrabold">
              <Trophy className="text-secondary size-5" aria-hidden />
              Blitz It
            </div>
            <p className="text-muted-foreground mt-3 max-w-xl text-sm">
              Weekly builder tournaments, scored by measurable product behavior,
              then settled live in a knockout bracket.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 md:justify-end">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-md text-sm focus-visible:ring-2 focus-visible:outline-none"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
