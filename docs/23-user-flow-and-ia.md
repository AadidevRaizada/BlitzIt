# 23 — Information Architecture & the competitor journey

> **Status:** approved direction, ready to build · **Owner:** Codex
> **Supersedes:** the ad-hoc navigation in `(marketing)/layout.tsx` and the placeholder dashboard.

## 1. The problem this fixes

`registerForTournamentAction` exists, is verified, and **nothing in the UI calls it**. There is no
competitor-facing tournament list in either route group. The engine can run a full event end to
end; a human cannot enter one.

Secondary gaps: no simulation-round entry point, a dashboard that only knows about knockout
matches (so it is blank during registration and qualifiers), and a `Play` nav item that goes
nowhere.

## 2. Information architecture

```
Home · Tournaments · Leaderboard · Hall of Fame · Dashboard
```

**`Play` is removed.** Play is not a destination — a tournament is. `Tournaments` is named for
what a user will find there, not for what they will do.

`Dashboard` is always present in the nav. Signed out, it routes through
`/login?next=/dashboard` — consistent with the rule below.

### The auth rule

**Browsing is public. Sign-in happens at the moment of joining, not before.**

Public: `/`, `/tournaments`, `/tournaments/[slug]`, `/leaderboard`, `/hall-of-fame`, `/rules`,
`/u/[username]`, `/bracket/[id]`.
Authenticated: `/dashboard`, `/arena/*`, `/submit/*`, `/submissions`, `/results`,
`/notifications`, `/settings`.

Joining while signed out goes to `/login?next=/tournaments/<slug>&intent=join` and completes the
join on return, so intent survives the OAuth round trip.

## 3. The journey

```
Landing → Tournaments → Tournament → Register → Dashboard → Arena
       → Submit → Evaluation → Bracket → Next round → Results → Hall of Fame
```

**Home is not where you play.** It is why this is worth watching — the live event, the stream,
the bracket, the standings. People arrive to watch; registering is a path off it, not its purpose.

## 4. `/tournaments` — the most important page after Home

Public. Grouped, in this order:

| Section | Tournament status | Card action |
|---|---|---|
| **LIVE NOW** | `SIMULATION`, `SEEDING`, `BRACKET_GENERATED`, `LIVE` | Watch live |
| **REGISTERING** | `REGISTRATION_OPEN` | Register |
| **COMING SOON** | `PUBLISHED`, `REGISTRATION_CLOSED` | *(see §8.1)* |
| **PAST** | `COMPLETED` | View results |

`DRAFT`, `CANCELLED`, `UNLISTED` and archived tournaments never appear.

Card content: name, field size, current stage, prize pool, entry cost, and a real countdown
(registration closing, or next round) — all from real fields.

## 5. `/tournaments/[slug]` — the tournament page

Sections, in order: **header** (name, status, prize pool, start date) → **format** (category,
bracket size, third-place) → **timeline** (the real schedule) → **rules** → **evaluation** (D2
weights and the D20/D22 rule that AI scoring applies only from the semi-finals) → **FAQ** →
**register**.

### Register, by state

| Viewer state | What they see |
|---|---|
| Signed out | **Register** → `/login?next=…&intent=join` |
| Signed in, never joined | **Register** → agree to rules → payment step → registered |
| Already registered | **Registered** · waiting for the tournament |
| Registered, tournament started | **Go to Arena** |
| Registration closed / full | Why, and when the next one opens |

## 6. Payment — build the flow, not the integration

The step exists from day one so the flow never has to change:

```
Register → eligibility → PAYMENT STEP → registered
                          ├─ today:  "Free beta — no entry fee"
                          └─ later:  ₹100 → Razorpay → registered
```

Today the payment step renders as a free-beta confirmation. When Razorpay lands it becomes a real
charge **in the same slot**. No screen moves.

**Consequence to state plainly on the page:** while entry is free the prize pool is ₹0, because
D9/D12 make the pool a function of paid entries. Do not display a pool that does not exist.

## 7. Dashboard — a tournament companion, not a card grid

