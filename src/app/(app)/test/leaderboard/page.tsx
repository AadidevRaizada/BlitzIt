import { LeaderboardView } from '@/components/features/leaderboard-view';
import { TEST } from '@/server/modules/tournament';

export const metadata = { title: 'Test Leaderboard - The Circuit' };
export const dynamic = 'force-dynamic';

/** The SAME component `/leaderboard` renders, scoped to the test environment. */
export default async function TestLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string }>;
}) {
  const { by } = await searchParams;
  return <LeaderboardView scope={TEST} basePath="/test/leaderboard" by={by} />;
}
