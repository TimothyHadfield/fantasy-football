# Main menu (leagues, earlier seasons, accounts) — plan

> **Tim asked (2026-10-10):** "I want to make a main menu that is outside all of our current sections where the user can add different leagues to their account as well as look into past leagues aswell. To go to this main menu you will click on the fantasy button in the top left. If you go inside any specific league it will look just like how the cite currently is but the information will reflect the information that is specific for that leauge."
> **Instruction:** build (no "don't build yet").

**Status:** Phases 1 and 3 BUILT 2026-10-10 (see BUILT below) · phase 2 (accounts for anyone) NOT built; authorized by his "Anyone can sign up" answer.

## Decided by Tim
- 2026-10-10 (question box) · Accounts: **"Anyone can sign up"** (not just his account).
- 2026-10-10 · Past leagues = **earlier seasons** of each league (2025, 2024, …).
- 2026-10-10 · Opening the site lands in the **last league**, as today; the brand goes out to the menu.

## The answer (one sentence)
A new page `leagues.html` holds the list of leagues and their seasons; picking one writes the existing single connection slot and reloads into the site as it is today, with the handful of single-slot browser keys parked and restored per league-season; the cloud gives every account its own private space, and Tim's existing cloud data stays exactly where it is.

## Blockers / deciding constraints
- **No live data is moved or deleted** (standing rule). Tim's cloud documents stay at `leagues/{id}/seasons/{season}`; his laptop's localStorage keys stay as they are.
- $0: Firestore free tier, no card. More accounts = more reads/writes against one free quota.
- The site reads ONE league through module globals (`espn.configure`, `ff.connection`). Pages do not react to a league change. So a switch is a navigation (full reload), never an in-page swap.

## What the evidence says
- Almost all browser storage is already keyed by league and season (`ff.weeks.*`, `ff.snap.*`, `ff.projhist.*`, `ff.decisions.*`, `ff.value.*`, `ff.cloud` maps). Single slots: `ff.connection`, `ff.config`, `ff.prefs`, `ff-draft-room-v1`, `ff-draft-history-v1`, `ff-draft-review-v1`. · *read from code* (Explore report 2026-10-10: connection.js:17/19, prefs.js:13, draft-page.js:53/54/1145).
- `ff.prefs` holds league-specific ids globally (`analysis.team`, `trade.team`, `trade.custom`, `trade.assumed`, `waivers.team`, `stats.highlight`, `schedule.forecastTeam`, `*.week`). · *read from code*.
- ESPN serves earlier seasons and lists them: `status.previousSeasons` on league 1241838 = 2017…2025; the 2025 season endpoint answers 200. · *measured* (curl, 2026-10-10).
- Every ESPN URL already takes `config.season`. Year assumptions to guard: `js/proj-trend.js:59` loads `data/baselines/2026-preseason.json` for any season; `draft-page.js:150` uses the calendar year; auto-sync and capture fire for any live connection; value baseline is built from weeks left. · *read from code*.
- Cloud: rules allow one hard-coded uid for everything; `users/<uid>` is `{leagueId, season, teamId, updatedAt}` written whole; `syncUp` refuses any uid but `ownerUid`. Firebase CLI on this laptop is logged in as the project owner. · *read from code / measured (`firebase login:list`)*.
- The header is static markup in 10 html files; `tests/nav-check.mjs` reads only `header nav a`. · *read from code*.

## What exists today
One league at a time: `#connLeague` is typed once (shown only while disconnected); the phone adopts the account's profile league. No season choice. No way back to a league list.

## Options
| Option | What it is | Cost | How it fails |
|---|---|---|---|
| **A. Park and restore (chosen)** | `js/leagues.js`: a list `ff.leagues`; on switch, copy the single-slot keys to `<key>@<league>-<season>`, restore the target's, write `ff.connection`, navigate | Small; pages, prefs.js and ~40 test files untouched | A tab left open on league A writes prefs after league B was opened in another tab → A's last pref change lands in B's set. Accepted (one user, one tab is the norm); the menu re-reads on focus. |
| B. Namespace every pref key by league | Change `prefs.js` scope + every page | Large; every page and test | Misses one key → silent leak |
| C. League in the URL (`?league=`) on every link | True multi-tab | Very large; every link and deep link | Broken links everywhere |

