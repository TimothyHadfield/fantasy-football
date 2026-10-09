// PROJ | VALUE on the Trade page, and Value on its player cards.
//
//   node tr-value-check.mjs
//
// Tim, 2026-10-09: "I want it to be displayed at the top of the player's
// preview. Additionally for all graphs or charts that show avg position's proj
// or value or anything like that (except total proj like a team's proj for that
// week), have a switch for that graph that also shows the data as value rather
// than just total proj."
//
// The real trade.html with its real module on tests/tr-stub-season.mjs (the
// hand-built four-squad league), one scenario per child process as tr-test.mjs
// does it. The stub hands the page Value lines through FF_VALUE, in the shape
// js/value.js `buildBase` makes. Claims:
//
//   1. no lines: no switch anywhere, and every number is what it was;
//   2. lines: the switch is in the custom toolbar and on the season boxes, on
//      Proj, and the Proj numbers are EXACTLY scenario 1's;
//   3. Value: every roster number and every slot cell is `valueOf(base, his
//      position, the Proj number)`, re-derived here from the Proj page; an Avg
//      is the mean of its row's converted cells; nothing is negative;
//   4. the Starting lineup band and the opponent row (team totals) do not move;
//   5. Difference in Value = Value after − Value before, cell for cell;
//   6. the choice is remembered (`trade.valueView`), opens the next visit on
//      Value, and does nothing at all on a league with no lines;
//   7. a card opened on this page starts "Value n" — the page registered it
//      with the man's id and gave the card the lookup;
//   8. the assumed trade's season box follows the same switch.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { machineSpeed, scaledBudget } from './settle.mjs';
import { emit } from './emit.mjs';

// ------------------------------------------------------------------ harness
// tr-test.mjs's `boot`, `settle` and `settleGoal`, kept to what this needs.

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
    // The regular-season span (tr-test pins the same goal for the same reason).
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
  const document = globalThis.document;
  const el = document && document.getElementById('tradeEmpty');
  if (el && !/\bhidden\b/.test(el.getAttribute('class') || '') && el.querySelector('.searching')) return true;
  const combo = document && document.getElementById('comboBody');
  return !!combo && /Trying every set/.test(combo.textContent);
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
    if ((done || empty) && !/Trying every set/.test(txt('comboBody'))) break;
    await settle(250);
  }
  await settle(400);
}

// ------------------------------------------------------------------- reading

const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const cls = (el) => (el.getAttribute('class') || '').split(/\s+/);
const numAttr = (el, a) => (el && el.hasAttribute(a) ? Number(el.getAttribute(a)) : null);
/** The number a cell prints, without its heat mark: "13.0", "—", "Bye", "+1.5". */
const printed = (el) => (text(el).match(/^(?:[+−-]?\d+(?:\.\d+)?|—|Bye)/) || [''])[0];

function readSwitch(el) {
  if (!el) return null;
  const on = [...el.querySelectorAll('button[data-value-view]')].filter((b) => cls(b).includes('on'));
  return {
    hidden: !!el.hidden,
    labels: [...el.querySelectorAll('button')].map(text),
    on: on.map((b) => b.getAttribute('data-value-view')),
    pressed: [...el.querySelectorAll('button[aria-pressed="true"]')].map((b) => b.getAttribute('data-value-view')),
    classes: cls(el),
  };
}

/** A side's "+/- a week" figure as it always read: without the total-Value bit. */
function gainText(el) {
  if (!el) return '';
  const sub = el.querySelector('.cu-sub');
  const val = el.querySelector('.cu-val');
  const subText = sub ? text(sub).slice(0, val ? text(sub).length - text(val).length : undefined).replace(/\s*·\s*$/, '') : '';
  return `${text(el.querySelector('.cu-num'))} ${subText}`.trim();
}
/** A side's change in total Value: its words and its colour class, or null. */
function valText(el) {
  const val = el && el.querySelector('.cu-val');
  return val ? { txt: text(val), cls: cls(val).filter((c) => c !== 'cu-val').join(' '), line: text(el.querySelector('.cu-sub')) } : null;
}

function readList(document, id) {
  return [...document.getElementById(id).querySelectorAll('.cu-man')].map((row) => ({
    id: row.getAttribute('data-man'),
    slot: text(row.querySelector('.sl')),
    pv: printed(row.querySelector('.pv')),
  }));
}

