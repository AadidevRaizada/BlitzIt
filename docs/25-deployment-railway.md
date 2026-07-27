# Deployment checklist — Railway

Everything below is derived from this repo's actual config: `railway.json`,
`src/lib/env.ts`, and the route handlers under `src/app/api/`.

---

## 1. Topology — what services you actually need

| Service | Needed? | Why |
|---|---|---|
| Web service (this repo) | Yes | Next.js **and** the evaluation runner |
| Postgres | Yes | All state |
| Volume | **No** | Nothing writes to disk; all state is Postgres |
| Separate worker service | **No** | The runner is in-process |
| **Cron service** | **No** | Round progression rides the runner — see below |
| Separate PostHog service | **No** | Use PostHog Cloud |

**Do not add a Railway cron service for round progression.** Earlier drafts of the architecture
assumed one. It cannot do the job: Railway's minimum cron interval is 5 minutes and a cron service
must terminate when its task finishes, which this service (a Next.js server hosting the runner)
never does. The shortest rounds are 600s, so a 5-minute tick lands half a round late. Instead the
runner's poll loop sweeps for rounds whose `deadlineAt` has passed and enqueues an
`advanceBracket` job — no extra service, no extra environment variable. See D30/D31 in
`DECISIONS.md`.

That sweep is replica-safe (its idempotency key is bucketed by minute, so concurrent replicas
collapse to one job), but `replicas = 1` below still stands for the other reasons.

**The runner is in-process.** `startRunner()` is called from
`src/instrumentation.ts`, so the web service *is* the worker. There is no
separate queue process to deploy.

Because of that, **start with `replicas = 1`.** Job claiming is DB-based with a
claim timeout (`RUNNER_CLAIM_TIMEOUT_MS`), so extra replicas would not corrupt
jobs, but every replica runs its own runner and its own SSE loops. Scale only
after you've watched one instance under load.

`railway.json` is already correct — don't change it:

- install: `npm ci`
- build: `npm run build`
- start: `npx prisma migrate deploy && npm run start` (migrations run on every deploy)
- healthcheck: `/api/health`

Do **not** put `npm ci && npm run build` into Railway's build command. Nixpacks
already runs the install phase, and running `npm ci` again in the build phase can
collide with Railway's mounted `node_modules/.cache` cache.

---

## 2. Order of operations (this order matters)

`NEXT_PUBLIC_*` vars are **inlined into the client bundle at build time**, so
they must exist *before* the build that ships them. On Railway that means:

1. Create the Postgres service first.
2. Create the web service from the repo, but **don't rely on the first build**.
3. Generate the public domain (Settings → Networking → Generate Domain), or
   attach your custom domain, so you know the final URL.
4. In the web service, set `DATABASE_URL` to reference the Postgres service
   variable, not a pasted placeholder URL.
5. Set every remaining variable in section 3, using that final URL.
6. **Redeploy** so the build picks up the `NEXT_PUBLIC_*` values and the runtime
   container starts with `DATABASE_URL`.
7. Only then register the OAuth callbacks and the Razorpay webhook (section 4).

Do not set `PORT` yourself — Railway injects it and `next start` reads it.

---

## 3. Environment variables

Domain/port reminder before you set URLs: for custom domains, do not enter a
database port and do not create a TCP proxy for the web app. Use Railway's
**Public Networking** domain flow. Leave the target port on automatic/detected
when possible. If Railway forces a target-port choice after a successful deploy,
choose the single HTTP port detected for the BlitzIt web service. Do **not** use
Postgres ports (`5432`, `5434`) and do not set `PORT=3000` just to satisfy the
domain form.

### Copy-paste block — the whole thing

Railway → your service → **Variables** → **Raw Editor** → paste, then fill in
the blanks and replace `YOUR-DOMAIN`. Delete any line you aren't using yet;
only the first five are required to boot. The `Postgres` service name must match
your Railway canvas exactly.

