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
  'Schedule luck — rest of season',
  // Tim, 2026-10-08: roster strength moved here from Home, "right next to the
  // schedule luck box", with the future proj diff box beside the pair.
  'Roster strength',
  'Future proj diff',
  'Early season',
  'Weekly scores',
  'Weekly luck — actual minus projected',
  // (Cumulative luck was a panel of its own here until 2026-10-08. It is now
  // the "Running total" view of Weekly luck: docs/charts-plan.md A2 / B1.)
  'Score distribution',
  'Projection accuracy',
  // Tim, 2026-10-04: the two scatter graphs, directly under Projection accuracy.
  'Projected vs actual — teams',
  'Projected vs actual — players',
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
  // The page is opened the way a card elsewhere on the site links to it
  // (js/links.js `statsHref(3)`): see "arriving from another page" at the foot.
  window.location = { origin: 'null', href: 'about:blank?team=3', search: '?team=3' };
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
  ['Schedule luck — rest of season', 'panelOppProj'],
  ['Roster strength', 'panelStrength'],
  ['Future proj diff', 'panelProjDiff'],
  ['Early season', 'panelEarly'],
  ['Weekly scores', 'panelWeekly'],
  ['Weekly luck — actual minus projected', 'panelLuck'],
  ['Score spread by team', 'panelBox'],
]) {
  assert(idFor[title] === id, `"${title}" carries id "${idFor[title]}", expected "${id}"`);
}

// ------------------------------------------------ the view switches (2026-10-08)
//
// docs/charts-plan.md B1, B2, B5 (Tim: "at least give the option of switching
// it to a differnt view"). Each is the page's small segmented control, the
// choice is remembered, and the chart it redraws is the SAME SIZE in every
// view — "nothing moves when switching".
{
  const $id = (id) => document.getElementById(id);
  const click = (el) => el.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }));
  const labels = (id) => [...($id(id) ? $id(id).querySelectorAll('button') : [])]
    .map((b) => b.textContent.replace(/\s+/g, ' ').trim());
  const box = (id) => { const s = $id(id).querySelector('svg'); return s ? s.getAttribute('viewBox') : null; };
  const aria = (id) => { const s = $id(id).querySelector('svg'); return s ? s.getAttribute('aria-label') || '' : ''; };
  const pick = (id, view) => click($id(id).querySelector(`button[data-view="${view}"]`));
  const pressed = (id) => [...$id(id).querySelectorAll('button')]
    .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-view')).join(',');
  const savedView = (key) => (JSON.parse(globalThis.localStorage.getItem('ff.prefs') || '{}'))[`stats.${key}`];

  assert($id('chartCumLuck') === null, 'the separate Cumulative luck chart is still on the page');
  for (const [id, panel, want] of [
    ['luckView', 'panelLuck', 'Per week|Running total'],
    ['scoresView', 'panelWeekly', 'Per week|Running total|vs league avg|Rank'],
    ['spreadView', 'panelBox', 'Boxes|Every week as a dot'],
  ]) {
    const el = $id(id);
    assert(!!el && /\bsegmented\b/.test(el.getAttribute('class')) && /\bseg-sm\b/.test(el.getAttribute('class')),
      `#${id} is not the small segmented control`);
    assert(!!el && !!el.closest(`#${panel}`), `#${id} is not inside #${panel}`);
    assert(labels(id).join('|') === want, `#${id} offers "${labels(id).join('|')}", expected "${want}"`);
    assert(!!el && !!(el.getAttribute('aria-label') || '').trim(), `#${id} has no accessible name`);
    assert(!!el && pressed(id) === el.querySelector('button').getAttribute('data-view'),
      `#${id} does not start on its first view (pressed: ${pressed(id)})`);
  }

  // Weekly luck: Running total is the old Cumulative luck chart, in the same box.
  const luck0 = box('chartLuck');
  assert(/Actual − projected/.test(aria('chartLuck')), `Weekly luck starts as "${aria('chartLuck')}"`);
  pick('luckView', 'total');
  assert(/Cumulative luck/.test(aria('chartLuck')), `Running total drew "${aria('chartLuck')}", not the cumulative luck`);
  assert(box('chartLuck') === luck0, `Weekly luck changed size on switching: ${luck0} → ${box('chartLuck')}`);
  assert(pressed('luckView') === 'total', `the luck switch shows "${pressed('luckView')}" pressed`);
  assert(savedView('luckView') === 'total', `the luck view was not remembered: ${savedView('luckView')}`);
  // The sentence under the title follows the view, and only one is ever shown.
  const ledes = [...$id('panelLuck').querySelectorAll('.lede')];
  const shownLede = ledes.filter((p) => p.getAttribute('aria-hidden') !== 'true');
  assert(ledes.length === 2 && shownLede.length === 1 && /season so far/.test(shownLede[0].textContent),
    `Running total shows ${shownLede.length} of ${ledes.length} sentences: "${shownLede.map((p) => p.textContent).join(' / ')}"`);
  pick('luckView', 'week');
  assert(/Actual − projected/.test(aria('chartLuck')) && savedView('luckView') == null,
    'Per week does not put the weekly chart back (or stayed saved)');

  // Weekly scores: four views, one box.
  const scores0 = box('chartWeekly');
  const lineEnds = () => [...$id('chartWeekly').querySelectorAll('path')].map((p) => {
    const pts = p.getAttribute('d').slice(1).split(/[ML]/).map((s) => s.split(',').map(Number));
    return pts[pts.length - 1][1];
  });
  for (const [view, word] of [['total', 'Total points'], ['vsavg', 'league average'], ['rank', 'Rank']]) {
    pick('scoresView', view);
    assert(aria('chartWeekly').includes(word), `Weekly scores "${view}" drew "${aria('chartWeekly')}"`);
    assert(box('chartWeekly') === scores0, `Weekly scores changed size in "${view}": ${scores0} → ${box('chartWeekly')}`);
    assert($id('chartWeekly').querySelectorAll('path').length === 10, `Weekly scores "${view}" lost a team's line`);
  }
  // Rank: whole places 1..10, and ten different final places (a rank, not a score).
  const ends = lineEnds();
  assert(new Set(ends.map((y) => y.toFixed(1))).size === 10, `Rank: the ten lines end on ${new Set(ends.map((y) => y.toFixed(1))).size} different places`);
  const rankTicks = [...$id('chartWeekly').querySelectorAll('text')]
    .filter((t) => t.getAttribute('text-anchor') === 'end' && t.getAttribute('x') === '46').map((t) => t.textContent);
  assert(rankTicks[0] === '1' && rankTicks[rankTicks.length - 1] === '10', `Rank axis runs ${rankTicks.join(',')}`);
  const tickYs = [...$id('chartWeekly').querySelectorAll('text')]
    .filter((t) => t.getAttribute('text-anchor') === 'end' && t.getAttribute('x') === '46').map((t) => Number(t.getAttribute('y')));
  assert(tickYs[0] < tickYs[tickYs.length - 1], 'Rank: 1st is not at the top');
  pick('scoresView', 'week');
  assert(/Points by/.test(aria('chartWeekly')), 'Per week does not put the scores back');

  // Score spread: a team's row is its own colour (the line charts'), and the dots view.
  const legend = new Map([...$id('chartWeekly').querySelectorAll('.ff-legend-item')]
    .map((g) => [g.getAttribute('data-name'), g.querySelector('line').getAttribute('stroke')]));
  const boxRows = [...$id('chartBox').querySelectorAll('svg > g')].map((g) => ({
    name: g.querySelector('title').textContent.split(':')[0],
    fill: g.querySelector('rect').getAttribute('fill'),
  }));
  assert(boxRows.length === 10 && boxRows.every((r) => legend.get(r.name) === r.fill),
    `a box is not its team's line colour: ${boxRows.filter((r) => legend.get(r.name) !== r.fill).map((r) => r.name).join(', ')}`);
  const spread0 = box('chartBox');
  pick('spreadView', 'dots');
  const weekDots = $id('chartBox').querySelectorAll('circle.ff-week-dot').length;
  const played = [...$id('weeklyTable').querySelectorAll('tbody tr')].length *
    ($id('weeklyHead').children.length - 2);
  assert(weekDots === played, `Every week as a dot drew ${weekDots} dots for ${played} team-weeks`);
  assert(box('chartBox') === spread0, `Score spread changed size on switching: ${spread0} → ${box('chartBox')}`);
  assert(savedView('spreadView') === 'dots', 'the spread view was not remembered');
  pick('spreadView', 'boxes');
  assert($id('chartBox').querySelectorAll('circle.ff-week-dot').length === 0, 'Boxes does not put the boxes back');
}

