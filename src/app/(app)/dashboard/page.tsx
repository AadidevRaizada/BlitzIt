import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  Circle,
  ClipboardList,
  FileText,
  Gauge,
  History,
  Swords,
  Trophy,
  UserRound,
} from 'lucide-react';
import { requireUser } from '@/server/modules/auth';
import {
  getMyTournamentState,
  listPublicTournaments,
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

export const metadata = { title: 'Dashboard - The Circuit' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await requireUser('/dashboard');
  const grouped = await listPublicTournaments();
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
    tournament: companion?.tournament ?? null,
    competitor: companion?.state ?? null,
  });
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
        title="Mission control"
        description={
          <>
            {user.displayName ?? user.username} / {user.email} / role{' '}
            {user.role.toLowerCase()}
          </>
        }
      />

      {mission.tournament ? (
        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
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
                className={cn(
                  buttonVariants({ variant: 'primary', size: 'lg' }),
                )}
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

          <ReadinessCard checklist={mission.checklist} />

          <OverviewGrid
            tournament={mission.tournament}
            state={mission.competitor}
          />

          <WorkspaceSections sections={mission.sections} />
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

/**
 * The readiness checklist — kept as a mechanic, refined visually.
 *
 * The change that matters is the progress summary at the top: the old version
 * was a flat list of pills, so "how close am I to being able to compete?"
 * needed counting. Now the answer is one line and one bar, and the remaining
 * open items are the only rows carrying any colour.
 */
function ReadinessCard({
  checklist,
}: {
  checklist: ReturnType<typeof resolveMissionControl>['checklist'];
}) {
  const done = checklist.filter((item) => item.complete).length;
  const total = checklist.length;
  const ready = total > 0 && done === total;

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <SectionTitle>Readiness</SectionTitle>
        {total > 0 ? (
          <span
            className={cn(
              'font-display text-sm font-bold tabular-nums',
              ready ? 'text-success' : 'text-muted-foreground',
            )}
          >
            {done}/{total}
          </span>
        ) : null}
      </div>

      {total > 0 ? (
        <>
          <div
            className="bg-muted mt-3 h-1 overflow-hidden rounded-full"
            role="progressbar"
            aria-valuenow={done}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label="Readiness checklist progress"
          >
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-[var(--motion-slow)] ease-[var(--ease-out-expo)]',
                ready ? 'bg-success' : 'bg-primary',
              )}
              style={{ width: `${Math.round((done / total) * 100)}%` }}
            />
          </div>

          <ul className="mt-4 grid gap-1 text-sm">
            {checklist.map((item) => (
              <li
                key={item.key}
                className={cn(
                  'flex items-center justify-between gap-3 rounded-md px-2 py-1.5',
                  'transition-colors duration-[var(--motion-fast)]',
                  // Only the outstanding items get a lift; completed rows
                  // recede so the eye lands on what is left to do.
                  item.complete ? 'text-muted-foreground' : 'bg-primary/5',
                )}
              >
                <span className="inline-flex items-center gap-1.5">
                  {item.complete ? (
                    <CheckCircle2
                      className="text-success size-4 shrink-0"
                      aria-hidden
                    />
                  ) : (
                    <Circle
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden
                    />
                  )}
                  {item.label}
                </span>
                <Badge tone={item.complete ? 'success' : 'active'}>
                  {item.complete ? 'Done' : 'Open'}
                </Badge>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <EmptyState
          title="Checklist locked"
          description="Register for a tournament to unlock the readiness checklist."
        />
      )}
    </Card>
  );
}

function OverviewGrid({
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
    // A single bordered board rather than four floating boxes: one outer
    // border, hairline dividers between cells. The four numbers belong to the
    // same story, so they should look like one instrument panel.
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

function WorkspaceSections({
  sections,
}: {
  sections: ReturnType<typeof resolveMissionControl>['sections'];
}) {
  const rows = [
    {
      key: 'overview',
      label: 'Overview',
      icon: Gauge,
      body: sections.overview,
    },
    {
      key: 'currentTournament',
      label: 'Current Tournament',
      icon: Trophy,
      body: sections.currentTournament,
    },
    {
      key: 'submission',
      label: 'Submission',
      icon: ClipboardList,
      body: sections.submission,
    },
    {
      key: 'evaluation',
      label: 'Evaluation',
      icon: FileText,
      body: sections.evaluation,
    },
    { key: 'bracket', label: 'Bracket', icon: Swords, body: sections.bracket },
    { key: 'results', label: 'Results', icon: Trophy, body: sections.results },
    { key: 'history', label: 'History', icon: History, body: sections.history },
    {
      key: 'notifications',
      label: 'Notifications',
      icon: Bell,
      body: sections.notifications,
    },
    {
      key: 'settings',
      label: 'Settings',
      icon: UserRound,
      body: sections.settings,
    },
    {
      key: 'profile',
      label: 'Profile',
      icon: UserRound,
      body: sections.profile,
    },
  ];

  return (
    <Card className="p-5 lg:col-span-2">
      <SectionTitle>Workspace sections</SectionTitle>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div
              key={row.key}
              className="border-border bg-muted/20 rounded-md border p-3"
            >
              <div className="flex items-center gap-2">
                <Icon className="text-primary size-4" aria-hidden />
                <h3 className="font-medium">{row.label}</h3>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">{row.body}</p>
            </div>
          );
        })}
      </div>
    </Card>
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
