// DECISIONS REVIEW — the mirror universes, on a league small enough to check by hand.
//
//   node test-decisions.mjs
//
// Tim, 2026-10-05: "have a list of all the decisions they've made, and what
// would have happened if they hadn't made that that decision ... the biggest
// thing I want to see is the act weekly total for that team each previous week,
// whether that would have changed the outcome of a matchup, and how much it
// would have changed the overall record." (docs/decisions-review-plan.md)
//
// Checks js/decisions.js: listDecisions, mirror, rosterAt, recordOf, NOISE.
// Four teams, four final weeks, one QB / RB / WR / FLEX. Every expected number
// is worked by hand in the comment beside it, never asked of the engine.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const D = await import(pathToFileURL(path.join(REPO, 'js/decisions.js')).href);

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a, b, tol, name) => ok(Number.isFinite(a) && Math.abs(a - b) <= tol, name, `got ${a}, want ${b} ±${tol}`);

// ---- the league -------------------------------------------------------------
const H = 3600000;
const DAY = 24 * H;
const TUE = (w) => Date.UTC(2026, 8, 8) + (w - 1) * 7 * DAY;   // ESPN week w opens, Tue 00:00
const SUN = (w) => TUE(w) + 5 * DAY + 17 * H;                  // the Sunday kickoff
const MON = (w) => TUE(w) + 6 * DAY + 23 * H;                  // the Monday night game

const TIM = 1, MITCH = 2, CAL = 3, DEE = 4;
const QB = 0, RB = 2, WR = 4, FLEX = 23, BE = 20;

// id: [name, position, [actual, projected] for weeks 1..4]
const STATS = {
  10: ['Drew Lock', 'QB', [18, 16], [26, 15], [25, 17], [28, 18]],
  11: ['Bryce Young', 'QB', [10, 14], [12, 16], [9, 15], [20, 16]],
  12: ['Baker Mayfield', 'QB', [17, 17], [12, 17], [14, 17], [16, 17]],
  13: ['CJ Stroud', 'QB', [20, 12], [26, 12], [5, 12], [9, 12]],
  14: ['Jared Goff', 'QB', [19, 18], [16, 18], [20, 18], [15, 18]],
  15: ['Bo Nix', 'QB', [14.1, 15], [15, 15], [13, 15], [18, 15]],
  20: ['Devon Achane', 'RB', [15, 14], [14, 14], [16, 14], [13, 14]],
  21: ['James Cook III', 'RB', [12.2, 13], [11, 13], [21, 13], [14, 13]],
  22: ['Jahmyr Gibbs', 'RB', [18, 16], [12, 16], [15, 16], [20, 16]],
  23: ['Mo Mason', 'RB', [5, 6], [4, 6], [6, 6], [7, 6]],
  24: ['Saquon Barkley', 'RB', [16, 15], [15, 15], [14, 15], [17, 15]],
  25: ['Yan Yates', 'RB', [6, 8], [7, 8], [9, 8], [13, 12]],
  26: ['Hal Hot', 'RB', [4, 7], [6, 7], [35, 20], [24, 13]],
  27: ['Jon Taylor', 'RB', [17, 15], [16, 15], [19, 15], [12, 15]],
  28: ['Breece Hall', 'RB', [11, 10], [8, 10], [7, 10], [10, 10]],
  29: ['Pat Pine', 'RB', [6, 7], [5, 7], [8, 7], [7, 7]],
  30: ["Ja'Marr Chase", 'WR', [20, 18], [22, 18], [8, 18], [19, 18]],
  31: ['Stefon Diggs', 'WR', [9, 11], [10, 11], [12, 11], [8, 11]],
  32: ['Justin Jefferson', 'WR', [14, 16], [13, 16], [18, 16], [15, 16]],
  33: ['Garrett Wilson', 'WR', [10, 10], [9, 10], [11, 10], [12, 10]],
  34: ['Puka Nacua', 'WR', [13, 15], [21, 15], [14, 15], [16, 15]],
  35: ['Sam Sub', 'WR', [5, 9], [6, 9], [13, 9], [9, 14]],
  36: ['Mike Evans', 'WR', [12, 12], [14, 12], [10, 12], [11, 12]],
  37: ['Lee Late', 'WR', [3, 5], [4, 5], [17, 11], [6, 9]],
  38: ['Will Wire', 'WR', [1, 5], [2, 5], [3, 5], [15, 14]],
  39: ['Ben Benchy', 'WR', [3, 4], [2, 4], [1, 11], [4, 4]],
  41: ['Ed Extra', 'WR', [0, 3], [0, 3], [0, 3], [2, 3]],
};
const SLOT_NAME = { 0: 'QB', 2: 'RB', 4: 'WR', 23: 'FLEX', 20: 'BE' };

// The rosters each week was really scored with: [playerId, lineupSlotId].
const ROSTERS = {
  1: {
    [TIM]: [[10, QB], [20, RB], [30, WR], [31, FLEX], [23, BE]],
    [MITCH]: [[12, QB], [24, RB], [32, WR], [33, FLEX], [13, BE], [39, BE]],
    [CAL]: [[14, QB], [22, RB], [34, WR], [28, FLEX], [26, BE], [35, BE]],
    [DEE]: [[15, QB], [21, RB], [36, WR], [27, FLEX], [29, BE]],
  },
  2: {
    [TIM]: [[11, QB], [20, RB], [30, WR], [31, FLEX], [23, BE]],                    // m1: +Young -Lock
    [MITCH]: [[10, QB], [24, RB], [32, WR], [33, FLEX], [12, BE], [13, BE]],        // m2: +Lock -Benchy
    [CAL]: [[14, QB], [22, RB], [34, WR], [28, FLEX], [26, BE], [35, BE]],
    [DEE]: [[15, QB], [21, RB], [36, WR], [27, FLEX], [29, BE]],
  },
  3: {
    [TIM]: [[11, QB], [20, RB], [31, WR], [21, FLEX], [23, BE]],                    // m5: Chase for Cook
    [MITCH]: [[10, QB], [24, RB], [32, WR], [33, FLEX], [12, BE], [13, BE]],
    [CAL]: [[14, QB], [22, RB], [34, WR], [37, FLEX], [28, BE], [35, BE]],          // m3: +Late -Hot
    [DEE]: [[15, QB], [27, RB], [36, WR], [30, FLEX], [29, BE]],
  },
  4: {
    [TIM]: [[11, QB], [20, RB], [31, WR], [21, FLEX], [23, BE], [41, BE]],          // m7: +Extra
    [MITCH]: [[12, QB], [24, RB], [32, WR], [25, FLEX], [33, BE], [13, BE]],        // m4: +Yates -Lock
    [CAL]: [[14, QB], [22, RB], [34, WR], [37, FLEX], [28, BE]],                    // m8: -Sub
    [DEE]: [[15, QB], [27, RB], [36, WR], [38, FLEX], [29, BE]],                    // m6: +Wire -Chase
  },
};

