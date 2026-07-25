# 11 — Final API Specification

Complements [`05-api-architecture.md`](./05-api-architecture.md) (the *why*) with the concrete
*what*. All mutations follow: **Zod validate → authenticate → authorize → module (txn) →
revalidate → typed result** `{ ok: true, data } | { ok: false, error: { code, message } }`.

## Route Handlers (`src/app/api/**`)

| Method | Path | Auth | Request | Response | Notes |
|--------|------|------|---------|----------|-------|
| ALL | `/api/auth/[...all]` | — | Better Auth | — | GitHub/Google OAuth, session, callback |
| POST | `/api/webhooks/razorpay` | signature | raw body + `x-razorpay-signature` | 200/4xx | verify against **raw body**; idempotent via `webhookEventId`; source of truth for payment state |
| GET | `/api/live/[tournamentId]` | public | — | `text/event-stream` | SSE: leaderboard, bracket, current match, participantCount, prizePool, next-round countdown. Polling fallback. |
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

> **Rate limiting on `submitSolution` is not yet implemented** — it needs its own Postgres-backed
> table and is deferred to the arena epic. Duplicate-entry and deployment-URL-reuse checks are in
> place.

### Live / Spectator (reads; also powering SSE)
| Action | Input | Effect |
|--------|-------|--------|
| `getLeaderboard` | `{ tournamentId, by?: 'score'|'city'|'seed' }` | ranked standings |
| `getBracket` | `{ tournamentId }` | full bracket tree + match statuses |
| `getTournamentPublic` | `{ slug }` | status, countdown, participantCount, prizePool, stream URL |

### Registration (E3 — the entry *state*; E4 attaches the payment)
| Action | Input | Authz | Effect |
|--------|-------|-------|--------|
| `registerForTournamentAction` | `{ tournamentId }` | user + `REGISTRATION_OPEN` + inside window + under `maxRegistrations` | `Registration(ACTIVE)` + participant count, in one transaction |
| `withdrawFromTournamentAction` | `{ tournamentId }` | self, and only while registration is open | `Registration(REVOKED)`, frees the slot |

### Admin (all `requireAdmin`, all audited)
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
