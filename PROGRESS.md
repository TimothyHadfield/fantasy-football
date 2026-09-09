# Fantasy Football — Progress

Live: https://timothyhadfield.github.io/fantasy-football/
Repo: https://github.com/TimothyHadfield/fantasy-football

> **New session? Read [HANDOFF.md](HANDOFF.md) first.** It is the short
> orientation: what this is, how Tim works, the standing instructions, and the
> rules that must not be re-litigated. This file is the detailed reference
> behind it — long, and organised by topic rather than by importance.
>
> Also here: [tests/README.md](tests/README.md) for the suites,
> [docs/espn-draft-api.md](docs/espn-draft-api.md) for ESPN's field-level
> behaviour, [DRAFT-STRATEGY.md](DRAFT-STRATEGY.md) for the parked drafter.

## What changed on 2026-09-09

Three sessions ran that day and the site changed a great deal. Everything below
is the record of what was built and — more usefully — of what was tried, found
to be wrong, and must not be tried again.

**A large usability pass landed 2026-09-09 (second session that day).** The
site was built and verified against a COMPLETE 2025 season and had never been
looked at with a nearly-empty one. Almost everything below in "Current state"
still holds; what changed:

- **`index.html` is now a season dashboard**, not a connect form. The old raw
  data probes moved to **`debug.html`** (not in the nav; linked from the
  bottom of the home page). The dashboard is built on `fetchSchedule` +
  `fetchWeekRosters` and deliberately NOT on `fetchSeasonData`, which returns
  nothing until games are played.
