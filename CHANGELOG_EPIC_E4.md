# Epic E4 — Submission System & Evaluation Pipeline

**Status:** ✅ Complete · **Branch:** `epic-e4-submissions`

The competitor-facing half of the product: accept an entry, keep its history, seal it at the
deadline, and hand it to the queue that reaches the Evaluation Engine.

> **Scope note.** The blueprint numbers this work differently: `E4` there is Payments and the
> submission pipeline lives in `E5.1–E5.3`. This epic implements the **submission pipeline**
> (blueprint E5.1/E5.2/E5.3 + the job-lifecycle half of E0.5). Payments remain unbuilt. See
> [Deviations](#deviations-from-the-blueprint).

## What was built

`src/server/modules/submission/`

| Module | Responsibility |
|---|---|
| `state.ts` | **Pure** submission state machine + the evaluation-freshness rule |
| `validation.ts` | Repo/deployment/commit validation, reusing the engine's own repo parser |
| `submissions.ts` | Accept · replace · seal · read · history · admin retry/disqualify |
| `index.ts` | The module's public surface |

Plus `src/server/jobs/status.public.ts` + `status.ts` (typed job lifecycle),
`src/server/actions/submission.actions.ts`, `src/lib/validation/submission.schema.ts`, four UI
screens, and `scripts/verify-submission.ts`.

**The path is strictly `Submission → Queue → Runner → Evaluation Engine`.** Nothing in the
Submission module imports `runEvaluation`; the only link is `enqueueEvaluation` through the
`Queue` interface.

## Architectural decisions

| Decision | Rationale |
|---|---|
| **Domain state names map onto the existing `SubmissionStatus` enum** | E2 and E3 already read and write `RECEIVED/QUEUED/JUDGING/SCORED/FAILED/DISQUALIFIED`. Adding `READY/EVALUATING/EVALUATED/…` would have left two vocabularies for one concept — the schema drift the brief forbids — and silently broken E3's `PENDING_SUBMISSION_STATUSES` and `CLOSE_SIMULATION` guard, both of which enumerate the current values. |
| **`DRAFT` is not persisted** | A row exists only once an entry is accepted. Persisting drafts would put unsubmitted rows inside the `(userId, roundId)` unique key E3's advancement reads through, and make "did they submit?" ambiguous at the deadline. |
| **`RESUBMITTED` is a transition, not a state** | After resubmitting, an entry is *queued*, not sitting in limbo. As a state it could be rested in forever. The replacement history lives in `SubmissionRevision`. |
| **History in a sibling table, not extra `Submission` rows** | Doc 02 asks for append-only edits while the window is open, but the `(userId, roundId)` unique key — which E3 reads through `findUnique` — forbids multiple rows. A sibling table delivers append-only history without relaxing a constraint another epic depends on. |
| **Job lifecycle states are derived, not stored** | "Is this a retry?" is a question about `attempts` and `availableAt`. Storing the answer too would let the two disagree after a stale-claim reclaim, and would mean migrating the queue substrate E0/E2/E3 share, for no new information. |
| **`category` is snapshotted onto the submission** | It is the category the entry was validated and scored against. Re-categorising a problem afterwards must not silently rewrite history. |
| **Validation reuses the engine's `parseRepoUrl`** | If submit-time and evaluation-time rules disagreed, we would accept entries at the deadline that the evaluator later refuses to read — the worst possible moment to find out. |
| **Submit-time URL checks are syntactic only** | They run in front of a deadline burst. The real egress defence is the SSRF guard at probe time (E2); re-resolving here would double the cost and still be TOCTOU. |
| **Enqueue happens after the transaction commits** | Enqueuing inside it would let the runner claim a job for a row that has not landed — the classic dual-write race — and a rollback would strand a job pointing at a submission that never existed. |
| **A result is only written if the revision is unchanged** | A competitor may replace an entry mid-evaluation. The in-flight result describes code nobody is competing with any more, and a fresh job is already queued. |
| **State-machine violations are translated to `ConflictError`** | `InvalidSubmissionTransitionError` is a plain `Error`; letting it escape surfaced as `INTERNAL` — a 500 for "you cannot do that to a submission in this state". Nothing raw crosses the module boundary. |
| **Deployment-URL reuse is refused within a round (D19)** | Two entries on one deployment are collusion or a copy-paste mistake; both deserve to fail at submit time rather than produce two identical scores. |
| **Knockout submission rights come from the bracket** | A competitor may only submit to a round they were actually paired into — derived from `Match`, never from the client having navigated to the page. |

## Migrations

Two, both additive:

- `20260725121608_e4_submission_pipeline` — `Submission.category` (added nullable, **backfilled
  from the joined Problem**, then set `NOT NULL` — Prisma's generated `ADD COLUMN … NOT NULL`
  would have failed on any non-empty table), `Submission.version`, `Submission.updatedAt`,
  `Evaluation.llmProvider`, the `SubmissionRevision` table, and an index on
  `Submission(userId, tournamentId)`.
- `20260725122754_e4_evaluation_submission_version` — `Evaluation.submissionVersion`.
- `20260725140000_e4_deployment_url_unique_per_round` — `@@unique([roundId, deploymentUrl])`,
  enforcing D19 deployment-URL reuse detection in the database rather than in a racy read-then-write
  check (Codex finding 3).

`OpsEvent.updatedAt` also gained `@default(now())` in the schema so it matches what the E3
migration actually created; without it Prisma read the database as drifted and emitted a
`DROP DEFAULT`.

## Breaking changes

**None at runtime.** One compile-time consequence: `Submission.category` is required, so the E2
and E3 verification fixtures that create submissions directly were updated to supply it. No
production code path changed behaviour.

## Bugs found during implementation

1. **State-machine violations escaped as raw errors.** `retryEvaluation` on a disqualified entry
   threw `InvalidSubmissionTransitionError`, which is not an `AppError`, so the action mapped it
   to `INTERNAL`. The brief requires typed errors at the boundary. Fixed with a translation
   wrapper; every service transition now goes through it.
2. **The client bundle pulled in `server-only`.** The status badge imported the job helpers, which
   were `server-only`, breaking `next build`. Split into `status.public.ts` (pure, isomorphic) and
   `status.ts` (server), following the `config.public.ts` precedent from E3 — with a compile-time
   assertion that the public mirror still matches the Prisma enum exactly.
3. **The module barrel could not load outside Next.** `submissions.ts` imported `isAdmin` from the
   auth barrel, which re-exports `session.ts` and therefore `next/navigation` — fine in a request,
   fatal in a script or the runner. Fixed by importing the pure `roles.ts` predicate, which exists
   for exactly this reason.
4. **The first stale-revision test passed vacuously.** It raced a real evaluation against a
   replacement with a fixed sleep; the evaluation finished first, so the guard was never
   exercised. Caught only because the test asserted its own overlap. Replaced with a pure,
   deterministic predicate (`isEvaluationResultCurrent`) that the processor now calls.
5. **The generated migration would have failed on a non-empty table** (see Migrations).

Four more were found by the Codex review, plus one while fixing them — see
[Codex review](#codex-review).

## Codex review

Four findings. **All four were genuine and are fixed**, each with a regression test. No false
positives. Codex separately confirmed clean: the Queue decoupling, Zod + session-derived auth,
ownership/admin gates, migration additivity, engine stage-agnosticism, E2/E3 enum compatibility,
and the client-bundle split.

| # | Severity | Finding | Verdict & fix |
|---|---|---|---|
| **1** | critical | **Only the success path guarded its status write.** The processor checked `DISQUALIFIED` at load, then wrote `JUDGING` unconditionally — so an admin disqualifying an entry in that window would see it dragged back and scored. Worse, the *catch* path wrote `QUEUED`/`FAILED` unconditionally: a stale job for a superseded revision could mark the competitor's **current** revision `FAILED`, and E3's seeding counts only `SCORED`. | **Confirmed, both halves.** Every status write now goes through `writeStatusIfCurrent`, a conditional `updateMany` on `{ id, version, status ≠ DISQUALIFIED }`; the processor bails if it no longer owns the entry. Two regressions: an in-flight job cannot revive a disqualified entry, and a stale job never marks the current revision `FAILED`. |
| **2** | high | **The evaluation ignored the snapshotted category.** The processor passed `submission.problem.category` to the engine instead of `submission.category` — contradicting the column's entire purpose. Re-categorising a problem mid-tournament would retroactively change how accepted entries were scored, or fail them outright as unsupported. | **Confirmed.** Now passes `submission.category`. Regression asserts re-categorising the *problem* does not fail an already-accepted entry, and that only the snapshot on the entry decides. The E2 fixture, which relied on the old behaviour, was updated to match the corrected semantics. |
| **3** | high | **Deployment-URL reuse detection was TOCTOU-racy.** The check was `findFirst`-then-insert with no constraint behind it, so two competitors submitting the same URL concurrently would both pass and both insert — bypassing D19. | **Confirmed.** Added a `@@unique([roundId, deploymentUrl])` index (migration `20260725140000`), and the module now translates the resulting `P2002` back into the same typed `ConflictError` the friendly check produces. Regression fires two concurrent identical submissions and asserts exactly one is accepted with a typed error for the loser. |
| **4** | medium | **The submit route read Prisma directly**, re-deriving the problem-reveal and editability rules in the page — a second place that can drift from the module's rules, and a violation of the "no Prisma outside module boundaries" constraint. | **Confirmed.** Added `getRevealedRound` to the Tournament module (which owns `opensAt` and therefore the reveal gate); the page now consumes a view model and touches no Prisma. Hidden tests are still never selected. |

### A second bug found while fixing #3

Translating `P2002` did not work at first: the obvious implementation reads `error.meta.target`,
but with the `@prisma/adapter-pg` driver adapter that field **does not exist** — the constraint
detail lives under `meta.driverAdapterError.cause`. The raw Prisma error was escaping the module
boundary. `violatedTarget` now reads every shape. Caught by the regression test asserting the
error *type*, not just that the insert failed.

## Verification

| Suite | Result |
|---|---|
| `verify:submission` | **179/179** — state machine, validation, job lifecycle, the full persisted pipeline, and a regression for every Codex finding |
| `verify:auth` / `verify:queue` / `verify:runner` | 36 / 15 / 5 — no regressions |
| `verify:evaluation` / `verify:evaluation:e2e` / `verify:profiles` | 31 / 19 / 30 — no regressions |
| `verify:tournament` / `verify:bracket` / `verify:tournament:e2e` | 197 / 118 / 134 — no regressions |
| tsc · eslint · prettier · next build | all pass |

`verify:submission` covers every item the brief listed: valid submission, invalid URLs (14 cases),
duplicate/reused deployment, closed and not-yet-open windows, unauthorised edits and reads, queue
creation, retry flow, evaluation completion with full persistence, failed evaluation, permission
checks for competitor and admin, and the exhaustive state-transition matrix.

## Deviations from the blueprint

| # | Deviation | Why |
|---|---|---|
| **1** | **This epic is the blueprint's E5.1–E5.3, not its E4** | The brief defined E4 as the submission pipeline. Payments (blueprint E4) remain unbuilt; nothing here depends on them, and `Registration` already carries an optional `paymentId` for that epic to fill in. |
| **2** | **Domain state names ≠ persisted enum members** | See the decisions table. The brief's lifecycle was given as an *example*; honouring it literally would have created two vocabularies and broken E3. |
| **3** | **`DRAFT` and `RESUBMITTED` are not persisted states** | See the decisions table. |
| **4** | **Versioning uses a sibling `SubmissionRevision` table** | Doc 02's "edits create a new row" contradicts its own `(userId, roundId)` unique key, which E3 depends on. This satisfies the intent without breaking the constraint. |
| **5** | **Rate limiting not implemented** | Doc 11 calls for a Postgres-backed rate limit on `submitSolution`. It was not in the E4 scope list and needs its own table; deferred to E5 with the arena. Duplicate-submission and deployment-reuse checks *are* in place. |
| **6** | **The simulation arena and problem-reveal screens are not built** | The brief asked for "minimal UI to verify functionality". `/submit/[roundId]` reveals the problem at `opensAt` and takes an entry; the three-round arena with countdowns is E5. |

## Intentionally deferred to later epics

- **Payments** (blueprint E4) — registration carries no money yet.
- **Rate limiting** on submission and order creation.
- **Simulation arena** with server countdowns and the three-round flow (E5.4).
- **More challenge strategies** — only REST_API is evaluable (D17); the submission path refuses
  anything else at submit time with a clear error.
- **Score override and the evidence viewer** in admin — `Evaluation.overriddenBy` /
  `overrideReason` exist and are surfaced read-only; the authoring UI is later.
- **SSE live status** — the detail screen polls a read action every 3s and stops when the entry
  settles. SSE replaces it when the live surfaces land (E7/E8).
- **Sudden death** (E6.3) — unchanged from E3.

## Known limitations

- **Polling, not streaming.** Fine for one competitor watching one submission; it is not the
  spectator surface.
- **Deployment-URL reuse is detected within a round**, not across a tournament or globally.
- **No plagiarism detection** — explicitly out of scope for V1 (D19).
- **`sealRoundSubmissions` must be called** when a round closes; E5's arena will wire it to the
  round-close transition. Until then it is an explicit call, covered by tests.
