// js/sortable.js — click-to-sort, on its own (AUDIT §3.6).
//
// This module is load-bearing on every scaled column on the site and, until
// 2026-09-22, was imported by no test at all: it was only ever exercised as a
// side effect of a page suite. So "a scale added to a new page" was unguarded
// by construction, and that is exactly how the live defect happened — the text
// fallback strips `, + $ %` and spaces but NOT the red/green scale's `▲`, so
// every cell at the end of the scale sorted as the string "22.1 ▲".
//
// The glyph list is READ OUT OF js/heat.js rather than typed here, so a third
// glyph added there is covered by this suite on the day it is added.
//
// Run:  node sortable-check.mjs

import { parseHTML } from 'linkedom';
import * as heat from '../js/heat.js';
import { enableSort, resort, sortBy, enableSortAll } from '../js/sortable.js';

let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const eq = (a, b, msg) => {
  if (Object.is(a, b)) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const deep = (a, b, msg) => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x === y) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${x}, want ${y}`); }
};

// ---------------------------------------------------------------- the harness
// One window for the whole suite; sortable.js only needs `document` for
// createDocumentFragment, so a single global document is enough.
const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.window = window;
globalThis.document = document;
globalThis.Event = window.Event;

/** Build a table: header labels (a `!` prefix means NOT sortable) and rows of cells. */
function table(headers, rows, { width = null } = {}) {
  const th = headers.map((h) => (h.startsWith('!')
    ? `<th>${h.slice(1)}</th>`
    : `<th data-sort>${h}</th>`)).join('');
  const body = rows.map((cells) => `<tr>${cells.map((c) => {
    if (c === null) return '';
    if (typeof c === 'object') return `<td data-v="${c.v}">${c.text}</td>`;
    return `<td>${c}</td>`;
  }).join('')}</tr>`).join('');
  const html = `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
  const host = document.createElement('div');
  host.innerHTML = html;
  const t = host.querySelector('table');
  if (width !== null) t.__w = width;
  return t;
}

/** The text of column `col` down every row, tbody by tbody. */
function column(t, col = 0) {
  const out = [];
  for (const tb of Array.from(t.children).filter((c) => c.tagName === 'TBODY')) {
    for (const tr of Array.from(tb.children).filter((c) => c.tagName === 'TR')) {
      const cell = tr.children[col];
      out.push(cell ? (cell.textContent || '').trim() : '');
    }
  }
  return out;
}

const headerRow = (t) => {
  const head = Array.from(t.children).find((c) => c.tagName === 'THEAD');
  const rows = Array.from((head || t).children).filter((c) => c.tagName === 'TR');
  return rows[rows.length - 1];
};

/** Click a header the way a reader does: a bubbling click on the <th>. */
function click(t, i) {
  const th = headerRow(t).children[i];
  th.dispatchEvent(new window.Event('click', { bubbles: true }));
}

function key(t, i, k) {
  const th = headerRow(t).children[i];
  const ev = new window.Event('keydown', { bubbles: true });
  ev.key = k;
  ev.preventDefault = () => {};
  th.dispatchEvent(ev);
}

// The harness itself must work, or every assertion below is about nothing.
{
  const t = table(['N'], [['2'], ['1']]);
  enableSort(t);
  click(t, 0);
  deep(column(t), ['2', '1'], 'harness: a delegated click reaches the header (descending first)');
}

// ------------------------------------------------- numbers inside formatting
{
  const t = table(['V', '!X'], [
    ['1,467'], ['+12.3'], ['68%'], ['$5'], ['−3.5'],
  ]);
  enableSort(t, { defaultIndex: 0, defaultAsc: true });
  deep(column(t), ['−3.5', '$5', '+12.3', '68%', '1,467'],
    'thousands separator, sign, percent, dollar and the unicode minus all read as numbers');

  sortBy(t, 0, false);
  deep(column(t), ['1,467', '68%', '+12.3', '$5', '−3.5'], 'and reverse');
}

