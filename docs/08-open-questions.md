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
| Simulation → seeding | Sum of all three rounds; rank desc; top N = bracket size | D13 |
| Sudden-death format | New 10-min challenge; functional-only → tests passed → earliest submission | D14 |
| Reachability grace policy | Warm-up + 3 retries (exp. backoff); else functional = 0; store probe evidence | D15 |
| Public repos only | Yes — public GitHub only in V1 | D16 |
| Categories live Week 1 | REST_API only; others disabled until validated | D17 |
| LLM provider | Claude primary, OpenAI fallback, provider-agnostic abstraction | D18 |
| Anti-cheat scope | Immutable + timestamps + URL-reuse + commit-SHA pin + manual DQ; no plagiarism detection V1 | D19 |

**No open questions remain.** Documentation is frozen; implementation proceeds per the sprint
plan ([`16`](./16-sprint-plan.md)).
