// Checks js/start-sit.js — "Start A over B": the swaps that turn the lineup a
// manager has SET into the best legal one, what each is worth in points, and
// what it adds to the week's win chance.
//
//   node test-start-sit.mjs
//
// The squad is a real one's shape: sixteen men, nine starting slots
// (QB, RB, RB, WR, WR, TE, FLEX, D/ST, K), six on the bench and one on IR.
// Every expected number is written out by hand. The win chances use a spread of
// 10/√2, so the margin's standard deviation is exactly 10 points and a chance
// is Φ(margin / 10), read off a normal table:
//   Φ(0.24) = 0.59483   Φ(0.30) = 0.61791   Φ(0.54) = 0.70540
//   Φ(-0.50) = 0.30854  Φ(-0.26) = 0.39743

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const { startSit, hasPlayed } = await import(pathToFileURL(path.join(REPO, 'js/start-sit.js')).href);

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a, b, name, tol = 5e-5) =>
  ok(typeof a === 'number' && Math.abs(a - b) <= tol, name, `got ${a}, want ${b}`);

const SLOTS = [0, 2, 2, 4, 4, 6, 23, 16, 17];
const LABEL = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 17: 'K', 20: 'BE', 21: 'IR' };
let nextId = 1;
const man = (name, position, lineupSlotId, projected, extra = {}) => ({
  playerId: nextId++, name, position, proTeamId: 12, lineupSlotId, slot: LABEL[lineupSlotId],
  started: lineupSlotId !== 20 && lineupSlotId !== 21,
  projected, actual: null, injuryStatus: 'ACTIVE', ...extra,
});

/** A lineup set exactly right: 119.0 points, nothing on the bench beats a starter. */
function squad(change = {}) {
  const base = {
    qb: man('Josh Allen', 'QB', 0, 22.0),
    rb1: man('Bijan Robinson', 'RB', 2, 18.0),
    rb2: man('Jaylen Warren', 'RB', 2, 12.4),
    wr1: man('Justin Jefferson', 'WR', 4, 16.0),
    wr2: man('Drake London', 'WR', 4, 13.0),
    te: man('Trey McBride', 'TE', 6, 11.0),
    flex: man('Chris Olave', 'WR', 23, 12.6),
    dst: man('Broncos D/ST', 'DST', 16, 6.0),
    k: man('Brandon Aubrey', 'K', 17, 8.0),
    bRb: man('Omarion Hampton', 'RB', 20, 9.0),
    bWr: man('Jakobi Meyers', 'WR', 20, 9.5),
    bTe: man('Dalton Kincaid', 'TE', 20, 7.0),
    bQb: man('Jared Goff', 'QB', 20, 17.0),
    bK: man('Jake Bates', 'K', 20, 7.5),
    bDst: man('Jets D/ST', 'DST', 20, 5.0),
    ir: man('Christian McCaffrey', 'RB', 21, 25.0),
  };
  for (const [k, v] of Object.entries(change)) base[k] = { ...base[k], ...v };
  return base;
}
const list = (s) => Object.values(s);
const names = (r) => r.swaps.map((w) => `${w.in.name} > ${w.out ? w.out.name : '(empty)'}`);

// ------------------------------------------------------------ nothing to say

eq(startSit({ players: null }), null, 'no players: null');
eq(startSit({ players: [] }), null, 'empty squad: null');
eq(startSit({ players: [man('Bench Only', 'RB', 20, 9)] }), null, 'nobody starting: null');

{
  const r = startSit({ players: list(squad()), slots: SLOTS });
  eq(r && r.best, true, 'right lineup: best');
  eq(r && r.swaps, [], 'right lineup: no swaps');
  eq(r && r.setTotal, 119, 'right lineup: set total is the nine starters');
  eq(r && r.gain, 0, 'right lineup: gain 0');
}

// IR is not a lineup choice, however well he projects.
{
  const r = startSit({ players: list(squad()), slots: SLOTS });
  ok(r && !r.swaps.some((w) => /McCaffrey/.test(w.in.name)), 'a man on IR is never offered');
}

// A bench man who projects the SAME as a starter is not a swap.
{
  const r = startSit({ players: list(squad({ bRb: { projected: 12.4 } })), slots: SLOTS });
  eq(r && r.best, true, 'a tie on the bench is not a swap');
}

// ------------------------------------------------------------------ one swap

