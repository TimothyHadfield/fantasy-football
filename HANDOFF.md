# Read this first

Live: https://timothyhadfield.github.io/fantasy-football/
Repo: https://github.com/TimothyHadfield/fantasy-football

Last updated 2026-09-10.

This is the orientation. **`PROGRESS.md` is the detailed reference** — every
rule below is expanded there, along with the history of how the numbers were
reverse-engineered from Tim's spreadsheet. `docs/espn-draft-api.md` is the
field-level ESPN reference. `DRAFT-STRATEGY.md` covers the parked drafter.
`tests/README.md` says how to run the test suites.

---

## Say this to him first, in any session before the season ends

**Nothing has been captured yet, and every week that passes without a capture
is a week that can never be recovered.**

The schedule page's time machine records what the forecast said, once a week,
so it can be looked back on in December. ESPN keeps **no history of its own
projections**, so this cannot be backfilled by any means — see rule 8 below.
A reading is only taken when **Tim opens `schedule.html` on live data** in the
Edge profile that has the bridge extension. A week he never visits is simply
gone.

As of 2026-09-10, `data/snapshots/` holds nothing but its README and no export
has appeared in his Downloads, so either he has not opened the page yet or he
has not exported. Two things to ask, in this order:

1. **"Has the Time machine panel recorded this week?"** If not, that is the one
   thing worth interrupting anything else for.
2. **"Does the panel say any week is un-backed-up?"** If it is red, ask him to
   press **Export archive** — the file lands in his Downloads and *you* commit
   it to `data/snapshots/<league>-<season>.json`. Check
   `C:\Users\timha\Downloads\fantasy-archive-*.json` yourself before asking; he
   may have exported already and not said.

An export is **cumulative** — one file holds every week — so it is a monthly
job at most. Do not tell him to export weekly; he asked, and it is not true.

---

## What this is

A static site (GitHub Pages, vanilla ES modules, no build step, no framework)
for Tim's 10-team ESPN fantasy football league. **Tim specifies what it does;
Claude builds it.** It is 2026 season, week 1-2.

His league is **476225250**, and it is private. A static page cannot read a
private league — ESPN's cookies are third-party from github.io and JS cannot
set the `Cookie` header — so `extension/` is a browser extension that makes the
calls instead. It is installed in Tim's Edge and working. **Do not attempt a
pure client-side fix for private leagues; it cannot work, and that was settled
the hard way.**

## Standing instructions

- **Push every change when it is done.** Tim judges the work by the deployed
  site, not the working tree. Never leave finished work uncommitted. Split into
  sensible commits; never push failing tests.
- **Give links, not prose directions.** Link the destination — deep links with
  his IDs, IDE-clickable file paths. `edge://` addresses cannot be linked; give
  those as copy-paste and say why.
- **After pushing, tell him to hard-refresh** (Ctrl+Shift+R). GitHub Pages
  sends a 10-minute cache lifetime, and he has twice thought a change had not
  deployed when it had.

## How he works, and what he expects

- He checks the numbers by hand against ESPN's own site. When he says a number
  is wrong, **he is usually right and has evidence** — he caught the projection
  model being built on the wrong source this way. Test the claim against a real
  league before defending the code.
- He asks for things in his own vocabulary ("players" means managers/teams;
  "sorting" has meant the position filter). **Read the intent, then say which
  reading you took in the reply** so he can correct it cheaply.
- **He iterates.** Several features here were built, shown to him, and changed
  twice. When he says something is hard to read or in the wrong place, he is
  describing a real defect — take it at face value rather than defending the
  first answer. The tip card exists because the first answer to the same ask was
  a native tooltip, which could not draw what he wanted.
- He sends new asks mid-task. Finish what is in flight, then take the new one;
  do not abandon a half-applied edit.

### Running agents in parallel — he asks for this, and it has a cost

Three separate defects have come from concurrent edits: a CSS token deleted as
"unused" while another agent was starting to use it; a page pushed before its
imports were committed; and a whole feature that passed every per-page suite
while a quarter of its links landed on a wrong answer, because three authors
built two halves of one contract at once.

So:

1. **Give each agent a disjoint file set, and name the files the others own.**
   Every agent that has been told this has respected it.
2. **Anything that spans two agents' files needs a test that spans them.**
   `link-check.mjs` is that test for the player click-through, and it found the
   defect the day it was written.
3. **Verify the whole tree yourself afterwards.** Do not take an agent's "all
   green" as the final word — its run may predate another agent's landing.
   Agents legitimately see failures caused by work in flight elsewhere; that is
   noise, but a real failure hides in it easily.
4. Expect an agent to touch a test outside its set when the behaviour it was
   asked to change is what that test asserts. That is usually correct — check
   the diff and keep it if the assertion encoded the old truth.

## The rules that must not be re-litigated

These were each established by testing, and several by getting them wrong first.

