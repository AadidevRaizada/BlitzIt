import Link from 'next/link';
import {
  ArrowRight,
  Bell,
  CheckCircle2,
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
import { formatMinor } from '@/server/modules/notification';
import { Countdown } from '@/components/features/countdown';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card, StatCard } from '@/components/ui/card';
import { PageHeader, SectionTitle } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/table';
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
                <h2 className="mt-3 text-2xl font-extrabold tracking-tight sm:text-3xl">
                  {mission.nextAction.title}
                </h2>
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
              <p className="text-muted-foreground font-pixel text-xs tracking-wide uppercase">
                {mission.countdown.label}
              </p>
              <Countdown
                targetAt={mission.countdown.targetAt?.toISOString() ?? null}
                serverTime={serverTime}
                className="mt-1"
              />
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle>Readiness</SectionTitle>
            {mission.checklist.length > 0 ? (
              <ul className="mt-4 grid gap-2 text-sm">
                {mission.checklist.map((item) => (
                  <li
                    key={item.key}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{item.label}</span>
                    <span className="inline-flex items-center gap-1">
                      {item.complete ? (
                        <CheckCircle2
                          className="text-success size-4"
                          aria-hidden
                        />
                      ) : null}
                      <Badge tone={item.complete ? 'success' : 'neutral'}>
                        {item.complete ? 'Done' : 'Open'}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground mt-3 text-sm">
                Register for a tournament to unlock the readiness checklist.
              </p>
            )}
          </Card>

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

function OverviewGrid({
  tournament,
  state,
}: {
  tournament: PublicTournamentCard;
  state: MyTournamentState | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:col-span-2 lg:grid-cols-4">
      <StatCard
        label="Current tournament"
        value={tournament.name}
        hint={formatState(tournament.status)}
      />
      <StatCard
        label="Prize pool"
        value={formatMinor(tournament.prizePool.prizePoolMinor)}
        hint={`${tournament.prizePool.paidEntries} eligible entries`}
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
        hint={
          state?.eliminatedAtStage
            ? `out / ${formatState(state.eliminatedAtStage)}`
            : state?.qualified
              ? 'qualified'
              : 'not seeded'
        }
      />
      <StatCard
        label="Payment"
        value={state?.payment?.status.toLowerCase() ?? 'free'}
        hint={
          state?.payment
            ? formatMinor(state.payment.amountMinor)
            : 'no paid order'
        }
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