// The panels that matter most must have rendered something, so a heading in the
// right place cannot stand in for a panel that no longer works.
const $ = (id) => document.getElementById(id);
assert($('glance').children.length > 0, 'Season at a glance rendered no tiles');
assert($('mainTable').querySelectorAll('tbody tr').length === 10,
  'Standings rendered the wrong number of rows');
assert($('weeklyTable').querySelectorAll('tbody tr').length === 10,
  'Week by week rendered the wrong number of rows');

// ---------------------------------------------- the shared red/green scale
//
// This suite boots the whole real page on a complete demo season, which makes
// it the cheapest place to hold the standings table's colouring to its own
// rules. It checks three separate things, and they fail for three different
// mistakes:
//
//   1. the two columns added on 2026-09-19 (F−A and Luck/wk) really are
//      coloured, and point the right way;
//   2. the columns that are deliberately refused really are refused — a later
//      pass that "finished the job" by colouring Spread or Skill fails here;
//   3. Opp Avg stays INVERTED. That is pre-existing behaviour and it is the
//      defect that retired this page's old local ramp (it painted the hardest
//      schedule the greenest), so it gets an assertion of its own rather than
//      being left to a comment.

const HEAT_CLS = /\bheat-(up|dn)-([1-4])\b/;
const heatSide = (el) => {
  const m = HEAT_CLS.exec((el && el.getAttribute('class')) || '');
  return m ? m[1] : null;
};
const mainRows = [...$('mainTable').querySelectorAll('tbody tr')].map((tr) => [...tr.children]);
const column = (i) => mainRows.map((c) => c[i]);

/**
 * Every green cell above its column's mean and every red cell below it, or the
 * other way round for an inverted column. Refuses to pass on a column that drew
 * no colour at all, so a page that stopped colouring cannot pass by being
 * uniformly blank.
 */
function direction(cells, goodHigh) {
  const vals = cells.map((c) => Number(c.getAttribute('data-v')));
  const usable = vals.map((v, i) => [v, cells[i]]).filter(([v]) => Number.isFinite(v));
  if (usable.length < 2) return 'fewer than two readable values';
  const mean = usable.reduce((a, [v]) => a + v, 0) / usable.length;
  let ups = 0;
  let downs = 0;
  for (const [v, cell] of usable) {
    const side = heatSide(cell);
    if (!side) continue;
    if (side === 'up') ups++; else downs++;
    if ((side === 'up') !== (goodHigh ? v > mean : v < mean)) {
      return `${v} (mean ${mean.toFixed(2)}) painted ${side} with goodHigh=${goodHigh}`;
    }
  }
  if (!ups) return 'nothing green';
  if (!downs) return 'nothing red';
  return '';
}

// Column indices, from the second header row in stats.html.
const C = { record: 1, avg: 2, total: 4, oppAvg: 5, fa: 6, spread: 7, luckWk: 9, ptw: 10, skill: 13 };

for (const [label, idx, goodHigh] of [
  ['F−A', C.fa, true],
  ['Luck/wk', C.luckWk, true],
  ['Avg', C.avg, true],
  ['Opp Avg', C.oppAvg, false],   // INVERTED: a low opponent average is an easy run
]) {
  const why = direction(column(idx), goodHigh);
  assert(!why, `standings ${label} points the wrong way — ${why}`);
}

