# Outliers — plan

> **Tim asked (2026-10-06):** "I want to have some way of adjusting outliers in data, esspecially the ones that affect the weekly summary so that they don't totally skew the data. Is there any way we can do that? What do you think? Make a plan first and then tell me before you build anything."
> **Instruction:** plan only — tell him before building anything.

**Status:** BUILT 2026-10-06 (fixed ±50 single-week limit, always on; Tim: "build now"; see BUILT at the end) · reviewed by plan-reviewer 2026-10-06 · revised the same day after Tim's two answers (below) · Read first: "Decided by Tim", "The answer", "Questions for Tim".

## Decided by Tim
- 2026-10-06 · **Which number:** "the week by week column shows the breakdown of certain stats and whatnot, and the luck breakdown shows a user had a luck ranting of -90 one week, that skews the rest of their rating, when I think that a single unlucky event like shouldn't be able to affect your entire luck ranking for the season." → the target is **one week's total luck** (Stats → Week by week → Luck) and what it does to the **season luck rating** (Luck score / LUCK and the luck rank).
- 2026-10-06 · **The close-game formula stays at ±50:** "I've experimented with this in other seasons before, and I think how it is is good for now. How your points are distributed between games and whatnot is a huge deal … If we don't have the very close measurements be high then it doesn't really contribute to luck in a meaningful way. I think there are good ways to adjust the luck rankings though potentially." → ~~lower the close-game cap~~ is off the table; adjust how weeks are **combined into the season rating**, not what a week scores.
- 2026-10-06 · **The limit comes from the data, not a round number:** "use a mathematical limit, something to do with the natural spread of the distribution and whatnot. I know outliers have a specific definition based on a standard deviation I think. Tell me what you think it should be when you get it." → ~~fixed ±40~~ superseded; see "The limit" below. **Always on** (his pick). **Build: not yet** — "once you find the limit tell me".
- 2026-10-06 · **The limit is a fixed ±50:** "alright lets just round it out to a limit of +- 50 then." and "build now" → ~~1.345 SDs recomputed from the league~~ superseded: one constant, 50, clipped around zero; no drift, no fences. GO given.

## The answer (one sentence)
Leave every week's luck exactly as it is and change only how weeks add up to the season rating: **no single week counts for more than 1.345 standard deviations of the league's weekly luck (≈ ±49 today — almost exactly one full close game)**, so a −90 week still shows as −90 in the breakdown but counts as about −50 toward the season.

