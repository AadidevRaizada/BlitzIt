import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ProductShell } from '@/components/features/product-shell';
import { Card } from '@/components/ui/card';
import { DisplayHeading } from '@/components/ui/display-heading';
import { Eyebrow } from '@/components/ui/eyebrow';
import { PREVIEW_USER } from '@/app/preview/_fixtures';

/**
 * Index of the design previews.
 *
 * Every route below renders the same components the live pages render, against
 * fixtures instead of Prisma — so a layout can be reviewed without a database,
 * and so the states that are hardest to produce on demand (an empty calendar, a
 * standby front page) can be looked at directly.
 */
export const metadata = {
  title: 'Preview - The Circuit',
  robots: { index: false, follow: false },
};

const PAGES: Array<{
  href: string;
  title: string;
  live: string;
  states: Array<{ href: string; label: string }>;
}> = [
  {
    href: '/preview/home',
    title: 'Home',
    live: '/',
    states: [
      { href: '/preview/home', label: 'Live tournament' },
      { href: '/preview/home?state=standby', label: 'Standby' },
    ],
  },
  {
    href: '/preview/tournaments',
    title: 'Tournaments',
    live: '/tournaments',
    states: [
      { href: '/preview/tournaments', label: 'Full calendar' },
      { href: '/preview/tournaments?filter=open', label: 'Registering only' },
      { href: '/preview/tournaments?state=empty', label: 'Nothing scheduled' },
    ],
  },
  {
    href: '/preview/leaderboard',
    title: 'Leaderboard',
    live: '/leaderboard',
    states: [
      { href: '/preview/leaderboard', label: 'Ranked field' },
      { href: '/preview/leaderboard?by=city', label: 'Sorted by city' },
      { href: '/preview/leaderboard?state=empty', label: 'No standings' },
    ],
  },
  {
    href: '/preview/hall-of-fame',
    title: 'Hall of Fame',
    live: '/hall-of-fame',
    states: [
      { href: '/preview/hall-of-fame', label: 'Three champions' },
      { href: '/preview/hall-of-fame?state=empty', label: 'No champions yet' },
    ],
  },
  {
    href: '/preview/dashboard',
    title: 'Mission Control',
    live: '/dashboard',
    states: [
      { href: '/preview/dashboard', label: 'Registered competitor' },
      { href: '/preview/dashboard?state=empty', label: 'Nothing to enter' },
    ],
  },
];

export default function PreviewIndexPage() {
  return (
    <ProductShell surface="broadcast" user={PREVIEW_USER}>
      <div className="bg-background text-foreground min-h-screen">
        <header className="field-backdrop border-hairline border-b">
          <div className="mx-auto max-w-4xl px-5 py-14 sm:px-8">
            <Eyebrow tone="primary">Design</Eyebrow>
            <DisplayHeading as="h1" size="section" className="text-raked mt-4">
              Page previews
            </DisplayHeading>
            <p className="text-muted-foreground mt-5 max-w-lg text-sm leading-6">
              The real components, rendered from fixtures. No database, and no
              mock-up that can drift from what ships.
            </p>
          </div>
        </header>

        <div className="mx-auto grid max-w-4xl gap-4 px-5 py-10 sm:px-8">
          {PAGES.map((page) => (
            <Card
              key={page.href}
              surface="broadcast"
              className="edge-light overflow-hidden p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <DisplayHeading size="panel" className="text-lg">
                  {page.title}
                </DisplayHeading>
                <span className="text-muted-foreground font-mono text-xs">
                  {page.live}
                </span>
              </div>
              <ul className="mt-4 flex flex-wrap gap-2">
                {page.states.map((state) => (
                  <li key={state.href}>
                    <Link
                      href={state.href}
                      className="border-hairline bg-surface-deep/60 hover:border-primary/40 hover:text-primary focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:outline-none [&_svg]:transition-transform hover:[&_svg]:translate-x-0.5"
                    >
                      {state.label}
                      <ArrowRight className="size-3.5" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </div>
    </ProductShell>
  );
}
