import 'server-only';
import { startRunner } from '@/server/jobs/runner';

// Node.js-only instrumentation. Isolated in its own module so the Edge runtime
// build of instrumentation.ts never pulls in the Postgres driver (pg needs Node
// APIs like `fs`). Imported dynamically from register() under the nodejs runtime.
startRunner();
