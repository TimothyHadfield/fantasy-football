// SUGGESTED ADDITIONS — the men who would even up a half-built custom trade.
//
//   node test-trade-suggest.mjs
//
// Same shape as `test-trade-weekly.mjs` and for the same reasons: a hand fixture
// whose every number was worked out on paper before the engine was run, then the
// real demo pool for the one thing a hand fixture cannot give — a measured cost.
//
// THE WHOLE FIXTURE IS ONE QB SLOT AND ONE RB SLOT OVER THREE WEEKS, and every
// player projects the same number every week. Nothing can hide in a flex, no
// week differs from another, and every total below is a one- or two-term sum
// times three. If the engine disagrees with one of these the engine is wrong;
// there is no arithmetic here for it to agree with itself about.
//
// The sections, and what each is for:
//
//   1. the deal, and the four men who even it up   — ALL of them, ranked
//   2. the man who does not help                   — excluded, and reported
//   3. direction                                   — A ahead, then B ahead
//   4. overshoot                                   — too much is not "evener"
//   5. the fleece                                  — returned, and labelled
//   6. the tolerance band                          — labels only, never membership
//   7. the floors                                  — the seam, made falsifiable
//   8. the limit knob                              — and what it costs
//   9. the refusals                                — nothing ticked, bad input
//  10. the cost                                    — measured on the demo pool
//  11. the goal                                    — weighted weeks reorder it

import { generateDemoWeekRosters } from '../js/demo-rosters.js';
import { slotCountsFromLineups } from '../js/projection.js';
import { positionFloors } from '../js/floor.js';
import { slotsForLeague, priceTradeAcrossWeeks } from '../js/trade.js';
import { suggestAdditions, SUGGEST_LIMIT, EVEN_TOLERANCE_PER_WEEK } from '../js/trade-suggest.js';

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

/**
 * The nth candidate, or an empty stand-in.
 *
 * Not politeness: break the engine so that a list comes back a man short and an
 * `undefined[0]` throws on the first line, which kills the run and hides every
 * assertion after it. Every falsification in this file is meant to produce a
 * READABLE list of what broke, so a missing entry has to fail an assertion
 * rather than crash the process.
 */
const at = (list, i) => (Array.isArray(list) && list[i]) || {};
const named = (list, name) => (Array.isArray(list) && list.find((c) => c.name === name)) || {};

// ===========================================================================
// The fixture
// ===========================================================================

const QB_RB = [0, 2];        // one QB, one RB. Nothing else is startable at all.
const WEEKS3 = [1, 2, 3];

let nextId = 7000;
const WEEKLY = new Map();
const key = (playerId, week) => `${playerId}:${week}`;

/** A man who projects the same number every week — so his season total is 3x it. */
function man(name, position, perWeek, weeks = WEEKS3) {
  const playerId = nextId++;
  for (const w of weeks) WEEKLY.set(key(playerId, w), perWeek);
  return {
    playerId, name, position, lineupSlotId: 20,
    seasonProjected: perWeek * 17, projected: perWeek,
  };
}

const projFor = (p, week) => {
  const v = WEEKLY.get(key(p.playerId, week));
  return Number.isFinite(v) ? v : null;
};

// ---------------------------------------------------------------------------
// Squad A carries a weak quarterback and a pile of running backs it cannot
// start. Squad B carries one very good quarterback and nothing else.
//
//   A   A-qb  QB 10   A-rb1 RB 10   A-rb2 RB 8   A-rb3 RB 6   A-wr WR 9
//   B   B-qb  QB 18   B-rb1 RB  5   B-rb2 RB 3
//
// A fields 10 + 10 = 20 a week, so 60 over the three.
// B fields 18 +  5 = 23 a week, so 69.
//
// THE DEAL AS TICKED: A takes B's quarterback and sends nobody. That is the
// exact state Tim's panel appears in — one man ticked, one box still empty.
//
//   A: six men, so the roster limit cuts his worst (A-rb3, 18 over the span).
//      He fields 18 + 10 = 28 a week = 84.          delta +24
//   B: has no quarterback left at all. He fields 0 + 5 = 5 a week = 15.
//                                                    delta -54
//   gap = 24 - (-54) = 78, and A is the side that is ahead.
// ---------------------------------------------------------------------------

const aQb = man('A-qb', 'QB', 10);
const aRb1 = man('A-rb1', 'RB', 10);
const aRb2 = man('A-rb2', 'RB', 8);
const aRb3 = man('A-rb3', 'RB', 6);
const aWr = man('A-wr', 'WR', 9);
const SQUAD_A = [aQb, aRb1, aRb2, aRb3, aWr];

const bQb = man('B-qb', 'QB', 18);
const bRb1 = man('B-rb1', 'RB', 5);
const bRb2 = man('B-rb2', 'RB', 3);
const SQUAD_B = [bQb, bRb1, bRb2];

/** The options every call in this file shares, so no two of them can differ. */
const BASE = { slots: QB_RB, weeks: WEEKS3, projFor };

const deal = (extra = {}) => suggestAdditions({
  rosterA: SQUAD_A, rosterB: SQUAD_B, sendA: [], sendB: [bQb], ...BASE, ...extra,
});

