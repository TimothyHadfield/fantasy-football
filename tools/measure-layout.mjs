#!/usr/bin/env node
// Measure the real layout of every page, in a real browser, at real widths.
//
// WHY THIS FILE IS IN THE REPO
// ----------------------------
// This script has now been written three times. The first two lived in a
// scratchpad and were thrown away with it, and both times the next session had
// to re-derive the same two traps from scratch — after publishing conclusions
// that were wrong because of them. HANDOFF.md and PROGRESS.md both say, in as
// many words, that it is worth committing. So: it is committed, and the two
// traps are written into the code beside the lines that avoid them.
//
// What it is for: turning "this panel should be narrower" and "does anything
// scroll sideways on my iPhone" into numbers, and — the actual point —
// DIFFING a before against an after. A one-shot measurement is the easy half.
// The density pass of 2026-09-18 shipped a +101px regression on a phone that
// only showed up because a previous run's JSON was sitting there to compare
// against.
//
//
// TRAP 1 — SET THE VIEWPORT WITH CDP, NOT WITH `--window-size`.
// ------------------------------------------------------------
// Headless Edge will not make a window narrower than about 500px. Ask for
// `--window-size=390,844` and you get a ~500px window, every page lays out at
// 500px in a 390px box, and EVERY PAGE reports as overflowing sideways — the
// site header included, which should have been the tell. An entire 390px audit
// was published off that and its conclusions were all wrong.
//
// `Emulation.setDeviceMetricsOverride` sets the LAYOUT viewport inside the
// renderer and has no such floor. It is what DevTools' own device toolbar
// uses. `applyMetrics()` below is the only place the viewport is ever set.
//
//
// TRAP 2 — THESE PAGES SETTLE ASYNCHRONOUSLY. POLL; DO NOT WAIT A FIXED TIME.
// --------------------------------------------------------------------------
// Three separate things on this site finish after `load` fires:
//   * the season simulation on schedule.html hands off through rAF and a
//     timeout, so it paints in chunks over a second or more;
//   * the weekly capture (`js/capture.js`) fires an event that pages redraw on;
//   * every chart redraws on a ResizeObserver, which by definition cannot have
//     run before the first layout it is observing.
// A fixed 2.6s wait caught schedule.html mid-render and reported it ~600px
// SHORTER than it settles at. That read as a dramatic saving from the density
// work. There was no saving. `settle()` below polls the document height until
// it stops moving for N consecutive samples, with a hard ceiling, and records
// in the JSON whether it actually settled or hit the ceiling — because a
// measurement that timed out is not a measurement, and the next reader needs to
// know which it was.
//
//
// A THIRD THING, SMALLER, ALSO WORTH KNOWING
// ------------------------------------------
// Touch targets are measured UNDER TOUCH EMULATION, in a second pass. This is
// not belt and braces: the site's 44px floor on "How this works" is keyed off
// `hover: none` and NOT off the width (HANDOFF, "Two media features"), so
// measuring tap targets with a mouse attached reports 27 false positives per
// page. The probe returns `matchMedia('(hover: none)').matches` alongside the
// numbers so you can see the emulation actually took, rather than trusting it.
//
//
// HOW IT IS RUN — see tools/README.md. It is deliberately NOT in `npm test`:
// it needs a browser, it takes minutes, and it is a measuring instrument, not
// an assertion. Nothing here needs the network beyond localhost, and nothing
// needs an ESPN connection — the pages are driven in DEMO mode (see
// `bootstrapSource()`), which renders a full ten-team league from
// `js/demo.js` + `js/demo-rosters.js`.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

/** The seven pages of the site proper. draft.html is parked; debug.html is not in the nav. */
const DEFAULT_PAGES = [
  'index.html',
  'stats.html',
  'analysis.html',
  'schedule.html',
  'waivers.html',
  'trade.html',
  'summary.html',
];

// 1500 is Tim's laptop; 1280 and 1000 straddle the `.panel-row` pairing break
// (2 x 420 + 16 = 856px of row, about a 916px viewport); 900 is just under it,
// so a pair that should have stacked and did not shows up there; 390 is the
// iPhone, and it is the width that actually matters.
const DEFAULT_WIDTHS = [1500, 1280, 1000, 900, 390];

/** Apple's floor, and the one the site's own `touch-check.mjs` uses. */
const TOUCH_MIN = 44;

// ---------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------

const USAGE = `
measure-layout — measure the site's real layout in headless Edge.

  node tools/measure-layout.mjs [options]

Measuring
  --pages a.html,b.html   pages to measure (default: the seven site pages)
  --widths 1500,390       viewport widths in CSS px (default: ${DEFAULT_WIDTHS.join(',')})
  --height 900            viewport height (default: 900)
  --selector <css>        also report this element's width/height (repeatable)
  --screenshot <css>      save a PNG of this element (repeatable)
  --shot-widths 1500,390  widths to screenshot at (default: every measured width)
  --no-touch              skip the touch-emulation pass (faster; loses tap targets)
  --touch-widths 390      widths to run the touch pass at (default: every width)
  --all-overflow          list clipped and scrollable overflow too, not just spills

Output
  --json <file>           write the machine-readable run here
  --quiet                 suppress the human table (use with --json)
  --out-dir <dir>         where screenshots go (default: ./layout-shots)

Diffing — this is the feature
  --baseline <file>       compare this run against a previous --json run
  --compare <file>        diff two saved runs and exit; no browser is launched
  --diff-all              print every page/width, not only the ones that moved

Plumbing
  --root <dir>            site root to serve (default: the repo this file is in)
  --port <n>              static server port (default: an ephemeral one)
  --edge <path>           msedge.exe, if it is somewhere unusual
  --settle-max <ms>       ceiling on the settle poll (default: 25000)
  --settle-step <ms>      poll interval (default: 250)
  --settle-stable <n>     identical samples required (default: 3)
  --fail-on-sideways      exit non-zero if any page scrolls sideways
  -h, --help

Examples
  node tools/measure-layout.mjs
  node tools/measure-layout.mjs --json before.json --quiet
  node tools/measure-layout.mjs --json after.json --baseline before.json
  node tools/measure-layout.mjs --compare after.json --baseline before.json
  node tools/measure-layout.mjs --pages trade.html --selector '#customPanel'
  node tools/measure-layout.mjs --pages trade.html --screenshot '#customPanel' --shot-widths 1500,390
`.trim();

