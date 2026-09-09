// Boots the REAL stats.html + js/stats-page.js and checks the new schedule-luck
// stat (Avg. Predicted Opponent Projection) in four situations:
//
//   demo   - no league connected, demo data, and NO network of any kind
//   zero   - a live league with a full schedule and ZERO completed games
//   mid    - the same league two weeks in
//   reject - the same league where the roster fetch throws
//
//   node opp-check.mjs            -> all four
//   node opp-check.mjs <scenario> -> child mode
//
// Nothing here is written into the repo.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';
const SCEN = process.argv[2];

// -------------------------------------------------------------- the harness

async function boot(scenario) {
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
  if (scenario !== 'demo') {
    store.set('ff.connection', JSON.stringify({ leagueId: '112233', season: 2026, teamId: 2 }));
    store.set('ff.prefs', JSON.stringify({ 'stats.source': 'live' }));
  }
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
  const rejections = [];
  process.on('unhandledRejection', (e) => rejections.push(String(e && e.message || e)));

  // Stub season.js for every live scenario. register() only affects imports
  // made after it, and stats-page.js is imported dynamically below.
  let stub = null;
  if (scenario !== 'demo') {
    const { register } = await import('node:module');
    register('./opp-loader.mjs', import.meta.url);
    stub = await import('./opp-season-stub.mjs');
  }

  await import(pathToFileURL(path.join(REPO, 'js/stats-page.js')).href);
  await import(pathToFileURL(path.join(REPO, 'js/connection.js')).href);

  // Snapshot the panel while the roster reads are still going, so the pending
  // state is checked rather than assumed.
  let midFlight = '';
  setTimeout(() => {
    midFlight = clean(document.getElementById('oppProjChart').textContent) +
      ' || ' + clean(document.getElementById('oppProjNote').textContent);
  }, 70);

  await new Promise((r) => setTimeout(r, 500));
  console.error = orig;

  return { document, errors, rejections, fetchCalls, stub, midFlight };
}

// ------------------------------------------------------------ reading the DOM

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

function readPage(document) {
  const $ = (id) => document.getElementById(id);
  const main = $('mainTable');
  const headRows = Array.from(main.querySelectorAll('thead tr'));
  const labels = Array.from(headRows[headRows.length - 1].children).map((th) => clean(th.textContent));
  const groupCols = Array.from(headRows[0].children)
    .reduce((n, th) => n + (Number(th.getAttribute('colspan')) || 1), 0);

  const rows = Array.from(main.querySelectorAll('tbody tr')).map((tr) => ({
    cells: Array.from(tr.children).map((td) => clean(td.textContent)),
    dataV: Array.from(tr.children).map((td) => td.getAttribute('data-v')),
    me: (tr.getAttribute('class') || '').includes('me'),
  }));

  const bars = Array.from(document.querySelectorAll('#oppProjChart .oppbars li')).map((li) => {
    const get = (cls) => clean(li.querySelector(cls)?.textContent);
    return {
      rank: Number(get('.rk')),
      name: get('.nm'),
      value: Number(get('.vv')),
      gap: get('.dd'),
      width: Number(/width:([\d.]+)%/.exec(li.querySelector('.bar i')?.getAttribute('style') || '')?.[1]),
      me: (li.getAttribute('class') || '').includes('me'),
    };
  });

  return {
    labels, groupCols, rows, bars,
    oppIndex: labels.indexOf('Opp proj'),
    chartText: clean($('oppProjChart').textContent),
    note: clean($('oppProjNote').textContent),
    status: clean($('sourceStatus').textContent),
    glance: clean($('glance').textContent),
    tableNote: clean($('mainTableNote').textContent),
    badge: clean($('modeBadge').textContent),
    toggle: Array.from(document.querySelectorAll('#sourceToggle button'))
      .filter((b) => (b.getAttribute('class') || '').includes('on'))
      .map((b) => b.getAttribute('data-src')).join(','),
    weekGridHidden: $('panelWeekGrid').hasAttribute('hidden'),
    panelPresent: Boolean($('panelOppProj')),
  };
}

