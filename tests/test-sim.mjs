// Checks the season simulator: RNG quality, self-consistency with the analytic
// win probability, exact agreement on cases with a known answer, and the
// league's points-for tiebreak.
import {
  makeRng, makeNormal, simulateSeason, winProbability, winTotalDistribution,
} from '../js/forecast.js';

let pass = 0, fail = 0;
const close = (a, b, tol, msg) => {
  if (Math.abs(a - b) <= tol) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${a}, want ${b} (tol ${tol})`); }
};
const ok = (cond, msg, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};

// ---------- RNG ----------
const r1 = makeRng(42), r2 = makeRng(42), r3 = makeRng(43);
const a = Array.from({ length: 5 }, () => r1());
const b = Array.from({ length: 5 }, () => r2());
ok(a.join(',') === b.join(','), 'same seed gives the same stream');
ok(a.join(',') !== Array.from({ length: 5 }, () => r3()).join(','), 'different seed differs');
ok(a.every((x) => x >= 0 && x < 1), 'rng stays in [0,1)');

// mean/variance of the uniform
const rr = makeRng(7);
let s = 0, s2 = 0, N = 200000;
for (let i = 0; i < N; i++) { const v = rr(); s += v; s2 += v * v; }
close(s / N, 0.5, 0.005, 'uniform mean');
close(s2 / N - (s / N) ** 2, 1 / 12, 0.005, 'uniform variance');

// ---------- normal ----------
const nrm = makeNormal(makeRng(11));
let ns = 0, ns2 = 0, n4 = 0;
N = 200000;
for (let i = 0; i < N; i++) { const z = nrm(); ns += z; ns2 += z * z; n4 += z * z * z * z; }
close(ns / N, 0, 0.01, 'normal mean 0');
close(ns2 / N, 1, 0.02, 'normal variance 1');
close(n4 / N, 3, 0.15, 'normal kurtosis 3');

// ---------- one game: the simulator must reproduce winProbability ----------
// Two teams, one game. P(home wins) should match the analytic formula.
for (const [hp, ap, sigma] of [[110, 100, 27], [120, 100, 27], [100, 100, 30], [95, 118, 24]]) {
  const res = simulateSeason({
    teamIds: [1, 2],
    banked: new Map([[1, { wins: 0, pointsFor: 0 }], [2, { wins: 0, pointsFor: 0 }]]),
    games: [{ homeId: 1, awayId: 2, homeProj: hp, awayProj: ap }],
    sigma, runs: 60000, seed: 5,
  });
  const home = res.teams.find((t) => t.teamId === 1);
  const analytic = winProbability(hp, ap, sigma);
  // Home finishes first exactly when it wins the only game.
  close(home.pFirst, analytic, 0.008, `sim matches winProbability (${hp}v${ap}, s=${sigma})`);
}

// ---------- determinism ----------
const cfg = {
  teamIds: [1, 2, 3, 4],
  banked: new Map([1, 2, 3, 4].map((id) => [id, { wins: 0, pointsFor: 0 }])),
  games: [
    { homeId: 1, awayId: 2, homeProj: 115, awayProj: 105 },
    { homeId: 3, awayId: 4, homeProj: 100, awayProj: 120 },
    { homeId: 1, awayId: 3, homeProj: 110, awayProj: 108 },
    { homeId: 2, awayId: 4, homeProj: 102, awayProj: 118 },
  ],
  sigma: 27, runs: 4000, seed: 9,
};
const d1 = simulateSeason(cfg);
const d2 = simulateSeason(cfg);
ok(JSON.stringify(d1.teams) === JSON.stringify(d2.teams), 'same inputs give identical results');
ok(JSON.stringify(simulateSeason({ ...cfg, seed: 10 }).teams) !== JSON.stringify(d1.teams),
  'a different seed moves the answer');

// ---------- probabilities are well formed ----------
const big = simulateSeason({
  teamIds: [1,2,3,4,5,6,7,8,9,10],
  banked: new Map(Array.from({ length: 10 }, (_, i) => [i + 1, { wins: i % 3, pointsFor: 300 + i * 7 }])),
  games: (() => {
    const gs = [];
    for (let w = 1; w <= 12; w++) {
      for (let i = 0; i < 5; i++) {
        const h = ((w + i) % 10) + 1;
        const a = ((w + i + 5) % 10) + 1;
        if (h !== a) gs.push({ homeId: h, awayId: a, homeProj: 100 + h * 2, awayProj: 100 + a * 2 });
      }
    }
    return gs;
  })(),
  sigma: 27, runs: 20000, seed: 3,
});

ok(big !== null, 'ten-team season simulates');
for (const t of big.teams) {
  close(t.places.reduce((x, y) => x + y, 0), 1, 1e-9, `team ${t.teamId} places sum to 1`);
  ok(t.places.every((p) => p >= 0 && p <= 1), `team ${t.teamId} probabilities in range`);
  ok(t.meanPlace >= 1 && t.meanPlace <= 10, `team ${t.teamId} mean place in range`);
}
// Every place is filled exactly once per run, so each place column sums to 1.
for (let p = 0; p < 10; p++) {
  close(big.teams.reduce((acc, t) => acc + t.places[p], 0), 1, 1e-9, `place ${p + 1} column sums to 1`);
}
// Mean places sum to 1+2+...+10
close(big.teams.reduce((acc, t) => acc + t.meanPlace, 0), 55, 1e-6, 'mean places sum to 55');
// byMean is sorted
ok(big.byMean.every((t, i, arr) => i === 0 || arr[i - 1].meanPlace <= t.meanPlace), 'byMean is ordered');
// champion / wooden spoon are the argmax of their columns
ok(big.teams.every((t) => t.pFirst <= big.champion.pFirst), 'champion has the highest P(1st)');
ok(big.teams.every((t) => t.pLast <= big.wooden.pLast), 'wooden spoon has the highest P(last)');

// With an equal start, projections alone should decide who wins most often.
// (`big` deliberately banks different records, so it cannot answer this — a
// team with two wins already in hand can beat a better team to the title.)
const level = simulateSeason({
  teamIds: [1,2,3,4,5,6,7,8,9,10],
  banked: new Map(Array.from({ length: 10 }, (_, i) => [i + 1, { wins: 0, pointsFor: 0 }])),
  games: big.teams && (() => {
    const gs = [];
    for (let w = 1; w <= 12; w++) {
      for (let i = 0; i < 5; i++) {
        const h = ((w + i) % 10) + 1;
        const a = ((w + i + 5) % 10) + 1;
        if (h !== a) gs.push({ homeId: h, awayId: a, homeProj: 100 + h * 2, awayProj: 100 + a * 2 });
      }
    }
    return gs;
  })(),
  sigma: 27, runs: 20000, seed: 3,
});
ok(level.champion.teamId === 10, 'strongest projections win most often', `got ${level.champion.teamId}`);
ok(level.wooden.teamId === 1, 'weakest projections finish last most often', `got ${level.wooden.teamId}`);
// And placing should fall monotonically with strength, from a level start.
const ordered = level.teams.slice().sort((x, y) => x.meanPlace - y.meanPlace).map((t) => t.teamId);
ok(ordered[0] === 10 && ordered[9] === 1, 'mean placing tracks projection strength', ordered.join(','));

// ---------- mean wins agrees with the exact Poisson-binomial ----------
// Team 1's games in `cfg`, from its own point of view.
const t1probs = [
  winProbability(115, 105, 27),   // home v 2
  winProbability(110, 108, 27),   // home v 3
];
const exact = winTotalDistribution(t1probs, 0).reduce((acc, x) => acc + x.wins * x.p, 0);
const simMeanWins = simulateSeason({ ...cfg, runs: 60000, seed: 21 }).teams.find((t) => t.teamId === 1).meanWins;
close(simMeanWins, exact, 0.02, 'mean wins matches the exact distribution');

// ---------- the points-for tiebreak ----------
// Two teams, no games left, equal wins, different points. Higher points wins.
const tb = simulateSeason({
  teamIds: [1, 2],
  banked: new Map([[1, { wins: 5, pointsFor: 900 }], [2, { wins: 5, pointsFor: 1000 }]]),
  games: [], sigma: 27, runs: 50, seed: 1,
});
close(tb.teams.find((t) => t.teamId === 2).pFirst, 1, 1e-12, 'points-for breaks a tie');
close(tb.teams.find((t) => t.teamId === 1).pFirst, 0, 1e-12, 'and the lower points finish second');

// A decided season is certain, not noisy.
const done = simulateSeason({
  teamIds: [1, 2, 3],
  banked: new Map([[1, { wins: 9, pointsFor: 1200 }], [2, { wins: 5, pointsFor: 1100 }], [3, { wins: 1, pointsFor: 900 }]]),
  games: [], sigma: 27, runs: 100, seed: 2,
});
ok(done.teams.find((t) => t.teamId === 1).pFirst === 1, 'finished season gives a certain winner');
ok(done.teams.find((t) => t.teamId === 3).pLast === 1, 'and a certain last');

// ---------- guards ----------
ok(simulateSeason({ teamIds: [], banked: new Map(), games: [], sigma: 27 }) === null, 'no teams => null');
ok(simulateSeason({ teamIds: [1], banked: new Map(), games: [], sigma: 0 }) === null, 'bad sigma => null');
const skip = simulateSeason({
  teamIds: [1, 2],
  banked: new Map([[1, { wins: 0, pointsFor: 0 }], [2, { wins: 0, pointsFor: 0 }]]),
  games: [
    { homeId: 1, awayId: 2, homeProj: 110, awayProj: null },
    { homeId: 1, awayId: 2, homeProj: 110, awayProj: 100 },
  ],
  sigma: 27, runs: 200, seed: 1,
});
ok(skip.skipped === 1 && skip.games === 1, 'a game with no projection is skipped and reported',
  `skipped=${skip.skipped} played=${skip.games}`);

// ---------- speed ----------
const t0 = Date.now();
simulateSeason({
  teamIds: Array.from({ length: 10 }, (_, i) => i + 1),
  banked: new Map(Array.from({ length: 10 }, (_, i) => [i + 1, { wins: 0, pointsFor: 0 }])),
  games: Array.from({ length: 60 }, (_, i) => ({
    homeId: (i % 10) + 1, awayId: ((i + 3) % 10) + 1, homeProj: 115, awayProj: 112,
  })).filter((g) => g.homeId !== g.awayId),
  sigma: 27, runs: 50000, seed: 1,
});
const ms = Date.now() - t0;
console.log(`\n50,000 runs of a 10-team, ~60-game season: ${ms}ms`);
ok(ms < 8000, 'a big run finishes in reasonable time', `${ms}ms`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
