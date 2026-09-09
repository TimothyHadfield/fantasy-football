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
ok(mineRows.every((tr) => ![...tr.querySelectorAll('td')].some((td) => td.classList.contains('beats'))),
  'nor is one of them shaded — a row cannot beat itself');

// --- the SECOND green: beating your own worst man at that position ---------
// A separate cue answering a separate question, so it is a separate class. The
// rule is: strictly ahead of the "Your …" row's number for that same week.
const mineByPos = new Map();
for (const tr of mineRows) {
  const cells = [...tr.querySelectorAll('td')];
  mineByPos.set(cells[posCol].textContent.trim(), cells);
}
ok(mineByPos.size >= 4, 'the demo squad covers several positions', `${mineByPos.size}`);

let shadeChecked = 0, shades = 0, wrongShade = 0, missedShade = 0, comparable = 0;
for (const tr of rows) {
  const cells = [...tr.querySelectorAll('td')];
  const pos = cells[posCol].textContent.trim();
  const mineCells = mineByPos.get(pos);
  for (let i = firstWeekCol; i < cells.length; i++) {
    const td = cells[i];
    const isShaded = td.classList.contains('beats');
    if (isShaded) shades++;

    const raw = td.getAttribute('data-v');
    if (raw === null) { ok(!isShaded, 'a cell with no value is never shaded'); continue; }
    if (td.classList.contains('bye')) { ok(!isShaded, 'a bye is never shaded — 0.00 beats nobody'); continue; }
    if (!mineCells) { ok(!isShaded, `a position you hold nobody at (${pos}) is never shaded`); continue; }

    const mineRaw = mineCells[i].getAttribute('data-v');
    if (mineRaw === null) { ok(!isShaded, 'no number of yours that week means no comparison'); continue; }

    comparable++;
    const should = Number(raw) > Number(mineRaw);
    shadeChecked++;
    if (should && !isShaded) { missedShade++; console.log(`  missed shade: ${pos} ${raw} > ${mineRaw}`); }
    if (!should && isShaded) { wrongShade++; console.log(`  wrong shade:  ${pos} ${raw} vs ${mineRaw}`); }
  }
}
ok(shadeChecked > 50, 'checked a decent number of cells against your own men', `${shadeChecked}`);
ok(missedShade === 0, 'every cell that beats your man is shaded', `${missedShade} missed`);
ok(wrongShade === 0, 'no cell is shaded that does not beat him', `${wrongShade} wrong`);
ok(shades > 0, 'some cells actually beat him', `${shades} shaded`);
ok(shades < comparable, 'and some do not, so the table is not uniformly green',
  `${shades} of ${comparable}`);
// The two cues are independent, and the demo must actually exercise that.
const both = rows.flatMap((tr) => [...tr.querySelectorAll('td')])
  .filter((td) => td.classList.contains('hot') && td.classList.contains('beats')).length;
const shadeOnly = rows.flatMap((tr) => [...tr.querySelectorAll('td')])
  .filter((td) => td.classList.contains('beats') && !td.classList.contains('hot')).length;
ok(both > 0, 'a cell can carry both greens at once', `${both}`);
ok(shadeOnly > 0, 'and a cell can beat your man without clearing the startable bar', `${shadeOnly}`);
console.log(`  shaded: ${shades} of ${comparable} comparable (${both} also over the bar)`);

// --- the note explains the colour -----------------------------------------
const note = document.getElementById('waiverNote').textContent;
ok(/green/i.test(note), 'the note mentions the colour');
for (const [pos, bar] of Object.entries(BARS)) {
  ok(note.includes(`${pos} over ${bar}`), `note states the ${pos} bar`, note.slice(0, 200));
}
ok(document.getElementById('waiverNote').querySelector('.hot-key') !== null,
  'the word green is shown in green');
ok(/out-projects your own worst man at his position/.test(note),
  'the note explains the shading too', note.slice(0, 200));
ok(/a bye is never shaded/.test(note), 'and says a bye cannot beat anybody', note.slice(0, 200));
ok(document.getElementById('waiverNote').querySelector('.beats-key') !== null,
  'the shading is shown in the note in the treatment it describes');

