# Fantasy Football — progress

Live: https://timothyhadfield.github.io/fantasy-football/ · Repo: https://github.com/TimothyHadfield/fantasy-football

## START HERE
1. Read this file (short, current). Then `chat.md` (what each session asked and did).
2. Nothing is half-built. Everything through 2026-09-24 is on `main`, green on CI (c6c7fdd, Trade Phase 3) and live.
3. `AUDIT.md` is the other work queue — §1, §2 (bar 2.6), §3, §6.5, §6.6 are done; the rest is open. The live build queue is `docs/trade-rework-plan.md`: **Phases 1–3 are built, Phases 4–6 are not.** Deep history: `docs/archive/progress-2026-09-21.md` (the old 250 KB PROGRESS) and `docs/archive/handoff-2026-09-21.md` (the old HANDOFF, incl. rules 1–18 in full).

Last updated: 2026-09-30 (Analysis roster card; Trade: "Open in custom trades", custom-list name hover card, netted meeting week in the pop-up; custom box: slot-by-slot is a floating card on the "Week N" label, "You play him" weeks beside the picker; two season-by-week boxes now/after with squad toggle under the builder; see chat.md).

Read-before-touching (sections of `docs/archive/progress-2026-09-21.md` unless noted):
- Trade engine / finder / combo → "The Trade page", "Per-week trade valuation", "2026-09-21 — the Trade page opens on a goal"; `js/trade.js`, `js/trade-odds.js` headers.
- Trade ranks, ties, wording, precision → `docs/trade-rework-plan.md` "BUILT 2026-09-23" + rule 19 below. Do not touch `EPS` or `TIE_BAND` without reading both.
- Anything that spawns a child process in `tests/` → the header of `tests/emit.mjs`, then the last two Traps.
- Colour scale → "The one red/green scale" (2026-09-19 later) + AUDIT §1.1 (fixed 2026-09-21).
- Floor → "The positional floor" (2026-09-18), "The floor is the THIRD-best free agent" (2026-09-19).
- Simulation / playoffs → "The playoffs, and the hybrid final placing".
- Time machine / archive → "The time machine" + AUDIT §2 (data being lost weekly).
- Stats maths → "Stats module — reverse-engineered from Tim's 2025 sheet".
- Phone layout → "The phone (2026-09-15)"; archive HANDOFF "The phone layout".
- Cloud/phone read → "The cloud sync"; archive HANDOFF "The cloud, and the phone".

## Goal right now
Tim, 2026-09-21: "I basically want to keep working on big improvements in the display, formating, and calculation system with the cite. Something I want to get down really well is the Trading system. I want the cite to offer virtually the perfect trade to the user."
On what "best" means: "the user should essentially open with a goal and all the data aligns with that goal. They can either choose between not losing or winning everything … The trade should be ranked by the increase/decrease in this chance." On acceptance: "rank by expected value, but add a good amount of leeway."

