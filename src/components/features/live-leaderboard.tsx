import Link from 'next/link';
import type { LeaderboardEntry } from '@/server/modules/tournament';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/table';
import { cn } from '@/lib/utils';

export function LiveLeaderboard({
  entries,
  highlightUserId,
  showCity = true,
  compact = false,
  emptyHint,
  broadcast = false,
  pinHighlighted = false,
}: {
  entries: LeaderboardEntry[];
  highlightUserId?: string | null;
  showCity?: boolean;
  compact?: boolean;
  emptyHint?: string;
  broadcast?: boolean;
  pinHighlighted?: boolean;
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

  const highlighted =
    highlightUserId != null
      ? entries.find((entry) => entry.userId === highlightUserId)
      : null;
  const visibleEntries =
    pinHighlighted && highlighted
      ? entries.filter((entry) => entry.userId !== highlighted.userId)
      : entries;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead
          className={broadcast ? 'bg-surface-raised sticky top-0 z-10' : ''}
        >
          <tr className="text-muted-foreground border-border border-b text-left text-xs">
            <th scope="col" className="w-12 py-2 pr-2 font-medium">
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
          {pinHighlighted && highlighted ? (
            <LeaderboardRow
              key={`pinned-${highlighted.userId}`}
              entry={highlighted}
              index={entries.findIndex(
                (entry) => entry.userId === highlighted.userId,
              )}
              mine
              compact={compact}
              showCity={showCity}
              broadcast={broadcast}
            />
          ) : null}
          {visibleEntries.map((entry, index) => (
            <LeaderboardRow
              key={entry.userId}
              entry={entry}
              index={pinHighlighted && highlighted ? index + 1 : index}
              mine={highlightUserId != null && entry.userId === highlightUserId}
              compact={compact}
              showCity={showCity}
              broadcast={broadcast}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeaderboardRow({
  entry,
  index,
  mine,
  compact,
  showCity,
  broadcast,
}: {
  entry: LeaderboardEntry;
  index: number;
  mine: boolean;
  compact: boolean;
  showCity: boolean;
  broadcast: boolean;
}) {
  return (
    <tr
      className={cn(
        'border-border/60 border-b last:border-0',
        mine &&
          (broadcast
            ? 'bg-secondary text-secondary-foreground'
            : 'bg-primary/5'),
      )}
    >
      <td
        className={cn(
          'py-2 pr-2 tabular-nums',
          broadcast ? 'text-xl font-extrabold' : 'text-muted-foreground',
        )}
      >
        {entry.placement ?? index + 1}
      </td>
      <td className="py-2 pr-3">
        <Link
          href={`/u/${entry.username}`}
          className={cn(
            'font-medium hover:underline',
            mine && broadcast
              ? 'text-secondary-foreground'
              : 'hover:text-primary',
          )}
        >
          {entry.displayName ?? entry.username}
        </Link>
        {mine ? (
          <span
            className={cn(
              'ml-1.5 text-xs font-medium',
              broadcast ? 'text-secondary-foreground' : 'text-primary',
            )}
          >
            (you)
          </span>
        ) : null}
        {entry.eliminatedAtStage ? (
          <Badge tone="neutral" className="ml-2">
            out {entry.eliminatedAtStage.replace('_', ' ')}
          </Badge>
        ) : entry.placement === 1 ? (
          <Badge tone="success" className="ml-2">
            champion
          </Badge>
        ) : null}
      </td>
      {!compact && showCity ? (
        <td className="text-muted-foreground py-2 pr-3">
          {entry.city ?? 'none'}
        </td>
      ) : null}
      {!compact ? (
        <td className="text-muted-foreground py-2 pr-3 text-right tabular-nums">
          {entry.seed ?? 'none'}
        </td>
      ) : null}
      <td className="py-2 text-right font-semibold tabular-nums">
        {entry.simulationScore.toFixed(1)}
      </td>
    </tr>
  );
}
