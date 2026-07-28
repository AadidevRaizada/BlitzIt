# Validation run — `2026-w3` "Circuit three"

**Full reconciled-lifecycle validation, end to end, in production.**

Date: 2026-07-28 (UTC timestamps throughout; IST = UTC+05:30)
Environment: Railway project `grand-alignment`, environment `production`
Deployed commit: `634d9d9` — *refactor(tournament): reconcile the lifecycle against the schedule*
Validates: **D32** (schedule drives the lifecycle) and **D33** (the lifecycle is reconciled against the schedule, not cached from it)

> This tournament was an **engineering validation run, not production history**. The
> tournament, its eight synthetic competitors and every dependent record were deleted
> immediately after this document was written. This file is the permanent evidence.

---

## 1. Why this run existed

D33 replaced a *cached* lifecycle status with a *reconciled* one. The bug class it removed had
produced four distinct production failures, all from a single cause — the schedule (the plan) and
the status (the position) were free to disagree:

- a public page rendering `REGISTRATION OPEN` directly above `registration has not opened yet`,
  both statements true, read from two different sources;
- `2026-w1` and `2026-w2` permanently wedged, because the lifecycle is forward-only and
  `CLOSE_REGISTRATION` could never satisfy `minRegistrations`;
- `OPEN_REGISTRATION` firing at 16:52 for a registration window that had closed at 16:20;
- a DRAFT publishing itself 35 seconds after creation, mid-configuration.

Unit and integration suites passed throughout all of that. The failures were only ever visible
against a real deployment with a real clock and a real job runner, so the architecture was
validated the same way.

---

## 2. Tournament metadata

| Field | Value |
|---|---|
| id | `b1840c57-daf9-4681-bece-3c33d7b83ff7` |
| slug | `2026-w3` |
| name | Circuit three |
| description | Clean validation of the reconciled lifecycle. |
| final status | `COMPLETED` |
| visibility | `PUBLIC` |
| bracketSize | **8** (automatic — not set by hand) |
| thirdPlaceEnabled | `false` |
| participantCount | 8 |
| passPriceMinor | 0 (free entry) |
| prizePoolMinor | 0 |
| roundDurations | `{"simulation":[120,120,120],"stages":{"QF":120,"SF":120,"FINAL":120}}` |
| createdAt | 18:36:38.987 |
| seededAt | 19:00:14.440 |
| bracketGeneratedAt | 19:00:14.572 |
| completedAt | 19:11:17.518 |

Round durations were compressed to 120 seconds so a genuine end-to-end run finished in
minutes rather than hours. This is ordinary per-tournament configuration (**D7**), not a test
hook — the same code path a real tournament uses.

### Schedule as planned vs. as recorded

| Anchor | Planned at creation | Value after the run |
|---|---|---|
| registrationOpensAt | 18:38:38.987 | 18:38:38.987 (unchanged) |
| registrationClosesAt | 18:42:38.987 | **18:44:09.728** |
| simulationOpensAt | 18:43:38.987 | 18:43:38.987 (unchanged) |
| simulationClosesAt | 18:51:38.987 | **19:00:14.376** |
| liveStartsAt | 18:52:38.987 | 18:52:38.987 (unchanged) |

**Note for future readers:** `CLOSE_REGISTRATION` and `CLOSE_SIMULATION` *rewrite their own
anchor* to the instant they actually ran. Those two columns are therefore "planned" before the
transition and "actual" after it. This is load-bearing for D33: it guarantees a passed
milestone's anchor is always `<= now`, which is exactly the invariant `scheduleEditConflicts`
enforces. The two mechanisms agree by construction rather than by coincidence.

### Competitors

Eight synthetic users, `val-1` … `val-8`, emails `val-N@validation.test`. Registered directly as
`ACTIVE` rows with no payment hold (free entry ⇒ competition-eligible). Eight was not arbitrary:
`MIN_BRACKET_SIZE` is 8 and production `minRegistrations` is 8, so a full lifecycle **cannot** be
validated with fewer.

Nobody submitted anything. That was deliberate — the point of the run was the *lifecycle*, and a
field that never submits still has to reach a champion via the documented absence rules.

