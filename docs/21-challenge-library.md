# Challenge library — design and Week 1 catalogue

Status: **design, pending review.** Nothing here is seeded yet.

Companion to `docs/20-evaluation-strategy-roadmap.md`. That document says where
evaluation is going; this one says what we ask people to build today, and why
those questions are worth asking.

---

## 1. What a BlitzIt challenge is for

D21 sets the target: *"BlitzIt is not trying to find the best programmer. BlitzIt
is trying to discover who can build the best software under realistic production
constraints."* D23 names business-rule correctness and robustness as first-class.

So the challenge is never the transport. Everybody can expose a route. The
question is whether the thing behind the route behaves like software that has met
users: whether a retry charges twice, whether a cancelled booking frees its slot,
whether an expense can be approved by the person who filed it.

AI assistance is assumed, not policed. That is the whole reason difficulty has to
come from **judgement under stated rules** rather than volume of code. A model
will write the endpoint. What it reliably gets wrong is the interlocking rule —
the transition that must be refused, the second call that must not double-count,
the error that must be 404 instead of 403. Those are the discriminators, and
every challenge below is built around at least one.

### 1.1 Session-scoped state (the design decision that shapes everything)

The first three authored problems (`fare-split`, `log-triage`, `url-canonical`)
were deliberately stateless, on the reasoning that a problem needing persistence
would "grade the hosting lottery rather than the engineering". That instinct was
right about infrastructure and wrong about state.

**The rule going forward: state may exist within one evaluation session, and
never before it.**

- The evaluator already sends hidden tests **strictly sequentially** against one
  deployment (`for (const test of ctx.hiddenTests)` in the REST_API strategy), in
  `sequence` order. A challenge can therefore create state and then interrogate
  how it was managed.
- Nothing is preloaded. No competitor needs Postgres, Redis, a migration, or a
  seed step to compete. A single deployed REST API is the entire requirement, on
  Railway, Render, Fly, Vercel Functions or anything else.
- Storage is the competitor's engineering decision — in-memory, SQLite, Postgres,
  Redis. An in-memory implementation that survives the sequence correctly is a
  legitimate, passing answer.
- A competitor who deploys several stateless instances and loses state between
  sequential requests has made a deployment decision. Week 1 is not designed
  around that case, and multi-instance behaviour belongs to D24+.

This buys back almost everything worth asking about — authorize-then-capture,
book-then-cancel, deliver-then-redeliver, quote-then-redeem — while keeping the
barrier to entry at "you have deployed a web service".

---

## 2. What the evaluator can and cannot check today

Authored against the real contract in
`src/server/modules/evaluation/strategies/rest-api.ts`, not against what would be
convenient. Every limitation below is a limitation, stated as one — not a gap to
be papered over.

**Available.** Per hidden test: any `method`, `path`, request `headers`, and
`body`. Assertions on response `status`, `jsonPath` (exact `JSON.stringify`
equality at a path), `bodyContains` (substring), and `maxDurationMs`.

**Limitations, and what each one costs us:**

| Limitation | Consequence for challenge design |
|---|---|
| **No response-header assertions.** `evaluateAssertion` reads status, duration, body substring and JSON paths only. | `ETag`/`If-Match` round-trips, `Retry-After`, `RateLimit-*`, `Location` cannot be graded. Where a challenge needs a version or a remaining quota, the API is specified to return it **in the body**. Stated in the challenge, so it is a design instruction rather than a hidden trap. |
| **No chaining of values between tests.** Specs are static rows; a server-generated id or cursor in response *N* cannot become input to request *N+1*. | **Every resource identifier is client-supplied.** Defensible on its own terms (it is how idempotency keys and `PUT` semantics work) and it is what makes the sequences expressible at all. Where a cursor is needed, its format is specified rather than opaque. |
| **No concurrency.** One request at a time, sequentially. | True races are untestable: double-spend under simultaneous capture, oversell under parallel holds, lost updates. Several challenges below encode the *rule* that would protect against a race (an invariant that must hold, a second call that must not double-count) without claiming to have raced anything. **We do not pretend otherwise.** |
| **No clock control.** | No TTL, expiry, or time-window behaviour. All instants are passed **absolutely in the request**; no challenge depends on "now". |
| **No fault injection.** | Downstream failure, partial outage and retry-under-failure are unreachable (D24). |
| **`jsonPath` is leaf-only and exact.** Segments split on `.`/`[n]`; comparison is `JSON.stringify` equality; `.length` resolves on arrays and objects but **not** on strings; no wildcards or filters. | Assert leaves, never whole objects — JSONB does not preserve key order, so a whole-object assertion would fail correct answers cosmetically. Arrays of primitives are safe and are how ordering gets asserted. |
| **`evaluate` retries up to 3×** (`JOB_RETRY_POLICIES.evaluate`), replaying the whole sequence against a deployment that already holds state from the previous attempt. | **Replay-safety is mandatory.** Two mechanisms: client-supplied ids make creation idempotent by construction, and challenges that assert collection-level counts specify a `POST /_reset` as test 1. A challenge that is only correct on a clean deployment is a flaky challenge. |
| **JSONB key reordering.** `HiddenTest.spec` is `jsonb`; Postgres normalises object key order. | A signature computed over a raw request body would not survive the round trip. The webhook challenge therefore signs the value of a single **string** field, which is immune to reordering. |

