// The phone bridge, WIRED IN: js/season.js's substitution and the bar above it.
//
//   node test-cloud-wiring.mjs            all scenarios
//   node test-cloud-wiring.mjs substitute just that one
//
// `tests/test-cloud.mjs` proves that what goes up comes back down unchanged.
// This suite proves the other half, which is the half that can silently not
// happen: that a phone with no extension actually GETS it, that a desktop with
// one is untouched, and that a site with no Firebase project configured — which
// is the state the repo ships in — behaves exactly as it did before any of this
// existed.
//
// Three things shape how it is written.
//
// 1. EVERY SCENARIO IS ITS OWN CHILD PROCESS. An ES module initialises once per
//    process, and this suite deliberately puts the same modules into opposite
//    states: js/bridge.js decides whether there is a browser to listen to at
//    import time, and js/cloud.js holds one injected transport. Two scenarios
//    in one process would be two scenarios watching each other's globals. Every
//    page suite here already fans out this way for the same reason.
//
// 2. THE BRIDGE IS SIMULATED AT ITS OWN SEAM, not stubbed away. `js/bridge.js`
//    talks to the extension by `window.postMessage` and believes in it when a
//    HELLO arrives, so the fake below is a window that answers. That means
//    `bridge.isAvailable()`, `espn.leagueRead()`'s routing and season.js's
//    "prefer the extension" test are all the real code, and the only fiction is
//    the extension itself.
//
// 3. THE TWO SOURCES CARRY DIFFERENT NUMBERS. Cloud squads are projected on a
//    10.x scale and live ones on a 50.x scale, and the two leagues have
//    different names. So "it served the cloud" is a claim about which numbers
//    reached the page, not about which function was called — a test that only
//    counted calls would pass just as happily against a substitution that
//    fetched the right thing and then drew the wrong one.

import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO, moduleUrl, repoFile } from './repo.mjs';

// =========================================================================
// SCORING
// =========================================================================

const results = [];
let pass = 0;
const fails = [];

const ok = (msg, cond, extra = '') => {
  if (cond) { pass++; results.push(`   ok ${msg}`); }
  else { fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`); results.push(`   FAIL ${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, msg) => ok(msg, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const near = (a, b, msg, tol = 0.05) =>
  ok(msg, typeof a === 'number' && Math.abs(a - b) <= tol, `got ${a}, want ~${b}`);

// =========================================================================
// THE FIXTURE
// =========================================================================
//
// Small on purpose — four teams, three weeks — because what is being tested is
// which SOURCE the numbers came from, and nothing here is about size. The
// shapes are exact: the roster payloads below are fed through the REAL
// `season.fetchWeekRosters`, so what gets synced is literally what the site
// would have synced rather than a hand-written approximation of it. A
// hand-written one is how a suite ends up asserting that the test file agrees
// with itself.

const TEAMS = [
  { id: 1, name: 'Tim', teamName: 'The Aardvarks', abbrev: 'AAR' },
  { id: 2, name: 'Ben', teamName: 'Benned For Life', abbrev: 'BEN' },
  { id: 3, name: 'Cal', teamName: 'Calamity', abbrev: 'CAL' },
  { id: 4, name: 'Dee', teamName: 'Deep Threats', abbrev: 'DEE' },
];
const WEEKS = [1, 2, 3];
const PLAYED_THROUGH = 2;      // weeks 1 and 2 have scores; week 3 has not

// Nine starters then six on the bench, which is the shape every page assumes.
const SLOTS = [0, 2, 2, 4, 4, 6, 23, 16, 17, 20, 20, 20, 20, 20, 20];
const POS = [1, 2, 2, 3, 3, 4, 2, 16, 5, 2, 3, 1, 4, 3, 2];  // ESPN position ids

/**
 * One ESPN league payload with rosters, at whichever scale is asked for.
 *
 * `scale` is the whole trick: 10 for the copy that gets synced, 50 for the copy
 * ESPN is serving live. Any number the pages show can then be traced to one
 * source or the other without asking the code which path it took.
 */
function rosterPayload(week, scale, leagueName) {
  return {
    settings: { name: leagueName, size: TEAMS.length, rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1, 20: 6 } } },
    status: { currentMatchupPeriod: week },
    members: [],
    teams: TEAMS.map((t) => ({
      id: t.id,
      name: t.teamName,
      abbrev: t.abbrev,
      roster: {
        entries: SLOTS.map((slot, i) => ({
          playerId: t.id * 100 + i,
          lineupSlotId: slot,
          playerPoolEntry: {
            player: {
              fullName: `${t.abbrev} Player ${i}`,
              defaultPositionId: POS[i],
              proTeamId: (i % 30) + 1,
              injuryStatus: 'ACTIVE',
              ownership: { percentOwned: 50 + i },
              stats: [
                { scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: scale + i + week * 0.1 },
                ...(week <= PLAYED_THROUGH
                  ? [{ scoringPeriodId: week, statSourceId: 0, statSplitTypeId: 1, appliedTotal: scale + i + 1 }]
                  : []),
                { seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: (scale + i) * 13 },
              ],
            },
          },
        })),
      },
    })),
  };
}

/** The free-agent payload `fetchFreeAgents` reads, in the shape it comes in. */
function wirePayload(week, scale) {
  return {
    players: Array.from({ length: 6 }, (_, i) => ({
      player: {
        id: 9000 + i,
        fullName: `Free Agent ${i}`,
        defaultPositionId: POS[i % POS.length],
        proTeamId: (i % 30) + 1,
        injuryStatus: 'ACTIVE',
        ownership: { percentOwned: 30 - i },
        stats: [
          { scoringPeriodId: week, statSourceId: 1, statSplitTypeId: 1, appliedTotal: scale - i },
          { seasonId: 2026, statSourceId: 1, statSplitTypeId: 0, appliedTotal: (scale - i) * 13 },
        ],
      },
    })),
  };
}

/** The matchup payload `fetchSchedule` and `fetchSeasonData` read. */
function matchupPayload(scale, leagueName) {
  const schedule = [];
  for (const week of WEEKS) {
    const pairs = week === 1 ? [[1, 2], [3, 4]] : week === 2 ? [[1, 3], [2, 4]] : [[1, 4], [2, 3]];
    for (const [home, away] of pairs) {
      const played = week <= PLAYED_THROUGH;
      schedule.push({
        matchupPeriodId: week,
        home: { teamId: home, totalPoints: played ? scale * 10 + home : 0 },
        away: { teamId: away, totalPoints: played ? scale * 10 + away + 3 : 0 },
      });
    }
  }
  return {
    settings: { name: leagueName, size: TEAMS.length, rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1, 20: 6 } } },
    status: { currentMatchupPeriod: PLAYED_THROUGH + 1 },
    members: [],
    teams: TEAMS.map((t) => ({ id: t.id, name: t.teamName, abbrev: t.abbrev, roster: { entries: [] } })),
    schedule,
  };
}

