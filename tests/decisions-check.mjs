// THE DECISIONS REVIEW PAGE — decisions.html, booted headlessly on the stub
// league and worked the way a reader works it.
//
//   node decisions-check.mjs            every scenario (one child each)
//   node decisions-check.mjs --dump X   print child X's raw facts
//
// Tim, 2026-10-05: "have a list of all the decisions they've made, and what
// would have happened if they hadn't made that that decision ... the biggest
// thing I want to see is the act weekly total for that team each previous week,
// whether that would have changed the outcome of a matchup, and how much it
// would have changed the overall record."
//
// The league is tests/cap-stub-season.mjs's `fetchDecisionWorld` (three decided
// weeks, ten squads, DECISION_CASES). The numbers asserted are worked by hand
// from that world and written here as literals — the engine has its own suite
// (test-decisions.mjs); this one is about what the PAGE shows:
//
//   squad 1, the add+drop undone:  wk 1 114.9 -> 114.9, wk 2 111.1 -> 111.5,
//     wk 3 117.3 -> 115.5 (−1.4 in all); week 2's 111.1–111.1 tie with squad 2
//     becomes a win, so 1-1-1 reads 2-1.
//   squad 2, its add undone: the man never started, so nothing changes.
//   squad 3, its drop undone: squad 4's week-3 pickup of that man could not
//     have happened.
//
// THE WEEK IN PLAY (Tim, 2026-10-05: "Could you just display everything you're
// able to, like we do across the rest of the cite?") is the `early` child, on
// the stub's CAP_EARLY=1: week 4, squad 1 v squad 4 over (squad 1 lost it 118.3, a
// fourth result for each) and the other four matchups still being played.
//
// Tim again, 2026-10-05: "just show what you have right now, so if my bench QB
// scored 8 more than my starter, then my dif should show +8 ... just put a
// little "live" sign by the week number". That is the `bench` child
// (CAP_BENCH_QB=1: squad 1's bench QB finished 8.0 ahead of its starter, one
// bench man still to play), and `bench-all` is the same with nobody left to
// play — the same +8.0 and no live tag.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { bootDom, waitFor } from './cap-harness.mjs';
import { emit } from './emit.mjs';

const self = fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const html = (page) => readFileSync(path.join(REPO, page), 'utf8');
const CONN = { leagueId: '99', season: 2026, teamId: 1 };

function trapErrors() {
  const errors = [];
  console.error = (...a) => { errors.push(a.join(' ')); };
  process.on('unhandledRejection', (r) => errors.push(`unhandled: ${String((r && r.stack) || r)}`));
  return errors;
}

// ------------------------------------------------------------------ children

/** Boot decisions.html on the stub and hand back what a scenario drives it with. */
async function bootPage(prefs = {}) {
  const errors = trapErrors();
  const { document, window, map } = bootDom({
    html: html('decisions.html'),
    store: { 'ff.prefs': { 'decisions.source': 'live', ...prefs }, 'ff.connection': CONN },
  });
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
  await import(moduleUrl('js/decisions-page.js'));
  await import(moduleUrl('js/connection.js'));

  const $ = (id) => document.getElementById(id);
  const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));
  const click = (el) => fire(el, 'click');
  const choose = (el, value) => { el.value = String(value); fire(el, 'change'); };
  // FINISHED means: the world is on the page, nothing says it is still working,
  // and no percentage is still an ellipsis. Never a fixed sleep.
  const settle = async () => {
    await sleep(30);
    const done = await waitFor(() => $('modeBadge').className.includes('live') &&
      document.querySelector('.dz-row') &&
      !document.querySelector('.searching') &&
      !/…/.test(text($('summaryCur')) + text($('summaryHyp'))), 60000);
    await sleep(30);
    return Boolean(done);
  };
  const row = (id) => [...document.querySelectorAll('.dz-row')].find((b) => b.dataset.id === id) || null;
  const pick = async (id) => { click(row(id)); return settle(); };
  const view = async (box, v) => {
    click(document.querySelector(`#${box}Switch button[data-sbw-view="${v}"]`));
    return settle();
  };

  const cells = (tr) => [...tr.children].map(text);
  const tableRows = (id) => [...document.querySelectorAll(`#${id} tbody tr`)].map(cells);
  const dimmed = (id) => [...document.querySelectorAll(`#${id} td`)]
    .map((td) => (td.getAttribute('style') || '').match(/opacity:\s*([\d.]+)/))
    .filter(Boolean).map((m) => Number(m[1]));
  const snap = () => ({
    team: $('teamSelect').value,
    badge: text($('modeBadge')),
    list: [...document.querySelectorAll('.dz-row')].map((b) => ({
      id: b.dataset.id, t: text(b), selected: b.getAttribute('aria-selected') === 'true',
      empty: b.dataset.empty === '1',
    })),
    groups: [...document.querySelectorAll('.dz-group')].map(text),
    lede: text($('resultLede')),
    total: cells(document.querySelector('#weekTable tbody.dz-total tr') || { children: [] }),
    stats: Object.fromEntries([...document.querySelectorAll('#resultStats .v')].map((v) => [v.dataset.stat, text(v)])),
    weeks: [...document.querySelectorAll('#weekTable tbody tr[data-wk]')].map((tr) => ({
      c: cells(tr), flip: tr.getAttribute('data-flip') === '1',
    })),
    sub: text($('pageSub')),
    views: Object.fromEntries(['season', 'standings', 'summary'].map((box) => [box, {
      on: text(document.querySelector(`#${box}Switch button.on`)),
      diff: document.querySelector(`#${box}Hyp table`)?.getAttribute('data-view') === 'diff',
    }])),
    season: {
      cur: cells(document.querySelector('#seasonCur tbody.split tr') || { children: [] }),
      hyp: cells(document.querySelector('#seasonHyp tbody.split tr') || { children: [] }),
      body: tableRows('seasonHyp'),
      curBody: tableRows('seasonCur'),
      vals: [...document.querySelectorAll('#seasonHyp td[data-v]')].map((td) => Number(td.getAttribute('data-v'))),
      teamRowHidden: $('seasonTeamRow').hasAttribute('hidden'),
      teams: [...$('seasonTeam').querySelectorAll('option')].map(text),
    },
    standings: { cur: tableRows('standingsCur'), hyp: tableRows('standingsHyp') },
    summary: { cur: tableRows('summaryCur'), hyp: tableRows('summaryHyp'), status: text($('oddsStatus')) },
    notes: { hidden: $('panelNotes').hasAttribute('hidden'), t: text($('mirrorNotes')) },
    dim: {
      weeks: dimmed('weekTable'), season: dimmed('seasonHyp'),
      standings: dimmed('standingsHyp'), summary: dimmed('summaryHyp'),
      current: [...dimmed('seasonCur'), ...dimmed('standingsCur'), ...dimmed('summaryCur')],
    },
    // Where the small LIVE tag is, and which lineup cells are a projection.
    tags: {
      weeks: [...document.querySelectorAll('#weekTable tbody tr[data-wk]')]
        .filter((tr) => tr.children[0].querySelector('.wk-live')).map((tr) => tr.getAttribute('data-wk')),
      list: [...document.querySelectorAll('.dz-row')].filter((b) => b.querySelector('.wk-live')).map((b) => b.dataset.id),
      season: ['seasonCur', 'seasonHyp'].map((id) => [...document.querySelectorAll(`#${id} thead th`)]
        .filter((th) => th.querySelector('.wk-live')).map(text)),
      proj: ['seasonCur', 'seasonHyp'].map((id) => [...document.querySelectorAll(`#${id} td.sbw-proj`)].map(text)),
      all: document.querySelectorAll('.wk-live').length,
    },
    noiseOn: Boolean($('noiseSwitch').checked),
    sims: (globalThis.__simCalls || []).length,
  });
  return { document, window, map, $, fire, click, choose, settle, row, pick, view, snap, errors };
}

