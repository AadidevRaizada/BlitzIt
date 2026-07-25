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

## 4. Tournament (lifecycle, scheduling, seeding, bracket & evaluation policy)
> **As built in E3** — see [`17-tournament-lifecycle.md`](./17-tournament-lifecycle.md).
> E3 also absorbed module 8's seeding/bracket/advancement responsibilities (below), so both live
> in `server/modules/tournament/` as separate, acyclic files rather than two packages.

- **Responsibilities:** the weekly state machine
  (DRAFT→PUBLISHED→REGISTRATION_OPEN→REGISTRATION_CLOSED→SIMULATION→SEEDING→BRACKET_GENERATED→
  LIVE(R64…FINAL)→COMPLETED, CANCELLED from any non-terminal), authoritative timestamps and
  **submission windows**, registration and its limits, idempotent transitions driven by
  cron/admin, seeding (D13), bracket generation (D6), match advancement (D5) — **and the
  stage → evaluation-profile policy (D20)**: which scoring dimensions are active in each round.
  This module is the *only* place that knows AI starts at the semifinals; the Evaluation Engine
  never asks what stage it is in.
- **Dependencies:** Prisma, cron (Railway), Admin (audit), Notification. Reads `Evaluation` rows.
  (Depends on the Evaluation Engine's `EvaluationProfile` *type* only — never the reverse, and it
  never *calls* the engine.)
- **Data ownership:** `Tournament` (incl. `currentStage`, shape config and the
  `evaluationProfiles` JSON override), `Round`, `Match`, `Registration` (the state; E4 adds the
  payment), `Ranking` seeds/placements, `AdminTask/OpsEvent`.
- **APIs:** `applyTransition(tournamentId, transition, opts)` — the single entry point that
  writes `status`/`currentStage`; `progressTournament` (decide → advance → complete);
  CRUD (`createTournament`, `updateTournamentSchedule`, `configureTournament`, …);
  `registerCompetitor` / `withdrawRegistration` / `assertRegistered`;
  `isSubmissionWindowOpen(round)` / `getSubmissionWindow(roundId)` — the seam E5 calls instead of
  re-deriving the schedule; `computeSeeding`, `getSeedingList`, `generateBracket`;
  `resolveEvaluationProfile(stage, config)`, `isAiActiveForStage(stage, config)`.
- **Entities:** `Tournament`, `Round`, `Match`, `OpsEvent`.
- **Internal boundaries that must not blur:** `lifecycle.ts` and `bracket.ts` and `win-rule.ts`
  are **pure** (no DB, no clock, no randomness); `state.ts` is a persistence shell around
  `lifecycle.ts`; seeding aggregates evaluations into a seed list and bracket generation consumes
  **only** that list — the two never call each other.
- **Scalability:** DB-authoritative schedule and idempotency keys make cron replay-safe; there is
  **no in-memory tournament state**, so any process can resume any tournament; supports many
  concurrent weekly tournaments later (slug-scoped).

## 5. Problem Delivery Engine
- **Responsibilities:** author/publish problems + hidden tests; reveal a round's problem to all
  competitors **simultaneously** at server `opensAt`; keep tests secret.
- **Dependencies:** Prisma, Tournament (round timing), Admin (authoring).
- **Data ownership:** `Problem`, `HiddenTest`.
- **APIs:** `getRevealedProblem(roundId)` (gated by server time); admin authoring actions.
- **Entities:** `Problem`, `HiddenTest`.
- **Scalability:** problems are cacheable once revealed; hidden tests never leave the server.

## 6. Submission
> **As built in E4** — see [`18-submission-pipeline.md`](./18-submission-pipeline.md).

- **Responsibilities:** validate + accept repo URL + deployment URL within the open window,
  maintain the **current** `Submission` per (user, round) plus append-only revision history,
  seal at deadline, anti-cheat anchors (server timestamp, ownership, no post-deadline edits,
  deployment-URL reuse detection), and hand work to the queue.
- **Dependencies:** Prisma, Tournament (window + registration gate), Queue (enqueue),
  Evaluation Engine (its `parseRepoUrl` contract only — never `runEvaluation`).
- **Data ownership:** `Submission`, `SubmissionRevision`.
- **APIs:** `submitSolution({ userId, roundId, repoUrl, deploymentUrl, commitSha? })` — creates
  *or* replaces, the server decides which; `sealRoundSubmissions(roundId)`;
  `getMySubmission` / `listMySubmissions` / `getSubmission` / `getSubmissionHistory`;
  admin `listAllSubmissions` / `retryEvaluation` / `disqualifySubmission`.
- **Entities:** `Submission`, `SubmissionRevision`.
- **Boundary that must not blur:** this module never derives a schedule (it asks
  `isSubmissionWindowOpen`) and never scores (it enqueues). `state.ts` and `validation.ts` are
  pure; `submissions.ts` is the only file that touches the database.
- **Scalability:** burst at deadline — cheap insert + enqueue; validation is syntactic only, with
  the SSRF guard deferred to probe time.

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
> **Built inside module 4** as of E3 (`server/modules/tournament/{seeding,bracket,
> bracket-generate,win-rule,advancement,progress}.ts`). It remains a distinct responsibility with
> its own boundaries; it is not a separate package. Everything below is as built except
> sudden death, which is deferred to E6.3.

- **Responsibilities:** seed qualifiers from simulation scores (D13), build the bracket for the
  chosen **size 8/16/32/64 (D6)** (byes when a field does not fill the chosen size), pair matches,
  apply the **win rule + tie-breaks (D5)** — Functional → hidden tests passed → faster submission
  → performance → AI score → **sudden-death challenge** — advance winners atomically, detect
  walkovers/no-shows, route semi-final losers to the third-place play-off, detect round completion
  and tournament completion, write final placements.
- **Dependencies:** Ranking (seeds), Round/Match, Evaluation (results — read only), Notification.
- **Data ownership:** `Match`, bracket topology (`nextMatchId`/`nextMatchSlot`,
  `loserNextMatchId`/`loserNextMatchSlot`).
- **APIs:** `computeSeeding` / `getSeedingList`; `generateBracket`; `decideAndPropagate`,
  `advanceStage`, `resolveDeterminedMatches`, `getRoundCompletion`, `assignFinalPlacements`;
  `progressTournament`; jobs `seedTournament` and `advanceBracket`; admin overrides;
  *(`startSuddenDeath(matchId)` — E6.3, not built)*.
- **Entities:** `Match`, `Round`.
- **Key invariant:** the **whole match tree** is materialised at generation with its links wired,
  so advancement *fills* slots rather than *creating* matches. That is what makes "no duplicate
  matches, no duplicate participants, no orphan rounds" checkable at generation time.
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
