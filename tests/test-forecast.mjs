// Checks js/forecast.js against known-good values and brute force.
import {
  normalCdf, winProbability, calibrateSigma, optimalLineup,
  winTotalDistribution, expectedWins, credibleRange, slotsFromCounts,
  DEFAULT_SIGMA, DEFAULT_SLOTS,
} from '../js/forecast.js';

let pass = 0, fail = 0;
const close = (a, b, tol, msg) => {
  if (Math.abs(a - b) <= tol) { pass++; }
  else { fail++; console.log(`FAIL ${msg}: got ${a}, want ${b} (tol ${tol})`); }
};
const eq = (a, b, msg) => {
  if (Object.is(a, b)) { pass++; }
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

// ---- normalCdf against textbook values
close(normalCdf(0), 0.5, 1e-9, 'cdf(0)');
close(normalCdf(1), 0.8413447, 1e-6, 'cdf(1)');
close(normalCdf(-1), 0.1586553, 1e-6, 'cdf(-1)');
close(normalCdf(1.96), 0.9750021, 1e-6, 'cdf(1.96)');
close(normalCdf(-2.5758), 0.005, 1e-5, 'cdf(-2.5758)');
close(normalCdf(3), 0.9986501, 1e-6, 'cdf(3)');
// symmetry
for (const x of [0.3, 1.1, 2.2, 3.4]) {
  close(normalCdf(x) + normalCdf(-x), 1, 1e-9, `symmetry at ${x}`);
}

// ---- winProbability
close(winProbability(100, 100, 27), 0.5, 1e-9, 'equal projections => 50%');
// a 10-point edge with sigma 27: 10/(27*sqrt2)=0.2619 -> 0.6033
close(winProbability(110, 100, 27), 0.6033, 1e-3, '10pt edge');
// complementary
const pa = winProbability(118, 104, 27), pb = winProbability(104, 118, 27);
close(pa + pb, 1, 1e-9, 'complementary');
// bigger sigma pulls toward 50%
if (Math.abs(winProbability(110, 100, 40) - 0.5) < Math.abs(winProbability(110, 100, 20) - 0.5)) pass++;
else { fail++; console.log('FAIL more noise should move toward 50%'); }
eq(winProbability(110, null, 27), null, 'null projection');
eq(winProbability(110, 100, 0), null, 'zero sigma');
eq(winProbability(110, 100, NaN), null, 'NaN sigma');

// ---- calibrateSigma
eq(calibrateSigma([]).calibrated, false, 'no games => uncalibrated');
eq(calibrateSigma([]).sigma, DEFAULT_SIGMA, 'no games => default sigma');

// Build residuals with a known SD. Use a symmetric set so the sample SD is exact.
const mk = (residual, i) => ({
  homeActual: 100 + residual, homeProjected: 100,
  awayActual: 100 - residual, awayProjected: 100,
});
const games = [];
for (let i = 0; i < 10; i++) games.push(mk(10));   // residuals +10 and -10, 20 of them
const cal = calibrateSigma(games);
eq(cal.calibrated, true, 'enough games => calibrated');
eq(cal.sample, 20, 'sample counts both sides');
// residuals are ten +10 and ten -10; mean 0, sample variance = 20*100/19
close(cal.sigma, Math.sqrt(2000 / 19), 1e-9, 'sample sigma');

// Projections of 0 are excluded (missing data, not a real projection)
const withZeros = [{ homeActual: 100, homeProjected: 0, awayActual: 90, awayProjected: 0 }];
eq(calibrateSigma(withZeros).sample, 0, 'zero projections excluded');

// ---- optimalLineup
const roster = [
  { name: 'QB1', position: 'QB', projected: 22 },
  { name: 'QB2', position: 'QB', projected: 19 },
  { name: 'RB1', position: 'RB', projected: 18 },
  { name: 'RB2', position: 'RB', projected: 14 },
  { name: 'RB3', position: 'RB', projected: 13 },
  { name: 'WR1', position: 'WR', projected: 17 },
  { name: 'WR2', position: 'WR', projected: 15 },
  { name: 'WR3', position: 'WR', projected: 11 },
  { name: 'TE1', position: 'TE', projected: 9 },
  { name: 'K1',  position: 'K',  projected: 8 },
  { name: 'D1',  position: 'DST', projected: 7 },
];
// A classic 9-slot lineup (1QB 2RB 2WR 1TE 1FLEX 1DST 1K), stated explicitly
// rather than leaning on DEFAULT_SLOTS, so this stays a hand-checked case.
const NINE = [0, 2, 2, 4, 4, 6, 23, 16, 17];
const lu = optimalLineup(roster, NINE);
eq(lu.starters.length, 9, 'nine starters');
const names = lu.starters.map((s) => s.name).sort();
// QB1, RB1, RB2, WR1, WR2, TE1, FLEX=RB3(13) beats WR3(11), K1, D1
eq(names.join(','), ['D1','K1','QB1','RB1','RB2','RB3','TE1','WR1','WR2'].sort().join(','), 'optimal picks');
close(lu.total, 22+18+14+17+15+9+13+8+7, 1e-9, 'optimal total');

// The flex must never take a QB
const flexPlayer = lu.starters.find((s) => s.slotId === 23);
eq(flexPlayer.position === 'QB', false, 'flex is never a QB');
eq(flexPlayer.name, 'RB3', 'flex takes best remaining RB/WR/TE');

// Brute force: optimal really is the max over all valid assignments
function bruteForce(players, slots) {
  let best = 0;
  const used = new Array(players.length).fill(false);
  const rec = (si, total) => {
    if (si === slots.length) { best = Math.max(best, total); return; }
    const elig = { 0:['QB'],2:['RB'],4:['WR'],6:['TE'],16:['DST'],17:['K'],23:['RB','WR','TE'],7:['QB','RB','WR','TE'] }[slots[si]];
    let any = false;
    for (let i = 0; i < players.length; i++) {
      if (used[i] || !elig.includes(players[i].position)) continue;
      any = true; used[i] = true;
      rec(si + 1, total + players[i].projected);
      used[i] = false;
    }
    if (!any) rec(si + 1, total);
  };
  rec(0, 0);
  return best;
}
close(lu.total, bruteForce(roster, NINE), 1e-9, 'matches brute force');

// Random rosters vs brute force
let rngState = 42;
const rnd = () => (rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const POS = ['QB','RB','WR','TE','K','DST'];
for (let trial = 0; trial < 200; trial++) {
  const r = [];
  const n = 8 + Math.floor(rnd() * 8);
  for (let i = 0; i < n; i++) {
    r.push({ name: 'p' + i, position: POS[Math.floor(rnd() * POS.length)], projected: Math.round(rnd() * 30 * 10) / 10 });
  }
  const got = optimalLineup(r, DEFAULT_SLOTS).total;
  const want = Math.round(bruteForce(r, DEFAULT_SLOTS) * 10) / 10;
  if (Math.abs(got - want) > 1e-6) {
    fail++; console.log(`FAIL brute force trial ${trial}: got ${got}, want ${want}`);
    break;
  }
}
pass++;

// Short rosters don't throw
eq(optimalLineup([], DEFAULT_SLOTS).total, 0, 'empty roster');
eq(optimalLineup([{ position: 'QB', projected: 10 }], DEFAULT_SLOTS).starters.length, 1, 'one player');
eq(optimalLineup([{ position: 'QB', projected: NaN }], DEFAULT_SLOTS).starters.length, 0, 'NaN projection dropped');


// ---- slotsFromCounts: the real league shape (1QB 2RB 3WR 1TE 1FLEX 1DST 1K)
const realCounts = { 0: 1, 2: 2, 4: 3, 6: 1, 16: 1, 17: 1, 23: 1 };
const realSlots = slotsFromCounts(realCounts);
eq(realSlots.length, 10, 'real league starts ten');
eq(realSlots.filter((s) => s === 4).length, 3, 'three WR slots');
eq(realSlots.filter((s) => s === 2).length, 2, 'two RB slots');
eq(slotsFromCounts(null).join(','), DEFAULT_SLOTS.join(','), 'null counts => default');
eq(slotsFromCounts({}).join(','), DEFAULT_SLOTS.join(','), 'empty counts => default');

// The real shape must still be optimal, and its flex still never a QB
const luReal = optimalLineup(roster, realSlots);
close(luReal.total, bruteForce(roster, realSlots), 1e-9, 'real shape matches brute force');
eq(luReal.starters.find((s) => s.slotId === 23).position === 'QB', false, 'real flex not a QB');

// Superflex (slot 7) MAY take a QB, and should when the QB is best
const sfSlots = [0, 2, 4, 7];
const sf = optimalLineup(roster, sfSlots);
close(sf.total, bruteForce(roster, sfSlots), 1e-9, 'superflex matches brute force');
eq(sf.starters.find((s) => s.slotId === 7).name, 'QB2', 'superflex takes the second QB');

// Random rosters against the real ten-slot shape too
for (let trial = 0; trial < 150; trial++) {
  const r = [];
  const n = 9 + Math.floor(rnd() * 9);
  for (let i = 0; i < n; i++) {
    r.push({ name: 'q' + i, position: POS[Math.floor(rnd() * POS.length)], projected: Math.round(rnd() * 30 * 10) / 10 });
  }
  const got = optimalLineup(r, realSlots).total;
  const want = Math.round(bruteForce(r, realSlots) * 10) / 10;
  if (Math.abs(got - want) > 1e-6) {
    fail++; console.log(`FAIL real-shape trial ${trial}: got ${got}, want ${want}`);
    break;
  }
}
pass++;

// ---- winTotalDistribution
const d0 = winTotalDistribution([], 3);
eq(d0.length, 1, 'no games => single outcome');
eq(d0[0].wins, 3, 'banked wins carried');
close(d0[0].p, 1, 1e-12, 'probability 1');

// All certain wins
const dCertain = winTotalDistribution([1, 1, 1], 2);
eq(dCertain.length, 4, 'three games => four outcomes');
close(dCertain[3].p, 1, 1e-12, 'certain wins land on max');
eq(dCertain[3].wins, 5, 'banked + 3');

// Fair coins: binomial
const dFair = winTotalDistribution([0.5, 0.5, 0.5, 0.5], 0);
const binom = [1/16, 4/16, 6/16, 4/16, 1/16];
for (let k = 0; k < 5; k++) close(dFair[k].p, binom[k], 1e-12, `binomial k=${k}`);

// Distribution always sums to 1
for (const probs of [[0.2,0.7,0.55],[0.1,0.9],[0.33,0.33,0.33,0.99,0.01]]) {
  const d = winTotalDistribution(probs, 1);
  close(d.reduce((a, x) => a + x.p, 0), 1, 1e-12, `sums to 1 for ${probs}`);
}

// Poisson-binomial against brute force enumeration
const ps = [0.2, 0.45, 0.8, 0.61, 0.15];
const dPb = winTotalDistribution(ps, 0);
const bf = new Array(ps.length + 1).fill(0);
for (let mask = 0; mask < (1 << ps.length); mask++) {
  let p = 1, k = 0;
  for (let i = 0; i < ps.length; i++) {
    if (mask & (1 << i)) { p *= ps[i]; k++; } else p *= 1 - ps[i];
  }
  bf[k] += p;
}
for (let k = 0; k <= ps.length; k++) close(dPb[k].p, bf[k], 1e-12, `poisson-binomial k=${k}`);

// expectedWins matches the distribution's mean
const meanFromDist = dPb.reduce((a, x) => a + x.wins * x.p, 0);
close(expectedWins(ps, 0), Math.round(meanFromDist * 10) / 10, 1e-9, 'expectedWins == mean');

// ---- credibleRange
const r80 = credibleRange(dFair, 0.8);
if (r80 && r80.p >= 0.8) pass++; else { fail++; console.log('FAIL credibleRange mass'); }
if (r80.lo <= 2 && r80.hi >= 2) pass++; else { fail++; console.log('FAIL credibleRange brackets mode'); }
eq(credibleRange([], 0.8), null, 'empty distribution');
// a certain outcome is a zero-width range
const rc = credibleRange(dCertain, 0.8);
eq(rc.lo, rc.hi, 'certain outcome => single value');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