---

## 3. Complete lifecycle timeline

Every `OpsEvent`, in completion order. `runBy` is the transition's source and is the single most
important column here: it is the machine-checkable evidence of what was automated.

| # | Transition | runBy | Scheduled | Started | Completed | Idempotency key suffix |
|---|---|---|---|---|---|---|
| 1 | `PUBLISH` | **admin** | 18:43:43.553 | 18:43:43.553 | 18:43:43.578 | `:PUBLISH` |
| 2 | `OPEN_REGISTRATION` | schedule | 18:44:09.697 | 18:44:09.697 | 18:44:09.715 | `:OPEN_REGISTRATION` |
| 3 | `CLOSE_REGISTRATION` | schedule | 18:44:09.728 | 18:44:09.728 | 18:44:09.794 | `:CLOSE_REGISTRATION` |
| 4 | `START_SIMULATION` | schedule | 18:50:11.513 | 18:50:11.513 | 18:50:11.579 | `:START_SIMULATION` |
| 5 | `CLOSE_SIMULATION` | schedule | 19:00:14.376 | 19:00:14.376 | 19:00:14.475 | `:CLOSE_SIMULATION` |
| 6 | `GENERATE_BRACKET` | schedule | 19:00:14.485 | 19:00:14.485 | 19:00:14.621 | `:GENERATE_BRACKET` |
| 7 | `START_KNOCKOUT` | schedule | 19:05:15.841 | 19:05:15.841 | 19:05:15.873 | `:START_KNOCKOUT` |
| 8 | `ADVANCE_STAGE` | runner | 19:07:16.510 | 19:07:16.510 | 19:07:16.576 | `:ADVANCE_STAGE:LIVE:QF` |
| 9 | `ADVANCE_STAGE` | runner | 19:09:17.017 | 19:09:17.017 | 19:09:17.059 | `:ADVANCE_STAGE:LIVE:SF` |
| 10 | `COMPLETE` | runner | 19:11:17.518 | 19:11:17.518 | 19:11:17.594 | `:COMPLETE` |

All ten `DONE`. **Exactly one carries `runBy = admin`.**

### The three transition sources, and what each means

- **`admin`** — a human. Exactly one: `PUBLISH`. Under D33 this is the only deliberate act in the
  whole lifecycle. Creating a tournament is not the same as declaring it ready, so DRAFT is off
  the automatic path entirely.
- **`schedule`** — the reconciler (`reconcileTournament`), driven by the 30-second sweep in the
  runner. Owns every phase boundary that has a wall-clock anchor.
- **`runner`** — round-completion progression (`advanceBracket` → `progressTournament`, **D30**).
  Owns `ADVANCE_STAGE` and `COMPLETE`, because a knockout stage ends when its matches are decided,
  **not** when a clock says so. The schedule has nothing to say after kickoff.

### Rounds

| Stage | Seq | Type | Status | Opened | Deadline | Duration |
|---|---|---|---|---|---|---|
| SIMULATION | 1 | SIMULATION | COMPLETED | 18:50:11 | 18:52:11 | 120s |
| SIMULATION | 2 | SIMULATION | COMPLETED | 18:52:12 | 18:54:12 | 120s |
| SIMULATION | 3 | SIMULATION | COMPLETED | 18:54:12 | 18:56:12 | 120s |
| QF | 1 | KNOCKOUT | COMPLETED | 19:05:15 | 19:07:15 | 120s |
| SF | 2 | KNOCKOUT | COMPLETED | 19:07:16 | 19:09:16 | 120s |
| FINAL | 3 | KNOCKOUT | COMPLETED | 19:09:17 | 19:11:17 | 120s |

Every round opened **1 second or less** after the previous round's deadline (18:52:11 → 18:52:12;
19:07:15 → 19:07:16; 19:09:16 → 19:09:17). That is the 30-second deadline sweep working at its
best case, and it is the behaviour D30 was built to produce.

---

## 4. Bracket