// -------------------------------------------------------------------- checks

const EXPECT = { 1: 122.0, 2: 118.7, 3: 115.3, 4: 112.0 };   // hand-computed
const EXPECT_LEAGUE = 117.0;

function check(scenario, page, boot) {
  const p = [];
  const ok = (cond, msg) => { if (!cond) p.push(msg); };

  if (boot.errors.length) p.push(`console.error: ${boot.errors[0]}`);
  if (boot.rejections.length) p.push(`unhandled rejection: ${boot.rejections[0]}`);
  if (boot.fetchCalls.length) p.push(`hit the network: ${boot.fetchCalls[0]}`);

  // --- structure, every scenario -------------------------------------------
  ok(page.panelPresent, 'no #panelOppProj section');
  ok(page.oppIndex === 8, `Opp proj header at index ${page.oppIndex}, expected 8`);
  ok(page.labels.length === 18, `${page.labels.length} header labels, expected 18`);
  ok(page.groupCols === page.labels.length,
    `group band spans ${page.groupCols} columns but there are ${page.labels.length}`);
  ok(page.rows.length > 0, 'main table rendered no rows');

  const calls = boot.stub ? boot.stub.calls : [];

  if (scenario === 'demo') {
    ok(page.bars.length === 10, `${page.bars.length} bars, expected 10`);
    ok(page.badge === 'Demo', `badge is "${page.badge}"`);
    const col = page.rows.map((r) => r.cells[8]);
    ok(col.every((v) => /^\d+\.\d$/.test(v)), `Opp proj column not all numbers: ${col.join(',')}`);
  }

  if (scenario === 'zero' || scenario === 'mid') {
    ok(calls.filter((c) => c === 'fetchSchedule').length === 1,
      `fetchSchedule called ${calls.filter((c) => c === 'fetchSchedule').length} times`);
    ok(calls.includes('fetchWeeksRosters:1/2/3'),
      `rosters not asked for every week: ${calls.join(' | ')}`);

    ok(page.bars.length === 4, `${page.bars.length} bars, expected 4`);
    // Hardest first.
    const values = page.bars.map((b) => b.value);
    ok(values.every((v, i) => i === 0 || values[i - 1] >= v),
      `bars not ordered hardest-first: ${values.join(', ')}`);
    ok(page.bars.map((b) => b.rank).join(',') === '1,2,3,4', 'bar ranks not 1..4');
    ok(page.bars[0].name === 'Team 1' && page.bars[3].name === 'Team 4',
      `bar order is ${page.bars.map((b) => b.name).join(' > ')}`);

    // Hand-computed averages, in the bars and in the table cell alike.
    for (const b of page.bars) {
      const id = Number(b.name.replace('Team ', ''));
      ok(Math.abs(b.value - EXPECT[id]) < 0.05, `${b.name} bar shows ${b.value}, expected ${EXPECT[id]}`);
    }
    for (const r of page.rows) {
      const id = Number(r.cells[0].replace('Team ', ''));
      ok(Math.abs(Number(r.cells[8]) - EXPECT[id]) < 0.05,
        `${r.cells[0]} Opp proj cell is ${r.cells[8]}, expected ${EXPECT[id]}`);
      ok(Math.abs(Number(r.dataV[8]) - EXPECT[id]) < 0.06,
        `${r.cells[0]} data-v is ${r.dataV[8]}`);
    }

    // The league average is the mean of the per-team averages, and the note says so.
    const mean = values.reduce((a, v) => a + v, 0) / values.length;
    ok(Math.abs(mean - EXPECT_LEAGUE) < 0.05, `mean of bars is ${mean}, expected ${EXPECT_LEAGUE}`);
    ok(page.note.includes('117.0'), `note does not carry the league average: ${page.note}`);

    // Gaps from that average, and the sign convention.
    const gaps = page.bars.map((b) => b.gap);
    ok(gaps[0] === '+5.0' && gaps[3] === '-5.0', `gaps are ${gaps.join(' ')}`);

    // Bars are scaled between the min and max, not from zero.
    ok(page.bars[0].width === 100 && page.bars[3].width === 8,
      `bar widths ${page.bars.map((b) => b.width).join(',')} — should span 8..100`);

    // The owner's team (teamId 2 in the stub connection) is marked.
    ok(page.bars.some((b) => b.me && b.name === 'Team 2'), 'owner’s team not marked in the bars');
    ok(page.rows.some((r) => r.me && r.cells[0] === 'Team 2'), 'owner’s team not marked in the table');

    // The note has to say what it is, that it needs no games, and how many weeks.
    for (const phrase of ['no games played', 'best legal lineup', 'weeks 1–3', 'fixture']) {
      ok(page.note.toLowerCase().includes(phrase.toLowerCase()), `note is missing "${phrase}"`);
    }
    ok(page.badge === 'Live', `badge is "${page.badge}"`);
    ok(page.toggle === 'live', `source toggle is on "${page.toggle}"`);
  }

  if (scenario === 'zero') {
    // The whole point: nothing played, page still renders, panel still populated.
    ok(page.rows.length === 4, `${page.rows.length} rows with zero games`);
    ok(page.bars.length === 4, 'no bars with zero games played');
    // Every results column blank rather than a fabricated 0.0.
    for (const [i, label] of [[2, 'Avg'], [3, 'Proj'], [4, 'Total'], [5, 'Opp Avg'],
                              [6, 'F−A'], [7, 'Spread'], [9, 'Luck/wk'], [10, 'PTW'],
                              [13, 'Skill'], [17, 'AS']]) {
      ok(page.rows[0].cells[i] === '—', `${label} = "${page.rows[0].cells[i]}" with no games, expected a dash`);
    }
    ok(page.rows[0].dataV[4] === null, 'Total carries a data-v with no games');
    ok(page.rows[0].cells[1] === '0–0', `record is "${page.rows[0].cells[1]}"`);
    ok(!page.glance.includes('0.0'), `glance prints a fabricated 0.0: ${page.glance}`);
    ok(page.glance.includes('Hardest schedule'), 'glance has no hardest-schedule tile');
    ok(page.glance.includes('122.0'), `hardest-schedule tile missing its number: ${page.glance}`);
    ok(page.weekGridHidden, 'week-by-week grid shown with no weeks');
    ok(/no completed matchups/i.test(page.status), `status does not explain itself: ${page.status}`);
    ok(/schedule luck/i.test(page.status), 'status does not point at the panel that does work');
    ok(/blank rather than zero/i.test(page.tableNote), `table note does not explain the dashes: ${page.tableNote}`);
  }

  if (scenario === 'mid') {
    ok(page.rows[0].cells[2] !== '—', 'Avg dashed two weeks in');
    ok(!page.weekGridHidden, 'week-by-week grid hidden two weeks in');
  }

  if (scenario === 'gap') {
    // Week 2 is missing, so each team has two fixtures left, not three, and the
    // panel has to say so rather than counting the missing week as zero.
    ok(page.bars.length === 4, 'no bars when a week is missing');
    const byName = Object.fromEntries(page.bars.map((b) => [b.name, b.value]));
    ok(Math.abs(byName['Team 1'] - 122.0) < 0.05, `Team 1 = ${byName['Team 1']}, expected 122.0`);
    ok(Math.abs(byName['Team 2'] - 112.0) < 0.05, `Team 2 = ${byName['Team 2']}, expected 112.0`);
    ok(/2 fixtures each/.test(page.note), `note does not restate the fixture count: ${page.note}`);
    ok(/would not return rosters for 1 week/.test(page.note),
      `note does not report the missing week: ${page.note}`);
    ok(/\(2\)/.test(page.note), 'note does not name which week is missing');
  }

  if (scenario === 'slow') {
    // Mid-flight the panel must say it is working, and say what it costs.
    ok(/Reading ESPN/.test(boot.midFlight), `no pending state mid-flight: "${boot.midFlight}"`);
    ok(/week \d of 3/.test(boot.midFlight), `pending state shows no progress: "${boot.midFlight}"`);
    ok(/one request per week/.test(boot.midFlight), 'pending note does not explain the cost');
    // And by the end it must have been replaced by the real thing.
    ok(page.bars.length === 4, 'bars did not arrive after the slow fetch');
    ok(!/Reading ESPN/.test(page.chartText), 'pending state left on screen');
  }

  if (scenario === 'reject') {
    ok(page.bars.length === 0, 'bars drawn from a failed fetch');
    ok(/refused the roster request/.test(page.chartText),
      `panel does not report the failure: "${page.chartText}"`);
    ok(page.rows.every((r) => r.cells[8] === '—'), 'Opp proj column not dashed after a failure');
    ok(page.rows.every((r) => r.dataV[8] === null),
      'a failed Opp proj cell carries data-v — it would sort as zero');
  }

  return p;
}

