// The weekly summary page, end to end: the real summary.html with its real
// module.
//
//   node test-summary.mjs
//
// What this has to prove is unusual for a page suite, because the product here
// is not the page — it is the IMAGE that leaves the site and gets read by nine
// people with no context. So as well as the table, this checks the words that
// are drawn onto the card: both definitions, the run count, and the DEMO stamp.
// A chart that loses its caveat on the way into a group chat is the failure
// mode this page exists to avoid.
//
// EVERY NUMBER IS RE-DERIVED, never read back off the page. The parent process
// builds the demo season itself, runs `computeLeagueStats` for LUCK and
// `simulateSeason` for the two percentages from its own inputs, and compares.
// That makes "the page shows the right numbers" falsifiable rather than the page
// agreeing with itself — the same rule an-test.mjs and fc-test.mjs follow.
//
// One scenario per child process: an ES module initialises once per process and
// js/summary-page.js self-boots on import, so two boots cannot share one.
//
// The six scenarios:
//   fresh      demo, mid-season — every column filled, plus adaptSimTeam()
//              exercised directly, since that is the contract with forecast.js
//   early      weeks 1 and 2 — the refusal, on the page AND on the image
//   drawn      the card painted against a recording 2d context, then Share and
//              Download pressed for real and the File that came out inspected
//   decided    the last week of the season: no bracket, but still a loser
//   liveFails  a saved "live" preference with ESPN unreachable
//   fallback   Download and Copy pressed where neither can work

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';

const PAGE = 'summary.html';

// ------------------------------------------------------------------- harness

/**
 * @param {Object} o
 * @param {boolean} [o.canShare] pretend the browser can share FILES, which is
 *   the only question the page actually asks. Node's own `navigator` has no
 *   `canShare` at all, so the default is the desktop case.
 * @param {boolean} [o.canvas] give the page a recording 2d context, an anchor
 *   that records its download instead of navigating, and a working object-URL
 *   factory — i.e. everything a real browser has and linkedom does not. That is
 *   what lets the DRAWING and the SHARE be tested rather than only the page.
 */
async function boot({ canShare = false, canvas = false, seed = null } = {}) {
  const html = readFileSync(path.join(REPO, PAGE), 'utf8');
  const { window, document } = parseHTML(html);

  // A recording 2d context. It answers measureText plausibly (so the page's
  // clip() does real work) and keeps every string it was asked to draw, which
  // is how the assertions below read the IMAGE rather than the page.
  const drawn = { text: [], rects: [], fonts: [], transforms: [], fills: [] };
  if (canvas) installCanvas(document, drawn);

  // linkedom defines <select>.value on HTMLSelectElement.prototype and returns
  // undefined; shimming HTMLElement.prototype does nothing (it is shadowed) and
  // would break <input>. See tests/README.md.
  const SelectProto = window.HTMLSelectElement?.prototype;
  if (SelectProto) {
    Object.defineProperty(SelectProto, 'value', {
      configurable: true,
      get() {
        const s = this.querySelector('option[selected]') || this.querySelector('option');
        return s ? s.getAttribute('value') ?? s.textContent : '';
      },
      set(v) {
        for (const o of this.querySelectorAll('option')) {
          if ((o.getAttribute('value') ?? o.textContent) === String(v)) o.setAttribute('selected', '');
          else o.removeAttribute('selected');
        }
      },
    });
  }

  // GOTCHA 1 (tests/README.md): take the table prototype from an element
  // linkedom actually made, NOT from window.HTMLTableElement — they are not the
  // same object here, and defining on the wrong one leaves table.tBodies
  // undefined, which js/sortable.js reads on every repaint.
  const TableProto = Object.getPrototypeOf(document.createElement('table'));
  const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
  Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
  Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
  Object.defineProperty(TableProto, 'rows', {
    configurable: true,
    get() {
      const rows = [];
      const head = kids(this, 'THEAD')[0];
      if (head) rows.push(...kids(head, 'TR'));
      for (const b of kids(this, 'TBODY')) rows.push(...kids(b, 'TR'));
      return rows;
    },
  });
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  Object.defineProperty(RowProto, 'cells', {
    configurable: true,
    get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
  });

  // GOTCHA 2: linkedom gives the window no location, and js/bridge.js reads
  // window.location.origin when its ping timer fires ~400ms in. This page waits
  // well past that for its simulation, so without the shim the throw surfaces
  // as an unhandled rejection out of connection.js and kills the child — which
  // looks exactly like a page failure and is not one.
  window.location = {
    href: `http://localhost/${PAGE}`, origin: 'http://localhost',
    protocol: 'http:', host: 'localhost', hostname: 'localhost',
    pathname: `/${PAGE}`, search: '', hash: '',
  };
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  // Seeded BEFORE the modules import, because js/prefs.js reads its key once and
  // caches it, and js/summary-page.js reads the saved source on its first line.
  const store = new Map(Object.entries(seed || {}).map(([k, v]) => [k, JSON.stringify(v)]));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
  };

  // The share surface. Node has a `navigator`, and it is a non-writable getter
  // on globalThis, so it has to be replaced with defineProperty rather than
  // assigned to. Its `canShare` is what decides whether the button is offered.
  const shared = [];
  const nav = {
    share: async (data) => { shared.push(data); },
    ...(canShare ? { canShare: (d) => Boolean(d && d.files && d.files.length) } : {}),
  };
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  window.navigator = nav;

  const fetchCalls = [];
  Object.assign(globalThis, {
    window, document, localStorage,
    fetch: async (u) => { fetchCalls.push(String(u)); throw new Error(`unexpected network call: ${u}`); },
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.ResizeObserver = globalThis.ResizeObserver;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };

  for (const m of [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((x) => x[1])) {
    await import(pathToFileURL(path.join(REPO, m)).href);
  }

  // 100,000 runs is roughly a second of arithmetic and is deliberately handed
  // off through rAF + setTimeout, so there is nothing to await — poll for the
  // panel to stop saying it is working.
  const settled = await waitFor(
    () => /simulated seasons/.test(text(document.getElementById('simStatus'))) ||
          /Too early|could not run/.test(
            text(document.getElementById('simStatus')) +
            text(document.getElementById('summaryNote'))),
    20000
  );
  await new Promise((r) => setTimeout(r, 60));
  console.error = origError;

  return { document, window, errors, fetchCalls, shared, settled, drawn };
}

/**
 * Everything a real browser gives a <canvas> and linkedom does not.
 *
 * Defined on the PROTOTYPES of elements linkedom actually made — the same rule
 * as the table shims above, and for the same reason: window.HTMLCanvasElement
 * is not reliably the constructor of the element in the document.
 */
function installCanvas(document, drawn) {
  const CanvasProto = Object.getPrototypeOf(document.createElement('canvas'));
  const AnchorProto = Object.getPrototypeOf(document.createElement('a'));

  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1,
    font: '400 15px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
    setTransform(...a) { drawn.transforms.push(a); },
    scale() {}, save() {}, restore() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillRect(x, y, w, h) { drawn.rects.push({ x, y, w, h, fill: this.fillStyle }); },
    strokeRect() {},
    fillText(s, x, y) {
      drawn.text.push({ s: String(s), x, y, font: this.font, align: this.textAlign, fill: this.fillStyle });
      drawn.fonts.push(this.font);
      drawn.fills.push(this.fillStyle);
    },
    // Roughly what a proportional face measures at, which is all clip() needs
    // to make a real decision about whether a name fits.
    measureText(s) {
      const size = Number((/(\d+(?:\.\d+)?)px/.exec(this.font) || [0, 15])[1]);
      return { width: String(s).length * size * 0.55 };
    },
  };

  Object.defineProperty(CanvasProto, 'getContext', {
    configurable: true, value: () => ctx,
  });
  Object.defineProperty(CanvasProto, 'toBlob', {
    configurable: true,
    value(cb) { cb(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })); },
  });
  // The download path, with the navigation taken out of it.
  Object.defineProperty(AnchorProto, 'click', {
    configurable: true,
    value() { drawn.clicked = { href: this.href, download: this.getAttribute('download') }; },
  });
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:stub';
    URL.revokeObjectURL = () => {};
  }
}

