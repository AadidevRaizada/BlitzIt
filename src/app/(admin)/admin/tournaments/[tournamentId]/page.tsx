import { notFound } from 'next/navigation';
import { requireAdmin } from '@/server/modules/auth';
import { getTournamentSummary } from '@/server/modules/tournament';
import { AppError } from '@/lib/errors';
import { PageHeader } from '@/components/ui/page-header';
import { TabNav, type TabItem } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { TournamentStatusBadge } from '@/components/features/tournament-status-badge';
import { OverviewTab } from './tabs/overview';
import { TimelineTab } from './tabs/timeline';
import { RegistrationsTab } from './tabs/registrations';
import { SubmissionsTab } from './tabs/submissions';
import { BracketTab } from './tabs/bracket';
import { SettingsTab } from './tabs/settings';

export const metadata = { title: 'Tournament - The Circuit Admin' };
export const dynamic = 'force-dynamic';

const TABS = [
  'overview',
  'timeline',
  'registrations',
  'submissions',
  'bracket',
  'settings',
] as const;
type TabKey = (typeof TABS)[number];

/**
 * Screen [17b] — Tournament detail (E5).
 *
 * Tabs are links over a `?tab=` param, so each one is a plain server render of
 * only the data it needs. Loading every tab's data up front would make the page
 * slow for the operator who only wanted the overview.
 */
export default async function TournamentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ tournamentId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireAdmin();
  const { tournamentId } = await params;
  const { tab } = await searchParams;

  let summary;
  try {
    summary = await getTournamentSummary(tournamentId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  const active: TabKey = (TABS as readonly string[]).includes(tab ?? '')
    ? (tab as TabKey)
    : 'overview';

  const href = (key: TabKey) =>
    key === 'overview'
      ? `/admin/tournaments/${tournamentId}`
      : `/admin/tournaments/${tournamentId}?tab=${key}`;

  const tabs: TabItem[] = [
    { key: 'overview', label: 'Overview', href: href('overview') },
    {
      key: 'timeline',
      label: 'Timeline',
      href: href('timeline'),
      badge: summary.rounds,
    },
    {
      key: 'registrations',
      label: 'Registrations',
      href: href('registrations'),
      badge: summary.registrations,
    },
    {
      key: 'submissions',
      label: 'Submissions',
      href: href('submissions'),
      badge: summary.submissions,
    },
    {
      key: 'bracket',
      label: 'Bracket',
      href: href('bracket'),
      badge: summary.matches || undefined,
    },
    { key: 'settings', label: 'Settings', href: href('settings') },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: '/admin/tournaments', label: 'Tournaments' }}
        title={summary.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{summary.slug}</span>
            <TournamentStatusBadge
              status={summary.status}
              stage={summary.currentStage}
            />
            {summary.visibility === 'UNLISTED' ? (
              <Badge tone="warning">Unlisted</Badge>
            ) : null}
            {summary.archivedAt ? <Badge tone="neutral">Archived</Badge> : null}
          </span>
        }
      />

      <TabNav tabs={tabs} active={active} />

      {active === 'overview' ? <OverviewTab summary={summary} /> : null}
      {active === 'timeline' ? <TimelineTab summary={summary} /> : null}
      {active === 'registrations' ? (
        <RegistrationsTab summary={summary} />
      ) : null}
      {active === 'submissions' ? <SubmissionsTab summary={summary} /> : null}
      {active === 'bracket' ? <BracketTab summary={summary} /> : null}
      {active === 'settings' ? <SettingsTab summary={summary} /> : null}
    </div>
  );
}
