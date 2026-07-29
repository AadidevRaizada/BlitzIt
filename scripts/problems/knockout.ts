import { createHmac } from 'node:crypto';
import {
  DEFAULT_CONTRACT,
  SCORING_NOTE,
  STATEFUL_NOTE,
  healthTest,
  resetTest,
  type HiddenTestSeed,
  type ProblemSeed,
} from './shared';

/**
 * The webhook signing secret, published in that challenge's statement.
 *
 * Signatures are COMPUTED here rather than pasted in, so a spec and its
 * signature can never drift apart — editing a payload automatically re-signs it.
 * The signed value is the `payload` **string**, not the request object, because
 * `HiddenTest.spec` is stored as `jsonb` and Postgres normalises object key
 * order; a signature over a serialised object would not survive the round trip.
 */
const WEBHOOK_SECRET = 'whsec_blitzit_demo_2026';

function sign(payload: string): string {
  return createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
}

/** One webhook delivery. `tamper` signs a *different* payload than it sends. */
function delivery(opts: {
  name: string;
  weight: number;
  eventId: string;
  payload: Record<string, unknown>;
  status: number;
  signature?: string;
  omitSignature?: boolean;
}): HiddenTestSeed {
  const payload = JSON.stringify(opts.payload);
  const headers: Record<string, string> = { 'X-Event-Id': opts.eventId };
  if (!opts.omitSignature) {
    headers['X-Signature'] = opts.signature ?? sign(payload);
  }
  return {
    name: opts.name,
    weight: opts.weight,
    spec: {
      method: 'POST',
      path: '/webhooks',
      headers,
      body: { payload },
      expect: { status: opts.status },
    },
  };
}

/**
 * The knockout catalogue (D34 era) — eight session-stateful REST_API problems.
 *
 * Designed and reviewed in `docs/21-challenge-library.md`. Read that first: it
 * records why these are stateful when the original three are not, exactly what
 * the evaluator can and cannot assert, and which of the interesting questions
 * are deferred to D24 rather than faked.
 *
 * Three constraints shaped every problem here, all of them real:
 *
 * 1. **No response-header assertions.** The evaluator reads status, JSON paths,
 *    body substrings and duration — never headers. So anything a competitor must
 *    prove (a version, a remaining quota) is specified to appear in the BODY.
 *    That is why there is no ETag challenge.
 *
 * 2. **No chaining between tests.** Hidden test specs are static rows, so a
 *    server-generated id cannot become the next request's input. Every id is
 *    therefore client-supplied — which is also what makes creates idempotent and
 *    the whole sequence replay-safe.
 *
 * 3. **`evaluate` retries up to 3×**, replaying the sequence against a
 *    deployment that already holds state. Hence `POST /_reset` as test 2 on
 *    every problem, and assertions that survive a replay.
 *
 * All eight seed as DRAFT. Nothing here has been reviewed by a human yet.
 */