- **`analysis.html` shows all ten teams' starting lineups at once** —
  QB/RB1/RB2/WR1/WR2/TE/FLEX + baseline week + Est Total — which was Tim's
  headline ask. His sheet semantics are implemented exactly (see "What the
  sheet's columns mean"): flex is computed by position, never from ESPN's
  lineup slot, because ESPN's `OP` slot can hold a QB.
- **`stats.html` refuses to print numbers it cannot justify.** Below 3 weeks
  the trend charts and the volatile columns (SD/LUCK/S+L/LS/PS) are replaced
  by an "Early season" panel. See "Early-season honesty" below.
- **`schedule.html` works in September** — standings panel, played/upcoming
  split, a fixture matrix that becomes the head-to-head grid once enough games
  exist, and a strength-of-schedule rank.
- **New shared modules: `js/prefs.js`** (persist source/week/team/sort) and
  `savedConfig()` / `onConnection()` in `js/connection.js`.

**Forecasting landed 2026-09-09 (same day, third piece).** `js/forecast.js` is
a pure, node-testable engine; `schedule.html` has a "My season" panel and win
percentages on every upcoming game. Read this before touching any of it:

- **ESPN does NOT publish a win probability.** It publishes projections. Every
  percentage on the site is derived here, and the page says so in those words.
  Do not relabel it as ESPN's number — that was checked, not assumed.
- **The win model** is a normal distribution on the margin: `P = Phi((projA -
  projB) / (sigma * sqrt2))`. `sigma` is the per-team-week spread of
  (actual - projected), **learned from the league's own games** by
  `calibrateSigma`, falling back to a documented 27 below 12 residuals and
  saying which it used. In week 1-2 live it will always be the assumed value,
  because live games carry no projections at all (see below).
- **Future weeks use ESPN's OWN per-week projection, fetched per week.**
  **VERIFIED 2026-09-09 against public league 1241838**: ESPN returns a
  `statSourceId 1 / statSplitTypeId 1` projection for **every player in every
  future week, through week 13**, and a player on his bye comes back at
  **0.00**. So byes need no separate lookup and no filtering — they are already
  in the number. (An earlier pass assumed distant weeks were unavailable and
  used `seasonProjected / 17`; Tim corrected it — he reads exactly these numbers
  off the ESPN site by paging a lineup forward. Do not reintroduce the average.)
- **Match Tim's manual method, because he checks it by hand.** He opens a team,
  picks a week, and reads the "proj" total under the starting lineup; he
  compares two teams by doing that for both sides of a matchup. The site shows
  the same number with ONE deliberate difference: it fills the best legal
  lineup instead of the one currently set, which is the bench check he does by
  eye. That difference is large and it is the point — measured against the real
  league, weeks 1-2 gain 0-3 points (lineups are already set well), but weeks
  5, 8 and 13 gain **10-20 points**, because a roster left as-is has bye-week
  players still slotted in. Verified: over 50 real team-weeks the optimal
  lineup was never worse than the set one.
- **Injury status is deliberately NOT filtered.** ESPN's own projection already
  carries availability, and second-guessing it would move the totals away from
  the ones being checked against.
- **Tim's rule, implemented exactly:** each manager is assumed to start their
  highest-projected players. `optimalLineup` fills the most restrictive slots
  first, which is optimal because the eligibility sets nest, so the flex can
  provably never take a QB (a superflex still can). Verified against brute-force
  enumeration.
- **Request budget is one per REMAINING week**, plus the schedule fetch. There
  is no bulk form — that was checked, not assumed. `fetchWeeksRosters(weeks)` in
  `js/season.js` runs them three at a time and reports progress; a week ESPN
  refuses is simply absent rather than failing the set. Played weeks are never
  refetched.
- **The lineup shape is read from the rosters ESPN sends**, not guessed and not
  a fourth request — ESPN rejects illegal lineups, so the non-bench slots in use
  ARE the configuration, maxed across teams. The real league starts **ten**:
  1 QB, 2 RB, **3 WR**, 1 TE, 1 FLEX, 1 D/ST, 1 K. A hand-written nine-slot
  default would understate every team by a starter.
- **`state.strength` now has ONE notion again.** The per-week optimal-lineup
  projection is the preferred SOS basis, with the old three as fallbacks and a
  single `state.strengthNote`. Beware the units trap the file warns about: two
  of the fallbacks are points-per-WEEK, one is a season TOTAL.
- **The demo season is 100% played, so it forecasts "as of" the selected week**
  — the same code path, run where the answer can be checked. Live simply uses
  the last week with a final game.
- **Any team can be forecast**, not just yours — the "Forecast for" picker.
  Switching is a repaint, never a refetch: every team's per-week projection is
  built in the same pass. A remembered pick is dropped when the data source
  changes, because demo team ids count from 1 and ESPN uses its own.

**Free agents / the waiver wire (`espn.fetchFreeAgents`, `waivers.html`).**
Two traps, both established by probing a real league on 2026-09-09, both
silent — no error, just missing data:
1. The week comes from `scoringPeriodId`, and it works **only when no
   `filterStatsForTopScoringPeriodIds` is sent**. Send both — which is what
   `fetchPlayers` does for the season totals it wants — and the weekly stat line
   vanishes entirely.
2. **There is no bulk form.** Thirteen weekly stat-set ids in `additionalValue`
   returns only the current week. A season of weeks is a request per week, the
   same as rosters. Four shapes of that request were tried; do not retry them.

A player on bye comes back projected **0.00**; `null` means ESPN had no number
at all. Those are different facts and the page draws and sorts them
differently — a blank sorting as zero would put every unknown at the bottom of
the wire and look deliberate.

**`STARTABLE` on the waiver page greens a week worth starting**, per position:
QB over 17, RB and WR over 12, TE over 9, D/ST over 7, K over 9 (Tim moved the
kicker from 7 to 8.5 to 9). Fixed bars, not a ranking against the rest of the
wire — a quiet week for everyone stays uncoloured rather than promoting the
best of a bad set. The panel note lists the bars by reading the same constant,
so changing a number updates the prose too. Colour AND weight, never colour
alone. **The demo pool's ranges were nudged up so all six positions can clear
their bar** — they used to top out just under it at RB/WR/TE, which made the
feature look broken in demo.

**"Your QB3" comparison rows.** Your own worst player at each position sits in
the SAME tbody as the free agents and sorts and filters with them — the
interleaving is the point, since sorting by Avg then shows exactly who beats
the man you would drop. "Worst" is the lowest Avg **over the weeks currently
shown**, so widening the span can change which of your men appears; the label's
number is your depth at that position. These rows are never greened (starting
your own bench is a different question) and never counted on the position
buttons (you cannot add a player you hold). This doubles the per-week cost —
the wire AND your roster — so rosters are fetched only when a team is set.

**`analysis.html` has a "Season by week" grid**: a whole squad down the left,
every week across the right. It reuses the page's existing team picker rather
than adding a second one, and switching team costs **no** requests, because
every team is in every week's payload. **Deliberately uncoloured** — Tim's
call, and the note says why: everyone there is already rostered, so the waiver
bars would light up nearly every cell and mean nothing. If colour ever comes to
it, it needs a different scheme.

**Schedule luck (`opponentProjections`, panel + column on `stats.html`).**
The average projected score of the opponents a team has to play. It needs no
games played, which is the point of it. Adding it forced the stats page's
"no completed matchups" early return to become a render path — see the
early-season honesty note above; every result-derived cell dashes at zero games
rather than reporting a confident 0.0.

**Season simulation (`simulateSeason` in `js/forecast.js`, panel at the foot of
`schedule.html`).** A single team's win total has an exact answer and gets one;
a final PLACING does not, because it turns on the joint outcome of every game
in the league at once and then on the tiebreak. So the rest of the season is
played out N times (1k / 10k / 50k, default 10k) and the finishing order
counted.

- **It agrees with the head-to-head percentages by construction** — same normal
  model, same sigma. Asserted, not assumed: over a one-game season the
  simulated win rate matches `winProbability` to within 0.008. If you change
  one, change the other, and keep that assertion.
- **Points are simulated, not just wins**, because the league breaks ties on
  total points. Ranking on wins alone would invent ties the real standings
  separate.
- **Deterministic.** Seeded, and the cache key is everything that changes the
  answer (runs, as-of week, sigma, teams, banked record, every remaining
  projection) and nothing that does not — the *selected team is deliberately
  not in it*, so switching teams repaints without re-running. Do not let
  re-rendering hand back different odds for the same season.
- **"Wins the season" means finishing first in the regular-season standings.**
  No playoff bracket is modelled, and the panel says so. If Tim ever wants real
  championship odds this needs his league's bracket rules (size, seeding, byes)
  — he has not given them.
- Banked-vs-remaining uses the forecast panel's `isRemaining(g, forecastAsOf())`
  rule, NOT `standingsRows()`'s season-to-date one. They agree on live data and
  differ in the demo; using the wrong one makes the two panels contradict.
- 50,000 runs of a 10-team, 60-game season is about 580ms, so it hands off
  through rAF + setTimeout and shows a simulating state rather than blocking
  the paint.

**Two bugs fixed that were silently corrupting real numbers** — do not
reintroduce:
1. The connection bar wrote `ff.connection` while all three data pages read
   `ff.config`. The bar could say "Connected" while every page insisted no
   league was configured. `connection.js` now writes both and exposes
   `savedConfig()`; pages should use that, never read localStorage directly.
2. `season.js`'s "projections available" test was `more than half the games`,
   tuned for a 65-game season. In a 5-game week 1, a 3-of-5 pass silently
   DROPPED two games while keeping all ten teams — the four teams in them then
   computed skill from an empty set and ranked **first** in the luck
   standings, with the warning suppressed. It now also requires that every
   team be covered.

**Early-season honesty (the theme of the whole pass).** With one week of data
the old page rendered ten 4px dots in a vertical stripe three times over
(a 10-series line chart draws no line from a single point), a box plot of
ten 1.5px slivers, `Std Dev 0.0` for every team, and a projection-accuracy
percentage from five games. None of it crashed; all of it looked authoritative.
`js/stats.js` now returns `null` rather than a confident zero from `stdev`
(<2 values), `boxStats` (<5), `predictionAccuracy` (<20 games) and `rankBy`
(when every value ties), and `js/season.js` totals return `null` rather than
`0` when no player has a value. **When adding a statistic, decide what it
returns before it has enough data — that is the mistake this pass cleaned up.**

**Still true, and worth knowing:** `js/demo-rosters.js` hardcodes
`played: true` for every game, so **demo mode always shows a finished season**.
That is why none of the above was noticed. It is deliberate (the demo exists to
show the layout full), but it means early-season behaviour is only visible
against live data or a stub.


**The live connection works.** The bridge extension is installed in Tim's Edge
and reads his private league 476225250. This was the single biggest blocker on
the project and it is cleared. Do NOT re-litigate the "make the league public"
question below — it is moot; the extension solved it without changing any ESPN
setting.

> Standing instructions, current focus and what to build next have moved to
> [HANDOFF.md](HANDOFF.md), so there is one copy of them rather than two that
> can drift apart.

---

## Earlier open actions (mostly done)

1. ~~Read Tim's 2025 Google Sheet and extract five formulas.~~ **DONE
   2026-09-08.** All five recovered and implemented — see "RECOVERED" below.
   Tim has been sent a list of follow-up questions about unlabelled parts of the
   sheet; his answers are the next thing to fold in.

   Method, for when the 2026 sheet needs the same treatment:
   `https://docs.google.com/spreadsheets/d/1_Rac3-9WFVkbpQv-5Smu0wvTiGBP6QTrlF5eXJxPIm8/edit`
   Drive's `read_file_content` returns a *text rendering* — values, not
   formulas. Use `download_file_content` with `exportMimeType`
   `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` and parse
   the xlsx `<f>` elements. The call is too big to return inline, so it lands in
   a tool-results file; decode that with Python rather than transcribing base64.

2. ~~**Rework `analysis.html` against the real Analyze tabs.**~~ **DONE
   2026-09-09.** All four points below are implemented, plus the all-teams
   grid. The one still open is the **Predictions tab** at the end of this item.
   It was built from Tim's verbal description, not the tabs themselves. Now
   that the tabs have been read and Tim has explained them (see "What the
   sheet's columns mean"), the specific changes are:
   - **Drop the "Missing" concept entirely.** In the sheet it is a layout hack
     for teams with deeper benches, not data. Render each team's real bench at
     whatever length it is. Tim asked for this explicitly.
   - **FLEX = best of RB / WR / TE by projection.** Never QB; DST is not in the
     table at all.
   - **"Avg points"** is a per-week team total assuming every starter hits their
     season-average projection. Excludes DST. Consider renaming it on the site —
     it is not an average of anything.
   - **"Est Total" = Avg points + 16**, a flat allowance for DST and K at ~8
     each, left out because they are consistent and churn constantly.
   The Analyze tabs are built on each player's season average projected points,
   recorded after week 1, with bold = flex, dark red = IR, red = out.
   Two tabs are one-offs, not templates: the Jonas tab was Tim working out a
   possible 3-way trade, and the week 3 copies go with it.

   Worth building properly: the **Predictions tab** was Tim testing whether Est
   Total at a given week predicts the final ranking. He only ever did week 1 by
   hand. The site can answer it across all 13 weeks.

3. ~~Connecting to the live league.~~ **SOLVED 2026-09-09 by the bridge
   extension.** Tim's 2026 league is **476225250** (the 2025 one, 1485774672,
   is retired). It is private, and a static site cannot read a private league:
   the page is served from github.io, so ESPN cookies are third-party (blocked)
   and a page cannot set the `Cookie` header itself. The `extension/` bridge
   fixes this — see "The bridge & writes". Confirmed working end to end in
   Tim's browser. The old "make the league public" idea is no longer needed.

4. **The smart drafter is BUILT — `draft.html`.** Tim's strategy is captured in
   `DRAFT-STRATEGY.md` (Part 1 his words, Part 2 research, Part 3 what was
   built). The engine is `js/draft-model.js`, pure and node-testable; the room
   is `js/draft-page.js`. It works fully offline on `js/draft-demo.js`, a real
   214-player 2026 pool scored under Tim's own rules.

   **Practice mode** (`js/draft-sim.js`) runs a full mock draft against nine
   simulated managers and grades the result — rank, letter grade, slot-by-slot
   strengths, and what the assistant itself would have scored from the same
   slot. Repeatable, with a record kept in the browser. This is also the
   fastest way to check whether a `TUNING` change actually helps.

   **Practice deliberately requires nothing** — no league, no login, no network.
   A green bar on every page links to `draft.html?practice=1`, which boots
   straight into a playable board; `test-practice-autostart.mjs` asserts that
   flow makes zero network calls. Practice always uses the built-in pool even
   if a league is configured. Do not reintroduce a dependency on ESPN here:
   the whole point is that it works from a cold start.

   **Before the next draft:** set the slot (the league randomises it an hour
   beforehand), and decide whether the `TUNING` numbers match Tim's intent —
   they are placeholders standing in for answers he has not given yet.

   Still open here: the live ESPN draft feed has never run against a real draft,
   and `draftDetail.inProgress` could not be verified. The poll loop therefore
   keys off `picks.length` growing, never off `inProgress`. Manual mode is the
   real fallback and is fully functional.

5. **The drafter's spec questions are still Tim's to answer.** The build makes
   choices he has not confirmed, all isolated in `TUNING`: how strictly to
   follow the position rules vs pure best-available, what counts as "skipped for
   a while" (currently 8 picks past ADP), and what "too far from the top" means.
   Do not quietly re-tune these to taste — they are stand-ins for his judgement.

   Also unexplained by Tim, and deliberately reproduced rather than rationalised:
   **the score-differential curve** (`150/margin - 7*sign(margin)`, clamped
   +/-50). He said he would explain it later. Do not simplify it in the meantime.

## What this is

A site for fantasy football stats/analysis, and eventually a "smart drafter."
Tim specs what it does; Claude builds it.

**Status as of 2026-09-09:** stats module complete and verified against Tim's
own 2025 numbers; draft assistant built and parked; the bridge extension is
live and reading his real league. Focus now: trades, player analysis, stats on
real data.

## Current state

- `index.html` — connect panel + raw data probes.
- `stats.html` / `analysis.html` / `schedule.html` — season stats, weekly
  rosters, results and head-to-head. Every page carries the connection strip
  (`js/connection.js`) that shows whether it is on real or demo data.
- `draft.html` — the draft room + practice mode. See `DRAFT-STRATEGY.md`. Parked.
- `extension/` — the bridge that reads the private league. See below.
- `js/espn.js` — the ESPN connection layer. Fetch + decode only, no strategy.
  Routes through the bridge when installed, direct fetch otherwise.
- `js/bridge.js` — the site's half of the extension bridge.
- `docs/espn-draft-api.md` — field-path reference for the ESPN endpoints,
  verified against live public leagues. Read this before touching ESPN code;
  it records several traps, including that a `sort*` clause is **mandatory** in
  `x-fantasy-filter` (omit it and you get an empty player list, not an error).

## The bridge & writes

`extension/` is a Manifest V3 browser extension (loaded unpacked in Edge). It
exists because a static site cannot read a private ESPN league — third-party
cookies are blocked and a page cannot set the `Cookie` header. The extension's
background service worker makes the ESPN calls (cookies attach because
espn.com is in host_permissions; extensions are same-site for permitted hosts,
so even SameSite=Strict cookies are sent — no `cookies` permission needed) and
`content-site.js` relays requests from the site over `window.postMessage`.

- **How data flows:** site → `js/bridge.js` → postMessage → `content-site.js`
  → `background.js` → ESPN → back. Nothing is stored; nothing leaves the
  browser. `js/espn.js` auto-routes through it, so every existing page got
  real-league access with no change.
- **Security (a review hardened this — do not regress it):** `background.js`
  builds URLs with the URL API from validated parts and re-checks host + path,
  because string interpolation let a page inject the query or walk the path.
  Both `content-site.js` and the worker enforce an allowed-origins set (the
  manifest cannot pin a port). The worker checks sender id/origin. `test-
  extension.mjs` is the regression guard.
- **Writes are NOT built.** host_permissions holds only the read host. When
  writes come (set lineup, add/drop, propose trade), they must go behind a
  popup confirmation or a popup-issued nonce — never the open page bridge, or
  any page on the origin could drop players. Tim wants an in-ESPN suggestion
  panel eventually; that is the phase after read-only analysis proves useful.
- **Edge gotchas:** service worker shows "Inactive" when idle (normal). After
  editing extension files, Reload the extension AND refresh the site tab. The
  extension must be in the same Edge profile where Tim is signed into ESPN (he
  has three profiles). If ESPN refuses, the cause is usually Edge blocking
  third-party cookies or Tracking Prevention on Strict — allow `[*.]espn.com`.

## What's verified working

- **Public leagues** are readable by direct fetch, no cookies, HTTP 200
  (tested against public leagues 1241838 and 899513 on 2026-09-08).
- **Tim's private league (476225250)** is readable through the bridge
  extension, confirmed end to end in his browser 2026-09-09.
- **Projections come back scored under the queried league's own rules** because
  requests go through the league path, not ESPN's defaults. Real data spot-
  checked, e.g. Jahmyr Gibbs 2026.

**Settled the hard way, so nobody relearns it:** a static site canNOT read a
private league on its own. ESPN sends `Access-Control-Allow-Credentials: true`,
but that only means ESPN will *accept* cookies — the browser still refuses to
*send* third-party cookies from a github.io page, and JS cannot set the Cookie
header. This is why the bridge extension exists. Do not attempt a pure
client-side fix; it cannot work.

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
- **Reads only, for now.** No write to ESPN has been built. Writes are a planned
  later phase (see "The bridge & writes"), not out of scope — Tim wants them.
- A static site cannot read a private league; the bridge extension is the
  answer, and it is what carries the cookie ESPN needs. If Edge blocks
  third-party cookies or Tracking Prevention is Strict, allow `[*.]espn.com`.
- ESPN ToS prohibits automated access; the practical risk for a personal league
  is low but real and Tim's to carry. It already covers the reads; writes raise
  it. Flagged, his call — do not silently expand automation.

## Parked (built, then set aside)

**Superseded 2026-09-08** — the drafter now exists, built to Tim's own stated
strategy rather than to Claude's design. The note below is kept only as the
record of why the first attempt was removed. The same maths came back, but this
time subordinated to his rules.

A draft recommendation engine was written and validated against real 2026 data
before Tim scoped the project down. It implemented VORP with dynamic replacement
levels, ADP-based survival probability, positional-run detection, and tier
breaks. Sanity checks passed: it correctly pivoted off RB once RB slots filled,
and correctly suppressed K/DST until the final two rounds.

It was removed from the repo because **Tim is designing the drafter, not
Claude.** Kept only as evidence the data supports this kind of math. Do not
reintroduce it without Tim's spec.

## Stats module — reverse-engineered from Tim's 2025 sheet

The 2025 sheet first arrived as a PDF, which carries computed values but not
cell formulas, so the metrics below were recovered from the numbers alone and
verified by re-computing them from the real 2025 scores.

**Verification: 79 of 80 assertions reproduce the sheet exactly.** See
`js/stats.js`. The one miss is Autumn's Skill (-0.6 computed vs 0 shown), which
is display rounding in the sheet, not a formula difference.

The five that resisted that approach were later read straight out of the sheet's
xlsx export — see "RECOVERED" below, a separate 116-assertion suite.

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

### RECOVERED 2026-09-08 — all five, from the xlsx

The sheet was exported as xlsx and its `<f>` elements read directly. All five
open formulas are now resolved and implemented in `js/stats.js`.

| Metric | Formula | Evidence |
|---|---|---|
| Third Score-Differential column | `MIN(MAX((150/margin) - 7*SIGN(margin), -50), 50)` | verbatim from cell D33 |
| SD | mean of that value across the season | verbatim from AR33; 8/10 teams match the standings block to 15 s.f. |
| PTW | `oppAvgActual - ownAvgLuck` | verbatim from AX3 (`=AU3-AR3`); 10/10 |
| LUCK | `leagueAvgActual - (PTW - SD)` | verbatim from AZ3 (`=121.8-(AX3-AY3)`) |
| Cumulative Luck | the LUCK formula run on weeks 1..w | 127/130 cells exact |
| LS / PS / AS | rank by LUCK / by S+L / by wins then points | 10/10 each |

The xlsx also carries Tim's own cell comments, which confirm every label
independently: `PTW` = "projection to win", `SD` = "score differential",
`S+L` = "skill +luck", `F-A` = "points for- points against", `LS` = "Luck
Standings- postions based on luck", `PS` = "projected standings- based on luck
and 'skill' (avg proj)", `AS` = "actual standings (post week 6)". The Analyze
tabs carry "Recorded by each player's season avg. proj. pts. (After week 1)"
with a colour key — bold = flex player, dark red = IR, red = out. The Schedule
tab's is "Avg. starters' 2025 Season Projected".

Two things the sheet does that the site deliberately does not — **both confirmed
by Tim on 2026-09-08**:

1. **The league-average terms were typed in by hand and had drifted.** The sheet
   subtracts a hardcoded 121.8 (actual) and 122.3 (projected); the 2025 season
   really averaged 117.16 and 122.49. Tim: *"I think I just typed in the season
   average of whatever was in at the time, so they're slightly different."* They
   were meant to be the live league average, so the site computes them from the
   games. Its LUCK and S+L sit ~4.6 below the sheet's and Skill ~0.19 above;
   every ranking is unchanged.
2. **The formula changed mid-season** — that is what "adjusted formula" means.
   Weeks 1-8 of the Cumulative Luck table use an older
   `MIN(MAX(100/margin, -30), 30)`; weeks 9-13 use the current one. Tim: *"I just
   discovered a better formula after week 9 [...] don't think about it too much,
   it doesn't impact our site."* The site uses the current formula throughout, so
   early-week numbers will not match the sheet. That is intended.

**The score-differential curve itself (the 150, the -7, the +/-50 clamp) has a
rationale Tim has not explained yet.** He will; do not guess at it, and do not
"simplify" the formula in the meantime.

### What the sheet's columns mean — answered by Tim, 2026-09-08

Straight from Tim. These are intent, not inference, and they override any
earlier guess in this file.

- **p/p = "points per player."** A starting lineup is 9 players, so it is the
  team's average score divided by 9. (In the sheet only Week 1 -> Act kept its
  formula; the rest of the `avg` and `p/p` rows are pasted values, which is why
  one cell looked hardcoded. They are all still `avg / 9`.)
