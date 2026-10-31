# Trade finder by Tim's own checklist — plan

> **Tim asked (2026-10-31):** "I'm not supper happy with the suggested trades. I know we've worked with them a lot but I feel like I still have to do a lot before I feel comfortable sending a trade out, and I think we can do better. I'm gonna talk to you about my process in finding a trade and when I choose to actually send one out.
>
> the first consideration is of course is it going to benifite me. This is looking at my change in future proj as well as change in value. I try to get a trade that has positive change in future proj by about +2 or more, and a equal or positive change in value. The rest of the consideration is all about trying to find something that is appealing to the opposite user. I won't send a trade out if I think they don't actually have a change of accepting. When finding players that I want, It's usually in the position that I need it in the most (pretty much just what you tell me I have/am misisng). Now, It's important to know that the coin and diamond affect my decision a lot because I want to buy low and not high. Also this week's proj affects my decision because of a similar aspect of buying low. When finding players to send, I try to find players that have a coin on my side (or close to a coin) and players that my opponent needs. Overall, My value change should be 0 or positive, my change in future proj should be +2-4, and my opponents change in this week's proj should be positive. I sometimes try to find specific bench players with high value (2-4) and buy them for low, even if my change in future proj is slightly negative (-0-1) so that I can have a positive change in value (+2-4), which I can use to trade with other players (Robert has a QB, Jonas needs a QB, I buy roberts QB for cheap to trade with Jonas. If no one needs a QB, then I won't buy it). I also try to ballence my trades and make them relatively sparce so that I don't annoy people with too many trades or anything that's repetitive. Just thing about that for now and make a plan. I think I'm also gonna make some custom trades I like and have you look over them before we rebuild."
> **Instruction:** plan only. Tim will make custom trades he likes for review before the rebuild.

**Status:** NOTHING IS BUILT · Read first: The answer, Tim's checklist, Phases.

## Decided by Tim
- 2026-10-31 · His process is the spec: the numbers below are his, not Claude's.

## The answer (one sentence)
Turn the finder from "best by our model" into "deals that pass **Tim's own checklist**": gates for his side (future proj +2 to +4 a week, Value ≥ 0), an order by how appealing it looks to the other manager (his this-week gain, buying 💎 / sending 🪙, filling his need), a visible ✓ checklist on every row, a cap per manager, and a separate "Flip" mode for cheap high-Value buys that another manager needs.

## Tim's checklist (the spec, turned into rules)
| # | His words | Rule | Data that already exists |
|---|---|---|---|
| 1 | "positive change in future proj by about +2 or more" / "+2-4" | Your future proj change ≥ +2.0/wk; +2 to +4 is the sweet spot | printed You gain /wk (`weekGainShown`, `netGainOf` js/trade-page.js:6361) |
| 2 | "equal or positive change in value" | Value change ≥ 0 | `customValueChange` (trade-page.js:2034): Value in − out − forced cut |
| 3 | "my opponents change in this week's proj should be positive" | His This week > 0 | `thisWeekOf` (trade-page.js:6395) |
| 4 | "players that I want … in the position that I need it in the most" | A man you get fills one of YOUR Needs | `js/slot-needs.js` Needs/Has (custom box only today) |
| 5 | "players … my opponent needs" | A man you send fills one of HIS Needs | same |
| 6 | "coin and diamond … buy low and not high" | You get 💎 (or near), you send 🪙 (or near); never get 🪙 | `outlookMarkOf` (trade-page.js:2589); Appeal = Σ(proj−avg) in − out (js/outlook-mark.js:73) |
| 7 | "this week's proj … buying low" | Men you get have a low this-week proj vs their future (bye/bad matchup) | per-week projections already on every man |
| 8 | "relatively sparce … not repetitive" | ≤ 2 suggestions per manager; nothing like an offer sent / declined recently | sent offers `ff.trades.sent.*`, past trades (js/trade-history.js, js/past-trades.js) |
| 9 | Flip: "bench players with high value (2-4) … buy them for low, even if my change in future proj is slightly negative (-0-1) … If no one needs a QB, then I won't buy it" | Flip mode: You gain −1 to 0/wk, Value +2 to +4, and another manager Needs that position (name him) | Value, Needs/Has |

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
| A | **Checklist finder:** keep the engine's candidates; replace the gates with rules 1–2 (+ his bounds), order by appeal (rules 3–7), cap per manager (8), ✓ marks per row; Flip as a switch (9) | Medium: page-side gates + order + one column; engine candidate cap may need widening | Too few deals pass all gates on a thin week → show the near-misses below a line with the failed check named |
| B | One blended "Fit" score with weights | Medium | Opaque; Tim can't see why a deal ranks; weights are guesses (the yes-chance already has this problem) |
| C | Keep today's order, add the checks as filter switches | Small | He still sorts and judges by eye; doesn't fix the complaint |

## Recommendation (ranked)
1. If only one thing is built, build **A without Flip**: his gates, appeal order, ✓ checklist column, per-manager cap. It removes the by-eye work directly.
2. Then **Flip mode** (rule 9), as its own switch in the finder box, each row naming the manager who needs that position.
3. Then the **"not repetitive" memory** (rule 8, second half) using the sent-offers store.

### Order inside A (deals that pass rules 1–2)
Sort by count of appeal checks passed (3, 5, 6-send, 6-get, 7, 4), then by his This week, then by You gain closest to +3 (the middle of +2–4). Every check is shown as ✓/✗ on the row, so the order is explainable at a glance. The yes-chance word stays in the card only.

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
0. **Review Tim's liked custom trades** (no code): score each against the checklist, show which rule each passes/fails, settle the open thresholds. Done when every one of his trades is explained by the rules or a rule is changed.
1. **Checklist finder** (A): gates 1–2, appeal order, ✓ column, ≤ 2 per manager, near-misses under a line. Suggested (custom box completions) uses the same gates and order. Done when: a suite seen failing first proves gates/order/cap on the trade stub; Tim's Phase-0 trades (as stub fixtures of the same shape) rank in the top rows; 393 px + laptop screenshots; tr-test touched scenarios pass.
2. **Flip mode:** switch in the finder box; rows show "Flip to <manager> (needs QB)". Done when a stub with a QB-needy third team produces the row and one without produces none.
3. **Not repetitive:** hide deals sharing a man each way with an offer sent or declined in the last 7 days; show "sent Oct 26" instead. Done when the stub's sent offer suppresses its near-copy.

## Questions for Tim
a. Order the finder by your checklist (✓ marks) instead of today's net increase × yes-chance? · recommended: **yes** — it is your own process.
b. Above +4 a week for you: still show, but lower (looks lopsided to him)? · recommended: **yes, lower**, not hidden.
c. Flip mode as its own switch, only when another manager needs that position? · recommended: **yes**.
d. At most 2 suggestions per manager? · recommended: **2**.

## Sources
- Code read 2026-10-31 (js/trade.js, js/trade-page.js, js/accept.js, js/outlook-mark.js, js/slot-needs.js, js/past-trades.js).
