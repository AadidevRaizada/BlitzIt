# Epic E5 - Admin Platform & Tournament Management

## Summary

Implemented the organizer-facing admin platform for operating tournaments through the product UI
instead of scripts.

## Added

- Admin layout and navigation for dashboard, tournaments, challenges, submissions, evaluations,
  users, audit log, and settings.
- Reusable UI primitives for buttons, cards, badges, tables, tabs, fields, page headers, and
  confirmation dialogs.
- Tournament dashboard summaries, lifecycle quick actions, schedule editing, settings, bracket
  status, and archive/delete-draft controls.
- Registration management with audited competitor revocation before seeding.
- Challenge/problem management with authoring, publish/archive, hidden-test management, and round
  assignment.
- Submission management table with admin retry and disqualification actions.
- Read-only evaluation inspection with overall score, dimension scores, profile, evidence,
  provider/model/prompt hash, and timestamps.
- Admin user directory, audit log read model, and platform stats.
- `verify:admin` acceptance suite.

## Schema

- Added `Tournament.description`.
- Added `Tournament.visibility` with `PUBLIC` and `UNLISTED`.
- Added `Tournament.archivedAt` as a filing flag for completed/cancelled tournaments.

All schema changes are additive.

## Architecture Notes

- UI routes and Server Actions orchestrate existing modules. They do not duplicate lifecycle,
  submission, evaluation, or queue rules.
- `server/modules/problem` now owns admin challenge/problem authoring and hidden tests.
- `server/modules/admin` owns cross-module read models only.
- Evaluation detail is read-only in E5; admins can retry or disqualify via submission actions but
  cannot edit scores.

## Deviations

- The admin challenge route is `/admin/challenges` instead of the older `/admin/problems` wording.
  This matches the E5 brief while preserving the `Problem` domain entity.
- Score override, payout management, notification controls, spectator surfaces, sudden death, and
  polished dashboard analytics are intentionally deferred to later epics.

## Deferred functionality

Explicitly recorded rather than silently omitted. Everything below is supported by the backend
and reachable from a module or script; only the UI control is absent.

| Field | Status | Why |
|---|---|---|
| **Sudden-death round duration** (`SUDDEN_DEATH` in `roundDurations`) | Deferred to E6 | Sudden death (D5.6/D14) is not implemented — a match that survives every tie-break sets `Match.tieUnresolved` and holds. Offering a duration control for a round that never runs would misrepresent the product. `resolveTournamentConfig` still honours the value if one is set another way. |
| **Per-tournament challenge-category allowlist** (D17) | Deferred | D17 describes a per-tournament allowlist, but only the global gate (`enabledCategories()`, REST_API-only) is implemented. Half-building the per-tournament half would give operators a control that does not yet constrain anything. Category is chosen per *problem*, which the challenge authoring UI does expose. |
| **Participant-list export** | Deferred | Not specified anywhere in the blueprint; the E5 brief made it conditional on being "already specified". The registrations tab shows the full list on screen. |
| **Approve / reject registrations** | Not applicable | The blueprint has no approval step: registration is unconditional while the window is open, and E4 gates it on a paid pass instead. Removal (a revoke) is implemented. |

The following were listed as gaps in review and are now **implemented**, not deferred:
third-place play-off toggle, per-round durations (D7), and stage evaluation profiles (D20) — all
editable from the tournament **Settings → Configuration** panel.

## Post-review fixes

Three items were raised after the initial Codex pass and fixed before closing E5.

| # | Severity | Issue | Fix |
|---|---|---|---|
| **1** | medium | `configureTournamentAdminAction` took `input: unknown` and forwarded it with `as never`, bypassing Zod entirely. The module validates only `evaluationProfiles`, so `bracketSize`, `thirdPlaceEnabled`, `minRegistrations`, `maxRegistrations` and `roundDurations` reached `tournament.update()` unchecked. A server action is a network boundary: an admin could have written a `bracketSize` of 7, which `buildBracketPlan` rejects — stranding the tournament at `GENERATE_BRACKET`. | Added `configureTournamentFormSchema` and routed the action through it. The `as never` cast is gone; the module's own guards (shape frozen once the bracket exists, D20 profile validation) still apply on top. |
| **2** | low | `archiveTournamentSchema.archived` used `z.coerce.boolean()`. JS truthiness makes every non-empty string `true`, so `"false"` and `"0"` both archived — the same defect `formBoolean` was introduced to fix for `thirdPlaceEnabled`, left behind on this one field. | Switched to the shared `formBoolean`. `z.coerce.boolean()` no longer appears anywhere in the admin schemas. |
| **3** | medium | The E5 brief lists "evaluation profile" among tournament CRUD fields, but neither `evaluationProfiles` (D20) nor `roundDurations` (D7) appeared in any form, and `thirdPlaceEnabled` was settable only at creation — the settings tab had no control. The one action that could reach them was #1, which nothing called. | Added the **Configuration** panel to the settings tab: third-place toggle, three simulation-round durations, seven knockout-stage durations, and a validated evaluation-profiles JSON editor. `TournamentSummary` now exposes `roundDurations`, `evaluationProfiles` and `bracketGeneratedAt` so the panel can render current values and disable frozen controls. |

Design notes on the Configuration panel:

