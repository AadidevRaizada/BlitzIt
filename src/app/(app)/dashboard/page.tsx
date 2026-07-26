import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { requireUser } from '@/server/modules/auth';
import {
  getMyTournamentState,
  listPublicTournaments,
  type MyTournamentState,
  type PublicTournamentCard,
} from '@/server/modules/tournament';
import { Countdown } from '@/components/features/countdown';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
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
  const serverTime = new Date().toISOString();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
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

      {companion ? (
        <Companion
          tournament={companion.tournament}
          state={companion.state}
          serverTime={serverTime}
        />
      ) : (
        <Card className="p-6">
          <h2 className="text-lg font-semibold">
            No public tournament scheduled
          </h2>
          <p className="text-muted-foreground mt-2 text-sm">
            When a public tournament is published, this dashboard will show the
            next action.
          </p>
        </Card>
      )}
    </div>
  );
}

function Companion({
  tournament,
  state,
  serverTime,
}: {
  tournament: PublicTournamentCard;
  state: MyTournamentState | null;
  serverTime: string;
}) {
  const action = primaryAction(tournament, state);
  const countdown = companionCountdown(tournament, state);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Badge tone={state?.isRegistered ? 'success' : 'info'}>
              {state?.isRegistered
                ? 'Registered'
                : formatStage(tournament.status)}
            </Badge>
            <h2 className="mt-3 text-2xl font-bold">{action.title}</h2>
            <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-6">
              {action.body}
            </p>
          </div>
          <Link
            href={action.href}
            className={cn(buttonVariants({ variant: 'primary', size: 'lg' }))}
          >
            {action.label}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>

        <div className="border-border mt-6 border-t pt-5">
          <p className="text-muted-foreground text-xs tracking-wide uppercase">
            {countdown.label}
          </p>
          <Countdown
            targetAt={countdown.targetAt?.toISOString() ?? null}
            serverTime={serverTime}
            className="mt-1"
          />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold">Readiness</h2>
        {state ? (
          <ul className="mt-4 grid gap-2 text-sm">
            <Ready ok={state.readiness.githubConnected}>GitHub connected</Ready>
            <Ready ok={state.readiness.avatarSet}>Avatar set</Ready>
            <Ready ok={state.readiness.profileLocationSet}>
              Display name and city set
            </Ready>
            <Ready ok={state.readiness.registered}>Registered</Ready>
          </ul>
        ) : (
          <p className="text-muted-foreground mt-3 text-sm">
            Register for a tournament to unlock the readiness checklist.
          </p>
        )}
      </Card>
    </div>
  );
}

function primaryAction(
  tournament: PublicTournamentCard,
  state: MyTournamentState | null,
): { title: string; body: string; label: string; href: string } {
  if (!state?.isRegistered) {
    return {
      title: 'Next tournament',
      body:
        tournament.status === 'REGISTRATION_OPEN'
          ? 'Registration is open. Join from the tournament page.'
          : 'This tournament is announced. Registration opens on the public schedule.',
      label:
        tournament.status === 'REGISTRATION_OPEN'
          ? 'Register'
          : 'View tournament',
      href: `/tournaments/${tournament.slug}`,
    };
  }

  if (state.placement) {
    return {
      title: `Finished #${state.placement}`,
      body: 'Your placement is recorded in the tournament results.',
      label: 'View results',
      href: `/tournaments/${tournament.slug}`,
    };
  }

  if (state.eliminatedAtStage) {
    return {
      title: `Eliminated in ${formatStage(state.eliminatedAtStage)}`,
      body: 'Your run has ended. Results update as the bracket completes.',
      label: 'View results',
      href: `/tournaments/${tournament.slug}`,
    };
  }

  if (state.currentMatch) {
    if (state.currentMatch.status === 'JUDGING') {
      return {
        title: 'Judging',
        body: 'Your match is closed and evaluation is in progress.',
        label: 'Open arena',
        href: `/arena/knockout/${state.currentMatch.id}`,
      };
    }
    return {
      title: 'Round open',
      body: state.currentMatch.opponentUsername
        ? `Your opponent is ${state.currentMatch.opponentUsername}.`
        : 'Your bracket match is ready.',
      label: 'Join arena',
      href: `/arena/knockout/${state.currentMatch.id}`,
    };
  }

  if (state.currentRound?.status === 'OPEN') {
    if (state.currentRound.submitted) {
      return {
        title: 'Submitted, judging next',
        body: `Your ${formatStage(state.currentRound.stage)} entry is in.`,
        label: state.currentRound.submissionId
          ? 'View submission'
          : 'Dashboard',
        href: state.currentRound.submissionId
          ? `/submissions/${state.currentRound.submissionId}`
          : '/dashboard',
      };
    }
    return {
      title: `${formatStage(state.currentRound.stage)} is live`,
      body: 'The qualifier window is open. Enter the round and submit before the deadline.',
      label: 'Enter round',
      href: `/submit/${state.currentRound.id}`,
    };
  }

  if (state.currentRound?.status === 'JUDGING') {
    return {
      title: 'Judging',
      body: state.currentRound.submissionStatus
        ? `Your submission is ${formatStage(state.currentRound.submissionStatus)}.`
        : 'The qualifier window closed and evaluation is in progress.',
      label: 'View submissions',
      href: '/submissions',
    };
  }

  if (state.qualified) {
    return {
      title: 'Qualified',
      body: state.seed
        ? `You are seed #${state.seed}. The knockout bracket starts next.`
        : 'You advanced to the knockout bracket.',
      label: 'Open dashboard',
      href: '/dashboard',
    };
  }

  return {
    title: 'Registered',
    body: 'Registration is confirmed. Watch the countdown and complete your readiness checklist.',
    label: 'View tournament',
    href: `/tournaments/${tournament.slug}`,
  };
}

function companionCountdown(
  tournament: PublicTournamentCard,
  state: MyTournamentState | null,
): { label: string; targetAt: Date | null } {
  if (state?.currentMatch) {
    return {
      label:
        state.currentMatch.roundStatus === 'OPEN'
          ? 'Time remaining'
          : 'Round opens',
      targetAt:
        state.currentMatch.roundStatus === 'OPEN'
          ? state.currentMatch.deadlineAt
          : state.currentMatch.opensAt,
    };
  }
  if (state?.currentRound) {
    return {
      label:
        state.currentRound.status === 'OPEN' ? 'Time remaining' : 'Round opens',
      targetAt:
        state.currentRound.status === 'OPEN'
          ? state.currentRound.deadlineAt
          : state.currentRound.opensAt,
    };
  }
  if (tournament.status === 'REGISTRATION_OPEN') {
    return {
      label: 'Registration closes',
      targetAt: tournament.registrationClosesAt,
    };
  }
  return {
    label: 'Registration opens',
    targetAt: tournament.registrationOpensAt,
  };
}

function Ready({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{children}</span>
      <span className="inline-flex items-center gap-1">
        {ok ? (
          <CheckCircle2 className="text-success size-4" aria-hidden />
        ) : null}
        <Badge tone={ok ? 'success' : 'neutral'}>{ok ? 'Done' : 'Open'}</Badge>
      </span>
    </li>
  );
}

function formatStage(value: string): string {
  return value.replace(/_/g, ' ');
}
