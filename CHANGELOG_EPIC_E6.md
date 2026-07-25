# Epic E6 — Sudden Death & Bracket UI

**Status:** ✅ Complete · **Branch:** `epic-e6-sudden-death-bracket`

The last two pieces of the bracket engine: the mechanism that unsticks a deadlocked match, and the
surfaces that let competitors and operators see the bracket.

> **Scope note.** E6.1, E6.2 and E6.5 shipped in E3. This epic is exactly what the roadmap left
> outstanding: **E6.3 (sudden death)** and **E6.4 (bracket UI)**.

## What was built

| Area | Detail |
|---|---|
| `tournament/sudden-death.ts` | `startSuddenDeath`, `applySuddenDeathResult`, `listDeadlockedMatches`, `listSuddenDeathRounds` |
| `tournament/win-rule.ts` | `SUDDEN_DEATH_CHAIN` (D14) + a `chain` option on `decideMatch` |
| `tournament/advancement.ts` | Decides SUDDEN_DEATH matches on the D14 chain; `resolveSuddenDeathMatches` |
| `tournament/progress.ts` | Seals expired sudden-death windows and resolves them before the stage pass |
| `components/features/bracket-tree.tsx` | Shared bracket visualisation (screen [11]) |
| `/bracket/[tournamentId]` | Competitor-facing bracket with "my path" highlighting |
| Admin bracket tab | Deadlock list + sudden-death controls, plus the shared tree (screen [21]) |
| `scripts/verify-sudden-death.ts` | 40 checks, including the E6 DoD |

## How sudden death works

D14 is specific: a **new short challenge** (not a replay), **10 minutes**, decided on **Functional
score alone**.

```
QF match tied on every D5 dimension
        │  advancement flags tieUnresolved, holds at JUDGING
        ▼
admin picks a NEW published problem  →  startSuddenDeath
        │
        ▼
SUDDEN_DEATH round (one per stage, 600s)  +  Match { resolvesMatchId → the tied match }
        │  competitors submit; evaluated with the `functional-only` profile (D20)
        ▼
progress pass decides it on the D14 chain
        │
        ▼
winner written onto the ORIGINAL match, winReason = SUDDEN_DEATH
        │
        ▼
normal advancement continues from the original match's own topology
```

## Architectural decisions

| Decision | Rationale |
|---|---|
| **The sudden-death match points at the tied match (`resolvesMatchId`), not the reverse** | The main bracket topology is untouched: `nextMatchId` / `loserNextMatchId` are read exactly as before, and advancement never has to know sudden death happened. The link is `@unique` — one decider per match, one match per decider. |
| **The sudden-death match owns no onward links** | Its winner is written onto the original, which already owns the topology. Giving it its own `nextMatchId` would create two paths into the next round. |
| **One sudden-death round per originating stage** | All ties at a stage share one round, so they face the same problem and the same window. Simpler than a round per tie, and fairer — identical conditions, which is the principle D26 makes explicit for future environment profiles. |
| **A separate `SUDDEN_DEATH_CHAIN`, not a flag on the D5 chain** | D14 is a genuinely different rule (functional → tests → time), not a subset. `decideMatch` takes the chain as an option so the rule stays data, and the D5 chain is untouched. |
| **The loser is eliminated at the ORIGINAL stage** | They went out at the quarter-final they were tied in. Recording `eliminatedAtStage = SUDDEN_DEATH` would corrupt the placement bands, since SUDDEN_DEATH is not a stage anyone is knocked out *at*. `assignFinalPlacements` also filters it out of band computation. |
| **Sudden-death rounds are resolved before the stage pass** | A sudden-death result unsticks a match in the *current* round, so resolving it first lets the round complete in the same call rather than needing a second one. |
| **A tied sudden death does not recurse** | It flags `tieUnresolved` again and logs distinctly; an admin opens another challenge. Auto-recursion could loop forever on two identical submissions. |
| **The bracket tree is a server component** | It is a read model with no interaction. The live-updating version arrives with SSE later; shipping client JS for a static tree now would be waste. |

