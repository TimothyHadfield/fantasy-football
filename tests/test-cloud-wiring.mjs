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
// What a sync publishes: the regular season AND the playoff weeks, asked for by
// number because bracket games do not exist until seeding. Four teams and no
// playoff setting is a four-team field — two rounds — so weeks 4 and 5.
const SYNCED_WEEKS = [1, 2, 3, 4, 5];

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
function wirePayload(week, scale, count = 6) {
  return {
    players: Array.from({ length: count }, (_, i) => ({
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

// `arrivesAfter`: the session of an earlier visit being restored — nobody is
// signed in when the page first asks, and `user` arrives that many milliseconds
// later, which is how the real SDK always answers.
function makeFake({ user = { uid: OWNER_UID, email: 'tim@example.com', name: 'Tim' }, arrivesAfter = null } = {}) {
  const docs = new Map();
  const log = { reads: 0, writes: 0, paths: [], readPaths: [] };
  let here = arrivesAfter == null ? user : null;
  return {
    docs,
    log,
    user,
    async signIn() { return user; },
    async signOut() { /* nothing to do */ },
    currentUser() { return here; },
    onAuth(cb) {
      if (arrivesAfter == null) cb(user);
      else setTimeout(() => { here = user; cb(user); }, arrivesAfter);
      return () => {};
    },
    async getDoc(p) {
      log.reads++;
      log.readPaths.push(p);
      const raw = docs.get(p);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async setDoc(p, data) {
      log.writes++;
      log.paths.push(p);
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
  eq(seeded.payload.rosters.size, SYNCED_WEEKS.length, 'every week of squads went up, playoff weeks included');
  eq(seeded.payload.wire.size, SYNCED_WEEKS.length, 'and every week of the wire with it');
  ok('the whole span went, not just this week',
    [...seeded.payload.rosters.keys()].join(',') === SYNCED_WEEKS.join(','),
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
  // 1 index + 5 roster weeks (3 regular, 2 playoff) + 1 schedule. Four
  // fetchers ran; if each had asked the cloud for itself this would be four
  // times as many.
  eq(fake.log.reads, 7, 'the whole page load cost seven document reads');

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
  const byeReads = calls.filter((u) => /proTeamSchedules_wl/.test(u)).length;
  eq(calls.length - byeReads, 1 + WEEKS.length, 'at exactly one request per week, as always');
  eq(byeReads, 1, 'plus ONE bye-week read for the whole span (the bye rule), not one per week');
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

  // The main menu's list says this league came from the synced copy, which is
  // what stops "Add a league" asking ESPN from the phone (rule 20).
  eq((JSON.parse(store.saved.get('ff.leagues') || '{}')).source, 'cloud', 'and the main menu’s list notes that it is the synced copy');
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
  ok('and the main menu’s list is not written by a browser that connected to nothing', !store.saved.has('ff.leagues'));
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

  // 5 roster weeks + 5 wire weeks (3 regular, 2 playoff) + the schedule +
  // the league index. The account's saved league (users/<uid>) is a
  // separate, one-off write.
  // The Decisions review's weeks ride along in documents of their own, not
  // counted in "12 files": one per week ESPN has decided.
  const isDecision = (p) => /\/decisions\//.test(p);
  const seasonWrites = fake.log.paths.filter((p) => !p.startsWith('users/') && !isDecision(p)).length;
  eq(seasonWrites, 12, 'it published the whole season without being asked');
  eq(fake.log.paths.filter(isDecision).map((p) => p.split('/').pop()).join(','),
    Array.from({ length: PLAYED_THROUGH }, (_, i) => i + 1).join(','),
    'and each decided week’s moves with it, for the Decisions review on the phone');
  // Remembered in a key of its own, so the next automatic sync sends a decided
  // week again only if it changed (js/cloud.js compares these marks).
  const sent = JSON.parse(store.saved.get('ff.cloud.decisions') || '{}')[`${LEAGUE_ID}::${SEASON}`] || {};
  eq(Object.keys(sent).join(','), Array.from({ length: PLAYED_THROUGH }, (_, i) => i + 1).join(','),
    'and the bar noted which weeks it sent');
  eq(Object.keys(JSON.parse(store.saved.get('ff.cloud') || '{}')[`${LEAGUE_ID}::${SEASON}`] || {}).sort().join(','),
    'at,ok,reason,wrote', 'without changing the shape of its own sync record');
  ok('the whole span went up, not just this week',
    [...fake.docs.keys()].filter((k) => /\/rosters\//.test(k)).length === SYNCED_WEEKS.length,
    [...fake.docs.keys()].join(' '));
  ok('and the wire with it',
    [...fake.docs.keys()].filter((k) => /\/wire\//.test(k)).length === SYNCED_WEEKS.length);
  ok('the league index went LAST, so it never promises a week that is missing',
    [...fake.docs.keys()].pop() === `leagues/${LEAGUE_ID}/seasons/${SEASON}`,
    [...fake.docs.keys()].pop());
  // THE OWNER'S PATHS, every one, spelled out ("Anyone can sign up",
  // 2026-10-10, moved nothing of the owner's). The fake user is the real
  // pinned owner (`OWNER_UID`).
  const S0 = 'leagues/476225250/seasons/2026';
  eq(JSON.stringify([...new Set(fake.log.paths)].sort()), JSON.stringify([
    S0,
    `${S0}/decisions/1`, `${S0}/decisions/2`,
    `${S0}/parts/schedule`,
    `${S0}/rosters/1`, `${S0}/rosters/2`, `${S0}/rosters/3`, `${S0}/rosters/4`, `${S0}/rosters/5`,
    `${S0}/wire/1`, `${S0}/wire/2`, `${S0}/wire/3`, `${S0}/wire/4`, `${S0}/wire/5`,
    `users/${OWNER_UID}`,
  ].sort()), 'THE OWNER WRITES EXACTLY THE DOCUMENTS IT ALWAYS HAS, at the paths it always has');
  eq(Object.keys(JSON.parse(store.saved.get('ff.cloud') || '{}')).join(), `${LEAGUE_ID}::${SEASON}`,
    'and its notes of what it sent keep the names they have always had');

  ok('the bar says when it last sent', /sent to your phone/i.test(text), text);
  ok('and how much went', /12 files/.test(text), text);
  ok('there is a button to send again', !!document.getElementById('connCloudSync'));
  ok('it did NOT offer a sign-in, being signed in already', !/sign in with google/i.test(text), text);
  // THE BAR NEVER PROBED ESPN DIRECTLY. It waits for the extension's 400ms
  // rather than racing it — a desktop that probed first would label itself by
  // whichever answered soonest. (index.html's own module starts a live load on
  // import, before any of this, and that one request is not the bar's.)
  ok('the bar never fell back to a direct probe',
    store.espnCalls.filter((u) => /mSettings/.test(u)).length === 0, store.espnCalls.join(' '));

  // The main menu's list (js/leagues.js) is kept current by the bar.
  const menu = JSON.parse(store.saved.get('ff.leagues') || '{}');
  const mine = (menu.leagues || []).find((e) => e.leagueId === LEAGUE_ID) || {};
  eq(JSON.stringify([mine.name, mine.teamCount, mine.seasons, mine.teams, menu.source]),
    JSON.stringify([LIVE.name, TEAMS.length, [SEASON], { [SEASON]: { id: 1, name: 'Tim' } }, 'espn']),
    'the main menu’s list now holds the league: its name, size, this season, the "You are" team, read live');
};

// ------------------------------------------------------------ profile-saved
//
// Typed once: the desktop that connects while signed in puts the league and
// the team on the ACCOUNT, and does it once rather than on every page load.

SCENARIOS['profile-saved'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const fake = makeFake();
  cloud.configure({ transport: fake });

  const { store } = await bootPage('index.html', {
    prefs: { 'home.source': 'live' },
    connection: { leagueId: LEAGUE_ID, season: SEASON, teamId: 3 },
    withBridge: LIVE,
    waitMs: 3000,
  });

  const doc = fake.docs.get(`users/${OWNER_UID}`);
  ok('the account now holds the league', !!doc, [...fake.docs.keys()].join(' '));
  const p = doc ? JSON.parse(doc) : {};
  eq(p.leagueId, String(LEAGUE_ID), 'the league id');
  eq(p.teamId, 3, 'and the team chosen on this device');
  eq(p.season, SEASON, 'and the season');
  eq(fake.log.paths.filter((x) => x.startsWith('users/')).length, 1, 'written exactly once');
  ok('this browser noted it, so the next page load does not write again',
    (store.saved.get('ff.profileSaved') || '').includes(String(LEAGUE_ID)), store.saved.get('ff.profileSaved'));

  // Demo is never remembered: nothing but the owner's own document was written.
  ok('no other account document', [...fake.docs.keys()].filter((k) => k.startsWith('users/')).length === 1);
};

// ------------------------------------------------------------ profile-phone
//
// The other device: nothing saved in this browser at all — a new iPhone, or
// the home-screen app with its own storage — but signed in to the same
// account. It must find the league and team by itself and connect.

SCENARIOS['profile-phone'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));

  const fake = makeFake();
  const seeded = await seedCloud(cloud, espn, season, fake);
  ok('a season was published', seeded.res.ok, seeded.res.reason);
  await fake.setDoc(`users/${OWNER_UID}`, { leagueId: String(LEAGUE_ID), season: SEASON, teamId: 2, updatedAt: 'x' });
  const writesBefore = fake.log.writes;

  const { document, store } = await bootPage('index.html', {
    espnScale: LIVE,   // anything ESPN answers with would be wrong here
    waitMs: 3000,
  });

  const bar = document.getElementById('connBar');
  const text = bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '';
  ok('THE PHONE CONNECTED WITHOUT BEING TOLD THE LEAGUE', /synced copy/i.test(text), text);
  ok('to the account\'s league', text.includes(CLOUD.name), text);

  const conn = JSON.parse(store.saved.get('ff.connection') || '{}');
  eq(conn.leagueId, String(LEAGUE_ID), 'the league id is now saved in this browser');
  eq(conn.teamId, 2, 'and so is the team, from the account');
  const picked = document.querySelector('#connTeam option[selected]');
  eq(picked && picked.getAttribute('value'), '2', 'the team picker shows it');

  eq(fake.log.writes, writesBefore, 'and it wrote nothing back — the account already said so');
  eq(store.espnCalls.length, 0, 'ESPN was never asked');
};

// A device that already has a league of its own keeps it.
SCENARIOS['profile-no-override'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const fake = makeFake();
  cloud.configure({ transport: fake });
  await fake.setDoc(`users/${OWNER_UID}`, { leagueId: '999999', season: SEASON, teamId: 7, updatedAt: 'x' });

  const { store } = await bootPage('index.html', {
    prefs: { 'home.source': 'live' },
    connection: { leagueId: LEAGUE_ID, season: SEASON, teamId: 1 },
    withBridge: LIVE,
    waitMs: 3000,
  });

  const conn = JSON.parse(store.saved.get('ff.connection') || '{}');
  eq(conn.leagueId, String(LEAGUE_ID), 'the league typed on this device is kept');
  eq(conn.teamId, 1, 'and its team');
  const p = JSON.parse(fake.docs.get(`users/${OWNER_UID}`));
  eq(p.leagueId, String(LEAGUE_ID), 'and the account follows the device that last connected');
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

  eq(fake.log.paths.filter((p) => !p.startsWith('users/')).length, 0,
    'an hour after a good sync, it does not publish again');

  const bar = document.getElementById('connBar');
  const text = bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '';
  ok('but it still says when it last did', /sent to your phone 1 h ago/i.test(text), text);
  ok('and the button is there for anyone who wants it now anyway',
    !!document.getElementById('connCloudSync'));
};

// =========================================================================
// THE MAIN MENU: EARLIER SEASONS, AND LEAGUES CHOSEN THERE
// =========================================================================
//
// Tim, 2026-10-10: "look into past leagues aswell". An earlier season opened
// from the menu is READ and nothing else. Every cloud copy is first-copy-wins
// (the Value lines above all), so one minted from a finished season could never
// be taken back; the account's saved league is where the phone lands, and it
// must stay on this season; and there is no week to save, so nothing is said
// about one.

const PAST = SEASON - 1;

SCENARIOS['past-season'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const fake = makeFake();
  cloud.configure({ transport: fake });
  // The account already holds this season's league and team.
  const profile = { leagueId: String(LEAGUE_ID), season: SEASON, teamId: 2, updatedAt: 'x' };
  await fake.setDoc(`users/${OWNER_UID}`, profile);
  fake.log.writes = 0;
  fake.log.paths.length = 0;

  const { document, store } = await bootPage('index.html', {
    prefs: { 'home.source': 'live' },
    connection: { leagueId: LEAGUE_ID, season: PAST, teamId: 3 },
    withBridge: LIVE,
    waitMs: 5000,
  });

  const bar = document.getElementById('connBar');
  const text = bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '';
  ok('the earlier season connected live through the extension', /connected to/i.test(text) && text.includes(LIVE.name), text);
  eq(JSON.parse(store.saved.get('ff.connection') || '{}').season, PAST, 'and it is the earlier season that is connected');

  eq(fake.log.paths.join(' '), '', 'NOTHING WAS SENT TO THE CLOUD: no squads, no schedule, no Value lines, no decisions');
  eq(store.saved.has('ff.cloud'), false, 'no sync was even attempted (no sync record)');
  eq(fake.docs.get(`users/${OWNER_UID}`), JSON.stringify(profile), 'THE ACCOUNT’S LEAGUE IS UNTOUCHED: still this season, still its team');
  eq(store.saved.has('ff.profileSaved'), false, 'and this browser did not note a profile write');

  eq([...store.saved.keys()].filter((k) => /^ff\.snap/.test(k)).join(' '), '', 'no reading was taken, and no attempt noted');
  ok('no "NOT recorded" chip', !document.getElementById('connCapture'));
  const savedChip = document.getElementById('connSaved');
  ok('and no "Week N saved / not saved yet" chip', !savedChip || savedChip.hasAttribute('hidden'), savedChip && savedChip.textContent);
  ok('nothing in the bar speaks of a week being saved', !/saved|recorded/i.test(text), text);
  ok('there is no Send to phone button', !document.getElementById('connCloudSync'));
  ok('nor a claim about sending', !/sent to your phone|not sent to your phone/i.test(text), text);
  ok('it still says who is signed in', /signed in as tim@example\.com/i.test(text), text);

  // The menu's list learns the season and the team chosen for it.
  const mine = ((JSON.parse(store.saved.get('ff.leagues') || '{}')).leagues || []).find((e) => e.leagueId === LEAGUE_ID) || {};
  eq(JSON.stringify([mine.seasons, mine.teams]), JSON.stringify([[PAST], { [PAST]: { id: 3, name: 'Cal' } }]),
    'the main menu’s list holds the earlier season and the "You are" team for it');
};

// The account's team belongs to the account's season. A league-season opened
// from the menu with no team chosen is not handed this season's team id.
SCENARIOS['past-season-team'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const fake = makeFake();
  cloud.configure({ transport: fake });
  await fake.setDoc(`users/${OWNER_UID}`, { leagueId: String(LEAGUE_ID), season: SEASON, teamId: 2, updatedAt: 'x' });
  fake.log.writes = 0;

  const { document, store } = await bootPage('index.html', {
    prefs: { 'home.source': 'live' },
    connection: { leagueId: LEAGUE_ID, season: PAST, teamId: null },
    withBridge: LIVE,
    waitMs: 3000,
  });
  const conn = JSON.parse(store.saved.get('ff.connection') || '{}');
  eq(JSON.stringify([conn.leagueId, conn.season, conn.teamId]), JSON.stringify([LEAGUE_ID, PAST, null]),
    'the league-season chosen on the menu is kept, and this season’s team is NOT put on it');
  const picked = document.querySelector('#connTeam option[selected]');
  eq(picked ? picked.getAttribute('value') : '', '', 'the team picker still asks');
  eq(fake.log.writes, 0, 'and nothing is written to the account');
};

// The control for the one above: the SAME season still takes the account's team.
SCENARIOS['profile-team-same-season'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const fake = makeFake();
  cloud.configure({ transport: fake });
  await fake.setDoc(`users/${OWNER_UID}`, { leagueId: String(LEAGUE_ID), season: SEASON, teamId: 2, updatedAt: 'x' });

  const { store } = await bootPage('index.html', {
    prefs: { 'home.source': 'live' },
    connection: { leagueId: LEAGUE_ID, season: SEASON, teamId: null },
    withBridge: LIVE,
    waitMs: 3000,
  });
  eq(JSON.parse(store.saved.get('ff.connection') || '{}').teamId, 2, 'this season, with no team chosen here, takes the account’s as before');
};

// ------------------------------------------------------------- menu-opened
//
// `leagues.open()` writes the slot with no name and no teams. The bar must ASK
// before it says anything — also on a browser with no extension and no account,
// which until now only reconnected by itself when it had one of the two.

SCENARIOS['menu-opened'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
  installStorage();
  const leagues = await import(moduleUrl('js/leagues.js'));
  leagues.add({ leagueId: LEAGUE_ID, name: 'Before', teamCount: 4, seasons: [SEASON], season: SEASON, team: { id: 4, name: 'Dee' } });
  const opened = leagues.open(LEAGUE_ID, SEASON);
  eq(opened.ok, true, 'the menu opened the league');
  const slot = globalThis.localStorage.getItem('ff.connection');
  eq(slot, JSON.stringify({ leagueId: LEAGUE_ID, season: SEASON, teamId: 4 }), 'leaving only the league, season and team in the slot');

  const { document, store } = await bootPage('index.html', {
    prefs: JSON.parse(globalThis.localStorage.getItem('ff.prefs')),
    connection: JSON.parse(slot),
    extra: { 'ff.leagues': globalThis.localStorage.getItem('ff.leagues') },
    espnScale: LIVE,
    waitMs: 3000,
  });
  const text = (document.getElementById('connBar') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();
  ok('THE BAR PROBED BY ITSELF and now names the league', /connected to/i.test(text) && text.includes(LIVE.name), text);
  ok('through a real request for the league', store.espnCalls.some((u) => /mSettings/.test(u)), store.espnCalls.join(' '));
  const conn = JSON.parse(store.saved.get('ff.connection') || '{}');
  eq(JSON.stringify([conn.teamId, conn.league && conn.league.name]), JSON.stringify([4, LIVE.name]), 'with the team the menu opened it as');
  const menu = JSON.parse(store.saved.get('ff.leagues') || '{}');
  eq(JSON.stringify([menu.probe, (menu.leagues[0] || {}).name]), JSON.stringify([null, LIVE.name]),
    'and the list is told: probed, and the league’s real name');
};

// The control: the same slot with no menu behind it is left for a Connect
// press, exactly as before the menu existed.
SCENARIOS['menu-not-opened'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
  const { document, store } = await bootPage('index.html', {
    prefs: { 'home.source': 'demo' },   // so any ESPN request here is the bar's own
    connection: { leagueId: LEAGUE_ID, season: SEASON, teamId: 4 },
    espnScale: LIVE,
    waitMs: 3000,
  });
  const text = (document.getElementById('connBar') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();
  ok('with no extension, no account and no menu, the bar does not probe by itself', /not connected/i.test(text), text);
  eq(store.espnCalls.filter((u) => /mSettings/.test(u)).length, 0, 'and asks ESPN nothing for the league');
};

// ------------------------------------------------------------ removed-sticks
//
// Remove on the menu empties the connection slot. Two things used to refill an
// empty slot unasked — the league id in the extension's popup and the league
// on the account — and either would walk the site straight back in.

SCENARIOS['removed-sticks'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const fake = makeFake();
  cloud.configure({ transport: fake });
  await fake.setDoc(`users/${OWNER_UID}`, { leagueId: String(LEAGUE_ID), season: SEASON, teamId: 2, updatedAt: 'x' });

  // What `leagues.remove()` leaves behind: an empty slot and the league noted
  // as removed. Written by hand because js/leagues.js imports js/bridge.js,
  // which must not load before the page's window has its extension attached;
  // tests/test-leagues.mjs holds `remove()` to exactly this shape.
  const { document, store } = await bootPage('index.html', {
    extra: { 'ff.leagues': { v: 1, leagues: [], removed: [LEAGUE_ID], probe: null, source: null } },
    withBridge: LIVE,          // its popup holds this very league id
    waitMs: 3000,
  });
  const text = (document.getElementById('connBar') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();
  ok('the extension is there', /bridge extension detected/i.test(text) && store.bridgeCalls.includes('GET_CONFIG'), text);
  ok('THE SITE DID NOT WALK BACK IN: the bar asks for a league id', !!document.getElementById('connLeague') && !/connected to/i.test(text), text);
  eq(store.bridgeCalls.filter((c) => c === 'PROBE').length, 0, 'the removed league was never probed');
  ok('and it is not saved back into the slot', !JSON.parse(store.saved.get('ff.connection') || '{}').leagueId, store.saved.get('ff.connection'));
  eq((JSON.parse(store.saved.get('ff.leagues') || '{}').leagues || []).length, 0, 'nor put back on the list');
};

// The control: with nothing removed, the popup's league id still connects by itself.
SCENARIOS['popup-league'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
  const { document, store } = await bootPage('index.html', { withBridge: LIVE, waitMs: 3000 });
  const text = (document.getElementById('connBar') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();
  ok('a league id typed in the extension’s popup connects by itself, as before', /connected to/i.test(text) && text.includes(LIVE.name), text);
  eq(store.bridgeCalls.filter((c) => c === 'PROBE').length, 1, 'through one probe');
};

// --------------------------------------------------------------- menu-phone
//
// RULE 20, on the menu: "Add a league" on the phone's synced copy asks ESPN
// nothing. Here the slot is as the menu itself leaves it — no `source` — and
// the list has no note either, so the answer has to come from js/season.js's
// own `cloudSource()`.

SCENARIOS['menu-phone'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));
  const leagues = await import(moduleUrl('js/leagues.js'));

  const fake = makeFake();
  const seeded = await seedCloud(cloud, espn, season, fake);
  ok('a season was published', seeded.res.ok, seeded.res.reason);

  const map = installStorage();
  map.set('ff.connection', JSON.stringify({ leagueId: LEAGUE_ID, season: SEASON, teamId: 1 }));
  espn.configure({ leagueId: '', season: SEASON });   // the menu page has told js/espn.js nothing
  const calls = installFetch(LIVE.scale, LIVE.name);

  const res = await leagues.lookup('1241838');
  eq(calls.length, 0, 'ON THE SYNCED COPY, LOOKING A LEAGUE UP MAKES ZERO ESPN REQUESTS');
  ok('and says why instead', res.ok === false && /synced copy/i.test(res.reason || ''), JSON.stringify(res));

  // A league nobody has synced is not a synced copy, and may be asked for.
  map.set('ff.connection', JSON.stringify({ leagueId: '555', season: SEASON, teamId: null }));
  espn.configure({ leagueId: '555', season: SEASON });
  const live = await leagues.lookup('1241838');
  eq(JSON.stringify([live.ok, live.name, calls.length]), JSON.stringify([true, LIVE.name, 1]),
    'with no synced copy behind the open league, the same call reads ESPN once');
};

// =========================================================================
// ANOTHER GOOGLE ACCOUNT ("Anyone can sign up", Tim 2026-10-10)
// =========================================================================
//
// Not the owner: it keeps a copy of its own under users/{uid}/leagues/, the
// bar says nothing about whose league it is, and what this browser remembers
// having sent is kept per account — the owner may have used the same browser
// an hour ago.

const FRIEND = { uid: 'uid-friend', email: 'friend@example.com', name: 'A Friend' };
const MINE = `users/${FRIEND.uid}/`;

SCENARIOS['account-desktop'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const fake = makeFake({ user: FRIEND });
  cloud.configure({ transport: fake });

  // The owner synced this league from this browser an hour ago.
  const KEY = `${LEAGUE_ID}::${SEASON}`;
  const ownerRecord = { at: Date.now() - 60 * 60 * 1000, ok: true, wrote: 8, reason: '' };
  const ownerMarks = { 1: 'the-owners-mark-for-week-1', 2: 'the-owners-mark-for-week-2' };
  const { document, store } = await bootPage('index.html', {
    prefs: { 'home.source': 'live' },
    connection: { leagueId: LEAGUE_ID, season: SEASON, teamId: 1 },
    cloudRecord: { [KEY]: ownerRecord },
    extra: { 'ff.cloud.decisions': { [KEY]: ownerMarks } },
    withBridge: LIVE,
    waitMs: 5000,
  });

  const text = (document.getElementById('connBar') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();
  const season = fake.log.paths.filter((p) => !/\/decisions\//.test(p) && p !== `users/${FRIEND.uid}`);
  eq(season.length, 12, 'ANOTHER ACCOUNT’S DESKTOP PUBLISHES THE SEASON: not refused, and not held back by the owner’s sync an hour ago');
  eq(fake.log.paths.filter((p) => !p.startsWith(MINE) && p !== `users/${FRIEND.uid}`).join(' '), '',
    'every document under users/{uid}/ — nothing at leagues/');
  eq([...fake.docs.keys()].filter((p) => p.startsWith('leagues/')).length, 0, 'the owner’s paths hold nothing of it');
  ok('its league index is at users/{uid}/leagues/{id}/seasons/{season}', fake.docs.has(`${MINE}leagues/${LEAGUE_ID}/seasons/${SEASON}`),
    [...fake.docs.keys()].slice(-3).join(' '));
  eq(fake.log.paths.filter((p) => /\/decisions\//.test(p)).map((p) => p.replace(MINE, '')).join(),
    `leagues/${LEAGUE_ID}/seasons/${SEASON}/decisions/1,leagues/${LEAGUE_ID}/seasons/${SEASON}/decisions/2`,
    'the decided weeks went too — the owner’s marks for them did not stop this account’s');

  ok('the bar says it was sent', /sent to your phone/i.test(text) && /12 files/.test(text), text);
  ok('and nothing about whose league it is', !/belongs|not the account|not the one/i.test(text), text);

  const records = JSON.parse(store.saved.get('ff.cloud') || '{}');
  const marks = JSON.parse(store.saved.get('ff.cloud.decisions') || '{}');
  eq(Object.keys(records).sort().join(), [KEY, `${FRIEND.uid}/${KEY}`].sort().join(), 'this account’s sync record has a name of its own');
  eq(JSON.stringify(records[KEY]), JSON.stringify(ownerRecord), 'THE OWNER’S RECORD IS EXACTLY AS IT WAS');
  eq(JSON.stringify(marks[KEY]), JSON.stringify(ownerMarks), 'and so are the owner’s marks for the decided weeks');
  eq(Object.keys(marks[`${FRIEND.uid}/${KEY}`] || {}).join(), '1,2', 'this account’s marks are its own');

  const profile = JSON.parse(fake.docs.get(`users/${FRIEND.uid}`) || '{}');
  eq(Object.keys(profile).sort().join(), 'leagueId,season,teamId,updatedAt', 'its saved league is the same four fields, at users/{uid}');
};

// The phone of that account: nothing saved in the browser, signed in — and
// sign-in answers a beat after the page, as it really does. The owner has a
// copy of the very same league id in the same Firestore.
SCENARIOS['account-phone'] = async () => {
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));

  const desk = makeFake({ user: FRIEND });
  const seeded = await seedCloud(cloud, espn, season, desk);
  ok('the account’s desktop published a season', seeded.res.ok, seeded.res.reason);
  ok('(under its own account)', seeded.res.ok && [...desk.docs.keys()].every((p) => p.startsWith(MINE)), [...desk.docs.keys()].slice(0, 2).join(' '));

  const fake = makeFake({ user: FRIEND, arrivesAfter: 30 });
  for (const [p, raw] of desk.docs) {
    fake.docs.set(p, raw);
    // The owner's copy of the same league: same documents, another name.
    const theirs = p.replace(MINE, '');
    const doc = JSON.parse(raw);
    if (theirs === `leagues/${LEAGUE_ID}/seasons/${SEASON}`) doc.leagueName = 'The Owner League';
    fake.docs.set(theirs, JSON.stringify(doc));
  }
  fake.docs.set(`users/${FRIEND.uid}`, JSON.stringify({ leagueId: String(LEAGUE_ID), season: SEASON, teamId: 2, updatedAt: 'x' }));
  cloud.configure({ transport: fake });

  const { document, store } = await bootPage('index.html', {
    espnScale: LIVE,   // anything ESPN answers with would be wrong here
    waitMs: 3500,
  });

  const text = (document.getElementById('connBar') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim();
  ok('THE OTHER ACCOUNT’S PHONE CONNECTED TO ITS SYNCED COPY', /synced copy/i.test(text), text);
  ok('its own league', text.includes(CLOUD.name) && !text.includes('The Owner League'), text);
  ok('with no sentence about whose league it is', !/belongs|not the account|not the one/i.test(text), text);
  const conn = JSON.parse(store.saved.get('ff.connection') || '{}');
  eq([conn.leagueId, conn.teamId].join(), `${LEAGUE_ID},2`, 'the league and team came from its account');
  eq(store.espnCalls.length, 0, 'ESPN WAS NEVER ASKED');
  ok('the cloud was read', fake.log.readPaths.length > 1, fake.log.readPaths.join(' '));
  eq(fake.log.readPaths.filter((p) => !p.startsWith(MINE) && p !== `users/${FRIEND.uid}`).join(' '), '',
    'AND NOT ONE READ WENT TO leagues/ — though sign-in answered after the page had loaded');
  eq(fake.log.paths.join(' '), '', 'nothing was written');
};

// =========================================================================
// BOOTING A REAL PAGE
// =========================================================================
//
// The shims are the same set tests/test-pages-render.mjs installs and are
// needed for the same reason: linkedom implements the DOM this site uses but
// not <select>.value, the table conveniences, or a window location. See
// tests/README.md for the two gotchas.

async function bootPage(page, { prefs = null, connection = null, espnScale = null, cloudRecord = null, withBridge = null, waitMs = 2200, extra = null } = {}) {
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
  // Anything else a scenario needs in the browser beforehand (the main menu's list).
  for (const [k, v] of Object.entries(extra || {})) saved.set(k, typeof v === 'string' ? v : JSON.stringify(v));
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

// --------------------------------------------------------------- newerWins
//
// Tim, 2026-10-08: "there are some parts of the cite that are clearly not
// caught up, even though the top bar says it's synced."
//
// On the synced copy a week can be held twice: in this browser's own store and
// in the cloud. One week on its own used to take the STORE first, and a span of
// weeks the CLOUD first — so after a new sync, one page showed the new teams and
// the next the old ones, and the span path wrote an older sync over a newer
// stored week. Both now take whichever was read from ESPN later. And none of it
// may cost an ESPN request (rule 20).

SCENARIOS.newerWins = async () => {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));

  const HOUR = 60 * 60 * 1000;
  const fake = makeFake();
  const seeded = await seedCloud(cloud, espn, season, fake);
  ok('the desktop published a season', seeded.res.ok, seeded.res.reason);
  // The sync is an hour old.
  backdate(fake, { rosters: HOUR, wire: HOUR, schedule: HOUR });

  const WEEK = 3; // not played: the kind of week a trade changes
  const keyOf = () => [...map.keys()].find((k) => k.startsWith('ff.weeks.') && k.endsWith(`.${SEASON}.${WEEK}`));
  ok('the week is in this browser\'s store', !!keyOf(), [...map.keys()].join(','));
  /** This browser's own copy of the week: `ageMs` old, and recognisable. */
  const plant = (ageMs, marker) => {
    const e = JSON.parse(map.get(keyOf()));
    e.at = Date.now() - ageMs;
    // As on a real device, where the byes were read: this file's ESPN has no
    // bye table, and a week decoded without one asks for it again.
    e.byesKnown = true;
    e.teams[0].players[0].projected = marker;
    map.set(keyOf(), JSON.stringify(e));
    return e.at;
  };
  const held = () => JSON.parse(map.get(keyOf()));

  const espnCalls = installFetch(LIVE.scale, LIVE.name);

  // --- stored BEFORE the sync: the sync is the newer one --------------------
  plant(3 * HOUR, 777);
  const one = await season.fetchWeekRosters(WEEK);
  near(one.teams[0].players[0].projected, CLOUD.scale + 0 + 0.1 * WEEK,
    'ONE WEEK, stored before the sync: the newer synced copy is served');
  const span = await season.fetchWeeksRosters([WEEK]);
  near(span.get(WEEK)[0].players[0].projected, CLOUD.scale + 0 + 0.1 * WEEK,
    'and a SPAN of weeks agrees with it');

  // --- stored AFTER the sync: this browser's copy is the newer one ----------
  const at = plant(10 * 60 * 1000, 888);
  const span2 = await season.fetchWeeksRosters([WEEK]);
  eq(span2.get(WEEK)[0].players[0].projected, 888,
    'A SPAN, stored after the sync: this browser\'s newer copy is served');
  eq(held().teams[0].players[0].projected, 888, 'and the older sync was NOT written over it');
  eq(held().at, at, 'nor was its clock put back');
  const one2 = await season.fetchWeekRosters(WEEK);
  eq(one2.teams[0].players[0].projected, 888, 'and ONE WEEK on its own agrees');

  ok('ZERO ESPN calls through all of it', espnCalls.length === 0, espnCalls.join(' '));
};

// =========================================================================
// PLAYER VALUE: THE FROZEN LINES (docs/value-plan.md)
// =========================================================================
//
// Tim, 2026-10-09: "I only want a player's value to change if their actual
// future projections have changed for some reason, not because we're moving the
// baselines or whatnot. This means you'll have to pick specific baselines and
// stick to them throughout the season."
//
// The fixture above cannot make a baseline at all — its ESPN has no bye table
// and its wire has no kicker or defence — which is why every scenario before
// this one carries none. These two get an ESPN that has both.
//
// THE NUMBERS, BY HAND. Weeks left are 3 (not played) and the playoff weeks 4
// and 5. A rostered man `i` is projected `R + i + week/10`, so his average is
// `R + i + 0.4` — the two QBs at i = 0 are on pro team 1, whose bye is week 4,
// and theirs is over weeks 3 and 5: `R + 0.4` as well. Free agent `i` is
// projected `S - i` every week; with nine of them the wire holds one QB (i 0),
// three RBs (1, 2, 6), two WRs (3, 4), a TE (5), a D/ST (7) and a K (8).
// Four teams of QB RB RB WR WR TE FLEX D/ST K start, league-wide: the four QBs
// at i 11; RBs i 14 and 9 and — in the four flex spots — i 6; WRs i 13 and 10;
// TEs i 12; the D/STs (7) and the Ks (8). So, at R = S = 10:
//   QB  waiver 10            starter 21.4      RB  waiver (9+8+4)/3 = 7   starter 16.4
//   WR  waiver (7+6)/2 = 6.5 starter 20.4      TE  waiver 5               starter 22.4
//   K   waiver 2             starter 18.4      DST waiver 3               starter 17.4

const VALUE_KEY = `ff.value.${LEAGUE_ID}-${SEASON}`;
const BYES_PAYLOAD = {
  settings: { proTeams: Array.from({ length: 15 }, (_, i) => ({ id: i + 1, byeWeek: i === 0 ? 4 : 9 })) },
};

/** A browser's localStorage, as a Map the test can look inside. */
function installStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  return map;
}

/**
 * ESPN with a bye table and a wire that has every position on it.
 *
 * `wireScale` moves the free agents and nothing else — "the free agents have
 * changed since". `byes: false` and `wireFails` are the two half-readings.
 */
function installValueFetch({ scale, name, wireScale = scale, byes = true, wireFails = null }) {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const week = Number((u.match(/scoringPeriodId=(\d+)/) || [])[1] || 0);
    if (/kona_player_info/.test(u) && wireFails === week) {
      return { ok: false, status: 500, async json() { return {}; } };
    }
    const body = /proTeamSchedules_wl/.test(u)
      ? (byes ? BYES_PAYLOAD : matchupPayload(scale, name))
      : /kona_player_info/.test(u)
        ? wirePayload(week || 1, wireScale, 9)
        : week || /mRoster/.test(u)
          ? rosterPayload(week || 1, scale, name)
          : matchupPayload(scale, name);
    return { ok: true, status: 200, async json() { return body; } };
  };
  return calls;
}
const wireReads = (calls) => calls.filter((u) => /kona_player_info/.test(u)).length;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lineIs = (base, pos, want, msg) => ok(msg, !!base && same(base.lines[pos], want),
  `got ${JSON.stringify(base && base.lines && base.lines[pos])}, want ${JSON.stringify(want)}`);

// -------------------------------------------------------------- value-sync
//
// The computer makes the lines, the sync carries them on the schedule, the
// phone reads them with no request — and a later sync never replaces them.

SCENARIOS['value-sync'] = async () => {
  const map = installStorage();
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));
  const fake = makeFake();
  espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
  cloud.configure({ transport: fake });
  /** What the cloud's schedule holds now, read the way a phone reads it. */
  const inCloud = async () => {
    const res = await cloud.readDown(LEAGUE_ID, SEASON, { shapes: ['schedule'] });
    return res && res.ok && res.schedule ? res.schedule.valueBase : undefined;
  };
  const sync = async () => {
    const payload = await season.buildCloudPayload();
    const res = await cloud.syncUp(LEAGUE_ID, SEASON, payload, {});
    return { payload, res };
  };

  // --- the first sync makes them ---------------------------------------------
  installValueFetch({ scale: CLOUD.scale, name: CLOUD.name });
  const first = await sync();
  ok('the desktop published a season', first.res.ok, first.res.reason);
  const base = first.payload.schedule.valueBase;
  ok('the sync\'s schedule carries valueBase', !!base && base.v === 1 && !!base.lines, JSON.stringify(base));
  eq(base && base.week, 3, 'set in the first week left');
  lineIs(base, 'QB', { waiver: 10, starter: 21.4, agents: 1, starters: 4 }, 'QB: the one free-agent QB, and the worst of the four starting QBs (the bye week left out of both)');
  lineIs(base, 'RB', { waiver: 7, starter: 16.4, agents: 3, starters: 12 }, 'RB: the top three free agents, and the worst starter counting the flex spots');
  lineIs(base, 'WR', { waiver: 6.5, starter: 20.4, agents: 2, starters: 8 }, 'WR');
  lineIs(base, 'TE', { waiver: 5, starter: 22.4, agents: 1, starters: 4 }, 'TE');
  lineIs(base, 'K', { waiver: 2, starter: 18.4, agents: 1, starters: 4 }, 'K');
  lineIs(base, 'DST', { waiver: 3, starter: 17.4, agents: 1, starters: 4 }, 'D/ST');
  ok('and this browser kept them', same(JSON.parse(map.get(VALUE_KEY) || 'null'), base), map.get(VALUE_KEY));
  ok('they are in the cloud\'s schedule document — no document of their own',
    same(await inCloud(), base) && ![...fake.docs.keys()].some((p) => /value/i.test(p)),
    [...fake.docs.keys()].join(' '));

  // --- valueBase round-trips to the phone ------------------------------------
  // A phone: nothing kept locally, and an ESPN that would answer differently.
  map.clear();
  season.forgetCloud();
  const phoneCalls = installValueFetch({ scale: LIVE.scale, name: LIVE.name, wireScale: 80 });
  const onPhone = await season.fetchValueBase();
  ok('valueBase round-trips to the phone', same(onPhone, base), JSON.stringify(onPhone));
  eq(phoneCalls.length, 0, 'fetchValueBase on the synced copy made ZERO ESPN requests');
  // What a page reads for itself anyway; the values then cost nothing on top.
  await season.fetchSchedule();
  await season.fetchWeeksRosters([3, 4, 5]);
  const pageReads = fake.log.reads;
  const vals = await season.fetchPlayerValues();
  eq(phoneCalls.length, 0, 'and so did fetchPlayerValues');
  ok('over the weeks left', same(vals.weeks, [3, 4, 5]), JSON.stringify(vals.weeks));
  ok('with the same lines', same(vals.base, base));
  eq(vals.byId.size, 60, 'everybody on a squad has an entry');
  eq(vals.byId.get(111).value, 5.7, 'a starting QB at the starter line: half of 21.4 − 10');
  eq(vals.byId.get(100).value, 0.2, 'the backup QB (bye week 4 left out of his average): half of 10.4 − 10');
  eq(vals.byId.get(114).value, 12.7, 'the best RB: half of 16.4 − 7, plus all of 24.4 − 16.4');
  eq(vals.byId.get(114).position, 'RB', 'with his position');
  near(vals.byId.get(114).avg, 24.4, 'and his average over the weeks left', 1e-9);
  eq(vals.lookup('114'), 12.7, 'lookup(playerId) is what the player card asks');
  eq(vals.lookup(999999), null, 'and null for a man nobody holds');
  eq(fake.log.reads, pageReads, 'and not one document read beyond the ones the page had already made');
  eq(map.has(VALUE_KEY), false, 'the phone keeps no copy of its own: the cloud\'s is the one');
  ok('the sample league\'s are made in memory beside it, and never kept',
    !!(await season.fetchValueBase({ demo: true })) && !same(await season.fetchValueBase({ demo: true }), base) &&
    !map.has(VALUE_KEY) && phoneCalls.length === 0);

  // --- a second sync does not replace the first baseline ---------------------
  // The free agents have changed (every one is 20 points better) AND this
  // browser has lost its copy. The cloud's are adopted and sent back.
  // (A later sitting: nothing this page had read from ESPN is still held.)
  map.clear();
  season.forgetCloud();
  espn.clearReadCache();
  installValueFetch({ scale: CLOUD.scale, name: CLOUD.name, wireScale: 30 });
  const second = await sync();
  ok('the second sync went up', second.res.ok, second.res.reason);
  ok('a second sync does not replace the first baseline',
    same(second.payload.schedule.valueBase, base), JSON.stringify(second.payload.schedule.valueBase));
  ok('nor is it replaced in the cloud', same(await inCloud(), base), JSON.stringify(await inCloud()));
  ok('and the cleared browser has the first one again', same(JSON.parse(map.get(VALUE_KEY) || 'null'), base), map.get(VALUE_KEY));

  // This browser holding DIFFERENT lines changes nothing: the cloud's win.
  const other = JSON.parse(JSON.stringify(base));
  other.lines.QB.waiver = 99;
  other.lines.QB.starter = 99;
  map.set(VALUE_KEY, JSON.stringify(other));
  const third = await sync();
  ok('a browser with lines of its own still sends the cloud\'s', same(third.payload.schedule.valueBase, base),
    JSON.stringify(third.payload.schedule.valueBase.lines.QB));
  ok('and takes the cloud\'s as its own', same(JSON.parse(map.get(VALUE_KEY)), base), map.get(VALUE_KEY));

  // NOT VACUOUS: with none in the cloud and none here, the same sync makes NEW
  // lines off the changed wire — so the three syncs above really were holding.
  cloud.configure({ transport: makeFake() });   // a cloud this league was never synced to
  map.clear();
  const fresh = await sync();
  lineIs(fresh.payload.schedule.valueBase, 'QB', { waiver: 30, starter: 30, agents: 1, starters: 4 },
    '(with nothing to hold to, the changed wire WOULD have moved the lines: QB waiver 30, the starter never below it)');
};

// ------------------------------------------------------------ value-laptop
//
// The computer on its own, no sync involved: the lines are made on the first
// ask, kept in this browser, and never made again.

SCENARIOS['value-laptop'] = async () => {
  const map = installStorage();
  const cloud = await import(moduleUrl('js/cloud.js'));
  const espn = await import(moduleUrl('js/espn.js'));
  const season = await import(moduleUrl('js/season.js'));
  cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
  espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
  // A new page load: everything this module remembers is let go of.
  const reload = () => { season.forgetCloud(); espn.clearReadCache(); };

  // --- half a reading makes nothing, and keeps nothing -----------------------
  installValueFetch({ scale: LIVE.scale, name: LIVE.name, byes: false });
  eq(await season.fetchValueBase(), null, 'bye weeks unknown: no lines');
  eq(map.has(VALUE_KEY), false, '…and nothing kept');
  reload();
  installValueFetch({ scale: LIVE.scale, name: LIVE.name, wireFails: 4 });
  eq(await season.fetchValueBase(), null, 'one week of the wire refused: no lines');
  eq(map.has(VALUE_KEY), false, '…and nothing kept, so the next load tries again');
  reload();

  // --- the first whole reading makes them ------------------------------------
  const calls = installValueFetch({ scale: LIVE.scale, name: LIVE.name });
  const first = await season.fetchValueBase();
  lineIs(first, 'QB', { waiver: 50, starter: 61.4, agents: 1, starters: 4 }, 'made from ESPN: QB');
  lineIs(first, 'RB', { waiver: 47, starter: 56.4, agents: 3, starters: 12 }, 'RB');
  lineIs(first, 'K', { waiver: 42, starter: 58.4, agents: 1, starters: 4 }, 'K');
  eq(wireReads(calls), 3, 'one wire request for each week left');
  ok('kept in this browser under the league and season', same(JSON.parse(map.get(VALUE_KEY) || 'null'), first), [...map.keys()].join(' '));
  ok('a second ask on the same page is the same answer', (await season.fetchValueBase()) === first);
  eq(wireReads(calls), 3, 'for no further request');
  eq((await season.fetchPlayerValues()).byId.get(111).value, 5.7, 'and a starting QB at the starter line is worth half of 61.4 − 50');

  // --- the free agents change; the lines do not ------------------------------
  reload();
  const later = installValueFetch({ scale: LIVE.scale, name: LIVE.name, wireScale: 80 });
  const second = await season.fetchValueBase();
  ok('a second fetchValueBase after the free agents changed returns the same lines',
    same(second, first), JSON.stringify(second && second.lines.QB));
  eq(wireReads(later), 0, 'without reading the wire at all');
  eq((await season.fetchPlayerValues()).byId.get(111).value, 5.7, 'so nobody\'s value moved');

  // NOT VACUOUS: with the kept copy gone, the same ask makes different lines.
  reload();
  map.delete(VALUE_KEY);
  const remade = await season.fetchValueBase();
  lineIs(remade, 'QB', { waiver: 80, starter: 80, agents: 1, starters: 4 },
    '(with nothing kept, the changed wire WOULD have moved them)');

  // --- a browser that cannot keep them hands none out ------------------------
  reload();
  map.delete(VALUE_KEY);
  const set = globalThis.localStorage.setItem;
  globalThis.localStorage.setItem = (k, v) => {
    if (k === VALUE_KEY) throw new Error('quota');
    set(k, v);
  };
  eq(await season.fetchValueBase(), null, 'lines that cannot be kept are not handed out (they would differ next load)');
  globalThis.localStorage.setItem = set;

  // --- the sample league ------------------------------------------------------
  const before = installValueFetch({ scale: LIVE.scale, name: LIVE.name });
  map.delete(VALUE_KEY);
  const demo = await season.fetchValueBase({ demo: true });
  ok('the sample league has lines at every position', !!demo && ['QB', 'RB', 'WR', 'TE', 'K', 'DST'].every((p) => demo.lines[p]), JSON.stringify(demo));
  const demoVals = await season.fetchPlayerValues({ demo: true });
  ok('and values for its men', demoVals.byId.size >= 150 && [...demoVals.byId.values()].some((r) => r.value > 0), String(demoVals.byId.size));
  eq(before.length, 0, 'for no request');
  eq(map.has(VALUE_KEY), false, 'and they are never kept');
};

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
