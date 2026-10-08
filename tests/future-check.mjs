// Boots the REAL stats.html + js/stats-page.js and checks the two boxes that
// sit beside Schedule luck (Tim, 2026-10-08):
//
//   ROSTER STRENGTH   "fix it so it matches our future avg proj like in the
//                      analysis section ... move it to the stats section right
//                      next to the schedule luck box"
//   FUTURE PROJ DIFF  "the avg proj difference between you and you're
//                      opponents as the proj stands right now"
//
// Two kinds of scenario.
//
//   ON PAPER — the four-team league of opp-season-stub.mjs, where a squad's
//   week is base + week (100/110/120/130) and every expected figure below is
//   worked by hand:  demo | zero | mid | gap | floor | reject
//
//   AGAINST ANALYSIS — stats.html and analysis.html each booted, in their own
//   process, on the SAME ten-squad league (future-stub-season.mjs: a real
//   lineup shape, a bye, a week ESPN sends no number for, a late signing), and
//   Stats' Roster strength held against the week totals Analysis prints under
//   "Weekly totals":  match | match-floor
//
//   node future-check.mjs                    -> all of them
//   node future-check.mjs <page> <scenario>  -> child mode (page: stats | analysis)
//
// Nothing here is written into the repo.

import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { REPO } from './repo.mjs';

const [PAGE, SCEN] = process.argv.slice(2);

// -------------------------------------------------------------- the harness

async function boot(page, scenario) {
  const html = readFileSync(path.join(REPO, `${page}.html`), 'utf8');
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
  Object.defineProperty(TableProto, 'rows', {
    configurable: true,
    get() {
      const head = kids(this, 'THEAD')[0];
      const rows = [];
      if (head) rows.push(...kids(head, 'TR'));
      for (const b of kids(this, 'TBODY')) rows.push(...kids(b, 'TR'));
      rows.push(...kids(this, 'TR'));
      return rows;
    },
  });
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  Object.defineProperty(RowProto, 'cells', {
    configurable: true,
    get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
  });

  if (!window.location) {
    window.location = {
      href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:',
      pathname: `/${page}.html`, search: '', hash: '',
    };
  }
  globalThis.location = window.location;
  if (!window.postMessage) window.postMessage = () => {};

  const store = new Map();
  if (scenario !== 'demo') {
    store.set('ff.connection', JSON.stringify({ leagueId: '112233', season: 2026, teamId: 2 }));
    store.set('ff.prefs', JSON.stringify({ 'stats.source': 'live', 'analysis.source': 'live' }));
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
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  window.localStorage = localStorage;
  window.ResizeObserver = globalThis.ResizeObserver;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;

  const errors = [];
  const orig = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); };
  const rejections = [];
  process.on('unhandledRejection', (e) => rejections.push(String(e && e.message || e)));

  // register() only affects imports made after it; the page is imported below.
  if (scenario !== 'demo') {
    const { register } = await import('node:module');
    register('./future-loader.mjs', import.meta.url);
  }

  await import(pathToFileURL(path.join(REPO, `js/${page}-page.js`)).href);
  if (page === 'stats') await import(pathToFileURL(path.join(REPO, 'js/connection.js')).href);
  await new Promise((r) => setTimeout(r, page === 'analysis' ? 1500 : 600));
  console.error = orig;

  return { document, errors, rejections, fetchCalls };
}

// ------------------------------------------------------------ reading the DOM

// The ▲/▼ of the shared red/green scale is a presentation mark (js/heat.js and
// test-heat own it); this suite is about the arithmetic. A typographic minus
// is read as a hyphen so a signed figure is one string either way.
const clean = (s) => (s || '').replace(/[▲▼]/g, '').replace(/−/g, '-').replace(/\s+/g, ' ').trim();

