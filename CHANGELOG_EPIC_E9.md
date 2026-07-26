# Epic E9 - Payments, Prize Pool, Registration Ops & Compliance

**Status:** Complete · **Branch:** `epic-e9-payments-prize-pool`

E8 made the tournament watchable. E9 makes entry and money real: paid passes, live prize pools,
operator payment controls, refund paths, and the minimum compliance record needed before a
competitor can enter a paid tournament.

## What was built

| Area | Detail |
|---|---|
| Payments | Razorpay order creation, checkout signature confirmation, raw-body webhook verification, fake gateway for local verification |
| Prize pool | Dynamic pool recomputation from paid entries, floors, sponsors, refunds and stored public/admin display fields |
| Payment administration | Admin payment list/detail, manual mark-paid, refund action, registration cancellation through the payment module |
| Registration experience | Paid registration gate, current terms requirement, reusable orders, stale-price supersession, free-tournament guard |
| Competitor mission control | Dashboard/public tournament state reads now carry registration, readiness, participant count and prize-pool context |
| Production operations | `WebhookEvent` ledger, `OpsEvent` payment events, refund-required flags for late duplicate captures |
| Compliance | Terms acceptance persistence, export surface for user data, refund policy seam, audit rows for terms/payment/admin actions |
| UI polish | Admin nav adds Payments, tournament settings expose prize fields and registration limits, payment detail shows audit/webhook history |

## The ideas this epic rests on

### 1. The webhook is the source of truth

Browser checkout success is useful feedback, not authority. The real state transition happens only
after a Razorpay signature is verified against the exact raw body and the provider payment matches
the stored order, amount and currency. Confirmation and webhooks share the same activation path so
registration, participant count, audit and prize-pool recomputation move together.

### 2. Money state is transactional

Payment status, registration activation and prize-pool recomputation are committed in the same
transaction. A paid row without a registration, or a prize pool that counts a registration the
payment did not fund, would be worse than a failed request because it would look legitimate.

### 3. Visibility is not mutability

Rejected webhooks are recorded because operators need to see probes, mistakes and bad signatures.
They are append-only evidence, not participants in the verified event dedupe keyspace. A rejected
request cannot suppress a future genuine event and cannot rewrite the audit history of an event
that was already applied.

## Architectural decisions

| Decision | Rationale |
|---|---|
| **Payment owns paid activation; Tournament owns registration rules** | `activatePaidPayment` calls `registerCompetitorInTransaction`, so payment can be atomic without duplicating tournament capacity and state checks. |
| **Orders are reusable only while still valid** | A CREATED/PENDING order is reused when price and currency match. If the tournament changes, the old payment is superseded and a new provider order is created. |
| **Late duplicate captures are paid-but-refund-required** | A real capture after a retry cannot be ignored: the money moved. The system marks it PAID, links it to the winning registration's payment, and creates an ops event for refund follow-up. |
| **Refunds shrink registration capacity once** | A refund moves an ACTIVE registration to REFUNDED and decrements participant count only if that row was still active. A refund after withdrawal does not double-release capacity. |
| **Prize pool is a read model stored on Tournament** | Reads stay cheap for public/admin pages, and recomputation is explicit when paid/refunded state or operator prize inputs change. |
| **Terms are versioned and idempotent** | `TermsAcceptance` is keyed by user/version and idempotency key, so paid entry can require the current terms without making repeated acceptance a special case. |
| **Rejected webhooks are keyed outside provider event ids** | Invalid signatures and schema failures use `rejected:<raw-body-sha256>:<unsafe-id>:<uuid>`, never the provider event id itself. |
| **Verified dedupe is filtered** | Real processing dedupes only rows that were signature-verified and ended APPLIED, DEDUPED or IGNORED. `REJECTED` rows are history, not control flow. |
| **Paid checkout reserves capacity before payment** | `createPassOrder` creates an expiring unpaid `Registration` hold and increments `participantCount` under the `payment:{userId}:{tournamentId}` advisory lock before returning a payable Razorpay order. Capture converts that same hold; expiry reconciliation revokes stale holds and releases seats. |

## Migrations

`20260726213000_e9_prize_pool` - additive:
- `Tournament` prize inputs and stored `prizePoolMinor` / `prizeDistribution`
- `Payment` supersession and refund-required metadata
- refund-follow-up index

`20260726223000_e9_webhook_event_ledger` - additive:
- `WebhookOutcome`
- `WebhookEvent` ledger with payment link, raw payload, signature flag, outcome and received time

