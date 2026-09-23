// The WEEKLY trade measure: a roster valued week by week rather than on one
// season average, the combo packer, and the traps in both.
//
//   node test-trade-weekly.mjs
//
// Same two-fixture shape as `test-trade.mjs`, and for the same reasons.
//
// Fixture 1 is hand-built and every number in it was worked out on paper before
// a line of the engine was run — three quarterbacks projected 18/15/15 on a
// rotation, a bye that is a 0.00 and not a null, a roster of four that a 1-for-2
// pushes over the limit. If the engine disagrees with one of these, the engine
// is wrong; there is no arithmetic here for it to agree with itself about.
//
// Fixture 2 is the real `demo-rosters.js` pool across nine weeks, where nobody
// can check 160 players by eye, so the assertions are INVARIANTS re-derived from
// the raw weekly rosters: the season total really is the sum of nine lineup
// fills, a combo's players really are disjoint, a combo's gain really is what
// re-pricing the combined roster from scratch gives — and specifically NOT the
// sum of the offers' own gains, which is the trap this file exists for.

import { generateDemoWeekRosters } from '../js/demo-rosters.js';
import { slotCountsFromLineups } from '../js/projection.js';
import { optimalLineup } from '../js/forecast.js';
import {
  typicalWeek, lineupValue, slotsForLeague,
  seasonLineupValue, priceTradeAcrossWeeks, bestCombo, findTrades, mergeComboByPartner,
} from '../js/trade.js';
// The positional floor, for the section at the foot of this file: the combo
// packer has to be priced on the SAME basis as the rows above it, and for a day
// it was not. See "THE FLOOR HAS TO REACH THE COMBO".
import { positionFloors } from '../js/floor.js';
// How busy the machine is, for the one assertion here that is about TIME. See
// "A TIME BUDGET ON A MACHINE THAT IS NEVER IDLE" further down.
import { machineSpeed, scaledBudget, REFERENCE_MS } from './settle.mjs';

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 220)}` : ''}`);
};
const eq = (a, b, msg) =>
  ok(msg, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const close = (a, b, tol, msg) =>
  ok(msg, Number.isFinite(a) && Math.abs(a - b) <= tol, `got ${a}, want ${b}`);

// ===========================================================================
// Fixture 1 — hand arithmetic
// ===========================================================================

// One QB slot, and where a second slot is wanted, one RB beside it. Nothing can
// hide in a flex, so every total below is a one- or two-term sum.
const QB_ONLY = [0];
const QB_RB = [0, 2];
const WEEKS3 = [1, 2, 3];

let nextId = 5000;

/** playerId:week -> that week's projection. The fixture's whole truth. */
const WEEKLY = new Map();
const key = (playerId, week) => `${playerId}:${week}`;

/**
 * A player whose weekly projections are given outright.
 *
 * `seasonProjected` is set so `typicalWeek` returns the MEAN of those weeks —
 * which is the point of the whole fixture: the two measures are looking at the
 * same man and the season average is throwing away the thing that matters.
 */
function man(name, position, weekly, weeks = WEEKS3) {
  const playerId = nextId++;
  const known = weekly.filter((v) => Number.isFinite(v));
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  weeks.forEach((w, i) => WEEKLY.set(key(playerId, w), weekly[i]));
  return {
    playerId,
    name,
    position,
    lineupSlotId: 20,
    seasonProjected: mean * 17,
    projected: weekly[0],
  };
}

/** The `projFor` the page will pass in: one player, one week, one number. */
const projFor = (p, week) => {
  const v = WEEKLY.get(key(p.playerId, week));
  return Number.isFinite(v) ? v : null;
};

// ---------------------------------------------------------------------------
// The owner's case: three wide-range quarterbacks against one steady one
// ---------------------------------------------------------------------------
//
//   WIDE    a: 18 15 15      b: 15 18 15      c: 15 15 18
//           every one of them averages (18+15+15)/3 = 16.0
//   STEADY  s: 17 17 17      averages 17.0
//
// On the season average STEADY's quarterback is a point a week better, so the
// old measure prices WIDE at 16 x 3 = 48 and STEADY at 17 x 3 = 51.
//
// Week by week, WIDE starts whichever of the three is at the top of his range —
// 18, then 18, then 18 — for 54. STEADY has no one else and scores 51.
//
// The two measures disagree about which squad is better. That is the owner's
// complaint, reproduced in four players.

const wideA = man('Wide-a', 'QB', [18, 15, 15]);
const wideB = man('Wide-b', 'QB', [15, 18, 15]);
const wideC = man('Wide-c', 'QB', [15, 15, 18]);
const steady = man('Steady', 'QB', [17, 17, 17]);

const WIDE = [wideA, wideB, wideC];
const STEADY = [steady];

close(typicalWeek(wideA), 16, 1e-9, 'each wide-range QB averages exactly 16 a week');
close(typicalWeek(steady), 17, 1e-9, 'the steady QB averages 17 — a point better');

close(lineupValue(WIDE, QB_ONLY, typicalWeek).total * 3, 48, 1e-9,
  'the season average prices the three-deep squad at 48 over three weeks');
close(lineupValue(STEADY, QB_ONLY, typicalWeek).total * 3, 51, 1e-9,
  'and the one-deep squad at 51, which is the wrong answer');

const wideSeason = seasonLineupValue(WIDE, QB_ONLY, WEEKS3, projFor);
const steadySeason = seasonLineupValue(STEADY, QB_ONLY, WEEKS3, projFor);

close(wideSeason.total, 54, 1e-9, 'week by week the three-deep squad is worth 54 — 18 + 18 + 18');
close(steadySeason.total, 51, 1e-9, 'and the one-deep squad is still 51');
ok('depth beats the average it is hidden behind', wideSeason.total > steadySeason.total,
  `${wideSeason.total} vs ${steadySeason.total}`);

// The hand-summed answer, week by week, not just in total.
eq(wideSeason.byWeek.length, 3, 'a row per remaining week');
eq(wideSeason.byWeek.map((r) => r.week).join(','), '1,2,3', 'the rows are the weeks asked for');
close(wideSeason.byWeek[0].total, 18, 1e-9, 'week 1 fields the 18');
close(wideSeason.byWeek[1].total, 18, 1e-9, 'week 2 fields a DIFFERENT 18');
close(wideSeason.byWeek[2].total, 18, 1e-9, 'week 3 a third one again');
eq(wideSeason.byWeek[0].starters[0].name, 'Wide-a', 'week 1 starts a');
eq(wideSeason.byWeek[1].starters[0].name, 'Wide-b', 'week 2 re-picks and starts b');
eq(wideSeason.byWeek[2].starters[0].name, 'Wide-c', 'week 3 starts c');

// The total is the sum of the rows and nothing else.
close(
  wideSeason.byWeek.reduce((a, r) => a + r.total, 0), wideSeason.total, 1e-9,
  'the season total is exactly the sum of its weeks'
);

// And the consequence the owner drew: a better quarterback barely helps.
//
//   Send Wide-c (18/15/15 shuffled) and get a 19-every-week man. The squad now
//   fields 19, 19, 19 = 57 where it fielded 54. THREE points across three weeks.
//   The season average says the same deal is 19 - 16 = +3 A WEEK, so +9. Three
//   times the truth, which is the size of the error he spotted.
const bigArm = man('Big-arm', 'QB', [19, 19, 19]);
const upgrade = priceTradeAcrossWeeks({
  players: WIDE, send: [wideC], receive: [bigArm], slots: QB_ONLY, weeks: WEEKS3, projFor,
});
close(upgrade.before.total, 54, 1e-9, 'before the upgrade: 54');
close(upgrade.after.total, 57, 1e-9, 'after it: 57');
close(upgrade.delta, 3, 1e-9, 'so the 19-point QB is worth THREE over three weeks');

{
  const scalarBefore = lineupValue(WIDE, QB_ONLY, typicalWeek).total;
  const scalarAfter = lineupValue(
    WIDE.filter((p) => p !== wideC).concat(bigArm), QB_ONLY, typicalWeek
  ).total;
  close((scalarAfter - scalarBefore) * 3, 9, 1e-9,
    'the season average would have called the same deal +9');
  ok('the average overstates the upgrade threefold', (scalarAfter - scalarBefore) * 3 > upgrade.delta * 2,
    `${(scalarAfter - scalarBefore) * 3} vs ${upgrade.delta}`);
}

// ---------------------------------------------------------------------------
// A bye is a 0.00, and the week re-picks around it
// ---------------------------------------------------------------------------
//
// Rule 2 in HANDOFF.md: ESPN returns 0.00 for a man on bye, and that is a
// DIFFERENT fact from null (ESPN had nothing). Both have to behave correctly
// and they behave differently.

const starQb = man('Star', 'QB', [19, 0, 19]);      // week 2 is his bye
const coverQb = man('Cover', 'QB', [10, 10, 10]);
const byeSquad = seasonLineupValue([starQb, coverQb], QB_ONLY, WEEKS3, projFor);

close(byeSquad.total, 48, 1e-9, 'a bye covered by a backup is 19 + 10 + 19 = 48');
ok('not 38, which is what scoring the bye at zero would give', byeSquad.total !== 38);
ok('and not 57, which is what ignoring the bye would give', byeSquad.total !== 57);
eq(byeSquad.byWeek[1].starters[0].name, 'Cover',
  'the bye week RE-PICKS: the backup starts, the man on bye does not');
close(byeSquad.byWeek[1].total, 10, 1e-9, 'and the week is worth 10, not 0');

// The distinction itself, stated as two one-man squads.
const onlyBye = man('Only-bye', 'QB', [0, 0, 0]);
const onlyNull = man('Only-null', 'QB', [null, null, null]);
const byeAlone = seasonLineupValue([onlyBye], QB_ONLY, WEEKS3, projFor);
const nullAlone = seasonLineupValue([onlyNull], QB_ONLY, WEEKS3, projFor);
eq(byeAlone.byWeek[0].starters.length, 1,
  'a man on bye still FILLS the slot — he plays, he is projected nothing');
eq(nullAlone.byWeek[0].starters.length, 0,
  'a man ESPN has no number for does not fill it: the slot is simply unknown');
close(byeAlone.total, 0, 1e-9, 'both total nothing');
close(nullAlone.total, 0, 1e-9, 'but for two different reasons, and the starters say which');

// An empty week list is not a crash, it is a squad worth nothing yet.
eq(seasonLineupValue(WIDE, QB_ONLY, [], projFor).total, 0, 'no weeks left, nothing to field');
eq(seasonLineupValue(WIDE, QB_ONLY, WEEKS3, null).total, 0,
  'no way to read a projection is no value, not a throw');

// ---------------------------------------------------------------------------
// EVERY ZERO LEAVES THE PER-WEEK DIVISOR (Tim, 2026-09-20)
// ---------------------------------------------------------------------------
//
// This block used to assert the opposite of half of itself, and the assertions
// were right about the engine of the day: a bye left the divisor, and a
// ruled-out 0.00 stayed in it, so `zeroIsBye` decided which of the two a zero
// was and the number moved with it.
//
// Tim overruled that. `perWeek` is now the mean over the weeks that carry a
// number ABOVE ZERO, so every zero is out of the divisor however it got there —
// which means `zeroIsBye` cannot move this number at all any more. That is what
// the four calls below now pin: same man, four different answers to "is this a
// bye", one per-week figure.
//
//   Hurt: 0 10 10     20 / 2 = 10.0, whatever the zero in week 1 is called.
//
// If anyone restores the old divisor, `flagOff` and `byeIs3` go back to 6.7 and
// these fail.
{
  const hurt = man('Hurt', 'RB', [0, 10, 10]);
  const swapped = man('Swapped', 'RB', [5, 5, 5]);
  const perWeekOf = (zeroIsBye) => {
    const priced = priceTradeAcrossWeeks({
      players: [wideA, swapped], send: [swapped], receive: [hurt],
      slots: QB_RB, weeks: WEEKS3, projFor, zeroIsBye,
    });
    const joined = priced.roster.find((p) => p.playerId === hurt.playerId);
    return joined ? { perWeek: joined.perWeek, scoring: joined.weeksScoring, total: joined.projected } : null;
  };
  const flagOn = perWeekOf(true);
  const flagOff = perWeekOf(false);
  const byeIs1 = perWeekOf((p, w) => p.playerId === hurt.playerId && w === 1);
  const byeIs3 = perWeekOf((p, w) => p.playerId === hurt.playerId && w === 3);
  close(flagOn && flagOn.perWeek, 10, 1e-9, 'every zero a bye: 20 / 2 = 10.0');
  close(flagOff && flagOff.perWeek, 10, 1e-9,
    'NO zero a bye: still 20 / 2 = 10.0, where the old rule said 20 / 3 = 6.7');
  close(byeIs1 && byeIs1.perWeek, 10, 1e-9, 'a zero IN his bye week leaves the divisor: 20 / 2');
  eq(byeIs1 && byeIs1.scoring, 2, 'two scoring weeks when week 1 is his bye');
  close(byeIs3 && byeIs3.perWeek, 10, 1e-9,
    'A RULED-OUT ZERO LEAVES IT TOO: 20 / 2, where the old rule said 20 / 3');
  eq(byeIs3 && byeIs3.scoring, 2,
    'two scoring weeks whichever week is called his bye — the option cannot move the divisor');
  close(byeIs3 && byeIs3.total, 20, 1e-9,
    'and the total is 20 in every one of them: the zero is still points he will not score');
}

// ---------------------------------------------------------------------------
// TIM'S OWN CASE, MADE FALSIFIABLE (2026-09-20)
// ---------------------------------------------------------------------------
//
// His report, verbatim: "the weekly avg in the trade menu of the player doesn't
// actually reflect the real future proj averages. For example, Nico Collins
// displays 14.2, however 100% of his future weeks are proj above 14.2, except
// for his BYE week … it should only calculate future weeks that actually
// project any points at all, and then set the avg there."
//
// The fixture is that sentence in one man, over a six-week span:
//
//   w1 16   w2 0 (bye)   w3 15   w4 null (ESPN quiet)   w5 18   w6 never read
//
// Weeks 4 and 6 are the same thing to `projFor` and that is the point — a week
// this page has not fetched reads exactly like a week ESPN carried nothing for,
// so the old divisor made the printed average partly a fact about the cache.
//
//   OLD RULE   sum 49, byes out of the divisor and nulls left in: 49 / 5 = 9.8,
//              which is BELOW every single week he is projected to score in.
//   NEW RULE   49 / 3 = 16.3, which is inside 15…18 where it belongs.
//
// Both numbers are worked out by hand here and both are asserted — the new one
// as the answer, the old one as the answer the engine must NOT give.
{
  const WEEKS6 = [1, 2, 3, 4, 5, 6];
  // Only weeks 1-5 are written to the fixture's map, so week 6 is a week this
  // page has never read rather than a week with a null in it.
  const nico = man('Nico', 'WR', [16, 0, 15, null, 18], [1, 2, 3, 4, 5]);

  const entryFor = (player, zeroIsBye = true) => {
    const priced = priceTradeAcrossWeeks({
      players: [player], send: [], receive: [], slots: QB_RB, weeks: WEEKS6, projFor, zeroIsBye,
    });
    return priced.roster.find((p) => p.playerId === player.playerId) || null;
  };

  const e = entryFor(nico);
  const weeksHeScores = [16, 15, 18];
  const oldRule = 49 / 5; // byes out, nulls in — what this printed before today

  close(e && e.projected, 49, 1e-9, 'his rest-of-season total is every week added up: 49');
  eq(e && e.weeksScoring, 3, 'three of the six weeks carry a number above zero');
  close(e && e.perWeek, 16.3, 1e-9, 'so his per-week figure is 49 / 3 = 16.3');
  ok('and it sits INSIDE the range of the weeks it was made from (15…18)',
    e && e.perWeek >= Math.min(...weeksHeScores) && e.perWeek <= Math.max(...weeksHeScores),
    `${e && e.perWeek}`);
  ok('the old answer was below every one of those weeks, which is what Tim reported',
    oldRule < Math.min(...weeksHeScores), `${oldRule} vs ${Math.min(...weeksHeScores)}`);
  ok('and the engine no longer gives it', Math.abs((e && e.perWeek) - oldRule) > 1,
    `${e && e.perWeek} vs ${oldRule}`);

  // The divisor cannot be moved by what anybody calls the zero…
  close(entryFor(nico, false) && entryFor(nico, false).perWeek, 16.3, 1e-9,
    'no zero called a bye: the same 16.3');
  close(entryFor(nico, (p, w) => w === 5) && entryFor(nico, (p, w) => w === 5).perWeek, 16.3, 1e-9,
    'a week he SCORES in called his bye: still 16.3 — only the number in the week counts');

  // …nor by how much of the span has been bought yet, which is the half of the
  // bug that no fixture caught before. Price him over the three weeks that were
  // read and he comes out at the same figure.
  {
    const part = priceTradeAcrossWeeks({
      players: [nico], send: [], receive: [], slots: QB_RB, weeks: [1, 2, 3], projFor,
    }).roster.find((p) => p.playerId === nico.playerId);
    close(part && part.perWeek, 15.5, 1e-9, 'weeks 1-3 alone: (16 + 15) / 2 = 15.5');
    const half = priceTradeAcrossWeeks({
      players: [nico], send: [], receive: [], slots: QB_RB, weeks: [1, 2, 3, 4, 6], projFor,
    }).roster.find((p) => p.playerId === nico.playerId);
    // Worth the arithmetic: over weeks 1-3 the old rule and this one AGREE at
    // 15.5 (31 / 2, his bye out), because everything in that span was read.
    // Add weeks 4 and 6, which this page has no number for, and the old rule
    // divided the same 31 points by 4 and printed 7.8 for a man whose every
    // scoring week is 15 or 16. That is the bug in two lines.
    close(half && half.perWeek, 15.5, 1e-9,
      'ADDING TWO UNREAD WEEKS CHANGES NOTHING: still 15.5, where the old rule sagged to 7.8');
    ok('which is the defect itself: the printed average was partly a fact about the cache',
      Math.abs(half.perWeek - part.perWeek) < 1e-9);
  }

  // THE CONSEQUENCE THAT FLATTERS, asserted rather than left to be discovered.
  // A man ruled OUT for two of the six weeks is projected 0.00 in them, and
  // those zeros are now out of his divisor as surely as a bye is.
  {
    const crocked = man('Crocked', 'RB', [14, 0, 0, 16, null], [1, 2, 3, 4, 5]);
    const c = entryFor(crocked, false); // no week is his bye: these are OUT weeks
    close(c && c.projected, 30, 1e-9, 'the zeros are still in his season total: 30');
    eq(c && c.weeksScoring, 2, 'but only two weeks carry a number above zero');
    close(c && c.perWeek, 15, 1e-9,
      'so he prints 15.0 — what he is worth in a week he plays, not 5.0 over the whole span');
    ok('THIS IS THE FLATTERING CASE, and it is deliberate: 30 / 6 = 5.0 is the season answer',
      c.perWeek > c.projected / 6);
  }

  // Nothing to say is `null`, and never 0.0 and never a division by zero.
  {
    const ghost = man('Ghost', 'K', [0, 0, null], [1, 2, 3]);
    const g = entryFor(ghost);
    eq(g && g.weeksScoring, 0, 'a man with no scoring week has an empty divisor');
    eq(g && g.perWeek, null, 'so his per-week figure is null — not 0.0, which would read as a claim');
    const empty = priceTradeAcrossWeeks({
      players: [ghost], send: [], receive: [], slots: QB_RB, weeks: [], projFor,
    }).roster.find((p) => p.playerId === ghost.playerId);
    eq(empty && empty.perWeek, null, 'and an empty span is null too rather than a throw');
  }
}

// ---------------------------------------------------------------------------
// priceTradeAcrossWeeks: the rows and the totals are one arithmetic
// ---------------------------------------------------------------------------

{
  const mineRb = man('My-rb', 'RB', [10, 10, 10]);
  const theirRb = man('Big-rb', 'RB', [14, 14, 14]);
  const priced = priceTradeAcrossWeeks({
    players: [wideA, mineRb], send: [mineRb], receive: [theirRb],
    slots: QB_RB, weeks: WEEKS3, projFor,
  });

  // By hand: before is (18 + 10) + (15 + 10) + (15 + 10) = 78.
  close(priced.before.total, 78, 1e-9, 'before, by hand: 28 + 25 + 25 = 78');
  // After is (18 + 14) + (15 + 14) + (15 + 14) = 90.
  close(priced.after.total, 90, 1e-9, 'after, by hand: 32 + 29 + 29 = 90');
  close(priced.delta, 12, 1e-9, 'four points a week over three weeks is twelve');

  eq(priced.byWeek.length, 3, 'a row per week');
  close(priced.byWeek.reduce((a, r) => a + r.before, 0), priced.before.total, 1e-9,
    'the per-week "before" rows sum to the stated before');
  close(priced.byWeek.reduce((a, r) => a + r.after, 0), priced.after.total, 1e-9,
    'and the "after" rows to the stated after');
  close(priced.byWeek.reduce((a, r) => a + r.delta, 0), priced.delta, 1e-9,
    'and the per-week deltas to the stated delta');
  ok('every row is its own after minus its own before',
    priced.byWeek.every((r) => Math.abs(r.after - r.before - r.delta) < 1e-9));
  eq(priced.cut.length, 0, 'a one-for-one forces no cut');
  eq(priced.roster.length, 2, 'and leaves the roster the size it was');

  // Ids are accepted where players are, because a page may only hold the id.
  const byIds = priceTradeAcrossWeeks({
    players: [wideA, mineRb], send: [mineRb.playerId], receive: [theirRb],
    slots: QB_RB, weeks: WEEKS3, projFor,
  });
  close(byIds.delta, priced.delta, 1e-9, 'sending an id prices the same as sending the player');
}

// ---------------------------------------------------------------------------
// The roster-size rule, applied to the COMBINED result
// ---------------------------------------------------------------------------
//
// Four men in, five men would come out, so one has to go — and the one that
// goes is the worst over the REMAINING SEASON, decided once, not re-decided
// every week. `Scrub` totals 9 across the three weeks; nobody else is close.

{
  const scrub = man('Scrub', 'RB', [3, 3, 3]);
  const solid = man('Solid', 'RB', [11, 11, 11]);
  const spare = man('Spare', 'WR', [8, 8, 8]);
  const inA = man('In-a', 'RB', [13, 13, 13]);
  const inB = man('In-b', 'RB', [12, 12, 12]);

  const roster = [wideA, scrub, solid, spare];
  const priced = priceTradeAcrossWeeks({
    players: roster, send: [scrub], receive: [inA, inB],
    slots: QB_RB, weeks: WEEKS3, projFor,
  });

  eq(priced.roster.length, 4, 'a 1-for-2 leaves the roster the size it started');
  eq(priced.cut.length, 1, 'so exactly one man is cut');
  eq(priced.cut[0].name, 'Spare', 'and it is the worst man over the weeks that are LEFT');
  ok('the man traded away is not counted as a cut as well',
    !priced.cut.some((p) => p.name === 'Scrub'));

  // And the same rule on a combo, which moves more than one deal's worth at
  // once: two 1-for-2s are TWO men over, and cost two players, not one twice.
  const inC = man('In-c', 'RB', [12, 12, 12]);
  const inD = man('In-d', 'RB', [12, 12, 12]);
  const both = priceTradeAcrossWeeks({
    players: roster, send: [scrub], receive: [inA, inB, inC, inD],
    slots: QB_RB, weeks: WEEKS3, projFor,
  });
  eq(both.roster.length, 4, 'four in, four out, however many bodies move');
  eq(both.cut.length, 3, 'three cuts when three men over the limit arrive');
}

// ===========================================================================
// bestCombo — the non-additivity trap, in numbers known on paper
// ===========================================================================
//
// My squad: a 10-point quarterback, a 10-point back, a receiver nothing starts.
// Slots are QB + RB, so the receiver is dead weight and a free throw-in.
//
//   Offer 1 (partner P):  send my QB,  get an 18-a-week QB.  +8 a week, +24.
//   Offer 2 (partner Q):  send my WR,  get a 16-a-week QB.   +6 a week, +18.
//
// Naively the pair is worth 42. It is worth 24. BOTH incoming quarterbacks want
// the one quarterback slot, the better one takes it, and the second deal adds
// exactly nothing. Adding the offers' own gains would promise the manager
// nearly twice what he gets.

const myQb = man('Mine-qb', 'QB', [10, 10, 10]);
const myRb = man('Mine-rb', 'RB', [10, 10, 10]);
const myWr = man('Mine-wr', 'WR', [9, 9, 9]);       // no WR slot: worth nothing to me
const qb18 = man('P-qb', 'QB', [18, 18, 18]);
const qb16 = man('Q-qb', 'QB', [16, 16, 16]);

const MY_ROSTER = [myQb, myRb, myWr];
const offer1 = { partner: { id: 91, name: 'P' }, send: [myQb], receive: [qb18], myGain: 24 };
const offer2 = { partner: { id: 92, name: 'Q' }, send: [myWr], receive: [qb16], myGain: 18 };

// Each offer's own gain first, priced properly, so the trap is set with real
// numbers rather than asserted ones.
close(
  priceTradeAcrossWeeks({
    players: MY_ROSTER, send: [myQb], receive: [qb18], slots: QB_RB, weeks: WEEKS3, projFor,
  }).delta, 24, 1e-9, 'offer 1 alone really is +24');
close(
  priceTradeAcrossWeeks({
    players: MY_ROSTER, send: [myWr], receive: [qb16], slots: QB_RB, weeks: WEEKS3, projFor,
  }).delta, 18, 1e-9, 'offer 2 alone really is +18');

const combo = bestCombo([offer1, offer2], {
  players: MY_ROSTER, slots: QB_RB, weeks: WEEKS3, projFor,
});

// THE ASSERTION THIS FILE EXISTS FOR.
const pair = [combo.best, combo.most].find((e) => e && e.count === 2);
ok('the two-trade packing is found', !!pair, JSON.stringify({ best: combo.count, most: combo.most && combo.most.count }));
if (pair) {
  close(pair.naiveDelta, 42, 1e-9, 'adding the two offers’ own gains gives 42');
  close(pair.delta, 24, 1e-9, 'and the truth, priced once on the combined roster, is 24');
  ok('the naive sum and the real combined value DISAGREE', pair.naiveDelta > pair.delta + 1,
    `${pair.naiveDelta} vs ${pair.delta}`);
}

// Both answers come back, because "most trades" and "best combo" disagree here.
eq(combo.count, 1, 'the best packing by GAIN is the single deal — the second adds nothing');
close(combo.delta, 24, 1e-9, 'worth 24');
eq(combo.most.count, 2, 'the packing with the most TRADES in it is both of them');
close(combo.most.delta, 24, 1e-9, 'worth the same 24, for twice the negotiating');
eq(combo.mostIsBest, false, 'and the flag says the two answers are not the same packing');
ok('the headline is the best-gain packing', combo.combo.length === combo.best.combo.length);
eq(combo.exhaustive, true, 'two offers is an exhaustive search by any measure');

// Disjointness: two offers that want the same man can never be packed together.
{
  const clash = { partner: { id: 93, name: 'R' }, send: [myQb], receive: [qb16], myGain: 18 };
  const c = bestCombo([offer1, clash], {
    players: MY_ROSTER, slots: QB_RB, weeks: WEEKS3, projFor,
  });
  eq(c.most.count, 1, 'a player can only be traded once, so only one of them can be made');
  ok('and it is the better of the two', c.combo[0] === offer1);
}

// Same partner twice: allowed when the players are disjoint, refused when told.
{
  const a = { partner: { id: 91, name: 'P' }, send: [myQb], receive: [qb18], myGain: 24 };
  const b = { partner: { id: 91, name: 'P' }, send: [myWr], receive: [qb16], myGain: 18 };
  const open = bestCombo([a, b], { players: MY_ROSTER, slots: QB_RB, weeks: WEEKS3, projFor });
  eq(open.most.count, 2, 'two disjoint deals with the same manager are packable by default');
  eq(open.most.repeatPartners, true, 'and the packing says so, so a page can warn');
  const strict = bestCombo([a, b], {
    players: MY_ROSTER, slots: QB_RB, weeks: WEEKS3, projFor, onePerPartner: true,
  });
  eq(strict.most.count, 1, 'onePerPartner refuses to put two deals on one manager');
}

// "Make none of them" is a real answer.
{
  const bad = {
    partner: { id: 94, name: 'S' }, send: [myRb], receive: [man('Worse', 'RB', [2, 2, 2])],
    myGain: 5,
  };
  const c = bestCombo([bad], { players: MY_ROSTER, slots: QB_RB, weeks: WEEKS3, projFor });
  eq(c.count, 0, 'an offer that is worse on the weekly numbers is simply not taken');
  close(c.delta, 0, 1e-9, 'and the headline gain is zero rather than a loss dressed up');
}

// No offers at all, and a missing options bag, are answers rather than throws.
eq(bestCombo([], { players: MY_ROSTER, slots: QB_RB, weeks: WEEKS3, projFor }).count, 0,
  'nothing to pack is a packing of nothing');
eq(bestCombo(null, { players: MY_ROSTER, slots: QB_RB, weeks: WEEKS3, projFor }).count, 0,
  'and so is a null offer list');

// A partner who ends up worse off is not a partner. Two deals with one manager,
// each of which helps him alone, can still leave him down between them.
{
  const pRoster = [qb18, man('P-rb', 'RB', [4, 4, 4]), man('P-wr', 'WR', [4, 4, 4])];
  const teams = [{ id: 91, name: 'P', players: pRoster }];
  const greedy = {
    partner: { id: 91, name: 'P' }, send: [myWr], receive: [qb18], myGain: 24,
  };
  const checked = bestCombo([greedy], {
    players: MY_ROSTER, slots: QB_RB, weeks: WEEKS3, projFor, teams,
  });
  eq(checked.count, 0, 'a deal the partner would refuse is not offered when he can be priced');
  const unchecked = bestCombo([greedy], {
    players: MY_ROSTER, slots: QB_RB, weeks: WEEKS3, projFor, teams,
    requirePartnersGain: false,
  });
  eq(unchecked.count, 1, 'unless the caller says it is checking that itself');
  ok('and his side is priced and reported either way',
    unchecked.best.partners.length === 1 && unchecked.best.partners[0].delta < 0,
    JSON.stringify(unchecked.best.partners.map((p) => p.delta)));
}

// ===========================================================================
// Fixture 2 — the real demo pool, nine weeks, everything re-derived
// ===========================================================================

const SEASON_WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13];

