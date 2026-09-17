# tests

Headless suites for the site. They boot the **real** pages and import the
**real** modules from [`../js`](../js) — nothing here reimplements site logic,
so a rename or a broken selector fails a test rather than sailing past it.

**Over 10,000 assertions in all, across 33 suites.** A full run at the end of
2026-09-17 was green in about 320 seconds, and GitHub Actions runs `npm test`
on every push (`.github/workflows/test.yml`), plus the four suites below that
report pages or scenarios rather than a count.

Not suites, and deliberately left out of `npm test`: `fc-dump.mjs` and
`sim-dump.mjs` (print panels, for diffing a refactor) and
[`text-audit.mjs`](text-audit.mjs), which boots every page on demo data and
counts the prose a reader is shown per panel — visible versus tucked inside a
closed "How this works" toggle. `node text-audit.mjs` or
`node text-audit.mjs trade.html`. It measured ~5,700 visible words before the
2026-09-16 declutter and ~1,050 after.

## Running them

```
cd tests
npm install
npm test
```

`npm test` runs [`run-all.mjs`](run-all.mjs), which prints one PASS/FAIL line
per suite with its assertion count and exits non-zero if any failed. To run a
subset, pass a substring:

```
node run-all.mjs fc wv      # only fc-test.mjs and wv-test.mjs
node fc-test.mjs            # or just run one directly
```

