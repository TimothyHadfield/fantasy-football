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

## Where to find things in here

This file is long and organised by topic, not by importance. The sections that
describe how the site works **today**:

| Looking for | Section |
|---|---|
| The two all-teams grids, DEF/K, the real Total, the bench columns | "The two all-teams grids" |
| The player card — the week run as a chart, the Act row, and why it never scrolls | "The player card is `js/player-card.js`, and there is one of it" |
| `12.3 RB4` on a bench cell | "Bench cells carry a positional rank" |
| Swapping a lineup in the roster detail | "The roster detail is a lineup you can move" |
| The wire's two greens | "`STARTABLE`…" and "The second green on the wire" |
| "Your QB3" rows | "&quot;Your QB3&quot; comparison rows" |
| The Taken players table, owners, ranks | "The taken table, and why a week now costs two requests" |
| Per-table position filters, the shared span | "A position filter PER TABLE, and one span for both" |
| FLEX | "FLEX is a FILTER, not a seventh position" |
| Clicking a player anywhere on the site | "The player click-through" |
| Why the taken table spans every week shown | "The taken table's membership is the UNION" |
| Sorting, and why several `<tbody>`s | "Table sorting" |
| Seeing the forecast as it was in an earlier week | "The time machine" |
| Which weeks a bench man actually starts | "Who to start, week by week" |
| The depth map, and what "replacement" means | "The Trade page" |
| Why a trade can make BOTH squads better | "The Trade page" |
| Why a trade is priced week by week and not on an average | "Per-week trade valuation" |
| The weekly measure's button, the per-offer pop-up, best combo | "The Trade page as it stands" |
| Opening ESPN's trade screen with BOTH sides ticked | "Ticking your own side of a trade" |
| Title %, the bracket, and where a team actually finishes | "The playoffs, and the hybrid final placing" |
| Why squads are labelled with people | "Real names, and the two traps in getting them" |
| Reading the real league on a phone | "The cloud sync" |
| The chart for the group chat | "The weekly summary page" |
| Why a fixture that matches the bug cannot see the bug | "The week-13 cap that outlived the rule" |
| What to do next | "Next", at the foot |

## What changed on 2026-09-09 and 2026-09-10

Seven sessions ran across those two days and the site changed a great deal.
Everything below is the record of what was built and — more usefully — of what
was tried, found to be wrong, and must not be tried again.

**Sessions five to seven (9th–10th)** added the Trade page, "Who to start, week
by week", and the time machine with its committed archive. Each has its own
section below. Three things they produced that outlive them:

- **A test that rebuilds the answer beats a test that reads it back.** Both new
  suites re-derive what the page should show from the source data rather than
  from the page's own arithmetic, and both caught real defects that way — the
  who-to-start union bug and the stale rows behind a hidden table.
- **A blanket assertion hides which fact it is asserting.** `fc-test`'s "no
  network calls" broke the moment an unrelated control arrived and told nobody
  anything about network calls; it is now a named exception. The same happened
  to "only one team picker on the page", which counted every `<select>`.
- **Adding a page to `link-check.mjs` re-samples the click-through** and found a
  defect that had been there all along. Any new page that names a player goes
  into `SOURCES`, and it is worth doing for the resampling alone.

**The fourth session** rebuilt the all-teams view into two grids, added the
roster-detail swap, renamed the waiver page to "Players" and gave it a taken
table, per-table filters and FLEX, and built the player click-through across
every page. It also produced the one lesson worth carrying: **a feature split
across two agents' file sets needs a test that spans them**, because every
per-page suite was green while a quarter of the click-through was landing on a
wrong answer. `link-check.mjs` is that test.

**A large usability pass landed 2026-09-09 (second session that day).** The
site was built and verified against a COMPLETE 2025 season and had never been
looked at with a nearly-empty one. Almost everything below in "Current state"
still holds; what changed:

- **`index.html` is now a season dashboard**, not a connect form. The old raw
  data probes moved to **`debug.html`** (not in the nav; linked from the
  bottom of the home page). The dashboard is built on `fetchSchedule` +
  `fetchWeekRosters` and deliberately NOT on `fetchSeasonData`, which returns
  nothing until games are played.
- **`analysis.html` shows all ten teams' starting lineups at once**, which was
  Tim's headline ask. His sheet semantics are implemented exactly (see "What the
  sheet's columns mean"): flex is computed by position, never from ESPN's
  lineup slot, because ESPN's `OP` slot can hold a QB. *(It was seven columns
  plus `Baseline week` and `Est Total` when this was written; later the same day
  it became the two grids described under "The two all-teams grids" below —
  nine spots, a real total, and the bench. Read that section, not this line.)*
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
  future week**, and a player on his bye comes back at **0.00**. So byes need
  no separate lookup and no filtering — they are already in the number. (An
  earlier pass assumed distant weeks were unavailable and used
  `seasonProjected / 17`; Tim corrected it — he reads exactly these numbers off
  the ESPN site by paging a lineup forward. Do not reintroduce the average.)

  **"through week 13" was WRONG and is corrected 2026-09-16.** That phrase sat
  here as a verified fact for a week; it was never verified, it was simply the
  furthest week anybody had asked for. Re-probing the same public league for
  2026, all 174 rostered players carry a projection in weeks **13, 14, 15, 16,
  17 and 18** — plausible values throughout (week 17 tops at 24.4, median 10.3)
  and exactly one 0.00 a week, the bye behaving as described.

  This was load-bearing: Tim's regular season is **14** matchups and his
  playoffs are NFL weeks **15–17**, so under the old claim there would have been
  no real numbers for a single playoff game and the bracket would have had to be
  modelled from each team's scoring distribution and caveated on the page. It
  does not. **Do not reintroduce a 13-week ceiling** — the `DEMO_WEEKS = 13`
  constants are a different thing and are right, because the demo season really
  is thirteen weeks. The lesson worth keeping: *the furthest thing anyone tried*
  is not the same fact as *the limit*, and writing it down as "verified" made it
  cost a week before anyone re-asked.

  **The code kept enforcing it for four commits after the rule was corrected**,
  which is the part worth remembering. Correcting a rule in a document does not
  correct the constant somebody wrote on its authority: `js/trade-page.js` and
  `js/season.js` both carried `PROJECTED_THROUGH = 13`, and one of them was
  behaviour rather than a comment. Both were fixed the same day the doc pass
  found them — see "The week-13 cap that outlived the rule" below — and both now
  take their bound from the schedule, which is the honest one: ESPN's matchup
  feed ends with the regular season, so its week list IS the list of weeks there
  are.

  **Nothing in this file repeats the old claim** — checked line by line on
  2026-09-16; the other mentions of week 13 here are about the demo season, or
  are examples in the time machine's prose.
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
buttons (you cannot add a player you hold).

**The taken table, and why a week now costs two requests unconditionally.**
`waivers.html` is "Players" now, and the second panel is everyone who IS on a
roster, priced over the same weeks, with the manager holding him and where he
ranks on that manager's squad. It answers a different question from the wire —
not "who can I add" but "who has what" — so it is a second table rather than
more rows in the first.

- **It carries NO colour at all.** Both greens above argue for a claim, and
  nobody on this list can be claimed, so colouring them would answer a question
  that does not arise. `taken-check.mjs` asserts zero `hot` and zero `beats`
  cells *while* 20+ of those numbers clear the STARTABLE bar, so the check is
  not vacuous, and that the wire above is still green.
- **The rank is ours, not ESPN's depth chart**: QB3 is that manager's
  third-best QB by the Avg this page computes over the weeks currently shown.
  So it moves with the span, exactly as widening it can change which of your men
  appears as "Your QB3". Same `meanOf` as the wire, shared verbatim — a
  comparison between two differently-derived averages is not a comparison.
- **The owner is who holds him in the EARLIEST week shown**, because that is the
  squad as it stands now. His week numbers still come from each week's own
  payload, so nothing is borrowed across weeks.
- **The roster read is now unconditional** — the old `comparing()` gate is gone,
  because this table needs every squad whether or not one of them is yours. So
  **every week costs two requests for everybody**, and `renderCost()` says so:
  "the wire and every squad in the league for each one". Understating that by
  half would be the one kind of dishonesty this page exists to avoid. Three
  assertions in `cmp-check.mjs` encoded the old conditional behaviour and were
  updated to the new truth.
- **An unranked man is the awkward case and has a documented answer.** A player
  ESPN carried no number for over these weeks cannot be ranked, so he shows the
  bare position. His Pos cell still keys as `POS_ORDER * 100 + 99` — nulls-last
  applied INSIDE the position group, which is the only place it can go, since
  his position is known and only his rank is not. **Do not "fix" this by
  dropping the `data-v`**: that was tried, and `sortable.js` falls back to the
  cell text, so a bare "TE" compares as the string `"te"` against numbers and
  *leads* the column descending. His Avg, which really is absent, still carries
  no `data-v` at all.
- **Every player row carries `data-player`**, and the wire and taken rows carry
  `id="p{playerId}"`. Comparison rows get the data attribute but no `id` — they
  are a second appearance of a man who already has a row in the taken table, and
  duplicate element ids are not a document.

**A position filter PER TABLE, and one span for both.** Tim asked to sort the
two tables independently; sorting already was (each table has its own state and
its own sticky header), so what he was actually reaching for was the controls —
the taken panel had none of its own, so narrowing it meant scrolling up past a
hundred free agents to a control in the other panel, which then dragged the wire
along with it. Now:

- **Position is per table**, with counts that are each table's own (how many the
  league is holding vs how many you could add). Filtering is a repaint, never a
  request, so there is no reason to share one.
- **The span is ONE setting shown at both ends of the page.** It is the request
  budget and both tables are priced over the same weeks, so two independent
  spans would be two costs to spend and could disagree about which columns
  exist. `setCost()` writes the same line under both copies.

**FLEX is a FILTER, not a seventh position.** Both position controls carry a
FLEX button (after TE, before K — where a flex sits in a lineup) that shows
every RB, WR and TE at once. The whole of its correctness is that nothing
downstream knows it exists:

- `FLEX` is deliberately **not in `POSITIONS` and never in `POS_ORDER`**.
  `matches()` reads the player's real position and writes nothing back.
- **A man keeps his own position and his own rank.** `RB2` stays `RB2` under
  FLEX; there is no such thing as a `FLEX2`, because the rank answers how deep
  a manager is at a position and the button only decides which rows you see.
- **`STARTABLE` is untouched.** A receiver over 12 is green under FLEX exactly
  as he is under WR. There is no flex bar — what makes a week worth starting
  does not depend on which button you pressed to find it.
- `countsOf()` counts FLEX **explicitly**. A `FLEX` key seeded to zero and left
  to the `counts[p.position]++` loop would have sat at zero for ever and
  reported "no flex-eligible players" with total confidence.
- `FILTER_CHOICE()` sanitises both persisted filters, so a saved value that is
  no longer valid falls back to `ALL` rather than wedging a table on a filter
  with no lit button.
- The strips read **`Available RB/WR/TE`** / **`Taken RB/WR/TE`**, not
  "Available FLEX", which would only quote the button back.

**The player click-through (`waivers.html?player=<espnPlayerId>`).** Every page
that names a player links to his row here, by one contract:

    <a class="pref" href="waivers.html?player=<espnPlayerId>">…</a>

- **A real `href`, never a click handler**, so middle-click and open-in-new-tab
  work. On the Players page itself the plain left click is intercepted and
  answered without a reload — everything needed is already cached — while every
  modified click is left to the browser.