function parseArgs(argv) {
  const o = {
    pages: DEFAULT_PAGES.slice(),
    widths: DEFAULT_WIDTHS.slice(),
    height: 900,
    selectors: [],
    screenshots: [],
    shotWidths: null,
    touch: true,
    touchWidths: null,
    allOverflow: false,
    json: null,
    quiet: false,
    outDir: null,
    baseline: null,
    compare: null,
    diffAll: false,
    root: REPO_ROOT,
    port: 0,
    edge: null,
    settleMax: 25000,
    settleStep: 250,
    settleStable: 3,
    failOnSideways: false,
  };
  const nums = (s) => s.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) die(`${a} needs a value. Run with --help.`);
      return v;
    };
    switch (a) {
      case '-h': case '--help': console.log(USAGE); process.exit(0); break;
      case '--pages': o.pages = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--widths': o.widths = nums(next()); break;
      case '--height': o.height = Number(next()); break;
      case '--selector': o.selectors.push(next()); break;
      case '--screenshot': o.screenshots.push(next()); break;
      case '--shot-widths': o.shotWidths = nums(next()); break;
      case '--no-touch': o.touch = false; break;
      case '--touch-widths': o.touchWidths = nums(next()); break;
      case '--all-overflow': o.allOverflow = true; break;
      case '--json': o.json = path.resolve(next()); break;
      case '--quiet': o.quiet = true; break;
      case '--out-dir': o.outDir = path.resolve(next()); break;
      case '--baseline': o.baseline = path.resolve(next()); break;
      case '--compare': o.compare = path.resolve(next()); break;
      case '--diff-all': o.diffAll = true; break;
      case '--root': o.root = path.resolve(next()); break;
      case '--port': o.port = Number(next()); break;
      case '--edge': o.edge = next(); break;
      case '--settle-max': o.settleMax = Number(next()); break;
      case '--settle-step': o.settleStep = Number(next()); break;
      case '--settle-stable': o.settleStable = Number(next()); break;
      case '--fail-on-sideways': o.failOnSideways = true; break;
      default: die(`Unknown option "${a}". Run with --help.`);
    }
  }
  if (!o.widths.length) die('--widths left nothing to measure.');
  if (!o.pages.length) die('--pages left nothing to measure.');
  o.outDir = o.outDir || path.resolve(process.cwd(), 'layout-shots');
  // Screenshotting every element at every width is almost never wanted and is
  // slow, so a bare --screenshot defaults to the widths being measured and the
  // caller narrows it with --shot-widths.
  o.shotWidths = o.shotWidths || o.widths.slice();
  o.touchWidths = o.touchWidths || o.widths.slice();
  return o;
}

/** Every failure exits non-zero with a sentence a person can act on. */
function die(msg) {
  process.stderr.write(`\nmeasure-layout: ${msg}\n\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Finding Edge
// ---------------------------------------------------------------------------

// Edge is what is installed on Tim's machine, so Edge is what this drives.
// Do NOT hard-code one path: Edge is 32-bit-Program-Files on some installs and
// 64-bit on others, and a per-user install lives under LOCALAPPDATA. Chrome is
// accepted as a last resort because the CDP calls used here are identical, but
// it is never preferred — the whole point is measuring the browser he reads the
// site in.
function findEdge(override) {
  if (override) {
    if (!fs.existsSync(override)) die(`--edge "${override}" does not exist.`);
    return override;
  }
  const env = process.env;
  const candidates = [
    path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(env.LOCALAPPDATA || '', 'Microsoft\\Edge\\Application\\msedge.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    // Last resort only.
    path.join(env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    '/usr/bin/google-chrome',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* keep looking */ }
  }
  die(
    'could not find Microsoft Edge.\n' +
    '  Looked in:\n' + candidates.map((c) => `    ${c}`).join('\n') + '\n' +
    '  Pass the executable explicitly:  --edge "C:\\path\\to\\msedge.exe"'
  );
}

// ---------------------------------------------------------------------------
// The static server
// ---------------------------------------------------------------------------

// `file://` is not an option: every page here is an ES module graph and the
// browser refuses module imports across file:// for origin reasons. So the
// tree is served over plain HTTP on localhost. Nothing leaves the machine.
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

async function serve(root, port) {
  if (!fs.existsSync(path.join(root, 'index.html'))) {
    die(`--root "${root}" has no index.html in it; that is not the site.`);
  }
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const full = path.join(root, rel);
      // Traversal guard. This only ever serves localhost, but a tool that can
      // be pointed at an arbitrary --root should not also read outside it.
      if (!path.resolve(full).startsWith(path.resolve(root))) {
        res.writeHead(403).end('no');
        return;
      }
      const body = await fsp.readFile(full);
      res.writeHead(200, {
        'content-type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
      }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((ok, no) => {
    server.on('error', no);
    server.listen(port, '127.0.0.1', ok);
  });
  return { server, port: server.address().port };
}

// ---------------------------------------------------------------------------
// A minimal Chrome DevTools Protocol client
// ---------------------------------------------------------------------------

// No dependency here on purpose. This repo has no build step and exactly one
// dev dependency (linkedom, in tests/), and a layout-measuring tool is not
// worth dragging puppeteer's ~300MB browser download into. Node 22+ ships a
// global WebSocket, and the half-dozen CDP domains used below are stable and
// documented. If this ever needs more than it does now, revisit — but every
// previous version of this script also got by on raw CDP.
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
        else p.resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.handlers.get(msg.method) || []) fn(msg.params, msg.sessionId);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, no) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', () => no(new Error(`could not open a DevTools socket at ${url}`)), { once: true });
    });
    return new CDP(ws);
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
    return () => {
      const list = this.handlers.get(method);
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /** Resolve when `method` fires, or reject at `ms`. */
  once(method, ms, sessionId) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { off(); reject(new Error(`timed out waiting for ${method}`)); }, ms);
      const off = this.on(method, (params, sid) => {
        if (sessionId && sid !== sessionId) return;
        clearTimeout(t);
        off();
        resolve(params);
      });
    });
  }

  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchEdge(exe) {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ff-measure-'));
  const args = [
    // `--headless=new` is the one that lays out like the real browser. The old
    // headless was a separate rendering path and is not what Tim reads.
    '--headless=new',
    // Port 0 means "pick one"; the chosen port is written to DevToolsActivePort
    // in the profile dir. Choosing a port here instead would race any other
    // copy of this script (six agents run in parallel on this repo).
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-sync',
    // The bridge extension must NOT be loaded. It is what reads Tim's private
    // league; with it present the pages would go live and measure a different
    // document. A fresh --user-data-dir already has no extensions, but say so.
    '--disable-extensions',
    // Scrollbars are hidden deliberately, and it is a layout decision rather
    // than a cosmetic one: a classic scrollbar eats ~15px of the layout
    // viewport, which is enough on its own to make the sideways-overflow check
    // ambiguous at 390px. iOS uses overlay scrollbars and eats nothing, so
    // hiding them is the honest emulation of the device that matters.
    '--hide-scrollbars',
    '--disable-gpu',
    '--mute-audio',
    'about:blank',
  ];
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += String(d); });

  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + 30000;
  let wsPath = null;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) {
      die(`Edge exited immediately (code ${proc.exitCode}).\n  ${stderr.trim().split('\n').slice(-5).join('\n  ')}`);
    }
    try {
      const txt = await fsp.readFile(portFile, 'utf8');
      const [port, browserPath] = txt.split('\n');
      if (port && browserPath) { wsPath = `ws://127.0.0.1:${port.trim()}${browserPath.trim()}`; break; }
    } catch { /* not written yet */ }
    await sleep(100);
  }
  if (!wsPath) {
    try { proc.kill(); } catch { /* already dead */ }
    die(
      'Edge started but never opened a DevTools port within 30s.\n' +
      `  Tried: ${exe}\n` +
      (stderr.trim() ? `  Its stderr said:\n  ${stderr.trim().split('\n').slice(-5).join('\n  ')}\n` : '') +
      '  If an Edge policy blocks remote debugging, this tool cannot run here.'
    );
  }
  const cdp = await CDP.connect(wsPath);
  return { proc, cdp, userDataDir };
}

