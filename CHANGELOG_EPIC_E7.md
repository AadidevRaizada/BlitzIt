# Epic E7 — Live Knockout Arena

**Status:** ✅ Complete · **Branch:** `epic-e7-live-arena`

The Sunday event, as a product surface. E3–E6 could already run a tournament to a champion; E7 is
what a competitor and a spectator actually look at while it happens.

## What was built

| Area | Detail |
|---|---|
| `tournament/timers.public.ts` | Pure timer arithmetic — phase, countdown, submission timing, clock-skew correction. Shared by the server and the browser so they cannot disagree. |
| `tournament/arena.public.ts` | Pure arena state derivation + the opponent-reveal rule |
| `tournament/arena.ts` | `getKnockoutArena`, `getMatchWindow`, `listMyLiveMatches` |
| `tournament/live.ts` | `getLiveSnapshot`, `getLeaderboard`, `snapshotVersion` — the single payload behind both live transports |
| `/api/live/[tournamentId]` | SSE stream + `?mode=poll` fallback |
| `hooks/use-live-tournament.ts` | `EventSource` with an automatic polling fallback |
| `components/features/countdown.tsx` | Server-authoritative countdown island |
| `components/features/live-refresh.tsx` | Re-runs the server render when the snapshot changes; connection indicator |
| `/arena/knockout/[matchId]` | Screen [10] |
| `lib/flags.ts` | Feature flags with an env kill switch (E7.4) |
| Dashboard | "Your matches" — the arena's entry point |
| `scripts/verify-live-arena.ts` | 99 checks |
| **E6 carry-over** | Sudden-death duration in the tournament configuration UI |

## The three ideas this epic rests on

### 1. A deadline is an instant, not a duration

The server owns `opensAt` and `deadlineAt` and publishes them with its own clock reading. The
browser measures its offset from that anchor **once** and renders `deadline − (localNow − offset)`.

- A wrong or deliberately-changed client clock shows the same time remaining as everyone else.
- A laptop that sleeps and wakes does not resume from where it paused — the next render recomputes
  from absolute time and snaps to the truth.
- Nothing in the browser can extend a deadline. The countdown is decoration; the Submission module
  refuses a late entry regardless of what is displayed. `verify:live-arena` proves the refusal.

### 2. Change detection without a message bus

D3 rules out Redis, so there is no pub/sub to subscribe to. Instead `LiveSnapshot` carries a
`version` — a hash over everything a human would notice changing — and the stream re-reads on an
interval, emitting only when the hash moves. `serverTime` and the countdown's ticking
`secondsRemaining` are excluded from the hash; the countdown's `targetAt` is included, because a
deadline actually moving *is* news.

The cost is one bounded query set per interval per connection. The benefit is no new
infrastructure and a polling fallback that is exactly as correct as the stream, because it returns
the identical payload.

### 3. The live channel decides *when* to re-render, never *what* is rendered

`LiveRefresh` watches the stream and calls `router.refresh()`. The arena and the bracket stay
server components. One rendering path, one authorization path, one reveal gate — the alternative
duplicates the reveal rule on the client, where it would eventually disagree with the server.

## Architectural decisions

