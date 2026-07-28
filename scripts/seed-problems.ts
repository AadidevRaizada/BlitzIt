import './load-env';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client';

/**
 * Seeds the three Week-1 REST_API simulation problems and their hidden tests.
 *
 * Run:  npm run seed:problems
 *
 * Idempotent: problems are upserted by slug and their hidden tests are
 * replaced wholesale, so re-running after editing a spec is safe.
 *
 * ── How these were designed ───────────────────────────────────────────────
 *
 * The evaluator (src/server/modules/evaluation/strategies/rest-api.ts) grades
 * a running deployment purely over HTTP. Nothing is cloned, built or executed.
 * That shapes every choice below:
 *
 * 1. **Stateless and deterministic.** No problem requires a database or any
 *    persistence between requests. Competitors ship to whatever free tier they
 *    can reach in minutes, and serverless instances do not share memory — a
 *    problem needing cross-request state would grade the hosting lottery
 *    rather than the engineering.
 *
 * 2. **Every rule is stated exactly.** Hidden tests compare with
 *    `JSON.stringify(actual) === JSON.stringify(expected)`, so rounding,
 *    ordering and tie-breaks are specified to the letter in the statement. A
 *    competitor who reads carefully must be able to predict the output exactly;
 *    anything ambiguous would be graded as a coin flip.
 *
 * 3. **Leaf-path assertions only.** For the same reason, assertions target
 *    leaves (`byLevel.INFO`) rather than whole objects. Asserting a whole
 *    object would make JSON key order significant and fail correct solutions
 *    for cosmetic reasons.
 *
 * 4. **Difficulty descends with the clock.** Round 1 is 30 minutes, round 2 is
 *    20, round 3 is 10. Each problem is sized so that a competent developer
 *    using AI can ship and deploy inside its window — the PRD's premise is
 *    "15 Minutes. One Shot. Just Ship.", not puzzle-solving.
 *
 * 5. **Each has one real discriminator.** Every problem contains a rule that
 *    separates people who read the spec from people who guessed — the
 *    largest-remainder tie-break, the sort tie-break, the parameter-stripping
 *    list. That is what makes the leaderboard mean something when everyone has
 *    an AI assistant.
 *
 * 6. **`GET /health` on every problem.** `contractSpec.healthPath` is what the
 *    performance probe samples, and the security probe reads `/`. Both are
 *    documented in the statements because the scoring rubric is public
 *    (functional 60 / performance 15 / security 10 / AI review 15).
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not set');

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

type HiddenTestSeed = {
  name: string;
  weight: number;
  timeoutMs?: number;
  /** Matches `httpAssertionSchema` in the REST_API strategy. */
  spec: Prisma.InputJsonObject;
};

type ProblemSeed = {
  slug: string;
  title: string;
  difficulty: string;
  statementMarkdown: string;
  contractSpec: Prisma.InputJsonObject;
  tests: HiddenTestSeed[];
};

const SCORING_NOTE = `
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

const problems: ProblemSeed[] = [
  // ───────────────────────────── Round 1 · 30 min ─────────────────────────
  {
    slug: 'fare-split',
    title: 'Fare Split',
    difficulty: 'Medium',
    contractSpec: { healthPath: '/health', performanceSamples: 6 },
    statementMarkdown: `
# Fare Split

Ship a REST API that splits a bill across people by weight, in whole paise,
losing nothing to rounding.

Money is stored as an integer number of **paise** throughout. Never use floats
for the returned amounts.

## \`GET /health\`