`bracketSize` 8 was chosen automatically by `autoBracketSize(8)` — the **smallest supported draw
that fits the whole field** (amended **D6**). Eight competitors is an exact power of two, so the
draw was full: **7 matches, 0 byes, 0 void slots**.

| Stage | Pos | Side A | Seed | Side B | Seed | Winner | Reason | Status |
|---|---|---|---|---|---|---|---|---|
| QF | 0 | val-1 | 1 | val-3 | 8 | **val-1** | WALKOVER | DECIDED |
| QF | 1 | val-5 | 4 | val-8 | 5 | **val-5** | WALKOVER | DECIDED |
| QF | 2 | val-2 | 2 | val-7 | 7 | **val-2** | WALKOVER | DECIDED |
| QF | 3 | val-4 | 3 | val-6 | 6 | **val-4** | WALKOVER | DECIDED |
| SF | 0 | val-1 | 1 | val-5 | 4 | **val-1** | WALKOVER | DECIDED |
| SF | 1 | val-2 | 2 | val-4 | 3 | **val-2** | WALKOVER | DECIDED |
| FINAL | 0 | val-1 | 1 | val-2 | 2 | **val-1** | WALKOVER | DECIDED |

**7 of 7 decided. 0 submissions, 0 evaluations.**

Two structural facts worth reading carefully:

1. **The first-round pairings are the standard reflection order** — `1v8, 4v5, 2v7, 3v6`. This is
   `seedOrder(8) = [1,8,4,5,2,7,3,6]`, which is what guarantees seed 1 and seed 2 can only meet in
   the final. They did.
2. **Every match resolved by the double-no-show rule**, recorded as `winReason = WALKOVER`, and in
   every case the **better seed advanced**. Nobody submitted anything, so with
   `advanceHigherSeedOnDoubleNoShow` enabled the higher seed takes it rather than the match
   deadlocking. This is why a field that never competes still produces a champion instead of
   wedging the bracket — and it is precisely the property that made an unattended validation run
   possible at all.

---

## 5. Rankings and final standings

| Username | Seed | Qualified | Simulation score | Placement | Eliminated at |
|---|---|---|---|---|---|
| val-1 | 1 | yes | 0 | **1** | — |
| val-2 | 2 | yes | 0 | **2** | FINAL |
| val-4 | 3 | yes | 0 | **3** | SF |
| val-5 | 4 | yes | 0 | **3** | SF |
| val-8 | 5 | yes | 0 | 5 | QF |
| val-6 | 6 | yes | 0 | 5 | QF |
| val-7 | 7 | yes | 0 | 5 | QF |
| val-3 | 8 | yes | 0 | 5 | QF |

**All 8 qualified, nobody cut.** Under the amended **D6** the draw is sized *up to the field*
rather than the field being cut *down to the draw*, so `eliminated` was empty — as it must be for
any field of 8 to 64.

**Placements are correct, including the shared third.** Third place was disabled, so both losing
semi-finalists share placement 3, and all four quarter-final losers share 5. That is the placement
*band* logic: a stage's band starts one past the number of competitors who outlived it. SF had 2
matches with 2 winners ⇒ band starts at 3. QF had 4 matches with 4 winners ⇒ band starts at 5.

**Why the seed order looks shuffled.** Every competitor scored 0 (nobody submitted), so the entire
D5 tie-break chain was exhausted and ordering fell through to registration time, then `id`. All
eight registrations were inserted in a single transaction and share an identical `registeredAt`,
so the random UUID decided the seeding. This is the documented final tie-break behaving exactly as
specified — and it confirms the ordering is *deterministic* rather than left to whatever order the
database happened to return rows in.

---

## 6. Hall of Fame

| Field | Value |
|---|---|
| champion | **val-1** |
| runnerUp | val-2 |
| participantCount | 8 (frozen at publication) |
| publishedAt | 19:11:17 |

Published **automatically**, inside the same pass as `COMPLETE` (19:11:17.518 → 19:11:17.594), by
`publishHallOfFame` in `progressTournament`. No operator action. This confirms the Hall of Fame is
never "one forgotten click behind reality".

---

## 7. Guard failures encountered — and why they are the most valuable part of this run

