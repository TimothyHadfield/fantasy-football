# Fantasy Football — progress

Live: https://timothyhadfield.github.io/fantasy-football/ · Repo: https://github.com/TimothyHadfield/fantasy-football

## START HERE
1. Read this file (short, current). Then `chat.md` (what each session asked and did).
2. **Open work is on branch `goal-candidates` (b14add6), NOT merged** — see "Status". Finish it before anything else.
3. `AUDIT.md` is the other work queue (five audits, 2026-09-20; mostly unfixed). Deep history: `docs/archive/progress-2026-09-21.md` (the old 250 KB PROGRESS) and `docs/archive/handoff-2026-09-21.md` (the old HANDOFF, incl. rules 1–18 in full).

Last updated: 2026-09-21.

Read-before-touching (sections of `docs/archive/progress-2026-09-21.md` unless noted):
- Trade engine / finder / combo → "The Trade page", "Per-week trade valuation", "2026-09-21 — the Trade page opens on a goal"; `js/trade.js`, `js/trade-odds.js` headers.
- Colour scale → "The one red/green scale" (2026-09-19 later) + AUDIT §1.1 (half the tints never draw).
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
**On `main` and live (9a11ccc):** the Trade page opens on a goal (Win it all / Don't finish last), prices the playoff weeks under the title goal, plays every finder offer out in the season simulation on one seed, ranks by (your chance gained) × P(he says yes). Goal column second, beside Manager. 39 suites green on 2026-09-21.

**On branch `goal-candidates` (b14add6), pushed, NOT merged** — Tim: "yes go ahead and deploy 1-5 now":
1. Goal chooses the CANDIDATES: per-week weights from the sim (`weekWeights`), finder keeps deals by weighted gain; `rankBy` = weighted gain × P(yes) (without it every finalist was a fleece); partner may lose ≤2/wk (`THEIR_MIN_PER_WEEK`). Demo wk5 title: best expected gain +2.4% → +6.8%.
2. 2-for-2 searched (`kind:'two'`, top 10 pieces a side, `TWO_CAP`), own filter button.
3. Best combo chooses by the same weights + `partnerMin` tolerance (without it the combo emptied — "make none"); headline shows slate's goal change and P(all say yes); custom builder + saved rows + pop-up show the goal (shared `goalContext()` in trade-page.js).
4. Emptied roster spot: already credited at the floor when the wire is read — proved (`test-trade-odds.mjs` §13); the note that said otherwise is corrected.
5. Trade deadline: `espn.parseTrades` → `fetchSchedule().trades` → line under the page title.

**Branch test state (2026-09-21):** every suite passes except `tr-test.mjs` **601/603**. The two failures are fixture-dependent assertions that assume the old ranking:
- "it names at least one man of his own that the deal moves" (weekly scenario — the top deal now moves only traded men). Fix: pick a deal in the scenario that has an own-man churn entry, rather than the top row.
- "two deals with one manager are shown as ONE offer" (live stub — the combo no longer packs two Cy deals). Fix: assert the merge on a combo that has one, or seed the stub so the goal-chosen combo still packs two Cy deals; do NOT weaken to a vacuous pass.
Then: full suite, `node tests/text-audit.mjs trade.html`, `node tools/measure-layout.mjs --pages trade.html`, merge to main, push, tell Tim to hard-refresh.
Branch also carries edits to tr-test: older scenarios pinned to goal "last" (see `boot`), fixed waits replaced by `settleGoal()`.

## Authorized next steps
- 2026-09-21 · Finish and ship items 1–5 above (branch `goal-candidates`).
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
14. One red/green scale (`js/heat.js`), ±1 SD, same slot/column only; scale owns background+weight. **Its CSS claim is wrong today — AUDIT §1.1.**
15. `js/store.js`: played week final for the season, future week fresh 6 h, unknown never final.
16. A key under a coloured table is one sentence; thresholds behind the toggle.
17. Player card: bold = "he starts" (future weeks only; received men solved against YOUR roster with the trade).
18. Trade page opens on a goal and ranks by it (see Status; `js/trade-odds.js`).

## Traps
- `css/app.css` `.pending` is a whole notice banner; a cell with class `pending` draws one. Goal cell uses `goal-wait`.
- A `background` shorthand erases the heat tint (`background-image`); zebra, `tr.me`, row hover still do (AUDIT §1.1).
- `textContent` in tests reads sr-only text too — read visible and sr-only separately.
- An assertion guarded by `if (x.length)` with no else passes when the feature produces nothing — three agents found this.
- `tr-test` scenarios must wait for the page to FINISH (`settleGoal`), not a fixed time — the page now searches twice (points, then goal weights) and ranks.
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
- Tests: `cd tests && npm test` (39 suites, ~10 min; `tr-test` ~6.5 min). Last full run 2026-09-21: main 39/39 green; branch 38/39 + tr-test 601/603. Not suites: `node tests/text-audit.mjs`, `node tools/measure-layout.mjs` (needs Edge).
- Hosting: GitHub Pages `build_type: legacy` off `main` — every push to main redeploys in ~40 s; CI runs tests but gates nothing (AUDIT §3.1).
- Project path: `C:\Users\timha\OneDrive\Desktop\my-website\Code Projects\Fantasy Football`. Tim's league 476225250 (private, 10 teams, 14 regular weeks, 6-team playoffs weeks 15–17).
