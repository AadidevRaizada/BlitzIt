import './load-env';
import { execFileSync } from 'node:child_process';
import { db } from '../src/server/db';
import {
  FAKE_RAZORPAY_WEBHOOK_SECRET,
  checkoutSecret,
  checkoutSignaturePayload,
  confirmCheckout,
  createPassOrder,
  getFakeRazorpayGateway,
  hmacSha256Hex,
  listPaymentsForAdmin,
  processRazorpayWebhook,
  reconcilePendingRefundForAdmin,
  refundPaymentForAdmin,
  type RazorpayGateway,
} from '../src/server/modules/payment';
import { acceptTerms } from '../src/server/modules/compliance';
import { withdrawRegistration } from '../src/server/modules/tournament';
import { AppError } from '../src/lib/errors';

/**
 * Epic E9.1 acceptance: Razorpay payment core + paid registration atomicity.
 *
 * Uses the deterministic fake gateway, so it runs without Razorpay test keys.
 *
 * Run: npm run verify:payments
 */

process.env.RAZORPAY_USE_FAKE = 'true';

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

async function checkRejects(
  label: string,
  fn: () => Promise<unknown>,
  code?: AppError['code'],
) {
  try {
    await fn();
    check(label, false, 'resolved unexpectedly');
  } catch (error) {
    const ok =
      error instanceof AppError && (code === undefined || error.code === code);
    check(
      label,
      ok,
      error instanceof Error
        ? `${error.name}${error instanceof AppError ? `:${error.code}` : ''}`
        : String(error),
    );
  }
}

async function checkRejectsAny(
  label: string,
  fn: () => Promise<unknown>,
  expectedMessage: string,
) {
  try {
    await fn();
    check(label, false, 'resolved unexpectedly');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(label, message.includes(expectedMessage), message);
  }
}

const TAG = `e9-payments-${Date.now()}`;
const gateway = getFakeRazorpayGateway();

function assertProductionRazorpayEnvFailsClosed() {
  execFileSync(
    process.execPath,
    [
      '--conditions=react-server',
      '--import',
      'tsx',
      '--eval',
      `
        process.env.NODE_ENV = 'production';
        process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/blitzit';
        process.env.BETTER_AUTH_SECRET = '12345678901234567890123456789012';
        delete process.env.RAZORPAY_KEY_ID;
        delete process.env.RAZORPAY_KEY_SECRET;
        delete process.env.RAZORPAY_WEBHOOK_SECRET;
        process.env.RAZORPAY_USE_FAKE = 'false';
        const payment = await import('./src/server/modules/payment/index.ts');
        try {
          payment.getRazorpayGateway();
          process.exit(1);
        } catch (error) {
          process.exit(String(error).includes('RAZORPAY') ? 0 : 2);
        }
      `,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
      },
      stdio: 'pipe',
    },
  );
}

async function cleanup() {
  await db.webhookEvent.deleteMany({
    where: { providerEventId: { contains: TAG } },
  });
  await db.opsEvent.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.auditLog.deleteMany({
    where: {
      OR: [
        { entityId: { contains: TAG } },
        { action: { startsWith: 'payment.' } },
        { action: 'compliance.termsAccepted' },
      ],
    },
  });
  await db.registration.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.payment.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.tournament.deleteMany({ where: { slug: { contains: TAG } } });
  await db.user.deleteMany({
    where: { email: { contains: '@e9-payments.test' } },
  });
}

async function makeUser(name: string) {
  const user = await db.user.create({
    data: {
      authUserId: `auth-${TAG}-${name}`,
      email: `${name}-${TAG}@e9-payments.test`,
      username: `${name}-${TAG}`,
      displayName: name,
      profile: { create: {} },
    },
  });
  await acceptTerms({ userId: user.id });
  return user;
}

async function makeUserWithoutTerms(name: string) {
  return db.user.create({
    data: {
      authUserId: `auth-${TAG}-${name}`,
      email: `${name}-${TAG}@e9-payments.test`,
      username: `${name}-${TAG}`,
      displayName: name,
      profile: { create: {} },
    },
  });
}

async function makeTournament(name: string, maxRegistrations = 8) {
  const now = Date.now();
  return db.tournament.create({
    data: {
      slug: `${TAG}-${name}`,
      name: `E9 ${name}`,
      status: 'REGISTRATION_OPEN',
      registrationOpensAt: new Date(now - 60_000),
      registrationClosesAt: new Date(now + 3_600_000),
      passPriceMinor: 12_345,
      currency: 'INR',
      minRegistrations: 1,
      maxRegistrations,
      bracketSize: 8,
    },
  });
}

function checkoutSignature(orderId: string, paymentId: string): string {
  return hmacSha256Hex(
    checkoutSignaturePayload(orderId, paymentId),
    checkoutSecret(),
  );
}

