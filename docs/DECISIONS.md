# V1 Architecture Decisions (LOCKED)

> These decisions are **final for V1** and supersede any earlier recommendation in this
> `docs/` set. Every other document has been updated to reflect them. Date locked: 2026-07-24.
>
> **D21-D29 (locked 2026-07-26)** record the platform's canonical direction - what BlitzIt
> measures, why AI stays in the closing rounds, where evaluation is heading, and the IP policy.
> Several are *documented direction only*; each says so explicitly.

## D1 — Evaluation Engine: no code execution
- We **never execute competitor code** on our infrastructure.
- Each competitor submits: **public GitHub repository URL** + **live deployment URL**.
- The engine: runs **deterministic hidden tests against the deployment URL**, evaluates
  **performance** and **reliability**, performs **basic security checks**, reads the **GitHub
  repo as source text only** (via the GitHub API — **not cloned to build or run**), and uses an
  **LLM** to evaluate code quality, architecture, documentation, and UI where applicable.
- **The repository is treated as text.** No cloning-to-build, no Firecracker, no Docker
  sandboxes, no E2B, no code-execution environment of any kind in V1.

## D2 — Scoring (weights)
| Dimension | Weight |
|-----------|--------|
| Functional Tests | **60%** |
| Performance | **15%** |
| Security & Reliability | **10%** |
| AI Evaluation | **15%** |
- The LLM is **only a weighted input**. It never decides a winner by itself. Weights are stored
  per tournament for reproducibility and are configurable.

## D3 — Infrastructure (lightweight)
- **Approved:** PostgreSQL, Prisma, Railway, Better Auth, Razorpay, Resend, PostHog, Sentry.
- **Explicitly NOT in V1:** Redis, BullMQ, sandbox providers, message queues, external object
  storage. Evaluation evidence is stored in Postgres (JSONB).
- Asynchronous evaluation runs via a **Postgres-backed job table** processed by an **in-process
  background runner** (Postgres `SELECT … FOR UPDATE SKIP LOCKED`). This is abstracted behind a
  `Queue` interface so we can **drop in Redis + BullMQ later without touching call sites** — but
  we do **not** build for a queue today.

## D4 — Challenge types (pluggable)
- Blitz It is **not** restricted to HTTP APIs. Supported categories: **REST APIs, Web
  Applications, AI Agents, OCR, Automation, Internal Tools, CLI Applications, Chrome
  Extensions**.
- The Evaluation Engine uses a **strategy per challenge category**. Each strategy defines how
  functional/performance/security are measured for that type; the LLM quality pass is shared.

## D5 — Win rule
- **Winner = highest overall score.** Tie-breakers, in order:
  1. Higher Functional score
  2. More hidden tests passed
  3. Faster submission
  4. Better Performance
  5. Higher AI score
  6. **Sudden-death challenge** if still tied.

## D6 — Tournament sizes (amended)
- Bracket supports **8 / 16 / 32 / 64**, chosen by registration volume. **Never hardcoded.**
- **Minimum 8 eligible competitors.** Below that the bracket is **never** generated — not with
  byes, not with an explicitly-set `bracketSize`. The operator extends registration or cancels.
- At or above 8, the draw is the **smallest supported size that fits the whole field**:

  | Eligible | Bracket | Byes |
  |---|---|---|
  | 8 | 8 | 0 |
  | 9–16 | 16 | 16 − eligible |
  | 17–32 | 32 | 32 − eligible |
  | 33–64 | 64 | 64 − eligible |
  | 65+ | 64 | 0 (top 64 qualify — the only remaining cutline) |

- Unused slots become **byes**, awarded to the **highest seeds** — seed #1 first, then #2, and so
  on. This is not allocated by any code: standard seed-order reflection pairs seed 1 with seed N,
  so the seeds left unfilled are always the worst and their absent opponents always the best. It
  is therefore deterministic and reproducible from the field size alone.
- A bye is an ordinary match with an empty slot, decided at generation time. It requires no
  submission, no evaluation, no AI, no REST testing and no waiting.
- **Superseded:** the draw used to be the *largest* size the field could fill, which silently cut
  everyone past the nearest power of two — a field of 15 played an 8 and eliminated 7 people
  before a match was played.

