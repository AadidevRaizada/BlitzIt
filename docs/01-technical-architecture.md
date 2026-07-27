# 01 — Technical Architecture

> Reflects the **locked V1 decisions** in [`DECISIONS.md`](./DECISIONS.md). No queue, no
> sandbox, no code execution.

## Guiding principles

1. **Grade artifacts, never execute code.** Competitors submit a **public GitHub repo** + a
   **live deployment URL**. We probe the deployment (black box) and read the repo as **text**
   via the GitHub API. We never clone-to-build, sandbox, or run their code (D1).
2. **Lightweight infra.** Postgres + Railway + Better Auth + Razorpay + Resend + PostHog +
   Sentry. No Redis, no BullMQ, no message queue, no object storage (D3).
3. **Async without a queue.** Slow work (evaluation, emails, payouts) runs off a **Postgres
   job table** via an **in-process background runner** using `FOR UPDATE SKIP LOCKED`, behind a
   `Queue` interface so BullMQ can be dropped in later (D3).
4. **Server-authoritative time.** Round timers, reveals, and deadlines are decided by the
   server/DB, never trusted from the client.
5. **Idempotency everywhere** money or state changes (webhooks retry, jobs retry, users
   double-click).

## Component overview

```
                       ┌──────────────────────────────────────────────────────┐
                       │                      Browser                          │
                       │  Next.js (RSC) · shadcn/ui · Tailwind v4 · PostHog-js │
                       │  Landing = spectator: YouTube embed, live leaderboard, │
                       │  bracket, match progression, participant count, prize, │
                       │  countdown  ── all via SSE / polling                   │
                       └───────────────┬───────────────────────┬───────────────┘
                                       │ Server Actions          │ HTTPS (Route Handlers)
                                       │ (mutations)             │
                       ┌───────────────▼───────────────────────▼───────────────┐
                       │            Next.js App  (Railway — single service)      │
                       │  - RSC data loaders (read via Prisma)                   │
                       │  - Server Actions: register, buy pass, submit           │
                       │  - Route Handlers: /api/auth, /api/webhooks/razorpay,   │
                       │      /api/live/[id] (SSE), /api/health                  │
                       │  - Better Auth (GitHub/Google + nextCookies())          │
                       │  - instrumentation.ts starts the in-process             │
                       │      Evaluation Runner (polls EvaluationJob table)      │
                       └───┬───────────────┬─────────────┬──────────────┬────────┘
                           │ Prisma        │ verify       │ enqueue row  │ read/report
                           ▼               ▼              ▼              ▼
                    ┌────────────┐   ┌───────────┐  ┌───────────────┐  ┌──────────────┐
                    │ PostgreSQL │   │ Razorpay  │  │ EvaluationJob │  │ PostHog /    │
                    │  (primary) │   │  (+X)     │  │  table (in DB)│  │ Sentry       │
                    │  + JSONB   │   └───────────┘  └──────┬────────┘  └──────────────┘
                    │  evidence  │                         │ SKIP LOCKED poll
                    └─────▲──────┘         ┌───────────────▼──────────────────────────┐
                          │                │  Evaluation Runner (in-process, capped    │
                          │                │  concurrency). Per-submission:            │
                          │  write results │   1. Functional: hidden tests vs URL      │
                          └────────────────┤   2. Performance: latency/throughput probe│
                                           │   3. Security & Reliability: header/ TLS / │
                                           │      uptime / basic checks vs URL          │
                                           │   4. Read repo TEXT via GitHub API         │
                                           │   5. LLM quality/architecture/docs/UI      │
                                           │   → weighted overallScore over the ACTIVE  │
                                           │     dimensions of the stage profile (D20)  │
                                           └───┬───────────────────────┬────────────────┘
                                               │                       │
                                               ▼                       ▼
                                     ┌───────────────────┐   ┌───────────────────┐
                                     │ Competitor's live │   │ OpenAI / Anthropic │
                                     │ deployment URL +  │   │ (LLM, temp 0,      │
                                     │ GitHub API (text) │   │ pinned per t'ment) │
                                     └───────────────────┘   └───────────────────┘

           Resend (email, sent from runner) · the runner's deadline sweep enqueues
           idempotent round progression (close a round, open the next) — NOT cron
```

## How each piece works and communicates

### Frontend (incl. spectator landing)
- Next.js App Router + React 19, Server Components by default; interactive islands for bracket,
  countdown, submission form, live leaderboard.
- **Landing page = spectator experience (D10):** embedded YouTube, live leaderboard, bracket,
  current match progression, live participant count, live prize pool, next-round countdown —
  all fed by **SSE** (`/api/live/[tournamentId]`) with polling fallback.
- Mutations via **Server Actions**; webhooks/auth/SSE via **Route Handlers**.

### Backend (single Next.js service)
- Route Handlers + Server Actions colocated. Reads via Prisma in RSC; writes via Server Actions.
- **Better Auth** owns sessions + OAuth; `nextCookies()` enabled so Server Action logins set
  cookies. Admin role gates admin panel + payouts.
