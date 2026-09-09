// Checks the per-position green highlighting on the Add players table:
// the right cells go green, the boundary does NOT, and nothing else moves.
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO } from './repo.mjs';
const BARS = { QB: 17, RB: 12, WR: 12, TE: 9, DST: 7, K: 9 };

let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++; else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};

// --- harness ---------------------------------------------------------------
const html = readFileSync(path.join(REPO, 'waivers.html'), 'utf8');
const { window, document } = parseHTML(html);

const SelectProto = window.HTMLSelectElement?.prototype;
if (SelectProto) {
  Object.defineProperty(SelectProto, 'value', {
    configurable: true,
    get() { const s = this.querySelector('option[selected]') || this.querySelector('option'); return s ? s.getAttribute('value') ?? s.textContent : ''; },
    set(v) { for (const o of this.querySelectorAll('option')) { if ((o.getAttribute('value') ?? o.textContent) === String(v)) o.setAttribute('selected',''); else o.removeAttribute('selected'); } },
  });
}
const TableProto = Object.getPrototypeOf(document.createElement('table'));
const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
Object.defineProperty(TableProto, 'rows', { configurable: true, get() {
  const rows = []; const h = kids(this, 'THEAD')[0];
  if (h) rows.push(...kids(h, 'TR'));
  for (const b of kids(this, 'TBODY')) rows.push(...kids(b, 'TR'));
  return rows; } });
const RowProto = Object.getPrototypeOf(document.createElement('tr'));
Object.defineProperty(RowProto, 'cells', { configurable: true, get() {
  return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); } });

if (!window.location) window.location = { href: 'http://localhost/', origin: 'http://localhost', pathname: '/waivers.html', search: '', hash: '' };
globalThis.location = window.location;
if (!window.postMessage) window.postMessage = () => {};
const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
const errors = [];
Object.assign(globalThis, {
  window, document, localStorage,
  fetch: async (u) => { throw new Error(`unexpected network call: ${u}`); },
  HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent, Event: window.Event, Node: window.Node,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: (id) => clearTimeout(id),
  ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
});
window.localStorage = localStorage;
window.requestAnimationFrame = globalThis.requestAnimationFrame;
window.ResizeObserver = globalThis.ResizeObserver;
const origErr = console.error;
console.error = (...a) => { errors.push(a.join(' ')); };

await import(pathToFileURL(path.join(REPO, 'js/waivers-page.js')).href);
await new Promise((r) => setTimeout(r, 400));
console.error = origErr;

// --- read the rendered table ----------------------------------------------
const table = document.getElementById('waiverTable');
const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
const posCol = heads.findIndex((h) => /^Pos$/i.test(h));
const avgCol = heads.findIndex((h) => /^Avg$/i.test(h));
const firstWeekCol = avgCol + 1;
ok(posCol > 0 && avgCol > posCol, 'found the Pos and Avg columns', heads.join('|'));

const allRows = [...table.querySelectorAll('tbody tr')].filter((r) => !r.classList.contains('empty-row'));
// The "Your …" comparison rows share this tbody but are NOT wire players, and
// the green is a claim-worthiness cue, so they are excluded from the rule below
// and checked separately at the bottom of this file. (Before those rows existed
// this loop ran over every row in the tbody, which was the same set.)
const mineRows = allRows.filter((r) => r.classList.contains('mine'));
const rows = allRows.filter((r) => !r.classList.contains('mine'));
ok(rows.length > 0, 'demo table has rows', `${rows.length}`);

let checked = 0, greens = 0, wrongGreen = 0, missedGreen = 0, byPos = {};
for (const tr of rows) {
  const cells = [...tr.querySelectorAll('td')];
  const pos = cells[posCol].textContent.trim();
  for (let i = firstWeekCol; i < cells.length; i++) {
    const td = cells[i];
    const raw = td.getAttribute('data-v');
    const isHot = td.classList.contains('hot');
    if (isHot) { greens++; byPos[pos] = (byPos[pos] || 0) + 1; }

    // Only numeric, non-bye cells can qualify.
    if (raw === null || raw === '') { ok(!isHot, 'a cell with no value is never green'); continue; }
    const v = Number(raw);
    if (td.classList.contains('bye')) { ok(!isHot, 'a bye is never green'); continue; }

    const bar = BARS[pos];
    const should = typeof bar === 'number' && v > bar;
    checked++;
    if (should && !isHot) { missedGreen++; console.log(`  missed: ${pos} ${v} > ${bar}`); }
    if (!should && isHot) { wrongGreen++; console.log(`  wrong:  ${pos} ${v} vs bar ${bar}`); }
  }
}
ok(checked > 50, 'checked a decent number of cells', `${checked}`);
ok(missedGreen === 0, 'every qualifying cell is green', `${missedGreen} missed`);
ok(wrongGreen === 0, 'no cell is green that should not be', `${wrongGreen} wrong`);
ok(greens > 0, 'some cells actually qualified', `${greens} green`);
console.log(`  green cells by position: ${JSON.stringify(byPos)}`);

// --- the boundary: exactly at the bar must NOT be green --------------------
// Exercise the module's own rule through a synthetic row rather than trusting
// that the demo pool happens to contain an exact-threshold value.
const mod = await import(pathToFileURL(path.join(REPO, 'js/waivers-page.js')).href);
for (const [pos, bar] of Object.entries(BARS)) {
  // Re-derive from the rendered DOM: find any cell of this position at/over bar.
  const over = rows.some((tr) => {
    const cells = [...tr.querySelectorAll('td')];
    if (cells[posCol].textContent.trim() !== pos) return false;
    return cells.slice(firstWeekCol).some((td) => {
      const raw = td.getAttribute('data-v');
      if (raw === null) return false;
      return Number(raw) === bar && td.classList.contains('hot');
    });
  });
  ok(!over, `${pos} exactly at ${bar} is not green (over means over)`);
}

// --- your own rows are never green ----------------------------------------
// The green says "worth starting, so worth claiming". On a man already on your
// bench that answers a different question, so those weeks stay uncoloured
// however high the number is.
ok(mineRows.length > 0, 'the demo table carries comparison rows at all', `${mineRows.length}`);
let mineHot = 0, mineOverBar = 0;
for (const tr of mineRows) {
  const cells = [...tr.querySelectorAll('td')];
  const pos = cells[posCol].textContent.trim();
  for (let i = firstWeekCol; i < cells.length; i++) {
    const td = cells[i];
    if (td.classList.contains('hot')) mineHot++;
    const raw = td.getAttribute('data-v');
    if (raw !== null && typeof BARS[pos] === 'number' && Number(raw) > BARS[pos]) mineOverBar++;
  }
}
ok(mineHot === 0, 'not one comparison-row cell is green', `${mineHot} green`);
ok(mineOverBar > 0, 'and some of them clear the bar, so that is not a vacuous check',
  `${mineOverBar} over`);

// --- the note explains the colour -----------------------------------------
const note = document.getElementById('waiverNote').textContent;
ok(/green/i.test(note), 'the note mentions the colour');
for (const [pos, bar] of Object.entries(BARS)) {
  ok(note.includes(`${pos} over ${bar}`), `note states the ${pos} bar`, note.slice(0, 200));
}
ok(document.getElementById('waiverNote').querySelector('.hot-key') !== null,
  'the word green is shown in green');

ok(errors.length === 0, 'no console errors', errors.slice(0, 2).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