// ---------------------------------------------------------------------------
// The page that gets measured — demo mode
// ---------------------------------------------------------------------------

// Measuring seven empty pages would be worse than useless: an unconnected page
// draws a status line and nothing else, so every height would be ~600px and
// every "no sideways overflow" would be vacuously true.
//
// How demo is switched on, worked out from the page modules rather than
// guessed (js/connection.js and js/prefs.js are where this lives):
//
//   * `js/connection.js` keeps the connected league under `ff.connection`
//     (with `ff.config` as a legacy key it still reads). With neither present
//     `savedConfig()` returns null and no page can go live at all.
//   * every page module keeps its data source as a namespaced preference in
//     `ff.prefs` — `prefs.scope('<page>').get('source')`. `'demo'` pins it;
//     three of the pages default to live and would otherwise try a fetch,
//     fail, and render demo under a red error line that changes the height.
//
// So both halves are set: no league saved, and every page's source pinned to
// demo. That is also exactly the state a brand-new browser is in, which is why
// it needs no page-code changes to drive.
//
// This runs through `Page.addScriptToEvaluateOnNewDocument`, which executes
// before any of the page's own scripts. Setting it after navigation would be
// too late — the page modules read prefs at import time.
function bootstrapSource() {
  const scopes = ['home', 'schedule', 'stats', 'analysis', 'waivers', 'trade', 'summary'];
  return `
(() => {
  try {
    localStorage.removeItem('ff.connection');
    localStorage.removeItem('ff.config');
    const prefs = {};
    for (const s of ${JSON.stringify(scopes)}) prefs[s + '.source'] = 'demo';
    localStorage.setItem('ff.prefs', JSON.stringify(prefs));
  } catch (e) { /* a private window would land here; demo is the fallback anyway */ }
  window.__ffMeasureMode = 'demo';
})();`;
}

// ---------------------------------------------------------------------------
// The in-page probe
// ---------------------------------------------------------------------------

