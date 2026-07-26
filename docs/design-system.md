# Blitz It — Design System

> **Authoritative for all UI.** Every screen, component and future epic builds from this
> document. Implemented in `src/app/globals.css` (Tailwind v4, CSS-first `@theme`).
> Companion: [`12-ui-screens.md`](./12-ui-screens.md) for per-screen specs.

---

## 1. Design philosophy

**Blitz It now has two visual registers.**

The single most important rule in this document:

> **Marketing != Dashboard.**
> The public marketing surface feels like a live broadcast. The application maximizes *productivity*.

| | Marketing (`(marketing)`) | Application (`(app)`, `(admin)`) |
|---|---|---|
| Goal | Make the event feel live within one second | Speed, clarity, density, keyboard flow |
| References | Broadcast/esports event sites led by countdowns, standings, brackets and live state | Linear, Raycast, GitHub, Stripe Dashboard, Vercel |
| Motion | Expressive but content-first; every loop/reveal has a reduced-motion path | Functional only: state feedback, <=150ms |
| Density | Banded, high-contrast, spectator-friendly | Dense but readable, compact controls |
| Colour | Dark broadcast scope with Blitz It purple and live green accents | Accent reserved for action + state |

Marketing is dark-first through `data-surface="broadcast"` on the `(marketing)` layout. It must not force `.dark`, because the authenticated app and admin theme switch remain independent. Broadcast tokens are additive: `--surface-deep`, `--surface-raised`, `--surface-elevated`, `--hairline`, `--glow-primary`, and `--glow-live`.

The app and admin registers remain dense productivity tools. Admin was signed off in E5 and should not be restyled as part of marketing work.

**Brand personality:** Competitive, technical, fast, broadcast-ready, measured, confident.

**Explicitly avoid:** copying third-party event assets, logos, photography, copy or licensed fonts; weakening reveal/authorization gates for visual effects; converting server pages to client components for animation; decorative glassmorphism; animation for the sake of animation.


---

## 2. Colour

### Brand
| Token | Hex | OKLCH | Use |
|---|---|---|---|
| Primary accent | `#7F5AF0` | `oklch(0.5873 0.2143 289.47)` | Primary actions, focus, brand |
| Secondary accent | `#00FFA3` | `oklch(0.8810 0.2050 158.31)` | Success, live/active state, highlights |
| Base | `#000000` / `#FFFFFF` | — | Foundation of both themes |

### Accessibility — verified, not assumed
Measured WCAG contrast (see the token table before changing anything):

| Pair | Ratio | Verdict |
|---|---|---|
| `#7F5AF0` + white text | **4.54** | ✅ AA text |
| `#00FFA3` + **black** text | **15.83** | ✅ AA text |
| `#00FFA3` + white text | 1.33 | ❌ **never do this** |
| `#7F5AF0` on dark bg | 4.36 | ⚠️ UI/large only |
| Dark-mode primary `#9E87FF` on dark bg | **6.94** | ✅ AA text |
| Broadcast foreground on `--background` | **18.64** | AA text |
| Broadcast muted foreground on `--background` | **9.57** | AA text |
| Broadcast primary `oklch(0.70 0.18 289.47)` on `--background` | **7.22** | AA text |
| `#00FFA3` on broadcast black | **15.58** | AA text |

**Two hard rules:**
1. `--secondary-accent` **always** pairs with a black foreground.
2. Dark mode lightens the primary to `oklch(0.70 0.18 289.47)` for text/icon use — the base
   `#7F5AF0` is only AA-large on dark and must not carry body text there.

Every background token has a matching `-foreground` token. Never hand-pick a colour in a
component; use a semantic pair.

### Semantic tokens
`background · foreground · card · popover · primary · secondary · muted · accent · destructive ·
success · warning · border · input · ring` — each with a `-foreground` counterpart where it can
host content. Full values live in `globals.css`.