```env
# ---- REQUIRED ----
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://YOUR-DOMAIN
BETTER_AUTH_URL=https://YOUR-DOMAIN
BETTER_AUTH_SECRET=

# ---- REQUIRED FOR THE BUILD TO SUCCEED ----
# NODE_ENV=production makes `npm ci` omit devDependencies, but the build needs
# typescript, tailwind and the prisma CLI. Without this, the build fails.
NPM_CONFIG_PRODUCTION=false

# ---- PAYMENTS (required for paid tournaments) ----
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
NEXT_PUBLIC_RAZORPAY_KEY_ID=

# ---- OAUTH (a provider registers only when BOTH id and secret are set) ----
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ---- EVALUATION ----
LLM_PROVIDER=anthropic
LLM_MODEL=
LLM_TEMPERATURE=0
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GITHUB_API_TOKEN=

# ---- EMAIL ----
RESEND_API_KEY=
EMAIL_FROM=

# ---- ANALYTICS / MONITORING ----
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
POSTHOG_API_KEY=
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# ---- TUNING (defaults are fine; uncomment only to override) ----
# RUNNER_ENABLED=true
# RUNNER_CONCURRENCY=2
# RUNNER_CLAIM_TIMEOUT_MS=300000
# LIVE_STREAM_POLL_MS=3000
# LIVE_STREAM_HEARTBEAT_MS=15000
# LIVE_STREAM_MAX_DURATION_MS=900000
# LIVE_LEADERBOARD_TAKE=25
# TOURNAMENT_MIN_REGISTRATIONS=8
# TOURNAMENT_MAX_REGISTRATIONS=512
# TOURNAMENT_THIRD_PLACE_ENABLED=true
# TOURNAMENT_SIMULATION_ROUNDS=3
# TOURNAMENT_ADVANCE_HIGHER_SEED_ON_NO_SHOW=true
```

Do **not** set `RAZORPAY_USE_FAKE` — boot throws if it is `true` in production.
Generate the auth secret with `openssl rand -base64 32`.

Reference the database with Railway's variable reference syntax rather than
pasting a URL, so it stays in sync:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Use the exact service name from your Railway canvas. If the database service is
named `Production DB`, the reference must be:

```
DATABASE_URL=${{Production DB.DATABASE_URL}}
```

If the runtime logs say:

```text
Datasource "db": PostgreSQL database "unset", schema "public" at "localhost:1"
Error: P1001: Can't reach database server at `localhost:1`
```

then the web service is **not connected to Postgres**. Fix the web service's
`DATABASE_URL` variable, review/apply the staged variable change, and redeploy.
This is a Railway configuration issue, not an app build issue.

### Required — the app refuses to boot without these

| Var | Notes |
|---|---|
| `DATABASE_URL` | Reference the Postgres service — never `localhost:5434` |
| `NODE_ENV` | `production` exactly, or leave it unset and let Railway/Next set production behavior. Never use `Production`, `prod`, `preview`, or `staging` |
| `BETTER_AUTH_SECRET` | **min 32 chars**; `openssl rand -base64 32`. Boot throws in production if missing |
| `BETTER_AUTH_URL` | `https://YOUR-DOMAIN` |
| `NEXT_PUBLIC_APP_URL` | `https://YOUR-DOMAIN` — build-time, no trailing slash |

If the build logs say:

```text
You are using a non-standard "NODE_ENV" value
Error: <Html> should not be imported outside of pages/_document
Error occurred prerendering page "/500"
```

fix `NODE_ENV` first. That error can appear while Next is prerendering its
built-in error page under an inconsistent environment. The app router root
layout owns `<html>`; this repo should not import `Html`, `Main`, or
`NextScript` from `next/document`. Do not waste time on the `<Html>` or `/500`
message — fix the `NODE_ENV` value above it, then redeploy. The same log line
warns you what is wrong.

### Required for paid tournaments

`src/lib/env.ts` throws if `RAZORPAY_USE_FAKE=true` in production, and after the
E9 hardening the payment layer **fails closed** — missing Razorpay credentials
now throw instead of silently falling back to the built-in fake gateway.

| Var | Notes |
|---|---|
| `RAZORPAY_KEY_ID` | Live or test key id |
| `RAZORPAY_KEY_SECRET` | Never client-visible |
| `RAZORPAY_WEBHOOK_SECRET` | The secret you type into the Razorpay webhook form — **not** the API key secret |
| `NEXT_PUBLIC_RAZORPAY_KEY_ID` | Same value as `RAZORPAY_KEY_ID`; the only payment value in the client bundle |
| `RAZORPAY_USE_FAKE` | Leave unset. Must never be `true` in production |

### OAuth (providers register only when both id and secret are present)

`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`

### Evaluation

`LLM_PROVIDER` (`openai` | `anthropic`), `LLM_MODEL`, `LLM_TEMPERATURE`,
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, `GITHUB_API_TOKEN` (repo reads during
evaluation — raises the GitHub rate limit).

### Email

`RESEND_API_KEY`, `EMAIL_FROM` (must be a verified Resend sender domain).

### Analytics / monitoring

`NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `POSTHOG_API_KEY`,
`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` — see section 5 for the caveat.

### Tuning (all have sane defaults — skip unless you need them)

`RUNNER_ENABLED`, `RUNNER_CONCURRENCY` (2), `RUNNER_CLAIM_TIMEOUT_MS` (300000),
`LIVE_STREAM_POLL_MS` (3000), `LIVE_STREAM_HEARTBEAT_MS` (15000),
`LIVE_STREAM_MAX_DURATION_MS` (900000), `LIVE_LEADERBOARD_TAKE` (25),
`TOURNAMENT_*` lifecycle defaults.

---

## 4. Endpoints to register externally

Replace `YOUR-DOMAIN` with the Railway domain.

### GitHub OAuth app

- Homepage URL: `https://YOUR-DOMAIN`
- Authorization callback URL: `https://YOUR-DOMAIN/api/auth/callback/github`

