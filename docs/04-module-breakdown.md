# 04 — Module Breakdown

Each module lives under `src/server/modules/<name>`. Format per module: **Responsibilities ·
Dependencies · Data ownership · APIs · Entities · Scalability**.

---

## 1. Authentication & Identity
- **Responsibilities:** GitHub/Google OAuth, sessions, role resolution (USER/ADMIN), mapping
  Better Auth users → domain `User`/`Profile`, guards for actions/routes/layouts.
- **Dependencies:** Better Auth, Prisma, GitHub/Google OAuth apps.
- **Data ownership:** Better Auth tables + `User`, `Profile`. Source of truth for "who is this".
- **APIs:** `/api/auth/[...all]` handler; `getSession()`, `requireUser()`, `requireAdmin()`.
- **Entities:** `User`, `Profile` (+ Better Auth `user/session/account`).
- **Scalability:** stateless sessions scale trivially; add more providers/passkeys via plugins.

## 2. Payments (pass purchase)
- **Responsibilities:** create Razorpay orders, verify signatures, process webhook as source of
  truth, unlock `Registration`, reconcile amount, handle failure/refund.
- **Dependencies:** Razorpay, Prisma, runner (email), Tournament (pricing/window/dynamic pool).
- **Data ownership:** `Payment`, `Registration`.
- **APIs:** `createPassOrder` action; `/api/webhooks/razorpay` handler (raw body).
- **Entities:** `Payment`, `Registration`.
- **Scalability:** idempotent webhooks; volume is tiny; queue email side-effects.

## 3. Payout (prize disbursement)
- **Responsibilities:** compute prizes, KYC/compliance gate, TDS withholding, RazorpayX
  disbursement, admin approval, audit.
- **Dependencies:** RazorpayX, Prisma, Bracket (final placements), Admin, runner.
- **Data ownership:** `Payout`.
- **APIs:** `approvePayout` admin action → enqueues `ProcessPayout` job.
- **Entities:** `Payout` (+ `AuditLog`).
- **Scalability:** low volume, high scrutiny — correctness and audit over throughput.

## 4. Tournament (lifecycle, scheduling & evaluation policy)
- **Responsibilities:** the weekly state machine (DRAFT→REGISTRATION→SIMULATION→SEEDING→LIVE→
  COMPLETED), authoritative timestamps, idempotent transitions driven by cron/admin — **and the
  stage → evaluation-profile policy (D20)**: which scoring dimensions are active in each round.
  This module is the *only* place that knows AI starts at the semifinals; the Evaluation Engine
  never asks what stage it is in.