const CLOUD = { scale: 10, name: 'The Synced League' };
const LIVE = { scale: 50, name: 'The Live League' };
const LEAGUE_ID = '476225250';
const SEASON = 2026;

// =========================================================================
// A FAKE FIRESTORE
// =========================================================================
//
// Deliberately the same shape as the one in tests/test-cloud.mjs: six methods,
// every document JSON round-tripped on the way in and out so nothing survives
// by shared reference. It counts reads, because "with the extension present,
// the cloud is not read" is one of the two claims this whole suite exists to
// make, and a count is the only way to assert it — a substitution that read the
// cloud and then discarded the answer would look identical from the outside.

// The fake user is the league's owner. The repo pins a real ownerUid in
// DEFAULT_CONFIG, and cloud.js refuses any other account before it writes, so a
// made-up uid here would be turned away as a stranger.
const OWNER_UID = (readFileSync(repoFile('js/cloud.js'), 'utf8')
  .match(/ownerUid:\s*'([^']*)'/) || [])[1] || 'uid-tim';

function makeFake({ user = { uid: OWNER_UID, email: 'tim@example.com', name: 'Tim' } } = {}) {
  const docs = new Map();
  const log = { reads: 0, writes: 0 };
  return {
    docs,
    log,
    user,
    async signIn() { return user; },
    async signOut() { /* nothing to do */ },
    currentUser() { return user; },
    onAuth(cb) { cb(user); return () => {}; },
    async getDoc(p) {
      log.reads++;
      const raw = docs.get(p);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async setDoc(p, data) {
      log.writes++;
      docs.set(p, JSON.stringify(data));
    },
  };
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * Backdate a sync, per shape.
 *
 * The point of the exercise: cloud.js calls the wire stale after a DAY and the
 * squads after a WEEK, so a three-day-old sync is one of each. Nothing else in
 * the suite can prove that the two thresholds are really separate, because a
 * fresh sync satisfies both and a month-old one fails both.
 */
function backdate(fake, ages) {
  const p = `leagues/${LEAGUE_ID}/seasons/${SEASON}`;
  const meta = JSON.parse(fake.docs.get(p));
  const iso = (ms) => new Date(Date.now() - ms).toISOString();
  meta.syncedShapes = {
    rosters: iso(ages.rosters),
    wire: iso(ages.wire),
    schedule: iso(ages.schedule),
  };
  meta.syncedAt = meta.syncedShapes.rosters;
  fake.docs.set(p, JSON.stringify(meta));
}

// =========================================================================
// STANDING IN FOR ESPN
// =========================================================================

/**
 * A counting `fetch` that answers as ESPN.
 *
 * Installed in every scenario, including the ones where ESPN must NOT be
 * asked: there, the count staying at zero IS the assertion. It answers rather
 * than throwing so that a test which accidentally lets a request through fails
 * on the numbers it drew, which names the defect, instead of on an exception,
 * which only says something went wrong somewhere.
 */
function installFetch(scale, name) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const week = Number((u.match(/scoringPeriodId=(\d+)/) || [])[1] || 0);
    const body = /kona_player_info/.test(u)
      ? wirePayload(week || 1, scale)
      : week || /mRoster/.test(u)
        ? rosterPayload(week || 1, scale, name)
        : matchupPayload(scale, name);
    return { ok: true, status: 200, async json() { return body; } };
  };
  return calls;
}

