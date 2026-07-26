'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { configureTournamentAdminAction } from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';
import {
  CheckboxField,
  FormError,
  TextAreaField,
  TextField,
} from '@/components/ui/field';
import { Card, CardContent } from '@/components/ui/card';
import {
  DEFAULT_SIMULATION_DURATIONS,
  DEFAULT_STAGE_DURATIONS,
} from '@/server/modules/tournament/config.public';
import { RETIMEABLE_STAGES } from '@/lib/validation/admin.schema';
import type { Result } from '@/lib/errors';

type State = Result<{ id: string }> | null;

/** `Tournament.roundDurations` as stored — read defensively, it is free-form JSON. */
interface StoredDurations {
  simulation?: unknown;
  stages?: unknown;
}

function readSimulation(value: unknown, index: number): string {
  const simulation = (value as StoredDurations | null)?.simulation;
  if (!Array.isArray(simulation)) return '';
  const seconds = simulation[index];
  return typeof seconds === 'number' ? String(seconds) : '';
}

function readStage(value: unknown, stage: string): string {
  const stages = (value as StoredDurations | null)?.stages;
  if (typeof stages !== 'object' || stages === null) return '';
  const seconds = (stages as Record<string, unknown>)[stage];
  return typeof seconds === 'number' ? String(seconds) : '';
}

const minutes = (seconds: number) => `${Math.round(seconds / 60)} min`;

/**
 * Tournament configuration (E5 follow-up).
 *
 * Exposes the three settings the backend already supported but no form reached:
 * the third-place play-off (D6), per-round durations (D7) and stage evaluation
 * profiles (D20).
 *
 * Durations are entered in SECONDS, matching what is stored. Minutes would read
 * more naturally but would round-trip lossily for any value that is not a whole
 * minute, silently rewriting an operator's setting; the default is shown in
 * minutes in each hint instead.
 *
 * Blank means "use the default" — the module treats a missing override as
 * absent, so clearing a field restores the deployment default rather than
 * writing a zero.
 */
export function ConfigurationForm({
  tournamentId,
  roundDurations,
  evaluationProfiles,
  thirdPlaceEnabled,
  bracketGenerated,
}: {
  tournamentId: string;
  roundDurations: unknown;
  evaluationProfiles: unknown;
  thirdPlaceEnabled: boolean;
  bracketGenerated: boolean;
}) {
  const router = useRouter();
  const action = configureTournamentAdminAction.bind(null, tournamentId);
  const [state, formAction, pending] = useActionState<State, FormData>(
    action,
    null,
  );

  useEffect(() => {
    if (state?.ok) {
      toast.success('Configuration saved');
      router.refresh();
    }
  }, [state, router]);

  const profilesJson =
    evaluationProfiles && Object.keys(evaluationProfiles).length > 0
      ? JSON.stringify(evaluationProfiles, null, 2)
      : '';

  return (
    <Card>
      <CardContent className="pt-4">
        <form action={formAction} className="space-y-6">
          <div className="space-y-2">
            <div>
              <input type="hidden" name="thirdPlaceEnabled" value="false" />
              <CheckboxField
                name="thirdPlaceEnabled"
                label="Third-place play-off"
                hint="The losing semi-finalists play off between the semi-finals and the final (D6)."
                defaultChecked={thirdPlaceEnabled}
                disabled={bracketGenerated}
                value="true"
              />
            </div>
            {bracketGenerated ? (
              <p className="text-muted-foreground text-xs">
                The bracket has been generated, so its shape is frozen — the
                play-off can no longer be toggled.
              </p>
            ) : null}
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              Round durations (seconds)
            </legend>
            <p className="text-muted-foreground text-xs">
              Leave a field blank to use the deployment default (D7). Stored in
              seconds; the default for each is shown beside it.
            </p>

            <div className="grid gap-4 sm:grid-cols-3">
              {DEFAULT_SIMULATION_DURATIONS.map((fallback, index) => (
                <TextField
                  key={`simulation-${index}`}
                  name={`simulationDuration${index + 1}`}
                  label={`Simulation round ${index + 1}`}
                  type="number"
                  min={30}
                  placeholder={String(fallback)}
                  hint={`Default ${fallback} (${minutes(fallback)})`}
                  defaultValue={readSimulation(roundDurations, index)}
                />
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {RETIMEABLE_STAGES.map((stage) => {
                const fallback = DEFAULT_STAGE_DURATIONS[stage];
                return (
                  <TextField
                    key={stage}
                    name={`stageDuration${stage}`}
                    label={stage.replace('_', ' ')}
                    type="number"
                    min={30}
                    placeholder={String(fallback)}
                    hint={
                      stage === 'SUDDEN_DEATH'
                        ? // Not a stage of the bracket: the decider that
                          // unsticks a tie at any stage (D14).
                          `Tie decider · default ${fallback} (${minutes(fallback)})`
                        : `Default ${fallback} (${minutes(fallback)})`
                    }
                    defaultValue={readStage(roundDurations, stage)}
                  />
                );
              })}
            </div>
          </fieldset>

          <TextAreaField
            name="evaluationProfiles"
            label="Evaluation profiles (D20)"
            rows={8}
            defaultValue={profilesJson}
            hint='JSON: {"stages":{"QF":"full"},"profiles":{…}}. Leave empty for the built-in policy — deterministic through the quarter-finals, AI from the semi-finals. Invalid JSON is rejected here; a structurally valid but unscorable profile falls back at scoring time.'
            className="font-mono"
          />

          {state && !state.ok ? (
            <FormError message={state.error.message} />
          ) : null}

          <Button
            type="submit"
            variant="primary"
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? 'Saving…' : 'Save configuration'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
