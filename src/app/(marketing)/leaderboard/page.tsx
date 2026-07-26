import Link from 'next/link';
import { getCurrentUser } from '@/server/modules/auth';
import {
  getLeaderboard,
  getLiveSnapshot,
  getSpectatorTournamentId,
  getTournamentSummary,
  type LeaderboardOrder,
} from '@/server/modules/tournament';
import { LiveLeaderboard } from '@/components/features/live-leaderboard';
import { LiveRefresh } from '@/components/features/live-refresh';
import { Card } from '@/components/ui/card';
import { DisplayHeading } from '@/components/ui/display-heading';
import { Section } from '@/components/ui/section';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Leaderboard - Blitz It' };
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
      <main>
        <Section>
          <DisplayHeading as="h1">Leaderboard</DisplayHeading>
          <p className="text-muted-foreground mt-4">
            No tournament has run yet.
          </p>
        </Section>
      </main>
    );
  }

  const [summary, entries, snapshot] = await Promise.all([
    getTournamentSummary(tournamentId),
    getLeaderboard(tournamentId, { by: order, take: 200 }),
    getLiveSnapshot(tournamentId),
  ]);

  return (
    <main>
      <Section className="bg-surface-deep">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-secondary text-sm font-bold">
              Current standings
            </p>
            <DisplayHeading as="h1" className="mt-3">
              Leaderboard
            </DisplayHeading>
            <p className="text-muted-foreground mt-4 max-w-2xl text-lg">
              {summary.name}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LiveRefresh
              tournamentId={tournamentId}
              initialVersion={snapshot.version}
            />
            <Link
              href={`/bracket/${tournamentId}`}
              className="text-primary hover:text-secondary focus-visible:ring-ring rounded-md text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
            >
              Bracket
            </Link>
          </div>
        </div>
      </Section>

      <Section className="bg-background">
        <nav aria-label="Sort standings" className="mb-6 flex flex-wrap gap-2">
          {ORDERS.map((option) => {
            const active = option.value === order;
            return (
              <Link
                key={option.value}
                href={`/leaderboard?by=${option.value}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'focus-visible:ring-ring rounded-md px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none',
                  active
                    ? 'bg-secondary text-secondary-foreground'
                    : 'border-hairline bg-surface-raised hover:bg-surface-elevated border',
                )}
              >
                {option.label}
              </Link>
            );
          })}
        </nav>

        <Card surface="broadcast" className="max-h-[70vh] overflow-auto px-4">
          <LiveLeaderboard
            entries={entries}
            highlightUserId={user?.id ?? null}
            showCity={order === 'city' || order === 'score'}
            broadcast
            pinHighlighted
          />
        </Card>
      </Section>
    </main>
  );
}
