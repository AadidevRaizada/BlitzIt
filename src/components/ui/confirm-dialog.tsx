'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button, type ButtonProps } from './button';
import { TextField } from './field';
import type { Result } from '@/lib/errors';

/**
 * Confirmation dialog for destructive or irreversible admin actions.
 *
 * Built on the native `<dialog>` element, which gives focus trapping, Escape to
 * close, inertness of the page behind it and correct `role="dialog"` semantics
 * without a focus-management library.
 *
 * Where the blueprint requires a reason (disqualification, score override —
 * "always attach a reason"), pass `requireReason` and the action receives it.
 * The button stays disabled until a reason is typed, so the audit trail cannot
 * be left empty by clicking through.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'Confirm',
  variant = 'danger',
  requireReason = false,
  reasonLabel = 'Reason',
  reasonHint = 'Recorded in the audit log.',
  successMessage,
  action,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: ButtonProps['variant'];
  requireReason?: boolean;
  reasonLabel?: string;
  reasonHint?: string;
  successMessage: string;
  action: (reason: string) => Promise<Result<unknown>>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const canConfirm = !pending && (!requireReason || reason.trim().length >= 3);

  return (
    <>
      <span onClick={() => setOpen(true)}>{trigger}</span>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        aria-labelledby="confirm-title"
        className="bg-card text-card-foreground border-border w-[min(28rem,calc(100vw-2rem))] rounded-xl border p-0 shadow-lg backdrop:bg-black/50"
      >
        <div className="space-y-4 p-5">
          <div className="space-y-1">
            <h2 id="confirm-title" className="font-semibold">
              {title}
            </h2>
            <p className="text-muted-foreground text-sm">{description}</p>
          </div>

          {requireReason ? (
            <TextField
              label={reasonLabel}
              hint={reasonHint}
              value={reason}
              required
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this being done?"
            />
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button
              variant={variant}
              disabled={!canConfirm}
              aria-busy={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await action(reason.trim());
                  if (result.ok) {
                    toast.success(successMessage);
                    setOpen(false);
                    setReason('');
                    router.refresh();
                  } else {
                    toast.error(result.error.message);
                  }
                })
              }
            >
              {pending ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