/** What the extension would answer, for one request. Shared by both fakes. */
function bridgeAnswer(req, scale, name) {
  if (req.type === 'PING') return { version: 'test' };
  if (req.type === 'GET_CONFIG') return { leagueId: LEAGUE_ID };
  if (req.type === 'PROBE') {
    return {
      leagueId: LEAGUE_ID, season: SEASON, name, teamCount: TEAMS.length,
      teams: TEAMS.map((t) => ({ id: t.id, name: t.name })),
    };
  }
  if (req.type === 'SEASON') {
    return { settings: { proTeams: [{ id: 1, byeWeek: 5 }, { id: 2, byeWeek: 6 }] } };
  }
  if (req.type === 'LEAGUE') {
    const views = req.views || [];
    if (views.includes('kona_player_info')) return wirePayload(req.scoringPeriodId || 1, scale);
    if (req.scoringPeriodId || views.includes('mRoster')) return rosterPayload(req.scoringPeriodId || 1, scale, name);
    return matchupPayload(scale, name);
  }
  return null;
}

/**
 * A bare window that answers as the bridge extension.
 *
 * MUST be installed before js/bridge.js is first imported: that module decides
 * once, at import, whether there is a window to listen to at all. Everything
 * after that is the real bridge — the HELLO below is what makes
 * `bridge.isAvailable()` true, and the replies are what `espn.leagueRead()`
 * routes through when it is.
 */
function installBridge(scale, name) {
  const handlers = [];
  const calls = [];
  const win = {
    location: { origin: 'http://localhost', href: 'http://localhost/' },
    addEventListener(type, fn) { if (type === 'message') handlers.push(fn); },
    removeEventListener() {},
    postMessage(msg) {
      if (!msg || msg.source !== 'ff-site') return;
      const req = msg.request || {};
      calls.push(req.type);
      const data = bridgeAnswer(req, scale, name);
      queueMicrotask(() => deliver({ source: 'ff-ext', id: msg.id, ok: true, data }));
    },
  };
  globalThis.window = win;
  function deliver(payload) {
    for (const fn of handlers) fn({ source: win, data: payload });
  }
  return { calls, hello: () => deliver({ source: 'ff-ext', type: 'HELLO', version: 'test' }) };
}

/**
 * The same extension, attached to a real (linkedom) window so a whole page can
 * be booted with it. The page needs its own window for everything else, so the
 * bare one above cannot be used here.
 */
function attachBridge(window, scale, name) {
  const calls = [];
  window.postMessage = (msg) => {
    if (!msg || msg.source !== 'ff-site') return;
    const req = msg.request || {};
    calls.push(req.type);
    const data = bridgeAnswer(req, scale, name);
    queueMicrotask(() => {
      const ev = new window.Event('message');
      ev.data = { source: 'ff-ext', id: msg.id, ok: true, data };
      ev.source = window;
      window.dispatchEvent(ev);
    });
  };
  return calls;
}

// =========================================================================
// SHARED SETUP
// =========================================================================

/**
 * Put a full season into the fake cloud, exactly the way the desktop would.
 *
 * Through the real `buildCloudPayload` and the real `syncUp`, against a fetch
 * answering as ESPN. Hand-writing documents into the store instead would test
 * that `readDown` can read what this file writes, which is not a fact about
 * the site.
 */
async function seedCloud(cloud, espn, season, fake) {
  const calls = installFetch(CLOUD.scale, CLOUD.name);
  espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
  cloud.configure({ transport: fake });
  const payload = await season.buildCloudPayload();
  const res = await cloud.syncUp(LEAGUE_ID, SEASON, payload, {});
  return { res, calls, payload };
}

// =========================================================================
// SCENARIOS
// =========================================================================

const SCENARIOS = {};

// -------------------------------------------------------------- substitute
//
// The load-bearing one. No extension, a sync sitting in the cloud, and the
// claim is that every fetcher in js/season.js serves it without asking ESPN
// for anything at all.