function readBox(document, ids) {
  const $ = (id) => document.getElementById(id);
  const panel = $(ids.panel);
  if (!panel) return null;
  const chart = $(ids.chart);
  const rows = Array.from(chart ? chart.querySelectorAll('.oppbars li') : []).map((li) => {
    const get = (cls) => clean(li.querySelector(cls)?.textContent);
    const record = get('.nm .rec');
    const vv = li.querySelector('.vv');
    let pop = null;
    if (vv) {
      vv.dispatchEvent(new document.defaultView.Event('mouseover', { bubbles: true }));
      const el = $('statCard');
      if (el && !el.hasAttribute('hidden')) {
        const cells = (sel) => Array.from(el.querySelectorAll(sel))
          .map((tr) => Array.from(tr.children).map((td) => clean(td.textContent)));
        pop = {
          head: clean(el.querySelector('.tc-ident')?.textContent),
          cols: cells('thead tr')[0] || [], body: cells('tbody tr'), foot: cells('tfoot tr'),
        };
      }
      vv.dispatchEvent(new document.defaultView.Event('mouseout', { bubbles: true }));
      if (pop) pop.shutAfter = $('statCard').hasAttribute('hidden');
    }
    return {
      rank: Number(get('.rk')),
      name: get('.nm').slice(0, get('.nm').length - record.length).trim(),
      record,
      text: get('.vv'),
      value: Number(get('.vv')),
      dataV: vv ? vv.getAttribute('data-v') : null,
      title: vv ? vv.getAttribute('title') : null,
      heat: (vv?.querySelector('span[class*="heat"]')?.getAttribute('class') || ''),
      width: Number(/width:([\d.]+)%/.exec(li.querySelector('.bar i')?.getAttribute('style') || '')?.[1]),
      me: (li.getAttribute('class') || '').split(/\s+/).includes('me'),
      pop,
    };
  });
  return {
    heading: clean(panel.querySelector('h2')?.textContent),
    rows,
    text: clean(chart?.textContent),
    key: clean($(ids.key)?.textContent),
    keyHidden: $(ids.key) ? $(ids.key).hasAttribute('hidden') : null,
    note: clean($(ids.note)?.textContent),
    parentClass: panel.parentElement?.getAttribute('class') || '',
  };
}

function readStats(document) {
  const $ = (id) => document.getElementById(id);
  const luck = Array.from(document.querySelectorAll('#oppProjChart .oppbars li')).map((li) => {
    const get = (cls) => clean(li.querySelector(cls)?.textContent);
    const record = get('.nm .rec');
    return { name: get('.nm').slice(0, get('.nm').length - record.length).trim(), value: Number(get('.vv')) };
  });
  const row = $('panelOppProj')?.parentElement;
  return {
    luckHeading: clean($('panelOppProj')?.querySelector('h2')?.textContent),
    luck,
    // The three boxes, in the order they sit in their row.
    rowIds: row ? Array.from(row.children).map((el) => el.getAttribute('id')) : [],
    rowClass: row ? row.getAttribute('class') || '' : '',
    strength: readBox(document, { panel: 'panelStrength', chart: 'strengthChart', key: 'strengthKey', note: 'strengthNote' }),
    diff: readBox(document, { panel: 'panelProjDiff', chart: 'projDiffChart', key: 'projDiffKey', note: 'projDiffNote' }),
  };
}

/** Analysis's "Weekly totals": every team's cell in every week column. */
function readAnalysis(document) {
  const t = document.getElementById('totalsTable');
  const heads = Array.from(t.querySelectorAll('thead tr:last-child th')).map((th) => clean(th.textContent));
  const rows = Array.from(t.querySelectorAll('tbody tr')).map((tr) => {
    const tds = Array.from(tr.children);
    const weeks = {};
    tds.forEach((td, i) => {
      const m = /^(?:Wk\s*)?(\d+)\b/.exec(heads[i] || '');
      if (i > 1 && m) weeks[m[1]] = { text: clean(td.textContent), hist: /\bhist\b/.test(td.getAttribute('class') || '') };
    });
    return { name: clean(tds[0].textContent), avg: clean(tds[1].textContent), weeks };
  });
  return { heads, rows };
}

// -------------------------------------------------------------------- checks

const r1 = (n) => Math.round(n * 10) / 10;
const signed = (n) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;

