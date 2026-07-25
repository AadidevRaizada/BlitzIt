# 19 - Admin Platform

E5 turns the existing backend modules into an organizer-facing product surface. It does not add
new tournament, submission, queue, or evaluation business rules. Admin screens validate input,
authorize through E1 guards, call Server Actions, and let the owning domain module decide the
result.

## Routes

All routes live under `src/app/(admin)/admin` and are guarded by `requireAdmin`.

| Route | Purpose |
| --- | --- |
| `/admin` | Operational dashboard: tournament groups, queue health, stats, quick actions |
| `/admin/tournaments` | Tournament list with active, draft, upcoming, running, completed groupings |
| `/admin/tournaments/new` | Create tournament |
| `/admin/tournaments/[tournamentId]` | Overview, timeline, registrations, submissions, bracket, settings |
| `/admin/challenges` | Challenge/problem list |
| `/admin/challenges/new` | Create challenge/problem |
| `/admin/challenges/[problemId]` | Edit, publish/archive, assign, inspect hidden tests |
| `/admin/submissions` | Cross-tournament submission management |
| `/admin/evaluations` | Read-only evaluation index |
| `/admin/evaluations/[submissionId]` | Read-only evidence and scoring detail |
| `/admin/users` | User directory with registrations/submissions summary |
| `/admin/audit` | Privileged action audit trail |
| `/admin/settings` | Operational settings placeholder for current environment and deferred ops |

## Module Ownership

`server/modules/tournament` owns tournament summaries, lifecycle controls, registration
revocation, archive flags, queue health, and bracket read models.

`server/modules/problem` owns challenge/problem authoring, hidden tests, publish/archive, and
problem assignment to rounds. Hidden-test specs are returned only to admin detail screens.

`server/modules/submission` owns submission listing, retry, disqualification, and evaluation read
models. E5 extends the read model with persisted evidence fields only; it does not modify E2
scoring internals.

`server/modules/admin` owns cross-module read models for the user directory, platform stats, and
audit log access.

## Server Actions

`src/server/actions/admin.actions.ts` is the UI orchestration layer. Each action follows the same
shape:

1. `requireAdmin`
2. Zod parse
3. call the owning module
4. revalidate affected admin paths

No domain transitions are implemented inside React components or route files.

## Persistence Changes

E5 adds only additive tournament metadata:

| Field | Reason |
| --- | --- |
| `Tournament.description` | Admin-managed event copy |
| `Tournament.visibility` | `PUBLIC` or `UNLISTED` management |
| `Tournament.archivedAt` | Filing flag for completed/cancelled tournaments |

Archive is deliberately not a lifecycle state. It cannot hide running tournaments.

## Admin Workflows

Implemented workflows:

- dashboard overview with active/draft/upcoming/running/completed tournaments
- tournament create/edit/publish/archive/delete-draft
- lifecycle controls that call the E3 state machine
- registration list and audited competitor removal before seeding
- challenge create/edit/publish/archive, hidden-test management, round assignment
- submissions table with inspect, retry failed/completed evaluations, disqualify
- read-only evaluation detail with scores, dimensions, evidence, prompt/model metadata
- bracket status read model for generated or empty brackets
- user directory and audit log

## Deviations From Blueprint

- The original screen breakdown named `/admin/problems`; E5 uses `/admin/challenges` because the
  epic brief uses challenge management language. The underlying persisted entity remains `Problem`.
- Score override, payout approval, sudden death, spectator live surfaces, notifications, and
  payment administration remain deferred. E5 exposes inspection and retry/disqualification only.
- The settings page is intentionally informational in E5. There is no global mutable settings
  store yet.
- Browser-level UI automation was not introduced. `verify:admin` verifies the guarded routes,
  Server Actions, domain calls, permissions, state errors, and navigation contract against the real
  database.

## Verification

`npm run verify:admin` covers:

- tournament CRUD and invalid actions
- lifecycle transition orchestration
- registration revocation and permission denial
- challenge authoring and hidden-test access
- submission retry/disqualification
- evaluation evidence read model
- user directory and audit access
- route guard and navigation coverage

It is additive to the existing E0-E4 verification suites.
