// A TEAM'S RECORD WHILE ITS GAME IS BEING PLAYED — the same on every page.
//
//   node record-live-check.mjs            the helper, then each page (one child each)
//   node record-live-check.mjs --dump X   print child X's raw facts
//
// Tim, 2026-10-05: "for an uncompleted matchup put the decimal place record
// there instead of whole number record like we have in the simulation section
// (for example in the standings and season totals box in stats section". And
// 2026-10-04, on that simulation table: "if someone's record is 3-2 and they
// have a 20% chance of winning the current week, their record should be
// displayed as 3.2-2.8".
//
// The arithmetic is one helper, `capture.liveWinChances` (+ `recordNow`), and
// Schedule, Summary and Stats print through it. Part 1 holds the helper to
// hand-worked numbers. Part 2 boots each page on tests/cap-stub-season.mjs with
// CAP_EARLY=mix — week 4 with one matchup final early, three being played and
// one not kicked off — and requires the three kinds of record on each page and
// THE SAME RECORD FOR THE SAME TEAM on all three.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { bootDom, waitFor } from './cap-harness.mjs';
import { emit } from './emit.mjs';

const self = fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const html = (page) => readFileSync(path.join(REPO, page), 'utf8');
const CONN = { leagueId: '99', season: 2026, teamId: 1 };
const cellOf = (td) => ({ t: text(td), title: td.getAttribute('title') || '', v: td.getAttribute('data-v') });

function trapErrors() {
  const errors = [];
  console.error = (...a) => { errors.push(a.join(' ')); };
  process.on('unhandledRejection', (r) => errors.push(`unhandled: ${String((r && r.stack) || r)}`));
  return errors;
}

// ------------------------------------------------------------------ children

async function stubFacts() {
  const stub = await import('./cap-stub-season.mjs');
  const wk = stub.EARLY_WEEK || 4;
  const sched = await stub.fetchSchedule();
  return {
    early: stub.earlySquads(),
    late: stub.lateSquads ? stub.lateSquads() : [],
    week: wk,
    games: sched.byWeek.get(wk).map((g) => ({
      homeId: g.homeId, awayId: g.awayId, played: g.played, early: g.early === true,
      homeScore: g.homeScore, awayScore: g.awayScore,
    })),
  };
}

