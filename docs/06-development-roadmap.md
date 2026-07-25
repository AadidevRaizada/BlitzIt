# 06 — Development Roadmap

Each milestone is independently buildable and demoable. Order minimizes rework: foundation and
the judging spike come early because they de-risk the whole product. A milestone is "done" when
it has tests (where logic exists), passes CI, and is deployable to Railway.

> **Sequencing principle:** build the hard, uncertain things first (judging strategy, bracket
> engine), not last. The live Sunday event is the riskiest surface and gets the most runway.

---

### Milestone 0 — Foundation & rails
- Repo, TypeScript strict, ESLint/Prettier/Husky, CI pipeline.
- Next.js 15 App Router + React 19 + Tailwind v4 (OKLCH `@theme`) + shadcn/ui (new-york, sonner).
  Apply the `tailwind-design-system` skill to bootstrap tokens/theming.
- Prisma 7 with `prisma.config.ts`; Postgres on Railway (single service — no Redis).
- `Queue` interface + `EvaluationJob` table + in-process runner skeleton booted from
  `instrumentation.ts` (processes a no-op job).
- `lib/env.ts` zod validation, logger, error types, Sentry, PostHog shell.
- **Deliverable:** deployed single-service skeleton, health check green, runner claims + completes
  a no-op job via `SKIP LOCKED`.

### Milestone 1 — Authentication & identity
- Better Auth (GitHub + Google) + `nextCookies()`; domain `User`/`Profile` mapping; role guards.
- Login screens, authenticated app shell, profile page.
- **Deliverable:** sign in with GitHub/Google, see a profile, admin role gating works.

### Milestone 2 — Evaluation Engine spike (SPIKE, not full feature)
- Prove the core bet end-to-end for **one REST_API problem** with **no code execution**:
  hidden tests against a sample deployment URL (functional) + performance probe + basic
  security/reliability probe + read repo **text via GitHub API** + LLM quality pass (temp 0).
- Establish the `EvaluationStrategy` interface (so other categories plug in later, D4) and the
  weighted blend **60/15/10/15 (D2)**, applied only to the dimensions the stage profile
  activates (**D20** — no AI before the semifinals).
- **Deliverable:** given (repoUrl, deploymentUrl), produce a reproducible `Evaluation` with the
  four dimensions, `overallScore`, and full evidence in JSONB. Validates the central assumption
  early without any sandbox.

### Milestone 3 — Tournament lifecycle & admin authoring
- Tournament/Round state machine, authoritative timestamps, idempotent transitions.
- Admin: create tournament, author problems + hidden tests, schedule/start rounds.
- **Deliverable:** an admin can stand up a full weekly tournament shell and drive its states.

### Milestone 4 — Payments (Weekly Pass) + dynamic prize pool
- Razorpay order creation, checkout, raw-body webhook (idempotent), `Registration` unlock.
- **Dynamic prize pool (D9):** recompute pool + distribution on each paid registration; first
  prize capped ₹2,000 for Week 1; expose live participant count + pool.
- Refund path for cancelled tournaments; reconciliation.
- **Deliverable:** a user buys the ₹100 pass and gets registered; webhook is source of truth;
  pool grows live with registrations.

### Milestone 5 — Simulation arena + submission + real evaluation
- Problem reveal (server-timed), submission portal (repo + deployment URL, immutable, sealed at
  deadline, anti-cheat anchors), evaluation wired to M2, `Ranking` updated. Round timings 30/20/10.
- Add ≥2 more challenge-type strategies (e.g. WEB_APP, CLI_APP) behind the strategy interface (D4).
- **Deliverable:** paid users complete simulation rounds across multiple challenge types and
  receive scored rankings.

### Milestone 6 — Seeding & bracket engine
- Seed qualifiers → choose **bracket size 8/16/32/64 (D6)** → build bracket (byes for
  non-power-of-two), pairing, **win rule + tie-breaks incl. sudden-death (D5)**, atomic
  advancement, walkover handling. Heavily unit-tested.
- Visual bracket UI.
- **Deliverable:** from a set of simulation scores, a full bracket of any supported size runs to
  a champion in a simulated fast-forward, including a forced tie → sudden-death path.

### Milestone 7 — Live knockout arena
- Server-authoritative round timers (knockout 20/30/40/50/60), simultaneous reveal, per-match
  submission windows, live progression, disconnect/late-submit rules, SSE updates.
- Feature-flagged rollout.
- **Deliverable:** a live Sunday-style event runs head-to-head rounds to a champion.

### Milestone 8 — Spectator landing, leaderboard, notifications, Hall of Fame
- **Landing = spectator experience (D10):** embedded YouTube, live leaderboard, live bracket,
  current match progression, live participant count, live prize pool, next-round countdown — via
  SSE. Resend notifications (idempotent); Hall of Fame + badges.
- **Deliverable:** a public homepage that makes a first-time visitor feel a live event is happening.

### Milestone 9 — Payouts & lightweight compliance
- Prize computation from the dynamic pool, **lightweight** compliance gate (documented, D11),
  RazorpayX disbursement, admin approval, audit. Full GST/TDS/CA review is the parallel business
  workstream, required before *scaling* pools — not a V1 code blocker.
- **Deliverable:** winners are paid correctly and auditably.

### Milestone 10 — Hardening & dress rehearsal
- Load/burst test the deadline spike and evaluation-runner concurrency; chaos test cron/runner restarts;
  security review; runbooks; end-to-end **dress rehearsal** of a full week with internal users
  before real money and real prizes.
- **Deliverable:** a rehearsed, monitored, documented weekly operation ready for Week 1.

---

## Critical path & parallelism
- **Critical path:** M0 → M1 → **M2 (evaluation spike)** → M3 → M5 → M6 → M7 → M10.
- **Parallelizable:** M4 (payments) alongside M3; M8 (leaderboard/notifications/HoF) alongside
  M6/M7; M9 can start design-only early (legal is the long pole).
- **Do not** ship real prize money until M9 legal sign-off **and** M10 rehearsal both pass.
