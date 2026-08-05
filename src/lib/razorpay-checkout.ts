/**
 * Razorpay Checkout, from the browser.
 *
 * This is the last mile of the payment flow, and until now it did not exist:
 * the server created a real order, the client threw the order id away, and the
 * page told the competitor to "complete payment in Razorpay" without ever
 * opening Razorpay. Everything else — signature verification, the webhook,
 * refunds, idempotency — was already built and correct.
 *
 * The checkout script is loaded on demand rather than in the app shell. It is
 * third-party JavaScript that only matters on one button, on one page, for the
 * subset of tournaments that charge an entry fee.
 */

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

/**
 * Razorpay renders in its own iframe and cannot read our CSS custom properties,
 * and its `theme.color` only accepts an sRGB hex. So this is the one place a
 * literal colour is correct rather than a bug: it is configuration for someone
 * else's UI, not a style in ours. Value is `--blue-500` converted to sRGB.
 */
const BRAND_HEX = '#0085fa';

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayFailure {
  error?: {
    code?: string;
    description?: string;
    reason?: string;
  };
}

interface RazorpayInstance {
  open(): void;
  close(): void;
  on(
    event: 'payment.failed',
    handler: (response: RazorpayFailure) => void,
  ): void;
}

type RazorpayConstructor = new (
  options: Record<string, unknown>,
) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor;
  }
}

/**
 * The three ways a checkout ends. `dismissed` is a first-class outcome, not an
 * error: closing the modal is a normal thing to do, and the order stays open
 * for a retry.
 */
export type CheckoutOutcome =
  | {
      status: 'paid';
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    }
  | { status: 'failed'; message: string }
  | { status: 'dismissed' };

let loader: Promise<RazorpayConstructor> | null = null;

/**
 * Load the checkout script once per page load.
 *
 * The promise is cached on the module rather than the DOM so two rapid clicks
 * share one script tag; a failed load clears the cache so a later attempt can
 * retry rather than inheriting the failure forever.
 */
function loadCheckout(): Promise<RazorpayConstructor> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Razorpay Checkout needs a browser'));
  }
  if (window.Razorpay) return Promise.resolve(window.Razorpay);

  loader ??= new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => {
      if (window.Razorpay) resolve(window.Razorpay);
      else reject(new Error('Razorpay Checkout loaded without a constructor'));
    };
    script.onerror = () =>
      reject(new Error('Razorpay Checkout script failed to load'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loader = null;
    throw error;
  });

  return loader;
}

/**
 * Open checkout for an order the server already created, and resolve with what
 * happened.
 *
 * The returned signature is NOT proof of payment — it is proof the browser saw
 * a success callback. `confirmCheckoutAction` re-verifies it server-side with
 * the key secret, and the webhook settles the payment independently. This
 * function is a UI, and it is treated as one.
 */
export async function openRazorpayCheckout(options: {
  keyId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  tournamentName: string;
  prefill?: { name?: string; email?: string };
}): Promise<CheckoutOutcome> {
  const Razorpay = await loadCheckout();

  return new Promise<CheckoutOutcome>((resolve) => {
    // Razorpay can fire `payment.failed` and then `ondismiss` for the same
    // attempt. Whichever lands first is the answer; the rest are ignored.
    let settled = false;
    const settle = (outcome: CheckoutOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const checkout = new Razorpay({
      key: options.keyId,
      order_id: options.orderId,
      amount: options.amountMinor,
      currency: options.currency,
      name: 'The Circuit',
      description: `${options.tournamentName} entry`,
      prefill: options.prefill ?? {},
      theme: { color: BRAND_HEX },
      // Razorpay's own retry UI would leave us waiting on a modal we have
      // already resolved. We surface the failure and let the competitor press
      // the button again, which creates a fresh order.
      retry: { enabled: false },
      handler: (response: RazorpaySuccess) =>
        settle({
          status: 'paid',
          razorpayOrderId: response.razorpay_order_id,
          razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        }),
      modal: {
        ondismiss: () => settle({ status: 'dismissed' }),
      },
    });

    checkout.on('payment.failed', (response) => {
      settle({
        status: 'failed',
        message:
          response.error?.description ??
          response.error?.reason ??
          'The payment could not be completed.',
      });
      checkout.close();
    });

    checkout.open();
  });
}