// The weekly index a page would build: one fetch per week, every roster in it.
// A player who is not in a given week's payload has no number for that week,
// which is the same `null` ESPN's own silence produces.
const weekIndex = new Map();
for (const w of SEASON_WEEKS) {
  const byPlayer = new Map();
  for (const t of generateDemoWeekRosters(w).teams) {
    for (const p of t.players) {
      byPlayer.set(p.playerId, typeof p.projected === 'number' ? p.projected : null);
    }
  }
  weekIndex.set(w, byPlayer);
}
const demoProjFor = (p, week) => {
  const byPlayer = weekIndex.get(week);
  if (!byPlayer || !byPlayer.has(p.playerId)) return null;
  const v = byPlayer.get(p.playerId);
  return Number.isFinite(v) ? v : null;
};

const { teams: demoTeams } = generateDemoWeekRosters(5);
const demoSlots = slotsForLeague(slotCountsFromLineups(demoTeams));
eq(demoTeams.length, 10, 'ten demo squads');
eq(SEASON_WEEKS.length, 9, 'nine weeks left to price');

/**
 * The answer, re-derived from the raw rosters without the engine's help: fill
 * each week's lineup here, from the index above, and add the weeks up.
 */
function handSeasonTotal(players, slots, weeks) {
  let total = 0;
  for (const w of weeks) {
    const pool = players.map((p) => ({ ...p, projected: demoProjFor(p, w) }));
    total += optimalLineup(pool, slots).total;
  }
  return Math.round(total * 10) / 10;
}

