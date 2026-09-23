# Trade page — the calculation half

Read-only audit, 2026-09-23, on main `1c086b0`. Scope: **calculation only** (a second
agent covers display). Files read in full: `js/trade.js`, `js/trade-odds.js`,
`js/trade-suggest.js`, `js/trade-page.js`; the parts of `js/forecast.js`,
`js/capture.js`, `js/floor.js`, `js/season.js` the page depends on; `PROGRESS.md`
rules 10/11/13/17/18, D1–D9, NOT-verified; `AUDIT.md` §5, §6 and its rejected list.

Every number below was measured in node against the demo league as the page builds
it (`demoSeason()` route: 10 teams, "now" = week 6, span **7–16**, sigma 23.35,
6-team bracket in 14/15/16, my squad = team 9, pTitle 8.9%). **The machine was at
100% CPU throughout** (two of Tim's `python` OCR jobs — the documented trap), so
absolute seconds are inflated maybe 3–5x; the *ratios* and all the probability
figures are unaffected.

---

## 1. Is the ranking sound? No — the podium is decided by the seed.

Ranking is `value = (your simulated chance gained) x P(he says yes)` on one seed
(`scoreOffer`, `js/trade-odds.js:330`; `compareByGoal`, `:353`). Common random
numbers **are** genuinely implemented: `simulateSeason` draws `2 x gameCount`
normals per run in a fixed order and the bracket has its own stream
(`js/forecast.js:470-530`), and `shiftSeason` never adds or removes a game, so
base and after see the same 10,000 seasons game for game. The measurement below is
therefore of the *paired* difference, which is the right quantity.

**Top 8 offers, 12 seeds, 10,000 runs each. Value in percentage points of title chance:**

| offer | mean | sd |
|---|---|---|
| Nolan: Sandoval+Abernathy | 5.89 | 0.38 |
| Watkins: Yoakum+Draeger | 5.87 | 0.31 |
| Watkins: Yoakum+Gallardo | 5.72 | 0.26 |
| Watkins: Yoakum+Quillen | 4.75 | 0.25 |
| Nolan: Ravenscroft+Abernathy | 4.51 | 0.39 |

Pairwise — the quantity that actually decides the order:

| pair | gap | sd of gap | order flipped |
|---|---|---|---|
| #1 vs #2 | 0.03 | 0.41 | **5 of 12 seeds** |
| #1 vs #3 | 0.17 | 0.39 | 4 of 12 |
| #2 vs #3 | 0.14 | 0.30 | 4 of 12 |
| #4 vs #5 | -0.24 | 0.35 | **9 of 12** (the shipped order is wrong more often than right) |
| #1 vs #4/#5 | 1.15-1.38 | 0.22-0.34 | 0 of 12 |

- Across 12 seeds **three different offers took the top row** (6 / 4 / 2 times).
  The one the live page shows as "the perfect trade" is a seed artefact.
- Median seed-to-seed SD of the gain over all 40 offers: **0.254 pp**; max **0.499**.
  The page's own note says "about 0.1-0.4 percentage points" (`trade-page.js:2733`)
  — right in the middle, understated at the top.
- 12-seed means agree with a single 100,000-run pass to ~0.06 pp (5.89 vs 5.95,
  5.87 vs 5.92, 5.72 vs 5.77), so the SDs above are honest.
- Ranks 1-3 and 4-5 are indistinguishable; the gap to rank 4 (>1 pp) is real.
  Only the *tiers* are sound, not the order inside them.

**The tie-break that exists is set 80x too tight.** `compareByGoal`'s
`EPS = 0.00005` (0.005 pp, `trade-odds.js:358`) is meant to fall through to points
when the sim cannot separate two deals; the real resolution is ~0.4 pp, so it never
fires.

### What would fix it, and what it costs

| fix | effect | cost |
|---|---|---|
| **Set `EPS` to the measured band (~0.004) and print a tie group** — rows 1-3 drawn as level, ranked inside the tie by the points the finder found | removes every false ordering above | **0 s**, ~10 lines in `compareByGoal` + `goalCellHtml` |
| More runs on everything: 100,000 | sd 0.41 -> 0.13 | measured 1.9 s/sim here => **~80 s** for 41 sims. No |
| **Two-stage: 10,000 for all 40, then 100,000 for the top 6 only** | settles rank 4+ exactly, still cannot separate a 0.03 gap | 6 extra sims, measured **~12 s** here (~3 s on an idle laptop) |
| Antithetic variates (mirror each run's normals; add an `antithetic` flag to `simulateSeason`) | roughly halves the sd for free | ~15 lines, but it moves Schedule/Summary numbers too — needs its own commit |
| Averaging k seeds | sd/sqrt(k) | k x the whole pass. Strictly worse than more runs |

Nothing can separate a 0.03 pp gap, so **the tie band is the fix and extra compute
is not.** This is *not* AUDIT's rejected "near-tie variance helper" (that was
lineup variance to win a close matchup) — flagging the distinction deliberately.

### The instability reaches the candidate list too

Re-running the whole finder with weights from three different seeds: **33-36 of the
40 offers in common**, but **9 of the top 10** are the same. The tail churns ~15%;
the head is stable.

---

## 2. The yes-curve (D3): what it is most wrong about

`acceptChance` = logistic(((his lineup gain/wk + ESPN-look/wk)/2 + 3)/1.5),
`trade-odds.js:166`; wired at `trade-page.js:3290`.

**Measured over the 40 shortlisted offers: P(yes) p10 71%, median 91%, p90 96%** —
a 1.35x spread against a ~2x spread in the gains. Drop the factor entirely and
**only 3 of the top 10 positions change** (max move 3 places). So the "x P(he says
yes)" in D1 is close to a constant multiplier: the list is effectively ranked by
the gain alone, and the one unvalidated judgement is doing almost no work — while
being quoted on every row as a percentage.

