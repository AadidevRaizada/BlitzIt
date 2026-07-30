'use client';

import { useActionState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { updatePlatformSettingsAction } from '@/server/actions/admin-settings.actions';
import type { Result } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { FormError, TextField } from '@/components/ui/field';

type State = Result<{ communityWhatsAppUrl: string | null }> | null;

export function PlatformSettingsForm({
  communityWhatsAppUrl,
}: {
  communityWhatsAppUrl: string;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<State, FormData>(
    updatePlatformSettingsAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success('Platform settings saved');
      router.refresh();
    } else {
      toast.error(state.error.message);
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4">
      <TextField
        name="communityWhatsAppUrl"
        label="Community WhatsApp link"
        defaultValue={communityWhatsAppUrl}
        placeholder="https://chat.whatsapp.com/..."
        hint="Leave blank to hide community links in the app shell."
      />
      <FormError message={state && !state.ok ? state.error.message : null} />
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? 'Saving...' : 'Save settings'}
      </Button>
    </form>
  );
}
