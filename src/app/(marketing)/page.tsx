import Link from 'next/link';
import { ArrowRight, CirclePlay, Radio, Trophy } from 'lucide-react';
import { getCurrentUser } from '@/server/modules/auth';
import { listHallOfFame } from '@/server/modules/hall-of-fame';
import { formatMinor } from '@/server/modules/notification';
import {
  getSpectatorSnapshot,
  listMyLiveMatches,
  type LiveSnapshot,
  type MyMatchSummary,
} from '@/server/modules/tournament';
import { BracketTree } from '@/components/features/bracket-tree';
import { Countdown } from '@/components/features/countdown';
import { HomeMotion } from '@/components/features/home-motion';
import { LiveLeaderboard } from '@/components/features/live-leaderboard';
import { LiveRefresh } from '@/components/features/live-refresh';
import { StreamEmbed } from '@/components/features/stream-embed';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

type HeroStat = {
  label: string;
  value: string;
  count?: number;
  tone?: 'default' | 'danger';
};

export default async function HomePage() {
  const [snapshot, hallOfFame, user] = await Promise.all([
    getSpectatorSnapshot({ leaderboardTake: 10 }),
    listHallOfFame({ take: 1 }),
    getCurrentUser(),
  ]);

  const liveMatches = user
    ? (await listMyLiveMatches(user.id)).filter(
        (match) => match.matchStatus !== 'DECIDED',
      )
    : [];
  const liveMatch = liveMatches[0] ?? null;
  const champion = hallOfFame[0] ?? null;
  const live = snapshot?.status === 'LIVE';
  const registering = snapshot?.status === 'REGISTRATION_OPEN';
  const completed = snapshot?.status === 'COMPLETED';
  const ctaHref = registering
    ? `/tournaments/${snapshot?.slug}`
    : user
      ? '/dashboard'
      : '/tournaments';
  const ctaLabel = registering
    ? 'Register'
    : user
      ? 'Open Dashboard'
      : 'View Tournaments';
  const stats = getHeroStats(snapshot);

  return (
    <HomeMotion>
      <main className="bg-background text-foreground min-h-screen">
        <Ticker snapshot={snapshot} live={live} />

        <div className="border-hairline flex flex-wrap items-center gap-3 border-b px-4 py-4 sm:px-7">
          <div className="font-pixel text-lg font-bold tracking-normal uppercase">
            The Circuit
          </div>
          <StatusChip>{snapshot?.name ?? 'No tournament scheduled'}</StatusChip>
          <StatusChip active>
            {snapshot
              ? snapshot.currentStage
                ? formatStage(snapshot.currentStage)
                : statusLabel(snapshot.status)
              : 'Standby'}
          </StatusChip>
          <div className="min-w-0 flex-1" />
          {snapshot ? (
            <LiveRefresh
              tournamentId={snapshot.tournamentId}
              initialVersion={snapshot.version}
            />
          ) : null}
          <Link
            href={ctaHref}
            className={cn(buttonVariants({ variant: 'broadcast', size: 'sm' }))}
          >
            {user ? 'Dashboard' : 'Sign In'}
          </Link>
        </div>

        {snapshot ? (
          <>
            <section className="border-hairline grid border-b xl:grid-cols-[minmax(0,1.62fr)_minmax(340px,0.85fr)]">
              <div className="border-hairline relative min-h-[620px] overflow-hidden px-5 py-10 sm:px-10 xl:border-r">
                <BroadcastBackdrop live={live} />

                <div className="relative flex flex-wrap items-start justify-between gap-5">
                  <p className="text-secondary font-mono text-xs font-semibold tracking-[0.22em] uppercase">
                    The Circuit . AI-native coding esport
                  </p>
                  <div className="border-hairline bg-background/70 flex items-center gap-2 border px-3 py-2">
                    <span
                      className={cn(
                        'size-2 rounded-full',
                        live ? 'home-live-dot bg-destructive' : 'bg-muted',
                      )}
                    />
                    <span
                      className={cn(
                        'font-mono text-[0.68rem] font-bold tracking-[0.16em] uppercase',
                        live ? 'text-destructive' : 'text-muted-foreground',
                      )}
                    >
                      {live ? 'Live' : completed ? 'Completed' : 'Standby'}
                    </span>
                  </div>
                </div>

                <div className="font-pixel relative mt-8 text-[clamp(3rem,8vw,5.8rem)] leading-[0.9] font-bold tracking-normal text-balance uppercase">
                  <div className="home-hero-line">Build.</div>
                  <div className="home-hero-line">Qualify.</div>
                  <div className="home-hero-line text-secondary">Win Live.</div>
                </div>

                <p className="home-rise text-muted-foreground relative mt-6 max-w-2xl text-base leading-7 text-pretty sm:text-lg">
                  Fifteen minutes. One shot. Sealed challenges drop
                  simultaneously, the automated judge grades shipped work, and
                  the survivors fight it out live.
                </p>

                <div className="home-rise relative mt-7 flex flex-wrap gap-3">
                  <Link
                    href={ctaHref}
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
                    href={snapshot.youtubeStreamUrl ? '#broadcast' : '/rules'}
                    className={cn(
                      buttonVariants({ variant: 'secondary', size: 'lg' }),
                      'border-hairline bg-surface-raised/85 hover:bg-surface-elevated',
                    )}
                  >
                    {snapshot.youtubeStreamUrl ? 'Watch Live' : 'Read Rules'}
                  </Link>
                </div>

                <div className="home-rise border-hairline bg-hairline relative mt-10 grid border sm:grid-cols-2 lg:grid-cols-4">
                  {stats.map((stat) => (
                    <HeroStatCard key={stat.label} stat={stat} />
                  ))}
                </div>

                <WeekSchedule snapshot={snapshot} />
              </div>

              <aside className="bg-background">
                <MatchCenter snapshot={snapshot} live={live} />
              </aside>
            </section>

            <section
              id="broadcast"
              className="border-hairline grid border-b xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]"
            >
              <div className="border-hairline p-5 sm:p-7 xl:border-r">
                <div className="mb-4 flex items-baseline justify-between gap-4">
                  <h2 className="font-pixel text-2xl font-bold uppercase">
                    Broadcast
                  </h2>
                  <span className="text-destructive font-mono text-xs font-semibold tracking-[0.14em] uppercase">
                    {live ? 'Live' : 'Stream'}
                  </span>
                </div>
                <div className="border-hairline bg-surface-raised relative overflow-hidden border">
                  <div className="home-sweep pointer-events-none absolute inset-y-0 left-0 z-10 w-1/3 bg-[linear-gradient(90deg,transparent,oklch(0.881_0.205_158.31_/_0.08),transparent)]" />
                  <StreamEmbed
                    url={snapshot.youtubeStreamUrl}
                    title="The Circuit livestream"
                  />
                </div>
              </div>

              <div className="p-5 sm:p-7">
                <div className="mb-4 flex items-baseline justify-between gap-4">
                  <h2 className="font-pixel text-2xl font-bold uppercase">
                    Live Standings
                  </h2>
                  <Link
                    href="/leaderboard"
                    className="text-secondary rounded-md font-mono text-xs font-semibold tracking-[0.14em] uppercase focus-visible:ring-2 focus-visible:outline-none"
                  >
                    All Rankings
                  </Link>
                </div>
                <Card surface="broadcast" className="p-4">
                  <LiveLeaderboard
                    entries={snapshot.leaderboard}
                    highlightUserId={user?.id ?? null}
                    compact
                    broadcast
                  />
                </Card>
              </div>
            </section>

            {snapshot.bracket.some((round) => round.matches.length > 0) ? (
              <section className="border-hairline border-b p-5 sm:p-7">
                <div className="mb-5 flex flex-wrap items-baseline justify-between gap-4">
                  <h2 className="font-pixel text-2xl font-bold uppercase">
                    Sunday Bracket
                  </h2>
                  <Link
                    href={`/bracket/${snapshot.tournamentId}`}
                    className="text-secondary rounded-md font-mono text-xs font-semibold tracking-[0.14em] uppercase focus-visible:ring-2 focus-visible:outline-none"
                  >
                    Open Bracket
                  </Link>
                </div>
                <Card surface="broadcast" className="p-4">
                  <BracketTree
                    rounds={snapshot.bracket}
                    highlightUserId={user?.id ?? null}
                  />
                </Card>
                <p className="text-muted-foreground mt-3 font-mono text-xs">
                  Bracket data is public-safe; unrevealed problem titles remain
                  hidden.
                </p>
              </section>
            ) : null}
          </>
        ) : (
          <NoTournament />
        )}

        <section className="border-hairline grid border-b lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="border-hairline p-5 sm:p-7 lg:border-r">
            <h2 className="font-pixel text-2xl font-bold uppercase">
              League Format
            </h2>
            <ol className="mt-5 grid gap-3 md:grid-cols-2">
              <Step
                title="Register"
                body="Entry opens before the tournament. The live page uses only registered participant counts."
              />
              <Step
                title="Qualify"
                body="Simulation scores seed the bracket after the sealed qualifying window closes."
              />
              <Step
                title="Knockout"
                body="Head-to-head rounds reveal to both competitors at the same instant."
              />
              <Step
                title="Record"
                body="Completed tournaments publish placements and champions to the Hall of Fame."
              />
            </ol>
          </div>

          <div className="p-5 sm:p-7">
            <h2 className="font-pixel text-2xl font-bold uppercase">
              Reigning Champion
            </h2>
            {champion ? (
              <div className="mt-5 grid gap-5 sm:grid-cols-[auto_1fr]">
                <div className="home-drift border-hairline bg-secondary text-secondary-foreground flex size-20 items-center justify-center border">
                  <Trophy className="size-9" aria-hidden />
                </div>
                <div>
                  <p className="text-muted-foreground font-mono text-xs font-semibold tracking-[0.14em] uppercase">
                    {champion.tournamentName}
                  </p>
                  <h3 className="mt-2 text-3xl font-extrabold tracking-normal">
                    {champion.champion ? (
                      <Link
                        href={`/u/${champion.champion.username}`}
                        className="hover:text-secondary rounded-md focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {champion.champion.displayName ??
                          champion.champion.username}
                      </Link>
                    ) : (
                      'Unclaimed'
                    )}
                  </h3>
                  <p className="text-muted-foreground mt-3 font-mono text-sm">
                    {champion.participantCount} competitors .{' '}
                    {formatMinor(champion.prizePoolMinor)}
                  </p>
                  <Link
                    href="/hall-of-fame"
                    className="text-secondary mt-5 inline-flex rounded-md font-mono text-xs font-semibold tracking-[0.14em] uppercase focus-visible:ring-2 focus-visible:outline-none"
                  >
                    Hall of Fame
                  </Link>
                </div>
              </div>
            ) : (
              <Card surface="broadcast" className="mt-5 p-5">
                <p className="font-semibold">No champion recorded yet.</p>
                <p className="text-muted-foreground mt-2 text-sm">
                  The first completed public tournament will appear here.
                </p>
              </Card>
            )}
          </div>
        </section>

        <footer className="flex flex-wrap items-center gap-4 px-5 py-7 sm:px-7">
          <p className="text-muted-foreground font-mono text-xs tracking-[0.12em] uppercase">
            The Circuit {snapshot ? `. ${snapshot.name}` : ''} . all times IST
          </p>
          <div className="min-w-0 flex-1" />
          <FooterLink href="/rules">Rules</FooterLink>
          <FooterLink href="/hall-of-fame">Hall of Fame</FooterLink>
          <FooterLink href="/leaderboard">Leaderboard</FooterLink>
        </footer>

        {liveMatch ? <MatchDock match={liveMatch} /> : null}
      </main>
    </HomeMotion>
  );
}

