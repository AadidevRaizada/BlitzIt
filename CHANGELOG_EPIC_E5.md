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
