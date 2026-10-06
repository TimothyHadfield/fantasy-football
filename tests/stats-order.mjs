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
  'Early season',
  'Weekly scores',
  'Weekly luck — actual minus projected',
  'Cumulative luck',
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
  ['Schedule luck — rest of season', 'panelOppProj'],
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
    const totals = t.weekly.map((r) => weekLuckParts(r, lg).total);
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
  for (const c of cells) {
    fire(c, 'mouseover');
    const pop = $('oppPop');
    const what = `${c.parentElement.children[0].textContent.trim()} ${c.dataset.explain}`;
    if (!pop || pop.hasAttribute('hidden')) { assert(false, `${what}: no card opened`); continue; }
    const rows = [...pop.querySelectorAll('tbody tr')].map((r) => [r.children[0].textContent, r.children[1].textContent]);
    const foot = pop.querySelector('tfoot tr');
    const parts = rows.filter((r) => r[0] !== 'Rounding');
    const fix = rows.filter((r) => r[0] === 'Rounding');
    rounded += fix.length;
    const sum = parts.reduce((a, r) => a + tenths(r[1]), 0);
    const mean = c.dataset.explain === 'scoreDiffLuck';
    const total = (mean ? Math.round(sum / parts.length) : sum) + fix.reduce((a, r) => a + tenths(r[1]), 0);
    assert(parts.length >= 2 && total === tenths(c.textContent) && tenths(foot.children[1].textContent) === tenths(c.textContent),
      `${what}: the cell prints ${c.textContent.trim()}, its rows ${JSON.stringify(rows)} come to ${total / 10} ` +
      `and the last line reads ${foot.textContent}`);
    assert(fix.length <= 1 && fix.every((r) => Math.abs(tenths(r[1])) === 1),
      `${what}: a Rounding row is one tenth, once: ${JSON.stringify(fix)}`);
    assert(!/[.!?]\s|NaN|undefined/.test(pop.textContent), `${what}: the card is labels and numbers: ${pop.textContent}`);
    assert(pop.querySelector('.op-close'), `${what}: the card has no Close for a finger`);
    fire(c, 'mouseout');
    assert(pop.hasAttribute('hidden'), `${what}: moving off the cell left the card open`);
  }
  // The same element as the schedule card, so only one can ever be open.
  assert(document.querySelectorAll('.opp-pop').length === 1, 'the two previews are separate elements');
  // Luck score's rows are figures the page already prints: the glance row's
  // league average, and that team's own Opp Avg, Luck/wk and Close luck cells.
  const first = mainRows[0];
  fire(first[12], 'mouseover');
  const got = [...$('oppPop').querySelectorAll('tbody tr')].map((r) => tenths(r.children[1].textContent));
  assert(got[1] === -tenths(first[5].textContent) && got[2] === tenths(first[9].textContent) &&
    got[3] === tenths(first[11].textContent),
    `Luck score rows ${JSON.stringify(got)} are not the row's own Opp Avg, Luck/wk and Close luck cells`);
  fire(first[12], 'mouseout');
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
