import Link from 'next/link';
import { getCurrentUser } from '@/server/modules/auth';
import type { EnvironmentScope } from '@/server/modules/tournament';
import { Crown, GitBranch } from 'lucide-react';
import {
  getLeaderboard,
  getLiveSnapshot,
  getSpectatorTournamentId,
  getTournamentSummary,
  type LeaderboardEntry,
  type LeaderboardOrder,
} from '@/server/modules/tournament';
import { LiveLeaderboard } from '@/components/features/live-leaderboard';
import { LiveRefresh } from '@/components/features/live-refresh';
import { Card } from '@/components/ui/card';
import { DisplayHeading } from '@/components/ui/display-heading';
import { Eyebrow } from '@/components/ui/eyebrow';
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
      <LeaderboardStandings
        entries={[]}
        order={order}
        basePath={basePath}
        tournamentName={null}
        tournamentId={null}
        highlightUserId={null}
        liveVersion={null}
      />
    );
  }

  const [summary, entries, snapshot] = await Promise.all([
    getTournamentSummary(tournamentId),
    getLeaderboard(tournamentId, { by: order, take: 200 }),
    getLiveSnapshot(tournamentId),
  ]);

  return (
    <LeaderboardStandings
      entries={entries}
      order={order}
      basePath={basePath}
      tournamentName={summary.name}
      tournamentId={tournamentId}
      highlightUserId={user?.id ?? null}
      liveVersion={snapshot.version}
    />
  );
}

/**
 * The standings themselves, with the data already fetched. Split out so
 * `/preview/leaderboard` can render the real layout from fixtures.
 */
