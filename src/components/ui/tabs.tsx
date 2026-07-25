import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Tabs, implemented as links over a `?tab=` search param rather than as a
 * client widget.
 *
 * Why: each tab of the tournament detail page loads different server data. A
 * client tab component would either fetch everything up front (slow, and most
 * of it unread) or need its own loading machinery. Links keep every tab a plain
 * RSC render, make tabs deep-linkable and back-button friendly, and cost zero
 * client JavaScript.
 *
 * `aria-current="page"` marks the active tab; the list is a `nav` because these
 * are genuinely navigations, not an ARIA tablist.
 */
export interface TabItem {
  key: string;
  label: string;
  href: string;
  /** Optional count shown after the label. */
  badge?: number | string;
}

export function TabNav({
  tabs,
  active,
  className,
  label = 'Sections',
}: {
  tabs: readonly TabItem[];
  active: string;
  className?: string;
  label?: string;
}) {
  return (
    <nav aria-label={label} className={cn('border-border border-b', className)}>
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'focus-visible:ring-ring inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none',
                  isActive
                    ? 'border-primary text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground border-transparent',
                )}
              >
                {tab.label}
                {tab.badge !== undefined ? (
                  <span className="bg-muted text-muted-foreground rounded-sm px-1.5 py-0.5 text-xs tabular-nums">
                    {tab.badge}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
