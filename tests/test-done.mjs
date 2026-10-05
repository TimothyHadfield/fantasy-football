// WHAT IS FINISHED COUNTS NOW — a finished player and a finished matchup, in a
// week ESPN has not closed yet.
//
//   node test-done.mjs             all scenarios, one child each
//   node test-done.mjs <scenario>  one
//
// Tim, 2026-10-04: "any games that are comepletely finished are counted in
// whatever data across the cite ... for singular player's that have finished
// their game, their numbers are individually updated ... nothing is waiting on
// something else that it doesn't depend on."
//
// THE FIXTURE, raw ESPN payloads through a stub `fetch`, so the real decoders
// and the real routing in js/season.js are what is under test.
//
//   NFL, week 3 (NOW = the moment the scenario starts):
//     pro 1, pro 2   kicked off 6 h ago, statsOfficial true    -> over
//     pro 3          kicks off in 20 h (Monday night)          -> not played
//     pro 4          on bye in week 3 (no game)                -> nothing to wait for
//
//   Fantasy, two starting slots (QB, RB) and a bench:
//     week 1   A–B 100–90 HOME      C–D 80–85 AWAY
//     week 2   A–C 70–70 TIE        B–D 60–50 HOME
//     week 3   A–B 31.5–12 UNDECIDED    C–D 40–0 UNDECIDED     <- in progress
//     week 4   A–D, B–C not started
//
//   Week 3 lineups (projection / points so far):
//     A  QB pro1 20 / 25.5   RB pro2 10 / 6     bench WR pro3 8 / —
//     B  QB pro1 18 / 12     RB pro4  0 / — (bye)   bench WR pro3 9 / —
//     C  QB pro2 22 / 40     RB pro3 11 / —     bench WR pro3 7 / —
//     D  QB pro3 19 / —      RB pro3 12 / —     bench WR pro1 5 / 3
//
//   So every starter of A and of B is finished: A–B is over, 31.5–12, home by
//   19.5, and ESPN will not say so until Tuesday. C–D is not: C's RB and both
//   of D's starters play on Monday.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 400)}` : ''}`);
};
const eq = (a, b, msg) =>
  ok(msg, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a, b, tol, msg) => ok(msg, Number.isFinite(a) && Math.abs(a - b) <= tol, `got ${a}, want ${b}`);

const MIN = 60000;
const H = 60 * MIN;
const LEAGUE_ID = '5550009';
const SEASON = 2026;
const NOW = Date.now();

const TEAMS = [
  { id: 1, abbrev: 'A', name: 'Alpha' },
  { id: 2, abbrev: 'B', name: 'Bravo' },
  { id: 3, abbrev: 'C', name: 'Charlie' },
  { id: 4, abbrev: 'D', name: 'Delta' },
];

// ESPN's real shape, measured on league 1241838 (2026-10-05, week 4 in play):
// a DECIDED side carries `totalPoints` and `pointsByScoringPeriod`; a side in
// the week being played carries `totalPoints: 0` and its running score in
// `totalPointsLive` (and `pointsByScoringPeriod`); a week not begun has
// `totalPoints: 0` and neither of the other two.
const side = (week, teamId, pts, winner) => {
  if (winner !== 'UNDECIDED') return { teamId, totalPoints: pts, pointsByScoringPeriod: { [week]: pts } };
  if (pts === null) return { teamId, totalPoints: 0 };
  return { teamId, totalPoints: 0, totalPointsLive: pts, pointsByScoringPeriod: { [week]: pts } };
};
const game = (week, h, hp, a, ap, winner) => ({
  matchupPeriodId: week,
  home: side(week, h, hp, winner),
  away: side(week, a, ap, winner),
  winner,
  playoffTierType: 'NONE',
});

function leaguePayload(mode) {
  const live = !mode.noScore;
  return {
    settings: {
      name: 'Done League',
      size: 4,
      scheduleSettings: { matchupPeriodCount: 4, playoffTeamCount: 2 },
      rosterSettings: { lineupSlotCounts: { 0: 1, 2: 1, 20: 1 } },
    },
    members: [],
    teams: TEAMS.map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev, roster: { entries: [] } })),
    schedule: [
      game(1, 1, 100, 2, 90, 'HOME'),
      game(1, 3, 80, 4, 85, 'AWAY'),
      game(2, 1, 70, 3, 70, 'TIE'),
      game(2, 2, 60, 4, 50, 'HOME'),
      game(3, 1, live ? 31.5 : null, 2, live ? 12 : null, 'UNDECIDED'),
      game(3, 3, live ? 40 : null, 4, live ? 0 : null, 'UNDECIDED'),
      game(4, 1, null, 4, null, 'UNDECIDED'),
      game(4, 2, null, 3, null, 'UNDECIDED'),
    ],
  };
}

