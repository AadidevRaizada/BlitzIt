import Link from 'next/link';
import type { LeaderboardEntry } from '@/server/modules/tournament';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Standings table — screen [12], and the top-N block on the landing page [1].
 *
 * A server component: it is a read model kept current by `LiveRefresh`, so
 * shipping client JavaScript for it would buy nothing.
 *
 * Placement wins over score wherever both exist. Once a tournament is decided,
 * "who finished where" is the truth and the qualifying score is trivia.
 */
export function LiveLeaderboard({
  entries,
  highlightUserId,
  showCity = true,
  compact = false,
  emptyHint,
}: {
  entries: LeaderboardEntry[];
  /** Renders the viewer's own row prominently. */
  highlightUserId?: string | null;
  showCity?: boolean;
  /** Drops the seed and city columns for the landing-page embed. */
  compact?: boolean;
  emptyHint?: string;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No standings yet"
        hint={
          emptyHint ??
          'Rankings appear once the qualifying rounds have been scored.'
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted-foreground border-border border-b text-left text-xs">
            <th scope="col" className="w-10 py-2 pr-2 font-medium">
              #
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Competitor
            </th>
            {!compact && showCity ? (
              <th scope="col" className="py-2 pr-3 font-medium">
                City
              </th>
            ) : null}
            {!compact ? (
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Seed
              </th>
            ) : null}
            <th scope="col" className="py-2 text-right font-medium">
              Score
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const mine =
              highlightUserId != null && entry.userId === highlightUserId;
            return (
              <tr
                key={entry.userId}
                className={cn(
                  'border-border/60 border-b last:border-0',
                  mine && 'bg-primary/5',
                )}
              >
                <td className="text-muted-foreground py-2 pr-2 tabular-nums">
                  {entry.placement ?? index + 1}
                </td>
                <td className="py-2 pr-3">
                  <Link
                    href={`/u/${entry.username}`}
                    className="hover:text-primary font-medium hover:underline"
                  >
                    {entry.displayName ?? entry.username}
                  </Link>
                  {mine ? (
                    <span className="text-primary ml-1.5 text-xs font-medium">
                      (you)
                    </span>
                  ) : null}
                  {entry.eliminatedAtStage ? (
                    <Badge tone="neutral" className="ml-2">
                      out · {entry.eliminatedAtStage.replace('_', ' ')}
                    </Badge>
                  ) : entry.placement === 1 ? (
                    <Badge tone="success" className="ml-2">
                      champion
                    </Badge>
                  ) : null}
                </td>
                {!compact && showCity ? (
                  <td className="text-muted-foreground py-2 pr-3">
                    {entry.city ?? '—'}
                  </td>
                ) : null}
                {!compact ? (
                  <td className="text-muted-foreground py-2 pr-3 text-right tabular-nums">
                    {entry.seed ?? '—'}
                  </td>
                ) : null}
                <td className="py-2 text-right font-medium tabular-nums">
                  {entry.simulationScore.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
