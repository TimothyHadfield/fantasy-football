// Checks the season simulator: RNG quality, self-consistency with the analytic
// win probability, exact agreement on cases with a known answer, and the
// league's points-for tiebreak.
import {
  makeRng, makeNormal, simulateSeason, winProbability, winTotalDistribution,
  bracketSeeds, playoffRoundCount, DEFAULT_PLAYOFF_TEAMS,
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
ok(big.teams.every((t) => t.pFirst <= big.tableWinner.pFirst), 'tableWinner has the highest P(1st)');
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
ok(level.tableWinner.teamId === 10, 'strongest projections top the table most often', `got ${level.tableWinner.teamId}`);
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

// ============================================================================
//                          THE PLAYOFF BRACKET
// ============================================================================
//
// Every case below is one whose answer can be worked out by hand, so the test
// re-derives the number rather than reading the simulator's own back to it.
// The trick that makes that possible: BANK the whole regular season and leave
// no games to play, so the seeding is a fact rather than a distribution, then
// hand the bracket its own per-round projections. What is left varying is
// exactly the thing under test.

// ---------- the shape of the bracket ----------
ok(bracketSeeds(2).join(',') === '1,2', 'a two-team bracket is one game');
ok(bracketSeeds(4).join(',') === '1,4,2,3', 'a four-team bracket is 1v4 / 2v3', bracketSeeds(4).join(','));
// The one that matters: six teams pad up to eight, so seeds 7 and 8 are
// phantoms and seeds 1 and 2 meet nobody in round one.
ok(bracketSeeds(6).join(',') === '1,8,4,5,2,7,3,6', 'six teams pad to 1v8 / 4v5 / 2v7 / 3v6',
  bracketSeeds(6).join(','));
ok(bracketSeeds(6).length === 8 && bracketSeeds(5).length === 8 && bracketSeeds(7).length === 8,
  'fields of 5-8 all use an eight-slot bracket');
// 1 and 2 must land in opposite halves or they could meet before the final.
const b8 = bracketSeeds(8);
ok(b8.indexOf(1) < 4 && b8.indexOf(2) >= 4, 'the top two seeds are in opposite halves', b8.join(','));
ok(playoffRoundCount(6) === 3 && playoffRoundCount(4) === 2 && playoffRoundCount(8) === 3,
  'round count follows the field size');
ok(DEFAULT_PLAYOFF_TEAMS === 6, 'the documented fallback is six teams, per Tim’s ESPN settings');

/** Ten teams, season over, seeds nailed down as 1..10 by banked record. */
const SEEDED_IDS = [1,2,3,4,5,6,7,8,9,10];
const seededBanked = () =>
  new Map(SEEDED_IDS.map((id) => [id, { wins: 20 - id, pointsFor: 2000 - id * 10 }]));
/** week -> Map(teamId -> points) for the three playoff weeks. */
const poProj = (fn) =>
  new Map([14, 15, 16].map((w) => [w, new Map(SEEDED_IDS.map((id) => [id, fn(id, w)]))]));

// ---------- byes really do skip a round, and the maths proves it ----------
// Six qualify and every one of them is projected the SAME score in every
// playoff week, so each game is an exact coin flip. Then the title is decided
// by how many games you have to win:
//
//   seeds 1-2 have a bye  -> two coin flips  -> 1/4 each
//   seeds 3-6 play round 1 -> three coin flips -> 1/8 each
//   seeds 7-10 are not in the bracket at all -> 0
//
//   2*(1/4) + 4*(1/8) = 1, which is the whole probability, as it must be.
//
// If the byes were NOT being applied — if seeds 1 and 2 played a phantom as a
// real game, or were dropped in beside everyone else — those numbers would be
// 1/8 across the board and this would fail.
const coin = simulateSeason({
  teamIds: SEEDED_IDS,
  banked: seededBanked(),
  games: [],
  sigma: 27, runs: 200000, seed: 77,
  playoff: { teams: 6, weeks: [14, 15, 16], proj: poProj(() => 110) },
});
const bySeed = (s) => coin.teams.find((t) => t.teamId === s);

ok(coin.playoff && coin.playoff.teams === 6 && coin.playoff.rounds === 3 && coin.playoff.byes === 2,
  'six teams, three rounds, two byes', JSON.stringify(coin.playoff));
ok(coin.playoff.basis === 'projected', 'a bracket with every week projected says so',
  coin.playoff.basis);

for (const s of [1, 2]) {
  close(bySeed(s).pBye, 1, 1e-12, `seed ${s} gets a bye every time`);
  close(bySeed(s).pTitle, 0.25, 0.006, `seed ${s} wins two coin flips: 1/4`);
  close(bySeed(s).pFinal, 0.5, 0.006, `seed ${s} reaches the final half the time`);
}
for (const s of [3, 4, 5, 6]) {
  close(bySeed(s).pBye, 0, 1e-12, `seed ${s} never gets a bye`);
  close(bySeed(s).pTitle, 0.125, 0.006, `seed ${s} wins three coin flips: 1/8`);
  close(bySeed(s).pFinal, 0.25, 0.006, `seed ${s} reaches the final a quarter of the time`);
}
// The team that cannot reach the top six has a title chance of EXACTLY zero —
// not a small number, not noise. Nothing outside the bracket can win it.
for (const s of [7, 8, 9, 10]) {
  ok(bySeed(s).pTitle === 0, `seed ${s} misses the playoffs and has title % of exactly 0`,
    String(bySeed(s).pTitle));
  ok(bySeed(s).pPlayoffs === 0, `seed ${s} never qualifies`, String(bySeed(s).pPlayoffs));
  ok(bySeed(s).pBye === 0 && bySeed(s).pFinal === 0, `seed ${s} reaches no round at all`);
}

// ---------- the three columns are complete distributions ----------
// One champion, six qualifiers, two byes, two finalists — per simulated season,
// every season, so these are exact and not approximate.
const sumOf = (res, key) => res.teams.reduce((a, t) => a + t[key], 0);
close(sumOf(coin, 'pTitle'), 1, 1e-9, 'title % sums to 1 across the league');
close(sumOf(coin, 'pLast'), 1, 1e-9, 'last % sums to 1 across the league');
close(sumOf(coin, 'pFirst'), 1, 1e-9, 'first-in-the-table % sums to 1 across the league');
close(sumOf(coin, 'pPlayoffs'), 6, 1e-9, 'six teams qualify in every season');
close(sumOf(coin, 'pBye'), 2, 1e-9, 'two byes are handed out in every season');
close(sumOf(coin, 'pFinal'), 2, 1e-9, 'two teams contest the final in every season');
// Seeds are per season: every seed is held by exactly one team, and no team
// holds a seed outside the field.
for (let s = 0; s < 6; s++) {
  close(coin.teams.reduce((a, t) => a + t.seeds[s], 0), 1, 1e-9, `seed ${s + 1} is held once per season`);
}
for (let s = 6; s < 10; s++) {
  close(coin.teams.reduce((a, t) => a + t.seeds[s], 0), 0, 1e-12, `seed ${s + 1} does not exist in a six-team field`);
}
// Reaching the final is a prerequisite for winning it, for everyone.
ok(coin.teams.every((t) => t.pTitle <= t.pFinal + 1e-12), 'nobody wins a final they did not reach');
ok(coin.teams.every((t) => t.pFinal <= t.pPlayoffs + 1e-12), 'nobody reaches a final they did not qualify for');

// ---------- one overwhelming team: the title % has a computable value -------
// Eight qualify from eight, so nobody has a bye and seed 1 must win three
// games. Every opponent it can meet projects 100 and it projects 200, so each
// game is the same independent P = Phi(100 / (27*sqrt2)), and the title is that
// cubed. Nothing about the bracket's shape enters the arithmetic — which is the
// point: if the code played the wrong number of rounds, the cube would be wrong.
const P_STRONG = winProbability(200, 100, 27);
const strong = simulateSeason({
  teamIds: [1,2,3,4,5,6,7,8],
  banked: new Map([1,2,3,4,5,6,7,8].map((id) => [id, { wins: 20 - id, pointsFor: 2000 - id * 10 }])),
  games: [],
  sigma: 27, runs: 200000, seed: 91,
  playoff: {
    teams: 8,
    weeks: [14, 15, 16],
    proj: new Map([14, 15, 16].map((w) =>
      [w, new Map([1,2,3,4,5,6,7,8].map((id) => [id, id === 1 ? 200 : 100]))])),
  },
});
close(strong.teams.find((t) => t.teamId === 1).pTitle, P_STRONG ** 3, 0.005,
  'an overwhelming top seed wins three games: P^3');
ok(strong.playoff.byes === 0, 'an eight-team field hands out no byes', String(strong.playoff.byes));
ok(strong.titleFavourite.teamId === 1, 'the favourite is named', String(strong.titleFavourite.teamId));

// ---------- LAST % IS THE REGULAR SEASON, NOT THE PLAYOFFS ------------------
// Tim's rule, in his words: "we mark the loser as the person in last place by
// the end of the regular season, not the playoffs".
//
// This season is built so the two answers cannot coincide. Seeds are fixed, so
// team 10 is last every time and is nowhere near the bracket. In the playoffs
// seed 3 is unbeatable (300) and seed 6 is next (250), so seed 3 wins the
// title nearly always and the beaten finalist comes out of the other half of
// the draw. The wooden spoon therefore has to be a team that played no playoff
// game at all — and if `pLast` had been wired to the bracket instead, it could
// not possibly be team 10, which is never in it.
const spoon = simulateSeason({
  teamIds: SEEDED_IDS,
  banked: seededBanked(),
  games: [],
  sigma: 27, runs: 40000, seed: 55,
  playoff: {
    teams: 6, weeks: [14, 15, 16],
    proj: poProj((id) => (id === 3 ? 300 : id === 6 ? 250 : 100)),
  },
});
const spoonTeam = (id) => spoon.teams.find((t) => t.teamId === id);
ok(spoon.wooden.teamId === 10, 'the wooden spoon is last in the REGULAR season',
  String(spoon.wooden.teamId));
close(spoonTeam(10).pLast, 1, 1e-12, 'and it is last every single season');
ok(spoonTeam(10).pPlayoffs === 0 && spoonTeam(10).pFinal === 0,
  'the wooden spoon never plays a playoff game, so it cannot be the beaten finalist');
ok(spoon.titleFavourite.teamId === 3 && spoonTeam(3).pTitle > 0.9,
  'the unbeatable seed takes the title', `${spoon.titleFavourite.teamId} at ${spoonTeam(3).pTitle}`);
// Whoever loses the championship game most often is somebody else entirely.
const runnerUp = spoon.teams.slice().sort((x, y) => (y.pFinal - y.pTitle) - (x.pFinal - x.pTitle))[0];
ok(runnerUp.teamId !== spoon.wooden.teamId,
  'the beaten finalist and the wooden spoon are different teams',
  `runner-up ${runnerUp.teamId}, spoon ${spoon.wooden.teamId}`);
// The champion is not the table-topper here, which is the whole reason the two
// are separate numbers: team 1 tops the table in every season and wins nothing.
ok(spoon.tableWinner.teamId === 1 && spoon.titleFavourite.teamId === 3,
  'topping the table and winning the title are different teams',
  `${spoon.tableWinner.teamId} vs ${spoon.titleFavourite.teamId}`);
close(spoonTeam(1).pFirst, 1, 1e-12, 'team 1 tops the table every season');
ok(spoonTeam(1).pTitle < 0.1, 'and still almost never wins it', String(spoonTeam(1).pTitle));

// ---------- a tied playoff game goes to the higher seed ---------------------
// ESPN's rule (support.espn.com, "Playoff Tiebreakers": "The higher-seeded team
// advances"). A tie has probability zero under a continuous model, so it is
// forced here: with sigma at 1e-300 the noise term underflows to nothing and
// both sides score their projection exactly. That is the only way to take the
// branch, and a branch nothing can reach is a branch nobody has checked.
const tiedBracket = (pfHigh) => simulateSeason({
  teamIds: [1, 2],
  banked: new Map([[1, { wins: 5, pointsFor: pfHigh ? 1000 : 900 }],
                   [2, { wins: 5, pointsFor: pfHigh ? 900 : 1000 }]]),
  games: [],
  sigma: 1e-300, runs: 200, seed: 4,
  playoff: { teams: 2, weeks: [14], proj: new Map([[14, new Map([[1, 110], [2, 110]])]]) },
});
const tiedA = tiedBracket(true);
ok(tiedA.teams.find((t) => t.teamId === 1).pTitle === 1 &&
   tiedA.teams.find((t) => t.teamId === 2).pTitle === 0,
  'a tied playoff game is won by the higher seed');
const tiedB = tiedBracket(false);
ok(tiedB.teams.find((t) => t.teamId === 2).pTitle === 1 &&
   tiedB.teams.find((t) => t.teamId === 1).pTitle === 0,
  'and the rule follows the seed, not the team id');

// ---------- the bracket does not disturb the regular season -----------------
// The same season with and without a bracket must give identical standings
// numbers. If playing the knockout consumed random draws in a way that fed back
// into the league table, every number above would quietly change.
const noPo = simulateSeason({ ...cfg, runs: 8000, seed: 31 });
const withPo = simulateSeason({
  ...cfg, runs: 8000, seed: 31,
  playoff: { teams: 4, weeks: [14, 15], proj: null },
});
const strip = (r) => r.teams.map((t) => [t.teamId, t.places, t.meanWins, t.meanPlace]);
ok(JSON.stringify(strip(noPo)) === JSON.stringify(strip(withPo)),
  'adding a bracket leaves the regular-season standings untouched');
ok(noPo.teams.every((t) => t.pTitle === null && t.pPlayoffs === null && t.seeds === null),
  'with no bracket asked for, the playoff fields are null rather than zero');
ok(noPo.playoff === null && noPo.titleFavourite === null,
  'and the result carries no bracket');

// ---------- falling back when a playoff week has no projection --------------
// Not the normal case — ESPN publishes per-week projections right through the
// playoff weeks (probed 2026-09-16 against public leagues 1241838 and 899513) —
// but the demo season has no roster endpoint and an archived reading taken
// before this existed has no playoff weeks in it. Those must still produce a
// bracket, and must SAY that they modelled it.
const modelled = simulateSeason({
  teamIds: SEEDED_IDS,
  banked: seededBanked(),
  games: SEEDED_IDS.flatMap((id) => (id % 2 ? [] : [{
    homeId: id, awayId: id - 1, homeProj: 100 + id, awayProj: 100 + id - 1,
  }])),
  sigma: 27, runs: 8000, seed: 12,
  playoff: { teams: 6, weeks: [14, 15, 16], proj: null },
});
ok(modelled.playoff && modelled.playoff.basis === 'modelled',
  'a bracket with no published projections reports itself as modelled',
  modelled.playoff && modelled.playoff.basis);
ok(modelled.playoff.roundBasis.every((x) => x === 'modelled'), 'every round says so individually');
close(modelled.teams.reduce((a, t) => a + t.pTitle, 0), 1, 1e-9, 'and it is still a distribution');

// One round published and two not: reported as mixed and named round by round,
// never blurred into a single confident sentence.
const mixed = simulateSeason({
  teamIds: SEEDED_IDS,
  banked: seededBanked(),
  games: SEEDED_IDS.flatMap((id) => (id % 2 ? [] : [{
    homeId: id, awayId: id - 1, homeProj: 100 + id, awayProj: 100 + id - 1,
  }])),
  sigma: 27, runs: 4000, seed: 13,
  playoff: {
    teams: 6, weeks: [14, 15, 16],
    proj: new Map([[15, new Map(SEEDED_IDS.map((id) => [id, 110]))]]),
  },
});
ok(mixed.playoff.basis === 'mixed', 'a half-published bracket is reported as mixed', mixed.playoff.basis);
ok(JSON.stringify(mixed.playoff.roundBasis) === JSON.stringify(['modelled', 'projected', 'modelled']),
  'and names which round is which', JSON.stringify(mixed.playoff.roundBasis));

// A round with only SOME teams projected falls back whole rather than pitting a
// projected side against an averaged one in the same game.
const partial = simulateSeason({
  teamIds: SEEDED_IDS,
  banked: seededBanked(),
  games: SEEDED_IDS.flatMap((id) => (id % 2 ? [] : [{
    homeId: id, awayId: id - 1, homeProj: 100 + id, awayProj: 100 + id - 1,
  }])),
  sigma: 27, runs: 2000, seed: 14,
  playoff: {
    teams: 6, weeks: [14, 15, 16],
    proj: new Map([[14, new Map(SEEDED_IDS.slice(0, 4).map((id) => [id, 110]))]]),
  },
});
ok(partial.playoff.roundBasis[0] === 'modelled',
  'a round covering only some teams is modelled, not half-projected',
  partial.playoff.roundBasis[0]);

// ---------- determinism, with a bracket on top ------------------------------
const poCfg = {
  ...cfg, runs: 4000, seed: 9,
  playoff: { teams: 4, weeks: [14, 15], proj: null },
};
ok(JSON.stringify(simulateSeason(poCfg).teams) === JSON.stringify(simulateSeason(poCfg).teams),
  'a bracketed season is deterministic too');
ok(JSON.stringify(simulateSeason({ ...poCfg, seed: 10 }).teams) !==
   JSON.stringify(simulateSeason(poCfg).teams),
  'and a different seed still moves it');
// Field size is an input that changes the answer, so it must change the answer.
ok(JSON.stringify(simulateSeason({ ...poCfg, playoff: { ...poCfg.playoff, teams: 2 } }).teams) !==
   JSON.stringify(simulateSeason(poCfg).teams),
  'changing the field size changes the bracket');

// ---------- speed ----------
const bigSeason = (runs, playoff) => simulateSeason({
  teamIds: Array.from({ length: 10 }, (_, i) => i + 1),
  banked: new Map(Array.from({ length: 10 }, (_, i) => [i + 1, { wins: 0, pointsFor: 0 }])),
  games: Array.from({ length: 60 }, (_, i) => ({
    homeId: (i % 10) + 1, awayId: ((i + 3) % 10) + 1, homeProj: 115, awayProj: 112,
  })).filter((g) => g.homeId !== g.awayId),
  sigma: 27, runs, seed: 1, playoff,
});

const t0 = Date.now();
bigSeason(50000, null);
const ms = Date.now() - t0;
console.log(`\n50,000 runs of a 10-team, ~60-game season: ${ms}ms`);
ok(ms < 8000, 'a big run finishes in reasonable time', `${ms}ms`);

// The run count Tim asked for, with the bracket he asked for. Five knockout
// games on top of sixty league ones, so it should cost barely more than the
// same run count without one — measured here rather than assumed, because the
// page promises a number in its own note.
const poWeeks = { teams: 6, weeks: [14, 15, 16], proj: null };
const t1 = Date.now();
bigSeason(100000, poWeeks);
const ms100 = Date.now() - t1;
console.log(`100,000 runs of the same season WITH a 6-team, 3-round bracket: ${ms100}ms`);
ok(ms100 < 20000, '100,000 runs with a bracket finishes in reasonable time', `${ms100}ms`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
