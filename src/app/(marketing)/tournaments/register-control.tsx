'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2, CircleAlert, CreditCard } from 'lucide-react';
import { registerForTournamentAction } from '@/server/actions/registration.actions';
import type { MyTournamentState } from '@/server/modules/tournament';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function RegisterControl({
  tournamentId,
  slug,
  status,
  participantCount,
  maxRegistrations,
  userSignedIn,
  state,
  intent,
}: {
  tournamentId: string;
  slug: string;
  status: string;
  participantCount: number;
  maxRegistrations: number | null;
  userSignedIn: boolean;
  state: MyTournamentState | null;
  intent?: string;
}) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [step, setStep] = useState<'rules' | 'payment'>(
    intent === 'join' ? 'rules' : 'rules',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const full =
    maxRegistrations !== null && participantCount >= maxRegistrations;
  const started = [
    'SIMULATION',
    'SEEDING',
    'BRACKET_GENERATED',
    'LIVE',
  ].includes(status);
  const loginHref = `/login?next=${encodeURIComponent(
    `/tournaments/${slug}?intent=join`,
  )}&intent=join`;

  const primary = useMemo(() => {
    if (state?.isRegistered && state.currentMatch) {
      return {
        href: `/arena/knockout/${state.currentMatch.id}`,
        label: 'Go to Arena',
      };
    }
    if (
      state?.isRegistered &&
      state.currentRound?.status === 'OPEN' &&
      !state.currentRound.submitted
    ) {
      return {
        href: `/submit/${state.currentRound.id}`,
        label: 'Enter round',
      };
    }
    if (state?.isRegistered) {
      return {
        href: '/dashboard',
        label: started ? 'Open Dashboard' : 'Registered',
      };
    }
    return null;
  }, [started, state]);

  if (!userSignedIn) {
    return (
      <Link
        href={loginHref}
        className={cn(
          buttonVariants({ variant: 'broadcast', size: 'broadcast' }),
        )}
      >
        Register
      </Link>
    );
  }

  if (primary) {
    return (
      <div className="space-y-3">
        <Link
          href={primary.href}
          className={cn(
            buttonVariants({ variant: 'broadcast', size: 'broadcast' }),
          )}
        >
          <CheckCircle2 className="size-4" aria-hidden />
          {primary.label}
        </Link>
        <p className="text-muted-foreground text-sm">
          Your entry is active for this tournament.
        </p>
      </div>
    );
  }

  if (status !== 'REGISTRATION_OPEN' || full) {
    return (
      <div className="border-hairline bg-surface-raised space-y-2 border p-4">
        <p className="font-semibold">
          {full ? 'Registration is full.' : 'Registration is not open.'}
        </p>
        <p className="text-muted-foreground text-sm">
          {status === 'PUBLISHED'
            ? 'The opening date is shown in the timeline.'
            : 'Return when the next registration window opens.'}
        </p>
      </div>
    );
  }

  function submit() {
    if (!accepted) {
      setMessage('Accept the tournament rules before continuing.');
      return;
    }

    if (step === 'rules') {
      setStep('payment');
      setMessage(null);
      return;
    }

    startTransition(async () => {
      const result = await registerForTournamentAction(tournamentId, {
        acceptedRules: true,
      });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setMessage('Registered. Your dashboard is ready.');
      router.refresh();
    });
  }

  return (
    <div className="border-hairline bg-surface-raised space-y-4 border p-4">
      <div>
        <p className="font-semibold">
          {step === 'payment'
            ? 'Free beta confirmation'
            : 'Join this tournament'}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {step === 'payment'
            ? 'No entry fee is collected today. Razorpay will replace this slot later without moving the flow.'
            : 'Rules acceptance is required and recorded when you register.'}
        </p>
      </div>

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          className="mt-1"
        />
        <span>
          I accept the tournament rules, sealed reveal timing, evaluation
          policy, and disqualification terms.
        </span>
      </label>

      {step === 'payment' ? (
        <div className="border-hairline flex items-center gap-3 border p-3 text-sm">
          <CreditCard className="text-secondary size-5" aria-hidden />
          <div>
            <p className="font-medium">Free beta - no entry fee</p>
            <p className="text-muted-foreground">
              Prize pool is ₹0 while entries are free.
            </p>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className="flex items-center gap-2 text-sm" role="status">
          <CircleAlert className="size-4" aria-hidden />
          {message}
        </p>
      ) : null}

      <Button
        variant="broadcast"
        size="broadcast"
        onClick={submit}
        disabled={pending}
      >
        {pending
          ? 'Registering...'
          : step === 'payment'
            ? 'Confirm registration'
            : 'Continue to payment'}
      </Button>
    </div>
  );
}
