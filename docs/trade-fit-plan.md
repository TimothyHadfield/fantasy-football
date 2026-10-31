# Trade finder by Tim's own checklist — plan

> **Tim asked (2026-10-31):** "I'm not supper happy with the suggested trades. I know we've worked with them a lot but I feel like I still have to do a lot before I feel comfortable sending a trade out, and I think we can do better. I'm gonna talk to you about my process in finding a trade and when I choose to actually send one out.
>
> the first consideration is of course is it going to benifite me. This is looking at my change in future proj as well as change in value. I try to get a trade that has positive change in future proj by about +2 or more, and a equal or positive change in value. The rest of the consideration is all about trying to find something that is appealing to the opposite user. I won't send a trade out if I think they don't actually have a change of accepting. When finding players that I want, It's usually in the position that I need it in the most (pretty much just what you tell me I have/am misisng). Now, It's important to know that the coin and diamond affect my decision a lot because I want to buy low and not high. Also this week's proj affects my decision because of a similar aspect of buying low. When finding players to send, I try to find players that have a coin on my side (or close to a coin) and players that my opponent needs. Overall, My value change should be 0 or positive, my change in future proj should be +2-4, and my opponents change in this week's proj should be positive. I sometimes try to find specific bench players with high value (2-4) and buy them for low, even if my change in future proj is slightly negative (-0-1) so that I can have a positive change in value (+2-4), which I can use to trade with other players (Robert has a QB, Jonas needs a QB, I buy roberts QB for cheap to trade with Jonas. If no one needs a QB, then I won't buy it). I also try to ballence my trades and make them relatively sparce so that I don't annoy people with too many trades or anything that's repetitive. Just thing about that for now and make a plan. I think I'm also gonna make some custom trades I like and have you look over them before we rebuild."
> **Instruction:** plan only. Tim will make custom trades he likes for review before the rebuild.

**Status:** NOTHING IS BUILT · Read first: The answer, Tim's checklist, Phases.

## Decided by Tim
- 2026-10-31 · His process is the spec: the numbers below are his, not Claude's.

## The answer (one sentence)
Turn the finder from "best by our model" into "deals that pass **Tim's own checklist**": gates for his side (future proj +2 to +4 a week, Value ≥ 0), added on top of every existing gate, an order by how appealing it looks to the other manager (his this-week gain, buying 💎 / sending 🪙, filling his need), a ✓ checklist on every row, a cap per manager, and a separate "Flip" mode for cheap high-Value buys that another manager needs.

## Tim's checklist (the spec, turned into rules)
| # | His words | Rule | Data that already exists |
|---|---|---|---|
| 1 | "positive change in future proj by about +2 or more" / "+2-4" | Your future proj change ≥ +2.0/wk; +2 to +4 is the sweet spot | printed You gain /wk (`weekGainShown`, `netGainOf` js/trade-page.js:6361) |
| 2 | "equal or positive change in value" | Value change ≥ 0 | `customValueChange` (trade-page.js:2034): Value in − out − forced cut |
| 3 | "my opponents change in this week's proj should be positive" | His This week > 0 | `thisWeekOf` (trade-page.js:6395) |
| 4 | "players that I want … in the position that I need it in the most" | A man you get fills one of YOUR Needs | `js/slot-needs.js` Needs/Has (custom box only today) |
| 5 | "players … my opponent needs" | A man you send fills one of HIS Needs | same |
| 6 | "coin and diamond … buy low and not high" | Order only: you get 💎 (or near), you send 🪙 (or near). Not a hard bar. "Near" = proj − avg within 1.0 of the ±2 mark, for ordering only; the ±2 marks themselves never change (Rejected 10-19) | `outlookMarkOf` (trade-page.js:2589); Appeal = Σ(proj−avg) in − out (js/outlook-mark.js:73) |
| 7 | "this week's proj … buying low" | Same idea as rule 3 (buying a man with a bad week is what makes his This week positive), so it is **merged into rule 3**, not counted twice | — |
| 8 | "relatively sparce … not repetitive" | ≤ 2 suggestions per manager; nothing like an offer YOU sent recently (the site's own sent-offer store; no real ESPN declined record has ever been seen) | sent offers `ff.trades.sent.*`, past trades (js/trade-history.js, js/past-trades.js) |
| 9 | Flip: "bench players with high value (2-4) … buy them for low, even if my change in future proj is slightly negative (-0-1) … If no one needs a QB, then I won't buy it" | Flip mode: a man on the SELLER's bench whose own Value is 2–4; your Value change +2 to +4; You gain −1 to 0/wk; and a manager OTHER than the seller Needs that position (named on the row) | Value, Needs/Has, slot on roster |

**This week missing:** `thisWeekOf` is null for some deal shapes and 0 once the week can't change (his league has a 1-day review, so from about Saturday). Then rule 3 is "not judged" (shown as —), never ✗.

**Every existing gate stays** and the new ones sit on top: Total ≥ −5, |Value change| ≤ 5 ("+5 up he wouldn't take"), no buy-back (past trades), the goal guard (rule 18's guard), no K / D/ST / Value < 1 (rule 21). The +1/wk floor is superseded by rule 1's +2.

**"Suggested trades" reading:** taken as BOTH the finder table and the custom box's Suggested completions; both get the same gates and order.

## Blockers / deciding constraint
- **His real trades are the test.** Claude cannot read his league (476225250) or his browser's saved custom trades. Phase 0 needs him to save his liked custom trades and send screenshots (or the names: who, gives, gets).
- The rules use numbers already on screen, so there is **no new formula**: only gates, an order and a cap.

## What exists today (summary; full map with refs from a read of the code, 2026-10-31)
- **Candidates** (js/trade.js): every partner, each side's top 18 by ROS projection, 1-for-1 to 2-for-2 (2-for-2 among top 10), K/DST/Value<1/out-for-season barred (`notToSuggest` trade-page.js:2351).
- **Gates:** You ≥ +1/wk (`MIN_MY_PER_WEEK`), his ≥ −2/wk, Total ≥ −5, |Value change| ≤ 5, past-trade bar, goal guard (chance may not drop > 0.4 pt).
- **Order:** engine keeps 160 by goal points × yes-chance; the page sorts by **net increase** (You + He) with the goal guard; shows 40.
- **Not used in the order at all:** Value change, This week, 💎/🪙 (only via the loose Total ≥ −5 bar), Needs/Has. **No per-manager cap, no memory of what was sent.**
- So the list optimises a number Tim does not use, and every one of his checks is left for him to do by eye. That is the "I still have to do a lot".

## Options
| Option | What it is | Cost | How it fails |
|---|---|---|---|
| A | **Checklist finder:** keep the engine's candidates; ADD rules 1–2 on top of every existing gate, order by appeal (rules 3–6), cap per manager (8), ✓ checklist per row; Flip as a switch (9) | Medium: page-side gates + order + one column; engine candidate cap may need widening | Too few deals pass all gates on a thin week → show the near-misses below a line with the failed check named |
| B | One blended "Fit" score with weights | Medium | Opaque; Tim can't see why a deal ranks; weights are guesses (the yes-chance already has this problem) |
| C | Keep today's order, add the checks as filter switches | Small | He still sorts and judges by eye; doesn't fix the complaint |

## Recommendation (ranked)
1. If only one thing is built, build **A without Flip**: his gates, appeal order, ✓ checklist column, per-manager cap. It removes the by-eye work directly.
2. Then **Flip mode** (rule 9), as its own switch in the finder box, each row naming the manager who needs that position.
3. Then the **"not repetitive" memory** (rule 8, second half) using the sent-offers store.

### Order inside A (deals that pass every gate)
Goal guard on top (as today). Then: count of appeal checks passed (3, 4, 5, 6-get, 6-send), then his This week, then You gain (any value in +2–4 counts the same; above +4 ranks after), then a strict key (player ids) so ties are a display grouping only (rule 19). **This replaces rule 18's "ordered by net increase" if Tim answers (a) yes.** The checklist (✓ / ✗ / — per check) opens as a hover card / tap sheet on the row, not a new column (phone width; layout is Tim's call). The yes-chance word stays in the card only.

## Deliberately NOT planned
- ~~A new acceptance model~~ · his checklist IS his acceptance model; the old one's constants are guesses (js/accept.js header).
- ~~Fitting weights from outcomes~~ · too few real offers to fit anything this season.
- ~~Three-team flips in one offer~~ · ESPN blocks three-team trades (Rejected list).
- ~~Bringing back Best combo~~ · Tim removed it 2026-10-18.

## How this could be wrong
- "+2 future proj" may mean the PLAIN lineup change, not the netted You gain (which subtracts his gain in weeks you play him) → check against his custom trades in Phase 0.
- 🪙/💎 compare projection with ESPN's season average; "near a coin" needs a number → proposed: proj − avg ≤ −1.0 counts as near.
- The candidate cap (top 18 by projection) may drop the bench men Flip wants → Phase 2 widens the cap for Flip only; measure time per search.
- Needs/Has decides rules 4–5; if it calls a deep position a need, the order goes wrong → spot-check on 1241838.

## Phases (each ships on its own)
0. **Review Tim's liked custom trades** (no code): score each against the checklist, show which rule each passes/fails, settle "+2 = printed You gain or plain lineup change" and the open thresholds. Also **measure** on 1241838 how many of the engine's 160 kept deals pass You ≥ +2 and Value ≥ 0; if almost none, widen the engine's pool before Phase 1. Done when every one of his trades is explained by the rules or a rule is changed.
1. **Checklist finder** (A): a pure checklist function (new module) + gates 1–2, appeal order, ≤ 2 per manager, near-misses under a line, checklist hover card. Done when: a suite seen failing first proves gates/order/cap on the trade stub (new stub knob for a deal set with varied Value/This week/marks); each of Tim's Phase-0 trades passes the pure checklist function and fits the engine's shape (1-for-1 … 2-for-2, top 18); 393 px + laptop screenshots. Expected test fallout, fixed in the same push: tr-test (base stub's 3 rows all +10), test-list-order, tr-yes-check, test-notify-trades, counts.json.
2. **Flip mode:** switch in the finder box; rows show "Flip to <manager> (needs QB)". Done when a stub with a QB-needy third team produces the row, and the same stub with only the seller needing a QB produces none.
3. **Not repetitive:** hide deals sharing a man each way with an offer you sent in the last 7 days (site's sent-offer store); show "sent Oct 26" instead. Done when the stub's sent offer suppresses its near-copy.

## Questions for Tim
a. Order the finder by your checklist (✓ marks) instead of today's net increase × yes-chance? · recommended: **yes** — it is your own process.
b. Above +4 a week for you: still show, but lower (looks lopsided to him)? · recommended: **yes, lower**, not hidden.
c. Flip mode as its own switch, only when another manager needs that position? · recommended: **yes**.
d. "Sparse" = at most 2 suggestions per manager on screen (not hiding managers you already sent an offer to)? · recommended: **yes, 2 per manager**; Phase 3 hides only near-copies of a sent offer.
e. "+2 future proj" = the printed You gain (which subtracts his gain in weeks you play him)? · recommended: **yes**, settle in Phase 0 against your trades.

## Review 2026-10-31 (plan-reviewer)
Fixed: existing gates kept and listed; Flip remapped (man's own Value 2–4 on seller's bench, buyer ≠ seller); rule 18 replacement tied to (a) + strict tiebreak (rule 19); rule 7 merged into 3; "closest to +3" dropped; missing This week = not judged; 💎/🪙 order-only and ±2 marks untouched; Phase 1 test = pure checklist function, not stub rank; measurement step added; both "Suggested" readings stated; test fallout named; checklist as hover card; Phase 3 limited to the site's sent store.

## Sources
- Code read 2026-10-31 (js/trade.js, js/trade-page.js, js/accept.js, js/outlook-mark.js, js/slot-needs.js, js/past-trades.js).
