import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { requireTestAccess } from '@/server/modules/auth';

/**
 * The TEST environment's surfaces (D35).
 *
 * ## Why a route group rather than a switch on the production routes
 *
 * The alternative was flipping `/leaderboard` and friends to test data from a
 * cookie. It was rejected on caching: reading a cookie forces a page dynamic for
 * every visitor, so the landing page and leaderboard would lose static rendering
 * for the entire public in order to serve a handful of testers.
 *
 * ## Why there is still no separate testing UI
 *
 * Every page under here is a thin shell that renders the SAME component the
 * production route renders, with a TEST scope. `LeaderboardView`,
 * `HallOfFameView` and `TournamentsView` each exist exactly once. A tester is
 * not looking at a replica of the competitor experience that somebody has to
 * remember to keep in step — they are looking at the competitor experience,
 * pointed at other data.
 *
 * ## The gate
 *
 * One `requireTestAccess` for the whole segment, which redirects a normal
 * competitor to their dashboard with no error code. `requireAdmin` appends
 * `?error=forbidden`; that would be a disclosure here, because a refusal that
 * names what it refused tells a production user there is a test area.
 */
export const dynamic = 'force-dynamic';

const LINKS = [
  { href: '/test/tournaments', label: 'Tournaments' },
  { href: '/test/leaderboard', label: 'Leaderboard' },
  { href: '/test/hall-of-fame', label: 'Hall of Fame' },
];

export default async function TestLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireTestAccess('/test/tournaments');

  return (
    <div>
      {/*
        Persistent and unmissable. The premise of this whole feature is that the
        test experience is indistinguishable from the real one, which is exactly
        what makes an unlabelled test page dangerous — a tester who forgets where
        they are will report a bug against the wrong world.
      */}
      <div className="border-warning/40 bg-warning/10 text-warning border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 text-sm sm:px-7">
          <span className="flex items-center gap-2 font-semibold">
            <FlaskConical className="size-4" aria-hidden />
            Test environment
          </span>
          <span className="text-warning/80">
            Nothing here reaches production leaderboards, rankings, statistics
            or the Hall of Fame.
          </span>
          <nav aria-label="Test surfaces" className="ml-auto flex gap-3">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="focus-visible:ring-ring rounded font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      {children}
    </div>
  );
}
