// A stubbed live league for the time machine's capture and for the Summary /
// Schedule agreement check. Stands in for js/season.js.
//
// Chosen to exercise exactly the things those two suites are about:
//
//   - 10 teams, 14 regular-season weeks, weeks 1–3 DECIDED. Three weeks is the
//     Summary page's minimum, so both pages simulate.
//   - One decided game is a TIE, so "a tie is half a win" is on trial in the
//     banked table and the standings.
//   - Every roster week carries `projectedTotal` — the started lineup's
//     projection, as js/season.js computes it — so the scoring spread is
//     CALIBRATED (thirty team-weeks) rather than assumed. A stub with no
//     residuals would let two pages agree by both falling back to the default.
//   - The league DECLARES a four-team bracket (CAP_PLAYOFF_TEAMS, default 4),
//     where the fallback is six — the Summary page used to ignore it.
//
// Env switches: CAP_ROSTERS_FAIL (every roster week throws), CAP_CLOUD (the
// data is the synced cloud copy), CAP_PLAYOFF_TEAMS.
//
// DECEMBER (AUDIT §2.1): CAP_DECIDED (how many regular weeks are decided,
// default 3; 14 = the regular season is over), CAP_PLAYOFF_DECIDED (how many
// playoff weeks are decided, default 0). Once the regular season is decided the
// schedule carries `playoffGames` in js/season.js's shape — the winners'
// bracket with its top-seed BYE entries (never `played`, as ESPN sends them)
// and the consolation games. CAP_ROSTERS_REFUSE="16,17" makes just those roster
// weeks throw.
//
// THE WEEK IN PROGRESS (Tim, 2026-10-04; the contract is in done-fixture.mjs).
// CAP_EARLY=1: in the first undecided week the FIRST game is final early —
// every starter on both sides is `done`, the game is `played, early` with the
// started lineups' scores — one more squad has just its QB done, and the NFL's
// games (`fetchProGames`) all kicked off 100 minutes ago, so the other four
// games are in progress. CAP_EARLY=all: every game of that week is final early.
// CAP_EARLY=mix: the three kinds of matchup at once, as on a Sunday night — the
// first game final early, the LAST one not kicked off at all (both squads' men
// all play for NFL team 10, whose game is tomorrow), the three between them
// being played, and — as js/season.js sends a game in play — carrying the
// points so far as their scores, `played: false`.
//
// A test fixture: it lives in tests/ and is never served by the site.

import { markDone, earlyFinal, startedScore } from './done-fixture.mjs';

export const calls = { schedule: 0, rosters: [], seasonData: 0, cloud: 0 };

