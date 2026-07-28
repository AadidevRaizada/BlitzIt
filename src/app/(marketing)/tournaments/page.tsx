import Link from 'next/link';
import { ArrowRight, CalendarClock, Radio, Trophy } from 'lucide-react';
import {
  listPublicTournaments,
  type PublicTournamentBucket,
  type PublicTournamentCard,
} from '@/server/modules/tournament';
import { Countdown } from '@/components/features/countdown';
import { Badge, LiveDot, type BadgeTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { DisplayHeading } from '@/components/ui/display-heading';
import { EmptyState } from '@/components/ui/empty-state';
import { Eyebrow } from '@/components/ui/eyebrow';
import { EntryPrice, Reward } from '@/components/ui/reward';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Tournaments - The Circuit' };
export const dynamic = 'force-dynamic';

/**
 * The four lifecycle buckets, in descending priority.
 *
 * `emphasis` and `columns` are what stop "Live now" and "Coming soon: nothing
 * yet" from carrying identical visual weight — the single biggest hierarchy
 * problem on the old page. Live gets a full-width, red-ringed card; past
 * results are packed three-up and muted.
 */
const SECTIONS: Array<{
  key: PublicTournamentBucket;
  title: string;
  eyebrow: string;
  empty: string;
  emphasis: 'live' | 'primary' | 'default' | 'muted';
  columns: string;
}> = [
  {
    key: 'LIVE_NOW',
    title: 'Live now',
    eyebrow: 'Happening',
    empty: 'No public tournament is live right now.',
    emphasis: 'live',
    columns: 'grid-cols-1',
  },
  {
    key: 'REGISTERING',
    title: 'Registering',
    eyebrow: 'Open for entry',
    empty: 'No tournament is accepting entries right now.',
    emphasis: 'primary',
    columns: 'md:grid-cols-2',
  },
  {
    key: 'COMING_SOON',
    title: 'Coming soon',
    eyebrow: 'Announced',
    empty: 'No announced tournament has a public opening date yet.',
    emphasis: 'default',
    columns: 'md:grid-cols-2',
  },
  {
    key: 'PAST',
    title: 'Past',
    eyebrow: 'Archive',
    empty: 'Completed public tournaments will appear here.',
    emphasis: 'muted',
    columns: 'md:grid-cols-2 lg:grid-cols-3',
  },
];

export default async function TournamentsPage() {
  const grouped = await listPublicTournaments();
  const serverTime = new Date().toISOString();

  return (
    <main className="bg-background text-foreground min-h-screen">
      <section className="border-hairline border-b px-5 py-12 sm:px-7">
        <div className="mx-auto max-w-6xl">
          <Eyebrow tone="primary">The Circuit calendar</Eyebrow>
          <DisplayHeading as="h1" size="section" className="mt-3">
            Tournaments
          </DisplayHeading>
          <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-6">
            Browse public events, register when the window opens, watch live
            brackets, and review completed results.
          </p>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-10 sm:px-7">
        {SECTIONS.map((section) => {
          const tournaments = grouped[section.key];
          const isLive = section.key === 'LIVE_NOW';

          return (
            <section key={section.key}>
              <div className="mb-4 flex items-center gap-3">
                <div>
                  <Eyebrow
                    tone={isLive && tournaments.length > 0 ? 'live' : 'muted'}
                  >
                    {section.eyebrow}
                  </Eyebrow>
                  <div className="mt-1 flex items-center gap-2.5">
                    <DisplayHeading size="compact">
                      {section.title}
                    </DisplayHeading>
                    {isLive && tournaments.length > 0 ? <LiveDot /> : null}
                    {tournaments.length > 0 ? (
                      <span className="text-muted-foreground text-sm tabular-nums">
                        {tournaments.length}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="bg-hairline mt-6 h-px flex-1" />
              </div>

              {tournaments.length > 0 ? (
                <div className={cn('stagger grid gap-4', section.columns)}>
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
              ) : (
                <EmptyState title={section.empty} />
              )}
            </section>
          );
        })}
      </div>
    </main>
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
      className={cn('flex flex-col', isLive ? 'p-6' : 'p-5')}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[bucket]}>
              {isLive ? <LiveDot /> : null}
              {statusLabel(tournament.status)}
            </Badge>
          </div>
          <DisplayHeading
            as="h3"
            size={isLive ? 'compact' : 'panel'}
            className="mt-3"
          >
            {tournament.name}
          </DisplayHeading>
        </div>
        {isLive ? (
          <Radio className="text-destructive size-5 shrink-0" aria-hidden />
        ) : (
          <Trophy
            className="text-muted-foreground size-5 shrink-0"
            aria-hidden
          />
        )}
      </div>

      <dl
        className={cn(
          'mt-5 grid gap-3 text-sm',
          isPast ? 'grid-cols-2' : 'grid-cols-2',
        )}
      >
        <Fact label="Field" value={fieldSize(tournament)} />
        <Fact
          label="Stage"
          value={
            tournament.currentStage
              ? formatStage(tournament.currentStage)
              : statusLabel(tournament.status)
          }
        />
        {/*
         * These two used to be hard-coded to "₹0" and "Free beta", which meant
         * the page contradicted the tournament record. They now read the real
         * prize pool and pass price off the card data.
         */}
        <Fact
          label="Prize pool"
          value={
            <Reward
              amountMinor={tournament.prizePoolMinor}
              currency={tournament.currency}
            />
          }
        />
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

      <div className="border-hairline mt-5 flex items-center gap-3 border-t pt-4 text-sm">
        <CalendarClock
          className={cn(
            'size-4 shrink-0',
            isLive ? 'text-destructive' : 'text-primary',
          )}
          aria-hidden
        />
        <div>
          <p className="text-muted-foreground text-xs">{countdown.label}</p>
          {countdown.targetAt ? (
            <Countdown
              targetAt={countdown.targetAt.toISOString()}
              serverTime={serverTime}
              size="inline"
            />
          ) : (
            <p className="font-display font-semibold tabular-nums">Date TBA</p>
          )}
        </div>
      </div>

      <div className="mt-5">
        {action.href ? (
          <Link
            href={action.href}
            className={cn(
              buttonVariants({
                variant: isLive ? 'danger' : isPast ? 'secondary' : 'broadcast',
                size: 'sm',
              }),
            )}
          >
            {action.label}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <p className="text-muted-foreground text-sm">{action.label}</p>
        )}
      </div>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
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
  if (bucket === 'REGISTERING') {
    return {
      label: 'Registration closes',
      targetAt: tournament.registrationClosesAt,
    };
  }
  if (bucket === 'COMING_SOON') {
    return {
      label:
        tournament.status === 'PUBLISHED'
          ? 'Registration opens'
          : 'Qualifiers open',
      targetAt:
        tournament.status === 'PUBLISHED'
          ? tournament.registrationOpensAt
          : tournament.simulationOpensAt,
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

function fieldSize(tournament: PublicTournamentCard): string {
  const size = tournament.bracketSize ?? tournament.maxRegistrations;
  if (!size) return `${tournament.participantCount} registered`;
  return `${tournament.participantCount}/${size}`;
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