// Real totals, added up by hand from the starters above:
//   Tim   62 / 58 / 58 / 55     Mitch 57 / 63 / 68 / 61
//   Cal   61 / 57 / 66 / 57     Dee   55.3 / 56 / 50 / 56
// Cal's week 2 is booked at 57.5, half a point over its starters (an ESPN stat
// correction), so a total rebuilt from the starters would be caught out.
// Projected totals likewise: Tim 59/59/53/54, Mitch 58/56/58/60, Cal 59/59/60/58, Dee 55/55/60/56.
const GAMES = [
  { week: 1, homeId: TIM, awayId: MITCH, homeActual: 62, awayActual: 57, homeProjected: 59, awayProjected: 58, matchupId: 1 },
  { week: 1, homeId: CAL, awayId: DEE, homeActual: 61, awayActual: 55.3, homeProjected: 59, awayProjected: 55, matchupId: 2 },
  { week: 2, homeId: TIM, awayId: CAL, homeActual: 58, awayActual: 57.5, homeProjected: 59, awayProjected: 59, matchupId: 3 },
  { week: 2, homeId: MITCH, awayId: DEE, homeActual: 63, awayActual: 56, homeProjected: 56, awayProjected: 55, matchupId: 4 },
  { week: 3, homeId: TIM, awayId: DEE, homeActual: 58, awayActual: 50, homeProjected: 53, awayProjected: 60, matchupId: 5 },
  { week: 3, homeId: MITCH, awayId: CAL, homeActual: 68, awayActual: 66, homeProjected: 58, awayProjected: 60, matchupId: 6 },
  { week: 4, homeId: TIM, awayId: MITCH, homeActual: 55, awayActual: 61, homeProjected: 54, awayProjected: 60, matchupId: 7 },
  { week: 4, homeId: CAL, awayId: DEE, homeActual: 57, awayActual: 56, homeProjected: 58, awayProjected: 56, matchupId: 8 },
  // Week 5 is not final: it must pass through untouched and count for nothing.
  { week: 5, homeId: TIM, awayId: CAL, homeActual: null, awayActual: null, homeProjected: 50, awayProjected: 51, matchupId: 9 },
];
// Real results: wk1 Tim, Cal · wk2 Tim, Mitch · wk3 Tim, Mitch · wk4 Mitch, Cal.
// Real records: Tim 3-1, Mitch 3-1, Cal 2-2, Dee 0-4.

const MOVES = [
  { id: 'm1', kind: 'adddrop', week: 2, at: TUE(2) + 9 * H, teamId: TIM, adds: [11], drops: [10], trade: null },
  { id: 'm2', kind: 'adddrop', week: 2, at: TUE(2) + DAY + 9 * H, teamId: MITCH, adds: [10], drops: [39], trade: null },
  { id: 'm5', kind: 'trade', week: 3, at: TUE(3) + 9 * H, teamId: TIM, adds: [], drops: [], trade: { withTeamId: DEE, gives: [30], gets: [21] } },
  // Sunday night of week 3: Hot's game is over (he scored 35 on Cal's bench),
  // Late plays Monday. So Late counts from week 3 and Hot from week 4.
  { id: 'm3', kind: 'adddrop', week: 3, at: SUN(3) + 9 * H, teamId: CAL, adds: [37], drops: [26], trade: null },
  { id: 'm4', kind: 'adddrop', week: 4, at: TUE(4) + 9 * H, teamId: MITCH, adds: [25], drops: [10], trade: null },
  { id: 'm6', kind: 'adddrop', week: 4, at: TUE(4) + DAY + 9 * H, teamId: DEE, adds: [38], drops: [30], trade: null },
  { id: 'm7', kind: 'add', week: 4, at: TUE(4) + 2 * DAY, teamId: TIM, adds: [41], drops: [], trade: null },
  { id: 'm8', kind: 'drop', week: 4, at: TUE(4) + 3 * DAY, teamId: CAL, adds: [], drops: [35], trade: null },
];

function buildWorld() {
  const players = new Map();
  for (const [id, [name, position, ...weeks]] of Object.entries(STATS)) {
    const byWeek = {};
    weeks.forEach(([actual, projected], i) => {
      const w = i + 1;
      byWeek[w] = { actual, projected, kickoff: Number(id) === 37 ? MON(w) : SUN(w) };
    });
    players.set(Number(id), { name, position, byWeek });
  }
  const rosters = new Map();
  for (const [week, byTeam] of Object.entries(ROSTERS)) {
    rosters.set(Number(week), Object.entries(byTeam).map(([teamId, list]) => ({
      id: Number(teamId),
      players: list.map(([playerId, lineupSlotId]) => {
        const [name, position, ...weeks] = STATS[playerId];
        const [actual, projected] = weeks[Number(week) - 1];
        return { playerId, name, position, slot: SLOT_NAME[lineupSlotId], lineupSlotId, started: lineupSlotId !== BE, projected, actual };
      }),
    })));
  }
  return {
    slots: [QB, RB, WR, FLEX],
    teams: [
      { id: TIM, name: 'Tim', teamName: 'Team Tim' }, { id: MITCH, name: 'Mitchell', teamName: 'Team Mitch' },
      { id: CAL, name: 'Cal', teamName: 'Team Cal' }, { id: DEE, name: 'Dee', teamName: 'Team Dee' },
    ],
    weeks: [1, 2, 3, 4],
    games: GAMES.map((g) => ({ ...g })),
    rosters,
    moves: MOVES.map((m) => ({ ...m })),
    players,
    limits: { roster: 6 },
  };
}

const world = buildWorld();
const frozen = JSON.stringify([world.games, world.moves, [...world.rosters], [...world.players]]);
const WEEKS = [1, 2, 3, 4];
const TEAMS = [TIM, MITCH, CAL, DEE];

const totals = (m, teamId) => WEEKS.map((w) => m.teams.get(teamId).byWeek[w].total);
const cell = (m, teamId, week) => m.teams.get(teamId).byWeek[week];
const lineup = (m, teamId, week) => cell(m, teamId, week).starters.map((s) => `${s.slot} ${s.name}`);
const rec = (m, teamId) => m.records.get(teamId);
const flipList = (m) => m.flips.map((f) => `wk${f.week} ${f.teamId}v${f.oppId} ${f.real}>${f.mirror}`).sort();
const pick = (list, id) => list.find((d) => d.id === id);
const REAL_TOTALS = { [TIM]: [62, 58, 58, 55], [MITCH]: [57, 63, 68, 61], [CAL]: [61, 57.5, 66, 57], [DEE]: [55.3, 56, 50, 56] };

// ---- listDecisions ----------------------------------------------------------
const tims = D.listDecisions(world, TIM);
eq(tims.map((d) => d.id), [
  'move:m1', 'move:m5', 'move:m7',
  'lineup-reasonable:1:all', 'lineup-perfect:1:all',
  'lineup-reasonable:1:1', 'lineup-perfect:1:1', 'lineup-reasonable:1:2', 'lineup-perfect:1:2',
  'lineup-reasonable:1:3', 'lineup-perfect:1:3', 'lineup-reasonable:1:4', 'lineup-perfect:1:4',
], 'Tim’s list: his three moves in time order, then the season lineups, then each week’s');
const dM1 = pick(tims, 'move:m1');
eq([dM1.kind, dM1.week, dM1.label, dM1.empty], ['adddrop', 2, 'Added Bryce Young, dropped Drew Lock', false],
  'an add and a drop made in one action are ONE decision, named with both players');
