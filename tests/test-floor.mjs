// Checks js/floor.js — the positional floor Tim asked for on 2026-09-18.
//
//   node test-floor.mjs
//
// The floor is a MINIMUM STANDARD for what a lineup slot is worth: no slot is
// assessed below what the waiver wire would give you at that position, because
// a manager with a kicker on bye does not field an empty slot, he streams one.
//
// Every assertion here is about a rule that changes a number Tim reads, so the
// fixture is deliberately hand-written rather than generated: the expected
// answers are arithmetic anybody can redo by eye.

import {
  positionFloors, floorAt, slotFloor, flooredValue, assessLineup, describeFloors,
  floorSource, FLOOR_POSITIONS, FLOOR_RANK,
} from '../js/floor.js';
import { optimalLineup, DEFAULT_SLOTS } from '../js/forecast.js';
import { seasonLineupValue } from '../js/trade.js';
import { projectionsFromWeekTeams } from '../js/projection.js';

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

// ---------------------------------------------------------------- the wire
//
// One read, and it is deliberately deep enough to tell the BEST free agent
// apart from the THIRD-best — which is the whole of Tim's 2026-09-19 change and
// could not be tested at all against a two-man wire.
//
// Ranked by inspection, best first, with the floor (the 3rd) in bold:
//   QB   20.9 Nash, 18.4 Orme, **16.2 Pike**, 12.0 Quill
//   RB   12.6 Tate, 10.9 Udall, **9.4 Vane**, 8.8 Wilde   (19.9 Bench is OUT)
//   WR   14.8 Voss, 12.5 Wren, **11.1 Xiu**, 7.3 Yeo
//   TE   9.0 Iqbal, 7.4 Jost, **6.2 Kerr**
//   K    9.9 Sole, 8.6 Toft, **7.8 Uziel**                (0.00 Byrne is on bye)
//   DST  8.8 Vipers, 7.7 Wolves, **6.9 Xebecs**
//
// The third-best at every position is the same number the old "best available"
// rule produced from the old fixture, on purpose: every assertion below the
// wire — what gets lifted, what does not, what a lineup totals — is unchanged
// by the new rule, so a failure there is a real regression and not a rewritten
// expectation.
const WIRE = [
  { playerId: 1, name: 'Pike', position: 'QB', projected: 16.2, injuryStatus: 'ACTIVE' },
  { playerId: 2, name: 'Quill', position: 'QB', projected: 12.0, injuryStatus: 'ACTIVE' },
  { playerId: 13, name: 'Nash', position: 'QB', projected: 20.9, injuryStatus: 'ACTIVE' },
  { playerId: 14, name: 'Orme', position: 'QB', projected: 18.4, injuryStatus: 'ACTIVE' },
  { playerId: 3, name: 'Vane', position: 'RB', projected: 9.4, injuryStatus: 'ACTIVE' },
  { playerId: 4, name: 'Wilde', position: 'RB', projected: 8.8, injuryStatus: 'ACTIVE' },
  { playerId: 15, name: 'Tate', position: 'RB', projected: 12.6, injuryStatus: 'ACTIVE' },
  { playerId: 16, name: 'Udall', position: 'RB', projected: 10.9, injuryStatus: 'ACTIVE' },
  { playerId: 5, name: 'Xiu', position: 'WR', projected: 11.1, injuryStatus: 'ACTIVE' },
  { playerId: 6, name: 'Yeo', position: 'WR', projected: 7.3, injuryStatus: 'ACTIVE' },
  { playerId: 17, name: 'Voss', position: 'WR', projected: 14.8, injuryStatus: 'ACTIVE' },
  { playerId: 18, name: 'Wren', position: 'WR', projected: 12.5, injuryStatus: 'ACTIVE' },
  { playerId: 7, name: 'Kerr', position: 'TE', projected: 6.2, injuryStatus: 'ACTIVE' },
  { playerId: 19, name: 'Iqbal', position: 'TE', projected: 9.0, injuryStatus: 'ACTIVE' },
  { playerId: 20, name: 'Jost', position: 'TE', projected: 7.4, injuryStatus: 'ACTIVE' },
  { playerId: 8, name: 'Uziel', position: 'K', projected: 7.8, injuryStatus: 'ACTIVE' },
  { playerId: 21, name: 'Sole', position: 'K', projected: 9.9, injuryStatus: 'ACTIVE' },
  { playerId: 22, name: 'Toft', position: 'K', projected: 8.6, injuryStatus: 'ACTIVE' },
  { playerId: 9, name: 'Xebecs', position: 'DST', projected: 6.9, injuryStatus: 'ACTIVE' },
  { playerId: 23, name: 'Vipers', position: 'DST', projected: 8.8, injuryStatus: 'ACTIVE' },
  { playerId: 24, name: 'Wolves', position: 'DST', projected: 7.7, injuryStatus: 'ACTIVE' },
  // Ruled out. ESPN projects an OUT man at 0 anyway (rule 2), but this one
  // carries a number as well, which is the case the status check is for. He
  // would be the BEST running back on the wire, so a floor that counted him
  // would move the RB floor two places up as well as being a man nobody can
  // field.
  { playerId: 10, name: 'Bench', position: 'RB', projected: 19.9, injuryStatus: 'OUT' },
  // On his own bye that week: 0.00, and no use replacing anybody.
  { playerId: 11, name: 'Byrne', position: 'K', projected: 0, injuryStatus: 'ACTIVE' },
  // A position this league does not start. It must not appear at all.
  { playerId: 12, name: 'Punter', position: 'P', projected: 4.0, injuryStatus: 'ACTIVE' },
];

