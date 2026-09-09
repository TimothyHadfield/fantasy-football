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
| The hover card — the week run as a chart, and why it is not a `title` | "The analysis grids' hover is a two-row chart" |
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
| Which weeks a bench man actually starts | "Who to start, week by week" |
| The depth map, and what "replacement" means | "The Trade page" |
| Why a trade can make BOTH squads better | "The Trade page" |
| What to do next | "Next", at the foot |

## What changed on 2026-09-09

Four sessions ran that day and the site changed a great deal. Everything below
is the record of what was built and — more usefully — of what was tried, found
to be wrong, and must not be tried again.

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

**The analysis grids' hover is a two-row chart (the tip card).** Week numbers
along the top, that man's projection for each one directly underneath, with the
identity line above it.

It was lines of text in a native `title` first — the right first answer, and
Tim read it and said it was hard to scan. He is right, and **the fix could not
be a better string**: a native tooltip renders in the OS UI font, where a space
is narrower than a digit and "Bye" is nothing like either, so no amount of
padding lines thirteen columns up. Two `<tr>`s in one table do it exactly.

What a card of our own costs, and how each part is paid — do not undo any of
these without replacing them:

- **Clipping.** Both grids live in `.table-scroll` (`overflow:auto`), so a card
  inside one would be cut off at its edge. It is a child of `<body>`,
  positioned `fixed`.
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

Still no request: it is `state.seasonWeeks` read a second way. The four
no-number states are told apart by word AND by class — `Bye`, `—`, `off`, `·` —
with a legend line only for the ones that actually occur, and demo never claims
a bye.

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
Do not add them uninvited.

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
what it is.

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
- `trade.html` — the depth map and the trade finder, both built on one week of
  rosters read two ways. Every control is a repaint; nothing here costs a request.
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
  finder (every swap that makes both squads better). See "The Trade page"
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
| `link-check.mjs` | **the player click-through ACROSS pages** — 103 assertions. `index.html` and `analysis.html` MAKE links, `waivers.html` RESOLVES them, and no single-page suite can notice when the two halves stop agreeing. It boots each page in its own child process, checks every link against the contract, then FOLLOWS a sample of the ids the source pages actually produced and asserts each lands on exactly that man. It found a real defect the day it was written (see the union rule above), and it exists because the three halves were built by three authors at once against a contract agreed in prose |
| `hot-check.mjs` (again) | records every green cue per player per week, presses FLEX, and compares cell for cell — **not one cell changes colour**, which is what proves a filter is only a filter |
| `taken-check.mjs` | the Taken players table — 126 assertions over 2 scenarios (a hand-built three-squad stub where every answer is known, and the real `demo-rosters.js`). Every rank assertion re-derives the ordering from the RENDERED Avg column, grouped by the rendered owner — never from the stub’s raw numbers or the page’s own arithmetic |
| `test-trade.mjs` | the trade engine — 1,411 assertions over two fixtures. A hand-built two-team league where every answer is known by hand (the 18-for-18 mirrored swap is worth exactly 12 to each side), then the real demo pool, where **every offer is re-priced from the raw rosters** rather than read back off its own numbers — so an engine that merely reported confident figures would fail rather than agree with itself. Also asserts roster legality both ways and that the in/out lists add up to the stated gain |
| `tr-test.mjs` | the Trade page end to end — 75 assertions over 3 scenarios. The depth map's columns, its per-column tinting and its bar chips; the finder's ranking and its churn line; and every control. It caught a real defect the day it was written: a filter matching nothing HID the table without emptying it, so the previous search's rows sat in the document — invisible on screen, which is exactly why looking at the page would never have found it |
| `an-test.mjs` | the analysis page end to end — 273 assertions over 6 scenarios (demo, stubbed live, weeks 5 and 11 refused, switching team / sorting / changing week, the two all-teams grids, and the roster detail's split + swap). Both new scenarios check the arithmetic by hand rather than against the page's own sums: 144 for the stub team's nine by average and 165.6 for the same nine in week 8; 158.6 after trading a 20.4 out for a 13.4, with a −7.0 beside it; and 141.4 in week 6, where a bye forces the lineup to be re-picked around a 0.00 |
| `hot-check.mjs` | both greens on the Players page’s wire table — 101 assertions. Re-derives each rule from the rendered DOM: over the per-position bar, and ahead of your own worst man that week. Also asserts the shading is NOT on every comparable cell, so a rule that greened the whole table fails here |

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

- **Check the rebuilt pages against the real league.** Everything here is
  verified against demo data, stubs and public leagues, and every page boots
  clean, but **none of it has been seen against live 476225250 in a browser**.
  That is the first job. Specifically:
  - whether `% own` actually populates from the `mRoster` view (the roster
    detail hides that column when it does not);
  - whether any week's projection drops implausibly far, which would mean bye
    handling is over-firing;
  - whether the strength-of-schedule basis on `schedule.html` picks the path it
    should;
  - whether the Players page's **two requests per week** — the wire and every
    squad — is acceptable to him over a full thirteen-week span, since that is
    26 requests for "Rest of season".
- **Trade interaction** — the depth map and the finder are BUILT; see "The Trade
  page". Tim was shown five ideas and picked two. The other three are ready to
  build and should not be started without him asking:
  1. **Wins, not points.** "+6.2 a week" is hard to weigh; `simulateSeason` and
     `winProbability` already exist, so re-running the season with a trade
     applied would give "6.1 → 6.8 expected wins, 11% → 19% to finish first".
     No public tool can do this because none of them know his schedule.
  2. **The weeks that matter.** A deal that is +5 on average and −12 in weeks
     12–13 is a bad deal. Per-week projections for the rest of the season are
     already fetched by the analysis page's season grid; the strip is a repaint.
  3. **The pitch message.** The finder already knows why a trade helps the other
     manager, so it can write the sentence and offer a copy button. Every guide
     says an offer arriving with no message reads as an attempted robbery.
     Copy only — **do not auto-send**; writes are the phase after this one.
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
- The smart drafter (built; awaits his spec answers in `TUNING`).
- Fold in Tim's remaining sheet-formula answers if he gives them.
- The score-differential curve rationale (he will explain; reproduce, don't
  rationalise).
- Injury-loss automation (method recorded in `js/stats.js`; deliberately out).
