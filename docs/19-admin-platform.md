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

## Tournament configuration (Settings → Configuration)

The three settings the tournament module supports beyond the basics, all editable from the
tournament detail page's Settings tab:

| Setting | Decision | Notes |
|---|---|---|
| Third-place play-off | D6 | Frozen once the bracket is generated — `configureTournament` refuses the change, and the control is disabled with an explanation rather than letting the operator submit something that will be rejected. |
| Round durations | D7 | Three simulation rounds plus each knockout stage, in **seconds**. Blank uses the deployment default. Seconds rather than minutes because a minute-based field would round-trip lossily for any non-whole-minute value and silently rewrite the setting. |
| Evaluation profiles | D20 | JSON: `{"stages":{"QF":"full"},"profiles":{…}}`. Empty means the built-in policy (deterministic through the quarter-finals, AI from the semi-finals). Invalid JSON is refused at the boundary; a structurally valid but unscorable profile still falls back safely at scoring time. |

All three go through `configureTournamentAdminAction` → `configureTournament`, so the module keeps
ownership of validation, the bracket-shape freeze, and auditing. The action validates its payload
with `configureTournamentFormSchema`; nothing reaches Prisma unvalidated.

**`SUDDEN_DEATH` is deliberately absent** from the duration controls — sudden death is not
implemented (E6), so a control for it would misrepresent the product. See the deferred-functionality
table in `CHANGELOG_EPIC_E5.md`.

## Test environment (D35)

The admin platform is where the internal test environment is operated. Three surfaces:

### Users (`/admin/users`)

- **Grant / revoke TEST.** Refused for an account holding any production competitive record —
  including a bare registration — because `Role` is single-valued, so the grant replaces their
  USER identity and bars them from tournaments they are already in. Testers are new accounts.
- **Delete / anonymise.** An account with no competitive record is deleted outright, along with
  its `AuthUser` (which is what actually ends the session and releases the GitHub link). One
  with a record is refused unless the operator explicitly anonymises, which scrubs identity and
  leaves the results standing. This mirrors `deleteTournament`'s existing stance.
- ADMIN is deliberately **not** grantable here. It stays with `npm run make:admin`.

### Test bots (`/admin/bots`)

Create bots, delete them, and add them to a test tournament to fill the field toward the D6
minimum of 8 — which is *met*, not bypassed: bots hold genuine registrations.

Two settings do the real work:

| Setting | Why it exists |
|---|---|
| `submitBehaviour: NEVER` | produces a no-show, the only way to exercise walkovers, double-no-shows and the higher-seed fallback without asking a tester to sit out |
| `scoreMode: TIE` | produces a deliberate deadlock against another TIE bot of equal skill, the only way to reach sudden death (D14) on demand |

Bots are refused from production tournaments and from any tournament with an entry fee.

### Environment switch

`/admin` takes `?env=test`, rendering the same dashboard against test data with a persistent
banner. Test tournaments are created by choosing Environment = Test on the new-tournament form;
it cannot be changed afterwards, because the results would move with it.

### Finishing a round early

A round in a TEST tournament shows a **Finish now** control on the Timeline tab. It closes the
window immediately; everything after that is the ordinary advancement path, treating
non-submitters as no-shows exactly as an expired deadline would. Refused for production.

### Verification

`npm run verify:environment` — 47 checks proving a production user never receives test data by
any route, and that a tester's results never enter the production record.
