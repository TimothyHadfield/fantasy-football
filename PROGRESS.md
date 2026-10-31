# Fantasy Football — progress

Live: https://timothyhadfield.github.io/fantasy-football/ · Repo: https://github.com/TimothyHadfield/fantasy-football

## START HERE
1. Read this file, then the last entries of `chat.md`.
2. **PLANNED, NOT AUTHORIZED (2026-10-31): `docs/trade-fit-plan.md`** — finder rebuilt around Tim's own checklist (his words verbatim there). Phase 0 = review his liked custom trades (he is making them; he must send screenshots/names, Claude can't read his league). Build nothing until he says go. Extension 0.5.4 (2ec3b8d) fixed "Extension context invalidated" spam from tabs left open across a reload.
   **Nothing half-built (2026-10-31).** Last: Auto-set best lineup (Status top line). Before that (2026-10-28, late): Four asks built, merged and live (top four Status lines). Worktrees ff-pa / ff-cu / ff-wire under Temp/claude/wt can be removed. Last change before that: Trade rows lost the ± band and the yes word, and gained a This week column (1eb80ab, CI test fix 6c2d6e1, handoff a8444d6), live. The untracked `test-cloud-wiring.mjs` at the repo root is not from the 10-28 session; leave it alone.
3. Full history: **`docs/archive/progress-2026-10-28.md`** (this file before the 10-28 trim, byte-identical: the long per-feature Status paragraphs with Tim's quotes, measurements and suite counts for 10-16 → 10-26, the long NOT verified lines, and the 10-16 → 10-19 "Open for Tim" choices). Older: `progress-2026-10-16.md`, `progress-2026-10-15b.md` (Phase 2–4), `progress-2026-10-15.md` (Decisions D1–D16), `progress-2026-10-09.md`, `progress-2026-10-06.md` (per-feature paragraphs with data shapes: read the matching one before touching a feature), `progress-2026-10-02.md`, `progress-2026-09-21.md` (the old 250 KB PROGRESS), `handoff-2026-09-21.md` (rules 1–18 in full). Work queues: `AUDIT.md` and `docs/trade-rework-plan.md` (Phases 1–3 and 5 built; 4 and 6 not).

Last updated: 2026-10-28 (trim: Status lines from 10-16 to 10-22 shortened; full text in the 10-28 archive).

Read-before-touching (sections of `docs/archive/progress-2026-09-21.md` unless noted):
- Trade engine / finder → "The Trade page", "Per-week trade valuation", "2026-09-21 — the Trade page opens on a goal"; `js/trade.js`, `js/trade-odds.js` headers.
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
- Any feature built 10-16 → 10-26 (Zero = base, Ended trades, Pending moves, Week recap, One Value, ESPN tabs, Draft What if…) → its Status paragraph in `docs/archive/progress-2026-10-28.md`.
- Trade test stub (`tests/tr-stub-season.mjs`) → its header, plus `specOf`'s env knobs (below, Traps).

## Goal right now
Tim, 2026-09-21: "I basically want to keep working on big improvements in the display, formating, and calculation system with the cite. Something I want to get down really well is the Trading system. I want the cite to offer virtually the perfect trade to the user."
Since 2026-09-29 he sends one concrete feature ask at a time.

## Status (all on `main`, live)
One line each. Full paragraphs (Tim's words, method, suites, measurements): `docs/archive/progress-2026-10-28.md` Status.
- **Notifications: Auto-set best lineup (2026-10-31, 50329fa; extension 0.5.3):** Tim: "fix all future ESPN lineups … automatically sets all my lineups on espn so that the players with the highest proj that week are in and playing and I can look over them". ESPN writes only the CURRENT week, so each week is set once it is current. Switch in the notifications panel (off by default; disabled without the extension's lineup switch); on any laptop page load (`js/connection.js` hook, ESPN checked at most every 2 min) `js/auto-lineup.js` solves the highest raw-ESPN-projection legal lineup (bye 0, locked men + IR untouched) and sends one full-lineup write (guard: up to 20 moves for that request type, slot overfill refused; other requests stay ≤4). Re-applies in the week only while ESPN equals its last write; a hand edit = hands off that week (a waiver pickup on the bench is not an edit). Line "Lineup set for week N" + moves + Open ESPN. Suites auto-lineup-check 91, test-lineup-guard 392, test-bridge-lineup 51. NOT verified: any real ESPN write (first real run is Tim's account), 0.5.3 in his Chrome.
- **ESPN projection log (2026-10-31, separate repo https://github.com/TimothyHadfield/espn-proj-log, folder `Code Projects/ESPN Proj Log`):** Tim: "record the time and date for each change, the player, and all future week change's in proj. (weeks now-end of season). Don't set up any analysis or anything on it yet". GitHub Actions hourly (cron :17) reads `kona_player_info` per week (current → 18, ~8.6 MB each) via public league 1241838, no login; `log/<season>/<date>.csv` = one row per points change (time_utc, time_mt, id, name, pos, team, week|ros, old, new); `state/<season>.json` = latest points + raw stats, one player per line (git history = full stat history). Baseline 672 players: state 1.8 MB, log 0.6 MB. Points use 1241838's scoring; raw stats allow re-scoring. First cloud run green 2026-10-31. Not wired into the site.
- **Players: Player analysis panel (2026-10-28, ea0339e):** Tim: "make something at the top of the players section called player analysis … search this player by name … show their 17 week preview as well as core metrics. underneath this show the future proj/week graph … another graph … what that player's proj for a future week was at any given time. Colorize the lines from red to green". After Data source on waivers.html. Graph 1 = future proj (regular-season weeks not started, 0/bye = today's waiver line) per saved copy (as-of week), rightmost = now; hover/tap = the weekly projections behind it. Graph 2 = one line per saved copy over target weeks, red oldest → green now. Free agent: ROS total ÷ games left, one dot. Pure maths + SVG `js/player-history.js`; `player-card.js` `runHtml`. Suites test-player-history 53, pa-check 44; waivers ceiling 291 → 302.
- **Projection copies keep the wire (2026-10-28, 59d001a):** `rec.wire` = top 25 QB/RB/WR/TE + 10 K/DST free agents, team-row shape + 8th col `ros` (ESPN ROS total); only the copy's first week has a weekly proj (wire is one week per read). No extra request (`fetchFloors` keeps its wire as a hidden prop). 18.8 → 30.7 KB on 1241838. Reader `projHistory.wireAsOf`. Late copies carry no wire.
- **Custom trade (2026-10-28, 2f047e6):** Save keeps the ticks; past-trades boxes (were 24×20 full red, broken "¹3" tick; style in trade.html) now native size, ticked = muted red #b5545c; "Past trades with X" table under the lists (season trades + ended sent offers + pending, `js/trade-history.js`, no new request). Suite custom-trade-check 29.
- **Extension 0.5.2 (2026-10-28, 666ac12):** Tim: "remove that notification and just autmoatically tic the right players". No badge when all men are in; badge only when one is missing / not registered / refused. test-espn-tick 85+.
- **Trade rows: no ± band, no yes word; new "This week" column (2026-10-28, 1eb80ab):** Tim: "remove the +- 0.4 or whatever next to the change in % bar in trade summarys. Also remove the "yes:unlikely" showing in the trade bars" + "Add a new column that shows this week's proj change with the top bar being mine and the bottom being theirs". The band is gone from every Trade figure (still in "How this works" and the Ask AI text). The yes word is gone from rows only (still in the Chance card, the pop-up and the custom box). New split column **This week** after Gain (finder, Suggested, saved): You / Him = lineup projection in the first unplayed week with the deal minus without (raw `byWeek`/`theirByWeek`, ends rounded first), card `data-rc` wkm/wkt, sent-after-that-week = 0.0. `thisWeekOf` / `thisWeekCellHtml` in js/trade-page.js. Suites: `tr-thisweek-check` 81 (fails 7 on old code), `tr-yes-check` 42, tr-test 1224/1224, test-notify-trades 76.
- **Draft "What if" (2026-10-26, 02e0faa):** swap a team's pick for anyone drafted later; men in between slide (FLIP); swaps stack; Undo / Back to normal; box with record, PF, PA, rank, playoffs ± vs real. Suites test-draft-whatif 58, draft-whatif-check 60.
- **Summary share card: Playoff % (2026-10-26, 38d2359):** column between LUCK and Title %; sort unchanged. Not on the on-page table (Tim's call).
- **Zero = base (2026-10-22):** a future 0 or bye counts as his position's frozen waiver line (`value.fillOf`, `filledWeek`, `restAvg`/`restProjAvg` with `fill`); lines still built from `rawAvg`. `docs/zero-base-plan.md`.
- **Ended trades + pending on Notifications (2026-10-22 night):** `js/trade-outcome.js`; sent offers remembered in `ff.trades.sent.<league>-<season>`; a missing one costs ONE `mTransactions2+mRoster+mTeam` read → declined / expired / vetoed / no longer pending; Follow up + Dismiss; every offer is level `pending`.
- **Pending moves (2026-10-22 late):** one `mPendingTransactions` read (`season.fetchPendingMoves`; `js/pending.js`, `js/pending-view.js`): offers as Pending saved-trade rows on Trade (never written to `trade.custom`); claims on Home `#pendingMoves`, Notifications "Pending", Players tag; phone via `schedule.pendingTrades`.
- **Week recap previews (2026-10-22):** every player, manager, score and missed figure in the recap opens the house cards (`js/week-summary-page.js`, prefix `recap`). Suite `recap-previews-check` 23.
- **CI fix (2026-10-20):** `wv-start-check` (e) expects the "Value" header. (d) can flake locally under load.
- **Home: Week recap + injury columns (2026-10-19 late):** recap moved from summary.html to Home; synced copy asks ESPN nothing; Injury report = Player | Est. return | Up while out (`js/injury-gains.js`).
- **One Value (2026-10-19):** one function `value.playerValue` for Players, Trade and the card (36/36 equal on 1241838). Suite `value-match-check` 17.
- **Week recap (2026-10-19):** `js/week-summary.js` (pure) + page; weeks = every matchup played and every NFL game final; snapshot `ff.weeksum.1.<league>.<season>.<week>` (first write wins). Suite `test-week-summary`.
- **Proj avg = weeks still to come (2026-10-18, 767792c):** `projAvgWeeks` in `js/proj-avg-grid.js`; season over → whole season.
- **Trade: depth map → All teams · proj avg grid (2026-10-18):** shared `js/proj-avg-grid.js`; Trade feeds who-to-start.js its own weeks via `configure`.
- **Trade: Best combo removed (2026-10-18):** panel and engine gone; dead `offer.combined`/`.merged-tag` guards left, harmless.
- **Weekly totals "Opponents of" (2026-10-18, d26909d):** picker outlines the picked team's opponents (`td.wk.opp`). Suite `opp-outline-check` 32.
- **Site icon (2026-10-17):** brown football on #3ba55d (`icon.svg`, `apple-touch-icon.png`, `favicon.png`).
- **ESPN tabs "Analysis" + "Trade" (extension 0.5.0 b9c3b44; 0.5.1 fix 10-18):** one window-high frame in a fixed `#ffx-view` that scrolls itself; `guardLinks` opens links in a new tab. Check: `node tools/espn-tab-check.mjs`.
- **Trade:** opens on a goal; finder → season sim on one seed → order by net increase with the goal-chance guard; custom box, Suggested (Playoffs switch `trade.sugPlayoffs`), saved/Assume, Ask AI, accept-by, bye pills, injury underline, trend arrows; sliced search (`data-ranked` on `#tradeTable` = done). No K/D/ST/Value < 1 in suggestions (`notToSuggest`). Player name → Custom trade (`trade.html?with&get&send`). Audit Phases 1–4 + phone cards (`docs/trade-audit-plan.md`).
- **Projection recheck (2026-10-16, 7cde86f):** `season.recheck()` also reloads on a current-week projection change.
- **Playoffs page (2026-10-16):** teams' Playoffs %/Bye % + playoff-week projections; players taken and available with Avg/Future/Playoff columns, Proj | Value switch. Suites `playoffs-check` 165, `playoffs-players-check` 178.
- **Other pages:** Players (waivers.html: wire + taken, Gain, Who to start, Show my players, 💎/🪙), Player card (`js/player-card.js`), Analysis, Stats, Schedule (sim, Time machine, backup export), Home, Summary, Decisions, Draft, Main menu (`leagues.html`), Notifications (`docs/notifications-plan.md`).
- **Value (`docs/value-plan.md`):** rest-of-season avg over the frozen waiver line; Proj/Value switch on Analysis, Players, Trade, Playoffs. Stub hook `FF_VALUE`.
- **Data layer:** store.js, cloud sync (Firestore `fantasy-football-th`), bridge extension for the private league, projection history + cloud carry.
- **Not built:** Phase 5a, rest of 5b, Phase 6 (old trade-rework plan; Claude recommends skipping). Cross-page ideas of 2026-10-09 (not authorized; list in the 10-16 archive).

## Open for Tim (his to decide)
Choices Claude made and Tim hasn't confirmed, in full: `docs/archive/progress-2026-10-28.md` "Open for Tim" (10-16 → 10-22 wording, labels, placements) and `docs/archive/progress-2026-10-15.md`.
- 2026-10-28 · Player analysis: graph 2 read as one line per saved copy over target weeks (not one line per target week over time); panel after Data source; wording mine; graph 1 uses regular-season weeks while the card's Proj includes playoffs.
- 2026-10-28 · Custom trade: past-trades table between lists and Suggested; status words; unticked red box keeps a red ring; orange box size untouched.
- 2026-10-28 · Extension: problem badge kept when a man is NOT in the trade.
- 2026-10-28 · This week column: heading "This week", You/Him labels, placed right after Gain; the yes word kept in the Chance card, pop-up and custom box.
- trade.html prose ceiling (text-audit) is his call.
- Earlier: Trade audit question g; phone first trade card ~2.6 screens down; Schedule/Decisions sim chances still to the tenth; per-player current-week lock (reverses D12); availability discount. Held ideas: D/ST streaming by sportsbook line, laptop-free weekly save, Trade finder on the phone, league-wide best/worst moves.

## Authorized next steps
- **Nothing open is authorized (2026-10-28).** Every ask was built.
- Not authorized: 5a, the rest of 5b, Phase 6, the 2026-10-09 cross-page ideas.
- Pages Source = GitHub Actions: the gated `tests` run publishes only when green; `deploy-now.yml` publishes at once (used after every push).

## Standing instructions
- **Push every change when it is done.** Tim judges by the deployed site. Never push failing tests. Split into sensible commits.
- **No long test runs before a push** (Tim, 2026-10-06: "make sure you don't ever do long test runs again, and if you do it can be after the push"). Run only the suites the change touches.
- **Live in a minute** (Tim, 2026-10-06: "forget the test. push now."). After every site push: `gh workflow run deploy-now.yml -R TimothyHadfield/fantasy-football`, curl-confirm a changed file (compare with CRs stripped), tell him to hard-refresh.
- **Many agents at once** (Tim, 2026-10-06: "You should be deploying many more sub-agents"). One builder per separable part, own worktree.
- **Tim, 2026-10-08:** "if you ever have a recommended option for something, just go with it, you don't need to ask me if you recommend it."
- **Give links, not prose directions.** **Prose, not mechanics.** **Complement ESPN, don't replace it.**
- He checks numbers by hand against ESPN; when he says one is wrong he is usually right.
- His vocabulary: "players"/"users" can mean managers; "graph"/"chart" can mean a table; "cite" = site; "prepare md files for chat reset" = /checkpoint. "Player section" = the Players page (waivers.html). "Bars" in Trade = the split cells (top = you, bottom = him).
- He sends asks mid-task: finish what is in flight first, then build the new ask (a builder in parallel is fine).
- House panel shape: title → one `.lede` → controls → table → one-line key → `<details class="explain">`. Run `text-audit.mjs` after adding words.
- House preview: hover/focus card for a mouse, tap = bottom sheet; rows add up to the cell; one preview per number.
- A printed difference equals its two printed ends subtracted; round first, then sign.
- Session start: check `C:\Users\timha\Downloads\fantasy-archive-*.json` and `data/snapshots/`.
- **A 0 counts as the base** (Tim, 2026-10-22): "I do want to count the 0 everywhere, but not as a pure 0. Make the number the base of that position. For example if a 0 value equals 13 pts proj for a WR, then replace the 0 with 13 when counting for future proj. this is also the case for BYE weeks." The base is the waiver line (manager's pick). Week cells still show ESPN's real 0/BYE.

## The rules that must not be re-litigated (full text: archive HANDOFF)
1. ESPN publishes projections, never odds — every % is our model and says so.
2. ESPN projects every future week incl. 15–18; bye = 0.00 ≠ null. D/ST projects in its bye → site forces 0 in a known bye week.
3. No bulk form: one request per week.
4. Free-agent week works only without a stats filter alongside `scoringPeriodId`.
5. Statistics return null below their data thresholds; pages print "—".
6. Never read localStorage for league config directly — `savedConfig()`/`onConnection()`.
7. State the basis of every derived number in a panel note.
8. ESPN keeps no projection history — capture it while on screen (`js/snapshots.js`).
9. A squad is its team id, never its label.
10. Trades priced by the lineup each week; per week first, total as sub-number.
11. A combo's gain is not the sum of its trades' gains.
12. Archive's durable home is `data/snapshots/<league>-<season>.json`; a console 404 when absent is expected.
13. Positional floor = 3rd-best free agent (by ROS ÷ games left); never changes who starts.
14. One red/green scale (`js/heat.js`), ±1 SD; tint is a background-image, rows set `background-color` only.
15. `js/store.js`: played week final, future week fresh 6 h, unknown never final; `recheck()` also reloads on a current-week projection change.
16. A key under a coloured table is one sentence; thresholds behind the toggle.
17. Player card: bold = "he starts" (future weeks only).
18. Trade page opens on a goal; lists ordered by net increase (2026-10-09) with the goal guard.
19. A tie is a display grouping on top of a strict sort, never a sort key; never widen `EPS`.
20. A page showing the phone's synced copy makes zero ESPN requests.
21. **No K, D/ST or Value < 1 man in a suggestion** (Tim, 2026-10-16: "stop suggesting to trade K and DEF in the suggested trades list" / "don't suggest to trade with any player who has a value under 1"). Test fixtures adapt; the rule doesn't.

## Traps
- **CI fails when a suite's assertion count FALLS** (`tests/counts.json`; 10-28 tr-yes-check 87 → 42 on purpose). Update that entry by hand (or `node run-all.mjs --bless`, ~35 min) in the same push.
- **Changing a Trade row's cells breaks other suites' cell indexes:** tr-test (`trioOff`, appeal/value index), `tr-yes-check`, `test-notify-trades` (row shape) all read rows by position. Grep tests for the old order before pushing (10-28 CI went red on test-notify-trades).
- **A sent offer gone from the waiting list costs one extra ESPN read** (`mTransactions2+mRoster+mTeam`, season.js `trackSent`); Home's request count check (`home-winpct-check`) counts the pending-moves read. Never let `git worktree remove --force` touch a worktree holding a node_modules JUNCTION: it deletes the target's files (happened 10-22; `npm ci` restored). Remove the junction first with `cmd /c rmdir`.
- **ESPN injury status is TODAY's only** (measured 10-19). The recap saves the latest week's injuries only between ESPN closing the week and the next week's first kickoff (`nextUnderWay`); older weeks are rebuilt from "played, then sat out" and claim no status. A man who sat out is filed as projected 0.0 / actual 0.0, not null.
- **ESPN tabs: never go back to page-tall frames scrolled by ESPN's page.** Chrome does not draw off-screen cross-origin frames, so they blank while scrolling. `page.screenshot` hides this; only a screencast during a real scroll shows it (`tools/espn-tab-check.mjs`).
- **CI:** a second push within minutes cancels the first run, so "deploy FAILED (cancelled)" and "NOT live after 6 min" are usually false. Confirm by curling a changed file. The gated `tests` run takes ~16 min. (The 10-16 red list — bell-check, done-check, notify-check, text-audit — is in the 10-28 archive; CI was green again by 10-17.)
- **Trade stub knobs (`tests/tr-stub-season.mjs` `specOf`):** `TR_SPARE_QB=1` builds the QB hole; `TR_BYE_MAN=110` gives Ana TE2 the week-8 bye; `TR_PO_SPIKE` adds playoff-week spikes. With K/D/ST barred, the base stub has 3 finder rows, all netting +10. Order and cap checks need `TR_SPARE_QB`.
- **Run-from-directory:** stub scenarios run from `tests/` as `node --import ./tr-register.mjs tr-test.mjs <name>` (prints `@@` JSON). Full tr-test takes ~18–60 min under load; run it in the background.
- **Other chats work on this repo at the same time.** Run `git fetch` and merge origin/main before every push. Never stage another session's uncommitted files.
- **Worktree cleanup:** `git worktree remove` often fails with "Permission denied" (OneDrive locks). The weekly sweep handles leftovers. Worktrees go under `C:/Users/timha/AppData/Local/Temp/claude/wt/`, never `.claude`.
- **Commit messages on PowerShell 5.1:** a here-string with quotes splits into pathspecs; write the message to a file and `git commit -F <file>`. The handoff file is `PROGRESS.md` (capital), `git add progress.md` misses it.
- **Local server:** port 18947 serves the main tree; 18961 served a different directory (wrong). Headless: `node ~/.claude/tools/phone-view.mjs <url> [--desktop] --do 'fill:#connLeague=1241838' --do 'click:#connSync' --do 'wait:#modeBadge.live' --out x.png`.
- `tests/text-ceilings.json` caps on-screen prose per page; raising one is Tim's call. Playoffs is 93.
- `run-all.mjs` takes ~30–40 min serial (~75 suites). Counts in `tests/counts.json` may only rise.
- **Network outages kill subagents.** Resume with SendMessage. Builders' fresh worktrees need `npm ci` in tests.
- Chaining a push after test output with `;` pushes even when a suite failed.
- Suites reading Trade must wait for `data-ranked` / `settle()`, never a fixed time.
- `settleGoal` returns on "not ranked by your…"; `searchOnce` has its own wait.
- The stub answers instantly; test load order with `TR_WEEK_DELAY=150`.
- He gains is reach-weighted under "Win it all"; the flat figure is `offer.theirPoints`; page code goes through `hisSideOf()`. Never feed netted numbers to the sim.
- A child scenario returns via `emit()` from `tests/emit.mjs`, never `console.log` + `process.exit`.
- Green on Windows is not green on CI.
- An assertion guarded by `if (x.length)` with no else passes vacuously.
- `.pending` in `css/app.css` is a whole notice banner. `textContent` reads sr-only text too.
- Stale-module trap: Pages serves js with `max-age=600`; a new export can take ten minutes.
- Tim's league (476225250, private; never read it) has a 1-day trade review period.
- Shared machine: Tim's OCR jobs can hold cores. Never `taskkill /IM node.exe`.
- Shell: multi-line `node -e` gets mangled; write scripts with Write, or use a python heredoc.
- Test account: none needed; the public league 1241838 is the live fixture.

## Decisions
Full text of D1–D16 and every 2026-09-27 → 2026-10-07 decision: `docs/archive/progress-2026-10-15.md` "Decisions".
- 2026-10-15 · Yes-chance (`js/accept.js`) replaces D3; words likely ≥ 60%, unlikely < 35%.
- D4 · Title goal prices playoff weeks; "last" goal = regular season only.
- D9 · Floor applied at assessment, never selection.
- D10 · Private league via `extension/` bridge; phone reads a Firestore sync.
- D11 · `TIE_BAND = 0.4` pp. D12 · A kicked-off week is out of a trade's span. D13 · Child scenarios return via `tests/emit.mjs`.
- 2026-10-09 · Trade lists ordered by net increase; 10-15 goal guard on top, judging the unrounded change.
- 2026-10-15 · Forced cut = least points lost first, Value breaks ties. Floor ranks the wire by ROS ÷ games left.
- 2026-10-12 · +1 a week floor on finder rows; Total = Appeal + both gains.
- 2026-10-16 · K/D/ST/Value < 1 barred through the engine's existing `skip` (ticked men still pass), not a post-filter, so Suggested and the finder agree.
- 2026-10-16 · Test fallout from that rule fixed with stub env knobs (`TR_SPARE_QB`, `TR_BYE_MAN`), not by loosening the rule.
- 2026-10-16 · Name → trade passes state by URL params (the site's existing `with/get/send` deep link), stripped after use.
- ~~2026-10-16 · Playoffs Future avg skips 0 weeks; Playoff avg counts them (Tim).~~ Replaced 2026-10-22: in both, a 0 or bye counts as the waiver line.
- 2026-10-22 · A future 0/bye week = his position's frozen WAIVER line (not the starter line, not a mix). Lines stay built from the raw average (no circularity). `docs/zero-base-plan.md`.
- 2026-10-18 · Proj avg = regular-season weeks not yet started; season over → whole season again. One rule, `projAvgWeeks` in `js/proj-avg-grid.js`.
- 2026-10-19 · A man's Value is ONE figure everywhere: `value.playerValue` = `valueOf(restAvg over every week left)`. Only week/slot cells are per-week conversions.
- 💎/🪙 flat ±2 on the plain average, Tim 2026-10-19. Marks (Trade + Players) and Appeal read ESPN's plain season average; exactly 2.0 counts. e23309a.
- 2026-10-28 · This week = raw lineup change in the first unplayed week (not netted, not reach-weighted), ends rounded before subtracting; the ± band stays only where the method is explained.

## NOT verified
Full per-feature lists for 10-16 → 10-22: `docs/archive/progress-2026-10-28.md` "NOT verified". Short form:
- **Everything since 10-16 is headless only** (WebKit 393 + desktop, demo + public league 1241838). Never seen on Tim's private league, his iPhone, or the real Firestore synced copy (stub-tested at real size).
- **Player analysis / wire / past-trades table (10-28):** seeded copies + stubs only; no real wire row seen in the graph; no real ESPN trade/offer record in the table; full tr-test of the changed `custom`/`savedGroups` scenarios left to CI; extension 0.5.2 not reloaded in Tim's Chrome.
- **This week column (10-28):** stub + suites + live curl; not seen at 393 px on his league mid-week.
- **Ended trades / Pending moves:** NO REAL ESPN pending or trade-history record ever seen; shapes from cwendt94/espn-api and dustinJ15/fantasy (cited in `js/pending.js`, `js/trade-outcome.js`).
- **Zero = base:** lineup trade engine and Proj-mode slot grids still use the positional floor, not the fill (on purpose).
- **ESPN tabs:** not seen signed in, in Tim's Chrome, or on his private league; hard flick still blanks Analysis's bottom briefly.
- **Draft What if:** a card opened over the board after a swap on a phone (likely the test's mouse).
- Playoffs %/Bye % = Schedule's sim: same seed reasoned and tested on demo only.
- Earlier (10-06 → 10-15) gaps: `docs/archive/progress-2026-10-16.md` NOT verified.

## Rejected / parked
- ~~Injury-aware trade pricing~~ · 2026-09-20 · needs a miss probability ESPN doesn't publish.
- ~~D/ST streaming by Vegas totals~~ · 2026-09-20 · no odds feed (2026-10-06: a free feed found; his call).
- ~~Near-tie variance helper~~ · 2026-09-20 · +0.4 pts win prob.
- ~~Buy-low/sell-high from usage~~ · 2026-09-20 · research project.
- ~~Three-team trades~~ · ESPN blocks them.
- ~~Projection-drift chart~~ · until December.
- ~~Pure client-side private-league read~~ · impossible (third-party cookies).
- Draft page · parked except the What if Tim asked for; don't touch unless asked.
- ~~V20 disable the week picker~~ · 2026-09-27 · measured live, not inert.
- ~~"Also send" suggestions~~ · 2026-09-29 · Tim: "I haven't found them usefull at all yet".
- ~~Trade custom lists' SD hover~~ · 2026-10-06 · Tim: "Remove the SD one."
- ~~Silencing the snapshot-probe 404~~ · 2026-10-06 · needs a hack.
- ~~2-for-1 fills the freed spot from the wire~~ · 2026-10-15 · changes 0 with the floor; "best" FA flatters.
- ~~`run-all --jobs` by default~~ · 2026-10-06 · saves little, timing suites flake.
- ~~Best combo panel~~ · 2026-10-18 · Tim: "Remove the best combo section of the cite". Don't bring it back.
- ~~Depth map on Trade~~ · 2026-10-18 · Tim: "the depth map is useless and I don't like it".
- ~~Trade audit Phase 4 💎/🪙 scaling~~ · 2026-10-19 · Tim: "… Keep it at the +2/-2 mark". Reverted e23309a; don't bring it back.
- ~~± band and yes word on Trade rows~~ · 2026-10-28 · Tim asked them removed.
- ~~TR_SPARE_QB alone for trade-progress's bye card~~ · 2026-10-16 · it took Bills D/ST's slot; the bye moved to Ana TE2 instead.

## Map
- Pages: index, stats, analysis, schedule, playoffs, waivers (Players), trade, decisions, summary, notifications, leagues, draft, debug.
- Trade: `js/trade.js` (engine, pure), `js/trade-odds.js`, `js/trade-page.js` (wiring, ~12k lines; `notToSuggest`, `thisWeekOf`, URL tick on load), `js/trade-cards.js` (`gainWeeksSpec`), `js/accept.js`, `js/ask-ai.js`, `js/accept-by.js`, `js/links.js`. Grid: `js/proj-avg-grid.js`.
- Playoffs: `js/playoffs-page.js`, `js/playoffs-players.js`.
- Pending / outcomes: `js/pending.js`, `js/pending-view.js`, `js/trade-outcome.js`. Recap: `js/week-summary.js`, `js/week-summary-page.js`, `js/injury-gains.js`.
- Shared: `js/espn.js`, `js/season.js`, `js/forecast.js`, `js/store.js`, `js/cloud.js`, `js/connection.js`, `js/player-card.js`, `js/value.js`, `js/heat.js`, `js/floor.js`, `js/sortable.js`, `js/prefs.js`, demo `js/demo.js` + `js/demo-rosters.js`.
- Tests: `cd tests; node <suite>.mjs` (deps in `tests/node_modules`); `node run-all.mjs` registry. Measured 2026-10-28: tr-test 1224/1224, tr-thisweek-check 81, tr-yes-check 42, test-notify-trades 76. Earlier counts in the archive Map.
- Hosting: Pages Source = GitHub Actions; `.github/workflows/test.yml` (five shards) then gated deploy; `deploy-now.yml` publishes at once. `gh run list -R TimothyHadfield/fantasy-football -w tests`.
- Project path: `C:\Users\timha\OneDrive\Desktop\my-website\Code Projects\Fantasy Football`. Tim's league 476225250 (private, 10 teams, 14 regular weeks, 6-team playoffs weeks 15–17). Public test league 1241838.
