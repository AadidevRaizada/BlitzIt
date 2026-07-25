# 18 — Submission Pipeline

> Implementation reference for **Epic E4**. Complements
> [`04-module-breakdown.md`](./04-module-breakdown.md) (module 6) with the submission lifecycle,
> validation rules, queue handoff and job states as built.
> Decisions referenced: **D3** (Postgres queue), **D16** (public GitHub only), **D17** (REST_API
> only), **D19** (anti-cheat), **D20** (stage profiles).

---

## 1. The path

```
competitor
    │  submitSolution
    ▼
Submission module ──── asks ────► Tournament module   (is the window open? is this
    │                                                  competitor registered/paired?)
    │  enqueueEvaluation
    ▼
Queue (Postgres, D3)
    │  claim (SKIP LOCKED)
    ▼
Runner  ──► evaluate processor ──► Evaluation Engine ──► Evaluation row
```

**Nothing in the Submission module imports `runEvaluation`.** The only link to scoring is
`enqueueEvaluation` through the `Queue` interface, so the engine stays swappable and the
submission path stays fast at a deadline burst.

Equally, the Submission module never derives a schedule. It asks
`isSubmissionWindowOpen(round)` — E3 owns *when*, E4 owns *what*.

---

## 2. Submission lifecycle

```
  DRAFT ──SUBMIT──► READY ──ENQUEUE──► QUEUED ──START──► EVALUATING
 (not                 ▲                  │                 │  │  │
persisted)            │                  │        COMPLETE │  │  │ REQUEUE
                      │                  │                 ▼  │  └──────► QUEUED
                      │                  │            EVALUATED
                      │                  │                 │  │ FAIL
                      │                  │           RETRY │  ▼
                      └── RESUBMIT ──────┴─────────────────┴─ FAILED ──RETRY──► QUEUED

  any non-terminal ──DISQUALIFY──► DISQUALIFIED   (terminal)
```

### Domain states vs the persisted enum

| Domain state | Persisted `SubmissionStatus` |
|---|---|
| `READY` | `RECEIVED` |
| `QUEUED` | `QUEUED` |
| `EVALUATING` | `JUDGING` |
| `EVALUATED` | `SCORED` |
| `FAILED` | `FAILED` |
| `DISQUALIFIED` | `DISQUALIFIED` |

The E4 brief sketched the lifecycle with different spellings. Rather than add enum members that
duplicate existing meanings, the domain vocabulary maps onto the values E2 and E3 already read and
write. Adding `READY`/`EVALUATING`/`EVALUATED` to the Postgres enum would have created two
vocabularies for one concept and silently broken E3's `PENDING_SUBMISSION_STATUSES` and its
`CLOSE_SIMULATION` guard, both of which enumerate the current values.

Two sketched states are deliberately absent:

- **`DRAFT` is never persisted.** A row exists only once an entry is accepted. Persisting drafts
  would put unsubmitted rows inside the `(userId, roundId)` unique key that E3's advancement reads
  through, and would make "did they submit?" ambiguous at the deadline.
- **`RESUBMITTED` is a transition, not a state.** After resubmitting, an entry is queued — not
  resting in limbo. As a state it could be left there forever.

`DISQUALIFIED` is terminal: a struck entry is never re-evaluated, because re-queueing it would
quietly restore a score an admin deliberately removed.

### Errors are always typed

`nextSubmissionState` throws `InvalidSubmissionTransitionError`, a plain `Error`. The service layer
translates it into a `ConflictError` so nothing raw crosses the module boundary — otherwise "you
cannot retry a disqualified entry" would surface to the client as `INTERNAL`.

---

## 3. Versioning and history

One `Submission` per `(user, round)` — the unique key E3 reads through — plus an append-only
`SubmissionRevision` row for every accepted version.

```
Submission (current)          SubmissionRevision (history)
  version: 3          ◄────────  v1  repo … deployment … submittedAt
  repoUrl: …                     v2  repo … deployment … submittedAt
  deploymentUrl: …               v3  repo … deployment … submittedAt
```

Doc 02 asks for append-only edits while the window is open, but its own `(userId, roundId)` unique
key forbids multiple current rows. A sibling table delivers the history without relaxing a
constraint another epic depends on.

Replacing an entry bumps `version`, appends a revision, returns the submission to `READY`, and
queues a fresh evaluation.

### Sealing

`sealRoundSubmissions(roundId)` stamps `sealedAt` on every entry once the window is over. A sealed
submission is immutable — "no edits after the deadline" is a property of the data, not of the UI.
It refuses to run while the window is still open, and is idempotent.

### Stale results

A competitor may replace an entry while an evaluation is in flight. The processor captures the
revision it loaded and calls `isEvaluationResultCurrent` before persisting: if the submission has
moved on (or was disqualified), the result is discarded and logged. A fresh job is already queued
for the new revision, so nothing is lost.

`Evaluation.submissionVersion` records which revision produced each score, so a past result can be
explained without guessing.

**Every** status write in the processor is conditional on
`{ id, version: evaluatedVersion, status ≠ DISQUALIFIED }` — not just the success path. A job that
was already running must not drag a struck entry back to `JUDGING`, and a failure in a job for a
superseded revision must not mark the competitor's *current* revision `FAILED` (E3's seeding counts
only `SCORED`).

### The evaluated category is the snapshot

The processor passes `submission.category` to the engine, never `submission.problem.category`.
Re-categorising a problem mid-tournament must not retroactively change how an already-accepted
entry is scored, nor fail it as unsupported.

---

## 4. Validation

Submit-time checks are **syntactic and fast** — they run in front of a deadline burst. The real
egress defence is the SSRF guard the engine applies at probe time (E2); re-resolving here would
double the cost and still be a TOCTOU check.

