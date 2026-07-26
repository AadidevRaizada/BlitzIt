import Link from 'next/link';
import { getCurrentUser } from '@/server/modules/auth';
import {
  getLeaderboard,
  getSpectatorTournamentId,
  getTournamentSummary,
  type LeaderboardOrder,
} from '@/server/modules/tournament';
import { PageHeader } from '@/components/ui/page-header';
import { LiveLeaderboard } from '@/components/features/live-leaderboard';
import { LiveRefresh } from '@/components/features/live-refresh';
import { getLiveSnapshot } from '@/server/modules/tournament';

export const metadata = { title: 'Leaderboard — Blitz It' };
export const dynamic = 'force-dynamic';

const ORDERS: ReadonlyArray<{ value: LeaderboardOrder; label: string }> = [
  { value: 'score', label: 'Score' },
  { value: 'seed', label: 'Seed' },
  { value: 'city', label: 'City' },
];

function parseOrder(value: string | undefined): LeaderboardOrder {
  return ORDERS.some((order) => order.value === value)
    ? (value as LeaderboardOrder)
    : 'score';
}

/**
 * Screen [12] — the public leaderboard (E8.2).
 *
 * Public: standings are already visible on the landing page and in the live
 * snapshot, so requiring a session here would only hide them from the people
 * the spectator experience exists for.
 *
 * Sorting is a URL parameter, not client state — a particular view stays
 * linkable and shareable, and the page needs no JavaScript to change it.
 */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string }>;
}) {
  const { by } = await searchParams;
  const order = parseOrder(by);

  const [tournamentId, user] = await Promise.all([
    getSpectatorTournamentId(),
    getCurrentUser(),
  ]);

  if (!tournamentId) {
    return (
      <main className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6">
        <PageHeader
          title="Leaderboard"
          description="No tournament has run yet."
        />
      </main>
    );
  }

  const [summary, entries, snapshot] = await Promise.all([
    getTournamentSummary(tournamentId),
    getLeaderboard(tournamentId, { by: order, take: 200 }),
    getLiveSnapshot(tournamentId),
  ]);

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6">
      <PageHeader
        title="Leaderboard"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{summary.name}</span>
            <LiveRefresh
              tournamentId={tournamentId}
              initialVersion={snapshot.version}
            />
          </span>
        }
        actions={
          <Link
            href={`/bracket/${tournamentId}`}
            className="text-primary text-sm hover:underline"
          >
            Bracket →
          </Link>
        }
      />

      <nav aria-label="Sort standings" className="flex flex-wrap gap-2">
        {ORDERS.map((option) => {
          const active = option.value === order;
          return (
            <Link
              key={option.value}
              href={`/leaderboard?by=${option.value}`}
              aria-current={active ? 'page' : undefined}
              className={
                active
                  ? 'bg-primary text-primary-foreground focus-visible:ring-ring rounded-md px-3 py-1.5 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none'
                  : 'border-border hover:bg-muted focus-visible:ring-ring rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none'
              }
            >
              {option.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-border bg-card rounded-lg border px-4">
        <LiveLeaderboard
          entries={entries}
          highlightUserId={user?.id ?? null}
          showCity={order === 'city' || order === 'score'}
        />
      </div>
    </main>
  );
}