Everything in the right-hand column is a real constraint we designed around. The
items that genuinely cannot be asked yet — races, expiry, chaos, multi-instance —
are recorded per challenge under "D24+ extensions" so the catalogue grows into
the hidden-environment work rather than being rewritten by it.

---

## 3. Catalogue

Eight challenges in six families. Eight rather than thirty because a challenge
whose discriminator a model clears on the first attempt teaches us nothing about
the competitor — and eight rather than the nine first drafted because the overlap
audit in section 4 merged two of them. Section 4.2 records which stage each is
sized for, including an honest gap at the short end.

Common to all: `GET /health` returning `{"status":"ok"}` (sampled for the
performance score), JSON responses, integer **paise** for money, and errors as a
JSON body with an `error` string. The standard scoring note is appended to every
statement.

---

### 3.1 Payments

#### A. Payment Lifecycle — `payment-lifecycle`

**Business scenario.** The full life of one card payment: an authorization places
a hold, the merchant captures against it as goods ship, refunds what the customer
sends back, or voids what it never needed. This is the primitive chain every PSP
exposes and every marketplace is built on.

**Difficulty.** Hard.

**Learning objectives.** Model a money state machine where the illegal
transitions matter more than the legal ones; hold two ledgers against two
different bases without confusing them; make every mutation idempotent under
retry.

**Skills measured.** State-machine modelling, conflict semantics (`409` vs `422`
vs `404`), invariant maintenance across a workflow, idempotency-key handling.

**API surface.**
```
POST /payments                { id, amountPaise, idempotencyKey }
POST /payments/:id/captures   { id, amountPaise }
POST /payments/:id/refunds    { id, amountPaise, idempotencyKey }
POST /payments/:id/void
GET  /payments/:id            -> { id, amountPaise, capturedPaise,
                                   remainingPaise, refundedPaise,
                                   refundablePaise, status }
```

**Hidden business rules.** Two invariants hold after every operation:
`capturedPaise + remainingPaise == amountPaise`, and
`refundedPaise + refundablePaise == capturedPaise`. **Refunds are capped by what
was captured, never by what was authorized** — this is the rule the whole
challenge turns on. Multiple partial captures and multiple partial refunds are
both allowed. The authorized amount is immutable. Status walks `AUTHORIZED` →
`PARTIALLY_CAPTURED` → `CAPTURED` → `PARTIALLY_REFUNDED` → `REFUNDED`, or
`VOIDED`; each terminal-ish step is reached exactly at equality, never before. A
repeated `idempotencyKey` on either create or refund returns the **original**
record and creates nothing.

**Hidden edge cases.** Over-capture is refused **wholesale** with `422` and the
remaining amount in the body — never clamped. Over-refund is refused **wholesale**
with `409`. Refunding before anything is captured → `409`, even on a fully
authorized payment. Void is legal only from `AUTHORIZED`: after any capture it is
`409`, while a second void from `AUTHORIZED` is **idempotent** (`200`) — the
asymmetry is deliberate. Capture after void → `409`. A zero or negative amount
anywhere → `400`. Any operation on an unknown payment → `404`. Capturing 40% and
then attempting to refund 100% must fail, and `refundablePaise` must read 40% of
the authorized total, not 100%.

**Evaluation philosophy.** The happy path is a handful of lines. The grade lives
in the refusal matrix and in which base each ledger is measured against, because
that is where money software actually goes wrong.

**Why it is difficult.** Two ledgers, two bases, one shared state machine. Every
rule interacts with every other, and "void is idempotent but void-after-capture
is a conflict" cannot be satisfied by a reflexive guard — it requires having
modelled the states on purpose.

