# Previews plan — every number and name gets a good preview and a connector

**Status: BUILDING (2026-10-08).** Audits done (5 read-only agents, headless 1440 on league 1241838 + code). Shared base being built first; per-page builders follow. Add a `## BUILT` section when shipped.

Tim, 2026-10-08, verbatim: "Right now previews on the cite are a super strength. If the user is curious about a number or it's breakdown or a detail about a stat or column or anything they should be able to hover over it and show a preview. Many places in our cite still need work on this, either they don't have a preview at all, or their current preview is ugly or doesn't actually give good information. Could you analyze the cite looking for anywhere a preview might be usefull or our current preview isn't how it should be shown and then fix it. Also connectors to other places in the cite using previews is a huge advantage as well so check that out and build any connectors by clicking on the preview. An example of a good preview are the classic player previews that show the 3-row chart of week, avg, and proj with their main details at the top to give everything you need to know about that player. a bad preview is any player reference in the home section, or the numbers in the week by week chart that talk about SD and info we don't want or need."

## Rules for every builder

- **Player name anywhere → the classic player card** (`js/player-card.js`). Click → `waivers.html?player=<id>[&week=]`.
- **A number → a breakdown card** (shared `js/pop.js` `statCard`): label/number rows that add up to it, plus rank ("2nd of 10") where it is a comparison. Click → the connector.
- **A team name → a team card**: record, avg, this week's projection. Click → `analysis.html?team=&week=#rosterDetail`.
- **A team's week total → the team-week card**: the total broken into starters. Click → that team and week on Analysis.
- **A week heading → that week on Schedule** (`schedule.html?week=`).
- **Never** SD, "step n of 4", "end of the scale", z-scores. Never a raw `title` where a card fits; an element with a card carries no `title` (double tooltip). Column headings keep a one-line `title` definition.
- No new always-visible words (word ceilings). Nothing moves on hover/tap. Touch: the sheet with a link button.
- **Season by week Position cells on Analysis keep NO card** (Tim, 2026-09-18). Name line only.

## Shared base (one builder, first)

`js/pop.js` (statCard, teamWeekCard, wirePops) · plain-standing words in `js/heat.js` at the source · `playerCardFromWeeks` in player-card.js · `js/links.js` (`teamHref`, `playerHref`, `weekHref`, `statsHref`) · deep links `schedule.html?week=`, `stats.html?team=`, `trade.html?player=` · card/href hooks on `scatterChart` and `createTooltip` in charts.js.

## Per page (A = none today, B = bad today)

**Home** — B: every player name (`#injuryTable a.pref`, `#benchTable a.pref`, `.gswap a.pref`; raw title) → player card built from the weeks Home already holds (decided + current; unheld weeks 'wait'; zero extra requests on the phone). B: bench "Started" SD title → "104.8 · league avg 121.7 · 9th of 10". A: matchup `.gmeta` margin/win chance → both totals, gap, chance; `.tname/.tproj/.tscore` → team-week card; Bench and Cost cells → the men and "benched 25.2 − started 1.5 = 23.7"; team names → team card; `.trec` → W–L by week; table headings → one-line titles. (Roster strength is moving to Stats.)

**Summary** — B: LUCK cell (SD) → the Stats luck breakdown → `stats.html`; Title %/Loser % (SD) → "24% = 24,000 of 100,000 seasons · rank 1st" → `schedule.html#simPanel`; member name → team card; headings → one plain sentence. A: Record → W–L by week. `summary-table.js` is shared with Decisions: opt-in flag.

**Stats** — B: `#weeklyTable td.heat` (the SD preview Tim named) → team · week / vs opponent, W or L / Proj · Scored · diff / league that week · rank; `#mainTable td.heat` → the weeks behind the average, league avg, rank; scatter dots → player card with that week marked; line charts' tooltip → add highlighted team's opponent and result; box rows → "typical week / middle half / best and worst" naming the weeks; dist bars → the team-weeks in the bucket. A: team names → team card; week heads and League row → week card → Schedule week; `#glance .stat` tiles → who/when; W–L, Total, Spread, rank cells; `#accuracyTable` cells → the games counted; `.fit-stats` → one plain line.

**Schedule** — A: `#matchupsPanel .game` → each side Proj · Scored · diff, win chance → Analysis team+week; forecast Opponent and ± cells; all `.stat` tiles; `#simTable td.name` → team card. B: `#forecastTable` Win % (SD + "scoring spread") → You proj / Them proj / Gap / Win chance; `#simTable td.heat` → "N of 10,000 seasons", rank; `#h2h td` raw title → score/win chance; chart bars → "Finishes 1st in 2.3% of seasons".

**Analysis** — B (SD titles): Weekly totals week cells, Season "Starting lineup" band, All teams Total → team-week card; Player-mode week cells and Who to start week cells → player card (starts bolded); All teams Proj avg slot cells → small card (slot, average, who fills it, rank); Avg cells → "Avg of N weeks · 2nd of 10". A: team names → team card (+ Weekly totals rows get the same row click as All teams); Roster detail stat row and headings; "+28.1" best-note → "best lineup 116.0 vs set 87.9"; Starts cell → the weeks. Week headers → Schedule week. Add team-only `analysis.html?team=`. Strip SD from Position cells' `aria-label` only. Fold notes at analysis-page.js 269, 2037, 5537–5589, 5687 mention SD.

**Players** — B: `td.avg.heat` → "17.3 = mean of wk 5, 7 (bye wk 6 left out) · 2nd of 17 free-agent QBs"; Taken week cells → "24.6 · 1st of 38 rostered RBs this week"; `td.owner` → team card; `td.pos` "RB1" → that manager's RBs by Avg; past-week cells → "Proj 16.4 · scored 16.5" → Schedule week; `.who` duplicate titles removed. A: `span.mine-tag` → your men at that position. Connectors: Gain pop-over "Drop X" → that player; taken player → "Trade for him" (`trade.html?with=&get=`). Names keep opening the Actual row (deliberate).

**Trade** — B: `td.gain`/`td.their-gain` (SD) → week table now / with trade / +, click opens the deal pop-up; `td.delta.heat` → the slot lines that changed; goal cells (long sentence) → you now → with, him now → with, chance he says yes; depth cells → names the starters and spare men; `td.opp-proj`; `.bar-chip` → that man's player card; `.trend/.inj/.bye-hl` titles fold into the card. A: `td.before-after`; `span.wkx-name` → player card; manager names → team card; depth Lineup cell and `#cuSeason` totals → team-week card; `#cuGainA/B`, `#cuMeet`; headings. New param `trade.html?with=<teamId>&get=<ids>&send=<ids>`.

**Decisions** — B (SD): Season by week cells → player card; Avg/Total cells; standings cells; LUCK; decision rows (title repeats the row) → player card + flipped-weeks card; `td.dz-res`, `td.dz-vs`, `td.dz-team` → score card / team card. A: Close luck, Luck score, S+L, PTW → formula filled in; Title %/Loser %; `.dz-man` names → player card; stat tiles; Bench / Proj 0 counts → the week card filtered to those men; All-users cells. Add `decisions.html?team=&week=`. At word ceiling: nothing always-visible.

**Draft** — no previews anywhere: headings → one-line titles; names → player card (no chart on the demo pool); vs repl., Lasts %, grade, Edge → small breakdown cards; Why column → all notes in the card.

**Top bar** — `#connSaved` chip → link to `schedule.html#timePanel`; league name → season, week, last read time.

## Order

1. Shared base. 2. One builder per page, in parallel, after the base and the in-flight page work are merged. 3. Full suite once at the end.