- **Durations are entered in seconds**, matching storage. Minutes would read better but would
  round-trip lossily for any value that is not a whole minute, silently rewriting an operator's
  setting. Each field shows its default in minutes in the hint instead.
- **Blank means "use the default"** — a missing override is absent, not zero.
- **A partially-filled simulation list is dropped rather than sent sparse**, because array holes
  serialise as `null` and would fail the module's positive-integer check.
- **Evaluation profiles are a JSON editor**, not structured fields: it is a nested policy object
  (named profiles plus a stage map), edited rarely. Invalid JSON is rejected at the boundary; a
  structurally valid but unscorable profile still falls back safely at scoring time (D20).

18 regression checks were added to `verify:admin` (71 → 89), covering the boolean parsing, the
validation of the configure payload, the flat-to-nested duration folding, and the round-trip from
the settings UI through to `resolveTournamentConfig` and `resolveEvaluationProfile`.

## Bugs Found During Implementation

- `verify:admin` initially asserted registration removal using an all-status list. The verifier was
  corrected to assert active count plus persisted `REVOKED` status.
- `verify:admin` initially tried to retry an in-flight queued evaluation. The verifier was corrected
  to assert that invalid action and then retry from `FAILED`.
- An unused verifier import caused lint/typecheck/build failure and was removed.

## Codex Review Findings

- Genuine: a published challenge could lose its final hidden test. Fixed by refusing final-test
  removal while the problem is `PUBLISHED`, with a regression assertion in `verify:admin`.
- Genuine: a challenge assigned to a future `PENDING` round could be archived. Fixed by blocking
  archive for `PENDING`, `OPEN`, and `JUDGING` rounds, with a regression assertion in
  `verify:admin`.
- Genuine: raw evaluation evidence was added to the shared submission view. Fixed by splitting
  competitor `SubmissionView` from admin-only `AdminSubmissionView`, with regression assertions in
  `verify:admin`.
- Genuine: prize-pool setting writes were direct database updates without audit. Fixed by recording
  `tournament.updatePrizePoolSettings` in the same transaction.
- Genuine: an unchecked third-place checkbox submitted no value, allowing the database default to
  re-enable it. Fixed with a hidden `false` input before the checkbox.
- Genuine: the server parsed the hidden checkbox string `"false"` as `true`. Fixed with an explicit
  admin form boolean parser and a regression assertion.
- Genuine: the timeline editor omitted an existing simulation close time. Fixed by passing
  `summary.simulationClosesAt` into the schedule form and asserting the binding.
- Genuine: E5-only tournament `description`/`visibility` edits bypassed the audit trail. Fixed by
  writing `tournament.updateAdminFields` audit rows in the same transaction.
- Genuine: concurrent hidden-test creation could race on `(problemId, sequence)`. Fixed with a
  PostgreSQL transaction-scoped advisory lock before sequence allocation.
- Genuine: archived challenges still appeared on the main challenge authoring list. Fixed by
  filtering archived rows out of `/admin/challenges`.
- Genuine: optional admin form fields could not be cleared once set because blank strings were
  normalized to `undefined`. Fixed by preserving blanks in `FormData` and making update schemas map
  clearable fields to `null`.
- Genuine: visibility-only tournament edits still called the E3 structural edit path and failed on
  running tournaments. Fixed by detecting structural changes before invoking E3 CRUD.
- Genuine: archived challenge filtering happened after the list limit. Fixed by applying
  `visibility != ARCHIVED` inside the problem query.
- Genuine: archived tournament filtering happened after the list limit. Fixed with an
  `archivedOnly` query option applied before `take`.
- Genuine: hidden tests could be added while a round using the problem was open or judging. Fixed by
  blocking scoring-input changes during active rounds.
- Genuine: problem contract specs could change while submissions were being evaluated. Fixed by
  freezing contract-spec changes during active rounds while still allowing non-scoring edits.
- Genuine: concurrent admin registration revocations could double-decrement `participantCount`.
  Fixed with a status-conditional update and single decrement after a successful revoke.
- Genuine: concurrent hidden-test deletions could remove the final tests from a published problem.
  Fixed by taking the per-problem advisory lock before counting and deleting.
- Genuine: queue-health reads could cap to old completed jobs and miss current work. Fixed by
  counting totals separately and classifying all non-completed operational jobs without a row cap.
- Genuine: clearing nullable tournament numeric settings submitted blanks that became `undefined`.
  Fixed update schemas so blank `bracketSize`, `minRegistrations`, and `maxRegistrations` become
  explicit `null` updates.
- Genuine: the tournament settings form did not render current registration limits, so unrelated
  saves could clear them. Fixed by adding those values to the summary read model and form defaults.
- Genuine: publishing a problem could race with deleting its final hidden test. Fixed by taking the
  per-problem advisory lock before the publish-time hidden-test count.

## Verification

Required E5 gates:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `npm run verify:auth`
- `npm run verify:queue`
- `npm run verify:runner`
- `npm run verify:evaluation`
- `npm run verify:evaluation:e2e`
- `npm run verify:profiles`
- `npm run verify:submission`
- `npm run verify:admin`

`verify:evaluation:e2e` and `verify:submission` require network access for their public deployment
probe path.
