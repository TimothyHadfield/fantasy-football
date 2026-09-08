# ESPN Fantasy Football API — draft reference

Field-path reference for live-draft code. Written to match the conventions in
`js/espn.js` (paths are given relative to the raw JSON that `request()` returns).

## How the claims here were checked

Three levels of confidence are used throughout:

- **VERIFIED (live)** — observed in a real response captured on 2026-09-08 from
  `lm-api-reads.fantasy.espn.com` against public leagues `1241838` (10-team,
  auction, keeper, half-PPR w/ TE premium) and `899513` (10/12-team, TQB league;
  auction in 2025, SNAKE in 2026), seasons 2025 and 2026, plus the league-less
  player endpoints.
- **CORROBORATED** — matches a well-known open-source wrapper as well.
- **UNVERIFIED** — could not be observed or confirmed; flagged inline. Do not
  build a hard dependency on these without a fallback.

Sources cited:

- espn-api (Python), the most widely used wrapper —
  <https://github.com/cwendt94/espn-api> (`espn_api/football/constant.py`,
  `espn_api/football/player.py`, `espn_api/football/league.py`,
  `espn_api/base_league.py`)
- ffscrapr (R) ESPN vignette —
  <https://ffscrapr.ffverse.com/articles/espn_getendpoint.html>
- nntrn's endpoint gist —
  <https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c>
- Krool/FantasyFootballAnalyzer (`src/api/espn.ts`) —
  <https://github.com/Krool/FantasyFootballAnalyzer>

Host and league path are exactly what `js/espn.js` already uses:

```
https://lm-api-reads.fantasy.espn.com
  /apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{leagueId}?view=...
```

Multiple `view=` params on one request work (repeat the key). Seasons before
2018 live under `/apis/v3/games/ffl/leagueHistory/{leagueId}?seasonId={year}`
instead. (nntrn gist)

---

## 1. `kona_player_info` — the player pool

Request: `view=kona_player_info` on the **league** path, with an
`x-fantasy-filter` header. Optionally add `&scoringPeriodId={n}`.

Response top level (VERIFIED live):

```
{ "players": [ <entry>, ... ], "positionAgainstOpponent": {...} }
```

`players` is an array of **player-pool entries**. The player object is nested one
level down, under `.player`. `js/espn.js` already does this correctly in
`normalizePlayer()`.

### 1.1 Entry-level fields (VERIFIED live)

| What | Path |
|---|---|
| Player id (duplicate of `player.id`) | `players[i].id` |
| Roster status | `players[i].status` |
| Fantasy team currently rostering (0 = nobody) | `players[i].onTeamId` |
| Keeper cost / auction cost carried in league | `players[i].keeperValue`, `players[i].keeperValueFuture`, `players[i].draftAuctionValue` |
| Rankings block | `players[i].ratings["0"].positionalRanking`, `.totalRanking`, `.totalRating` |
| Lock flags | `players[i].lineupLocked`, `.rosterLocked`, `.tradeLocked` |

Observed `status` values: `"FREEAGENT"`, `"WAIVERS"`, `"ONTEAM"`. Full entry-key
set observed: `draftAuctionValue, droppedByEliminatedTeam, id, keeperValue,
keeperValueFuture, lineupLocked, onTeamId, player, ratings, rosterLocked,
status, tradeLocked`.

The `ratings` map key is a string. It was `"0"` in every response observed, and
it was present on 900/900 entries even without
`filterRanksForScoringPeriodIds`. Whether that key changes when you pass
`filterRanksForScoringPeriodIds` is **UNVERIFIED** — read it defensively
(`Object.values(entry.ratings || {})[0]`).

### 1.2 Identity (VERIFIED live)

| What | Path |
|---|---|
| Player id | `players[i].player.id` |
| Full name | `players[i].player.fullName` (also `.firstName`, `.lastName`) |
| Default position id | `players[i].player.defaultPositionId` |
| Eligible lineup slot ids | `players[i].player.eligibleSlots` (array of ints) |
| Pro team id | `players[i].player.proTeamId` |
| Jersey / active flag | `players[i].player.jersey`, `players[i].player.active` |
| Droppable | `players[i].player.droppable` |

Full `player`-key set observed: `active, defaultPositionId,
draftRanksByRankType, droppable, eligibleSlots, firstName, fullName, id,
injured, injuryStatus, jersey, lastName, ownership, proTeamId, stats`.

**`defaultPositionId` and `eligibleSlots` use two DIFFERENT numeric
namespaces.** See §4. This is the single most common source of bugs.

Note `eligibleSlots` can contain **25**, which is not a lineup slot — espn-api
labels it `Rookie` and explicitly skips it when deriving a position
(`player.py`: `if (pos != 25 and '/' not in POSITION_MAP[pos])`). VERIFIED
live: rookie players carry a trailing `25` in `eligibleSlots`.