/** One season box: slot rows with their cells, the band, and the opponent row. */
function readBox(host, which) {
  const t = host && host.querySelector(`table.sbw-table[data-box="${which}"]`);
  if (!t) return null;
  const weeks = [...t.querySelectorAll('thead th[data-hw]')].map((th) => Number(th.getAttribute('data-hw')));
  const rows = [...t.querySelectorAll('tbody tr[data-slot]')].map((tr) => ({
    slot: tr.getAttribute('data-slot'),
    avg: numAttr(tr.querySelector('td.avg'), 'data-v'),
    avgText: printed(tr.querySelector('td.avg')),
    cells: [...tr.querySelectorAll('td.wk')].map((td, i) => ({
      week: weeks[i],
      v: numAttr(td, 'data-v'),
      pid: td.getAttribute('data-pid'),
      empty: td.hasAttribute('data-empty'),
      played: cls(td).includes('played'),
      txt: printed(td),
    })),
  }));
  const band = t.querySelector('tbody.split');
  return {
    view: t.getAttribute('data-view') || 'total',
    weeks,
    rows,
    band: band ? [...band.querySelectorAll('td.wk')].map((td) => ({ week: numAttr(td, 'data-wk'), v: numAttr(td, 'data-v'), txt: printed(td) })) : null,
    bandAvg: band ? printed(band.querySelector('td.avg')) : null,
    opp: [...t.querySelectorAll('tbody.sbw-opp td.wk')].map(text),
  };
}

function readPage(document) {
  const $ = (id) => document.getElementById(id);
  const sec = $('cuSeason');
  return {
    toolbar: readSwitch($('cuValueView')),
    seasonSwitches: [...sec.querySelectorAll('.value-view')].map(readSwitch),
    seasonTop: sec.querySelectorAll('.sbw-top').length,
    whoParent: (() => { const w = sec.querySelector('.sbw-who'); return w && w.parentNode ? cls(w.parentNode).join(' ') : null; })(),
    everySwitch: document.querySelectorAll('.value-view').length,
    depthSwitch: (() => { const d = $('depthTable'); const p = d && d.closest('section'); return p ? p.querySelectorAll('.value-view').length : null; })(),
    listA: readList(document, 'cuListA'),
    listB: readList(document, 'cuListB'),
    before: readBox(sec, 'before'),
    after: readBox(sec, 'after'),
    gainA: gainText($('cuGainA')),
    gainB: gainText($('cuGainB')),
    valA: valText($('cuGainA')),
    valB: valText($('cuGainB')),
    depth: text($('depthTable')),
    finder: text($('tradeTable')),
    note: text($('cuNote')),
  };
}

function openCard(document, selector) {
  const man = document.querySelector(selector);
  if (!man) return null;
  man.dispatchEvent(new globalThis.Event('mouseover', { bubbles: true }));
  const el = document.getElementById('tipCard');
  if (!el) return null;
  const out = { hidden: !!el.hidden, ident: text(el.querySelector('.tc-ident')), glance: text(el.querySelector('.tc-glance')) };
  man.dispatchEvent(new globalThis.Event('mouseout', { bubbles: true }));
  return out;
}

const savedPref = () => {
  try { return JSON.parse(globalThis.localStorage.getItem('ff.prefs') || '{}')['trade.valueView'] ?? null; } catch { return 'unreadable'; }
};

// ----------------------------------------------------------------- scenarios

const liveSeed = (prefs = {}) => ({
  'ff.connection': JSON.stringify({ leagueId: '476225250', season: 2026, teamId: 1 }),
  'ff.prefs': JSON.stringify({ 'trade.source': 'live', ...prefs }),
});
const SEND = '110';   // Ana TE2, on her bench
const GET = '309';    // Cy RB3, on his
const TWO = ['100', '110'];   // Ana QB1 and Ana TE2 …
const ONE = '301';            // … for Cy RB1

/** Ana ↔ Cy, one man each way, ticked in the custom builder (or `send` for `get`). */
async function buildDeal(document, window, send = [SEND], get = [GET]) {
  const $ = (id) => document.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
  await settleGoal(document);
  $('cuTeamB').value = '3'; fire($('cuTeamB'), 'change');
  await settle(300);
  const box = (id, v) => {
    const all = [...$(id).querySelectorAll('input[type="checkbox"]')];
    const hit = all.find((b) => String(b.getAttribute('value')) === v);
    if (!hit) throw new Error(`no man ${v} in #${id}: ${all.map((b) => b.getAttribute('value')).join(',')} (with ${$('cuTeamB').value})`);
    return hit;
  };
  for (const id of send) { const a = box('cuListA', id); a.checked = true; fire(a, 'change'); }
  for (const id of get) { const b = box('cuListB', id); b.checked = true; fire(b, 'change'); }
  await settle(600);
  // The finder fills its other-goal column a row at a time after the ranking
  // ("…" until then): wait it out, so two readings of the table can be compared.
  const t0 = Date.now();
  while (/…/.test($('tradeTable').textContent) && Date.now() - t0 < 120000) await pause(100);
  await settle(200);
  return fire;
}

