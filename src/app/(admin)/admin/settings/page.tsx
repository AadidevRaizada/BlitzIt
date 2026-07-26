import { requireAdmin } from '@/server/modules/auth';
import { Card, CardContent } from '@/components/ui/card';
import { DataRow, PageHeader } from '@/components/ui/page-header';

export const metadata = { title: 'Admin settings - The Circuit Admin' };

export default async function AdminSettingsPage() {
  await requireAdmin('/admin/settings');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin settings"
        description="Operational configuration currently lives in environment variables and per-tournament settings."
      />
      <Card>
        <CardContent className="grid gap-3 pt-4 md:grid-cols-2">
          <DataRow
            label="Queue backend"
            value="PostgreSQL EvaluationJob table"
          />
          <DataRow label="Challenge strategy" value="REST_API only (D17)" />
          <DataRow label="Timezone" value="UTC storage, IST display" />
          <DataRow
            label="Evaluation profile policy"
            value="Tournament module (D20)"
          />
        </CardContent>
      </Card>
    </div>
  );
}
