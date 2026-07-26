import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  CirclePlay,
  ShieldCheck,
  Swords,
  Trophy,
} from 'lucide-react';
import { getCurrentUser } from '@/server/modules/auth';
import { listHallOfFame } from '@/server/modules/hall-of-fame';
import { formatMinor } from '@/server/modules/notification';
import { getSpectatorSnapshot } from '@/server/modules/tournament';
import type { LiveSnapshot } from '@/server/modules/tournament';
import { BracketTree } from '@/components/features/bracket-tree';
import { Countdown } from '@/components/features/countdown';
import { LiveLeaderboard } from '@/components/features/live-leaderboard';
import { LivePill } from '@/components/features/live-pill';
import { LiveRefresh } from '@/components/features/live-refresh';
import { StreamEmbed } from '@/components/features/stream-embed';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DisplayHeading } from '@/components/ui/display-heading';
import { Section } from '@/components/ui/section';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type FeaturedMatch = {
  id: string;
  stage: string;
  position: number;
  status: string;
  competitorA: string | null;
  competitorB: string | null;
  seedA: number | null;
  seedB: number | null;
  winner: string | null;
};

export default async function HomePage() {
  const [snapshot, hallOfFame, user] = await Promise.all([
    getSpectatorSnapshot({ leaderboardTake: 10 }),
    listHallOfFame({ take: 3 }),
    getCurrentUser(),
  ]);

  const live = snapshot?.status === 'LIVE';
  const registering = snapshot?.status === 'REGISTRATION_OPEN';
  const completed = snapshot?.status === 'COMPLETED';
  const ctaLabel = registering
    ? 'Enter The Circuit'
    : user
      ? 'Open Dashboard'
      : 'Sign In';
  const featuredMatches = getFeaturedMatches(snapshot);

  return (
    <main className="bg-surface-deep">
      <section className="relative isolate overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_72%_18%,oklch(0.78_0.2_160_/_0.18),transparent_28%),radial-gradient(circle_at_16%_38%,oklch(0.62_0.21_289_/_0.24),transparent_34%),linear-gradient(135deg,oklch(0.065_0.015_289),oklch(0.025_0.01_289)_56%,oklch(0.05_0.018_160))]" />
        <div className="mx-auto max-w-[1760px] px-3 py-3 sm:px-4 lg:px-5">
          <TournamentSlate snapshot={snapshot} live={live} />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="border-hairline bg-background/35 relative min-h-[620px] overflow-hidden border shadow-2xl">
              <BroadcastVisual snapshot={snapshot} live={live} />

              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.9),rgba(0,0,0,0.5)_44%,rgba(0,0,0,0.18)),linear-gradient(0deg,rgba(0,0,0,0.94),transparent_46%,rgba(0,0,0,0.52))]" />

              <div className="absolute inset-x-0 top-0 flex flex-wrap items-center justify-between gap-3 p-4 sm:p-6">
                <div className="flex flex-wrap items-center gap-3">
                  <LivePill
                    live={live}
                    label={
                      live
                        ? 'Live'
                        : completed
                          ? 'Completed'
                          : registering
                            ? 'Registration Open'
                            : 'Standby'
                    }
                  />
                  <span className="bg-surface-deep/80 text-foreground border-hairline border px-3 py-1 text-xs font-extrabold tracking-[0.14em] uppercase">
                    Sunday Finals
                  </span>
                </div>

                {snapshot ? (
                  <LiveRefresh
                    tournamentId={snapshot.tournamentId}
                    initialVersion={snapshot.version}
                  />
                ) : null}
              </div>

              <div className="absolute inset-x-0 bottom-0 p-4 sm:p-7 lg:p-9">
                <div className="max-w-3xl">
                  <p className="font-pixel text-secondary text-sm font-bold uppercase">
                    The Circuit live tournament platform
                  </p>
                  <h1 className="font-pixel mt-4 max-w-3xl text-[clamp(2.5rem,5.6vw,5.25rem)] leading-[0.9] font-bold tracking-normal text-balance uppercase">
                    Build. Qualify. Win live.
                  </h1>
                  <p className="text-muted-foreground mt-5 max-w-2xl text-base leading-7 sm:text-lg">
                    Weekly builder tournaments with sealed challenges,
                    simulation-based seeding, live knockout rounds and a public
                    champion ceremony.
                  </p>

                  <div className="mt-7 flex flex-wrap items-center gap-3">
                    <Link
                      href={user ? '/dashboard' : '/login'}
                      className={cn(
                        buttonVariants({
                          variant: 'broadcast',
                          size: 'broadcast',
                        }),
                      )}
                    >
                      {ctaLabel}
                      <ArrowRight className="size-4" aria-hidden />
                    </Link>
                    <Link
                      href="/leaderboard"
                      className={cn(
                        buttonVariants({ variant: 'secondary', size: 'lg' }),
                        'border-hairline bg-surface-raised/85 hover:bg-surface-elevated',
                      )}
                    >
                      Rankings
                    </Link>
                  </div>
                </div>

                <div className="mt-8 grid max-w-5xl gap-3 sm:grid-cols-3">
                  <HeroMetric
                    label="Competitors"
                    value={snapshot ? String(snapshot.participantCount) : '--'}
                  />
                  <HeroMetric
                    label="Prize Pool"
                    value={
                      snapshot
                        ? formatMinor(
                            snapshot.prizePoolMinor,
                            snapshot.currency,
                          )
                        : '--'
                    }
                  />
                  <HeroMetric
                    label="Current Stage"
                    value={
                      snapshot?.currentRound
                        ? formatStage(snapshot.currentRound.stage)
                        : statusLabel(snapshot?.status)
                    }
                  />
                </div>
              </div>
            </div>

            <MatchCenter
              snapshot={snapshot}
              featuredMatches={featuredMatches}
              live={live}
            />
          </div>
        </div>
      </section>

      {snapshot ? (
        <>
          <Section className="bg-background py-10 sm:py-12">
            <div className="grid gap-6 lg:grid-cols-[0.7fr_1.3fr]">
              <div>
                <Badge tone={live ? 'live' : 'brand'}>
                  {statusLabel(snapshot.status)}
                </Badge>
                <DisplayHeading size="compact" className="mt-4">
                  {snapshot.currentRound
                    ? formatStage(snapshot.currentRound.stage)
                    : snapshot.name}
                </DisplayHeading>
                <p className="text-muted-foreground mt-4 max-w-md text-sm leading-6">
                  {snapshot.currentRound?.revealed
                    ? (snapshot.currentRound.problemTitle ??
                      'Challenge revealed')
                    : 'Challenge details stay sealed until the round opens.'}
                </p>
              </div>
              <Card surface="broadcast" className="p-4">
                <LiveLeaderboard
                  entries={snapshot.leaderboard}
                  highlightUserId={user?.id ?? null}
                  compact
                />
              </Card>
            </div>
          </Section>

          {snapshot.bracket.some((round) => round.matches.length > 0) ? (
            <Section bleed className="bg-surface-deep">
              <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                <DisplayHeading>The Bracket</DisplayHeading>
                <Link
                  href={`/bracket/${snapshot.tournamentId}`}
                  className="text-primary hover:text-secondary focus-visible:ring-ring rounded-md text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
                >
                  Full bracket
                </Link>
              </div>
              <Card surface="broadcast" className="p-4">
                <BracketTree
                  rounds={snapshot.bracket}
                  highlightUserId={user?.id ?? null}
                />
              </Card>
            </Section>
          ) : null}
        </>
      ) : (
        <Section className="bg-background">
          <Card surface="broadcast" className="p-8 text-center">
            <DisplayHeading size="compact" className="mx-auto">
              No tournament is scheduled yet.
            </DisplayHeading>
            <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-sm">
              Sign in now and return when registration opens for the next weekly
              bracket.
            </p>
          </Card>
        </Section>
      )}

      <Section className="bg-surface-raised">
        <div className="mb-8 flex items-end justify-between gap-4">
          <DisplayHeading>League Format</DisplayHeading>
        </div>
        <ol className="grid gap-3 md:grid-cols-4">
          <Step
            n="01"
            title="Register"
            body="Entry opens through the week. The prize pool grows with the field."
          />
          <Step
            n="02"
            title="Qualify"
            body="Timed simulation scores determine the initial tournament seed."
          />
          <Step
            n="03"
            title="Knockout"
            body="Head-to-head challenges reveal to both competitors at the same instant."
          />
          <Step
            n="04"
            title="Final"
            body="The last matches crown the champion and publish the permanent record."
          />
        </ol>
      </Section>

      <Section className="bg-background">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <DisplayHeading>Champions</DisplayHeading>
          <Link
            href="/hall-of-fame"
            className="text-primary hover:text-secondary focus-visible:ring-ring rounded-md text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
          >
            Hall of Fame
          </Link>
        </div>
        {hallOfFame.length > 0 ? (
          <ul className="grid gap-4 md:grid-cols-3">
            {hallOfFame.map((entry) => (
              <li key={entry.tournamentId}>
                <Card surface="broadcast" className="min-h-56 p-5">
                  <Trophy className="text-secondary size-7" aria-hidden />
                  <p className="text-muted-foreground mt-8 text-sm">
                    {entry.tournamentName}
                  </p>
                  <h3 className="mt-2 text-2xl font-extrabold tracking-normal">
                    {entry.champion ? (
                      <Link
                        href={`/u/${entry.champion.username}`}
                        className="hover:text-primary focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {entry.champion.displayName ?? entry.champion.username}
                      </Link>
                    ) : (
                      'Unclaimed'
                    )}
                  </h3>
                  <p className="text-muted-foreground mt-3 text-sm tabular-nums">
                    {entry.participantCount} competitors,{' '}
                    {formatMinor(entry.prizePoolMinor)}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <Card surface="broadcast" className="p-6">
            <ShieldCheck className="text-secondary size-6" aria-hidden />
            <p className="mt-3 font-semibold">No champions recorded yet.</p>
          </Card>
        )}
      </Section>
    </main>
  );
}

function TournamentSlate({
  snapshot,
  live,
}: {
  snapshot: LiveSnapshot | null;
  live: boolean;
}) {
  const cards = [
    {
      label: live ? 'Live' : 'Featured',
      title: snapshot?.name ?? 'The Circuit Open',
      meta: statusLabel(snapshot?.status),
      accent: true,
    },
    {
      label: 'Qualifier',
      title: 'Simulation Seeds',
      meta: snapshot?.countdown
        ? countdownLabel(snapshot.countdown.of)
        : 'On schedule',
      accent: false,
    },
    {
      label: 'Bracket',
      title: snapshot?.currentRound
        ? formatStage(snapshot.currentRound.stage)
        : 'Knockout',
      meta: snapshot?.currentRound
        ? `${snapshot.currentRound.matchesDecided}/${snapshot.currentRound.matchesTotal} decided`
        : 'Awaiting seeds',
      accent: false,
    },
    {
      label: 'Finals',
      title: 'Champion Ceremony',
      meta: snapshot?.status === 'COMPLETED' ? 'Published' : 'Sunday IST',
      accent: false,
    },
  ];

  return (
    <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <article
          key={`${card.label}-${card.title}`}
          className={cn(
            'border-hairline bg-surface-raised min-h-20 overflow-hidden border px-4 py-3',
            card.accent && 'border-primary bg-surface-elevated',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-pixel text-secondary text-xs font-bold uppercase">
                {card.label}
              </p>
              <h2 className="font-pixel mt-2 truncate text-xl font-bold uppercase">
                {card.title}
              </h2>
            </div>
            <span
              className={cn(
                'font-pixel shrink-0 px-2 py-1 text-xs font-bold uppercase',
                card.accent
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-primary text-primary-foreground',
              )}
            >
              {card.meta}
            </span>
          </div>
          {card.accent && snapshot?.countdown ? (
            <Countdown
              targetAt={snapshot.countdown.targetAt}
              serverTime={snapshot.serverTime}
              phase={snapshot.countdown.phase}
              className="mt-2 [&>span:last-child]:text-xl [&>span:last-child]:font-bold"
            />
          ) : null}
        </article>
      ))}
    </div>
  );
}

