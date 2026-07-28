'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2, CircleAlert, CreditCard } from 'lucide-react';
import { acceptCurrentTermsAction } from '@/server/actions/compliance.actions';
import { createPassOrderAction } from '@/server/actions/payment.actions';
import { registerForTournamentAction } from '@/server/actions/registration.actions';
import type { MyTournamentState } from '@/server/modules/tournament';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type PaymentStatus =
  | 'CREATED'
  | 'PENDING'
  | 'PAID'
  | 'PENDING_REFUND'
  | 'REFUND_FAILED'
  | 'FAILED'
  | 'REFUNDED';

export function RegisterControl({
  tournamentId,
  slug,
  status,
  participantCount,
  maxRegistrations,
  entryFeeMinor,
  currency,
  userSignedIn,
  state,
}: {
  tournamentId: string;
  slug: string;
  status: string;
  participantCount: number;
  maxRegistrations: number | null;
  entryFeeMinor: number;
  currency: string;
  userSignedIn: boolean;
  state: MyTournamentState | null;
  intent?: string;
}) {
  const router = useRouter();
  const [accepted, setAccepted] = useState(false);
  const [step, setStep] = useState<'rules' | 'payment'>('rules');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const full =
    maxRegistrations !== null && participantCount >= maxRegistrations;
  const paidEntry = entryFeeMinor > 0;
  const termsAccepted = accepted || state?.readiness.termsAccepted === true;
  const paymentStatus = state?.payment?.status ?? null;
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
      <div className="space-y-4">
        <SurfaceState title="Sign in required">
          Sign in before registration so the entry can be attached to your
          competitor profile.
        </SurfaceState>
        <ReadinessList
          signedIn={false}
          profileComplete={false}
          termsAccepted={false}
          paymentSettled={!paidEntry}
          registered={false}
        />
        <Link
          href={loginHref}
          className={cn(
            buttonVariants({ variant: 'broadcast', size: 'broadcast' }),
          )}
        >
          Register
        </Link>
      </div>
    );
  }

  if (primary) {
    return (
      <div className="space-y-4">
        <SurfaceState title="Registration confirmed">
          {state?.payment?.status === 'PAID'
            ? 'Payment is settled and your entry is active.'
            : 'Your entry is active for this tournament.'}
        </SurfaceState>
        <Link
          href={primary.href}
          className={cn(
            buttonVariants({ variant: 'broadcast', size: 'broadcast' }),
          )}
        >
          <CheckCircle2 className="size-4" aria-hidden />
          {primary.label}
        </Link>
        <ReadinessList
          signedIn
          profileComplete={state?.readiness.profileComplete ?? false}
          termsAccepted={state?.readiness.termsAccepted ?? false}
          paymentSettled={!paidEntry || state?.payment?.status === 'PAID'}
          registered={state?.isRegistered ?? false}
        />
      </div>
    );
  }

  const closed = [
    'REGISTRATION_CLOSED',
    'SIMULATION',
    'SEEDING',
    'BRACKET_GENERATED',
    'LIVE',
    'COMPLETED',
    'CANCELLED',
  ].includes(status);

  if (status !== 'REGISTRATION_OPEN' || full) {
    return (
      <SurfaceState
        title={
          full
            ? 'Registration is full'
            : status === 'PUBLISHED'
              ? 'Registration has not opened'
              : closed
                ? 'Registration is closed'
                : 'Registration is not open'
        }
      >
        {full
          ? 'Capacity is filled. If a slot is released, the control will reopen while the window is active.'
          : status === 'PUBLISHED'
            ? 'The opening date is shown in the schedule.'
            : 'Return when the next registration window opens.'}
      </SurfaceState>
    );
  }

  if (paidEntry && paymentStatus && paymentStatus !== 'FAILED') {
    return (
      <div className="space-y-4">
        <SurfaceState title="Payment confirmation pending">
          {paymentStatus === 'PAID'
            ? 'Payment is settled; registration confirmation is being refreshed.'
            : 'A checkout order exists. Complete payment in Razorpay, then return for confirmation.'}
        </SurfaceState>
        <PaymentStateBadge status={paymentStatus} />
        <ReadinessList
          signedIn
          profileComplete={state?.readiness.profileComplete ?? false}
          termsAccepted={termsAccepted}
          paymentSettled={paymentStatus === 'PAID'}
          registered={state?.isRegistered ?? false}
        />
      </div>
    );
  }

  function submit() {
    if (!termsAccepted) {
      setMessage('Accept the tournament rules before continuing.');
      return;
    }

    if (step === 'rules') {
      setStep('payment');
      setMessage(null);
      return;
    }

    startTransition(async () => {
      const termsResult = await acceptCurrentTermsAction();
      if (!termsResult.ok) {
        setMessage(termsResult.error.message);
        return;
      }

      if (paidEntry) {
        const result = await createPassOrderAction({ tournamentId });
        if (!result.ok) {
          setMessage(result.error.message);
          return;
        }
        setMessage(
          paymentStatus === 'FAILED'
            ? 'Retry order created. Complete payment in Razorpay.'
            : 'Checkout order created. Complete payment in Razorpay.',
        );
        router.refresh();
        return;
      }

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
            ? paidEntry
              ? 'Payment confirmation'
              : 'Free registration confirmation'
            : 'Join this tournament'}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {step === 'payment'
            ? paidEntry
              ? 'A paid pass is required before registration can be confirmed.'
              : 'No entry fee is collected for this tournament.'
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
          policy, terms, privacy policy, and refund policy.
          <span className="mt-1 block">
            <Link href="/terms" className="text-primary underline">
              Terms
            </Link>
            {' · '}
            <Link href="/privacy" className="text-primary underline">
              Privacy
            </Link>
            {' · '}
            <Link href="/refunds" className="text-primary underline">
              Refunds
            </Link>
          </span>
        </span>
      </label>

      {step === 'payment' ? (
        <div className="border-hairline flex items-center gap-3 border p-3 text-sm">
          <CreditCard className="text-primary size-5" aria-hidden />
          <div>
            <p className="font-medium">
              {paidEntry
                ? `${formatAmount(entryFeeMinor, currency)} entry fee`
                : 'Free entry'}
            </p>
            <p className="text-muted-foreground">
              {paidEntry
                ? paymentStatus === 'FAILED'
                  ? 'Previous payment failed. Create a retry order.'
                  : 'Payment must settle before your slot is active.'
                : 'Registration activates immediately after confirmation.'}
            </p>
          </div>
        </div>
      ) : null}

      {state?.payment?.status === 'FAILED' ? (
        <SurfaceState title="Payment failed">
          {state.payment.failureReason ??
            'You can retry payment while registration is open.'}
        </SurfaceState>
      ) : null}

      <ReadinessList
        signedIn
        profileComplete={state?.readiness.profileComplete ?? false}
        termsAccepted={termsAccepted}
        paymentSettled={!paidEntry || state?.payment?.status === 'PAID'}
        registered={state?.isRegistered ?? false}
      />

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
          ? paidEntry
            ? 'Creating order...'
            : 'Registering...'
          : step === 'payment'
            ? paidEntry
              ? paymentStatus === 'FAILED'
                ? 'Retry payment'
                : 'Create payment order'
              : 'Confirm registration'
            : 'Continue to payment'}
      </Button>
    </div>
  );
}

