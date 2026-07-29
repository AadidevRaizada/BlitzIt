import './load-env';
import type { AddressInfo } from 'node:net';
import { db } from '../src/server/db';
import {
  evaluateAssertion,
  httpAssertionSchema,
} from '../src/server/modules/evaluation/strategies/rest-api';
import {
  createReferenceServer,
  type Flaw,
} from './reference/payment-lifecycle';

/**
 * End-to-end check of one authored challenge against a reference implementation.
 *
 * Run: npm run verify:challenge
 *
 * ## What this proves
 *
 * That the hidden tests are RIGHT. `verify:problems` proves every spec parses;
 * it cannot tell you whether the expectations are achievable. A test asserting
 * `201` where the statement implies `200`, or a jsonPath naming a field the
 * statement never defines, sails through validation and then scores every
 * competitor zero, silently, mid-tournament. That defect is invisible until it
 * has already cost somebody a place in the bracket.
 *
 * So: a reference implementation is written from the published statement, the
 * seeded specs are replayed against it in `sequence` order, and every one must
 * pass. Then knowingly-broken variants are run, and the tests that target each
 * broken rule must FAIL. A suite that only ever sees a correct solution has not
 * been shown to discriminate between a good answer and a plausible one.
 *
 * ## What it does not prove
 *
 * The network layer. `safeFetch` refuses loopback addresses on purpose (T1), so
 * the requests here go through plain `fetch` while the ASSERTIONS use the
 * evaluator's own `evaluateAssertion` — the same function `runFunctional` calls,
 * imported rather than reimplemented. Egress control is covered by
 * `verify:evaluation`; a real public deployment is covered by running a
 * tournament.
 */

let failures = 0;
function check(label: string, condition: boolean, detail?: string) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`);
  if (!condition) {
    failures++;
    if (detail) console.log(`      ${detail}`);
  }
}

const SLUG = 'payment-lifecycle';

interface SpecRow {
  sequence: number;
  name: string;
  weight: number;
  spec: unknown;
}

/** Replay every spec in order. Returns the tests that failed, by sequence. */
async function replay(
  baseUrl: string,
  rows: SpecRow[],
): Promise<{ failed: Set<number>; earned: number; total: number }> {
  const failed = new Set<number>();
  let earned = 0;
  let total = 0;

  for (const row of rows) {
    const parsed = httpAssertionSchema.safeParse(row.spec);
    if (!parsed.success) {
      failed.add(row.sequence);
      total += row.weight;
      continue;
    }
    const assertion = parsed.data;
    total += row.weight;

    const startedAt = Date.now();
    let status = 0;
    let text = '';
    try {
      const response = await fetch(new URL(assertion.path, baseUrl), {
        method: assertion.method,
        headers: {
          ...(assertion.headers ?? {}),
          ...(assertion.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body:
          assertion.body === undefined
            ? undefined
            : JSON.stringify(assertion.body),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      failed.add(row.sequence);
      console.log(
        `      #${row.sequence} ${row.name}: request failed — ${String(error)}`,
      );
      continue;
    }

    // The judge's own assertion logic, not a copy of it.
    const problems = evaluateAssertion(assertion, {
      status,
      body: text,
      durationMs: Date.now() - startedAt,
    });
    if (problems.length === 0) {
      earned += row.weight;
    } else {
      failed.add(row.sequence);
      console.log(
        `      #${row.sequence} ${row.name}: ${problems.join('; ')} ` +
          `(got ${status} ${text.slice(0, 160)})`,
      );
    }
  }

  return { failed, earned, total };
}

async function withServer<T>(
  flaws: Flaw[],
  fn: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = createReferenceServer(flaws);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function main() {
  const problem = await db.problem.findUnique({
    where: { slug: SLUG },
    include: { hiddenTests: { orderBy: { sequence: 'asc' } } },
  });
  if (!problem) {
    console.log(`Problem "${SLUG}" is not seeded. Run npm run seed:problems.`);
    process.exitCode = 1;
    return;
  }

  const rows: SpecRow[] = problem.hiddenTests.map((t) => ({
    sequence: t.sequence,
    name: t.name,
    weight: t.weight,
    spec: t.spec,
  }));

  console.log(
    `\n--- ${SLUG}: ${rows.length} hidden tests against a correct implementation ---`,
  );
  const correct = await withServer([], (base) => replay(base, rows));
  check(
    'a correct implementation passes every hidden test',
    correct.failed.size === 0,
    `${correct.failed.size} failed: ${[...correct.failed].join(', ')}`,
  );
  const score = Math.round((correct.earned / correct.total) * 100);
  check(
    'and therefore scores 100 on the functional dimension',
    score === 100,
    `scored ${score} (${correct.earned}/${correct.total})`,
  );

  // Each flaw must be CAUGHT. This is what makes the suite a discriminator
  // rather than a formality.
  console.log('\n--- the same tests against knowingly-broken variants ---');

  const clamp = await withServer(['clamp-capture'], (base) =>
    replay(base, rows),
  );
  check(
    'clamping an over-capture instead of refusing it is caught',
    clamp.failed.size > 0,
    'the over-capture test did not discriminate',
  );

  const refundBase = await withServer(['refund-against-authorized'], (base) =>
    replay(base, rows),
  );
  check(
    'capping refunds by the authorized amount instead of the captured amount is caught',
    refundBase.failed.size > 0,
    'the refund-ceiling test did not discriminate — this is the challenge’s main discriminator',
  );

  const voidAfter = await withServer(['allow-void-after-capture'], (base) =>
    replay(base, rows),
  );
  check(
    'permitting a void after a capture is caught',
    voidAfter.failed.size > 0,
    'the void/capture asymmetry test did not discriminate',
  );

  console.log(
    `\nBroken variants scored ` +
      `${Math.round((clamp.earned / clamp.total) * 100)} / ` +
      `${Math.round((refundBase.earned / refundBase.total) * 100)} / ` +
      `${Math.round((voidAfter.earned / voidAfter.total) * 100)} ` +
      `against 100 for the correct one.`,
  );

  console.log(
    failures === 0
      ? '\nChallenge verified end to end.'
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