// Hand-computed on the four-team league. A squad's week is base + week, a
// floored week max(that, 115).
const PAPER = {
  // weeks 1–3:  T1 101/102/103 ... T4 131/132/133; opponents are opp-check's
  // EXPECT (122.0, 118.7, 115.3, 112.0).
  zero: {
    said: 'weeks 1–3',
    strength: [['Team 4', 132.0], ['Team 3', 122.0], ['Team 2', 112.0], ['Team 1', 102.0]],
    diff: [['Team 4', 20.0], ['Team 3', 6.7], ['Team 2', -6.7], ['Team 1', -20.0]],
  },
  // weeks 1–2 played: week 3 alone, 1 v 4 and 2 v 3.
  mid: {
    said: 'week 3',
    strength: [['Team 4', 133.0], ['Team 3', 123.0], ['Team 2', 113.0], ['Team 1', 103.0]],
    diff: [['Team 4', 30.0], ['Team 3', 10.0], ['Team 2', -10.0], ['Team 1', -30.0]],
  },
  // week 2's rosters never arrive: weeks 1 and 3 only, two games each.
  //   T1 (101+103)/2 = 102, opponents (111+133)/2 = 122   -> −20.0
  //   T2 (111+113)/2 = 112, opponents (101+123)/2 = 112   ->   0.0
  //   T3 (121+123)/2 = 122, opponents (131+113)/2 = 122   ->   0.0
  //   T4 (131+133)/2 = 132, opponents (121+103)/2 = 112   -> +20.0
  gap: {
    said: null,
    strength: [['Team 4', 132.0], ['Team 3', 122.0], ['Team 2', 112.0], ['Team 1', 102.0]],
    diff: [['Team 4', 20.0], ['Team 3', 0.0], ['Team 2', 0.0], ['Team 1', -20.0]],
    unordered: ['Team 2', 'Team 3'],
  },
  // week 3 with a QB floor of 115: T1 and T2 (103, 113) both count at 115.
  floor: {
    said: 'week 3',
    strength: [['Team 4', 133.0], ['Team 3', 123.0], ['Team 2', 115.0], ['Team 1', 115.0]],
    diff: [['Team 4', 18.0], ['Team 3', 8.0], ['Team 2', -8.0], ['Team 1', -18.0]],
    unordered: ['Team 1', 'Team 2'],
  },
};