const CHILDREN = {
  async schedule() {
    const errors = trapErrors();
    const { document } = bootDom({
      html: html('schedule.html'),
      store: {
        'ff.prefs': { 'schedule.source': 'live', 'schedule.week': 'all', 'schedule.h2h': 'records' },
        'ff.connection': CONN,
      },
    });
    await import(moduleUrl('js/schedule-page.js'));
    const $ = (id) => document.getElementById(id);
    await waitFor(() => (globalThis.__simCalls || []).length &&
      document.querySelectorAll('#simTable tbody tr:not(.empty-row)').length === 10, 25000);
    await sleep(150);
    const sim = {};
    for (const tr of document.querySelectorAll('#simTable tbody tr')) {
      sim[text(tr.children[0])] = cellOf(tr.children[1]);
    }
    // Every card a team appears on, by team name.
    const cards = {};
    for (const side of document.querySelectorAll('#matchups .game .side')) {
      const name = text(side.querySelector('.tname'));
      const rec = side.querySelector('.trec');
      if (!rec) continue;
      (cards[name] = cards[name] || []).push(cellOf(rec));
    }
    const head = [...document.querySelectorAll('#h2hGrid thead th')].map((th) => th.getAttribute('title') || text(th));
    const h2h = {};
    for (const tr of document.querySelectorAll('#h2hGrid tbody tr')) {
      const td = [...tr.children];
      h2h[text(td[0])] = {
        overall: { ...cellOf(td[1]), cls: td[1].getAttribute('class') || '' },
        cells: Object.fromEntries(td.slice(2).map((c, i) => [head[i + 2], { ...cellOf(c), cls: c.getAttribute('class') || '' }])),
      };
    }
    return {
      sim, cards, h2h,
      h2hTitle: text($('h2hTitle')),
      banked: text([...document.querySelectorAll('#forecastStats .stat')]
        .find((s) => text(s.querySelector('.k')) === 'Banked')?.querySelector('.v')),
      simNote: text($('simNote')), matchupsNote: text($('matchupsNote')), h2hNote: text($('h2hNote')),
      call: (globalThis.__simCalls || []).slice(-1)[0],
      stub: await stubFacts(),
      errors,
    };
  },

  async summary() {
    const errors = trapErrors();
    const { document, window } = bootDom({
      html: html('summary.html'),
      store: { 'ff.prefs': { 'summary.source': 'live' }, 'ff.connection': CONN },
    });
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
    await import(moduleUrl('js/summary-page.js'));
    await import(moduleUrl('js/connection.js'));
    const $ = (id) => document.getElementById(id);
    await waitFor(() => /simulated seasons/.test(text($('simStatus'))), 40000);
    await sleep(150);
    const read = () => {
      const rows = {};
      for (const tr of document.querySelectorAll('#summaryTable tbody tr')) {
        rows[text(tr.children[0])] = cellOf(tr.children[1]);
      }
      return rows;
    };
    const out = {
      rows: read(),
      shareText: $('shareText') ? $('shareText').textContent : '',
      note: text(document.body).includes('counts it as its chance of winning'),
      through: $('weekSelect') ? $('weekSelect').value : null,
      stub: await stubFacts(),
    };
    // The week picker stepped back one week: the record is then "as of" that
    // week, and the game being played now is no part of it.
    const sel = $('weekSelect');
    if (sel && Number(sel.value) > 1) {
      sel.value = String(Number(sel.value) - 1);
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await sleep(400);
      out.back = { through: sel.value, rows: read() };
    }
    out.errors = errors;
    return out;
  },

  async stats() {
    const errors = trapErrors();
    const { document } = bootDom({
      html: html('stats.html'),
      store: { 'ff.prefs': { 'stats.source': process.env.RL_DEMO ? 'demo' : 'live' }, 'ff.connection': CONN },
    });
    await import(moduleUrl('js/stats-page.js'));
    const $ = (id) => document.getElementById(id);
    await waitFor(() => text($('modeBadge')) === (process.env.RL_DEMO ? 'Demo' : 'Live') &&
      document.querySelectorAll('#mainTable tbody tr').length >= 10, 15000);
    // The per-week roster read (schedule luck, and now the live record) lands later.
    await waitFor(() => /dots over|No player has|could be read/.test(text($('fitPlayersNote')) + text($('chartFitPlayers'))), 15000);
    await sleep(250);
    const rows = {};
    const order = [];
    for (const tr of document.querySelectorAll('#mainTable tbody tr')) {
      rows[text(tr.children[0])] = cellOf(tr.children[1]);
      order.push(text(tr.children[0]));
    }
    const tile = [...document.querySelectorAll('#glance .stat')]
      .find((s) => text(s.querySelector('.k')) === 'Best record');
    return {
      rows, order,
      best: { t: text(tile?.querySelector('.v')), title: tile?.querySelector('.v [title]')?.getAttribute('title') || '' },
      as: Object.fromEntries([...document.querySelectorAll('#mainTable tbody tr')]
        .map((tr) => [text(tr.children[0]), text(tr.children[tr.children.length - 1])])),
      note: text($('mainTableNote')),
      status: text($('mainTableStatus')),
      stub: process.env.RL_DEMO ? null : await stubFacts(),
      errors,
    };
  },
};

