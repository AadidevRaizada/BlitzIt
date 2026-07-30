'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bot,
  ClipboardList,
  CreditCard,
  FileCode2,
  Gauge,
  ScanSearch,
  ScrollText,
  Settings,
  Trophy,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Admin navigation.
 *
 * A client component only because the active item depends on the current path.
 * On md+ it is a sidebar; below that it collapses to a horizontally scrollable
 * strip so the whole platform stays reachable on a tablet in portrait.
 *
 * `aria-current="page"` marks the active item — the accent border alone would
 * not reach a screen reader.
 */
interface NavItem {
  href: string;
  label: string;
  icon: typeof Gauge;
  /** Match the path exactly — only the dashboard, which prefixes everything else. */
  exact?: boolean;
}

const ITEMS: readonly NavItem[] = [
  { href: '/admin', label: 'Dashboard', icon: Gauge, exact: true },
  { href: '/admin/tournaments', label: 'Tournaments', icon: Trophy },
  { href: '/admin/payments', label: 'Payments', icon: CreditCard },
  { href: '/admin/challenges', label: 'Challenges', icon: FileCode2 },
  { href: '/admin/submissions', label: 'Submissions', icon: ClipboardList },
  { href: '/admin/evaluations', label: 'Evaluations', icon: ScanSearch },
  { href: '/admin/users', label: 'Users', icon: Users },
  { href: '/admin/bots', label: 'Test bots', icon: Bot },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Admin sections"
      className="border-border bg-card md:bg-background border-b md:sticky md:top-[3.25rem] md:h-[calc(100vh-3.25rem)] md:border-r md:border-b-0"
    >
      <ul className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible md:p-3">
        {ITEMS.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'focus-visible:ring-ring flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none',
                  active
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
