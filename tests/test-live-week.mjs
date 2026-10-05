// THE WEEK IN PROGRESS — played out from where it stands, not from kickoff.
//
//   node test-live-week.mjs
//
// Tim, 2026-10-04: "if it's halfway through week 4, the simulation would
// simulate the rest of week 4 (based on the current odds (80-20, etc)), and
// then continue with the rest of the season. Right now I think it simulates
// week 4 as if nothing has happened".
//
// Checks espn.parseProGames (which NFL games are over), capture.liveWeek (each
// squad's points so far, points to come and share of the spread left),
// capture.simulationInputs (the live week's games carry them) and
// forecast.simulateSeason / winProbabilityLive (which play them out). Every
// expected number is worked by hand in the comment beside it.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const espn = await import(pathToFileURL(path.join(REPO, 'js/espn.js')).href);
const capture = await import(pathToFileURL(path.join(REPO, 'js/capture.js')).href);
const forecast = await import(pathToFileURL(path.join(REPO, 'js/forecast.js')).href);

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a, b, tol, name) => ok(Number.isFinite(a) && Math.abs(a - b) <= tol, name, `got ${a}, want ${b} ±${tol}`);

const MIN = 60000;
const H = 60 * MIN;

// ---- espn.parseProGames, on the payload's real shape -----------------------
// As ESPN sent it on Sun 2026-10-04 (trimmed): `statsOfficial` is false while a
// game is being played and true once it is over.
const K = 1791133200000;                       // Sun Oct 4 2026 17:00 UTC
const payload = {
  settings: {
    proTeams: [
      { id: 0, abbrev: 'FA', byeWeek: 0 },
      {
        id: 2, abbrev: 'BUF', byeWeek: 7,
        proGamesByScoringPeriod: {
          3: [{ date: K - 7 * 24 * H, statsOfficial: true, validForLocking: true }],
          4: [{ date: K + 24 * H, statsOfficial: false }, { date: K, statsOfficial: true }],
          5: [{ date: K + 7 * 24 * H, statsOfficial: false }],
          6: [{ date: null, statsOfficial: false }],
        },
      },
      { id: 9, abbrev: 'GB', byeWeek: 11 },
    ],
  },
};
eq(espn.parseProGames(payload), {
  2: { 3: { at: K - 7 * 24 * H, done: true }, 4: { at: K, done: true }, 5: { at: K + 7 * 24 * H, done: false } },
}, 'parseProGames: the earliest game per week with its own statsOfficial; no bye, no dateless game, no FA');
eq(espn.parseProGames(null), {}, 'a missing payload is {} (unknown)');

// ---- the fixture: week 4 on a Sunday afternoon -----------------------------
// A three-slot league (QB, RB, WR) so every number can be checked by hand.
const NOW = K + 5 * H;
const proGames = {
  1: { 4: { at: NOW - 5 * H, done: true } },       // the early game: over
  2: { 4: { at: NOW - 95 * MIN, done: false } },   // the late game: 95 of 190 minutes in = half
  3: { 4: { at: NOW + 3 * H, done: false } },      // the night game: not kicked off
  // pro team 4 is on bye: no entry
};
const SLOTS = [0, 2, 4];
const man = (position, lineupSlotId, proTeamId, projected, actual = null) => ({
  position, lineupSlotId, proTeamId, projected, actual,
  started: lineupSlotId !== 20 && lineupSlotId !== 21,
});
const week4 = [
  {
    id: 1,
    players: [
      man('QB', 0, 1, 20, 26),     // over: 26 banked, nothing to come
      man('RB', 2, 2, 12, 8),      // half played: 8 banked, 6 to come
      man('WR', 4, 3, 10),         // not kicked off: his slot is still open...
      man('WR', 20, 3, 14),        // ...and the best man left for it is on the bench
      man('RB', 20, 1, 9, 30),     // kicked off on the bench: 30 points nobody gets
    ],
  },
  {
    id: 2,
    players: [                     // all three in the early game: a finished 17.5
      man('QB', 0, 1, 15, 10),
      man('RB', 2, 1, 10, 5),
      man('WR', 4, 1, 10, 2.5),
    ],
  },
];
const weekTeams = new Map([[4, week4]]);
const data = capture.normalizeSchedule({
  teams: [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }],
  games: [
    { week: 3, homeId: 1, awayId: 2, homeScore: 90, awayScore: 80, played: true },
    // Both squads have points and ESPN has not closed the week: in progress.
    { week: 4, homeId: 1, awayId: 2, homeScore: 34, awayScore: 17.5, played: false },
    { week: 5, homeId: 2, awayId: 1, homeScore: 0, awayScore: 0, played: false },
  ],
}, { isDemo: false });
const proj = new Map([
  [4, new Map([[1, 46], [2, 35]])],
  [5, new Map([[1, 50], [2, 40]])],
]);