## D7 — Round timings (configurable)
- **Simulation:** 30 min, 20 min, 10 min (three rounds).
- **Knockout:** R32 = 20 min, R16 = 30 min, QF = 40 min, SF = 50 min, Finals = 60 min.
- All durations are **configurable** per tournament.

## D8 — Timezone
- Store all timestamps in **UTC**. Display **IST** in V1. Localization later.
- Admin input is **IST** as well as display; the Zod schema pins `+05:30` explicitly rather than
  letting the server's local offset apply.
- Schedule timestamps are **triggers**, not just gates — see **D32**. A countdown that reaches
  zero causes the transition it counted down to.

## D9 — Prize pool (Week 1)
- **Dynamic pool** that grows automatically as registrations increase.
- **First prize capped at ₹2,000** for Week 1; remaining prizes follow the standard payout
  distribution. Future tournaments move to fixed sponsor-backed pools.
- Landing page shows **live participant count** and **live prize pool**.

## D10 — Spectator experience = the landing page
- The homepage IS the spectator experience. It includes: embedded YouTube livestream, live
  leaderboard, live tournament bracket, current match progression, live participant count,
  current prize pool, and a countdown to the next round.
- Early rounds: hosts discuss standings/approaches. Semis & Finals: livestream is primary, with
  commentary alongside live leaderboard/bracket. Commentary is **educational** and is a core
  differentiator.

## D11 — Compliance (lightweight for V1)
- Keep compliance **documented but lightweight**. Before scaling prize pools, review GST, TDS,
  RazorpayX payouts, and consult a CA. This is a **business workstream** parallel to engineering.

---

## D12 — Prize distribution (locked)
- Dynamic pool; every registration contributes **₹100** to the pool (no platform fee retained
  for now — revisit later). Week 1 **first prize capped at ₹2,000**.
- Distribution: **1st = 50%**, **2nd = 25%**, **each semi-finalist (2) = 12.5%**.
- `prizeDistribution` JSON: `{ "1": 0.50, "2": 0.25, "SF": 0.125 }` (SF applies to both losing
  semi-finalists). `prizePerRegistrationMinor = 10000`.

## D13 — Simulation → seeding (amended by D6)
- All **three** simulation rounds count. Final simulation score = **sum of the three round
  overall scores**. Rank competitors by total desc.
- **Everyone eligible qualifies**, because D6 now sizes the bracket up to the field rather than
  cutting the field down to the bracket. The ranking still determines *seeding*, which determines
  who receives a bye.
- A cutline survives in exactly one case: a field above 64, where the top 64 qualify. Ties at that
  cutline are broken by the D5 tie-break order.

## D14 — Sudden death (locked)
- A **new short challenge** (not a shortened previous one). Duration **10 minutes**.
- Winner by **Functional Score only**; if still tied → more hidden tests passed → earliest
  submission timestamp. (`RoundStage.SUDDEN_DEATH`, functional-only weighting.)

## D15 — Deployment reachability (locked)
- **Warm-up request** before evaluation; then retry **3 times with exponential backoff**. If
  still unreachable, **functional score = 0** (the zero stands). Store **full probe evidence**
  (timestamps, status codes, latencies) in `Evaluation.probeEvidence` for admin review.

## D16 — Repositories (locked)
- V1 requires **public GitHub repositories only** (avoids private-repo token scope). Validated at
  submission time.

## D17 — Challenge categories at launch (locked)
- Week 1 officially supports **REST_API only**. The other 7 strategy implementations remain in the
  architecture but are **disabled** until each is individually validated (T7). Enforced by a
  per-tournament allowlist of enabled categories.

## D18 — LLM provider (locked) — **REVISED 2026-07-25**
- ~~Claude primary, OpenAI fallback.~~ **Superseded:** the evaluator must not be tied to any
  vendor. The backend is selected **entirely by configuration**:
  ```
  LLM_PROVIDER=openai|anthropic
  LLM_MODEL=gpt-5.5
  LLM_TEMPERATURE=0
  ```
  Switching providers requires **no code change**. `createLLMProvider()` is the only place that
  maps a name to an implementation; scoring, persistence, prompt hashing, evidence and the rubric
  remain provider-agnostic.
- The automatic cross-vendor fallback is **removed** — a provider is chosen explicitly, and any
  failure (missing provider, missing key, API error) degrades to `aiDegraded = true` with a
  neutral score rather than silently switching vendors. Silent vendor switching would have made
  scores non-comparable across submissions in the same round.
