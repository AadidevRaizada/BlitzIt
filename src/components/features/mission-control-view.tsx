import Link from 'next/link';
import { ArrowRight, Check, Radio } from 'lucide-react';
import type { LeaderboardEntry } from '@/server/modules/tournament';
import type { MissionControlState } from '@/server/modules/workspace';
import { Countdown } from '@/components/features/countdown';
import { Badge, LiveDot, type BadgeTone } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DisplayHeading } from '@/components/ui/display-heading';
import { EmptyState } from '@/components/ui/empty-state';
import { Eyebrow } from '@/components/ui/eyebrow';
import { EntryPrice, Reward } from '@/components/ui/reward';
import { cn } from '@/lib/utils';

/** One line of the activity feed. Deliberately narrower than a Notification. */
export interface ActivityItem {
  id: string;
  title: string;
  body: string;
  createdAt: Date;
}

export interface MissionControlIdentity {
  name: string;
  username: string;
  role: string;
}

export interface MissionControlStats {
  entries: number;
  bestPlacement: number | null;
  submissions: number;
}

/**
 * Mission Control — the signed-in competitor's home.
 *
 * This is a workspace surface, not a broadcast one: it is operated, not read.
 * So the hierarchy is ruthless — ONE next action at the top with the clock that
 * governs it, then readiness, then the supporting panels. Everything here
 * renders a server-resolved DTO; the components do not re-derive product state.
 *
 * Presentational by construction, so `/preview/dashboard` can render it from
 * fixtures without a database.
 */
