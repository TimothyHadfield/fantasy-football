# tests

Headless suites for the site. They boot the **real** pages and import the
**real** modules from [`../js`](../js) — nothing here reimplements site logic,
so a rename or a broken selector fails a test rather than sailing past it.

Over 3,500 assertions in all, across 17 suites.

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
| [`test-pages-render.mjs`](test-pages-render.mjs) | Boots each page's real HTML with the real module scripts the page itself declares. Catches a missing element id, a typo'd `querySelector`, an import that doesn't resolve — the things unit tests miss and only a browser would show. | 5 pages |
| [`test-forecast.mjs`](test-forecast.mjs) | [`js/forecast.js`](../js/forecast.js): win probability, sigma calibration, optimal lineup, the win-total distribution, credible ranges. Known-good values plus brute force. | 68 |
| [`test-sim.mjs`](test-sim.mjs) | The Monte Carlo season simulation in [`js/forecast.js`](../js/forecast.js). | 71 |
| [`test-projection.mjs`](test-projection.mjs) | [`js/projection.js`](../js/projection.js), the shared projection module. | 38 |
| [`test-snapshots.mjs`](test-snapshots.mjs) | [`js/snapshots.js`](../js/snapshots.js), the time machine's storage. Round-trips a week's reading through JSON, through an exported file and into an empty browser; proves a snapshot is a **copy** by moving the live season underneath one; covers a browser that blocks storage, a full one, an unreadable key and a file from a newer build; and covers the committed archive restoring a wiped browser without overwriting what it already held. | 123 |
| [`test-trade.mjs`](test-trade.mjs) | [`js/trade.js`](../js/trade.js): replacement level, the depth map and the trade finder. A hand-built two-team league where every answer is known by hand, then the real demo pool where **every offer is re-priced from the raw rosters** rather than read back off its own numbers. | 1,411 |
| [`fc-test.mjs`](fc-test.mjs) | The schedule page's forecast and simulation panels, against demo data and a stubbed live league — including no team set, the owner picking a team afterwards, switching team, a roster fetch that rejects, and the **time machine** — that booting live records a reading unasked, that replaying a doctored one puts ITS numbers on screen rather than the live ones, and that the whole round trip costs no extra request. | 434 over 9 scenarios |
| [`wv-test.mjs`](wv-test.mjs) | The Players page's wire: filtering (incl. FLEX), sorting, widening the span mid-load, switching source while requests are in the air, weeks that reject, an empty pool, a saved filter that is no longer valid. | 188 over 8 scenarios |
| [`cmp-check.mjs`](cmp-check.mjs) | The wire compared against your own roster — the worst man at each position, nobody set as you, ESPN refusing some or all roster weeks. | 90 over 6 scenarios |
| [`taken-check.mjs`](taken-check.mjs) | The "Taken players" table: owners, per-squad positional ranks, nothing coloured, the two tables' independent filters, and landing a `?player=` link. Every rank is re-derived from the **rendered** Avg column, never from the stub's raw numbers. | 216 over 4 scenarios |
| [`link-check.mjs`](link-check.mjs) | **The seam between pages.** `index.html`, `analysis.html` and `trade.html` make player links; `waivers.html` resolves them. Boots each, checks every link against the contract, then *follows* a sample and asserts each lands on that man. No single-page suite can see this, and it has now found a real defect twice — once on its first run, and once when the Trade page was added and its sample happened to pick a man who is also somebody's "Your QB2". | 135 |
| [`an-test.mjs`](an-test.mjs) | The analysis page: demo, a stubbed live league, weeks that reject, switching team and sorting, the two all-teams grids, the roster-detail swap, the hover card, a player ESPN gave no id for, and "Who to start, week by week" — whose marks are re-derived by rebuilding every week's lineup from `demo-rosters.js` through `optimalLineup`, never read back off the page. | 565 over 8 scenarios |
| [`tr-test.mjs`](tr-test.mjs) | The Trade page: the depth map (its columns, its per-column tinting, the bar chips), the finder, and every control — the shape buttons, the team and manager pickers, the measure. Asserts no control costs a request, and that a filter matching nothing **empties** the table rather than merely hiding it. | 75 over 3 scenarios |
| [`hot-check.mjs`](hot-check.mjs) | Both greens on the Players page's wire — over the startable bar, and beating your own worst man that week — plus proof that pressing FLEX changes not one cell's colour. | 118 |
| [`opp-check.mjs`](opp-check.mjs) | Opponent strength on the stats page, against a synthetic league with no network at all. | 6 scenarios |
| [`stats-weeks.mjs`](stats-weeks.mjs) | The stats page at 1, 2, 3, 5 and 13 weeks of season — the early-season honesty rules: no fabricated zero std dev, no empty accuracy buckets, no percentage drawn from a handful of games. Copies the repo to a temp dir and shortens the demo season to do it. | 6 checks |
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

The same is true of `an-test.mjs` and `--import ./an-register.mjs`. If a
hand-run scenario fails in ways the full run does not, this is why. Run the
whole suite.

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
[`cmp-loader.mjs`](cmp-loader.mjs), [`an-loader.mjs`](an-loader.mjs) and
[`opp-loader.mjs`](opp-loader.mjs).

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
