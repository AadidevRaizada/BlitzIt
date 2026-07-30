import Link from 'next/link';
import { getCurrentUser } from '@/server/modules/auth';
import type { EnvironmentScope } from '@/server/modules/tournament';
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
import { Eyebrow } from '@/components/ui/eyebrow';
import { Section } from '@/components/ui/section';
import { cn } from '@/lib/utils';

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
 * The leaderboard, for ONE environment.
 *
 * Both `/leaderboard` and `/test/leaderboard` render this exact component with
 * a different `scope` and `basePath`. That is the whole mechanism behind "there
 * should be no special testing UI": the test experience is not a copy of the
 * competitor experience that has to be kept in step with it — it is the same
 * component, pointed at other data. A change to how standings look reaches both
 * surfaces because there is only one of them.
 */
export async function LeaderboardView({
  scope,
  basePath,
  by,
}: {
  scope: EnvironmentScope;
  /** Where the sort links point — `/leaderboard` or `/test/leaderboard`. */
  basePath: string;
  by?: string;
}) {
  const order = parseOrder(by);

  const [tournamentId, user] = await Promise.all([
    getSpectatorTournamentId(scope),
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
            <Eyebrow tone="primary">Current standings</Eyebrow>
            <DisplayHeading as="h1" className="mt-3">
              Leaderboard
            </DisplayHeading>
            <p className="text-muted-foreground mt-3 max-w-2xl text-lg">
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
              className="text-primary focus-visible:ring-ring rounded-md text-sm font-semibold hover:brightness-125 focus-visible:ring-2 focus-visible:outline-none"
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
                href={`${basePath}?by=${option.value}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'focus-visible:ring-ring rounded-md px-3 py-2 text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none',
                  'transition-colors duration-[var(--motion-fast)]',
                  active
                    ? 'bg-primary text-primary-foreground shadow-[var(--glow-primary)]'
                    : 'border-hairline bg-surface-raised hover:bg-surface-elevated hover:border-primary/40 border',
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
