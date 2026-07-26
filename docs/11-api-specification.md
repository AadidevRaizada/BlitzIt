# 11 — Final API Specification

Complements [`05-api-architecture.md`](./05-api-architecture.md) (the *why*) with the concrete
*what*. All mutations follow: **Zod validate → authenticate → authorize → module (txn) →
revalidate → typed result** `{ ok: true, data } | { ok: false, error: { code, message } }`.

## Route Handlers (`src/app/api/**`)

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| ALL | `/api/auth/[...all]` | — | Better Auth | — | GitHub/Google OAuth, session, callback |
| POST | `/api/webhooks/razorpay` | signature | raw body + `x-razorpay-signature` | 200/4xx | verify against **raw body**; idempotent via `webhookEventId`; source of truth for payment state |
| GET | `/api/live/[tournamentId]` | public | — | `text/event-stream` | **E7 ✅** SSE: leaderboard, bracket, current round, participantCount, prizePool, countdown. `event: snapshot` on connect and on every change; `: heartbeat` comment while quiet; `event: reconnect` before the stream's bounded lifetime expires. Withholds the challenge of any round that has not opened; UNLISTED tournaments 404; **503 + `Retry-After` when `FEATURE_LIVE_ARENA=false`** — the kill switch closes the transport, not just the links. |
| GET | `/api/live/[tournamentId]?mode=poll` | public | — | `application/json` | **E7 ✅** The polling fallback — the *identical* `LiveSnapshot`, once. Used when SSE is blocked or buffered by a proxy. |
| GET | `/api/health` | — | — | `{ db, runner, time }` | Railway liveness/readiness incl. runner heartbeat |

## Server Actions (`src/server/actions/**`)

### Auth / Profile
| Action | Input | Authz | Effect |
|--------|-------|-------|--------|
| `updateProfile` | `{ displayName?, bio?, city?, githubUsername?, websiteUrl?, twitterHandle? }` | self | update `Profile`/`User` |
| `getProfile` (read) | `{ username }` | public | profile + history + badges |

### Payments
| Action | Input | Authz | Effect |
|--------|-------|-------|--------|
| `createPassOrder` | `{ tournamentId }` | user + registration window open + not already paid | create Razorpay order + `Payment(CREATED)`; returns `{ orderId, amountMinor, key }` |
| *(activation)* | — | — | via **webhook only**, not an action |

### Submission (E4 — see [`18-submission-pipeline.md`](./18-submission-pipeline.md))
| Action | Input | Authz | Effect |
|--------|-------|-------|--------|
| `submitSolutionAction` | `{ roundId, repoUrl, deploymentUrl, commitSha? }` | registered + tournament SIMULATION/LIVE + window open + (paired into a match, if knockout) | creates **or replaces** the entry — the server decides which; appends a `SubmissionRevision`; enqueues an `evaluate` job **after commit** |
| `getMyRoundSubmissionAction` (read) | `{ roundId }` | self | current entry + evaluation status |
| `getMySubmissionsAction` (read) | `{ tournamentId? }` | self | submission history |
| `getSubmissionAction` (read) | `{ submissionId }` | owner or admin | entry + evaluation + job lifecycle |
| `getSubmissionStatusAction` (read) | `{ submissionId }` | owner or admin | poll target for the status panel |
| `getSubmissionHistoryAction` (read) | `{ submissionId }` | owner or admin | every accepted revision |
| `listAllSubmissionsAction` (read) | `{ tournamentId?, roundId? }` | **admin** | every entry |
| `retryEvaluationAction` | `{ submissionId }` | **admin** | re-queue an evaluation (`reEnqueueEvaluation`) |
| `disqualifySubmissionAction` | `{ submissionId, reason }` | **admin** | terminal removal from competition (D19) |
| `getRevealedProblem` (read) | `{ roundId }` | registered + `now >= opensAt` | problem statement (never hidden tests) — *gating implemented inline on `/submit/[roundId]`; a standalone action lands with the arena (E5)* |

