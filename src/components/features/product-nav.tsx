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
import { BrandLockup, Monogram, Wordmark } from '@/components/ui/wordmark';
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

      {/*
       * The rail: 64px of chrome, not 176px.
       *
       * The old sidebar spent a sixth of a 1080p viewport on five links, each
       * a 72px-tall stack of icon-over-caps-label. Here the resting state is
       * icons only, and hovering (or tabbing into) the rail expands it to 224px
       * OVER the page — `lg:pl-16` in the shell never changes, so labels cost
       * discoverability, not layout shift. Every icon still carries its label
       * in the accessibility tree at all times.
       */}
      <aside
        className={cn(
          // No `overflow-hidden`: the user menu opens outside the rail and
          // would be clipped by it. Labels are clipped individually instead,
          // by `truncate` inside a `min-w-0 flex-1` slot.
          'group/rail border-hairline bg-surface-deep/95 fixed inset-y-0 left-0 z-50 hidden w-16 flex-col border-r backdrop-blur lg:flex',
          'transition-[width,box-shadow] duration-[var(--motion-base)] ease-[var(--ease-out-quart)]',
          'focus-within:w-56 focus-within:shadow-lg hover:w-56 hover:shadow-lg',
        )}
      >
        {/*
         * The mark alone. The rail used to stack "DEVHUB" above the wordmark,
         * which spent the most valuable pixels on the site explaining our org
         * chart to a competitor who came here to find a tournament. The org
         * still gets its credit — in the footer, where that belongs.
         */}
        <Link
          href="/"
          className="border-hairline focus-visible:ring-ring group/brand flex h-16 shrink-0 items-center gap-3 border-b px-4 focus-visible:ring-2 focus-visible:-outline-offset-2"
          aria-label="The Circuit home"
        >
          <span className="flex w-8 shrink-0 justify-center">
            <Monogram className="text-primary h-6 transition-transform duration-[var(--motion-base)] ease-[var(--ease-out-expo)] group-hover/brand:scale-110" />
          </span>
          <RailLabel>
            <Wordmark className="h-8" />
          </RailLabel>
        </Link>

        <nav
          aria-label="Primary navigation"
          className="flex flex-1 flex-col gap-0.5 py-3"
        >
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
            className="border-hairline text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring flex h-14 shrink-0 items-center gap-3 border-t px-4 text-sm font-medium focus-visible:ring-2 focus-visible:-outline-offset-2"
          >
            <span className="flex w-8 shrink-0 justify-center">
              <UserRound className="size-[18px]" aria-hidden />
            </span>
            <RailLabel>Sign in</RailLabel>
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
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.5fr_1fr]">
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

/**
 * A rail label. Present in the accessibility tree at every width; painted only
 * once the rail is expanded, so the collapsed state stays icons-only without
 * hiding anything from a screen reader.
 */
function RailLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'min-w-0 flex-1 truncate whitespace-nowrap opacity-0',
        'transition-opacity duration-[var(--motion-fast)]',
        'group-focus-within/rail:opacity-100 group-hover/rail:opacity-100',
        className,
      )}
    >
      {children}
    </span>
  );
}

function CommunityLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="nofollow noopener noreferrer"
      className="border-hairline text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring flex h-12 shrink-0 items-center gap-3 border-t px-4 text-sm focus-visible:ring-2 focus-visible:-outline-offset-2"
    >
      <span className="flex w-8 shrink-0 justify-center">
        <WhatsAppIcon className="size-[18px]" />
      </span>
      <RailLabel>Join community</RailLabel>
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

  if (compact) {
    return (
      <Link
        href={item.href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring',
          'inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md px-3 text-[0.8125rem] font-medium',
          'transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:outline-none',
          active && 'bg-primary/12 text-primary',
        )}
      >
        <Icon className="size-4" aria-hidden />
        <span>{item.label}</span>
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring',
        'flex h-11 shrink-0 items-center gap-3 px-4 text-sm font-medium',
        'transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:-outline-offset-2',
        // The icon is the only thing visible at 64px, so it carries the whole
        // hover response.
        '[&_svg]:transition-transform [&_svg]:duration-[var(--motion-base)] [&_svg]:ease-[var(--ease-out-expo)]',
        'hover:[&_svg]:scale-110',
        // Active nav is blue, per the accent policy. The inset bar survives the
        // collapsed rail, where a label cannot.
        active &&
          'bg-surface-raised text-primary shadow-[inset_2px_0_0_var(--color-primary)]',
      )}
    >
      <span className="flex w-8 shrink-0 justify-center">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      <RailLabel>{item.label}</RailLabel>
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
          'text-muted-foreground hover:bg-surface-raised hover:text-foreground focus-visible:ring-ring flex cursor-pointer list-none items-center font-medium focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden',
          active && 'bg-surface-raised text-foreground',
          mobile
            ? 'min-h-9 gap-2 rounded-md px-2 text-[0.8125rem]'
            : 'h-14 gap-3 px-4 text-sm',
        )}
      >
        <span
          className={cn(
            'relative flex shrink-0 justify-center',
            mobile ? '' : 'w-8',
          )}
        >
          {mobile ? (
            <UserRound className="size-4" aria-hidden />
          ) : (
            // An initial in a ring reads as "you" faster than a generic person
            // glyph, and it is the only avatar we can render without an upload.
            <span className="bg-primary/15 text-primary ring-primary/30 font-display flex size-8 items-center justify-center rounded-full text-xs font-bold uppercase ring-1">
              {user.username.slice(0, 2)}
            </span>
          )}
          {user.unread > 0 ? (
            <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] leading-4 font-black tabular-nums">
              {user.unread > 99 ? '99+' : user.unread}
            </span>
          ) : null}
        </span>
        {mobile ? (
          <span className="max-w-24 truncate">{user.username}</span>
        ) : (
          <RailLabel>{user.username}</RailLabel>
        )}
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
