# 02 — Database Design (conceptual)

> Conceptual model. The **implementation-ready `schema.prisma`** is in
> [`10-prisma-schema.md`](./10-prisma-schema.md). Reflects [`DECISIONS.md`](./DECISIONS.md):
> no sandbox, no external storage (evidence in JSONB), weighted scoring, pluggable challenge
> categories, 8/16/32/64 brackets, dynamic prize pool, Postgres-backed job table.

PostgreSQL 16 via Prisma 7. Conventions:

- **IDs:** UUID (prefer UUIDv7 for time-ordering) unless noted.
- **Money:** integer **paise** (`amountMinor`), plus `currency` (`INR`). Never floats.
- **Time:** all `timestamptz`, stored UTC.
- **Enums:** Postgres enums via Prisma enums.
- **Soft state:** status enums + explicit timestamps, not boolean soup.
- **Auditability:** money/score/state changes are append-only where feasible; submissions and
  scores are immutable once judged.

Better Auth manages its own auth tables (`user`, `session`, `account`, `verification`) via its
Prisma adapter. Below, **`User`** is our domain profile keyed 1:1 to the Better Auth user id;
we do not hand-roll credential storage.

---

## Entity catalogue

### Identity & profile

**User** (domain user; 1:1 with Better Auth user)
- `id`, `authUserId` (unique, FK→Better Auth user), `email` (unique), `username` (unique,
  citext), `displayName`, `avatarUrl`, `city`, `country`, `role` (`USER|ADMIN`),
  `createdAt`, `updatedAt`.

**Profile** (extended, optional/1:1 with User)
- `id`, `userId` (unique FK), `bio`, `githubUsername`, `websiteUrl`, `twitterHandle`,
  `preferredTimezone`, `stats` (jsonb: cached lifetime wins/points), `createdAt`, `updatedAt`.

**OAuthAccount** — owned by Better Auth (`account` table): provider (`github|google`),
providerAccountId, tokens. We read, we don't duplicate.

### Competition structure

**Tournament** (one per week / "season week")
- `id`, `slug` (unique, e.g. `2026-w30`), `name`, `status`
  (`DRAFT|PUBLISHED|REGISTRATION_OPEN|REGISTRATION_CLOSED|SIMULATION|SEEDING|BRACKET_GENERATED|LIVE|COMPLETED|CANCELLED`),
  `passPriceMinor`, `currency`, `bracketSize` (`8|16|32|64`, chosen at seeding),
  `registrationOpensAt`, `registrationClosesAt`, `simulationOpensAt`, `simulationClosesAt`,
  `liveStartsAt`, `seededAt`, `bracketGeneratedAt`, `completedAt`, `cancelledAt`,
  `cancellationReason`, `timezoneDisplay` (default `Asia/Kolkata`), `youtubeStreamUrl`,
  `createdBy`, `createdAt`, `updatedAt`.
- **Lifecycle (E3):** `currentStage` (`RoundStage?`) — the knockout stage in progress. The
  lifecycle state is the **pair** (`status`, `currentStage`), because every knockout round shares
  `status = LIVE`. Both are columns, so the engine holds no tournament state in memory. See
  [`17-tournament-lifecycle.md`](./17-tournament-lifecycle.md).
- **Shape (E3, all configurable):** `thirdPlaceEnabled`, `minRegistrations`, `maxRegistrations`.
- **Dynamic prize pool (D9):** `participantCount` (denorm, live), `basePrizePoolMinor`,
  `prizePerRegistrationMinor`, `firstPrizeCapMinor` (₹2,000 = `200000` for Week 1),
  `prizePoolMinor` (computed = base + count·perReg), `prizeDistribution` (jsonb: placement→share).
- **Round durations (D7):** `roundDurations` (jsonb) or derived from `Round.durationSeconds`;
  defaults — simulation `[1800,1200,600]`, knockout R32..Final `[1200,1800,2400,3000,3600]`.
  All configurable per tournament.

**Round** (a phase within a tournament — simulation, R64…Final, third place, sudden death)
- `id`, `tournamentId` (FK), `type` (`SIMULATION|KNOCKOUT`), `stage`
  (`SIMULATION|R64|R32|R16|QF|SF|THIRD_PLACE|FINAL|SUDDEN_DEATH`), `sequence`, `status`
  (`PENDING|OPEN|JUDGING|COMPLETED`), `problemId` (FK, revealed on open),
  `opensAt`, `deadlineAt` (server-authoritative), `durationSeconds`, `createdAt`, `updatedAt`.
