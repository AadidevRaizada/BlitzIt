import Link from 'next/link';
import type { EnvironmentScope } from '@/server/modules/tournament';
import { ArrowRight, CalendarClock, Radio, Trophy } from 'lucide-react';
import {
  listPublicTournaments,
  type PublicTournamentBucket,
  type PublicTournamentCard,
  nextRealEvent,
} from '@/server/modules/tournament';
import { Countdown } from '@/components/features/countdown';
import { Badge, LiveDot, type BadgeTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { DisplayHeading } from '@/components/ui/display-heading';
import { EmptyState } from '@/components/ui/empty-state';
import { Eyebrow } from '@/components/ui/eyebrow';
import { EntryPrice } from '@/components/ui/reward';
import { REWARD_MULTIPLE } from '@/lib/rewards';
import { cn } from '@/lib/utils';

/**
 * The four lifecycle buckets, in descending priority.
 *
 * `emphasis` is what stops "Live now" and "Coming soon: nothing yet" from
 * carrying identical visual weight. A live tournament takes the full row with a
 * red ring and a hero clock; past results recede.
 *
 * The buckets are also the page's filters (`?filter=`), which is the fix for
 * the old layout's real problem: it rendered all four headings unconditionally,
 * so a quiet week produced four stacked "nothing here" panels and the page read
 * as a dead product. Empty buckets are now simply absent, and the counts live
 * in the filter bar where they answer "is anything on?" at a glance.
 */
const SECTIONS: Array<{
  key: PublicTournamentBucket;
  /** `?filter=` value. Short, because it ends up in shared URLs. */
  filter: string;
  title: string;
  eyebrow: string;
  empty: string;
  emphasis: 'live' | 'primary' | 'default' | 'muted';
}> = [
  {
    key: 'LIVE_NOW',
    filter: 'live',
    title: 'Live now',
    eyebrow: 'Happening',
    empty: 'No public tournament is live right now.',
    emphasis: 'live',
  },
  {
    key: 'REGISTERING',
    filter: 'open',
    title: 'Registering',
    eyebrow: 'Open for entry',
    empty: 'No tournament is accepting entries right now.',
    emphasis: 'primary',
  },
  {
    key: 'COMING_SOON',
    filter: 'upcoming',
    title: 'Coming soon',
    eyebrow: 'Announced',
    empty: 'No announced tournament has a public opening date yet.',
    emphasis: 'default',
  },
  {
    key: 'PAST',
    filter: 'past',
    title: 'Past',
    eyebrow: 'Archive',
    empty: 'Completed public tournaments will appear here.',
    emphasis: 'muted',
  },
];

/**
 * Tournament discovery, for ONE environment. Shared verbatim by `/tournaments`
 * and `/test/tournaments` — see `LeaderboardView` for why the test surfaces
 * render the same component rather than a copy of it.
 */
export async function TournamentsView({
  scope,
  filter,
  basePath = '/tournaments',
}: {
  scope: EnvironmentScope;
  /** `?filter=` value. Anything unrecognised falls back to the full calendar. */
  filter?: string;
  /** Where the filter links point. The test surface lives on its own path. */
  basePath?: string;
}) {
  const grouped = await listPublicTournaments(scope);

  return (
    <TournamentsCalendar
      grouped={grouped}
      serverTime={new Date().toISOString()}
      filter={filter}
      basePath={basePath}
    />
  );
}

/**
 * The calendar itself, with the data already fetched.
 *
 * Split out from `TournamentsView` so the layout can be rendered from fixtures
 * — `/preview/tournaments` does exactly that, which is what makes it possible
 * to review this page's empty and populated states without a database.
 */
export function TournamentsCalendar({
  grouped,
  serverTime,
  filter,
  basePath = '/tournaments',
}: {
  grouped: Record<PublicTournamentBucket, PublicTournamentCard[]>;
  /** The server's clock at render, ISO-8601. Anchors every countdown. */
  serverTime: string;
  filter?: string;
  basePath?: string;
}) {
  const active =
    SECTIONS.find((section) => section.filter === filter)?.filter ?? 'all';
  const visible =
    active === 'all'
      ? SECTIONS
      : SECTIONS.filter((section) => section.filter === active);
  const total = SECTIONS.reduce(
    (sum, section) => sum + grouped[section.key].length,
    0,
  );
  const populated = visible.filter(
    (section) => grouped[section.key].length > 0,
  );

  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="field-backdrop border-hairline border-b">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8 lg:py-20">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-end">
            {/* `stagger` sequences these four children on arrival, so the page
                assembles itself rather than appearing all at once. */}
            <div className="stagger [--stagger-step:70ms]">
              <div className="flex items-center gap-2.5">
                <Eyebrow tone="primary">The Circuit calendar</Eyebrow>
                <span className="via-primary/40 h-px w-12 bg-gradient-to-r from-transparent to-transparent" />
              </div>
              <DisplayHeading
                as="h1"
                size="section"
                className="text-raked mt-4"
              >
                Tournaments
              </DisplayHeading>
              <p className="text-muted-foreground mt-5 max-w-lg text-sm leading-6">
                Register when the window opens, watch the bracket settle it
                live, and read the receipts afterwards.
              </p>
              <Ledger grouped={grouped} />
            </div>
            <NextUp grouped={grouped} serverTime={serverTime} />
          </div>
        </div>
      </header>

      {total > 0 ? (
        <FilterBar grouped={grouped} active={active} basePath={basePath} />
      ) : null}

      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-8">
        {total === 0 ? (
          <NothingScheduled />
        ) : populated.length === 0 ? (
          <EmptyState
            title={visible[0]?.empty ?? 'Nothing here yet.'}
            description="Other parts of the calendar have events — clear the filter to see them."
            action={
              <Link
                href={basePath}
                className={cn(
                  buttonVariants({ variant: 'secondary', size: 'sm' }),
                )}
              >
                View the full calendar
              </Link>
            }
          />
        ) : (
          <div className="grid gap-12">
            {populated.map((section) => {
              const tournaments = grouped[section.key];
              const isLive = section.key === 'LIVE_NOW';

              return (
                <section key={section.key}>
                  <div className="mb-5 flex items-end gap-4">
                    <div>
                      <Eyebrow tone={isLive ? 'live' : 'muted'}>
                        {section.eyebrow}
                      </Eyebrow>
                      <div className="mt-1.5 flex items-center gap-2.5">
                        <DisplayHeading size="compact">
                          {section.title}
                        </DisplayHeading>
                        {isLive ? <LiveDot /> : null}
                        <span className="text-muted-foreground font-mono text-sm font-semibold tabular-nums">
                          {String(tournaments.length).padStart(2, '0')}
                        </span>
                      </div>
                    </div>
                    <div className="bg-hairline mb-2.5 h-px flex-1" />
                  </div>

                  <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {tournaments.map((tournament) => (
                      <TournamentCard
                        key={tournament.id}
                        tournament={tournament}
                        bucket={section.key}
                        emphasis={section.emphasis}
                        serverTime={serverTime}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The state of the season in three numbers.
 *
 * Deliberately NOT the bucket counts — the filter bar already carries those,
 * and repeating them would be decoration. These are the three facts a
 * competitor actually weighs before entering: what is at stake, whether there
 * is still room, and whether this thing has a track record.
 */
function Ledger({
  grouped,
}: {
  grouped: Record<PublicTournamentBucket, PublicTournamentCard[]>;
}) {
  const ahead = [
    ...grouped.LIVE_NOW,
    ...grouped.REGISTERING,
    ...grouped.COMING_SOON,
  ];
  if (ahead.length === 0 && grouped.PAST.length === 0) return null;

  const seats = grouped.REGISTERING.reduce((sum, tournament) => {
    const capacity = tournament.bracketSize ?? tournament.maxRegistrations;
    return capacity
      ? sum + Math.max(0, capacity - tournament.participantCount)
      : sum;
  }, 0);

  const items: Array<{ label: string; value: React.ReactNode }> = [
    // The same promise the cards and the tournament page lead with, cut to the
    // multiple this slot can hold. It replaced a summed pot that moved with
    // entries rather than with what a competitor could win.
    { label: 'Compete for up to', value: REWARD_MULTIPLE },
    { label: 'Seats open', value: seats > 0 ? seats : '—' },
    { label: 'Events run', value: grouped.PAST.length },
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
 * The one thing a visitor came for: what is on, and when.
 *
 * Priority order matches the buckets — a live event outranks an open
 * registration, which outranks an announcement. When the calendar is empty this
 * says so plainly rather than rendering an empty shell.
 */
function NextUp({
  grouped,
  serverTime,
}: {
  grouped: Record<PublicTournamentBucket, PublicTournamentCard[]>;
  serverTime: string;
}) {
  const candidate = (['LIVE_NOW', 'REGISTERING', 'COMING_SOON'] as const)
    .map((key) => ({ key, tournament: grouped[key][0] }))
    .find((entry) => entry.tournament !== undefined);

  if (!candidate?.tournament) {
    return (
      <Card surface="broadcast" className="p-6">
        <Eyebrow>The calendar</Eyebrow>
        <p className="font-display mt-2.5 text-lg font-semibold">
          Nothing scheduled yet
        </p>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          Tournaments are announced a week ahead. The archive below holds
          everything that has already run.
        </p>
        <Link
          href="/rules"
          className={cn(
            buttonVariants({ variant: 'secondary', size: 'sm' }),
            'mt-5',
          )}
        >
          How The Circuit works
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Card>
    );
  }

  const bucket = candidate.key;
  const tournament = candidate.tournament;
  const isLive = bucket === 'LIVE_NOW';
  const countdown = cardCountdown(tournament, bucket);
  const action = cardAction(tournament, bucket);

  return (
    <Card
      surface="broadcast"
      emphasis={isLive ? 'live' : 'primary'}
      className={cn(
        'field-backdrop edge-light group/next relative overflow-hidden p-6',
        isLive && 'field-backdrop-live edge-light-live',
      )}
    >
      {isLive ? <span className="sheen" aria-hidden /> : null}
      <div className="relative">
        <div className="flex items-center gap-2">
          <Eyebrow tone={isLive ? 'live' : 'primary'}>
            {isLive
              ? 'Live now'
              : bucket === 'REGISTERING'
                ? 'Open for entry'
                : 'Next up'}
          </Eyebrow>
          {isLive ? <LiveDot /> : null}
        </div>

        <p className="font-display mt-3 truncate text-xl font-bold tracking-[-0.02em]">
          {tournament.name}
        </p>

        <p className="text-eyebrow text-muted-foreground mt-5 font-mono font-semibold uppercase">
          {countdown.label}
        </p>
        {countdown.targetAt ? (
          <Countdown
            targetAt={countdown.targetAt.toISOString()}
            serverTime={serverTime}
            size="md"
            className="mt-1"
          />
        ) : (
          <p className="mt-1 font-mono text-xl font-bold">Date TBA</p>
        )}

        <FieldMeter
          registered={tournament.participantCount}
          capacity={tournament.bracketSize ?? tournament.maxRegistrations}
          className="mt-5"
        />

        {action.href ? (
          <Link
            href={action.href}
            className={cn(
              buttonVariants({
                variant: isLive ? 'danger' : 'broadcast',
                size: 'md',
              }),
              'mt-6 w-full',
              '[&_svg]:transition-transform [&_svg]:duration-[var(--motion-base)]',
              'hover:[&_svg]:translate-x-1',
            )}
          >
            {action.label}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <p className="text-muted-foreground mt-5 text-sm">{action.label}</p>
        )}
      </div>
    </Card>
  );
}

/**
 * Bucket filters, as links over `?filter=`.
 *
 * Links rather than a client widget, for the same reason `<TabNav />` is:
 * every filter stays a plain RSC render, is deep-linkable, and costs no client
 * JavaScript. A zero-count filter is shown but disabled-looking, so the bar
 * doubles as the page's status summary.
 */
function FilterBar({
  grouped,
  active,
  basePath,
}: {
  grouped: Record<PublicTournamentBucket, PublicTournamentCard[]>;
  active: string;
  basePath: string;
}) {
  const total = SECTIONS.reduce(
    (sum, section) => sum + grouped[section.key].length,
    0,
  );
  const items = [
    { filter: 'all', label: 'All', count: total, tone: 'neutral' as const },
    ...SECTIONS.map((section) => ({
      filter: section.filter,
      label: section.title,
      count: grouped[section.key].length,
      tone:
        section.key === 'LIVE_NOW'
          ? ('live' as const)
          : section.key === 'REGISTERING'
            ? ('primary' as const)
            : ('neutral' as const),
    })),
  ];

  return (
    <nav
      aria-label="Filter tournaments"
      className="border-hairline bg-background/85 sticky top-0 z-30 border-b backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-5 py-2.5 sm:px-8">
        {items.map((item) => {
          const isActive = item.filter === active;
          const href =
            item.filter === 'all'
              ? basePath
              : `${basePath}?filter=${item.filter}`;

          return (
            <Link
              key={item.filter}
              href={href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'focus-visible:ring-ring relative inline-flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap',
                'transition-colors duration-[var(--motion-fast)] focus-visible:ring-2 focus-visible:outline-none',
                isActive
                  ? 'bg-surface-elevated text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-raised',
                item.count === 0 && !isActive && 'opacity-45',
                // The active filter is underlined at the bar's own baseline, so
                // the sticky bar reads as a set of tabs even once it detaches
                // from the header and floats over the cards.
                isActive &&
                  'after:bg-primary after:absolute after:inset-x-3 after:-bottom-2.5 after:h-0.5 after:rounded-full',
              )}
            >
              {item.tone === 'live' && item.count > 0 ? <LiveDot /> : null}
              {item.label}
              <span
                className={cn(
                  'rounded-sm px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none font-semibold tabular-nums',
                  item.count === 0
                    ? 'text-muted-foreground'
                    : item.tone === 'live'
                      ? 'bg-destructive/15 text-destructive'
                      : item.tone === 'primary'
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted text-muted-foreground',
                )}
              >
                {item.count}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * The whole-calendar empty state. One designed panel instead of four stacked
 * "nothing here" rows — emptiness gets stated once, honestly, and the page
 * still offers somewhere to go.
 */
function NothingScheduled() {
  return (
    <div className="field-backdrop edge-light border-hairline overflow-hidden rounded-xl border px-6 py-14 text-center sm:py-20">
      <div className="relative mx-auto flex size-24 items-center justify-center">
        {/* Concentric rings, the outermost one breathing on the live-ping
            keyframes — the same visual language as the LiveDot, at rest. */}
        <span
          className="border-primary/15 absolute inset-0 rounded-full border motion-safe:animate-[var(--animate-live-pulse)]"
          aria-hidden
        />
        <span
          className="border-hairline absolute inset-3 rounded-full border"
          aria-hidden
        />
        <span
          className="bg-primary/8 border-primary/25 absolute inset-6 rounded-full border"
          aria-hidden
        />
        <Trophy className="text-primary relative size-7" aria-hidden />
      </div>
      <DisplayHeading size="compact" className="text-raked mt-7">
        The calendar is clear
      </DisplayHeading>
      <p className="text-muted-foreground mx-auto mt-3 max-w-md text-sm leading-6">
        No tournament is live, open or announced right now. New events are
        published a week before entries open.
      </p>
      <div className="mt-7 flex flex-wrap justify-center gap-3">
        <Link
          href="/rules"
          className={cn(buttonVariants({ variant: 'broadcast', size: 'md' }))}
        >
          How it works
          <ArrowRight className="size-4" aria-hidden />
        </Link>
        <Link
          href="/hall-of-fame"
          className={cn(buttonVariants({ variant: 'secondary', size: 'md' }))}
        >
          Hall of Fame
        </Link>
      </div>
    </div>
  );
}

function TournamentCard({
  tournament,
  bucket,
  emphasis,
  serverTime,
}: {
  tournament: PublicTournamentCard;
  bucket: PublicTournamentBucket;
  emphasis: 'live' | 'primary' | 'default' | 'muted';
  serverTime: string;
}) {
  const countdown = cardCountdown(tournament, bucket);
  const action = cardAction(tournament, bucket);
  const isLive = bucket === 'LIVE_NOW';
  const isPast = bucket === 'PAST';

  return (
    <Card
      surface="broadcast"
      interactive
      emphasis={emphasis}
      className={cn(
        'group edge-light relative flex flex-col overflow-hidden p-0',
        // A live event is never one of three cards in a row. It takes the row.
        isLive &&
          'field-backdrop field-backdrop-live edge-light-live sm:col-span-2 lg:col-span-3',
        isPast && 'hover:opacity-100',
      )}
    >
      {isLive ? <span className="sheen" aria-hidden /> : null}

      <div
        className={cn(
          'relative flex flex-1 flex-col gap-5 p-5',
          isLive && 'gap-6 p-6 sm:p-7 lg:flex-row lg:items-center lg:gap-10',
        )}
      >
        <div className={cn('min-w-0', isLive && 'flex-1')}>
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[bucket]}>
              {isLive ? <LiveDot /> : null}
              {statusLabel(tournament.status)}
            </Badge>
            {isLive ? (
              <Radio className="text-destructive size-4" aria-hidden />
            ) : null}
          </div>

          <DisplayHeading
            as="h3"
            size={isLive ? 'compact' : 'panel'}
            className={cn('mt-3', !isLive && 'line-clamp-2')}
          >
            {tournament.name}
          </DisplayHeading>

          {tournament.categories.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {tournament.categories.slice(0, 3).map((category) => (
                <li key={category}>
                  <Badge tone="neutral" className="text-[0.6875rem]">
                    {formatStage(category)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}

          <FieldMeter
            registered={tournament.participantCount}
            capacity={tournament.bracketSize ?? tournament.maxRegistrations}
            className={cn('mt-5', isLive && 'max-w-sm')}
          />

          <dl className="border-hairline mt-4 grid grid-cols-2 gap-4 border-t pt-4 text-sm">
            {/* The multiple, read at a glance — the tournament page carries the
                table it comes from. The label absorbs "up to" so the value stays
                short enough for one line in this half-width column; spelling it
                out in the value wraps to two and grows every card in the grid. */}
            <Fact label="Up to" value={`${REWARD_MULTIPLE} Entry Fee`} />
            <Fact
              label="Entry"
              value={
                <EntryPrice
                  amountMinor={tournament.passPriceMinor}
                  currency={tournament.currency}
                />
              }
            />
          </dl>
        </div>

        <div
          className={cn(
            'flex flex-col gap-4',
            isLive &&
              'lg:border-hairline lg:w-64 lg:shrink-0 lg:border-l lg:pl-10',
          )}
        >
          <div className="flex items-center gap-2.5">
            <CalendarClock
              className={cn(
                'size-4 shrink-0',
                isLive ? 'text-destructive' : 'text-primary',
              )}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-eyebrow text-muted-foreground font-mono font-semibold uppercase">
                {countdown.label}
              </p>
              {countdown.targetAt ? (
                <Countdown
                  targetAt={countdown.targetAt.toISOString()}
                  serverTime={serverTime}
                  size={isLive ? 'md' : 'inline'}
                  className="mt-0.5"
                />
              ) : (
                <p className="mt-0.5 font-mono font-bold tabular-nums">
                  Date TBA
                </p>
              )}
            </div>
          </div>

          {action.href ? (
            <Link
              href={action.href}
              className={cn(
                buttonVariants({
                  variant: isLive
                    ? 'danger'
                    : isPast
                      ? 'secondary'
                      : 'broadcast',
                  size: isLive ? 'md' : 'sm',
                }),
                'w-full',
                // The arrow leans toward the destination when the card is
                // hovered — the card is the hover target, not just the button.
                '[&_svg]:transition-transform [&_svg]:duration-[var(--motion-base)]',
                'group-hover:[&_svg]:translate-x-1',
              )}
            >
              {action.label}
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <p className="text-muted-foreground text-sm">{action.label}</p>
          )}
        </div>
      </div>
    </Card>
  );
}

/**
 * How full the field is.
 *
 * "12/32" is a number; a bar is a feeling — nearly-full reads as urgency
 * without a word of copy. Falls back to the raw count when a tournament has no
 * declared capacity, because a bar with no denominator would be a lie.
 */
function FieldMeter({
  registered,
  capacity,
  className,
}: {
  registered: number;
  capacity: number | null;
  className?: string;
}) {
  const pct =
    capacity && capacity > 0
      ? Math.min(100, Math.round((registered / capacity) * 100))
      : null;

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-eyebrow text-muted-foreground font-mono font-semibold uppercase">
          Field
        </span>
        <span
          className={cn(
            'font-mono text-sm font-bold tabular-nums',
            pct !== null && pct >= 90 && 'text-destructive',
          )}
        >
          {capacity ? `${registered}/${capacity}` : `${registered} in`}
        </span>
      </div>
      {pct !== null ? (
        <div
          className="bg-surface-elevated mt-2 h-1 overflow-hidden rounded-full"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label="Field filled"
        >
          {/*
           * The bar fills to its value on arrival: `scaleX` from 0, so the
           * animation is a compositor transform rather than a width reflow, and
           * the reduced-motion rule in globals.css pins it to its final state
           * for anyone who asked for less movement.
           */}
          <div
            className={cn(
              'h-full origin-left rounded-full',
              'animate-[var(--animate-meter-in)]',
              pct >= 90 ? 'bg-destructive' : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-eyebrow text-muted-foreground font-mono font-semibold uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-mono font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function cardAction(
  tournament: PublicTournamentCard,
  bucket: PublicTournamentBucket,
): { label: string; href: string | null } {
  switch (bucket) {
    case 'LIVE_NOW':
      return { label: 'Watch live', href: `/tournaments/${tournament.slug}` };
    case 'REGISTERING':
      return { label: 'Register', href: `/tournaments/${tournament.slug}` };
    case 'COMING_SOON':
      return { label: openingText(tournament), href: null };
    case 'PAST':
      return { label: 'View results', href: `/tournaments/${tournament.slug}` };
  }
}

function cardCountdown(
  tournament: PublicTournamentCard,
  bucket: PublicTournamentBucket,
): { label: string; targetAt: Date | null } {
  // Both of these buckets ask the same question — "what is the next real
  // milestone?" — so both defer to the one function that answers it. The
  // hand-rolled version keyed off `status` alone and would advertise
  // "Registration closes" for a tournament whose registration had not opened.
  if (bucket === 'REGISTERING' || bucket === 'COMING_SOON') {
    const event = nextRealEvent(tournament, new Date());
    return {
      label: event?.label ?? 'Next milestone',
      targetAt: event?.at ?? null,
    };
  }
  if (bucket === 'LIVE_NOW') {
    return {
      label:
        tournament.status === 'SIMULATION'
          ? 'Qualifiers close'
          : 'Knockout starts',
      targetAt:
        tournament.status === 'SIMULATION'
          ? tournament.simulationClosesAt
          : tournament.liveStartsAt,
    };
  }
  return { label: 'Completed', targetAt: tournament.completedAt };
}

function openingText(tournament: PublicTournamentCard): string {
  const opensAt =
    tournament.status === 'PUBLISHED'
      ? tournament.registrationOpensAt
      : tournament.simulationOpensAt;
  return opensAt ? `Opens ${formatDate(opensAt)}` : 'Opening date TBA';
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}

function statusLabel(status: string): string {
  return formatStage(status);
}

function formatStage(value: string): string {
  return value.replace(/_/g, ' ');
}

const STATUS_TONE: Record<PublicTournamentBucket, BadgeTone> = {
  LIVE_NOW: 'live',
  // Blue, not green: an open registration window is an active, healthy state,
  // and green is reserved for "a check passed".
  REGISTERING: 'active',
  COMING_SOON: 'info',
  PAST: 'neutral',
};
