'use client';

import { finishRoundEarlyAction } from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Finish an open round early. Test tournaments only (D35).
 *
 * Rendered only when the tournament is in the TEST environment, but the button's
 * absence is presentation, not enforcement — `finishRoundEarly` refuses a
 * production round regardless of who calls it and from where.
 */
export function FinishRoundEarlyControl({
  roundId,
  tournamentId,
  stage,
}: {
  roundId: string;
  tournamentId: string;
  stage: string;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="secondary">
          Finish now
        </Button>
      }
      title={`Finish ${stage.replace('_', ' ')} now?`}
      description="The round closes immediately and is judged on whatever has been submitted so far. Anyone who has not submitted is treated as a no-show, exactly as they would be if the deadline had passed on its own — a match with one entry is a walkover, and a match with none falls to the higher seed. This cannot be undone."
      confirmLabel="Finish round"
      variant="secondary"
      requireReason
      successMessage="Round closed; advancement queued"
      action={() => finishRoundEarlyAction(roundId, tournamentId)}
    />
  );
}
