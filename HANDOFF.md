# Read this first

Live: https://timothyhadfield.github.io/fantasy-football/
Repo: https://github.com/TimothyHadfield/fantasy-football

Last updated 2026-09-16.

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

**Checked again 2026-09-16 and still empty**: `data/snapshots/` holds nothing
but its README and there is no `fantasy-archive-*.json` in his Downloads. That
is a week of the season gone with no reading taken, and none of it can be
recovered. **Check both places yourself at the start of every session** and
raise it before anything else he asked for. Two things to ask, in this order:

1. **"Has the Time machine panel recorded this week?"** If not, that is the one
   thing worth interrupting anything else for.
2. **"Does the panel say any week is un-backed-up?"** If it is red, ask him to
   press **Export archive** — the file lands in his Downloads and *you* commit
   it to `data/snapshots/<league>-<season>.json`. Check
   `C:\Users\timha\Downloads\fantasy-archive-*.json` yourself before asking; he
   may have exported already and not said.

**A second candidate, found 2026-09-16:** every page raced the extension's
hello, so a page's FIRST ESPN read went direct and a private league refused
it — the schedule page's included. Fixed (`bridge.settled()`); if readings
start appearing after that deploy, this was the cause. See PROGRESS.md, "a race
with the extension".

**He reads the site on his phone, and that is the other likely reason.** A
snapshot is only captured when `schedule.html` loads on LIVE data; live data
needs the bridge extension; **no phone browser can install one**. So if he is
only opening the site on the phone, the archive stays empty however good the
phone layout gets.

**The cloud sync does NOT fix this, and do not let anyone think it does.** It
makes the archive *readable* on his phone; it cannot make a reading be *taken*
there, because a reading needs the live ESPN data only the desktop can fetch.
The weekly desktop visit is now the entire remaining purpose of the desktop,
which makes it easier to forget, not harder. Say that to him plainly — it is not
obvious, and it is the one thing on this project with a deadline.

An export is **cumulative** — one file holds every week — so it is a monthly
job at most. Do not tell him to export weekly; he asked, and it is not true.

---

## What this is

A static site (GitHub Pages, vanilla ES modules, no build step, no framework)
for Tim's 10-team ESPN fantasy football league. **Tim specifies what it does;
Claude builds it.** It is 2026 season, week 2-3.

**His league's settings, pasted from ESPN 2026-09-16** — these were unknown for
a long time and several features were blocked on them:

| | |
|---|---|
| Regular season | **14** matchups, 1 week each, starting NFL week 1 |
| Matchup tie breaker | **None** — a tie stands |
| Playoff teams | **6** (so seeds 1–2 get a first-round bye) |
| Playoff rounds | 1 week each: round 1, round 2, championship |
| Seeding tie breaker | Total points for |
| Reseeding | **Off** — the bracket is fixed |
| Home field advantage | None |
| Consolation ladder | Yes — and deliberately NOT modelled |

So the playoffs are NFL weeks **15, 16, 17**, which is past the week-13 horizon
in rule 2 below. **The title is winning the championship round. The "loser" is
last in the REGULAR-season standings**, not the consolation ladder — Tim's rule,
in his words. Note he said "4 players make the playoffs" in prose while his
settings say 6; the settings were taken as authoritative.

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
5. **Make a fix falsifiable before believing it.** Revert it, watch the new test
   fail, restore it. That is how the depth-chart keying and the playoff field
   size were confirmed rather than assumed — both looked right on inspection and
   both had tests that would have passed either way until this was done.
6. **Re-probe a "verified" fact when something depends on it.** "ESPN projects
   through week 13" sat in this file as verified for a week; it was simply the
   furthest week anyone had asked for. It was load-bearing for the playoffs and
   it was wrong.

## The rules that must not be re-litigated

These were each established by testing, and several by getting them wrong first.

1. **ESPN publishes projections, never odds.** Every percentage on the site is
   our model, and the pages say so in those words. Do not relabel any of it as
   ESPN's number.
