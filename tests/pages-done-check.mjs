// THE WEEK IN PROGRESS, on the five pages that are not Players or Trade.
//
//   node done-check.mjs            every scenario, one child process each
//   node done-check.mjs --dump X   print scenario X's raw facts
//
// Tim, 2026-10-04: "any games that are completely finished are counted in
// whatever data across the site … nothing is waiting on something else that it
// doesn't depend on." js/season.js marks a player `done` once his NFL game is
// over (his `projected` becomes his score, `pregame` keeps the projection) and
// a matchup `played, early` once every starter in it is done. The contract is
// written out in done-fixture.mjs, and every fixture here is built with it.
//
// Each page is booted for real against a stubbed league holding exactly that
// state — some players done, one matchup final early, the rest still going —
// and, where the claim is "nothing changes without it", against the same stub
// with the switch off.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { bootDom, waitFor } from './cap-harness.mjs';
import { emit } from './emit.mjs';
import { markDone, earlyFinal } from './done-fixture.mjs';

const self = fileURLToPath(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const cellsOf = (tr) => [...tr.children].map((td) => text(td));
const html = (page) => readFileSync(path.join(REPO, page), 'utf8');
const CONN = { leagueId: '99', season: 2026, teamId: 1 };
const r1 = (n) => Math.round(n * 10) / 10;

function trapErrors() {
  const errors = [];
  console.error = (...a) => { errors.push(a.join(' ')); };
  process.on('unhandledRejection', (r) => errors.push(`unhandled: ${String((r && r.stack) || r)}`));
  return errors;
}

// ------------------------------------------------------------------ children

const CHILDREN = {
  // ---- Analysis: tests/an-stub-season.mjs, AN_DONE=1 ----
  async analysis() {
    const errors = trapErrors();
    const { document, window } = bootDom({
      html: html('analysis.html'),
      store: { 'ff.prefs': { 'analysis.source': 'live' }, 'ff.connection': CONN },
    });
    window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
    await import(moduleUrl('js/analysis-page.js'));
    const $ = (id) => document.getElementById(id);
    const seasonIn = () => !/Loading|Reading/i.test(text($('seasonProgress')));
    await waitFor(() => document.querySelectorAll('#rosterStarters tr').length && seasonIn() &&
      document.querySelectorAll('#totalsTable tbody tr').length, 15000);
    await sleep(300);

    const roster = () => {
      const glance = {};
      for (const s of document.querySelectorAll('#teamGlance .stat')) {
        glance[text(s.querySelector('.k'))] = text(s.querySelector('.v'));
      }
      const rows = [...document.querySelectorAll('#rosterStarters tr, #rosterBench tr')].map((tr) => {
        const c = [...tr.children];
        return { slot: text(c[0]), name: text(c[1]), proj: text(c[4]), actual: text(c[5]),
          diff: text(c[6]), actualHtml: c[5].innerHTML.trim(), diffHtml: c[6].innerHTML.trim() };
      });
      return { glance, rows, split: cellsOf(document.querySelector('#rosterSplit tr') || { children: [] }),
        note: text($('rosterNote')), best: text($('rosterBest')), title: text($('rosterTitle')) };
    };
    const pick = async (id, v) => {
      const sel = $(id);
      sel.value = String(v);
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
      await sleep(350);
    };
    const hover = (teamId, player) => {
      const td = [...document.querySelectorAll(`#overviewTable tbody tr[data-team="${teamId}"] td[data-tip]`)]
        .find((c) => (c.querySelector('a.pref')?.getAttribute('href') || '').endsWith(`player=${teamId * 100 + player}`));
      if (!td) return { cell: null, card: '' };
      td.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
      const card = $('tipCard');
      const out = { cell: text(td), title: td.getAttribute('title') || '', card: card ? text(card) : '',
        rows: card ? [...card.querySelectorAll('tr')].map(cellsOf) : [] };
      td.dispatchEvent(new window.Event('mouseout', { bubbles: true }));
      return out;
    };

    const out = {
      week: Number($('weekSelect').value),
      status: text($('sourceStatus')),
      badge: text($('modeBadge')),
    };
    out.team1 = roster();
    out.card100 = hover(1, 0);       // done
    out.card305 = hover(3, 5);       // mid-game on 4.2
    out.card400 = hover(4, 0);       // mid-game on 6.6
    // The Starting lineup grid: every cell of the open week, by its title.
    const wkTitles = (sel) => [...document.querySelectorAll(`${sel} td[title]`)]
      .map((td) => td.getAttribute('title')).filter((t) => /in week 8\b/.test(t));
    out.startersWeek8 = wkTitles('#startersTable');
    out.slotTitlesWeek8 = [...document.querySelectorAll('#seasonTable td[data-pid]')]
      .map((td) => ({ pid: td.getAttribute('data-pid'), v: td.getAttribute('data-v'),
        cls: td.getAttribute('class') || '', slot: td.parentElement.getAttribute('data-slot'),
        col: [...td.parentElement.children].indexOf(td) }));
    // The LAST header row: since 2026-10-05 a group row ("Actual history")
    // sits above it wherever a week has been played or is being played.
    out.seasonHead = [...document.querySelectorAll('#seasonTable thead tr:last-child th')].map((th) => text(th));
    const totRows = [...document.querySelectorAll('#totalsTable tbody tr')];
    out.totalsHead = [...document.querySelectorAll('#totalsTable thead tr:last-child th')].map((th) => text(th));
    // "Actual history": the label, which weeks are tagged LIVE, where the heavy
    // line is, the League row, and Team 3's season column for the open week.
    const headOf = (id) => [...document.querySelectorAll(`#${id} thead tr:last-child th`)];
    const weekOf = (th) => Number((text(th).match(/^\d+/) || [])[0]);
    out.history = Object.fromEntries(['totalsTable', 'seasonTable'].map((id) => {
      const g = document.querySelector(`#${id} thead th.hist-group`);
      return [id, {
        label: g ? text(g) : null,
        span: g ? Number(g.getAttribute('colspan')) : 0,
        select: g && g.querySelector('select[data-history]') ? g.querySelector('select[data-history]').value : null,
        live: headOf(id).filter((th) => th.querySelector('.badge.live.wk-live')).map(weekOf),
        fut: headOf(id).filter((th) => /\bfut-start\b/.test(th.getAttribute('class') || '')).map(weekOf),
      }];
    }));
    const foot = document.querySelector('#totalsTable tfoot tr');
    out.league = foot ? [...foot.children].map((td) => text(td)) : null;
    out.totals = Object.fromEntries(totRows.map((tr) => [text(tr.children[0]),
      [...tr.children].map((td) => td.getAttribute('data-v') ?? text(td))]));
    out.overviewHead = [...document.querySelectorAll('#overviewTable thead th')].map((th) => text(th));
    out.overview1 = [...(document.querySelector('#overviewTable tbody tr[data-team="1"]')?.children || [])]
      .map((td) => td.getAttribute('data-v') ?? text(td));
    // The pick line for a man mid-game: his average must not count the running score.
    const cell305 = document.querySelector('#seasonTable td[data-pid="305"]');
    await pick('seasonTeamSelect', 3);
    // Team 3's open week in the season panel, slot by slot (column 1 + week).
    out.season3Week8 = [...document.querySelectorAll('#seasonSlots tr')].map((tr) => {
      const td = tr.children[1 + 8];
      return { slot: tr.getAttribute('data-slot'), pid: td.getAttribute('data-pid'),
        v: td.getAttribute('data-v'), text: text(td), cls: td.getAttribute('class') || '' };
    });
    out.band3Week8 = text(document.querySelector('#seasonTotals tr').children[1 + 8]);
    const c305 = document.querySelector('#seasonTable td[data-pid="305"]');
    if (c305) c305.dispatchEvent(new window.Event('mouseover', { bubbles: true }));
    out.pick305 = text($('seasonPick'));
    out.had305 = Boolean(cell305);
    await pick('teamSelect', 3);
    out.team3 = roster();
    await pick('teamSelect', 5);
    out.team5 = roster();
    await pick('teamSelect', 2);
    out.team2 = roster();
    out.errors = errors;
    return out;
  },

  // ---- Home: the model and the renderer, driven with a fixture ----
  async home() {
    const errors = trapErrors();
    const { document } = bootDom({ html: html('index.html'), store: { 'ff.prefs': { 'home.source': 'demo' } } });
    const mod = await import(moduleUrl('js/home-page.js'));
    await sleep(300);
    const $ = (id) => document.getElementById(id);
    const fx = homeFixture();
    const run = (o) => {
      const benchWeek = mod.benchWeekFor(o.schedule, o.week, o.rosters);
      const m = mod.buildModel({ ...o, benchWeek, benchRosters: benchWeek === o.week ? null : o.lastWeek });
      mod.render(m);
      return {
        benchWeek,
        benchWeekComplete: m.benchWeekComplete,
        games: [...document.querySelectorAll('#matchups .game')].map((g) => ({
          head: text(g.querySelector('.ghead span')),
          sides: [...g.querySelectorAll('.side')].map((s) => ({
            cls: s.getAttribute('class'), name: text(s.querySelector('.tname')),
            proj: text(s.querySelector('.tproj')), score: text(s.querySelector('.tscore')),
          })),
          meta: text(g.querySelector('.gmeta')),
        })),
        bench: [...document.querySelectorAll('#bench tbody tr')].map(cellsOf),
        benchEmpty: text(document.querySelector('#bench .empty')),
        benchKey: text($('benchKey')),
        benchScaleKey: text($('benchScaleKey')),
        injuries: [...document.querySelectorAll('#injuries tbody tr')].map(cellsOf),
        title: text($('matchupsTitle')),
      };
    };
    return {
      part: run(fx.part),
      // The same week with Team 1's bench man still mid-game.
      benchLive: run(fx.benchLive),
      // …and with both finished squads' bench men still mid-game.
      benchBoth: run(fx.benchBoth),
      // The switch off: the same league with no `done` and no `early` anywhere.
      plain: run(fx.plain),
      expect: fx.expect,
      errors,
    };
  },

  // ---- Stats: tests/opp-season-stub.mjs, FF_SCEN=part | part1 | mid ----
  async stats() {
    const errors = trapErrors();
    register('./opp-loader.mjs', import.meta.url);
    const { document, window } = bootDom({
      html: html('stats.html'),
      store: { 'ff.prefs': { 'stats.source': 'live' }, 'ff.connection': CONN },
    });
    await import(moduleUrl('js/stats-page.js'));
    const $ = (id) => document.getElementById(id);
    await waitFor(() => text($('modeBadge')) === 'Live' &&
      document.querySelectorAll('#weeklyTable tbody tr').length === 4, 8000);
    // The per-week roster read (schedule luck + the players graph) lands later.
    await waitFor(() => /dots over|No player has|could be read/.test(text($('fitPlayersNote')) + text($('chartFitPlayers'))), 6000);
    await sleep(200);
    const grid = () => ({
      head: [...document.querySelectorAll('#weeklyHead th')].map((th) => text(th)),
      rows: [...document.querySelectorAll('#weeklyTable tbody tr')].map((tr) =>
        [...tr.children].map((td) => ({ t: text(td), html: td.innerHTML.trim(), cls: td.getAttribute('class') || '' }))),
      foot: [...(document.querySelector('#weeklyTable tfoot tr')?.children || [])].map((td) => text(td)),
      key: text($('weeklyKey')),
      note: text($('weeklyNote')),
    });
    const out = { actual: grid() };
    for (const metric of ['projected', 'luck', 'actualDiff']) {
      const btn = document.querySelector(`#weeklyMetric button[data-metric="${metric}"]`);
      if (btn) {
        const ev = new window.Event('click', { bubbles: true });
        btn.dispatchEvent(ev);
        out[metric] = grid();
      }
    }
    out.main = [...document.querySelectorAll('#mainTable tbody tr')].map(cellsOf);
    out.mainHead = [...document.querySelectorAll('#mainTable thead tr:last-child th')].map((th) => text(th));
    out.glance = Object.fromEntries([...document.querySelectorAll('#glance .stat')]
      .map((s) => [text(s.querySelector('.k')), text(s.querySelector('.v'))]));
    out.playerDots = [...document.querySelectorAll('#chartFitPlayers a, #chartFitPlayers [data-href], #chartFitPlayers circle')]
      .map((el) => ({ href: el.getAttribute('href') || el.getAttribute('data-href') || '',
        title: el.getAttribute('title') || el.getAttribute('aria-label') || text(el) }));
    out.playersChart = $('chartFitPlayers').innerHTML.slice(0, 6000);
    out.playersNote = text($('fitPlayersNote'));
    out.teamsNote = text($('fitTeamsNote'));
    out.distNote = text($('distNote'));
    out.pageSub = text($('pageSub'));
    out.everything = text(document.body);
    out.errors = errors;
    return out;
  },

  // ---- Schedule and Summary: tests/cap-stub-season.mjs, CAP_EARLY ----
  async schedule() {
    const errors = trapErrors();
    const { document, map } = bootDom({
      html: html('schedule.html'),
      store: { 'ff.prefs': { 'schedule.source': 'live', 'schedule.week': 'all' }, 'ff.connection': CONN },
    });
    await import(moduleUrl('js/schedule-page.js'));
    const $ = (id) => document.getElementById(id);
    await waitFor(() => (globalThis.__simCalls || []).length &&
      document.querySelectorAll('#simTable tbody tr:not(.empty-row)').length === 10, 25000);
    await sleep(100);
    const stub = await import('./cap-stub-season.mjs');
    const simHead = [...document.querySelectorAll('#simTable thead th')].map((th) => text(th));
    const records = {};
    for (const tr of document.querySelectorAll('#simTable tbody tr')) {
      const td = [...tr.children];
      records[text(td[0])] = { cells: td.map((c) => text(c)) };
    }
    const sched = await stub.fetchSchedule();
    const wk = stub.EARLY_WEEK || 4;
    const { teams } = await stub.fetchWeekRosters(wk);

    // THE SPREAD, worked out here from the stub rather than read back off the
    // page: every final game's score against a started-lineup projection.
    // `pre` uses the projection as it stood before kickoff (`projectedTotal`);
    // `now` uses the lineup as it reads today, where a finished man's
    // `projected` is his score — the mistake that would shrink the spread.
    const forecast = await import('../js/forecast.js');
    const sigmaWith = async (pickProj) => {
      const games = [];
      for (const g of sched.games.filter((x) => x.played)) {
        const wkTeams = new Map((await stub.fetchWeekRosters(g.week)).teams.map((t) => [t.id, t]));
        games.push({
          homeActual: g.homeScore, homeProjected: pickProj(wkTeams.get(g.homeId)),
          awayActual: g.awayScore, awayProjected: pickProj(wkTeams.get(g.awayId)),
        });
      }
      return forecast.calibrateSigma(games);
    };
    const sigmaPre = await sigmaWith((t) => t.projectedTotal);
    const sigmaNow = await sigmaWith((t) => r1(t.starters.reduce((a, p) => a + (p.projected || 0), 0)));
    const stored = [...map.keys()].filter((k) => /snap|archive|reading/i.test(k));
    return {
      sigmaPre, sigmaNow, stored, storeKeys: [...map.keys()],
      calls: globalThis.__simCalls || [],
      simHead, records,
      note: text($('simNote')),
      matchups: [...document.querySelectorAll('#matchups .game, #matchupList .game, .game')].slice(0, 80).map((g) => text(g)),
      grid: text($('scheduleGrid') || $('gridWrap')),
      forecast: [...document.querySelectorAll('#forecastTable tbody tr')].map(cellsOf),
      forecastStats: Object.fromEntries([...document.querySelectorAll('#forecastStats .stat')]
        .map((s) => [text(s.querySelector('.k')), text(s.querySelector('.v'))])),
      archive: text($('archiveStatus') || $('archive')),
      earlySquads: stub.earlySquads(),
      earlyWeek: stub.EARLY_WEEK,
      weekGames: sched.byWeek.get(wk),
      started: Object.fromEntries(teams.map((t) => [t.id, {
        projectedTotal: t.projectedTotal,
        nowSum: r1(t.starters.reduce((a, p) => a + (p.projected || 0), 0)),
      }])),
      errors,
    };
  },

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
    const $ = (id) => document.getElementById(id);
    await waitFor(() => /simulated seasons/.test(text($('simStatus'))), 40000);
    await sleep(100);
    const head = [...document.querySelectorAll('#summaryTable thead th')].map((th) => text(th));
    const rows = {};
    for (const tr of document.querySelectorAll('#summaryTable tbody tr')) {
      const td = [...tr.children];
      rows[text(td[0])] = Object.fromEntries(head.map((h, i) => [h, text(td[i])]));
    }
    const stub = await import('./cap-stub-season.mjs');
    return {
      calls: globalThis.__simCalls || [],
      head, rows,
      through: $('throughWeek') ? $('throughWeek').value : null,
      status: text($('simStatus')),
      sub: text($('pageSub')),
      earlySquads: stub.earlySquads(),
      errors,
    };
  },
};

