# Epic E0 — Foundation & Rails

**Milestone:** M0 (Sprint 1) · **Status:** ✅ Complete
**Commits:** `7ee8e39`, `524e296`, `191f59c`, `fe89fc8`

## What was built

Project rails and the async job substrate everything later depends on.

- **Stack scaffolded:** Next.js 15 (App Router) + React 19 + TypeScript `strict`
  (`noUncheckedIndexedAccess`), ESLint (flat) + Prettier + Husky/lint-staged, GitHub Actions CI.
- **Tailwind v4 CSS-first** OKLCH design tokens + shadcn/ui (new-york) + `sonner` toasts +
  `next-themes` light/dark.
- **Prisma 7** with `prisma.config.ts`, `prisma-client` generator → `src/generated/prisma`,
  `@prisma/adapter-pg` driver adapter. Full 24-table schema from `docs/10-prisma-schema.md`.
- **Shared libs:** zod-validated env (server/public split), pino logger with correlation ids,
  typed `AppError`/`Result`, Sentry + PostHog shells.
- **Job substrate (no Redis):** `Queue` interface + Postgres `EvaluationJob` table claimed with
  `SELECT … FOR UPDATE SKIP LOCKED`, driven by an in-process runner booted from
  `instrumentation.ts`.
- **Ops:** `/api/health`, `railway.json`, `docker-compose.yml` (Postgres 17).

## Architectural decisions

| Decision | Rationale |
|---|---|
| Postgres job table instead of Redis/BullMQ | D3 — keep V1 infra to one service + one database. `Queue` interface is the seam to swap in BullMQ later without touching call sites. |
| `EvaluationJob` generalized with `name` + `payload` | Lets one table back every job type (noop, evaluate, email, payout) rather than being submission-specific. |
| Runner state on `globalThis` | Next bundles `instrumentation.ts` and route handlers separately; module scope isn't shared, so `/api/health` couldn't see the runner. |
| Node-only boot split into `instrumentation-node.ts` | Keeps the Postgres driver out of the Edge bundle. |
| Local Postgres on host port **5434** | Port 5432 was already occupied by another local Postgres. |

## Migrations

None in this epic — schema applied via `db push`. (Baseline `0_init` was added later, in E1.)

## Breaking changes

None (first implementation epic).

## Bugs found & fixed

1. **`Can't resolve 'fs'`** — Next bundled `pg` via the Edge instrumentation build. Fixed with
   `serverExternalPackages` + splitting the Node-only runner boot.
2. **`uncaughtException: worker thread exited`** — `pino-pretty`'s `thread-stream` worker breaks
   under Next bundling. Now JSON logging inside Next, pretty only outside.
3. **Prisma 7 requires a driver adapter** — datasource has no `url`; added `@prisma/adapter-pg`.

## Codex findings

| # | Finding | Outcome |
|---|---|---|
| P1 | Jobs left `CLAIMED` after a crash/redeploy were stranded forever | **Fixed** — `reclaimStale(timeoutMs)` requeues abandoned claims or dead-letters them past `maxAttempts`; swept every 30s, `RUNNER_CLAIM_TIMEOUT_MS` (default 5min). |
| P2 | Prisma client missing on a fresh checkout | **Fixed** — added `postinstall: prisma generate`. Root cause was deeper: `prisma.config.ts` used the eager `env()` helper, which aborted generate with no `.env` present; now falls back to a placeholder DSN. |
| P2 | Global badge uniqueness broken (Postgres treats NULLs as distinct) | **Fixed** — partial unique index `UNIQUE (userId, badgeId) WHERE tournamentId IS NULL` via the `partialIndexes` preview feature. |

## Verification

`verify:queue` 13/13 · `verify:runner` 5/5 · typecheck · eslint · prettier · build — all green.
Job loop proven end-to-end on real Postgres (insert → claim → process → DONE).