### 1.3 Season projection total — distinguishing PROJECTED from ACTUAL

`players[i].player.stats` is an array of stat-set objects. Each has:

```
{
  "id":              "<statSourceId><statSplitTypeId><externalId>",   // string
  "externalId":      "2026" | "20261" | "401772965",
  "seasonId":        2026,
  "scoringPeriodId": 0,        // 0 = whole season, 1..18 = that NFL week
  "statSourceId":    1,        // 0 = ACTUAL, 1 = PROJECTED
  "statSplitTypeId": 0,        // 0 = season total, 1 = single scoring period
  "appliedTotal":    335.11,   // fantasy points under THIS league's scoring
  "appliedAverage":  19.71,    // present on season splits
  "stats":           { "<statId>": <raw value>, ... },
  "appliedStats":    { "<statId>": <points>, ... }   // not always present
}
```

**Rule (VERIFIED live):**

- `statSourceId === 0` → **ACTUAL** (what really happened)
- `statSourceId === 1` → **PROJECTED** (ESPN's forecast)
- `statSplitTypeId === 0` → whole-season aggregate (`scoringPeriodId === 0`)
- `statSplitTypeId === 1` → one scoring period (`scoringPeriodId` = that week)
- `statSplitTypeId === 2` → some other split; espn-api skips it
  (`player.py`: `if ... stats.get('statSplitTypeId') == 2: continue`). Requesting
  it explicitly returned nothing in testing. Semantics **UNVERIFIED** — ignore
  it, as espn-api does.

So the **season projection total for season S** is:

```js
player.stats.find(s =>
  s.seasonId === S && s.statSourceId === 1 && s.statSplitTypeId === 0
)?.appliedTotal
```

which is exactly what `statTotal(p.stats, season, 1)` in `js/espn.js` computes.
Equivalently, match on the string id `"10" + S` (e.g. `"102026"`).

Live example (Jahmyr Gibbs, league 1241838, season 2026):

| `id` | src | split | period | meaning | `appliedTotal` |
|---|---|---|---|---|---|
| `"102026"` | 1 | 0 | 0 | **2026 season projection** | 335.11 |
| `"002026"` | 0 | 0 | 0 | 2026 season actual (0.0 preseason) | 0.0 |
| `"102025"` | 1 | 0 | 0 | 2025 season projection | 287.11 |
| `"002025"` | 0 | 0 | 0 | 2025 season actual | 328.4 |
| `"1120261"` | 1 | 1 | 1 | week-1 2026 projection | 20.55 |
| `"01401772965"` | 0 | 1 | 18 | week-18 2025 actual (ext = ESPN game id) | 18.8 |

Two important consequences:

1. **`002026` exists preseason with `appliedTotal: 0.0`.** "Actual is 0" and
   "actual is missing" are different states; test for the entry, not for a
   truthy total.
2. **`appliedTotal` is scored under the queried league's rules.** Querying via
   `/leagues/{id}` gives league-specific projections; the league-less endpoints
   in §1.6 give ESPN default scoring. Same player, season 2026: 335.11 via
   league 1241838 vs 369.07 via `leaguedefaults/3`. VERIFIED live. (The comment
   in `js/espn.js` `fetchPlayers()` is correct.)

The `stats` / `appliedStats` sub-maps are keyed by ESPN stat id. Key ones
(espn-api `PLAYER_STATS_MAP`; espn-api's own comment says this map "may not be
quite correct", and it does contain duplicates — e.g. both 42 and 61 are
labelled receiving yards — so treat anything beyond the common ones as
approximate):

`0` passingAttempts · `1` passingCompletions · `3` passingYards ·
`4` passingTouchdowns · `20` passingInterceptions · `23` rushingAttempts ·
`24` rushingYards · `25` rushingTouchdowns · `42` receivingYards ·
`43` receivingTouchdowns · `53` receptions · `58` receivingTargets ·
`72` lostFumbles · `83` madeFieldGoals · `86` madeExtraPoints ·
`89`–`92`,`123`–`125` D/ST points-allowed buckets · `95` defensiveInterceptions ·
`99` defensiveSacks · `155` teamWin.

### 1.4 ADP, auction value, ownership (VERIFIED live)

All under `players[i].player.ownership`:

| What | Path |
|---|---|
| Average draft position | `.averageDraftPosition` |
| ADP trend | `.averageDraftPositionPercentChange` |
| Live average auction value | `.auctionValueAverage` |
| Auction trend | `.auctionValueAverageChange` |
| Percent owned | `.percentOwned` |
| Percent started | `.percentStarted` |
| 7-day ownership change | `.percentChange` |
| League type this data is for | `.leagueType` (observed `0`) |

Separately, ESPN's **published** pre-draft ranks and dollar values live at
`players[i].player.draftRanksByRankType`, a map keyed by rank type:

```
draftRanksByRankType: {
  "STANDARD": { "rank": 1, "auctionValue": 57, "rankType": "STANDARD",
                "rankSourceId": 0, "slotId": 0, "published": false },
  "PPR":      { "rank": 1, "auctionValue": 57, ... }
}
```

- Overall draft rank: `players[i].player.draftRanksByRankType.PPR.rank`
  (or `.STANDARD.rank`)
- ESPN's published auction $: `...draftRanksByRankType.PPR.auctionValue`

**Two distinct auction numbers.** `ownership.auctionValueAverage` is the
crowd-sourced live average across real drafts; `draftRanksByRankType[T].auctionValue`
is ESPN's static published value. They differ substantially (Gibbs 2026: 70.77
vs 57). Pick deliberately.

