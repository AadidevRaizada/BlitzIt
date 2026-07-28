import './load-env';
import { db } from '../src/server/db';
import { queue } from '../src/server/jobs/pg-queue';
import { processors } from '../src/server/jobs/processors';
import {
  sweepDueWork,
  LIFECYCLE_BUCKET_MS,
} from '../src/server/jobs/progress-sweep';
import {
  dueScheduledTransition,
  nextScheduledStep,
  type ScheduledTournament,
} from '../src/server/modules/tournament/schedule.public';
import { DEFAULT_SIMULATION_DURATIONS } from '../src/server/modules/tournament/config.public';

/**
 * Schedule-driven lifecycle acceptance.
 *
 * Proves the claim the product now makes: **a tournament runs itself.** The
 * schedule is the source of truth, and a countdown reaching zero causes the
 * thing it counted down to.
 *
 * The end-to-end scenario applies ZERO transitions by hand. It only ever runs
 * the sweep and drains the queue — exactly what the runner does every 30
 * seconds in production — and asserts the tournament walks from DRAFT to
 * COMPLETED on its own.
 *
 * Run: npm run verify:schedule
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

const TAG = 'sched-verify';
const EMAIL_DOMAIN = 'schedule-verify.test';

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
  // A tournament that reaches COMPLETED publishes a Hall of Fame and awards
  // badges. Keyed off the USER, not the tournament: these rows outlive the
  // tournament row, so a run that died midway leaves them orphaned and a
  // tournament-scoped delete would no longer find them — which is exactly how
  // the second run of this script started failing on a foreign key.
  await db.userBadge.deleteMany({
    where: { user: { email: { endsWith: EMAIL_DOMAIN } } },
  });
  // HallOfFame cascades from Tournament and holds bare id columns rather than
  // relations, so it needs no user-keyed sweep.
  await db.hallOfFame.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.payout.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.payment.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.ranking.deleteMany({ where });
  await db.registration.deleteMany({ where });
  // Notification carries a bare `tournamentId` with no relation, so it cannot
  // be filtered through the tournament the way the others are.
  await db.notification.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.opsEvent.deleteMany({ where: { tournamentId: { in: ids } } });
  await db.round.deleteMany({ where });
  await db.tournament.deleteMany({ where: { slug: { contains: TAG } } });
  // Queue keys embed the tournament or round id, never the tag.
  for (const id of ids) {
    await db.evaluationJob.deleteMany({
      where: { idempotencyKey: { contains: id } },
    });
  }
  await db.user.deleteMany({ where: { email: { endsWith: EMAIL_DOMAIN } } });
  await db.problem.deleteMany({ where: { slug: { contains: TAG } } });
}

/**
 * Run every runnable job to completion, the way the runner would.
 *
 * Bounded: a guard that keeps refusing must not spin this forever. Returns how
 * many jobs actually ran so a caller can assert progress happened.
 */
async function drain(maxPasses = 40): Promise<number> {
  let ran = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const jobs = await queue.claim(20, `verify-${pass}`);
    if (jobs.length === 0) return ran;
    for (const job of jobs) {
      const processor = processors[job.name];
      if (!processor) {
        await queue.complete(job.id, `verify-${pass}`);
        continue;
      }
      try {
        await processor(job);
        await queue.complete(job.id, `verify-${pass}`);
        ran++;
      } catch (error) {
        // A guard refusing is a legitimate outcome here — the next sweep will
        // re-enqueue. Record it as failed and move on, exactly as the runner
        // does, rather than aborting the scenario.
        // A real backoff, not zero. With zero the job is immediately
        // claimable again and this loop re-runs the same doomed job forty
        // times in a row, burying the actual failure in noise.
        await queue.fail(
          job.id,
          error instanceof Error ? error.message : String(error),
          60_000,
        );
      }
    }
  }
  return ran;
}

/**
 * One tick of the production loop: notice what is due, then do it.
 *
 * Each tick advances a virtual clock by a full lifecycle bucket. In production
 * the sweep runs every 30 seconds against a real clock, so consecutive attempts
 * naturally land in different idempotency buckets; compressing an entire
 * tournament into a few hundred milliseconds does not, and every retry after
 * the first would collapse into the previous bucket's key and be dropped.
 */
let virtualNow = Date.now();
async function tick(): Promise<void> {
  virtualNow += LIFECYCLE_BUCKET_MS;
  await sweepDueWork(new Date(virtualNow));
  await drain();
}

// ---------------------------------------------------------------------------
// 1. The pure mapping
// ---------------------------------------------------------------------------

