# Fantasy Football — progress

Live: https://timothyhadfield.github.io/fantasy-football/ · Repo: https://github.com/TimothyHadfield/fantasy-football

## START HERE
1. Read this file (short, current). Then `chat.md` (what each session asked and did).
2. Nothing is half-built: branch `goal-candidates` was merged to main on 2026-09-21 (75247c7).
3. `AUDIT.md` is the other work queue (five audits, 2026-09-20; mostly unfixed). Deep history: `docs/archive/progress-2026-09-21.md` (the old 250 KB PROGRESS) and `docs/archive/handoff-2026-09-21.md` (the old HANDOFF, incl. rules 1–18 in full).

Last updated: 2026-09-21.

Read-before-touching (sections of `docs/archive/progress-2026-09-21.md` unless noted):
- Trade engine / finder / combo → "The Trade page", "Per-week trade valuation", "2026-09-21 — the Trade page opens on a goal"; `js/trade.js`, `js/trade-odds.js` headers.
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

**Planned, NOT built (2026-09-23):** `docs/trade-rework-plan.md` — the Trade page's calculation and display, from two read-only audits (`docs/trade-review-calc.md`, `docs/trade-review-view.md`). Headlines: the top 3 offers are a statistical tie printed as a ranking (order flips in 4–9 of 12 seeds; `EPS` is 80× too tight, and widening it would be a sort bug — ties belong in the display); the table sits in POINTS order for minutes while claiming to rank by chance (fix: rank the top ten first); the page searches twice; his side is priced over playoff weeks he may not reach; 40 of 40 negative "He gains" cells are painted green under a panel titled "Trades that help both squads"; the phone page is 6,091 px with an empty custom builder taking 37%. Tim decided 2026-09-23: **no** answer block ("leave the table as the answer"), **yes** ties, **yes** collapse the builder on a phone, **keep** Best combo. Not authorized to build.

## Authorized next steps
- ~~2026-09-21 · Finish and ship items 1–5~~ done, merged 75247c7.
- 2026-09-21 · Tim: "alright start working on the projects you reccommend"; 2026-09-22 · "alright do what you think needs to be done next" — taken to cover AUDIT.md §1 → §2 → §3 in the recommended order. §1 and §2 done (bar 2.6, which is Tim's to press); **§3 (the safety net) is next**.
- 2026-09-20 · AUDIT.md order §1 → §2 → §3 recommended; Tim "has not yet chosen an order" (paraphrase from AUDIT). Not explicitly authorized.

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

## Traps
- `css/app.css` `.pending` is a whole notice banner; a cell with class `pending` draws one. Goal cell uses `goal-wait`.
- A `background` shorthand on a td/tr erases the heat tint (`background-image`) — fixed 2026-09-21; `heat-draw-check.mjs` fails on any new one in app.css.
- `textContent` in tests reads sr-only text too — read visible and sr-only separately.
- An assertion guarded by `if (x.length)` with no else passes when the feature produces nothing — three agents found this.
- `tr-test` scenarios must wait for the page to FINISH (`settleGoal`), not a fixed time — the page now searches twice (points, then goal weights) and ranks. Three scenarios still slept 15–20 s on 2026-09-22 and failed four checks on correct code; fixed. Other suites still sleep: `fc-test` (playoff-four, playoff-divisions, live, live-noteam) and `wv-test` (live-midload) fail the same way on a loaded machine, on the live commit too. AUDIT §3 work.
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
- D6 · 2026-09-21 · Older tr-test scenarios pinned to goal "last" rather than rewritten.
- D7 · 2026-09-20 · Per-player per-week average = mean over weeks projecting > 0 (Tim reversed the null-in-divisor rule).
- D8 · 2026-09-19 · Floor rank 3; Proj avg is the lineup week by week; Trade page prices itself on load; store.js.
- D9 · 2026-09-18 · Floor applied at assessment, never selection; one wire read flat for every week.
- D10 · pre-2026-09-18 · Private league via `extension/` bridge; phone reads a Firestore sync (`fantasy-football-th`); Pages deploys off `main`.

## NOT verified
- The yes-chance curve against any real accepted/refused trade.
- The first successful "Send to phone" and phone read of the cloud sync (archive HANDOFF).
- Weeks 1–2 archived only in Tim's browser; export never done (no file in Downloads as of 2026-09-21).
- AUDIT §1 floor wording on live data in a real browser (demo has no floors; only linkedom tests saw it). `tr.me` tint with real heat cells (demo has none in `tr.me`).
- Stats still floors weeks already played (floor.js says never) — found by the §1.4 builder, not fixed.
- Analysis `A week` picks from the manager's set starters, Proj avg from the best lineup — a benched better man still makes them differ.
- Older archive sections were indexed by heading for this file, not re-extracted line by line (2026-09-21 checkpoint).

## Rejected / parked
- ~~Injury-aware trade pricing~~ · 2026-09-20 · needs a miss probability ESPN doesn't publish.
- ~~D/ST streaming by Vegas totals~~ · 2026-09-20 · no odds feed.
- ~~Near-tie variance helper~~ · 2026-09-20 · +0.4 pts win prob; park.
- ~~Buy-low/sell-high from usage~~ · 2026-09-20 · research project, not a feature (the one big build if he wants one).
- ~~Three-team trades~~ · ESPN blocks them.
- ~~Projection-drift chart~~ · until December; archive holds team totals only (AUDIT §2.3).
- ~~Pure client-side private-league read~~ · impossible (third-party cookies).
- Draft page · parked; don't touch unless asked.

## Map
- Pages: index, stats, analysis, schedule, waivers (Players), trade, summary, draft (parked), debug.
- Trade: `js/trade.js` (engine, pure), `js/trade-odds.js` (goal, pure), `js/trade-suggest.js`, `js/trade-page.js` (~6.5k lines, wiring).
- Shared: `js/espn.js`, `js/season.js` (fetch; bridge → cloud → ESPN; store in front), `js/forecast.js` (optimalLineup, winProbability, simulateSeason — most shared file), `js/capture.js` (schedule shape, projection, spread, simulationInputs), `js/projection.js`, `js/floor.js`, `js/heat.js`, `js/store.js`, `js/cloud.js`, `js/player-card.js`, `js/sortable.js`.
- Tests: `cd tests && npm test` (39 suites, ~10 min; `tr-test` ~6.5 min). Last full run 2026-09-21 (merge 75247c7): 39/39 green; `TR_KIND` env narrows the finder in tr-test. Not suites: `node tests/text-audit.mjs`, `node tools/measure-layout.mjs` (needs Edge).
- Hosting: GitHub Pages `build_type: legacy` off `main` — every push to main redeploys in ~40 s; CI runs tests but gates nothing (AUDIT §3.1).
- Project path: `C:\Users\timha\OneDrive\Desktop\my-website\Code Projects\Fantasy Football`. Tim's league 476225250 (private, 10 teams, 14 regular weeks, 6-team playoffs weeks 15–17).