// ------------------------------------------------------- the Home fixture
//
// Six squads, week 2 in progress, week 1 final. Each squad starts a QB, an RB
// and a WR and benches an RB.
//   A v B   FINAL EARLY: all six starters done. A's bench RB is done too.
//   C v D   still going: C's QB is done (and listed QUESTIONABLE), D's RB is
//           mid-game on 3.0 and is listed OUT.
//   E v F   nobody has kicked off.
function homeFixture() {
  const names = ['Aardvarks', 'Badgers', 'Cobras', 'Dingoes', 'Egrets', 'Falcons'];
  const teams = names.map((n, i) => ({ id: i + 1, name: n }));
  const player = (id, name, position, lineupSlotId, projected, actual, injuryStatus = 'ACTIVE') => ({
    playerId: id, name, position, proTeam: 'KC', lineupSlotId,
    slot: lineupSlotId === 20 ? 'BE' : position, started: lineupSlotId !== 20,
    projected, actual, seasonProjected: projected * 13, injuryStatus, percentOwned: 50,
  });
  const squad = (t, i, withActuals) => {
    const act = (v) => (withActuals ? v : null);
    const starters = [
      player(t.id * 100 + 1, `QB ${t.name}`, 'QB', 0, 18 + i, act(20 + i), t.id === 3 ? 'QUESTIONABLE' : 'ACTIVE'),
      player(t.id * 100 + 2, `RB ${t.name}`, 'RB', 2, 12 + i, act(6 + i), t.id === 4 ? 'OUT' : 'ACTIVE'),
      player(t.id * 100 + 3, `WR ${t.name}`, 'WR', 4, 11 + i, act(9 + i)),
    ];
    const bench = [player(t.id * 100 + 9, `Bench ${t.name}`, 'RB', 20, 6, act(14 + i))];
    const sum = (arr, k) => {
      const v = arr.map((p) => p[k]).filter((x) => typeof x === 'number');
      return v.length ? r1(v.reduce((a, b) => a + b, 0)) : null;
    };
    return {
      id: t.id, name: t.name, abbrev: t.name.slice(0, 3).toUpperCase(),
      players: [...starters, ...bench], starters, bench,
      projectedTotal: sum(starters, 'projected'),
      actualTotal: sum(starters, 'actual'), benchActualTotal: sum(bench, 'actual'),
      seasonProjectedTotal: r1(sum(starters, 'projected') * 13),
    };
  };
  const game = (week, h, a, played, scores) => {
    const g = {
      week, homeId: h, homeName: names[h - 1], homeScore: null,
      awayId: a, awayName: names[a - 1], awayScore: null, played: false, margin: null, winner: null,
    };
    if (!played) return g;
    const hs = scores.get(h);
    const as = scores.get(a);
    return { ...g, played: true, homeScore: hs, awayScore: as, margin: r1(hs - as),
      winner: hs === as ? 'tie' : hs > as ? 'home' : 'away' };
  };
  const pairs = [[1, 2], [3, 4], [5, 6]];

  // Week 1: final for everybody.
  const week1 = teams.map((t, i) => squad(t, i, true));
  const s1 = new Map(week1.map((t) => [t.id, t.actualTotal]));
  const games1 = pairs.map(([h, a]) => game(1, h, a, true, s1));

  // Week 2 before anything is marked: ESPN's projections, nobody scored.
  const pre = teams.map((t, i) => squad(t, i, true));
  // `benches`: how many of the two finished squads' bench men are done too —
  // 2 (both), 1 (Aardvarks' is mid-game on 2.5) or 0 (both mid-game).
  const mark = (benches) => markDone(
    pre,
    (p, t) => (t.id <= 2 && p.started) || (t.id === 1 && !p.started && benches === 2) ||
      (t.id === 2 && !p.started && benches >= 1) || (t.id === 3 && p.position === 'QB' && p.started),
    (p, t) => (t.id === 4 && p.position === 'RB' && p.started ? 3.0
      : t.id <= 2 && !p.started ? 2.5 : null),
  );
  const build = (week2, early) => {
    const s2 = new Map(week2.map((t) => [t.id, t.actualTotal]));
    const games2 = pairs.map(([h, a], i) => (early && i === 0
      ? earlyFinal(game(2, h, a, false), s2.get(h), s2.get(a))
      : game(2, h, a, false)));
    const byWeek = new Map([[1, games1], [2, games2]]);
    return {
      schedule: { leagueName: 'Part League', teams, weeks: [1, 2], byWeek, games: [...games1, ...games2] },
      rosters: { week: 2, teams: week2 },
      lastWeek: { week: 1, teams: week1 },
      week: 2, teamId: 3, isDemo: false,
    };
  };
  // The switch off: the same week with nobody marked and nothing final.
  const plainTeams = teams.map((t, i) => squad(t, i, false));
  const part = build(mark(2), true);
  return {
    part,
    benchLive: build(mark(1), true),
    benchBoth: build(mark(0), true),
    plain: build(plainTeams, false),
    expect: {
      // A: 20 + 6 + 9 = 35.0; B: 21 + 7 + 10 = 38.0 -> Badgers by 3.0.
      a: 35, b: 38,
      projA: pre[0].projectedTotal, projB: pre[1].projectedTotal,
      cobrasQbPregame: 20,   // 18 + i, i = 2
    },
  };
}

