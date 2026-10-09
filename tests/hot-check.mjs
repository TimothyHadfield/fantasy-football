// Checks the one claim cue on the Players page's Available table, on the demo
// league: THE GREEN BOX — "you would start him that week" (Tim, 2026-10-09) —
// and that the green NUMBER it used to share the table with is gone.
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO } from './repo.mjs';
// The set bars the removed green number used: only to prove that weeks over
// them are still on screen, uncoloured.
const OLD_BARS = { QB: 17, RB: 12, WR: 12, TE: 9, DST: 7, K: 9 };

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
// The weeks already played are columns too (2026-10-04), drawn between Avg and
// the weeks still to price. They are PLAIN on purpose — the box is a claim
// about a week you could still start a man in — so the rule below starts at
// the first priced week, and the previous weeks are checked to carry no cue.
const pastCols = table.querySelectorAll('thead th.wk-past').length;
// Gain (2026-10-06) sits between Avg and the weeks; it is not a week either.
const gainCol = heads.findIndex((h) => /^Gain$/i.test(h));
const firstWeekCol = Math.max(avgCol, gainCol) + 1 + pastCols;
ok(posCol > 0 && avgCol > posCol, 'found the Pos and Avg columns', heads.join('|'));
ok(pastCols === 3, 'the three played weeks are columns before the priced ones', heads.join('|'));
{
  const past = [...table.querySelectorAll('tbody td.wk-past')];
  ok(past.length > 100 && past.every((td) => !td.classList.contains('hot') && !td.classList.contains('beats')),
    'a played week is never green or boxed',
    `${past.filter((td) => td.classList.contains('hot') || td.classList.contains('beats')).length} of ${past.length}`);
}

const allRows = [...table.querySelectorAll('tbody tr')].filter((r) => !r.classList.contains('empty-row'));
// The "Your …" comparison rows share this tbody but are NOT wire players, and
// the box is a claim cue, so they are checked separately below.
const mineRows = allRows.filter((r) => r.classList.contains('mine'));
const rows = allRows.filter((r) => !r.classList.contains('mine'));
ok(rows.length > 0, 'demo table has rows', `${rows.length}`);
ok(mineRows.length > 0, 'the demo table carries comparison rows at all', `${mineRows.length}`);

// --- THE GREEN NUMBER IS GONE ----------------------------------------------
// It used to mark a week over a set bar per position ("worth starting").
ok(document.querySelectorAll('td.hot').length === 0,
  'NO CELL IN EITHER TABLE CARRIES THE GREEN-NUMBER CLASS', `${document.querySelectorAll('td.hot').length} td.hot`);
{
  let over = 0;
  for (const tr of rows) {
    const cells = [...tr.querySelectorAll('td')];
    const bar = OLD_BARS[cells[posCol].textContent.trim()];
    for (const td of cells.slice(firstWeekCol)) {
      const raw = td.getAttribute('data-v');
      if (raw !== null && Number(raw) > bar) over++;
    }
  }
  ok(over > 0, 'and weeks over the old bars are on screen, so that is not a vacuous check', `${over} over`);
}
const legend = document.getElementById('waiverLegend');
ok(!legend.querySelector('.hot') && !/worth starting/i.test(legend.textContent),
  'the key no longer shows a green number', legend.textContent.replace(/\s+/g, ' ').trim());

// --- THE GREEN BOX: YOU WOULD START HIM THAT WEEK ---------------------------
// The rule itself is pinned cell for cell against a hand-built squad in
// cmp-check.mjs. Here, on the demo league, what must hold whatever the squad:
// the box is a THRESHOLD within a position and a week — if a free agent is
// boxed, every free agent at his position projecting more that week is too —
// and nothing that is not a number above zero is ever boxed.
const byPosWeek = new Map();
let boxes = 0, numbers = 0;
for (const tr of rows) {
  const cells = [...tr.querySelectorAll('td')];
  const pos = cells[posCol].textContent.trim();
  for (let i = firstWeekCol; i < cells.length; i++) {
    const td = cells[i];
    const boxed = td.classList.contains('beats');
    const raw = td.getAttribute('data-v');
    if (raw === null || raw === '') { ok(!boxed, 'a cell with no value is never boxed'); continue; }
    if (td.classList.contains('bye')) { ok(!boxed, 'a bye is never boxed'); continue; }
    if (Number(raw) === 0) { ok(!boxed, 'a zero is never boxed'); continue; }
    numbers++;
    if (boxed) boxes++;
    const key = `${pos}|${i}`;
    if (!byPosWeek.has(key)) byPosWeek.set(key, []);
    byPosWeek.get(key).push({ v: Number(raw), boxed });
  }
}
ok(numbers > 50, 'checked a decent number of cells', `${numbers}`);
ok(boxes > 0, 'some weeks are boxed', `${boxes} boxed`);
ok(boxes < numbers, 'and some are not, so the table is not uniformly boxed', `${boxes} of ${numbers}`);
{
  let broken = '';
  let mixed = 0;
  for (const [key, cellsAt] of byPosWeek) {
    const lowestBoxed = Math.min(...cellsAt.filter((c) => c.boxed).map((c) => c.v));
    const highestPlain = Math.max(...cellsAt.filter((c) => !c.boxed).map((c) => c.v));
    if (Number.isFinite(lowestBoxed) && Number.isFinite(highestPlain)) mixed++;
    if (highestPlain >= lowestBoxed && !broken) broken = `${key}: ${highestPlain} plain, ${lowestBoxed} boxed`;
  }
  ok(!broken, 'within a position and a week the box is a threshold: nobody plain out-projects a boxed man', broken);
  ok(mixed > 0, 'and some position-weeks have both, so the threshold is really tested', `${mixed}`);
}
console.log(`  boxed: ${boxes} of ${numbers} numbered wire weeks`);