**Why it resists a generated CRUD answer.** Generated implementations
characteristically cap refunds against the **authorized** amount rather than the
captured amount, clamp an over-capture to the remaining balance instead of
refusing it, permit void-after-capture, and mint a new id for a duplicate
idempotency key. Four independent failures, each separately graded.

**Dimensions exercised.** Functional (primary), Security & reliability (clean
`4xx` rather than a crash), AI review from SF onward (D20) — a single shared
core serving five endpoints is visible to a reviewer.

**D24+ extensions.** Concurrent captures racing the same remaining balance;
authorization expiry after a real interval; capture against a downstream PSP that
times out and must be retried safely; asynchronous refund settlement confirmed by
webhook.

### 3.2 Commerce

#### B. Inventory Reservation — `inventory-holds`

**Business scenario.** A cart holds stock while the customer pays. The hold is
confirmed on payment or released on abandonment, and the shop must never oversell.

**Difficulty.** Hard.

**Learning objectives.** Maintain a three-bucket invariant across a workflow;
make release idempotent so a retried abandonment does not credit stock twice.

**Skills measured.** Invariant maintenance, workflow state, double-count
avoidance, conflict semantics.

**API surface.**
```
POST /skus                      { id, totalQuantity }
POST /holds                     { id, skuId, quantity, idempotencyKey }
POST /holds/:id/confirm
POST /holds/:id/release
GET  /skus/:id                  -> { id, totalQuantity, available, held, sold }
```

**Hidden business rules.** `available + held + sold == totalQuantity`, always,
after every operation. Confirm moves quantity `held → sold`. Release moves it
`held → available`. A hold for more than `available` is refused with `409` and
the available quantity in the body.

**Hidden edge cases.** A second release is **idempotent** — `200`, and stock is
**not** credited twice. Confirm after release → `409`. Release after confirm →
`409`. A hold of `0` → `400`. A hold on an unknown SKU → `404`. Re-posting a SKU
with the same id is an upsert, not a duplicate. Holding exactly `available` must
succeed and drive `available` to `0`.

**Evaluation philosophy.** One stated invariant, checked after every mutation.
The invariant is the specification.

**Why it is difficult.** The idempotent-release rule is the hard part: the
obvious implementation adds quantity back every time the endpoint is called, and
the invariant catches it immediately.

**Why it resists a generated CRUD answer.** Double-crediting on repeated release
is close to a default behaviour in generated code, and it is precisely the bug
that oversells real inventory.

**Dimensions exercised.** Functional (primary), Security & reliability.

**D24+ extensions.** Hold expiry after a real TTL; parallel holds racing the last
unit; oversell under a burst.

---

#### C. Coupon Engine — `coupon-engine`

**Business scenario.** Promotional codes with stacking rules, per-customer
limits, and a quote step the storefront calls on every keystroke.

**Difficulty.** Hard.

**Learning objectives.** Separate a pure calculation from a committing one; apply
a precedence rule; report multiple rejection reasons without failing the request.

**Skills measured.** Side-effect discipline, rule precedence, partial-success
response design, integer money arithmetic.

**API surface.**
```
POST /coupons   { code, type: PERCENT|FIXED, value, maxRedemptions,
                  perCustomerLimit, minSubtotalPaise, stackable }
POST /quote     { customerId, subtotalPaise, codes[] }
                -> { subtotalPaise, applied[], rejected[{code,reason}], totalPaise }
POST /redeem    { customerId, subtotalPaise, codes[] }  -> same shape
GET  /coupons/:code -> { code, redemptions }
POST /_reset
```

**Hidden business rules.** `PERCENT` coupons apply to the **original** subtotal,
never to an already-discounted figure; `FIXED` coupons apply afterwards. The
total never goes below `0`. At most **one** non-stackable coupon may apply, and
it must be the one producing the **greatest** discount — the others are rejected
with `NOT_STACKABLE`. `rejected[]` preserves input order. Rejection reasons are
exactly `MIN_SUBTOTAL`, `CUSTOMER_LIMIT`, `GLOBAL_LIMIT`, `NOT_STACKABLE`,
`UNKNOWN_CODE`.

**Hidden edge cases.** **`/quote` must not consume redemptions; `/redeem` must.**
An unknown code is a rejection, not a `404` — the rest of the basket still
prices. A coupon at exactly `minSubtotalPaise` is accepted (inclusive). A
customer at exactly `perCustomerLimit` is refused. Percentage rounding is floor,
in paise. An empty `codes[]` returns the subtotal unchanged with empty arrays.