**Gotcha — ADP is only meaningful for the current season (VERIFIED live).** For
a *past* season, ESPN returns a flat sentinel: every one of 900 players in
league 1241838 season 2025 had `averageDraftPosition === 170.0` and
`auctionValueAverage === 0.0`. For season 2026 the same fields were real
(1.32, 2.41, 4.23, …). `js/espn.js` treats `adp <= 0` as unranked, which does
**not** catch the 170.0 sentinel. If you ever query a historical season, use
`draftRanksByRankType` instead.

Which rank type to read should follow the league:
`settings.scoringSettings.playerRankType` is `"STANDARD"` or `"PPR"` (VERIFIED
live).

### 1.5 Injury fields (VERIFIED live)

| What | Path |
|---|---|
| Injury designation | `players[i].player.injuryStatus` (string) |
| Coarse injured flag | `players[i].player.injured` (boolean) |

Across the top 900 players of league 1241838 (2025):
`ACTIVE` ×679, `QUESTIONABLE` ×180, `OUT` ×4, **field absent** ×37;
`injured: true` only ×4.

Notes:

- **`injuryStatus` can be missing entirely** (37/900). Default it, as
  `js/espn.js` does (`p.injuryStatus || 'ACTIVE'`).
- `injured` tracks only the severe cases; it was `false` for all 180
  `QUESTIONABLE` players. Do not use it as "is this player dinged".
- Other values reported by the community but **not observed in this
  capture (UNVERIFIED)**: `DOUBTFUL`, `PROBABLE`, `INJURY_RESERVE`,
  `SUSPENSION`, `DAY_TO_DAY`, `NORMAL`.
- In roster payloads (`mRoster`) the same field sits at
  `teams[i].roster.entries[j].playerPoolEntry.player.injuryStatus` — the path
  `js/season.js` already uses.

### 1.6 The `x-fantasy-filter` header

Header name is case-insensitive; value is a JSON **string**. For the league
endpoint everything is nested under a top-level `"players"` key. (For the
league-less `/seasons/{y}/players` endpoint the keys are at top level instead —
nntrn gist.)

Canonical shape for "player pool, sorted by rank, limited, available only":

```json
{
  "players": {
    "filterStatus":   { "value": ["FREEAGENT", "WAIVERS"] },
    "filterSlotIds":  { "value": [0, 2, 4, 6, 16, 17, 23] },
    "limit":  200,
    "offset": 0,
    "sortDraftRanks": { "sortPriority": 1, "sortAsc": true, "value": "PPR" },
    "sortPercOwned":  { "sortPriority": 2, "sortAsc": false },
    "filterStatsForTopScoringPeriodIds": {
      "value": 2,
      "additionalValue": ["002026", "102026", "002025", "102025"]
    }
  }
}
```

Verified behaviour of each key (all VERIFIED live unless noted):

- **`limit` / `offset`** — page size and start index. `offset: 5` correctly
  returned players 6-10 of the rank-sorted list.
- **`sortDraftRanks: { sortPriority, sortAsc, value }`** — `value` is the rank
  type string, `"PPR"` or `"STANDARD"`. `sortAsc: true` = best players first.
- **`sortPercOwned: { sortPriority, sortAsc }`** — sort by `percentOwned`.
  This is what espn-api uses for free agents (`league.py:379`).
- **`filterStatus: { value: [...] }`** — accepted values `"FREEAGENT"`,
  `"WAIVERS"`, `"ONTEAM"`. **"Available" is `["FREEAGENT","WAIVERS"]`, not
  `["FREEAGENT"]`** — in league 899513 (2026) `["FREEAGENT"]` alone returned
  **zero** players because every undrafted player sat on waivers.
- **`filterSlotIds: { value: [...] }`** — filters by **lineupSlotId** (§4.2),
  not `defaultPositionId`. Confirmed: `[2]` returned only RBs
  (`defaultPositionId: 2`), `[16]` only D/STs, `[17]` only Ks
  (`defaultPositionId: 5`), `[0]` only QBs (`defaultPositionId: 1`).
  Slot id `0` (QB) **does** work — an earlier apparent failure was a TQB league
  with `lineupSlotCounts["0"] === 0`.
