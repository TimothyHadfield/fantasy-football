// Checks js/depth.js: a squad's Depth on the Trade page's All teams grid
// (Tim, 2026-10-22: "the combined current value of the players on that team
// that start less than 20% of the remaining games of the season").
//
//   node test-depth.mjs
//
// THE FIXTURE is a real roster's shape: 16 men, nine started a week (QB, RB1,
// RB2, WR1, WR2, TE, FLEX, D/ST, K) and seven on the bench, the fills in the
// shape js/who-to-start.js `weeklyFills` hands out (week -> team -> slot ->
// {p, v} | null). Every expected number is worked on paper below.

import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { REPO } from './repo.mjs';

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A === B) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${A}, want ${B}`); }
};

let mod = null;
try {
  mod = await import(pathToFileURL(path.join(REPO, 'js/depth.js')).href);
} catch (err) {
  console.log(`FAIL js/depth.js does not load: ${String(err && err.message).split('\n')[0]}`);
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}
const { DEPTH_SHARE, startCounts, isDepth, teamDepth } = mod;

// ------------------------------------------------------------ the 20% line
eq(DEPTH_SHARE, 0.2, 'the line is 20%');
eq(isDepth(0, 10), true, '0 of 10 starts is depth');
eq(isDepth(1, 10), true, '1 of 10 (10%) is depth');
eq(isDepth(2, 10), false, '2 of 10 is EXACTLY 20%: not "less than", so not depth');
eq(isDepth(1, 5), false, '1 of 5 is exactly 20%: not depth');
eq(isDepth(1, 6), true, '1 of 6 (16.7%) is depth');
eq(isDepth(2, 9), false, '2 of 9 (22.2%) is not');
eq(isDepth(0, 0), false, 'no week counted: nobody is depth');

// ----------------------------------------------------------------- fixture
const SLOTS = ['QB', 'RB1', 'RB2', 'WR1', 'WR2', 'TE', 'FLEX', 'D/ST', 'K'];
const man = (id, name, position) => ({ playerId: id, name, position });
// Team 7: 16 men.
const T = {
  qb1: man(701, 'Q One', 'QB'), qb2: man(702, 'Q Two', 'QB'),
  rb1: man(703, 'R One', 'RB'), rb2: man(704, 'R Two', 'RB'), rb3: man(705, 'R Three', 'RB'), rb4: man(706, 'R Four', 'RB'),
  wr1: man(707, 'W One', 'WR'), wr2: man(708, 'W Two', 'WR'), wr3: man(709, 'W Three', 'WR'), wr4: man(710, 'W Four', 'WR'),
  te1: man(711, 'T One', 'TE'), te2: man(712, 'T Two', 'TE'),
  dst: man(713, 'Bears D/ST', 'DST'), k: man(714, 'K One', 'K'),
  ir: man(715, 'Hurt Man', 'WR'), rb5: man(716, 'R Five', 'RB'),
};
const roster = Object.values(T);
eq(roster.length, 16, 'the fixture roster is 16 men');

// Ten weeks still to come, 5..14. The base lineup starts qb1 rb1 rb2 wr1 wr2
// te1 wr3(FLEX) dst k. The exceptions, week by week:
//   wk 6   rb1 on bye -> rb3 in RB1                        (rb3 1 start)
//   wk 9   wr1 on bye -> wr4 in WR1                        (wr4 1 start)
//   wk 10  qb1 on bye -> qb2                               (qb2 1 start)
//   wk 11  te1 on bye -> te2; wr2 on bye -> rb4 in FLEX, wr3 to WR2
//                                                         (te2 1, rb4 1)
//   wk 12  rb2 on bye -> rb3 in RB2                        (rb3 2 starts)
//   wk 14  nobody can fill K (null slot)
// So over the 10 weeks: rb3 2/10 = 20% (NOT depth), qb2 wr4 te2 rb4 1/10
// (depth), ir and rb5 0/10 (depth). Everybody else starts 7+ weeks.
const WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
function lineup(w) {
  const l = { QB: T.qb1, RB1: T.rb1, RB2: T.rb2, WR1: T.wr1, WR2: T.wr2, TE: T.te1, FLEX: T.wr3, 'D/ST': T.dst, K: T.k };
  if (w === 6) l.RB1 = T.rb3;
  if (w === 9) l.WR1 = T.wr4;
  if (w === 10) l.QB = T.qb2;
  if (w === 11) { l.TE = T.te2; l.WR2 = T.wr3; l.FLEX = T.rb4; }
  if (w === 12) l.RB2 = T.rb3;
  if (w === 14) l.K = null;
  return new Map(SLOTS.map((s) => [s, l[s] ? { p: l[s], v: 10 } : null]));
}
// Team 8 is in the league too, and must not leak into team 7's counts: it
// starts team 7's bench man rb5 (a shared object) every week.
const other = () => new Map(SLOTS.map((s) => [s, s === 'RB1' ? { p: T.rb5, v: 9 } : null]));
const fills = new Map(WEEKS.map((w) => [w, new Map([[7, lineup(w)], [8, other()]])]));

const c = startCounts(fills, WEEKS, 7);
eq(c.weeks, 10, 'ten weeks counted');
eq(c.starts.get('705'), 2, 'R Three starts twice');
eq(c.starts.get('702'), 1, 'Q Two starts once');
eq(c.starts.get('701'), 9, 'Q One starts nine (his bye out)');
eq(c.starts.get('714'), 9, 'K One starts nine (week 14 nobody could)');
eq(c.starts.has('715'), false, 'Hurt Man never starts');
eq(c.starts.has('716'), false, 'team 8 starting R Five does not count for team 7');

// Values (the card's), a number per man; 716 has none (off the lines).
const VAL = { 701: 9.5, 702: 2.25, 703: 7, 704: 6, 705: 4.5, 706: 0.04, 707: 8, 708: 5, 709: 3,
  710: 1.15, 711: 4, 712: 0.75, 713: 1, 714: 0.5, 715: 6.3 };
const lookup = (id) => (id in VAL ? VAL[id] : null);

const d = teamDepth(roster, fills, WEEKS, 7, lookup);
eq(d.weeks, 10, 'Depth counts ten weeks');
eq(d.men.map((m) => m.name),
  ['Hurt Man', 'Q Two', 'W Four', 'T Two', 'R Four', 'R Five'],
  'the depth men: under 20% only, R Three (exactly 20%) left out, Value high to low, no Value last');
eq(d.men.map((m) => m.starts), [0, 1, 1, 1, 1, 0], 'each with his starts');
// Rounded to the tenth first (2.25 -> 2.3, 1.15 -> 1.2, 0.04 -> 0), then added:
// 6.3 + 2.3 + 1.2 + 0.8 + 0.0 = 10.6 (R Five has no Value: 0).
eq(d.men.map((m) => m.value), [6.3, 2.3, 1.2, 0.8, 0, null], 'each man\'s Value to the tenth');
eq(d.value, 10.6, 'Depth = the tenths added, so the card adds up to the cell');

// The line moves with the weeks counted. Drop week 14: nine weeks, R Three's
// 2/9 = 22% still not depth; drop weeks 13 and 14 → 2/8 = 25%, still not.
// Count only weeks 5–9 (five): R Three 1 of 5 = exactly 20%, not depth;
// W Four 1 of 5, also exactly 20%, not depth.
const five = teamDepth(roster, fills, [5, 6, 7, 8, 9], 7, lookup);
eq(five.weeks, 5, 'five weeks counted');
eq(five.men.map((m) => m.name).sort(),
  ['Hurt Man', 'Q Two', 'R Five', 'R Four', 'T Two'].sort(),
  '1 start in 5 (R Three, W Four) is exactly 20% and NOT depth; 0 in 5 is');
// Weeks 5–10 (six): W Four 1/6 = 16.7% → depth again; R Three 1/6 → depth.
const six = teamDepth(roster, fills, [5, 6, 7, 8, 9, 10], 7, lookup);
eq(six.men.map((m) => m.name).includes('W Four') && six.men.map((m) => m.name).includes('R Three'), true,
  '1 start in 6 (16.7%) is depth');

// A week not read yet is not counted (nor is it a week he sat).
const partial = new Map([...fills].filter(([w]) => w <= 9));
const p = teamDepth(roster, partial, WEEKS, 7, lookup);
eq(p.weeks, 5, 'only the five weeks read are counted');
eq(p.value, five.value, 'and the answer is the five-week one');

// No lines yet: the men are still found, the cell is a dash (null), never 0.
const none = teamDepth(roster, fills, WEEKS, 7, null);
eq(none.value, null, 'no Value lookup: Depth is null');
eq(none.men.length, 6, 'the same six men');

// No week read at all: null.
eq(teamDepth(roster, new Map(), WEEKS, 7, lookup), null, 'nothing read: null');
eq(teamDepth(roster, fills, WEEKS, 99, lookup), null, 'a squad with no lineup: null');

// A squad with everybody starting has Depth 0.0, not null.
const starters = roster.filter((m) => ['701', '703', '704', '707', '708', '711', '709', '713', '714'].includes(String(m.playerId)));
const allIn = new Map(WEEKS.map((w) => [w, new Map([[7, lineup(5)]])]));
eq(teamDepth(starters, allIn, WEEKS, 7, lookup), { value: 0, weeks: 10, men: [] }, 'nobody on the bench: 0');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
