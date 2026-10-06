// GAIN — what adding one free agent is worth to your lineup (js/waiver-gain.js).
//
//   node test-waiver-gain.mjs
//
// The Players page's Gain column: add him, drop the roster man whose loss costs
// the lineups least, and take the change in the best legal lineup over the
// weeks still to play. The module prices it through the Trade engine
// (`priceTradeAcrossWeeks`: a trade that sends nobody and receives one man), so
// what is checked here is that the answer is the RIGHT one, by means that do
// not go through that call:
//
//   1. A hand fixture, every number worked out in the comments.
//   2. Brute force on six random squads of the real size (16 men, the ten-slot
//      lineup, ten weeks), floors on and off: try EVERY man as the drop, fill
//      every week, keep the best. The module must name the same total.
//   3. With no floor, the same against an exhaustive lineup search that shares
//      no code with `optimalLineup`.
//   4. THE PRUNE: every free agent the prune skips is priced the long way and
//      must come out at exactly 0, week by week; and pruned or not, the two
//      routes give one answer for every man. On random squads and on the demo
//      league.
//   5. The shape the page reads: rows sum to the total, per week is the total
//      over the weeks, no roster and no weeks are 0 rather than an error.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const { gainBase, gainOf, cannotStart } = await imp('js/waiver-gain.js');
const { slotsForLeague } = await imp('js/trade.js');
const { optimalLineup, DEFAULT_SLOTS } = await imp('js/forecast.js');
const { assessLineup, positionFloors } = await imp('js/floor.js');
const { SLOT_ELIGIBILITY } = await imp('js/espn.js');
const { generateDemoWeekRosters } = await imp('js/demo-rosters.js');
const { slotCountsFromLineups } = await imp('js/projection.js');

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const round1 = (n) => Math.round(n * 10) / 10;
const near = (a, b) => Math.abs(a - b) < 0.051;

/** `byWeek` on each man is his projection per week, in the order of `weeks`. */
const projForOf = (weeks) => (p, week) => {
  const v = p.byWeek[weeks.indexOf(week)];
  return typeof v === 'number' ? v : null;
};

