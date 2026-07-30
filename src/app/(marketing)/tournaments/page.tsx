import { TournamentsView } from '@/components/features/tournaments-view';
import { PRODUCTION } from '@/server/modules/tournament';

export const metadata = { title: 'Tournaments - The Circuit' };
export const dynamic = 'force-dynamic';

export default async function TournamentsPage() {
  return <TournamentsView scope={PRODUCTION} />;
}
