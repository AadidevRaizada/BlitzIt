import Link from 'next/link';
import { ArrowRight, Radio, ShieldCheck, Trophy } from 'lucide-react';
import { getCurrentUser } from '@/server/modules/auth';
import { getSpectatorSnapshot } from '@/server/modules/tournament';
import { listHallOfFame } from '@/server/modules/hall-of-fame';
import { formatMinor } from '@/server/modules/notification';
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
    ? 'Enter This Week'
    : user
      ? 'Open Dashboard'
      : 'Sign In';

  return (
    <main>
      <section className="bg-surface-deep relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,oklch(0.7_0.18_289.47_/_0.22),transparent_34%),linear-gradient(135deg,oklch(0.095_0.018_289.47),oklch(0.06_0.02_289.47))]" />
        <div className="border-hairline relative mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-8 border-x px-4 py-12 sm:px-6 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="space-y-8">
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
                        : 'Broadcast Standby'
                }
              />
              <span className="text-muted-foreground text-sm">
                Weekly Sunday final, IST
              </span>
              {snapshot ? (
                <LiveRefresh
                  tournamentId={snapshot.tournamentId}
                  initialVersion={snapshot.version}
                />
              ) : null}
            </div>

            <div className="space-y-5">
              <DisplayHeading as="h1" size="hero">
                Build under pressure. Prove it live.
              </DisplayHeading>
              <p className="text-muted-foreground max-w-2xl text-lg leading-8 text-pretty">
                Blitz It is a weekly builder tournament where submissions face
                hidden tests, performance probes, security checks and a live
                knockout bracket. Speed matters because the clock is real.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={user ? '/dashboard' : '/login'}
                className={cn(
                  buttonVariants({ variant: 'broadcast', size: 'broadcast' }),
                )}
              >
                {ctaLabel}
                <ArrowRight className="size-4" aria-hidden />
              </Link>
              <Link
                href="/rules"
                className={cn(
                  buttonVariants({ variant: 'secondary', size: 'lg' }),
                  'border-hairline bg-surface-raised hover:bg-surface-elevated',
                )}
              >
                Read Rules
              </Link>
            </div>
          </div>

          <div className="space-y-4">
            <Card surface="broadcast" className="overflow-hidden p-3">
              {snapshot?.youtubeStreamUrl && live ? (
                <StreamEmbed url={snapshot.youtubeStreamUrl} />
              ) : (
                <div className="bg-surface-deep border-hairline flex aspect-video items-center justify-center rounded-lg border">
                  <div className="px-6 text-center">
                    <Radio
                      className="text-secondary mx-auto size-8"
                      aria-hidden
                    />
                    <p className="mt-3 text-lg font-semibold">
                      {snapshot?.name ?? 'Next tournament pending'}
                    </p>
                    <p className="text-muted-foreground mt-1 text-sm">
                      {snapshot
                        ? snapshot.status.replace(/_/g, ' ').toLowerCase()
                        : 'No tournament is scheduled yet.'}
                    </p>
                  </div>
                </div>
              )}
            </Card>

            <Card surface="broadcast" className="p-5">
              <p className="text-muted-foreground text-sm">
                {snapshot?.countdown?.of === 'ROUND'
                  ? 'Round clock'
                  : snapshot?.countdown
                    ? countdownLabel(snapshot.countdown.of)
                    : 'Countdown'}
              </p>
              <Countdown
                targetAt={snapshot?.countdown?.targetAt ?? null}
                serverTime={snapshot?.serverTime ?? new Date().toISOString()}
                phase={snapshot?.countdown?.phase}
                className="mt-2 [&>span:last-child]:font-sans [&>span:last-child]:text-[clamp(2.4rem,7vw,5.4rem)] [&>span:last-child]:font-extrabold [&>span:last-child]:tracking-[-0.035em]"
              />
            </Card>
          </div>
        </div>
      </section>

      {snapshot ? (
        <>
          <Section className="bg-background py-8 sm:py-10">
            <div className="grid gap-6 md:grid-cols-4">
              <Metric label="Tournament" value={snapshot.name} />
              <Metric
                label="Competitors"
                value={String(snapshot.participantCount)}
              />
              <Metric
                label="Prize Pool"
                value={formatMinor(snapshot.prizePoolMinor, snapshot.currency)}
              />
              <Metric
                label="Matches Decided"
                value={
                  snapshot.currentRound
                    ? `${snapshot.currentRound.matchesDecided}/${snapshot.currentRound.matchesTotal}`
                    : 'Standby'
                }
              />
            </div>
          </Section>

          {snapshot.currentRound ? (
            <Section className="bg-surface-raised py-10 sm:py-12">
              <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
                <div>
                  <Badge tone={live ? 'live' : 'brand'}>
                    {snapshot.currentRound.status}
                  </Badge>
                  <DisplayHeading size="compact" className="mt-4">
                    {snapshot.currentRound.stage.replace(/_/g, ' ')}
                  </DisplayHeading>
                </div>
                <div className="text-muted-foreground max-w-2xl text-lg leading-8">
                  {snapshot.currentRound.revealed
                    ? (snapshot.currentRound.problemTitle ??
                      'Challenge revealed')
                    : 'Challenge sealed until the round opens.'}
                  {snapshot.tiedMatches > 0 ? (
                    <p className="text-warning mt-3 text-base">
                      {snapshot.tiedMatches} tied match
                      {snapshot.tiedMatches === 1 ? '' : 'es'} awaiting sudden
                      death.
                    </p>
                  ) : null}
                </div>
              </div>
            </Section>
          ) : null}

          {snapshot.bracket.some((round) => round.matches.length > 0) ? (
            <Section bleed>
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

          <Section className="bg-background">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <DisplayHeading>Standings</DisplayHeading>
              <Link
                href="/leaderboard"
                className="text-primary hover:text-secondary focus-visible:ring-ring rounded-md text-sm font-semibold focus-visible:ring-2 focus-visible:outline-none"
              >
                Full leaderboard
              </Link>
            </div>
            <Card surface="broadcast" className="px-4">
              <LiveLeaderboard
                entries={snapshot.leaderboard}
                highlightUserId={user?.id ?? null}
                compact
              />
            </Card>
          </Section>
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
          <DisplayHeading>How A Week Works</DisplayHeading>
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
            body="Three timed rounds are scored by deterministic measurements."
          />
          <Step
            n="03"
            title="Knockout"
            body="Head to head challenges reveal to both competitors at the same instant."
          />
          <Step
            n="04"
            title="Final"
            body="AI code review joins the score from the semi-finals onward."
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
                  <h3 className="mt-2 text-2xl font-extrabold tracking-[-0.03em]">
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

function countdownLabel(of: string): string {
  switch (of) {
    case 'REGISTRATION_OPENS':
      return 'Registration opens in';
    case 'REGISTRATION_CLOSES':
      return 'Registration closes in';
    case 'SIMULATION_OPENS':
      return 'Qualifiers open in';
    case 'SIMULATION_CLOSES':
      return 'Qualifiers close in';
    case 'KNOCKOUT_STARTS':
      return 'Knockout starts in';
    default:
      return 'Next up';
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-hairline border-l pl-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 truncate text-2xl font-extrabold tracking-[-0.03em] tabular-nums">
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
