import { ProductShell } from '@/components/features/product-shell';
import { HallOfFameRecord } from '@/components/features/hall-of-fame-view';
import { PREVIEW_USER, hallOfFameFixture } from '@/app/preview/_fixtures';

/** Design preview of `/hall-of-fame`. See `/preview/tournaments` for why. */
export const metadata = {
  title: 'Preview - Hall of Fame',
  robots: { index: false, follow: false },
};

export default async function HallOfFamePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;

  return (
    <ProductShell
      surface="broadcast"
      footer
      communityHref="https://example.com/community"
      user={PREVIEW_USER}
    >
      <HallOfFameRecord
        entries={state === 'empty' ? [] : hallOfFameFixture(Date.now())}
      />
    </ProductShell>
  );
}
