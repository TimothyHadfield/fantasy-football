// Checks the must-win figures (js/must-win.js) and the forced game they are
// built on (js/forecast.js, a game marked `forced`).
//
//   node test-must-win.mjs
//
// The league is the size and shape of the one the page is used on: ten teams,
// four weeks banked, fifty games left over weeks 5-14, a six-team bracket in
// weeks 15-17, projections between about 105 and 135 and a 22.8-point spread.

import {
  simulateSeason, winProbability, normalCdf, normalInv,
} from '../js/forecast.js';
import {
  SWING_RUNS, SWING_SLICE, canForce, gameIndex, chancesIf, swingOf, gameSwing, pooled,
} from '../js/must-win.js';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const close = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, msg, `got ${a}, want ${b} (tol ${tol})`);

// ---------- the inverse normal ----------
for (const p of [1e-9, 0.001, 0.02, 0.3, 0.5, 0.77, 0.98, 0.9999]) {
  close(normalCdf(normalInv(p)), p, 2e-7, `normalCdf(normalInv(${p})) is ${p}`);
}
close(normalInv(0.975), 1.959964, 1e-5, 'normalInv(0.975) is 1.96');
close(normalInv(0.5), 0, 1e-9, 'normalInv(0.5) is 0');
ok(normalInv(0) === -Infinity && normalInv(1) === Infinity, 'the two ends are infinite, not NaN');

// ---------- the league ----------
const N = 10;
const teamIds = Array.from({ length: N }, (_, i) => i + 1);
const strength = [131, 127, 125, 123, 121, 119, 117, 114, 110, 106];
// A round robin by the circle method: nine rounds, then the first again.
const round = (r) => {
  const ring = [1, ...Array.from({ length: N - 1 }, (_, i) => 2 + ((i + r) % (N - 1)))];
  return Array.from({ length: N / 2 }, (_, i) => [ring[i], ring[N - 1 - i]]);
};
const banked = new Map(teamIds.map((id) => [id, { wins: 0, pointsFor: 0 }]));
for (let w = 1; w <= 4; w++) {
  for (const [h, a] of round(w - 1)) {
    const hs = strength[h - 1] + ((h * 7 + w * 13) % 31) - 15;
    const as = strength[a - 1] + ((a * 11 + w * 5) % 31) - 15;
    banked.get(h).pointsFor += hs;
    banked.get(a).pointsFor += as;
    banked.get(hs >= as ? h : a).wins += 1;
  }
}
const games = [];
for (let w = 5; w <= 14; w++) {
  for (const [h, a] of round(w - 1)) {
    games.push({
      week: w, homeId: h, awayId: a,
      homeProj: strength[h - 1] + ((h + w) % 5) - 2, awayProj: strength[a - 1] + ((a * 3 + w) % 5) - 2,
    });
  }
}
const sigma = 22.8;
const inputs = { teamIds, banked, games, sigma, playoff: { teams: 6, weeks: [15, 16, 17], proj: null } };
ok(games.length === 50, 'fifty games left', String(games.length));

const run = (g, runs, seed) => simulateSeason({ ...inputs, games: g, runs, seed });
const rowOf = (res, id) => res.teams.find((t) => t.teamId === id);

// ---------- a forced game is won, every time ----------
for (const [hp, ap] of [[100, 100], [90, 130], [130, 90]]) {
  const one = (forced) => simulateSeason({
    teamIds: [1, 2],
    banked: new Map([[1, { wins: 0, pointsFor: 0 }], [2, { wins: 0, pointsFor: 0 }]]),
    games: [{ homeId: 1, awayId: 2, homeProj: hp, awayProj: ap, forced }],
    sigma: 27, runs: 4000, seed: 3,
  }).teams[0];
  ok(one('home').pFirst === 1, `forced home wins all 4,000 (${hp} v ${ap})`, String(one('home').pFirst));
  ok(one('away').pFirst === 0, `forced away wins all 4,000 (${hp} v ${ap})`, String(one('away').pFirst));
  ok(one('home').meanWins === 1 && one('away').meanWins === 0, 'and never as a tie');
}

// ---------- nothing else moves ----------
const base = run(games, 4000, 9);
const sameAsBase = run(games.map((g) => ({ ...g, forced: undefined })), 4000, 9);
ok(JSON.stringify(sameAsBase) === JSON.stringify(base), 'no game forced is the simulation exactly as it was');

