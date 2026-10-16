# Fantasy Football — progress

Live: https://timothyhadfield.github.io/fantasy-football/ · Repo: https://github.com/TimothyHadfield/fantasy-football

## START HERE
1. Read this file, then the last entries of `chat.md`.
2. **Nothing half-built from this chat (2026-10-15 evening).** Trade audit Phases 1–4 + phone cards LIVE (54d3491); tr-test 1288/0 locally on 1649e39. Another chat works on assumed trades in parallel (076ffb0, 3ca885f) — check `git status` for its uncommitted files and never stage them. **CI red, not from this work:** text-audit (trade.html ~580 words vs ceiling 429), tr-value-check ▲ placement.
3. Full history: `docs/archive/progress-2026-10-15b.md` (this file before the evening trim: the long Status/Authorized lines for Phases 2–4), `docs/archive/progress-2026-10-15.md` (this file before the 2026-10-15 trim: full Decisions D1–D16 + 2026-10-06 list, full NOT verified for 2026-10-06/08), `docs/archive/progress-2026-10-09.md` (this file before the 2026-10-09 trim: the long 2026-10-08 paragraphs), `docs/archive/progress-2026-10-06.md` (this file before the 2026-10-06 trim — the long per-feature Status paragraphs with Tim's quotes, data shapes and measurements live THERE; read the matching paragraph before touching a feature), `docs/archive/progress-2026-10-02.md`, `docs/archive/progress-2026-09-21.md` (the old 250 KB PROGRESS), `docs/archive/handoff-2026-09-21.md` (old HANDOFF, rules 1–18 in full). Work queues: `AUDIT.md` and `docs/trade-rework-plan.md` (Phases 1–3 and 5 built; 4 and 6 not).

Last updated: 2026-10-15 evening (Trade audit Phases 2, 3, 4 + phone cards live; see chat.md last entries and `docs/trade-audit-plan.md` BUILT sections).

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
- **Analysis:** All teams grid, Weekly totals, Season by week (Position | Player), Proj changes box, Who to start, Roster detail. "Actual history" for played weeks (real lineup, real score; Actual | Proj select shared by the tables). **2026-10-06:** week totals from unrounded slots (`raw`, `fillSlots`) = Schedule; Avg = mean of the row's regular-season numbers (bye out); more in the 2026-10-09 archive. Prose 368/381.
- **Stats:** standings, week by week (Actual | Projected | Luck | Act−Proj | Opp scoring | Close game | Margin), scatter graphs, score spread (early look from 3 weeks), decimal records. **Schedule luck = rest of season** with its weeks in the heading and a per-fixture preview on the last figure (`#oppPop`, 92094ac). **2026-10-06 (detail in the 2026-10-09 archive):** `signed` rounds before signing; a tie = close-game luck 0 (`closeLuckOf`); Hardest schedule tile = rest of season (56de430); games with unread projections are skipped by every luck mean ("Incomplete: …"); luck cells open a parts preview (`explain` option of the shared standings table; b2b82dc).
- **Schedule:** sim, forecast, cards, head-to-head, Time machine. **2026-10-06 (detail in the 2026-10-09 archive):** "My season" **Title ± / Last ±** (`js/must-win.js`, `simulateSeason` `forced`; b11c022); charts at their box's width, `shortNames` (e72eaeb); Export archive = **full backup** (`js/backup.js`; import writes only absent keys) and the **"Week N saved / not saved yet" chip** (`ff:saved`; 077f85e).
- **Players (waivers.html):** wire + taken, all weeks, Actual row, Your team select. **2026-10-06: Gain column** (`js/waiver-gain.js`: best lineup with him minus best lineup now, least-costly drop, priced by `priceTradeAcrossWeeks`, per week; preview with weeks; sliced after paint; 645a0dc); `.jump.hidden` fix; "choose your team…" option.
- **Home:** this week's cards, injuries, bench, roster strength. **2026-10-06:** deadlines line + "Start A over B" (`js/start-sit.js`); records on cards; synced copy makes **zero ESPN requests** (`season.cloudSource()`, 9e41b53).
- **Summary:** chart + share image, Record `7-1`. **2026-10-06:** fits a phone; your row marked `me` (real league only) (5fe07cb); status wording for missing projections (9bbcb0c).
- **Decisions** (`decisions.html`, engine `js/decisions.js`, plan `docs/decisions-review-plan.md`): undo any add/drop/trade/lineup rule and see the season replayed; two lineup rows (Reasonable / Perfect hindsight), All users, partial week with LIVE tags, Display noise. **2026-10-06 (detail in the 2026-10-09 archive):** sortable tables, Points/wk, "Biggest swap", every Diff opens its swaps (`weekSwaps(cell)`), click a previewed number → Season by week with that week outlined, changed players outlined, dim projection left of each actual, **Avg column on the right** (Tim) (8ddf1cf).
- **Data layer:** store.js, cloud sync (Firestore `fantasy-football-th`), bridge extension for the private league, finished-counts-now, week in progress, projection history (`js/proj-history.js`) + its cloud carry (b859d9e). **2026-10-06:** `assembleSeason` hands on every decided game even when a played week's roster read failed (projection 0, `projectionsAvailable` false, `weeksWithoutProjections`); `projectedTotalForWeek` applies `byeAdjustedProjection` (efed6da).
- **Notifications (BUILT 2026-10-11; plan + BUILT section `docs/notifications-plan.md`):** `notifications.html` (not in the nav row) behind a bell + count in the top bar (`js/connection.js`); engine `js/notify.js` (pure), loader `js/notify-load.js` (the ONLY writer of `ff.notes.<lg>-<season>`), Trade saves its top deals (`js/notify-trades.js`, key `ff.notes.trades.<lg>-<season>`, rule: you gain AND net increase > 0), trade offers `season.fetchPendingTrades` (`js/pending.js`, rides `schedule.pendingTrades` in the cloud copy), extension 0.5 lineup write (`extension/lineup-guard.js`, popup switch OFF by default, `bridge.setLineup`). **NOT verified, needs Tim: the real ESPN lineup write (first click is his), the real pending-trade payload, the iPhone.** Tim must reload the extension and turn the popup switch on.
- **AUDIT** §1, §2 (bar 2.6), §3, §6.5, §6.6 done. **CI:** every run on 2026-10-06 before d58cebc was cancelled by the 20-minute cap (the earlier "green since a0d0dc4" was stale); now five shards, ~10 min (tr-test slice 9.5 min). First sharded run failed one decisions-check timing check (hover is quiet 900 ms after a go; fast CI got there sooner) — test now waits.
- **Single-week luck limit (BUILT 2026-10-06, 680a0da; plan + BUILT section `docs/outliers-plan.md`).** Tim: "a single unlucky event … shouldn't be able to affect your entire luck ranking for the season"; the close-game ±50 formula STAYS ("how it is is good for now"); "lets just round it out to a limit of +- 50"; always on. `WEEK_LUCK_LIMIT = 50` in `js/stats.js`: weekly cells are real, every season luck figure counts each week within ±50; over-limit cell = dotted underline. Not seen on his league or iPhone; strings are his.
- **2026-10-08, live (full paragraphs: `docs/archive/progress-2026-10-09.md` Status):** player proj+score everywhere (`docs/player-numbers-plan.md`); stale rosters after a trade fixed (Sync now drops non-final weeks, `ff:refresh`, `store.forgetOpen`); Roster strength on Stats (`js/lineup-avg.js`) + Future proj diff; Draft "Our draft" (`js/draft-review.js`; NOT in the phone's cloud copy); shared preview base (`js/pop.js`, `js/links.js`, `js/heat.js`, `playerCardFromWeeks`).
- **2026-10-08 wave, live (25404bd; full paragraph in the 2026-10-09 archive; `docs/wave-brief.md`, `docs/previews-plan.md`, `docs/colour-plan.md`, `docs/charts-plan.md`):** shared `statCard` previews + connectors on every page, colour additions, chart sizes + view switches B1–B5, diverging bars on the three Stats boxes, deep links (`trade.html?with=&get=&send=`, `analysis.html?team=`). A record with a game in play keeps its `title` and takes no card (`record-live-check` rule 7). Builders' wording choices: chat.md 2026-10-08 (wave).
- **Draft "vs preseason rank" (2026-10-08):** switch `#compareToggle` (pref `draft.compare`); rank = ESPN PPR draft rank (`espn.fetchDraftRanks`, kept in `ff-draft-review-v1`), counted AMONG THE DRAFTED; number = drafted-at − place (+ = went later than ranked). Auction "drafted at" = price rank. His to confirm: among-drafted, labels "Pre" / "Biggest slide" / "Biggest reach".
- **2026-10-09, player VALUE — BUILT and live (plan, Tim's words verbatim, BUILT section: `docs/value-plan.md`).** Value = rest-of-season average ESPN projection (bye left out, other zeros count) over the waiver line (mean of the top 3 free agents at the position), points below the starter line (worst man the league starts) at half, floor 0, points a week. **Lines FROZEN once per league-season** (Tim: "pick specific baselines and stick to them throughout the season"): `localStorage ff.value.<league>-<season>`, rides `schedule.valueBase` to the phone, first copy wins (`buildCloudPayload`). API: `js/value.js` (pure), `season.fetchValueBase()` / `fetchPlayerValues()` / `valueWeeks()`, `player-card.js` `setValueSource` + `registerRun({playerId, value})` — Value leads the glance line on every card. **Proj / Value switch** on Analysis, Players, Trade (team totals never convert). Draft "vs worth now", Value totals, "Drafted / Own now" (detail: value-plan BUILT). Stub hook for tests: `globalThis.__ffValue` / env `FF_VALUE`.
- **Also 2026-10-09 (each Tim's ask, live):** Stats Schedule luck lists the LUCKIEST first (chart reversed; tile still hardest); Trade recommended + Suggested lists ordered by **net increase** = You gain + He gains as printed (heading "Trades ranked by net increase"; rank "=" = equal printed sums — **supersedes rules 18/19's order and tie band for these lists**); Players: green "worth starting" number REMOVED, green box = "you would start him" that week (`optimalLineup` with him added; judged on projections even on Value); **Who to start box above Available players** when a position + team are chosen (`js/who-to-start.js` extracted from analysis-page, Analysis output byte-identical).
- **2026-10-10, MAIN MENU live (`docs/main-menu-plan.md`, BUILT section):** `leagues.html` reached by the brand; `js/leagues.js` keeps `ff.leagues` and parks `ff.prefs` + `ff-draft-review-v1` per league-season on a switch (a switch is a navigation); earlier seasons 2019+ open read-only (no sync, capture, Value lines). **Phase 2 — accounts for anyone — BUILT, rules deployed 2026-10-10:** owner stays on `leagues/…` (never move it), any other Google account gets `users/{uid}/leagues/…` + list at `users/{uid}/menu/leagues`. NOT verified with any real sign-in (Tim's own sync after the rules change; a second account) — rollback command in the plan. Also 2026-10-10: Players box columns aligned with the list, Draft Avg column, name hover preview on Players (chat.md).
- **Cross-page ideas put to Tim 2026-10-09, NOT built, not authorized** ("don't build them yet"): drop candidate in a free agent's row · best pickup line on Home · draft cost in Roster detail · roster Value on Stats · Who to start before/after in Custom trades · partner's schedule luck in trades · opponent lineup on Schedule · bench points on Summary. Claude's picks: drop candidate, trade before/after, roster Value.
- **Tim, 2026-10-08:** "if you ever have a recommended option for something, just go with it, you don't need to ask me if you recommend it." Still waiting on his picks: the 17 chart-content suggestions in chat.md 2026-10-08; parked view switches 6–10 in the charts plan.
- **Trade audit** (`docs/trade-audit-plan.md`; BUILT sections hold detail + commits). Phase 1 (correctness) live 10-14. Phase 2 (goal guard on order + gate, finder + Suggested + Notifications) and Phase 3 (`js/accept.js` yes-chance, words likely/maybe/unlikely + why) live 10-15. **Phase 4 live 10-15 (20c51a7):** forced cut = free cut first, Value breaks ties (e8af732); K/DST floor = 3rd-best FA by ROS ÷ games left (7f37424; K 10.85→10.09, kicker slots floored 87%→66% on 1241838; moves every floored page); 💎/🪙 gap max(2, 6.7/√games) + injury-shortened games dropped (marked 43%→21%) + Trade chances whole % (3255389); phone cards CSS-only in trade.html (2a7255f, laptop pixel-identical). Goal cell carries `data-gain` (1649e39).
- **2026-10-14/15 from other chats (live, commits in chat.md "2026-10-14/15 — other chats"):** Bench value switch, He gains netted, half-up rounding, hover-only slot preview, suggestion bars (no undo / Total ≥ −5 / Value gap ≤ 5), Players Show my players + 💎/🪙 filter, off-roster weeks from `kona_player_info`; 10-15: send now/after week N, send-later notes, assumed trade carries to every forward page (076ffb0).
- **Not built:** Phase 5a, rest of 5b, Phase 6 (old trade-rework plan, Claude recommends skipping). Proj changes phase 4 leftovers (Preseason reference).

## Open for Tim (his to decide; full list with detail: `docs/archive/progress-2026-10-15.md` "Open for Tim")
- Claude's wording/reading choices from 2026-10-06 → 10-12 (Value labels, Decisions/Stats/Home small behaviours, "You are" unset shows the first team). None raised again unless he asks.
- Trade audit question g (does ESPN still show a Trade Grade; does the finder run on the synced phone copy). Phone: first trade card still ~2.6 screens down (Not-connected bar 267px + Data source 696px above it) — moving controls is his layout call. Schedule/Decisions still print sim chances to the tenth (`schedule-page.js` 1375/3041/3150, `decisions-page.js` 1710) — whole % there only if he wants it. Card look (Schedule-card frame, column-head strip, green outline on open trade) and Phase 4 wording ("projected well above / below his average", "cut short by injury", the cut-rule note) are Claude's.
- Not built, need his go: per-player current-week lock (reverses D12), availability/injury-risk discount.
- Held ideas (ranked): D/ST streaming by sportsbook line (ESPN public scoreboard carries DraftKings lines, no key); laptop-free weekly save; Trade finder on the phone; real game clock; playoff weeks 15–17 (by mid-December); league-wide best/worst moves; group-chat award lines; combining hypotheticals; projection trust by horizon; draft report card.
- Archive export: committed as "Weekly readings only" (`data/snapshots/476225250-2026.json`); strip a new export the same way (folder README).

## Authorized next steps
- **Nothing open is authorized (2026-10-15 evening).** Done: Phases 2 + 3 (10-15, "okay let's follow your recommendation" / "go"), Phase 4 + phone cards (10-15: d "Rest of season (Recommended)", e "Free cut first, Value breaks ties", f "whatever you reccommend"). Small leftover inside the Phase 3 go: `findSuggestions` still feeds the reach-weighted (not flat) He-gains into the yes-chance.
- Not authorized: 5a, the rest of 5b (speed, row-tap back control, one goal toggle), Phase 6.
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
- **CI `tests` red on main since f840c3c (2026-10-14 23:35)** through 2fad7a5: tr-test `liveOtherTeam`, test-trade-progress, test-notify-trades (several thrown at `js/trade-page.js` ~5124, the past-trades read `loadPastTrades` → `season.fetchDecisionWorld` throwing at once under the stub), test-store `goesOut` (re-read wants [5,6,7], got [5,6]), tr-value-check. Uncommitted edits from other sessions can sit in the main checkout (10-15 evening: `js/season.js`, `tests/test-assumed-trade.mjs`) — never stage them. Site still deploys via `deploy-now`. A second push within minutes CANCELS the first `tests` run, and the live-check hook then reports "deploy FAILED (tests: cancelled)" — expected; confirm by fetching a changed file from the live site.
- **Other chats work on this repo at the same time** (2026-10-15: two locked worktrees on the custom trade box — Send now/after week N with `js/send-after.js`, and send-later notifications in `js/notify*.js`). Check `git worktree list` for `locked` entries and their `git -C <wt> diff --stat` before giving builders files.
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
Full text of D1–D16 and every 2026-09-27 → 2026-10-07 decision: `docs/archive/progress-2026-10-15.md` "Decisions". The ones code still leans on:
- ~~D3 · 2026-09-21 · P(yes) = logistic(((his lineup Δ/wk + ESPN-look Δ/wk)/2 + 3)/1.5)~~ superseded 2026-10-15 by `js/accept.js` (constants are judgements, unvalidated; Phase 5 records outcomes).
- 2026-10-15 · Yes-chance words: likely ≥ 60%, unlikely < 35%; wording ("yes: likely", "Yes: unlikely — why", "In all") is Claude's, Tim's to change. The why line makes his half of the custom box 1–2 lines taller (halves no longer align on desktop) — his visual call.
- D4 · 2026-09-21 · Title goal prices playoff weeks in `weeklySpan()`; "last" goal = regular season only.
- D9 · 2026-09-18 · Floor applied at assessment, never selection; one wire read flat for every week.
- D10 · pre-2026-09-18 · Private league via `extension/` bridge; phone reads a Firestore sync (`fantasy-football-th`).
- D11 · 2026-09-23 · `TIE_BAND = 0.4` pp, measured on the demo league; grouped against the leader.
- D12 · 2026-09-23 · A week that has KICKED OFF is out of a trade's span (`state.startedWeeks`).
- D13 · 2026-09-24 · Child scenarios return through `tests/emit.mjs`.
- 2026-10-06 · Analysis Avg = mean of the regular-season numbers shown in the row; bye left out.
- 2026-10-06 · Trade search sliced on the main thread (generators), not a worker.
- 2026-10-09 · Trade lists ordered by net increase (supersedes D1's sim × P(yes) order); 2026-10-15 Phase 2 adds the goal-chance guard on top.
- 2026-10-15 · Forced cut = least points lost first, Value (as printed) only between equally cheap cuts, then season total, then roster order (Tim: "Free cut first, Value breaks ties"; supersedes 10-12's Value first).
- 2026-10-15 · Floor (rule 13) ranks the wire by ROS projection ÷ games left, still one read flat (Tim: "Rest of season"). Value keeps its own frozen waiver line (two lines on the site, known).
- 2026-10-15 · Goal guard judges the UNROUNDED change: a row printed "0%" (e.g. −0.63 pp) can sit below a smaller net. Trade chances print whole %, change = round(after) − round(before).
- 2026-10-12 · +1 a week floor on finder rows; Appeal = Σ(proj−avg) got − sent; Total = Appeal + both gains (Tim kept it 2026-10-14).

## NOT verified
- **2026-10-09 Value work: headless only** (WebKit 393 + 1440, league 1241838, demo). Not seen: Tim's iPhone, private league, the first real sync carrying `valueBase` to the phone, a week in play (the "already played counts at pregame" rule is reasoned, untested). On the synced copy with no synced byes, averages count the bye week. A cleared laptop browser makes its own lines until its next sync adopts the cloud's. Trade `twoGoals` scenario stalled twice at "playing each offer out (6 of 40)" under machine load, 54 clean repeats after; cause not caught. Full `tr-test` not run clean locally on the final merge (CI is the arbiter).
- **2026-10-14/15 other chats' Trade/Players work:** not checked by this chat at all; CI red (Traps).
- **Phase 4 (2026-10-15):** headless only (phone cards WebKit 393 + 1440 on demo; floor/marks measured on 1241838). Not seen: Tim's iPhone, private league. Free-cut "561 → ~0 costly cuts" is reasoned, not re-measured. Injury-shortened game = under half his usual AND ESPN projected 0 next game; Lamb's 1.9 stays (no honest signal). `wv-marks-check` flaked 12/62 under machine load on old and new code alike.
- **2026-10-06 and 2026-10-08 work: headless only** (WebKit 393 + 1440, league 1241838) — never on Tim's iPhone, private league, a week in play, real mouse hover. Item-by-item gaps (combo Difference cards, backup clicks, Trade slicing mid-search, Home phone copy): `docs/archive/progress-2026-10-15.md` "NOT verified".
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
- ~~2-for-1 fills the freed spot from the wire~~ · 2026-10-15 · built (branch `worktree-agent-a6f6a7c9045a36c11`, 5c81f32), not merged: the floor already prices an open slot at the 3rd-best, so the pick changes 0; "best" FA adds +10.9 median (always the same Ravens D/ST) and flatters.
- ~~`run-all --jobs` by default~~ · 2026-10-06 · 32 → 27 min only, and timing suites flake.

## Map
- Pages: index, stats, analysis, schedule, waivers (Players), trade, decisions, summary, draft (parked), debug.
- Trade: `js/trade.js` (engine, pure), `js/trade-odds.js` (goal + `TIE_BAND`, pure), `js/trade-page.js` (~11,800 lines, wiring), `js/ask-ai.js`, `js/accept-by.js`.
- Shared: `js/espn.js`, `js/season.js` (fetch; bridge → cloud → ESPN; store in front), `js/forecast.js` (optimalLineup, simulateSeason incl. `forced`), `js/capture.js`, `js/projection.js`, `js/floor.js`, `js/heat.js`, `js/store.js`, `js/cloud.js`, `js/connection.js` (bar + saved chip), `js/player-card.js`, `js/sortable.js`, `js/touch-titles.js`, `js/prefs.js`, `js/proj-trend.js`, `js/injury.js`, `js/proj-history.js`, `js/snapshots.js`, `js/backup.js`, `js/lineup-slots.js`, shared tables `js/standings-table.js` / `js/summary-table.js` / `js/actual-season-table.js` / `js/view-switch.js`, new 2026-10-06: `js/start-sit.js`, `js/must-win.js`, `js/waiver-gain.js`. Demo data `js/demo.js` + `js/demo-rosters.js`.
- Tests: `cd tests; node <suite>.mjs` singly; `node run-all.mjs [--bless] [--jobs=N]` — 72 suites, counts in `tests/counts.json` (a FALL fails the run). Last full run 2026-10-06 (68/70; per-suite counts of that day in `docs/archive/progress-2026-10-15b.md` Map). 2026-10-15 evening, alone on main: tr-test 1288/0 (~20 min under load), test-trade-cut 3254, test-floor-ros 26, test-floor 113, test-outlook-mark 92, test-list-order 129, test-accept 35, test-cloud-wiring 356 (ran on the working tree incl. another session's uncommitted `js/season.js`). A test that snapshots Schedule's forecast table must wait out the "…" cells; one that reads Trade must wait for `data-ranked`. Not suites: `node tools/measure-layout.mjs` (needs Edge).
- Hosting: Pages Source = GitHub Actions. `.github/workflows/test.yml` (five shards) then a gated `deploy`; `deploy-now.yml` publishes `main` at once (use it after every site push, see Standing instructions). Check with `gh run list -R TimothyHadfield/fantasy-football -w tests` and curl of a changed file.
- Project path: `C:\Users\timha\OneDrive\Desktop\my-website\Code Projects\Fantasy Football`. Tim's league 476225250 (private, 10 teams, 14 regular weeks, 6-team playoffs weeks 15–17). Public test league 1241838.