Four reconciliation attempts **failed**, and every one of them failed *correctly*. A reconciler
that only works when nothing is wrong is not validated; these are the evidence that the failure
path behaves as designed.

| # | Job | Attempts | Recorded reason |
|---|---|---|---|
| 1 | `reconcileTournament` | 2 | `3 simulation round(s) have no problem assigned (round 1, 2, 3); assign a published problem to every simulation round before starting` |
| 2 | `reconcileTournament` | 2 | *(same — the next 5-minute bucket, still unassigned)* |
| 3 | `reconcileTournament` | 2 | `1 simulation round(s) have not finished (round 3); let each window close before seeding` |
| 4 | `reconcileTournament` | 2 | `Round 88edfd9a… (QF, sequence 1) cannot open: no problem is assigned. Assign a published problem to this round before opening it.` |

What each one proves:

- **#1 and #2 — the D31 content-setup gate.** `CLOSE_REGISTRATION` creates the simulation rounds
  empty; `START_SIMULATION` refuses until a published problem is attached to each. The reconciler
  did *not* force past it, did *not* corrupt state, and did *not* give up — it retried each bucket
  and proceeded the moment problems were assigned.
- **#3 — the phase-boundary guard.** `CLOSE_SIMULATION` refused while simulation round 3 was still
  open, naming the round. Seeding must never run on a field that can still change its scores.
- **#4 — the same content gate on the knockout side.** `GENERATE_BRACKET` creates QF/SF/FINAL
  empty; `START_KNOCKOUT` refuses until they have problems.

**Every reason is human-readable prose naming the exact obstruction.** These strings are what
`getLifecycleDiagnostics` surfaces on the admin overview, verbatim, together with a recommended
action. The whole point of that panel is that this table should never again require a psql
session against production to produce.

**Nothing wedged.** Every failure was transient-by-construction: the sweep re-enqueued on the next
bucket and the tournament proceeded. Contrast with `2026-w1`/`2026-w2` under the old model, which
had no path forward at all.

### The two manual interventions during this run

For completeness — these were **content setup**, not lifecycle driving:

1. **18:46-ish** — assigned the three published problems to simulation rounds 1–3.
2. **19:03-ish** — assigned problems to the QF, SF and FINAL rounds after `GENERATE_BRACKET`
   created them.

This is a real, known operational requirement (**D31**): a round cannot open with nothing to
solve, and the rounds do not exist until the transition before them has run. An organiser must
therefore attach problems at two points. It is not a defect, but it does mean the happy path is
"one publish plus two content steps", not literally zero interaction.

---

## 8. What each validation proved

### 8.1 A DRAFT is never dragged forward — D33 §Publishing

`registrationOpensAt` was 18:38:38.987 and already overdue. The tournament was observed at
**18:40:19** — 100 seconds later, across **three or more** 30-second sweep cycles — and was still
`DRAFT`.

Proves the D32 auto-publish behaviour is gone. Creating a tournament is not declaring it ready.

### 8.2 Missed windows converge in ONE pass — D33 §Missed schedule windows

At publish time (18:43:43) *both* registration anchors were already in the past
(`opensAt` 18:38:38, `closesAt` 18:42:38). Reconciliation computed the target state and applied:

```
OPEN_REGISTRATION    completed 18:44:09.715
CLOSE_REGISTRATION   completed 18:44:09.794
                     ---------------------
                     79 milliseconds apart
```

Under the previous one-transition-per-sweep model these would have been **30+ seconds** apart, and
`REGISTRATION_OPEN` would have been broadcast to spectators for a window that had already shut —
the exact "tournament performs its own history in slow motion" failure D33 set out to remove.

Repeated at the seeding boundary: `CLOSE_SIMULATION` 19:00:14.475 → `GENERATE_BRACKET`
19:00:14.621, **146 ms apart**, same pass.

Note the intermediate transitions were **not skipped**. They cannot be — `CLOSE_REGISTRATION`
creates the simulation rounds and `GENERATE_BRACKET` writes the match tree. They are the work, not
ceremony. What changed is that the catch-up is atomic from the outside.

