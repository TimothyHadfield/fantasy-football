# Notifications — plan

> **Tim asked (2026-10-11):** "I want to make a notifications section which basically helps the user with basic instrucitons or important issues or upcoming decisions or whatnot. This will be things like suggested players to pick up, warnings for future weeks that have missing positions or if you're currently starting someone you shouldn't, messages on any trade notifications you have, or elete trade opportunities, these will all be shown in the notifications setting. Additionally for the easy ones like the weekly lineup, make it so you just have to click a button to automatically change it for your team, or bring you to the specific player on the waivers, or the trade notification on the cite."
> **Instruction:** build (no "don't build yet").

**Status:** BUILT 2026-10-11, all three phases (see BUILT at the end). The real ESPN lineup write and the real trade-offer payload are NOT verified.

## The answer (one sentence)
One new page, `notifications.html`, lists what needs doing for YOUR team in this league, most urgent first, each line with one button that goes to the exact place (the player on Players, the deal on Trade, ESPN) — every line is worked out by an engine the site already has, so the list can never disagree with the page it points to.

## Blockers / deciding constraints
- **Changing a lineup is a WRITE to ESPN.** The site has never written to ESPN. `extension/manifest.json` holds the READ host only, and `extension/content-espn-trade.js` says "NEVER SUBMIT … That is the whole safety model". A one-click lineup change overturns that on purpose → Tim's call (Question A).
- **No extension on an iPhone.** The phone reads the cloud copy. Whatever is decided for the laptop, on the phone the lineup button can only open ESPN's lineup screen.
- **Trade offers waiting for you** live in ESPN's `mPendingTransactions` view, which answers only for a logged-in owner. Measured 2026-10-11: the public league 1241838 accepts the view and returns no `pendingTransactions` key. Its real shape cannot be measured without Tim's own login (rule: never use his account) → built defensively, and listed under NOT verified until he has an offer waiting.
- Money $0: nothing here costs anything. No push notifications to the phone (would need a server or a paid service) — not planned.
- Earlier seasons are read-only and finished → the page says so and lists nothing.