## The limit (found 2026-10-06, for Tim's go)
Measured on league 1241838, 40 team-weeks of weekly luck: mean −1.8, SD 36.6.
| Rule | Limit here | Weeks it touches (of 40) | A −90 week counts as | Verdict |
|---|---|---|---|---|
| Textbook outlier (Tukey: beyond 1.5 × the middle-half range) | −118 … +111 | 0 | −90 | Does nothing to his example |
| 3 standard deviations | ±110 | 0 | −90 | Same |
| 2 standard deviations | ±73 | 0 | −75 | Barely helps: at 4 weeks the rating moves −18.8 → −15.0 |
| **1.345 standard deviations (Huber's robust mean)** | **±49** | 8 | **−51** | **Recommended** |
| 1 standard deviation | ±37 | 15 | −38 | Trims a third of all weeks, incl. every close game |
- **A −90 week is not an outlier by the textbook definitions** — it is 2.4 SDs out, which a normal spread produces about 1.6% of the time, i.e. roughly twice a season across a 10-team league. So "remove outliers" in the strict sense would never fire. What he described (one week must not swing the season) is a different, also standard, tool: a **robust mean**, where every week counts but none beyond a limit.
- **1.345 SDs is that tool's standard setting** (Huber, 1964): the limit at which the average loses only 5% of its accuracy when the data are well-behaved, while one wild week can no longer drag it. It is not a number picked for this site.
- It lands at ±49, so **a full ±50 close game still counts essentially whole** — consistent with his wish that close games stay meaningful; only weeks where several things pile up are held back.
- Computed from the league's own weeks so far, around the league's mean. It settles quickly: ±61 after week 1, ±53, ±46, ±49 after week 4. Plain SD rather than an outlier-proof one: weekly luck here is two-humped (few weeks near zero), which makes the outlier-proof SD larger and jumpier (±57, and ±76 after week 1). *measured*
- Effect on a team of ordinary +5 weeks with one −90: rating at 4 / 8 / 13 weeks is −9.0 / −2.0 / +0.7 (today −18.8 / −6.9 / −2.3). *measured*

## Blockers / deciding constraint
- The weekly numbers and the close-game formula do not change (Tim, above). Facts (scores, records, points for, Actual grids) never change.
- House rule: a preview's rows add up to its cell — the season figure needs a visible row for what the limit took off.
- One season rating everywhere: Stats' Luck score, its LS rank and S+L, Summary's LUCK, the cumulative luck chart's last point, Decisions' copies (real and hypothetical worlds) must all agree.
- With few weeks every week is a large share of a mean: at 4 weeks a −90 week is −22.5 of the rating; at 13 it is −6.9. The limit matters most early and fades on its own.

## What the evidence says
Measured 2026-10-06 on league 1241838, weeks 1–4 final, 10 teams, 40 team-weeks (Stats' Week by week grids read headless, recomputed in a script).
1. A week's luck is the sum of three parts (Act−Proj, Opp scoring, Close game); the season Luck score (`js/stats.js:304`) is exactly the mean of those weekly sums. *measured + read*
2. Weekly luck: SD 36.6, range −57…+59 in this league so far. Tim's −90 (his own league) is about 2.5 SDs — rare but real: a bad score, a hot opponent and a 2-point loss in the same week. *measured / his report*
3. The parts: Act−Proj and Opp scoring are bell-shaped (SD ≈ 22 each, 2 of 40 beyond two robust SDs); Close game is the heavy tail (±1…±4 normally, ±33…±50 in a close game, 10 of 40 beyond two robust SDs). He has chosen to keep that — so the limit goes on the week's total, not on a part. *measured*
4. **What each way of combining weeks does** (same data; and a made-up team with ordinary +5 weeks plus one −90):

| Way of combining | Ranks changed vs today (of 10) | Biggest move in a team's rating | The −90 team at 4 / 8 / 13 weeks (today: −18.8 / −6.9 / −2.3) |
|---|---|---|---|
| Limit each week to ±1 SD (≈ ±37) | 4 | 9.0 | −5.4 / −0.2 / +1.8 |
| Soft limit (smooth squeeze, same scale) | 2 | 9.7 | −5.3 / −0.2 / +1.8 |
| Drop each team's best and worst week | 6 | 15.0 | +5.0 / +5.0 / +5.0 |
| Average of weekly ranks (1st–10th luckiest each week) | 8 | n/a (not in points) | bounded by "worst of ten that week" |

*measured.* A hard limit and a soft one give nearly the same ratings; dropping weeks and rank-averaging reshuffle the table far more than the problem they solve.
5. The simulation and the colours are not part of this (earlier findings: robust spread moves a 10-point favourite from 62.1% to 62.9%; colours unmeasured). *measured / reasoned*

## What exists today
- `js/stats.js`: `weekLuckParts` `:204`, `teamMetrics` `:265` (`avgLuck`, `pointsToWin` `:290`, `scoreDiffLuck` `:299`, `luckScore` `:304`), `cumulativeLuckSeries` `:241` (running totals; last point must equal Luck score), `attachLuckMargins` `:594` (the ±), `rankBy` `:672` (LS, PS). One `computeLeagueStats` feeds Stats, Summary (`js/summary-page.js:574`) and Decisions (`js/decisions-page.js:1138–1139`, both worlds).
- Stats Week by week → Luck: cell = the week's sum, its title lists the three parts (`js/stats-page.js:1836`), the Avg column equals the Luck score (`:1829`). Standings previews: `js/standings-table.js:356` (Luck score preview is PTW / Close luck / league-average rows that add up).
- Summary: LUCK ± margin, share image and text (`js/summary-page.js:1169`, `:1375`).

## Options
| Option | What it is | Cost (effort, $, risk) | How it fails |
|---|---|---|---|
| A. A limit on what one week counts | Season rating = mean of each week's luck held within the limit (league mean ± 1.345 SDs of weekly luck, see "The limit"; ~~a fixed 40~~ superseded). Weekly cells keep their real number; a week over the limit is marked and its preview says "counts as −51". The Luck score preview gains one row, "Single-week limit +x", so it still adds up. PTW and Close luck columns stay as they are. | 1 builder, ~1 day. $0. Risk medium: one function, three pages inherit it; several tests pin today's luck numbers and move on purpose. | The limit is a judgement number. A team with two huge weeks is still pulled by both (each at the limit). |
| B. The same as a soft limit | A smooth squeeze instead of a hard stop (a −90 week counts ≈ −36, a −40 week ≈ −29). | Same. | Every week's counted value differs slightly from its shown value, so every cell needs the "counts as" note — more to explain for the same ratings (measured: within 1 point of A). |
| C. Drop each team's best and worst week | "Olympic scoring". | Small. | Measured: moves 6 of 10 ranks and up to 15 points — it deletes ordinary close-game weeks too, which he said matter. Needs ≥ 5 weeks. |
| D. Average of weekly ranks | Rating = how lucky you ranked each week, averaged. | Medium: LUCK stops being in points; S+L (Skill + Luck) no longer adds. | Measured: 8 of 10 ranks change. Breaks the Skill + Luck column and the previews. |
| E. Show it, change nothing | The Luck score preview names the week that moved it most and "without it: x". | Half a day. | Adjusts nothing. |

## Recommendation (ranked)
1. If only one thing is built, build **A with the limit at 1.345 SDs** (see "The limit"): it does exactly what he described (one event cannot swing the season), keeps his weekly formula and its ±50 close games counting whole, and every number still adds up. ~~LIMIT = 40~~ superseded by his "use a mathematical limit".
2. No switch: one rating everywhere (Stats, Summary, the shared image, phone and laptop cannot disagree). The raw mean stays one glance away — it is the Luck score minus the "Single-week limit" row. Build a switch only if he asks for one (question b).
3. Nothing else now (sim spread, colours, part caps — see below).

Technical decisions (mine): the multiplier 1.345 is one exported constant in `js/stats.js`; the limit is league mean ± 1.345 × the sample SD of every read team-week's luck in the weeks being shown (so Summary's week picker and the cumulative chart each use the weeks they cover); the counted value is stored on the weekly row so every reader (Avg column, cumulative chart, margins, Summary, Decisions) takes the same one; the ± is computed from the counted weekly values; the limit moves a little as weeks are added, so a past week can cross it — the page prints the limit in use; Decisions' hypothetical world uses the REAL world's limit, so a Diff never includes a moved limit; under 2 team-weeks (no SD) nothing is limited; weeks without projections stay skipped as now (decision of 2026-10-06); ties and the close-game rule untouched; the sim, records and points for never read it.

## Deliberately NOT planned
- ~~Lowering the close-game cap~~ · Tim, 2026-10-06: "how it is is good for now".
- ~~Caps on the separate parts~~ · the limit is on the week's total; part caps drift (Opp scoring is measured against the season average) and measured gain was 2.6 points for one team.
- ~~Dropping weeks (C), rank-averaging (D), median~~ · measured to reshuffle more than the problem; D breaks Skill + Luck.
- ~~Robust sim spread~~ · 0.4 points of win chance for a change reaching five pages.
- ~~Outlier-proof colours~~ · unmeasured, touches rule 14; its own plan if a real column looks washed out.
- ~~Removing outlier weeks from any fact (records, points for, Actual grids, Decisions' Points/wk)~~ · facts.

## How this could be wrong
- 1.345 SDs may be too tight or too loose for his league (its SD is not measured yet) → the build prints the limit in use and, per over-limit week, raw vs counted; the multiplier is one line.
- A limit that moves weekly could make a past week flip in and out of it → measured drift ±61 / 53 / 46 / 49 over weeks 1–4; if that reads as noise on the page, freeze it or switch to a fixed number.
- He may mean the luck RANK only, not the Luck score → same code; the rank follows the score.
- Four weeks of a public league is thin; his −90 week is in his own league → check the build on his league's numbers (phone's synced copy or his screen) before calling it done.

## Phases (each ships on its own)
1. **The limit.** Done when: a new unit check fails on today's code (a −90 week counts −90) and passes after; with no week over the limit every luck number on every page is byte-identical to today; the cumulative chart's last point equals the Luck score; Week by week's Luck Avg equals the Luck score and an over-limit cell is marked with its counted value in the preview; the Luck score preview adds up with the new row; Summary LUCK and Decisions' copies equal Stats for the same league; word ceilings respected; headless 393 and 1440 on league 1241838 with a seeded −90 week (the live league has none) looked at.

## Questions for Tim
a. ~~How much may one week count?~~ → "use a mathematical limit … Tell me what you think it should be when you get it" (2026-10-06). Found: 1.345 SDs ≈ ±49. **Open: his go on that figure.**
b. ~~Always on, or a switch?~~ → Always on (2026-10-06).
c. Wording, his to change: the mark on an over-limit week, "counts as −40", and the preview row "Single-week limit". · recommended: build with these and he edits.

## Sources
- Measurements: Stats Week by week grids for league 1241838, weeks 1–4, read headless 2026-10-06; scripts in the session scratchpad (not kept).
- Code: `js/stats.js:204, 241, 265, 304, 594, 672`, `js/summary-page.js:574, 1169, 1375`, `js/standings-table.js:356`, `js/stats-page.js:634, 1829, 1836`, `js/decisions-page.js:1138`.

## BUILT 2026-10-06
- Shipped (5a7be67, merge 680a0da; one builder): `WEEK_LUCK_LIMIT = 50` in `js/stats.js`. Season `luckScore` = the raw score + mean over read weeks of (clamp(week total, −50, +50) − week total); weekly rows carry `weekLuck` / `weekLuckCounted`, `parts.limit` is the adjustment; margins use counted weeks. Week by week → Luck: real numbers, an over-limit cell has a dotted underline and "Counts as −50 toward the season", a key line appears only when a cell is marked, Avg = Luck score. Luck score preview: a "Single-week limit" row when it rounds to non-zero. Summary LUCK, share image/text, Decisions copies inherit it. `gameLuck`, PTW, Close luck, Luck/wk, Opp Avg untouched.
- Plan was wrong about: the limit (Tim chose a fixed ±50 over the data-driven 1.345 SDs — everything in "The limit" about drift no longer applies); the cumulative chart (each point is the Luck score as it stood after that week, not a running mean of season-end counted values); Summary's share line had to be reworded to fit the 280-word ceiling ("LUCK = average weekly luck, one week ±50 at most, weeks 1–4").
- Verified: new checks failed on the old code (99 in stats-order, 14 in shared-tables-check) and pass; a league with no week over ±50 is byte-identical to before; alone on merged main: stats-order 907, shared-tables-check 302, test-summary 327, text-audit 9 (builder also ran stats-fit, stats-weeks, opp-check, cross-sim-check, pages-done-check, test-decisions, decisions-check, test-pages-render, touch-check green); headless 393 and 1440 on league 1241838: 6 cells marked, Avg = Luck score for all ten teams, no overflow; I looked at the 393 screenshot.
- Still open: the preview card was never seen open in a screenshot (rows read from the DOM: 119.4 − 123.1 + 14.7 + 12.3 − 2.4 + 0.1 = +21.0); a week marked by its PRINTED number (+50.3 prints "+50" unmarked but counts 50); the League footer row under Luck averages real numbers; Tim's own league with the −90 week; his iPhone; every new string is his to change.