// All of the measuring happens inside the page, in one evaluation, because a
// round trip per element would take minutes on pages with 10,000 nodes.
//
// NO BACKTICKS BELOW, not even in a comment — the whole probe is one template
// literal, and a stray backtick in a comment does not fail loudly. It closes
// the template and the rest re-parses as something else; the first time it
// happened the only symptom was every page reporting "scroll is not defined",
// and the second time it was a syntax error 500 lines from the mistake. Use
// plain quotes when naming a CSS class or a property in here.
function probeSource(opts) {
  return `(() => {
  const OPTS = ${JSON.stringify(opts)};
  const esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^\\w-]/g, '\\\\$&');

  // A selector a person can paste into DevTools. Stops at the nearest id
  // ancestor, which on this site is usually the panel — '#customPanel > div >
  // table' is a useful answer, 'html > body > div:nth-of-type(2) > ...' is not.
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return '#' + esc(el.id);
    const parts = [];
    let node = el, depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      if (node.id) { parts.unshift('#' + esc(node.id)); break; }
      let seg = node.tagName.toLowerCase();
      const cls = (node.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).slice(0, 3);
      if (cls.length) seg += '.' + cls.map(esc).join('.');
      const parent = node.parentElement;
      if (parent) {
        const sibs = Array.prototype.filter.call(parent.children, (c) => c.tagName === node.tagName);
        if (sibs.length > 1) seg += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
      }
      parts.unshift(seg);
      node = node.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  // A kind of element rather than one instance. The whole reason the last
  // audit "found four sub-44px targets and only ever named one" is that it was
  // looking at instances: this site has hundreds of 20px-tall player links
  // inside wide tables, and they are one fact, not three hundred.
  // ONE class, not all of them, and sorted so it is deterministic. Using every
  // class split the Analysis page's week cells into fifteen "kinds" that were
  // one kind — td.heat.heat-up-2.wk, td.heat.heat-dn-3.po-start.wk and so on,
  // which are the red/green scale's own steps (js/heat.js) and not fifteen
  // different tap targets. Sorted rather than as-authored because class ORDER
  // in an attribute is not stable across a rewrite, and an unstable signature
  // makes every diff churn. The full three-class path survives in examples,
  // so nothing is actually lost.
  function baseClass(el) {
    const c = (el.getAttribute('class') || '').trim().split(/\\s+/).filter(Boolean).sort();
    return c.length ? '.' + c[0] : '';
  }
  function signature(el) {
    const p = el.parentElement;
    const tail = el.tagName.toLowerCase() + baseClass(el) +
                 (el.getAttribute('type') ? '[type=' + el.getAttribute('type') + ']' : '');
    const head = p ? p.tagName.toLowerCase() + baseClass(p) + ' > ' : '';
    return head + tail;
  }

  const text = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 50);
  const round = (n) => Math.round(n * 10) / 10;

  const de = document.documentElement;
  const viewportWidth = de.clientWidth;

  // ---- the check that matters most: does the DOCUMENT scroll sideways? ----
  // Exact, not approximate, per the ask. scrollWidth is an integer and
  // clientWidth is the layout viewport with the scrollbar already excluded, so
  // the difference is the number of CSS pixels a finger can drag the page by.
  const docScrollWidth = de.scrollWidth;
  const sidewaysBy = docScrollWidth - viewportWidth;

  // ---- every element whose content overflows it horizontally ----
  // Split FOUR ways, because they are four different facts and lumping them
  // together is how this check gets ignored. The first version of this probe
  // reported three "spills" on index.html at every width and they were all the
  // deliberate .table-scroll bleed; a tool that cries wolf on every table panel
  // on the site is a tool nobody reads.
  //
  //   spill   — overflow-x: visible, content hangs out of the box. The defect.
  //   bleed   — the same, but explained by a child's NEGATIVE horizontal
  //             margin, which on this site means .table-scroll deliberately
  //             bleeding to the panel edge (css/app.css: "Must stay the exact
  //             negative of --pad-panel"). Design, not damage.
  //   clipped — overflow-x: hidden/clip, content is silently cut off. Usually
  //             deliberate here (td.name's ellipsis, which is skipped),
  //             occasionally not.
  //   scroller— overflow-x: auto/scroll. By design, .table-scroll IS the
  //             phone answer for the ten-by-twenty tables and must not be
  //             reported as a regression.
  const spill = [], bleed = [], clipped = [], scroller = [];
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const by = el.scrollWidth - el.clientWidth;
    if (by <= 1) continue;                       // 1px of subpixel rounding
    if (!el.getClientRects().length) continue;   // display:none / [hidden]
    // INSIDE an <svg>, scrollWidth/clientWidth are not layout facts — a chart
    // axis label reports 90 in 45 and nothing is wrong, the viewBox handles it.
    // The root <svg> is kept, because an <svg> too wide for its panel is real.
    if (el.parentNode && el.parentNode.namespaceURI === 'http://www.w3.org/2000/svg') continue;
    // Visually-hidden text (.sr-only) is a 1px box with a paragraph clipped
    // inside it, on purpose, on every sortable header on the site. A box this
    // narrow is not laying anything out and cannot be a layout defect.
    if (el.clientWidth <= 1) continue;
    const cs = getComputedStyle(el);
    const ox = cs.overflowX;
    const r = el.getBoundingClientRect();
    const rec = {
      selector: cssPath(el),
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      by,
      overflowX: ox,
      // The element's own right edge past the viewport. This is what actually
      // drags the document sideways, as opposed to merely being wide inside a
      // scroller that handles it — so it points at the culprit.
      beyondViewport: Math.round(r.right - viewportWidth) > 1,
    };
    if (ox === 'auto' || ox === 'scroll') { scroller.push(rec); continue; }
    if (ox === 'hidden' || ox === 'clip') {
      if (cs.textOverflow === 'ellipsis') continue;   // deliberate truncation
      clipped.push(rec);
      continue;
    }
    // Is a negative margin on a descendant enough to account for it? Checked
    // against real computed declarations rather than inferred from the
    // numbers, so the answer names something somebody wrote rather than a
    // coincidence of arithmetic.
    //
    // Three levels, not one: the bleed is rarely a direct child. On the Trade
    // page it is #comboBody > div.combo-best > … > div.table-scroll, and a
    // one-level check reported that panel as a defect at every width. Three is
    // enough for every wrapper chain on this site and keeps the node count
    // small — an unbounded descendant scan means getComputedStyle on thousands
    // of table cells, per overflowing element, per width.
    let negative = 0;
    const kids = el.querySelectorAll(':scope > *, :scope > * > *, :scope > * > * > *');
    for (let j = 0; j < kids.length; j++) {
      const ccs = getComputedStyle(kids[j]);
      const ml = parseFloat(ccs.marginLeft) || 0;
      const mr = parseFloat(ccs.marginRight) || 0;
      negative = Math.max(negative, (ml < 0 ? -ml : 0) + (mr < 0 ? -mr : 0));
    }
    if (negative > 0 && by <= Math.ceil(negative) + 1) { rec.bleedBy = negative; bleed.push(rec); }
    else spill.push(rec);
  }
  const bySize = (a, b) => b.by - a.by;
  spill.sort(bySize); bleed.sort(bySize); clipped.sort(bySize); scroller.sort(bySize);

  // ---- named selectors, so one panel can be tracked across a change ----
  const selectors = {};
  for (const sel of OPTS.selectors) {
    let el = null;
    try { el = document.querySelector(sel); } catch (e) { selectors[sel] = { found: false, error: 'bad selector' }; continue; }
    if (!el) { selectors[sel] = { found: false }; continue; }
    const r = el.getBoundingClientRect();
    selectors[sel] = {
      found: true,
      width: round(r.width),
      height: round(r.height),
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
      // Page-absolute, so a screenshot can clip to it in a second call.
      top: round(r.top + window.scrollY),
      left: round(r.left + window.scrollX),
    };
  }

  // ---- tap targets, grouped by kind ----
  let touch = null;
  if (OPTS.touch) {
    const groups = new Map();
    const els = document.querySelectorAll('button, a, input, select, label, summary');
    let considered = 0;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      considered++;
      // "smaller than 44px in EITHER dimension" — half a pixel of tolerance,
      // because 43.99 is a rounding artefact and not a defect.
      if (r.width >= ${TOUCH_MIN} - 0.5 && r.height >= ${TOUCH_MIN} - 0.5) continue;
      const sig = signature(el);
      let g = groups.get(sig);
      if (!g) {
        g = { kind: sig, count: 0, minWidth: Infinity, minHeight: Infinity, examples: [], sample: text(el) };
        groups.set(sig, g);
      }
      g.count++;
      g.minWidth = Math.min(g.minWidth, r.width);
      g.minHeight = Math.min(g.minHeight, r.height);
      if (g.examples.length < 3) g.examples.push(cssPath(el));
    }
    const list = Array.from(groups.values()).map((g) => ({
      kind: g.kind, count: g.count,
      minWidth: round(g.minWidth), minHeight: round(g.minHeight),
      examples: g.examples, sample: g.sample,
    })).sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
    touch = {
      // Evidence that the emulation actually took. The site's 44px floor on
      // "How this works" is keyed off (hover: none), NOT off the width, so a
      // run where this came back false measured the wrong document.
      hoverNone: matchMedia('(hover: none)').matches,
      anyPointerCoarse: matchMedia('(any-pointer: coarse)').matches,
      considered,
      groups: list,
      total: list.reduce((n, g) => n + g.count, 0),
    };
  }

  return {
    height: de.scrollHeight,
    viewportWidth,
    docScrollWidth,
    sideways: sidewaysBy > 0,
    sidewaysBy,
    overflow: { spill, bleed, clipped, scroller },
    selectors,
    touch,
    // A page that failed to render its demo league would still have a height,
    // so carry a couple of sanity signals: how many panels drew, and whether
    // any of them is showing an error.
    panels: document.querySelectorAll('section.panel').length,
    errorText: Array.prototype.slice.call(document.querySelectorAll('.err, .error'))
      .map((e) => (e.textContent || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 3),
  };
})()`;
}