const TEAMS = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Manager ${i + 1}`, teamName: `Squad ${i + 1}` }));
export const WEEKS = Array.from({ length: 14 }, (_, i) => i + 1);
export const DECIDED = 3;
const decided = () => Number(process.env.CAP_DECIDED || DECIDED);
const r1 = (n) => Math.round(n * 10) / 10;

function rnd(a, b) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function fixturesFor(week) {
  const ids = TEAMS.map((t) => t.id);
  const fixed = ids[0];
  const rot = ids.slice(1);
  const shift = (week - 1) % rot.length;
  const ring = [fixed, ...rot.slice(shift), ...rot.slice(0, shift)];
  const out = [];
  for (let i = 0; i < ring.length / 2; i++) {
    const a = ring[i];
    const b = ring[ring.length - 1 - i];
    out.push(week % 2 === 0 ? [a, b] : [b, a]);
  }
  return out;
}

function scoreOf(teamId, week) {
  return r1(88 + rnd(teamId, week * 3 + 1) * 60);
}

export async function fetchSchedule() {
  calls.schedule++;
  const nameById = new Map(TEAMS.map((t) => [t.id, t.name]));
  const byWeek = new Map();
  for (const w of WEEKS) {
    byWeek.set(w, fixturesFor(w).map(([homeId, awayId], i) => {
      const played = w <= decided();
      let hs = played ? scoreOf(homeId, w) : null;
      let as = played ? scoreOf(awayId, w) : null;
      // THE TIE: week 2's first game finishes level.
      if (played && w === 2 && i === 0) { hs = 111.1; as = 111.1; }
      if (earlyGame(w, i)) {
        const now = new Map(teamsFor(w).map((t) => [t.id, t]));
        return earlyFinal({
          week: w,
          homeId, homeName: nameById.get(homeId),
          awayId, awayName: nameById.get(awayId),
        }, startedScore(now.get(homeId)), startedScore(now.get(awayId)));
      }
      // mix: a game being played shows the points so far and is not `played`.
      if (EARLY === 'mix' && w === EARLY_WEEK && !lateSquads().includes(homeId)) {
        const now = new Map(teamsFor(w).map((t) => [t.id, t]));
        hs = startedScore(now.get(homeId));
        as = startedScore(now.get(awayId));
      }
      return {
        week: w,
        homeId, homeName: nameById.get(homeId), homeScore: hs,
        awayId, awayName: nameById.get(awayId), awayScore: as,
        played,
        margin: played ? r1(hs - as) : null,
        winner: played ? (hs > as ? 'home' : as > hs ? 'away' : 'tie') : null,
      };
    }));
  }
  const field = Number(process.env.CAP_PLAYOFF_TEAMS || 4);
  return {
    playoffGames: playoffGamesFor(field, nameById),
    leagueName: 'Capture Stub League',
    teams: TEAMS.map((t) => ({ id: t.id, name: t.name, teamName: t.teamName })),
    playoffs: {
      regularSeasonWeeks: WEEKS.length,
      playoffTeams: field,
      weeksPerPlayoffRound: 1,
      reseed: false,
      seedingRule: 'TOTAL_POINTS_SCORED',
      divisions: 1,
    },
    weeks: WEEKS.slice(),
    byWeek,
    games: WEEKS.flatMap((w) => byWeek.get(w)),
  };
}

/**
 * The bracket and consolation games, once the regular season is decided.
 * Seeds are team ids 1..10 in order (the ids are arbitrary here; nothing reads
 * the seeding off these games). Rounds follow the field: 4 -> 2, 6 -> 3.
 */
function playoffGamesFor(field, nameById) {
  if (decided() < WEEKS.length) return [];
  const rounds = field > 4 ? 3 : 2;
  const done = Number(process.env.CAP_PLAYOFF_DECIDED || 0);
  const out = [];
  const game = (week, homeId, awayId, tier) => {
    const played = awayId != null && week - WEEKS.length <= done;
    const hs = played ? scoreOf(homeId, week) : null;
    const as = played ? scoreOf(awayId, week) : null;
    out.push({
      week, homeId, homeName: nameById.get(homeId), homeScore: hs,
      awayId: awayId ?? null, awayName: awayId != null ? nameById.get(awayId) : 'BYE', awayScore: as,
      played,
      margin: played ? r1(hs - as) : null,
      winner: played ? (hs > as ? 'home' : as > hs ? 'away' : 'tie') : null,
      tier,
    });
  };
  for (let r = 0; r < rounds; r++) {
    const week = WEEKS.length + 1 + r;
    if (rounds === 3 && r === 0) {
      game(week, 1, null, 'WINNERS_BRACKET');        // the top two seeds' byes
      game(week, 2, null, 'WINNERS_BRACKET');
      game(week, 3, 6, 'WINNERS_BRACKET');
      game(week, 4, 5, 'WINNERS_BRACKET');
    } else {
      game(week, 1, 4, 'WINNERS_BRACKET');
      game(week, 2, 3, 'WINNERS_BRACKET');
    }
    game(week, 7, 10, 'LOSERS_CONSOLATION_LADDER');
    game(week, 8, 9, 'LOSERS_CONSOLATION_LADDER');
  }
  return out;
}

// 1 QB, 2 RB, 3 WR, 1 TE, FLEX, D/ST, K and four on the bench.
const SHAPE = [
  ['QB', 0], ['RB', 2], ['RB', 2], ['WR', 4], ['WR', 4], ['WR', 4],
  ['TE', 6], ['RB', 23], ['DST', 16], ['K', 17],
  ['RB', 20], ['WR', 20], ['QB', 20], ['TE', 20],
];

// ---- the week in progress (CAP_EARLY) ----
const EARLY = process.env.CAP_EARLY || '';
export const EARLY_WEEK = EARLY ? decided() + 1 : null;
/** Is game `i` of week `w` final before ESPN closed the week? */
const earlyGame = (w, i) => Boolean(EARLY) && w === EARLY_WEEK && (EARLY === 'all' || i === 0);
/** The squads whose own matchup is final early. */
export function earlySquads() {
  if (!EARLY) return [];
  return fixturesFor(EARLY_WEEK).filter((_, i) => earlyGame(EARLY_WEEK, i)).flat();
}
/** The one squad still playing that has a single finished man (its QB). */
export const ONE_DONE_SQUAD = EARLY === '1' || EARLY === 'mix' ? fixturesFor(decided() + 1)[1][0] : null;
/** mix: the two squads of the last game, neither of which has kicked off. */
export function lateSquads() {
  return EARLY === 'mix' ? fixturesFor(EARLY_WEEK).slice(-1).flat() : [];
}
/** The NFL team whose game is tomorrow (mix). */
const LATE_PRO_TEAM = 10;

function inProgress(week, teams) {
  const over = new Set(earlySquads());
  const late = new Set(lateSquads());
  // What a finished man scored: his projection, moved by up to 40% either way.
  const scored = teams.map((t) => ({
    ...t,
    players: t.players.map((p, i) => ({
      ...p, actual: r1(p.projected * (0.6 + rnd(t.id * 31 + i, week + 50) * 0.8)),
      ...(late.has(t.id) ? { proTeamId: LATE_PRO_TEAM } : {}),
    })),
  }));
  return markDone(
    scored,
    (p, t) => (over.has(t.id) && p.started) || (t.id === ONE_DONE_SQUAD && p.position === 'QB' && p.started),
    // Not done: a running score for the first RB, nothing yet for anybody else
    // — and nothing at all for a squad that has not kicked off.
    (p, t) => (!late.has(t.id) && p.started && p.lineupSlotId === 2 ? 3.3 : null),
  );
}

// The NFL's games, `{ proTeamId: { week: {at, done} } }`: every one kicked off
// 100 minutes ago and none is official, so each squad still playing is live.
export const fetchProGames = EARLY
  ? async () => {
    const out = {};
    for (let id = 2; id <= 9; id++) out[id] = { [EARLY_WEEK]: { at: Date.now() - 100 * 60 * 1000, done: false } };
    if (EARLY === 'mix') out[LATE_PRO_TEAM] = { [EARLY_WEEK]: { at: Date.now() + 24 * 60 * 60 * 1000, done: false } };
    return out;
  }
  : undefined;

export async function fetchWeekRosters(week) {
  calls.rosters.push(week);
  if (process.env.CAP_ROSTERS_FAIL) throw new Error('ESPN would not return rosters.');
  if ((process.env.CAP_ROSTERS_REFUSE || '').split(',').map(Number).includes(Number(week))) {
    throw new Error(`ESPN would not return week ${week}.`);
  }
  return { week, teams: teamsFor(week) };
}

function teamsFor(week) {
  const plain = plainTeams(week);
  return EARLY && Number(week) === EARLY_WEEK ? inProgress(Number(week), plain) : plain;
}

function plainTeams(week) {
  const teams = TEAMS.map((t) => {
    const players = SHAPE.map(([position, lineupSlotId], i) => {
      const base = { QB: 19, RB: 12, WR: 12, TE: 9, K: 8, DST: 7 }[position];
      return {
        playerId: t.id * 100 + i,
        name: `${t.name} ${position}${i}`,
        position,
        proTeam: 'XX',
        proTeamId: 2 + ((t.id * 7 + i) % 8),
        lineupSlotId,
        slot: String(lineupSlotId),
        started: lineupSlotId !== 20 && lineupSlotId !== 21,
        projected: r1(base * (0.7 + rnd(t.id * 13 + i, week) * 0.7)),
        actual: null,
        seasonProjected: base * 17,
        injuryStatus: 'ACTIVE',
        percentOwned: null,
      };
    });
    const starters = players.filter((p) => p.started);
    const sum = (arr, k) => {
      const v = arr.map((p) => p[k]).filter((x) => typeof x === 'number');
      return v.length ? r1(v.reduce((a, b) => a + b, 0)) : null;
    };
    return {
      id: t.id,
      name: t.name,
      teamName: t.teamName,
      abbrev: '',
      players,
      starters,
      bench: players.filter((p) => !p.started),
      // What js/season.js computes: the STARTED lineup's projection that week.
      projectedTotal: sum(starters, 'projected'),
      actualTotal: null,
      benchActualTotal: null,
      seasonProjectedTotal: sum(starters, 'seasonProjected'),
    };
  });
  return teams;
}

export async function fetchWeeksRosters(weeks, { onProgress } = {}) {
  const out = new Map();
  let done = 0;
  for (const w of weeks) {
    try {
      const { teams } = await fetchWeekRosters(w);
      if (teams && teams.length) out.set(w, teams);
    } catch { /* a gap, as in js/season.js */ }
    done++;
    if (onProgress) onProgress(done, weeks.length, w);
  }
  return out;
}

/**
 * The Summary page's played-games view, assembled the way js/season.js does:
 * both sides scored, the actuals and the started lineup's projection rounded
 * to one decimal. Reads its own roster weeks without counting them as the
 * page's roster requests.
 */
export async function fetchSeasonData() {
  calls.seasonData++;
  const sched = await buildScheduleQuietly();
  const played = sched.games.filter((g) => g.played);
  const proj = new Map();
  for (const w of [...new Set(played.map((g) => g.week))]) {
    const { teams } = await fetchWeekRosters(w);
    calls.rosters.pop();
    proj.set(w, new Map(teams.map((t) => [t.id, t.projectedTotal || 0])));
  }
  const games = played.map((g) => ({
    week: g.week,
    homeId: g.homeId,
    awayId: g.awayId,
    homeActual: r1(g.homeScore),
    awayActual: r1(g.awayScore),
    homeProjected: r1(proj.get(g.week).get(g.homeId) || 0),
    awayProjected: r1(proj.get(g.week).get(g.awayId) || 0),
  }));
  return {
    season: 2026,
    isDemo: false,
    name: sched.leagueName,
    weeks: new Set(games.map((g) => g.week)).size,
    teams: sched.teams,
    games,
    injuries: [],
    projectionsAvailable: true,
    gamesFound: games.length,
    gamesWithProjections: games.length,
  };
}

async function buildScheduleQuietly() {
  const s = await fetchSchedule();
  calls.schedule--;
  return s;
}

/** Non-null when the page's data is the synced copy. */
export async function cloudSource() {
  calls.cloud++;
  return process.env.CAP_CLOUD ? { ok: true, found: true, ages: {} } : null;
}

export async function fetchWireWeek() { return []; }

// THE FLOOR READ, only under CAP_WIRE (cross-sim-check.mjs; AUDIT §1.4). The
// real `season.fetchFloors` over a NON-EMPTY wire whose third-best at each
// position moves with the week, so a page that floors on the wrong week hands
// the simulation different projections. `calls.floors` records the week each
// page asked for. Without CAP_WIRE the export is absent, exactly as before, so
// test-capture.mjs's pages see no floor.
calls.floors = [];
const WIRE_BASE = { QB: 14, RB: 8, WR: 8, TE: 6, K: 7, DST: 6 };
export const fetchFloors = process.env.CAP_WIRE
  ? async (week) => {
    calls.floors.push(Number(week));
    const { positionFloors } = await import('../js/floor.js');
    const wire = [];
    for (const [position, base] of Object.entries(WIRE_BASE)) {
      for (let i = 0; i < 6; i++) {
        wire.push({
          playerId: 5000 + wire.length, name: `Wire ${position}${i}`, position,
          injuryStatus: 'ACTIVE',
          // i = 2 is the third-best: base + 0.3 × week.
          projected: r1(base + 0.3 * week + (2 - i) * 0.8),
        });
      }
    }
    return positionFloors(wire, { week });
  }
  : undefined;
export async function buildCloudPayload() { throw new Error('not in this stub'); }

// THE DECISIONS REVIEW'S `world` (docs/decisions-review-plan.md, "The
// contract"), small and fixed, over this stub's own decided weeks and squads.
// Hand-made so a page test can name what it expects:
//
//   DECISION_CASES.adddrop   wk 2: squad 1 adds free agent 9001 (WR) and drops
//                            its bench WR 111, in ONE action.
//   DECISION_CASES.add       wk 2: squad 2 adds free agent 9002 (RB), drops nobody.
//   DECISION_CASES.drop      wk 2: squad 3 drops its bench QB 312 ...
//   DECISION_CASES.readd     wk 3: ... and squad 4 picks him up and STARTS him
//                            over its own QB 400, who is benched.
//   DECISION_CASES.trade     wk 3: squad 5 gives its RB 501, gets squad 6's RB
//                            601; each starts in the other's slot.
//   DECISION_CASES.benched   squad 7 sits RB 710 every week although he
//                            out-projects its starting RB 701 by 5.
//
// Every week's starters add up to that squad's score in `games` to the tenth.
// Everybody kicks off on the Sunday; every move is made the Wednesday before.
export const DECISION_CASES = {
  adddrop: { id: 'mv-adddrop', teamId: 1, week: 2, add: 9001, drop: 111 },
  add: { id: 'mv-add', teamId: 2, week: 2, add: 9002 },
  drop: { id: 'mv-drop', teamId: 3, week: 2, drop: 312 },
  readd: { id: 'mv-readd', teamId: 4, week: 3, add: 312, benched: 400 },
  trade: { id: 'mv-trade', teamId: 5, withTeamId: 6, week: 3, gives: 501, gets: 601 },
  benched: { teamId: 7, starter: 701, bench: 710 },
};

const DECISION_EPOCH = Date.UTC(2026, 8, 6, 17); // week 1's Sunday, 17:00 UTC
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FREE_AGENTS = [
  { playerId: 9001, name: 'Free Agent WR', position: 'WR', proTeamId: 3 },
  { playerId: 9002, name: 'Free Agent RB', position: 'RB', proTeamId: 4 },
];

export async function fetchDecisionWorld() {
  const C = DECISION_CASES;
  const weeks = WEEKS.slice(0, decided());
  const sched = await buildScheduleQuietly();
  const kickoff = (week) => DECISION_EPOCH + (week - 1) * WEEK_MS;
  const wednesday = (week) => kickoff(week) - 4 * 24 * 60 * 60 * 1000;

  // What anybody scored and was projected, on a roster or off one.
  const lines = new Map(); // `${playerId}|${week}` -> { projected, actual }
  const info = new Map();  // playerId -> { name, position, proTeamId }
  const base = new Map();  // week -> Map<teamId, players[]> before any move
  for (const w of weeks) {
    const byTeam = new Map();
    for (const t of plainTeams(w)) {
      byTeam.set(t.id, t.players.map((p, i) => {
        let projected = p.projected;
        if (p.playerId === C.benched.bench) {
          projected = r1(t.players.find((s) => s.playerId === C.benched.starter).projected + 5);
        }
        const actual = r1(projected * (0.6 + rnd(t.id * 31 + i, w + 70) * 0.8));
        lines.set(`${p.playerId}|${w}`, { projected, actual });
        info.set(p.playerId, { name: p.name, position: p.position, proTeamId: p.proTeamId });
        return { ...p, projected, actual };
      }));
    }
    for (const fa of FREE_AGENTS) {
      const projected = r1(9 + rnd(fa.playerId, w) * 4);
      lines.set(`${fa.playerId}|${w}`, { projected, actual: r1(projected * (0.6 + rnd(fa.playerId, w + 70) * 0.8)) });
      info.set(fa.playerId, { name: fa.name, position: fa.position, proTeamId: fa.proTeamId });
    }
    base.set(w, byTeam);
  }

  const move = (id, kind, week, n, teamId, adds, drops, trade = null) =>
    ({ id, kind, week, at: wednesday(week) + n * 60 * 1000, teamId, adds, drops, trade });
  const moves = [
    move(C.adddrop.id, 'adddrop', 2, 1, 1, [C.adddrop.add], [C.adddrop.drop]),
    move(C.add.id, 'add', 2, 2, 2, [C.add.add], []),
    move(C.drop.id, 'drop', 2, 3, 3, [], [C.drop.drop]),
    move(C.readd.id, 'add', 3, 1, 4, [C.readd.add], []),
    move(C.trade.id, 'trade', 3, 2, 5, [], [],
      { withTeamId: C.trade.withTeamId, gives: [C.trade.gives], gets: [C.trade.gets] }),
  ].filter((m) => weeks.includes(m.week));

  // The squads as they ended each week: the base squad with every move so far.
  const seat = (playerId, week, lineupSlotId) => ({
    playerId, ...info.get(playerId), proTeam: 'XX',
    lineupSlotId, slot: String(lineupSlotId), started: lineupSlotId !== 20 && lineupSlotId !== 21,
    ...lines.get(`${playerId}|${week}`),
    seasonProjected: 0, injuryStatus: 'ACTIVE', percentOwned: null,
  });
  const rosters = new Map();
  const scoreByKey = new Map();
  for (const g of sched.games) {
    scoreByKey.set(`${g.week}|${g.homeId}`, g.homeScore);
    scoreByKey.set(`${g.week}|${g.awayId}`, g.awayScore);
  }
  for (const w of weeks) {
    const squads = base.get(w);
    const has = (m) => moves.includes(m) && m.week <= w;
    const of = (id) => squads.get(id);
    const out = (teamId, playerId) => squads.set(teamId, of(teamId).filter((p) => p.playerId !== playerId));
    const slotOf = (teamId, playerId) => of(teamId).find((p) => p.playerId === playerId).lineupSlotId;
    const [mAddDrop, mAdd, mDrop, mReadd, mTrade] = ['adddrop', 'add', 'drop', 'readd', 'trade']
      .map((k) => moves.find((m) => m.id === C[k].id));
    if (mAddDrop && has(mAddDrop)) { out(1, C.adddrop.drop); of(1).push(seat(C.adddrop.add, w, 20)); }
    if (mAdd && has(mAdd)) of(2).push(seat(C.add.add, w, 20));
    if (mDrop && has(mDrop)) out(3, C.drop.drop);
    if (mReadd && has(mReadd)) {
      squads.set(4, of(4).map((p) => (p.playerId === C.readd.benched ? seat(p.playerId, w, 20) : p)));
      of(4).push(seat(C.readd.add, w, 0));
    }
    if (mTrade && has(mTrade)) {
      const [a, b] = [slotOf(5, C.trade.gives), slotOf(6, C.trade.gets)];
      out(5, C.trade.gives); out(6, C.trade.gets);
      of(5).push(seat(C.trade.gets, w, a));
      of(6).push(seat(C.trade.gives, w, b));
    }
    rosters.set(w, TEAMS.map((t) => {
      const players = of(t.id);
      const starters = players.filter((p) => p.started);
      // Stretched so the lineup adds up to the squad's score; the first starter
      // carries the rounding. A man's line is his line wherever he is read.
      const want = scoreByKey.get(`${w}|${t.id}`);
      const factor = want / starters.reduce((a, p) => a + p.actual, 0);
      for (const p of starters) p.actual = r1(p.actual * factor);
      starters[0].actual = r1(want - starters.slice(1).reduce((a, p) => a + p.actual, 0));
      for (const p of starters) lines.get(`${p.playerId}|${w}`).actual = p.actual;
      const sum = (arr, k) => r1(arr.reduce((a, p) => a + (p[k] || 0), 0));
      return {
        id: t.id, name: t.name, teamName: t.teamName, abbrev: '',
        players, starters, bench: players.filter((p) => !p.started),
        projectedTotal: sum(starters, 'projected'), actualTotal: sum(starters, 'actual'),
        benchActualTotal: null, seasonProjectedTotal: null,
      };
    }));
  }

  const players = new Map();
  for (const [playerId, who] of info) {
    const byWeek = {};
    for (const w of weeks) byWeek[w] = { ...lines.get(`${playerId}|${w}`), kickoff: kickoff(w) };
    players.set(playerId, { name: who.name, position: who.position, byWeek });
  }

  const proj = (w, id) => rosters.get(w).find((t) => t.id === id).projectedTotal;
  return {
    slots: SHAPE.map(([, slot]) => slot).filter((slot) => slot !== 20),
    teams: TEAMS.map((t) => ({ id: t.id, name: t.name, teamName: t.teamName })),
    weeks,
    games: sched.games.filter((g) => weeks.includes(g.week)).map((g) => ({
      week: g.week, homeId: g.homeId, awayId: g.awayId,
      homeActual: g.homeScore, awayActual: g.awayScore,
      homeProjected: proj(g.week, g.homeId), awayProjected: proj(g.week, g.awayId),
    })),
    rosters,
    moves,
    players,
    limits: { roster: SHAPE.length },
    isDemo: false,
    name: sched.leagueName,
    requests: 0,
  };
}