function pureChecks() {
  console.log('\n--- 1. Schedule → transition mapping (pure) ---');

  const past = new Date('2026-01-01T00:00:00Z');
  const future = new Date('2099-01-01T00:00:00Z');
  const now = new Date('2026-06-01T00:00:00Z');

  const base: ScheduledTournament = {
    status: 'PUBLISHED',
    currentStage: null,
    registrationOpensAt: past,
    registrationClosesAt: past,
    simulationOpensAt: past,
    simulationClosesAt: past,
    liveStartsAt: past,
  };

  const expected: Array<[ScheduledTournament['status'], string | null]> = [
    ['DRAFT', 'PUBLISH'],
    ['PUBLISHED', 'OPEN_REGISTRATION'],
    ['REGISTRATION_OPEN', 'CLOSE_REGISTRATION'],
    ['REGISTRATION_CLOSED', 'START_SIMULATION'],
    ['SIMULATION', 'CLOSE_SIMULATION'],
    ['SEEDING', 'GENERATE_BRACKET'],
    ['BRACKET_GENERATED', 'START_KNOCKOUT'],
    ['LIVE', null],
    ['COMPLETED', null],
    ['CANCELLED', null],
  ];

  for (const [status, transition] of expected) {
    const actual = dueScheduledTransition({ ...base, status }, now);
    check(
      `${status} → ${transition ?? 'nothing automatic'}`,
      actual === transition,
      `got ${actual}`,
    );
  }

  // The anchor gates it: not due until the clock says so.
  check(
    'a future anchor is not due yet',
    dueScheduledTransition(
      { ...base, status: 'PUBLISHED', registrationOpensAt: future },
      now,
    ) === null,
  );
  check(
    'the same anchor fires once it passes',
    dueScheduledTransition(
      { ...base, status: 'PUBLISHED', registrationOpensAt: future },
      new Date('2099-06-01T00:00:00Z'),
    ) === 'OPEN_REGISTRATION',
  );

  // An unscheduled tournament must never be dragged forward by the sweep.
  check(
    'a DRAFT with no registration time stays put forever',
    nextScheduledStep({
      ...base,
      status: 'DRAFT',
      registrationOpensAt: null,
    }) === null,
  );
  check(
    'a PUBLISHED tournament with no registration time is not automated',
    nextScheduledStep({
      ...base,
      status: 'PUBLISHED',
      registrationOpensAt: null,
    }) === null,
  );

  // GENERATE_BRACKET has no anchor and must fire immediately.
  const seeding = nextScheduledStep({ ...base, status: 'SEEDING' });
  check(
    'GENERATE_BRACKET has no anchor and is due immediately',
    seeding?.dueAt === null &&
      dueScheduledTransition({ ...base, status: 'SEEDING' }, now) ===
        'GENERATE_BRACKET',
  );

  // LIVE is round-driven, never clock-driven.
  check(
    'LIVE is never advanced by the schedule sweep',
    nextScheduledStep({ ...base, status: 'LIVE', currentStage: 'QF' }) === null,
  );
}

// ---------------------------------------------------------------------------
// 2. The whole lifecycle, hands off
// ---------------------------------------------------------------------------

