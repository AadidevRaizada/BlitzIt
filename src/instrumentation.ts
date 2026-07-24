/**
 * Next.js instrumentation hook. Runs once when the server process starts.
 * Boots the in-process Evaluation Runner (D3) — but only in the Node.js runtime
 * (never Edge), and never during the build.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startRunner } = await import('@/server/jobs/runner');
  startRunner();
}
