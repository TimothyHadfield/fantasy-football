# Decisions review — plan

> **Tim asked (2026-10-05):** "I want to make a new decisions review section, which basically allows the user to select any user and have a list of all the decisions they've made, and what would have happened if they hadn't made that that decision. In this section, we will see when a user add/drops a player, when they start one player over another, and when they accepted a trade. I also want to be able to add potential trades as if they were accepted (if this trade happened this week, what would have happened).
>
> Because we know what every single player scored every single week, we can accurately create these "mirror universes" as if they were real.
>
> In every one of these possibilities, the biggest thing I want to see is the act weekly total for that team each previous week, whether that would have changed the outcome of a matchup, and how much it would have changed the overall record.
>
> To show this "change", base it off of the trade section where we display the current season by week chart, and then the hypothetical season by week chart, as well as an option to switch the hypothetical season by week chart to a difference season by week chart which visually shows the change in what happened.
>
> So this style of current, hypothetical, and difference should be shown for the following charts: season by week, Standings and season totals, and "the chart" in the summary section.
>
> For the roster lineup decision hypothetical, show 2 different possibilities: a "reasonable" hypothetical if the user just acted reasonably and started the player with the highest proj (some users might already be doing this and don't have a hypothetical for this), and a "perfect" hypothetical if the user could forsee the future and started the optimal lineup that would give them the most points in rhetrospect.
>
> For the add/drop decision, make sure that if a user added and dropped a player in a single action, then the hypothetical counts both those actions, not just one of them.
>
> Remember that some of these actions mean that other users also had different actual scores, or potentially could not do what they did in real life.
>
> For example, I dropped a QB that scored a lot of points, making my act be lower than my hypothetical if I hadn't dropped them. However, in real life an opponent user also picked that QB up, and won a game because of the higher score. In the hypothetical where I didn't drop the QB, the opponent also couldn't have picked them up and would have started another player. For now, we will just assume that the other user behaved completely static and just played reasonably (started highest proj they had, rather than anything else). Because this is assuming things in this hypothetical world that probably wouldn't happen, we will calculate certain predictions of this hypothetical world by how much noise it has.
>
> Noise is how determined that specific action would be based on the hypothetical. It should consider how closely a certain aspect of something is from the thing that changed, as well as how different it could be in another scenario.
>
> Here is an example of noise calculated: In the hypothetical world where the 3-2 player trade between me and mitchell didn't happen, I would keep Ja'marr chase and Omarian Hampton, and Mitchell would keep James Cook III, Jefferson, and Wilson. The week after that trade was declined, almost everything would have no noise, however, the week after that, there might be some noise in other user's positions, because mitchell or me might've offered another player a trade in that scenario. This noise would be little because that is unlikely, however the longer the weeks, the more likely it is a trade with those player's could happen and other positions would start to get more noise.
>
> In another hypothetical where I didn't pick up a player who recieved a ton of points, there would be more noise around user's low performing QBs because it would be a higher likelyhood that they might pick up the player and different things would have happened.
>
> to display noise, just dim the certain cells that have noise down depeneding on the level of noise they have. Additionally, because often the user might not care about noise, have a "display noise" switch at the top of this section that is by defualt turned off.
>
> I also eventually want to be able to combine hypotheticalls, but lets just start with this for now."
> **Instruction:** build ("lets just start with this for now"). Combining hypotheticals is explicitly later.

**Status:** NOTHING IS BUILT · reviewed by plan-reviewer 2026-10-05 (5 blockers fixed: phone, request cost, the allowed player read, item-by-item replay, effective week) · Read first: "The contract" and "Phases".

## Decided by Tim
- 2026-10-05 · Other teams in a mirror universe stay static and play "reasonably" (highest projection they had).
- 2026-10-05 · An add and a drop made in one action are undone together.
- 2026-10-05 · Noise is shown by dimming cells; a "Display noise" switch at the top, off by default.
- 2026-10-05 · Lineup hypotheticals come in two kinds: reasonable (highest projection) and perfect (hindsight).
- 2026-10-05 · Combining hypotheticals: not now.

## The answer (one sentence)
ESPN's public feed already lists every add, drop and lineup move with the players and the time, and gives any player's score for every week, so the mirror universes can be replayed exactly in the browser by one new pure module and shown on one new page.

## Blockers / deciding constraint
- None hard. The deciding constraint is **one engine, one contract**: every display (weekly totals, flipped matchups, the three charts, noise) reads the same `mirror` object, so the engine is built and tested first.
- No accepted trade exists in the public test league (1241838), so the shape of ESPN's trade records is **not measured**. Trades are also detected from week-to-week roster changes as a fallback.

## What the evidence says
- `view=mTransactions2&scoringPeriodId=N` returns that week's moves for a public league: wk 1 = 207 (170 draft), wk 2 = 41, wk 3 = 52, wk 4 = 45 · *measured* 2026-10-05, curl on league 1241838.
- An executed WAIVER or FREEAGENT move carries `items[]` with `type: ADD|DROP`, `playerId`, `fromTeamId`, `toTeamId`, plus `proposedDate`/`processDate` and `teamId`. An add with a drop is ONE transaction with two items · *measured*, same read.
- Lineup moves are `type: ROSTER` with `LINEUP` items (24–32 a week). Failed waivers carry a `FAILED_*` status · *measured*.
- Transactions name players by id only · *measured*.
- `view=kona_player_info&scoringPeriodId=N` with `X-Fantasy-Filter: {"players":{"filterIds":{"value":[ids]}}}` returns, for ANY player rostered or not, that week's actual AND projection (Drew Lock, dropped and unowned, wk 2: actual 21.4, projected 15.7) plus every week's actuals · *measured* 2026-10-05. This view is already allowed by the extension (`extension/background.js:72`); `kona_playercard` is NOT, so it is not used.
- Past weeks' rosters carry lineup slot, started, actual and projected per player (`season.fetchWeeksRosters`) · *documented in code*, `js/season.js:607,812`.
- `computeLeagueStats(data)` is pure and accepts altered games · *documented in code*, `js/stats.js:519`; Summary already calls it with a filtered list.
- `forecast.optimalLineup(players, slots)` ranks on `projected`; pass actual as projected for the hindsight lineup · *documented in code*, `js/forecast.js:166`.
- The Trade page's season-by-week current/after/difference renderer is private to `js/trade-page.js` and built on projections, not actual points · *documented in code* (8743–8905).
- Stats' standings (`renderMainTable`) and Summary's table (`renderTable`) are page-private and read page state · *documented in code*.
- Nothing parses transactions today; `espn.fetchTransactions()` is only used by the debug page. `mTransactions2` is allowed by the extension. `UNSHARED_VIEWS` (`js/espn.js:130`) means the read is never de-duplicated, so a final week's moves and player-weeks are frozen in `js/store.js` after the first read (cost: 2 requests per final week once, then 0; the open week is not read at all) · *documented in code*.

## What exists today
No page reviews past decisions. Trade prices FUTURE weeks on projections. Analysis "Roster detail" shows one team-week as it happened. The data layer freezes each decided week's rosters in `js/store.js`.

## The contract (what every builder codes against)

New pure module **`js/decisions.js`** (no DOM, no fetch). Input, assembled by the page:

```js
world = {
  slots,                 // lineup slots, as forecast.optimalLineup takes them
  teams: [{ id, name, teamName }],
  weeks: [1, 2, 3],      // weeks with EVERY game final, ascending
  games: [{ week, homeId, awayId, homeActual, awayActual, homeProjected, awayProjected }],
  rosters: Map<week, [{ id, players: [{ playerId, name, position, slot, lineupSlotId,
                                         started, projected, actual }] }]>,
  moves: [{ id, kind: 'add'|'drop'|'adddrop'|'trade', week, at, teamId,
            adds: [playerId], drops: [playerId],
            trade: null | { withTeamId, gives: [playerId], gets: [playerId] } }],  // time order
  players: Map<playerId, { name, position,
            byWeek: { [week]: { actual, projected, kickoff } } }>,   // kickoff ms, null on a bye
            // must cover every id named in any move and every rostered player
  limits: { roster },    // roster size, for the note only
}
```

Output:

```js
listDecisions(world, teamId) -> [{
  id, kind: 'adddrop'|'add'|'drop'|'trade'|'lineup-reasonable'|'lineup-perfect',
  week,                  // null for the whole-season lineup entries
  label,                 // "Added Bryce Young, dropped Drew Lock"
  detail,                // lineup kinds: [{ week, out, in }] the swaps that differ
  empty,                 // true when the hypothetical equals what happened
}]
mirror(world, decision | { kind: 'whatif-trade', week, teamId, withTeamId, gives, gets }) -> {
  teams: Map<teamId, { byWeek: { [week]: { total, realTotal, projected, realProjected, changed,
            starters: [{ playerId, name, position, slot, slotId, actual, projected, isNew }],
            realStarters: [same shape] } } }>,
            // total = realTotal + (sum of mirror starters' actual − sum of real starters' actual),
            // so an untouched team-week equals its real total EXACTLY
  games,                 // world.games with the mirror actual totals
  flips: [{ week, teamId, oppId, real: 'W'|'L'|'T', mirror: 'W'|'L'|'T' }],
  records: Map<teamId, { real: {w,l,t}, mirror: {w,l,t} }>,
  skipped: [{ moveId, teamId, week, reason }],   // real moves that could not happen
  noise: Map<teamId, { [week]: 0..1 }>,
}
rosterAt(world, teamId, week) -> [players]   // for the what-if trade pickers
```

**Replay rules (maths, decided here):**
1. *Undoing a move.* The added players go back to the pool and the dropped players stay. A move made in ESPN week `s` at time `at` counts for a player from week `s` if his NFL game that week kicked off after `at` (or he had none), otherwise from week `s + 1`. The week-end rosters are only a cross-check, so a player added and dropped inside one week is still handled. A trade: both sides keep their own men. A what-if trade: the players swap from the chosen week on.
2. *Later real moves are replayed in time order, item by item.* An add happens if that player is free in the mirror, otherwise it is skipped and listed in `skipped`. A drop of a man the team does not hold in the mirror is a no-op and the add beside it still stands. A trade happens only if every player in it is where the trade needs him; otherwise the whole trade is skipped. Roster-size limits are not enforced (noted under the charts when a team ends one over).
3. *Lineups.* A team-week whose mirror roster equals its real roster scores exactly what it really scored. Where the roster differs, the lineup is changed as little as possible: real starters still on the roster keep their slots; an empty slot takes the highest-projected eligible bench player; a player who is on the mirror roster but was not on the real one starts only if his projection beats the starter in a slot he can fill. This is one READING of Tim's "static … started highest proj they had" (the other reading re-picks the whole lineup by projection, which would show differences the decision did not cause); Tim is told which was taken. IR-slot players are not eligible to start.
4. *Lineup decisions.* Only the picked team changes. Reasonable = `optimalLineup` on that week's projections; perfect = on actual points. Offered per week and as "every week". `empty` when the real lineup already matches (ties in projection count as matching).
5. *A week counts* only when every game in it is final.

**Noise (reasoned constants, in one exported table so they can be tuned):** per team-week, `noise = 1 − Π(1 − sᵢ)` over these sources:
- *Time, for the teams the decision touched* (decision team, trade partner, any team with a skipped move): 0 in the first affected week, then +0.10 per week.
- *Time, for everyone else:* 0 for the first two affected weeks, then +0.03 per week (Tim's "the longer the weeks, the more likely").
- *A freed player* (the mirror leaves a player unowned who really was owned): each other team gets `clamp((his points that week − that team's lowest starter he could replace) / 20, 0, 0.6)` (Tim's "more noise around user's low performing QBs").
- Lineup decisions: 0 everywhere.
Dimming: cell opacity `1 − 0.65 × noise`, only when the switch is on.

## Options
| Option | What it is | Cost (effort, $, risk) | How it fails |
|---|---|---|---|
| A | Replay from ESPN's transaction feed + per-player weekly scores, pure engine, new page | 4 phases, $0, medium | A move ESPN does not list (commissioner edits) is missed; trade record shape unmeasured |
| B | Infer every decision from week-to-week roster changes only | Smaller, $0 | Cannot tell an add+drop pair from two separate moves, loses order within a week — breaks Tim's "single action" rule |
| C | Put it inside the Trade page | No new tab | Trade page is 7,300 lines and about the future; Tim asked for a new section |

## Recommendation (ranked)
1. If only one thing is built, build **A phase 1** (engine + add/drops + lineups + weekly totals, flips and record) because it answers "the biggest thing I want to see".
2. Then the three current / hypothetical / difference charts, then trades, then noise.

## Deliberately NOT planned
- ~~Combining hypotheticals~~ · Tim: later. The engine takes one decision; `mirror` is written so a list can be added.
- ~~Refactoring the Trade page's season-by-week onto a shared renderer~~ · high risk in a 7,300-line file for no visible gain; the new page gets its own small renderer using the same class names and look.
- ~~Modelling what other teams WOULD have done instead~~ · Tim: static for now; that uncertainty is what noise shows.
- ~~Re-running draft decisions~~ · not asked.
- ~~Listing each of the ~28 weekly lineup moves as its own decision~~ · the week's lineup is the decision; the swaps that differ are its detail.

## How this could be wrong
- ESPN's trade records may not look as assumed → the roster-change fallback finds any trade (two teams exchanging players between consecutive weeks); checked against Tim's league when he connects it.
- The week a move takes effect is taken from the real rosters, not from ESPN's `scoringPeriodId` → disproved if a fixture shows a player added after his game counted that week.
- The noise constants are judgement, not measurement → they cannot be "verified"; they sit in one table and Tim tunes them by eye.
- Minimal-change lineups could hide a real knock-on (a kept QB would have changed who Tim flexed) → the starters are shown, so it is visible.

## Phases (each ships on its own)
1. **Engine.** `js/decisions.js` + `tests/test-decisions.mjs` on a hand fixture: the add+drop pair undone together; the dropped-QB case (the opponent can no longer add him, starts his best-projected QB instead, a matchup flips); a later "add Y, drop QB" by that opponent still adds Y; an untouched team-week equals its real total exactly; reasonable is `empty` when the team already started its best projections; perfect ≥ real and perfect ≥ reasonable; a trade undone on both sides; a what-if trade; noise 0 for lineup decisions, rising by week, higher for the team with the weakest QB when a QB is freed. Each rule seen failing when broken.
2. **Data + page.** `espn.parseTransactions`, `espn.fetchTransactions(week)`, `espn.fetchPlayersWeek(ids, week)`, `season.fetchDecisionWorld()` (frozen per final week in `js/store.js`), `decisions.html` + `js/decisions-page.js`: team picker (any team), decision list, and for the picked decision the team's actual weekly totals as current / hypothetical / difference, flipped matchups, the record change, the "Display noise" switch, and "Add a trade as if accepted". New "Decisions" tab on every page (nav-check, link-check, test-pages-render, text-audit + a `tests/text-ceilings.json` entry; all nine tabs checked at 393px). Done when the live league's list matches ESPN's Recent Activity for one team by hand, and 393px + laptop screenshots are looked at. Trades cannot be checked on real data until Tim's own league is read on his laptop.
3. **The three charts.** Season by week (slot rows × weeks, actual points), Standings and season totals (same columns as Stats, `computeLeagueStats` on the mirror games; skill and luck use the mirror's projected totals), and the Summary chart (record, luck, title %, last %: the season simulation run from the mirror's banked results with today's real rosters going forward, SAME seed in both worlds). Each: current beside hypothetical, with a switch turning hypothetical into difference. Done when an `empty` decision gives all-zero differences on every chart and a fixture decision's difference cells match hand numbers.
4. **Phone.** The world for final weeks rides in the cloud copy so the page works on Tim's iPhone for his private league. Additive only: nothing existing in Firestore is changed or removed.
5. *(later, needs a go)* Combining hypotheticals.

## Questions for Tim
a. Tab name "Decisions"? · recommended: yes (his own word) (assumed; Tim to confirm)
b. When another team's roster changes in a mirror, keep their real lineup and change only what the missing or returning player forces (rather than re-picking their whole lineup by projection)? · recommended: yes (assumed; Tim to confirm)
c. Summary chart in the mirror: title % and last % are re-simulated from the mirror's results with today's real rosters going forward. OK? · recommended: yes (assumed; Tim to confirm)
d. A move that could not have happened in the mirror is listed under the charts ("Could not have happened: …"), keeping whichever half was still possible. OK? · recommended: yes (assumed; Tim to confirm)
e. A word ceiling for the new page in the text audit (set to whatever the plain build measures)? · recommended: yes (assumed; Tim to confirm)

## BUILT 2026-10-05
- Shipped: phases 1–4, live at d4d58b2. `js/decisions.js`, `season.fetchDecisionWorld` (+ espn/store/cloud parts), `js/standings-table.js`, `js/summary-table.js`, `js/actual-season-table.js`, `js/view-switch.js`, `decisions.html`, `js/decisions-page.js`, "Decisions" tab on every page.
- Plan was wrong about: one player read returning every week's projection (it is one week per request); plain drops (they are ROSTER transactions with a DROP item, not FREEAGENT/WAIVER); the roster limit (week-end rosters include IR, so size is compared with the real roster, as `extra`). Added after building: a skipped add also cancels the drop beside it. The laptop builds the cloud copy's decision weeks at every sync, not only when the page is opened.
- Verified: suites test-decisions 94, test-decision-data 167, shared-tables-check 208, test-decision-cloud 75, decisions-check 79; Stats/Summary tables byte-identical before/after on demo and league 1241838 at 393 and 1440; live league 1241838 weeks 1–3 (41 moves): every decision of every team mirrors without error, team 7 perfect-hindsight numbers on the page match the engine; screenshots looked at, phone and laptop width.
- Still open: a real accepted trade (record shape assumed, roster-change fallback untested on real data); the Firestore round trip to Tim's iPhone; his private league through the extension; noise constants (judgement); Questions a–e are assumed, not answered; phase 5 (combining) needs a go.

## BUILT 2026-10-06 (after the plan: clarity work Tim asked for)
- Shipped (0f09d2b, 31b874d, 877576a, 8ddf1cf): tables sort and fit; Points/wk tile + column; "Biggest swap" line; every Diff opens the swaps behind it (`weekSwaps(cell)`: Slot / Started / Instead / ±); one decimal everywhere with Diff = the printed difference; Opp proj filled; Season by week sorts with heat; a click on a previewed number scrolls to Season by week with that week outlined; changed players outlined + bold in both halves; dim projection left of each actual; Avg column on the right.
- Verified: decisions-check 381, test-decisions 200 (new checks failed on the code before each change); headless 393 / 1280 / 1440 on league 1241838, screenshots looked at.
- Still open: his iPhone and private league; the Points/wk tile can be 0.1 off printed Total ÷ weeks; a man who only moved slots is not marked; wording is Tim's.

## Sources
- Measured reads, 2026-10-05: `lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/1241838?view=mTransactions2&scoringPeriodId=1..4` and `?view=kona_playercard` with `X-Fantasy-Filter: {"players":{"filterIds":{"value":[…]}}}`.
