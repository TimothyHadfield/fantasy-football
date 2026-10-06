# Outliers — plan

> **Tim asked (2026-10-06):** "I want to have some way of adjusting outliers in data, esspecially the ones that affect the weekly summary so that they don't totally skew the data. Is there any way we can do that? What do you think? Make a plan first and then tell me before you build anything."
> **Instruction:** plan only — tell him before building anything.

**Status:** NOTHING IS BUILT · reviewed by plan-reviewer 2026-10-06 (4 blockers fixed: score-part caps dropped, Decisions and the cumulative chart covered, question d asked first) · Read first: "The answer", "What the evidence says", "Questions for Tim".

Reading taken (to be confirmed, question a): "the weekly summary" = the Summary page (`summary.html`, its `<h1>` is "Weekly summary"), whose one number built from weekly results is **LUCK**; the same number is Stats' "Luck score" and feeds S+L and the Decisions copies. "Outliers" = single weeks that move a season figure far more than an ordinary week does.

## Decided by Tim
- (nothing yet)

## The answer (one sentence)
Yes — and on the real data the thing that skews LUCK is not freak scores, it is the **close-game term** (a 2-point game counts ±50, as much as beating your projection by 50), so the fix worth building is to make a close game count less: either lower that one cap for good, or put the lower cap behind a switch.

## Blockers / deciding constraint
- **Which number he means** (question a). Everything below assumes Summary's LUCK.
- **The close-game formula is Tim's own** (2025 sheet: `150/margin − 7·sign`, clamped ±50; `js/stats.js:66–69`, comment says do not retune). Changing what it may count changes what his LUCK means — his decision (question b).
- Facts are never adjusted: scores, records, points for, Highest/Lowest week tiles, the Actual grids, ESPN's own numbers.
- House rule: a preview's rows add up to its cell.
- With 4 weeks played every week is 25% of a mean; most early "skew" is small sample, which no outlier rule removes (evidence 4). The effect of this fix fades on its own: ±50 against ±20 is 7.5 points of LUCK per close game at 4 weeks and about 2.3 at 13.

