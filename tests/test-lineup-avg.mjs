// Checks js/lineup-avg.js: what a squad's best legal lineup is worth in a week,
// and the two averages the Stats page builds on it (Tim, 2026-10-08) —
//
//   ROSTER STRENGTH   the squad's week totals over the weeks left, averaged
//   FUTURE PROJ DIFF  own week total minus the opponent's, over the games left
//
// Every expected number below is worked on paper from the fixture, never read
// back from the module.
//
// THE FIXTURE is a real league's shape: QB, 2 RB, 3 WR, TE, FLEX, D/ST, K and
// four on the bench. A full squad's started ten add to 119 + its own offset:
//
//   QB 20(+offset)  RB 15 12  WR 14 13 11  TE 9  FLEX(RB) 10  D/ST 7  K 8
//   bench  WR 6  RB 5  QB 4  TE 3
//
//   offsets   T1 0   T2 10   T3 20   T4 30   T5 40      -> 119 129 139 149 159
//
//   week 5   1 v 2, 3 v 4
//   week 6   1 v 3, 2 v 4     T1's 15-point RB is on an NFL bye (ESPN sends 0)
//                             T2's kicker is on bye, and nobody else kicks
//   week 7   1 v 2            T3 and T4 have no game: a LEAGUE bye
//   T5 is in the league and has no game left at all.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO } from './repo.mjs';

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  if (Object.is(a, b)) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const ok = (c, msg, extra = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); } };

let mod = null;
try {
  mod = await import('../js/lineup-avg.js');
} catch (err) {
  console.log(`FAIL js/lineup-avg.js does not load: ${String(err && err.message).split('\n')[0]}`);
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}
const {
  lineupWeekTotals, futureAverages, futureDiffs, meanTenth, lineupTotal, bestFill,
  slotsFromTeamLists, assessSlot,
} = mod;
const { slotRows } = await import('../js/lineup-slots.js');

// ------------------------------------------------------------- the fixture

const SHAPE = [
  ['QB', 0, 20], ['RB', 2, 15], ['RB', 2, 12], ['WR', 4, 14], ['WR', 4, 13], ['WR', 4, 11],
  ['TE', 6, 9], ['RB', 23, 10], ['DST', 16, 7], ['K', 17, 8],
  ['WR', 20, 6], ['RB', 20, 5], ['QB', 20, 4], ['TE', 20, 3],
];
const OFFSET = { 1: 0, 2: 10, 3: 20, 4: 30, 5: 40 };
const IDS = [1, 2, 3, 4, 5];

function team(id, week) {
  const players = SHAPE.map(([position, lineupSlotId, base], i) => {
    let projected = base + (i === 0 ? OFFSET[id] : 0);
    if (week === 6 && id === 1 && i === 1) projected = 0;   // the RB on bye
    if (week === 6 && id === 2 && i === 9) projected = 0;   // the kicker on bye
    return {
      playerId: id * 100 + i, name: `T${id} P${i}`, position, lineupSlotId,
      started: lineupSlotId !== 20, projected,
    };
  });
  return { id, name: `Team ${id}`, players };
}
const WEEKS = [5, 6, 7];
const weekTeams = new Map(WEEKS.map((w) => [w, IDS.map((id) => team(id, w))]));
const GAMES = [
  { week: 5, homeId: 1, awayId: 2 }, { week: 5, homeId: 3, awayId: 4 },
  { week: 6, homeId: 1, awayId: 3 }, { week: 6, homeId: 2, awayId: 4 },
  { week: 7, homeId: 1, awayId: 2 },
  // A bye as ESPN's schedule carries one, and a week nobody asked about.
  { week: 7, homeId: 3, awayId: null },
  { week: 4, homeId: 1, awayId: 5 },
];

// --------------------------------------------------------- one squad's week

const totals = lineupWeekTotals(weekTeams, WEEKS, null);
eq(totals.size, 3, 'a total for each week asked for');
eq(totals.get(5).get(1), 119, 'week 5, Team 1: the started ten');
eq(totals.get(5).get(4), 149, 'week 5, Team 4');
// THE BYE: the 15-point RB projects 0, so the FLEX's RB (10) takes his slot and
// the bench WR (6) takes the FLEX. 119 − 15 + 6 = 110 — not 104, which is what
// leaving the zero in the lineup as set would give.
eq(totals.get(6).get(1), 110, 'a man on bye loses his place to the next man');
ok(totals.get(6).get(1) !== 104, 'the bye is not left in the lineup as a zero');
// Nobody else kicks, so with no floor read the slot is ESPN's own zero.
eq(totals.get(6).get(2), 121, 'no floor read: an empty kicker slot is ESPN’s own number');
eq(totals.get(7).get(2), 129, 'and the week after he is back');

