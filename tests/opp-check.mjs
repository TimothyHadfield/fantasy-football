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

// The ▲/▼ at the end of the shared red/green scale (js/heat.js, 2026-09-19) is
// stripped here rather than asserted around: this suite is about the ARITHMETIC
// of the opponent projection, and the glyph is a presentation mark that
// js/heat.js and an-test/test-heat own between them. Without this, every cell
// at either end of the Opp proj scale reads "122.0 ▼" and fails a numeric test
// that is still perfectly correct.
const clean = (s) => (s || '').replace(/[▲▼]/g, '').replace(/\s+/g, ' ').trim();

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
    // The record sits by the name (Tim, 2026-10-05); read the two apart.
    const record = get('.nm .rec');
    return {
      rank: Number(get('.rk')),
      name: get('.nm').slice(0, get('.nm').length - record.length).trim(),
      record,
      value: Number(get('.vv')),
      gap: get('.dd'),
      width: Number(/width:([\d.]+)%/.exec(li.querySelector('.bar i')?.getAttribute('style') || '')?.[1] ?? 0),
      // Which side of the zero line the bar grows to: 'pos' (right, green),
      // 'neg' (left, red), or '' for a figure that prints as zero (no bar).
      side: (/\b(pos|neg)\b/.exec(li.querySelector('.bar i')?.getAttribute('class') || '') || [''])[0],
      zeroLine: !!li.querySelector('.bar.zero'),
      me: (li.getAttribute('class') || '').includes('me'),
    };
  });

  // The last figure opens the fixtures it is formed from (Tim, 2026-10-06).
  const firstGap = document.querySelector('#oppProjChart .oppbars li .dd[data-opp]');
  let pop = null;
  if (firstGap) {
    firstGap.dispatchEvent(new document.defaultView.Event('mouseover', { bubbles: true }));
    const el = $('statCard');
    if (el && !el.hasAttribute('hidden')) {
      const cells = (sel) => Array.from(el.querySelectorAll(sel))
        .map((tr) => Array.from(tr.children).map((td) => clean(td.textContent)));
      pop = { head: clean(el.querySelector('.tc-ident')?.textContent), body: cells('tbody tr'), foot: cells('tfoot tr') };
    }
    firstGap.dispatchEvent(new document.defaultView.Event('mouseout', { bubbles: true }));
    pop = pop && { ...pop, shutAfter: $('statCard').hasAttribute('hidden') };
  }

  return {
    labels, groupCols, rows, bars, pop,
    heading: clean($('panelOppProj').querySelector('h2').textContent),
    oppIndex: labels.indexOf('Opp proj'),
    chartText: clean($('oppProjChart').textContent),
    note: clean($('oppProjNote').textContent),
    status: clean($('sourceStatus').textContent),
    glance: clean($('glance').textContent),
    // The "Hardest schedule" tile on its own: its figure and the line under it.
    tile: clean(Array.from($('glance').children)
      .find((el) => clean(el.querySelector('.k')?.textContent) === 'Hardest schedule')
      ?.querySelector('.v')?.textContent),
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
    // REST OF SEASON (Tim, 2026-10-05): the demo season is over, so the chart
    // has no week left to draw and says so. The column is still the whole season.
    ok(page.bars.length === 0, `${page.bars.length} bars on a finished season, expected 0`);
    ok(/No weeks left to play/.test(page.chartText), `finished season chart says: "${page.chartText}"`);
    ok(page.badge === 'Demo', `badge is "${page.badge}"`);
    ok(page.heading === 'Schedule luck — rest of season', `heading is "${page.heading}"`);
    const col = page.rows.map((r) => r.cells[8]);
    ok(col.every((v) => /^\d+\.\d$/.test(v)), `Opp proj column not all numbers: ${col.join(',')}`);
    // No week left, so the tile has no rest of season to show: it falls back to
    // the whole season's hardest — the top of the Opp proj column — and says so.
    const hardest = Math.max(...col.map(Number)).toFixed(1);
    ok(page.tile.startsWith(`${hardest} `) && page.tile.endsWith('· whole season'),
      `finished season: the tile reads "${page.tile}", expected ${hardest} … · whole season`);
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

    // Hand-computed averages. The table cell is the whole season; the bars are
    // only the weeks still to play (Tim, 2026-10-05) — all three with nothing
    // played, and two weeks in just week 3: 1v4 and 2v3, so each bar is the
    // other side's week-3 projection.
    const REST = scenario === 'mid' ? { 1: 133.0, 2: 123.0, 3: 113.0, 4: 103.0 } : EXPECT;
    const REST_LEAGUE = scenario === 'mid' ? 118.0 : EXPECT_LEAGUE;
    for (const b of page.bars) {
      const id = Number(b.name.replace('Team ', ''));
      ok(Math.abs(b.value - REST[id]) < 0.05, `${b.name} bar shows ${b.value}, expected ${REST[id]}`);
    }
    // THE TILE IS THE CHART'S TOP ROW (2026-10-06): the hardest run still to
    // play, labelled, not the whole season's figure the column beside it keeps.
    // Two weeks in that is Team 1 at 133.0, where the whole season says 122.0.
    ok(page.tile === `${REST[1].toFixed(1)} Team 1 · rest of season`,
      `the Hardest schedule tile reads "${page.tile}", the chart's top row is ${REST[1].toFixed(1)} Team 1`);
    ok(Number(page.tile.split(' ')[0]) === page.bars[0].value,
      `tile ${page.tile.split(' ')[0]} against the chart's top bar ${page.bars[0].value}`);
    // No gap is ever a signed zero.
    ok(page.bars.every((b) => !/^[-+−]0\.0$/.test(b.gap)), `a gap prints a signed zero: ${page.bars.map((b) => b.gap).join(' ')}`);
    // The record sits by the name.
    const recs = page.bars.map((b) => b.record).join(' ');
    ok(recs === (scenario === 'mid' ? '0–2 1–1 1–1 2–0' : '0–0 0–0 0–0 0–0'), `records by the names: ${recs}`);
    for (const r of page.rows) {
      const id = Number(r.cells[0].replace('Team ', ''));
      ok(Math.abs(Number(r.cells[8]) - EXPECT[id]) < 0.05,
        `${r.cells[0]} Opp proj cell is ${r.cells[8]}, expected ${EXPECT[id]}`);
      ok(Math.abs(Number(r.dataV[8]) - EXPECT[id]) < 0.06,
        `${r.cells[0]} data-v is ${r.dataV[8]}`);
    }

    // The league average is the mean of the per-team averages, and the note says so.
    const mean = values.reduce((a, v) => a + v, 0) / values.length;
    ok(Math.abs(mean - REST_LEAGUE) < 0.05, `mean of bars is ${mean}, expected ${REST_LEAGUE}`);
    ok(page.note.includes(REST_LEAGUE.toFixed(1)), `note does not carry the league average: ${page.note}`);

    // Gaps from that average, and the sign convention: league minus team, so
    // the EASIEST run of opponents carries the plus (Tim, 2026-10-05).
    const gaps = page.bars.map((b) => b.gap);
    const g = scenario === 'mid' ? '15.0' : '5.0';
    ok(gaps[0] === `-${g}` && gaps[3] === `+${g}`, `gaps are ${gaps.join(' ')}`);

    // THE BARS RUN FROM A ZERO LINE DOWN THE MIDDLE (Tim, 2026-10-08): the
    // printed gap is the bar. A harder schedule than the league's is a minus —
    // left, red; an easier one a plus — right, green. One scale for the box:
    // the biggest gap fills its half of the track (50% of it), the rest in
    // proportion.
    const gapNum = page.bars.map((b) => Number(b.gap.replace('−', '-')));
    const gapMax = Math.max(...gapNum.map(Math.abs));
    ok(page.bars.every((b) => b.zeroLine), 'a bar track has no zero line');
    page.bars.forEach((b, i) => {
      const side = gapNum[i] > 0 ? 'pos' : gapNum[i] < 0 ? 'neg' : '';
      ok(b.side === side, `${b.name}: gap ${b.gap} draws "${b.side}", expected "${side}"`);
      const wide = 50 * Math.abs(gapNum[i]) / gapMax;
      ok(Math.abs(b.width - wide) < 0.06, `${b.name}: gap ${b.gap} is ${b.width}% wide, expected ${wide.toFixed(1)}%`);
    });
    ok(page.bars[0].side === 'neg' && page.bars[0].width === 50 && page.bars[3].side === 'pos' && page.bars[3].width === 50,
      `hardest and easiest: ${page.bars.map((b) => `${b.side}${b.width}`).join(',')} — should be neg50 … pos50`);

    // The owner's team (teamId 2 in the stub connection) is marked.
    ok(page.bars.some((b) => b.me && b.name === 'Team 2'), 'owner’s team not marked in the bars');
    ok(page.rows.some((r) => r.me && r.cells[0] === 'Team 2'), 'owner’s team not marked in the table');

    // The note has to say what it is, that it needs no games, and how many weeks.
    for (const phrase of ['rest of season only', 'best legal lineup', scenario === 'mid' ? 'week 3' : 'weeks 1–3', 'fixture']) {
      ok(page.note.toLowerCase().includes(phrase.toLowerCase()), `note is missing "${phrase}"`);
    }
    ok(page.badge === 'Live', `badge is "${page.badge}"`);
    ok(page.toggle === 'live', `source toggle is on "${page.toggle}"`);

    // LABELLED AS REST OF SEASON, WITH ITS WEEKS, and the last figure opens the
    // opponents it is formed from (Tim, 2026-10-06).
    const said = scenario === 'mid' ? 'week 3' : 'weeks 1–3';
    ok(page.heading === `Schedule luck — rest of season (${said})`, `heading is "${page.heading}"`);
    const pop = page.pop;
    ok(pop, 'hovering the last figure opens nothing');
    if (pop) {
      ok(pop.head === `Team 1 · ${said}`, `preview heading is "${pop.head}"`);
      ok(pop.body.length === (scenario === 'mid' ? 1 : 3), `${pop.body.length} fixtures in the preview`);
      ok(pop.body.every((r) => /^\d+$/.test(r[0]) && /^Team [234]$/.test(r[1]) && /^\d+\.\d$/.test(r[2])),
        `preview rows: ${JSON.stringify(pop.body)}`);
      const mean = pop.body.reduce((a, r) => a + Number(r[2]), 0) / pop.body.length;
      ok(Math.abs(mean - page.bars[0].value) < 0.06, `fixtures average ${mean}, the bar says ${page.bars[0].value}`);
      ok(pop.foot[0][1] === 'Average' && Math.abs(Number(pop.foot[0][2]) - page.bars[0].value) < 0.05,
        `Average row: ${JSON.stringify(pop.foot[0])}`);
      ok(pop.foot[1][1] === 'League average' && Math.abs(Number(pop.foot[1][2]) - REST_LEAGUE) < 0.05,
        `League row: ${JSON.stringify(pop.foot[1])}`);
      ok(pop.foot[2][1] === 'Gap' && pop.foot[2][2].replace('−', '-') === page.bars[0].gap.replace('−', '-'),
        `Gap row ${JSON.stringify(pop.foot[2])} against the figure ${page.bars[0].gap}`);
      ok(pop.shutAfter, 'the preview stays open after the pointer leaves');
    }
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

  if (scenario === 'zero' || scenario === 'mid') {
    // No floor was read, so the note must not claim one.
    ok(!/No slot is assessed below/.test(page.note), `note claims a floor nobody read: ${page.note}`);
  }

  if (scenario === 'floor') {
    // AUDIT §1.4: the wire is read ONCE, for week 3 — the first week still to
    // play — not week 1's wire for the rest of the season.
    const asked = calls.filter((c) => c.startsWith('fetchFloors:'));
    ok(asked.length === 1 && asked[0] === 'fetchFloors:3', `floor read for ${asked.join(', ') || 'no week'}, expected week 3`);

    // The numbers are the floored ones, worked on paper: every weekly total
    // is max(projection, QB floor for week 3 = 115.0).
    const F = boot.stub.qbFloor(3);
    const pr = (id, w) => Math.max(boot.stub.proj(id, w), F);
    const PAIRS = { 1: [[1, 2], [3, 4]], 2: [[1, 3], [2, 4]], 3: [[1, 4], [2, 3]] };
    const want = {};
    // Weeks 1–2 are played, so the chart is week 3 alone (rest of season).
    for (const id of [1, 2, 3, 4]) {
      const opp = [3].map((w) => {
        const [h, a] = PAIRS[w].find(([x, y]) => x === id || y === id);
        return pr(h === id ? a : h, w);
      });
      want[id] = opp.reduce((a, v) => a + v, 0) / opp.length;
    }
    ok(Math.abs(want[3] - 113.0) > 1, `the floor does not move Team 2 by 3 points — the check would be vacuous`);
    for (const b of page.bars) {
      const id = Number(b.name.replace('Team ', ''));
      ok(Math.abs(b.value - want[id]) < 0.05, `${b.name} bar shows ${b.value}, floored on week 3 it is ${want[id].toFixed(1)}`);
    }

    // Rule 7 (AUDIT §1.5): the note says so, with the number and the week.
    ok(/No slot is assessed below what the waiver wire would give you/.test(page.note),
      `note does not state the floor: ${page.note}`);
    ok(page.note.includes(`QB ${F.toFixed(1)}`) && page.note.includes('in week 3'),
      `note does not give the floor and its week: ${page.note}`);
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
for (const scenario of ['demo', 'zero', 'mid', 'reject', 'slow', 'gap', 'floor']) {
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
