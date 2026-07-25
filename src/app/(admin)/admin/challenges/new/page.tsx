import { requireAdmin } from '@/server/modules/auth';
import { PageHeader } from '@/components/ui/page-header';
import { ProblemForm } from '../problem-form';

export const metadata = { title: 'New challenge — Blitz It Admin' };

export default async function NewChallengePage() {
  await requireAdmin('/admin/challenges/new');

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/admin/challenges', label: 'Challenges' }}
        title="Create challenge"
        description="Week 1 accepts REST_API challenges only until additional evaluation strategies are enabled."
      />
      <ProblemForm />
    </div>
  );
}