1. **ESPN publishes projections, never odds.** Every percentage on the site is
   our model, and the pages say so in those words. Do not relabel any of it as
   ESPN's number.
2. **ESPN DOES publish a per-week projection for every future week**, through
   week 13, for rostered players and free agents alike. A player on bye comes
   back at **0.00** — which is a different fact from `null` (ESPN had nothing),
   and the pages draw and sort them differently. Verified against public league
   1241838.
3. **There is no bulk form.** One request per week, for rosters and for the
   waiver wire. Asking for thirteen weekly stat ids at once returns only the
   current week. Four shapes of that request were tried; do not retry them.
4. **The free-agent week only works when no stats filter rides along** with
   `scoringPeriodId`. Send both and the weekly line vanishes silently — no
   error, just no projection.
5. **Decide what a statistic returns before it has enough data.** With one week
   played, the old stats page drew ten dots in a stripe, a box plot of 1.5px
   slivers, `Std Dev 0.0` for every team, and an accuracy percentage from five
   games. Nothing crashed; all of it looked authoritative. Now `stdev`,
   `boxStats`, `predictionAccuracy` and `rankBy` return `null` below their
   thresholds and the pages render "—".
6. **Never read `localStorage` directly for the league config.** Use
   `savedConfig()` / `onConnection()` from `js/connection.js`. The bar once
   wrote one key while every page read another, so it could say "Connected"
   while every page insisted no league was configured.
7. **State the basis of every derived number** in a panel note. That is the
   house style throughout, and it is why the pages are trustworthy.
8. **ESPN keeps no history of its own projections.** It publishes next week's
   and week 13's; it cannot tell you what it thought last month. Anything the
   site wants to compare across time must be captured while it is on screen —
   that is why `js/snapshots.js` exists, and why nothing about it can be
   "reconstructed later instead".
9. **The archive's durable home is the repo, not the browser.** Tim exports one
   JSON file; it is committed under `data/snapshots/<league>-<season>.json`;
   the page pulls it back on every live load. An export is **cumulative** —
   one file holds every week — so this is a monthly job, not a weekly one, and
   the panel names in red any week that is still only in his browser. **What
   is weekly is him opening the schedule page on live data**: that is when a
   reading is taken, and a week he never visits cannot be recovered later.
   **Ask him for a fresh export when the panel says one is outstanding.** Firebase was considered
   and rejected: it works, but the setup is ten minutes only he can do, and no
   connector here can provision a Google Cloud project.

## Contracts that hold the site together

Break one of these in one file and the break shows up in another.

- **The player click-through.** Every page that names a player — or shows a
  number standing for one — links to
  `waivers.html?player=<espnPlayerId>` with `class="pref"`, as a real `<a href>`
  so middle-click and open-in-new-tab work. ESPN's own id, never a name or a row
  index. **One contract only**: a second way of naming a player is exactly how
  the two halves drift apart. Add a new page to `link-check.mjs`'s `SOURCES`.
  The landing marks the ONE addressable row — a man who is both rostered and
  your own "Your QB2" appears twice, and only the row carrying the `id` is lit.
- **`js/sortable.js` sorts EVERY `<tbody>`, each independently.** Nearly every
  table has one. Several is how a table keeps groups apart under a sort — the
  roster detail is starters, a totals band, then the bench — and a body of one
  row is left alone, which is what pins the band.
- **Two greens on the wire, and they are separate cues.** Green text = over the
  startable bar; green shading = beats your own worst man at that position that
  week. Do not merge them: they answer different questions, and the split is
  also what keeps them apart for anyone who cannot separate the hues.
- **FLEX is a filter, never a position.** It is not in `POSITIONS` or
  `POS_ORDER`, and nothing downstream may learn it exists — ranks, labels and
  the startable bars all read a player's real position.
- **The analysis grids' hover is a card, not a `title`.** Do not put a `title`
  back on those cells: the browser would draw a second tooltip over the card.
  The link carries `aria-label` for the same reason.

## Where things stand

Everything Tim has asked for is built and live:

| Page | What it does |
|---|---|
| `index.html` | Season dashboard — this week's matchups with projections, roster strength, standings, injured starters, bench points |
| `stats.html` | The rebuild of his 2025 spreadsheet, plus schedule luck (average projected opponent), which needs no games played |
| `analysis.html` | All ten squads **twice over** — nine spots, a total and the bench, once on the season average and once on the selected week, with a hover card carrying each man's whole season as a chart and bench ranks (`12.3 RB4`); a per-team drill-down whose lineup you can **swap around** to see what it would score; "Season by week"; and **"Who to start, week by week"** — one position at a time, the whole season across, every week that man makes the best legal lineup shaded (an `F` when he only gets in through the flex), so a starter's byes and soft weeks and whoever covers them are one glance apart |
| `schedule.html` | Standings, matchups, results, fixture/head-to-head grid, per-matchup win %, a season forecast per team, a Monte Carlo season simulation, and a **time machine** — a reading of the whole page is saved automatically once a week, picking one replays the season as it looked then, and the archive committed under `data/snapshots/` restores itself into any browser |
| `waivers.html` | **"Players"** — the wire priced by week, your own worst man at each position in the same list, every week that beats him shaded; then **"Taken players"**, everyone rostered, uncoloured, with owner and squad rank. Each table has its own position filter (incl. FLEX); the week span is shared |
| `trade.html` | **Depth map** — ten managers by six positions, each cell the points his starters are above replacement, so reading down a column finds who is thin where you are deep. Then the **finder**: every 1-for-1, 2-for-1 and 1-for-2 in the league, keeping only the ones where **both** lineups improve |
| `draft.html` | Draft assistant + practice mode. **Parked** — do not add to it unless he asks |
| `debug.html` | Raw ESPN probes. Not in the nav |