// The base, first, by hand — because every assertion below is relative to it.
{
  const r = deal();
  eq(r.ok, true, 'a half-built deal is something to answer');
  close(r.base.deltaA, 24, 1e-9, 'A gains 24 over the three weeks: 84 against 60');
  close(r.base.deltaB, -54, 1e-9, 'B loses 54: his 69 becomes 15 with no quarterback at all');
  close(r.base.gap, 78, 1e-9, 'so the gap is 78, signed A-minus-B');
  eq(r.base.favours, 'a', 'and it leans A');
  eq(r.base.even, false, 'nobody would call that even');
  eq(r.base.bothGain, false, 'and it is not a win-win either');

  // The base numbers ARE the custom box's own numbers. Priced here the way the
  // page prices them, so a drift between the panel and its suggestions would
  // fail here rather than on screen.
  const forA = priceTradeAcrossWeeks({
    players: SQUAD_A, send: [], receive: [bQb], ...BASE,
  });
  const forB = priceTradeAcrossWeeks({
    players: SQUAD_B, send: [bQb], receive: [], ...BASE,
  });
  close(r.base.deltaA, forA.delta, 1e-9, 'the base is priceTradeAcrossWeeks, not a second opinion');
  close(r.base.deltaB, forB.delta, 1e-9, 'on both sides of the deal');
}

// ===========================================================================
// 1. ALL of them, ranked — not just the one that lands it closest
// ===========================================================================
//
// Tim: "as many players that would be eligable to make the trade more even, and
// not just 1 to make it perfect."
//
// Every man A could throw in, worked out by hand:
//
//   A-qb  10  A still fields 18+10=28 (+24); B now fields 10+5=15 (-24)  gap 48
//   A-rb1 10  A fields 18+8 =26 (+18);       B fields  0+10=10 (-39)     gap 57
//   A-rb2  8  A fields 18+10=28 (+24);       B fields  0+8 = 8 (-45)     gap 69
//   A-rb3  6  A fields 18+10=28 (+24);       B fields  0+6 = 6 (-51)     gap 75
//   A-wr   9  A fields 18+10=28 (+24);       B has no WR slot (-54)      gap 78
//
// Four of the five make it evener. The fifth does nothing and is section 2.

{
  const r = deal();
  eq(r.side, 'a', 'the side that is AHEAD is the side that can give more away');
  eq(r.candidates.length, 4, 'four of A’s five spare men make the deal more even');
  eq(r.candidates.map((c) => c.name).join(','), 'A-qb,A-rb1,A-rb2,A-rb3',
    'and they come back evenest-first, all of them, not just the best');
  eq(r.candidates.map((c) => c.rank).join(','), '1,2,3,4', 'ranked 1..n in the returned order');

  const want = [
    ['A-qb', 24, -24, 48],
    ['A-rb1', 18, -39, 57],
    ['A-rb2', 24, -45, 69],
    ['A-rb3', 24, -51, 75],
  ];
  want.forEach(([name, dA, dB, gap], i) => {
    const c = at(r.candidates, i);
    eq(c.name, name, `#${i + 1} is ${name}`);
    close(c.deltaA, dA, 1e-9, `${name}: A ends at ${dA} over the three weeks`);
    close(c.deltaB, dB, 1e-9, `${name}: B ends at ${dB}`);
    close(c.gap, gap, 1e-9, `${name}: which is a gap of ${gap}`);
    close(c.gapAbs, Math.abs(gap), 1e-9, `${name}: and gapAbs is its size`);
    close(c.shrink, 78 - Math.abs(gap), 1e-9, `${name}: shrink is what it took off the gap`);
    eq(c.improves, true, `${name}: and it is in the improving list`);
    eq(c.side, 'a', `${name}: he leaves squad A`);
    close(c.gapBefore, 78, 1e-9, `${name}: carries the gap it started from, so a row can print both`);
  });

  ok('every candidate really is evener than the deal as it stands',
    r.candidates.every((c) => c.gapAbs < r.base.gapAbs));
  ok('the list is sorted evenest-first',
    r.candidates.every((c, i) => i === 0 || c.gapAbs >= r.candidates[i - 1].gapAbs));

  // The candidate's own numbers ARE a re-price of the bigger deal. Checked
  // against the engine directly, because this is the one thing the caller will
  // print beside the suggestion and it has to be the truth.
  for (const c of r.candidates) {
    const forA = priceTradeAcrossWeeks({
      players: SQUAD_A, send: [c.player], receive: [bQb], ...BASE,
    });
    const forB = priceTradeAcrossWeeks({
      players: SQUAD_B, send: [bQb], receive: [c.player], ...BASE,
    });
    close(c.deltaA, forA.delta, 1e-9, `${c.name}: A's number is the deal WITH him re-priced`);
    close(c.deltaB, forB.delta, 1e-9, `${c.name}: and so is B's`);
    ok(`${c.name}: the full pricing comes back, so a pop-up costs nothing extra`,
      !!c.pricing && !!c.pricing.forA.byWeek && c.pricing.forA.byWeek.length === 3);
  }
}

// ===========================================================================
// 2. A man who does not help is excluded — and reported
// ===========================================================================
//
// A-wr is a receiver in a league with no receiver slot. He is worth nothing to
// A (he never starts) and nothing to B (same reason), so throwing him in moves
// neither number and leaves the gap at 78. He is not a suggestion.

{
  const r = deal();
  ok('the man who changes nothing is not offered as a suggestion',
    !r.candidates.some((c) => c.name === 'A-wr'),
    r.candidates.map((c) => c.name).join(','));
  eq(r.rejected.length, 1, 'he is priced and set aside rather than silently vanishing');
  eq(named(r.rejected, 'A-wr').name, 'A-wr', 'and the panel can say which man it was');
  close(named(r.rejected, 'A-wr').gap, 78, 1e-9, 'with the gap he would have left: exactly the one we started with');
  eq(named(r.rejected, 'A-wr').improves, false, 'flagged as no improvement');
  eq(r.pool, 5, 'five spare men existed');
  eq(r.considered, 5, 'and all five were priced');
  eq(r.limited, false, 'so nothing was cut for cost');
}