function BroadcastVisual({
  snapshot,
  live,
}: {
  snapshot: LiveSnapshot | null;
  live: boolean;
}) {
  if (snapshot?.youtubeStreamUrl && live) {
    return (
      <div className="absolute inset-0 scale-105 [&>div]:[aspect-ratio:auto] [&>div]:h-full [&>div]:w-full [&>div]:rounded-none [&>div]:border-0">
        <StreamEmbed url={snapshot.youtubeStreamUrl} title="The Circuit live" />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-hidden bg-black">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px),radial-gradient(circle_at_68%_24%,rgba(0,255,163,0.26),transparent_28%),radial-gradient(circle_at_28%_52%,rgba(127,90,240,0.34),transparent_34%),linear-gradient(135deg,#050509,#100f1c_52%,#030604)] bg-[size:44px_44px,44px_44px,auto,auto,auto]" />
      <div className="bg-secondary/12 absolute inset-x-0 top-[30%] h-32 -skew-y-6 blur-3xl motion-safe:animate-pulse" />
      <div className="border-secondary/20 absolute top-[18%] right-[8%] size-[34rem] rounded-full border" />
      <div className="absolute top-[22%] right-[12%] hidden items-center gap-3 md:flex">
        <span className="bg-secondary text-secondary-foreground flex size-14 items-center justify-center rounded-full shadow-[var(--glow-live)]">
          <CirclePlay className="size-8" aria-hidden />
        </span>
        <div>
          <p className="font-pixel text-sm font-bold uppercase">
            Broadcast Standby
          </p>
          <p className="text-muted-foreground text-sm">
            Stream connects when live.
          </p>
        </div>
      </div>
    </div>
  );
}

function MatchCenter({
  snapshot,
  featuredMatches,
  live,
}: {
  snapshot: LiveSnapshot | null;
  featuredMatches: FeaturedMatch[];
  live: boolean;
}) {
  return (
    <aside className="border-hairline bg-background text-foreground flex min-h-[560px] flex-col border xl:min-h-[680px]">
      <div className="border-hairline flex items-center justify-between border-b p-4">
        <div>
          <p className="text-muted-foreground text-xs font-black tracking-[0.14em] uppercase">
            Match Center
          </p>
          <h2 className="font-pixel mt-1 text-2xl font-bold uppercase">
            {live ? 'Now Live' : 'Upcoming'}
          </h2>
        </div>
        <CalendarDays className="text-primary size-6" aria-hidden />
      </div>

      <div className="border-hairline border-b p-4">
        <p className="font-pixel text-muted-foreground text-xs font-bold uppercase">
          Countdown
        </p>
        <Countdown
          targetAt={snapshot?.countdown?.targetAt ?? null}
          serverTime={snapshot?.serverTime ?? new Date().toISOString()}
          phase={snapshot?.countdown?.phase}
          className="mt-2 [&>span:last-child]:text-4xl [&>span:last-child]:font-black"
        />
        <p className="text-muted-foreground mt-2 text-xs">
          {snapshot?.countdown
            ? countdownLabel(snapshot.countdown.of)
            : 'No active countdown'}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {featuredMatches.length > 0 ? (
          <ol className="space-y-3">
            {featuredMatches.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </ol>
        ) : (
          <div className="border-hairline bg-surface-raised border p-4">
            <Swords className="text-secondary size-6" aria-hidden />
            <p className="mt-3 font-bold">No matches published yet.</p>
            <p className="text-muted-foreground mt-2 text-sm">
              The bracket appears after simulation scores are seeded.
            </p>
          </div>
        )}
      </div>

      <div className="border-hairline border-t p-4">
        <Link
          href="/leaderboard"
          className={cn(
            buttonVariants({ variant: 'broadcast', size: 'broadcast' }),
            'w-full',
          )}
        >
          Open Rankings
        </Link>
      </div>
    </aside>
  );
}

function MatchCard({ match }: { match: FeaturedMatch }) {
  return (
    <li className="border-hairline bg-surface-raised border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="font-pixel bg-primary text-primary-foreground px-2 py-1 text-xs font-bold uppercase">
          {formatStage(match.stage)}
        </span>
        <span className="font-pixel bg-surface-deep text-muted-foreground px-2 py-1 text-xs font-bold uppercase">
          Match {match.position + 1}
        </span>
      </div>
      <CompetitorLine
        name={match.competitorA}
        seed={match.seedA}
        winner={match.winner === match.competitorA}
      />
      <CompetitorLine
        name={match.competitorB}
        seed={match.seedB}
        winner={match.winner === match.competitorB}
      />
      <p className="text-muted-foreground mt-3 text-xs font-bold tracking-[0.12em] uppercase">
        {match.status}
      </p>
    </li>
  );
}

function CompetitorLine({
  name,
  seed,
  winner,
}: {
  name: string | null;
  seed: number | null;
  winner: boolean;
}) {
  return (
    <p
      className={cn(
        'font-pixel flex items-center justify-between gap-3 py-1 text-lg font-bold tracking-normal uppercase',
        !name && 'text-muted-foreground',
        winner && 'text-secondary',
      )}
    >
      <span className="min-w-0 truncate">{name ?? 'Awaiting winner'}</span>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {seed != null ? `#${seed}` : '-'}
      </span>
    </p>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-hairline bg-surface-deep/80 border px-4 py-3">
      <p className="font-pixel text-muted-foreground text-xs font-bold uppercase">
        {label}
      </p>
      <p className="font-pixel mt-2 truncate text-2xl font-bold tracking-normal uppercase tabular-nums">
        {value}
      </p>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="border-hairline bg-surface-deep min-h-44 border p-5">
      <span className="text-secondary text-3xl font-extrabold tabular-nums">
        {n}
      </span>
      <p className="mt-6 font-semibold">{title}</p>
      <p className="text-muted-foreground mt-2 text-sm leading-6">{body}</p>
    </li>
  );
}

function getFeaturedMatches(snapshot: LiveSnapshot | null): FeaturedMatch[] {
  if (!snapshot) return [];

  const current = snapshot.currentStage;
  const rounds = [
    ...snapshot.bracket.filter((round) => round.stage === current),
    ...snapshot.bracket.filter((round) => round.stage !== current),
  ];

  return rounds
    .flatMap((round) =>
      round.matches.map((match) => ({
        id: match.id,
        stage: round.stage,
        position: match.bracketPosition,
        status: match.status,
        competitorA: match.competitorA,
        competitorB: match.competitorB,
        seedA: match.seedA,
        seedB: match.seedB,
        winner: match.winner,
      })),
    )
    .slice(0, 6);
}

function countdownLabel(of: string): string {
  switch (of) {
    case 'REGISTRATION_OPENS':
      return 'Registration opens';
    case 'REGISTRATION_CLOSES':
      return 'Registration closes';
    case 'SIMULATION_OPENS':
      return 'Qualifiers open';
    case 'SIMULATION_CLOSES':
      return 'Qualifiers close';
    case 'KNOCKOUT_STARTS':
      return 'Knockout starts';
    case 'ROUND':
      return 'Round clock';
    default:
      return 'Next up';
  }
}

function statusLabel(status: string | null | undefined): string {
  if (!status) return 'Standby';
  return formatStage(status);
}

function formatStage(value: string): string {
  return value.replace(/_/g, ' ');
}