// THE WAIVER FLOOR, as Analysis applies it: no slot below what the wire gives.
const floors = new Map([['K', { value: 6.5, position: 'K', name: 'Wire K' }]]);
const floored = lineupWeekTotals(weekTeams, WEEKS, floors);
eq(floored.get(6).get(2), 127.5, 'a kicker on bye counts at the waiver floor');
eq(floored.get(6).get(1), 110, 'a floor moves nobody who beats it');
eq(floored.get(5).get(2), 129, 'nor a week with no hole in it');

// A week nobody read is not solved, and is not a zero.
eq(lineupWeekTotals(weekTeams, [5, 9], null).has(9), false, 'a week with no rosters is absent');
eq(lineupWeekTotals(new Map(), WEEKS, null).size, 0, 'no rosters, no totals');
eq(lineupWeekTotals(null, WEEKS, null).size, 0, 'null rosters, no totals');

// The pieces Analysis calls directly give the same week.
const slots = slotsFromTeamLists([...weekTeams.values()]);
const rows = slotRows(slots);
eq(rows.length, 10, 'ten starting slots read off the lineups');
eq(lineupTotal(bestFill(team(1, 6).players, slots, rows), rows, null), 110,
  'bestFill + lineupTotal is the same week total');
eq(lineupTotal(new Map(), rows, null), null, 'nobody to start and no floor: no total, not zero');
eq(assessSlot(undefined, rows[0], floors).value, null, 'a week that has not arrived is never floored');

// A man ESPN gave no id for is not in the solve.
const ghost = team(1, 5);
ghost.players.push({ playerId: null, name: 'Ghost', position: 'QB', lineupSlotId: 20, started: false, projected: 99 });
eq(lineupTotal(bestFill(ghost.players, slots, rows), rows, null), 119, 'a player with no id never starts');

// ---------------------------------------------------------- roster strength

eq(meanTenth([119, 110, 119]), 116, 'meanTenth');
eq(meanTenth([]), null, 'meanTenth of nothing is null, not 0');
eq(meanTenth([null, 129, undefined]), 129, 'meanTenth skips what is not a number');

const strength = futureAverages(totals, WEEKS, IDS);
eq(strength.get(1).avg, 116, 'Team 1: (119 + 110 + 119) / 3');
eq(strength.get(2).avg, 126.3, 'Team 2: (129 + 121 + 129) / 3, to the tenth');
eq(strength.get(3).avg, 139, 'Team 3');
eq(strength.get(5).avg, 159, 'a team with no games left still has a strength');
eq(strength.get(1).weeks.map((x) => `${x.week}:${x.total}`).join(' '), '5:119 6:110 7:119',
  'the weeks behind the average, in order');
ok(Math.abs(strength.get(2).raw - 379 / 3) < 1e-9, 'raw is the unrounded mean');
eq(futureAverages(totals, [], IDS).size, 0, 'no weeks left: nobody is ranked');
eq(futureAverages(totals, [9], IDS).size, 0, 'a week nobody read: nobody is ranked');
eq(futureAverages(totals, [5, 9], [1]).get(1).avg, 119, 'a missing week is left out, not averaged as zero');

// --------------------------------------------------------- future proj diff

const diff = futureDiffs(GAMES, totals, WEEKS, IDS);
// T1: 119−129, 110−139, 119−129. own 116.0, opp (129+139+129)/3 = 132.3.
eq(diff.get(1).games.map((g) => `${g.week}v${g.oppId}:${g.gap}`).join(' '), '5v2:-10 6v3:-29 7v2:-10',
  'Team 1’s games: week, opponent, gap');
