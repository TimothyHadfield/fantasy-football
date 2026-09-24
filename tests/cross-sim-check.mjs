// The Summary page and the Schedule page must give the same title %.
//
//   node cross-sim-check.mjs
//
// They are one question about one league. They used to be asked it
// differently: the Summary page assumed a six-team bracket whatever the league
// said, and measured the scoring spread from last week's lineups while the
// Schedule page had nothing to measure it from and assumed one. So the two
// pages printed different odds for the same season, each looking fine.
//
// THE STRONG FORM IS CHECKED, not just "close enough": both pages are booted on
// the same stubbed league (cap-stub-season.mjs — a declared FOUR-team bracket,
// three decided weeks with a tie among them, and started-lineup projections so
// the spread is genuinely calibrated), every call each makes to
// `simulateSeason` is recorded (cap-record-forecast.mjs), and the arguments
// must be IDENTICAL apart from the run count — 10,000 on the Schedule page by
// default, 100,000 on the Summary page, which is Tim's number. Then, as a
// second witness, the rendered title % must agree within the counting noise.
//
// A cross-page seam, so it gets its own suite — the house rule is that
// anything spanning two pages needs a test that spans them.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { bootDom, waitFor, LEAGUE, SEASON } from './cap-harness.mjs';
import { emit } from './emit.mjs';

const self = fileURLToPath(import.meta.url);
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const CONN = { leagueId: LEAGUE, season: SEASON, teamId: 1 };

const CHILDREN = {
  async schedule() {
    const html = readFileSync(path.join(REPO, 'schedule.html'), 'utf8');
    const { document } = bootDom({
      html,
      store: { 'ff.prefs': { 'schedule.source': 'live', 'schedule.week': 'all' }, 'ff.connection': CONN },
    });
    await import(moduleUrl('js/schedule-page.js'));
    await waitFor(() => (globalThis.__simCalls || []).length &&
      document.querySelectorAll('#simTable tbody tr:not(.empty-row)').length === 10, 20000);
    await new Promise((r) => setTimeout(r, 50));
    const title = {};
    const projWins = {};
    for (const tr of document.querySelectorAll('#simTable tbody tr')) {
      const td = [...tr.children];
      title[text(td[0])] = Number(td[7].getAttribute('data-v'));
      projWins[text(td[0])] = Number(td[1].getAttribute('data-v'));
    }
    // "My season" for Manager 1, who TIED his week-2 game (AUDIT §1.6).
    const stat = (k) => [...document.querySelectorAll('#forecastStats .stat')]
      .map((el) => [text(el.querySelector('.k')), text(el.querySelector('.v'))])
      .find(([key]) => key === k)?.[1] ?? null;
    const winPs = [...document.querySelectorAll('#forecastTable tbody tr')]
      .map((tr) => tr.children[5]?.getAttribute('data-v')).filter((v) => v != null).map(Number);
    const forecastFor = {
      banked: stat('Banked'), expected: stat('Expected wins'), winPs, projWins,
      note: text(document.getElementById('forecastNote')),
    };
    const stub = await import('./cap-stub-season.mjs');
    return {
      calls: globalThis.__simCalls || [], title,
      note: text(document.getElementById('simNote')),
      matchupsNote: text(document.getElementById('matchupsNote')),
      forecastFor,
      floorWeeks: stub.calls.floors || [],
    };
  },

  async summary() {
    const html = readFileSync(path.join(REPO, 'summary.html'), 'utf8');
    const { document } = bootDom({
      html,
      store: { 'ff.prefs': { 'summary.source': 'live' }, 'ff.connection': CONN },
    });
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
    await import(moduleUrl('js/summary-page.js'));
    await import(moduleUrl('js/connection.js'));
    await waitFor(() => /simulated seasons/.test(text(document.getElementById('simStatus'))), 30000);
    await new Promise((r) => setTimeout(r, 50));
    const title = {};
    for (const tr of document.querySelectorAll('#summaryTable tbody tr')) {
      const td = [...tr.children];
      title[text(td[0])] = Number(td[2].getAttribute('data-v'));
    }
    const stub = await import('./cap-stub-season.mjs');
    return {
      calls: globalThis.__simCalls || [],
      title,
      status: text(document.getElementById('simStatus')),
      note: text(document.getElementById('summaryNote')),
      floorWeeks: stub.calls.floors || [],
    };
  },
};