- **Cumulative Luck is not a separate metric.** It is simply LUCK evaluated at
  each week, and LUCK already folds in every week to date. Tim: *"as time goes
  on, cumulative luck gets more and more accurate, and if luck is truly random
  it should get closer and closer to 0 for everyone."* That convergence is the
  point of the chart, and the STDEV row underneath is there to show it.
- **"Week 9 standings" is a stale label.** It was a running snapshot Tim updated
  weekly and stopped updating near the end. The data under it is full-season —
  the wins column totals 65, i.e. 13 weeks x 5 games. The site computes
  standings live, so it does not reproduce the snapshot.
- **AS ties really do break on total points.** Confirmed as the league's rule.
- **FLEX is the best of RB / WR / TE only** — never QB, and DST is not in the
  table at all.
- **"Avg points" is per-week, not per-season.** It is what that team would score
  in a week if every starter hit their season-average projection. Excludes DST.
- **"Missing" columns are a layout artefact, not data.** Roster shapes differ —
  Jonas carried 4 bench WRs, Miles 8 — so rather than pad every team to the
  widest case, the overflow players went into three spare columns. Tim: *"We
  will do this differently in our Player display on our site."* So
  `analysis.html` should render each team's real bench, however long, and must
  not reproduce "Missing" columns.
- **"Est Total" = Avg points + 16.** A flat allowance for DST and K, which both
  tend to score about 8. They are left out of the main table because they are
  consistent and get dropped and traded constantly.