// ===========================================================================
// 2b. RANKED BY WHAT HE DOES TO THE GAP, never by how good he is
// ===========================================================================
//
// Fixture 1 cannot test this and it took a deliberate break to find out: every
// man in it happens to rank the same way by his own season total as by the gap
// he leaves, so an engine sorting by the wrong key passes the whole file. That
// is a fixture measuring nothing, and it is exactly what rule 5 of HANDOFF's
// parallel-agents section says to go looking for.
//
// So a third squad, built so the two orders DISAGREE. F's problem after the
// deal is that he has no quarterback at all and a perfectly good back already:
//
//   E   E-qb QB 10   E-rb RB 10   E-bq QB 9 (bench)   E-br RB 2 (bench)
//   F   F-qb QB 18   F-rb RB 16   F-junk RB 1
//
//   E fields 10 + 10 = 20 a week = 60.  F fields 18 + 16 = 34 a week = 102.
//
// TICKED: E takes F's quarterback and sends nobody. E cuts E-br to fit him and
// fields 18 + 10 = 28 (+24); F has no quarterback and fields 16 (-54). Gap 78.
//
//   E-qb  season 30   E +24, F 10+16=26 (-24)   gap 48
//   E-bq  season 27   E +24, F  9+16=25 (-27)   gap 51
//   E-rb  season 30   E  18+2 = 20 (0), F 16 (-54)   gap 54
//   E-br  season  6   E +24, F still 16 (-54)   gap 78  — nothing
//
// By the gap: E-qb, E-bq, E-rb. By season total: E-qb, E-rb, E-bq. The middle
// two swap, which is the whole point of the fixture.

const eQb = man('E-qb', 'QB', 10);
const eRb = man('E-rb', 'RB', 10);
const eBq = man('E-bq', 'QB', 9);
const eBr = man('E-br', 'RB', 2);
const SQUAD_E = [eQb, eRb, eBq, eBr];

const fQb = man('F-qb', 'QB', 18);
const fRb = man('F-rb', 'RB', 16);
const fJunk = man('F-junk', 'RB', 1);
const SQUAD_F = [fQb, fRb, fJunk];

{
  const r = suggestAdditions({
    rosterA: SQUAD_E, rosterB: SQUAD_F, sendA: [], sendB: [fQb], ...BASE,
  });
  close(r.base.gap, 78, 1e-9, 'the same 78-point gap to close');

  eq(r.candidates.map((c) => c.name).join(','), 'E-qb,E-bq,E-rb',
    'RANKED BY THE GAP THEY LEAVE — the backup quarterback outranks the better back');
  ok('and that is NOT the order their own season totals would give',
    r.candidates.map((c) => c.value).join(',') !== [...r.candidates]
      .sort((x, y) => y.value - x.value).map((c) => c.value).join(','),
    r.candidates.map((c) => `${c.name} ${c.value}/${c.gapAbs}`).join(', '));

  close(named(r.candidates, 'E-qb').gap, 48, 1e-9, 'E-qb leaves a gap of 48');
  close(named(r.candidates, 'E-bq').gap, 51, 1e-9, 'E-bq a gap of 51 — worth 27, not 30');
  close(named(r.candidates, 'E-rb').gap, 54, 1e-9, 'E-rb a gap of 54 despite being worth 30');
  close(named(r.candidates, 'E-rb').deltaA, 0, 1e-9,
    'because sending E his own starting back wipes out his whole gain');
  close(named(r.rejected, 'E-br').gap, 78, 1e-9,
    'and the 2-point bench back changes nothing: F would still start his own 16');
}

// ===========================================================================
// 3. DIRECTION — and getting it backwards reads as nonsense, not as a bug
// ===========================================================================
//
// The same deal, with the two squads handed over in the other order. B's squad
// is now "A" and the gap is -78. The suggestions must be the SAME four men, and
// the side must be the other letter.