**Most wrong about the LEVEL, not the slope.** 35 of the 40 shortlisted offers have
the partner **losing** points (`THEIR_MIN_PER_WEEK = -2` lets them in), and the
median offer is still labelled **91% yes**. Real fantasy managers decline most
offers; a curve that says 88% at dead even is out by something like an order of
magnitude in the base rate. Second-most wrong: it is blind to *which* man leaves
(endowment — giving up his RB1 is not the same as giving up equal points spread
over two bench men) and to *position*.

**The prompt's premise is wrong on one point:** `espn.parseTrades`
(`js/espn.js:589-596`) returns **only** `deadline` and `revisionHours`. There is no
accepted-trade history anywhere in the site today.

**But there is a free dataset the page already buys.** `loadHistory`
(`trade-page.js:848`) reads *every* week, played ones included, and
`weekly.rosters` keeps `week -> teamId -> players` for weeks 1-17
(`indexRosters`, `:576`). Diffing consecutive weeks gives, at **zero extra
requests**:

1. **Every completed trade in the league this season** — a player who moves from
   team A to B in the same week that another moves B to A is an accepted trade.
   That is the base rate the intercept should be fitted to: if Tim's league has done
   3 trades in 14 weeks and the page shows 40 offers at 91%, the curve is wrong and
   the diff proves it.
2. **A per-manager prior** — some managers never trade. Count each manager's
   trades and adds; a manager with zero moves all season should not be at 91%.
3. **Measured positional need** — which positions a manager keeps churning off
   the wire is where his hole is.

Three more signals already computed on the page and ignored:

- **His own situation.** `goalContext().base` already holds every team's
  `pPlayoffs` / `pTitle` / `pBye` (measured in demo: partners at 37.8%, 52.0%,
  75.0%, 99.2%). A 37% team is a seller and a 99% team is a buyer, and they should
  not have the same curve. **Zero extra simulation** — `scoreOffer` already reads
  his row out of the same run.
- **Positional scarcity.** `depthTable` / `replacementLevels` (`trade.js:243-418`)
  are recomputed every paint and never reach the yes-curve. A deal that fills his
  hole (`cell.weakest`, negative `startersEdge`) is far likelier than one that hands
  him a fourth running back of the same value. This is the biggest cheap
  improvement available to the curve.
- **The floor.** `surplusEdge` already prices what he can send without touching his
  lineup — a man he is starting is much harder to prise loose than a surplus man.

Recommended build: keep the logistic, add two terms with named constants —
`+ a x (his own goal gain)` and `+ b x (does it fill a hole he has)` — fit the
intercept to the roster-diff trade count, and keep the cheap pre-sim curve for the
candidate gate (the post-sim curve cannot be used there without circularity).
**Medium.** Nothing here needs a feed the site cannot fetch.

---

## 3. What the model ignores