const SCENARIOS = {};

/** One visit: Proj, then Value, then Difference, then back through the season box's own switch. */
SCENARIOS.visit = async function visit() {
  const { document, window, errors } = await boot(liveSeed(process.env.TV_PREF ? { 'trade.valueView': process.env.TV_PREF } : {}));
  const $ = (id) => document.getElementById(id);
  const fire = await buildDeal(document, window);
  const first = readPage(document);
  const card = {
    mine: openCard(document, '#cuListA .cu-man[data-man="100"] .pv'),
    his: openCard(document, '#cuListB .cu-man[data-man="309"] .pv'),
    season: openCard(document, '#cuSeason table[data-box="before"] td[data-pid="100"] .sbw-man'),
    finder: openCard(document, '#tradeTable [data-tip]'),
  };
  const prefFirst = savedPref();
  const out = { errors, first, card, prefFirst };

  const press = async (root, v) => {
    const b = root && root.querySelector(`button[data-value-view="${v}"]`);
    if (!b) return false;
    fire(b, 'click');
    await settle(300);
    return true;
  };
  // The other view, from the toolbar's switch.
  const other = first.toolbar && first.toolbar.on[0] === 'value' ? 'proj' : 'value';
  out.pressed = await press($('cuValueView'), other);
  out.second = readPage(document);
  out.prefSecond = savedPref();
  // Difference, in whichever view is Value.
  const toValue = async () => {
    if (!(out.second.toolbar && out.second.toolbar.on[0] === 'value')) await press($('cuValueView'), 'value');
  };
  if (out.pressed) {
    await toValue();
    out.valueTotal = readPage(document);
    const d = $('cuSeason').querySelector('button[data-sbw-view="diff"]');
    if (d) { fire(d, 'click'); await settle(200); }
    out.valueDiff = readBox($('cuSeason'), 'after');
    const t = $('cuSeason').querySelector('button[data-sbw-view="total"]');
    if (t) { fire(t, 'click'); await settle(200); }
    // And back to Proj through the SEASON box's copy: one state for the page.
    out.pressedSeason = await press($('cuSeason'), 'proj');
    out.back = readPage(document);
    out.prefBack = savedPref();
  }
  return out;
};

/** Two of Ana's men for one of Cy's: each side's change in total Value, in both views, then cleared. */
SCENARIOS.twofer = async function twofer() {
  const { document, window, errors } = await boot(liveSeed());
  const $ = (id) => document.getElementById(id);
  const fire = await buildDeal(document, window, TWO, [ONE]);
  const read = () => ({ valA: valText($('cuGainA')), valB: valText($('cuGainB')), gainA: gainText($('cuGainA')), gainB: gainText($('cuGainB')), preview: text($('cuPreview')) });
  const proj = read();
  const b = $('cuValueView').querySelector('button[data-value-view="value"]');
  if (b && !$('cuValueView').hidden) { fire(b, 'click'); await settle(300); }
  const value = read();
  fire($('cuClear'), 'click');
  await settle(300);
  return { errors, proj, value, cleared: read() };
};

/** The assumed trade's block: saved, assumed, and read in both views. */
SCENARIOS.assumed = async function assumed() {
  const { document, window, errors } = await boot(liveSeed());
  const $ = (id) => document.getElementById(id);
  const fire = await buildDeal(document, window);
  fire($('cuSave'), 'click');
  fire($('cuClear'), 'click');
  await settle(300);
  const btn = document.querySelector('#cuRows button[data-assume]');
  if (btn) fire(btn, 'click');
  await settleGoal(document);
  const asm = $('assumedSeason');
  const read = () => ({
    panelHidden: !!$('assumedPanel').hidden,
    switches: [...asm.querySelectorAll('.value-view')].map(readSwitch),
    after: readBox(asm, 'after'),
    row: text($('assumedRows')),
  });
  const proj = read();
  const b = asm.querySelector('button[data-value-view="value"]');
  if (b) { fire(b, 'click'); await settle(400); }
  const value = read();
  return { errors, assumeButton: !!btn, proj, value, toolbar: readSwitch($('cuValueView')) };
};