- Unique: (`tournamentId`, `stage`, `sequence`).

**Match** (a 1v1 knockout pairing; simulation has no matches)
- `id`, `roundId` (FK), `tournamentId` (FK, denormalized for queries),
  `bracketPosition` (int, deterministic slot in the bracket tree),
  `competitorAId` (FK User, nullable for byes), `competitorBId` (FK User, nullable),
  `seedA`, `seedB` (nullable — null seed and null competitor always agree, which is what makes a
  bye unambiguous), `submissionAId` (FK, nullable), `submissionBId` (FK, nullable),
  `winnerId` (FK User, nullable), `loserId` (FK User, nullable), `winReason`
  (`SCORE|TIEBREAK_FUNCTIONAL|TIEBREAK_TESTS|TIEBREAK_TIME|TIEBREAK_PERFORMANCE|TIEBREAK_AI|SUDDEN_DEATH|BYE|WALKOVER|ADMIN`),
  `status` (`PENDING|LIVE|JUDGING|DECIDED`), `decidedAt`, `createdAt`, `updatedAt`.
- **Topology (E3):** `nextMatchId` + `nextMatchSlot` (`A|B`) — where the winner goes;
  `loserNextMatchId` + `loserNextMatchSlot` — where the loser goes, used **only** by the
  semi-finals when the third-place play-off is enabled. Slots are persisted rather than derived
  from `bracketPosition` parity, so the tree is fully readable from the database alone and
  advancement never recomputes it.
- `tieUnresolved` (bool) — set when the win rule and every D5 tie-break failed to separate the
  two competitors; the match holds at `JUDGING` awaiting a sudden-death challenge (D5.6/D14).
- Unique: (`roundId`, `bracketPosition`). Index: (`tournamentId`, `status`).

**Problem** (challenge statement + hidden test definition)
- `id`, `title`, `slug`, `statementMarkdown`, `difficulty`,
  `category` (`REST_API|WEB_APP|AI_AGENT|OCR|AUTOMATION|INTERNAL_TOOL|CLI_APP|CHROME_EXTENSION`
  — selects the evaluation strategy, D4),
  `evaluationStrategy` (string key resolving to the strategy implementation),
  `contractSpec` (jsonb: category-specific config — endpoints/schemas, expected outputs, probe
  params), `starterRepoUrl` (nullable), `visibility` (`DRAFT|PUBLISHED|ARCHIVED`), `authorId`,
  `createdAt`, `updatedAt`.

**HiddenTest** (machine-checkable test tied to a Problem; never shown to competitors)
- `id`, `problemId` (FK), `sequence`, `name`, `kind` (`HTTP_ASSERTION|SCRIPT|PROPERTY`),
  `spec` (jsonb: request, expected assertion), `weight`, `timeoutMs`, `hidden` (default true),
  `createdAt`. — Stored separately so problem statements can be public while tests stay secret.

### Submissions & judging

**Submission** (the CURRENT entry; one per competitor per round/match)
- `id`, `userId` (FK), `tournamentId` (FK), `roundId` (FK), `matchId` (FK, nullable for
  simulation), `problemId` (FK), `category` (snapshot of the Problem's `ChallengeCategory` at
  submit time — re-categorising a problem must not rewrite history), `repoUrl`, `deploymentUrl`,
  `commitSha` (nullable), `version` (current revision), `submittedAt` (server time; the
  anti-cheat anchor), `sealedAt`, `status`
  (`RECEIVED|QUEUED|JUDGING|SCORED|FAILED|DISQUALIFIED`), `createdAt`, `updatedAt`.
- Unique: (`userId`, `roundId`). Index: (`userId`, `tournamentId`), (`tournamentId`, `status`).
- **Append-only history (E4):** editing before the deadline mutates this row *and* appends a
  `SubmissionRevision`. An earlier draft of this doc called for edits to create a new
  `Submission` row, which its own `(userId, roundId)` unique key forbids — and which E3's
  advancement reads through with `findUnique`. The sibling table delivers the intent without
  breaking the constraint. After `sealedAt` the entry is immutable.

