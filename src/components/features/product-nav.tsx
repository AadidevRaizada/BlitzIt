'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Bell,
  Crown,
  Gauge,
  Home,
  Settings,
  Trophy,
  UserRound,
} from 'lucide-react';
import { SignOutButton } from '@/components/features/sign-out-button';
import { WhatsAppIcon } from '@/components/ui/brand-icons';
import { BrandLockup, Monogram } from '@/components/ui/wordmark';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ProductNavUser {
  username: string;
  profileHref: string;
  unread: number;
  isAdmin: boolean;
  /**
   * May this viewer reach the TEST environment? Drives the `/test` link, which
   * is the only way a tester discovers those surfaces — they are deliberately
   * absent from every public listing.
   */
  canAccessTest: boolean;
}

const primaryNavItems = [
  { href: '/', label: 'Home', icon: Home, exact: true },
  { href: '/tournaments', label: 'Tournaments', icon: Trophy },
  { href: '/leaderboard', label: 'Leaderboard', icon: BarChart3 },
  { href: '/hall-of-fame', label: 'Hall of Fame', icon: Crown },
  { href: '/dashboard', label: 'Mission Control', icon: Gauge },
];

const workspaceLinks = [
  { href: '/submissions', label: 'Submissions' },
  { href: '/results', label: 'Results' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/settings', label: 'Settings' },
];

const legalLinks = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/refunds', label: 'Refunds' },
];

export function ProductNav({
  user,
  communityHref,
}: {
  user: ProductNavUser | null;
  communityHref?: string | null;
}) {
  const pathname = usePathname();

  return (
    <>
      <header className="border-hairline bg-surface-deep/95 sticky top-0 z-50 border-b backdrop-blur lg:hidden">
        <div className="flex min-h-16 items-center justify-between gap-3 px-4">
          <BrandMark />
          {user ? (
            <UserMenu user={user} pathname={pathname} mobile />
          ) : (
            <Link
              href="/login?next=/dashboard"
              className={cn(
                buttonVariants({ variant: 'broadcast', size: 'sm' }),
              )}
            >
              Sign In
            </Link>
          )}
        </div>
        <nav
          aria-label="Primary navigation"
          className="border-hairline flex gap-1 overflow-x-auto border-t px-2 py-2"
        >
          {primaryNavItems.map((item) => (
            <PrimaryNavLink
              key={item.href}
              item={item}
              pathname={pathname}
              compact
            />
          ))}
        </nav>
      </header>

      <aside className="border-hairline bg-surface-deep fixed inset-y-0 left-0 z-50 hidden w-[176px] flex-col border-r lg:flex">
        <Link
          href="/"
          className="border-hairline focus-visible:ring-ring flex h-20 items-center justify-start border-b px-4 focus-visible:ring-2 focus-visible:outline-none"
          aria-label="The Circuit home"
        >
          <BrandLockup />
        </Link>

        <nav aria-label="Primary navigation" className="flex flex-1 flex-col">
          {primaryNavItems.map((item) => (
            <PrimaryNavLink key={item.href} item={item} pathname={pathname} />
          ))}
        </nav>

        {communityHref ? <CommunityLink href={communityHref} /> : null}

        {user ? (
          <UserMenu user={user} pathname={pathname} />
        ) : (
          <Link
            href="/login?next=/dashboard"
            className="font-display border-hairline text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring flex min-h-18 flex-col items-center justify-center gap-2 border-t px-2 text-center text-[0.68rem] font-bold uppercase focus-visible:ring-2 focus-visible:outline-none"
          >
            <UserRound className="size-6" aria-hidden />
            <span>Login</span>
          </Link>
        )}
      </aside>
    </>
  );
}

export function ProductFooter({
  communityHref,
}: {
  communityHref?: string | null;
}) {
  return (
    <footer className="border-hairline bg-surface-deep border-t">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.5fr_1fr] lg:pl-[116px]">
        <div>
          <BrandLockup />
          <p className="text-muted-foreground mt-3 max-w-xl text-sm">
            Weekly builder tournaments, scored by measurable product behavior,
            then settled live in a knockout bracket.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 md:justify-end">
          {[...primaryNavItems, ...legalLinks].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-md text-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              {item.label}
            </Link>
          ))}
          {communityHref ? (
            <Link
              href={communityHref}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md text-sm focus-visible:ring-2 focus-visible:outline-none"
              target="_blank"
              rel="nofollow noopener noreferrer"
            >
              <WhatsAppIcon className="size-4" />
              Community
            </Link>
          ) : null}
        </div>
      </div>
    </footer>
  );
}

function CommunityLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="nofollow noopener noreferrer"
      className="font-display border-hairline text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring flex min-h-14 items-center gap-2 border-t px-4 text-[0.68rem] font-bold uppercase focus-visible:ring-2 focus-visible:outline-none"
    >
      <WhatsAppIcon className="size-4" />
      <span>Join community</span>
    </Link>
  );
}