const CHILDREN = {
  /** One reader, start to finish: every step's facts, in order. */
  async page() {
    const p = await bootPage();
    const out = { settled: await p.settle() };
    out.status = text(p.$('sourceStatus'));
    out.switch = {
      type: p.$('noiseSwitch').getAttribute('type'), role: p.$('noiseSwitch').getAttribute('role'),
      label: text(p.$('noiseSwitch').closest('label')),
    };
    out.start = p.snap();
    out.firstSim = (globalThis.__simCalls || [])[0] || null;

    // The three switches, one at a time, on the add+drop.
    await p.pick('move:mv-adddrop');
    out.addDrop = p.snap();
    for (const box of ['season', 'standings', 'summary']) await p.view(box, 'diff');
    out.addDropDiff = p.snap();

    // Noise: on, then off again.
    p.$('noiseSwitch').checked = true;
    p.fire(p.$('noiseSwitch'), 'change');
    await p.settle();
    out.noiseOn = p.snap();
    out.noisePref = JSON.parse(p.map.get('ff.prefs'))['decisions.noise'];
    p.$('noiseSwitch').checked = false;
    p.fire(p.$('noiseSwitch'), 'change');
    await p.settle();
    out.noiseOff = p.snap();

    // Squad 2: its add of a man who never started changes nothing.
    p.choose(p.$('teamSelect'), 2);
    await p.settle();
    out.team2 = p.snap();
    await p.pick('move:mv-add');
    out.empty = p.snap();
    for (const box of ['season', 'standings', 'summary']) await p.view(box, 'total');
    out.emptyTotal = p.snap();

    // Squad 3: undoing its drop means squad 4's pickup could not have happened.
    p.choose(p.$('teamSelect'), 3);
    await p.settle();
    await p.pick('move:mv-drop');
    out.skipped = p.snap();

    // Back to squad 1, and a trade as if accepted: its QB for squad 9's, from week 2.
    p.choose(p.$('teamSelect'), 1);
    await p.settle();
    for (const box of ['season', 'standings', 'summary']) await p.view(box, 'diff');
    p.choose(p.$('wiWeek'), 2);
    p.choose(p.$('wiTeam'), 9);
    out.formBefore = {
      disabled: p.$('wiAdd').disabled === true || p.$('wiAdd').hasAttribute('disabled'),
      give: [...p.$('wiGive').querySelectorAll('option')].length,
      get: [...p.$('wiGet').querySelectorAll('option')].length,
      labels: [text(p.$('wiGiveLabel')), text(p.$('wiGetLabel'))],
    };
    p.choose(p.$('wiGive'), 100);
    p.choose(p.$('wiGet'), 900);
    out.formReady = {
      disabled: p.$('wiAdd').disabled === true || p.$('wiAdd').hasAttribute('disabled'),
      chips: [...p.document.querySelectorAll('.dz-chip')].map(text),
    };
    p.fire(p.$('whatIfForm'), 'submit');
    await p.settle();
    out.whatIf = p.snap();
    out.prefs = JSON.parse(p.map.get('ff.prefs'));
    out.errors = p.errors;
    return out;
  },

  /**
   * THE WEEK IN PLAY (CAP_EARLY=1): week 4, squad 1 v squad 4 over and the other
   * four matchups still being played. One reader again.
   */
  async early() {
    const p = await bootPage();
    const out = { settled: await p.settle() };
    out.status = text(p.$('sourceStatus'));
    out.start = p.snap();
    await p.pick('move:mv-adddrop');
    out.addDrop = p.snap();
    // A trade as if accepted in week 4: squad 1 would start squad 9's QB, who is
    // still playing — so its finished matchup is not a result in that world.
    p.choose(p.$('wiWeek'), 4);
    p.choose(p.$('wiTeam'), 9);
    p.choose(p.$('wiGive'), 100);
    p.choose(p.$('wiGet'), 900);
    p.fire(p.$('whatIfForm'), 'submit');
    await p.settle();
    out.whatIf = p.snap();

    // Squad 5's own matchup is still being played.
    p.choose(p.$('teamSelect'), 5);
    await p.settle();
    await p.pick('move:mv-trade');
    out.team5 = p.snap();

    // Squad 2's add of a man who never started: nothing changes, anywhere.
    p.choose(p.$('teamSelect'), 2);
    await p.settle();
    await p.pick('move:mv-add');
    for (const box of ['season', 'standings', 'summary']) await p.view(box, 'diff');
    out.empty = p.snap();
    out.errors = p.errors;
    return out;
  },

  /**
   * TIM'S OWN CASE (CAP_EARLY=1 + CAP_BENCH_QB): squad 1's matchup is over and
   * its bench QB scored 8 more than its starter. Perfect hindsight for week 4,
   * its Season by week as a difference, then the whole-season entry.
   */
  async bench() {
    const p = await bootPage();
    const out = { settled: await p.settle() };
    out.start = p.snap();
    out.offered = Boolean(p.row('lineup-perfect:1:4'));
    if (out.offered) {
      await p.pick('lineup-perfect:1:4');
      out.hindsight = p.snap();
      await p.view('season', 'diff');
      out.diff = p.snap();
      await p.view('season', 'total');
      await p.pick('lineup-perfect:1:all');
      out.all = p.snap();
    }
    out.errors = p.errors;
    return out;
  },

  /** A fresh page on the prefs the first one left: the what-if is still there. */
  async reload() {
    const p = await bootPage(JSON.parse(process.env.DZ_PREFS || '{}'));
    const out = { settled: await p.settle() };
    out.start = p.snap();
    const x = p.document.querySelector('.dz-x');
    out.hadRemove = Boolean(x);
    if (x) { p.click(x); await p.settle(); }
    out.after = p.snap();
    out.prefs = JSON.parse(p.map.get('ff.prefs'));
    out.errors = p.errors;
    return out;
  },

  /** The other squad in the what-if sees the same trade in its own list. */
  async other() {
    const p = await bootPage({
      ...JSON.parse(process.env.DZ_PREFS || '{}'), 'decisions.team.99-2026': 9, 'decisions.noise': true,
    });
    const out = { settled: await p.settle() };
    out.start = p.snap();
    out.errors = p.errors;
    return out;
  },

  /** The Summary page on the same league, for its chart and its simulation. */
  async summary() {
    const errors = trapErrors();
    const { document } = bootDom({
      html: html('summary.html'),
      store: { 'ff.prefs': { 'summary.source': 'live' }, 'ff.connection': CONN },
    });
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
    await import(moduleUrl('js/summary-page.js'));
    await import(moduleUrl('js/connection.js'));
    await waitFor(() => /simulated seasons/.test(text(document.getElementById('simStatus'))), 60000);
    await sleep(100);
    return {
      rows: [...document.querySelectorAll('#summaryTable tbody tr')].map((tr) => [...tr.children].map(text)),
      call: (globalThis.__simCalls || []).slice(-1)[0] || null,
      errors,
    };
  },

  /** The world cannot be read (DZ env: CAP_WORLD_FAIL, with or without CAP_CLOUD). */
  async failed() {
    const p = await bootPage();
    await waitFor(() => p.$('modeBadge').className.includes('demo') && p.document.querySelector('.dz-row'), 30000);
    await sleep(50);
    return {
      status: text(p.$('sourceStatus')), badge: text(p.$('modeBadge')),
      rows: p.document.querySelectorAll('.dz-row').length, errors: p.errors,
    };
  },

  /** Nothing decided yet: no week to replay. */
  async unplayed() {
    const p = await bootPage();
    await waitFor(() => p.$('modeBadge').className.includes('live'), 30000);
    await sleep(100);
    return {
      status: text(p.$('sourceStatus')),
      hidden: ['main', 'panelSeason', 'panelStandings', 'panelSummary', 'panelNotes']
        .map((id) => p.$(id).hasAttribute('hidden')),
      errors: p.errors,
    };
  },
};