\`\`\`json
{ "status": "ok" }
\`\`\`

Status \`200\`. This endpoint is sampled for your performance score, so keep it
trivial — no I/O.

## \`POST /split\`

Request:

\`\`\`json
{
  "totalPaise": 100000,
  "participants": [
    { "id": "a", "weight": 2 },
    { "id": "b", "weight": 1 }
  ]
}
\`\`\`

Response \`200\`:

\`\`\`json
{
  "totalPaise": 100000,
  "shares": [
    { "id": "a", "amountPaise": 66667 },
    { "id": "b", "amountPaise": 33333 }
  ]
}
\`\`\`

### The split rule — read this twice

Let \`W\` be the sum of all weights.

1. Each participant's **exact** share is \`totalPaise * weight / W\`.
2. Give each participant \`floor(exact)\`.
3. Some paise are now left over. Distribute them **one at a time** to the
   participants with the largest fractional remainder.
4. **Ties are broken by \`id\` ascending** (ordinary lexicographic string
   comparison), *not* by input order.
5. \`shares\` is returned in the **same order as the input \`participants\`
   array**, regardless of who received leftover paise.

The sum of every \`amountPaise\` **must equal \`totalPaise\` exactly.** This is
the single most common failure.

#### Worked example

\`totalPaise: 100\`, participants in this order: \`c\`, \`a\`, \`b\`, all weight 1.

- Exact share is \`33.333…\` each, so everyone gets \`33\`; that is \`99\`.
- One paisa is left over. All three remainders are equal, so the tie-break
  applies: \`a\` is lexicographically first and receives it.
- Output order still follows the input:

\`\`\`json
{ "totalPaise": 100, "shares": [
  { "id": "c", "amountPaise": 33 },
  { "id": "a", "amountPaise": 34 },
  { "id": "b", "amountPaise": 33 }
] }
\`\`\`

### Validation

Respond \`400\` with a JSON body containing an \`error\` string when:

- \`totalPaise\` is missing, not an integer, or negative;
- \`participants\` is missing, not an array, or empty;
- any \`weight\` is missing, not an integer, or less than 1;
- any \`id\` is missing, not a string, or duplicated.

\`totalPaise: 0\` is **valid** — every share is \`0\`.

${SCORING_NOTE}
`.trim(),
    tests: [
      {
        name: 'health returns ok',
        weight: 1,
        timeoutMs: 8000,
        spec: {
          method: 'GET',
          path: '/health',
          expect: {
            status: 200,
            jsonPath: [{ path: 'status', equals: 'ok' }],
          },
        },
      },
      {
        name: 'splits 2:1 and distributes the leftover paisa',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/split',
          body: {
            totalPaise: 100000,
            participants: [
              { id: 'a', weight: 2 },
              { id: 'b', weight: 1 },
            ],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'totalPaise', equals: 100000 },
              { path: 'shares.length', equals: 2 },
              { path: 'shares[0].id', equals: 'a' },
              { path: 'shares[0].amountPaise', equals: 66667 },
              { path: 'shares[1].id', equals: 'b' },
              { path: 'shares[1].amountPaise', equals: 33333 },
            ],
          },
        },
      },
      {
        // The discriminator: tie-break is by id, output order is by input.
        name: 'breaks remainder ties by id while preserving input order',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/split',
          body: {
            totalPaise: 100,
            participants: [
              { id: 'c', weight: 1 },
              { id: 'a', weight: 1 },
              { id: 'b', weight: 1 },
            ],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'shares[0].id', equals: 'c' },
              { path: 'shares[0].amountPaise', equals: 33 },
              { path: 'shares[1].id', equals: 'a' },
              { path: 'shares[1].amountPaise', equals: 34 },
              { path: 'shares[2].id', equals: 'b' },
              { path: 'shares[2].amountPaise', equals: 33 },
            ],
          },
        },
      },
      {
        name: 'distributes two leftover paise across a three-way tie',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/split',
          body: {
            totalPaise: 100001,
            participants: [
              { id: 'a', weight: 1 },
              { id: 'b', weight: 1 },
              { id: 'c', weight: 1 },
            ],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'shares[0].amountPaise', equals: 33334 },
              { path: 'shares[1].amountPaise', equals: 33334 },
              { path: 'shares[2].amountPaise', equals: 33333 },
            ],
          },
        },
      },
      {
        name: 'zero total is valid and yields zero shares',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/split',
          body: {
            totalPaise: 0,
            participants: [
              { id: 'a', weight: 3 },
              { id: 'b', weight: 7 },
            ],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'shares[0].amountPaise', equals: 0 },
              { path: 'shares[1].amountPaise', equals: 0 },
            ],
          },
        },
      },
      {
        name: 'rejects an empty participants array',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/split',
          body: { totalPaise: 500, participants: [] },
          expect: { status: 400 },
        },
      },
      {
        name: 'rejects a non-positive weight',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/split',
          body: {
            totalPaise: 500,
            participants: [
              { id: 'a', weight: 0 },
              { id: 'b', weight: 1 },
            ],
          },
          expect: { status: 400 },
        },
      },
      {
        name: 'rejects a negative total',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/split',
          body: { totalPaise: -1, participants: [{ id: 'a', weight: 1 }] },
          expect: { status: 400 },
        },
      },
      {
        name: 'rejects duplicate participant ids',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/split',
          body: {
            totalPaise: 100,
            participants: [
              { id: 'a', weight: 1 },
              { id: 'a', weight: 2 },
            ],
          },
          expect: { status: 400 },
        },
      },
    ],
  },

  // ───────────────────────────── Round 2 · 20 min ─────────────────────────
  {
    slug: 'log-triage',
    title: 'Log Triage',
    difficulty: 'Medium',
    contractSpec: { healthPath: '/health', performanceSamples: 6 },
    statementMarkdown: `
# Log Triage

Ship a REST API that parses raw log lines and reports which services are on
fire.

## \`GET /health\`

\`\`\`json
{ "status": "ok" }
\`\`\`

Status \`200\`. Sampled for your performance score — keep it trivial.

## \`POST /triage\`

Request:

\`\`\`json
{ "lines": [
  "2026-07-28T05:00:00Z INFO api request received",
  "2026-07-28T05:00:01Z ERROR auth invalid token",
  "garbage"
] }
\`\`\`

Response \`200\`:

\`\`\`json
{
  "total": 3,
  "malformed": 1,
  "byLevel": { "DEBUG": 0, "INFO": 1, "WARN": 0, "ERROR": 1, "FATAL": 0 },
  "topServices": [ { "service": "auth", "errors": 1 } ]
}
\`\`\`

### Line format

\`\`\`
<timestamp> <LEVEL> <service> <message…>
\`\`\`

Fields are separated by a single space. \`LEVEL\` is exactly one of
\`DEBUG\`, \`INFO\`, \`WARN\`, \`ERROR\`, \`FATAL\` (uppercase). The message is
everything after the service and **may contain spaces**. A line that does not
match this shape — including one whose level is not in the list — is
**malformed**.

### Output rules — read this twice

- \`total\` is the number of lines received, **including malformed ones**.
- \`malformed\` is the count of lines that could not be parsed.
- \`byLevel\` **always contains all five keys**, even when a level has a count
  of zero. It counts parsed lines only.
- \`topServices\` ranks services by their count of \`ERROR\` **plus** \`FATAL\`
  lines. \`WARN\` does not count.
  - Descending by \`errors\`.
  - **Ties are broken by service name ascending.**
  - Services with zero errors are **excluded entirely**.
  - At most **3** entries.

### Validation

Respond \`400\` with a JSON body containing an \`error\` string when \`lines\`
is missing or is not an array. An empty array is **valid**: every count is
\`0\` and \`topServices\` is \`[]\`.

${SCORING_NOTE}
`.trim(),
    tests: [
      {
        name: 'health returns ok',
        weight: 1,
        timeoutMs: 8000,
        spec: {
          method: 'GET',
          path: '/health',
          expect: {
            status: 200,
            jsonPath: [{ path: 'status', equals: 'ok' }],
          },
        },
      },
      {
        name: 'counts levels and ignores malformed lines',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/triage',
          body: {
            lines: [
              '2026-07-28T05:00:00Z INFO api request received',
              '2026-07-28T05:00:01Z ERROR auth invalid token',
              '2026-07-28T05:00:02Z WARN api slow query',
              '2026-07-28T05:00:03Z INFO api done',
              'not a log line',
            ],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'total', equals: 5 },
              { path: 'malformed', equals: 1 },
              { path: 'byLevel.DEBUG', equals: 0 },
              { path: 'byLevel.INFO', equals: 2 },
              { path: 'byLevel.WARN', equals: 1 },
              { path: 'byLevel.ERROR', equals: 1 },
              { path: 'byLevel.FATAL', equals: 0 },
            ],
          },
        },
      },
      {
        name: 'counts FATAL toward errors but not WARN',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/triage',
          body: {
            lines: [
              '2026-07-28T05:00:00Z FATAL payments disk full',
              '2026-07-28T05:00:01Z WARN payments retrying',
              '2026-07-28T05:00:02Z ERROR payments timeout',
            ],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'topServices.length', equals: 1 },
              { path: 'topServices[0].service', equals: 'payments' },
              { path: 'topServices[0].errors', equals: 2 },
            ],
          },
        },
      },
      {
        // The discriminator: equal error counts sort by name ascending.
        name: 'breaks ranking ties by service name ascending',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/triage',
          body: {
            lines: [
              '2026-07-28T05:00:00Z ERROR beta boom',
              '2026-07-28T05:00:01Z ERROR alpha boom',
            ],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'topServices[0].service', equals: 'alpha' },
              { path: 'topServices[1].service', equals: 'beta' },
            ],
          },
        },
      },
      {
        name: 'caps topServices at three and drops zero-error services',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/triage',
          body: {
            lines: [
              '2026-07-28T05:00:00Z ERROR s1 a',
              '2026-07-28T05:00:01Z ERROR s1 b',
              '2026-07-28T05:00:02Z ERROR s1 c',
              '2026-07-28T05:00:03Z ERROR s2 a',
              '2026-07-28T05:00:04Z ERROR s2 b',
              '2026-07-28T05:00:05Z ERROR s3 a',
              '2026-07-28T05:00:06Z ERROR s4 a',
              '2026-07-28T05:00:07Z INFO quiet nothing wrong',
            ],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'topServices.length', equals: 3 },
              { path: 'topServices[0].service', equals: 's1' },
              { path: 'topServices[0].errors', equals: 3 },
              { path: 'topServices[1].service', equals: 's2' },
              { path: 'topServices[2].service', equals: 's3' },
            ],
          },
        },
      },
      {
        name: 'keeps messages containing spaces parseable',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/triage',
          body: {
            lines: [
              '2026-07-28T05:00:00Z ERROR gateway upstream connection reset by peer',
            ],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'malformed', equals: 0 },
              { path: 'byLevel.ERROR', equals: 1 },
              { path: 'topServices[0].service', equals: 'gateway' },
            ],
          },
        },
      },
      {
        name: 'treats an unknown level as malformed',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/triage',
          body: { lines: ['2026-07-28T05:00:00Z TRACE api chatty'] },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'total', equals: 1 },
              { path: 'malformed', equals: 1 },
            ],
          },
        },
      },
      {
        name: 'accepts an empty lines array',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/triage',
          body: { lines: [] },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'total', equals: 0 },
              { path: 'malformed', equals: 0 },
              { path: 'byLevel.INFO', equals: 0 },
              { path: 'topServices.length', equals: 0 },
            ],
          },
        },
      },
      {
        name: 'rejects a non-array lines field',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/triage',
          body: { lines: 'nope' },
          expect: { status: 400 },
        },
      },
    ],
  },

  // ───────────────────────────── Round 3 · 10 min ─────────────────────────
  {
    slug: 'url-canonical',
    title: 'URL Canonicaliser',
    difficulty: 'Easy',
    contractSpec: { healthPath: '/health', performanceSamples: 6 },
    statementMarkdown: `
# URL Canonicaliser

Ten minutes. Ship a REST API that reduces messy URLs to one canonical form so
duplicates can be detected.

## \`GET /health\`

\`\`\`json
{ "status": "ok" }
\`\`\`

Status \`200\`. Sampled for your performance score — keep it trivial.

## \`POST /canonical\`

Request:

\`\`\`json
{ "urls": ["HTTP://Example.COM:80/Path?b=2&a=1#frag"] }
\`\`\`

Response \`200\`:

\`\`\`json
{ "results": [
  {
    "input": "HTTP://Example.COM:80/Path?b=2&a=1#frag",
    "canonical": "http://example.com/Path?a=1&b=2"
  }
] }
\`\`\`

\`results\` is in the **same order as the input**.

### Canonicalisation rules — apply all of them

1. Lowercase the **scheme** and the **host**. Leave the path's case alone.
2. Drop the port when it is the default: \`:80\` for \`http\`, \`:443\` for
   \`https\`.
3. Remove the fragment (\`#…\`) entirely.
4. Remove tracking parameters: any parameter whose name starts with
   \`utm_\`, plus exactly \`fbclid\` and \`gclid\`.
5. Sort the remaining parameters by name ascending; where names are equal,
   by value ascending.
6. If no parameters remain, emit **no** \`?\` at all.
7. An empty path becomes \`/\`. Any other path is left exactly as-is,
   including a trailing slash.
8. If the input cannot be parsed as a URL, \`canonical\` is \`null\` — this is
   **not** an error, and the entry still appears in \`results\`.

### Validation

Respond \`400\` with a JSON body containing an \`error\` string when \`urls\`
is missing or is not an array. An empty array is valid and returns
\`{ "results": [] }\`.

${SCORING_NOTE}
`.trim(),
    tests: [
      {
        name: 'health returns ok',
        weight: 1,
        timeoutMs: 8000,
        spec: {
          method: 'GET',
          path: '/health',
          expect: {
            status: 200,
            jsonPath: [{ path: 'status', equals: 'ok' }],
          },
        },
      },
      {
        name: 'lowercases scheme and host, drops the default port and fragment',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/canonical',
          body: { urls: ['HTTP://Example.COM:80/Path?b=2&a=1#frag'] },
          expect: {
            status: 200,
            jsonPath: [
              {
                path: 'results[0].canonical',
                equals: 'http://example.com/Path?a=1&b=2',
              },
            ],
          },
        },
      },
      {
        // The discriminator: the exact strip-list, plus "no params, no ?".
        name: 'strips utm_/fbclid/gclid and emits no question mark when empty',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/canonical',
          body: { urls: ['https://a.example.com/p/?fbclid=1&utm_medium=e'] },
          expect: {
            status: 200,
            jsonPath: [
              {
                path: 'results[0].canonical',
                equals: 'https://a.example.com/p/',
              },
            ],
          },
        },
      },
      {
        name: 'keeps non-tracking params, sorted, and collapses an empty path',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/canonical',
          body: { urls: ['https://EXAMPLE.com:443?z=9&utm_source=x&gclid=1'] },
          expect: {
            status: 200,
            jsonPath: [
              {
                path: 'results[0].canonical',
                equals: 'https://example.com/?z=9',
              },
            ],
          },
        },
      },
      {
        name: 'sorts duplicate parameter names by value',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/canonical',
          body: { urls: ['https://example.com/x?a=2&a=1&b=1'] },
          expect: {
            status: 200,
            jsonPath: [
              {
                path: 'results[0].canonical',
                equals: 'https://example.com/x?a=1&a=2&b=1',
              },
            ],
          },
        },
      },
      {
        name: 'returns null for an unparseable url without failing the batch',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/canonical',
          body: { urls: ['not a url', 'https://example.com/'] },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'results.length', equals: 2 },
              { path: 'results[0].canonical', equals: null },
              {
                path: 'results[1].canonical',
                equals: 'https://example.com/',
              },
            ],
          },
        },
      },
      {
        name: 'echoes the original input and preserves order',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/canonical',
          body: { urls: ['https://b.example.com/', 'https://a.example.com/'] },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'results[0].input', equals: 'https://b.example.com/' },
              { path: 'results[1].input', equals: 'https://a.example.com/' },
            ],
          },
        },
      },
      {
        name: 'accepts an empty urls array',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/canonical',
          body: { urls: [] },
          expect: {
            status: 200,
            jsonPath: [{ path: 'results.length', equals: 0 }],
          },
        },
      },
      {
        name: 'rejects a missing urls field',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/canonical',
          body: {},
          expect: { status: 400 },
        },
      },
    ],
  },
];

