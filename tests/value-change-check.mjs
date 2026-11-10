// CHANGE IN VALUE on the pages (Tim, 2026-11-10): "Right now throughout the
// cite you can select "proj or value", but I want to add "change in value" to
// that list".
//
//   node value-change-check.mjs
//
// The real pages with the real js/season.js on the sample league, as
// value-match-check.mjs boots them (one page per child process). The sample
// league has no saved projections, so every change there is a dash with its
// reason; the numbers themselves are js/value-change.js's (test-value-change.mjs)
// and were looked at headless on league 1241838.
//
// Claims, per page:
//   1. every Proj | Value switch has a third button, "Change in value";
//   2. opened on it, every switch on the page shows it lit (synced);
//   3. the man's own figure says Change and prints a signed tenth or a dash;
//   4. a dash keeps its preview, which says why (js/value-change.js whyText);
//   5. pressing Value in ONE box lights Value in every box, and back.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
import { emit } from './emit.mjs';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
/** The figure a cell prints, without its heat mark. */
const printed = (el) => (text(el).match(/^(?:[+−-]?\d+(?:\.\d+)?|—)/) || [''])[0];
const SIGNED = /^(?:[+−]\d+\.\d|0\.0|—)$/;

async function boot(page, prefs) {
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
  const store = new Map([['ff.prefs', JSON.stringify(prefs)]]);
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
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
  await pause(700);
  if (page === 'trade.html') {
    for (let i = 0; i < 1800 && !document.querySelector('#tradeTable[data-ranked]'); i++) await pause(100);
  }
  await pause(900);
  console.error = origError;
  const click = async (el) => { el.dispatchEvent(new window.Event('click', { bubbles: true })); await pause(400); };
  return { document, window, errors, fetchCalls, click };
}

/** Each switch box on the page: its buttons' keys and which is lit. */
function boxes(document, sel, attr) {
  return [...document.querySelectorAll(sel)].map((box) => {
    const btns = [...box.querySelectorAll(`button[${attr}]`)];
    return {
      keys: btns.map((b) => b.getAttribute(attr)),
      labels: btns.map(text),
      on: btns.filter((b) => b.classList.contains('on')).map((b) => b.getAttribute(attr)),
    };
  });
}

async function players() {
  const { document, errors, fetchCalls, click } = await boot('waivers.html', { 'waivers.show': 'change' });
  const SEL = '#showToggle, #takenShowToggle';
  const first = boxes(document, SEL, 'data-show');
  const table = document.getElementById('takenTable');
  const heads = [...table.querySelectorAll('thead th')].map(text);
  const col = heads.indexOf('Change');
  const cells = col < 0 ? [] : [...table.querySelectorAll('tbody tr[data-player]')].map((tr) => printed(tr.children[col]));
  // A dash keeps its preview (the card that says why): the cell is still a card cell.
  const dashCards = col < 0 ? [] : [...table.querySelectorAll('tbody tr[data-player]')]
    .map((tr) => tr.children[col]).filter((c) => printed(c) === '—').map((c) => c.getAttribute('data-c'));
  await click(document.querySelector('#showToggle button[data-show="value"]'));
  const afterValue = boxes(document, SEL, 'data-show');
  const headValue = [...table.querySelectorAll('thead th')].map(text).includes('Value');
  await click(document.querySelector('#takenShowToggle button[data-show="change"]'));
  const afterChange = boxes(document, SEL, 'data-show');
  return { first, heads, col, cells, dashCards, afterValue, headValue, afterChange, errors, fetchCalls };
}

