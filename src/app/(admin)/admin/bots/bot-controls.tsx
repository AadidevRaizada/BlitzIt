'use client';

import { useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  addBotsToTournamentAction,
  createBotAction,
  deleteBotAction,
} from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Card } from '@/components/ui/card';
import { SelectField, TextField } from '@/components/ui/field';

/**
 * Bot creation, deletion, and assignment to a test tournament.
 *
 * The two behaviour knobs are the reason this form is worth more than a "how
 * many bots?" number. `submitBehaviour: NEVER` produces a no-show, which is the
 * only way to exercise walkovers and the higher-seed fallback without asking a
 * human tester to sit out a round; `scoreMode: TIE` produces a deliberate
 * deadlock, which is the only way to reach sudden death (D14) on demand rather
 * than waiting for a coincidence that may never occur.
 */
export function CreateBotForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    async (_prev: unknown, formData: FormData) => {
      const result = await createBotAction(_prev, formData);
      if (result.ok) {
        toast.success(`Bot ${result.data.username} created`);
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
      return result;
    },
    null,
  );

  return (
    <Card>
      <form action={action} className="space-y-4">
        <TextField
          name="username"
          label="Handle"
          hint="Lowercase letters, numbers and hyphens. Shown to competitors beside a BOT badge."
          placeholder="practice-bot-1"
          required
        />
        <TextField
          name="displayName"
          label="Display name"
          hint="Optional. Defaults to the handle."
        />
        <TextField
          name="skill"
          label="Skill"
          type="number"
          min={0}
          max={100}
          defaultValue={50}
          hint="Target score band, 0-100. The seeded evaluator centres this bot's scores here, so a field of varied skills produces a predictable pecking order."
        />
        <SelectField
          name="submitBehaviour"
          label="Submission behaviour"
          defaultValue="ALWAYS"
          hint="NEVER makes the bot a no-show, which is how walkovers and double-no-shows get exercised."
          options={[
            { value: 'ALWAYS', label: 'Always submits' },
            { value: 'NEVER', label: 'Never submits (no-show)' },
            { value: 'LATE', label: 'Submits late' },
          ]}
        />
        <SelectField
          name="scoreMode"
          label="Score mode"
          defaultValue="SEEDED"
          hint="TIE forces a deadlock against another TIE bot of the same skill, so sudden death can be validated on demand."
          options={[
            { value: 'SEEDED', label: 'Seeded (varied around skill)' },
            { value: 'FIXED', label: 'Fixed (exactly the skill)' },
            { value: 'TIE', label: 'Tie (forces sudden death)' },
          ]}
        />
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? 'Creating…' : 'Create bot'}
        </Button>
        {state && !state.ok ? (
          <p className="text-destructive text-sm">{state.error.message}</p>
        ) : null}
      </form>
    </Card>
  );
}

export function DeleteBotButton({
  botUserId,
  username,
}: {
  botUserId: string;
  username: string;
}) {
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" className="text-destructive">
          Delete
        </Button>
      }
      title={`Delete ${username}?`}
      description="The bot and every submission, ranking and match slot it holds in past test tournaments are removed permanently. A test tournament is not a permanent record, so nothing of value is lost — but this cannot be undone."
      confirmLabel="Delete bot"
      requireReason
      successMessage="Bot deleted"
      action={() => deleteBotAction(botUserId)}
    />
  );
}

/** Add every listed bot to a test tournament, filling the field toward 8. */
export function AddBotsButton({
  tournamentId,
  botUserIds,
  label,
}: {
  tournamentId: string;
  botUserIds: string[];
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={pending || botUserIds.length === 0}
      aria-busy={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await addBotsToTournamentAction(
            tournamentId,
            botUserIds,
          );
          if (result.ok) {
            // Partial success is the normal case — a bot already registered is
            // skipped, not an error — so the count is reported rather than a
            // bare "done".
            toast.success(
              `${result.data.added} bot(s) added` +
                (result.data.skipped.length
                  ? `, ${result.data.skipped.length} skipped`
                  : ''),
            );
            router.refresh();
          } else {
            toast.error(result.error.message);
          }
        })
      }
    >
      {pending ? 'Adding…' : label}
    </Button>
  );
}
