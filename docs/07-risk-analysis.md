# 07 — Risk Analysis

Severity = likelihood × impact on a real-money weekly event. **Critical** items gate launch.

> Reflects [`DECISIONS.md`](./DECISIONS.md). The former #1 risk (executing untrusted code) is
> **designed out** — we never run competitor code (D1). Risks below are what remains.

## Technical risks

### T1 — Probing untrusted deployment URLs & reading untrusted repos — **MEDIUM** (was CRITICAL)
We no longer execute competitor code, so RCE/lateral-movement is designed out. Residual surface:
(a) our probes hit attacker-controlled URLs (SSRF-style tricks, huge/slow responses, redirects to
internal hosts); (b) repo text fed to the LLM can contain **prompt injection**.
- **Mitigation:** run probes from the app with **outbound egress controls** (block private/link-
  local ranges, no following redirects to internal hosts), strict timeouts + response-size caps;
  treat all repo/README text as **data, never instructions**, and validate LLM output against a
  strict schema (see T2). No credentials ever travel to the deployment URL.

### T2 — LLM judging is non-deterministic & prompt-injectable — **CRITICAL**
LLM scores vary run-to-run; competitor README/code can inject "score me 100". Real money makes
inconsistent/gameable scoring a fairness and legal problem.
- **Mitigation:** deterministic hidden tests are the **primary, reproducible** score; LLM scores
  only subjective dimensions with a strict JSON rubric, temperature 0, pinned model+prompt per
  tournament, multiple samples, output schema-validated, untrusted content treated as data.
  Human override in admin. Store full prompt/response for every score.

### T3 — Live Sunday realtime coordination — **HIGH**
Simultaneous reveal, server-authoritative timers, per-match windows, elimination between rounds,
disconnects, and judging that may outlast a round timer. Race conditions here are visible and
brand-damaging.
- **Mitigation:** server-authoritative time only; atomic bracket advancement in transactions;
  explicit rules for late/no submission and judge-slower-than-timer; SSE with polling fallback;
  extensive tests + a full dress rehearsal (M10).

