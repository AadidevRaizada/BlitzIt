import Link from 'next/link';
import { requireUser } from '@/server/modules/auth';
import {
  listMyLiveMatches,
  ARENA_STATE_LABEL,
  type MyMatchSummary,
} from '@/server/modules/tournament';
import { isLiveArenaEnabled } from '@/lib/flags';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Countdown } from '@/components/features/countdown';

export const metadata = { title: 'Dashboard - The Circuit' };
export const dynamic = 'force-dynamic';

/**
 * Competitor dashboard (E1 placeholder + the E7 arena entry point).
 *
 * The full weekly dashboard (screen [6] — schedule, pass state, seed, season
 * progress) is still ahead. What E7 adds is the one thing the arena cannot do
 * without: a way to reach it. A competitor should never need to know a match id.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await requireUser('/dashboard');

  const arenaEnabled = await isLiveArenaEnabled({
    id: user.id,
    role: user.role,
  });
  const matches = arenaEnabled
    ? await listMyLiveMatches(user.id)
    : ([] as MyMatchSummary[]);

  return (
    <div className="space-y-6">
      {error === 'forbidden' ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          You do not have access to that area.
        </p>
      ) : null}

      <div>
        <h1 className="text-2xl font-bold">
          Welcome, {user.displayName ?? user.username}
        </h1>
        <p className="text-muted-foreground text-sm">
          Signed in as {user.email} · role {user.role}
        </p>
      </div>

      {matches.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold tracking-wide uppercase">
            Your matches
          </h2>
          <ul className="space-y-2">
            {matches.map((match) => (
              <li
                key={match.matchId}
                className="border-border bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">
                    {match.stage.replace('_', ' ')}
                    {match.opponentUsername ? (
                      <span className="text-muted-foreground font-normal">
                        {' '}
                        vs {match.opponentUsername}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {match.tournamentName}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Countdown
                    targetAt={match.countdown.targetAt}
                    serverTime={new Date().toISOString()}
                    phase={match.countdown.phase}
                    className="text-sm"
                  />
                  <Badge tone={STATE_TONE[match.state] ?? 'neutral'}>
                    {ARENA_STATE_LABEL[match.state]}
                  </Badge>
                  <Link
                    href={`/arena/knockout/${match.matchId}`}
                    className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex h-9 items-center rounded-md px-3 text-sm font-medium hover:opacity-90 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    Enter arena
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="border-border rounded-md border p-4 text-sm">
        <p className="font-medium">
          {matches.length > 0
            ? 'A knockout round is under way.'
            : 'No live match right now.'}
        </p>
        <p className="text-muted-foreground mt-1">
          Payments and the full weekly dashboard arrive in later milestones.
          Meanwhile you can{' '}
          <Link href="/settings" className="underline">
            edit your profile
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

const STATE_TONE: Readonly<Record<string, BadgeTone>> = {
  WAITING: 'neutral',
  LIVE: 'brand',
  JUDGING: 'info',
  TIED: 'warning',
  SUDDEN_DEATH: 'warning',
  WON: 'success',
  LOST: 'danger',
  NOT_STARTED: 'neutral',
};