SCENARIOS.substitute = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));

  const fake = makeFake();
  const seeded = await seedCloud(cloud, espn, season, fake);
  ok('the desktop published a season', seeded.res.ok, seeded.res.reason);
  eq(seeded.payload.rosters.size, WEEKS.length, 'every week of squads went up');
  eq(seeded.payload.wire.size, WEEKS.length, 'and every week of the wire with it');
  ok('the whole span went, not just this week',
    [...seeded.payload.rosters.keys()].join(',') === WEEKS.join(','),
    [...seeded.payload.rosters.keys()].join(','));

  // Three days old: past the wire's one-day limit, well inside the squads'
  // week. This is the case the two thresholds exist to tell apart.
  backdate(fake, { rosters: 3 * DAY, wire: 3 * DAY, schedule: 3 * DAY });

  // From here ESPN must not be touched. The counter starts again at zero and
  // the payloads it would answer with are the LIVE ones, so anything that
  // slipped through would show up as a 50-point projection.
  const espnCalls = installFetch(LIVE.scale, LIVE.name);
  fake.log.reads = 0;

  // --- rosters, the whole span ---------------------------------------------
  const seen = [];
  const weekTeams = await season.fetchWeeksRosters(WEEKS, {
    onProgress: (done, total, week) => seen.push([done, total, week]),
  });
  eq(espnCalls.length, 0, 'ZERO ESPN calls: the span came out of the cloud');
  eq(weekTeams.size, WEEKS.length, 'every week came back');
  eq(weekTeams.get(1).length, TEAMS.length, 'with every squad in it');
  near(weekTeams.get(1)[0].players[0].projected, CLOUD.scale + 0 + 0.1,
    'and the numbers are the synced ones, not ESPN\'s');
  eq(seen.length, WEEKS.length, 'progress was reported for every week');
  eq(seen[seen.length - 1][0], seen[seen.length - 1][1],
    'and it reached the end, so a page\'s progress line clears');

  // The views cloud.js strips on the way up and rebuilds on the way down. A
  // page that got `players` and no `starters` would render an empty lineup.
  const t1 = weekTeams.get(1)[0];
  eq(t1.starters.length, 9, 'the starters view came back');
  eq(t1.bench.length, 6, 'and the bench with it');
  ok('the team totals came back as numbers', typeof t1.projectedTotal === 'number', t1.projectedTotal);

  // --- one week on its own --------------------------------------------------
  const one = await season.fetchWeekRosters(2);
  eq(espnCalls.length, 0, 'a single week is served from the cloud too');
  eq(one.week, 2, 'for the week that was asked for');
  near(one.teams[0].players[0].projected, CLOUD.scale + 0 + 0.2, 'with that week\'s synced numbers');

  // --- the schedule ---------------------------------------------------------
  const sched = await season.fetchSchedule();
  eq(espnCalls.length, 0, 'and so is the schedule');
  eq(sched.leagueName, CLOUD.name, 'it is the synced league');
  ok('byWeek came back as a Map, which is what every page indexes into',
    sched.byWeek instanceof Map, typeof sched.byWeek);
  eq(sched.byWeek.get(1).length, 2, 'with that week\'s games in it');
  eq(sched.weeks.length, WEEKS.length, 'and the full week list');
  ok('a played week is marked played', sched.byWeek.get(1)[0].played === true);
  ok('and an unplayed one is not', sched.byWeek.get(3)[0].played === false);

  // Two callers, two objects: the cache is shared and must not be shareable.
  const again = await season.fetchSchedule();
  ok('each caller gets its own games, so one cannot poison the next',
    again.games[0] !== sched.games[0]);

  // --- the stats page's season ---------------------------------------------
  const seasonData = await season.fetchSeasonData();
  eq(espnCalls.length, 0, 'the stats page\'s season is built from the cloud too');
  eq(seasonData.isDemo, false, 'and it is not demo data');
  eq(seasonData.games.length, 4, 'two played weeks, two games each');
  ok('every game carries a projection re-read from the synced squads',
    seasonData.games.every((g) => g.homeProjected > 0 && g.awayProjected > 0),
    JSON.stringify(seasonData.games[0]));
  eq(seasonData.name, CLOUD.name, 'named as the synced league');

  // --- one read for all of it ----------------------------------------------
  // 1 index + 3 roster weeks + 1 schedule. Four fetchers ran; if each had
  // asked the cloud for itself this would be four times as many.
  eq(fake.log.reads, 5, 'the whole page load cost five document reads');

  // --- the ages the bar draws ----------------------------------------------
  const src = await season.cloudSource();
  ok('the bar can see where the numbers came from', Boolean(src), 'cloudSource() was null');
  eq(src.ages.wire.stale, true, 'a three-day-old WIRE is reported stale');
  eq(src.ages.rosters.stale, false, 'while squads of exactly the same age are not');
  eq(src.ages.schedule.stale, false, 'nor the schedule');
  eq(src.ages.rosters.described, '3 days ago', 'and the age is in words, not a timestamp');
  ok('the raw age is there too, for anything that wants to decide for itself',
    src.ages.wire.ageMs > DAY, src.ages.wire.ageMs);

  // Nine days: now BOTH are stale, which is what turns the whole bar red.
  backdate(fake, { rosters: 9 * DAY, wire: 9 * DAY, schedule: 9 * DAY });
  const status = await cloud.cloudStatus(LEAGUE_ID, SEASON);
  eq(status.ages.rosters.stale, true, 'squads past a week are stale as well');
  eq(status.ages.wire.stale, true, 'and the wire the more so');
};

// ------------------------------------------------------------- bridge-wins
//
// The other half of the same decision. With the extension present the cloud is
// not preferred, and — the part that needs a counter to prove — it is not even
// asked.

