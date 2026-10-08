# Colour plan — the red→green scale where it is missing or wrong

**Status: AUTHORIZED (2026-10-08).** The "goes grey past the end" bug has its own builder in `js/heat.js`. The additions below are built per page, by the same builder that does that page's previews (docs/previews-plan.md), after the heat fix and the preview base are merged.

Tim, 2026-10-08, verbatim: "In many places throughout the cite our color system is either not shown or is having some errors. I think I've found that it gets darker green or darker red up to a certain point and then if you go past that it actually goes back to grey or something like that. Could you investigate this and see if you could fix this, and also if there are places where you think we should implement the red/green color system? go ahead an build when you're ready."
Standing taste: "Numbers that are good or bad get a red→green scale, with a tight range, applied everywhere that number appears."

Audit: headless 1440 on league 1241838, week 5, counting numeric cells vs cells with a `heat` class; 390px and empty panels inferred from code.

## Build (per page)

- **Analysis** — Roster detail `#rosterTable` (`analysis-page.js:2487-2493`): Projected, Actual, Avg/wk, Season total, each against the league's starters at his position (the scale Player rows use, `:4563`). Who to start `#startersTable` (`:5212`): Avg and week cells, same position same week; keep the `st` best-lineup mark readable on top.
- **Players** — Available `#waiverTable` future-week cells (`waivers-page.js:2749`): position by week, as Taken does (`:2606`); `hot`/`beats` marks must still read. Gain column (`:1933`): against the column.
- **Schedule** — forecast Them/Opp cells (Opp inverted): the ten teams that week.
- **Stats** — Total and Skill (`standings-table.js:143`); Luck score (it is coloured on Summary and Decisions, not here).
- **Decisions** — `#weekTable` Actual and Hypothetical: the league that week.
- **Home** — Injury report Proj and Last: position scale.
- **Trade** — "You gain" must never draw red on a plus: anchor the scale at zero (today it is scaled against the other offers, so +2.3/wk drew `heat-dn-3`). Custom trade values: compare a position across the league, as everywhere else (`trade-page.js:7740` compares across two squads, so a man can be green there and red on Players). Depth map Lineup column: against the league.
- **Draft** — vs repl. across the board; Proj by position; Starting lineup across teams.

## Leave uncoloured (and why)

Matchup cards (win/lose/fav colours own them) · Trade depth map's own `deep`/`thin` tint · Stats opponent bars (`.dd.hard` marks the gap) · Trade Δ title/last chance (sign colour; list sorted by it) · Schedule Title ±/Last ± (importance, not good/bad) · Proj changes Difference (sign) · ranks and orderings (LS, PS, AS, ADP, draft #) · records and counts (W–L, Games, Starts, Bench, Proj 0) · no good end (Spread, PTW, % own, Bye, Lasts, Bench points) · single stat tiles · accuracy table · past/part-played/bye/OUT cells · sign-coloured differences (Diff, Cost) · the Summary share image.
