# Read this first

Live: https://timothyhadfield.github.io/fantasy-football/
Repo: https://github.com/TimothyHadfield/fantasy-football

Last updated 2026-09-09.

This is the orientation. **`PROGRESS.md` is the detailed reference** — every
rule below is expanded there, along with the history of how the numbers were
reverse-engineered from Tim's spreadsheet. `docs/espn-draft-api.md` is the
field-level ESPN reference. `DRAFT-STRATEGY.md` covers the parked drafter.
`tests/README.md` says how to run the test suites.

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
- He asks for things in his own vocabulary ("players" means managers/teams).
  Read the intent, then confirm the interpretation in the reply.
- He likes parallel subagents and speed. That has a real cost: two defects this
  session came from concurrent edits (a CSS token deleted as "unused" while
  another agent was starting to use it; a page pushed before its imports were
  committed, which broke the live site for minutes). **When agents run in
  parallel, give them disjoint file sets and verify the whole tree afterwards.**

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

## Where things stand

Everything Tim has asked for is built and live:

| Page | What it does |
|---|---|
| `index.html` | Season dashboard — this week's matchups with projections, roster strength, standings, injured starters, bench points |
| `stats.html` | The rebuild of his 2025 spreadsheet, plus schedule luck (average projected opponent), which needs no games played |
| `analysis.html` | All ten teams' lineups at once; a per-team drill-down; and "Season by week" — a whole squad against every week |
| `schedule.html` | Standings, matchups, results, fixture/head-to-head grid, per-matchup win %, a season forecast per team, and a Monte Carlo season simulation |
| `waivers.html` | "Add players" — the wire priced by week, with your own worst man at each position dropped into the same list |
| `draft.html` | Draft assistant + practice mode. **Parked** — do not add to it unless he asks |
| `debug.html` | Raw ESPN probes. Not in the nav |

Shared modules worth knowing before touching anything:
`js/espn.js` (transport + decoding), `js/season.js` (fetching, one request per
week), `js/projection.js` (rosters → per-week team points; **shared by two
pages, do not grow a second copy**), `js/forecast.js` (win probability, optimal
lineup, win-total distribution, season simulation — pure and node-testable),
`js/prefs.js`, `js/connection.js`, `js/charts.js`, `js/sortable.js`.

## Tests

`cd tests && npm install && npm test` — around 900 assertions. They are in the
repo now; earlier sessions kept them in a temp directory and lost them each
time. **Run them before and after any change**, and see `tests/README.md` for
the two linkedom gotchas that otherwise waste an hour.

The one that catches most: `test-pages-render.mjs` boots every page's real HTML
with its real modules, so a missing element id or a typo in a selector fails
there instead of in Tim's browser.

## What is genuinely open

- **Nothing has been checked against his real league in a browser.** All of it
  is verified against demo data, stubs and public leagues. That is the first
  thing to do: open each page on 476225250 and fix what the real payload
  breaks. Two specifics to watch — whether `% own` populates from the roster
  view, and whether any week's projection drops implausibly far (which would
  mean bye handling is over-firing).
- **Playoff odds.** The simulation reports who finishes first in the
  regular-season standings and says plainly that this is not a championship.
  Real title odds need his bracket rules — size, seeding, byes — and he has not
  given them.
- **Trade interaction**, the feature he named first and has not yet specified.
  The all-teams grid on `analysis.html` is the natural surface: it already
  computes each team's lineup and baseline by position. Build the analysis with
  a send-it-yourself button; do not auto-send.
- **Writes to ESPN** (set lineup, add/drop, propose trade) are a later phase he
  has asked about. They must go behind a popup confirmation or a popup-issued
  nonce, **never the open page bridge** — any page on the origin could otherwise
  drop players. See "The bridge & writes" in `PROGRESS.md`.
- The drafter's `TUNING` numbers are placeholders standing in for answers he has
  not given, and the score-differential curve has a rationale he has promised
  and not yet explained. Reproduce it; do not simplify it.
