// Weekly totals (analysis.html): the picked team's opponents, outlined.
//
// Tim, 2026-10-18: "for the weekly totals chart, allow me to select a specific
// user and the specific boxes that that user plays against boarder in white,
// as another display of their schedule."
//
//   node opp-outline-check.mjs
//
// Boots the REAL analysis.html + js/analysis-page.js on the analysis stub
// (tests/an-stub-season.mjs), with its schedule replaced by a ROTATING round
// robin — the stub's own pairs every team with the same opponent every week,
// which could not tell "the opponent that week" from "any one fixed row" —
// plus two playoff games. For each week column the check reads which cells
// carry the outline and compares them with that schedule.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { emit } from './emit.mjs';

const STUB_URL = new URL('./an-stub-season.mjs', import.meta.url).href;
const dataUrl = (src) => `data:text/javascript;base64,${Buffer.from(src, 'utf8').toString('base64')}`;

const N = 10;
const WEEKS = 13;
const PLAYED = 7;

/** The circle method: team 1 fixed, the rest rotate. week -> [[home, away], ...] */
export function roundRobin() {
  const out = new Map();
  const rest = Array.from({ length: N - 1 }, (_, i) => i + 2);
  for (let w = 1; w <= WEEKS; w++) {
    const k = (w - 1) % (N - 1);
    const ring = [1, ...rest.slice(k), ...rest.slice(0, k)];
    const pairs = [];
    for (let i = 0; i < N / 2; i++) pairs.push([ring[i], ring[N - 1 - i]]);
    out.set(w, pairs);
  }
  return out;
}

// Weeks 14 and 15 are the stub league's bracket (playoffWeeks off 13 regular
// weeks). Team 4 plays team 9 in week 14 and team 2 in week 15; team 7 is out.
const PLAYOFF = [[14, 4, 9], [14, 1, 3], [15, 2, 4]];

const SEASON = dataUrl(`
  import * as real from ${JSON.stringify(STUB_URL)};
  export * from ${JSON.stringify(STUB_URL)};
  const N = ${N}, WEEKS = ${WEEKS}, PLAYED = ${PLAYED};
  const rest = Array.from({ length: N - 1 }, (_, i) => i + 2);
  const game = (week, h, a) => ({
    week, homeId: h, homeName: 'Team ' + h, awayId: a, awayName: 'Team ' + a,
    homeScore: week <= PLAYED ? 100 + h : null, awayScore: week <= PLAYED ? 95 + a : null,
    played: week <= PLAYED,
  });
  export async function fetchSchedule() {
    real.calls.schedule++;
    const byWeek = new Map();
    for (let w = 1; w <= WEEKS; w++) {
      const k = (w - 1) % (N - 1);
      const ring = [1, ...rest.slice(k), ...rest.slice(0, k)];
      const games = [];
      for (let i = 0; i < N / 2; i++) games.push(game(w, ring[i], ring[N - 1 - i]));
      byWeek.set(w, games);
    }
    return {
      leagueName: 'Stub League',
      teams: Array.from({ length: N }, (_, i) => ({ id: i + 1, name: 'Team ' + (i + 1) })),
      weeks: [...byWeek.keys()],
      byWeek,
      games: [...byWeek.values()].flat(),
      playoffGames: ${JSON.stringify(PLAYOFF)}.map(([w, h, a]) => ({ ...game(w, h, a), played: false, tier: 'WINNERS_BRACKET' })),
    };
  }
`);

const LOADER = dataUrl(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('.') && /\\/season\\.js$/.test(spec)) return next(${JSON.stringify(SEASON)}, ctx);
    return next(spec, ctx);
  }