// -------------------------------------------------- missing data, both ways
{
  const rows = [['5'], ['—'], ['1'], ['-'], ['N/A'], ['']];
  for (const asc of [true, false]) {
    const t = table(['V'], rows);
    enableSort(t, { defaultIndex: 0, defaultAsc: asc });
    const got = column(t);
    const numbers = got.slice(0, 2);
    deep(numbers, asc ? ['1', '5'] : ['5', '1'], `numbers lead (asc=${asc})`);
    ok(got.slice(2).every((v) => !/\d/.test(v)),
      `an empty cell is missing data, not the smallest value (asc=${asc})`, got.join('|'));
  }
}

// --------------------------------------------------------- data-v beats text
{
  const t = table(['Record'], [
    [{ v: '8.0512', text: '8-5' }],
    [{ v: '9.0412', text: '9-4' }],
    [{ v: '2.1112', text: '2-11' }],
  ]);
  enableSort(t, { defaultIndex: 0 });
  deep(column(t), ['9-4', '8-5', '2-11'], 'data-v is what a formatted record sorts on');
}
{
  // A non-numeric data-v is a deliberate text key, lowercased.
  const t = table(['Name'], [
    [{ v: 'zeta', text: 'Zeta' }],
    [{ v: 'Alpha', text: 'ALPHA' }],
  ]);
  enableSort(t, { defaultIndex: 0, defaultAsc: true });
  deep(column(t), ['ALPHA', 'Zeta'], 'a non-numeric data-v sorts as lowercased text');
}

// ================================================================== THE TRAP
// Every glyph js/heat.js can put in a cell, discovered from the module rather
// than typed out here.
const GLYPHS = Object.entries(heat)
  .filter(([k, v]) => k.startsWith('HEAT_') && typeof v === 'string' && v.length &&
    !/^[\w\s.+-]+$/.test(v))
  .map(([, v]) => v);

ok(GLYPHS.length >= 2, 'heat.js exports at least two end-of-scale glyphs', GLYPHS.join(''));
ok(GLYPHS.includes('▲'), 'the up glyph is in the discovered set');
ok(GLYPHS.includes('▼'), 'the down glyph is in the discovered set');

// And they really do reach the cell's TEXT: heatMarkHtml is what a cell
// concatenates, so if this stopped being true the trap below would be moot.
for (const g of GLYPHS) {
  const dir = g === heat.HEAT_UP ? 1 : -1;
  const html = heat.heatMarkHtml({ mark: g, dir, step: heat.HEAT_MARK_STEP });
  ok(html.includes(g), `heatMarkHtml puts ${g} into the cell markup`, html);
}

for (const g of GLYPHS) {
  // THE CONTRACT the site relies on: a scaled cell emits data-v, so the glyph
  // in its text cannot reach the comparator. This is the assertion that would
  // have caught the live defect on the Stats standings.
  const good = table(['Pts'], [
    [{ v: '22.1', text: `22.1 ${g}` }],
    [{ v: '9.4', text: '9.4' }],
    [{ v: '100.2', text: `100.2 ${g}` }],
  ]);
  enableSort(good, { defaultIndex: 0 });
  deep(column(good), [`100.2 ${g}`, `22.1 ${g}`, '9.4'],
    `with data-v, a ${g} cell still sorts numerically`);

  // THE TRAP, pinned: without data-v the fallback does NOT strip the glyph, so
  // the whole column degrades to a string sort and 9.4 outranks 100.2.
  // If sortable.js is ever taught to strip these, this assertion is what tells
  // you — update it then, do not delete it.
  const bad = table(['Pts'], [
    [`22.1 ${g}`], ['9.4'], [`100.2 ${g}`],
  ]);
  enableSort(bad, { defaultIndex: 0, defaultAsc: true });
  deep(column(bad), ['100.2 ' + g, '22.1 ' + g, '9.4'],
    `without data-v a ${g} cell sorts as TEXT (this is why every scaled cell must emit data-v)`);
}

// A bare number in the same column is still a number — the trap is per cell,
// so a half-scaled column sorts half numerically, which is worse than either.
{
  const g = heat.HEAT_UP;
  const t = table(['Pts'], [[`3.0 ${g}`], ['20.0'], ['100.0']]);
  enableSort(t, { defaultIndex: 0, defaultAsc: true });
  const got = column(t);
  ok(got[0] === '20.0' && got[1] === '100.0' && got[2] === `3.0 ${g}`,
    'a mixed column sorts numbers among themselves and strands the glyphed cell', got.join('|'));
}

