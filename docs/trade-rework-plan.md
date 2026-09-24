# Trade page rework — plan

> **Tim asked (2026-09-22):** "Once you're done, I want you to really analyze our trade section and make a plan on how we might want to change it to make it better both in calculation and in display and view."
> **Instruction (2026-09-22):** plan only. ~~NOTHING IS BUILT.~~ Superseded: Phase 1 was built and merged on 2026-09-23 (32ce66e) under the same go-ahead.

**Status (2026-09-24):** **Phase 1 BUILT and live · Phases 2–6 NOT built and NOT authorized** — see "BUILT 2026-09-23" near the end for what shipped, where this plan's own wording was wrong, and the one measurement still owed. Phase 4 cannot start until Tim answers question **d**; question **f** (the finder's wording) is answered by placeholders Phase 1 shipped, which are his to change. Read first: "The answer", "Recommendation", "Questions for Tim". Full evidence: `docs/trade-review-calc.md` (maths) and `docs/trade-review-view.md` (display), both read-only audits on main `1c086b0`, 2026-09-23.

## Decided by Tim
- 2026-09-21 · The Trade page opens on a goal ("Win it all" / "Don't finish last") and ranks by the change in that chance. "rank by expected value, but add a good amount of leeway."
- 2026-09-21 · "I want the cite to offer virtually the perfect trade to the user."
- 2026-09-22 · Chose the ESPN-duplicate cut and the test safety net next; this rework is a plan he asked for, not a go-ahead. Nothing here is authorized until he says so.
- 2026-09-23 · **No answer block at the top** — "leave the table as the answer". · **Show near-ties as tied.** · **Collapse the empty custom builder on a phone.** · **Keep Best combo** as a headline answer, with a sentence about every leg needing to be accepted.
- 2026-09-23 · Those four answers were taken as the go-ahead for Phase 1, which is now built. **Phases 2–6 are not authorized** — ask before starting one.

## The answer (one sentence)
The engine is sound but **oversells its own precision** — the top three offers are a statistical tie the page prints as a ranking, and for the first minutes the table is in points order while claiming to rank by chance — so the rework is: declare ties, rank the top ten first so the table is true sooner, fix four places where a number is stated on a basis it was not computed on, and give the phone back about 2,400 px.

