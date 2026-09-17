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
  seasonLineupValue, priceTradeAcrossWeeks, bestCombo, findTrades,
} from '../js/trade.js';

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
// A 0.00 is a bye only in his bye week (2026-09-16)
// ---------------------------------------------------------------------------
//
// ESPN projects an OUT or IR man at exactly 0.00 in ordinary weeks too. So
// `zeroIsBye` may be a `(player, week)` function, and only the weeks it says
// are byes leave the per-week divisor. A ruled-out zero is a week he does not
// play for a reason a trade does not fix, and it counts as a zero.
//
//   Hurt: 0 10 10     bye week 1 -> 20 / 2 = 10.0 (week 1 is his bye)
//                     bye week 3 -> 20 / 3 =  6.7 (week 1 is a ruled-out zero)
{
  const hurt = man('Hurt', 'RB', [0, 10, 10]);
  const swapped = man('Swapped', 'RB', [5, 5, 5]);
  const perWeekOf = (zeroIsBye) => {
    const priced = priceTradeAcrossWeeks({
      players: [wideA, swapped], send: [swapped], receive: [hurt],
      slots: QB_RB, weeks: WEEKS3, projFor, zeroIsBye,
    });
    const joined = priced.roster.find((p) => p.playerId === hurt.playerId);
    return joined ? { perWeek: joined.perWeek, playable: joined.weeksPlayable, total: joined.projected } : null;
  };
  const flagOn = perWeekOf(true);
  const flagOff = perWeekOf(false);
  const byeIs1 = perWeekOf((p, w) => p.playerId === hurt.playerId && w === 1);
  const byeIs3 = perWeekOf((p, w) => p.playerId === hurt.playerId && w === 3);
  close(flagOn && flagOn.perWeek, 10, 1e-9, 'the old flag still works: every zero a bye, 20 / 2');
  close(flagOff && flagOff.perWeek, 6.7, 1e-9, 'and false still counts every zero, 20 / 3');
  close(byeIs1 && byeIs1.perWeek, 10, 1e-9, 'a zero IN his bye week leaves the divisor: 20 / 2');
  eq(byeIs1 && byeIs1.playable, 2, 'two playable weeks when week 1 is his bye');
  close(byeIs3 && byeIs3.perWeek, 6.7, 1e-9,
    'A RULED-OUT ZERO OUTSIDE HIS BYE WEEK COUNTS AS A ZERO: 20 / 3, not 20 / 2');
  eq(byeIs3 && byeIs3.playable, 3, 'and all three weeks are playable — the bye week has a number in it');
  close(byeIs3 && byeIs3.total, 20, 1e-9, 'the total is the same 20 either way; only the divisor moves');
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
  ok('and does it in a time a page can hand off to a timeout', slowest < 20000,
    `${slowest}ms for the slowest squad`);
  console.log(
    `weekly finder: ${Math.round(timings.reduce((a, b) => a + b, 0))}ms for ten squads ` +
    `over ${SEASON_WEEKS.length} weeks (slowest squad ${slowest}ms), ${found} offers`
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
