'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2, CircleAlert, CreditCard } from 'lucide-react';
import {
  confirmCheckoutAction,
  createPassOrderAction,
} from '@/server/actions/payment.actions';
import { registerForTournamentAction } from '@/server/actions/registration.actions';
import type { MyTournamentState } from '@/server/modules/tournament';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { openRazorpayCheckout } from '@/lib/razorpay-checkout';
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
  tournamentName,
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
  /** Shown inside the Razorpay modal, so the charge is recognisable. */
  tournamentName: string;
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
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Checkout gets its own busy flag rather than sharing the transition: the
  // modal can sit open for minutes, and a transition held pending that long
  // blocks the router updates we want to run the moment it closes.
  const [checkingOut, setCheckingOut] = useState(false);
  const busy = pending || checkingOut;

  const full =
    maxRegistrations !== null && participantCount >= maxRegistrations;
  const paidEntry = entryFeeMinor > 0;
  const paymentStatus = state?.payment?.status ?? null;
  const onboardingComplete = Boolean(
    state?.readiness.profileComplete && state?.readiness.termsAccepted,
  );
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
        label: started ? 'Open Mission Control' : 'Registered',
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

  if (!onboardingComplete) {
    return (
      <div className="space-y-4">
        <SurfaceState title="Onboarding required">
          Complete your profile, link GitHub, and accept the current terms
          before entering a tournament.
        </SurfaceState>
        <ReadinessList
          signedIn
          profileComplete={state?.readiness.profileComplete ?? false}
          termsAccepted={state?.readiness.termsAccepted ?? false}
          paymentSettled={!paidEntry}
          registered={false}
        />
        <Link
          href="/onboarding"
          className={cn(
            buttonVariants({ variant: 'broadcast', size: 'broadcast' }),
          )}
        >
          Complete onboarding
        </Link>
      </div>
    );
  }

  if (paidEntry && paymentStatus && paymentStatus !== 'FAILED') {
    // An order that was created but never paid used to be a dead end: this
    // branch rendered "complete payment in Razorpay" and offered no way to get
    // back to Razorpay. Reopening reuses the same order, so no second charge
    // can be created by pressing it.
    const unpaid = paymentStatus === 'CREATED' || paymentStatus === 'PENDING';

    return (
      <div className="space-y-4">
        <SurfaceState
          title={
            unpaid ? 'Payment not finished' : 'Payment confirmation pending'
          }
        >
          {paymentStatus === 'PAID'
            ? 'Payment is settled; registration confirmation is being refreshed.'
            : unpaid
              ? 'An order is open for this entry. Finish paying to activate your slot.'
              : 'This payment is being processed.'}
        </SurfaceState>
        <PaymentStateBadge status={paymentStatus} />

        {unpaid ? (
          <>
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
              disabled={busy}
            >
              {busy ? 'Opening checkout...' : 'Complete payment'}
            </Button>
          </>
        ) : null}

        <ReadinessList
          signedIn
          profileComplete={state?.readiness.profileComplete ?? false}
          termsAccepted={state?.readiness.termsAccepted ?? false}
          paymentSettled={paymentStatus === 'PAID'}
          registered={state?.isRegistered ?? false}
        />
      </div>
    );
  }

  /**
   * Create (or reuse) the order, open Razorpay, and confirm what comes back.
   *
   * The signature Razorpay hands the browser is not proof of payment — the
   * server re-verifies it with the key secret, and the webhook settles the
   * payment independently. That redundancy is why a failure to confirm here is
   * reported as a display delay rather than a lost payment: it is.
   */
  async function startCheckout() {
    setMessage(null);
    setCheckingOut(true);
    try {
      const order = await createPassOrderAction({ tournamentId });
      if (!order.ok) {
        setMessage(order.error.message);
        return;
      }

      const outcome = await openRazorpayCheckout({
        keyId: order.data.razorpayKeyId,
        orderId: order.data.orderId,
        amountMinor: order.data.amountMinor,
        currency: order.data.currency,
        tournamentName,
      });

      if (outcome.status === 'dismissed') {
        setMessage(
          'Checkout closed. Your order is still open — press the button again to finish paying.',
        );
        return;
      }

      if (outcome.status === 'failed') {
        setMessage(outcome.message);
        router.refresh();
        return;
      }

      const confirmed = await confirmCheckoutAction({
        razorpayOrderId: outcome.razorpayOrderId,
        razorpayPaymentId: outcome.razorpayPaymentId,
        razorpaySignature: outcome.razorpaySignature,
      });

      if (!confirmed.ok) {
        setMessage(
          `${confirmed.error.message} Your payment is still being confirmed — this page will catch up shortly.`,
        );
        router.refresh();
        return;
      }

      setMessage(
        confirmed.data.registrationId
          ? 'Payment settled. Your entry is active.'
          : 'Payment received. Confirming your entry.',
      );
      router.refresh();
    } catch (error) {
      // The only throw that reaches here is the script failing to load, which
      // in practice means an ad blocker or a dead connection — worth naming,
      // because "try again" alone would send them in circles.
      setMessage(
        error instanceof Error && error.message.includes('failed to load')
          ? 'Could not reach Razorpay. Check your connection or any ad blocker, then try again.'
          : 'Checkout could not be opened. Try again in a moment.',
      );
    } finally {
      setCheckingOut(false);
    }
  }

  function submit() {
    if (paidEntry) {
      void startCheckout();
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
      setMessage('Registered. Mission Control is ready.');
      router.refresh();
    });
  }

  return (
    <div className="border-hairline bg-surface-raised space-y-4 border p-4">
      <div>
        <p className="font-semibold">Join this tournament</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {paidEntry
            ? 'A paid pass is required before registration can be confirmed.'
            : 'No entry fee is collected for this tournament.'}
        </p>
      </div>

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

      {state?.payment?.status === 'FAILED' ? (
        <SurfaceState title="Payment failed">
          {state.payment.failureReason ??
            'You can retry payment while registration is open.'}
        </SurfaceState>
      ) : null}

      <ReadinessList
        signedIn
        profileComplete={state?.readiness.profileComplete ?? false}
        termsAccepted={state?.readiness.termsAccepted ?? false}
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
        disabled={busy}
      >
        {busy
          ? paidEntry
            ? 'Opening checkout...'
            : 'Registering...'
          : paidEntry
            ? paymentStatus === 'FAILED'
              ? 'Retry payment'
              : `Pay ${formatAmount(entryFeeMinor, currency)}`
            : 'Confirm registration'}
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
