# The backlog — five audits, 2026-09-20

**New session? This file is the work queue. `HANDOFF.md` is still the
orientation and its rules still bind; read it first, then start here.**

Everything below came out of five parallel read-only audits run on
2026-09-20 against commit `febca96`: numbers/consistency, display/density,
edge cases/failure modes, product gaps, and tests/tooling. Every item is
measured or traced to a line of code. **Line numbers are as of `febca96` and
will drift — grep for the quoted code rather than trusting the number.**

Nothing here has been fixed. Tim has seen the summary and has not yet chosen
an order; the recommended one is §1 → §2 → §3, on the reasoning that §1 is
wrong on screen today, §2 is losing data that cannot be recovered, and §3 is
what lets the rest regress unnoticed.

---

## How to work on this list

Read these before touching anything; each is a lesson this list is made of.

1. **A green suite proves less than it looks.** 38 suites and 13,302
   assertions were green throughout every defect below. Two of the worst
   (§1.1, §1.3) are invisible to the suite by construction. **Run
   `node tests/text-audit.mjs` and `node tools/measure-layout.mjs` after any
   change that touches a panel**, and read §3 before trusting any assertion
   you did not write yourself.
2. **Get the baseline from a clean worktree**, never from the shared tree:
   `git worktree add <scratchpad path> HEAD`. Never `git stash`, `git
   checkout` or `git reset` — other work may be in flight. Do not junction
   `node_modules` into a worktree you intend to `git worktree remove`; that
   emptied `tests/node_modules/boolbase` once and `npm install` did not
   notice.
3. **Make every fix falsifiable.** Revert it, watch the new assertion fail,
   restore it. Say which ones you actually did this to. Three separate agents
   discovered on 2026-09-19/20 that assertions they had just written passed
   whether the feature worked or not.
