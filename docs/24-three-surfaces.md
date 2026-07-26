# 24 — Three surfaces, one product

> **Status:** approved direction · **Delivery:** three phases, sequenced · **Owner:** Codex
> **Supersedes:** `docs/design-system.md` §1's two-register split, and the flat authenticated
> navigation in `(app)/layout.tsx`.

## 1. The diagnosis

We do not have a styling inconsistency. We have **two products that happen to share a database**:

- **Product A** — an esports broadcast site (`(marketing)`)
- **Product B** — a CRUD SaaS panel (`(app)`)

Crossing between them changes the colour scheme, the typography and the navigation shape at once.
That is why the dashboard feels like a different website: it is one.

The fix is to stop thinking in pages and think in **surfaces**.

## 2. The three surfaces

| Surface | Who | Purpose | Character |
|---|---|---|---|
| **Broadcast** | everyone, signed out | Watch. Explore. Get excited. | Very visual. No forms, no tables. |
| **Competitor Workspace** | signed in | "What do I need to do right now?" | Tournament-first. Dense where the work is. |
| **Operations** | admins | Run the event | Dense, quiet, unchanged in character |

**Broadcast** holds: Home, live tournament, upcoming tournaments, Leaderboard, Hall of Fame,
Rules, public brackets, public results.

**Workspace** holds: Mission Control, the active tournament, and history.

### One visual language, three densities

The home page style is the reference — dark broadcast tokens, Chakra Petch display, mono labels,
hairline borders. **Every surface uses the same tokens, type and components.** What differs is
*density and scale*, not identity:

| Surface | Density |
|---|---|
| Broadcast | Generous. Large type, big numerals, room to breathe. |
| Workspace | Tight. Same palette and components, smaller type, compact controls. |
| Operations | Tightest. Built for scanning hundreds of rows. |

This resolves the apparent tension between "unify the UI of all pages" and "keep work surfaces
scannable". They are the same instruction: one brand, adjusted spacing. A submissions table on
broadcast tokens at workspace density is still obviously the same product as the landing page.

## 3. Navigation

```
Home · Competitions · Leaderboard · Hall of Fame · Compete
                                                   └─ avatar ▾ : Profile · Settings · Admin · Log out
```

Nothing else. The authenticated shell stops carrying nine flat links, and public destinations stop
appearing twice in two different styles.

**Removed as top-level destinations:** Submissions, Results, Notifications, Profile, Settings.

## 4. Mission Control

`/compete` answers one question: *what do I do right now?*

```
Builder Cup #28
Registration closes in 2h 41m
───────────────────────────────
YOUR STATUS      ✓ Registered
                 ✓ GitHub connected
                 □ Submit your entry
───────────────────────────────
Current phase    Registration
Next action      Deploy your project   [Continue]
```

Below it: recent notifications, latest evaluations, latest submissions — as *summaries with links*,
not as navigation to ten places.

### Inside a tournament

```
Overview · Bracket · Challenge · Submission · Evaluation · Results
```

Everything about **that** tournament, in one place.

### When no tournament is active

Mission Control becomes **history**, so the surface never feels dead:

```
Builder Cup #25   2nd place
Builder Cup #24   Winner
Builder Cup #23   Round of 16
```

## 5. The strongest idea in this brief

**"Submissions" stops being a global page.** Nobody wakes up wanting to see their submissions.
They want to work on *this tournament*. So the flow becomes:

```
Tournament → Challenge → Submit → Evaluation → Bracket → Result
```

Global history survives as an archive inside the workspace, not as a top-level destination.

## 6. Decisions taken — confirm or correct

### 6.1 "Tournaments" vs "Competitions" — **defaulting to Tournaments**
The earlier decision was *"rename Competitions to Tournaments — it immediately tells a user what
they'll find there"*, with that reasoning. The latest sketch says Competitions. `/tournaments` is
already built and linked from the landing page. **Default: keep `Tournaments`.** Flipping it is a
label change plus one redirect — cheap, but say so explicitly.

### 6.2 "Dashboard" → **`Compete`**
Label becomes `Compete`; the route moves `/dashboard` → `/compete` with `/dashboard` redirecting.
"Compete" states intent; "Dashboard" describes furniture.

### 6.3 Checklist rows must stay verifiable
`✓ Registered` and `✓ GitHub connected` are derivable. **`□ Deploy API` is not** — we have no way
to know whether someone deployed until a submission carrying a `deploymentUrl` exists, at which
point it is indistinguishable from `□ Submit`. **Default:** the checklist ships
`Registered · GitHub connected · Submitted`, and "Deploy your project" appears as the *next-action
prompt* (which is honest — it is advice, not a claim about state). A checkbox that can never tick
is worse than no checkbox.

### 6.4 Does Operations get the shared tokens? — **yes, in Phase 3**
Admin keeps its density and its own navigation, but adopts the shared tokens and shell identity.
Leaving it as the one surface that looks like a different product just moves the problem rather
than solving it. It is Phase 3 work and can be dropped without affecting Phases 1–2.

## 7. Delivery — three phases, not one epic

Redesigning shell, navigation, routing, redirects, IA and styling simultaneously is where
regressions come from. Each phase ships independently and leaves the product working.

### Phase 1 — Unify the shell
- One header and navigation across broadcast and workspace; shared tokens applied to `(app)`.
- **Fix the broken public bracket route** (below).
- Every existing route keeps working. No routes move. No IA change.
- *Outcome: it stops feeling like two websites.*

### Phase 2 — Rebuild the workspace
- Replace the dashboard with tournament-first Mission Control at `/compete`.
- Submissions, evaluations, results, notifications and profile become workspace sections.
- Old URLs redirect — **never 404**. Notification emails already link to `/results`.
- *Outcome: the competitor journey is one place.*

### Phase 3 — Cleanup
- Remove duplicate navigation and obsolete pages.
- Apply shared tokens to Operations (§6.4).
- Update `design-system.md` §1, `12-ui-screens.md`, `23-user-flow-and-ia.md`.
- Verify every redirect, auth flow, notification link and deep link.

## 8. Bug to fix in Phase 1

**`/bracket/[tournamentId]` is unreachable for spectators.** It lives under `(app)`, so the
guarded layout redirects signed-out visitors to `/login` — verified: `307 → /login`. The page
itself is written to be public (tolerates a null user, 404s unlisted tournaments), but the route
group never lets it run. The landing page's "Full bracket →" is therefore an auth wall on the most
public surface we own, which breaks D10.

## 9. Constraints (all phases)

- All 14 suites pass; `typecheck` / `lint` / `prettier --check` / `build` clean.
- No reveal gate or authorization check weakened; unlisted and archived never public.
- Deep links preserved by redirect, never removed.
- `/u/[username]` stays the **public** profile (badges and placements only, never scores or code —
  D28). Private profile editing lives in the workspace.
- Pages stay server components; interactivity in client islands.
- **Never fabricate data.** Derive it or omit the element.
