# Player Value — plan and builder brief (2026-10-09)

**Status: BUILD AUTHORIZED by Tim 2026-10-09** ("okay let's build it into the cite now").

## Tim's words (verbatim)

1. "I want to start calculating the "Value" of a player. I think this should heavily be based on the line of where top waiver players of that position are, aswell as where the line of where actual league mates are starting that position or not. Players low inside the waiver will have no value and there will be no players with negative value. This number will have no base on how well they connect with your team or anything like that, just how much their worth numberically. Maybe it's as simple as their avg proj-baseline proj or something like that, or maybe it's more complicated."
2. His four picks (question box): points between the waiver line and the starter line count at **half**, above the starter line in full · unit **points per week** · waiver line = **average of the top 3 free agents** at the position · projection = **ESPN rest-of-season only**.
3. "Note: I only want a player's value to change if their actual future projections have changed for some reason, not because we're moving the baselines or whatnot. This means you'll have to pick specific baselines and stick to them throughout the season."
4. "one principle I think is important is that in general, a player worth twice as much as another player is worth two of that other player. … If this principle doesn't perfectly match up, don't worry about it, I just think It makes it easy to think about."
5. **The build ask:** "okay let's build it into the cite now. I want it to be displayed at the top of the player's preview. Additionally for all graphs or charts that show avg position's proj or value or anything like that (except total proj like a team's proj for that week), have a switch for that graph that also shows the data as value rather than just total proj."

## The arithmetic — `js/value.js` (written, pure, on main)

