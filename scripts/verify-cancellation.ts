import './load-env';

// The fake gateway is selected at call time, so setting this before any refund
// runs is enough. Never reachable in production (`razorpayFakeModeEnabled`
// also requires NODE_ENV !== 'production').
process.env.RAZORPAY_USE_FAKE = 'true';

import { db } from '../src/server/db';
import { queue } from '../src/server/jobs/pg-queue';
import { processors } from '../src/server/jobs/processors';
import {
  sweepDueWork,
  ARCHIVE_GRACE_MS,
  LIFECYCLE_BUCKET_MS,
} from '../src/server/jobs/progress-sweep';
import { applyTransition } from '../src/server/modules/tournament/state';
import { INSUFFICIENT_REGISTRATIONS } from '../src/server/modules/tournament/lifecycle';
import { getLifecycleDiagnostics } from '../src/server/modules/tournament/schedule-status';
import { updateTournamentSchedule } from '../src/server/modules/tournament/tournaments';
import { getFakeRazorpayGateway } from '../src/server/modules/payment/gateway';

/**
 * Automatic cancellation acceptance (D34).
 *
 * Proves the promise: **a tournament nobody entered resolves itself.** It
 * cancels, tells the people who did enter, gives them their money back, and then
 * takes itself off the site — with no operator action anywhere in the scenario.
 *
 * As in `verify-schedule`, the end-to-end paths apply ZERO transitions by hand.
 * They run the sweep and drain the queue, which is exactly what the runner does
 * every 30 seconds, and assert the outcome.
 *
 * Run: npm run verify:cancellation
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

const TAG = 'cancel-verify';
const EMAIL_DOMAIN = 'cancel-verify.test';

async function cleanup() {
  const tournaments = await db.tournament.findMany({
    where: { slug: { contains: TAG } },
    select: { id: true },
  });
  const ids = tournaments.map((t) => t.id);
  const where = { tournament: { slug: { contains: TAG } } };

  await db.evaluation.deleteMany({ where });
  await db.submission.deleteMany({ where });
  await db.match.deleteMany({ where });
  await db.ranking.deleteMany({ where });
  await db.registration.deleteMany({ where });
  await db.payment.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.notification.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.opsEvent.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.round.deleteMany({ where });
  await db.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await db.tournament.deleteMany({ where: { slug: { contains: TAG } } });
  for (const id of ids) {
    await db.evaluationJob.deleteMany({
      where: { idempotencyKey: { contains: id } },
    });
  }
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
}

async function drain(maxPasses = 20): Promise<void> {
  for (let pass = 0; pass < maxPasses; pass++) {
    const jobs = await queue.claim(20, `cancel-verify-${pass}`);
    if (jobs.length === 0) return;
    for (const job of jobs) {
      const processor = processors[job.name];
      if (!processor) {
        await queue.complete(job.id, `cancel-verify-${pass}`);
        continue;
      }
      try {
        await processor(job);
        await queue.complete(job.id, `cancel-verify-${pass}`);
      } catch (error) {
        await queue.fail(
          job.id,
          error instanceof Error ? error.message : String(error),
          60_000,
        );
      }
    }
  }
}

let virtualNow = Date.now();
async function tick(): Promise<void> {
  virtualNow += LIFECYCLE_BUCKET_MS;
  await sweepDueWork(new Date(virtualNow));
  await drain();
}

const PAST = new Date(Date.now() - 60 * 60_000);
const FUTURE = new Date(Date.now() + 365 * 24 * 60 * 60_000);

async function makeUser(suffix: string) {
  return db.user.create({
    data: {
      authUserId: `auth-${TAG}-${suffix}`,
      email: `u-${suffix}@${EMAIL_DOMAIN}`,
      username: `${TAG}-${suffix}`,
      displayName: `Cancel Verify ${suffix}`,
      role: 'USER',
      profile: { create: {} },
    },
  });
}

async function makeTournament(
  suffix: string,
  opts: {
    minRegistrations: number;
    passPriceMinor?: number;
    /** Leave registration closing in the future to keep it open. */
    closesAt?: Date;
  },
) {
  return db.tournament.create({
    data: {
      slug: `${TAG}-${suffix}`,
      name: `Cancel Verify ${suffix}`,
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      minRegistrations: opts.minRegistrations,
      passPriceMinor: opts.passPriceMinor ?? 0,
      registrationOpensAt: PAST,
      registrationClosesAt: opts.closesAt ?? PAST,
      // Held in the future so a healthy tournament stops at
      // REGISTRATION_CLOSED rather than needing problems attached to rounds.
      simulationOpensAt: FUTURE,
      simulationClosesAt: FUTURE,
      liveStartsAt: FUTURE,
    },
  });
}