for (const t of demoTeams) {
  const engine = seasonLineupValue(t.players, demoSlots, SEASON_WEEKS, demoProjFor);
  close(engine.total, handSeasonTotal(t.players, demoSlots, SEASON_WEEKS), 1e-9,
    `${t.name}: the season value is nine lineup fills, re-derived from the raw rosters`);
  eq(engine.byWeek.length, 9, `${t.name}: nine rows`);
  close(engine.byWeek.reduce((a, r) => a + r.total, 0), engine.total, 1e-9,
    `${t.name}: the rows add up to the total`);

  // The whole thesis, on real data: a squad is worth MORE week by week than the
  // best it can do on one season-average lineup, because every week it re-picks.
  const flat = lineupValue(t.players, demoSlots, typicalWeek).total * SEASON_WEEKS.length;
  ok(`${t.name}: valuing week by week is not the same number as the season average`,
    Math.abs(engine.total - flat) > 1,
    `${engine.total} vs ${flat}`);
}

// ---- the finder on the weekly measure -------------------------------------

// A TIME BUDGET ON A MACHINE THAT IS NEVER IDLE.
//
// The assertion under the loop below — the slowest squad's search finishes in a
// time a page can hand to a timeout — is about the real product: the Trade page
// runs this finder and a page that freezes is a defect Tim would feel. So the
// 20-second budget stays, and so does the assertion.
//
// What was unfair was the UNITS. Measured 2026-09-23: the slowest squad took
// 6.7 s with the machine as Tim leaves it and 39.4 s with every core taken, on
// identical code — so a bare millisecond figure asserts something about his OCR
// jobs rather than about `findTrades()`. It had already been seen at 29 s and
// 35 s on other afternoons.
//
// SCALED, NOT SKIPPED. Skipping while the machine is busy would mean the
// assertion never runs at all, because the only machine it runs on is busy
// permanently — which is a deleted assertion with extra steps. Instead a fixed
// arithmetic benchmark measures how much of a core this process is actually
// being given, and the 20-second promise is multiplied by it. Measured either
// side of the ten searches and the worse reading used, so a machine that got
// busy halfway through is credited for it; and the raw milliseconds are still
// printed, so a genuine slowdown is told from a busy afternoon by reading the
// two numbers rather than by guessing.
const speedBefore = machineSpeed();

