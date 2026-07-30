import { LeaderboardView } from '@/components/features/leaderboard-view';
import { PRODUCTION } from '@/server/modules/tournament';

export const metadata = { title: 'Leaderboard - The Circuit' };
export const dynamic = 'force-dynamic';

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ by?: string }>;
}) {
  const { by } = await searchParams;
  return <LeaderboardView scope={PRODUCTION} basePath="/leaderboard" by={by} />;
}
