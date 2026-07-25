# 12 — Complete UI Screen Breakdown

Stack: Next.js App Router + React 19 + Tailwind v4 (OKLCH tokens) + shadcn/ui (new-york, sonner).

> **Read [`design-system.md`](./design-system.md) first — it is authoritative for all visual
> decisions.** Brand: `#7F5AF0` primary, `#00FFA3` secondary, black/white base. The governing
> rule is **Marketing ≠ Dashboard**: the landing page (screen 1) is expressive, Awwwards-quality
> storytelling; everything behind login is fast, dense and quiet like Linear/Raycast. Use tokens
> only — never colour, spacing or radius literals. Every screen lists its **route, purpose,
key components, data source, and states** (loading / empty / error / live).

Legend: **[RSC]** server component · **[C]** client island · **SSE** live-updating.

---

## Public / Spectator (route group `(marketing)`)

### 1. Landing / Spectator Home — `/`  ⭐ the spectator experience (D10)
- **Purpose:** make a first-time visitor instantly feel a live event is happening.
- **Sections:** hero + tagline; **live participant count** + **live prize pool** [C/SSE];
  **embedded YouTube** livestream; **live leaderboard** (top N) [C/SSE]; **live bracket**
  [C/SSE]; **current match progression** [C/SSE]; **countdown to next round** [C]; weekly flow
  explainer; CTA (login / buy pass); rules; Hall of Fame teaser.
- **Data:** `getTournamentPublic`, `/api/live/[id]` SSE.
- **States:** pre-registration (countdown to open), registration open (CTA prominent), live
  (stream + bracket dominate), between-tournaments (last champion + next start).

### 2. Rules / How it works — `/rules`  [RSC]
- Static explainer of philosophy, allowed tools, challenge types, and scoring: 60/15/10/15, with
  a clear statement that **AI evaluation applies only from the semifinals onward** — qualifiers
  through the quarterfinals are scored on deterministic measurements only (D20). Competitors
  must be able to see which dimensions decide their current round.

### 3. Hall of Fame — `/hall-of-fame`  [RSC]
- Past champions, runner-ups, notable performances; links to profiles.

### 4. Public Profile — `/u/[username]`  [RSC]
- Stats, tournament history, placements, badges, city.

### 5. Login — `/login`  [C]
- GitHub + Google buttons (Better Auth). Post-login redirect to dashboard/intended route.

---

## Authenticated App (route group `(app)`, guarded layout)

### 6. Dashboard — `/dashboard`  [RSC + C islands]
- **Purpose:** the competitor's home for the week.
- **Components:** current tournament status + **countdown** [C]; pass state (buy CTA if unpaid);
  schedule (Tue–Sun, IST); my seed/rank; season progress; next action banner.
- **States:** not-registered (buy pass), registered-pre-sim, simulation-live (enter arena),
  seeded (bracket link), eliminated, completed.

### 7. Buy Weekly Pass — `/pass`  [C]
- Razorpay checkout (`createPassOrder` → Razorpay modal). Price ₹100, dynamic prize-pool context
  ("your entry grows the pool"). States: idle, processing, success (webhook-confirmed), failed.

### 8. Simulation Arena — `/arena/simulation`  [RSC shell + C timer]
- Lists the three simulation rounds (30/20/10 min) with per-round status/countdown; entry to the
  active round's problem + submission. States: locked (before open), active (timer running),
  submitted (evaluation pending), scored.

### 9. Problem + Submission — `/submit/[roundId]`  [RSC problem + C form]
- **Problem panel:** revealed statement (only after `opensAt`), category badge, contract summary.
- **Submission form:** `repoUrl`, `deploymentUrl`, `commitSha?`; **server-authoritative
  countdown** [C]; validation; submit disabled after deadline.
- **After submit:** immutable summary + evaluation status (queued → running → scored) [C/poll].
- **States:** not-open, open, submitted, sealed/deadline-passed, evaluating, scored, failed.

### 10. Live Knockout Arena — `/arena/knockout/[matchId]`  [RSC + C]
- Head-to-head view: opponent, current stage, **round timer** [C], problem + submission (reuses
  #9), live match status [SSE]. Post-round: win/lose result, advance/eliminated. Sudden-death
  banner if triggered (D5).

### 11. Bracket — `/bracket/[tournamentId]`  [C/SSE]
- Visual knockout tree for 8/16/32/64, live match statuses, my path highlighted, click match →
  detail. Reused as an embed on the landing page.

### 12. Leaderboard — `/leaderboard`  [C/SSE]
- Rankings by score / city / seed; my row pinned; filters. Reused (top N) on landing.

### 13. My Results / History — `/results`  [RSC]
- Past tournaments, placements, evaluation breakdowns (my own submissions' scores + evidence).

### 14. Notifications — `/notifications`  [RSC + C]
- In-app notification list; read state. (Email via Resend is separate.)

### 15. Settings/Profile edit — `/settings`  [C]
- Edit display name, city, socials, timezone display.

---

## Admin (route group `(admin)`, `ADMIN` role guard)

### 16. Admin Dashboard — `/admin`  [RSC]
- Ops overview: active tournament state, submission counts, evaluation queue health (QUEUED/
  RUNNING/FAILED), runner heartbeat, quick transitions.

### 17. Tournaments — `/admin/tournaments`  [RSC + C]
- List/create/edit; schedule (UTC inputs, IST preview); dynamic prize-pool config; state machine
  controls (open/close registration, unlock simulation, seed, start live).

### 18. Problems & Hidden Tests — `/admin/problems`  [C]
- Author problems (category, evaluation strategy, statement, `contractSpec`); manage hidden tests;
  publish; assign to rounds. Test-runner preview against a sample URL.

### 19. Rounds control — `/admin/tournaments/[id]/rounds`  [C]
- Start/close each round; see live submission counts + timers; reveal state.

### 20. Submissions & Evaluations — `/admin/submissions`  [C]
- Monitor every submission's evaluation state + evidence (test results, probe metrics, LLM raw);
  **override score** with reason; re-enqueue evaluation; disqualify.

### 21. Bracket admin — `/admin/tournaments/[id]/bracket`  [C]
- View/advance bracket; resolve ties / trigger sudden-death; walkover handling.

### 22. Payouts — `/admin/payouts`  [C]
- Computed prizes from the dynamic pool; approve/trigger payouts; KYC/compliance checklist (D11);
  status tracking + audit.

### 23. Audit log — `/admin/audit`  [RSC]
- Searchable append-only trail of privileged actions.

---

## Shared components & global states
- **Design-system primitives** (buttons, cards, badges, dialogs, toasts via sonner) built per
  [`design-system.md`](./design-system.md) §7–§12 — tokens only, never literals.
- **`Countdown`**, **`LiveLeaderboard`**, **`BracketTree`**, **`SubmitForm`**, **`MatchCard`**,
  **`PrizePoolMeter`**, **`ParticipantCounter`**, **`StreamEmbed`** — reused across public + app.
- **Global states:** auth loading, role-forbidden (403), not-found (404), error boundary, offline/
  SSE-reconnecting indicator, empty states for every list. Theme-aware (light/dark), responsive,
  IST display of all times.
