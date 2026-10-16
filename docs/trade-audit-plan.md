# Trade page audit and improvement — plan

> **Tim asked (2026-10-14):** "I really want you to start working and improving the trade section. As you can see I've spend a lot of my recent effort thinking about it and trying to improve it becasue I think it's such a big part of how to improve your team or make them better. Think of all the strategies of trading and what different factors make a trade seem better or worse to a user that isn't calculating every future week but just seeing the information given in the regular ESPN app. Additionally really go in depth to analyze what we might doing wrong or any current settings or calculations that are innacurate in any way or anything like that. Make plans to improve any problems that are currently there or any opportunities that we aren't implementing yet. Really consider everything possible. Report back to me when you're done with the analysis. Don't build anything yet"
> **Instruction:** don't build yet.

**Status:** NOTHING IS BUILT · Read first: The answer, Findings, Phases, Questions for Tim.

## Decided by Tim
- 2026-10-14 · (a) List order: "Yes, add that guard" — keep You + He gains, never a goal-lowering deal above a goal-raising one; +1 gate also needs chance not to fall.
- 2026-10-14 · (b) Yes-chance: "Rebuild, show words" — likely / maybe / unlikely + one-line why.
- 2026-10-14 · (c) Total: "Keep as I set it" (Appeal + both gains).
- 2026-10-14 · Phase 1: "Build Phase 1 now". Phases 2–5 not yet authorized to build.
- Earlier rulings this plan must respect: list order = net increase (2026-10-09), +1 a week floor (2026-10-12), Value-first forced cut (2026-10-12), Appeal = Σ(proj−avg) got − sent and Total = Appeal + both gains (2026-10-12), "complement ESPN, don't replace it".

## The answer (one sentence)
The pricing engine is sound, but the page ranks trades by a figure that can put a deal that LOWERS your title chance first, its "chance he accepts" is far too generous and blind to what the other manager sees on ESPN, ESPN's own out-for-season flag is ignored (so men coming back are wrongly barred), several numbers disagree between the row and the custom box, and on a phone the answer is ~3 screens down behind a 45-second load.

## Blockers / deciding constraint
- List order, how harsh the yes-chance is, what Total means and injury-risk constants are Tim's calls (product/wording). Everything in Phase 1 is technical and needs only his go.
- Money $0: every data source below is free (ESPN public API; FantasyCalc free, no key).

## How this was done (2026-10-14)
Five read-only audits in parallel: pricing engine (node scripts on the real modules, live league 1241838 weeks 6–17), ranking + yes-chance (synthetic 10-team league, 100,000-season sims, 12 seeds), data inputs (ESPN public API, all weeks, `kona_playercard`), trade strategy vs the ESPN app (web research), page walk-through (WebKit headless 393 + 1440, timed). Scratch evidence: session scratchpad `audit-engine/`, `audit-rank/`, `audit-inputs/`, `audit-ux/`. Tim's private league was not read.

## Findings (most severe first)