### Google OAuth client

- Authorized JavaScript origin: `https://YOUR-DOMAIN`
- Authorized redirect URI: `https://YOUR-DOMAIN/api/auth/callback/google`
- While the consent screen is unpublished, add yourself under **Test users**

### Razorpay webhook

Dashboard → Account & Settings → Webhooks → Add New Webhook.

- URL: `https://YOUR-DOMAIN/api/webhooks/razorpay`
- Secret: the same value as `RAZORPAY_WEBHOOK_SECRET`
- Alert email: an address you actually read — Razorpay **disables a webhook
  after 24 hours of continuous failure**

Subscribe to exactly these events:

| Event | Handling |
|---|---|
| `payment.captured` | Activates the paid registration |
| `payment.authorized` | Recorded as pending — deliberately does **not** register anyone, because an authorization is not settled money |
| `payment.failed` | Marks the payment failed; the competitor can retry |
| `refund.processed` | Marks refunded, releases the seat, recomputes the prize pool |

### Other routes (no external registration needed)

| Route | Purpose |
|---|---|
| `/api/health` | Railway healthcheck — DB reachability + runner heartbeat |
| `/api/live/[tournamentId]` | SSE live stream |
| `/api/me/export` | Authenticated self-serve data export |
| `/api/auth/[...all]` | Better Auth handler |

---

## 5. PostHog and Sentry — the honest answers

### PostHog: use Cloud. No separate instance, no volume.

PostHog's own docs recommend Cloud "for all teams" and state that self-hosted
open-source deployments are **officially unsupported** — no commercial support,
no ticket debugging, and it's aimed at hobbyists. Self-hosting it would also
mean running ClickHouse, Kafka, Redis and Postgres, which is far more
infrastructure than this app itself.

Use PostHog Cloud's free tier:

- `NEXT_PUBLIC_POSTHOG_KEY` — the project API key
- `NEXT_PUBLIC_POSTHOG_HOST` — `https://us.i.posthog.com` or `https://eu.i.posthog.com`
- `POSTHOG_API_KEY` — server-side key

`posthog-js` and `posthog-node` are already dependencies, so this works as soon
as the vars are set. Pick the EU host if you want EU data residency for the
GDPR-friendly export story.

### Sentry: the DSN currently does nothing

`src/lib/observability.ts` is a **stub**. `captureException` writes to the
structured logger and the DSN is explicitly unused:

```ts
// TODO(observability): forward to Sentry when SDK is wired and `dsn` is set.
void dsn;
```

`@sentry/nextjs` is **not** in `package.json`. Setting `SENTRY_DSN` today buys
you nothing — errors go to Railway logs only. Installing the SDK behind that
existing interface is a small follow-up; the call sites won't change. Set the
vars now if you like, but don't assume you have error monitoring until the SDK
is wired.

---

## 6. Post-deploy verification

1. `GET /api/health` returns 200 with `runner.started: true` and a recent
   `lastHeartbeatAgeMs`.
2. Sign in with GitHub and with Google.
3. Promote yourself to admin: `npm run make:admin` against the production
   database.
4. Create a tournament in `/admin`, open registration.
   - After **closing** registration, assign a published problem to every
     simulation round in the Timeline tab. `START_SIMULATION` refuses to open a
     round with no problem, so this is now a required step, not an optional one.
   - Confirm progression is automatic: once a round's deadline passes, the next
     round should open within ~30s without anyone pressing Progress. If it does
     not, check `runner.started` on `/api/health` — the sweep rides that loop.
     `SELECT id, status, "opensAt", "problemId" FROM "Round" WHERE status = 'OPEN'
     AND "problemId" IS NULL;` must always return zero rows.
5. Run one **real Razorpay test-mode payment** end to end (see below).
6. Confirm the webhook shows delivered in the Razorpay dashboard and appears in
   `/admin/payments` webhook history.
7. Confirm the prize pool moved by exactly one entry fee.
8. Refund that payment from `/admin/payments` and confirm the seat is released
   and the pool decreases.

### Razorpay sandbox pass — still outstanding

The automated suite (`npm run verify:payments`) covers the full matrix against a
deterministic fake gateway, so none of it has ever touched Razorpay's servers.
Before taking real money, run at least these against **test keys** on the
deployed URL: successful capture, cancelled checkout, failed payment then a
successful retry, a duplicate/replayed webhook, and a refund. The signature and
raw-body handling are the parts a fake gateway cannot truly prove.
