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
  leadScore,
}: {
  entries: LeaderboardEntry[];
  highlightUserId?: string | null;
  showCity?: boolean;
  compact?: boolean;
  emptyHint?: string;
  broadcast?: boolean;
  pinHighlighted?: boolean;
  /**
   * The top score in the field. When supplied, each row draws a bar behind its
   * score showing how it stands against the leader — the gap between #4 and #5
   * is the story a column of numbers hides.
   */
  leadScore?: number;
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
        {/*
         * Not sticky. The header only ever stuck to the top of the standings'
         * own scroll box; without that box there is nothing for it to stick to
         * but the viewport, where it would collide with the sort bar already
         * pinned there.
         */}
        <thead className={broadcast ? 'bg-surface-raised' : ''}>
          <tr className="text-eyebrow text-muted-foreground border-border border-b text-left font-mono font-semibold uppercase">
            <th scope="col" className="w-14 py-3 pr-2 pl-4 font-semibold">
              #
            </th>
            <th scope="col" className="py-3 pr-3 font-semibold">
              Competitor
            </th>
            {!compact && showCity ? (
              <th scope="col" className="py-3 pr-3 font-semibold">
                City
              </th>
            ) : null}
            {!compact ? (
              <th scope="col" className="py-3 pr-3 text-right font-semibold">
                Seed
              </th>
            ) : null}
            <th scope="col" className="py-3 pr-4 text-right font-semibold">
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
              leadScore={leadScore}
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
              leadScore={leadScore}
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
  leadScore,
}: {
  entry: LeaderboardEntry;
  index: number;
  mine: boolean;
  compact: boolean;
  showCity: boolean;
  broadcast: boolean;
  leadScore?: number;
}) {
  const rank = entry.placement ?? index + 1;
  const share =
    leadScore && leadScore > 0
      ? Math.max(4, Math.min(100, (entry.simulationScore / leadScore) * 100))
      : null;

  return (
    <tr
      className={cn(
        'border-border/60 border-b last:border-0',
        'hover:bg-primary/5 transition-colors duration-[var(--motion-fast)]',
        // Your own row is marked with a tint and a rule rather than a solid
        // blue slab: a fully inverted row fights the rest of the table for
        // attention and makes the ranking harder to scan, which is the one
        // thing a leaderboard must be good at.
        mine && 'bg-primary/10 shadow-[inset_2px_0_0_0_var(--color-primary)]',
      )}
    >
      <td
        className={cn(
          'py-2.5 pr-2 pl-4 font-mono tabular-nums',
          broadcast ? 'text-lg font-bold' : 'text-muted-foreground',
          // The three that matter read as the three that matter, without a
          // medal graphic in a table.
          broadcast && rank <= 3 && 'text-primary',
        )}
      >
        {broadcast ? String(rank).padStart(2, '0') : rank}
      </td>
      <td className="py-2.5 pr-3">
        <Link
          href={`/u/${entry.username}`}
          className={cn(
            'font-medium hover:underline',
            mine ? 'text-foreground' : 'hover:text-primary',
          )}
        >
          {entry.displayName ?? entry.username}
        </Link>
        {mine ? (
          <span className="text-primary ml-1.5 font-mono text-xs font-semibold">
            you
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
        <td className="text-muted-foreground py-2.5 pr-3">
          {entry.city ?? '—'}
        </td>
      ) : null}
      {!compact ? (
        <td className="text-muted-foreground py-2.5 pr-3 text-right font-mono tabular-nums">
          {entry.seed ?? '—'}
        </td>
      ) : null}
      <td className="py-2.5 pr-4 text-right">
        <span className="font-mono font-bold tabular-nums">
          {entry.simulationScore.toFixed(1)}
        </span>
        {share !== null ? (
          <span
            aria-hidden
            className="bg-surface-elevated mt-1.5 ml-auto block h-0.5 w-20 overflow-hidden rounded-full"
          >
            <span
              className={cn(
                'block h-full origin-left rounded-full',
                'animate-[var(--animate-meter-in)]',
                mine ? 'bg-primary' : 'bg-primary/45',
              )}
              style={{ width: `${share}%` }}
            />
          </span>
        ) : null}
      </td>
    </tr>
  );
}
