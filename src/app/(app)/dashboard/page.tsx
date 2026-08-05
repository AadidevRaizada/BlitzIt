import { requireUser } from '@/server/modules/auth';
import { listMyNotifications } from '@/server/modules/notification';
import {
  competitorScopeFor,
  getLeaderboard,
  getMyTournamentState,
  listPublicTournaments,
} from '@/server/modules/tournament';
import { resolveMissionControl } from '@/server/modules/workspace';
import { MissionControlView } from '@/components/features/mission-control-view';

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
    listMyNotifications(user.id, { take: 4 }),
    mission.tournament
      ? getLeaderboard(mission.tournament.id, { take: 5 })
      : Promise.resolve([]),
  ]);

  return (
    <MissionControlView
      identity={{
        name: user.displayName ?? user.username,
        username: user.username,
        role: user.role,
      }}
      mission={mission}
      stats={{
        entries: states.filter((entry) => entry.state.isRegistered).length,
        bestPlacement:
          states
            .map((entry) => entry.state.placement)
            .filter((value): value is number => typeof value === 'number')
            .sort((a, b) => a - b)[0] ?? null,
        submissions: states.filter(
          (entry) => entry.state.currentRound?.submitted,
        ).length,
      }}
      notifications={notifications.map((notification) => ({
        id: notification.id,
        title: notification.title,
        body: notification.body,
        createdAt: notification.createdAt,
      }))}
      leaderboard={leaderboard}
      userId={user.id}
      serverTime={new Date().toISOString()}
      error={error}
    />
  );
}