- **Reproducibility caveat (measured, not assumed):** OpenAI's `gpt-5.x` reasoning models reject
  a custom `temperature` and only accept their default (1). The provider omits the parameter for
  those models and records `temperatureApplied` in the audit, so evidence stays truthful. If
  strict temperature-0 reproducibility is required, choose a model that supports it.

## D20 — Stage-scoped evaluation profiles (locked 2026-07-25)

**AI evaluation is not used for the majority of the tournament.** Which dimensions are scored
is decided per *stage*, by configuration.

| Stage | Functional | Performance | Security | AI | Profile |
|-------|:---------:|:-----------:|:--------:|:--:|---------|
| Qualifiers (SIMULATION) | ✅ | ✅ | ✅ | ❌ | `deterministic` |
| R64 · R32 · R16 · QF | ✅ | ✅ | ✅ | ❌ | `deterministic` |
| **SF** | ✅ | ✅ | ✅ | ✅ | `full` |
| **THIRD_PLACE** (if enabled) | ✅ | ✅ | ✅ | ✅ | `full` |
| **FINAL** | ✅ | ✅ | ✅ | ✅ | `full` |
| SUDDEN_DEATH | ✅ | ❌ | ❌ | ❌ | `functional-only` (D14) |

### Why AI is reserved for the closing rounds
- **Significantly lower API cost.** The LLM pass is the only paid per-submission call. A 64-player
  bracket is ~127 knockout submissions plus three qualifying rounds for *every* registrant;
  restricting AI to SF/3rd/Final removes well over 90% of that spend.
- **Lower latency.** Deterministic probes finish in seconds; a model call adds seconds to tens of
  seconds per submission. Early rounds must judge a whole field inside a short round timer.
- **Deterministic early rankings.** Qualification and early knockouts are decided purely by
  reproducible measurements, so seeding and eliminations can be recomputed exactly.
- **AI reserved for close, high-value matches**, where subjective quality actually discriminates.
- **Easier reproducibility.** Fewer non-deterministic inputs across most of the tournament
  (see the D18 temperature caveat).

### Architectural rule (do not violate)
- The **scoring pipeline stays provider-agnostic *and* stage-agnostic.** No stage names, no
  `if (stage === …)`, no AI special-cases inside the engine.
- The **tournament layer** (`server/modules/tournament/evaluation-profiles.ts`) owns the
  stage → profile decision. The **engine** (`server/modules/evaluation/`) receives a resolved
  `EvaluationProfile` and evaluates *only* the dimensions it names.
- An inactive dimension is **not evaluated at all** — no probe, no GitHub read, no model call.
  That is what converts the policy into real cost/latency savings rather than a zero weight.
- Weights of inactive dimensions are zeroed and the remainder **renormalised**, so a perfect
  deterministic run still scores 100 (not capped at 85).
- Organizers reconfigure via `Tournament.evaluationProfiles` (JSON: custom `profiles` and/or a
  `stages` map) — **no code change**. Invalid config falls back to defaults and logs; it never
  blocks an evaluation mid-tournament. This includes profiles that are *structurally* valid but
  **unscorable** — every dimension disabled, or the only active dimension weighted 0 — which
  would otherwise make the blend throw and fail a competitor's submission over an organizer's
  typo. `resolveEvaluationProfile` is guaranteed to return a profile with at least one weighted
  active dimension.
- Every `Evaluation` records `profileName` + `dimensions` so a past score can be explained.
- `aiSkipped` (policy) is distinct from `aiDegraded` (the model was wanted but unavailable) —
  only the latter is an incident.

## D19 — Anti-cheat scope for V1 (locked)
- Included: immutable submissions, server timestamps, **deployment-URL reuse detection**,
  **commit-SHA pinning**, manual disqualification. **No plagiarism detection in V1.**

---

# Canonical direction (locked 2026-07-26)

> D21-D29 set the platform's long-term direction. **D21, D22, D23 and D28 are in force now.**
> **D24, D25, D26, D27 and D29 are documented direction, deliberately NOT implemented** - they
> exist so future epics converge instead of improvising. Nothing in this block authorises
> building anything today.

## D21 - What BlitzIt actually measures (locked)