const timings = [];
const searched = new Map();
for (const me of demoTeams) {
  const started = Date.now();
  const res = findTrades({
    teams: demoTeams, myTeamId: me.id, slots: demoSlots,
    weeks: SEASON_WEEKS, projFor: demoProjFor,
  });
  timings.push(Date.now() - started);
  searched.set(me.id, res);

  eq(res.basis, 'weeks', `${me.name}: the search says which measure it used`);
  ok(`${me.name}: every offer is with somebody else`,
    res.offers.every((o) => o.partner && o.partner.id !== me.id));

  for (const o of res.offers) {
    const partner = demoTeams.find((t) => t.id === o.partner.id);

    // Re-priced from the raw rosters, not read back off the offer.
    const before = handSeasonTotal(me.players, demoSlots, SEASON_WEEKS);
    close(o.myBefore, before, 0.05, `${me.name}: the stated "before" is his real season`);

    const mineAfter = handRosterAfter(me.players, o.send, o.receive);
    close(o.myAfter, handSeasonTotal(mineAfter, demoSlots, SEASON_WEEKS), 0.15,
      `${me.name}: the stated "after" re-fills nine weeks to the same total`);
    ok(`${me.name}: the offer really does raise his season`, o.myGain > 0,
      `${o.myGain}`);

    const theirsAfter = handRosterAfter(partner.players, o.receive, o.send);
    close(o.theirAfter, handSeasonTotal(theirsAfter, demoSlots, SEASON_WEEKS), 0.15,
      `${o.partner.name}: and so does his`);

    ok(`${me.name}: the trade leaves him no bigger than he started`,
      mineAfter.length <= me.players.length);
    ok(`${o.partner.name}: same for him`, theirsAfter.length <= partner.players.length);

    // The per-week strip has to agree with the season number it sits under.
    eq(o.byWeek.length, 9, `${me.name}: a strip of nine weeks`);
    close(o.byWeek.reduce((a, r) => a + r.delta, 0), o.myGain, 0.15,
      `${me.name}: the weekly strip adds up to the stated gain`);

    // In minus out IS the gain, or the two lists are decoration.
    const inSum = o.yourChurn.in.reduce((a, s) => a + s.value, 0);
    const outSum = o.yourChurn.out.reduce((a, s) => a + s.value, 0);
    close(inSum - outSum, o.myGain, 0.25,
      `${me.name}: who gains lineup time minus who loses it is the gain`);

    ok(`${me.name}: everything sent is his`,
      o.send.every((p) => me.players.some((q) => q.playerId === p.playerId)));
    ok(`${o.partner.name}: everything received is his`,
      o.receive.every((p) => partner.players.some((q) => q.playerId === p.playerId)));
  }
}