{
  const mirrored = suggestAdditions({
    rosterA: SQUAD_B, rosterB: SQUAD_A, sendA: [bQb], sendB: [], ...BASE,
  });
  eq(mirrored.side, 'b', 'with the second squad ahead, the suggestions come off IT');
  close(mirrored.base.gap, -78, 1e-9, 'the gap is the same size with the sign turned round');
  eq(mirrored.candidates.map((c) => c.name).join(','), 'A-qb,A-rb1,A-rb2,A-rb3',
    'and the same four men in the same order');
  eq(mirrored.candidates.every((c) => c.side === 'b'), true, 'all of them off the second squad');
  close(at(mirrored.candidates,0).deltaA, -24, 1e-9, 'with the two deltas mirrored too');
  close(at(mirrored.candidates,0).deltaB, 24, 1e-9, 'B’s squad gains where A’s lost');

  // Forcing the side that is BEHIND is answered honestly rather than invented.
  const wrongWay = deal({ side: 'b' });
  eq(wrongWay.side, 'b', 'a forced side is used as given');
  eq(wrongWay.candidates.length, 0,
    'adding to the side that is already behind cannot make a deal more even');
  eq(wrongWay.rejected.length, 2, 'and B’s two spare men are priced and refused, not hidden');

  // Forcing the ahead side explicitly is the same answer `auto` reached.
  const forced = deal({ side: 'a' });
  eq(forced.candidates.map((c) => c.name).join(','),
    deal().candidates.map((c) => c.name).join(','),
    'forcing the ahead side is what auto already did');

  // A DEAL WITH NO AHEAD SIDE. Swap A's useless receiver for B's third back:
  // neither man starts anywhere, so both squads field exactly what they fielded
  // and both deltas are zero. There is then no side to take a suggestion from,
  // and nothing can make a gap of nothing smaller — so `auto` offers both
  // squads' spares, prices them, and comes back with an honest empty list
  // rather than an invented one.
  const level = suggestAdditions({
    rosterA: SQUAD_A, rosterB: SQUAD_B, sendA: [aWr], sendB: [bRb2], ...BASE,
  });
  close(level.base.deltaA, 0, 1e-9, 'a swap of two men nobody starts moves A not at all');
  close(level.base.deltaB, 0, 1e-9, 'nor B');
  close(level.base.gap, 0, 1e-9, 'so the gap is zero and no side is ahead');
  eq(level.side, 'both', 'with nobody ahead, both squads’ spares are considered');
  eq(level.candidates.length, 0, 'and nothing can make a gap of nothing smaller');
  eq(level.rejected.length, level.considered,
    'every man priced is reported as no help, so the panel can say why it is empty');
  ok('and the pool really did span both squads',
    level.rejected.some((c) => c.side === 'a') && level.rejected.some((c) => c.side === 'b'),
    level.rejected.map((c) => `${c.name}:${c.side}`).join(','));
}

// ===========================================================================
// 4 and 5. OVERSHOOT, and the fleece
// ===========================================================================
//
// A second fixture, because fixture 1's gap is far too wide for any one man to
// overshoot it. Here the deal is nearly level and C's bench is full of
// quarterbacks he cannot start.
//
//   C   C-qb1 QB 20   C-qb2 QB 19   C-qb3 QB 9   C-rb RB 10   C-scrub RB 2
//   D   D-qb   QB 8   D-rb  RB 12   D-junk1 RB 1  D-junk2 RB 1
//
//   C fields 20 + 10 = 30 a week = 90.   D fields 8 + 12 = 20 a week = 60.
//
// TICKED: C sends C-rb and takes D-rb.
//   C fields 20 + 12 = 32 (+6).  D fields 8 + 10 = 18 (-6).  gap = 12.
//
// What C could throw in, by hand — D is at his roster limit, so every arrival
// costs him his worst man (a junk back, worth 3 over the span):
//
//   C-qb3   9  C fields 20+12 (+6); D fields  9+10=19 (-3)   gap   9  EVENER
//   C-qb2  19  C fields 20+12 (+6); D fields 19+10=29 (+27)  gap -21  OVERSHOT
//   C-qb1  20  C fields 19+12 (+3); D fields 20+10=30 (+30)  gap -27  OVERSHOT
//   C-scrub 2  C fields 20+12 (+6); D cuts him on arrival (-6)  gap 12  NOTHING

const cQb1 = man('C-qb1', 'QB', 20);
const cQb2 = man('C-qb2', 'QB', 19);
const cQb3 = man('C-qb3', 'QB', 9);
const cRb = man('C-rb', 'RB', 10);
const cScrub = man('C-scrub', 'RB', 2);
const SQUAD_C = [cQb1, cQb2, cQb3, cRb, cScrub];

const dQb = man('D-qb', 'QB', 8);
const dRb = man('D-rb', 'RB', 12);
const dJunk1 = man('D-junk1', 'RB', 1);
const dJunk2 = man('D-junk2', 'RB', 1);
const SQUAD_D = [dQb, dRb, dJunk1, dJunk2];

const tight = (extra = {}) => suggestAdditions({
  rosterA: SQUAD_C, rosterB: SQUAD_D, sendA: [cRb], sendB: [dRb], ...BASE, ...extra,
});

{
  const r = tight();
  close(r.base.deltaA, 6, 1e-9, 'C is up 6 on the deal as ticked');
  close(r.base.deltaB, -6, 1e-9, 'and D is down 6');
  close(r.base.gap, 12, 1e-9, 'a gap of 12 over three weeks — four points a week');
  eq(r.side, 'a', 'C is ahead, so the suggestions are C’s men');

  eq(r.candidates.length, 1, 'exactly one of C’s three spare men makes it evener');
  eq(at(r.candidates,0).name, 'C-qb3', 'the backup quarterback D would actually start');
  close(at(r.candidates,0).deltaA, 6, 1e-9, 'C keeps his +6 — a man he never started costs him nothing');
  close(at(r.candidates,0).deltaB, -3, 1e-9, 'and D goes from -6 to -3');
  close(at(r.candidates,0).gap, 9, 1e-9, 'gap 12 -> 9');
  close(at(r.candidates,0).shrink, 3, 1e-9, 'three points evener');

  // OVERSHOOT. Both of C's good quarterbacks would hand D the deal by MORE than
  // C is currently ahead by, which is not "more even" in any direction.
  eq(r.rejected.length, 3, 'the other three are priced and set aside');
  close(named(r.rejected,'C-qb2').gap, -21, 1e-9, 'C-qb2 swings the deal 21 the other way');
  close(named(r.rejected,'C-qb1').gap, -27, 1e-9, 'and C-qb1 swings it 27');
  ok('overshooting the gap is not making it more even',
    named(r.rejected,'C-qb2').gapAbs > 12 && named(r.rejected,'C-qb1').gapAbs > 12);
  eq(named(r.rejected,'C-qb2').improves, false, 'so C-qb2 is not a suggestion');
  eq(named(r.rejected,'C-qb1').improves, false, 'and neither is C-qb1');
  close(named(r.rejected,'C-scrub').gap, 12, 1e-9,
    'and the scrub D would cut the moment he arrived changes nothing at all');

  // THE FLEECE. Tim: "Allow for some leeway so that the user can do a 'fleece'
  // trade and have the opponent have a -/week or something like that."
  //
  // The one suggestion here leaves D at -3 over the three weeks — a point a
  // week down. It is returned, ranked first, and LABELLED, not filtered out.
  eq(at(r.candidates,0).fleece, true, 'the opponent still ends up negative');
  close(at(r.candidates,0).opponentDelta, -3, 1e-9,
    'and the panel is handed his number outright, so it can print "-1.0 a week"');
  eq(at(r.candidates,0).bothGain, false, 'this is not a win-win and does not pretend to be');
  eq(at(r.candidates,0).label, 'ahead', 'labelled as still favouring the man throwing him in');
  eq(at(r.candidates,0).favours, 'a', 'the deal still leans C');

  // And in fixture 1, where every single suggestion is a fleece, every single
  // one comes back anyway. This is rule 4 of the module: the band labels, it
  // never hides.
  const wide = deal();
  eq(wide.candidates.every((c) => c.fleece), true,
    'all four of A’s options leave B under water, and all four are returned');
  eq(wide.candidates.every((c) => c.label === 'ahead'), true, 'each labelled as a fleece-ward deal');
  eq(wide.candidates.every((c) => c.opponentDelta === c.deltaB), true,
    'the opponent of a side-A suggestion is side B');
}