### 8.3 Guards still refuse, and now explain themselves — D33 §Nothing is silent

Four failures, four precise reasons, zero corruption, zero wedging. See §7.

### 8.4 Automatic sizing with no cut — amended D6

8 eligible ⇒ 8-slot draw ⇒ 7 matches, 0 byes, all 8 qualified. `bracketSize` was `NULL` on the row
and resolved by `autoBracketSize`, so this exercised automatic sizing rather than an override.

### 8.5 Round progression is genuinely deadline-driven — D30

Six rounds, each opening ≤1 second after the previous deadline. No operator touched a round.

### 8.6 Stage advancement is round-driven, not clock-driven — D30 / D33

`ADVANCE_STAGE` ×2 and `COMPLETE` all carry `runBy = runner`, fired by round completion. The
schedule contributed nothing after `START_KNOCKOUT`, which is the documented division of
responsibility.

### 8.7 Terminal side effects happen automatically

Hall of Fame published in the same pass as `COMPLETE`. Placements written for all 8 competitors,
including correctly shared bands.

---

## 9. Architectural conclusions

**The reconciled lifecycle model is validated end to end against production.**

1. **Reconciled was the right choice over derived or cached.** Derived is impossible — transitions
   do irreversible work (`CLOSE_REGISTRATION` creates rounds, `GENERATE_BRACKET` writes the match
   tree), so a status computed purely from the clock would claim work that never happened. Cached
   is what broke. Reconciled keeps status as the record of *what has been done* while the schedule
   remains the authority on *what should happen next*. This run exercised both halves: the status
   never lied about completed work, and the schedule never failed to drive the next step.

2. **Convergence in one pass is the property that makes catch-up safe.** A tournament arriving
   late — a redeploy, a paused runner, a schedule written in the past — lands on the correct state
   in a single job rather than broadcasting a sequence of intermediate states nobody was meant to
   see. Measured at 79 ms and 146 ms across two different phase boundaries.

3. **The guard layer is independent of the schedule layer, and must stay that way.** The schedule
   decides *when* a transition is attempted; the state machine decides whether it is *allowed*.
   Four refusals in this run, none of which the clock could override. This is what stops a
   "close registration" milestone from closing a registration that has three competitors.

4. **Failure is recorded as data, not lost in logs.** Every refusal landed in
   `EvaluationJob.lastError` as prose, which `getLifecycleDiagnostics` renders with a recommended
   action. This document's §7 table was assembled from that same column.

5. **One deliberate human act.** `PUBLISH`. Everything else was `schedule` or `runner`.

### Known limitation, quantified here (see §10)

Phase boundaries that depend on *round completion* rather than a wall-clock anchor wait for the
next 5-minute reconciliation bucket. Measured cost in this run:

| Boundary | Ready at | Fired at | Idle |
|---|---|---|---|
| simulation round 3 complete → `CLOSE_SIMULATION` | 18:56:13 | 19:00:14 | **~4m 01s** |
| `GENERATE_BRACKET` done → `START_KNOCKOUT` | 19:00:14 | 19:05:15 | **~5m 01s** |

≈9 minutes of the 27.5-minute run was idle waiting for a poll. The lifecycle is functionally
correct — it converges, nothing is lost — so this is a performance item, not a defect. Backlogged,
not implemented. See `docs/BACKLOG.md`.

---

## 10. Post-validation cleanup

Deleted immediately after this document was written, in foreign-key dependency order, inside a
single transaction, with no constraints disabled:

`UserBadge` → `HallOfFame` → `Evaluation` → `Submission` → `Match` → `Payout` → `Payment` →
`Ranking` → `Registration` → `Notification` → `OpsEvent` → `Round` → `Tournament` →
`EvaluationJob` → `Profile` → `User`

Removed: the `2026-w3` tournament, all 8 `val-*` users, and every dependent record created solely
by this run. Production retains only real tournaments, with no orphaned rows, no synthetic
champion and no synthetic Hall of Fame entry.

The three seeded REST_API problems were **kept** — they are real content, created before this run
and reusable by real tournaments.