/** The same forced cut the engine models, written out independently. */
function handRosterAfter(players, outgoing, incoming) {
  const gone = new Set(outgoing.map((p) => p.playerId));
  const kept = players.filter((p) => !gone.has(p.playerId));
  const joined = incoming.map((p) => ({ ...p }));
  const all = kept.concat(joined);
  const over = all.length - players.length;
  if (over <= 0) return all;
  const seasonOf = (p) =>
    SEASON_WEEKS.reduce((a, w) => {
      const v = demoProjFor(p, w);
      return a + (Number.isFinite(v) ? v : 0);
    }, 0);
  const ranked = [...all].sort((a, b) => seasonOf(a) - seasonOf(b));
  const cut = new Set(ranked.slice(0, over));
  return all.filter((p) => !cut.has(p));
}

{
  const found = [...searched.values()].reduce((a, r) => a + r.offers.length, 0);
  ok('the weekly finder finds real offers in the demo league', found > 0, `${found} offers`);
  const slowest = Math.max(...timings);

  const speedAfter = machineSpeed();
  const machine = speedBefore.factor >= speedAfter.factor ? speedBefore : speedAfter;
  const budget = scaledBudget(20000, machine.factor);
  ok('and does it in a time a page can hand off to a timeout', slowest < budget,
    `${slowest}ms for the slowest squad, against a ${budget}ms budget ` +
    `(20,000ms on an idle machine × ${machine.factor.toFixed(2)}; the benchmark took ` +
    `${machine.ms}ms against ${REFERENCE_MS}ms idle)`);
  console.log(
    `weekly finder: ${Math.round(timings.reduce((a, b) => a + b, 0))}ms for ten squads ` +
    `over ${SEASON_WEEKS.length} weeks (slowest squad ${slowest}ms of a ${budget}ms budget), ` +
    `${found} offers`
  );
  console.log(
    `machine: benchmark ${machine.ms}ms vs ${REFERENCE_MS}ms idle — ` +
    `${machine.factor.toFixed(2)}× slower than idle` +
    (machine.loaded ? ' (LOADED: something else is holding the cores)' : '')
  );
}

