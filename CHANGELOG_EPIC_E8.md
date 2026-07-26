# Epic E8 — Spectator Landing, Leaderboard, Notifications & Hall of Fame

**Status:** ✅ Complete · **Branch:** `epic-e8-spectator-notifications`

E7 made the tournament live. E8 makes it *watchable* — and makes it reach people who are not
looking at the page.

## What was built

| Area | Detail |
|---|---|
| `/` (screen [1]) | The spectator experience (D10): stream embed, live numbers, current round, bracket, standings, weekly explainer, Hall of Fame teaser |
| `/leaderboard` (screen [12]) | Public standings by score / seed / city |
| `/results` (screen [13]) | A competitor's own history — every score with a link to its evidence |
| `/notifications` (screen [14]) | In-app list, read state, unread badge in the header |
| `/hall-of-fame` (screen [3]) | Every published champion, runner-up and third place |
| `/u/[username]` (screen [4]) | Badges and placements added |
| `server/modules/notification/` | Intents, dedupe, channel policy, copy, templates, `Mailer`, delivery |
| `server/modules/hall-of-fame/` | Badge catalogue, award rules, podium, publication |
| `tournament/notifications.ts` | Derives notifiable events from persisted state |
| `tournament/live.ts` | `getSpectatorTournamentId`, `listMyResults`, `listPublicPlacements` |
| `jobs/processors/send-email.ts` | The `sendEmail` job |
| `components/features/` | `LiveLeaderboard`, `StreamEmbed` |
| `scripts/verify-spectator.ts` | 105 checks |

## The ideas this epic rests on

### 1. Notifications are derived, not fired

The obvious design scatters `raiseNotification(...)` through the lifecycle — one in `openRound`,
one in `decideAndPropagate`, one in `applyTransition`. That couples the bracket engine to a
delivery concern and, worse, makes notifications depend on **control flow**: anything reaching a
state by another path (a replayed job, a forced transition, a restart resuming mid-round) silently
notifies nobody.

So `syncTournamentNotifications` derives events from **persisted state**, exactly as
`progressTournament` derives what to advance. A competitor is told they advanced because the match
says they did, not because a particular function happened to run.

### 2. Idempotency is a database property

`Notification.dedupeKey` is `@unique` and built from what happened (`TYPE:userId:scopeId`), and
inserts use `createMany({ skipDuplicates: true })`. Two runners racing on one event produce one
notification between them — no check-then-insert, no window. **Only keys that were actually
created get an email job**, so a replay that inserted nothing sends nothing.

`verify:spectator` runs the sweep twice and asserts the second pass raises zero.

### 3. The mail provider is a configuration detail

`Mailer` is an interface with exactly one factory mapping configuration to an implementation —
the same shape D18 imposed on the LLM provider. Nothing above `mailer.ts` knows Resend exists.
With no key configured the `noopMailer` logs and reports `skipped`, which is how the product
behaves in development, in CI, and in any deployment that never wired email. **A missing mail
vendor must never fail a lifecycle transition.**

## Architectural decisions

| Decision | Rationale |
|---|---|
| **One `Notification` row per event, not per channel** | A competitor gets one notification per thing that happened, rendered into whichever channels the policy names. A row per channel would let the email and the in-app entry drift apart and be marked read independently. |
| **Every type is in-app; email is selective** | The list at [14] is the competitor's record of what happened — an event missing from it looks like a tournament bug. Email is for things worth interrupting someone for. `PRIZE_POOL_UPDATE` is in-app only: it changes on every registration and would be spam. |
| **Copy is pure and shared** | `notificationContent` decides the words; the email template and the in-app list both render it. A competitor reading their inbox and their notification list is never told two different things about one event. It never throws on an unexpected payload — a notification is not the place to discover an organiser's typo. |
| **The Hall of Fame is published automatically, and is idempotent** | Left to an operator it would sit one forgotten click behind reality. The podium is re-derived on every publish, so a later correction (a disqualification, a re-evaluation) propagates — but `publishedAt` is not touched, because a tournament was first published when it was first published. |
| **Participant count and prize pool are frozen onto the record** | The tournament's own counters keep moving (archival, reconciliation). History must not. |
| **The badge catalogue lives in code** | A badge that could be renamed or re-scoped after it was awarded would rewrite history for whoever holds it. `Badge` rows are a projection, synchronised at award time. |
| **Badges are cumulative** | A champion also holds `semi-finalist` and `qualifier`, because both are true. A profile showing only the highest badge would make a champion look like they had never qualified. |
| **`semi-finalist` is placement ≤ 4, not "played in the SF round"** | With the third-place play-off disabled (D6) the losing semi-finalists share placement 3; keying off the round would need the bracket rather than the standings. For the same reason, third place is only *named* when exactly one competitor holds it — otherwise picking one would be an arbitrary choice presented as a result. |
| **Public placements are a narrower read than private results** | `listPublicPlacements` returns no submission, no score and no evidence, so a public page physically cannot render one (D28: competitors own their code; placements are public, contents are not). |
| **The spectator resolver is priority-ordered** | The landing page has no id in its URL, so `getSpectatorTournamentId` answers "what is happening right now?" — live beats registering beats announced beats last finished. Unlisted and archived never qualify: a rehearsal must not become the homepage. |
| **The stream embed validates the URL** | An operator pastes whatever YouTube gave them; the component accepts every real form and refuses anything else, so a typo can never become an `iframe src` pointing at an arbitrary origin. |

