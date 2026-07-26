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
- No server reads were requested or added.