- **`filterStatsForTopScoringPeriodIds: { value, additionalValue }`** —
  `value: N` includes the N most recent weekly game logs. `additionalValue` is
  an array of **stat-set id strings** (`statSourceId + statSplitTypeId +
  externalId`) to additionally include. **`value: 0` returns an empty player
  list** — use `>= 1`, or omit the key.
- `filterRanksForScoringPeriodIds: { value: [n] }` — accepted without error;
  its effect on the `ratings` block could not be isolated. **UNVERIFIED.**
- `filterIds: { value: [playerId, ...] }` — fetch specific players.
  (thomaswildetech.com, for `kona_playercard`; UNVERIFIED for
  `kona_player_info`.)

**Critical gotcha — a sort clause is REQUIRED whenever you send a filter
(VERIFIED live, reproduced on both leagues):**

| filter sent | `players.length` |
|---|---|
| *(no header at all)* | 50 (server default page) |
| `{"players":{"limit":5}}` | **0** |
| `{"players":{"filterStatus":{"value":["FREEAGENT"]}}}` | **0** |
| `{"players":{"limit":5,"sortDraftRanks":{...}}}` | 5 |
| `{"players":{"limit":5,"sortPercOwned":{...}}}` | 5 |
| `{"players":{"sortDraftRanks":{...}}}` *(no limit)* | 937 |

An empty `players` array is therefore almost always a malformed filter, not an
empty pool. Always include at least one `sort*` clause.

**What comes back with no stats filter (VERIFIED live, league endpoint):** a
compact and usually sufficient set — current-week projection, plus season
actual and season projection for both this season and last. Add
`filterStatsForTopScoringPeriodIds` only when you need weekly game logs.

**League-less fallbacks** (no cookies needed, ESPN default scoring — nntrn
gist, VERIFIED live):

```
/apis/v3/games/ffl/seasons/{y}/players?scoringPeriodId=0&view=players_wl
    → a bare JSON ARRAY (no "players" wrapper) of ~2900 lean player objects:
      id, fullName, firstName, lastName, defaultPositionId, eligibleSlots,
      proTeamId, droppable, ownership.percentOwned, universeId. No stats.

/apis/v3/games/ffl/seasons/{y}/segments/0/leaguedefaults/3?scoringPeriodId=0&view=kona_player_info
    → same shape as the league call ({"players":[...]}), with real ADP,
      but scored under ESPN default PPR and returning EVERY weekly split
      (~58 stat entries per player — a very large payload).
```

---

## 2. `mDraftDetail` — draft picks

Request: `view=mDraftDetail` (safe to combine, e.g. `&view=mSettings`).

Response (VERIFIED live). Top-level keys: `draftDetail, gameId, id,
scoringPeriodId, seasonId, segmentId, settings, status`.

```
raw.draftDetail = {
  "completeDate": 1788035912529,   // epoch ms; present once finished
  "drafted":      true,
  "inProgress":   false,
  "picks":        [ ... ]
}
```

### 2.1 Draft state

| What | Path |
|---|---|
| Draft finished | `raw.draftDetail.drafted === true` |
| Draft running | `raw.draftDetail.inProgress === true` |
| Finish timestamp (epoch ms) | `raw.draftDetail.completeDate` |
| Picks made so far | `raw.draftDetail.picks.length` |

Observed states:

| state | `drafted` | `inProgress` | evidence |
|---|---|---|---|
| completed | `true` | `false` | VERIFIED live, 4 league-seasons |
| not yet drafted | `false` | `false` | CORROBORATED — Krool/FantasyFootballAnalyzer `src/api/espn.ts` treats `draftDetail?.drafted === false` as the unambiguous "pre-draft league" signal (lines ~272, ~1483, ~1546) |
| **live / in progress** | presumably `false` | presumably `true` | **UNVERIFIED** — no live draft was available to observe |

**Recommendation for live-draft code:** do not branch on `inProgress`. Poll and
drive off `picks.length` growing, and treat `drafted !== true` as "not
finished". Use `inProgress` only as a supplementary hint. `js/espn.js`
`parseLeague()` already exposes both as `draft.inProgress` / `draft.complete`.

