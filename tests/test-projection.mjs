// Checks js/projection.js: slot counting, per-week projections, and the
// opponent-strength averages that need no games to have been played.
import {
  slotCountsFromLineups, projectionsFromWeekTeams, opponentProjections,
  leagueAverageOpponent,
} from '../js/projection.js';

let pass = 0, fail = 0;
const close = (a, b, tol, msg) => {
  if (Math.abs(a - b) <= tol) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${a}, want ${b}`); }
};
const eq = (a, b, msg) => {
  if (Object.is(a, b)) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const ok = (c, msg, extra = '') => { if (c) pass++; else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); } };

// ---------------- slot counting ----------------
// Real league shape: 1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX, 1 DST, 1 K + bench.
const SHAPE = [
  ['QB', 0], ['RB', 2], ['RB', 2], ['WR', 4], ['WR', 4], ['WR', 4],
  ['TE', 6], ['RB', 23], ['DST', 16], ['K', 17],
  ['WR', 20], ['RB', 20], ['QB', 20], ['TE', 20],
];
const mkTeam = (id, projFor) => ({
  id,
  players: SHAPE.map(([position, lineupSlotId], i) => ({
    position, lineupSlotId,
    started: lineupSlotId !== 20 && lineupSlotId !== 21,
    projected: projFor(position, i),
  })),
});

const teams = [1, 2].map((id) => mkTeam(id, () => 10));
const counts = slotCountsFromLineups(teams);
eq(counts[4], 3, 'three WR slots counted');
eq(counts[2], 2, 'two RB slots counted');
eq(counts[23], 1, 'one flex counted');
eq(counts[20], undefined, 'bench is not a starting slot');
eq(slotCountsFromLineups([]), null, 'no teams => null');
eq(slotCountsFromLineups([{ id: 1, players: [] }]), null, 'no lineups => null');

// A manager sitting one slot empty must not shrink the league's shape.
const short = { id: 3, players: SHAPE.slice(0, 6).map(([position, lineupSlotId]) => ({
  position, lineupSlotId, started: true, projected: 10 })) };
eq(slotCountsFromLineups([teams[0], short])[4], 3, 'max across teams covers an empty slot');

// A slot with no eligibility rule is skipped, not guessed at.
const weird = { id: 4, players: [{ position: 'QB', lineupSlotId: 19, started: true, projected: 9 }] };
eq(slotCountsFromLineups([weird]), null, 'unknown slot ignored');

// ---------------- per-week projections ----------------
// Team 1 scores 10 a man, team 2 scores 20 a man; ten starters each.
const weekTeams = new Map([
  [1, [mkTeam(1, () => 10), mkTeam(2, () => 20)]],
  [2, [mkTeam(1, () => 12), mkTeam(2, () => 18)]],
]);
const built = projectionsFromWeekTeams(weekTeams);
ok(built !== null, 'projections build');
eq(built.slots.length, 10, 'ten starters');
eq(built.countsKnown, true, 'slots came from the lineups');
eq(built.weeks.join(','), '1,2', 'weeks reported in order');
close(built.proj.get(1).get(1), 100, 1e-9, 'week 1 team 1 = 10 starters x 10');
close(built.proj.get(1).get(2), 200, 1e-9, 'week 1 team 2 = 10 starters x 20');
close(built.proj.get(2).get(1), 120, 1e-9, 'week 2 team 1');

// A player on bye (0.00 from ESPN) loses his slot to a better bench player.
const byeTeam = {
  id: 9,
  players: [
    { position: 'QB', lineupSlotId: 0, started: true, projected: 0 },   // on bye
    { position: 'QB', lineupSlotId: 20, started: false, projected: 14 }, // bench
  ],
};
const byeBuilt = projectionsFromWeekTeams(new Map([[1, [byeTeam]]]));
close(byeBuilt.proj.get(1).get(9), 14, 1e-9, 'bye player replaced by the bench');

eq(projectionsFromWeekTeams(new Map()), null, 'no rosters => null');
eq(projectionsFromWeekTeams(null), null, 'null => null');

// ---------------- opponent projections ----------------
// Three teams. Projections are constant per team so the averages are exact.
const proj = new Map([
  [1, new Map([[1, 100], [2, 120], [3, 140]])],
  [2, new Map([[1, 100], [2, 120], [3, 140]])],
  [3, new Map([[1, 100], [2, 120], [3, 140]])],
]);
const games = [
  { week: 1, homeId: 1, awayId: 2 },
  { week: 2, homeId: 1, awayId: 3 },
  { week: 3, homeId: 2, awayId: 3 },
];
const opp = opponentProjections(games, proj, [1, 2, 3]);

// Team 1 plays 2 (120) then 3 (140) => 130
close(opp.get(1).avgOpp, 130, 1e-9, 'team 1 average opponent');
close(opp.get(1).own, 100, 1e-9, 'team 1 own average');
close(opp.get(1).diff, 30, 1e-9, 'team 1 difference');
eq(opp.get(1).games, 2, 'team 1 game count');
// Team 2 plays 1 (100) then 3 (140) => 120
close(opp.get(2).avgOpp, 120, 1e-9, 'team 2 average opponent');
close(opp.get(2).diff, 0, 1e-9, 'team 2 has an exactly average schedule');
// Team 3 plays 1 (100) then 2 (120) => 110
close(opp.get(3).avgOpp, 110, 1e-9, 'team 3 average opponent');
close(opp.get(3).diff, -30, 1e-9, 'the strongest team has the easiest schedule');

// This is the whole point of the stat: with NO games played, it still ranks.
const ranked = [...opp.entries()].sort((a, b) => b[1].avgOpp - a[1].avgOpp).map(([id]) => id);
eq(ranked.join(','), '1,2,3', 'hardest schedule first, with zero games played');

// Per-week detail is kept and ordered.
eq(opp.get(1).weeks.map((w) => w.week).join(','), '1,2', 'weeks recorded in order');
close(opp.get(1).weeks[0].opp, 120, 1e-9, 'week detail carries the opponent projection');

// League average of the opponent averages.
close(leagueAverageOpponent(opp), 120, 1e-9, 'league average opponent');
eq(leagueAverageOpponent(new Map()), null, 'no teams => null');

// An unbalanced fixture list: playing the strong team twice must show up.
const lop = opponentProjections([
  { week: 1, homeId: 1, awayId: 3 },
  { week: 2, homeId: 1, awayId: 3 },
  { week: 3, homeId: 2, awayId: 1 },
], proj, [1, 2, 3]);
close(lop.get(1).avgOpp, (140 + 140 + 120) / 3, 1e-9, 'repeat fixtures count each time');

// Byes and missing weeks are skipped, not counted as zero.
const holes = opponentProjections([
  { week: 1, homeId: 1, awayId: 2 },
  { week: 9, homeId: 1, awayId: 2 },        // week 9 has no projection
  { week: 2, homeId: 1, awayId: null },     // a bye
], proj, [1, 2]);
eq(holes.get(1).games, 1, 'only the week we can project is counted');
close(holes.get(1).avgOpp, 120, 1e-9, 'and the average is not dragged toward zero');

// teamIds filters
const only1 = opponentProjections(games, proj, [1]);
eq(only1.size, 1, 'teamIds restricts the result');
eq(opponentProjections(games, proj).size, 3, 'omitting teamIds returns everyone');
eq(opponentProjections([], proj, [1]).size, 0, 'no games => empty');
eq(opponentProjections(games, new Map(), [1]).size, 0, 'no projections => empty');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
