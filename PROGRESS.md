# Fantasy Football — progress

Live: https://timothyhadfield.github.io/fantasy-football/ · Repo: https://github.com/TimothyHadfield/fantasy-football

## START HERE
1. Read this file, then the last entries of `chat.md`.
2. Nothing is half-built. Everything is on `main` and live (f3177ba, 2026-10-09).
3. Full history: `docs/archive/progress-2026-10-09.md` (this file before the 2026-10-09 trim: the long 2026-10-08 paragraphs), `docs/archive/progress-2026-10-06.md` (this file before the 2026-10-06 trim — the long per-feature Status paragraphs with Tim's quotes, data shapes and measurements live THERE; read the matching paragraph before touching a feature), `docs/archive/progress-2026-10-02.md`, `docs/archive/progress-2026-09-21.md` (the old 250 KB PROGRESS), `docs/archive/handoff-2026-09-21.md` (old HANDOFF, rules 1–18 in full). Work queues: `AUDIT.md` and `docs/trade-rework-plan.md` (Phases 1–3 and 5 built; 4 and 6 not).

Last updated: 2026-10-09 (player Value everywhere, Draft on Value, trade order by net increase, Players box cleanup + Who to start box; see chat.md 2026-10-09).

Read-before-touching (sections of `docs/archive/progress-2026-09-21.md` unless noted):
- Trade engine / finder / combo → "The Trade page", "Per-week trade valuation", "2026-09-21 — the Trade page opens on a goal"; `js/trade.js`, `js/trade-odds.js` headers.
- Trade ranks, ties, wording, precision → `docs/trade-rework-plan.md` "BUILT 2026-09-23" + rule 19. Do not touch `EPS` or `TIE_BAND` without reading both.
- Anything that spawns a child process in `tests/` → header of `tests/emit.mjs`, then the emit Traps.
- Colour scale → "The one red/green scale" (2026-09-19 later) + AUDIT §1.1.
- Floor → "The positional floor" (2026-09-18), "The floor is the THIRD-best free agent" (2026-09-19).
- Simulation / playoffs → "The playoffs, and the hybrid final placing".
- Time machine / archive → "The time machine" + AUDIT §2.
- Stats maths → "Stats module — reverse-engineered from Tim's 2025 sheet".
- Phone layout → "The phone (2026-09-15)"; archive HANDOFF "The phone layout".
- Cloud/phone read → "The cloud sync"; archive HANDOFF "The cloud, and the phone".
- Finished-counts-now, week in progress, decimal records, Decisions engine/partial week, projection history + cloud carry, stale-module trap → the paragraphs of those names in `docs/archive/progress-2026-10-06.md` Status.

## Goal right now
Tim, 2026-09-21: "I basically want to keep working on big improvements in the display, formating, and calculation system with the cite. Something I want to get down really well is the Trading system. I want the cite to offer virtually the perfect trade to the user."
Since 2026-09-29 he sends one concrete feature ask at a time. 2026-10-06 he asked for a full site analysis (themes of his asks, miscalculations/glitches, additions) and to build what I'd recommend with many sub-agents; that is done bar the items under "Open for Tim".

## Status (all on `main`, live)
One line each; detail in the archive snapshot named above unless a commit is given (then read the commit + its tests).
- **Trade:** opens on a goal; finder → season sim on one seed → rank by Δchance × P(yes); ties as display groups (rule 19); net of the partner's meeting week; custom box, Suggested, saved/Assume, Ask AI, accept-by, bye pills, injury underline, trend arrows. **2026-10-06 (detail in the 2026-10-09 archive):** every printed change = printed after − printed before (3c0e594); **the search runs in slices** (af7f066): step generators in `js/trade.js`/`js/trade-odds.js`, cancel token, `data-ranked` on `#tradeTable` is the completion signal. **2026-10-09: list order is net increase, see below.**
- **Player card** (`js/player-card.js`): week run + glance line `Avg · Proj · POS #n` (ESPN's own numbers).
- **Analysis:** All teams grid, Weekly totals, Season by week (Position | Player), Proj changes box, Who to start, Roster detail. "Actual history" for played weeks (real lineup, real score; Actual | Proj select shared by the tables). **2026-10-06:** week totals summed from unrounded slots (`raw` field from `lineup-slots.js` `fillSlots`) = Schedule for 100/100 team-weeks; **Avg = mean of the regular-season numbers shown in the row** (bye left out) everywhere on the page; week grid caption/tooltip say "set lineup" (it pools `team.starters`); Who to start shows actual history with the band, 3px divider and the shared select; grid + totals fit 1280/1440; roster phone fade; hint colour (9bb8df6, 0f32cd3). Prose 368/381.
- **Stats:** standings, week by week (Actual | Projected | Luck | Act−Proj | Opp scoring | Close game | Margin), scatter graphs, score spread (early look from 3 weeks), decimal records. **Schedule luck = rest of season** with its weeks in the heading and a per-fixture preview on the last figure (`#oppPop`, 92094ac). **2026-10-06 (detail in the 2026-10-09 archive):** `signed` rounds before signing; a tie = close-game luck 0 (`closeLuckOf`); Hardest schedule tile = rest of season (56de430); games with unread projections are skipped by every luck mean ("Incomplete: …"); luck cells open a parts preview (`explain` option of the shared standings table; b2b82dc).
- **Schedule:** sim, forecast, cards, head-to-head, Time machine. **2026-10-06 (detail in the 2026-10-09 archive):** "My season" **Title ± / Last ±** (`js/must-win.js`, `simulateSeason` `forced`; b11c022); charts at their box's width, `shortNames` (e72eaeb); Export archive = **full backup** (`js/backup.js`; import writes only absent keys) and the **"Week N saved / not saved yet" chip** (`ff:saved`; 077f85e).
- **Players (waivers.html):** wire + taken, all weeks, Actual row, Your team select. **2026-10-06: Gain column** (`js/waiver-gain.js`: best lineup with him minus best lineup now, least-costly drop, priced by `priceTradeAcrossWeeks`, per week; preview with weeks; sliced after paint; 645a0dc); `.jump.hidden` fix; "choose your team…" option.
- **Home:** this week's cards, injuries, bench, roster strength. **2026-10-06:** deadlines line + "Start A over B: +x pts, +y% win" on your own card (`js/start-sit.js`, 216c241); source buttons drawn from page state (fixes Demo lit under Live); records on cards (`capture.recordNow`); tables fit 393/1280/1440; on the phone's synced copy Home makes **zero ESPN requests** (`season.cloudSource()` skips waiver-date/kickoff/NFL reads → no "waivers clear" there) (9e41b53).
- **Summary:** chart + share image, Record `7-1`. **2026-10-06:** fits a phone; your row marked `me` (real league only) (5fe07cb); status wording for missing projections (9bbcb0c).
- **Decisions** (`decisions.html`, engine `js/decisions.js`, plan `docs/decisions-review-plan.md`): undo any add/drop/trade/lineup rule and see the season replayed; two lineup rows (Reasonable / Perfect hindsight), All users, partial week with LIVE tags, Display noise. **2026-10-06 (detail in the 2026-10-09 archive):** sortable tables, Points/wk, "Biggest swap", every Diff opens its swaps (`weekSwaps(cell)`), click a previewed number → Season by week with that week outlined, changed players outlined, dim projection left of each actual, **Avg column on the right** (Tim) (8ddf1cf).
- **Data layer:** store.js, cloud sync (Firestore `fantasy-football-th`), bridge extension for the private league, finished-counts-now, week in progress, projection history (`js/proj-history.js`) + its cloud carry (b859d9e). **2026-10-06:** `assembleSeason` hands on every decided game even when a played week's roster read failed (projection 0, `projectionsAvailable` false, `weeksWithoutProjections`); `projectedTotalForWeek` applies `byeAdjustedProjection` (efed6da).
- **AUDIT** §1, §2 (bar 2.6), §3, §6.5, §6.6 done. **CI:** every run on 2026-10-06 before d58cebc was cancelled by the 20-minute cap (the earlier "green since a0d0dc4" was stale); now five shards, ~10 min (tr-test slice 9.5 min). First sharded run failed one decisions-check timing check (hover is quiet 900 ms after a go; fast CI got there sooner) — test now waits.
- **Single-week luck limit (BUILT 2026-10-06, 680a0da; plan + BUILT section `docs/outliers-plan.md`).** Tim: "a single unlucky event … shouldn't be able to affect your entire luck ranking for the season"; the close-game ±50 formula STAYS ("how it is is good for now"); "lets just round it out to a limit of +- 50"; always on. `WEEK_LUCK_LIMIT = 50` in `js/stats.js`: weekly cells are real, every season luck figure counts each week within ±50; over-limit cell = dotted underline. Not seen on his league or iPhone; strings are his.
- **2026-10-08, live (full paragraphs: `docs/archive/progress-2026-10-09.md` Status):** player proj+score everywhere (`docs/player-numbers-plan.md`); stale rosters after a trade fixed (Sync now drops non-final weeks, `ff:refresh`, `store.forgetOpen`); Roster strength on Stats (`js/lineup-avg.js`) + Future proj diff; Draft "Our draft" (`js/draft-review.js`; NOT in the phone's cloud copy); shared preview base (`js/pop.js`, `js/links.js`, `js/heat.js`, `playerCardFromWeeks`).
- **2026-10-08 wave, live (25404bd; full paragraph in the 2026-10-09 archive; `docs/wave-brief.md`, `docs/previews-plan.md`, `docs/colour-plan.md`, `docs/charts-plan.md`):** shared `statCard` previews + connectors on every page, colour additions, chart sizes + view switches B1–B5, diverging bars on the three Stats boxes, deep links (`trade.html?with=&get=&send=`, `analysis.html?team=`). A record with a game in play keeps its `title` and takes no card (`record-live-check` rule 7). Builders' wording choices: chat.md 2026-10-08 (wave).
- **Draft "vs preseason rank" (2026-10-08):** switch `#compareToggle` (pref `draft.compare`); rank = ESPN PPR draft rank (`espn.fetchDraftRanks`, kept in `ff-draft-review-v1`), counted AMONG THE DRAFTED; number = drafted-at − place (+ = went later than ranked). Auction "drafted at" = price rank. His to confirm: among-drafted, labels "Pre" / "Biggest slide" / "Biggest reach".
- **2026-10-09, player VALUE — BUILT and live (plan, Tim's words verbatim, BUILT section: `docs/value-plan.md`).** Value = rest-of-season average ESPN projection (bye left out, other zeros count) over the waiver line (mean of the top 3 free agents at the position), points below the starter line (worst man the league starts) at half, floor 0, points a week. **Lines FROZEN once per league-season** (Tim: "pick specific baselines and stick to them throughout the season"): `localStorage ff.value.<league>-<season>`, rides `schedule.valueBase` to the phone, first copy wins (`buildCloudPayload`). API: `js/value.js` (pure), `season.fetchValueBase()` / `fetchPlayerValues()` / `valueWeeks()`, `player-card.js` `setValueSource` + `registerRun({playerId, value})` — Value leads the glance line on every card. **Proj / Value switch** (per-player numbers → `valueOf`; team totals and scores never convert; hidden with no base): Analysis (4 panels), Players (both tables), Trade (custom lists + season boxes; each side also shows "±n value" = received − given). **Draft "vs worth now"** = Value now − expected Value of the pick (smoothed never-rising line through the drafted players' preseason Values in preseason-rank order, read at the DRAFT SLOT — Claude's reading, told to Tim); Value total row under each team name (pre view: sum of own preseason Values); board switch "Drafted / Own now" (boxes players currently held). Stub hook for tests: `globalThis.__ffValue` / env `FF_VALUE`.
- **Also 2026-10-09 (each Tim's ask, live):** Stats Schedule luck lists the LUCKIEST first (chart reversed; tile still hardest); Trade recommended + Suggested lists ordered by **net increase** = You gain + He gains as printed (heading "Trades ranked by net increase"; rank "=" = equal printed sums — **supersedes rules 18/19's order and tie band for these lists**); Players: green "worth starting" number REMOVED, green box = "you would start him" that week (`optimalLineup` with him added; judged on projections even on Value); **Who to start box above Available players** when a position + team are chosen (`js/who-to-start.js` extracted from analysis-page, Analysis output byte-identical).
- **2026-10-10, MAIN MENU live (`docs/main-menu-plan.md`, BUILT section):** `leagues.html` reached by the brand; `js/leagues.js` keeps `ff.leagues` and parks `ff.prefs` + `ff-draft-review-v1` per league-season on a switch (a switch is a navigation); earlier seasons 2019+ open read-only (no sync, capture, Value lines). **Phase 2 — accounts for anyone — authorized by Tim 2026-10-10, NOT built; never move his cloud data at `leagues/…`.** Also 2026-10-10: Players box columns aligned with the list, Draft Avg column, name hover preview on Players (chat.md).
- **Cross-page ideas put to Tim 2026-10-09, NOT built, not authorized** ("don't build them yet"): drop candidate in a free agent's row · best pickup line on Home · draft cost in Roster detail · roster Value on Stats · Who to start before/after in Custom trades · partner's schedule luck in trades · opponent lineup on Schedule · bench points on Summary. Claude's picks: drop candidate, trade before/after, roster Value.
- **Tim, 2026-10-08:** "if you ever have a recommended option for something, just go with it, you don't need to ask me if you recommend it." Still waiting on his picks: the 17 chart-content suggestions in chat.md 2026-10-08; parked view switches 6–10 in the charts plan.
- **Not built:** Trade Phase 4 (density; needs Tim's answers to plan questions d and f) and Phase 6 (closed-form weights; needs a go). Yes-curve rebuild parked. Proj changes phase 4 leftovers (Preseason reference).

## Open for Tim (flagged in the 2026-10-06 report; his to decide)
- Schedule default 10,000 seasons vs Summary's 100,000 → Title % can differ by a point (Kenny 25% vs 24%); same seed/inputs, identical at the same count. Left as is (recorded choice); switching Schedule's default costs ~1.5 s per sim on a phone.
- Analysis Proj avg grid Total no longer equals Season by week Avg once weeks are played (he asked 2026-09-19 for "this exact information"); the grid's note says so.
- Players Gain: a real gain under 0.05/wk prints "+0.0". (The green "worth starting" mark was removed 2026-10-09 at his ask.)
- 2026-10-09 choices of Claude's, his to change: Value wording ("Proj"/"Value", "Show", "±n value", "Expected value", "Value now", "Preseason value", "Drafted"/"Own now", "you would start him", "Trades ranked by net increase"); curve read at the draft slot; preseason per week = season ÷ projected games; Trade Depth map left on its own bar; Trade list number on Value can differ slightly from the card's Value; Who to start box is its own panel (pushes the filter buttons down); phone switches are full-width rows.
- Trade combo panel now says "Waiting for the finder…" during a search (0563636; was the untrue "Nothing to combine…"); wording his.
- Decisions: week outline persists until the next click; All users click-through keeps All users on; Points/wk tile can be 0.1 off printed Total ÷ weeks; a man who only moved slots is not marked.
- Stats: tied week prints "0" under Close game (was a dash); tile names the hardest REST-of-season team; "Incomplete:" wording.
- Home phone copy: no "waivers clear"; at 1280 "your win chance 41%" wraps on your card.
- "You are" unset: Schedule/Analysis/Trade/Decisions silently show the first team (Players and Stats handle it differently); the picker lists ESPN team names while pages use manager names.
- ~~Committed export privacy~~ answered 2026-10-06 (question box): "Weekly readings only" — `data/snapshots/476225250-2026.json` (weeks 1–5) carries only `v, exportedAt, leagueId, season, snapshots`; strip a new export the same way before committing (see that folder's README). His full file is `Downloads\fantasy-archive-476225250-2026 (2).json`.
- Held ideas needing his call (additions audit, ranked): D/ST streaming by sportsbook line (ESPN public scoreboard `site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=N&seasontype=2` carries DraftKings spread/over-under and the game clock, no key, CORS `*`, undocumented — also reverses the 2026-09-20 "no odds feed" rejection); laptop-free weekly save via a GitHub Action (cookies/privacy); Trade finder on the phone; real game clock for the week in progress; playoff weeks 15–17 support (date-bound, mid-December); league-wide best/worst moves; group-chat award lines; combining hypotheticals; projection trust by horizon (early November); draft report card.

## Authorized next steps
- None open. Every go-ahead through 2026-10-06 is built.
- Phase 4 needs his answers to plan questions d and f; Phase 6 needs a go.
- Tim did both of his jobs 2026-10-06: exported the archive (weeks 1–5, committed readings-only) and set Pages Source → GitHub Actions (`build_type: workflow`). **The site now publishes ONLY when the `tests` workflow is green** — a push is live after the CI run (five shards, `run-all.mjs --shard=I/5`, slice 1 = tr-test), not after a minute; a red or cancelled run means the old site stays up. The live-check hook's "not live after 6 min" is expected now: check `gh run list -R TimothyHadfield/fantasy-football -w tests`.

## Standing instructions
- **Push every change when it is done** — Tim judges by the deployed site. Never push failing tests. Split into sensible commits.
- **No long test runs before a push** (Tim, 2026-10-06: "make sure you don't ever do long test runs again, and if you do it can be after the push"). Run only the suites the change touches, push, and put any full `run-all.mjs` in the background AFTER the push; tell builders the same.
- **Live in a minute, not eleven** (Tim, 2026-10-06, waiting on the gated deploy: "forget the test. push now."). After every push of a site change, run `gh workflow run deploy-now.yml -R TimothyHadfield/fantasy-football` (publishes main without waiting for CI; `.github/workflows/deploy-now.yml`), confirm the deployed file has the new code, tell him; the gated `tests` run still follows — check it afterwards and fix forward if red. (My interpretation: he wants this speed as the default, not only that once.)
- **Many agents at once** (Tim, 2026-10-06: "your work seems to be pretty slow. You should be deploying many more sub-agents"). One builder per separable part, launched together, disjoint files, own worktrees.
- **Give links, not prose directions.** Deep links; IDE-clickable paths.
- **After pushing, tell him to hard-refresh** (Ctrl+Shift+R; iPhone: close/reopen tab or `?v=<sha>`). Pages cache is 10 min.
- **Prose, not mechanics** — lead with the finding; he reads the words, not the tool calls.
- **Complement ESPN, don't replace it** — build what ESPN's app lacks; he deleted Schedule's standings for this reason. (The card glance line copies ESPN's numbers on purpose: "how other user's are seeing that player".)
- He checks numbers by hand against ESPN; when he says a number is wrong he is usually right. Test the claim before defending code.
- His vocabulary: "players" / "users" can mean managers (teams); "graph"/"chart" can mean a table; "sorting" has meant the position filter; "prepare md files for chat reset" = /checkpoint. Say which reading you took.
- He sends asks mid-task: finish what is in flight first.
- Parallel agents: disjoint file sets; a test spanning any shared seam; verify the whole tree yourself; make every fix falsifiable (break it, watch it fail, restore).
- House panel shape: title → one `.lede` → controls → table → one-line key → `<details class="explain">` "How this works". New explanation goes behind the toggle; warnings/refusals/inversions stay visible. Run `text-audit.mjs` and `measure-layout.mjs` after adding words.
- **House preview ("where does this number come from")**: hover/focus card for a mouse, tap = bottom sheet with Close on touch, Escape/outside closes; rows are label + number and ADD UP to the cell; one preview per number (no `title` beside it). Examples: Stats `#oppPop` + standings `explain`, Decisions Diff, Schedule Title ±, Players Gain, Trade `cuFloat`.
- **A printed difference equals its two printed ends subtracted** (Trade, Decisions); sort keys stay unrounded. **Round first, then sign**; a rounded zero prints plain "0".
- Session start: check `C:\Users\timha\Downloads\fantasy-archive-*.json` and `data/snapshots/`; ask whether the Time machine recorded this week and whether he pressed Export archive.

## The rules that must not be re-litigated (full text: archive HANDOFF)
1. ESPN publishes projections, never odds — every % is our model and says so.
2. ESPN projects every future week incl. 15–18; bye = 0.00 ≠ null. D/ST projects in its bye → site forces 0 in a known bye week. No 13-week ceiling.
3. No bulk form: one request per week.
4. Free-agent week works only without a stats filter alongside `scoringPeriodId`.
5. Statistics return null below their data thresholds; pages print "—".
6. Never read localStorage for league config directly — `savedConfig()`/`onConnection()`.
7. State the basis of every derived number in a panel note.
8. ESPN keeps no projection history — capture it while on screen (`js/snapshots.js`). (Played weeks DO keep their final projection beside the actual — measured 2026-09-29.)
9. A squad is its team id, never its label.
10. Trades priced by the lineup each week, not a season average; per week first, total as sub-number.
11. A combo's gain is not the sum of its trades' gains — price the combined move once.
12. Archive's durable home is `data/snapshots/<league>-<season>.json` (export is cumulative, monthly). Every live Schedule load probes that file; a console 404 when it is absent is expected.
13. Positional floor = 3rd-best free agent (`FLOOR_RANK=3`); never invented; never changes who starts; a floor on one panel and not its neighbour is worse than none.
14. One red/green scale (`js/heat.js`), ±1 SD, same slot/column only; the tint is a background-image and every row rule sets `background-color` only, never the `background` shorthand (enforced by `tests/heat-draw-check.mjs`).
15. `js/store.js`: played week final for the season, future week fresh 6 h, unknown never final.
16. A key under a coloured table is one sentence; thresholds behind the toggle.
17. Player card: bold = "he starts" (future weeks only; received men solved against YOUR roster with the trade).
18. Trade page opens on a goal and ranks by it (`js/trade-odds.js`).
19. **A tie is a display grouping on top of a strict sort, never a sort key.** `TIE_BAND` (0.4 pp, measured) marks rows against their GROUP'S LEADER, not the row above. Widening `compareByGoal`'s `EPS` is forbidden (intransitive comparator). Two assertions pin this.
20. **A page showing the phone's synced copy makes zero ESPN requests** (`tests/test-cloud-wiring.mjs` `page-synced`, `profile-phone`). New Home/other reads must check `season.cloudSource()`.

## Traps
- `tests/text-ceilings.json` caps on-screen prose per page; raising one is Tim's call. Analysis 368/381, Decisions 167/167, Players 294/294.
- `run-all.mjs` is ~30–40 min serial (72 suites); `--jobs=N` exists but saves little and flakes timing suites; `test-trade-weekly` runs alone first. `--bless` re-runs everything.
- **Network outages kill or stall subagents** (2026-10-06, three times): the worktree keeps uncommitted work — resume with SendMessage (tell them to check `git status`/`git diff` and undo any deliberate break). If resume is refused "work-tree-elsewhere", the worktree was never made: relaunch fresh. Tell every builder to check `git rev-parse --show-toplevel` first.
- Builders' fresh worktrees have no `tests/node_modules` (git-ignored): they run `npm ci` there. The session scratchpad is shared between agents — give each its own subfolder.
- **Chaining a push after parallel test output with `;` pushes even when a suite failed** — read the results, then push in a separate step.
- Suites that open the Trade page must wait for the search to finish (`data-ranked`, or tr-test's `settle()` which now waits out a running search), never a fixed time: the search is async since af7f066. `text-audit` failed once under parallel load right after that merge and passes alone — watch it.
- `cmp-check` waits 2 s for the played-week reads (was 600 ms; flaked on a busy machine). Suites comparing Schedule's and Summary's sim calls must filter out the forced must-win replays (`c.games.some(g => g.forced)`): `cross-sim-check`, `pages-done-check`.
- Builder agents can stall on long blocking test runs ("no progress for 600s") — tell them to background long runs.
- Agent launch can fail on worktree path case (c: vs C:) — `git worktree remove -f -f .claude/worktrees/agent-<id>`, `git branch -D`, retry.
- Pages deploy can fail with OIDC "Failed to get ID Token" — `gh run rerun <id> -R TimothyHadfield/fantasy-football`. A GitHub Actions incident can cancel Pages builds: check the deployed file contains the new code before calling it live.
- **Stale-module trap:** Pages serves `js/*.js` with `max-age=600`; for ten minutes after a deploy a browser can run a new page file against an old kept module ("x is not a function"). The strip's Reload button re-fetches scripts with `cache: 'reload'`. When a deploy adds an export another file calls, tell Tim it can take ten minutes.
- Tim's league (476225250, private) has a **1-day trade review period**. Accept by kickoff of the earliest received player − 24 h.
- `css/app.css` `.pending` is a whole notice banner; a cell with class `pending` draws one. Goal cell uses `goal-wait`.
- `textContent` in tests reads sr-only text too — read visible and sr-only separately.
- An assertion guarded by `if (x.length)` with no else passes when the feature produces nothing.
- **`settleGoal` returns on "not ranked by your…"** — right for a settled goal, wrong for a test that must see the ranking finish: `searchOnce` has its own wait.
- **The stub answers week reads instantly, which hides load-order races** — test load order with `TR_WEEK_DELAY=150` (`tests/tr-stub-season.mjs`).
- He gains is reach-weighted under "Win it all": `offer.theirGain` ≠ Σ `theirByWeek` there; flat figure is `offer.theirPoints`; page code goes through `hisSideOf()`.
- Raw `myGain`/`byWeek`/`theirByWeek` feed the sim; `netGain`/`goalPoints` are the netted display/rank figures — never feed netted numbers to the sim (double count).
- **A child scenario hands its answer back with `emit()` from `tests/emit.mjs` — never `console.log` + `process.exit`** (POSIX pipe truncation; `EAGAIN` must be retried).
- **Green on Windows is not green on CI** — when a suite fails only on GitHub, suspect the harness; read the workflow's unfiltered re-run step.
- `text-audit` counts a page as settled only when no `.searching` span is on it.
- The finder's status line MUST keep "playing each offer out" while the ranking runs (tr-test's `settleGoal` depends on it).
- Read anything off the finder AFTER the sim finishes off the row it was taken from — the list re-ranks behind a pop-up.
- The decimal record arrives a moment AFTER first paint (async live read) — a test or eval that reads at once sees whole numbers.
- Headless `--full` on Decisions with the live league can take minutes; its chart is lazy ("Simulating 100,000 seasons…" stays until scrolled to). Use a `timeout`.
- The machine is shared: Tim's OCR jobs (`ocrvid.py`) can hold three cores for hours. Check `Get-Process` before believing a timing failure. Never `taskkill /IM node.exe` (kills other agents' runs).
- Worktrees: never junction `node_modules` into one you will remove. On Windows `git worktree remove` fails on long paths — `rm -rf` then `git worktree prune`. Many stale `.claude/worktrees/agent-*` exist (some locked) — leave them.
- Another chat may push to this repo in parallel: always `git fetch` before pushing.
- Shell: multi-line `node -e`/python heredocs with quotes or `${}` get mangled by bash — write the script with the Write tool, then run it.
- linkedom gotchas: `tests/README.md` (no `MouseEvent` constructor — use `Event`). `sortable.js` falls back to cell TEXT and does not strip ▲ — every scaled cell must emit `data-v`.
- Local preview: `python -m http.server 18947 --bind 127.0.0.1` (background; it refuses Chrome's parallel connections while another browser is loading); headless `node ~/.claude/tools/phone-view.mjs <url> [--desktop] --do 'fill:#connLeague=1241838' --do 'click:#connSync' --do 'wait:#modeBadge.live' --out x.png` (setting `ff.connection` in localStorage does not connect).
- Test account: none needed (no sign-in is exercised headless); the public league 1241838 is the live fixture.

## Decisions
- D1 · 2026-09-21 · Trade ranking = sim Δchance × P(yes), one seed (common random numbers).
- D2 · 2026-09-21 · A deal enters the sim as per-week point deltas for BOTH squads from the finder's own `byWeek`/`theirByWeek`.
- D3 · 2026-09-21 · P(yes) = logistic(((his lineup Δ/wk + ESPN-look Δ/wk)/2 + 3)/1.5). Unvalidated.
- D4 · 2026-09-21 · Title goal prices playoff weeks in `weeklySpan()`; "last" goal = regular season only.
- D5 · 2026-09-21 · Candidates by week weights (+10 pts per week, ÷10, mean 1, floor 5%); settled goal → null weights → points.
- D6 · 2026-09-21 · Older tr-test scenarios pinned to goal "last" rather than rewritten.
- D7 · 2026-09-20 · Per-player per-week average = mean over weeks projecting > 0.
- D8 · 2026-09-19 · Floor rank 3; Proj avg is the lineup week by week; Trade page prices itself on load; store.js.
- D9 · 2026-09-18 · Floor applied at assessment, never selection; one wire read flat for every week.
- D10 · pre-2026-09-18 · Private league via `extension/` bridge; phone reads a Firestore sync (`fantasy-football-th`); Pages deploys off `main`.
- D11 · 2026-09-23 · `TIE_BAND = 0.4` pp, measured on the demo league (12 seeds × 10,000 seasons); grouped against the leader.
- D12 · 2026-09-23 · A week that has KICKED OFF is out of a trade's span (`state.startedWeeks`).
- D13 · 2026-09-24 · Child scenarios return through `tests/emit.mjs`.
- D14 · 2026-09-24 · Phase 2: rank the first `GOAL_STAGE = 10` scored offers once, fade the rest until the full sort.
- D15 · 2026-09-24 · Phase 3: every readable week bought BEFORE the one weekly search.
- D16 · 2026-09-24 · His side weighted by `playoffReach`.
- 2026-09-27 → 2026-10-05 · one line per feature ask (Δ columns, custom box, bye pills, trend arrows, forced cut, net of meeting week, Ask AI, Assume, Suggested, Your team, Weekly totals, card glance line, week in progress, graphs, finished-counts-now, decimal records, Decisions): list with commits in `docs/archive/progress-2026-10-06.md` "Decisions".
- 2026-10-06 · Schedule luck is rest of season, labelled with its weeks (Tim). Hardest schedule tile follows; the standings "Opp proj" column stays whole season and its title says so.
- 2026-10-06 · Analysis Avg = mean of the regular-season numbers shown in the row; a bye is left out (was 0) — applies to Weekly totals, Season by week (both modes), Who to start, Proj changes.
- 2026-10-06 · A tie counts as a game with close-game luck 0 (one rule for weekly cells and Luck score).
- 2026-10-06 · Luck leaves out a week whose projections were not read; records/points still count it.
- 2026-10-06 · Must-win swing = forced-result sims on the page's seed, 10,000 each way (5,000 was too noisy: 0.95 pt SD on the worst team).
- 2026-10-06 · Waiver Gain = Trade's pricing with the least-costly drop, roster size held; open roster/IR spot not modelled.
- 2026-10-06 · Backup import never overwrites: only absent keys are written; an imported assumed trade comes back as a saved trade.
- 2026-10-06 · Trade search sliced on the main thread (generators), not a worker — the linkedom harness and identical output made slicing the cheaper safe choice. Under-100 ms would need the season sim itself sliced or a worker.
- 2026-10-06 · Schedule stays at 10,000 seasons by default (see Open for Tim).
- 2026-10-06 · Season by week Player rows ARE coloured (Tim asked; overturns "a man is not a slot"): a man vs the league's STARTERS AT HIS POSITION — history week = that week's real starters, weeks ahead = every best-lineup value on screen, Avg = one mean per squad (`playerScales`, b2175f2). Bye/dash no colour. The comparison set is my choice, his to change.
- 2026-10-06 · Player rows: white line above the first non-starter (`tr.bench-start`), hidden while sorted by anything but Player ascending (my choice).
- 2026-10-07 · Decisions "What would have happened": **Bench** column on both lineup decisions (real starters the hypothetical lineup leaves out), **Proj 0** on Reasonable only (real starters projected exactly 0; a missing projection is not a zero). Per week + Total for one team, season total per team on All users; hidden for moves/what-ifs (`countCells`, `td.dz-lu`/`dz-lu0`). On a phone, with the columns shown, "Hypothetical" is DRAWN "Hyp" by CSS (DOM text unchanged) so the table still fits — my choice, his to change, as are the two headings.
- 2026-10-06 · PTW wording: "the projection you needed to beat a typical opponent" (Tim: it is what you should be PROJECTED, not what you need to score).
- 2026-10-06 · Projection accuracy: a % on every bucket with ≥1 game (Tim: "I don't care if there's only been like 1 game there"); the 20-game minimum and its note are gone (cb3761a). The Summary/Stats accuracy tile follows.

## NOT verified
- **2026-10-09 Value work: headless only** (WebKit 393 + 1440, league 1241838, demo). Not seen: Tim's iPhone, private league, the first real sync carrying `valueBase` to the phone, a week in play (the "already played counts at pregame" rule is reasoned, untested). On the synced copy with no synced byes, averages count the bye week. A cleared laptop browser makes its own lines until its next sync adopts the cloud's. Trade `twoGoals` scenario stalled twice at "playing each offer out (6 of 40)" under machine load, 54 clean repeats after; cause not caught. Full `tr-test` not run clean locally on the final merge (CI is the arbiter).
- **2026-10-08 wave: headless only** (WebKit 393 + 1440, league 1241838). Not seen: Tim's iPhone, real mouse hover, his private league, a week in play, a real trade (stale-roster fix), the Draft room on a live player pool, the synced-phone ("Copy sent") top bar, Trade's assumed-trade season cards, keyboard Enter on carded numbers. Known gaps: Trade Best-combo Difference cells have no card; the deal pop-up's slot table prints a bye man 0.0 where the new card shows a starred waiver-floor value (totals agree); Home phone copy shows "Bye" for a ruled-out player's 0.0 week; a league-name card opened while Stats is still loading did not show once.
- **Everything built 2026-10-06 was checked headless only** (Safari's engine at 393 and Chrome/WebKit at 1440, public league 1241838, weeks 1–4 final, no week in play): not on Tim's iPhone, not on his private league through the bridge, not a week in play (LIVE tags, decimal records beside the new marks, must-win blanks, start/sit locks), not a tie, not a missing-projection week in a real browser, not real hover with a mouse.
- Backup: the real file download/upload clicks; the bridge extension's late-copy path; the chip on a real signed-in bar; projection-history round trip laptop → Firestore → iPhone.
- Trade slicing: custom box / saved rows / Ask AI / pop-ups exercised mid-search (unchanged code paths, not driven in a browser); data landing mid-search without a restart; whether WebKit's costly pause (17–25 ms) is only the Windows build.
- Home on the phone copy: what it draws was reasoned from code (the test proves only zero requests). "Best lineup set" never seen on live data.
- Calc audit items not checked or left: Decisions title/loser % vs Summary on live data; Proj changes Position mode re-solve uses TODAY'S floor on both sides (a seeded +3.0 read +2.5); `optimalLineup` greedy assumes nested slot eligibility; playoff weeks.
- Finished-counts-now (2026-10-05): seen live only on 1241838 one Sunday night. Not seen: Tim's league, the phone/cloud path, a reading older than 15 min, a playoff week, the moment every matchup is early-final. Known open: `stats.js` `mean([])` = 0 for a team with no games; `actualRank` sorts by wins not win % with unequal games; `capture.liveWeek` without an NFL game list picks its lineup from `projected`; Trade's "Week N has already been played" warning and greyed past columns treat a week in progress as played; Players heat tooltip says "across the league". ESPN stat corrections after an early final are not re-checked until ESPN closes the week.
- Week in progress: 190-minute game length and "variance ∝ projected points" are assumptions. Trade's line "Week 4 · … not played yet" still shows mid-week (wording is Tim's).
- Graphs / Players all-weeks: on a phone a name tap opens the Actual row but its scores sit right of Pos/Tm/Owner/Avg; in December the Players page buys up to 26 extra requests.
- Card glance line vs the ESPN app on Tim's real league (`positionalRanking` is the rank the app shows?).
- The yes-chance curve against any real accepted/refused trade. Tie band measured on the demo league only.
- First successful "Send to phone" and phone read of the cloud sync on Tim's devices. Weeks 1–2 archived only in Tim's browser; export never done. The Pages gate has never blocked anything (Source still "Deploy from a branch").
- Stats still floors weeks already played (floor.js says never) — not fixed.
- Placeholder wording, Tim's to change: Record tooltip; V17 lead line; V18 depth key; "Δ last chance", "His proj vs you", "↑ his −2.3", "plays 42%", "Per week he plays"; every string listed in chat.md 2026-10-06.

## Rejected / parked
- ~~Injury-aware trade pricing~~ · 2026-09-20 · needs a miss probability ESPN doesn't publish.
- ~~D/ST streaming by Vegas totals~~ · 2026-09-20 · no odds feed (2026-10-06: a free feed was found — see Open for Tim; his call).
- ~~Near-tie variance helper~~ · 2026-09-20 · +0.4 pts win prob.
- ~~Buy-low/sell-high from usage~~ · 2026-09-20 · research project, not a feature.
- ~~Three-team trades~~ · ESPN blocks them.
- ~~Projection-drift chart~~ · until December; archive holds team totals only (projection history now saved weekly, so revisit then).
- ~~Pure client-side private-league read~~ · impossible (third-party cookies).
- Draft page · parked; don't touch unless asked.
- ~~V20 disable the week picker under "Every remaining week"~~ · 2026-09-27 · measured live, not inert.
- ~~"Also send" suggestions~~ · 2026-09-29 · Tim: "I haven't found them usefull at all yet" (replaced by the Suggested list).
- ~~Trade custom lists' SD hover~~ · 2026-10-06 · Tim: "there are 2 different previews … Remove the SD one."
- ~~Silencing the snapshot-probe 404~~ · 2026-10-06 · cannot be done without a hack; the probe is the documented archive lookup.
- ~~`run-all --jobs` by default~~ · 2026-10-06 · 32 → 27 min only, and timing suites flake.

## Map
- Pages: index, stats, analysis, schedule, waivers (Players), trade, decisions, summary, draft (parked), debug.
- Trade: `js/trade.js` (engine, pure), `js/trade-odds.js` (goal + `TIE_BAND`, pure), `js/trade-page.js` (~9,500 lines, wiring), `js/ask-ai.js`, `js/accept-by.js`.
- Shared: `js/espn.js`, `js/season.js` (fetch; bridge → cloud → ESPN; store in front), `js/forecast.js` (optimalLineup, simulateSeason incl. `forced`), `js/capture.js`, `js/projection.js`, `js/floor.js`, `js/heat.js`, `js/store.js`, `js/cloud.js`, `js/connection.js` (bar + saved chip), `js/player-card.js`, `js/sortable.js`, `js/touch-titles.js`, `js/prefs.js`, `js/proj-trend.js`, `js/injury.js`, `js/proj-history.js`, `js/snapshots.js`, `js/backup.js`, `js/lineup-slots.js`, shared tables `js/standings-table.js` / `js/summary-table.js` / `js/actual-season-table.js` / `js/view-switch.js`, new 2026-10-06: `js/start-sit.js`, `js/must-win.js`, `js/waiver-gain.js`. Demo data `js/demo.js` + `js/demo-rosters.js`.
- Tests: `cd tests; node <suite>.mjs` singly; `node run-all.mjs [--bless] [--jobs=N]` — 72 suites, counts in `tests/counts.json` (a FALL fails the run). Last full run 2026-10-06 on af7f066: 68/70 in 1,730 s, the two failures (fc-test, link-check) were tests reading sliced work too early, fixed and green alone in 0563636. A test that snapshots Schedule's forecast table must wait out the "…" cells; one that reads Trade must wait for `data-ranked`. Per-suite counts measured 2026-10-06, each alone on merged main: tr-test 1089 (≈12 min), an-test 2569, decisions-check 381, test-decisions 200, test-decision-data 201, stats-order 387, stats-fit 142, shared-tables-check 271, test-season-rules 141, test-bye-rule 85, fc-test 1166, test-must-win 67, wv-test 802, test-waiver-gain 164, cmp-check 115, test-summary 327, cross-sim-check 36, pages-done-check 177, test-home (2 pages, 7 button orders), test-start-sit 47, test-cloud-wiring 150, test-backup 67, test-proj-history 136, test-projhist-cloud 131, touch-check 353, text-audit 9, test-pages-render 10 pages. Not suites: `node tools/measure-layout.mjs` (needs Edge).
- Hosting: `.github/workflows/test.yml` runs suites then a gated `deploy` job — inert until Tim sets Pages Source → GitHub Actions; the branch deploy publishes `main` in ~1–6 min; a hook reports when a pushed commit is live (`python ~/.claude/hooks/live-check.py fantasy-football`).
- Project path: `C:\Users\timha\OneDrive\Desktop\my-website\Code Projects\Fantasy Football`. Tim's league 476225250 (private, 10 teams, 14 regular weeks, 6-team playoffs weeks 15–17). Public test league 1241838.
