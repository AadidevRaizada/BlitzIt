import Link from 'next/link';
import { ArrowRight, Radio, Trophy } from 'lucide-react';
import type { HallOfFameEntry } from '@/server/modules/hall-of-fame';
import { formatMinor } from '@/server/modules/notification';
import type { LiveSnapshot, MyMatchSummary } from '@/server/modules/tournament';
import { BracketTree } from '@/components/features/bracket-tree';
import { Countdown } from '@/components/features/countdown';
import { HomeMotion } from '@/components/features/home-motion';
import { LiveLeaderboard } from '@/components/features/live-leaderboard';
import { LiveRefresh } from '@/components/features/live-refresh';
import { StreamEmbed } from '@/components/features/stream-embed';
import { Badge, LiveDot } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DisplayHeading } from '@/components/ui/display-heading';
import { EmptyState } from '@/components/ui/empty-state';
import { Eyebrow } from '@/components/ui/eyebrow';
import { cn } from '@/lib/utils';

type HeroStat = {
  label: string;
  value: string;
  count?: number;
  tone?: 'default' | 'danger';
};

/**
 * The front page, with the data already fetched.
 *
 * Presentational on purpose: the route does the reads, this renders them. That
 * is what lets `/preview/home` show the live and standby states from fixtures
 * without a database, and it keeps every branch of this page reviewable.
 */