/** An ACTIVE registration, optionally with a captured payment behind it. */
async function register(
  tournamentId: string,
  suffix: string,
  paidAmountMinor?: number,
) {
  const user = await makeUser(suffix);
  let paymentId: string | undefined;

  if (paidAmountMinor) {
    // Mint a provider-side payment the fake gateway will recognise, so the
    // refund path exercises a real `gateway.refund` call rather than a stub.
    const fake = getFakeRazorpayGateway();
    const order = await fake.createOrder({
      amountMinor: paidAmountMinor,
      currency: 'INR',
      receipt: `rcpt-${suffix}`,
    });
    const providerPayment = fake.simulatePayment(order.id, 'captured');

    const payment = await db.payment.create({
      data: {
        userId: user.id,
        tournamentId,
        providerOrderId: order.id,
        providerPaymentId: providerPayment.id,
        amountMinor: paidAmountMinor,
        status: 'PAID',
        signatureVerified: true,
        paidAt: new Date(),
      },
    });
    paymentId = payment.id;
  }

  await db.registration.create({
    data: { tournamentId, userId: user.id, status: 'ACTIVE', paymentId },
  });
  return user;
}

// ---------------------------------------------------------------------------
// 1. The guard still protects every non-schedule path
// ---------------------------------------------------------------------------

async function guardChecks() {
  console.log('\n--- 1. The manual path is still guarded ---');

  const t = await makeTournament('guard', { minRegistrations: 8 });
  await register(t.id, 'guard-1');
  await applyTransition(t.id, 'OPEN_REGISTRATION', { runBy: 'test' });

  // The reconciler now avoids tripping this guard by cancelling instead, but the
  // admin "Close registration" button still calls applyTransition with
  // force:false and has nothing else between it and a field too small to seed.
  let refused = false;
  let message = '';
  try {
    await applyTransition(t.id, 'CLOSE_REGISTRATION', { runBy: 'test' });
  } catch (error) {
    refused = true;
    message = error instanceof Error ? error.message : String(error);
  }
  check(
    'REGRESSION: a manual CLOSE_REGISTRATION below the minimum is still refused',
    refused,
    'the guard that protects the admin button was removed',
  );
  check(
    'the refusal names the shortfall',
    /1 eligible registration/.test(message) && /8 are required/.test(message),
    message,
  );

  const after = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
  check(
    'the refused transition left the tournament where it was',
    after.status === 'REGISTRATION_OPEN',
    after.status,
  );
  check(
    'and did not cancel it — a refusal is not a cancellation',
    after.cancelledAt === null,
  );

  // force is the documented override, and it must still work.
  await applyTransition(t.id, 'CLOSE_REGISTRATION', {
    runBy: 'test',
    force: true,
  });
  const forced = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
  check(
    'force still overrides the guard for an operator who means it',
    forced.status === 'REGISTRATION_CLOSED',
    forced.status,
  );
}

// ---------------------------------------------------------------------------
// 2. An under-subscribed tournament cancels itself
// ---------------------------------------------------------------------------

async function autoCancelChecks() {
  console.log('\n--- 2. Under-subscribed: the schedule cancels it ---');

  const t = await makeTournament('auto', {
    minRegistrations: 8,
    passPriceMinor: 50_000,
  });
  await register(t.id, 'auto-1', 50_000);

  // One tick. Nothing else. The path is [OPEN_REGISTRATION, CLOSE_REGISTRATION]
  // and the second step is where the decision happens.
  await tick();

  const after = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
  check(
    'the tournament cancelled itself with no operator action',
    after.status === 'CANCELLED',
    after.status,
  );
  check(
    'the reason is recorded, not left null',
    after.cancellationReason === INSUFFICIENT_REGISTRATIONS,
    String(after.cancellationReason),
  );
  check('cancelledAt was stamped', after.cancelledAt !== null);

  // Registration still opened on the way through — that transition was
  // legitimate and its work (the public window) really happened.
  const opened = await db.opsEvent.findFirst({
    where: { tournamentId: t.id, idempotencyKey: { contains: 'CANCEL' } },
  });
  check('the CANCEL was recorded as an ops event', opened !== null);

  // The rest of the path must have been abandoned rather than attempted.
  const rounds = await db.round.count({ where: { tournamentId: t.id } });
  check(
    'no simulation rounds were created — the remaining path was abandoned',
    rounds === 0,
    `${rounds} rounds`,
  );

  return t.id;
}

// ---------------------------------------------------------------------------
// 3. A healthy tournament is untouched
// ---------------------------------------------------------------------------

