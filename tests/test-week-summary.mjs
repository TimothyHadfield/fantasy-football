// THE WEEK RECAP's rules (js/week-summary.js), on hand-worked fixtures.
//
//   node test-week-summary.mjs
//
// Tim, 2026-10-19: "make a weekly summary where you can choose which week it's
// summarizing … new injuries (and how long theyll be out), Major busts/booms,
// each users missed points (reasonably and perfect foresight) … taking the
// summary informatoin off of that week after it was completely over".
//
// Four rules, each worked out by hand below:
//   1. a week is offered only once every matchup is DECIDED by ESPN and every
//      NFL game of it is official — not when one game finished early;
//   2. missed points, reasonable (best lineup by projection) and perfect (best
//      by what was scored), on a full nine-starter roster;
//   3. booms and busts ranked by points against projection;
//   4. who picked up an injury that week, from a snapshot, today's status, or
//      reconstructed from the next week.
//
// Fixtures are ESPN's roster shape (js/season.js `readWeekRostersNow`): slot
// ids 0 QB, 2 RB, 4 WR, 6 TE, 23 FLEX, 16 D/ST, 17 K, 20 bench, 21 IR — the
// nine-starter lineup of public league 1241838 — sixteen men a team.
//
// WS_MODULE=<path> runs the same checks against another copy of the module
// (how the fail-first run was made: a naive copy fails them).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const modPath = process.env.WS_MODULE || path.join(REPO, 'js/week-summary.js');
const ws = await import(pathToFileURL(modPath).href);
const capture = await import(pathToFileURL(path.join(REPO, 'js/capture.js')).href);