function checkStats(scenario, page, booted) {
  const p = [];
  const ok = (cond, msg) => { if (!cond) p.push(msg); };

  if (booted.errors.length) p.push(`console.error: ${booted.errors[0]}`);
  if (booted.rejections.length) p.push(`unhandled rejection: ${booted.rejections[0]}`);
  if (booted.fetchCalls.length) p.push(`hit the network: ${booted.fetchCalls[0]}`);

  // --- both boxes exist, beside Schedule luck, every scenario ----------------
  ok(page.strength, 'no #panelStrength section on the Stats page');
  ok(page.diff, 'no #panelProjDiff section on the Stats page');
  if (!page.strength || !page.diff) return p;
  ok(page.rowIds.join(',') === 'panelOppProj,panelStrength,panelProjDiff',
    `the row beside Schedule luck holds: ${page.rowIds.join(', ')}`);
  ok(/\bpanel-row\b/.test(page.rowClass), `the three boxes are not in a panel-row: "${page.rowClass}"`);
  const boxes = [['Roster strength', page.strength], ['Future proj diff', page.diff]];

  if (scenario === 'demo') {
    // The demo season is over: nothing left to average, and each box says so.
    for (const [name, box] of boxes) {
      ok(box.heading === name, `demo heading is "${box.heading}", expected "${name}"`);
      ok(box.rows.length === 0, `${name}: ${box.rows.length} rows on a finished season`);
      ok(/No weeks left to play/.test(box.text), `${name} on a finished season says: "${box.text}"`);
      ok(box.keyHidden === true, `${name}: the colour key shows with nothing coloured`);
    }
    return p;
  }

  if (scenario === 'reject') {
    for (const [name, box] of boxes) {
      ok(box.rows.length === 0, `${name}: rows drawn from a failed roster read`);
      ok(/No projections to rank/.test(box.text), `${name} after a failed read says: "${box.text}"`);
    }
    return p;
  }

  const want = PAPER[scenario];
  for (const [name, box, key] of [[...boxes[0], 'strength'], [...boxes[1], 'diff']]) {
    const expected = want[key];
    ok(box.rows.length === 4, `${name}: ${box.rows.length} rows, expected 4`);
    if (box.rows.length !== 4) continue;

    // The figures, by team, worked on paper.
    const byName = Object.fromEntries(box.rows.map((r) => [r.name, r]));
    for (const [team, v] of expected) {
      const said = key === 'diff' ? signed(v) : v.toFixed(1);
      ok(byName[team] && byName[team].text === said,
        `${name}: ${team} reads "${byName[team] && byName[team].text}", on paper it is ${said}`);
      ok(byName[team] && Number(byName[team].dataV) === v, `${name}: ${team} data-v is ${byName[team] && byName[team].dataV}`);
    }
    // Best first, ranked 1..4.
    const values = box.rows.map((r) => r.value);
    ok(values.every((v, i) => i === 0 || values[i - 1] >= v), `${name} is not best-first: ${values.join(', ')}`);
    ok(box.rows.map((r) => r.rank).join(',') === '1,2,3,4', `${name}: ranks are ${box.rows.map((r) => r.rank).join(',')}`);
    const loose = new Set(want.unordered || []);
    box.rows.forEach((r, i) => {
      if (!loose.has(expected[i][0])) ok(r.name === expected[i][0], `${name}: row ${i + 1} is ${r.name}, expected ${expected[i][0]}`);
    });
    // A diff is signed and never a signed zero.
    if (key === 'diff') {
      ok(box.rows.every((r) => /^[+-]?\d+\.\d$/.test(r.text)), `${name} figures: ${box.rows.map((r) => r.text).join(' ')}`);
      ok(box.rows.every((r) => r.value <= 0 || r.text.startsWith('+')), `${name}: a positive gap has no plus`);
      ok(box.rows.every((r) => !/^[-+]0\.0$/.test(r.text)), `${name} prints a signed zero: ${box.rows.map((r) => r.text).join(' ')}`);
    }

    // The heading says which weeks; the key line is visible; my team is marked.
    if (want.said) ok(box.heading === `${name} (${want.said})`, `heading is "${box.heading}"`);
    ok(box.keyHidden === false && /Green is above the league, red below/.test(box.key), `${name}: key line is "${box.key}"`);
    ok(box.rows.filter((r) => r.me).map((r) => r.name).join(',') === 'Team 2', `${name}: my team (Team 2) is not the one marked`);
    // The house red→green scale: the top is tinted one way and the bottom the other.
    ok(/heat/.test(box.rows[0].heat) && /heat/.test(box.rows[3].heat) && box.rows[0].heat !== box.rows[3].heat,
      `${name}: top and bottom are not on the scale: "${box.rows[0].heat}" / "${box.rows[3].heat}"`);
    // The record sits by the name, as in the box beside it.
    ok(box.rows.every((r) => /^\d+–\d+/.test(r.record)), `${name}: records are ${box.rows.map((r) => r.record).join(' ')}`);
    // Bars run 8..100 between the worst and the best.
    ok(box.rows[0].width === 100 && box.rows[3].width === 8, `${name}: bar widths ${box.rows.map((r) => r.width).join(',')}`);
    // ONE preview per number: no browser tooltip beside the house one.
    ok(box.rows.every((r) => r.title === null), `${name}: a number carries a title as well as its preview`);

    // The preview behind every number adds up to that number.
    for (const r of box.rows) {
      const pop = r.pop;
      ok(pop, `${name}: ${r.name}'s number opens nothing`);
      if (!pop) continue;
      ok(pop.head.startsWith(`${r.name} ·`), `${name}: preview heading is "${pop.head}"`);
      ok(pop.shutAfter, `${name}: the preview stays open after the pointer leaves`);
      if (key === 'strength') {
        ok(pop.cols.join('|') === 'Wk|Proj', `strength preview columns: ${pop.cols.join('|')}`);
        const mean = r1(pop.body.reduce((a, row) => a + Number(row[1]), 0) / pop.body.length);
        ok(pop.body.length > 0 && mean === r.value, `${r.name}: preview weeks average ${mean}, the box says ${r.value}`);
        ok(pop.foot[0] && pop.foot[0][0] === 'Average' && pop.foot[0][1] === r.text, `${r.name}: Average row ${JSON.stringify(pop.foot[0])}`);
      } else {
        ok(pop.cols.join('|') === 'Wk|Opponent|Proj|Opp proj|Gap', `diff preview columns: ${pop.cols.join('|')}`);
        ok(pop.body.every((row) => /^Team \d$/.test(row[1]) && row[1] !== r.name), `${r.name}: opponents ${pop.body.map((row) => row[1]).join(',')}`);
        // Each row: yours − theirs = the gap, as printed.
        ok(pop.body.every((row) => signed(r1(Number(row[2]) - Number(row[3]))) === row[4]),
          `${r.name}: a preview row does not add up: ${JSON.stringify(pop.body)}`);
        const foot = pop.foot[0] || [];
        ok(foot[1] === 'Average' && foot[4] === r.text, `${r.name}: Average row ${JSON.stringify(foot)} against the box's ${r.text}`);
        ok(signed(r1(Number(foot[2]) - Number(foot[3]))) === foot[4], `${r.name}: the foot does not add up: ${JSON.stringify(foot)}`);
        const own = r1(pop.body.reduce((a, row) => a + Number(row[2]), 0) / pop.body.length);
        const opp = r1(pop.body.reduce((a, row) => a + Number(row[3]), 0) / pop.body.length);
        ok(Number(foot[2]) === own && Number(foot[3]) === opp, `${r.name}: foot ${foot[2]}/${foot[3]}, the rows average ${own}/${opp}`);
      }
    }
  }

  // THE THREE BOXES AGREE: with every squad playing every week left, a team's
  // diff is its Roster strength minus its Schedule luck figure, as printed.
  if (page.strength.rows.length === 4 && page.diff.rows.length === 4 && page.luck.length === 4) {
    for (const d of page.diff.rows) {
      const s = page.strength.rows.find((r) => r.name === d.name);
      const l = page.luck.find((r) => r.name === d.name);
      ok(s && l && r1(s.value - l.value) === d.value,
        `${d.name}: strength ${s && s.value} − opponents ${l && l.value} is not the diff ${d.value}`);
    }
  }
  ok(page.luckHeading.startsWith('Schedule luck'), `Schedule luck heading is "${page.luckHeading}"`);
  return p;
}