> **Rate limiting on `submitSolution` is still not implemented.** It was pencilled in for the arena
> epic; E7's scope (E7.1–E7.4) does not include it, so it moves to **E10 (hardening)**, where the
> load/burst and security work already lives and where a Postgres-backed limiter can be tuned
> against real numbers. Duplicate-entry and deployment-URL-reuse checks are in place, and the
> submission window itself bounds the exposure. See `CHANGELOG_EPIC_E7.md` → remaining risks.

### Live / Spectator (reads; also powering SSE)

**E7 as built:** these are module reads in `server/modules/tournament/live.ts`, called by the
route handler and by the server components — not Server Actions, because their only mutating
caller would be none. `getLiveSnapshot` is the single payload behind both transports.

| Read | Input | Effect |
|--------|-------|--------|
| `getLiveSnapshot` ✅ | `{ tournamentId, leaderboardTake?, now? }` | the whole spectator payload + a content `version` |
| `getLeaderboard` ✅ | `{ tournamentId, by?: 'score'\|'city'\|'seed', take? }` | ranked standings |
| `listBracketRounds` ✅ (E5/E6) | `{ tournamentId, revealProblems }` | full bracket tree + match statuses |
| `getKnockoutArena` ✅ | `{ matchId, viewerId }` | screen [10]; null for anyone not in the match |
| `getMatchWindow` ✅ | `{ matchId }` | the round's window as it applies to one match |
| `listMyLiveMatches` ✅ | `{ userId }` | the arena entry point |
| `getTournamentPublic` | `{ slug }` | *(E8)* landing-page read |

> `LiveSnapshot.version` is a hash over the snapshot's *content*, excluding `serverTime` and the
> countdown's ticking `secondsRemaining` — otherwise every read would look like a change and the
> stream would be a poll with extra steps.

### Registration (E3 — the entry *state*; E4 attaches the payment)
| Action | Input | Authz | Effect |
|--------|-------|-------|--------|
| `registerForTournamentAction` | `{ tournamentId }` | user + `REGISTRATION_OPEN` + inside window + under `maxRegistrations` | `Registration(ACTIVE)` + participant count, in one transaction |
| `withdrawFromTournamentAction` | `{ tournamentId }` | self, and only while registration is open | `Registration(REVOKED)`, frees the slot |

### Admin (all `requireAdmin`, all audited)

> **E5 as built:** admin UI actions live in `src/server/actions/admin.actions.ts` and orchestrate
> the existing modules. Implemented: tournament CRUD/schedule/archive/delete-draft/lifecycle,
> registration revocation, challenge/problem authoring, hidden tests, problem assignment,
> submission retry/disqualification, evaluation inspection, user directory, and audit reads.
> Deferred: score override, payouts, sudden death, notification controls, and spectator surfaces.