function Ticker({
  snapshot,
  live,
}: {
  snapshot: LiveSnapshot | null;
  live: boolean;
}) {
  const facts = snapshot
    ? [
        snapshot.name,
        statusLabel(snapshot.status),
        `${snapshot.participantCount} competitors`,
        '₹0 prize pool while entries are free',
        snapshot.currentRound
          ? `${snapshot.currentRound.matchesDecided}/${snapshot.currentRound.matchesTotal} matches decided`
          : 'Bracket pending',
        snapshot.tiedMatches > 0
          ? `${snapshot.tiedMatches} tied matches need deciders`
          : null,
      ].filter((fact): fact is string => Boolean(fact))
    : ['No public tournament scheduled'];
  const run = facts.join(' . ');

  return (
    <div className="border-hairline bg-surface-deep sticky top-0 z-40 flex h-9 border-b">
      <div
        className={cn(
          'flex items-center gap-2 px-4 font-mono text-[0.68rem] font-bold tracking-[0.18em] uppercase',
          live
            ? 'bg-destructive text-black'
            : 'bg-secondary text-secondary-foreground',
        )}
      >
        <span className="home-live-dot size-1.5 rounded-full bg-black" />
        {live ? 'Live' : 'Circuit'}
      </div>
      <div className="flex min-w-0 flex-1 items-center overflow-hidden">
        <div className="home-ticker-track flex w-[200%] whitespace-nowrap">
          <p className="text-muted-foreground pr-8 font-mono text-[0.68rem] font-medium tracking-[0.08em] uppercase">
            {run} . {run} . {run}
          </p>
          <p
            className="text-muted-foreground pr-8 font-mono text-[0.68rem] font-medium tracking-[0.08em] uppercase"
            aria-hidden
          >
            {run} . {run} . {run}
          </p>
        </div>
      </div>
    </div>
  );
}

