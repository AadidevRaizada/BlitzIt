import type { BracketRoundView } from '@/server/modules/tournament';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Screen [11] — the bracket tree (E6.4).
 *
 * One column per round, each match a card. A server component with no client
 * JavaScript: the bracket is a read model, and the live-updating version
 * arrives with SSE in a later epic.
 *
 * Rounds scroll horizontally inside their own container so a 64-slot bracket
 * never makes the page itself scroll sideways.
 */

const MATCH_TONE: Record<string, BadgeTone> = {
  PENDING: 'neutral',
  LIVE: 'brand',
  JUDGING: 'info',
  DECIDED: 'success',
};

const WIN_REASON_LABEL: Record<string, string> = {
  SCORE: 'on score',
  TIEBREAK_FUNCTIONAL: 'on functional',
  TIEBREAK_TESTS: 'on tests passed',
  TIEBREAK_TIME: 'on submission time',
  TIEBREAK_PERFORMANCE: 'on performance',
  TIEBREAK_AI: 'on AI score',
  SUDDEN_DEATH: 'by sudden death',
  BYE: 'bye',
  WALKOVER: 'walkover',
  ADMIN: 'by admin',
};

export function BracketTree({
  rounds,
  highlightUserId,
  emptyHint,
}: {
  rounds: BracketRoundView[];
  /** Renders this competitor's path prominently — "my path" on the public page. */
  highlightUserId?: string | null;
  emptyHint?: string;
}) {
  const playable = rounds.filter((round) => round.matches.length > 0);

  if (playable.length === 0) {
    return (
      <EmptyState
        title="No bracket yet"
        hint={
          emptyHint ??
          'The bracket is built once the simulation rounds are scored and the field is seeded.'
        }
      />
    );
  }

  // Sudden-death rounds are shown last: they settle a tie belonging to an
  // earlier stage rather than being a stage of their own.
  const ordered = [
    ...playable.filter((round) => round.stage !== 'SUDDEN_DEATH'),
    ...playable.filter((round) => round.stage === 'SUDDEN_DEATH'),
  ];

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-4">
        {ordered.map((round) => (
          <section
            key={round.id}
            className="w-64 shrink-0 space-y-2"
            aria-label={`${round.stage} matches`}
          >
            <header className="space-y-0.5">
              <h3 className="text-sm font-semibold">
                {round.stage.replace('_', ' ')}
              </h3>
              <p className="text-muted-foreground text-xs">
                {round.matches.filter((m) => m.status === 'DECIDED').length}/
                {round.matches.length} decided
                {round.problem ? ` · ${round.problem.title}` : ''}
              </p>
            </header>

            <ol className="space-y-2">
              {round.matches.map((match) => {
                const mine =
                  highlightUserId != null &&
                  (match.competitorAId === highlightUserId ||
                    match.competitorBId === highlightUserId);

                return (
                  <li
                    key={match.id}
                    className={cn(
                      'bg-card rounded-lg border p-2.5 text-sm',
                      mine
                        ? 'border-primary ring-primary/30 ring-1'
                        : 'border-border',
                    )}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-muted-foreground text-xs">
                        #{match.bracketPosition + 1}
                      </span>
                      <div className="flex items-center gap-1">
                        {match.tieUnresolved ? (
                          <Badge tone="warning">Tied</Badge>
                        ) : null}
                        <Badge tone={MATCH_TONE[match.status] ?? 'neutral'}>
                          {match.status}
                        </Badge>
                      </div>
                    </div>

                    <Competitor
                      name={match.competitorA}
                      seed={match.seedA}
                      isWinner={
                        match.status === 'DECIDED' &&
                        match.winner != null &&
                        match.winner === match.competitorA
                      }
                      isMe={
                        highlightUserId != null &&
                        match.competitorAId === highlightUserId
                      }
                      decided={match.status === 'DECIDED'}
                    />
                    <Competitor
                      name={match.competitorB}
                      seed={match.seedB}
                      isWinner={
                        match.status === 'DECIDED' &&
                        match.winner != null &&
                        match.winner === match.competitorB
                      }
                      isMe={
                        highlightUserId != null &&
                        match.competitorBId === highlightUserId
                      }
                      decided={match.status === 'DECIDED'}
                    />

                    {match.status === 'DECIDED' && match.winReason ? (
                      <p className="text-muted-foreground mt-1.5 text-xs">
                        Won{' '}
                        {WIN_REASON_LABEL[match.winReason] ?? match.winReason}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

function Competitor({
  name,
  seed,
  isWinner,
  isMe,
  decided,
}: {
  name: string | null;
  seed: number | null;
  isWinner: boolean;
  isMe: boolean;
  decided: boolean;
}) {
  if (!name) {
    return (
      <p className="text-muted-foreground py-0.5 text-xs italic">
        {decided ? '—' : 'awaiting winner'}
      </p>
    );
  }

  return (
    <p
      className={cn(
        'flex items-baseline justify-between gap-2 py-0.5',
        // A decided match dims the loser rather than colouring the winner, so
        // the outcome reads at a glance without adding another accent.
        decided && !isWinner && 'text-muted-foreground line-through',
        isWinner && 'font-semibold',
      )}
    >
      <span className="truncate">
        {name}
        {isMe ? (
          <span className="text-primary ml-1 text-xs font-medium">(you)</span>
        ) : null}
      </span>
      {seed != null ? (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          #{seed}
        </span>
      ) : null}
    </p>
  );
}