## Blockers / deciding constraint
- **Nothing here needs new data, money or a feed.** Every fix uses what the page already fetches. No money or data-safety risk in any phase.
- The one true constraint is **time to an answer**: ranking 40 offers took ~280 s end to end while the machine sat at 100% CPU (Tim's OCR jobs — the documented trap inflates seconds maybe 3–5×, so idle is likely ~60–90 s). Until that finishes, the list on screen is in **points** order, not goal order. Anything that adds simulation must pay for itself by removing some; Phase 3 removes a whole duplicate search.
- **Nothing may present an offer as goal-ranked before it has been scored.** Hence staged ranking (Phase 2) and a mark on rows not yet reached.
- **A tie band must not change the sort.** Widening `compareByGoal`'s `EPS` makes the comparator intransitive and quietly hands the top row to points, against rule 18 and D1. Ties are a **display grouping on top of a strict sort**.
- **Tests now gate the deploy** (AUDIT §3) and a falling assertion count fails the run. Every retitle, dropped column and changed gate below breaks pinned assertions: each must be re-aimed deliberately, seen failing first, and must wait with `settleGoal()`, never a sleep.
- **Tim decides every wording and layout change below.** They are written as options, not decisions.

## What the evidence says
- **The podium is a coin flip.** Top 8 offers, 12 seeds, 10,000 runs each: #1 beats #2 by 0.03 pp ± 0.41, order flipped in **5 of 12 seeds**; #4 vs #5 flipped in **9 of 12**. Three different offers took the top row. · *measured* · `trade-review-calc.md §1`
- Common random numbers are genuinely implemented (`forecast.js:470-530`), so this is irreducible paired noise, median SD **0.254 pp**. More runs cannot separate 0.03 pp. · *measured*
- The tie-break exists but is set **80× too tight**: `compareByGoal`'s `EPS = 0.00005` vs a real resolution of ~0.4 pp, so it never fires. · *documented* · `trade-odds.js:358`
- **The page searches everything twice.** Points search 70.6 s, then goal search 122.3 s, because `goalFollowUp` re-runs once the played weeks arrive. Buying history first removes one. · *measured* · `trade-page.js:775/848/876`
- **Points columns and the goal % use different bases.** The demo's rank-1 deal prints "+0.9 over the span" while being **−24.9 points across the seven weeks you are certain to play**, buying +25.8 in three weeks reached 79% / 24% of the time. · *measured* · `trade-review-calc.md §4`
- **The partner is priced over weeks he may never play**: his gain −10.5 over the span, **+15.3 over the regular season**, −25.8 in the bracket, at 75% to reach it. His own `pPlayoffs` is already in the base simulation, free. · *measured*
- **P(yes) barely discriminates**: p10 71% / median 91% / p90 96%, on a list where **35 of 40 partners lose points**. Removing the factor moves only 3 of the top 10. The level is wrong, not the slope. · *measured*
- **Past trades are recoverable at zero cost**: `loadHistory` already reads every week's rosters, so diffing consecutive weeks yields every completed trade and waiver move in the league — a real base rate. (`espn.parseTrades` gives only the deadline; there is no trade history endpoint.) · *measured / documented*
- **On a phone, the first offer row sits at y=1,614 in a 664 px viewport** — ~1,040 px of scrolling past the connection bar and Data source before one recommendation is readable. · *measured* · `trade-review-view.md §1`
- **All 40 "He gains" cells are negative and all 40 are painted green** (`offerRow` emits `pos` unconditionally), under a panel still titled "Trades that help both squads". · *measured* · `trade-review-view.md D1/D2`
- **The finder table is 1,225 px in a 360 px scroller — 70.6% off-screen**; Custom trades is **2,281 px (37% of the phone page) while empty**. · *measured*
- **Best combo is cheap, not expensive**: 1.0 s against 122 s for the search above it, and 867 px / 134 words. AUDIT §6.8's "demote it" rests on attention, not cost. · *measured*

## What exists today
`js/trade.js` (engine, pure), `js/trade-odds.js` (goal weights, sim scoring, yes-curve), `js/trade-suggest.js` (even-up suggestions), `js/trade-page.js` (~6.8k lines of wiring). The page prices every remaining week, searches every shape up to 2-for-2, plays each offer through a 10,000-season simulation, and ranks by (chance gained) × P(yes). Panels in order: Data source (696 px), finder (the answer), Best combo, Depth map, Custom trades, saved rows, plus a deal pop-up and the player card.

## Options
| Option | What it is | Cost (effort, $, risk) | How it fails |
|---|---|---|---|
| **A — Honesty pass** | Declare ties, sign the colours, retitle the panel, drop false precision, split "weeks you will play" from "if you get there" | ~1 wave, $0, low risk; no layout change | Page still buries its answer; Tim sees little difference |
| ~~B — Answer block~~ | A block under the title naming the best offer · **rejected by Tim, 2026-09-23: "No, leave the table as the answer"** | — | — |
| **B′ — Staged ranking** | Rank the top ten first and repaint, so the table is genuinely goal-ranked in ~25 s instead of ~4 minutes | medium, $0, low risk | If rows not yet scored are not marked, the table still shows points order while claiming to rank by chance |
| **C — Density wave** | Re-cut the finder's columns, collapse the empty custom builder on a phone, shrink Data source | medium, $0, taste-dependent (Tim decides) | Phone page 6,091 px → ~3,600 px; risk is only that Tim dislikes the look |
| **D — Engine work** | Search once not twice; price his side over the weeks he plays; replace the 11-sim week weights with a closed form; feed the yes-curve his playoff odds, the depth holes and a trade base rate from roster diffs | 2–3 waves, $0, medium risk (changes every number on the page) | Numbers move and Tim cannot check them against ESPN by hand unless each change is disclosed |
| **E — Do nothing** | — | $0 | The page keeps printing a false order and hiding its answer |

## Recommendation (ranked)
1. **If only one thing is built, build A (the honesty pass).** It is cheap, it needs no taste decisions, and it stops the page asserting things that are not true: a ranking it cannot support, green minus signs, "helps both squads" when all 40 offers hurt the partner.
2. **Then B′ (staged ranking)** — the table is what Tim reads (his call, 2026-09-23), so the table should stop showing points order while saying it ranks by chance.
3. **Then Phase 3** (search once; price his side over the weeks he plays). The first makes the page roughly a third faster for free; the second fixes a number that is simply wrong today.
4. **Then C (density) and the defects wave**, once Tim has said which of the layout options he wants.
5. **Then the week weights** (Phase 6). Deterministic weights, no seed swing in the candidate list. The yes-curve rebuild is parked — see "Deliberately NOT planned".

## Deliberately NOT planned
- ~~Demote Best combo (AUDIT §6.8)~~ · **weakened, and it is Tim's call (question e).** It is cheap (1.0 s, 867 px), and on the demo its expected value beats the best single row (+9.5% at 66% all-yes = 6.3 expected points vs 3.6) — but that comparison ignores the 34% of cases where one leg is refused and the rest still go through, which nothing prices today. Keeping it costs a sequencing sentence; demoting it is defensible.
- ~~"These three offers don't overlap" as a substitute for the combo~~ · adding three gains says +6.0/wk where the combined move is +5.0/wk. Rule 11 forbids exactly that.
- ~~Per-week positional floors~~ · needs a free-agent read per week (~10 extra requests, rule 4) to move a marginal slot a point or two.
- ~~Injury-aware pricing, D/ST streaming by Vegas totals, three-team trades, buy-low/sell-high~~ · already rejected in AUDIT; nothing has changed.
- ~~More simulation runs to fix the ranking~~ · measured: 12-seed means agree with a 100,000-run pass to 0.06 pp. Nothing separates a 0.03 pp gap. Declaring the tie is the fix.
- ~~Rebuilding the yes-curve on a fitted base rate~~ · **parked, was Phase 5.** A 10-team league produces a handful of completed trades a season, so an intercept "fitted" to roster diffs is a guess wearing a number, and the detection rule (A→B and B→A in the same week) false-positives on two independent waiver moves. What survives: **re-level the curve** so a partner who loses points is not shown at 91%, feed it his own playoff odds and the depth-map holes the page already computes, disclose it as a judgement, and check it against trades Tim actually remembers. That is a small slice of Phase 3, not a phase of its own.

## How this could be wrong
- **"The tie band should be ~0.4 pp"** → disproved if, on Tim's real league (10 squads, real spread), the seed-to-seed SD is much smaller than on the demo. Test: same 12-seed measurement against his league before setting the number.
- **"Weighting his bracket weeks by his playoff odds makes P(yes) better"** → disproved if it moves the top-10 order by less than one place. Test: measure the order before and after.
- ~~"The answer block is what Tim wants at the top"~~ → he said no on 2026-09-23 before it was built. The table is the answer.
- **"Nothing needs more requests"** → disproved if the roster-diff trade history turns out to need weeks the page does not already read.

## Phases (each ships on its own)

1. **Honesty pass (A).** — **BUILT 2026-09-23, merged 32ce66e. See "BUILT" below for what shipped and where this phase's own wording was wrong.**
   - **Ties as a display grouping, never a sort change.** Keep `compareByGoal` strict (`EPS` unchanged). Add, after sorting, a pass that walks the ranked list and marks each offer whose value is within the measured band (~0.4 pp, confirmed on Tim's league first — see "How this could be wrong") of the one above it as level with it. Rows in a tie group share a rank number ("1="), keep their strict order, and the group says why in one short line.
   - Sign the two gain cells in `offerRow` (`pos`/`neg`/none, the way `goalCellHtml` already does) — fixes 40 green minus signs in the finder, the combo and saved rows at once.
   - Retitle the finder and `emptyMessage()` so they stop claiming both squads gain (Tim picks the wording, question a).
   - Drop the false precision: no 2-dp chances, 0.1 pp on changes, and the ± band printed where a change is.
   - State the bracket-week basis under the points columns (rule 7), and stop pricing a week whose games have already started (`playedWeeks` uses `g.played`, so on a Sunday the locked week is still in every gain).
   - *Done when:* a test builds two offers 0.1 pp apart and fails today (no tie shown) but passes after, plus one proving the printed order is unchanged by the grouping; a test pins a negative gain rendering `neg` and fails today; a test pins a started week out of the span; `text-audit` under its new ceiling; 390 px screenshot.

2. **Staged ranking.** (The answer block is **cut** — Tim, 2026-09-23: "leave the table as the answer".) `runGoalRank` scores the top ten, repaints, then continues, so a real goal number reaches the table in ~25 s instead of ~4 minutes, and the rows stop sitting in points order while the page claims to rank by chance. The progress line stays where it is and says which it is showing. *Done when:* a test asserts the table shows goal-ranked rows before the whole list is scored, and that rows not yet scored are marked as such rather than presented as ranked.

3. **Engine, part 1 (D).** Buy the played weeks before the first weekly search, so the page searches once, not twice; pass the base sim into `weekWeights` instead of running a duplicate; one definition of the ESPN-look number (call `espnLookPerWeek` or delete the dead copy); price the partner's side over the weeks he will actually play, weighted by his `pPlayoffs` from the base sim (free), in the candidate gate, the yes-curve and the "He gains" column, disclosed in the note. **This changes which offers exist**, not only a column — `THEIR_MIN_PER_WEEK` sits in the gate — so fixtures and any hand-check against ESPN change with it, and the note must say so. *Done when:* a test counts one weekly search per load and fails today; a test pins his gain against a hand-computed playoff-weighted figure; a test pins the note stating the basis.

4. **Density wave (C).** Finder columns re-cut; custom builder collapsed below 900 px; Data source shrunk; the heat key printed once instead of four times; the combo's headline first with a visible sentence about needing every leg accepted; the churn line capped and printed per week (it prints season totals among /wk figures today — rule 10). Whichever options Tim picks. *Done when:* the finder table measures ≤ ~620 px inside its 360 px scroller (from 1,225 px), phone page height under ~3,800 px (from 6,091), before/after screenshots at 390 px.

5. **Small defects wave.** The pop-up's run-together packages (one CSS line); the orphaned heat mark; the low-contrast "Tick who moves on each side", printed twice; the 2×3 shape filter with an empty sixth cell; the Difference column clipped at 390 px; the week peek rendering ~1,500 px below the tapped row; the inert week picker; the depth map's tints declared (they use the heat hues under a different rule — rule 14); and a real-device check of whether the sticky header eats a tap on the first row.

6. **Engine, part 2 — week weights only (D).** Replace the 11-simulation finite difference in `weekWeights` with the closed form (tie density × one value-of-a-win): deterministic, ~0 ms, and it kills a 3× seed swing in the regular-season weights that currently choose the candidates. *Done when:* the weights are identical across two runs and the candidate list stops moving between seeds.

## Questions for Tim
a. ~~An answer block at the top naming the best offer?~~ → **No, 2026-09-23. The table is the answer.** Phase 2's block is cut; the staged ranking inside it survives (it makes the table itself right sooner), and the progress line stays where it is.
b. ~~Show offers that are too close to call as tied?~~ → **Yes, 2026-09-23.** Same rank number, short line saying they are level, printed order unchanged.
c. ~~Collapse the empty custom builder on a phone?~~ → **Yes, 2026-09-23.** A tappable "Build a trade yourself" line below 900 px; open on the laptop.
d. Should the finder's columns be cut down on a phone (merge "You send"/"You get" into one Deal cell, drop "Your lineup, a week", hide ESPN)? · recommended: **yes** — 70.6% of the table is off-screen today. **Not yet asked** — ask before Phase 4 starts, with a screenshot of both versions.
e. ~~Keep Best combo, or demote it?~~ → **Keep, 2026-09-23**, with one sentence that every leg has to be accepted.
f. The finder's title claims trades "help both squads" and every one of the 40 makes the other manager worse. New wording is his — placeholder "Trades ranked by your title chance". · recommended: **retitle**; ask with the Phase 1 screenshot.

## BUILT 2026-09-23 — Phase 1 only (merged 32ce66e, live)

Phase 1 shipped as three commits: 88eac95 (the maths), cdb3141 (the display), f45f88f (nineteen assertions, each seen failing against the page as it was). tr-test 647/647, up from 625. **Phases 2–6 are still unbuilt.**

**What shipped**
- **`TIE_BAND = 0.4 pp`, measured, not guessed.** The demo's top eight offers were scored on twelve seeds, 10,000 seasons each, exactly as the page scores them (span 7–16 under "Win it all", σ 23.35, 369 candidates): one offer's expected change has a seed-to-seed SD of 0.270 (max 0.488), and the GAP between two offers — the thing that decides the order — 0.318 (max 0.474). Every pair inside 0.4 changed places in 2–9 of the 12 seeds; the one pair outside it (1.51) never did.
- **`tieGroups` marks the sorted list and is not a sort key**, so it cannot move a row. Rows level with each other share a rank with an "=" and keep the comparator's strict order.
- **`EPS` was left alone deliberately.** Two assertions pin that widening it to the band fails: at 0.4 the comparator turns intransitive, every near-tie falls through to the points key, and the points search gets the top row back — against rule 18 and D1.
- **Both gain cells carry their sign.** `offerRow` wrote `pos` on both whatever the number was; since the goal-weighted search landed, the partner may lose up to 2/wk, so all forty "He gains" cells were negative numbers painted green — in the finder, the combo and the saved rows at once.
- **The panel says what it finds.** "Trades that help both squads" described the old points finder. The heading now follows the chosen goal and the refusal reads "No trade here helps your goal." These are the plan's **placeholders** — question f is still Tim's.
- **No false precision.** Chances are 1 dp, and every stated change carries the measured band (goal cells, pop-up, combo headline, custom preview). The note's old "about 0.1–0.4 percentage points" is replaced by the measurement and by why a level group is level.
- **The bracket-week basis is disclosed** (rule 7): under "Win it all" the gain columns add playoff weeks at face value while the goal % counts them by how often you get there, so a deal can read a small gain over the span and lose points in every week you are certain to play (measured: the demo's rank-1 deal, +0.9 over the span, −24.9 across the seven certain weeks). Stated, not re-modelled — that is Phase 3.
- **A week that has kicked off is out of the span.** `playedWeeks()` read `g.played`, which only turns true when a week goes FINAL, so from the first kick-off until Tuesday the locked current week sat inside every gain on the page. `state.startedWeeks` / `lockedWeeks` fix it and the note names the dropped week.

**Where the plan was wrong**
- ~~"mark each offer whose value is within the band of the one above it"~~ — taken literally that **chains**: on the demo it put 39 of 40 offers in one group marked "1=" spanning 2.17 points, with the two ends five times the band apart, a difference the seed study never once got wrong. Worse than the ranking it replaced. **Anchored to the group's leader instead**, the same list reads as six real tiers, none spanning more than 0.40: 1= (5 rows), 6= (6), 12= (9), 21= (14), 35= (5), 40. An assertion pins that a run of small steps does not collapse into one group.
- ~~"confirmed on Tim's league first"~~ — **not done.** The band is measured on the demo league only. The "How this could be wrong" test (12 seeds against his real league, 10 squads and real spread) is still outstanding; if his seed-to-seed SD is much smaller, 0.4 pp is too wide and the page is calling real differences ties.
- The audit's own figure over all 40 offers (0.254 / 0.499) agreed with the 8-offer study, so the band is not an artefact of which offers were measured.

**Verified how:** with `TIE_BAND` back at the old `EPS`, six new assertions fail (ranks read 1,2,3,4,5, nothing level — today's page); with `EPS` widened to the band, two fail (the list returns in points order); with the grouping back on the row above, seven fail; with `lockedWeeks` on `g.played` alone, one fails (week 2, under way, priced). Restored: test-trade-odds 111 passed (up from 91), tr-test 647/647. Visible prose 392 → 391 words where `text-audit` measures it; the status line stays under its sixty-word cap, which is why the tie notation lives in the lede.

## Sources
- `docs/trade-review-calc.md` — 2026-09-23 maths audit, every figure measured in node against the demo league.
- `docs/trade-review-view.md` — 2026-09-23 display audit, screenshots at 390 px and desktop in the session scratchpad.
- `AUDIT.md` §5, §6 and its rejected list; `PROGRESS.md` rules 7, 10, 11, 13, 14, 17, 18 and Decisions D1–D9.