// ---- capture.liveWeek ------------------------------------------------------
const live = capture.liveWeek({ data, weekTeams, slots: SLOTS, proGames, asOf: NOW, now: NOW });
ok(live && live.week === 4, 'the week in progress is the first week not yet final', JSON.stringify(live && live.week));
const one = live?.teams.get(1);
const two = live?.teams.get(2);
// One: banked 26 + 8 = 34. To come: 12 × (1 − 95/190) = 6 from the half-played
// RB, plus the open WR slot's best man (the benched 14, not the started 10) = 20.
near(one?.banked, 34, 1e-9, 'points so far: the started men who have kicked off, and nobody on the bench');
near(one?.mean, 54, 1e-9, 'expected final = 34 banked + 6 (half a game of 12) + 14 (best man for the open slot)');
// The whole lineup projects 20 + 12 + 14 = 46, of which 20 is still to come.
near(one?.left, Math.sqrt(20 / 46), 1e-9, 'share of the spread left = sqrt(points to come / whole lineup) = sqrt(20/46)');
near(two?.mean, 17.5, 1e-9, 'a squad whose every starter has finished is its score');
ok(two?.left === 0, 'and has no spread left', String(two?.left));

// Nobody has kicked off: nothing is in progress, and every caller does what it did.
eq(capture.liveWeek({ data, weekTeams, slots: SLOTS, proGames, asOf: NOW - 6 * H, now: NOW - 6 * H }), null,
  'before the first kickoff there is no week in progress (null)');
eq(capture.liveWeek({ data: { ...data, isDemo: true }, weekTeams, slots: SLOTS, proGames, asOf: NOW, now: NOW }), null,
  'demo never has one');
eq(capture.liveWeek({ data, weekTeams, slots: SLOTS, proGames: null, asOf: NOW, now: NOW }), null,
  'no NFL games read: null');
eq(capture.liveWeek({ data, weekTeams: new Map(), slots: SLOTS, proGames, asOf: NOW, now: NOW }), null,
  'no rosters for the week: null');

// AN OLD COPY OF THE ROSTERS IS AGED BY THE CLOCK, NOT BY TODAY'S "OVER". Read
// 30 minutes into the early game and looked at four and a half hours later:
// the points on it are the 30-minute points, so 160/190 of each man is to come.
const old = capture.liveWeek({ data, weekTeams, slots: SLOTS, proGames, asOf: NOW - 4.5 * H, now: NOW });
// Two: banked 17.5, to come (15 + 10 + 10) × 160/190.
near(old?.teams.get(2)?.mean, 17.5 + 35 * 160 / 190, 1e-9,
  'a read from 30 minutes into a game counts 160/190 of it as still to play, even though the game is over now');
near(old?.teams.get(2)?.left, Math.sqrt(160 / 190), 1e-9, 'and keeps that share of the spread');

// A FRESH read believes ESPN that a game is over, however short it ran.
const quick = capture.liveWeek({
  data, weekTeams, slots: SLOTS, asOf: NOW, now: NOW,
  proGames: { ...proGames, 2: { 4: { at: NOW - 150 * MIN, done: true } } },
});
near(quick?.teams.get(1)?.mean, 26 + 8 + 14, 1e-9, 'statsOfficial on a fresh read ends a game before 190 minutes: nothing more from that RB');

// ---- capture.simulationInputs ----------------------------------------------
const isRemaining = (g) => capture.gameState(g) !== 'final';
const plain = capture.simulationInputs({ data, isRemaining, proj, sigma: 20 });
const lived = capture.simulationInputs({ data, isRemaining, proj, sigma: 20, live });
eq(plain.games[0], { week: 4, homeId: 1, awayId: 2, homeProj: 46, awayProj: 35 },
  'without a live reading the week is its whole projection, exactly as before');
ok(!('liveWeek' in plain), 'and the inputs say nothing about a live week');
const g4 = lived.games.find((g) => g.week === 4);
near(g4.homeProj, 54, 1e-9, 'live: the home side is its expected final');
near(g4.awayProj, 17.5, 1e-9, 'live: the away side is its score');
near(g4.homeLeft, Math.sqrt(20 / 46), 1e-9, 'live: with the share of the spread it has left');
ok(g4.awayLeft === 0, 'live: and none for a finished squad');
eq(lived.games.find((g) => g.week === 5), plain.games.find((g) => g.week === 5),
  'the weeks after it are untouched');
ok(lived.liveWeek === 4, 'the inputs name the week played out from its score');
eq(lived.banked, plain.banked, 'nothing of a week in progress is banked');
ok(JSON.stringify(lived.keyParts) !== JSON.stringify(plain.keyParts), 'the cache key changes with it');