// --- your own rows are never boxed ------------------------------------------
ok(mineRows.every((tr) => ![...tr.querySelectorAll('td')].some((td) => td.classList.contains('beats'))),
  'not one comparison-row cell is boxed — the box is about a man you could add');
// --- nor is anybody in the Taken table --------------------------------------
ok(document.querySelectorAll('#takenTable td.beats').length === 0 &&
  document.querySelectorAll('#takenTable tbody tr').length > 10,
  'nor one cell of the Taken table', `${document.querySelectorAll('#takenTable td.beats').length}`);
// --- nor the Avg column ------------------------------------------------------
ok(rows.every((tr) => !tr.querySelectorAll('td')[avgCol].classList.contains('beats')),
  'Avg is never boxed: the box is per week');

// --- the key and the note say what the box means ----------------------------
const flat = (el) => el.textContent.replace(/\s+/g, ' ').trim();
ok(/you would start him/.test(flat(legend)) && !/beats your worst man/.test(flat(legend)),
  'the key reads "you would start him"', flat(legend));
ok(legend.querySelectorAll('[data-compare]').length === 2 &&
  [...legend.querySelectorAll('[data-compare]')].every((k) => !k.hasAttribute('hidden')),
  'and it is one of the two keys that need a team, both shown');
const noteEl = document.getElementById('waiverNote');
const note = noteEl.textContent;
const sentence = 'A week boxed in green is one where he would make your best lineup.';
ok(note.includes(sentence), 'the note says it in one sentence', note.slice(0, 200));
ok(sentence.split(/\s+/).length < 15, 'of under fifteen words', `${sentence.split(/\s+/).length}`);
ok(noteEl.querySelector('.beats-key') !== null, 'with the box shown in the treatment it describes');
ok(noteEl.querySelector('.hot-key') === null && !/worth starting/i.test(note) &&
  !/QB over 17/.test(note) && !/out-projects your own worst man/.test(note) && !/two greens/.test(note),
  'and nothing of the green number or the old meaning is left in it',
  (note.match(/.{0,40}(worth starting|over 17|worst man at his|two greens).{0,40}/i) || [''])[0]);

// --- FLEX changes WHICH ROWS you see, and nothing about the box -------------
//
// FLEX is a filter across RB, WR and TE. The box reads your whole roster and
// the league's slots, never the button, so the cues are recorded per player per
// week BEFORE the button is pressed and compared cell for cell after.
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
ok(movedCue === 0, 'NOT ONE CELL CHANGES ITS BOX BECAUSE FLEX IS PRESSED', firstMoved);
ok([...cuesAfter.values()].some((r) => r.cues.some((cue) => cue.slice(1, 2) === 'B')),
  'and there are boxes under FLEX to have been preserved');
ok([...cuesAfter.values()].every((r) => r.cues.every((cue) => !cue.startsWith('H'))),
  'and still no green number');

const flexNote = document.getElementById('waiverNote').textContent;
ok(!/FLEX over \d/.test(flexNote) && !/over 12/.test(flexNote), 'the note states no bar, FLEX or otherwise',
  flexNote.slice(0, 200));
ok(/FLEX<\/strong> is not a position but a filter across three/
  .test(document.getElementById('waiverNote').innerHTML),
  'the note says what FLEX is', flexNote.slice(0, 200));
ok(/a week boxed in green under WR is boxed under FLEX/.test(flexNote),
  'and that the filter does not move a box', flexNote.slice(0, 200));

ok(errors.length === 0, 'no console errors', errors.slice(0, 2).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
