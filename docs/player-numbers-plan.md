# Player numbers plan — a player's projection AND score, wherever he is named

**Status: PLAN ONLY — NOTHING IS BUILT.** Written 2026-10-08.

Tim, 2026-10-08, verbatim: "I've noticed there's often situations where I want to know a player's act and proj for a certain week or something like that and I didn't have access to it directly in that location. Could you look over that across the cite and see if we're missing that in any places and make a plan to fill it?"

## The answer in one sentence

Eight places name a player (or show his number) without giving both his projection and his score for that week; six can be filled from data the page already holds, with no new ESPN requests, by reusing the player card or by printing the missing number beside the one shown.

## How it was checked (measured, 2026-10-08)

Headless at 1440 on league 1241838 (week 5; weeks 1–4 final). Every visible element that is a player link, carries `data-pid` / `data-player`, or carries the card's `data-tip` was counted per panel, with whether the card is attached and what its tap/hover text says. Not driven: pop-ups that need a click (Trade's preview pop-up, Decisions' All-users team card), Draft, Proj changes and Custom trades (empty on that league).

The **player card** (`js/player-card.js`) is the site's existing answer: one man, every week, a Proj row and an Act row. It is wired on Analysis, Trade and Players only.

## Where both numbers are already reachable (no change)

| Place | How |
|---|---|
| Analysis · All teams | card on all 181 cells |
| Analysis · Roster detail table | Projected, Actual, Diff columns + card |
| Trade · ranked list, Best combo, Depth map spares, Custom trades | card on every name (226 of 226) |
| Players · Available, Taken | week columns; a name opens his Actual row |
| Decisions · Season by week | each cell prints proj and score ("16.1 5.4") |

## The gaps, and the fix for each

| # | Place | What it shows now | What is missing | Fix | Data |
|---|---|---|---|---|---|
| 1 | Analysis · Season by week, **Position** rows (170 cells) | one number: score OR projection, by the Actual/Proj select | the other number | the name line above the table adds "Wk 3 · proj 14.2 · scored 19.1" for the cell under the pointer/tap. **No card** — Tim removed it here (2026-09-18: "we don't need … the 14 week preview when you hover") | in hand (`leagueIndex`) |
| 2 | Analysis · Season by week, **Player** rows | one number per week; name is a bare link | the other number, in every played week | attach the card to the **name** (Proj + Act rows); a played week's tap text says both numbers | in hand |
| 3 | Analysis · **Who to start** (name links, no card) | as 2 | as 2 | as 2 | in hand |
| 4 | Analysis · Roster detail's "best lineup" note (4 names, no card) | name only | everything | attach the card the table below already builds | in hand |
| 5 | Home · **Left on the bench** | both men's SCORES ("B. Robinson Jr. (25.2) over S. Barkley (1.5)") | their projections — i.e. whether the call was reasonable at the time | print proj beside each score, dim: "25.2 · proj 9.1" | in hand (that week's rosters) |
| 6 | Home · **Injury report** | this week's Proj | what he scored last week / averages | one column, "Last" (last finished week's score); the card is NOT proposed here — Home loads one or two weeks, and a card would need all of them (and the phone copy must stay at zero requests) | in hand (latest final week) |
| 7 | Decisions · **week preview** (Started → Instead) and **Biggest swap** | each man's score | his projection — the whole point of "Reasonable" | proj beside the score in the preview rows; Biggest swap stays score-only (one line, no room on a phone) | in hand (`starters[].projected`) |
| 8 | **Schedule · Week matchups** and **Home matchup cards** | team totals only; no player at all | who scored what | a link on each game to ESPN's box score (rule: complement ESPN, do not rebuild it). Alternative, bigger: an in-site lineup list under each game | link: none · list: one request per finished week |

Checked and left alone: Stats and Summary name no players except the Stats "Projected vs actual — players" dots (not verified here that a dot names the man, week, projection and score — check before building; if it does not, add it to this list).

## Phases (each ships alone)

- **A — Analysis (gaps 1–4).** One builder. `js/analysis-page.js` only (+ tests an-test, proj-changes-check). The card code already exists on the page; this is wiring plus the name line.
- **B — Decisions (gap 7).** One builder. `js/decisions-page.js` (+ decisions-check).
- **C — Home (gaps 5–6).** One builder. `js/home-page.js`, `index.html` (+ test-home). Must keep the phone copy at zero requests.
- **D — Matchups (gap 8).** After Tim picks link or list.

If only one thing is built, build **A**: it is where a player's week is looked at most and holds 4 of the 8 gaps.

## How it fails

- Words: Decisions is at its word ceiling (167/167) and Analysis near it (368/381). Numbers are not words, but any new label is — the fixes above add one heading ("Last") and no sentences.
- Phone width: gap 5 adds two numbers to a tight cell; if it overflows at 393 the projection moves to the tap text.
- Gap 1 must not bring the card back to the Position rows.

## Questions for Tim (his calls)

- (a) Matchups, gap 8: **link to ESPN's box score** (recommended) or an in-site lineup list?
- (b) Home injury report, gap 6: a "Last" score column (recommended), or leave it?

## Deliberately NOT planned

- A box score built in-site by default (ESPN has one).
- Cards on the Decisions moves list (a move is a transaction, not a week).
- Anything on Draft.
