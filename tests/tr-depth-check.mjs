// DEPTH on the Trade page's All teams · proj avg grid.
//
//   node tr-depth-check.mjs
//
// Tim, 2026-10-22: "in the trade section, in the chart that shows all teams,
// proj avg 2026, could you add a column on the left titled "depth" that is the
// combined current value of the players on that team that start less than 20%
// of the remaining games of the season?"
//
// The real trade.html with its real module on tests/tr-stub-season.mjs (the
// hand-built four-squad league, weeks 1–4 played, 5–14 to come), one scenario
// per child process as tr-test.mjs does it, Value lines handed over through
// FF_VALUE in the shape js/value.js `buildBase` makes (tr-value-check's lines).
//
// WHO IS DEPTH, by hand from the stub's projections (weeks 5–14, ten weeks;
// lineup QB RB RB WR WR TE FLEX D/ST K):
//   Ana  QB1/QB2 swing 19/7 and take turns: 5 starts each (50%), not depth.
//        TE2 11 (behind TE1 12), WR4 11 (behind WR1 14, WR2/WR3 12 in WR2 and
//        FLEX), Bills D/ST 11 (behind Ravens 12): 0 starts -> depth.
//   Bo   QB2 14 (behind 17), WR3 4, RB4 4: 0 starts -> depth.
//   Cy   WR4 5, QB2 6: depth. WR2 and RB3 both 15 for the one FLEX: whichever
//        the lineup picks starts 10 of 10, the other 0 -> exactly one of them.
//   Di   QB2 6, RB3 5, WR4 5: depth.
// Depth = their Values (to the tenth) added up.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { machineSpeed, scaledBudget } from './settle.mjs';
import { emit } from './emit.mjs';

// ------------------------------------------------------------------ harness
// tr-value-check.mjs's `boot`, `settle` and `settleGoal`.

async function boot(seed = null) {
  const page = 'trade.html';
  const html = readFileSync(path.join(REPO, page), 'utf8');
  const { window, document } = parseHTML(html);
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
  window.location = {
    href: `http://localhost/${page}`, origin: 'http://localhost',
    protocol: 'http:', pathname: `/${page}`, search: '', hash: '',
  };
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};
  const store = new Map(Object.entries(seed || {}));
  {
    let prefs = {};
    try { prefs = JSON.parse(store.get('ff.prefs') || '{}'); } catch { prefs = {}; }
    if (!('trade.goal' in prefs)) prefs['trade.goal'] = 'last';
    store.set('ff.prefs', JSON.stringify(prefs));
  }
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  Object.assign(globalThis, {
    window, document, localStorage,
    fetch: async (u) => { throw new Error(`unexpected network call: ${u}`); },
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ position: '', getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: (q) => ({
      matches: /min-width/.test(String(q)), media: String(q),
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    }),
  });
  window.localStorage = localStorage;
  window.matchMedia = globalThis.matchMedia;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.ResizeObserver = globalThis.ResizeObserver;
  const errors = [];
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  for (const m of [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((x) => x[1])) {
    await import(pathToFileURL(path.join(REPO, m)).href);
  }
  await settle();
  console.error = origError;
  return { document, window, errors };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
function searchRunning() {
  const el = globalThis.document && globalThis.document.getElementById('tradeEmpty');
  return !!(el && !/\bhidden\b/.test(el.getAttribute('class') || '') && el.querySelector('.searching'));
}
const settle = async (ms = 400) => {
  await pause(ms);
  const t0 = Date.now();
  while (searchRunning() && Date.now() - t0 < 180000) await pause(25);
  if (Date.now() - t0 >= 25) await pause(50);
};
let machine = null;
async function settleGoal(document, idleMax = 45000) {
  const max = scaledBudget(idleMax, (machine || (machine = machineSpeed())).factor);
  const t0 = Date.now();
  await settle(1500);
  const txt = (id) => {
    const el = document.getElementById(id);
    return el ? el.textContent.replace(/\s+/g, ' ') : '';
  };
  while (Date.now() - t0 < max) {
    const count = txt('tradeCount');
    const done = /ranked by your|not ranked by your/.test(count) && !/playing each offer out/.test(count);
    const empty = !document.querySelector('#tradeTable tbody tr') && !/Trying every swap/.test(txt('tradeEmpty')) &&
      txt('tradeEmpty').length > 0;
    if (done || empty) break;
    await settle(250);
  }
  await settle(400);
}

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

const SCENARIOS = {};

SCENARIOS.grid = async function grid() {
  const { document, errors } = await boot({
    'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
    'ff.prefs': JSON.stringify({ 'trade.source': 'live' }),
  });
  await settleGoal(document);
  const t = document.getElementById('projAvgTable');
  const heads = [...t.querySelectorAll('thead th')].map((th) => ({ text: text(th), title: th.getAttribute('title') || '', sort: th.hasAttribute('data-sort') }));
  const rows = [...t.querySelectorAll('tbody tr')].map((tr) => {
    const tds = [...tr.children];
    const d = tr.querySelector('td.depth');
    return {
      team: text(tr.querySelector('td.name')),
      second: tds[1] ? (tds[1].getAttribute('class') || '') : '',
      v: d && d.hasAttribute('data-v') ? Number(d.getAttribute('data-v')) : null,
      txt: d ? text(d).replace(/\s*[▲▼]$/, '') : null,
      says: d ? d.getAttribute('aria-label') || d.getAttribute('title') || '' : '',
      card: d ? d.hasAttribute('data-pop') || [...d.attributes].some((a) => /^data-(pop|tip|sc)/.test(a.name)) : false,
      slotCells: tr.querySelectorAll('td.slot-avg').length,
    };
  });
  return { errors, heads, rows, bars: text(document.getElementById('projAvgBars')) };
};

// --------------------------------------------------------------------- driver

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  try { emit(await SCENARIOS[process.argv[2]](), 0); } catch (err) { emit({ boot: String((err && err.stack) || err) }, 1); }
}