for (const [label, idx] of [
  ['Total', C.total], ['Spread', C.spread], ['PTW', C.ptw], ['Skill', C.skill],
  ['W−L', C.record],
]) {
  assert(!column(idx).some((c) => heatSide(c)),
    `standings ${label} was coloured, and it is on the refused list`);
}

// Every coloured cell on the page must be sortable as a NUMBER. sortable.js
// falls back to the cell's text when there is no data-v and strips only
// ", + $ %" and spaces — so a cell ending in ▲ would sort as a string.
const unsortable = [...document.querySelectorAll('td[class*="heat-"]')]
  .filter((td) => td.getAttribute('data-v') === null);
assert(unsortable.length === 0,
  `${unsortable.length} coloured cell(s) carry no data-v, so their column sorts as text`);

// THE KEY IS SPLIT, AND THE SPLIT IS WHAT IS ASSERTED — not merely that each
// fact exists somewhere. The visible line carries only what changes what a
// number MEANS: which way green points, that Opp Avg and Opp proj are turned
// over, and that the ends are marked with a glyph and heavier type. The
// thresholds in points, and every per-column detail, live behind "What the
// columns mean". Checking only the note would pass while `describeHeat` sat
// under the table as well, which is the prose creep `node
// tests/text-audit.mjs stats.html` exists to measure.
const status = ($('mainTableStatus').textContent || '').replace(/\s+/g, ' ');
assert(/Green is good for that team, red is bad/.test(status),
  `the visible key does not say which way green points: "${status.slice(0, 160)}"`);
assert(/Opp Avg/.test(status) && /Opp proj/.test(status) && /turned over/.test(status),
  `the visible key does not name the two INVERTED columns: "${status.slice(0, 160)}"`);
assert(/▲▼/.test(status),
  `the visible key does not name the glyph at the ends: "${status.slice(0, 160)}"`);
assert(!/standard deviation/.test(status) && !/pts or better/.test(status),
  `the thresholds are back in the VISIBLE key: "${status.slice(0, 200)}"`);
const noteText = ($('mainTableNote').textContent || '').replace(/\s+/g, ' ');
assert(/Colour compares each number/.test(noteText) && /Spread/.test(noteText),
  'the standings note does not print the new thresholds or say what is refused');
// The two columns the sweep added: named in the tucked note, with their own
// thresholds, since the visible line no longer confirms they follow the
// default direction.
assert(/F−A:/.test(noteText) && /Luck\/wk:/.test(noteText),
  'the tucked note does not print the F−A and Luck/wk thresholds');

// ------------------------------------------- week by week: the whole luck
//
// Tim, 2026-10-05: the Luck button "shows luck as just act-proj, when this is
// only a part … Opponent scoring, close game, and act-proj all go into this
// weekly number". So Luck is the week's share of the Luck score, a hover names
// the three parts, and each part has a button of its own. Worked out here from
// the demo league itself, not read back off the page.
{
  const { generateDemoLeague } = await import(pathToFileURL(path.join(REPO, 'js/demo.js')).href);
  const { computeLeagueStats } = await import(pathToFileURL(path.join(REPO, 'js/stats.js')).href);
  const st = computeLeagueStats(generateDemoLeague());
  const all = st.teams.flatMap((t) => t.weekly.map((r) => r.actual));
  const lg = all.reduce((a, b) => a + b, 0) / all.length;
  const num = (s) => Number(String(s).replace(/[▲▼\s]/g, '').replace('−', '-').replace('+', ''));
  const whole = (v) => Number(v.toFixed(0)) + 0;
  const press = (metric) => {
    const btn = document.querySelector(`#weeklyMetric button[data-metric="${metric}"]`);
    if (!btn) return null;
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    return new Map([...$('weeklyTable').querySelectorAll('tbody tr')].map((tr) =>
      [tr.children[0].textContent.trim(), [...tr.children].slice(1)]));
  };
  const PART = {
    luck: (r) => (lg - r.oppActual) + (r.actual - r.projected) + (r.gameLuck ?? 0),
    luckProj: (r) => r.actual - r.projected,
    luckOpp: (r) => lg - r.oppActual,
    luckClose: (r) => r.gameLuck,
  };
  const labels = [...document.querySelectorAll('#weeklyMetric button')].map((b) => b.textContent.trim());
  assert(labels.join('|') === 'Actual|Projected|Luck|Act−Proj|Opp scoring|Close game|Margin',
    `week by week offers: ${labels.join('|')}`);
  for (const [metric, f] of Object.entries(PART)) {
    const grid = press(metric);
    assert(grid, `no "${metric}" button on the week-by-week grid`);
    if (!grid) continue;
    let wrong = '';
    for (const t of st.teams) {
      const cells = grid.get(t.name) || [];
      t.weekly.forEach((r, i) => {
        const want = f(r);
        if (want === null) return;
        if (num(cells[i]?.textContent) !== whole(want) && !wrong) {
          wrong = `${t.name} wk ${r.week}: "${cells[i]?.textContent}" for ${want.toFixed(2)}`;
        }
      });
    }
    assert(!wrong, `${metric} grid is not the worked figure — ${wrong}`);
  }
  // The Luck average is the Luck score, and the hover names the three parts.
  const luck = press('luck');
  const t0 = st.teams[0];
  const row0 = luck.get(t0.name);
  assert(num(row0[row0.length - 1].textContent) === whole(t0.exact.luckScore),
    `Luck Avg "${row0[row0.length - 1].textContent}" is not the Luck score ${t0.exact.luckScore.toFixed(2)}`);

  // THE SINGLE-WEEK LIMIT ON THE GRID (Tim, 2026-10-06: "a single unlucky
  // event … shouldn't be able to affect your entire luck ranking", "a limit of
  // +- 50"). A week past ±50 keeps its REAL number in its cell (the sweep
  // above read every cell), is marked, and says what it counts as; the Avg is
  // of what the weeks COUNT, so it is still the Luck score — for every team,
  // and the Luck score is the mean of the weeks held within ±50, worked here
  // from the scores and not read off a field the code under test filled in.
  const LIMIT = 50;
  const held = (v) => Math.min(Math.max(v, -LIMIT), LIMIT);
  let over = 0;
  let moved = 0;
  for (const t of st.teams) {
    const cells = luck.get(t.name);
    const raw = t.weekly.map(PART.luck);
    const want = raw.reduce((a, v) => a + held(v), 0) / raw.length;
    if (Math.abs(want - raw.reduce((a, v) => a + v, 0) / raw.length) > 0.05) moved++;
    assert(Math.abs(t.exact.luckScore - want) < 1e-9,
      `${t.name}: Luck score ${t.exact.luckScore.toFixed(3)}, its weeks held within ±50 average ${want.toFixed(3)}`);
    assert(num(cells[cells.length - 1].textContent) === whole(want),
      `${t.name}: Luck Avg "${cells[cells.length - 1].textContent}" is not the Luck score ${want.toFixed(2)}`);
    raw.forEach((v, i) => {
      const td = cells[i];
      // By the number the cell prints: +50.3 reads "+50" and is left alone.
      const isOver = Math.abs(whole(v)) > LIMIT;
      if (isOver) over++;
      const says = (td.getAttribute('title') || '').match(/Counts as ([+−]\d+) toward the season/);
      assert(td.classList.contains('capped') === isOver,
        `${t.name} wk ${t.weekly[i].week} (${v.toFixed(1)}): ${isOver ? 'not marked as past the limit' : 'marked, and it is inside the limit'}`);
      assert(isOver ? says && num(says[1]) === (v > 0 ? LIMIT : -LIMIT) : !says,
        `${t.name} wk ${t.weekly[i].week} (${v.toFixed(1)}): hover reads "${td.getAttribute('title')}"`);
    });
  }
  assert(over > 0 && moved > 0,
    `the demo season has ${over} weeks past ±50 moving ${moved} Luck scores, so the checks above prove nothing`);
  assert(/Underlined: counts as ±50 toward the season\./.test($('weeklyKey').textContent),
    `the key under the Luck grid does not say what the mark means: "${$('weeklyKey').textContent}"`);
  // The mark is Luck's alone: a part's own cell is never held back.
  for (const metric of ['luckProj', 'luckOpp', 'luckClose', 'actual']) {
    press(metric);
    assert(!$('weeklyTable').querySelector('td.capped') && !/Underlined/.test($('weeklyKey').textContent),
      `"${metric}" marks a cell as past the single-week limit`);
  }
  press('luck');
  const tip = row0[0].getAttribute('title') || '';
  assert(/Opp scoring .+ · Act−Proj .+ · Close game /.test(tip), `Luck cell hover: "${tip}"`);
  const [o, p, c] = (tip.match(/[+−]?\d+/g) || []).slice(0, 3).map(num);
  const r0 = t0.weekly[0];
  assert(o === whole(PART.luckOpp(r0)) && p === whole(PART.luckProj(r0)) && c === whole(r0.gameLuck ?? 0),
    `Luck cell hover numbers ${o}/${p}/${c} are not the three parts: "${tip}"`);
  press('actual');
}

