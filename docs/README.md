# Blitz It — Engineering Blueprint

> **Status:** Architecture **LOCKED for V1** — see [`DECISIONS.md`](./DECISIONS.md).
> Implementation in progress; per-epic history in `CHANGELOG_EPIC_E*.md`.
>
> | Epic | Scope | State |
> |------|-------|-------|
> | **E0** | Foundation & rails | ✅ complete |
> | **E1** | Authentication | ✅ complete (verified against live GitHub + Google OAuth) |
> | **E2** | Evaluation Engine spike | ✅ complete |
> | **E3** | Tournament lifecycle, seeding & bracket engine | ✅ complete — see [`17-tournament-lifecycle.md`](./17-tournament-lifecycle.md) |
> | **E4** | Submission system & evaluation pipeline | ✅ complete — see [`18-submission-pipeline.md`](./18-submission-pipeline.md) |
>
> This directory remains the source-of-truth blueprint; visual decisions live in
> [`design-system.md`](./design-system.md).

## The single most important decision

**We do not execute competitors' code — at all.** Competitors submit a **public GitHub repo**
**plus a live deployment URL** they host themselves. The Evaluation Engine grades the *running*
deployment as a **black box** (hidden tests + performance + basic security/reliability probes)
and reads the *repository as text* via the GitHub API for an LLM quality pass. **No sandbox, no
Firecracker/E2B/Docker, no cloning-to-build, no Redis/queue.** This removes the entire
untrusted-code-execution risk class. See [`DECISIONS.md`](./DECISIONS.md).

## Database workflow

The schema is now **migration-backed** (`prisma/migrations/`), baselined at `0_init`.

| Task | Command |
|------|---------|
| Change the schema (local) | `npx prisma migrate dev --name <change>` |
| Apply migrations (CI / deploy) | `npx prisma migrate deploy` (runs automatically on Railway start) |
| Inspect drift | `npx prisma migrate status` |

⚠️ **Do not use `prisma db push` any more** — it mutates the database without
recording a migration, which puts it out of sync with `prisma/migrations/` and
means a fresh deploy would not reproduce your schema.

## Read order

1. **[`DECISIONS.md`](./DECISIONS.md)** — the 11 locked V1 decisions (start here).
2. Architecture docs 00–09 + coding standards + tech research (the "why").
3. **Implementation-ready spec 10–16** (the "what to build"):

| # | Document | What it is |
|---|----------|------------|
| — | [Decisions (LOCKED)](./DECISIONS.md) | The 11 final V1 decisions — source of truth |
| 00 | [Product Understanding](./00-product-understanding.md) | Vision, flow, journey, features |
| 01 | [Technical Architecture](./01-technical-architecture.md) | Components & how they communicate |
| 02 | [Database Design (conceptual)](./02-database-design.md) | Entities & relationships |
| 03 | [Folder Structure](./03-folder-structure.md) | Production App Router layout |
| 04 | [Module Breakdown](./04-module-breakdown.md) | Responsibilities & ownership |
| 05 | [API Architecture](./05-api-architecture.md) | Actions vs Handlers vs jobs |
| 06 | [Development Roadmap](./06-development-roadmap.md) | Milestones |
| 07 | [Risk Analysis](./07-risk-analysis.md) | Remaining risks after the decisions |
| 08 | [Open Questions](./08-open-questions.md) | What's resolved vs still open |
| 09 | [Recommendations (resolved)](./09-recommendations.md) | Disposition of each recommendation |
| **10** | **[Final Prisma Schema](./10-prisma-schema.md)** | Implementation-ready `schema.prisma` |
| **11** | **[Final API Specification](./11-api-specification.md)** | Every action, handler, job |
| **12** | **[UI Screen Breakdown](./12-ui-screens.md)** | Every screen + states |
| **13** | **[User Flows](./13-user-flows.md)** | End-to-end participant/spectator flows |
| **14** | **[Admin Flows](./14-admin-flows.md)** | Operator flows |
| **15** | **[Engineering Task Breakdown](./15-engineering-tasks.md)** | Granular tickets |
| **16** | **[Sprint Plan](./16-sprint-plan.md)** | Sequenced sprints |
| **17** | **[Tournament Lifecycle & Bracket Engine](./17-tournament-lifecycle.md)** | E3 as built: state machine, seeding, bracket, advancement |
| **18** | **[Submission Pipeline](./18-submission-pipeline.md)** | E4 as built: submission lifecycle, validation, queue handoff, job states |
| — | **[Design System](./design-system.md)** | Brand, tokens, typography, components, motion |
| — | [OAuth Setup](./oauth-setup.md) | GitHub/Google OAuth app setup for local dev |
| — | [Coding Standards](./coding-standards.md) | Conventions, boundaries, security |
| — | [Tech Research Notes](./tech-research.md) | 2026 findings per technology |

## TL;DR of the locked V1 architecture

1. **Black-box evaluation, no code execution** (above). Functional hidden-tests dominate scoring
   (**60%**); LLM is a **15%** weighted input that never decides a winner alone.
2. **One Railway service, no Redis/BullMQ.** Async work runs on a **Postgres job table** via an
   **in-process runner** (`SKIP LOCKED`), behind a `Queue` interface so BullMQ drops in later.
3. **8 pluggable challenge categories** (REST API, Web App, AI Agent, OCR, Automation, Internal
   Tool, CLI, Chrome Extension) — one evaluation strategy each.
4. **Brackets 8/16/32/64**, dynamic prize pool (first prize capped ₹2,000 Week 1), **landing page
   IS the spectator experience**, UTC storage / IST display.
5. **Stack pinned:** Next.js 15 + React 19 + Tailwind v4 + shadcn/ui (new-york, sonner) + Prisma 7
   (`prisma.config.ts`) + Postgres + Better Auth + Razorpay + Resend + PostHog + Sentry.