Shared modules worth knowing before touching anything:
`js/espn.js` (transport + decoding), `js/season.js` (fetching, one request per
week), `js/projection.js` (rosters → per-week team points; **shared by two
pages, do not grow a second copy**), `js/forecast.js` (win probability, optimal
lineup, win-total distribution, season simulation — pure and node-testable),
`js/trade.js` (replacement level, the depth map, the trade finder — pure, and it
**wraps `forecast.js`'s `optimalLineup` rather than copying it**),
`js/snapshots.js` (the time machine's format and storage),
`js/prefs.js`, `js/connection.js`, `js/charts.js`, `js/sortable.js`.

**Three features now share `optimalLineup`** — the schedule forecast, the trade
finder and "Who to start". That is deliberate: it is the reason they cannot
disagree about who a squad ought to be starting. Do not give any of them a copy.

## Tests

`cd tests && npm install && npm test` — 17 suites, over 3,500 assertions.
They are in the repo now; earlier sessions kept them in a temp directory and
lost them each time. **Run them before and after any change**, and see
`tests/README.md` for the two linkedom gotchas that otherwise waste an hour.

Three worth knowing by name:

- `test-pages-render.mjs` boots every page's real HTML with its real modules, so
  a missing element id or a typo in a selector fails there instead of in Tim's
  browser. Cheapest high-value suite there is.
- `link-check.mjs` tests the **seam between pages** — one page makes a player
  link, another resolves it. Every per-page suite was green while a quarter of
  the analysis page's links landed on "he may have been dropped".
- `an-test.mjs` and `fc-test.mjs` are the two big end-to-end ones (565 and 434
  assertions). They re-derive their expected answers independently rather than
  reading the page's own arithmetic back to it — `an-test` rebuilds every week's
  lineup from `demo-rosters.js` to check the who-to-start marks, and `fc-test`
  replays a **doctored** archive whose numbers the live page could not produce,
  so "the time machine works" is falsifiable rather than a page agreeing with
  itself.

## What is genuinely open

- **The archive is empty and the clock is running.** See the block at the top of
  this file. This is the only open item with a deadline: everything else can be
  built in December just as well as today.
- **Nothing has been checked against his real league in a browser.** All of it
  is verified against demo data, stubs and public leagues. That is the first
  thing to do: open each page on 476225250 and fix what the real payload
  breaks. Specifics to watch — whether `% own` populates from the roster view;
  whether any week's projection drops implausibly far (bye handling over-firing);
  and whether the Players page's two-requests-per-week feels acceptable to him
  on a real thirteen-week span.
- **Trade interaction** — the depth map and the finder are BUILT (`trade.html`,
  `js/trade.js`), to Tim's "build 1 and 2" on 2026-09-09. What is deliberately
  not built, and was on the same list of ideas he picked from: showing a trade's
  effect in **expected wins** rather than points (`simulateSeason` already
  exists), a **week-by-week strip** so a deal that is +5 on average and −12 in
  the playoff weeks is visible, and an **auto-written pitch message**. Ask
  before adding them; he asked for two of five on purpose.
  **Nothing is ever sent to ESPN** and the page says so — writes are the later
  phase below.
- **Playoff odds.** The simulation reports who finishes first in the
  regular-season standings and says plainly that this is not a championship.
  Real title odds need his bracket rules — size, seeding, byes — and he has not
  given them.
- **Writes to ESPN** (set lineup, add/drop, propose trade) are a later phase he
  has asked about. They must go behind a popup confirmation or a popup-issued
  nonce, **never the open page bridge** — any page on the origin could otherwise
  drop players. See "The bridge & writes" in `PROGRESS.md`. The roster detail's
  swap is the obvious first candidate — it already builds a legal lineup — but
  it is a what-if today and the page says so; do not quietly wire it up.
- **A FLEX-empty table is untested.** Every fixture pool contains running backs,
  so the filter always matches somebody. The same empty-state wording is proven
  through the reachable "no defense" case.
- The drafter's `TUNING` numbers are placeholders standing in for answers he has
  not given, and the score-differential curve has a rationale he has promised
  and not yet explained. Reproduce it; do not simplify it.