const floors = positionFloors(WIRE, { week: 3 });

// ---- THE FLOOR IS THE THIRD-BEST AVAILABLE MAN --------------------------
//
// Tim, 2026-09-19: "there might be 5-6 users also wanting the player at the top
// of the waivers. Try moving the line down to around the 3rd best player."
eq(FLOOR_RANK, 3, 'the floor is taken from the third man on the wire');
close(floorAt('QB', floors).value, 16.2, 1e-9, 'QB floor is the THIRD-best free agent, not the best');
close(floorAt('RB', floors).value, 9.4, 1e-9, 'RB floor ignores the man who is OUT, then takes the third');
close(floorAt('WR', floors).value, 11.1, 1e-9, 'WR floor');
close(floorAt('TE', floors).value, 6.2, 1e-9, 'TE floor');
close(floorAt('K', floors).value, 7.8, 1e-9, 'K floor ignores the man on his own bye');
close(floorAt('DST', floors).value, 6.9, 1e-9, 'DST floor');
eq(floors.has('P'), false, 'a position the league never starts gets no floor');
eq(floorAt('QB', floors).name, 'Pike', 'the floor names the man it came from');
eq(floorAt('QB', floors).week, 3, 'and the week it was read in');
eq(floorAt('QB', floors).rank, 3, 'and says which place on the wire it came from');
eq(floorAt('RB', floors).pool, 4, 'the pool counts only the men who could set it');

// FALSIFIABLE IN BOTH DIRECTIONS. The same wire read at rank 1 gives the old
// answer, so this suite would notice a build that quietly went back to the best
// available — every value above would still be "right" under the old rule if
// the fixture only had three men at each position.
const tops = positionFloors(WIRE, { week: 3, rank: 1 });
close(floorAt('QB', tops).value, 20.9, 1e-9, 'at rank 1 the QB floor is the best on the wire');
close(floorAt('K', tops).value, 9.9, 1e-9, 'and the kicker floor is 2.1 higher than Tim now wants it');
ok(floorAt('QB', tops).value > floorAt('QB', floors).value &&
   floorAt('RB', tops).value > floorAt('RB', floors).value &&
   floorAt('WR', tops).value > floorAt('WR', floors).value,
  'THE THIRD-BEST REALLY IS LOWER THAN THE BEST, which is the whole of the change');

