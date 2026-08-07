import Link from 'next/link';
import { ArrowRight, Crown, Trophy } from 'lucide-react';
import {
  listHallOfFame,
  type HallOfFameEntry,
} from '@/server/modules/hall-of-fame';
import type { EnvironmentScope } from '@/server/modules/tournament';
import { Card } from '@/components/ui/card';
import { DisplayHeading } from '@/components/ui/display-heading';
import { Eyebrow } from '@/components/ui/eyebrow';
import { cn } from '@/lib/utils';

/**
 * The Hall of Fame, for ONE environment. Shared verbatim by `/hall-of-fame` and
 * `/test/hall-of-fame` — see `LeaderboardView` for why the test surfaces render
 * the same component rather than a copy of it.
 */
export async function HallOfFameView({ scope }: { scope: EnvironmentScope }) {
  const entries = await listHallOfFame(scope, { take: 100 });
  return <HallOfFameRecord entries={entries} />;
}

/**
 * The record itself, with the data already fetched. Split out so
 * `/preview/hall-of-fame` can render the real layout from fixtures.
 */
export function HallOfFameRecord({ entries }: { entries: HallOfFameEntry[] }) {
  const champions = new Set(
    entries.map((entry) => entry.champion?.userId).filter(Boolean),
  );
  const competitors = entries.reduce(
    (sum, entry) => sum + entry.participantCount,
    0,
  );

  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="field-backdrop border-hairline border-b">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:py-20">
          <div className="stagger [--stagger-step:70ms]">
            <div className="flex items-center gap-2.5">
              <Eyebrow tone="primary">Permanent record</Eyebrow>
              <span className="via-primary/40 h-px w-12 bg-gradient-to-r from-transparent to-transparent" />
            </div>
            <DisplayHeading as="h1" size="section" className="text-raked mt-4">
              Hall of Fame
            </DisplayHeading>
            <p className="text-muted-foreground mt-5 max-w-lg text-sm leading-6">
              Every finished tournament, its podium, and the field it was won
              against. Nothing here can be edited after the fact.
            </p>

            {entries.length > 0 ? (
              <dl className="border-hairline mt-8 flex flex-wrap gap-x-10 gap-y-4 border-t pt-6">
                {[
                  { label: 'Tournaments', value: entries.length },
                  { label: 'Champions', value: champions.size },
                  { label: 'Competitors faced', value: competitors },
                ].map((item) => (
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
            ) : null}
          </div>
        </div>
      </header>

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
              <Trophy className="text-primary relative size-7" aria-hidden />
            </div>
            <DisplayHeading size="compact" className="text-raked mt-7">
              No champions yet
            </DisplayHeading>
            <p className="text-muted-foreground mx-auto mt-3 max-w-md text-sm leading-6">
              The first tournament to finish is recorded here, permanently — the
              podium and the size of the field it was won against.
            </p>
          </div>
        ) : (
          <ol className="stagger grid gap-4">
            {entries.map((entry, index) => (
              <li key={entry.tournamentId}>
                <ChampionRow entry={entry} index={index} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

/**
 * One tournament's result.
 *
 * The row is built around a single claim — "X beat N people to win Y" — so the
 * champion's name is the largest thing on it and the podium behind them is
 * subordinate. The old card split the row 50/50 between the champion and the
 * tournament metadata, which made a win look like an administrative record.
 */
function ChampionRow({
  entry,
  index,
}: {
  entry: HallOfFameEntry;
  index: number;
}) {
  const champion = entry.champion;
  const isLatest = index === 0;

  return (
    <Card
      surface="broadcast"
      interactive
      emphasis={isLatest ? 'primary' : 'default'}
      className={cn(
        'group edge-light relative overflow-hidden p-0',
        isLatest && 'field-backdrop',
      )}
    >
      <div className="relative grid gap-6 p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10 lg:p-7">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Eyebrow tone={isLatest ? 'primary' : 'muted'}>Champion</Eyebrow>
            {isLatest ? (
              <span className="bg-primary/15 text-primary ring-primary/25 rounded-sm px-2 py-0.5 font-mono text-[0.6875rem] font-semibold uppercase ring-1 ring-inset">
                Reigning
              </span>
            ) : null}
            <span className="text-muted-foreground ml-auto font-mono text-xs tabular-nums">
              {formatDate(entry.publishedAt)}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-4">
            <span
              className={cn(
                'flex size-12 shrink-0 items-center justify-center rounded-full ring-1',
                'transition-transform duration-[var(--motion-base)] ease-[var(--ease-out-expo)]',
                'group-hover:scale-105',
                isLatest
                  ? 'bg-primary/15 ring-primary/35 text-primary'
                  : 'bg-surface-elevated ring-hairline text-muted-foreground',
              )}
            >
              <Crown className="size-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <DisplayHeading as="h2" size="compact" className="truncate">
                <Person
                  username={champion?.username ?? null}
                  name={champion?.displayName ?? champion?.username ?? null}
                />
              </DisplayHeading>
              <p className="text-muted-foreground mt-1 truncate font-mono text-xs">
                {champion ? `@${champion.username}` : 'Unclaimed'}
                {champion?.city ? ` · ${champion.city}` : ''}
              </p>
            </div>
          </div>

          {/* The size of the field, and no pool figure. The stored pool of an
              early event is a settled internal number, and
              publishing it beside the podium every other public surface now
              quotes invites a comparison that misrepresents both. */}
          <dl className="border-hairline mt-6 flex flex-wrap gap-x-8 gap-y-3 border-t pt-5">
            <Stat label="Beat a field of" value={entry.participantCount} />
          </dl>
        </div>

        <div className="lg:border-hairline min-w-0 lg:border-l lg:pl-10">
          <Eyebrow>Tournament</Eyebrow>
          <DisplayHeading
            as="h3"
            size="panel"
            className="mt-2 truncate text-lg"
          >
            {entry.tournamentName}
          </DisplayHeading>

          <ol className="mt-5 grid gap-2">
            <Place
              rank={2}
              username={entry.runnerUp?.username ?? null}
              name={
                entry.runnerUp?.displayName ?? entry.runnerUp?.username ?? null
              }
            />
            <Place
              rank={3}
              username={entry.thirdPlace?.username ?? null}
              name={
                entry.thirdPlace?.displayName ??
                entry.thirdPlace?.username ??
                null
              }
            />
          </ol>

          <Link
            href={`/bracket/${entry.tournamentId}`}
            className={cn(
              'text-primary focus-visible:ring-ring mt-6 inline-flex items-center gap-1.5 rounded-md text-sm font-semibold',
              'hover:brightness-125 focus-visible:ring-2 focus-visible:outline-none',
              '[&_svg]:transition-transform [&_svg]:duration-[var(--motion-base)]',
              'group-hover:[&_svg]:translate-x-1',
            )}
          >
            See how it was won
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-eyebrow text-muted-foreground font-mono font-semibold uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-mono font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/** A podium place below the champion. Rank is a numeral, not a medal icon. */
function Place({
  rank,
  name,
  username,
}: {
  rank: number;
  name: string | null;
  username: string | null;
}) {
  return (
    <li className="border-hairline bg-surface-deep/60 hover:border-primary/40 flex items-center gap-3 rounded-md border px-3 py-2.5 transition-colors duration-[var(--motion-base)]">
      <span className="text-muted-foreground bg-surface-elevated flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold tabular-nums">
        {rank}
      </span>
      <span className="min-w-0 truncate text-sm font-medium">
        <Person username={username} name={name} />
      </span>
    </li>
  );
}

function Person({
  username,
  name,
}: {
  username: string | null;
  name: string | null;
}) {
  if (!name || !username) {
    return <span className="text-muted-foreground">Unclaimed</span>;
  }

  return (
    <Link
      href={`/u/${username}`}
      className="hover:text-primary focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none"
    >
      {name}
    </Link>
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}