// ------------------------------------------------------------- stable sorting
{
  const t = table(['V', '!Who'], [
    ['5', 'a'], ['5', 'b'], ['5', 'c'], ['1', 'd'],
  ]);
  enableSort(t, { defaultIndex: 0 });
  deep(column(t, 1), ['a', 'b', 'c', 'd'], 'equal keys keep the order they arrived in');
}

// ---------------------------------------------------------------- directions
{
  const t = table(['A', 'B'], [['1', '9'], ['3', '7'], ['2', '8']]);
  enableSort(t);
  deep(column(t), ['1', '3', '2'], 'nothing is sorted until a header is clicked');

  click(t, 0);
  deep(column(t), ['3', '2', '1'], 'a fresh column starts descending — the top is the interesting end');
  click(t, 0);
  deep(column(t), ['1', '2', '3'], 'the same header again flips direction');
  click(t, 1);
  deep(column(t, 1), ['9', '8', '7'], 'a different column starts descending again');

  const th0 = headerRow(t).children[0];
  const th1 = headerRow(t).children[1];
  eq(th1.getAttribute('aria-sort'), 'descending', 'the active header says so');
  eq(th0.getAttribute('aria-sort'), 'none', 'and the one before it stops saying so');
  ok(th1.classList.contains('sorted'), 'the active header is marked sorted');
  ok(!th1.classList.contains('asc'), 'and not ascending');
}
{
  const t = table(['A'], [['1'], ['3'], ['2']]);
  enableSort(t, { firstClickAsc: true });
  click(t, 0);
  deep(column(t), ['1', '2', '3'], 'firstClickAsc flips which way a fresh column opens');
}

// ------------------------------------------------- headers that are not sortable
{
  const t = table(['!Name', 'V'], [['a', '1'], ['b', '3']]);
  enableSort(t);
  const plain = headerRow(t).children[0];
  click(t, 0);
  ok(!plain.classList.contains('sortable'), 'a header without data-sort gets no affordance');
  eq(plain.getAttribute('aria-sort'), null, 'and no aria-sort');
  deep(column(t), ['a', 'b'], 'and clicking it sorts nothing');
  ok(headerRow(t).children[1].classList.contains('sortable'), 'its neighbour is still sortable');
}

// ------------------------------------------------------- two header rows
// The site has grouped headers; the LAST row is the one with the real labels.
{
  const host = document.createElement('div');
  host.innerHTML = '<table><thead>' +
    '<tr><th colspan="2">Group</th></tr>' +
    '<tr><th data-sort>A</th><th data-sort>B</th></tr>' +
    '</thead><tbody>' +
    '<tr><td>1</td><td>9</td></tr><tr><td>3</td><td>7</td></tr>' +
    '</tbody></table>';
  const t = host.querySelector('table');
  enableSort(t);
  t.querySelectorAll('thead tr')[1].children[0]
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  deep(column(t), ['3', '1'], 'the label row is the last header row, not the group row');
}

// ------------------------------------------- every tbody, independently
// The roster detail is starters / totals / bench, and the grouping must survive
// a click: each tbody sorts on its own and a tbody of ONE row is left alone.
{
  const host = document.createElement('div');
  host.innerHTML = '<table><thead><tr><th data-sort>V</th></tr></thead>' +
    '<tbody><tr><td>1</td></tr><tr><td>5</td></tr><tr><td>3</td></tr></tbody>' +
    '<tbody><tr><td>999</td></tr></tbody>' +
    '<tbody><tr><td>2</td></tr><tr><td>8</td></tr></tbody></table>';
  const t = host.querySelector('table');
  enableSort(t, { defaultIndex: 0 });
  deep(column(t), ['5', '3', '1', '999', '8', '2'],
    'each tbody sorts within itself and the one-row totals band stays put');
}

