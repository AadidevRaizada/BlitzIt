import { getCurrentUser } from '@/server/modules/auth';
import { listHallOfFame } from '@/server/modules/hall-of-fame';
import {
  getSpectatorSnapshot,
  PRODUCTION,
  listMyLiveMatches,
} from '@/server/modules/tournament';
import { HomeView } from '@/components/features/home-view';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const [snapshot, hallOfFame, user] = await Promise.all([
    getSpectatorSnapshot(PRODUCTION, { leaderboardTake: 10 }),
    listHallOfFame(PRODUCTION, { take: 1 }),
    getCurrentUser(),
  ]);

  const liveMatches = user
    ? (await listMyLiveMatches(user.id)).filter(
        (match) => match.matchStatus !== 'DECIDED',
      )
    : [];

  return (
    <HomeView
      snapshot={snapshot}
      champion={hallOfFame[0] ?? null}
      liveMatch={liveMatches[0] ?? null}
      userId={user?.id ?? null}
      isSignedIn={user !== null}
    />
  );
}