// A WIRE THINNER THAN THE RANK FALLS BACK TO THE DEEPEST MAN IT HOLDS, rather
// than inventing one or dropping the position. The module's first rule is that
// every floor is a real free agent, and "the only kicker left" is still one.
const thin = positionFloors([
  { playerId: 30, name: 'Ash', position: 'K', projected: 8.0, injuryStatus: 'ACTIVE' },
  { playerId: 31, name: 'Birch', position: 'K', projected: 6.5, injuryStatus: 'ACTIVE' },
], { week: 3 });
close(floorAt('K', thin).value, 6.5, 1e-9, 'a two-man wire floors on the second, not the third');
eq(floorAt('K', thin).rank, 2, 'and says it only got two deep');
eq(floorAt('K', thin).want, 3, 'while still reporting how deep it meant to go');
eq(floorAt('K', positionFloors([{ playerId: 32, name: 'Cedar', position: 'K', projected: 5.0 }])).rank,
  1, 'a one-man wire floors on him');

// WHERE A FLOOR CAME FROM, IN WORDS — one spelling, used by every page.
eq(floorSource(floorAt('QB', floors)), 'the 3rd-best QB on the waiver wire (Pike)',
  'the source names the place and the man');
eq(floorSource(floorAt('K', thin)), 'the 2nd-best (and last) K on the waiver wire (Birch)',
  'and says when the wire ran out before the rank did');
eq(floorSource(floorAt('QB', tops)), 'the best QB on the waiver wire (Nash)',
  'rank 1 reads as the best, not as "the 1st-best"');
eq(floorSource(null), '', 'no floor, no phrase');

// THE ABSENT CASE IS NOT ZERO. A position the wire said nothing about has no
// floor, and every reader treats that as "leave the number alone" — a zero
// would be a floor that lifts nothing and would read, in a panel note, as
// though the wire had been checked and found worthless.
eq(floorAt('QB', positionFloors([])), null, 'an empty wire yields no floors');
eq(positionFloors([]).size, 0, 'and no entries at all');
eq(floorAt('K', positionFloors(WIRE.filter((p) => p.position !== 'K'))), null,
  'a position with nobody available is absent, not zero');
eq(floorAt('RB', null), null, 'no floors at all is safe to ask');

// ---- one player, assessed ------------------------------------------------
const lift = flooredValue({ position: 'K', projected: 0 }, floors);
eq(lift.value, 7.8, 'a kicker on bye is assessed at the floor');
eq(lift.raw, 0, 'and still reports what ESPN actually said');
eq(lift.assumed, true, 'and is marked assumed');

const keep = flooredValue({ position: 'QB', projected: 22.4 }, floors);
eq(keep.value, 22.4, 'a man above his floor keeps his own number');
eq(keep.assumed, false, 'and is not marked assumed');

// TIM'S SECOND DECISION: the floor lifts anything below it, not only zeros.
const low = flooredValue({ position: 'TE', projected: 4.1 }, floors);
eq(low.value, 6.2, 'a starter projecting BELOW the floor is lifted to it');
eq(low.assumed, true, 'and marked assumed');
// Exactly level is not below. A man who ties the floor is his own man.
eq(flooredValue({ position: 'TE', projected: 6.2 }, floors).assumed, false,
  'level with the floor is not assumed');
// And with no floor known, nothing moves.
eq(flooredValue({ position: 'K', projected: 0 }, positionFloors([])).value, 0,
  'with no wire read a zero stays a zero');

// ---- a SLOT's floor is not a position's ---------------------------------
//
// FLEX (23) takes RB, WR or TE, so what it is worth at worst is the best of
// those three — the man you would actually put in it. Getting this wrong by
// using, say, the RB floor would understate every empty flex by 1.7.
eq(slotFloor(23, floors).value, 11.1, 'a FLEX floor is the best of RB/WR/TE');
eq(slotFloor(23, floors).position, 'WR', 'and says which position it came from');
eq(slotFloor(17, floors).value, 7.8, 'a kicker slot floor is the kicker floor');
eq(slotFloor(0, floors).value, 16.2, 'a QB slot floor is the QB floor');
eq(slotFloor(17, positionFloors([])), null, 'no floors, no slot floor');

// ---------------------------------------------------------------- lineups
//
// The league's real shape: 1 QB, 2 RB, 3 WR, 1 TE, 1 FLEX, 1 D/ST, 1 K.
const SLOTS = DEFAULT_SLOTS;