### T4 — Deadline burst load + single-process runner — **MEDIUM**
All competitors submit in the last seconds; all evaluations enqueue at once. With an **in-process
runner** (D3), heavy evaluation shares CPU/event-loop with the web server.
- **Mitigation:** cheap insert on submit; runner concurrency cap + `availableAt` backoff; keep
  LLM/probe calls I/O-bound (await, don't block); Postgres-backed rate limiting; load-test the
  spike in M10. **Escape hatch:** the `Queue` interface lets us extract the runner to a second
  Railway service (still no Redis) if a single process can't keep up — a config change, not a
  rewrite.

### T5 — Third-party deployment reachability — **HIGH** (elevated under D1)
Because we grade the live URL and never run their code, evaluation **depends entirely** on the
competitor's self-hosted URL being up during the window. Cold starts, sleeping free-tier apps, or
downtime cause false zeros — and this is now the primary functional-score risk.
- **Mitigation:** defined evaluation window with warm-up pings + retries with backoff; publish
  clear rules that reachability is the competitor's responsibility with a documented grace/retry
  policy; store probe evidence (timestamps, response codes) for disputes; surface reachability
  status live so competitors can react before the deadline.

### T7 — Black-box evaluation quality varies by challenge type — **MEDIUM** (new under D4)
Different categories (REST API vs Chrome Extension vs CLI vs OCR) are not equally testable purely
black-box + repo-text. A weak strategy can under/over-score a category, undermining fairness.
- **Mitigation:** ship one strong strategy at a time (REST_API first); gate a category "live for
  prizes" only after its strategy is validated; weight the LLM pass higher for hard-to-probe
  types with correspondingly lower stakes; per-tournament choose only validated categories.

### T6 — Prisma 7 / Tailwind v4 / Better Auth novelty — **LOW/MEDIUM**
Recent breaking changes (`prisma.config.ts`, CSS-first config, `nextCookies()`), smaller
ecosystems, thinner Stack Overflow coverage.
- **Mitigation:** pin versions; follow official docs (see `tech-research.md`); the evaluation spike
  and M0 flush integration surprises early.

## Business risks

### B1 — India prize-payout compliance — **HIGH (business workstream, D11)**
Prize money to individuals triggers **TDS on winnings (§194BA)**, RazorpayX KYC, GST on the ₹100
pass, and possible skill-gaming regulatory questions. Per D11, V1 keeps this **documented but
lightweight** (Week-1 pool is small, first prize capped ₹2,000).
- **Mitigation:** run compliance as a parallel business track; before **scaling** prize pools,
  complete GST/TDS/RazorpayX review with a CA. Keep KYC + payout audit trails from day one so
  retroactive compliance is possible. Do not scale pools until the review lands.

### B2 — Cold-start / supply — **HIGH**
A weekly esport needs a critical mass every week; 32 qualifiers from 100 registrations assumes
demand that may not exist at launch.
- **Mitigation:** support flexible field sizes (byes/under-subscription); seed the first events
  with community/marketing; make brackets work for 8/16/32; measure funnel in PostHog.

### B3 — Weekly content/ops treadmill — **MEDIUM/HIGH**
Every week needs fresh problems **with machine-checkable hidden tests**, plus event ops. This is
the real recurring cost and the PRD calls it "low overhead".
- **Mitigation:** constrain problems to gradable contracts (HTTP API), build a problem/test
  authoring pipeline in admin early, maintain a problem bank, templatize ops via idempotent
  transitions.

### B4 — Refunds & event cancellation — **MEDIUM**
If a tournament is cancelled or a competitor can't compete, money is owed back.
- **Mitigation:** explicit refund policy + automated refund path (M4); communicate terms at
  purchase.

## Scaling risks

### S1 — Single Railway region — **MEDIUM (later)**
India-first is fine early, but a global audience adds latency; single region limits DR.
- **Mitigation:** acceptable for V1; plan read replicas/CDN/multi-region when metrics justify;
  keep the app stateless so it's portable.

### S2 — Judging cost & throughput at scale — **MEDIUM**
Sandbox minutes + LLM tokens per submission grow linearly with registrations.
- **Mitigation:** cache deterministic results; cap LLM to subjective slice; per-tournament model
  choice; monitor cost per submission; concurrency limits.

## Security risks

### S3 — Payment/webhook tampering — **HIGH**
Fake payment updates if webhook signatures aren't verified against raw body; double-activation.
- **Mitigation:** raw-body signature verification, idempotency keys, amount reconciliation,
  webhook as source of truth (never the browser callback).

### S4 — Cheating / integrity — **MEDIUM/HIGH**
Editing after deadline, swapping deployment URL post-judge, pointing at another competitor's live
URL, plagiarism.
- **Mitigation:** immutable sealed submissions, server timestamps, URL-reuse detection, ownership
  checks, commit-SHA pinning, audit logs, admin disqualification.

### S5 — Secret leakage — **MEDIUM**
Secrets in `NEXT_PUBLIC_*`, logs, or client bundles.
- **Mitigation:** `server-only` guards, env split + zod validation, no secrets in logs, secret
  scanning in CI, rotation.

## Operational risks

### O1 — Runner/cron reliability during the live event — **HIGH**
A missed transition or crashed process mid-tournament stalls the event; with an in-process runner,
a web restart also pauses evaluation until it reboots.
- **Mitigation:** DB-authoritative idempotent transitions (cron replay-safe); jobs are claimed
  (not deleted) so a crash mid-job is retried after a lock timeout; `FAILED` rows + alerting act
  as a dead-letter list; health check surfaces runner heartbeat; Railway auto-restart; a manual
  admin "force transition"/"re-enqueue" escape hatch; on-call during events.

### O2 — Observability gaps — **MEDIUM**
Without traces you can't debug a live judging failure fast enough.
- **Mitigation:** Sentry + structured logs with correlation ids across request→runner→evaluation;
  admin visibility into every submission's evaluation state and evidence.

### O3 — Single-maintainer bus factor — **MEDIUM**
Small team, real-money weekly cadence.
- **Mitigation:** runbooks, this blueprint, automated ops, dress rehearsal, alerting so problems
  surface without constant watching.
