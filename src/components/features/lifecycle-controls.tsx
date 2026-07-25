'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  progressTournamentAction,
  transitionTournamentAction,
} from '@/server/actions/tournament.actions';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CheckboxField } from '@/components/ui/field';
import { TRANSITION_LABEL } from './tournament-status-badge';

/**
 * Lifecycle controls (E5).
 *
 * Renders exactly the transitions the state machine currently permits — the
 * list comes from the server (`availableTransitions`), so the UI can never
 * offer an illegal move. It calls E3's `transitionTournamentAction` and holds
 * no rules of its own.
 *
 * `force` skips the BUSINESS guards only (minimum registrations, round
 * completion). An illegal transition is refused regardless, which is why the
 * checkbox is safe to expose to an operator at all.
 */
export function LifecycleControls({
  tournamentId,
  transitions,
  canCancel = true,
  compact = false,
}: {
  tournamentId: string;
  transitions: readonly string[];
  canCancel?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [force, setForce] = useState(false);

  const run = (transition: string) =>
    startTransition(async () => {
      const result = await transitionTournamentAction({
        tournamentId,
        transition,
        force,
      });
      if (result.ok) {
        toast.success(
          result.data.applied
            ? `${TRANSITION_LABEL[transition] ?? transition} → ${result.data.to}`
            : 'Already applied — nothing to do',
        );
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });

  if (transitions.length === 0 && !canCancel) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {transitions.map((transition, index) => (
          <Button
            key={transition}
            size={compact ? 'sm' : 'md'}
            // One primary action per view: the first available transition is
            // the thing the operator almost certainly came here to do.
            variant={index === 0 ? 'primary' : 'secondary'}
            disabled={pending}
            aria-busy={pending}
            onClick={() => run(transition)}
          >
            {TRANSITION_LABEL[transition] ?? transition}
          </Button>
        ))}

        {!compact ? (
          <Button
            size="md"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await progressTournamentAction(tournamentId);
                if (result.ok) {
                  toast.success(
                    `Progress pass: ${result.data.decided} match(es) decided${
                      result.data.completed ? ' — tournament complete' : ''
                    }`,
                  );
                  router.refresh();
                } else {
                  toast.error(result.error.message);
                }
              })
            }
          >
            Run progress pass
          </Button>
        ) : null}

        {canCancel && !compact ? (
          <ConfirmDialog
            trigger={
              <Button variant="danger" size="md" disabled={pending}>
                Cancel tournament
              </Button>
            }
            title="Cancel this tournament?"
            description="Cancelling is terminal — the tournament cannot be resumed afterwards. Competitors' submissions and evaluations are kept."
            confirmLabel="Cancel tournament"
            requireReason
            reasonLabel="Reason for cancellation"
            successMessage="Tournament cancelled"
            action={(reason) =>
              transitionTournamentAction({
                tournamentId,
                transition: 'CANCEL',
                reason,
              })
            }
          />
        ) : null}
      </div>

      {!compact ? (
        <CheckboxField
          label="Force (skip business guards)"
          hint="Bypasses checks like minimum registrations or round completion. The state machine itself is never bypassed — an illegal transition is still refused."
          checked={force}
          onChange={(event) => setForce(event.target.checked)}
        />
      ) : null}
    </div>
  );
}