## What the evidence says
All measured 2026-10-06 on league 1241838, weeks 1–4 final, 10 teams, 40 team-weeks, read off Stats' Week by week grids (headless, whole points), recomputed in a script.
1. **Team scores are not outlier-heavy.** Actual − Projected: SD 22.9, outlier-proof SD (median absolute deviation × 1.4826) 21.5, range −53…+41, 2 of 40 beyond two robust SDs — what a normal curve gives. Opp scoring: SD 22.6 / 22.2, 2 of 40. Capping Act−Proj at ±43 (two robust SDs) moves two teams' LUCK, by 2.6 and 0.8, and changes one pair of ranks. *measured*
2. **The close-game term is the outlier machine.** SD 21.2 but robust SD 5.2; **10 of 40** cells are beyond two robust SDs; the cells are ±1 to ±4 in an ordinary week and ±33 to ±50 in a close one. *measured*
3. **What that does to LUCK.** `luckScore` (`js/stats.js:304`) is exactly the mean over read weeks of (Act−Proj) + (league avg − opponent's score) + close-game luck, so clipping one week's close term by x moves LUCK by x/n. Andrew Worachek lost two games by about 2 points (−50, −50): LUCK −6.5 with the term, +19.0 without — 7th vs 1st of 10. Austin Binish's one +50 is worth +12.5 of his −8.3. Capped at ±20, LUCK moves by up to 15.0 and 6 of 10 ranks change; at ±10, up to 20.0. *measured*
4. **Small sample dwarfs everything.** Dropping each team's single most unusual week moves LUCK by 5–21 points. That is four data points, not outliers; the ± already printed beside LUCK is the honest statement of it. *measured*
5. **The simulation barely cares.** The per-game spread (`calibrateSigma`, `js/forecast.js:126`) is 22.9; with the two largest misses capped 22.2; fully robust 21.5. A 10-point favourite wins 62.1% / 62.5% / 62.9%. *measured (spread), reasoned (title %)*
6. Colours: `heatScale` (`js/heat.js:230`) takes a column's own mean and SD from ~10 values, so one extreme cell flattens the rest. *reasoned from the code; not measured on a real column*
7. Nothing on the site is median-based, trimmed or capped today except the ±50 clamp and the box plot's fences (display only). *measured (grep)*

## What exists today
- `js/stats.js`: `gameLuck` `:66` (the ±50 clamp), `closeLuckOf` (tie = 0), `weekLuckParts` `:204`, `teamMetrics` `:265` (`scoreDiffLuck` `:299` = Close luck, `luckScore` `:304`), `cumulativeLuckSeries` `:241` (a separate running-total path whose last point must equal LUCK), `attachLuckMargins` `:594` (the ±). One `computeLeagueStats` feeds Stats, Summary (`js/summary-page.js:574`) and Decisions (real and hypothetical leagues, `js/decisions-page.js:1138–1139`).
- Stats: Week by week metrics Close game and Luck (cell title lists the three parts, `js/stats-page.js:1836`; Avg column = Luck score, `:1829`); standings previews (`js/standings-table.js:356`; Close luck is a mean-of-rows preview, `:411`); the explanation says "a one-point game scores near ±50" (`:431`).
- Summary: LUCK ± margin; share image and text (`js/summary-page.js:1169`, `:1375`); notes call LUCK "your spreadsheet's own column" (`:991`, `:1113`).

## Options
| Option | What it is | Cost (effort, $, risk) | How it fails |
|---|---|---|---|
| A. Lower the cap for good | One constant: the clamp in `gameLuck` goes from ±50 to ±20. Every page, chart, preview, the share image and the phone agree automatically, because there is still only one LUCK. The "near ±50" sentence becomes "±20". | Smallest: 1 constant + the tests and two sentences that pin ±50. $0. Risk low. | LUCK stops matching his 2025 sheet's column, permanently. If he later thinks ±20 is wrong it is one number to change again. |
| B. The same cap behind a switch | "Adjust outliers" switch on Summary and Stats (default his call). On: close game counts at most ±20. Off: today's numbers. Capped weeks marked in Week by week; one site-wide pref. | 1 builder, ~1 day. Risk medium: two sets of numbers must stay consistent across Stats (standings, Week by week, cumulative chart, previews), Summary (table, share image/text), Decisions (both worlds, no room for a note: its word ceiling is full). | A screenshot or the shared image does not say which mode it is in. Phone and laptop can disagree (the pref is per device). More words on pages at their ceilings. |
| C. Show it, change nothing | The LUCK preview names the week that moved it most and prints "without it: x". | Half a day. | Adjusts nothing — he asked for adjusting. |
| D. Median instead of mean | LUCK = median of the weekly sums. | Small. | Measured: changes 7 of 10 ranks, more than any cap; with 4 weeks it discards half the data; previews can no longer add up. |
| E. Also cap Act−Proj and Opp scoring | Data-driven fences on the two score parts. | Fences, a minimum-weeks floor, drift (Opp scoring is measured against the SEASON average, so past weeks' values and fences move every new week), and Decisions' two worlds would get different fences. | Measured gain: 2.6 points for one team. Changes what LUCK means for almost nothing. |
| F. Outlier-proof sim spread | `calibrateSigma` uses a robust SD. | Reaches every win %, Title %, decimal record on five pages. | Measured gain: 0.4 points of win chance. |

## Recommendation (ranked)
1. If only one thing is built, build **A (±20 for good)**. It fixes what the measurement found, keeps one LUCK everywhere, and cannot leave two pages disagreeing. ±20 because a nail-biter then counts about as much as one ordinary good or bad week (one SD of the other parts ≈ 22) instead of more than twice that.
2. Build **B** instead only if he wants to keep the sheet's ±50 visible and flip between them.
3. Nothing else now. Revisit the sim spread (F) only if a real freak week (a 60 or a 190) shows up and the stored weekly spread visibly jumps.

Technical decisions (mine): the cap is one exported constant used by `gameLuck`, so `weekLuckParts`, `teamMetrics`, `cumulativeLuckSeries` and the margins all inherit it; under B it is an option of `computeLeagueStats` defaulting to today's ±50 (so existing suites stay byte-identical with the switch off), stored on the weekly row so every reader — cell, title, Avg, chart — takes the same counted value; the Close luck column shows the counted value (it is the same quantity); the ± is computed from the counted terms; the sim, records, points for and Actual grids never read it.

## Deliberately NOT planned
- ~~Removing outlier weeks from records, points for, or the Actual grids~~ · facts; he checks them against ESPN.
- ~~Median LUCK (D)~~ · measured worse than the problem.
- ~~Caps on Act−Proj / Opp scoring (E)~~ · reviewer + measurement: 2.6 points for one team, at the cost of drifting fences.
- ~~Robust sim spread (F) now~~ · 0.4 points of win chance for a change that reaches five pages.
- ~~Outlier-proof colours~~ · unmeasured and touches rule 14 (one scale, ±1 SD); its own plan if a real column looks washed out.
- ~~Shrinking early-season figures~~ · answers small sample, not outliers; the ± already says it.
- ~~Per-player outlier handling~~ · card Avg is ESPN's own number (copied on purpose); Players' Avg is projections.
- ~~Capping Decisions' Points/wk~~ · it is literally "points you left"; capping a real 45-point bench week understates a fact.

## How this could be wrong
- He meant a different number (Stats' Week by week, Analysis' Weekly totals, a chart, an Avg dragged by a bye or injury zero) → question a, asked first; b–c are moot if so.
- Four weeks of one public league is thin; his own league may hold a real freak week → run the same measurement on his league's numbers before building (he can paste Stats' Week by week, or it is read from the phone's synced copy).
- ±20 is a judgement number → the plan's table (±20: up to 15.0, ±10: up to 20.0) is what he is choosing between; the constant is one line.

## Phases (each ships on its own)
1. **Option A or B as chosen.** Done when: a unit check fails on today's code (a 2-point game counts ±50) and passes after; `cumulativeLuckSeries`' last point still equals `luckScore`; Stats' Luck Avg column still equals Luck score and its cell title still adds up; Close luck preview still averages its rows; Summary and Decisions agree with Stats for the same league; the two sentences that say ±50 / "your spreadsheet's own column" are true again; headless 393 and 1440 on league 1241838 show Andrew Worachek's LUCK at the new figure with previews adding up; under B, every existing suite is unchanged with the switch off and the share image states the mode.

## Questions for Tim
a. Is the Summary page's LUCK the number that looked skewed (rather than some other table or chart)? · recommended reading: yes.
b. Should a close game count at most ±20 instead of ±50? · recommended: **yes** — and **for good (option A), not as a switch**: one LUCK everywhere, nothing to disagree. This departs from the 2025 sheet's column.
c. Only if he wants the switch (B): start on or off, is it called "Adjust outliers", and does the shared image show the adjusted number? · recommended: on; yes; yes, with the mode stated on the image.

## Sources
- Measurements: Stats Week by week grids for league 1241838, weeks 1–4, read headless 2026-10-06; scripts in the session scratchpad (not kept).
- Code: `js/stats.js:66, 204, 241, 265, 304, 594`, `js/forecast.js:126`, `js/heat.js:230`, `js/summary-page.js:574, 991, 1113, 1169, 1375`, `js/standings-table.js:356, 411, 431`, `js/stats-page.js:634, 1829, 1836`, `js/decisions-page.js:1138`.
