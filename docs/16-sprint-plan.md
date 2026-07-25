# 16 — Sprint Plan

Two-week sprints, sequenced so the hard, uncertain things (evaluation, bracket) come early and
each sprint ends with something demoable. Epics/tasks reference
[`15-engineering-tasks.md`](./15-engineering-tasks.md). Durations assume a small team; adjust to
capacity. The **critical path** is Sprint 1 → 2 → 4 → 5 → 6 → 8.

> **E5 correction:** the delivered E5 is Admin Platform & Tournament Management, not the older
> simulation/payments label in this original sprint plan. See
> [`19-admin-platform.md`](./19-admin-platform.md).

> Guiding rule: **do not run a real-money event** until Sprint 8 (compliance-lite) and Sprint 9
> (hardening + dress rehearsal) both pass.

---

### Sprint 1 — Foundation & Auth  (E0, E1)
- Repo, CI, Tailwind v4 + shadcn (design-system skill), Prisma 7 schema, env/logger/errors,
  Sentry/PostHog, **job substrate + in-process runner (no-op)**, health check, Railway deploy.
- Better Auth (GitHub/Google) + guards + profile.
- **Demo:** deployed app; login; runner completes a no-op job; admin gating works.

### Sprint 2 — Evaluation Engine spike  (E2)  ⭐ de-risks the whole product
- Strategy interface + registry; REST_API functional/performance/security probes; GitHub-text
  reader; LLM quality (temp 0, schema-validated, injection-guarded); weighted blend → `Evaluation`.
- **Demo:** (repoUrl, deploymentUrl) → reproducible 4-dimension score with evidence. No code
  execution anywhere. **Go/no-go checkpoint for the product's core assumption.**

### Sprint 3 — Tournament lifecycle & admin authoring  (E3)
- State machine + idempotent cron transitions; admin tournaments (schedule/prize-pool config);
  problem + hidden-test authoring with test-runner preview; admin dashboard + audit.
- **Demo:** admin stands up a full weekly tournament shell and drives its states.

### Sprint 4 — Payments & dynamic prize pool  (E4)   *(parallelizable with Sprint 3)*
- Razorpay order + checkout; raw-body idempotent webhook; registration unlock; dynamic prize pool
  + participant count; refund path.
- **Demo:** buy ₹100 pass → registered via webhook → pool grows live; first prize capped ₹2,000.

### Sprint 5 — Simulation arena, submission, real evaluation  (E5)
- Problem reveal gating; immutable submission + anti-cheat + rate limit; `EVALUATE` wired to
  ranking; simulation arena (30/20/10); +2 challenge strategies (WEB_APP, CLI_APP).
- **Demo:** paid users complete multi-type simulation rounds and get scored rankings.

### Sprint 6 — Seeding & bracket engine  (E6)
- Seeding (8/16/32/64 + byes); advancement with win rule + full tie-breaks + sudden-death;
  bracket UI + admin; exhaustive unit tests.
- **Demo:** any-size bracket runs to a champion in fast-forward, incl. forced tie → sudden-death.

### Sprint 7 — Live knockout arena  (E7)
- Server-authoritative timers; simultaneous reveal; per-match windows; disconnect/late rules;
  SSE live updates; feature flag.
- **Demo:** a live Sunday-style event runs head-to-head to a champion.

### Sprint 8 — Spectator landing, leaderboard, notifications, HoF + compliance-lite  (E8, E9)
- Landing = spectator experience (stream, live leaderboard/bracket/match/participants/pool/
  countdown via SSE); leaderboard/results; Resend notifications; Hall of Fame + badges.
- Payouts via RazorpayX + lightweight compliance checklist (D11).
- **Demo:** public homepage feels live; winners paid auditably.

### Sprint 9 — Hardening & dress rehearsal  (E10)
- Load/burst + chaos (runner/cron restart) testing; security review; runbooks; **full-week dress
  rehearsal** with internal users.
- **Demo:** a rehearsed, monitored, documented weekly operation — **ready for Week 1**.

---

## Parallelization & staffing notes
- **Frontend-heavy** work (screens, landing, bracket UI) can run alongside backend epics from
  Sprint 3 onward if a second dev is available.
- **Sprint 4 (payments)** can overlap **Sprint 3**; **Sprint 8 spectator** UI can begin during
  Sprints 6–7.
- **Business/compliance track** (GST/TDS/CA review) runs in the background from Sprint 4 and must
  land before **scaling** prize pools (not before Week 1's capped pool).

## Milestone → Sprint map
| Roadmap milestone | Sprint |
|-------------------|--------|
| M0 Foundation / M1 Auth | 1 |
| M2 Evaluation spike | 2 |
| M3 Lifecycle/admin | 3 |
| M4 Payments | 4 |
| M5 Simulation | 5 |
| M6 Bracket | 6 |
| M7 Live arena | 7 |
| M8 Spectator + M9 Payouts | 8 |
| M10 Hardening | 9 |

## Definition of "ready for Week 1"
Evaluation reproducible (S2) · payments idempotent (S4) · brackets + tie-breaks correct (S6) ·
live arena stable behind a flag (S7) · spectator landing live (S8) · payouts + compliance-lite
(S8) · load/chaos/security passed + dress rehearsal done (S9).