4. **Parallel agents want disjoint file sets.** Suggested ownership is on
   each item. Anything spanning two agents' files needs a test that spans
   them (HANDOFF's rule, and `link-check.mjs` is the worked example).
5. **Tim checks numbers by hand against ESPN.** A fix that changes a number
   must say so on screen, in the panel note (rule 7).

---

## §1 — Wrong on screen today

### 1.1 Half the red/green scale never draws · `css/app.css` · ONE WORD ×3
**The single highest-value fix in this file.**

540 of 1,121 heat-classed cells render with **no tint at all**, and which half
you lose is decided by row parity rather than by the data. Three rules use the
`background` **shorthand**, which resets `background-image` to `none`:

```css
css/app.css:421   tbody tr:nth-child(even) td { background: var(--row-alt); }
css/app.css:426   tbody tr.me td              { background: #14261a; }
css/app.css:436   tbody tr:hover td           { background: var(--panel-3); }
```

Each is specificity (0,1,3); the tint rules (`.heat-up-4` etc., `css/app.css:508-516`)
are (0,1,0). Consequences, all measured:

- **Your own row (`tr.me`) is never coloured, on any table, anywhere.**
- **Hovering a row wipes its colours while you read it.**
- Every second row of every table is colourless, so the eye picks out the
  stripe pattern rather than the data.

Measured per page (tint drawn / erased): index 15/16, stats 76/82, analysis
111/90, schedule 33/32, waivers 294/275, trade 38/32, summary 14/13 —
**581 drawn, 540 erased, 48%.**

**THE FIX** is `background:` → `background-color:` on those three rules. (The
alternative, raising the tint to `.heat.heat-up-N:not(html)` at (0,2,1) to
match the weight channel, also works and is more robust to the next shorthand
somebody writes; argue it either way but do one.)

**`HANDOFF.md` rule 14 is FACTUALLY WRONG and must be corrected with the fix.**
It states the tint is a background-image "because zebra, row hover and
`#seasonTable td.lit` all own background-COLOR at higher specificity". All
three are shorthands. `tr.picked td` and `tbody.split td` were converted on
2026-09-19; these three — which every table on the site uses — were missed.

**Test:** assert computed `backgroundImage !== 'none'` on a heat cell in an
even row, in a `tr.me` row, and under `:hover`. None of that is asserted today.
**Owner:** `css/app.css` + `HANDOFF.md`.

### 1.2 The `A week` grid totals nine lineup spots; the league starts ten
`js/analysis-page.js:405-416` — `GRID_SLOTS` is hard-coded QB, RB1, RB2, WR1,
WR2, TE, FLEX, DEF, K. **Two receivers. Tim's league starts three.**
`totalOf` (`:521-524`) sums exactly those, and the header claims "Nine real
men, not an estimate" (`:1163`).

So on his real league every `A week` **Total is one whole receiver light**
(~10–12 pts), and the red/green scale on that column ranks ten squads on
nine-man lineups. The `Proj avg` tab beside it uses `leagueSlots()`
(`:1197`) and gets ten — and the note at `:1752` actively invites the reader
to compare the two.

The comment at `js/analysis-page.js:1178-1180` already names the problem —
"his league starts ten (three receivers), so the nine would have dropped a
starter out of every total" — and fixes only the other table.

**Second, undisclosed difference on the same switch:** `A week`'s Total takes
**no floor**; `Proj avg`'s does. The comment at `:1465-1473` defends leaving
the individual *cells* unfloored (a cell is a man; a bye is not a bad
quarterback) and that argument is sound — it says nothing about the Total,
which is a claim about a squad's week and is what rule 13 covers.

**THE FIX:** `GRID_SLOTS` → `leagueSlots()`, and decide the Total's floor
deliberately. **Test:** a scenario whose league starts three receivers, where
the two tabs' totals must reconcile. **Owner:** `js/analysis-page.js`,
`tests/an-test.mjs`.

### 1.3 Home and Schedule quote different win chances for the same game
The 41.6%/49.3% defect of 2026-09-17, reopened by the floor.

- Home: `js/home-page.js:688` → `capture.matchupOdds(data, have)` →
  `js/capture.js:458` `buildProjection(data, toProject)` — **no floors**, and
  the function takes no `floors` option. `grep -c floor js/home-page.js` → 0.
- Schedule: `js/schedule-page.js:907` `capture.buildProjection(state.data,
  weekTeams, state.floors)` — floored.

Measured on a squad with K and D/ST at 0.00 against a healthy one:

| | Home (unfloored) | Schedule (floored) |
|---|---|---|
| team points | 84.0 vs 99.0 | 100.3 vs 100.8 |
| win % at σ=27 | **34.7%** | **49.5%** |
| win % at σ=12 | **18.8%** | **48.8%** |

Home prints, on screen: *"The win chance compares each side's best lineup, as
the Schedule page does"* (`js/home-page.js:884`). Its own comment at `:230`
still asserts "THE WIN CHANCE IS THE SCHEDULE PAGE'S, NOT A SECOND MODEL" —
true before 2026-09-18, false now.

**`tests/home-winpct-check.mjs:177` exists to prevent exactly this and
cannot see it**: its fixture answers `kona_player_info` with `{players: []}`,
so both pages get an empty floor map and agree by having nothing to disagree
about. **Fixing the fixture is part of this item, not a follow-up.**
**Owner:** `js/capture.js`, `js/home-page.js`, `tests/home-winpct-check.mjs`.

### 1.4 Three pages floor on week 1's waiver wire, forever
| Page | Wire read for | What the comment claims |
|---|---|---|
| Schedule | `js/schedule-page.js:1011` `plan.asking[0]` = first **decided** week = **week 1** | ":1007 — for the first week being projected" |
| Stats | `js/stats-page.js:910` `schedule.weeks[0]` = **week 1** | ":905 — the first week on screen" |
| Summary | `js/summary-page.js:496` `asking[0]` = first week **ahead** | ":491 — the same week the Schedule page uses, so both floor identically" |
| Analysis | `js/analysis-page.js:1010` `state.week` | correct and disclosed |
| Trade | `js/trade-page.js:4509` `state.week` | correct and disclosed |

Verified by running the calendar functions at week 3: **schedule floorWeek = 1,
summary floorWeek = 3.** All three comments are wrong. By December, Schedule
and Stats are flooring on a four-month-old read of the post-draft leftovers,
which is systematically generous (week-1 projections are full-strength and
pre-bye).

`tests/cross-sim-check.mjs` contains **no floor assertion at all** and its
`fetchWireWeek` returns `[]`, so HANDOFF's claim that it makes "flooring one
and not the other a failing test" is not true today.

**Owner:** `js/schedule-page.js`, `js/stats-page.js`, `js/summary-page.js`,
`tests/cross-sim-check.mjs`.

### 1.5 Three floor consumers never disclose the floor, and one contradicts it
`describeFloors` is called only from `js/analysis-page.js:3897` and
`js/trade-page.js` (`:2688, :4128, :5587`). Schedule, Stats and Summary apply
floors and say nothing — against rule 7, and against `js/season.js:605`'s own
claim that "every panel that uses it says so".

Worse than silence: `buildProjection`'s note (`js/capture.js:355-361`) ends
*"Players on bye come back at zero from ESPN, so they sit down on their own"*
— printed under Week matchups (`js/schedule-page.js:1516`) and in My season
(`:2347`), on numbers where the floor has just lifted those bye slots off
zero. Stats' Opp proj note (`js/stats-page.js:1089`) describes the pre-floor
basis word for word.

Failure: Tim hand-checks a schedule-luck number, adds up best lineups as the
note instructs, and lands several points low on every opponent with a bye.
**The note is what tells him his arithmetic is wrong.**

### 1.6 Ties are dropped from "Expected wins" and counted in "Proj. wins"
`js/schedule-page.js:2105` — `if (winner === 'tie') banked.t++;` — ties go to
`banked.t` and never to `banked.w`. Then `:2287` `winTotalDistribution(probs,
banked.w)` and `:2289` `expectedWins(probs, banked.w)` pass `banked.w` alone,
so the half-win is dropped from Expected wins, the 80% range and the histogram.

The simulation on the same page banks it correctly (`js/capture.js:541`,
`h.wins += 0.5`), as does "Place now" via `standingsKey` (`js/capture.js:577`).

**His league's matchup tie breaker is None, so ties stand and will happen.**
A 2-0-1 team reads "Expected wins 8.1" and "Proj. wins 8.6" three panels apart.

### 1.7 The Players page still averages the old way
HANDOFF's open question 3 records this as a one-fact difference. **It is now
four facts wide.**

- Players: `js/waivers-page.js:649` → `meanOf` (`:995`) drops only `null`; a
  bye's 0.0, a ruled-out 0.0 and a genuine 0.0 all stay in the divisor.
- Trade: `js/trade-page.js:655` / `js/trade.js:875` — `if (v === null || !(v > 0))
  continue`, so byes, nulls, unread weeks **and** ruled-out zeros all leave it.

On PROGRESS's own fixture (`16 · 0(bye) · 15 · null · 18 · unread`) Players
prints **12.3** and Trade prints **16.3** for the same man over the same span
— and the Trade page's player link *lands on the Players page*. **Tim's
original "100% of his future weeks project above 14.2" complaint is still
reproducible there today.** He has now answered this question once; apply his
answer, or ask him whether the Players page's "count everything" rule is
deliberate.

### 1.8 FLEX floors inconsistently between filled and empty
`js/floor.js:277-284` (filled) uses `flooredValue(player, floors)` — keyed on
the **player's position**. `:291-300` (empty) uses `slotFloor(slotId, floors)`
— the best of RB/WR/TE. The documented rule (`js/floor.js:203-209`, HANDOFF
2026-09-18) is "a slot's floor is not a position's".

So a FLEX filled by a bye TE is assessed at the TE floor (~6.6) when what you
would stream is the best of RB/WR/TE (~10.4) — **and a squad with an EMPTY
flex scores better than one with a useless man in it.** Confidence: looks
wrong, needs a test; `test-floor.mjs` appears not to cover a flex filled by a
zero.

### 1.9 Two small ones
- **Home's roster-strength rank is computed on the rounded value.**
  `js/home-page.js:349-355` sorts on `round1(seasonTotal / 17)`, so two squads
  1.8 season points apart tie at 104.7 and are then ordered by ESPN's team
  order — while the row's own `title` (`:1022`) prints the totals that show
  them differing. Sort on `seasonTotal`, round for display only.
- **Stats' chart highlight is keyed on a displayed name** (rule 9).
  `js/stats-page.js:654` resolves a team id to `.name`, then `js/charts.js:368`
  matches `s.name === o.highlight`. Two managers rendering the same string get
  both lines emphasised.

---

## §2 — Losing data that cannot be recovered

**Rule 8: ESPN keeps no history of its own projections.** Everything in this
section degrades permanently with each week that passes.

### 2.1 Week 15 files week 14's numbers, reports success, and blocks 16–17
Verified against an all-played 14-week league: `capture.liveAsOf` → **15**,
`capture.rosterPlan` → `{weeks:[14], project:[14]}`. `js/capture.js:241` drops
the playoff weeks exactly when they are the only weeks left:

```js
project = weeks.concat(open.length ? playoffWeeks(data) : [])
```

`takeReading` (`:629`) then builds a projection over **week 14**, succeeds, and
returns `code:'ok'` — so the Time machine panel reports week 15 as recorded.
And because first-write-wins on `liveAsOf`, which is pinned at 15 for the rest
of the season, **weeks 16 and 17 never get a reading at all.** Those are the
championship weeks.

### 2.2 The archived reading is unfloored; the Schedule page's is floored
- Connection-bar route: `js/capture.js:630` inside `takeReading()` —
  `buildProjection(data, toProject)`, no floors, and `strengthNote:
  projection.note` (`:639`).
- Schedule-page route: `js/schedule-page.js:441-451` passes `state.projection`
  (floored) and `state.strengthNote`.

`captureNow`'s own comment (`:436-438`) claims they are "the same call … so a
reading taken here and one taken from any other page are the same record",
and cites `test-capture.mjs` — which holds them to it **on floorless fixtures
only**.

Failure: he opens the Players page on Tuesday, the bar takes the week's
reading unfloored; he opens Schedule on Wednesday and `autoCapture()` declines
because a reading exists (`js/schedule-page.js:495`). December's replay is then
10–16 points per squad below what the live page showed him, **with no way to
tell which weeks are which.**

### 2.3 The archive stores team totals only
`js/snapshots.js:100` `snapshotFrom` stores `proj[week][teamId]` plus games,
strength and sigma. So the time machine can answer "how wrong was the week-12
*team* projection" and **nothing at all about players** — which is every
question in `docs/strategy-research.md` worth acting on (does a receiver's
week-12 number drift as his role firms up; whose numbers are sliding).

`takeReading` already calls `fetchWeeksRosters(plan.asking)`; **the player rows
are in memory and thrown away.** The affordable version is his own roster's
per-week projections plus the other nine squads' starters — roughly a tenth of
"everything" — behind a `SCHEMA = 2` bump with the hydrate path tolerating v1.
Watch `MAX_BYTES` (400KB) and the size of the committed JSON.

**Land the capture now and leave the analysis panel unbuilt.** It cannot pay
before about week 8, and it is impossible later.

### 2.4 A failed bye read is frozen into the store with no record
`js/season.js:513` — the byes are read once per span and "a failed read is
`{}`". That `{}` flows into `fetchWeekRosters` for every week in the batch
(rule 2: byes unknown ⇒ projections stay as sent), and each is persisted at
`:448`/`:498` **with no note that byes were unknown**; `store.writeWeek` has no
bye field. One 401/429/timeout during a 12–17-request page load gives a D/ST
projecting 4.41 in its own bye week, served for six hours — or **frozen for the
season** if the week was already final. The "Bye" label never draws, because
`zeroKind` needs a 0.

### 2.5 The store serves a forecast for a week that has since been decided
`js/season.js:346-349` — `fetchWeekRosters` consults `store.readWeek` first and
**never re-checks `weekIsFinal(week)`**; `store.fresh()` (`js/store.js:193`)
serves any `final:false` entry under six hours. Read a week pre-kickoff, ESPN
decides it within six hours, open another page: pre-kickoff lineups presented
as final. **One-line fix:** refuse a `final:false` entry when `weekIsFinal(week)`.

### 2.6 The export still has not happened
`data/snapshots/` holds only its README and there is no
`C:\Users\timha\Downloads\fantasy-archive-*.json`. Weeks 1–2 exist **only** in
his browser. Ask him to press **Export archive** on
[the Time machine panel](https://timothyhadfield.github.io/fantasy-football/schedule.html#timePanel),
then commit the file. Check the folder yourself first — he may have done it
without saying.

---

## §3 — The safety net is weaker than 13,302 assertions suggests

### 3.1 CI gates nothing; the site publishes before the tests start
Pages here is `build_type: legacy`, deploying straight off `main`. For every
commit, `pages build and deployment` and `tests` start in the same second: the
deploy finishes in **39s**, the tests in **7m18s**. `main` has **no branch
protection**. A contributor ships a broken site by pushing, and the red run
arrives six minutes later with nothing acting on it.

**Fix:** switch Pages to `build_type: workflow` and make the deploy job
`needs: test`; or require the `tests` check via branch protection. A settings
change plus ~15 lines of YAML, and the highest-yield item in this section.

### 3.2 `text-audit.mjs` is blind to two thirds of the prose
It counts prose in the **static HTML**. Most of this site's prose is written at
runtime, so the number rule 16 relies on is not the number Tim reads:

| page | audit says | actually rendered |
|---|---|---|
| index | 191 | 269 |
| stats | 269 | 345 |
| analysis | 263 | 343 |
| schedule | 210 | 317 |
| waivers | 141 | 318 |
| **trade** | **196** | **547** |
| summary | 143 | 237 |
| **total** | **1,413** | **2,376** |

**Trade's Best combo: 14 words to the tool, 267 rendered.** The instrument
written to catch the 2026-09-19 wordiness regression would miss it again today.
**Fix:** give it a rendered pass (linkedom is enough; it needs no browser), and
**add it to `npm test` with a ceiling** — `run-all.mjs:66` currently lists it in
`NOT_SUITES` and prints that it skipped it.

### 3.3 `draft.html` and `waivers.html` are booted by no suite
`tests/test-pages-render.mjs:22-24` lists six pages; `draft.html` is not one.
`js/draft-model.js` has 18 exports named in no test; `draft-page.js` (920
lines), `draft-sim.js` (296) and `draft-demo.js` (292) are untouched.

**Demonstrated:** an undefined import added to `js/draft-page.js` passes
`test-pages-render`, `nav-check`, `link-check` and `test-home`. **Fix:** add
`'draft.html', 'waivers.html', 'debug.html'` to that array. One line.

### 3.4 Assertions that pass whether the feature works or not
Worse than no test, because they buy false confidence. Both demonstrated by
deliberate breakage:

- **Three colour keys asserted by text only.** `fc-test.mjs:872`
  (`forecastKey`), `test-home.mjs:386` (`strengthKey`), `test-home.mjs:479`
  (`benchScaleKey`). All three are `<p hidden>` that `setKey()` unhides.
  **Demonstrated:** moved all three inside their closed `<details>` — a colour
  with its key behind a toggle, which rule 7 forbids — and both suites passed.
  `fc-test.mjs:1073` already does it right for `simKey`; copy that form.
- **`fc-test.mjs:880` is guarded by `if (shadedWin.length)` with no `else`.**
  **Demonstrated:** set the forecast's `minSpread` to `1e9` so nothing shades;
  fc-test **passed**, and the count silently moved 1004 → 992.

### 3.5 Nothing checks that assertion counts stop falling
`run-all.mjs:68-96` scrapes each suite's count and prints it; nothing compares
it to anything, which is why §3.4's silent 1004 → 992 was invisible. Drift is
already visible in the docs: `tests/README.md` says 13,300, `HANDOFF.md` says
12,089 in one place, the actual run is 13,302.

**Fix:** commit a `counts.json` of per-suite totals and fail when a count
**drops**. ~15 lines, and it converts every guarded block in the repo from a
silent skip into a loud failure.

### 3.6 `js/sortable.js` and `js/charts.js` have no suite
`sortable.js` — 197 lines, 4 exports, imported by no test — is load-bearing on
every scaled column site-wide, and its `data-v` text fallback (strips
`, + $ %` and spaces, **not** `▲`) caused a live defect on the Stats standings.
Because it is only tested as a page effect, **a scale added to a new page is
unguarded by construction.** A ~30-line unit suite pinning the fallback against
the glyphs `heat.js` can emit is the cheapest insurance here.
`js/charts.js` (967 lines, 4 exports) is likewise imported by no test.

### 3.7 Measured by nothing at all
Ranked by how badly each could regress unseen:
- **Contrast ratios** — see §4.1; the scale composes `rgba(…, 0.34)` over
  whatever is beneath it and nothing checks the result.
- **Page height** — `tools/measure-layout.mjs` covers it but needs Edge and is
  not in CI.
- **localStorage byte growth** — `test-store.mjs` covers eviction *order*, not
  total bytes per page load.
- **ESPN request count on a live load** — asserted `=== 0` for demo everywhere,
  no live budget. The stubbed live scenarios already collect `fetchCalls`.

### 3.8 What was tried and could NOT be broken
Recorded so nobody re-audits it: the per-week average rule (14 fail), bold
start weeks (6), the suggestion engine's direction (102), the colour
comparison groups (5, thinly), and `store.js`'s freshness clock (4) are all
genuinely falsifiable. A sweep of every selector/id/class/attribute across all
72 test files found **zero** remaining instances of the fc-test
"nothing has ever carried this" pattern, and every `if (!page.boot)` guard is
preceded by a real boot assertion.

---

## §4 — Readability

### 4.1 Colour-coded text on matching tints, below AA
Computed with sRGB relative luminance against real composited backgrounds.
Worst first; **4.5:1 is the floor for body text.**

| ratio | where | example |
|---|---|---|
| **2.95** | `stats #mainTable span.neg` on `heat-dn-4`; same on summary | `-16.8` |
| **3.23** | `.pos` green `#3ba55d` on `heat-up-4` — index, stats, trade, summary | `+202.1` |
| **3.26** | `--dim` `.sub`/`.unit` on `heat-up-4` — trade ×12 | `/wk`, `+30.1 total` |
| **3.40** | `.neg` on `heat-dn-3` ×3 pages | `-161.7` |
| **3.58** | `.pos` green on `heat-dn-4` (green text, red cell) — trade | `+0.1` |
| **3.61** | `--dim` on `heat-dn-4` — waivers ×16 | `5.0 ▼` |
| **3.66** | `analysis #overviewTable span.zmark` on `st-ir` | `IR` |
| **4.45** | **`.neg` `#e0525f` on a plain zebra row — h2h ×24, stats ×20** | every negative number |

That last row is systemic: `--err` misses AA **before** any tint, which is why
it collapses to 2.95 once one is applied. **Fix:** on a tinted cell let the
tint own the sign and drop `.pos`/`.neg` to `--text`; or lighten `--err` to
~`#ef7079` and the `.pos` green to ~`#56c97a`.

### 4.2 On a phone, the answer is off-screen
At 390px, first-screen columns vs hidden ones:
- ~~**`trade #tradeTable`** (1,124px in a 360px scroller): shows Manager, Deal,
  You send. **Hides You get, Your lineup, You gain, He gains, ESPN** — the
  whole answer.~~ **Done 2026-09-21:** the goal column (the rank key) is now
  second, beside Manager, and is on the first screen at 390px.
- **`schedule #simTable`** (683px): shows Team, Proj. wins, Avg place, Most
  likely. **Hides Playoffs %, Bye %, 1st in table %, Title %, Last %.**
- **`waivers #takenTable`** (557px): shows Player, Pos, Tm, Owner. **Hides Avg
  and every week column** — which its own lede promises.

This is distinct from "wide tables scroll sideways by design": here the first
screen is labels and the answer is past the fold. **Fix:** move `You gain` to
column 3 (it already sorts by it), `Title %`/`Playoffs %` left of `Most
likely`, and `Avg` before `Owner`.

### 4.3 Instruction text painted in a border colour
| ratio | where | text |
|---|---|---|
| **1.69** | `analysis.html:494` `.pick-line .pick-idle` → `--line-2` | "Hover or tap a number to name the player." |
| **1.69** | `trade.html:736` `.cu-preview .muted` → `--line-2` | "Tick who moves on each side." |
| **1.69** | `analysis.html:671` `.lg-mark.faint` | the `—` / `·` legend swatches |
| **1.16** | `schedule.html:93` `.vs { color: var(--line) }` | the `–` between matchup sides |
| **1.20** | `schedule.html:117` `.h2h td.self` | the `·` on the diagonal |

The first two are the **only** instruction their control has. Fix to `--dim`
(5.6:1 on panel). The last two are decorative — his call.

### 4.4 Density
- **Best combo is 1,430px on a phone / 267 rendered words**, and prints a
  second, structurally identical packing — same boilerplate verbatim, same
  two-sentence colour key — purely to conclude "the one above is the one to
  make". **Fix:** print the winner, put the alternative behind a toggle, say
  the comparison in one line. ~700px and ~120 words.
- **The four content-free Data source panels total 832px at 390px** — stats
  200px/94% frame, analysis 146/91%, summary 248/90%, index 238/87%. Three
  quarters of a phone screen for a repeated two-button toggle. Trade's (571px)
  **earns its place** — it carries the team, measure and week pickers. This is
  the standing open question, now with a number on it.
- **Frame is 28% site-wide at 390px**, not the third an earlier audit reported
  — but **analysis.html is 39%** (1,653px of 4,189px). Worst panels: "All
  teams · week 13" 819px of which 468px (57%) is frame for 304px of table;
  "Who to start" 694px/56% frame; schedule "Results" 438px/55%.
- **The keys on analysis are 596px on one phone page** (14% of the document):
  `#overviewLegend` 199px/56 words, `#seasonLegend` 199px/48, `#startersLegend`
  153px/40. The clause carrying the weight is `HEAT_CUES_KEY`
  (`js/analysis-page.js:268`) — mechanics, not meaning, repeated on three
  panels, and rule 16 sends exactly that behind the toggle. The three facts
  rule 16 keeps visible (inverted, refused, warnings) are not in it.
- **`waivers.html` breaks the house pattern** — a legend **above** the table
  and a second key below it. Every other panel puts the key after the table.

### 4.5 Two more
- **Injury red and "low number" red are the same red** on
  `analysis #overviewTable`'s bench columns. The exclusion of those cells from
  the scale is right (they are background shorthands); the **hue collision** is
  not recorded anywhere. Give the injury state a different channel — a left
  border, a hatch, or `--warn`.
- **Tap targets not in the logged four:** `trade.html label.cu-man` is
  **332×34px ×32** and is the only way to build a custom trade;
  `div.conn > input.conn-input` is **36px** on all seven pages. Both want
  `min-height: 44px` under `(hover: none)`. *Not* defects, and not to be
  reported as such: `label.wk-label`, `div.form-select > label`, `span.sr-only`.

### 4.6 Healthy — do not re-audit
No sideways document scroll at 390px on any page (`docScrollWidth === 390`,
zero spill elements); the frozen first column works on every wide table; plain
body text passes everywhere (`--dim` on `--panel` is 5.6:1) and the "four of
five cells in secondary grey" complaint has no surviving instance; the scale's
**weight** channel survives everything that erases the tint; `tr.picked` and
`tbody.split` no longer erase it. `data-v` is emitted at every heat-cell site
checked. `optimalLineup`'s `used` Set is keyed on object identity, so
`projection.js`'s playerId-free pool is safe. All three `SEASON_GAMES` copies
are 17. `standingsKey`'s `1e-8` tiebreak is safe to ~80,000 points.

---

## §5 — December, and what happens then

HANDOFF's list is **wrong in two places and short in two others.** Verified
against an all-played 14-week league:

- **`index.html`** — `currentWeek` (`js/home-page.js:494-499`) scans only
  `schedule.weeks`, returns 14. Reads "Week 14 of 14", picker offers 1–14,
  every card a final score. His playoff matchup appears nowhere. **Confirmed.**
- **`schedule.html`** — picker tops out at 14; the simulation blanks at
  `js/schedule-page.js:2534` with "nothing left to simulate" **while**
  `capture.simulationInputs` hands back a complete `playoff: {teams:6,
  weeks:[15,16,17]}` and `forecast.simulateSeason` will run a bracket with
  `games: []` quite happily. **The fix is the bail condition, not the engine.**
- **`summary.html`** — not on HANDOFF's list and should be.
  `js/summary-page.js:464` returns before reading anything once no regular week
  remains, and `:830` prints "The regular season is complete". The group-chat
  chart is a final table for the whole of December.
- **`analysis.html`** — also not listed. The week picker (`:1096`) is
  `state.weeks`, so the `A week` grid and roster detail can never reach 15–17,
  and `openingWeek()` (`:1044`) lands on week 14 unlabelled. "Season by week"
  and "Who to start" **do** run 15–17 via `spanWeeks()` (`:535`).
- **`waivers.html` is FINE** — `currentWeekOf` (`:601`) walks into the bracket
  deliberately. So HANDOFF's "the Players page and Who to start stop at the
  last regular week" is **false**.
- **`trade.html`** refuses to price from week 15 (`weeklySpan()`,
  `js/trade-page.js:412`, is regular-season-only). Defensible — most leagues
  lock trades — but it is an inherited assumption, not a decision.

Also: **`buildProjection`'s note names a contiguous week range it may not have
read** (`js/capture.js:339`) — "weeks 3 to 12" under a strength averaged over
eleven of them when ESPN refused one. Trade and Players both name their refused
weeks; this does not.

---

## §6 — Build / delete (product)

Ordered by value for effort. The governing constraint: **this site complements
ESPN, it does not replace it.**

1. **"Start X over Y, and here is what it is worth."** Both halves exist and
   nothing joins them. `bestLineupLine()` (`js/analysis-page.js:2147`) already
   renders "start A over B, +2.4" — but only inside Roster detail, four panels
   down, behind a team and week picker. Home already computes *both* numbers
   (its card's Proj is the lineup **as set**; its win chance runs
   `optimalLineup` over the whole roster) and never names the gap. Move the
   line to Home, and convert points to the decision with
   `winProbability(mine + gain, oppProj, sigma) − winProbability(mine, oppProj,
   sigma)` — σ is already calibrated on his league. **A 2-point gain is nothing
   in a blowout and everything in a coin flip, and no page distinguishes those.**
   ESPN shows per-player projections but does not solve the assignment, which
   is where the FLEX and two-deep swaps live.
2. **"Is this a must-win?"** — playoff odds if you win vs if you lose.
   `forecast.simulateSeason` already takes `banked` and `games` separately and
   `capture.simulationInputs` assembles both, so this is two extra sim runs
   (the panel already offers 100,000 at ~1.4s). Extends trivially to ranking
   his remaining fixtures by swing.
3. **Delete the invented `STARTABLE` table** — `js/waivers-page.js:1467`,
   `{QB:17, RB:12, WR:12, TE:9, DST:7, K:9}` — and use `floor.positionFloors`.
   It is exactly the "table of a kicker is worth 7" that `js/floor.js` was
   built to refuse, and the pool is already in `state.pool`, so it costs **zero
   requests**. Then flag his own bench players projecting below the floor: that
   is his candidate feature #1, now nearly free.
4. **Put the week's worst bench call in the group-chat image.**
   `benchReport`/`bestMiss` (`js/home-page.js:440`) already computes it for
   every team. It is a **fact**, needs no explanation, and is the funniest
   number the site produces. Also free: the week's luckiest win.
5. **Delete Home's standings panel.** Team / W-L / PF / PA / Diff is an ESPN
   screen, and he deleted the Schedule one for exactly this reason. (Stats'
   "Standings & season totals" is a different panel — luck, skill, S+L are not
   on ESPN — and **stays**.) It also frees half a `panel-row` on the page
   proposal 1 wants to live on.
6. **Delete Schedule's Results panel** — ESPN's scoreboard with a sort. The
   Week matchups panel above already carries the week plus win %. **Keep Head
   to head**: a full pairing grid is not one ESPN screen.
7. **Two free facts nobody needs to ask Tim about.**
   `settings.tradeSettings.deadlineDate` and `rosterSettings` are already
   fetched (`fetchSchedule` rides `mSettings`; `js/espn.js:580` reads
   `rosterSettings`). So both open questions — IR slots, trade deadline — are a
   field read away. A line at the top of `trade.html` ("a trade must be
   **accepted** before 18 November — 12 days left") is ~4 lines and prevents
   the one mistake that costs a season's trading.
8. **Demote Best combo** — argued, not asserted. It is the most expensive
   surface per unit of realism on the site, it already shipped the floors bug
   that recommended a worse trade than the row above it, and its output needs
   two or three other humans to agree simultaneously while ESPN reviews each
   leg separately. A line under the finder ("these three offers don't overlap")
   would carry most of the value.

### Considered and rejected — do not re-propose
- **Injury-aware trade pricing.** Needs a per-player probability of missing a
  week; ESPN publishes a designation, not a probability. The only build is a
  hardcoded table of positional miss rates — the invented number `js/floor.js`
  exists to refuse — moving every price on the site by an amount nobody can
  check.
- **D/ST streaming by Vegas implied totals.** Needs an odds feed the site
  cannot fetch. The weaker version is **already built** — the wire drops your
  own worst man into the list and shades every week that beats him.
- **The near-tie variance helper.** The research prices it at +0.4 percentage
  points of win probability, and it first needs the stat-id → scoring-weight
  mapping finished. Proposal 1 delivers several times that for a tenth of the
  work. Park permanently.
- **Buy-low/sell-high from usage.** Best-supported idea in the research file
  and the one most worth wanting. Needs weekly target/snap share plus a
  stickiness model; ESPN's own player pages already show the raw numbers, so
  the value is entirely in the judgement, and the judgement is a research
  project rather than a feature. If he ever wants one big build, this is it.
- **Three-way trade chains.** ESPN blocks three-team trades outright.
- **A projection-drift chart.** Cannot pay yet — two weeks recorded, and the
  archive holds team totals only (§2.3). Build the capture now, the chart in
  December.

---

## Suggested first pass, and how to split it

Four disjoint file sets, if running agents in parallel:

| Agent | Owns | Items |
|---|---|---|
| **A** | `css/app.css`, `HANDOFF.md` | §1.1 (and its rule-14 correction), §4.1, §4.3 |
| **B** | `js/analysis-page.js`, `analysis.html`, `tests/an-test.mjs` | §1.2, §4.4 (analysis keys), §5 (analysis picker) |
| **C** | `js/capture.js`, `js/home-page.js`, `js/schedule-page.js`, `js/stats-page.js`, `js/summary-page.js`, their tests | §1.3, §1.4, §1.5, §1.6, §2.1, §2.2, §5 |
| **D** | `tests/*` (not those above), `.github/workflows/`, `run-all.mjs` | §3 entire |

§1.1 is one word in three places and should go first regardless — it is the
largest visible change on the site for the smallest diff, and several §4
findings interact with it (the confetti judgement in particular may resolve
once the tints actually draw).