// ---------------------------------------------------------------------------
// Driving one page at one width
// ---------------------------------------------------------------------------

async function evaluate(cdp, sid, expression) {
  const res = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  }, sid);
  if (res.exceptionDetails) {
    const e = res.exceptionDetails;
    throw new Error(e.exception?.description || e.text || 'page threw during evaluation');
  }
  return res.result.value;
}

/**
 * TRAP 1 lives here. Every viewport change on this run goes through this one
 * function, so there is exactly one place that could regress to --window-size.
 *
 * `mobile` also decides whether the page's `<meta name=viewport
 * content="width=device-width">` is honoured. At 390 it must be — that is what
 * makes 390 mean 390 CSS pixels rather than 390 device pixels of a desktop
 * layout — and on the desktop widths it must not be.
 */
async function applyMetrics(cdp, sid, { width, height, mobile }) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height,
    deviceScaleFactor: 1,
    mobile: !!mobile,
    screenWidth: width,
    screenHeight: height,
  }, sid);
}

/**
 * TRAP 2 lives here. Poll the document height until it stops moving for
 * `stable` consecutive samples, or give up at `max` and SAY SO in the result.
 *
 * The height and the width are both watched: a chart that redraws on a
 * ResizeObserver can settle the height while still widening a row, and the
 * sideways check is the one that matters most.
 */
async function settle(cdp, sid, { step, stable, max }) {
  const started = Date.now();
  let last = null;
  let same = 0;
  let samples = 0;
  while (Date.now() - started < max) {
    const now = await evaluate(cdp, sid, `(() => {
      const d = document.documentElement;
      return d.scrollHeight + 'x' + d.scrollWidth + 'x' + document.readyState;
    })()`);
    samples++;
    if (now === last && now.endsWith('complete')) {
      if (++same >= stable) {
        return { settled: true, ms: Date.now() - started, samples };
      }
    } else {
      same = 0;
      last = now;
    }
    await sleep(step);
  }
  return { settled: false, ms: Date.now() - started, samples };
}