// [position id, slot, pro team, projection, week-3 points or null]
const LINEUPS = {
  1: [[1, 0, 1, 20, 25.5], [2, 2, 2, 10, 6], [3, 20, 3, 8, null]],
  2: [[1, 0, 1, 18, 12], [2, 2, 4, 0, null], [3, 20, 3, 9, null]],
  3: [[1, 0, 2, 22, 40], [2, 2, 3, 11, null], [3, 20, 3, 7, null]],
  4: [[1, 0, 3, 19, null], [2, 2, 3, 12, null], [3, 20, 1, 5, 3]],
};

function rosterPayload(week, mode) {
  return {
    settings: { name: 'Done League' },
    members: [],
    teams: TEAMS.map((t) => ({
      id: t.id,
      name: t.name,
      abbrev: t.abbrev,
      roster: {
        entries: LINEUPS[t.id].map(([pos, slot, pro, proj, pts], i) => {
          // `noStarters`: Bravo has everybody on the bench.
          const lineupSlotId = mode.noStarters && t.id === 2 ? 20 : slot;
          // Past weeks: everybody scored exactly two over his projection.
          // Week 3: the points above. Week 4: nothing yet.
          const actual = week < 3 ? proj + 2 : week === 3 && !mode.noScore ? pts : null;
          return {
            playerId: t.id * 100 + i,
            lineupSlotId,
            playerPoolEntry: {
              player: {
                id: t.id * 100 + i,
                fullName: `${t.abbrev}${i}`,
                defaultPositionId: pos,
                proTeamId: pro,
                injuryStatus: 'ACTIVE',
                stats: [
                  { scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: proj },
                  ...(actual === null ? [] : [{ scoringPeriodId: week, statSourceId: 0, statSplitTypeId: 1, appliedTotal: actual }]),
                ],
              },
            },
          };
        }),
      },
    })),
  };
}

// The wire in week 3, all RBs: [id, pro team, projection, points or null].
// Pre-game the third-best is 5 (7, 6, 5, 4, 0). Priced by points for the men
// who have finished it would be 7 (14, 9, 7, 1, 0) — hindsight, not a floor.
const WIRE = [[901, 1, 5, 9], [902, 3, 7, null], [903, 4, 0, null], [904, 1, 6, 1], [905, 2, 4, 14]];

function wirePayload(week) {
  return {
    players: WIRE.map(([id, pro, proj, pts]) => ({
      id,
      status: 'FREEAGENT',
      player: {
        id, fullName: `Free ${id}`, defaultPositionId: 2, proTeamId: pro,
        stats: [
          { scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: proj },
          ...(week === 3 && pts !== null ? [{ scoringPeriodId: week, statSourceId: 0, statSplitTypeId: 1, appliedTotal: pts }] : []),
        ],
      },
    })),
  };
}

function proPayload(mode) {
  const wk = (id) => {
    const out = {
      1: [{ date: NOW - 14 * 24 * H, statsOfficial: true }],
      2: [{ date: NOW - 7 * 24 * H, statsOfficial: true }],
      4: [{ date: NOW + 7 * 24 * H, statsOfficial: false }],
    };
    if (id === 1) out[3] = [{ date: NOW - 6 * H, statsOfficial: true }];
    // `lateGame`: pro 2 kicked off 100 minutes ago and is still being played.
    if (id === 2) out[3] = mode.lateGame
      ? [{ date: NOW - 100 * MIN, statsOfficial: false }]
      : [{ date: NOW - 6 * H, statsOfficial: true }];
    if (id === 3) out[3] = [{ date: NOW + 20 * H, statsOfficial: false }];
    return out;                                  // pro 4: no week 3 — its bye
  };
  return {
    settings: {
      proTeams: [1, 2, 3, 4].map((id) => ({ id, byeWeek: id === 4 ? 3 : 9, proGamesByScoringPeriod: wk(id) })),
    },
  };
}

/** A counting ESPN. `mode.deadLeague` refuses every league read (a phone). */
function installFetch(mode = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const isPro = /proTeamSchedules_wl/.test(u);
    if (mode.dead || (mode.deadLeague && !isPro) || (mode.noPro && isPro)) {
      return { ok: false, status: 401, async json() { return {}; } };
    }
    let body;
    if (isPro) body = proPayload(mode);
    else if (/kona_player_info/.test(u)) body = wirePayload(Number((u.match(/scoringPeriodId=(\d+)/) || [])[1] || 1));
    else if (/scoringPeriodId=(\d+)/.test(u)) body = rosterPayload(Number(u.match(/scoringPeriodId=(\d+)/)[1]), mode);
    else body = leaguePayload(mode);
    return { ok: true, status: 200, async json() { return JSON.parse(JSON.stringify(body)); } };
  };
  return calls;
}