`);

const LIVE = { 'analysis.source': 'live' };
const CONN = { leagueId: '99', season: 2026, teamId: 4 };
const KEY = 'analysis.oppOf.live:99:2026';

const SCENARIOS = {
  'default-mine': { label: 'opens on your team (4) and outlines its opponents', prefs: LIVE, conn: CONN, want: 4 },
  'picked-7': { label: 'a saved pick (7) wins over your team', prefs: { ...LIVE, [KEY]: 7 }, conn: CONN, want: 7 },
  'off': { label: '"None" outlines nothing', prefs: { ...LIVE, [KEY]: 'none' }, conn: CONN, want: null },
  'change-to-2': {
    label: 'picking team 2 re-outlines and is remembered',
    prefs: LIVE, conn: CONN, want: 2,
    after: async ({ document, window }) => {
      const sel = document.getElementById('totalsOppOf');
      sel.value = '2';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));
    },
    saved: 2,
  },
};

/** The schedule as the test knows it: week -> opponent of `id`. */
function expected(id) {
  const out = new Map();
  if (id === null) return out;
  for (const [w, pairs] of roundRobin()) {
    for (const [h, a] of pairs) {
      if (h === id) out.set(w, a);
      if (a === id) out.set(w, h);
    }
  }
  for (const [w, h, a] of PLAYOFF) {
    if (h === id) out.set(w, a);
    if (a === id) out.set(w, h);
  }
  return out;
}

async function boot(scenario) {
  const cfg = SCENARIOS[scenario];
  register(LOADER);
  const html = readFileSync(path.join(REPO, 'analysis.html'), 'utf8');
  const { window, document } = parseHTML(html);

  const SelectProto = window.HTMLSelectElement?.prototype;
  if (SelectProto) {
    Object.defineProperty(SelectProto, 'value', {
      configurable: true,
      get() {
        const sel = this.querySelector('option[selected]') || this.querySelector('option');
        return sel ? sel.getAttribute('value') ?? sel.textContent : '';
      },
      set(v) {
        for (const o of this.querySelectorAll('option')) {
          if ((o.getAttribute('value') ?? o.textContent) === String(v)) o.setAttribute('selected', '');
          else o.removeAttribute('selected');
        }
      },
    });
  }
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
    window.location = {
      href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:',
      pathname: '/analysis.html', search: '', hash: '',
    };
  }
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  const store = new Map();
  store.set('ff.prefs', JSON.stringify(cfg.prefs));
  store.set('ff.connection', JSON.stringify(cfg.conn));
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  const fetch = async (url) => { throw new Error(`unexpected network call: ${url}`); };

  Object.assign(globalThis, {
    window, document, localStorage, fetch,
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    Event: window.Event, Node: window.Node,
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
  console.error = (...a) => { errors.push(a.join(' ')); };
  await import(pathToFileURL(path.join(REPO, 'js/analysis-page.js')).href);
  await new Promise((r) => setTimeout(r, 900));
  if (cfg.after) await cfg.after({ document, window });
  return { document, window, errors, store, cfg };
}

function check(scenario, { document, errors, store, cfg }) {
  const out = [];
  const ok = (name, cond, detail = '') => out.push({ name, pass: Boolean(cond), detail: cond ? '' : String(detail).slice(0, 600) });
  const table = document.getElementById('totalsTable');
  const heads = [...table.querySelectorAll('thead tr:last-child th')];
  // week per column, read off the heading's number
  const weekAt = heads.map((th) => {
    const n = parseInt(th.textContent.trim(), 10);
    return Number.isFinite(n) ? n : null;
  });
  const weeks = weekAt.filter((w) => w !== null);
  ok('the grid has every regular week and both playoff weeks', [1, 13, 14, 15].every((w) => weeks.includes(w)), weeks.join(','));

  const rows = [...table.querySelectorAll('tbody tr')];
  const outlined = new Map();   // week -> [team ids]
  for (const tr of rows) {
    const id = Number(tr.getAttribute('data-team'));
    [...tr.children].forEach((td, i) => {
      if (!/\bopp\b/.test(td.getAttribute('class') || '')) return;
      const w = weekAt[i];
      if (!outlined.has(w)) outlined.set(w, []);
      outlined.get(w).push(id);
    });
  }

  const want = expected(cfg.want);
  const got = [...outlined.entries()].map(([w, ids]) => `${w}:${ids.join('+')}`).sort().join(' ');
  const exp = [...want.entries()].map(([w, id]) => `${w}:${id}`).sort().join(' ');
  ok('outlined cells are exactly the picked team\'s opponent, week by week', got === exp, `got ${got || '(none)'} | want ${exp || '(none)'}`);
  // Team 4 plays all 13 weeks and both bracket weeks; 2 only week 15; 7 is out.
  const span = { 4: 15, 7: 13, 2: 14 }[cfg.want];
  if (span) ok(`an outline in ${span} weeks (regular + its bracket games)`, outlined.size === span, `${outlined.size}`);

  const marked = rows.filter((tr) => /\bopp-of\b/.test(tr.getAttribute('class') || ''))
    .map((tr) => Number(tr.getAttribute('data-team')));
  ok('the picked team\'s own row is marked, and only it', cfg.want === null ? marked.length === 0 : marked.join() === String(cfg.want), marked.join());

  const sel = document.getElementById('totalsOppOf');
  ok('the picker exists', Boolean(sel));
  if (sel) {
    ok('the picker offers None plus all ten teams', sel.querySelectorAll('option').length === N + 1, sel.querySelectorAll('option').length);
    ok('the picker shows the pick', sel.value === (cfg.want === null ? '' : String(cfg.want)), sel.value);
  }
  if (cfg.saved !== undefined) {
    const p = JSON.parse(store.get('ff.prefs') || '{}');
    ok('the pick is remembered in ff.prefs', p[KEY] === cfg.saved, JSON.stringify(p[KEY]));
  }
  ok('no console errors', errors.length === 0, errors.join(' | '));
  return out;
}

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const scenario = process.argv[2];
  try {
    const booted = await boot(scenario);
    const results = check(scenario, booted);
    emit({ scenario, results }, results.every((r) => r.pass) ? 0 : 1);
  } catch (err) {
    emit({ scenario, results: [{ name: 'boot', pass: false, detail: String((err && err.stack) || err) }] }, 1);
  }
} else {
  let failed = 0;
  let total = 0;
  for (const [scenario, cfg] of Object.entries(SCENARIOS)) {
    const res = spawnSync(process.execPath, ['--import', './an-register.mjs', self, scenario], {
      encoding: 'utf8', cwd: path.dirname(self), env: process.env,
    });
    const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
    if (!line) {
      console.log(`FAIL ${scenario} — no result\n  stderr: ${(res.stderr || '').slice(0, 2000)}`);
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
}