Cloud:
| Option | What it is | Cost | How it fails |
|---|---|---|---|
| **P. Per-account private space (chosen)** | Owner uid keeps `leagues/{id}/…` (no move). Every other account: `users/{uid}/leagues/{id}/seasons/{season}/…`, readable and writable only by that uid | cloud.js path root by uid; rules +1 match | Two members of one league each store a copy (more quota) |
| Q. One shared copy per league | `leagues/{id}` readable by "members" | Needs a membership proof ESPN does not give us | Anyone who knows a league id could read or overwrite it |

## Recommendation (ranked)
1. If only one thing is built, build **Phase 1** (menu + switching on this device): it is the whole of what Tim sees.
2. Phase 3 (earlier seasons behave) alongside it — different files.
3. Phase 2 (accounts for anyone) after phase 1 is merged — same files as phase 1.

## Deliberately NOT planned
- ~~Moving Tim's cloud data to the new layout~~ · standing rule; nothing gains from it.
- ~~Shared league copies between accounts~~ · no way to prove membership; privacy.
- ~~Email/password accounts~~ · Google sign-in exists; nothing asked.
- ~~Non-ESPN leagues (Yahoo, Sleeper)~~ · not asked ("don't import features").
- ~~Cross-league views (all my teams on one screen)~~ · not asked.
- ~~Deleting a league's stored data when it is removed from the menu~~ · remove only takes it off the list; data stays (nothing is ever deleted).

## How this could be wrong
- A page keeps league state somewhere not in the parked list → open league A, set every remembered choice, open league B: assert none of A's team/player ids are in B's storage (test, phase 1).
- A finished season breaks a page (no current week) → open 1241838 season 2025 headlessly on all nine pages: no console errors, no blank page (phase 3).
- A stranger fills the free quota → Firestore stops for the day; the site falls back to the laptop's own ESPN reads. Flagged to Tim, not solvable at $0 beyond rules that confine each account to its own space.
- The profile's whole-document write erases the league list → merge write + test (phase 2).

## Phases (each ships on its own)

