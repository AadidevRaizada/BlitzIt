import type { LiveSnapshot } from '@/server/modules/tournament';
import { ProductShell } from '@/components/features/product-shell';
import { HomeView } from '@/components/features/home-view';
import {
  PREVIEW_ME,
  PREVIEW_USER,
  hallOfFameFixture,
  leaderboardFixture,
} from '@/app/preview/_fixtures';

/**
 * Design preview of `/`. See `/preview/tournaments` for why these routes exist.
 *
 * `?state=standby` is the front page with nothing on the calendar — the state a
 * stranger is most likely to land on, and the hardest one to make read as a
 * product that is alive.
 */
export const metadata = {
  title: 'Preview - Home',
  robots: { index: false, follow: false },
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function snapshot(now: number): LiveSnapshot {
  const prizePoolMinor = 4500000;
  const deadlineAt = new Date(now + 11 * MINUTE).toISOString();

  return {
    tournamentId: 'live-1',
    slug: 'circuit-weekly-32',
    name: 'Circuit Weekly #32',
    status: 'LIVE',
    currentStage: 'QF',
    participantCount: 32,
    prizePoolMinor,
    prizePool: {
      tournamentId: 'live-1',
      currency: 'INR',
      paidEntries: 32,
      entryContributionMinor: 316800,
      basePrizePoolMinor: prizePoolMinor,
      sponsorContributionMinor: 0,
      bonusContributionMinor: 0,
      guaranteedFloorMinor: prizePoolMinor,
      computedPrizePoolMinor: prizePoolMinor,
      prizePoolMinor,
      firstPrizeCapMinor: prizePoolMinor,
      prizeDistribution: null,
      allocations: [],
    },
    currency: 'INR',
    youtubeStreamUrl: null,
    registrationOpensAt: new Date(now - 96 * HOUR).toISOString(),
    registrationClosesAt: new Date(now - 26 * HOUR).toISOString(),
    simulationOpensAt: new Date(now - 24 * HOUR).toISOString(),
    simulationClosesAt: new Date(now - 20 * HOUR).toISOString(),
    liveStartsAt: new Date(now - 40 * MINUTE).toISOString(),
    countdown: {
      phase: 'OPEN',
      secondsRemaining: 11 * 60,
      targetAt: deadlineAt,
      label: 'DEADLINE',
      of: 'ROUND',
    },
    currentRound: {
      id: 'round-qf',
      stage: 'QF',
      status: 'OPEN',
      opensAt: new Date(now - 4 * MINUTE).toISOString(),
      deadlineAt,
      revealed: true,
      problemTitle: 'Receipt parser with a confidence score',
      matchesTotal: 4,
      matchesDecided: 1,
    },
    leaderboard: leaderboardFixture().slice(0, 8),
    bracket: [],
    tiedMatches: 0,
    version: 'preview',
    serverTime: new Date(now).toISOString(),
  };
}

export default async function HomePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const now = Date.now();
  const standby = state === 'standby';

  return (
    <ProductShell
      surface="broadcast"
      footer
      communityHref="https://example.com/community"
      user={PREVIEW_USER}
    >
      <HomeView
        snapshot={standby ? null : snapshot(now)}
        champion={hallOfFameFixture(now)[0] ?? null}
        liveMatch={null}
        userId={PREVIEW_ME}
        isSignedIn
      />
    </ProductShell>
  );
}
