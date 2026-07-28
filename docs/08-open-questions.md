# 08 — Questions: Resolved vs Still Open

Most Phase-1 blocking questions are now answered by [`DECISIONS.md`](./DECISIONS.md). This tracks
what's resolved and the few items still worth confirming before/while building.

## ✅ Resolved by the locked decisions

| Q | Was asking | Resolution |
|---|------------|------------|
| Evaluation method | run code? sandbox? | **No execution.** Black-box deployment URL + repo-as-text via GitHub API (D1). |
| Hidden-test shape | constrain to HTTP API? | **No** — 8 pluggable challenge categories, one strategy each (D4). |
| Win rule + tie-breaks | how is a winner chosen? | Highest overall score → functional → tests passed → faster submission → performance → AI → **sudden death** (D5). |
| AI verdict for money | pure-AI or admin confirm? | LLM is 15% weighted, never decides alone; admin override retained (D2). |
| Field sizing | what if not 32? | Brackets **8/16/32/64**, chosen at seeding; byes for non-power-of-two (D6). |
| Timers | round durations? | Sim 30/20/10; knockout 20/30/40/50/60 min; configurable (D7). |
| Timezone | which? | Store **UTC**, display **IST** in V1 (D8). |
| Payout/compliance | how strict for V1? | **Lightweight/documented**; full CA review gates *scaling* pools, not V1 (D11). |
| Auth library | Better Auth vs NextAuth? | **Better Auth** + `nextCookies()` (D3). |
| Infra additions | Redis/BullMQ/sandbox/R2? | **None.** Postgres job table + in-process runner; evidence in JSONB (D3). |
| Prize pool | fixed or dynamic? | **Dynamic**, grows with registrations, first prize capped ₹2,000 Week 1 (D9). |
| Spectator surface | where? | The **landing page** is the spectator experience (D10). |

## ✅ Now resolved (locked 2026-07-24)

All previously-open items are locked in [`DECISIONS.md`](./DECISIONS.md):

| Was open | Resolution | Decision |
|----------|------------|----------|
| Prize distribution table | 1st 50% / 2nd 25% / each SF 12.5%; ₹100 per registration to pool; ₹2,000 first-prize cap Week 1 | D12 |
| Simulation → seeding | Sum of all three rounds; rank desc; all eligible qualify (D6 sizes up to the field) | D13 |
| Sudden-death format | New 10-min challenge; functional-only → tests passed → earliest submission | D14 |
| Reachability grace policy | Warm-up + 3 retries (exp. backoff); else functional = 0; store probe evidence | D15 |
| Public repos only | Yes — public GitHub only in V1 | D16 |
| Categories live Week 1 | REST_API only; others disabled until validated | D17 |
| LLM provider | Claude primary, OpenAI fallback, provider-agnostic abstraction | D18 |
| Anti-cheat scope | Immutable + timestamps + URL-reuse + commit-SHA pin + manual DQ; no plagiarism detection V1 | D19 |

## ✅ Now resolved (locked 2026-07-26 — canonical direction)

| Was open / implicit | Resolution | Decision |
|---------------------|------------|----------|
| What does the platform actually measure? | Not "the best programmer" — **who can build the best software under realistic production constraints**. Speed is pressure, not metric. | D21 |
| Is the AI stage policy revisitable? | **No — locked and final.** AI in SF / THIRD_PLACE / FINAL only, on cost, scalability and reproducibility grounds. The per-tournament mechanism stays configurable; the default does not move. | D22 |
| What are early rounds *for*? | "Can this software survive realistic usage?" — functional correctness, performance, security, **business-rule correctness**, **robustness**. Architecture review stays exclusive to the AI rounds. | D23 |
| Where does evaluation go long-term? | Hidden tests evolve into **hidden environment profiles** (load, faults, latency, limits, scale). Documented only; not implemented. | D24 |
| How are future environments kept auditable? | Deterministic, reproducible, **seeded**, logged, replayable; runs persist seed / traffic profile / fault schedule / dataset version / timing profile. | D25 |
| How is environment fairness guaranteed? | Either identical seeded environments for everyone, or several seeded environments averaged. A single unseeded/per-competitor-random environment is forbidden. | D26 |
| How would a mid-round requirement change be timed? | By **elapsed competitor time**, never wall-clock tournament time. Needs a future per-competitor run clock. | D27 |
| Who owns submitted code? | **Competitors do.** BlitzIt gets a temporary evaluation licence only; no AI training on submissions; no public showcasing without explicit permission. | D28 |
| What is the long-term moat? | A shift from AI repository evaluation to **production-environment simulation**; challenge and harness quality become the primary investment. | D29 |

## 🔭 Deliberately deferred (documented, not open)

These are **decided in principle and unimplemented on purpose**. They are not open questions — the
design is settled; only the scheduling is not. See
[`20-evaluation-strategy-roadmap.md`](./20-evaluation-strategy-roadmap.md).

- Hidden environment profiles (D24) and their determinism/evidence contract (D25).
- Environment fairness scheme selection per round type (D26).
- The "PM Moment" mechanic and its per-competitor run clock (D27).

**No open questions remain.** Documentation is frozen; implementation proceeds per the sprint
plan ([`16`](./16-sprint-plan.md)).