`20260726233000_e9_ops_compliance` - additive:
- `TermsAcceptance` with user/version uniqueness and idempotency key

`20260727010000_e9_webhook_rejected_append_only` - review fix:
- removes global uniqueness from `WebhookEvent.providerEventId`
- adds a filtered-read-friendly index on `(providerEventId, signatureVerified, outcome)`

`20260727030000_e9_registration_seat_holds` - review fix:
- adds nullable `Registration.holdExpiresAt`
- adds `(tournamentId, status, holdExpiresAt)` index for bounded stale-hold reconciliation

## Breaking changes

**None.** Paid entry adds guards and admin surfaces, but existing free-registration and tournament
lifecycle behavior remains available where the tournament price is zero.

## Bugs found during implementation

1. **Rejected webhook rows could poison payment processing.** Invalid signatures and invalid payloads
   were upserted by an event id parsed from unverified JSON. A forged request could pre-create a row
   for a future real event, causing the genuine signed event to dedupe and never activate the
   registration. Rejected rows are now append-only and namespaced away from provider event ids.

2. **Forged webhook requests could rewrite verified ledger history.** The same upsert path updated
   existing rows to `REJECTED`, replacing the outcome and error message for a real event. Rejected
   recording now uses `create` only and verified rows are never mutated by failed requests.

3. **`db push` hid migration-state drift locally.** The TermsAcceptance table existed before its
   migration was recorded in the local migration ledger. The committed migrations now include the
   full schema change set, and the local ledger was resolved after confirming the objects existed.

## Codex review

One finding, P1. **Confirmed and fixed** with regression coverage.

| # | Severity | Finding | Verdict & fix |
|---|---|---|---|
| **1** | P1 | **Rejected Razorpay webhooks were written into the verified event id namespace.** A bad-signature request naming a future event id could suppress the real payment, and a bad-signature request naming an existing event id could rewrite the ledger row to look rejected. | **Confirmed.** Invalid signatures and invalid payloads are now recorded under `rejected:<sha256>:<unsafe-id>:<uuid>` with append-only `create`. Real dedupe uses only signature-verified APPLIED/DEDUPED/IGNORED rows. `verify:payments` covers both suppression and audit-tampering regressions. |

## Review findings fixed

Sixth adversarial review follow-up:

1. **Concurrent captures could overwrite a registration link and strand a paid payment.** Paid
   activation now serializes on `payment:{userId}:{tournamentId}` as well as the payment id, and the
   unpaid registration link is a conditional `updateMany` requiring `status = ACTIVE` and
   `paymentId = null`. A loser in that conditional race is marked `PAID` with
   `refundRequiredAt` inside the same transaction. `verify:payments` fabricates two captured
   payments for one held seat and proves exactly one links, the other is admin-visible for refund,
   and participant count/prize pool move once.
2. **Last-slot checkout could charge users before any seat was reserved.** Paid order creation now
   creates an expiring unpaid seat hold in the same transaction that claims capacity. Only the
   caller that increments `participantCount` receives a payable Razorpay order; capture clears
   `holdExpiresAt` and attaches the payment without claiming a second seat. `reconcileExpiredSeatHolds`
   releases stale holds through a bounded idempotent ops event. `verify:payments` covers the final
   slot race, expired-hold release, and hold conversion without prize-pool double-counting.
3. **Participant-count reconcile erased open paid reservations.** `reconcileParticipantCount` is now
   lifecycle-aware: while registration is open it counts active seat reservations, including unpaid
   rows and unexpired holds; after close it freezes to the paid/free competitive field. The Job K
   close freeze still passes, and `verify:tournament:e2e` proves open reconcile does not free held
   seats or permit overbooking.

Fifth adversarial review follow-up:

1. **Sequential partial Razorpay refunds could leave a fully refunded competitor active.** The
   refund webhook now parses the signed payment payload's cumulative `amount_refunded` and
   `refund_status`, combines that with the local processed-refund ledger keyed by provider refund id,
   and finalizes cancellation only when both provider cumulative state and local idempotent state
   cover the stored payment amount in the stored currency. Partial states still create the
   operator-action-required event and return non-retryable responses. `verify:payments` now covers
   two half-refund `refund.processed` events delivered sequentially, then replays both and proves the
   seat, participant count and prize pool move exactly once.