eq([pick(tims, 'move:m5').kind, pick(tims, 'move:m5').label], ['trade', "Traded Ja'Marr Chase for James Cook III"], 'a trade, said from Tim’s side');
eq([pick(tims, 'move:m7').kind, pick(tims, 'move:m7').label, pick(tims, 'move:m7').empty], ['add', 'Added Ed Extra', true],
  'picking up a man who never started is listed, and empty: nothing would have changed');
eq(pick(tims, 'lineup-reasonable:1:3').label, 'Week 3 lineup, highest projections', 'the reasonable label');
eq(pick(tims, 'lineup-perfect:1:3').label, 'Week 3 lineup, perfect hindsight', 'the perfect label');
eq(pick(tims, 'lineup-reasonable:1:all').week, null, 'the whole-season entry has week null');

const dees = D.listDecisions(world, DEE);
eq(pick(dees, 'move:m5').label, "Traded James Cook III for Ja'Marr Chase", 'the same trade on the partner’s list, said from her side');
eq(pick(dees, 'move:m6').label, "Added Will Wire, dropped Ja'Marr Chase", 'her add+drop');
const cals = D.listDecisions(world, CAL);
eq([pick(cals, 'move:m8').kind, pick(cals, 'move:m8').label], ['drop', 'Dropped Sam Sub'], 'a lone drop');
ok(!cals.some((d) => d.id === 'move:m1'), 'another team’s move is not on Cal’s list');

// ---- the dropped QB (Tim's own example) --------------------------------------
// Real: Tim drops Lock for Young (m1, week 2). Mitch picks Lock up for Benchy
// (m2) and starts him weeks 2 and 3, then drops him for Yates in week 4 (m4).
// Mirror, m1 undone: Tim keeps Lock and never has Young, so
//   Tim   wk2 58 - Young 12 + Lock 26 = 72 · wk3 58 - 9 + 25 = 74 · wk4 55 - 20 + 28 = 63
// Mitch cannot add Lock. His QB slot goes to his best PROJECTED quarterback:
// Mayfield (17) over Stroud (12), though Stroud scored 26 that week.
//   Mitch wk2 63 - Lock 26 + Mayfield 12 = 49
// And because the pickup could not happen, he does not cut Benchy for nothing:
// Benchy stays on his roster. Week 2 Benchy (projected 4) starts over nobody.
// Week 3 Benchy is projected 11 to the FLEX Wilson's 10, so he starts, and
// scores 1 to Wilson's 11:
//   Mitch wk3 68 - Lock 25 + Mayfield 14 - Wilson 11 + Benchy 1 = 47
// In week 4 he still adds Yates (the Lock he "drops" is not his). His lineup is
// the real one again (Benchy, projected 4, beats nobody), so 61 exactly, with
// seven men on a roster of six.
const m1 = D.mirror(world, dM1);
eq(totals(m1, TIM), [62, 72, 74, 63], 'm1 undone: Tim scores with Lock instead of Young, both halves of the action undone');
eq(lineup(m1, TIM, 2), ['QB Drew Lock', 'RB Devon Achane', "WR Ja'Marr Chase", 'FLEX Stefon Diggs'], 'Tim’s week 2: Lock back in the QB slot, Young gone');
ok(cell(m1, TIM, 2).starters[0].isNew === true && cell(m1, TIM, 2).starters[1].isNew === false, 'only the man who was not really starting is marked new');
eq(cell(m1, TIM, 2).realStarters.map((s) => s.name), ['Bryce Young', 'Devon Achane', "Ja'Marr Chase", 'Stefon Diggs'], 'the real starters ride along for the page');
eq(totals(m1, MITCH), [57, 49, 47, 61], 'm1 undone: the opponent can no longer add the QB, and keeps the man he really dropped for him');
eq(lineup(m1, MITCH, 3), ['QB Baker Mayfield', 'RB Saquon Barkley', 'WR Justin Jefferson', 'FLEX Ben Benchy'], 'the kept man is on his mirror roster and starts where his projection beats a starter');
eq(lineup(m1, MITCH, 2)[3], 'FLEX Garrett Wilson', 'and sits where it does not');
eq(lineup(m1, MITCH, 2)[0], 'QB Baker Mayfield', 'he starts his best-PROJECTED quarterback (17 over 12), not the one who scored more');
eq(m1.skipped.map((s) => [s.moveId, s.teamId, s.week, s.playerId, s.kept]), [['m2', MITCH, 2, 10, [39]]], 'his pickup of Lock is the one move that could not happen, listed once, naming the man he keeps');
ok(/Drew Lock/.test(m1.skipped[0].reason) && /Tim/.test(m1.skipped[0].reason), 'and the reason names the player and who still had him', m1.skipped[0].reason);
eq(lineup(m1, MITCH, 4), ['QB Baker Mayfield', 'RB Saquon Barkley', 'WR Justin Jefferson', 'FLEX Yan Yates'],
  'his later "add Yates, drop Lock" still adds Yates');
ok(cell(m1, MITCH, 4).changed === false && cell(m1, MITCH, 4).total === 61, 'and that week is his real one again');
eq(totals(m1, CAL), REAL_TOTALS[CAL], 'Cal is untouched: every week its real total, the half-point correction included');
eq(totals(m1, DEE), REAL_TOTALS[DEE], 'Dee is untouched (55.3 stays 55.3, not a re-added 55.300000000000004)');
ok(WEEKS.every((w) => cell(m1, CAL, w).total === cell(m1, CAL, w).realTotal && !cell(m1, CAL, w).changed), 'untouched means exactly equal and not "changed"');
// Results, mirror: wk2 Mitch 49 v Dee 56 (was 63 v 56), wk3 Mitch 47 v Cal 66
// (was 68 v 66), wk4 Tim 63 v Mitch 61 (was 55 v 61). Three games flip.
eq(flipList(m1), ['wk2 2v4 W>L', 'wk2 4v2 L>W', 'wk3 2v3 W>L', 'wk3 3v2 L>W', 'wk4 1v2 L>W', 'wk4 2v1 W>L'], 'three matchups flip, each listed for both teams');
eq(rec(m1, TIM), { real: { w: 3, l: 1, t: 0 }, mirror: { w: 4, l: 0, t: 0 } }, 'Tim 3-1 becomes 4-0');
eq(rec(m1, MITCH), { real: { w: 3, l: 1, t: 0 }, mirror: { w: 0, l: 4, t: 0 } }, 'Mitch 3-1 becomes 0-4');
eq(rec(m1, CAL), { real: { w: 2, l: 2, t: 0 }, mirror: { w: 3, l: 1, t: 0 } }, 'Cal 2-2 becomes 3-1 without one of its own scores moving');
eq(rec(m1, DEE), { real: { w: 0, l: 4, t: 0 }, mirror: { w: 1, l: 3, t: 0 } }, 'Dee 0-4 becomes 1-3');
// games: mirror actual AND projected, everything else copied.
const g4 = m1.games.find((g) => g.week === 2 && g.homeId === MITCH);
eq([g4.homeActual, g4.awayActual, g4.homeProjected, g4.awayProjected, g4.matchupId], [49, 56, 58, 55, 4],
  'the game carries mirror points and mirror projections (Mitch 56 - Lock 15 + Mayfield 17 = 58), other fields copied');