async function measurePage(cdp, sid, { url, width, height, opts, shots, outDir, pageName }) {
  const errors = [];

  // --- pointer pass: heights, sideways scroll, overflow, tracked selectors ---
  await applyMetrics(cdp, sid, { width, height, mobile: width <= 500 });

  await cdp.send('Page.navigate', { url }, sid);
  try {
    await cdp.once('Page.loadEventFired', 30000, sid);
  } catch {
    errors.push('load event never fired within 30s');
  }

  // Fonts change metrics, and a page measured before its font loads is
  // measured in the fallback face. Cheap, and it removes a real wobble.
  try { await evaluate(cdp, sid, 'document.fonts ? document.fonts.ready.then(() => 1) : 1'); } catch { /* fine */ }

  const s1 = await settle(cdp, sid, { step: opts.settleStep, stable: opts.settleStable, max: opts.settleMax });
  if (!s1.settled) errors.push(`height never settled within ${opts.settleMax}ms — treat this row as a lower bound`);

  const pointer = await evaluate(cdp, sid, probeSource({ selectors: opts.selectors, touch: false }));

  // --- touch pass -----------------------------------------------------------
  // Done by toggling emulation on the SAME document rather than reloading:
  // Blink re-evaluates the pointer/hover media features when touch emulation
  // changes, which is exactly what is being tested, and a reload here would
  // double the runtime of the slowest pages for nothing. The probe reports
  // `hoverNone` back so a run where the toggle did not take is visible in the
  // JSON rather than silently wrong. The layout can move when it flips (the
  // 44px floor on "How this works" adds ~25px per panel), so it settles again.
  let touch = null;
  if (opts.touch && opts.touchWidths.includes(width)) {
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sid);
    await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: true, configuration: 'mobile' }, sid);
    const s2 = await settle(cdp, sid, { step: opts.settleStep, stable: 2, max: Math.min(opts.settleMax, 8000) });
    const probe = await evaluate(cdp, sid, probeSource({ selectors: [], touch: true }));
    touch = probe.touch;
    touch.settled = s2.settled;
    touch.heightUnderTouch = probe.height;
    if (!touch.hoverNone) {
      errors.push('touch emulation did not flip (hover: none) — tap-target numbers are NOT trustworthy');
    }
    await cdp.send('Emulation.setEmitTouchEventsForMouse', { enabled: false }, sid);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }, sid);
  }

  // --- screenshots ----------------------------------------------------------
  const shotFiles = [];
  if (shots.length) {
    // Back to the pointer layout before shooting, so a screenshot matches the
    // measurement above it rather than the touch pass.
    await settle(cdp, sid, { step: opts.settleStep, stable: 2, max: 5000 });
    for (const sel of shots) {
      const box = await evaluate(cdp, sid, `(() => {
        const el = document.querySelector(${JSON.stringify(sel)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
      })()`);
      if (!box || box.width < 1 || box.height < 1) {
        errors.push(`--screenshot "${sel}" matched nothing on this page`);
        continue;
      }
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 },
        captureBeyondViewport: true,
      }, sid);
      await fsp.mkdir(outDir, { recursive: true });
      const safe = sel.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'element';
      const file = path.join(outDir, `${pageName.replace(/\.html$/, '')}-${width}-${safe}.png`);
      await fsp.writeFile(file, Buffer.from(shot.data, 'base64'));
      shotFiles.push(file);
    }
  }

  return {
    height: pointer.height,
    viewportWidth: pointer.viewportWidth,
    docScrollWidth: pointer.docScrollWidth,
    sideways: pointer.sideways,
    sidewaysBy: pointer.sidewaysBy,
    overflow: pointer.overflow,
    selectors: pointer.selectors,
    panels: pointer.panels,
    pageErrors: pointer.errorText,
    touch,
    settle: s1,
    screenshots: shotFiles,
    errors,
  };
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function run(opts) {
  const exe = findEdge(opts.edge);
  const { server, port } = await serve(opts.root, opts.port);
  const { proc, cdp, userDataDir } = await launchEdge(exe);

  const result = {
    tool: 'measure-layout',
    schema: 1,
    generatedAt: new Date().toISOString(),
    mode: 'demo',
    modeNote: 'Pages driven in DEMO mode: no league saved, every page source pinned to demo. No ESPN connection, no extension.',
    root: opts.root,
    edge: exe,
    widths: opts.widths,
    viewportHeight: opts.height,
    touchPass: opts.touch,
    pages: {},
  };

  let sid = null;
  let targetId = null;
  try {
    const t = await cdp.send('Target.createTarget', { url: 'about:blank' });
    targetId = t.targetId;
    const a = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    sid = a.sessionId;
    await cdp.send('Page.enable', {}, sid);
    await cdp.send('Runtime.enable', {}, sid);
    // Before any page script on every document: see bootstrapSource().
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrapSource() }, sid);

    for (const pageName of opts.pages) {
      if (!fs.existsSync(path.join(opts.root, pageName))) {
        die(`"${pageName}" is not in ${opts.root}. Check --pages / --root.`);
      }
      result.pages[pageName] = {};
      for (const width of opts.widths) {
        const shots = opts.shotWidths.includes(width) ? opts.screenshots : [];
        if (!opts.quiet) process.stderr.write(`  ${pageName} @ ${width}px … `);
        const started = Date.now();
        let row;
        try {
          row = await measurePage(cdp, sid, {
            url: `http://127.0.0.1:${port}/${pageName}`,
            width, height: opts.height, opts, shots,
            outDir: opts.outDir, pageName,
          });
        } catch (err) {
          row = { error: String(err.message || err), errors: [String(err.message || err)] };
        }
        if (!opts.quiet) {
          process.stderr.write(
            row.error ? `FAILED (${row.error})\n`
              : `${row.height}px${row.sideways ? `, SIDEWAYS +${row.sidewaysBy}` : ''} (${Math.round((Date.now() - started) / 100) / 10}s)\n`
          );
        }
        result.pages[pageName][String(width)] = row;
      }
    }
  } finally {
    try { if (targetId) await cdp.send('Target.closeTarget', { targetId }); } catch { /* shutting down */ }
    cdp.close();
    try { proc.kill(); } catch { /* already dead */ }
    server.close();
    // Best effort; a locked profile dir on Windows is not worth failing over.
    fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
  return result;
}

// ---------------------------------------------------------------------------
// Human-readable output
// ---------------------------------------------------------------------------

