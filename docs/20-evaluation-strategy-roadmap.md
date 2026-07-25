# 20 — Evaluation Strategy Roadmap (Future Work)

> **Nothing in this document is implemented, and nothing in it authorises implementation.**
> It records the agreed long-term direction (D21–D29) so future epics converge on one design
> instead of improvising. Today's evaluation engine is described in
> [`04-module-breakdown.md`](./04-module-breakdown.md) (module 7) and
> [`18-submission-pipeline.md`](./18-submission-pipeline.md).

---

## 1. What we are actually measuring (D21)

> **BlitzIt is not trying to find the best programmer. BlitzIt is trying to discover who can build
> the best software under realistic production constraints.**

Speed is the pressure, not the metric. Everything below follows from that single sentence.

| | Today | Direction |
|---|---|---|
| Question asked | "Does it return the right response?" | "Does it survive realistic usage?" |
| Mechanism | Hidden tests (HTTP assertions) | Hidden **environment profiles** |
| Adversity | None — a quiet, single-request probe | Load, faults, latency, limits, scale |
| Differentiator | AI repository review | The environment library + harness (D29) |

---

## 2. Where evaluation is heading (D24)

Hidden tests grow into **hidden environment profiles**. A test asserts a response; a profile
establishes the *conditions the software has to hold up under* and then observes it.

A hidden test is the degenerate case of a profile with no adverse conditions, so this is an
extension, not a rewrite.

### Dimensions a profile may express

| Dimension | Examples |
|---|---|
| **Data** | variable datasets, large datasets, pinned dataset versions |
| **Load** | traffic patterns, concurrency, burst arrival |
| **Failure** | partial downstream failures, injected faults, retry scenarios |
| **Limits** | rate limiting, quota exhaustion |
| **Timing** | slow dependencies, network variability, latency jitter |

### What this lets us score that we cannot today

D23 names **business-rule correctness** and **robustness** as first-class early-round targets.
Both are currently approximated with assertions. Profiles are how they become real:

- *Business-rule correctness* — does the right invariant hold after a partial failure, a retry, or
  a concurrent write?
- *Robustness* — does it degrade, or does it fall over?

### Forward-compatible seams that already exist

Nothing needs redesigning to get here:

| Seam | Why it fits |
|---|---|
| `Problem.contractSpec` (JSONB) | Already the category-specific config blob. A profile is a richer `contractSpec`. |
| `EvaluationStrategy` interface (D4) | Already the per-category boundary. A profile runner is a strategy concern. |
| `Evaluation.probeEvidence` (JSONB) | Already the audit sink. Profile evidence extends it. |
| `EvaluationProfile` (D20) | Already selects *which dimensions* run per stage. Orthogonal to, and compatible with, environment profiles. |

> **Naming collision to avoid.** D20's `EvaluationProfile` (which *dimensions* are scored at a
> stage) is a different concept from a D24 *environment profile* (what *conditions* the software
> faces). When environment profiles are built, they must not reuse the `EvaluationProfile` name.

---

## 3. Determinism is non-negotiable (D25)

Every environment profile must be **deterministic, reproducible, seeded, logged and replayable**.

The reason is dispute resolution: a competitor must be able to audit a score. An evaluation run
against an environment nobody can reconstruct is not evidence — it is an assertion. This is the
same standard already applied to the LLM pass, which pins the model, records the prompt hash, and
stores the temperature actually applied (D18/D20).

A future profile run must persist, alongside today's `probeEvidence`:

| Field | Purpose |
|---|---|
| `seed` | Regenerate the exact environment |
| traffic profile | What arrival pattern was applied |
| fault schedule | Which faults fired, and when |
| dataset version | Which data the run used |
| timing profile | Latency/jitter applied to dependencies |

**Design rule:** if a run cannot be replayed from its stored evidence, it must not count toward a
score.

---

## 4. Fairness (D26)

Random luck must never decide a tournament outcome. Exactly two schemes are permitted:

1. **Identical seeded environments** — every competitor in the round faces a byte-identical
   environment. *Default for head-to-head knockout rounds.*
2. **Multiple randomized seeded environments, averaged** — each competitor faces several seeded
   environments and the average determines the score. Suitable for qualifiers, where a broader
   sample is more informative than a single fixed case.

A single unseeded environment, or a different random environment per competitor, is **forbidden**.

This constrains scheduling: scheme 1 means a round's environment must be fixed *before* the round
opens, and scheme 2 means the seed set must be drawn once per round, not per submission.

---

## 5. The "PM Moment" (D27)

A future mechanic where requirements change mid-round — as they do in real work. It is the purest
expression of D21: production constraints include *the spec moving*.

**Timed by elapsed competitor time, never wall-clock tournament time.**

A competitor who starts late, reconnects after a drop, or receives a window adjustment must hit the
change at the same point in *their own* run as everyone else. Anchoring to tournament wall-clock
would reward whoever happened to start at the right moment — exactly the luck D26 forbids.

**Architectural implication:** this needs a per-competitor run clock, distinct from
`Round.opensAt` / `deadlineAt`, which are round-level and server-authoritative (D8). That clock
does not exist today and is not to be built until the mechanic is scheduled.

---

## 6. Intellectual property (D28)

Binding today, not just in future:

| Point | Policy |
|---|---|
| Ownership | Competitors own their code. Submitting transfers nothing. |
| Our licence | A **temporary evaluation licence** — fetch, read, probe, score, and retain for dispute resolution. Nothing more. |
| AI training | **Never.** Not by us, not by any provider we send code to. |
| Showcasing | Requires explicit permission. Scores and placements are public; code is not. |

Already-true architectural consequences: `repoTextSnapshot` stores **paths and metadata, not file
contents**; evidence is retained for disputes rather than reuse. Future consequence: any LLM
provider must be configured with zero-retention / no-training terms, and that configuration is part
of the provider contract (D18), not an afterthought.

---

## 7. The moat (D29)

```
from   AI repository evaluation      (commodity — every provider will ship it)
  to   production-environment simulation   (hard to copy, compounding)
```

The durable asset is a library of **realistic, deterministic, replayable environments** plus a
harness that runs them fairly. Consequently **challenge quality and harness quality are the primary
product investment** — weighted above additional AI scoring features in roadmap and hiring calls.

---

## 8. What must NOT be inferred from this document

To keep future epics honest:

- ❌ Do **not** add environment-profile fields to the schema "ready for later".
- ❌ Do **not** build a per-competitor run clock until the PM Moment is scheduled.
- ❌ Do **not** weaken D22 — AI stays in SF / THIRD_PLACE / FINAL. That is locked and final.
- ❌ Do **not** introduce code execution or sandboxes to achieve any of this. **D1 still holds
  absolutely**: the competitor's deployment is probed as a black box. Environment profiles shape
  *the traffic and conditions we send*, never *code we run on their behalf*.

D1 is the constraint that makes this direction interesting rather than routine: we have to create
realistic adversity from the outside.