/**
 * Stats' Roster strength against Analysis's Weekly totals, one league, two
 * pages. Analysis prints no future-only average of its own (its Avg column
 * counts the played weeks at their real scores), so the comparison is the one
 * that can be made exactly: every week behind a Stats number is the cell
 * Analysis prints for that team and week, and the number is their mean.
 */
function checkMatch(stats, analysis) {
  const p = [];
  const ok = (cond, msg) => { if (!cond) p.push(msg); };
  ok(stats.strength, 'no #panelStrength section on the Stats page');
  if (!stats.strength) return { problems: p, compared: 0 };
  ok(stats.strength.rows.length === 10, `${stats.strength.rows.length} strength rows, expected 10`);
  ok(analysis.rows.length === 10, `${analysis.rows.length} Analysis rows, expected 10`);
  let compared = 0;
  const seen = new Set();
  for (const r of stats.strength.rows) {
    const a = analysis.rows.find((x) => x.name === r.name);
    ok(a, `Analysis has no row for ${r.name}`);
    ok(r.pop && r.pop.body.length > 0, `${r.name}: no weeks behind the Stats number`);
    if (!a || !r.pop) continue;
    const cells = [];
    for (const [week, total] of r.pop.body) {
      const cell = a.weeks[week];
      seen.add(week);
      ok(cell && cell.text === total, `${r.name} week ${week}: Stats ${total}, Analysis ${cell && cell.text}`);
      ok(cell && !cell.hist, `${r.name} week ${week}: Analysis shows it as a played week`);
      if (cell) { cells.push(Number(cell.text)); compared++; }
    }
    const mean = cells.length ? r1(cells.reduce((x, y) => x + y, 0) / cells.length) : null;
    ok(mean === r.value, `${r.name}: Stats says ${r.text}; Analysis's future weeks average ${mean}`);
  }
  // The fixture has to exercise what it claims to: the bye week (6) and the
  // week ESPN sent no number for (7) are both among the weeks left.
  ok(seen.has('6') && seen.has('7'), `the weeks compared (${[...seen].join(',')}) miss the bye and the gap`);
  return { problems: p, compared };
}

// ---------------------------------------------------------------- child mode

