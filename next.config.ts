import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root so Next doesn't infer a parent directory that
  // happens to contain another lockfile.
  outputFileTracingRoot: path.join(import.meta.dirname, '.'),
  // The in-process Evaluation Runner is booted from src/instrumentation.ts.
  // instrumentationHook is enabled by default in Next.js 15.
  experimental: {
    // Server Actions are enabled by default in Next 15; keep body size sane.
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
