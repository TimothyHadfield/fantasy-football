# Fantasy Football — Progress

Live: https://timothyhadfield.github.io/fantasy-football/
Repo: https://github.com/TimothyHadfield/fantasy-football

## What this is

A site for fantasy football stats/analysis, and eventually a "smart drafter."
Tim specs what it does; Claude builds it.

**Status as of 2026-09-07: connection layer only. No features built yet, by design.**

## Current state

- `index.html` — bare scaffolding. Connect panel + raw data probes. No product UI.
- `js/espn.js` — the ESPN API connection layer. Fetch + decode only, no strategy logic.

## What's verified working

Confirmed against the live 2026 ESPN API on 2026-09-07:

- **The API is reachable from a static GitHub Pages site.** ESPN reflects the
  `Origin` header and sets `Access-Control-Allow-Credentials: true`, verified
  for both `http://localhost` and `https://timothyhadfield.github.io`. So the
  browser can call ESPN directly — no backend or proxy needed.
- **Private leagues work via your existing login.** Because credentials are
  allowed, `credentials: 'include'` sends your espn.com session cookies
  automatically. You do not paste cookies anywhere.
- **Real data confirmed available**, e.g. Jahmyr Gibbs: ADP 1.32, auction value
  $70.77, 2026 projection 369.1 pts, 2025 actual 366.9, 99.93% owned.

## What ESPN gives us

| Data | Endpoint view | Notes |
|---|---|---|
| League settings | `mSettings` | Scoring rules, roster slots, draft type |
| Teams + owners | `mTeam` | |
| Draft picks | `mDraftDetail` | Includes live picks during a draft — pollable |
| Rosters | `mRoster` | Per team, per week |
| Matchups/scores | `mMatchupScore` | Full season schedule and results |
| Transactions | `mTransactions2` | Adds, drops, trades, waivers |
| Player pool | `kona_player_info` | Projections, ADP, auction values, % owned |
| Bye weeks | `proTeamSchedules_wl` | Season endpoint, not league |

Projections are returned **scored under your league's own rules**, because
requests go through the league path rather than ESPN's defaults.

## Known constraints

- The ESPN fantasy API is undocumented. It's stable and widely used, but it is
  not a contract — endpoints can change without notice.
- Reads only. Writing to ESPN (setting lineups, submitting picks) is
  deliberately out of scope.
- If a browser blocks cross-site cookies for espn.com, private-league reads will
  fail. Not seen yet; the fallback would be a small local proxy.

## Parked (built, then set aside)

A draft recommendation engine was written and validated against real 2026 data
before Tim scoped the project down. It implemented VORP with dynamic replacement
levels, ADP-based survival probability, positional-run detection, and tier
breaks. Sanity checks passed: it correctly pivoted off RB once RB slots filled,
and correctly suppressed K/DST until the final two rounds.

It was removed from the repo because **Tim is designing the drafter, not
Claude.** Kept only as evidence the data supports this kind of math. Do not
reintroduce it without Tim's spec.

## Next

Awaiting Tim's spec. Nothing should be built on top of the connection layer
until he defines what it does.