**SubmissionRevision** (append-only version history — E4)
- `id`, `submissionId` (FK, cascade), `version`, `repoUrl`, `deploymentUrl`, `commitSha`,
  `submittedAt` (server time this version was accepted), `createdAt`.
- Unique: (`submissionId`, `version`).

**Evaluation** (result of evaluating a submission — one per submission)
- `id`, `submissionId` (unique FK), `tournamentId`, `attempt`,
  `functionalScore` (0–100), `testsPassed`, `testsTotal`, `testResults` (jsonb per HiddenTest),
  `deploymentReachable` (bool), `performanceScore`, `securityReliabilityScore`,
  `aiScore` (LLM), `overallScore` (weighted 60/15/10/15 over the **active** dimensions, D20),
  `profileName` + `dimensions` (which stage profile governed the score),
  `weights` (jsonb: the exact weights used, for reproducibility),
  `probeEvidence` (jsonb: latency/throughput/security probe results),
  `repoTextSnapshot` (jsonb/text: key files pulled via GitHub API for audit — no cloning),
  `rubricVersion`, `llmProvider` (which backend scored it — lifted out of `llmRaw` so it is
  queryable), `modelId`, `modelPromptHash`, `llmRaw` (jsonb: full prompt+response),
  `submissionVersion` (which revision produced this score — makes a stale result detectable),
  `startedAt`, `finishedAt`, `error` (nullable), `overriddenBy` (FK User, nullable),
  `overrideReason`, `createdAt`.

**EvaluationJob** (the Postgres-backed job substrate — D3; replaces Redis/BullMQ)
- `id`, `submissionId` (FK), `type` (`EVALUATE|REEVALUATE`), `status`
  (`QUEUED|CLAIMED|RUNNING|DONE|FAILED`), `attempts`, `maxAttempts`, `priority`,
  `claimedAt`, `lockedBy` (runner instance id), `availableAt` (for backoff), `lastError`,
  `idempotencyKey` (unique, e.g. `eval:{submissionId}:{attempt}`), `createdAt`, `updatedAt`.
- Claimed via `SELECT … FOR UPDATE SKIP LOCKED`. Same table shape maps 1:1 onto a BullMQ job
  later. Non-evaluation async work (emails, payouts) can reuse this pattern or a sibling table.

### Ranking & standings

**Ranking** (per user per tournament, updated as scores land)
- `id`, `tournamentId` (FK), `userId` (FK), `simulationScore`, `seed` (nullable until seeded),
  `qualified` (bool), `currentStage`, `eliminatedAtStage` (nullable), `placement` (nullable
  final rank), `points` (season points), `city` (denorm for city leaderboard),
  `updatedAt`, `createdAt`.
- Unique: (`tournamentId`, `userId`). Indexes for leaderboard: (`tournamentId`,
  `simulationScore` desc), (`tournamentId`, `city`).

**SeasonStanding** (optional aggregate for long-term leaderboard)
- `id`, `userId` (FK), `seasonId`, `totalPoints`, `tournamentsPlayed`, `bestPlacement`,
  `updatedAt`. (Season can be a lightweight config, not necessarily its own heavy table in V1.)

### Payments

**Payment** (pass purchase; one active per user per tournament)
- `id`, `userId` (FK), `tournamentId` (FK), `provider` (`RAZORPAY`),
  `providerOrderId` (unique), `providerPaymentId` (nullable, unique), `amountMinor`,
  `currency`, `status` (`CREATED|PENDING|PAID|FAILED|REFUNDED`), `signatureVerified` (bool),
  `webhookEventId` (idempotency key, unique), `paidAt`, `refundedAt`, `createdAt`, `updatedAt`.
- Unique partial: one `PAID` payment per (`userId`, `tournamentId`).

**Registration** (unlocked access for a tournament — the "pass" as a state)
- `id`, `userId` (FK), `tournamentId` (FK), `paymentId` (FK), `status`
  (`ACTIVE|REVOKED|REFUNDED`), `registeredAt`. Unique: (`userId`, `tournamentId`).

