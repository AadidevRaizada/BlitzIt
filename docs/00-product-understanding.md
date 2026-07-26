# 00 — Product Understanding

## Product vision

> **BlitzIt is not trying to find the best programmer. BlitzIt is trying to discover who can
> build the best software under realistic production constraints.** (D21 — the canonical
> positioning; it supersedes weaker framings wherever they appear.)

Speed is the *pressure*, not the metric. The clock exists to force the trade-offs real engineers
make under deadline; what gets scored is whether the resulting software holds up.

Blitz It is a **competitive, AI-native coding esport**. It inverts the hackathon premise:
instead of rewarding 24–48h endurance, it rewards developers who can understand a problem,
wield AI tools, make sound engineering calls, and **ship a working solution in ~15 minutes**
under extreme time pressure. The intended feel is Blitz Chess / Valorant / CS2 — fast,
spectator-friendly, repeatable — not a weekend hackathon.

## Core philosophy

> "Nobody cares how fast you type. They care how fast you can ship."

...and, per D21, nobody cares how pretty it is either — they care whether it survives contact with
real usage. A submission that is elegant but breaks under load loses to one that is plain and
holds. The 60% Functional weighting (D2) is that belief expressed as arithmetic.

Everything is allowed — any AI model, any IDE, docs, Stack Overflow, tutorials, copy-paste,
public repos, MCP servers. **The only thing that matters is whether the submission works.**
This makes the platform fundamentally a **black-box outcome judge**, not a proctored coding
environment — an important architectural implication (we grade output, not process).

## Weekly competition flow

A repeating 7-day cycle:

| Days | Phase |
|------|-------|
| **Tue–Thu** | Registration open. Sign in, buy the ₹100 Weekly Pass. |
| **Friday** | Registration closes. Simulation (qualifier) rounds unlock. |
| **Saturday** | Competitors complete simulation rounds; AI scores; players seeded into brackets. |
| **Sunday** | Main knockout: **R32 → R16 → QF → SF → Finals**. Results announced immediately. |
| **Monday** | Prize payouts processed. |

Spectator layer (V1): live leaderboard, bracket, match status, and an **embedded YouTube
livestream** for Semis + Finals only. No native streaming/chat in V1.

## User journey

1. Discover via social/community → 2. Landing page → 3. Login (GitHub/Google) →
4. Buy Weekly Pass → 5. Complete simulation rounds → 6. Receive ranking/seed →
7. Compete in knockout → 8. View results → 9. Return next week.

## Feature list

- **Authentication** — GitHub & Google OAuth.
- **Weekly Tournament Pass** — Razorpay payment unlocking the week.
- **Tournament Dashboard** — schedule, countdown, rank, season progress.
- **Simulation Arena** — timed qualification challenges.
- **Live Knockout Arena** — head-to-head elimination rounds.
- **Problem Delivery Engine** — reveals challenges simultaneously to all competitors.
- **Submission Portal** — GitHub repo URL + deployment URL.
- **AI Judge** — hidden tests, deployment validation, performance, security, reliability, quality.
- **Leaderboard** — live ranking by username, city, score, seed.
- **Tournament Bracket** — visual knockout progression.
- **Hall of Fame** — past champions / top performers.
- **Notifications** — match reminders, rankings, payouts.
- **Admin Panel** — create tournaments, upload problems, start rounds, monitor submissions,
  review AI scores, publish winners, trigger payouts.

## Business goals

- Recurring **weekly** competition; low operational overhead.
- Grow a community around competitive AI development.
- Generate shareable developer content.
- Create sponsorship opportunities with AI-tooling companies.
- Metrics: Week 1 → 100+ registrations, 32 qualified, successful live event, fully automated
  judging. First 3 months → 500+ weekly registrations, 60% return rate, growing stream
  audience, first sponsors.

## Technical goals

- Fully **automated AI judging** (a hard requirement, not a nice-to-have).
- Operationally lightweight, single-platform deployment (Railway).
- Repeatable weekly lifecycle driven by scheduled state transitions.
- Real-money payments in + prize payouts out, correctly and auditably.
- Spectator-grade live data (leaderboard/bracket/match status).

---

## Ambiguities, gaps, and likely engineering problems

These feed [`08-open-questions.md`](./08-open-questions.md) and [`09-recommendations.md`](./09-recommendations.md).

### A. The AI Judge is under-specified and is the whole product's crux
- "Hidden tests, deployment, performance, security, reliability, code quality" — but **how**?
  Do we run competitor code? Where? On what runtime? For arbitrary tech stacks?
- **Problem:** running untrusted code that competitors wrote with unrestricted AI is a severe
  security/infra hazard. **Resolved (D1):** we never execute their code — **black-box the
  deployment URL + read the repo as text** via the GitHub API. No sandbox. This decision cascades
  into the entire architecture.
- **Fairness/legality:** LLM scoring is non-deterministic and prompt-injectable, yet decides
  real money. Deterministic tests must be primary; LLM subjective-only + human override.

### B. "15 minutes, one shot" vs a Sunday running R32→Finals
- 5 knockout rounds head-to-head implies real-time, simultaneous, timed, server-authoritative
  matches with elimination between rounds — a **realtime coordination engine**, the hardest
  build. How long is each round? What happens on disconnect, late submit, or a judge that
  takes longer than the round timer? Undefined.

### C. Head-to-head scoring semantics
- In a 1v1 knockout, how is a winner chosen? Higher AI score? First to pass all tests?
  Tie-breaks (submission time? code quality?)? What if **both fail** or **both pass
  identically**? No rule defined — must be specified before building the bracket engine.

### D. Simulation → seeding
- How many simulation rounds? Are all scored, or best-of? How are 100+ registrants cut to
  exactly 32? What if 40 register, or 20, or 200? Bracket must handle non-power-of-two fields
  (byes) and under/over-subscription.

### E. Problem authoring & hidden tests
- Someone must author problems **and** machine-checkable hidden tests for arbitrary stacks.
  This is heavy weekly human ops. What problem format guarantees automated grading? (Strong
  argument for constraining submissions to an **HTTP API contract** so tests are black-box.)

### F. Payments & payouts (India)
- Prize money → **TDS on winnings (§194BA)**, RazorpayX KYC, GST on the ₹100 pass, refunds if
  a tournament is cancelled. Legal/compliance, not just code. Refund policy undefined.

### G. Anti-cheat / integrity
- "Everything allowed" still needs: no editing after deadline, no swapping the deployment URL
  post-judge, no plagiarizing another competitor's live URL, immutable timestamps, and
  detection of a competitor pointing at someone else's deployment. Undefined.

### H. Timezone & audience
- ₹100 + Razorpay + "represent your city" implies India-first, but flow times have no timezone.
  All scheduling must be explicit UTC with a display timezone. Single Railway region → latency
  for a global audience later.

### I. Scale mismatch
- V1 is tiny (32 competitors) but the *live* event is spiky (all reveal/submit at once) and
  spectators may be many. Design for **correctness at small scale + burst tolerance**, not
  large steady-state throughput.
