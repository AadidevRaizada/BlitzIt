# 14 — Admin Flows

Operator flows for running a weekly tournament. Screens ([#]) from
[`12-ui-screens.md`](./12-ui-screens.md); actions from [`11`](./11-api-specification.md). Every
admin action is `requireAdmin` and written to `AuditLog`.

---

## A1 — Set up a weekly tournament (before Tuesday)
```
Admin Dashboard [16] → Tournaments [17] → createTournament (slug e.g. 2026-w30)
  → updateTournamentSchedule (UTC times; IST preview): registration Tue–Thu, sim Fri/Sat, live Sun
  → set roundDurations (sim 30/20/10; knockout 20/30/40/50/60)
  → configurePrizePool (base, perRegistration, firstPrizeCap=₹2,000, distribution)  [D9]
  → set youtubeStreamUrl (can update later)
```

## A2 — Author problems + hidden tests (before rounds)
```
Problems [18] → createProblem (category ∈ 8 types, evaluationStrategy, statement, contractSpec)
  → addHiddenTest × N (kind, spec, weight, timeoutMs)  [hidden, never shown to competitors]
  → test-runner preview against a sample deployment URL (sanity-check the strategy)
  → publishProblem
  → assignProblemToRound (revealed only at opensAt)
```
- **Guidance:** launch Week 1 with **REST_API** problems only; add categories as validated (T7).

## A3 — Drive the weekly state machine
```
Tue  openRegistration            (or cron) → status REGISTRATION_OPEN
Thu  closeRegistration           → REGISTRATION_CLOSED
Fri  unlock simulation           → SIMULATION; startRound(sim-1)
Sat  startRound(sim-2), (sim-3); after each closeRound → evaluations run
     seedTournament(bracketSize) → SEEDING → bracket built
Sun  status LIVE; startRound(R32) … through Finals
Mon  approve payouts
```
- Transitions are **idempotent** and DB-backed; cron fires them but admin can `forceTournament
  Transition` as an escape hatch. Missed/duplicate cron ticks are harmless.

## A4 — Run a live round (Sunday, per stage)
```
Rounds control [19] → startRound(stage)  (sets opensAt, deadlineAt)
  → watch live submission counts + timer
  → closeRound at deadline → seal submissions → enqueue evaluations
  → Submissions [20]: monitor evaluation progress + evidence
  → Bracket admin [21]: winners auto-advance when match evals done;
       resolve ties → startSuddenDeath if needed
  → repeat next stage
```

## A5 — Monitor & intervene on evaluations
```
Submissions [20] → per submission: status, four scores, evidence (tests/probe/LLM raw)
  → if a deployment was unreachable / false failure → reEnqueueEvaluation
  → if evidence warrants → overrideScore { scores, reason }  (audited)
  → cheating detected → disqualify (audited)
Admin Dashboard [16] → runner heartbeat + FAILED job count; alert if backing up
```

## A6 — Publish results & pay winners
```
Bracket reaches a champion → publishResults(tournamentId)
  → placements set, Hall of Fame [3] published, RESULT/ELIMINATED notifications sent
Payouts [22] → computed prizes from dynamic pool
  → complete lightweight compliance checklist (KYC, TDS note)  [D11]
  → approvePayout(user) → PROCESS_PAYOUT → RazorpayX → track to PAID
```

## A7 — Handle a cancelled tournament / refunds
```
Tournaments [17] → set status CANCELLED
  → trigger refund path for PAID payments (Razorpay refund)
  → REFUNDED notifications; Registration → REFUNDED
```

## A8 — Ops health & escape hatches
- **Health:** `/api/health` + Admin Dashboard [16] show DB + runner heartbeat + queue depth.
- **Escape hatches:** `forceTournamentTransition`, `reEnqueueEvaluation`, `overrideScore`,
  `startSuddenDeath`, manual walkover — all audited.
- **Audit:** every privileged action in Audit log [23].

---

## Admin operating principles
- Prefer letting cron/state-machine drive; intervene only via the audited escape hatches.
- Never expose hidden tests. Always attach a **reason** to overrides/disqualifications.
- Keep KYC + payout audit trails from day one so scaling into full compliance is retroactive-safe.