| Decision | Rationale |
|---|---|
| **Windows stay scheduled per round; a "per-match window" is derived** | Every match at a stage must open at the same instant or simultaneous reveal is gone and whoever was paired into a later slot gets more thinking time on the same problem. One schedule means no drift between two records of the same deadline, and the fairness property holds by construction — the principle D26 makes explicit for future environment profiles. |
| **An opponent's progress is withheld while the window is open** | Knowing a rival has already submitted makes a competitor play the person instead of the problem — rush, or stop iterating. Nothing in the rules entitles them to it. After the window closes the same fact only explains a result. |
| **The arena is private to the two competitors** | It returns `null` (→ 404) for anyone else rather than throwing, so the page cannot leak "that match exists, but not for you". Spectators watch through the bracket [11] and the stream (D10). |
| **The live snapshot is public and carries only public facts** | D10 makes the landing page the spectator experience, so this payload must be safe to serve anonymously: usernames, seeds, placements, outcomes, counts. Never emails, never submission contents, never hidden tests, and never the challenge of a round that has not opened (`revealProblems: false`). |
| **The env flag override beats both PostHog and the admin bypass** | An operator must be able to kill the live arena mid-event without waiting on a third party, and "off" that quietly stays on for admins is not a kill switch. |
| **A missing PostHog defaults the flag ON** | An unconfigured analytics vendor must not be able to disable the product in dev, CI, or a deployment that never wired it. Turning it *off* is step 1's job. A PostHog *outage* is different from PostHog being absent: an error from a configured client falls back to the default and is logged. |
| **The live read model lives in the Tournament module, not a new one** | It reads `Ranking` and the bracket that module already owns. A module whose only job is to `SELECT` from another module's tables is a boundary in name only. It moves out when it grows a season standing of its own (E8/E9). |
| **`hasSubmission` was added to the Submission module** | The arena needs to know *whether* an opponent submitted. That is a fact about a `Submission`, so it belongs there — and returning a bare boolean means the arena cannot accidentally render a rival's repository URL. |
| **Streams are bounded** | A stream closes after `LIVE_STREAM_MAX_DURATION_MS` (default 15 min) with an `event: reconnect`; `EventSource` reconnects on its own. A forgotten spectator tab cannot hold a connection — and a database client — open for the whole event. |

## Migrations

**None.** E7 is entirely read models, routes and UI over the existing schema.

## Breaking changes

**None.** `SubmissionForm` moved from `app/(app)/submit/[roundId]/` to `components/features/` and
gained two optional props (`redirectTo`, `closedHint`); its default behaviour is unchanged.

## Bugs found during implementation

1. **The arena would have reported "no entry" for a competitor who had already submitted.**
   `ArenaView` initially read `Match.submissionAId` / `submissionBId`. Advancement writes those
   only when a match is **DECIDED**, so during the round they are null — the head-to-head panel
   would have told both competitors, mid-round, that neither had submitted. Caught by
   `verify:live-arena`. Fixed by removing the fields from the read model entirely and composing:
   the Tournament module decides whether the opponent's progress may be *shown*
   (`mayRevealOpponentProgress`), the Submission module answers whether they submitted
   (`hasSubmission`), and the page joins the two.

