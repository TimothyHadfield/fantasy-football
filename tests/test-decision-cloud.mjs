// THE DECISIONS REVIEW, ON THE PHONE — docs/decisions-review-plan.md, Phase 4.
//
//   node test-decision-cloud.mjs             all scenarios, one child each
//   node test-decision-cloud.mjs <scenario>  one
//
// Tim's league is private: his laptop reads ESPN through the extension and
// publishes a copy, and his iPhone reads only that copy. The Decisions page
// replays a season from `season.fetchDecisionWorld()`, which needs ESPN's
// transactions and the scores of men on nobody's roster — two things a phone
// cannot ask for. So the laptop's sync carries them, one document per decided
// week (`…/decisions/<week>`), and this is whether that is TRUE:
//
//   roundTrip   the laptop's world, through the real `buildCloudPayload`, the
//               real `syncUp` and a transport that JSON-round-trips every
//               document, read back by a page with no ESPN at all, is the
//               same world — Maps included.
//   oldCopy     a copy made before this existed, or one a sync left half
//               written, is a typed error and never a world with a hole in it;
//               everything else on that copy reads exactly as it did.
//   identical   the sync of a league with nothing decided is what it always
//               was, and for one with decided weeks every document that
//               existed before is byte for byte what it would have been.
//   refused     Firestore refusing the new documents costs the sync nothing.
//   changed     a decided week is sent once, and again only when it changes.
//   size        ESPN's own three weeks of the public league (1241838), as the
//               documents the sync would write.
//
// The seam league is the one tests/test-decision-data.mjs checks by eye.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { moduleUrl, repoFile } from './repo.mjs';
import { emit } from './emit.mjs';

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 400)}` : ''}`);
};
const eq = (a, b, msg) =>
  ok(msg, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const fixture = (name) => JSON.parse(readFileSync(repoFile(`tests/fixtures/${name}`), 'utf8'));

function makeStorage() {
  const map = new Map();
  return {
    _map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

// ===========================================================================
// THE SEAM LEAGUE (tests/test-decision-data.mjs has the story)
// ===========================================================================
//
// Four squads of three. Week 1: squad 4 drops 43 (whose NFL team is OFF in
// week 2). Week 2: squad 1 adds 91 and drops 13; squads 2 and 3 swap 22 and 32,
// which ESPN's feed does not list, so the rosters have to give it away. Week 3:
// squad 4 adds 92. So 43, 13, 91 and 92 each have weeks on nobody's roster.

const LEAGUE_ID = '424242';
const SEASON = 2026;
const KICK = (w) => Date.UTC(2026, 8, 13, 17) + (w - 1) * 7 * 24 * 60 * 60 * 1000;
const DRAFTED = { 1: [11, 12, 13], 2: [21, 22, 23], 3: [31, 32, 33], 4: [41, 42, 43] };
// `inPlay` only: the men on NFL team 3, whose game in the week in play is still
// going. Empty everywhere else, so every other scenario is what it was.
const LATE = new Set();
const proOf = (id) => (LATE.has(id) ? 3 : id === 43 ? 2 : 1);
const projOf = (id, w) => 10 + (Math.abs(id) % 5) + w / 10;
const actOf = (id, w) => 4 + (Math.abs(id) % 7) + w * 2;

function squadsAt(week) {
  const s = { 1: [11, 12, 13], 2: [21, 22, 23], 3: [31, 32, 33], 4: [41, 42] };
  if (week >= 2) { s[1] = [11, 12, 91]; s[2] = [21, 32, 23]; s[3] = [31, 22, 33]; }
  if (week >= 3) s[4] = [41, 42, 92];
  return s;
}

function playerEntry(id, week) {
  return {
    id,
    player: {
      id, fullName: `Man ${id}`, defaultPositionId: id % 10 === 1 ? 1 : 2, proTeamId: proOf(id),
      stats: [
        { seasonId: SEASON, scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: projOf(id, week) },
        { seasonId: SEASON, scoringPeriodId: week, statSourceId: 0, statSplitTypeId: 1, appliedTotal: actOf(id, week), proTeamId: proOf(id) },
      ],
    },
  };
}

function rosterPayload(week) {
  return {
    members: [],
    teams: Object.entries(squadsAt(week)).map(([teamId, ids]) => ({
      id: Number(teamId), name: `Squad ${teamId}`,
      roster: { entries: ids.map((id, i) => ({ playerId: id, lineupSlotId: [0, 2, 20][i], playerPoolEntry: playerEntry(id, week) })) },
    })),
  };
}

const startedTotal = (teamId, week) => squadsAt(week)[teamId].slice(0, 2).reduce((a, id) => a + actOf(id, week), 0);

/** `inPlay`: a week being played, as ESPN sends one — `totalPoints` 0, the running score beside it. */
function schedulePayload(decidedThrough, inPlay = null) {
  const schedule = [];
  for (let w = 1; w <= 4; w++) {
    for (const [h, a] of [[1, 2], [3, 4]]) {
      const done = w <= decidedThrough;
      const [hs, as] = [startedTotal(h, w), startedTotal(a, w)];
      const live = (pts) => (w === inPlay ? { totalPointsLive: pts } : {});
      schedule.push({
        matchupPeriodId: w, playoffTierType: 'NONE',
        home: { teamId: h, totalPoints: done ? hs : 0, ...live(hs) }, away: { teamId: a, totalPoints: done ? as : 0, ...live(as) },
        winner: !done ? 'UNDECIDED' : hs > as ? 'HOME' : as > hs ? 'AWAY' : 'TIE',
      });
    }
  }
  return {
    // Two QB slots in the settings and one ever filled: the league's lineup
    // cannot be read off the lineups in use, so it has to travel.
    settings: { name: 'Seam League', rosterSettings: { lineupSlotCounts: { 0: 2, 2: 1, 20: 2, 21: 0 } } },
    members: [],
    teams: [1, 2, 3, 4].map((id) => ({ id, name: `Squad ${id}` })),
    schedule,
  };
}

const item = (type, playerId, fromTeamId, toTeamId) => ({ type, playerId, fromTeamId, toTeamId });
const tx = (id, type, week, teamId, items, more = {}) => ({
  id, type, status: 'EXECUTED', scoringPeriodId: week, teamId, proposedDate: KICK(week) - 4 * 864e5, items, ...more,
});

function transactionsPayload(week, { period }) {
  const list = [];
  if (week === 1) {
    for (const [teamId, ids] of Object.entries(DRAFTED)) {
      for (const id of ids) list.push(tx(`d${id}`, 'DRAFT', 1, Number(teamId), [item('DRAFT', id, 0, Number(teamId))]));
    }
    list.push(tx('w1-drop', 'ROSTER', 1, 4, [item('DROP', 43, 4, 0)]));
  }
  if (week === 2) {
    list.push(tx('w2-adddrop', 'WAIVER', 2, 1, [item('ADD', 91, 0, 1), item('DROP', 13, 1, 0)],
      { processDate: KICK(2) - 4 * 864e5 + 60 }));
  }
  if (week === 3) list.push(tx('w3-add', 'FREEAGENT', 3, 4, [item('ADD', 92, 0, 4)]));
  return { scoringPeriodId: week, status: { latestScoringPeriod: period, currentMatchupPeriod: period }, transactions: list };
}

const proPayload = (inPlay = null) => ({
  settings: {
    proTeams: [
      { id: 1, byeWeek: 9, proGamesByScoringPeriod: Object.fromEntries([1, 2, 3, 4].map((w) => [w, [{ date: KICK(w), statsOfficial: w < 4 }]])) },
      { id: 2, byeWeek: 2, proGamesByScoringPeriod: Object.fromEntries([1, 3, 4].map((w) => [w, [{ date: KICK(w) + 3600e3, statsOfficial: w < 4 }]])) },
      // The late game: not over in the week in play.
      { id: 3, byeWeek: 9, proGamesByScoringPeriod: Object.fromEntries([1, 2, 3, 4].map((w) => [w, [{ date: KICK(w) + 7200e3, statsOfficial: w < (inPlay || 4) }]])) },
    ],
  },
});

/** ESPN, counted. `inPlay` is a week being played. */
function installFetch({ decidedThrough = 3, period = decidedThrough + 1, inPlay = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const views = u.searchParams.getAll('view');
    const week = Number(u.searchParams.get('scoringPeriodId')) || null;
    const filter = opts.headers && opts.headers['x-fantasy-filter'] ? JSON.parse(opts.headers['x-fantasy-filter']) : null;
    const ids = filter && filter.players && filter.players.filterIds ? filter.players.filterIds.value : null;
    calls.push({ views, week, ids });
    let body;
    if (views.includes('proTeamSchedules_wl')) body = proPayload(inPlay);
    else if (views.includes('mTransactions2')) body = transactionsPayload(week, { period });
    else if (views.includes('kona_player_info')) body = { players: (ids || []).map((id) => playerEntry(id, week)) }; // no ids: the wire, empty
    else if (views.includes('mRoster')) body = rosterPayload(week);
    else body = schedulePayload(decidedThrough, inPlay);
    return { ok: true, status: 200, async json() { return JSON.parse(JSON.stringify(body)); } };
  };
  return calls;
}
const decisionReads = (calls) => calls.filter((c) => c.views.includes('mTransactions2') || c.ids);

/** No ESPN at all: what a phone on a private league has. */
function noEspn() {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error('a phone cannot ask ESPN for a private league');
  };
  return calls;
}

// ===========================================================================
// THE CLOUD, FAKED AS tests/test-cloud.mjs FAKES IT
// ===========================================================================

function assertFirestoreLegal(value, path = '', inArray = false) {
  if (value === undefined) throw new Error(`undefined at ${path} (Firestore rejects it)`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite number at ${path}`);
    return;
  }
  if (Array.isArray(value)) {
    if (inArray) throw new Error(`nested array at ${path} (Firestore rejects arrays inside arrays)`);
    value.forEach((v, i) => assertFirestoreLegal(v, `${path}[${i}]`, true));
    return;
  }
  if (typeof value !== 'object') throw new Error(`unstorable ${typeof value} at ${path}`);
  if (value instanceof Map || value instanceof Set) throw new Error(`a ${value.constructor.name} at ${path} is not a Firestore value`);
  for (const [k, v] of Object.entries(value)) assertFirestoreLegal(v, path ? `${path}.${k}` : k, false);
}

/** Every write stringified in, parsed out; `refuse(path)` true is a rules refusal. */
function makeFake({ refuse = null } = {}) {
  const user = { uid: 'uid-claude-test', email: 'claude-test@example.com', name: 'claude-test' };
  const docs = new Map();
  const log = { reads: [], writes: [], biggest: 0 };
  return {
    docs,
    log,
    async signIn() { return user; },
    async signOut() {},
    currentUser() { return user; },
    onAuth(cb) { cb(user); return () => {}; },
    async getDoc(path) {
      log.reads.push(path);
      const raw = docs.get(path);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async setDoc(path, data) {
      log.writes.push(path);
      if (refuse && refuse(path)) {
        const err = new Error('Missing or insufficient permissions.');
        err.code = 'permission-denied';
        throw err;
      }
      assertFirestoreLegal(data, '');
      const raw = JSON.stringify(data);
      log.biggest = Math.max(log.biggest, Buffer.byteLength(raw, 'utf8'));
      docs.set(path, raw);
    },
  };
}

const isDecision = (path) => /\/decisions\//.test(path);
const BASE = `leagues/${LEAGUE_ID}/seasons/${SEASON}`;

/** `new Date()` and `Date.now()` pinned, so two syncs stamp the same `syncedAt`. */
function freezeClock() {
  const Real = Date;
  const at = Real.now();
  globalThis.Date = class extends Real {
    constructor(...a) { if (a.length) super(...a); else super(at); }
    static now() { return at; }
  };
  return () => { globalThis.Date = Real; };
}

// ===========================================================================
// THE TWO MACHINES
// ===========================================================================

/** The laptop: ESPN answers, and nothing has been synced for it to read back. */
async function laptop(opts) {
  globalThis.localStorage = makeStorage();
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));
  cloud.configure({ transport: makeFake(), ownerUid: '' });
  espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
  espn.clearReadCache();
  const calls = installFetch(opts);
  return { cloud, espn, season, calls, storage: globalThis.localStorage };
}

/**
 * The phone: another browser (its own storage, its own copy of js/season.js and
 * so none of the laptop's page state), the same Firebase project, no ESPN.
 */
let phones = 0;
async function phone(fake) {
  globalThis.localStorage = makeStorage();
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  cloud.configure({ transport: fake, ownerUid: '' });
  espn.clearReadCache();
  const calls = noEspn();
  const season = await import(`${moduleUrl('js/season.js')}?phone=${++phones}`);
  return { season, calls, storage: globalThis.localStorage };
}

const typed = async (promise) => {
  try { await promise; return null; } catch (err) { return err; }
};

// ===========================================================================
// SCENARIOS
// ===========================================================================

const SCENARIOS = {
  async roundTrip() {
    const L = await laptop();
    const payload = await L.season.buildCloudPayload();
    ok('the sync built the decided weeks without the Decisions page being opened',
      payload.decisions instanceof Map && [...payload.decisions.keys()].join(',') === '1,2,3',
      payload.decisions ? [...payload.decisions.keys()] : 'no decisions');
    eq(decisionReads(L.calls).length, 3 + 3,
      'at two requests a decided week: its moves, and the men who were on nobody’s roster in it');

    // The laptop's own world, as its Decisions page would get it now.
    L.calls.length = 0;
    const mine = await L.season.fetchDecisionWorld();
    eq([mine.weeks, mine.requests, decisionReads(L.calls).length], [[1, 2, 3], 0, 0],
      'and the weeks are frozen: the page then costs no request for them');

    // A second sync, later, buys none of it again.
    L.espn.clearReadCache();
    L.calls.length = 0;
    const again = await L.season.buildCloudPayload();
    eq(decisionReads(L.calls).length, 0, 'the next sync asks ESPN for no move and no player-week again');
    eq(JSON.stringify([...again.decisions]), JSON.stringify([...payload.decisions]), 'and carries the same weeks');

    const fake = makeFake();
    L.cloud.configure({ transport: fake, ownerUid: '' });
    const res = await L.cloud.syncUp(LEAGUE_ID, SEASON, payload, {});
    ok('the sync went', res.ok, res.reason);
    eq([res.decisions.wrote, res.decisions.reason], [3, ''], 'with a document for each decided week');
    eq(fake.log.writes.filter(isDecision), [1, 2, 3].map((w) => `${BASE}/decisions/${w}`), 'at …/decisions/<week>');
    eq(fake.log.writes[fake.log.writes.length - 1], BASE, 'and the league index still written LAST');

    // ---- the phone ----
    const P = await phone(fake);
    fake.log.reads.length = 0;
    const theirs = await P.season.fetchDecisionWorld();
    eq(P.calls, [], 'the phone asked ESPN for nothing');
    eq(P.storage._map.size > 0 && [...P.storage._map.keys()].filter((k) => k.startsWith('ff.decisions.')), [],
      'and froze nothing of its own under the laptop’s keys');
    eq(fake.log.reads.filter(isDecision).length, 3, 'three document reads for three decided weeks');

    ok('rosters and players are Maps, as the contract says',
      theirs.rosters instanceof Map && theirs.players instanceof Map && typeof [...theirs.players.keys()][0] === 'number');
    eq(theirs.requests, 0, 'no requests');
    let same = null;
    try {
      assert.deepStrictEqual({ ...theirs, requests: 0 }, { ...mine, requests: 0 });
    } catch (err) { same = err; }
    ok('THE PHONE’S WORLD IS THE LAPTOP’S — slots, teams, weeks, games, rosters, moves, players, limits',
      same === null, same && same.message);

    // And it is a world worth comparing: the things only the new documents carry.
    eq(theirs.moves.map((m) => [m.id, m.kind, m.week]),
      [['w1-drop', 'drop', 1], ['w2-adddrop', 'adddrop', 2], ['inferred:2:2:3', 'trade', 2], ['w3-add', 'add', 3]],
      'the moves, the unlisted trade among them');
    eq(theirs.players.get(92).byWeek[1], { actual: actOf(92, 1), projected: projOf(92, 1), kickoff: KICK(1), done: true },
      'a man on nobody’s roster in week 1 has that week’s score, projection and kickoff');
    eq(theirs.players.get(43).byWeek[2], { actual: actOf(43, 2), projected: 0, kickoff: null, done: true },
      'the bye rule and the missing kickoff of a team that was off');
    eq(theirs.players.get(43).byWeek[3].kickoff, KICK(3) + 3600e3, 'and the other NFL team’s own kickoff');
    eq([theirs.slots.filter((s) => s === 0).length, theirs.limits], [2, { roster: 5 }],
      'the league’s lineup and roster size as ESPN’s settings say, not as the lineups in use suggest');

    // The page asks again (a team picked, a redraw): no second read of the copy.
    fake.log.reads.length = 0;
    await P.season.fetchDecisionWorld();
    eq(fake.log.reads.length, 0, 'asked again on the same page, the copy is not read again');
  },

  // ---- the week in play rides too, and is never taken for a decided week ----
  //
  // Tim, 2026-10-05: "Could you just display everything you're able to, like we
  // do across the rest of the cite?" Weeks 1 and 2 decided, week 3 being played:
  // 41 (squad 4's QB) and 13 (on nobody's roster) are in the late game.
  async inPlay() {
    LATE.add(41);
    LATE.add(13);
    const L = await laptop({ decidedThrough: 2, inPlay: 3 });
    const payload = await L.season.buildCloudPayload();
    eq([...payload.decisions.keys()], [1, 2, 3], 'the sync carries the week in play after the decided ones');
    eq([1, 2, 3].map((w) => payload.decisions.get(w).open === true), [false, false, true], 'marked open, and only it');
    eq(Object.keys(payload.decisions.get(3)).sort(), ['draft', 'kick', 'league', 'moves', 'open', 'players', 'week'],
      'otherwise the document a decided week has');
    eq(Object.keys(payload.decisions.get(1)).sort(), ['draft', 'kick', 'league', 'moves', 'players', 'week'],
      'and a decided week’s document has exactly the fields it always had');
    const mine = await L.season.fetchDecisionWorld();
    eq([mine.weeks, mine.partialWeek], [[1, 2, 3], 3], '(the laptop’s own world has the week in play)');

    const fake = makeFake();
    L.cloud.configure({ transport: fake, ownerUid: '' });
    const res = await L.cloud.syncUp(LEAGUE_ID, SEASON, payload, {});
    ok('the sync went', res.ok, res.reason);
    eq(fake.log.writes.filter(isDecision), [1, 2, 3].map((w) => `${BASE}/decisions/${w}`), 'one document a week, the open one among them');
    fake.log.writes.length = 0;
    const same = await L.cloud.syncUp(LEAGUE_ID, SEASON, payload, { decisionsSent: res.decisions.marks });
    eq([same.decisions.wrote, fake.log.writes.filter(isDecision)], [0, []], 'an open week that has not moved is not written again');
    const moved = new Map(payload.decisions).set(3, {
      ...payload.decisions.get(3), players: { ...payload.decisions.get(3).players, 13: { ...payload.decisions.get(3).players[13], actual: 99 } },
    });
    const next = await L.cloud.syncUp(LEAGUE_ID, SEASON, { ...payload, decisions: moved }, { decisionsSent: res.decisions.marks });
    eq([next.decisions.wrote, fake.log.writes.filter(isDecision)], [1, [`${BASE}/decisions/3`]], 'one that has is rewritten, alone');
    await L.cloud.syncUp(LEAGUE_ID, SEASON, payload, {});

    // ---- the phone: the week in play as the laptop last synced it ----
    const P = await phone(fake);
    const theirs = await P.season.fetchDecisionWorld();
    eq([theirs.weeks, theirs.partialWeek, theirs.requests], [[1, 2, 3], 3, 0], 'the phone has the week in play, at no request');
    eq(P.calls, [], 'and asked ESPN for nothing: the NFL games that are over came with the sync');
    let differ = null;
    try {
      assert.deepStrictEqual({ ...theirs, requests: 0 }, { ...mine, requests: 0 });
    } catch (err) { differ = err; }
    ok('THE PHONE’S WORLD IS THE LAPTOP’S, the week in play included', differ === null, differ && differ.message);
    eq(theirs.games.filter((g) => g.week === 3).map((g) => [g.homeId, g.homeActual, g.awayActual]),
      [[1, startedTotal(1, 3), startedTotal(2, 3)], [3, null, null]], 'the finished matchup has its score, the other none');
    eq([theirs.players.get(13).byWeek[3].done, theirs.players.get(43).byWeek[3].done, theirs.players.get(41).byWeek[3].done],
      [false, true, false], 'and each man says whether he has finished, on a roster or off one');
    eq([...P.storage._map.keys()].filter((k) => k.startsWith('ff.decisions')), [], 'the phone keeps none of it as a record');

    // ---- a copy whose open document never arrived: the decided weeks, as before ----
    const short = makeFake();
    for (const [k, v] of fake.docs) if (k !== `${BASE}/decisions/3`) short.docs.set(k, v);
    const P0 = await phone(short);
    const bare = await P0.season.fetchDecisionWorld();
    eq([bare.weeks, bare.partialWeek], [[1, 2], null], 'without the open week’s document it is the decided weeks, and no error');

    // ---- ESPN closes week 3, but the copy still holds the OPEN document ----
    LATE.clear();
    const L2 = await laptop({ decidedThrough: 3 });
    const closed = await L2.season.buildCloudPayload();
    eq([[...closed.decisions.keys()], 'open' in closed.decisions.get(3)], [[1, 2, 3], false], 'decided, its document is a decided week’s');
    const stuck = makeFake({ refuse: (p) => p.endsWith('/decisions/3') });
    for (const [k, v] of fake.docs) stuck.docs.set(k, v);
    L2.cloud.configure({ transport: stuck, ownerUid: '' });
    ok('(a sync whose week-3 decisions write is refused still goes)', (await L2.cloud.syncUp(LEAGUE_ID, SEASON, closed, {})).ok);
    ok('(so the copy says week 3 is decided and still holds the open document)', JSON.parse(stuck.docs.get(`${BASE}/decisions/3`)).json.join('').includes('"open":true'));
    const P2 = await phone(stuck);
    eq((await typed(P2.season.fetchDecisionWorld()) || {}).code, 'decisions-not-synced',
      'AN OPEN DOCUMENT IS NEVER TAKEN FOR A DECIDED WEEK’S: the phone asks for a sync');

    // ---- and the next real sync replaces it ----
    const mended = makeFake();
    for (const [k, v] of fake.docs) mended.docs.set(k, v);
    L2.cloud.configure({ transport: mended, ownerUid: '' });
    await L2.cloud.syncUp(LEAGUE_ID, SEASON, closed, {});
    const P3 = await phone(mended);
    const after = await P3.season.fetchDecisionWorld();
    eq([after.weeks, after.partialWeek], [[1, 2, 3], null], 'the decided week’s document replaced it, and the phone reads three finished weeks');
  },

  async oldCopy() {
    const L = await laptop();
    const payload = await L.season.buildCloudPayload();

    // ---- a copy made before any of this existed ----
    const old = makeFake();
    L.cloud.configure({ transport: old, ownerUid: '' });
    const { decisions, ...before } = payload;
    ok('(the payload did carry decisions to leave out)', decisions instanceof Map && decisions.size === 3);
    ok('the old sync went', (await L.cloud.syncUp(LEAGUE_ID, SEASON, before, {})).ok);

    const P = await phone(old);
    const err = await typed(P.season.fetchDecisionWorld());
    ok('an old copy is an Error', err instanceof Error, String(err));
    eq(err && err.code, 'decisions-not-synced', 'typed, so the page can tell it from a failure');
    ok('with one short plain sentence', err && /^[A-Z][^.]{10,60}\.$/.test(err.message), err && err.message);
    eq(P.calls, [], 'and ESPN was not asked');

    // Everything else on that copy reads exactly as it did.
    const schedule = await P.season.fetchSchedule();
    const rosters = await P.season.fetchWeeksRosters([1, 2, 3]);
    eq([schedule.games.length, [...rosters.keys()], rosters.get(2).find((t) => t.id === 1).players.map((p) => p.playerId)],
      [8, [1, 2, 3], [11, 12, 91]], 'the schedule and the squads still read from it');
    eq((await P.season.fetchSeasonData()).games.length, 6, 'and the season');
    eq(P.calls, [], 'still without ESPN');
    ok('demo is untouched by any of it', (await P.season.fetchDecisionWorld({ demo: true })).isDemo === true);

    // ---- a sync that only got as far as week 2 ----
    const part = makeFake({ refuse: (p) => p.endsWith('/decisions/3') });
    L.cloud.configure({ transport: part, ownerUid: '' });
    ok('the partial sync still went', (await L.cloud.syncUp(LEAGUE_ID, SEASON, payload, {})).ok);
    const P2 = await phone(part);
    eq((await typed(P2.season.fetchDecisionWorld()) || {}).code, 'decisions-not-synced',
      'a decided week missing from the copy is the same typed error, not a shorter season');

    // ---- a week-1 document older than the move that names a new man ----
    const stale = makeFake();
    L.cloud.configure({ transport: stale, ownerUid: '' });
    const week1 = payload.decisions.get(1);
    const { 92: gone, ...rest } = week1.players;
    ok('(week 1 did hold a line for the man week 3 added)', !!gone);
    const holed = new Map(payload.decisions).set(1, { ...week1, players: rest });
    ok('that sync went too', (await L.cloud.syncUp(LEAGUE_ID, SEASON, { ...payload, decisions: holed }, {})).ok);
    const P3 = await phone(stale);
    eq((await typed(P3.season.fetchDecisionWorld()) || {}).code, 'decisions-not-synced',
      'a man with no line in an older document is the typed error — never a quiet 0 points');

    // ---- and once the laptop syncs properly, the same phone page has it ----
    L.cloud.configure({ transport: stale, ownerUid: '' });
    await L.cloud.syncUp(LEAGUE_ID, SEASON, payload, {});
    L.cloud.configure({ transport: stale, ownerUid: '' });
    globalThis.localStorage = P3.storage;
    noEspn();
    eq((await P3.season.fetchDecisionWorld()).weeks, [1, 2, 3], 'a miss is not remembered: after a real sync the page reads it');
  },

  async identical() {
    // ---- nothing decided: nothing new anywhere ----
    const N = await laptop({ decidedThrough: 0, period: 1 });
    const none = await N.season.buildCloudPayload();
    eq(Object.keys(none), ['leagueName', 'teams', 'byes', 'schedule', 'rosters', 'wire', 'weeks'],
      'a league with no decided week: the payload has exactly the keys it always had');
    eq(decisionReads(N.calls).length, 0, 'and building it asked ESPN for no move and no player-week');
    const plain = makeFake();
    N.cloud.configure({ transport: plain, ownerUid: '' });
    const r0 = await N.cloud.syncUp(LEAGUE_ID, SEASON, none, {});
    eq(Object.keys(r0), ['ok', 'wrote', 'bytes', 'syncedAt', 'weeks', 'largestDoc', 'reason'], 'the sync’s answer has the keys it always had');
    eq(plain.log.writes.filter(isDecision), [], 'no decisions document is written');
    eq(Object.keys(JSON.parse(plain.docs.get(BASE))),
      ['v', 'kind', 'id', 'leagueId', 'season', 'leagueName', 'teamCount', 'syncedAt', 'syncedShapes', 'weeks', 'json'],
      'and the league index has the fields it always had');
    eq(Object.keys(JSON.parse(plain.docs.get(BASE)).weeks), ['rosters', 'wire'], 'its week lists too');

    // ---- decided weeks: every document that existed before is unchanged ----
    const L = await laptop();
    const payload = await L.season.buildCloudPayload();
    const { decisions, ...before } = payload;
    const thaw = freezeClock();
    const [a, b] = [makeFake(), makeFake()];
    L.cloud.configure({ transport: a, ownerUid: '' });
    const ra = await L.cloud.syncUp(LEAGUE_ID, SEASON, before, {});
    L.cloud.configure({ transport: b, ownerUid: '' });
    const rb = await L.cloud.syncUp(LEAGUE_ID, SEASON, payload, {});
    thaw();
    ok('(both went)', ra.ok && rb.ok && decisions.size === 3);
    const old = [...a.docs];
    eq(old.length > 4 && [...b.docs].filter(([p]) => !isDecision(p)), old,
      'with decisions riding along, every other document is BYTE FOR BYTE what it was without them');
    eq(b.log.writes.filter((p) => !isDecision(p)), a.log.writes, 'written in the same order');
    const { decisions: extra, ...rest } = rb;
    eq(rest, ra, 'and the sync reports the same files and bytes it always did');
    ok('the new part is reported apart', extra && extra.wrote === 3 && extra.bytes > 0);
  },

  async refused() {
    const L = await laptop();
    const payload = await L.season.buildCloudPayload();
    const { decisions, ...before } = payload;

    const thaw = freezeClock();
    const open = makeFake();
    L.cloud.configure({ transport: open, ownerUid: '' });
    const want = await L.cloud.syncUp(LEAGUE_ID, SEASON, before, {});

    // The project's rules do not cover the new path.
    const shut = makeFake({ refuse: isDecision });
    L.cloud.configure({ transport: shut, ownerUid: '' });
    const progress = [];
    const res = await L.cloud.syncUp(LEAGUE_ID, SEASON, payload, { onProgress: (d, t, label) => progress.push([d, t, label]) });
    thaw();

    ok('(the payload did carry decisions to refuse)', decisions.size === 3);
    ok('the sync still succeeds', res.ok === true && res.reason === '', JSON.stringify(res).slice(0, 200));
    eq([res.wrote, res.bytes, res.largestDoc], [want.wrote, want.bytes, want.largestDoc], 'reporting exactly the files and bytes it wrote');
    eq([...shut.docs], [...open.docs], 'every existing document landed, byte for byte');
    eq(shut.log.writes[shut.log.writes.length - 1], BASE, 'the league index among them, last');
    eq(progress[progress.length - 1], [want.wrote, want.wrote, 'League index'], 'the progress line counts to its own total and stops');
    eq(shut.log.writes.filter(isDecision).length, 1, 'one refusal is enough: the other weeks are not tried');
    ok('the refusal is kept, quietly, for whoever asks',
      res.decisions.wrote === 0 && /account|permission/i.test(res.decisions.reason) && Object.keys(res.decisions.marks).length === 0,
      JSON.stringify(res.decisions));

    const P = await phone(shut);
    eq((await typed(P.season.fetchDecisionWorld()) || {}).code, 'decisions-not-synced', 'and the phone says it needs a sync, as on any old copy');
    eq((await P.season.fetchSchedule()).games.length, 8, 'while the rest of the copy reads');

    // A transport that cannot be read at all is a typed error too, never a throw of its own.
    const deaf = makeFake();
    L.cloud.configure({ transport: deaf, ownerUid: '' });
    await L.cloud.syncUp(LEAGUE_ID, SEASON, payload, {});
    const realGet = deaf.getDoc;
    deaf.getDoc = async (path) => { if (isDecision(path)) throw new Error('unavailable'); return realGet(path); };
    const P2 = await phone(deaf);
    eq((await typed(P2.season.fetchDecisionWorld()) || {}).code, 'decisions-not-synced', 'documents that will not read are “not in the copy”');
  },

  async changed() {
    const L = await laptop();
    const payload = await L.season.buildCloudPayload();
    const fake = makeFake();
    L.cloud.configure({ transport: fake, ownerUid: '' });

    const first = await L.cloud.syncUp(LEAGUE_ID, SEASON, payload, {});
    eq([first.decisions.wrote, first.decisions.skipped, Object.keys(first.decisions.marks)], [3, 0, ['1', '2', '3']], 'the first sync sends all three');

    fake.log.writes.length = 0;
    const second = await L.cloud.syncUp(LEAGUE_ID, SEASON, payload, { decisionsSent: first.decisions.marks });
    eq([second.decisions.wrote, second.decisions.skipped, fake.log.writes.filter(isDecision)], [0, 3, []],
      'the next sync, told what was sent, writes none of them again');
    eq(second.decisions.marks, first.decisions.marks, 'and still knows what is up there');
    eq(fake.log.writes.filter((p) => !isDecision(p)).length, first.wrote, 'while the squads, wire, schedule and index go as always');

    // A later move names a new man, so week 2 gains a line; weeks 1 and 3 do not.
    const week2 = payload.decisions.get(2);
    const grown = new Map(payload.decisions).set(2, {
      ...week2, players: { ...week2.players, 77: { name: 'Man 77', position: 'RB', proTeamId: 1, projected: 9.1, actual: 3.2 } },
    });
    fake.log.writes.length = 0;
    const third = await L.cloud.syncUp(LEAGUE_ID, SEASON, { ...payload, decisions: grown }, { decisionsSent: second.decisions.marks });
    eq([third.decisions.wrote, third.decisions.skipped, fake.log.writes.filter(isDecision)], [1, 2, [`${BASE}/decisions/2`]],
      'only the week that changed is written');
    ok('under a new mark', third.decisions.marks[2] !== second.decisions.marks[2] && third.decisions.marks[1] === second.decisions.marks[1]);

    fake.log.writes.length = 0;
    const forced = await L.cloud.syncUp(LEAGUE_ID, SEASON, payload, {});
    eq(forced.decisions.wrote, 3, 'and with no marks handed in (the Sync button) every week is sent');

    // What was written reads back as what was sent.
    const down = await L.cloud.readDecisions(LEAGUE_ID, SEASON, [1, 2, 3, 4]);
    eq([down.ok, [...down.decisions.keys()], down.reads], [true, [1, 2, 3], 4], 'readDecisions: the weeks that are there, one read each');
    eq(JSON.stringify(down.decisions.get(2)), JSON.stringify(payload.decisions.get(2)), 'each exactly as it went up');
    eq((await L.cloud.readDecisions('demo', SEASON, [1])).ok, false, 'demo is refused, like every read');

    // connection.js is what remembers the marks between syncs.
    const src = readFileSync(repoFile('js/connection.js'), 'utf8');
    ok('the bar hands the last marks to an automatic sync and none to a pressed one',
      /decisionsSent: force \? null : decisionsSent\(\)/.test(src) && /syncNow\(\{ force: true \}\)/.test(src));
  },

  async size() {
    // ESPN's own transaction payloads for the public league's first three
    // weeks, decoded by the real decoder. The player-weeks are an UPPER bound:
    // every man any move names, given a line in every week (really only the
    // weeks he was on nobody's roster — measured live on 2026-10-05 that was
    // 25–29 men a week and 6.2–7.6 KB a document).
    const espn = await import(moduleUrl('js/espn.js'));
    const cloud = await import(moduleUrl('js/cloud.js'));
    const raw = [1, 2, 3].map((w) => fixture(`transactions-1241838-2026-wk${w}.json`));
    const moves = raw.map((r) => espn.parseTransactions(r));
    const named = new Set(moves.flat().flatMap((m) => [...m.adds, ...m.drops, ...(m.trade ? [...m.trade.gives, ...m.trade.gets] : [])]));
    const sample = espn.parsePlayerWeek(fixture('players-week-1241838-2026-wk2.json').players[0], 2);
    const players = Object.fromEntries([...named].map((id) => [id, {
      name: sample.name, position: sample.position, proTeamId: sample.proTeamId, projected: sample.projected, actual: sample.actual,
    }]));
    const kick = Object.fromEntries(Array.from({ length: 32 }, (_, i) => [i + 1, KICK(1) + i * 1000]));
    const decisions = new Map([1, 2, 3].map((w, i) => [w, {
      week: w, moves: moves[i], players, draft: espn.parseDraftRosters(raw[i]), kick,
      league: { starterSlots: { 0: 1, 2: 2, 4: 2, 6: 1, 16: 1, 17: 1, 23: 1 }, rosterSize: 16 },
    }]));
    ok('(the fixtures are the real league: ten squads drafted, moves in every week)',
      Object.keys(decisions.get(1).draft).length === 10 && moves.every((m) => m.length > 5), moves.map((m) => m.length).join(','));

    const fake = makeFake();
    cloud.configure({ transport: fake, ownerUid: '' });
    const res = await cloud.syncUp('1241838', SEASON, { leagueName: 'x', teams: [], decisions }, {});
    const d = res.decisions;
    console.log(`  three decided weeks of league 1241838: ${(d.bytes / 1024).toFixed(1)} KB in 3 documents, largest ${(d.largestDoc / 1024).toFixed(1)} KB (upper bound; measured live 20.0 KB, largest 7.4 KB)`);
    ok('all three went', res.ok && d.wrote === 3, JSON.stringify(d));
    ok('the largest is under 20 KB — fifty times under Firestore’s 1 MiB document cap', d.largestDoc < 20 * 1024, d.largestDoc);
    ok('and three weeks add under 50 KB to a sync of about 1.2 MB', d.bytes < 50 * 1024, d.bytes);
    ok('the fake measured the same document', fake.log.biggest >= d.largestDoc && fake.log.biggest < d.largestDoc + 64, `${fake.log.biggest} vs ${d.largestDoc}`);
  },
};

// ------------------------------------------------------------- child runner

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const name = process.argv[2];
  if (!SCENARIOS[name]) emit({ pass: 0, fails: [`unknown scenario ${name}`] }, 2);
  try {
    await SCENARIOS[name]();
  } catch (err) {
    fails.push(`threw: ${err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err}`);
  }
  emit({ pass, fails });
}

let total = 0;
const allFails = [];
for (const name of Object.keys(SCENARIOS)) {
  // One child each: an ES module initialises once per process, and each
  // scenario wants its own module state.
  const res = spawnSync(process.execPath, [self, name], { encoding: 'utf8', timeout: 60000 });
  const lines = (res.stdout || '').split('\n');
  for (const l of lines) if (l.startsWith('  ')) console.log(l);
  const line = lines.filter((l) => l.startsWith('@@')).pop();
  let parsed = null;
  try { parsed = JSON.parse(line.slice(2)); } catch { /* fall through */ }
  if (!parsed) {
    allFails.push(`${name}: no result\n${res.stdout}\n${res.stderr}`);
    continue;
  }
  total += parsed.pass;
  allFails.push(...parsed.fails.map((f) => `${name}: ${f}`));
}

if (allFails.length) {
  for (const f of allFails.slice(0, 40)) console.log('FAIL ' + f);
  if (allFails.length > 40) console.log(`… and ${allFails.length - 40} more`);
}
console.log(`${total} passed, ${allFails.length} failed across ${Object.keys(SCENARIOS).length} scenarios`);
process.exit(allFails.length ? 1 : 0);
