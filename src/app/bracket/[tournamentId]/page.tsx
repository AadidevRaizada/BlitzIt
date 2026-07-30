import { notFound } from 'next/navigation';
import { getCurrentUser, isAdmin } from '@/server/modules/auth';
import { getPlatformSettings } from '@/server/modules/admin/settings';
import { countUnreadNotifications } from '@/server/modules/notification';
import {
  getLiveSnapshot,
  getTournamentSummary,
  listBracketRounds,
} from '@/server/modules/tournament';
import { AppError } from '@/lib/errors';
import { ProductShell } from '@/components/features/product-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Card, StatCard } from '@/components/ui/card';
import { TournamentStatusBadge } from '@/components/features/tournament-status-badge';
import { BracketTree } from '@/components/features/bracket-tree';
import { LiveRefresh } from '@/components/features/live-refresh';

export const metadata = { title: 'Bracket - The Circuit' };
export const dynamic = 'force-dynamic';

/**
 * Public knockout bracket.
 *
 * This route deliberately lives outside the guarded `(app)` group so signed-out
 * spectators can open it. Page-level guards still apply: missing and UNLISTED
 * tournaments 404, and bracket reads keep unopened problems hidden.
 */
export default async function BracketPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;
  const user = await getCurrentUser();

  let summary;
  try {
    summary = await getTournamentSummary(tournamentId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'NOT_FOUND') notFound();
    throw error;
  }

  if (summary.visibility === 'UNLISTED') notFound();

  const rounds = await listBracketRounds(tournamentId, {
    revealProblems: false,
  });
  const { version } = await getLiveSnapshot(tournamentId);
  const tied = rounds
    .flatMap((round) => round.matches)
    .filter((match) => match.tieUnresolved).length;
  const [unread, settings] = await Promise.all([
    user ? countUnreadNotifications(user.id) : Promise.resolve(0),
    getPlatformSettings(),
  ]);

  return (
    <ProductShell
      surface="broadcast"
      footer
      communityHref={settings.communityWhatsAppUrl}
      user={
        user
          ? {
              username: user.username,
              profileHref: `/u/${user.username}`,
              unread,
              isAdmin: isAdmin(user),
            }
          : null
      }
    >
      <div className="px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            title={summary.name}
            description={
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{summary.slug}</span>
                <TournamentStatusBadge
                  status={summary.status}
                  stage={summary.currentStage}
                />
                <LiveRefresh
                  tournamentId={tournamentId}
                  initialVersion={version}
                />
              </span>
            }
          />

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Bracket"
              value={summary.bracketSize ?? '-'}
              hint={
                summary.thirdPlaceEnabled
                  ? 'with third place'
                  : 'no third place'
              }
            />
            <StatCard
              label="Matches decided"
              value={
                summary.matches === 0
                  ? '-'
                  : `${summary.matchesDecided}/${summary.matches}`
              }
            />
            <StatCard label="Competitors" value={summary.registrations} />
            <StatCard
              label="Awaiting sudden death"
              value={tied}
              hint={tied > 0 ? 'a tie needs a decider' : 'none'}
            />
          </div>

          <Card surface="broadcast" className="p-4">
            <BracketTree rounds={rounds} highlightUserId={user?.id ?? null} />
          </Card>
        </div>
      </div>
    </ProductShell>
  );
}