// Hampton 14.8 on the bench, Warren 12.4 starting: +2.4.
{
  const s = squad({ bRb: { projected: 14.8 } });
  const r = startSit({ players: list(s), slots: SLOTS });
  eq(r && r.best, false, 'one swap: not best');
  eq(names(r), ['Omarion Hampton > Jaylen Warren'], 'one swap: Hampton over Warren');
  eq(r.swaps[0].points, 2.4, 'one swap: +2.4 points, the projection difference');
  eq(r.gain, 2.4, 'one swap: the whole gain is the swap');
  eq(r.swaps[0].win, null, 'one swap: no sigma, no win figure');
  ok(r.swaps[0].in === s.bRb && r.swaps[0].out === s.rb2, 'one swap: the caller’s own player objects come back');
}

// The same swap with a chance: level at 119 v 119, margin sd 10. Before
// Φ(0) = 0.5; after Φ(0.24) = 0.59483. Worth +0.09483.
{
  const r = startSit({
    players: list(squad({ bRb: { projected: 14.8 } })), slots: SLOTS,
    oppPoints: 119, sigma: 10 / Math.SQRT2,
  });
  near(r.swaps[0].win, 0.09483, 'one swap: win is Φ(0.24) − Φ(0)');
}

// The opponent's total matters: 5 points behind, Φ(-0.26) − Φ(-0.50) = 0.08889.
{
  const r = startSit({
    players: list(squad({ bRb: { projected: 14.8 } })), slots: SLOTS,
    oppPoints: 124, sigma: 10 / Math.SQRT2,
  });
  near(r.swaps[0].win, 0.39743 - 0.30854, 'one swap: win is read against the opponent’s total');
}

// Without the league's slots, the squad's own starters say what they are.
{
  const r = startSit({ players: list(squad({ bRb: { projected: 14.8 } })) });
  eq(names(r), ['Omarion Hampton > Jaylen Warren'], 'own slots: the same swap');
}

// ----------------------------------------------------------------- two swaps

// Hampton 14.8 over Warren 12.4 (+2.4) and Goff 25.0 over Allen 22.0 (+3.0):
// biggest first. Win: Φ(0.30) − Φ(0) = 0.11791, then Φ(0.54) − Φ(0.30) = 0.08749.
{
  const r = startSit({
    players: list(squad({ bRb: { projected: 14.8 }, bQb: { projected: 25.0 } })), slots: SLOTS,
    oppPoints: 119, sigma: 10 / Math.SQRT2,
  });
  eq(names(r), ['Jared Goff > Josh Allen', 'Omarion Hampton > Jaylen Warren'], 'two swaps: biggest first');
  eq(r.swaps.map((w) => w.points), [3, 2.4], 'two swaps: +3.0 then +2.4');
  eq(r.gain, 5.4, 'two swaps: gain is the sum');
  near(r.swaps[0].win, 0.11791, 'two swaps: the first is Φ(0.30) − Φ(0)');
  near(r.swaps[1].win, 0.70540 - 0.61791, 'two swaps: the second sits on top of the first');
  near(r.swaps[0].win + r.swaps[1].win, 0.20540, 'two swaps: together they are the whole change');
}

// ------------------------------------------------------------ across the flex

// Meyers (WR, 13.2) on the bench takes a WR slot, London (13.0) drops to the
// FLEX, and the man who leaves the lineup is Olave (12.6): +0.6.
{
  const r = startSit({ players: list(squad({ bWr: { projected: 13.2 } })), slots: SLOTS });
  eq(names(r), ['Jakobi Meyers > Chris Olave'], 'flex: the man who leaves is the weakest, not the one whose slot is taken');
  eq(r.swaps[0].points, 0.6, 'flex: +0.6');
}

// The flex man is the weak one (10.6): a benched RB at 14.8 takes an RB slot,
// Warren (12.4) drops to the FLEX and the WR there sits. RB in, WR out: +4.2,
// not the +2.4 a slot-for-slot reading would give.
{
  const r = startSit({ players: list(squad({ flex: { projected: 10.6 }, bRb: { projected: 14.8 } })), slots: SLOTS });
  eq(names(r), ['Omarion Hampton > Chris Olave'], 'flex: a benched RB over the WR in the flex');
  eq(r.swaps[0].points, 4.2, 'flex: +4.2');
}

