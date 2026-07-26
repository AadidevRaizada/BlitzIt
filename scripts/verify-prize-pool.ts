import './load-env';
import { db } from '../src/server/db';
import {
  FAKE_RAZORPAY_WEBHOOK_SECRET,
  checkoutSecret,
  checkoutSignaturePayload,
  confirmCheckout,
  createPassOrder,
  getFakeRazorpayGateway,
  hmacSha256Hex,
  processRazorpayWebhook,
} from '../src/server/modules/payment';
import {
  getPrizePoolDisplay,
  recomputePrizePool,
} from '../src/server/modules/tournament';
import { acceptTerms } from '../src/server/modules/compliance';

/**
 * Epic E9.2 acceptance: dynamic prize pool read model.
 *
 * Run: npm run verify:prize-pool
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

const TAG = `e9-prize-${Date.now()}`;
const gateway = getFakeRazorpayGateway();

async function cleanup() {
  await db.opsEvent.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.auditLog.deleteMany({
    where: { action: { in: ['payment.paid', 'payment.refunded'] } },
  });
  await db.registration.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.payment.deleteMany({
    where: { tournament: { slug: { contains: TAG } } },
  });
  await db.tournament.deleteMany({ where: { slug: { contains: TAG } } });
  await db.user.deleteMany({
    where: { email: { contains: '@e9-prize.test' } },
  });
}

async function makeUser(name: string) {
  const user = await db.user.create({
    data: {
      authUserId: `auth-${TAG}-${name}`,
      email: `${name}-${TAG}@e9-prize.test`,
      username: `${name}-${TAG}`,
      displayName: name,
      profile: { create: {} },
    },
  });
  await acceptTerms({ userId: user.id });
  return user;
}

async function makeTournament(name: string, maxRegistrations = 16) {
  const now = Date.now();
  return db.tournament.create({
    data: {
      slug: `${TAG}-${name}`,
      name: `E9 Prize ${name}`,
      status: 'REGISTRATION_OPEN',
      registrationOpensAt: new Date(now - 60_000),
      registrationClosesAt: new Date(now + 3_600_000),
      passPriceMinor: 10_000,
      currency: 'INR',
      basePrizePoolMinor: 50_000,
      prizePerRegistrationMinor: 20_000,
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

async function pay(tournamentId: string, userId: string) {
  const order = await createPassOrder(tournamentId, userId, { gateway });
  const payment = gateway.simulatePayment(order.orderId, 'captured');
  await confirmCheckout(
    {
      razorpayOrderId: order.orderId,
      razorpayPaymentId: payment.id,
      razorpaySignature: checkoutSignature(order.orderId, payment.id),
    },
    { gateway },
  );
  return { order, payment };
}

function webhookSignature(body: string) {
  return hmacSha256Hex(body, FAKE_RAZORPAY_WEBHOOK_SECRET);
}

function refundBody(input: {
  id: string;
  paymentId: string;
  amount: number;
  currency: string;
}) {
  return JSON.stringify({
    id: input.id,
    event: 'refund.processed',
    payload: {
      refund: {
        entity: {
          id: `${input.id}-refund`,
          payment_id: input.paymentId,
          amount: input.amount,
          currency: input.currency,
        },
      },
    },
  });
}

async function main() {
  await cleanup();

  // minimum floor applies
  {
    const tournament = await makeTournament('floor');
    await db.$transaction((tx) => recomputePrizePool(tournament.id, tx));
    const display = await getPrizePoolDisplay(tournament.id);
    check(
      'minimum floor applies',
      display.prizePoolMinor === 50_000 && display.paidEntries === 0,
      `${display.prizePoolMinor} / ${display.paidEntries}`,
    );
  }

  // pool grows per paid entry
  {
    const tournament = await makeTournament('growth');
    const users = await Promise.all([
      makeUser('growth-a'),
      makeUser('growth-b'),
      makeUser('growth-c'),
    ]);
    for (const user of users) await pay(tournament.id, user.id);
    const display = await getPrizePoolDisplay(tournament.id);
    check(
      'pool grows per paid entry',
      display.paidEntries === 3 &&
        display.entryContributionMinor === 60_000 &&
        display.prizePoolMinor === 60_000,
      `${display.paidEntries} / ${display.prizePoolMinor}`,
    );
  }

  // refunds shrink it
  {
    const tournament = await makeTournament('refund');
    const users = await Promise.all([
      makeUser('refund-a'),
      makeUser('refund-b'),
      makeUser('refund-c'),
    ]);
    const paid = [];
    for (const user of users) paid.push(await pay(tournament.id, user.id));
    const body = refundBody({
      id: `${TAG}-pool-refund`,
      paymentId: paid[0]!.payment.id,
      amount: paid[0]!.payment.amount,
      currency: paid[0]!.payment.currency,
    });
    await processRazorpayWebhook(body, webhookSignature(body));
    const display = await getPrizePoolDisplay(tournament.id);
    check(
      'refund shrinks the pool',
      display.paidEntries === 2 && display.prizePoolMinor === 50_000,
      `${display.paidEntries} / ${display.prizePoolMinor}`,
    );
  }

  // sponsor contribution adds
  {
    const tournament = await makeTournament('sponsor');
    const user = await makeUser('sponsor-a');
    await pay(tournament.id, user.id);
    await db.$transaction(async (tx) => {
      await tx.tournament.update({
        where: { id: tournament.id },
        data: { sponsorContributionMinor: 40_000 },
      });
      await recomputePrizePool(tournament.id, tx);
    });
    const display = await getPrizePoolDisplay(tournament.id);
    check(
      'sponsor contribution adds to the pool',
      display.paidEntries === 1 &&
        display.sponsorContributionMinor === 40_000 &&
        display.prizePoolMinor === 60_000,
      `${display.paidEntries} / ${display.prizePoolMinor}`,
    );
  }

  // unpaid registrations do not count
  {
    const tournament = await makeTournament('unpaid');
    const paidUser = await makeUser('unpaid-paid');
    const unpaidUser = await makeUser('unpaid-unpaid');
    await pay(tournament.id, paidUser.id);
    await db.registration.create({
      data: {
        tournamentId: tournament.id,
        userId: unpaidUser.id,
        status: 'ACTIVE',
      },
    });
    await db.$transaction((tx) => recomputePrizePool(tournament.id, tx));
    const display = await getPrizePoolDisplay(tournament.id);
    check(
      'unpaid active registration does not count in paid tournament',
      display.paidEntries === 1 && display.prizePoolMinor === 50_000,
      `${display.paidEntries} / ${display.prizePoolMinor}`,
    );
  }

  // concurrent paid registrations produce the correct total
  {
    const tournament = await makeTournament('concurrent', 8);
    const users = await Promise.all(
      Array.from({ length: 6 }, (_, index) => makeUser(`concurrent-${index}`)),
    );
    await Promise.all(users.map((user) => pay(tournament.id, user.id)));
    const display = await getPrizePoolDisplay(tournament.id);
    const stored = await db.tournament.findUniqueOrThrow({
      where: { id: tournament.id },
      select: { prizePoolMinor: true },
    });
    check(
      'concurrent paid registrations produce correct total',
      display.paidEntries === 6 &&
        display.prizePoolMinor === 120_000 &&
        stored.prizePoolMinor === 120_000,
      `${display.paidEntries} / ${display.prizePoolMinor} / stored ${stored.prizePoolMinor}`,
    );
  }

  if (failures > 0) throw new Error(`${failures} check(s) FAILED.`);
  console.log('\nPrize pool verified.');
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