- `restAvg(byWeek, weeks, byeWeek)` — mean of ESPN's projection over the weeks left, the bye week left out; a 0 for any other reason counts; null/absent weeks are skipped.
- `buildBase({rostered, freeAgents, slots, teams, week, now})` → `{v, setAt, week, lines:{POS:{waiver, starter, agents, starters}}}`. Run ONCE per league-season.
- `valueOf(base, position, x)` → to the tenth, never below 0, null when it cannot be said. `valueParts`, `lineOf`, `isBase`, `valueText`.
- **One rule for every number on the site:** a per-player projection figure `x` (a week's projection or an average) shown "as value" is `valueOf(base, his position, x)`. A slot cell uses the position of the man filling it (a slot average = the mean of the per-week values). Team totals are never converted.

## "The weeks left" (decided by Claude; the same everywhere)

Every week of the season that is not finished, regular season and the league's playoff weeks (as `js/draft-page.js` `weeksOf` does with `capture.openWeeks` / `playoffWeeks` / `playoffWeekDecided`). In the week in play a man who has already played counts at his `pregame` projection, not his score, so Value does not jump when he kicks off; the week leaves when it is final.

## Where the frozen baseline lives (decided by Claude; flag to Tim)

- Laptop: `localStorage['ff.value.<leagueId>-<season>']`. Computed once, the first time any page needs it and it is absent: `fetchWeeksRosters(weeks left)` (the store usually has them) plus `fetchWireWeek(week, WIRE_LIMIT)` for each week left (about one ESPN request a week, ONCE per league-season).
- Phone (synced copy, `season.cloudSource()`): rides the **schedule object** as `schedule.valueBase`, exactly as `scoringItems` does (`js/season.js` ~1638, `js/cloud.js` ~890 packs every schedule field). Zero extra reads, zero ESPN requests (rule 20). No new Firestore document, no rules change.
- First copy wins: when the laptop syncs and the cloud's schedule already carries a `valueBase`, the laptop ADOPTS the cloud's (and stores it locally) instead of overwriting it — the `writeProjhist` check-before-write pattern. A cleared browser must not mint a second baseline once one is up.
- Demo data: computed in memory from the demo generators every time (deterministic), never stored.
- Never in `ff.prefs` (not per league). Never committed to the repo.

## Wave 1 — core (one builder)

Files: `js/season.js`, `js/cloud.js` (only if the schedule round trip needs it), `js/player-card.js`, `css/app.css` (one appended block), every `tests/*-stub-season.mjs` that needs the new exports, new `tests/test-value.mjs`, `tests/run-all.mjs`, `tests/counts.json` (own lines), cloud tests it must extend.

1. `tests/test-value.mjs`: the pure module, including Tim's own example (waiver line 10: a 20 is worth two 15s when the starter line equals the waiver line; with a starter line of 13 → 8.5 vs 3.5), the floor at 0, no line → null, bye left out, and "moving the free agents after `buildBase` changes nobody's value" (the frozen rule, as a test).
2. `season.fetchValueBase()` → base | null (memoised per page; order: cloud schedule → localStorage → compute and store; demo in memory; never throws — null on failure and tried again next load).
3. `season.fetchPlayerValues()` → `{ base, weeks, byId: Map<playerId, {position, avg, value}> }` for every rostered player, off `fetchWeeksRosters(weeks left)`; memoised; zero ESPN requests on the phone's copy.
4. Sync: `buildCloudPayload` attaches `valueBase` to the schedule, first copy wins (above). Extend the cloud tests: round trip, and "the second sync does not replace the first baseline".
5. `js/player-card.js`: **Value at the top of the card** (Tim: "displayed at the top of the player's preview"). `registerRun({... playerId, value})`: `value` given → shown; else `playerId` looked up through `setValueSource(fn)` (a page calls `season.fetchPlayerValues()` and hands the lookup in; the card reads it when it opens, so a late answer still shows). `playerCardFromWeeks` passes the playerId itself. No value → the card is exactly as today (nothing moves). Design: read `~/.claude/skills/design-taste/SKILL.md`; plainest that matches — the word "Value" and the number, on the ident line's right or first on the glance line; no new sentence.
6. Do NOT edit page files in wave 1 (wave 2 owns them).

## Wave 2 — pages (four builders, in parallel, after wave 1 is merged)

Each: pass `playerId` (or `value`) at every `registerRun` call site on its pages and call `setValueSource`; add the **Proj / Value switch** (`.segmented.seg-sm`, remembered through the page's `prefs` scope, default Proj) to its panels below; in Value mode every per-player figure is `valueOf(base, position, x)`, colour follows the shown number, team-total rows/bands stay as they are; state the basis in the panel's tucked note (rule 7), not in always-visible words. While the baseline is not known the switch is hidden.

- **Analysis** (`js/analysis-page.js`, `analysis.html`): All teams (week and proj avg), Season by week (Position and Player rows), Who to start, Roster detail (Projected / Avg/wk).
- **Players** (`js/waivers-page.js`, `waivers.html`): Available and Taken tables (Avg and week cells), value on the expanded row's glance line. Free agents' own Value needs every week left of the wire: buy those weeks only when Value is switched on. The page is at its word ceiling (294/294): the switch's two words may raise `tests/text-ceilings.json` by exactly what they add.
- **Trade** (`js/trade-page.js`, `trade.html`): Custom trades roster lists, the Season by week / After the trade boxes, Assumed trade. The Depth map is already a value-over-replacement figure on a different bar: leave it, list it in the report.
- **Home, Stats, Decisions, Draft** (cards only — no switch): `playerId` at every card call site so Value shows at the top of every preview; Draft's dropped men get `value` from their own `byWeek`.

## Wave 2b — Draft "vs worth now" on Value (Tim, 2026-10-09, after wave 1 was launched)

Tim, verbatim: "This new value measurement has huge implications. First, lets apply it to the draft section. Instead of basing the "vs worth now" on position in the draft, base it off of their current value - their expected value based on their rank in the draft. I think the best way to do this is as follows: In order to get the number from their rank in the draft, list all the players based on preseason rank, and then take their expected value (before the season started). This expected value can fluctuate quite a bit so make a smoothed equation line based on these numbers. In order to get a more accurate line you can take historical years of fantasy data for the equation, but It's not necessary if you can't. Then, to get the expected value just plug in that player's preseason rank in the draft. … Additionally I want you to display the total value of all the player's that that user drafted at the top as a row above the first round picks below their name."

- **The curve:** the drafted players in ESPN preseason-rank order (place among drafted, 1..N — already `preseasonPlaces`); each one's preseason Value = `valueOf(base, position, preseason points per week)`, the preseason projection from `data/baselines/2026-preseason.json` scored under the league's scoring as `js/proj-trend.js` does. Smoothed into one never-rising line (pool-adjacent-violators, then a light moving average). Pure, in `js/draft-review.js`, tested.
- **Expected value of a pick:** the curve read at WHERE HE WAS DRAFTED (pick number; auction: price rank) — reading taken by Claude of "expected value based on their rank in the draft"; reading it at his own preseason rank would grade the player, not the pick. Flag to Tim.
- **+/− in "vs worth now"** = his Value now − expected value of his pick, in points a week. "Now" column = his Value now. A dropped man: his Value from his own remaining weeks (0 if nothing). "vs preseason rank" view unchanged.
- **Total row:** on the board, directly under each team's name and above round 1: the sum of the current Value of every player that team drafted.
- This year only for the curve (flag: past seasons would need old preseason projections that are not in the repo).
- No baseline (phone before a sync carries it): the view keeps today's place-based numbers.

## Deliberately NOT in this build

- Replacing the three older bars (Trade replacement level, Draft "worth now", Analysis waiver floor) — Tim has not asked.
- A Value column on Schedule / Summary (team-level pages).
- Sorting or ranking the league by Value.

## NOT verifiable here

Tim's private league through the bridge, his iPhone, the first real sync carrying the baseline to the phone.
