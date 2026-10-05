// WHAT THE MANAGERS DID, AS DATA — the half of the Decisions review that asks
// ESPN (docs/decisions-review-plan.md, "The contract").
//
//   node test-decision-data.mjs             all scenarios, one child each
//   node test-decision-data.mjs <scenario>  one
//
// Tim, 2026-10-05: "have a list of all the decisions they've made, and what
// would have happened if they hadn't made that that decision ... if a user
// added and dropped a player in a single action, then the hypothetical counts
// both those actions, not just one of them."
//
// js/decisions.js replays a season from a `world`; this is whether the world is
// TRUE. Four seams, each of which a green engine suite would never notice:
//
//   the decoder     `espn.parseTransactions` against what ESPN really sends —
//                   tests/fixtures/transactions-1241838-2026-wk*.json are the
//                   public league's own four weeks, captured 2026-10-05 and
//                   trimmed of member ids. The counts below were taken off
//                   those files by hand, not by the parser.
//   the reads       one week per request, the ids a hundred at a time, and
//                   never the view the extension refuses.
//   the store       a decided week's moves frozen beside its rosters, in keys
//                   of their own.
//   the assembly    `season.fetchDecisionWorld` over a four-squad league small
//                   enough to check by eye: what it costs cold, that it costs
//                   NOTHING warm, and that the open week is never read —
//                   until one of its matchups is over (`seamPartial`), when it
//                   is counted as far as it has been played and never frozen.
//
// A TRADE IS THE ONE THING NOT MEASURED: the public league has never made one.
// The `trades` scenario pins the ASSUMED record shape, and `infer` the net under
// it — a trade found from the rosters, never listed twice.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { moduleUrl, repoFile } from './repo.mjs';
import { emit } from './emit.mjs';

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`);
};
const eq = (a, b, msg) =>
  ok(msg, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const fixture = (name) => JSON.parse(readFileSync(repoFile(`tests/fixtures/${name}`), 'utf8'));
const txWeek = (w) => fixture(`transactions-1241838-2026-wk${w}.json`);

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
// A LEAGUE SMALL ENOUGH TO CHECK BY EYE (the `seam` scenarios)
// ===========================================================================
//
// Four squads of three — a QB (slot 0), an RB (slot 2) and a bench RB — whose
// ids say where they were drafted: 11 12 13, 21 22 23, 31 32 33, 41 42 43.
//
//   week 1   squad 4 drops 43 from its roster page (ESPN: ROSTER + DROP).
//   week 2   squad 1 adds 91 and drops 13 in one action; squads 2 and 3 swap
//            their RBs 22 and 32 — which ESPN's feed lists only when
//            `tradeListed`, so the rosters have to give it away otherwise.
//   week 3   squad 4 adds 92 (a man nobody had named before).
//
// Everybody plays for NFL team 1 except 43, whose team 2 is OFF in week 2.

const LEAGUE_ID = '424242';
const SEASON = 2026;
const KICK = (w) => Date.UTC(2026, 8, 13, 17) + (w - 1) * 7 * 24 * 60 * 60 * 1000;
const DRAFTED = { 1: [11, 12, 13], 2: [21, 22, 23], 3: [31, 32, 33], 4: [41, 42, 43] };
// `seamPartial` only: the men on NFL team 3, whose game in the week in play is
// still going. Empty everywhere else, so every other scenario is what it was.
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
    settings: { name: 'Seam League', rosterSettings: { lineupSlotCounts: { 0: 1, 2: 1, 20: 1, 21: 0 } } },
    members: [],
    teams: [1, 2, 3, 4].map((id) => ({ id, name: `Squad ${id}` })),
    schedule,
  };
}

const item = (type, playerId, fromTeamId, toTeamId) => ({ type, playerId, fromTeamId, toTeamId });
const tx = (id, type, week, teamId, items, more = {}) => ({
  id, type, status: 'EXECUTED', scoringPeriodId: week, teamId, proposedDate: KICK(week) - 4 * 864e5, items, ...more,
});

function transactionsPayload(week, { period, tradeListed }) {
  const list = [];
  if (week === 1) {
    for (const [teamId, ids] of Object.entries(DRAFTED)) {
      for (const id of ids) list.push(tx(`d${id}`, 'DRAFT', 1, Number(teamId), [item('DRAFT', id, 0, Number(teamId))]));
    }
    list.push(tx('w1-lineup', 'ROSTER', 1, 4, [item('LINEUP', 41, 0, 0)]));
    list.push(tx('w1-drop', 'ROSTER', 1, 4, [item('DROP', 43, 4, 0)]));
  }
  if (week === 2) {
    list.push(tx('w2-adddrop', 'WAIVER', 2, 1, [item('ADD', 91, 0, 1), item('DROP', 13, 1, 0)],
      { processDate: KICK(2) - 4 * 864e5 + 60 }));
    list.push({ ...tx('w2-lost', 'WAIVER', 2, 2, [item('ADD', 91, 0, 2)]), status: 'FAILED_INVALIDPLAYERSOURCE' });
    if (tradeListed) {
      const sent = [item('TRADE', 22, 2, 3), item('TRADE', 32, 3, 2)];
      list.push(tx('w2-accept', 'TRADE_ACCEPT', 2, 3, sent, { proposedDate: KICK(2) - 3 * 864e5 }));
      list.push(tx('w2-uphold', 'TRADE_UPHOLD', 2, 2, sent,
        { proposedDate: KICK(2) - 3 * 864e5, processDate: KICK(2) - 2 * 864e5, relatedTransactionId: 'w2-accept' }));
    }
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

/** ESPN, counted. `refuse` is a view to answer with HTTP 500; `inPlay` a week being played. */
function installFetch({ decidedThrough = 2, period = decidedThrough + 1, tradeListed = false, refuse = null, inPlay = null } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const views = u.searchParams.getAll('view');
    const week = Number(u.searchParams.get('scoringPeriodId')) || null;
    const filter = opts.headers && opts.headers['x-fantasy-filter'] ? JSON.parse(opts.headers['x-fantasy-filter']) : null;
    calls.push({ views, week, filter });
    if (refuse && views.includes(refuse)) return { ok: false, status: 500, async json() { return {}; } };
    let body;
    if (views.includes('proTeamSchedules_wl')) body = proPayload(inPlay);
    else if (views.includes('mTransactions2')) body = transactionsPayload(week, { period, tradeListed });
    else if (views.includes('kona_player_info')) body = { players: filter.players.filterIds.value.map((id) => playerEntry(id, week)) };
    else if (views.includes('mRoster')) body = rosterPayload(week);
    else body = schedulePayload(decidedThrough, inPlay);
    return { ok: true, status: 200, async json() { return JSON.parse(JSON.stringify(body)); } };
  };
  return calls;
}
const of = (calls, view) => calls.filter((c) => c.views.includes(view));

/** A new page: new shared-read cache, the same browser storage. */
async function loadSeam(opts) {
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));
  espn.clearReadCache();
  const calls = installFetch(opts);
  const world = await season.fetchDecisionWorld();
  return { world, calls };
}

async function bootSeam() {
  const storage = makeStorage();
  globalThis.localStorage = storage;
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '' });
  const espn = await import(moduleUrl('js/espn.js'));
  espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
  return storage;
}

// ===========================================================================
// SCENARIOS
// ===========================================================================

const SCENARIOS = {
  // ---- the decoder, against ESPN's own four weeks -------------------------
  async parse() {
    const espn = await import(moduleUrl('js/espn.js'));
    const raw = [1, 2, 3, 4].map(txWeek);
    const moves = raw.map((r) => espn.parseTransactions(r));
    const kinds = (list) => {
      const n = { add: 0, drop: 0, adddrop: 0, trade: 0 };
      for (const m of list) n[m.kind]++;
      return n;
    };

    // The files are what was captured: the counts in the brief, to the record.
    eq(raw.map((r) => r.transactions.length), [207, 41, 52, 45], 'the fixtures hold every transaction ESPN sent');
    eq(raw[0].transactions.filter((t) => t.type === 'DRAFT').length, 170, 'week 1 carries the 170 draft picks');

    // Counted off the files by hand: executed FREEAGENT + WAIVER records, plus
    // the executed ROSTER records that carry a DROP.
    eq(moves.map((m) => m.length), [11, 13, 17, 14], 'moves per week: 11, 13, 17, 14');
    eq(kinds(moves[0]), { add: 4, drop: 0, adddrop: 7, trade: 0 }, 'week 1: 4 adds, 7 add+drops, no draft pick among them');
    eq(kinds(moves[1]), { add: 3, drop: 1, adddrop: 9, trade: 0 }, 'week 2: 3 adds, 9 add+drops, 1 plain drop');
    eq(kinds(moves[2]), { add: 3, drop: 1, adddrop: 13, trade: 0 }, 'week 3: 3 adds, 13 add+drops, 1 plain drop');
    eq(kinds(moves[3]), { add: 5, drop: 2, adddrop: 7, trade: 0 }, 'week 4: 5 adds, 7 add+drops, 2 plain drops');

    const all = moves.flat();
    const byId = new Map(all.map((m) => [m.id, m]));
    eq(byId.size, all.length, 'every move has its own id');

    // AN ADD AND A DROP IN ONE ACTION ARE ONE MOVE (a waiver claim, week 2).
    eq(byId.get('5e97ae0f-57c1-42e1-9cf9-d823992a2ffe'), {
      week: 2, at: 1789543584689, id: '5e97ae0f-57c1-42e1-9cf9-d823992a2ffe', kind: 'adddrop',
      teamId: 1, adds: [4696044], drops: [3054850], trade: null,
    }, 'the waiver add+drop is one move with both men, timed by the waiver run (processDate)');
    // A free-agent add+drop has no processDate: it happened when it was made.
    eq(byId.get('86440b68-6fea-494a-99a0-2c04d708e5a8'), {
      week: 2, at: 1789587065888, id: '86440b68-6fea-494a-99a0-2c04d708e5a8', kind: 'adddrop',
      teamId: 1, adds: [-16027], drops: [-16030], trade: null,
    }, 'the free-agent D/ST swap is one move, timed by proposedDate');
    // A PLAIN DROP is filed as ROSTER, beside the lineup changes.
    eq(byId.get('fabd4f4d-0126-45b5-8296-af5a44867293'), {
      week: 2, at: 1789530091561, id: 'fabd4f4d-0126-45b5-8296-af5a44867293', kind: 'drop',
      teamId: 1, adds: [], drops: [4870847], trade: null,
    }, 'a drop from the roster page (type ROSTER, item DROP) is a drop');
    // A PLAIN ADD: squad 7 picks up Drew Lock in week 3, dropping nobody.
    const lock = moves[2].filter((m) => m.adds.includes(3924327));
    eq(lock.map((m) => [m.kind, m.teamId, m.adds, m.drops]), [['add', 7, [3924327], []]], 'a plain add is an add');

    // WHAT IS NOT A MOVE.
    ok('a waiver claim that FAILED is not a move', !byId.has('c371ec60-1dbe-49b3-a469-ee329a46513b'));
    ok('nor is the man it claimed added by anybody that week',
      !moves[1].some((m) => m.teamId === 10 && m.adds.includes(4569559)));
    ok('a CANCELED claim is not a move', !byId.has('9fe2a0d6-c646-4f13-bd91-6d3d3b2491bb'));
    ok('a lineup change is not a move', !byId.has('6b45e5c4-e6ab-462e-bff5-5d1dc2de8095'));
    ok('a draft pick is not a move', !byId.has('60217dbb-c0b2-45c2-84a0-5126a968b1ba'));
    ok('every move names somebody', all.every((m) => m.adds.length + m.drops.length > 0));

    // TIME ORDER, and the week each was made in.
    for (const [i, list] of moves.entries()) {
      ok(`week ${i + 1} is oldest first`, list.every((m, k) => k === 0 || list[k - 1].at <= m.at));
      ok(`week ${i + 1}: every move says week ${i + 1}`, list.every((m) => m.week === i + 1));
      ok(`week ${i + 1}: every move has a real time`, list.every((m) => m.at > 1.7e12));
    }

    // THE DRAFT, for the rosters before anybody moved.
    const draft = espn.parseDraftRosters(raw[0]);
    eq(Object.keys(draft).length, 10, 'ten squads drafted');
    eq(Object.values(draft).map((ids) => ids.length), Array(10).fill(17), 'seventeen men each');
    ok('pick 35 went to squad 4', draft[4].includes(4870808));
    eq(espn.parseDraftRosters(raw[1]), {}, 'and week 2 carries no draft');

    // Nothing at all is still an answer.
    eq(espn.parseTransactions(null), [], 'no payload, no moves');
    eq(espn.parseTransactions({ transactions: [] }), [], 'an empty week, no moves');
  },

  // ---- the trade: an ASSUMED shape, pinned ---------------------------------
  async trades() {
    const espn = await import(moduleUrl('js/espn.js'));
    const sent = [item('TRADE', 501, 5, 6), item('TRADE', 502, 5, 6), item('TRADE', 601, 6, 5)];
    const accept = { id: 'A', type: 'TRADE_ACCEPT', status: 'EXECUTED', scoringPeriodId: 3, teamId: 6, proposedDate: 1000, items: sent };
    const uphold = { id: 'U', type: 'TRADE_UPHOLD', status: 'EXECUTED', scoringPeriodId: 3, teamId: 5, proposedDate: 1000, processDate: 5000, relatedTransactionId: 'A', items: sent };

    const one = espn.parseTransactions({ transactions: [accept] });
    eq(one, [{ week: 3, at: 1000, id: 'A', kind: 'trade', teamId: 6, adds: [], drops: [],
      trade: { withTeamId: 5, gives: [601], gets: [501, 502] } }], 'an accepted trade: who gave whom, from the accepting squad');

    const both = espn.parseTransactions({ transactions: [accept, uphold] });
    eq(both.length, 1, 'ACCEPT and UPHOLD of one trade are ONE move');
    eq([both[0].id, both[0].at], ['U', 5000], 'and it is timed by the uphold — when the players moved');
    eq(espn.tradeKey(both[0]), espn.tradeKey(one[0]), 'the same trade from either side has the same key');

    // The two halves in two different weeks' reads, joined by js/season.js.
    const joined = espn.dropRepeatTrades([{ ...one[0], week: 3 }, { ...both[0], week: 4 }]);
    eq(joined.map((m) => m.id), ['U'], 'a week apart they are still one trade');
    const again = espn.dropRepeatTrades([{ ...one[0], week: 3 }, { ...one[0], id: 'later', week: 7 }]);
    eq(again.length, 2, 'but the same swap four weeks later is another trade');

    const veto = { id: 'V', type: 'TRADE_VETO', status: 'EXECUTED', scoringPeriodId: 3, relatedTransactionId: 'A', items: [] };
    eq(espn.parseTransactions({ transactions: [accept, veto] }), [], 'a vetoed trade never happened');
    eq(espn.parseTransactions({ transactions: [{ ...accept, status: 'PENDING' }] }), [], 'nor one still pending');
    eq(espn.parseTransactions({ transactions: [{ ...accept, type: 'TRADE_PROPOSAL' }] }), [], 'nor a proposal');

    // A man cut to make room rides on the trade's record.
    const cut = espn.parseTransactions({ transactions: [{ ...accept, items: [...sent, item('DROP', 699, 6, 0), item('DROP', 599, 5, 0)] }] });
    eq(cut.map((m) => [m.kind, m.teamId, m.drops]), [['trade', 6, [699]], ['drop', 5, [599]]],
      'the accepting squad’s cut is on the trade, the partner’s is his own drop');
  },

  // ---- the net under it: a trade read off the rosters ----------------------
  async infer() {
    const season = await import(moduleUrl('js/season.js'));
    const team = (id, ids) => ({ id, players: ids.map((playerId) => ({ playerId })) });
    const rosters = new Map([
      [1, [team(1, [11, 12]), team(2, [21, 22]), team(3, [31, 32])]],
      [2, [team(1, [11, 22]), team(2, [21, 12]), team(3, [31, 99])]],
    ]);
    const add99 = { id: 'x', kind: 'adddrop', week: 2, at: 500, teamId: 3, adds: [99], drops: [32], trade: null };

    const found = season.inferTrades({ weeks: [1, 2], rosters, moves: [add99], firstKickoff: { 2: 9000 } });
    eq(found, [{ id: 'inferred:2:1:2', kind: 'trade', week: 2, at: 8999, teamId: 1, adds: [], drops: [],
      trade: { withTeamId: 2, gives: [12], gets: [22] }, inferred: true }],
    'two squads that exchanged men between two weeks’ rosters traded');

    // NEVER TWICE: ESPN listed it, so the rosters have nothing left to add.
    const listed = { id: 'T', kind: 'trade', week: 2, at: 700, teamId: 2, adds: [], drops: [], trade: { withTeamId: 1, gives: [22], gets: [12] } };
    eq(season.inferTrades({ weeks: [1, 2], rosters, moves: [add99, listed] }), [], 'a trade ESPN listed is not found again');
    eq(season.inferTrades({ weeks: [1, 2], rosters, moves: [add99, { ...listed, week: 1 }] }), [],
      'not even when it was accepted the week before the rosters show it');

    // A man dropped by one squad and added by another is a waiver move.
    const viaWire = new Map([
      [1, [team(1, [11, 12]), team(2, [21, 22])]],
      [2, [team(1, [11, 22]), team(2, [21, 12])]],
    ]);
    const wire = [
      { id: 'a', kind: 'adddrop', week: 2, at: 1, teamId: 1, adds: [22], drops: [12], trade: null },
      { id: 'b', kind: 'adddrop', week: 2, at: 2, teamId: 2, adds: [12], drops: [22], trade: null },
    ];
    eq(season.inferTrades({ weeks: [1, 2], rosters: viaWire, moves: wire }), [], 'men who changed squads through the wire were not traded');

    // One-way movement is not a trade.
    const oneWay = new Map([[1, [team(1, [11, 12]), team(2, [21])]], [2, [team(1, [11]), team(2, [21, 12])]]]);
    eq(season.inferTrades({ weeks: [1, 2], rosters: oneWay, moves: [] }), [], 'a man who only turns up elsewhere is not a trade');

    // Week 1 is set against the draft.
    const wk1 = new Map([[1, [team(1, [11, 22]), team(2, [21, 12])]]]);
    eq(season.inferTrades({ weeks: [1], rosters: wk1, moves: [] }), [], 'with no draft, week 1 has nothing to be compared with');
    eq(season.inferTrades({ weeks: [1], rosters: wk1, moves: [], draft: { 1: [11, 12], 2: [21, 22] } }).map((m) => m.trade),
      [{ withTeamId: 2, gives: [12], gets: [22] }], 'with the draft, a week-1 trade is found');

    // Received and cut the same week: he is on nobody's roster to be seen.
    const cutRosters = new Map([[1, [team(1, [11, 12]), team(2, [21, 22])]], [2, [team(1, [11, 22]), team(2, [21])]]]);
    const cut = [{ id: 'c', kind: 'drop', week: 2, at: 5, teamId: 2, adds: [], drops: [12], trade: null }];
    eq(season.inferTrades({ weeks: [1, 2], rosters: cutRosters, moves: cut }).map((m) => m.trade),
      [{ withTeamId: 2, gives: [12], gets: [22] }], 'a traded man cut the same week still counts as received');
  },

  // ---- what is asked of ESPN, and how a player's week is read back ---------
  async reads() {
    const espn = await import(moduleUrl('js/espn.js'));
    espn.configure({ leagueId: '1241838', season: 2026 });
    const seen = [];
    globalThis.fetch = async (url, opts = {}) => {
      const u = new URL(String(url));
      const filter = opts.headers['x-fantasy-filter'] ? JSON.parse(opts.headers['x-fantasy-filter']) : null;
      seen.push({ views: u.searchParams.getAll('view'), week: u.searchParams.get('scoringPeriodId'), filter });
      const ids = filter ? filter.players.filterIds.value : [];
      return { ok: true, status: 200, async json() { return { transactions: [], players: ids.map((id) => ({ id, player: { id } })) }; } };
    };

    await espn.fetchTransactions(3);
    eq(seen.pop(), { views: ['mTransactions2'], week: '3', filter: null }, 'a week’s transactions are asked for by scoringPeriodId');
    await espn.fetchTransactions();
    eq(seen.pop(), { views: ['mTransactions2'], week: null, filter: null }, 'with no week (the debug page) the request is what it always was');

    const got = await espn.fetchPlayersWeek([4678008, 4685720, 3924327, 4685720], 2);
    eq(seen, [{ views: ['kona_player_info'], week: '2', filter: { players: { filterIds: { value: [3924327, 4678008, 4685720] } } } }],
      'players by id: kona_player_info, that week, the ids once each, and no limit (ESPN refuses one without a sort)');
    eq(got.length, 3, 'and every entry comes back');

    seen.length = 0;
    const many = Array.from({ length: 250 }, (_, i) => 1000 + i);
    const back = await espn.fetchPlayersWeek(many, 5);
    eq(seen.map((c) => c.filter.players.filterIds.value.length), [100, 100, 50], '250 ids go a hundred to a request');
    eq(back.length, 250, 'and come back as one list');
    ok('never the view the extension refuses', seen.every((c) => !c.views.includes('kona_playercard')));
    seen.length = 0;
    eq(await espn.fetchPlayersWeek([], 2), [], 'nobody asked for costs nothing');
    eq(seen.length, 0, '— not a request');

    // ESPN's own answer for three men in week 2 (captured 2026-10-05).
    const kona = fixture('players-week-1241838-2026-wk2.json');
    const byId = new Map(kona.players.map((e) => [e.player.id, espn.parsePlayerWeek(e, 2)]));
    eq(byId.get(3924327), { playerId: 3924327, name: 'Drew Lock', position: 'QB', proTeamId: 26, projected: 15.70639184, actual: 21.4 },
      'Drew Lock, on nobody’s roster, week 2: scored 21.4 against a projection of 15.7');
    eq([byId.get(4678008).name, byId.get(4678008).position, byId.get(4678008).actual, byId.get(4678008).projected],
      ['Jonathon Brooks', 'RB', 1.6, 7.84475601], 'Jonathon Brooks: 1.6 against 7.8');
    eq([byId.get(4685720).actual, byId.get(4685720).projected], [24.08, 16.59967041], 'Bryce Young: 24.08 against 16.6');
    eq([espn.parsePlayerWeek(kona.players[0], 9).actual, espn.parsePlayerWeek(kona.players[0], 9).projected], [null, null],
      'a week the entry was not read for has no line, and says so');
  },

  // ---- the frozen week, in keys of its own ---------------------------------
  async store() {
    const storage = makeStorage();
    globalThis.localStorage = storage;
    const store = await import(moduleUrl('js/store.js'));
    const L = '777';
    const teams = [{ id: 1, players: [{ playerId: 11, projected: 9 }] }];
    store.writeWeek(L, 2026, 1, teams, { final: true, byesKnown: true });
    const before = JSON.stringify([...storage._map]);

    const rec = {
      moves: [{ id: 'm', kind: 'add', week: 1, at: 5, teamId: 1, adds: [91], drops: [], trade: null }],
      players: { 91: { name: 'Man', position: 'RB', proTeamId: 1, projected: 3.2, actual: 7 } },
      draft: { 1: [11] },
    };
    eq(store.readDecisionWeek(L, 2026, 1), null, 'a week never frozen is absent');
    eq(store.writeDecisionWeek(L, 2026, 1, rec), false, 'a week nobody called decided is REFUSED');
    eq(store.writeDecisionWeek(L, 2026, 1, rec, { final: false }), false, 'and so is one called undecided');
    eq(JSON.stringify([...storage._map]), before, 'nothing was written by either');
    eq(store.writeDecisionWeek(L, 2026, 1, rec, { final: true }), true, 'a decided week is kept');

    const got = store.readDecisionWeek(L, 2026, 1);
    eq([got.moves, got.players, got.draft], [rec.moves, rec.players, rec.draft], 'and comes back as it went in');
    eq(store.readDecisionWeek(L, 2026, 2), null, 'another week is still absent');
    eq(store.readDecisionWeek('778', 2026, 1), null, 'another league is absent');
    eq(store.readDecisionWeek(L, 2025, 1), null, 'another season is absent');

    // ADDITIVE: the roster week beside it is byte for byte what it was.
    const weekKey = [...storage._map.keys()].find((k) => k.startsWith('ff.weeks.'));
    eq(storage._map.get(weekKey), new Map(JSON.parse(before)).get(weekKey), 'the stored roster week is untouched');
    eq([...storage._map.keys()].filter((k) => !k.startsWith('ff.weeks.')).length, 1, 'the moves live under one key of their own');
    eq(store.list(L, 2026).map((e) => e.week), [1], 'and the list of stored weeks does not count them');
    eq(store.readWeek(L, 2026, 1).teams, teams, 'the roster week still reads back');

    // A month on, a decided week is still there.
    for (const [k, v] of storage._map) {
      const e = JSON.parse(v);
      e.at -= 40 * 24 * 60 * 60 * 1000;
      storage._map.set(k, JSON.stringify(e));
    }
    ok('a frozen week does not expire', !!store.readDecisionWeek(L, 2026, 1));

    // FORGET takes the moves with the weeks, and only this league's.
    store.writeDecisionWeek('778', 2026, 1, rec, { final: true });
    eq(store.forget(L, 2026), 1, 'forget still answers in weeks');
    eq(store.readDecisionWeek(L, 2026, 1), null, 'and the moves went with them');
    ok('another league’s are left alone', !!store.readDecisionWeek('778', 2026, 1));

    storage._map.set('ff.decisions.1.778.2026.3', '{not json');
    eq(store.readDecisionWeek('778', 2026, 3), null, 'a record that will not parse is absent, not a throw');
  },

  // ---- the assembly: cold, warm, and what is never read --------------------
  async seam() {
    const storage = await bootSeam();
    const cold = await loadSeam();
    const w = cold.world;

    eq(w.weeks, [1, 2], 'the weeks are the ones ESPN has decided every game of');
    eq([of(cold.calls, 'mRoster').length, of(cold.calls, 'mTransactions2').length, of(cold.calls, 'kona_player_info').length],
      [2, 2, 2], 'COLD: per decided week, one roster read, one transaction read, one player read');
    eq(w.requests, 6, 'and the world says so');
    ok('THE OPEN WEEK IS NEVER READ for moves or player-weeks',
      cold.calls.every((c) => !(c.week > 2 && (c.views.includes('mTransactions2') || c.views.includes('kona_player_info')))),
      JSON.stringify(cold.calls.filter((c) => c.week > 2)));

    // The contract, field by field.
    eq(Object.keys(w).sort(), ['games', 'isDemo', 'limits', 'moves', 'name', 'partialWeek', 'players', 'requests', 'rosters', 'slots', 'teams', 'weeks'],
      'the world has the contract’s fields (plus isDemo, name, requests, partialWeek)');
    eq(w.partialWeek, null, 'no week is in play: nobody has a point in week 3');
    eq(w.slots, [0, 2], 'slots come from the league’s own settings');
    eq(w.limits, { roster: 3 }, 'and so does the roster size');
    eq(w.teams, [1, 2, 3, 4].map((id) => ({ id, name: `Squad ${id}`, teamName: `Squad ${id}` })), 'teams: id, name, teamName');
    eq(w.games.length, 4, 'two games a week, two weeks');
    eq(w.games[0], { week: 1, homeId: 1, awayId: 2,
      homeActual: actOf(11, 1) + actOf(12, 1), awayActual: actOf(21, 1) + actOf(22, 1),
      homeProjected: Math.round((projOf(11, 1) + projOf(12, 1)) * 10) / 10, awayProjected: Math.round((projOf(21, 1) + projOf(22, 1)) * 10) / 10,
    }, 'a game is in computeLeagueStats’ shape, projected side = the started lineup');
    ok('rosters is a Map of the decided weeks', w.rosters instanceof Map && [...w.rosters.keys()].join() === '1,2');
    eq(w.rosters.get(2).find((t) => t.id === 2).players.map((p) => [p.playerId, p.lineupSlotId, p.started]),
      [[21, 0, true], [32, 2, true], [23, 20, false]], 'a roster is fetchWeeksRosters’ own, slot and all');

    // The moves, oldest first — and the swap ESPN did not list, once.
    eq(w.moves.map((m) => [m.id, m.kind, m.week, m.teamId, m.adds, m.drops]), [
      ['w1-drop', 'drop', 1, 4, [], [43]],
      ['w2-adddrop', 'adddrop', 2, 1, [91], [13]],
      ['inferred:2:2:3', 'trade', 2, 2, [], []],
    ], 'the moves: week 1’s drop, week 2’s add+drop, and the swap found from the rosters');
    eq(w.moves[2].trade, { withTeamId: 3, gives: [22], gets: [32] }, 'the swap: squad 2 gave 22 and got 32');
    eq([w.moves[2].inferred, w.moves[2].at], [true, KICK(2) - 1], 'marked as found, a moment before week 2 kicked off');
    ok('in time order', w.moves.every((m, i) => i === 0 || w.moves[i - 1].at <= m.at));

    // Every man, every week — on a roster or off one.
    ok('players is a Map', w.players instanceof Map);
    eq([...w.players.keys()].sort((a, b) => a - b), [11, 12, 13, 21, 22, 23, 31, 32, 33, 41, 42, 43, 91],
      'every rostered man and every man a move names');
    ok('every one of them has both weeks, as numbers', [...w.players.values()].every((p) => [1, 2].every((wk) =>
      p.byWeek[wk] && typeof p.byWeek[wk].actual === 'number' && typeof p.byWeek[wk].projected === 'number')));
    eq(w.players.get(13), { name: 'Man 13', position: 'RB', byWeek: {
      1: { actual: actOf(13, 1), projected: projOf(13, 1), kickoff: KICK(1), done: true },
      2: { actual: actOf(13, 2), projected: projOf(13, 2), kickoff: KICK(2), done: true },
    } }, 'the man dropped in week 2 still has his week-2 score — what "if I had kept him" needs');
    eq(w.players.get(91).byWeek[1], { actual: actOf(91, 1), projected: projOf(91, 1), kickoff: KICK(1), done: true },
      'and the man added in week 2 has the week before he came');
    eq(w.players.get(43).byWeek[2], { actual: actOf(43, 2), projected: 0, kickoff: null, done: true },
      'THE BYE RULE: off in week 2, he projects 0 and has no kickoff, whatever ESPN sent');
    eq(w.players.get(43).byWeek[1].kickoff, KICK(1) + 3600e3, 'a kickoff is his own NFL team’s');
    eq(of(cold.calls, 'kona_player_info').map((c) => [c.week, c.filter.players.filterIds.value]).sort((a, b) => a[0] - b[0]),
      [[1, [43, 91]], [2, [13, 43]]], 'only the men who were on NO roster that week are bought');

    // ADDITIVE in the store: a roster week is the same bytes as before.
    const weekKeys = [...storage._map.keys()].filter((k) => k.startsWith('ff.weeks.'));
    const snapshot = weekKeys.map((k) => storage._map.get(k));
    eq([...storage._map.keys()].filter((k) => k.startsWith('ff.decisions.')).sort(),
      [`ff.decisions.1.${LEAGUE_ID}.${SEASON}.1`, `ff.decisions.1.${LEAGUE_ID}.${SEASON}.2`], 'both decided weeks are frozen, under their own keys');

    // WARM: the next page.
    const warm = await loadSeam();
    eq([of(warm.calls, 'mRoster').length, of(warm.calls, 'mTransactions2').length, of(warm.calls, 'kona_player_info').length],
      [0, 0, 0], 'WARM: a decided week costs NOTHING the second time');
    eq(warm.world.requests, 0, 'and the world says so');
    const flat = (x) => JSON.stringify({ ...x, requests: 0, rosters: [...x.rosters], players: [...x.players] });
    ok('the warm world is the cold world', flat(warm.world) === flat(w));
    eq(weekKeys.map((k) => storage._map.get(k)), snapshot, 'and the stored roster weeks are byte for byte what they were');

    // WEEK 3 IS DECIDED: one new week is bought, and the man it names (92) is
    // bought for the two weeks already frozen — once.
    const next = await loadSeam({ decidedThrough: 3 });
    eq(next.world.weeks, [1, 2, 3], 'a third week');
    eq(of(next.calls, 'mTransactions2').map((c) => c.week), [3], 'only the new week’s moves are read');
    eq(of(next.calls, 'kona_player_info').map((c) => [c.week, c.filter.players.filterIds.value]).sort((a, b) => a[0] - b[0]),
      [[1, [92]], [2, [92]], [3, [13, 43]]], 'the new man is bought for the old weeks, and nobody twice');
    eq(next.world.players.get(92).byWeek[1].actual, actOf(92, 1), 'so he has every week too');
    eq(next.world.moves.map((m) => m.id), ['w1-drop', 'w2-adddrop', 'inferred:2:2:3', 'w3-add'], 'four moves now, the swap still once');
    const settled = await loadSeam({ decidedThrough: 3 });
    eq([of(settled.calls, 'mTransactions2').length, of(settled.calls, 'kona_player_info').length], [0, 0], 'and after that, nothing again');

    // DEMO never touches ESPN or the store.
    const season = await import(moduleUrl('js/season.js'));
    const before = storage._map.size;
    const calls = installFetch();
    const demo = await season.fetchDecisionWorld({ demo: true });
    eq([demo.isDemo, calls.length, storage._map.size], [true, 0, before], '{ demo: true } is the sample league: no request, nothing stored');
  },

  // ---- the week in play: counted as far as it has been played, never frozen --
  //
  // Tim, 2026-10-05: "Could you just display everything you're able to, like we
  // do across the rest of the cite?" Weeks 1 and 2 are decided; week 3 is being
  // played. 41 (squad 4's QB) and 13 (on nobody's roster) play in the late game,
  // which is not over — so 1 v 2 is a final and 3 v 4 is not.
  async seamPartial() {
    LATE.add(41);
    LATE.add(13);
    const storage = await bootSeam();
    const cold = await loadSeam({ inPlay: 3 });
    const w = cold.world;
    const frozen = () => [...storage._map.keys()].filter((k) => k.startsWith('ff.decisions.')).sort();

    eq(w.weeks, [1, 2, 3], 'the week in play is the last of the weeks');
    eq(w.partialWeek, 3, 'and the world says which it is');
    eq(w.games.filter((g) => g.week === 3), [
      { week: 3, homeId: 1, awayId: 2, homeActual: startedTotal(1, 3), awayActual: startedTotal(2, 3),
        homeProjected: Math.round((projOf(11, 3) + projOf(12, 3)) * 10) / 10, awayProjected: Math.round((projOf(21, 3) + projOf(32, 3)) * 10) / 10 },
      { week: 3, homeId: 3, awayId: 4, homeActual: null, awayActual: null,
        homeProjected: Math.round((projOf(31, 3) + projOf(22, 3)) * 10) / 10, awayProjected: Math.round((projOf(41, 3) + projOf(42, 3)) * 10) / 10 },
    ], 'the finished matchup has its score, the other none; both have the PRE-GAME projected totals');
    eq(w.games.length, 6, 'on top of the two decided weeks’ four');

    const man = (teamId, id) => w.rosters.get(3).find((t) => t.id === teamId).players.find((p) => p.playerId === id);
    eq([man(1, 11).done, man(1, 11).projected, man(1, 11).actual, 'pregame' in man(1, 11)], [true, projOf(11, 3), actOf(11, 3), false],
      'a finished man: done, his score, and the projection he had BEFORE the game — not the score over it');
    eq([man(4, 41).done, man(4, 41).projected], [false, projOf(41, 3)], 'a man still playing: not done');
    ok('every man on a week-3 roster says one or the other',
      w.rosters.get(3).every((t) => t.players.every((p) => typeof p.done === 'boolean')));
    ok('and nobody in a decided week carries the flag', w.rosters.get(2).every((t) => t.players.every((p) => !('done' in p))));
    const squad4 = w.rosters.get(3).find((t) => t.id === 4);
    ok('starters are the same objects as players', squad4.starters.every((p) => squad4.players.includes(p)));

    eq(w.players.get(11).byWeek[3], { actual: actOf(11, 3), projected: projOf(11, 3), kickoff: KICK(3), done: true }, 'players: a finished man’s week');
    eq(w.players.get(41).byWeek[3].done, false, 'players: the man still playing');
    eq([w.players.get(13).byWeek[3].done, w.players.get(43).byWeek[3].done], [false, true],
      'a man on NOBODY’s roster is finished by the same rule: 13’s game is on, 43’s is over');
    ok('everybody is done in every decided week', [...w.players.values()].every((p) => p.byWeek[1].done === true && p.byWeek[2].done === true));
    eq(w.moves.map((m) => m.id), ['w1-drop', 'w2-adddrop', 'inferred:2:2:3', 'w3-add'], 'the moves made in the week in play are listed with the rest');

    // What it cost, and what was kept.
    const cost = (c) => [of(c, 'mRoster').length, of(c, 'mTransactions2').length, of(c, 'kona_player_info').length];
    eq(cost(cold.calls), [3, 3, 3], 'COLD: the week in play costs what a decided week costs');
    eq(w.requests, 9, 'and the world says so');
    eq(frozen().filter((k) => !k.includes('-open')), [`ff.decisions.1.${LEAGUE_ID}.${SEASON}.1`, `ff.decisions.1.${LEAGUE_ID}.${SEASON}.2`],
      'THE WEEK IN PLAY IS NOT FROZEN: only the decided weeks have a record');
    const store = await import(moduleUrl('js/store.js'));
    eq(store.readDecisionWeek(LEAGUE_ID, SEASON, 3), null, 'asked for as a decided week, it is absent');
    ok('the stored week-3 rosters are not final either', store.readWeek(LEAGUE_ID, SEASON, 3).final !== true);

    // A RELOAD does not hammer ESPN...
    const warm = await loadSeam({ inPlay: 3 });
    eq(cost(warm.calls), [0, 0, 0], 'WARM, inside five minutes: nothing is asked again');
    eq([warm.world.requests, warm.world.partialWeek, warm.world.players.get(13).byWeek[3].done], [0, 3, false], 'and it is the same week in play');

    // ...and six minutes on, the week in play is read again — it alone.
    for (const [k, v] of storage._map) {
      if (!k.endsWith(`.${LEAGUE_ID}.${SEASON}.3`) && !k.includes('-open')) continue;
      const e = JSON.parse(v);
      e.at -= 6 * 60 * 1000;
      storage._map.set(k, JSON.stringify(e));
    }
    const aged = await loadSeam({ inPlay: 3 });
    eq([of(aged.calls, 'mRoster').map((c) => c.week), of(aged.calls, 'mTransactions2').map((c) => c.week), of(aged.calls, 'kona_player_info').map((c) => c.week)],
      [[3], [3], [3]], 'AGED: three requests, all for the week in play');
    eq(aged.world.requests, 3, 'and the world says so');

    // ESPN CLOSES THE WEEK: it is read as history, and frozen like any other.
    LATE.clear();
    const closed = await loadSeam({ decidedThrough: 3 });
    eq([closed.world.weeks, closed.world.partialWeek], [[1, 2, 3], null], 'decided, it is no longer the week in play');
    eq(of(closed.calls, 'mTransactions2').map((c) => c.week), [3], 'its moves are read once more, as a decided week’s');
    ok('and now it is frozen', !!store.readDecisionWeek(LEAGUE_ID, SEASON, 3));
    ok('with every man done', [...closed.world.players.values()].every((p) => p.byWeek[3].done === true));
  },

  // ---- ESPN lists the trade AND the rosters show it: still once -------------
  async seamListed() {
    await bootSeam();
    const { world } = await loadSeam({ tradeListed: true });
    const trades = world.moves.filter((m) => m.kind === 'trade');
    eq(trades.length, 1, 'a trade ESPN lists (ACCEPT + UPHOLD) and the rosters show is listed ONCE');
    eq([trades[0].id, trades[0].inferred, trades[0].teamId, trades[0].trade],
      ['w2-uphold', undefined, 2, { withTeamId: 3, gives: [22], gets: [32] }], 'and it is ESPN’s own record, not the found one');
    const again = await loadSeam({ tradeListed: true });
    eq(again.world.moves.filter((m) => m.kind === 'trade').length, 1, 'once from the frozen copy too');
  },

  // ---- a week ESPN has not moved on from is used, but not frozen ------------
  async seamNotClosed() {
    const storage = await bootSeam();
    const first = await loadSeam({ period: 2 });
    eq(first.world.weeks, [1, 2], 'both decided weeks are in the world');
    eq([...storage._map.keys()].filter((k) => k.startsWith('ff.decisions.')), [`ff.decisions.1.${LEAGUE_ID}.${SEASON}.1`],
      'but a week ESPN’s scoring period has not passed is NOT frozen — a move could still be filed under it');
    const second = await loadSeam({ period: 3 });
    eq(of(second.calls, 'mTransactions2').map((c) => c.week), [2], 'so it is read again next time, and only it');
    eq([...storage._map.keys()].filter((k) => k.startsWith('ff.decisions.')).length, 2, 'and frozen once the period has passed');
  },

  // ---- a failure is an error, never a quiet gap -----------------------------
  async seamRefused() {
    await bootSeam();
    // Rosters first: once a decided week's rosters are stored they are never
    // asked for again, so there is nothing left of that read to refuse.
    for (const view of ['mRoster', 'mTransactions2', 'kona_player_info']) {
      let threw = null;
      try { await loadSeam({ refuse: view }); } catch (err) { threw = err; }
      ok(`ESPN refusing ${view} is an error, not a world with a hole in it`, threw instanceof Error, String(threw));
    }
    const { world } = await loadSeam();
    eq(world.moves.length, 3, 'and the next load, with ESPN answering, is whole');
  },

  // ---- the sample league ---------------------------------------------------
  async demo() {
    globalThis.fetch = async () => { throw new Error('the demo must not touch the network'); };
    const season = await import(moduleUrl('js/season.js'));
    const w = await season.fetchDecisionWorld();
    const again = await season.fetchDecisionWorld();
    const flat = (x) => JSON.stringify({ ...x, rosters: [...x.rosters], players: [...x.players] });
    ok('the same world every time', flat(w) === flat(again));

    eq([w.isDemo, w.requests, w.teams.length, w.weeks.length], [true, 0, 10, 13], 'ten squads, thirteen decided weeks, no requests');
    eq(w.slots.slice().sort((a, b) => a - b), [0, 2, 2, 4, 4, 6, 16, 17, 23], 'the sample league’s nine starters');
    eq(w.limits, { roster: 16 }, 'sixteen-man rosters');
    eq(w.games.length, 65, 'five games a week');

    const kinds = {};
    for (const m of w.moves) kinds[m.kind] = (kinds[m.kind] || 0) + 1;
    eq(kinds.trade, 1, 'exactly one trade');
    ok('and a season of add+drops', kinds.adddrop > 20, JSON.stringify(kinds));
    ok('in time order', w.moves.every((m, i) => i === 0 || w.moves[i - 1].at <= m.at));
    ok('every move id is its own', new Set(w.moves.map((m) => m.id)).size === w.moves.length);

    // THE MOVES EXPLAIN THE ROSTERS: week 1's squads, with each week's moves
    // played on top, are that week's squads.
    const held = new Map(w.rosters.get(1).map((t) => [t.id, new Set(t.players.map((p) => p.playerId))]));
    let explained = true;
    for (const week of w.weeks.slice(1)) {
      for (const m of w.moves.filter((x) => x.week === week)) {
        for (const id of m.drops) held.get(m.teamId).delete(id);
        for (const id of m.adds) held.get(m.teamId).add(id);
        if (m.trade) {
          for (const id of m.trade.gives) { held.get(m.teamId).delete(id); held.get(m.trade.withTeamId).add(id); }
          for (const id of m.trade.gets) { held.get(m.trade.withTeamId).delete(id); held.get(m.teamId).add(id); }
        }
      }
      for (const t of w.rosters.get(week)) {
        const now = t.players.map((p) => p.playerId).sort((a, b) => a - b);
        if (JSON.stringify(now) !== JSON.stringify([...held.get(t.id)].sort((a, b) => a - b))) explained = false;
      }
    }
    ok('week 1’s squads plus the moves are every later week’s squads', explained);

    // The trade moved two starters, and the scores moved with them.
    const trade = w.moves.find((m) => m.kind === 'trade');
    const [gave, got] = [trade.trade.gives[0], trade.trade.gets[0]];
    const on = (week, teamId, id) => w.rosters.get(week).find((t) => t.id === teamId).players.find((p) => p.playerId === id);
    ok('before it each man is on his own squad', on(trade.week - 1, trade.teamId, gave) && on(trade.week - 1, trade.trade.withTeamId, got));
    ok('from it on, on the other', w.weeks.filter((x) => x >= trade.week).every((x) =>
      on(x, trade.teamId, got) && on(x, trade.trade.withTeamId, gave) && !on(x, trade.teamId, gave)));
    ok('and the man received starts that week', on(trade.week, trade.teamId, got).started === true);
    let adds = true;
    for (const g of w.games) {
      for (const [id, total] of [[g.homeId, g.homeActual], [g.awayId, g.awayActual]]) {
        const sum = w.rosters.get(g.week).find((t) => t.id === id).players.filter((p) => p.started).reduce((a, p) => a + p.actual, 0);
        if (Math.abs(sum - total) > 0.051) adds = false;
      }
    }
    ok('every squad’s starters add up to its score in every week', adds);

    // Every man, every week.
    const named = new Set(w.moves.flatMap((m) => [...m.adds, ...m.drops, ...(m.trade ? [...m.trade.gives, ...m.trade.gets] : [])]));
    ok('every man a move names is in players', [...named].every((id) => w.players.has(id)));
    ok('with a score, a projection and a kickoff in all thirteen weeks', [...w.players.values()].every((p) => w.weeks.every((wk) =>
      typeof p.byWeek[wk].actual === 'number' && typeof p.byWeek[wk].projected === 'number' && p.byWeek[wk].kickoff > 0)));
    ok('and every move was made before its week kicked off',
      w.moves.every((m) => m.at < w.players.get([...named][0]).byWeek[m.week].kickoff));
  },

  // ---- the stub the page suites boot against -------------------------------
  async stub() {
    const stub = await import(moduleUrl('tests/cap-stub-season.mjs'));
    const C = stub.DECISION_CASES;
    const w = await stub.fetchDecisionWorld();
    const flat = (x) => JSON.stringify({ ...x, rosters: [...x.rosters], players: [...x.players] });
    ok('the same world every time', flat(w) === flat(await stub.fetchDecisionWorld()));
    eq(w.weeks, [1, 2, 3], 'the stub’s three decided weeks');
    eq(w.slots, [0, 2, 2, 4, 4, 4, 6, 23, 16, 17], 'its ten starting slots');

    const move = (k) => w.moves.find((m) => m.id === C[k].id);
    eq([move('adddrop').kind, move('adddrop').adds, move('adddrop').drops], ['adddrop', [C.adddrop.add], [C.adddrop.drop]], 'one add+drop pair');
    eq([move('add').kind, move('add').adds, move('add').drops], ['add', [C.add.add], []], 'one plain add');
    eq([move('drop').kind, move('drop').drops], ['drop', [C.drop.drop]], 'one plain drop');
    eq([move('readd').kind, move('readd').teamId, move('readd').adds, move('readd').week > move('drop').week],
      ['add', C.readd.teamId, [C.drop.drop], true], '… of a man another squad adds later');
    eq(move('trade').trade, { withTeamId: C.trade.withTeamId, gives: [C.trade.gives], gets: [C.trade.gets] }, 'one trade');
    ok('in time order', w.moves.every((m, i) => i === 0 || w.moves[i - 1].at <= m.at));

    const squad = (week, id) => w.rosters.get(week).find((t) => t.id === id).players;
    const man = (week, id, playerId) => squad(week, id).find((p) => p.playerId === playerId);
    ok('the dropped QB is on his old squad in week 1 and gone in week 2', man(1, 3, C.drop.drop) && !man(2, 3, C.drop.drop));
    ok('and STARTS for the squad that picked him up in week 3, over its own QB',
      man(3, 4, C.drop.drop).started && man(3, 4, C.drop.drop).lineupSlotId === 0 && man(3, 4, C.readd.benched).started === false);
    ok('the traded men start for their new squads in week 3', man(3, 5, C.trade.gets).started && man(3, 6, C.trade.gives).started);
    for (const week of w.weeks) {
      ok(`week ${week}: squad 7 sits a man who out-projects its starter`,
        man(week, 7, C.benched.bench).started === false &&
        man(week, 7, C.benched.bench).projected > man(week, 7, C.benched.starter).projected);
    }
    let adds = true;
    for (const g of w.games) {
      for (const [id, total] of [[g.homeId, g.homeActual], [g.awayId, g.awayActual]]) {
        const sum = squad(g.week, id).filter((p) => p.started).reduce((a, p) => a + p.actual, 0);
        if (Math.abs(sum - total) > 0.051) adds = false;
      }
    }
    ok('every squad’s starters add up to its score', adds);
    ok('every man, rostered or named, has all three weeks', [9001, 9002, C.drop.drop, 100, 1013].every((id) =>
      w.weeks.every((wk) => typeof w.players.get(id).byWeek[wk].actual === 'number' && w.players.get(id).byWeek[wk].kickoff > 0)));
    ok('a rostered man’s line in players is the one on his roster',
      w.weeks.every((wk) => squad(wk, 5).every((p) => w.players.get(p.playerId).byWeek[wk].actual === p.actual)));
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
  // One child each: an ES module initialises once per process, and the seam
  // scenarios each want their own storage and their own module state.
  const res = spawnSync(process.execPath, [self, name], { encoding: 'utf8', timeout: 60000 });
  const line = (res.stdout || '').split('\n').filter((l) => l.startsWith('@@')).pop();
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
