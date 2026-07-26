# 22 — Integrating the `Home.dc.html` design into the live site

> **Source:** Claude Design project *"Esports site dynamic directions"*, file `Home.dc.html`
> (mirrored at [`design/Home.dc.html`](./design/Home.dc.html)).
> **Owner:** Codex · **Builds on:** [`21-ui-redesign-plan.md`](./21-ui-redesign-plan.md).

## 1. What this is

A finished visual direction for the landing page, authored in the Claude Design canvas. It is a
**mock**: `{{ … }}` bindings, `sc-for` / `sc-if`, and a `DCLogic` class that generates *fake*
data. The mock's preview runtime (`support.js`) is not shipped and is not needed.

The job is to render **this design**, driven by **our real data**, with the animation moved from
CSS keyframes to **anime.js**.

## 2. The rule that matters most: never fabricate data on a public page

The mock invents metrics we do not have. The landing page is the most public surface we own, and a
plausible-looking number that is actually made up is worse than no number. For every panel:

**derive it from a real field, or cut the panel. Never invent.**

### Binding map — mock token → real source

`getSpectatorSnapshot()` returns `LiveSnapshot` (see `src/server/modules/tournament/live.ts`).

| Mock token | Real source | Notes |
|---|---|---|
| `competitors` | `snapshot.participantCount` | ✅ real |
| `prizePoolText` | `snapshot.prizePoolMinor` via `formatMinor` | ✅ real (currently 0 until E9) |
| `weekLabel` | `snapshot.name` | ✅ real — use the tournament name, not "WEEK 05" |
| `stageLabel` | `snapshot.currentStage` / `snapshot.status` | ✅ real |
| `cdH/cdM/cdS` | `snapshot.countdown` | ✅ real — **reuse `<Countdown>`**, do not reimplement the clock |
| `nextLabel` | `snapshot.countdown.of` | ✅ real (`ROUND`, `REGISTRATION_CLOSES`, …) |
| `broadcastBadge` / `tickerTag` | `snapshot.status === 'LIVE'` | ✅ real |
| `streamNote` + broadcast panel | `snapshot.youtubeStreamUrl` | ✅ real — use `<StreamEmbed>`; it already renders a placeholder when unset |
| `standings` rows | `snapshot.leaderboard` | ✅ real — `username`, `city`, `simulationScore`, `placement` |
| `r32/r16/qf/sf` bracket nodes | `snapshot.bracket` | ✅ real — **must keep `revealProblems: false` semantics**; `snapshot.bracket` is already built that way |
| `championName` / `championMeta` | `listHallOfFame({ take: 1 })` | ✅ real |
| Week schedule strip (TUE–THU … MONDAY) | `registrationOpensAt`, `registrationClosesAt`, `simulationOpensAt`, `simulationClosesAt`, `liveStartsAt` + `status` | ⚠️ derive phase state from the real schedule. Do not hardcode days. If a tournament has no schedule set, render the strip in a neutral "not scheduled" state |
| `satProgress` | derive from the current round's `opensAt`/`deadlineAt` | ⚠️ real elapsed fraction only |
| `seatsLeft` | `maxRegistrations - participantCount` | ⚠️ only when `maxRegistrations` is set; otherwise **drop the tile** |
| `shipsPerMin` | ❌ **no such metric exists** | **Cut it.** Replace the 4th stat tile with `matchesDecided / matchesTotal` from `snapshot.currentRound`, which is real |
| `judgeQueue` | ❌ `getQueueHealth()` is **operator data** | **Cut it.** Queue depth is an ops signal and does not belong on a public page |
| `feed` (event feed) | ❌ no public event feed exists | **Cut the panel, or** build it from facts already in the snapshot (a match was decided, a round opened, a tie needs a decider). No `AuditLog`/`OpsEvent` — those are admin-only. If it cannot be built honestly from the snapshot, cut it |
| `row.delta` (rank ±) | ❌ rank history is not stored | **Cut the column** |
| `dockState`/`dockTitle`/`dockClock`/`dockCta` | `listMyLiveMatches(user.id)` | ✅ real, but **only for a signed-in competitor with a live match**. Hide the dock entirely otherwise — never show a fake "your next match" |
| `TC` monogram, "The Circuit" | the product name as it now stands in the codebase | consistent with the rest of the app |

**If a panel cannot be driven by real data, remove it from the layout rather than shipping a
placeholder.** The design survives losing a tile; our credibility does not survive inventing one.

## 3. anime.js

Install: `npm i animejs` (v4, MIT). ESM named imports only — the global `anime` object is gone in
v4:

```ts
import { animate, createTimeline, stagger, utils } from 'animejs';
```

Replace the mock's CSS `@keyframes` with anime.js equivalents:

| Mock keyframe | anime.js |
|---|---|
| `slam` (hero lines) | `createTimeline()` with three `animate()` steps, or `animate('.hero-line', { … delay: stagger(130) })` |
| `rise` (subhead, CTAs, stat grid) | `animate(el, { opacity: [0,1], translateY: [10,0], delay: stagger(100) })` |
| `tick` (ticker marquee) | `animate(track, { translateX: ['0%','-50%'], loop: true, ease: 'linear', duration: 38000 })` |
| `blink` (live dot) | `animate(dot, { opacity: [1,.12], loop: true, alternate: true, duration: 600 })` |
| `sweep`, `scanline`, `pulsering`, `drift` | `animate(..., { loop: true })` with the same timings |
| stat counters | `animate(obj, { value: [0, target], round: 1, onUpdate })` — count up to the **real** number |

### How to animate without breaking the architecture

Pages stay **server components**. Animation goes in small **client wrappers that take
`children`** — the server renders the markup and the data, the client only animates the DOM:

```tsx
'use client';
export function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) { … }
```

Do **not** move data fetching, formatting or the reveal gate to the client to make animation
easier. If an animation seems to require that, drop the animation.

### Reduced motion

Every animation needs a no-motion path:

```ts
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
```

Elements must be **visible in their final state without JS** — animate *from* a visible baseline,
or set the start state in the same effect that animates. A user with JS disabled or a slow
hydration must never see a blank hero.

## 4. Constraints (unchanged from `21-ui-redesign-plan.md` §2)

1. **No `src/server/**` changes.** If a real read is genuinely missing, report it — do not add one.
2. **All 14 verification suites pass**, and `typecheck` / `lint` / `prettier --check` / `build`.
   (`verify:runner` needs port 3000 free.)
3. **No reveal gate or authorization check weakened.** The bracket on this page comes from
   `snapshot.bracket`, which is already built with `revealProblems: false`. Keep it that way.
4. **Do not restyle `(admin)`.**
5. Keyboard navigable; visible focus rings; the left rail and sticky dock must not trap focus.
6. Responsive: the mock is a desktop layout. The 92px rail, the 5-column week strip and the
   two-column body all need a mobile story.

## 5. Definition of done

- [ ] `/` renders the design, driven entirely by real snapshot data
- [ ] Every panel that cannot be driven by real data is **removed**, and the removal is listed in the changelog
- [ ] anime.js drives the motion; `prefers-reduced-motion` fully honoured; no blank content without JS
- [ ] All four landing states still work: no tournament, registration open, live, completed
- [ ] 14 suites + 4 gates green
- [ ] No `src/server/**` diff
- [ ] `CHANGELOG_UI_REDESIGN.md` updated with what was cut and why