let pass = 0;
let fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, msg) => ok(Object.is(a, b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const SLOT_POS = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 16: 'DST', 17: 'K' };
let nextId = 1;
/** One roster entry in js/season.js's shape. */
function man(name, position, slot, projected, actual, extra = {}) {
  return {
    playerId: extra.playerId ?? nextId++, name, position, proTeam: 'KC', proTeamId: extra.proTeamId ?? 12,
    lineupSlotId: slot, slot: String(slot), started: slot !== 20 && slot !== 21,
    projected, actual, injuryStatus: extra.injuryStatus || 'ACTIVE', ...extra,
  };
}
const team = (id, name, players) => ({ id, name, players });

// ------------------------------------------------------------------ 1. weeks
{
  // Weeks 1–3 of a ten-team league, five games a week.
  const games = [];
  for (const w of [1, 2, 3]) {
    for (let i = 0; i < 5; i++) {
      games.push({ week: w, homeId: 2 * i + 1, awayId: 2 * i + 2, homeScore: 100 + i, awayScore: 90 + i, played: true });
    }
  }
  // Week 3: one game is over early (every starter done), the other four are
  // still being played — what Sunday night looks like.
  for (const g of games.filter((x) => x.week === 3)) { g.played = false; g.homeScore = 40; g.awayScore = 0; }
  Object.assign(games.find((x) => x.week === 3), { played: true, early: true, homeScore: 101, awayScore: 99 });

  // The NFL: 32 teams; week 2's Monday game (teams 7 and 8) not yet official.
  const pro = {};
  for (let t = 1; t <= 32; t++) {
    pro[t] = { 1: { at: 1, done: true }, 2: { at: 2, done: !(t === 7 || t === 8) }, 3: { at: 3, done: false } };
  }

  same(ws.completedWeeks(games, pro), [1],
    'a week with an NFL game still being played is not offered, nor one with a game only over early');
  same(ws.completedWeeks(games, {}), [1, 2],
    'NFL schedule unknown: ESPN deciding every matchup is enough');
  ok(capture.decidedWeeks({ weeks: [1, 2, 3], byWeek: new Map([1, 2, 3].map((w) => [w, games.filter((g) => g.week === w)])) }).includes(3),
    'the season picker\'s rule (any game final) WOULD offer week 3 — the recap must not use it');
  for (const g of games.filter((x) => x.week === 3)) Object.assign(g, { played: true, early: undefined, homeScore: 100, awayScore: 90 });
  for (let t = 1; t <= 32; t++) pro[t][3].done = true;
  pro[7][2].done = true; pro[8][2].done = true;
  same(ws.completedWeeks(games, pro), [1, 2, 3], 'once all are decided and official, every week is offered');
  same(ws.completedWeeks([], pro), [], 'no games, no weeks');
}

// ------------------------------------------------------------ 2. missed points
const SLOTS = [0, 2, 2, 4, 4, 6, 23, 16, 17];
const roster = () => [
  man('A QB', 'QB', 0, 20, 15),
  man('B RB', 'RB', 2, 15, 10),
  man('C RB', 'RB', 2, 12, 8),
  man('D WR', 'WR', 4, 14, 20),
  man('E WR', 'WR', 4, 10, 4),
  man('F TE', 'TE', 6, 9, 3),
  man('G WR', 'WR', 23, 8, 6),
  man('H DST', 'DST', 16, 7, 5),
  man('I K', 'K', 17, 8, 9),
  man('J QB', 'QB', 20, 18, 25),
  man('K RB', 'RB', 20, 13, 22),
  man('L WR', 'WR', 20, 6, 18),
  man('M TE', 'TE', 20, 5, 12),
  man('N RB', 'RB', 20, 4, null),       // did not play: scores 0
  man('O WR', 'WR', 21, 10, 30),        // IR slot: never startable
  man('P K', 'K', 20, 7, 2),
];
{
  const t = team(1, 'Ana', roster());
  same(ws.slotsOf([t]).slice().sort((a, b) => a - b), SLOTS.slice().sort((a, b) => a - b), 'slots read off the lineup');
  const m = ws.missedPoints(t, SLOTS);
  // Started: 15+10+8+20+4+3+6+5+9 = 80.
  eq(m.scored, 80, 'scored = the started men');
  // By projection: QB A(20) · RB B(15) K(13) · WR D(14) E(10) · TE F(9) · FLEX C(12) · DST H · K I(8 > P 7)
  //   = 15 + 10 + 22 + 20 + 4 + 3 + 8 + 5 + 9 = 96.
  eq(m.reasonable, 96, 'reasonable lineup = best by projection, scored by actual');
  eq(m.missedReasonable, 16, 'reasonable missed = 96 − 80');
  // By actual: QB J 25 · RB K 22, B 10 · WR D 20, L 18 · TE M 12 · FLEX C 8 · DST 5 · K 9 = 129 (O's 30 on IR left out).
  eq(m.perfect, 129, 'perfect lineup = best by actual, IR left out');
  eq(m.missedPerfect, 49, 'perfect missed = 129 − 80');
  // A manager who beat the projections: start the projection-best lineup
  // except that he played L (18) over E (10 proj, 4 pts).
  const r2 = roster().map((p) => (p.name === 'E WR' ? { ...p, lineupSlotId: 20, started: false }
    : p.name === 'L WR' ? { ...p, lineupSlotId: 4, started: true } : p));
  const m2 = ws.missedPoints(team(2, 'Bo', r2), SLOTS);
  eq(m2.scored, 94, 'swap: 80 − 4 + 18');
  eq(m2.missedReasonable, 2, 'reasonable can be small when his calls beat ESPN (96 − 94)');
  const best = roster().map((p) => {
    const on = ['J QB', 'K RB', 'B RB', 'D WR', 'L WR', 'M TE', 'C RB', 'H DST', 'I K'];
    return { ...p, started: on.includes(p.name), lineupSlotId: on.includes(p.name) ? (p.position === 'QB' ? 0 : p.name === 'C RB' ? 23 : p.lineupSlotId === 20 ? ({ RB: 2, WR: 4, TE: 6 })[p.position] : p.lineupSlotId) : (p.lineupSlotId === 21 ? 21 : 20) };
  });
  const m3 = ws.missedPoints(team(3, 'Cy', best), SLOTS);
  eq(m3.missedPerfect, 0, 'the perfect lineup misses nothing');
  eq(m3.missedReasonable, -33, 'and beats the projection lineup: 96 − 129');
}

// ------------------------------------------------------------ 3. booms / busts
{
  const rostered = [
    { playerId: 1, name: 'Boom1', position: 'WR', projected: 8, actual: 31.5, owner: 'Ana' },   // +23.5
    { playerId: 2, name: 'Boom2', position: 'RB', projected: 15, actual: 33, owner: 'Bo' },     // +18
    { playerId: 3, name: 'Boom3', position: 'TE', projected: 5, actual: 21, owner: 'Cy' },      // +16
    { playerId: 4, name: 'Bust1', position: 'QB', projected: 24, actual: 4.2, owner: 'Ana' },   // −19.8
    { playerId: 5, name: 'Bust2', position: 'RB', projected: 17, actual: null, owner: 'Bo' },   // −17 (did not play)
    { playerId: 6, name: 'Bust3', position: 'WR', projected: 13, actual: 1, owner: 'Cy' },      // −12
    { playerId: 7, name: 'Tiny', position: 'K', projected: 3, actual: 0, owner: 'Cy' },         // −3 but projected < 5: no bust
    { playerId: 8, name: 'OutMan', position: 'WR', projected: 0, actual: null, owner: 'Bo' },   // ruled out: neither
    { playerId: 9, name: 'Mid', position: 'WR', projected: 10, actual: 12, owner: 'Ana' },      // +2
  ];
  const fa = [
    { playerId: 20, name: 'FaBoom', position: 'RB', projected: 2, actual: 22 },   // +20, notable by points
    { playerId: 21, name: 'FaQuiet', position: 'WR', projected: 3, actual: 9 },   // +6, not notable
    { playerId: 22, name: 'FaBust', position: 'QB', projected: 18, actual: 2 },   // −16, notable by projection
  ];
  const { booms, busts } = ws.boomsBusts(rostered, fa, 4);
  same(booms.map((r) => r.name), ['Boom1', 'FaBoom', 'Boom2', 'Boom3'], 'booms: most over projection first, notable free agents in');
  same(booms.map((r) => r.diff), [23.5, 20, 18, 16], 'boom diffs');
  eq(booms[1].owner, null, 'a free agent has no owner');
  same(busts.map((r) => r.name), ['Bust1', 'Bust2', 'FaBust', 'Bust3'], 'busts: most under first; a man who did not play scored 0');
  eq(busts[1].actual, 0, 'no score = 0');
  ok(!busts.some((r) => r.name === 'Tiny'), 'a bust needs a projection of 5 or more');
  ok(![...booms, ...busts].some((r) => r.name === 'OutMan' || r.name === 'FaQuiet'), 'ruled-out men and quiet free agents are left out');
}

// ------------------------------------------------------------ 4. new injuries
{
  const owner = 'Ana';
  const p = (id, projected, actual, extra = {}) => ({ playerId: id, name: `P${id}`, position: 'WR', projected, actual, proTeamId: 12, owner, ...extra });
  const played = [
    p(1, 12, 3),          // hurt in the game, OUT after
    p(2, 10, 8),          // questionable before and after: not new
    p(3, 0, null),        // already out, did not play: not new
    p(4, 9, 11),          // fine
  ];
  const after = { 1: { s: 'OUT', type: 'Hamstring', ret: '2026-11-01', ofs: false }, 2: { s: 'QUESTIONABLE' }, 3: { s: 'OUT' } };
  const before = { 2: { s: 'QUESTIONABLE' }, 3: { s: 'OUT' } };
  const got = ws.newInjuries({ played, after, before, current: null, isLatest: false, later: [] });
  same(got.map((r) => r.playerId), [1], 'snapshot: only the man who played and is listed hurt after, not before');
  eq(got[0].source, 'snapshot', 'from the snapshot');
  eq(got[0].label, 'Out', 'status label');
  eq(got[0].type, 'Hamstring', 'injury from ESPN as saved');
  eq(got[0].returnDate, '2026-11-01', 'expected return as saved');

  // The latest week, no snapshot: today's status stands for the week's end.
  const current = new Map([
    ['6', { status: 'OUT', details: { outForSeason: false, returnDate: '2026-10-25', type: 'Ankle' } }],
    ['7', { status: 'INJURY_RESERVE', details: { outForSeason: true, returnDate: '2027-02-15', type: 'Calf' } }],
    ['8', { status: 'ACTIVE' }],
  ]);
  const cur = ws.newInjuries({ played: [p(6, 14, 2), p(7, 20, 6), p(8, 9, 9)], current, isLatest: true });
  same(cur.map((r) => r.playerId), [7, 6], 'today\'s status, out for the season first');
  eq(cur[0].outForSeason, true, 'out for the season, ESPN\'s word');
  eq(cur[0].returnDate, null, 'no return date shown for a season-ending injury');
  eq(cur[1].returnDate, '2026-10-25', 'ESPN\'s expected return');
  eq(cur[1].source, 'current', 'labelled as today\'s status');

  // Today's statuses describe week 5's end only until week 6 kicks off.
  const T = Date.UTC(2026, 9, 15, 0, 15);   // Thursday night kickoff of week 6
  const pro = { 1: { 5: { at: T - 7 * 864e5, done: true }, 6: { at: T, done: false } }, 2: { 6: { at: T + 3 * 864e5, done: false } } };
  eq(ws.nextUnderWay(pro, 5, T - 60000), false, 'Wednesday: week 6 not under way, today\'s statuses are week 5\'s');
  eq(ws.nextUnderWay(pro, 5, T + 60000), true, 'Thursday night on: week 6 has begun, so no');
  eq(ws.nextUnderWay({}, 5, T - 60000), true, 'NFL schedule unknown: not trusted');

  // An older week, no snapshot: reconstructed from the weeks after.
  const byes = { 12: 9, 30: 4 };
  const later = [
    { week: 4, players: new Map([
      ['10', { projected: 0, actual: 0, proTeamId: 12 }],         // missed week 4 (ESPN: 0.0 projected, 0.0 scored)
      ['11', { projected: 0, actual: null, proTeamId: 30 }],      // week 4 is his bye
      ['12', { projected: 11, actual: 14, proTeamId: 12 }],       // played on
    ]) },
    { week: 5, players: new Map([['10', { projected: 0, actual: null, proTeamId: 12 }], ['11', { projected: 9, actual: 8, proTeamId: 30 }]]) },
    { week: 6, players: new Map([['10', { projected: 8, actual: 12, proTeamId: 12 }]]) },
  ];
  const rec = ws.newInjuries({
    played: [p(10, 13, 4, { proTeamId: 12 }), p(11, 10, 7, { proTeamId: 30 }), p(12, 11, 9)],
    later, byes, current: new Map([['10', { status: 'ACTIVE' }]]),
  });
  same(rec.map((r) => r.playerId), [10], 'reconstructed: missed the next week while his team played; a bye is not an injury');
  eq(rec[0].source, 'reconstructed', 'labelled reconstructed');
  eq(rec[0].status, null, 'no status claimed when none was saved');
  eq(rec[0].missed, 2, 'missed weeks 4 and 5, counted from the rosters');
  eq(rec[0].back, 6, 'back in week 6');
  eq(rec[0].returnDate, null, 'no duration invented for a man who is back');

  // The snapshot keeps the hurt men only, with ESPN's word when known.
  const snap = ws.injurySnapshot([
    { playerId: 1, injuryStatus: 'OUT', injuryDetails: { outForSeason: false, returnDate: '2026-11-01', type: 'Knee' } },
    { playerId: 2, injuryStatus: 'ACTIVE' },
    { playerId: 3, injuryStatus: 'QUESTIONABLE' },
  ], new Map([['3', { outForSeason: false, returnDate: null, type: 'Toe' }]]));
  same(snap, { 1: { s: 'OUT', type: 'Knee', ret: '2026-11-01', ofs: false }, 3: { s: 'QUESTIONABLE', type: 'Toe', ofs: false } }, 'snapshot shape');
}

// ------------------------------------------------------------ the whole week
{
  const ids = [1, 2, 3, 4];
  const games = [
    { week: 1, homeId: 1, awayId: 2, homeScore: 100, awayScore: 90, played: true },
    { week: 1, homeId: 3, awayId: 4, homeScore: 80, awayScore: 85, played: true },
    { week: 2, homeId: 1, awayId: 3, homeScore: 70, awayScore: 120, played: true },
    { week: 2, homeId: 2, awayId: 4, homeScore: 95.5, awayScore: 95, played: true },
  ];
  const st1 = ws.standingsThrough(games, ids, 1);
  const st2 = ws.standingsThrough(games, ids, 2);
  same(st1.map((r) => r.teamId), [1, 4, 2, 3], 'week 1 standings: wins, then points for');
  same(st2.map((r) => r.teamId), [3, 2, 4, 1], 'week 2 standings: all 1–1, so points for');

  const mk = (id, name, startedProj, startedAct) => team(id, name, [
    man(`${name} QB`, 'QB', 0, startedProj, startedAct),
    man(`${name} BE`, 'RB', 20, 5, 30),
  ]);
  const teams = [mk(1, 'Ana', 110, 70), mk(2, 'Bo', 80, 95.5), mk(3, 'Cy', 100, 120), mk(4, 'Di', 90, 95)];
  const s = ws.buildWeekSummary({ week: 2, games, teams, pool: null, moves: [{ kind: 'add', teamId: 3, adds: [teams[2].players[0].playerId] }] });
  eq(s.facts.games.length, 2, 'two games');
  eq(s.facts.high.name, 'Cy', 'high score');
  eq(s.facts.low.name, 'Ana', 'low score');
  eq(s.facts.closest.winner, 'Bo', 'closest game');
  eq(s.facts.biggest.winner, 'Cy', 'biggest win');
  eq(s.facts.upsets, 2, 'Cy (100) beat Ana (110) and Bo (80) beat Di (90): two upsets');
  eq(s.facts.avg, 95.1, 'league average (70+95.5+120+95)/4');
  eq(s.facts.avgProj, 95, 'league projected average (110+80+100+90)/4');
  same(s.standings.map((r) => [r.name, r.move]), [['Cy', 3], ['Bo', 1], ['Di', -1], ['Ana', -3]], 'standings movement');
  eq(s.bench.actual, 30, 'best bench score');
  eq(s.pickup && s.pickup.name, 'Cy QB', 'best pickup who started');
}

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
