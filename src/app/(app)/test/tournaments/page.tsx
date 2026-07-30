import { TournamentsView } from '@/components/features/tournaments-view';
import { TEST } from '@/server/modules/tournament';

export const metadata = { title: 'Test Tournaments - The Circuit' };
export const dynamic = 'force-dynamic';

/** The SAME component `/tournaments` renders, scoped to the test environment. */
export default async function TestTournamentsPage() {
  return <TournamentsView scope={TEST} />;
}