**BlitzIt is not trying to find the best programmer. BlitzIt is trying to discover who can build
the best software under realistic production constraints.**

This is the primary positioning and supersedes weaker framings ("coding esport", "who ships
fastest", "AI-native competition") wherever they appear. Speed is the *pressure*, not the
metric - the metric is whether the resulting software holds up.

Consequences that bind the architecture:

- We grade the **running artefact**, not the person and not the process (already D1).
- A submission that is elegant but breaks under real usage must lose to one that is plain and
  survives. The 60% Functional weighting (D2) is an expression of this, not an accident.
- Marketing, docs and UI copy describe the product in these terms.

## D22 - AI evaluation stays in the closing rounds (locked, final)

Restates and **locks** D20's stage policy. This is not revisited without a new decision.

| Stage | AI evaluation |
|---|---|
| Qualifiers (SIMULATION) | disabled |
| R64 / R32 / R16 / QF | disabled |
| **SF / THIRD_PLACE / FINAL** | **enabled** |
| SUDDEN_DEATH | disabled (functional-only, D14) |

Final because of **cost** (the LLM pass is the only paid per-submission call; a 64-player bracket
plus three qualifying rounds for every registrant would multiply it by more than 10x),
**scalability** (model latency does not fit inside a short early-round timer for a whole field),
and **reproducibility** (early rankings must be recomputable exactly).

Early rounds remain **fully deterministic**. Organizers may still re-map stages per tournament via
`Tournament.evaluationProfiles` (D20) - the *mechanism* stays configurable; the *default* is now
locked.

## D23 - What early rounds are for (locked)

Early rounds ask **"can this software survive realistic usage?"** - not "is this architecture
beautiful?".

Deterministic dimensions the early rounds do and will measure:

- Functional correctness
- Performance
- Security
- **Business-rule correctness**
- **Robustness**

Repository architecture review - readability, structure, documentation, design judgement - is
**exclusive to the AI rounds** (SF / THIRD_PLACE / FINAL). It is not approximated with heuristics
in earlier rounds.

> Business-rule correctness and robustness are named here as first-class targets. Today both are
> expressed through hidden tests; D24 is how they grow.

## D24 - Hidden tests to hidden environment profiles (future direction, NOT implemented)

The long-term evaluation strategy is to evolve from **hidden tests** toward **hidden environment
profiles**: instead of asserting responses, place the submission in a realistic environment and
observe whether it holds.

Profiles will express things like:

| Dimension | Example |
|---|---|
| Data | variable datasets, large datasets, dataset versions |
| Load | traffic patterns, concurrency, bursts |
| Failure | partial downstream failures, fault injection, retry scenarios |
| Limits | rate limiting, quota exhaustion |
| Timing | slow dependencies, network variability, latency jitter |

This subsumes hidden tests rather than replacing them - an assertion is the degenerate case of a
profile with no adverse conditions.

**Do not implement now.** `HiddenTest` remains the mechanism; `Problem.contractSpec` is the
forward-compatible place a profile would eventually be described. See
[`20-evaluation-strategy-roadmap.md`](./20-evaluation-strategy-roadmap.md).

## D25 - Environment profiles must be deterministic (future direction, NOT implemented)

Any environment profile must be **deterministic, reproducible, seeded, logged and replayable**. A
competitor must always be able to audit a disputed evaluation, which is impossible against an
environment nobody can reconstruct.

Every future profile run must therefore persist, alongside the existing `probeEvidence`:

- `seed`
- traffic profile
- fault schedule
- dataset version
- timing profile

This is the same principle already applied to LLM scoring (pinned model, prompt hash, temperature
recorded - D18/D20): **an evaluation that cannot be re-derived is not evidence.**

## D26 - Environment fairness (future direction, NOT implemented)

Random luck must never decide a tournament outcome. A future environment-based evaluation must use
one of exactly two schemes:

1. **Identical seeded environments** - every competitor in a round faces the byte-identical
   environment; or
2. **Multiple randomized seeded environments, averaged** - each competitor faces several seeded
   environments and the *average* determines the score.

A single unseeded or per-competitor-random environment is forbidden. Where a round is head-to-head
(knockout), scheme 1 is the default.

## D27 - "PM Moment" is measured in competitor time (future direction, NOT implemented)

A future dynamic-requirement-change mechanic ("PM Moment" - the requirements shift mid-round, as
they do in real work) is timed by **elapsed competitor time**, never wall-clock tournament time.

A competitor who starts late, reconnects, or is granted a window adjustment must experience the
change at the same point in *their* run as everyone else. Anchoring to tournament wall-clock would
hand an advantage to whoever happened to start at the right moment.

This implies a future per-competitor run clock, distinct from `Round.opensAt` / `deadlineAt`,
which are round-level and server-authoritative (D8).

## D28 - Intellectual property (locked)

| Point | Policy |
|---|---|
| Ownership | **Competitors own their code.** Submitting never transfers ownership. |
| Our licence | BlitzIt receives a **temporary evaluation licence** only - enough to fetch, read, probe and score the submission, for as long as evaluation and dispute resolution require. |
| AI training | **No training on submitted code.** Submissions are never used as training or fine-tuning data, by us or by any provider we send them to. |
| Showcasing | **No public showcasing without explicit permission.** Scores and placements are public; the code and its contents are not. |

Architecturally binding: `repoTextSnapshot` stores **paths and metadata, not file contents**
(already true), evidence is retained for dispute resolution rather than reuse, and any future LLM
provider must be configured with zero-retention / no-training terms.

## D29 - The long-term moat (locked as direction)

BlitzIt's differentiator is expected to shift **from AI repository evaluation to
production-environment simulation**.

AI code review is increasingly commodity - every provider will offer it. What is hard to copy is a
library of **realistic, deterministic, replayable production environments** plus the harness that
runs them fairly.

Therefore **challenge quality and evaluation-harness quality become the primary product
investment**. Roadmap and hiring decisions should weight these above additional AI scoring
features.


## D30 - Round progression is triggered in-process, not by Railway Cron (locked 2026-07-27)

A round deadline is an instant in the database, not an event. Something has to notice it has
passed. Nothing did: the queue, the runner and the `advanceBracket` processor were all built and
healthy, but no code ever enqueued the job they waited for. In production a simulation round sat
OPEN 29 minutes past its deadline while the rounds behind it never started, and every
`OpsEvent` ever recorded carried `runBy = admin`.

**Decision.** The runner sweeps for rounds whose `deadlineAt` has passed and **enqueues** an
`advanceBracket` job. It never transitions directly, so progression keeps one path through the
queue, under the existing concurrency cap and retry policy.

**Why not Railway Cron,** which D3 and `01-technical-architecture.md` originally assumed:

1. **The cadence is impossible.** Railway's minimum interval between cron executions is 5 minutes.
   The shortest rounds are 600s (simulation round 3, and sudden death), so a worst-case tick lands
   half a round late.
2. **A cron service must terminate.** Railway expects a cron service to finish its task and exit,
   and explicitly excludes long-running web servers. Ours hosts the in-process runner (D3) and
   never exits, so cron would require a *second* service — contradicting the single-service
   topology in `25-deployment-railway.md`.
3. Railway also **skips** a scheduled run if the previous one is still going, which turns a slow
   pass into a silently missed one.

~~Cron remains appropriate for coarse, day-scale transitions (open/close registration, seeding) if
we ever want them automated. Those stay admin/ops-driven for now.~~ **Superseded by D32** — those
transitions are automated, and they ride this same sweep rather than a cron service.

**Why not a separate polling service.** The runner already polls Postgres every 2s, already has
the start-once guard and already handles failures. A second loop would duplicate all of it, so the
sweep rides the existing tick.

**Replica safety.** The sweep's idempotency key is bucketed by minute
(`progress:{roundId}:{minute}`), so concurrent replicas within a minute collapse to one job via
the unique index. It cannot reuse the evaluation-driven `advance:{roundId}` key: that one is
permanent per round, so a sweep sharing it would fire once per round ever.

**Production configuration required: none.** No cron service, no second service, no new env var.

---

## D31 - Simulation rounds are created at CLOSE_REGISTRATION (locked 2026-07-27)

`START_SIMULATION` used to create the three simulation rounds *and* open round 1 in the same
transaction. That left no instant at which a problem could be attached to round 1: before the
transition the round did not exist, and after it `assignProblemToRound` refuses anything that is
no longer PENDING. A tournament could therefore only ever start with round 1 problem-less — which
is exactly what happened in production, where the round showed a live countdown and
"the problem has not been revealed yet" at the same time.

**Decision.** `CLOSE_REGISTRATION` creates the simulation rounds PENDING. `START_SIMULATION`
opens round 1, and `openRound` now refuses any round with no problem assigned. This mirrors the
knockout split that already worked (`GENERATE_BRACKET` creates, `START_KNOCKOUT` opens), and
the upsert on `(tournamentId, stage, sequence)` keeps both calls idempotent.

The operational consequence is deliberate: **an organizer must assign problems between closing
registration and starting the simulation**, and starting without them fails loudly rather than
opening a round nobody can compete in.

## D32 - The schedule drives the lifecycle (locked 2026-07-28)

D30 automated round *deadlines* but left phase *milestones* manual, and the product was
incoherent as a result. The schedule columns were read only as **gates** — `registration.ts`
refuses an entry before `registrationOpensAt` — and never as **triggers**. Nothing noticed the
gate had opened. Meanwhile the public pages rendered a countdown to that instant, so the product
promised an event no code was going to cause: the clock reached 00:00 and the tournament sat in
PUBLISHED until an operator pressed a button. In production `2026-w1` did exactly that, five
minutes past its own registration time.

**Decision.** The schedule is the source of truth for lifecycle progression. The existing deadline
sweep gained a second query — tournaments whose next scheduled milestone is due — and enqueues the
matching `tournamentTransition` job. One timer, two kinds of due work (`sweepDueWork`).

| From | Transition | Anchor |
|---|---|---|
| DRAFT | PUBLISH | `registrationOpensAt` |
| PUBLISHED | OPEN_REGISTRATION | `registrationOpensAt` |
| REGISTRATION_OPEN | CLOSE_REGISTRATION | `registrationClosesAt` |
| REGISTRATION_CLOSED | START_SIMULATION | `simulationOpensAt` |
| SIMULATION | CLOSE_SIMULATION | `simulationClosesAt` |
| SEEDING | GENERATE_BRACKET | none — fires as soon as the guards allow |
| BRACKET_GENERATED | START_KNOCKOUT | `liveStartsAt` |
| LIVE | ADVANCE_STAGE / COMPLETE | **not the clock** — round completion (D30) |

The mapping is one pure function, `nextScheduledStep` in `schedule.public.ts`, read by BOTH the
sweep and the admin UI. Encoding it twice is how the UI and the engine drifted apart originally.

**A due transition is offered, not forced.** `applyTransition` still runs every business guard, so
"the clock says close registration" never overrides "only 3 registered and the minimum is 8". The
schedule decides *when* a transition is attempted; the state machine decides whether it is allowed.

**A tournament with no schedule is never dragged forward.** A DRAFT with no `registrationOpensAt`
stays a draft indefinitely — which is what a draft is for. Setting a registration time is the
statement that it is finished.

**Retry cadence is deliberately coarse.** Lifecycle jobs bucket at 5 minutes, not the 1 minute
round progression uses. The bucket does not delay the first attempt (latency stays bounded by the
30s sweep); it bounds how often a permanently-failing guard re-enqueues. A tournament that closes
registration under its minimum would otherwise log a failed job every minute all night.

**Admin buttons become overrides.** Every transition remains manually available, and `force` still
skips business guards. What changed is presentation: no lifecycle action is the page's primary
button any more, and the one the schedule is about to fire is labelled "… now" — pressing it means
*sooner*, not *required*.

**What stays manual:** `CANCEL` (by definition), and assigning problems to rounds. The latter is
content setup, not lifecycle driving — but it is load-bearing, because `openRound` refuses a round
with no problem (D31), so both `START_SIMULATION` and `START_KNOCKOUT` will fail on the schedule
until problems are attached.

Verified end to end by `npm run verify:schedule`, which drives a tournament DRAFT → COMPLETED using
only the sweep and the queue, and asserts that **zero** OpsEvents carry an operator.

## D33 - The lifecycle is RECONCILED against the schedule, not cached from it (locked 2026-07-28)

D32 automated the schedule but left the two descriptions of a tournament free to contradict each
other. A tournament has a **plan** (five timestamps) and a **position** (`status`). D32 made the
plan write the position once, at transition time, and nothing ever invalidated it. Four
different-looking production failures were all that one flaw:

- a page rendering `REGISTRATION OPEN` directly above `registration has not opened yet` — both
  statements true, read from two different sources;
- `2026-w1` and `2026-w2` wedged with no exit, because the lifecycle is forward-only and
  `CLOSE_REGISTRATION` could never satisfy `minRegistrations`;
- `OPEN_REGISTRATION` firing at 16:52 for a window that had closed at 16:20;
- a draft publishing itself 35 seconds after creation, mid-configuration.

**Decision: reconciled.** The three candidates and why:

- **Derived** (status is a pure function of schedule + now) is impossible. Transitions do
  irreversible work — `CLOSE_REGISTRATION` creates the simulation rounds, `CLOSE_SIMULATION`
  computes seeding, `GENERATE_BRACKET` writes the match tree. A derived status would claim a
  tournament was SEEDING while no seeding had run. Status also depends on facts outside the
  schedule (`minRegistrations`), so the clock alone cannot decide it.
- **Cached** is what broke. Write-once with no invalidation.
- **Reconciled** keeps status stored — it records work that really happened — while the schedule
  remains the plan. `targetStatusFor` computes where the plan says the tournament should be, and
  convergence happens by applying real transitions through the real state machine, guards and
  audit intact.

The stored status is therefore never authoritative about *where the tournament should be*. It is
authoritative only about *what has already been done*.

**Two invariants make the divergence class unreachable, rather than merely fixed:**

1. **Forward drift self-heals.** The sweep reconciles continuously. A schedule ahead of the status
   converges on its own.
2. **Backward drift cannot be written.** `scheduleEditConflicts` refuses to move a milestone that
   has already happened into the future. The plan may be rewritten freely ahead of the tournament
   and never behind it.

**Missed windows converge in ONE pass.** `reconciliationPath` returns the whole chain, and
`reconcileTournament` applies all of it in a single job. A server down overnight comes back and
lands on REGISTRATION_CLOSED at once, instead of opening registration and closing it thirty
seconds later while spectators watch the tournament perform its own history. The intermediate
transitions all still RUN — they are the work, not ceremony — but the catch-up is atomic from the
outside.

**Publishing is manual again.** DRAFT is not on the automatic path. Creating a tournament is not
the same as saying it is ready; the schedule becomes authoritative only once an operator has
published. This is the one deliberate human act in the whole lifecycle.

**Recovery always exists.** A tournament blocked by a guard is unwedged by extending the FUTURE
anchors — always a legal edit — so more competitors can register. A schedule entered wrongly is
corrected by moving the passed anchor to another past time. Neither needs SQL or cancellation.

**Nothing is silent.** `getLifecycleDiagnostics` assembles position, target, pending path, the
guard's verbatim refusal, attempt count, retry cadence and a recommended action, and the admin
overview renders it. An operator should never need psql to learn why a tournament is stuck.

**One definition of each fact.** `registrationOpenNow` is the only answer to "can someone register",
read by the guard and the UI. `nextRealEvent` is the only source for a countdown — the old code
derived the label from `status`, which is how a page counted down to the close of a registration
that had not opened. A countdown is a promise; one function makes it.

Superseded from D32: the `DRAFT -> PUBLISH` automatic step, and the one-transition-per-sweep
enqueue (`tournamentTransition` per milestone) which is now one `reconcileTournament` per
tournament.

Verified by `npm run verify:schedule`.

---

### What these decisions removed from earlier drafts
- ❌ Firecracker / E2B / Docker sandboxes and any code execution — replaced by black-box +
  repo-as-text (D1).
- ❌ Redis + BullMQ — replaced by a Postgres-backed job table + in-process runner (D3).
- ❌ Cloudflare R2 — evidence stored in Postgres JSONB (D3).
- ❌ "Constrain problems to HTTP APIs" — replaced by multi-category pluggable strategies (D4).
- ❌ Hardcoded 32-competitor bracket — replaced by 8/16/32/64 (D6).
- ❌ Operator-driven phase transitions — the schedule drives them (D32); the buttons remain as
  overrides.
- ❌ Lifecycle status as a cache of the schedule — replaced by continuous reconciliation plus a
  no-backward-edits invariant (D33).
- ❌ Automatic publishing of drafts (D32) — reverted by D33; publishing is the operator's one
  deliberate act.
