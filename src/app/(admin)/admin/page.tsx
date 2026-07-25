import Link from 'next/link';
import { requireAdmin } from '@/server/modules/auth';
import {
  getQueueHealth,
  listTournamentSummaries,
  type TournamentSummary,
} from '@/server/modules/tournament';
import { getPlatformStats } from '@/server/modules/admin/directory';
import { runnerHeartbeat } from '@/server/jobs';
import { PageHeader, SectionTitle } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/table';
import { TournamentCard } from './tournaments/tournament-card';

export const metadata = { title: 'Admin — Blitz It' };
export const dynamic = 'force-dynamic';

/**
 * Screen [16] — Admin dashboard (E5).
 *
 * Ops overview: what is running now, what is coming, and whether the evaluation
 * pipeline is healthy. Grouped by lifecycle phase rather than listed flat,
 * because an operator's first question is always "is anything happening right
 * now?".
 */

const RUNNING_STATUSES = [
  'REGISTRATION_OPEN',
  'REGISTRATION_CLOSED',
  'SIMULATION',
  'SEEDING',
  'BRACKET_GENERATED',
  'LIVE',
] as const;

export default async function AdminDashboardPage() {
  await requireAdmin('/admin');

  const [tournaments, stats, queue] = await Promise.all([
    listTournamentSummaries({ take: 100 }),
    getPlatformStats(),
    getQueueHealth(),
  ]);

  const running = tournaments.filter((t) =>
    (RUNNING_STATUSES as readonly string[]).includes(t.status),
  );
  const drafts = tournaments.filter(
    (t) => t.status === 'DRAFT' || t.status === 'PUBLISHED',
  );
  const finished = tournaments.filter(
    (t) => t.status === 'COMPLETED' || t.status === 'CANCELLED',
  );

  // `runnerHeartbeat()` is an ms epoch, 0 when the runner never started.
  const heartbeat = runnerHeartbeat();
  const heartbeatAgeMs = heartbeat > 0 ? Date.now() - heartbeat : null;
  // The runner beats on its poll interval; a minute of silence means it is
  // wedged, disabled, or not deployed.
  const runnerHealthy = heartbeatAgeMs !== null && heartbeatAgeMs < 60_000;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Operations"
        description="Everything running right now, and the health of the pipeline behind it."
        actions={
          <Link
            href="/admin/tournaments/new"
            className={buttonVariants({ variant: 'primary' })}
          >
            New tournament
          </Link>
        }
      />

      <section className="space-y-3">
        <SectionTitle>Pipeline health</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Runner"
            value={
              <span className={runnerHealthy ? undefined : 'text-destructive'}>
                {runnerHealthy ? 'Beating' : 'Silent'}
              </span>
            }
            hint={
              heartbeatAgeMs === null
                ? 'No heartbeat recorded'
                : `Last beat ${Math.round(heartbeatAgeMs / 1000)}s ago`
            }
          />
          <StatCard
            label="Jobs in flight"
            value={
              queue.byState.QUEUED +
              queue.byState.CLAIMED +
              queue.byState.RUNNING +
              queue.byState.RETRY_SCHEDULED
            }
            hint={`${queue.byState.RETRY_SCHEDULED} awaiting retry`}
          />
          <StatCard
            label="Dead-lettered"
            value={
              <span
                className={
                  queue.deadLettered > 0 ? 'text-destructive' : undefined
                }
              >
                {queue.deadLettered}
              </span>
            }
            hint="Will not run again without intervention"
          />
          <StatCard
            label="Evaluations"
            value={stats.evaluations}
            hint={`${stats.submissions} submissions all-time`}
          />
        </div>
      </section>

      <TournamentGroup
        title="Running"
        hint="Live or in progress — these need attention today."
        tournaments={running}
        emptyTitle="Nothing running"
        emptyHint="Publish a draft and open registration to get a tournament under way."
      />

      <TournamentGroup
        title="Draft & upcoming"
        tournaments={drafts}
        emptyTitle="No drafts"
        emptyHint="Create a tournament to schedule next week's event."
      />

      <TournamentGroup
        title="Completed"
        tournaments={finished}
        emptyTitle="Nothing completed yet"
      />

      <section className="space-y-3">
        <SectionTitle>Platform</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Users" value={stats.users} />
          <StatCard label="Admins" value={stats.admins} />
          <StatCard label="Tournaments" value={stats.tournaments} />
          <StatCard label="Active" value={stats.activeTournaments} />
        </div>
      </section>
    </div>
  );
}

function TournamentGroup({
  title,
  hint,
  tournaments,
  emptyTitle,
  emptyHint,
}: {
  title: string;
  hint?: string;
  tournaments: TournamentSummary[];
  emptyTitle: string;
  emptyHint?: string;
}) {
  return (
    <section className="space-y-3">
      <SectionTitle
        actions={<Badge tone="neutral">{tournaments.length}</Badge>}
      >
        {title}
      </SectionTitle>
      {hint ? <p className="text-muted-foreground text-sm">{hint}</p> : null}
      {tournaments.length === 0 ? (
        <EmptyState title={emptyTitle} hint={emptyHint} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {tournaments.map((tournament) => (
            <TournamentCard key={tournament.id} tournament={tournament} />
          ))}
        </div>
      )}
    </section>
  );
}
