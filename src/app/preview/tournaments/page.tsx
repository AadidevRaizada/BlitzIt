import type {
  PublicTournamentBucket,
  PublicTournamentCard,
} from '@/server/modules/tournament';
import { ProductShell } from '@/components/features/product-shell';
import { TournamentsCalendar } from '@/components/features/tournaments-view';

/**
 * A design preview of `/tournaments`, rendered from fixtures.
 *
 * It exists because the real page is `force-dynamic` over Prisma: reviewing a
 * layout change otherwise means standing up Postgres and seeding it. This route
 * renders the SAME components against hand-written data, so what you see here
 * is what the live page renders — not a mock-up that can drift from it.
 *
 * `?state=empty` shows the nothing-scheduled state, which is the one a visitor
 * is most likely to hit on a quiet week and the one the old layout handled
 * worst. `?filter=` behaves exactly as it does on the real page.
 */
export const metadata = {
  title: 'Preview - Tournaments',
  robots: { index: false, follow: false },
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function prizePool(id: string, minor: number) {
  return {
    tournamentId: id,
    currency: 'INR',
    paidEntries: 0,
    entryContributionMinor: 0,
    basePrizePoolMinor: minor,
    sponsorContributionMinor: 0,
    bonusContributionMinor: 0,
    guaranteedFloorMinor: minor,
    computedPrizePoolMinor: minor,
    prizePoolMinor: minor,
    firstPrizeCapMinor: minor,
    prizeDistribution: null,
    allocations: [],
  };
}

function card(
  overrides: Partial<PublicTournamentCard> &
    Pick<PublicTournamentCard, 'id' | 'slug' | 'name' | 'status'>,
): PublicTournamentCard {
  return {
    environment: 'PRODUCTION',
    currentStage: null,
    participantCount: 0,
    bracketSize: null,
    maxRegistrations: null,
    thirdPlaceEnabled: true,
    passPriceMinor: 9900,
    prizePoolMinor: 0,
    prizePool: prizePool(overrides.id, overrides.prizePoolMinor ?? 0),
    currency: 'INR',
    registrationOpensAt: null,
    registrationClosesAt: null,
    simulationOpensAt: null,
    simulationClosesAt: null,
    liveStartsAt: null,
    completedAt: null,
    youtubeStreamUrl: null,
    categories: [],
    ...overrides,
  };
}

function fixtures(
  now: number,
): Record<PublicTournamentBucket, PublicTournamentCard[]> {
  return {
    LIVE_NOW: [
      card({
        id: 'live-1',
        slug: 'circuit-weekly-32',
        name: 'Circuit Weekly #32',
        status: 'LIVE',
        currentStage: 'QUARTER_FINAL',
        participantCount: 32,
        bracketSize: 32,
        prizePoolMinor: 4500000,
        liveStartsAt: new Date(now + 42 * 60 * 1000),
        categories: ['AI_AGENT', 'REST_API'],
      }),
    ],
    REGISTERING: [
      card({
        id: 'open-1',
        slug: 'circuit-weekly-33',
        name: 'Circuit Weekly #33',
        status: 'REGISTRATION_OPEN',
        participantCount: 29,
        bracketSize: 32,
        prizePoolMinor: 3200000,
        registrationOpensAt: new Date(now - 2 * DAY),
        registrationClosesAt: new Date(now + 9 * HOUR),
        simulationOpensAt: new Date(now + 2 * DAY),
        liveStartsAt: new Date(now + 3 * DAY),
        categories: ['WEB_APP', 'AUTOMATION'],
      }),
      card({
        id: 'open-2',
        slug: 'ocr-open-invitational',
        name: 'OCR Open Invitational',
        status: 'REGISTRATION_OPEN',
        participantCount: 11,
        maxRegistrations: 64,
        passPriceMinor: 0,
        prizePoolMinor: 1500000,
        registrationClosesAt: new Date(now + 4 * DAY),
        liveStartsAt: new Date(now + 6 * DAY),
        categories: ['OCR'],
      }),
    ],
    COMING_SOON: [
      card({
        id: 'soon-1',
        slug: 'circuit-weekly-34',
        name: 'Circuit Weekly #34',
        status: 'PUBLISHED',
        prizePoolMinor: 3200000,
        registrationOpensAt: new Date(now + 5 * DAY),
        liveStartsAt: new Date(now + 10 * DAY),
        categories: ['CLI_APP'],
      }),
      card({
        id: 'soon-2',
        slug: 'season-two-finals',
        name: 'Season Two Finals',
        status: 'PUBLISHED',
        prizePoolMinor: 10000000,
        categories: ['INTERNAL_TOOL', 'CHROME_EXTENSION'],
      }),
    ],
    PAST: [
      card({
        id: 'past-1',
        slug: 'circuit-weekly-31',
        name: 'Circuit Weekly #31',
        status: 'COMPLETED',
        participantCount: 32,
        bracketSize: 32,
        prizePoolMinor: 4100000,
        completedAt: new Date(now - 7 * DAY),
        categories: ['WEB_APP'],
      }),
      card({
        id: 'past-2',
        slug: 'circuit-weekly-30',
        name: 'Circuit Weekly #30',
        status: 'COMPLETED',
        participantCount: 24,
        bracketSize: 32,
        prizePoolMinor: 3600000,
        completedAt: new Date(now - 14 * DAY),
        categories: ['AI_AGENT'],
      }),
      card({
        id: 'past-3',
        slug: 'launch-invitational',
        name: 'Launch Invitational',
        status: 'COMPLETED',
        participantCount: 16,
        bracketSize: 16,
        passPriceMinor: 0,
        prizePoolMinor: 0,
        completedAt: new Date(now - 28 * DAY),
        categories: ['REST_API'],
      }),
    ],
  };
}

const EMPTY: Record<PublicTournamentBucket, PublicTournamentCard[]> = {
  LIVE_NOW: [],
  REGISTERING: [],
  COMING_SOON: [],
  PAST: [],
};

export default async function TournamentsPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; filter?: string }>;
}) {
  const { state, filter } = await searchParams;
  const now = Date.now();

  return (
    <ProductShell
      surface="broadcast"
      footer
      communityHref="https://example.com/community"
      user={{
        username: 'parth_dev',
        profileHref: '/u/parth_dev',
        unread: 3,
        isAdmin: true,
        canAccessTest: true,
      }}
    >
      <TournamentsCalendar
        grouped={state === 'empty' ? EMPTY : fixtures(now)}
        serverTime={new Date(now).toISOString()}
        filter={filter}
        basePath="/preview/tournaments"
      />
    </ProductShell>
  );
}
