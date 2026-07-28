# UI Redesign Changelog

## The Circuit rebrand — near-black / electric blue / red

The brief: stop looking like an internal dashboard, start looking like a high-stakes competitive
platform. This pass replaced the palette and type system, added live-state motion, and quietened
empty states. **No backend logic, data model, route or API contract changed.**

### Design tokens first (`src/app/globals.css`)

Everything else pulls from here; the token layer was rewritten before any page was touched.

- **Killed the mint-green + purple/indigo palette.** `#7F5AF0` violet and `#00FFA3` mint are gone.
- **New brand:** near-black base ramp (`--base-1000`…`--base-600`, tracking the `#0A0A0C`–`#0D0D10`
  range), **electric blue** primary, **red** secondary.
  - Blue = primary action, links, focus, active nav, active-but-not-urgent state.
  - Red = earned urgency only: countdown under pressure, knockout, elimination, live-now.
  - Green survives as a **status-only** colour, deliberately desaturated so it cannot read as the
    old neon mint. Amber likewise.
- Raw ramps (`--blue-*`, `--red-*`, `--ink-*`, `--base-*`) are new; the UI still consumes only the
  semantic tokens, so no component knows a hex value.
- Broadcast and workspace surfaces now build on **one shared dark core** and differ only in glow
  and elevation, so marketing, app and admin read as one system rather than three eras.
- Added `--text-eyebrow`, named `--animate-*` keyframes, and a `.stagger` utility.

### Contrast is now verified, not asserted

- Added `scripts/verify-contrast.ts` and `npm run verify:contrast`. It converts each OKLCH token to
  sRGB and computes WCAG ratios for 23 pairs, exiting non-zero below the floor (4.5 text / 3.0 UI).
- Three light-surface fills failed on the first run and were fixed rather than waived:
  white-on-destructive (4.40), white-on-success (2.78), warning-on-amber (2.69).
- Also fixed a latent bug this surfaced: `--warning` on the light surface now resolves to the
  *dark* amber step, so `text-warning` is legible on white. Amber is a light hue, so it could not
  follow the same pattern as destructive/success without this change.
- **23/23 pairs pass.**

### Typography

- Two families, max: **Space Grotesk** (display — headlines, scores, timers) + **Inter** (body/UI).
- Removed **Pixelify Sans** and the `@import url('https://fonts.googleapis.com/...')` that loaded
  it. Both faces are now self-hosted via `next/font`; there is no third-party font request.
- **Defined the case system**, which previously had no rule: all-caps + tracked belongs to section
  eyebrows and nav only; everything else, including every headline, is normal case. Stripped
  `uppercase` from ~20 headings.
- New `<Eyebrow />` primitive replaces a `font-mono text-xs uppercase tracking-[0.18em]` string
  that had been pasted into ~30 places with four different tracking values.

### Motion

- New `<LiveDot />`: solid core + expanding ping ring. Used everywhere something is genuinely live.
- Countdown now ticks visibly at hero scale, turns red under a minute, and pulses. Tabular figures
  throughout so digits do not jitter. **The server-authoritative clock logic was not touched.**
- Staggered entrance for lists and cards via `.stagger`; hover/press states on every interactive
  element (buttons, cards, nav, tabs, rows).
- All of it is `motion-safe:`-gated and covered by the global reduced-motion rule.

### The ticker

Removed. It looped the same 3–4 facts, several of which render empty before a tournament exists,
which read as a broken marquee rather than a live feed. The sticky status bar states those facts
once, and the Match Center carries the live signal properly (brief option (b)).

### Empty states

- Consolidated **two** competing `EmptyState` components into one. The old
  `@/components/ui/table` version — dashed border, centred, `p-8` — was the reason emptiness was
  the loudest thing on every page. That path now re-exports the canonical, quiet one, so all ~20
  call sites moved without edits.
- Profile sections with nothing to show now do not render at all rather than rendering an empty box.

### Pages

- **Home:** ticker removed; hero on the new type scale; **Match Center rebuilt as the page's visual
  anchor** with a hero countdown, live tinting and a real round-progress bar. Hero backdrop
  gradients now derive from tokens via `color-mix` instead of pinned mint literals.
- **Tournaments:** lifecycle buckets now carry real visual priority — Live Now is full-width and
  red-ringed, Past is packed three-up and muted. Previously all four looked identical.
- **Leaderboard:** your own row is a tint + rule instead of a solid inverted slab, which was
  fighting the ranking for attention. Tabs got proper active/hover states.
- **Hall of Fame:** champion half of the card now carries the accent and a real hierarchy.
- **Dashboard:** readiness checklist kept as a mechanic, refined — added a `done/total` summary and
  progress bar, and completed rows now recede so the eye lands on what is outstanding. The four
  stat cards became one bordered status board rather than four floating boxes.
- **Profile:** Links / Badges / Tournament History collapsed from three boxy cards with
  near-identical empty copy into one scannable column.
- **Sign-in:** now renders on the broadcast surface (it previously used the bare light `:root`
  tokens with no shell — a white flash and a different-looking product). GitHub is the primary
  filled action, any other provider is secondary. Added a line telling people browsing does not
  require an account.

### Bugs found and fixed along the way

- **Hardcoded placeholder data on the tournaments page:** `Prize pool "₹0"` and `Entry "Free beta"`
  were literals, contradicting the tournament record. `PublicTournamentCard` already carried
  `prizePoolMinor`, `passPriceMinor` and `currency` — they are now read from it.
- New `<Reward />` / `<EntryPrice />` primitives support **both** a currency value and a
  non-monetary reward description, so the final commercial framing will not need a code change.
  A zero price renders "Free entry", not a broken-looking "₹0".
- `product-nav` active indicator used `var(--secondary)`, which became a neutral grey in the
  rebrand and would have gone invisible. Now `var(--color-primary)`.
- `live-leaderboard` referenced `text-secondary-foreground` against a fill that no longer existed.
- `<Reward />` imports `formatMinor` from `content.public` rather than the `@/server/modules/
  notification` barrel, which is marked `server-only` and would have poisoned any client use.

### Verification

- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run build` — succeeds; all 36 routes build as before.
- `npm run verify:contrast` — 23/23.
- Zero hex/`oklch()` literals and zero raw Tailwind palette colours (`bg-blue-500` etc.) remain in
  any `.tsx`. All colour lives in the token layer.

### Not done — needs a product decision

- **Merging `/submissions` and `/results` into one "My Activity" view.** The brief lists this under
  "consider cutting or merging". It changes routes and nav rather than styling, so it was left
  alone pending a call. Both pages were restyled in place.
- Visual QA against a running instance still needs a database; verification above is build-time.