- **`instrumentation.ts` boots the Evaluation Runner** — a background loop in the same process
  that claims `EvaluationJob` rows with `FOR UPDATE SKIP LOCKED`, runs the evaluation, writes
  results, and releases. Concurrency-capped. Single Railway instance in V1 (safe for SKIP
  LOCKED). Behind a `Queue` interface for future BullMQ extraction.

### Database — PostgreSQL (Prisma 7)
- Single source of truth **and** the job substrate (`EvaluationJob`). Money in paise (integer).
  Times `timestamptz` UTC. Evaluation evidence (test results, probe metrics, LLM raw
  prompt/response) stored as **JSONB** — no external object storage needed.

### Evaluation Engine (runs in the runner; pluggable per challenge type — D4)
- **Strategy per category** (REST API, Web App, AI Agent, OCR, Automation, Internal Tool, CLI,
  Chrome Extension). Each strategy implements how Functional / Performance / Security are probed
  for that type against the **deployment URL**; the LLM quality pass is shared and reads **repo
  text via the GitHub API**.
- **Scoring (D2):** `overall = 0.60·functional + 0.15·performance + 0.10·securityReliability +
  0.15·ai`, **restricted to the dimensions the stage profile activates (D20)** and renormalised
  by the surviving weights. LLM output is schema-validated, temperature 0, model+prompt pinned
  per tournament, full prompt/response stored for audit. Untrusted repo/README text is treated
  as **data, never instructions** (prompt-injection defense). Admin can override.
- **Stage profiles (D20):** the engine is **stage-agnostic** — it evaluates exactly the
  dimensions in the `EvaluationProfile` handed to it. The **tournament layer**
  (`modules/tournament/evaluation-profiles.ts`) maps stage → profile: `deterministic`
  (Functional/Performance/Security, **no AI**) for qualifiers through QF; `full` (adds AI) from
  SF/THIRD_PLACE/FINAL; `functional-only` for sudden death. Inactive dimensions are **not
  evaluated at all** — no probe, no GitHub read, no model call — which is where the cost and
  latency savings come from. Organizers override via `Tournament.evaluationProfiles` JSON.

### Email — Resend
- Sent from the runner (or a scheduled sweep), idempotent per (user, event) via `dedupeKey`.
  React Email templates. A `Notification` row records intent/state.

### Payments — Razorpay (+ RazorpayX payouts)
- Order created in a Server Action; checkout on client; **webhook Route Handler is source of
  truth** (raw-body signature verify, idempotent activation, amount reconciliation). Payouts run
  from the runner, triggered by an admin action, behind a lightweight compliance gate (D11).

### Infrastructure — Railway
- Single web service + managed Postgres. No cron service.
- **Round progression originates in the runner**, not in cron. Its poll loop sweeps for rounds
  whose `deadlineAt` has passed and enqueues an `advanceBracket` job; the processor closes the
  round and opens the next. The sweep only ever enqueues, so progression has exactly one path.
- **Railway Cron was the original plan and cannot do this job.** Its minimum interval is 5
  minutes and a cron service must exit when its task finishes, which a Next.js server hosting the
  in-process runner never does — it would need a second service. The shortest rounds are 600s, so
  a 5-minute lag is half a round. See D30 in `DECISIONS.md`.
- Round timing itself remains **server-authoritative in the app**: `opensAt`/`deadlineAt` are
  persisted instants and no client clock is trusted.

### Monitoring & analytics
- **Sentry** for exceptions/traces (web + runner). **PostHog** for funnels
  (register→pay→qualify→compete→return) and **feature flags** to gate the live arena. Structured
  JSON logs with a correlation id.

## Key runtime flows

**Purchase pass:** Server Action creates Razorpay Order + pending `Payment` → client checkout →
webhook (verified, idempotent) → `Payment=paid`, `Registration` active, **prize pool + participant
count recomputed** → notification enqueued.

**Submission:** Server Action validates window + registration + ownership, writes immutable
`Submission` (repoUrl + deploymentUrl + server timestamp), inserts an `EvaluationJob` row.

**Evaluation:** Runner claims the job → picks the challenge-type strategy → functional tests vs
URL + performance + security/reliability probes → reads repo text via GitHub API → LLM quality
pass → writes `Evaluation` (per-dimension + `overallScore` + evidence JSONB) → updates `Ranking`.

**Seeding (Sat):** cron/admin transition ranks qualifiers → builds bracket of size 8/16/32/64
(byes for non-power-of-two) → notifies seeded players.

**Live knockout (Sun):** round opens (problem revealed at server `opensAt`) → competitors submit
before server `deadlineAt` → per-submission `EvaluationJob` → when a match's submissions are
scored, apply **win rule + tie-breaks (D5)** → advance winner atomically → next round `Match`
rows → SSE pushes bracket/leaderboard → repeat to Finals → publish results → enqueue payouts.
