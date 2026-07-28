'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { updateScheduleAdminAction } from '@/server/actions/admin.actions';
import { Button } from '@/components/ui/button';
import { FormError, TextField } from '@/components/ui/field';
import { Badge } from '@/components/ui/badge';
import { Eyebrow } from '@/components/ui/eyebrow';
import { toDateTimeLocal } from '@/components/ui/page-header';
import type { Result } from '@/lib/errors';
import { cn } from '@/lib/utils';

type State = Result<{ id: string }> | null;

/**
 * Schedule editor (E5).
 *
 * `datetime-local` inputs carry no timezone, so these are rendered from — and
 * parsed back as — **IST**, and labelled as such. The Zod schema pins the
 * offset explicitly rather than letting `new Date()` apply the server's local
 * offset, which would shift every schedule by the deployment's timezone.
 *
 * Storage is still UTC. Only what the operator sees and types is IST.
 *
 * ## Why this is a controlled form
 *
 * It used to be five uncontrolled `datetime-local` fields that submitted
 * straight to the server. Every ordering mistake — and they are easy to make,
 * because the fields are adjacent and look interchangeable — came back as one
 * sentence after a round trip, with the rest of the form's errors invisible
 * until the first was fixed. Worse, nothing on screen showed what the schedule
 * MEANT: an operator could save a registration window of four minutes and only
 * discover it when competitors could not register.
 *
 * So the state lives here. Each field constrains the next through `min`, the
 * whole chain is validated as you type, and a projected timeline sits under the
 * form showing the actual shape of the event. The server schema is unchanged
 * and still authoritative — this is a second, earlier check, not a replacement.
 */

/** The five stored schedule anchors, in the order they must occur. */
const FIELDS = [
  {
    name: 'registrationOpensAt',
    label: 'Registration opens',
    hint: 'Competitors can sign up from this moment.',
  },
  {
    name: 'registrationClosesAt',
    label: 'Registration closes',
    hint: 'The field is frozen. Nobody joins after this.',
  },
  {
    name: 'simulationOpensAt',
    label: 'Simulation opens',
    hint: 'Simulation round 1 becomes available.',
  },
  {
    name: 'simulationClosesAt',
    label: 'Simulation closes',
    hint: 'Seeding runs on the scores collected up to here.',
  },
  {
    name: 'liveStartsAt',
    label: 'Knockout starts',
    hint: 'The bracket goes live. Byes are already resolved.',
  },
] as const;

type FieldName = (typeof FIELDS)[number]['name'];
type Values = Record<FieldName, string>;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Offsets from "now", in milliseconds, for each anchor.
 *
 * Presets populate the form and then get out of the way — every field stays
 * editable afterwards, and editing one does not revert to "Custom" silently;
 * the chip simply stops being highlighted.
 */
const PRESETS = [
  {
    id: 'local',
    label: 'Local testing',
    description: 'Everything inside an hour. For poking at the flow.',
    offsets: [0, 5 * MINUTE, 6 * MINUTE, 36 * MINUTE, 40 * MINUTE],
  },
  {
    id: 'demo',
    label: 'Demo',
    description: 'A single afternoon, wide enough to narrate.',
    offsets: [0, 30 * MINUTE, 35 * MINUTE, 2 * HOUR + 35 * MINUTE, 3 * HOUR],
  },
  {
    id: 'weekly',
    label: 'Weekly tournament',
    description: 'The default cadence: five days of registration, then play.',
    offsets: [0, 5 * DAY, 5 * DAY + HOUR, 5 * DAY + 3 * HOUR, 6 * DAY],
  },
] as const;

function istLocalValue(date: Date): string {
  return toDateTimeLocal(date);
}