**Evaluation philosophy.** The quote/redeem split is the whole challenge: a
storefront calls quote constantly, and a quote with a side effect burns coupons
for customers who never checked out.

**Why it is difficult.** Two endpoints must share all pricing logic and differ in
exactly one respect. Factoring that correctly is a design decision, not typing.

**Why it resists a generated CRUD answer.** Generated implementations routinely
consume redemptions in the quote path, or discount percentages off a running
total, or return `404` for an unknown code and drop the whole basket.

**Dimensions exercised.** Functional (primary), AI review from SF onward — this
is the one where a clean shared-core factoring is visible.

**D24+ extensions.** Concurrent redemptions racing `maxRedemptions`; campaign
windows with real start and end instants; a fraud signal suppressing a code.

---

### 3.3 Infrastructure

#### D. Webhook Receiver — `webhook-receiver`

**Business scenario.** Receiving webhooks from a payment provider that signs
every delivery, retries anything non-2xx, and occasionally delivers out of order.

**Difficulty.** Hard.

**Learning objectives.** Verify a signature before trusting a payload; make
processing exactly-once under redelivery; reject stale state without erroring.

**Skills measured.** HMAC verification, idempotent event processing, version
reconciliation, choosing status codes for a machine consumer rather than a human.

**API surface.**
```
POST /webhooks   headers: X-Event-Id, X-Signature
                 { payload: "<json string>" }
GET  /orders/:id -> { id, status, version }
GET  /webhooks/events -> { processed: [eventId, ...] }
```
The signature is `HMAC-SHA256` over the **value of the `payload` string**, hex,
with a secret published in the statement. Signing a string field rather than the
raw body is deliberate: `HiddenTest.spec` is stored as `jsonb`, which normalises
object key order, so a signature over a serialised object would not survive
storage. The statement says so.

**Hidden business rules.** An invalid or missing signature → `401`, and the event
is **not** processed. A duplicate `X-Event-Id` → **`200`**, processed exactly
once. Each payload carries a `version`; a version lower than or equal to the
order's current version is **ignored** and still answered `200`. An unrecognised
event type → `202`, accepted and ignored. `processed[]` lists each event id once,
in arrival order.

**Hidden edge cases.** The duplicate returning `200` rather than `409` is the
production lesson — a provider retries anything non-2xx, so a conflict status
turns a duplicate into an infinite redelivery loop. A tampered payload whose
signature no longer matches → `401` and no state change, verifiable through
`GET /orders/:id`. An out-of-order delivery must not roll the order backwards.
A valid signature on an unknown order creates it.

**Evaluation philosophy.** Every rule here exists because a real integration
broke. Verify before trust; acknowledge duplicates; never regress state.

**Why it is difficult.** Four concerns — authenticity, deduplication, ordering,
and unknown types — each with a different correct status code, and the
counter-intuitive one (`200` for a duplicate) is the one that matters most.

**Why it resists a generated CRUD answer.** Generated receivers verify the
signature after parsing and mutating, return `409` on duplicates, and let a stale
version overwrite a newer one. All three are graded separately.

**Dimensions exercised.** Functional (primary), Security & reliability (primary —
this is the one challenge where the security dimension is thematically the point).

**D24+ extensions.** Real redelivery storms; out-of-order arrival under
concurrency; a signing-key rotation mid-stream; replay attacks with a timestamp
window.

---

#### E. API Keys, Scopes and Quota — `api-key-scopes`

**Business scenario.** Issuing API credentials to customers: scoped permissions,
rotation without downtime, revocation, and a per-key request quota.

**Difficulty.** Hard.

**Learning objectives.** Order authentication before authorization; never echo a
secret; account for usage without charging for rejected work.

**Skills measured.** Authz modelling, secret-handling discipline, quota
accounting, correct `401`/`403` discrimination.

**API surface.**
```
POST /keys                  { id, secret, scopes[], quota }
POST /keys/:id/rotate       { secret }        # previous secret stays valid
POST /keys/:id/revoke-previous
POST /keys/:id/revoke
GET  /keys/:id              -> { id, scopes, quota, remaining, rotated }
GET  /resource              Authorization: Bearer <secret>
POST /resource              Authorization: Bearer <secret>
```
The secret is **client-supplied** rather than server-generated, because a
server-minted secret could not be carried into a later hidden test. Noted in the
statement.