// ===========================================================================
// 1. By hand
// ===========================================================================
//
// Slots QB, RB, WR, FLEX, K. Weeks 5-7.
//
//                 wk5  wk6  wk7
//   QB  Qb         20   20   20   starts every week
//   RB  Rb1        14   14   14   RB slot every week
//   RB  Rb2         9    9    9   FLEX every week
//   WR  Wr1        12   12   12   WR slot every week
//   WR  Wr2         6    6    6   never starts — rest of season 18, the lowest idle
//   K   Kick        8    0    8   bye in week 6
//   TE  Te          7    7    7   never starts (9 holds the FLEX) — ROS 21
//
// Today: 20+14+12+9+8 = 63, then 55 (the kicker's 0), then 63.
//
//   A  WR 13 13 13  takes the WR slot; Wr1 (12) drops to FLEX over Rb2 (9).
//                   In comes 13, out goes 9: +4 a week, +12 total. Wr2 is the
//                   free cut.
//   B  K   0  7  0  starts only in week 6, over Kick's bye: +7 total. Wr2 goes.
//   C  WR  9  9  9  level with Rb2 in the FLEX and below Wr1: level is not
//                   ahead, he never starts → 0, and the prune says so.
//   D  TE 10 10 10  takes the FLEX from Rb2 (9): +1 a week, +3 total. Wr2 goes.
//   E  QB 19 19 19  below Qb in the one slot a QB can fill → 0, pruned.
//   F  DST 9  9  9  no slot takes a defence in this league → 0, pruned.
{
  const weeks = [5, 6, 7];
  const slots = [0, 2, 4, 23, 17];
  const man = (playerId, name, position, byWeek) => ({ playerId, name, position, byWeek });
  const players = [
    man(1, 'Qb', 'QB', [20, 20, 20]),
    man(2, 'Rb1', 'RB', [14, 14, 14]),
    man(3, 'Rb2', 'RB', [9, 9, 9]),
    man(4, 'Wr1', 'WR', [12, 12, 12]),
    man(5, 'Wr2', 'WR', [6, 6, 6]),
    man(6, 'Kick', 'K', [8, 0, 8]),
    man(7, 'Te', 'TE', [7, 7, 7]),
  ];
  const base = gainBase({ players, slots, weeks, projFor: projForOf(weeks) });
  eq(base.fill.byWeek.map((w) => w.total), [63, 55, 63], 'hand: the lineup today is 63, 55, 63');

  const A = gainOf(base, man(101, 'A', 'WR', [13, 13, 13]));
  eq(A.total, 12, 'hand A: a better WR is worth +12 over three weeks');
  eq(A.perWeek, 4, 'hand A: +4.0 a week');
  eq(A.weeks.map((w) => [w.week, w.before, w.after, w.delta]), [[5, 63, 67, 4], [6, 55, 59, 4], [7, 63, 67, 4]],
    'hand A: week / now / with him / +');
  eq(A.drop && A.drop.name, 'Wr2', 'hand A: the idle man with the lowest rest of season is dropped');
  ok(A.pruned === false, 'hand A: priced, not pruned');

  const B = gainOf(base, man(102, 'B', 'K', [0, 7, 0]));
  eq(B.total, 7, 'hand B: a kicker for the bye week is worth the week he covers');
  eq(B.weeks.map((w) => w.delta), [0, 7, 0], 'hand B: all of it in week 6');
  eq(B.drop && B.drop.name, 'Wr2', 'hand B: Wr2 goes');

  const C = gainOf(base, man(103, 'C', 'WR', [9, 9, 9]));
  eq([C.total, C.pruned, C.drop], [0, true, null], 'hand C: level with your FLEX is not a gain, and is pruned');
  eq(gainOf(base, man(103, 'C', 'WR', [9, 9, 9]), { prune: false }).total, 0, 'hand C: the long way agrees — 0');

  const D = gainOf(base, man(104, 'D', 'TE', [10, 10, 10]));
  eq([D.total, D.drop && D.drop.name], [3, 'Wr2'], 'hand D: a tight end into the FLEX, +1 a week');

  const E = gainOf(base, man(105, 'E', 'QB', [19, 19, 19]));
  eq([E.total, E.pruned], [0, true], 'hand E: a QB below yours, in a one-QB league, is pruned');
  const F = gainOf(base, man(106, 'F', 'DST', [9, 9, 9]));
  eq([F.total, F.pruned], [0, true], 'hand F: no slot takes his position — pruned at 0');
  eq(gainOf(base, man(106, 'F', 'DST', [9, 9, 9]), { prune: false }).total, 0, 'hand F: the long way agrees — 0');

  // The floor (js/floor.js): no slot is assessed below the waiver wire. With a
  // K floor of 6, Kick's bye week is already assessed at 6, so B's 7 is worth 1.
  const floors = new Map([['K', { value: 6, position: 'K', name: 'Wire K', rank: 3, want: 3 }]]);
  const floored = gainBase({ players, slots, weeks, projFor: projForOf(weeks), floors });
  eq(floored.fill.byWeek.map((w) => w.total), [63, 61, 63], 'hand, floored: the bye week is assessed at the wire’s kicker');
  eq(gainOf(floored, man(102, 'B', 'K', [0, 7, 0])).total, 1, 'hand B, floored: 7 against a floor of 6 is +1, not +7');

  // A man with no number at all, an empty roster, no weeks: 0, never a throw.
  eq(gainOf(base, man(107, 'G', 'WR', [null, null, null])).total, 0, 'hand: a free agent with no projection gains 0');
  eq(gainOf(gainBase({ players: [], slots, weeks, projFor: projForOf(weeks) }), man(101, 'A', 'WR', [13, 13, 13])).total, 0,
    'hand: no roster, no gain');
  const none = gainOf(gainBase({ players, slots, weeks: [], projFor: projForOf([]) }), man(101, 'A', 'WR', []));
  eq([none.total, none.perWeek, none.weeks], [0, 0, []], 'hand: no weeks left, no gain (and no division by zero)');
}