SCENARIOS['bridge-wins'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));

  // Seed while there is no bridge, which is how it happens in life: the sync
  // is already up there from an earlier sitting.
  const fake = makeFake();
  const seeded = await seedCloud(cloud, espn, season, fake);
  ok('a season is sitting in the cloud', seeded.res.ok, seeded.res.reason);

  // Now the extension turns up. js/bridge.js was imported above with no
  // window, so this scenario proves the negative rather than the positive —
  // see `bridge-live` for the same claim with the bridge really routing.
  const before = fake.log.reads;
  const espnCalls = installFetch(LIVE.scale, LIVE.name);
  const bridge = await import(moduleUrl('js/bridge.js'));
  eq(bridge.isAvailable(), false, 'no extension in this process');

  const weekTeams = await season.fetchWeeksRosters(WEEKS);
  ok('with no extension the synced copy is served', weekTeams.size === WEEKS.length);
  near(weekTeams.get(1)[0].players[0].projected, CLOUD.scale + 0.1, 'and it is the synced numbers');
  eq(espnCalls.length, 0, 'and ESPN was not asked');
  ok('which cost document reads', fake.log.reads > before);
};

// ------------------------------------------------------------- bridge-live
//
// The real thing: a window that answers as the extension, so
// `bridge.isAvailable()` is true and `espn.leagueRead()` routes through it.

SCENARIOS['bridge-live'] = async () => {
  const ext = installBridge(LIVE.scale, LIVE.name);

  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));
  const bridge = await import(moduleUrl('js/bridge.js'));

  const fake = makeFake();
  const seeded = await seedCloud(cloud, espn, season, fake);
  ok('a season is in the cloud, and a good one', seeded.res.ok, seeded.res.reason);

  ext.hello();
  eq(bridge.isAvailable(), true, 'the extension announced itself');

  const espnCalls = installFetch(LIVE.scale, LIVE.name);
  fake.log.reads = 0;
  ext.calls.length = 0;

  const weekTeams = await season.fetchWeeksRosters(WEEKS);
  eq(weekTeams.size, WEEKS.length, 'the span came back');
  near(weekTeams.get(1)[0].players[0].projected, LIVE.scale + 0.1,
    'and it is ESPN\'s live numbers, not the synced ones');
  eq(fake.log.reads, 0, 'THE CLOUD WAS NOT READ AT ALL — not preferred, not even asked');
  ok('it went through the extension', ext.calls.filter((c) => c === 'LEAGUE').length >= WEEKS.length,
    ext.calls.join(','));
  eq(espnCalls.length, 0, 'so no direct fetch was needed either');

  const sched = await season.fetchSchedule();
  eq(sched.leagueName, LIVE.name, 'the schedule is live too');
  eq(fake.log.reads, 0, 'and still nothing read from the cloud');

  const one = await season.fetchWeekRosters(3);
  near(one.teams[0].players[0].projected, LIVE.scale + 0.3, 'a single week is live as well');
  eq(fake.log.reads, 0, 'still nothing');

  // And the bar's own question, answered the same way.
  const src = await season.cloudSource();
  eq(src, null, 'so the bar is told there is no synced source in play');
  eq(fake.log.reads, 0, 'asking that cost nothing either');
};

// ---------------------------------------------------------------- no-cloud
//
// The state the repo shipped in until Tim's project existed, and the one that
// has to be boring: with no project, js/cloud.js is inert and nothing about
// season.js is different from what it was before any of this was written.
// The repo now carries a real project (2026-09-16), so the blank config is
// made here rather than assumed — the "Turn it off" route in
// docs/firebase-setup.md is exactly this, and it must keep working.

SCENARIOS['no-cloud'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));

  cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
  eq(cloud.isConfigured(), false, 'with the four strings blanked, no Firebase project is configured');

  const calls = installFetch(LIVE.scale, LIVE.name);
  espn.configure({ leagueId: LEAGUE_ID, season: SEASON });

  const sched = await season.fetchSchedule();
  eq(sched.leagueName, LIVE.name, 'the schedule still comes from ESPN');
  ok('through a real request', calls.length === 1, calls.join(','));

  const weekTeams = await season.fetchWeeksRosters(WEEKS);
  eq(weekTeams.size, WEEKS.length, 'and so do the squads');
  eq(calls.length, 1 + WEEKS.length, 'at exactly one request per week, as always');
  near(weekTeams.get(2)[0].players[0].projected, LIVE.scale + 0.2, 'with ESPN\'s numbers');

  const src = await season.cloudSource();
  eq(src, null, 'there is no synced source');

  // Not configured means NOT ON THE NETWORK. Every one of these has to be a
  // decision made locally, or a site with no project would be making a round
  // trip on every page load to be told so.
  const before = calls.length;
  const down = await cloud.readDown(LEAGUE_ID, SEASON, {});
  eq(down.ok, false, 'readDown refuses without a project');
  eq(down.rosters instanceof Map, true, 'and still hands back the shapes a page reaches for');
  eq(down.ages.wire.stale, true, 'with "never synced" reported as stale, which is the truth');
  const up = await cloud.syncUp(LEAGUE_ID, SEASON, {}, {});
  eq(up.ok, false, 'syncUp refuses too');
  eq(calls.length, before, 'and none of that touched the network');

  // Demo is refused on its own account, whatever else is true.
  const demo = await cloud.syncUp('demo', SEASON, { leagueName: 'Demo' }, {});
  eq(demo.ok, false, 'demo data is never synced');
};