/** A squad with a hole at kicker and a weak tight end. */
const SQUAD = [
  { playerId: 100, name: 'A', position: 'QB', projected: 21.0 },
  { playerId: 101, name: 'B', position: 'RB', projected: 14.0 },
  { playerId: 102, name: 'C', position: 'RB', projected: 11.0 },
  { playerId: 103, name: 'D', position: 'WR', projected: 15.0 },
  { playerId: 104, name: 'E', position: 'WR', projected: 13.0 },
  { playerId: 105, name: 'F', position: 'WR', projected: 12.0 },
  { playerId: 106, name: 'G', position: 'TE', projected: 4.0 },   // below the 6.2 floor
  { playerId: 107, name: 'H', position: 'RB', projected: 10.0 },  // takes the flex
  { playerId: 108, name: 'I', position: 'DST', projected: 8.0 },
  // NO KICKER AT ALL. This is Tim's example once the backup is gone too.
];

const best = optimalLineup(SQUAD, SLOTS);
const plain = assessLineup(best.starters, SLOTS, null);
const floored = assessLineup(best.starters, SLOTS, floors);

// WITHOUT FLOORS, NOTHING CHANGES. A page with no wire read must show exactly
// what it showed before this module existed, to the same rounding.
close(plain.total, best.total, 1e-9, 'with no floors the total is unchanged');
eq(plain.assumed, 0, 'and nothing is marked assumed');
// The empty kicker slot is still a cell, which is the point: optimalLineup
// simply omits a slot it cannot fill, and a lineup that quietly has nine
// entries instead of ten is the same mistake as calling the tenth zero.
eq(plain.cells.length, SLOTS.length, 'every slot produces a cell, filled or not');
eq(plain.cells.filter((c) => c.player === null).length, 1, 'exactly one slot is empty');

// WITH FLOORS: the empty kicker is worth 7.8, the 4.0 tight end 6.2, and the
// 10.0 RB in the FLEX 11.1 — the FLEX floor, best of RB/WR/TE (AUDIT §1.8).
// Before that fix the flex man was floored at the RB floor (9.4) and so kept
// his 10.0, which left this squad's flex worth LESS than an empty flex (11.1);
// the old "118.0, two assumed" expected that bug.
// 108.0 raw + 7.8 (K) + 2.2 (TE lift) + 1.1 (FLEX lift) = 119.1
close(floored.rawTotal, best.total, 1e-9, 'the raw total is still ESPN\'s own');
close(floored.total, best.total + 7.8 + 2.2 + 1.1, 1e-9, 'the floored total lifts all three');
eq(floored.assumed, 3, 'three slots are assumed');
const flexCell = floored.cells.find((c) => c.slotId === 23);
eq(flexCell.raw, 10.0, 'the FLEX man keeps his real 10.0');
eq(flexCell.value, 11.1, 'and is assessed at the FLEX floor');

const kCell = floored.cells.find((c) => c.slotId === 17);
eq(kCell.player, null, 'the kicker slot has nobody in it');
eq(kCell.value, 7.8, 'and is assessed at the wire\'s best kicker');
eq(kCell.assumed, true, 'and says so');
const teCell = floored.cells.find((c) => c.slotId === 6);
eq(teCell.raw, 4.0, 'the tight end keeps his real number');
eq(teCell.value, 6.2, 'and is assessed at the floor');

// A SLOT THAT APPEARS TWICE HANDS OUT TWO DIFFERENT MEN. The league starts two
// running backs, and both cells reading the first would double-count him —
// a bug that would look perfectly plausible on screen.
const rbCells = floored.cells.filter((c) => c.slotId === 2);
eq(rbCells.length, 2, 'two RB slots, two cells');
ok(rbCells[0].player.playerId !== rbCells[1].player.playerId,
  'and two different running backs',
  `${rbCells[0].player?.playerId} vs ${rbCells[1].player?.playerId}`);
eq(rbCells[0].value, 14.0, 'best first');
eq(rbCells[1].value, 11.0, 'then the next');

// THE FLOOR DOES NOT CHANGE WHO STARTS. Same lineup either way — the floor is
// applied when a lineup is ASSESSED, never when it is chosen. If this ever
// fails, the site has started telling Tim to start different players because
// of a waiver-wire number, which is a different feature nobody asked for.
const ids = (r) => r.cells.map((c) => (c.player ? c.player.playerId : null)).join(',');
eq(ids(floored), ids(plain), 'the floor changes no lineup, only its assessment');