// ===========================================================================
// 6. The tolerance band LABELS, it does not filter
// ===========================================================================
//
// The same call with a wide band and with the default. The membership and the
// order of the list must be identical, and only the words must move. If a
// tolerance ever starts deciding what is in the list, a fleece becomes
// unreachable and Tim's own ask is gone.

{
  const strict = tight();
  const loose = tight({ tolerance: 20 });

  eq(loose.candidates.map((c) => c.name).join(','), strict.candidates.map((c) => c.name).join(','),
    'a wider band returns exactly the same candidates');
  eq(loose.rejected.map((c) => c.name).sort().join(','),
    strict.rejected.map((c) => c.name).sort().join(','),
    'and exactly the same rejections');
  close(at(loose.candidates,0).gap, at(strict.candidates,0).gap, 1e-9, 'with the same numbers on them');

  eq(at(strict.candidates,0).even, false, 'at the default band a gap of 9 over 3 weeks is not even');
  eq(at(loose.candidates,0).even, true, 'at a band of 20 the same gap is "about even"');
  eq(at(loose.candidates,0).label, 'even', 'and the label follows the band');
  eq(at(loose.candidates,0).favours, null, 'inside the band, neither side is said to be favoured');
  eq(at(loose.candidates,0).fleece, true,
    'BUT the fleece flag is a fact about the opponent’s number, not about the band');

  close(strict.tolerance, EVEN_TOLERANCE_PER_WEEK * 3, 1e-9,
    'the default band is the per-week constant times the weeks left');
  close(loose.tolerance, 20, 1e-9, 'and an explicit tolerance is a rest-of-season TOTAL');
}

// ===========================================================================
// 7. THE FLOORS REACH THIS PANEL — and here is the proof
// ===========================================================================
//
// HANDOFF rule 13: "A FLOOR THAT REACHES ONE PANEL AND NOT ITS NEIGHBOUR IS
// WORSE THAN NO FLOOR." `bestCombo` priced its packings unfloored for a day
// while every row above it was floored, and the same deal read +5.5 and -10.9.
// A suggestion priced without the floors the deal itself was priced with would
// be that defect one panel further down the page.
//
// A module nobody wires up passes a floors test by accident, so this section
// re-does fixture 1 BY HAND with a wire on the table, and the answers are
// different in four separate ways.
//
//   wire: QB 14 13 12 11 10   ->  the 3rd best is 12
//         RB  9  8  7  6  5   ->  the 3rd best is  7
//
//   A now fields max(10,12) + max(10,7) = 22 a week = 66  (not 60)
//   B now fields      18    + max(5,7)  = 25 a week = 75  (not 69)
//
//   TICKED: A takes B-qb.
//     A fields 18 + 10 = 28 = 84.  delta +18   (it was +24)
//     B has NO quarterback, so the slot is worth the wire's 12, and his back is
//       lifted to 7: 19 a week = 57.  delta -18   (it was -54)
//     gap 36, not 78.
//
//   And the candidates change, because the floor is exactly what a marginal man
//   is worth nothing against:
//     A-qb  10  B's empty QB slot was already worth 12, so a 10 adds NOTHING
//     A-rb3  6  is BELOW the 7 the wire would give B at running back
//   Both of those evened the deal without the floor. Neither does with it.