// -------------------------------------------------------------- page-synced
//
// The whole thing, end to end, through a real page: index.html with its real
// modules, no extension, a league saved from an earlier visit and a season
// sitting in the cloud. This is where the connection bar is asserted, because
// the bar's sentence is the only thing on a phone that says these numbers are
// a copy and how old it is.

SCENARIOS['page-synced'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));

  const fake = makeFake();
  const seeded = await seedCloud(cloud, espn, season, fake);
  ok('a season was published', seeded.res.ok, seeded.res.reason);
  backdate(fake, { rosters: 3 * DAY, wire: 3 * DAY, schedule: 3 * DAY });

  const { document, store } = await bootPage('index.html', {
    prefs: { 'home.source': 'live' },
    connection: { leagueId: LEAGUE_ID, season: SEASON, teamId: 1 },
    espnScale: LIVE,           // anything ESPN answers with would be wrong here
  });

  const bar = document.getElementById('connBar');
  const text = bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '';
  ok('the connection bar rendered', text.length > 10, text);
  ok('IT SAYS THE NUMBERS ARE A COPY, in words', /synced copy/i.test(text), text);
  ok('and that they are not live', /not live/i.test(text), text);
  ok('it names the league that was synced', text.includes(CLOUD.name), text);
  ok('and how old the squads are', /squads 3 days ago/i.test(text), text);
  ok('THE WIRE IS CALLED OUT SEPARATELY, being stale at the same age',
    /waiver wire 3 days ago .* out of date/i.test(text) || /waiver wire 3 days ago/i.test(text), text);
  ok('the wire is marked out of date and the squads are not',
    /out of date/i.test(text) && !/squads 3 days ago . out of date/i.test(text), text);
  ok('the bar is not claiming a live connection', !/^connected to/i.test(text), text);

  const chips = bar ? bar.querySelectorAll('.conn-chip.is-stale').length : 0;
  eq(chips, 1, 'exactly one age is drawn as stale — the wire, not the squads');

  // Three days is inside the squads' week, so the bar is green rather than red.
  eq(bar.className, 'conn ok', 'and the bar itself is not in its loud state yet');

  // The page itself: it left demo behind and the numbers on screen are the
  // synced ones. The badge is the page's own claim about which it is showing,
  // so it is the right thing to read — the word "Demo" also appears in the
  // source toggle, which is a control rather than a statement.
  const badge = document.getElementById('modeBadge');
  eq(badge && badge.textContent, 'Live', 'the page left demo data behind');
  const body = document.body.textContent.replace(/\s+/g, ' ');
  ok('and it is the synced league on screen', body.includes(CLOUD.name), body.slice(0, 300));
  ok('with real rows drawn from it', document.querySelectorAll('tbody td').length > 10,
    String(document.querySelectorAll('tbody td').length));

  // And nothing was asked of ESPN to draw any of it.
  eq(store.espnCalls.length, 0, 'the page made no ESPN requests at all');
};

// ---------------------------------------------------------------- page-stale
//
// The same page with a nine-day-old sync. Everything below the bar is out of
// date, so the bar stops being a note and becomes a warning.

SCENARIOS['page-stale'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));

  const fake = makeFake();
  await seedCloud(cloud, espn, season, fake);
  backdate(fake, { rosters: 9 * DAY, wire: 9 * DAY, schedule: 9 * DAY });

  const { document } = await bootPage('index.html', {
    prefs: { 'home.source': 'live' },
    connection: { leagueId: LEAGUE_ID, season: SEASON, teamId: 1 },
    espnScale: LIVE,
  });

  const bar = document.getElementById('connBar');
  const text = bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '';
  eq(bar.className, 'conn stale', 'THE WHOLE BAR GOES LOUD, not a corner of it');
  ok('it leads with the warning rather than mentioning it in passing',
    /^out of date\b/i.test(text), text);
  ok('it names how old the numbers are', /9 days ago/i.test(text), text);
  ok('and says plainly that nothing on the page is current',
    /nothing on this page is current/i.test(text), text);
  ok('and what to do about it', /on your computer/i.test(text), text);
  ok('both ages are drawn stale now',
    bar.querySelectorAll('.conn-chip.is-stale').length >= 2,
    String(bar.querySelectorAll('.conn-chip.is-stale').length));
};

// ----------------------------------------------------------------- page-plain
//
// The control. No Firebase project (blanked here, as "Turn it off" does): the
// page must be indistinguishable from what it was before any of this existed.

SCENARIOS['page-plain'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
  eq(cloud.isConfigured(), false, 'no project configured');

  const { document, store } = await bootPage('index.html', {});

  const bar = document.getElementById('connBar');
  const text = bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '';
  ok('the bar still renders', text.length > 10, text);
  ok('it is the ordinary not-connected state', /not connected/i.test(text), text);
  ok('there is still a league ID field', !!document.getElementById('connLeague'));
  ok('and a Connect button', !!document.getElementById('connSync'));
  ok('NOTHING about the cloud is offered', !/sign in with google/i.test(text), text);
  ok('and nothing about syncing', !/send to phone/i.test(text), text);
  ok('no age is claimed', !document.querySelector('.conn-chip'));

  const body = document.body.textContent.replace(/\s+/g, ' ');
  ok('the page drew its demo season as before', /Demo/i.test(body), body.slice(0, 200));
  ok('with real rows in it', document.querySelectorAll('tbody td').length > 10,
    String(document.querySelectorAll('tbody td').length));
  eq(store.espnCalls.length, 0, 'and made no network calls');
};