| thing | status | cost | how much it moves a number |
|---|---|---|---|
| **Schedule strength of the priced weeks** | *is* modelled, through `weekWeights` — but the estimator is noise. Seed to seed: wk7 weight 0.18-0.55 (3.1x), wk8 0.18-0.61 (3.4x), CV 36-41%; the playoff weeks are stable (wk16 2.88-3.60, CV 7.5%). Raw d(chance)/point ~4e-4 with an inter-seed sd of the same order | **medium** to fix | The feature is there and delivers nothing for the regular season. Replace the 11-sim finite difference in `weekWeights` (`trade-odds.js:297`) with the closed form: weight(w) proportional to `phi((mine-opp)/(sigma x sqrt2))/(sigma x sqrt2)` x one value-of-a-win estimated from **2** sims for the whole season, not 11. Deterministic, ~0 ms, and it *is* "a point in a coin flip is worth more than a point in a blowout" |
| **Who you actually play** | modelled — `theirByWeek` shifts the partner's projection in *his* games including the ones against you (`shiftSeason`, `:210`) | done | nothing to do |
| **Positional scarcity / replacement level** | modelled at assessment via `floor.js` (3rd-best FA, rule 13) and in the depth map. Missing only from the yes-curve (see §2) | cheap | see §2 |
| **Bye-week stacking** | **already right by construction** — every week's lineup is filled separately from that week's projections (`scoreAcrossWeeks` / `fillAcrossWeeks`, `trade.js:932-1017`). A bye is a real 0 and the week re-picks around it | done | nothing to do |
| **The partner's own playoff odds** | **not modelled at all** — and worse, his side is priced over weeks he may never play. See finding C3 below | medium | large: demo top offer, his gain is **-10.5 over the span**, **+15.3 over the regular season**, **-25.8 in the bracket**, with pPlayoffs 75% |
| **Roster-slot limits** | only roster SIZE (`afterTrade`, `trade.js:483`); no IR slot, no per-position minimum. `parseLeague` already reads `irSlots`/`benchSlots` (`espn.js:600-612`) and the trade page never asks | cheap guard | small: measured over 18 forced-cut offers on the demo, **0** left a position empty — an OUT man projects 0.00 and is cut first, and an emptied slot is floored anyway |
| **The trade deadline** | shown (`renderDeadline`, `:6561`), never priced | cheap | see C7: a locked week is still in the span |
| **Per-week floors** | one wire read at `state.floorWeek`, applied flat to every week (D9) | **big — do not** | needs a free-agent read per week (rule 4), i.e. ~10 more requests, roughly doubling the page's cost, to move a marginal slot by a point or two |

---

## 4. Where the numbers can mislead

**C4 — the points columns and the goal column are on different bases, silently.**
Under "Win it all", `weeklySpan()` (`trade-page.js:450`) appends the bracket weeks,
and `myGain` / "You gain" / "/wk" sum them **undiscounted**, while the goal % *does*
discount them (that is what the 1.5/2.4/2.9 weights are). Measured, my pPlayoffs
78.8%, pFinal 23.7%:

| offer | myGain total | page's /wk (divide by 10) | regular season only | /wk over the 7 certain weeks | playoff share |
|---|---|---|---|---|---|
| Nolan: Sandoval+Abernathy (**rank 1**) | +0.9 | **+0.09** | **-24.9** | **-3.56** | 2867% |
| Miles: Hargett+Yoakum | +26.3 | +2.63 | +1.8 | +0.26 | 93% |
| Watkins: Yoakum+Draeger | +17.4 | +1.74 | +0.7 | +0.10 | 96% |
| Watkins: Yoakum+Gallardo | +17.5 | +1.75 | -0.9 | -0.13 | 105% |

The top-ranked deal costs **3.6 points a week for every one of the seven weeks you
are certain to play** and pays only in three weeks you reach 79% / 24% of the time.
The simulation knows that and still likes it; the reader sees "+0.1 a week" and has
no way to know. The note at `:2858` — "the per-week number is exactly that total
divided by 10 weeks" — is arithmetically true and is the misleading sentence.
**Fix:** split the gain into "the weeks left" and "if you get there", or scale the
bracket weeks by the sim's own reach probability before printing. Rule 7.

**C8 — precision stated beyond the model.**
- `goalCellHtml` (`:3357-3362`) prints the change to **0.1 pp** and the tooltip's
  expected value to **0.01 pp** (`signedPct(s.value, 2)`), on a quantity whose
  one-seed sd is 0.2-0.5 pp.