2. **Paid lifecycle guards still counted unpaid ACTIVE rows.** Registration now names raw ACTIVE rows
   as seat reservations and adds `countCompetitionEligibleRegistrations` on the shared
   `competitionEligibleRegistrationWhere` predicate. Lifecycle guards, registration-close field
   freeze and participant-count reconciliation use the competitive helper, while capacity still uses
   the raw seat-reservation counter. `verify:tournament:e2e` proves unpaid ACTIVE rows do not satisfy
   `minRegistrations`, close freezes `participantCount` to the paid competitive field, and an unpaid
   pending ACTIVE row still consumes capacity.

Fourth adversarial review follow-up:

1. **Paid tournaments admitted unpaid ACTIVE registrations into competition.** The submission and
   seeding gates now share a paid-eligibility predicate: free tournaments accept ACTIVE
   registrations, while paid tournaments require ACTIVE registrations linked to a PAID payment.
   Introducing a paid pass on a free tournament with active uncomped entries is blocked, so the
   operator must either cancel those entries or attach an auditable manual payment before the
   price change can stand. `verify:submission` covers the free-to-paid transition block, the legacy
   stranded-state submission and seeding refusal, and the manual-payment comp path that restores
   eligibility and keeps participant count aligned with paid prize-pool entries.
2. **Partial Razorpay refunds cancelled fully-paid entries.** `refund.processed` now parses and
   validates the refund id, payment id, amount, currency and `processed` status before mutation.
   Only a full matching refund finalizes cancellation; partial or mismatched refunds leave the
   payment PAID and registration ACTIVE, record an operator-action-required ops event keyed by the
   provider refund id, and keep the webhook response non-retryable. Full provider-side refunds with
   no admin intent are still accepted when they are provably full. `verify:payments` covers a
   half-refund that leaves the seat, participant count and prize pool unchanged, then a full refund
   that releases the seat and shrinks the pool exactly once.

The adversarial payment review is now fully closed. The latest seven confirmed findings were fixed
as follows:

1. **Fake Razorpay was a silent production fallback.** Fake keys and fake gateway behavior now require
   explicit `RAZORPAY_USE_FAKE=true` outside production. Real payment seams throw when credentials or
   webhook secrets are missing, and captured webhooks verify payment status, order id, amount and
   currency against Razorpay before activation. `verify:payments` proves missing production Razorpay
   env refuses the seam and a fake-secret forged webhook does not activate registration.
2. **Captured last-slot losers were charged but left unrecoverable.** Post-capture registration
   conflicts now commit `PAID`, `refundRequiredAt`, a refund reason and a `payment.refundRequired`
   ops event in a separate recovery transaction. The webhook returns a non-retryable result.
   `verify:payments` races two captured webhook payments for one slot and proves exactly one
   registration, correct participant count, admin-visible refund state and a non-retryable loser.
3. **Admin refund could double-call the provider.** Admin refunds now take a payment advisory lock
   before the external refund call, pass a stable provider idempotency key, and re-check local state
   under the lock so a second concurrent attempt is a no-op. `verify:payments` fires two concurrent
   admin refunds and proves one provider call, one REFUNDED payment, and one participant/prize-pool
   adjustment.
4. **Concurrent first-delivery captured webhooks could flag the winning payment for refund.**
   Captured webhooks now claim the verified provider event id under a transaction-scoped advisory
   lock before activation, and paid activation reloads and serializes the payment row by id. A
   duplicate delivery that finds the same payment already linked to an ACTIVE registration is a
   successful dedupe, not a refund-required conflict. `verify:payments` fires two concurrent
   first-delivery `payment.captured` webhooks for the same event and proves one registration, one
   verified ledger row, no `refundRequiredAt`, no refund ops event and one non-retryable duplicate.
5. **Admin refund called Razorpay inside the database transaction.** Refunds now use a short
   intent/outbox transaction that moves the payment to `PENDING_REFUND`, call Razorpay outside the
   transaction with the stable `payment:<id>:admin-refund` idempotency key, record provider success
   on the intent, then finalize local payment, registration, participant count and prize-pool state
   in a second short transaction. Pending and failed refund states are visible in admin payment
   screens, and pending provider-success refunds can be reconciled without a second provider refund.
   `verify:payments` injects a finalization failure after provider success and proves the pending
   state is visible, a second admin refund does not call the provider, and reconciliation completes
   the REFUNDED local state.
6. **Authorized Razorpay payments were treated as settled money.** Only `captured` now activates a
   paid registration or contributes to the prize pool. `payment.authorized` and authorized checkout
   confirmations leave the payment `PENDING` until a later captured state is verified. The fake
   gateway can simulate authorize-then-capture, and `verify:payments` proves an authorized webhook
   creates no registration, participant-count change or prize-pool contribution before a captured
   webhook activates exactly once.