**Surfaces (dark, the app's default feel):** `--background` `#0A0A0B` → `--card` slightly raised →
`--popover` highest. Elevation comes from surface + border, not shadow.

---

## 3. Typography

**Inter**, weights **400 / 500 / 600 / 700 / 800**. `font-feature-settings: 'cv11','ss01'` for
disambiguated glyphs; tabular numerals (`tnum`) for scores, timers, leaderboards, prize amounts.

| Role | Size | Line height | Weight | Tracking | Use |
|---|---|---|---|---|---|
| **Hero** | `clamp(3rem, 7vw, 5.5rem)` | 1.02 | 800 | −0.035em | Marketing hero only |
| **H1** | `clamp(2.25rem, 4vw, 3.5rem)` | 1.08 | 700 | −0.03em | Page titles (marketing) |
| **H2** | `2rem` | 1.15 | 700 | −0.02em | Section headings |
| **H3** | `1.5rem` | 1.25 | 600 | −0.015em | Subsections, card groups |
| **H4** | `1.25rem` | 1.35 | 600 | −0.01em | App page titles |
| **H5** | `1rem` | 1.45 | 600 | 0 | Card titles, table headers |
| **Body** | `0.9375rem` | 1.6 | 400 | 0 | Default app text |
| **Body-lg** | `1.125rem` | 1.65 | 400 | 0 | Marketing paragraphs |
| **Small** | `0.875rem` | 1.5 | 400/500 | 0 | Secondary text, labels |
| **Caption** | `0.75rem` | 1.4 | 500 | 0.01em | Metadata, timestamps, hints |
| **Mono** | `0.875rem` | 1.5 | 400 | 0 | Code, repo URLs, scores, IDs |

**Hierarchy is carried by size + weight + spacing — never by colour alone**, and never by shadow.
Body copy caps at ~72ch. Marketing headings may use tighter tracking; app text never does.

---

## 4. Spacing

A single 4px-based scale. **No arbitrary values** (`p-[13px]` is a bug).

`0 · 1(4px) · 2(8px) · 3(12px) · 4(16px) · 5(20px) · 6(24px) · 8(32px) · 10(40px) · 12(48px) · 16(64px) · 20(80px) · 24(96px) · 32(128px)`

| Context | Use |
|---|---|
| Inside controls | `2–3` (8–12px) |
| Card padding | `4–6` (16–24px) |
| Between related elements | `2–4` |
| Between sections (app) | `6–8` |
| Between sections (marketing) | `16–32` |
| Page gutters | `4` mobile → `6` tablet → `8` desktop |

Marketing breathes; the app stays compact.

---

## 5. Border radius

One system, applied consistently:

| Element | Token | Value |
|---|---|---|
| Badges, pills, tags | `--radius-sm` | 6px |
| Buttons, inputs, selects | `--radius-md` | 8px |
| Cards, panels, dropdowns | `--radius-lg` | 12px |
| Dialogs, drawers, modals | `--radius-xl` | 16px |
| Images, media, hero art | `--radius-2xl` | 20px |
| Avatars, icon buttons | `--radius-full` | 9999px |

---

## 6. Shadows

Deliberately restrained. **Typography and spacing carry hierarchy; shadows only signal
elevation off the surface.** In dark mode, elevation reads through surface lightness + border,
so shadows stay nearly invisible.

| Level | Use |
|---|---|
| `--shadow-xs` | Resting buttons/inputs (hairline) |
| `--shadow-sm` | Cards on hover |
| `--shadow-md` | Dropdowns, popovers, command palette |
| `--shadow-lg` | Dialogs, drawers |
| `--shadow-focus` | Focus ring (primary at 40% α) |

No coloured glows, no exaggerated drop shadows, no neon.

---

## 7. Buttons

Sizes: `sm` (28px) · `md` (36px, default) · `lg` (44px). Icon-only buttons are square at the same
heights.

| Variant | Resting | Purpose |
|---|---|---|
| **Primary** | primary bg / white text | The one main action per view |
| **Secondary** | surface bg + border | Neutral, most common |
| **Ghost** | transparent, text only | Toolbars, low-emphasis, tertiary |
| **Danger** | destructive bg / white text | Destructive + confirmed actions |
| **Success** | secondary-accent bg / **black** text | Positive confirmation (rare) |

**Required states for every variant:**
- **Hover** — surface lightens/darkens ~4%, `120ms`
- **Focus-visible** — 2px `--ring` offset 2px. **Never remove the outline.**
- **Pressed** — `scale(0.98)`, `80ms`
- **Disabled** — 50% opacity, `cursor: not-allowed`, no hover
- **Loading** — spinner replaces the leading icon, label stays, width is preserved (no layout
  shift), button becomes `aria-busy` and non-interactive

---

## 8. Cards

Base: `--card` surface, 1px `--border`, `--radius-lg`, padding `4–6`. Hover elevation **only if
the card is interactive**.

| Variant | Notes |
|---|---|
| **Stat card** | Label (Caption, muted) + value (H3, tabular). Optional delta in success/destructive. |
| **Tournament card** | Status pill, title, schedule, prize pool, participants, CTA. |
| **Leaderboard row** | Not a box — a dense row: rank (tabular) · avatar · name · city · score. Zebra-free; separated by hairline borders. |
| **Settings card** | Title + description + control; grouped in a vertical stack. |
| **Evaluation card** | Four dimension bars (Functional 60 / Performance 15 / Security 10 / AI 15) + overall score. Weight-aware. |
| **Prize card** | Placement, amount (tabular), status. |
| **Empty state** | Lucide icon (muted) + one-line explanation + single primary action. Never a bare "No data". |

---

## 9. Inputs

Height matches buttons (`md` = 36px). Radius `--radius-md`. 1px `--input` border; focus swaps to
`--ring` + focus shadow.

Covers: text field · search (leading icon, `⌘K` hint, clearable) · dropdown/select · checkbox ·
radio · switch · textarea (min 3 rows, resize-y) · number.

**Every field:** visible label (or explicit `aria-label`), optional hint (Caption, muted),
error message (destructive, Small) wired via `aria-describedby`, and `aria-invalid` when errored.
Placeholders are examples — **never** a substitute for a label.

**Validation:** validate on blur and on submit — never on every keystroke. Server errors surface
in the same slot as client errors. Zod schemas are shared client↔server
([`coding-standards.md`](./coding-standards.md)).

---

## 10. Icons

**Lucide throughout** (`lucide-react`). Sizes 16 (inline/dense) · 20 (default) · 24 (headers).
Stroke `1.5–2`. Icons are decorative by default (`aria-hidden`); icon-only controls require an
`aria-label`. Never mix icon sets.

---

## 11. Animation

**One language. Restrained everywhere; expressive only on marketing.**

| Token | Duration | Easing | Use |
|---|---|---|---|
| `--motion-instant` | 80ms | ease-out | Press feedback |
| `--motion-fast` | 120ms | ease-out | Hover, colour, small state |
| `--motion-base` | 200ms | `cubic-bezier(0.2,0,0,1)` | Dropdowns, popovers, toasts |
| `--motion-slow` | 320ms | `cubic-bezier(0.2,0,0,1)` | Dialogs, drawers, page transitions |
| `--motion-reveal` | 600–900ms | `cubic-bezier(0.16,1,0.3,1)` | **Marketing scroll reveals only** |

Rules:
- Animate **transform and opacity only** — never width/height/top/left (layout thrash).
- Enter with intent (fade + 4–8px rise); exit fast (fade only).
- Loading: **skeletons** matching final layout for content; spinners only inside buttons.
- **`prefers-reduced-motion: reduce` must disable transforms and reveals** — non-negotiable.
- Nothing loops forever except a genuine indeterminate progress indicator.
- Live data (leaderboard/bracket via SSE) updates with a brief highlight, never a jarring reflow.

---

## 12. Component philosophy

**Everything modular. Nothing page-specific unless genuinely unavoidable.**

- `components/ui/` — shadcn primitives (new-york), vendored, minimally edited.
- `components/features/` — product composition built from primitives.
- `components/layout/` — shell, nav, page headers.

Rules: no colour/spacing/radius literals in components — tokens only. Server Components by
default; `'use client'` pushed to the smallest leaf. Every interactive component ships keyboard
support and focus states.

**Shared library (built as epics need them):** Button · Card · Dialog · Drawer · Command Palette
(`⌘K`) · Data Table · Filter Bar · Search · Badge · Status Pill · Leaderboard Row · Tournament
Card · Evaluation Badge · Prize Card · Skeleton · Empty State · Modal · Toast (sonner) · Alert ·
Avatar · Tabs · Tooltip · Pagination · Countdown · Bracket Tree · Stat Tile.

**Status pill colours** (used across tournaments, matches, evaluations, payouts):
`live/active` → secondary-accent · `pending/queued` → muted · `success/passed` → success ·
`failed/error` → destructive · `warning/review` → warning.

---

## 13. Accessibility (non-negotiable)

WCAG AA contrast · visible focus on every interactive element · full keyboard operability ·
semantic HTML before ARIA · `aria-live` for async results and toasts · labelled forms with
errors tied to fields · respects `prefers-reduced-motion` · target size ≥ 24px (44px on touch) ·
never colour alone to convey meaning (pair with icon or text).

---

## 14. Implementation notes for future epics

1. Read this document **before** building any screen.
2. Add a primitive to `components/ui/` before writing a one-off.
3. Use tokens, never literals. A hex code in a component is a review failure.
4. Marketing work may be expressive; app work stays quiet and fast.
5. New status colours must be added as semantic tokens with a verified contrast pair.
6. Tabular numerals for every number that changes (scores, timers, counts, money).
7. Keep the app shell static and stream content — perceived speed is a design requirement.