function BroadcastBackdrop({ live }: { live: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 bg-[linear-gradient(#141810_1px,transparent_1px),linear-gradient(90deg,#141810_1px,transparent_1px)] bg-[size:46px_46px]" />
      <div className="absolute -top-32 -left-36 size-[38rem] rounded-full bg-[radial-gradient(circle,oklch(0.881_0.205_158.31_/_0.09),transparent_62%)]" />
      <div className="home-scanline absolute inset-x-0 top-0 h-0.5 bg-[linear-gradient(90deg,transparent,oklch(0.881_0.205_158.31_/_0.5),transparent)]" />
      {live ? (
        <div className="absolute top-[18%] right-[10%] hidden items-center gap-3 md:flex">
          <span className="border-secondary text-secondary relative flex size-14 items-center justify-center rounded-full border">
            <CirclePlay className="size-8" aria-hidden />
            <span className="home-pulse-ring border-secondary absolute inset-0 rounded-full border" />
          </span>
        </div>
      ) : null}
    </div>
  );
}

function MatchCenter({
  snapshot,
  live,
}: {
  snapshot: LiveSnapshot;
  live: boolean;
}) {
  const round = snapshot.currentRound;

  return (
    <div className="flex min-h-[560px] flex-col">
      <div className="border-hairline border-b p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-muted-foreground font-mono text-xs font-semibold tracking-[0.18em] uppercase">
              Match Center
            </p>
            <h2 className="font-pixel mt-1 text-3xl font-bold uppercase">
              {live ? 'Now Live' : 'Next Up'}
            </h2>
          </div>
          <Radio className="text-secondary size-6" aria-hidden />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Countdown
            targetAt={snapshot.countdown?.targetAt ?? null}
            serverTime={snapshot.serverTime}
            phase={snapshot.countdown?.phase}
            className="border-hairline bg-surface-raised col-span-3 justify-center border px-3 py-4 text-center [&>span:last-child]:text-4xl [&>span:last-child]:font-black"
          />
        </div>
        <p className="text-muted-foreground mt-3 font-mono text-xs">
          {snapshot.countdown
            ? countdownLabel(snapshot.countdown.of)
            : 'No active countdown'}
        </p>
      </div>

      <div className="border-hairline border-b p-5">
        <p className="text-muted-foreground font-mono text-xs font-semibold tracking-[0.18em] uppercase">
          Current Round
        </p>
        <h3 className="font-pixel mt-2 text-2xl font-bold uppercase">
          {round ? formatStage(round.stage) : statusLabel(snapshot.status)}
        </h3>
        <p className="text-muted-foreground mt-3 text-sm leading-6">
          {round?.revealed
            ? (round.problemTitle ?? 'Challenge revealed')
            : 'Challenge details stay sealed until the round opens.'}
        </p>
      </div>

      <div className="flex-1 p-5">
        <p className="text-muted-foreground font-mono text-xs font-semibold tracking-[0.18em] uppercase">
          Public Facts
        </p>
        <dl className="mt-4 grid gap-2">
          <Fact label="Tournament" value={snapshot.name} />
          <Fact label="Status" value={statusLabel(snapshot.status)} />
          <Fact
            label="Matches"
            value={
              round
                ? `${round.matchesDecided}/${round.matchesTotal} decided`
                : 'Not generated'
            }
          />
          <Fact
            label="Tied matches"
            value={
              snapshot.tiedMatches > 0 ? String(snapshot.tiedMatches) : '0'
            }
          />
        </dl>
      </div>

      <div className="border-hairline border-t p-5">
        <Link
          href="/leaderboard"
          className={cn(
            buttonVariants({ variant: 'broadcast', size: 'broadcast' }),
            'w-full',
          )}
        >
          Open Match Center
        </Link>
      </div>
    </div>
  );
}

function HeroStatCard({ stat }: { stat: HeroStat }) {
  return (
    <div className="bg-background p-4">
      <p className="text-muted-foreground font-mono text-[0.68rem] font-semibold tracking-[0.18em] uppercase">
        {stat.label}
      </p>
      <p
        className={cn(
          'mt-2 truncate font-mono text-3xl font-bold tracking-normal tabular-nums',
          stat.tone === 'danger' && 'text-destructive',
        )}
      >
        {stat.count != null ? (
          <span className="home-count" data-count={stat.count}>
            {stat.value}
          </span>
        ) : (
          stat.value
        )}
      </p>
      <div className="bg-hairline mt-3 h-0.5 overflow-hidden">
        <div
          className={cn(
            'home-sweep h-0.5 w-2/5',
            stat.tone === 'danger' ? 'bg-destructive' : 'bg-secondary',
          )}
        />
      </div>
    </div>
  );
}

function WeekSchedule({ snapshot }: { snapshot: LiveSnapshot }) {
  const rows = [
    { label: 'Registration opens', at: snapshot.registrationOpensAt },
    { label: 'Registration closes', at: snapshot.registrationClosesAt },
    { label: 'Qualifiers open', at: snapshot.simulationOpensAt },
    { label: 'Qualifiers close', at: snapshot.simulationClosesAt },
    { label: 'Live bracket', at: snapshot.liveStartsAt },
  ].filter((row) => row.at);

  if (rows.length === 0) return null;

  return (
    <div className="home-rise border-hairline bg-background/70 relative mt-5 border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-pixel text-lg font-bold uppercase">
          Week Schedule
        </h2>
        <Link
          href={`/tournaments/${snapshot.slug}`}
          className="text-secondary rounded-md font-mono text-xs font-semibold tracking-[0.14em] uppercase focus-visible:ring-2 focus-visible:outline-none"
        >
          Tournament page
        </Link>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-5">
        {rows.map((row) => (
          <div key={row.label} className="border-hairline border p-3">
            <p className="text-muted-foreground font-mono text-[0.68rem] uppercase">
              {row.label}
            </p>
            <p className="mt-1 text-sm font-semibold">
              {formatSchedule(row.at)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-hairline flex items-center justify-between gap-3 border-b py-2">
      <dt className="text-muted-foreground font-mono text-xs">{label}</dt>
      <dd className="text-right text-sm font-semibold">{value}</dd>
    </div>
  );
}

function StatusChip({
  children,
  active = false,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        'border px-2.5 py-1 font-mono text-[0.68rem] font-semibold tracking-[0.12em] uppercase',
        active
          ? 'border-secondary/35 bg-secondary/10 text-secondary'
          : 'border-hairline text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function Step({ title, body }: { title: string; body: string }) {
  return (
    <li className="border-hairline bg-surface-raised border p-5">
      <p className="font-semibold">{title}</p>
      <p className="text-muted-foreground mt-2 text-sm leading-6">{body}</p>
    </li>
  );
}

function NoTournament() {
  return (
    <section className="border-hairline border-b p-5 sm:p-7">
      <Card surface="broadcast" className="p-8 text-center">
        <h1 className="font-pixel text-4xl font-bold uppercase">
          No tournament is scheduled yet.
        </h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-xl text-sm">
          Sign in now and return when registration opens for the next weekly
          bracket.
        </p>
      </Card>
    </section>
  );
}

function MatchDock({ match }: { match: MyMatchSummary }) {
  return (
    <div className="sticky bottom-0 z-30 px-3 pb-4 sm:px-5">
      <div className="border-hairline bg-background/95 mx-auto flex max-w-5xl flex-wrap items-center gap-3 rounded-full border px-4 py-3 shadow-lg backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="home-live-dot bg-destructive size-2 rounded-full" />
          <span className="text-destructive font-mono text-xs font-bold tracking-[0.16em] uppercase">
            {match.state.replace(/_/g, ' ')}
          </span>
        </div>
        <div className="bg-hairline h-5 w-px" />
        <p className="text-sm font-semibold">
          {formatStage(match.stage)}
          {match.opponentUsername ? ` vs ${match.opponentUsername}` : ''}
        </p>
        <Countdown
          targetAt={match.countdown.targetAt}
          serverTime={new Date().toISOString()}
          phase={match.countdown.phase}
          className="text-secondary font-mono [&>span:last-child]:text-sm"
        />
        <div className="min-w-5 flex-1" />
        <Link
          href={`/arena/knockout/${match.matchId}`}
          className={cn(buttonVariants({ variant: 'broadcast', size: 'sm' }))}
        >
          Open Arena
        </Link>
      </div>
    </div>
  );
}

function FooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-secondary rounded-md font-mono text-xs tracking-[0.12em] uppercase focus-visible:ring-2 focus-visible:outline-none"
    >
      {children}
    </Link>
  );
}

function getHeroStats(snapshot: LiveSnapshot | null): HeroStat[] {
  if (!snapshot) return [];

  const round = snapshot.currentRound;
  const matchesValue = round
    ? `${round.matchesDecided}/${round.matchesTotal}`
    : '0/0';

  return [
    {
      label: 'Competitors',
      value: String(snapshot.participantCount),
      count: snapshot.participantCount,
    },
    {
      label: 'Prize Pool',
      value: '₹0',
    },
    {
      label: 'Current Stage',
      value: round ? formatStage(round.stage) : statusLabel(snapshot.status),
    },
    {
      label: 'Matches Decided',
      value: matchesValue,
      count: round?.matchesDecided ?? 0,
      tone: round && round.matchesTotal > 0 ? 'default' : 'danger',
    },
  ];
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

function formatSchedule(value: string | null): string {
  if (!value) return 'TBA';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}
