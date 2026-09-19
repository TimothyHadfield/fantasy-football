# Read this first

Live: https://timothyhadfield.github.io/fantasy-football/
Repo: https://github.com/TimothyHadfield/fantasy-football

Last updated 2026-09-19. Everything below is pushed and live; 35 test suites,
11,598 assertions, green, and GitHub Actions runs them on every push.

This is the orientation. **`PROGRESS.md` is the detailed reference** — every
rule below is expanded there, along with the history of how the numbers were
reverse-engineered from Tim's spreadsheet. `docs/espn-draft-api.md` is the
field-level ESPN reference. `DRAFT-STRATEGY.md` covers the parked drafter.
`tests/README.md` says how to run the test suites.
[`docs/strategy-research.md`](docs/strategy-research.md) is the mid-season
STRATEGY file: Tim's own twelve ideas with a verdict and the published evidence
for each, the numbers a feature could use, and a ranked list of features that
would follow from it. Read it before proposing any new analysis feature.

---

## Say this to him first, in any session before the season ends

**CORRECTED 2026-09-18: THE CAPTURE IS WORKING. Weeks 1 and 2 are both
recorded** (~31KB), which Tim confirmed off the Time machine panel. This file
said for two sessions running that the archive was empty and week 1 lost for
good. It was not. The reading takes itself when he opens any page on the
machine with the extension, exactly as designed. **The lesson is worth
keeping: the only place that answer lives is his browser, this repo cannot see
it, and nobody had asked him.**

**What is outstanding is the EXPORT.** Those two weeks live only in that
browser and clearing site data would delete them. He was asked on 2026-09-18 to
press **Export archive** on
[the Time machine panel](https://timothyhadfield.github.io/fantasy-football/schedule.html#timePanel);
the file lands in `C:\Users\timha\Downloads\fantasy-archive-*.json` and *you*
commit it to `data/snapshots/<league>-<season>.json`. **Check that folder
yourself at the start of every session** — he may have exported and not said.
An export is cumulative, so it is a monthly job at most.

The standing rule is unchanged and still true:

**Every week that passes without a capture is a week that can never be
recovered.**

The schedule page's time machine records what the forecast said, once a week,
so it can be looked back on in December. ESPN keeps **no history of its own
projections**, so this cannot be backfilled by any means — see rule 8 below.
**Since 2026-09-17 a reading is taken when Tim opens ANY page of the site on
his computer** in the Edge profile that has the bridge extension — the
connection bar calls `captureIfDue()` in `js/capture.js`, which builds the
exact reading the schedule page would. The panel says in one line whether this
week was recorded and, if not, why; the bar shows a red "Week N NOT recorded"
chip when an attempt failed. **Readings are never taken from the synced
(cloud) copy** — Claude's call on 2026-09-17, matching the original design;
Tim was told and may overrule it. A week he never opens the site on his
computer is simply gone.

`data/snapshots/` in the repo is still empty, and that is the EXPORT half
above, not the capture half. **Checked again 2026-09-19: still nothing in the
repo and no `fantasy-archive-*.json` in his Downloads**, so the export has not
happened yet. Two things to ask, in this order:

1. **"Has the Time machine panel recorded this week?"** It had weeks 1 and 2 as
   of 2026-09-18. A later week missing is the one thing worth interrupting
   anything else for.
2. **"Have you pressed Export archive?"** Then commit the file out of his
   Downloads. Check that folder yourself before asking.

**Why it had looked empty, now answered.** Two theories were on file: the
extension race (every page's first ESPN read went direct and a private league
refused it — fixed 2026-09-16 with `bridge.settled()`), and his reading the
site mostly on the phone, where no extension can exist and so no reading can
be taken. Readings did start appearing, so the race fix is the likely cause
and both theories can be retired. **The phone limit is still real and still
matters**: a reading needs live ESPN data, which needs the extension, which no
phone browser can install. A week he only ever opens on the phone takes no
reading.

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

   **Except a D/ST** (verified 2026-09-17, league 1241838): ESPN projects a
   defence at 3–7 points in its team's *future* bye week (Lions D/ST 4.41 in
   week 6) and sends *no* projection (`null`) for a past one. OUT/IR players
   are also 0.00 in ordinary weeks, so a 0 alone does not mean a bye. So the
   site does not trust ESPN's bye-week number: `fetchWeekRosters` (rosters)
   and `parseFreeAgent` (wire) force any player's projection to exactly 0 in
   his team's known bye week (`espn.byeAdjustedProjection`,
   `fetchByeWeeks()`); with byes unknown (demo, failed read) projections stay
   as sent. A `null` in a known bye week renders "Bye" (`zeroKind`).

   **CORRECTED 2026-09-16: the horizon is NOT week 13.** This file said "through
   week 13" as a verified fact from 2026-09-09, and it is wrong — that was the
   furthest week anyone happened to ask for. Re-probing public league 1241838
   for 2026, every one of its 174 rostered players carries a
   `statSourceId 1 / statSplitTypeId 1` projection in **weeks 13, 14, 15, 16,
   17 and 18**, with plausible values throughout (week 17 tops at 24.4, median
   10.3) and exactly one 0.00 per week, which is the bye behaving as described (D/STs excepted — see below).

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