The only dependency is [`linkedom`](https://github.com/WebReflection/linkedom),
a DOM good enough to run the pages without a browser. Everything else is Node's
standard library.

Each suite runs in its own child process, and most of them fan out again into
one child per scenario. That is not neatness: an ES module initialises once per
process, and the page modules self-boot on import, so two page scenarios in one
process would see each other's DOM.

## The suites

| Suite | What it covers | Size |
| --- | --- | --- |
| [`test-pages-render.mjs`](test-pages-render.mjs) | Boots each page's real HTML with the real module scripts the page itself declares. Catches a missing element id, a typo'd `querySelector`, an import that doesn't resolve — the things unit tests miss and only a browser would show. Its default list is `index`, `stats`, `analysis`, `schedule`, `trade` and `summary`. | 6 pages |
| [`test-forecast.mjs`](test-forecast.mjs) | [`js/forecast.js`](../js/forecast.js): win probability, sigma calibration, optimal lineup, the win-total distribution, credible ranges. Known-good values plus brute force. | 68 |
| [`test-sim.mjs`](test-sim.mjs) | The Monte Carlo season simulation in [`js/forecast.js`](../js/forecast.js), **including the playoff bracket and the hybrid final placing** — that a team topping the table still averages a 2.25 finish once three one-week rounds are played out, that the bracket draws from its own RNG stream so asking for playoffs leaves the regular-season numbers byte-identical, and that a playoff tie goes to the higher seed. | 415 |
| [`test-projection.mjs`](test-projection.mjs) | [`js/projection.js`](../js/projection.js), the shared projection module. | 38 |
| [`test-trade-weekly.mjs`](test-trade-weekly.mjs) | **The biggest suite here.** The per-week measure in [`js/trade.js`](../js/trade.js), and its hand fixture is the owner's own complaint made falsifiable: three QBs rotating 18/15/15, each averaging exactly 16, against one steady 17. The season average prices them 48 against 51 and calls the single good QB better; week by week they are 54 against 51. Also the combo packer — that a combo is priced ONCE as one roster change, and that `naiveDelta` is the sum it refuses to report. | 4,016 |
| [`test-cloud.mjs`](test-cloud.mjs) | [`js/cloud.js`](../js/cloud.js): what is synced up, what comes back down, and how old it is. Runs against a fake transport that **enforces Firestore's real rules** rather than a Map that would agree with anything, and it is what MEASURES the 53 KB-a-week document size, against a fixture built at genuinely realistic size. | 190 |
| [`test-cloud-wiring.mjs`](test-cloud-wiring.mjs) | The cloud **wired in**: the substitution inside [`js/season.js`](../js/season.js) and the connection bar above it. That the order of preference is bridge → cloud → direct in both places, that with the bridge present the cloud **is not asked at all** (asserted with a read counter), that the Players page's wire comes down too, and that staleness is quoted per shape rather than flattened to one timestamp. | 147 over 12 scenarios |
| [`test-extension.mjs`](test-extension.mjs) | [`extension/background.js`](../extension/background.js) with chrome and fetch stubbed: URL injection, path traversal and bad origins refused before any request, plus the staged trade — that a stage expires and is consumed on read, and that `host_permissions` **deep-equals the read host alone**. Also that a D/ST's **negative** id (-16001…-16034) stages while other negatives are refused, and that a staged deal for a different screen is reported as a `mismatch` with team ids only. | 324 |
| [`test-bridge-settle.mjs`](test-bridge-settle.mjs) | **The race that leaked played weeks into trades.** A window whose extension hello arrives a tick AFTER the first ESPN read starts — the real order in Edge. With `bridge.settled()` the read goes through the extension; without it, it goes direct and a private league refuses it. | 7 |
| [`test-espn-tick.mjs`](test-espn-tick.mjs) | [`extension/content-espn-trade.js`](../extension/content-espn-trade.js) against a fake ESPN trade page whose store only a **dispatched click** can move, rendering `aria-checked` from it — so an implementation that wrote the attribute fails rather than passes. Asserts an already-ticked box is left alone (a checkbox is a toggle), that ids come off the headshot URL with the name as the D/ST fallback, that two men of one name are refused rather than guessed, and that **zero events reached Propose Trade, Cancel or the confirmation modal**. A deal staged for a different screen draws a badge naming both sets of team ids. | 82 |
| [`owner-names.mjs`](owner-names.mjs) | Real names instead of team names: the `members` → `owners[]` join by SWID in [`js/espn.js`](../js/espn.js). `primaryOwner` not assumed to be `owners[0]`, more members than teams, non-contiguous team ids, a two-owner squad, and a payload with no members degrading to the team name. | 55 |
| [`test-summary.mjs`](test-summary.mjs) | [`summary.html`](../summary.html) and the image it hands to the share sheet: LUCK, title %, loser %, that the footnotes **wrap rather than truncate** (the defect that cut “not the playoffs” off the caveat), that a saved “live” preference survives demo booting first, and that the two probability spellings are adapted the right way round. | 203 |
| [`touch-check.mjs`](touch-check.mjs) | The analysis grids on a screen with **no hover**. Boots the real page with `matchMedia` answering `(hover: none)`: the tap opens the card as a sheet instead of following the link, the sheet's link is the SAME href the cell carried, the tap does not ALSO drill into the team, and the identical click under a mouse is left completely alone. One scenario blanks a man's `playerId`, because the card has never depended on the link and must not start to. One is the card's own — half a season on a 390px screen: the Act row filled only for weeks with an actual recorded, and a thirteen-week run **wrapping onto balanced lines rather than scrolling**. Also covers [`js/touch-titles.js`](../js/touch-titles.js), including that a titled link or button is deliberately NOT swallowed. | 187 over 4 scenarios |
| [`test-snapshots.mjs`](test-snapshots.mjs) | [`js/snapshots.js`](../js/snapshots.js), the time machine's storage. Round-trips a week's reading through JSON, through an exported file and into an empty browser; proves a snapshot is a **copy** by moving the live season underneath one; covers a browser that blocks storage, a full one, an unreadable key and a file from a newer build; and covers the committed archive restoring a wiped browser without overwriting what it already held. | 123 |
| [`test-trade.mjs`](test-trade.mjs) | [`js/trade.js`](../js/trade.js): replacement level, the depth map and the trade finder. A hand-built two-team league where every answer is known by hand, then the real demo pool where **every offer is re-priced from the raw rosters** rather than read back off its own numbers. | 1,411 |
| [`fc-test.mjs`](fc-test.mjs) | The schedule page's forecast and simulation panels, against demo data and a stubbed live league — including no team set, the owner picking a team afterwards, switching team, a roster fetch that rejects, the **time machine** — that booting live records a reading unasked, that replaying a doctored one puts ITS numbers on screen rather than the live ones, and that the whole round trip costs no extra request — and a league declaring **four** playoff teams where the fallback is six, which fails if the field size read off ESPN's `scheduleSettings` is dropped at either of the two hops that used to drop it. | 796 over 13 scenarios |
| [`wv-test.mjs`](wv-test.mjs) | The Players page's wire: filtering (incl. FLEX), sorting, widening the span mid-load, switching source while requests are in the air, weeks that reject, an empty pool, a saved filter that is no longer valid. | 189 over 8 scenarios |
| [`cmp-check.mjs`](cmp-check.mjs) | The wire compared against your own roster — the worst man at each position, nobody set as you, ESPN refusing some or all roster weeks; and that refusals and "nobody set as you" are on screen, not inside the toggle. | 113 over 7 scenarios |
| [`taken-check.mjs`](taken-check.mjs) | The "Taken players" table: owners, per-squad positional ranks, nothing coloured, the two tables' independent filters, and landing a `?player=` link. Every rank is re-derived from the **rendered** Avg column, never from the stub's raw numbers — and one scenario gives two teams the SAME displayed name while keeping their ids, so a depth chart keyed on the label merges them and fails. | 224 over 5 scenarios |
| [`link-check.mjs`](link-check.mjs) | **The seam between pages.** `index.html`, `analysis.html` and `trade.html` make player links; `waivers.html` resolves them. Boots each, checks every link against the contract, then *follows* a sample and asserts each lands on that man. No single-page suite can see this, and it has now found a real defect twice — once on its first run, and once when the Trade page was added and its sample happened to pick a man who is also somebody's "Your QB2". | 135 |
| [`an-test.mjs`](an-test.mjs) | The analysis page: demo, a stubbed live league, weeks that reject, switching team and sorting, the two all-teams grids, the roster-detail swap, the hover card, a player ESPN gave no id for, and "Who to start, week by week" — whose marks are re-derived by rebuilding every week's lineup from `demo-rosters.js` through `optimalLineup`, never read back off the page. | 834 over 14 scenarios |
| [`tr-test.mjs`](tr-test.mjs) | The Trade page: the depth map (its columns, its per-column tinting, the bar chips), the finder, every control, the per-offer week-by-week pop-up, and the best-combo list merged per manager. Asserts that a filter matching nothing **empties** the table rather than merely hiding it, and that **nothing fetches a week until the weekly measure's button is pressed** — not on load, and not when a remembered preference says weekly. Since 2026-09-16 also: the pop-up opens only on a click and fetches its own weeks; per week leads and the total is the sub-number (re-derived from each row's total); played weeks sit above a line, uncoloured, and out of the total; **Open in ESPN** is clicked with a `window.open` that returns null under `noopener` exactly as a browser does; the outcome message after that click; live mode opening on your own team; a hand-picked team surviving a week change; and no ESPN link from another manager's squad. linkedom does not run capture listeners first, so the click test shuts the pop-up before clicking. | 303 |
| [`hot-check.mjs`](hot-check.mjs) | Both greens on the Players page's wire — over the startable bar, and beating your own worst man that week — plus proof that pressing FLEX changes not one cell's colour. | 118 |
| [`opp-check.mjs`](opp-check.mjs) | Opponent strength on the stats page, against a synthetic league with no network at all. | 6 scenarios |
| [`stats-weeks.mjs`](stats-weeks.mjs) | The stats page at 1, 2, 3, 5 and 13 weeks of season — the early-season honesty rules: no fabricated zero std dev, no empty accuracy buckets, no percentage drawn from a handful of games. Close luck, luck score, S+L, LS and PS show **from week 1 with a ±** that is positive at 1 week and narrower at 13. Copies the repo to a temp dir and shortens the demo season to do it. | 6 checks |
| [`test-season-rules.mjs`](test-season-rules.mjs) | Raw ESPN payloads through [`js/season.js`](../js/season.js): a game is played only when ESPN's `winner` is decided (a week in progress with points on both sides is NOT played), a tie counts half a win in the standings, playoff-tier games are kept out of the regular season, waiver status survives the cloud round trip, `fetchByeWeeks`, the 60-second shared read, and the home page going live on a fresh device. | 93 over 7 scenarios |
| [`test-bye-rule.mjs`](test-bye-rule.mjs) | A player's projection is exactly 0 in his team's bye week — ESPN projects a D/ST at 3–7 there and sends null for a past one — on rosters, the wire and the synced copy; a bye-week null renders "Bye"; playoff weeks 15–17 are synced; the Stats page ranks and shows unrounded points. | 75 over 10 scenarios |
| [`home-winpct-check.mjs`](home-winpct-check.mjs) | Home and Schedule quote the same win chance for the same game (best lineup, learned spread). | 69 |
| [`test-capture.mjs`](test-capture.mjs) | The weekly reading ([`js/capture.js`](../js/capture.js)): the schedule page and the connection bar produce an **identical** reading from the same season; refusals (no extension, demo, synced copy); first reading kept; the committed archive respected; the retry wait; every status line; the bar's "NOT recorded" chip. | 85 |
| [`cross-sim-check.mjs`](cross-sim-check.mjs) | Summary and Schedule call the season simulation with identical inputs (field size, spread), and agree on title % within noise. | 21 |
| [`site-status-check.mjs`](site-status-check.mjs) | [`js/site-status.js`](../js/site-status.js): the "Site updated" stamp, the newer-version bar, the failed-to-load strip, and extension errors ignored. | 89 |
| [`nav-check.mjs`](nav-check.mjs) | The hand-copied nav: same links, labels and order on every page, each page marking only itself. | 96 |
| [`test-home.mjs`](test-home.mjs) | The home page (demo and pre-kickoff) and the debug page. | 2 pages |

