import type {
  MyTournamentState,
  PublicTournamentCard,
} from '@/server/modules/tournament';
import { resolveMissionControl } from '@/server/modules/workspace';
import { ProductShell } from '@/components/features/product-shell';
import { MissionControlView } from '@/components/features/mission-control-view';
import {
  PREVIEW_ME,
  PREVIEW_USER,
  leaderboardFixture,
} from '@/app/preview/_fixtures';

/** Design preview of `/dashboard`. See `/preview/tournaments` for why. */
export const metadata = {
  title: 'Preview - Mission Control',
  robots: { index: false, follow: false },
};

const HOUR = 60 * 60 * 1000;

function tournament(now: number): PublicTournamentCard {
  const prizePoolMinor = 4500000;
  return {
    id: 'live-1',
    slug: 'circuit-weekly-32',
    name: 'Circuit Weekly #32',
    status: 'SIMULATION',
    environment: 'PRODUCTION',
    currentStage: 'SIMULATION',
    participantCount: 32,
    bracketSize: 32,
    maxRegistrations: 32,
    thirdPlaceEnabled: true,
    passPriceMinor: 9900,
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
    registrationOpensAt: new Date(now - 72 * HOUR),
    registrationClosesAt: new Date(now - 2 * HOUR),
    simulationOpensAt: new Date(now - HOUR),
    simulationClosesAt: new Date(now + 3 * HOUR),
    liveStartsAt: new Date(now + 6 * HOUR),
    completedAt: null,
    youtubeStreamUrl: null,
    categories: ['AI_AGENT', 'REST_API'],
  };
}

function competitor(now: number): MyTournamentState {
  return {
    tournamentId: 'live-1',
    isRegistered: true,
    registrationId: 'reg-1',
    registrationStatus: 'ACTIVE',
    registeredAt: new Date(now - 48 * HOUR),
    payment: {
      id: 'pay-1',
      status: 'PAID',
      amountMinor: 9900,
      currency: 'INR',
      providerOrderId: 'order_preview',
      providerPaymentId: 'pay_preview',
      failureReason: null,
      paidAt: new Date(now - 47 * HOUR),
    },
    seed: 9,
    placement: 9,
    qualified: true,
    eliminatedAtStage: null,
    simulationScore: 68.5,
    currentRound: {
      id: 'round-1',
      stage: 'SIMULATION',
      status: 'OPEN',
      opensAt: new Date(now - HOUR),
      deadlineAt: new Date(now + 3 * HOUR),
      submitted: true,
      submissionStatus: 'SCORED',
      submissionId: 'sub-1',
    },
    currentMatch: null,
    // One box deliberately left unchecked, so the readiness meter shows what a
    // partly-ready competitor actually sees.
    readiness: {
      githubConnected: true,
      avatarSet: false,
      profileLocationSet: true,
      profileComplete: true,
      termsAccepted: true,
      registered: true,
      paymentSettled: true,
    },
  };
}

export default async function DashboardPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const now = Date.now();
  const empty = state === 'empty';

  const mission = resolveMissionControl({
    isSignedIn: true,
    isOnboardingComplete: true,
    tournament: empty ? null : tournament(now),
    competitor: empty ? null : competitor(now),
  });

  return (
    <ProductShell
      surface="workspace"
      communityHref="https://example.com/community"
      user={PREVIEW_USER}
    >
      <MissionControlView
        identity={{
          name: 'Parth Parmar',
          username: 'parth_dev',
          role: 'COMPETITOR',
        }}
        mission={mission}
        stats={
          empty
            ? { entries: 0, bestPlacement: null, submissions: 0 }
            : { entries: 4, bestPlacement: 3, submissions: 2 }
        }
        notifications={
          empty
            ? []
            : [
                {
                  id: 'n1',
                  title: 'Qualifiers are open',
                  body: 'Circuit Weekly #32 qualifying is live. You have three hours to submit.',
                  createdAt: new Date(now - HOUR),
                },
                {
                  id: 'n2',
                  title: 'Payment confirmed',
                  body: 'Your entry for Circuit Weekly #32 is confirmed. Seat 9 of 32.',
                  createdAt: new Date(now - 26 * HOUR),
                },
                {
                  id: 'n3',
                  title: 'Bracket published',
                  body: 'Seeding for Circuit Weekly #31 has been published.',
                  createdAt: new Date(now - 80 * HOUR),
                },
              ]
        }
        leaderboard={empty ? [] : leaderboardFixture().slice(0, 5)}
        userId={PREVIEW_ME}
        serverTime={new Date(now).toISOString()}
      />
    </ProductShell>
  );
}