function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function padl(s, n) { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function printTable(res, opts) {
  const L = [];
  L.push('');
  L.push(`MEASURED IN ${res.mode.toUpperCase()} MODE — ${res.modeNote}`);
  L.push(`Browser: ${res.edge}`);
  L.push(`Root:    ${res.root}`);
  L.push(`Run at:  ${res.generatedAt}`);
  L.push('');

  const header = `${pad('page', 16)}${padl('width', 7)}${padl('height', 9)}${padl('sideways', 11)}${padl('spill', 7)}${padl('bleed', 7)}${padl('clip', 6)}${padl('scroll', 8)}${padl('tap<44', 8)}  settled`;
  L.push(header);
  L.push('-'.repeat(header.length + 2));

  let totals = {};
  for (const [pageName, widths] of Object.entries(res.pages)) {
    let first = true;
    for (const [w, row] of Object.entries(widths)) {
      if (row.error) {
        L.push(`${pad(first ? pageName : '', 16)}${padl(w, 7)}  FAILED: ${row.error}`);
        first = false;
        continue;
      }
      const t = row.touch;
      L.push(
        pad(first ? pageName : '', 16) +
        padl(w, 7) +
        padl(row.height, 9) +
        padl(row.sideways ? `YES +${row.sidewaysBy}` : 'no', 11) +
        padl(row.overflow.spill.length, 7) +
        padl((row.overflow.bleed || []).length, 7) +
        padl(row.overflow.clipped.length, 6) +
        padl(row.overflow.scroller.length, 8) +
        padl(t ? `${t.total}/${t.groups.length}k` : '-', 8) +
        '  ' + (row.settle.settled ? `${(row.settle.ms / 1000).toFixed(1)}s` : `NO (${(row.settle.ms / 1000).toFixed(0)}s cap)`)
      );
      totals[w] = (totals[w] || 0) + row.height;
      first = false;
    }
  }
  L.push('-'.repeat(header.length + 2));
  for (const [w, h] of Object.entries(totals)) {
    L.push(`${pad('WHOLE SITE', 16)}${padl(w, 7)}${padl(h, 9)}`);
  }
  L.push('');
  L.push('  spill  = elements whose content hangs out of them (overflow-x: visible). The defect.');
  L.push('  bleed  = the same, but accounted for by a child\'s negative margin — the .table-scroll');
  L.push('           bleed to the panel edge. Design, not damage. (--all-overflow lists them.)');
  L.push('  clip   = content silently cut off (overflow-x: hidden, no ellipsis).');
  L.push('  scroll = designed sideways scrollers (.table-scroll). Expected; not a regression.');
  L.push('  tap<44 = interactive targets under 44px, as instances/kinds, under touch emulation.');

  // --- sideways detail, because it is the check he cares about -------------
  const sideways = [];
  for (const [pageName, widths] of Object.entries(res.pages)) {
    for (const [w, row] of Object.entries(widths)) {
      if (row.error || !row.sideways) continue;
      sideways.push({ pageName, w, row });
    }
  }
  L.push('');
  if (!sideways.length) {
    L.push('SIDEWAYS SCROLL: none, at any page at any width measured.');
  } else {
    L.push('SIDEWAYS SCROLL — the document itself drags:');
    for (const { pageName, w, row } of sideways) {
      L.push(`  ${pageName} @ ${w}px — ${row.docScrollWidth}px of content in a ${row.viewportWidth}px viewport (+${row.sidewaysBy})`);
      // Every bucket is a candidate here: even a designed scroller drags the
      // document if its own box is wider than the viewport.
      const culprits = [...row.overflow.spill, ...(row.overflow.bleed || []),
                        ...row.overflow.clipped, ...row.overflow.scroller]
        .filter((o) => o.beyondViewport).slice(0, 8);
      for (const c of culprits) L.push(`      ${c.selector}  (${c.scrollWidth}px in ${c.clientWidth}px)`);
    }
  }

  // --- overflow detail ------------------------------------------------------
  L.push('');
  L.push('ELEMENTS OVERFLOWING HORIZONTALLY:');
  let anyOverflow = false;
  for (const [pageName, widths] of Object.entries(res.pages)) {
    for (const [w, row] of Object.entries(widths)) {
      if (row.error) continue;
      const cats = opts.allOverflow
        ? [['spill', row.overflow.spill], ['bleed', row.overflow.bleed || []],
           ['clipped', row.overflow.clipped], ['scroller', row.overflow.scroller]]
        : [['spill', row.overflow.spill], ['clipped', row.overflow.clipped]];
      const lines = [];
      for (const [name, list] of cats) {
        for (const o of list.slice(0, 20)) {
          lines.push(`      [${name}] ${o.selector}  ${o.scrollWidth} in ${o.clientWidth} (+${o.by})${o.beyondViewport ? '  *past the viewport*' : ''}`);
        }
      }
      if (lines.length) {
        anyOverflow = true;
        L.push(`  ${pageName} @ ${w}px`);
        L.push(...lines);
      }
    }
  }
  if (!anyOverflow) L.push(opts.allOverflow ? '  none.' : '  none (designed .table-scroll scrollers excluded; --all-overflow to list them).');

  // --- tracked selectors ----------------------------------------------------
  if (opts.selectors.length) {
    L.push('');
    L.push('TRACKED SELECTORS:');
    for (const sel of opts.selectors) {
      L.push(`  ${sel}`);
      for (const [pageName, widths] of Object.entries(res.pages)) {
        for (const [w, row] of Object.entries(widths)) {
          if (row.error) continue;
          const m = row.selectors[sel];
          if (!m || !m.found) continue;
          L.push(`      ${pad(pageName, 16)} @ ${padl(w, 5)}px   ${padl(m.width, 8)} x ${padl(m.height, 8)}`);
        }
      }
    }
  }

  // --- tap targets ----------------------------------------------------------
  if (res.touchPass) {
    L.push('');
    L.push(`INTERACTIVE TARGETS UNDER ${TOUCH_MIN}px, UNDER TOUCH EMULATION`);
    L.push('  (grouped by KIND — a hundred player links in one table is one fact, not a hundred)');
    for (const [pageName, widths] of Object.entries(res.pages)) {
      for (const [w, row] of Object.entries(widths)) {
        if (row.error || !row.touch) continue;
        L.push(`  ${pageName} @ ${w}px   (hover:none = ${row.touch.hoverNone}, ${row.touch.considered} targets on the page)`);
        if (!row.touch.groups.length) { L.push('      none'); continue; }
        for (const g of row.touch.groups) {
          L.push(`      ${padl(g.count, 4)} x  ${pad(g.kind, 46)} min ${g.minWidth} x ${g.minHeight}   e.g. ${g.examples[0]}${g.sample ? `  "${g.sample}"` : ''}`);
        }
      }
    }
  }

  // --- anything that went wrong --------------------------------------------
  const problems = [];
  for (const [pageName, widths] of Object.entries(res.pages)) {
    for (const [w, row] of Object.entries(widths)) {
      for (const e of row.errors || []) problems.push(`  ${pageName} @ ${w}px — ${e}`);
      for (const e of row.pageErrors || []) problems.push(`  ${pageName} @ ${w}px — page says: "${e}"`);
    }
  }
  if (problems.length) {
    L.push('');
    L.push('NOTES AND FAILURES:');
    L.push(...problems);
  }
  L.push('');
  console.log(L.join('\n'));
}

// ---------------------------------------------------------------------------
// The diff — the actual reason this exists
// ---------------------------------------------------------------------------

function sign(n) { return n > 0 ? `+${n}` : String(n); }

function printDiff(before, after, opts) {
  const L = [];
  L.push('');
  L.push('DELTA');
  L.push(`  before: ${before.generatedAt}   (${before.mode} mode)`);
  L.push(`  after:  ${after.generatedAt}   (${after.mode} mode)`);
  if (before.mode !== after.mode) {
    L.push('  !! DIFFERENT MODES. These two runs are not comparable; the delta below is noise.');
  }
  L.push('');

  const pages = new Set([...Object.keys(before.pages), ...Object.keys(after.pages)]);
  const totals = new Map();   // width -> [beforeSum, afterSum]
  const skipped = [];
  let anyRow = false;

  for (const pageName of [...pages].sort()) {
    const b = before.pages[pageName];
    const a = after.pages[pageName];
    // A page or a width present in only one of the two runs is almost always
    // `--pages trade.html` against a full baseline, not a page that vanished.
    // Say so quietly rather than raising it as a change: a diff that shouts
    // about six untouched pages buries the one line that matters.
    if (!b) { skipped.push(`${pageName} — only in the after run`); continue; }
    if (!a) { skipped.push(`${pageName} — not measured in the after run`); continue; }
    const widths = new Set([...Object.keys(b), ...Object.keys(a)]);
    const lines = [];
    for (const w of [...widths].sort((x, y) => Number(y) - Number(x))) {
      const br = b[w], ar = a[w];
      if (!br || !ar) { skipped.push(`${pageName} @ ${w}px — measured on only one side`); continue; }
      if (br.error || ar.error) {
        anyRow = true;
        lines.push(`      ${padl(w, 6)}px   one side FAILED to measure — not comparable`);
        continue;
      }
      const t = totals.get(w) || [0, 0];
      t[0] += br.height; t[1] += ar.height;
      totals.set(w, t);

      const dh = ar.height - br.height;
      const bits = [];
      if (dh !== 0) bits.push(`height ${br.height} → ${ar.height} (${sign(dh)})`);

      if (br.sideways !== ar.sideways) {
        bits.push(ar.sideways
          ? `*** NOW SCROLLS SIDEWAYS (+${ar.sidewaysBy}px) ***`
          : `sideways scroll FIXED (was +${br.sidewaysBy}px)`);
      } else if (ar.sideways && br.sidewaysBy !== ar.sidewaysBy) {
        bits.push(`still sideways, ${br.sidewaysBy} → ${ar.sidewaysBy}px`);
      }

      // Overflow, by selector rather than by count: a count that stayed at 3
      // while all three selectors changed is the interesting case.
      for (const cat of ['spill', 'clipped', 'bleed', 'scroller']) {
        if ((cat === 'scroller' || cat === 'bleed') && !opts.allOverflow) continue;
        const bs = new Set((br.overflow[cat] || []).map((o) => o.selector));
        const as = new Set((ar.overflow[cat] || []).map((o) => o.selector));
        const added = [...as].filter((s) => !bs.has(s));
        const gone = [...bs].filter((s) => !as.has(s));
        for (const s of added) bits.push(`+ ${cat}: ${s}`);
        for (const s of gone) bits.push(`- ${cat}: ${s}`);
      }

      // Tracked selectors.
      const sels = new Set([...Object.keys(br.selectors || {}), ...Object.keys(ar.selectors || {})]);
      for (const s of sels) {
        const bm = (br.selectors || {})[s], am = (ar.selectors || {})[s];
        if (!bm?.found && !am?.found) continue;
        if (!bm?.found) { bits.push(`${s}: appeared at ${am.width} x ${am.height}`); continue; }
        if (!am?.found) { bits.push(`${s}: gone (was ${bm.width} x ${bm.height})`); continue; }
        const dw = Math.round((am.width - bm.width) * 10) / 10;
        const dhh = Math.round((am.height - bm.height) * 10) / 10;
        if (dw || dhh) bits.push(`${s}: ${bm.width}x${bm.height} → ${am.width}x${am.height} (${sign(dw)} x ${sign(dhh)})`);
      }

      // Tap targets, by kind.
      if (br.touch && ar.touch) {
        const bk = new Map(br.touch.groups.map((g) => [g.kind, g]));
        const ak = new Map(ar.touch.groups.map((g) => [g.kind, g]));
        for (const [kind, g] of ak) {
          const was = bk.get(kind);
          if (!was) bits.push(`+ tap<44: ${kind} x${g.count} (min ${g.minWidth}x${g.minHeight})`);
          else if (was.count !== g.count) bits.push(`  tap<44: ${kind} x${was.count} → x${g.count}`);
        }
        for (const [kind, g] of bk) {
          if (!ak.has(kind)) bits.push(`- tap<44 FIXED: ${kind} (was x${g.count}, min ${g.minWidth}x${g.minHeight})`);
        }
      }

      if (bits.length || opts.diffAll) {
        anyRow = true;
        lines.push(`      ${padl(w, 6)}px   ${bits.length ? bits.join('\n                   ') : 'unchanged'}`);
      }
    }
    if (lines.length) { L.push(`  ${pageName}`); L.push(...lines); L.push(''); }
  }

  if (!anyRow && !opts.diffAll) {
    L.push('  Nothing moved, on everything both runs measured: same heights, same overflow,');
    L.push('  same tap targets, same sideways answer.');
    L.push('');
  }

  if (totals.size) {
    L.push('  SUMMED OVER THE PAGES BOTH RUNS MEASURED:');
    for (const [w, [bh, ah]] of [...totals].sort((x, y) => Number(y[0]) - Number(x[0]))) {
      L.push(`      ${padl(w, 6)}px   ${bh} → ${ah}  (${sign(ah - bh)})`);
    }
  }
  if (skipped.length) {
    L.push('');
    L.push('  Not compared (measured on one side only):');
    for (const s of skipped) L.push(`      ${s}`);
  }
  L.push('');
  console.log(L.join('\n'));
}

async function readRun(file, label) {
  let txt;
  try { txt = await fsp.readFile(file, 'utf8'); }
  catch { die(`could not read ${label} "${file}". Run this tool with --json <file> first to make one.`); }
  let data;
  try { data = JSON.parse(txt); }
  catch { die(`${label} "${file}" is not valid JSON.`); }
  if (data.tool !== 'measure-layout') die(`${label} "${file}" was not written by this tool.`);
  return data;
}

// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  // Pure diff of two saved runs: no browser, no server, no waiting. This is
  // the mode used to answer "what did that change cost?" after the fact.
  if (opts.compare) {
    const before = await readRun(opts.baseline || die('--compare also needs --baseline <file>.'), 'the baseline');
    const after = await readRun(opts.compare, 'the comparison run');
    printDiff(before, after, opts);
    return 0;
  }

  const baseline = opts.baseline ? await readRun(opts.baseline, 'the baseline') : null;

  if (!opts.quiet) process.stderr.write('\nmeasure-layout: demo mode, headless Edge\n');
  const res = await run(opts);

  if (opts.json) {
    await fsp.mkdir(path.dirname(opts.json), { recursive: true });
    await fsp.writeFile(opts.json, JSON.stringify(res, null, 2));
    if (!opts.quiet) process.stderr.write(`\nWrote ${opts.json}\n`);
  }
  if (!opts.quiet) printTable(res, opts);
  if (baseline) printDiff(baseline, res, opts);

  // Exit codes. A measurement that ran is a success even when it found
  // something ugly — this is an instrument, not an assertion — EXCEPT under
  // --fail-on-sideways, which is there so it can be wired into a check later.
  let bad = 0;
  for (const widths of Object.values(res.pages)) {
    for (const row of Object.values(widths)) {
      if (row.error) bad++;
      else if (opts.failOnSideways && row.sideways) bad++;
    }
  }
  if (bad) {
    process.stderr.write(`\nmeasure-layout: ${bad} measurement(s) failed or scrolled sideways. See the table above.\n`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => die(err && err.stack ? err.stack : String(err))
);