**Payout** (prize disbursement to a winner)
- `id`, `userId` (FK), `tournamentId` (FK), `placement`, `amountMinor`, `currency`,
  `provider` (`RAZORPAYX`), `providerPayoutId` (nullable, unique), `status`
  (`PENDING|KYC_REQUIRED|PROCESSING|PAID|FAILED`), `tdsMinor` (tax withheld),
  `taxMeta` (jsonb), `approvedBy` (FK User), `processedAt`, `createdAt`, `updatedAt`.

### Engagement

**Notification** (record of intent + delivery state)
- `id`, `userId` (FK), `type` (`REGISTRATION_CONFIRMED|SEEDED|MATCH_REMINDER|ROUND_OPEN|
  RESULT|ELIMINATED|PAYOUT_SENT|...`), `channel` (`EMAIL|IN_APP`), `payload` (jsonb),
  `dedupeKey` (unique), `status` (`PENDING|SENT|FAILED|READ`), `sentAt`, `createdAt`.

**Badge** (definition of an award)
- `id`, `slug` (unique), `name`, `description`, `iconUrl`, `criteria` (jsonb), `createdAt`.

**UserBadge** (award instance)
- `id`, `userId` (FK), `badgeId` (FK), `tournamentId` (nullable FK), `awardedAt`.
  Unique: (`userId`, `badgeId`, `tournamentId`).

**Achievement** — for progressive/metric-based awards (streaks, N wins). Model as
`Badge` + `criteria` unless there's a reason to separate; keep V1 simple.

**HallOfFame** (curated/derived champions view)
- `id`, `tournamentId` (unique FK), `championId` (FK User), `runnerUpId` (FK),
  `finalMatchId` (FK), `highlightsUrl`, `publishedAt`. (Can also be a read-model/view over
  `Ranking.placement`; a table lets us add editorial content.)

### Admin & audit

**AuditLog** (append-only; every privileged/state-changing action)
- `id`, `actorId` (FK User, nullable for system), `action`, `entityType`, `entityId`,
  `before` (jsonb), `after` (jsonb), `ip`, `userAgent`, `correlationId`, `createdAt`.

**AdminTask / OpsEvent** (scheduler + manual ops trail)
- `id`, `type` (the lifecycle transition: `PUBLISH|OPEN_REGISTRATION|CLOSE_REGISTRATION|
  START_SIMULATION|CLOSE_SIMULATION|GENERATE_BRACKET|START_KNOCKOUT|ADVANCE_STAGE|COMPLETE|
  CANCEL`), `tournamentId` (FK), `scheduledFor`, `status` (`SCHEDULED|RUNNING|DONE|FAILED`),
  `idempotencyKey` (unique), `runBy` (system|cron|admin|runner), `payload` (jsonb),
  `result` (jsonb), `error`, `startedAt`, `completedAt`, `createdAt`, `updatedAt`.
- Written **before** the transition is applied, in the same transaction. The key is
  `optransition:{tournamentId}:{transition}` (plus the from-state for `ADVANCE_STAGE`, which
  happens once per stage) and must stay stable across the transition itself — a replay reads it
  *after* the state has moved. A `DONE` event makes the replay a no-op instead of a second
  application.

**FeatureFlag / Setting** — small config table (or rely on PostHog flags + env for V1).

---

## Relationship summary

- `Tournament 1─n Round 1─n Match`; `Round n─1 Problem`; `Problem 1─n HiddenTest`.
- `User 1─n Submission`; `Submission 1─1 Evaluation` (+ `EvaluationJob`); `Submission n─1 Round/Match/Problem`.
- `User n─n Tournament` via `Registration` (+ `Payment`).
- `Tournament 1─n Ranking (per user)`; `Match.winnerId → next Match` via `nextMatchId`.
- `User 1─n Payout`, `1─n Notification`, `n─n Badge` via `UserBadge`.
- `HallOfFame 1─1 Tournament`.

## Invariants worth enforcing in DB/transactions

1. Exactly one `PAID` `Payment` and one `ACTIVE` `Registration` per (user, tournament).
2. One `Submission` per (user, round) and per (user, match); immutable after `deadlineAt`.
3. `Match.winnerId` must be one of its two competitors (or null); advancement writes winner
   into `nextMatch` slot atomically.
4. A user cannot submit to a round/match they aren't seeded/paired into or without an active
   registration.
5. Payout only after `Tournament.status = COMPLETED`, placement set, and KYC/compliance gate.