`test-pages-render.mjs` also takes a page name, which is how the pages outside
its default list get checked:

```
node test-pages-render.mjs waivers.html
node test-pages-render.mjs draft.html
node test-pages-render.mjs debug.html
```

## Two ways to waste an hour on a suite that is working fine

**Do not run a single scenario by hand and believe the result.** Several suites
take a scenario name as `argv[2]` — that is how they run their OWN children —
but the stubbed scenarios need a module loader that the parent supplies:

```
node fc-test.mjs archive        # WRONG: no loader, so js/season.js is real,
                                # the page silently falls back to demo, and
                                # every live assertion fails for no reason
node fc-test.mjs                # right: the parent adds --import ./fc-register.mjs
                                # for the scenarios that are marked stub: true
```

The same is true of `an-test.mjs`, `wv-test.mjs`, `cmp-check.mjs`,
`taken-check.mjs` and `tr-test.mjs`, each with its own `*-register.mjs`. If a
hand-run scenario fails in ways the full run does not, this is why. Run the
whole suite.

**A suite that is documented is not a suite that exists.** `test-extension.mjs`
was written down in `PROGRESS.md` at 38 assertions for a week while there was no
such file in this directory, and nobody noticed because the table is read more
often than the directory is listed. It has been recreated at 234. Check `ls`
against any table before trusting it.