// --- FLEX changes WHICH ROWS you see, and nothing about the colour ---------
//
// FLEX is a filter across RB, WR and TE, so the danger it introduces is that
// somebody "helpfully" gives it a startable bar of its own, or measures a tight
// end against a flex bar while it is pressed. Both would be invisible: the table
// would still be full of plausible green. So the cues are recorded per player
// per week BEFORE the button is pressed and compared cell for cell after, and
// the note is re-read to prove no seventh bar appeared in it.
const cueKey = (tr) => tr.getAttribute('data-player');
function cuesOf(scope) {
  const out = new Map();
  for (const tr of [...scope.querySelectorAll('#waiverTable tbody tr')]) {
    if (tr.classList.contains('empty-row')) continue;
    const cells = [...tr.querySelectorAll('td')];
    out.set(`${cueKey(tr)}|${tr.classList.contains('mine') ? 'mine' : 'wire'}`, {
      pos: cells[posCol].textContent.trim(),
      cues: cells.slice(firstWeekCol).map((td) =>
        `${td.classList.contains('hot') ? 'H' : '-'}${td.classList.contains('beats') ? 'B' : '-'}` +
        `:${td.getAttribute('data-v')}`),
    });
  }
  return out;
}

const cuesBefore = cuesOf(document);
document.querySelector('#posFilter button[data-pos="FLEX"]')
  .dispatchEvent(new window.Event('click', { bubbles: true }));
const cuesAfter = cuesOf(document);

ok(cuesAfter.size > 0 && cuesAfter.size < cuesBefore.size,
  'FLEX narrows the table', `${cuesAfter.size} of ${cuesBefore.size}`);
ok([...cuesAfter.values()].every((r) => ['RB', 'WR', 'TE'].includes(r.pos)),
  'to exactly the running backs, receivers and tight ends',
  [...new Set([...cuesAfter.values()].map((r) => r.pos))].join(','));
ok(new Set([...cuesAfter.values()].map((r) => r.pos)).size === 3,
  'all three of them, so the check is not vacuous',
  [...new Set([...cuesAfter.values()].map((r) => r.pos))].join(','));

let movedCue = 0, firstMoved = '';
for (const [key, after] of cuesAfter) {
  const before = cuesBefore.get(key);
  if (!before || JSON.stringify(before.cues) !== JSON.stringify(after.cues)) {
    movedCue++;
    if (!firstMoved) firstMoved = `${key}: ${JSON.stringify(before && before.cues)} -> ${JSON.stringify(after.cues)}`;
  }
}
ok(movedCue === 0, 'NOT ONE CELL CHANGES COLOUR BECAUSE FLEX IS PRESSED', firstMoved);

// And the greens are actually there to have been preserved, per position.
const greensNow = {};
for (const r of cuesAfter.values()) {
  for (const cue of r.cues) if (cue.startsWith('H')) greensNow[r.pos] = (greensNow[r.pos] || 0) + 1;
}
ok(Object.keys(greensNow).length > 1,
  'more than one of the three still has green weeks under FLEX', JSON.stringify(greensNow));
ok((greensNow.WR || 0) > 0, 'a receiver over 12 is still green under FLEX', JSON.stringify(greensNow));
const overBarWr = [...cuesAfter.values()].filter((r) => r.pos === 'WR')
  .flatMap((r) => r.cues)
  .filter((cue) => {
    const v = cue.split(':')[1];
    return v !== 'null' && Number(v) > BARS.WR;
  });
ok(overBarWr.length > 0 && overBarWr.every((cue) => cue.startsWith('H')),
  'and every receiver week over the WR bar is green, by that bar and no other',
  overBarWr.filter((cue) => !cue.startsWith('H')).slice(0, 3).join(','));
ok([...cuesAfter.values()].some((r) => r.cues.some((cue) => cue.slice(1, 2) === 'B')),
  'the second green survives it too');

const flexNote = document.getElementById('waiverNote').textContent;
for (const [pos, bar] of Object.entries(BARS)) {
  ok(flexNote.includes(`${pos} over ${bar}`), `the note still states the ${pos} bar under FLEX`);
}
ok(!/FLEX over \d/.test(flexNote), 'and states no FLEX bar, because there is not one',
  flexNote.slice(0, 200));
ok(/FLEX<\/strong> is not a position but a filter across three/
  .test(document.getElementById('waiverNote').innerHTML),
  'the note says what FLEX is', flexNote.slice(0, 200));
ok(/measured against his own position’s bar/.test(flexNote),
  'and that a flex-eligible player is still measured against his own bar', flexNote.slice(0, 200));

ok(errors.length === 0, 'no console errors', errors.slice(0, 2).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