// ===========================================================================
// 2-4. Random squads at the real size
// ===========================================================================

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const LEVEL = { QB: 17, RB: 11, WR: 11, TE: 7, DST: 6.5, K: 8 };
const ROSTER_PLAN = ['QB', 'QB', 'RB', 'RB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE', 'DST', 'K'];
const WIRE_PLAN = { QB: 10, RB: 22, WR: 28, TE: 12, DST: 13, K: 15 };   // 100, the page's pool

/** One man: a level for his position, weekly noise, a bye, the odd blank. */
function makeMan(rand, id, position, weeks, quality) {
  const bye = Math.floor(rand() * weeks.length);
  const blank = rand() < 0.05 ? Math.floor(rand() * weeks.length) : -1;
  // Tenths, as ESPN prints them — and coarse enough that level projections
  // really happen, which is the case the prune has to get right.
  const byWeek = weeks.map((_, i) => {
    if (i === bye) return 0;
    if (i === blank) return null;
    return Math.round(LEVEL[position] * quality * (0.7 + rand() * 0.6) * 2) / 2;
  });
  return { playerId: id, name: `${position}${id}`, position, byWeek };
}

function makeLeague(seed, weeks, plan = ROSTER_PLAN) {
  const rand = rng(seed);
  let id = 1;
  const players = plan.map((position) => makeMan(rand, id++, position, weeks, 0.7 + rand() * 0.7));
  const wire = [];
  for (const [position, n] of Object.entries(WIRE_PLAN)) {
    for (let k = 0; k < n; k++) wire.push(makeMan(rand, 1000 + id++, position, weeks, 0.35 + rand() * 0.85));
  }
  return { players, wire };
}

/** The floors a wire would set in its first week — `positionFloors`, as the site reads them. */
const floorsOf = (wire, weeks) =>
  positionFloors(wire.map((p) => ({ ...p, projected: p.byWeek[0] })), { week: weeks[0] });

/** One week's assessed best lineup, straight from the two engine pieces. */
function weekTotal(roster, i, slots, floors) {
  const at = roster.map((p) => ({ ...p, projected: typeof p.byWeek[i] === 'number' ? p.byWeek[i] : null }));
  return assessLineup(optimalLineup(at, slots).starters, slots, floors).total;
}
const seasonTotal = (roster, weeks, slots, floors) =>
  weeks.reduce((a, _, i) => a + weekTotal(roster, i, slots, floors), 0);

/** BRUTE FORCE: every man tried as the drop — the free agent himself included. */
function bruteGain(players, fa, weeks, slots, floors) {
  const before = seasonTotal(players, weeks, slots, floors);
  const all = players.concat([fa]);
  let best = -Infinity;
  for (const out of all) {
    best = Math.max(best, seasonTotal(all.filter((p) => p !== out), weeks, slots, floors));
  }
  return round1(best - before);
}

/**
 * AN EXHAUSTIVE LINEUP, sharing nothing with `optimalLineup`: every legal way
 * to hand the slots out, best total kept. Raw
 * projections only (the floor is an assessment, tested above).
 */
function exhaustiveBest(roster, i, slots) {
  const vals = roster.map((p) => (typeof p.byWeek[i] === 'number' ? p.byWeek[i] : null));
  const used = new Array(roster.length).fill(false);
  let best = 0;
  const go = (k, sum) => {
    if (k === slots.length) { if (sum > best) best = sum; return; }
    const eligible = SLOT_ELIGIBILITY[slots[k]] || [];
    let any = false;
    for (let j = 0; j < roster.length; j++) {
      if (used[j] || vals[j] === null || !eligible.includes(roster[j].position)) continue;
      any = true;
      used[j] = true;
      go(k + 1, sum + vals[j]);
      used[j] = false;
    }
    // Empty only when nobody is left for it: no projection here is below zero,
    // so a slot left empty beside a man who could fill it is never the best.
    if (!any) go(k + 1, sum);
  };
  go(0, 0);
  return best;
}
function exhaustiveGain(players, fa, weeks, slots) {
  const total = (roster) => weeks.reduce((a, _, i) => a + exhaustiveBest(roster, i, slots), 0);
  const before = total(players);
  const all = players.concat([fa]);
  let best = -Infinity;
  for (const out of all) best = Math.max(best, total(all.filter((p) => p !== out)));
  return round1(best - before);
}

const WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const SLOTS = DEFAULT_SLOTS.slice();   // QB RB RB WR WR WR TE FLEX DST K

{
  let checked = 0;
  let positive = 0;
  let pruned = 0;
  let prunedWrong = 0;
  let routesDiffer = 0;
  let bruteDiffer = 0;
  let rowsOff = 0;
  let perWeekOff = 0;
  let negative = 0;
  let dropMissing = 0;
  let firstBad = '';

  for (let seed = 1; seed <= 6; seed++) {
    const { players, wire } = makeLeague(seed * 7919, WEEKS);
    for (const withFloor of [false, true]) {
      const floors = withFloor ? floorsOf(wire, WEEKS) : null;
      const projFor = projForOf(WEEKS);
      const base = gainBase({ players, slots: SLOTS, weeks: WEEKS, projFor, floors });
      for (const fa of wire) {
        const fast = gainOf(base, fa);
        const slow = gainOf(base, fa, { prune: false });
        const brute = bruteGain(players, fa, WEEKS, SLOTS, floors);
        checked++;
        if (fast.total > 0) positive++;
        if (fast.total < 0) negative++;
        if (fast.pruned) {
          pruned++;
          if (slow.total !== 0 || slow.weeks.some((w) => w.delta !== 0)) {
            prunedWrong++;
            firstBad = firstBad || `seed ${seed} floor ${withFloor} ${fa.name}: pruned, long way ${slow.total}`;
          }
        }
        if (fast.total !== slow.total) routesDiffer++;
        if (!near(slow.total, brute)) {
          bruteDiffer++;
          firstBad = firstBad || `seed ${seed} floor ${withFloor} ${fa.name}: module ${slow.total}, brute ${brute}`;
        }
        if (!near(round1(slow.weeks.reduce((a, w) => a + w.delta, 0)), slow.total)) rowsOff++;
        if (slow.weeks.some((w) => !near(w.after - w.before, w.delta))) rowsOff++;
        if (Math.abs(slow.perWeek - slow.total / WEEKS.length) > 1e-9) perWeekOff++;
        if (slow.total > 0 && !(slow.drop && players.some((p) => p.playerId === slow.drop.playerId))) dropMissing++;
      }
    }
  }

  ok(checked === 1200, 'random: 6 squads × 100 free agents × floors off and on', String(checked));
  ok(bruteDiffer === 0, 'random: the gain is the best any drop could give (every drop tried, every week filled)',
    `${bruteDiffer} differ — ${firstBad}`);
  ok(prunedWrong === 0, 'PRUNE: every pruned free agent prices at exactly 0 the long way, every week',
    `${prunedWrong} wrong — ${firstBad}`);
  ok(routesDiffer === 0, 'PRUNE: pruned or not, the two routes give one total for every man', String(routesDiffer));
  // Not vacuous: the prune has to fire on most of a wire, and leave real gains.
  ok(pruned > checked * 0.3, 'PRUNE: it fires on a real share of the wire', `${pruned} of ${checked}`);
  ok(positive > 200, 'random: plenty of free agents do gain something', `${positive} of ${checked}`);
  ok(negative === 0, 'random: adding a man never costs points — the cut can always be him', String(negative));
  ok(rowsOff === 0, 'random: the week rows sum to the total, and each is with-him minus now', String(rowsOff));
  ok(perWeekOff === 0, 'random: per week is the total over the weeks priced', String(perWeekOff));
  ok(dropMissing === 0, 'random: a positive gain always names a roster man to drop', String(dropMissing));
  console.log(`  random squads: ${checked} priced, ${positive} gain, ${pruned} pruned`);
}