eq(diff.get(1).own, 116, 'Team 1 own average');
eq(diff.get(1).opp, 132.3, 'Team 1 opponents’ average');
eq(diff.get(1).avg, -16.3, 'Team 1: 116.0 − 132.3');
// T2: +10, 121−149 = −28, +10. own 126.3, opp (119+149+119)/3 = 129.0.
eq(diff.get(2).avg, -2.7, 'Team 2: 126.3 − 129.0');
// T3 has a LEAGUE BYE in week 7: two games, not three, and no zero for the third.
eq(diff.get(3).games.length, 2, 'a league bye is no game');
eq(diff.get(3).games.map((g) => g.week).join(','), '5,6', 'Team 3’s games are weeks 5 and 6');
eq(diff.get(3).own, 139, 'Team 3 own average over its two games');
eq(diff.get(3).opp, 129.5, 'Team 3 opponents: (149 + 110) / 2');
eq(diff.get(3).avg, 9.5, 'Team 3: 139.0 − 129.5');
eq(diff.get(4).avg, 19, 'Team 4: 149.0 − (139 + 121) / 2 = 149.0 − 130.0');
// NO GAMES LEFT: absent, never a row reading 0.0.
eq(diff.has(5), false, 'a team with no games left has no diff');
eq(diff.size, 4, 'four teams have a game left');
// The week-4 game is outside the weeks asked for.
ok(diff.get(1).games.every((g) => g.week !== 4), 'a game outside the weeks left is not counted');
// Every row of the preview adds up: yours − theirs = the gap.
for (const [id, d] of diff) {
  ok(d.games.every((g) => Math.abs((g.own - g.opp) - g.gap) < 1e-9), `Team ${id}: each game’s gap is its two ends subtracted`);
  ok(Math.abs(Math.round((d.own - d.opp) * 10) / 10 - d.avg) < 1e-9, `Team ${id}: the printed gap is the two printed averages subtracted`);
}
// Zero-sum, as a head-to-head gap has to be: each game is one plus and one minus.
const sumRaw = [...diff.values()].reduce((a, d) => a + d.raw * d.games.length, 0);
ok(Math.abs(sumRaw) < 1e-9, 'the gaps cancel across the league', String(sumRaw));
// With the floor, Team 2's week 6 is 127.5, so Team 4's opponents are better.
eq(futureDiffs(GAMES, floored, WEEKS, IDS).get(4).avg, 15.7, 'floored: 149.0 − (139 + 127.5) / 2 = 149.0 − 133.3');

// THE PRINTED DIFFERENCE IS THE TWO PRINTED ENDS SUBTRACTED. Averaging the
// weekly gaps here gives 10.0667 -> 10.1, a tenth away from 100.1 − 90.1.
const fine = new Map([
  [1, new Map([[1, 100.1], [2, 90.0]])],
  [2, new Map([[1, 100.1], [2, 90.0]])],
  [3, new Map([[1, 100.2], [2, 90.2]])],
]);
const fineGames = [1, 2, 3].map((week) => ({ week, homeId: 1, awayId: 2 }));
const fd = futureDiffs(fineGames, fine, [1, 2, 3], [1, 2]);
eq(fd.get(1).own, 100.1, 'own average, to the tenth');
eq(fd.get(1).opp, 90.1, 'opponents’ average, to the tenth');
eq(fd.get(1).avg, 10, 'the printed gap is 100.1 − 90.1, not the mean of the weekly gaps');
eq(fd.get(2).avg, -10, 'and the other side is its mirror');
ok(fd.get(1).raw > 10.06 && fd.get(1).raw < 10.07, 'raw keeps the unrounded mean for sorting');

// A game with one side unprojected is left out rather than counted as a blowout.
const half = new Map([[1, new Map([[1, 100], [2, null]])]]);
eq(futureDiffs([{ week: 1, homeId: 1, awayId: 2 }], half, [1], [1, 2]).size, 0, 'no projection on one side: no gap');
eq(futureDiffs([], totals, WEEKS, IDS).size, 0, 'no games: empty');
eq(futureDiffs(GAMES, totals, [], IDS).size, 0, 'no weeks: empty');

// ------------------------------------------- ONE COPY: Analysis uses this one
// Roster strength has to be Analysis's own week totals, so Analysis must take
// its week arithmetic from this module rather than keep a second spelling.
const analysis = readFileSync(path.join(REPO, 'js/analysis-page.js'), 'utf8');
const imp = /import\s*\{([^}]*)\}\s*from\s*'\.\/lineup-avg\.js'/.exec(analysis);
ok(imp, 'js/analysis-page.js imports from ./lineup-avg.js');
for (const name of ['assessSlot', 'lineupTotal', 'bestFill', 'slotsFromTeamLists']) {
  ok(imp && imp[1].split(',').map((s) => s.trim()).includes(name), `Analysis imports ${name}`);
  ok(new RegExp(`\\b${name}\\(`).test(analysis.replace(/import[^;]*;/g, '')), `Analysis calls ${name}`);
}
ok(!/^function identified\(/m.test(analysis), 'Analysis keeps no second copy of identified()');
const stats = readFileSync(path.join(REPO, 'js/stats-page.js'), 'utf8');
ok(/import\s*\{[^}]*lineupWeekTotals[^}]*\}\s*from\s*'\.\/lineup-avg\.js'/.test(stats),
  'js/stats-page.js takes its week totals from ./lineup-avg.js');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
