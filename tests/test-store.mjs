// THE WEEKS SURVIVE A NAVIGATION — js/store.js, and the seam in js/season.js.
//
//   node test-store.mjs             all scenarios, one child each
//   node test-store.mjs <scenario>  one (no loader needed by any of them)
//
// Tim, 2026-09-19: "when you load something, it loads but then goes away and
// you have to re-load it every time you switch between sectoins or whatever."
//
// Every page of this site is a separate HTML document, so every in-memory cache
// in js/season.js dies on every navigation and the next page re-buys the same
// weeks one request each. js/store.js is that cache moved into localStorage.
//
// TWO HALVES, AND THE SECOND IS THE ONE THAT MATTERS. The first is the module's
// own rules — which a pure test can check by eye. The second is the SEAM: that
// js/season.js really reads it before it asks ESPN, and really writes what ESPN
// answers. A cache nobody wires up changes nothing and every existing suite
// would still be green — the same trap `test-floor.mjs` documents for the
// positional floor.
//
// THE FRESHNESS RULE IS THE THING TO GET RIGHT, and it is not one TTL:
//
//   a PLAYED week never changes again           -> kept for the season
//   a week still to come is a forecast          -> six hours, then re-read
//   never read                                  -> stale, always
//
// Which of the two a week is comes off the SCHEDULE and never off the calendar,
// so the scenarios below prove both directions: a decided week is served back
// after a simulated fortnight, and an undecided one is not served back after
// seven hours.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`);
};
const eq = (a, b, msg) =>
  ok(msg, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ===========================================================================
// A LOCAL STORAGE GOOD ENOUGH TO BE WRONG
// ===========================================================================
//
// tests/README.md records an hour lost to a harness stub that implemented only
// getItem/setItem/removeItem: real `Storage` also has `length` and `key(i)`,
// and a module that enumerated keys silently found nothing. So the default stub
// here has all five — and one scenario deliberately takes the last two away
// again, because js/store.js has to keep working in the suites that do not.

function makeStorage({ quota = Infinity, thin = false, broken = false } = {}) {
  const map = new Map();
  const size = () => [...map.values()].reduce((a, v) => a + v.length, 0);
  const api = {
    getItem(k) {
      if (broken) throw new Error('storage is blocked');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      if (broken) throw new Error('storage is blocked');
      const had = map.has(k) ? map.get(k).length : 0;
      if (size() - had + String(v).length > quota) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      map.set(k, String(v));
    },
    removeItem(k) {
      if (broken) throw new Error('storage is blocked');
      map.delete(k);
    },
    clear() { map.clear(); },
  };
  if (!thin) {
    Object.defineProperty(api, 'length', { get() { return map.size; } });
    api.key = (i) => [...map.keys()][i] ?? null;
  }
  return Object.assign(api, { _map: map, _size: size });
}

// ===========================================================================
// THE FIXTURE — a four-team league, raw, so the real decoder runs
// ===========================================================================

const LEAGUE_ID = '5550111';
const OTHER_LEAGUE = '5550222';
const SEASON = 2026;

const TEAMS = [1, 2, 3, 4];

/** One roster payload for a week. Projections move with the week, so a stale
 *  answer and a fresh one are told apart by their numbers and not by a flag. */
function rosterPayload(week, bump = 0, { dst = false, moved = false, dropped = false, points = false } = {}) {
  const payload = rosterPayloadAsDealt(week, bump, { dst, points });
  // THE ROSTER MOVE. `moved`: X (QB 1) is traded to team 2. `dropped`: he is
  // cut and is on nobody's roster. Nothing else about the payload changes.
  if (moved || dropped) {
    const from = payload.teams.find((t) => t.id === 1).roster.entries;
    const at = from.findIndex((e) => e.playerId === X);
    const [entry] = from.splice(at, 1);
    if (moved) payload.teams.find((t) => t.id === 2).roster.entries.push(entry);
  }
  return payload;
}

/** The man who changes hands in the roster-move scenarios: team 1's QB. */
const X = 101;

/** Which team holds `playerId` in a decoded week, or null. */
const ownerOf = (teams, playerId = X) =>
  ((teams || []).find((t) => (t.players || []).some((p) => p.playerId === playerId)) || { id: null }).id;

function rosterPayloadAsDealt(week, bump = 0, { dst = false, points = false } = {}) {
  return {
    teams: TEAMS.map((id) => ({
      id,
      abbrev: `T${id}`,
      location: 'Team',
      nickname: String(id),
      roster: {
        entries: [
          // AUDIT §2.4's own case: a D/ST ESPN projects at 4.41 in every week,
          // its bye included. Team 1's only; its NFL team (30) is off in week 2.
          ...(dst && id === 1 ? [{
            playerId: 9001,
            lineupSlotId: 16,
            playerPoolEntry: {
              player: {
                fullName: 'Bye D/ST', defaultPositionId: 16, proTeamId: DST_PRO_TEAM,
                stats: [
                  { scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 4.41 },
                ],
              },
            },
          }] : []),
          {
            playerId: id * 100 + 1,
            lineupSlotId: 0,
            playerPoolEntry: {
              player: {
                fullName: `QB ${id}`, defaultPositionId: 1, proTeamId: id,
                stats: [
                  { scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 10 + week + bump },
                  ...(points ? [{ scoringPeriodId: week, statSourceId: 0, statSplitTypeId: 1, appliedTotal: 6 + bump }] : []),
                  { seasonId: SEASON, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 200 },
                ],
              },
            },
          },
          {
            playerId: id * 100 + 2,
            lineupSlotId: 2,
            playerPoolEntry: {
              player: {
                fullName: `RB ${id}`, defaultPositionId: 2, proTeamId: id,
                stats: [
                  { scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 8 + bump },
                ],
              },
            },
          },
        ],
      },
    })),
  };
}

const DST_PRO_TEAM = 30;
const DST_BYE = 2;
/** The bye read as ESPN answers it: every fixture NFL team, one bye each. */
/** `kickoffs`: `{ [week]: epochMs }` — every fixture NFL team plays then. */
const byePayload = (kickoffs = null) => ({
  settings: {
    proTeams: [
      ...TEAMS.map((id) => ({
        id, byeWeek: 9,
        ...(kickoffs ? {
          proGamesByScoringPeriod: Object.fromEntries(Object.entries(kickoffs)
            .map(([week, at]) => [week, [{ id: Number(week) * 100 + id, date: at, statsOfficial: false }]])),
        } : {}),
      })),
      { id: DST_PRO_TEAM, byeWeek: DST_BYE },
    ],
  },
});

/** Weeks 1-2 decided, 3-4 not, unless told otherwise. That is what makes a
 *  week "final" or not. */
const schedulePayload = (decidedThrough = 2, weeks = 4) => ({
  settings: {
    name: 'Store League',
    scheduleSettings: { matchupPeriodCount: weeks, playoffTeamCount: 2 },
  },
  teams: TEAMS.map((id) => ({ id, abbrev: `T${id}`, location: 'Team', nickname: String(id) })),
  schedule: Array.from({ length: weeks }, (_, i) => i + 1).flatMap((week) => [
    {
      matchupPeriodId: week, playoffTierType: 'NONE',
      home: { teamId: 1, totalPoints: week <= decidedThrough ? 100 : 0 },
      away: { teamId: 2, totalPoints: week <= decidedThrough ? 90 : 0 },
      winner: week <= decidedThrough ? 'HOME' : 'UNDECIDED',
    },
    {
      matchupPeriodId: week, playoffTierType: 'NONE',
      home: { teamId: 3, totalPoints: week <= decidedThrough ? 80 : 0 },
      away: { teamId: 4, totalPoints: week <= decidedThrough ? 70 : 0 },
      winner: week <= decidedThrough ? 'HOME' : 'UNDECIDED',
    },
  ]),
});

/** ESPN, counted. `bump` shifts every projection so a re-read is visible. */
/** `byes`: 'empty' (the default — an answer with no teams, which is unknown),
 *  'ok' (the real shape), or 'fail' (HTTP 429, what a rate limit looks like).
 *  `decidedThrough`: the last week with a result. `dst`: add the bye D/ST. */
/** `weeks`: how long the season is. `moved` / `dropped`: the roster move (see
 *  `rosterPayload`); a dropped man is on the wire. `points`: every QB has
 *  scored. `kickoffs`: `{week: epochMs}` on the NFL schedule. `schedule:
 *  'fail'`: the league schedule will not answer. */
function installFetch({
  bump = 0, byes = 'empty', decidedThrough = 2, dst = false,
  weeks = 4, moved = false, dropped = false, points = false, kickoffs = null, schedule = 'ok',
} = {}) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    let body;
    if (/proTeamSchedules_wl/.test(u)) {
      if (byes === 'fail') return { ok: false, status: 429, async json() { return {}; } };
      body = byes === 'ok' ? byePayload(kickoffs) : { settings: { proTeams: [] } };
    }
    else if (/kona_player_info/.test(u)) {
      body = { players: dropped ? [{ player: { id: X, fullName: 'QB 1', defaultPositionId: 1, proTeamId: 1, stats: [] } }] : [] };
    }
    else if (/scoringPeriodId=(\d+)/.test(u) && /view=mRoster/.test(u)) {
      body = rosterPayload(Number(u.match(/scoringPeriodId=(\d+)/)[1]), bump, { dst, moved, dropped, points });
    } else if (schedule === 'fail') {
      return { ok: false, status: 500, async json() { return {}; } };
    } else body = schedulePayload(decidedThrough, weeks);
    return { ok: true, status: 200, async json() { return JSON.parse(JSON.stringify(body)); } };
  };
  return calls;
}

