# 03 — Folder Structure

Production Next.js App Router (v15), a **single deployable** (no separate worker service in V1 —
D3). The Evaluation Runner boots inside the same process via `instrumentation.ts`. Feature-first
organization inside a thin App-Router shell — routes stay dumb, domain logic lives in
`src/server/modules`. The `server/jobs` layer is written behind a `Queue` interface so a
dedicated worker + BullMQ can be extracted later without changing call sites.

```
blitz-it/
├─ prisma/
│  ├─ schema.prisma              # models only (no datasource url in v7)
│  ├─ migrations/                # generated later, not in Phase 1
│  └─ seed.ts                    # dev seed (problems, admin user)
├─ prisma.config.ts             # Prisma 7: datasource/migrate/seed config lives here
├─ src/
│  ├─ app/                       # App Router — routing, layouts, RSC pages ONLY
│  │  ├─ (marketing)/            # public landing, about — route group, own layout
│  │  │  ├─ page.tsx
│  │  │  └─ layout.tsx
│  │  ├─ (auth)/                 # login screens
│  │  │  └─ login/page.tsx
│  │  ├─ (app)/                  # authenticated app — guarded layout
│  │  │  ├─ layout.tsx           # session check, shell nav
│  │  │  ├─ dashboard/page.tsx   # schedule, countdown, rank
│  │  │  ├─ arena/
│  │  │  │  ├─ simulation/page.tsx
│  │  │  │  └─ knockout/[matchId]/page.tsx
│  │  │  ├─ submit/[roundId]/page.tsx
│  │  │  ├─ leaderboard/page.tsx
│  │  │  ├─ bracket/[tournamentId]/page.tsx
│  │  │  ├─ hall-of-fame/page.tsx
│  │  │  └─ profile/[username]/page.tsx
│  │  ├─ (admin)/admin/          # admin panel — ADMIN role guard in layout
│  │  │  ├─ layout.tsx
│  │  │  ├─ tournaments/…        # create, manage, start rounds
│  │  │  ├─ problems/…           # author problems + hidden tests
│  │  │  ├─ submissions/…        # monitor + override scores
│  │  │  └─ payouts/…            # review + trigger payouts
│  │  ├─ api/                    # Route Handlers (public/webhook/streaming only)
│  │  │  ├─ auth/[...all]/route.ts       # Better Auth handler
│  │  │  ├─ webhooks/razorpay/route.ts   # raw-body signature verify
│  │  │  ├─ judge/callback/route.ts      # (if judging calls back)
│  │  │  └─ live/[tournamentId]/route.ts # SSE stream for leaderboard/bracket
│  │  ├─ layout.tsx              # root layout (fonts, providers, PostHog, Toaster)
│  │  ├─ globals.css             # Tailwind v4 @theme tokens (OKLCH)
│  │  └─ not-found.tsx / error.tsx
│  │
│  ├─ server/                    # server-only domain layer (never imported by client)
│  │  ├─ modules/                # feature-first business logic (see 04-module-breakdown)
│  │  │  ├─ auth/                # session helpers, role guards
│  │  │  ├─ tournament/          # lifecycle, state machine, scheduling
│  │  │  ├─ simulation/          # simulation round orchestration
│  │  │  ├─ bracket/             # seeding (8/16/32/64), pairing, advancement, tie-breaks
│  │  │  ├─ submission/          # create/seal submissions, validation
│  │  │  ├─ evaluation/          # Evaluation Engine — NO code execution (D1)
│  │  │  │  ├─ strategies/       # one per challenge category (D4)
│  │  │  │  ├─ github-text.ts    # read repo as text via GitHub API (no cloning)
│  │  │  │  ├─ probes.ts         # functional/perf/security probes vs deployment URL
│  │  │  │  └─ llm-quality.ts    # LLM rubric (temp 0, injection-guarded)
│  │  │  ├─ payment/             # Razorpay orders, webhook handling
│  │  │  ├─ payout/              # RazorpayX + compliance gate
│  │  │  ├─ leaderboard/         # ranking queries/read-models
│  │  │  ├─ notification/        # notification intents
│  │  │  └─ admin/               # privileged operations + audit
│  │  ├─ actions/                # "use server" Server Actions (thin → call modules)
│  │  │  ├─ payment.actions.ts
│  │  │  ├─ submission.actions.ts
│  │  │  └─ …
│  │  ├─ jobs/                   # Postgres-backed job runner (NO Redis/BullMQ — D3)
│  │  │  ├─ queue.ts             # Queue interface (swap to BullMQ later)
│  │  │  ├─ pg-queue.ts          # EvaluationJob table impl (FOR UPDATE SKIP LOCKED)
│  │  │  ├─ runner.ts            # in-process runner; started by instrumentation.ts
│  │  │  └─ processors/          # evaluate, advanceBracket, sendEmail, payout…
│  │  ├─ db.ts                   # Prisma singleton
│  │  └─ auth.ts                 # Better Auth server instance (+ nextCookies())
│  │
│  ├─ lib/                       # shared, isomorphic-safe utilities
│  │  ├─ env.ts                  # zod-validated env (server + public split)
│  │  ├─ money.ts                # paise helpers, formatting
│  │  ├─ time.ts                 # UTC helpers, round timers
│  │  ├─ logger.ts               # structured logger + correlation id
│  │  ├─ errors.ts               # typed AppError hierarchy + result types
│  │  ├─ validation/             # zod schemas shared client/server
│  │  ├─ posthog.ts / sentry.ts  # analytics + monitoring init
│  │  └─ auth-client.ts          # Better Auth client (browser)
│  │
│  ├─ components/
│  │  ├─ ui/                     # shadcn/ui (new-york) vendored primitives
│  │  ├─ features/               # feature components (BracketTree, Countdown, SubmitForm)
│  │  └─ layout/                 # nav, shell, footer
│  │
│  ├─ hooks/                     # client hooks (useCountdown, useLiveLeaderboard)
│  ├─ emails/                    # React Email templates (rendered by the runner)
│  ├─ instrumentation.ts         # boots the in-process Evaluation Runner (D3)
│  ├─ styles/                    # extra css if needed
│  └─ types/                     # shared TS types / DTOs
│
├─ tests/                        # unit + integration (bracket rules, scoring, payments)
├─ scripts/                      # ops scripts (backfills, one-offs)
├─ public/
├─ .env.example                  # every var documented, no secrets
├─ next.config.ts
├─ package.json                  # scripts: dev, build, start
├─ railway.json                  # single service config
└─ docs/                         # this blueprint
```

