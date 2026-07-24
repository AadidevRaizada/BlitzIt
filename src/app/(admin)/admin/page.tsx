import { db } from '@/server/db';
import { requireAdmin } from '@/server/modules/auth';

export const metadata = { title: 'Admin — Blitz It' };
export const dynamic = 'force-dynamic';

/**
 * Admin overview placeholder (E1). Proves the ADMIN guard end-to-end; the real
 * ops dashboard (tournaments, problems, evaluations, payouts) comes later.
 */
export default async function AdminPage() {
  await requireAdmin('/admin');

  const [userCount, adminCount, jobCount] = await Promise.all([
    db.user.count(),
    db.user.count({ where: { role: 'ADMIN' } }),
    db.evaluationJob.count(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin overview</h1>
      <dl className="grid gap-4 sm:grid-cols-3">
        <Stat label="Users" value={userCount} />
        <Stat label="Admins" value={adminCount} />
        <Stat label="Evaluation jobs" value={jobCount} />
      </dl>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-border rounded-md border p-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-2xl font-semibold">{value}</dd>
    </div>
  );
}