// ------------------------------------------------ no signed zero in the grid
//
// 2026-10-06: under the four luck buttons a value that rounds to zero printed
// "-0" (red) or "+0" (green) beside a plain "0" — the League row under Close
// game read "-0 | +0 | 0 | 0 | -0". The sign is read off the ROUNDED number now
// (`signed` in js/standings-table.js), so every one of them is a plain 0.
{
  const SIGNED_ZERO = /^[-+−]0(\.0)?$/;
  const clean = (el) => el.textContent.replace(/[▲▼\s]/g, '');
  let zeros = 0;
  for (const metric of ['luck', 'luckProj', 'luckOpp', 'luckClose', 'actualDiff']) {
    document.querySelector(`#weeklyMetric button[data-metric="${metric}"]`)
      .dispatchEvent(new window.Event('click', { bubbles: true }));
    const cells = [...$('weeklyTable').querySelectorAll('td')];
    const bad = cells.filter((td) => SIGNED_ZERO.test(clean(td)));
    assert(bad.length === 0,
      `week by week under "${metric}" prints a signed zero: ${bad.slice(0, 4).map(clean).join(' ')}`);
    zeros += cells.filter((td) => clean(td) === '0').length;
    // A zero is neutral in its type as well as its sign.
    const tinted = cells.filter((td) => clean(td) === '0' && td.querySelector('span.pos, span.neg'));
    assert(tinted.length === 0, `a "0" under "${metric}" is still coloured as a gain or a loss`);
  }
  // Not vacuous: the demo season has cells that round to zero.
  assert(zeros > 0, 'the demo grid has no cell that rounds to zero, so the sweep above proves nothing');
  document.querySelector('#weeklyMetric button[data-metric="actual"]')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
}