function BrandMark() {
  return (
    <Link
      href="/"
      className="focus-visible:ring-ring inline-flex items-center gap-2 rounded-md focus-visible:ring-2 focus-visible:outline-none"
    >
      <Monogram className="text-primary h-8" />
      <span className="text-lg font-extrabold">The Circuit</span>
    </Link>
  );
}

function PrimaryNavLink({
  item,
  pathname,
  compact = false,
}: {
  item: (typeof primaryNavItems)[number];
  pathname: string;
  compact?: boolean;
}) {
  const Icon = item.icon;
  const active = item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'font-display text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring font-bold uppercase focus-visible:ring-2 focus-visible:outline-none',
        'transition-colors duration-[var(--motion-fast)]',
        // Active nav is blue, per the accent policy. The rule used to be
        // `var(--secondary)`, which is now a neutral grey — it would have gone
        // invisible in the rebrand.
        active &&
          'bg-surface-raised text-primary shadow-[inset_3px_0_0_var(--color-primary)]',
        compact
          ? 'inline-flex min-h-10 shrink-0 items-center gap-2 rounded-md px-3 text-[0.68rem]'
          : 'flex min-h-18 flex-col items-center justify-center gap-2 px-2 text-center text-[0.68rem]',
      )}
    >
      <Icon className={compact ? 'size-4' : 'size-6'} aria-hidden />
      <span>{item.label}</span>
    </Link>
  );
}

function UserMenu({
  user,
  pathname,
  mobile = false,
}: {
  user: ProductNavUser;
  pathname: string;
  mobile?: boolean;
}) {
  const active =
    pathname === user.profileHref ||
    pathname === '/settings' ||
    pathname === '/notifications';

  return (
    <details
      className={cn(
        'group relative',
        mobile ? 'shrink-0' : 'border-hairline border-t',
      )}
    >
      <summary
        className={cn(
          'font-display text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring flex cursor-pointer list-none items-center font-bold uppercase focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden',
          active && 'bg-surface-raised text-foreground',
          mobile
            ? 'min-h-9 gap-2 rounded-md px-2 text-[0.68rem]'
            : 'min-h-18 flex-col justify-center gap-2 px-2 text-center text-[0.68rem]',
        )}
      >
        <span className="relative">
          <UserRound className={mobile ? 'size-4' : 'size-6'} aria-hidden />
          {user.unread > 0 ? (
            <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] leading-4 font-black tabular-nums">
              {user.unread > 99 ? '99+' : user.unread}
            </span>
          ) : null}
        </span>
        <span className={mobile ? 'max-w-24 truncate' : ''}>
          {user.username}
        </span>
      </summary>

      <div
        className={cn(
          'border-hairline bg-popover text-popover-foreground absolute z-50 w-56 rounded-lg border p-2 shadow-lg',
          mobile ? 'top-11 right-0' : 'bottom-2 left-[calc(100%+8px)]',
        )}
      >
        <MenuLink
          href={user.profileHref}
          active={pathname === user.profileHref}
        >
          Profile
        </MenuLink>
        {workspaceLinks.map((item) => (
          <MenuLink
            key={item.href}
            href={item.href}
            active={
              pathname === item.href || pathname.startsWith(`${item.href}/`)
            }
          >
            <span className="inline-flex items-center gap-2">
              {item.href === '/notifications' ? (
                <Bell className="size-4" aria-hidden />
              ) : null}
              {item.href === '/settings' ? (
                <Settings className="size-4" aria-hidden />
              ) : null}
              {item.label}
              {item.href === '/notifications' && user.unread > 0 ? (
                <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] leading-none font-black tabular-nums">
                  {user.unread > 99 ? '99+' : user.unread}
                </span>
              ) : null}
            </span>
          </MenuLink>
        ))}
        {user.canAccessTest ? (
          <MenuLink
            href="/test/tournaments"
            active={pathname.startsWith('/test/')}
          >
            Test environment
          </MenuLink>
        ) : null}
        {user.isAdmin ? (
          <MenuLink
            href="/admin"
            active={pathname === '/admin' || pathname.startsWith('/admin/')}
          >
            Admin
          </MenuLink>
        ) : null}
        <div className="border-hairline mt-2 border-t pt-2">
          <SignOutButton className="hover:bg-accent hover:text-accent-foreground w-full justify-start border-transparent bg-transparent px-2 py-1.5 text-left text-sm" />
        </div>
      </div>
    </details>
  );
}

function MenuLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring block rounded-md px-2 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none',
        active && 'bg-accent text-accent-foreground',
      )}
    >
      {children}
    </Link>
  );
}
