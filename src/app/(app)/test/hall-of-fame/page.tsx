import { HallOfFameView } from '@/components/features/hall-of-fame-view';
import { TEST } from '@/server/modules/tournament';

export const metadata = { title: 'Test Hall of Fame - The Circuit' };
export const dynamic = 'force-dynamic';

/** The SAME component `/hall-of-fame` renders, scoped to the test environment. */
export default async function TestHallOfFamePage() {
  return <HallOfFameView scope={TEST} />;
}
