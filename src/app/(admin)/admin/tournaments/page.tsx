import Link from 'next/link';
import { requireAdmin } from '@/server/modules/auth';
import { listTournamentSummaries } from '@/server/modules/tournament';
import { PageHeader } from '@/components/ui/page-header';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/table';
import { TournamentCard } from './tournament-card';

export const metadata = { title: 'Tournaments — Blitz It Admin' };
export const dynamic = 'force-dynamic';

/**
 * Screen [17] — Tournaments (E5).
 *
 * Archived tournaments are hidden by default and reachable through
 * `?archived=1`; the operator's working set is what is not yet filed away.
 */
export default async function AdminTournamentsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  await requireAdmin('/admin/tournaments');
  const { archived } = await searchParams;
  const showArchived = archived === '1';

  const visible = await listTournamentSummaries(
    showArchived ? { archivedOnly: true } : {},
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tournaments"
        description={
          showArchived
            ? 'Archived tournaments.'
            : 'Every tournament that has not been archived.'
        }
        actions={
          <>
            <Link
              href={
                showArchived
                  ? '/admin/tournaments'
                  : '/admin/tournaments?archived=1'
              }
              className={buttonVariants({ variant: 'secondary' })}
            >
              {showArchived ? 'Show active' : 'Show archived'}
            </Link>
            <Link
              href="/admin/tournaments/new"
              className={buttonVariants({ variant: 'primary' })}
            >
              New tournament
            </Link>
          </>
        }
      />

      {visible.length === 0 ? (
        <EmptyState
          title={showArchived ? 'Nothing archived' : 'No tournaments yet'}
          hint={
            showArchived
              ? 'Completed and cancelled tournaments can be archived from their settings tab.'
              : 'Create one to schedule a weekly event: set the schedule, author a problem, then open registration.'
          }
          action={
            showArchived ? null : (
              <Link
                href="/admin/tournaments/new"
                className={buttonVariants({ variant: 'primary' })}
              >
                New tournament
              </Link>
            )
          }
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {visible.map((tournament) => (
            <TournamentCard key={tournament.id} tournament={tournament} />
          ))}
        </div>
      )}
    </div>
  );
}
