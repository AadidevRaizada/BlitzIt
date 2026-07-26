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

## D6 — Tournament sizes
- Bracket supports **Top 8 / 16 / 32 / 64**, chosen by registration volume. **Never hardcoded.**

## D7 — Round timings (configurable)
- **Simulation:** 30 min, 20 min, 10 min (three rounds).
- **Knockout:** R32 = 20 min, R16 = 30 min, QF = 40 min, SF = 50 min, Finals = 60 min.
- All durations are **configurable** per tournament.

## D8 — Timezone
- Store all timestamps in **UTC**. Display **IST** in V1. Localization later.

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

## D13 — Simulation → seeding (locked)
- All **three** simulation rounds count. Final simulation score = **sum of the three round
  overall scores**. Rank competitors by total desc; **top N** qualify where N = selected bracket
  size (8/16/32/64). Ties at the qualification cutline broken by the D5 tie-break order.

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


---

### What these decisions removed from earlier drafts
- ❌ Firecracker / E2B / Docker sandboxes and any code execution — replaced by black-box +
  repo-as-text (D1).
- ❌ Redis + BullMQ — replaced by a Postgres-backed job table + in-process runner (D3).
- ❌ Cloudflare R2 — evidence stored in Postgres JSONB (D3).
- ❌ "Constrain problems to HTTP APIs" — replaced by multi-category pluggable strategies (D4).
- ❌ Hardcoded 32-competitor bracket — replaced by 8/16/32/64 (D6).