async function healthyChecks() {
  console.log(
    '\n--- 3. A tournament that met its minimum is not cancelled ---',
  );

  const t = await makeTournament('healthy', { minRegistrations: 2 });
  await register(t.id, 'healthy-1');
  await register(t.id, 'healthy-2');

  await tick();

  const after = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
  check(
    'registration closed normally',
    after.status === 'REGISTRATION_CLOSED',
    after.status,
  );
  check('it was not cancelled', after.cancelledAt === null);
  check(
    'the frozen field count is the eligible count',
    after.participantCount === 2,
    String(after.participantCount),
  );
}

// ---------------------------------------------------------------------------
// 4. Notifications and refunds
// ---------------------------------------------------------------------------

async function cleanupWorkChecks(cancelledId: string) {
  console.log('\n--- 4. Everyone is told, and everyone is repaid ---');

  const notifications = await db.notification.findMany({
    where: { tournamentId: cancelledId, type: 'TOURNAMENT_CANCELLED' },
  });
  check(
    'every registrant was notified',
    notifications.length === 1,
    `${notifications.length} notifications`,
  );

  const payments = await db.payment.findMany({
    where: { tournamentId: cancelledId },
  });
  check(
    'the paid entry was refunded',
    payments.length === 1 && payments[0]?.status === 'REFUNDED',
    payments.map((p) => p.status).join(','),
  );
  check(
    'the refund recorded a provider refund id',
    payments[0]?.providerRefundId !== null,
  );

  const registrations = await db.registration.findMany({
    where: { tournamentId: cancelledId },
  });
  check(
    'the registration is marked REFUNDED',
    registrations[0]?.status === 'REFUNDED',
    String(registrations[0]?.status),
  );

  const job = await db.evaluationJob.findUnique({
    where: { idempotencyKey: `cancel-cleanup:${cancelledId}` },
  });
  check(
    'the cleanup job reached DONE',
    job?.status === 'DONE',
    String(job?.status),
  );

  // Idempotency: the sweep re-offers this every 30s forever until archival, so
  // a second pass must not notify twice or refund twice.
  await tick();
  const afterSecond = await db.notification.count({
    where: { tournamentId: cancelledId, type: 'TOURNAMENT_CANCELLED' },
  });
  check(
    'a second sweep does not notify anyone twice',
    afterSecond === 1,
    `${afterSecond} notifications`,
  );
  const refundedAgain = await db.payment.findMany({
    where: { tournamentId: cancelledId },
  });
  check(
    'and does not refund twice',
    refundedAgain.length === 1 && refundedAgain[0]?.status === 'REFUNDED',
  );
}

async function freeTournamentChecks() {
  console.log('\n--- 5. A free tournament has nothing to refund ---');

  const t = await makeTournament('free', { minRegistrations: 8 });
  await register(t.id, 'free-1');
  await tick();

  const after = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
  check('a free tournament still cancels', after.status === 'CANCELLED');

  const job = await db.evaluationJob.findUnique({
    where: { idempotencyKey: `cancel-cleanup:${t.id}` },
  });
  check(
    'cleanup completes rather than failing on zero payments',
    job?.status === 'DONE',
    `${job?.status}: ${job?.lastError ?? ''}`,
  );
  const notified = await db.notification.count({
    where: { tournamentId: t.id, type: 'TOURNAMENT_CANCELLED' },
  });
  check('the registrant was still notified', notified === 1);

  const diagnostics = await getLifecycleDiagnostics(t.id);
  check(
    'diagnostics report no refunds rather than "0 refunded"',
    diagnostics?.cancellation?.refunds === null,
    JSON.stringify(diagnostics?.cancellation?.refunds),
  );
}

// ---------------------------------------------------------------------------
// 6. Archival
// ---------------------------------------------------------------------------