// A CHAIN: the TE slot holds a 6.0, the FLEX holds a 15.0 tight end, and an RB
// projected 14.0 sits on the bench. The RB cannot play TE, but the best lineup
// moves the 15.0 to TE and starts the RB in the flex: RB in, the 6.0 TE out, +8.
{
  const s = squad({
    te: { projected: 6.0 },
    flex: { name: 'Brock Bowers', position: 'TE', projected: 15.0 },
    bRb: { projected: 14.0 },
    bTe: { projected: 3.0 },
  });
  const r = startSit({ players: list(s), slots: SLOTS });
  eq(names(r), ['Omarion Hampton > Trey McBride'], 'chain: the man in and the man out, whatever slots move between');
  eq(r.swaps[0].points, 8, 'chain: +8.0');
}

// ------------------------------------------------------------------- locked

ok(hasPlayed({ done: true }) && hasPlayed({ actual: 0 }) && hasPlayed({ actual: 7.2 }), 'hasPlayed: done, or any score');
ok(!hasPlayed({ actual: null, done: false }) && !hasPlayed({}) && !hasPlayed(null), 'hasPlayed: no score, not done');

// The better bench man has already played (his score is in): not offered.
{
  const r = startSit({ players: list(squad({ bRb: { projected: 14.8, actual: 21.3 } })), slots: SLOTS });
  eq(r && r.best, true, 'locked: a bench man who has played is not offered');
}
{
  const r = startSit({ players: list(squad({ bRb: { projected: 21.3, pregame: 9, done: true, actual: 21.3 } })), slots: SLOTS });
  eq(r && r.best, true, 'locked: a finished bench man’s score is not a projection to chase');
}

// The starter he would replace has kicked off: he keeps his slot. Hampton
// (14.8) cannot take Warren's place, but still beats Olave (12.6) in the flex.
{
  const r = startSit({
    players: list(squad({ bRb: { projected: 14.8 }, rb2: { actual: 3.1 } })), slots: SLOTS,
  });
  eq(names(r), ['Omarion Hampton > Chris Olave'], 'locked: a starter who has kicked off is not swapped out');
  eq(r.swaps[0].points, 2.2, 'locked: +2.2 against the flex instead');
}

// And when the flex has kicked off too, there is nowhere for him to go.
{
  const r = startSit({
    players: list(squad({ bRb: { projected: 14.8 }, rb1: { actual: 0 }, rb2: { actual: 3.1 }, flex: { actual: 1 } })),
    slots: SLOTS,
  });
  eq(r && r.best, true, 'locked: both RB slots and the flex gone, no swap');
}

// The caller's own rule (a kickoff time) locks a man the reading does not.
{
  const s = squad({ bRb: { projected: 14.8 } });
  const r = startSit({ players: list(s), slots: SLOTS, isLocked: (p) => p === s.bRb });
  eq(r && r.best, true, 'locked: the caller’s rule is the rule');
}

// Every starter kicked off: nothing can be moved, so nothing is said.
{
  const s = squad();
  eq(startSit({ players: list(s), slots: SLOTS, isLocked: (p) => p.started }), null, 'every starter locked: null');
}

// -------------------------------------------------------------- odd lineups

// A starter on bye (0.0) with a kicker on the bench.
{
  const r = startSit({ players: list(squad({ k: { projected: 0 } })), slots: SLOTS });
  eq(names(r), ['Jake Bates > Brandon Aubrey'], 'bye: the bench kicker over the one projecting 0');
  eq(r.swaps[0].points, 7.5, 'bye: +7.5');
}

// A starter ESPN has no projection for counts as 0, never as missing.
{
  const r = startSit({ players: list(squad({ k: { projected: null } })), slots: SLOTS });
  eq(names(r), ['Jake Bates > Brandon Aubrey'], 'no projection: he is the one to sit');
  eq(r.setTotal, 111, 'no projection: the set total leaves him out');
}

// A bench man with no projection is nobody to start.
{
  const r = startSit({ players: list(squad({ bRb: { projected: null } })), slots: SLOTS });
  eq(r && r.best, true, 'no projection on the bench: not offered');
}

// A slot left EMPTY (the league starts nine, this squad set eight): the best
// man who fits goes in, and nobody comes out.
{
  const s = squad();
  const players = list(s).filter((p) => p !== s.k);
  const r = startSit({ players, slots: SLOTS });
  eq(names(r), ['Jake Bates > (empty)'], 'empty slot: the bench kicker fills it');
  eq(r.swaps[0].points, 7.5, 'empty slot: worth his whole projection');
  // Read off the squad's own lineup alone, an empty slot cannot be seen.
  eq(startSit({ players }).best, true, 'empty slot: invisible without the league’s slots');
}

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nAll ${pass} checks passed`);
process.exit(fail ? 1 : 0);
