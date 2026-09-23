# The Trade page — display and view

Read-only review, 2026-09-23, against `main` @ `1c086b0`. **Display half only** —
another agent covers the maths. Tim's ask (2026-09-22): *"really analyze our trade
section and make a plan on how we might want to change it to make it better both in
calculation and in display and view."*

Nothing in the repo was changed except this file.

## How it was measured

Everything below is a measurement, not an impression. The page was served
(`python -m http.server 8731`) and driven in a real browser:

- **Phone** — `phone-view.mjs`, WebKit (Safari's engine), `--device "iPhone 12"`
  (390 x 844; usable viewport **390 x 664**), demo data, waited **280 s** so the
  status line had stopped saying *"playing each offer out"*.
- **Laptop** — same tool, `--desktop --engine chrome` (1440 x 900).
- **Layout** — `node tools/measure-layout.mjs --pages trade.html --widths 1500,390 --settle-max 330000 --no-touch` (headless Edge, device-metrics override).
- **Prose** — `node tests/text-audit.mjs trade.html` (static) **and** a DOM walk of
  the rendered page, because text-audit is blind to everything JavaScript writes
  (AUDIT §3.2 — confirmed below with a number).

Screenshots live in the session scratchpad and are **temporary**; paths are given
inline so they can be opened now.

```
SHOTS = C:\Users\timha\AppData\Local\Temp\claude\c--Users-timha-OneDrive-Desktop-my-website-Code-Projects-Fantasy-Football\b97ed933-9ed7-48d2-95c7-ff5ef93b9909\scratchpad\shots\
```

One caveat on the phone shots: on localhost with no network, `js/site-status.js`
draws a red **"Part of this page failed to load"** banner (a Firebase auth failure).
That banner is an artefact of the harness, and it costs 80 px — the page is
**6,091 px** without it and 6,171 px with it. All numbers below use 6,091.

---

## 1. What the page looks like on an iPhone, panel by panel

At 390 px the document is **6,091 px tall — 9.2 phone screens.** Panel by panel
(top edge / height / share of the page):

| Block | top | height | share |
|---|---:|---:|---:|
| Header + two rows of nav pills | 0 | ~230 | 3.8% |
| Connection bar (`#connBar`) + `h1` + sub | 230 | ~270 | 4.4% |
| **Data source** | 503 | **696** | 11.4% |
| **Trades that help both squads** | 1,210 | **987** | 16.2% |
| **Best combo** | 2,209 | **867** | 14.2% |
| **Depth map** | 3,088 | **609** | 10.0% |
| **Custom trades** | 3,708 | **2,281** | **37.4%** |
| Footer | 5,989 | ~100 | 1.6% |

`measure-layout` agrees within its own settle window (it stops polling at ~50 s,
before the goal simulation finishes growing the rows): **5,694 px @ 390 px,
3,982 px @ 1500 px**; `#customPanel` **1,927 px @ 390** and 1,162 @ 1500;
`#comboPanel` 829 / 611; `#tradeWrap` 558 (the `62dvh` cap) / 630; `#depthWrap`
304 / 319. No sideways document scroll, no spills, no clipped elements at either
width — the frame is sound; it is the *content budget* that is wrong.

**Screen 1** (`SHOTS\ph-01-top.png`) contains: brand, seven nav pills on two rows,
the connection bar ("Not connected. A phone cannot install the bridge extension…"
plus a League ID field, Connect, and Sign in with Google), the `h1` **Trade DEMO**,
and the words "DATA SOURCE / Pick the league, your team, and how players are
valued." The label **Your goal** appears at y≈664 — exactly the fold. **Nothing on
screen 1 is about a trade.**

**Screen 2–3** (`SHOTS\ph-02-finder.png`): the rest of Data source (goal toggle,
source toggle, team, Value on, Week, a full-width "Rebuild the sample weeks —
generated, no requests" button that wraps to two lines, a status line and a
`<details>`), then the finder's heading, its lede, and the **shape filter — 136 px
tall, two columns of 165.5 px, five buttons, so a 2 x 3 grid with a visibly empty
sixth cell** — then the Manager select and the "2 for 1 = send two, get one better
back" hint.

**The first recommendation.** The first `#tradeTable` row's top edge is at
**y = 1,614 px**. With a 664 px viewport its top edge first appears at
**scrollY ≈ 950 px** and the whole row is on screen at **scrollY ≈ 1,040 px** —
**about 1.6 phone screens of scrolling, past two complete panels of chrome,
before a single offer is readable.** (`SHOTS\ph-03-finderfoot.png`.)

Then the finder itself is an inner scroller: rows are **90 px** tall, there are
**40** of them = 3,600 px of table inside a **412 px** window (`62dvh` of 664).
Tim scrolls 8.7 screens *inside the panel* to reach the last offer.

**Best combo** (`SHOTS\ph-04-combo.png`), **Depth map** (`SHOTS\ph-05-depth.png`),
**Custom trades** (`SHOTS\ph-06-custom.png`, `ph-07-customfoot.png`) follow. Custom
trades is the single biggest thing on the page **while completely empty** — two
17-man rosters stacked, no deal built, no trade saved.

### How much of the finder is off-screen at 390 px

The table is **1,225 px wide in a 360 px scroller — 29.4 % visible, 865 px (70.6 %)
past the right edge.** Measured column offsets and widths:

| col | x | width | on the first screen? |
|---|---:|---:|---|
| Manager (frozen) | 13 | 72 | yes |
| Title chance | 85 | 122 | yes |
| Deal (shape pill + "Week by week") | 207 | 106 | yes |
| You send | 314 | 145 | **46 px of 145 — 32 %** |
| You get | 458 | 143 | no |
| Your lineup, a week | 601 | 129 | no |
| You gain a week (weeks 2–16) | 730 | 184 | no |
| He gains a week (weeks 2–16) | 914 | 182 | no |
| ESPN | 1,096 | 142 | no |

**What he loses by not scrolling sideways is the trade itself.** He can see *who*
to talk to and *how much his title chance moves*; he cannot see **which players are
in the deal**, what his lineup becomes, what either side gains in points, or the
ESPN link. A first name and a third of a surname is all that survives of "You send".

AUDIT §4.2 marked this "Done 2026-09-21" because the goal column was moved to
position 2. That fixed *the ranking key*, which was the right first move. It did
not fix the panel: the answer to "what deal should I offer?" is still four columns
away.

### Desktop, for contrast (`SHOTS\dt-01-top.png`)

At 1440 x 900 the document is 4,012 px. Data source 295, finder 921, combo 611,
depth 558, custom 1,162. The finder table is **1,408 px in a 1,398 px wrapper
(scrollWidth 1,444)** — so even on a laptop it scrolls ~46 px and the ESPN column
is cut ("No ESPN league in de…"). At Tim's 1500 px it fits (`#tradeWrap` 1,458).
The first offer row sits at y≈780 of a 900 px window: **on a laptop the answer is
at the very bottom of the fold; on a phone it is 1.6 screens down.**

---

## 2. Is the answer obvious?

No. The page's job is *"here is the trade to offer, and why"*. What the top of the
screen actually says, in order, is:

1. *(demo/localhost)* "Part of this page failed to load."
2. "Not connected. A phone cannot install the bridge extension…" + a League ID
   field + Connect + Sign in with Google.
3. "Trade **DEMO**".
4. "Generated sample rosters so you can see the layout with a full league in it."
5. "**Data source.** Pick the league, your team, and how players are valued."
6. Five controls.

Six things compete, and **not one of them is a trade**. The single most valuable
sentence the page can write — *"Offer Watkins Hathaway + Dellinger for Mallory:
your title chance goes 5.9 % → 10.3 %, and there is an 84 % chance he says yes"* —
exists in the data at y=1,614 and is never said as a sentence anywhere.

Two more things blunt the answer even once you reach it:

- **The rank key and the eye-catching number are different numbers.** `td.goal-cell`
  is 15 px bold green; `td.gain` is 14 px bold green. They are 645 px apart in the
  scroller and **never on screen together at 390 px**. The list is ordered by the
  first; the second is the one that looks like the point.
- **For the first few minutes there is no answer at all.** `runGoalRank` plays
  every offer through 10,000 simulated seasons, ~40 ms at a time. Measured on this
  machine: **16 of 40 done at 75 s; finished by 280 s.** Until it finishes every
  goal cell reads a dim "…", the table is ordered **by points, not by the goal**,
  and nothing on screen says the order is about to change. The status line does
  say "playing each offer out … (16 of 40)", which is honest, but it is under the
  table, off the bottom of a phone screen.

---

## 3. Too many words?

**Rendered** prose in view, per panel, at 390 px (a DOM walk of `p`, `.lede`,
`.panel-note`, `.combo-head`, `.combo-lineup`, `.combo-one`, `.ctl-hint`,
`.heat-key`, `.cu-head`, `.empty`, `.cu-preview`, control labels; `<details>`
counted separately):

| panel | shown (rendered) | shown (`text-audit`) | tucked (rendered) |
|---|---:|---:|---:|
| Data source | 32 | 24 | 219 |
| Trades that help both squads | 93 | 92 | 1,200 |
| **Best combo** | **134** | **14** | 462 |
| Depth map | 21 | 21 | 622 |
| Custom trades | 154 | 65 | 856 |
| **total** | **434** | **216** | **3,359** |

So `text-audit.mjs trade.html` sees **50 % of the words a reader sees**, and on Best
combo it sees **10 %** (14 of 134). That is AUDIT §3.2, with a number on it. For
scale, across the whole site text-audit reports 1,375 static words; trade.html's
216 is fourth of seven — but **rendered, trade.html at 434 is comfortably the
wordiest page on the site.**

### Sentences that earn their place

- The finder's **status line** ("40 offers · every shape up to two for two · valued
  on every remaining week · **ranked by your title chance**, allowing for how likely
  he is to say yes") — it is the only place the order is explained. Keep.
- The Best combo **headline** ("+5.0 a week … from 3 trades" and "Your title chance
  +9.5 % (5.9 % → 15.5 % · all 3 managers say yes: 66 %)"). Keep, and promote.
- Every **warning** and **refusal** (`#costWarn`, `#depthWarn`, `#cuWarn`,
  `emptyMessage`) — rule 16 keeps these visible. Keep.
- The suggestion badge in the custom box (`#7 ALSO SEND — HE GOES NEGATIVE / then
  you +4.6 · him −6.4 /wk`) — four cues, no colour dependence, reads in greyscale.
  This is the best-written thing on the page (`SHOTS\p2-03-ticked.png`).

### Sentences that repeat each other

| duplication | cost at 390 px |
|---|---:|
| The heat key ("Colour compares each figure only with…", 28 words) is printed **four times** on one phone page: finder, Best combo, custom lists, custom saved table | ~57 px each, **~230 px** |
| "Tick who moves on each side." appears **twice within 120 px** — `#cuPreview` and inside `#cuEmpty` ("No custom trades saved yet. Tick who moves on each side.") | ~40 px |
| Best combo says *don't add the gains up* twice above the table: the 45-word `naive` lead paragraph and the 30-word `.combo-one` paragraph | ~190 px |
| The finder lede "best for your goal first" and the status line "ranked by your title chance" say one thing twice | ~20 px |
| "valued on every remaining week" (status) restates the **Value on** control 700 px above it | ~20 px |
| `GAIN_HEAD` prints "(weeks 2–16)" in **both** gain headers, in the finder and again in every combo table | 208 px + 205 px of column width on desktop |

**~500 px of phone page, and two of the widest columns on the laptop, spent saying
things twice.**

### What belongs behind "How this works"

- The **shape hint** ("2 for 1 = send two, get one better back. 1 for 2 is the
  reverse: send one, get two.") — it explains a control, and it is already said by
  the button faces. Move to the toggle, or show it only when a non-default shape
  is chosen.
- The heat key, everywhere except **once** under the first tinted table. Rule 16
  says a key under a coloured table is one sentence; it does not say four tables
  need four copies of the same sentence.
- The `naive` paragraph in Best combo. The arithmetic it carries (+6.0 naive vs
  +5.0 actual) belongs *under* the headline as a half-line ("adding them up would
  have said +6.0"), not above it as a 45-word lead.
- Best combo's `.combo-one` paragraph ("One number, not 3 numbers…") — the
  headline's own words can carry it ("**+5.0 a week** from **3 trades**, priced as
  one move").

Nothing above proposes *deleting* an explanation — rule 7 stands. Every word moves
one tap away, into the `<details>` that already exists in each panel.

---

## 4. The columns

Today, in order: **Manager · Title chance · Deal · You send · You get · Your
lineup, a week · You gain a week (weeks 2–16) · He gains a week (weeks 2–16) ·
ESPN.** Nine columns, 1,225 px at 390 px and 1,408 px at 1440 px.

**They are not the right columns at 390 px**, for three reasons.

1. **The deal is missing from the first screen.** "You send" and "You get" are two
   separate 145/143 px columns because a name and its number must fit on one line
   (`#tradeTable td.pkg { min-width: 132px }` on a phone). Together they are 288 px
   — 80 % of the visible window — to say a thing that fits in one line as a
   sentence: `OUT Hathaway RB · Dellinger TE -> IN Mallory RB`.
2. **"Your lineup, a week" earns nothing.** It prints `109.7 → 112.4 /wk` with
   `1645.7 → 1685.5 total` under it. The difference between those two numbers *is*
   the "You gain" column beside it, and nobody compares 109.7 across rows — it is
   the same figure on every row for the same squad. 129 px at 390, 146 px at 1440.
3. **The two gain headers are the two widest columns on the laptop** (208 px and
   205 px) and they are wide **because of their headers**, not their contents:
   `GAIN_HEAD('You gain', …)` renders "You gain a week (weeks 2–16)", 28
   characters, wrapping to three lines at 390 px.

### Does the goal column read clearly next to "you gain"/"he gains"?

No, and for four separate reasons.

- **They are never both on screen at 390 px.** Title chance ends at x=207; You gain
  starts at x=730. 523 px apart.
- **They are in different units and the same colour.** `+4.3%` (percentage points
  of title chance) and `+2.7/wk` (points of projection) are both `--accent` green,
  both bold, 15 px and 14 px.
- **A negative "He gains" is painted green.** `offerRow` writes
  `class="their-gain pos${theirs.cls}"` and `class="gain pos${mine.cls}"` — the
  class `pos` is **unconditional**, and `.pos { color: var(--accent) }`. Measured
  on the live page: of the **40 offers on screen, 40 have `data-v < 0` in "He
  gains" and 0 have `data-v > 0`**; every one of them computes to
  `rgb(59, 165, 93)`. In Best combo, where every partner loses, the column reads
  "−1.7/wk", "−1.9/wk", "−1.5/wk" **in green** (`SHOTS\d2-01-combo.png`).
  `goalCellHtml` already does this correctly (`pos`/`neg`/`''` on the sign); the
  row builder does not.
- **Under "Don't finish last", green means *smaller*.** Loaded with
  `ff.prefs={"trade.goal":"last"}`, the header becomes "Chance of last", the span
  becomes weeks 2–13, and the top row's goal cell reads **"−6.0% / 18.8% → 12.9% ·
  93% yes" in green** — correctly, because down is good — while "You gain +2.3/wk"
  two columns over is green because up is good. One page, one green, two
  directions, nothing on screen reconciling them (`SHOTS\g-01-finder.png`).

Also worth noting: the visible colour key says "Colour compares each figure only
with the other offers in the same column" — but the goal column is coloured by
**sign**, not by a heat scale, and it is the leftmost coloured column under that
key.

### What I would drop, merge or move (options, not a decision)

- **Merge** `You send` + `You get` into one `Deal` cell: `2 for 1 · OUT Hathaway RB
  14.2 · Dellinger TE 7.1 -> IN Mallory RB 17.7`. Saves ~180 px and puts the actual
  trade beside the chance on the first screen.
- **Drop** `Your lineup, a week` from the table; it already lives in the pop-up's
  Per-week row. −129 px.
- **Drop** `ESPN` at ≤760 px; it is one link per row in a column nobody reaches by
  thumb, and the pop-up carries the same link with a proper explanation. −142 px.
  (In demo it is 40 rows of dead text: "No ESPN league in demo".)
- **Shorten** the gain headers to `You gain /wk` and `He gains /wk`, with
  "(weeks 2–16)" said once in the key. −~200 px on the laptop.
- Those four take the table from **1,225 px to ~620 px** at 390 px — so Manager,
  Title chance, the deal and "You gain" all fit in 360 px with no sideways scroll.

Two variants for Tim to choose between:

- **(a) Table, narrowed** — as above. Keeps sorting, keeps the site's table idiom.
- **(b) Cards under 760 px** — one offer per card: manager + chance headline, the
  deal on one line, gains on a second line, a tap target for the pop-up. Loses
  column sorting on the phone (which needs a sideways scroll to use anyway). Costs
  more to build and is the bigger visual departure — Tim's call.

---

## 5. The other panels

### Best combo — worth its space; the lead-in is not

Measured: **867 px, 14.2 % of the phone page, 134 rendered words** (AUDIT §4.4
measured 1,430 px / 267 words — **it has already been halved**). In this demo the
"most trades possible" alternative did **not** render at all (`.combo-alt` absent;
`mostIsBest`), so §4.4's "prints a second, structurally identical packing" is a
conditional cost, not a standing one.

What it buys: **+9.5 % title chance (5.9 -> 15.5) at 66 % all-say-yes** against the
best single offer's **+4.3 % at 84 %**. On Tim's own ranking metric (change in
chance x P(yes)) that is **6.3 vs 3.6 — 1.7x the best row in the finder.** It is
the most valuable number on the page.

Its problems are ordering and honesty, not existence:

- The **45-word `naive` paragraph comes before the headline.** On a phone you read
  "Adding the offers' own gains would have given +6.0 a week…" for four lines
  before you reach "+5.0 a week from 3 trades" (`SHOTS\ph-04-combo.png`).
- **Nothing says what happens if one leg is refused.** `comboGoal` multiplies the
  three partners' accept chances into 66 % and prices the slate as a single roster
  change. ESPN reviews each leg separately, so there is a 34 % branch in which Tim
  ends up with a roster the panel never priced, and no line on screen acknowledges
  it.
- Duplicated with the finder: the row builder, the "He gains" heat key, the
  "(weeks 2–16)" header. Three of the four offers in the combo table are also rows
  in the finder above, drawn identically.

### Depth map — the best value per pixel on the page

609 px (10 %), 21 rendered words, 487 px of table in a 360 px scroller — only
127 px (26 %) hidden, and what is hidden is DST, K and Lineup
(`SHOTS\ph-05-depth.png`). It answers a question nothing else does ("who is thin
where I am deep") and it is the one panel whose lede tells you *how* to read it.
Keep as is.

One inconsistency: its tints are flat `#16311f` / `#33151a` applied to the top
three and bottom three at each position — the **same hues as the site's +/-1 SD
heat scale but a different rule**. A reader who has learned the finder's scale two
panels up will read these wrong. The visible key does not say so; only the
`<details>` does. (Rule 14 is "one red/green scale"; this is a declared exception
that is not declared where it is read.)

### Custom trades — 37 % of the page, and empty

**2,281 px at 390 px (2,541 px once one man is ticked), 154 rendered words, 856
tucked.** It is the largest thing on the page and, on a first visit, it contains
nothing but two lists of other people's players.

- On a phone the two rosters **stack**, and the right-hand list is **mirrored**
  (`.cu-man.mirror` emits the cells reversed: value · pos · name · slot · checkbox).
  Side by side on a laptop that mirroring is genuinely good — the two value columns
  face each other down the middle (`SHOTS\d2-03-custom.png`). Stacked on a phone it
  is **two opposite reading orders one above the other**, and the second list's
  checkboxes are on the right while the first list's are on the left
  (`SHOTS\ph-06-custom.png`).
- On a laptop the third column (`#cuInline`) is **~630 px x ~400 px of empty panel**
  carrying one sentence: "Tick who moves on either side and this deal's
  week-by-week breakdown appears here."
- "Tick who moves on each side." is painted `--line-2` (`rgb(57,65,79)`) — measured
  on the live page — which is AUDIT §4.3's **1.69:1**, still unfixed. It is
  unreadable in the screenshot (`SHOTS\ph-07-customfoot.png`) and it is the only
  instruction the control has.
- The saved-trades table (`#cuTable`) has **ten** columns — the finder's nine plus
  Remove — so it will be wider than 1,225 px at 390 px the moment it has a row.

What it duplicates: the finder's row builder, the finder's heat key (a fourth
copy), the "figure beside each man is a different arithmetic" paragraph (said in
the finder's note, the pop-up's `sr-only` note, the combo's note **and** here).

### The deal pop-up — the best content, badly led

Phone: `390 x 584` sheet over a **1,986 px** body — you see **29 %**
(`SHOTS\p3-01-deal.png`). Laptop: `1100 x 774` over 985 px
(`SHOTS\d2-04-deal.png`).

- **The packages run together with no spaces:** *"Roscoe MarchettiRB7.6/wkTyrese
  DellingerTE7.1/wk"*. Cause: `#tradeTable td.pkg .man { display: block }` and
  `.pkg .pp { margin: 0 4px }` are scoped to `.pkg`, and `sideHtml` renders into
  `.deal-side`, which is not. This is the **first line you read when you open a
  deal**, at both widths.
- **The churn line is 10 lines of red and green prose** (~90 words) and it prints
  **season totals** among per-week figures: "Tyrese Draeger WR **164.1** over 11
  weeks" directly under "Tyrese Draeger**WR14.9/wk**" — the same man, two
  presentations, four lines apart. Rule 10 says per week first, total as the
  sub-number. The names are `--err` red, AUDIT §4.1's systemic 4.45:1 row.
- **On a phone the header block is 1,370 px of the 1,986 px body**, so the first
  *priced* week (week 2) sits at the very bottom edge of the sheet, under a played
  week and a "Played — not counted" divider.
- **The week table is cut off on the right at 390 px**: the header reads
  "DIFFERENC" and the values "+5.2" are clipped. The Difference column is the point
  of the table.
- **Tapping a week does almost nothing visible on a phone.** `#dealWeek` renders
  *after* the whole 20-row week table — roughly 1,500 px below the tapped row. The
  row tints and that is all Tim sees (`SHOTS\p3-02-dealweek.png`). On a laptop the
  same panel is excellent: sticky, OUT/IN pills, only the changed row emphasised
  (`SHOTS\d2-05-dealweek.png`) — but it is **empty until a week is hovered**, so
  half a 1,100 px card starts blank.

### Saved rows

Not exercised (none saved), but by construction they are `offerRow` output in a
ten-column table. Everything said about the finder's columns applies, plus one
more column.

### The player card — leave it alone

`SHOTS\p2-04-card.png`. 326 px sheet, two rows of weeks, bold + underline for
"he starts", `PO` on week 14, an `ACT` row, one big green action and a Close.
It is the clearest surface on the page and the model the rest should copy: **one
question, one screen, no prose.**

---

## 6. Small defects

| # | defect | evidence |
|---|---|---|
| D1 | **Negative "He gains" painted green.** `offerRow` emits `pos` unconditionally on both gain cells. | 40/40 rows negative, all `rgb(59,165,93)`; `SHOTS\d2-01-combo.png` |
| D2 | **The panel's title and lede are false.** "Trades that help both squads" / "Every swap that raises both starting lineups" — since the goal-weighted search landed (partner may lose up to 2/wk, `THEIR_MIN_PER_WEEK`), **every one of the 40 offers makes the other manager worse.** `emptyMessage()` carries the same stale claim ("No trade here makes both squads better"). The `<details>` note is already correct; the headline was never updated. | measured: 40 of 40 negative |
| D3 | **Pop-up packages run together**, no space between name, position and value; both men on one line. | `SHOTS\p3-01-deal.png`, `SHOTS\d2-04-deal.png` |
| D4 | **"Tick who moves on each side." at 1.69:1** (`--line-2`), the control's only instruction — AUDIT §4.3, still open. Printed twice. | measured `rgb(57,65,79)`; `SHOTS\ph-07-customfoot.png` |
| D5 | **The heat mark is orphaned** at the bottom of a tall gain cell, 2–3 lines below the number it qualifies (emitted after `.sub`, cell is `vertical-align: top`). It is channel 3 of "never colour alone" and it currently points at nothing. | `SHOTS\dt-01-top.png`, `SHOTS\d2-01-combo.png` |
| D6 | **`.sub` / `.unit` at `--dim` on `heat-up-4`** — AUDIT §4.1's 3.26:1 row, x12 on this page, still unfixed. | measured `rgb(139,147,161)` on a `heat-up-4` cell |
| D7 | **Shape filter is a 2 x 3 grid with an empty sixth cell**, 136 px tall. `trade.html:1077` pins `repeat(2, 1fr)`; the comment explains it was tuned for **four** buttons and a fifth ("2 for 2") was added later. Three columns give 3 + 2 and ~92 px. | measured `165.5px 165.5px`, 5 children, h=136 |
| D8 | **Week picker is live and inert.** The default measure is "Every remaining week"; the Week select beside it changes nothing until the measure is switched. | `SHOTS\dt-01-top.png` |
| D9 | **Deal pop-up's week table clips the Difference column at 390 px** ("DIFFERENC", "+5.2"). | `SHOTS\p3-01-deal.png` |
| D10 | **Churn line prints season totals among per-week figures** (164.1 vs 14.9/wk for the same man). Rule 10. | `SHOTS\p3-01-deal.png` |
| D11 | **Depth map's flat tints use the heat scale's hues under a different rule** (top/bottom 3 vs +/-1 SD); the visible key does not say so. | `SHOTS\ph-05-depth.png` |
| D12 | **Finder table still scrolls sideways at 1440 px** (1,408 px table, 1,398 px wrapper, scrollWidth 1,444) and clips the ESPN column. Fine at 1500. | measured |
| D13 | **Sticky `thead` (35 px, z-index 3) over a 412 px inner scroller.** Playwright could not click a data row scrolled under it, in three separate runs. *Needs a real-device check* — if it reproduces, a thumb aimed at the top of a scrolled row sorts the table instead of opening the deal. | step log: `FAILED click:#tradeTable tbody tr:first-child` x3 |
| D14 | **`#cuInline` is ~630 x 400 px of empty panel on a laptop**, holding one sentence, until a man is ticked. | `SHOTS\d2-03-custom.png` |
| D15 | **`.deal-detail` starts empty** — half of an 1,100 px card is blank until a week is hovered. | `SHOTS\d2-04-deal.png` |

**Not defects, and not to be re-reported:** `label.cu-man` now has
`min-height: 44px` under `(hover: none)` (trade.html:501) — AUDIT §4.5's complaint
is fixed. `measure-layout` reports **zero** spills and **zero** clipped elements at
390 and 1500; the frozen first column works; no sideways document scroll anywhere.

---

## On AUDIT §6.8 — "Demote Best combo"

> *"It is the most expensive surface per unit of realism on the site, it already
> shipped the floors bug that recommended a worse trade than the row above it, and
> its output needs two or three other humans to agree simultaneously while ESPN
> reviews each leg separately. A line under the finder ('these three offers don't
> overlap') would carry most of the value."*

**I disagree with the conclusion and agree with the diagnosis.** Evidence:

1. **The cost argument has already been paid down.** §6.8 was written against
   §4.4's measurement of **1,430 px / 267 words**. Today it is **867 px / 134
   rendered words** — 39 % smaller, 50 % fewer words — and in this demo the second
   packing it complained about **did not render at all** (`.combo-alt` absent).
   It is now the *third* biggest panel on the page, behind Custom trades (2,281 px)
   and the finder (987 px).
2. **The floors bug is fixed.** `bestCombo` took no `floors` option; it does now,
   the note says so, and `renderCombo` carries the sentence that keeps it honest
   (PROGRESS, AUDIT §1, 2026-09-19/21). That argument has expired.
3. **It is the most valuable number on the page.** +9.5 % title chance at 66 %
   all-yes = **6.3 expected points of title chance**, against the best single
   offer's +4.3 % at 84 % = **3.6**. Demoting the panel demotes the page's best
   answer by Tim's own stated metric ("rank by expected value, but add a good
   amount of leeway").
4. **The proposed substitute cannot carry the value.** "These three offers don't
   overlap" is precisely the sentence rule 11 exists to forbid — a reader told the
   offers don't overlap will add their gains. The demo proves why: adding them says
   **+6.0/wk**; priced as one move they are **+5.0/wk**, 17 % less. Only a panel
   that prices the slate once can say that.
5. **The simultaneity objection is real and unanswered.** `comboGoal` multiplies
   three accept chances into 66 % and prices one roster change. ESPN reviews each
   leg separately; there is a 34 % branch in which Tim holds a roster nobody
   priced, and **no line on screen mentions it.** This is the honest core of §6.8,
   and it is a wording fix, not a demotion.

**Recommendation:** keep the panel, fix its order and its honesty — headline
first, then the slate's chance, then the 45-word `naive` arithmetic compressed to
a half-line; add one visible sentence naming the sequencing risk ("all three have
to be accepted; if one is refused the other two are still worth +X — open each row
to price it alone"); and put the "most trades possible" alternative, when it
exists, behind a toggle. That is roughly the same effort §6.8's demotion would
cost and it keeps the 6.3 points.

---

## The plan, ranked by (value to Tim) / (effort)

Each item names the panel, the function and the change. **Tim decides visuals**,
so where taste is involved both options are given.

### Tier 1 — cheap and large

| # | change | where | size |
|---|---|---|---|
| **V1** | **Colour the two gain cells by their sign.** `offerRow` builds `class="gain pos…"` and `class="their-gain pos…"` unconditionally; make it `pos` / `neg` / none exactly as `goalCellHtml` already does. Fixes 40 green minus signs per render, in the finder, the combo and saved rows at once. | `js/trade-page.js` `offerRow()` | **cheap** |
| **V2** | **Retitle the finder to match what it now finds.** `h2` "Trades that help both squads" -> e.g. *"Trades ranked by your title chance"*; the lede -> *"Every swap that lifts your chance at the goal, best first. He may give up a little — how likely he is to accept is priced in. Tap a row for its weeks."*; and `emptyMessage()`'s "No trade here makes both squads better" -> the same framing. The `<details>` note is already correct. | `trade.html:1253-1254`, `emptyMessage()` | **cheap** |
| **V3** | **Un-scope two CSS rules so the pop-up's packages read.** Move `.man { display: block }` and `.pp { margin: 0 4px }` off `.pkg` (or add `.deal-side` to the selectors). A one-line fix to the first thing you read in every deal. | `trade.html` `<style>` | **cheap** |
| **V4** | **Put the heat mark beside the number, not under the sub-line.** In `offerRow`, emit the mark before the `.sub`. | `offerRow()`, `weeklyGainHtml()` | **cheap** |
| **V5** | **`--line-2` -> `--dim` for `.cu-preview .muted`**, and delete the duplicate instruction from `#cuEmpty` (keep one). AUDIT §4.3, open since 2026-09-20. | `trade.html` `<style>`, `renderCustomPreview()` | **cheap** |
| **V6** | **Print the heat key once.** Keep it under the finder's table; replace the other three copies (combo tables, custom lists, saved table) with nothing, and let each panel's existing `<details>` carry the thresholds it already carries. −~170 px of phone page. | `comboTableHtml()`, `renderCustomPickers()`, `renderCustomSaved()` | **cheap** |
| **V7** | **Three columns for the shape filter** (`repeat(3, 1fr)` -> 3 + 2, no hole, ~92 px instead of 136), or shorten "Any shape" to "Any" and let app.css's `auto-fit` do 4 + 1. | `trade.html:1077` | **cheap** |

### Tier 2 — medium effort, large payoff

| # | change | where | size |
|---|---|---|---|
| **V8** | **An answer block at the top of the page.** A new `<section>` between the `h1` and Data source: *"**Offer Watkins** — send Hathaway RB + Dellinger TE, get Mallory RB. Your title chance **5.9 % -> 10.3 % (+4.3 %)**, **84 %** he says yes."* plus two buttons (Week by week, Open in ESPN). ~200 px on a phone, above everything. While the simulation runs it says so in the same place ("playing 40 offers out — 16 of 40"), which is where that line belongs. Reads `state.search.offers[0]` and reuses `manLine`, `goalCellHtml`'s numbers and `espnCell`. **This is the single change that makes the page answer its own question.** | new `renderHeadline()` in `js/trade-page.js`, new markup in `trade.html` | **medium** |
| **V9** | **Re-cut the finder's columns** (option (a) in §4): merge You send + You get into one `Deal` cell; drop `Your lineup, a week`; drop `ESPN` under 760 px; shorten the two gain headers. 1,225 px -> ~620 px at 390. `#cuTable`'s header must move with it — the two are deliberately identical. | `offerRow()`, `renderFinder()`, both `<thead>`s | **medium** |
| **V10** | **Collapse Custom trades on a phone.** Wrap the builder (`.cu-build` + suggestion line + preview) in a `<details>` titled "Build a trade yourself", open by default at >= 900 px and closed below. Saves **~1,600 px = 26 % of the phone page**. Alternative, if Tim wants it always visible: show starters only with a "9 more" expander per roster (~−800 px). | `trade.html` `#customPanel`, `renderCustom()` | **cheap (details) / medium (starters-only)** |
| **V11** | **Shrink Data source on a phone.** Two options — (a) a one-line summary that expands: *"Autumn · win it all · every remaining week (2–16) · demo"* with a "Change" toggle; (b) keep **Your goal** and **Your team** visible and move Source, Value on, Week and Re-read into the existing `<details>`. Either saves ~450 px and puts the goal — which decides everything below — at the top of the panel. | `trade.html` Data source section, `renderCost()` | **medium** |
| **V12** | **Fix the week peek on a phone.** Under 900 px, render `#dealWeek` **immediately after the tapped row** (or above the week table) instead of 1,500 px below it. `renderDealWeek` already takes a context; only the host's position changes. | `BREAKDOWNS.deal.host`, `renderDeal()` | **medium** |
| **V13** | **Best combo: headline first.** Move the `naive` paragraph below the headline and compress it to a half-line; delete `.combo-one` and fold its claim into the headline's own words; add one visible sentence about sequencing ("all three have to be accepted…"); put the "most trades possible" block behind a toggle when it renders. −~250 px, and the answer arrives first. | `comboBlockHtml()`, `renderCombo()` | **medium** |
| **V14** | **The churn line.** Either delete it (the slot-by-slot panel says the same thing better and per week) or cap it at the three biggest movers, print **per-week** values, and add "+4 more". −~300 px of the phone sheet, and one fewer unit on the page. | `churnHtml()` | **cheap to medium** |

### Tier 3 — worth doing, bigger or more taste-dependent

| # | change | where | size |
|---|---|---|---|
| **V15** | **Un-mirror the custom rosters when they stack.** Emit both lists in the same cell order and do the mirroring in CSS only at the width where the pair actually sits side by side. Note the existing comment: the markup reversal exists to keep the tab order forward, so the fix is *unmirrored markup + CSS alignment*, not `row-reverse`. | `customList()`, `.cu-man.mirror` | **medium** |
| **V16** | **Rank the top ten offers first.** `runGoalRank` walks the list in points order; scoring the first ten, painting, then continuing would put a real goal number on screen in ~25 s instead of ~4 min. (Partly the maths agent's — the ordering is theirs, the staged paint is ours.) | `runGoalRank()` | **medium** |
| **V17** | **Fill `.deal-detail` on open** with the biggest-swing week instead of a prompt, so half the laptop card is not blank. Same for `#cuInline`. | `renderDeal()`, `renderCustomInline()` | **cheap to medium** |
| **V18** | **Declare the depth map's scale in its visible key** ("the three deepest and three thinnest at each position are tinted — this is not the +/-1 SD scale used above"), or move the panel onto `js/heat.js` so there really is one scale. The second is the rule-14-correct answer and the bigger job. | `renderDepth()`, `renderDepthNote()` | **cheap (words) / big (one scale)** |
| **V19** | **Offer cards under 760 px** instead of a narrowed table (option (b) in §4). Only if Tim prefers the look; it loses phone sorting, which currently needs a sideways scroll to use. | `offerRow()` + a phone branch | **big** |
| **V20** | **Disable `#weekSelect` while the measure is "Every remaining week"**, with the reason in its label. | `renderWeekPicker()` | **cheap** |

### Suggested order

`V1 -> V2 -> V3 -> V4 -> V5 -> V6 -> V7` in one cheap wave (all in `offerRow`,
`trade.html`'s `<style>` and four strings; run `text-audit.mjs` and
`measure-layout.mjs` after, per the house rule). Then **V8** on its own, because it
is the change Tim will notice. Then `V9 + V10 + V11` as the density wave — together
they take the phone page from **6,091 px to roughly 3,600 px** and put the first
recommendation on screen 1 instead of screen 2.6.
