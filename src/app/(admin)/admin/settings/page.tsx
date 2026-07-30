import { requireAdmin } from '@/server/modules/auth';
import { getPlatformSettings } from '@/server/modules/admin/settings';
import { Card, CardContent } from '@/components/ui/card';
import { DataRow, PageHeader } from '@/components/ui/page-header';
import { PlatformSettingsForm } from './platform-settings-form';

export const metadata = { title: 'Admin settings - The Circuit Admin' };

export default async function AdminSettingsPage() {
  await requireAdmin('/admin/settings');
  const settings = await getPlatformSettings();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin settings"
        description="Platform-wide settings and operational reference values."
      />
      <Card>
        <CardContent className="space-y-4 pt-4">
          <div>
            <h2 className="font-semibold">Platform settings</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Values here are read by player-facing navigation and footer
              surfaces.
            </p>
          </div>
          <PlatformSettingsForm
            communityWhatsAppUrl={settings.communityWhatsAppUrl ?? ''}
          />
        </CardContent>
      </Card>

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
