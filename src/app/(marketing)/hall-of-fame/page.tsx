import { HallOfFameView } from '@/components/features/hall-of-fame-view';
import { PRODUCTION } from '@/server/modules/tournament';

export const metadata = { title: 'Hall of Fame - The Circuit' };
export const dynamic = 'force-dynamic';

export default async function HallOfFamePage() {
  return <HallOfFameView scope={PRODUCTION} />;
}