const rosterCalls = (calls) => calls.filter((u) => /view=mRoster/.test(u));
const byeCalls = (calls) => calls.filter((u) => /proTeamSchedules_wl/.test(u));

/** Move every stored entry's clock back, as though the browser sat idle.
 *  `only`: just these weeks' roster entries. */
function ageEverything(storage, ms, only = null) {
  for (const k of [...storage._map.keys()]) {
    if (only && !only.some((w) => k.startsWith('ff.weeks.') && k.endsWith(`.${w}`))) continue;
    try {
      const e = JSON.parse(storage._map.get(k));
      if (e && typeof e.at === 'number') {
        e.at -= ms;
        if (typeof e.finalAt === 'number') e.finalAt -= ms;
        storage._map.set(k, JSON.stringify(e));
      }
    } catch { /* not ours */ }
  }
}

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const weeksAsked = (calls) => rosterCalls(calls)
  .map((u) => Number(u.match(/scoringPeriodId=(\d+)/)[1])).sort((a, b) => a - b);

/** The modules, on a fresh storage, with no cloud — what every seam scenario starts from. */
async function boot() {
  const storage = makeStorage();
  globalThis.localStorage = storage;
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '' });
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));
  const store = await import(moduleUrl('js/store.js'));
  espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
  return { storage, espn, season, store };
}

/** A seven-week season with weeks 1-4 decided: week 5 is the CURRENT week. */
const TRADE_SEASON = { weeks: 7, decidedThrough: 4, byes: 'ok' };

const HOUR = 60 * 60 * 1000;

// ===========================================================================
// SCENARIOS
// ===========================================================================