## Why each folder exists

- **`app/` is routing only.** Pages are thin: they render components and call `server/`
  modules or actions. Route groups `(marketing)/(auth)/(app)/(admin)` give each area its own
  layout and guard without leaking into URLs.
- **`api/` holds only what Server Actions can't do:** webhooks (need raw body + stable URL),
  auth handler, and SSE streaming. Everything user-facing prefers Server Actions.
- **`server/modules/` is the real product.** Feature-first so tournament/bracket/evaluation
  logic is testable in isolation and independent of Next.js. `server-only` guards prevent client
  import. `evaluation/strategies/` keeps each challenge category's logic pluggable (D4).
- **`server/actions/` are thin adapters** — validate input (zod), check authz, delegate to a
  module, revalidate. No business logic here.
- **`server/jobs/` is the in-process runner (D3).** A `Queue` interface with a Postgres
  (`EvaluationJob`) implementation, booted from `instrumentation.ts`. No Redis/BullMQ today; the
  interface is the seam to extract a dedicated worker later. Keeps slow work off the request path.
- **`lib/` is shared and safe both sides.** `env.ts` splits server-only vs `NEXT_PUBLIC_`.
- **`components/ui` vs `components/features`** — vendored primitives vs product composition, so
  shadcn updates don't collide with our code.
- **`emails/` + `tests/`** — templates rendered from the runner; tests focus on the parts that
  must be correct: bracket advancement, tie-breaks, scoring blend (60/15/10/15 over active
  dimensions, D20), stage → profile resolution, payment
  idempotency.
