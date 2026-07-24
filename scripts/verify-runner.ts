import 'dotenv/config';
import { queue, enqueueNoop } from '../src/server/jobs';
import { processors } from '../src/server/jobs/processors';

/**
 * Milestone 0 acceptance check (E0.5 DoD): prove the Postgres-backed job loop.
 *
 * Prerequisites: DATABASE_URL set + schema applied (`npm run prisma:migrate`
 * or `npx prisma db push`). Then run: `npx tsx scripts/verify-runner.ts`.
 *
 * Enqueues a no-op job, claims it via FOR UPDATE SKIP LOCKED, runs its
 * processor, marks it complete, and asserts the terminal state.
 */
async function main() {
  const jobId = await enqueueNoop({ hello: 'blitz-it', at: Date.now() });
  console.log(`enqueued noop job: ${jobId}`);

  const claimed = await queue.claim(1, 'verify-script');
  if (claimed.length === 0) throw new Error('FAIL: no job claimed');
  const job = claimed[0]!;
  console.log(`claimed job: ${job.id} (name=${job.name})`);

  const processor = processors[job.name];
  if (!processor) throw new Error(`FAIL: no processor for "${job.name}"`);
  await processor(job);
  await queue.complete(job.id);

  console.log('\n✅ PASS — no-op job claimed and completed via SKIP LOCKED');
  process.exit(0);
}

main().catch((e) => {
  console.error('\n❌ FAIL —', e);
  process.exit(1);
});