eq([cell(m1, TIM, 2).projected, cell(m1, TIM, 2).realProjected], [58, 59], 'Tim’s week 2 projection: 59 - Young 16 + Lock 15 = 58');
eq(m1.games.find((g) => g.week === 5), GAMES[8], 'a week that is not final passes through untouched');
eq(m1.over, [{ teamId: MITCH, week: 4, size: 7, limit: 6, extra: 1 }], 'keeping Benchy and still adding Yates leaves him one over, and that is reported');

// ---- a move after the player's game counts from the next week ----------------
// m3 undone. Late (Monday game) was added in time for week 3, so he is gone
// from week 3: Cal's FLEX goes to the best-projected bench man, Hall (10) over
// Sub (9): 66 - Late 17 + Hall 7 = 56. Hot's game had already been played when
// he was dropped, so he is back only from week 4 (had he counted in week 3 his
// 20 projection would take the FLEX and Cal would score 66 - 17 + 35 = 84).
// Week 4: FLEX to Hot (13) over Hall (10): 57 - Late 6 + Hot 24 = 75.
const m3 = D.mirror(world, pick(cals, 'move:m3'));
eq(totals(m3, CAL), [61, 57.5, 56, 75], 'm3 undone: Late is gone from week 3, Hot is back only from week 4');
eq(lineup(m3, CAL, 3)[3], 'FLEX Breece Hall', 'week 3 FLEX: the bench man, not the back whose game was already over');
eq(lineup(m3, CAL, 4)[3], 'FLEX Hal Hot', 'week 4 FLEX: the kept back');
eq([flipList(m3), rec(m3, CAL).mirror], [[], { w: 2, l: 2, t: 0 }], 'no result changes (56 still loses to 68, 75 still beats 56)');

// ---- an arrival starts only if his projection beats a starter ----------------
// m8 undone: Sub (projected 14) is back in week 4 and beats the FLEX, Late (9):
// 57 - 6 + 9 = 60. m7 undone: Extra never started, nothing moves.
const m8 = D.mirror(world, pick(cals, 'move:m8'));
eq([totals(m8, CAL), lineup(m8, CAL, 4)[3]], [[61, 57.5, 66, 60], 'FLEX Sam Sub'], 'm8 undone: the kept man out-projects the weakest slot he fits, and starts');
const m7 = D.mirror(world, pick(tims, 'move:m7'));
ok(TEAMS.every((t) => JSON.stringify(totals(m7, t)) === JSON.stringify(REAL_TOTALS[t])), 'm7 undone: every team-week is the real one');
// m2 undone: Benchy is back on Mitch's bench and starts only in week 3 (11 over
// Wilson's 10): 68 - Lock 25 + Mayfield 14 - Wilson 11 + Benchy 1 = 47.
// Week 2 he has 6 men, week 4 he has his real 6 plus Benchy: one over.
const m2 = D.mirror(world, pick(D.listDecisions(world, MITCH), 'move:m2'));
eq(totals(m2, MITCH), [57, 49, 47, 61], 'm2 undone: no Lock in weeks 2 and 3, Benchy starts only where he out-projects');
eq(m2.over, [{ teamId: MITCH, week: 4, size: 7, limit: 6, extra: 1 }], 'roster limits are not enforced, the team-week left one over is reported');
eq(m2.skipped, [], 'and Mitch dropping a Lock nobody holds in the mirror is not a skipped move');
// m4 undone: Yates out of the FLEX, Wilson (10) in; Lock back and out-projects
// Mayfield 18 to 17: 61 - 13 + 12 - 16 + 28 = 72.
const m4 = D.mirror(world, pick(D.listDecisions(world, MITCH), 'move:m4'));
eq([totals(m4, MITCH)[3], lineup(m4, MITCH, 4)], [72, ['QB Drew Lock', 'RB Saquon Barkley', 'WR Justin Jefferson', 'FLEX Garrett Wilson']],
  'm4 undone: both halves again, one filling a slot and one beating a starter');

// ---- a trade undone on both sides --------------------------------------------
// m5 undone: Tim keeps Chase, Dee keeps Cook.
//   Tim wk3 58 - Cook 21 + Chase 8 = 45 · wk4 55 - Cook 14 + Chase 19 = 60
//   Dee wk3 50 - Chase 8 + Cook 21 = 63
// Dee's later "add Wire, drop Chase" (m6): she has no Chase to drop, the add
// stands. Cook (13) does not out-project Taylor (15) or Wire (14), so week 4
// is her real lineup: 56.
const m5 = D.mirror(world, pick(tims, 'move:m5'));
eq(totals(m5, TIM), [62, 58, 45, 60], 'm5 undone: Tim plays Chase, not Cook');
eq(totals(m5, DEE), [55.3, 56, 63, 56], 'm5 undone: Dee plays Cook, not Chase');
eq(lineup(m5, DEE, 4)[3], 'FLEX Will Wire', 'her later move that "drops" the traded man still adds Wire');
eq(m5.skipped, [], 'and is not a skipped move');
eq(flipList(m5), ['wk3 1v4 W>L', 'wk3 4v1 L>W'], 'week 3 flips: 45 v 63');
eq([rec(m5, TIM).mirror, rec(m5, DEE).mirror], [{ w: 2, l: 2, t: 0 }, { w: 1, l: 3, t: 0 }], 'Tim 2-2, Dee 1-3');
eq(D.mirror(world, pick(dees, 'move:m5')).games, m5.games, 'the same trade picked from the partner’s list is the same mirror');

// ---- a what-if trade ---------------------------------------------------------
// "If this trade happened this week": week 2, Tim sends Chase to Cal for Gibbs.
//   Tim wk2: no receiver left on his bench, so Diggs moves to WR and Gibbs (16)
//            takes the FLEX: 58 - Chase 22 + Gibbs 12 = 48
//   Tim wk3: the real Chase-for-Cook trade cannot happen (Chase is Cal's), so
//            no Cook: FLEX to Gibbs: 58 - 21 + 15 = 52 · wk4 55 - 14 + 20 = 61
//   Cal wk2: RB slot to Hot (the only spare back), Chase (18) beats the FLEX
//            Hall (10): starters 16 + 6 + 21 + 22 = 65, so 57.5 - 57 + 65 = 65.5
//   Cal wk3: RB to Hall, Chase beats Late (11): 66 - 15 + 7 - 17 + 8 = 49
//   Cal wk4: 57 - 20 + 10 - 6 + 19 = 60
//   Dee wk3: keeps Cook, loses Chase: 50 - 8 + 21 = 63 · wk4 56 (Cook benched)
const whatIf = { kind: 'whatif-trade', week: 2, teamId: TIM, withTeamId: CAL, gives: [30], gets: [22] };
const wi = D.mirror(world, whatIf);
eq(totals(wi, TIM), [62, 48, 52, 61], 'what-if: Tim from the chosen week on');
eq(lineup(wi, TIM, 2), ['QB Bryce Young', 'RB Devon Achane', 'WR Stefon Diggs', 'FLEX Jahmyr Gibbs'], 'a slot nobody on the bench fits is filled by shifting a starter, not left empty');
eq(totals(wi, CAL), [61, 65.5, 49, 60], 'what-if: Cal from the chosen week on, on top of its booked 57.5');
eq(totals(wi, DEE), [55.3, 56, 63, 56], 'what-if: a third team changes because the later real trade cannot happen');
eq(totals(wi, MITCH), REAL_TOTALS[MITCH], 'what-if: Mitch untouched');
eq(wi.skipped.map((s) => [s.moveId, s.teamId, s.week, s.kept]), [['m5', TIM, 3, []]], 'the later real trade needing the traded player is skipped whole');
// wk2 Tim 48 v Cal 65.5, wk3 Tim 52 v Dee 63, wk4 Tim 61 v Mitch 61: a tie.
eq(flipList(wi), ['wk2 1v3 W>L', 'wk2 3v1 L>W', 'wk3 1v4 W>L', 'wk3 4v1 L>W', 'wk4 1v2 L>T', 'wk4 2v1 W>T'], 'what-if flips, a tie among them');
eq([rec(wi, TIM).mirror, rec(wi, MITCH).mirror, rec(wi, CAL).mirror, rec(wi, DEE).mirror],
  [{ w: 1, l: 2, t: 1 }, { w: 2, l: 1, t: 1 }, { w: 3, l: 1, t: 0 }, { w: 1, l: 3, t: 0 }], 'what-if records, with the tie as its own number');