| Action | Input | Effect |
|--------|-------|--------|
| `createTournament` | tournament fields | new `Tournament(DRAFT)` |
| `updateTournamentSchedule` | `{ tournamentId, times…, roundDurations }` | set UTC schedule + durations |
| `configureTournament` | `{ tournamentId, bracketSize?, thirdPlaceEnabled?, min/maxRegistrations?, roundDurations?, evaluationProfiles? }` | shape + policy config (D6/D7/D20); refuses size/third-place changes once the bracket exists |
| `deleteTournament` | `{ tournamentId }` | DRAFT with no registrations only — anything further along is cancelled, never erased |
| `transitionTournament` | `{ tournamentId, transition, reason?, force? }` | **the single entry point for lifecycle change** (E3). `force` skips business guards only; an illegal transition is refused regardless |
| `progressTournament` | `{ tournamentId }` | ops button: seal an expired window, decide matches, advance/complete |
| `configurePrizePool` | `{ tournamentId, base, perRegistration, firstPrizeCap, distribution }` | dynamic pool params (D9) |
| `createProblem` | `{ title, category, evaluationStrategy, statement, contractSpec }` | new `Problem(DRAFT)` |
| `addHiddenTest` | `{ problemId, name, kind, spec, weight, timeoutMs }` | append `HiddenTest` |
| `publishProblem` | `{ problemId }` | `PUBLISHED` |
| `assignProblemToRound` | `{ roundId, problemId }` | link problem (revealed at `opensAt`) |
| `startRound` | `{ roundId }` | set `opensAt=now`, `deadlineAt=now+duration`, status `OPEN` |
| `closeRound` | `{ roundId }` | seal submissions, enqueue evaluations |
| `seedTournament` | `{ tournamentId, bracketSize }` | rank qualifiers → build bracket (byes) |
| `overrideScore` | `{ evaluationId, scores, reason }` | manual override + audit |
| `resolveTie` / `startSuddenDeath` | `{ matchId }` | create sudden-death round/match (D5) |
| `publishResults` | `{ tournamentId }` | placements, Hall of Fame, notify |
| `approvePayout` | `{ userId, tournamentId }` | enqueue `PROCESS_PAYOUT` |
| `reEnqueueEvaluation` | `{ submissionId }` | ops escape hatch |
| `forceTournamentTransition` | `{ tournamentId, transition }` | ops escape hatch |

## Jobs (Postgres-backed, in-process runner)

See the job contract table in [`05-api-architecture.md`](./05-api-architecture.md#internal-job-contracts-postgres-backed-in-process-runner--d3):
`EVALUATE`, `SEED_TOURNAMENT`, `ADVANCE_BRACKET`, `SEND_EMAIL`, `PROCESS_PAYOUT`,
`TOURNAMENT_TRANSITION`, `RECOMPUTE_PRIZE_POOL`.

Registered as of E3: `evaluate`, `tournamentTransition`, `seedTournament`, `advanceBracket`
(+ `noop`). Retry policy differs by failure kind — a transition that is *illegal from the current
state* completes rather than retrying (it will never become legal), while one rejected by a
*business guard* ("evaluations still draining") is retried with backoff.

### `EVALUATE` job — the core contract
```
input:  { submissionId }
steps:
  1. load Submission + Problem (+ HiddenTests)
  2. strategy = resolve(Problem.category)         // D4 pluggable
  3. functional = strategy.runHiddenTests(deploymentUrl, hiddenTests)   // 0–100
  4. performance = strategy.probePerformance(deploymentUrl)             // 0–100
  5. securityReliability = strategy.probeSecurity(deploymentUrl)        // 0–100
  6. repoText = githubApi.readAsText(repoUrl, commitSha)                // NO clone/build
  7. ai = llmQuality(repoText, rubric, { temperature: 0, model, promptHash }) // 0–100, schema-validated
  8. overall = 0.60*functional + 0.15*performance + 0.10*securityReliability + 0.15*ai
  9. write Evaluation (+ evidence JSONB), update Ranking
  10. if all match evals done → enqueue ADVANCE_BRACKET
guarantees: idempotent (eval:{submissionId}:{attempt}); retries w/ backoff via availableAt;
            untrusted repo text treated as data (prompt-injection guard); egress-controlled probes
```

## Cross-cutting conventions
- **Idempotency keys:** `webhookEventId`, `eval:*`, `seed:*`, `advance:*`, `email:*`, `payout:*`,
  `pool:*`, `optransition:*`.
- **Errors:** typed `AppError` codes (`NOT_FOUND`, `FORBIDDEN`, `VALIDATION`, `WINDOW_CLOSED`,
  `ALREADY_SUBMITTED`, `PAYMENT_REQUIRED`, `CONFLICT`, `EVALUATION_FAILED`).
- **Authorization** is per-resource and server-derived from the session — never from client input.
- **Revalidation:** `revalidatePath`/`revalidateTag` after mutations; SSE pushes live surfaces.
- **Rate limiting:** Postgres-backed on `submitSolution` and `createPassOrder`.
