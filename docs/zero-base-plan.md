# A 0 counts as the base (2026-10-22)

## Tim's words
"okay I do want to count the 0 everywhere, but not as a pure 0. Make the number the base of that position. For example if a 0 value equals 13 pts proj for a WR, then replace the 0 with 13 when counting for future proj. this is also the case for BYE weeks. This means that (18, 17, 19, 0, 18) (avg 14.6) turns into (18, 17, 19, 13, 18) (avg 17.2). Does that make sense? make sure the calculations and displays are changed throughout the entire cite. Also before you start working, do you think we should use the starting baseline or the bench baseline for each position, or a mix of both depending on the player?"

Earlier: "review the value system accross the entire cite and make sure that value is actually consistent everywhere, and also makes sense."

## The rule
For every FUTURE week being averaged, a week projected 0 or his bye week counts as his position's **waiver line** (the frozen line in js/value.js, `fillOf(base, position)`).
- A week with no number (null) is still left out.
- Past weeks with real scores are never replaced.
- A positive projection below the line stays as it is.
- No lines known (no base yet): the old behaviour.
- `restAvg` and `restProjAvg` are now the same filled average, so the card's Proj and the number behind Value agree.

## Why the waiver line (not the starter line, not a mix)
A 0 or a bye week is a week you fill from the wire, so what you get is the waiver line. The starter line would credit a hurt man with a starter's week he can't give. A mix would make the same 0 count for different amounts depending on the man, which is harder to explain. Value already starts at the waiver line, so a filled week is worth exactly 0 Value. That is the "he gives you nothing over the wire" meaning.

## Circularity
The lines themselves are built from the OLD raw average (`rawAvg`: bye out, 0 as 0). Stored lines are never re-frozen or altered.

## Ground truth
Tim's example (18, 17, 19, 0, 18): raw mean 72/5 = **14.4**, filled with 13 = 85/5 = **17.0**. Tim wrote 14.6 and 17.2, which looks like a slip of 0.2 in both; the shape is the same. tests/test-value.mjs checks 17.0 and 14.4.

## Places changed
- js/value.js: `rawAvg`, `fillOf`, `filledWeek`, `runValue`, `withFreeAgents`; `restAvg`/`restProjAvg` take `fill`.
- js/season.js: Values use the filled average (`lookup.fill` too); the synced copy reads byes like the laptop; `fetchWireValues` gives free agents a Value.
- js/player-card.js: the Proj heat centres on the filled average (`centredRun`).
- Value-switch "Avg" = one Value of the filled average, not a mean of weekly Values: analysis-page, who-to-start (`manAvg`), proj-avg-grid, playoffs-players, waivers-page, trade-page (`cuSlotAvg`).
- trade-page: custom "Season by week" on Value no longer floors first; the Value column, `customValueChange`, `valueCellHtml` and the box subtract the forced cut's Value.
- Free agents have a Value on the Playoffs list, Stats pre-vs-now and the Trade Value measurement.
- draft-page: "Value now" unknown is a dash and adds nothing to sums.

## Left alone on purpose
- Each week's cell still shows ESPN's real 0 / BYE; filled weeks have no new look.
- The lineup-based trade engine and the Proj-mode slot grids keep the positional floor (rule 13).
- Wording calls for Tim: Draft board "Value" row, Trade "Value on" picker.
