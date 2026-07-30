import Link from 'next/link';
import { FlaskConical, Globe } from 'lucide-react';
import type { EnvironmentScope } from '@/server/modules/tournament';
import { cn } from '@/lib/utils';

/**
 * Production ⇄ Test switch for admin surfaces.
 *
 * Deliberately a pair of links rather than a client-side toggle: the scope is
 * resolved on the server from `?env`, so the URL IS the state. That makes the
 * current environment shareable, bookmarkable, and — the part that matters —
 * visible in the address bar, so an operator can never be confused about which
 * world the numbers on the page describe.
 *
 * Rendered only where an admin is already authenticated. It is a navigation
 * control, not a permission: `parseEnvironmentParam` grants nothing, and every
 * page behind it re-derives its own access.
 */
export function EnvironmentSwitch({
  current,
  basePath,
}: {
  current: EnvironmentScope;
  /** Path to link back to, without the query string. */
  basePath: string;
}) {
  const options = [
    { scope: 'PRODUCTION' as const, label: 'Production', icon: Globe },
    { scope: 'TEST' as const, label: 'Test', icon: FlaskConical },
  ];

  return (
    <div
      className="border-border bg-surface inline-flex items-center rounded-lg border p-0.5"
      role="group"
      aria-label="Environment"
    >
      {options.map(({ scope, label, icon: Icon }) => {
        const active = current === scope;
        return (
          <Link
            key={scope}
            href={scope === 'PRODUCTION' ? basePath : `${basePath}?env=test`}
            aria-current={active ? 'true' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              active
                ? scope === 'TEST'
                  ? 'bg-warning/15 text-warning'
                  : 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * A persistent marker that the surrounding page is showing test data.
 *
 * The whole premise of this feature is that the test experience is
 * indistinguishable from the real one — which is exactly what makes an
 * unlabelled test page dangerous for an ADMIN, who can act on both. Competitor
 * surfaces do not render this; operator surfaces always do.
 */
export function TestEnvironmentBanner() {
  return (
    <div className="border-warning/40 bg-warning/10 text-warning flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm">
      <FlaskConical className="size-4 shrink-0" aria-hidden />
      <p>
        <strong className="font-semibold">Test environment.</strong> Nothing
        here reaches production leaderboards, rankings, statistics or the Hall
        of Fame.
      </p>
    </div>
  );
}
