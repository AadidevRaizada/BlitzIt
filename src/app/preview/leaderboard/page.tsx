import { ProductShell } from '@/components/features/product-shell';
import { LeaderboardStandings } from '@/components/features/leaderboard-view';
import {
  PREVIEW_ME,
  PREVIEW_USER,
  leaderboardFixture,
} from '@/app/preview/_fixtures';

/** Design preview of `/leaderboard`. See `/preview/tournaments` for why. */
export const metadata = {
  title: 'Preview - Leaderboard',
  robots: { index: false, follow: false },
};

export default async function LeaderboardPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; by?: string }>;
}) {
  const { state, by } = await searchParams;
  const order = by === 'seed' || by === 'city' ? by : 'score';

  return (
    <ProductShell
      surface="broadcast"
      footer
      communityHref="https://example.com/community"
      user={PREVIEW_USER}
    >
      <LeaderboardStandings
        entries={state === 'empty' ? [] : leaderboardFixture()}
        order={order}
        basePath="/preview/leaderboard"
        tournamentName={state === 'empty' ? null : 'Circuit Weekly #32'}
        tournamentId={state === 'empty' ? null : 'live-1'}
        highlightUserId={PREVIEW_ME}
        liveVersion={null}
      />
    </ProductShell>
  );
}