**Hidden business rules.** Authenticate first, then authorize: an unknown or
revoked secret is `401` **before** any scope check, and a valid secret lacking
the scope is `403`. `GET /resource` needs `read`; `POST /resource` needs `write`;
scope `admin` implies both. After `rotate`, **both** secrets authenticate; after
`revoke-previous`, only the new one. `GET /keys/:id` must **never** include any
secret. Quota decrements on every authenticated, authorized request — including
one that fails validation — and the response body always reports `remaining`.

**Hidden edge cases.** **A `429` does not itself consume quota** — a rejected
request must not deepen the deficit. Quotas are isolated per key. A `401` and a
`403` never consume quota either, because neither did any work. Exhausting the
quota returns `429` with `remaining: 0`. Revoking an already-revoked key is
idempotent (`200`). `revoke-previous` before any rotation is a no-op (`200`).

**Evaluation philosophy.** Two classic security defects, both invisible to a
happy-path test: leaking the secret on read, and answering `403` for an unknown
credential, which confirms to an attacker which keys exist.

**Why it is difficult.** The `401`-before-`403` ordering and the
quota-consumption rules are both about what happens on the paths nobody demos.

**Why it resides here rather than as "rate limiting".** True windowed rate
limiting needs `Retry-After` and `RateLimit-*` response headers and a controllable
clock, and the evaluator has neither. A fixed quota reported in the body tests the
same accounting discipline honestly, and windowed limiting is deferred to D24+
rather than faked.

**Why it resists a generated CRUD answer.** Generated key handlers echo the
secret back on `GET`, conflate `401` and `403`, and decrement the counter on the
`429` path.

**Dimensions exercised.** Functional (primary), Security & reliability (primary).

**D24+ extensions.** Real sliding-window limiting with `Retry-After`; burst
shaping; quota exhaustion under concurrency; key rotation under live traffic.

---

### 3.4 Scheduling

#### F. Booking Engine — `booking-slots`

**Business scenario.** Reservable resources — a meeting room, a barber, a
delivery slot — that must never be double-booked, and that free up on
cancellation.

**Difficulty.** Hard.

**Learning objectives.** Get interval overlap right; free capacity correctly on
cancellation; compute and merge availability.

**Skills measured.** Interval arithmetic, half-open range semantics, workflow
state, computed reads.

**API surface.**
```
POST /resources                  { id, openFrom, openUntil }     # absolute ISO
POST /bookings                   { id, resourceId, startAt, endAt }
POST /bookings/:id/cancel
GET  /resources/:id/availability?from=&to=
                                 -> { free: [{ startAt, endAt }] }
GET  /bookings/:id               -> { id, resourceId, startAt, endAt, status }
```
Every instant is supplied absolutely; nothing depends on "now", so the challenge
is fully deterministic without clock control.

**Hidden business rules.** Intervals are **half-open** `[startAt, endAt)`, so a
booking ending exactly when another begins does **not** conflict. An overlapping
booking is refused `409` with the conflicting booking's id in the body. A booking
extending outside the resource's opening hours → `422`. Cancelling frees the
interval for reuse. `free[]` is ascending and **merged** — adjacent gaps are one
entry.

**Hidden edge cases.** Back-to-back bookings both succeed; a one-second overlap
fails. `endAt <= startAt` → `400`. A booking fully containing an existing one
conflicts. Re-cancelling is idempotent (`200`). A cancelled booking's interval
becomes immediately bookable, including by a booking that previously conflicted.
Availability spanning a fully-booked resource returns `free: []`, not an error.

**Evaluation philosophy.** Half-open intervals are the single most common
off-by-one in scheduling software, and the statement is explicit so the failure
is a comprehension failure rather than a guess.

**Why it is difficult.** Overlap detection, opening-hours containment, and gap
merging are three separate pieces of interval logic that must agree.

**Why it resists a generated CRUD answer.** Generated overlap checks use
inclusive comparisons and reject back-to-back bookings; generated availability
returns unmerged fragments.

**Dimensions exercised.** Functional (primary), AI review from SF onward.

**D24+ extensions.** Concurrent bookings racing one slot; timezone and DST
handling against a real clock; recurring bookings; hold-then-confirm under expiry.

---

### 3.5 Identity

#### G. Expense Approvals — `expense-approvals`

**Business scenario.** Multi-tenant expense approval: who may approve what, up to
which amount, and an audit trail finance can defend.

**Difficulty.** Hard.