const SCENARIOS = {
  // ---- the module's own rules, with no league and no network at all -------
  async pure() {
    const storage = makeStorage();
    globalThis.localStorage = storage;
    const store = await import(moduleUrl('js/store.js'));

    eq(store.available(), true, 'a working storage is available');
    eq(store.readWeek(LEAGUE_ID, SEASON, 3), null, 'a week never written is absent');

    const teams = [{ id: 1, players: [{ playerId: 11, projected: 9 }] }];
    eq(store.writeWeek(LEAGUE_ID, SEASON, 3, teams), true, 'a week can be written');
    const got = store.readWeek(LEAGUE_ID, SEASON, 3);
    ok('and read back', got && got.teams.length === 1, JSON.stringify(got));
    eq(got.final, false, 'an unplayed week is not final');
    ok('and carries an age, so a page can SAY how old it is', got.ageMs >= 0 && got.ageMs < 5000,
      String(got.ageMs));

    // THE TWO CLOCKS.
    store.writeWeek(LEAGUE_ID, SEASON, 1, teams, { final: true });
    ageEverything(storage, 7 * HOUR);
    ok('a FORECAST goes stale after six hours', store.readWeek(LEAGUE_ID, SEASON, 3) === null);
    ok('a PLAYED week does not — it can never change again',
      !!store.readWeek(LEAGUE_ID, SEASON, 1));
    ageEverything(storage, 30 * 24 * HOUR);
    ok('not after a month either', !!store.readWeek(LEAGUE_ID, SEASON, 1));

    // KEYED BY LEAGUE **AND** SEASON AND WEEK. Team ids collide across
    // leagues, so one league being served another's squads would look entirely
    // plausible and be wrong about every number downstream.
    store.writeWeek(LEAGUE_ID, SEASON, 2, [{ id: 1, players: [{ playerId: 1, n: 'mine' }] }]);
    store.writeWeek(OTHER_LEAGUE, SEASON, 2, [{ id: 1, players: [{ playerId: 1, n: 'theirs' }] }]);
    store.writeWeek(LEAGUE_ID, 2025, 2, [{ id: 1, players: [{ playerId: 1, n: 'lastyear' }] }]);
    eq(store.readWeek(LEAGUE_ID, SEASON, 2).teams[0].players[0].n, 'mine', 'this league');
    eq(store.readWeek(OTHER_LEAGUE, SEASON, 2).teams[0].players[0].n, 'theirs', 'not that one');
    eq(store.readWeek(LEAGUE_ID, 2025, 2).teams[0].players[0].n, 'lastyear', 'nor last season');

    // LISTING, which is what lets a page print an age.
    const list = store.list(LEAGUE_ID, SEASON);
    eq(list.map((e) => e.week), [1, 2, 3], 'the listing is this league only, week first');
    ok('and says which are final', list.find((e) => e.week === 1).final === true &&
      list.find((e) => e.week === 2).final === false);
    eq(store.list(OTHER_LEAGUE, SEASON).length, 1, 'and another league lists its own');

    // FORGET — the force-a-fresh-read half of his ask.
    const gone = store.forget(LEAGUE_ID, SEASON);
    eq(gone, 3, 'forgetting takes every week of that league-season');
    eq(store.list(LEAGUE_ID, SEASON).length, 0, 'and it is empty afterwards');
    eq(store.list(OTHER_LEAGUE, SEASON).length, 1, 'another league is untouched');
    ok('and the PLAYED weeks go too — a refresh that kept two thirds is worse ' +
      'than none', store.readWeek(LEAGUE_ID, SEASON, 1) === null);

    // Ages, in the one spelling the site uses.
    eq(store.describeAge(0), 'just now', 'nothing is just now');
    eq(store.describeAge(5 * 60000), '5 minutes ago', 'minutes');
    eq(store.describeAge(3 * HOUR), '3 hours ago', 'hours');
    eq(store.describeAge(-1), 'unknown', 'and a nonsense age is unknown rather than a number');
  },

  // ---- storage that is absent, broken, or thin ---------------------------
  async hostile() {
    globalThis.localStorage = undefined;
    const store = await import(moduleUrl('js/store.js'));
    eq(store.available(), false, 'no storage at all is not available');
    eq(store.readWeek(LEAGUE_ID, SEASON, 1), null, 'and reading is null rather than a throw');
    eq(store.writeWeek(LEAGUE_ID, SEASON, 1, [{ id: 1 }]), false, 'writing says so and does not throw');
    eq(store.list(LEAGUE_ID, SEASON), [], 'listing is empty');
    eq(store.forget(LEAGUE_ID, SEASON), 0, 'and forgetting is a no-op');

    // A browser that exposes the object and throws on use — a private window.
    globalThis.localStorage = makeStorage({ broken: true });
    eq(store.available(), false, 'storage that throws on use is not available either');
    eq(store.writeWeek(LEAGUE_ID, SEASON, 1, [{ id: 1 }]), false, 'and nothing it is asked to do throws');

    // A HARNESS STUB WITH NO `length`/`key` — which is what every other suite
    // on this project hands the page. Reading and writing must still work;
    // only enumeration is lost.
    const thin = makeStorage({ thin: true });
    globalThis.localStorage = thin;
    eq(store.available(), true, 'a four-method stub still probes as available');
    eq(store.writeWeek(LEAGUE_ID, SEASON, 5, [{ id: 1, players: [] }]), true,
      'and a week can still be written to it');
    ok('and read back', !!store.readWeek(LEAGUE_ID, SEASON, 5));
    eq(store.list(LEAGUE_ID, SEASON), [],
      'only the LISTING is empty, because nothing can enumerate the keys');
  },

  // ---- a full browser evicts rather than throwing -------------------------
  async quota() {
    // Big enough for a few weeks and not for many.
    const storage = makeStorage({ quota: 20000 });
    globalThis.localStorage = storage;
    const store = await import(moduleUrl('js/store.js'));

    const bulky = (tag) => [{
      id: 1,
      players: Array.from({ length: 40 }, (_, i) => ({ playerId: i, name: `${tag}-${i}`.padEnd(40, 'x') })),
    }];

    // Somebody else's league first, and an old played week of ours.
    store.writeWeek(OTHER_LEAGUE, SEASON, 1, bulky('other'));
    store.writeWeek(LEAGUE_ID, SEASON, 1, bulky('mine1'), { final: true });
    ageEverything(storage, 2 * HOUR);

    let wrote = 0;
    for (let w = 2; w <= 12; w++) {
      if (store.writeWeek(LEAGUE_ID, SEASON, w, bulky(`mine${w}`))) wrote++;
    }
    ok('a full browser keeps taking writes rather than throwing', wrote >= 5, `${wrote} of 11`);
    ok('and stays inside its quota', storage._size() <= 20000, String(storage._size()));

    // THE EVICTION ORDER: another league's weeks go before ours, and a PLAYED
    // week of ours goes last — it is the only thing in here that can never be
    // cheaply re-derived later in the season, and the only thing that is never
    // wrong.
    const mine = store.list(LEAGUE_ID, SEASON);
    ok('our own weeks are what is left', mine.length >= 4, JSON.stringify(mine.map((e) => e.week)));
    eq(store.list(OTHER_LEAGUE, SEASON).length, 0,
      'and the other league is what went first');

    // Nothing unreadable was left behind.
    for (const e of mine) {
      ok(`week ${e.week} is still readable`, !!store.readWeek(LEAGUE_ID, SEASON, e.week));
    }
  },

  // =========================================================================
  // THE SEAM — js/season.js really uses it
  // =========================================================================
  //
  // This is the half that matters. A store nobody wires up changes nothing and
  // every existing suite would still be green.
  async seam() {
    const storage = makeStorage();
    globalThis.localStorage = storage;
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '' });            // no cloud at all
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(moduleUrl('js/season.js'));
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });

    // The schedule first: that is what tells the store which weeks are banked.
    let calls = installFetch();
    const sched = await season.fetchSchedule();
    eq(sched.weeks, [1, 2, 3, 4], 'the fixture is a four-week season');
    eq(sched.games.filter((g) => g.played).map((g) => g.week), [1, 1, 2, 2],
      'weeks 1 and 2 have results; 3 and 4 do not');

    // A cold read: one request, and it lands in the store.
    const w3 = await season.fetchWeekRosters(3);
    eq(rosterCalls(calls).length, 1, 'a week nobody holds costs one request');
    eq(w3.from, 'espn', 'and says where it came from');
    eq(w3.teams.length, 4, 'four squads decoded');

    // THE NAVIGATION. espn.js has a 60-second shared read of its own, so that
    // is cleared first — otherwise this would prove espn.js's cache and not
    // this one. This is the whole feature: a new PAGE means new module state
    // and an empty in-memory cache, and the week has to come back anyway.
    espn.clearReadCache();
    calls = installFetch({ bump: 99 });
    const again = await season.fetchWeekRosters(3);
    eq(rosterCalls(calls).length, 0, 'the same week on the next page costs NOTHING');
    eq(again.from, 'store', 'and says it came from this browser');
    eq(again.teams[0].players[0].projected, w3.teams[0].players[0].projected,
      'with the numbers it was stored with, not the bumped ones ESPN now has');

    // A PLAYED WEEK IS FINAL, an unplayed one is not — read off the schedule
    // and never off the date.
    await season.fetchWeekRosters(1);
    const listed = season.storedWeeks();
    const byWeek = new Map(listed.map((e) => [e.week, e]));
    eq(byWeek.get(1).final, true, 'week 1 has a result, so it is kept for the season');
    eq(byWeek.get(3).final, false, 'week 3 has none, so it is a forecast on a clock');

    // Seven hours on: the forecast is re-read and the result is not.
    ageEverything(storage, 7 * HOUR);
    espn.clearReadCache();
    calls = installFetch({ bump: 5 });
    const stale = await season.fetchWeekRosters(3);
    eq(rosterCalls(calls).length, 1, 'a six-hour-old FORECAST is bought again');
    eq(stale.teams[0].players[0].projected, w3.teams[0].players[0].projected + 5,
      'and the page gets ESPN’s new number, not the kept one');
    const kept = await season.fetchWeekRosters(1);
    eq(rosterCalls(calls).length, 1, 'while a played week is not — it cannot have changed');
    eq(kept.from, 'store', 'and still comes out of this browser');

    // fetchWeeksRosters reports the source per week, which is how the Trade
    // page's cost line can say "one request" having read four weeks.
    espn.clearReadCache();
    calls = installFetch();
    const sources = [];
    await season.fetchWeeksRosters([1, 2, 3, 4], {
      onProgress: (done, total, week, from) => sources.push([week, from]),
    });
    const bySrc = new Map(sources);
    eq(bySrc.get(1), 'store', 'week 1 was already held');
    eq(bySrc.get(3), 'store', 'and so was week 3');
    eq(bySrc.get(2), 'espn', 'week 2 had never been read');
    eq(rosterCalls(calls).length, 2, 'so only the two unheld weeks cost anything');

    // FORCING A FRESH READ.
    espn.clearReadCache();
    calls = installFetch({ bump: 7 });
    const forced = await season.fetchWeekRosters(1, { fresh: true });
    eq(rosterCalls(calls).length, 1, '`fresh` ignores the store, played week or not');
    eq(forced.teams[0].players[0].projected, 10 + 1 + 7,
      'and the page gets what ESPN says now');
    const after = await season.fetchWeekRosters(1);
    eq(after.teams[0].players[0].projected, 10 + 1 + 7,
      'and what it got is written over the top, so the next page agrees with it');

    // forgetStored: the same thing without the request.
    season.forgetStored();
    eq(season.storedWeeks().length, 0, 'forgetStored empties this league’s weeks');

    // DEMO IS NEVER STORED. The sample season is generated inside the page and
    // costs nothing; writing it would put a fake league's squads one key away
    // from a real one's.
    espn.configure({ leagueId: 'demo' });
    eq(season.storedWeeks(), [], 'a league that is not a number stores nothing');
    espn.configure({ leagueId: LEAGUE_ID });
  },

  // =========================================================================
  // A ROSTER MOVE REACHES EVERY WEEK
  // =========================================================================
  //
  // Tim, 2026-10-08: "I recently made a trade and the players officially
  // switched, however, there are some parts of the cite that are clearly not
  // caught up, even though the top bar says it's synced."
  //
  // Every remaining week's stored copy kept the old teams for up to six hours,
  // each expiring on its own, and Sync now read none of them again.

  // ---- Sync now really re-reads --------------------------------------------
  async syncNow() {
    const { storage, season } = await boot();
    // What must never be dropped by a Sync: readings, saved projections, moves.
    const KEEP = {
      [`ff.snapshots.${LEAGUE_ID}.${SEASON}`]: '{"keep":1}',
      [`ff.projhist.1.${LEAGUE_ID}.${SEASON}.4`]: '{"keep":2}',
      [`ff.decisions.1.${LEAGUE_ID}.${SEASON}.4`]: '{"v":1,"at":1,"moves":[],"players":{}}',
    };
    for (const [k, v] of Object.entries(KEEP)) storage.setItem(k, v);

    let calls = installFetch(TRADE_SEASON);
    await season.fetchSchedule();
    let got = await season.fetchWeeksRosters([4, 5, 6, 7]);
    eq(rosterCalls(calls).length, 4, 'a cold load buys its four weeks');
    eq([4, 5, 6, 7].map((w) => ownerOf(got.get(w))), [1, 1, 1, 1], 'X is on team 1 in every week');

    // THE TRADE, and the press — seconds after the load, so js/espn.js's own
    // minute-long shared reads are still warm. Sync has to clear those too.
    calls = installFetch({ ...TRADE_SEASON, moved: true });
    ok('season.js has a Sync-now entry point', typeof season.forgetOpen === 'function');
    if (typeof season.forgetOpen === 'function') season.forgetOpen();
    await season.fetchSchedule();
    got = await season.fetchWeeksRosters([4, 5, 6, 7]);
    eq(ownerOf(got.get(6)), 2, 'after Sync now, X is on team 2 in week 6');
    eq([5, 7].map((w) => ownerOf(got.get(w))), [2, 2], 'and in weeks 5 and 7');
    eq(weeksAsked(calls), [5, 6, 7], 'the three open weeks were read again — and the FINAL week was not');
    eq(ownerOf(got.get(4)), 1, 'week 4 is history: X played it for team 1');
    const held = new Map(season.storedWeeks().map((e) => [e.week, e]));
    eq(held.get(4) && held.get(4).final, true, 'and week 4 is still held, final');
    for (const [k, v] of Object.entries(KEEP)) eq(storage.getItem(k), v, `${k.split('.')[1]} is untouched by a Sync`);
  },

  // ---- the automatic catch-up: nothing pressed -----------------------------
  async autoCatchUp() {
    const { storage, espn, season } = await boot();
    let calls = installFetch(TRADE_SEASON);
    await season.fetchSchedule();
    let got = await season.fetchWeeksRosters([4, 5, 6, 7]);
    eq([5, 6, 7].map((w) => ownerOf(got.get(w))), [1, 1, 1], 'X starts on team 1');

    // SIX MINUTES ON, NOTHING HAS MOVED: the current week alone is read again.
    ageEverything(storage, 6 * MINUTE);
    espn.clearReadCache();
    calls = installFetch({ ...TRADE_SEASON, bump: 1 });
    const sources = [];
    got = await season.fetchWeeksRosters([4, 5, 6, 7], { onProgress: (d, t, week, from) => sources.push([week, from]) });
    eq(weeksAsked(calls), [5], 'the CURRENT week is on the five-minute clock: one request, week 5');
    eq(new Map(sources).get(6), 'store', 'a later week with nothing changed still comes from the store');
    eq(new Map(sources).get(4), 'store', 'and so does the final week');

    // THE TRADE. Only the current week's five minutes lapse — weeks 6 and 7
    // are minutes old and would be served for another six hours.
    ageEverything(storage, 6 * MINUTE, [5]);
    espn.clearReadCache();
    calls = installFetch({ ...TRADE_SEASON, moved: true });
    got = await season.fetchWeeksRosters([4, 5, 6, 7]);
    eq(ownerOf(got.get(5)), 2, 'the current week shows the trade');
    eq(ownerOf(got.get(6)), 2, 'and week 6 FOLLOWS, with nothing pressed');
    eq(ownerOf(got.get(7)), 2, 'and week 7');
    eq(weeksAsked(calls), [5, 6, 7], 'one request per remaining week, and none for the final one');
    eq(ownerOf(got.get(4)), 1, 'week 4 is still history');
    eq(season.storedWeeks().find((e) => e.week === 4).final, true, 'and still held, final');

    // And it is settled: the next page costs nothing.
    espn.clearReadCache();
    calls = installFetch({ ...TRADE_SEASON, moved: true, bump: 5 });
    got = await season.fetchWeeksRosters([4, 5, 6, 7]);
    eq(rosterCalls(calls).length, 0, 'the page after that buys nothing');
    eq(ownerOf(got.get(7)), 2, 'and still shows the trade');
  },

  // ---- one LATER week asked for alone (the Trade page's selected week) ------
  async autoCatchUpOneWeek() {
    const { storage, espn, season } = await boot();
    let calls = installFetch(TRADE_SEASON);
    await season.fetchSchedule();
    await season.fetchWeeksRosters([5, 6, 7]);

    ageEverything(storage, 6 * MINUTE, [5]);
    espn.clearReadCache();
    calls = installFetch({ ...TRADE_SEASON, moved: true });
    const w7 = await season.fetchWeekRosters(7);
    eq(ownerOf(w7.teams), 2, 'week 7 read alone still learns of the trade from the current week');
    eq(weeksAsked(calls), [5, 7], 'at the cost of the current week’s read and its own');
  },

  // ---- D: the wire says a man is free whom the stored rosters still own ----
  async wireDisagrees() {
    const { season } = await boot();
    let calls = installFetch(TRADE_SEASON);
    await season.fetchSchedule();
    let got = await season.fetchWeeksRosters([4, 5, 6, 7]);
    eq(ownerOf(got.get(5)), 1, 'X is on team 1');

    // He is cut. Seconds later the Players page reads the wire: it lists him
    // free, while every stored week (seconds old) still has him on team 1.
    calls = installFetch({ ...TRADE_SEASON, dropped: true });
    const wire = await season.fetchWireWeek(5);
    ok('the wire lists X', wire.some((p) => p.playerId === X), JSON.stringify(wire.map((p) => p.playerId)));
    got = await season.fetchWeeksRosters([4, 5, 6, 7]);
    eq([5, 6, 7].map((w) => ownerOf(got.get(w))), [null, null, null],
      'so the rosters are read again: he is on nobody’s team, not on the wire AND a roster');
    eq(weeksAsked(calls), [5, 6, 7], 'three open weeks, three requests; the final week untouched');
    eq(ownerOf(got.get(4)), 1, 'week 4 is history');
  },

  // ---- C: a week under way, held, on a page that has no NFL schedule yet ----
  async weekInPlayLate() {
    const { espn, season, store } = await boot();
    // The league schedule will not answer, so nothing says which week is the
    // current one — the week-in-play rule is all there is.
    const kickoffs = { 3: Date.now() - 2 * HOUR };
    // The week as ESPN decodes it, got under ANOTHER season so that this
    // process holds no NFL schedule for the season under test — which is the
    // state of a page that has just been opened.
    espn.configure({ season: SEASON - 1 });
    installFetch({ byes: 'ok', kickoffs, points: true, schedule: 'fail' });
    const decoded = (await season.fetchWeekRosters(3, { raw: true })).teams;
    espn.configure({ season: SEASON });
    eq(espn.heldProGames(), null, 'no NFL schedule has been read for this season');
    store.writeWeek(LEAGUE_ID, SEASON, 3, decoded, { final: false, byesKnown: true, at: Date.now() - 10 * MINUTE });

    espn.clearReadCache();
    const calls = installFetch({ byes: 'ok', kickoffs, points: true, bump: 4, schedule: 'fail' });
    const again = await season.fetchWeekRosters(3);
    eq(rosterCalls(calls).length, 1, 'a week with points on it waits for the NFL schedule, then is re-read');
    eq(again.from, 'espn', 'so ten-minute-old live points are not served as now');
    ok('with what ESPN says now',
      again.teams[0].players.some((p) => p.actual === 6 + 4), JSON.stringify(again.teams[0].players.map((p) => p.actual)));

    // A FORECAST — nobody has a point — never asks for the NFL schedule.
    espn.configure({ season: SEASON - 1 });
    installFetch({ byes: 'ok', schedule: 'fail' });
    const ahead = (await season.fetchWeekRosters(4, { raw: true })).teams;
    espn.configure({ season: SEASON + 1 });
    store.writeWeek(LEAGUE_ID, SEASON + 1, 4, ahead, { final: false, byesKnown: true, at: Date.now() - 10 * MINUTE });
    espn.clearReadCache();
    const quiet = installFetch({ byes: 'ok', kickoffs, schedule: 'fail' });
    eq((await season.fetchWeekRosters(4)).from, 'store', 'a week nobody has scored in is served as held');
    eq(quiet.length, 0, 'at no request of any kind');
  },

  // ---- F: a played week is checked ONCE for stat corrections ---------------
  async finalRecheck() {
    const { storage, espn, season } = await boot();
    let calls = installFetch({ byes: 'ok' });
    await season.fetchSchedule();
    const first = await season.fetchWeekRosters(1);
    eq(season.storedWeeks().find((e) => e.week === 1).final, true, 'week 1 is stored final');

    ageEverything(storage, 2 * DAY);
    espn.clearReadCache();
    calls = installFetch({ byes: 'ok', bump: 2 });
    eq((await season.fetchWeekRosters(1)).from, 'store', 'two days on it is served as held');
    eq(rosterCalls(calls).length, 0, 'at no cost');

    ageEverything(storage, 2 * DAY);
    espn.clearReadCache();
    calls = installFetch({ byes: 'ok', bump: 3 });
    const checked = await season.fetchWeekRosters(1);
    eq(rosterCalls(calls).length, 1, 'three days after it was stored final, it is read ONCE more');
    eq(checked.teams[0].players[0].projected, first.teams[0].players[0].projected + 3,
      'and a corrected number arrives');
    eq(season.storedWeeks().find((e) => e.week === 1).final, true, 'still final');

    ageEverything(storage, 30 * DAY);
    espn.clearReadCache();
    calls = installFetch({ byes: 'ok', bump: 9 });
    const later = await season.fetchWeekRosters(1);
    eq(rosterCalls(calls).length, 0, 'and never again: a month on, no request');
    eq(later.teams[0].players[0].projected, first.teams[0].players[0].projected + 3, 'the checked copy is kept');

    // A check that FAILS keeps the held week.
    await season.fetchWeekRosters(2);
    ageEverything(storage, 4 * DAY, [2]);
    espn.clearReadCache();
    calls = installFetch({ byes: 'ok' });
    const inner = globalThis.fetch;
    globalThis.fetch = async (url) => (/view=mRoster/.test(String(url))
      ? { ok: false, status: 429, async json() { return {}; } }
      : inner(url));
    const kept = await season.fetchWeekRosters(2);
    eq(kept.from, 'store', 'a refused check serves the held week');
    eq(kept.teams.length, 4, 'whole');
  },

  // ---- AUDIT §2.5: a forecast for a week that has since been decided ------
  //
  // Read week 3 before kickoff (stored final:false, six hours on the clock),
  // then ESPN puts a result against it, then another page asks for it. The
  // pre-kickoff lineups must not come back as the week's history.
  async decidedSince() {
    const storage = makeStorage();
    globalThis.localStorage = storage;
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '' });
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(moduleUrl('js/season.js'));
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });

    let calls = installFetch({ byes: 'ok' });
    await season.fetchSchedule();
    const before = await season.fetchWeekRosters(3);
    eq(before.from, 'espn', 'week 3 read before kickoff');
    eq(season.storedWeeks().find((e) => e.week === 3).final, false, 'and stored as a forecast');

    // An hour later — well inside the six hours — week 3 has a result.
    ageEverything(storage, 1 * HOUR);
    espn.clearReadCache();
    calls = installFetch({ byes: 'ok', decidedThrough: 3, bump: 3 });
    const sched = await season.fetchSchedule();
    ok('the schedule now has week 3 decided',
      sched.games.filter((g) => g.week === 3).every((g) => g.played));
    espn.clearReadCache();
    calls = installFetch({ byes: 'ok', decidedThrough: 3, bump: 3 });
    const after = await season.fetchWeekRosters(3);
    eq(rosterCalls(calls).length, 1, 'the held forecast is refused: one re-read');
    eq(after.from, 'espn', 'and the answer came from ESPN, not this browser');
    eq(after.teams[0].players[0].projected, before.teams[0].players[0].projected + 3,
      'with what ESPN says now');
    const listed = season.storedWeeks().find((e) => e.week === 3);
    eq(listed.final, true, 'and the re-read is stored FINAL');

    // Final means kept: two days on, no request at all. (Three days on it is
    // checked once for stat corrections — the `finalRecheck` scenario.)
    ageEverything(storage, 2 * 24 * HOUR);
    espn.clearReadCache();
    calls = installFetch({ byes: 'ok', decidedThrough: 3, bump: 50 });
    const later = await season.fetchWeekRosters(3);
    eq(rosterCalls(calls).length, 0, 'after that it is kept');
    eq(later.from, 'store', 'out of this browser');

    // A forecast for a week STILL undecided is untouched by this.
    await season.fetchWeekRosters(4);
    espn.clearReadCache();
    calls = installFetch({ byes: 'ok', decidedThrough: 3, bump: 60 });
    const w4 = await season.fetchWeekRosters(4);
    eq(rosterCalls(calls).length, 0, 'an undecided week inside its six hours still costs nothing');
    eq(w4.from, 'store', 'and still comes from the store');
  },

  // ---- AUDIT §2.4: a failed bye read, and the read that later works -------
  async byesFailed() {
    const storage = makeStorage();
    globalThis.localStorage = storage;
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '' });
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(moduleUrl('js/season.js'));
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
    const dstOf = (teams) => teams.find((t) => t.id === 1).players.find((p) => p.playerId === 9001);

    // PAGE 1: the bye read is rate-limited. Week 2 is the D/ST's bye AND a
    // played week — the "frozen for the season" case.
    let calls = installFetch({ byes: 'fail', dst: true });
    await season.fetchSchedule();
    let got = await season.fetchWeeksRosters([2, 3, 4]);
    eq(rosterCalls(calls).length, 3, 'three weeks, three requests');
    eq(dstOf(got.get(2)).projected, 4.41,
      'with the byes unknown the D/ST keeps ESPN’s number (rule 2: nothing invented)');
    let held = new Map(season.storedWeeks().map((e) => [e.week, e]));
    eq(held.get(2).final, true, 'week 2 is played, so it is stored final');
    eq([2, 3, 4].map((w) => held.get(w).byesKnown), [false, false, false],
      'and every week is stored saying the byes were UNKNOWN');

    // PAGE 2: still failing. A re-read would buy the same bye-less answer, so
    // the held weeks are served and nothing is re-bought.
    espn.clearReadCache();
    calls = installFetch({ byes: 'fail', dst: true, bump: 1 });
    const sources = [];
    got = await season.fetchWeeksRosters([2, 3, 4], {
      onProgress: (d, t, week, from) => sources.push(from),
    });
    eq(rosterCalls(calls).length, 0, 'while the byes still fail, no week is re-bought');
    eq(sources, ['store', 'store', 'store'], 'all three come from the store');

    // PAGE 3: the byes work. Every byes-unknown week is bought ONCE, and the
    // bye rule now applies — to the played week too.
    espn.clearReadCache();
    calls = installFetch({ byes: 'ok', dst: true });
    got = await season.fetchWeeksRosters([2, 3, 4]);
    eq(rosterCalls(calls).length, 3, 'the byes arrived: each byes-unknown week re-read once');
    eq(dstOf(got.get(2)).projected, 0, 'and the D/ST is 0 in its bye week');
    eq(dstOf(got.get(3)).projected, 4.41, 'and keeps its number outside it');
    held = new Map(season.storedWeeks().map((e) => [e.week, e]));
    eq([2, 3, 4].map((w) => held.get(w).byesKnown), [true, true, true],
      'and every week is now stored with the byes known');
    eq(held.get(2).final, true, 'week 2 still final');

    // PAGE 4 — RULE 3: with the byes fine, a page load buys no roster week
    // again. The bye read itself is one request per load (cached for the page).
    espn.clearReadCache();
    calls = installFetch({ byes: 'ok', dst: true, bump: 9 });
    got = await season.fetchWeeksRosters([2, 3, 4]);
    eq(rosterCalls(calls).length, 0, 'byes fine: zero roster requests on the next load');
    ok('and at most one bye request', byeCalls(calls).length <= 1, String(byeCalls(calls).length));
    eq(dstOf(got.get(2)).projected, 0, 'the stored week keeps the bye');
    const single = await season.fetchWeekRosters(3);
    eq(single.from, 'store', 'a single-week read is served from the store too');
    eq(rosterCalls(calls).length, 0, 'still no roster request');
  },

  // ---- a byes-unknown week whose re-read fails is still served ------------
  async byesArrivedReadFails() {
    const storage = makeStorage();
    globalThis.localStorage = storage;
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '' });
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(moduleUrl('js/season.js'));
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });

    installFetch({ byes: 'fail', dst: true });
    await season.fetchSchedule();
    await season.fetchWeekRosters(2);
    espn.clearReadCache();
    // The byes answer now; the roster read does not.
    const calls = installFetch({ byes: 'ok', dst: true });
    const inner = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (/view=mRoster/.test(String(url))) { calls.push(String(url)); return { ok: false, status: 429, async json() { return {}; } }; }
      return inner(url);
    };
    let got = null;
    let threw = null;
    try { got = await season.fetchWeekRosters(2); } catch (e) { threw = e; }
    ok('a failed re-read does not turn a held week into a gap', !threw && got && got.teams.length === 4,
      threw ? threw.message : '');
    eq(got && got.from, 'store', 'it serves what it held');
    eq(season.storedWeeks().find((e) => e.week === 2).byesKnown, false,
      'and the week stays marked byes-unknown, so the next load tries again');
  },

  // ---- an entry written before `byesKnown` existed -----------------------
  async oldEntry() {
    const storage = makeStorage();
    globalThis.localStorage = storage;
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '' });
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(moduleUrl('js/season.js'));
    const store = await import(moduleUrl('js/store.js'));
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });

    // Exactly the shape store.js wrote before this field: v, at, final, teams.
    const oldTeams = [{ id: 1, name: 'Old', players: [{ playerId: 101, projected: 7, proTeamId: 1 }],
      starters: [], bench: [], projectedTotal: 7 }];
    storage.setItem(`ff.weeks.1.${LEAGUE_ID}.${SEASON}.1`,
      JSON.stringify({ v: 1, at: Date.now(), final: true, teams: oldTeams }));

    const raw = store.readWeek(LEAGUE_ID, SEASON, 1);
    ok('an old entry still reads', !!raw && raw.teams[0].name === 'Old', JSON.stringify(raw));
    eq(raw && raw.final, true, 'as final');
    eq(raw && raw.byesKnown, false, 'and with its byes treated as unknown');
    eq(store.list(LEAGUE_ID, SEASON).length, 1, 'and it lists');

    // With the byes failing, it is served exactly as before this change.
    let calls = installFetch({ byes: 'fail' });
    await season.fetchSchedule();
    espn.clearReadCache();
    calls = installFetch({ byes: 'fail' });
    const a = await season.fetchWeekRosters(1);
    eq(a.from, 'store', 'byes failing: the old entry is served from the store');
    eq(a.teams[0].name, 'Old', 'unchanged');
    eq(rosterCalls(calls).length, 0, 'at no roster cost');

    // With the byes working it is refreshed ONCE, then served from the store.
    espn.clearReadCache();
    calls = installFetch({ byes: 'ok' });
    const b = await season.fetchWeekRosters(1);
    eq(rosterCalls(calls).length, 1, 'byes working: the old entry is re-read once');
    eq(b.from, 'espn', 'from ESPN');
    espn.clearReadCache();
    calls = installFetch({ byes: 'ok', bump: 4 });
    const c = await season.fetchWeekRosters(1);
    eq(rosterCalls(calls).length, 0, 'and never again');
    eq(c.from, 'store', 'it is served from the store');
    eq(season.storedWeeks().find((e) => e.week === 1).byesKnown, true, 'now marked byes-known');
  },

  // ---- with no storage at all, every fetcher behaves exactly as before ----
  async seamWithoutStorage() {
    globalThis.localStorage = undefined;
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '' });
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(moduleUrl('js/season.js'));
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });

    let calls = installFetch();
    await season.fetchSchedule();
    const a = await season.fetchWeekRosters(3);
    espn.clearReadCache();
    calls = installFetch();
    const b = await season.fetchWeekRosters(3);
    eq(rosterCalls(calls).length, 1, 'with no storage a week is bought every time, as it always was');
    eq(a.teams.length, b.teams.length, 'and the answer is identical');
    eq(a.teams[0].players[0].projected, b.teams[0].players[0].projected, 'number for number');
    eq(season.storedWeeks(), [], 'and nothing claims to be held');
    // THE GUARANTEE: a storage failure may never stop a page rendering.
    ok('forgetStored is a no-op rather than a throw', (() => {
      try { season.forgetStored(); return true; } catch { return false; }
    })());
  },
};

