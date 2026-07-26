import Link from 'next/link';
import { ArrowRight, CalendarClock, Radio, Trophy } from 'lucide-react';
import {
  listPublicTournaments,
  type PublicTournamentBucket,
  type PublicTournamentCard,
} from '@/server/modules/tournament';
import { Countdown } from '@/components/features/countdown';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Tournaments - The Circuit' };
export const dynamic = 'force-dynamic';

const SECTIONS: Array<{
  key: PublicTournamentBucket;
  title: string;
  empty: string;
}> = [
  {
    key: 'LIVE_NOW',
    title: 'LIVE NOW',
    empty: 'No public tournament is live right now.',
  },
  {
    key: 'REGISTERING',
    title: 'REGISTERING',
    empty: 'No tournament is accepting entries right now.',
  },
  {
    key: 'COMING_SOON',
    title: 'COMING SOON',
    empty: 'No announced tournament has a public opening date yet.',
  },
  {
    key: 'PAST',
    title: 'PAST',
    empty: 'Completed public tournaments will appear here.',
  },
];

export default async function TournamentsPage() {
  const grouped = await listPublicTournaments();
  const serverTime = new Date().toISOString();

  return (
    <main className="bg-background text-foreground min-h-screen">
      <section className="border-hairline border-b px-5 py-10 sm:px-7">
        <div className="mx-auto max-w-6xl">
          <p className="text-secondary font-mono text-xs font-semibold tracking-[0.18em] uppercase">
            The Circuit calendar
          </p>
          <h1 className="font-pixel mt-3 text-4xl font-bold tracking-normal uppercase sm:text-6xl">
            Tournaments
          </h1>
          <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-6">
            Browse public events, register when the window opens, watch live
            brackets, and review completed results.
          </p>
        </div>
      </section>

      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-8 sm:px-7">
        {SECTIONS.map((section) => (
          <section key={section.key} className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="font-pixel text-2xl font-bold uppercase">
                {section.title}
              </h2>
              <div className="bg-hairline h-px flex-1" />
            </div>
            {grouped[section.key].length > 0 ? (
              <div className="grid gap-4 md:grid-cols-2">
                {grouped[section.key].map((tournament) => (
                  <TournamentCard
                    key={tournament.id}
                    tournament={tournament}
                    bucket={section.key}
                    serverTime={serverTime}
                  />
                ))}
              </div>
            ) : (
              <Card surface="broadcast" className="p-5">
                <p className="text-muted-foreground text-sm">{section.empty}</p>
              </Card>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}

function TournamentCard({
  tournament,
  bucket,
  serverTime,
}: {
  tournament: PublicTournamentCard;
  bucket: PublicTournamentBucket;
  serverTime: string;
}) {
  const countdown = cardCountdown(tournament, bucket);
  const action = cardAction(tournament, bucket);

  return (
    <Card surface="broadcast" interactive className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Badge tone={STATUS_TONE[bucket]}>
            {statusLabel(tournament.status)}
          </Badge>
          <h3 className="mt-3 text-xl font-bold">{tournament.name}</h3>
        </div>
        {bucket === 'LIVE_NOW' ? (
          <Radio className="text-secondary size-5" aria-hidden />
        ) : (
          <Trophy className="text-muted-foreground size-5" aria-hidden />
        )}
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <Fact label="Field" value={fieldSize(tournament)} />
        <Fact
          label="Stage"
          value={
            tournament.currentStage
              ? formatStage(tournament.currentStage)
              : statusLabel(tournament.status)
          }
        />
        <Fact label="Prize pool" value="₹0" />
        <Fact label="Entry" value="Free beta" />
      </dl>

      <div className="border-hairline mt-5 flex items-center gap-3 border-t pt-4 text-sm">
        <CalendarClock className="text-secondary size-4" aria-hidden />
        <div>
          <p className="text-muted-foreground text-xs">{countdown.label}</p>
          {countdown.targetAt ? (
            <Countdown
              targetAt={countdown.targetAt.toISOString()}
              serverTime={serverTime}
              className="[&>span:last-child]:text-sm"
            />
          ) : (
            <p className="font-mono font-semibold tabular-nums">Date TBA</p>
          )}
        </div>
      </div>

      <div className="mt-5">
        {action.href ? (
          <Link
            href={action.href}
            className={cn(buttonVariants({ variant: 'broadcast', size: 'sm' }))}
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

function Fact({ label, value }: { label: string; value: string }) {
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
  REGISTERING: 'success',
  COMING_SOON: 'info',
  PAST: 'neutral',
};
