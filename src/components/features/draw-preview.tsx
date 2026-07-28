import {
  decideBracketSizing,
  MIN_BRACKET_SIZE,
} from '@/server/modules/tournament/config.public';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';

/**
 * What the draw will look like if it is generated right now — shown BEFORE the
 * operator presses "Close simulation and seed".
 *
 * This exists because the failure mode was invisible until it was too late. An
 * operator with two eligible competitors pressed the button and got a single
 * sentence — "only 2 competitor(s) are eligible; the smallest supported bracket
 * needs 8 (D6)" — with no indication of how many were eligible versus
 * registered, what the shortfall was, or what to do about it. The same numbers
 * the guard uses are now on screen the whole time.
 *
 * It reads `decideBracketSizing`, the identical pure function `computeSeeding`
 * calls, so the preview and the outcome cannot disagree.
 */
export function DrawPreview({
  eligibleCount,
  registrations,
  requestedSize,
  thirdPlaceEnabled,
}: {
  eligibleCount: number;
  registrations: number;
  /** An explicit per-tournament override, or null for automatic sizing. */
  requestedSize: number | null;
  thirdPlaceEnabled: boolean;
}) {
  const sizing = decideBracketSizing(eligibleCount, requestedSize);

  return (
    <Card emphasis={sizing.ok ? 'default' : 'live'}>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow tone="muted">Draw preview</Eyebrow>
          {sizing.ok ? (
            <Badge tone="success">Ready to seed</Badge>
          ) : (
            <Badge tone="danger">Cannot generate</Badge>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure label="Eligible" value={eligibleCount} />
          <Figure
            label="Registered"
            value={registrations}
            hint={
              registrations !== eligibleCount
                ? `${registrations - eligibleCount} not competition-eligible`
                : undefined
            }
          />
          <Figure label="Minimum" value={MIN_BRACKET_SIZE} />
          <Figure
            label="Bracket"
            value={sizing.ok ? sizing.bracketSize : '—'}
            hint={requestedSize ? 'set explicitly' : 'automatic'}
          />
        </dl>

        {sizing.ok ? (
          <p className="text-muted-foreground text-sm">
            {sizing.qualifiedCount} competitor
            {sizing.qualifiedCount === 1 ? '' : 's'} enter a{' '}
            {sizing.bracketSize}-slot draw
            {sizing.byeCount > 0
              ? `, leaving ${sizing.byeCount} empty slot${sizing.byeCount === 1 ? '' : 's'}. Seed #1 down to #${sizing.byeCount} receive a bye into the second round — they advance without playing.`
              : ' with every slot filled. No byes.'}
            {sizing.cutCount > 0
              ? ` ${sizing.cutCount} competitor${sizing.cutCount === 1 ? '' : 's'} finish below the cutline — the draw cannot exceed ${sizing.bracketSize}.`
              : ''}
            {thirdPlaceEnabled ? ' A third-place match will be played.' : ''}
          </p>
        ) : sizing.reason === 'BELOW_MINIMUM' ? (
          <div className="space-y-2 text-sm">
            <p>
              <strong>
                {sizing.shortfall} more eligible competitor
                {sizing.shortfall === 1 ? '' : 's'} needed.
              </strong>{' '}
              A draw of fewer than {sizing.minimum} is refused outright — byes
              cannot substitute for competitors, and a bracket that small is not
              a tournament.
            </p>
            <p className="text-muted-foreground">
              Extend registration and reopen the simulation, or cancel this
              tournament. The transition will keep failing until the eligible
              count reaches {sizing.minimum}.
            </p>
          </div>
        ) : (
          <p className="text-sm">
            Bracket size {sizing.requested} is not supported. Choose one of{' '}
            {sizing.supported.join(', ')} in Settings, or clear it for automatic
            sizing.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Figure({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-display text-xl font-bold tabular-nums">{value}</dd>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}