// ---------------------------------------------------------------- child mode

if (SCEN) {
  const problems = [];
  try {
    process.env.FF_SCEN = SCEN === 'demo' ? 'zero' : SCEN;
    const booted = await boot(SCEN);
    const page = readPage(booted.document);
    problems.push(...check(SCEN, page, booted));
    if (process.env.FF_DUMP) {
      process.stderr.write(`\n== ${SCEN} ==\nlabels: ${page.labels.join(' | ')}\n`);
      process.stderr.write(`row0:   ${page.rows[0]?.cells.join(' | ')}\n`);
      process.stderr.write(`bars:   ${page.bars.map((b) => `${b.rank} ${b.name} ${b.value} ${b.gap} ${b.width}%`).join('  //  ')}\n`);
      process.stderr.write(`note:   ${page.note}\n`);
      process.stderr.write(`chart:  ${page.chartText.slice(0, 200)}\n`);
      process.stderr.write(`status: ${page.status}\n`);
      process.stderr.write(`glance: ${page.glance}\n`);
      process.stderr.write(`calls:  ${(booted.stub ? booted.stub.calls : []).join(' | ')}\n`);
    }
  } catch (err) {
    problems.push(String((err && err.stack) || err));
  }
  console.log(JSON.stringify({ scenario: SCEN, ok: !problems.length, problems }));
  process.exit(problems.length ? 1 : 0);
}

// --------------------------------------------------------------- parent mode

const self = fileURLToPath(import.meta.url);
let failed = 0;
for (const scenario of ['demo', 'zero', 'mid', 'reject', 'slow', 'gap']) {
  const env = { ...process.env, FF_SCEN: scenario === 'demo' ? 'zero' : scenario };
  const res = spawnSync(process.execPath, [self, scenario], { encoding: 'utf8', env });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch { /* fall through */ }
  if (!parsed) {
    failed++;
    console.log(`FAIL ${scenario}  no result\n  ${(res.stderr || res.stdout || '').slice(0, 2000)}`);
  } else if (parsed.ok) {
    console.log(`PASS ${scenario}`);
    if (process.env.FF_DUMP) process.stderr.write(res.stderr || '');
  } else {
    failed++;
    console.log(`FAIL ${scenario}`);
    for (const problem of parsed.problems) console.log(`  - ${problem.slice(0, 800)}`);
    if (process.env.FF_DUMP) process.stderr.write(res.stderr || '');
  }
}
console.log(failed ? `\n${failed} scenario(s) failed` : '\nAll scenarios passed');
process.exit(failed ? 1 : 0);