const fi = gameIndex(games, 5, 5);
const fg = games[fi];
ok(fi >= 0 && (fg.homeId === 5 || fg.awayId === 5) && fg.week === 5, 'gameIndex finds the team’s game that week');
ok(gameIndex(games, 5, 99) === -1 && gameIndex(games, 77, 5) === -1, 'and -1 for a week or a team with none');
const mark = (side) => games.map((g, i) => (i === fi ? { ...g, forced: side } : g));
const fw = run(mark('home'), 4000, 9);
const fl = run(mark('away'), 4000, 9);
// Every other game takes the same draws, so the eight teams not in the forced
// game win exactly what they won before, to the last bit.
const others = teamIds.filter((id) => id !== fg.homeId && id !== fg.awayId);
ok(others.every((id) => rowOf(fw, id).meanWins === rowOf(base, id).meanWins &&
  rowOf(fl, id).meanWins === rowOf(base, id).meanWins),
  'the other eight teams’ wins are untouched, bit for bit');
// And the two in it differ, between the two runs, by exactly that one game.
close(rowOf(fw, fg.homeId).meanWins - rowOf(fl, fg.homeId).meanWins, 1, 1e-9, 'the home side is one win better off forced to win');
close(rowOf(fl, fg.awayId).meanWins - rowOf(fw, fg.awayId).meanWins, 1, 1e-9, 'and the away side one win better off the other way');

// ---------- a forced result is a fair sample of "given that result" ----------
// The law of total probability, on every figure the simulation counts: today's
// chance is the two forced chances weighed by the chance of the result. A
// forced game drawn from the wrong scores (a win by a fixed margin, say) breaks
// it through the points-for tiebreak.
{
  const RUNS = 40000;
  const b = run(games, RUNS, 21);
  for (const [team, week] of [[5, 5], [2, 9], [9, 12]]) {
    const i = gameIndex(games, team, week);
    const g = games[i];
    const home = g.homeId === team;
    const p = winProbability(home ? g.homeProj : g.awayProj, home ? g.awayProj : g.homeProj, sigma);
    const w = rowOf(run(games.map((x, k) => (k === i ? { ...x, forced: home ? 'home' : 'away' } : x)), RUNS, 21), team);
    const l = rowOf(run(games.map((x, k) => (k === i ? { ...x, forced: home ? 'away' : 'home' } : x)), RUNS, 21), team);
    const t = rowOf(b, team);
    for (const key of ['pTitle', 'pLast', 'pPlayoffs', 'pFirst']) {
      close(p * w[key] + (1 - p) * l[key], t[key], 0.008, `team ${team} week ${week}: win and lose weighed by ${p.toFixed(2)} give back ${key}`);
    }
    close(p * w.meanWins + (1 - p) * l.meanWins, t.meanWins, 0.02, `team ${team} week ${week}: and the mean wins`);
  }
}

// ---------- which games can be forced ----------
ok(canForce(fg, fg.homeId) && canForce(fg, fg.awayId), 'either side of a game to come');
ok(!canForce(fg, others[0]), 'not a team that is not in it');
ok(!canForce({ ...fg, homeProj: null }, fg.homeId), 'not a game with a projection missing');
ok(!canForce({ ...fg, homeLeft: 0.4, awayLeft: 1 }, fg.homeId), 'not a game in progress');
ok(!canForce(undefined, 1), 'not a game that is not there');
{
  const live = games.map((g, i) => (i === fi ? { ...g, homeLeft: 0.4, awayLeft: 1 } : g));
  ok(chancesIf({ ...inputs, games: live }, fg.homeId, fi, true) === null, 'chancesIf is null for a game in progress');
  ok(gameSwing({ ...inputs, games: live }, fg.homeId, fi) === null, 'and so is the swing');
  // Decided on the field with nothing left to play: the mark is ignored.
  const done = games.map((g, i) => (i === fi ? { ...g, homeProj: 90, awayProj: 120, homeLeft: 0, awayLeft: 0, forced: 'home' } : g));
  const r = run(done, 500, 4);
  const plain = run(done.map((g) => ({ ...g, forced: undefined })), 500, 4);
  ok(JSON.stringify(r) === JSON.stringify(plain), 'a game with no spread left is played as it stands');
}