| Input | Rule |
|---|---|
| `repoUrl` | `https://` + `github.com/owner/repo` (D16). Normalised — `.git` and trailing paths stripped — so two spellings cannot masquerade as different entries. Uses the engine's own `parseRepoUrl`, so submit-time and evaluation-time can never disagree. |
| `deploymentUrl` | `https://` only, hostname required, no embedded credentials, and obvious private/loopback/link-local/CGNAT/`.local` targets refused with a clear message. |
| `commitSha` | Optional; 7–40 hex, lowercased (D19 commit pinning). |
| category | Must be enabled for evaluation (D17 — REST_API only). Refused at submit time so a competitor gets an actionable error instead of an entry that dead-letters later. |

### Access rules, in order

1. Round exists, and the tournament is `SIMULATION` or `LIVE`.
2. The competitor has an **ACTIVE registration** (E3 owns this gate).
3. The **submission window is open** (E3 owns this too).
4. The round has a problem, in an enabled category.
5. For **knockout** rounds, the competitor must be paired into a `Match` in that round —
   derived from the bracket, never from the client having navigated to the page.
6. The deployment URL is not already claimed by another competitor in the same round (D19).

The last rule has **two halves**: a friendly read-then-write check that produces a clear message,
and a `@@unique([roundId, deploymentUrl])` index that actually prevents the duplicate. The check
alone is a race (two competitors submitting the same URL concurrently both pass it); the
constraint alone gives a useless error. The module translates the constraint violation back into
the same typed `ConflictError`, so a race is indistinguishable to the caller.

---

## 5. Job lifecycle

Seven lifecycle states over five persisted ones:

| Lifecycle state | Derived from |
|---|---|
| `QUEUED` | `status = QUEUED`, runnable now |
| `RETRY_SCHEDULED` | `status = QUEUED`, `attempts > 0`, `availableAt` in the future |
| `CLAIMED` | `status = CLAIMED` |
| `RUNNING` | `status = RUNNING` |
| `COMPLETED` | `status = DONE` |
| `FAILED` | `status = FAILED`, attempts remain |
| `DEAD_LETTER` | `status = FAILED`, `attempts >= maxAttempts` |

Retry and dead-letter are **derived, not stored**: "is this a retry?" is a question about
`attempts` and `availableAt`, and storing the answer too would let the two disagree after a
stale-claim reclaim. It would also mean migrating the queue substrate E0/E2/E3 share, for no new
information.

`status.public.ts` holds the pure helpers so client components can render a job state without
pulling `server-only` into the browser bundle; `status.ts` re-exports them for the server and
carries a **compile-time assertion** that the public mirror still matches the Prisma enum exactly.

### Attempt numbering

Each accepted revision and each admin retry enqueues with `attempt = (jobs so far) + 1`, giving a
distinct idempotency key (`eval:{submissionId}:{attempt}`) per run while a duplicate call still
collapses onto the existing job.

### Enqueue happens after commit

The job is created **after** the submission transaction commits. Enqueuing inside it would let the
runner claim a job for a row that has not landed yet — the classic dual-write race — and a rollback
would strand a job pointing at a submission that never existed.

---

## 6. Persistence of a result

The processor writes, without changing any engine internals:

`overallScore` · four dimension scores · `testsPassed`/`testsTotal` · `deploymentReachable` ·
`weights` · `profileName` + `dimensions` (D20) · `probeEvidence` · `testResults` ·
`repoTextSnapshot` · `rubricVersion` · `llmProvider` · `modelId` · `modelPromptHash` · `llmRaw` ·
`submissionVersion` · `attempt` · `startedAt`/`finishedAt`.

`llmProvider` is lifted out of the engine's existing audit payload into its own column so "which
backend scored this round?" is answerable without parsing JSONB.

---

## 7. Authorization

| Actor | May |
|---|---|
| Competitor | Submit and replace **their own** entry; view their own submissions, history and evaluations |
| Admin | View **all** submissions, inspect evaluation evidence, retry an evaluation, disqualify an entry |

Ownership is checked inside the module (`assertCanView`), not in the page, so every caller — action,
script, future API — gets the same answer. The detail page turns `FORBIDDEN` into a 404 so a
competitor cannot distinguish "does not exist" from "belongs to someone else".

---

## 8. UI (minimal, per the brief)

| Screen | Route | Notes |
|---|---|---|
| My Submissions | `/submissions` | RSC list, newest first |
| Problem + Submission | `/submit/[roundId]` | Problem revealed at `opensAt`; one form creates *or* replaces — the server decides which |
| Submission detail | `/submissions/[submissionId]` | Entry, live status, results, revision history |
| Evaluation status | *(island)* | Polls a read action every 3s, stops when the entry settles |
| Admin submissions | `/admin/submissions` | Every entry + retry |

Polling lives in the view, never in a business module. SSE replaces it when the live surfaces land.

---

## 9. Verification

`verify:submission` — **172 checks**:

| Area | Covers |
|---|---|
| State machine | The exhaustive legal/illegal matrix per state, terminal `DISQUALIFIED`, domain ↔ persisted round-trip |
| Validation | 6 repo cases, 12 deployment cases, commit SHA, normalisation |
| Job lifecycle | All seven states incl. retry-scheduled and dead-letter |
| Pipeline | Accept → queue → runner → engine → persisted result with full evidence |
| Refusals | Unregistered, invalid URLs, reused deployment, closed window, not-yet-open round, sealed entry, wrong tournament state, unpaired knockout competitor |
| Authorization | Cross-competitor read/edit, admin-only list/retry |
| Freshness | `isEvaluationResultCurrent` for every case + the recorded `submissionVersion` |
| Failure paths | Disabled category refused up front and dead-ended in the processor |
