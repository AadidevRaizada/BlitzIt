/**
 * Next.js instrumentation hook. Runs once when the server process starts.
 * Boots the in-process Evaluation Runner (D3) — but only in the Node.js runtime.
 *
 * The Node-only code lives in `instrumentation-node.ts` (which imports the
 * Postgres driver) so the Edge build of this file never bundles `pg`.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
