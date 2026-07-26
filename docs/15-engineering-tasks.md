# 15 — Engineering Task Breakdown

Granular, buildable tickets grouped by epic. IDs map to the roadmap milestones
([`06`](./06-development-roadmap.md)) and sprints ([`16`](./16-sprint-plan.md)). Each is sized
S/M/L. "DoD" = definition of done (tests + CI green + deployable).

> **E5 correction:** Epic E5 was delivered as the Admin Platform & Tournament Management UI. The
> older "simulation arena + payments" labels below are pre-implementation planning text and are no
> longer the source of truth for E5. See [`19-admin-platform.md`](./19-admin-platform.md) and
> `CHANGELOG_EPIC_E5.md`.

---

## E0 — Foundation (M0)
- **E0.1 (M)** Init repo: Next.js 15 + React 19 + TS strict, ESLint/Prettier/Husky, CI (typecheck→lint→test→prisma generate→build).
- **E0.2 (S)** Tailwind v4 CSS-first (`@theme` OKLCH) + shadcn/ui (new-york, sonner). Apply `tailwind-design-system` skill for tokens.
- **E0.3 (M)** Prisma 7 setup: `schema.prisma` (from [`10`](./10-prisma-schema.md)) + `prisma.config.ts`; generated client to `src/generated/prisma` (gitignored); Railway Postgres.
- **E0.4 (M)** `lib/env.ts` (zod split server/public), `logger.ts` (correlation id), `errors.ts` (AppError), Sentry init, PostHog shell.
- **E0.5 (L)** Job substrate: `EvaluationJob` model, `Queue` interface, `pg-queue.ts` (`SKIP LOCKED` claim), `runner.ts`, boot from `instrumentation.ts`; no-op job proves the loop.
- **E0.6 (S)** `/api/health` (DB + runner heartbeat); Railway single-service deploy.
- **DoD:** deployed skeleton, health green, runner completes a no-op job.

## E1 — Auth & identity (M1)
- **E1.1 (M)** Better Auth server (`auth.ts`) with GitHub + Google + `nextCookies()`; `/api/auth/[...all]`.
- **E1.2 (S)** `auth-client.ts`; Login screen [5]; post-login redirect.
- **E1.3 (M)** Domain `User`/`Profile` mapping on first login; `username` allocation.
- **E1.4 (S)** Guards: `requireUser`, `requireAdmin`; route-group layouts `(app)`/`(admin)`.
- **E1.5 (S)** Profile view [4] + edit [15] (`updateProfile`).
- **DoD:** GitHub/Google login works; admin gating enforced.

## E2 — Evaluation Engine spike (M2)
- **E2.1 (M)** `EvaluationStrategy` interface + registry keyed by `ChallengeCategory` (D4).
- **E2.2 (L)** REST_API strategy: hidden-test harness vs deployment URL (functional 0–100) with egress controls + timeouts + size caps.
- **E2.3 (M)** Performance probe (latency/throughput → 0–100) + Security/Reliability probe (headers/TLS/uptime → 0–100).
- **E2.4 (M)** `github-text.ts`: read repo as text via GitHub API (no clone); size/file caps.
- **E2.5 (M)** `llm-quality.ts`: rubric prompt, temp 0, pinned model+promptHash, **schema-validated output**, prompt-injection guard.
- **E2.6 (S)** Weighted blend 60/15/10/15 → `Evaluation` with evidence JSONB.
- **E2.7 (M)** Stage-scoped evaluation profiles (D20): `EvaluationProfile` contract in the engine;
  stage → profile policy in the tournament layer; AI disabled through QF, enabled from
  SF/THIRD_PLACE/FINAL; per-tournament JSON override; `profileName`/`dimensions` persisted.
- **DoD:** given (repoUrl, deploymentUrl), reproducible `Evaluation` with 4 dims + audit; no code execution anywhere.

## E3 — Tournament lifecycle & admin authoring (M3)
> **As delivered, E3 absorbed E6.1/E6.2/E6.5** (seeding + bracket + advancement + their tests) —
> the epic brief scoped them together. UI tickets were deferred. See
> [`CHANGELOG_EPIC_E3.md`](../CHANGELOG_EPIC_E3.md) and
> [`17-tournament-lifecycle.md`](./17-tournament-lifecycle.md).