{
  const wire = [];
  for (const [pos, top] of [['QB', 14], ['RB', 9]]) {
    for (let i = 0; i < 5; i++) {
      wire.push({
        playerId: `wire-${pos}-${i}`, name: `Wire ${pos}${i}`, position: pos,
        projected: top - i, injuryStatus: 'ACTIVE',
      });
    }
  }
  const floors = positionFloors(wire, { week: 1 });
  close(floors.get('QB').value, 12, 1e-9, 'the wire’s 3rd-best QB is a 12');
  close(floors.get('RB').value, 7, 1e-9, 'and its 3rd-best RB a 7');

  const bare = deal();
  const floored = deal({ floors });

  close(floored.base.deltaA, 18, 1e-9, 'with floors A gains 18, not 24 — his old QB was never a 10');
  close(floored.base.deltaB, -18, 1e-9,
    'and B loses 18, not 54 — no manager fields an empty quarterback slot');
  close(floored.base.gap, 36, 1e-9, 'so the deal is a gap of 36 rather than 78');
  ok('THE FLOORS CHANGE THE ANSWER — the seam is wired, not decorative',
    floored.base.gap !== bare.base.gap, `${floored.base.gap} vs ${bare.base.gap}`);

  eq(floored.candidates.length, 2, 'two men even it up with the wire in the picture');
  eq(bare.candidates.length, 4, 'four did without it');
  eq(floored.candidates.map((c) => c.name).join(','), 'A-rb1,A-rb2',
    'and they are a different two men in a different order');

  close(at(floored.candidates,0).deltaA, 12, 1e-9, 'A-rb1: A drops to +12');
  close(at(floored.candidates,0).deltaB, -9, 1e-9, 'A-rb1: B comes up to -9');
  close(at(floored.candidates,0).gap, 21, 1e-9, 'A-rb1: gap 36 -> 21');
  close(at(floored.candidates,1).gap, 33, 1e-9, 'A-rb2: gap 36 -> 33');

  close(named(floored.rejected,'A-qb').gap, 36, 1e-9,
    'A 10-point QB is worth NOTHING to a manager the wire already offers a 12 — no longer a suggestion');
  close(named(floored.rejected,'A-rb3').gap, 36, 1e-9,
    'and a 6-point back is below the 7 the wire would give him, so he is worth nothing either');
  eq(named(floored.rejected,'A-qb').improves, false, 'both of them improved the deal before the floor and do not after');
  eq(named(floored.rejected,'A-rb3').improves, false, 'which is the whole point of the floor');

  // The candidates' own numbers are floored too, not just the base — the floor
  // has to reach every pricing call in the pass, which is three per candidate
  // counting the base.
  const check = priceTradeAcrossWeeks({
    players: SQUAD_B, send: [bQb], receive: [aRb1], ...BASE, floors,
  });
  close(at(floored.candidates,0).deltaB, check.delta, 1e-9,
    'a candidate’s partner number is the floored price, not an unfloored one');
}

// ===========================================================================
// 8. The limit knob, and what it costs
// ===========================================================================
//
// The cap is on the POOL THAT GETS PRICED, ranked by the cheap pre-filter, so it
// really can drop a man who would have improved the deal. That is the trade and
// it is asserted rather than hoped for.

{
  const all = deal();
  const two = deal({ limit: 2 });
  const three = deal({ limit: 3 });

  eq(two.considered, 2, 'a limit of 2 prices exactly two men');
  eq(two.pool, 5, 'out of the five that were available');
  eq(two.limited, true, 'and says so');
  eq(all.limited, false, 'where the full pass does not');
  ok('a limited pass never returns more than it priced', two.candidates.length <= 2);

  // The pre-filter earns its place: the two it chose ARE the top two of the
  // full answer. That is not guaranteed in general — it is a heuristic — but on
  // a fixture this legible it should hold, and if it stops holding the
  // heuristic has changed and somebody should know.
  eq(two.candidates.map((c) => c.name).join(','), 'A-qb,A-rb1',
    'and the cheap pre-filter picked the two the full pricing also ranks first');
  eq(all.candidates.slice(0, 2).map((c) => c.name).join(','), 'A-qb,A-rb1',
    'which is the same two');

  // THE COST OF THE KNOB, stated: A-rb2 genuinely evens the deal and a limit of
  // three loses him, because the pre-filter ranks the useless A-wr above him.
  eq(three.considered, 3, 'a limit of 3 prices three');
  eq(three.candidates.length, 2, 'and finds only two of the four real suggestions');
  ok('so a binding limit really does cost answers — it is a cap, not a free win',
    three.candidates.length < all.candidates.length);

  eq(deal({ limit: 0 }).candidates.length, 0, 'a limit of zero prices nothing at all');
  eq(SUGGEST_LIMIT >= 14, true, 'and the default is high enough that a normal roster is exhaustive');
}

// ===========================================================================
// 9. The refusals — every one of them an answer rather than a throw
// ===========================================================================