Whether `picks` is populated incrementally *during* a live draft is
**UNVERIFIED**. It is what every ESPN draft tool assumes, and there is no known
alternative REST endpoint (ESPN's own draft room uses a push channel), but it
has not been confirmed here. Build the polling loop to tolerate an empty or
stale `picks` array.

### 2.2 Per-pick fields (VERIFIED live)

Complete observed key set for `raw.draftDetail.picks[i]`:

```json
{
  "autoDraftTypeId":   0,
  "bidAmount":         62,
  "id":                1,
  "keeper":            false,
  "lineupSlotId":      23,
  "memberId":          "{2B355850-05B1-4DA3-BA19-7FEDA07BD9C2}",
  "nominatingTeamId":  11,
  "overallPickNumber": 1,
  "playerId":          4241389,
  "reservedForKeeper": false,
  "roundId":           1,
  "roundPickNumber":   1,
  "teamId":            10,
  "tradeLocked":       false
}
```

| What you asked for | Exact path |
|---|---|
| Overall pick number | `raw.draftDetail.picks[i].overallPickNumber` |
| Round | `raw.draftDetail.picks[i].roundId` |
| Pick within round | `raw.draftDetail.picks[i].roundPickNumber` |
| Fantasy team id | `raw.draftDetail.picks[i].teamId` |
| Player id | `raw.draftDetail.picks[i].playerId` |
| Auto-picked? | `raw.draftDetail.picks[i].autoDraftTypeId` (see below) |

Other useful ones:

- `bidAmount` — winning auction bid. **`0` in SNAKE drafts** (VERIFIED: all 150
  picks of the 2026 snake draft had `bidAmount: 0`). Do not use it to detect
  auction; use `settings.draftSettings.type`.
- `keeper` / `reservedForKeeper` — keeper picks.
- `nominatingTeamId` — auction nominator; `0` in snake drafts.
- `lineupSlotId` — the slot the player landed in at draft time (§4.2).
- `memberId` — the ESPN member GUID who made the pick.
- `id` — sequential, matched `overallPickNumber` in every response observed.

**`autoDraftTypeId` — UNVERIFIED semantics.** ESPN publishes nothing, espn-api
does not parse it, and no public source documents it. Observed values: `0`
(146/180 and 127/150 of picks), `2`, `3`, `4`. Strong empirical signal: **every
pick with `autoDraftTypeId !== 0` had NO `memberId` key, and every pick with
`autoDraftTypeId === 0` had one.** That is consistent with "nonzero = the server
made this pick, not a human", i.e. the treatment already in `js/espn.js`
(`autodrafted: Boolean(p.autoDraftTypeId)`). The distinction *between* 2, 3 and
4 (autopick queue vs. timer expiry vs. offline/absent owner) is a guess and is
**not established** — do not display a specific reason to the user.

---

## 3. `mSettings` — league configuration

Request: `view=mSettings`. Everything lands under `raw.settings`.

Top-level `raw.settings` keys observed: `acquisitionSettings, draftSettings,
financeSettings, isAutoReactivate, isCustomizable, isPublic, name,
restrictionType, rosterSettings, scheduleSettings, scoringSettings, size,
tradeSettings`.

### 3.1 Number of teams

| What | Path |
|---|---|
| League size | `raw.settings.size` |
| Cross-check (needs `view=mTeam`) | `raw.teams.length` |
| Cross-check | `raw.settings.draftSettings.pickOrder.length` |

VERIFIED: all three agreed (10 and 12) in every league-season tested.
`js/espn.js` prefers `raw.teams.length` and falls back to `settings.size` —
fine, but `mTeam` must be requested for that to work.

### 3.2 Roster slots

| What | Path |
|---|---|
| Slot counts | `raw.settings.rosterSettings.lineupSlotCounts` |
| Per-position roster caps | `raw.settings.rosterSettings.positionLimits` |
| Lineup lock rule | `raw.settings.rosterSettings.lineupLocktimeType` |
| Unlimited bench flag | `raw.settings.rosterSettings.isBenchUnlimited` |

`lineupSlotCounts` is an object keyed by **stringified lineupSlotId** (§4.2),
and it carries an **explicit `0` for every unused slot** — VERIFIED live:

```json
{"0":1,"1":0,"2":2,"3":0,"4":3,"5":0,"6":1,"7":0,"8":0,"9":0,"10":0,
 "11":0,"12":0,"13":0,"14":0,"15":0,"16":1,"17":1,"18":0,"19":0,
 "20":7,"21":2,"22":0,"23":1,"24":0}
```

(league 1241838, 2026: 1 QB, 2 RB, 3 WR, 1 TE, 1 D/ST, 1 K, 1 FLEX, 7 BE, 2 IR
— starters 10, bench 7.) `js/espn.js` `parseLeague()` already skips zero counts
and splits out 20/21.

Caveat: `positionLimits` is keyed by **defaultPositionId** (`-1` = unlimited),
a different namespace from `lineupSlotCounts`. Its 2025 sample
`{"0":0,"1":-1,"2":8,"3":10,"4":5,"5":2,...}` reads as QB unlimited, RB max 8,
WR max 10, TE max 5, K max 2. Keying is inferred from the values, not
documented — **treat as high-confidence inference, not fact.**

### 3.3 Scoring

| What | Path |
|---|---|
| Scoring rules | `raw.settings.scoringSettings.scoringItems` (array) |
| Rank type the league uses | `raw.settings.scoringSettings.playerRankType` (`"PPR"` \| `"STANDARD"`) |
| Format | `raw.settings.scoringSettings.scoringType` (e.g. `"H2H_POINTS"`) |
| Tiebreakers | `raw.settings.scoringSettings.matchupTieRule`, `.matchupTieRuleBy` |

Each `scoringItems[j]`:

```json
{ "statId": 53, "points": 0.0, "isReverseItem": false,
  "leagueRanking": 0.0, "leagueTotal": 0.0,
  "pointsOverrides": { "1": 0.5, "2": 0.5, "3": 0.5, "4": 1.0, "15": 0.5 } }
```

**Two gotchas here, both VERIFIED live, and both of which break a naive
"read `points` for statId 53" PPR check:**

1. **`scoringItems` may omit a statId entirely** when the league scores it 0.
   League 899513 has **no** entry for statId 53 at all.
2. **`pointsOverrides` can carry the real value while `points` is `0.0`.**
   League 1241838 (2026) scores statId 53 as `points: 0.0` with
   `pointsOverrides: {"1":0.5,"2":0.5,"3":0.5,"4":1.0,"15":0.5}` — a half-PPR
   league with a TE premium. `detectScoringFormat()` in `js/espn.js` reads only
   `points` and would report this league as **"Standard"**, which is wrong.

   `pointsOverrides` keys are **defaultPositionId** (1=QB, 2=RB, 3=WR, 4=TE,
   15=TQB), not lineupSlotId — under the slot namespace those keys would be
   TQB/RB/RB-WR/WR/DP, which makes no sense for a league whose used slots are
   0/2/4/6/16/17/20/21/23. High-confidence inference, not documented.

   Effective points for a player = `pointsOverrides[String(defaultPositionId)]
   ?? points`.

### 3.4 Draft settings

All under `raw.settings.draftSettings` (VERIFIED live):

| What | Path | Observed |
|---|---|---|
| Draft type | `.type` | `"SNAKE"`, `"AUCTION"` (`"OFFLINE"` reported elsewhere, UNVERIFIED) |
| **Seconds per pick** | **`.timePerSelection`** | `60`, `120` |
| Draft order (team ids, round 1) | `.pickOrder` | `[6,3,2,5,8,10,1,11,9,4]` |
| Scheduled start (epoch ms) | `.date` | |
| Room opens (epoch ms) | `.availableDate` | |
| Auction budget | `.auctionBudget` | `200` |
| Keepers allowed | `.keeperCount`, `.keeperCountFuture` | |
| Keeper deadline (epoch ms) | `.keeperDeadlineDate` | |
| Keeper ordering | `.keeperOrderType` | `"TRADITIONAL"` |
| Order source | `.orderType` | `"MANUAL"` |
| Trading during draft | `.isTradingEnabled` | |

**The field is `timePerSelection`, not `secondsPerPick`.** Units are seconds
(60 / 120 observed, matching ESPN's UI options). It is present even in auction
leagues, where it is the nomination/bid clock.

`pickOrder` was present in every response observed and its length equalled
`settings.size`. It gives round 1; derive later rounds from
`draftSettings.type` (reverse on even rounds for `SNAKE`). `js/espn.js` already
surfaces it as `draft.pickOrder` and defaults `type` to `'SNAKE'`.

---

## 4. Position id and lineup slot id maps

**These are two separate numbering schemes and they do not agree.** `QB` is
`defaultPositionId 1` but `lineupSlotId 0`. Mixing them silently produces
plausible-looking wrong positions.

### 4.1 `defaultPositionId` — a player's primary position

Derived empirically (VERIFIED live) by cross-tabulating `defaultPositionId`
against `eligibleSlots` across all 2876 players in the 2025 `players_wl` dump,
and confirmed against the synthetic team entities:

| id | position | evidence |
|---|---|---|
| 1 | QB | 142 players, eligibleSlots `[0,7,20,21]` |
| 2 | RB | 300 players, `[2,3,7,20,21,23]` |
| 3 | WR | 429 players, `[3,4,5,7,20,21,23]` |
| 4 | TE | 218 players, `[5,6,7,20,21,23]` |
| 5 | K | 75 players, `[17,20,21]` |
| 7 | P | 50 players, `[18,20,21]` |
| 9 | DT | 327 players, `[8,11,15,20,21]` |
| 10 | DE | 313 players, `[9,11,15,20,21]` |
| 11 | LB | 290 players, `[10,15,20,21]` |
| 12 | CB | 366 players, `[12,14,15,20,21]` |
| 13 | S | 270 players, `[13,14,15,20,21]` |
| 14 | HC (head coach) | exactly 32, `[19,20,21]`, named `"Falcons Coach"` |
| 15 | TQB (team QB) | exactly 32, `[1,20,21]`, named `"Falcons TQB"` |
| 16 | D/ST | exactly 32, `[16,20,21]`, named `"Falcons D/ST"` |

Ids `0`, `6`, `8` were **not present** in the 2025 pool and are **UNVERIFIED**.

**This map is not the same as espn-api's `POSITION_MAP`.** espn-api's
`POSITION_MAP` is the *lineup slot* map (§4.2); its `Player.position` is derived
from `eligibleSlots`, not from `defaultPositionId` (`player.py`: it walks
`eligibleSlots` and takes the first non-25, non-`/` entry). If you index
`POSITION_MAP` with a `defaultPositionId` you get garbage (a QB would read as
`"TQB"`).

**Where the project already has this:** `js/espn.js` line 16 —
`export const POSITIONS = { 1:'QB', 2:'RB', 3:'WR', 4:'TE', 5:'K', 16:'DST' }`.
That is **correct** for the fantasy-relevant subset. It is incomplete: it lacks
`7:'P'`, `9:'DT'`, `10:'DE'`, `11:'LB'`, `12:'CB'`, `13:'S'`, `14:'HC'`,
`15:'TQB'`, which matter only for IDP / TQB / coach leagues. `js/season.js`
line 80 consumes it via `espn.POSITIONS[p.defaultPositionId]`.

Synthetic (non-human) player ids follow a fixed formula — VERIFIED live across
all 32 teams each:

```
D/ST     player id = -16000 - proTeamId    // Falcons D/ST = -16001
Head coach         = -14000 - proTeamId    // Falcons Coach = -14001
Team QB (TQB)      = -15000 - proTeamId    // Falcons TQB   = -15001
```

Draft picks and rosters carry these negative ids directly (e.g. a real pick had
`playerId: -15002`). Any code that assumes positive player ids will break.
The same mapping is published at
`settings.proTeams[i].teamPlayersByPosition`, e.g. KC:
`{"16": -16012, "14": -14012, "15": -15012}` — keyed by `defaultPositionId`.

### 4.2 `lineupSlotId` — roster slots

Applies to `eligibleSlots`, `lineupSlotCounts` keys, `filterSlotIds`,
`roster.entries[].lineupSlotId`, and `draftDetail.picks[].lineupSlotId`.
CORROBORATED — espn-api `constant.py` `POSITION_MAP`, and consistent with every
live payload observed:

| id | slot | id | slot |
|---|---|---|---|
| 0 | QB | 13 | S |
| 1 | TQB (team QB) | 14 | DB |
| 2 | RB | 15 | DP (defensive player) |
| 3 | RB/WR | 16 | D/ST |
| 4 | WR | 17 | K |
| 5 | WR/TE | 18 | P |
| 6 | TE | 19 | HC (head coach) |
| 7 | OP (offensive player / superflex) | 20 | BE (bench) |
| 8 | DT | 21 | IR |
| 9 | DE | 22 | *(unused; empty in espn-api)* |
| 10 | LB | 23 | FLEX (RB/WR/TE) |
| 11 | DL | 24 | ER |
| 12 | CB | 25 | Rookie *(a flag inside `eligibleSlots`, not a real slot)* |

Verification highlights: `filterSlotIds:[2]` returned only
`defaultPositionId: 2` (RB); `[16]` only D/STs; `[17]` only
`defaultPositionId: 5` (K); `[0]` only `defaultPositionId: 1` (QB). The
eligibleSlots cross-tab in §4.1 independently reproduces 0/2/3/4/5/6/7/17/18/
19/20/21/23 and the IDP block 8–15.

**Where the project already has this:** `js/espn.js` lines 18-22,
`SLOT_LABELS`. It is **correct** as far as it goes and covers 0-21 and 23. It
omits `22`, `24` (ER) and `25` (Rookie). Companion map `SLOT_ELIGIBILITY`
(lines 25-29) is a project-authored policy table, not an ESPN fact — the
authoritative eligibility for a given player is `player.eligibleSlots`, which
should be preferred wherever available. `js/season.js` uses
`espn.SLOT_LABELS[e.lineupSlotId]`, and both files hardcode `BENCH_SLOT = 20`
/ `IR_SLOT = 21`, which matches.

---

## 5. Bye weeks and the pro-team map

### 5.1 Endpoint (VERIFIED live)

Season-level, **no league id and no auth needed**:

```
GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}?view=proTeamSchedules_wl
```

Response: `{ "display": {...}, "settings": { "proTeams": [ ... ] } }` — 33
entries (32 NFL teams plus id 0 = free agency).

Each `settings.proTeams[i]`:

| What | Path |
|---|---|
| Pro team id | `.id` |
| **Bye week** | `.byeWeek` |
| Abbreviation | `.abbrev` |
| City | `.location` |
| Nickname | `.name` |
| Full schedule | `.proGamesByScoringPeriod` (map: scoringPeriodId → `[game]`) |
| Synthetic entity ids | `.teamPlayersByPosition` (`{"16": dstId, "14": hcId, "15": tqbId}`) |

So bye weeks are exactly what `fetchByeWeeks()` in `js/espn.js` already does:

```js
const byes = {};
for (const t of data.settings?.proTeams || []) if (t.byeWeek) byes[t.id] = t.byeWeek;
```

`id: 0` ("FA") has `byeWeek: 0`, so the truthiness check correctly drops it.

A per-week schedule entry inside `proGamesByScoringPeriod` carries
`homeProTeamId`, `awayProTeamId`, `date` (epoch ms) — the bye week is simply the
scoring period with no entry, so `byeWeek` can also be derived if it is ever
missing.

Live 2026 byes (for sanity-checking your own fetch):

```
ATL 11  BUF 7   CHI 10  CIN 6   CLE 11  DAL 14  DEN 10  DET 6
GB  11  TEN 9   IND 13  KC  5   LV  13  LAR 11  MIA 6   MIN 6
NE  11  NO  8   NYG 8   NYJ 13  PHI 10  ARI 14  PIT 9   LAC 7
SF  8   SEA 11  TB  10  WSH 7   CAR 5   JAX 7   BAL 13  HOU 8
```

### 5.2 proTeamId → abbreviation

VERIFIED live from `proTeamSchedules_wl` 2026, and byte-for-byte identical to
espn-api's `PRO_TEAM_MAP` and to `PRO_TEAMS` in `js/espn.js` (lines 31-37):

```
0  FA/None   9  GB    18 NO    27 TB
1  ATL      10  TEN   19 NYG   28 WSH
2  BUF      11  IND   20 NYJ   29 CAR
3  CHI      12  KC    21 PHI   30 JAX
4  CIN      13  LV    22 ARI   31 (unused)
5  CLE      14  LAR   23 PIT   32 (unused)
6  DAL      15  MIA   24 LAC   33 BAL
7  DEN      16  MIN   25 SF    34 HOU
8  DET      17  NE    26 SEA
```

Ids 31 and 32 do not exist. The existing `PRO_TEAMS` map in `js/espn.js` is
correct and complete.

**Gotcha (VERIFIED live): `abbrev` casing is inconsistent across seasons.**
Season 2026 returned `"ATL"`, `"WSH"`, `"LAR"`; season 2025 returned `"Atl"`,
`"Wsh"`, `"LAR"` — mixed case. Prefer the hardcoded `PRO_TEAMS` map, or
`.toUpperCase()` whatever the API returns.

---

## 6. Summary of gotchas that affect live-draft code

1. **A `sort*` clause is mandatory in `x-fantasy-filter`.** Without one, `limit`
   and `filterStatus` both yield `players: []`. VERIFIED.
2. **`filterStatsForTopScoringPeriodIds.value: 0` yields `players: []`.** Use
   `>= 1` or omit. VERIFIED.
3. **"Available" is `filterStatus: ["FREEAGENT","WAIVERS"]`.** `["FREEAGENT"]`
   alone returned zero in one real league. VERIFIED.
4. **`defaultPositionId` ≠ `lineupSlotId`.** QB is 1 in one and 0 in the other.
   `filterSlotIds` and `lineupSlotCounts` use slot ids; `positionLimits` and
   `pointsOverrides` use position ids.
5. **ADP is a flat `170.0` sentinel for past seasons.** Only trust
   `ownership.averageDraftPosition` for the current season; `adp > 0` does not
   catch this.
6. **Negative player ids are normal** (D/ST `-16000-teamId`, HC `-14000-teamId`,
   TQB `-15000-teamId`) and appear in real draft picks.
7. **`scoringItems[].pointsOverrides` can hold the real PPR value while
   `points` is `0.0`,** and statId 53 may be absent entirely. The current
   `detectScoringFormat()` misreports league 1241838 (half-PPR + TE premium) as
   "Standard".
8. **`bidAmount` is `0` in snake drafts** — detect auction via
   `settings.draftSettings.type`.
9. **Seconds per pick is `draftSettings.timePerSelection`.**
10. **Query through `/leagues/{id}`** so `appliedTotal` reflects your league's
    scoring; `leaguedefaults/3` gives ESPN default PPR and a far larger payload.
11. **`injuryStatus` is often absent** and `injured` is not a
    questionable/doubtful indicator.
12. **`draftDetail.inProgress === true` during a live draft is UNVERIFIED.**
    Drive the polling loop off `picks.length` and `drafted !== true`.