// 3. Against the exhaustive search — smaller, because it is exponential: three
// weeks, a 13-man squad, and a nine-slot lineup that adds an RB/WR slot to the
// FLEX so two different shared slots are in play at once.
{
  const weeks = [5, 6, 7];
  const slots = [0, 2, 2, 4, 4, 6, 3, 23, 17];
  const plan = ['QB', 'QB', 'RB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE', 'K'];
  let checked = 0;
  let positive = 0;
  let differ = 0;
  let firstBad = '';
  for (let seed = 1; seed <= 2; seed++) {
    const { players, wire } = makeLeague(seed * 104729, weeks, plan);
    const base = gainBase({ players, slots, weeks, projFor: projForOf(weeks) });
    for (const fa of wire.filter((_, i) => i % 3 === 0).slice(0, 30)) {
      const got = gainOf(base, fa).total;
      const want = exhaustiveGain(players, fa, weeks, slots);
      checked++;
      if (got > 0) positive++;
      if (!near(got, want)) {
        differ++;
        firstBad = firstBad || `seed ${seed} ${fa.name}: module ${got}, exhaustive ${want}`;
      }
    }
  }
  ok(checked === 60 && differ === 0, 'exhaustive: with no floor, the gain matches a lineup search that shares no code',
    `${differ} of ${checked} differ — ${firstBad}`);
  ok(positive >= 5, 'exhaustive: and a fair share of those gains are above zero', `${positive} of ${checked}`);
}

// ===========================================================================
// 4b. The demo league — the shapes the page really hands over
// ===========================================================================
//
// Team 1's squad as of week 4, weeks 4-13, every other squad's bench as the
// "wire" (the demo page invents its own free agents; these are real demo men
// with a line in every week).
{
  const weeks = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  const byWeek = new Map(weeks.map((w) => [w, generateDemoWeekRosters(w).teams]));
  const index = new Map(weeks.map((w) => {
    const m = new Map();
    for (const t of byWeek.get(w)) for (const p of t.players) m.set(p.playerId, p.projected);
    return [w, m];
  }));
  const projFor = (p, week) => {
    const v = index.get(week).get(p.playerId);
    return typeof v === 'number' ? v : null;
  };
  const teams = byWeek.get(4);
  const slots = slotsForLeague(slotCountsFromLineups(teams));
  const mine = teams[0].players;
  const wire = teams.slice(1).flatMap((t) => t.bench);
  const floors = positionFloors(wire, { week: 4 });

  for (const fl of [null, floors]) {
    const tag = fl ? 'demo, floored' : 'demo';
    const base = gainBase({ players: mine, slots, weeks, projFor, floors: fl });
    let differ = 0;
    let prunedWrong = 0;
    let pruned = 0;
    let positive = 0;
    for (const fa of wire) {
      const fast = gainOf(base, fa);
      const slow = gainOf(base, fa, { prune: false });
      if (fast.total !== slow.total) differ++;
      if (fast.pruned) { pruned++; if (slow.total !== 0) prunedWrong++; }
      if (fast.total > 0) positive++;
      ok(cannotStart(base, fa) === fast.pruned, `${tag}: pruned says what cannotStart says`, fa.name);
    }
    ok(wire.length > 40, `${tag}: a wire of real size`, String(wire.length));
    ok(differ === 0 && prunedWrong === 0, `${tag}: the prune changes no answer`, `${differ} differ, ${prunedWrong} pruned wrongly`);
    ok(pruned > 0 && positive > 0, `${tag}: some pruned, some gain`, `${pruned} pruned, ${positive} gain of ${wire.length}`);
  }

  // TIMING, printed rather than asserted (the machine is shared): the page
  // works a hundred men through in slices, and this is what the whole job costs.
  const base = gainBase({ players: mine, slots, weeks, projFor, floors });
  let t0 = Date.now();
  for (const fa of wire) gainOf(base, fa);
  const fast = Date.now() - t0;
  t0 = Date.now();
  for (const fa of wire) gainOf(base, fa, { prune: false });
  console.log(`  demo league: ${wire.length} free agents × ${weeks.length} weeks — ${fast} ms pruned, ${Date.now() - t0} ms unpruned`);
}

console.log(`\ntest-waiver-gain: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
