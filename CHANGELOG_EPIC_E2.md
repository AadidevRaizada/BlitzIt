# Epic E2 — Evaluation Engine (spike)

**Milestone:** M2 (Sprint 2) · **Status:** ✅ Complete
**Branch:** `epic-e2-evaluation-engine`

The product's central bet: score a submission **without ever executing competitor code** (D1).

## What was built

`src/server/modules/evaluation/`

| Module | Responsibility |
|---|---|
| `types.ts` | `EvaluationStrategy` contract, score shapes, `DEFAULT_WEIGHTS` (60/15/10/15) |
| `safe-fetch.ts` | Egress-controlled HTTP client — SSRF guard, redirect re-validation, timeouts, size caps |
| `reachability.ts` | Warm-up + 3 retries with exponential backoff (D15) |
| `strategies/rest-api.ts` | Hidden-test harness, performance probe, security/reliability probe |
| `strategies/index.ts` | Registry + **D17 gate** (only REST_API enabled) |
| `github-text.ts` | Reads the repo as **text via the GitHub API** — never cloned |
| `llm/provider.ts` | Provider-agnostic LLM: Claude primary, OpenAI fallback (D18) |
| `llm/quality.ts` | Rubric, temp 0, pinned model + prompt hash, schema-validated, injection-guarded |
| `score.ts` | Pure weighted blend |
| `evaluate.ts` | Orchestrator producing a full `EvaluationOutcome` |

Plus `jobs/processors/evaluate.ts` (persists the `Evaluation` + evidence, idempotent via upsert)
and `enqueueEvaluation()`.

## Architectural decisions

| Decision | Rationale |
|---|---|
| **SSRF guard is mandatory on every probe** | The deployment URL is fully attacker-controlled. All resolved addresses must be public; private/loopback/link-local/CGNAT/cloud-metadata are refused, and **every redirect hop is re-validated** so a public host can't bounce us to `169.254.169.254`. |
| Any HTTP answer = "reachable" | A 404/500 means the host is alive; correctness is the tests' job. Only transport failure counts as unreachable. |
| Repo read is independent of reachability | An unreachable deployment still yields a quality score rather than a blank row. |
| LLM failure degrades, never fails | No key / provider outage / schema-invalid output ⇒ neutral 50, `degraded: true`, admin can override. An evaluation is never blocked by a third party. |
| Score bands, not a curve, for performance | Predictable and explainable to competitors. |
| Blend normalises by the weight sum | Custom weights can't inflate the scale. |
| Evidence stored as JSONB, paths-only for repo | Full LLM prompt/response is retained for disputes; file *contents* aren't duplicated into the snapshot column. |
| `UnsupportedCategoryError` ⇒ `FAILED`, not retried | A disabled category will never succeed on retry; burning attempts would be noise. |

## Migrations

**None.** E2 uses the existing `Evaluation` / `EvaluationJob` tables from `0_init`.

## Breaking changes

**None.** Additive only. `evaluate` is newly registered in the processor registry.

## Bugs encountered during implementation

1. **Binary-file detection compared against a space** instead of a NUL byte — would have skipped
   nearly every source file. Fixed before first run.
2. **Unused `zod` import** in `github-text.ts`.
3. **Duplicate `account` key** pattern repeated from E1 — avoided here by typechecking early.
4. **Weak self-tests:** my first `verify:evaluation` contained a vacuous assertion and never
   exercised the harness against a working deployment (the SSRF guard correctly blocked my own
   local fake server). Replaced with real probes against a public endpoint, which is what caught
   that weighted scoring actually works.
5. `import type` lint error on `Prisma` — caught by the gate.

## Codex findings

See "Codex review" section below (filled after the review ran).

## Verification

| Suite | Result |
|---|---|
| `verify:evaluation` | **30/30** — scoring maths, SSRF matrix, registry gate, repo-URL parsing, injection defence, live probes |
| `verify:evaluation:e2e` | **19/19** — real submission → job → processor → `Evaluation` row |
| `verify:auth` / `verify:queue` / `verify:runner` | 36 / 13 / 5 — no regressions |
| tsc · eslint · prettier · build | all pass |

**DoD evidence** — a real submission against a public deployment scored:
`functional 80 · performance 100 · security 72.73 · ai 50 (degraded) → overall 77.77`,
identical on re-run, with weights, probe evidence, per-test results, repo snapshot, rubric
version and prompt hash all persisted.

## Known limitations

- **AI dimension unproven against a live model** — no `ANTHROPIC_API_KEY` was configured, so every
  run exercised the degraded path. The provider/rubric/parsing code is written and unit-covered,
  but a real Claude response has not been scored.
- **Only REST_API is evaluable** (deliberate, D17). The other 7 categories are gated.
- **Security probe is header/response-level**, not a vulnerability scan — by design (D1).
- **Performance is measured from our host**, so competitor geography influences latency.
