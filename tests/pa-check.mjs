// Players page: Player analysis (Tim, 2026-10-28) — the search, his card's
// strip and glance line, the future-proj-by-week graph and the each-week's-proj
// graph, booted on the real page with saved weeks seeded in localStorage.
//
//   node pa-check.mjs
//
// The league is the Players-page stub (marks-register: ten squads of fifteen,
// seven weeks played, week 8 now, regular weeks 1–13, every rostered man on NFL
// team 1 whose bye is week 5). The saved weeks are the stored shape at a real
// size (every squad's fifteen rows, `weeks` from that week through 17). The man
// looked at is T4 Player 03 (id 403, WR); each saved week says a flat number
// for him so every point can be worked by hand:
//
//   week 2 copy: 9 a week     week 3 copy: 11 a week     week 5 copy: 13 a week
//   (0 in his bye, week 5, in each)       — no copy of week 4, 6 or 7
//
// His position's waiver line is 6 (FF_VALUE), so a 0 / the bye counts as 6.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { emit } from './emit.mjs';

const ME = 4;
const CONN = { leagueId: '99', season: 2026, teamId: ME };
const LIVE = { 'waivers.source': 'live' };
const MAN = 403;
const BYE = 5;
const FILL = 6;
const REG = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const FLAT = { 2: 9, 3: 11, 5: 13 };
const VALUE = {
  base: { v: 1, setAt: 0, week: 1, lines: {
    QB: { waiver: 10, starter: 18 }, RB: { waiver: 6, starter: 12 }, WR: { waiver: FILL, starter: 12 },
    TE: { waiver: 5, starter: 9 }, K: { waiver: 6, starter: 8 }, DST: { waiver: 5, starter: 8 },
  } },
  weeks: [8, 9, 10, 11, 12, 13],
  players: {},
};

// The stub's own projection (an-stub-season.mjs `projFor`), for the other men.
const stubProj = (i, w) => (i === 3 && w === 6 ? 0 : i === 4 && w === 7 ? null : Math.round(((20 - i) + w * 0.3) * 10) / 10);

function copyOf(asOf) {
  const weeks = [];
  for (let w = asOf; w <= 17; w++) weeks.push(w);
  const teams = {};
  for (let t = 1; t <= 10; t++) {
    teams[t] = [];
    for (let i = 0; i < 15; i++) {
      const id = t * 100 + i;
      const proj = weeks.map((w) => (id === MAN ? (w === BYE ? 0 : FLAT[asOf]) : w > 13 ? null : stubProj(i, w)));
      teams[t].push([id, `T${t} Player ${String(i).padStart(2, '0')}`, 'WR', 'BUF', 20, 'ACTIVE', proj]);
    }
  }
  return { v: 1, leagueId: '99', season: 2026, week: asOf, takenAt: '2026-09-10T00:00:00.000Z',
    weeks, cols: ['id', 'name', 'pos', 'team', 'slot', 'inj', 'proj'], teams };
}

const SCENARIOS = {
  live: {
    label: '(a) saved weeks 2, 3, 5 and now: four points worked by hand, the gap note, four lines red to green, the previews',
    prefs: LIVE, conn: CONN, copies: [2, 3, 5],
  },
  none: {
    label: '(b) no saved weeks: the live point alone and "No saved projections before week 8."',
    prefs: LIVE, conn: CONN, copies: [],
  },
  demo: {
    label: '(c) the sample league: his card, "Sample data has no saved projections.", no graphs',
    prefs: { 'waivers.source': 'demo' }, conn: null, copies: [],
  },
};