// ---- and the combo on real offers -----------------------------------------

let combosChecked = 0;
let disagreements = 0;
for (const me of demoTeams) {
  const res = searched.get(me.id);
  if (res.offers.length < 2) continue;

  const packed = bestCombo(res.offers, {
    players: me.players, slots: demoSlots, weeks: SEASON_WEEKS, projFor: demoProjFor,
    teams: demoTeams,
  });
  combosChecked++;

  for (const entry of [packed.best, packed.most]) {
    if (!entry) continue;

    // DISJOINTNESS, over the union of send and receive, actually holding.
    const seen = new Set();
    let overlap = false;
    for (const o of entry.combo) {
      for (const p of [...o.send, ...o.receive]) {
        if (seen.has(p.playerId)) overlap = true;
        seen.add(p.playerId);
      }
    }
    ok(`${me.name}: no player appears in two trades of one combo`, !overlap,
      entry.combo.map((o) => o.shape).join(' + '));

    // The combined gain, re-derived from the raw roster with every move applied
    // at once — not read back off the engine, and not the sum of the parts.
    const send = entry.combo.flatMap((o) => o.send);
    const receive = entry.combo.flatMap((o) => o.receive);
    const after = handRosterAfter(me.players, send, receive);
    const handDelta =
      handSeasonTotal(after, demoSlots, SEASON_WEEKS) -
      handSeasonTotal(me.players, demoSlots, SEASON_WEEKS);
    close(entry.delta, handDelta, 0.3,
      `${me.name}: the combo's gain is the combined roster re-priced once`);

    ok(`${me.name}: the combo leaves him no bigger than he started`,
      after.length <= me.players.length,
      `${after.length} vs ${me.players.length}`);

    if (entry.count >= 2 && Math.abs(entry.naiveDelta - entry.delta) > 0.5) disagreements++;
  }

  ok(`${me.name}: the headline packing is the best-gain one`,
    packed.combo === packed.best.combo);
  ok(`${me.name}: the most-trades packing has at least as many trades`,
    packed.most.count >= packed.best.count,
    `${packed.most.count} vs ${packed.best.count}`);
  ok(`${me.name}: and no more gain than the best-gain one`,
    packed.most.delta <= packed.best.delta + 1e-9,
    `${packed.most.delta} vs ${packed.best.delta}`);
  eq(packed.mostIsBest,
    packed.best.count === packed.most.count &&
      packed.best.combo.every((o, i) => o === packed.most.combo[i]),
    `${me.name}: the flag matches the two packings it describes`);

  // Every partner in the packing still wants it — that is what `teams` buys.
  ok(`${me.name}: no partner in the packing ends up worse off`,
    packed.best.partners.every((p) => p.delta >= 0),
    packed.best.partners.map((p) => `${p.partner.name} ${p.delta}`).join(', '));
}

