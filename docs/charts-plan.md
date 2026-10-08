# Charts plan — sizes, spacing, and view switches

**Status: AUTHORIZED, NOT YET BUILT (2026-10-08).** Builder goes out after the preview base and the Roster-strength move are merged (same files: `js/charts.js`, `js/stats-page.js`, `js/schedule-page.js`).

Tim, 2026-10-08, verbatim:
- "I also want to play around with displaying data in different ways when approriate, and at least give the option of switching it to a differnt view. I think cumulative graphs are often really nice but there are also other great alternatives. Look into this and see if there are good places we can add options to display different types of these graphs or whatnot."
- "Speaking of charts, I know there are a couple places charts are either too small or too spread apart in order to better understand. Could you check out specific places this happens and see if you could improve any of this? Go ahead and fix it if you find potential improvements."
- Asked which switches: **"Top 5 (Recommended)"**. Asked about zooming the teams scatter: "if you ever have a recommended option for something, just go with it, you don't need to ask me if you recommend it." → zoom to fit.

Audit: headless, league 1241838 (4 weeks played), 393 and 1440. Only Stats and Schedule draw `js/charts.js` charts. All chart text 11–12px, no overflow.

## A. Size and spacing fixes (all to build)

1. **Schedule `#forecastChart`, `#simChart`** (`schedule-page.js:2436`, `:3018`; bar cap `charts.js:680`). Laptop 1362×240, bars 24px in 118–130px bands (~20% ink). Fix: bar width `min(band*0.7, 72)`; cap the chart ~720px wide or sit it beside the stat row; label every bar when the band ≥ 34px. Phone is fine.
2. **Stats `#chartCumLuck`** (`stats-page.js:635`, `stats.html:338`). Laptop plot 1292×256 (5:1), 480px below Weekly luck. Fix: fold into the Weekly luck panel behind switch B1. `tests/stats-order.mjs` reads panel order.
3. **Stats Schedule luck `.oppbars`** (`stats.html:41,50`) (+ Roster strength, now moving to Stats beside it). Laptop bars ~800×9px with a 280–320px gap between name and bar. Fix: name column `minmax(90px, 190px)`, bar height 9→14, list max-width ~820px.
4. **Stats `#chartFitTeams`** (`stats-page.js:1636`; shared domain `charts.js:1160-1169`). Dots fill 24% of the width. Fix: fit x and y domains separately, clip the y=x line to the plot.
5. **Stats `#chartBox`** (`stats-page.js:679`; `charts.js:841-842`). Colour bug: rows pass no `color`, so a team's colour differs from the line charts → pass `SERIES_COLORS[team index]`. Phone: gutter 38%→32%, label font 12→11 under 420px. "Points" touches the tick row → bottom margin 34→42.
6. **Line-chart legend on phone** (`charts.js:530-556`): 5 rows, 100px, ×3 charts. Fix: under 420px first names or truncate at ~90px → 3 rows.
7. **Stats `#chartDist`** laptop bars 41% ink → fixed by the cap change in 1.

## B. View switches (build 1–5; host = the small segmented control Stats already uses for "Colour by", `.segmented.seg-sm`)

1. Stats Weekly luck: **Per week / Running total** in one panel (removes the Cumulative luck panel).
2. Stats Weekly scores: **Per week / Running total / vs league avg / Rank**.
3. Schedule forecast histogram: **Exactly N / At least N**.
4. Schedule sim histogram: **Each place / This place or better**.
5. Stats Score spread: **Boxes / Every week as a dot** (small new mark in charts.js).

Not picked (parked, Tim can ask): 6 Week-by-week grid as lines · 7 Projected-vs-actual as miss by week · 8 Schedule luck bars from league average · 9 my team over the league's score distribution · 10 Analysis Weekly totals as lines.

Rules: the choice is remembered per viewer (`js/prefs.js`), labels 1–3 words, nothing moves when switching (same plot box), both widths, each view's marks get a preview (docs/previews-plan.md).