export const knockoutProblems: ProblemSeed[] = [
  // ─────────────────────────────── Payments ───────────────────────────────
  {
    slug: 'payment-lifecycle',
    visibility: 'DRAFT',
    title: 'Payment Lifecycle',
    difficulty: 'Hard',
    contractSpec: DEFAULT_CONTRACT,
    statementMarkdown: `
# Payment Lifecycle

Ship the API a payment processor exposes: authorize a card, capture against the
authorization as goods ship, refund what comes back, void what you never needed.

All money is an integer number of **paise**. Never use floats.

## \`GET /health\`

\`\`\`json
{ "status": "ok" }
\`\`\`

Status \`200\`. Sampled for your performance score — keep it trivial.

## Endpoints

\`\`\`
POST /payments                { "id", "amountPaise" }
POST /payments/:id/captures   { "id", "amountPaise" }
POST /payments/:id/refunds    { "id", "amountPaise" }
POST /payments/:id/void
GET  /payments/:id
\`\`\`

\`GET /payments/:id\` returns \`200\`:

\`\`\`json
{
  "id": "pay_1",
  "amountPaise": 100000,
  "capturedPaise": 40000,
  "remainingPaise": 60000,
  "refundedPaise": 0,
  "refundablePaise": 40000,
  "status": "PARTIALLY_CAPTURED"
}
\`\`\`

## The two invariants — read this twice

After **every** operation, both of these hold:

\`\`\`
capturedPaise + remainingPaise === amountPaise
refundedPaise + refundablePaise === capturedPaise
\`\`\`

The second one is the whole challenge. **Refunds are limited by what you
captured, not by what you authorized.** If you authorize ₹1000 and capture ₹400,
the most you can ever refund is ₹400.

## Status

One of \`AUTHORIZED\`, \`PARTIALLY_CAPTURED\`, \`CAPTURED\`,
\`PARTIALLY_REFUNDED\`, \`REFUNDED\`, \`VOIDED\`.

- \`CAPTURED\` exactly when \`remainingPaise\` reaches \`0\` — not before.
- \`REFUNDED\` exactly when \`refundablePaise\` reaches \`0\` **and** something was
  captured.
- \`amountPaise\` is immutable once created.

## Rules

Multiple partial captures are allowed. Multiple partial refunds are allowed.

- **Over-capture is refused whole.** A capture larger than \`remainingPaise\`
  returns \`422\` and changes nothing. Do **not** clamp it to what is left. The
  body includes \`remainingPaise\`.
- **Over-refund is refused whole.** A refund larger than \`refundablePaise\`
  returns \`409\` and changes nothing.
- **Refunding before anything is captured is \`409\`**, however large the
  authorization.
- **Void is legal only from \`AUTHORIZED\`.** After any capture, \`POST /void\`
  is \`409\`. Voiding an already-\`VOIDED\` payment is \`200\` and changes nothing.
- Capture after void is \`409\`.
- A zero or negative \`amountPaise\` anywhere is \`400\`.
- Any operation naming a payment that does not exist is \`404\`.

## Validation

\`400\` with a JSON body containing an \`error\` string when \`id\` is missing or
not a string, or \`amountPaise\` is missing, not an integer, zero or negative.

${STATEFUL_NOTE}

${SCORING_NOTE}
`.trim(),
    tests: [
      healthTest,
      resetTest,
      {
        name: 'authorize then read back the opening state',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/payments',
          body: { id: 'pay_1', amountPaise: 100000 },
          expect: { status: 201 },
        },
      },
      {
        name: 'a fresh authorization has nothing captured and nothing refundable',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/payments/pay_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'amountPaise', equals: 100000 },
              { path: 'capturedPaise', equals: 0 },
              { path: 'remainingPaise', equals: 100000 },
              { path: 'refundedPaise', equals: 0 },
              { path: 'refundablePaise', equals: 0 },
              { path: 'status', equals: 'AUTHORIZED' },
            ],
          },
        },
      },
      {
        name: 'refunding before any capture is refused',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/payments/pay_1/refunds',
          body: { id: 'ref_early', amountPaise: 1000 },
          expect: { status: 409 },
        },
      },
      {
        name: 'a partial capture moves the ledger and the status',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/payments/pay_1/captures',
          body: { id: 'cap_1', amountPaise: 40000 },
          expect: { status: 201 },
        },
      },
      {
        // THE discriminator: refundable tracks CAPTURED, not AUTHORIZED.
        name: 'refundable follows the captured amount, not the authorized amount',
        weight: 5,
        spec: {
          method: 'GET',
          path: '/payments/pay_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'capturedPaise', equals: 40000 },
              { path: 'remainingPaise', equals: 60000 },
              { path: 'refundablePaise', equals: 40000 },
              { path: 'status', equals: 'PARTIALLY_CAPTURED' },
            ],
          },
        },
      },
      {
        name: 'a refund above the captured amount is refused whole',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/payments/pay_1/refunds',
          body: { id: 'ref_over', amountPaise: 100000 },
          expect: { status: 409 },
        },
      },
      {
        name: 'the refused refund changed nothing',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/payments/pay_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'refundedPaise', equals: 0 },
              { path: 'refundablePaise', equals: 40000 },
            ],
          },
        },
      },
      {
        name: 'an over-capture is refused whole rather than clamped',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/payments/pay_1/captures',
          body: { id: 'cap_over', amountPaise: 90000 },
          expect: {
            status: 422,
            jsonPath: [{ path: 'remainingPaise', equals: 60000 }],
          },
        },
      },
      {
        name: 'void after a capture is a conflict',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/payments/pay_1/void',
          expect: { status: 409 },
        },
      },
      {
        name: 'capturing the remainder completes the capture',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/payments/pay_1/captures',
          body: { id: 'cap_2', amountPaise: 60000 },
          expect: { status: 201 },
        },
      },
      {
        name: 'status is CAPTURED exactly when nothing remains',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/payments/pay_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'remainingPaise', equals: 0 },
              { path: 'refundablePaise', equals: 100000 },
              { path: 'status', equals: 'CAPTURED' },
            ],
          },
        },
      },
      {
        name: 'refunding everything flips the status exactly at equality',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/payments/pay_1/refunds',
          body: { id: 'ref_all', amountPaise: 100000 },
          expect: { status: 201 },
        },
      },
      {
        name: 'a fully refunded payment reports REFUNDED and nothing refundable',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/payments/pay_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'refundedPaise', equals: 100000 },
              { path: 'refundablePaise', equals: 0 },
              { path: 'status', equals: 'REFUNDED' },
            ],
          },
        },
      },
      {
        name: 'authorize a second payment that will only ever be voided',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/payments',
          body: { id: 'pay_void', amountPaise: 5000 },
          expect: { status: 201 },
        },
      },
      {
        name: 'voiding twice succeeds both times',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/payments/pay_void/void',
          expect: {
            status: 200,
            jsonPath: [{ path: 'status', equals: 'VOIDED' }],
          },
        },
      },
      {
        name: 'an unknown payment is 404, not 400',
        weight: 2,
        spec: {
          method: 'GET',
          path: '/payments/pay_nope',
          expect: { status: 404 },
        },
      },
      {
        name: 'a zero capture is rejected',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/payments/pay_void/captures',
          body: { id: 'cap_zero', amountPaise: 0 },
          expect: { status: 400 },
        },
      },
    ],
  },

  // ─────────────────────────────── Commerce ───────────────────────────────
  {
    slug: 'inventory-holds',
    visibility: 'DRAFT',
    title: 'Inventory Holds',
    difficulty: 'Hard',
    contractSpec: DEFAULT_CONTRACT,
    statementMarkdown: `
# Inventory Holds

Ship the API a shop uses to hold stock while a customer pays, then either
confirm the sale or give the stock back. It must never oversell.

## \`GET /health\`

\`\`\`json
{ "status": "ok" }
\`\`\`

## Endpoints

\`\`\`
POST /skus              { "id", "totalQuantity" }
POST /holds             { "id", "skuId", "quantity" }
POST /holds/:id/confirm
POST /holds/:id/release
GET  /skus/:id
\`\`\`

\`GET /skus/:id\` returns \`200\`:

\`\`\`json
{ "id": "sku_1", "totalQuantity": 10, "available": 7, "held": 3, "sold": 0 }
\`\`\`

## The invariant — this is the specification

After **every** operation:

\`\`\`
available + held + sold === totalQuantity
\`\`\`

- A hold moves quantity \`available → held\`.
- Confirm moves it \`held → sold\`.
- Release moves it \`held → available\`.

## Rules

- A hold for more than \`available\` returns \`409\` with \`available\` in the
  body, and changes nothing.
- **Releasing an already-released hold returns \`200\` and credits nothing.**
  Retrying an abandoned checkout must not invent stock. This is the rule most
  implementations get wrong.
- Confirm after release is \`409\`. Release after confirm is \`409\`.
- Confirming an already-confirmed hold returns \`200\` and changes nothing.
- A hold of quantity \`0\` or less is \`400\`.
- A hold against an unknown SKU is \`404\`. Any operation on an unknown hold is
  \`404\`.
- \`POST /skus\` with an id that already exists is an idempotent no-op returning
  the existing SKU — it does **not** reset or add quantity.
- Holding exactly \`available\` must succeed and drive \`available\` to \`0\`.

${STATEFUL_NOTE}

${SCORING_NOTE}
`.trim(),
    tests: [
      healthTest,
      resetTest,
      {
        name: 'create a sku',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/skus',
          body: { id: 'sku_1', totalQuantity: 10 },
          expect: { status: 201 },
        },
      },
      {
        name: 'a new sku is entirely available',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/skus/sku_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'available', equals: 10 },
              { path: 'held', equals: 0 },
              { path: 'sold', equals: 0 },
            ],
          },
        },
      },
      {
        name: 'a hold moves stock from available to held',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/holds',
          body: { id: 'hold_1', skuId: 'sku_1', quantity: 3 },
          expect: { status: 201 },
        },
      },
      {
        name: 'the three buckets still sum to the total',
        weight: 4,
        spec: {
          method: 'GET',
          path: '/skus/sku_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'available', equals: 7 },
              { path: 'held', equals: 3 },
              { path: 'sold', equals: 0 },
            ],
          },
        },
      },
      {
        name: 'a hold beyond what is available is refused with the availability',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/holds',
          body: { id: 'hold_big', skuId: 'sku_1', quantity: 8 },
          expect: { status: 409, jsonPath: [{ path: 'available', equals: 7 }] },
        },
      },
      {
        name: 'releasing returns the stock',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/holds/hold_1/release',
          expect: { status: 200 },
        },
      },
      {
        // THE discriminator: a repeated release must not credit twice.
        name: 'releasing the same hold again does not invent stock',
        weight: 6,
        spec: {
          method: 'POST',
          path: '/holds/hold_1/release',
          expect: { status: 200 },
        },
      },
      {
        name: 'the invariant survived the double release',
        weight: 5,
        spec: {
          method: 'GET',
          path: '/skus/sku_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'available', equals: 10 },
              { path: 'held', equals: 0 },
              { path: 'sold', equals: 0 },
            ],
          },
        },
      },
      {
        name: 'confirming a released hold is a conflict',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/holds/hold_1/confirm',
          expect: { status: 409 },
        },
      },
      {
        name: 'a hold for exactly the available quantity succeeds',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/holds',
          body: { id: 'hold_all', skuId: 'sku_1', quantity: 10 },
          expect: { status: 201 },
        },
      },
      {
        name: 'confirming turns held stock into sold stock',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/holds/hold_all/confirm',
          expect: { status: 200 },
        },
      },
      {
        name: 'a sold-out sku has nothing available and nothing held',
        weight: 4,
        spec: {
          method: 'GET',
          path: '/skus/sku_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'available', equals: 0 },
              { path: 'held', equals: 0 },
              { path: 'sold', equals: 10 },
            ],
          },
        },
      },
      {
        name: 'releasing a confirmed hold is a conflict',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/holds/hold_all/release',
          expect: { status: 409 },
        },
      },
      {
        name: 're-posting an existing sku does not add quantity',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/skus',
          body: { id: 'sku_1', totalQuantity: 99 },
          expect: {
            status: 200,
            jsonPath: [{ path: 'totalQuantity', equals: 10 }],
          },
        },
      },
      {
        name: 'a hold against an unknown sku is 404',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/holds',
          body: { id: 'hold_x', skuId: 'sku_nope', quantity: 1 },
          expect: { status: 404 },
        },
      },
      {
        name: 'a zero-quantity hold is rejected',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/holds',
          body: { id: 'hold_zero', skuId: 'sku_1', quantity: 0 },
          expect: { status: 400 },
        },
      },
    ],
  },

  {
    slug: 'coupon-engine',
    visibility: 'DRAFT',
    title: 'Coupon Engine',
    difficulty: 'Hard',
    contractSpec: DEFAULT_CONTRACT,
    statementMarkdown: `
# Coupon Engine

Ship the promotions API behind a checkout page. The storefront calls \`/quote\`
on every change to the basket; it calls \`/redeem\` once, when the customer pays.

All money is an integer number of **paise**.

## \`GET /health\`

\`\`\`json
{ "status": "ok" }
\`\`\`

## Endpoints

\`\`\`
POST /coupons   { "code", "type", "value", "maxRedemptions",
                  "perCustomerLimit", "minSubtotalPaise", "stackable" }
POST /quote     { "customerId", "subtotalPaise", "codes": [] }
POST /redeem    { "customerId", "subtotalPaise", "codes": [] }
GET  /coupons/:code
\`\`\`

\`type\` is \`PERCENT\` or \`FIXED\`. For \`PERCENT\`, \`value\` is a whole
percentage (\`10\` means 10%). For \`FIXED\`, \`value\` is in paise.

\`/quote\` and \`/redeem\` both return \`200\`:

\`\`\`json
{
  "subtotalPaise": 100000,
  "applied": ["SAVE10"],
  "rejected": [{ "code": "VIP", "reason": "MIN_SUBTOTAL" }],
  "totalPaise": 90000
}
\`\`\`

## The one rule that matters most

**\`/quote\` must have no side effects. \`/redeem\` must.**

A storefront calls \`/quote\` constantly. If quoting consumes a redemption, you
burn coupons for customers who never checked out, and the limits become
meaningless. Everything else about the two endpoints is identical.

## Discount order

1. Apply every accepted \`PERCENT\` coupon **to the original subtotal**, never to
   an already-discounted running total. Round **down** to whole paise.
2. Then subtract every accepted \`FIXED\` coupon.
3. \`totalPaise\` never goes below \`0\`.

## Stacking

At most **one** non-stackable coupon can apply. If several non-stackable coupons
are offered, the one producing the **largest discount** applies and the rest are
rejected with \`NOT_STACKABLE\`.

## Rejection

An unacceptable coupon is **not** an error — the rest of the basket still prices.
It appears in \`rejected\`, in the **same order it appeared in the input**, with
exactly one of these reasons:

| reason | when |
|---|---|
| \`UNKNOWN_CODE\` | no such coupon |
| \`MIN_SUBTOTAL\` | \`subtotalPaise\` is below the coupon's minimum |
| \`CUSTOMER_LIMIT\` | this customer has already redeemed it \`perCustomerLimit\` times |
| \`GLOBAL_LIMIT\` | it has been redeemed \`maxRedemptions\` times in total |
| \`NOT_STACKABLE\` | a better non-stackable coupon won |

\`minSubtotalPaise\` is **inclusive**: a subtotal exactly equal to it is accepted.
The limits are exclusive ceilings: a customer who has reached
\`perCustomerLimit\` is refused.

\`GET /coupons/:code\` returns \`{ "code", "redemptions" }\`, or \`404\`.

An empty \`codes\` array is valid: \`applied\` and \`rejected\` are empty and
\`totalPaise\` equals \`subtotalPaise\`.

## Validation

\`400\` with an \`error\` string when \`customerId\` is missing, \`subtotalPaise\`
is missing/not an integer/negative, or \`codes\` is missing or not an array.

${STATEFUL_NOTE}

${SCORING_NOTE}
`.trim(),
    tests: [
      healthTest,
      resetTest,
      {
        name: 'create a stackable percentage coupon',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/coupons',
          body: {
            code: 'SAVE10',
            type: 'PERCENT',
            value: 10,
            maxRedemptions: 100,
            perCustomerLimit: 1,
            minSubtotalPaise: 0,
            stackable: true,
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'create a fixed coupon with a minimum subtotal',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/coupons',
          body: {
            code: 'FLAT50',
            type: 'FIXED',
            value: 5000,
            maxRedemptions: 100,
            perCustomerLimit: 5,
            minSubtotalPaise: 50000,
            stackable: true,
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'percent applies to the original subtotal, then fixed is subtracted',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/quote',
          body: {
            customerId: 'cust_1',
            subtotalPaise: 100000,
            codes: ['SAVE10', 'FLAT50'],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'totalPaise', equals: 85000 },
              { path: 'applied', equals: ['SAVE10', 'FLAT50'] },
            ],
          },
        },
      },
      {
        // THE discriminator: quoting must not consume anything.
        name: 'quoting did not consume a redemption',
        weight: 6,
        spec: {
          method: 'GET',
          path: '/coupons/SAVE10',
          expect: {
            status: 200,
            jsonPath: [{ path: 'redemptions', equals: 0 }],
          },
        },
      },
      {
        name: 'a subtotal below the minimum is rejected with a reason, not an error',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/quote',
          body: {
            customerId: 'cust_1',
            subtotalPaise: 20000,
            codes: ['FLAT50'],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'totalPaise', equals: 20000 },
              { path: 'rejected[0].code', equals: 'FLAT50' },
              { path: 'rejected[0].reason', equals: 'MIN_SUBTOTAL' },
            ],
          },
        },
      },
      {
        name: 'a subtotal exactly at the minimum is accepted',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/quote',
          body: {
            customerId: 'cust_1',
            subtotalPaise: 50000,
            codes: ['FLAT50'],
          },
          expect: {
            status: 200,
            jsonPath: [{ path: 'totalPaise', equals: 45000 }],
          },
        },
      },
      {
        name: 'an unknown code is rejected without failing the basket',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/quote',
          body: {
            customerId: 'cust_1',
            subtotalPaise: 100000,
            codes: ['NOPE', 'SAVE10'],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'rejected[0].code', equals: 'NOPE' },
              { path: 'rejected[0].reason', equals: 'UNKNOWN_CODE' },
              { path: 'applied', equals: ['SAVE10'] },
              { path: 'totalPaise', equals: 90000 },
            ],
          },
        },
      },
      {
        name: 'redeeming consumes exactly one redemption',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/redeem',
          body: {
            customerId: 'cust_1',
            subtotalPaise: 100000,
            codes: ['SAVE10'],
          },
          expect: {
            status: 200,
            jsonPath: [{ path: 'totalPaise', equals: 90000 }],
          },
        },
      },
      {
        name: 'the redemption was recorded',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/coupons/SAVE10',
          expect: {
            status: 200,
            jsonPath: [{ path: 'redemptions', equals: 1 }],
          },
        },
      },
      {
        name: 'a customer at their per-customer limit is refused',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/quote',
          body: {
            customerId: 'cust_1',
            subtotalPaise: 100000,
            codes: ['SAVE10'],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'rejected[0].reason', equals: 'CUSTOMER_LIMIT' },
              { path: 'totalPaise', equals: 100000 },
            ],
          },
        },
      },
      {
        name: 'a different customer is unaffected by the first one',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/quote',
          body: {
            customerId: 'cust_2',
            subtotalPaise: 100000,
            codes: ['SAVE10'],
          },
          expect: {
            status: 200,
            jsonPath: [{ path: 'totalPaise', equals: 90000 }],
          },
        },
      },
      {
        name: 'create two competing non-stackable coupons',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/coupons',
          body: {
            code: 'BIG',
            type: 'PERCENT',
            value: 30,
            maxRedemptions: 100,
            perCustomerLimit: 5,
            minSubtotalPaise: 0,
            stackable: false,
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'create the weaker non-stackable coupon',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/coupons',
          body: {
            code: 'SMALL',
            type: 'PERCENT',
            value: 5,
            maxRedemptions: 100,
            perCustomerLimit: 5,
            minSubtotalPaise: 0,
            stackable: false,
          },
          expect: { status: 201 },
        },
      },
      {
        // The second discriminator: the BEST non-stackable wins, not the first.
        name: 'the largest non-stackable discount wins regardless of input order',
        weight: 6,
        spec: {
          method: 'POST',
          path: '/quote',
          body: {
            customerId: 'cust_3',
            subtotalPaise: 100000,
            codes: ['SMALL', 'BIG'],
          },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'applied', equals: ['BIG'] },
              { path: 'rejected[0].code', equals: 'SMALL' },
              { path: 'rejected[0].reason', equals: 'NOT_STACKABLE' },
              { path: 'totalPaise', equals: 70000 },
            ],
          },
        },
      },
      {
        name: 'percentage rounding is floored to whole paise',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/quote',
          body: { customerId: 'cust_4', subtotalPaise: 1005, codes: ['BIG'] },
          expect: {
            status: 200,
            jsonPath: [{ path: 'totalPaise', equals: 704 }],
          },
        },
      },
      {
        name: 'an empty code list prices the basket unchanged',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/quote',
          body: { customerId: 'cust_5', subtotalPaise: 12345, codes: [] },
          expect: {
            status: 200,
            jsonPath: [
              { path: 'totalPaise', equals: 12345 },
              { path: 'applied', equals: [] },
            ],
          },
        },
      },
      {
        name: 'a missing codes array is rejected',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/quote',
          body: { customerId: 'cust_6', subtotalPaise: 1000 },
          expect: { status: 400 },
        },
      },
    ],
  },

  // ─────────────────────────────── Scheduling ─────────────────────────────
  {
    slug: 'booking-slots',
    visibility: 'DRAFT',
    title: 'Booking Engine',
    difficulty: 'Hard',
    contractSpec: DEFAULT_CONTRACT,
    statementMarkdown: `
# Booking Engine

Ship the API behind a reservable resource — a meeting room, a chair, a delivery
slot. It must never double-book, and a cancellation must free the time.

Every instant is an **absolute ISO-8601 UTC string** supplied in the request.
Nothing depends on the current time.

## \`GET /health\`

\`\`\`json
{ "status": "ok" }
\`\`\`

## Endpoints

\`\`\`
POST /resources                 { "id", "openFrom", "openUntil" }
POST /bookings                  { "id", "resourceId", "startAt", "endAt" }
POST /bookings/:id/cancel
GET  /bookings/:id
GET  /resources/:id/availability?from=&to=
\`\`\`

\`GET /resources/:id/availability\` returns \`200\`:

\`\`\`json
{ "free": [{ "startAt": "2026-03-01T09:00:00Z", "endAt": "2026-03-01T12:00:00Z" }] }
\`\`\`

## Intervals are half-open — read this twice

Every interval is \`[startAt, endAt)\`: the start is included, the end is not.

**A booking that ends exactly when another begins does not conflict.** 09:00–10:00
and 10:00–11:00 are both fine. This is the single most common mistake in
scheduling code.

## Rules

- An overlapping booking returns \`409\`, changes nothing, and names the clashing
  booking as \`conflictId\` in the body.
- A booking that is not entirely inside the resource's \`[openFrom, openUntil)\`
  returns \`422\`.
- \`endAt\` less than or equal to \`startAt\` is \`400\`.
- Cancelling frees the interval immediately; a previously-conflicting booking
  then succeeds.
- Cancelling an already-cancelled booking returns \`200\` and changes nothing.
- \`GET /bookings/:id\` returns \`{ "id", "resourceId", "startAt", "endAt",
  "status" }\` where status is \`CONFIRMED\` or \`CANCELLED\`.
- Unknown resource or booking is \`404\`.

## Availability

\`free\` lists the gaps inside \`[from, to)\` that are within opening hours and
not booked.

- Ascending by \`startAt\`.
- **Adjacent gaps are merged into one entry.** Never return two touching ranges.
- A fully-booked window returns \`{ "free": [] }\` — not an error.
- Cancelled bookings do not occupy time.

${STATEFUL_NOTE}

${SCORING_NOTE}
`.trim(),
    tests: [
      healthTest,
      resetTest,
      {
        name: 'create a resource with opening hours',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/resources',
          body: {
            id: 'room_1',
            openFrom: '2026-03-01T09:00:00Z',
            openUntil: '2026-03-01T17:00:00Z',
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'a booking inside opening hours is accepted',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/bookings',
          body: {
            id: 'bk_1',
            resourceId: 'room_1',
            startAt: '2026-03-01T09:00:00Z',
            endAt: '2026-03-01T10:00:00Z',
          },
          expect: { status: 201 },
        },
      },
      {
        // THE discriminator: half-open intervals.
        name: 'a back-to-back booking does not conflict',
        weight: 6,
        spec: {
          method: 'POST',
          path: '/bookings',
          body: {
            id: 'bk_2',
            resourceId: 'room_1',
            startAt: '2026-03-01T10:00:00Z',
            endAt: '2026-03-01T11:00:00Z',
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'a one-minute overlap does conflict',
        weight: 5,
        spec: {
          method: 'POST',
          path: '/bookings',
          body: {
            id: 'bk_overlap',
            resourceId: 'room_1',
            startAt: '2026-03-01T10:59:00Z',
            endAt: '2026-03-01T12:00:00Z',
          },
          expect: {
            status: 409,
            jsonPath: [{ path: 'conflictId', equals: 'bk_2' }],
          },
        },
      },
      {
        name: 'a booking that fully contains an existing one conflicts',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/bookings',
          body: {
            id: 'bk_engulf',
            resourceId: 'room_1',
            startAt: '2026-03-01T09:30:00Z',
            endAt: '2026-03-01T10:30:00Z',
          },
          expect: { status: 409 },
        },
      },
      {
        name: 'a booking outside opening hours is unprocessable',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/bookings',
          body: {
            id: 'bk_late',
            resourceId: 'room_1',
            startAt: '2026-03-01T16:00:00Z',
            endAt: '2026-03-01T18:00:00Z',
          },
          expect: { status: 422 },
        },
      },
      {
        name: 'an inverted interval is rejected',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/bookings',
          body: {
            id: 'bk_bad',
            resourceId: 'room_1',
            startAt: '2026-03-01T12:00:00Z',
            endAt: '2026-03-01T12:00:00Z',
          },
          expect: { status: 400 },
        },
      },
      {
        name: 'availability merges the untouched remainder into one range',
        weight: 5,
        spec: {
          method: 'GET',
          path: '/resources/room_1/availability?from=2026-03-01T09:00:00Z&to=2026-03-01T17:00:00Z',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'free.length', equals: 1 },
              { path: 'free[0].startAt', equals: '2026-03-01T11:00:00Z' },
              { path: 'free[0].endAt', equals: '2026-03-01T17:00:00Z' },
            ],
          },
        },
      },
      {
        name: 'cancelling a booking succeeds',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/bookings/bk_1/cancel',
          expect: { status: 200 },
        },
      },
      {
        name: 'a cancelled booking reports its status',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/bookings/bk_1',
          expect: {
            status: 200,
            jsonPath: [{ path: 'status', equals: 'CANCELLED' }],
          },
        },
      },
      {
        name: 'cancelling twice is idempotent',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/bookings/bk_1/cancel',
          expect: { status: 200 },
        },
      },
      {
        name: 'the cancelled interval is bookable again',
        weight: 5,
        spec: {
          method: 'POST',
          path: '/bookings',
          body: {
            id: 'bk_reuse',
            resourceId: 'room_1',
            startAt: '2026-03-01T09:00:00Z',
            endAt: '2026-03-01T10:00:00Z',
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'availability reflects the cancellation and the rebooking',
        weight: 4,
        spec: {
          method: 'GET',
          path: '/resources/room_1/availability?from=2026-03-01T09:00:00Z&to=2026-03-01T17:00:00Z',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'free.length', equals: 1 },
              { path: 'free[0].startAt', equals: '2026-03-01T11:00:00Z' },
            ],
          },
        },
      },
      {
        name: 'an unknown resource is 404',
        weight: 2,
        spec: {
          method: 'GET',
          path: '/resources/room_nope/availability?from=2026-03-01T09:00:00Z&to=2026-03-01T17:00:00Z',
          expect: { status: 404 },
        },
      },
      {
        name: 'an unknown booking is 404',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/bookings/bk_nope/cancel',
          expect: { status: 404 },
        },
      },
    ],
  },

  // ───────────────────────────── Infrastructure ───────────────────────────
  {
    slug: 'webhook-receiver',
    visibility: 'DRAFT',
    title: 'Webhook Receiver',
    difficulty: 'Hard',
    contractSpec: DEFAULT_CONTRACT,
    statementMarkdown: `
# Webhook Receiver

Ship the endpoint that receives webhooks from a payment provider. The provider
signs every delivery, **retries anything that is not a 2xx**, and occasionally
delivers events out of order.

## \`GET /health\`

\`\`\`json
{ "status": "ok" }
\`\`\`

## \`POST /webhooks\`

Headers: \`X-Event-Id\`, \`X-Signature\`.

Body:

\`\`\`json
{ "payload": "{\\"type\\":\\"order.updated\\",\\"orderId\\":\\"ord_1\\",\\"status\\":\\"PAID\\",\\"version\\":2}" }
\`\`\`

\`payload\` is a **JSON string**, not an object. Parse it yourself.

### The signature

\`X-Signature\` is \`HMAC-SHA256\` of the **\`payload\` string exactly as sent**,
hex-encoded, using the shared secret:

\`\`\`
whsec_blitzit_demo_2026
\`\`\`

**Verify the signature before you parse or apply anything.**

## The rules — each one exists because a real integration broke

| Situation | Response | Why |
|---|---|---|
| Valid signature, new event | \`200\` | applied |
| **Duplicate \`X-Event-Id\`** | **\`200\`** | applied **once**; a non-2xx makes the provider retry forever |
| Invalid or missing signature | \`401\` | and **nothing** is applied |
| \`version\` ≤ the order's current version | \`200\` | ignored; an old delivery must never roll state backwards |
| Unrecognised \`type\` | \`202\` | accepted and ignored |

A duplicate returning \`409\` is the classic mistake: the provider treats it as a
failure and redelivers, forever.

## Payload types

- \`order.updated\` — \`{ type, orderId, status, version }\`. Creates the order if
  it does not exist, otherwise updates it **only if \`version\` is strictly
  greater** than the stored version.
- Anything else — unrecognised.

## Reads

\`\`\`
GET /orders/:id        -> { "id", "status", "version" }   404 if unknown
GET /webhooks/events   -> { "processed": ["evt_1", "evt_2"] }
\`\`\`

\`processed\` lists each **applied** event id **once**, in arrival order. A
rejected (\`401\`), duplicate, stale or unrecognised delivery does not add an
entry.

${STATEFUL_NOTE}

${SCORING_NOTE}
`.trim(),
    tests: [
      healthTest,
      resetTest,
      delivery({
        name: 'a correctly signed event is accepted',
        weight: 4,
        eventId: 'evt_1',
        payload: {
          type: 'order.updated',
          orderId: 'ord_1',
          status: 'PAID',
          version: 2,
        },
        status: 200,
      }),
      {
        name: 'the order was created at the delivered version',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/orders/ord_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'status', equals: 'PAID' },
              { path: 'version', equals: 2 },
            ],
          },
        },
      },
      {
        // THE discriminator: a duplicate must be a 2xx, or the provider retries forever.
        name: 'a redelivered event is answered 200, not 409',
        weight: 6,
        spec: {
          method: 'POST',
          path: '/webhooks',
          headers: {
            'X-Event-Id': 'evt_1',
            'X-Signature': sign(
              JSON.stringify({
                type: 'order.updated',
                orderId: 'ord_1',
                status: 'PAID',
                version: 2,
              }),
            ),
          },
          body: {
            payload: JSON.stringify({
              type: 'order.updated',
              orderId: 'ord_1',
              status: 'PAID',
              version: 2,
            }),
          },
          expect: { status: 200 },
        },
      },
      delivery({
        name: 'a tampered payload is rejected as unauthorised',
        weight: 5,
        eventId: 'evt_tamper',
        payload: {
          type: 'order.updated',
          orderId: 'ord_1',
          status: 'REFUNDED',
          version: 9,
        },
        signature: sign('{"not":"the payload that was sent"}'),
        status: 401,
      }),
      {
        name: 'the tampered delivery changed nothing',
        weight: 5,
        spec: {
          method: 'GET',
          path: '/orders/ord_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'status', equals: 'PAID' },
              { path: 'version', equals: 2 },
            ],
          },
        },
      },
      delivery({
        name: 'a delivery with no signature at all is rejected',
        weight: 4,
        eventId: 'evt_nosig',
        payload: {
          type: 'order.updated',
          orderId: 'ord_1',
          status: 'CANCELLED',
          version: 5,
        },
        omitSignature: true,
        status: 401,
      }),
      delivery({
        name: 'a stale version is accepted but ignored',
        weight: 5,
        eventId: 'evt_stale',
        payload: {
          type: 'order.updated',
          orderId: 'ord_1',
          status: 'PENDING',
          version: 1,
        },
        status: 200,
      }),
      {
        name: 'the stale delivery did not roll the order backwards',
        weight: 5,
        spec: {
          method: 'GET',
          path: '/orders/ord_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'status', equals: 'PAID' },
              { path: 'version', equals: 2 },
            ],
          },
        },
      },
      delivery({
        name: 'an equal version is also ignored',
        weight: 4,
        eventId: 'evt_equal',
        payload: {
          type: 'order.updated',
          orderId: 'ord_1',
          status: 'SOMETHING_ELSE',
          version: 2,
        },
        status: 200,
      }),
      {
        name: 'an equal version did not overwrite the status',
        weight: 4,
        spec: {
          method: 'GET',
          path: '/orders/ord_1',
          expect: {
            status: 200,
            jsonPath: [{ path: 'status', equals: 'PAID' }],
          },
        },
      },
      delivery({
        name: 'a newer version does update the order',
        weight: 4,
        eventId: 'evt_new',
        payload: {
          type: 'order.updated',
          orderId: 'ord_1',
          status: 'SHIPPED',
          version: 3,
        },
        status: 200,
      }),
      {
        name: 'the newer version was applied',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/orders/ord_1',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'status', equals: 'SHIPPED' },
              { path: 'version', equals: 3 },
            ],
          },
        },
      },
      delivery({
        name: 'an unrecognised event type is accepted and ignored',
        weight: 4,
        eventId: 'evt_unknown',
        payload: { type: 'invoice.exploded', invoiceId: 'inv_1' },
        status: 202,
      }),
      {
        name: 'only the applied events are listed, once each, in order',
        weight: 5,
        spec: {
          method: 'GET',
          path: '/webhooks/events',
          expect: {
            status: 200,
            jsonPath: [{ path: 'processed', equals: ['evt_1', 'evt_new'] }],
          },
        },
      },
      {
        name: 'an unknown order is 404',
        weight: 2,
        spec: {
          method: 'GET',
          path: '/orders/ord_nope',
          expect: { status: 404 },
        },
      },
    ],
  },

  {
    slug: 'api-key-scopes',
    visibility: 'DRAFT',
    title: 'API Keys, Scopes and Quota',
    difficulty: 'Hard',
    contractSpec: DEFAULT_CONTRACT,
    statementMarkdown: `
# API Keys, Scopes and Quota

Ship the API-credential system you would hand to customers: scoped keys,
rotation without downtime, revocation, and a per-key request quota.

## \`GET /health\`

\`\`\`json
{ "status": "ok" }
\`\`\`

## Endpoints

\`\`\`
POST /keys                     { "id", "secret", "scopes": [], "quota" }
POST /keys/:id/rotate          { "secret" }
POST /keys/:id/revoke-previous
POST /keys/:id/revoke
GET  /keys/:id
GET  /resource                 Authorization: Bearer <secret>
POST /resource                 Authorization: Bearer <secret>
\`\`\`

The secret is **supplied by you, the caller** — this API never generates one.

## Scopes

\`read\`, \`write\`, \`admin\`. \`admin\` implies both \`read\` and \`write\`.

- \`GET /resource\` requires \`read\`.
- \`POST /resource\` requires \`write\`.

## Authenticate, then authorize — in that order

| Situation | Response |
|---|---|
| Unknown or revoked secret | **\`401\`** |
| Valid secret, missing the required scope | **\`403\`** |

Answering \`403\` for a secret that does not exist tells an attacker which keys
are real. Get this order right.

## Rotation

\`POST /keys/:id/rotate\` sets a new secret. **Both** the old and the new secret
authenticate until \`POST /keys/:id/revoke-previous\`, after which only the new
one does. \`revoke-previous\` before any rotation is a no-op returning \`200\`.

## \`GET /keys/:id\`

Returns \`{ "id", "scopes", "quota", "remaining", "rotated" }\`.

**It must never include any secret, current or previous.**

## Quota

Each key may make \`quota\` requests to \`/resource\`. Every response from
\`/resource\` includes \`remaining\`.

- A request that **did work** consumes one — including one that fails your own
  validation.
- **A \`429\` does not consume quota.** A rejected request must not dig the hole
  deeper.
- A \`401\` and a \`403\` consume nothing either — neither did any work.
- When the quota is exhausted, \`/resource\` returns \`429\` with
  \`"remaining": 0\`.
- Quotas are per key. One key running out never affects another.

Revoking an already-revoked key returns \`200\`.

${STATEFUL_NOTE}

${SCORING_NOTE}
`.trim(),
    tests: [
      healthTest,
      resetTest,
      {
        name: 'create a read-only key with a small quota',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/keys',
          body: {
            id: 'key_r',
            secret: 'sec_read_1',
            scopes: ['read'],
            quota: 2,
          },
          expect: { status: 201 },
        },
      },
      {
        // A classic leak: the secret must never come back on a read.
        name: 'reading a key never returns its secret',
        weight: 6,
        spec: {
          method: 'GET',
          path: '/keys/key_r',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'scopes', equals: ['read'] },
              { path: 'quota', equals: 2 },
              { path: 'secret', equals: null },
              { path: 'previousSecret', equals: null },
            ],
          },
        },
      },
      {
        name: 'a valid read key can read, and sees its quota decrease',
        weight: 4,
        spec: {
          method: 'GET',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_read_1' },
          expect: { status: 200, jsonPath: [{ path: 'remaining', equals: 1 }] },
        },
      },
      {
        // THE ordering discriminator: unknown credential is 401, never 403.
        name: 'an unknown secret is 401, not 403',
        weight: 6,
        spec: {
          method: 'GET',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_does_not_exist' },
          expect: { status: 401 },
        },
      },
      {
        name: 'a read key writing is 403',
        weight: 5,
        spec: {
          method: 'POST',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_read_1' },
          body: { anything: true },
          expect: { status: 403 },
        },
      },
      {
        name: 'neither the 401 nor the 403 consumed any quota',
        weight: 6,
        spec: {
          method: 'GET',
          path: '/keys/key_r',
          expect: { status: 200, jsonPath: [{ path: 'remaining', equals: 1 }] },
        },
      },
      {
        name: 'the last permitted request succeeds',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_read_1' },
          expect: { status: 200, jsonPath: [{ path: 'remaining', equals: 0 }] },
        },
      },
      {
        name: 'the next request is rate limited',
        weight: 4,
        spec: {
          method: 'GET',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_read_1' },
          expect: { status: 429, jsonPath: [{ path: 'remaining', equals: 0 }] },
        },
      },
      {
        // The quota discriminator: a 429 must not consume quota.
        name: 'a second rate-limited request still reports zero, not negative',
        weight: 6,
        spec: {
          method: 'GET',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_read_1' },
          expect: { status: 429, jsonPath: [{ path: 'remaining', equals: 0 }] },
        },
      },
      {
        name: 'create a second key to prove quotas are isolated',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/keys',
          body: {
            id: 'key_a',
            secret: 'sec_admin_1',
            scopes: ['admin'],
            quota: 5,
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'the exhausted key did not affect the new one',
        weight: 4,
        spec: {
          method: 'GET',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_admin_1' },
          expect: { status: 200, jsonPath: [{ path: 'remaining', equals: 4 }] },
        },
      },
      {
        name: 'admin implies write',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_admin_1' },
          body: { anything: true },
          expect: { status: 200 },
        },
      },
      {
        name: 'rotating sets a new secret',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/keys/key_a/rotate',
          body: { secret: 'sec_admin_2' },
          expect: { status: 200 },
        },
      },
      {
        name: 'the new secret works immediately',
        weight: 4,
        spec: {
          method: 'GET',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_admin_2' },
          expect: { status: 200 },
        },
      },
      {
        name: 'and the old secret still works — that is the point of rotation',
        weight: 5,
        spec: {
          method: 'GET',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_admin_1' },
          expect: { status: 200 },
        },
      },
      {
        name: 'revoking the previous secret retires it',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/keys/key_a/revoke-previous',
          expect: { status: 200 },
        },
      },
      {
        name: 'the retired secret is now unauthenticated',
        weight: 5,
        spec: {
          method: 'GET',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_admin_1' },
          expect: { status: 401 },
        },
      },
      {
        name: 'the current secret is unaffected',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_admin_2' },
          expect: { status: 200 },
        },
      },
      {
        name: 'revoking the key entirely',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/keys/key_a/revoke',
          expect: { status: 200 },
        },
      },
      {
        name: 'a revoked key is 401, not 403',
        weight: 5,
        spec: {
          method: 'GET',
          path: '/resource',
          headers: { Authorization: 'Bearer sec_admin_2' },
          expect: { status: 401 },
        },
      },
      {
        name: 'revoking twice is idempotent',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/keys/key_a/revoke',
          expect: { status: 200 },
        },
      },
      {
        name: 'a missing Authorization header is 401',
        weight: 2,
        spec: {
          method: 'GET',
          path: '/resource',
          expect: { status: 401 },
        },
      },
    ],
  },

  // ─────────────────────────────── Identity ───────────────────────────────
  {
    slug: 'expense-approvals',
    visibility: 'DRAFT',
    title: 'Expense Approvals',
    difficulty: 'Hard',
    contractSpec: DEFAULT_CONTRACT,
    statementMarkdown: `
# Expense Approvals

Ship the approval API for a multi-tenant expense tool. Who may approve what, up
to how much, and an audit trail finance can defend afterwards.

All money is an integer number of **paise**.

## \`GET /health\`

\`\`\`json
{ "status": "ok" }
\`\`\`

## Endpoints

\`\`\`
POST /users                        { "id", "tenantId", "role", "approvalLimitPaise" }
POST /expenses                     { "id", "tenantId", "submitterId", "amountPaise" }
POST /expenses/:id/decide          { "actorId", "decision" }
GET  /expenses/:id?actorId=
GET  /expenses/:id/audit?actorId=
\`\`\`

\`role\` is \`EMPLOYEE\`, \`MANAGER\` or \`FINANCE\`. \`decision\` is \`APPROVE\`
or \`REJECT\`.

\`GET /expenses/:id\` returns
\`{ "id", "amountPaise", "status", "decidedBy" }\` where \`status\` is
\`PENDING\`, \`APPROVED\` or \`REJECTED\`.

## Tenancy — the rule that matters most

**An actor from another tenant gets \`404\`, not \`403\`.**

A \`403\` confirms the expense exists. That is a tenant-enumeration oracle: a
competitor's tool would be telling one customer which record ids another customer
owns. Cross-tenant reads, decisions and audit reads are **all** \`404\`.

## Authorization

Checked in this order, because the error should describe the real reason:

1. Cross-tenant → \`404\`.
2. **The submitter may never decide their own expense** → \`403\`, even with a
   sufficient limit, even for \`FINANCE\`.
3. \`EMPLOYEE\` may never decide anything → \`403\`.
4. \`amountPaise\` above the actor's \`approvalLimitPaise\` → \`403\`, with
   \`requiredLimitPaise\` in the body. The limit is **inclusive**: an amount
   exactly equal to it is allowed.
5. \`FINANCE\` may approve **any** amount, ignoring \`approvalLimitPaise\`.

A decided expense cannot be decided again → \`409\`. \`REJECTED\` is terminal, not
a step on the way to approval.

## The audit trail

\`GET /expenses/:id/audit\` returns:

\`\`\`json
{ "entries": [
  { "sequence": 1, "action": "SUBMITTED", "actorId": "u_emp" },
  { "sequence": 2, "action": "APPROVED",  "actorId": "u_mgr" }
] }
\`\`\`

- **Entry 1 is the submission**, not the first decision.
- Append-only and immutable: reading it twice returns identical entries.
- A refused decision writes **no** entry.
- \`sequence\` starts at 1 and increases by 1.

${STATEFUL_NOTE}

${SCORING_NOTE}
`.trim(),
    tests: [
      healthTest,
      resetTest,
      {
        name: 'create the submitter',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/users',
          body: {
            id: 'u_emp',
            tenantId: 't1',
            role: 'EMPLOYEE',
            approvalLimitPaise: 0,
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'create a manager with a limit',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/users',
          body: {
            id: 'u_mgr',
            tenantId: 't1',
            role: 'MANAGER',
            approvalLimitPaise: 50000,
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'create a manager in a different tenant',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/users',
          body: {
            id: 'u_other',
            tenantId: 't2',
            role: 'MANAGER',
            approvalLimitPaise: 999999,
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'submit an expense within the manager limit',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/expenses',
          body: {
            id: 'exp_1',
            tenantId: 't1',
            submitterId: 'u_emp',
            amountPaise: 50000,
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'the audit trail begins with the submission',
        weight: 6,
        spec: {
          method: 'GET',
          path: '/expenses/exp_1/audit?actorId=u_mgr',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'entries.length', equals: 1 },
              { path: 'entries[0].sequence', equals: 1 },
              { path: 'entries[0].action', equals: 'SUBMITTED' },
              { path: 'entries[0].actorId', equals: 'u_emp' },
            ],
          },
        },
      },
      {
        // THE tenancy discriminator: 404, never 403.
        name: 'a cross-tenant read is 404, not 403',
        weight: 7,
        spec: {
          method: 'GET',
          path: '/expenses/exp_1?actorId=u_other',
          expect: { status: 404 },
        },
      },
      {
        name: 'a cross-tenant decision is also 404',
        weight: 5,
        spec: {
          method: 'POST',
          path: '/expenses/exp_1/decide',
          body: { actorId: 'u_other', decision: 'APPROVE' },
          expect: { status: 404 },
        },
      },
      {
        name: 'a cross-tenant audit read is also 404',
        weight: 4,
        spec: {
          method: 'GET',
          path: '/expenses/exp_1/audit?actorId=u_other',
          expect: { status: 404 },
        },
      },
      {
        name: 'an employee cannot decide',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/expenses/exp_1/decide',
          body: { actorId: 'u_emp', decision: 'APPROVE' },
          expect: { status: 403 },
        },
      },
      {
        name: 'none of the refused attempts wrote an audit entry',
        weight: 5,
        spec: {
          method: 'GET',
          path: '/expenses/exp_1/audit?actorId=u_mgr',
          expect: {
            status: 200,
            jsonPath: [{ path: 'entries.length', equals: 1 }],
          },
        },
      },
      {
        name: 'an amount exactly at the limit is allowed',
        weight: 5,
        spec: {
          method: 'POST',
          path: '/expenses/exp_1/decide',
          body: { actorId: 'u_mgr', decision: 'APPROVE' },
          expect: { status: 200 },
        },
      },
      {
        name: 'the decision is recorded against the approver',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/expenses/exp_1?actorId=u_mgr',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'status', equals: 'APPROVED' },
              { path: 'decidedBy', equals: 'u_mgr' },
            ],
          },
        },
      },
      {
        name: 'the audit trail appended the decision',
        weight: 4,
        spec: {
          method: 'GET',
          path: '/expenses/exp_1/audit?actorId=u_mgr',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'entries.length', equals: 2 },
              { path: 'entries[1].sequence', equals: 2 },
              { path: 'entries[1].action', equals: 'APPROVED' },
              { path: 'entries[1].actorId', equals: 'u_mgr' },
            ],
          },
        },
      },
      {
        name: 'a decided expense cannot be decided again',
        weight: 4,
        spec: {
          method: 'POST',
          path: '/expenses/exp_1/decide',
          body: { actorId: 'u_mgr', decision: 'REJECT' },
          expect: { status: 409 },
        },
      },
      {
        name: 'the audit trail is immutable — the entries did not change',
        weight: 5,
        spec: {
          method: 'GET',
          path: '/expenses/exp_1/audit?actorId=u_mgr',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'entries.length', equals: 2 },
              { path: 'entries[0].action', equals: 'SUBMITTED' },
              { path: 'entries[1].action', equals: 'APPROVED' },
            ],
          },
        },
      },
      {
        name: 'submit an expense above the manager limit',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/expenses',
          body: {
            id: 'exp_big',
            tenantId: 't1',
            submitterId: 'u_emp',
            amountPaise: 500000,
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'an amount above the limit is refused with the limit required',
        weight: 5,
        spec: {
          method: 'POST',
          path: '/expenses/exp_big/decide',
          body: { actorId: 'u_mgr', decision: 'APPROVE' },
          expect: {
            status: 403,
            jsonPath: [{ path: 'requiredLimitPaise', equals: 500000 }],
          },
        },
      },
      {
        name: 'create a finance approver with no meaningful limit',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/users',
          body: {
            id: 'u_fin',
            tenantId: 't1',
            role: 'FINANCE',
            approvalLimitPaise: 1,
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'finance approves any amount regardless of its limit',
        weight: 5,
        spec: {
          method: 'POST',
          path: '/expenses/exp_big/decide',
          body: { actorId: 'u_fin', decision: 'APPROVE' },
          expect: { status: 200 },
        },
      },
      {
        name: 'a self-submitted expense cannot be approved by its submitter',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/expenses',
          body: {
            id: 'exp_self',
            tenantId: 't1',
            submitterId: 'u_fin',
            amountPaise: 1000,
          },
          expect: { status: 201 },
        },
      },
      {
        // The separation-of-duties discriminator.
        name: 'even FINANCE cannot approve its own expense',
        weight: 7,
        spec: {
          method: 'POST',
          path: '/expenses/exp_self/decide',
          body: { actorId: 'u_fin', decision: 'APPROVE' },
          expect: { status: 403 },
        },
      },
      {
        name: 'a rejected expense is terminal',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/expenses/exp_self/decide',
          body: { actorId: 'u_mgr', decision: 'REJECT' },
          expect: { status: 200 },
        },
      },
      {
        name: 'a rejected expense cannot later be approved',
        weight: 5,
        spec: {
          method: 'POST',
          path: '/expenses/exp_self/decide',
          body: { actorId: 'u_fin', decision: 'APPROVE' },
          expect: { status: 409 },
        },
      },
      {
        name: 'an unknown expense is 404',
        weight: 2,
        spec: {
          method: 'GET',
          path: '/expenses/exp_nope?actorId=u_mgr',
          expect: { status: 404 },
        },
      },
    ],
  },

  // ────────────────────────────── API contracts ───────────────────────────
  {
    slug: 'activity-feed',
    visibility: 'DRAFT',
    title: 'Activity Feed Pagination',
    difficulty: 'Medium',
    contractSpec: DEFAULT_CONTRACT,
    statementMarkdown: `
# Activity Feed Pagination

Ship the paginated "what happened" feed a team tool shows in its sidebar. New
activity arrives while people are reading, and the feed must never show a row
twice or skip one.

## \`GET /health\`

\`\`\`json
{ "status": "ok" }
\`\`\`

## Endpoints

\`\`\`
POST /activity                  { "id", "at", "actor", "kind" }
GET  /activity?limit=&cursor=
\`\`\`

\`at\` is an absolute ISO-8601 UTC string. Nothing depends on the current time.

\`GET /activity\` returns \`200\`:

\`\`\`json
{
  "items": [
    { "id": "a2", "at": "2026-03-01T10:00:00Z" },
    { "id": "a3", "at": "2026-03-01T10:00:00Z" }
  ],
  "nextCursor": "2026-03-01T10:00:00Z_a3"
}
\`\`\`

## The ordering — read this twice

Order by \`at\` **ascending**, and where \`at\` is equal, by \`id\` **ascending**.

Timestamps collide constantly in a busy feed. \`at\` alone is **not** a total
order, and without the \`id\` tie-break your pages will duplicate and skip rows
whenever two entries share a timestamp. That is the whole point of this problem.

## The cursor

The cursor format is **specified, not opaque**:

\`\`\`
<at>_<id>
\`\`\`

— exactly the sort key of the last item returned. It is **exclusive**: a page
resumes strictly *after* the cursor.

- \`nextCursor\` is the sort key of the final item in the page, or \`null\` when
  there are no further items.
- \`limit\` defaults to \`20\`. A \`limit\` above \`100\`, or of \`0\` or less, is
  \`400\`.
- A malformed cursor is \`400\`.
- A cursor past every entry returns \`{ "items": [], "nextCursor": null }\` — not
  an error.
- An empty feed returns \`{ "items": [], "nextCursor": null }\`.

An entry appended that sorts **before** the cursor must never appear on a later
page. One that sorts **after** it must.

${STATEFUL_NOTE}

${SCORING_NOTE}
`.trim(),
    tests: [
      healthTest,
      resetTest,
      {
        name: 'append three entries sharing one timestamp',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/activity',
          body: {
            id: 'a3',
            at: '2026-03-01T10:00:00Z',
            actor: 'u1',
            kind: 'commented',
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'append the second, out of id order on purpose',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/activity',
          body: {
            id: 'a1',
            at: '2026-03-01T10:00:00Z',
            actor: 'u2',
            kind: 'created',
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'append the third',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/activity',
          body: {
            id: 'a2',
            at: '2026-03-01T10:00:00Z',
            actor: 'u3',
            kind: 'assigned',
          },
          expect: { status: 201 },
        },
      },
      {
        name: 'append a later entry',
        weight: 2,
        spec: {
          method: 'POST',
          path: '/activity',
          body: {
            id: 'a9',
            at: '2026-03-01T11:00:00Z',
            actor: 'u1',
            kind: 'closed',
          },
          expect: { status: 201 },
        },
      },
      {
        // THE discriminator: equal timestamps must tie-break by id.
        name: 'entries with an identical timestamp are ordered by id',
        weight: 7,
        spec: {
          method: 'GET',
          path: '/activity?limit=2',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'items.length', equals: 2 },
              { path: 'items[0].id', equals: 'a1' },
              { path: 'items[1].id', equals: 'a2' },
              { path: 'nextCursor', equals: '2026-03-01T10:00:00Z_a2' },
            ],
          },
        },
      },
      {
        name: 'the cursor is exclusive — the next page resumes after it',
        weight: 6,
        spec: {
          method: 'GET',
          path: '/activity?limit=2&cursor=2026-03-01T10:00:00Z_a2',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'items.length', equals: 2 },
              { path: 'items[0].id', equals: 'a3' },
              { path: 'items[1].id', equals: 'a9' },
              { path: 'nextCursor', equals: '2026-03-01T11:00:00Z_a9' },
            ],
          },
        },
      },
      {
        name: 'append an entry that sorts BEFORE the cursor',
        weight: 3,
        spec: {
          method: 'POST',
          path: '/activity',
          body: {
            id: 'a0',
            at: '2026-03-01T09:00:00Z',
            actor: 'u4',
            kind: 'opened',
          },
          expect: { status: 201 },
        },
      },
      {
        // The stability discriminator: a late insert behind the cursor must not resurface.
        name: 'an entry inserted behind the cursor does not appear on a later page',
        weight: 7,
        spec: {
          method: 'GET',
          path: '/activity?limit=10&cursor=2026-03-01T10:00:00Z_a2',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'items.length', equals: 2 },
              { path: 'items[0].id', equals: 'a3' },
              { path: 'items[1].id', equals: 'a9' },
            ],
          },
        },
      },
      {
        name: 'but it does appear when paging from the start',
        weight: 4,
        spec: {
          method: 'GET',
          path: '/activity?limit=1',
          expect: {
            status: 200,
            jsonPath: [{ path: 'items[0].id', equals: 'a0' }],
          },
        },
      },
      {
        name: 'the final page reports no further cursor',
        weight: 5,
        spec: {
          method: 'GET',
          path: '/activity?limit=10&cursor=2026-03-01T10:00:00Z_a3',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'items.length', equals: 1 },
              { path: 'items[0].id', equals: 'a9' },
              { path: 'nextCursor', equals: null },
            ],
          },
        },
      },
      {
        name: 'a cursor past every entry is empty, not an error',
        weight: 4,
        spec: {
          method: 'GET',
          path: '/activity?limit=10&cursor=2099-01-01T00:00:00Z_zz',
          expect: {
            status: 200,
            jsonPath: [
              { path: 'items', equals: [] },
              { path: 'nextCursor', equals: null },
            ],
          },
        },
      },
      {
        name: 'a limit above the maximum is rejected',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/activity?limit=101',
          expect: { status: 400 },
        },
      },
      {
        name: 'a zero limit is rejected',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/activity?limit=0',
          expect: { status: 400 },
        },
      },
      {
        name: 'a malformed cursor is rejected',
        weight: 3,
        spec: {
          method: 'GET',
          path: '/activity?cursor=not-a-cursor',
          expect: { status: 400 },
        },
      },
    ],
  },
];