// ---- lineup decisions --------------------------------------------------------
ok(tims.filter((d) => d.kind.startsWith('lineup')).every((d) => d.empty && d.detail.length === 0),
  'Tim already started his best projections every week (and nothing better in hindsight): every lineup entry is empty');
const mitchs = D.listDecisions(world, MITCH);
// Week 2: Mayfield was projected 17 to Lock's 15, so "reasonable" benches the
// man who scored 26: 63 - 26 + 12 = 49, and the win over Dee (56) is lost.
const r2 = pick(mitchs, 'lineup-reasonable:2:2');
eq([r2.empty, r2.detail], [false, [{ week: 2, out: 'Drew Lock', in: 'Baker Mayfield', outId: 10, inId: 12 }]], 'reasonable, week 2: the one swap that differs');
const mr2 = D.mirror(world, r2);
eq([totals(mr2, MITCH), flipList(mr2), rec(mr2, MITCH).mirror], [[57, 49, 68, 61], ['wk2 2v4 W>L', 'wk2 4v2 L>W'], { w: 2, l: 2, t: 0 }], 'reasonable, week 2: 49, and the game flips');
ok([TIM, CAL, DEE].every((t) => JSON.stringify(totals(mr2, t)) === JSON.stringify(REAL_TOTALS[t])), 'a lineup decision changes only the picked team');
// Cal's own week 4 was not its best projections (see below), so this one bites.
eq(totals(D.mirror(world, pick(mitchs, 'lineup-reasonable:2:all')), CAL), REAL_TOTALS[CAL], 'even a team that did not start its best projections is left as it was');
ok(pick(mitchs, 'lineup-reasonable:2:3').empty, 'week 3: Lock and Mayfield were both projected 17, a tie counts as matching');
ok(pick(mitchs, 'lineup-perfect:2:2').empty, 'perfect, week 2: Stroud scored the same 26 as Lock, a tie counts as matching');
// Perfect, week 1: Stroud (20) for Mayfield (17): 57 + 3 = 60. Still loses to 62.
const p1 = pick(mitchs, 'lineup-perfect:2:1');
eq([p1.detail, totals(D.mirror(world, p1), MITCH)], [[{ week: 1, out: 'Baker Mayfield', in: 'CJ Stroud', outId: 12, inId: 13 }], [60, 63, 68, 61]], 'perfect, week 1: 60');
eq(pick(mitchs, 'lineup-reasonable:2:all').detail.map((s) => s.week), [2], 'the whole-season reasonable entry lists every differing week');
eq(totals(D.mirror(world, pick(mitchs, 'lineup-perfect:2:all')), MITCH), [60, 63, 68, 61], 'the whole-season perfect entry changes every week it can');
eq(totals(D.mirror(world, pick(mitchs, 'lineup-reasonable:2:1')), MITCH), REAL_TOTALS[MITCH], 'a one-week entry leaves the other weeks alone, even one it could improve');
// Cal, week 4: Hall was projected 10 to Late's 9 and scored 10 to his 6: 61 both ways.
eq([totals(D.mirror(world, pick(cals, 'lineup-reasonable:3:4')), CAL)[3], totals(D.mirror(world, pick(cals, 'lineup-perfect:3:4')), CAL)[3]], [61, 61], 'Cal week 4: 57 - 6 + 10 = 61 both ways');
// Dee's week 1 best lineup puts Taylor at RB and Cook in the FLEX: the same
// four men in other slots is not a change.
ok(pick(dees, 'lineup-reasonable:4:1').empty && D.mirror(world, pick(dees, 'lineup-reasonable:4:1')).teams.get(DEE).byWeek[1].total === 55.3,
  'the same starters in different slots is empty, and the total is the real one exactly');
let worse = 0;
for (const t of TEAMS) {
  const all = D.listDecisions(world, t);
  const perfect = D.mirror(world, pick(all, `lineup-perfect:${t}:all`));
  const reasonable = D.mirror(world, pick(all, `lineup-reasonable:${t}:all`));
  for (const w of WEEKS) {
    if (cell(perfect, t, w).total < cell(perfect, t, w).realTotal) worse++;
    if (cell(perfect, t, w).total < cell(reasonable, t, w).total) worse++;
  }
}
eq(worse, 0, 'perfect is never below real, nor below reasonable, in any of the 16 team-weeks');