ok('enough real combos were packed to mean something', combosChecked >= 3, `${combosChecked}`);
ok('and on real rosters the naive sum really does overstate at least one of them',
  disagreements > 0,
  'no multi-trade combo differed from the sum of its parts — check the fixture, not the engine');

// ===========================================================================
// THE FLOOR HAS TO REACH THE COMBO — and for a day it did not
// ===========================================================================
//
// Tim, 2026-09-19: "Right now the best combination is actually really bad and
// doesn't select the best combination at all. For example right now the best
// combo gives me a single trade that is a 2-1 that has a lower +/week than the
// top trade."
//
// He was right and the cause was one missing option. `findTrades` has taken
// `floors` since the positional floor landed on 2026-09-18, and the Trade page
// passes it — so every row in the finder is priced with the waiver floor
// applied. `bestCombo` did not accept the option AT ALL, so it priced every
// packing, and every partner check, WITHOUT it. One page, two questions, and no
// warning: the panel was ranking packings on a basis the table above it does
// not use, and printing a number nobody could reconcile against that table.
//
// Measured on the demo league over weeks 5-13 with a stand-in wire, before the
// fix: Autumn's top row read +1.74 a week while the combo priced that very same
// deal at +0.11 and printed a best packing of +0.57 — LOWER than the row above
// it, which is exactly the sentence he wrote. In another squad it ran the other
// way and printed +7.58 against a top row of +1.37.
//
// SO THE INVARIANTS BELOW ARE THE FIX MADE FALSIFIABLE:
//
//   1. THE COMBO IS NEVER WORSE THAN THE BEST SINGLE OFFER. It cannot be —
//      taking only that one deal is a packing the search considers — so a combo
//      that comes back smaller is proof it is pricing on another basis. This is
//      Tim's own sentence turned into an assertion.
//   2. A ONE-DEAL PACKING'S MERGED ROW IS THAT PACKING'S OWN GAIN, and no
//      merged row is ever worth more than the packing it belongs to. The merged
//      rows are what the page PRINTS, so this is where a basis mismatch becomes
//      visible to a reader.
//   3. The packing's own engine prices the top offer exactly as the finder did,
//      which is the contract the other two rest on.
//
// FALSIFIED, and here is exactly what happened: take `floors` back out of the
// two `priceTradeAcrossWeeks` calls inside `bestCombo`'s `price()` and run this
// file. Seven assertions fail, among them
//   "Autumn: the best combo is never worse than the best single trade —
//    combo 0 vs top offer 5.8"
// which is Tim's report in one line: a panel recommending NOTHING while a +5.8
// deal sits in the table directly above it.
{
  // A wire deep enough for `positionFloors` to find a third man at a position
  // — the rank the floor is taken at since 2026-09-19 — and pitched high
  // enough to bite on the demo squads. It is nothing like a real wire on
  // purpose, exactly as `an-test`'s floors are: a page or an engine that
  // ignored these could not pass by coincidence.
  const wire = [];
  for (const [pos, top] of [['QB', 17], ['RB', 12], ['WR', 12], ['TE', 9], ['DST', 9], ['K', 9]]) {
    for (let i = 0; i < 5; i++) {
      wire.push({
        playerId: `wire-${pos}-${i}`, name: `Wire ${pos}${i}`, position: pos,
        projected: top - i * 0.5, injuryStatus: 'ACTIVE',
      });
    }
  }
  const floors = positionFloors(wire, { week: SEASON_WEEKS[0] });
  ok('the stand-in wire really does produce floors', floors.size >= 5, `${floors.size} positions`);

  let checked = 0;
  let wouldHaveFailed = 0;
  for (const me of demoTeams) {
    const res = findTrades({
      teams: demoTeams, myTeamId: me.id, slots: demoSlots,
      weeks: SEASON_WEEKS, projFor: demoProjFor, floors,
    });
    if (res.offers.length < 2) continue;
    checked++;

    const packed = bestCombo(res.offers, {
      players: me.players, slots: demoSlots, weeks: SEASON_WEEKS, projFor: demoProjFor,
      teams: demoTeams, floors,
    });

    // 1. THE SINGLETON. Priced by the combo's own engine, against the offer's
    //    own gain out of the finder. To the tenth, because both round there.
    const top = res.offers[0];
    const solo = priceTradeAcrossWeeks({
      players: me.players, send: top.send, receive: top.receive,
      slots: demoSlots, weeks: SEASON_WEEKS, projFor: demoProjFor, floors,
    }).delta;
    close(solo, top.myGain, 0.1,
      `${me.name}: the combo's engine prices the top offer exactly as the finder did`);

    // What the same comparison would have said with the floors dropped — which
    // is what the panel was doing. Counted rather than asserted per squad,
    // because not every squad's floor moves its top deal.
    const unfloored = priceTradeAcrossWeeks({
      players: me.players, send: top.send, receive: top.receive,
      slots: demoSlots, weeks: SEASON_WEEKS, projFor: demoProjFor,
    }).delta;
    if (Math.abs(unfloored - top.myGain) > 0.1) wouldHaveFailed++;

    // 2. THE INVARIANT. Every singleton is a candidate packing, so the best
    //    packing is at least as good as the best single deal.
    ok(`${me.name}: the best combo is never worse than the best single trade`,
      packed.delta + 0.05 >= solo, `combo ${packed.delta} vs top offer ${solo}`);

    // And the merged rows the page actually PRINTS are priced on the same basis
    // too — a merged row is a re-price, so it is a third place the floor could
    // have been dropped and nobody would have seen it.
    const merged = mergeComboByPartner(packed.best, {
      players: me.players, slots: demoSlots, weeks: SEASON_WEEKS, projFor: demoProjFor, floors,
    });
    if (packed.best.count === 1 && merged.length === 1) {
      close(merged[0].myGain, packed.best.delta, 0.1,
        `${me.name}: a one-deal packing's merged row is the packing's own gain`);
    }
    // A merged row can never be worth more than the whole packing it came from.
    ok(`${me.name}: no merged row claims more than the packing it belongs to`,
      merged.every((m) => m.myGain <= packed.best.delta + 0.1),
      merged.map((m) => `${m.partner.name} ${m.myGain}`).join(', ') + ` vs ${packed.best.delta}`);

    // 3. `requirePartnersGain` IS NOW ASKING THE SAME QUESTION THE FINDER ASKED,
    //    and this is the assertion that says so rather than assuming it.
    //
    //    The finder only returns offers where BOTH squads improve, on these
    //    weeks with these floors. So a packing of exactly that one offer is a
    //    win-win by construction, and `requirePartnersGain` cannot refuse it —
    //    which means a squad with an offer can never come back with a packing
    //    of NOTHING. With the partner side unfloored it could and did: the
    //    check was re-deriving his lineup on a basis the certification had not
    //    used, and throwing out deals it had already approved.
    //
    //    "Making none of them" remains a legal answer in general (there is a
    //    scenario above that asserts it) — but not when the offers themselves
    //    were certified on this very basis.
    ok(`${me.name}: a squad with offers gets a packing, not an empty one`,
      packed.count >= 1,
      `${res.offers.length} offers certified as win-wins, packing of ${packed.count}`);
    ok(`${me.name}: no partner in the floored packing ends up worse off`,
      packed.best.partners.every((p) => p.delta >= -0.05),
      packed.best.partners.map((p) => `${p.partner.name} ${p.delta}`).join(', '));
  }

  ok('enough squads had a floored combo to mean anything', checked >= 3, `${checked}`);
  // THE FIXTURE IS PROVED TO BITE. If the floor made no difference to any top
  // deal, every assertion above would pass with the floors thrown away and the
  // whole section would be measuring nothing.
  ok('and the floor genuinely moves at least one of those top deals, so the ' +
    'assertions above could actually fail without it',
    wouldHaveFailed > 0,
    'the stand-in wire is too weak to change any top offer — fix the fixture, not the engine');
}