7. **A refund intent could be stranded before Razorpay was ever called.** Refund intents now
   distinguish claimed (`SCHEDULED`), provider call started (`RUNNING`) and provider success
   (`DONE`). Admin retries can re-run a claimed or failed intent with the same idempotency key, while
   concurrent in-flight and provider-success attempts remain no-ops. The admin payment detail keeps
   a retry affordance for pending/failed refunds. `verify:payments` injects an interruption after the
   intent commit but before the provider call, then proves a retry calls the provider once and
   reconciles payment, registration, participant count and prize pool exactly once.

The five earlier review findings remain covered:

1. **Rejected webhooks could pre-poison future real event ids.** Rejected rows are append-only under
   rejected ids and never participate in verified dedupe.
2. **Bad-signature requests could rewrite verified ledger history.** Rejected recording now uses
   create-only rows outside the provider event namespace.
3. **Refund after withdrawal could double-release capacity.** Refunds decrement participant count only
   when an ACTIVE registration is moved to REFUNDED.
4. **Late duplicate captures after a successful retry could be silently lost.** Late captured payments
   are marked PAID and refund-required with ops visibility.
5. **Stale reused orders could survive a price/currency change.** Reusable orders are superseded when
   tournament pricing changes before checkout.

## Verification

| Suite | Result |
|---|---|
| `verify:payments` | passes with 54 checks, including authorized-not-settled, stranded refund retry, webhook-tampering, fail-closed config, last-slot refund-required and concurrent admin refund regressions |
| `verify:prize-pool` | covers floor, growth, refunds, sponsor contribution, unpaid registrations and concurrency |
| `verify:admin` | covers payment admin actions, refunds, cancellations, audit rows and settings UI regressions |
| `verify:spectator` | covers prize-pool notification policy, public snapshots and registration state reads |
| tsc · eslint · prettier · next build | run as part of full verification |

**DoD evidence** - `verify:payments` runs successful checkout, terms gating, failed checkout, retry,
duplicate webhooks, out-of-order events, refunds, invalid signatures, authorize-then-capture, forged
pre-poisoning, forged audit rewrite, refund-after-withdrawal, late duplicate captures, stale price
changes, free-entry guards, unknown orders, registration races and interrupted refund retries.
`verify:prize-pool` proves the public pool reflects only paid money after refunds and operator
contributions.

## Deviations from the blueprint

| # | Deviation | Why |
|---|---|---|
| **1** | **Payout execution is not wired to RazorpayX yet** | E9 builds the payment/refund/compliance base. Actual prize disbursement needs real RazorpayX credentials, KYC status mapping and an operator approval flow beyond the lightweight V1 gate. |
| **2** | **Rejected webhook rows keep the unsafe event id only inside a rejected namespace** | Operators can still correlate a forged request with the claimed id, but the value cannot collide with real processing. |
| **3** | **The fake Razorpay gateway is first-class in verification** | Payment correctness needs deterministic local tests. Live Razorpay credentials should not be required for CI or ordinary development. |

## Remaining risks

| Risk | Assessment |
|---|---|
| **Razorpay live-mode credentials are untested here** | The HTTP adapter is implemented, but the suite uses the fake gateway. First production setup still needs a real order, capture, webhook and refund smoke test. |
| **Full GST/TDS/RazorpayX review is still a business workstream** | Terms acceptance and refund policy are persisted; they are not a substitute for CA review before larger pools. |
| **Payment webhook claim depends on Postgres advisory locks** | The database now serializes verified event ids and payment ids during captured activation. A future queue/worker split should keep the same claim discipline instead of moving webhook dedupe back into process memory. |
| **Rejected webhook retention has no pruning policy** | The rows are intentionally append-only. A production retention rule should be added once traffic and attack volume are known. |

## Manual actions

- **Run the migrations** through `20260727010000_e9_webhook_rejected_append_only`.
- **Set Razorpay credentials** (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`) before disabling the fake gateway.
- **Configure the Razorpay webhook endpoint** at `/api/webhooks/razorpay` with raw-body delivery.
- **Perform one live payment/refund smoke test** before opening paid registration.
- **Complete GST/TDS/RazorpayX review** before scaling prize pools materially.

## Intentionally deferred

- **RazorpayX payout execution** - approval, KYC state mapping, transfer id reconciliation.
- **Notification preferences for prize-pool updates** - the type exists and is in-app only.
- **Automated rejected-webhook retention** - ops policy, not product behavior.
- **Live Razorpay CI** - requires credentials and should run separately from deterministic verification.