const count = (calls, re) => calls.filter((u) => re.test(u)).length;
const PRO = /proTeamSchedules_wl/;
const ROSTER = /mRoster/;
const SCHED = /mMatchupScore/;

function installStorage() {
  const map = new Map();
  const api = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  globalThis.localStorage = api;
  return map;
}

/** The stored copy of one week, parsed, or null. */
function storedWeek(map, week) {
  const key = [...map.keys()].find((k) => k.endsWith(`.${LEAGUE_ID}.${SEASON}.${week}`));
  return key ? { key, entry: JSON.parse(map.get(key)) } : null;
}

async function boot(mode = {}, { storage = true } = {}) {
  const map = storage ? installStorage() : null;
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '' });
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));
  espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
  const calls = installFetch(mode);
  return { cloud, espn, season, calls, map };
}

const byId = (teams, id) => teams.flatMap((t) => t.players).find((p) => p.playerId === id);
const findGame = (s, week, homeId) => s.byWeek.get(week).find((g) => g.homeId === homeId);
const DECIDED_KEYS = ['awayId', 'awayName', 'awayScore', 'homeId', 'homeName', 'homeScore', 'margin', 'played', 'week', 'winner'];

// ------------------------------------------------------------ scenarios

const SCENARIOS = {
  // The rules on their own: no fetching.
  async pure() {
    const capture = await import(moduleUrl('js/capture.js'));
    const floor = await import(moduleUrl('js/floor.js'));
    const stats = await import(moduleUrl('js/stats.js'));

    // --- capture.playerDone(game, asOf, now), every branch
    const T = 1791133200000;
    const over = { at: T - 6 * H, done: true };
    const D = capture.playerDone;
    ok('playerDone is exported', typeof D === 'function');
    if (typeof D !== 'function') return;
    eq(D(undefined, T, T), true, 'no game that week (bye / no pro team): nothing to wait for');
    eq(D(null, T - 9 * H, T), true, 'no game, old reading: still done');
    eq(D(over, T, T), true, 'game over and the reading taken just now: done');
    eq(D(over, T - 15 * MIN, T), true, 'game over, reading 15 minutes old: still trusted');
    eq(D(over, T - 16 * MIN, T), true, 'reading 16 min old but taken 344 min after kickoff: done (>= 270 min)');
    eq(D(over, T - 6 * H + 270 * MIN, T), true, 'reading taken exactly 270 minutes after kickoff: done');
    eq(D(over, T - 6 * H + 269 * MIN, T), false, 'reading taken 269 minutes after kickoff and 91 min old: NOT done — its points may predate the whistle');
    eq(D(over, T - 6 * H + 100 * MIN, T), false, 'a stale reading from mid-game is not done, though the game is over now');
    eq(D({ at: T - 6 * H, done: false }, T, T), false, 'six hours since kickoff but ESPN has not said it is over: never inferred from the clock');
    eq(D({ at: T - 100 * MIN, done: false }, T, T), false, 'a game being played is not done');
    eq(D({ at: T + 20 * H, done: false }, T, T), false, 'a game not kicked off is not done');
    eq(D(over, null, T), false, 'game over but nobody knows when the reading was taken: not done');

    // --- capture.gameState: an early final is final even with a side on zero
    const g = { week: 3, homeId: 1, awayId: 2, homeScore: 31.5, awayScore: 0, played: true };
    eq(capture.gameState(g), 'live', 'as before: played with one side on zero reads live');
    eq(capture.gameState({ ...g, early: true }), 'final', 'an early final reads final, a zero side or not');
    eq(capture.winnerOf({ ...g, early: true }), 'home', 'and has its winner');
    eq(capture.gameState({ ...g, early: true, played: false }), 'live', 'early without played means nothing');

    // --- floor: a finished score is a fact and is never lifted
    const floors = floor.positionFloors([
      { position: 'K', projected: 9, playerId: 1 }, { position: 'K', projected: 8, playerId: 2 },
      { position: 'K', projected: 7, playerId: 3 },
    ]);
    eq(floor.flooredValue({ position: 'K', projected: 2 }, floors).value, 7, 'a kicker projected 2 is assessed at the wire’s 7');
    const fact = floor.flooredValue({ position: 'K', projected: 2, pregame: 8, done: true }, floors);
    eq([fact.value, fact.raw, fact.assumed], [2, 2, false], 'a kicker who FINISHED on 2 is 2: not lifted, not marked assumed');
    const line = floor.assessLineup([{ slotId: 17, position: 'K', projected: 2, done: true }], [17, 17], floors);
    eq([line.total, line.assumed], [9, 1], 'in a lineup: the finished 2 stands, the EMPTY second slot is still worth the floor (2 + 7)');

    // --- stats.playerFitPoints: a finished man is his pre-game projection against his score
    const pts = stats.playerFitPoints(new Map([[3, [{
      id: 1,
      players: [
        { playerId: 1, name: 'done', projected: 25.5, pregame: 20, actual: 25.5, done: true },
        { playerId: 2, name: 'no pregame', projected: 6, pregame: null, actual: 6, done: true },
        { playerId: 3, name: 'playing', projected: 10, actual: 4, done: false },
        { playerId: 4, name: 'final week', projected: 12, actual: 15 },
        { playerId: 5, name: 'bye', projected: 0, pregame: 0, actual: null, done: true },
      ],
    }]]]), [3]);
    eq(pts.map((p) => [p.playerId, p.x, p.y]), [[1, 20, 25.5], [3, 10, 4], [4, 12, 15]],
      'x is the pre-game projection for a finished man (never his score against itself); no pre-game number, no dot');

    // --- capture.liveWeek: the same answer for an annotated week
    const K = NOW;
    const proGames = {
      1: { 4: { at: K - 5 * H, done: true } },
      2: { 4: { at: K - 95 * MIN, done: false } },
      3: { 4: { at: K + 3 * H, done: false } },
    };
    const man = (position, lineupSlotId, proTeamId, projected, actual = null, extra = {}) => ({
      position, lineupSlotId, proTeamId, projected, actual,
      started: lineupSlotId !== 20 && lineupSlotId !== 21, ...extra,
    });
    const raw = [
      { id: 1, players: [man('QB', 0, 1, 20, 26), man('RB', 2, 2, 12, 8), man('WR', 4, 3, 10), man('WR', 20, 3, 14)] },
      // Two: QB and RB over, and the WR's team (pro 4) is on bye — he scores nothing.
      { id: 2, players: [man('QB', 0, 1, 15, 10), man('RB', 2, 1, 10, 5), man('WR', 4, 4, 0), man('WR', 20, 3, 9)] },
    ];
    const done = (p, pregame) => ({ ...p, done: true, pregame, projected: typeof p.actual === 'number' ? p.actual : 0 });
    const annotated = [
      { id: 1, players: [done(raw[0].players[0], 20), ...raw[0].players.slice(1).map((p) => ({ ...p, done: false }))] },
      { id: 2, players: [done(raw[1].players[0], 15), done(raw[1].players[1], 10), done(raw[1].players[2], 0), { ...raw[1].players[3], done: false }] },
    ];
    const data = capture.normalizeSchedule({
      teams: [{ id: 1, name: 'One' }, { id: 2, name: 'Two' }],
      games: [
        { week: 3, homeId: 1, awayId: 2, homeScore: 90, awayScore: 80, played: true },
        { week: 4, homeId: 1, awayId: 2, homeScore: 34, awayScore: 15, played: false },
      ],
    }, { isDemo: false });
    const lw = (teams) => capture.liveWeek({ data, weekTeams: new Map([[4, teams]]), slots: [0, 2, 4], proGames, asOf: K, now: K });
    const before = lw(raw).teams.get(1);
    const after = lw(annotated).teams.get(1);
    // One: 26 + 8 banked; 6 (half of 12) + 14 (the benched WR for the open slot) to come; whole 20 + 12 + 14.
    near(before.mean, 54, 1e-9, 'raw week: 34 banked + 20 to come');
    near(after.mean, 54, 1e-9, 'annotated week: the same expected final');
    near(after.left, Math.sqrt(20 / 46), 1e-9, 'annotated week: the same share of the spread — the whole lineup is measured in PRE-GAME points (20, not his 26)');
    eq(after.banked, before.banked, 'and the same points banked');
    const two = lw(annotated).teams.get(2);
    eq([two.mean, two.left, two.banked], [15, 0, 15], 'every starter finished (one of them on bye): the squad IS its score, nothing left, no bench man played in');
  },

  // Contract A through season.js: the roster read, annotated on the way out.
  async rosters() {
    const { season, espn, map } = await boot();
    const s = await season.fetchSchedule({ settle: false });
    eq(findGame(s, 3, 1).played, false, 'settle:false leaves the week as ESPN has it');

    const { teams } = await season.fetchWeekRosters(3);
    const a0 = byId(teams, 100);
    eq([a0.done, a0.pregame, a0.projected, a0.actual], [true, 20, 25.5, 25.5], 'A’s QB, game over: done, pregame 20, projected overwritten with his 25.5');
    const b1 = byId(teams, 201);
    eq([b1.done, b1.pregame, b1.projected, b1.actual], [true, 0, 0, null], 'B’s RB, team on bye: done, and worth 0');
    const c1 = byId(teams, 301);
    eq([c1.done, c1.projected, 'pregame' in c1], [false, 11, false], 'C’s RB plays Monday: done false, projection untouched, no pregame key');
    const d2 = byId(teams, 402);
    eq([d2.done, d2.pregame, d2.projected], [true, 5, 3], 'a BENCH man who has finished is done too');
    ok('every player in the open week says done one way or the other',
      teams.flatMap((t) => t.players).every((p) => typeof p.done === 'boolean'));

    const A = teams.find((t) => t.id === 1);
    eq([A.projectedTotal, A.actualTotal], [30, 31.5], 'the team’s projectedTotal stays the PRE-GAME 20 + 10');
    ok('starters / bench are the same annotated objects as players',
      A.starters.every((p) => A.players.includes(p)) && A.bench.every((p) => A.players.includes(p)));
    eq(A.starters.map((p) => p.done), [true, true], 'so a starter read off `starters` is annotated too');

    // The stored copy stays raw.
    const held = storedWeek(map, 3);
    ok('the week was stored', !!held);
    const rawA0 = held.entry.teams.flatMap((t) => t.players).find((p) => p.playerId === 100);
    eq([rawA0.projected, 'done' in rawA0, 'pregame' in rawA0], [20, false, false], 'the store holds the raw reading: projection 20, no done, no pregame');
    eq(held.entry.final, false, 'and is NOT frozen: the week is still open');

    // Several weeks at once: the same annotation.
    const many = await season.fetchWeeksRosters([1, 3, 4]);
    eq(byId(many.get(3), 100).done, true, 'fetchWeeksRosters annotates the open week');
    const w1 = many.get(1).flatMap((t) => t.players);
    ok('a week ESPN has decided is exactly as before: no done, no pregame',
      w1.every((p) => !('done' in p) && !('pregame' in p)));
    eq(byId(many.get(1), 100).projected, 20, 'and its projection is still the projection (he scored 22)');
    const w4 = many.get(4).flatMap((t) => t.players);
    ok('a week not begun: nobody done, nothing changed', w4.every((p) => p.done === false && !('pregame' in p)));
    eq(byId(many.get(4), 201).projected, 0, 'week 4, B’s RB: his projection as ESPN sent it');

    // A STALE COPY. The store's week 3 becomes two hours old (240 min after
    // kickoff, under 270) and ESPN refuses a re-read: the old copy is served,
    // and its points are not trusted to be final.
    held.entry.at = Date.now() - 2 * H;
    map.set(held.key, JSON.stringify(held.entry));
    installFetch({ dead: true });
    espn.clearReadCache();
    const stale = await season.fetchWeekRosters(3);
    eq(stale.from, 'store', 'ESPN down: the two-hour-old copy is served');
    const s0 = byId(stale.teams, 100);
    eq([s0.done, s0.projected], [false, 20], 'read 240 min after kickoff, 2 h ago: his game is over NOW but this copy may not hold his final points — not done');
    eq(byId(stale.teams, 201).done, true, 'the man on bye is done on any copy');
    held.entry.at = Date.now() - 1 * H;           // 300 minutes after kickoff
    map.set(held.key, JSON.stringify(held.entry));
    const settled = await season.fetchWeekRosters(3);
    eq([byId(settled.teams, 100).done, byId(settled.teams, 100).projected], [true, 25.5], 'a copy read 300 min after kickoff holds the final number: done');
  },

  // A final week read BEFORE the schedule, and demo: both exactly as before.
  async 'final-first'() {
    const { season, espn, calls } = await boot();
    const { teams } = await season.fetchWeekRosters(1);
    ok('week 1 read before the schedule: still no done / pregame on anybody',
      teams.flatMap((t) => t.players).every((p) => !('done' in p) && !('pregame' in p)),
      JSON.stringify(byId(teams, 100)));
    eq(byId(teams, 100).projected, 20, 'and the projection is the projection, not his 22');
    eq(count(calls, SCHED), 1, 'it cost one schedule read to learn the week was final');

    espn.configure({ leagueId: 'demo' });
    const before = calls.length;
    const demo = await season.fetchWeekRosters(3);
    ok('demo: no done, no pregame', demo.teams.flatMap((t) => t.players).every((p) => !('done' in p) && !('pregame' in p)));
    eq(byId(demo.teams, 100).projected, 20, 'demo: projection untouched');
    eq(count(calls.slice(before), PRO), 0, 'demo asks nobody about NFL games');
  },

  // No NFL games known: nobody is done and nothing changes.
  async 'no-pro'() {
    const { season } = await boot({ noPro: true });
    const s = await season.fetchSchedule();
    eq(findGame(s, 3, 1).played, false, 'no NFL games read: nothing is settled');
    const { teams } = await season.fetchWeekRosters(3);
    const all = teams.flatMap((t) => t.players);
    ok('every player done:false', all.every((p) => p.done === false && !('pregame' in p)));
    eq(byId(teams, 100).projected, 20, 'projection untouched');
  },

  // Contract A on the wire, and the floor that is read off it.
  async wire() {
    const { season } = await boot();
    await season.fetchSchedule({ settle: false });
    const wire = await season.fetchWireWeek(3);
    eq(wire.map((p) => [p.playerId, p.done, p.projected, p.pregame ?? null]),
      [[901, true, 9, 5], [902, false, 7, null], [903, true, 0, 0], [904, true, 1, 6], [905, true, 14, 4]],
      'the wire: finished men carry their points as projected and the projection as pregame');
    ok('a man still to play has no pregame key', !('pregame' in wire[1]));
    const past = await season.fetchWireWeek(1);
    ok('a decided week’s wire is untouched', past.every((p) => !('done' in p) && !('pregame' in p)));
    const floors = await season.fetchFloors(3);
    eq(floors.get('RB').value, 5, 'the positional floor is still the 3rd-best PRE-GAME projection (5), not hindsight (7)');
  },

  // Contract B: a matchup whose every starter has finished is final now.
  async settle() {
    const { season, espn, calls, map } = await boot();
    const s = await season.fetchSchedule();
    const ab = findGame(s, 3, 1);
    eq([ab.played, ab.winner, ab.margin, ab.early], [true, 'home', 19.5, true], 'A–B: every starter finished — final, home by 19.5, early');
    eq([ab.homeScore, ab.awayScore], [31.5, 12], 'the scores are ESPN’s own running totals');
    eq(Object.keys(ab).sort(), [...DECIDED_KEYS, 'early'].sort(), 'an early game is the normal shape plus `early`');
    ok('the same object is in games', s.games.includes(ab));
    const cd = findGame(s, 3, 3);
    eq([cd.played, cd.winner, cd.margin, 'early' in cd], [false, null, null, false], 'C–D: C’s RB and D’s starters play Monday — untouched');
    eq(Object.keys(findGame(s, 1, 1)).sort(), DECIDED_KEYS, 'a game ESPN decided carries no `early` key at all');
    ok('no week-4 game is touched', s.byWeek.get(4).every((g) => !g.played && !('early' in g)));
    eq([count(calls, SCHED), count(calls, PRO), count(calls, ROSTER)], [1, 1, 1],
      'cost: the schedule, one NFL-schedule read, one roster read (week 3)');

    // THE STORE-FREEZE GUARD. An early game must not mark the week played for
    // the store: its rosters stay on the live clock while C–D is still scoring.
    eq(storedWeek(map, 3).entry.final, false, 'week 3’s rosters are stored NOT final, early game or no');
    await season.fetchWeekRosters(1);
    eq(storedWeek(map, 1).entry.final, true, 'while a week ESPN decided is frozen as ever');
    const held = storedWeek(map, 3);
    held.entry.at = Date.now() - 6 * MIN;         // older than the 5-minute live clock
    map.set(held.key, JSON.stringify(held.entry));
    const n = count(calls, ROSTER);
    espn.clearReadCache();                        // past the 60-second shared read
    const again = await season.fetchWeekRosters(3);
    eq([again.from, count(calls, ROSTER) - n], ['espn', 1], 'and six minutes on it is re-read from ESPN, not served as history');
    eq(storedWeek(map, 3).entry.final, false, 'the re-read is stored not final too');

    // The capture model banks it: gameState final, so the simulation counts a whole win.
    const capture = await import(moduleUrl('js/capture.js'));
    const data = capture.normalizeSchedule(s, { isDemo: false });
    eq(capture.gameState(findGame(data, 3, 1)), 'final', 'gameState: the early game is final');
    eq(capture.openWeeks(data), [3, 4], 'week 3 is still open (C–D)');
    const inputs = capture.simulationInputs({
      data, isRemaining: (g) => capture.gameState(g) !== 'final', proj: null, sigma: 20,
    });
    eq([inputs.banked.get(1).wins, inputs.banked.get(2).wins], [2.5, 1], 'banked: A 2-0-1 with the early win, B 1-2');
    eq(inputs.games.filter((g) => g.week === 3).map((g) => [g.homeId, g.awayId]), [[3, 4]], 'only C–D of week 3 is left to play out');

    // fetchSeasonData: the early game is in, with PRE-GAME started projections.
    const d = await season.fetchSeasonData();
    eq(d.games.length, 5, 'the stats path: four decided games and the early one');
    eq(d.games.find((g) => g.week === 3),
      { week: 3, homeId: 1, awayId: 2, homeActual: 31.5, awayActual: 12, homeProjected: 30, awayProjected: 18 },
      'in its own shape: actual 31.5–12 against the pre-game 20+10 and 18+0');
    ok('C–D is not in the stats', !d.games.some((g) => g.week === 3 && g.homeId === 3));
  },

  // The gate: no score on the board, nothing extra is asked.
  async gate() {
    const { season, calls } = await boot({ noScore: true });
    const s = await season.fetchSchedule();
    eq(calls.length, 1, 'no undecided game has a point: fetchSchedule is one request, as ever');
    eq([count(calls, PRO), count(calls, ROSTER)], [0, 0], 'no NFL-schedule read and no roster read');
    ok('nothing settled', s.games.every((g) => !('early' in g)) && s.games.filter((g) => g.played).length === 4);
  },

  // One starter still on the field: untouched.
  async 'late-game'() {
    const { season } = await boot({ lateGame: true });
    const s = await season.fetchSchedule();
    const ab = findGame(s, 3, 1);
    eq([ab.played, 'early' in ab], [false, false], 'A’s RB is 100 minutes into his game: A–B is not final');
    const { teams } = await season.fetchWeekRosters(3);
    eq([byId(teams, 100).done, byId(teams, 101).done], [true, false], 'his QB is done, his RB is not');
  },

  // A side with nobody starting: untouched.
  async 'no-starters'() {
    const { season } = await boot({ noStarters: true });
    const s = await season.fetchSchedule();
    const ab = findGame(s, 3, 1);
    eq([ab.played, 'early' in ab], [false, false], 'B starts nobody: "every starter finished" is vacuous, so nothing is settled');
  },

  // The upload is the raw reading; the phone settles from its own evidence.
  async cloud() {
    const cloud = await import(moduleUrl('js/cloud.js'));
    const ownerUid = (readFileSync(path.join(REPO, 'js/cloud.js'), 'utf8').match(/ownerUid:\s*'([^']*)'/) || [])[1];
    const docs = new Map();
    const user = { uid: ownerUid, email: 't@example.com', name: 'T' };
    cloud.configure({
      transport: {
        async signIn() { return user; },
        async signOut() {},
        currentUser() { return user; },
        onAuth(cb) { cb(user); return () => {}; },
        async getDoc(p) { const r = docs.get(p); return r === undefined ? null : JSON.parse(r); },
        async setDoc(p, d) { docs.set(p, JSON.stringify(d)); },
      },
    });
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(moduleUrl('js/season.js'));
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });

    installFetch();
    const payload = await season.buildCloudPayload();
    ok('the uploaded schedule is UNSETTLED: no early game, week 3 not played',
      payload.schedule.games.every((g) => !('early' in g)) && payload.schedule.byWeek.get(3).every((g) => !g.played));
    const up3 = payload.rosters.get(3).flatMap((t) => t.players);
    ok('the uploaded rosters are raw: no done, no pregame', up3.every((p) => !('done' in p) && !('pregame' in p)));
    eq(up3.find((p) => p.playerId === 100).projected, 20, 'and the projection is the projection');
    ok('the uploaded wire is raw too', payload.wire.get(3).every((p) => !('done' in p)));
    const up = await cloud.syncUp(LEAGUE_ID, SEASON, payload);
    ok('the sync is written', up.ok, up.reason);

    // The phone: ESPN refuses the league, the public NFL schedule still answers.
    espn.clearReadCache();
    const calls = installFetch({ deadLeague: true });
    const s = await season.fetchSchedule();
    const ab = findGame(s, 3, 1);
    eq([ab.played, ab.winner, ab.margin, ab.early], [true, 'home', 19.5, true], 'the phone settles A–B from its own synced rosters');
    eq(findGame(s, 3, 3).played, false, 'and leaves C–D');
    eq(count(calls, /\/leagues\//), 0, 'without a single league read');
    const { teams } = await season.fetchWeekRosters(3);
    eq([byId(teams, 100).done, byId(teams, 100).projected], [true, 25.5], 'the synced week is annotated on the way out');
    const d = await season.fetchSeasonData();
    eq(d.games.find((g) => g.week === 3),
      { week: 3, homeId: 1, awayId: 2, homeActual: 31.5, awayActual: 12, homeProjected: 30, awayProjected: 18 },
      'the stats path from the cloud carries the early game with pre-game projections');
    eq(d.games.length, 5, 'five games in all');
  },

  // An OLD sync: its points are from mid-game, so nothing is settled from it.
  async 'cloud-old'() {
    const cloud = await import(moduleUrl('js/cloud.js'));
    const ownerUid = (readFileSync(path.join(REPO, 'js/cloud.js'), 'utf8').match(/ownerUid:\s*'([^']*)'/) || [])[1];
    const docs = new Map();
    const user = { uid: ownerUid, email: 't@example.com', name: 'T' };
    cloud.configure({
      transport: {
        async signIn() { return user; },
        async signOut() {},
        currentUser() { return user; },
        onAuth(cb) { cb(user); return () => {}; },
        async getDoc(p) { const r = docs.get(p); return r === undefined ? null : JSON.parse(r); },
        async setDoc(p, d) { docs.set(p, JSON.stringify(d)); },
      },
    });
    const map = installStorage();
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(moduleUrl('js/season.js'));
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
    installFetch();
    const up = await cloud.syncUp(LEAGUE_ID, SEASON, await season.buildCloudPayload());
    ok('the sync is written', up.ok, up.reason);
    map.clear();                                   // the phone is another browser

    // Age every timestamp in the sync by two hours: taken 240 min after kickoff.
    const old = new Date(Date.now() - 2 * H).toISOString();
    let aged = 0;
    for (const [p, raw] of docs) {
      const doc = JSON.parse(raw);
      if (typeof doc.syncedAt === 'string') { doc.syncedAt = old; aged++; }
      if (doc.syncedShapes) for (const k of Object.keys(doc.syncedShapes)) if (doc.syncedShapes[k]) doc.syncedShapes[k] = old;
      docs.set(p, JSON.stringify(doc));
    }
    ok('the sync was aged', aged > 0);

    espn.clearReadCache();
    installFetch({ deadLeague: true });
    const s = await season.fetchSchedule();
    eq(findGame(s, 3, 1).played, false, 'a sync from 240 min after kickoff, two hours old: A–B is NOT settled from it');
    const first = await season.fetchWeekRosters(3);
    eq(byId(first.teams, 100).done, false, 'nor is his QB done on it');
    // The copy this browser keeps of the synced week carries the SYNC's time,
    // so the next page does not mistake it for a reading taken just now.
    const held = storedWeek(map, 3);
    ok('the synced week is kept in the store', !!held);
    ok('stamped with the sync’s time, not the time it was copied',
      held && Math.abs(held.entry.at - Date.parse(old)) < 1000, held && String(Date.now() - held.entry.at));
    const second = await season.fetchWeekRosters(3);
    eq(byId(second.teams, 100).done, false, 'served again: still not done');
  },
};

