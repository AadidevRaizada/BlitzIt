import Link from 'next/link';
import { ArrowRight, CheckCircle2, Circle } from 'lucide-react';
import { requireUser } from '@/server/modules/auth';
import { listMyNotifications } from '@/server/modules/notification';
import {
  competitorScopeFor,
  getLeaderboard,
  getMyTournamentState,
  listPublicTournaments,
  type LeaderboardEntry,
  type MyTournamentState,
  type PublicTournamentCard,
} from '@/server/modules/tournament';
import { resolveMissionControl } from '@/server/modules/workspace';
import { Countdown } from '@/components/features/countdown';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, StatCard } from '@/components/ui/card';
import { PageHeader, SectionTitle } from '@/components/ui/page-header';
import { DisplayHeading } from '@/components/ui/display-heading';
import { EmptyState } from '@/components/ui/empty-state';
import { Eyebrow } from '@/components/ui/eyebrow';
import { EntryPrice, Reward } from '@/components/ui/reward';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Mission Control - The Circuit' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await requireUser('/dashboard');
  // Mission Control offers what this competitor may enter. For a tester that is
  // the test environment — scoping it to production would hand them an empty
  // dashboard and no way to register, which is the whole experience they exist
  // to exercise. Everyone else, including admins, gets production.
  const grouped = await listPublicTournaments(competitorScopeFor(user));
  const tournaments = [
    ...grouped.LIVE_NOW,
    ...grouped.REGISTERING,
    ...grouped.COMING_SOON,
    ...grouped.PAST,
  ];
  const states = await Promise.all(
    tournaments.map(async (tournament) => ({
      tournament,
      state: await getMyTournamentState(user.id, tournament.id),
    })),
  );
  const active =
    states.find(
      (entry) =>
        entry.state.isRegistered && entry.tournament.status !== 'COMPLETED',
    ) ??
    states.find((entry) => entry.state.isRegistered) ??
    null;
  const nextTournament =
    grouped.REGISTERING[0] ??
    grouped.COMING_SOON[0] ??
    grouped.LIVE_NOW[0] ??
    null;
  const companion =
    active ??
    (nextTournament ? { tournament: nextTournament, state: null } : null);
  const mission = resolveMissionControl({
    isSignedIn: true,
    isOnboardingComplete: user.onboardingCompletedAt !== null,
    tournament: companion?.tournament ?? null,
    competitor: companion?.state ?? null,
  });
  const [notifications, leaderboard] = await Promise.all([
    listMyNotifications(user.id, { take: 3 }),
    mission.tournament
      ? getLeaderboard(mission.tournament.id, { take: 5 })
      : Promise.resolve([]),
  ]);
  const serverTime = new Date().toISOString();

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {error === 'forbidden' ? (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          You do not have access to that area.
        </p>
      ) : null}

      <PageHeader
        title="Mission Control"
        description={
          <>
            {user.displayName ?? user.username} / {user.email} / role{' '}
            {user.role.toLowerCase()}
          </>
        }
      />

      {mission.tournament ? (
        <div className="space-y-5">
          <NextActionCard mission={mission} serverTime={serverTime} />
          <ReadinessStrip checklist={mission.checklist} />

          <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
            <CurrentTournamentCard
              tournament={mission.tournament}
              state={mission.competitor}
            />
            <PersonalStats states={states} />
            <RecentActivity notifications={notifications} />
            <LeaderboardSnapshot
              tournament={mission.tournament}
              entries={leaderboard}
              userId={user.id}
            />
          </div>
        </div>
      ) : (
        <EmptyState
          title={mission.nextAction.title}
          hint={mission.nextAction.body}
          action={
            <Link
              href={mission.nextAction.href}
              className={cn(buttonVariants({ variant: 'primary' }))}
            >
              {mission.nextAction.label}
            </Link>
          }
        />
      )}
    </div>
  );
}

function NextActionCard({
  mission,
  serverTime,
}: {
  mission: ReturnType<typeof resolveMissionControl>;
  serverTime: string;
}) {
  return (
    <Card surface="broadcast" className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <Badge tone={ACTION_TONE[mission.nextAction.priority]}>
            {mission.nextAction.kind.replace(/_/g, ' ').toLowerCase()}
          </Badge>
          <DisplayHeading size="compact" className="mt-3">
            {mission.nextAction.title}
          </DisplayHeading>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            {mission.nextAction.body}
          </p>
        </div>
        <Link
          href={mission.nextAction.href}
          className={cn(buttonVariants({ variant: 'primary', size: 'lg' }))}
        >
          {mission.nextAction.label}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </div>

      <div className="border-hairline mt-6 border-t pt-5">
        <Eyebrow>{mission.countdown.label}</Eyebrow>
        <Countdown
          targetAt={mission.countdown.targetAt?.toISOString() ?? null}
          serverTime={serverTime}
          className="mt-1.5"
        />
      </div>
    </Card>
  );
}

