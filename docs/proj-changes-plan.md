# Proj changes (Analysis) — plan

**Status: BUILDING in phases (Tim asked for it to be made, 2026-10-05). Phase 1 started 2026-10-05.**

## Tim's ask, word for word (2026-10-05)

"I want to make a proj changes chart in the analysis section that basically shows how a player's proj has changed between a certain time period/range. This basically shows if you're player's performance has grown and has gotten more valuable or less valuable due to various reasons.

I want this to be displayed in the analysis section right below the season by week chart, and make it very similar to the other boxes with the act and the difference button selections. This proj change box will be identical to the current season by week chart, but will show you what your season by week chart looked like around week 3 or 2 or something so you can see how it changed. Additionally, at the top of the current season by week chart, allow the user to select "player" or "position". Right now we have it on position, because we only show 9 positions and we rotate the player's through the positions so that the player with the highest proj always starts for that week. For the player selection, show the player's name and position on the left, and then show what they're proj for all future weeks, and what the scored for all previous weeks. This means you will need to add many more rows so that the bench players are also shown in this (don't show past players, just current). At the top of this proj difference chart, allow the user to select which week they want the chart to refer to, and then if it shows total or difference. The difference selection just shows the current proj-past proj for each cell in the chart so that you can tell if certain players are increasing or decreasing their proj for future weeks."

## The one-sentence answer

Buildable, with one hard limit: **ESPN keeps no history of its projections** (rule 8, re-measured below), so "what the chart looked like in week N" exists only for weeks in which this site saved a copy at the time.

## What history exists (measured 2026-10-05)

| Source | Holds | Reach |
|---|---|---|
| Weekly readings, schema 2 (`js/snapshots.js`, since 2026-09-21; `players.mine`) | **Your own team's** players, projection in every remaining week, as of the first visit that week | Week 3 or 4 onward, only in the browser that took them (Tim's laptop). Other teams: starters of the as-of week only. Weeks 1–2 are schema 1: team totals only. |
| ESPN itself | Nothing: future-week projections are overwritten in place | — |
| Wayback Machine (CDX query of `lm-api-reads.fantasy.espn.com/.../2026/*` from 2026-09-10) | A few `kona_player_info` pages on scattered dates: one week's projection + the season split for about 50 players of somebody else's league | Not per future week, not every player. Not usable for this chart. |
| `data/baselines/2026-preseason.json` | Preseason per-game projection, every player, re-scored per league | One flat number per player, not a week-by-week sheet. Parked as a possible "Preseason" reference (not in phase 1–2). |

So: the reference-week picker lists only the weeks that have a saved copy. For Tim's own team that should be week 3/4 on; for every other team it starts the week phase 1 goes live. Weeks 1–2 cannot be recovered.

## Phases (each ships alone)

1. **Capture, now** (cannot wait: every week not saved is gone). New store, one key per league/season/week, written the first time that week's rosters for all remaining weeks are in memory (same moment the weekly reading is taken): every team's whole roster with each player's projection in every remaining week. Never rewritten once saved; the schema-2 readings are not touched. Pure reader `js/proj-history.js` answers "team T as of week N" from the new store, else from a schema-2 reading's `mine` (own team only).
2. **Season by week: Player | Position** switch (Position = today). Player view: one row per CURRENT roster player (starters and bench, no past players), name + position on the left, scored points in history weeks, projection in future weeks; same Actual history label, divider and League conventions as the 2026-10-05 Analysis change.
3. **Proj changes box** directly under Season by week: the same sheet as it was at a chosen reference week ("As of" select, only weeks with a copy), with a **Total | Difference** switch (`js/view-switch.js`, as on Trade and Decisions). Follows the Player | Position switch and the team select. Difference = current projection − projection then, per cell, for weeks still to come; weeks played since then are blank in Difference. A team/week with no copy says so in one line.
4. **Later, needs a go:** carry the copies to the cloud for the phone (new additive Firestore docs, like Decisions), include them in Export archive, "Preseason" as a reference.

## Decisions (technical, mine)

- New store rather than schema 3 of the reading: the reading format is read forever and one browser holds weeks 1–4; nothing may rewrite it.
- Size: about 10 teams × 17 players × 13 weeks of numbers ≈ 30–40 KB a week as rows, well inside localStorage with the readings beside it. A quota failure must not break the page or the reading.
- Position view of a past week re-solves the best legal lineup from the roster as it was then, with the page's own solver; no second solver.
- Demo: the demo generator has no past projections; the box shows a made-up-but-deterministic earlier copy only if that is cheap, else the one-line "no copy" state.

## Questions for Tim (defaults taken)

a. Phone: until phase 4 the box only has history on the laptop that saved it. OK to ship that way first? (assumed yes)
b. Weeks played since the reference week are blank in Difference (scored − projected is luck, not a projection change). (assumed)
c. Words: box title "Proj changes", select "As of", switch "Total | Difference". (assumed; his to rename)

## NOT verified

- Which weeks Tim's own browser actually holds (cannot be read from here).
