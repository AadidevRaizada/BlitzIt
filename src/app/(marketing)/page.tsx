import Link from 'next/link';
import { getCurrentUser } from '@/server/modules/auth';
import { getSpectatorSnapshot } from '@/server/modules/tournament';
import { listHallOfFame } from '@/server/modules/hall-of-fame';
import { formatMinor } from '@/server/modules/notification';
import { Badge } from '@/components/ui/badge';
import { BracketTree } from '@/components/features/bracket-tree';
import { Countdown } from '@/components/features/countdown';
import { LiveLeaderboard } from '@/components/features/live-leaderboard';
import { LiveRefresh } from '@/components/features/live-refresh';
import { StreamEmbed } from '@/components/features/stream-embed';

export const dynamic = 'force-dynamic';

/**
 * Screen [1] — the landing page IS the spectator experience (D10, E8.1).
 *
 * One job: a first-time visitor should be able to tell, within a second,
 * whether something is happening right now. So the page leads with whatever is
 * most live — the stream and the bracket during an event, the countdown and the
 * call to action before one — and everything on it is fed by the same
 * `LiveSnapshot` the arena uses, kept current by `LiveRefresh`.
 *
 * Server-rendered. The live surfaces are read models; a client-side rebuild
 * would duplicate the reveal rules that keep an unopened round's challenge
 * hidden, on the one page where the whole internet can see the result.
 */