export function HomeView({
  snapshot,
  champion,
  liveMatch,
  userId,
  isSignedIn,
}: {
  snapshot: LiveSnapshot | null;
  champion: HallOfFameEntry | null;
  /** The viewer's own unfinished match, if they have one. */
  liveMatch: MyMatchSummary | null;
  userId: string | null;
  isSignedIn: boolean;
}) {
  const live = snapshot?.status === 'LIVE';
  const registering = snapshot?.status === 'REGISTRATION_OPEN';
  const completed = snapshot?.status === 'COMPLETED';
  const ctaHref = registering
    ? `/tournaments/${snapshot?.slug}`
    : isSignedIn
      ? '/dashboard'
      : '/tournaments';
  const ctaLabel = registering
    ? 'Register'
    : isSignedIn
      ? 'Open dashboard'
      : 'View tournaments';
  const stats = getHeroStats(snapshot);

  return (
    <HomeMotion>
      <main className="bg-background text-foreground min-h-screen">
        {/*
         * The scrolling ticker that used to sit here is gone. It looped the
         * same handful of facts — several of which render empty before a
         * tournament exists — which read as a broken marquee rather than a
         * live feed. The status bar below states the same facts once, and the
         * Match Center carries the live signal properly.
         */}
        <div className="border-hairline bg-surface-deep/90 sticky top-0 z-40 flex flex-wrap items-center gap-3 border-b px-4 py-3 backdrop-blur sm:px-7">
          <span className="font-display text-base font-bold tracking-[-0.02em]">
            The Circuit
          </span>
          {live ? (
            <Badge tone="live">
              <LiveDot />
              Live
            </Badge>
          ) : null}
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
            className={cn(buttonVariants({ variant: 'primary', size: 'sm' }))}
          >
            {isSignedIn ? 'Dashboard' : 'Sign in'}
          </Link>
        </div>

        {snapshot ? (
          <>
            <section className="border-hairline grid border-b xl:grid-cols-[minmax(0,1.5fr)_minmax(370px,0.9fr)]">
              <div className="border-hairline relative overflow-hidden px-5 py-12 sm:px-10 xl:border-r">
                <BroadcastBackdrop live={live} />

                <div className="relative flex flex-wrap items-start justify-between gap-5">
                  <Eyebrow tone="primary">
                    The Circuit — AI-native coding esport
                  </Eyebrow>
                  <div className="border-hairline bg-background/70 flex items-center gap-2 rounded-md border px-3 py-1.5">
                    {live ? <LiveDot /> : null}
                    <Eyebrow tone={live ? 'live' : 'muted'}>
                      {live ? 'Live' : completed ? 'Completed' : 'Standby'}
                    </Eyebrow>
                  </div>
                </div>

                <DisplayHeading
                  as="h1"
                  size="hero"
                  className="relative mt-8 leading-[0.95]"
                >
                  {/* The first two lines are the setup and take the raking
                      light; the third is the payoff and stays solid brand blue,
                      so the eye lands on it. */}
                  <span className="home-hero-line text-raked block">
                    Build.
                  </span>
                  <span className="home-hero-line text-raked block">
                    Qualify.
                  </span>
                  <span className="home-hero-line text-primary block">
                    Win live.
                  </span>
                </DisplayHeading>

                <p className="home-rise text-muted-foreground relative mt-6 max-w-2xl text-base leading-7 text-pretty sm:text-lg">
                  Fifteen minutes. One shot. Sealed challenges drop
                  simultaneously, the automated judge grades shipped work, and
                  the survivors fight it out live.
                </p>

                <div className="home-rise relative mt-8 flex flex-wrap gap-3">
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
                    )}
                  >
                    {snapshot.youtubeStreamUrl ? 'Watch live' : 'Read rules'}
                  </Link>
                </div>

                <div className="home-rise stagger border-hairline relative mt-10 grid gap-px overflow-hidden rounded-lg border sm:grid-cols-2 lg:grid-cols-4">
                  {stats.map((stat) => (
                    <HeroStatCard key={stat.label} stat={stat} />
                  ))}
                </div>

                <WeekSchedule snapshot={snapshot} />
              </div>

              <aside className="bg-surface-deep">
                <MatchCenter snapshot={snapshot} live={live} />
              </aside>
            </section>

            <section
              id="broadcast"
              className="border-hairline grid border-b xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)]"
            >
              <div className="border-hairline p-5 sm:p-7 xl:border-r">
                <SectionHead
                  eyebrow="Broadcast"
                  title={live ? 'Watching now' : 'Stream'}
                  live={live}
                />
                <div className="border-hairline bg-surface-raised relative overflow-hidden rounded-lg border">
                  {live ? (
                    <div className="home-sweep from-primary/0 via-primary/15 to-primary/0 pointer-events-none absolute inset-y-0 left-0 z-10 w-1/3 bg-gradient-to-r" />
                  ) : null}
                  <StreamEmbed
                    url={snapshot.youtubeStreamUrl}
                    title="The Circuit livestream"
                  />
                </div>
              </div>

              <div className="p-5 sm:p-7">
                <SectionHead
                  eyebrow="Standings"
                  title="Live standings"
                  action={{ href: '/leaderboard', label: 'All rankings' }}
                />
                <Card surface="broadcast" className="p-4">
                  <LiveLeaderboard
                    entries={snapshot.leaderboard}
                    highlightUserId={userId}
                    compact
                    broadcast
                  />
                </Card>
              </div>
            </section>

            {snapshot.bracket.some((round) => round.matches.length > 0) ? (
              <section className="border-hairline border-b p-5 sm:p-7">
                <SectionHead
                  eyebrow="Knockout"
                  title="Sunday bracket"
                  action={{
                    href: `/bracket/${snapshot.tournamentId}`,
                    label: 'Open bracket',
                  }}
                />
                <Card surface="broadcast" className="p-4">
                  <BracketTree
                    rounds={snapshot.bracket}
                    highlightUserId={userId}
                  />
                </Card>
                <p className="text-muted-foreground mt-3 text-xs">
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
            <SectionHead eyebrow="How it works" title="League format" />
            <ol className="stagger mt-1 grid gap-3 md:grid-cols-2">
              <Step
                index={1}
                title="Register"
                body="Entry opens before the tournament. The live page uses only registered participant counts."
              />
              <Step
                index={2}
                title="Qualify"
                body="Simulation scores seed the bracket after the sealed qualifying window closes."
              />
              <Step
                index={3}
                title="Knockout"
                body="Head-to-head rounds reveal to both competitors at the same instant."
              />
              <Step
                index={4}
                title="Record"
                body="Completed tournaments publish placements and champions to the Hall of Fame."
              />
            </ol>
          </div>

          <div className="p-5 sm:p-7">
            <SectionHead eyebrow="Hall of fame" title="Reigning champion" />
            {champion ? (
              <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
                <div className="home-drift border-hairline bg-primary/12 text-primary flex size-20 items-center justify-center rounded-lg border">
                  <Trophy className="size-9" aria-hidden />
                </div>
                <div>
                  <Eyebrow>{champion.tournamentName}</Eyebrow>
                  <DisplayHeading as="h3" size="compact" className="mt-2">
                    {champion.champion ? (
                      <Link
                        href={`/u/${champion.champion.username}`}
                        className="hover:text-primary rounded-md transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {champion.champion.displayName ??
                          champion.champion.username}
                      </Link>
                    ) : (
                      'Unclaimed'
                    )}
                  </DisplayHeading>
                  <p className="text-muted-foreground mt-3 font-mono text-sm tabular-nums">
                    {champion.participantCount} competitors ·{' '}
                    {formatMinor(champion.prizePoolMinor)}
                  </p>
                  <Link
                    href="/hall-of-fame"
                    className="text-primary mt-5 inline-flex rounded-md text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                  >
                    Hall of Fame
                  </Link>
                </div>
              </div>
            ) : (
              <EmptyState
                title="No champion recorded yet"
                description="The first completed public tournament will appear here."
              />
            )}
          </div>
        </section>

        <footer className="flex flex-wrap items-center gap-4 px-5 py-7 sm:px-7">
          <Eyebrow>
            The Circuit {snapshot ? `· ${snapshot.name}` : ''} · all times IST
          </Eyebrow>
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

/**
 * Section heading: a tracked all-caps eyebrow over a normal-case title, with
 * an optional trailing link. Every band on this page uses it, which is what
 * stops each section from inventing its own heading treatment.
 */
function SectionHead({
  eyebrow,
  title,
  action,
  live = false,
}: {
  eyebrow: string;
  title: string;
  action?: { href: string; label: string };
  live?: boolean;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Eyebrow tone={live ? 'live' : 'muted'}>{eyebrow}</Eyebrow>
        <DisplayHeading size="compact" className="mt-1.5">
          {title}
        </DisplayHeading>
      </div>
      {action ? (
        <Link
          href={action.href}
          className="text-primary rounded-md text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

/**
 * Backdrop for the hero. Built entirely from design tokens via `color-mix`,
 * so it re-tints with the theme instead of pinning literal brand colours into
 * the page — which is how the previous mint gradients survived a rebrand.
 */
/**
 * Hero backdrop.
 *
 * The 46px line grid that used to sit here is replaced by the brand animation
 * served from the CDN, as an MP4 rather than a GIF — same motion at roughly a
 * seventh of the bytes. Notes on what this has to get right:
 *
 * - **Legibility.** The hero carries an 18:1 headline that the contrast check
 *   guarantees against `--background`, not against arbitrary artwork. The two
 *   scrim layers below restore that guarantee: an opaque left-to-right wash
 *   behind the copy, and a bottom-up wash under the stat row.
 * - **Autoplay.** `muted` is what makes autoplay legal in every current
 *   browser, and `playsInline` is what stops iOS Safari hijacking the whole
 *   viewport into its native fullscreen player.
 * - **Reduced motion.** Hidden under `prefers-reduced-motion`. The glow and
 *   layout are unaffected, so nothing is lost but the movement.
 * - **Loading.** `preload="metadata"`, so the decorative video never competes
 *   with the headline for bandwidth. It is allowed to arrive late over a
 *   background that already looks finished without it.
 * - **Inert.** `aria-hidden` plus `tabIndex={-1}` keep it out of the
 *   accessibility tree and the tab order; it carries no information.
 */
const HERO_MEDIA_URL = 'https://thecircuit.aadidevraizada26.workers.dev';

function BroadcastBackdrop({ live }: { live: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <video
        src={HERO_MEDIA_URL}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden
        tabIndex={-1}
        className="absolute inset-0 size-full object-cover opacity-40 motion-reduce:hidden"
      />

      {/* Scrims — these are what keep the headline readable over the art. */}
      <div className="from-background via-background/90 absolute inset-0 bg-gradient-to-r to-transparent" />
      <div className="from-background absolute inset-0 bg-gradient-to-t via-transparent to-transparent" />

      <div className="absolute -top-32 -left-36 size-[38rem] rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--color-primary)_14%,transparent),transparent_62%)]" />
      {live ? (
        <div className="home-scanline via-destructive/60 absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent to-transparent" />
      ) : null}
    </div>
  );
}

/**
 * Match Center — the page's live scoreboard and, per the brief, the element
 * that earns the most visual investment. The countdown is the hero here: it
 * ticks every second and turns red under a minute, so the panel reads as
 * tracking something happening rather than displaying a record.
 */
function MatchCenter({
  snapshot,
  live,
}: {
  snapshot: LiveSnapshot;
  live: boolean;
}) {
  const round = snapshot.currentRound;

  return (
    <div className="flex min-h-full flex-col">
      <div
        className={cn(
          'border-hairline border-b p-5',
          live && 'bg-destructive/5',
        )}
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <Eyebrow tone={live ? 'live' : 'primary'}>Match Center</Eyebrow>
            <DisplayHeading size="compact" className="mt-1.5">
              {live ? 'Now live' : 'Next up'}
            </DisplayHeading>
          </div>
          {live ? (
            <LiveDot className="size-2.5" />
          ) : (
            <Radio className="text-primary size-5" aria-hidden />
          )}
        </div>

        <div className="border-hairline bg-surface-raised mt-5 rounded-lg border px-4 py-6 text-center">
          <Countdown
            targetAt={snapshot.countdown?.targetAt ?? null}
            serverTime={snapshot.serverTime}
            phase={snapshot.countdown?.phase}
            size="hero"
            className="justify-center"
          />
          <p className="text-muted-foreground mt-2 text-xs">
            {snapshot.countdown
              ? countdownLabel(snapshot.countdown.of)
              : 'No active countdown'}
          </p>
        </div>
      </div>

      <div className="border-hairline border-b p-5">
        <Eyebrow>Current round</Eyebrow>
        <DisplayHeading as="h3" size="panel" className="mt-2 text-xl">
          {round ? formatStage(round.stage) : statusLabel(snapshot.status)}
        </DisplayHeading>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          {round?.revealed
            ? (round.problemTitle ?? 'Challenge revealed')
            : 'Challenge details stay sealed until the round opens.'}
        </p>
        {round ? (
          <MatchProgress
            decided={round.matchesDecided}
            total={round.matchesTotal}
          />
        ) : null}
      </div>

      <div className="flex-1 p-5">
        <Eyebrow>Public facts</Eyebrow>
        <dl className="mt-3 grid gap-1">
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
          Open full standings
        </Link>
      </div>
    </div>
  );
}

/** A real progress bar for the round, so "3/8 decided" is legible at a glance. */
function MatchProgress({ decided, total }: { decided: number; total: number }) {
  if (total <= 0) return null;
  const pct = Math.round((decided / total) * 100);

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-eyebrow text-muted-foreground font-mono font-semibold uppercase">
          Matches decided
        </span>
        <span className="font-mono text-sm font-bold tabular-nums">
          {decided}/{total}
        </span>
      </div>
      <div
        className="bg-hairline mt-2 h-1 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={decided}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Matches decided this round"
      >
        <div
          className="bg-primary h-full origin-left animate-[var(--animate-meter-in)] rounded-full"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function HeroStatCard({ stat }: { stat: HeroStat }) {
  return (
    <div className="bg-background hover:bg-surface-raised p-4 transition-colors duration-[var(--motion-base)]">
      <Eyebrow>{stat.label}</Eyebrow>
      <p
        className={cn(
          'mt-2 truncate font-mono text-3xl font-bold tabular-nums',
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
    </div>
  );
}

function WeekSchedule({ snapshot }: { snapshot: LiveSnapshot }) {
  const rows = [
    { label: 'Registration opens', at: snapshot.registrationOpensAt },
    { label: 'Registration closes', at: snapshot.registrationClosesAt },
    { label: 'Qualifiers open', at: snapshot.simulationOpensAt },
    { label: 'Qualifiers close', at: snapshot.simulationClosesAt },
    { label: 'Knockouts', at: snapshot.liveStartsAt },
  ].filter((row) => row.at);

  if (rows.length === 0) return null;

  return (
    <div className="home-rise border-hairline bg-background/70 relative mt-6 rounded-lg border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Eyebrow>Schedule</Eyebrow>
          <DisplayHeading as="h3" size="panel" className="mt-1.5">
            Week schedule
          </DisplayHeading>
        </div>
        <Link
          href={`/tournaments/${snapshot.slug}`}
          className="text-primary rounded-md text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Tournament page
        </Link>
      </div>
      <div className="stagger mt-4 grid gap-2 md:grid-cols-5">
        {rows.map((row) => (
          <div
            key={row.label}
            className="border-hairline bg-surface-raised hover:border-primary/40 rounded-md border p-3 transition-colors duration-[var(--motion-base)]"
          >
            <Eyebrow>{row.label}</Eyebrow>
            {/* The date, then the time. "Fri, 11:59 pm" left the reader to
                work out WHICH Friday from a page that never says — the actual
                dates were only ever printed on the tournament page. */}
            <p className="mt-1.5 font-mono text-sm font-bold tabular-nums">
              {formatScheduleDate(row.at)}
            </p>
            <p className="text-muted-foreground mt-0.5 font-mono text-xs tabular-nums">
              {formatScheduleTime(row.at)} IST
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-hairline flex items-center justify-between gap-3 border-b py-2 last:border-0">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-right font-mono text-sm font-bold tabular-nums">
        {value}
      </dd>
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
        'text-eyebrow rounded-md border px-2.5 py-1 font-mono font-semibold uppercase',
        active
          ? 'border-primary/35 bg-primary/10 text-primary'
          : 'border-hairline text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

function Step({
  index,
  title,
  body,
}: {
  index: number;
  title: string;
  body: string;
}) {
  return (
    <li className="border-hairline bg-surface-raised hover:border-primary/40 edge-light relative overflow-hidden rounded-lg border p-5 transition-colors duration-[var(--motion-base)]">
      <span className="text-primary font-mono text-sm font-bold tabular-nums">
        {String(index).padStart(2, '0')}
      </span>
      <p className="mt-1.5 font-semibold">{title}</p>
      <p className="text-muted-foreground mt-2 text-sm leading-6">{body}</p>
    </li>
  );
}

/**
 * Standby.
 *
 * A front page with no tournament on it is the hardest state to get right: it
 * is the first thing a stranger sees, and "nothing is happening" must not read
 * as "nothing ever happens here". So the pitch still gets made at full size,
 * and the absence is stated once, quietly, underneath it.
 */
function NoTournament() {
  return (
    <section className="field-backdrop border-hairline border-b px-5 py-20 sm:px-7">
      <div className="mx-auto max-w-3xl text-center">
        <Eyebrow tone="primary">The Circuit — AI-native coding esport</Eyebrow>
        <DisplayHeading as="h1" size="hero" className="mx-auto mt-6">
          <span className="text-raked block">Build.</span>
          <span className="text-raked block">Qualify.</span>
          <span className="text-primary block">Win live.</span>
        </DisplayHeading>
        <p className="text-muted-foreground mx-auto mt-7 max-w-xl text-base leading-7 text-pretty">
          Fifteen minutes. One shot. Sealed challenges drop simultaneously, the
          automated judge grades shipped work, and the survivors fight it out
          live.
        </p>

        <div className="border-hairline mx-auto mt-10 max-w-md rounded-lg border px-5 py-4">
          <Eyebrow>Standby</Eyebrow>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            No tournament is on the calendar right now. The next one is
            announced a week before entries open.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/tournaments"
            className={cn(
              buttonVariants({ variant: 'broadcast', size: 'broadcast' }),
              '[&_svg]:transition-transform hover:[&_svg]:translate-x-1',
            )}
          >
            Browse tournaments
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            href="/rules"
            className={cn(buttonVariants({ variant: 'secondary', size: 'lg' }))}
          >
            Read the rules
          </Link>
        </div>
      </div>
    </section>
  );
}

function MatchDock({ match }: { match: MyMatchSummary }) {
  return (
    <div className="sticky bottom-0 z-30 px-3 pb-4 sm:px-5">
      <div className="border-destructive/40 bg-background/95 mx-auto flex max-w-5xl flex-wrap items-center gap-3 rounded-full border px-4 py-3 shadow-lg backdrop-blur">
        <div className="flex items-center gap-2">
          <LiveDot />
          <Eyebrow tone="live">{match.state.replace(/_/g, ' ')}</Eyebrow>
        </div>
        <div className="bg-hairline h-5 w-px" />
        <p className="font-display text-sm font-bold">
          {formatStage(match.stage)}
          {match.opponentUsername ? ` vs ${match.opponentUsername}` : ''}
        </p>
        <Countdown
          targetAt={match.countdown.targetAt}
          serverTime={new Date().toISOString()}
          phase={match.countdown.phase}
          size="inline"
        />
        <div className="min-w-5 flex-1" />
        <Link
          href={`/arena/knockout/${match.matchId}`}
          className={cn(buttonVariants({ variant: 'danger', size: 'sm' }))}
        >
          Open arena
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
      className="text-muted-foreground hover:text-primary rounded-md text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
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
      value: formatMinor(snapshot.prizePool.prizePoolMinor),
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

/** e.g. `Tue 4 Aug`. Everything on this page is IST; the label says so once. */
function formatScheduleDate(value: string | null): string {
  if (!value) return 'TBA';
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

function formatScheduleTime(value: string | null): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}