// --------------------------------------------------------------- child mode

if (process.argv[2] && process.argv[2] !== '--dump') {
  try {
    emit(await CHILDREN[process.argv[2]](), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

const RUNS = {
  analysis: { child: 'analysis', imp: './an-register.mjs', env: { AN_DONE: '1' } },
  'analysis-floor': { child: 'analysis', imp: './an-register.mjs', env: { AN_DONE: '1', AN_FLOORS: '{"K":15}' } },
  'analysis-off': { child: 'analysis', imp: './an-register.mjs', env: {} },
  home: { child: 'home', env: {} },
  'stats-part': { child: 'stats', env: { FF_SCEN: 'part' } },
  'stats-part1': { child: 'stats', env: { FF_SCEN: 'part1' } },
  'stats-mid': { child: 'stats', env: { FF_SCEN: 'mid' } },
  'schedule-early': { child: 'schedule', imp: './cap-register.mjs', env: { CAP_EARLY: '1' } },
  'schedule-off': { child: 'schedule', imp: './cap-register.mjs', env: {} },
  'schedule-all': { child: 'schedule', imp: './cap-register.mjs', env: { CAP_EARLY: 'all' } },
  'summary-early': { child: 'summary', imp: './cap-register.mjs', env: { CAP_EARLY: '1' } },
  'summary-off': { child: 'summary', imp: './cap-register.mjs', env: {} },
  'summary-all': { child: 'summary', imp: './cap-register.mjs', env: { CAP_EARLY: 'all' } },
  'summary-week1': { child: 'summary', imp: './cap-register.mjs', env: { CAP_EARLY: '1', CAP_DECIDED: '0' } },
};

function child(name) {
  const cfg = RUNS[name];
  const env = { ...process.env };
  for (const k of ['AN_DONE', 'AN_FLOORS', 'FF_SCEN', 'CAP_EARLY', 'CAP_DECIDED', 'CAP_WIRE']) delete env[k];
  Object.assign(env, cfg.env);
  const args = cfg.imp ? ['--import', cfg.imp, self, cfg.child] : [self, cfg.child];
  const res = spawnSync(process.execPath, args, {
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

// ------------------------------------------------------------------ parent

let pass = 0;
const fails = [];
let where = '';
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`[${where}] ${name}${detail !== '' ? ` — ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 600)}` : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const f1 = (n) => n.toFixed(1);
const sg = (n) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
const booted = (r, name) => {
  where = name;
  ok('the page boots on the fixture', !r.boot, r.boot);
  if (!r.boot) ok('with no console errors', (r.errors || []).length === 0, (r.errors || []).join(' || '));
  return !r.boot;
};

// =============================================================== 1. Analysis
//
// tests/an-stub-season.mjs under AN_DONE: week 8 is open, Team 1 v Team 2 is
// final early, Team 3 has three finished men and one mid-game, Teams 4+ nobody.
const proj8 = (i) => r1((20 - i) + 2.4);
const act8 = (i) => r1(15 - i * 0.7);

function analysisChecks(an, name, floors) {
  if (!booted(an, name)) return;
  // -- state.playedWeeks: one early game is not a played week --
  ok('IT STILL OPENS ON THE WEEK IN PROGRESS: one matchup final early does not make week 8 "played"',
    an.week === 8, `opened on week ${an.week}`);
  ok('and the status line still calls that week not played', /Week 8 · 10 teams.*not played yet/.test(an.status), an.status);

  // -- the roster detail, Team 1: everyone finished --
  const t1 = an.team1;
  ok('Team 1’s fifteen rows are there', t1.rows.length === 15, t1.rows.length);
  ok('A FINISHED PLAYER’S Proj IS THE PROJECTION HE STARTED WITH, not his score a second time',
    t1.rows.every((r, i) => r.proj === f1(proj8(i))), t1.rows.map((r) => r.proj).join(' '));
  ok('and his Actual is his score — the FLEX who scored nothing reads 0.0, not a dash',
    t1.rows.every((r, i) => r.actual === f1(i === 6 ? 0 : act8(i))), t1.rows.map((r) => r.actual).join(' '));
  ok('and his Diff is the one against the other',
    t1.rows.every((r, i) => r.diff === sg(r1((i === 6 ? 0 : act8(i)) - proj8(i)))), t1.rows.map((r) => r.diff).join(' '));
  ok('the totals follow: Projected 165.6 (pre-game), Actual 99.0, Diff −66.6, Bench points 41.7',
    t1.glance.Projected === '165.6' && t1.glance.Actual === '99.0' && t1.glance.Diff === '-66.6' &&
    t1.glance['Bench points'] === '41.7', t1.glance);
  ok('the Starting lineup band is the pre-game projection', t1.split.includes('165.6'), t1.split);
  ok('the basis is said once, behind the toggle (rule 7)',
    /Week 8 is still being played\. A player whose NFL game is over shows the projection he started with/.test(t1.note),
    t1.note.slice(0, 300));

  // -- Team 3: three finished, one mid-game on 4.2, the rest not kicked off --
  const t3 = an.team3;
  const done3 = new Set([0, 1, 3]);
  ok('Team 3: the three finished men show projection, score and diff',
    [...done3].every((i) => t3.rows[i].proj === f1(proj8(i)) && t3.rows[i].actual === f1(act8(i)) &&
      t3.rows[i].diff === sg(r1(act8(i) - proj8(i)))), [...done3].map((i) => t3.rows[i]));
  ok('A PLAYER STILL TO FINISH HAS A BLANK Actual AND A BLANK Diff — the man on 4.2 mid-game included',
    t3.rows.every((r, i) => done3.has(i) || (r.actualHtml === '' && r.diffHtml === '')),
    t3.rows.filter((r, i) => !done3.has(i)).map((r) => `${r.name}:${r.actual}|${r.diff}`).join(' '));
  ok('and still shows the projection ESPN has for him',
    t3.rows.every((r, i) => r.proj === f1(proj8(i))), t3.rows.map((r) => r.proj).join(' '));
  ok('Team 3’s totals count finished men only: Actual 42.2, Diff −21.0 (the Diff column added up), no bench points yet',
    t3.glance.Projected === '165.6' && t3.glance.Actual === '42.2' && t3.glance.Diff === '-21.0' &&
    t3.glance['Bench points'] === '—', t3.glance);

  // -- Team 5: nobody finished; Team 2: every starter finished, one bench man not --
  const t5 = an.team5;
  ok('Team 5, nobody finished: every Actual and Diff blank — the QB on 6.6 mid-game too — and no totals',
    t5.rows.every((r) => r.actualHtml === '' && r.diffHtml === '') && t5.glance.Actual === '—' &&
    t5.glance.Diff === '—' && t5.glance.Projected === '165.6',
    `${t5.rows.map((r) => r.actual).join(' ')} / ${JSON.stringify(t5.glance)}`);
  const t2 = an.team2;
  ok('Team 2: its bench man still playing is blank, the fourteen finished are not',
    t2.rows.every((r, i) => (i === 9 ? r.actualHtml === '' : r.actual === f1(act8(i)))),
    t2.rows.map((r) => r.actual).join(' '));
  ok('and its starters’ score is the early final’s: 109.8', t2.glance.Actual === '109.8', t2.glance);

  // -- the card: Proj row pre-game, Act row a result only --
  const wk = (card, label) => {
    const head = card.rows[0] || [];
    const i = head.findIndex((h) => /^8\b/.test(h));
    const row = card.rows.find((r) => r[0] === label) || [];
    return row[i];
  };
  ok('THE CARD of a finished man: week 8’s Proj is his pre-game 22.4 and Act his 15.0',
    wk(an.card100, 'Proj') === '22.4' && wk(an.card100, 'Act') === '15.0',
    `${wk(an.card100, 'Proj')} / ${wk(an.card100, 'Act')}`);
  ok('the card’s glance line shows what he scored as this week’s number', /Proj 15\.0/.test(an.card100.card),
    an.card100.card.slice(0, 80));
  ok('THE CARD of a man mid-game: no Act for week 8 (4.2 so far is not a result), Proj still 17.4',
    wk(an.card305, 'Proj') === '17.4' && wk(an.card305, 'Act') === '',
    `${wk(an.card305, 'Proj')} / ${wk(an.card305, 'Act')}`);
  ok('likewise the QB on 6.6', wk(an.card400, 'Act') === '' && wk(an.card400, 'Proj') === '22.4',
    `${wk(an.card400, 'Proj')} / ${wk(an.card400, 'Act')}`);
  ok('HIS AVERAGE SO FAR counts seven finished games, not eight with the running score',
    /avg 11\.5 over 7 games/.test(an.pick305), an.pick305);

  // -- the grids price a finished man at his score, and say so --
  ok('the Starting lineup grid says a finished man’s week-8 number is a score, never "ESPN projects"',
    an.startersWeek8.length > 0 && an.startersWeek8.every((t) => /^T1 Player \d\d scored (nothing|[\d.]+) in week 8\./.test(t)),
    an.startersWeek8.slice(0, 3));
  // -- "ACTUAL HISTORY" (Tim, 2026-10-05): the week being played is history --
  //
  // "just show the numbers they actually recieved for that week, not anything
  // different." This assertion used to read 107.7 — the best lineup picked
  // AFTER THE FACT on the scores, a lineup Team 1 never started. Team 1 started
  // players 00–08 and they scored 99.0 (the FLEX's 0 included), which is also
  // what the A-week grid two assertions down has always said.
  const colOf = (n) => an.totalsHead.findIndex((h) => new RegExp(`^${n}(\\D|$)`).test(h));
  const w8 = colOf(8);
  const w9 = colOf(9);
  ok('WEEKLY TOTALS SHOWS TEAM 1’S WEEK 8 AT WHAT ITS REAL STARTERS SCORED: 99.0, not a best lineup picked afterwards',
    Number(an.totals['Team 1'][w8]) === 99, an.totals['Team 1'][w8]);
  ok('Team 2, every starter finished: 109.8 — the early final’s own score',
    Number(an.totals['Team 2'][w8]) === 109.8, an.totals['Team 2'][w8]);
  ok('Team 3 counts its three finished starters only: 42.2 (15.0 + 14.3 + 12.9), the 4.2 mid-game left out',
    Number(an.totals['Team 3'][w8]) === 42.2, an.totals['Team 3'][w8]);
  ok('a squad with nobody finished shows a dash for the week — no score yet, and no projection in its place',
    an.totals['Team 5'][w8] === '—', an.totals['Team 5'][w8]);
  const hist = an.history || {};
  for (const id of ['totalsTable', 'seasonTable']) {
    const h = hist[id] || {};
    ok(`${id}: weeks 1–8 sit under “Actual history”, its select on Actual`,
      /history$/.test(h.label || '') && h.span === 8 && h.select === 'actual', JSON.stringify(h));
    ok(`${id}: THE WEEK BEING PLAYED CARRIES THE LIVE TAG, and only that week`,
      JSON.stringify(h.live) === '[8]', JSON.stringify(h.live));
    ok(`${id}: the heavy line is before week 9, the first week still to come`,
      JSON.stringify(h.fut) === '[9]', JSON.stringify(h.fut));
  }
  ok('the League row leaves the week being played blank (part scores are not averaged) and averages week 7',
    Array.isArray(an.league) && an.league[0] === 'League' && an.league[w8] === '' && an.league[colOf(7)] === '109.8',
    JSON.stringify(an.league));
  // Team 3 in the season panel: the three finished men at their scores, the
  // rest a dash that still names the man, and the band the same 42.2.
  const s3 = an.season3Week8 || [];
  const scored3 = { QB: ['300', '15'], RB1: ['301', '14.3'], WR1: ['303', '12.9'] };
  ok('SEASON BY WEEK, Team 3’s week 8: the finished starters show their scores in the slots they started in',
    Object.entries(scored3).every(([slot, [pid, v]]) => {
      const c = s3.find((x) => x.slot === slot);
      return c && c.pid === pid && c.v === v;
    }), JSON.stringify(s3));
  ok('and every starter still to finish is a dash — TE Player 05 on 4.2 mid-game included',
    s3.filter((x) => !scored3[x.slot]).length === 6 &&
    s3.filter((x) => !scored3[x.slot]).every((x) => x.text === '—' && x.v === null && x.pid) &&
    s3.find((x) => x.slot === 'TE').pid === '305', JSON.stringify(s3));
  ok('the Starting lineup band under it is the same 42.2', an.band3Week8 === '42.2', an.band3Week8);
  const iTot = an.overviewHead.indexOf('Total');
  const iK = an.overviewHead.indexOf('K');
  ok('the A-week grid shows Team 1’s started lineup at its score: Total 99.0, kicker 9.4',
    Number(an.overview1[iTot]) === 99 && Number(an.overview1[iK]) === 9.4, `${an.overview1[iTot]} / ${an.overview1[iK]}`);
  if (floors) {
    // K floor 15: a kicker projected 14.7 in week 9 is lifted to it, so a week
    // STILL TO COME is above its raw 168.3. (This read week 8 until 2026-10-05;
    // the week being played is history now and is never floored.)
    ok('the floor is live in this scenario: a squad’s week 9 is lifted above its raw 168.3',
      Number(an.totals['Team 5'][w9]) > 168.3, an.totals['Team 5'][w9]);
    // …and Team 1's kicker, who SCORED 9.4 in week 8, is not: still 99.0 above.
  }
}

const an = child('analysis');
analysisChecks(an, 'analysis');
const anFloor = child('analysis-floor');
analysisChecks(anFloor, 'analysis, kicker floor 15', true);

// The switch off: the same stub with no `done` and no early game.
const anOff = child('analysis-off');
if (booted(anOff, 'analysis, switch off')) {
  ok('opens on week 8, not played yet, as it always did', anOff.week === 8 && /not played yet/.test(anOff.status), anOff.status);
  ok('the rows are ESPN’s projection and ESPN’s actual, untouched',
    anOff.team1.rows.every((r, i) => r.proj === f1(proj8(i)) && r.actual === f1(act8(i))),
    anOff.team1.rows.map((r) => `${r.proj}/${r.actual}`).join(' '));
  ok('the totals are ESPN’s: 165.6 and 109.8', anOff.team1.glance.Projected === '165.6' &&
    anOff.team1.glance.Actual === '109.8' && anOff.team1.glance.Diff === '-55.8', anOff.team1.glance);
  ok('and the note says nothing about a week in progress', !/still being played/.test(anOff.team1.note));
  ok('no grid title claims a score', anOff.startersWeek8.every((t) => !/ scored /.test(t)), anOff.startersWeek8.slice(0, 2));
}

// =================================================================== 2. Home
const home = child('home');
if (booted(home, 'home')) {
  const game = (run, a) => run.games.find((g) => g.sides.some((s) => s.name.startsWith(a)));
  const ab = game(home.part, 'Aardvarks');
  ok('THE EARLY GAME’S CARD SAYS Final', ab.head === 'Final', ab.head);
  ok('with the right winner and margin: Badgers by 3.0, 38.0 to 35.0',
    ab.meta === 'Badgers by 3.0' && ab.sides[0].score === '35.0' && ab.sides[1].score === '38.0' &&
    /\blose\b/.test(ab.sides[0].cls) && /\bwin\b/.test(ab.sides[1].cls), ab);
  ok('its Proj column is still the pre-game projection (41.0 and 44.0), not the scores again',
    ab.sides[0].proj === '41.0' && ab.sides[1].proj === '44.0', ab.sides.map((s) => s.proj));
  ok('the other two games are still Upcoming with no score',
    home.part.games.filter((g) => g !== ab).every((g) => g.head === 'Upcoming' && g.sides.every((s) => s.score === '—')),
    home.part.games.map((g) => g.head));
  ok('it stays on week 2', /^Week 2\b/.test(home.part.title), home.part.title);
  ok('the witness: with nothing final the same card is Upcoming',
    game(home.plain, 'Aardvarks').head === 'Upcoming', game(home.plain, 'Aardvarks').head);

  // -- bench report --
  ok('the bench report is week 2’s, for the two squads whose game is final and nobody else',
    home.part.benchWeek === 2 && same(home.part.bench.map((r) => r[0]).sort(), ['Aardvarks', 'Badgers']),
    home.part.bench.map((r) => r[0]));
  ok('Started is not shaded and says why: two squads are not the league',
    /Started is not shaded/.test(home.part.benchScaleKey) && home.part.benchWeekComplete === false, home.part.benchScaleKey);
  ok('A FINISHED SQUAD WHOSE BENCH MAN IS STILL PLAYING WAITS: his 2.5 so far is not a bench point',
    same(home.benchLive.bench.map((r) => r[0]), ['Badgers']), home.benchLive.bench);
  ok('and when no finished squad has a settled bench, the panel stays on last week’s full report',
    home.benchBoth.benchWeek === 1 && home.benchBoth.bench.length === 6 &&
    /Week 1, the latest final week/.test(home.benchBoth.benchKey),
    `${home.benchBoth.benchWeek} / ${home.benchBoth.bench.length} rows / ${home.benchBoth.benchKey}`);

  // -- injuries --
  const inj = (run, who) => (run.injuries.find((r) => r[0].startsWith(who)) || []);
  ok('INJURIES: a finished starter’s Proj is his pre-game 20.0, not the 22.0 he scored',
    inj(home.part, 'QB Cobras')[4] === '20.0', inj(home.part, 'QB Cobras'));
  ok('a starter still playing keeps ESPN’s projection', inj(home.part, 'RB Dingoes')[4] === '15.0', inj(home.part, 'RB Dingoes'));
  ok('switch off: the same two rows with the same projections, and last week’s bench report',
    inj(home.plain, 'QB Cobras')[4] === '20.0' && inj(home.plain, 'RB Dingoes')[4] === '15.0' &&
    home.plain.benchWeek === 1 && home.plain.bench.length === 6, home.plain.injuries);
}

// ================================================================== 3. Stats
const nums = (s) => (s.match(/-?\d+\.\d+/g) || []).map(Number);
const st = child('stats-part');
if (booted(st, 'stats, week 3 in progress')) {
  const row = (grid, team) => grid.rows.find((r) => r[0].t === team);
  const g = st.actual;
  ok('the week in progress has its column', same(g.head, ['Team', '1', '2', '3', 'Avg']), g.head);
  ok('THE FINISHED MATCHUP’S SCORES ARE SHOWN: Team 1 106, Team 4 136',
    row(g, 'Team 1')[3].t === '106' && row(g, 'Team 4')[3].t === '136', `${row(g, 'Team 1')[3].t} / ${row(g, 'Team 4')[3].t}`);
  ok('THE TEAMS STILL PLAYING ARE LEFT BLANK — an empty cell, not the dash a bye gets',
    row(g, 'Team 2')[3].html === '' && row(g, 'Team 3')[3].html === '',
    `"${row(g, 'Team 2')[3].html}" / "${row(g, 'Team 3')[3].html}"`);
  for (const metric of ['projected', 'luck', 'actualDiff']) {
    ok(`and on the ${metric} measure too`, st[metric] && row(st[metric], 'Team 2')[3].html === '' &&
      row(st[metric], 'Team 1')[3].t !== '', st[metric] && row(st[metric], 'Team 2')[3].html);
  }
  ok('the part-finished week is not coloured: two finished squads are not a league',
    g.rows.every((r) => !/heat/.test(r[3].cls)), g.rows.map((r) => r[3].cls));
  ok('the finished weeks still are', g.rows.some((r) => /heat/.test(r[1].cls)) && g.rows.some((r) => /heat/.test(r[2].cls)));
  ok('the League row is blank for it, and its Avg is the two complete weeks’ (117 and 119 -> 118)',
    same(g.foot, ['League', '117', '119', '', '118']), g.foot);
  ok('each team’s Avg is over its own games: Team 1 (102+104+106)/3 = 104, Team 2 (112+114)/2 = 113',
    row(g, 'Team 1')[4].t.startsWith('104') && row(g, 'Team 2')[4].t.startsWith('113'),
    `${row(g, 'Team 1')[4].t} / ${row(g, 'Team 2')[4].t}`);
  ok('the basis is said behind the toggle (rule 7)', /Week 3 is still being played\. A matchup is counted as soon as every starter/.test(g.note));

  // -- the other panels, on unequal game counts --
  const m = Object.fromEntries(st.main.map((r) => [r[0], r]));
  ok('the main table counts the early game: Team 4 is 3–0 and Team 1 0–3, the others 1–1',
    m['Team 4'][1] === '3–0' && m['Team 1'][1] === '0–3' && m['Team 2'][1] === '1–1' && m['Team 3'][1] === '1–1',
    st.main.map((r) => r[1]));
  ok('per-game averages by each team’s OWN games: Team 4 402/3 = 134.0, Team 2 226/2 = 113.0',
    nums(m['Team 4'][2])[0] === 134 && nums(m['Team 2'][2])[0] === 113, `${m['Team 4'][2]} / ${m['Team 2'][2]}`);
  ok('nothing on the page is NaN, undefined or Infinity', !/NaN|undefined|Infinity/.test(st.everything),
    (st.everything.match(/.{40}(NaN|undefined|Infinity).{40}/) || [''])[0]);

  // -- the players graph --
  // Finished in week 3: QB 1 (103 -> 106), QB 4 (133 -> 136) and Team 2's bench
  // man (1 -> 7). Team 2's QB is mid-game on 5.5 and is NOT a dot.
  ok('THE PLAYERS GRAPH plots the three finished men of the week in progress, and not the one mid-game',
    /3 dots over 3 weeks \(weeks 1–3\)/.test(st.playersNote) && /Actual against Projected, 3 dots/.test(st.playersChart),
    st.playersNote.slice(0, 260));
  const pts = [[103, 106], [133, 136], [1, 7]];
  const mx = pts.reduce((a, p) => a + p[0], 0) / 3;
  const my = pts.reduce((a, p) => a + p[1], 0) / 3;
  const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  const fit = /actual = (-?[\d.]+) \+ ([\d.]+) × projected/.exec(st.playersNote) || [];
  ok(`each ACROSS his pre-game projection, not his score: the fitted line is ${f1(my - slope * mx)} + ${slope.toFixed(2)}x`,
    Number(fit[1]) === r1(my - slope * mx) && Number(fit[2]) === Math.round(slope * 100) / 100, fit.slice(1));
  ok('and the note says so', /Week 3 is still being played: a player is plotted once his own NFL game is over/.test(st.playersNote));
  ok('the teams graph has ten dots: four teams over two weeks and the two finished in week 3',
    /10 dots: 4 teams, weeks 1–3/.test(st.teamsNote), st.teamsNote.slice(0, 330));
}

const st1 = child('stats-part1');
if (booted(st1, 'stats, week 1 in progress')) {
  const m = Object.fromEntries(st1.main.map((r) => [r[0], r]));
  const iOpp = st1.mainHead.indexOf('Opp proj');
  ok('the two finished squads have their week: Team 2 1–0 on 112.0, Team 1 0–1 on 102.0',
    m['Team 2'][1] === '1–0' && nums(m['Team 2'][2])[0] === 112 && m['Team 1'][1] === '0–1' && nums(m['Team 1'][2])[0] === 102,
    `${m['Team 2'].slice(1, 3)} / ${m['Team 1'].slice(1, 3)}`);
  ok('A SQUAD WITH NO FINISHED GAME HAS DASHES, not an average of nothing printed as 0.0 and a −106 skill',
    ['Team 3', 'Team 4'].every((t) => m[t].every((c, i) => i < 2 || i === iOpp || c === '—')),
    `${m['Team 3'].join(' ')} || ${m['Team 4'].join(' ')}`);
  ok('LS, PS and AS wait for everybody', st1.main.every((r) => r.slice(-3).every((c) => c === '—')), st1.main.map((r) => r.slice(-3).join('/')));
  const g = st1.actual;
  ok('the week grid: 102 and 112 shown, the other two blank, no colour, no League figure',
    g.rows.find((r) => r[0].t === 'Team 1')[1].t === '102' && g.rows.find((r) => r[0].t === 'Team 2')[1].t === '112' &&
    g.rows.find((r) => r[0].t === 'Team 3')[1].html === '' && g.rows.every((r) => !/heat/.test(r[1].cls)) &&
    same(g.foot, ['League', '']), `${g.rows.map((r) => r[1].t).join(' ')} / ${g.foot.join('|')}`);
  ok('the score count is the scores there are: 2', /— 2 scores\./.test(st1.distNote), st1.distNote);
  ok('nothing on the page is NaN, undefined or Infinity', !/NaN|undefined|Infinity/.test(st1.everything),
    (st1.everything.match(/.{40}(NaN|undefined|Infinity).{40}/) || [''])[0]);
}

const stMid = child('stats-mid');
if (booted(stMid, 'stats, switch off')) {
  const g = stMid.actual;
  ok('two complete weeks: every cell filled and coloured as before, League 117 / 119 / 118',
    same(g.head, ['Team', '1', '2', 'Avg']) && g.rows.every((r) => r.every((c) => c.html !== '')) &&
    same(g.foot, ['League', '117', '119', '118']), `${g.head} / ${g.foot}`);
  ok('and no note about a week in progress', !/still being played/.test(g.note + stMid.playersNote));
  ok('every team is ranked', stMid.main.every((r) => r.slice(-3).every((c) => /^\d$/.test(c))), stMid.main.map((r) => r.slice(-3).join('/')));
}

// ================================================== 4. Schedule and Summary
//
// tests/cap-stub-season.mjs: weeks 1–3 decided. CAP_EARLY=1 makes week 4's
// first game (Manager 1 v Manager 4) final early while the other four are in
// progress. These pages were expected to follow the schedule on their own, so
// each claim is held against the same stub WITHOUT the early game.
const WHOLE = /^\d+–\d+(–\d+)?$/;
const last = (r) => (r.calls || [])[(r.calls || []).length - 1];
const bankedOf = (call) => new Map(call.banked);

const sOff = child('schedule-off');
const sEarly = child('schedule-early');
const okOff = booted(sOff, 'schedule, switch off');
if (booted(sEarly, 'schedule, one game final early') && okOff) {
  const a = last(sEarly);
  const o = last(sOff);
  const names = sEarly.earlySquads.map((id) => `Manager ${id}`);
  ok('the early game is Manager 1 v Manager 4', same(sEarly.earlySquads, [1, 4]), sEarly.earlySquads);
  ok('THE TWO FINISHED SQUADS’ RECORDS ARE WHOLE NUMBERS: 1–2–1 and 4–0',
    sEarly.records['Manager 1'].cells[1] === '1–2–1' && sEarly.records['Manager 4'].cells[1] === '4–0',
    names.map((n) => sEarly.records[n].cells[1]));
  ok('while the eight still playing count their game as a chance, a decimal',
    Object.entries(sEarly.records).filter(([n]) => !names.includes(n)).every(([, r]) => /\d\.\d–\d+\.\d/.test(r.cells[1])),
    Object.entries(sEarly.records).map(([n, r]) => `${n}: ${r.cells[1]}`).join(' | '));
  ok('the witness: without the early game Manager 4 is 3–0 and every record is whole',
    sOff.records['Manager 4'].cells[1] === '3–0' && Object.values(sOff.records).every((r) => WHOLE.test(r.cells[1])),
    Object.values(sOff.records).map((r) => r.cells[1]));
  ok('THE GAME IS BANKED IN THE SIMULATION: Manager 4 one more win, both squads their score in points for',
    bankedOf(a).get(4).wins === bankedOf(o).get(4).wins + 1 && bankedOf(a).get(1).wins === bankedOf(o).get(1).wins &&
    r1(bankedOf(a).get(4).pointsFor - bankedOf(o).get(4).pointsFor) === sEarly.weekGames[0].awayScore &&
    r1(bankedOf(a).get(1).pointsFor - bankedOf(o).get(1).pointsFor) === sEarly.weekGames[0].homeScore,
    `${JSON.stringify(a.banked.filter(([id]) => id === 1 || id === 4))} vs ${JSON.stringify(o.banked.filter(([id]) => id === 1 || id === 4))}`);
  ok('and is not played out again: 54 games left, not 55, none of them 1 v 4 in week 4',
    a.games.length === 54 && o.games.length === 55 &&
    !a.games.some((g) => g.week === 4 && (g.homeId === 1 || g.awayId === 1 || g.homeId === 4 || g.awayId === 4)),
    `${a.games.length} / ${o.games.length}`);
  ok('nobody else’s banked table moved',
    [2, 3, 5, 6, 7, 8, 9, 10].every((id) => same(bankedOf(a).get(id), bankedOf(o).get(id))));
  ok('the other four week-4 games are played out from where they stand (a share of the spread left)',
    a.games.filter((g) => g.week === 4).length === 4 && a.games.filter((g) => g.week === 4).every((g) => g.homeLeft < 1 && g.awayLeft < 1),
    a.games.filter((g) => g.week === 4));
  // The early game's two team-weeks join the spread, each against the PRE-GAME
  // started projection. Manager 1: 123.2 projected, 118.3 scored.
  ok('the fixture: the started projection is pre-game and differs from the lineup’s score',
    sEarly.started[1].projectedTotal === 123.2 && sEarly.started[1].nowSum === 118.3 &&
    sEarly.weekGames[0].homeScore === 118.3, sEarly.started[1]);
  ok('THE SPREAD LEARNS FROM THE EARLY GAME AGAINST ITS PRE-GAME PROJECTION: 32 team-weeks, the figure worked out here',
    a.sigma === sEarly.sigmaPre.sigma && sEarly.sigmaPre.sample === 32 && o.sigma !== a.sigma,
    `${a.sigma} vs ${sEarly.sigmaPre.sigma} (off ${o.sigma})`);
  ok('never against the scores themselves, which would call that game a perfect projection',
    a.sigma !== sEarly.sigmaNow.sigma, `${a.sigma} / ${sEarly.sigmaNow.sigma}`);
  ok('the simulation note says a finished matchup is banked early (rule 7)',
    /A matchup is banked as soon as every starter on both sides has finished, before ESPN closes the week\./.test(sEarly.note),
    sEarly.note.slice(-900, -500));
  ok('and says nothing of it when there is none', !/banked as soon as every starter/.test(sOff.note));
  ok('“My season” banks it for Manager 1: 1–2–1 with ten games left',
    sEarly.forecastStats.Banked === '1–2–1' && sEarly.forecastStats['Games left'] === '10' &&
    sOff.forecastStats['Games left'] === '11', `${JSON.stringify(sEarly.forecastStats)} / off ${sOff.forecastStats['Games left']}`);
  ok('the reading is still filed under week 4', sEarly.storeKeys.includes('ff.snap.99.2026.4') &&
    !sEarly.storeKeys.includes('ff.snap.99.2026.5'), sEarly.storeKeys);

  // -- Summary, same league --
  const mEarly = child('summary-early');
  if (booted(mEarly, 'summary, one game final early')) {
    const b = last(mEarly);
    ok('THE SUMMARY BANKS THE SAME TABLE as the Schedule page', same(a.banked, b.banked),
      `${JSON.stringify(a.banked)}\nvs ${JSON.stringify(b.banked)}`);
    ok('measures the same spread', a.sigma === b.sigma, `${a.sigma} / ${b.sigma}`);
    const fixed = (c) => c.games.filter((g) => g.week !== 4);
    ok('and plays out the same games: 54, identical beyond the week in progress',
      b.games.length === 54 && same(fixed(a), fixed(b)), `${a.games.length} / ${b.games.length}`);
    const live = (c) => c.games.filter((g) => g.week === 4);
    ok('the four games in progress agree too, to the clock (the two pages read it a moment apart)',
      live(a).length === 4 && live(a).every((g, i) => g.homeId === live(b)[i].homeId &&
        Math.abs(g.homeProj - live(b)[i].homeProj) < 0.5 && Math.abs(g.awayProj - live(b)[i].awayProj) < 0.5),
      `${JSON.stringify(live(a)[0])} vs ${JSON.stringify(live(b)[0])}`);
    // The game being played counts as the chance of winning it (record-live-check.mjs), so a squad
    // still playing reads in tenths over four games; the two that are final stay whole.
    ok('Record counts the early game whole for its two squads only: 4-0 and 1-2-1, everyone else three games plus the share of the one being played',
      mEarly.rows['Manager 4'].Record === '4-0' && mEarly.rows['Manager 1'].Record === '1-2-1' &&
      Object.entries(mEarly.rows).filter(([n]) => !names.includes(n))
        .every(([, r]) => /\.\d/.test(r.Record) &&
          Math.abs(r.Record.split('-').map(Number).reduce((x, y) => x + y, 0) - 4) < 1e-9),
      Object.entries(mEarly.rows).map(([n, r]) => `${n} ${r.Record}`).join(' | '));
    ok('every manager has a LUCK and a Title %', Object.values(mEarly.rows).every((r) => /\d/.test(r.LUCK) && /\d/.test(r['Title %'])),
      Object.values(mEarly.rows).map((r) => `${r.LUCK}|${r['Title %']}`).join(' '));
  }
}

// Week 1 with one game final: eight managers have no banked game at all.
const mW1 = child('summary-week1');
if (booted(mW1, 'summary, week 1 in progress')) {
  const played = mW1.earlySquads.map((id) => `Manager ${id}`);
  ok('the two who have finished have a record and a LUCK',
    played.every((n) => /^(1-0|0-1)$/.test(mW1.rows[n].Record) && /\d/.test(mW1.rows[n].LUCK)),
    played.map((n) => `${n} ${mW1.rows[n].Record} ${mW1.rows[n].LUCK}`));
  ok('A MANAGER STILL PLAYING HIS FIRST GAME HAS NO LUCK — a dash, not a number built on an empty season',
    Object.entries(mW1.rows).filter(([n]) => !played.includes(n)).every(([, r]) => r.LUCK === '—' &&
      /^\d\.\d-\d\.\d$/.test(r.Record) && Math.abs(r.Record.split('-').map(Number).reduce((x, y) => x + y, 0) - 1) < 1e-9),
    Object.entries(mW1.rows).map(([n, r]) => `${n} ${r.Record} ${r.LUCK}`).join(' | '));
  ok('and still has title odds, his game played out with the rest',
    Object.values(mW1.rows).every((r) => /%/.test(r['Title %'])) && /69 games played out/.test(mW1.status), mW1.status);
}

// Every matchup of the week final early: ESPN has not closed it, the site has.
const sAll = child('schedule-all');
if (booted(sAll, 'schedule, every game final early')) {
  const a = last(sAll);
  ok('all ten squads are finished', sAll.earlySquads.length === 10, sAll.earlySquads);
  ok('every record is a whole number and four games long',
    Object.values(sAll.records).every((r) => WHOLE.test(r.cells[1]) &&
      r.cells[1].split('–').map(Number).reduce((x, y) => x + y, 0) === 4),
    Object.values(sAll.records).map((r) => r.cells[1]));
  ok('the season is simulated from week 5: 50 games, none in week 4, nothing in progress',
    a.games.length === 50 && a.games.every((g) => g.week >= 5 && g.homeLeft === undefined), a.games.length);
  ok('the spread has all forty team-weeks, against pre-game projections',
    a.sigma === sAll.sigmaPre.sigma && sAll.sigmaPre.sample === 40 && a.sigma !== sAll.sigmaNow.sigma,
    `${a.sigma} / ${sAll.sigmaPre.sigma}`);
  ok('THE READING IS FILED UNDER WEEK 5 (capture.liveAsOf moves on with the last early final)',
    sAll.storeKeys.includes('ff.snap.99.2026.5') && !sAll.storeKeys.includes('ff.snap.99.2026.4'), sAll.storeKeys);
  const mAll = child('summary-all');
  if (booted(mAll, 'summary, every game final early')) {
    const b = last(mAll);
    ok('the Summary simulates the identical season', same(a.banked, b.banked) && same(a.games, b.games) && a.sigma === b.sigma,
      `${a.games.length} / ${b.games.length}; ${a.sigma} / ${b.sigma}`);
    ok('and is a summary through week 4 with four-game records',
      /through week 4/.test(mAll.sub) && Object.values(mAll.rows)
        .every((r) => r.Record.split('-').map(Number).reduce((x, y) => x + y, 0) === 4),
      `${mAll.sub} / ${Object.values(mAll.rows).map((r) => r.Record).join(' ')}`);
  }
}

for (const f of fails) console.log('FAIL ' + f);
console.log(fails.length ? `${pass} passed, ${fails.length} failed` : `All ${pass} assertions passed`);
process.exit(fails.length ? 1 : 0);
