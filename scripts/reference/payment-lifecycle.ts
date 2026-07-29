import { createServer, type Server, type ServerResponse } from 'node:http';

/**
 * Reference implementation of the `payment-lifecycle` challenge.
 *
 * Written from the published statement alone, the way a competitor would, and
 * used by `npm run verify:challenge` to prove the authored hidden tests actually
 * pass against a correct solution. A hidden test that a correct implementation
 * fails is worse than no test at all: it scores everybody zero and nobody finds
 * out until the tournament is over.
 *
 * Deliberately zero-dependency and in-memory. That is also the point being
 * demonstrated — the challenge requires no database, and an in-memory store that
 * survives the graded sequence is a legitimate answer (see §1.1 of
 * `docs/21-challenge-library.md`).
 *
 * `flaws` lets the harness ask for a knowingly-wrong variant, so we can prove the
 * tests FAIL when the rules are broken. A test suite that only ever sees a
 * correct solution has not been shown to discriminate at all.
 */

export type Flaw =
  | 'clamp-capture' // clamp an over-capture instead of refusing it
  | 'refund-against-authorized' // cap refunds by authorized, not captured
  | 'allow-void-after-capture'; // permit a void once money has been taken

interface Payment {
  id: string;
  amountPaise: number;
  capturedPaise: number;
  refundedPaise: number;
  voided: boolean;
  captureIds: Set<string>;
  refundIds: Set<string>;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  });
  res.end(payload);
};

function view(p: Payment) {
  const remainingPaise = p.amountPaise - p.capturedPaise;
  const refundablePaise = p.capturedPaise - p.refundedPaise;
  let status: string;
  if (p.voided) status = 'VOIDED';
  else if (p.capturedPaise === 0) status = 'AUTHORIZED';
  else if (p.capturedPaise > 0 && p.refundedPaise === 0)
    status = remainingPaise === 0 ? 'CAPTURED' : 'PARTIALLY_CAPTURED';
  else status = refundablePaise === 0 ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

  return {
    id: p.id,
    amountPaise: p.amountPaise,
    capturedPaise: p.capturedPaise,
    remainingPaise,
    refundedPaise: p.refundedPaise,
    refundablePaise,
    status,
  };
}

export function createReferenceServer(flaws: Flaw[] = []): Server {
  const payments = new Map<string, Payment>();
  const has = (f: Flaw) => flaws.includes(f);

  return createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = req.method ?? 'GET';

      let body: Record<string, unknown> = {};
      if (chunks.length > 0) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return json(res, 400, { error: 'malformed JSON' });
        }
      }

      if (method === 'GET' && path === '/health') {
        return json(res, 200, { status: 'ok' });
      }
      if (method === 'GET' && path === '/') {
        return json(res, 200, { service: 'payment-lifecycle reference' });
      }
      if (method === 'POST' && path === '/_reset') {
        payments.clear();
        return json(res, 200, { ok: true });
      }

      const amount = (): number | null => {
        const v = body.amountPaise;
        return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
      };

      if (method === 'POST' && path === '/payments') {
        const id = body.id;
        if (typeof id !== 'string')
          return json(res, 400, { error: 'id required' });
        const amountPaise = amount();
        if (amountPaise === null)
          return json(res, 400, {
            error: 'amountPaise must be a positive integer',
          });

        const existing = payments.get(id);
        // Re-creating with a known id is an idempotent no-op, which is what makes
        // the whole graded sequence safe to replay.
        if (existing) return json(res, 200, view(existing));

        const created: Payment = {
          id,
          amountPaise,
          capturedPaise: 0,
          refundedPaise: 0,
          voided: false,
          captureIds: new Set(),
          refundIds: new Set(),
        };
        payments.set(id, created);
        return json(res, 201, view(created));
      }

      const match = path.match(
        /^\/payments\/([^/]+)(?:\/(captures|refunds|void))?$/,
      );
      if (!match) return json(res, 404, { error: 'not found' });

      const payment = payments.get(match[1]!);
      if (!payment) return json(res, 404, { error: 'payment not found' });
      const action = match[2];

      if (method === 'GET' && !action) return json(res, 200, view(payment));

      if (method === 'POST' && action === 'captures') {
        const id = body.id;
        if (typeof id !== 'string')
          return json(res, 400, { error: 'id required' });
        const amountPaise = amount();
        if (amountPaise === null)
          return json(res, 400, {
            error: 'amountPaise must be a positive integer',
          });
        if (payment.voided)
          return json(res, 409, { error: 'payment is voided' });
        if (payment.captureIds.has(id)) return json(res, 200, view(payment));

        const remaining = payment.amountPaise - payment.capturedPaise;
        if (amountPaise > remaining) {
          if (has('clamp-capture')) {
            payment.capturedPaise += remaining;
            payment.captureIds.add(id);
            return json(res, 201, view(payment));
          }
          return json(res, 422, {
            error: 'capture exceeds the remaining authorization',
            remainingPaise: remaining,
          });
        }
        payment.capturedPaise += amountPaise;
        payment.captureIds.add(id);
        return json(res, 201, view(payment));
      }

      if (method === 'POST' && action === 'refunds') {
        const id = body.id;
        if (typeof id !== 'string')
          return json(res, 400, { error: 'id required' });
        const amountPaise = amount();
        if (amountPaise === null)
          return json(res, 400, {
            error: 'amountPaise must be a positive integer',
          });
        if (payment.refundIds.has(id)) return json(res, 200, view(payment));
        if (payment.capturedPaise === 0)
          return json(res, 409, { error: 'nothing has been captured' });

        // The rule the whole challenge turns on: the ceiling is what was
        // CAPTURED, not what was authorized.
        const ceiling = has('refund-against-authorized')
          ? payment.amountPaise
          : payment.capturedPaise;
        if (payment.refundedPaise + amountPaise > ceiling) {
          return json(res, 409, {
            error: 'refund exceeds the refundable amount',
          });
        }
        payment.refundedPaise += amountPaise;
        payment.refundIds.add(id);
        return json(res, 201, view(payment));
      }

      if (method === 'POST' && action === 'void') {
        if (payment.capturedPaise > 0 && !has('allow-void-after-capture')) {
          return json(res, 409, { error: 'cannot void a captured payment' });
        }
        payment.voided = true;
        return json(res, 200, view(payment));
      }

      return json(res, 404, { error: 'not found' });
    });
  });
}
