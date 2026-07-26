import { requireAdmin } from '@/server/modules/auth';
import { listUsers } from '@/server/modules/admin/directory';
import { Badge } from '@/components/ui/badge';
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

export const metadata = { title: 'Users - The Circuit Admin' };
export const dynamic = 'force-dynamic';

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) {
  const admin = await requireAdmin('/admin/users');
  const { search } = await searchParams;
  const users = await listUsers(admin, { search, take: 200 });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Competitors and organizers known to the platform."
      />

      {users.length === 0 ? (
        <EmptyState
          title="No users found"
          hint="Try a different search term."
        />
      ) : (
        <TableShell>
          <THead>
            <TH>User</TH>
            <TH>Role</TH>
            <TH>City</TH>
            <TH numeric>Registrations</TH>
            <TH numeric>Submissions</TH>
            <TH>Joined</TH>
          </THead>
          <TBody>
            {users.map((user) => (
              <TR key={user.id}>
                <TD>
                  <p className="font-medium">
                    {user.displayName ?? user.username}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {user.username} · {user.email}
                  </p>
                </TD>
                <TD>
                  <Badge tone={user.role === 'ADMIN' ? 'brand' : 'neutral'}>
                    {user.role}
                  </Badge>
                </TD>
                <TD>{user.city ?? '-'}</TD>
                <TD numeric>{user.registrations}</TD>
                <TD numeric>{user.submissions}</TD>
                <TD>{formatIst(user.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </TableShell>
      )}
    </div>
  );
}