// ---- the default path is untouched ----------------------------------------
//
// `test-trade.mjs` is 1,411 assertions about the scalar engine and none of them
// may move. The weekly measure is opt-in, and half of it is not enough.

{
  const plain = findTrades({ teams: demoTeams, myTeamId: demoTeams[0].id, slots: demoSlots });
  eq(plain.basis, 'measure', 'no weeks means the season-average measure, as before');

  const halfA = findTrades({
    teams: demoTeams, myTeamId: demoTeams[0].id, slots: demoSlots, weeks: SEASON_WEEKS,
  });
  const halfB = findTrades({
    teams: demoTeams, myTeamId: demoTeams[0].id, slots: demoSlots, projFor: demoProjFor,
  });
  eq(halfA.basis, 'measure', 'weeks with no way to read them falls back rather than guessing');
  eq(halfB.basis, 'measure', 'and so does a reader with no weeks');
  eq(halfA.offers.length, plain.offers.length, 'the fallback is the old search exactly');
  ok('offer for offer',
    halfA.offers.every((o, i) => o.shape === plain.offers[i].shape &&
      o.myGain === plain.offers[i].myGain));
  ok('and no offer from the default path claims a weekly basis',
    plain.offers.every((o) => o.basis === undefined));
  eq(findTrades({ teams: demoTeams, myTeamId: 999, slots: demoSlots }).basis, 'measure',
    'an unknown squad still answers rather than throwing');
}

// The weekly measure through a ONE-week list is the selected-week measure, so
// the page's third option costs it no new code path.
{
  const one = seasonLineupValue(demoTeams[0].players, demoSlots, [5], demoProjFor);
  const direct = optimalLineup(
    demoTeams[0].players.map((p) => ({ ...p, projected: demoProjFor(p, 5) })), demoSlots
  );
  close(one.total, direct.total, 1e-9,
    'one week of the weekly measure IS forecast.js’s optimalLineup on that week');
}

// ---------------------------------------------------------------------------

if (fails.length) {
  for (const f of fails.slice(0, 25)) console.log('FAIL ' + f);
  if (fails.length > 25) console.log(`… and ${fails.length - 25} more`);
}
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