async function boot(scenario) {
  const cfg = SCENARIOS[scenario];
  const html = readFileSync(path.join(REPO, 'waivers.html'), 'utf8');
  const { window, document } = parseHTML(html);
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
  if (!window.location) {
    window.location = { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', pathname: '/waivers.html', search: '', hash: '' };
  }
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  // A storage that can be walked (`length` / `key`): js/proj-history.js scans keys.
  const store = new Map();
  if (cfg.prefs) store.set('ff.prefs', JSON.stringify(cfg.prefs));
  if (cfg.conn) store.set('ff.connection', JSON.stringify(cfg.conn));
  for (const w of cfg.copies) store.set(`ff.projhist.1.99.2026.${w}`, JSON.stringify(copyOf(w)));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  const fetch = async (url) => { throw new Error(`unexpected network call: ${url}`); };
  Object.assign(globalThis, {
    window, document, localStorage, fetch,
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;
  window.ResizeObserver = globalThis.ResizeObserver;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;

  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  const rejections = [];
  process.on('unhandledRejection', (r) => rejections.push(String(r)));
  await import(pathToFileURL(path.join(REPO, 'js/waivers-page.js')).href);
  await new Promise((r) => setTimeout(r, 2500));
  console.error = origError;
  return { document, window, errors, rejections };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const hidden = (el) => !el || el.hasAttribute('hidden');
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Type a name, then press the first suggestion the way a tap does. */
async function search(d, w, q) {
  const input = d.getElementById('paFind');
  input.value = q;
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
  const items = [...d.querySelectorAll('#paList li')].map(text);
  const li = d.querySelector('#paList li[data-i]');
  if (li) li.dispatchEvent(new w.Event('mousedown', { bubbles: true, cancelable: true }));
  await sleep(1500);
  return items;
}

/** What one point says: its as-of week and its average, off its aria-label. */
const pointsOf = (d) => [...d.querySelectorAll('#paTrend g.pa-pt')].map((g) => {
  const m = /future proj ([\d.]+)/.exec(g.getAttribute('aria-label') || '');
  return { asOf: Number(g.getAttribute('data-asof')), avg: m ? Number(m[1]) : null, now: /\bnow\b/.test(g.getAttribute('class')) };
});

async function check(scenario, { document: d, window: w, errors, rejections }) {
  const out = [];
  const ok = (name, cond, detail = '') => out.push({ name, pass: Boolean(cond), detail: cond ? '' : String(detail).slice(0, 600) });

  ok('the panel is there, first after Data source', d.getElementById('paPanel') &&
    d.querySelector('section.source-panel').nextElementSibling === d.getElementById('paPanel'), 'missing or moved');
  ok('the house shape: title, one lede, the explain toggle', text(d.querySelector('#paPanel h2')) === 'Player analysis' &&
    d.querySelectorAll('#paPanel > p.lede').length === 1 && d.querySelector('#paPanel details.explain'), 'shape');
  ok('nothing drawn before a pick', hidden(d.getElementById('paBody')), 'paBody shown');

  if (scenario === 'demo') {
    const items = await search(d, w, 'a');
    ok('the search suggests sample men', items.length > 0 && !/No player/.test(items[0]), JSON.stringify(items.slice(0, 3)));
    ok('his card: the week strip', !hidden(d.getElementById('paBody')) && d.querySelector('#paCard table.tc-run'), text(d.getElementById('paCard')).slice(0, 200));
    ok('the note says the sample has none', text(d.getElementById('paNote')) === 'Sample data has no saved projections.', text(d.getElementById('paNote')));
    ok('and no graphs', hidden(d.getElementById('paGraphs')), 'graphs shown');
  } else {
    const items = await search(d, w, 'T4 Player 03');
    ok('the search finds him by name', items[0] && items[0].startsWith('T4 Player 03'), JSON.stringify(items.slice(0, 3)));
    const none = await (async () => {
      const input = d.getElementById('paFind');
      input.value = 'zzqx';
      input.dispatchEvent(new w.Event('input', { bubbles: true }));
      const t = text(d.getElementById('paList'));
      input.value = 'T4 Player 03';
      return t;
    })();
    ok('a name nobody has says so', /No player by that name/.test(none), none);
    const card = d.getElementById('paCard');
    ok('his card: the name, and the strip with every week of the season', /T4 Player 03/.test(text(card.querySelector('.tc-ident'))) &&
      [...card.querySelectorAll('table.tc-run thead th[scope="col"]')].length >= 13, text(card).slice(0, 300));
    ok('his card: the strip has the played weeks behind the line', card.querySelector('table.tc-run .split-start'), 'no split line');

    const pts = pointsOf(d);
    const live = mean([8, 9, 10, 11, 12, 13].map((wk) => stubProj(3, wk)));
    const want = scenario === 'live'
      ? [
        { asOf: 2, avg: (9 * 11 + FILL) / 12 },
        { asOf: 3, avg: (11 * 10 + FILL) / 11 },
        { asOf: 5, avg: (13 * 8 + FILL) / 9 },
        { asOf: 8, avg: live, now: true },
      ]
      : [{ asOf: 8, avg: live, now: true }];
    ok('one point per saved week holding him, then now', JSON.stringify(pts.map((p) => p.asOf)) === JSON.stringify(want.map((p) => p.asOf)),
      JSON.stringify(pts));
    for (const wp of want) {
      const got = pts.find((p) => p.asOf === wp.asOf);
      ok(`week ${wp.asOf}: future proj ${wp.avg.toFixed(2)} (a bye counted as the waiver line ${FILL})`,
        got && got.avg !== null && Math.abs(got.avg - wp.avg) <= 0.051, JSON.stringify(got));
    }
    ok('the rightmost point is this week, marked as now', pts.length && pts[pts.length - 1].asOf === 8 && pts[pts.length - 1].now &&
      pts.filter((p) => p.now).length === 1, JSON.stringify(pts));
    const note = text(d.getElementById('paNote'));
    ok('the gap note', note === (scenario === 'live' ? 'No saved projections before week 2.' : 'No saved projections before week 8.'), note);

    const strokes = [...d.querySelectorAll('#paWeeks path.pa-wline')].map((p) => p.getAttribute('stroke'));
    if (scenario === 'live') {
      ok('graph 2: one line per saved week and now', strokes.length === 4, JSON.stringify(strokes));
      ok('graph 2: oldest red, newest green', strokes[0] === '#e0525f' && strokes[3] === '#3ba55d', JSON.stringify(strokes));
      ok('graph 2: a column per week projected, 2 to 13', [...d.querySelectorAll('#paWeeks g.pa-wk')].map((g) => g.getAttribute('data-week')).join() ===
        REG.filter((x) => x >= 2).join(), 'columns');

      // The previews: focus a point, then a week column.
      const g3 = d.querySelector('#paTrend g.pa-pt[data-asof="3"]');
      g3.dispatchEvent(new w.Event('focusin', { bubbles: true }));
      await sleep(50);
      const pop = [...d.querySelectorAll('[role="tooltip"]')].map(text).join(' | ');
      ok('a point\'s preview: the weeks it was made of, the bye as the waiver line, the average', /As of week 3/.test(pop) &&
        /Wk 13/.test(pop) && /Bye or 0/.test(pop) && /Future proj/.test(pop) && new RegExp(((11 * 10 + FILL) / 11).toFixed(1)).test(pop), pop);
      g3.dispatchEvent(new w.Event('focusout', { bubbles: true }));
      const c9 = d.querySelector('#paWeeks g.pa-wk[data-week="9"]');
      c9.dispatchEvent(new w.Event('focusin', { bubbles: true }));
      await sleep(50);
      const pop2 = [...d.querySelectorAll('[role="tooltip"]')].map(text).join(' | ');
      ok('a week\'s preview: what each saved week said about it', /Week 9 proj/.test(pop2) && /As of week 2/.test(pop2) &&
        /As of week 5/.test(pop2) && /Now \(week 8\)/.test(pop2), pop2);
    } else {
      ok('graph 2: the live line alone, green', strokes.length === 1 && strokes[0] === '#3ba55d', JSON.stringify(strokes));
    }
  }
  ok('no console error', !errors.length, errors.join(' | '));
  ok('no unhandled rejection', !rejections.length, rejections.join(' | '));
  return out;
}

// ------------------------------------------------------------------ runner

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const scenario = process.argv[2];
  try {
    const booted = await boot(scenario);
    const results = await check(scenario, booted);
    emit({ scenario, results }, results.every((r) => r.pass) ? 0 : 1);
  } catch (err) {
    emit({ scenario, results: [{ name: 'boot', pass: false, detail: String((err && err.stack) || err) }] }, 1);
  }
}

let failed = 0;
let total = 0;
for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
  const res = spawnSync(
    process.execPath,
    ['--import', './marks-register.mjs', self, scenario],
    { encoding: 'utf8', cwd: path.dirname(self), env: { ...process.env, FF_VALUE: JSON.stringify(VALUE) } },
  );
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    console.log(`FAIL ${scenario} — no result\n  stdout: ${res.stdout}\n  stderr: ${(res.stderr || '').slice(0, 1800)}`);
    failed++;
    continue;
  }
  const { results } = JSON.parse(line.slice(2));
  const bad = results.filter((r) => !r.pass);
  total += results.length;
  console.log(`${bad.length ? 'FAIL' : 'PASS'} ${scenario}  ${cfg.label}  (${results.length - bad.length}/${results.length})`);
  for (const r of bad) console.log(`   x ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  failed += bad.length;
}

console.log(failed ? `\n${failed} of ${total} assertions failed` : `\nAll ${total} assertions passed`);
process.exit(failed ? 1 : 0);
