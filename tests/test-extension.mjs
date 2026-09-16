// The bridge extension's service worker, run for real with chrome and fetch
// stubbed out.
//
// This suite existed once and was lost. It is the regression guard for a
// security review that found real holes, and for the staged-trade feature that
// came after it, so the two halves are marked below.
//
// It runs extension/background.js ITSELF — the shipped file, in a vm context —
// rather than a copy of its logic. A rename, a loosened regex or a "tidied"
// template literal therefore fails here instead of shipping.
//
// What it is defending:
//
//   1. The worker makes requests carrying the owner's real ESPN cookies, on
//      behalf of a web page. Every input from that page is hostile until
//      proven otherwise. A leagueId of "1?view=x" rewrites the query string; a
//      leagueId containing "../.." walks to a different endpoint entirely.
//   2. Only an allowed origin may drive it at all.
//   3. host_permissions holds the READ host and NOTHING else. No write to ESPN
//      is possible from this extension, and that is not a policy — it is the
//      absence of a permission.
//   4. A staged trade expires, is single-use, and is validated to the same
//      standard as the URLs.

import fs from 'node:fs';
import vm from 'node:vm';
import { repoFile } from './repo.mjs';

let pass = 0, fail = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const eq = (a, b, msg) => ok(Object.is(a, b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

const BACKGROUND = fs.readFileSync(repoFile('extension/background.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(repoFile('extension/manifest.json'), 'utf8'));

/**
 * Comments out, code left alone.
 *
 * The checks at the foot of this file search the source for things that must
 * not be in it — the write host, innerHTML, fetch. Both files TALK about those
 * things at length, because saying why they are absent is the point of the
 * comment, so a search over the raw text would fail on its own documentation.
 *
 * Only whole-line // comments are stripped, never a trailing one: a line like
 *   const HOST = 'https://lm-api-writes.fantasy.espn.com';
 * must stay visible, and stripping from the first // anywhere would hide it.
 */
const stripComments = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

const EXT_ID = 'abcdefghijklmnopabcdefghijklmnop';
const SITE = 'https://timothyhadfield.github.io';
const ESPN = 'https://fantasy.espn.com';

/**
 * A fresh worker, with its own storage and its own record of what it fetched.
 *
 * `reply` is what the stubbed fetch answers with; tests swap it per call.
 */
function makeWorker({ reply } = {}) {
  const calls = [];
  const storage = { local: new Map(), session: new Map() };
  let listener = null;

  const area = (which) => ({
    get: async (keys) => {
      const out = {};
      for (const k of [].concat(keys)) if (storage[which].has(k)) out[k] = storage[which].get(k);
      return out;
    },
    set: async (obj) => { for (const [k, v] of Object.entries(obj)) storage[which].set(k, v); },
    remove: async (keys) => { for (const k of [].concat(keys)) storage[which].delete(k); },
  });

  const answer = reply || (() => ({
    status: 200, type: 'application/json', body: { teams: [], settings: { name: 'L' } },
  }));

  const context = {
    console: { log() {}, warn() {}, error() {}, debug() {} },
    URL,
    URLSearchParams,
    AbortSignal,
    setTimeout,
    clearTimeout,
    fetch: async (url, init) => {
      const r = answer(url, init);
      calls.push({ url, init, headers: (init && init.headers) || {} });
      if (r.throws) throw r.throws;
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        headers: { get: (h) => (h.toLowerCase() === 'content-type' ? r.type : null) },
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
        getURL: (p) => `chrome-extension://${EXT_ID}/${p || ''}`,
        onMessage: { addListener: (fn) => { listener = fn; } },
      },
      storage: { local: area('local'), session: area('session') },
    },
  };

  vm.createContext(context);
  vm.runInContext(BACKGROUND, context, { filename: 'background.js' });

  /** Send a message the way Chrome would, and wait for the reply. */
  const send = (msg, sender = { id: EXT_ID, origin: SITE, url: SITE + '/index.html' }) =>
    new Promise((resolve) => {
      let answered = false;
      const kept = listener(msg, sender, (res) => { answered = true; resolve(res); });
      // A listener that returns false and never answered is Chrome's "no
      // response at all" — model it as undefined rather than hanging.
      if (!kept && !answered) resolve(undefined);
    });

  return { send, calls, storage, hasListener: () => typeof listener === 'function' };
}

const okMsg = (extra = {}) => ({ type: 'LEAGUE', season: 2026, leagueId: '476225250', views: ['mTeam'], ...extra });

// ===========================================================================
// PART ONE — the security review's findings
// ===========================================================================

{
  const w = makeWorker();
  ok(w.hasListener(), 'the listener is registered at the top level, as MV3 requires');
}

// ---- the URL is built, never interpolated ---------------------------------
{
  const w = makeWorker();
  await w.send(okMsg());
  eq(w.calls.length, 1, 'a valid league read reaches ESPN');
  const u = new URL(w.calls[0].url);
  eq(u.origin, 'https://lm-api-reads.fantasy.espn.com', 'the read host, and only the read host');
  eq(u.pathname, '/apis/v3/games/ffl/seasons/2026/segments/0/leagues/476225250', 'the league path');
  eq(u.searchParams.get('view'), 'mTeam', 'the view rides in the query');
}

// Injection: a leagueId that tries to rewrite the query string.
for (const bad of ['1?view=mRoster', '1&view=x', '1#frag', '1/../../x', '../../..', '1 ', ' 1', '1e3', '-1', '', 'abc', '0123456789012345']) {
  const w = makeWorker();
  const res = await w.send(okMsg({ leagueId: bad }));
  ok(res && res.ok === false, `leagueId ${JSON.stringify(bad)} is refused`);
  eq(w.calls.length, 0, `leagueId ${JSON.stringify(bad)} makes no request at all`);
}

// A path-traversing season.
for (const bad of ['../2026', '2026/../..', '20261', '202', 'abcd', '', '20 6']) {
  const w = makeWorker();
  const res = await w.send(okMsg({ season: bad }));
  ok(res && res.ok === false, `season ${JSON.stringify(bad)} is refused`);
  eq(w.calls.length, 0, `season ${JSON.stringify(bad)} makes no request`);
}

// Views are an allow-list, not a pass-through.
{
  const w = makeWorker();
  await w.send(okMsg({ views: ['mTeam', 'mRoster', 'nonsense', '../../x', 'kona_player_info'] }));
  const u = new URL(w.calls[0].url);
  const views = u.searchParams.getAll('view');
  eq(views.join(','), 'mTeam,mRoster,kona_player_info', 'unknown views are dropped, known ones kept in order');
}
{
  const w = makeWorker();
  await w.send(okMsg({ views: 'mTeam' }));      // a string, not a list
  const u = new URL(w.calls[0].url);
  eq(u.searchParams.getAll('view').length, 0, 'views that are not a list contribute nothing');
}

// The scoring period is a week number, and is checked as one.
for (const bad of [0, 26, -1, 1.5, 'x', NaN, Infinity]) {
  const w = makeWorker();
  const res = await w.send(okMsg({ scoringPeriodId: bad }));
  ok(res && res.ok === false, `scoringPeriodId ${String(bad)} is refused`);
  eq(w.calls.length, 0, `scoringPeriodId ${String(bad)} makes no request`);
}
{
  const w = makeWorker();
  await w.send(okMsg({ scoringPeriodId: 13 }));
  eq(new URL(w.calls[0].url).searchParams.get('scoringPeriodId'), '13', 'a real week is passed through');
}

// The season endpoint has its own, much shorter, allow-list.
{
  const w = makeWorker();
  await w.send({ type: 'SEASON', season: 2026, view: 'proTeamSchedules_wl' });
  eq(new URL(w.calls[0].url).pathname, '/apis/v3/games/ffl/seasons/2026', 'the season path');
}
for (const bad of ['mTeam', 'kona_player_info', '../x', '']) {
  const w = makeWorker();
  const res = await w.send({ type: 'SEASON', season: 2026, view: bad });
  ok(res && res.ok === false, `season view ${JSON.stringify(bad)} is refused`);
  eq(w.calls.length, 0, `season view ${JSON.stringify(bad)} makes no request`);
}

// ---- who may drive the bridge --------------------------------------------
for (const origin of ['https://evil.example', 'http://localhost:3000', 'https://timothyhadfield.github.io.evil.com', null, undefined, 'https://fantasy.espn.com']) {
  const w = makeWorker();
  const res = await w.send(okMsg(), { id: EXT_ID, origin, url: (origin || 'about:blank') + '/x' });
  ok(res && res.ok === false, `origin ${String(origin)} may not read the league`);
  eq(w.calls.length, 0, `origin ${String(origin)} makes no request`);
}
for (const origin of ['https://timothyhadfield.github.io', 'http://localhost:8000', 'http://127.0.0.1:8000']) {
  const w = makeWorker();
  await w.send(okMsg(), { id: EXT_ID, origin, url: origin + '/index.html' });
  eq(w.calls.length, 1, `origin ${origin} is allowed`);
}
{
  // Another extension's message is ignored outright — no reply at all.
  const w = makeWorker();
  const res = await w.send(okMsg(), { id: 'someotherextensionidxxxxxxxxxxxx', origin: SITE });
  eq(res, undefined, 'a message from another extension gets no answer');
  eq(w.calls.length, 0, 'and makes no request');
}
{
  // Our own popup has no origin a page would recognise, and must still work.
  const w = makeWorker();
  await w.send(okMsg(), { id: EXT_ID, url: `chrome-extension://${EXT_ID}/popup.html` });
  eq(w.calls.length, 1, 'the extension’s own popup is allowed');
}
{
  const w = makeWorker();
  const res = await w.send({ type: 'NO_SUCH_THING' });
  ok(res && res.ok === false && /Unknown request/.test(res.error), 'an unknown request type is named in the error');
}
{
  const w = makeWorker();
  const res = await w.send(null);
  ok(res && res.ok === false, 'a null message is refused rather than thrown on');
}

// ---- what ESPN's answers mean --------------------------------------------
{
  const w = makeWorker({ reply: () => ({ status: 401, type: 'application/json' }) });
  const res = await w.send(okMsg());
  ok(res.ok === false && /signed in/.test(res.error), '401 explains the cookie problem');
}
{
  const w = makeWorker({ reply: () => ({ status: 200, type: 'text/html' }) });
  const res = await w.send(okMsg());
  ok(res.ok === false && /signed in/.test(res.error), 'a 200 carrying HTML is a signed-out session, not data');
}
{
  const w = makeWorker({ reply: () => ({ status: 500, type: 'application/json' }) });
  const res = await w.send(okMsg());
  ok(res.ok === false && /HTTP 500/.test(res.error), 'a server error is reported as one');
}
{
  const w = makeWorker({ reply: () => ({ status: 200, type: 'application/json', badJson: true }) });
  const res = await w.send(okMsg());
  ok(res.ok === false && /unreadable/.test(res.error), 'unparseable JSON is reported, not thrown');
}
{
  const err = new Error('aborted'); err.name = 'TimeoutError';
  const w = makeWorker({ reply: () => ({ throws: err }) });
  const res = await w.send(okMsg());
  ok(res.ok === false && /15 seconds/.test(res.error), 'a timeout says so');
}
{
  const w = makeWorker();
  await w.send(okMsg({ type: 'LEAGUE', filter: { players: { limit: 5 } } }));
  const h = w.calls[0].headers;
  eq(h['x-fantasy-filter'], '{"players":{"limit":5}}', 'the player filter travels as a header, not a query');
}
{
  const w = makeWorker({
    reply: () => ({ status: 200, type: 'application/json', body: {
      settings: { name: 'Tim’s league', size: 10 },
      status: { currentMatchupPeriod: 2 },
      teams: [{ id: 3, location: 'Big', nickname: 'Dogs', abbrev: 'BD' }],
    } }),
  });
  const res = await w.send({ type: 'PROBE', season: 2026, leagueId: '476225250' });
  ok(res.ok, 'a probe succeeds');
  eq(res.data.teams[0].name, 'Big Dogs', 'location and nickname are joined');
  eq(res.data.teamCount, 10, 'the league size comes from settings');
  eq(res.data.currentWeek, 2, 'the current week is reported');
}
{
  const w = makeWorker();
  const res = await w.send({ type: 'PING' });
  eq(res.data.version, MANIFEST.version, 'PING reports the manifest version');
  eq(w.calls.length, 0, 'PING costs no request');
}
{
  const w = makeWorker();
  await w.send({ type: 'GET_CONFIG' });   // nothing stored yet
  const first = await w.send({ type: 'GET_CONFIG' });
  eq(first.data.leagueId, null, 'no league stored means null, not undefined');
}

// ===========================================================================
// PART TWO — the staged trade
// ===========================================================================

const STAGE = {
  type: 'STAGE_TRADE',
  leagueId: '476225250',
  season: 2026,
  myTeamId: '4',
  theirTeamId: '7',
  myPlayers: [{ id: 4362628, name: 'Jahmyr Gibbs' }, { id: 3139477, name: 'Ravens D/ST' }],
  theirPlayerIds: [15847, 4241457],
};
const TAKE = { type: 'TAKE_STAGED_TRADE', leagueId: '476225250', myTeamId: '4', theirTeamId: '7' };
const espnSender = { id: EXT_ID, origin: ESPN, url: ESPN + '/football/team/trade?x=1', tab: { id: 9 } };

// ---- the happy path, and the link it builds ------------------------------
{
  const w = makeWorker();
  const res = await w.send(STAGE);
  ok(res.ok, 'a well-formed trade stages');
  eq(res.data.count, 2, 'the reply says how many of your men were staged');
  ok(res.data.expiresAt > Date.now(), 'and when it stops being good');
  eq(w.calls.length, 0, 'STAGING SENDS NOTHING TO ESPN');

  const u = new URL(res.data.url);
  eq(u.origin, ESPN, 'the link is ESPN’s own trade page');
  eq(u.pathname, '/football/team/trade', 'on the trade path');
  eq(u.searchParams.get('leagueId'), '476225250', 'league');
  eq(u.searchParams.get('seasonId'), '2026', 'season');
  eq(u.searchParams.get('teamId'), '7', 'teamId is THEIRS — the roster you are trading for');
  eq(u.searchParams.get('fromTeamId'), '4', 'fromTeamId is yours');
  eq(u.searchParams.get('players'), '15847,4241457', 'players= carries THEIR ids, the only side ESPN can pre-tick');

  const got = await w.send(TAKE, espnSender);
  ok(got.ok && got.data, 'the ESPN page can take it');
  eq(got.data.myPlayers.length, 2, 'both of your men come back');
  eq(got.data.myPlayers[0].name, 'Jahmyr Gibbs', 'with their names, which is how a D/ST is found at all');
  eq(got.data.theirPlayerIds.join(','), '15847,4241457', 'and their side, so the tick script knows which panel is theirs');
  eq(w.calls.length, 0, 'TAKING SENDS NOTHING TO ESPN EITHER');
}

// ---- single use ----------------------------------------------------------
{
  const w = makeWorker();
  await w.send(STAGE);
  const first = await w.send(TAKE, espnSender);
  ok(first.data, 'the first take gets the trade');
  const second = await w.send(TAKE, espnSender);
  eq(second.data, null, 'the second take gets nothing: a reload cannot re-tick');
  eq(w.storage.session.has('stagedTrade'), false, 'and the record is gone from storage');
}
{
  // Two trade tabs opening at once must not both get it.
  const w = makeWorker();
  await w.send(STAGE);
  const [a, b] = await Promise.all([w.send(TAKE, espnSender), w.send(TAKE, espnSender)]);
  const got = [a, b].filter((r) => r && r.data).length;
  eq(got, 1, 'two simultaneous takes, exactly one winner');
}

// ---- expiry --------------------------------------------------------------
{
  const w = makeWorker();
  await w.send(STAGE);
  const rec = w.storage.session.get('stagedTrade');
  ok(rec.expiresAt - rec.stagedAt <= 10 * 60 * 1000, 'a staged trade lives minutes, not hours');

  // Age it by hand rather than sleeping for five minutes.
  rec.expiresAt = Date.now() - 1;
  const res = await w.send(TAKE, espnSender);
  eq(res.data, null, 'an expired trade is not handed over');
  eq(w.storage.session.has('stagedTrade'), false, 'and is cleared out on the way past');
}
{
  const w = makeWorker();
  await w.send(STAGE);
  const rec = w.storage.session.get('stagedTrade');
  delete rec.expiresAt;
  const res = await w.send(TAKE, espnSender);
  eq(res.data, null, 'a record with no expiry at all is treated as expired, not as eternal');
}

// ---- it must be the page it was staged for -------------------------------
for (const [field, value, why] of [
  ['leagueId', '999', 'a different league'],
  ['myTeamId', '5', 'a different team of yours'],
  ['theirTeamId', '8', 'a different counterparty'],
]) {
  const w = makeWorker();
  await w.send(STAGE);
  const res = await w.send({ ...TAKE, [field]: value }, espnSender);
  eq(res.data, null, `${why} gets nothing`);
  ok(w.storage.session.has('stagedTrade'), `${why} leaves the record alone rather than eating it`);
  const right = await w.send(TAKE, espnSender);
  ok(right.data, 'so the tab it was meant for still works');
}

// ---- who may stage, and who may take -------------------------------------
for (const origin of ['https://evil.example', ESPN, 'http://localhost:3000']) {
  const w = makeWorker();
  const res = await w.send(STAGE, { id: EXT_ID, origin, url: origin + '/x', tab: { id: 1 } });
  ok(res && res.ok === false, `${origin} may not stage a trade`);
  eq(w.storage.session.size, 0, `${origin} stored nothing`);
}
{
  const w = makeWorker();
  await w.send(STAGE);
  const res = await w.send(TAKE);   // from the site, not from ESPN
  ok(res && res.ok === false, 'the site itself may not take a staged trade back');
  ok(w.storage.session.has('stagedTrade'), 'and the record survives the refusal');
}
{
  const w = makeWorker();
  await w.send(STAGE);
  const res = await w.send(TAKE, { id: EXT_ID, origin: ESPN, url: ESPN + '/x' });  // no tab
  ok(res && res.ok === false, 'a take with no tab behind it is refused');
}
{
  const w = makeWorker();
  await w.send(STAGE);
  const res = await w.send(TAKE, { id: EXT_ID, origin: 'https://espn.com.evil.example', url: 'x', tab: { id: 2 } });
  ok(res && res.ok === false, 'a look-alike origin is refused');
}
{
  const w = makeWorker();
  const res = await w.send(TAKE, espnSender);
  ok(res.ok && res.data === null, 'with nothing staged, ESPN’s page is told so plainly');
}

// ---- validate hard -------------------------------------------------------
const badStage = (patch, why) => ({ patch, why });
for (const { patch, why } of [
  badStage({ myPlayers: [{ id: '4362628' }] }, 'a player id as a string'),
  badStage({ myPlayers: [{ id: 1.5 }] }, 'a fractional player id'),
  badStage({ myPlayers: [{ id: NaN }] }, 'a player id that is NaN'),
  badStage({ myPlayers: [{ id: -3 }] }, 'a negative player id'),
  badStage({ myPlayers: [{ id: -16000 }] }, 'a negative id just outside the D/ST band'),
  badStage({ myPlayers: [{ id: -16035 }] }, 'a negative id just past the D/ST band'),
  badStage({ myPlayers: [{ id: -14001 }] }, 'a head coach, which is not a D/ST'),
  badStage({ myPlayers: [{ id: 0 }] }, 'a zero player id'),
  badStage({ myPlayers: [{ id: 1e12 }] }, 'an absurdly large player id'),
  badStage({ myPlayers: [{ id: null }] }, 'a null player id'),
  badStage({ myPlayers: [] }, 'no players of your own'),
  badStage({ myPlayers: 'Gibbs' }, 'a name where the list should be'),
  badStage({ myPlayers: Array.from({ length: 13 }, (_, i) => ({ id: i + 1 })) }, 'thirteen men on your side'),
  badStage({ theirPlayerIds: Array.from({ length: 13 }, (_, i) => i + 1) }, 'thirteen men on theirs'),
  badStage({ theirPlayerIds: ['15847'] }, 'their ids as strings'),
  badStage({ myPlayers: [{ id: 5, name: 'x'.repeat(200) }] }, 'a name longer than any real one'),
  badStage({ myPlayers: [{ id: 5, name: 42 }] }, 'a name that is not text'),
  badStage({ myPlayers: [{ id: 5, evil: 1 }] }, 'an unexpected field on a player'),
  badStage({ myPlayers: [{ id: 5 }, { id: 5 }] }, 'the same man twice'),
  badStage({ myPlayers: [{ id: 15847 }] }, 'a man on both sides of the deal'),
  badStage({ leagueId: '4762?x=1' }, 'a leagueId trying to rewrite the query'),
  badStage({ leagueId: '../../x' }, 'a leagueId walking the path'),
  badStage({ season: '20261' }, 'a five-digit season'),
  badStage({ myTeamId: '4&fromTeamId=9' }, 'a team id trying to rewrite the query'),
  badStage({ myTeamId: 'x' }, 'a team id that is not digits'),
  badStage({ theirTeamId: '' }, 'an empty team id'),
  badStage({ myTeamId: '7' }, 'both sides being the same team'),
]) {
  const w = makeWorker();
  const res = await w.send({ ...STAGE, ...patch });
  ok(res && res.ok === false, `refused: ${why}`);
  eq(w.storage.session.size, 0, `nothing stored after: ${why}`);
  eq(w.calls.length, 0, `no request made after: ${why}`);
}
{
  const w = makeWorker();
  const res = await w.send({ ...STAGE, surprise: 'hello' });
  ok(res && res.ok === false && /Unexpected field/.test(res.error), 'an unexpected top-level field is named and refused');
}
{
  // A D/ST's id IS negative — -16000 minus the NFL team — and refusing it
  // refused every trade with a defence in it, on either side.
  const w = makeWorker();
  const res = await w.send({
    ...STAGE,
    myPlayers: [{ id: -16001, name: 'Falcons D/ST' }],
    theirPlayerIds: [-16034, 15847],
  });
  ok(res.ok, 'a D/ST on both sides stages', res.error);
  ok(res.ok && /players=-16034%2C15847|players=-16034,15847/.test(res.data.url),
    'and its id rides in the link', res.data && res.data.url);
  const got = await w.send(TAKE, espnSender);
  eq(got.data && got.data.myPlayers[0].id, -16001, 'and comes back to ESPN’s page intact');
}
{
  // A bare id, with no name, is a legitimate caller — it just cannot find a D/ST.
  const w = makeWorker();
  const res = await w.send({ ...STAGE, myPlayers: [4362628] });
  ok(res.ok, 'a bare list of ids stages');
  const got = await w.send(TAKE, espnSender);
  eq(got.data.myPlayers[0].name, null, 'and comes back with no name rather than a made-up one');
}
{
  // Control characters would wreck the on-page badge; they are scrubbed, not refused.
  const w = makeWorker();
  await w.send({ ...STAGE, myPlayers: [{ id: 5, name: 'Bad\nName\tHere' }] });
  const got = await w.send(TAKE, espnSender);
  eq(got.data.myPlayers[0].name, 'Bad Name Here', 'control characters in a name are flattened to spaces');
}

// ===========================================================================
// PART THREE — the permission that must never grow
// ===========================================================================
//
// This is the load-bearing one. The trade feature ticks checkboxes on a page
// the owner opened; it does NOT write to ESPN, and the proof of that is that
// the extension cannot.

eq(
  JSON.stringify(MANIFEST.host_permissions),
  JSON.stringify(['https://lm-api-reads.fantasy.espn.com/*']),
  'host_permissions is the READ host and nothing else'
);
ok(!/lm-api-writes/.test(stripComments(BACKGROUND)), 'the worker has no write host in its code');
ok(!/lm-api-writes/.test(JSON.stringify(MANIFEST)), 'nor does the manifest');
eq(JSON.stringify(MANIFEST.permissions), JSON.stringify(['storage']), 'and the only API permission is storage');

{
  const scripts = MANIFEST.content_scripts || [];
  const trade = scripts.find((s) => (s.js || []).includes('content-espn-trade.js'));
  ok(trade, 'the tick script is registered as a content script');
  eq(
    JSON.stringify(trade.matches),
    JSON.stringify(['https://fantasy.espn.com/football/team/trade*']),
    'and only on ESPN’s trade page'
  );
  ok(fs.existsSync(repoFile('extension/content-espn-trade.js')), 'and the file it names exists');

  const site = scripts.find((s) => (s.js || []).includes('content-site.js'));
  ok(site && !site.matches.some((m) => m.includes('espn.com')), 'the site bridge is still nowhere near espn.com');
}

{
  // The tick script must not contain a route to submitting. Names, not
  // behaviour, but a future edit that reaches for one trips here first.
  const tick = stripComments(fs.readFileSync(repoFile('extension/content-espn-trade.js'), 'utf8'));
  ok(!/proposeTrade|sendTrade/.test(tick), 'the tick script never names ESPN’s submit call');
  ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(tick), 'and builds no HTML out of names it was handed');
  ok(!/\bfetch\s*\(|XMLHttpRequest/.test(tick), 'and makes no request of its own');
  ok(!/\.submit\s*\(|requestSubmit/.test(tick), 'and submits no form');
}

console.log(fail ? `${pass} passed, ${fail} failed` : `All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