## Status
**On `main` and live:** the Trade page opens on a goal (Win it all / Don't finish last), prices the playoff weeks under the title goal, plays every finder offer out in the season simulation on one seed, ranks by (your chance gained) × P(he says yes). Goal column second, beside Manager.

**Merged 2026-09-21 (75247c7, from branch `goal-candidates`)** — Tim: "yes go ahead and deploy 1-5 now":
1. Goal chooses the CANDIDATES: per-week weights from the sim (`weekWeights`), finder keeps deals by weighted gain; `rankBy` = weighted gain × P(yes) (without it every finalist was a fleece); partner may lose ≤2/wk (`THEIR_MIN_PER_WEEK`). Demo wk5 title: best expected gain +2.4% → +6.8%.
2. 2-for-2 searched (`kind:'two'`, top 10 pieces a side, `TWO_CAP`), own filter button.
3. Best combo chooses by the same weights + `partnerMin` tolerance (without it the combo emptied — "make none"); headline shows slate's goal change and P(all say yes); custom builder + saved rows + pop-up show the goal (shared `goalContext()` in trade-page.js).
4. Emptied roster spot: already credited at the floor when the wire is read — proved (`test-trade-odds.mjs` §13); the note that said otherwise is corrected.
5. Trade deadline: `espn.parseTrades` → `fetchSchedule().trades` → line under the page title.

**Tests (2026-09-21, on the merge):** `npm test` 39/39 green, tr-test 614/614. The two old-ranking assertions were re-aimed, not weakened: the own-man checks open offers in order until one moves a man of his own (demo: the 2nd); the merge checks run the live stub again with `TR_KIND=depth` (on the whole finder the combo takes Cy's 2-for-2 as one deal, so nothing merges; 1-for-2 still packs two Cy deals). Both were seen failing first. tr-test also pins older scenarios to goal "last" (`boot`) and waits with `settleGoal()`. Phone view at 393px: no page overflow, finder shows goal % and "% yes".

**AUDIT §1 fixed and merged 2026-09-21** (builder wave, each fix seen failing first; full suite 40/40 incl. new `heat-draw-check.mjs`):
- 1.1 heat tint draws on zebra/`tr.me`/hover/`td.name` rows (shorthand → `background-color`).
- 1.2 Analysis `A week` grid uses the league's own slots (ten in Tim's league) and floors the Total like Proj avg.
- 1.3 Home's win chance is floored like Schedule's (`capture.matchupOdds` floors option). 1.4 `capture.floorWeek()` = first projected week, used by Schedule/Stats/Home/Summary. 1.5 those pages disclose the floor via `describeFloors`; the "byes sit down on their own" note is corrected. 1.6 a tie counts as half a win in Expected wins. 1.9 Home rank sorts on raw totals; Stats chart highlight keyed on team id.
- 1.7 Players page `meanOf` = D7 (only weeks > 0), rounded like the trade engine; taken-check/cmp-check stubs updated to match.
- 1.8 `flooredValue(player, floors, slotId)`: a zero man in a combo slot (FLEX 23, 3, 5, 7) floors at the SLOT's floor; Analysis cells pass the slot too.
New wording (Tim's call, not asked): Players Avg tooltips/notes, Analysis FLEX legend "best for that slot", floor sentences behind Schedule/Stats/Summary/Home toggles.

**AUDIT §2 fixed and merged 2026-09-22** (builder wave; each fix seen failing first):
- 2.1 a reading is filed under the week it describes: the playoff weeks are read through the bracket (15, 16, 17), and a reading whose first projected week isn't its own week is refused and recorded as a failure.
- 2.2 the connection bar's reading is floored on the same floor week as the Schedule page's (needed two lines in `js/connection.js`); every reading records the floor and the wire's week. `test-capture.mjs` now runs on a non-empty wire.
- 2.3 SCHEMA 2: your roster's per-week projections plus the other squads' starters, stored as rows. v1 readings still hydrate, export and restore byte-for-byte (`tests/snap-v1-fixture.json`, written by the old code). Measured: 363 KB for a 17-week 10-team season (cap 400 KB); export file 852 KB.
- 2.4 a stored week records whether byes were known; a byes-unknown week is re-read once the bye read works (old entries count as unknown). 2.5 a `final:false` entry is refused once the week has a result.
- 2.6 STILL OPEN — only Tim can press Export archive; no file in Downloads as of 2026-09-22.

**Also 2026-09-22:** the custom box's "also send" suggestions follow the goal (goal-weighted gap, tie-broken by gain × P(yes); points until the weights are in, and the key line says which). A trade's player cards mark **the weeks you play that manager** with an arrow under the week number (`vsWeeks`/`vsName` in `weekRun`; `meetingWeeks()` reads the league schedule) — Tim, 2026-09-21: "add a little arrow pointing to the week that the user is playing you in the preview".

**AUDIT §3 done and merged 2026-09-23** (the test safety net): the Pages deploy is a second job in `.github/workflows/test.yml` gated by `needs: test` (3f9c82a); draft/waivers/debug are booted by a suite; `sortable.js` and `charts.js` have a suite each; `text-audit` counts RENDERED prose and has a ceiling; `counts.json` fails the run when a suite's assertion count FALLS (§3.5); the colour keys are checked on screen. Plus §6.5/§6.6 — Home's standings and Schedule's Results deleted as ESPN duplicates (index −535 px, schedule −450 px). Then 498a86d: the page suites poll the page's own signals instead of sleeping, and time budgets scale with a measured machine factor — the old fc-test/wv-test/test-trade-weekly load failures are gone.

**Live bug found and fixed 2026-09-23** (482283a): the Schedule page's source line sat on "Reading ESPN's projections… week 15 of 16" forever, because `refreshStrength`'s progress callback returns early on the last week. Fixed with `restoreStatus()` after the roster read; seen failing first (2 of 1085 fc-test assertions).

**Trade rework Phase 1 done and merged 2026-09-23** (32ce66e — the honesty pass from `docs/trade-rework-plan.md`): near-ties are declared as ties instead of ranked (the band is MEASURED, and the grouping happens in the DISPLAY — widening the sort's `EPS` would have been a sort bug); negative "He gains" cells are no longer painted green under a panel called "Trades that help both squads"; false precision dropped. Tim's four answers, 2026-09-23: **no** answer block ("leave the table as the answer"), **yes** show near-ties as tied, **yes** collapse the empty custom builder on a phone, **keep** Best combo.

**Trade rework Phase 2 built 2026-09-24** (Tim: "begin phase 2"): once ten offers are played out they are ranked and repainted at the top. The rest are faded (`tr.unranked`) with no rank and no %, and the line says "faded rows in points order", until the full sort at the end. See the plan's "BUILT 2026-09-24".

**Trade rework Phase 3 built 2026-09-24** (Tim: "start phase 3"): the page runs ONE weekly search per load (it bought the played weeks after a points search, then searched again); `weekWeights` reuses the page's base sim; one `espnLookPerWeek`; and **He gains is priced over the weeks he will play** — each playoff week weighted by his chance of playing it (`playoffReach`, read off the base sim), in the finder's gate, the yes-curve, the column and the note. This changes which offers exist under "Win it all". See the plan's "BUILT 2026-09-24 — Phase 3".

**Trade rework Phase 5 built 2026-09-27** (Tim: "go with phase 5."): pop-up packages one man per line (V3); ▲/▼ beside the per-week number (V4); "Tick who moves" once, in `--dim` (V5); shape filter 3+2 on a phone (V7); below 900 px the week peek opens in a row under the tapped week and scrolls to it (V12); the deal pop-up and custom breakdown open on the biggest-swing week (V17); depth map's visible key says it is not the ±1 SD scale (V18). **V20 rejected on measurement** — the week picker still changes results under "Every remaining week" (week 1→4 moved every finder row, 5.9% → 1.6%).

**Summary Record column 2026-09-27** (Tim: "shows each players win/loss ratio aswell (4W/2L)"): `7-1` (a third number, `7-1-1`, only with a tie — Tim picked this over 7W/1L, "a little messy", same day) after Member in the table, the image card and the text copy; counts the games the sim banks, so it follows the through-week picker. Tie fixture: `tests/sum-tie-demo.mjs`.

**Trade 2026-09-29 (Tim's own asks, 904ec08 + 69e6aa6):** finder/combo/custom rows show BOTH "Δ title chance" and "Δ last chance" — the selected goal ranks, the other is a preview computed on its own basis (its own span, same seed). The Win it all / Don't finish last switch is copied above the finder, combo, depth and custom panels; one goal state, all copies sync. "His proj vs you" = Σ `theirByWeek` over the remaining regular-season weeks you meet the partner ("—" if none); also "↑ his −2.3" on the meeting week in the pop-up. The head-to-head shift WAS already in the goal % (`offerDeltas` → `shiftSeason`), but NOT in the finder's candidate gate (`js/trade.js` weighs only your weeks), the pre-selection, or You gain / He gains. Custom box split: your week box | your roster | his roster | his week box (same renderer, his side reach-weighted). "Also send" removed, incl. `js/trade-suggest.js` and `tests/test-trade-suggest.mjs`.

**Phases 4 and 6 of `docs/trade-rework-plan.md` are NOT built** — 4 density (the phone page is 6,091 px, an empty custom builder taking 37%), 6 closed-form week weights. Phase 4 needs Tim's answers to plan questions **d** (which columns survive on a phone) and **f** (the finder panel's wording). Behind the plan: `docs/trade-review-calc.md`, `docs/trade-review-view.md`. The yes-curve rebuild is parked.

**CI is green for the first time (2026-09-24, a0d0dc4).** Every suite passed on Windows on node 22 and 24 and `tr-test` failed on every GitHub Linux run — the cause was the harness, not the site. A child scenario printed its answer with `console.log` and then `process.exit`, and on POSIX stdout-to-a-pipe is ASYNC, so most of a 148–227 KB line was thrown away; the parent read half a line and node printed the truncated JSON as the offending source (three lines, no assertion, no clue). All twelve scenario-spawning suites now hand their answer back through `tests/emit.mjs`, which `writeSync`s in a loop and treats `EAGAIN` as back-pressure — node makes a pipe non-blocking, so a write bigger than the 64 KB buffer is refused the moment the reader falls behind, which was the second half of the bug. `run()` in tr-test now names the reason and prints the payload's size and tail when a line will not parse, and the workflow re-runs a failing suite unfiltered.

## Authorized next steps
- ~~2026-09-21 · Finish and ship items 1–5~~ done, merged 75247c7.
- ~~2026-09-21/22 · "alright start working on the projects you reccommend" / "alright do what you think needs to be done next"~~ — taken as AUDIT §1 → §2 → §3, all done bar 2.6 (Tim's to press).
- ~~2026-09-23 · "do the cut and test safety net. Once you're done, I want you to really analyze our trade section and make a plan"~~ — the cut (§6.5/§6.6), §3 and `docs/trade-rework-plan.md` are all done. Phase 1 was built under the same go-ahead.
- ~~2026-09-24 · "begin phase 2"~~ — staged ranking built. That go-ahead covered Phase 2 only.
- ~~2026-09-24 · "start phase 3"~~ — search once + his side over the weeks he plays, built. That go-ahead covered Phase 3 only.
- ~~2026-09-27 · "go with phase 5."~~ — built and merged (V3/V4/V5/V7/V12/V17/V18). V20 deliberately not built: the week picker is live under "Every remaining week". That go-ahead covered Phase 5 only.
- ~~2026-09-27 · "…shows each players win/loss ratio aswell (4W/2L)…"~~ — each MANAGER's record in the Summary table, image and text; merged 62563a0, live.
- **2026-09-29 · "show 2 columns on the trade, one for change of win % and one for change of losing %, as a preview for the setting that the user isn't currently on. Also above every box in the trade section have the to win or to not lose choice and it changes for all of the other identical buttons aswell … just make a opp proj diff that calculates how much my opponent's projection changes after the trade, only for the week that I play them."** — ~~built~~ 904ec08. Read: opponent = trade partner, week = remaining regular-season meeting week(s). Measured before building: the sim already shifts the partner's score in the head-to-head week (`offerDeltas` → `shiftSeason`), so the goal % counted it; the new column makes it visible.
- **2026-09-29 · "adjust the custom trade box so that it's split down the middle of the screen, all details about one user is on one side … identical varient on the opposite side that is for the opponent … could we remove the "also send" suggestions? I haven't found them usefull at all yet."** — ~~built~~ 69e6aa6. Forced split at 390 px gave 163 px halves with names cut to "O.", so the phone STACKS (your half above his); split from ~1100 px.
- **2026-09-29 · "highlight a player's name if they have a BYE the week that the users play against each other … giving the player away … green … recieving … yellow."** — ~~built~~ 7a04e3d (merged 2026-09-30). Green/yellow pill on the name (yellow token `#e8d44d`) in finder, combo, saved/custom rows, pop-up, both custom tick lists. Read: bye in any remaining regular-season meeting week. NOT verified on real byes (screenshots used faked byes).
- **2026-09-29 · "In the players section, show previous week's scores/proj by showing a preivew when the user over's over the player's name, but only show the weeks that have already passed."** — ~~built~~ d38e1d1, merged 2026-09-29. Hover/focus/tap a name → the shared player card with played weeks only (Proj/Act rows; "Bye"; "—"). **Measured: ESPN still returns each PLAYED week's projection beside the actual** (league 1241838) — rule 8 is about projections as they drift, not the final per-week line. Lazy: 0 requests until first hover, then one read per played week (store first), then 0. `espn.js` free-agent read now keeps the actual score; `player-card.js` takes an optional button label. Phone tap now opens the sheet (jump-to-row is its button) — Tim's call. NOT verified: a week a rostered man was a free agent shows "—"; cloud (phone) path probably lacks free agents' played weeks.
- **2026-09-29 · "Also in the trade section, underline a player's name if they are on the injury report in the home section."** — ~~built~~ 528471f. Any non-healthy ESPN status by Home's rule, bench men too (Home lists starters only); rule shared in `js/injury.js`, Home output byte-identical.
- **2026-09-29 · "put a up or down arrow by that player's name if their rest-of-season proj/week has increased or decreased by more than 2 than it was at the begginning of the season. make the down arrow red and up arrow green. make sure it's small."** — ~~built~~ c309af3 + 37ff9dc (merged 2026-09-30): `js/proj-trend.js`, `data/baselines/2026-preseason.json` (501 players, 222 KB, built by `tools/build-baseline.mjs`), rescored with the league's `scoringItems` (`season.js` now keeps them on the schedule). 7.5px ▲/▼ after the name, Players (both tables) + Trade (finder, combo, pop-up, custom lists, saved rows); not on player cards. "Now" = all remaining REGULAR weeks regardless of the Players span (lazy read after paint: first visit 11 wire + 11 rosters vs 3+3; revisit 11 wire, wire isn't stored). Demo shows 0 arrows (invented players). NOT verified on the real league / phone; phone needs a desktop sync to carry scoring. Threshold read as > 2 points per week. **Baseline FOUND (measured 2026-09-29):** ESPN's own `102026` season split is overwritten to rest-of-season (Gibbs 365.7/17g preseason → 365.7/14g now), so ESPN live has no baseline; but a Wayback copy of ESPN's player feed from 2026-09-09 (day before kickoff) has preseason totals for ~500 players with raw stats (`web.archive.org/web/20260909134305id_/https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/247693678?view=kona_player_info_edit_draft_strategy&platformVersion=0155a883398e9b366a9297c29085da9a89ac2192`); backup copy 2026-09-03 league 1531429601. Plan: commit it once as `data/baselines/2026-preseason.json` (scored stats only), rescore with the league's `scoringItems`, baseline /wk = total ÷ `stats.210` games; current = Players page `meanOf` (D7), D/ST from per-week lines. No arrow if not in the capture. Demo: 63 up, 50 down of 598.
- **2026-09-29 · slot-by-slot "massive discrepancies" (Hampton 12.4/wk vs 11.8 vs 17.6).** Root cause measured: numbers correct per week; the split custom box's two halves had SEPARATE week states (opened on different biggest-swing weeks) and hover drift moved the panel as the pointer crossed rows — 17.6 was Hampton's week 1, 11.8 week 6, 12.4 the span average (D7). ~~Fixed~~ d9647ad: one shared week for both halves (opens on your biggest swing), hover previews only over a week table / click-tap-focus pins (pop-up too), "Week 2 (played)", visible line "Per-week numbers are averages over weeks X–Y." under finder, custom box, pop-up.
- Phase 4 needs his answers to plan questions d and f; Phase 6 needs a go.
- **Tim's own two jobs:** set [Pages → Source → GitHub Actions](https://github.com/TimothyHadfield/fantasy-football/settings/pages) so the test gate actually bites, and press **Export archive** (weeks 1–2 exist only in his browser).

## Standing instructions
- **Push every change when it is done** — Tim judges by the deployed site. Never push failing tests. Split into sensible commits.
- **Give links, not prose directions.** Deep links; IDE-clickable paths.
- **After pushing, tell him to hard-refresh** (Ctrl+Shift+R; iPhone: close/reopen tab or `?v=<sha>`). Pages cache is 10 min.
- **Prose, not mechanics** — lead with the finding; he reads the words, not the tool calls.
- **Complement ESPN, don't replace it** — build what ESPN's app lacks; he deleted Schedule's standings for this reason.
- He checks numbers by hand against ESPN; when he says a number is wrong he is usually right. Test the claim before defending code.
- His vocabulary: "players" can mean managers; "sorting" has meant the position filter. Say which reading you took.
- He sends asks mid-task: finish what is in flight first.
- Parallel agents: disjoint file sets; a test spanning any shared seam; verify the whole tree yourself; make every fix falsifiable (break it, watch it fail, restore).
- House panel shape: title → one `.lede` → controls → table → one-line key → `<details class="explain">` "How this works". New explanation goes behind the toggle; warnings/refusals/inversions stay visible. Run `text-audit.mjs` and `measure-layout.mjs` after adding words.
- Session start: check `C:\Users\timha\Downloads\fantasy-archive-*.json` and `data/snapshots/`; ask whether the Time machine recorded this week and whether he pressed Export archive.

## The rules that must not be re-litigated (full text: archive HANDOFF)
1. ESPN publishes projections, never odds — every % is our model and says so.
2. ESPN projects every future week incl. 15–18; bye = 0.00 ≠ null. D/ST projects in its bye → site forces 0 in a known bye week. No 13-week ceiling.
3. No bulk form: one request per week.
4. Free-agent week works only without a stats filter alongside `scoringPeriodId`.
5. Statistics return null below their data thresholds; pages print "—".
6. Never read localStorage for league config directly — `savedConfig()`/`onConnection()`.
7. State the basis of every derived number in a panel note.
8. ESPN keeps no projection history — capture it while on screen (`js/snapshots.js`).
9. A squad is its team id, never its label.
10. Trades priced by the lineup each week, not a season average; per week first, total as sub-number.
11. A combo's gain is not the sum of its trades' gains — price the combined move once.
12. Archive's durable home is `data/snapshots/<league>-<season>.json` (export is cumulative, monthly).
13. Positional floor = 3rd-best free agent (`FLOOR_RANK=3`); never invented; never changes who starts; a floor on one panel and not its neighbour is worse than none.
14. One red/green scale (`js/heat.js`), ±1 SD, same slot/column only; the tint is a background-image and every row rule (zebra, `tr.me`, hover, `td.name`) sets `background-color` only, never the `background` shorthand, which erases it (fixed 2026-09-21, enforced by `tests/heat-draw-check.mjs`).
15. `js/store.js`: played week final for the season, future week fresh 6 h, unknown never final.
16. A key under a coloured table is one sentence; thresholds behind the toggle.
17. Player card: bold = "he starts" (future weeks only; received men solved against YOUR roster with the trade).
18. Trade page opens on a goal and ranks by it (see Status; `js/trade-odds.js`).
19. **A tie is a display grouping on top of a strict sort, never a sort key.** `TIE_BAND` (0.4 pp, measured) marks rows against their GROUP'S LEADER, not the row above — chaining put 39 of 40 offers in one "1=" group spanning 2.17 points. Widening `compareByGoal`'s `EPS` to the band is forbidden: the comparator turns intransitive and the points search silently gets the top row back (breaks rule 18 and D1). Two assertions pin this.

## Traps
- Tim's league (476225250, private) has a **1-day trade review period** (Tim, 2026-09-30, from the league rules). Accept by kickoff of the earliest received player − 24 h.
- `css/app.css` `.pending` is a whole notice banner; a cell with class `pending` draws one. Goal cell uses `goal-wait`.
- A `background` shorthand on a td/tr erases the heat tint (`background-image`) — fixed 2026-09-21; `heat-draw-check.mjs` fails on any new one in app.css.
- `textContent` in tests reads sr-only text too — read visible and sr-only separately.
- An assertion guarded by `if (x.length)` with no else passes when the feature produces nothing — three agents found this.
- **`settleGoal` returns on "not ranked by your…"** (it contains "ranked by your"), which the page shows on the typical week before the weekly search. That is right for a settled goal, wrong for a test that must see the goal ranking finish: `searchOnce` has its own wait (`ranked by your` and not `not ranked` and not still playing). Found 2026-09-25 when it read the count at 2 of 40.
- **The stub answers week reads instantly, which hides load-order races** (the double search was invisible until `TR_WEEK_DELAY=150` was added to `tests/tr-stub-season.mjs`). Test anything about load order with a delay.
- He gains is reach-weighted under "Win it all": `offer.theirGain` ≠ Σ `theirByWeek` there; the flat figure is `offer.theirPoints`, and per-week figures divide by `offer.theirWeeks`. Page code goes through `hisSideOf()`.
- A scenario must wait for the page to FINISH (`settleGoal`, `settleUntil`), never a fixed time — the Trade page searches and then ranks (it searched twice until Phase 3). Fixed-wait scenarios in tr-test, fc-test, wv-test and test-trade-weekly all failed on CORRECT code on a loaded machine; all converted by 2026-09-23 (498a86d).
- **A child scenario hands its answer back with `emit()` from `tests/emit.mjs` — never `console.log` + `process.exit`.** On POSIX a pipe is async, so the exit discards the line and the failure looks like a syntax error in a JSON blob. `writeSync` alone is not enough either: the pipe is non-blocking, so it throws `EAGAIN` when the reader is behind and must be retried. See the header of `tests/emit.mjs`.
- **Green on Windows is not green on CI.** Two whole days of the CI failure above were invisible locally because Windows writes stdout synchronously. When a suite fails only on GitHub, suspect the harness and read the workflow's unfiltered re-run step first.
- `text-audit` counts a page as settled only when no `.searching` span is on it (2026-09-24). Before that it measured the Trade page mid-ranking, so the old 392 ceiling was an interim figure; the true one is 395.
- The finder's status line MUST keep "playing each offer out" while the ranking runs (staged or not): tr-test's `settleGoal` treats "ranked by your" without it as finished, and the staged line contains "ranked by your".
- Anything read off the finder AFTER the sim finishes must be read off the row it was taken from, not an earlier `readTrades()` — the list re-ranks behind a pop-up.
- The machine is shared: Tim's OCR jobs (`ocrvid.py`) can hold three cores for hours, which is what makes every fixed wait fail. Check `Get-Process` before believing a timing failure.
- Worktrees: never junction `node_modules` into one you will remove (emptied `boolbase` once). On Windows `git worktree remove` fails on long paths — `rm -rf` then `git worktree prune`. Stale `.git/worktrees/*` folders (base, baseline, br, head-tr, wt) are permission-locked and harmless.
- Shell: multi-line `node -e` with backticks/`${}` gets mangled by bash — use the Edit tool.
- linkedom gotchas: `tests/README.md`.
- `sortable.js` falls back to cell TEXT and does not strip ▲ — every scaled cell must emit `data-v`.
- Headless Edge won't go below ~500px via `--window-size`; `measure-layout.mjs` uses device-metrics override and polls to settle.

## Decisions
- D1 · 2026-09-21 · Trade ranking = sim Δchance × P(yes), one seed (common random numbers; Δ noise 0.1–0.4 pts) — Tim's "expected value with leeway". (archive progress "2026-09-21")
- D2 · 2026-09-21 · A deal enters the sim as per-week point deltas for BOTH squads from the finder's own `byWeek`/`theirByWeek`, not rebuilt rosters.
- D3 · 2026-09-21 · P(yes) = logistic(((his lineup Δ/wk + ESPN-look Δ/wk)/2 + 3)/1.5): 98% at +3, 88% even, 50% at −3, 12% at −6. The one judgement; unvalidated.
- D4 · 2026-09-21 · Title goal prices playoff weeks in `weeklySpan()`; "last" goal = regular season only (pLast is regular-season table).
- D5 · 2026-09-21 (branch) · Candidates by week weights (+10 pts per week, ÷10, mean 1, floor 5%); settled goal → null weights → points.
- 2026-09-30 · Forced cut (man over the roster limit) = whoever costs the after-trade lineups fewest points over the priced weeks, tie → lower ROS (was: lowest ROS, which cut bye-week backup D/STs). aa9a2b3, tests/test-trade-cut.mjs.
- 2026-10-01 · "You gain"/+wk and the finder are NET of the partner's lineup change in remaining regular-season meeting weeks (`netGain`, `goalPoints`); raw `myGain`/`byWeek`/`theirByWeek` stay raw for the sim (no double count). 6a60779.
- 2026-10-01 · "Ask AI" last cell on every trade row copies a prompt (js/ask-ai.js); Deal column removed (Tim). 331b898.
- 2026-10-01 · Assume trade: one saved custom trade at a time rewrites both squads' rosters for everything on the page; block at top; Remove returns it. Persisted in ff.prefs. 61c367f.
- 2026-10-01 · Assume/Remove/Ask AI stacked in the last cell; column heads wrap → no sideways scroll at 1440 (Tim). 9eaa77f.
- 2026-10-01 · Custom box "Suggested" list under the pickers: every completion containing the ticked men (finder `mustSend`/`mustReceive`), finder order, always ≥3 rows (bad ones allowed, Tim), up to 5. 623a66a. Phone: list is below the 16-man roster (off screen after a tick) — Tim's call.
- 2026-10-02 · Players page gets a "Your team" select like the other pages (beside Demo/ESPN, pref `waivers.team`, falls back to the connected team if the pick isn't in the league). 39f6c6f.
- D6 · 2026-09-21 · Older tr-test scenarios pinned to goal "last" rather than rewritten.
- D7 · 2026-09-20 · Per-player per-week average = mean over weeks projecting > 0 (Tim reversed the null-in-divisor rule).
- D8 · 2026-09-19 · Floor rank 3; Proj avg is the lineup week by week; Trade page prices itself on load; store.js.
- D9 · 2026-09-18 · Floor applied at assessment, never selection; one wire read flat for every week.
- D10 · pre-2026-09-18 · Private league via `extension/` bridge; phone reads a Firestore sync (`fantasy-football-th`); Pages deploys off `main`.
- D11 · 2026-09-23 · `TIE_BAND = 0.4` pp, from 12 seeds × 10,000 seasons on the demo league (one offer's SD 0.270, the GAP's 0.318; every pair inside 0.4 swapped places in 2–9 of 12 seeds, the 1.51-point pair never did). Grouped against the leader — see rule 19. Not yet measured on Tim's real league.
- D12 · 2026-09-23 · A week that has KICKED OFF is out of a trade's span (`state.startedWeeks`), not just a week that has gone final (`g.played`) — otherwise the locked current week sat inside every gain from Sunday to Tuesday.
- D13 · 2026-09-24 · Child scenarios return their answer through `tests/emit.mjs` (`writeSync` loop + `EAGAIN` retry), because `console.log` + `process.exit` truncates on POSIX. See Traps.
- D14 · 2026-09-24 · Trade Phase 2: rank the first `GOAL_STAGE = 10` scored offers once, fade the rest (`tr.unranked`) until the full sort — staged once, not every slice, so the table doesn't reshuffle while read.
- D15 · 2026-09-24 · Trade Phase 3: every readable week is bought (span first, then played weeks + bracket) BEFORE the one weekly search; no points search followed by a goal search.
- D16 · 2026-09-24 · His side weighted by `playoffReach` (regular 1; round one P(playoffs) − P(bye); later rounds P(top size÷2^r)), a refinement of the plan's plain `pPlayoffs` — a bye is a week off and the final is reached less often. Applies to He gains, his loss limit (−2 × Σreach), the yes-curve, the combo and the custom box.

## NOT verified
- Trade pop-up netted meeting week (2026-09-30): totals left as your lineup alone — Tim may want them netted too. Real-league check of the netted cell and of "Open in custom trades" on his own team.
- Custom box floating slot card (2026-09-30): real mouse hover path (grace onto the card) checked only in linkedom + a synthetic-event screenshot; touch bottom sheet not seen on a real iPhone (on a phone the halves are removed anyway, so it only matters on a touch laptop/iPad ≥900px).
- The yes-chance curve against any real accepted/refused trade.
- The first successful "Send to phone" and phone read of the cloud sync (archive HANDOFF).
- Weeks 1–2 archived only in Tim's browser; export never done (no file in Downloads as of 2026-09-22).
- The Pages gate has never actually blocked anything: the `deploy` job has only ever run green, and Source is still "Deploy from a branch" as of 2026-09-24.
- Trade Phase 1's tie band was measured over 12 seeds on the demo league, not on Tim's real one.
- Trade Phase 2's staged moment (faded rows) lasts ~1 s in a real browser; only the tests caught it, never a screenshot.
- Trade Phase 3 on Tim's real league: the one-search saving was measured with a 150 ms/week stub, not timed live; how many offers change under the reach weighting there is unmeasured. The note's new sentence is placeholder wording (Tim's to change).
- AUDIT §1 floor wording on live data in a real browser (demo has no floors; only linkedom tests saw it). `tr.me` tint with real heat cells (demo has none in `tr.me`).
- Stats still floors weeks already played (floor.js says never) — found by the §1.4 builder, not fixed.
- Analysis `A week` picks from the manager's set starters, Proj avg from the best lineup — a benched better man still makes them differ.
- Phase 5 on a real iPhone: sticky header vs first-row tap checked only in headless WebKit; V12's scroll-to-row not seen on a device. The "Difference column clipped at 390 px" item was not separately worked — measure-layout reports no clip and the 393px screenshot shows it whole.
- Summary Record on live ESPN data (demo only). (The 9 px phone overflow measured for "10W/3L/1T" should be gone with the shorter 7-1 form — not re-measured with a tie.)
- Placeholder wording, Tim's to change: Record tooltip + note line; V17 lead line; V18 depth key sentence; "Δ last chance", "His proj vs you", "↑ his −2.3", "Jonas’s side, week by week", "plays 42%", "Per week he plays", "All weeks, by his chance of playing".
- Custom box, his side: the big per-week number is flat while his table total is reach-weighted (demo −0.9 vs −1.1/wk) — which footing to show is Tim's call, not asked yet.
- Split custom box between 900 and ~1100 px (halves stack); slot-by-slot panel scrolls sideways inside each half at 1440 px. Nothing of 2026-09-29 seen on a real iPhone.
- 070f8fe "Draft room: dark text on the light cards" came from ANOTHER session, which pushed it to origin/main itself (found 2026-09-29 when this session's push was refused); rebased on top of it. Its worktree `agent-a6db241d888f1114f` is locked — leave it. Another chat may be working on this repo in parallel: always `git fetch` before pushing.
- Older archive sections were indexed by heading for this file, not re-extracted line by line (2026-09-21 checkpoint).

## Rejected / parked
- ~~Injury-aware trade pricing~~ · 2026-09-20 · needs a miss probability ESPN doesn't publish.
- ~~D/ST streaming by Vegas totals~~ · 2026-09-20 · no odds feed.
- ~~Near-tie variance helper~~ · 2026-09-20 · +0.4 pts win prob; park.
- ~~Buy-low/sell-high from usage~~ · 2026-09-20 · research project, not a feature (the one big build if he wants one).
- ~~Three-team trades~~ · ESPN blocks them.
- ~~Projection-drift chart~~ · until December; archive holds team totals only (AUDIT §2.3).
- ~~Pure client-side private-league read~~ · impossible (third-party cookies).
- Draft page · parked; don't touch unless asked. 2026-09-27: light cards/chips/Mine-Taken got dark ink (`#1b2430`) in css/draft.css — they inherited the dark theme's light text. Results-screen `tr.me-row` (light green row) still has light text; left alone (its sticky `td.name` is dark, needs a per-cell fix).
- ~~V20 disable the week picker under "Every remaining week"~~ · 2026-09-27 · measured live, not inert (it sets the starting week).

## Map
- Pages: index, stats, analysis, schedule, waivers (Players), trade, summary, draft (parked), debug.
- Trade: `js/trade.js` (engine, pure), `js/trade-odds.js` (goal + `TIE_BAND`, pure), `js/trade-suggest.js`, `js/trade-page.js` (7,022 lines on 2026-09-25, wiring).
- Shared: `js/espn.js`, `js/season.js` (fetch; bridge → cloud → ESPN; store in front), `js/forecast.js` (optimalLineup, winProbability, simulateSeason — most shared file), `js/capture.js` (schedule shape, projection, spread, simulationInputs), `js/projection.js`, `js/floor.js`, `js/heat.js`, `js/store.js`, `js/cloud.js`, `js/player-card.js`, `js/sortable.js`.
- Tests: `cd tests && npm test`. **Last full run 2026-09-30 after the arrows merge: 42/43 — an-test failed only because the laptop slept mid-run (34,033 s); an-test alone then passed 2082/2082. Counts blessed (tr-test 835, wv-test 546, new test-proj-trend 52).** The slow ones are `tr-test` ~310–470 s, `test-trade-weekly` ~80–184 s, `an-test` ~50–67 s. ~14,900 assertions. Counts live in `tests/counts.json`; a FALL fails the run, a rise is recorded with `node run-all.mjs --bless` — **which re-runs the whole suite, so allow 20 min**. `TR_KIND` env narrows the finder in tr-test. Not suites: `node tests/text-audit.mjs`, `node tools/measure-layout.mjs` (needs Edge).
- Hosting: `.github/workflows/test.yml` runs the suites and, only when they pass, deploys Pages (`deploy` job, `needs: test`). **This gate is inert until Tim sets Pages → Source → GitHub Actions**; until then the legacy branch deploy still publishes off `main` in ~40 s, ungated. To undo: delete the `deploy` job and set Source back to a branch.
- Project path: `C:\Users\timha\OneDrive\Desktop\my-website\Code Projects\Fantasy Football`. Tim's league 476225250 (private, 10 teams, 14 regular weeks, 6-team playoffs weeks 15–17).
