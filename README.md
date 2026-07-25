# Blitz It

A weekly, live, knockout tournament for builders. Competitors ship a working product against a
timer; an evaluation engine scores it; a bracket runs to a champion on stream.

The defining constraint: **we never execute competitors' code.** Each submission is a public
GitHub repo plus a live deployment the competitor hosts themselves. The engine probes the running
deployment as a black box and reads the repository as text. No sandbox, no containers, no
cloning-to-build. See [`docs/DECISIONS.md`](./docs/DECISIONS.md) (D1).

## Status

| Epic | Scope | State |
|------|-------|-------|
| **E0** | Foundation & rails | ✅ complete |
| **E1** | Authentication & identity | ✅ complete |
| **E2** | Evaluation Engine | ✅ complete |
| **E3** | Tournament lifecycle, seeding & bracket engine | ✅ complete |
| E4 | Payments & dynamic prize pool | not started |

Per-epic history lives in `CHANGELOG_EPIC_E*.md`. The architecture blueprint is
[`docs/`](./docs/README.md), locked for V1 in [`DECISIONS.md`](./docs/DECISIONS.md).

## Stack

Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind v4 + shadcn/ui ·
Prisma 7 + PostgreSQL · Better Auth (GitHub/Google) · Postgres-backed job queue with an
in-process runner (no Redis) · Railway.

## Getting started

```bash
npm install
cp .env.example .env.local        # fill in DATABASE_URL at minimum
docker compose up -d              # local Postgres
npx prisma migrate dev            # apply migrations
npm run dev
```

OAuth setup (optional for local work): [`docs/oauth-setup.md`](./docs/oauth-setup.md).

## Architecture at a glance

```
src/server/modules/
  auth/         who you are — sessions, roles, guards
  tournament/   lifecycle · registration · submission windows · seeding · bracket · advancement
                ...and the stage → evaluation-profile policy (D20)
  evaluation/   evaluation only — stage-agnostic, provider-agnostic
  admin/        audit trail
src/server/jobs/         Postgres-backed queue + in-process runner (D3)
src/server/actions/      Server Actions: validate → authorize → module → revalidate
```

The module boundaries are load-bearing. The evaluation engine contains no stage logic and no AI
special cases; the tournament module decides which dimensions a round scores and hands the engine
a resolved profile. Neither knows about payments, and neither knows about users beyond an id.

Deep dives:
[tournament lifecycle & bracket engine](./docs/17-tournament-lifecycle.md) ·
[module breakdown](./docs/04-module-breakdown.md) ·
[API specification](./docs/11-api-specification.md) ·
[database design](./docs/02-database-design.md)

## Quality gates

Everything below must pass before an epic is considered done.

```bash
npm run typecheck
npm run lint
npm run format:check
npm run build
```

## Verification suites

Executable acceptance checks, not mocks — they run against a real database and, where relevant,
real network probes.

| Command | Covers |
|---------|--------|
| `npm run verify:auth` | Sessions, role guards, domain-user sync |
| `npm run verify:queue` | Job claim/retry/reclaim semantics (`SKIP LOCKED`) |
| `npm run verify:runner` | The in-process runner end to end |
| `npm run verify:evaluation` | Scoring maths, SSRF matrix, strategy registry, live probes |
| `npm run verify:evaluation:e2e` | Submission → job → processor → `Evaluation` row |
| `npm run verify:profiles` | D20 stage-scoped evaluation profiles |
| `npm run verify:tournament` | Lifecycle state machine: every legal edge, every illegal one |
| `npm run verify:bracket` | Bracket topology at 8/16/32/64, byes, seeding, the D5 win rule |
| `npm run verify:tournament:e2e` | A tournament from DRAFT to COMPLETED, incl. restart recovery |
| `npm run verify:llm` | LLM provider wiring (needs a configured key) |

## Database workflow

| Task | Command |
|------|---------|
| Change the schema | `npx prisma migrate dev --name <change>` |
| Apply migrations (deploy) | `npx prisma migrate deploy` |
| Regenerate the client | `npm run prisma:generate` |
| Seed | `npm run db:seed` |