if (PAGE) {
  const out = { ok: true, problems: [], read: null };
  try {
    const booted = await boot(PAGE, SCEN);
    if (PAGE === 'analysis') {
      out.read = readAnalysis(booted.document);
      if (booted.errors.length) out.problems.push(`Analysis console.error: ${booted.errors[0]}`);
      if (booted.fetchCalls.length) out.problems.push(`Analysis hit the network: ${booted.fetchCalls[0]}`);
    } else {
      out.read = readStats(booted.document);
      if (SCEN.startsWith('match')) {
        if (booted.errors.length) out.problems.push(`Stats console.error: ${booted.errors[0]}`);
        if (booted.fetchCalls.length) out.problems.push(`Stats hit the network: ${booted.fetchCalls[0]}`);
      } else {
        out.problems.push(...checkStats(SCEN, out.read, booted));
      }
    }
  } catch (err) {
    out.problems.push(String((err && err.stack) || err));
  }
  out.ok = !out.problems.length;
  console.log(JSON.stringify(out));
  process.exit(0);
}

// --------------------------------------------------------------- parent mode

const self = fileURLToPath(import.meta.url);

function child(page, scenario, env) {
  const res = spawnSync(process.execPath, [self, page, scenario], {
    encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024,
  });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  try { return JSON.parse(line); } catch {
    return { ok: false, problems: [`no result from the ${page} page\n  ${(res.stderr || res.stdout || '').slice(0, 1500)}`], read: null };
  }
}

let failed = 0;
const report = (scenario, problems, extra = '') => {
  if (!problems.length) { console.log(`PASS ${scenario}${extra}`); return; }
  failed++;
  console.log(`FAIL ${scenario}`);
  for (const problem of problems.slice(0, 25)) console.log(`  - ${problem.slice(0, 800)}`);
  if (problems.length > 25) console.log(`  … and ${problems.length - 25} more`);
};

for (const scenario of ['demo', 'zero', 'mid', 'gap', 'floor', 'reject']) {
  const got = child('stats', scenario, {
    FF_SCEN: scenario === 'demo' ? 'zero' : scenario, FF_FUTURE_STUB: 'opp-season-stub.mjs',
  });
  if (process.env.FF_DUMP && got.read) {
    for (const k of ['strength', 'diff']) {
      const b = got.read[k];
      process.stderr.write(`${scenario} ${k}: ${b ? `${b.heading} :: ${b.rows.map((r) => `${r.name} ${r.text}`).join(' / ') || b.text}` : 'ABSENT'}\n`);
    }
  }
  report(scenario, got.problems);
}

// Four weeks played, so the weeks left (5–13) take in the stub's bye (week 6)
// and its week with no number (week 7). `match-floor` reads a waiver floor
// high enough to lift several slots, so the two pages must floor alike too.
for (const [scenario, floors] of [['match', ''], ['match-floor', '{"TE":18,"K":14,"WR":17.5}']]) {
  const env = { FF_FUTURE_STUB: 'future-stub-season.mjs', AN_SCHEDULE_PLAYED: '4', AN_FLOORS: floors };
  const stats = child('stats', scenario, env);
  const analysis = child('analysis', scenario, env);
  const problems = [...stats.problems, ...analysis.problems];
  let extra = '';
  if (stats.read && analysis.read) {
    const m = checkMatch(stats.read, analysis.read);
    problems.push(...m.problems);
    extra = `  (${m.compared} week totals equal on both pages)`;
    if (process.env.FF_DUMP) {
      process.stderr.write(`${scenario} analysis heads: ${analysis.read.heads.join(' | ')}\n`);
      process.stderr.write(`${scenario} analysis row0: ${JSON.stringify(analysis.read.rows[0])}\n`);
      process.stderr.write(`${scenario} stats: ${stats.read.strength ? stats.read.strength.rows.map((r) => `${r.name} ${r.text}`).join(' / ') : 'ABSENT'}\n`);
      process.stderr.write(`${scenario} stats pop0: ${JSON.stringify(stats.read.strength && stats.read.strength.rows[0] && stats.read.strength.rows[0].pop)}\n`);
    }
  }
  report(scenario, problems, extra);
}

console.log(failed ? `\n${failed} scenario(s) failed` : '\nAll scenarios passed');
process.exit(failed ? 1 : 0);