/** Poll until `fn()` is true, or give up. Returns whether it became true. */
async function waitFor(fn, ms) {
  const until = Date.now() + ms;
  for (;;) {
    if (fn()) return true;
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

function fire(el, type = 'change') {
  el.dispatchEvent(new globalThis.Event(type, { bubbles: true }));
}

/** Read the chart off the page. `data-v` carries the raw value behind a cell. */
function readTable(document) {
  const table = document.getElementById('summaryTable');
  return [...table.querySelectorAll('tbody tr')].map((tr) => {
    const td = [...tr.children];
    const v = (i) => {
      const raw = td[i].getAttribute('data-v');
      return raw === '' || raw === null ? null : Number(raw);
    };
    return {
      name: text(td[0]),
      luckText: text(td[1]), luck: v(1),
      titleText: text(td[2]), title: v(2),
      lastText: text(td[3]), last: v(3),
    };
  });
}

function readPage(document) {
  const canvas = document.getElementById('shareCanvas');
  const share = document.getElementById('shareBtn');
  return {
    rows: readTable(document),
    badge: text(document.getElementById('modeBadge')),
    sub: text(document.getElementById('pageSub')),
    simStatus: text(document.getElementById('simStatus')),
    note: text(document.getElementById('summaryNote')),
    cardText: document.getElementById('shareText').textContent,
    hint: text(document.getElementById('shareHint')),
    sendStatus: text(document.getElementById('shareStatus')),
    shareHidden: share.hasAttribute('hidden'),
    downloadDisabled: document.getElementById('downloadBtn').hasAttribute('disabled'),
    cardHidden: document.getElementById('cardWrap').hasAttribute('hidden'),
    canvasW: Number(canvas.getAttribute('width')),
    canvasH: Number(canvas.getAttribute('height')),
    canvasStyleH: (canvas.style && canvas.style.height) || '',
    weeks: [...document.querySelectorAll('#weekSelect option')].map((o) => o.getAttribute('value')),
    week: document.getElementById('weekSelect').value,
    headers: [...document.querySelectorAll('#summaryTable thead th')].map((th) => text(th)),
  };
}

// ------------------------------------------------------------------ scenarios

const SCENARIOS = {
  /** The page as it opens: demo data, the default mid-season cut-off. */
  async fresh() {
    const { document, errors, fetchCalls, settled } = await boot();

    // THE ADAPTER, exercised directly. It is the one function that knows what
    // js/forecast.js calls its result fields, so it is the seam a rename over
    // there would break — and the only part of this page another agent has to
    // wire anything to. Importing the module again is free: an ES module
    // initialises once per process, so this is the same instance the page
    // booted, not a second copy with its own DOM.
    const { adaptSimTeam } = await import(pathToFileURL(path.join(REPO, 'js/summary-page.js')).href);
    const adapter = {
      probability: adaptSimTeam({ teamId: 7, pTitle: 0.25, pLast: 0.1 }),
      percent: adaptSimTeam({ teamId: 7, titlePct: 25, lastPct: 10 }),
      missing: adaptSimTeam({ teamId: 7 }),
      nothing: adaptSimTeam(null),
      // A bracket that could not be built hands back nulls, and null is not zero.
      noBracket: adaptSimTeam({ teamId: 7, pTitle: null, pLast: 0.4 }),
    };

    return { errors, fetchCalls, settled, adapter, ...readPage(document) };
  },

  /**
   * Week 1, which is the early-season refusal.
   *
   * The demo season hardcodes every game as played (see js/demo-rosters.js), so
   * this is the only way to see the page as it will really look in September.
   */
  async early() {
    const { document, errors, fetchCalls } = await boot();
    const sel = document.getElementById('weekSelect');
    sel.value = '1';
    fire(sel);
    await new Promise((r) => setTimeout(r, 400));
    const one = readPage(document);

    sel.value = '2';
    fire(sel);
    await new Promise((r) => setTimeout(r, 400));
    const two = readPage(document);

    // And back to a week that has enough season behind it, because a refusal
    // that never lifts is not honesty, it is a broken page.
    sel.value = '4';
    fire(sel);
    await waitFor(() => /simulated seasons/.test(text(document.getElementById('simStatus'))), 20000);
    const four = readPage(document);

    return { errors, fetchCalls, one, two, four };
  },

  /**
   * The last week of the regular season, where there is nothing left to play.
   *
   * A real state, not a curiosity: this is the page in December. There is no
   * bracket to build, so Title % genuinely has no answer — but the wooden spoon
   * does, because last in the regular-season table is already settled. The two
   * columns behaving differently here is the clearest proof that they are
   * answering different questions.
   */
  async decided() {
    const { document, errors } = await boot();
    const sel = document.getElementById('weekSelect');
    const last = [...document.querySelectorAll('#weekSelect option')].pop().getAttribute('value');
    sel.value = last;
    fire(sel);
    await waitFor(
      () => /simulated seasons|could not run|regular season is complete/
        .test(text(document.getElementById('simStatus'))),
      20000
    );
    await new Promise((r) => setTimeout(r, 100));
    return { errors, week: last, ...readPage(document) };
  },

  /**
   * A reader who chose their real league last visit, and ESPN is unreachable.
   *
   * Two things are on trial. First, that the saved source is HONOURED at all:
   * booting demo writes the preference, so a page that checks it afterwards
   * always reads "demo" and quietly puts a connected owner back on sample data
   * while looking completely correct. The only witness to that is a network call
   * being attempted. Second, that a failed live load falls BACK — the toggle
   * snaps to demo and the rows stay on screen, rather than "My ESPN league"
   * sitting selected over demo numbers or the page emptying itself.
   */
  async liveFails() {
    const { document, errors, fetchCalls } = await boot({
      seed: {
        'ff.prefs': { 'summary.source': 'live' },
        'ff.config': { leagueId: '476225250', season: 2026 },
      },
    });
    await new Promise((r) => setTimeout(r, 400));
    return {
      errors,
      triedNetwork: fetchCalls.length,
      status: text(document.getElementById('sourceStatus')),
      on: [...document.querySelectorAll('#sourceToggle button')]
        .filter((b) => (b.getAttribute('class') || '').includes('on'))
        .map((b) => b.getAttribute('data-src')),
      rows: readTable(document).length,
      badge: text(document.getElementById('modeBadge')),
    };
  },

  /** A browser that CAN share files — the phone case. */
  async phone() {
    const { document, errors } = await boot({ canShare: true });
    const before = readPage(document);
    document.getElementById('shareBtn').dispatchEvent(
      new globalThis.Event('click', { bubbles: true })
    );
    await new Promise((r) => setTimeout(r, 200));
    return { errors, before, afterShare: readPage(document).sendStatus };
  },

  /**
   * THE IMAGE ITSELF, drawn against a recording context.
   *
   * This is the scenario that matters most, because the picture is the thing
   * that leaves the site. It checks what was actually painted — the demo band,
   * every member, both percentages, both definitions, the run count — and then
   * presses Share and Download for real and inspects the File that came out.
   */
  async drawn() {
    const { document, errors, drawn, shared } = await boot({ canShare: true, canvas: true });
    const page = readPage(document);

    document.getElementById('shareBtn').dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const shareStatus = text(document.getElementById('shareStatus'));

    document.getElementById('downloadBtn').dispatchEvent(new globalThis.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    const downloadStatus = text(document.getElementById('shareStatus'));

    return {
      errors, page, shareStatus, downloadStatus,
      painted: drawn.text.map((t) => t.s),
      fontSizes: [...new Set(drawn.fonts.map((f) => Number((/(\d+(?:\.\d+)?)px/.exec(f) || [0, 0])[1])))],
      transforms: drawn.transforms,
      bands: drawn.rects.slice(0, 2),
      clicked: drawn.clicked || null,
      shared: shared.map((s) => ({
        title: s.title,
        files: (s.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
      })),
    };
  },

  /**
   * The desktop fallbacks, pressed for real.
   *
   * The trap being tested is a button that silently does nothing: there is no
   * canvas in this harness, so both of these take their failure path, and the
   * requirement is that the failure path SAYS something.
   */
  async fallback() {
    const { document, errors } = await boot();
    const out = { errors, presses: [] };
    for (const id of ['downloadBtn', 'copyBtn']) {
      document.getElementById(id).dispatchEvent(new globalThis.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 200));
      out.presses.push({ id, status: text(document.getElementById('shareStatus')) });
    }
    out.page = readPage(document);
    return out;
  },
};

// --------------------------------------------------------------- child runner

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const name = process.argv[2];
  try {
    const out = await SCENARIOS[name]();
    console.log('@@' + JSON.stringify(out));
    process.exit(0);
  } catch (err) {
    console.log('@@' + JSON.stringify({ boot: String((err && err.stack) || err) }));
    process.exit(1);
  }
}

function run(name) {
  const res = spawnSync(process.execPath, [self, name], {
    encoding: 'utf8', cwd: path.dirname(self), maxBuffer: 32 * 1024 * 1024,
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error(`no result for ${name}\n${res.stdout}\n${res.stderr}`);
  return JSON.parse(line.slice(2));
}

// ------------------------------------------------- the independent re-derivation
//
// Built in the PARENT, from the demo season itself, through the same shared
// modules the site uses — never from anything the page produced. If the page's
// own split of banked-versus-remaining is wrong, or it hands the simulation a
// different sigma, or it reads the wrong field off a result row, these numbers
// disagree and the suite fails. That is the point.

const { generateDemoLeague } = await import(moduleUrl('js/demo.js'));
const { computeLeagueStats } = await import(moduleUrl('js/stats.js'));
const forecast = await import(moduleUrl('js/forecast.js'));

const demo = generateDemoLeague();
const THROUGH = 8;                        // js/summary-page.js's DEMO_THROUGH
const RUNS = 100000;                      // Tim asked for this by name
const SEED = 20260901;                    // shared with the schedule page
const FIELD = forecast.DEFAULT_PLAYOFF_TEAMS ?? 6;

/** LUCK as of week N, from the sheet's own column in js/stats.js. */
function expectedLuck(through) {
  const games = demo.games.filter((g) => g.week <= through);
  const stats = computeLeagueStats({
    season: demo.season, name: demo.name, isDemo: true,
    weeks: new Set(games.map((g) => g.week)).size,
    teams: demo.teams, games, injuries: [],
  });
  return new Map(stats.teams.map((t) => [t.name, t.luckScore]));
}

/** The simulation, from inputs this file builds rather than borrows. */
function expectedSim(through) {
  const teamIds = demo.teams.map((t) => t.id);
  const banked = new Map(teamIds.map((id) => [id, { wins: 0, pointsFor: 0 }]));
  const bankedGames = demo.games.filter((g) => g.week <= through);
  for (const g of bankedGames) {
    const h = banked.get(g.homeId);
    const a = banked.get(g.awayId);
    h.pointsFor += g.homeActual;
    a.pointsFor += g.awayActual;
    if (g.homeActual > g.awayActual) h.wins += 1;
    else if (g.awayActual > g.homeActual) a.wins += 1;
    else { h.wins += 0.5; a.wins += 0.5; }
  }
  const games = demo.games.filter((g) => g.week > through).map((g) => ({
    homeId: g.homeId, awayId: g.awayId,
    homeProj: g.homeProjected, awayProj: g.awayProjected,
  }));
  const sigma = forecast.calibrateSigma(bankedGames).sigma;
  const last = Math.max(...demo.games.map((g) => g.week));
  const rounds = forecast.playoffRoundCount(FIELD);
  const result = forecast.simulateSeason({
    teamIds, banked, games, sigma, runs: RUNS, seed: SEED,
    playoff: { teams: FIELD, weeks: Array.from({ length: rounds }, (_, i) => last + 1 + i), proj: null },
  });
  const nameById = new Map(demo.teams.map((t) => [t.id, t.name]));
  return {
    byName: new Map(result.teams.map((t) => [nameById.get(t.teamId), t])),
    result, games: games.length, rounds,
  };
}

const luck8 = expectedLuck(THROUGH);
const sim8 = expectedSim(THROUGH);

// ------------------------------------------------------------------ assertions

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`);
};
const eq = (a, b, msg) => ok(msg, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a, b, tol, msg) =>
  ok(msg, Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol,
     `got ${a}, want ${b} (±${tol})`);

// ---- it opens on demo data, mid-season, with every column filled ------------

const fresh = run('fresh');
ok('the page boots', !fresh.boot, fresh.boot);

if (!fresh.boot) {
  ok('no console errors', fresh.errors.length === 0, fresh.errors.slice(0, 2).join(' | '));
  ok('and no network call — the demo season carries its own projections',
    fresh.fetchCalls.length === 0, fresh.fetchCalls.slice(0, 2).join(' | '));
  ok('the simulation finished rather than timing out', fresh.settled, fresh.simStatus);
  eq(fresh.badge, 'Demo', 'it opens on demo data and says so');
  eq(fresh.week, String(THROUGH), 'and opens mid-season, where every column has something to say');

  // ---- the adapter, which is the contract with js/forecast.js -------------
  //
  // Everything else on this page reads a simulation row through adaptSimTeam(),
  // so these five cases are the whole of what a rename in forecast.js could
  // break. Both spellings are accepted, and the "Pct" one is divided by a
  // hundred — a name ending in per-cent means per cent.
  const ad = fresh.adapter;
  eq(ad.probability.title, 0.25, 'the adapter reads pTitle as a probability');
  eq(ad.probability.last, 0.1, 'and pLast as a probability');
  eq(ad.percent.title, 0.25, 'titlePct is treated as PER CENT and scaled to a probability');
  eq(ad.percent.last, 0.1, 'and so is lastPct');
  eq(ad.probability.teamId, 7, 'the team id is carried through');
  eq(ad.missing.title, null, 'a row with neither spelling gives null, not zero');
  eq(ad.nothing, null, 'and no row at all gives null rather than throwing');
  eq(ad.noBracket.title, null, 'a null title stays null — no bracket is not a 0% chance');
  eq(ad.noBracket.last, 0.4, 'while the other column is still read');

  // ---- the shape of the chart --------------------------------------------
  eq(fresh.rows.length, demo.teams.length, 'one row per league member');
  ok('and every member appears exactly once',
    new Set(fresh.rows.map((r) => r.name)).size === demo.teams.length,
    fresh.rows.map((r) => r.name).join(','));
  ok('the members are the PEOPLE, not the ESPN team names',
    fresh.rows.every((r) => demo.teams.some((t) => t.name === r.name)),
    fresh.rows.map((r) => r.name).join(','));
  eq(fresh.headers.join(' | '), 'Member | LUCK | Title % | Loser %',
    'four columns, exactly the four Tim asked for');

  // ---- LUCK, re-derived ---------------------------------------------------
  ok('every row carries a LUCK value', fresh.rows.every((r) => r.luck !== null),
    JSON.stringify(fresh.rows.map((r) => [r.name, r.luckText])));
  for (const r of fresh.rows) {
    near(r.luck, luck8.get(r.name), 1e-9,
      `${r.name}: LUCK is the sheet's own column as of week ${THROUGH}`);
  }
  ok('LUCK is not all one value — a column of identical numbers would mean it is not wired up',
    new Set(fresh.rows.map((r) => r.luck)).size > 1,
    fresh.rows.map((r) => r.luck).join(','));
  ok('and every LUCK cell prints its sign, so the table reads without colour',
    fresh.rows.every((r) => /^[+-]?\d/.test(r.luckText)),
    fresh.rows.map((r) => r.luckText).join(' '));

  // ---- the two percentages, re-derived -----------------------------------
  for (const r of fresh.rows) {
    const want = sim8.byName.get(r.name);
    near(r.title, want.pTitle, 1e-9, `${r.name}: title % is the simulated championship rate`);
    near(r.last, want.pLast, 1e-9, `${r.name}: loser % is the simulated last-in-the-table rate`);
  }

  // EXACTLY ONE CHAMPION AND EXACTLY ONE LAST PLACE PER SIMULATED SEASON, so
  // both columns are a partition of the league and must total the whole of it.
  // A column that sums to six is the playoff-qualification rate wearing the
  // title column's hat, which is a real way for this to go wrong.
  const sumTitle = fresh.rows.reduce((a, r) => a + (r.title ?? 0), 0);
  const sumLast = fresh.rows.reduce((a, r) => a + (r.last ?? 0), 0);
  near(sumTitle * 100, 100, 1e-6, 'title % sums to 100 across the league');
  near(sumLast * 100, 100, 1e-6, 'loser % sums to 100 across the league');
  ok('every percentage is a real probability',
    fresh.rows.every((r) => r.title >= 0 && r.title <= 1 && r.last >= 0 && r.last <= 1));

  // The two questions are genuinely different. If the page had wired the same
  // field into both columns this would be the assertion that noticed.
  ok('title % and loser % are different numbers, not the same one twice',
    fresh.rows.some((r) => Math.abs(r.title - r.last) > 0.01),
    JSON.stringify(fresh.rows.map((r) => [r.name, r.title, r.last])));

  // ---- the note: the house rule about stating a basis ---------------------
  for (const phrase of [
    'championship round',
    'last in the regular-season standings',
    'consolation ladder',
    '100,000 simulated seasons',
    'our model, not espn',
  ]) {
    ok(`the note explains "${phrase}"`, fresh.note.toLowerCase().includes(phrase),
      fresh.note.slice(0, 220));
  }
  ok('the panel says how long the run actually took on this device',
    /in \d+(\.\d+)?(ms|s) on this device/.test(fresh.simStatus), fresh.simStatus);
  ok('and how many games were played out in each season',
    fresh.simStatus.includes(`${sim8.games} games`), fresh.simStatus);

  // ---- THE IMAGE, which is the half that leaves the site -------------------
  //
  // linkedom has no canvas, so what is checked here is the card's CONTENT —
  // the plain-text twin is built from the same rows and the same sentences —
  // plus the canvas's own pixel dimensions.
  const card = fresh.cardText;
  eq(fresh.canvasW, 760 * 2, 'the canvas is sized at 2x for retina, in its width attribute');
  ok('and its height attribute is 2x too, not a CSS size',
    fresh.canvasH > 0 && fresh.canvasH % 2 === 0, fresh.canvasH);

  ok('the image names the league', card.includes(demo.name), card.slice(0, 120));
  ok('and the week, because it will be read weeks later in a scrolled-back thread',
    new RegExp(`week ${THROUGH}\\b`, 'i').test(card), card.slice(0, 200));
  ok('the image states the run count — a percentage with no run count cannot be checked',
    /100,000 simulations/.test(card), card);
  ok('the image defines "title" as the championship round',
    /Title % = wins the championship round/.test(card), card);
  ok('the image defines "loser" as LAST IN THE REGULAR SEASON',
    /Loser % = LAST IN THE REGULAR SEASON/.test(card), card);
  ok('and says on the image that it is not the consolation ladder',
    /not the consolation ladder/i.test(card), card);
  ok('the image says the numbers are ours and not ESPN’s',
    /not ESPN/i.test(card), card);
  ok('the image spells out what LUCK is', /LUCK =/.test(card), card);
  ok('every member is on the image', demo.teams.every((t) => card.includes(t.name)),
    card);

  // DEMO MUST BE STAMPED ON THE PICTURE. A demo chart forwarded into his league
  // looking real is the one failure here that cannot be taken back.
  ok('the image is stamped DEMO when it is demo data',
    /DEMO DATA — NOT A REAL LEAGUE/.test(card), card.slice(0, 160));

  // ---- the share control, on a browser that cannot share files ------------
  ok('the Share button is hidden when navigator.canShare says no',
    fresh.shareHidden, 'the share button was offered on a browser that cannot share a file');
  ok('and the page says why, and what to use instead',
    /will not let a page share a file/.test(fresh.hint) && /Download/.test(fresh.hint),
    fresh.hint);
  ok('the text fallback is on screen and selectable without pressing anything',
    card.length > 200, `${card.length} chars`);
}

// ---- the early-season refusal ----------------------------------------------

const early = run('early');
ok('the early-season scenario boots', !early.boot, early.boot);

if (!early.boot) {
  ok('no console errors', early.errors.length === 0, early.errors.slice(0, 2).join(' | '));

  for (const [label, got] of [['week 1', early.one], ['week 2', early.two]]) {
    eq(got.rows.length, demo.teams.length, `${label}: the members are still listed`);
    // SHOWN FROM WEEK 1 (Tim, 2026-09-17), like the Stats page's LUCK — with
    // the same ± on screen, and an early-season line in the note.
    ok(`${label}: LUCK is shown from the first week`,
      got.rows.every((r) => r.luck !== null && /^[+-]?\d/.test(r.luckText)),
      JSON.stringify(got.rows.map((r) => r.luckText)));
    ok(`${label}: with the Stats page's ± beside it`,
      got.rows.every((r) => /±\d+/.test(r.luckText)),
      JSON.stringify(got.rows.map((r) => r.luckText)));
    ok(`${label}: title % is shown`, got.rows.every((r) => r.title !== null),
      JSON.stringify(got.rows.map((r) => r.titleText)));
    ok(`${label}: loser % is shown`, got.rows.every((r) => r.last !== null),
      JSON.stringify(got.rows.map((r) => r.lastText)));
    near(got.rows.reduce((a, r) => a + r.title, 0) * 100, 100, 1e-6, `${label}: title % still sums to 100`);
    ok(`${label}: and the note says it is early`,
      /Early season/.test(got.note), got.note.slice(0, 220));
    ok(`${label}: the shareable copy carries the percentages`,
      /\d+%/.test(got.cardText), got.cardText);
  }

  ok('at week 4 the numbers are there',
    early.four.rows.every((r) => r.luck !== null && r.title !== null && r.last !== null),
    JSON.stringify(early.four.rows.slice(0, 3)));
  const sum4 = early.four.rows.reduce((a, r) => a + r.title, 0);
  near(sum4 * 100, 100, 1e-6, 'and they still sum to 100 at a different cut-off');

  // Moving the cut-off must actually move the answers. If the page cached the
  // week-8 run against a key that ignores the week, this is what would notice.
  const luck4 = expectedLuck(4);
  for (const r of early.four.rows) {
    near(r.luck, luck4.get(r.name), 1e-9, `${r.name}: LUCK follows the cut-off week`);
  }
  ok('and the simulation is re-run for the new cut-off rather than cached across it',
    early.four.rows.some((r) => {
      const at8 = sim8.byName.get(r.name);
      return Math.abs(r.title - at8.pTitle) > 1e-9;
    }),
    'every title % at week 4 equals its week 8 value, so the run was not redone');
}

// ---- the season already decided --------------------------------------------

const decided = run('decided');
ok('the decided-season scenario boots', !decided.boot, decided.boot);
if (!decided.boot) {
  ok('no console errors', decided.errors.length === 0, decided.errors.slice(0, 2).join(' | '));
  eq(decided.week, '13', 'the picker reaches the last week of the demo season');

  ok('with no games left there is no title to simulate, so the column is blank',
    decided.rows.every((r) => r.title === null && r.titleText === '—'),
    JSON.stringify(decided.rows.map((r) => r.titleText)));
  // AND THE OTHER COLUMN STILL WORKS. Last in the regular-season table is a
  // fact about the table, not about the bracket — which is exactly Tim's rule,
  // and the reason the two columns cannot be computed from one number.
  const spoon = decided.rows.filter((r) => r.last === 1);
  eq(spoon.length, 1, 'exactly one manager is certain to finish last');
  ok('and everybody else is certain not to',
    decided.rows.filter((r) => r.last === 0).length === decided.rows.length - 1,
    JSON.stringify(decided.rows.map((r) => [r.name, r.last])));
  ok('the page says WHY the title column is blank rather than leaving it a mystery',
    /no games left to play out/i.test(decided.note), decided.note.slice(-360));
  ok('and the image says it too, along with why the loser column is still there',
    /regular season is complete/.test(decided.cardText) &&
    /no title left to play for/.test(decided.cardText), decided.cardText);
  // A HUNDRED THOUSAND REPLAYS OF A FINISHED SEASON ARE A HUNDRED THOUSAND
  // IDENTICAL TABLES. Quoting a run count for that would dress a certainty up
  // as an estimate, which is the opposite of what the run count is for.
  ok('and never quotes a run count for a season it did not simulate',
    !/simulations/.test(decided.cardText), decided.cardText);
  ok('the panel says the same thing in the same words',
    /nothing left to play out/.test(decided.simStatus), decided.simStatus);
}

// ---- a saved "live" preference, with ESPN unreachable ----------------------

const lf = run('liveFails');
ok('the live-failure scenario boots', !lf.boot, lf.boot);
if (!lf.boot) {
  ok('the saved source really is honoured — the page tried to reach ESPN',
    lf.triedNetwork > 0,
    'no network call was attempted, so the saved "live" preference was ignored');
  // The specific witness, not just "a status exists": the demo loader's own
  // message would still be sitting there if the live attempt had never been
  // made, and that is precisely the bug this scenario exists to catch.
  ok('and the failure is reported in words rather than swallowed',
    /Could not reach ESPN|ESPN/.test(lf.status) && !/Generated sample data/.test(lf.status),
    `"${lf.status}"`);
  eq(lf.on.join(','), 'demo', 'the toggle snaps back, so "My ESPN league" is never selected over demo numbers');
  eq(lf.badge, 'Demo', 'and the badge agrees with the toggle');
  eq(lf.rows, demo.teams.length, 'the chart is still on screen rather than emptied');
}

// ---- a browser that CAN share files ----------------------------------------

const phone = run('phone');
ok('the phone scenario boots', !phone.boot, phone.boot);
if (!phone.boot) {
  ok('no console errors', phone.errors.length === 0, phone.errors.slice(0, 2).join(' | '));
  ok('the Share button IS offered when canShare({files}) says yes',
    !phone.before.shareHidden, 'the share button stayed hidden on a browser that can share');
  ok('and the hint describes the share sheet rather than the fallbacks',
    /share sheet/.test(phone.before.hint), phone.before.hint);
  // No canvas in the harness, so the press takes the "nothing to share" path —
  // and the requirement is that it SAYS so rather than doing nothing.
  ok('pressing Share always reports what happened',
    phone.afterShare.length > 0, `"${phone.afterShare}"`);
}

// ---- the image, actually drawn ---------------------------------------------

const drawn = run('drawn');
ok('the drawing scenario boots', !drawn.boot, drawn.boot);
if (!drawn.boot) {
  ok('no console errors while drawing', drawn.errors.length === 0, drawn.errors.slice(0, 2).join(' | '));
  ok('the card frame is shown once there is a picture in it', !drawn.page.cardHidden);

  // The footnotes are word-wrapped onto the card, so a sentence can arrive as
  // two or three fillText calls. Joined with a space they read back exactly as
  // written, which is what makes "the definition is on the image" checkable.
  const painted = drawn.painted.join(' ');

  // 2x, set on the CONTEXT rather than by stretching a 1x bitmap with CSS.
  ok('the context is scaled 2x in both axes for retina',
    drawn.transforms.some((t) => t[0] === 2 && t[3] === 2),
    JSON.stringify(drawn.transforms));

  // Legible in a Messages thumbnail means large type. The row figures are the
  // ones that have to survive being shrunk, so they are the ones checked.
  ok('the rows are drawn at 22px or larger, so they read as a thumbnail',
    drawn.fontSizes.some((s) => s >= 22), JSON.stringify(drawn.fontSizes));
  ok('and the title is larger still', drawn.fontSizes.some((s) => s >= 30),
    JSON.stringify(drawn.fontSizes));

  ok('the league name is painted', drawn.painted.includes(demo.name), painted.slice(0, 200));
  ok('the week is painted', drawn.painted.some((s) => new RegExp(`Week ${THROUGH}\\b`).test(s)),
    painted.slice(0, 300));
  ok('all four column headings are painted',
    ['MEMBER', 'LUCK', 'TITLE %', 'LOSER %'].every((h) => drawn.painted.includes(h)),
    painted.slice(0, 300));

  for (const t of demo.teams) {
    ok(`${t.name} is painted onto the image`, drawn.painted.includes(t.name), painted.slice(0, 400));
  }
  // Every row's own three numbers reached the canvas, in the page's own
  // formatting — so a row cannot be on the image with its numbers missing.
  for (const r of drawn.page.rows) {
    const luckOnly = r.luckText.replace(/\s*±.*$/, '');   // the ± is on the page, not the image
    ok(`${r.name}: LUCK reached the canvas`, drawn.painted.includes(luckOnly), r.luckText);
    ok(`${r.name}: title % reached the canvas`, drawn.painted.includes(r.titleText), r.titleText);
    ok(`${r.name}: loser % reached the canvas`, drawn.painted.includes(r.lastText), r.lastText);
  }

  // NO EXPLANATION LINES ON THE IMAGE (Tim, 2026-09-17). The definitions live
  // on the page and in the plain-text copy; the picture is the table alone.
  for (const [label, re] of [
    ['title definition', /championship round/],
    ['loser definition', /REGULAR SEASON/],
    ['consolation ladder', /consolation ladder/i],
    ['run count', /simulations/],
    ['not ESPN’s', /not ESPN/i],
    ['LUCK definition', /LUCK =/],
  ]) {
    ok(`the image carries no ${label} line`, !re.test(painted), painted);
  }
  // THE IPHONE STRETCH. A pixel height in CSS stays put while max-width
  // shrinks the width on a phone, so the card was drawn tall and thin.
  ok('the canvas height is never pinned in CSS, so a phone keeps its shape',
    !/px$/.test(drawn.page.canvasStyleH), drawn.page.canvasStyleH);
  ok('the card is exactly title + table tall, with no footnote block',
    drawn.page.canvasH === (46 + 96 + 34 + drawn.page.rows.length * 38 + 20) * 2,
    String(drawn.page.canvasH));
  ok('the DEMO stamp is painted', /DEMO DATA — NOT A REAL LEAGUE/.test(painted), painted);
  ok('and it is painted as a band across the top of the card, not buried',
    drawn.bands.some((r) => r.y === 0 && r.w >= 700 && r.h >= 30),
    JSON.stringify(drawn.bands));

  // ---- the share contract -------------------------------------------------
  eq(drawn.shared.length, 1, 'pressing Share calls navigator.share exactly once');
  if (drawn.shared.length) {
    const s = drawn.shared[0];
    eq(s.files.length, 1, 'and hands it exactly one file');
    eq(s.files[0].type, 'image/png', 'which is a PNG');
    ok('named for the league and the week, so a downloads folder stays readable',
      /^demo-league-week-8\.png$/.test(s.files[0].name), s.files[0].name);
    ok('with a title naming the week and the league', /Week 8/.test(s.title || ''), s.title);
  }
  ok('and the page reports that it went to the share sheet, not that it was sent',
    /share sheet/.test(drawn.shareStatus) && /Nothing has been sent/.test(drawn.shareStatus),
    drawn.shareStatus);

  // ---- the download contract ----------------------------------------------
  ok('Download really does hand the browser a file to save',
    drawn.clicked && drawn.clicked.download === 'demo-league-week-8.png',
    JSON.stringify(drawn.clicked));
  ok('and says where it went', /Saved demo-league-week-8\.png/.test(drawn.downloadStatus),
    drawn.downloadStatus);
}

// ---- the desktop fallbacks actually fire -----------------------------------

const fb = run('fallback');
ok('the fallback scenario boots', !fb.boot, fb.boot);
if (!fb.boot) {
  ok('no console errors', fb.errors.length === 0, fb.errors.slice(0, 2).join(' | '));
  // A DISABLED BUTTON EXPLAINS NOTHING. Both fallbacks stay live even when
  // there is nothing to save, so pressing one produces a sentence rather than a
  // dead control the reader has to guess about.
  ok('the Download button is left pressable so it can explain itself',
    !fb.page.downloadDisabled, 'Download was disabled, so a press says nothing at all');
  for (const p of fb.presses) {
    ok(`pressing ${p.id} says something rather than silently doing nothing`,
      p.status.length > 0, `"${p.status}"`);
  }
  ok('Download explains that there was no image to save, and points at the text',
    /could not be drawn/.test(fb.presses[0].status) && /text version/.test(fb.presses[0].status),
    fb.presses[0].status);
  ok('Copy explains that the clipboard was refused, and points at the text box',
    /clipboard/i.test(fb.presses[1].status) && /select it/.test(fb.presses[1].status),
    fb.presses[1].status);
  // With no canvas at all the card frame is hidden rather than left as an empty
  // white rectangle pretending to be a chart.
  ok('and with no canvas the image frame is hidden rather than left blank',
    fb.page.cardHidden, 'the empty canvas was left on screen');
  ok('with the reason said out loud',
    /cannot draw to a canvas/.test(fb.page.hint), fb.page.hint);
  ok('and the canvas fact is said ALONGSIDE the sharing fact, not instead of it',
    /will not let a page share a file/.test(fb.page.hint), fb.page.hint);
}

// ---------------------------------------------------------------------------

if (fails.length) {
  for (const f of fails.slice(0, 30)) console.log('FAIL ' + f);
  if (fails.length > 30) console.log(`… and ${fails.length - 30} more`);
}
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