// --------------------------------------------------------------------- driver

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const name = process.argv[2];
  try {
    emit(await SCENARIOS[name](), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

function run(name, env = {}) {
  const res = spawnSync(process.execPath, ['--import', './tr-register.mjs', self, name], {
    encoding: 'utf8', cwd: path.dirname(self), env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024,
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) {
    const tail = (t) => String(t || '').trimEnd().split('\n').slice(-6).join('\n');
    throw new Error(`no result for ${name} - exit ${res.status}\nstderr:\n${tail(res.stderr)}\nstdout:\n${tail(res.stdout)}`);
  }
  const got = JSON.parse(line.slice(2));
  // A scenario that threw has nothing to assert on: say why, once, and stop.
  if (got && got.boot) throw new Error(`the ${name} scenario threw — ${got.boot}`);
  // A page with no switch at all (the code before this feature) is read as
  // switches that are not there, so every claim below FAILS by name instead of
  // the suite dying on a null.
  const NO = { hidden: null, labels: [], on: [], pressed: [], classes: [], absent: true };
  const fill = (o) => {
    if (!o || typeof o !== 'object') return;
    if ('toolbar' in o && !o.toolbar) o.toolbar = { ...NO };
    for (const v of Object.values(o)) if (v && typeof v === 'object' && !Array.isArray(v)) fill(v);
  };
  fill(got);
  return got;
}

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** A panel's own copy of the switch, or one that reads as not there. */
const sw0 = (list) => (list && list[0]) || { on: [], classes: [] };
/** Where two page readings first part, for a failure line. */
const where = (a, b) => {
  for (const k of Object.keys({ ...a, ...b })) {
    const x = JSON.stringify(a[k]);
    const y = JSON.stringify(b[k]);
    if (x === y) continue;
    let i = 0;
    while (i < x.length && x[i] === y[i]) i++;
    return `${k} @${i}: …${x.slice(Math.max(0, i - 60), i + 80)}… / …${y.slice(Math.max(0, i - 60), i + 80)}…`;
  }
  return 'the same';
};

if (!process.argv[2]) {
  const { valueOf, restAvg } = await import(pathToFileURL(path.join(REPO, 'js/value.js')).href);
  const stub = await import('./tr-stub-season.mjs');

  // THE LINES, in the shape `buildBase` hands on. Chosen so the stub's men land
  // on all three sides of them: under the waiver line (0), between the two
  // (half), and over the starter line (in full).
  const BASE = {
    v: 1,
    setAt: 1760000000000,
    week: 5,
    lines: {
      QB: { waiver: 10, starter: 15, agents: 3, starters: 4 },
      RB: { waiver: 8, starter: 12, agents: 3, starters: 9 },
      WR: { waiver: 7, starter: 11, agents: 3, starters: 11 },
      TE: { waiver: 6, starter: 9, agents: 3, starters: 4 },
      K: { waiver: 6, starter: 6, agents: 3, starters: 4 },
      DST: { waiver: 5, starter: 8, agents: 3, starters: 4 },
    },
  };
  // Every rostered man, as `fetchPlayerValues` reports him: his average over the
  // weeks left (5–14 here), his bye left out, and the Value that makes.
  const WEEKS_LEFT = Array.from({ length: stub.WEEKS - stub.PLAYED_THROUGH }, (_, i) => stub.PLAYED_THROUGH + 1 + i);
  const POS = new Map();
  const players = {};
  for (const team of stub.TEAMS) {
    team.players.forEach((spec, i) => {
      const id = stub.playerId(team.id, i);
      POS.set(String(id), spec.position);
      const byWeek = Object.fromEntries(WEEKS_LEFT.map((w) => [w, spec.week(w)]));
      const avg = restAvg(byWeek, WEEKS_LEFT, spec.name === 'Bills D/ST' ? stub.BYE_WEEK : null);
      players[id] = { position: spec.position, avg, value: valueOf(BASE, spec.position, avg) };
    });
  }
  const FF_VALUE = JSON.stringify({ base: BASE, weeks: WEEKS_LEFT, players });
  const r1 = (n) => Math.round(n * 10) / 10;
  const NEG = /^[−-]/;

  // ---------------------------------------------------------------- 1. no lines
  const none = run('visit');
  ok('no lines: the page boots clean', !none.boot && none.errors.length === 0, none.boot || none.errors.join(' | '));
  ok('no lines: the toolbar switch is in the markup and hidden',
    none.first.toolbar && none.first.toolbar.hidden === true, JSON.stringify(none.first.toolbar));
  ok('no lines: no switch on the season boxes', none.first.seasonSwitches.length === 0 && none.first.seasonTop === 0,
    `${none.first.seasonSwitches.length} switches, ${none.first.seasonTop} wrappers`);
  ok('no lines: the names sit where they always did (straight in the season box)',
    none.first.whoParent === 'sbw', none.first.whoParent);
  ok('no lines: the deal is on screen (both season boxes drawn)',
    none.first.before && none.first.after && none.first.before.rows.length >= 9, JSON.stringify(none.first.before && none.first.before.rows.length));
  ok('no lines: a card on this page has no Value', none.card.mine && !/Value/.test(none.card.mine.glance) && /Ana QB1/.test(none.card.mine.ident),
    JSON.stringify(none.card.mine));
  ok('no lines: nothing is remembered', none.prefFirst === null, none.prefFirst);
  ok('no lines: the note says nothing about Value', !/Value<\/strong>|waiver line/.test(none.first.note), none.first.note.slice(0, 200));

  // A remembered "value" on a league with no lines changes nothing at all.
  const noneRemembered = run('visit', { TV_PREF: 'value' });
  ok('no lines + remembered Value: the page is the same page',
    noneRemembered.first.toolbar.hidden === true &&
    same({ ...noneRemembered.first, toolbar: 0 }, { ...none.first, toolbar: 0 }),
    where({ ...noneRemembered.first, toolbar: 0 }, { ...none.first, toolbar: 0 }));

  // ------------------------------------------------------------------ 2. lines
  const got = run('visit', { FF_VALUE });
  ok('lines: the page boots clean', !got.boot && got.errors.length === 0, got.boot || (got.errors || []).join(' | '));
  const P = got.first;
  const V = got.second;
  ok('lines: the toolbar switch is shown, two buttons, on Proj',
    P.toolbar && P.toolbar.hidden === false && same(P.toolbar.labels, ['Proj', 'Value']) &&
    same(P.toolbar.on, ['proj']) && same(P.toolbar.pressed, ['proj']), JSON.stringify(P.toolbar));
  ok('lines: it is the site\'s small segmented control',
    P.toolbar && P.toolbar.classes.includes('segmented') && P.toolbar.classes.includes('seg-sm'), JSON.stringify(P.toolbar && P.toolbar.classes));
  ok('lines: one copy on the season boxes, on Proj',
    P.seasonSwitches.length === 1 && same(sw0(P.seasonSwitches).on, ['proj']) &&
    sw0(P.seasonSwitches).classes.includes('seg-sm'), JSON.stringify(P.seasonSwitches));
  ok('lines: none on the depth map, and none anywhere else', P.depthSwitch === 0 && P.everySwitch === 2,
    `depth ${P.depthSwitch}, all ${P.everySwitch}`);
  const strip = (s) => ({ ...s, toolbar: 0, seasonSwitches: 0, seasonTop: 0, whoParent: 0, everySwitch: 0, note: 0, valA: 0, valB: 0 });
  ok('lines, on Proj: every number on the page is what it is with no lines', same(strip(P), strip(none.first)),
    where(strip(P), strip(none.first)));
  ok('lines: the tucked note says what Value is',
    /Value is points a week over the waiver line/.test(P.note) && /count half/.test(P.note) && /fixed for the season/.test(P.note),
    P.note.slice(0, 300));

  // ------------------------------------------------------------------ 3. Value
  ok('Value: the press took', got.pressed === true && same(V.toolbar.on, ['value']) && same(V.toolbar.pressed, ['value']) &&
    same(sw0(V.seasonSwitches).on, ['value']), JSON.stringify([V.toolbar, V.seasonSwitches]));
  ok('Value: remembered', got.prefFirst === null && got.prefSecond === 'value', `${got.prefFirst} → ${got.prefSecond}`);

  // The roster lists: the same men in the same rows, each number converted.
  for (const side of ['listA', 'listB']) {
    const p = P[side];
    const v = V[side];
    ok(`Value, ${side}: nobody moved`, same(p.map((m) => [m.id, m.slot]), v.map((m) => [m.id, m.slot])));
    let bad = '';
    let n = 0;
    p.forEach((m, i) => {
      if (m.id === null) return;
      const want = valueOf(BASE, POS.get(m.id), Number(m.pv));
      n++;
      if (v[i].pv !== want.toFixed(1)) bad += ` ${m.id}: ${m.pv} → ${v[i].pv}, want ${want.toFixed(1)}`;
    });
    ok(`Value, ${side}: every man's number is valueOf(base, his position, his Proj number)`, n >= 12 && !bad, `${n} men;${bad}`);
    ok(`Value, ${side}: nothing is negative`, v.every((m) => !NEG.test(m.pv)), JSON.stringify(v.map((m) => m.pv)));
  }
  // Named cells, by hand: Ana QB1 swings 19/7 → 13.0 → (13 − 10) / 2 = 1.5;
  // Cy RB1 a flat 17 → (12 − 8) / 2 + 5 = 7.0; Di RB3-like junk under the line → 0.
  const pvOf = (page, side, id) => (page[side].find((m) => m.id === id) || {}).pv;
  ok('Value: Ana QB1 reads 13.0 as Proj and 1.5 as Value', pvOf(P, 'listA', '100') === '13.0' && pvOf(V, 'listA', '100') === '1.5',
    `${pvOf(P, 'listA', '100')} / ${pvOf(V, 'listA', '100')}`);
  ok('Value: Cy RB1 reads 17.0 as Proj and 7.0 as Value', pvOf(P, 'listB', '301') === '17.0' && pvOf(V, 'listB', '301') === '7.0',
    `${pvOf(P, 'listB', '301')} / ${pvOf(V, 'listB', '301')}`);
  ok('Value: a man under the waiver line reads 0.0, not a minus (Cy QB2, 6.0)',
    pvOf(P, 'listB', '311') === '6.0' && pvOf(V, 'listB', '311') === '0.0', `${pvOf(P, 'listB', '311')} / ${pvOf(V, 'listB', '311')}`);

  // The season boxes: cell for cell, then the Avg, then the totals.
  const regular = (c) => !c.played && c.week <= stub.WEEKS;
  for (const which of ['before', 'after']) {
    const pb = P[which];
    const vb = V[which];
    let cells = 0;
    let bad = '';
    let badAvg = '';
    pb.rows.forEach((row, ri) => {
      const vrow = vb.rows[ri];
      const conv = [];
      row.cells.forEach((c, ci) => {
        const vc = vrow.cells[ci];
        if (c.pid === null || c.v === null) {
          if (vc.v !== null && !c.pid) bad += ` ${row.slot} wk${c.week}: an empty slot reads ${vc.txt}`;
          return;
        }
        const want = valueOf(BASE, POS.get(c.pid), c.v);
        cells++;
        if (vc.v !== want || vc.pid !== c.pid) bad += ` ${row.slot} wk${c.week}: ${c.v} → ${vc.v}, want ${want}`;
        if (vc.txt !== 'Bye' && vc.txt !== want.toFixed(1)) bad += ` ${row.slot} wk${c.week} prints ${vc.txt}`;
        if (regular(c)) conv.push(want);
      });
      const wantAvg = conv.length ? r1(conv.reduce((a, b) => a + b, 0) / conv.length) : null;
      if (vrow.avg !== wantAvg) badAvg += ` ${row.slot}: ${vrow.avg}, want ${wantAvg}`;
    });
    ok(`Value, ${which} box: every slot cell is valueOf(base, the position of the man in it, its Proj number)`,
      cells >= 9 * 10 && !bad, `${cells} cells;${bad}`);
    ok(`Value, ${which} box: each Avg is the mean of its row's converted regular-season cells`, !badAvg, badAvg);
    ok(`Value, ${which} box: nothing is negative`,
      vb.rows.every((r) => !NEG.test(r.avgText) && r.cells.every((c) => !NEG.test(c.txt) && !(c.v < 0))));
    ok(`Value, ${which} box: the Starting lineup band (a team total) has not moved`,
      pb.band.length >= 10 && same(pb.band, vb.band) && pb.bandAvg === vb.bandAvg, `${JSON.stringify(vb.band).slice(0, 200)}`);
    ok(`Value, ${which} box: a slot row HAS moved (the switch is not a no-op)`, !same(pb.rows, vb.rows));
  }
  ok('Value: the opponent row has not moved', P.after.opp.length > 0 && same(P.after.opp, V.after.opp), JSON.stringify(V.after.opp));
  ok('Value: the gains over the squads have not moved', P.gainA.length > 0 && P.gainA === V.gainA && P.gainB === V.gainB, `${V.gainA} | ${V.gainB}`);
  ok('Value: the depth map has not moved', P.depth.length > 50 && P.depth === V.depth);
  ok('Value: the finder has not moved', P.finder.length > 200 && P.finder === V.finder, where({ f: P.finder }, { f: V.finder }));
  // One cell by hand: Ana's QB slot holds whichever quarterback is on his 19,
  // every week — (15 − 10) / 2 + 4 = 6.5.
  const qb = V.before.rows.find((r) => r.slot === 'QB');
  ok('Value: Ana\'s QB slot is 6.5 every week still to play (a 19 over a 10/15 line)',
    qb && qb.cells.filter(regular).length === 10 && qb.cells.filter(regular).every((c) => c.v === 6.5) && qb.avg === 6.5,
    JSON.stringify(qb && qb.cells.map((c) => c.v)));

  // ------------------------------------------------------------- 5. Difference
  ok('Difference in Value: there was a switch to press', got.pressed === true && !!got.valueDiff && !!got.back);
  if (got.pressed && got.valueDiff && got.back) {
    const tot = got.valueTotal;
    const d = got.valueDiff;
    let bad = '';
    let n = 0;
    let moved = 0;
    ok('Difference in Value: the view switched', d && d.view === 'diff', d && d.view);
    (d ? d.rows : []).forEach((row, ri) => {
      row.cells.forEach((c, ci) => {
        const a = tot.after.rows[ri].cells[ci].v;
        const b = tot.before.rows[ri].cells[ci].v;
        if (a === null || b === null) { if (c.v !== null) bad += ` ${row.slot} wk${c.week}: ${c.v} from a blank`; return; }
        n++;
        const want = r1(r1(a) - r1(b));
        if (want !== 0) moved++;
        if (c.v !== want) bad += ` ${row.slot} wk${c.week}: ${c.v}, want ${a} − ${b}`;
      });
    });
    ok('Difference in Value: each cell is Value after − Value before', n >= 90 && !bad, `${n} cells;${bad}`);
    ok('Difference in Value: the deal moves at least one cell', moved > 0, moved);
    ok('Difference in Value: the band is the Proj band\'s difference (team totals)',
      d && d.band.every((c, i) => c.v === r1(r1(P.after.band[i].v) - r1(P.before.band[i].v))), JSON.stringify(d && d.band).slice(0, 200));
  }

  // -------------------------------------------------- back, by the other switch
  const BACK = got.back || { toolbar: { on: [] }, seasonSwitches: [] };
  ok('the season box\'s switch moves the same state', got.pressedSeason === true && same(BACK.toolbar.on, ['proj']) &&
    same(sw0(BACK.seasonSwitches).on, ['proj']) && got.prefBack === 'proj', JSON.stringify([BACK.toolbar, got.prefBack]));
  ok('back on Proj the page is the page it was', same(BACK, P), where(BACK, P));

  // ------------------------------------------------------------ 6. remembered
  const again = run('visit', { FF_VALUE, TV_PREF: 'value' });
  ok('remembered Value: the next visit opens on Value', !again.boot && same(again.first.toolbar.on, ['value']) &&
    same(sw0(again.first.seasonSwitches).on, ['value']), again.boot || JSON.stringify(again.first.toolbar));
  ok('remembered Value: and draws Value', same(strip(again.first), strip(V)), where(strip(again.first), strip(V)));
  ok('remembered Value: pressing Proj there gives the Proj page', again.pressed === true && same(strip(again.second), strip(P)),
    where(strip(again.second), strip(P)));

  // ----------------------------------------------------------------- 7. cards
  const lead = (c) => (c ? c.glance : '');
  ok('card, custom list (yours): Value first — Ana QB1 1.5', got.card.mine && /Ana QB1/.test(got.card.mine.ident) &&
    lead(got.card.mine).startsWith(`Value ${players[100].value.toFixed(1)}`) && players[100].value === 1.5, JSON.stringify(got.card.mine));
  ok('card, custom list (his): Value first — Cy RB3', got.card.his && /Cy RB3/.test(got.card.his.ident) &&
    lead(got.card.his).startsWith(`Value ${players[309].value.toFixed(1)}`), JSON.stringify(got.card.his));
  ok('card, season box: Value first', got.card.season && lead(got.card.season).startsWith('Value 1.5'), JSON.stringify(got.card.season));
  ok('card, finder: Value first', got.card.finder && /^Value \d+\.\d/.test(lead(got.card.finder)), JSON.stringify(got.card.finder));

  // ------------------------------------------------- 9. each side's total Value
  // One for one (the deal above): Ana gives 110 and gets 309.
  const sgn = (n) => { const r = r1(n); return (r === 0 ? '' : r > 0 ? '+' : '−') + Math.abs(r).toFixed(1); };
  const kind = (n) => (r1(n) > 0 ? 'up' : r1(n) < 0 ? 'down' : 'flat');
  const one = players[309].value - players[110].value;
  ok('total Value, no lines: neither side shows one', none.first.valA === null && none.first.valB === null,
    JSON.stringify([none.first.valA, none.first.valB]));
  ok('total Value, one for one: yours is what you get less what you give',
    P.valA && P.valA.txt === `${sgn(one)} value` && P.valA.cls === kind(one), `${JSON.stringify(P.valA)}, want ${sgn(one)}`);
  ok('total Value, one for one: his is the other way round',
    P.valB && P.valB.txt === `${sgn(-one)} value` && P.valB.cls === kind(-one), `${JSON.stringify(P.valB)}, want ${sgn(-one)}`);
  ok('total Value: the same on Value as on Proj (it follows no switch)', same(P.valA, V.valA) && same(P.valB, V.valB),
    JSON.stringify([V.valA, V.valB]));
  ok('total Value: it sits on the small line under the big figure, after the weeks',
    P.valA && /over weeks? [\d–-]+ · [+−]?\d+\.\d value$/.test(P.valA.line), P.valA && P.valA.line);

  // Two for one: Ana QB1 (1.5) and Ana TE2 for Cy RB1 (7.0).
  const two = run('twofer', { FF_VALUE });
  const want2 = players[301].value - (players[100].value + players[110].value);
  ok('total Value, 2 for 1: the deal priced', !two.boot && two.errors.length === 0 && /\/wk/.test(two.proj.gainA),
    two.boot || JSON.stringify([two.errors, two.proj]));
  ok('total Value, 2 for 1: the men are worth what the hand sum says (7.0 − (1.5 + TE2))',
    players[301].value === 7 && players[100].value === 1.5 && r1(want2) !== 0 && r1(want2) !== r1(one), `${want2}`);
  ok('total Value, 2 for 1: yours is the one man you get less BOTH men you give',
    two.proj.valA && two.proj.valA.txt === `${sgn(want2)} value` && two.proj.valA.cls === kind(want2),
    `${JSON.stringify(two.proj.valA)}, want ${sgn(want2)}`);
  ok('total Value, 2 for 1: his is both men he gets less the one he gives',
    two.proj.valB && two.proj.valB.txt === `${sgn(-want2)} value` && two.proj.valB.cls === kind(-want2),
    `${JSON.stringify(two.proj.valB)}, want ${sgn(-want2)}`);
  ok('total Value, 2 for 1: unchanged by the Value switch', same(two.proj, two.value), JSON.stringify(two.value));
  ok('total Value: gone when the deal is cleared', two.cleared.valA === null && two.cleared.valB === null, JSON.stringify(two.cleared));
  const two0 = run('twofer');
  ok('total Value, 2 for 1 with no lines: absent, and the figures are the same figures',
    !two0.boot && two0.proj.valA === null && two0.proj.valB === null && two0.proj.gainA === two.proj.gainA &&
    two0.proj.gainB === two.proj.gainB, two0.boot || JSON.stringify(two0.proj));

  // --------------------------------------------------------------- 8. assumed
  const asm = run('assumed', { FF_VALUE });
  ok('assumed: boots clean and the block is up', !asm.boot && asm.errors.length === 0 && asm.assumeButton && asm.proj.panelHidden === false,
    asm.boot || JSON.stringify([asm.errors, asm.assumeButton, asm.proj && asm.proj.panelHidden]));
  if (!asm.boot) {
    ok('assumed: its season box carries the switch, on Proj', asm.proj.switches.length === 1 && same(sw0(asm.proj.switches).on, ['proj']),
      JSON.stringify(asm.proj.switches));
    ok('assumed: pressing Value there moves the page\'s one state', same(sw0(asm.value.switches).on, ['value']) &&
      same(asm.toolbar.on, ['value']), JSON.stringify([asm.value.switches, asm.toolbar]));
    let bad = '';
    let n = 0;
    asm.proj.after.rows.forEach((row, ri) => row.cells.forEach((c, ci) => {
      if (c.pid === null || c.v === null) return;
      n++;
      const want = valueOf(BASE, POS.get(c.pid), c.v);
      const vc = asm.value.after.rows[ri].cells[ci];
      if (vc.v !== want) bad += ` ${row.slot} wk${c.week}: ${c.v} → ${vc.v}, want ${want}`;
    }));
    ok('assumed: every slot cell converts', n >= 90 && !bad, `${n} cells;${bad}`);
    ok('assumed: its Starting lineup band and its saved row have not moved',
      same(asm.proj.after.band, asm.value.after.band) && asm.proj.row === asm.value.row && asm.proj.row.length > 20);
  }

  if (fails.length) {
    console.log(`\n${fails.length} FAILED:`);
    for (const f of fails) console.log(`  FAIL ${f}`);
  }
  console.log(`\n${pass} passed, ${fails.length} failed`);
  process.exit(fails.length ? 1 : 0);
}