// ------------------------------------------------------------------ run

const scen = process.argv[2];
if (scen) {
  try {
    await SCENARIOS[scen]();
  } catch (err) {
    fails.push(`threw: ${err && err.stack || err}`);
  }
  console.log(JSON.stringify({ scen, pass, fails }));
  process.exit(fails.length ? 1 : 0);
}

const self = fileURLToPath(import.meta.url);
let total = 0;
let bad = 0;
for (const name of Object.keys(SCENARIOS)) {
  const res = spawnSync(process.execPath, [self, name], { encoding: 'utf8', timeout: 60000 });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop() || '';
  let r = null;
  try { r = JSON.parse(line); } catch { /* below */ }
  if (!r) {
    bad++;
    console.log(`FAIL ${name}\n  stdout=${(res.stdout || '').slice(0, 800)}\n  stderr=${(res.stderr || '').slice(0, 1500)}`);
    continue;
  }
  total += r.pass;
  console.log(`${r.fails.length ? 'FAIL' : 'PASS'} ${name}  (${r.pass} assertions)`);
  for (const f of r.fails) console.log(`   - ${f}`);
  if (r.fails.length) bad++;
}
if (bad) {
  console.log(`\n${bad} scenario(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${total} assertions passed across ${Object.keys(SCENARIOS).length} scenarios`);
