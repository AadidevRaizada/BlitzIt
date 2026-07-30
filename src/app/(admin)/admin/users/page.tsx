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
import { UserRowActions } from './user-row-actions';

export const metadata = { title: 'Users - The Circuit Admin' };
export const dynamic = 'force-dynamic';

/** Role badge tone: admins brand, testers warning, bots muted. */
function roleTone(role: string): 'brand' | 'warning' | 'neutral' {
  if (role === 'ADMIN') return 'brand';
  if (role === 'TEST') return 'warning';
  return 'neutral';
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; bots?: string }>;
}) {
  const admin = await requireAdmin('/admin/users');
  const { search, bots } = await searchParams;
  const includeBots = bots === '1';
  const users = await listUsers(admin, { search, take: 200, includeBots });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Competitors and organizers known to the platform. Grant TEST to give an account the internal testing environment; production competitors cannot be converted."
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
            <TH>{''}</TH>
          </THead>
          <TBody>
            {users.map((user) => (
              <TR key={user.id}>
                <TD>
                  <p className="flex items-center gap-2 font-medium">
                    {user.displayName ?? user.username}
                    {user.isBot ? <Badge tone="neutral">BOT</Badge> : null}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {user.username} · {user.email}
                  </p>
                </TD>
                <TD>
                  <Badge tone={roleTone(user.role)}>{user.role}</Badge>
                </TD>
                <TD>{user.city ?? '-'}</TD>
                <TD numeric>{user.registrations}</TD>
                <TD numeric>{user.submissions}</TD>
                <TD>{formatIst(user.createdAt)}</TD>
                <TD>
                  <UserRowActions
                    userId={user.id}
                    username={user.username}
                    role={user.role}
                    isBot={user.isBot}
                    hasCompetitiveRecord={user.hasCompetitiveRecord}
                    isSelf={user.id === admin.id}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </TableShell>
      )}
    </div>
  );
}