### A. Wrong or misleading numbers
1. **The list order can put a bad trade first.** · *measured* · Order is `byNetIncrease` = You gain + He gains (`js/trade-page.js` `netIncreaseOf` ~5350, `byNetIncrease` ~5428). Synthetic league: "you +1.5, your top rival +8" ranked 1st with **−1.16 pp** title chance; "you +4, a contender −1" ranked last with **+6.24 pp**. On 1241838 your best deal is not row 1 for 3 of 10 teams. The meeting-week netting Tim asked for (2026-09-30) cancels out of this sum. The sim (40 × 10,000 seasons) now only breaks ties. The page's notes still say rivals' gains cost you — no longer true of the order.
2. **"Chance he accepts" is too generous and never checked.** · *documented + reasoned* · `js/trade-odds.js` ~142–232: even deal → 88%, losing 3/wk → 50%. (Old data, 2026-09-23 review: a list where 35 of 40 partners lose points had a median of 91%.) The rebuild was parked then as "a guess wearing a number"; what is new: Tim's real Allen deal, the research on what the ESPN app shows, and ESPN injury fields. Tim's Allen + Charbonnet deal read 73% while the partner loses 2/wk and gets an RB tagged Out. Real managers refuse most offers.
3. **The yes-chance's "ESPN look" is not what ESPN shows him.** · *reasoned + researched* · It sums rest-of-season projections (`espnLookPerWeek` ~5539). The ESPN app puts season points, AVG, LAST, this week's PROJ, positional rank, %ROST and its +/−, and the injury tag in front of him. None of those (nor his standings, his positional needs, endowment) enter it.
4. **Out-for-season rule bars men ESPN expects back.** · *measured* · ESPN projects most IR men 0 for every remaining week, even with a return date. My 2026-10-12 rule (`outForSeason`, `js/trade-page.js` ~2215) therefore bars Tank Dell (back wk 6), Coleman (7), Ferguson (8), Pittman (10), McMillan (11), Stribling (11) on 1241838. ESPN DOES publish `injuryDetails.outForSeason` + `expectedReturnDate` (view `kona_playercard`, `filterIds`); 41 league-wide players are flagged true (e.g. De'Von Achane). The code comment "ESPN has no field" is wrong.
5. **Row vs custom box vs pop-ups disagree.** · *measured* · Same deal: his side −1.0/wk −10.8 in the row, −1.1/wk −13.7 in the box, −10.7 in the box's own week table; your side +4.0/+47.5 vs week table +3.6/+43.8; Total −0.6 vs −0.7. One deal shows a forced drop (Travis Hunter, −2.0/wk) only in the box. Cause: row reach-weights his playoff weeks and nets the meeting week; box uses flat figures. Breaks the standing rule "a printed difference equals its two printed ends subtracted". The row's netted figure is Tim's (2026-09-30) and feeds the +1 gate and the order, so the fix makes the box and pop-ups match the ROW (and label the netted part), not the other way round.
6. **Drop list can name a man in an IR slot.** · *measured* · `afterTrade` (`js/trade.js` ~515) counts IR-slot men as roster spots: 25 of 154 offers move an IR-slot man; 7 of one team's top 25 say "drop Jonah Coleman" (IR slot — dropping him frees no active spot). An IR-eligible arrival is never put in an open IR slot.
7. **Kicker / D/ST floor from one week's waiver wire.** · *measured* · `js/floor.js` ~139 uses the week-6 wire for all weeks: K floor 10.9 vs 9.5–10.1 later; 87% of kicker slots floored, so any kicker trade prices ~0. The same read already carries each free agent's rest-of-season projection: 3rd-best by that gives K 10.1, D/ST 5.5. Value uses a different waiver line (mean of top 3, frozen) — two "waiver lines" on one site. `floor.js` is shared (rule 13, D9 "one wire read flat"), so this moves Players, Analysis and Decisions numbers too — Tim's call.
8. **Total adds unlike things.** · *reasoned* · Appeal is a sum over every man moved (bench men too) of per-game proj−avg; the gains are lineup points a week. Appeal is really a "looks better to him than it is" signal — a yes-chance input, not points.
9. **💎/🪙 and Appeal are mostly noise this early.** · *measured* · Week-to-week spread 6.7 pts ⇒ a 5-game average is ±3.2, above the 2-pt threshold for 82% of regular players. Injury-shortened games (e.g. Lamb 1.9 in week 5) drag averages; 13 men averaging 10+ have such a game.
10. **Chances printed to the tenth with ±0.5 pp noise.** · *measured* · 12 seeds × 10,000 seasons: title change spread 0.47 pp. "22.8% → 27.3%" implies far more precision than exists.
11. **Status changes don't refresh future weeks for up to 6 h.** · *documented* · `store.signatureOf` (`js/store.js` ~225) compares player ids only. A man going Out shows the badge in 5 min while weeks 7–17 keep his old projection. ESPN's `lastNewsDate` is a free trigger.
12. **"Typical week" stand-in ~30% low mid-season.** · *measured* · `typicalWeek` (`js/trade.js` ~83) divides a rest-of-season total by 17 (prints 6.7 instead of ~9.5). Shows while weeks load and in the depth map.
13. **Lineup solver greedy.** · *measured* · `optimalLineup` (`js/forecast.js` ~193) is wrong for leagues with both RB/WR and WR/TE slots (14 vs best 15). Fine for 1241838; Tim's private league slots not checked.
14. **Current week locked as a whole.** · *reasoned* · `lockedWeeks` drops the week at the first kickoff (D12, 2026-09-23), and prices a whole week before kickoff even when the 1-day review means the received men lock first. A per-player lock (kickoff vs now + review hours, `accept-by.js` has both) would reverse D12 — Tim's call, low priority.
15. **Smaller:** "Avg 0.0" for a man with no games (should be "—", `js/espn.js` ~642); Jacobs shows "Day to day" while ESPN projects 0 for 5 weeks; Questionable = full projection, Doubtful = 0 (ESPN's own); two rounding rules (`Math.round` vs `toFixed`) can differ on a half; His gain playoff-weighted inside the yes-chance (a manager doesn't discount his own playoff weeks).

### B. What the model leaves out (strategy gaps)
16. **Bench depth and injury risk are worth exactly 0.** · *measured* · A non-starter adds nothing; an assumed per-position weekly miss rate takes 15–35% off printed gains of 2-for-1 / 2-for-2 deals and reorders some. Consolidation deals are flattered.
17. **A roster spot freed by a 2-for-1 is never filled** (`js/trade.js` ~497: "simply left short"). The partner receiving two men pays a cut, but the side sending two never picks up the best free agent.
18. **Value-first forced cut costs points** · *measured* · 561 of 3,001 one-for-two deals cut a man who costs points when a free cut existed; worst −0.37/wk (Diggs cut instead of idle Lloyd). Tim's 2026-10-12 rule; a fix keeps Value as the tiebreak among equally cheap cuts.
19. **No injured-star / return-date view.** ESPN's `expectedReturnDate` and injury `type` are now available (finding 4).
20. **No partner context:** his standings (contender vs out of it), his thin positions (depth map exists, unused in the yes-chance), manager tendencies.
21. **No recency signal** (last game vs proj, ESPN PR7) — the main thing casual managers react to.
22. **No crowd value check.** FantasyCalc publishes free redraft values built from real trades (`api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=10&ppr=1`) — the nearest thing to "what other managers think he's worth".
23. **No veto-risk flag** for deals that look lopsided on ESPN (default: 4 of 10 votes veto; Tim's league setting unknown).
24. **ESPN fields unused:** `percentChange` (rostered trend), `ratings` (Player Rater, positional rank), weekly outlook text, expert rank spread, `tradeLocked`, `positionAgainstOpponent`.

### C. The page itself
25. **Phone: no trade on the first screen.** · *measured* · Row 1 is at y≈1758 (2.7 screens). (An answer line above the table was rejected by Tim 2026-09-23: "No, leave the table as the answer" — so the fix is getting the TABLE higher and readable, not a new block.) The table is 1169 px wide in a 363 px box: only Manager + Chance show; the yes % is cut off.
26. **Load: 43–57 s to a ranked list**, with a false "No roster data for this week", and a rough list that appears at 5.9 s then vanishes at 7.5 s. "Both teams gain" toggle 21 s; Assume 34 s.
27. **"You are" change does nothing on Trade while live** · *measured* · `js/trade-page.js` ~11534.
28. **Row tap jumps ~2,660 px** to the top of Custom trades (Value measurement), deal numbers at the bottom edge, no way back.
29. **Plus figures on red** in the custom week-by-week tables (the gain columns' "a plus is never red" rule not applied there).
30. **Deal pop-up**: a player card opened on top of it and its week table clipped at 393 px (headless; needs phone check).
31. **Clutter:** ~25 numbers per row; three summary columns (Value, Appeal, Total), none the sort key; "Last" chance under "Win it all"; goal toggle printed 3 times; "Manager" vs "With"; ~5,800 words of explanation on laptop. Older UX items still open: V9 column cut, V10 collapse Custom on phone, V11 shrink Data source, D13 sticky header.
32. **Making the trade on ESPN:** link fills only his players (say "also tick: Mahomes, Rice"); no message to send him; no "why he'd say no"; no counter help ("add X to bring him to ≥0"); no record of sent / countered / declined offers (`js/pending.js` already reads pending offers).
33. **Suggested** lists the deal you already built first; never appears for 2-for-2 and says nothing.

## What a casual ESPN manager weighs (research summary)
Season AVG and total points, last game (recency), name/draft position (anchoring), ESPN positional rank, %ROST and its change, injury tag (fear), whether it fills his hole (need), 2-for-1 "feels like more" but the best player usually wins, endowment (values what he owns up to ~2×), fear of being fleeced. ESPN once showed an IBM "Trade Grade"; whether the 2025/26 app still does is **not verified** — one look at a real incoming trade on Tim's phone settles it. No published acceptance-rate data exists. Sources below.

## Options for the big calls
| Call | Option | Cost | How it fails |
|---|---|---|---|
| List order | **A. Keep net increase, but a deal that lowers your goal chance never sits above one that raises it** (and the +1/wk gate also needs chance ≥ 0) | small | still rewards making a partner stronger where it doesn't hurt you |
| | B. Rank by your goal-chance change × yes-chance (the 2026-09-21 rule) | small | noisy (±0.5 pp) at 10,000 seasons unless top rows get more |
| | C. Rank by your netted gain, his gain as tiebreak | small | ignores whether he'd accept |
| Yes-chance | **A. Rebuild on what ESPN shows him (AVG, last, rank, tag), his lineup need, his standings, an ownership discount; lower base (even deal ≈ 50%); show words (likely / maybe / unlikely) with a "why" line** | medium | still unvalidated; mitigated by recording outcomes (Phase 5) |
| | B. Just lower the base level | trivial | blind to injury tags and name value |
| Total / Appeal (no recommendation: Tim set Total 2026-10-12) | A. Appeal feeds the yes-chance; Total = your gain + his gain | small | undoes a 2-day-old ruling |
| | B. Keep as Tim set it | none | Total keeps mixing a sum of per-man gaps with lineup points |
| Injury risk | **B. ESPN's out-for-season flag and return dates only** (Phase 1) | small | bench depth still worth 0 |
| | A. Per-position weekly miss rates priced in expectation | medium | the rates are ours, not ESPN's — the 2026-09-20 rejection still applies (return dates are not miss rates); only with Tim's explicit go |

## Recommendation (ranked)
1. If only one thing is built, build **Phase 1** (correctness: findings 4, 5, 6, 11, 12, 15, 27, 29 and the notes) — wrong today, no product decision.
2. Then **Phase 2, list order option A**, because a trade that lowers your title chance at the top of the list is the most damaging thing on the page. Re-measure finding 1 on 1241838 first.
3. Then **Phase 3, the yes-chance rebuild (option A)** — it is the number Tim reads to decide whether to send.
4. Then Phase 4 (realism), 5a (making the trade) and 5b (layout, speed).

## Deliberately NOT planned
- ~~Usage-based buy-low/sell-high (target/snap share)~~ · no ESPN field; nflverse CSVs are a research project (parked 2026-09-20, still true).
- ~~Three-team trades~~ · ESPN blocks them.
- ~~Rewriting the season sim or moving to a worker in Phase 1~~ · speed is Phase 5; the sim is correct.
- ~~Discounting Questionable players~~ · ESPN gives no play chance; would reopen the rejected idea without new evidence. (Return dates and out-for-season ARE new evidence — used in Phase 1.)
- ~~A one-line answer block above the table~~ · Tim 2026-09-23: "No, leave the table as the answer" (`docs/trade-rework-plan.md`).
- ~~FantasyCalc crowd values~~ (parked, last) · not what his partners see on ESPN; scoring may differ; CORS unverified.
- ~~Lineup-solver fallback~~ unless Tim's league slots turn out not to nest (check his slot list first; 1241838 nests).

## How this could be wrong
- The synthetic league overstates finding 1 → re-measure on 1241838: count rows whose chance change < 0 above rows > 0.
- The yes-chance level may be right for Tim's league (casual managers who accept a lot) → recording real outcomes (Phase 5) settles it; one data point: did Nolan accept the Allen deal?
- Availability rates are assumptions → measure them from this season's played weeks (starters projected > 0 who scored 0).
- ESPN's `kona_playercard` view may need one request per 100 players → measured 1 request for 1241838.

## Phases (each ships on its own)
1. **Correctness, no product change.**
   - ESPN out-for-season + return dates: one `kona_playercard` read (filterIds, injured men only, ≤100 per request) in `js/espn.js`, through the bridge for the private league, and **carried in the cloud payload** so the phone's synced copy makes zero ESPN requests (rule 20; `test-cloud-wiring` assertion). `outForSeason` uses ESPN's flag; returners are not barred and stay priced as ESPN projects them.
   - Custom box, `#cuTop` and pop-ups show the ROW's figures (netted part labelled), so the same deal reads the same everywhere. The row figure, +1 gate and order are unchanged.
   - IR-slot men left out of the roster count and never named as the drop; an IR-eligible arrival may take an open IR slot.
   - Future weeks re-read when a man's status moves into the out class, capped at one re-read an hour, never on the synced copy (rule 15 otherwise unchanged).
   - `typicalWeek` ÷ games left; "Avg —" for no games; one rounding rule (round first, then sign); plus never red in custom week tables; "You are" change re-searches while live; ranking notes say what the order really is.
   - Done when: each fix has a test seen failing on today's code; 393 + 1440 screenshots of one row and its custom box with identical figures.
2. **List order** (Tim's choice, question a): a deal whose goal change is below −`TIE_BAND` never sits above one at or above it (a function of the row alone, so rule 19 holds); the +1 gate also needs goal change > −`TIE_BAND`. Before building, re-measure finding 1 on 1241838 (how many rows today have Δchance < −0.4 above rows > +0.4). Done when: that count is 0 on 1241838 and the demo, a test pins it, and `test-notify-trades` (notifications store the page's order) is updated.
3. **Yes-chance rebuild** (question b): inputs = his lineup Δ/wk (flat), ESPN-look on AVG / LAST / positional rank, a penalty for an Out/IR man he receives, his standings, his positional holes, an ownership discount; words + a one-line "why". Done when (direction, not levels): a fixture built from the Allen + Charbonnet deal scores below an even deal; adding an Out man to his side lowers it; a deal that fills his empty position raises it.
4. **Realism**: fill the roster spot a 2-for-1 frees with the best free agent; 💎/🪙 threshold scales with games played and skips injury-shortened games; chances printed whole-percent or top rows at 50,000 seasons; only with Tim's go: floor by rest-of-season (question d), Value-only-breaks-ties cut (question e), per-player current-week lock (reverses D12), availability discount.
5a. **Making the trade** (ships alone): ESPN "also tick: Mahomes, Rice" line beside the link; counter help ("add X to bring him to ≥ 0"); a short message to send him; sent / countered / declined / accepted record — first confirm `js/pending.js`'s real data shape.
5b. **Layout and speed**: get the table higher and readable on a phone (Tim's visual call: cards vs the wide table); row tap scrolls to the deal with a back control; keep the rough list on screen with an honest "Loading…"; speed (worker or sliced sim); one goal toggle, hide Last under Win it all, one column name.

## Questions for Tim
a. List order: keep "You + He gains" but never put a trade that lowers your goal chance above one that raises it? · recommended: **yes**.
b. Rebuild "chance he accepts" around what he sees on ESPN, starting near 50% for an even deal, and show it as words (likely / maybe / unlikely) with a one-line why? · recommended: **yes**.
c. Total: keep it as Appeal + both gains (2026-10-12), or Total = your gain + his gain with Appeal feeding the yes-chance? · no recommendation (his ruling, 2 days old).
d. Kicker/D/ST floor: 3rd-best free agent by rest-of-season average instead of this week's wire (moves Players, Analysis, Decisions too)? · recommended: yes.
e. Forced cut: Diggs (Value 0.3) is cut instead of idle Lloyd, costing 0.37/wk — keep Value first, or Value only between equally cheap cuts? · no recommendation.
f. Phone: cards instead of the wide table? · his visual call.
g. Does ESPN's app still show a "Trade Grade" on a received offer, and does the Trade finder run on the phone's synced copy? · facts only he can check.

## BUILT 2026-10-14 (Phase 1)
- Shipped (4 builders, merged to main, live): 0d014d3 ESPN `kona_playercard` injuryDetails → `outForSeason` (barred on 1241838: 7 → 0; synced in the cloud payload; `extension/background.js` allows the view — Tim must reload the extension); 30d9ed6 `dealFigures` — box/`#cuTop`/cards quote the row (40/40 deals match, were 0/40); afde603 + 050fe36 IR-slot men never the drop or counted (39 → 0 offers), `typicalWeek` ÷ games left (−29% → −0.2% error), (trade.js's switch to `toFixed` rounding was reverted: it split Players Avg from the engine's perWeek by a tenth — wv-test §1.7 — so the engine keeps half-up, as Players does), page calls `setIrSlots`/`setSeasonClock` (`irSlots` now rides the schedule read); 5c42f47 "You are" re-searches while live, zero-based colours in custom/pop-up week tables, method notes cut to match the real order, `seasonAverageOf` null for no games, out-status re-read of open weeks (≤1/h, never on synced copy).
- Plan was wrong about: the row's forced-drop case was not an engine bug (box lacked reach-weighting only); ESPN stat 210 unusable for games left (17 for every D/ST).
- Verified: each fix's tests seen failing first (except the notes test); quick suites green on the merged tree (trade 1503, net 49, moves 57, out-for-season 18, cloud-wiring 356, store 171, season-rules 145, heat-draw 172, value-check 79, notify-trades 72); headless WebKit 1440 on 1241838: 40 rows ranked in ~60 s, no drop names Coleman.
- Still open: trade word count at its ceiling (429/429); `signedText` prints "0.0" for a rounded zero (rule says "0"); Analysis page still ÷17 for its season line; IR/Out allowed into an IR slot (Tim's league setting unchecked); demo-league one-off row +47.5 vs box week table +39.5 seen once on old code; private league through the extension not exercised.

## BUILT 2026-10-15 (Phases 2 and 3)
- Tim: "okay let's follow your recommendation" … "go" (Claude recommended 2 + 3, not 4–6).
- Phase 2: d396876 (finder: goal-lowering deals below the rest, +1 gate needs Δchance > −TIE_BAND, helpers in `js/trade-odds.js`, `tests/test-list-order.mjs`); 3d0469e (custom Suggested takes the same order, no +1 gate, at-least-3 kept; Notifications never store a goal-lowering deal — the Bench value switch let them through).
- Phase 3: 81234f9 (`js/accept.js`: lineup ×0.5, ESPN look AVG/LAST 25%/rank bonus ×0.5, Out −3 / Doubtful −1, empty hole +1.5 / thin +0.75, out of race −0.75 and half lineup weight, ownership 4%, logistic ÷2; likely ≥ 60%, unlikely < 35%; `tests/test-accept.mjs`); 0f6600e (words + why on screen, % and parts in the preview, flat lineup input, `tests/tr-yes-check.mjs`).
- Plan was wrong about: finding 1 does not show on 1241838 today (0 rows below −0.4 pp of 392 finder rows, 0 of 332 Suggested lists) — the goal-weighted candidate search already avoids them; the guard is insurance.
- Verified: fail-first tests per builder; merged-tree suites (see chat.md 2026-10-15); demo median yes 90% → 48%; screenshots 393 + 1440.
- Still open: `findSuggestions` yes input not flat; constants unvalidated (Phase 5 outcome recording); wording and the custom-box height change are Tim's.

## BUILT 2026-10-15 evening (Phase 4 + phone cards)
- Tim's answers: d "Rest of season (Recommended)"; e "Free cut first, Value breaks ties"; f "whatever you reccommend" → cards on phone, laptop table unchanged.
- e8af732 forced cut: least cost to the priced weeks, then Value as printed, then season total, then roster order; one-position guard + IR rule kept (`tests/test-trade-cut.mjs` §5, Diggs/Lloyd fixture).
- 7f37424 floor: wire ranked by ROS projection ÷ games left (byes out), still 3rd best, one read flat (`tests/test-floor-ros.mjs`). 1241838: K 10.85→10.09, D/ST 5.44→5.54, kicker slots floored 87%→66%.
- 3255389 💎/🪙 gap max(2, 6.7/√games) (6.7 = median weekly spread, 1241838 wks 1–5); a game under half his usual followed by an ESPN 0 projection is dropped from the average (Appeal too). Marked 43%→21%. Trade chances whole %, change = round(after) − round(before); TIE_BAND and sorts unrounded.
- 2a7255f phone cards: CSS-only (trade.html), laptop pixel-identical; first card y 1696→1694 (nothing above was prose to fold).
- 1649e39: Suggested-order "failure" was the test — under "Don't finish last" the guard correctly demoted rows that raise last-place chance; goal cell carries `data-gain`.
- Plan was wrong about: finding 17 (2-for-1 left short) — the floor already prices an open starting slot at the 3rd-best FA, so filling it changes 0; "best FA" would add +10.9 median (same Ravens D/ST for every deal) and flatter. Built (5c81f32), parked.
- Not built (need Tim's go): per-player current-week lock (reverses D12), availability discount. Chances still printed to tenths on Schedule/Decisions.
- Verified: fail-first per builder; tr-test 1288/0 on 1649e39; screenshots 393 + 1440 (cards); live files fetched.

## Sources
- ESPN trades: https://support.espn.com/hc/en-us/articles/360000959252-Proposing-and-Accepting-Trade-Offers · review/veto: https://support.espn.com/hc/en-us/articles/360000071412-Trade-Review · columns: https://support.espn.com/hc/en-us/articles/115003862972-Fantasy-Football-Acronyms · 2025 app: https://www.espn.com/fantasy/football/story/_/id/45844949/2025-fantasy-football-where-play-new-features-espn
- ESPN/IBM Trade Grades: https://newsroom.ibm.com/2024-09-10-ibm-brings-next-generation-of-ai-powered-insights-to-espn-fantasy-football-platform
- Psychology: https://www.espn.com/fantasy/football/story/_/id/49741684/fantasy-football-how-manage-team-pickups-trades · https://raiseyourgame.com/2016/11/01/taking-biases-out-of-fantasy-trades/ · https://www.fiso.co.uk/psychology-and-how-it-has-shaped-fantasy-football/
- 2-for-1 premium: https://fantasyfootballtradeanalyzer.net/redraft-trade-analyzer/ · trade fairness model: https://arxiv.org/abs/2511.17535
- FantasyCalc API: https://fantasycalc.com/api-docs