2. **ESPN DOES publish a per-week projection for every future week**, for
   rostered players and free agents alike. A player on bye comes back at
   **0.00** — a different fact from `null` (ESPN had nothing), and the pages
   draw and sort them differently.

   **CORRECTED 2026-09-16: the horizon is NOT week 13.** This file said "through
   week 13" as a verified fact from 2026-09-09, and it is wrong — that was the
   furthest week anyone happened to ask for. Re-probing public league 1241838
   for 2026, every one of its 174 rostered players carries a
   `statSourceId 1 / statSplitTypeId 1` projection in **weeks 13, 14, 15, 16,
   17 and 18**, with plausible values throughout (week 17 tops at 24.4, median
   10.3) and exactly one 0.00 per week, which is the bye behaving as described.

   This matters because his playoffs are NFL weeks 15–17. They can be forecast
   on ESPN's own numbers like any other week — no modelling from a team's
   scoring distribution, and no caveat on the page. **Do not reintroduce a
   13-week ceiling.** The `DEMO_WEEKS = 13` constants are a different thing and
   are correct: the demo season really is thirteen weeks.
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
8. **ESPN keeps no history of its own projections.** It publishes every future
   week's; it cannot tell you what it thought last month. Anything the
   site wants to compare across time must be captured while it is on screen —
   that is why `js/snapshots.js` exists, and why nothing about it can be
   "reconstructed later instead".
9. **A squad is identified by its team id, never by its label.** Since squads
   are labelled with the PERSON holding them, two can render the same string —
   two owners sharing a display name, or two that do not resolve. Anything that
   groups by the displayed name merges them silently and computes one answer
   over two rosters. The Taken table did exactly that.
10. **A trade is priced by the lineup you would field EACH WEEK**, not by one
   season-average lineup. Tim's own example is the proof: three QBs projecting
   15–19 give you an 18–19 starter most weeks, so a fourth good QB adds almost
   nothing — which the average cannot see. Positional depth needs no separate
   rule; it falls out of taking the per-week maximum. `js/trade.js` keeps the
   scalar measures as options and the weekly gains are **rest-of-season
   totals, ~9x a per-week number** — any page showing them must say which
   scale, or be wrong by a factor of nine and look fine. **Tim's display rule
   (2026-09-16): per week first, the total as the small sub-number** — the
   Trade page's gains, lineups, combo headline and the pop-up's summary rows
   all follow it (`weeklyGainHtml` / `weeklyPhrase` in `js/trade-page.js`).
   The engine and the sort keys stay totals; only the printing divides.
11. **A combo's gain is not the sum of its trades' gains.** Each offer was
   priced against the current roster, so two deals upgrading the same slot
   overlap. Price the combined move once. `naiveDelta` is kept to show how far
   the addition would have been out.
12. **The archive's durable home is the repo, not the browser.** Tim exports one
   JSON file; it is committed under `data/snapshots/<league>-<season>.json`;
   the page pulls it back on every live load. An export is **cumulative** —
   one file holds every week — so this is a monthly job, not a weekly one, and
   the panel names in red any week that is still only in his browser. **What
   is weekly is him opening the schedule page on live data**: that is when a
   reading is taken, and a week he never visits cannot be recovered later.
   **Ask him for a fresh export when the panel says one is outstanding.**

   Firebase was once considered for this and set aside; it is now BUILT, but
   for a different job — reading the league on his phone, not storing the
   archive. The committed JSON file is still the archive's durable home, and
   the cloud sync does not change that. See "The cloud, and the phone".

## How a panel reads (2026-09-16, Tim: "messy and wordy")

Every panel is: title → one short `.lede` sentence → the control toolbar → the
table/chart → a small visible key or status line → `<details class="explain">`
("How this works") holding the full method. The styles are in `css/app.css`.
**Put new explanation behind the toggle, not under the table** — the site went
from ~5,700 words of visible prose to ~1,050 in that pass, and
`node tests/text-audit.mjs` measures it per panel. Warnings, errors, demo
notices and anything that changes what a number means stay visible.

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
- **The player card is `js/player-card.js`, and there is one of it.** The
  analysis grids and the Trade page both use it. It draws three rows — the
  weeks, the projection, and the ACTUAL for weeks already played — and it
  **does not scroll at any length**: the run wraps onto balanced lines instead
  (13 weeks at 390px become 7 + 6). A scrollbar reintroduced anywhere inside it
  is a regression `touch-check.mjs` exists to catch. Do not put a `title` back
  on those cells: the browser would draw a second tooltip over the card. The
  link carries `aria-label` for the same reason.
