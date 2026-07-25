# Epic E3 — Tournament Lifecycle & Core Tournament Management

**Milestone:** M3 (Sprint 3) · **Status:** ✅ Complete

The weekly tournament as a machine: a validated state machine, a deterministic bracket, and
advancement that runs entirely off persisted state.

> **Scope note.** The blueprint splits this work across **E3** (lifecycle + admin authoring) and
> **E6** (seeding + bracket engine). The E3 brief for this epic merged them, so what shipped is
> **E3.1 + E3.2 + E6.1 + E6.2 + E6.5**. Admin/bracket **UI** (E3.3–E3.5, E6.4) and **sudden
> death** (E6.3) are explicitly out. See [Deviations](#deviations-from-the-blueprint).

## What was built

`src/server/modules/tournament/`

| Module | Responsibility |
|---|---|
| `config.public.ts` | Isomorphic vocabulary: supported sizes (D6), stage order, auto-sizing, default timings (D7) |
| `config.ts` | Three-layer configuration resolution (tournament → env → defaults), degrading on bad input |
| `lifecycle.ts` | **Pure** state machine: states, transitions, guards, `InvalidTransitionError` |
| `state.ts` | Persisted transitions: row lock, `OpsEvent` idempotency, side effects, audit — one transaction |
| `tournaments.ts` | CRUD: create/update/schedule/configure/delete/list |
| `registration.ts` | Register, withdraw, capacity, participant count, `assertRegistered` |
| `rounds.ts` | Round creation + server-authoritative submission windows |
| `seeding.ts` | D13 aggregation → ranked seed list (reads evaluations, never triggers them) |
| `bracket.ts` | **Pure** topology: seed order, byes, structural invariants |
| `bracket-generate.ts` | Persists a plan in one transaction; resolves byes to a fixed point |
| `win-rule.ts` | **Pure** D5 decision + full tie-break chain |
| `advancement.ts` | Decide → propagate → detect round completion → final placements |
| `progress.ts` | The driver: seal expired window → decide → advance stage → complete |
| `evaluation-profiles.ts` | *(E2/D20, unchanged)* stage → profile policy |

Plus `src/server/modules/admin/audit.ts` (append-only `AuditLog` writer),
`src/server/actions/tournament.actions.ts` + `registration.actions.ts`,
`src/lib/validation/tournament.schema.ts`, and three job processors
(`tournamentTransition`, `seedTournament`, `advanceBracket`).

Full design reference: [`docs/17-tournament-lifecycle.md`](./docs/17-tournament-lifecycle.md).

## Architectural decisions

| Decision | Rationale |
|---|---|
| **Lifecycle state is the pair (`status`, `currentStage`)** | `TournamentStatus` cannot express "we are in the quarter-finals" — every knockout round is `LIVE`. Both halves are columns, so there is no in-memory state to lose. |
| **The state machine is pure; persistence is a shell around it** | The whole transition graph is a total function, so the legal/illegal matrix is exhaustively testable without a database. |
| **`force` skips business guards, never the graph** | An illegal transition must fail for everyone, or the persisted state stops being trustworthy. Ops still needs an escape hatch for "not enough registrations" — that is a judgement call, not a corruption. |
| **Idempotency keys must be stable across their own transition** | A replay reads the key *after* the state moved. Keying on the from-state made every replay miss its own record and then fail as illegal. Keyed on the transition instead (plus the stage, for `ADVANCE_STAGE`). |
| **The whole bracket tree is materialised at generation** | `nextMatchId` is meaningless unless the target exists; "no duplicate matches / no orphan rounds" becomes checkable up-front; a crash mid-bracket has nothing to rebuild. Round *progression* still opens each round automatically. |
| **Seeding and bracket generation never call each other** | Seeding aggregates evaluations into a seed list; generation consumes the seed list and nothing else. Exactly the separation the brief asks for. |
| **The submission window gates every absence-based outcome** | A missing submission means nothing until nobody can submit. Otherwise a freshly opened round is indistinguishable from an empty one. |
| **A fully scored match is decided mid-window** | Nothing is left to wait for, and it keeps the bracket moving during a long round. |
| **Double no-show advances the better seed (configurable)** | Deterministic, defensible, and it does not stall the entire tournament on two absences. Set `TOURNAMENT_ADVANCE_HIGHER_SEED_ON_NO_SHOW=false` to leave it for an admin. |
| **Auto-sizing picks the largest bracket the field fills** | 20 competitors play a full 16, not a 32 padded with 12 byes. Byes remain fully supported for an organizer who deliberately oversizes. |
| **Losing the third-place play-off is not an elimination** | Both players went out at the semi-final; recording `eliminatedAtStage = THIRD_PLACE` would erase where they actually went out. |
| **Placement bands, not invented ordering** | The bracket never establishes an order within a round, so everyone eliminated at a stage shares a band. |
| **Bad configuration degrades, never blocks** | Same rule D20 set for evaluation profiles. An organizer's typo must not brick a live tournament. |

## Migrations

`20260725111022_e3_tournament_lifecycle`:

- `TournamentStatus` += `PUBLISHED`, `BRACKET_GENERATED`
- new enum `MatchSlot { A, B }`
- `Tournament` += `currentStage`, `thirdPlaceEnabled`, `minRegistrations`, `maxRegistrations`,
  `seededAt`, `bracketGeneratedAt`, `cancelledAt`, `cancellationReason`
- `Match` += `seedA`, `seedB`, `loserId`, `nextMatchSlot`, `loserNextMatchId`,
  `loserNextMatchSlot`, `tieUnresolved`; index `(tournamentId, status)`
- `OpsEvent` += `tournament` relation, `payload`, `error`, `startedAt`, `completedAt`,
  `updatedAt`; indexes `(tournamentId, status)` and `(status, scheduledFor)`

Prisma's generated `ALTER TABLE "OpsEvent" ADD COLUMN "updatedAt" … NOT NULL` was **edited to add
`DEFAULT CURRENT_TIMESTAMP`** — as generated it would have failed against a non-empty table.

## Breaking changes

**None.** Additive only. Existing `TournamentStatus` values keep their meaning; the two new ones
sit between `DRAFT`/`REGISTRATION_OPEN` and `SEEDING`/`LIVE`.

## Bugs encountered during implementation

1. **Idempotent replay was impossible** — the default `OpsEvent` key embedded the *from* state,
   which by definition no longer holds when a replay arrives. Every replay missed its own record
   and then failed as an illegal transition. Caught by the E2E suite on its first run. Fixed by
   keying on the transition (qualified by stage for `ADVANCE_STAGE`).
2. **The whole bracket walked over on seed order the instant a round opened.** The double-no-show
   rule fired while the submission window was still open, so "nobody has submitted yet" was read
   as "nobody showed up" — a 64-player bracket would have resolved to the seeding in one pass, at
   the moment the first round started. Fixed with an explicit `windowClosed` input to the pure win
   rule; regression cases live in `verify:bracket`.
3. **No deadline enforcement.** Following (2), a round whose deadline had passed still counted as
   open until something closed it. `progressTournament` now seals an expired window itself, so the
   deadline is enforced by the same pull that advances the bracket.
4. **`ADVANCE_STAGE` from a stage this bracket never plays** (R16 in an 8-team draw) threw a
   generic `LifecycleError` rather than `InvalidTransitionError`. It is an invalid transition, not
   an internal inconsistency, and callers that catch the specific type were silently missing it.
5. **Placement bands were accumulated instead of read per stage** — QF losers would have been
   placed at 7 instead of 5 in an 8-team draw.
6. Migration would have failed on a non-empty `OpsEvent` (see above).

Six more were found by the Codex review — see [Codex review](#codex-review).

## Codex review

Seven findings. **Six were genuine and are fixed**; one was a false positive, disproved with
evidence. Every genuine finding has a regression test.

| # | Severity | Finding | Verdict & fix |
|---|---|---|---|
| **1** | high | **Simulation rounds 2 and 3 never open.** `START_SIMULATION` opens `rounds[0]`; nothing in production ever opened the rest, so D13's "sum of three rounds" was unplayable — only round 1 could accept a submission. | **Confirmed.** My E2E had hidden this by calling `openRound` by hand. Added `progressSimulation()`: seals a round whose window expired and opens the next, and `progressTournament` now routes the `SIMULATION` status to it so one driver covers both phases. The E2E now drives all three rounds through the driver and asserts each opens in turn. |
| **2** | high | **`CLOSE_SIMULATION` could run before any round finished.** The guard only counted outstanding evaluations; seconds after the phase starts nobody has submitted, so it passed trivially and seeded the whole tournament off an empty field. | **Confirmed — worst-case severity.** The guard now also requires every simulation round to be `COMPLETED`/`JUDGING`/past its deadline. Regression asserts the transition is refused immediately after `START_SIMULATION`. |
| **3** | high | **Re-registration race double-counts capacity.** Two concurrent re-registers of the same withdrawn entry could both read the `REVOKED` row, both increment `participantCount`, and both write it `ACTIVE` — one competitor consuming two slots. (New registrations were already protected by the unique index; reactivation was not.) | **Confirmed.** The entry is now claimed with a conditional `updateMany` from not-`ACTIVE`, before the capacity slot, so exactly one caller wins. Regression fires three concurrent re-registrations and asserts one success and one slot consumed. |
| **4** | medium | **Seeding was non-deterministic for a fully tied field.** `rankByWinRule` is stable, but the registration query had no `orderBy`, so competitors who tie on every aggregate field (e.g. nobody submitted) could come back in any order — and the bracket with them. | **Confirmed.** Added `orderBy: [{ registeredAt: 'asc' }, { id: 'asc' }]` and documented registration time as the final tie-break. Regression seeds a 10-competitor all-tied field five times and asserts an identical order. |
| **5** | medium | **`TOURNAMENT_BRACKET_SIZE` was inert.** `CLOSE_SIMULATION` passed the bare `tournament.bracketSize` column to `computeSeeding`, so with the column null a deployment pinned to 64 still auto-sized to 16. | **Confirmed.** Now passes `tournament.bracketSize ?? config.bracketSize`. Regression asserts auto-sizing picks 8 for a field of 10 while an explicit 16 overrides it. |
| **6** | medium | **`ADVANCE_STAGE` jobs collapse to one key.** `enqueueTournamentTransition` defaulted the key scope to `scheduled`, so every stage advance shared `optransition:{id}:scheduled:ADVANCE_STAGE`. Because `PgQueue.enqueue` upserts, every advance after the first would be a silent no-op and the tournament would stall at the first knockout round. | **Confirmed.** The job key now mirrors `transitionIdempotencyKey` exactly, and omitting `fromState` for `ADVANCE_STAGE` throws rather than collapsing silently. Regression covers both. |
| **7** | ~~critical~~ | **False positive — `RoundStage` missing `THIRD_PLACE`.** Codex read `0_init` (which indeed lacks it) and the E3 migration (which does not add it) and concluded a fresh deploy would fail on inserting a third-place round. | **Disproved.** The intervening E2 migration `20260725074456_evaluation_profiles/migration.sql:2` is exactly `ALTER TYPE "RoundStage" ADD VALUE 'THIRD_PLACE';`. A fresh `migrate deploy` applies `0_init → evaluation_profiles → e3`, so the value exists before any code can use it. Codex skipped the middle migration. |

Codex found **no module-boundary violation and no 64-player performance blocker**.

Two further fixes came out of my own audit while the review ran:

- Match decisions are now claimed with a conditional `UPDATE … WHERE status <> 'DECIDED'`, so
  propagation is structurally exactly-once when two advancement passes overlap, rather than
  merely idempotent by coincidence.
- `progressTournament` now takes the tournament row lock (the same `FOR UPDATE` that
  `applyTransition` uses) and re-reads the state inside it, so a concurrent `CANCEL` cannot commit
  between the read and the match writes. *(This also resolves Codex's medium finding on
  `progress.ts`.)*
- A slug collision in `createTournament` now surfaces as a typed `CONFLICT` instead of a raw
  Prisma `P2002`.

## Verification

| Suite | Result |
|---|---|
| `verify:tournament` | **197/197** — every lifecycle edge, the exhaustive legal/illegal matrix, cancellation, stage lists, configuration layering |
| `verify:bracket` | **112/112** — seed order, structure at all four sizes ± third place, better-seed-wins property, determinism, byes, every D5 step, window gating, D13 aggregation |
| `verify:tournament:e2e` | **134/134** — full lifecycle against the database, byes, cancellation, the transition job, seeding determinism, **restart recovery in a separate process**, and a regression for every genuine Codex finding |
| `verify:auth` / `verify:queue` / `verify:runner` | 36 / 15 / 5 — no regressions |
| `verify:evaluation` / `verify:evaluation:e2e` / `verify:profiles` | 31 / 19 / 30 — no regressions |
| tsc · eslint · prettier · next build | all pass |

**DoD evidence** — an 8-team tournament ran DRAFT → COMPLETED through the real engine: 8
registrations under a capacity cap, three simulation rounds summed into seeds 1–8, a bracket of 8
matches across QF/SF/THIRD_PLACE/FINAL, a quarter-final decided on the functional tie-break,
another by walkover after the deadline, the semi-finals finished by a **cold process** that knew
only the tournament id, a third-place play-off between seeds 3 and 4, and final placements
1/2/3/4 with the four quarter-final losers sharing 5th.

## Deviations from the blueprint

| # | Deviation | Why |
|---|---|---|
| **1** | **E3 absorbed E6.1/E6.2/E6.5** (seeding, bracket, advancement) | The epic brief for this work listed them as E3 scope. The blueprint's split is preserved *architecturally* — seeding, topology and advancement are separate modules with no cycles — just delivered in one epic. |
| **2** | **Admin UI (E3.3–E3.5) and bracket UI (E6.4) not built** | The brief scoped E3 to the engine ("no UI shortcuts; the engine should work entirely from persisted state") and excluded admin dashboard work. The server actions those screens will call exist and are verified. |
| **3** | **Sudden death (E6.3/D5.6/D14) not built** | A tie surviving all five tie-breaks sets `Match.tieUnresolved`, holds the match at `JUDGING`, and logs. Resolving it needs a new short challenge and round — the bracket epic's job. Nothing silently advances. |
| **4** | **Two new `TournamentStatus` values** (`PUBLISHED`, `BRACKET_GENERATED`) | The documented lifecycle in the E3 brief names both, and the original enum had neither. `PUBLISHED` gives admins a review step before a schedule goes live; `BRACKET_GENERATED` makes generation a committed, auditable step instead of a side effect of starting round one. |
| **5** | **`SEEDING` retained between `SIMULATION` and `BRACKET_GENERATED`** | The brief's diagram goes straight from Simulation to Bracket Generated. Keeping the existing `SEEDING` status (docs 02/04/10) preserves prior architecture *and* enforces the separation the brief demands: seeding completes as its own committed state before generation reads the seed list. |
| **6** | **`currentStage` added to `Tournament`** | The brief's lifecycle lists R64…FINAL as lifecycle states, but they are round stages — a status enum cannot hold both. The pair (`status`, `currentStage`) represents the brief's diagram exactly, and both are persisted. |
| **7** | **The whole match tree is created at bracket generation**, not one round at a time | See the architectural decisions table. Round *progression* still opens each round automatically, so the behaviour the brief asks for is preserved. |
| **8** | **Auto-sizing prefers a full bracket over a padded one** | D6 says "chosen by registration volume" and D13 "top N qualify where N = the selected bracket size". The largest-size-that-fills rule follows both; byes remain supported for explicit oversizing. |
| **9** | **Changelog filed as `CHANGELOG_EPIC_E3.md`** | The brief said `CHANGELOG_E3.md`; `docs/README.md` documents the series as `CHANGELOG_EPIC_E*.md` and E0–E2 all use it. Consistency won; the content is unchanged. |

## Known limitations

- **Sudden death is a dead end, by design.** A fully tied match stops the round. With four
  scored dimensions this is vanishingly unlikely, but it is a real hole until E6.3.
- **Cron is not wired.** The `tournamentTransition` job, its idempotency and its retry policy are
  built and verified; scheduling it on Railway is a deployment step (see Manual actions in the
  E3 report).
- **Registration carries no money.** Deliberate — E4 owns payment.
- **No `Submission` creation.** E3 owns the window; E5 owns the submission.
- **Placements within a knockout round are a shared band.** Correct for single elimination, but a
  leaderboard wanting a strict 1–64 order will need a further rule (E8).
- **`participantCount` is a denormalisation.** Maintained transactionally and frozen at
  `CLOSE_REGISTRATION`; `reconcileParticipantCount()` exists for ops repair.