async function endToEnd() {
  console.log('\n--- 2. DRAFT → COMPLETED with no manual transition ---');

  const problem = await db.problem.create({
    data: {
      slug: `p-${TAG}`,
      title: 'Schedule verification problem',
      statementMarkdown: 'Return 200 from /health.',
      category: 'REST_API',
      evaluationStrategy: 'REST_API',
      contractSpec: {},
      visibility: 'PUBLISHED',
    },
  });

  // Everything in the past, so every milestone is due the moment we look.
  const past = (minutesAgo: number) =>
    new Date(Date.now() - minutesAgo * 60_000);

  const tournament = await db.tournament.create({
    data: {
      slug: `${TAG}-e2e`,
      name: 'Schedule E2E',
      status: 'DRAFT',
      visibility: 'PUBLIC',
      passPriceMinor: 0,
      registrationOpensAt: past(120),
      registrationClosesAt: past(110),
      simulationOpensAt: past(100),
      simulationClosesAt: past(10),
      liveStartsAt: past(5),
      thirdPlaceEnabled: false,
    },
  });

  // Exactly the minimum field, so the draw is a full 8 with no byes.
  const users = await Promise.all(
    Array.from({ length: 8 }, (_, index) =>
      db.user.create({
        data: {
          authUserId: `auth-${TAG}-${index}`,
          email: `sched-${index}@${EMAIL_DOMAIN}`,
          username: `sched-${index}-${TAG}`,
          displayName: `Scheduled ${index}`,
          profile: { create: {} },
        },
      }),
    ),
  );
  await db.registration.createMany({
    data: users.map((user) => ({
      userId: user.id,
      tournamentId: tournament.id,
      status: 'ACTIVE' as const,
    })),
  });

  const statusNow = async () =>
    (
      await db.tournament.findUniqueOrThrow({
        where: { id: tournament.id },
        select: { status: true },
      })
    ).status;

  // --- DRAFT → PUBLISHED → REGISTRATION_OPEN ---
  await tick();
  check(
    'a DRAFT with a due registration time publishes itself',
    (await statusNow()) !== 'DRAFT',
    await statusNow(),
  );

  await tick();
  check(
    'registration opens automatically',
    ['REGISTRATION_OPEN', 'REGISTRATION_CLOSED'].includes(await statusNow()),
    await statusNow(),
  );

  // --- registration closes, simulation starts ---
  await tick();
  await tick();
  const afterRegistration = await statusNow();
  check(
    'registration closes automatically once its time passes',
    afterRegistration !== 'REGISTRATION_OPEN',
    afterRegistration,
  );

  // START_SIMULATION refuses while any simulation round has no problem — the
  // guard added after the production deadlock. Assign, exactly as an operator
  // would have done during setup, then let the schedule do the rest.
  const created = await db.round.findMany({
    where: { tournamentId: tournament.id, type: 'SIMULATION' },
    select: { id: true },
  });
  check(
    'closing registration created the three simulation rounds',
    created.length === DEFAULT_SIMULATION_DURATIONS.length,
    `${created.length} rounds`,
  );
  await db.round.updateMany({
    where: { tournamentId: tournament.id, problemId: null },
    data: { problemId: problem.id },
  });

  await tick();
  check(
    'simulation starts automatically',
    ['SIMULATION', 'SEEDING'].includes(await statusNow()),
    await statusNow(),
  );

  // --- simulation rounds progress on their own deadlines ---
  // Backdate each open round's deadline rather than waiting 30 real minutes:
  // the sweep keys off `deadlineAt <= now()`, so this is the same code path a
  // genuine expiry takes.
  for (let pass = 0; pass < 8; pass++) {
    await db.round.updateMany({
      where: {
        tournamentId: tournament.id,
        type: 'SIMULATION',
        status: 'OPEN',
      },
      data: { deadlineAt: past(1) },
    });
    await tick();
    if ((await statusNow()) !== 'SIMULATION') break;
  }

  const simulationRounds = await db.round.count({
    where: {
      tournamentId: tournament.id,
      type: 'SIMULATION',
      status: 'COMPLETED',
    },
  });
  check(
    'all three simulation rounds progressed without intervention',
    simulationRounds === DEFAULT_SIMULATION_DURATIONS.length,
    `${simulationRounds} completed`,
  );

  // --- seeding → bracket → knockout ---
  await tick();
  await tick();
  const seeded = await db.ranking.count({
    where: { tournamentId: tournament.id, qualified: true },
  });
  check(
    'seeding ran automatically and qualified the field',
    seeded === 8,
    `${seeded}`,
  );

  const matches = await db.match.count({
    where: { tournamentId: tournament.id },
  });
  check(
    'the bracket generated automatically',
    matches === 7,
    `${matches} matches`,
  );

  // Knockout rounds need a problem for the same reason simulation rounds do —
  // `openRound` refuses to reveal a round with nothing to solve. GENERATE_BRACKET
  // creates them empty, so this is content setup, not lifecycle driving: the
  // operator picks the challenges once, up front, and never touches the
  // lifecycle again.
  await db.round.updateMany({
    where: { tournamentId: tournament.id, type: 'KNOCKOUT', problemId: null },
    data: { problemId: problem.id },
  });

  await tick();
  check(
    'the knockout begins automatically',
    (await statusNow()) === 'LIVE',
    await statusNow(),
  );

  // --- knockout rounds run to completion ---
  // Nobody submits, so every match resolves by the double-no-show rule once its
  // window closes. That is the point: no human touches this.
  for (let pass = 0; pass < 12; pass++) {
    await db.round.updateMany({
      where: { tournamentId: tournament.id, type: 'KNOCKOUT', status: 'OPEN' },
      data: { deadlineAt: past(1) },
    });
    await tick();
    if ((await statusNow()) === 'COMPLETED') break;
  }

  const final = await statusNow();
  check('the tournament completes automatically', final === 'COMPLETED', final);

  const champion = await db.ranking.findFirst({
    where: { tournamentId: tournament.id, placement: 1 },
    select: { userId: true },
  });
  check('a champion was crowned', champion !== null);

  // The whole point: prove no human drove this. Every transition is recorded
  // as an OpsEvent stamped with who ran it; nothing here may carry an operator.
  const events = await db.opsEvent.findMany({
    where: { tournamentId: tournament.id },
    select: { type: true, runBy: true },
  });
  const automated = new Set(['schedule', 'system', 'runner', 'cron']);
  const manual = events.filter(
    (event) => event.runBy === null || !automated.has(event.runBy),
  );
  check(
    'ZERO operator-driven transitions were required',
    manual.length === 0,
    manual.map((m) => `${m.type} by ${m.runBy}`).join(', '),
  );
  check(
    'the schedule sweep is what drove it',
    events.some((event) => event.runBy === 'schedule'),
    events.map((e) => `${e.type}:${e.runBy}`).join(', '),
  );
}

async function main() {
  await cleanup();
  try {
    pureChecks();
    await endToEnd();
  } finally {
    await cleanup();
    await db.$disconnect();
  }

  console.log('');
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED.`);
    process.exit(1);
  }
  console.log('Schedule-driven lifecycle verified.');
}

void main();