- Landing **widens the span to the rest of the season** (that is what "his next
  13 weeks" means — the span decides how many columns exist), **puts the table
  he is in on his position**, and marks and scrolls to his row. A strip says who
  and offers a Clear.
- **The span is not persisted by a jump.** Answering a link is not a change of
  mind about the setting; a reload gives back the span actually chosen.
- An id nobody holds says so rather than failing silently.
- `playerId` is ESPN's own and nothing else identifies a player. Never a name,
  never a row index — a grid cell is a bare number, so a link wired to the wrong
  row would look perfectly fine on the page.

**The taken table's membership is the UNION over every week on screen**, and
this was a real bug found by `link-check.mjs` rather than by review. It used to
be the earliest week alone, which is right about the OWNER and wrong about who
belongs in the table: the columns span weeks 4–6, so a man rostered in week 5 is
part of what the table is about. It also broke the click-through — the analysis
page can be pointed at any week, and **45 of the demo's 160 men differ between
week 4 and week 13**, so a quarter of its links arrived here about a man the
table had never heard of and were told he "may have been dropped". A confident,
wrong answer. The owner is still the earliest week he actually appears in.

**The player card is `js/player-card.js`, and there is one of it.** Week
numbers along the top, that man's projection for each one directly underneath,
what he ACTUALLY scored under that, and the identity line above the lot.

*(This section used to be headed "the analysis grids' hover is a two-row
chart". Both halves of that are now wrong: the card is three rows, and it is
not the analysis grids' — the Trade page draws the same one. The corrections
are below, and they are separate pieces of work.)*

It was lines of text in a native `title` first — the right first answer, and
Tim read it and said it was hard to scan. He is right, and **the fix could not
be a better string**: a native tooltip renders in the OS UI font, where a space
is narrower than a digit and "Bye" is nothing like either, so no amount of
padding lines thirteen columns up. Rows of one table do it exactly.

**It moved out of `js/analysis-page.js` into `js/player-card.js`** when the
Trade page wanted the same card. That is not tidying: a second way of drawing a
player is how two drift apart, and the Trade page names players in four panels.
The module's own header comment is the API — `weekRun`, `registerRun`,
`tipAttr`, `wireTips`, `hideTip`, `clickIsPlayer` — and a page that wants the
card also needs the `.tipcard` / `.tc-*` CSS block. `coarsePointer()` is
imported here from `js/connection.js`; `analysis-page.js` no longer imports it,
because neither of the two things that turned on it lives there any more.

**There is an Act row, and it reads the DATA, never the calendar.** Actual
points sit under the projection, filled for weeks already played and blank for
weeks still to come. Deciding that from the week number would have looked
perfectly correct in demo and been wrong everywhere else — `js/demo-rosters.js`
hardcodes every game as played — so the rule is "is there an actual recorded",
and `touch-check.mjs`'s fourth scenario blanks the actuals while leaving the
schedule claiming all thirteen weeks were played, which is the only fixture
that can tell the two rules apart. **A played zero is `0.0`** and is never
drawn as one of the four no-number states.

**IT NO LONGER SCROLLS, AT ANY LENGTH.** `overflow-x` is gone and the run
**wraps onto balanced lines** instead — thirteen weeks at 390px become 7 + 6,
each line carrying its own Week / Proj / Act labels. Shrinking the columns was
the alternative and was rejected on arithmetic: 390px leaves about 300px inside
the padding, so thirteen columns is 23px each and "18.2" does not fit at any
readable size. **Wrapping gets no worse as the season grows; shrinking gets
worse every week.** A scrollbar reintroduced anywhere inside this card is a
regression, and `touch-check.mjs` is what catches it.

What a card of our own costs, and how each part is paid — do not undo any of
these without replacing them:

- **Clipping.** The analysis grids live in `.table-scroll` (`overflow:auto`),
  so a card inside one would be cut off at its edge. It is a child of `<body>`,
  positioned `fixed`. That is also why the Trade page's pop-up deliberately
  does not claim `aria-modal`: the card is outside the dialog, and claiming
  modality would hide it from a screen reader.
- **Flicker.** `pointer-events:none`, so the card can never be the thing the
  mouse is over and cannot chase itself around the screen.
- **Two tooltips.** The cells carry **no `title` at all** — one beside the card
  would have the browser draw its own on top a moment later. The link carries
  `aria-label` instead: same words, nothing drawn. `link-check.mjs` accepts
  either attribute for "the link says where it goes".
- **Keyboard**: shown on `focusin` too. **Escape** closes it.
- The data is registered in a `Map` keyed by **a bare counter**, not the
  playerId — it was the playerId first, and that quietly cost the hover to every
  man ESPN gave no id for. The card does not depend on the link and must not
  start to. Thirteen weeks written into 170 cells in each of two grids would be
  tens of kilobytes of duplicated attribute.

On the analysis page it is still no request: it is `state.seasonWeeks` read a
second way. The four no-number states are told apart by word AND by class —
`Bye`, `—`, `off`, `·` — with a legend line only for the ones that actually
occur, and demo never claims a bye. **A `0.00` is a bye only when the numbers
came from ESPN**; demo passes `demo: true` and a zero there is a man ruled out,
which is a real zero. `projToken(v, demo)` is where that distinction lives, and
the Trade page's `zeroIsBye()` is the second place the same fact is needed —
the same rule read twice, not decided twice.

**Bench cells carry a positional rank: `12.3 RB4`.** Tim's ask. Counted over the
WHOLE squad, starters included, because that is what the number means to a
manager — a bench back sitting behind three better ones is his RB4 whether or
not the other three start this week. Ranked by the grid's own measure, so the
number agrees with the column it is printed in and a man can be his team's RB2
for a typical week and their RB4 in a week two of them are on bye. Only men with
a number are ranked, which keeps the ranks contiguous — the same rule the Taken
table uses on the Players page, deliberately, so the two agree.

**The second green on the wire (`td.beats`).** A wire cell is also shaded when
that player out-projects your own worst man at his position **in that week
specifically** — the number on the `Your RB5` row, same column. That is the
question a claim actually asks, and Tim asked for it in those words. Two rules,
two cues, deliberately not two shades of one colour:

| Cue | Class | Means |
|---|---|---|
| Green text, bold | `hot` | over the `STARTABLE` bar — worth starting at all |
| Green shading | `beats` | ahead of the man this claim would drop, that week |

A cell can carry both, neither, or one. **Do not merge them into one class**:
they answer different questions, and the split is also what keeps them apart
for anyone who cannot separate green from grey. Strictly ahead — level does not
count — and a bye is never shaded, because 0.00 beats nobody. The comparison
map is built from the UNFILTERED `buildMineRows`, so the shading means the same
thing whichever position button is pressed. `tests/hot-check.mjs` re-derives
both rules from the rendered DOM and asserts that shaded ≠ all comparable
cells, so a rule that lit up the whole table would fail rather than pass.

**The two all-teams grids (`analysis.html`).** The same table twice over, one
row per team: nine lineup spots, what those nine total, then the bench. The
only difference between them is the measure — a typical week in the first
(ESPN's season projection ÷ 17), the week selected at the top of the page in
the second — so `renderGrid` builds both from one `GRIDS` entry each and the
comparison is reading straight down the page. Tim's spec, 2026-09-09, and every
part of it was a deliberate replacement of something:

| Was | Is | Why |
|---|---|---|
| "All teams · week 1" | "All teams · proj avg 2026" | the numbers were never that week's; the heading said they were |
| Name + number per cell | number only | a name is the widest thing that could be in the cell and the least useful for comparing two teams. Names are on hover and in full below |
| No D/ST, no K | `DEF` and `K` columns | they were a flat 16-point allowance; now they are two more real men |
| `Baseline week` + `Est Total` | `Total` | nine actual men added up, not seven plus an estimate |
| — | `B1…Bn` | the bench, best first. As many columns as the DEEPEST bench in the league, so every row is the same shape |
| `Wk proj` + `Wk actual` columns | the second grid | two columns could not carry a week; a whole table can |

Two rules inside it that are easy to get wrong:
- **A bench column cannot be headed by a position** — every team's bench is a
  different shape — so the position rides in the cell (`12.3 RB`). The nine
  lineup columns deliberately do NOT repeat it: their header already says it.
- **Only a WEEK's zero is a bye.** `byeAtZero` is a property of the grid, not
  of the value: a season average of 0.00 is a man ESPN projects nothing for all
  year, which is a different fact, and demo means something else again (a
  player it has ruled out). The season grid never prints "Bye".

The week grid **re-picks the lineup on that week's numbers**, so a squad's FLEX
can be a different man than in the average grid — that is the point of having
both, and the note says so. A man on bye sorts to the bottom of his position
and lands in the FLEX, which reads correctly.

**`analysis.html` has a "Season by week" grid**: a whole squad down the left,
every week across the right. It reuses the page's existing team picker rather
than adding a second one, and switching team costs **no** requests, because
every team is in every week's payload. **Deliberately uncoloured** — Tim's
call, and the note says why: everyone there is already rostered, so the waiver
bars would light up nearly every cell and mean nothing. If colour ever comes to
it, it needs a different scheme.

**The roster detail is a lineup you can move (`analysis.html`).** The table is
split in three `<tbody>`s — starters, a band, the bench — and the band carries
the starters' projected total, in the Projected column it is the total of.
Clicking a slot tag picks that player up; clicking another's swaps the two and
the total moves, with the difference from ESPN's own lineup beside it.

- **It is a what-if and nothing else.** No write ever leaves this page. The
  overrides live in `state.lineup` (only the slots that DIFFER from ESPN's, so
  `size > 0` IS "edited" and swapping a man back removes him rather than
  recording a change that is not one) and `lineupKeyNow()` throws them away the
  moment the team, week or league changes. Writes are a later phase and go
  behind the popup — see "The bridge & writes".
- **Eligibility is ESPN's own `SLOT_ELIGIBILITY`.** Both directions must hold:
  each man legal where the other stands. Bench-for-bench is refused (it changes
  nothing) and **IR is not a lineup choice** — that tag stays a label. Illegal
  targets are disabled in the markup AND refused by `applySwap`, which does not
  trust the markup it just wrote.
- **`sortable.js` now sorts every `<tbody>`, each independently.** That is what
  makes the grouping survive a sort: sort by Projected and you get the starters
  ranked and then the bench ranked, rather than the two shuffled together and
  the total stranded among them. A body of one row is left alone, which pins
  the band. Every other table on the site has exactly one body, so nothing else
  changed.
- **`rosterView(team)` is the one lineup**, shared by the roster detail and the
  season grid, so the two panels can never disagree about who is starting. The
  glance stats are totalled from it rather than taken from ESPN's team totals,
  so they move with a swap — and with nothing swapped they use season.js's own
  rule and come out identical to the decimal. **`Proj avg` deliberately does
  NOT move**: it is the best nine by season average — the same figure the first
  grid gives that team — and it never depended on how the lineup was set. The
  note says so when a swap is live. (It was `Baseline week` + `Est Total` until
  the grids were rebuilt; same reasoning, one number instead of two.)

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
- **"Wins the season" meant finishing first in the regular-season standings**
  when this was written, because no bracket was modelled and Tim had not given
  his league's rules. **CORRECTED 2026-09-16: he gave them, and the bracket is
  simulated.** Topping the table is now `tableWinner` and the **title** is
  winning the championship round — two different facts, both shown. A final
  placing is the bracket for places 1..field and the regular-season table below
  it. See "The playoffs, and the hybrid final placing"; everything else in this
  bullet list still holds.
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


## The phone (2026-09-15)

Tim's ask, in his words: the site "is really not formatted or designed for the
iPhone", fix it so it works great there, and "make sure it has all the same
capabilities with connection and everything". Read that last clause as two
different problems, because it is:

**1. Layout.** The site had ONE media query in its shared stylesheet. The
seven-link nav ran off the header, the eight-button position filters overflowed
their panel, 20px gutters plus 18px panel padding spent a tenth of the screen
before a table began, and every form field was under 16px — which is not a
typographic detail on iOS, it is the rule that makes the browser zoom the whole
page in on focus and then leave it zoomed. All of it is in the "phone" section
at the foot of `css/app.css` plus one block per page.

- **The wide tables are unchanged, and that is the decision, not an omission.**
  Ten teams by twenty columns cannot be made phone-shaped; stacking them into
  cards would destroy the one thing they exist for, which is reading a column
  DOWN the league. `.table-scroll` already scrolls sideways with the team frozen
  down the left, which IS the phone answer — so the work was making everything
  around it fit and making the scroller behave under a thumb.
- **`overscroll-behavior-x: contain`**, so a sideways flick inside a table
  scrolls the table rather than triggering Safari's swipe-back. **Only the X
  axis**: vertical overscroll must still chain to the page, or a thumb gets
  stuck inside a table it has already read to the end of.
- **`dvh`, not `vh`.** On iOS `vh` is measured against the viewport with the
  address bar collapsed, so `70vh` is most of the screen while the bar is still
  showing. The `vh` line stays first, as the fallback.
- **`--pad-panel` is overridden on `:root` inside the media query**, so the
  panel padding and the table's negative-margin bleed move together. They are
  defined as exact negatives of each other and changing one alone pulls every
  table out of line with its panel edge.
- **`.segmented` becomes a grid**, 1px gaps over a `--line` background so the
  gaps ARE the dividers. The control is one track with `overflow: hidden` and
  left borders between buttons, so simply letting it wrap leaves hairlines in
  the wrong places. 72px tracks, chosen so the two eight-button position filters
  fall as a tidy 4 + 4 rather than 5 + 3, which reads as two unrelated controls.
- **Row hover is behind `@media (hover: hover)`.** iOS resolves `:hover` on tap
  and leaves it painted, so the last row touched stayed lit as though it were
  selected — competing with `tr.me` and `tr.picked`, which mean something.
- **Page-local fixed widths must be overridden page-locally.** `css/app.css` is
  linked before each page's `<style>`, so a media-query rule in the shared file
  ties on specificity with `.select-wide { width: 210px }` and loses on order.
  Every page therefore carries its own small block.
- **Two media features, kept apart.** `max-width: 760px` is "the screen is
  narrow"; `hover: none` is "there is no pointer". An iPad in landscape is the
  second without the first, a narrowed desktop window the first without the
  second. Keying a CAPABILITY off the width is the mistake this separation
  exists to prevent.

**2. Capability, which was the harder half.** The analysis grids' tip card is
the only place a player's NAME appears on those tables — every cell is a bare
number — and it was reachable by hover alone. On a phone it could not be
reached at all, and a tap on a cell simply followed the link off the page. So
the same card now opens as a SHEET on a coarse pointer, and the navigation the
tap preempted comes back as a button inside it, which is strictly more than the
hover offers. See the player card section above — it is still the "tip card" in
the markup (`.tipcard`, `data-tip`), which is why both names appear; the mode is
decided per event
rather than once at load.

- **A real defect fell out of testing it**, and it is the kind that looks fine:
  the row under a grid cell drills into that team, and it bailed out only when
  the click landed on an `<a class="pref">`. A man ESPN gives no `playerId` has
  no `<a>` in his cell at all, so a tap on him opened his card AND silently
  re-pointed the three panels below at a team nobody picked. The row handler is
  on the same element and registered first, so no amount of `stopPropagation`
  could have caught it. Both sides now ask one shared `clickIsPlayer(e)`.
- **`title` attributes draw NOTHING on iOS**, and this site puts real content in
  them: seventeen column definitions on the stats page, the three different
  reasons an analysis cell can read `—`, and the explanation of why a Players
  cell is green. `js/touch-titles.js` is the answer — one self-installing module
  loaded by a single script tag on every page, which on a coarse pointer opens
  the same words as a sheet. The attribute is untouched, so it is still the
  desktop tooltip and still what a screen reader reads.
  - **It deliberately leaves links and buttons alone.** A `title` on an
    `<a class="pref">` is the player click-through's own label and swallowing
    that tap would break the one contract holding the pages together; a tap on
    a button has to press the button. So a CONTROL whose only explanation is a
    `title` has no explanation at all on a phone — which is why the FLEX
    filters' sentence and the simulation's run count moved onto the page as a
    `.ctl-hint`. Do not put an explanation a reader needs on a button again.
  - **A table header still sorts.** The sort fires first, from the table's own
    handler; this runs afterwards on the document and adds the glossary. So
    tapping `PTW` sorts by it and says what it is, which is both things wanted.
- **The histogram bars listened for `pointermove` only.** A finger produces no
  move before it lands, so a tap did nothing and the counts behind the
  distribution chart were unreadable. The line chart already listened for
  `pointerdown` too, for exactly this reason. **The box plots had neither** —
  their five-number summaries lived only in an SVG `<title>`, so on a phone
  they were ten coloured smears against a "Points" axis. Each row now has a
  full-width invisible hit band feeding the same shared tooltip: the whole row
  and the label gutter, because a whisker is 1.5px of ink and a median a 2px
  gap, and aiming a thumb at either is not a thing that happens.
- **A league can now be connected with NO extension, and that was a real bug
  hiding behind the phone question.** The bar rendered a sentence and no input
  whenever the bridge was absent, and `connect()` went through `bridge.probe()`
  and only that. But `js/espn.js` has always fallen back to a plain fetch for
  every data read, and a public league needs no cookies at all — so the
  transport layer was ready and the bar in front of it was not. **A public
  league was unreachable from any browser without the extension, desktop
  included.** Nobody noticed because the only league anyone connects to here is
  private and always had the extension installed. `directProbe()` returns the
  same `{ ok, data }` shape `bridge.probe()` does, deliberately, so `connect()`
  has one answer to handle rather than two. The bridge is still preferred when
  present: it is the only one of the two that can read a private league.
- **The one route to live numbers on a phone is making the league public.**
  Not a new idea — `espn.js`'s `AuthError` has carried the exact ESPN setting
  all along (LM Tools → League Settings → Basic Settings → "Make League
  Viewable to Public") — but it was unreachable, because the bar had no input
  to type an ID into and no direct probe behind it. **Tim has not been asked and
  has not decided.** It is read-only visibility and nobody can join or transact,
  but anyone with the ID could look. HANDOFF used to say not to re-litigate
  "make the league public"; that was written when the extension had just solved
  the desktop and the phone was not in question. The premise changed.
- **The connection bar no longer tells a phone to install the extension.** The
  bridge is an unpacked Manifest V3 extension and neither iOS Safari nor Chrome
  on Android can load one, so the old sentence sent Tim looking for a button
  that does not exist and would have him conclude the site was broken. On a
  coarse pointer it now says the live numbers are on his computer and that
  everything else works the same. **A private league genuinely cannot be read
  from a phone** — third-party cookies again, see "Settled the hard way" below —
  and that is a browser constraint no layout fixes.
- **`coarsePointer()` is exported from `js/connection.js`** and neither of the
  two things that turn on it may grow its own copy; two copies of one question
  is how two answers start. *(It was imported by `js/analysis-page.js` when this
  was written. The card moved to `js/player-card.js` and took the import with
  it, and `analysis-page.js` carries a comment saying so rather than leaving the
  reader to wonder where it went.)*
- **A cap on a table cell is three declarations or none**, and this was caught
  in review rather than by looking at it: `td.name { max-width: 44vw }` alone
  caps the BOX and does nothing to the text, because the table is
  `white-space: nowrap` — and that column is sticky with an opaque background,
  so a long name overflows and paints on top of the numbers scrolling
  underneath. `overflow: hidden` and `text-overflow: ellipsis` go with it.
  `overflow` clips children, never the cell's own drop shadow, so the "more to
  the right" cue survives.
- **A short landscape media query needs a width clause.** The rule that raises
  the table cap on a phone turned sideways was written as
  `(max-height: 560px) and (orientation: landscape)` — which a 1600x540 DESKTOP
  window matches perfectly well, silently taking the phone's cap. And `dvh`
  always wants a `vh` line before it: here the `max-height` IS what makes the
  sticky header stick, so no cap means no sticky header.
- **`tests/touch-check.mjs`** is the suite, now 187 assertions over four
  scenarios (a coarse pointer, a mouse, a man with no id, and half a season on a
  390px screen). It asserts the sheet's link is the SAME href the cell carried —
  a second way of naming a player is exactly how the click-through's two halves
  drift apart — and that the identical click under a mouse is left completely
  alone, so the desktop path `link-check.mjs` follows is provably unchanged. The
  fourth scenario is the card's: the Act row, and that a thirteen-week run wraps
  onto balanced lines rather than scrolling.

**The one thing this does NOT fix, and it matters:** a snapshot is only captured
when `schedule.html` loads on live data, live data needs the bridge, and the
bridge cannot exist on the phone. If Tim has moved to reading the site on his
phone, that is the likeliest reason the archive is still empty — and the archive
is the only thing on this project with a deadline.

**Checked again on 2026-09-16 and still accurate**, with two things landing on
top of it. The cloud sync (below) now lets a phone read the real league, so the
"a private league cannot be read from a phone" paragraphs above are about the
DIRECT route and remain true of it — what changed is that the desktop can
publish what it read, not that the phone can read ESPN. And a snapshot is still
only *taken* on the desktop: syncing makes the archive readable on the phone
and can never make a reading be captured there, so the deadline above is
untouched. The connection bar's phone wording, the `.ctl-hint` rule, the
`hover: none` / `max-width` split and the three-declaration cell cap all still
hold as written.

## The week-13 cap that outlived the rule (2026-09-16)

Worth its own heading, because the shape of this mistake will recur.

Rule 2 in `HANDOFF.md` said ESPN published per-week projections "through week
13". It was never verified — 13 was simply the furthest week anybody had asked
for — and it was recorded as a fact. Two files then wrote
`const PROJECTED_THROUGH = 13` **citing that rule as their authority**.

When the rule was disproved (real projections run through at least week 18), the
rule was corrected and the constants were not. One of them, in
`js/trade-page.js`, had been written in a commit that landed *after* the
correction.

**It was not harmless.** Tim's regular season is FOURTEEN matchups:

- every trade he priced silently dropped week 14 — the last week of his regular
  season, and the one most likely to decide whether he is in the playoffs;
- `buildCloudPayload` refused to sync that week, so a phone reading the synced
  copy had a hole in it exactly where the season is decided.

**The suite could not have caught it, and that is the more useful half.**
`tr-stub-season.mjs` played a 13-week season, so the cap and the schedule agreed
and every assertion passed whether the page read the schedule or ignored it. The
stub plays fourteen now, the way his league does; reinstating the cap under it
fails ten assertions across the request count, the drill-down's rows and two
independently re-priced gains. Three assertions had also hardcoded 13 in their
own re-derivations and now read the season length off the fixture.

Three lessons, in order of how much they cost:

1. **A fixture that matches the bug cannot see the bug.** A thirteen-week
   fixture for a fourteen-week league is not a smaller version of reality, it is
   a version in which the defect is invisible.
2. **Correcting a document does not correct the code written on its authority.**
   Grep for the constant, not just the sentence.
3. **A doc pass reads code nobody has re-read in a while**, which is how this
   was found at all. That is an argument for doing them.

## The time machine (`js/snapshots.js`, `schedule.html`)

Built 2026-09-09, seventh session. Tim's ask: the forecast and the simulation
move as players get hurt, traded and benched, and he wants to look back at the
end of the season and see how they changed — so nothing shown before week 1, or
before any week, should be lost.

**THE CONSTRAINT THAT SHAPES EVERYTHING.** ESPN publishes a projection for
every future week and keeps **no record of what it used to project**. Ask it in
week 9 what it thought of week 13 back in week 2 and there is no endpoint, no
parameter and no archive — the number was overwritten when it changed. So this
could not be reconstructed later by any amount of cleverness: a reading not
captured while it is on screen is gone permanently. That is the entire
justification for a site that previously stored four preferences now storing
history.

**What is kept is small, and that is the design.** The obvious approach — every
week's rosters as ESPN sends them — is about a megabyte per reading and would
fill browser storage inside a month. **That megabyte is ESPN's RAW payload, and
this file used to quote it as though it were the size of the data itself.** It
is not: the DECODED shapes the pages actually render from are **53 KB a week**,
measured by `tests/test-cloud.mjs` against a realistic fixture, which is why
`js/cloud.js` needs no sharding to put a week inside Firestore's 1 MiB document
cap. The reasoning here is unchanged — it is still unnecessary to store rosters
at all — but the figure is about the wire, not about the week. The forecast and
the simulation consume
the schedule with its results-so-far, one projected total per team per remaining
week (~180 numbers), and the sigma. Everything else is derived. A reading is a
few kilobytes and a season of them is a few hundred.

- **Sigma is stored, and this is not incidental.** It is calibrated from
  results, so it moves through the season; replaying week 3 with week 12's
  spread would re-forecast the past with knowledge it did not have. Same class
  of error as showing today's projections against an old schedule, and much
  easier to miss.
- **The rosters behind the numbers are deliberately NOT kept.** An archived week
  can be re-read but not re-derived, and the panel says so. The other pages
  always show today.
- **A reading holds INPUTS, never outputs.** No simulation result is stored:
  the forecast and the season simulation are worked out again on replay from
  the stored schedule, projections and sigma. So nothing has to be run for a
  week to save — Tim asked whether he had to sit through 50,000 runs for each
  of ten teams — and nothing has to be run per team either, since one
  simulation covers the whole league and the picker only chooses whose chart
  is drawn. Because the run is seeded and deterministic, replaying reproduces
  what was on screen; replaying at a HIGHER run count gives a more precise
  answer to the same question rather than a different one, which is why the
  run count is a display setting and is deliberately not part of a reading.
- **Replaying is a SUBSTITUTION, not a second rendering path.** `hydrate()`
  returns exactly the shapes `normalizeSchedule` and `buildProjection` produce,
  they are swapped into `state.data` / `state.projection`, and the page renders
  through its ordinary path — so the whole page travels together and an archived
  week cannot drift into looking different from a live one.
- **`forecastAsOf()` reads the week off the snapshot rather than re-deriving
  it.** Deriving agrees on live data and quietly disagrees on demo, where "as
  of" follows the week picker rather than the results.
- **FIRST WRITE WINS on the automatic capture**, because the ask is for what was
  known *before* each week — a later load the same week has already watched some
  of the games it was forecasting. It waits for a real projection: a reading
  taken before ESPN's per-week numbers arrive has no forecast in it, and
  first-write-wins would then block the good one for the rest of the week.
- **Demo is never captured automatically.** It is generated rather than
  observed, every reload would race to write it, and it would fill the archive
  with weeks that never happened. The button still works there, which is how the
  feature can be tried before there is a real season to try it on.
- **Coming back from an archive is a repaint, not a reload.** The live season is
  put aside on the way in. Reloading was the first version and `fc-test` caught
  it: returning to now cost a schedule call plus one per remaining week, a dozen
  requests every time somebody flicked out of the archive, on a page whose whole
  cost model is one request per week.
- **One localStorage key per reading**, never one for the whole archive: a quota
  failure while saving week 9 must not take weeks 1–8 with it. `js/prefs.js`
  keeps its own small blob and is untouched — a few hundred kilobytes of history
  rewritten on every sort-order change would be absurd.
- **Browser storage is not durable and the panel says so in those words.**
  `exportAll` writes the season to one JSON file; import keeps a week already
  held rather than overwriting it, because the copy this browser took at the
  time is the closer reading of the two.
- **The banner is loud on purpose.** Every number below it is historical, and a
  reader who skims past and reads the forecast as current has been actively
  misled — so the page badge says "Week 5 archive" too.

**The repo IS the archive** (added the same day). `data/snapshots/<league>-<season>.json`
— exactly what the Export button writes — is fetched once on every live load and
imported. So the history restores itself: open the site in a browser that has
never seen the league and the committed readings come back before anything is
drawn.

- **No index file.** That one path either exists or it does not. An index is one
  more thing that can disagree with the directory beside it.
- **Imported, not held separately**, so the picker, replaying and exporting all
  read one source and cannot disagree about which archive is on screen. A week
  the browser already holds is kept — it was recorded there at the time.
- **Every failure is silent.** A missing file is the normal case for a league
  nobody has exported, and being offline must not stop the page loading.
- **Demo never asks.** There is nothing committed for a league that does not
  exist, and it would be a guaranteed 404 on every sample page load.
- **A person carries the file, deliberately.** A page cannot commit to a repo
  without a token, and a token in client-side JavaScript is a public token —
  anyone reading the site could write to the repo. One click every few weeks
  against a backend to run, and it buys version history for nothing.
- **The panel works out what still needs exporting**, and says so in red. An
  export is CUMULATIVE — it writes every week held, not the newest one — so
  "export weekly" was never true, and Tim asked whether it was. The weeks the
  committed file already holds are compared against the weeks in this browser;
  anything only in the browser is named. When they match it says so and asks
  for nothing. **What IS weekly is opening the page**: a reading is only taken
  when the schedule page loads on live data, and a week never visited can
  never be recovered.
- `fc-test`'s blanket "no network calls" became a NAMED exception: the archive
  path is allowed, at most once, live only, and any other call still fails.
  A blanket assertion hid which call was which.

**Firebase was considered and is not the answer here** — for Tim, not in
general. It works fine from a static site, the free tier is four orders of
magnitude larger than this needs, and the public `apiKey` is safe by design
(security is in the rules, not the key). But it front-loads about ten minutes of
console work that **only Tim can do** — creating the project, enabling Firestore
and Google sign-in, authorising the domain — and none of the Google connectors
available here can provision a Firebase or GCP project. He asked for the option
that costs him least; that is the committed file. If he ever wants zero clicks,
Firestore slots in behind `snapshots.js`'s existing `list/get/save/remove` and
is perhaps 120 lines.

**That verdict is about THIS job only, and it has not been reversed.** Firebase
was built afterwards for a different one — letting the phone read the league at
all, see "The cloud sync" below — where there is no committed-file equivalent,
because nobody is going to hand-commit thirteen weeks of rosters every Sunday.
The archive is still a file in the repo. Do not read "Firebase is wired in now"
as permission to move the archive into it.

## Who to start, week by week (`analysis.html`, foot of the page)

Built 2026-09-09, sixth session, to Tim's spec: see who to start each week of
the season to keep the lineup balanced, and know where and when the bench comes
in to cover a bye or just a soft week for a starter. One position at a time,
that squad's men at it in depth order, the same week run the season grid draws
— and every week a man is in the BEST LEGAL LINEUP marked.

**Read along a row for a starter's soft weeks; read down a column for who
covers them.** That is the whole interaction, and it is why the panel is one
position wide: the question is about one position's depth chart.

**It costs nothing.** `state.seasonWeeks` is already bought by the season grid
above — one request per week, no bulk form — and every team is in every week's
payload, so both the position buttons and the shared team picker are repaints.

- **`optimalLineup` is `js/forecast.js`'s, unchanged**, run once per week on
  that week's own projections. Three features now share it — the schedule
  page's forecast, the trade finder and this — so none of them can disagree
  about who a squad ought to be starting.
- **Byes need no handling of their own, and that IS the feature.** ESPN returns
  0.00 for a bye, the man simply loses his place to somebody better, and the
  mark moves to whoever covers. The panel shows you who.
- **A flex start is marked differently (`F`).** "He starts" and "he starts
  because the flex had nobody better" are different answers to the question the
  panel exists to ask, and the second is the one worth spotting.
- **The row set is the UNION over the weeks shown, not the selected week's
  roster** — and this was a real defect caught by the tests, not by review.
  Rosters change week to week, so a week whose lineup was filled by somebody
  since dropped had a starter with no row, and the panel then showed a week
  where apparently nobody at the position started at all. Autumn's week 7 in
  demo is exactly that: the second back is Kellan Wainwright, who is not on the
  week 4 roster the page opens on. **A mark that cannot be seen is worse than no
  mark**, because the reader counts the shaded cells and concludes a slot went
  empty. Same rule, same reason, as the Taken table's membership.
- **But a departed man earns his row by having FILLED a slot, and nothing else.**
  Left unfiltered the union ran the sample league's backs to fourteen rows, nine
  of them men Tim no longer holds and seven of those never in a lineup at all.
- **Only men on the roster in the selected week are RANKED.** A depth chart is a
  statement about the squad you have; someone dropped in week 3 is there to
  explain week 3 and is not this manager's RB2 today. He shows `—`, italic, and
  sorts last INSIDE his position group via an explicit `data-v` — drop that and
  `sortable.js` falls back to the cell text, where `—` leads the column. The
  same trap the Taken table documents.
- **A player ESPN gave no id for is left out of the table AND out of the
  lineups it marks**, because nothing ties the man in week 5 to the man in week
  6 and `seasonIndex` would collapse every one of them onto a single `undefined`
  key. The note says how many were dropped. Disclosed and slightly incomplete
  beats confident and unaccountable.
- **`seasonCell` gained an optional `start` argument rather than a cell renderer
  of its own.** The FIVE ways of having no number — not read yet, ESPN refused
  the week, not on the roster, no number at all, and a bye — cost real effort to
  tell apart and must not be reimplemented next door where the copies drift.
  The season grid above passes nothing and is unchanged.
- **FLEX is a filter here too.** Not in the position list, never a rank: a back
  is `RB2` under FLEX exactly as he is under RB, and `an-test` asserts the two
  agree name for name.
- **The roster detail's what-if swaps are deliberately NOT applied.** Those are
  one week's experiment; this is what the numbers say across the season, and
  folding an override in would make a hand-moved lineup look like advice.

## The Trade page (`trade.html`, `js/trade.js`, `js/trade-page.js`)

Built 2026-09-09, fifth session. Tim asked for research into how managers
actually decide on trades, then picked **two** of the five ideas that came back:
the depth map and the finder. The other three — showing a deal in expected
wins, a week-by-week strip, an auto-written pitch — were deliberately NOT built.
Do not add them uninvited. **(The week-by-week strip has since been asked for
and built, as the per-offer pop-up — see "The Trade page as it stands". The
other two are still unasked.)**

**Everything on this page is additive.** It is a new page with a new pure
module; no existing page, module or behaviour was changed to make room for it.
The only edits outside it were a nav link on each page, two test registries, and
one bug the new page's tests exposed (below).

**What the research said, because it shaped every decision here.** Every guide,
every analyzer and every strategy piece reduces to the same five things: the
only test is whether your STARTING lineup got better; trade your surplus for
your hole; find the partner by reading *their* lineup rather than yours; value
on rest-of-season, never last week's points; and send a sentence saying what it
fixes for them. The commercial analyzers all price a player as "projection minus
the last starter at his position" — which is replacement level under another
name — and they do it because **they cannot see your league**. We can see all
ten squads, so nothing here needs a value chart: a trade is priced by re-filling
both lineups and looking at what changed. Two managers reading the same ESPN
projections can both check it, which is a far better argument than a number off
a website.

**Why a trade can make both squads better, which is the whole premise.** A
manager's team is worth what his starting lineup scores; his bench scores
nothing. A man who cannot crack his own lineup is worth zero to him and can be
worth ten a week to someone starting a worse player at that position. That is
not a paradox, it is the normal case, and it is what the finder searches for.

**Replacement level is not a constant, and that matters.** For each position it
is **the best player at that position who is not starting anywhere in the
league** — the man any manager could have instead. It falls out of the rosters,
moves with the league, and needs no tuning number of the kind `draft-model.js`
has to carry. Two consequences worth knowing:

- **The Players page's `STARTABLE` bars are deliberately not reused.** Those are
  fixed per-position thresholds answering "is this week worth starting at all",
  which is right for a waiver claim and wrong for a trade: two managers can both
  be over that bar and still have an obvious deal between them.
- **When every player at a position is already starting, the position is
  `exhausted`** and the worst starter stands in as the bar. The startable test
  then has to go INCLUSIVE, and that was a real bug rather than a nicety: with a
  strict test the bar-setter is ruled out of being startable, so a two-team stub
  where both squads carried one identical quarterback reported BOTH of them as
  short at QB. Same fix removed a false D/ST hole in demo.

**The depth map's number is POINTS, not bodies, and it took building it to see
why.** The obvious cell is "startable players minus lineup places", and it is
useless: the bar is set at the last man starting anywhere, so by construction
the number above it is about the number of places for them, and the count is
zero for nearly every cell in a league of any balance. True, and unreadable down
a column. So the cell is how far a manager's starters at that position are above
replacement — continuous, never zero by accident, and reading down a column
ranks the league at that position, which is the only job the table has.

- **An unfilled slot counts the whole bar against him.** A manager with no
  kicker is not neutral at kicker; he is scoring nothing there.
- **`spare` beside the number** is what he could send WITHOUT weakening his own
  lineup — the part of his squad a trade can actually reach.
- **The tint is per COLUMN, top and bottom three.** An absolute threshold would
  tint whole columns, because what counts as deep at quarterback is not what
  counts as deep at kicker. Every cell prints its own sign, so **colour is never
  the only cue** — same rule as the two greens on the Players page.

**The finder is brute force on purpose.** Ten squads of sixteen is small enough
to try every swap, and an exhaustive search cannot miss the deal a heuristic
would have pruned. About 250ms, handed off through rAF then a timeout so the
"searching" state actually paints. Shapes searched: 1-for-1, 2-for-1 and 1-for-2.
2-for-2 is left out — rarely proposed, and it multiplies the search by two
orders of magnitude for offers that are a 1-for-1 with two spare men attached.

- **The forced cut is modelled.** A 2-for-1 leaves the receiving side a man over
  the limit and he HAS to drop somebody; his worst man goes. Every guide flags
  this as what makes lopsided packages worse than they look. The side left a man
  SHORT is not credited with a waiver claim to fill the gap — that player is not
  in this page's data and inventing him would flatter the trade. Those offers
  are understated rather than flattered, which is the safe direction.
- **The shape filter is a SEARCH option, not a filter over the results.** The
  finder keeps one offer per man you could acquire, so a 1-for-1 and a 2-for-1
  bringing in the same player compete for one row — and the bigger package
  usually wins it, because throwing in a spare body is free to you. Filter
  afterwards and the straight swap is already gone. `kinds` goes INTO
  `findTrades`. The manager picker is the page's one true filter, and it is safe
  because every offer belongs to exactly one partner.
- **A superset of another equally good deal is dropped.** Deliberately a SUBSET
  test and not merely a smaller-and-better one: two different trades with the
  same manager that happen to be the same size are genuine alternatives, and
  neither may silently delete the other. Before this existed the two-team stub
  returned six rows that were two deals wearing different junk.
- **"What changes" is two names, not a position delta.** Per-position deltas are
  computed and kept, but they are not what the row shows, because a deal that
  turns a receiver slot into a back — which is most of what a flex does — reads
  as "RB +13.8, WR −12.0" for a net under two points. That is a true sentence
  nobody can act on. `starts: … / drops out: …` is the same fact without the
  arithmetic, and it is what makes an offer checkable against ESPN by eye.
- **Nothing found is a real answer and gets a real sentence.** A win-win needs
  two managers weak in opposite places, and a balanced league may simply not
  have a pair — the demo league has **no** mutually-beneficial straight swap at
  all. The page says so rather than relaxing its own rule until it can print
  something.

**`lineupValue` is `forecast.js`'s `optimalLineup`, wrapped and nothing else**,
so the trade page and the season forecast can never disagree about what a squad
is worth. The slot shape is read off the lineups via `slotCountsFromLineups`,
never guessed. The default measure is the typical week (season projection ÷ 17),
which is also what sidesteps byes: pricing a trade on a week one side happens to
be off is nonsense. The selected week is offered as the second measure and says
what it is. **There is now a third — "every remaining week" — and it is the one
that answers Tim's complaint about depth. It is not the default, it costs a
request per week, and it produces season totals rather than per-week points.
Read "Per-week trade valuation" and "The Trade page as it stands" before
touching any of this.**

**A bug this work exposed in `waivers.html`** — worth recording because of HOW
it was found. `rowIdentity()` put the `spotlight` class on every row carrying
the player's id, including the non-addressable "Your QB2" comparison row. So
landing on a man who is both rostered and your own worst at his position lit up
TWO rows while `scrollIntoView` went to the other one. It had been there all
along; `link-check.mjs` only caught it once `trade.html` was added to `SOURCES`
and its sample happened to pick such a man. The spotlight now follows
`addressable`, for the same reason the `id` does.

**The live connection works.** The bridge extension is installed in Tim's Edge
and reads his private league 476225250. This was the single biggest blocker on
the project and it is cleared — the extension solved it without changing any
ESPN setting.

*(This paragraph used to end "do NOT re-litigate the make-the-league-public
question — it is moot". That was true while the desktop was the only place
anyone read the site. It stopped being true the day Tim started reading it on
his phone, where no extension can exist, and the phone section above records
why. The question is open, it is his, and he has not been asked.)*

> Standing instructions, current focus and what to build next have moved to
> [HANDOFF.md](HANDOFF.md), so there is one copy of them rather than two that
> can drift apart.

## Per-week trade valuation (`js/trade.js`, 2026-09-16)

**The flaw Tim found, in his own words**, and he is right:

> "I have 3 QBs that all avg low counts, however QB proj avg is much higher,
> because their proj has wide ranges (15-19) and with 3 players I often can
> always have a QB with a high (18-19) proj. This means getting a 19 proj QB
> doesn't really change my team, even though my starter only ever has a season
> proj of around 17."

`lineupValue` is where that goes wrong. It prices a squad ONCE, on one scalar
per man — the season projection over 17 — and **under a scalar only one
quarterback can ever count**. Three men averaging 16 are worth 16 a week, and a
fourth averaging 19 reads as a +3 upgrade. A real season does not work that way:
each of the three has his own weekly number, they move independently, and the
manager starts whichever of them is at the top of his range THAT WEEK. Between
them they put an 18 or a 19 in the lineup most weeks, so the squad already has
what the fourth man was supposed to add.

So a roster is now valued as the **sum, over every remaining week, of the best
legal lineup it could field in that week on that week's own projections**.
Three things fall out of that and each is worth knowing:

- **Positional depth needs no rule of its own.** It is simply what a maximum
  taken per week does that a maximum taken over an average cannot. There is no
  new constant and nothing to tune — compare `js/draft-model.js`, which has to
  carry `TUNING` numbers standing in for Tim's judgement.
- **The numbers are SEASON TOTALS, not weekly ones.** A +40 here is +40 over
  the whole remaining span, roughly +4.4 a week over nine weeks. It is not on
  the same scale as anything `typicalWeek` produces, and **any page showing
  both must say which it is showing** or be wrong by a factor of nine and look
  entirely plausible.
- **Byes stop being a special case and become the point.** ESPN returns 0.00
  for a man on bye — a number, not a null — so `optimalLineup` ranks him last
  and the week re-picks around him, which is exactly what the manager does.
  `typicalWeek` had to AVOID byes; this measure handles them by construction,
  and a squad with no cover in week 12 is correctly worth less than one that has
  some.

`optimalLineup` is still `js/forecast.js`'s, run once per week. Four features
now share it and none of them gets a copy.

**The fixture that makes the complaint falsifiable** is the whole reason this
can never be quietly reverted. `tests/test-trade-weekly.mjs` builds three QBs
rotating 18/15/15, each averaging exactly 16, against one steady 17. **The
season average prices them 48 against 51 and calls the single good QB better;
week by week they are 54 against 51.** The two measures disagree about which
squad is stronger, which is the disagreement Tim described. Adding a
19-every-week quarterback is then worth **+3** where the average claims +9. It
is the biggest single suite on the project (4,009 assertions) and if anyone
puts the scalar measure back as the answer, that disagreement vanishes and the
suite fails rather than passing quietly.

**A COMBO'S GAIN IS NOT THE SUM OF ITS TRADES' GAINS**, and this produces
confident wrong numbers in silence. Every offer's `myGain` was measured against
your CURRENT roster. Make two of them and the second one's gain was measured
against a roster that no longer exists — both re-fill the same lineup, so their
benefits OVERLAP: two trades that each upgrade your quarterback do not both
upgrade it, they compete for one slot and the better one wins. Two offers worth
24 and 18 alone are worth **24** together, not 42. So `bestCombo` applies every
send and every receive TOGETHER and prices the resulting roster ONCE.
**`naiveDelta` is kept and printed beside the real figure** rather than the
engine hiding the gap: demo reads +43.6 naive against +71.2 real.

Three more decisions inside `bestCombo`:

- **Two packings come back, not one.** Tim asked literally for "the most trades
  possible" while calling the section "best", and those disagree — three trades
  worth +2 between them is a worse season than two worth +15. `best` maximises
  gain and is the headline; `most` maximises the number of disjoint deals;
  `mostIsBest` says whether they are the same packing, so no page has to compare
  them itself.
- **A player cannot be traded twice**, which is a disjointness condition over
  the union of every `send` and `receive` id. Two deals with the SAME manager
  are treated as compatible when their player sets are disjoint — a judgement
  call rather than an obvious truth, flagged as `repeatPartners`, with
  `onePerPartner: true` available for a page that would rather not offer
  something socially odd. Worth confirming with Tim.
- **The forced cut is applied to the COMBINED result.** Two 1-for-2s leave you
  two men over the limit and cost you two players; pricing them one at a time
  would charge one cut twice and come out at a different, smaller number.
- **The partner still has to want it.** Each offer was a win-win alone; two of
  them with one manager can leave him worse off together, for the same reason
  running the other way. When `teams` is supplied every partner's combined side
  is priced too and a packing he would refuse is dropped.

Cost: the weekly search is about **8x** the scalar finder — 19 seconds for ten
squads over nine weeks — after two exact, answer-preserving prunes. Every
existing export is untouched and the default path is byte-identical, asserted
offer for offer, which is what made the change safe to land at all.

## The Trade page as it stands (2026-09-16)

The page now has four panels and they are four halves of one question: the
depth map says WHO to talk to, the finder says WHAT to offer him, clicking an
offer opens the deal week by week, and the combo section says which offers can
all be made at once. Everything in "The Trade page" above still describes the
depth map and the finder's search; what follows is what changed around them.

**THE WEEKLY MEASURE IS NOT THE DEFAULT AND IS ONE LABELLED PRESS AWAY.** It
cannot be made cheap: valuing a squad at what it can field in every remaining
week needs every remaining week's projections, and there is no bulk form (rule
3 in HANDOFF, established by trying four shapes of the request). So it is **one
request per week** — nine to thirteen of them — **plus about four seconds of
CPU** against a quarter of one, because the search re-fills nine to thirteen
lineups per offer instead of one. Both costs are on the button's face and in the
note under it BEFORE anything is spent, and **nothing fetches those weeks until
that button is pressed**: not on load, not when a remembered preference says
"weekly", not when the connection bar flips the page live. Spending both unasked
on Tim's phone is exactly the surprise this page exists not to spring. Between
the ask and the press the page draws the typical week and says so in every note
— **one function decides that for the whole page**, because two panels
disagreeing about which basis they are on is the one failure this page cannot
have.

**PLAYED WEEKS CANNOT AFFECT A TRADE.** Tim: *"don't let any data on weeks that
have already been played be able to affect the trade."* He is right and the
reason is not a matter of taste — a trade changes the REST of the season and
nothing else, so week 3's points are banked, no deal can move them, and a
valuation that includes them is answering a question nobody can act on. The
span is now **derived from the schedule** (every week with no result, through
13) rather than anchored on the week picker. The old rule was "the selected
week → week 13", which let a played week into every number on the page whenever
the picker sat in the past — and since the page OPENS on the last played week,
that was the normal case rather than an edge one. **Demo is the awkward case and
says so on screen**: the sample season marks all thirteen games played, so there
the picker stands in for "now" and the sample season is replayed as it stood
after it.

**PER WEEK IGNORES BYES BUT NOT NULLS, and the asymmetry is deliberate.** Tim:
*"ignore the bye week when calculating per week."* A bye comes back from ESPN as
**0.00** — a true fact about that week and no evidence at all about what the man
is worth in a week he plays. Averaging it in says a 14-a-week receiver with one
bye left in a nine-week span is a 12.4 receiver, which is a sentence about the
calendar wearing the clothes of a sentence about him. So `perWeek` is the mean
over his PLAYABLE weeks — his byes out of the divisor, and **only** his byes:

| The value | What it means | In the divisor? |
|---|---|---|
| `0.00`, on ESPN data | a bye | **no** — it comes out |
| `0.00`, on demo data | a man demo has ruled OUT; a real zero | yes |
| `null` | ESPN carried no number for him | **yes**, unchanged |

A null stays in because *"we do not know"* is not *"he does not play"*, and
quietly promoting one into the other would flatter every thinly-covered player.
The caller says which kind of data it is holding with `zeroIsBye`, and demo
passes `false` — the same distinction, in the same direction, as
`projToken(v, demo)` in the player card.

**The consequence has to be stated wherever both numbers appear: `projected` is
no longer `perWeek × weeks.length`.** It is `perWeek × weeksPlayable`, give or
take a rounding tenth, which is why `weeksPlayable` comes back beside them
rather than being left for a page to infer. A man with no playable week left has
`perWeek: null` — never a division by zero, and never a `0.0` that would read as
"he is worth nothing" rather than "there is nothing to say".

This does NOT move the finder's rankings, and that is structural rather than
lucky: `perWeek` is display-only, while `candidates()`, the forced cut and
`optimalLineup` all read the per-week numbers themselves. It DOES move the
depth map, deliberately — two panels printing two different per-week figures
for one man is the contradiction a shared divisor exists to prevent.

**The rest of what landed, each of them Tim's ask:**

- **One number per player, and it is per week.** The rest-of-season total is
  gone from beside every name.
- **The week-by-week breakdown is a pop-up, on demand.** Current and changed
  projection for every remaining week, the difference, and the totals, with both
  sides assuming the best lineup available THAT WEEK. A table rather than a
  chart, **because these numbers exist to be checked against ESPN by eye**. It
  closes on its button, on Escape and on an outside click, is a bottom sheet on
  a phone, and places and returns focus. **Deliberately no `aria-modal`**: the
  player card is a `<body>` child outside the dialog and claiming modality would
  hide it from a screen reader.
- **Best combo is a list of real offers, merged per manager.** Same row builder
  as the finder, so the same packages, churn, gains, pop-up and ESPN link. Two
  deals with one manager become ONE row with one link carrying all his incoming
  ids — and that is **more correct than showing them apart**, not merely tidier,
  because the engine has already priced the combo as one roster change.
  Presenting them as two rows with two gains would be showing the reader the
  exact arithmetic the engine refuses to do. **The merged gain is re-priced, not
  added up**, and the merged gains still do not sum to the combo's own headline
  for the same reason one level up — each was priced against the roster as it is
  today. The headline stays the only figure that prices the whole slate, and the
  page says so.
- **No position tag on a defence.** Tim: *"the position is in the name (chargers
  def)"*. Suppressed on the position being DST, never on the name, which would
  be a second way of knowing the same thing.
- **Every player named anywhere on the page carries the same card** as the
  analysis grids, including a chip strip under the depth map — that panel named
  nobody at all before.

`tr-test.mjs` grew from 75 assertions to **224** across this work, and the
engine suites came through byte-identical: 1,411 and 4,009, both untouched.

### The pop-up that never closed (2026-09-16, Tim's report)

He opened the Trade page to a pop-up reading "This trade, week by week" over
everything, a Close button that did nothing, and a body with no numbers in it.

- **It was CSS, and the suite could not see it.** `.modal { display: flex }`
  outranks the browser's own `[hidden] { display: none }`, so the element was
  `hidden` in the DOM — which is all linkedom checks — and fully drawn on
  screen. Close set `hidden` again and nothing changed. The fix is site-wide:
  `[hidden] { display: none !important }` in `css/app.css`, because every page
  toggles `.hidden` and any class that sets `display` would do the same thing.
  `tr-test` now asserts the rule is there. **A test that reads the `hidden`
  property is not a test that the thing is hidden.**
- **The pop-up buys its own weeks.** It used to show a sentence saying "press
  the button at the top" whenever the page was not on the weekly measure — which
  is the default. Clicking a deal is now the ask: `loadWeeksForDeal` fetches the
  missing weeks (`buyMissingWeeks`, split out of `loadWeekly`) WITHOUT changing
  the measure or re-running the search, because `runSearch` shuts the pop-up.
  The note says when the list behind was ranked on another measure. If the
  measure was already set to every remaining week but never pressed, the weeks
  arriving do force a re-rank, and `runSearch({ keepDeal: true })` keeps the
  pop-up open through it — it is priced on those same weeks, so the two agree.
  On live data this spends one request per week not already held, on the click.

## Ticking your own side of a trade (`extension/content-espn-trade.js`)

Tim asked for a deep link that arrives with BOTH sides already selected.
**ESPN's URL cannot do it, and that is verified rather than assumed.** Read out
of their own shipped bundle (`trade.page.js`, 2026-09-16), `players=` is matched
against the COUNTERPARTY's roster alone:

    p = t.find(e => e.teamId === x);   // x = fromTeamId — YOUR roster
    m = t.find(e => e.teamId === d);   // d = teamId     — THEIR roster
    y && i.length && m.players.forEach(e => {
      includes(i, e.id) && j.addPlayer(e, TRADE)         // only ever `m`
    })

Your own roster is fetched, rendered, and never pre-selected. There is no second
parameter for it, and swapping `teamId`/`fromTeamId` fails: ESPN overrides
`fromTeamId` to a team you own and then refuses with "You are trying to propose
trade to yourself." **The decisive evidence is ESPN's own Decline & Counter
button, which ships a trade link with no players on it at all** — if any
encoding for a full trade existed, that is the button that would use it.

So the extension does the other half. The site leaves a note, a content script
on ESPN's trade page reads it and ticks his men, and **he clicks ESPN's own
Propose Trade button himself**.

**NOTHING IS SENT TO ESPN BY ANY OF THIS.** `host_permissions` still holds only
the read host — the suite asserts it deep-equals the read host alone, and that
neither file so much as names the write host. The content script is forbidden
from touching Propose Trade, Cancel or the confirmation modal, and every
scenario asserts **zero events reached any of them**. That is the whole safety
model, and "finishing the job" by pressing the button too would destroy it.

Three things that would each have shipped looking perfectly fine:

- **A checkbox is a TOGGLE, and the URL has already ticked their side.** A
  script that clicked blindly would UNTICK them and propose a smaller trade than
  intended. State is read first; a click only happens where it changes
  something.
- **The click must go to the `<input>`, not the span that carries
  `aria-checked`.** React synthesises `onChange` for a checkbox from the click
  event, so clicking the span — or writing the attribute — repaints and selects
  nobody. The fake page in the suite has a store only a dispatched click can
  move and renders `aria-checked` FROM it, so an implementation that faked the
  attribute fails rather than passes.
- **A player's ESPN id is not in that page's DOM.** It is recoverable from the
  headshot URL, which covers everybody except a D/ST, whose row carries a team
  logo instead — so the name is the fallback, and **two men of one name are
  refused rather than guessed**.

A staged trade **expires after a few minutes and is consumed on read**, because
one staged and then abandoned must not silently tick boxes on an unrelated visit
a week later. Failure everywhere is silent and non-fatal: with no staged trade,
a changed ESPN build, or an exception anywhere, the page is left exactly as the
URL made it — their side ticked, yours not, which is the behaviour that already
worked.

**None of this has run in a real browser yet.** ESPN's markup and the React
click path were read out of their bundle and 77 assertions prove the logic, but
linkedom cannot prove ESPN's own store updates. The first real test is Tim
opening a link. It fails LOUDLY if it fails — the badge says "ESPN did not
record the selection for: …" rather than proposing less than he intended.

## The playoffs, and the hybrid final placing (`js/forecast.js`)

His league's settings are in the table at the top of [HANDOFF.md](HANDOFF.md)
and are not repeated here. They were unknown for months and several features
were blocked on them.

**Two rules of Tim's, in his own words, and they point in different
directions.** *"The title is the person who wins the league"* — so **title % is
winning the CHAMPIONSHIP round**, not topping the table, and the old number is
renamed `tableWinner` so the two can never be confused. And *"we mark the loser
as the person in last place by the end of the regular season, not the
playoffs"* — so **loser % is measured on the regular season**, which is exactly
why the consolation ladder is deliberately not modelled at all. Only the games
that can still produce a champion are played out.

**The final placing is a hybrid, and that was Tim's correction:** *"right now
the simulate season shows the data that corresponds to the regular season
positions, not the playoffs. Positions 1-6 should be based on the playoffs, and
7-10 should be based on the regular season."* So one placing is built per
simulated season:

| Places | From |
|---|---|
| 1 .. field size | the bracket — champion, beaten finalist, then each earlier round's losers, latest round first |
| field size + 1 .. N | the regular-season table, in order |

**The two halves agree by construction, and that agreement is ASSERTED rather
than computed twice.** The seeds ARE the top `field` of the table, so the teams
that miss are exactly the bottom four, and place 10 is the worst regular-season
team — which is also Tim's definition of the loser. The final placing's last
column is compared element-wise against the table's and throws if they ever
differ. It is an unreachable branch kept on purpose: **a silently wrong wooden
spoon is worse than a loud failure**, and two ways of working out "last" is
precisely how they start disagreeing.

**The test that proves the change** is worth keeping: a team projecting 180 a
week against everyone else's 100 tops the table over 90% of the time, but in the
playoff weeks everyone projects 110, so its bye plus two coin flips give it an
average FINAL place of **2.25** against a regular-season **1.0**. Under the old
behaviour those two numbers were identical.

**Splitting 3rd from 4th is an ASSUMPTION and says so on the page.** No game
simulated here separates two teams knocked out in the same round; in the real
league the consolation ladder does, and Tim was explicit that it is not to be
modelled — *"besides the [teams] who actually make the playoffs, you don't need
to simulate any other games"*. So the seed breaks the tie, which is defensible
because reseeding is off and the seed IS the league's own ordering of those two
teams. It moves an average placing by at most half a place and moves nothing
else. **State it on screen; do not let a reader think 3rd-vs-4th was played
out.**

**The field size is read from ESPN, not from our constant — and it was being
dropped twice on the way.** `settings.scheduleSettings` carries the whole
playoff shape (`playoffTeamCount`, `matchupPeriodCount`,
`playoffMatchupPeriodLength`, `playoffReseed`, `playoffSeedingRule`) and nothing
decoded it. Once `parseLeague` did, **it stopped at two separate hops —
`fetchSchedule`'s return, and then `normalizeSchedule` — so nothing on the page
could see it.** Both are fixed and the panel now says whether the number was
**read** or **assumed**. The new `fc-test` scenario declares FOUR where the
fallback is six, so it fails if the setting is ignored, and reverting either hop
drops it back to a 6-team, 3-round bracket saying "assumed". This is not a
constant that happens to be right: probing two public leagues on 2026-09-16
returned `playoffTeamCount` **6 and 4** and `matchupPeriodCount` **14 and 15**.

**It also settles a contradiction in Tim's own account.** He said four teams
make his playoffs; the settings he pasted said six. Neither is believed now —
the league is asked, and live data will settle it.

Three more things established here:

- **Playoff ties go to the higher seed**, established from ESPN's own
  documentation ("Playoff Tiebreakers": *"The higher-seeded team advances"*,
  the default in both standard and League Manager leagues) rather than assumed.
  Tested by forcing the branch with a vanishing sigma, since nothing else can
  reach it.
- **The bracket has its own RNG stream off the same seed.** It drew from the
  league's stream first, so *asking for playoffs shifted the regular-season
  numbers printed beside them* — a real bug, with a test now asserting the
  standings are byte-identical with and without a bracket.
- **It is cheap.** 100,000 runs with the bracket costs 1425ms against 1419ms
  without: five extra games on top of sixty. The hand-off through rAF is
  asserted rather than assumed.

Every field of `parsePlayoffs` is optional and nulls out on a payload without
`scheduleSettings`, so an older archived reading or a stub degrades to "ESPN did
not say" rather than to a number. `reseed` is tested with `=== true`
specifically, so **absent cannot read as reseeding being on**.

## Real names, and the two traps in getting them (`js/espn.js`)

Tim: *"I want to start naming each user by their real name, not their team name
(ex: 'ricky the blazers' should be replaced with 'Jonas Larson')"*. ESPN does
publish them: `members[].firstName` / `.lastName`, joined to `teams[].owners[]`
by SWID. Verified live across six public leagues — **47 of 47 members had both
names**, and the community claim that names can be withheld did not reproduce.

**The two traps, both of which would have made this look impossible:**

1. **`members` arrives on requests that never asked for it, with the name
   fields SILENTLY MISSING** — same array, same ids, `displayName` populated,
   `firstName`/`lastName` simply absent. They appear **only under
   `view=mTeam`**. So "ESPN does not give real names" can mean "wrong view",
   and it did.
2. **`view=mMembers` is a decoy.** It is the obvious guess, it returns 200 OK,
   it carries no names at all, **and it strips the owner arrays off the teams as
   well** — so it is strictly worse than asking for nothing.

Three join hazards, all verified real and all handled: `primaryOwner` is not
always `owners[0]`; `members` can outnumber `teams` (a league member who owns no
squad); and team ids are neither contiguous nor 1-based.

- **Resolution lives in `js/espn.js` alone**, so no page module changed — the
  name that reaches every page is already the person's. `teamName` rides
  alongside for anywhere the joke name is still wanted.
- **Names are rendered, never parsed.** The real data includes "Andrew" / "L"
  and "Bracket man" / "DM".
- Two owners render as a pair; an unresolved one falls back to ESPN's team name.
- **Demo is inert here** — it never routes through `espn.js` — and any payload
  with no members degrades to the team name, which is what keeps every stub and
  every archived snapshot working unchanged.

**A SQUAD IS IDENTIFIED BY ITS TEAM ID, NEVER BY ITS DISPLAYED LABEL**, and
this is the defect that arrived with the names. The Taken table built its
per-manager depth charts by grouping on the string it was DISPLAYING. **Two
squads rendering the same string merged into one**, and both then got a depth
chart computed over thirty-two players — every rank on both wrong, with nothing
on screen to suggest it. That was unique often enough to hide while a squad was
labelled with ESPN's team name; it stops being safe the moment a squad is
labelled with a PERSON, because two owners can share a display name and a squad
whose owner does not resolve falls back to a shared shape. The new scenario
gives two teams one name and keeps their ids: reverting the fix under it reports
the quarterbacks as QB1 through QB5 across a merged chart instead of 1,1,2,2,3,
**so the test fails without the fix rather than passing for the wrong reason.**
Anything anywhere on this site that groups by a displayed name is the same bug
waiting to happen.

## The cloud sync (`js/cloud.js`, wired through `js/season.js`)

**Desktop writes, phone reads.** Tim's proposal, in his words:

> "the information connected to the league can be updated every time they log
> onto their computer (which has the extension), and then the information is
> saved to the user's account, and then when the user uses the site on their
> iphone, it will connect to the information on firebase, not the site... It
> wouldn't be perfectly live, but if they logged on weekly or so, it would be
> good enough."

That is exactly right and it is the **only** route that works: the desktop is
the only machine that can see a private league, so the desktop has to be the one
that publishes. The phone never talks to ESPN at all, and the league stays
private.

**The sizes, which correct a figure elsewhere in this file.** A megabyte a week
is ESPN's RAW payload — what `snapshots.js` refuses to store. What goes up here
is the DECODED shape the pages render from, and it is **53 KB a week** for
rosters and 36 KB for the wire, **measured** by `tests/test-cloud.mjs` against a
realistic fixture rather than estimated. That is 19x under Firestore's 1 MiB
document cap, so there is no sharding machinery and there should not be one. The
one strip that mattered: `fetchWeekRosters` returns `players` AND
`starters`/`bench` over the same objects, so storing all three writes every man
twice — only `players` goes up, with two short index arrays naming the views.

**Staleness is tracked PER SHAPE, and never flattened to one timestamp.** A
week-old wire is actively wrong: the whole purpose of the wire is "who can I
add". Week-old rosters answer a season-shape question almost as well as live
ones, and fixtures never move. So `MAX_AGE` is **one day for the wire** and a
week for rosters and schedule, exported so no page can invent its own policy.
**Nothing may read as fresh by accident, so never-synced counts as stale.**
Squads and schedule are quoted separately from the wire, and the wire chip
appears ONLY when it is stale — a reassuring "wire 2 hours ago" would be about
a number nothing on screen was drawing, while a chip that only ever says "old"
cannot mislead.

**The substitution is inside `js/season.js`'s fetchers, so NO PAGE MODULE
CHANGED** — the same design constraint that kept the real-names work clean. The
order of preference is **bridge, then cloud, then direct ESPN**, written
identically in `season.js` and in the connection bar, because the two must agree
or the bar labels the wrong thing. With the bridge present the cloud is not
merely unpreferred, **it is not asked** — asserted with a read counter.

- **Syncing fires at most once every six hours per league**, and the interval is
  pinned to the thing that decays rather than picked to taste: `cloud.js` calls
  the wire stale after a day, so a longer interval would deliver a wire already
  at the edge of stale. Six hours means a morning and an evening sitting each
  publish once, while flicking between six pages publishes none. The button
  ignores it.
- **The Players page was the one page this could not reach**, because it called
  `espn.fetchFreeAgents` directly instead of going through `season.js` — so on a
  phone its Taken half worked while the wire above it, the half the page is
  named for, had nothing at all. The parse moved into `season.js`'s
  `fetchWireWeek`, which reads one index and one wire document rather than the
  thirteen `cloudDown` would spend on pages that never draw a wire.
  `parseFreeAgent` is pure, so moving where it is called changed no number.
- **Two things had to be fixed to make it work at all:** `connect()` now falls
  back to the cloud when the direct probe fails, or his phone could never
  connect to a private league; and nothing chooses a source until `bridge.ping()`
  has answered, or a desktop WITH the extension would label itself by whichever
  responded first.
- **Every function returns; none of them throw.** Offline, not signed in, no
  project configured, quota exceeded, a document that will not parse — all come
  back as `{ok: false, reason}` and the page renders exactly as it does today.
  The same rule as `snapshots.fetchRemote`, and it matters doubly here because
  the cloud is absent on every page load until the console setup is done.
- **Demo is never synced.** Same rule and same reasons as the snapshot archive,
  enforced by requiring the league id to be all digits — which a real ESPN league
  id is and `'demo'` is not — as well as honouring an explicit `isDemo`.
- The six transport methods hold all the Firebase knowledge and are
  **injectable**, which is what lets 190 assertions run against a fake that
  enforces Firestore's real rules rather than a Map that would agree with
  anything.

**IT IS UNCONFIGURED UNTIL TIM DOES THE CONSOLE SETUP**, and nothing about the
site changes until he has. `docs/firebase-setup.md` is click-by-click with the
rules ready to paste; it is about **15 minutes only he can do**, and it is
**two sittings**, because his own user id does not exist until he has signed in
once. The public `apiKey` is safe by design — security is in the rules, not the
key.

## The weekly summary page (`summary.html`, `js/summary-page.js`)

Tim's ask: *"I want to be able to send weekly summaries as text messages to your
league friends. In this message, I want to share a chart that has the league
members, Overall LUCK (across the season), title %, and loser % (using 100,000
simulations)."*

**He chose the phone's share sheet over automated SMS**, and the page is shaped
around that decision: the site draws the chart as an image and hands it to iOS,
he picks Messages and the group, and he reads the message before it sends. No
backend, no per-message cost, no phone numbers stored anywhere, and nothing here
ever sends anything.

**THE IMAGE IS THE PRODUCT, not the table.** The table is there so he can check
it before it goes; the PNG is the thing that leaves the site and gets read by
nine people with none of this page's context. So the definitions, the run count,
"our model and not ESPN's", and an amber **DEMO DATA** band when it is not real
are all drawn ON the image rather than only written beside it.

- **It computes nothing twice.** LUCK is `luckScore` straight off
  `computeLeagueStats` — the column recovered verbatim from Tim's spreadsheet —
  and title/loser come from `simulateSeason` **on the same seed the schedule
  page uses**, so the two pages cannot print different odds for the same season.
- **Title and loser are different questions and must never be collapsed.**
  Title is winning the championship round; loser is **last in the REGULAR-season
  standings**, which is why a season whose table is already decided can report a
  loser while the title column is still open.
- **Early in the season it refuses to print ten near-identical percentages**
  and says why instead.

Two defects the tests caught, both of which would have shipped looking fine:

- **The caveat was being cut off the picture.** The definitions line was one
  string, too wide for the card, and `clip()` truncated it — so the image read
  "Loser % = LAST IN THE REGULAR SEASON" and silently dropped the half that
  stops nine people reading it as the consolation ladder. Footnotes wrap now,
  never truncate, and the card height is measured from the wrapped count.
- **A saved "live" preference was being ignored**, because booting demo WRITES
  the source preference, so reading it afterwards always said demo. A connected
  owner would have been put back on sample data every visit **with the page
  looking entirely correct**.

One piece of wiring worth knowing: exactly ONE function on the page —
`adaptSimTeam` — knows what a `simulateSeason` result row is called, because the
bracket work was landing while this page was being written. It accepts `pTitle`
/`pLast` (probabilities) and `titlePct`/`lastPct` (per cent) and divides by a
hundred only for the latter. **Getting that backwards would put a 4,100% title
chance on the image**, which is at least the loud kind of wrong.

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

**Status as of 2026-09-16:** everything Tim has asked for is built and live —
nine pages, the phone layout, the per-week trade measure, the playoff bracket,
real names, the cloud sync and the weekly summary image. What is left is
almost entirely *seeing it against his real league*, plus the console setup only
he can do. See "Next" at the foot, and "What is genuinely open" in HANDOFF.

## Current state

- `index.html` — the season dashboard. *(It was the connect panel and the raw
  data probes when this line was written; those moved to `debug.html`.)*
- `stats.html` / `analysis.html` / `schedule.html` — season stats, weekly
  rosters, results and head-to-head. Every page carries the connection strip
  (`js/connection.js`) that shows whether it is on real or demo data, and now
  also whether it is reading the cloud rather than ESPN.
- `trade.html` — the depth map and the trade finder, built on one week of
  rosters read two ways. Every control is a repaint and nothing costs a request
  — **except the weekly measure**, which is one request per remaining week and
  is behind a labelled button carrying that cost on its face.
- `summary.html` — the weekly chart for his group chat, as an image.
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
  **The staged trade added a second content script and no write.** The manifest
  gained a `content_scripts` entry for
  `https://fantasy.espn.com/football/team/trade*`; `host_permissions` is
  unchanged and still the read host alone. See "Ticking your own side of a
  trade".
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
- **Per-week projections run through at least week 18** (re-probed 1241838 for
  2026 on 2026-09-16: all 174 rostered players carry one in weeks 13–18, week 17
  topping at 24.4 with a median of 10.3, one 0.00 a week). They are genuinely
  per-week and not one figure repeated — only 1 player in 174 carries the same
  value across weeks 15, 16 and 17, the same rate as any adjacent
  regular-season pair. **This is what makes his playoffs forecastable from
  ESPN's own numbers** rather than modelled from a scoring distribution.
- **`settings.scheduleSettings` really does differ per league** (2026-09-16:
  `playoffTeamCount` 6 and 4, `matchupPeriodCount` 14 and 15,
  `playoffSeedingRule` `H2H_RECORD` and `TOTAL_POINTS_SCORED` across 1241838 and
  899513). It is read, not assumed.
- **Real names are populated**, under `view=mTeam` and only there: 47 of 47
  members across six public leagues carried both `firstName` and `lastName`.
  The community claim that they can be withheld did not reproduce.

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
  **Neither the deep link nor the staged trade is a write**, and that is worth
  stating plainly because both of them end up on ESPN's own screen.
  `trade.html`'s "Open in ESPN" builds a URL; `extension/content-espn-trade.js`
  ticks checkboxes on the page that URL opened. The single write is still Tim's
  own click on ESPN's own Propose Trade button, and the content script is
  forbidden from going anywhere near it. **`host_permissions` still holds only
  the read host** — `test-extension.mjs` asserts it deep-equals the read host
  alone, and that neither file so much as names the write host.
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
- `analysis.html` — all ten teams' lineups at once, a per-team drill-down
  whose lineup you can move around to see what it would score, and "Who to
  start, week by week": one position, the whole season, every week that man
  makes the best legal lineup marked
- `schedule.html` — standings, matchups, results, fixture / head-to-head grid
- `waivers.html` — "Players": everyone not on a roster, and below it everyone
  who is, in a table whose
  columns are week numbers and whose cells are ESPN's projection for that
  player in that week. Position filter, every column sortable.
- `trade.html` — the depth map (who is deep where you are thin) and the trade
  finder (every swap that makes both squads better), priced across every
  remaining week when the button is pressed for it, with a per-offer week-by-week
  pop-up and a best-combo list merged per manager. See "The Trade page" and
  "The Trade page as it stands"
- `summary.html` — the weekly chart for his group chat: member, season LUCK,
  title % and loser % at 100,000 runs, rendered to an image and handed to the
  phone's share sheet. See "The weekly summary page"
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
- `js/snapshots.js` — the time machine: what a week's reading holds, how it is
  stored, and how it is turned back into the shapes the schedule page renders.
  Pure apart from localStorage, which it owns entirely.
- `js/touch-titles.js` — every `title` on the page, made tappable. Self-
  installing, like `connection.js`: a page opts in with one script tag and no
  page-module change. One delegated listener, one sheet element. Skips links
  and buttons on purpose — a tap on a control has to work the control.
- `js/player-card.js` — **the one player card**, shared by the analysis grids
  and the Trade page: a man's identity and his whole season as a three-row
  chart (weeks, projection, actual), which wraps rather than scrolling and opens
  as a sheet on a coarse pointer. Its header comment is the API; a page that
  wants it also needs the `.tipcard` / `.tc-*` CSS. **Do not grow a second one.**
- `js/cloud.js` — the phone bridge: the desktop publishes the decoded league to
  Firestore and a device with no extension reads it back. The six transport
  methods are injectable, which is what makes it testable without Firebase. Its
  header comment is the contract. Unconfigured until Tim does the console setup,
  and inert until then.
- `js/summary-page.js` — the weekly summary and the image it draws. Computes no
  statistic of its own: LUCK comes from `js/stats.js` and the percentages from
  `js/forecast.js`, through the same entry points the stats and schedule pages
  use.
- `js/waivers-page.js` — the Players page: the wire, and the taken table.
- `js/trade.js` — the trade engine: replacement level, the depth map and the
  finder. Pure, so it is node-testable, and it wraps `forecast.js`'s
  `optimalLineup` rather than growing a second copy of it.
- `js/trade-page.js` — the Trade page's wiring.
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
- `content-espn-trade.js` — runs on ESPN's own trade page and ticks **your**
  side of a staged trade, which is the one thing ESPN's `players=` parameter
  cannot do. It ticks checkboxes and nothing else: it must never click Propose
  Trade, never touch the confirmation modal, and never dispatch an event on
  either. See "Ticking your own side of a trade".

### Table sorting

Every table uses `js/sortable.js`: click a header to sort, click again to
reverse. Mark headers `<th data-sort>`. When the displayed text isn't the sort
value, put the real number on the cell as `data-v` — that is how a "10-3"
record sorts by wins and how a lineup slot sorts in QB→RB→WR→TE→FLEX order
rather than alphabetically. Missing values sort to the bottom in both
directions. Clicks are delegated from the table element, so a table may rewrite
its own `<thead>` freely; after re-rendering rows, call `resort(table)`.

**Every `<tbody>` is sorted, and each one independently.** Nearly every table
has one, so for those this is what it always was. Several bodies is how a table
keeps groups apart under a sort — the roster detail is starters, a totals band,
then the bench — and a body of one row is left where it is, which is what pins
a band in place.

## Testing

**The suites are in `tests/` now. Run them with `cd tests && npm install &&
npm test`** — see [tests/README.md](tests/README.md).

**25 suites, over 8,900 assertions.** A full run on 2026-09-16 was green in 230
seconds at **9,386 counted assertions**, plus four suites that report pages or
scenarios rather than a count (`test-pages-render` 6 pages, `test-home` 2 pages,
`stats-weeks` and `opp-check` 6 scenarios each). Those figures are the run, not
an estimate.

**`test-extension.mjs` HAD BEEN LOST FROM THE REPO, and that is a lesson rather
than a footnote.** This file documented it at 38 assertions as though it were
present; it was not there at all, and nobody noticed because the table below is
read more often than the directory is listed. It was recreated on 2026-09-16 at
**234** assertions, covering the injection and origin refusals it used to plus
everything the staged trade added. **A suite that is documented is not a suite
that exists — check `tests/` against this table before trusting either.**
`test-bridge.mjs` is in the same position right now: the table below still lists
it at 34 assertions and there is no such file. The coverage is worth recreating
if `js/bridge.js` is touched again.

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
| `test-trade-weekly.mjs` | **the biggest single suite on the project — 4,009 assertions.** The per-week measure, and its hand fixture is Tim's own complaint made falsifiable: three QBs rotating 18/15/15, each averaging exactly 16, against one steady 17. The season average prices them 48 against 51 and calls the single good QB better; week by week they are 54 against 51. Revert the weekly measure and that disagreement vanishes and this fails. Also the combo packer: that a combo is priced ONCE as one roster change, that `naiveDelta` is the sum it refuses to report, and that both packings (most gain, most trades) come back |
| `test-cloud.mjs` | the phone bridge — 190 assertions. What goes up, what comes back down, and how old each shape is. Runs against a fake transport that **enforces Firestore's real rules** rather than a Map that would agree with anything, and it is what MEASURES the 53 KB-a-week figure, against a fixture built at genuinely realistic size |
| `test-cloud-wiring.mjs` | the phone bridge WIRED IN — 126 assertions over 9 scenarios. The substitution inside `js/season.js` and the bar above it: that the order of preference is bridge → cloud → direct in both places, that **with the bridge present the cloud is not asked at all** (asserted with a read counter), that the Players page's wire comes down too, and that staleness is quoted per shape |
| `test-summary.mjs` | the weekly summary page — 203 assertions. LUCK, title %, loser %, and the image that actually gets sent: that the footnotes WRAP rather than truncate (the defect that cut "not the playoffs" off the caveat), that a saved "live" preference survives demo booting first, and that the two probability spellings are adapted the right way round |
| `owner-names.mjs` | real names instead of team names — 55 assertions. The `members` → `owners[]` join by SWID, that `primaryOwner` is not assumed to be `owners[0]`, more members than teams, non-contiguous team ids, a two-owner squad, and a payload with no members degrading to the team name |
| `test-espn-tick.mjs` | ticking your own side on ESPN's trade page — 77 assertions. A fake ESPN page whose store only a **dispatched click** can move, rendering `aria-checked` FROM it, so an implementation that wrote the attribute fails. Asserts a box already ticked is left alone (a checkbox is a toggle), that ids come off the headshot URL with the name as the D/ST fallback, that two men of one name are refused rather than guessed, and — in every scenario — that **zero events reached Propose Trade, Cancel or the confirmation modal** |
| `test-sim.mjs` | the season simulator — 415 assertions. RNG mean/variance, the normal's mean/variance/kurtosis, **that the simulated win rate matches `winProbability`** (the check that keeps the two models honest with each other), place probabilities summing to 1 per team AND per place column, mean placings summing to 55, mean wins matching the exact Poisson-binomial, the points-for tiebreak, and a finished season yielding certainty rather than noise |
| `fc-test.mjs` | the schedule page's forecast and simulation end to end — 707 assertions over 10 scenarios (demo, demo-mid, stubbed live at week 2, no team set, team picked later, switching through all ten teams, simulation interaction, the time machine's archive, roster fetch failing, and a league declaring FOUR playoff teams where the fallback is six — that last one fails if the field size read off ESPN's `scheduleSettings` is ignored at either of the two hops that used to drop it). Boots the real `schedule.html` with its real module in a child process per scenario |
| `test-forecast.mjs` | the forecast engine — 68 assertions. The normal CDF against textbook values, `optimalLineup` against brute-force enumeration over 350 random rosters in three league shapes (including superflex), and `winTotalDistribution` against exhaustive enumeration of every win/loss combination |
| `test-bridge.mjs` | **NOT IN THE REPO.** Documented here at 34 assertions — the site half of the bridge, a stand-in extension answering postMessage and `js/espn.js` proven to route through it — and there is no such file in `tests/`. Same class of loss as `test-extension.mjs` above, and worth recreating if `js/bridge.js` is touched |
| `test-extension.mjs` | runs `extension/background.js` with chrome+fetch stubbed and asserts URL injection / path traversal / bad origins are refused before any request — **234 assertions**, having been recreated after being lost from the repo (see above). It now also covers the staged trade: that a stage expires and is consumed on read, and that `host_permissions` **deep-equals the read host alone** with neither file so much as naming the write host |
| `link-check.mjs` | **the player click-through ACROSS pages** — 135 assertions. `index.html`, `analysis.html` and `trade.html` MAKE links, `waivers.html` RESOLVES them, and no single-page suite can notice when the two halves stop agreeing. It boots each page in its own child process, checks every link against the contract, then FOLLOWS a sample of the ids the source pages actually produced and asserts each lands on exactly that man. It found a real defect the day it was written (see the union rule above), and it exists because the three halves were built by three authors at once against a contract agreed in prose |
| `touch-check.mjs` | **the analysis grids on a screen with no hover** — 187 assertions over 4 scenarios. Boots the real page with `matchMedia` answering `(hover: none)` and asserts the tap opens the card as a sheet instead of following the link; that the sheet's link is the SAME href the cell carried, re-derived from the cell rather than read back off the card; that the tap does not ALSO drill into the team; that all three dismissals work; that a cmd-click is left to the browser; and that the identical click under a mouse is untouched, so the desktop path `link-check.mjs` follows is provably unchanged. The third scenario blanks one man's `playerId` on every team through a data:-URL loader, because the card has never depended on the link and must not start to — and that scenario is what found the drill-down defect. The fourth is the card's own: half a season on a 390px screen, where it asserts the Act row is filled only for weeks with an actual RECORDED and that a thirteen-week run **wraps onto balanced lines rather than scrolling**. It also covers `js/touch-titles.js`: that a `title` opens as a sheet on a tap, that a titled LINK or BUTTON does **not** (or the click-through and every control would break), and that a mouse gets none of it |
| `hot-check.mjs` (again) | records every green cue per player per week, presses FLEX, and compares cell for cell — **not one cell changes colour**, which is what proves a filter is only a filter |
| `taken-check.mjs` | the Taken players table — 223 assertions over 5 scenarios (a hand-built three-squad stub where every answer is known, the real `demo-rosters.js`, and one that gives TWO teams the same displayed name while keeping their ids — revert the id keying under it and the quarterbacks come back QB1..QB5 across a merged chart instead of 1,1,2,2,3). Every rank assertion re-derives the ordering from the RENDERED Avg column, grouped by the rendered owner — never from the stub’s raw numbers or the page’s own arithmetic |
| `test-trade.mjs` | the trade engine — 1,411 assertions over two fixtures. A hand-built two-team league where every answer is known by hand (the 18-for-18 mirrored swap is worth exactly 12 to each side), then the real demo pool, where **every offer is re-priced from the raw rosters** rather than read back off its own numbers — so an engine that merely reported confident figures would fail rather than agree with itself. Also asserts roster legality both ways and that the in/out lists add up to the stated gain |
| `tr-test.mjs` | the Trade page end to end — 224 assertions. The depth map's columns, its per-column tinting and its bar chips; the finder's ranking and its churn line; every control; the weekly measure's button and the fact that **nothing fetches a week until it is pressed**; the per-offer pop-up; and the combo list merged per manager. It caught a real defect the day it was written: a filter matching nothing HID the table without emptying it, so the previous search's rows sat in the document — invisible on screen, which is exactly why looking at the page would never have found it |
| `test-snapshots.mjs` | the time machine's storage — 123 assertions. Round-trips a reading through JSON, through a file, and into an empty browser; proves a snapshot is a COPY by moving the live season underneath one and checking it does not follow; and covers a browser that blocks storage, a full one, an unreadable key, and a file from a newer build. Also the committed archive: that it restores a wiped browser, keeps the browser's own copy over the file's, takes only this league's weeks out of a file holding several, and stays silent through a 404, an offline network, an HTML error page and a body that will not read |
| `an-test.mjs` | the analysis page end to end — 565 assertions over 8 scenarios (demo, stubbed live, weeks 5 and 11 refused, switching team / sorting / changing week, the two all-teams grids, and the roster detail's split + swap). Both new scenarios check the arithmetic by hand rather than against the page's own sums: 144 for the stub team's nine by average and 165.6 for the same nine in week 8; 158.6 after trading a 20.4 out for a 13.4, with a −7.0 beside it; and 141.4 in week 6, where a bye forces the lineup to be re-picked around a 0.00 |
| `hot-check.mjs` | both greens on the Players page’s wire table — 118 assertions. Re-derives each rule from the rendered DOM: over the per-position bar, and ahead of your own worst man that week. Also asserts the shading is NOT on every comparable cell, so a rule that greened the whole table fails here |

*(Superseded.)* "All green as of 2026-09-09: extension 38, bridge 34,
draft-model 44, draft-sim 36, practice 99, autostart 10, draft-render 107,
recovered 116, plus the stats-render check." Every suite in that line except
the first is one of the documented-but-absent ones; the first was absent too
until it was recreated. **The current run is the one at the top of this
section**, and it is what `npm test` prints.

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

Everything Tim has asked for is built and live. **This is the long version of
"What is genuinely open" in [HANDOFF.md](HANDOFF.md)** — that list is the short
one and it is correct; if the two ever disagree, HANDOFF is what a fresh session
reads first, so fix this one. Ordered, as it is there, by what would hurt most
to get wrong.

- **THE ONE ITEM WITH A DEADLINE: get a reading captured and committed.** The
  time machine records what the forecast said, once a week, and ESPN keeps no
  history of its own projections — so a week Tim never opens the schedule page
  in is gone for good. **Still empty as of 2026-09-15**, which is five days and
  a further game week worse than the last check. See the block at the top of
  `HANDOFF.md` for exactly what to ask him, and check `data/snapshots/` and his
  Downloads yourself before anything else. **The likeliest reason is now known
  and is worth saying to him plainly:** a reading is only taken when
  `schedule.html` loads on LIVE data, live data needs the bridge extension, and
  **the extension cannot exist on his phone** — so if he has moved to reading
  the site there, no reading will ever be taken. The cloud sync makes the
  archive *readable* on the phone; it cannot make one be *taken* there.
  Everything else on this list can be built in December just as well as today;
  this cannot.
- **Almost none of this has been seen against his real league in a browser.**
  Everything is verified against demo data, stubs and public leagues, and every
  page boots clean, but 476225250 is private and returns 401 to anything without
  his cookie, so **the first load through the bridge is where reality arrives**.
  Specifically unproven there:
  - the **real-names join** — `members[].firstName` under `view=mTeam`, and
    whether any of his nine leaguemates fails to resolve;
  - the **playoff field size** read off his `scheduleSettings`, which is what
    settles his own 4-vs-6 contradiction;
  - **every number the Trade page's weekly measure produces**, including the
    per-week figures with byes out of the divisor;
  - whether `% own` actually populates from the `mRoster` view (the roster
    detail hides that column when it does not);
  - whether any week's projection drops implausibly far, which would mean bye
    handling is over-firing;
  - whether the strength-of-schedule basis on `schedule.html` picks the path it
    should;
  - whether the Players page's **two requests per week** — the wire and every
    squad — is acceptable to him over a full thirteen-week span, since that is
    26 requests for "Rest of season".
- **The trade tick-your-side has never run in a real browser.** ESPN's markup
  and the React click path were read out of their shipped bundle and 77
  assertions prove the logic, but linkedom cannot prove ESPN's own store
  updates. The first real test is Tim opening a link. It fails loudly if it
  fails — the badge says "ESPN did not record the selection for: …" rather than
  proposing less than he intended. See "Ticking your own side of a trade".
- **Firebase is built and wired but not switched on.** `docs/firebase-setup.md`
  is click-by-click; it needs about 15 minutes of console work only he can do,
  in **two sittings**, because his own user id does not exist until he has
  signed in once. Until he does it, `js/cloud.js` is unconfigured and every page
  behaves exactly as it did before. See "The cloud sync".
- **Three decisions of his that are open**, all flagged and none urgent:
  whether his league really has 6 playoff teams (his prose said 4, his pasted
  settings said 6, and the page now reads it from ESPN — so live data settles
  it); whether 3rd-vs-4th should keep being split by seed or should follow the
  consolation ladder; and whether the joke team names should appear anywhere now
  that squads are labelled with people. A fourth, smaller one: whether the combo
  packer should be allowed to propose two disjoint deals to the SAME manager, or
  run with `onePerPartner: true`.
- **"Make the league public" is open again, and it is his call.** It was settled
  and then unsettled: the extension solved the desktop, and then he started
  reading the site on a phone where no extension can exist. The cloud sync is
  the answer that keeps the league private, so this is now the fallback rather
  than the only route — but do not assume it either way, and do not re-close it
  in this file. See the phone section.
- **Writes to ESPN are still not built, and the deep link is why.** He chose
  deep-linking over auto-send deliberately. If it ever comes back: there is **no
  dry run** (`VALIDATE` is not an accepted `executionType`), a two-team test
  league violates ESPN's Fair Play policy whose stated remedy is a ban, and a
  flagged account mid-season would cost him the league and this tool at once,
  because the bridge reads through his cookie. **The staged-trade flow is not a
  write and changes none of that** — see "Known constraints".
- **The Trade page does not price the PLAYOFF weeks**, and this is a real
  question rather than an oversight. The week-13 cap is gone, so the whole
  remaining regular season is priced — but weeks 15–17 are not in ESPN's matchup
  feed at all, so reaching them means fetching by week number the way the
  schedule page's bracket already does. Whether it should is Tim's call: a trade
  for the playoff weeks is only worth anything if he gets there, and weighting a
  deal towards weeks he may not play is its own kind of wrong.
- **Trade ideas he deliberately did not pick**, from the list of five on
  2026-09-09: a deal's effect in **expected wins** rather than points, and an
  **auto-written pitch message**. (The third, a week-by-week strip, now exists
  as the per-offer pop-up.) Ask before adding either.
  1. **Wins, not points.** "+6.2 a week" is hard to weigh; `simulateSeason` and
     `winProbability` already exist, so re-running the season with a trade
     applied would give "6.1 → 6.8 expected wins, 11% → 19% to finish first".
     No public tool can do this because none of them know his schedule — and now
     that the bracket is modelled it could give title % as well.
  2. **The pitch message.** The finder already knows why a trade helps the other
     manager, so it can write the sentence and offer a copy button. Every guide
     says an offer arriving with no message reads as an attempted robbery.
     Copy only — **do not auto-send**; writes are the phase after this one.
- **A FLEX-empty table is untested.** Every fixture pool contains running backs,
  so the filter always matches somebody. The same empty-state wording is proven
  through the reachable "no defence" case.
- **The Predictions tab** — the one genuinely unbuilt idea from his sheet. He
  tested by hand, for week 1 only, whether a team's projected total at a given
  week predicts the final ranking. The site can answer it across all 13 weeks.
  (His sheet called that number "Est Total"; the grid's column is just `Total`
  now, and it is nine real men rather than seven plus an allowance.)
- **The click-through, one step further.** It lands on a man and shows his rest
  of season. Tim has not asked for more, but the obvious next step if he does is
  landing from a *team* — "show me everyone Nolan holds" — which the taken
  table's owner column already groups by.
- **Writes / in-ESPN panel** — the later phase. See "The bridge & writes".

Still parked, do not pursue unless asked:
- The smart drafter (built; awaits his spec answers in `TUNING`, and the live
  ESPN draft feed has still never run against a real draft).
- Fold in Tim's remaining sheet-formula answers if he gives them.
- The score-differential curve rationale (he will explain; reproduce, don't
  rationalise).
- Injury-loss automation (method recorded in `js/stats.js`; deliberately out).
- The consolation ladder, which he was explicit about not modelling.