**A harness stub that is missing a method fails silently and passes
vacuously.** `localStorage` in these harnesses used to implement only
`getItem`/`setItem`/`removeItem`. Real `Storage` also has `length` and `key(i)`,
and `js/snapshots.js` enumerates keys to list the archive — so without them the
time machine found nothing, and every assertion about it would have passed by
being about an empty list. When a page module starts using a new browser API,
check the stub implements enough of it to be wrong.

## The dumps are not tests

[`fc-dump.mjs`](fc-dump.mjs) and [`sim-dump.mjs`](sim-dump.mjs) assert nothing.
They boot the schedule page and print the forecast panel and the "Simulate
season" panel **as rendered**, in plain text — titles, stat strip, every table
row, the chart's bar count, every line of the note.

That makes a refactor provable. Dump before, refactor, dump after, diff the
two: a byte-identical diff is proof the change was a no-op. That is exactly how
the move of the schedule page onto the shared projection module was verified,
and how this move into `tests/` was verified.

```
node fc-dump.mjs  > before-fc.txt
node sim-dump.mjs > before-sim.txt
# ... refactor ...
node fc-dump.mjs  > after-fc.txt
diff before-fc.txt after-fc.txt
```

They regenerate their own children (`fc-dump-child.mjs`, `sim-dump-child.mjs`)
on every run, so edit the template inside `fc-dump.mjs`, not the child.

