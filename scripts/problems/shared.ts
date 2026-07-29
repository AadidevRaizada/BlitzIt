import type { Prisma } from '../../src/generated/prisma/client';

/**
 * Shared authoring types for the challenge catalogue.
 *
 * Kept in its own module so `seed-problems.ts` (the three published qualifier
 * problems) and `knockout.ts` (the D34-era catalogue) can share them without one
 * importing the other. This shape is deliberately self-contained — a
 * `ProblemSeed` carries its hidden tests nested and is keyed by slug, with no
 * identifier that only means something in one database — because it is also the
 * shape a future Admin Challenge Import will accept as JSON.
 *
 * See `docs/21-challenge-library.md` for the design and the review pass.
 */

export type HiddenTestSeed = {
  name: string;
  weight: number;
  timeoutMs?: number;
  /** Matches `httpAssertionSchema` in the REST_API strategy. */
  spec: Prisma.InputJsonObject;
};

export type ProblemSeed = {
  slug: string;
  title: string;
  difficulty: string;
  statementMarkdown: string;
  contractSpec: Prisma.InputJsonObject;
  visibility: 'DRAFT' | 'PUBLISHED';
  tests: HiddenTestSeed[];
};

export const SCORING_NOTE = `
## How this is scored

| Dimension | Weight | What it measures |
|---|---|---|
| Functional | 60% | Hidden HTTP tests against your deployment |
| Performance | 15% | p95 latency of \`GET /health\`, sampled sequentially |
| Security & reliability | 10% | HTTPS, security headers on \`/\`, no 5xx, no leaked stack traces |
| AI review | 15% | Code organisation, documentation, engineering judgement |

Notes that cost people marks every week:

- \`GET /\` must **not** return a 5xx and must not leak a stack trace.
- Security headers on \`/\` are graded. \`X-Powered-By\` being present is a
  deduction — most frameworks set it for you, so remove it.
- Return \`Content-Type: application/json\` on every JSON response.
- Unhandled errors must become a clean \`400\`/\`500\` JSON body, never a crash.
`.trim();

/**
 * Appended to every stateful challenge. Two rules the grader depends on, and it
 * is fairer to state both than to let someone discover them by losing marks.
 */
export const STATEFUL_NOTE = `
## State, storage and \`POST /_reset\`

This challenge is **stateful**: the grader sends a sequence of requests and
checks how your API managed what the earlier ones created.

- **Store it however you like.** An in-memory object, SQLite, Postgres, Redis —
  your call. Nothing is pre-loaded and you never need to run a migration or seed
  anything. A single deployed service is the whole requirement.
- **You must implement \`POST /_reset\`.** It clears all state and returns
  \`200\` with \`{ "ok": true }\`. The grader calls it **first**, and may replay
  the whole sequence if a run is retried, so a correct API must start from a
  known-empty state on demand.
- **Every id is supplied by the client.** The grader chooses ids; you never
  generate one. Re-sending a create with an id that already exists is an
  idempotent no-op that returns the existing record — not a duplicate, and not
  an error.
- Requests arrive **one at a time, in order.** You are not being graded on
  concurrency this week.
`.trim();

/** The health endpoint test, identical across every problem. */
export const healthTest: HiddenTestSeed = {
  name: 'health returns ok',
  weight: 1,
  timeoutMs: 8000,
  spec: {
    method: 'GET',
    path: '/health',
    expect: { status: 200, jsonPath: [{ path: 'status', equals: 'ok' }] },
  },
};

/** Clears state before the sequence proper. Always sequence 2, after health. */
export const resetTest: HiddenTestSeed = {
  name: 'reset clears all state',
  weight: 1,
  timeoutMs: 8000,
  spec: {
    method: 'POST',
    path: '/_reset',
    expect: { status: 200, jsonPath: [{ path: 'ok', equals: true }] },
  },
};

export const DEFAULT_CONTRACT: Prisma.InputJsonObject = {
  healthPath: '/health',
  performanceSamples: 6,
};
