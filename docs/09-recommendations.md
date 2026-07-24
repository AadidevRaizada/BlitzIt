# 09 — Recommendations & Improvements (RESOLVED)

> Phase-1 recommendations have been reviewed and **resolved** into
> [`DECISIONS.md`](./DECISIONS.md). This document records the final disposition of each so the
> reasoning is preserved. Where a recommendation was overridden, the rationale is kept.

| # | Original recommendation | Final decision | Where |
|---|--------------------------|----------------|-------|
| R1 | Don't execute competitor code; black-box deployment + **sandbox** source | **Adopted, simplified** — black-box deployment + read repo as **text via GitHub API**. **No sandbox at all** (no Firecracker/E2B/Docker). | D1 |
| R2 | Deterministic tests primary; LLM subjective-only, weighted | **Adopted** — Functional 60% dominates; LLM = 15% weighted input, never decides alone. | D2 |
| R3 | Constrain problems to HTTP-API contracts | **Overridden** — support **8 challenge categories** via pluggable strategies. REST_API first; others gated as validated. | D4 |
| R4 | Add Redis + BullMQ worker | **Overridden for V1** — **Postgres-backed job table + in-process runner**; `Queue` interface preserves a clean path to BullMQ later. | D3 |
| R5 | Add Sentry | **Adopted** — Sentry approved. | D3 |
| R6 | Make Cloudflare R2 required | **Overridden** — no external storage; evidence in **Postgres JSONB**. | D3 |
| R7 | Better Auth over NextAuth | **Adopted** — Better Auth + `nextCookies()`. | D3 |
| R8 | Treat payout compliance as launch-gating | **Softened per direction** — **lightweight/documented for V1**; full CA/GST/TDS review gates *scaling* pools, not V1. | D11 |
| R9 | Anti-cheat baked into submission model | **Adopted** — immutable, sealed, server-timestamped submissions; ownership + URL-reuse checks; audit. | (design) |
| R10 | Server-authoritative timers/state | **Adopted** — non-negotiable for the live arena. | D7 |
| R11 | Parametric bracket sizes | **Adopted, specified** — 8/16/32/64, never hardcoded. | D6 |
| R12 | Make `docs/` the authoritative spec | **Adopted** — `DECISIONS.md` is the source of truth; PRD points here. | — |

## New decisions layered on top (not in the original 12)

- **Scoring weights fixed** at Functional 60 / Performance 15 / Security & Reliability 10 / AI 15,
  stored per tournament (D2).
- **Win rule + tie-breaks** fully specified, ending in a **sudden-death challenge** (D5).
- **Round timings** fixed-but-configurable: sim 30/20/10; knockout 20/30/40/50/60 min (D7).
- **UTC storage, IST display** for V1 (D8).
- **Dynamic prize pool** growing with registrations, first prize capped ₹2,000 Week 1 (D9).
- **Landing page = spectator experience** (YouTube + live leaderboard/bracket/progression/
  participant count/prize pool/countdown) (D10).

## What we deliberately kept from the PRD
- Weekly esports cadence + framing; Next.js/TS/Postgres/Prisma/Railway/Razorpay/Resend/PostHog
  stack; lightweight spectator V1 (embedded YouTube, no native streaming/chat); the non-goals list.

## Net effect of the locked decisions
- **Simpler and faster to ship:** one Railway service, no Redis, no sandbox, no object storage.
- **The single biggest former risk (running untrusted code) is designed out** (D1).
- **New primary risks** are deployment reachability (T5) and per-category evaluation quality (T7)
  — both manageable and tracked in [`07-risk-analysis.md`](./07-risk-analysis.md).