export default async function HomePage() {
  const [snapshot, hallOfFame, user] = await Promise.all([
    getSpectatorSnapshot({ leaderboardTake: 10 }),
    listHallOfFame({ take: 3 }),
    getCurrentUser(),
  ]);

  const live = snapshot?.status === 'LIVE';
  const registering = snapshot?.status === 'REGISTRATION_OPEN';

  return (
    <main className="mx-auto max-w-5xl space-y-12 px-4 py-10 sm:px-6">
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className="space-y-4 text-center">
        <div className="flex items-center justify-center gap-3">
          <span className="border-border bg-secondary text-secondary-foreground rounded-full border px-3 py-1 text-xs font-medium">
            Weekly · Sunday · IST
          </span>
          {snapshot ? (
            <LiveRefresh
              tournamentId={snapshot.tournamentId}
              initialVersion={snapshot.version}
            />
          ) : null}
        </div>

        <h1 className="from-primary to-accent-foreground bg-gradient-to-r bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-6xl">
          Blitz It
        </h1>

        {/* D21 is the positioning, stated plainly. Not "the fastest coder". */}
        <p className="mx-auto max-w-2xl text-lg font-medium">
          Who can build the best software under real production constraints?
        </p>
        <p className="text-muted-foreground mx-auto max-w-xl text-sm">
          Not the fastest programmer — the one whose work survives being used.
          Every submission is measured against hidden tests, performance,
          security and robustness. Speed is just one of the constraints.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link
            href={user ? '/dashboard' : '/login'}
            className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex h-10 items-center rounded-md px-5 text-sm font-medium hover:opacity-90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {registering
              ? 'Enter this week'
              : user
                ? 'Your dashboard'
                : 'Sign in'}
          </Link>
          <Link
            href="/leaderboard"
            className="border-border focus-visible:ring-ring inline-flex h-10 items-center rounded-md border px-5 text-sm font-medium hover:opacity-90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Leaderboard
          </Link>
        </div>
      </section>

      {snapshot ? (
        <>
          {/* ── The live numbers ───────────────────────────────────── */}
          <section
            aria-label="Live tournament status"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Stat
              label="Tournament"
              value={snapshot.name}
              hint={snapshot.status.replace(/_/g, ' ').toLowerCase()}
            />
            <Stat
              label="Competitors"
              value={String(snapshot.participantCount)}
              hint="registered this week"
            />
            <Stat
              label="Prize pool"
              value={formatMinor(snapshot.prizePoolMinor, snapshot.currency)}
              hint="grows with every entry"
            />
            <div className="border-border bg-card rounded-lg border p-4">
              <p className="text-muted-foreground text-xs">
                {snapshot.countdown?.of === 'ROUND'
                  ? 'Round ends in'
                  : snapshot.countdown
                    ? countdownLabel(snapshot.countdown.of)
                    : 'Next up'}
              </p>
              <div className="mt-1">
                <Countdown
                  targetAt={snapshot.countdown?.targetAt ?? null}
                  serverTime={snapshot.serverTime}
                  phase={snapshot.countdown?.phase}
                />
              </div>
            </div>
          </section>

          {/* ── Stream + current round ─────────────────────────────── */}
          <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div className="space-y-3">
              <h2 className="text-sm font-semibold tracking-wide uppercase">
                {live ? 'Live now' : 'The stream'}
              </h2>
              <StreamEmbed url={snapshot.youtubeStreamUrl} />
            </div>

            <div className="space-y-3">
              <h2 className="text-sm font-semibold tracking-wide uppercase">
                Current round
              </h2>
              <div className="border-border bg-card space-y-2 rounded-lg border p-4 text-sm">
                {snapshot.currentRound ? (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {snapshot.currentRound.stage.replace(/_/g, ' ')}
                      </span>
                      <Badge tone={live ? 'brand' : 'neutral'}>
                        {snapshot.currentRound.status}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">
                      {/* The challenge title is withheld until the round opens
                          — the same simultaneous-reveal rule competitors get. */}
                      {snapshot.currentRound.revealed
                        ? (snapshot.currentRound.problemTitle ??
                          'Challenge revealed')
                        : 'Challenge sealed until the round opens'}
                    </p>
                    <p className="text-muted-foreground tabular-nums">
                      {snapshot.currentRound.matchesDecided} of{' '}
                      {snapshot.currentRound.matchesTotal} matches decided
                    </p>
                    {snapshot.tiedMatches > 0 ? (
                      <p className="text-warning-foreground">
                        {snapshot.tiedMatches} dead heat
                        {snapshot.tiedMatches === 1 ? '' : 's'} awaiting sudden
                        death
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    No round is running right now.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ── Bracket ────────────────────────────────────────────── */}
          {snapshot.bracket.some((round) => round.matches.length > 0) ? (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold tracking-wide uppercase">
                  The bracket
                </h2>
                <Link
                  href={`/bracket/${snapshot.tournamentId}`}
                  className="text-primary text-sm hover:underline"
                >
                  Full bracket →
                </Link>
              </div>
              <BracketTree
                rounds={snapshot.bracket}
                highlightUserId={user?.id ?? null}
              />
            </section>
          ) : null}

          {/* ── Leaderboard ────────────────────────────────────────── */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold tracking-wide uppercase">
                Standings
              </h2>
              <Link
                href="/leaderboard"
                className="text-primary text-sm hover:underline"
              >
                Full leaderboard →
              </Link>
            </div>
            <div className="border-border bg-card rounded-lg border px-4">
              <LiveLeaderboard
                entries={snapshot.leaderboard}
                highlightUserId={user?.id ?? null}
                compact
              />
            </div>
          </section>
        </>
      ) : (
        <section className="border-border rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">No tournament is scheduled yet</p>
          <p className="text-muted-foreground mt-1 text-sm">
            Sign in and you will be told the moment registration opens.
          </p>
        </section>
      )}

      {/* ── How the week works ───────────────────────────────────── */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          How a week works
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Step
            n={1}
            title="Register"
            body="Entry is open through the week. Every entry grows the prize pool."
          />
          <Step
            n={2}
            title="Qualify"
            body="Three timed rounds. Scored on deterministic measurements only — no AI, no opinions."
          />
          <Step
            n={3}
            title="Knockout"
            body="Head to head, one challenge at a time, revealed to both competitors at the same instant."
          />
          <Step
            n={4}
            title="Final"
            body="From the semi-finals a code-quality review joins the score. Commentary runs live."
          />
        </ol>
        <p className="text-muted-foreground text-xs">
          Functional tests 60% · performance 15% · security &amp; reliability
          10% · AI code review 15%, and the AI pass applies{' '}
          <strong>only from the semi-finals onward</strong>. Everything before
          that is decided by measurements you can reproduce.
        </p>
      </section>

      {/* ── Hall of Fame teaser ──────────────────────────────────── */}
      {hallOfFame.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold tracking-wide uppercase">
              Past champions
            </h2>
            <Link
              href="/hall-of-fame"
              className="text-primary text-sm hover:underline"
            >
              Hall of Fame →
            </Link>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3">
            {hallOfFame.map((entry) => (
              <li
                key={entry.tournamentId}
                className="border-border bg-card rounded-lg border p-4"
              >
                <p className="text-muted-foreground text-xs">
                  {entry.tournamentName}
                </p>
                <p className="mt-1 font-semibold">
                  {entry.champion ? (
                    <Link
                      href={`/u/${entry.champion.username}`}
                      className="hover:text-primary hover:underline"
                    >
                      {entry.champion.displayName ?? entry.champion.username}
                    </Link>
                  ) : (
                    '—'
                  )}
                </p>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {entry.participantCount} competitors ·{' '}
                  {formatMinor(entry.prizePoolMinor)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold">{value}</p>
      {hint ? (
        <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="border-border bg-card rounded-lg border p-4">
      <span className="text-primary text-xs font-semibold">0{n}</span>
      <p className="mt-1 font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 text-sm">{body}</p>
    </li>
  );
}