// A squad with nobody at all still totals the floors rather than zero.
const empty = assessLineup([], SLOTS, floors);
// QB 16.2 + RB 9.4 + RB 9.4 + WR 11.1 x3 + TE 6.2 + FLEX 11.1 + DST 6.9 + K 7.8
close(empty.total, 16.2 + 9.4 * 2 + 11.1 * 3 + 6.2 + 11.1 + 6.9 + 7.8, 1e-9,
  'an empty squad is worth its floors');
eq(empty.assumed, SLOTS.length, 'and every slot is assumed');
eq(assessLineup([], SLOTS, null).total, 0, 'with no floors it really is zero');

// ---- A FILLED COMBO SLOT IS FLOORED AT THE SLOT, NOT AT THE MAN (AUDIT §1.8)
//
// A FLEX holding a bye-week tight end used to be assessed at the TE floor
// (6.2), while an EMPTY flex was assessed at the slot's floor (11.1, the best
// of RB 9.4 / WR 11.1 / TE 6.2). So a squad with a useless man in its flex
// scored LOWER than the same squad with the flex left empty — and what you
// would stream into that flex is the 11.1 WR either way. Every expected number
// here is hand arithmetic off the wire table at the top of this file.
const cell1 = (starter, slotId) => assessLineup([{ ...starter, slotId }], [slotId], floors).cells[0];

const zeroTeFlex = cell1({ playerId: 200, position: 'TE', projected: 0 }, 23);
eq(zeroTeFlex.value, 11.1, 'a FLEX filled by a 0.0 tight end is worth the FLEX floor (best of RB/WR/TE), not the TE floor');
eq(zeroTeFlex.raw, 0, 'and still reports ESPN\'s 0.0');
eq(zeroTeFlex.assumed, true, 'and is marked assumed');
eq(zeroTeFlex.floor && zeroTeFlex.floor.position, 'WR', 'and says the floor came from a WR');
eq(zeroTeFlex.floor && zeroTeFlex.floor.name, 'Xiu', 'named: the 3rd-best WR');
eq(cell1({ playerId: 201, position: 'RB', projected: 0 }, 23).value, 11.1,
  'a FLEX filled by a 0.0 running back is worth the FLEX floor too');
// Between the man's position floor (RB 9.4) and the slot's (11.1): the wire's
// WR would still beat him, so the slot is worth the WR.
const midRbFlex = cell1({ playerId: 202, position: 'RB', projected: 10.0 }, 23);
eq(midRbFlex.value, 11.1, 'a 10.0 RB in the FLEX is lifted to the 11.1 FLEX floor, not left at 10.0');
eq(midRbFlex.assumed, true, 'and is marked assumed');
// A genuine scorer is his own man.
const realFlex = cell1({ playerId: 203, position: 'WR', projected: 13.0 }, 23);
eq(realFlex.value, 13.0, 'a 13.0 WR in the FLEX keeps his own number');
eq(realFlex.assumed, false, 'and is not marked assumed');
eq(cell1({ playerId: 204, position: 'WR', projected: 11.1 }, 23).assumed, false,
  'level with the FLEX floor is not assumed');

// Every other combo slot ESPN has follows the same rule.
eq(cell1({ playerId: 205, position: 'RB', projected: 0 }, 3).value, 11.1,
  'RB/WR slot (3) holding a 0.0 RB is worth the best of RB 9.4 / WR 11.1');
eq(cell1({ playerId: 206, position: 'TE', projected: 0 }, 5).value, 11.1,
  'WR/TE slot (5) holding a 0.0 TE is worth the best of WR 11.1 / TE 6.2');
eq(cell1({ playerId: 207, position: 'RB', projected: 0 }, 7).value, 16.2,
  'OP slot (7) holding a 0.0 RB is worth the best of QB 16.2 / RB / WR / TE');
// Single-position slots are untouched: a slot's floor there IS the position's.
eq(cell1({ playerId: 208, position: 'TE', projected: 0 }, 6).value, 6.2,
  'a TE slot holding a 0.0 TE is still worth the TE floor 6.2');
