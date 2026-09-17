// The Stats page's panels are in the order Tim asked for, top to bottom, and a
// later edit cannot quietly reshuffle them.
//
//   node stats-order.mjs
//
// It boots the REAL stats.html with its real modules on demo data — no network —
// and reads every top-level panel's heading in DOCUMENT order. Reading the
// rendered page rather than the file matters: a panel moved by script, or a
// heading rewritten, both show up here.
//
// Tim's ask, 2026-09-17: Season at a glance, then Standings & season totals,
// then Week by week, then everything else in the order it was already in. The
// Data source panel stays at the top with the connection bar.
//
// FALSIFIABLE: swap any two lines of EXPECTED and this fails.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO } from './repo.mjs';

// Headings as textContent renders them: entities decoded, em dashes intact.
const EXPECTED = [
  'Data source',
  'Season at a glance',
  'Standings & season totals',
  'Week by week',
  'Schedule luck — average projected opponent',
  'Early season',
  'Weekly scores',
  'Weekly luck — actual minus projected',
  'Cumulative luck',
  'Score distribution',
  'Projection accuracy',
  'Score spread by team',
];

// The three Tim named, and where each has to land. Spelled out separately from
// the list above so the ask itself is checked, not just a list that happens to
// start with it.
const TIMS_TOP = [
  'Season at a glance',
  'Standings & season totals',
  'Week by week',
];

async function boot() {
  const html = readFileSync(path.join(REPO, 'stats.html'), 'utf8');
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

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };

  const fetchCalls = [];
  Object.assign(globalThis, {
    window, document, localStorage,
    fetch: async (url) => { fetchCalls.push(String(url)); throw new Error('unexpected network call'); },
    HTMLElement: window.HTMLElement, CustomEvent: window.CustomEvent,
    Event: window.Event, Node: window.Node,
    getComputedStyle: () => ({ getPropertyValue: () => '', position: 'static' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;
  window.ResizeObserver = globalThis.ResizeObserver;
  if (!window.location) window.location = { origin: 'null', href: 'about:blank' };
  if (!window.postMessage) window.postMessage = () => {};

  const errors = [];
  const orig = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };

  await import(pathToFileURL(path.join(REPO, 'js/stats-page.js')).href);
  await import(pathToFileURL(path.join(REPO, 'js/connection.js')).href);
  await new Promise((r) => setTimeout(r, 300));
  console.error = orig;

  return { document, errors, fetchCalls };
}

/** Every panel that is not inside another one, in document order. */
function panelHeadings(document) {
  const panels = [...document.querySelectorAll('section, .panel')].filter(
    (p, i, all) => !all.some((q) => q !== p && q.contains(p))
  );
  return panels.map((p) => {
    const h = p.querySelector('h2, h3');
    return {
      id: p.getAttribute('id') || '',
      title: h ? h.textContent.replace(/\s+/g, ' ').trim() : '(untitled)',
    };
  });
}

const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };
let checks = 0;
const assert = (cond, msg) => { checks++; ok(cond, msg); };

const { document, errors, fetchCalls } = await boot();
if (errors.length) problems.push(`console.error: ${errors[0]}`);
if (fetchCalls.length) problems.push(`hit the network: ${fetchCalls[0]}`);

const found = panelHeadings(document);
const titles = found.map((p) => p.title);

if (process.env.FF_DUMP) {
  process.stderr.write('\npanels in document order:\n');
  found.forEach((p, i) => process.stderr.write(`  ${i + 1}. ${p.title}${p.id ? ` (#${p.id})` : ''}\n`));
}

// --- the whole order, position by position --------------------------------
assert(titles.length === EXPECTED.length,
  `${titles.length} panels, expected ${EXPECTED.length}: ${titles.join(' | ')}`);
for (let i = 0; i < Math.max(titles.length, EXPECTED.length); i++) {
  assert(titles[i] === EXPECTED[i],
    `panel ${i + 1} is "${titles[i] ?? '(missing)'}", expected "${EXPECTED[i] ?? '(none)'}"`);
}

// --- Tim's three, immediately after the Data source controls ---------------
// Stated on its own so the ask survives even if the tail of the page changes.
const dataSourceAt = titles.indexOf('Data source');
assert(dataSourceAt === 0, `Data source is panel ${dataSourceAt + 1}, it stays at the top`);
TIMS_TOP.forEach((want, i) => {
  assert(titles[dataSourceAt + 1 + i] === want,
    `after Data source, panel ${i + 1} should be "${want}" but is "${titles[dataSourceAt + 1 + i]}"`);
});

// --- and the ids the JS and the other suites address are still on them -----
const idFor = Object.fromEntries(found.map((p) => [p.title, p.id]));
for (const [title, id] of [
  ['Week by week', 'panelWeekGrid'],
  ['Schedule luck — average projected opponent', 'panelOppProj'],
  ['Early season', 'panelEarly'],
  ['Weekly scores', 'panelWeekly'],
  ['Weekly luck — actual minus projected', 'panelLuck'],
  ['Cumulative luck', 'panelCumLuck'],
  ['Score spread by team', 'panelBox'],
]) {
  assert(idFor[title] === id, `"${title}" carries id "${idFor[title]}", expected "${id}"`);
}

// The panels that matter most must have rendered something, so a heading in the
// right place cannot stand in for a panel that no longer works.
const $ = (id) => document.getElementById(id);
assert($('glance').children.length > 0, 'Season at a glance rendered no tiles');
assert($('mainTable').querySelectorAll('tbody tr').length === 10,
  'Standings rendered the wrong number of rows');
assert($('weeklyTable').querySelectorAll('tbody tr').length === 10,
  'Week by week rendered the wrong number of rows');

if (problems.length) {
  console.log('FAIL stats panel order');
  for (const p of problems) console.log(`  - ${p}`);
  console.log(`\n${problems.length} check(s) failed`);
  process.exit(1);
}
console.log('Panel order is Tim’s: ' + titles.join(' → '));
console.log(`\nAll ${checks} assertions passed`);
process.exit(0);