`run-all.mjs` skips both, since there is nothing for them to pass or fail.

## How the stubbing works

The suites that need a live league without a network use Node's module loader
hooks. `node --import ./fc-register.mjs fc-test.mjs live` registers
[`fc-loader.mjs`](fc-loader.mjs), which rewrites the page's relative imports of
`./season.js` and `./espn.js` to the stubs beside it. The stub then re-exports
the **real** module and overrides only the one function that would hit the
network — so `parseFreeAgent`, `SLOT_ELIGIBILITY`, `configure` and the rest are
the genuine article, and renaming one in `js/` breaks the test instead of
passing it.

Same shape for [`wv-loader.mjs`](wv-loader.mjs),
[`cmp-loader.mjs`](cmp-loader.mjs), [`an-loader.mjs`](an-loader.mjs),
[`opp-loader.mjs`](opp-loader.mjs), [`taken-loader.mjs`](taken-loader.mjs) and
[`tr-loader.mjs`](tr-loader.mjs) — the last of which is what lets `tr-test.mjs`
exercise the Trade page's weekly measure without spending a request per week.

One wrinkle now the tests live inside the repo: `fc-stub-espn.mjs` re-exports
`../js/espn.js`, which is itself a relative specifier ending in `/espn.js`.
`fc-loader.mjs` therefore skips rewriting when the importer is a file in
`tests/`, or it would point the stub back at itself.

## Paths

No file here hard-codes a machine path. [`repo.mjs`](repo.mjs) works the repo
root out from its own location — `tests/` is one level down — and exports
`REPO`, `repoFile(rel)` and `moduleUrl(rel)`.

The repo path contains **spaces** (`Code Projects/Fantasy Football`), so
anything that builds a `file://` URL must go through `pathToFileURL`, and
anything that turns a URL back into a path must go through `fileURLToPath`.
Hand-rolling either (`'file:///' + p`, or stripping the leading slash off
`new URL(...).pathname`) leaves `%20` in the string and the import fails with
`ERR_MODULE_NOT_FOUND` on a path that looks correct at a glance.

## Two linkedom gotchas

Both of these cost an hour once. Don't pay it again.

**1. Take the table prototype from an element, not from the window.**

```js
// right
const TableProto = Object.getPrototypeOf(document.createElement('table'));
// wrong — not the same object, and table.tBodies stays undefined
const TableProto = window.HTMLTableElement.prototype;
```

linkedom does not implement `tBodies`, `tHead`, `rows` or `cells`, so the
harness defines them. But `window.HTMLTableElement` and the prototype of an
element linkedom actually made are not always the same object here. Define on
the wrong one and everything looks fine until a page reads `table.tBodies` and
gets `undefined`.

**2. Shim `window.location`.**

linkedom gives the window no `location`. [`js/bridge.js`](../js/bridge.js)
reads `window.location.origin` on every ping, roughly 400ms in. The throw comes
back out of `connection.js`'s `init()` as an unhandled rejection and kills the
child — but only when a page's own work delays the harness past that timer,
which makes it look like an intermittent page failure rather than a missing
shim. `window.postMessage` needs the same treatment. Both exist in every real
browser, so the page code is correct and the harness is what's lacking.

The suites also shim `HTMLSelectElement.prototype.value` (linkedom returns
`undefined`; shimming `HTMLElement.prototype` does nothing because it is
shadowed, and would break `<input>`), `localStorage`, `ResizeObserver`,
`matchMedia`, `requestAnimationFrame` and `getComputedStyle`.

`fetch` is deliberately **not** shimmed with anything that works: it throws and
records the call, so any real network attempt is a failure the suite reports.