- **The Jonas tab was trade exploration** — Tim working out a possible 3-way
  trade with Jonas, and whether it could genuinely help both sides.
- **The Predictions tab was a hypothesis test**: could Est Total at a given week
  predict the final ranking? That is a question the site could answer properly
  across all 13 weeks rather than just week 1.

### Injury Losses — parked, with the method Tim used

Both Injury Losses tables are empty and **injury tracking stays out of the
site**. Recorded here at Tim's request so the method is not lost if it ever
comes back.

It was manual. For a manager holding an injured player, Tim compared their team
projection after the injury against what it would have been with that player
available, assuming the player would have projected near their own season
average. The difference is the loss. The comments still in the lower table are
the working: Jonas week 4 *"8 from ceedee lamb, 2 from james conner, 2 from mike
evans"*; Miles week 13 *"6 from bucky irving, 7 from jamarr chase"*; Miles week
12 *"Jamarr Chase suspension"*.

Automating it needs a per-week injury status and each player's season-average
projection — ESPN exposes both (`mRoster` per week, `kona_player_info`) — plus a
decision on suspensions, which Tim counted alongside injuries.

### Two bugs in the sheet, both from one game

Miles played Jonas in week 9 and won by **0.4 points** (94.7 vs 95.1) — the only
game all season decided by a fraction. The Score Differential block (rows 33-42)
stores hand-typed integer margins, and that game broke both of its cells:

- **`Z35` (Miles, week 9) is typed as `0`** rather than -0.4. `150/0` makes
  `AB35` `#DIV/0!`, which poisons `AR35`, Miles's season SD.
- **`Z34` (Jonas, week 9) is `=Z4-Z20`, pointing at the wrong team.** It is the
  only formula cell in the whole block. Rows 33-42 are alphabetical (Jonas =
  34), but the standings block above is not — row 4 is *Watkins*, row 5 is
  Jonas. So it computes Watkins's score minus Jonas's opponent's, giving a
  margin of +24.3 where Jonas's real margin was +0.4.

The site computes margins from the game scores, so it gets both right: a
0.4-point game saturates the clamp at +50 / -50 for the winner and loser, which
is the formula behaving as intended. Expect the site and the sheet to disagree
for Miles and Jonas — the site is correct.

Also note rows 4-12 of the standings block hold pasted values, not formulas.
Only row 3 kept its formulas, which is what made recovery possible at all. One
consequence: those pasted values are a snapshot, so Miles's weeks 4-6 in the
Cumulative Luck table carry a stale cell worth 3 points.

**Verification: 116 of 116 assertions pass** against the real 2025 season, once
the two drifted constants above are accounted for. See the note on `exact` in
`js/stats.js`: standings must sort on unrounded values, because Stevenson and
Mitch finished 0.002 apart in S+L and rounding to 1 dp swaps them.

