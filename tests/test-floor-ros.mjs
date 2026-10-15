// Checks js/floor.js's REST-OF-SEASON floor — Tim, 2026-10-15, asked whether a
// kicker's and a defence's waiver floor should use the 3rd-best free agent over
// the rest of the season instead of this week's wire only: "Rest of season
// (Recommended)".
//
//   node test-floor-ros.mjs
//
// Trade audit finding 7 (measured on public league 1241838, week 6): the floor
// was the 3rd-best free agent by THIS WEEK's projection, used flat for every
// week left. K came out 10.9 against 9.5–10.1 in later weeks, 87% of kicker
// slots were floored, and any kicker trade priced at about nothing. The same
// wire read carries each man's rest-of-season projection; ranked by that
// (÷ the games he has left) the 3rd-best K is 10.1.
//
// The fixture has the shape `espn.parseFreeAgent` returns (playerId, name,
// position, proTeamId, injuryStatus, projected, seasonProjected) and the sizes
// of the real week-6 read: kickers projecting 9–12 this week and 115–145 over
// the 13 weeks left (weeks 6–18, ESPN's line runs to the NFL's last week).

import {
  positionFloors, floorAt, floorSource, describeFloors, assessLineup,
} from '../js/floor.js';

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  if (Object.is(a, b)) { pass++; }
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const ok = (cond, msg, detail = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${msg}${detail ? ` — ${detail}` : ''}`); }
};
const close = (a, b, tol, msg) => {
  if (Number.isFinite(a) && Math.abs(a - b) <= tol) { pass++; }
  else { fail++; console.log(`FAIL ${msg}: got ${a}, want ${b} (tol ${tol})`); }
};

const WEEK = 6;
const GAMES = 18 - WEEK + 1;            // 13 games left with no bye ahead
// proTeamId -> bye week. Week 5 is past; 6 (this week), 9 and 13 are still ahead.
const BYES = { 1: 5, 2: 5, 3: 5, 4: 5, 5: 5, 6: 5, 7: 5, 8: 5, 9: 9, 10: 6, 11: 13 };
const fa = (playerId, name, position, proTeamId, projected, perGame, games, injuryStatus = 'ACTIVE') => ({
  playerId, name, position, proTeamId, projected, injuryStatus,
  seasonProjected: Math.round(perGame * games * 100) / 100,
  percentOwned: 10, status: 'FREEAGENT',
});

// Kickers, this week's projection vs rest-of-season per game:
//   this week:  Arch 12.0, Bell 11.5, **Cole 10.9**, Dunn 10.0, Eads 9.0
//   per game:   Eads 11.0, Arch 10.6, **Dunn 10.1**, Cole 9.8,  Bell 9.0
// Dunn's bye (week 9) is still ahead, so his 121.2 is over 12 games, not 13:
// divided by 13 he would read 9.32 and fall to fifth — the bye check is in here.
// Ford is OUT (cannot be streamed); Gale's team is on bye THIS week (projects
// 0 now) but he is a fine streamer for the weeks after, and his per-game 8.0
// is below the third anyway.
const WIRE = [
  fa(101, 'Arch', 'K', 1, 12.0, 10.6, GAMES),
  fa(102, 'Bell', 'K', 2, 11.5, 9.0, GAMES),
  fa(103, 'Cole', 'K', 3, 10.9, 9.8, GAMES),       // bye week 5: past, 13 games
  fa(104, 'Dunn', 'K', 9, 10.0, 10.1, GAMES - 1),  // bye week 9: ahead, 12 games
  fa(105, 'Eads', 'K', 4, 9.0, 11.0, GAMES),
  fa(106, 'Ford', 'K', 6, 0, 14.0, GAMES, 'OUT'),
  fa(107, 'Gale', 'K', 10, 0, 8.0, GAMES - 1),     // bye THIS week
  // Defences: this week 3rd is 7.0 (Hawks); per game 3rd is 5.5 (Ibis).
  fa(201, 'Hawks D/ST', 'DST', 5, 7.0, 4.9, GAMES),
  fa(202, 'Ibis D/ST', 'DST', 7, 8.0, 5.5, GAMES),
  fa(203, 'Jays D/ST', 'DST', 8, 7.5, 6.0, GAMES),
  fa(204, 'Kites D/ST', 'DST', 11, 5.0, 6.2, GAMES - 1),
  fa(205, 'Larks D/ST', 'DST', 1, 4.0, 4.0, GAMES),
];

// ------------------------------------------------- the floor itself
const floors = positionFloors(WIRE, { week: WEEK, byes: BYES });
const k = floorAt('K', floors);
close(k && k.value, 10.1, 1e-9, 'K floor is the 3rd-best by rest-of-season per game (10.1), not this week\'s 3rd (10.9)');
eq(k && k.name, 'Dunn', 'and names the man it came from');
eq(k && k.basis, 'ros', 'and says its basis is the rest of the season');
eq(k && k.games, 12, 'Dunn has 12 games left: his week-9 bye is still ahead');
const d = floorAt('DST', floors);
close(d && d.value, 5.5, 1e-9, 'D/ST floor is the 3rd-best by rest-of-season per game (5.5), not this week\'s 3rd (7.0)');
eq(d && d.name, 'Ibis D/ST', 'and names the defence it came from');
eq(k && k.rank, 3, 'still the THIRD best (Tim 2026-09-19)');
eq(k && k.pool, 6, 'OUT man left out; the man on bye this week counted (6 kickers)');

// Without the byes the divisor cannot know Dunn's bye: 121.2 / 13 = 9.32,
// so Cole (9.8) becomes the third. Shows the bye really is in the divisor.
const noByes = positionFloors(WIRE, { week: WEEK });
close(floorAt('K', noByes).value, 9.8, 1e-9, 'with no byes known every man divides by the full 13 games');

// A later read divides by fewer games: the same totals read in week 10 (9
// left, Dunn's bye now past) rank Eads 15.9, Arch 15.3, Cole 14.2 — Cole's
// 127.4 / 9.
const later = positionFloors(WIRE, { week: 10, byes: BYES });
close(floorAt('K', later).value, 127.4 / 9, 1e-9,
  'read in week 10, the divisor is the 9 games left');

// `fromWeek` overrides `week` for the divisor (the wire can be read for one
// week while ESPN's line runs from the first week not yet played).
const shifted = positionFloors(WIRE, { week: 4, fromWeek: WEEK, byes: BYES });
close(floorAt('K', shifted).value, 10.1, 1e-9, 'fromWeek sets where the rest of the season starts');
eq(floorAt('K', shifted).week, 4, 'while `week` still records the read');

// ------------------------------------------------- the fallback
// A wire with no rest-of-season line at all (demo, stubs, an old archived
// read) keeps exactly the old rule: this week's projection, 3rd best.
const bare = WIRE.map(({ seasonProjected, ...p }) => p);
const old = positionFloors(bare, { week: WEEK, byes: BYES });
close(floorAt('K', old).value, 10.9, 1e-9, 'no rest-of-season line: this week\'s 3rd-best K, as before');
eq(floorAt('K', old).basis, 'week', 'and says so');
eq(floorAt('K', old).pool, 5, 'and still leaves out the man on bye this week (0) and the OUT man');
// A null or zero line is "no line", not a 0 average.
const someNull = WIRE.map((p) => (p.name === 'Eads' ? { ...p, seasonProjected: null } : p));
close(floorAt('K', positionFloors(someNull, { week: WEEK, byes: BYES })).value, 9.8, 1e-9,
  'a man with no line is left out of the rest-of-season ranking, not counted as 0');

// ------------------------------------------------- what it does to a lineup
// A kicker projecting 10.5 this week was lifted to 10.9 under the old floor;
// under the rest-of-season floor (10.1) he keeps his own 10.5.
const a = assessLineup([{ slotId: 17, position: 'K', projected: 10.5 }], [17], floors);
eq(a.cells[0].assumed, false, 'a 10.5 kicker is no longer floored');
close(a.total, 10.5, 1e-9, 'and counts at his own 10.5');

// ------------------------------------------------- the words
eq(floorSource(k), 'the 3rd-best K on the waiver wire by rest-of-season average (Dunn)',
  'the source says the ranking is by rest-of-season average');
eq(floorSource(floorAt('K', old)), 'the 3rd-best K on the waiver wire (Cole)',
  'and a this-week floor reads as it always did');
const said = describeFloors(floors, { week: WEEK });
ok(said.includes('K 10.1') && said.includes('DST 5.5'), 'the note prints the new floors', said);
ok(/rest-of-season/.test(said), 'the note says the floor is by rest-of-season average', said);
ok(/games he has left/.test(said), 'and how the average is taken', said);
ok(/3rd-best free agent/.test(said), 'and still that it is the 3rd best', said);
ok(/read once and used for every week/.test(said), 'and still one read used flat', said);
ok(!/on the wire in week 6 —/.test(said), 'and no longer says it is that week\'s wire', said);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