// ---- noise -------------------------------------------------------------------
eq(D.NOISE, { touchedPerWeek: 0.1, otherFreeWeeks: 2, otherPerWeek: 0.03, freedPoints: 20, freedMax: 0.6, dim: 0.65 }, 'the constants, in one exported table');
ok(TEAMS.every((t) => WEEKS.every((w) => mr2.noise.get(t)[w] === 0)), 'a lineup decision has no noise anywhere');
const nz = (m, t) => WEEKS.map((w) => m.noise.get(t)[w]);
// m1 undone, first affected week 2. Touched: Tim, and Mitch (a skipped move).
// Young is unowned in the mirror; he only out-scores a quarterback in week 4
// (20): Mayfield 16 -> 0.2, Goff 15 -> 0.25, Nix 18 -> 0.1.
//   Tim   0, 0, 0.10, 0.20 (he is the one who really had Young)
//   Mitch 0, 0, 0.10, 1 - 0.8 x 0.8 = 0.36
//   Cal   0, 0, 0,    1 - 0.97 x 0.75 = 0.2725
//   Dee   0, 0, 0,    1 - 0.97 x 0.90 = 0.127
eq(nz(m1, TIM), [0, 0, 0.1, 0.2], 'noise, the decision’s team: 0 in the first affected week, then +0.10 a week');
eq(nz(m1, MITCH), [0, 0, 0.1, 0.36], 'noise, a team with a skipped move is touched too; sources combine as 1 - product');
eq(nz(m1, CAL), [0, 0, 0, 0.2725], 'noise, everyone else: nothing for two weeks, then 0.03, combined with the freed QB');
eq(nz(m1, DEE), [0, 0, 0, 0.127], 'noise, less for the team whose QB out-scored the freed one by more');
// m2 undone: Lock is unowned in weeks 2 and 3 (26 and 25 points).
//   wk2: Tim's QB Young 12 -> 0.7, capped 0.6 · Dee's Nix 15 -> 0.55 · Cal's Goff 16 -> 0.5
//   wk3: Young 9 -> capped 0.6 · Goff 20 -> 0.25 · Nix 13 -> 0.6
//   wk4: Lock is where he really was again (dropped): only time, 0.03.
eq(nz(m2, TIM), [0, 0.6, 0.6, 0.03], 'a QB is freed: the team with the weakest QB gets the most noise (capped at 0.6)');
eq(nz(m2, DEE), [0, 0.55, 0.6, 0.03], 'the next weakest QB, a little less');
eq(nz(m2, CAL), [0, 0.5, 0.25, 0.03], 'the strongest QB, least');
eq(nz(m2, MITCH), [0, 0, 0.1, 0.2], 'the team that really had him gets time only, rising by week');
// m3 undone, first affected week 3 (Late). Late 17 in week 3 against each
// team's weakest WR-or-FLEX starter: Tim's Diggs 12 -> 0.25, Mitch's Wilson
// 11 -> 0.3, Dee's Chase 8 -> 0.45. Week 4 he scored 6: nothing.
eq([nz(m3, TIM), nz(m3, MITCH), nz(m3, DEE), nz(m3, CAL)], [[0, 0, 0.25, 0], [0, 0, 0.3, 0], [0, 0, 0.45, 0], [0, 0, 0, 0.1]],
  'a freed receiver is measured against the slots HE could fill, and the clock starts at the first week that counts');
eq([nz(wi, TIM), nz(wi, CAL), nz(wi, DEE), nz(wi, MITCH)], [[0, 0, 0.1, 0.2], [0, 0, 0.1, 0.2], [0, 0, 0.1, 0.2], [0, 0, 0, 0.03]],
  'what-if: both sides and the team whose trade was skipped are touched; nobody is freed');
ok(TEAMS.every((t) => WEEKS.every((w) => { const n = m1.noise.get(t)[w]; return n >= 0 && n <= 1; })), 'noise stays within 0..1');

// ---- the small helpers -------------------------------------------------------
eq(D.rosterAt(world, TIM, 3).map((p) => p.name), ['Bryce Young', 'Devon Achane', 'Stefon Diggs', 'James Cook III', 'Mo Mason'], 'rosterAt: the roster that week was scored with');
eq(D.rosterAt(world, TIM, 9), [], 'rosterAt: a week not held is empty');
D.rosterAt(world, TIM, 3)[0].name = 'changed';
eq(D.rosterAt(world, TIM, 3)[0].name, 'Bryce Young', 'rosterAt hands out copies');
eq(D.recordOf(world.games, TIM), { w: 3, l: 1, t: 0 }, 'recordOf: a game with no score counts for nothing');
eq(D.recordOf(wi.games, TIM, [1, 2]), { w: 1, l: 1, t: 0 }, 'recordOf: only the weeks asked for');
eq(D.mirror(world, { kind: 'adddrop', moveId: 'nope' }).flips, [], 'a decision that names no known move is the real season');
eq(JSON.stringify([world.games, world.moves, [...world.rosters], [...world.players]]), frozen, 'the world handed in is never altered');
eq(m1.pending, [], 'a world with no week in play has no pending game');

// ---- the week in play ----------------------------------------------------------
// Tim, 2026-10-05: "right now the partial weeks are shown, but not updated
// fully with the hypothetical ... Instead of just showing 0 for week for and not
// contributing it to the total, just show what you have right now, so if my
// bench QB scored 8 more than my starter, then my dif should show +8, along
// with any of the other differences. If the information is partial (not all the
// bench players have played yet), then just put a little 'live' sign by the
// week number".
//
// The same league with week 4 NOT closed (`partialWeek: 4`): one of its two
// games is over early and the other is being played. `inPlay` is the pair still
// playing (their game has no scores); `notDone` the men yet to finish.
//
// A MAN'S VALUE in that week is his score once he has finished and his pre-game
// projection until then. A team's ACTUAL is its finished starters' points (its
// real score once its matchup is over); the HYPOTHETICAL is that plus, for each
// lineup change, the value of the man in less the value of the man out.
function partialWorld({ inPlay, notDone }) {
  const w = buildWorld();
  const open = new Set(notDone);
  w.partialWeek = 4;
  w.games = w.games.map((g) => (g.week === 4 && inPlay.includes(g.homeId) ? { ...g, homeActual: null, awayActual: null } : g));
  for (const t of w.rosters.get(4)) for (const p of t.players) p.done = !open.has(p.playerId);
  for (const [id, p] of w.players) for (const wk of WEEKS) p.byWeek[wk].done = wk < 4 || !open.has(id);
  return w;
}
const none = { kind: 'adddrop', moveId: 'nope' };
const recs = (m) => TEAMS.map((t) => [rec(m, t).real, rec(m, t).mirror].map((r) => `${r.w}-${r.l}`).join(' / '));
const ids = (list, prefix) => list.filter((d) => d.id.startsWith(prefix)).map((d) => d.id);
const lives = (m) => TEAMS.map((t) => cell(m, t, 4).live === true);
/** A team-week as the page's weekly table prints it: actual, hypothetical, difference. */
const row = (m, t, w = 4) => [cell(m, t, w).realTotal, cell(m, t, w).total, Math.round((cell(m, t, w).total - cell(m, t, w).realTotal) * 100) / 100];
/** The Total row's difference for one team: every week held, the one in play included. */
const totalDiff = (m, t) => Math.round(WEEKS.reduce((a, w) => a + row(m, t, w)[2], 0) * 100) / 100;

// P: Tim v Mitch is over (55–61), Cal v Dee is being played — Goff (Cal's QB)
// and Wire (Dee's FLEX) are still to finish, as are the free agent Hot and
// Mitch's bench receiver Wilson.
//   Real, through week 3: Tim 3-0, Mitch 2-1, Cal 1-2, Dee 0-3. Week 4 adds only
//   the finished game: Tim 3-1, Mitch 3-1; Cal and Dee stay where they were.
//   So far: Cal 20 + 16 + 6 = 42 without Goff, Dee 18 + 12 + 11 = 41 without Wire.
const P = partialWorld({ inPlay: [CAL, DEE], notDone: [14, 38, 26, 33] });
const pNone = D.mirror(P, none);
eq(pNone.pending, [{ week: 4, homeId: CAL, awayId: DEE }], 'the game being played is listed as pending');
eq(recs(pNone), ['3-1 / 3-1', '3-1 / 3-1', '1-2 / 1-2', '0-3 / 0-3'], 'the finished game counts in both records, the one in play in neither');
ok(pNone.games.some((g) => g.week === 4 && g.homeId === TIM) && !pNone.games.some((g) => g.week === 4 && g.homeId === CAL),
  'and only the finished one is in the mirror’s games');