- `pct(base)` prints "your title chance is 8.9%"; the same inputs gave **8.62% to
  9.67%** across six seeds.
- The method note's "0.1-0.4 pp between seeds" understates the measured max (0.50
  on a gain, 0.42 on a pairwise gap).

**C9 — one number, two implementations.** `espnLookPerWeek`
(`trade-odds.js:156`) is exported, documented and unit-tested, and **the page never
calls it**: `acceptFor`/`rosOf` (`trade-page.js:3275-3295`) recompute the same
quantity. Two derivations of one number is exactly the seam this codebase fixes
everywhere else. Also, the "ESPN look" is totalled over the *title* span including
weeks 15-17 — which ESPN's trade screen does not total — so it does not compute the
thing it claims to imitate.

**C3 — the partner's figures.** `theirGain` is summed over the same span and divided
by 10 for both the candidate gate (`theirMin = THEIR_MIN_PER_WEEK x n`,
`trade.js:1276`) and the yes-curve. The note at `:2848` says "his lineup loses no
more than 2 a week" — 2 a week averaged over three weeks he may not play. Free fix:
the base sim already holds his `pPlayoffs`.

**Neighbouring panels that can disagree.** `suggestGoal` (`trade-page.js:5552-5565`)
hands **your** week weights to **his** side (`weightsB: W.weights`) to save a
`weekWeights` run, so "evenness" in the custom box is measured in a currency that is
wrong for one of the two managers — under "Win it all", a man who only helps him in
week 16 is weighted x2.9 for him too, whatever his own title chance. The comment
admits the reason is cost; the cheap fix is to weight his side at 1 and say so, or
to scale his bracket weeks by his own `pPlayoffs` (free) rather than run 11 sims.

**"Last" goal sign.** `goalCellHtml` draws a green cell containing a negative
percentage under "Don't finish last" (`change = after - before`, class from
`mine.gain`). Defensible, worth one glance from the display agent.

**Live games.** `simulationInputs` (`capture.js:610-623`) drops an in-progress game
from `banked` and plays it out from the **whole-week** projection, ignoring points
already on the board. Shared with Schedule/Summary, so not a trade-only fix.

---

## 5. What is over-built

**C6 — the page pays for an exhaustive weekly search it throws away.** Measured, one
demo load (100% CPU machine):

| stage | ms |
|---|---|
| search #1, weekly on points (`loadWeekly` -> `runSearch`) | **70,617** |
| `weekWeights` (11 sims, one of them a duplicate base) | 4,186 |
| search #2, with the goal weights (`goalFollowUp` -> `runSearch`) | **122,279** |
| `bestCombo` (70 packings, pool 12, exhaustive) | 1,043 |
| `mergeComboByPartner` | 4 |
| one 10,000-season simulation | 473 |
| the whole goal rank (41 sims) | ~19,400 |

`autoLoad` -> `loadWeek` runs a scalar search, `loadWeekly` runs the weekly one, and
then `loadHistory` -> `goalFollowUp` (`:876-880`) **re-runs the whole weekly search**
because the first one had no goal context (the played weeks, which the spread is
measured from, had not arrived). The first weekly search's entire output is
replaced. **Fix: when the history read is going to happen anyway, buy the played
weeks first and search once.** ~a third of the page's compute, cheap.

**Duplicate base simulation.** `weekWeights` runs `simulateWith(inputs, null)`
internally (`trade-odds.js:299`) although `goalContext` has just computed exactly
that with the same seed and runs (`trade-page.js:3262`), and then throws away the
`base` it returns. One free sim per search: add a `base` option.

**A goal toggle is a full recompute.** `state.goal` is in the `goalContext` key and
changes `weeklySpan()`, so Win-it-all <-> Don't-finish-last re-runs the weights (11
sims), the whole finder, the combo and 40 sims. Worth a "working..." honest cost
line rather than a code change.

**`bestCombo` is NOT the expensive part** — 1.0 s against 122 s for the search above
it. AUDIT §6.8's case for demoting Best combo stands on reader attention, not
compute; there is nothing to cut here for speed. (Not re-proposed.)

**`espnLookPerWeek`** — see C9. Dead in production, alive in the tests.

---

## Ranked, by value to Tim over effort