// ---- forecast: playing it out ----------------------------------------------
const P = forecast.winProbabilityLive;
ok(P(110, 100, 20, 1, 1) === forecast.winProbability(110, 100, 20), 'winProbabilityLive with everything left is winProbability');
// Home finished on 110; away on 100 with half its spread left: margin sd = 20 × 0.5 = 10, so Φ(1).
near(P(110, 100, 20, 0, 0.5), 0.8413, 0.0002, 'a finished 110 against 100 with half the spread left wins Φ(1) = 84.1%');
ok(P(101, 100, 20, 0, 0) === 1 && P(100, 101, 20, 0, 0) === 0 && P(100, 100, 20, 0, 0) === 0.5,
  'nothing left on either side: the game is decided');

const season = (games, runs = 40000) => forecast.simulateSeason({
  teamIds: [1, 2], banked: new Map(), games, sigma: 20, runs, seed: 7,
});
const winsOf = (res, id) => res.teams.find((t) => t.teamId === id).meanWins;

// A one-point lead with nothing left to play is a win every time. Played out
// from kickoff at the whole spread — what the simulation did before — it is 51%.
const decided = season([{ homeId: 1, awayId: 2, homeProj: 100, awayProj: 101, homeLeft: 0, awayLeft: 0 }]);
ok(winsOf(decided, 2) === 1 && winsOf(decided, 1) === 0, 'simulateSeason: a finished week goes to the side in front, in every run',
  `${winsOf(decided, 1)} / ${winsOf(decided, 2)}`);

const partial = season([{ homeId: 1, awayId: 2, homeProj: 110, awayProj: 100, homeLeft: 0, awayLeft: 0.5 }], 200000);
near(winsOf(partial, 1), P(110, 100, 20, 0, 0.5), 0.005, 'simulateSeason agrees with winProbabilityLive on a half-played game');

// The live game must not shift the random stream under the weeks after it.
const later = { homeId: 2, awayId: 1, homeProj: 100, awayProj: 100 };
const a = season([{ homeId: 1, awayId: 2, homeProj: 500, awayProj: 0, homeLeft: 0, awayLeft: 0 }, later]);
const b = season([{ homeId: 1, awayId: 2, homeProj: 500, awayProj: 0 }, later]);
ok(winsOf(a, 2) === winsOf(b, 2), 'the weeks after a live game are drawn exactly as they would have been', `${winsOf(a, 2)} vs ${winsOf(b, 2)}`);
eq(season([{ homeId: 1, awayId: 2, homeProj: 110, awayProj: 100, homeLeft: 1, awayLeft: 1 }]).teams,
  season([{ homeId: 1, awayId: 2, homeProj: 110, awayProj: 100 }]).teams,
  'a game with the whole spread left is the game it always was');

// End to end: the fixture's week 4 is 54 against a finished 17.5, so One wins
// it in all but a sliver of runs; from kickoff it was 46 v 35 at ±20, about 65%.
const fromLive = forecast.simulateSeason({ ...lived, runs: 40000, seed: 7 });
const fromKickoff = forecast.simulateSeason({ ...plain, runs: 40000, seed: 7 });
const p4 = P(54, 17.5, 20, Math.sqrt(20 / 46), 0);
const p5 = forecast.winProbability(50, 40, 20);
near(winsOf(fromLive, 1), 1 + p4 + p5, 0.01, 'the season: the banked week 3 win, week 4 from where it stands, week 5 from its projection');
near(winsOf(fromKickoff, 1), 1 + forecast.winProbability(46, 35, 20) + p5, 0.01, 'and without the reading, week 4 from kickoff as before');
ok(winsOf(fromLive, 1) - winsOf(fromKickoff, 1) > 0.25, 'the reading moves One’s expected wins by the lead it has built',
  `${winsOf(fromLive, 1)} vs ${winsOf(fromKickoff, 1)}`);

// The record by each name in the simulation table (Tim, 2026-10-04): "if
// someone's record is 3-2 and they have a 20% chance of winning the current
// week, their record should be displayed as 3.2-2.8".
eq(forecast.recordInPlay({ w: 3, l: 2, t: 0 }, 0.2), { w: '3.2', l: '2.8', t: 0, wins: 3.2 }, 'Tim’s example: 3-2 at 20% reads 3.2-2.8');
eq(forecast.recordInPlay({ w: 3, l: 2, t: 0 }, null), { w: '3', l: '2', t: 0, wins: 3 }, 'no game in play: whole numbers');
eq(forecast.recordInPlay({ w: 1, l: 1, t: 1 }, 0.849), { w: '1.8', l: '1.2', t: 1, wins: 2.3 }, 'a tie stays a third number and half a win for sorting');
for (const p of [0.05, 0.25, 0.35, 0.65, 0.95]) {
  const r = forecast.recordInPlay({ w: 3, l: 2, t: 0 }, p);
  near(Number(r.w) + Number(r.l), 6, 1e-9, `at ${p} the two halves still add up to the games played`);
}
eq(forecast.recordInPlay({ w: 0, l: 3, t: 0 }, 1), { w: '1.0', l: '3.0', t: 0, wins: 1 }, 'a game all but won keeps its decimal, so it still reads as in play');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