async function main() {
  for (const seed of problems) {
    const problem = await db.problem.upsert({
      where: { slug: seed.slug },
      update: {
        title: seed.title,
        statementMarkdown: seed.statementMarkdown,
        difficulty: seed.difficulty,
        category: 'REST_API',
        evaluationStrategy: 'REST_API',
        contractSpec: seed.contractSpec,
        visibility: 'PUBLISHED',
      },
      create: {
        slug: seed.slug,
        title: seed.title,
        statementMarkdown: seed.statementMarkdown,
        difficulty: seed.difficulty,
        category: 'REST_API',
        evaluationStrategy: 'REST_API',
        contractSpec: seed.contractSpec,
        visibility: 'PUBLISHED',
      },
    });

    // Replaced rather than upserted: sequences shift when a test is inserted
    // in the middle, so reconciling in place would silently mis-pair specs.
    await db.hiddenTest.deleteMany({ where: { problemId: problem.id } });
    await db.hiddenTest.createMany({
      data: seed.tests.map((test, index) => ({
        problemId: problem.id,
        sequence: index + 1,
        name: test.name,
        kind: 'HTTP_ASSERTION',
        weight: test.weight,
        timeoutMs: test.timeoutMs ?? 10_000,
        spec: test.spec,
        hidden: true,
      })),
    });

    const weight = seed.tests.reduce((sum, test) => sum + test.weight, 0);
    console.log(
      `${problem.slug.padEnd(16)} ${String(seed.tests.length).padStart(2)} tests, total weight ${weight}`,
    );
  }

  console.log(`\nSeeded ${problems.length} REST_API problems.`);
  console.log('Assign one to each simulation round in /admin before starting.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