function run(name, env = {}) {
  const res = spawnSync(process.execPath, ['--import', './tr-register.mjs', self, name], {
    encoding: 'utf8', cwd: path.dirname(self), env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024,
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error(`no result for ${name} - exit ${res.status}\n${String(res.stderr).slice(-800)}`);
  const got = JSON.parse(line.slice(2));
  if (got && got.boot) throw new Error(`the ${name} scenario threw — ${got.boot}`);
  return got;
}

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`);
};

if (!process.argv[2]) {
  const { valueOf, restAvg } = await import(pathToFileURL(path.join(REPO, 'js/value.js')).href);
  const stub = await import('./tr-stub-season.mjs');
  const BASE = {
    v: 1, setAt: 1760000000000, week: 5,
    lines: {
      QB: { waiver: 10, starter: 15, agents: 3, starters: 4 },
      RB: { waiver: 8, starter: 12, agents: 3, starters: 9 },
      WR: { waiver: 7, starter: 11, agents: 3, starters: 11 },
      TE: { waiver: 6, starter: 9, agents: 3, starters: 4 },
      K: { waiver: 6, starter: 6, agents: 3, starters: 4 },
      DST: { waiver: 5, starter: 8, agents: 3, starters: 4 },
    },
  };
  const WEEKS_LEFT = Array.from({ length: stub.WEEKS - stub.PLAYED_THROUGH }, (_, i) => stub.PLAYED_THROUGH + 1 + i);
  const players = {};
  const NAME = {};
  for (const team of stub.TEAMS) {
    team.players.forEach((spec, i) => {
      const id = stub.playerId(team.id, i);
      NAME[id] = spec.name;
      const byWeek = Object.fromEntries(WEEKS_LEFT.map((w) => [w, spec.week(w)]));
      const avg = restAvg(byWeek, WEEKS_LEFT, spec.name === 'Bills D/ST' ? stub.BYE_WEEK : null);
      players[id] = { position: spec.position, avg, value: valueOf(BASE, spec.position, avg) };
    });
  }
  const FF_VALUE = JSON.stringify({ base: BASE, weeks: WEEKS_LEFT, players });
  const r1 = (n) => Math.round(n * 10) / 10;
  const sum = (ids) => r1(ids.reduce((t, id) => t + r1(players[id].value), 0));

  // The hand list above, as ids (team * 100 + roster index).
  const WANT = {
    Ana: [[110, 111, 112]],
    Bo: [[209, 210, 211]],
    Cy: [[310, 311, 304], [310, 311, 309]],
    Di: [[409, 410, 411]],
  };

  const got = run('grid', { FF_VALUE });
  ok('boots clean', got.errors.length === 0, got.errors.join(' | '));
  const heads = got.heads.map((h) => h.text);
  ok('the header reads Team, Depth, then the slots and Total', heads.join(',') === 'Team,Depth,QB,RB1,RB2,WR1,WR2,TE,FLEX,D/ST,K,Total', heads.join(','));
  const dh = got.heads[1] || {};
  ok('Depth sorts like the others and has a one-sentence title', dh.sort === true && /fewer than 20%/.test(dh.title) && (dh.title.match(/\.\s/g) || []).length === 0, JSON.stringify(dh));
  ok('a row per squad', got.rows.length === 4, got.rows.length);
  ok('Depth is the second cell of every row, and the 9 slot cells are untouched',
    got.rows.every((r) => /\bdepth\b/.test(r.second) && r.slotCells === 9), JSON.stringify(got.rows.map((r) => [r.second, r.slotCells])));
  for (const r of got.rows) {
    const options = WANT[r.team] || [];
    const hit = options.find((ids) => sum(ids) === r.v &&
      ids.every((id) => r.says.includes(NAME[id])));
    ok(`${r.team}: Depth = the Value of the men who start under 20% (${options.map((ids) => `${ids.map((id) => `${NAME[id]} ${r1(players[id].value)}`).join(' + ')} = ${sum(ids)}`).join(' or ')})`,
      !!hit && r.txt === r.v.toFixed(1), `${r.txt} / ${r.v} · ${r.says}`);
    ok(`${r.team}: a man who starts half the weeks is not in it`, !/QB1/.test(r.says) && !(r.team === 'Ana' && /QB2/.test(r.says)), r.says);
  }
  ok('Depth is on the full-colour strip like the other columns', /Depth/.test(got.bars), got.bars);

  // No Value lines: a dash, never a 0.
  const none = run('grid');
  ok('no lines: boots clean', none.errors.length === 0, none.errors.join(' | '));
  ok('no lines: every Depth cell is a dash', none.rows.length === 4 && none.rows.every((r) => r.txt === '—' && r.v === null),
    JSON.stringify(none.rows.map((r) => r.txt)));

  if (fails.length) {
    console.log(`\n${fails.length} FAILED:`);
    for (const f of fails) console.log(`  FAIL ${f}`);
  }
  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
}
