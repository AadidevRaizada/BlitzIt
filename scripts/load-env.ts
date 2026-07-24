import { config } from 'dotenv';

// Side-effect module: load local env BEFORE any other import runs (ES module
// imports are hoisted, so this must be the very first import in an entrypoint).
// `.env.local` wins over `.env`; neither overrides the real shell environment.
config({ path: ['.env.local', '.env'] });
