# UI Redesign Changelog

## Broadcast marketing redesign

- Added broadcast tokens scoped to `data-surface="broadcast"` so marketing is dark-first without
  forcing `.dark` or changing admin/app theming.
- Added broadcast primitive support in Button, Badge and Card, plus Section, DisplayHeading and
  LivePill.
- Added a real marketing layout with header navigation and footer.
- Rebuilt `/` as broadcast bands: hero countdown, live metrics strip, current round, bracket,
  standings, weekly flow and champions.
- Restyled `/leaderboard`, `/hall-of-fame`, and `/u/[username]`.
- Added `/rules` with scoring weights and the rule that AI review applies only from the
  semi-finals onward.
- Added a broadcast header band to `/arena/knockout/[matchId]` and broadcast wrapping on
  `/bracket/[tournamentId]`.

## Claude Design landing integration

- Integrated the `docs/design/Home.dc.html` landing direction into `/` with the dark rail,
  live ticker, countdown-led hero, match center, broadcast panel, standings, bracket and champion
  sections.
- Added `animejs` v4 and moved the mock motion into the `HomeMotion` client wrapper. The page
  remains server-rendered; the client wrapper only animates existing DOM.
- Added the signed-in competitor match dock from `listMyLiveMatches(user.id)`, filtered to actual
  undecided live matches. It is hidden for signed-out visitors and users without a live match.
- Replaced the mock `SHIPS / MIN` tile with real `matchesDecided / matchesTotal` data from
  `snapshot.currentRound`.

## Claude Design panels cut

- Removed `JUDGE QUEUE` from the ticker because queue health is operator data from
  `getQueueHealth()`, not public landing-page data.
- Removed the event feed because there is no public event feed read model. It was replaced with
  static public facts already present in `LiveSnapshot`.
- Removed rank deltas from standings because rank history is not stored.
- Removed `SEATS LEFT` because `maxRegistrations` is not exposed in `LiveSnapshot`.
- Removed the week schedule strip because `registrationOpensAt`, `registrationClosesAt`,
  `simulationOpensAt`, `simulationClosesAt` and `liveStartsAt` are not exposed in
  `LiveSnapshot`, and `src/server/**` changes are out of scope for this pass.

## Guardrails kept

- No `src/server/**` files were changed.
- Public profile still uses `listUserBadges(user.id, { publicOnly: true })` and
  `listPublicPlacements(user.id)`.
- Bracket surfaces still use `listBracketRounds(..., { revealProblems: false })`.
- Unlisted tournaments still 404 through the existing page logic.
- The live arena remains a server component with only `Countdown` and `LiveRefresh` client islands.

## Measured contrast

Measured from shipped token values:

| Pair | Ratio |
|---|---:|
| `#7F5AF0` + white | 4.54 |
| `#00FFA3` + black | 15.83 |
| `#00FFA3` + white | 1.33 |
| Broadcast foreground on `--background` | 18.64 |
| Broadcast muted foreground on `--background` | 9.57 |
| Broadcast primary `oklch(0.70 0.18 289.47)` on `--background` | 7.22 |
| `#00FFA3` on broadcast black | 15.58 |

## Deferred

- Ditto reference capture was skipped because no `DITTO_API_KEY` was present.
- A public schedule read would be needed to render the Claude Design five-step week strip honestly.
  It was not added because `src/server/**` is off limits for this task.