eq([cell(pNone, CAL, 4).pending, row(pNone, CAL), cell(pNone, DEE, 4).pending, row(pNone, DEE)],
  [true, [42, 42, 0], true, [41, 41, 0]], 'both teams of the game in play are pending, and show the points their finished starters have so far');
eq([cell(pNone, TIM, 4).pending, cell(pNone, TIM, 4).total, cell(pNone, TIM, 4).realTotal], [undefined, 55, 55], 'a finished team-week is what it always was');
eq(cell(pNone, CAL, 4).realStarters.map((s) => [s.name, s.actual, s.done, s.known, s.value]),
  [['Jared Goff', null, false, false, 18], ['Jahmyr Gibbs', 20, true, true, 20], ['Puka Nacua', 16, true, true, 16], ['Lee Late', 6, true, true, 6]],
  'each starter says whether his number is known: a score for a finished man, his pre-game projection for one still playing');
ok(cell(pNone, TIM, 3).starters.every((s) => !('known' in s) && !('value' in s)) && cell(pNone, TIM, 3).live === undefined,
  'a finished week carries none of this');
eq(pNone.games.find((g) => g.week === 5), GAMES[8], 'a later week still passes through untouched');
// LIVE: a team-week with anything still to come. Tim's whole roster is done and
// his game is over: not live. Mitch's game is over too, but Wilson on his bench
// has not finished: live. Cal and Dee are still playing: live.
eq(lives(pNone), [false, true, true, true], 'live marks the team-weeks with a man or a matchup unfinished, bench included');
ok(!('live' in cell(pNone, TIM, 4)) && WEEKS.slice(0, 3).every((w) => TEAMS.every((t) => !('live' in cell(pNone, t, w)))), 'and is absent everywhere else');
const allDone = partialWorld({ inPlay: [], notDone: [] });
eq([lives(D.mirror(allDone, none)), D.mirror(allDone, none).pending, recs(D.mirror(allDone, none))],
  [[false, false, false, false], [], ['3-1 / 3-1', '3-1 / 3-1', '2-2 / 2-2', '0-4 / 0-4']], 'every man done: nothing is live and nothing pending');

// m1 undone in P. Lock has finished, so Tim's mirror week 4 is known: 63 to
// Mitch's 61, and the finished game flips exactly as it did with the week closed.
//   Mirror: Tim 4-0 · Mitch 0-4 · Cal W, L, W = 2-1 · Dee L, W, L = 1-2.
const pm1 = D.mirror(P, pick(D.listDecisions(P, TIM), 'move:m1'));
eq([cell(pm1, TIM, 4).total, cell(pm1, MITCH, 4).total], [63, 61], 'm1 undone in the week in play: the finished game is replayed');
eq(recs(pm1), ['3-1 / 4-0', '3-1 / 0-4', '1-2 / 2-1', '0-3 / 1-2'], 'its result counts in the mirror’s record, and the game in play still in neither');
eq(flipList(pm1), ['wk2 2v4 W>L', 'wk2 4v2 L>W', 'wk3 2v3 W>L', 'wk3 3v2 L>W', 'wk4 1v2 L>W', 'wk4 2v1 W>L'], 'and it flips');
eq(pm1.pending, [{ week: 4, homeId: CAL, awayId: DEE }], 'the pending list is the game in play, nothing more');
// Noise is worked out for a pending team-week like any other, on the numbers
// shown: Cal's QB Goff is valued at his projection, 18, so the freed Young (20)
// is 2 over him: 0.1, and 1 - 0.97 x 0.9 = 0.127.
eq([nz(pm1, TIM), nz(pm1, CAL)], [[0, 0, 0.1, 0.2], [0, 0, 0, 0.127]], 'noise: the same rules in the week in play, on the values shown');

// The same, but Lock is STILL PLAYING. The mirror would start him at QB, so
// the game — over in real life — is not final in the mirror: pending, in
// NEITHER record. Its points are still shown: Lock at his projection, 18, for
// Young's 20: 55 - 20 + 18 = 53.
//   Tim 3-0 both ways · Mitch real 2-1, mirror L, L, L = 0-3.
const P2 = partialWorld({ inPlay: [CAL, DEE], notDone: [14, 38, 26, 33, 10] });
const pm2 = D.mirror(P2, pick(D.listDecisions(P2, TIM), 'move:m1'));
eq(lineup(pm2, TIM, 4)[0], 'QB Drew Lock', 'the mirror starts a man who has not finished');
eq(pm2.pending, [{ week: 4, homeId: TIM, awayId: MITCH }, { week: 4, homeId: CAL, awayId: DEE }], 'so that game is pending too');
eq(recs(pm2), ['3-0 / 3-0', '2-1 / 0-3', '1-2 / 2-1', '0-3 / 1-2'], 'and is in neither the real record nor the mirror’s');
eq([cell(pm2, TIM, 4).pending, row(pm2, TIM), cell(pm2, TIM, 4).live, cell(pm2, MITCH, 4).pending, row(pm2, MITCH)],
  [true, [55, 53, -2], true, true, [61, 61, 0]], 'both its team-weeks are pending, with the unfinished man valued at his projection');
eq(cell(pm2, TIM, 4).starters[0], { playerId: 10, name: 'Drew Lock', position: 'QB', slot: 'QB', slotId: 0, actual: null, projected: 18, isNew: true, done: false, known: false, value: 18 },
  'the starter not yet finished: no score, and the projection he is valued at');
ok(!flipList(pm2).some((f) => f.startsWith('wk4')) && !pm2.games.some((g) => g.week === 4), 'nothing of week 4 flips or is banked');
eq(nz(pm2, TIM), [0, 0, 0.1, 0.2], 'and its noise is the usual clock');
eq(recs(D.mirror(P2, none)), ['3-1 / 3-1', '3-1 / 3-1', '1-2 / 1-2', '0-3 / 0-3'], 'while a decision that never starts him still counts the finished game');

// Lineup decisions in the week in play: both kinds, for every team.
for (const [t, name] of [[TIM, 'Tim'], [MITCH, 'Mitch'], [CAL, 'Cal'], [DEE, 'Dee']]) {
  eq(ids(D.listDecisions(P, t), 'lineup-').slice(-2), [`lineup-reasonable:${t}:4`, `lineup-perfect:${t}:4`], `${name}: both week-4 lineups are offered, whoever is still playing`);
}
ok(pick(D.listDecisions(P, CAL), 'lineup-reasonable:3:all').detail.some((s) => s.week === 4), 'and the whole-season entries take the week in play in');
eq(ids(D.listDecisions(P, TIM), 'move:'), ['move:m1', 'move:m5', 'move:m7'], 'a move made in the week in play is listed like any other');
const pm8 = D.mirror(P, pick(D.listDecisions(P, CAL), 'move:m8'));
// m8 undone: Sub (done, 9) for Late (done, 6) in Cal's FLEX: 42 so far + 3 = 45.
eq([lineup(pm8, CAL, 4)[3], cell(pm8, CAL, 4).changed, cell(pm8, CAL, 4).pending, row(pm8, CAL), recs(pm8)[2]], ['FLEX Sam Sub', true, true, [42, 45, 3], '1-2 / 1-2'],
  'its effect on a team still playing is worked out and shown, with the result pending');