## Migrations

`20260726180000_e8_notifications` — **additive only**:
- `JobType += SEND_EMAIL`; `NotificationType += ADVANCED, TOURNAMENT_COMPLETE`
- `Notification += readAt, attempts, lastError, tournamentId` + an index for the in-app list
- `HallOfFame += thirdPlaceId, participantCount, prizePoolMinor`

No existing column or constraint changed. An E7 deployment runs unmodified against this schema.

## Breaking changes

**None.** `ProgressResult` gained a `notificationsRaised` field (additive).

## Bugs found during implementation

1. **React Email cannot render in the runtime that sends our email.** `@react-email/render`
   depends on `react-dom/server`, which throws under the `react-server` module condition — the
   condition the Next server runtime, and therefore our in-process job runner, resolves modules
   under. Measured rather than assumed:

   ```
   node --conditions=react-server …render(createElement('div'))
     → Error: react-dom/server is not supported in React Server Components
   node …                                → renders fine
   ```

   A template that only works outside the runtime that sends the email is not a template. Replaced
   with a string builder (see deviations). Three dependencies removed.

2. **An email job for a deleted notification retried to dead-letter.** The processor treated
   `NOT_FOUND` as transient, so an unrunnable job burned three attempts and left a dead-letter row
   for an operator to triage. It is now discarded on the first attempt, like a payload with no id.
   Found because the suites left such jobs behind.

3. **Every suite that runs a tournament now creates notifications**, which reference `User` — so
   their cleanup failed on a foreign key, and their `sendEmail` jobs (keyed on a dedupe key that
   carries no suite tag) were claimed by *other* suites' runners and failed there. Four suites'
   cleanup was extended. This is the kind of cross-suite coupling that only appears once a feature
   touches everything.

## Codex review

Three findings, all P2. **All three were genuine and are fixed**, each with a regression check.
No false positives. Two are user-visible correctness bugs and one is a privacy leak; notably, one
of them had been *enshrined in this suite as intended behaviour*, which is the most useful kind of
finding a reviewer can produce.

| # | Severity | Finding | Verdict & fix |
|---|---|---|---|
| **1** | P2 | **The third-place winner was told the next round opens.** The ADVANCED/ELIMINATED sweep excluded only `FINAL`, so a decided `THIRD_PLACE` match raised `ADVANCED` — whose copy reads "the next round opens on schedule" — for someone who had just finished third and was done. Its loser was told they were "eliminated" at a stage they reached by getting to the last four. | **Confirmed.** `THIRD_PLACE` is as terminal as `FINAL` and is now excluded alongside it. Both competitors are covered by `TOURNAMENT_COMPLETE`, which states their actual placement. |
| **2** | P2 | **The third-place badge contradicted its own description.** With the play-off disabled (D6) both losing semi-finalists share placement 3, and both were awarded a badge defined as "won the third-place play-off" — for a play-off nobody played. It also contradicted `podiumFromPlacements`, which deliberately refuses to name a third in that case. | **Confirmed, and I had asserted the wrong behaviour in the suite.** The badge is now awarded only when exactly one competitor holds placement 3. Both shared thirds keep `semi-finalist`, which is exactly what they achieved. The offending check was replaced with three that assert the corrected rule. |
| **3** | P2 | **Unlisted tournaments leaked through public profiles.** `publishHallOfFame` awards `UserBadge` rows for any completed tournament, and `/u/[username]` read them unfiltered — so a badge would display the *name* of a rehearsal tournament that is deliberately unannounced everywhere else. `listPublicPlacements` already applied the visibility filter; badges were the other half nobody had filtered. | **Confirmed.** `listUserBadges` takes `publicOnly`, which the public profile passes. A competitor still sees every badge on their own `/results`. |