| # | finding | where | size |
|---|---|---|---|
| 1 | **Declare ties.** `EPS` 0.00005 -> ~0.004 and a visible tie group; rows 1-3 of the demo list are level (gap 0.03-0.17 pp, sd 0.39-0.41, flips 4-5 of 12 seeds) | `compareByGoal` `trade-odds.js:353`, `goalCellHtml` `trade-page.js:3338` | **cheap** |
| 2 | **Search once, not twice.** Buy the played weeks before the first weekly search | `loadWeekly:775`, `loadHistory:848`, `goalFollowUp:876` | **cheap** |
| 3 | **Stop printing bracket weeks at face value in the points columns.** Split "weeks left" from "if you get there", or scale by the sim's reach probability | `tradesAcrossWeeks` byWeek `trade.js:1368`, `perWeekOf`/`weeklyGainHtml` `trade-page.js:2448-2473`, note `:2858` | **cheap** to disclose, **medium** to fix |
| 4 | **Price HIS side over weeks he will actually play** — weight his bracket weeks by his `pPlayoffs` from the base sim (free), in the gate, the yes-curve and the "He gains" column | `tradesAcrossWeeks:1276-1341`, `acceptFor:3290`, note `:2848` | **medium** |
| 5 | **Replace the 11-sim week weights with the closed form** (tie-density x one value-of-a-win). Kills a 3x seed swing and 4.2 s | `weekWeights` `trade-odds.js:297`, `goalWeightsFor:3267` | **medium** |
| 6 | **Drop the false precision** — no 2-dp chances anywhere, 0.1 pp on changes, print the measured +-0.4 band | `goalCellHtml:3357`, `pct/signedPct:3324`, `goalMethodHtml:2733` | **cheap** |
| 7 | **Do not price a week whose games have started** — `playedWeeks()` uses `g.played`, so on Sunday the locked current week is in every gain; the `reviewHours` already read makes it worse | `playedWeeks` `trade-page.js:416`, `weeklySpan:450` | **cheap** |
| 8 | **Give the yes-curve the three free signals** — his own `pPlayoffs`/`pTitle`, `depthTable`'s hole/surplus, and a base rate + per-manager prior from diffing `weekly.rosters` week to week (zero requests). Median P(yes) is 91% on a list where 35 of 40 partners lose points, and removing the factor moves only 3 of the top 10 | `acceptChance` `trade-odds.js:166`, `acceptFor:3290`, new roster-diff helper | **medium** |
| 9 | **Weight HIS side of the custom box on his own currency**, not yours | `suggestGoal:5552` | **cheap** |
| 10 | **One definition of the ESPN look** — call `espnLookPerWeek` or delete it | `trade-odds.js:156` vs `trade-page.js:3275` | **cheap** |
| 11 | **Pass `ctx.base` into `weekWeights`** — one wasted simulation per search | `trade-odds.js:297`, `trade-page.js:3267` | **cheap** |
| 12 | Two-stage precision: re-run the top 6 at 100,000 (~12 s here, ~3 s idle) once ties are declared | `runGoalRank:3184` | **medium** |
| 13 | Antithetic variates in `simulateSeason` — halves the sd for free, but moves Schedule/Summary too | `forecast.js:470-537` | **medium** |
| 14 | Guard the forced cut against emptying a needed position / respect IR slots. Measured 0 of 18 on the demo, so low value | `afterTrade` `trade.js:483`, `espn.js:600` | **cheap**, low value |
| 15 | A live game should be played out from its remaining points, not its whole projection (shared fix) | `capture.js:610` | **medium** |
| 16 | Per-week positional floors | `floor.js` + a per-week FA read | **big — recommend against** (about 10 extra requests, rule 4) |

### Already rejected in AUDIT — not re-proposed
Injury-aware pricing; D/ST streaming by Vegas totals; the near-tie variance helper
(finding 1 is a different thing — a tie *band* on the ranking, not lineup variance);
buy-low/sell-high from usage (finding 8 uses the sim's own output and the roster
diff the page already holds, not target/snap share); three-team trades;
projection-drift chart; demoting Best combo (§6.8 — supported here: it costs 1 s,
so the case is attention, not compute).

### One AUDIT line is now out of date
AUDIT §5 says "`trade.html` refuses to price from week 15 (`weeklySpan()` is
regular-season-only)". Since 2026-09-21 `weeklySpan()` appends
`bracketWeeksAhead()` under the title goal (`trade-page.js:450-460`).