if (process.argv[2]) {
  try {
    emit(await CHILDREN[process.argv[2]](), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

// CAP_WIRE: the stub answers the floor read with a real, non-empty wire whose
// floor moves with the week (AUDIT §1.4). `wire: false` runs a page without it,
// the witness that the floor really reaches the simulation.
function child(name, { wire = true } = {}) {
  const env = { ...process.env };
  if (wire) env.CAP_WIRE = '1'; else delete env.CAP_WIRE;
  const res = spawnSync(process.execPath, ['--import', './cap-register.mjs', self, name], {
    encoding: 'utf8', cwd: path.dirname(self), maxBuffer: 32 * 1024 * 1024, timeout: 180000, env,
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) return { boot: `no result\n${res.stdout}\n${(res.stderr || '').slice(0, 2000)}` };
  return JSON.parse(line.slice(2));
}

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 500)}` : ''}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const sched = child('schedule');
const summ = child('summary');
ok('the Schedule page boots on the stub', !sched.boot, sched.boot);
ok('the Summary page boots on the stub', !summ.boot, summ.boot);

if (!sched.boot && !summ.boot) {
  const a = sched.calls[sched.calls.length - 1];
  const b = summ.calls[summ.calls.length - 1];
  ok('the Schedule page simulated', Boolean(a), JSON.stringify(sched.calls.length));
  ok('the Summary page simulated', Boolean(b), summ.status);

  if (a && b) {
    ok('at their own run counts: 10,000 and Tim’s 100,000', a.runs === 10000 && b.runs === 100000,
      `${a.runs} / ${b.runs}`);
    ok('on the same seed', a.seed === b.seed, `${a.seed} / ${b.seed}`);
    ok('the same teams, in the same order', same(a.teamIds, b.teamIds));
    ok('THE SAME BANKED TABLE — wins (the tie as half each) and points for',
      same(a.banked, b.banked), `${JSON.stringify(a.banked)}\nvs ${JSON.stringify(b.banked)}`);
    ok('THE SAME REMAINING GAMES AND PROJECTIONS', same(a.games, b.games),
      `${a.games.length} vs ${b.games.length}; first ${JSON.stringify(a.games[0])} vs ${JSON.stringify(b.games[0])}`);
    ok('THE SAME SCORING SPREAD', a.sigma === b.sigma, `${a.sigma} vs ${b.sigma}`);
    ok('and it was MEASURED, not both falling back to the same default',
      a.sigma !== 27, String(a.sigma));
    ok('THE SAME BRACKET: the league’s declared four teams on both pages',
      a.playoff && b.playoff && a.playoff.teams === 4 && b.playoff.teams === 4,
      `${a.playoff && a.playoff.teams} / ${b.playoff && b.playoff.teams}`);
    ok('in the same weeks', same(a.playoff.weeks, b.playoff.weeks) && same(a.playoff.weeks, [15, 16]),
      `${JSON.stringify(a.playoff.weeks)} / ${JSON.stringify(b.playoff.weeks)}`);
    ok('scored from the same projections', same(a.playoff.proj, b.playoff.proj));
    ok('a banked tie really is in there',
      a.banked.some(([, t]) => t.wins % 1 === 0.5), JSON.stringify(a.banked));
  }

  // THE FLOOR (AUDIT §1.4). Both pages read the wire ONCE, for week 4 — the
  // first week still to play — never week 1's wire. The stub's floor moves
  // with the week, so a page reading any other week hands the simulation
  // different projections and the identity checks above fail too.
  const firstOpen = 4;
  ok(`the Schedule page read the wire for week ${firstOpen}, the first unplayed`,
    sched.floorWeeks.length >= 1 && sched.floorWeeks.every((w) => w === firstOpen), JSON.stringify(sched.floorWeeks));
  ok(`the Summary page read it for the same week`,
    summ.floorWeeks.length >= 1 && summ.floorWeeks.every((w) => w === firstOpen), JSON.stringify(summ.floorWeeks));
  // TIES BANK AS HALF A WIN IN "EXPECTED WINS" TOO (AUDIT §1.6). Manager 1
  // tied in week 2, so his banked record is w-l-1; the simulation (and so
  // Proj. wins) counts that tie as half a win, and so must the forecast panel.
  const f = sched.forecastFor || {};
  const rec = /^(\d+)[–-](\d+)(?:[–-](\d+))?$/.exec(f.banked || '');
  const bw = rec ? Number(rec[1]) : NaN;
  const bt = rec && rec[3] ? Number(rec[3]) : 0;
  ok('Manager 1’s banked record carries the tie', bt === 1, f.banked);
  const wantExp = Math.round((bw + bt / 2 + (f.winPs || []).reduce((x, p) => x + p, 0)) * 10) / 10;
  ok(`Expected wins is banked wins + half the tie + the chances left (${wantExp})`,
    Number(f.expected) === wantExp, `${f.expected} from ${f.banked} and ${(f.winPs || []).length} games`);
  ok('and the forecast note says how the tie counts (rule 7)', /a tie counts as half a win/.test(f.note || ''), (f.note || '').slice(0, 300));
  const pw = f.projWins && f.projWins['Manager 1'];
  ok('and agrees with the simulation’s Proj. wins within its noise (0.15), not half a win off',
    Number.isFinite(pw) && Math.abs(Number(f.expected) - pw) < 0.15, `${f.expected} vs ${pw}`);

  const bare = child('schedule', { wire: false });
  const c = bare.calls ? bare.calls[bare.calls.length - 1] : null;
  ok('the floor really reaches the simulation: without the wire the remaining games project differently',
    Boolean(a && c) && !same(a.games, c.games), bare.boot || '');
  ok('the Schedule simulation note states the floor, for that week (rule 7)',
    /No slot is assessed below what the waiver wire would give you/.test(sched.note) &&
    sched.note.includes(`in week ${firstOpen}`) && !/sit down on their own/.test(sched.note), sched.note.slice(-900));
  ok('so does the Schedule matchup note',
    /No slot is assessed below what the waiver wire/.test(sched.matchupsNote) &&
    !/sit down on their own/.test(sched.matchupsNote), sched.matchupsNote.slice(-900));
  ok('and the Summary note, in the same words and the same week',
    /No slot is assessed below what the waiver wire would give you/.test(summ.note) &&
    summ.note.includes(`in week ${firstOpen}`), summ.note.slice(-900));

  // The second witness: the numbers on the two screens.
  const names = Object.keys(sched.title);
  ok('both tables list all ten managers', names.length === 10 && Object.keys(summ.title).length === 10,
    `${names.length} / ${Object.keys(summ.title).length}`);
  const worst = Math.max(...names.map((n) => Math.abs(sched.title[n] - summ.title[n])));
  // 10,000 runs: one standard error at p = 0.5 is 0.5 points; three is 1.5.
  ok('and every manager’s title % agrees within the counting noise (±1.5 points)',
    Number.isFinite(worst) && worst <= 0.015,
    names.map((n) => `${n}: ${sched.title[n]} vs ${summ.title[n]}`).join(' | '));
  ok('the title chances are a complete distribution on both pages',
    Math.abs(names.reduce((s, n) => s + sched.title[n], 0) - 1) < 1e-6 &&
    Math.abs(names.reduce((s, n) => s + summ.title[n], 0) - 1) < 1e-6);

  ok('the Summary note says the field size was read from the league',
    /4 of 10 teams make the playoffs \(read from your league’s ESPN settings\)/.test(summ.note), summ.note.slice(0, 600));
  ok('as the Schedule note does', /4 of 10 teams make the playoffs, read from your league/.test(sched.note),
    sched.note.slice(0, 300));
  ok('and states its own run count against the Schedule page’s',
    /Schedule page plays out the same season from the same inputs, 10,000 times/.test(summ.note) &&
    /100,000 runs here are good to about ±0\.3/.test(summ.note), summ.note);
}

for (const f of fails) console.log('FAIL ' + f);
console.log(fails.length ? `${pass} passed, ${fails.length} failed` : `All ${pass} assertions passed`);
process.exit(fails.length ? 1 : 0);