// ---------- the swing ----------
ok(SWING_RUNS === 10000, 'SWING_RUNS is the 10,000 the page prints', String(SWING_RUNS));
const all = [];
for (const team of teamIds) {
  for (let w = 5; w <= 14; w++) {
    const i = gameIndex(games, team, w);
    all.push({ team, w, i, sw: gameSwing(inputs, team, i, { seed: 20260901 }) });
  }
}
ok(all.length === 100 && all.every((x) => x.sw && x.sw.runs === SWING_RUNS), 'every team has a swing for each of its ten games');
ok(all.every((x) => Math.abs(x.sw.title - (x.sw.win.title - x.sw.loss.title)) < 1e-12 &&
  Math.abs(x.sw.last - (x.sw.win.last - x.sw.loss.last)) < 1e-12), 'a swing is win minus loss');
// Within the counting noise measured below.
const worstTitle = Math.min(...all.map((x) => x.sw.title));
const worstLast = Math.max(...all.map((x) => x.sw.last));
ok(worstTitle > -0.01, 'winning never lowers a title chance', `${(worstTitle * 100).toFixed(2)} pp`);
ok(worstLast < 0.01, 'and never raises a chance of finishing last', `${(worstLast * 100).toFixed(2)} pp`);
ok(all.some((x) => x.sw.title > 0.03) && all.some((x) => x.sw.last < -0.03),
  'and some game in the league is worth three points of each');
{
  const again = gameSwing(inputs, 5, fi, { seed: 20260901 });
  const first = all.find((x) => x.team === 5 && x.w === 5).sw;
  ok(JSON.stringify(again) === JSON.stringify(first), 'the same seed gives the same swing');
  const mine = fg.homeId === 5;
  const viaRun = rowOf(run(mark(mine ? 'home' : 'away'), SWING_RUNS, 20260901), 5);
  ok(first.win.title === viaRun.pTitle && first.win.last === viaRun.pLast, '"if you win" is the run with your side forced');
}
ok(swingOf(null, { title: 0.1, last: 0.1 }) === null, 'half a swing is no swing');
{
  // The page takes each forced run in slices and pools them: ten slices of
  // 1,000 on ten seeds count the same 10,000 seasons as ten separate runs.
  ok(SWING_RUNS % SWING_SLICE === 0, 'the slices make up SWING_RUNS exactly', `${SWING_RUNS} / ${SWING_SLICE}`);
  const parts = Array.from({ length: 10 }, (_, k) => chancesIf(inputs, 5, fi, true, { runs: 1000, seed: 50 + k }));
  const p = pooled(parts);
  close(p.title, parts.reduce((a, c) => a + c.title, 0) / 10, 1e-12, 'pooled title is the mean of the slices');
  close(p.last, parts.reduce((a, c) => a + c.last, 0) / 10, 1e-12, 'pooled last is the mean of the slices');
  ok(pooled([]) === null && pooled([null]) === null, 'nothing pooled is nothing');
  ok(pooled([{ title: null, last: 0.2 }, { title: null, last: 0.4 }]).title === null, 'no bracket in the slices, no title in the pool');
}
{
  // No bracket: there is no title to move, and last place still has a figure.
  const sw = gameSwing({ ...inputs, playoff: null }, 5, fi, { runs: 1000 });
  ok(sw && sw.title === null && Number.isFinite(sw.last), 'with no bracket the title swing is null, the last one is not');
}

// ---------- the noise the page quotes ----------
// Seed to seed, at the run count the page uses: both swings hold well inside a
// percentage point (1 SD). The third game is the bottom team's, whose
// last-place swing is the biggest in the league and so the noisiest.
{
  const sd = (xs) => {
    const m = xs.reduce((a, v) => a + v, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
  };
  let worstT = 0, worstL = 0;
  for (const [team, week] of [[1, 5], [5, 8], [10, 14]]) {
    const i = gameIndex(games, team, week);
    const sws = Array.from({ length: 10 }, (_, s) => gameSwing(inputs, team, i, { seed: 1000 + s * 7919 }));
    worstT = Math.max(worstT, sd(sws.map((x) => x.title)));
    worstL = Math.max(worstL, sd(sws.map((x) => x.last)));
  }
  console.log(`swing spread over 10 seeds at ${SWING_RUNS} runs: title ${(worstT * 100).toFixed(2)} pp, last ${(worstL * 100).toFixed(2)} pp (worst of 3 games, 1 SD)`);
  ok(worstT < 0.008, 'a title swing holds within 0.8 of a point, seed to seed', `${(worstT * 100).toFixed(2)} pp`);
  ok(worstL < 0.009, 'a last-place swing holds within 0.9 of a point, seed to seed', `${(worstL * 100).toFixed(2)} pp`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