13. **No slot is assessed below what the waiver wire would give you there**
   (Tim, 2026-09-18). A bye's 0.00 is a fact about a PLAYER; every page was
   using it as a fact about a TEAM, and no manager fields an empty kicker slot.
   `js/floor.js` holds the rule; `season.fetchFloors(week)` is the one read.

   **The floor is the THIRD-best free agent, not the best** (Tim, 2026-09-19:
   "there might be 5-6 users also wanting the player at the top of the
   waivers"). `FLOOR_RANK = 3`. It measures what you would END UP WITH, not
   what is on the wire — the top man goes to whoever has the waiver priority. A
   thinner wire falls back to the deepest man it holds and says so;
   `floorSource(f)` is the one spelling of where a floor came from.
   **It never invents a number** — no floor without a real wire read, and
   without floors every page is byte-for-byte what it was. **It never changes
   who starts** — applied when a lineup is assessed, never when it is chosen.
   An assumed number is orange with a dotted underline and says where it came
   from. If either of those two guarantees is ever relaxed, the site starts
   telling him to start different players because of a waiver-wire number.

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
  analysis grids and the Trade page use it. **"Season by week" deliberately
  does NOT**, since 2026-09-18 — Tim asked for it off that panel, where the
  highlight already reads a man across the weeks, so the line above the table
  carries his name, season projection and average instead. That is one panel
  opting out, not the card being retired. It draws three rows — the
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
  `touch-check.mjs` is what keeps the two modes agreeing. **Taking a card away
  does not relax this**: when Season by week lost its card, the tap there had
  to be intercepted rather than left to follow the link, or the name and the
  two numbers would have become hover-only — so that line carries an "Open
  player" link to give back the action the tap preempted.
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
- **The project exists: `fantasy-football-th`** (owner timhadfield7@gmail.com,
  Firestore in `nam5`), created 2026-09-16 by Claude through the signed-in
  `firebase` CLI, and its config is in `js/cloud.js`. **Setup is complete as of
  2026-09-16**: Google sign-in enabled (Tim, in the console — the CLI cannot,
  it needs the OAuth client only the console creates), `timothyhadfield.github.io`
  authorised, and the rules published with his uid `rYpbExZGM0fCeuuYakAxR6OzG452`,
  which is also `ownerUid`. The rules live in `firebase/firestore.rules`;
  publish with `firebase deploy --only firestore:rules` from `firebase/`. The
  CLI's own login can reach the admin APIs the CLI lacks commands for
  (authorised domains, enabling APIs) — see how it was done in git history.
  **Unconfirmed: the first successful Send to phone and the phone read.**

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
| `stats.html` | The rebuild of his 2025 spreadsheet, plus schedule luck (average projected opponent), which needs no games played. Close luck, luck score, S+L, LS and PS show **from week 1 with a ±** (one standard error; wide early, narrowing weekly) — Tim's ask, replacing a week-3 hold-back |
| `analysis.html` | All ten squads in **one grid**, with the week picker and an `A week / Proj avg <season>` switch inside the panel (pref `analysis.measure`). **The two measures are now different tables** (Tim, 2026-09-19): `A week` is nine player spots, a total and the bench, with a card (hover, or tap on a phone) carrying each man's whole season as a three-row chart; **`Proj avg` is one column per LINEUP SLOT averaged over the season — the Avg column of "Season by week" computed for all ten squads**, so the two boxes cannot disagree. It names nobody, links nowhere (a slot's season is usually several men; the `title` says who filled it and how often), has no bench, and its Total is the week-by-week lineup averaged — the same figure the sheet's "Starting lineup" band shows. The roster detail's `Proj avg` tile is that same number. **"Season by week" has its own team picker** at the top of the panel, which is a second view of the page's one team setting, not a second setting — weeks, projection, and actual for weeks already played and bench ranks (`12.3 RB4`); a per-team drill-down whose lineup you can **swap around** to see what it would score; **"Season by week"** — since 2026-09-17 a LINEUP SHEET, not a roster list: one row per slot (QB, RB1, RB2, WR1…, FLEX, D/ST, K), each week showing that week's best legal lineup ranked inside its slot, a "Starting lineup" totals band, hover/tap/focus lighting every week he holds and naming him on the line above the table — **with his season projection and what he is actually averaging, and NO card** since 2026-09-18 (Tim: the 14-week preview was answering a question the panel already answers) — low numbers marked amber ▼ (1 SD) / red ▼▼ (2 SD) against the LEAGUE's distribution for that slot, thresholds printed, and **numbers lifted by the waiver floor drawn in orange with a dotted underline** (see rule 13); and **"Who to start, week by week"** — one position at a time, the whole season across, every week that man makes the best legal lineup shaded (an `F` when he only gets in through the flex), so a starter's byes and soft weeks and whoever covers them are one glance apart |
| `schedule.html` | **Ordered by usefulness (Tim, 2026-09-17): My season, Simulate season, Week matchups (the week picker lives inside that panel, with the week's headline numbers and its cards), then Data source, Time machine, Results, Head to head. THERE IS NO STANDINGS PANEL** — his direction that the site adds to ESPN rather than rebuilding a league table ESPN already shows; the two things it carried that ESPN does not publish, his place now and his run-in rank, are figures inside My season. `capture.standingsKey` is untouched and still seeds the bracket. Matchups, results, fixture/head-to-head grid, per-matchup win %, a season forecast per team, a Monte Carlo season simulation **including the playoff bracket** — where a team finishes is the bracket for places 1–6 and the regular-season table below that, which is how this league ranks people — and a **time machine** — a reading of the whole page is saved automatically once a week, picking one replays the season as it looked then, and the archive committed under `data/snapshots/` restores itself into any browser |
| `waivers.html` | **"Players"** — the wire priced by week, your own worst man at each position in the same list, every week that beats him shaded; then **"Taken players"**, everyone rostered, uncoloured, with owner and squad rank. Each table has its own position filter (incl. FLEX); the week span is shared |
| `trade.html` | The **finder**, then **Best combo**, then the **depth map** (Tim's order, 2026-09-17), then **Custom trades** (2026-09-18) — build any deal between any two squads and keep it; only the players are saved, never the price, so every row is re-priced on each render: every 1-for-1, 2-for-1 and 1-for-2 where **both** lineups improve, priced by the lineup each squad would field EACH REMAINING WEEK. Click an offer for a week-by-week pop-up; **Best combo** is the set of deals he can make at once (a player cannot be traded twice), merged per manager; **Open in ESPN** deep-links the trade with both sides ticked. **Every figure is per week first, the rest-of-season total as the small sub-number** (Tim's display rule). The pop-up fetches its own weeks on the click and shows played weeks above a heavy line, in white, in no total. After an ESPN click a line at the foot of the page says what became of your side (extension absent / too old / refused / handed over) |
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
Trade page — **not** by Season by week, which dropped it on 2026-09-18),
`js/floor.js` (the positional floor — pure; `season.fetchFloors(week)` is the
one read that feeds it; every function in it is a no-op when no floors are
passed, which is what keeps demo and a failed wire read honest),
`js/cloud.js` (Firestore sync so the phone can read the league the
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

`cd tests && npm install && npm test` — **35 suites, 11,598 assertions**,
counted off a green run on 2026-09-19.
`node tests/text-audit.mjs` is not a suite: it counts visible prose per panel.
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
- `test-bridge-settle.mjs` is small and guards the costliest bug of
  2026-09-16: a page's first ESPN read racing the extension's hello, going
  direct, and being refused — which made the Trade page price played weeks.
- `an-test.mjs` and `fc-test.mjs` are the two big end-to-end ones (567 and 707
  assertions). They re-derive their expected answers independently rather than
  reading the page's own arithmetic back to it — `an-test` rebuilds every week's
  lineup from `demo-rosters.js` to check the who-to-start marks, and `fc-test`
  replays a **doctored** archive whose numbers the live page could not produce,
  so "the time machine works" is falsifiable rather than a page agreeing with
  itself.

## What is genuinely open

**2026-09-18 — four things landed, all pushed and live.** Read these first;
they change numbers he checks by hand.

**1. THE POSITIONAL FLOOR, and it moves every projection on the site.** His
ask, in his words: "if you are determining your total proj for week 14, but
your K has a BYE that week and you don't have a backup, don't assess that K
position to be 0 pts, assess it to be the max number of points that is
available on the waivers for that position." The rule lives in `js/floor.js`,
pure and node-tested, and it is applied everywhere a position is assessed —
Analysis, Trade, Stats (schedule luck), Schedule and Summary.

Two decisions in it are HIS, chosen from options put to him:

- **One wire read, used flat for every week.** A read per week is exact but
  doubles the request count on Analysis and Trade (rest-of-season trade: ~12
  requests → ~24). One read costs a single request per page load.
- **It lifts anything below it, not only the zeros.** A kicker projecting 4.1
  when the wire holds a 7.8 was never worth 4.1.

Three rules inside it that must not be quietly undone:

- **It never invents a floor.** No table of "a kicker is worth 7". Every number
  is a real free agent in a real wire read; with no read there are NO floors
  and every page shows exactly what it showed before. That is why demo, stubs
  and archived readings are untouched, and why 35 suites stayed green.
- **It never changes who starts.** Applied when a lineup is ASSESSED, never
  when it is chosen. Folding it into the selection flattens real differences (a
  FLEX choice between a 5 and a 4 is a tie once both are lifted to 8) and would
  change which men the site tells him to start. `test-floor.mjs` asserts the
  lineup is identical either way.
- **A slot's floor is not a position's.** A FLEX takes the best of RB/WR/TE.

On Analysis → Season by week an assumed number is **orange with a dotted
underline** (`--assumed` in css/app.css, `td.assumed`), never colour alone: the
cell names the free agent it came from, the legend carries the mark, and the
note prints every floor so a cell can be checked by hand. A floored bye shows
the number rather than the word "Bye" — the whole change is that it stopped
being zero.

**Still unproven on his real league**, like everything else here: what the
floors actually come out at for league 476225250. If a number looks wrong to
him, the floor is the first thing to check — it is new and it moves totals.

**2. Custom trades** (`trade.html`, last panel). Build any deal between any two
squads, price it, keep it. Both sides are pickers, not just the partner — "this
can be for any player with any team" — so a deal between two OTHER managers
prices correctly, which the finder cannot do at all. Only identities are saved,
never a price; every saved trade is re-priced from current data on each render,
and one whose player has changed squads says so. A saved row opens the finder's
own pop-up. **It went last on the page so his 2026-09-17 panel order is
untouched — offer to move it under the finder.**

**3. Season by week: no player card.** His ask — "we don't need to be providing
the 14 week preview when you hover over it as well. Just put the name of that
player somewhere outside of the chart, and their season proj, and current avg.
That's it." The line above the table carries exactly those three. A tap is now
intercepted on that panel (letting it navigate would make the numbers
hover-only), so the line carries an "Open player" link instead. **The two grids
at the top of the page still open the card** — the change is one panel only.

**4. Panels pair up where they fit.** His ask: "leave it as is for now, but
anywhere we can condense horizontally and fit 2 boxes, we should. This might
mean there is a mix between full-width boxes and half-width boxes." `.grid-2`
became `.panel-row`; measured 21,798px → 20,810px at 1500px, most of it the
Stats page's charts going two to a line. **Only ADJACENT panels are ever
wrapped**, so his panel order is untouched — `tests/stats-order.mjs` and the
fc/tr/an order assertions still pin it.

Two bug fixes from the density audit landed with it, both measured in headless
Edge rather than asserted:

- `.panel-row > * { min-width: 0 }`. `index.html` really did scroll sideways on
  a 390px phone (571px of content, the Injury report's table). **It no longer
  does, on any page at any width tested** — that closes the standing "does
  anything scroll sideways on his iPhone" question for the pages, though he
  should still confirm on the real device.
- "How this works" was 19px tall on 27 panels. It gets the 44px floor **under
  `hover: none` only** — keyed off the pointer, never the width — so a mouse
  keeps the tight row. Verified under touch emulation: 19px → 44px.

**DIVISIONS ARE NO LONGER AN OPEN QUESTION.** ESPN publishes the count and
`espn.parsePlayoffs` had decoded it all along — nothing read it.
`capture.divisionCount` / `hasDivisions` do now, and the simulation panel says
out loud that its seeding ignores divisions when the league really has more
than one. It answers itself on his next live load. (He had already given the
BRACKET — 6 teams, 1–2 on a bye, 4v5 and 3v6, no reseeding — and that was
recorded and implemented all along as `bracketSeeds(6)`; divisions is a
different fact about SEEDING, and he never mentioned it.)

**There is now a way to measure the real layout.** Headless Edge over CDP, with
`Emulation.setDeviceMetricsOverride` rather than `--window-size` — which is
what confounded the earlier 390px audit, since headless Edge will not make a
window narrower than about 500px and reported every page as overflowing. Two
things it taught, both worth keeping:

- **These pages settle asynchronously.** A fixed wait caught schedule.html
  mid-render and reported it 600px shorter than it settles at, which read as a
  dramatic saving that was not there. Poll until the height stops moving.
- **A grid gap and a panel's own bottom margin add up.** Pairing panels cost
  +101px on a phone until the row took ownership of the spacing.

The script is not in the repo (it was a scratchpad tool). Worth rebuilding if
the density pass goes further.

**Earlier passes, still not seen by him:** everything under 2026-09-17 in
PROGRESS.md — the cloud going live, the real-league audit's six fixes, Season
by week becoming a lineup sheet, the trade pop-up's per-week breakdown, panel
order, playoff weeks in every week preview.

### Open questions for Tim (asked, not answered)

1. **The density pass, part two.** He said "leave it as is for now" on
   vertical density and asked only for horizontal pairing, which is done. The
   rest of his original 25–40% would have to come from content: eight charts at
   300px, eighteen control rows, and seven Data-source panels (~1,300px on a
   laptop) that mostly restate the connection bar above them. **Should the Data
   source panel fold into the connection bar?** That is the single biggest
   saving left and he has not answered it.
2. **Where should Custom trades sit?** It is last so his panel order was not
   disturbed. Under the finder is the natural home if he wants it there.
3. **"Avg" and byes.** Players/Analysis count a bye as 0; the Trade page skips
   it, so one player shows two averages. Pick one, or label each page. (The
   floor changes what a bye is worth but not this inconsistency.)
4. **Should trades be PRICED on the playoff weeks?** They are shown after the
   line but left out of every total.
5. Smaller, all previously flagged: readings from the synced copy (currently
   never taken); whether 3rd-vs-4th follows seed or the consolation ladder;
   whether the joke team names appear anywhere; whether the combo packer may
   propose two deals to one manager; whether he minds that HANDOFF/PROGRESS are
   publicly readable on Pages (emails, league id, Firebase uid — the rules
   still protect the data).

### Things he was asked to check in a browser and has not reported back on

- **Export archive**, and the file appearing in his Downloads (above).
- **Send to phone** succeeding, and the phone reading the synced league after
  signing in there.
- Google sign-in **inside** the iOS home-screen app (unverified anywhere), and
  whether the app now stays an app across pages after re-adding the icon.
- Whether **Open in ESPN** ticks his own side (extension must show **0.3.3**
  after a reload at `edge://extensions`).
- Whether anything still scrolls sideways on his iPhone. The one case we could
  measure — `index.html` at 390px — is fixed and verified.

### Next up

- **Commit the archive export** the moment it appears in his Downloads. It is
  the only thing here with a deadline.
- **December**, now the nearest real deadline after that. Home, the Players
  page and "Who to start" stop at the last regular week, so his playoff matchup
  never appears; the simulation says "nothing left to simulate" once week 14 is
  decided, exactly when title odds matter most; and a useless "week 15" reading
  gets filed that projects only week 14. The week PREVIEWS already run through
  the playoff weeks — this is the rest of it.
- **The 2027 rollover.** The season is saved per device and on the account, and
  nothing moves it forward, so in August 2027 every device would quietly still
  show 2026.
- **Almost none of this has been seen against his real league in a browser.**
  Everything is verified against demo data, stubs and public leagues. 476225250
  is private and returns 401 to anything without his cookie, so the first load
  through the bridge is where reality arrives. Specifically unproven: the
  real-names join; `% own`; every number the Trade page's weekly measure
  produces; and now **what the positional floors actually come out at**.
- **The demo has no floors**, because the demo waiver wire lives inside
  `js/waivers-page.js` rather than in a shared module. So the orange assumed
  numbers cannot be seen without a live connection. Moving that pool into its
  own module would fix it and is a contained job.
- **A way to measure the layout exists but is not in the repo.** Headless Edge
  over CDP with `Emulation.setDeviceMetricsOverride` (NOT `--window-size`,
  which will not go below ~500px and is what made the first 390px audit report
  every page as overflowing). It turns "this should be narrower" into a number
  and it caught a regression during the pairing work. Worth rebuilding if the
  density pass goes further; see PROGRESS.md, "How the layout was measured".
- The rest of the older list — the trade tick-your-side never having run in a
  real browser, writes to ESPN being deliberately unbuilt, the FLEX-empty
  table, the parked drafter — is unchanged and expanded in PROGRESS.md.

---

## If you are a fresh session, do this first

1. **Check `data/snapshots/` and `C:\Users\timha\Downloads\fantasy-archive-*.json`**,
   then ask him about the export. It is the only thing here with a deadline,
   and the answer is not in this repo.
2. **`cd tests && npm install && npm test`** before you change anything, so you
   know whether a failure afterwards is yours. 35 suites, about 6-8 minutes.
3. **Read "What is genuinely open" above.** Four things landed on 2026-09-18
   that change numbers he checks by hand, and the positional floor is the one
   most likely to be behind "that number looks wrong".
