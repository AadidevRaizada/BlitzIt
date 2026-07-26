import Link from 'next/link';
import {
  BookOpen,
  Crown,
  Home,
  ListChecks,
  Play,
  Radio,
  Trophy,
  UserRound,
} from 'lucide-react';
import { getCurrentUser } from '@/server/modules/auth';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/', label: 'Play', icon: Play },
  { href: '/leaderboard', label: 'Ranking', icon: ListChecks },
  { href: '/hall-of-fame', label: 'Hall', icon: Crown },
  { href: '/rules', label: 'Rules', icon: BookOpen },
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
      <header className="border-hairline bg-surface-deep/95 sticky top-0 z-50 border-b backdrop-blur lg:hidden">
        <div className="flex min-h-16 items-center justify-between gap-4 px-4">
          <Link
            href="/"
            className="focus-visible:ring-ring inline-flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="bg-secondary text-secondary-foreground flex size-8 items-center justify-center rounded-md">
              <Radio className="size-4" aria-hidden />
            </span>
            <span className="text-lg font-extrabold tracking-[-0.03em]">
              The Circuit
            </span>
          </Link>

          <Link
            href={user ? '/dashboard' : '/login'}
            className={cn(buttonVariants({ variant: 'broadcast', size: 'sm' }))}
          >
            {user ? 'Dashboard' : 'Sign In'}
          </Link>
        </div>
      </header>

      <aside className="border-hairline bg-surface-deep fixed inset-y-0 left-0 z-50 hidden w-[92px] flex-col border-r lg:flex">
        <Link
          href="/"
          className="border-hairline focus-visible:ring-ring flex h-20 items-center justify-center border-b px-3 focus-visible:ring-2 focus-visible:outline-none"
          aria-label="The Circuit home"
        >
          <span className="bg-secondary text-secondary-foreground flex size-12 items-center justify-center rounded-md shadow-[var(--glow-live)]">
            <Radio className="size-6" aria-hidden />
          </span>
        </Link>

        <nav aria-label="Marketing navigation" className="flex flex-1 flex-col">
          {navItems.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                className="font-pixel text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring flex min-h-18 flex-col items-center justify-center gap-2 px-2 text-center text-[0.68rem] font-bold uppercase focus-visible:ring-2 focus-visible:outline-none"
              >
                <Icon className="size-6" aria-hidden />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <Link
          href={user ? '/dashboard' : '/login'}
          className="font-pixel border-hairline text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring flex min-h-18 flex-col items-center justify-center gap-2 border-t px-2 text-center text-[0.68rem] font-bold uppercase focus-visible:ring-2 focus-visible:outline-none"
        >
          <UserRound className="size-6" aria-hidden />
          <span>{user ? 'Dashboard' : 'Login'}</span>
        </Link>
      </aside>

      <div className="lg:pl-[92px]">{children}</div>

      <footer className="border-hairline bg-surface-deep border-t">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.5fr_1fr] lg:pl-[116px]">
          <div>
            <div className="flex items-center gap-2 font-extrabold">
              <Trophy className="text-secondary size-5" aria-hidden />
              The Circuit
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
