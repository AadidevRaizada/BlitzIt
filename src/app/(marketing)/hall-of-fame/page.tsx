import Link from 'next/link';
import { listHallOfFame } from '@/server/modules/hall-of-fame';
import { formatMinor } from '@/server/modules/notification';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/table';

export const metadata = { title: 'Hall of Fame — Blitz It' };
export const dynamic = 'force-dynamic';

/**
 * Screen [3] — the Hall of Fame (E8.4).
 *
 * The permanent record: every published tournament, its podium, and the field
 * it was won against. Read straight off `HallOfFame`, whose counts are frozen
 * at publication — the tournament's own counters keep moving, and a champion's
 * page should not quietly change because a registration was reconciled months
 * later.
 */
export default async function HallOfFamePage() {
  const entries = await listHallOfFame({ take: 100 });

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6">
      <PageHeader
        title="Hall of Fame"
        description="Every Blitz It champion, and the field they beat."
      />

      {entries.length === 0 ? (
        <EmptyState
          title="No champions yet"
          hint="The first tournament to finish will be recorded here."
        />
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li
              key={entry.tournamentId}
              className="border-border bg-card rounded-lg border p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{entry.tournamentName}</h2>
                <p className="text-muted-foreground text-xs tabular-nums">
                  {entry.publishedAt.toISOString().slice(0, 10)}
                </p>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Place
                  rank="Champion"
                  tone="text-primary"
                  username={entry.champion?.username ?? null}
                  name={
                    entry.champion?.displayName ??
                    entry.champion?.username ??
                    null
                  }
                  detail={entry.champion?.city ?? null}
                />
                <Place
                  rank="Runner-up"
                  username={entry.runnerUp?.username ?? null}
                  name={
                    entry.runnerUp?.displayName ??
                    entry.runnerUp?.username ??
                    null
                  }
                />
                <Place
                  rank="Third"
                  username={entry.thirdPlace?.username ?? null}
                  name={
                    entry.thirdPlace?.displayName ??
                    entry.thirdPlace?.username ??
                    null
                  }
                />
              </div>

              <p className="text-muted-foreground mt-4 text-xs tabular-nums">
                {entry.participantCount} competitors ·{' '}
                {formatMinor(entry.prizePoolMinor)} prize pool ·{' '}
                <Link
                  href={`/bracket/${entry.tournamentId}`}
                  className="text-primary hover:underline"
                >
                  see the bracket
                </Link>
              </p>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function Place({
  rank,
  name,
  username,
  detail,
  tone,
}: {
  rank: string;
  name: string | null;
  username: string | null;
  detail?: string | null;
  tone?: string;
}) {
  return (
    <div>
      <p className="text-muted-foreground text-xs tracking-wide uppercase">
        {rank}
      </p>
      <p className={`mt-0.5 font-medium ${tone ?? ''}`}>
        {name && username ? (
          <Link href={`/u/${username}`} className="hover:underline">
            {name}
          </Link>
        ) : (
          // Third place is genuinely absent when the play-off is disabled (D6)
          // — both losing semi-finalists share the placement, and naming one
          // would be an arbitrary choice presented as a result.
          <span className="text-muted-foreground">—</span>
        )}
      </p>
      {detail ? (
        <p className="text-muted-foreground mt-0.5 text-xs">{detail}</p>
      ) : null}
    </div>
  );
}