if (CHILDREN[process.argv[2]]) {
  try {
    emit(await CHILDREN[process.argv[2]](), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

const RUNS = {
  page: { child: 'page', env: {} },
  reload: { child: 'reload', env: {} },
  other: { child: 'other', env: {} },
  summary: { child: 'summary', env: {} },
  failed: { child: 'failed', env: { CAP_WORLD_FAIL: '1' } },
  'failed-cloud': { child: 'failed', env: { CAP_WORLD_FAIL: '1', CAP_CLOUD: '1' } },
  unplayed: { child: 'unplayed', env: { CAP_DECIDED: '0' } },
  early: { child: 'early', env: { CAP_EARLY: '1' } },
  'summary-early': { child: 'summary', env: { CAP_EARLY: '1' } },
  bench: { child: 'bench', env: { CAP_EARLY: '1', CAP_BENCH_QB: '1' } },
  'bench-all': { child: 'bench', env: { CAP_EARLY: '1', CAP_BENCH_QB: 'all' } },
};

function child(name, extra = {}) {
  const cfg = RUNS[name];
  const env = { ...process.env };
  for (const k of ['CAP_EARLY', 'CAP_BENCH_QB', 'CAP_DECIDED', 'CAP_WIRE', 'CAP_CLOUD', 'CAP_WORLD_FAIL', 'DZ_PREFS', 'FF_SCEN']) delete env[k];
  Object.assign(env, cfg.env, extra);
  const res = spawnSync(process.execPath, ['--import', './cap-register.mjs', self, cfg.child], {
    encoding: 'utf8', cwd: path.dirname(self), maxBuffer: 64 * 1024 * 1024, timeout: 240000, env,
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) return { boot: `no result\n${(res.stdout || '').slice(0, 1500)}\n${(res.stderr || '').slice(0, 2500)}` };
  return JSON.parse(line.slice(2));
}

if (process.argv[2] === '--dump') {
  const got = child(process.argv[3]);
  const keys = process.argv.slice(4);
  console.log(JSON.stringify(keys.length ? Object.fromEntries(keys.map((k) => [k, got[k]])) : got, null, 1));
  process.exit(0);
}

// -------------------------------------------------------------------- parent

let pass = 0;
const fails = [];
let where = 'page';
// A page so broken that a fact is missing altogether still ends in a FAIL line
// and a count, never in a bare stack trace.
process.on('uncaughtException', (err) => {
  for (const f of fails) console.log('FAIL ' + f);
  console.log(`FAIL [${where}] a fact the page should show is missing — ${String((err && err.stack) || err).slice(0, 400)}`);
  console.log(`${pass} passed, ${fails.length + 1} failed`);
  process.exit(1);
});
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`[${where}] ${name}${detail !== '' ? ` — ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700)}` : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const booted = (got, name) => {
  where = name;
  ok('the page boots and settles', !got.boot && got.settled !== false, got.boot || 'never settled');
  if (!got.boot) ok('no console errors', (got.errors || []).length === 0, got.errors);
  return !got.boot;
};
/** A printed number, minus sign and all: "−1.4" -> -1.4. Null for a dash. */
const num = (s) => {
  const m = String(s).replace('−', '-').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
/** Every cell of a difference table after the name: is each one zero or a dash? */
const allZero = (rows) => rows.length > 0 && rows.every((r) => r.slice(1).every((c) => c === '—' || num(c) === 0));
const rowOf = (rows, name) => rows.find((r) => r[0] === name) || [];

const page = child('page');
if (booted(page, 'page')) {
  // ---- the top of the page
  ok('the league loaded and says so', /3 finished weeks, 5 moves/.test(page.status), page.status);
  ok('the saved "my team" is the one picked', page.start.team === '1' && page.start.badge === 'Live', page.start.team);
  ok('Display noise is a real switch, labelled', same(page.switch, { type: 'checkbox', role: 'switch', label: 'Display noise' }), page.switch);
  ok('and it is OFF by default', page.start.noiseOn === false);

  // ---- the list
  const ids = page.start.list.map((r) => r.id);
  ok('the list is squad 1’s decisions: its add+drop, then the lineups, season first',
    same(ids, ['move:mv-adddrop', 'lineup-reasonable:1:all', 'lineup-perfect:1:all',
      'lineup-reasonable:1:1', 'lineup-perfect:1:1', 'lineup-reasonable:1:2', 'lineup-perfect:1:2',
      'lineup-reasonable:1:3', 'lineup-perfect:1:3']), ids);
  ok('grouped as Moves and Lineups', same(page.start.groups, ['Moves', 'Lineups']), page.start.groups);
  const first = page.start.list[0];
  ok('the add+drop row reads week, what, record change, points change',
    first.t === 'Wk 2Added Free Agent WR, dropped Manager 1 WR11+1 W−1.4', first.t);
  ok('a lineup row says which lineup, with its numbers',
    rowOf(page.start.list.map((r) => [r.id, r.t]), 'lineup-perfect:1:all')[1] === 'AllLineup: perfect hindsight+1 W+33.9',
    page.start.list.map((r) => r.t));
  ok('the first decision that changes something is picked', first.selected && page.start.list.filter((r) => r.selected).length === 1);

  // ---- the biggest thing
  const wk = page.addDrop.weeks;
  ok('one row a finished week: actual, hypothetical, difference, result',
    same(wk.map((w) => w.c), [
      ['1', 'Manager 10', '114.9', '114.9', '0.0', 'W'],
      ['2', 'Manager 2', '111.1', '111.5', '+0.4', 'T → W'],
      ['3', 'Manager 3', '117.3', '115.5', '−1.8', 'L'],
    ]), wk.map((w) => w.c));
  ok('and the season under them', same(page.addDrop.total, ['Total', '343.3', '341.9', '−1.4', '+1 W']), page.addDrop.total);
  ok('only the flipped matchup is marked', same(wk.map((w) => w.flip), [false, true, false]), wk.map((w) => w.flip));
  ok('the record in each world, and the points', same(page.addDrop.stats, { real: '1-1-1', mirror: '2-1', points: '−1.4' }), page.addDrop.stats);
  ok('the lede names the decision', /^Undone: Added Free Agent WR, dropped Manager 1 WR11 \(week 2\)\.$/.test(page.addDrop.lede), page.addDrop.lede);

  // ---- the three charts: hypothetical, then difference
  const a = page.addDrop;
  const d = page.addDropDiff;
  ok('each chart opens on Hypothetical', Object.values(a.views).every((v) => v.on === 'Hypothetical' && !v.diff), a.views);
  ok('and each switch turns it into Difference', Object.values(d.views).every((v) => v.on === 'Difference' && v.diff), d.views);
  ok('season by week: current totals, hypothetical totals', same(a.season.cur, ['Total', '114.9', '111.1', '117.3']) &&
    same(a.season.hyp, ['Total', '114.9', '111.5', '115.5']), [a.season.cur, a.season.hyp]);
  ok('season by week, difference: the totals’ differences', same(d.season.hyp, ['Total', '0.0', '+0.4', '−1.8']), d.season.hyp);
  ok('standings: squad 1 is 1–1–1 beside 2–1', rowOf(a.standings.cur, 'Manager 1')[1] === '1–1–1' &&
    rowOf(a.standings.hyp, 'Manager 1')[1] === '2–1', [rowOf(a.standings.cur, 'Manager 1'), rowOf(a.standings.hyp, 'Manager 1')]);
  ok('standings, difference: +1 W for squad 1, and its total −1.4',
    rowOf(d.standings.hyp, 'Manager 1')[1] === '+1 W' && rowOf(d.standings.hyp, 'Manager 1')[4] === '−1.4', rowOf(d.standings.hyp, 'Manager 1'));
  ok('standings, difference: squad 2 lost the tie it had', rowOf(d.standings.hyp, 'Manager 2')[1] === '−1 T' || /L/.test(rowOf(d.standings.hyp, 'Manager 2')[1]), rowOf(d.standings.hyp, 'Manager 2'));
  ok('both standings are in the same order', same(a.standings.cur.map((r) => r[0]), a.standings.hyp.map((r) => r[0])));
  ok('the chart: squad 1’s record in each world', rowOf(a.summary.cur, 'Manager 1')[1] === '1-1-1' && rowOf(a.summary.hyp, 'Manager 1')[1] === '2-1',
    [rowOf(a.summary.cur, 'Manager 1'), rowOf(a.summary.hyp, 'Manager 1')]);
  ok('the chart: every title and loser chance is a percentage in both worlds',
    [...a.summary.cur, ...a.summary.hyp].length === 20 && [...a.summary.cur, ...a.summary.hyp].every((r) => /%( [▲▼])?$/.test(r[3]) && /%( [▲▼])?$/.test(r[4])),
    a.summary.hyp);
  ok('the chart, difference: +1 W, and the two chances as signed points',
    rowOf(d.summary.hyp, 'Manager 1')[1] === '+1 W' && d.summary.hyp.every((r) => /^[+−]?\d+\.\d%$/.test(r[3]) && /^[+−]?\d+\.\d%$/.test(r[4])),
    d.summary.hyp);
  ok('a win in hand moves squad 1’s title chance up', num(rowOf(d.summary.hyp, 'Manager 1')[3]) > 0, rowOf(d.summary.hyp, 'Manager 1'));
  ok('the chart’s two tables are in the same order', same(a.summary.cur.map((r) => r[0]), a.summary.hyp.map((r) => r[0])));
  ok('nothing could not have happened, so no notes panel', a.notes.hidden && a.notes.t === '', a.notes);

  // ---- noise
  ok('noise off: nothing anywhere is dimmed', Object.values(d.dim).every((list) => list.length === 0), d.dim);
  const n = page.noiseOn;
  ok('noise on: week 3 of the weekly totals is dimmed (0.1 noise = opacity 0.935), weeks 1 and 2 are not',
    same(n.dim.weeks, [0.935, 0.935, 0.935]), n.dim.weeks);
  ok('noise on: the hypothetical season dims week 3’s column only',
    n.dim.season.length === n.season.body.length && n.dim.season.every((o) => o === 0.935), n.dim.season);
  ok('noise on: the standings and the chart dim the touched squad’s row',
    n.dim.standings.length >= 17 && n.dim.summary.length >= 4 && [...n.dim.standings, ...n.dim.summary].every((o) => o > 0 && o < 1),
    [n.dim.standings.length, n.dim.summary.length]);
  ok('noise on: the CURRENT halves are never dimmed', n.dim.current.length === 0, n.dim.current);
  ok('the switch is remembered', n.noiseOn === true && page.noisePref === true, page.noisePref);
  ok('noise off again: no opacity left anywhere', Object.values(page.noiseOff.dim).every((list) => list.length === 0), page.noiseOff.dim);

  // ---- an empty decision
  const e = page.empty;
  ok('picking another squad lists ITS decisions', page.team2.list[0].id === 'move:mv-add' && page.team2.list.every((r) => /^move:mv-add$|:2:/.test(r.id)),
    page.team2.list.map((r) => r.id));
  ok('an empty decision reads "No change" in the list', rowOf(e.list.map((r) => [r.id, r.t, r.empty]), 'move:mv-add')[1] === 'Wk 2Added Free Agent RBNo change',
    e.list[0]);
  ok('and is not the one picked by default', page.team2.list[0].selected === false && page.team2.list.some((r) => r.selected));
  ok('picked, its weekly differences are all zero and nothing flips',
    e.weeks.length === 3 && e.weeks.every((w) => w.c[2] === w.c[3] && w.c[4] === '0.0' && !w.flip), e.weeks.map((w) => w.c));
  ok('its record is the same in both worlds', e.stats.real === '0-2-1' && e.stats.mirror === '0-2-1' && e.stats.points === '0.0', e.stats);
  ok('season by week, difference: every cell zero', e.season.vals.length === 33 && e.season.vals.every((v) => v === 0) && same(e.season.hyp, ['Total', '0.0', '0.0', '0.0']), e.season.vals);
  ok('standings, difference: every cell zero', allZero(e.standings.hyp), e.standings.hyp.find((r) => !allZero([r])));
  ok('the chart, difference: every cell zero — the same simulation, not a second roll',
    allZero(e.summary.hyp) && e.summary.hyp.every((r) => r[3] === '0.0%' && r[4] === '0.0%'), e.summary.hyp);
  ok('and it cost no simulation: the mirror’s season is the real one', e.sims === page.team2.sims, [page.team2.sims, e.sims]);
  ok('switched back, the hypothetical chart IS the current one', same(page.emptyTotal.summary.hyp, page.emptyTotal.summary.cur) &&
    same(page.emptyTotal.standings.hyp, page.emptyTotal.standings.cur), page.emptyTotal.summary.hyp);

  // ---- a move that could not have happened
  const s = page.skipped;
  ok('the skipped move is said under the charts, naming the man and why',
    !s.notes.hidden && s.notes.t === 'Could not have happened: Manager 4 added Manager 3 QB12 (week 3). ' +
      'Manager 3 QB12 was not free (Manager 3 still had him).', s.notes);
  ok('a second squad’s lineup changed, so "Lineup of" offers it', !s.season.teamRowHidden && same(s.season.teams, ['Manager 3', 'Manager 4']), s.season.teams);
  ok('with one squad changed there is no such select', a.season.teamRowHidden === true);

  // ---- a trade as if accepted
  const w = page.whatIf;
  ok('the form offers each side’s week-2 roster and waits for both sides',
    page.formBefore.disabled && page.formBefore.give === 15 && page.formBefore.get === 15 &&
    same(page.formBefore.labels, ['Manager 1 gives', 'Manager 9 gives']), page.formBefore);
  ok('with a man on each side it can be added', !page.formReady.disabled && same(page.formReady.chips, ['Manager 1 QB0', 'Manager 9 QB0']), page.formReady);
  const added = w.list.find((r) => r.id.startsWith('whatif:'));
  ok('the what-if is in the list, first, picked, under its own heading',
    added && w.list[0] === added && added.selected && w.groups[0] === 'What if', w.list[0]);
  ok('it reads as a trade with the other squad', added && /^Wk 2Trade Manager 1 QB0 for Manager 9 QB0 \(Manager 9\)/.test(added.t), added && added.t);
  ok('the weekly totals move from week 2 on, and week 1 does not',
    w.weeks[0].c[4] === '0.0' && num(w.weeks[1].c[4]) !== 0 && num(w.weeks[2].c[4]) !== 0, w.weeks.map((x) => x.c));
  ok('BOTH squads’ season totals change in the standings', num(rowOf(w.standings.hyp, 'Manager 1')[4]) !== 0 && num(rowOf(w.standings.hyp, 'Manager 9')[4]) !== 0,
    [rowOf(w.standings.hyp, 'Manager 1'), rowOf(w.standings.hyp, 'Manager 9')]);
  ok('and nobody else’s does', w.standings.hyp.filter((r) => num(r[4]) !== 0).length === 2, w.standings.hyp.map((r) => r[4]));
  ok('"Lineup of" offers both squads', same(w.season.teams, ['Manager 1', 'Manager 9']), w.season.teams);
  const kept = page.prefs['decisions.whatif.99-2026'];
  ok('it is kept in the page’s prefs for this league',
    Array.isArray(kept) && kept.length === 1 && kept[0].week === 2 && kept[0].teamId === 1 && kept[0].withTeamId === 9 &&
    same(kept[0].gives, [100]) && same(kept[0].gets, [900]), kept);

  // ---- the same league on Summary
  const sum = child('summary');
  if (booted(sum, 'summary')) {
    ok('the real season is simulated with the Summary page’s inputs, runs and seed, to the letter',
      page.firstSim && same(page.firstSim, sum.call) && sum.call.runs === 100000, page.firstSim && [page.firstSim.runs, page.firstSim.seed]);
    const five = (rows) => rows.map((r) => r.slice(0, 5).map((c) => c.replace(/\s*[▲▼]$/, '')));
    ok('so "Current" is the Summary page’s chart, row for row', same(five(page.start.summary.cur), five(sum.rows)),
      [five(page.start.summary.cur)[0], five(sum.rows)[0]]);
  }

  // ---- reload: the what-if survives, and can be removed
  const prefs = { DZ_PREFS: JSON.stringify(page.prefs) };
  const again = child('reload', prefs);
  if (booted(again, 'reload')) {
    const back = again.start.list.find((r) => r.id.startsWith('whatif:'));
    ok('after a reload the what-if is still listed, with the same numbers', back && added && back.id === added.id && back.t === added.t, back);
    ok('noise, switched off before the reload, is still off', again.start.noiseOn === false &&
      Object.values(again.start.dim).every((list) => list.length === 0), again.start.noiseOn);
    ok('it has a remove button', again.hadRemove === true);
    ok('removed, it is gone from the list', !again.after.list.some((r) => r.id.startsWith('whatif:')) && again.after.list.length === 9, again.after.list.map((r) => r.id));
    ok('and from the prefs', again.prefs['decisions.whatif.99-2026'] === undefined, again.prefs);
    ok('and a real decision is picked instead', again.after.list.filter((r) => r.selected).length === 1 && again.after.groups[0] === 'Moves', again.after.groups);
  }
  const other = child('other', prefs);
  if (booted(other, 'other squad')) {
    const theirs = other.start.list.find((r) => r.id.startsWith('whatif:'));
    ok('the other squad lists the same trade, said from its side',
      other.start.team === '9' && theirs && /^Wk 2Trade Manager 9 QB0 for Manager 1 QB0 \(Manager 1\)/.test(theirs.t), theirs);
    ok('noise, left on, is on and dimming from the first paint', other.start.noiseOn === true && other.start.dim.weeks.length > 0 &&
      other.start.dim.current.length === 0, other.start.dim.weeks);
  }
}

// ---- the week in play: everything known so far is shown, in both worlds
// The record a table's Result column adds up to, as a tile prints one.
const tally = (weeks, side) => {
  const n = { W: 0, L: 0, T: 0 };
  for (const w of weeks) {
    const letters = w.c[5].split(' → ');
    const l = side === 'real' ? letters[0] : letters[letters.length - 1];
    if (l in n) n[l]++;
  }
  return `${n.W}-${n.L}${n.T ? `-${n.T}` : ''}`;
};
const agree = (s) => tally(s.weeks, 'real') === s.stats.real && tally(s.weeks, 'mirror') === s.stats.mirror;
const col4 = (rows) => rows.map((r) => r[4]);
const bare = (rows) => rows.map((r) => r.slice(0, 5).map((c) => c.replace(/\s*[▲▼]$/, '')));
const WEEK4 = ['lineup-reasonable:1:all', 'lineup-perfect:1:all', 'lineup-reasonable:1:4', 'lineup-perfect:1:4'];

const early = child('early');
if (booted(early, 'week in play')) {
  ok('the status line says what is counted', /: 3 finished weeks \+ week 4 so far, 5 moves\.$/.test(early.status), early.status);
  ok('and so does the line under the title', early.start.sub === 'Capture Stub League · 3 finished weeks + week 4 so far', early.start.sub);
  const ids = early.start.list.map((r) => r.id);
  ok('BOTH week-4 lineups are offered, hindsight too, though squad 1’s bench has not played',
    ids.includes('lineup-reasonable:1:4') && ids.includes('lineup-perfect:1:4') && ids.length === 11, ids);
  ok('with nobody on the bench finished, hindsight has nothing to change', rowOf(early.start.list.map((r) => [r.id, r.t]), 'lineup-perfect:1:4')[1] ===
    'Wk 4liveLineup: perfect hindsightNo change', early.start.list.map((r) => r.t));
  ok('LIVE sits by the week of each week-4 entry and by "All", and by no other row', same(early.start.tags.list, WEEK4), early.start.tags.list);

  // The add+drop undone, as before, with a fourth week under it.
  const a = early.addDrop;
  ok('the weekly table has the week in play, with its result, marked live',
    same(a.weeks.map((w) => w.c), [
      ['1', 'Manager 10', '114.9', '114.9', '0.0', 'W'],
      ['2', 'Manager 2', '111.1', '111.5', '+0.4', 'T → W'],
      ['3', 'Manager 3', '117.3', '115.5', '−1.8', 'L'],
      ['4live', 'Manager 4', '118.3', '118.3', '0.0', 'L'],
    ]) && same(a.tags.weeks, ['4']), a.weeks.map((w) => w.c));
  ok('and it is in the Total row', same(a.total, ['Total', '461.6', '460.2', '−1.4', '+1 W']), a.total);
  ok('the tiles count it too', same(a.stats, { real: '1-2-1', mirror: '2-2', points: '−1.4' }), a.stats);
  ok('THE TILES ARE THE TABLE: each record is the Result column added up', agree(a), [tally(a.weeks, 'real'), tally(a.weeks, 'mirror'), a.stats]);
  ok('season by week has the fourth column, its head marked live in both boxes', same(a.season.cur, ['Total', '114.9', '111.1', '117.3', '118.3']) &&
    same(a.season.hyp, ['Total', '114.9', '111.5', '115.5', '118.3']) && same(a.tags.season, [['4live'], ['4live']]), [a.season.cur, a.season.hyp, a.tags.season]);
  ok('every starter of squad 1 has finished: no cell is a projection', same(a.tags.proj, [[], []]), a.tags.proj);
  ok('standings count the finished matchup: squad 4 is 4–0, squad 1 1–2–1 beside 2–2',
    rowOf(a.standings.cur, 'Manager 4')[1] === '4–0' && rowOf(a.standings.cur, 'Manager 1')[1] === '1–2–1' &&
    rowOf(a.standings.hyp, 'Manager 1')[1] === '2–2', [rowOf(a.standings.cur, 'Manager 4'), rowOf(a.standings.hyp, 'Manager 1')]);
  ok('and a squad still playing has three results in both', rowOf(a.standings.cur, 'Manager 5')[1] === '1–2' && rowOf(a.standings.hyp, 'Manager 5')[1] === '1–2',
    rowOf(a.standings.cur, 'Manager 5'));

  // The chart: Summary's own, and the same treatment of the week on both sides.
  const sumEarly = child('summary-early');
  if (booted(sumEarly, 'summary, week in play')) {
    ok('"Current" is still the Summary page’s chart, row for row', same(bare(early.start.summary.cur), bare(sumEarly.rows)),
      [bare(early.start.summary.cur)[0], bare(sumEarly.rows)[0]]);
  }
  where = 'week in play';
  ok('the chart’s record is the tile’s for a squad whose matchup is over, in each world',
    rowOf(a.summary.cur, 'Manager 1')[1] === a.stats.real && rowOf(a.summary.hyp, 'Manager 1')[1] === a.stats.mirror,
    [rowOf(a.summary.cur, 'Manager 1'), rowOf(a.summary.hyp, 'Manager 1')]);
  ok('and a matchup in play is the same decimal on both sides', rowOf(a.summary.cur, 'Manager 5')[1] === '1.6-2.4' &&
    rowOf(a.summary.hyp, 'Manager 5')[1] === '1.6-2.4', [rowOf(a.summary.cur, 'Manager 5'), rowOf(a.summary.hyp, 'Manager 5')]);

  // A trade as if accepted in week 4 puts a man still playing in squad 1's
  // lineup: squad 9's QB, projected 25.5, for its own, who scored 10.1. He
  // counts for his projection: 118.3 − 10.1 + 25.5 = 133.7, +15.4.
  const w4 = early.whatIf;
  ok('a what-if on a man still playing shows his points so far in the list, marked live',
    w4.list[0].t === 'Wk 4liveTrade Manager 1 QB0 for Manager 9 QB0 (Manager 9)0+15.4' && w4.list[0].selected &&
    w4.tags.list.includes(w4.list[0].id), w4.list[0]);
  ok('its week-4 row has the totals, and "In play" for the result — the game is not final in that world',
    same(w4.weeks[3].c, ['4live', 'Manager 4', '118.3', '133.7', '+15.4', 'In play']) && !w4.weeks[3].flip, w4.weeks[3]);
  ok('the points are in the Total row and the tile; the matchup is in NEITHER record',
    same(w4.total, ['Total', '461.6', '477.0', '+15.4', '0']) && same(w4.stats, { real: '1-1-1', mirror: '1-1-1', points: '+15.4' }) && agree(w4),
    [w4.total, w4.stats]);
  ok('and out of both standings: squad 4 is back to 3–0 in each', rowOf(w4.standings.cur, 'Manager 4')[1] === '3–0' &&
    rowOf(w4.standings.hyp, 'Manager 4')[1] === '3–0' && same(w4.standings.cur, w4.standings.hyp), [rowOf(w4.standings.cur, 'Manager 4'), rowOf(w4.standings.hyp, 'Manager 4')]);
  ok('the hypothetical chart does not bank it either', rowOf(w4.summary.hyp, 'Manager 1')[1] === '1-1-1' && rowOf(w4.summary.hyp, 'Manager 4')[1] === '3-0',
    [rowOf(w4.summary.hyp, 'Manager 1'), rowOf(w4.summary.hyp, 'Manager 4')]);
  ok('while "Current" is unmoved', same(w4.summary.cur, early.start.summary.cur));
  ok('Season by week: the QB still playing shows his projection, marked as one, and the total counts it',
    col4(w4.season.body)[0] === 'M. 9 QB025.5' && same(w4.tags.proj, [[], ['M. 9 QB025.5']]) &&
    same(col4(w4.season.body).slice(1, 10), col4(w4.season.curBody).slice(1, 10)) &&
    w4.season.cur[4] === '118.3' && w4.season.hyp[4] === '133.7', [col4(w4.season.body), w4.season.hyp, w4.tags.proj]);

  // A squad whose own matchup is still being played: one starter finished (15.5).
  // Undoing its trade starts an RB projected 16.7 where one projected 16.8 was.
  const t5 = early.team5;
  ok('a squad still playing is offered both week-4 lineups too', t5.list.length === 11 &&
    t5.list.some((r) => r.id === 'lineup-reasonable:5:4') && t5.list.some((r) => r.id === 'lineup-perfect:5:4'), t5.list.map((r) => r.id));
  ok('its week-4 row has what is known so far, and "In play" for the result',
    same(t5.weeks[3].c, ['4live', 'Manager 3', '15.5', '15.4', '−0.1', 'In play']), t5.weeks[3]);
  ok('the Total row and the tiles: four weeks of points (388.9 + 15.5), three results', same(t5.total, ['Total', '404.4', '404.0', '−0.4', '0']) &&
    same(t5.stats, { real: '1-2', mirror: '1-2', points: '−0.4' }) && agree(t5), [t5.total, t5.stats]);
  ok('and the list row is the same −0.4', t5.list[0].t === 'Wk 3Traded Manager 5 RB1 for Manager 6 RB10−0.4', t5.list[0]);
  ok('Season by week: the finished man’s points plain, the other nine as projections, the total so far',
    col4(t5.season.curBody)[0] === 'M. 5 QB015.5' && t5.tags.proj[0].length === 9 && !t5.tags.proj[0].includes('M. 5 QB015.5') &&
    same(t5.tags.proj[0], col4(t5.season.curBody).slice(1, 10)) && t5.season.cur[4] === '15.5' && t5.season.hyp[4] === '15.4',
    [col4(t5.season.curBody), t5.tags.proj[0]]);
  ok('the standings leave the game in play out, as before', rowOf(t5.standings.cur, 'Manager 5')[1] === '1–2' && rowOf(t5.standings.cur, 'Manager 5')[4] === '388.9' &&
    rowOf(t5.standings.hyp, 'Manager 5')[1] === '1–2' && rowOf(t5.standings.hyp, 'Manager 5')[4] === '388.6', [rowOf(t5.standings.cur, 'Manager 5'), rowOf(t5.standings.hyp, 'Manager 5')]);

  // Nothing changed is still nothing, the week in play included.
  const e = early.empty;
  ok('an empty decision: every weekly difference is zero, the week in play too',
    e.weeks.length === 4 && e.weeks.every((x) => x.c[2] === x.c[3] && x.c[4] === '0.0' && !x.flip) &&
    same(e.weeks[3].c, ['4live', 'Manager 6', '0.0', '0.0', '0.0', 'In play']) && same(e.total, ['Total', '328.1', '328.1', '0.0', '0']),
    e.weeks.map((x) => x.c));
  ok('season by week, difference: every cell zero, the week in play too', e.season.vals.length === 44 && e.season.vals.every((v) => v === 0) &&
    same(e.season.hyp, ['Total', '0.0', '0.0', '0.0', '0.0']) && col4(e.season.body).every((c) => /0\.0$/.test(c)),
    [e.season.hyp, e.season.vals.length, col4(e.season.body)]);
  ok('standings, difference: every cell zero', allZero(e.standings.hyp), e.standings.hyp.find((r) => !allZero([r])));
  ok('the chart, difference: every cell zero', allZero(e.summary.hyp) && e.summary.hyp.every((r) => r[3] === '0.0%' && r[4] === '0.0%'), e.summary.hyp);
}

// ---- Tim's own case: the bench QB outscored the starter, one bench man to play
// Squad 1's week-4 matchup is over (118.3, a loss to squad 4). Its
// starting QB scored 10.1 and its bench QB 18.1; the free agent on its bench has
// not played. Perfect hindsight starts the bench QB: 118.3 − 10.1 + 18.1 = 126.3,
// +8.0, and the loss is a win.
const bench = child('bench');
if (booted(bench, 'bench QB, week in play')) {
  ok('perfect hindsight for the week in play is offered', bench.offered === true);
  const texts = Object.fromEntries(bench.start.list.map((r) => [r.id, r.t]));
  ok('THE LIST ROW shows +8.0 and the win, marked live', texts['lineup-perfect:1:4'] === 'Wk 4liveLineup: perfect hindsight+1 W+8.0', texts['lineup-perfect:1:4']);
  ok('the whole-season entry counts it (33.9 + 8.0) and is marked live by "All"', texts['lineup-perfect:1:all'] === 'AllliveLineup: perfect hindsight+2 W+41.9',
    texts['lineup-perfect:1:all']);
  ok('LIVE is on the week-4 and "All" rows only', same(bench.start.tags.list, WEEK4), bench.start.tags.list);
  const h = bench.hindsight;
  ok('THE WEEK ROW shows +8.0 and the flipped result', same(h.weeks.map((w) => w.c), [
    ['1', 'Manager 10', '114.9', '114.9', '0.0', 'W'],
    ['2', 'Manager 2', '111.1', '111.1', '0.0', 'T'],
    ['3', 'Manager 3', '117.3', '117.3', '0.0', 'L'],
    ['4live', 'Manager 4', '118.3', '126.3', '+8.0', 'L → W'],
  ]) && same(h.weeks.map((w) => w.flip), [false, false, false, true]), h.weeks.map((w) => w.c));
  ok('THE TOTAL ROW shows +8.0', same(h.total, ['Total', '461.6', '469.6', '+8.0', '+1 W']), h.total);
  ok('THE TILES show +8.0, and the game counts though a bench man is still to play', same(h.stats, { real: '1-2-1', mirror: '2-1-1', points: '+8.0' }) && agree(h),
    h.stats);
  ok('LIVE by the week number: weekly table, and both Season by week heads', same(h.tags.weeks, ['4']) && same(h.tags.season, [['4live'], ['4live']]), h.tags);
  ok('Season by week: the bench QB is in the QB row with his 18.1, and the total is 126.3',
    col4(h.season.curBody)[0] === 'M. 1 QB010.1' && col4(h.season.body)[0] === 'M. 1 QB1218.1' && h.season.hyp[4] === '126.3', col4(h.season.body));
  ok('no cell is a projection: every man shown has finished', same(h.tags.proj, [[], []]), h.tags.proj);
  ok('as a difference: +8.0 at QB, +8.0 in the total row, and the finished weeks zero',
    col4(bench.diff.season.body)[0] === 'M. 1 QB12+8.0' && same(bench.diff.season.hyp, ['Total', '0.0', '0.0', '0.0', '+8.0']) &&
    Math.round(bench.diff.season.vals.slice(0, 40).reduce((s, v) => s + v, 0) * 10) / 10 === 8, [col4(bench.diff.season.body), bench.diff.season.hyp]);
  ok('the game is final in both worlds, so the standings and the chart count it: 2–1–1, squad 4 3–1',
    rowOf(h.standings.hyp, 'Manager 1')[1] === '2–1–1' && rowOf(h.standings.hyp, 'Manager 4')[1] === '3–1' &&
    rowOf(h.summary.hyp, 'Manager 1')[1] === '2-1-1' && rowOf(h.summary.cur, 'Manager 1')[1] === '1-2-1',
    [rowOf(h.standings.hyp, 'Manager 1'), rowOf(h.summary.hyp, 'Manager 1')]);
  const all = bench.all;
  ok('the whole season: week 4’s +8.0 beside the finished weeks’, and in the total',
    same(all.weeks.map((w) => w.c[4]), ['+11.5', '+11.4', '+11.0', '+8.0']) && same(all.total, ['Total', '461.6', '503.5', '+41.9', '+2 W']) &&
    same(all.stats, { real: '1-2-1', mirror: '3-1', points: '+41.9' }) && agree(all), [all.weeks.map((w) => w.c), all.total, all.stats]);
}

// The same league with that last bench man finished: nothing is partial.
const done = child('bench-all');
if (booted(done, 'bench QB, everybody finished')) {
  const h = done.hindsight;
  ok('the same +8.0 everywhere', same(h.weeks[3].c, ['4', 'Manager 4', '118.3', '126.3', '+8.0', 'L → W']) &&
    same(h.total, ['Total', '461.6', '469.6', '+8.0', '+1 W']) && same(h.stats, { real: '1-2-1', mirror: '2-1-1', points: '+8.0' }), [h.weeks[3], h.total, h.stats]);
  ok('and NO live tag anywhere on the page', h.tags.all === 0 && done.all.tags.all === 0 && same(h.tags.weeks, []) && same(h.tags.list, []) &&
    same(h.tags.season, [[], []]), h.tags);
  ok('the list rows read without it', h.list.find((r) => r.id === 'lineup-perfect:1:4').t === 'Wk 4Lineup: perfect hindsight+1 W+8.0' &&
    h.list.find((r) => r.id === 'lineup-perfect:1:all').t === 'AllLineup: perfect hindsight+2 W+41.9', h.list.map((r) => r.t));
}

// ---- the world cannot be read
const failed = child('failed');
where = 'failed read';
ok('a failed read says why, and falls back to the sample', !failed.boot && failed.badge === 'Demo' && failed.rows > 0 &&
  /would not return.*Showing demo data instead\.$/.test(failed.status), failed.boot || failed.status);
const cloud = child('failed-cloud');
where = 'failed read, phone copy';
ok('on the phone’s synced copy it is one short sentence', !cloud.boot &&
  cloud.status === 'This page needs the league read directly for now. Showing demo data instead.', cloud.boot || cloud.status);

// ---- nothing decided yet
const none = child('unplayed');
where = 'no finished week';
ok('fewer than one finished week: said in a few words, and no empty panels', !none.boot &&
  none.status === 'No finished week yet.' && none.hidden.every(Boolean), none.boot || none);
ok('no console errors', !none.boot && none.errors.length === 0, none.errors);

for (const f of fails) console.log('FAIL ' + f);
console.log(fails.length ? `${pass} passed, ${fails.length} failed` : `All ${pass} assertions passed`);
process.exit(fails.length ? 1 : 0);
