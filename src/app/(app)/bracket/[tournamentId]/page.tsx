import { notFound } from 'next/navigation';
import { getCurrentUser } from '@/server/modules/auth';
import {
  getTournamentSummary,
  listBracketRounds,
} from '@/server/modules/tournament';
import { AppError } from '@/lib/errors';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/card';
import { TournamentStatusBadge } from '@/components/features/tournament-status-badge';
import { BracketTree } from '@/components/features/bracket-tree';

export const metadata = { title: 'Bracket — Blitz It' };
export const dynamic = 'force-dynamic';

/**
 * Screen [11] — the knockout bracket (E6.4).
 *
 * Readable by any signed-in competitor; their own path is highlighted. This is
 * a read model over E3's topology — the page decides nothing, it renders what
 * advancement already wrote.
 *
 * Live updating arrives with SSE in a later epic; today it renders per request.
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

  // An unlisted tournament is for rehearsals — it stays off the competitor
  // surfaces even though the id would otherwise resolve.
  if (summary.visibility === 'UNLISTED') notFound();

  const rounds = await listBracketRounds(tournamentId);
  const tied = rounds
    .flatMap((round) => round.matches)
    .filter((match) => match.tieUnresolved).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={summary.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{summary.slug}</span>
            <TournamentStatusBadge
              status={summary.status}
              stage={summary.currentStage}
            />
          </span>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Bracket"
          value={summary.bracketSize ?? '—'}
          hint={
            summary.thirdPlaceEnabled ? 'with third place' : 'no third place'
          }
        />
        <StatCard
          label="Matches decided"
          value={
            summary.matches === 0
              ? '—'
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

      <BracketTree rounds={rounds} highlightUserId={user?.id ?? null} />
    </div>
  );
}
