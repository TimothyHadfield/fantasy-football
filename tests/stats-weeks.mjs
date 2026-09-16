// Boots the REAL stats.html + js/stats-page.js against a demo league that has
// been shortened to N weeks, so the start-of-season guards can be checked the
// way the browser will see them.
//
//   node stats-weeks.mjs           -> runs 1, 2, 3 and 13 weeks
//   node stats-weeks.mjs <dir> <n> -> child mode, one week count
//
// Plus a pure-data pass over stats.js with 0/1/2/13 weeks of synthetic games.

import { parseHTML } from 'linkedom';
import { readFileSync, writeFileSync, cpSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

import { REPO } from './repo.mjs';
const WORK = path.join(os.tmpdir(), 'ff-weeks');

function makeRepo(weeks) {
  const dir = path.join(WORK, `w${weeks}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(path.join(REPO, 'js'), path.join(dir, 'js'), { recursive: true });
  cpSync(path.join(REPO, 'stats.html'), path.join(dir, 'stats.html'));
  const demo = path.join(dir, 'js', 'demo.js');
  const src = readFileSync(demo, 'utf8');
  if (!/const WEEKS = 13;/.test(src)) throw new Error('demo.js WEEKS constant moved');
  // buildInjuries spins forever looking for unique team-week slots when there
  // are fewer slots than injuries, which only happens in this harness — the
  // real demo generator is fixed at 13 weeks. Cap the count so it terminates.
  const patched = src
    .replace('const WEEKS = 13;', `const WEEKS = ${weeks};`)
    .replace(/const count = INJURY_MIN[^\n]*/, 'const count = Math.min(2, WEEKS);');
  writeFileSync(demo, patched);
  return dir;
}

const trace = (m) => { if (process.env.FF_TRACE) process.stderr.write(`[trace] ${m}\n`); };

async function renderPage(dir) {
  trace('renderPage ' + dir);
  const html = readFileSync(path.join(dir, 'stats.html'), 'utf8');
  const { window, document } = parseHTML(html);

  const SelectProto = window.HTMLSelectElement?.prototype;
  if (SelectProto) {
    Object.defineProperty(SelectProto, 'value', {
      configurable: true,
      get() {
        const sel = this.querySelector('option[selected]') || this.querySelector('option');
        return sel ? sel.getAttribute('value') ?? sel.textContent : '';
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

  for (const src of ['js/stats-page.js', 'js/connection.js']) {
    trace('importing ' + src);
    await import(pathToFileURL(path.join(dir, src)).href + `?t=${Date.now()}`);
    trace('imported ' + src);
  }
  await new Promise((r) => setTimeout(r, 250));
  trace('settled');
  console.error = orig;
  return { document, errors, fetchCalls };
}

// ------------------------------------------------------------------ child
if (process.argv[2]) {
  const dir = process.argv[2];
  const weeks = Number(process.argv[3]);
  const problems = [];
  try {
    const { document, errors, fetchCalls } = await renderPage(dir);
    const $ = (id) => document.getElementById(id);
    const hidden = (id) => $(id).hasAttribute('hidden');
    const text = (id) => ($(id) ? $(id).textContent : '');
    const thin = weeks < 3;

    if (errors.length) problems.push(`console.error: ${errors[0]}`);
    if (fetchCalls.length) problems.push('made a network call');

    for (const id of ['panelWeekly', 'panelLuck', 'panelCumLuck', 'panelBox']) {
      if (hidden(id) !== thin) problems.push(`${id} hidden=${hidden(id)} at ${weeks} weeks`);
    }
    if (hidden('panelEarly') !== !thin) problems.push(`panelEarly hidden=${hidden('panelEarly')} at ${weeks} weeks`);

    const main = $('mainTable');
    const rows = main.querySelectorAll('tbody tr');
    if (rows.length !== 10) problems.push(`main table has ${rows.length} rows`);
    const cells = Array.from(rows[0].children).map((td) => td.textContent.trim());
    if (cells.length !== 18) problems.push(`row has ${cells.length} cells, expected 18`);
    // Column order: name, W-L, Avg, Proj, Total, OppAvg, F-A, Spread, OppProj,
    //               Luck/wk, PTW, Close, LuckScore, Skill, S+L, LS, PS, AS
    const groupCols = Array.from(main.querySelectorAll('thead tr')[0].children)
      .reduce((n, th) => n + (Number(th.getAttribute('colspan')) || 1), 0);
    if (groupCols !== 18) problems.push(`group header spans ${groupCols} columns`);

    // FROM WEEK 1 NOW, with a ± — Tim, 2026-09-16. Close, Luck and S+L print a
    // signed figure and a margin; LS and PS rank. Spread still needs two weeks.
    for (const [i, label] of [[11, 'Close'], [12, 'LuckScore'], [14, 'S+L']]) {
      const allRows = Array.from(rows).map((r) => r.children[i].textContent.trim());
      const bad = allRows.filter((c) => !/^[+−-]?\d+\.\d±\d+$/.test(c));
      // A tied game has no close luck; every other cell must carry both halves.
      if (bad.length && !(label === 'Close' && bad.every((c) => c === '—'))) {
        problems.push(`${label} at ${weeks} weeks: ${bad.slice(0, 2).join(', ')} — expected "+12.3±8"`);
      }
    }
    for (const [i, label] of [[15, 'LS'], [16, 'PS']]) {
      if (!/^\d+$/.test(cells[i])) problems.push(`${label} = "${cells[i]}" at ${weeks} weeks, expected a rank`);
    }
    if (!/two times in three/.test(text('mainTableNote'))) problems.push('note does not explain the ±');

    if (thin) {
      if (weeks === 1 && cells[7] !== '—') problems.push(`Spread = "${cells[7]}" at 1 week, expected dash`);
      if (cells[17] === '—') problems.push('AS should still rank on record');
      if (!text('earlyNote').includes('projection')) problems.push('early note missing projection error');
    } else {
      if (cells[12] === '—') problems.push('luck score dashed at 13 weeks');
      if (cells[7] === '—') problems.push('spread dashed at 13 weeks');
      // Per-team boxes need five weeks; at 3-4 the panel explains itself instead.
      const drew = Boolean($('chartBox').querySelector('svg'));
      const explained = $('chartBox').textContent.includes('five weeks');
      if (weeks >= 5 && !drew) problems.push('box plot did not draw at 13 weeks');
      if (weeks < 5 && !explained) problems.push('box panel neither drew nor explained itself');
    }

    // Total must be thousands-separated once it gets there.
    if (weeks === 13 && !/^\d,\d{3}$/.test(cells[4])) problems.push(`Total not separated: "${cells[4]}"`);

    // Weekly table baseline row.
    const foot = $('weeklyTable').querySelector('tfoot');
    if (!foot || !foot.textContent.includes('League')) problems.push('no League baseline row');
    const footCells = foot.querySelectorAll('td').length;
    const headCells = $('weeklyHead').children.length;
    if (footCells !== headCells) problems.push(`baseline row ${footCells} cells vs ${headCells} headers`);

    // No fabricated zero std dev anywhere.
    if (weeks === 1 && main.textContent.includes('0.0')) {
      const spread = Array.from(rows).map((r) => r.children[7].textContent.trim());
      if (spread.some((v) => v === '0.0')) problems.push('Std Dev 0.0 still shown at 1 week');
    }

    // Accuracy: no empty buckets, no percentage from a handful of games.
    const accRows = Array.from($('accuracyTable').querySelectorAll('tbody tr'));
    for (const r of accRows) {
      const c = Array.from(r.children).map((x) => x.textContent.trim());
      if (c.length === 4 && c[1] === '0') problems.push(`empty accuracy bucket ${c[0]} rendered`);
      if (c.length === 4 && Number(c[1]) < 20 && c[3] !== '—') {
        problems.push(`accuracy ${c[3]} shown from ${c[1]} games`);
      }
    }

    // The toggle must still say Demo.
    const on = $('sourceToggle').querySelector('button.on');
    if (!on || on.getAttribute('data-src') !== 'demo') problems.push('source toggle not on demo');

    if (process.env.FF_DUMP) {
      const head = Array.from(main.querySelectorAll('thead tr')).map((tr) =>
        Array.from(tr.children).map((th) => th.textContent.trim() + (th.getAttribute('colspan') ? `x${th.getAttribute('colspan')}` : '')).join(' | '));
      process.stderr.write(`\n== ${weeks} weeks ==\n${head.join('\n')}\n${cells.join(' | ')}\n`);
      process.stderr.write(`glance: ${text('glance').replace(/\s+/g, ' ')}\n`);
      process.stderr.write(`early: ${text('earlyNote')}\n`);
      process.stderr.write(`note: ${text('mainTableNote')}\n`);
      process.stderr.write(`weekly head: ${$('weeklyHead').textContent.trim()}\n`);
      process.stderr.write(`weekly foot: ${$('weeklyTable').querySelector('tfoot').textContent.replace(/\s+/g, ' ')}\n`);
      process.stderr.write(`weekly note: ${text('weeklyNote')}\n`);
      process.stderr.write(`acc: ${$('accuracyTable').querySelector('tbody').textContent.replace(/\s+/g, ' ')} | ${text('accuracyNote')}\n`);
    }
    console.log(JSON.stringify({ weeks, ok: !problems.length, problems }));
    process.exit(problems.length ? 1 : 0);
  } catch (err) {
    console.log(JSON.stringify({ weeks, ok: false, problems: [String(err && err.stack || err)] }));
    process.exit(1);
  }
}

// ------------------------------------------------------------------ parent
const self = fileURLToPath(import.meta.url);
let failed = 0;
for (const weeks of [1, 2, 3, 5, 13]) {
  const dir = makeRepo(weeks);
  const res = spawnSync(process.execPath, [self, dir, String(weeks)], { encoding: 'utf8' });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch { /* fall through */ }
  if (!parsed) {
    console.log(`FAIL ${weeks}wk  no result\n  ${(res.stderr || res.stdout || '').slice(0, 1500)}`);
    failed++;
  } else if (parsed.ok) {
    console.log(`PASS ${weeks}wk`);
  } else {
    failed++;
    console.log(`FAIL ${weeks}wk`);
    for (const p of parsed.problems) console.log(`  - ${p.slice(0, 700)}`);
  }
}

// ------------------------------------------- pure data pass, including 0 weeks
const { computeLeagueStats, stdev, boxStats, predictionAccuracy } =
  await import(pathToFileURL(path.join(REPO, 'js/stats.js')).href);

function synthetic(weeks) {
  const teams = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `T${i + 1}` }));
  const games = [];
  for (let w = 1; w <= weeks; w++) {
    for (let i = 0; i < 10; i += 2) {
      games.push({
        week: w, homeId: i + 1, awayId: i + 2,
        homeActual: 100 + i + w, awayActual: 103 + i,
        homeProjected: 110 + i, awayProjected: 108 + i,
      });
    }
  }
  return { season: 2026, name: 'Synthetic', weeks, teams, games, injuries: [] };
}

const dataProblems = [];
const check = (cond, msg) => { if (!cond) dataProblems.push(msg); };

check(stdev([5]) === null, 'stdev([5]) should be null');
check(typeof stdev([5, 7]) === 'number', 'stdev of two values should be a number');
check(boxStats([1, 2]) === null, 'boxStats of 2 values should be null');
check(boxStats([1, 2, 3, 4, 5]) !== null, 'boxStats of 5 values should compute');
check(predictionAccuracy([]).every((b) => b.accuracy === null), 'no games -> no accuracy');

const marginAt = {};
for (const weeks of [0, 1, 2, 13]) {
  let s;
  try {
    s = computeLeagueStats(synthetic(weeks));
    marginAt[weeks] = s.teams.map((t) => t.margins);
  } catch (err) {
    dataProblems.push(`${weeks}wk threw: ${err.message}`);
    continue;
  }
  check(s.weekNumbers.length === weeks, `${weeks}wk: weekNumbers`);
  check(s.teams.length === 10, `${weeks}wk: teams`);
  if (weeks === 0) {
    check(s.teams.every((t) => t.actualStanding === null), '0wk: ranks must refuse');
    check(s.leagueActualBox === null, '0wk: league box must be null');
    check(s.teams.every((t) => t.actualStdev === null), '0wk: stdev must be null');
  }
  if (weeks === 1) {
    check(s.teams.every((t) => t.actualStdev === null), '1wk: stdev must be null');
    check(s.teams.every((t) => t.actualBox === null), '1wk: per-team box must be null');
    check(s.leagueActualBox !== null, '1wk: league box should exist (10 scores)');
    check(s.teams.some((t) => t.actualStanding !== null), '1wk: record ranks should exist');
    check(s.predictionAccuracy[0].accuracy === null, '1wk: accuracy must be withheld');
    check(s.weeklyLeagueAverages.length === 1, '1wk: league averages');
  }
  if (weeks === 13) {
    check(s.teams.every((t) => t.actualBox !== null), '13wk: boxes should compute');
    check(s.predictionAccuracy[0].accuracy !== null, '13wk: overall accuracy should show');
    check(s.teams.every((t) => t.actualStdev !== null), '13wk: stdev should compute');
  }
}

// The margin is WIDE EARLY AND NARROWS — the whole of Tim's ask. Same league
// shape, one week against thirteen, every team and every one of the three.
check(marginAt[0].every((m) => m.luckScore === null), '0wk: no games, no margin');
for (const key of ['luckScore', 'skillPlusLuck', 'scoreDiffLuck']) {
  check(marginAt[1].every((m) => m[key] > 0), `1wk: ${key} margin should be a positive number`);
  check(marginAt[13].every((m, i) => m[key] < marginAt[1][i][key]),
    `${key}: margin at 13 weeks should be narrower than at 1 ` +
    `(${marginAt[13][0][key]} vs ${marginAt[1][0][key]})`);
}
// And the √n is the TEAM's own: the same pooled spread over 13 games is a
// 1/√13 of it over one. With the synthetic league's spread barely moving,
// the ratio has to land near that.
{
  const r = marginAt[13][0].luckScore / marginAt[1][0].luckScore;
  check(r > 0.1 && r < 0.6, `luck margin ratio 13wk/1wk = ${r.toFixed(3)}, expected about 1/√13`);
}
// The VALUES are untouched — the margin is beside them, not folded in.
{
  const s = computeLeagueStats(synthetic(13));
  const t = s.teams[0];
  check(Math.abs(t.luckScore - Math.round((t.exact.luckScore) * 10) / 10) < 1e-9,
    'luck score is still the sheet formula, unrounded copy agrees');
}

if (dataProblems.length) {
  failed++;
  console.log('FAIL stats.js data guards');
  for (const p of dataProblems) console.log(`  - ${p}`);
} else {
  console.log('PASS stats.js data guards (0/1/2/13 weeks)');
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
