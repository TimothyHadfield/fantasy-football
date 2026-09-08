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

## Stats module — reverse-engineered from Tim's 2025 sheet

The 2025 sheet arrived as a PDF, which carries computed values but not cell
formulas. The formulas below were recovered from the numbers and verified by
re-computing them from the real 2025 scores.

**Verification: 79 of 80 assertions reproduce the sheet exactly.** See
`js/stats.js`. The one miss is Autumn's Skill (-0.6 computed vs 0 shown), which
is display rounding in the sheet, not a formula difference.

### CONFIRMED

| Metric | Formula |
|---|---|
| Luck (weekly) | `actual - projected` |
| Score differential | `own actual - opp actual`; projected likewise |
| Skill | `team avg projected - league avg projected` |
| F&minus;A | `(points for - points against) / weeks` — a per-week average, not a season total |
| S+L | `skill + cumulative luck` |
| Box charts | five-number summary, Tukey fences at 1.5 x IQR, quartiles by the inclusive method Sheets uses |
| Distribution | counts of every team-week score, 10-point and 20-point bins |
| Projection accuracy | share of games the higher projection won, bucketed by projected margin (All, >5, >10, ... >30) |

Note: the sheet's histogram starts at "70s" and totals 128, but there are 130
team-weeks. Miles's 49 and 67 are missing from it. The site bins all 130.

### UNKNOWN — formulas still needed from Tim

1. **PTW** ("projection to win"). Roughly tracks average opponent actual score
   but doesn't equal it — Nolan matches at 109, Autumn is 127 vs an opponent
   average of 118.
2. **SD** in the luck block. Autumn shows -3.9; the average score differential
   is -4.85 and the average projected differential is -2.5, so it is neither.
3. **Cumulative Luck**, labelled "adjusted formula" in the sheet. Its weekly
   spread shrinks (stdev 43 -> 12 across the season), so something is being
   normalized per week.
4. **Third column of the Score Differential table.** It reaches +/-50 when a game
   is decided by a point or two and falls near zero in blowouts, so it is
   measuring how much luck decided the outcome — but the exact shape is unclear,
   and it doesn't always take the sign of the margin.
5. **LS and PS standings**, which depend on (3).

These are stubbed as `null` in `js/stats.js` and surfaced on the stats page as a
"not built yet" note rather than being guessed at.

## Site structure

- `index.html` — ESPN connection + raw data probes
- `stats.html` — the data display (demo data by default)
- `css/app.css` — shared styles
- `js/espn.js` — ESPN API connection layer
- `js/season.js` — turns a real ESPN league into the canonical data shape
- `js/demo.js` — generates realistic fake data for the demo view
- `js/stats.js` — all statistics
- `js/charts.js` — inline-SVG line / histogram / box-plot rendering
- `js/stats-page.js` — wires the stats page together

### Weekly projections from ESPN: a real constraint

ESPN does not store "what was this team projected to score in week 4". It only
stores per-player projections. `js/season.js` reconstructs each week's team
projection by refetching that week's rosters and summing the projections of
whoever was in the starting lineup — one request per week. If ESPN returns
projections for fewer than half the games, the page says so rather than
silently rendering zeroes.

## Next

- Get the five unknown formulas from Tim.
- The smart drafter still awaits Tim's spec. Do not design it for him.