- **E3.1 (M)** ✅ Tournament/Round state machine + `OpsEvent` idempotent transitions.
- **E3.2 (M)** ✅ `tournamentTransition` job + DB-authoritative schedule.
  *(Pointing Railway cron at it remains a deployment step.)*
- **E3.3 (M)** ⏸ Admin Tournaments [17] — server actions built; screens deferred.
- **E3.4 (L)** ⏸ Admin Problems [18]: author problem + hidden tests + publish + assign.
- **E3.5 (S)** ⏸ Admin Dashboard [16] shell + Audit log [23] — `AuditLog` writer built, UI deferred.
- **Also delivered (from E6):** registration + limits, submission windows, seeding (D13),
  bracket generation 8/16/32/64 with byes, advancement with the full D5 chain, third place,
  completion + placements, and three verification suites.
- **DoD:** ✅ a tournament runs DRAFT → COMPLETED through the engine, resumable in a cold process.

## E4 — Payments + dynamic prize pool (M4)
- **E4.1 (M)** `createPassOrder` + Razorpay checkout on Buy Pass [7].
- **E4.2 (L)** `/api/webhooks/razorpay`: raw-body signature verify, idempotent activation, amount reconciliation.
- **E4.3 (M)** `Registration` unlock; unique PAID-per-(user,tournament) partial index.
- **E4.4 (M)** Dynamic prize pool (D9): `RECOMPUTE_PRIZE_POOL` on paid registration; participant count + pool; first-prize cap.
- **E4.5 (S)** Refund path for cancelled tournaments.
- **DoD:** user buys ₹100 pass, registered via webhook, pool grows live.

## E5 — Simulation arena + submission + evaluation (M5)
- **E5.1 (M)** Problem reveal gating (`getRevealedProblem` after `opensAt`).
- **E5.2 (L)** `submitSolution`: validation, immutable Submission, seal at deadline, anti-cheat anchors, rate limit; Submission form [9].
- **E5.3 (M)** Wire `EVALUATE` job end-to-end; `Ranking` update; status polling UI.
- **E5.4 (M)** Simulation Arena [8] with three rounds (30/20/10) + server countdown.
- **E5.5 (M)** Add ≥2 more strategies (WEB_APP, CLI_APP) behind the interface (D4).
- **DoD:** paid users complete multi-type simulation rounds → scored rankings.

## E6 — Seeding & bracket engine (M6)
> **E6.1, E6.2 and E6.5 shipped in E3.** Only sudden death and the UI remain.

- **E6.1 (L)** ✅ *(in E3)* `seedTournament`: choose 8/16/32/64, rank qualifiers, build the Match
  tree with byes.
- **E6.2 (L)** ✅ *(in E3)* `advanceBracket`: win rule + tie-breaks (D5), atomic advancement,
  walkover, third place, completion.
- **E6.3 (M)** ✅ Sudden-death: `startSuddenDeath`, sudden-death round/match, resolution (D14).
  One round per originating stage; admin picks a NEW published problem; the winner is written onto
  the deadlocked match with `winReason = SUDDEN_DEATH` and normal advancement continues.
- **E6.4 (M)** ✅ Bracket UI [11] (`/bracket/[tournamentId]`, own path highlighted) + admin bracket
  [21] with the deadlock list and sudden-death controls. *Server-rendered; SSE lands with E7.*
- **E6.5 (M)** ✅ *(in E3)* Unit tests: all bracket sizes, byes, every tie-break path.
  *(Sudden-death coverage lands with E6.3.)*
- **DoD:** ✅ full bracket runs to a champion in fast-forward incl. forced tie → sudden-death.
  *(Proven end to end by `verify:sudden-death`.)*

## E7 — Live knockout arena (M7)
- **E7.1 (L)** ✅ Server-authoritative timers (`timers.public.ts` — pure, shared by the server and
  the browser countdown, which corrects its own clock against a server anchor); simultaneous
  reveal; per-match windows (`getMatchWindow` — *derived* from the round, which stays the single
  schedule so every match at a stage opens at the same instant).