export function LeaderboardStandings({
  entries,
  order,
  basePath,
  tournamentName,
  tournamentId,
  highlightUserId,
  liveVersion,
}: {
  entries: LeaderboardEntry[];
  order: LeaderboardOrder;
  basePath: string;
  tournamentName: string | null;
  tournamentId: string | null;
  highlightUserId: string | null;
  /** Null when there is no tournament to poll. */
  liveVersion: string | null;
}) {
  // The podium is always the top three BY SCORE, whatever the table is sorted
  // by. Sorting by city and watching the podium reshuffle would imply the
  // ranking changed, which it did not.
  const ranked = [...entries].sort((a, b) => {
    if (a.placement != null && b.placement != null)
      return a.placement - b.placement;
    return b.simulationScore - a.simulationScore;
  });
  const podium = ranked.slice(0, 3);
  const leadScore = ranked[0]?.simulationScore ?? 0;
  const mine = highlightUserId
    ? ranked.findIndex((entry) => entry.userId === highlightUserId)
    : -1;

  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="field-backdrop border-hairline border-b">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:py-20">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <div className="stagger [--stagger-step:70ms]">
              <div className="flex items-center gap-2.5">
                <Eyebrow tone="primary">Current standings</Eyebrow>
                <span className="via-primary/40 h-px w-12 bg-gradient-to-r from-transparent to-transparent" />
              </div>
              <DisplayHeading
                as="h1"
                size="section"
                className="text-raked mt-4"
              >
                Leaderboard
              </DisplayHeading>
              <p className="text-muted-foreground mt-5 max-w-lg text-sm leading-6">
                {tournamentName
                  ? `Scored on measurable product behaviour. ${tournamentName}.`
                  : 'Scored on measurable product behaviour, not on opinion.'}
              </p>
              <Tally
                entries={ranked}
                leadScore={leadScore}
                myIndex={mine}
                hasUser={highlightUserId != null}
              />
            </div>

            {tournamentId ? (
              <div className="flex flex-wrap items-center gap-3">
                {liveVersion != null ? (
                  <LiveRefresh
                    tournamentId={tournamentId}
                    initialVersion={liveVersion}
                  />
                ) : null}
                <Link
                  href={`/bracket/${tournamentId}`}
                  className="border-hairline bg-surface-raised hover:border-primary/40 hover:bg-surface-elevated focus-visible:ring-ring inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:outline-none"
                >
                  <GitBranch className="size-4" aria-hidden />
                  Bracket
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {podium.length > 0 ? (
        <div className="mx-auto max-w-6xl px-5 pt-10 sm:px-8">
          <Podium entries={podium} highlightUserId={highlightUserId} />
        </div>
      ) : null}

      <nav
        aria-label="Sort standings"
        className="border-hairline bg-background/85 sticky top-0 z-30 mt-10 border-b backdrop-blur"
      >
        <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-5 py-2.5 sm:px-8">
          <span className="text-eyebrow text-muted-foreground mr-2 shrink-0 font-mono font-semibold uppercase">
            Sort
          </span>
          {ORDERS.map((option) => {
            const active = option.value === order;
            return (
              <Link
                key={option.value}
                href={`${basePath}?by=${option.value}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'focus-visible:ring-ring relative inline-flex shrink-0 items-center rounded-md px-3 py-2 text-sm whitespace-nowrap',
                  'transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:outline-none',
                  active
                    ? 'bg-surface-elevated text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-surface-raised',
                  active &&
                    'after:bg-primary after:absolute after:inset-x-3 after:-bottom-2.5 after:h-0.5 after:rounded-full',
                )}
              >
                {option.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        {entries.length === 0 ? (
          <div className="field-backdrop edge-light border-hairline overflow-hidden rounded-xl border px-6 py-16 text-center">
            <div className="relative mx-auto flex size-24 items-center justify-center">
              <span
                className="border-primary/15 absolute inset-0 rounded-full border motion-safe:animate-[var(--animate-live-pulse)]"
                aria-hidden
              />
              <span
                className="border-hairline absolute inset-3 rounded-full border"
                aria-hidden
              />
              <Crown className="text-primary relative size-7" aria-hidden />
            </div>
            <DisplayHeading size="compact" className="text-raked mt-7">
              No standings yet
            </DisplayHeading>
            <p className="text-muted-foreground mx-auto mt-3 max-w-md text-sm leading-6">
              Rankings appear the moment the qualifying round is scored. Nobody
              is ranked on intent here.
            </p>
          </div>
        ) : (
          // No inner scroll container: `max-h-[70vh] overflow-auto` boxed the
          // standings in their own scrollbar, so the page had two, and reading
          // a ranking meant scrolling a window inside a window. The table now
          // flows with the page, which is what a leaderboard should do.
          <Card surface="broadcast" className="edge-light overflow-hidden p-0">
            <LiveLeaderboard
              entries={entries}
              highlightUserId={highlightUserId}
              showCity={order === 'city' || order === 'score'}
              broadcast
              pinHighlighted
              leadScore={leadScore}
            />
          </Card>
        )}
      </div>
    </div>
  );
}

/**
 * The season's numbers, in the hero. `Your rank` only appears for a signed-in
 * competitor who is actually in the field — a "—" where a rank should be is a
 * worse answer than not asking the question.
 */
function Tally({
  entries,
  leadScore,
  myIndex,
  hasUser,
}: {
  entries: LeaderboardEntry[];
  leadScore: number;
  myIndex: number;
  hasUser: boolean;
}) {
  if (entries.length === 0) return null;

  const qualified = entries.filter((entry) => entry.qualified).length;
  const items: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'In the field', value: entries.length },
    { label: 'Top score', value: leadScore.toFixed(1) },
    ...(qualified > 0 ? [{ label: 'Qualified', value: qualified }] : []),
    ...(hasUser && myIndex >= 0
      ? [
          {
            label: 'Your rank',
            value: <span className="text-primary">#{myIndex + 1}</span>,
          },
        ]
      : []),
  ];

  return (
    <dl className="border-hairline mt-8 flex flex-wrap gap-x-10 gap-y-4 border-t pt-6">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-eyebrow text-muted-foreground font-mono font-semibold uppercase">
            {item.label}
          </dt>
          <dd className="mt-1.5 font-mono text-lg font-bold tabular-nums">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Top three, as a podium.
 *
 * First place is physically taller than second and third — the ranking is
 * legible before a single number is read, which is the one job the top of a
 * leaderboard has. Order is 2-1-3 on desktop, matching a real podium, and
 * falls back to plain descending order on a narrow screen where the staging
 * would just be confusing.
 */
function Podium({
  entries,
  highlightUserId,
}: {
  entries: LeaderboardEntry[];
  highlightUserId: string | null;
}) {
  // Staged 2-1-3 with `order`, so the DOM keeps the true 1-2-3 sequence for a
  // screen reader and for narrow screens where the staging is dropped.
  const fallbackRank = [1, 2, 3];

  return (
    <ol className="stagger grid gap-4 sm:grid-cols-3 sm:items-end">
      {entries.map((entry, index) => {
        const rank = entry.placement ?? fallbackRank[index] ?? index + 1;
        const isFirst = index === 0;
        const mine = highlightUserId === entry.userId;

        return (
          <li
            key={entry.userId}
            className={cn(
              index === 0 && 'sm:order-2',
              index === 1 && 'sm:order-1',
              index === 2 && 'sm:order-3',
            )}
          >
            <Card
              surface="broadcast"
              interactive
              emphasis={isFirst ? 'primary' : 'default'}
              className={cn(
                'edge-light group relative overflow-hidden',
                isFirst && 'field-backdrop',
              )}
            >
              <Link
                href={`/u/${entry.username}`}
                className="focus-visible:ring-ring flex flex-col items-center rounded-lg px-5 py-6 text-center focus-visible:ring-2 focus-visible:outline-none"
              >
                <span
                  className={cn(
                    'flex items-center justify-center rounded-full font-mono font-bold tabular-nums',
                    'ring-1 transition-transform duration-[var(--motion-base)] ease-[var(--ease-out-expo)]',
                    'group-hover:scale-105',
                    isFirst
                      ? 'bg-primary/15 text-primary ring-primary/35 size-14 text-xl'
                      : 'bg-surface-elevated text-muted-foreground ring-hairline size-11 text-base',
                  )}
                >
                  {rank}
                </span>

                {isFirst ? (
                  <Crown
                    className="text-primary mt-3 size-4"
                    aria-label="Leader"
                  />
                ) : null}

                <p
                  className={cn(
                    'font-display mt-3 truncate font-bold tracking-[-0.02em]',
                    isFirst ? 'text-xl' : 'text-base',
                  )}
                >
                  {entry.displayName ?? entry.username}
                </p>
                <p className="text-muted-foreground mt-0.5 font-mono text-xs">
                  @{entry.username}
                  {mine ? <span className="text-primary"> · you</span> : null}
                </p>

                <p
                  className={cn(
                    'mt-4 font-mono font-bold tabular-nums',
                    isFirst ? 'text-primary text-3xl' : 'text-2xl',
                  )}
                >
                  {entry.simulationScore.toFixed(1)}
                </p>
                <p className="text-eyebrow text-muted-foreground mt-1 font-mono font-semibold uppercase">
                  Score
                </p>

                {/* The plinth. First place gets the tall one. */}
                <span
                  aria-hidden
                  className={cn(
                    'mt-5 w-full rounded-t-sm',
                    isFirst
                      ? 'bg-primary/25 h-6'
                      : index === 1
                        ? 'bg-surface-elevated h-4'
                        : 'bg-surface-elevated h-2.5',
                  )}
                />
              </Link>
            </Card>
          </li>
        );
      })}
    </ol>
  );
}