eq(cell1({ playerId: 209, position: 'RB', projected: 0 }, 2).value, 9.4,
  'an RB slot holding a 0.0 RB is still worth the RB floor 9.4');
// flooredValue itself: with no slot it is the position floor, as before.
eq(flooredValue({ position: 'TE', projected: 0 }, floors).value, 6.2,
  'flooredValue without a slot is still the position floor');
eq(flooredValue({ position: 'TE', projected: 0 }, floors, 23).value, 11.1,
  'flooredValue in the FLEX is the FLEX floor');
eq(flooredValue({ position: 'TE', projected: 0 }, positionFloors([]), 23).value, 0,
  'and with no wire read a zero in the FLEX stays a zero');

// THE WHOLE-SQUAD VERSION, through optimalLineup, with the league's real slots.
// Every starter is above his floor except the flex, which the only man left —
// a backup TE on his bye — fills at 0.0.
//   raw: QB 21 + RB 14 + RB 11 + WR 15 + 13 + 12 + TE 8 + FLEX 0 + DST 8 + K 9 = 111.0
const FLEXBASE = [
  { playerId: 300, name: 'Q', position: 'QB', projected: 21.0 },
  { playerId: 301, name: 'R1', position: 'RB', projected: 14.0 },
  { playerId: 302, name: 'R2', position: 'RB', projected: 11.0 },
  { playerId: 303, name: 'W1', position: 'WR', projected: 15.0 },
  { playerId: 304, name: 'W2', position: 'WR', projected: 13.0 },
  { playerId: 305, name: 'W3', position: 'WR', projected: 12.0 },
  { playerId: 306, name: 'T1', position: 'TE', projected: 8.0 },
  { playerId: 307, name: 'D', position: 'DST', projected: 8.0 },
  { playerId: 308, name: 'K', position: 'K', projected: 9.0 },
];
const BYE_TE = { playerId: 309, name: 'T2', position: 'TE', projected: 0 };
const withByeTe = optimalLineup(FLEXBASE.concat([BYE_TE]), SLOTS);
const emptyFlex = optimalLineup(FLEXBASE, SLOTS);
eq(withByeTe.starters.find((s) => s.slotId === 23)?.playerId, 309, 'fixture: the bye TE is the one in the FLEX');
eq(emptyFlex.starters.some((s) => s.slotId === 23), false, 'fixture: without him the FLEX is empty');
const aByeTe = assessLineup(withByeTe.starters, SLOTS, floors);
const aEmpty = assessLineup(emptyFlex.starters, SLOTS, floors);
close(aByeTe.rawTotal, 111.0, 1e-9, 'raw total with the bye TE in the FLEX');
close(aByeTe.total, 122.1, 1e-9, 'the bye-TE FLEX is assessed at 11.1: 111.0 + 11.1 = 122.1 (not 117.2)');
close(aEmpty.total, 122.1, 1e-9, 'an EMPTY FLEX on the same squad: 111.0 + 11.1 = 122.1');
ok(aByeTe.total >= aEmpty.total, 'A FILLED FLEX NEVER SCORES BELOW AN EMPTY ONE',
  `${aByeTe.total} vs ${aEmpty.total}`);
eq(aByeTe.assumed, 1, 'one slot assumed: the FLEX');
eq(ids(aByeTe), ids(assessLineup(withByeTe.starters, SLOTS, null)),
  'the slot floor changes no lineup either');
// Same squad with a real scorer instead: a 13.5 WR pushes the 12.0 WR into the
// FLEX, above the 11.1 floor, so nothing moves. 111.0 + 13.5 = 124.5.
const withScorer = assessLineup(optimalLineup(FLEXBASE.concat([
  { playerId: 310, name: 'W4', position: 'WR', projected: 13.5 }]), SLOTS).starters, SLOTS, floors);
close(withScorer.total, 124.5, 1e-9, 'a FLEX filled by a genuine 12.0 scorer is unchanged: 124.5');
eq(withScorer.assumed, 0, 'and nothing is assumed');