async function trade() {
  const { document, errors, fetchCalls, click } = await boot('trade.html', { 'trade.valueView': 'change', 'trade.source': 'demo' });
  const first = boxes(document, '#cuValueView', 'data-value-view');
  const cells = [...document.querySelectorAll('#cuListA .cu-man .pv, #cuListB .cu-man .pv')].map(printed);
  await click(document.querySelector('#cuValueView button[data-value-view="value"]'));
  const afterValue = boxes(document, '#cuValueView', 'data-value-view');
  return { first, cells, afterValue, errors, fetchCalls };
}

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  try {
    emit(process.argv[2] === 'players' ? await players() : await trade(), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

function run(mode) {
  const res = spawnSync(process.execPath, [self, mode], { encoding: 'utf8', cwd: path.dirname(self), maxBuffer: 64 * 1024 * 1024 });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) throw new Error(`no result for ${mode} - exit ${res.status}\n${String(res.stderr).slice(-1500)}`);
  return JSON.parse(line.slice(2));
}

if (!process.argv[2]) {
  let pass = 0;
  const fails = [];
  const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}`);
  };
  const three = (bs, key) => bs.length >= 1 && bs.every((b) => b.keys.join() === `proj,value,${key}` &&
    b.labels[2] === 'Change in value');
  const lit = (bs, k) => bs.length >= 1 && bs.every((b) => b.on.length === 1 && b.on[0] === k);

  const P = run('players');
  ok('Players: boots clean', !P.boot && P.errors.length === 0, P.boot || P.errors.slice(0, 2).join(' | '));
  if (!P.boot) {
    ok('Players: no network call', P.fetchCalls.length === 0, P.fetchCalls.slice(0, 2).join(' | '));
    ok('Players: both switches have Proj, Value, Change in value', P.first.length === 2 && three(P.first, 'change'), JSON.stringify(P.first));
    ok('Players: opened on Change, both lit', lit(P.first, 'change'), JSON.stringify(P.first));
    ok('Players: the Value column says Change', P.col >= 0, P.heads.join('/'));
    ok('Players: every Change cell is a signed tenth or a dash', P.cells.length >= 60 && P.cells.every((c) => SIGNED.test(c)),
      `${P.cells.length} cells: ${P.cells.slice(0, 8).join(',')}`);
    ok('Players (sample league, no saved weeks): the cells are dashes', P.cells.every((c) => c === '—'), P.cells.slice(0, 5).join(','));
    ok('Players: every dash keeps its preview (it says why)', P.dashCards.length > 0 && P.dashCards.every((c) => c === 'avg'),
      `${P.dashCards.length} dashes, ${P.dashCards.filter((c) => c !== 'avg').length} without a card`);
    ok('Players: Value pressed in one box lights Value in both', lit(P.afterValue, 'value') && P.headValue, JSON.stringify(P.afterValue));
    ok('Players: Change pressed in the other box lights Change in both', lit(P.afterChange, 'change'), JSON.stringify(P.afterChange));
  }

  const T = run('trade');
  ok('Trade: boots clean', !T.boot && T.errors.length === 0, T.boot || T.errors.slice(0, 2).join(' | '));
  if (!T.boot) {
    ok('Trade: no network call', T.fetchCalls.length === 0, T.fetchCalls.slice(0, 2).join(' | '));
    ok('Trade: the switch has Proj, Value, Change in value', three(T.first, 'change'), JSON.stringify(T.first));
    ok('Trade: opened on Change', lit(T.first, 'change'), JSON.stringify(T.first));
    ok('Trade: every figure in the custom lists is a signed tenth or a dash', T.cells.length >= 20 && T.cells.every((c) => SIGNED.test(c)),
      `${T.cells.length}: ${T.cells.slice(0, 8).join(',')}`);
    ok('Trade: Value pressed lights Value', lit(T.afterValue, 'value'), JSON.stringify(T.afterValue));
  }

  // The other pages' switches carry the third button too (their markup).
  const an = readFileSync(path.join(REPO, 'analysis.html'), 'utf8');
  ok('Analysis: all four switches have Change in value',
    (an.match(/data-show="change"[^>]*>Change in value</g) || []).length === 4);
  const po = readFileSync(path.join(REPO, 'js/playoffs-players.js'), 'utf8');
  ok('Playoffs: the players switch has Change in value', /data-show="change">Change in value</.test(po));

  console.log(`value-change-check: ${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(fails.length ? 1 : 0);
}