{
  // Tim's own condition: nothing until a man is ticked.
  const nothing = suggestAdditions({
    rosterA: SQUAD_A, rosterB: SQUAD_B, sendA: [], sendB: [], ...BASE,
  });
  eq(nothing.ok, false, 'an empty deal is not a deal to even up');
  eq(nothing.reason, 'nothing is ticked yet', 'and it says which refusal this is');
  eq(nothing.candidates.length, 0, 'with nothing offered');

  eq(suggestAdditions({ ...BASE, rosterA: SQUAD_A, rosterB: SQUAD_B, sendB: [bQb], weeks: [] }).ok,
    false, 'no weeks left is no deal to price');
  eq(suggestAdditions({ ...BASE, rosterA: SQUAD_A, rosterB: SQUAD_B, sendB: [bQb], projFor: null }).ok,
    false, 'and no way to read a projection is a refusal, never a guess');
  eq(suggestAdditions({}).ok, false, 'an empty options bag answers rather than throwing');
  eq(suggestAdditions().ok, false, 'and so does no options bag at all');

  // Ids are accepted where players are, because the page holds ids.
  const byId = suggestAdditions({
    rosterA: SQUAD_A, rosterB: SQUAD_B, sendA: [], sendB: [bQb.playerId], ...BASE,
  });
  close(byId.base.gap, 78, 1e-9, 'ticking by id prices the same deal as ticking the player');
  eq(byId.candidates.map((c) => c.name).join(','), deal().candidates.map((c) => c.name).join(','),
    'and finds the same suggestions');

  // A man who is no longer on the squad he was ticked from is COUNTED, never
  // quietly dropped — the page already reports that case and this must not
  // disagree with it.
  const stale = suggestAdditions({
    rosterA: SQUAD_A, rosterB: SQUAD_B, sendA: [], sendB: [bQb, 99999], ...BASE,
  });
  eq(stale.unresolved, 1, 'a ticked man who is not on that roster is reported');
  eq(deal().unresolved, 0, 'and a clean deal reports none');

  // A ticked man is never offered back as a suggestion.
  const already = suggestAdditions({
    rosterA: SQUAD_A, rosterB: SQUAD_B, sendA: [aRb1], sendB: [bQb], ...BASE,
  });
  ok('a man already in the deal is not suggested for it again',
    !already.candidates.concat(already.rejected).some((c) => c.playerId === aRb1.playerId));
}

// ===========================================================================
// 10. THE COST, measured on the real demo pool
// ===========================================================================
//
// Two 16-man squads over nine remaining weeks — the shape Tim's league actually
// is — because this pass re-runs on every tick of a checkbox and "it is O(n)"
// is not a number.

{
  const SEASON_WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13];
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
  const [teamA, teamB] = demoTeams;
  ok('the demo squads are the size a real one is', teamA.players.length >= 14,
    `${teamA.players.length}`);

  // The deal a reader would actually build: tick the other squad's best man.
  const star = teamB.players
    .slice()
    .sort((x, y) => (y.seasonProjected || 0) - (x.seasonProjected || 0))[0];

  const started = Date.now();
  const r = suggestAdditions({
    rosterA: teamA.players, rosterB: teamB.players, sendA: [], sendB: [star],
    slots: demoSlots, weeks: SEASON_WEEKS, projFor: demoProjFor,
  });
  const ms = Date.now() - started;

  eq(r.ok, true, 'the demo deal prices');
  eq(r.side, 'a', 'taking a star for nothing leaves you ahead, so the suggestions are yours');
  ok('and there are real suggestions in it', r.candidates.length > 0,
    `${r.candidates.length} of ${r.considered} priced`);
  ok('every one of them is evener than the deal as it stands',
    r.candidates.every((c) => c.gapAbs < r.base.gapAbs));
  ok('and every one carries both sides’ resulting numbers',
    r.candidates.every((c) => Number.isFinite(c.deltaA) && Number.isFinite(c.deltaB)));

  // A checkbox tick's budget. The ceiling is deliberately generous — this is a
  // regression guard, not the measurement; the measurement is the line printed.
  ok('a full pass is inside a checkbox tick’s budget', ms < 2000,
    `${ms}ms for ${r.considered} candidates over ${SEASON_WEEKS.length} weeks`);
  console.log(
    `suggestAdditions: ${ms}ms for ${r.considered} candidates over ` +
    `${SEASON_WEEKS.length} weeks (${(ms / Math.max(1, r.considered)).toFixed(1)}ms each), ` +
    `${r.candidates.length} improve, pool ${r.pool}`
  );

  // And the same pass with the limit halved really is cheaper, which is the
  // only reason the knob exists.
  const t0 = Date.now();
  const small = suggestAdditions({
    rosterA: teamA.players, rosterB: teamB.players, sendA: [], sendB: [star],
    slots: demoSlots, weeks: SEASON_WEEKS, projFor: demoProjFor, limit: 4,
  });
  const smallMs = Date.now() - t0;
  eq(small.considered, 4, 'the limit binds on a real roster');
  eq(small.limited, true, 'and says so');
  console.log(`  at limit 4: ${smallMs}ms`);
}

// ===========================================================================
// 11. THE GOAL (2026-09-21) — even in the currency the finder uses
// ===========================================================================
//
// Four weeks, the last a playoff week the title goal weighs at 2.8 (the other
// three at 0.4 — mean 1, the way `weekWeights` normalises). Same QB + RB slots.
//
//   G   G-qb QB 10   G-rb RB 20   G-oct RB 8,8,8,0   G-fin RB 0,0,0,10
//   H   H-qb QB 18   H-rb RB 2    H-junk RB 0.5
//
// G's spare backs never start for G (G-rb is 20), so each is worth exactly
// what he adds to H's RB slot over H-rb's 2:
//
//   THE DEAL: G sends G-qb, H sends H-qb.  G +8 a week, H −8.
//     points gap 32 − (−32) = 64          weighted gap the same (8 × Σw = 32)
//   + G-oct: H gains 6,6,6,0  → points +18, weighted 0.4 × 18 = 7.2
//   + G-fin: H gains 0,0,0,8  → points  +8, weighted 2.8 × 8  = 22.4
//
// On POINTS G-oct closes more (gap 46 vs 56). On the GOAL G-fin does (41.6 vs
// 56.8). So with the weights G-fin must come first, and without them G-oct.

