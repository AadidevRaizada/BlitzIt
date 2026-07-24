# Coding Standards

## Naming conventions
- **Files:** kebab-case (`submit-form.tsx`, `judge-submission.ts`). React components PascalCase
  in file exports; hooks `useThing`. Server Action files `*.actions.ts`; job processors
  `*.processor.ts`; zod schemas `*.schema.ts`.
- **Types/Interfaces:** PascalCase, no `I` prefix. Enums PascalCase, members SCREAMING_SNAKE for
  DB-backed status values to match Prisma enums.
- **DB:** models PascalCase singular (`Tournament`), columns camelCase in Prisma, snake mapping
  via `@@map` if we want snake_case in Postgres (pick one and keep it; default: Prisma camel).
- **Booleans:** `is/has/can` prefixes. **Money:** always `amountMinor` + `currency`.
- **Env vars:** SCREAMING_SNAKE; browser-exposed must be `NEXT_PUBLIC_*` and nothing else.

## Component organization
- Server Components by default. Add `"use client"` only for interactivity, and push it as far
  down the tree as possible (small client leaves, server trunk).
- `components/ui` = vendored shadcn primitives (don't edit heavily); `components/features` =
  product composition; `components/layout` = shell. Co-locate a component's sub-parts.
- No data fetching in client components via effects when an RSC or Server Action can do it.

## Server/client boundary
- `import 'server-only'` at the top of every module that touches secrets, Prisma, or the queue.
- Nothing under `src/server/**` is ever imported by a client component. Cross the boundary only
  through Server Actions or Route Handlers.
- Secrets never reach the client. `lib/env.ts` exports a `serverEnv` (zod-validated, server-only)
  and a `publicEnv` (only `NEXT_PUBLIC_*`).

## API design
- See [`05-api-architecture.md`](./05-api-architecture.md). Actions are thin adapters; logic in
  modules. Typed `Result` returns, no throwing across the boundary for expected errors.
- Idempotency keys on every money/state mutation. Explicit per-resource authorization.

## Validation strategy
- **Zod at every boundary** — Server Action inputs, Route Handler bodies, webhook payloads, env,
  and LLM JSON outputs. Shared schemas in `lib/validation` reused client-side for form UX.
- Never trust client-sent identifiers for authorization; re-derive from the session.

## Error handling
- Typed `AppError` hierarchy (`NotFoundError`, `ForbiddenError`, `ValidationError`,
  `PaymentError`, `JudgingError`, `ConflictError`) each with a stable `code`.
- Expected errors → returned as `{ ok:false, error }`. Unexpected → thrown, caught by
  `error.tsx` boundaries + reported to Sentry. Jobs: retry with backoff; after max attempts move
  to a dead-letter queue + alert.
- User-facing messages are mapped from codes; never leak internals/stack traces to users.

## Logging
- Structured JSON via `lib/logger.ts` with a **correlation id** threaded from request/job through
  modules. Levels: debug/info/warn/error. Log domain events (payment.paid, submission.sealed,
  bracket.advanced) not noise. **Never log secrets, tokens, full LLM prompts with PII, or raw
  card/payment data.** Sentry for exceptions; PostHog for product events (separate concerns).

## Environment variables
- One `.env.example` documenting every var (grouped: db, auth, oauth, razorpay, ai, resend,
  posthog, sentry, redis, r2). Validate at boot with zod — **fail fast** if missing/malformed.
- Separate OAuth apps, Razorpay keys, and secrets per environment. No secret in the repo or in
  `NEXT_PUBLIC_*`.

## Security practices
- **Never execute untrusted competitor code — at all** (D1). Grade deployments as black boxes and
  read repos as **text via the GitHub API**; no cloning-to-build, no sandbox. Probe with egress
  controls (block private/link-local ranges, cap timeouts/response sizes, don't follow internal
  redirects).
- Verify all webhook signatures against the **raw body**. Idempotent handlers.
- **Prompt-injection defense** for the AI judge: untrusted content is data, never instructions;
  validate model output against a schema; deterministic tests are primary.
- Authorization on every action; server-authoritative timers/deadlines; immutable submissions
  after deadline; audit every privileged action.
- Rate-limit submission + order creation. Secrets via Railway env, rotated. HTTPS only.
- Dependency hygiene: pin versions, Dependabot/renovate, `npm audit` in CI, lockfile committed.

## Tooling & CI
- TypeScript `strict` (+ `noUncheckedIndexedAccess`). ESLint + Prettier. Husky pre-commit
  (lint, typecheck, format). CI: typecheck → lint → test → `prisma generate` → build. Conventional
  commits. PRs require green CI. Unit tests mandatory for bracket rules, tie-breaks, judging
  blend, and payment/webhook idempotency.