// -------------------------------------------------------------- desktop-sync
//
// The other end of the wire: the machine WITH the extension, publishing
// unasked. This is the half that has to happen by itself — Tim opening the
// site on his computer is the only event that refreshes what his phone sees,
// and if it needed a button press it would not happen.

SCENARIOS['desktop-sync'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const fake = makeFake();
  cloud.configure({ transport: fake });

  const { document, store } = await bootPage('index.html', {
    prefs: { 'home.source': 'live' },
    connection: { leagueId: LEAGUE_ID, season: SEASON, teamId: 1 },
    withBridge: LIVE,
    waitMs: 5000,
  });

  const bar = document.getElementById('connBar');
  const text = bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '';
  ok('the desktop connected live through the extension', /connected to/i.test(text), text);
  ok('and it says it is the live league', text.includes(LIVE.name), text);

  // 3 roster weeks + 3 wire weeks + the schedule + the league index.
  eq(fake.log.writes, 8, 'it published the whole season without being asked');
  ok('the whole span went up, not just this week',
    [...fake.docs.keys()].filter((k) => /\/rosters\//.test(k)).length === WEEKS.length,
    [...fake.docs.keys()].join(' '));
  ok('and the wire with it',
    [...fake.docs.keys()].filter((k) => /\/wire\//.test(k)).length === WEEKS.length);
  ok('the league index went LAST, so it never promises a week that is missing',
    [...fake.docs.keys()].pop() === `leagues/${LEAGUE_ID}/seasons/${SEASON}`,
    [...fake.docs.keys()].pop());

  ok('the bar says when it last sent', /sent to your phone/i.test(text), text);
  ok('and how much went', /8 files/.test(text), text);
  ok('there is a button to send again', !!document.getElementById('connCloudSync'));
  ok('it did NOT offer a sign-in, being signed in already', !/sign in with google/i.test(text), text);
  // THE BAR NEVER PROBED ESPN DIRECTLY. It waits for the extension's 400ms
  // rather than racing it — a desktop that probed first would label itself by
  // whichever answered soonest. (index.html's own module starts a live load on
  // import, before any of this, and that one request is not the bar's.)
  ok('the bar never fell back to a direct probe',
    store.espnCalls.filter((u) => /mSettings/.test(u)).length === 0, store.espnCalls.join(' '));
};

// ----------------------------------------------------------- desktop-throttled
//
// And the reason it is not on every page load. Six pages in a sitting is six
// syncs, which is fourteen ESPN requests and twenty-eight writes each time, to
// publish numbers that have not moved.

SCENARIOS['desktop-throttled'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const fake = makeFake();
  cloud.configure({ transport: fake });

  const { document } = await bootPage('index.html', {
    prefs: { 'home.source': 'live' },
    connection: { leagueId: LEAGUE_ID, season: SEASON, teamId: 1 },
    cloudRecord: {
      [`${LEAGUE_ID}::${SEASON}`]: { at: Date.now() - 60 * 60 * 1000, ok: true, wrote: 8, reason: '' },
    },
    withBridge: LIVE,
    waitMs: 3000,
  });

  eq(fake.log.writes, 0, 'an hour after a good sync, it does not publish again');

  const bar = document.getElementById('connBar');
  const text = bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '';
  ok('but it still says when it last did', /sent to your phone 1 h ago/i.test(text), text);
  ok('and the button is there for anyone who wants it now anyway',
    !!document.getElementById('connCloudSync'));
};

// =========================================================================
// BOOTING A REAL PAGE
// =========================================================================
//
// The shims are the same set tests/test-pages-render.mjs installs and are
// needed for the same reason: linkedom implements the DOM this site uses but
// not <select>.value, the table conveniences, or a window location. See
// tests/README.md for the two gotchas.

async function bootPage(page, { prefs = null, connection = null, espnScale = null, cloudRecord = null, withBridge = null, waitMs = 2200 } = {}) {
  const { parseHTML } = await import('linkedom');
  const html = readFileSync(repoFile(page), 'utf8');
  const { window, document } = parseHTML(html);

  const SelectProto = window.HTMLSelectElement?.prototype;
  if (SelectProto) {
    Object.defineProperty(SelectProto, 'value', {
      configurable: true,
      get() {
        const sel = this.querySelector('option[selected]') || this.querySelector('option');
        return sel ? sel.getAttribute('value') ?? sel.textContent : '';
      },
      set(v) {
        for (const o of this.querySelectorAll('option')) {
          if ((o.getAttribute('value') ?? o.textContent) === String(v)) o.setAttribute('selected', '');
          else o.removeAttribute('selected');
        }
      },
    });
  }

  const TableProto = Object.getPrototypeOf(document.createElement('table'));
  const kids = (el, tag) => (el ? Array.from(el.children).filter((c) => c.tagName === tag) : []);
  Object.defineProperty(TableProto, 'tBodies', { configurable: true, get() { return kids(this, 'TBODY'); } });
  Object.defineProperty(TableProto, 'tHead', { configurable: true, get() { return kids(this, 'THEAD')[0] || null; } });
  Object.defineProperty(TableProto, 'rows', {
    configurable: true,
    get() {
      const head = kids(this, 'THEAD')[0];
      const rows = [];
      if (head) rows.push(...kids(head, 'TR'));
      for (const b of kids(this, 'TBODY')) rows.push(...kids(b, 'TR'));
      rows.push(...kids(this, 'TR'));
      return rows;
    },
  });
  const RowProto = Object.getPrototypeOf(document.createElement('tr'));
  Object.defineProperty(RowProto, 'cells', {
    configurable: true,
    get() { return Array.from(this.children).filter((c) => c.tagName === 'TD' || c.tagName === 'TH'); },
  });

  const saved = new Map();
  if (prefs) saved.set('ff.prefs', JSON.stringify(prefs));
  if (connection) saved.set('ff.connection', JSON.stringify(connection));
  if (cloudRecord) saved.set('ff.cloud', JSON.stringify(cloudRecord));
  const localStorage = {
    getItem: (k) => (saved.has(k) ? saved.get(k) : null),
    setItem: (k, v) => saved.set(k, String(v)),
    removeItem: (k) => saved.delete(k),
    clear: () => saved.clear(),
  };

  // Every ESPN request is counted and answered with numbers that are WRONG for
  // the scenario, so a page that let one through fails on what it drew.
  const espnCalls = espnScale
    ? installFetch(espnScale.scale, espnScale.name)
    : (() => { const c = []; globalThis.fetch = async (u) => { c.push(String(u)); throw new Error(`unexpected network call: ${u}`); }; return c; })();

  // js/bridge.js decides at import whether there is a window at all, and in
  // these scenarios its first import is below — so the extension has to be
  // attached to this window BEFORE the page modules load.
  if (!window.location) window.location = { origin: 'http://localhost', href: 'http://localhost/' };
  if (!window.postMessage) window.postMessage = () => {};
  const bridgeCalls = withBridge ? attachBridge(window, withBridge.scale, withBridge.name) : [];

  Object.assign(globalThis, {
    document, localStorage,
    HTMLElement: window.HTMLElement,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    Node: window.Node,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
  if (!globalThis.window) globalThis.window = window;
  window.localStorage = localStorage;
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.ResizeObserver = globalThis.ResizeObserver;

  const srcs = [];
  const re = /<script[^>]*type=["']module["'][^>]*src=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) srcs.push(m[1]);
  for (const src of srcs) await import(pathToFileURL(path.join(REPO, src)).href);

  // The bar's own bridge ping waits 400ms and then times out at 1200ms, and
  // the page's live load is behind that. Two seconds is comfortably past both;
  // a scenario that also publishes a season asks for longer.
  await new Promise((r) => setTimeout(r, waitMs));

  return { window, document, store: { espnCalls, bridgeCalls, saved } };
}

// =========================================================================
// RUNNER
// =========================================================================

const self = fileURLToPath(import.meta.url);
const asked = process.argv[2];

if (asked) {
  const fn = SCENARIOS[asked];
  if (!fn) {
    console.log(`no scenario named ${asked}`);
    process.exit(2);
  }
  const rejections = [];
  process.on('unhandledRejection', (e) => rejections.push(String((e && e.message) || e)));
  try {
    await fn();
  } catch (err) {
    fails.push(`threw: ${(err && err.stack) || err}`);
  }
  // Nothing here may take a page down. A bar that throws leaves a reader
  // looking at half a page with no idea why.
  ok('no unhandled rejections', rejections.length === 0, rejections.join(' | '));

  console.log(results.join('\n'));
  console.log(JSON.stringify({ scenario: asked, pass, fails }));
  process.exit(fails.length ? 1 : 0);
}

const order = Object.keys(SCENARIOS);
let total = 0;
let failed = 0;
for (const name of order) {
  const res = spawnSync(process.execPath, [self, name], { encoding: 'utf8', timeout: 5 * 60 * 1000 });
  const out = (res.stdout || '') + (res.stderr || '');
  const line = (res.stdout || '').trim().split('\n').filter(Boolean).pop();
  let parsed = null;
  try { parsed = JSON.parse(line); } catch { /* fall through */ }

  if (!parsed) {
    failed++;
    console.log(`FAIL ${name} — no result`);
    console.log(out.trimEnd().split('\n').slice(-25).map((l) => `    ${l}`).join('\n'));
    continue;
  }
  total += parsed.pass;
  if (parsed.fails.length) {
    failed++;
    console.log(`FAIL ${name}  (${parsed.pass} passed, ${parsed.fails.length} failed)`);
    for (const f of parsed.fails) console.log(`   ✗ ${f}`);
  } else {
    console.log(`PASS ${name}  (${parsed.pass} assertions)`);
  }
}

console.log(failed
  ? `\n${failed} of ${order.length} scenarios failed`
  : `\nAll ${total} assertions passed across ${order.length} scenarios`);
process.exit(failed ? 1 : 0);