// ------------------------------------------------------ resort after a rebuild
{
  const t = table(['V'], [['1'], ['5'], ['3']]);
  enableSort(t, { defaultIndex: 0, defaultAsc: true });
  deep(column(t), ['1', '3', '5'], 'the default sort is applied on enable');

  const tb = Array.from(t.children).find((c) => c.tagName === 'TBODY');
  tb.innerHTML = '<tr><td>7</td></tr><tr><td>2</td></tr><tr><td>4</td></tr>';
  deep(column(t), ['7', '2', '4'], 'a re-render puts the page\'s own order back');
  resort(t);
  deep(column(t), ['2', '4', '7'], 'resort restores the reader\'s column AND direction');

  // ...including a direction the reader chose by clicking.
  click(t, 0);
  tb.innerHTML = '<tr><td>1</td></tr><tr><td>9</td></tr>';
  resort(t);
  deep(column(t), ['9', '1'], 'and the direction he chose, not the default');
}

// resort/sortBy on a table nobody enabled must do nothing rather than throw.
{
  const t = table(['V'], [['1'], ['5']]);
  resort(t);
  sortBy(t, 0, true);
  deep(column(t), ['1', '5'], 'resort and sortBy are no-ops on a table that was never enabled');
}

// ---------------------------------------------------------------- sortBy
// The analysis grid changes SHAPE, so "the Total column" is a different index
// on its two measures.
{
  const t = table(['Team', 'W1', 'Total'], [
    ['a', '5', '30'], ['b', '9', '10'], ['c', '1', '20'],
  ]);
  enableSort(t, { defaultIndex: 1 });
  deep(column(t, 0), ['b', 'a', 'c'], 'sorted by week 1');
  sortBy(t, 2);
  deep(column(t, 0), ['a', 'c', 'b'], 'sortBy re-aims it at the total column');
  eq(headerRow(t).children[2].getAttribute('aria-sort'), 'descending',
    'and the header moves with it');
  sortBy(t, 2, true);
  deep(column(t, 0), ['b', 'c', 'a'], 'sortBy takes a direction too');
}

// ------------------------------------------------- enabling twice, and keyboard
{
  const t = table(['V'], [['1'], ['3'], ['2']]);
  enableSort(t);
  enableSort(t, { defaultIndex: 0, defaultAsc: true });
  deep(column(t), ['1', '3', '2'], 'a second enableSort is ignored, not re-applied');
  click(t, 0);
  deep(column(t), ['3', '2', '1'], 'and one click still flips the sort exactly once');
}
{
  const t = table(['V'], [['1'], ['3'], ['2']]);
  enableSort(t);
  key(t, 0, 'Enter');
  deep(column(t), ['3', '2', '1'], 'Enter on a header sorts it');
  key(t, 0, ' ');
  deep(column(t), ['1', '2', '3'], 'Space flips it');
  key(t, 0, 'a');
  deep(column(t), ['1', '2', '3'], 'any other key is left alone');
}

// ------------------------------------------------ a short row is missing data
{
  const t = table(['A', 'B'], [['1', '9'], ['3'], ['2', '4']]);
  enableSort(t, { defaultIndex: 1, defaultAsc: true });
  deep(column(t, 0), ['2', '1', '3'], 'a row with no cell in that column sorts to the bottom');
}

// ---------------------------------------------------------------- enableSortAll
{
  const host = document.createElement('div');
  host.innerHTML =
    '<table id="on"><thead><tr><th data-sort>V</th></tr></thead>' +
    '<tbody><tr><td>1</td></tr><tr><td>3</td></tr></tbody></table>' +
    '<table id="off"><thead><tr><th>V</th></tr></thead>' +
    '<tbody><tr><td>1</td></tr><tr><td>3</td></tr></tbody></table>';
  enableSortAll(host);
  const on = host.querySelector('#on');
  const off = host.querySelector('#off');
  ok(on.querySelector('th').classList.contains('sortable'), 'enableSortAll turns on a table with data-sort');
  ok(!off.querySelector('th').classList.contains('sortable'), 'and leaves one without it alone');
  on.querySelector('th').dispatchEvent(new window.Event('click', { bubbles: true }));
  deep(column(on), ['3', '1'], 'the table it enabled really does sort');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
