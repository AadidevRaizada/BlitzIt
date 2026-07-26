import { requireAdmin } from '@/server/modules/auth';
import { listAuditLog } from '@/server/modules/admin/directory';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader, formatIst } from '@/components/ui/page-header';
import {
  EmptyState,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TableShell,
} from '@/components/ui/table';

export const metadata = { title: 'Audit log - The Circuit Admin' };
export const dynamic = 'force-dynamic';

function JsonSummary({ value }: { value: unknown }) {
  return (
    <pre className="bg-muted max-h-32 max-w-lg overflow-auto rounded-md p-2 text-xs">
      {JSON.stringify(value ?? null, null, 2)}
    </pre>
  );
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    entityType?: string;
    entityId?: string;
    action?: string;
  }>;
}) {
  const admin = await requireAdmin('/admin/audit');
  const filters = await searchParams;
  const rows = await listAuditLog(admin, { ...filters, take: 200 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="Append-only trail of privileged operations and lifecycle changes."
      />

      <Card>
        <CardContent className="pt-4">
          <form className="grid gap-3 md:grid-cols-4">
            <input
              name="action"
              placeholder="Action prefix"
              defaultValue={filters.action ?? ''}
              className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
            <input
              name="entityType"
              placeholder="Entity type"
              defaultValue={filters.entityType ?? ''}
              className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
            <input
              name="entityId"
              placeholder="Entity id"
              defaultValue={filters.entityId ?? ''}
              className="border-input bg-background focus-visible:ring-ring h-9 rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
            <button className="bg-primary text-primary-foreground focus-visible:ring-ring h-9 rounded-md px-4 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none">
              Filter log
            </button>
          </form>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title="No audit entries"
          hint="Privileged actions appear here."
        />
      ) : (
        <TableShell>
          <THead>
            <TH>Time</TH>
            <TH>Actor</TH>
            <TH>Action</TH>
            <TH>Entity</TH>
            <TH>Before</TH>
            <TH>After</TH>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD>{formatIst(row.createdAt)}</TD>
                <TD>{row.actorUsername ?? row.actorId ?? 'system'}</TD>
                <TD>
                  <Badge tone="outline">{row.action}</Badge>
                </TD>
                <TD>
                  <p>{row.entityType}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {row.entityId}
                  </p>
                </TD>
                <TD>
                  <JsonSummary value={row.before} />
                </TD>
                <TD>
                  <JsonSummary value={row.after} />
                </TD>
              </TR>
            ))}
          </TBody>
        </TableShell>
      )}
    </div>
  );
}
