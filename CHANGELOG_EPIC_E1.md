# Epic E1 — Authentication

**Milestone:** M1 (Sprint 1) · **Status:** ✅ Complete — verified end-to-end against live
GitHub + Google OAuth by the product owner.
**Commits:** `42bbd23`, `b6ffb9b`, `e4afe94`, `17d566a`

## What was built

- **Better Auth** (D3/D7 — not NextAuth) with GitHub + Google social providers, `nextCookies()`
  last in the plugin array, handler at `/api/auth/[...all]`. Providers register **only when
  credentials exist**, so the app runs before OAuth apps are created.
- **Domain user mapping:** `syncDomainUser()` mirrors the auth user into `User` + `Profile` —
  idempotent, race-safe, non-destructive. Called from the Better Auth create-hook *and* from
  `getSession()`, so a failed hook self-heals on the next request.
- **Session & authorization:** `getSession()` (React `cache`d), `requireUser`/`requireAdmin`
  (redirecting) plus `*OrThrow` variants (typed errors) for Server Actions; pure role predicates
  in `roles.ts`.
- **Route protection:** `(app)` requires a session, `(admin)` requires `ADMIN`.
- **Login UI**, public profile `/u/[username]`, `/settings` edit + `updateProfileAction`.
- **Tooling:** `verify:auth` (36 checks), `make:admin`, `dev:session`, `docs/oauth-setup.md`.

## Architectural decisions

| Decision | Rationale |
|---|---|
| Better Auth tables namespaced `Auth*` (`auth_user`, …) via `modelName` | The blueprint's domain model is already called `User`; domain `User.authUserId` links to `AuthUser.id`. |
| Dual sync (create-hook **and** session) | The hook is the fast path; the session call is the self-healing safety net. Both are idempotent. |
| Provider-owned vs user-owned fields | `email`/`avatarUrl` refresh from the provider; `displayName`/`username`/`city` are seeded once and never clobbered by a later sign-in. |
| Account linking made explicit | `trustedProviders: [github, google]`, `allowDifferentEmails: false` — same verified email across providers attaches to one account instead of duplicating. |
| `roles.ts` split from `session.ts` | Pure predicates can't import `next/navigation`; keeps them testable from scripts. |
| Admin granted out-of-band (`make:admin`) | No self-service path to elevated privilege. |

## Migrations

**`prisma/migrations/0_init`** — the project's baseline migration (24 tables, 18 enums, 44
indexes, 29 FKs), generated with `migrate diff --from-empty` and applied to the existing local
database via `migrate resolve --applied` (non-destructive). Adds the four `auth_*` tables.

⚠️ **Workflow change:** `prisma db push` is no longer used. Use `migrate dev` locally;
`migrate deploy` runs automatically on Railway start.

## Breaking changes

- Env: empty-string values are now treated as *unset* (`.env` placeholders previously failed
  validation). `BETTER_AUTH_SECRET` is **required in production** (dev falls back).
- Landing page moved to `src/app/(marketing)/page.tsx`.
- `/api/health` now reports `checks.schema` and returns **503** when migrations aren't applied.

## Bugs found & fixed

1. **OAuth failures escaped the app** — denied consent / bad state rendered Better Auth's bare
   error page while the login page's `?error=` handling was dead code. Wired
   `onAPIError.errorURL → /login`.
2. **Account-takeover hole** — a unique violation on `email` (vs `authUserId`/`username`) fell
   through to a retry that hit the same constraint and threw mid sign-in. Now refuses with a
   typed `ConflictError` and logs, so a second auth identity can never bind to an existing user's
   record.
3. **Duplicate `account` key** in the Better Auth config (caught by typecheck, `TS1117`).
4. Env validation rejected empty placeholders; `verify:auth` crashed importing `next/navigation`.

## Codex findings

| # | Finding | Outcome |
|---|---|---|
| P1 | CI build fails — `BETTER_AUTH_SECRET` required in production | **Fixed.** Genuine: local builds masked it via `.env.local`. Verified CI simulation exit 1 → 0. |
| P1 | `modelName` must use lower-camel Prisma delegate names | **Not reproducible — unchanged.** Probed both against the real adapter: `AuthUser` *and* `authUser` both return HTTP 200 and issue a session cookie (the adapter normalizes). Kept PascalCase to match `schema.prisma`, and **added a regression test** so a future adapter change fails in `verify:auth` rather than at first sign-in. |
| P1 | No migrations; deploy starts without applying schema | **Fixed.** Committed baseline `0_init`, `railway.json` now runs `migrate deploy`, and the health check proves schema (not just connectivity) — verified on a scratch DB where `SELECT 1` passed but `SELECT FROM "User"` failed. |

## Verification

`verify:auth` 36/36 · `verify:queue` 13/13 · `verify:runner` 5/5 · typecheck · eslint · prettier ·
build · `migrate status` — all green.

Live: unauthenticated routes redirect; signed-in USER blocked from `/admin`; `make:admin` grants
access; profile edit writes DB and updates the public page; logout deletes the session and the
revoked/tampered cookie is rejected; DB integrity 7/7 (no duplicates, no orphans, 1:1:1
`auth_user`/`User`/`Profile`). OAuth round-trip confirmed manually by the product owner for both
GitHub and Google.
