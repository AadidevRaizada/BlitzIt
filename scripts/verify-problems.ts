import './load-env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import {
  contractSpecSchema,
  httpAssertionSchema,
} from '../src/server/modules/evaluation/strategies/rest-api';

/**
 * Validates every authored problem against the contract the evaluator actually
 * enforces.
 *
 * Run:  npm run verify:problems
 *
 * This matters because a malformed hidden-test spec does not raise an error at
 * authoring time — `runFunctional` catches the parse failure and records the
 * test as *failed* with "Malformed test specification". Competitors would lose
 * marks for our typo, silently, mid-tournament. Checking here is the only
 * point at which that is cheap to catch.
 *
 * The schemas are imported from the strategy itself rather than copied, so
 * this cannot drift from what the judge really accepts. That is also why the
 * script runs under `--conditions=react-server`: the strategy is `server-only`.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const problems = await db.problem.findMany({
    include: { hiddenTests: { orderBy: { sequence: 'asc' } } },
    orderBy: { slug: 'asc' },
  });

  if (problems.length === 0) {
    console.log('No problems found. Run `npm run seed:problems` first.');
    return;
  }

  let failures = 0;

  for (const problem of problems) {
    const contract = contractSpecSchema.safeParse(problem.contractSpec);
    const weight = problem.hiddenTests.reduce((sum, t) => sum + t.weight, 0);

    console.log(
      `\n${problem.slug}  [${problem.visibility} / ${problem.category} / ${problem.evaluationStrategy}]  ` +
        `${problem.hiddenTests.length} tests, weight ${weight}`,
    );

    if (!contract.success) {
      failures++;
      console.log(`  FAIL  contractSpec: ${contract.error.issues[0]?.message}`);
    } else {
      console.log(
        `  ok    contractSpec healthPath=${contract.data.healthPath ?? '/'} ` +
          `samples=${contract.data.performanceSamples ?? 6}`,
      );
    }

    if (problem.hiddenTests.length === 0) {
      failures++;
      console.log('  FAIL  no hidden tests — functional score would be 0/0');
    }

    for (const test of problem.hiddenTests) {
      const parsed = httpAssertionSchema.safeParse(test.spec);
      if (!parsed.success) {
        failures++;
        const detail = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        console.log(`  FAIL  #${test.sequence} ${test.name} — ${detail}`);
        continue;
      }

      const { method, path, expect } = parsed.data;
      // An assertion with nothing to assert always passes, which is worse than
      // useless: it inflates every competitor's functional score equally.
      const asserts =
        expect.status !== undefined ||
        (expect.jsonPath?.length ?? 0) > 0 ||
        (expect.bodyContains?.length ?? 0) > 0 ||
        expect.maxDurationMs !== undefined;
      if (!asserts) {
        failures++;
        console.log(`  FAIL  #${test.sequence} ${test.name} — asserts nothing`);
        continue;
      }

      console.log(
        `  ok    #${test.sequence} w${String(test.weight).padEnd(2)} ` +
          `${method.padEnd(4)} ${path.padEnd(12)} ${test.name}`,
      );
    }
  }

  console.log(
    failures === 0
      ? `\nAll specs valid across ${problems.length} problem(s).`
      : `\n${failures} problem(s) with invalid specs.`,
  );
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