## Site structure

Pages (all default to demo data; real data arrives via the bridge):

- `index.html` — season dashboard: this week's matchups with projections,
  roster strength, standings, injured starters, points left on the bench
- `stats.html` — season stats, the rebuild of Tim's sheet
- `analysis.html` — all ten teams' lineups at once, plus a per-team drill-down
- `schedule.html` — standings, matchups, results, fixture / head-to-head grid
- `waivers.html` — "Add players": everyone not on a roster, in a table whose
  columns are week numbers and whose cells are ESPN's projection for that
  player in that week. Position filter, every column sortable.
- `draft.html` — draft assistant + practice mode (parked)
- `debug.html` — the raw ESPN data probes. Not in the nav; linked from the
  bottom of the home page. Its connect form deliberately does not persist,
  so probing another league cannot repoint the real pages.

Modules:

- `css/app.css` — shared styles (incl. the connection strip). Tokens in
  `:root`, including `--series-1..10`, which `js/charts.js` now reads via
  `var()` instead of hardcoding. **Do not re-tune those ten colours** — they
  were validated for colour-vision deficiency and for keeping a team the same
  colour across every chart.
- `js/prefs.js` — one localStorage key behind `get`/`set`/`scope`. Persists
  data source, week, selected team and sort so they survive a reload.