function ReadinessStrip({
  checklist,
}: {
  checklist: ReturnType<typeof resolveMissionControl>['checklist'];
}) {
  if (checklist.length === 0) return null;

  return (
    <div className="border-hairline bg-surface-raised flex flex-wrap gap-2 border p-3">
      {checklist.map((item) => (
        <span
          key={item.key}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs',
            item.complete
              ? 'text-muted-foreground'
              : 'bg-primary/10 text-foreground',
          )}
        >
          {item.complete ? (
            <CheckCircle2 className="text-success size-3.5" aria-hidden />
          ) : (
            <Circle className="text-muted-foreground size-3.5" aria-hidden />
          )}
          {item.label}
        </span>
      ))}
    </div>
  );
}

function CurrentTournamentCard({
  tournament,
  state,
}: {
  tournament: PublicTournamentCard;
  state: MyTournamentState | null;
}) {
  const live =
    tournament.status === 'SIMULATION' || tournament.status === 'LIVE';
  const eliminated = Boolean(state?.eliminatedAtStage);
  const paid = state?.payment?.status === 'PAID';

  return (
    <div className="border-border bg-hairline grid gap-px overflow-hidden rounded-lg border sm:grid-cols-2 lg:col-span-2 lg:grid-cols-4">
      <StatCard
        label="Current tournament"
        value={tournament.name}
        hint={formatState(tournament.status)}
        tone={live ? 'live' : 'default'}
        className="rounded-none border-0"
      />
      <StatCard
        label="Prize pool"
        value={
          <Reward
            amountMinor={tournament.prizePool.prizePoolMinor}
            currency={tournament.currency}
          />
        }
        hint={`${tournament.prizePool.paidEntries} eligible entries`}
        className="rounded-none border-0"
      />
      <StatCard
        label="Standing"
        value={
          state?.placement
            ? `#${state.placement}`
            : state?.seed
              ? `seed #${state.seed}`
              : 'pending'
        }
        tone={eliminated ? 'live' : state?.qualified ? 'success' : 'default'}
        hint={
          eliminated
            ? `out / ${formatState(state?.eliminatedAtStage ?? '')}`
            : state?.qualified
              ? 'qualified'
              : 'not seeded'
        }
        className="rounded-none border-0"
      />
      <StatCard
        label="Payment"
        value={state?.payment?.status.toLowerCase() ?? 'free'}
        tone={paid ? 'success' : 'default'}
        hint={
          state?.payment ? (
            <EntryPrice
              amountMinor={state.payment.amountMinor}
              currency={tournament.currency}
            />
          ) : (
            'no paid order'
          )
        }
        className="rounded-none border-0"
      />
    </div>
  );
}

function RecentActivity({
  notifications,
}: {
  notifications: Awaited<ReturnType<typeof listMyNotifications>>;
}) {
  return (
    <Card className="p-5">
      <SectionTitle>Recent Activity</SectionTitle>
      {notifications.length > 0 ? (
        <ul className="mt-4 divide-y text-sm">
          {notifications.map((notification) => (
            <li key={notification.id} className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">{notification.title}</p>
              <p className="text-muted-foreground mt-1 line-clamp-2">
                {notification.body}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No recent activity" />
      )}
    </Card>
  );
}

function PersonalStats({
  states,
}: {
  states: Array<{ tournament: PublicTournamentCard; state: MyTournamentState }>;
}) {
  const registered = states.filter((entry) => entry.state.isRegistered).length;
  const bestPlacement = states
    .map((entry) => entry.state.placement)
    .filter((value): value is number => typeof value === 'number')
    .sort((a, b) => a - b)[0];
  const submissions = states.filter(
    (entry) => entry.state.currentRound?.submitted,
  ).length;

  return (
    <Card className="p-5">
      <SectionTitle>Personal Stats</SectionTitle>
      <dl className="mt-4 grid gap-3 text-sm">
        <StatRow label="Entries" value={registered > 0 ? registered : '-'} />
        <StatRow
          label="Best finish"
          value={bestPlacement ? `#${bestPlacement}` : '-'}
        />
        <StatRow label="Current submissions" value={submissions || '-'} />
      </dl>
    </Card>
  );
}

function LeaderboardSnapshot({
  tournament,
  entries,
  userId,
}: {
  tournament: PublicTournamentCard;
  entries: LeaderboardEntry[];
  userId: string;
}) {
  return (
    <Card className="p-5 lg:col-span-2">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle>Leaderboard Snapshot</SectionTitle>
        <Link
          href="/leaderboard"
          className="text-primary rounded-md text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Full leaderboard
        </Link>
      </div>
      {entries.length > 0 ? (
        <ol className="mt-4 divide-y text-sm">
          {entries.map((entry, index) => (
            <li
              key={entry.userId}
              className={cn(
                'grid grid-cols-[3rem_1fr_auto] items-center gap-3 py-3',
                entry.userId === userId && 'text-primary',
              )}
            >
              <span className="text-muted-foreground tabular-nums">
                #{index + 1}
              </span>
              <span className="font-medium">
                {entry.displayName ?? entry.username}
              </span>
              <span className="tabular-nums">
                {entry.simulationScore.toFixed(1)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title="No standings yet"
          description={`${tournament.name} has not produced rankings.`}
        />
      )}
    </Card>
  );
}

function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

const ACTION_TONE: Readonly<Record<string, BadgeTone>> = {
  blocked: 'warning',
  primary: 'brand',
  waiting: 'info',
  done: 'success',
};

function formatState(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase();
}