- **The Act row reads the DATA, never the calendar.** A week with no actual
  recorded is blank whatever the date says. This matters because the demo
  season hardcodes every game as played, so a card filling the row from the
  week number looks perfectly correct in demo and is wrong everywhere else.
  A played zero is `0.0` and is never drawn as one of the four no-number states.
- **Nothing may be reachable only by hovering.** Tim reads the site on his
  phone. Where a hover reveals something, a tap has to reveal the same thing —
  the analysis grids' card opens as a sheet on a coarse pointer, and
  `touch-check.mjs` is what keeps the two modes agreeing.
- **A `title` is invisible on iOS, and `js/touch-titles.js` is the answer.**
  Every page loads it with one script tag; on a coarse pointer a tap on
  anything carrying a `title` opens the words as a sheet. So `title` is still
  the right place to put a column definition or a cell's explanation — but
  **never on a link or a button**, which the module deliberately leaves alone
  because a tap on a control has to work the control. A control that needs a
  sentence gets a `.ctl-hint` on the page (the FLEX filters, the simulation's
  run count), not a `title` nobody on a phone can read.
- **Two media features, and they are different facts.** `max-width: 760px` is
  "the screen is narrow"; `hover: none` is "there is no pointer". An iPad in
  landscape is the second without the first and a narrowed desktop window is the
  first without the second, so a capability must never be keyed off the width.

## The phone layout

Added 2026-09-15, on Tim's ask. The whole of it is in the "phone" section at the
foot of `css/app.css` plus one `@media (max-width: 760px)` block in each page's
own `<style>` — a page's inline styles come AFTER the linked stylesheet, so a
fixed width defined page-locally can only be overridden page-locally.

- **The wide tables are unchanged, deliberately.** Ten teams by twenty columns
  cannot be made phone-shaped, and stacking them into cards would destroy the
  one thing they are for: reading a column down the league. `.table-scroll`
  already scrolls sideways with the team frozen down the left, and that IS the
  phone answer. What changed is everything around it.
- **`overscroll-behavior-x: contain` on `.table-scroll`**, so a sideways flick
  inside a table scrolls the table instead of triggering Safari's swipe-back.
  Only the X axis: vertical overscroll still has to chain to the page, or a
  thumb gets stuck inside a table it has already read to the end of.
- **`dvh`, not `vh`, for the table cap.** On iOS `vh` is measured against the
  viewport with the address bar collapsed, so `70vh` is most of the screen while
  the bar is still showing. The `vh` line stays first as the fallback.
- **16px on every form control.** Not taste: iOS zooms the whole page in when a
  field under 16px takes focus, and leaves it zoomed.
- **`.segmented` becomes a grid on a phone**, 1px gaps over a `--line`
  background so the gaps are the dividers. The eight-button position filters do
  not fit on one line and the control is built as a single track with borders
  between the buttons, so simply letting it wrap put hairlines in the wrong
  places.
- **Row hover is behind `hover: hover`.** iOS resolves `:hover` on tap and
  leaves it painted, so the last row touched stayed lit as though selected,
  competing with `tr.me` and `tr.picked`, which mean something.
- **A cap on a table cell is three declarations or none.** `td.name` gets
  `max-width` AND `overflow: hidden` AND `text-overflow: ellipsis`. The table is
  `white-space: nowrap`, so a `max-width` alone caps the box and lets the text
  run out of it — and that column is sticky with an opaque background, so the
  overflow paints on top of the numbers scrolling underneath.
- **The connection bar works with no extension, and that was a real bug.** It
  used to render a sentence and NO input whenever the bridge was absent, and
  `connect()` went only through `bridge.probe()` — so with no extension there
  was no way to connect to anything. `js/espn.js` has always fallen back to a
  plain fetch for data reads and a public league needs no cookies, so the
  transport was ready and the bar in front of it was not: **a public league was
  unreachable from any browser without the extension**, desktop included.
  Nobody noticed because the only league anyone connects to here is private and
  always had the extension. `directProbe()` fixes it; the bridge is still
  preferred when present, being the only one of the two that reads a private
  league. It also says something different on a phone, because "install the
  extension" is advice nobody there can take.