## Migrations

`20260726120000_e6_sudden_death_link` — additive: `Match.resolvesMatchId` (nullable, `@unique`,
self-FK). No existing column or constraint changed.

## Breaking changes

**None.** `decideMatch`'s new `chain` option is optional and defaults to the D5 chain, so every
existing call behaves identically.

## Bugs found during implementation

1. **Placement bands would have been corrupted by the sudden-death round.** `assignFinalPlacements`
   iterates knockout rounds to compute bands; a `SUDDEN_DEATH` round would have occupied one, and
   `updateRankingsForMatch` would have recorded the loser as eliminated "at SUDDEN_DEATH". Both are
   now handled — the round is filtered out of band computation, and the loser is ranked against the
   originating stage. Covered by two checks.
2. **Sudden-death matches would never have been decided.** `knockoutStages()` does not yield
   `SUDDEN_DEATH`, so `advanceStage` never visits those rounds — a finished challenge would have
   scored but never unstuck the bracket. Added `resolveSuddenDeathMatches`, called from the progress
   driver.

## Verification

| Suite | Result |
|---|---|
| `verify:sudden-death` | **40/40** — the D14 chain, every guard, the full persisted path, and the DoD |
| `verify:admin` | 89 — no regressions |
| `verify:tournament` / `bracket` / `tournament:e2e` | 197 / 118 / 134 — no regressions |
| `verify:submission` | 179 — no regressions |
| `verify:evaluation` / `:e2e` / `profiles` | 31 / 19 / 30 — no regressions |
| `verify:auth` / `queue` / `runner` | 36 / 15 / 5 — no regressions |
| tsc · eslint · prettier · next build | all pass |

**DoD evidence** — an 8-competitor tournament ran to a champion through a forced deadlock: a
quarter-final identical on *every* D5 dimension (including submission timestamp) was flagged, held
the round, was settled by a sudden-death challenge on a different problem, propagated its winner
into the semi-finals, recorded the loser as eliminated at QF, and completed with intact placements.
The sudden-death winner was deliberately given the *lower* overall score to prove D14's
functional-only rule actually decides.

## Deviations from the blueprint

| # | Deviation | Why |
|---|---|---|
| **1** | **One sudden-death round per stage, not per match** | The blueprint says "sudden-death round/match" without specifying granularity. Sharing a round per stage gives every tie at that stage the same challenge and window — fairer, and fewer rounds to operate. |
| **2** | **Sudden death is admin-initiated, not automatic** | D14 requires a *new* challenge, and only an operator can choose which published problem that is. Auto-selection would either pick arbitrarily or require a "sudden-death problem pool" the blueprint does not define. The deadlock is surfaced prominently in the admin bracket tab so it cannot be missed. |
| **3** | **Bracket UI is server-rendered, not SSE-live** | Screen [11] specifies `[C/SSE]`. SSE is E7's deliverable (`/api/live/[tournamentId]`); building a bespoke live channel here would be thrown away. The tree is structured so only its data source changes. |
| **4** | **Bracket page lives at `/bracket/[tournamentId]` inside the app group** | Screen [11] implies a public surface. It is currently behind the authenticated layout; the landing-page embed is D10/E8 work. Unlisted tournaments 404 regardless. |

## Intentionally deferred

- **SSE live bracket** (E7) — the tree renders per request today.
- **Landing-page bracket embed** (E8/D10).
- **Sudden-death problem pool** — an operator picks the challenge; automatic selection is not in
  the blueprint.
- **Sudden-death duration control in the UI** — `SUDDEN_DEATH` is deliberately absent from the
  settings duration panel while the feature was unimplemented. Now that it exists, exposing it is a
  small follow-up; the value is honoured from configuration today (D7 default 600s).