// A TEAM WHOSE MATCHUP IS IN PLAY: perfect hindsight for Cal's week 4 in P.
// Hall (bench, done, 10) for Late (FLEX, done, 6) is known: +4. Goff, still
// playing, is left where he is. 42 so far -> 46; no result yet.
const calsP = D.listDecisions(P, CAL);
const hP = pick(calsP, 'lineup-perfect:3:4');
const mhP = D.mirror(P, hP);
eq([hP.empty, hP.detail], [false, [{ week: 4, out: 'Lee Late', in: 'Breece Hall', outId: 37, inId: 28 }]], 'hindsight for a team still playing: the swap already known');
eq([row(mhP, CAL), cell(mhP, CAL, 4).pending, cell(mhP, CAL, 4).live, lineup(mhP, CAL, 4)[0]], [[42, 46, 4], true, true, 'QB Jared Goff'],
  'its difference shows, the starter still playing stays put, the result is pending and the week is live');
eq([totalDiff(mhP, CAL), recs(mhP)[2], flipList(mhP)], [4, '1-2 / 1-2', []], 'the +4 is in the total, and no record moves');

// TIM'S OWN CASE. T: Tim v Mitch is over (55–61) and every starter has
// finished. Tim has a spare QB on his bench, Sam Spare, who scored 28 — 8 more
// than Young's 20 — and was projected 12 (so "highest projections" would not
// have started him). One bench man, Extra, has still to play.
//   Perfect hindsight, week 4: +8, so 55 -> 63, which beats Mitch's 61.
//   Tim 3-1 -> 4-0, Mitch 3-1 -> 2-2. The week is live (Extra).
function spareWorld(notDone) {
  const w = partialWorld({ inPlay: [CAL, DEE], notDone });
  const done = !notDone.includes(16);
  w.players.set(16, { name: 'Sam Spare', position: 'QB', byWeek: Object.fromEntries(WEEKS.map((wk) => [wk,
    { actual: wk === 4 ? 28 : 0, projected: wk === 4 ? 12 : 0, kickoff: SUN(wk), done: wk < 4 || done }])) });
  w.rosters.get(4).find((t) => t.id === TIM).players.push(
    { playerId: 16, name: 'Sam Spare', position: 'QB', slot: 'BE', lineupSlotId: BE, started: false, projected: 12, actual: 28, done });
  return w;
}
const T = spareWorld([14, 38, 41]);
const timsT = D.listDecisions(T, TIM);
const hT = pick(timsT, 'lineup-perfect:1:4');
ok(hT, 'hindsight is offered although a bench man has still to play');
const mhT = D.mirror(T, hT || none);
eq([hT && hT.empty, hT && hT.detail], [false, [{ week: 4, out: 'Bryce Young', in: 'Sam Spare', outId: 11, inId: 16 }]], 'Tim’s case: the bench QB who scored 8 more is the swap');
eq(row(mhT, TIM), [55, 63, 8], 'Tim’s case: week 4 shows +8');
eq(totalDiff(mhT, TIM), 8, 'and the +8 is in the total');
eq([cell(mhT, TIM, 4).live, cell(mhT, TIM, 4).pending], [true, undefined], 'the week is live (a bench man has not played) but its matchup is final in both worlds');
eq([recs(mhT).slice(0, 2), flipList(mhT)], [['3-1 / 4-0', '3-1 / 2-2'], ['wk4 1v2 L>W', 'wk4 2v1 W>L']], 'so it counts in both records, and flips');
eq(totalDiff(D.mirror(T, pick(timsT, 'lineup-perfect:1:all')), TIM), 8, 'the whole-season hindsight entry carries it too');
ok(pick(timsT, 'lineup-reasonable:1:4').empty, 'highest projections would not have started him: empty, as before');
// A BENCH MAN WHO HAS NOT PLAYED IS NEVER STARTED BY HINDSIGHT, whatever he has
// so far: T2 is T with Spare himself still playing (28 and counting).
const T2 = spareWorld([14, 38, 41, 16]);
const hT2 = pick(D.listDecisions(T2, TIM), 'lineup-perfect:1:4');
eq([hT2.empty, row(D.mirror(T2, hT2), TIM), cell(D.mirror(T2, hT2), TIM, 4).live], [true, [55, 55, 0], true], 'hindsight never starts a bench man who has not finished');

// Q: the other way round. Cal v Dee is over (57–56), Tim v Mitch is being
// played, and Cal's bench back Hall has not finished.
//   Real: Tim 3-0, Mitch 2-1, Cal 2-2, Dee 0-4.
// "Highest projections" for Cal's week 4 would start Hall (10 over Late's 9) —
// a man still playing — so the finished game becomes pending for that decision:
// Cal 1-2 and Dee 0-3, in both worlds. Hall is valued at his projection, 10,
// against Late's score of 6: 57 -> 61.
const Q = partialWorld({ inPlay: [TIM, MITCH], notDone: [11, 28] });
eq(recs(D.mirror(Q, none)), ['3-0 / 3-0', '2-1 / 2-1', '2-2 / 2-2', '0-4 / 0-4'], 'Q: the finished game counts, the one in play does not');
// Tim so far: Achane 13 + Diggs 8 + Cook 14 = 35 without Young.
eq([row(D.mirror(Q, none), TIM), lives(D.mirror(Q, none))], [[35, 35, 0], [true, true, true, false]], 'Q: Tim so far, and who is live (Cal for the bench back alone)');
const calsQ = D.listDecisions(Q, CAL);
eq(ids(calsQ, 'lineup-').slice(-2), ['lineup-reasonable:3:4', 'lineup-perfect:3:4'], 'Cal: both are offered');
const q4 = D.mirror(Q, pick(calsQ, 'lineup-reasonable:3:4'));
eq(lineup(q4, CAL, 4)[3], 'FLEX Breece Hall', 'the lineup it would have set starts the unfinished man');
eq([row(q4, CAL), cell(q4, CAL, 4).starters[3].known, cell(q4, CAL, 4).starters[3].value], [[57, 61, 4], false, 10],
  'highest projections: the unfinished man in is valued at his projection, the finished man out at his score');
eq(q4.pending, [{ week: 4, homeId: TIM, awayId: MITCH }, { week: 4, homeId: CAL, awayId: DEE }], 'which turns that finished game pending');
eq(recs(q4), ['3-0 / 3-0', '2-1 / 2-1', '1-2 / 1-2', '0-3 / 0-3'], 'so it is in neither record, for Cal or for Dee');
// Hindsight: in the closed league Cal's week 4 becomes 61 (Hall for Late). Here
// Hall has not finished, so hindsight cannot start him: 57, as played.
eq([cell(D.mirror(world, pick(cals, 'lineup-perfect:3:all')), CAL, 4).total, cell(D.mirror(Q, pick(calsQ, 'lineup-perfect:3:all')), CAL, 4).total],
  [61, 57], 'whole-season hindsight does not start the unfinished bench man either');
ok(pick(calsQ, 'lineup-perfect:3:4').empty && D.mirror(Q, pick(calsQ, 'lineup-perfect:3:4')).pending.length === 1, 'and week-4 hindsight is empty: the finished game stays counted');
eq(JSON.stringify([world.games, world.moves, [...world.rosters], [...world.players]]), frozen, 'none of this alters the closed world');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