**Learning objectives.** Isolate tenants without leaking existence; encode
separation of duties; keep an append-only history.

**Skills measured.** Authorization modelling, information-leak avoidance, audit
design, terminal-state discipline.

**API surface.**
```
POST /users                      { id, tenantId, role, approvalLimitPaise }
POST /expenses                   { id, tenantId, submitterId, amountPaise }
POST /expenses/:id/decide        { actorId, decision: APPROVE|REJECT }
GET  /expenses/:id?actorId=      -> { id, amountPaise, status, decidedBy }
GET  /expenses/:id/audit?actorId= -> { entries: [{ sequence, action, actorId }] }
```
Roles are `EMPLOYEE`, `MANAGER`, `FINANCE`.

**Hidden business rules.** An actor from another tenant gets **`404`, not
`403`** — a `403` would confirm the record exists. A submitter may never approve
their own expense → `403`, even with sufficient limit. An amount above the
actor's `approvalLimitPaise` → `403`, with the required limit in the body.
`FINANCE` approves any amount. A decided expense cannot be decided again →
`409`.

**Hidden edge cases.** The audit trail's entry `1` is the **submission**, not the
first decision. Entries are append-only and immutable — re-reading returns
byte-identical entries. A rejected expense cannot later be approved (`409`);
`REJECTED` is terminal, not a step. An amount exactly equal to the approval limit
is **allowed** (inclusive). An `EMPLOYEE` approving anything → `403`. Reading an
audit trail cross-tenant → `404`, consistent with the read.

**Evaluation philosophy.** Authorization is where correct-looking software is
most often wrong, and the `404`-versus-`403` choice is the difference between a
tenant boundary and a tenant enumeration oracle.

**Why it is difficult.** Four independent authorization rules compose, and the
correct failure code differs by reason. Self-approval must be refused before the
limit check, or the error tells the wrong story.

**Why it resists a generated CRUD answer.** Generated authorization returns `403`
for cross-tenant access, permits self-approval when the limit allows, and starts
the audit trail at the first decision.

**Dimensions exercised.** Functional (primary), Security & reliability (primary).

**D24+ extensions.** Multi-step approval chains; delegation with expiry;
tamper-evident hash-chained audit entries; concurrent decisions on one expense.

---

### 3.6 API contracts

#### H. Activity Feed Pagination — `activity-feed`

**Business scenario.** A team activity feed — the "what happened" panel in Linear
or Notion — paged by a client while new activity keeps arriving, without showing a
row twice or skipping one.

**Difficulty.** Medium.

**Learning objectives.** Understand why offset pagination is unstable on mutable
data; implement a total ordering with a tie-break; make a cursor mean something
precise.

**Skills measured.** Total ordering, cursor semantics, boundary correctness,
input validation.

**API surface.**
```
POST /activity            { id, at, actor, kind }
GET  /activity?limit=&cursor=  -> { items: [{ id, at }], nextCursor }
```
The cursor format is **specified**, not opaque: `"<at>_<id>"`, exactly the sort
key of the last returned item. Specified because a server-generated opaque cursor
could not be fed into the next hidden test; the trade-off is stated in the
statement and costs the challenge nothing that matters, since the graded content
is the ordering and boundary logic.

**Hidden business rules.** Order by `at` ascending, tie-broken by `id`
ascending — timestamps collide constantly in a busy feed, and `at` alone is not a
total order. A page returns at most `limit` items. `nextCursor` is the sort key of
the final item, or `null` on the last page. The cursor is **exclusive**: paging
resumes strictly after it.

**Hidden edge cases.** An entry appended that sorts **before** the cursor must
never appear on a later page; one that sorts after must appear. Two entries with
an identical `at` must page deterministically by `id`. `limit` above `100` →
`400`; `limit` of `0` or negative → `400`; a malformed cursor → `400`. A cursor
pointing past every entry returns `items: []` and `nextCursor: null`, not an
error. An empty feed returns `items: []` and `nextCursor: null`.

**Evaluation philosophy.** The tie-break is the whole question. Without it,
pagination is intermittently wrong in a way no happy-path test reveals — which is
exactly the class of defect BlitzIt exists to surface.

**Why it is difficult.** The correctness condition is about the relationship
between two requests separated by a write, not about either request alone.

**Why it resists a generated CRUD answer.** Generated pagination sorts by
timestamp alone and treats the cursor inclusively, producing duplicates at page
boundaries whenever timestamps collide.

**Dimensions exercised.** Functional (primary).

