# tools/

Things that measure the site. Not tests — `tests/` is the suites, and nothing
in here is in `npm test`, because everything in here needs a real browser.

## measure-layout.mjs

Drives headless Edge over the DevTools protocol and reports, for each page at
each width: the settled document height, whether the document scrolls
**sideways** (the iPhone check), which elements overflow horizontally, the size
of any selector you name, and every interactive target under 44px under touch
emulation. It writes a human table and, with `--json`, a machine-readable run
you can diff a later one against.

Needs nothing but Node 22+ and Edge. No network beyond localhost, no ESPN
connection, no extension: the pages are driven in **demo mode**, so what you
measure is the full ten-team demo league on every page. The output says so at
the top of the table.

```
node tools/measure-layout.mjs                    # measure the site, print a table
node tools/measure-layout.mjs --help             # every flag
```

### Before and after — the reason it exists

A one-shot measurement is the easy half. What this is for is proving what a
change cost:

```
# before you touch anything
node tools/measure-layout.mjs --json before.json --quiet

# ... make the change ...

# after: measures again, and prints the DELTA per page, per width
node tools/measure-layout.mjs --json after.json --baseline before.json

# or diff two runs you already have, with no browser at all
node tools/measure-layout.mjs --baseline before.json --compare after.json
```

The delta names heights, sideways-scroll changes, overflowing elements that
appeared or went away by selector, tracked selectors that changed size, and tap
targets that appeared or were fixed.

### Tracking one panel, and pictures of it

```
node tools/measure-layout.mjs --pages trade.html --selector '#customPanel'
node tools/measure-layout.mjs --pages trade.html \
  --screenshot '#customPanel' --shot-widths 1500,390 --out-dir shots
```

`--selector` is repeatable and is recorded in the JSON, so a panel's width can
be followed across a change. `--screenshot` clips a PNG to that element,
beyond the viewport if it is taller than the screen.

### Reading the table

| column | what it means |
|---|---|
| `height` | `documentElement.scrollHeight` once the page has stopped moving |
| `sideways` | `documentElement.scrollWidth` vs the layout viewport, exactly. `no` is the answer you want at 390 |
| `spill` | content hanging out of its box with `overflow-x: visible`. **The defect.** |
| `bleed` | the same arithmetic, but accounted for by a child's negative margin — `.table-scroll` bleeding to the panel edge. Design, not damage |
| `clip` | content silently cut off by `overflow-x: hidden` with no ellipsis |
| `scroll` | designed sideways scrollers. `.table-scroll` IS the phone answer for the wide tables; expected, not a regression |
| `tap<44` | interactive targets under 44px, as `instances/kinds`, under touch emulation |
| `settled` | how long the height took to stop moving. `NO` means it hit the ceiling and the row is a lower bound |

Tap targets are grouped by KIND rather than listed one by one: three hundred
20px-tall player links inside a wide table are one fact, not three hundred.

### Measuring a different tree

Six agents editing the same working tree at once is normal here, so a baseline
usually wants a clean checkout rather than whatever is on disk:

```
git worktree add /tmp/ff-head HEAD --detach
node tools/measure-layout.mjs --root /tmp/ff-head --json before.json
git worktree remove /tmp/ff-head
```

### The two traps, in short

Both are commented at length at the top of the script. They are written down
because the same two mistakes have now produced two published audits whose
conclusions were wrong.

1. **The viewport is set with `Emulation.setDeviceMetricsOverride`, never
   `--window-size`.** Headless Edge will not make a window narrower than about
   500px, so a `--window-size=390` audit reports every page — header included —
   as overflowing.
2. **These pages settle asynchronously**, so the script polls the height until
   it stops moving instead of waiting a fixed time. The season simulation hands
   off through rAF and a timeout, the weekly capture fires an event, and charts
   redraw on a ResizeObserver. A fixed wait once caught `schedule.html`
   mid-render and reported it 600px shorter than it settles at, which read as a
   saving that did not exist.

A third, smaller one: tap targets are measured **under touch emulation**,
because the site's 44px floor on "How this works" is keyed off `hover: none`
and not off the width. The JSON records `hoverNone` per row so you can see the
emulation took.

### Exit codes

`0` when it measured everything, whatever it found — this is an instrument, not
an assertion. `1` when a page failed to measure, when Edge cannot be found or
started, or when `--fail-on-sideways` is passed and something scrolls sideways.