// ------------------------------------------------------------- child runner

const self = fileURLToPath(import.meta.url);

if (process.argv[2]) {
  const name = process.argv[2];
  if (!SCENARIOS[name]) {
    console.log(`unknown scenario ${name}`);
    process.exit(2);
  }
  await SCENARIOS[name]();
  console.log(JSON.stringify({ pass, fails }));
  process.exit(0);
}

let total = 0;
const allFails = [];
for (const name of Object.keys(SCENARIOS)) {
  // One child each: an ES module initialises once per process, and these
  // scenarios deliberately hand js/store.js different storages.
  const res = spawnSync(process.execPath, [self, name], { encoding: 'utf8' });
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch { /* fall through */ }
  if (!parsed) {
    allFails.push(`${name}: no result\n${res.stdout}\n${res.stderr}`);
    continue;
  }
  total += parsed.pass;
  allFails.push(...parsed.fails.map((f) => `${name}: ${f}`));
}

if (allFails.length) {
  for (const f of allFails.slice(0, 25)) console.log('FAIL ' + f);
  if (allFails.length > 25) console.log(`… and ${allFails.length - 25} more`);
}
console.log(`${total} passed, ${allFails.length} failed across ${Object.keys(SCENARIOS).length} scenarios`);
process.exit(allFails.length ? 1 : 0);
