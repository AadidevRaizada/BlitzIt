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
import { Eyebrow } from '@/components/ui/eyebrow';
import { formatIst } from '@/components/ui/page-header';

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
 *
 * ## These buttons are overrides now
 *
 * The schedule drives the lifecycle (`schedule.public.ts`), so the transition
 * the clock is going to fire anyway is not the operator's job — it is a thing
 * they may want to do EARLY. Presenting it as the page's primary action taught
 * the operator that the tournament needed babysitting, which was true before
 * and is not now. The automatic step is announced, and its button is demoted
 * out of the primary slot and relabelled so pressing it reads as impatience
 * rather than obligation.
 */
export function LifecycleControls({
  tournamentId,
  transitions,
  canCancel = true,
  compact = false,
  automatic = null,
}: {
  tournamentId: string;
  transitions: readonly string[];
  canCancel?: boolean;
  compact?: boolean;
  /**
   * The step the schedule will fire on its own, if any. Serialised as an ISO
   * string because this is a client component and Dates do not survive the
   * boundary intact.
   */
  automatic?: {
    transition: string;
    label: string;
    dueAt: string | null;
  } | null;
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

  const dueAt = automatic?.dueAt ? new Date(automatic.dueAt) : null;
  const overdue = dueAt !== null && dueAt.getTime() <= Date.now();

  return (
    <div className="space-y-3">
      {automatic && !compact ? (
        <div className="border-border bg-muted/30 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border px-3 py-2 text-sm">
          <Eyebrow tone="primary">Automatic</Eyebrow>
          <span className="font-medium">{automatic.label}</span>
          <span className="text-muted-foreground">
            {dueAt === null
              ? 'runs as soon as the guards allow — no action needed'
              : overdue
                ? 'is due now; the scheduler runs within 30 seconds'
                : `at ${formatIst(dueAt)} — no action needed`}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {transitions.map((transition) => {
          const isAutomatic = automatic?.transition === transition;
          return (
            <Button
              key={transition}
              size={compact ? 'sm' : 'md'}
              // Nothing here is primary any more. The transition the schedule
              // is about to fire is an override, and the others are off-path
              // by definition.
              variant="secondary"
              disabled={pending}
              aria-busy={pending}
              onClick={() => run(transition)}
              title={
                isAutomatic
                  ? 'This runs on the schedule. Pressing it only makes it happen sooner.'
                  : undefined
              }
            >
              {isAutomatic
                ? `${TRANSITION_LABEL[transition] ?? transition} now`
                : (TRANSITION_LABEL[transition] ?? transition)}
            </Button>
          );
        })}

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