**D24+ extensions.** Pagination under concurrent writes; deletions mid-page;
snapshot isolation guarantees; keyset pagination over a real dataset at volume.

---

## 4. Review pass

Applied to every challenge above: *would a competent competitor with AI
assistance produce a passing solution in twenty minutes without thinking?*

**Cut before it reached this document.**

- **Split Settlement** (marketplace payment split with largest-remainder
  rounding). Cut for duplicating the existing `fare-split` discriminator almost
  exactly. A second rounding puzzle adds a challenge without adding a question.
- **Standalone Rate Limiter.** Cut and folded into `api-key-scopes`. Stripped of
  `Retry-After` and `RateLimit-*` headers and of clock control, it reduced to a
  counter, and its one real rule — a `429` must not consume quota — is stronger
  sitting alongside authentication and scope ordering than alone.
- **ETag / optimistic concurrency as its own challenge.** Cut. Without
  response-header assertions the `If-Match` round trip cannot be graded, and
  moving the version into the body while calling it ETag semantics would be
  pretending. The underlying lesson — a stale write must be refused, not
  applied — survives as the version-reconciliation rule in `webhook-receiver`.
  Revisit when header assertions exist.

**Merged on the overlap audit.** `payment-authorization-hold` and `refund-ledger`
were drafted as two challenges and are now one. Both had the *same* primary
discriminator — an over-amount refused wholesale rather than clamped — so the
second one asked nothing the first had not already asked. Merging them into
`payment-lifecycle` also produced a **better** discriminator than either half had:
refunds are capped by what was *captured*, not by what was *authorized*, and a
generated implementation almost always caps against the authorized total. One
challenge, one lesson, applied consistently across two ledgers.

**Reframed on the same audit.** The pagination challenge was drafted as "Audit Log
Pagination", which put two audit-themed challenges in the catalogue next to
`expense-approvals` and its audit trail — same domain noun, unrelated lessons. It
is now `activity-feed` in its own **API contracts** family. Nothing about the
graded content changed; the repetition did.

**Kept, with the reservation recorded.** `activity-feed` is the least
production-shaped of the eight, because specifying the cursor format removes the
opacity a real cursor has. It stays because the tie-break defect it targets is
genuinely widespread and genuinely invisible to happy-path testing, and because
one Medium challenge among seven Hard ones is worth having.

**Every surviving challenge has at least one rule that a model reliably gets
wrong**, and each is listed explicitly under "why it resists a generated CRUD
answer" so the claim can be checked rather than assumed:

| Challenge | Family | The discriminator |
|---|---|---|
| `payment-lifecycle` | Payments | Refunds capped by captured, not authorized; over-amounts refused wholesale; void/capture asymmetry |
| `inventory-holds` | Commerce | Repeated release must not double-credit; three-bucket invariant |
| `coupon-engine` | Commerce | `/quote` has no side effect; greatest discount wins among non-stackables |
| `webhook-receiver` | Infrastructure | Duplicate answered `200`, not `409`; stale version ignored |
| `api-key-scopes` | Infrastructure | `401` before `403`; secret never echoed; `429` consumes no quota |
| `booking-slots` | Scheduling | Half-open intervals — back-to-back does not conflict; merged gaps |
| `expense-approvals` | Identity | Cross-tenant is `404` not `403`; audit begins at submission |
| `activity-feed` | API contracts | `(at, id)` total order; exclusive cursor |

### 4.1 Overlap audit

Checked pairwise, on the discriminator rather than the domain — two challenges
about money are fine, two challenges teaching the same lesson are not.

| Pair | Shared surface | Verdict |
|---|---|---|
| `inventory-holds` ↔ `booking-slots` | Both are reserve-then-confirm-or-release workflows | **Distinct.** Inventory grades a numeric three-bucket invariant and idempotent crediting; booking grades interval algebra and gap merging. Same shape, unrelated failure modes. |
| `api-key-scopes` ↔ `expense-approvals` | Both deny requests, both pick a status code | **Distinct.** Keys grade authentication-before-authorization and secret hygiene; approvals grade tenant isolation and separation of duties. The two `4xx` lessons (`401` vs `403`; `404` vs `403`) are different lessons about different boundaries. |
| `payment-lifecycle` ↔ `coupon-engine` | Both do integer money arithmetic | **Distinct.** Payments grades a state machine; coupons grade side-effect discipline between two endpoints that share pricing. |
| `coupon-engine` ↔ existing `fare-split` | Both floor-round money | **Distinct.** `fare-split` is a pure largest-remainder puzzle; the coupon engine's rounding is incidental to rule precedence and the quote/redeem split. |
| `webhook-receiver` ↔ `activity-feed` | Both append to an ordered log | **Distinct.** Webhooks grade authenticity and exactly-once; the feed grades total ordering and cursor boundaries. |

