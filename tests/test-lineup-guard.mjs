// The one write the extension may make: a lineup change on the owner's team.
//
//   node test-lineup-guard.mjs
//
// Tim, 2026-10-11: "for the easy ones like the weekly lineup, make it so you
// just have to click a button to automatically change it for your team" — and,
// asked whether the site may change his ESPN lineup through the extension with
// his login: "Yes, lineup only".
//
// THIS CANNOT BE TESTED AGAINST ESPN. It would need a logged-in owner, and the
// only one is Tim. So everything that decides whether a request is sent, and
// exactly what is in it, is proved here instead, two ways:
//
//   PART ONE runs extension/lineup-guard.js on its own — the shipped file, in a
//   vm context — against a league shaped like a real read: every refusal, and
//   the exact body for a move that is allowed.
//
//   PART TWO runs extension/background.js itself with chrome and fetch stubbed,
//   and watches what leaves: who may ask, the switch, the cookie, the fresh
//   read, one POST to one URL, never a second.
//
// The league below is hand-made but its SHAPE AND SIZE are measured — the
// public league 1241838, season 2026, views mTeam + mRoster + mSettings, read
// 2026-10-11: ten teams of 17–19 entries, `owners` a list of "{GUID}" strings,
// `scoringPeriodId` and `seasonId` at the top, `lineupLocked` and
// `player.eligibleSlots` on each entry's playerPoolEntry, and the slot counts
// under settings.rosterSettings.lineupSlotCounts with a zero for every slot the
// league does not use.