2. **`docs/17-tournament-lifecycle.md` still documented the pre-E6 decision rule** ("a fully
   scored match is still decided mid-window"), which E6's Codex finding 2 reversed. A stale
   architecture doc is a bug that ships later, so it is corrected here with the change marked.

3. **`README.md` carried duplicate, stale epic rows** (E5 twice, E6 listed both complete and "not
   started") — a leftover from the E6 merge. Corrected.

## Verification

| Suite | Result |
|---|---|
| `verify:live-arena` | **99/99** — new |
| `verify:tournament` / `bracket` / `tournament:e2e` | 197 / 119 / 134 — no regressions |
| `verify:sudden-death` | 55 — no regressions |
| `verify:submission` / `admin` | 179 / 89 — no regressions |
| `verify:evaluation` / `:e2e` / `profiles` | 38 / 26 / 40 — no regressions |
| `verify:auth` / `queue` / `runner` | 36 / 15 / 5 — no regressions |
| tsc · eslint · prettier · next build | all pass |

### Live transport, exercised against a running server

A verification script cannot test a streaming HTTP response, so the route was probed directly
against `next start`:

| Probe | Result |
|---|---|
| SSE headers | `text/event-stream`, `no-store, no-transform`, `x-accel-buffering: no` |
| First frames | `retry: 5000`, then `event: snapshot` |
| Quiet 20s stream | 1 snapshot + 1 `: heartbeat` — no spurious pushes |
| Mutation mid-stream | second `snapshot` frame carrying the new value |
| `?mode=poll` | identical JSON payload, `cache-control: no-store` |
| Invalid / unknown id | 400 / 404 |
| UNLISTED tournament | 404 on **both** transports |
| `/arena/knockout/<id>` anonymous | 307 → `/login` |
| `/arena/knockout/<unknown>` signed in | 404, not 500 |

## Deviations from the blueprint

| # | Deviation | Why |
|---|---|---|
| **1** | **Per-match windows are derived from the round, not stored per match** | E7.1 asks for "per-match windows". Storing a second schedule would break simultaneous reveal and let two records of the same deadline drift. The *view* is per match; the *schedule* is per round. See the decision table. |
| **2** | **The arena is server-rendered with two small islands, not a client-side subscriber** | Screen [10] is marked `[RSC + C]`, which this satisfies. Feeding a fully client-side arena from the snapshot would duplicate the reveal gate and the authorization check on the client. |
| **3** | **`LiveRefresh` is on the bracket [11] but the bracket is still a server component** | Screen [11] is marked `[C/SSE]`. It updates live, which is what the marking is for; making the tree itself a client component would ship a client bundle for a static read model with no interaction. |
| **4** | **The live read model lives in the Tournament module** | `04-module-breakdown.md` files live standings under module 9 (Leaderboard & Ranking). See the decision table; the doc is updated to record where it actually lives and when it would move. |
| **5** | **The dashboard gained a "your matches" panel** | Not an E7 task, but without it the arena is unreachable — a competitor would need to know a match id. Deliberately minimal; the full screen [6] is still ahead. |

## Intentionally deferred

- **Simulation Arena [8]** (`/arena/simulation`) — not in E7.1–E7.4, which are knockout-only.
  Simulation rounds are fully playable through [9] today; what is missing is the three-round index
  page. Now a small page rather than a feature, since the countdown island exists.
- **Rate limiting on `submitSolution`** — `11-api-specification.md` had pencilled it in for "the
  arena epic", but it is not in E7's task list. Moved to **E10 (hardening)**, where the load/burst
  and security work lives. See remaining risks.
- **Landing page / spectator embed** (E8, D10) — the snapshot that will feed it exists and is
  already public-safe.
- **Leaderboard screen [12]** — `getLeaderboard` supports `score | seed | city`; the page is E8.
- **A shared live channel across connections** — every SSE connection currently runs its own read
  loop. See remaining risks.

## Remaining risks

| Risk | Assessment |
|---|---|
| **No submit rate limiting during a live event** | The real gap. Exposure is bounded by the submission window, the duplicate-entry check and the deployment-URL-reuse check, but a determined competitor can hammer the action. E10. |
| **SSE cost scales with connections, not with change** | Each connection re-reads the snapshot every `LIVE_STREAM_POLL_MS`. Fine for one tournament and a modest audience; a large spectator crowd wants one shared read loop broadcasting to all subscribers (a single in-process cache, still no Redis). The seam is `getLiveSnapshot` — nothing else needs to change. |
| **Serverless platforms and long-lived streams** | Bounded to 15 minutes with automatic client reconnect, which suits Railway. A platform with a shorter request ceiling needs `LIVE_STREAM_MAX_DURATION_MS` lowered to match. |
| **Snapshot size at a 64-slot bracket** | ~63 matches plus 25 leaderboard rows per frame, sent only on change. Acceptable; if it grows, the bracket becomes its own event rather than part of the snapshot. |
| **`prizePoolMinor` is published but not yet computed** | Payments are E4-deferred and prize computation is E9. The snapshot reports the stored column, which is currently 0. |

## Manual actions

- **None required to run.** All four new environment variables have defaults:
  `LIVE_STREAM_POLL_MS` (3000), `LIVE_STREAM_HEARTBEAT_MS` (15000),
  `LIVE_STREAM_MAX_DURATION_MS` (900000), `LIVE_LEADERBOARD_TAKE` (25).
- **To roll the arena out gradually:** create a `live-arena` flag in PostHog. Without one it is
  simply on.
- **To kill it during an event:** set `FEATURE_LIVE_ARENA=false` and restart. This beats PostHog
  and the admin bypass.
- **Behind nginx:** the route sets `X-Accel-Buffering: no`; any other proxy in front of it needs
  response buffering disabled for `/api/live/*` or the fallback will be doing the work.
