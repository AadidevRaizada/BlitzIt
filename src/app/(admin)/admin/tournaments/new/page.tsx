import { requireAdmin } from '@/server/modules/auth';
import { PageHeader } from '@/components/ui/page-header';
import { NewTournamentForm } from './tournament-form';

export const metadata = { title: 'New tournament - The Circuit Admin' };

export default async function NewTournamentPage() {
  await requireAdmin('/admin/tournaments/new');

  return (
    <div className="space-y-6">
      <PageHeader
        title="New tournament"
        description="Create the shell, then set the schedule and author a problem on the detail page."
        back={{ href: '/admin/tournaments', label: 'Tournaments' }}
      />
      <NewTournamentForm />
    </div>
  );
}