import fs from 'node:fs';
import vm from 'node:vm';
import { repoFile } from './repo.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const eq = (a, b, msg) => ok(Object.is(a, b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), msg,
  `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const GUARD = fs.readFileSync(repoFile('extension/lineup-guard.js'), 'utf8');
const BACKGROUND = fs.readFileSync(repoFile('extension/background.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(repoFile('extension/manifest.json'), 'utf8'));

// ---------------------------------------------------------------------------
// A league shaped like the real read
// ---------------------------------------------------------------------------

const swidOf = (n) => `{${String(n).padStart(8, '0')}-AAAA-4BBB-8CCC-${String(n).padStart(12, '0')}}`;
const ME = swidOf(4);              // the owner, team 4
const SEASON = 2026;
const LEAGUE_ID = '476225250';
const WEEK = 5;

// Slot ids, as ESPN numbers them: 0 QB, 2 RB, 4 WR, 6 TE, 16 D/ST, 17 K,
// 20 bench, 21 IR, 23 RB/WR/TE.
const SLOT_COUNTS = {
  0: 1, 1: 0, 2: 2, 3: 0, 4: 3, 5: 0, 6: 1, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0,
  13: 0, 14: 0, 15: 0, 16: 1, 17: 1, 18: 0, 19: 0, 20: 7, 21: 2, 22: 0, 23: 1, 24: 0,
};
const ELIGIBLE = {
  QB: [0, 7, 20, 21], RB: [2, 3, 23, 7, 20, 21], WR: [4, 3, 5, 23, 7, 20, 21],
  TE: [6, 5, 23, 7, 20, 21], DST: [16, 20, 21], K: [17, 20, 21],
};
// One team's roster: [position, slot] in the order ESPN lists a real one.
const ROSTER = [
  ['RB', 2], ['RB', 20], ['WR', 4], ['WR', 20], ['WR', 4], ['WR', 4], ['RB', 20], ['QB', 0],
  ['TE', 6], ['RB', 2], ['WR', 23], ['QB', 20], ['TE', 20], ['RB', 21], ['WR', 21], ['WR', 20],
  ['RB', 20], ['DST', 16], ['K', 17],
];

function makeLeague() {
  const teams = [];
  for (let id = 1; id <= 10; id++) {
    const size = [19, 17, 18, 19, 18, 17, 19, 18, 17, 19][id - 1];
    const entries = ROSTER.slice(0, size - 2).concat(ROSTER.slice(-2)).map(([pos, slot], i) => {
      const playerId = pos === 'DST' ? -16000 - id : id * 100000 + i;
      return {
        acquisitionDate: 1786889842327, acquisitionType: 'DRAFT', injuryStatus: 'NORMAL',
        lineupSlotId: slot, pendingTransactionIds: null, playerId,
        playerPoolEntry: {
          appliedStatTotal: 0, id: playerId, keeperValue: 0, keeperValueFuture: 0,
          lineupLocked: false, onTeamId: id, rosterLocked: false, status: 'ONTEAM', tradeLocked: false,
          player: { id: playerId, fullName: `Player ${playerId}`, eligibleSlots: ELIGIBLE[pos] },
        },
        status: 'NORMAL',
      };
    });
    teams.push({
      id, abbrev: `T${id}`, name: `Team ${id}`, isActive: true,
      owners: [swidOf(id)], primaryOwner: swidOf(id),
      roster: { entries },
    });
  }
  return {
    gameId: 1, id: Number(LEAGUE_ID), scoringPeriodId: WEEK, seasonId: SEASON, segmentId: 0,
    members: teams.map((t) => ({ id: t.owners[0], displayName: `m${t.id}` })),
    settings: { name: 'L', rosterSettings: { lineupSlotCounts: SLOT_COUNTS } },
    status: { currentMatchupPeriod: WEEK, isActive: true },
    teams,
  };
}

/** Team 4's men, by where they are: p(index) is his playerId. */
const p = (i, team = 4) => makeLeague().teams[team - 1].roster.entries[i].playerId;
const BENCH_RB = p(1);     // RB on the bench (20)
const START_RB = p(0);     // RB starting (2)
const BENCH_WR = p(3);     // WR on the bench (20)
const START_WR = p(2);     // WR starting (4)
const START_QB = p(7);     // QB starting (0)

const SWAP = [
  { type: 'LINEUP', playerId: BENCH_RB, fromSlotId: 20, toSlotId: 2 },
  { type: 'LINEUP', playerId: START_RB, fromSlotId: 2, toSlotId: 20 },
];
const MSG = { type: 'SET_LINEUP', leagueId: LEAGUE_ID, season: SEASON, week: WEEK, teamId: 4, moves: SWAP };

// ===========================================================================
// PART ONE — the guard on its own
// ===========================================================================

const guardContext = { URL };
vm.createContext(guardContext);
vm.runInContext(GUARD, guardContext, { filename: 'lineup-guard.js' });
const G = guardContext.LineupGuard;
ok(G && typeof G.check === 'function', 'lineup-guard.js hangs LineupGuard on the global object');

/** Parse, then check — what background.js does, minus the browser. */
const judge = (msg, opts = {}) => {
  const league = 'league' in opts ? opts.league : makeLeague();
  const swid = 'swid' in opts ? opts.swid : ME;
  const parsed = G.parseRequest(msg);
  if (!parsed.ok) return parsed;
  return G.check({ request: parsed.request, league, swid });
};
const refuses = (msg, reason, why, opts) => {
  const res = judge(msg, opts);
  ok(res.ok === false && res.reason === reason, `${why} → ${reason}`, JSON.stringify(res).slice(0, 160));
  ok(!('body' in res), `${why}: no body is built`);
};
const withMoves = (moves) => ({ ...MSG, moves });
const move = (patch) => withMoves([{ ...SWAP[0], ...patch }, SWAP[1]]);

// ---- the move that is allowed, and exactly what would be sent --------------
{
  const res = judge(MSG);
  ok(res.ok, 'a swap on your own team, this week, is allowed', JSON.stringify(res));
  same(res.body, {
    isLeagueManager: false,
    teamId: 4,
    type: 'ROSTER',
    memberId: ME,
    scoringPeriodId: WEEK,
    executionType: 'EXECUTE',
    items: [
      { playerId: BENCH_RB, type: 'LINEUP', fromLineupSlotId: 20, toLineupSlotId: 2 },
      { playerId: START_RB, type: 'LINEUP', fromLineupSlotId: 2, toLineupSlotId: 20 },
    ],
  }, 'the body is ESPN’s lineup transaction, field for field and in ESPN’s order');
  eq(JSON.stringify(Object.keys(res.body)),
    JSON.stringify(['isLeagueManager', 'teamId', 'type', 'memberId', 'scoringPeriodId', 'executionType', 'items']),
    'and carries no field beyond those seven');
}
{
  const one = judge(withMoves([{ type: 'LINEUP', playerId: p(10), fromSlotId: 23, toSlotId: 20 }]));
  ok(one.ok && one.body.items.length === 1, 'one move alone is allowed (ESPN accepts an empty starting slot)');
  const four = judge(withMoves([
    ...SWAP,
    { type: 'LINEUP', playerId: BENCH_WR, fromSlotId: 20, toSlotId: 4 },
    { type: 'LINEUP', playerId: START_WR, fromSlotId: 4, toSlotId: 20 },
  ]));
  ok(four.ok && four.body.items.length === 4, 'four moves — two swaps — are allowed');
  const flex = judge(withMoves([{ type: 'LINEUP', playerId: BENCH_RB, fromSlotId: 20, toSlotId: 23 },
    { type: 'LINEUP', playerId: p(10), fromSlotId: 23, toSlotId: 20 }]));
  ok(flex.ok, 'a running back may go to the flex');
  const dst = makeLeague();
  dst.teams[3].roster.entries.find((e) => e.playerId === -16004).lineupSlotId = 20;
  const d = judge(withMoves([{ type: 'LINEUP', playerId: -16004, fromSlotId: 20, toSlotId: 16 }]), { league: dst });
  ok(d.ok && d.body.items[0].playerId === -16004, 'a D/ST, whose id is negative, can be moved');
}
{
  // The member id sent is ESPN's own spelling of it, whatever case the cookie used.
  const res = judge(MSG, { swid: ME.toLowerCase() });
  ok(res.ok && res.body.memberId === ME, 'a lower-case cookie still finds the team, and ESPN’s spelling is sent');
  const enc = judge(MSG, { swid: encodeURIComponent(ME) });
  ok(enc.ok && enc.body.memberId === ME, 'so does a percent-encoded one');
  const co = makeLeague();
  co.teams[3].owners = [swidOf(77), ME];
  ok(judge(MSG, { league: co }).ok, 'a co-owner who is not listed first still owns his team');
}

// ---- not a lineup move ----------------------------------------------------
for (const type of ['DROP', 'ADD', 'TRADE', 'WAIVER', 'FREEAGENT', 'ROSTER', 'lineup', '', undefined, null, 20]) {
  refuses(move({ type }), 'not-lineup', `an item of type ${JSON.stringify(type)}`);
}
refuses(withMoves([SWAP[0], { ...SWAP[1], type: 'DROP' }]), 'not-lineup', 'a drop hidden behind a real lineup move');
refuses(withMoves([{ type: 'DROP', playerId: START_RB, fromTeamId: 4, toTeamId: 0 }]), 'not-lineup',
  'a drop in ESPN’s own shape');

// ---- whose team -----------------------------------------------------------
for (const teamId of [1, 3, 5, 10]) {
  const theirs = makeLeague().teams[teamId - 1].roster.entries;
  refuses({ ...MSG, teamId, moves: [
    { type: 'LINEUP', playerId: theirs[1].playerId, fromSlotId: 20, toSlotId: 2 },
    { type: 'LINEUP', playerId: theirs[0].playerId, fromSlotId: 2, toSlotId: 20 },
  ] }, 'not-your-team', `team ${teamId}, which is somebody else’s`);
}
refuses({ ...MSG, teamId: 11 }, 'not-your-team', 'a team the league does not have');
refuses(MSG, 'not-your-team', 'an owner who is not in this league at all', { swid: swidOf(99) });
{
  // The other team's men, asked for under your own team id, are not on your roster.
  const theirs = makeLeague().teams[6].roster.entries;
  refuses(withMoves([{ type: 'LINEUP', playerId: theirs[1].playerId, fromSlotId: 20, toSlotId: 2 }]),
    'not-on-roster', 'another team’s man under your own team id');
  // A league whose team ids arrive as strings is not matched by coercion.
  const odd = makeLeague();
  odd.teams[3].id = '4';
  refuses(MSG, 'not-your-team', 'a team id that only matches as text', { league: odd });
}
for (const swid of [null, undefined, '', 'not-a-swid', '{123}', 42, {}, ME.slice(0, -2)]) {
  refuses(MSG, 'signed-out', `no usable member id (${JSON.stringify(swid)})`, { swid });
}

// ---- which week -----------------------------------------------------------
for (const week of [1, 4, 6, 17]) refuses({ ...MSG, week }, 'stale', `week ${week} when ESPN is on week ${WEEK}`);
refuses({ ...MSG, season: 2025 }, 'stale', 'last season');
{
  const moved = makeLeague();
  moved.scoringPeriodId = 6;
  refuses(MSG, 'stale', 'ESPN having moved on a week since the page was drawn', { league: moved });
}

// ---- where ESPN says he is now -------------------------------------------
refuses(move({ fromSlotId: 23 }), 'stale', 'a man the page thinks is in the flex, who is on the bench');
refuses(move({ fromSlotId: 21 }), 'stale', 'a man the page thinks is on IR');
refuses(move({ playerId: 999999 }), 'not-on-roster', 'a man who is on nobody’s roster');
{
  const already = makeLeague();
  already.teams[3].roster.entries[1].lineupSlotId = 2;   // the swap was already made
  refuses(MSG, 'stale', 'a swap that has already been made on ESPN', { league: already });
}

// ---- locked ---------------------------------------------------------------
for (const [idx, who] of [[1, 'the man coming in'], [0, 'the man going out']]) {
  const locked = makeLeague();
  locked.teams[3].roster.entries[idx].playerPoolEntry.lineupLocked = true;
  refuses(MSG, 'locked', `${who}, whose game has started`, { league: locked });
}
{
  const gone = makeLeague();
  delete gone.teams[3].roster.entries[1].playerPoolEntry.lineupLocked;
  refuses(MSG, 'locked', 'an entry with no lock flag at all — not known is not unlocked', { league: gone });
}

// ---- which slot -----------------------------------------------------------
refuses(move({ toSlotId: 0 }), 'bad-slot', 'a running back at quarterback');
refuses(move({ toSlotId: 7 }), 'bad-slot', 'a slot he is eligible for but this league does not have');
refuses(move({ toSlotId: 3 }), 'bad-slot', 'another slot the league has none of');
refuses(move({ toSlotId: 25 }), 'bad-slot', 'a slot id ESPN does not list');
refuses(move({ toSlotId: 20, fromSlotId: 20 }), 'same-slot', 'a move to where he already is');
{
  const blind = makeLeague();
  delete blind.teams[3].roster.entries[1].playerPoolEntry.player.eligibleSlots;
  refuses(MSG, 'bad-slot', 'a man ESPN lists no eligible slots for', { league: blind });
}

// ---- how many -------------------------------------------------------------
refuses(withMoves([]), 'bad-request', 'no moves at all');
refuses(withMoves([...SWAP,
  { type: 'LINEUP', playerId: BENCH_WR, fromSlotId: 20, toSlotId: 4 },
  { type: 'LINEUP', playerId: START_WR, fromSlotId: 4, toSlotId: 20 },
  { type: 'LINEUP', playerId: START_QB, fromSlotId: 0, toSlotId: 20 },
]), 'too-many', 'five moves');
refuses(withMoves(Array.from({ length: 19 }, (_, i) => ({ type: 'LINEUP', playerId: p(i), fromSlotId: 20, toSlotId: 2 }))),
  'too-many', 'the whole roster');

// ---- the shape ------------------------------------------------------------
for (const [patch, why] of [
  [{ playerId: String(BENCH_RB) }, 'a player id as a string'],
  [{ playerId: 1.5 }, 'a fractional player id'],
  [{ playerId: NaN }, 'a player id that is NaN'],
  [{ playerId: -3 }, 'a negative id that is not a D/ST'],
  [{ playerId: 0 }, 'a zero player id'],
  [{ playerId: START_RB }, 'the same man twice'],
  [{ fromSlotId: '20' }, 'a from-slot as a string'],
  [{ toSlotId: '2' }, 'a to-slot as a string'],
  [{ toSlotId: 2.5 }, 'a fractional slot'],
  [{ toSlotId: -1 }, 'a negative slot'],
  [{ toSlotId: null }, 'a missing to-slot'],
  [{ fromSlotId: undefined }, 'a missing from-slot'],
  [{ toTeamId: 7 }, 'an unexpected field on a move'],
  [{ isLeagueManager: true }, 'isLeagueManager smuggled onto a move'],
]) refuses(move(patch), 'bad-request', why);
for (const [patch, why] of [
  [{ moves: 'swap' }, 'moves that are not a list'],
  [{ moves: [null] }, 'a null move'],
  [{ moves: [7] }, 'a move that is a number'],
  [{ teamId: '4' }, 'a team id as a string'],
  [{ teamId: 0 }, 'team id zero'],
  [{ teamId: 4.5 }, 'a fractional team id'],
  [{ week: '5' }, 'a week as a string'],
  [{ week: 0 }, 'week zero'],
  [{ week: 26 }, 'week twenty-six'],
  [{ season: '20261' }, 'a five-digit season'],
  [{ season: '../2026' }, 'a season walking the path'],
  [{ leagueId: '1?view=x' }, 'a leagueId rewriting the query'],
  [{ leagueId: '../../x' }, 'a leagueId walking the path'],
  [{ leagueId: '' }, 'an empty leagueId'],
  [{ isLeagueManager: true }, 'isLeagueManager on the request'],
  [{ memberId: swidOf(1) }, 'a member id supplied by the page'],
  [{ executionType: 'EXECUTE' }, 'an execution type supplied by the page'],
  [{ items: [] }, 'ESPN’s own "items" supplied by the page'],
]) refuses({ ...MSG, ...patch }, 'bad-request', why);
for (const bad of [null, undefined, 'SET_LINEUP', 7]) {
  const res = G.parseRequest(bad);
  ok(res.ok === false && res.reason === 'bad-request', `a request that is ${JSON.stringify(bad)} is refused`);
}

// ---- a league read that is not what it should be ---------------------------
for (const [mutate, why] of [
  [(l) => { delete l.teams; }, 'no teams'],
  [(l) => { delete l.scoringPeriodId; }, 'no current scoring period'],
  [(l) => { l.scoringPeriodId = '5'; }, 'a scoring period that is text'],
  [(l) => { delete l.teams[3].roster; }, 'your team with no roster'],
  [(l) => { delete l.settings.rosterSettings; }, 'no roster settings'],
]) {
  const league = makeLeague();
  mutate(league);
  refuses(MSG, 'read-failed', `a read with ${why}`, { league });
}
refuses(MSG, 'read-failed', 'no read at all', { league: null });

// ---- what ESPN's answer means --------------------------------------------
same(G.outcome(200, { status: 'EXECUTED' }), { ok: true }, '200 EXECUTED is success');
same(G.outcome(200, null), { ok: true }, 'a 200 that could not be read is left to the page’s re-read');
same(G.outcome(200, { status: 'PENDING' }), { ok: false, reason: 'not-executed' }, 'a 200 that did not execute is not success');
same(G.outcome(409, { details: [{ type: 'TRAN_LINEUP_LOCKED' }] }), { ok: false, reason: 'locked' }, 'ESPN’s own lock refusal');
same(G.outcome(409, { details: [{ type: 'TRAN_INVALID_SCORINGPERIOD_NOT_CURRENT' }] }), { ok: false, reason: 'stale' }, 'ESPN’s own wrong-week refusal');
same(G.outcome(409, { details: [{ type: 'TRAN_ROSTER_SLOT_LIMIT_EXCEEDED' }] }), { ok: false, reason: 'espn-409' }, 'any other 409');
same(G.outcome(401, { messages: ['Unauthorized'] }), { ok: false, reason: 'espn-401' }, 'a 401');
same(G.outcome(400, null), { ok: false, reason: 'espn-400' }, 'a 400 with nothing readable');
same(G.outcome(500, 'oops'), { ok: false, reason: 'espn-500' }, 'a 500');

// ---- who is the live site -------------------------------------------------
const LIVE = 'https://timothyhadfield.github.io';
const LIVE_PAGE = LIVE + '/fantasy-football/notifications.html';
const liveSender = { id: 'x', origin: LIVE, url: LIVE_PAGE, tab: { id: 3 }, frameId: 0 };
ok(G.senderIsLiveSite(liveSender), 'the live site, in a tab, is the live site');
for (const [sender, why] of [
  [{ ...liveSender, origin: 'http://localhost:8000', url: 'http://localhost:8000/notifications.html' }, 'localhost'],
  [{ ...liveSender, origin: 'http://127.0.0.1:8000', url: 'http://127.0.0.1:8000/' }, '127.0.0.1'],
  [{ ...liveSender, origin: 'https://evil.example', url: 'https://evil.example/fantasy-football/' }, 'another site'],
  [{ ...liveSender, origin: 'https://evil.example' }, 'the live URL claimed from another origin'],
  [{ ...liveSender, url: 'https://evil.example/fantasy-football/' }, 'the live origin over another site’s URL'],
  [{ ...liveSender, url: LIVE + '/' }, 'the root of the shared origin'],
  [{ ...liveSender, url: LIVE + '/other-project/' }, 'another project of his'],
  [{ ...liveSender, url: LIVE + '/fantasy-football-evil/' }, 'a look-alike project'],
  [{ ...liveSender, url: LIVE + '/fantasy-football/../other/' }, 'a dot-dot walk out of the path'],
  [{ ...liveSender, url: 'not a url' }, 'a URL that does not parse'],
  [{ ...liveSender, origin: 'http://timothyhadfield.github.io', url: LIVE_PAGE.replace('https', 'http') }, 'the site over plain http'],
  [{ ...liveSender, origin: LIVE + '.evil.com', url: LIVE + '.evil.com/fantasy-football/' }, 'a look-alike origin'],
  [{ id: 'x', origin: LIVE, url: LIVE_PAGE }, 'no tab behind it'],
  [{ ...liveSender, frameId: 2 }, 'a frame inside the page'],
  [{ id: 'x', url: 'chrome-extension://abc/popup.html' }, 'the extension’s own popup'],
  [{ ...liveSender, origin: undefined }, 'no origin'],
  [null, 'no sender'],
]) ok(!G.senderIsLiveSite(sender), `not the live site: ${why}`);

// ===========================================================================
// PART TWO — the worker, with chrome and fetch stubbed
// ===========================================================================

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const READ = 'https://lm-api-reads.fantasy.espn.com';
const WRITE = 'https://lm-api-writes.fantasy.espn.com';

/**
 * A fresh worker. `league` is what the read answers; `write` what the POST
 * answers; `swid` the cookie (null for none); `on` the switch.
 */
function makeWorker(opts = {}) {
  const { league = makeLeague(), write, read, hold = false } = opts;
  const swid = 'swid' in opts ? opts.swid : ME;
  const on = 'on' in opts ? opts.on : true;
  const calls = [];
  const cookieAsks = [];
  const local = new Map();
  if (on !== undefined) local.set('allowLineup', on);
  let listener = null;
  let release = null;
  const gate = hold ? new Promise((r) => { release = r; }) : null;

  const area = (map) => ({
    get: async (keys) => {
      const out = {};
      for (const k of [].concat(keys)) if (map.has(k)) out[k] = map.get(k);
      return out;
    },
    set: async (obj) => { for (const [k, v] of Object.entries(obj)) map.set(k, v); },
    remove: async (keys) => { for (const k of [].concat(keys)) map.delete(k); },
  });

  const context = {
    console: { log() {}, warn() {}, error() {}, debug() {} },
    URL, URLSearchParams, AbortSignal, setTimeout, clearTimeout,
    importScripts: (...names) => {
      for (const name of names) {
        vm.runInContext(fs.readFileSync(repoFile('extension/' + name), 'utf8'), context, { filename: name });
      }
    },
    fetch: async (url, init = {}) => {
      const method = init.method || 'GET';
      calls.push({ url: String(url), method, init, body: init.body });
      const isWrite = method !== 'GET';
      if (isWrite && gate) await gate;
      const r = isWrite
        ? (write || { status: 200, body: { status: 'EXECUTED' } })
        : (read || { status: 200, body: league });
      if (r.throws) throw r.throws;
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: { get: (h) => (h.toLowerCase() === 'content-type' ? (r.type || 'application/json') : null) },
        json: async () => {
          if (r.badJson) throw new Error('Unexpected token');
          return r.body;
        },
      };
    },
    chrome: {
      runtime: {
        id: EXT_ID,
        getManifest: () => ({ version: MANIFEST.version }),
        getURL: (path) => `chrome-extension://${EXT_ID}/${path || ''}`,
        onMessage: { addListener: (fn) => { listener = fn; } },
      },
      storage: { local: area(local), session: area(new Map()) },
      cookies: {
        get: async (details) => {
          cookieAsks.push(details);
          return swid == null ? null : { name: 'SWID', value: swid, domain: '.espn.com' };
        },
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(BACKGROUND, context, { filename: 'background.js' });

  const send = (msg, sender = { id: EXT_ID, origin: LIVE, url: LIVE_PAGE, tab: { id: 3 }, frameId: 0 }) =>
    new Promise((resolve) => {
      let answered = false;
      const kept = listener(msg, sender, (res) => { answered = true; resolve(res); });
      if (!kept && !answered) resolve(undefined);
    });

  const writes = () => calls.filter((c) => c.method !== 'GET');
  return { send, calls, writes, cookieAsks, local, release: () => release && release() };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

// ---- the happy path: one read, one POST, to one URL -------------------------
{
  const w = makeWorker();
  const res = await w.send(MSG);
  same(res, { ok: true }, 'an allowed swap answers {ok:true} and nothing more');
  eq(w.calls.length, 2, 'exactly two requests: the fresh read, then the write');

  const read = new URL(w.calls[0].url);
  eq(w.calls[0].method, 'GET', 'the first is a read');
  eq(read.origin, READ, 'from the read host');
  eq(read.pathname, `/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}`, 'of this league');
  eq(read.searchParams.getAll('view').join(','), 'mTeam,mRoster,mSettings', 'owners, rosters and slot counts');
  eq(read.searchParams.get('scoringPeriodId'), null, 'with no week named, so ESPN answers for the current one');
  eq(w.calls[0].init.cache, 'no-store', 'and never from the browser’s cache');

  const post = w.calls[1];
  eq(post.method, 'POST', 'the second is a POST');
  eq(post.url, `${WRITE}/apis/v3/games/ffl/seasons/${SEASON}/segments/0/leagues/${LEAGUE_ID}/transactions/`,
    'to the league’s transactions endpoint on the write host, trailing slash and all');
  eq(post.init.credentials, 'include', 'carrying his ESPN login');
  eq(post.init.headers['Content-Type'], 'application/json', 'as JSON');
  same(JSON.parse(post.body), {
    isLeagueManager: false, teamId: 4, type: 'ROSTER', memberId: ME, scoringPeriodId: WEEK,
    executionType: 'EXECUTE',
    items: [
      { playerId: BENCH_RB, type: 'LINEUP', fromLineupSlotId: 20, toLineupSlotId: 2 },
      { playerId: START_RB, type: 'LINEUP', fromLineupSlotId: 2, toLineupSlotId: 20 },
    ],
  }, 'and the body on the wire is the guard’s, unchanged');

  eq(w.cookieAsks.length, 1, 'the cookie is asked for once');
  same(w.cookieAsks[0], { url: READ + '/', name: 'SWID' }, 'the SWID, by name, through a host the extension holds');
  ok(!JSON.stringify(res).includes(ME.slice(1, 9)), 'and his member id is not handed back to the page');
}

// ---- the switch -----------------------------------------------------------
for (const [on, why] of [[false, 'off'], [undefined, 'never touched'], ['true', 'the text "true"'], [1, 'the number 1'], [null, 'null']]) {
  const w = makeWorker({ on });
  const res = await w.send(MSG);
  same(res, { ok: false, reason: 'off' }, `the switch ${why} → off`);
  eq(w.calls.length, 0, `the switch ${why}: no request of any kind`);
  eq(w.cookieAsks.length, 0, `the switch ${why}: the cookie is not even read`);
  const can = await w.send({ type: 'CAN_SET_LINEUP' });
  same(can, { ok: true, data: { allowed: false } }, `the switch ${why}: canSetLineup says no`);
}
{
  const w = makeWorker({ on: true });
  same(await w.send({ type: 'CAN_SET_LINEUP' }), { ok: true, data: { allowed: true } },
    'the switch on, from the live site: canSetLineup says yes');
  eq(w.calls.length, 0, 'and asking costs no request');
  // Turned off again, the very next request is refused.
  w.local.set('allowLineup', false);
  same(await w.send(MSG), { ok: false, reason: 'off' }, 'turned off again, the next change is refused');
}

// ---- who may ask ----------------------------------------------------------
for (const [sender, why] of [
  [{ id: EXT_ID, origin: 'http://localhost:8000', url: 'http://localhost:8000/notifications.html', tab: { id: 1 }, frameId: 0 }, 'localhost:8000, which may read'],
  [{ id: EXT_ID, origin: 'http://127.0.0.1:8000', url: 'http://127.0.0.1:8000/index.html', tab: { id: 1 }, frameId: 0 }, '127.0.0.1:8000, which may read'],
  [{ id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup.html` }, 'the extension’s own popup'],
  [{ id: EXT_ID, origin: LIVE, url: LIVE_PAGE }, 'the live site with no tab behind it'],
  [{ id: EXT_ID, origin: LIVE, url: LIVE_PAGE, tab: { id: 1 }, frameId: 4 }, 'a frame inside the live site'],
]) {
  const w = makeWorker();
  const res = await w.send(MSG, sender);
  same(res, { ok: false, reason: 'origin' }, `${why} → origin`);
  eq(w.calls.length, 0, `${why}: no request`);
  eq(w.cookieAsks.length, 0, `${why}: no cookie read`);
  same(await w.send({ type: 'CAN_SET_LINEUP' }, sender), { ok: true, data: { allowed: false } },
    `${why}: canSetLineup says no, switch on or not`);
}
for (const [sender, why] of [
  [{ id: EXT_ID, origin: 'https://evil.example', url: 'https://evil.example/fantasy-football/', tab: { id: 1 } }, 'another site'],
  [{ id: EXT_ID, origin: LIVE, url: LIVE + '/other-project/', tab: { id: 1 } }, 'another project on the same origin'],
  [{ id: EXT_ID, origin: 'https://fantasy.espn.com', url: 'https://fantasy.espn.com/football/team/trade', tab: { id: 1 } }, 'ESPN’s own trade page'],
]) {
  const w = makeWorker();
  const res = await w.send(MSG, sender);
  ok(res && res.ok === false, `${why} is refused`);
  eq(w.calls.length, 0, `${why}: no request`);
  const can = await w.send({ type: 'CAN_SET_LINEUP' }, sender);
  ok(!(can && can.data && can.data.allowed), `${why}: canSetLineup is not yes`);
}
{
  const w = makeWorker();
  const res = await w.send(MSG, { id: 'someotherextensionidxxxxxxxxxxxx', origin: LIVE, url: LIVE_PAGE, tab: { id: 1 } });
  eq(res, undefined, 'another extension gets no answer at all');
  eq(w.calls.length, 0, 'and no request');
}

// ---- refusals after the read: the read happens, the write never does -------
for (const [msg, opts, reason, why] of [
  [{ ...MSG, teamId: 7 }, {}, 'not-your-team', 'another manager’s team'],
  [{ ...MSG, week: 4 }, {}, 'stale', 'last week'],
  [move({ fromSlotId: 23 }), {}, 'stale', 'a man not where the page thought'],
  [move({ toSlotId: 0 }), {}, 'bad-slot', 'a slot he cannot play'],
  [MSG, { league: (() => { const l = makeLeague(); l.teams[3].roster.entries[1].playerPoolEntry.lineupLocked = true; return l; })() }, 'locked', 'a locked man'],
  [MSG, { read: { status: 500 } }, 'read-failed', 'ESPN’s read failing'],
  [MSG, { read: { status: 401 } }, 'signed-out', 'ESPN refusing the read'],
  [MSG, { read: { status: 200, type: 'text/html' } }, 'signed-out', 'a login page where the league should be'],
]) {
  const w = makeWorker(opts);
  same(await w.send(msg), { ok: false, reason }, `${why} → ${reason}`);
  eq(w.writes().length, 0, `${why}: NOTHING IS WRITTEN`);
  eq(w.calls.length, 1, `${why}: one read and no more`);
}
// ---- refusals before the read: nothing leaves at all ------------------------
for (const [msg, opts, reason, why] of [
  [move({ type: 'DROP' }), {}, 'not-lineup', 'a drop'],
  [withMoves([]), {}, 'bad-request', 'no moves'],
  [withMoves([...SWAP, ...SWAP, SWAP[0]]), {}, 'too-many', 'five moves'],
  [{ ...MSG, leagueId: '1/../../x' }, {}, 'bad-request', 'a leagueId walking the path'],
  [{ ...MSG, isLeagueManager: true }, {}, 'bad-request', 'isLeagueManager from the page'],
  [MSG, { swid: null }, 'signed-out', 'no SWID cookie'],
  [MSG, { swid: 'garbage' }, 'signed-out', 'a SWID cookie that is not one'],
]) {
  const w = makeWorker(opts);
  same(await w.send(msg), { ok: false, reason }, `${why} → ${reason}`);
  eq(w.calls.length, 0, `${why}: no request of any kind`);
}

// ---- what ESPN answers ----------------------------------------------------
for (const [write, want, why] of [
  [{ status: 409, body: { details: [{ type: 'TRAN_LINEUP_LOCKED' }] } }, { ok: false, reason: 'locked' }, 'ESPN says locked'],
  [{ status: 409, body: { details: [{ type: 'TRAN_ROSTER_SLOT_LIMIT_EXCEEDED' }] } }, { ok: false, reason: 'espn-409' }, 'ESPN says too many in a slot'],
  [{ status: 401, body: {} }, { ok: false, reason: 'espn-401' }, 'ESPN says unauthorised'],
  [{ status: 403, badJson: true }, { ok: false, reason: 'espn-403' }, 'ESPN says forbidden, unreadably'],
  [{ status: 500, badJson: true }, { ok: false, reason: 'espn-500' }, 'ESPN falls over'],
  [{ status: 200, body: { status: 'PENDING' } }, { ok: false, reason: 'not-executed' }, 'a 200 that did not execute'],
  [{ status: 200, badJson: true }, { ok: true }, 'a 200 that cannot be read'],
  [{ throws: Object.assign(new Error('aborted'), { name: 'TimeoutError' }) }, { ok: false, reason: 'timeout' }, 'the write timing out'],
  [{ throws: new TypeError('Failed to fetch') }, { ok: false, reason: 'network' }, 'the write not connecting'],
]) {
  const w = makeWorker({ write });
  same(await w.send(MSG), want, `${why} → ${JSON.stringify(want)}`);
  eq(w.writes().length, 1, `${why}: ONE POST, NEVER RETRIED`);
}

// ---- one at a time --------------------------------------------------------
{
  const w = makeWorker({ hold: true });
  const first = w.send(MSG);
  await tick();
  eq(w.writes().length, 1, 'the first change is in flight');
  const second = await w.send(MSG);
  same(second, { ok: false, reason: 'busy' }, 'a second change while the first is in flight → busy');
  eq(w.writes().length, 1, 'and it wrote nothing');
  w.release();
  same(await first, { ok: true }, 'the first still completes');
  const third = await w.send(MSG);
  same(third, { ok: true }, 'and once it has, the next is taken');
  eq(w.writes().length, 2, 'two changes, two POSTs');
}
{
  // A refusal must not leave the door shut behind it.
  const w = makeWorker({ write: { throws: new TypeError('Failed to fetch') } });
  await w.send(MSG);
  same(await w.send(MSG), { ok: false, reason: 'network' }, 'after a failed write the next attempt is not "busy"');
  const v = makeWorker();
  await v.send({ ...MSG, teamId: 7 });
  same(await v.send(MSG), { ok: true }, 'nor after a refusal');
}

// ---- the other handlers still cannot write ----------------------------------
{
  const w = makeWorker();
  await w.send({ type: 'LEAGUE', season: SEASON, leagueId: LEAGUE_ID, views: ['mTeam'] });
  await w.send({ type: 'PROBE', season: SEASON, leagueId: LEAGUE_ID });
  await w.send({ type: 'SEASON', season: SEASON, view: 'kona_game_state' });
  eq(w.writes().length, 0, 'reads stay reads');
  ok(w.calls.every((c) => new URL(c.url).origin === READ), 'and stay on the read host');
  eq(w.cookieAsks.length, 0, 'and never look at a cookie');
}

console.log(fail ? `${pass} passed, ${fail} failed` : `All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