- **Dependencies:** Prisma, cron (Railway), Admin, Notification. (Depends on the Evaluation
  Engine's `EvaluationProfile` *type* only — never the reverse.)
- **Data ownership:** `Tournament` (incl. `evaluationProfiles` JSON override), `Round`,
  `AdminTask/OpsEvent`.
- **APIs:** `advanceTournamentState`, `openRegistration`, `startRound` (admin + system);
  `resolveEvaluationProfile(stage, config)`, `isAiActiveForStage(stage, config)`.
- **Entities:** `Tournament`, `Round`, `OpsEvent`.
- **Scalability:** DB-authoritative schedule makes cron replay-safe; supports many concurrent
  weekly tournaments later (slug-scoped).

## 5. Problem Delivery Engine
- **Responsibilities:** author/publish problems + hidden tests; reveal a round's problem to all
  competitors **simultaneously** at server `opensAt`; keep tests secret.
- **Dependencies:** Prisma, Tournament (round timing), Admin (authoring).
- **Data ownership:** `Problem`, `HiddenTest`.
- **APIs:** `getRevealedProblem(roundId)` (gated by server time); admin authoring actions.
- **Entities:** `Problem`, `HiddenTest`.
- **Scalability:** problems are cacheable once revealed; hidden tests never leave the server.

## 6. Submission
- **Responsibilities:** validate + accept repo URL + deployment URL within the open window,
  create immutable `Submission`, seal at deadline, anti-cheat anchors (server timestamp,
  ownership, no post-deadline edits, dedupe URL reuse).
- **Dependencies:** Prisma, Tournament (window), Registration (access), Judging (enqueue).
- **Data ownership:** `Submission`.
- **APIs:** `submitSolution(roundId|matchId, repoUrl, deploymentUrl)` action.
- **Entities:** `Submission`.
- **Scalability:** burst at deadline — cheap insert + enqueue; keep validation fast.

## 7. Evaluation Engine (the "AI Judge")
- **Responsibilities:** for each submission, select the **challenge-type strategy** (D4) and
  compute four dimensions against the **deployment URL** + **repo text (GitHub API)**:
  Functional (hidden tests), Performance, Security & Reliability, and AI quality (LLM, temp 0,
  pinned model/prompt). Combine with weights **60/15/10/15 (D2)**, limited to the dimensions the
  stage's `EvaluationProfile` activates (**D20** — no AI before the semifinals), into
  `overallScore`; store
  full evidence (JSONB) for audit; surface to admin for override. **No code execution, no
  sandbox, no cloning-to-build (D1).**
- **Dependencies:** in-process Evaluation Runner + `EvaluationJob` table (D3), GitHub API,
  OpenAI/Anthropic, Problem/HiddenTest, Submission, Ranking.
- **Data ownership:** `Evaluation`, `EvaluationJob`.
- **APIs:** internal job `EVALUATE` (claimed via `SKIP LOCKED`); admin `overrideScore`.
- **Entities:** `Evaluation`, `EvaluationJob`.
- **Sub-structure:** `strategies/` — one module per category (REST_API, WEB_APP, AI_AGENT, OCR,
  AUTOMATION, INTERNAL_TOOL, CLI_APP, CHROME_EXTENSION), each implementing a common
  `EvaluationStrategy` interface; a shared LLM quality pass.
- **Stage-agnostic boundary (D20):** the engine contains **no stage logic and no AI special
  cases**. It receives an `EvaluationProfile` (which dimensions + weights) and honours it. The
  stage → profile mapping lives in the **Tournament** module
  (`modules/tournament/evaluation-profiles.ts`); see module 4. Keeping this split is what lets
  organizers re-scope AI without touching scoring code.
- **Scalability:** concurrency-capped in-process today; the `Queue` interface + `EvaluationJob`
  table let us extract a dedicated worker + BullMQ later without touching call sites. Per-
  tournament pinned model for reproducibility; retry with backoff via `availableAt`.

## 8. Bracket (seeding + knockout engine)
- **Responsibilities:** seed qualifiers from simulation scores, build the bracket for the chosen
  **size 8/16/32/64 (D6)** (byes for non-power-of-two fields), pair matches, apply the **win rule
  + tie-breaks (D5)** — Functional → hidden tests passed → faster submission → performance → AI
  score → **sudden-death challenge** — advance winners atomically, detect walkovers/no-shows.
- **Dependencies:** Ranking (seeds), Round/Match, Evaluation (results), Notification.
- **Data ownership:** `Match`, bracket topology (`nextMatchId`).
- **APIs:** `SeedTournament`, `AdvanceBracket` (triggered after evaluations complete); admin
  overrides; `startSuddenDeath(matchId)`.
- **Entities:** `Match`, `Round`.
- **Scalability:** pure functions over seeds/results → unit-testable; small N; deterministic.

## 9. Leaderboard & Ranking
- **Responsibilities:** maintain per-tournament `Ranking`, expose live standings by score/city/
  seed, compute placements + season points.
- **Dependencies:** Evaluation (scores), Bracket (elimination/placement), Prisma.
- **Data ownership:** `Ranking`, `SeasonStanding`.
- **APIs:** RSC read queries + SSE `/api/live/[tournamentId]`.
- **Entities:** `Ranking`, `SeasonStanding`.
- **Scalability:** read-model with proper indexes; cache/SSE for spectators.

## 10. Notifications
- **Responsibilities:** create notification intents, dedupe, deliver via Resend (email) and
  in-app, track state.
- **Dependencies:** runner, Resend, React Email, Prisma.
- **Data ownership:** `Notification`.
- **APIs:** internal `enqueueNotification`; in-app `getNotifications`.
- **Entities:** `Notification`.
- **Scalability:** all sends async + idempotent; batching later.

## 11. Admin
- **Responsibilities:** tournament/problem authoring, start rounds, monitor submissions, review/
  override AI scores, publish winners, trigger payouts — all audited.
- **Dependencies:** every module above; role guard.
- **Data ownership:** `AuditLog`, `OpsEvent`; orchestrates others'.
- **APIs:** admin Server Actions under `(admin)/`.
- **Entities:** `AuditLog`, `OpsEvent`.
- **Scalability:** internal, low volume; correctness + audit first.

## 12. Analytics & Monitoring
- **Responsibilities:** product funnels (PostHog), exceptions/traces (Sentry), feature flags to
  gate the live arena.
- **Dependencies:** PostHog, Sentry.
- **Data ownership:** none in our DB (external).
- **APIs:** capture calls in handlers/actions; flag checks.
- **Scalability:** external SaaS; proxy PostHog to dodge blockers.

## 13. Profile & Hall of Fame
- **Responsibilities:** public profiles (stats, history), curated champions per tournament,
  badges/achievements.
- **Dependencies:** Ranking, Bracket, Badge.
- **Data ownership:** `Profile` (shared with Auth), `HallOfFame`, `Badge`, `UserBadge`.
- **APIs:** `getProfile(username)`, `getHallOfFame()`.
- **Entities:** `Profile`, `HallOfFame`, `Badge`, `UserBadge`.
- **Scalability:** mostly read; cache aggressively; derive from Ranking where possible.