function webhookBody(input: {
  id: string;
  event: string;
  payment?: {
    id: string;
    orderId: string;
    amount: number;
    currency: string;
    status: string;
  };
  refund?: { id: string; paymentId: string; amount: number; currency: string };
}) {
  return JSON.stringify({
    id: input.id,
    event: input.event,
    payload: {
      ...(input.payment
        ? {
            payment: {
              entity: {
                id: input.payment.id,
                order_id: input.payment.orderId,
                amount: input.payment.amount,
                currency: input.payment.currency,
                status: input.payment.status,
              },
            },
          }
        : {}),
      ...(input.refund
        ? {
            refund: {
              entity: {
                id: input.refund.id,
                payment_id: input.refund.paymentId,
                amount: input.refund.amount,
                currency: input.refund.currency,
              },
            },
          }
        : {}),
    },
  });
}

function webhookSignature(body: string) {
  return hmacSha256Hex(body, FAKE_RAZORPAY_WEBHOOK_SECRET);
}

async function main() {
  await cleanup();

  // 0. production payment configuration fails closed
  {
    try {
      assertProductionRazorpayEnvFailsClosed();
      check(
        'production without Razorpay credentials refuses the payment seam',
        true,
      );
    } catch (error) {
      check(
        'production without Razorpay credentials refuses the payment seam',
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  // 1. successful payment -> registration active
  {
    const user = await makeUser('success');
    const tournament = await makeTournament('success');
    const order = await createPassOrder(tournament.id, user.id, {
      gateway,
      actorId: user.id,
    });
    const fakePayment = gateway.simulatePayment(order.orderId, 'captured');
    const confirmed = await confirmCheckout(
      {
        razorpayOrderId: order.orderId,
        razorpayPaymentId: fakePayment.id,
        razorpaySignature: checkoutSignature(order.orderId, fakePayment.id),
      },
      { gateway },
    );
    const registration = await db.registration.findUnique({
      where: {
        userId_tournamentId: { userId: user.id, tournamentId: tournament.id },
      },
    });
    check(
      'successful payment marks payment PAID',
      confirmed.payment.status === 'PAID',
    );
    check(
      'successful payment activates registration',
      registration?.status === 'ACTIVE',
    );
    check(
      'registration links to the payment',
      registration?.paymentId === order.paymentId,
    );
  }

  // 1b. paid entry is blocked until the current terms version is stored
  {
    const user = await makeUserWithoutTerms('terms-gate');
    const tournament = await makeTournament('terms-gate');
    await checkRejects(
      'paid order creation requires current terms acceptance',
      () => createPassOrder(tournament.id, user.id, { gateway }),
      'FORBIDDEN',
    );
    check(
      'terms-gated order does not touch the gateway or create payment state',
      (await db.payment.count({
        where: { userId: user.id, tournamentId: tournament.id },
      })) === 0,
    );
  }

  // 1c. authorized money is not settled until capture
  {
    const user = await makeUser('authorized-only');
    const tournament = await makeTournament('authorized-only');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const authorizedPayment = gateway.simulatePayment(
      order.orderId,
      'authorized',
    );
    const authorizedBody = webhookBody({
      id: `${TAG}-authorized-only`,
      event: 'payment.authorized',
      payment: authorizedPayment,
    });
    await processRazorpayWebhook(
      authorizedBody,
      webhookSignature(authorizedBody),
    );
    const [pending, registrationCount, tournamentAfterAuthorized] =
      await Promise.all([
        db.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
        db.registration.count({
          where: { userId: user.id, tournamentId: tournament.id },
        }),
        db.tournament.findUniqueOrThrow({
          where: { id: tournament.id },
          select: { participantCount: true, prizePoolMinor: true },
        }),
      ]);
    check(
      'authorized webhook leaves payment pending',
      pending.status === 'PENDING' &&
        pending.providerPaymentId === authorizedPayment.id,
      `status ${pending.status}; provider ${pending.providerPaymentId}`,
    );
    check(
      'authorized webhook activates no registration or prize money',
      registrationCount === 0 &&
        tournamentAfterAuthorized.participantCount === 0 &&
        tournamentAfterAuthorized.prizePoolMinor === 0,
      `registrations ${registrationCount}; count ${tournamentAfterAuthorized.participantCount}; pool ${tournamentAfterAuthorized.prizePoolMinor}`,
    );

    gateway.setPaymentStatus(authorizedPayment.id, 'captured');
    const capturedBody = webhookBody({
      id: `${TAG}-authorized-then-captured`,
      event: 'payment.captured',
      payment: { ...authorizedPayment, status: 'captured' },
    });
    await processRazorpayWebhook(capturedBody, webhookSignature(capturedBody));
    await processRazorpayWebhook(capturedBody, webhookSignature(capturedBody));
    const [paid, registration, tournamentAfterCapture] = await Promise.all([
      db.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
      db.registration.findUnique({
        where: {
          userId_tournamentId: {
            userId: user.id,
            tournamentId: tournament.id,
          },
        },
      }),
      db.tournament.findUniqueOrThrow({
        where: { id: tournament.id },
        select: { participantCount: true, prizePoolMinor: true },
      }),
    ]);
    check(
      'captured webhook after authorization activates exactly once',
      paid.status === 'PAID' &&
        registration?.status === 'ACTIVE' &&
        tournamentAfterCapture.participantCount === 1,
      `payment ${paid.status}; registration ${registration?.status}; count ${tournamentAfterCapture.participantCount}`,
    );
    check(
      'captured webhook after authorization contributes once to prize pool',
      tournamentAfterCapture.prizePoolMinor > 0 &&
        tournamentAfterCapture.participantCount === 1,
      `pool ${tournamentAfterCapture.prizePoolMinor}; count ${tournamentAfterCapture.participantCount}`,
    );
  }

  // 2. cancelled/failed checkout -> no registration
  {
    const user = await makeUser('cancelled');
    const tournament = await makeTournament('cancelled');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const fakePayment = gateway.simulatePayment(order.orderId, 'failed');
    await checkRejects(
      'cancelled payment confirmation is refused',
      () =>
        confirmCheckout(
          {
            razorpayOrderId: order.orderId,
            razorpayPaymentId: fakePayment.id,
            razorpaySignature: checkoutSignature(order.orderId, fakePayment.id),
          },
          { gateway },
        ),
      'CONFLICT',
    );
    check(
      'cancelled payment creates no registration',
      (await db.registration.count({
        where: { tournamentId: tournament.id },
      })) === 0,
    );
  }

  // 3. failed payment, then a successful retry
  {
    const user = await makeUser('retry');
    const tournament = await makeTournament('retry');
    const first = await createPassOrder(tournament.id, user.id, { gateway });
    const failedPayment = gateway.simulatePayment(first.orderId, 'failed');
    const failedBody = webhookBody({
      id: `${TAG}-failed-retry`,
      event: 'payment.failed',
      payment: failedPayment,
    });
    await processRazorpayWebhook(failedBody, webhookSignature(failedBody));
    const second = await createPassOrder(tournament.id, user.id, { gateway });
    const paidPayment = gateway.simulatePayment(second.orderId, 'captured');
    await confirmCheckout(
      {
        razorpayOrderId: second.orderId,
        razorpayPaymentId: paidPayment.id,
        razorpaySignature: checkoutSignature(second.orderId, paidPayment.id),
      },
      { gateway },
    );
    check(
      'failed payment retry gets a fresh order',
      first.orderId !== second.orderId,
    );
    check(
      'retry success activates exactly one registration',
      (await db.registration.count({
        where: { userId: user.id, tournamentId: tournament.id },
      })) === 1,
    );
  }

  // 4. duplicate webhook
  {
    const user = await makeUser('duplicate');
    const tournament = await makeTournament('duplicate');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const payment = gateway.simulatePayment(order.orderId, 'captured');
    const body = webhookBody({
      id: `${TAG}-duplicate-event`,
      event: 'payment.captured',
      payment,
    });
    await processRazorpayWebhook(body, webhookSignature(body));
    const originalLedger = await db.webhookEvent.findFirstOrThrow({
      where: {
        providerEventId: `${TAG}-duplicate-event`,
        signatureVerified: true,
      },
    });
    await checkRejects(
      'forged duplicate webhook is rejected after the real event',
      () => processRazorpayWebhook(body, 'bad-signature'),
      'FORBIDDEN',
    );
    await processRazorpayWebhook(body, webhookSignature(body));
    const ledgerRows = await db.webhookEvent.count({
      where: {
        providerEventId: `${TAG}-duplicate-event`,
        signatureVerified: true,
      },
    });
    const originalLedgerAfter = await db.webhookEvent.findUniqueOrThrow({
      where: { id: originalLedger.id },
    });
    check(
      'duplicate webhook creates one registration',
      (await db.registration.count({
        where: { userId: user.id, tournamentId: tournament.id },
      })) === 1,
    );
    check('duplicate webhook is deduped by the ledger', ledgerRows === 1);
    check(
      'forged duplicate webhook cannot rewrite verified ledger history',
      originalLedgerAfter.outcome === originalLedger.outcome &&
        originalLedgerAfter.errorMessage === originalLedger.errorMessage &&
        originalLedgerAfter.signatureVerified === true,
    );
  }

  // 5. webhook replay / out-of-order event
  // 4b. concurrent first-delivery duplicate captured webhooks
  {
    const user = await makeUser('concurrent-duplicate');
    const tournament = await makeTournament('concurrent-duplicate');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const payment = gateway.simulatePayment(order.orderId, 'captured');
    const body = webhookBody({
      id: `${TAG}-concurrent-duplicate-event`,
      event: 'payment.captured',
      payment,
    });
    const results = await Promise.all([
      processRazorpayWebhook(body, webhookSignature(body)),
      processRazorpayWebhook(body, webhookSignature(body)),
    ]);
    const [registrationCount, stored, tournamentAfter, ledgerRows, refundOps] =
      await Promise.all([
        db.registration.count({
          where: { userId: user.id, tournamentId: tournament.id },
        }),
        db.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
        db.tournament.findUniqueOrThrow({
          where: { id: tournament.id },
          select: { participantCount: true },
        }),
        db.webhookEvent.count({
          where: {
            providerEventId: `${TAG}-concurrent-duplicate-event`,
            signatureVerified: true,
          },
        }),
        db.opsEvent.count({
          where: {
            tournamentId: tournament.id,
            type: 'payment.refundRequired',
          },
        }),
      ]);
    check(
      'concurrent duplicate captured webhook creates one registration',
      registrationCount === 1 &&
        stored.status === 'PAID' &&
        stored.refundRequiredAt === null &&
        tournamentAfter.participantCount === 1,
      `registrations ${registrationCount}; payment ${stored.status}; refund ${stored.refundRequiredAt}; count ${tournamentAfter.participantCount}`,
    );
    check(
      'concurrent duplicate captured webhook is deduped without refund ops',
      results.filter((result) => result.processed).length === 1 &&
        results.filter((result) => !result.processed).length === 1 &&
        ledgerRows === 1 &&
        refundOps === 0,
      JSON.stringify({ results, ledgerRows, refundOps }),
    );
  }

  // 5. webhook replay / out-of-order event
  {
    const user = await makeUser('out-of-order');
    const tournament = await makeTournament('out-of-order');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const payment = gateway.simulatePayment(order.orderId, 'captured');
    const paidBody = webhookBody({
      id: `${TAG}-paid-then-failed`,
      event: 'payment.captured',
      payment,
    });
    await processRazorpayWebhook(paidBody, webhookSignature(paidBody));
    const failedBody = webhookBody({
      id: `${TAG}-late-failed`,
      event: 'payment.failed',
      payment: { ...payment, status: 'failed' },
    });
    await processRazorpayWebhook(failedBody, webhookSignature(failedBody));
    const stored = await db.payment.findUniqueOrThrow({
      where: { id: order.paymentId },
    });
    check(
      'out-of-order failed event cannot move PAID backward',
      stored.status === 'PAID',
    );
  }

  // 6. refund
  {
    const user = await makeUser('refund');
    const tournament = await makeTournament('refund');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const payment = gateway.simulatePayment(order.orderId, 'captured');
    await confirmCheckout(
      {
        razorpayOrderId: order.orderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: checkoutSignature(order.orderId, payment.id),
      },
      { gateway },
    );
    const body = webhookBody({
      id: `${TAG}-refund`,
      event: 'refund.processed',
      refund: {
        id: `${TAG}-refund-id`,
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
      },
    });
    await processRazorpayWebhook(body, webhookSignature(body));
    const registration = await db.registration.findUniqueOrThrow({
      where: {
        userId_tournamentId: { userId: user.id, tournamentId: tournament.id },
      },
    });
    const stored = await db.payment.findUniqueOrThrow({
      where: { id: order.paymentId },
    });
    check('refund marks payment REFUNDED', stored.status === 'REFUNDED');
    check(
      'refund marks registration REFUNDED',
      registration.status === 'REFUNDED',
    );
  }

  // 7. invalid signature rejected
  {
    const user = await makeUser('invalid-signature');
    const tournament = await makeTournament('invalid-signature');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const payment = gateway.simulatePayment(order.orderId, 'captured');
    const body = webhookBody({
      id: `${TAG}-invalid-signature`,
      event: 'payment.captured',
      payment,
    });
    await checkRejects(
      'invalid webhook signature is rejected',
      () => processRazorpayWebhook(body, 'bad-signature'),
      'FORBIDDEN',
    );
    const rejected = await db.webhookEvent.findFirst({
      where: {
        providerEventId: {
          startsWith: `rejected:`,
          contains: `${TAG}-invalid-signature`,
        },
      },
    });
    check(
      'invalid signature is recorded in webhook history',
      rejected?.outcome === 'REJECTED' && rejected.signatureVerified === false,
    );
    const stored = await db.payment.findUniqueOrThrow({
      where: { id: order.paymentId },
    });
    check(
      'invalid signature mutates no payment state',
      stored.status === 'CREATED',
    );
    check(
      'invalid signature creates no registration',
      (await db.registration.count({
        where: { tournamentId: tournament.id },
      })) === 0,
    );
  }

  // 7a. invalid signature cannot poison a future real event id
  {
    const user = await makeUser('invalid-then-real');
    const tournament = await makeTournament('invalid-then-real');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const payment = gateway.simulatePayment(order.orderId, 'captured');
    const eventId = `${TAG}-invalid-then-real`;
    const body = webhookBody({
      id: eventId,
      event: 'payment.captured',
      payment,
    });
    await checkRejects(
      'bad-signature webhook naming a future event is rejected',
      () => processRazorpayWebhook(body, 'bad-signature'),
      'FORBIDDEN',
    );
    const applied = await processRazorpayWebhook(body, webhookSignature(body));
    const [stored, registration, rejected] = await Promise.all([
      db.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
      db.registration.findUnique({
        where: {
          userId_tournamentId: {
            userId: user.id,
            tournamentId: tournament.id,
          },
        },
      }),
      db.webhookEvent.findFirst({
        where: {
          providerEventId: { startsWith: 'rejected:', contains: eventId },
          signatureVerified: false,
          outcome: 'REJECTED',
        },
      }),
    ]);
    check(
      'bad-signature pre-poison does not suppress the genuine event',
      applied.processed === true &&
        stored.status === 'PAID' &&
        registration?.status === 'ACTIVE',
      `processed ${applied.processed}; payment ${stored.status}; registration ${registration?.status}`,
    );
    check(
      'bad-signature pre-poison is recorded outside the verified event key',
      rejected !== null &&
        rejected.providerEventId !== eventId &&
        rejected.providerEventId.includes(eventId),
    );
  }

  // 7aa. fake webhook credentials never work outside explicit fake mode
  {
    const user = await makeUser('fake-secret-forgery');
    const tournament = await makeTournament('fake-secret-forgery');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const payment = gateway.simulatePayment(order.orderId, 'captured');
    const body = webhookBody({
      id: `${TAG}-fake-secret-forgery`,
      event: 'payment.captured',
      payment,
    });
    const previousFakeMode = process.env.RAZORPAY_USE_FAKE;
    process.env.RAZORPAY_USE_FAKE = 'false';
    await checkRejectsAny(
      'forged webhook signed with fake secret is rejected outside fake mode',
      () => processRazorpayWebhook(body, webhookSignature(body)),
      'RAZORPAY',
    );
    process.env.RAZORPAY_USE_FAKE = previousFakeMode;
    const [stored, registrations] = await Promise.all([
      db.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
      db.registration.count({ where: { tournamentId: tournament.id } }),
    ]);
    check(
      'forged fake-secret webhook activates no registration',
      stored.status === 'CREATED' && registrations === 0,
      `payment ${stored.status}; registrations ${registrations}`,
    );
  }

  // 7b. refund after withdrawal does not double-release capacity
  {
    const user = await makeUser('refund-withdrawn');
    const tournament = await makeTournament('refund-withdrawn');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const payment = gateway.simulatePayment(order.orderId, 'captured');
    await confirmCheckout(
      {
        razorpayOrderId: order.orderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: checkoutSignature(order.orderId, payment.id),
      },
      { gateway },
    );
    await withdrawRegistration(tournament.id, user.id, { actorId: user.id });
    const beforeRefund = await db.tournament.findUniqueOrThrow({
      where: { id: tournament.id },
      select: { participantCount: true },
    });
    const body = webhookBody({
      id: `${TAG}-refund-withdrawn`,
      event: 'refund.processed',
      refund: {
        id: `${TAG}-refund-withdrawn-id`,
        paymentId: payment.id,
        amount: payment.amount,
        currency: payment.currency,
      },
    });
    await processRazorpayWebhook(body, webhookSignature(body));
    const afterRefund = await db.tournament.findUniqueOrThrow({
      where: { id: tournament.id },
      select: { participantCount: true },
    });
    const activeCount = await db.registration.count({
      where: { tournamentId: tournament.id, status: 'ACTIVE' },
    });
    check(
      'refund after withdrawal leaves participant count unchanged',
      beforeRefund.participantCount === 0 &&
        afterRefund.participantCount === beforeRefund.participantCount &&
        afterRefund.participantCount === activeCount,
      `${beforeRefund.participantCount} -> ${afterRefund.participantCount}; active ${activeCount}`,
    );
  }

  // 7c. late captured payment after a successful retry is non-retryable
  {
    const user = await makeUser('late-duplicate');
    const tournament = await makeTournament('late-duplicate');
    const first = await createPassOrder(tournament.id, user.id, { gateway });
    const firstFailed = gateway.simulatePayment(first.orderId, 'failed');
    const failedBody = webhookBody({
      id: `${TAG}-late-duplicate-failed`,
      event: 'payment.failed',
      payment: firstFailed,
    });
    await processRazorpayWebhook(failedBody, webhookSignature(failedBody));

    const second = await createPassOrder(tournament.id, user.id, { gateway });
    const secondPaid = gateway.simulatePayment(second.orderId, 'captured');
    await confirmCheckout(
      {
        razorpayOrderId: second.orderId,
        razorpayPaymentId: secondPaid.id,
        razorpaySignature: checkoutSignature(second.orderId, secondPaid.id),
      },
      { gateway },
    );

    const lateBody = webhookBody({
      id: `${TAG}-late-duplicate-paid`,
      event: 'payment.captured',
      payment: { ...firstFailed, status: 'captured' },
    });
    const late = await processRazorpayWebhook(
      lateBody,
      webhookSignature(lateBody),
    );
    const [registration, firstStored, tournamentAfter, ops] = await Promise.all(
      [
        db.registration.findUniqueOrThrow({
          where: {
            userId_tournamentId: {
              userId: user.id,
              tournamentId: tournament.id,
            },
          },
        }),
        db.payment.findUniqueOrThrow({ where: { id: first.paymentId } }),
        db.tournament.findUniqueOrThrow({
          where: { id: tournament.id },
          select: { participantCount: true },
        }),
        db.opsEvent.findFirst({
          where: {
            tournamentId: tournament.id,
            type: 'payment.refundRequired',
          },
        }),
      ],
    );
    check(
      'late duplicate payment is accepted but not applied',
      late.processed === false &&
        registration.paymentId === second.paymentId &&
        tournamentAfter.participantCount === 1,
      `processed ${late.processed}; registration ${registration.paymentId}; count ${tournamentAfter.participantCount}`,
    );
    check(
      'late duplicate payment is flagged for refund',
      firstStored.status === 'PAID' &&
        firstStored.refundRequiredAt !== null &&
        firstStored.supersededByPaymentId === second.paymentId &&
        ops !== null,
    );
  }

  // 7d. reused orders are abandoned when the price changes
  {
    const user = await makeUser('stale-price');
    const tournament = await makeTournament('stale-price');
    const first = await createPassOrder(tournament.id, user.id, { gateway });
    await db.tournament.update({
      where: { id: tournament.id },
      data: { passPriceMinor: 22_222 },
    });
    const second = await createPassOrder(tournament.id, user.id, { gateway });
    const firstStored = await db.payment.findUniqueOrThrow({
      where: { id: first.paymentId },
    });
    check(
      'stale order is superseded when price changes',
      first.paymentId !== second.paymentId &&
        firstStored.status === 'FAILED' &&
        firstStored.supersededAt !== null &&
        second.amountMinor === 22_222,
    );
  }

  // 7e. free tournaments do not create payment orders
  {
    const user = await makeUser('free-order');
    const tournament = await makeTournament('free-order');
    await db.tournament.update({
      where: { id: tournament.id },
      data: { passPriceMinor: 0 },
    });
    await checkRejects(
      'free tournament order creation is rejected',
      () => createPassOrder(tournament.id, user.id, { gateway }),
      'CONFLICT',
    );
  }

  // 7f. unknown orders are non-retryable and visible to admin
  {
    const body = webhookBody({
      id: `${TAG}-unknown-order`,
      event: 'payment.captured',
      payment: {
        id: `${TAG}-unknown-pay`,
        orderId: `${TAG}-unknown-order-id`,
        amount: 12345,
        currency: 'INR',
        status: 'captured',
      },
    });
    const result = await processRazorpayWebhook(body, webhookSignature(body));
    const ledger = await db.webhookEvent.findFirst({
      where: { providerEventId: `${TAG}-unknown-order` },
    });
    check(
      'unknown-order webhook returns as ignored',
      result.processed === false &&
        result.paymentId === null &&
        ledger?.outcome === 'IGNORED',
    );
  }

  // 8. concurrent registration race for the last slot
  {
    const tournament = await makeTournament('last-slot', 1);
    const users = await Promise.all([makeUser('slot-a'), makeUser('slot-b')]);
    const orders = await Promise.all(
      users.map((user) => createPassOrder(tournament.id, user.id, { gateway })),
    );
    const payments = orders.map((order) =>
      gateway.simulatePayment(order.orderId, 'captured'),
    );
    const webhookResults = await Promise.all(
      orders.map((_order, index) => {
        const body = webhookBody({
          id: `${TAG}-last-slot-${index}`,
          event: 'payment.captured',
          payment: payments[index]!,
        });
        return processRazorpayWebhook(body, webhookSignature(body));
      }),
    );
    const [registrations, storedPayments, tournamentAfter, adminRows, ops] =
      await Promise.all([
        db.registration.findMany({
          where: { tournamentId: tournament.id, status: 'ACTIVE' },
        }),
        db.payment.findMany({
          where: { id: { in: orders.map((order) => order.paymentId) } },
        }),
        db.tournament.findUniqueOrThrow({
          where: { id: tournament.id },
          select: { participantCount: true },
        }),
        listPaymentsForAdmin({ tournamentId: tournament.id }),
        db.opsEvent.count({
          where: {
            tournamentId: tournament.id,
            type: 'payment.refundRequired',
          },
        }),
      ]);
    const winnerPaymentIds = new Set(
      registrations.map((registration) => registration.paymentId),
    );
    const losingPayment = storedPayments.find(
      (payment) => !winnerPaymentIds.has(payment.id),
    );
    check(
      'last-slot race activates one registration',
      registrations.length === 1 && tournamentAfter.participantCount === 1,
      `registrations ${registrations.length}; count ${tournamentAfter.participantCount}`,
    );
    check(
      'last-slot loser is paid and flagged for admin refund',
      losingPayment?.status === 'PAID' &&
        losingPayment.refundRequiredAt !== null &&
        adminRows.some(
          (row) => row.id === losingPayment.id && row.refundRequiredAt !== null,
        ) &&
        ops === 1,
      `loser ${losingPayment?.status}; ops ${ops}`,
    );
    check(
      'last-slot loser webhook is non-retryable',
      webhookResults.filter((result) => result.processed).length === 1 &&
        webhookResults.filter((result) => !result.processed).length === 1,
      JSON.stringify(webhookResults),
    );
  }

  // 9. concurrent duplicate payment attempts by the same user
  {
    const admin = { id: `${TAG}-admin`, role: 'ADMIN' as const };
    const user = await makeUser('admin-refund-race');
    const tournament = await makeTournament('admin-refund-race');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const payment = gateway.simulatePayment(order.orderId, 'captured');
    await confirmCheckout(
      {
        razorpayOrderId: order.orderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: checkoutSignature(order.orderId, payment.id),
      },
      { gateway },
    );
    const beforeRefund = await db.tournament.findUniqueOrThrow({
      where: { id: tournament.id },
      select: { participantCount: true, prizePoolMinor: true },
    });
    let refundCalls = 0;
    const idempotencyKeys: string[] = [];
    const refundGateway: RazorpayGateway = {
      async createOrder() {
        throw new Error('not used');
      },
      async fetchPayment() {
        throw new Error('not used');
      },
      async refund(input: {
        paymentId: string;
        amountMinor: number;
        idempotencyKey?: string;
      }) {
        refundCalls++;
        if (input.idempotencyKey) idempotencyKeys.push(input.idempotencyKey);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          id: `${TAG}-admin-refund-race-refund`,
          paymentId: input.paymentId,
          amount: input.amountMinor,
          currency: 'INR',
          status: 'processed',
        };
      },
    };
    await Promise.all([
      refundPaymentForAdmin(order.paymentId, admin, 'race refund', {
        gateway: refundGateway,
      }),
      refundPaymentForAdmin(order.paymentId, admin, 'race refund', {
        gateway: refundGateway,
      }),
    ]);
    const [stored, registration, afterRefund] = await Promise.all([
      db.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
      db.registration.findUniqueOrThrow({
        where: {
          userId_tournamentId: {
            userId: user.id,
            tournamentId: tournament.id,
          },
        },
      }),
      db.tournament.findUniqueOrThrow({
        where: { id: tournament.id },
        select: { participantCount: true, prizePoolMinor: true },
      }),
    ]);
    check(
      'concurrent admin refunds make one provider refund call',
      refundCalls === 1 &&
        idempotencyKeys.length === 1 &&
        idempotencyKeys[0] === `payment:${order.paymentId}:admin-refund`,
      `calls ${refundCalls}; keys ${idempotencyKeys.join(',')}`,
    );
    check(
      'concurrent admin refund ends refunded once',
      stored.status === 'REFUNDED' && registration.status === 'REFUNDED',
      `payment ${stored.status}; registration ${registration.status}`,
    );
    check(
      'concurrent admin refund adjusts counts once',
      beforeRefund.participantCount === 1 &&
        beforeRefund.prizePoolMinor > 0 &&
        afterRefund.participantCount === 0 &&
        afterRefund.prizePoolMinor === 0,
      `${beforeRefund.participantCount}/${beforeRefund.prizePoolMinor} -> ${afterRefund.participantCount}/${afterRefund.prizePoolMinor}`,
    );
  }

  // 10. concurrent duplicate payment attempts by the same user
  // 9b. provider refund success followed by local finalization failure
  {
    const admin = { id: `${TAG}-admin`, role: 'ADMIN' as const };
    const user = await makeUser('admin-refund-reconcile');
    const tournament = await makeTournament('admin-refund-reconcile');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const payment = gateway.simulatePayment(order.orderId, 'captured');
    await confirmCheckout(
      {
        razorpayOrderId: order.orderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: checkoutSignature(order.orderId, payment.id),
      },
      { gateway },
    );
    let refundCalls = 0;
    const refundGateway: RazorpayGateway = {
      async createOrder() {
        throw new Error('not used');
      },
      async fetchPayment() {
        throw new Error('not used');
      },
      async refund(input) {
        refundCalls++;
        return {
          id: `${TAG}-admin-refund-reconcile-refund`,
          paymentId: input.paymentId,
          amount: input.amountMinor,
          currency: 'INR',
          status: 'processed',
        };
      },
    };
    await checkRejectsAny(
      'admin refund local finalization failure is surfaced',
      () =>
        refundPaymentForAdmin(order.paymentId, admin, 'reconcile refund', {
          gateway: refundGateway,
          simulateFinalizeFailure: true,
        }),
      'Injected refund finalization failure',
    );
    const [pending, intent, registrationBefore] = await Promise.all([
      db.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
      db.opsEvent.findUniqueOrThrow({
        where: { idempotencyKey: `payment:${order.paymentId}:admin-refund` },
      }),
      db.registration.findUniqueOrThrow({
        where: {
          userId_tournamentId: {
            userId: user.id,
            tournamentId: tournament.id,
          },
        },
      }),
    ]);
    check(
      'provider-success finalization failure leaves visible pending refund',
      pending.status === 'PENDING_REFUND' &&
        pending.refundIntentId === `payment:${order.paymentId}:admin-refund` &&
        intent.status === 'DONE' &&
        registrationBefore.status === 'ACTIVE',
      `payment ${pending.status}; intent ${intent.status}; registration ${registrationBefore.status}`,
    );
    const secondAttempt = await refundPaymentForAdmin(
      order.paymentId,
      admin,
      'second reconcile refund',
      { gateway: refundGateway },
    );
    check(
      'pending refund blocks a second provider refund',
      secondAttempt.status === 'PENDING_REFUND' && refundCalls === 1,
      `status ${secondAttempt.status}; calls ${refundCalls}`,
    );
    await reconcilePendingRefundForAdmin(
      order.paymentId,
      admin,
      'finish pending refund',
    );
    const [stored, registration, tournamentAfter] = await Promise.all([
      db.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
      db.registration.findUniqueOrThrow({
        where: {
          userId_tournamentId: {
            userId: user.id,
            tournamentId: tournament.id,
          },
        },
      }),
      db.tournament.findUniqueOrThrow({
        where: { id: tournament.id },
        select: { participantCount: true, prizePoolMinor: true },
      }),
    ]);
    check(
      'pending refund reconciles to final local refund state',
      stored.status === 'REFUNDED' &&
        stored.providerRefundId === `${TAG}-admin-refund-reconcile-refund` &&
        registration.status === 'REFUNDED' &&
        tournamentAfter.participantCount === 0 &&
        tournamentAfter.prizePoolMinor === 0,
      `payment ${stored.status}; provider refund ${stored.providerRefundId}; registration ${registration.status}; count ${tournamentAfter.participantCount}; pool ${tournamentAfter.prizePoolMinor}`,
    );
  }

  // 9c. refund intent retry after interruption before provider call
  {
    const admin = { id: `${TAG}-admin`, role: 'ADMIN' as const };
    const user = await makeUser('admin-refund-interrupt');
    const tournament = await makeTournament('admin-refund-interrupt');
    const order = await createPassOrder(tournament.id, user.id, { gateway });
    const payment = gateway.simulatePayment(order.orderId, 'captured');
    await confirmCheckout(
      {
        razorpayOrderId: order.orderId,
        razorpayPaymentId: payment.id,
        razorpaySignature: checkoutSignature(order.orderId, payment.id),
      },
      { gateway },
    );
    const beforeRefund = await db.tournament.findUniqueOrThrow({
      where: { id: tournament.id },
      select: { participantCount: true, prizePoolMinor: true },
    });
    let refundCalls = 0;
    const refundGateway: RazorpayGateway = {
      async createOrder() {
        throw new Error('not used');
      },
      async fetchPayment() {
        throw new Error('not used');
      },
      async refund(input) {
        refundCalls++;
        return {
          id: `${TAG}-admin-refund-interrupt-refund`,
          paymentId: input.paymentId,
          amount: input.amountMinor,
          currency: 'INR',
          status: 'processed',
        };
      },
    };
    await checkRejectsAny(
      'admin refund interruption after intent claim is surfaced',
      () =>
        refundPaymentForAdmin(order.paymentId, admin, 'interrupted refund', {
          gateway: refundGateway,
          simulateInterruptAfterIntent: true,
        }),
      'Injected refund interruption after intent claim',
    );
    const [stranded, intent, registrationBeforeRetry] = await Promise.all([
      db.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
      db.opsEvent.findUniqueOrThrow({
        where: { idempotencyKey: `payment:${order.paymentId}:admin-refund` },
      }),
      db.registration.findUniqueOrThrow({
        where: {
          userId_tournamentId: {
            userId: user.id,
            tournamentId: tournament.id,
          },
        },
      }),
    ]);
    check(
      'interrupted refund intent has no provider call marker',
      refundCalls === 0 &&
        stranded.status === 'PENDING_REFUND' &&
        intent.status === 'SCHEDULED' &&
        intent.result === null &&
        registrationBeforeRetry.status === 'ACTIVE',
      `calls ${refundCalls}; payment ${stranded.status}; intent ${intent.status}; registration ${registrationBeforeRetry.status}`,
    );
    await refundPaymentForAdmin(
      order.paymentId,
      admin,
      'retry interrupted refund',
      { gateway: refundGateway },
    );
    await refundPaymentForAdmin(
      order.paymentId,
      admin,
      'retry after refunded no-op',
      { gateway: refundGateway },
    );
    const [stored, registration, tournamentAfter] = await Promise.all([
      db.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
      db.registration.findUniqueOrThrow({
        where: {
          userId_tournamentId: {
            userId: user.id,
            tournamentId: tournament.id,
          },
        },
      }),
      db.tournament.findUniqueOrThrow({
        where: { id: tournament.id },
        select: { participantCount: true, prizePoolMinor: true },
      }),
    ]);
    check(
      'interrupted refund retry calls provider and reconciles once',
      refundCalls === 1 &&
        stored.status === 'REFUNDED' &&
        stored.providerRefundId === `${TAG}-admin-refund-interrupt-refund` &&
        registration.status === 'REFUNDED',
      `calls ${refundCalls}; payment ${stored.status}; refund ${stored.providerRefundId}; registration ${registration.status}`,
    );
    check(
      'interrupted refund retry adjusts count and pool once',
      beforeRefund.participantCount === 1 &&
        beforeRefund.prizePoolMinor > 0 &&
        tournamentAfter.participantCount === 0 &&
        tournamentAfter.prizePoolMinor === 0,
      `${beforeRefund.participantCount}/${beforeRefund.prizePoolMinor} -> ${tournamentAfter.participantCount}/${tournamentAfter.prizePoolMinor}`,
    );
  }

  // 10. concurrent duplicate payment attempts by the same user
  {
    const user = await makeUser('same-user');
    const tournament = await makeTournament('same-user');
    const orders = await Promise.all(
      Array.from({ length: 5 }, () =>
        createPassOrder(tournament.id, user.id, { gateway }),
      ),
    );
    check(
      'same-user concurrent order attempts return one payment row',
      new Set(orders.map((order) => order.paymentId)).size === 1 &&
        (await db.payment.count({
          where: { userId: user.id, tournamentId: tournament.id },
        })) === 1,
    );
  }

  check(
    'payment audits were recorded',
    (await db.auditLog.count({
      where: { action: { startsWith: 'payment.' } },
    })) > 0,
  );

  if (failures > 0) throw new Error(`${failures} check(s) FAILED.`);
  console.log('\nPayment core verified.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await db.$disconnect();
  });