{
  const WEEKS4 = [1, 2, 3, 4];
  const W4 = [0.4, 0.4, 0.4, 2.8];
  const manBy = (name, position, byWeek) => {
    const playerId = nextId++;
    WEEKS4.forEach((w, i) => WEEKLY.set(key(playerId, w), byWeek[i]));
    const mean = byWeek.reduce((a, x) => a + x, 0) / byWeek.length;
    return { playerId, name, position, lineupSlotId: 20, seasonProjected: mean * 17, projected: mean };
  };
  const gQb = manBy('G-qb', 'QB', [10, 10, 10, 10]);
  const gRb = manBy('G-rb', 'RB', [20, 20, 20, 20]);
  const gOct = manBy('G-oct', 'RB', [8, 8, 8, 0]);
  const gFin = manBy('G-fin', 'RB', [0, 0, 0, 10]);
  const hQb = manBy('H-qb', 'QB', [18, 18, 18, 18]);
  const hRb = manBy('H-rb', 'RB', [2, 2, 2, 2]);
  const hJunk = manBy('H-junk', 'RB', [0.5, 0.5, 0.5, 0.5]);
  const SQUAD_G = [gQb, gRb, gOct, gFin];
  const SQUAD_H = [hQb, hRb, hJunk];
  const run = (extra = {}) => suggestAdditions({
    rosterA: SQUAD_G, rosterB: SQUAD_H, sendA: [gQb], sendB: [hQb],
    slots: QB_RB, weeks: WEEKS4, projFor, side: 'both', ...extra,
  });

  const plain = run();
  eq(plain.basis, 'points', 'with no weights the basis is points, and says so');
  eq(plain.base.gap, 64, 'the deal: G +32, H −32, a points gap of 64');
  eq(at(plain.candidates, 0).name, 'G-oct', 'ON POINTS: G-oct closes the gap most, so he is first');
  ok('and G-fin below him', named(plain.candidates, 'G-fin').rank > named(plain.candidates, 'G-oct').rank,
    plain.candidates.map((c) => c.name).join(','));
  eq(named(plain.candidates, 'G-oct').gapAbs, 46, 'G-oct leaves a points gap of 46');
  eq(named(plain.candidates, 'G-fin').gapAbs, 56, 'G-fin leaves 56');

  const goal = run({ weightsA: W4, weightsB: W4 });
  eq(goal.basis, 'goal', 'with weights the basis is the goal, and says so');
  eq(goal.base.gap, 64, 'the deal itself is uniform, so its weighted gap is also 64');
  eq(at(goal.candidates, 0).name, 'G-fin',
    'ON THE GOAL: G-fin — the playoff-week man — is ranked FIRST');
  ok('and the October man below him', named(goal.candidates, 'G-oct').rank > named(goal.candidates, 'G-fin').rank,
    goal.candidates.map((c) => c.name).join(','));
  close(named(goal.candidates, 'G-fin').gapAbs, 41.6, 0.05, 'G-fin leaves a weighted gap of 41.6');
  close(named(goal.candidates, 'G-oct').gapAbs, 56.8, 0.05, 'G-oct leaves 56.8');
  close(named(goal.candidates, 'G-fin').goalB, -9.6, 0.05, 'H’s weighted gain with G-fin: −32 + 22.4');
  // The printed numbers stay points, whatever the basis.
  eq(named(goal.candidates, 'G-fin').deltaB, -24, 'the row still prints H’s POINTS (−32 + 8)');
  // A FLEECE IS STILL ALLOWED: H ends up negative with either man, and both are
  // returned, labelled.
  ok('a fleece is still returned and labelled under the goal',
    named(goal.candidates, 'G-fin').fleece === true && named(goal.candidates, 'G-oct').fleece === true,
    goal.candidates.map((c) => `${c.name}:${c.fleece}`).join(','));

  // ONE SIDE'S WEIGHTS ONLY: the other side counts its weeks at 1 (its points).
  // H is the only side the spares move, so weighting H alone flips the order.
  const hOnly = run({ weightsB: W4 });
  eq(hOnly.basis, 'goal', 'one side weighted is still the goal basis');
  eq((hOnly.weighted || {}).a, false, 'and it says which side was');
  eq(at(hOnly.candidates, 0).name, 'G-fin', 'H weighted alone: the playoff man first');
  // Weights that do not fit the weeks are no weights at all.
  eq(run({ weightsA: [1, 1], weightsB: [1] }).basis, 'points', 'misfit weights fall back to points');

  // THE TIE-BREAK FOLLOWS THE FINDER: A's gain × P(yes). Two men who land the
  // deal equally even — twins, one of whom H is likelier to take — must be
  // ordered by the expected value, not by id.
  const twin1 = manBy('G-twin1', 'RB', [0, 0, 0, 10]);
  const twin2 = manBy('G-twin2', 'RB', [0, 0, 0, 10]);
  const twins = suggestAdditions({
    rosterA: [gQb, gRb, twin1, twin2], rosterB: SQUAD_H, sendA: [gQb], sendB: [hQb],
    slots: QB_RB, weeks: WEEKS4, projFor, side: 'both', weightsA: W4, weightsB: W4,
    accept: ({ sendA }) => (sendA.some((p) => p.name === 'G-twin2') ? 0.9 : 0.3),
  });
  eq(at(twins.candidates, 0).name, 'G-twin2', 'equal evenness: the likelier yes ranks first');
  close(at(twins.candidates, 0).expected, 28.8, 0.05, 'expected = G’s weighted gain 32 × 0.9');
  eq(at(twins.candidates, 0).accept, 0.9, 'and the chance rides on the candidate');
}

// ---------------------------------------------------------------------------

if (fails.length) {
  for (const f of fails.slice(0, 25)) console.log('FAIL ' + f);
  if (fails.length > 25) console.log(`… and ${fails.length - 25} more`);
}
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