**On finding 2:** the value of an independent review is precisely that it does not accept a test
as evidence of correctness. My suite asserted that both shared thirds get the badge; the reviewer
read the badge's *description* and the podium rule and noticed all three disagreed.

## Verification

| Suite | Result |
|---|---|
| `verify:spectator` | **114/114** — new (105 + 9 Codex regressions) |
| `verify:tournament` / `bracket` / `tournament:e2e` | 197 / 119 / 134 — no regressions |
| `verify:live-arena` / `sudden-death` | 103 / 55 — no regressions |
| `verify:submission` / `admin` | 179 / 89 — no regressions |
| `verify:evaluation` / `:e2e` / `profiles` | 38 / 26 / 40 — no regressions |
| `verify:auth` / `queue` / `runner` | 36 / 15 / 5 — no regressions |
| tsc · eslint · prettier · next build | all pass |

**DoD evidence** — `verify:spectator` runs a full 8-competitor tournament from registration to a
published champion and asserts: the confirmation email is raised once and only once; the in-app
copy matches the email copy; a provider failure is rethrown for the queue and recorded on the
notification; a round opening notifies both competitors in every match with a link straight to
their arena; the sweep is idempotent across three separate runs; the champion is told they
advanced and that the tournament finished; a knocked-out competitor is told where their run ended;
badges and podium are correct including the shared-third case; republishing changes nothing; and
an unlisted tournament is withheld from both the Hall of Fame and a public profile.

## Deviations from the blueprint

| # | Deviation | Why |
|---|---|---|
| **1** | **Email templates are a string builder, not React Email** | Not a preference — `@react-email/render` throws under the `react-server` condition our job runner uses (evidence above). The layout is the same one a React Email component produces, so swapping back is a rewrite of one file. |
| **2** | **Screens [1], [12] are server-rendered + `LiveRefresh`, not `[C/SSE]` client components** | They update live, which is what the marking is for. A client-side rebuild would duplicate the reveal rule that hides an unopened round's challenge — on the one page the whole internet can see. |
| **3** | **The Hall of Fame is its own module, not part of Leaderboard & Ranking (module 9)** | Rankings are live and recomputable; a Hall of Fame entry is frozen. Documented in `04-module-breakdown.md`. |
| **4** | **`MATCH_REMINDER` exists but nothing raises it** | A "your window is closing" reminder needs a scheduled trigger part-way through a round, which is cron wiring rather than a notification concern. The type, copy and channel policy are in place; the trigger is E10 ops work. |
| **5** | **No notification preferences** | The blueprint does not define them, and the footer links to `/settings` where they will live. Every type is currently on. |

## Remaining risks

| Risk | Assessment |
|---|---|
| **The notification sweep re-derives every event on every progress pass** | Cost is proportional to bracket size, not to what changed: for a 64-player bracket that is ~127 intents inserted with `skipDuplicates` each pass. Correct and cheap at V1 scale; if a tournament ever gets much larger, the sweep should be bounded by "changed since last pass". |
| **No unsubscribe link** | The footer points at `/settings`, which does not yet expose preferences. Before sending to a real list this needs a genuine opt-out — a compliance matter, not just a feature. |
| **Resend is unverified in production** | The adapter is exercised only through the recording mailer; no live send has been made. The first real send needs a verified sending domain and one manual test. |
| **`prizePoolMinor` is displayed but never computed** | Prize computation is E9. The landing page reports the stored column, which stays at whatever an operator sets. |
| **Rate limiting on `submitSolution`** | Still outstanding, still E10. Unchanged by this epic. |

## Manual actions

- **To enable email:** set `RESEND_API_KEY` and `EMAIL_FROM`. Without both, notifications are
  in-app only and every send is logged as skipped — no error, no retry storm.
- **Verify the sending domain in Resend** before the first real send.
- **Set `Tournament.youtubeStreamUrl`** for the stream to appear on the landing page. Any YouTube
  URL form works; anything else renders the "not live yet" placeholder.
- **Run the migration** `20260726180000_e8_notifications`.
- No badge seeding needed — the catalogue synchronises itself on first publish.

## Intentionally deferred

- **`MATCH_REMINDER` trigger** — cron wiring (E10).
- **Notification preferences / unsubscribe** — see risks.
- **Season standings** (`SeasonStanding`) — the model exists; nothing in E8 needs it.
- **Prize computation and payouts** — E9.
- **`/rules` (screen [2])** — a static explainer; the scoring summary now lives on the landing page.