function SurfaceState({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-hairline bg-surface-raised space-y-2 border p-4">
      <p className="font-semibold">{title}</p>
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  );
}

function ReadinessList({
  signedIn,
  profileComplete,
  termsAccepted,
  paymentSettled,
  registered,
}: {
  signedIn: boolean;
  profileComplete: boolean;
  termsAccepted: boolean;
  paymentSettled: boolean;
  registered: boolean;
}) {
  return (
    <ul className="grid gap-2 text-sm">
      <Ready ok={signedIn}>Signed in</Ready>
      <Ready ok={profileComplete}>Profile complete</Ready>
      <Ready ok={termsAccepted}>Terms accepted</Ready>
      <Ready ok={paymentSettled}>Payment settled</Ready>
      <Ready ok={registered}>Ready to compete</Ready>
    </ul>
  );
}

function Ready({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3">
      <span>{children}</span>
      <Badge tone={ok ? 'success' : 'neutral'}>{ok ? 'Done' : 'Open'}</Badge>
    </li>
  );
}

function PaymentStateBadge({ status }: { status: PaymentStatus }) {
  const tone =
    status === 'PAID' ? 'success' : status === 'FAILED' ? 'danger' : 'warning';
  return <Badge tone={tone}>{status}</Badge>;
}

function formatAmount(amountMinor: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amountMinor / 100);
}