async function archivalChecks(cancelledId: string) {
  console.log('\n--- 6. It leaves the site, but only once it is settled ---');

  const before = await db.tournament.findUniqueOrThrow({
    where: { id: cancelledId },
  });
  check(
    'a freshly cancelled tournament is NOT archived — the grace period is real',
    before.archivedAt === null,
  );

  // Age the cancellation past the grace window.
  await db.tournament.update({
    where: { id: cancelledId },
    data: { cancelledAt: new Date(Date.now() - ARCHIVE_GRACE_MS - 60_000) },
  });
  await tick();

  const archived = await db.tournament.findUniqueOrThrow({
    where: { id: cancelledId },
  });
  check(
    'once the grace period has passed and cleanup is done, it archives itself',
    archived.archivedAt !== null,
  );

  // And the money case: a tournament whose cleanup has NOT completed must stay
  // visible rather than being tidied away still owing somebody a refund.
  const stuck = await makeTournament('stuck', {
    minRegistrations: 8,
    passPriceMinor: 50_000,
  });
  await register(stuck.id, 'stuck-1', 50_000);
  await applyTransition(stuck.id, 'CANCEL', {
    runBy: 'test',
    reason: INSUFFICIENT_REGISTRATIONS,
  });
  await db.tournament.update({
    where: { id: stuck.id },
    data: { cancelledAt: new Date(Date.now() - ARCHIVE_GRACE_MS - 60_000) },
  });
  // Occupy the cleanup key with a job that is not DONE, as a failing one would.
  await db.evaluationJob.create({
    data: {
      name: 'cancelTournamentCleanup',
      type: 'EVALUATE',
      payload: { tournamentId: stuck.id },
      idempotencyKey: `cancel-cleanup:${stuck.id}`,
      status: 'FAILED',
      attempts: 5,
      maxAttempts: 5,
      lastError: 'gateway unavailable',
    },
  });
  await sweepDueWork(new Date());

  const stillThere = await db.tournament.findUniqueOrThrow({
    where: { id: stuck.id },
  });
  check(
    'a tournament that still owes a refund is NOT archived past its grace period',
    stillThere.archivedAt === null,
    'archiving it would hide a failed refund from the admin list',
  );

  const diagnostics = await getLifecycleDiagnostics(stuck.id);
  check(
    'and the admin panel can see why, without opening psql',
    diagnostics?.cancellation?.cleanupError === 'gateway unavailable',
    String(diagnostics?.cancellation?.cleanupError),
  );
  check(
    'including how much money is still outstanding',
    diagnostics?.cancellation?.refunds?.awaitingRefund === 1,
    JSON.stringify(diagnostics?.cancellation?.refunds),
  );
}

// ---------------------------------------------------------------------------
// 7. Cancellation is terminal
// ---------------------------------------------------------------------------

async function terminalChecks(cancelledId: string) {
  console.log('\n--- 7. Cancellation is terminal ---');

  // Extending the window is the documented unwedge path for a BLOCKED
  // tournament. It must not resurrect a cancelled one.
  const future = new Date(Date.now() + 7 * 24 * 60 * 60_000);
  let rejected = false;
  try {
    await updateTournamentSchedule(cancelledId, {
      registrationClosesAt: future,
    });
  } catch {
    rejected = true;
  }

  await tick();
  const after = await db.tournament.findUniqueOrThrow({
    where: { id: cancelledId },
  });
  check(
    'extending the schedule afterwards does not reopen a cancelled tournament',
    after.status === 'CANCELLED',
    `${after.status}${rejected ? ' (edit itself was refused)' : ''}`,
  );

  // OPEN_REGISTRATION already ran on this tournament before it cancelled, so its
  // idempotency key is DONE and a replay collapses onto the recorded result
  // rather than throwing. That is the correct outcome — `applied: false`, no
  // state change — and worth asserting explicitly, because "it threw" would be
  // the wrong thing to depend on.
  const replay = await applyTransition(cancelledId, 'OPEN_REGISTRATION', {
    runBy: 'test',
  });
  check(
    'replaying an already-applied transition is an idempotent no-op, not a reopen',
    replay.applied === false && replay.to === 'CANCELLED',
    `applied=${replay.applied} to=${replay.to}`,
  );

  // A transition that never ran has no recorded result to collapse onto, so the
  // state machine itself has to refuse it. This is the real terminality check.
  let refused = false;
  let message = '';
  try {
    await applyTransition(cancelledId, 'START_SIMULATION', { runBy: 'test' });
  } catch (error) {
    refused = true;
    message = error instanceof Error ? error.message : String(error);
  }
  check(
    'and the state machine refuses a fresh transition out of CANCELLED',
    refused,
    message,
  );

  const final = await db.tournament.findUniqueOrThrow({
    where: { id: cancelledId },
  });
  check(
    'the tournament is still CANCELLED after both attempts',
    final.status === 'CANCELLED',
    final.status,
  );
}

async function main() {
  await cleanup();
  try {
    await guardChecks();
    const cancelledId = await autoCancelChecks();
    await healthyChecks();
    await cleanupWorkChecks(cancelledId);
    await freeTournamentChecks();
    await archivalChecks(cancelledId);
    await terminalChecks(cancelledId);
  } finally {
    await cleanup();
  }

  console.log(
    failures === 0
      ? '\nAutomatic cancellation verified.'
      : `\n${failures} check(s) FAILED.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
