# Engineering backlog

Work that is understood, justified and **not yet implemented**. Items here are deliberate
deferrals, not oversights — each one records why it is safe to leave alone for now.

---

## B1 — Enqueue an immediate reconciliation when a phase's last round completes

**Type:** performance
**Status:** not implemented — deferred deliberately
**Raised:** 2026-07-28, from the `2026-w3` validation run
**Evidence:** `docs/validation/2026-w3-full-lifecycle.md` §9

### The situation

Two mechanisms drive a tournament forward, on different clocks:

- **Round progression** (D30) — the deadline sweep notices `deadlineAt <= now()` and enqueues
  `advanceBracket`. Sweep interval 30 seconds, idempotency bucket 60 seconds.
- **Lifecycle reconciliation** (D33) — the same sweep notices the stored status has fallen behind
  the schedule and enqueues `reconcileTournament`. Idempotency bucket **5 minutes**.

The 5-minute lifecycle bucket is correct for its purpose. It bounds how often a *permanently*
failing guard re-enqueues, so a tournament that closes registration under its minimum does not
produce a failed job every minute all night. It does **not** delay the first attempt, because the
sweep enqueues on its next 30-second tick after an anchor passes.

But some phase boundaries are gated on **round completion**, not on a wall-clock anchor:

- `CLOSE_SIMULATION` cannot run until the last simulation round has closed.
- `START_KNOCKOUT` follows `GENERATE_BRACKET`, which follows seeding.

For those, the round finishes at an arbitrary instant and the reconciler is not looking again for
up to 5 minutes. Nothing is lost — it always converges — but the tournament sits idle.

### Measured cost

From the `2026-w3` validation run:

| Boundary | Ready at | Fired at | Idle |
|---|---|---|---|
| simulation round 3 completed → `CLOSE_SIMULATION` | 18:56:13 | 19:00:14 | ~4m 01s |
| `GENERATE_BRACKET` completed → `START_KNOCKOUT` | 19:00:14 | 19:05:15 | ~5m 01s |

≈9 minutes of a 27.5-minute run spent waiting for a poll. On a real tournament with 30-minute
rounds this is proportionally trivial; on a compressed or demo schedule it dominates.

### The proposed change

When `advanceBracket` finishes and the pass it just ran completed the final round of a phase, it
already knows the phase has ended — `progressTournament` computes exactly that in order to decide
whether to stop. Rather than returning and leaving the boundary to the next reconciliation bucket,
it should enqueue a `reconcileTournament` job immediately.

Sketch, not a specification:

- `progressSimulation` already returns `allComplete`. When true, enqueue a reconciliation for that
  tournament.
- The reconciler is idempotent and re-reads state, so an extra enqueue is harmless.
- The immediate enqueue needs its own idempotency key — reusing the 5-minute bucket key would
  collapse into the pending bucket and change nothing. Something keyed on the triggering round
  (`reconcile:{tournamentId}:round:{roundId}`) keeps it single-shot per round.

### Why it is deferred

The lifecycle is **functionally correct**. It converges from every state tested, loses nothing,
and never wedges. This is latency, not correctness, and the correctness work (D33) is what was
urgent.

It also touches the seam between the two drivers — round progression and lifecycle reconciliation
— which is precisely the boundary that was just stabilised. Changing it immediately after
validating it would mean the validation no longer describes the shipped system.

### Definition of done

- A phase-final round completing enqueues a reconciliation within one sweep interval.
- `verify:schedule` gains a check that the idle gap between "last round completed" and the
  following lifecycle transition is bounded by the **sweep** interval, not the lifecycle bucket.
- The 5-minute bucket stays as the retry cadence for guard-blocked reconciliations. This item must
  not shorten it — that bucket exists to keep a permanently-failing tournament from flooding the
  job table.
