# 05 — API Architecture

## The rule for choosing an interface

| Use | For |
|-----|-----|
| **Server Action** (`"use server"`) | In-app authenticated mutations by our own UI: buy pass, submit solution, admin ops. CSRF-protected, ergonomic, revalidates. |
| **Route Handler** (`app/api/**/route.ts`) | Anything with an external caller or special I/O: webhooks (raw body), OAuth callback, SSE streaming, health checks. |
| **RSC data loader** | Reads. Fetch directly via Prisma in Server Components; no API layer needed for GET. |
| **Job (Postgres-backed)** | Anything slow/retryable/third-party: evaluation, emails, payouts, bracket advancement. Enqueued as `EvaluationJob` rows, run by the in-process runner (D3). |

**Every mutation, regardless of interface:** validate input with Zod → authenticate →
authorize (ownership/role/window) → execute in a module (transaction if multi-write) →
revalidate/emit events → return a typed result. Server Actions are **not** a public API — do
not rely on them for third-party integration.

## Route Handlers (public / special I/O)

| Method | Path | Purpose | Notes |
|--------|------|---------|-------|
| ALL | `/api/auth/[...all]` | Better Auth (OAuth, session, callback) | provider callback URLs per env |
| POST | `/api/webhooks/razorpay` | Payment source of truth | **raw body** signature verify; idempotent via `webhookEventId` |
| GET | `/api/live/[tournamentId]` | SSE: leaderboard + bracket + match status | server-push; falls back to polling |
| GET | `/api/health` | Liveness/readiness for Railway | checks DB + runner heartbeat |

## Server Actions (authenticated app mutations)

Grouped by module (`src/server/actions/*`):

**Payments**
- `createPassOrder(tournamentId)` → creates Razorpay order + pending `Payment`, returns order
  for client checkout.
- (activation happens via webhook, **not** an action.)

**Submission**
- `submitSolution({ roundId | matchId, repoUrl, deploymentUrl, commitSha? })` → validates
  window + registration + ownership, writes immutable `Submission`, inserts an `EvaluationJob`.
- `getRevealedProblem(roundId)` (read action or RSC) → returns problem only after `opensAt`.

**Profile**
- `updateProfile(data)`; `getProfile(username)` (read).

**Admin** (all `requireAdmin` + audited)
- `createTournament`, `scheduleTransitions`, `startRound(roundId)`,
- `createProblem`, `addHiddenTest`, `publishProblem`,
- `overrideScore(judgeRunId, scores, reason)`,
- `publishResults(tournamentId)`, `approvePayout(userId, tournamentId)`.

## Internal job contracts (Postgres-backed, in-process runner — D3)

Jobs are `EvaluationJob`-style rows claimed with `SELECT … FOR UPDATE SKIP LOCKED`. Idempotency
keys prevent duplicate processing; the same contract maps onto BullMQ later.

| Job | Trigger | Idempotency key | Does |
|-----|---------|-----------------|------|
| `EVALUATE` | after submit / round close | `eval:{submissionId}:{attempt}` | resolve the round's stage profile (D20) → pick challenge-type strategy → run only the ACTIVE dimensions: functional tests vs URL + perf + security/reliability probes, plus the repo-text LLM pass **only from SF/THIRD_PLACE/FINAL** → `Evaluation` (renormalised blend) → update `Ranking` |
| `SEED_TOURNAMENT` | Sat cron / admin | `seed:{tournamentId}:{attempt}` | rank qualifiers by the summed simulation score (D13) → write seeds. **Ops path only:** the normal route is the `CLOSE_SIMULATION` transition. Refuses to run once a bracket exists |
| `ADVANCE_BRACKET` | all match evals done | `advance:{roundId}` | seal an expired window → apply win rule + tie-breaks (D5) → write winners into the slots the bracket already reserved → advance the stage or complete the tournament; flag ties needing sudden-death |
| `SEND_EMAIL` | domain events | `email:{notificationId}` | render React Email → Resend |
| `PROCESS_PAYOUT` | admin approval | `payout:{payoutId}` | compliance gate → RazorpayX → update `Payout` |
| `TOURNAMENT_TRANSITION` | Railway cron / admin | `optransition:{tournamentId}:{transition}` (plus the from-state for `ADVANCE_STAGE`) | idempotent state change. The key must stay stable across the transition itself, since a replay reads it *after* the state moved |
| `RECOMPUTE_PRIZE_POOL` | on paid registration | `pool:{tournamentId}:{participantCount}` | recompute dynamic prize pool + distribution (D9) |

## API design conventions

- **Typed results, not thrown strings.** Actions return `{ ok: true, data } | { ok: false,
  error: { code, message } }`. Map `AppError` codes to user-facing messages client-side.
- **Zod at every boundary.** Shared schemas in `lib/validation` so client and server agree.
- **Idempotency** via unique keys (`webhookEventId`, job ids, `dedupeKey`) — no double charges,
  double emails, or double advancement.
- **Authorization is explicit and server-side**, per call, on the resource — never inferred from
  the client having navigated to a page.
- **Revalidation** with `revalidatePath`/`revalidateTag` after mutations; SSE for live surfaces.
- **Rate limiting** on submission and order creation via a **Postgres-backed** counter/token
  bucket (no Redis in V1) to blunt abuse and accidental double-submits at the deadline.
- **Versioning:** if a public/partner API emerges later, it lives under `/api/v1/*` with its own
  auth (API keys); Server Actions remain internal.