if (process.argv[2] && process.argv[2] !== '--dump') {
  try {
    emit(await CHILDREN[process.argv[2]](), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

const RUNS = {
  'schedule-mix': { child: 'schedule', env: { CAP_EARLY: 'mix' } },
  'summary-mix': { child: 'summary', env: { CAP_EARLY: 'mix' } },
  'stats-mix': { child: 'stats', env: { CAP_EARLY: 'mix' } },
  'stats-off': { child: 'stats', env: {} },
  'stats-demo': { child: 'stats', env: { RL_DEMO: '1' } },
};

function child(name) {
  const cfg = RUNS[name];
  const env = { ...process.env };
  for (const k of ['CAP_EARLY', 'CAP_DECIDED', 'CAP_WIRE', 'RL_DEMO', 'FF_SCEN']) delete env[k];
  Object.assign(env, cfg.env);
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
let where = 'helper';
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`[${where}] ${name}${detail !== '' ? ` — ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700)}` : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ============================================================ 1. the helper
const capture = await import(pathToFileURL(path.join(REPO, 'js/capture.js')).href);
const forecast = await import(pathToFileURL(path.join(REPO, 'js/forecast.js')).href);

if (typeof capture.liveWinChances !== 'function' || typeof capture.recordNow !== 'function') {
  ok('js/capture.js exports liveWinChances and recordNow', false, Object.keys(capture).filter((k) => /live|record/i.test(k)));
} else {
  // Week 5 of a ten-team league, sigma 20. Each side is {mean, left, banked,
  // kicked} as capture.liveWeek hands it over.
  const side = (mean, left, banked, kicked) => ({ mean, left, banked, kicked });
  const game = (week, homeId, awayId, extra = {}) => ({
    week, homeId, awayId, homeName: `T${homeId}`, awayName: `T${awayId}`,
    homeScore: null, awayScore: null, played: false, ...extra,
  });
  const data = capture.normalizeSchedule({
    teams: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `T${i + 1}` })),
    games: [
      game(4, 1, 2, { homeScore: 100, awayScore: 90, played: true }),          // ESPN-final, last week
      game(5, 1, 2, { homeScore: 60, awayScore: 70 }),                          // being played
      game(5, 3, 4, { homeScore: 120, awayScore: 99, played: true, early: true }), // final early
      game(5, 5, 6),                                                            // not kicked off
      game(5, 7, 8, { awayScore: 40 }),                                         // one side kicked off
      game(5, 9, 10, { homeScore: 80, awayScore: 80 }),                         // level, nothing left
    ],
  }, { isDemo: false });
  const live = {
    week: 5,
    asOf: 0,
    teams: new Map([
      [1, side(100, 0.5, 60, true)], [2, side(110, 0.5, 70, true)],
      [3, side(120, 0, 120, true)], [4, side(99, 0, 99, true)],
      [5, side(105, 1, 0, false)], [6, side(95, 1, 0, false)],
      [7, side(120, 1, 0, false)], [8, side(100, 0.6, 40, true)],
      [9, side(80, 0, 80, true)], [10, side(80, 0, 80, true)],
    ]),
  };
  const c = capture.liveWinChances({ data, live, sigma: 20 });

  // T1 v T2: margin −10, sd = 20 × √(0.5² + 0.5²) = 14.142, z = −0.7071,
  // Φ = 0.2398 → 0.2 for T1 and the rest, 0.8, for T2.
  ok('a game being played: 100 v 110 with half the spread left each is Φ(−0.707) = 24% → 0.2',
    c.get(1) === 0.2 && c.get(2) === 0.8, [c.get(1), c.get(2)]);
  ok('it is forecast.winProbabilityLive on those numbers, rounded to a tenth',
    c.get(1) === Math.round(forecast.winProbabilityLive(100, 110, 20, 0.5, 0.5) * 10) / 10);
  ok('A MATCHUP FINAL EARLY HAS NO ENTRY — its record stays whole', !c.has(3) && !c.has(4), [c.get(3), c.get(4)]);
  ok('A MATCHUP NEITHER SIDE OF WHICH HAS KICKED OFF HAS NO ENTRY', !c.has(5) && !c.has(6), [c.get(5), c.get(6)]);
  // T7 v T8: margin +20, sd = 20 × √(1 + 0.36) = 23.32, z = 0.8575, Φ = 0.8044.
  ok('one side kicked off is enough: 120 (all to play) v 100 (0.6 left) is Φ(0.858) = 80% → 0.8 / 0.2',
    c.get(7) === 0.8 && c.get(8) === 0.2, [c.get(7), c.get(8)]);
  ok('level with nothing left on either side is a half each', c.get(9) === 0.5 && c.get(10) === 0.5, [c.get(9), c.get(10)]);
  ok('only the week in progress: six teams in play, nobody else', c.size === 6, [...c.keys()]);

  // Both sides of one game add up to one game, whatever the chance. Rounding
  // each side on its own breaks at an exact quarter (0.25 → 0.3, 0.75 → 0.8).
  let worst = 0;
  for (let d = -60; d <= 60; d += 0.25) {
    const one = capture.liveWinChances({
      data, sigma: 20,
      live: { week: 5, asOf: 0, teams: new Map([[1, side(100 + d, 0.7, 10, true)], [2, side(100, 0.4, 10, true)]]) },
    });
    worst = Math.max(worst, Math.abs(one.get(1) + one.get(2) - 1));
    const a = capture.recordNow({ w: 3, l: 2, t: 0 }, one.get(1));
    const b = capture.recordNow({ w: 1, l: 4, t: 0 }, one.get(2));
    const sum = a.text.split('–').concat(b.text.split('–')).map(Number).reduce((x, y) => x + y, 0);
    if (Math.abs(sum - 12) > 1e-9) worst = Math.max(worst, 1);
  }
  ok('BOTH SIDES OF ONE GAME SUM TO ONE GAME, across 481 margins — and so do the two printed records', worst < 1e-12, worst);

  ok('nothing in play without a reading', capture.liveWinChances({ data, live: null, sigma: 20 }).size === 0);
  ok('nor on demo data', capture.liveWinChances({ data: { ...data, isDemo: true }, live, sigma: 20 }).size === 0);
  ok('nor with no spread to read the gap against', capture.liveWinChances({ data, live, sigma: 0 }).size === 0);
  // A reading from before `kicked` existed: points on the board mean kicked off.
  const bare = new Map([...live.teams].map(([id, s]) => [id, { mean: s.mean, left: s.left, banked: s.banked }]));
  ok('a reading without `kicked` is read off the points and the spread left',
    same([...capture.liveWinChances({ data, live: { ...live, teams: bare }, sigma: 20 })], [...c]));

  // ---- recordNow ----
  const r = capture.recordNow({ w: 3, l: 2, t: 0 }, 0.2);
  ok('TIM’S EXAMPLE: 3–2 with a 20% chance reads 3.2–2.8', r.text === '3.2–2.8' && r.live === true, r);
  ok('it sorts on wins + the chance, over one more game', Math.abs(r.wins - 3.2) < 1e-9 && r.games === 6, r);
  ok('and states its basis', r.title === '3–2 so far; 20% to win the game being played (our model, not ESPN’s)', r.title);
  const whole = capture.recordNow({ w: 3, l: 2, t: 0 }, null);
  ok('no game in play: whole numbers, no title', whole.text === '3–2' && whole.live === false && whole.title === '' &&
    whole.wins === 3 && whole.games === 5, whole);
  ok('the Summary page’s hyphen', capture.recordNow({ w: 3, l: 2, t: 0 }, 0.2, { sep: '-' }).text === '3.2-2.8');
  const tie = capture.recordNow({ w: 1, l: 2, t: 1 }, 0.7);
  ok('a tie stays a third number: 1–2–1 at 70% reads 1.7–2.3–1 and sorts as 2.2 wins of 5',
    tie.text === '1.7–2.3–1' && Math.abs(tie.wins - 2.2) < 1e-9 && tie.games === 5 &&
    /^1–2–1 so far; 70% /.test(tie.title), tie);
  ok('a game all but won keeps its decimal', capture.recordNow({ w: 0, l: 3, t: 0 }, 1).text === '1.0–3.0');

  // ---- liveWinChancesFrom: the pieces, assembled as the Schedule page does ----
  const NOW = 1791133200000;
  const MIN = 60000;
  const man = (position, lineupSlotId, proTeamId, projected, actual = null, done = false) => ({
    position, lineupSlotId, proTeamId, projected, actual, done, started: lineupSlotId !== 20,
  });
  // Two slots (QB, RB). Team 1 v 2 are playing; 3 v 4 have not kicked off.
  const squad = (id, pro, qb, rb, pts) => ({
    id, projectedTotal: qb + rb,
    players: [man('QB', 0, pro, qb, pts), man('RB', 2, pro, rb, pts === null ? null : 0)],
  });
  const wk2 = [squad(1, 1, 20, 10, 12), squad(2, 1, 18, 10, 9), squad(3, 2, 20, 10, null), squad(4, 2, 19, 10, null)];
  const wk1 = [1, 2, 3, 4].map((id) => ({ id, projectedTotal: 28 + id, players: [] }));
  const d2 = capture.normalizeSchedule({
    teams: [1, 2, 3, 4].map((id) => ({ id, name: `T${id}` })),
    games: [
      game(1, 1, 2, { homeScore: 40, awayScore: 20, played: true }),
      game(1, 3, 4, { homeScore: 25, awayScore: 35, played: true }),
      game(2, 1, 2, { homeScore: 12, awayScore: 9 }),
      game(2, 3, 4),
    ],
  }, { isDemo: false });
  const weekTeams = new Map([[1, wk1], [2, wk2]]);
  const proGames = { 1: { 2: { at: NOW - 95 * MIN, done: false } }, 2: { 2: { at: NOW + 600 * MIN, done: false } } };
  const from = capture.liveWinChancesFrom({ data: d2, weekTeams, proGames, asOf: NOW, now: NOW });
  const lw = capture.liveWeek({ data: d2, weekTeams: new Map([[2, wk2]]), slots: [0, 2], proGames, asOf: NOW, now: NOW });
  const sig = capture.leagueSpread(d2, (g) => capture.gameState(g) === 'final', capture.startedProjections(weekTeams, [1])).sigma;
  // Half a game gone: T1 = 12 + (20 + 10)/2 = 27, T2 = 9 + (18 + 10)/2 = 23.
  ok('the fixture: half a game gone, T1 expects 27 and T2 23, kicked; T3 and T4 have not kicked off',
    lw && lw.teams.get(1).mean === 27 && lw.teams.get(2).mean === 23 && lw.teams.get(1).kicked === true &&
    lw.teams.get(3).kicked === false && lw.teams.get(4).kicked === false,
    lw && [...lw.teams]);
  ok('liveWinChancesFrom is liveWeek + leagueSpread + liveWinChances, the Schedule page’s own steps',
    same([...from], [...capture.liveWinChances({ data: d2, live: lw, sigma: sig })]) && from.size === 2 &&
    from.has(1) && from.has(2) && Math.abs(from.get(1) + from.get(2) - 1) < 1e-12, [...from]);
  ok('and is empty without the NFL’s games', capture.liveWinChancesFrom({ data: d2, weekTeams, proGames: {}, asOf: NOW, now: NOW }).size === 0);
}

// ============================================================ 2. the pages
const WHOLE = /^\d+–\d+(–\d+)?$/;
const DEC = /^\d+\.\d–\d+\.\d(–\d+)?$/;
const TITLE = /^\d+–\d+(–\d+)? so far; \d+% to win the game being played \(our model, not ESPN’s\)$/;
const en = (s) => s.replace(/-/g, '–');
const booted = (r, name) => {
  where = name;
  ok('the page boots on the fixture', !r.boot, r.boot);
  if (!r.boot) ok('with no console errors', (r.errors || []).length === 0, (r.errors || []).join(' || '));
  return !r.boot;
};

const sch = child('schedule-mix');
const sum = child('summary-mix');
const sta = child('stats-mix');
const all = booted(sch, 'schedule') & booted(sum, 'summary') & booted(sta, 'stats');

if (all) {
  where = 'fixture';
  const { early, late, games } = sch.stub;
  const name = (id) => `Manager ${id}`;
  const ids = Array.from({ length: 10 }, (_, i) => i + 1);
  const playing = ids.filter((id) => !early.includes(id) && !late.includes(id));
  ok('week 4: one matchup final early (1 v 4), one not kicked off, three being played',
    same(early, [1, 4]) && late.length === 2 && playing.length === 6, { early, late, playing });
  ok('the three being played carry their points so far and are not `played`',
    games.filter((g) => playing.includes(g.homeId)).every((g) => !g.played && g.homeScore > 0 && g.awayScore > 0), games);
  // What each team has banked, off the simulation's own table (wins, a tie as half).
  const bankedWins = new Map(sch.call.banked.map(([id, b]) => [id, b.wins]));

  const pages = [
    ['Schedule simulation table', (id) => sch.sim[name(id)]],
    ['Stats “Standings & season totals”', (id) => sta.rows[name(id)]],
    ['Summary', (id) => ({ ...sum.rows[name(id)], t: en(sum.rows[name(id)].t), title: en(sum.rows[name(id)].title) })],
    ['Schedule head-to-head Overall', (id) => sch.h2h[name(id)].overall],
  ];
  for (const [label, get] of pages) {
    where = label;
    ok('THE TWO SQUADS WHOSE MATCHUP IS FINAL EARLY: whole numbers, 1–2–1 and 4–0, no title',
      get(1).t === '1–2–1' && get(4).t === '4–0' && !get(1).title && !get(4).title, [get(1), get(4)]);
    ok('THE TWO WHO HAVE NOT KICKED OFF: whole numbers, three games, no title',
      late.every((id) => WHOLE.test(get(id).t) && !get(id).title &&
        get(id).t.split('–').map(Number).reduce((x, y) => x + y, 0) === 3),
      late.map((id) => `${name(id)} ${get(id).t} [${get(id).title}]`));
    ok('THE SIX STILL PLAYING: a decimal record, four games long',
      playing.every((id) => DEC.test(get(id).t) &&
        Math.abs(get(id).t.split('–').map(Number).reduce((x, y) => x + y, 0) - 4) < 1e-9),
      playing.map((id) => `${name(id)} ${get(id).t}`));
    ok('each with its basis in the cell’s title (rule 7)', playing.every((id) => TITLE.test(get(id).title)),
      playing.map((id) => get(id).title));
    ok('the title’s "so far" is the banked record and its % the decimal',
      playing.every((id) => {
        const [, w, l, pct] = /^(\d+)–(\d+)(?:–\d+)? so far; (\d+)%/.exec(get(id).title) || [];
        const [dw, dl] = get(id).t.split('–').map(Number);
        return Math.abs(dw - (Number(w) + pct / 100)) < 1e-9 && Math.abs(dl - (Number(l) + 1 - pct / 100)) < 1e-9;
      }), playing.map((id) => `${get(id).t} / ${get(id).title}`));
    ok('the two sides of each game being played add up to one game',
      games.filter((g) => playing.includes(g.homeId)).every((g) => {
        const pct = (id) => Number((/; (\d+)%/.exec(get(id).title) || [])[1]);
        return pct(g.homeId) + pct(g.awayId) === 100;
      }), games.filter((g) => playing.includes(g.homeId)).map((g) => `${get(g.homeId).title} | ${get(g.awayId).title}`));
  }

  where = 'across pages';
  ok('THE SAME TEAM READS THE SAME ON STATS, SUMMARY AND SCHEDULE — all ten, text and title',
    ids.every((id) => pages.every(([, get]) => get(id).t === pages[0][1](id).t && get(id).title === pages[0][1](id).title)),
    ids.map((id) => pages.map(([, get]) => get(id).t).join(' = ')).join(' | '));
  ok('a decimal record is the banked wins plus the chance (the simulation’s own banked table)',
    playing.every((id) => {
      const [dw] = sch.sim[name(id)].t.split('–').map(Number);
      const pct = Number((/; (\d+)%/.exec(sch.sim[name(id)].title) || [])[1]);
      const ties = Number(sch.sim[name(id)].t.split('–')[2] || 0);
      return Math.abs(dw + ties / 2 - (bankedWins.get(id) + pct / 100)) < 1e-9;
    }), playing.map((id) => `${sch.sim[name(id)].t} banked ${bankedWins.get(id)}`));
  ok('not every chance is a coin flip (the fixture can tell a real chance from 0.5)',
    playing.some((id) => !/; 50%/.test(sch.sim[name(id)].title)), playing.map((id) => sch.sim[name(id)].title));

  // ---- Schedule: the other places a record is printed ----
  where = 'schedule cards';
  ok('every card a team appears on shows the record the simulation table shows',
    ids.every((id) => (sch.cards[name(id)] || []).length === 14 &&
      sch.cards[name(id)].every((c) => c.t === sch.sim[name(id)].t && c.title === sch.sim[name(id)].title)),
    ids.map((id) => `${name(id)}: ${[...new Set((sch.cards[name(id)] || []).map((c) => c.t))].join('/')}`).join(' | '));
  ok('the basis is said behind the cards’ toggle', /counts it as its chance of winning \(our model, not ESPN’s\)/.test(sch.matchupsNote),
    sch.matchupsNote.slice(0, 200));

  where = 'schedule head-to-head';
  ok('the grid is in Records mode', sch.h2hTitle === 'Head to head', sch.h2hTitle);
  const opp = new Map(games.flatMap((g) => [[g.homeId, g.awayId], [g.awayId, g.homeId]]));
  ok('THE CELL AGAINST THE OPPONENT BEING PLAYED counts the game too, so the row still adds up to Overall',
    playing.every((id) => {
      const row = sch.h2h[name(id)];
      const parts = (t) => (t === '—' || t === '·' ? [0, 0, 0] : t.split('–').map(Number).concat(0).slice(0, 3));
      const tot = Object.values(row.cells).map((c) => parts(c.t)).reduce((a, p) => a.map((x, i) => x + p[i]), [0, 0, 0]);
      const want = parts(row.overall.t);
      return DEC.test(row.cells[name(opp.get(id))].t) && tot.every((x, i) => Math.abs(x - want[i]) < 1e-9);
    }), playing.map((id) => `${name(id)}: v ${opp.get(id)} ${sch.h2h[name(id)].cells[name(opp.get(id))].t}, overall ${sch.h2h[name(id)].overall.t}`));
  ok('every other cell is whole numbers or blank',
    ids.every((id) => Object.entries(sch.h2h[name(id)].cells)
      .every(([n, c]) => (playing.includes(id) && n === name(opp.get(id))) || c.t === '—' || c.t === '·' || WHOLE.test(c.t))));
  ok('Overall is coloured and sorted by the record it prints',
    ids.every((id) => {
      const o = sch.h2h[name(id)].overall;
      const [w, l] = o.t.split('–').map(Number);
      return Math.abs(Number(o.v) - (w - l)) < 1e-9 && o.cls === (w > l ? 'pos' : w < l ? 'neg' : 'muted');
    }), ids.map((id) => sch.h2h[name(id)].overall));
  ok('the basis is said behind the grid’s toggle', /counts it as its chance of winning/.test(sch.h2hNote), sch.h2hNote.slice(-200));
  ok('“My season” Banked stays the banked games: Manager 1 is 1–2–1', sch.banked === '1–2–1', sch.banked);

  // ---- Stats ----
  where = 'stats';
  const key = (id) => Number(sta.rows[name(id)].v);
  const pctOf = (id) => {
    const p = sta.rows[name(id)].t.split('–').map(Number);
    return (p[0] + (p[2] || 0) / 2) / (p[0] + p[1] + (p[2] || 0));
  };
  ok('THE RECORD COLUMN SORTS ON WHAT IT PRINTS: win % of the printed record, ten teams in the same order',
    same([...ids].sort((a, b) => key(b) - key(a) || a - b).map((id) => Math.round(pctOf(id) * 1e6)),
      [...ids].map((id) => Math.round(pctOf(id) * 1e6)).sort((a, b) => b - a)),
    ids.map((id) => `${sta.rows[name(id)].t}:${key(id)}`).join(' '));
  ok('and the table opens in that order', same(sta.order.map((n) => Number(sta.rows[n].v)),
    sta.order.map((n) => Number(sta.rows[n].v)).sort((a, b) => b - a)), sta.order);
  const top = sta.order[0];
  ok('the Best record tile prints the top row’s record as the table does',
    sta.best.t === `${sta.rows[top].t} ${top}` && sta.best.title === sta.rows[top].title, sta.best);
  ok('AS, a rank, is left on finished games (a dash while the league has unequal game counts, or a whole rank)',
    Object.values(sta.as).every((v) => v === '—' || /^\d+$/.test(v)), sta.as);
  ok('the basis is said behind “What the columns mean”, and not on screen',
    /W–L: A team whose game is being played counts it as its chance of winning \(our model, not ESPN’s\)/.test(sta.note) &&
    !/chance of winning/.test(sta.status), sta.note.slice(0, 500));

  // ---- Summary ----
  where = 'summary';
  ok('the copied text carries the same records as the table',
    ids.every((id) => new RegExp(`${name(id)}\\s+${sum.rows[name(id)].t.replace(/\./g, '\\.')}\\s`).test(sum.shareText)),
    sum.shareText.slice(0, 700));
  ok('Record sorts on wins plus the chance',
    ids.every((id) => {
      const p = sum.rows[name(id)].t.split('-').map(Number);
      return Math.abs(Number(sum.rows[name(id)].v) - (p[0] + (p[2] || 0) / 2)) < 1e-9;
    }), ids.map((id) => `${sum.rows[name(id)].t}:${sum.rows[name(id)].v}`).join(' '));
  ok('the basis is said in the page’s notes', sum.note === true);
  ok('THE WEEK PICKER STEPPED BACK: records as of that week are whole numbers again, no titles',
    sum.back && Object.values(sum.back.rows).every((c) => /^\d+-\d+(-\d+)?$/.test(c.t) && !c.title),
    sum.back && `${sum.back.through}: ${Object.values(sum.back.rows).map((c) => c.t).join(' ')}`);
}

// Nothing in play: the same league with weeks 1–3 decided and week 4 untouched.
const off = child('stats-off');
if (booted(off, 'stats, no week in progress')) {
  ok('every record is whole numbers with no title',
    Object.values(off.rows).every((c) => WHOLE.test(c.t) && !c.title), Object.values(off.rows).map((c) => c.t));
  ok('the Best record tile too', /^\d+–\d+(–\d+)? Manager \d+$/.test(off.best.t) && !off.best.title, off.best);
  ok('and the note says nothing about a game being played', !/chance of winning/.test(off.note));
}
const demo = child('stats-demo');
if (booted(demo, 'stats, demo')) {
  ok('demo: every record is whole numbers with no title',
    Object.values(demo.rows).length >= 10 && Object.values(demo.rows).every((c) => WHOLE.test(c.t) && !c.title),
    Object.values(demo.rows).map((c) => c.t));
}

for (const f of fails) console.log('FAIL ' + f);
console.log(fails.length ? `${pass} passed, ${fails.length} failed` : `All ${pass} assertions passed`);
process.exit(fails.length ? 1 : 0);