// ---- the sentence a panel prints ----------------------------------------
const said = describeFloors(floors, { week: 3 });
ok(said.includes('K 7.8'), 'the note prints the kicker floor');
ok(said.includes('QB 16.2'), 'and the quarterback floor');
ok(said.includes('week 3'), 'and the week it was read in');
ok(/read once and used for every week/.test(said),
  'and says it is one read used flat, which is the approximation Tim chose');
ok(/3rd-best free agent/.test(said),
  'and that the floor is the third man on the wire, not the first');
ok(/every manager in the league is bidding for/.test(said),
  'and says WHY, which is the half a reader cannot work out from the number');
// The sentence describes the floors beside it, not this build's constant: an
// archived reading or a stub may carry floors taken at a different depth.
ok(/\bbest free agent\b/.test(describeFloors(tops, { week: 3 })) &&
   !/3rd-best/.test(describeFloors(tops, { week: 3 })),
  'floors built at rank 1 are described as the best, not as the third');
eq(describeFloors(positionFloors([])), '', 'no floors, no sentence');

// Every position the note can mention is one this module will actually floor.
for (const p of FLOOR_POSITIONS) {
  ok(typeof p === 'string' && p.length <= 3, `FLOOR_POSITIONS entry ${p} looks like a position`);
}

// ================================================================ the seam
//
// THE FLOOR ACTUALLY REACHES THE PRICING. Everything above tests js/floor.js
// against itself; these two test that the modules Tim named — "especially
// trade" — are wired to it. A pure module nobody passes floors to is a pure
// module that changes nothing, and every existing suite would still be green.

// ---- js/trade.js: a squad with a bye-week hole is priced with it filled --
const tradeWeeks = [5, 6];
/** Our man's projection in a given week — the kicker is on bye in week 6. */
const projFor = (p, week) => {
  if (p.position === 'K' && week === 6) return 0;
  return p.projected;
};
const ROSTER = SQUAD.concat([
  { playerId: 109, name: 'K1', position: 'K', projected: 9.0 },
]);

const noFloor = seasonLineupValue(ROSTER, SLOTS, tradeWeeks, projFor, null);
const withFloor = seasonLineupValue(ROSTER, SLOTS, tradeWeeks, projFor, floors);

// Week 5: everyone plays. The lifts are the 4.0 tight end -> 6.2 (+2.2) and
// the 10.0 RB in the FLEX -> the 11.1 FLEX floor (+1.1; AUDIT §1.8 — this was
// 2.2 while the flex man was floored at his own RB floor).
close(withFloor.byWeek[0].total - noFloor.byWeek[0].total, 2.2 + 1.1, 1e-9,
  'week 5 is lifted by the weak tight end and the below-floor flex');
// Week 6: the kicker is on bye at 0.00 and is assessed at the wire's 7.8,
// on top of the same two lifts.
close(withFloor.byWeek[1].total - noFloor.byWeek[1].total, 2.2 + 1.1 + 7.8, 1e-9,
  'THE BYE-WEEK KICKER IS PRICED AT THE WIRE, NOT AT ZERO');
ok(withFloor.total > noFloor.total, 'and the rest-of-season total moves with it',
  `${withFloor.total} vs ${noFloor.total}`);
// The per-week breakdown carries the assessment, so the pop-up can mark it.
eq(withFloor.byWeek[1].assumed, 3, 'the week reports how many slots were assumed');
eq(noFloor.byWeek[1].assumed, 0, 'and none are without floors');
close(withFloor.byWeek[1].raw, noFloor.byWeek[1].total, 1e-9,
  'while the raw total is still exactly what ESPN said');

// ---- js/projection.js: the same rule, on the per-week team points --------
const weekTeams = new Map([[6, [{ id: 1, players: ROSTER.map((p) => ({
  position: p.position, projected: projFor(p, 6),
})) }]]]);
const projPlain = projectionsFromWeekTeams(weekTeams, null);
const projFloor = projectionsFromWeekTeams(weekTeams, floors);
// K 7.8 + TE 2.2 + FLEX 1.1 (AUDIT §1.8; was 2.2 + 7.8 before the fix).
close(projFloor.proj.get(6).get(1) - projPlain.proj.get(6).get(1), 2.2 + 1.1 + 7.8, 1e-9,
  'a team\'s weekly projection is floored the same way');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
