# 13 — User Flows

End-to-end flows for participants and spectators. Each step notes the screen ([#] from
[`12-ui-screens.md`](./12-ui-screens.md)) and the action/handler ([`11`](./11-api-specification.md)).

---

## F1 — Discover → Register → Pay (Tue–Thu)
```
Landing [1] (sees live pool/participants/stream)
  → Login [5] (GitHub/Google via Better Auth)
  → Dashboard [6] (status: not-registered)
  → Buy Pass [7] → createPassOrder → Razorpay checkout
  → (browser success is NOT trusted) → Razorpay webhook → Payment=PAID,
     Registration=ACTIVE, prize pool + participantCount recomputed
  → Dashboard [6] shows "Registered ✓", confirmation email (Resend)
```
- **Guards:** registration window open; not already paid (unique PAID payment).
- **Failure:** payment failed → retry; webhook is source of truth; idempotent activation.

## F2 — Simulation rounds (Fri unlock → Sat compete)
```
Dashboard [6] (registered) → Simulation Arena [8]
  → Round opens at server opensAt (30 min) → Problem+Submission [9]
  → getRevealedProblem (only after opensAt)
  → build solution off-platform (any tools/AI) → deploy to own URL
  → submitSolution { repoUrl, deploymentUrl } BEFORE server deadlineAt
  → Submission sealed (immutable) → EvaluationJob enqueued
  → runner: resolve stage profile (D20; qualifiers = deterministic, NO LLM)
  → functional tests vs URL + perf + security [+ repo-text LLM only from SF onward]
  → Evaluation (60/15/10/15 over the active dimensions, renormalised)
  → Ranking updated → repeat for rounds 2 (20 min) & 3 (10 min)
```
- **Guards:** registered; window open; one submission per round; no edits after deadline.
- **Reachability (T5):** warm-up pings + retries; competitor sees live reachability status.
- **Outcome:** simulation score → seeding input.

## F3 — Seeding → Bracket (Sat)
```
Admin/cron seedTournament → bracketSize = smallest of 8/16/32/64 that fits the field (min 8)
  → rank by simulationScore → everyone eligible qualifies; surplus slots become byes for top seeds
  → Ranking.seed + qualified set → SEEDED notification (email + in-app)
  → Competitor sees seed + path on Bracket [11] / Dashboard [6]
```

## F4 — Live knockout (Sun: R32→Finals)
```
For each stage (timers 20/30/40/50/60 min):
  Round opens → simultaneous problem reveal (server time)
  → Knockout Arena [10] shows opponent + timer
  → submitSolution before deadline → EvaluationJob per submission
  → when both submissions in a match are scored:
       apply WIN RULE (D5): highest overall
       → tie-breaks: functional → tests passed → faster submission → performance → AI
       → still tied → startSuddenDeath (fresh short problem)
  → winner advances (atomic) → next Match created → loser eliminated
  → SSE pushes bracket/leaderboard/match updates to arena + landing
Repeat to Finals → champion decided → publishResults
```
- **Disconnect/late:** no valid submission by deadline → walkover/elimination per rule.
- **Judge slower than timer:** round enters JUDGING state; results post when evaluation completes.

## F5 — Results → Payout (Sun result → Mon)
```
publishResults → placements, Hall of Fame [3] updated, RESULT/ELIMINATED notifications
  → Admin approvePayout → PROCESS_PAYOUT job → RazorpayX → Payout=PAID
  → PAYOUT_SENT notification; winnings reflect TDS withholding (lightweight V1, D11)
```

## F6 — Spectator (no account needed)
```
Landing [1] any time:
  pre-event  → countdown + last champion + "register" CTA
  registration → live participant count + growing prize pool + CTA
  simulation → live leaderboard forming
  live Sunday → embedded stream + live bracket + current match + leaderboard, all via SSE
  semis/finals → stream is primary, bracket/leaderboard update alongside
```
- Zero-friction: spectators convert to competitors via the always-present CTA.

## F7 — Return next week
```
Notification/stream → Landing [1] → Dashboard [6] → Buy Pass [7] for the new tournament slug
```
- Season points accumulate in `Ranking.points` / `Profile.stats` (season leaderboard later).

---

## Cross-cutting rules surfaced to users
- All times shown in **IST** (stored UTC). Countdowns are server-authoritative.
- "Everything allowed" — any tools/AI; only the shipped artifact (deployed URL + public repo) is
  judged. We never run your code; keep your deployment up during the round.
- Submissions are final at the deadline; the deployment URL you submit is the one evaluated.