// ------------------------------- unrounded averages, and one rule for a tie
//
// Worked on a league of the real shape: ten teams, four weeks, scores to the
// hundredth as ESPN gives them (the demo's whole-point scores cannot show a
// rounding fault), and ONE TIED GAME, which the demo season does not have.
{
  const { generateDemoLeague } = await import(pathToFileURL(path.join(REPO, 'js/demo.js')).href);
  const { computeLeagueStats, weekLuckParts, leagueAvgActualOf } =
    await import(pathToFileURL(path.join(REPO, 'js/stats.js')).href);
  const league = generateDemoLeague();
  const cents = (v, k) => Math.round((v + ((k * 37) % 100) / 100) * 100) / 100;
  league.games = league.games.filter((g) => g.week <= 4).map((g, i) => ({
    ...g,
    homeActual: cents(g.homeActual, 4 * i + 1),
    homeProjected: cents(g.homeProjected, 4 * i + 2),
    awayActual: cents(g.awayActual, 4 * i + 3),
    awayProjected: cents(g.awayProjected, 4 * i + 4),
  }));
  const tieGame = league.games.find((g) => g.week === 3);
  tieGame.awayActual = tieGame.homeActual;
  const st = computeLeagueStats(league);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const tenth = (v) => Math.round(v * 10) / 10;
  const lg = leagueAvgActualOf(st.teams);
  assert(st.teams.length === 10 && st.teams.every((t) => t.weekly.length === 4),
    'the fixture is not ten teams by four weeks');
  const tiedTeams = st.teams.filter((t) => t.weekly.some((r) => r.tied));
  assert(tiedTeams.length === 2 && tiedTeams.every((t) => t.ties === 1),
    `the fixture has ${tiedTeams.length} tied teams, expected the two of one tied game`);

  // ROUNDING ONLY AT THE END. Luck/wk and PTW are averages of the unrounded
  // weekly figures; storing those to a tenth first put them a tenth out.
  let bites = 0;
  for (const t of st.teams) {
    const lucks = t.weekly.map((r) => r.actual - r.projected);
    const want = tenth(avg(lucks));
    if (tenth(avg(lucks.map(tenth))) !== want) bites++;
    assert(t.avgLuck === want,
      `${t.name}: Luck/wk ${t.avgLuck}, by hand ${want} (${avg(lucks).toFixed(4)})`);
    const ptw = avg(t.weekly.map((r) => r.oppActual)) - avg(lucks);
    assert(Math.abs(t.exact.pointsToWin - ptw) < 1e-9,
      `${t.name}: PTW ${t.exact.pointsToWin}, by hand ${ptw}`);
    const margins = t.weekly.map((r) => r.actual - r.oppActual);
    assert(t.weekly.every((r, i) => r.actualDiff === margins[i]),
      `${t.name}: a weekly margin is stored rounded`);
  }
  assert(bites > 0, 'no team in the fixture is moved by rounding first, so the check above proves nothing');

  // ONE RULE FOR A TIE: its close-game luck is 0 and it is a game. So the
  // weekly Luck cells of EVERY team — the two with the tie included — average
  // to the Luck score the standings print, to the tenth and beyond; Close luck
  // is that same average of its own cells; and the cumulative series ends on it.
  for (const t of st.teams) {
    // Each week as it COUNTS: held within ±50 (the single-week limit, Tim
    // 2026-10-06 — checked on its own further down). Three teams here have a
    // week past it: Robert, Tim and Watkins.
    const totals = t.weekly.map((r) => Math.min(Math.max(weekLuckParts(r, lg).total, -50), 50));
    assert(Math.abs(avg(totals) - t.exact.luckScore) < 1e-9 && tenth(avg(totals)) === t.luckScore,
      `${t.name}${t.ties ? ' (tied once)' : ''}: weekly luck averages ${avg(totals).toFixed(3)}, ` +
      `its Luck score is ${t.exact.luckScore.toFixed(3)}`);
    const close = t.weekly.map((r) => r.gameLuck ?? 0);
    assert(t.scoreDiffLuck === tenth(avg(close)),
      `${t.name}: Close luck ${t.scoreDiffLuck}, its four games average ${avg(close).toFixed(3)}`);
    assert(t.cumulativeLuck[t.cumulativeLuck.length - 1].value === t.luckScore,
      `${t.name}: cumulative luck ends on ${t.cumulativeLuck[t.cumulativeLuck.length - 1].value}, ` +
      `not the Luck score ${t.luckScore}`);
  }
  const tieRow = tiedTeams[0].weekly.find((r) => r.tied);
  assert(tieRow.gameLuck === null && weekLuckParts(tieRow, lg).close === null,
    'a tied game still has no close-game figure of its own (the hover says "tie")');
}