The dashboard knows exactly where you are and shows **one** primary thing:

| Your state | Dashboard shows |
|---|---|
| Registered, pre-qualifiers | Countdown to the first round + readiness checklist |
| Qualifiers open | Which of the three rounds is live → **Enter round** |
| Between rounds | Next round, when it opens |
| Round open, you are in a match | **Join arena** + time remaining |
| Submitted, judging | "Judging" + evaluation status |
| Advanced | "Qualified — quarter-finals, starts in X" |
| Eliminated | Where you finished → results |
| No tournament | Next tournament + register |

### Readiness checklist — only what we can actually verify

The checklist is real state, never decoration. Ship **only** items we can derive:

| Item | Source | Ship? |
|---|---|---|
| GitHub connected | `AuthAccount.providerId = 'github'` | ✅ |
| Profile picture set | `User.avatarUrl` | ✅ |
| Display name / city set | `User` | ✅ |
| Registered for this tournament | `isRegistered` | ✅ |
| "Deployment tested" | **no such concept exists** | ❌ omit |
| "Read the rules" | **not tracked** | ❌ omit |

Adding a checklist row we cannot verify would be the same fabrication problem as the mock's
`SHIPS / MIN`. If those two rows are wanted, they need real tracking first.

## 8. Decisions taken, and what needs your word

### 8.1 "Notify me" on COMING SOON — **deferred by default**
There is no watch-list concept and no `TournamentWatch` model. Doing it honestly needs a new
table plus a notification raised when a tournament reaches `REGISTRATION_OPEN` — a schema change,
which is outside the approved scope. **Default: the COMING SOON card shows the opening date and
no button.** Approve the model and it becomes a one-epic addition.

### 8.2 Rules acceptance — **recorded, not just checked**
D28 makes the IP terms binding at entry, so a client-only checkbox is too weak. **Default:** the
checkbox is required, and acceptance is written to the existing `AuditLog`
(`action: 'tournament.registerAccepted'`) at registration — no schema change. If you want it as a
first-class column on `Registration`, that is a migration and needs approval.

### 8.3 Format and difficulty on the tournament page
`Tournament` has no `difficulty`, and category enablement (D17: REST_API only at launch) may not
exist as a per-tournament column. **Default:** show category from the assigned problems where
available, otherwise the D17 launch default; **omit difficulty** rather than invent one.

### 8.4 Prize pool while free
Show ₹0 honestly with the free-beta note. Do not show an aspirational figure.

## 9. Approved backend additions

These three, and only these:

1. **`listPublicTournaments(options)`** — `listTournaments` filters neither visibility nor
   `archivedAt`, so it is not public-safe. New read, grouped by the §4 buckets.
2. **`getMyTournamentState(userId, tournamentId)`** — one read powering both the tournament page
   and the dashboard: registered, seed, current round, current match, submission state, placement.
3. **Schedule fields on `LiveSnapshot`** — `registrationOpensAt`, `registrationClosesAt`,
   `simulationOpensAt`, `simulationClosesAt`, `liveStartsAt`. Also unblocks the week strip that
   was cut from the landing page in `docs/22`.

Everything else stays read-only against existing modules.

## 10. Constraints (unchanged)

- All 14 verification suites pass; `typecheck` / `lint` / `prettier --check` / `build` clean.
- No reveal gate or authorization check weakened. Unlisted and archived never public.
- Pages stay server components; animation and polling stay in client islands.
- `(admin)` is not restyled.
- **Never fabricate data.** Derive it or omit the element.

## 11. Definition of done

- [ ] A signed-out visitor can browse tournaments, open one, click Register, sign in, and land back registered
- [ ] `Play` is gone from the navigation; `Tournaments` is in it
- [ ] The dashboard shows the correct single next action in every phase of the week
- [ ] The readiness checklist contains only verifiable items
- [ ] Payment renders as a free-beta step that a real charge can drop into unchanged
- [ ] 14 suites + 4 gates green
- [ ] New reads covered by `verify:spectator` or a new suite