Each family teaches a different primitive: **Payments** a money state machine,
**Commerce** invariants and side-effect discipline, **Infrastructure** untrusted
input and credential accounting, **Scheduling** interval algebra, **Identity**
tenancy and immutable history, **API contracts** ordering and pagination
stability.

### 4.2 Where each challenge belongs — and an honest gap

This is the check the first draft failed. Simulation rounds run **30 / 20 / 10
minutes** with difficulty descending (D7/D13), and **all eight challenges here are
Medium-to-Hard**. None of them is shippable in ten minutes. The catalogue as
designed is a **knockout** catalogue, and saying otherwise would set competitors
up to fail.

| Stage | Window | Suitable |
|---|---|---|
| Qualifiers R1 | 30 min | existing `fare-split`; `activity-feed` is borderline |
| Qualifiers R2 | 20 min | existing `log-triage` |
| Qualifiers R3 | 10 min | existing `url-canonical` — nothing in this catalogue fits |
| R64 / R32 | — | `activity-feed`, `inventory-holds` |
| R16 / QF | — | `booking-slots`, `api-key-scopes` |
| SF / 3rd | — | `coupon-engine`, `webhook-receiver` (AI review active from here, D20) |
| Final | — | `payment-lifecycle`, `expense-approvals` |

So: **the three existing stateless problems keep the qualifier phase**, and this
catalogue supplies the knockout bracket. The gap worth closing next is two or
three *short* session-stateful problems — one create-then-update with a conflict
rule, sized for a 10–20 minute window — so qualifiers can also ask a state
question instead of only a pure-function one. Recorded as follow-up rather than
padded into this catalogue.

### 4.3 Every challenge has a D24 path

Verified per challenge, and none of the eight is a dead end. Each becomes a
strictly harder version of the same question once hidden environments exist, which
is the test of whether the catalogue was designed for the platform we are building
rather than the one we have.

| Challenge | What D24+ adds |
|---|---|
| `payment-lifecycle` | Concurrent captures racing one balance; authorization expiry; a PSP that times out mid-capture |
| `inventory-holds` | Hold TTL expiry; parallel holds racing the last unit; oversell under burst |
| `coupon-engine` | Concurrent redemptions racing `maxRedemptions`; real campaign windows |
| `webhook-receiver` | Redelivery storms; out-of-order arrival under concurrency; signing-key rotation mid-stream |
| `api-key-scopes` | True sliding-window limiting with `Retry-After`; quota exhaustion under concurrency; rotation under live traffic |
| `booking-slots` | Concurrent bookings racing one slot; timezone/DST against a real clock |
| `expense-approvals` | Multi-step approval chains; delegation with expiry; hash-chained tamper-evident audit |
| `activity-feed` | Pagination under concurrent writes; deletions mid-page; volume |

Two of the three cuts also become viable at D24: a standalone rate limiter once
`Retry-After` and `RateLimit-*` can be asserted, and ETag/`If-Match` optimistic
concurrency once response headers can be read at all.

---

## 5. Implementation notes

**Seeding.** `scripts/seed-problems.ts` already does this properly — typed
`ProblemSeed`/`HiddenTestSeed`, upsert by slug, hidden tests replaced wholesale so
an edited spec re-seeds cleanly. The new catalogue extends that array rather than
introducing a parallel mechanism, and raw SQL is not needed. `npm run
verify:problems` then validates every authored spec against
`httpAssertionSchema` and `contractSpecSchema` imported from the strategy itself,
which is what stops a malformed spec from silently scoring competitors zero
mid-tournament.

**Visibility.** New challenges seed as **`DRAFT`**. The existing script writes
`PUBLISHED`; that becomes per-seed rather than hardcoded, and the three original
problems keep their current visibility. Nothing reaches a tournament without a
human publishing it.

**Toward an admin import.** The seed shape is already the import shape: a
`ProblemSeed` is a self-contained document with its hidden tests nested, keyed by
slug, with no identifiers that only make sense in one database. An Admin
Challenge Import can accept exactly this structure as JSON and call the same
upsert. Nothing in the catalogue depends on the seeding route, so moving from
script to admin UI later changes no challenge.