/** Parse a `datetime-local` string as IST — the mirror of `istDateTime`. */
function parseIst(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(`${value.slice(0, 16)}:00+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const days = Math.floor(ms / DAY);
  const hours = Math.floor((ms % DAY) / HOUR);
  const minutes = Math.round((ms % HOUR) / MINUTE);
  return (
    [
      days > 0 ? `${days}d` : null,
      hours > 0 ? `${hours}h` : null,
      minutes > 0 ? `${minutes}m` : null,
    ]
      .filter(Boolean)
      .join(' ') || '0m'
  );
}

function formatIstLabel(date: Date): string {
  return `${new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  }).format(date)} IST`;
}

export function ScheduleForm({
  tournamentId,
  initial,
}: {
  tournamentId: string;
  initial: {
    registrationOpensAt: Date | null;
    registrationClosesAt: Date | null;
    simulationOpensAt: Date | null;
    simulationClosesAt: Date | null;
    liveStartsAt: Date | null;
  };
}) {
  const router = useRouter();
  const action = updateScheduleAdminAction.bind(null, tournamentId);
  const [state, formAction, pending] = useActionState<State, FormData>(
    action,
    null,
  );

  const [values, setValues] = useState<Values>(() => ({
    registrationOpensAt: toDateTimeLocal(initial.registrationOpensAt),
    registrationClosesAt: toDateTimeLocal(initial.registrationClosesAt),
    simulationOpensAt: toDateTimeLocal(initial.simulationOpensAt),
    simulationClosesAt: toDateTimeLocal(initial.simulationClosesAt),
    liveStartsAt: toDateTimeLocal(initial.liveStartsAt),
  }));
  const [appliedPreset, setAppliedPreset] = useState<string | null>(null);

  useEffect(() => {
    if (state?.ok) {
      toast.success('Schedule saved');
      router.refresh();
    }
  }, [state, router]);

  const parsed = useMemo(
    () =>
      FIELDS.map((field) => ({
        ...field,
        date: parseIst(values[field.name]),
      })),
    [values],
  );

  /**
   * Errors keyed by field. Mirrors the four adjacent-pair refinements in
   * `scheduleFormSchema` — deliberately the same rules in the same order, so
   * an operator never sees the client pass and the server reject.
   */
  const errors = useMemo(() => {
    const found: Partial<Record<FieldName, string>> = {};
    for (let i = 1; i < parsed.length; i++) {
      const previous = parsed[i - 1]!;
      const current = parsed[i]!;
      if (!previous.date || !current.date) continue;
      if (current.date.getTime() <= previous.date.getTime()) {
        found[current.name] =
          `Must be after ${previous.label.toLowerCase()} (${formatIstLabel(previous.date)}).`;
      }
    }
    return found;
  }, [parsed]);

  const filled = parsed.filter((entry) => entry.date !== null);
  const invalid = Object.keys(errors).length > 0;

  function applyPreset(preset: (typeof PRESETS)[number]) {
    const now = Date.now();
    const next = {} as Values;
    FIELDS.forEach((field, index) => {
      next[field.name] = istLocalValue(
        new Date(now + (preset.offsets[index] ?? 0)),
      );
    });
    setValues(next);
    setAppliedPreset(preset.id);
  }

  function setField(name: FieldName, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
    setAppliedPreset(null);
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <Eyebrow tone="muted">Start from a preset</Eyebrow>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => applyPreset(preset)}
              title={preset.description}
              className={cn(
                'focus-visible:ring-ring rounded-md border px-3 py-1.5 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                appliedPreset === preset.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border hover:border-primary/50 hover:bg-muted',
              )}
            >
              <span className="font-medium">{preset.label}</span>
              <span className="text-muted-foreground block text-xs">
                {preset.description}
              </span>
            </button>
          ))}
        </div>
        <p className="text-muted-foreground text-xs">
          Presets are anchored to the moment you click them and remain fully
          editable afterwards. Nothing is saved until you press Save.
        </p>
      </section>

      <form action={formAction} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((field, index) => {
            // Each field's floor is the field before it. The browser enforces
            // this on the picker itself, so most invalid schedules are simply
            // unreachable rather than merely reported.
            const previous = index > 0 ? parsed[index - 1]! : null;
            const min = previous?.date
              ? istLocalValue(new Date(previous.date.getTime() + MINUTE))
              : undefined;

            return (
              <TextField
                key={field.name}
                name={field.name}
                label={`${field.label} (IST)`}
                type="datetime-local"
                value={values[field.name]}
                onChange={(event) => setField(field.name, event.target.value)}
                min={min}
                error={errors[field.name]}
                hint={field.hint}
                className={
                  field.name === 'liveStartsAt' ? 'sm:col-span-2' : undefined
                }
              />
            );
          })}
        </div>

        <TimelinePreview entries={parsed} />

        {invalid ? (
          <FormError
            message={`${Object.keys(errors).length} field(s) are out of order. Each stage must begin after the one before it.`}
          />
        ) : null}
        {state && !state.ok ? (
          <FormError message={state.error.message} />
        ) : null}

        <Button
          type="submit"
          variant="primary"
          disabled={pending || invalid}
          aria-busy={pending}
        >
          {pending ? 'Saving…' : 'Save schedule'}
        </Button>
        {invalid ? (
          <p className="text-muted-foreground text-xs">
            Saving is blocked until the ordering is fixed — the server would
            reject it anyway.
          </p>
        ) : filled.length < FIELDS.length ? (
          <p className="text-muted-foreground text-xs">
            {FIELDS.length - filled.length} anchor(s) still unset. A tournament
            can be saved part-scheduled, but the lifecycle transitions that
            depend on them will not fire.
          </p>
        ) : null}
      </form>
    </div>
  );
}

/**
 * The schedule as an event rather than five numbers.
 *
 * This is a PROJECTION, not a second source of truth. Only the five anchors are
 * stored; individual round windows are opened relative to the moment the
 * previous round completes, so their exact times cannot be known in advance and
 * are deliberately not shown here. What it does show is the thing that was
 * impossible to see before: how long each phase actually lasts.
 */
function TimelinePreview({
  entries,
}: {
  entries: Array<{ name: FieldName; label: string; date: Date | null }>;
}) {
  const known = entries.filter(
    (entry): entry is { name: FieldName; label: string; date: Date } =>
      entry.date !== null,
  );

  if (known.length < 2) {
    return (
      <div className="border-border rounded-lg border border-dashed p-4">
        <p className="text-muted-foreground text-sm">
          Set at least two anchors to preview the timeline.
        </p>
      </div>
    );
  }

  const now = Date.now();
  const total =
    known[known.length - 1]!.date.getTime() - known[0]!.date.getTime();

  return (
    <div className="border-border bg-muted/30 space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow tone="muted">Projected timeline</Eyebrow>
        <span className="text-muted-foreground text-xs tabular-nums">
          {formatDuration(total)} end to end
        </span>
      </div>

      <ol className="space-y-2">
        {known.map((entry, index) => {
          const previous = index > 0 ? known[index - 1]! : null;
          const gap = previous
            ? entry.date.getTime() - previous.date.getTime()
            : null;
          const past = entry.date.getTime() < now;

          return (
            <li key={entry.name} className="flex items-baseline gap-3 text-sm">
              <span
                className={cn(
                  'mt-1.5 size-2 shrink-0 rounded-full',
                  past ? 'bg-muted-foreground/40' : 'bg-primary',
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{entry.label}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {formatIstLabel(entry.date)}
                  </span>
                </div>
                {gap !== null ? (
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {formatDuration(gap)} after {previous!.label.toLowerCase()}
                    {gap < 5 * MINUTE ? ' — very short' : ''}
                  </p>
                ) : past ? (
                  <p className="text-muted-foreground text-xs">
                    already in the past
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {known[0]!.date.getTime() < now ? (
        <div className="flex items-start gap-2">
          <Badge tone="warning">Past</Badge>
          <p className="text-muted-foreground text-xs">
            This schedule begins in the past. Transitions are operator-driven,
            so nothing has fired retroactively — but the countdowns competitors
            see will already have elapsed.
          </p>
        </div>
      ) : null}
    </div>
  );
}