## What exists today (reuse, no new maths)
| Notification | Engine already there | Button goes to |
|---|---|---|
| Start A over B this week | `js/start-sit.js` `startSit` (as on Home's own card, `js/home-page.js:409`) | change it (Question A) |
| Starting someone Out / on bye / on IR | same roster + `js/injury.js` `healthy`, bye weeks `season.fetchByeWeeks` | his row on Players |
| A coming week with a starting slot nobody can fill | `js/who-to-start.js` season index / `js/lineup-slots.js` `slotRows` + `fillSlots` over the weeks left | Players, that position |
| Suggested pick-ups | `js/waiver-gain.js` `gainBase` + `gainOf` (Players' Gain column) | `waivers.html?player=<id>` (`links.playerHref`) |
| Trade offers you have | NEW read: `mPendingTransactions` through the bridge, carried in the cloud copy | `trade.html?with=&get=&send=` (the deal priced on the site) + ESPN's own accept screen |
| Elite trade opportunities | `js/trade.js` `findTradesSliced` (Trade's ranked list) | the same deep link |
| Deadlines (trade deadline, waivers clear, lineup lock) | `home-page.js` `deadlineText`, `js/accept-by.js` | — |

## Options for the lineup button
| | What | Cost | How it fails |
|---|---|---|---|
| **1. Extension writes the swap** | One click → extension POSTs a lineup move to ESPN's write host with your login (`lm-api-writes.fantasy.espn.com … /transactions/`, type `ROSTER`, items `LINEUP` from slot → to slot). Laptop only. | New write-host permission (Chrome asks you to approve the updated extension once). Undocumented ESPN API. | ESPN changes the call → the button says it could not and opens ESPN. Cannot be tested by Claude: the first real click is Tim's. |
| 2. Open ESPN's lineup screen | One click → ESPN's team page for that week; you move the two players there. Works on phone and laptop today. | Two more taps on ESPN. | Nothing to break. |
| 3. Extension ticks it on ESPN's page | Like the trade helper: opens ESPN and clicks the move for you. | ESPN's lineup moves save the instant they are clicked, so this is a write anyway, and it breaks when ESPN's page changes. | Worst of both. Not recommended. |

## Recommendation (ranked)
1. **Phase 1: the page and every notification, with buttons that go to the place** (option 2 for lineups). Ships whole, on phone and laptop.
2. **Phase 2: trade offers you have** (new read; unverifiable until Tim has one).
3. **Phase 3: one-click lineup change through the extension** (option 1), if Tim says yes to Question A. Guard rails: only `LINEUP` moves, only his own team, only the current week, only players whose game has not started, one request per click, the result re-read from ESPN before the line disappears; anything else is refused inside the extension, not just the page.

## Decisions (Claude's, technical)
- Engine is pure: `js/notify.js` `buildNotes(inputs) → [{id, kind, level, title, detail, action}]`; `level` is `now` (this week, acts before a kickoff) · `soon` (a coming week) · `idea` (pick-ups, trades). `action` is `{label, href}` or `{label, lineup: [{playerId, from, to}], href}` (href = the fallback).
- A line disappears when its cause does. No dismiss button, no read/unread (not asked).
- The count beside the bell is the `now` + `soon` lines. Other pages show the count saved by the last visit to Home or Notifications (no extra ESPN reads on every page); the page itself always recomputes.
- Pick-ups: the top 3 free agents by Gain, only where Gain > 0. Elite trades: at most 3 from the ranked list, only deals the finder already marks as good for both sides; computed in slices after the cheap lines are on screen.
- Demo league shows sample lines; no account needed.

## Deliberately NOT planned
- Push notifications / emails / anything while the site is closed.
- Proposing, accepting or declining trades from the site (ESPN's own button, as today).
- Adds and drops from the site.
- Dismiss, snooze, history.

## How this could be wrong
- "Notifications setting" may mean a panel under the bell rather than a page (Question B).
- Tim may want the lineup button to fix the WHOLE lineup at once rather than one swap per line → the page gets one "Set best lineup" button above the swaps as well; cheap either way.
- The pending-trade shape is taken from community notes, not measured.

## Phases (each ships on its own)
### Phase 1 — page, engine, bell
- `js/notify.js` (pure) + `tests/test-notify.mjs`; `js/notifications-page.js` + `notifications.html`; bell + count in the top bar on every page; `tests/notify-check.mjs` (headless, demo + 1241838 season 2025 past-season empty state); nav-check and text ceilings updated.
### Phase 2 — trade offers you have
- `espn.js`/`bridge.js`/extension allow-list: `mPendingTransactions`; `season.buildCloudPayload` carries it; parser tolerant of missing fields; a line per offer.
### Phase 3 — one-click lineup (only on Tim's yes)
- Extension: write host permission, `SET_LINEUP` message with the guard rails above; `bridge.setLineup`; button state (working → done / could not, open ESPN). Tim reloads the extension once.

## Questions for Tim — ANSWERED 2026-10-11 (question box)
- **A.** May the site change your ESPN lineup for you, through the extension, with your ESPN login? → **"Yes, lineup only"**.
- **B.** Where does it live? → **"Bell in the top bar"** (a bell with a count on every page; clicking it opens the page).

## After review (plan-reviewer, 2026-10-11) — these OVERRIDE everything above where they differ
1. **Elite trades are NOT recomputed here.** The finder's inputs and its simulated re-rank are private to `js/trade-page.js:4577-4612` and a search takes 20–27 s. Instead the Trade page, when its ranked list finishes, SAVES its top deals; Notifications lists them with their age and links to `trade.html` (the ranked list). No saved deals → one line "Look for trades" → `trade.html`.
2. **One writer for the count.** Only `js/notify-load.js` writes it. Home does not. The bell shows the saved count while it is fresh (same league, season, team and week; under 3 hours old; no NFL kickoff since it was saved) and otherwise asks the loader to recompute in the background (reads go through the store, so a synced copy makes no ESPN request).
3. **Keys carry the league in their NAME** (so `js/leagues.js` parking is not involved):
   - `ff.notes.<leagueId>-<season>` = `{v:1, team, week, at, now, soon, idea}` (three counts; `at` epoch ms).
   - `ff.notes.trades.<leagueId>-<season>` = `{v:1, team, week, at, deals:[{withTeamId, withName, get:[{id,name}], send:[{id,name}], gain, theirGain}]}` (at most 3, only deals the finder marks good for both sides).
4. **"A slot nobody can fill" defined:** in a coming week, the best legal lineup from today's roster has a starting slot that is empty or filled by a man projected 0 (bye, Out, IR). Built on `js/forecast.js` `optimalLineup` / `js/lineup-slots.js`, NOT on `js/who-to-start.js` (a singleton bound to its page).
5. **Pick-ups are not cheap** (`gainBase` wants every remaining week's wire + rosters + floors, `js/waivers-page.js:2151-2161`): worked out after the cheap lines are on screen, from stored weeks where held; the builder measures the request count and reports it.
6. **Trade offers ride the schedule object** in the cloud copy (a new document kind is refused by `firebase/firestore.rules:87-92` for other accounts; the `valueBase` route at `js/season.js:2503-2505` is the model). `mPendingTransactions` is already on the extension's allow-list (`extension/background.js:75`). On the phone an offer is as old as the last sync and the line says so. Contract: `season.fetchPendingTrades()` → `[{id, withTeamId, get:[playerId], send:[playerId], proposedAt, expiresAt, fromMe}]` (`[]` when none or unreadable; never throws).
7. **Cut:** the deadlines row, a "Set best lineup" button, special sample lines for the demo league (the demo league simply gets whatever the engine finds in it).
8. **Lineup write, redesigned to keep the extension's own rule** (`extension/background.js:22-24, 506-510`: no write without a confirmation in the popup):
   - OFF by default. A switch in the extension popup, "Let the site set my lineup", turns it on once; after that it is one click on the site. A hostile page cannot write while it is off.
   - Accepted only from `https://timothyhadfield.github.io`, never localhost.
   - The extension finds the owner's own team itself (his ESPN member id against the league's team owners — this needs the `cookies` permission and the ESPN host, which Chrome will ask him to approve) and refuses any other team, any item that is not a `LINEUP` move, any week but the current one, more than 4 moves in one request. `isLeagueManager` is always false.
   - After the write the page re-reads the roster; the line goes only when ESPN shows the change. Any failure → "Could not change it" + the link to ESPN's lineup screen.
   - Contract: `bridge.canSetLineup()` → `Promise<boolean>`; `bridge.setLineup({leagueId, season, week, teamId, moves:[{playerId, fromSlotId, toSlotId}]})` → `Promise<{ok, reason?}>` (ESPN numeric lineupSlotIds; bench 20).
   - **Cannot be tested by Claude** (never his account): the first real click is Tim's, on a move he can undo on ESPN before kickoff.
## BUILT 2026-10-11 (five builders in worktrees, merged by the manager)
- **Shipped:** page + engine + loader (c0bd9d2), bell (f0cdb11), Trade saves deals (94fba15), trade offers read (c1afadb), extension lineup write, version 0.5 (5b1801f).
- **Where the plan was wrong:** (a) "good for both sides" saved NOTHING on the real league (0 of 40 ranked deals; the finder lets the other manager lose a little) → rule changed by the manager to "you gain AND the pair's net increase > 0" (`worthSaving` in `js/notify-trades.js`); Tim told. (b) A saved deal's button now opens THAT deal on Trade's custom builder (`links.dealHref`), not the plain page. (c) The public league 1241838 is LIVE at week 5 of 2026, not finished. (d) On the synced copy a roster read left to find the byes itself asks ESPN when the copy has none, and a wire week the copy lacks falls through to ESPN → the loader hands the copy's byes to every roster read and asks only for weeks the copy holds (`cloud.weeks`); caught by `test-cloud-wiring` profile-phone / account-phone after the bell was merged. (e) The SWID cookie reads through the existing read host, so no wider ESPN host permission was needed (only `cookies` + the write host).
- **Verified how:** each builder fail-first + headless; after the merge the manager ran test-notify 52, notify-check 93, bell-check 145, test-notify-trades 67, test-pending 95, test-lineup-guard 357, test-bridge-lineup 46, test-extension 334, nav-check 225, test-cloud 229, test-cloud-wiring 329, test-past-season 84, touch-check 353, text-audit, and looked at the page on 1241838 (team picked, WebKit 393 and 1440): two coming-week holes, three pick-ups, bell count 2, no page scroll, no overflow.
- **NOT verified:** the real ESPN lineup write (and how ESPN treats an extension's Origin header); the real `pendingTransactions` payload; a non-empty saved-deals note on a real league; the synced phone copy with real data; Tim's iPhone. A cold bell refresh costs 17–18 ESPN reads once per 3 hours (5 with rosters stored).
- **Tim's steps:** reload the extension at edge://extensions (or chrome://extensions), open its popup, turn on "Let the site set my lineup".
- **Claude's wording/visual choices (his to change):** headings "This week / Coming weeks / Ideas"; buttons "Change it", "Open ESPN", "See him", "Find one", "Open it", "Open Trade"; red count pill on a green outline bell; amber edge on this-week lines; pick-ups priced over the next 3 weeks; offers to you count as this week, your own offers as ideas.

9. **Checks every builder owes:** the bell fits beside the nine page links at 393 px; the page does not scroll (the list scrolls inside); no ESPN request on a synced copy; text within `tests/text-ceilings.json`; `pastSeason` exported from `js/connection.js` rather than re-derived.