- **A private league cannot be read DIRECTLY from a phone**, and that is
  settled — same third-party-cookie wall as ever, and no phone browser can load
  the extension that gets around it. There are exactly two ways round it and Tim
  has chosen the second:
  1. Mark the league viewable to the public in ESPN's settings (LM Tools →
     League Settings → Basic Settings). Free, instant, live, works for everyone's
     phone — at the cost of anyone with the league ID being able to look.
     `espn.js`'s `AuthError` spells it out and the connection bar shows it.
     **He has not done this and it remains his call.**
  2. **The cloud sync, which is what he picked.** The desktop that has the
     extension publishes his league to Firestore; the phone reads it. Private,
     but only as fresh as his last desktop visit. See "The cloud" below.

## The cloud, and the phone

Built 2026-09-16 on Tim's own proposal, which was sound: *"the information ... is
updated every time they log onto their computer (which has the extension), and
then ... when the user uses the site on their iphone, it will connect to the
information on firebase."*

- **The substitution lives in `js/season.js`, inside every fetcher**, so **no
  page module knows the cloud exists** — the same constraint that kept the
  real-names work clean. Order of preference is **bridge → cloud → direct
  ESPN**, identical there and in the connection bar, because the two must agree
  or the bar labels the wrong thing. With the bridge present the cloud is not
  merely unpreferred, it is **not asked**.
- **Sizes: 53 KB a week, not a megabyte.** The megabyte figure elsewhere in
  `PROGRESS.md` is ESPN's RAW payload; the decoded shapes the pages render from
  are far smaller, so the whole season is ~815 KB over 28 documents — four
  orders of magnitude inside Firestore's free tier, and no sharding.
- **Staleness is tracked per shape and never flattened.** A week-old wire is
  actively wrong — its whole question is "who can I add" and it would list men
  claimed on Tuesday — while week-old rosters answer a season-shape question
  almost as well as live ones. "Never synced" counts as stale so nothing can
  read as fresh by accident.
- **Syncing fires at most once every six hours**, and that number is pinned to
  the thing that decays rather than picked: the wire goes stale after a day.
- **It is switched off until Tim does the console setup.** `docs/firebase-setup.md`
  is click-by-click, ~15 minutes, **two sittings** — his user id does not exist
  until he has signed in once. Unconfigured is the normal case and every failure
  is silent; the site behaves exactly as it did before.

## Trades, and what the site will and will not do to ESPN

- **A trade is priced by the lineup each squad would field EACH REMAINING
  WEEK.** See rule 10. Already-played weeks are excluded entirely — banked
  points are banked and no trade can move them.
- **Per-week averages skip byes but NOT nulls**, and the asymmetry is
  deliberate: ESPN's 0.00 for a bye is a week he does not play, while a `null`
  is ESPN being quiet, and promoting one into the other would flatter every
  thinly-covered player. A consequence worth remembering: `perWeek × weeks` no
  longer equals the rest-of-season total, and every note showing both says so.
- **ESPN's trade URL can only ever tick the OTHER side.** Verified against their
  shipped bundle: `players=` is matched against the counterparty's roster alone,
  there is no parameter for your own, and swapping `teamId`/`fromTeamId` fails
  because ESPN overrides it to a team you own and then refuses. The decisive
  evidence is their own **Decline & Counter** button, which ships a trade link
  with **no players on it at all**.
- **So the extension ticks his side, on the page.** The site stages a note, a
  content script reads it and ticks, he clicks ESPN's own Propose button.
  **This is not a write.** `host_permissions` still holds only the read host and
  the suite asserts it; the content script is forbidden from touching Propose,
  Cancel or the confirmation modal. A checkbox is a TOGGLE and their side is
  already ticked, so it reads state before clicking — blind clicking would untick
  them and propose a smaller trade than intended.
- **Nothing on this site sends anything to ESPN.** The single write is always
  his own click, inside ESPN.

## Where things stand

Everything Tim has asked for is built and live:

| Page | What it does |
|---|---|
| `index.html` | Season dashboard — this week's matchups with projections, roster strength, standings, injured starters, bench points |
| `stats.html` | The rebuild of his 2025 spreadsheet, plus schedule luck (average projected opponent), which needs no games played |
| `analysis.html` | All ten squads **twice over** — nine spots, a total and the bench, once on the season average and once on the selected week, with a card (hover, or tap on a phone) carrying each man's whole season as a three-row chart — weeks, projection, and actual for weeks already played and bench ranks (`12.3 RB4`); a per-team drill-down whose lineup you can **swap around** to see what it would score; "Season by week"; and **"Who to start, week by week"** — one position at a time, the whole season across, every week that man makes the best legal lineup shaded (an `F` when he only gets in through the flex), so a starter's byes and soft weeks and whoever covers them are one glance apart |
| `schedule.html` | Standings, matchups, results, fixture/head-to-head grid, per-matchup win %, a season forecast per team, a Monte Carlo season simulation **including the playoff bracket** — where a team finishes is the bracket for places 1–6 and the regular-season table below that, which is how this league ranks people — and a **time machine** — a reading of the whole page is saved automatically once a week, picking one replays the season as it looked then, and the archive committed under `data/snapshots/` restores itself into any browser |
| `waivers.html` | **"Players"** — the wire priced by week, your own worst man at each position in the same list, every week that beats him shaded; then **"Taken players"**, everyone rostered, uncoloured, with owner and squad rank. Each table has its own position filter (incl. FLEX); the week span is shared |
| `trade.html` | **Depth map**, then the **finder**: every 1-for-1, 2-for-1 and 1-for-2 where **both** lineups improve, priced by the lineup each squad would field EACH REMAINING WEEK. Click an offer for a week-by-week pop-up; **Best combo** is the set of deals he can make at once (a player cannot be traded twice), merged per manager; **Open in ESPN** deep-links the trade with both sides ticked |
| `summary.html` | The weekly chart for his group chat — member, season LUCK, title %, loser %, at 100,000 runs — rendered to an image and handed to the phone's share sheet |
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
`js/prefs.js`, `js/connection.js` (also exports `coarsePointer()`, the one
canonical "is this a finger" test), `js/charts.js`, `js/sortable.js`,
`js/touch-titles.js` (self-installing; makes every `title` on the page tappable),
`js/player-card.js` (the one player card, shared by the analysis grids and the
Trade page), `js/cloud.js` (Firestore sync so the phone can read the league the
desktop fetched — transport is injectable, which is what makes it testable).

**Real names come out of `js/espn.js` and nowhere else.** `members[].firstName`
/`.lastName` joined to `teams[].owners[]` by SWID, and **only under
`view=mTeam`** — `members` arrives on other requests with the name fields
silently missing, and `view=mMembers` is a decoy that returns no names AND
strips the owner arrays. Resolution lives in one place so no page module knows
about it; `teamName` rides alongside for anywhere the joke name is still wanted.

**Four features now share `optimalLineup`** — the schedule forecast (regular
season AND the playoff bracket), the trade finder, "Who to start", and the
per-week trade valuation. That is deliberate: it is the reason they cannot
disagree about who a squad ought to be starting. Do not give any of them a copy.

**`js/forecast.js` is the most shared file in the repo.** `optimalLineup`,
`slotsFromCounts` and `winProbability` are imported by `js/trade.js` and
`js/analysis-page.js` as well as the schedule page. Changing one of those
signatures breaks three features at once, and only the full suite will tell you.

## Tests

`cd tests && npm install && npm test` — 25 suites, over 8,900 assertions.
They are in the repo now; earlier sessions kept them in a temp directory and
lost them each time. **Run them before and after any change**, and see
`tests/README.md` for the two linkedom gotchas that otherwise waste an hour.

Five worth knowing by name:

- `test-pages-render.mjs` boots every page's real HTML with its real modules, so
  a missing element id or a typo in a selector fails there instead of in Tim's
  browser. Cheapest high-value suite there is.
- `link-check.mjs` tests the **seam between pages** — one page makes a player
  link, another resolves it. Every per-page suite was green while a quarter of
  the analysis page's links landed on "he may have been dropped".
- `touch-check.mjs` boots the analysis page with `matchMedia` answering
  `(hover: none)` and asserts the tap-opened card — that the tap does not follow
  the link, that the sheet's link is the SAME href the cell carried, and that
  the same click with a mouse is left completely alone. It found a real defect
  the day it was written: a tap on a man with no playerId opened his card AND
  drilled into a team nobody picked.