// ------------------------------------------------- the single-week limit
//
// Tim, 2026-10-06: "the luck breakdown shows a user had a luck ranting of -90
// one week, that skews the rest of their rating, when I think that a single
// unlucky event like shouldn't be able to affect your entire luck ranking for
// the season" … "lets just round it out to a limit of +- 50". And of the
// close-game formula: "how it is is good for now".
//
// A league of the real shape (ten teams, four weeks, scores to the hundredth)
// with three weeks planted in it, every expectation worked here from the
// scores: a −90 week (hot opponent, 1.5-point loss, under projection), a +70
// week, and a one-point game worth ±49.5 all told, which is inside the limit.
{
  const { computeLeagueStats, gameLuck } = await import(pathToFileURL(path.join(REPO, 'js/stats.js')).href);
  const LIMIT = 50;
  const held = (v) => Math.min(Math.max(v, -LIMIT), LIMIT);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const tenth = (v) => Math.round(v * 10) / 10;
  const sd = (a) => { const m = avg(a); return Math.sqrt(a.reduce((x, v) => x + (v - m) ** 2, 0) / (a.length - 1)); };
  const PAIRS = {
    1: [[1, 10], [2, 9], [3, 8], [4, 7], [5, 6]],
    2: [[1, 2], [3, 10], [4, 9], [5, 8], [6, 7]],
    3: [[3, 4], [1, 5], [2, 6], [7, 10], [8, 9]],
    4: [[5, 6], [1, 7], [2, 8], [3, 9], [4, 10]],
  };
  // Ordinary weeks: a comfortable margin either way and a projection a few
  // points off, so nothing but the planted weeks comes near the limit.
  const act = (id, w) => 100 + 6 * id + ((id * w * 7) % 5) * 0.13;
  const proj = (id, w) => act(id, w) - (((id + 2 * w) % 5) - 2) * 3.21;
  const build = (planted) => {
    const games = [];
    for (const [w, pairs] of Object.entries(PAIRS)) {
      for (const [h, a] of pairs) {
        const week = Number(w);
        games.push({
          week, homeId: h, awayId: a,
          homeActual: act(h, week), awayActual: act(a, week),
          homeProjected: proj(h, week), awayProjected: proj(a, week),
        });
      }
    }
    const game = (week, h) => games.find((g) => g.week === week && g.homeId === h);
    if (planted) {
      // Week 2, team 1: scores 148 against 149.5 having been projected 171.
      Object.assign(game(2, 1), { homeActual: 148, awayActual: 149.5, homeProjected: 171, awayProjected: 149.5 });
      // Week 3, team 3: wins 90–88.5 having been projected 114.
      Object.assign(game(3, 3), { homeActual: 90, awayActual: 88.5, homeProjected: 114, awayProjected: 110 });
      // Week 4, teams 5 and 6: a one-point game, and projections set (below,
      // once the league average is known) so the week comes to ±49.5 all told.
      Object.assign(game(4, 5), { homeActual: 111, awayActual: 110 });
      const lg = avg(games.flatMap((g) => [g.homeActual, g.awayActual]));
      const g = game(4, 5);
      g.homeProjected = g.homeActual + (lg - g.awayActual) + 0.5;
      g.awayProjected = g.awayActual + (lg - g.homeActual) - 0.5;
    }
    return {
      season: 2026, name: 'Limit', isDemo: false, weeks: 14,
      teams: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `T${i + 1}` })),
      games,
    };
  };
  // A week's luck by hand, against the league average of the weeks given.
  const leagueOf = (st, through) => avg(st.teams.flatMap((t) =>
    t.weekly.filter((r) => r.week <= through).map((r) => r.actual)));
  const rawOf = (r, lg) => (lg - r.oppActual) + (r.actual - r.projected) + (gameLuck(r.actual - r.oppActual) ?? 0);

  const st = computeLeagueStats(build(true));
  const lg = leagueOf(st, 4);
  const team = (id) => st.teams.find((t) => t.id === id);
  const week = (id, w) => rawOf(team(id).weekly.find((r) => r.week === w), lg);
  assert(week(1, 2) < -85 && week(1, 2) > -95, `the planted −90 week reads ${week(1, 2).toFixed(1)}`);
  assert(week(3, 3) > 65 && week(3, 3) < 75, `the planted +70 week reads ${week(3, 3).toFixed(1)}`);
  assert(Math.abs(week(5, 4) - 49.5) < 1e-6 && Math.abs(week(6, 4) + 49.5) < 1e-6,
    `the planted close game reads ${week(5, 4).toFixed(2)} / ${week(6, 4).toFixed(2)}, not ±49.5`);
  // The close-game formula itself is not what was limited: a one-point game
  // is still a full ±50 of close-game luck.
  assert(gameLuck(1) === 50 && gameLuck(-1) === -50 && gameLuck(1.5) === 50 && Math.abs(gameLuck(3) - 43) < 1e-9,
    'the close-game formula has moved');

  let overWeeks = 0;
  for (const t of st.teams) {
    const raw = t.weekly.map((r) => rawOf(r, lg));
    overWeeks += raw.filter((v) => Math.abs(v) > LIMIT).length;
    const want = avg(raw.map(held));
    // THE RULE: the season Luck score is the mean of its weeks, each held
    // within ±50.
    assert(Math.abs(t.exact.luckScore - want) < 1e-9 && t.luckScore === tenth(want),
      `${t.name}: Luck score ${t.exact.luckScore.toFixed(3)}; its weeks ` +
      `(${raw.map((v) => v.toFixed(1)).join(', ')}) held within ±50 average ${want.toFixed(3)}`);
    assert(Math.abs(t.exact.skillPlusLuck - (t.exact.skill + want)) < 1e-9,
      `${t.name}: S+L ${t.exact.skillPlusLuck.toFixed(3)} is not Skill + that Luck score`);
    // Each week carries both figures, so every reader takes the same ones.
    assert(t.weekly.every((r, i) => Math.abs((r.weekLuck ?? NaN) - raw[i]) < 1e-9 &&
        Math.abs((r.weekLuckCounted ?? NaN) - held(raw[i])) < 1e-9),
      `${t.name}: its weekly rows do not carry the real and the counted luck`);
    // The cumulative line: every point is the Luck score as it stood after
    // that week — weeks 1..w, against the league average of weeks 1..w — and
    // the last one is the Luck score.
    t.cumulativeLuck.forEach((pt, i) => {
      const lgThen = leagueOf(st, pt.week);
      const then = avg(t.weekly.slice(0, i + 1).map((r) => held(rawOf(r, lgThen))));
      assert(pt.value === tenth(then),
        `${t.name}: cumulative luck after week ${pt.week} is ${pt.value}, by hand ${then.toFixed(3)}`);
    });
    assert(t.cumulativeLuck[3].value === t.luckScore,
      `${t.name}: cumulative luck ends on ${t.cumulativeLuck[3].value}, not the Luck score ${t.luckScore}`);
    // What the limit does NOT touch.
    const lucks = t.weekly.map((r) => r.actual - r.projected);
    assert(t.avgLuck === tenth(avg(lucks)) &&
        Math.abs(t.exact.pointsToWin - (avg(t.weekly.map((r) => r.oppActual)) - avg(lucks))) < 1e-9 &&
        t.scoreDiffLuck === tenth(avg(t.weekly.map((r) => gameLuck(r.actual - r.oppActual) ?? 0))),
      `${t.name}: Luck/wk, PTW or Close luck moved with the single-week limit`);
  }
  assert(overWeeks === 2, `the fixture has ${overWeeks} weeks past ±50, expected the two planted`);
  const counted = (id, w) => team(id).weekly.find((r) => r.week === w).weekLuckCounted;
  assert(counted(1, 2) === -50, `a −90 week counts ${counted(1, 2)} toward the season, not −50`);
  assert(counted(3, 3) === 50, `a +70 week counts ${counted(3, 3)} toward the season, not +50`);
  assert(Math.abs(counted(5, 4) - 49.5) < 1e-6 && Math.abs(counted(6, 4) + 49.5) < 1e-6,
    `a close game inside the limit counts ${counted(5, 4)} / ${counted(6, 4)}, not its own ±49.5`);
  // One week in four held back 40 points is 10 points of the season rating.
  const unheld = avg(team(1).weekly.map((r) => rawOf(r, lg)));
  assert(Math.abs((team(1).exact.luckScore - unheld) - (-50 - week(1, 2)) / 4) < 1e-9,
    `T1: the limit moved its Luck score by ${(team(1).exact.luckScore - unheld).toFixed(2)}`);
  // The ranks follow the score that is printed.
  const byLuck = [...st.teams].sort((a, b) => b.exact.luckScore - a.exact.luckScore).map((t) => t.id);
  const bySum = [...st.teams].sort((a, b) => b.exact.skillPlusLuck - a.exact.skillPlusLuck).map((t) => t.id);
  assert(byLuck.every((id, i) => team(id).luckStanding === i + 1) && bySum.every((id, i) => team(id).projectedStanding === i + 1),
    'LS / PS are not the order of the limited Luck score and S+L');
  // The ±: one standard error of the average of what the weeks COUNT.
  const terms = st.teams.flatMap((t) => t.weekly.map((r) => held(rawOf(r, lg))));
  const plus = st.teams.flatMap((t) => t.weekly.map((r) => held(rawOf(r, lg)) + r.projected));
  for (const t of st.teams) {
    assert(t.margins.luckScore === tenth(sd(terms) / 2) && t.margins.skillPlusLuck === tenth(sd(plus) / 2),
      `${t.name}: ± ${t.margins.luckScore} / ${t.margins.skillPlusLuck}, by hand ` +
      `${(sd(terms) / 2).toFixed(3)} / ${(sd(plus) / 2).toFixed(3)}`);
  }
  const unheldTerms = st.teams.flatMap((t) => t.weekly.map((r) => rawOf(r, lg)));
  assert(tenth(sd(unheldTerms) / 2) !== tenth(sd(terms) / 2),
    'the fixture cannot tell a ± of the counted weeks from one of the real weeks');

  // NOTHING OVER THE LIMIT, NOTHING MOVES — to the last bit. The same league
  // without the planted weeks: every luck figure is the sheet's own formula,
  // compared with === and not to a tolerance.
  const calm = computeLeagueStats(build(false));
  const calmLg = leagueOf(calm, 4);
  assert(calm.teams.every((t) => t.weekly.every((r) => Math.abs(rawOf(r, calmLg)) < LIMIT)),
    'the calm fixture has a week past ±50');
  const allTerms = calm.teams.flatMap((t) => t.weekly.map((r) =>
    (gameLuck(r.actual - r.oppActual) ?? 0) - (r.oppActual - (r.actual - r.projected))));
  const allPlus = calm.teams.flatMap((t) => t.weekly.map((r) =>
    (gameLuck(r.actual - r.oppActual) ?? 0) - (r.oppActual - (r.actual - r.projected)) + r.projected));
  const lgAll = avg(calm.teams.flatMap((t) => t.weekly.map((r) => r.actual)));
  for (const t of calm.teams) {
    const lucks = t.weekly.map((r) => r.actual - r.projected);
    const ptw = avg(t.weekly.map((r) => r.oppActual)) - avg(lucks);
    const close = avg(t.weekly.map((r) => gameLuck(r.actual - r.oppActual) ?? 0));
    assert(t.exact.luckScore === lgAll - (ptw - close),
      `${t.name}: with no week past the limit the Luck score is ${t.exact.luckScore}, the sheet's formula gives ${lgAll - (ptw - close)}`);
    assert(t.parts.limit === 0 && t.weekly.every((r) => r.weekLuckCounted === r.weekLuck),
      `${t.name}: the limit moved something in a season with no week past it`);
    assert(t.margins.luckScore === tenth(sd(allTerms) / 2) && t.margins.skillPlusLuck === tenth(sd(allPlus) / 2),
      `${t.name}: the ± moved in a season with no week past the limit`);
    let opp = 0; let luck = 0; let cl = 0;
    t.weekly.forEach((r, i) => {
      opp += r.oppActual; luck += r.actual - r.projected; cl += gameLuck(r.actual - r.oppActual) ?? 0;
      const n = i + 1;
      const was = tenth(leagueOf(calm, r.week) - (opp / n - luck / n) + cl / n);
      assert(t.cumulativeLuck[i].value === was,
        `${t.name}: cumulative luck after week ${r.week} is ${t.cumulativeLuck[i].value}, was ${was}`);
    });
  }
}