- `js/projection.js` — rosters → what every team is projected to score in every
  week, plus the schedule-derived averages built on that. **Shared by the
  schedule page and the stats page; do not grow a second copy.** Pure.
- `js/waivers-page.js` — the Add players page.
- `js/forecast.js` — win probabilities, optimal lineups and season win-total
  distributions. Pure: no DOM, no fetching, so it is node-testable. The
  distribution is an exact Poisson-binomial convolution, not a simulation.
- `js/home-page.js`, `js/debug-page.js` — the dashboard and the probe page
- `css/draft.css` — draft room styles
- `js/espn.js` — ESPN API connection layer; routes through the bridge
- `js/bridge.js` — site half of the extension bridge
- `js/connection.js` — the connection strip on every page
- `js/season.js` — ESPN → canonical shapes (`fetchSeasonData`, `fetchWeekRosters`, `fetchSchedule`)
- `js/demo.js` — fake season scores
- `js/demo-rosters.js` — fake weekly rosters + schedule, reconciled to `demo.js`
- `js/draft-demo.js` — real 2026 player pool for the drafter (fallback data)
- `js/stats.js` — all statistics
- `js/draft-model.js` — draft engine (pure); `js/draft-sim.js` — practice opponents + grading
- `js/charts.js` — inline-SVG line / histogram / box-plot rendering
- `js/sortable.js` — shared click-to-sort for every table
- `js/stats-page.js`, `js/analysis-page.js`, `js/schedule-page.js`, `js/draft-page.js` — page wiring

Extension (`extension/`, loaded unpacked in Edge):

- `manifest.json`, `background.js` (the ESPN calls), `content-site.js` (the
  page relay), `popup.html`/`popup.js` (the test popup), `icons/`

### Table sorting

Every table uses `js/sortable.js`: click a header to sort, click again to
reverse. Mark headers `<th data-sort>`. When the displayed text isn't the sort
value, put the real number on the cell as `data-v` — that is how a "10-3"
record sorts by wins and how a lineup slot sorts in QB→RB→WR→TE→FLEX order
rather than alphabetically. Missing values sort to the bottom in both
directions. Clicks are delegated from the table element, so a table may rewrite
its own `<thead>` freely; after re-rendering rows, call `resort(table)`.

## Testing

**The suites are in `tests/` now. Run them with `cd tests && npm install &&
npm test`** — see [tests/README.md](tests/README.md).

This changed on 2026-09-09. They used to live in the session scratchpad and be
deliberately uncommitted, on the grounds that they needed a local `linkedom`.
That reasoning did not survive contact with how much they had grown: by the end
of the day they were about 900 assertions encoding things that had cost real
effort to discover — the ESPN traps, the early-season honesty rules, a
byte-identical check that proved a refactor was a no-op — and throwing them away
every session meant each new session either rebuilt them badly or skipped them.
A `package.json` naming one dependency was a smaller price.

The table below still lists suites from earlier sessions that were NOT
recovered (the draft and stats-formula ones). Those are documented rather than
present: the coverage is worth recreating if that code is touched again.

| Suite | Covers |
|---|---|
| `verify-stats.mjs` | every formula against Tim's real 2025 numbers |
| `test-integration.mjs` | demo.js → stats.js end to end |
| `test-charts-integration.mjs` | charts fed the exact shapes the pages build |
| `test-sortable.mjs` | sorting against a real DOM, 21 assertions |
| `test-demo-rosters.mjs` | roster/schedule contract + reconciliation |
| `test-pages-render.mjs` | loads each page's real HTML and runs its real module |
| `test-recovered.mjs` | the five recovered formulas, 116 assertions, against the real 2025 season |
| `test-draft-model.mjs` | the draft engine on a synthetic pool — 44 assertions, no external data |
| `test-draft-render.mjs` | simulates a full 16-round draft from slots 1, 5 and 10 against the real demo pool — 107 assertions |
| `test-draft-sim.mjs` | practice opponents, lineup optimiser and grading — 36 assertions |
| `test-practice.mjs` | complete practice drafts through the page's own logic, boots `draft-page.js` against the real DOM, and asserts the connection bar is mounted — 99 assertions |
| `test-practice-autostart.mjs` | lands on `draft.html?practice=1` in an empty browser and asserts a playable draft with zero network calls |
| `test-sim.mjs` | the season simulator — 71 assertions. RNG mean/variance, the normal's mean/variance/kurtosis, **that the simulated win rate matches `winProbability`** (the check that keeps the two models honest with each other), place probabilities summing to 1 per team AND per place column, mean placings summing to 55, mean wins matching the exact Poisson-binomial, the points-for tiebreak, and a finished season yielding certainty rather than noise |
| `fc-test.mjs` | the schedule page's forecast and simulation end to end — 375 assertions over 8 scenarios (demo, demo-mid, stubbed live at week 2, no team set, team picked later, switching through all ten teams, simulation interaction, roster fetch failing). Boots the real `schedule.html` with its real module in a child process per scenario |
| `test-forecast.mjs` | the forecast engine — 68 assertions. The normal CDF against textbook values, `optimalLineup` against brute-force enumeration over 350 random rosters in three league shapes (including superflex), and `winTotalDistribution` against exhaustive enumeration of every win/loss combination |
| `test-bridge.mjs` | the site half of the bridge: a stand-in extension answers postMessage, and `js/espn.js` is proven to route through it — 34 assertions |
| `test-extension.mjs` | runs `extension/background.js` with chrome+fetch stubbed and asserts URL injection / path traversal / bad origins are refused before any request — 38 assertions |

