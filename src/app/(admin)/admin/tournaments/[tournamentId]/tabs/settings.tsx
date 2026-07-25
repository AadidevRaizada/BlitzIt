'use client';

import { useActionState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  archiveTournamentAction,
  updatePrizePoolAdminAction,
  updateTournamentAdminAction,
} from '@/server/actions/admin.actions';
import type { TournamentSummary } from '@/server/modules/tournament';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SelectField, TextAreaField, TextField } from '@/components/ui/field';
import { SectionTitle } from '@/components/ui/page-header';
import type { Result } from '@/lib/errors';
import { ScheduleForm } from './schedule-form';

type State = Result<{ id: string }> | Result<{ archived: boolean }> | null;

/**
 * Settings tab (E5).
 *
 * Uses existing admin actions so all validation, auditing, and lifecycle
 * restrictions remain in modules. No direct Prisma writes from the UI.
 */
export function SettingsTab({ summary }: { summary: TournamentSummary }) {
  const router = useRouter();
  const updateAction = updateTournamentAdminAction.bind(null, summary.id);
  const prizeAction = updatePrizePoolAdminAction.bind(null, summary.id);

  const [updateState, updateFormAction, updating] = useActionState<
    State,
    FormData
  >(updateAction, null);
  const [prizeState, prizeFormAction, prizePending] = useActionState<
    State,
    FormData
  >(prizeAction, null);

  useEffect(() => {
    for (const state of [updateState, prizeState]) {
      if (!state) continue;
      if (state.ok) {
        toast.success('Tournament settings saved');
        router.refresh();
      } else {
        toast.error(state.error.message);
      }
    }
  }, [updateState, prizeState, router]);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-6">
        <section className="space-y-3">
          <SectionTitle>Basics</SectionTitle>
          <Card>
            <CardContent>
              <form
                action={updateFormAction}
                className="grid gap-4 md:grid-cols-2"
              >
                <TextField
                  name="name"
                  label="Name"
                  defaultValue={summary.name}
                  required
                />
                <SelectField
                  name="visibility"
                  label="Visibility"
                  defaultValue={summary.visibility}
                  options={[
                    { value: 'PUBLIC', label: 'Public' },
                    { value: 'UNLISTED', label: 'Unlisted' },
                  ]}
                />
                <TextAreaField
                  name="description"
                  label="Description"
                  defaultValue={summary.description ?? ''}
                  className="md:col-span-2"
                />
                <TextField
                  name="bracketSize"
                  label="Bracket size"
                  type="number"
                  defaultValue={summary.bracketSize ?? ''}
                />
                <TextField
                  name="minRegistrations"
                  label="Minimum registrations"
                  type="number"
                  defaultValue={summary.minRegistrations ?? ''}
                />
                <TextField
                  name="maxRegistrations"
                  label="Maximum registrations"
                  type="number"
                  defaultValue={summary.maxRegistrations ?? ''}
                />
                <TextField
                  name="passPriceMinor"
                  label="Pass price (minor units)"
                  type="number"
                  defaultValue={summary.passPriceMinor}
                />
                <div className="md:col-span-2">
                  <Button
                    type="submit"
                    disabled={updating}
                    aria-busy={updating}
                  >
                    Save tournament
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <SectionTitle>Schedule</SectionTitle>
          <ScheduleForm
            tournamentId={summary.id}
            initial={{
              registrationOpensAt: summary.registrationOpensAt,
              registrationClosesAt: summary.registrationClosesAt,
              simulationOpensAt: summary.simulationOpensAt,
              simulationClosesAt: summary.simulationClosesAt,
              liveStartsAt: summary.liveStartsAt,
            }}
          />
        </section>

        <section className="space-y-3">
          <SectionTitle>Prize pool</SectionTitle>
          <Card>
            <CardContent>
              <form
                action={prizeFormAction}
                className="grid gap-4 md:grid-cols-3"
              >
                <TextField
                  name="basePrizePoolMinor"
                  label="Base pool"
                  type="number"
                />
                <TextField
                  name="prizePerRegistrationMinor"
                  label="Per registration"
                  type="number"
                />
                <TextField
                  name="firstPrizeCapMinor"
                  label="First prize cap"
                  type="number"
                />
                <div className="md:col-span-3">
                  <Button
                    type="submit"
                    disabled={prizePending}
                    aria-busy={prizePending}
                  >
                    Save prize settings
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </section>
      </div>

      <aside className="space-y-3">
        <SectionTitle>Archive</SectionTitle>
        <Card>
          <CardContent className="space-y-3">
            <p className="text-muted-foreground text-sm">
              Archiving hides completed or cancelled tournaments from the
              default admin lists. It does not change lifecycle state.
            </p>
            <ArchiveButton
              tournamentId={summary.id}
              archived={summary.archivedAt !== null}
            />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function ArchiveButton({
  tournamentId,
  archived,
}: {
  tournamentId: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Button
      type="button"
      variant={archived ? 'secondary' : 'danger'}
      disabled={pending}
      aria-busy={pending}
      onClick={() =>
        start(async () => {
          const result = await archiveTournamentAction(tournamentId, !archived);
          if (result.ok) {
            toast.success(
              result.data.archived
                ? 'Tournament archived'
                : 'Tournament restored',
            );
            router.refresh();
          } else {
            toast.error(result.error.message);
          }
        })
      }
    >
      {archived ? 'Restore tournament' : 'Archive tournament'}
    </Button>
  );
}