- `test-trade-weekly.mjs` is the biggest single suite (4,009). Its hand fixture
  is Tim's own complaint made falsifiable: three QBs rotating 18/15/15, each
  averaging exactly 16, against one steady 17. The season average prices them
  48 against 51 and calls the single good QB better; week by week they are 54
  against 51. If anyone reverts the weekly measure, that disagreement vanishes
  and the suite fails.
- `an-test.mjs` and `fc-test.mjs` are the two big end-to-end ones (565 and 707
  assertions). They re-derive their expected answers independently rather than
  reading the page's own arithmetic back to it — `an-test` rebuilds every week's
  lineup from `demo-rosters.js` to check the who-to-start marks, and `fc-test`
  replays a **doctored** archive whose numbers the live page could not produce,
  so "the time machine works" is falsifiable rather than a page agreeing with
  itself.

## What is genuinely open

Ordered by what would hurt most to get wrong.

- **THE ARCHIVE IS STILL EMPTY AND WEEKS ARE GONE.** See the block at the top of
  this file, and check `data/snapshots/` and his Downloads yourself before
  anything else. The likeliest reason is now known and is worth saying to him:
  a reading is only taken when `schedule.html` loads on LIVE data, live data
  needs the bridge extension, and **the extension cannot exist on his phone** —
  so if he has moved to reading the site there, no reading will ever be taken.
  Firebase sync makes the archive *readable* on the phone; it cannot make one
  be *taken* there.
- **Almost none of this has been seen against his real league in a browser.**
  Everything is verified against demo data, stubs and public leagues.
  476225250 is private and returns 401 to anything without his cookie, so the
  first load through the bridge is where reality arrives. Specifically unproven
  there: the real-names join; the playoff field size read from his settings;
  whether `% own` populates; and every number the Trade page's weekly measure
  produces.
- **The extension is unpacked, so a change to `extension/` reaches Tim only
  after he reloads it** at `edge://extensions` (and the version shown there
  should match `manifest.json`, 0.3.2 as of 2026-09-16). The Trade page now
  says so itself after an Open in ESPN click when the running version is older
  than `MIN_TICK_VERSION` in `js/trade-page.js` — raise that with any extension
  change the page depends on. Bump the version with
  every extension change so he can tell.
- **The trade tick-your-side has never run in a real browser.** ESPN's markup
  and the React click path were read out of their shipped bundle and the suite
  proves the logic, but linkedom cannot prove ESPN's own store updates. The
  first real test is him opening a link. It fails loudly if it fails — the badge
  says "ESPN did not record the selection for: …" rather than proposing less
  than he intended.
- **Firebase is built and wired but not switched on.** `docs/firebase-setup.md`
  is click-by-click; it needs ~15 minutes of console work only he can do, in
  **two sittings**, because his own user id does not exist until he has signed
  in once. Until he does it, `cloud.js` is unconfigured and every page behaves
  exactly as it did before.
- **Three decisions of his that are open**, all flagged to him and none urgent:
  whether his league really has 6 playoff teams (his prose said 4; his pasted
  settings said 6; the page now reads it from ESPN, so live data settles it);
  whether 3rd-vs-4th should keep being split by seed or should follow the
  consolation ladder; and whether the joke team names should appear anywhere
  now that squads are labelled with people.
- **Writes to ESPN are still not built, and the deep link is why.** He chose
  deep-linking over auto-send deliberately. If it ever comes back: there is **no
  dry run** (`VALIDATE` is not an accepted `executionType`), a two-team test
  league violates ESPN's Fair Play policy whose stated remedy is a ban, and a
  flagged account mid-season would cost him the league and this tool at once,
  because the bridge reads through his cookie. The staged-trade flow is not a
  write and does not change any of that.
- **Trade ideas he deliberately did not pick**, from a list of five on
  2026-09-09: a deal's effect in **expected wins** rather than points, and an
  **auto-written pitch message**. (The third, a week-by-week strip, now exists
  as the per-offer pop-up.) Ask before adding them.
- **A FLEX-empty table is untested.** Every fixture pool contains running backs,
  so the filter always matches somebody. The same empty-state wording is proven
  through the reachable "no defence" case.
- The drafter's `TUNING` numbers are placeholders standing in for answers he has
  not given, and the score-differential curve has a rationale he has promised
  and not yet explained. Reproduce it; do not simplify it.