All green as of 2026-09-09: extension 38, bridge 34, draft-model 44, draft-sim
36, practice 99, autostart 10, draft-render 107, recovered 116, plus the
stats-render check.

`test-practice-autostart.mjs` needs its own process: a module only initialises
once, so the auto-start path cannot be tested in the same run as the normal one.

`test-practice.mjs` is the only suite that actually executes `draft-page.js`. A
missing element id or a typo in the page module sails through everything else
and only shows up in a browser, so keep that boot check.

`test-pages-render.mjs` is the cheapest high-value suite to rebuild first, and
it caught real breakage during the 2026-09-09 pass. Two things it needs that
are easy to get wrong:
- Load **each page in its own child process**. A module initialises once per
  process and every page module self-boots on import, so one process cannot
  render two pages.
- Take the table prototype from `Object.getPrototypeOf(document.createElement
  ('table'))`, NOT from `window.HTMLTableElement` — under linkedom those are
  not always the same object, and defining on the wrong one leaves
  `table.tBodies` undefined. Also shim `window.location`: `js/bridge.js` reads
  `window.location.origin` on every ping, and linkedom provides no location, so
  the throw surfaces as an unhandled rejection out of `connection.js` and kills
  the child — which looks exactly like a page failure and is not one.

Note for the harness: linkedom defines `<select>.value` on
`HTMLSelectElement.prototype` and it returns `undefined`. Shimming it on
`HTMLElement.prototype` does nothing — it is shadowed — and would break
`<input>` too. Shim the select prototype specifically.

`test-draft-render.mjs` is the important one and it is **randomised**, so run it
several times, not once. Three real bugs surfaced only on repeat runs: the
missing hard block on luxury picks in the last rounds, tight ends being stacked
three deep, and — the subtle one — the scarcity term quietly cancelling the
wait-on-QB penalty, because an elite QB in round 5 genuinely *is* scarce.

`test-recovered.mjs` needs no `linkedom` but does need its fixture: rebuild it
by re-exporting the sheet and running `export_2025.py`, which reconstructs the
65 real games by pairing the Stats tab's scores through the Schedule tab.

Note for anyone rebuilding these: `linkedom` implements neither the
`HTMLTableElement` conveniences (`tBodies`, `tHead`, `rows`, `cells`) nor a
settable `<select>.value`. Both are standard in real browsers, so page code
using them is correct — the harness shims them.

### Weekly projections from ESPN: a real constraint

ESPN does not store "what was this team projected to score in week 4". It only
stores per-player projections. `js/season.js` reconstructs each week's team
projection by refetching that week's rosters and summing the projections of
whoever was in the starting lineup — one request per week. If ESPN returns
projections for fewer than half the games, the page says so rather than
silently rendering zeroes.

## Next

Focus is trades, player analysis, and stats — on the now-connected real league.
Tim will specify the first build. Prepared ground, in likely order:

- **Check the rebuilt pages against the real league.** The 2026-09-09 pass was
  verified against demo data and stubs, and every page boots clean, but it has
  NOT been seen against live 476225250 in a browser. That is the first job:
  open each page on the real league and fix whatever the real payload breaks.
  Two things to look at specifically — whether `% own` actually populates from
  the `mRoster` view (the analysis grid hides that column when it does not),
  and whether the strength-of-schedule basis on `schedule.html` picks the path
  it should.
- **Trade interaction** — the feature he named first. Likely: evaluate a
  proposed trade's effect on both rosters, and find mutually beneficial trades
  using opponent-need logic (the same idea as the draft engine's). Build the
  *analysis* with a send-it-yourself button; do not auto-send. The all-teams
  grid on `analysis.html` is the natural surface to build this onto — it
  already computes each team's lineup and baseline by position.
- **The Predictions tab** — the one genuinely unbuilt idea from his sheet.
  He tested by hand, for week 1 only, whether Est Total at a given week
  predicts the final ranking. The site can answer it across all 13 weeks.
- **Writes / in-ESPN panel** — the later phase. See "The bridge & writes".

Still parked, do not pursue unless asked:
- The smart drafter (built; awaits his spec answers in `TUNING`).
- Fold in Tim's remaining sheet-formula answers if he gives them.
- The score-differential curve rationale (he will explain; reproduce, don't
  rationalise).
- Injury-loss automation (method recorded in `js/stats.js`; deliberately out).