### Phase 1 — the menu and switching (this device)
- `js/leagues.js` (pure + storage, tested): `list()`, `add({leagueId, season, name, teamId})`, `remove(key)` (list only), `current()`, `open(key)` = park → restore → write `ff.connection`/`ff.config` → return the URL to go to; `PARKED = ['ff.prefs', 'ff-draft-room-v1', 'ff-draft-history-v1', 'ff-draft-review-v1']`. First run seeds the list from the saved connection, parks nothing. A league-season never opened before starts from a copy of the current `ff.prefs` with the league-specific keys removed (`*.team`, `*.week`, `trade.custom`, `trade.assumed`, `stats.highlight`, `schedule.forecastTeam`, `decisions.*`, `draft.team.*`) and `<page>.source` = live; display prefs (switches, sort) carry over.
- `leagues.html` + `js/leagues-page.js`: the list (league name, team count, "You are" team, seasons as buttons — current first, earlier ones from ESPN's `previousSeasons`, read when the league is added and kept in the list), an "Add a league" id field (the same probe the connection bar uses: bridge → cloud → direct), Remove behind a small control. No top nav on this page (it is outside the sections); the brand is plain text here. Fits 393 and 1280 with no page scroll for a handful of leagues (the list scrolls inside itself). Load `design-taste` first.
- Brand: `<a class="brand" href="leagues.html">Fantasy Football</a>` in the 10 pages + CSS so it looks as it does now.
- `connection.js`: after a successful connect, `leagues.add(...)` keeps the list current (name, teams, team). Nothing else changes; a league typed into the old disconnected bar still works.
- Tests: new `tests/test-leagues.mjs` (park/restore round trip; no id leaks; seed from an existing connection; remove keeps data; unknown/corrupt storage), `tests/leagues-check.mjs` (page: list, add via stubbed probe, open navigates, phone + laptop), nav-check/page lists updated, counts.json.
- Done when: on the laptop, add 1241838, open season 2026 → site as today; back to menu via the brand; open 2025; `trade.custom` set in 2026 is not in 2025's prefs and is back when 2026 is reopened. Screenshots 393 and 1440.

### Phase 3 — earlier seasons behave (parallel with phase 1)
- No auto-sync to the cloud, no capture, no "Week N not saved yet" chip for a season that is not `bridge.currentSeason()`.
- `proj-trend.js`: the preseason baseline applies only to its own season (no arrows / no preseason value otherwise).
- Value: no baseline is minted for a finished season (weeks left = none → switch hidden, cards without Value). Verify, fix if it mints.
- Each page on a finished season: no console error, no blank panel; a panel that needs weeks to come says so in its existing empty-state words (no new sentences where an existing one fits).
- Draft room practice stays on the calendar year (it is not league data).
- Tests: a finished-season fixture through the existing stubs where cheap; headless pass on 1241838/2025 for all pages.

### Phase 2 — accounts for anyone (after phase 1 is merged)
- Rules: owner block unchanged; add `match /users/{uid} { allow read, write: if request.auth.uid == uid; match /{rest=**} { same } }`. Deployed with `firebase deploy --only firestore:rules` from `firebase/` by the main chat after reading the diff; old rules kept in git.
- `cloud.js`: path root = `leagues/…` for `ownerUid`, `users/{uid}/leagues/…` for anyone else; `syncUp` no longer refuses other accounts; profile becomes `{leagueId, season, teamId, leagues:[{leagueId, season, name, teamId, seasons}], updatedAt}` written with merge semantics (read-modify-write) so the list survives.
- Menu: signed in → the account's list and this device's list are merged (union; newest `teamId` wins); the phone shows the account's leagues and opens any of them from the cloud copy.
- Sign-in wording for a non-owner account loses "not the account this league belongs to".
- Tests: test-cloud / test-cloud-wiring extended (non-owner path, list survives a profile write, owner path byte-identical to today).
- NOT verifiable here: a second real Google account. Tim (or a friend) signs in once.

## After review (plan-reviewer, 2026-10-10) — these OVERRIDE the phases above where they differ
1. **`ff.prefs` is stamped with its league-season** (`js/prefs.js`), and a page whose stamp no longer matches storage (another tab or a back-button page of the league left behind) never writes its whole stale object over the new league's prefs: its write is dropped and its cache re-read. Test fails first. (~~"prefs.js untouched"~~ superseded.)
2. **The earlier-season guards ship WITH phase 1**, in the same builder that owns `connection.js`: no auto-sync, no capture, no "not saved yet" chip, and no profile write for a season that is not `bridge.currentSeason()`. (First-copy-wins cloud data must never be minted for an old season.)
3. **Builder split by file, not by phase:** A = data layer (`js/leagues.js`, `connection.js`, `prefs.js`, `backup.js`), B = the menu page and the brand link (`leagues.html`, `js/leagues-page.js`, the 10 html headers, CSS) against A's written API, C = pages on a finished season (`proj-trend.js`, Value minting, page-level empty states; no `connection.js`).
4. **Seasons offered:** only 2018 and later, and only those ESPN lists in `previousSeasons` (older seasons live on a different ESPN endpoint the site does not build). C measures one week's read on a past season.
5. **Parked keys = `ff.prefs` and `ff-draft-review-v1` only.** Practice-draft room and history stay shared across leagues (not league data).
6. **`open()` writes only `{leagueId, season, teamId}`** to the connection slot, so the bar probes again and never says "Connected" unprobed. A park write that throws (full browser) aborts the switch with a reason.
7. **Remove sticks:** removing the league that is open also empties the connection slot (stored league data stays).
8. **Import:** a backup file's prefs are merged only when the file's league-season is the open one.
9. **Phone / rule 20:** on the synced copy the menu makes no ESPN request; it shows the seasons already in the list. Earlier seasons on the phone wait for phase 2 (and a private league's old season only after it has been sent from the laptop).
10. **Phase 2 additions:** the account's league list lives in its own document (`users/{uid}/menu/leagues`), never in the four-field profile (an old cached build writes that whole); the "sent" marks (`ff.cloud`, `ff.cloud.decisions`, `ff.cloud.projhist`) get keyed by account; the path root is chosen only after auth has answered (test with a transport whose user starts null); stored bytes do not reset daily — say so to Tim.

## Questions for Tim
a. ~~Who is it for?~~ → anyone can sign up (2026-10-10).
b. ~~Past leagues?~~ → earlier seasons (2026-10-10).
c. ~~Landing?~~ → last league (2026-10-10).
d. Each account's cloud copy is private to that account (two friends in one league each keep their own copy). · assumed yes; Tim to confirm.
e. Page name and words on the menu ("Leagues", "Add a league", "Remove") · plainest; his to change.
f. A stranger could use up the free daily cloud quota; nothing at $0 fully prevents it. · accepted risk? assumed yes for now (flag once).

## BUILT 2026-10-10 (phases 1 and 3; phase 2 NOT built)
- Shipped: `js/leagues.js` (list `ff.leagues` = `{v:1, leagues, removed, probe, source}`; park/restore of `ff.prefs` + `ff-draft-review-v1` under `<key>@<league>-<season>`; `lookup`, `open`, `remove`), prefs stamp (`@league`) in `js/prefs.js`, earlier-season guards in `js/connection.js` (no auto-sync, capture, chip, profile write; Send to phone hidden; the year shown after the league name in the bar), backup import guard (1883886). `leagues.html` + `js/leagues-page.js`, brand link on the 10 pages (b4975c9). Finished-season pages: preseason arrows only on their own season, no Value lines minted/kept/synced for an earlier season, Analysis and Trade empty-state words (e64daa9). Main chat: `SEASON_MIN` 2019, the menu fills in earlier seasons for a league that came in through the bar (`fillSeasons`), neutral names in the test stub.
- Plan was wrong about: "2018 and later" — measured on 1241838: 2019–2025 answer rosters/schedule/draft, 2018 is 401. `decisions.noise`/`decisions.source` carry across leagues (builder's call); keys containing `.live:` are league-specific too.
- Verified: headless WebKit at 393 and 1440 on 1241838 — connect in the bar, brand → menu (2026…2019 listed), open 2025 (bar says "· 2025", no chips, no `ff.value.*` key), brand back. Suites: test-leagues 139, leagues-check 72, nav-check 212, test-cloud-wiring 265, test-capture 186, test-backup 80, test-past-season 49, test-proj-trend 74, wv-test 1284, proj-changes-check 110, text-audit 10/10.
- Still open: phase 2 (accounts, incl. review item 10). On a finished season, left for Tim: Players "Next 3" over playoff weeks, Analysis draws playoff weeks as projections, Home injury report, Draft "Value difference" falls back to place, Schedule Simulate over an empty table, Trade finder on a typical week. Known limits (builder A): a league typed into the old bar while prefs are stamped for another league is not re-parked; prefs restored from a backup with no league open are adopted by the next league. `ff-draft-review-v1` is written for an earlier season (parked per league-season). NOT verified: iPhone, private league through the bridge, phone synced copy, a second account.

## Sources
- ESPN league endpoint `…/seasons/2026/…/leagues/1241838?view=mStatus` (`status.previousSeasons`), measured 2026-10-10.
- Explore report in this chat (storage keys, cloud paths, year assumptions).