export function MissionControlView({
  identity,
  mission,
  stats,
  notifications,
  leaderboard,
  userId,
  serverTime,
  error,
}: {
  identity: MissionControlIdentity;
  mission: MissionControlState;
  stats: MissionControlStats;
  notifications: ActivityItem[];
  leaderboard: LeaderboardEntry[];
  userId: string;
  serverTime: string;
  error?: string;
}) {
  const tournament = mission.tournament;

  return (
    <div className="mx-auto max-w-6xl">
      {error === 'forbidden' ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive mb-5 rounded-md border px-3 py-2 text-sm"
        >
          You do not have access to that area.
        </p>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow tone="primary">Mission control</Eyebrow>
          <DisplayHeading as="h1" size="compact" className="mt-2">
            {greeting(identity.name)}
          </DisplayHeading>
        </div>
        <p className="text-muted-foreground font-mono text-xs">
          @{identity.username} · {identity.role.toLowerCase()}
        </p>
      </div>

      {tournament ? (
        <div className="mt-6 grid gap-5">
          <NextAction mission={mission} serverTime={serverTime} />
          <Readiness checklist={mission.checklist} />

          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
            <TournamentPanel mission={mission} />
            <PersonalStats stats={stats} />
            <LeaderboardSnapshot
              tournamentName={tournament.name}
              entries={leaderboard}
              userId={userId}
            />
            <RecentActivity notifications={notifications} />
          </div>
        </div>
      ) : (
        <Card
          surface="broadcast"
          className="field-backdrop edge-light mt-6 overflow-hidden p-8 text-center"
        >
          <DisplayHeading size="compact" className="text-raked">
            {mission.nextAction.title}
          </DisplayHeading>
          <p className="text-muted-foreground mx-auto mt-3 max-w-md text-sm leading-6">
            {mission.nextAction.body}
          </p>
          <Link
            href={mission.nextAction.href}
            className={cn(
              buttonVariants({ variant: 'broadcast', size: 'md' }),
              'mt-6',
            )}
          >
            {mission.nextAction.label}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Card>
      )}
    </div>
  );
}

/**
 * The one thing to do next, and the clock that governs it.
 *
 * The clock sits beside the action rather than under it, because those two
 * facts are one thought — "do this, before that runs out" — and reading them as
 * one sentence is the entire purpose of this surface.
 */
function NextAction({
  mission,
  serverTime,
}: {
  mission: MissionControlState;
  serverTime: string;
}) {
  const urgent = mission.nextAction.priority === 'blocked';

  return (
    <Card
      surface="broadcast"
      className={cn(
        'field-backdrop edge-light relative overflow-hidden p-0',
        urgent && 'field-backdrop-live edge-light-live border-destructive/40',
      )}
    >
      <div className="relative grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_16rem] lg:items-center lg:gap-10 lg:p-7">
        <div className="min-w-0">
          <Badge tone={ACTION_TONE[mission.nextAction.priority] ?? 'neutral'}>
            {mission.nextAction.kind.replace(/_/g, ' ').toLowerCase()}
          </Badge>
          <DisplayHeading size="compact" className="mt-3">
            {mission.nextAction.title}
          </DisplayHeading>
          <p className="text-muted-foreground mt-2.5 max-w-xl text-sm leading-6">
            {mission.nextAction.body}
          </p>
        </div>

        <div className="lg:border-hairline lg:border-l lg:pl-10">
          <Eyebrow tone={urgent ? 'live' : 'muted'}>
            {mission.countdown.label}
          </Eyebrow>
          <Countdown
            targetAt={mission.countdown.targetAt?.toISOString() ?? null}
            serverTime={serverTime}
            size="md"
            className="mt-1.5"
          />
          <Link
            href={mission.nextAction.href}
            className={cn(
              buttonVariants({
                variant: urgent ? 'danger' : 'broadcast',
                size: 'md',
              }),
              'mt-5 w-full',
              '[&_svg]:transition-transform [&_svg]:duration-[var(--motion-base)]',
              'hover:[&_svg]:translate-x-1',
            )}
          >
            {mission.nextAction.label}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>
    </Card>
  );
}

/**
 * Readiness, as a count and a bar before it is a list of chips.
 *
 * "3 / 4 ready" answers the question the chips only imply. The bar is the same
 * meter used for a tournament field, so "how full is this" reads identically
 * everywhere in the product.
 */
function Readiness({
  checklist,
}: {
  checklist: MissionControlState['checklist'];
}) {
  if (checklist.length === 0) return null;

  const done = checklist.filter((item) => item.complete).length;
  const pct = Math.round((done / checklist.length) * 100);
  const ready = done === checklist.length;

  return (
    <div className="border-hairline bg-surface-raised rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4">
        <span className="text-eyebrow text-muted-foreground font-mono font-semibold uppercase">
          Readiness
        </span>
        <span
          className={cn(
            'font-mono text-sm font-bold tabular-nums',
            ready ? 'text-success' : 'text-foreground',
          )}
        >
          {done}/{checklist.length}
        </span>
      </div>

      <div className="bg-surface-elevated mt-2.5 h-1 overflow-hidden rounded-full">
        <div
          className={cn(
            'h-full origin-left rounded-full',
            'animate-[var(--animate-meter-in)]',
            ready ? 'bg-success' : 'bg-primary',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="mt-4 flex flex-wrap gap-2">
        {checklist.map((item) => (
          <li
            key={item.key}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
              item.complete
                ? 'text-muted-foreground'
                : 'bg-primary/10 text-foreground ring-primary/20 ring-1 ring-inset',
            )}
          >
            <span
              className={cn(
                'flex size-3.5 shrink-0 items-center justify-center rounded-full',
                item.complete
                  ? 'bg-success/20 text-success'
                  : 'border-muted-foreground/40 border',
              )}
              aria-hidden
            >
              {item.complete ? <Check className="size-2.5" /> : null}
            </span>
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The four numbers that describe this competitor's position right now. */
function TournamentPanel({ mission }: { mission: MissionControlState }) {
  const tournament = mission.tournament;
  if (!tournament) return null;

  const state = mission.competitor;
  const live =
    tournament.status === 'SIMULATION' || tournament.status === 'LIVE';
  const eliminated = Boolean(state?.eliminatedAtStage);
  const paid = state?.payment?.status === 'PAID';

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-eyebrow text-muted-foreground font-mono font-semibold uppercase">
          Your tournament
        </span>
        {live ? (
          <span className="text-destructive inline-flex items-center gap-1.5 font-mono text-xs font-semibold uppercase">
            <LiveDot />
            live
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Radio
          className={cn(
            'size-4 shrink-0',
            live ? 'text-destructive' : 'text-muted-foreground',
          )}
          aria-hidden
        />
        <DisplayHeading size="panel" className="truncate">
          {tournament.name}
        </DisplayHeading>
      </div>
      <p className="text-muted-foreground mt-1 font-mono text-xs">
        {formatState(tournament.status)}
      </p>

      <dl className="border-hairline mt-5 grid grid-cols-2 gap-x-6 gap-y-5 border-t pt-5 sm:grid-cols-3">
        <Metric
          label="Standing"
          value={
            state?.placement
              ? `#${state.placement}`
              : state?.seed
                ? `seed ${state.seed}`
                : '—'
          }
          tone={eliminated ? 'live' : state?.qualified ? 'success' : 'default'}
          hint={
            eliminated
              ? `out · ${formatState(state?.eliminatedAtStage ?? '')}`
              : state?.qualified
                ? 'qualified'
                : 'not seeded'
          }
        />
        <Metric
          label="Prize pool"
          value={
            <Reward
              amountMinor={tournament.prizePool.prizePoolMinor}
              currency={tournament.currency}
            />
          }
          hint={`${tournament.prizePool.paidEntries} eligible`}
        />
        <Metric
          label="Entry"
          value={state?.payment?.status.toLowerCase() ?? 'free'}
          tone={paid ? 'success' : 'default'}
          hint={
            state?.payment ? (
              <EntryPrice
                amountMinor={state.payment.amountMinor}
                currency={tournament.currency}
              />
            ) : (
              'no order'
            )
          }
        />
      </dl>
    </Card>
  );
}

function Metric({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'live' | 'success';
}) {
  return (
    <div className="min-w-0">
      <dt className="text-eyebrow text-muted-foreground font-mono font-semibold uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1.5 truncate font-mono text-lg font-bold tabular-nums',
          tone === 'live' && 'text-destructive',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </dd>
      {hint ? (
        <p className="text-muted-foreground mt-0.5 truncate text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

function PersonalStats({ stats }: { stats: MissionControlStats }) {
  const items: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Entries', value: stats.entries || '—' },
    {
      label: 'Best finish',
      value: stats.bestPlacement ? `#${stats.bestPlacement}` : '—',
    },
    { label: 'Submissions', value: stats.submissions || '—' },
  ];

  return (
    <Card className="p-5">
      <span className="text-eyebrow text-muted-foreground font-mono font-semibold uppercase">
        Your record
      </span>
      <dl className="mt-4 grid gap-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-baseline justify-between gap-3"
          >
            <dt className="text-muted-foreground text-sm">{item.label}</dt>
            <dd className="font-mono text-lg font-bold tabular-nums">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function LeaderboardSnapshot({
  tournamentName,
  entries,
  userId,
}: {
  tournamentName: string;
  entries: LeaderboardEntry[];
  userId: string;
}) {
  const lead = entries[0]?.simulationScore ?? 0;

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-eyebrow text-muted-foreground font-mono font-semibold uppercase">
          Standings
        </span>
        <Link
          href="/leaderboard"
          className="text-primary focus-visible:ring-ring rounded-md text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Full leaderboard
        </Link>
      </div>

      {entries.length > 0 ? (
        <ol className="mt-4 grid">
          {entries.map((entry, index) => {
            const mine = entry.userId === userId;
            const share =
              lead > 0
                ? Math.max(
                    4,
                    Math.min(100, (entry.simulationScore / lead) * 100),
                  )
                : 0;

            return (
              <li
                key={entry.userId}
                className={cn(
                  'border-border/60 grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 border-b py-2.5 last:border-0',
                  mine && 'text-primary',
                )}
              >
                <span
                  className={cn(
                    'font-mono text-sm font-bold tabular-nums',
                    !mine && index < 3
                      ? 'text-primary'
                      : !mine
                        ? 'text-muted-foreground'
                        : '',
                  )}
                >
                  {String(entry.placement ?? index + 1).padStart(2, '0')}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {entry.displayName ?? entry.username}
                    {mine ? (
                      <span className="text-primary ml-1.5 font-mono text-xs">
                        you
                      </span>
                    ) : null}
                  </span>
                  <span
                    aria-hidden
                    className="bg-surface-elevated mt-1.5 block h-0.5 w-full overflow-hidden rounded-full"
                  >
                    <span
                      className={cn(
                        'block h-full origin-left rounded-full',
                        'animate-[var(--animate-meter-in)]',
                        mine ? 'bg-primary' : 'bg-primary/40',
                      )}
                      style={{ width: `${share}%` }}
                    />
                  </span>
                </span>
                <span className="font-mono text-sm font-bold tabular-nums">
                  {entry.simulationScore.toFixed(1)}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <EmptyState
          title="No standings yet"
          description={`${tournamentName} has not produced rankings.`}
        />
      )}
    </Card>
  );
}

function RecentActivity({ notifications }: { notifications: ActivityItem[] }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-eyebrow text-muted-foreground font-mono font-semibold uppercase">
          Recent activity
        </span>
        <Link
          href="/notifications"
          className="text-primary focus-visible:ring-ring rounded-md text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          All
        </Link>
      </div>

      {notifications.length > 0 ? (
        <ol className="mt-4 grid">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className="border-border/60 relative border-b py-3 pl-4 last:border-0"
            >
              <span
                aria-hidden
                className="bg-primary/40 absolute top-4.5 left-0 size-1.5 rounded-full"
              />
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">{notification.title}</p>
                <span className="text-muted-foreground shrink-0 font-mono text-[0.6875rem] tabular-nums">
                  {formatDay(notification.createdAt)}
                </span>
              </div>
              <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                {notification.body}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState title="Nothing new" />
      )}
    </Card>
  );
}

const ACTION_TONE: Readonly<Record<string, BadgeTone>> = {
  blocked: 'warning',
  primary: 'brand',
  waiting: 'info',
  done: 'success',
};

function greeting(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first ? `Welcome back, ${first}` : 'Welcome back';
}

function formatState(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase();
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date);
}