- **E7.2 (M)** ✅ Knockout Arena [10] (`/arena/knockout/[matchId]`); disconnect rules (nothing is
  in memory — a reload restores the same state and the same time remaining); late submissions
  refused by the Submission module, not by the UI; explicit JUDGING state when evaluation outlasts
  the timer.
- **E7.3 (M)** ✅ SSE `/api/live/[tournamentId]` (bracket/leaderboard/current match/countdown/
  participant count/prize pool) + `?mode=poll` fallback serving the identical snapshot +
  `useLiveTournament` hook and the `LiveRefresh` island.
- **E7.4 (S)** ✅ Feature flag `live-arena` gating the arena, with an env kill switch that beats
  PostHog and the admin bypass.
- **DoD:** ✅ a live Sunday-style event runs head-to-head to a champion — proven by
  `verify:live-arena` on top of `verify:tournament:e2e` and `verify:sudden-death`.

## E8 — Spectator landing, leaderboard, notifications, HoF (M8)
- **E8.1 (L)** Landing [1] (D10): stream embed, live leaderboard, bracket, current match, participant count, prize pool, countdown — all SSE.
- **E8.2 (M)** Leaderboard [12] (score/city/seed); Results/History [13].
- **E8.3 (M)** Notifications: `SEND_EMAIL` job + Resend + React Email templates; in-app [14]; dedupe.
- **E8.4 (M)** Hall of Fame [3] + badges/`UserBadge`.
- **DoD:** public homepage feels like a live event; notifications fire idempotently.

## E9 — Payouts & lightweight compliance (M9)
- **E9.1 (M)** Prize computation from dynamic pool + distribution.
- **E9.2 (M)** `PROCESS_PAYOUT` via RazorpayX; Payout status tracking; TDS field.
- **E9.3 (S)** Payouts admin [22] with lightweight compliance checklist (D11) + audit.
- **DoD:** winners paid correctly + auditably.

## E10 — Hardening & dress rehearsal (M10)
- **E10.1 (M)** Load/burst test deadline spike + runner concurrency.
- **E10.2 (M)** Chaos: cron/runner restart mid-job (claim/retry correctness).
- **E10.3 (M)** Security review (egress controls, prompt-injection, webhook, authz, secrets).
- **E10.4 (S)** Runbooks + on-call checklist.
- **E10.5 (L)** Full-week dress rehearsal with internal users.
- **DoD:** rehearsed, monitored, documented weekly op ready for Week 1.

---

## Cross-cutting (throughout)
- Tests for: scoring blend, bracket/tie-breaks, payment idempotency, job claim/retry, timers.
- Every mutation: zod + authz + idempotency + audit where privileged.
- Accessibility + responsive + light/dark + IST display on every screen.

---

## Future work (not scheduled)

**Documented direction only — do not implement without a scheduling decision.** Rationale in
[`20-evaluation-strategy-roadmap.md`](./20-evaluation-strategy-roadmap.md).

- **F1 — Hidden environment profiles (D24).** Extend hidden tests into environment profiles:
  variable/large datasets, traffic patterns, concurrency, retries, partial downstream failures,
  rate limiting, slow dependencies, network variability. Seams already in place:
  `Problem.contractSpec`, the `EvaluationStrategy` interface, `Evaluation.probeEvidence`.
  *Must not introduce code execution — D1 holds.*
- **F2 — Profile determinism + evidence (D25).** Persist `seed`, traffic profile, fault schedule,
  dataset version and timing profile per run. A run that cannot be replayed must not score.
- **F3 — Fairness scheme (D26).** Identical seeded environments per round, or N seeded
  environments averaged. Fix the seed set once per round, never per submission.
- **F4 — PM Moment (D27).** Mid-round requirement change, timed by **elapsed competitor time**.
  Requires a per-competitor run clock distinct from `Round.opensAt` / `deadlineAt`.
- **F5 — Business-rule + robustness scoring (D23).** First-class deterministic dimensions for the
  early rounds; today approximated by hidden tests, properly served by F1.

### Naming hazard

D20's `EvaluationProfile` (*which dimensions* are scored at a stage) and a D24 *environment
profile* (*what conditions* the software faces) are different concepts. F1 must not reuse the
`EvaluationProfile` name.