// ---- the five season cells that open their parts ---------------------------
//
// Tim, 2026-10-05: "If the user hovers over this number however, you can show
// them a preview of each of the three numbers". PTW, Close luck, Luck score,
// Skill and S+L, on the real page with a mouse: the card's rows are read back
// as printed and must add up to the printed cell to the tenth — the average of
// them for Close luck, whose rows are games — with any miss said in a row of
// its own, never hidden. And one preview a cell: no `title` beside it.
{
  const tenths = (s) => {
    const m = String(s).replace(/−/g, '-').match(/[-+]?\d+(\.\d+)?/);
    return m ? Math.round(parseFloat(m[0]) * 10) : NaN;
  };
  const fire = (el, type) => el.dispatchEvent(new document.defaultView.Event(type, { bubbles: true }));
  const cells = [...document.querySelectorAll('#mainTable td[data-explain]')];
  const keys = ['pointsToWin', 'scoreDiffLuck', 'luckScore', 'skill', 'skillPlusLuck'];
  assert(cells.length === 50 && keys.every((k) => cells.filter((c) => c.dataset.explain === k).length === 10),
    `expected the five explained cells on each of ten rows, found ${cells.length}`);
  assert(cells.every((c) => !c.hasAttribute('title') && !c.querySelector('[title]')),
    'a cell that opens its parts also carries a title: two previews on one number');
  assert(cells.every((c) => c.getAttribute('tabindex') === '0'), 'an explained cell cannot be reached by keyboard');
  let rounded = 0;
  const limitRows = [];
  for (const c of cells) {
    fire(c, 'mouseover');
    const pop = $('statCard');
    const what = `${c.parentElement.children[0].textContent.trim()} ${c.dataset.explain}`;
    if (!pop || pop.hasAttribute('hidden')) { assert(false, `${what}: no card opened`); continue; }
    const rows = [...pop.querySelectorAll('tbody tr')].map((r) => [r.children[0].textContent, r.children[1].textContent]);
    const foot = pop.querySelector('tfoot tr');
    const parts = rows.filter((r) => r[0] !== 'Rounding');
    const fix = rows.filter((r) => r[0] === 'Rounding');
    rounded += fix.length;
    // The single-week limit is a row of the Luck score alone, and only where
    // it prints as something.
    const lim = rows.filter((r) => r[0] === 'Single-week limit');
    if (lim.length) limitRows.push([c.parentElement.children[0].textContent.trim(), c.dataset.explain, tenths(lim[0][1])]);
    assert(lim.length <= 1 && lim.every((r) => tenths(r[1]) !== 0 && /^[-+−]/.test(r[1].trim())),
      `${what}: the Single-week limit row reads ${JSON.stringify(lim)}`);
    const sum = parts.reduce((a, r) => a + tenths(r[1]), 0);
    const mean = c.dataset.explain === 'scoreDiffLuck';
    const total = (mean ? Math.round(sum / parts.length) : sum) + fix.reduce((a, r) => a + tenths(r[1]), 0);
    assert(parts.length >= 2 && total === tenths(c.textContent) && tenths(foot.children[1].textContent) === tenths(c.textContent),
      `${what}: the cell prints ${c.textContent.trim()}, its rows ${JSON.stringify(rows)} come to ${total / 10} ` +
      `and the last line reads ${foot.textContent}`);
    assert(fix.length <= 1 && fix.every((r) => Math.abs(tenths(r[1])) === 1),
      `${what}: a Rounding row is one tenth, once: ${JSON.stringify(fix)}`);
    assert(!/[.!?]\s|NaN|undefined/.test(pop.textContent), `${what}: the card is labels and numbers: ${pop.textContent}`);
    // The card is the site-wide one (js/pop.js): a hover card cannot be clicked,
    // so it carries no button; the sheet a finger gets, with its Close, is
    // pop-check.mjs's to prove.
    assert((pop.getAttribute('class') || '').split(/\s+/).includes('statcard') && !pop.querySelector('button, a'),
      `${what}: the hover card is not the shared stat card, or carries a control nobody can press`);
    assert(!c.hasAttribute('title'), `${what}: opening the card left a title on the cell`);
    fire(c, 'mouseout');
    assert(pop.hasAttribute('hidden'), `${what}: moving off the cell left the card open`);
  }
  // Which Luck scores carry the row, and how much, worked from the demo season:
  // the mean over a team's weeks of (the week held within ±50) − (the week).
  {
    const { generateDemoLeague } = await import(pathToFileURL(path.join(REPO, 'js/demo.js')).href);
    const { computeLeagueStats } = await import(pathToFileURL(path.join(REPO, 'js/stats.js')).href);
    const st = computeLeagueStats(generateDemoLeague());
    const all = st.teams.flatMap((t) => t.weekly.map((r) => r.actual));
    const lg = all.reduce((a, b) => a + b, 0) / all.length;
    const want = st.teams.map((t) => {
      const raw = t.weekly.map((r) => (lg - r.oppActual) + (r.actual - r.projected) + (r.gameLuck ?? 0));
      const off = raw.reduce((a, v) => a + Math.min(Math.max(v, -50), 50) - v, 0) / raw.length;
      return [t.name, 'luckScore', Math.round(off * 10)];
    }).filter((r) => r[2] !== 0);
    const key = (rows) => JSON.stringify([...rows].sort((a, b) => a[0].localeCompare(b[0])));
    assert(want.length > 0, 'no demo Luck score is moved a tenth by the single-week limit: nothing to show');
    assert(key(limitRows) === key(want),
      `the Single-week limit rows are ${key(limitRows)}, worked from the season ${key(want)}`);
  }
  // The same element as the schedule card, so only one can ever be open.
  assert(document.querySelectorAll('.statcard').length === 1 && !$('oppPop'),
    'the two previews are separate elements, or the page still builds its own card');
  // Luck score's rows are figures the page already prints: the glance row's
  // league average, and that team's own Opp Avg, Luck/wk and Close luck cells.
  const first = mainRows[0];
  fire(first[12], 'mouseover');
  const got = [...$('statCard').querySelectorAll('tbody tr')].map((r) => tenths(r.children[1].textContent));
  assert(got[1] === -tenths(first[5].textContent) && got[2] === tenths(first[9].textContent) &&
    got[3] === tenths(first[11].textContent),
    `Luck score rows ${JSON.stringify(got)} are not the row's own Opp Avg, Luck/wk and Close luck cells`);
  fire(first[12], 'mouseout');
}

// ARRIVING FROM ANOTHER PAGE (2026-10-08): `stats.html?team=3` marks that
// team's row and no other, and does not become the saved "My team".
{
  const linked = [...document.querySelectorAll('#mainTable tbody tr.linked')];
  const teamOf = (tr) => tr.querySelector('[data-team]')?.getAttribute('data-team');
  assert(linked.length === 1 && teamOf(linked[0]) === '3',
    `?team=3 marked ${linked.length} row(s): ${linked.map(teamOf).join(',')}`);
  assert(linked.every((tr) => !(tr.getAttribute('class') || '').split(/\s+/).includes('me')),
    'the linked row was drawn as My team');
  const saved = globalThis.localStorage.getItem('ff.prefs') || '';
  assert(!/highlight"\s*:\s*"?3/.test(saved), `the link was saved as the My team choice: ${saved}`);
}

if (problems.length) {
  console.log('FAIL stats panel order');
  for (const p of problems) console.log(`  - ${p}`);
  console.log(`\n${problems.length} check(s) failed`);
  process.exit(1);
}
console.log('Panel order is Tim’s: ' + titles.join(' → '));
console.log(`\nAll ${checks} assertions passed`);
process.exit(0);
