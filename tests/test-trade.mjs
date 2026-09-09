// The trade engine: replacement levels, the depth map, and the finder.
//
//   node test-trade.mjs
//
// Two fixtures, deliberately. A hand-built league where every answer is known
// by hand — small enough that a wrong number is obvious rather than plausible —
// and then the real `demo-rosters.js`, where the assertions are about
// INVARIANTS rather than values, because nobody can check 160 players by eye.
//
// The invariants are the ones that would let a broken engine still look fine:
// that a trade the finder offers really does raise both totals when you re-fill
// the lineups yourself, that a package never leaves a roster bigger than it
// started, and that the depth map's arithmetic agrees with the lineup it claims
// to describe.

import { generateDemoWeekRosters } from '../js/demo-rosters.js';
import { slotCountsFromLineups } from '../js/projection.js';
import { optimalLineup } from '../js/forecast.js';
import {
  typicalWeek, weekProjection, lineupValue, dedicatedSlots, slotsForLeague,
  replacementLevels, depthTable, findTrades, PACKAGE_KINDS, POSITIONS_IN_ORDER,
} from '../js/trade.js';

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 220)}` : ''}`);
};
const eq = (a, b, msg) => ok(msg, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const close = (a, b, tol, msg) =>
  ok(msg, Number.isFinite(a) && Math.abs(a - b) <= tol, `got ${a}, want ${b}`);

// ===========================================================================
// Fixture 1 — a two-team league with exactly one sensible trade in it
// ===========================================================================
//
// Slots: 1 QB, 1 RB, 1 WR. No flex, so nothing can hide in one.
//
//   A is stacked at RB (20, 18) and bare at WR (6, 5)
//   B is the mirror image: bare at RB (6, 5), stacked at WR (20, 18)
//
// Both field 46 points. A's 18-point back and B's 18-point receiver are both
// on the bench scoring nothing, and swapping them makes both squads 12 points
// better. That is the whole thesis of the page, in a case small enough to
// check by hand.

const STUB_SLOTS = [0, 2, 4];
let nextId = 1000;

function man(name, position, value, slotId) {
  return {
    playerId: nextId++,
    name,
    position,
    lineupSlotId: slotId,
    started: slotId !== 20,
    seasonProjected: value * 17, // so typicalWeek() gives back exactly `value`
    projected: value,
  };
}

function squad(id, name, players) {
  return {
    id,
    name,
    players,
    starters: players.filter((p) => p.started),
    bench: players.filter((p) => !p.started),
  };
}

const A = squad(1, 'A', [
  man('A-qb', 'QB', 20, 0),
  man('A-rb1', 'RB', 20, 2),
  man('A-rb2', 'RB', 18, 20),
  man('A-wr1', 'WR', 6, 4),
  man('A-wr2', 'WR', 5, 20),
]);
const B = squad(2, 'B', [
  man('B-qb', 'QB', 20, 0),
  man('B-rb1', 'RB', 6, 2),
  man('B-rb2', 'RB', 5, 20),
  man('B-wr1', 'WR', 20, 4),
  man('B-wr2', 'WR', 18, 20),
]);
const STUB = [A, B];

// ---- the measures ---------------------------------------------------------

close(typicalWeek({ seasonProjected: 170, projected: 3 }), 10, 1e-9,
  'typicalWeek divides the season projection by 17');
close(typicalWeek({ seasonProjected: 0, projected: 7.5 }), 7.5, 1e-9,
  'typicalWeek falls back to the week when there is no season line');
eq(typicalWeek({ seasonProjected: null, projected: null }), null,
  'typicalWeek has no opinion when ESPN has no number');
close(weekProjection({ seasonProjected: 170, projected: 3 }), 3, 1e-9,
  'weekProjection ignores the season line entirely');

// A bye is a 0.00 in the week and untouched in the season average. That is
// exactly why the typical week is the default: pricing a trade on a week one
// side happens to be off is nonsense.
close(typicalWeek({ seasonProjected: 170, projected: 0 }), 10, 1e-9,
  'a bye does not dent a player’s typical week');
close(weekProjection({ seasonProjected: 170, projected: 0 }), 0, 1e-9,
  'a bye is a zero in the selected week, which is the truth about that week');

// ---- slots ----------------------------------------------------------------

const need = dedicatedSlots([0, 2, 2, 4, 4, 4, 6, 23, 16, 17]);
eq(need.RB, 2, 'two dedicated RB slots');
eq(need.WR, 3, 'three dedicated WR slots');
eq(need.QB, 1, 'one dedicated QB slot');
ok('the flex is not counted towards any position', need.FLEX === undefined,
  JSON.stringify(need));
eq(dedicatedSlots([23, 23]).RB, undefined, 'two flexes demand no RB outright');
eq(slotsForLeague(null).length, 10, 'no counts falls back to a stated ten-man default');

// ---- lineup value ---------------------------------------------------------

close(lineupValue(A.players, STUB_SLOTS, typicalWeek).total, 46, 1e-9, 'A fields 46');
close(lineupValue(B.players, STUB_SLOTS, typicalWeek).total, 46, 1e-9, 'B fields 46');
ok('A leaves its 18-point back on the bench',
  !lineupValue(A.players, STUB_SLOTS, typicalWeek).starters.some((s) => s.name === 'A-rb2'));

// ---- replacement level ----------------------------------------------------

const bars = replacementLevels(STUB, STUB_SLOTS, typicalWeek);
// Four RBs in the league (20, 18, 6, 5) and two of them start, so the bar is
// the third best: 6.
close(bars.get('RB').value, 6, 1e-9, 'the RB bar is the best back nobody starts');
close(bars.get('WR').value, 6, 1e-9, 'the WR bar is the mirror of it');
eq(bars.get('RB').startedInLeague, 2, 'two backs start in a two-team league');
eq(bars.get('RB').pooled, 4, 'four backs exist');
eq(bars.get('RB').exhausted, false, 'there are spare backs, so the bar is a real man');
// Both quarterbacks start, so there is nobody left to set a bar with.
eq(bars.get('QB').exhausted, true, 'QB is exhausted — every one of them is starting');
eq(bars.has('TE'), false, 'a position nobody rosters gets no bar at all');

// ---- the depth map --------------------------------------------------------

const map = depthTable(STUB, STUB_SLOTS, typicalWeek);
eq(map.positions.join(','), 'QB,RB,WR', 'only the positions this league has');
ok('positions come back in lineup order, not alphabetical',
  POSITIONS_IN_ORDER.indexOf('RB') < POSITIONS_IN_ORDER.indexOf('WR'));

const aCells = map.rows.find((r) => r.team.id === 1).cells;
const bCells = map.rows.find((r) => r.team.id === 2).cells;

eq(aCells.get('RB').net, 1, 'A has one startable back more than he can field');
eq(aCells.get('WR').net, -1, 'A is a receiver short');
eq(bCells.get('RB').net, -1, 'B is a back short');
eq(bCells.get('WR').net, 1, 'B has a spare receiver');

// THE BUG THIS CAUGHT. Both squads carry exactly one quarterback and both
// start him, so the position is exhausted and the bar falls back to the worst
// starter. A strict "above the bar" test then ruled that very man out of being
// startable and reported BOTH managers as short at QB — a hole at a position
// each of them has perfectly well filled.
eq(aCells.get('QB').net, 0, 'A is not short at QB');
eq(bCells.get('QB').net, 0, 'B is not short at QB');

// Points, not bodies: A's starting back is 14 clear of the bar, and his spare
// is 12 clear of it.
close(aCells.get('RB').startersEdge, 14, 1e-9, 'A’s starting back is 14 above replacement');
close(aCells.get('RB').surplusEdge, 12, 1e-9, 'A’s spare back is worth 12 above replacement');
close(aCells.get('WR').startersEdge, 0, 1e-9, 'A’s receiver IS replacement level');
close(aCells.get('WR').surplusEdge, 0, 1e-9, 'surplus is never negative');

// An empty slot is not neutral: it is the whole bar against you.
const noKicker = squad(3, 'C', [man('C-qb', 'QB', 10, 0)]);
const withKicker = squad(4, 'D', [man('D-qb', 'QB', 10, 0), man('D-k', 'K', 9, 17)]);
const kMap = depthTable([noKicker, withKicker], [0, 17], typicalWeek);
const cK = kMap.rows.find((r) => r.team.id === 3).cells.get('K');
eq(cK.net, -1, 'a manager with no kicker is a man short at kicker');
close(cK.startersEdge, -9, 1e-9, 'and it costs him the whole bar, not nothing');

// The map's own arithmetic has to agree with the lineup it describes.
for (const row of map.rows) {
  const summed = [...row.cells.values()]
    .filter((c) => Number.isFinite(c.starting))
    .reduce((a, c) => a + c.starting, 0);
  eq(summed, row.lineup.starters.length,
    `${row.team.name}: the cells account for every starter`);
}

// ---- the finder, on a case with a known answer ----------------------------

const stubFound = findTrades({ teams: STUB, myTeamId: 1, slots: STUB_SLOTS, measure: typicalWeek });
ok('the obvious win-win is found', stubFound.offers.length > 0, `${stubFound.offers.length} offers`);

const evenOnly = findTrades({
  teams: STUB, myTeamId: 1, slots: STUB_SLOTS, measure: typicalWeek, kinds: ['even'],
});
ok('and it is available as a straight swap', evenOnly.offers.length >= 1,
  `${evenOnly.offers.length} straight swaps`);
ok('every straight swap really is one for one',
  evenOnly.offers.every((o) => o.send.length === 1 && o.receive.length === 1));

const mirror = evenOnly.offers.find(
  (o) => o.send[0].name === 'A-rb2' && o.receive[0].name === 'B-wr2'
);
ok('the mirrored 18-for-18 swap is offered', !!mirror,
  evenOnly.offers.map((o) => `${o.send[0].name}->${o.receive[0].name}`).join(' '));
if (mirror) {
  close(mirror.myGain, 12, 1e-9, 'it is worth 12 to A');
  close(mirror.theirGain, 12, 1e-9, 'and exactly 12 to B — the deal is symmetric');
  close(mirror.myBefore, 46, 1e-9, 'A starts from 46');
  close(mirror.myAfter, 58, 1e-9, 'and ends at 58');
  eq(mirror.kind, 'even', 'a one-for-one is an even package');
  eq(mirror.shape, '1-for-1', 'and says so');
  // What the deal DOES, in names: his 18-point back walks into the lineup and
  // the 6-point receiver walks out.
  eq(mirror.yourChurn.in.map((s) => s.name).join(','), 'B-wr2', 'B-wr2 starts for A');
  eq(mirror.yourChurn.out.map((s) => s.name).join(','), 'A-wr1', 'A-wr1 drops out');
}

// The redundancy filter: the same trade with a spare body bolted on is not a
// second trade. Before it existed this stub returned six rows that were all
// two deals wearing different junk.
ok('an offer is never a superset of another equally good one',
  stubFound.offers.every((o) =>
    !stubFound.offers.some(
      (other) =>
        other !== o &&
        other.partner.id === o.partner.id &&
        other.send.length + other.receive.length < o.send.length + o.receive.length &&
        other.send.every((p) => o.send.some((q) => q.playerId === p.playerId)) &&
        other.receive.every((p) => o.receive.some((q) => q.playerId === p.playerId)) &&
        other.myGain >= o.myGain &&
        other.theirGain >= o.theirGain
    )
  ),
  stubFound.offers.map((o) => `${o.shape} ${o.myGain}/${o.theirGain}`).join(' | '));

// A team that is not in the league gets an empty answer, not a crash.
const nobody = findTrades({ teams: STUB, myTeamId: 99, slots: STUB_SLOTS, measure: typicalWeek });
eq(nobody.offers.length, 0, 'an unknown team finds nothing');
eq(nobody.mine, null, 'and is reported as unknown rather than guessed at');
eq(findTrades({ teams: [], myTeamId: 1, slots: STUB_SLOTS }).offers.length, 0,
  'an empty league finds nothing');

// ===========================================================================
// Fixture 2 — the real demo league. Invariants, re-derived independently.
// ===========================================================================

const { teams } = generateDemoWeekRosters(4);
const slots = slotsForLeague(slotCountsFromLineups(teams));
eq(teams.length, 10, 'ten demo squads');
ok('the slot shape came off the lineups', slots.length >= 9, `${slots.length} slots`);

const demoMap = depthTable(teams, slots, typicalWeek);
eq(demoMap.rows.length, 10, 'a row per squad');

for (const row of demoMap.rows) {
  for (const cell of row.cells.values()) {
    ok(`${row.team.name} ${cell.position}: surplus is never negative`, cell.surplusEdge >= 0,
      `${cell.surplusEdge}`);
    ok(`${row.team.name} ${cell.position}: net agrees with its own counts`,
      cell.net === cell.startable - cell.needed,
      `${cell.net} vs ${cell.startable} - ${cell.needed}`);
    ok(`${row.team.name} ${cell.position}: a spare man is never in the lineup`,
      !cell.spare || !row.lineup.starters.some((s) => s.playerId === cell.spare.p.playerId));
  }
  // The row's total is the same lineup the analysis page would fill.
  close(row.total, lineupValue(row.team.players, slots, typicalWeek).total, 1e-9,
    `${row.team.name}: the row total is the squad's best lineup`);
}

// Nobody can be deep and thin at once, and the league's surplus has to sit
// somewhere — a position where every squad had a spare would mean the bar was
// set wrong.
for (const position of demoMap.positions) {
  const spares = demoMap.rows.filter((r) => r.cells.get(position).net > 0).length;
  ok(`not every squad has a spare ${position}`, spares < demoMap.rows.length,
    `${spares} of ${demoMap.rows.length}`);
}

// ---- the finder against the real pool -------------------------------------
//
// THE ASSERTION THAT MATTERS. Every offer is re-priced here from the raw
// rosters — not read back off the offer's own numbers — so an engine that
// merely reported confident figures would fail rather than agree with itself.

function refill(team, outgoing, incoming) {
  const gone = new Set(outgoing.map((p) => p.playerId));
  const kept = team.players.filter((p) => !gone.has(p.playerId));
  const joined = incoming.map((p) => team.players.find((q) => q.playerId === p.playerId) || p);
  const all = kept.concat(joined);

  // The same forced cut the engine models: over the limit, the worst man goes.
  const over = all.length - team.players.length;
  if (over > 0) {
    const ranked = [...all].sort(
      (a, b) => (typicalWeek(a) ?? -Infinity) - (typicalWeek(b) ?? -Infinity)
    );
    const cut = new Set(ranked.slice(0, over));
    return all.filter((p) => !cut.has(p));
  }
  return all;
}

let checked = 0;
for (const me of teams) {
  const res = findTrades({ teams, myTeamId: me.id, slots, measure: typicalWeek });
  ok(`${me.name}: the finder returns something it can explain`,
    res.offers.every((o) => o.partner && o.partner.id !== me.id),
    'an offer with no partner, or with yourself');

  for (const o of res.offers) {
    checked++;
    const partner = teams.find((t) => t.id === o.partner.id);

    // Re-price both sides from scratch.
    const myAfter = lineupValue(refill(me, o.send, o.receive), slots, typicalWeek).total;
    const theirAfter = lineupValue(refill(partner, o.receive, o.send), slots, typicalWeek).total;
    const myBefore = lineupValue(me.players, slots, typicalWeek).total;
    const theirBefore = lineupValue(partner.players, slots, typicalWeek).total;

    close(o.myBefore, myBefore, 0.05, `${me.name}: the stated "before" is his real lineup`);
    close(o.myAfter, myAfter, 0.05, `${me.name}: the stated "after" re-fills to the same total`);
    close(o.theirAfter, theirAfter, 0.05, `${o.partner.name}: his "after" re-fills the same`);

    ok(`${me.name}: the offer really does raise HIS total`, myAfter - myBefore > 0.05,
      `${myBefore} -> ${myAfter}`);
    ok(`${me.name}: and it really does raise the PARTNER's`, theirAfter - theirBefore > 0.05,
      `${theirBefore} -> ${theirAfter} (${o.partner.name})`);

    // Nobody sends a player they do not own, or receives one the partner does
    // not have. A package built off the wrong roster would still add up.
    ok(`${me.name}: everything sent is his`,
      o.send.every((p) => me.players.some((q) => q.playerId === p.playerId)));
    ok(`${o.partner.name}: everything received is his`,
      o.receive.every((p) => partner.players.some((q) => q.playerId === p.playerId)));

    // Roster legality, both ways.
    ok(`${me.name}: the trade leaves him no bigger than he started`,
      refill(me, o.send, o.receive).length <= me.players.length);
    ok(`${o.partner.name}: same for him`,
      refill(partner, o.receive, o.send).length <= partner.players.length);

    ok(`${me.name}: the package shape is labelled correctly`,
      o.shape === `${o.send.length}-for-${o.receive.length}` &&
      PACKAGE_KINDS.includes(o.kind));

    // The churn has to account for the change: what walks in minus what walks
    // out IS the gain, or the two lists are decoration.
    const inSum = o.yourChurn.in.reduce((a, s) => a + s.value, 0);
    const outSum = o.yourChurn.out.reduce((a, s) => a + s.value, 0);
    close(inSum - outSum, o.myGain, 0.15,
      `${me.name}: the in/out lists add up to the stated gain`);
  }
}
ok('enough real offers were re-priced to mean something', checked >= 20, `${checked} checked`);

// ---- the shape filter is a search option, not a post-filter ---------------
//
// Straight swaps have to be searched FOR. `bestPerTarget` keeps one offer per
// man acquired, so a 1-for-1 and a 2-for-1 bringing in the same player compete
// for one row and the bigger package usually wins it — filter afterwards and
// the straight swap is already gone.

for (const kind of PACKAGE_KINDS) {
  for (const me of teams.slice(0, 3)) {
    const res = findTrades({
      teams, myTeamId: me.id, slots, measure: typicalWeek, kinds: [kind],
    });
    ok(`${me.name}: searching ${kind} returns only ${kind} packages`,
      res.offers.every((o) => o.kind === kind),
      res.offers.map((o) => o.kind).join(','));
  }
}

{
  // A team with a genuine surplus, searched two ways. The narrowed search must
  // never be a subset of "whatever the wide search happened to leave".
  const wide = findTrades({ teams, myTeamId: teams[0].id, slots, measure: typicalWeek });
  const narrow = findTrades({
    teams, myTeamId: teams[0].id, slots, measure: typicalWeek, kinds: ['consolidate'],
  });
  ok('a narrowed search is run, not filtered from the wide one',
    narrow.offers.every((o) => o.kind === 'consolidate') &&
    narrow.offers.length >= wide.offers.filter((o) => o.kind === 'consolidate').length,
    `${narrow.offers.length} narrowed vs ${wide.offers.filter((o) => o.kind === 'consolidate').length} in the wide set`);
}

// ---- the week measure works too -------------------------------------------

const weekMap = depthTable(teams, slots, weekProjection);
eq(weekMap.rows.length, 10, 'the depth map builds on the week measure as well');
ok('the two measures do not give identical squad totals',
  weekMap.rows.some((r, i) => Math.abs(r.total - demoMap.rows[i].total) > 0.05),
  'the measure toggle changes nothing, which means one of them is ignored');

const weekFound = findTrades({
  teams, myTeamId: teams[0].id, slots, measure: weekProjection, kinds: PACKAGE_KINDS,
});
ok('the finder runs on the week measure without falling over',
  Array.isArray(weekFound.offers));

// ---- optimalLineup is shared, not reimplemented ---------------------------
//
// The whole reason `lineupValue` is a thin wrapper is that the trade page and
// the season forecast must never disagree about what a squad is worth.
{
  const t = teams[0];
  const direct = optimalLineup(
    t.players.map((p) => ({ ...p, projected: typicalWeek(p) })), slots
  );
  close(lineupValue(t.players, slots, typicalWeek).total, direct.total, 1e-9,
    'lineupValue is forecast.js’s optimalLineup and nothing else');
}

// ---------------------------------------------------------------------------

if (fails.length) {
  for (const f of fails.slice(0, 25)) console.log('FAIL ' + f);
  if (fails.length > 25) console.log(`… and ${fails.length - 25} more`);
}
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
