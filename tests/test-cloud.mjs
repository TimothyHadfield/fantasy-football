// The phone bridge's storage: js/cloud.js.
//
//   node test-cloud.mjs
//
// This module exists because no phone browser can install the bridge
// extension, so the only way Tim's private league reaches his iPhone is for
// the desktop to publish it and the phone to read it back. Everything below is
// therefore about ONE property, and it is the same property the time machine's
// suite is about: WHAT COMES BACK OUT HAS TO BE WHAT WENT IN — through a JSON
// boundary, through Firestore's type rules, and days later on a different
// device.
//
// Two things shape how this suite is written.
//
// 1. THE FIREBASE SDK IS NOT REACHABLE FROM HERE, and should not be: a suite
//    that needed the network would be a suite that fails on a train. So
//    `js/cloud.js` keeps every piece of Firebase knowledge behind six small
//    transport methods, and this file injects a fake one. The fake does not
//    merely hold objects in a Map — it JSON round-trips every document and
//    REJECTS anything Firestore would reject (a nested array, an `undefined`,
//    an oversized document). So "it worked against the fake" is a real claim
//    about what Firestore will accept, not a claim about our own Map.
//
// 2. THE SIZES ARE MEASURED, NOT ASSUMED. PROGRESS.md records a week of
//    rosters as "about a megabyte", which is true of ESPN's RAW payload and
//    not of the decoded shapes that actually get synced. Guessing either way
//    would be worthless, so the fixture below is built at genuinely realistic
//    size — ten squads of sixteen, real-length names, ESPN's own
//    full-precision floats, a hundred and fifty men on the wire — and the
//    suite prints and asserts what it actually costs.

import * as cloud from '../js/cloud.js';

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`);
};
const eq = (a, b, msg) =>
  ok(msg, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/**
 * Deep equality that ignores key ORDER.
 *
 * Needed rather than a stringify comparison because `readDown` rebuilds a team
 * object and cannot be expected to reproduce the order `season.js` happened to
 * insert its keys in. The VALUES are what the pages read; the order is not.
 */
function deepEq(a, b, path = '') {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${path || '<root>'}: ${typeof a} vs ${typeof b}`;
  if (a === null || b === null) return `${path || '<root>'}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (typeof a === 'number') {
    return Object.is(a, b) ? null : `${path}: ${a} vs ${b}`;
  }
  if (typeof a !== 'object') return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs not`;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = deepEq(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.join(',') !== kb.join(',')) return `${path}: keys {${ka}} vs {${kb}}`;
  for (const k of ka) {
    const d = deepEq(a[k], b[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return null;
}
const same = (a, b, msg) => {
  const d = deepEq(a, b);
  ok(msg, d === null, d || '');
};

// =========================================================================
// A FAKE FIRESTORE THAT IS AS STRICT AS THE REAL ONE
// =========================================================================

/** Firestore's document cap. Everything here has to live under it. */
const ONE_MIB = 1024 * 1024;

/**
 * Reject what Firestore rejects.
 *
 * Only two of these have ever caught anything in practice, but both of them
 * would have been discovered in Tim's browser rather than here, and one of
 * them (nested arrays) is the reason `cloud.js` stores its bodies as chunked
 * JSON strings at all. Encoding this rule into the fake is what keeps that
 * decision honest instead of merely asserted in a comment.
 */
function assertFirestoreLegal(value, path = '', inArray = false) {
  if (value === undefined) throw new Error(`undefined at ${path} (Firestore rejects undefined)`);
  if (value === null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    if (inArray) throw new Error(`nested array at ${path} (Firestore rejects arrays inside arrays)`);
    value.forEach((v, i) => assertFirestoreLegal(v, `${path}[${i}]`, true));
    return;
  }
  if (typeof value !== 'object') throw new Error(`unstorable ${typeof value} at ${path}`);
  if (value instanceof Map || value instanceof Set) throw new Error(`a ${value.constructor.name} at ${path} is not a Firestore value`);
  for (const [k, v] of Object.entries(value)) {
    // A map inside an array may itself hold arrays, so `inArray` stops here.
    assertFirestoreLegal(v, path ? `${path}.${k}` : k, false);
  }
}

/**
 * The fake transport.
 *
 * `docs` is keyed by path. Every write is stringified on the way in and parsed
 * on the way out, so nothing survives by shared reference — which is exactly
 * the hazard a Map-backed fake would hide, and exactly what a real network
 * hop does.
 */
function makeFake({
  user = { uid: 'uid-tim', email: 'sharedhadfield@gmail.com', name: 'Timothy' },
  failWrites = null,
  failReads = null,
} = {}) {
  const docs = new Map();
  const log = { reads: 0, writes: 0, paths: [] };
  return {
    docs,
    log,
    async signIn() { return user; },
    async signOut() { /* nothing to do */ },
    currentUser() { return user; },
    onAuth(cb) { cb(user); return () => {}; },
    async getDoc(path) {
      log.reads++;
      if (failReads) throw new Error(failReads);
      const raw = docs.get(path);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async setDoc(path, data) {
      log.writes++;
      log.paths.push(path);
      if (failWrites) throw new Error(failWrites);
      assertFirestoreLegal(data, '');
      const raw = JSON.stringify(data);
      // Firestore measures a little differently (field names, type tags), but
      // a JSON byte count is well inside the right order of magnitude and is
      // the number this project can actually check.
      const bytes = Buffer.byteLength(raw, 'utf8');
      if (bytes > ONE_MIB) throw new Error(`document ${path} is ${bytes} bytes, over the 1 MiB cap`);
      docs.set(path, raw);
    },
  };
}

// =========================================================================
// A FIXTURE AT GENUINELY REALISTIC SIZE
// =========================================================================
//
// Ten squads of sixteen, thirteen weeks, a hundred and fifty free agents a
// week. Names are drawn from real-length American first/last names because a
// fixture full of "Player 7" would understate the payload by a third. Numbers
// carry ESPN's own float noise — `14.298400000000001` is the sort of thing it
// really sends — because that noise is roughly a fifth of every roster
// document and rounding it away is exactly the shortcut this test exists to
// stop anyone taking.

const FIRST = [
  'Christian', 'Jonathan', 'Amon-Ra', 'DeVonta', 'Jahmyr', 'Bijan', 'Breece', 'Kenneth',
  'Rhamondre', 'Alexander', 'Marquise', 'Christopher', 'Brandon', 'Nathaniel', 'Sebastian',
  'Demarcus', 'Zachariah', 'Montgomery', 'Cornelius', 'Theodore',
];
const LAST = [
  'McCaffrey', 'Jefferson', 'St. Brown', 'Kincaid', 'Achane', 'Robinson', 'Etienne',
  'Higgins', 'Stevenson', 'Pittman Jr.', 'Brown', 'Olave', 'Nacua', 'Waddle', 'Hockenson',
  'Lamb', 'Hollywood-Smith', 'Vanderbilt', 'Worthington', 'Kirkpatrick',
];
const PRO = ['SF', 'MIN', 'DET', 'BUF', 'MIA', 'ATL', 'NYJ', 'NE', 'BAL', 'LAR', 'NO', 'CIN', 'PHI', 'DAL', 'KC', 'TB'];
const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const SLOT_FOR = { QB: 0, RB: 2, WR: 4, TE: 6, DST: 16, K: 17 };
const INJURY = ['ACTIVE', 'ACTIVE', 'ACTIVE', 'ACTIVE', 'QUESTIONABLE', 'OUT', 'DOUBTFUL', 'INJURY_RESERVE'];

/** Deterministic, so a size printed today is the size printed in December. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** ESPN's floats are not tidy, and the untidiness is real bytes. */
function messy(r, lo, hi) {
  return lo + r() * (hi - lo) + r() * 1e-13;
}

const ROSTER_SHAPE = ['QB', 'QB', 'RB', 'RB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE', 'K', 'DST'];
const STARTER_SHAPE = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB', 'DST', 'K']; // the 7th is the FLEX

function makePlayer(r, id, position, started, lineupSlotId, slotLabel) {
  return {
    playerId: id,
    name: `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`,
    position,
    proTeam: PRO[Math.floor(r() * PRO.length)],
    proTeamId: 1 + Math.floor(r() * 34),
    lineupSlotId,
    slot: slotLabel,
    started,
    projected: messy(r, 2, 26),
    actual: r() < 0.5 ? null : messy(r, 0, 34),
    seasonProjected: messy(r, 40, 320),
    injuryStatus: INJURY[Math.floor(r() * INJURY.length)],
    percentOwned: messy(r, 0, 100),
  };
}

/** The exact shape `season.js`'s `fetchWeekRosters` hands back for one week. */
function makeWeekRosters(week) {
  const r = rng(1000 + week);
  const teams = [];
  for (let t = 1; t <= 10; t++) {
    const players = [];
    let nextId = 3000000 + t * 1000 + week * 40;

    // Nine starters, in the slot order ESPN returns them.
    STARTER_SHAPE.forEach((pos, i) => {
      const flex = i === 6;
      players.push(makePlayer(r, nextId++, pos, true, flex ? 23 : SLOT_FOR[pos], flex ? 'FLEX' : (pos === 'DST' ? 'D/ST' : pos)));
    });
    // Seven on the bench, whatever is left of the sixteen-man roster.
    const benchPositions = ROSTER_SHAPE.slice(0, 7);
    benchPositions.forEach((pos) => {
      players.push(makePlayer(r, nextId++, pos, false, 20, 'BE'));
    });

    const starters = players.filter((p) => p.started);
    // The same comparator `season.js` uses, so the fixture is the real shape
    // rather than a convenient one.
    const bench = players
      .filter((p) => !p.started)
      .sort((a, b) => (b.projected ?? -Infinity) - (a.projected ?? -Infinity));

    const total = (arr, key) => {
      const vals = arr.map((p) => p[key]).filter((v) => typeof v === 'number');
      if (!vals.length) return null;
      return Math.round(vals.reduce((a, v) => a + v, 0) * 10) / 10;
    };

    teams.push({
      id: t,
      name: `${FIRST[t]} ${LAST[t]}`,
      teamName: `The ${LAST[(t + 5) % LAST.length]} ${['Wreckers', 'Regulators', 'Juggernauts', 'Blindsiders'][t % 4]}`,
      abbrev: `T${t}`,
      players,
      starters,
      bench,
      projectedTotal: total(starters, 'projected'),
      actualTotal: total(starters, 'actual'),
      benchActualTotal: total(bench, 'actual'),
      seasonProjectedTotal: total(starters, 'seasonProjected'),
    });
  }
  return teams;
}

/** The exact shape `espn.js`'s `parseFreeAgent` hands back, 150 of them. */
function makeWire(week) {
  const r = rng(9000 + week);
  const out = [];
  for (let i = 0; i < 150; i++) {
    const position = POS[Math.floor(r() * POS.length)];
    out.push({
      playerId: 4100000 + week * 500 + i,
      name: `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`,
      position,
      proTeam: PRO[Math.floor(r() * PRO.length)],
      proTeamId: 1 + Math.floor(r() * 34),
      injuryStatus: INJURY[Math.floor(r() * INJURY.length)],
      percentOwned: messy(r, 0, 100),
      seasonProjected: r() < 0.1 ? null : messy(r, 10, 260),
      projected: r() < 0.1 ? null : messy(r, 0, 24),
    });
  }
  return out;
}

/** The exact shape `season.js`'s `fetchSchedule` hands back: 13 weeks x 5. */
function makeSchedule() {
  const r = rng(77);
  const games = [];
  for (let week = 1; week <= 13; week++) {
    for (let g = 0; g < 5; g++) {
      const homeId = (g * 2) + 1;
      const awayId = (g * 2) + 2;
      const played = week <= 2;
      const homeScore = played ? Math.round(messy(r, 70, 160) * 100) / 100 : null;
      const awayScore = played ? Math.round(messy(r, 70, 160) * 100) / 100 : null;
      games.push({
        week,
        homeId,
        homeName: `${FIRST[homeId]} ${LAST[homeId]}`,
        homeScore,
        awayId,
        awayName: `${FIRST[awayId]} ${LAST[awayId]}`,
        awayScore,
        played,
        margin: played ? Math.round((homeScore - awayScore) * 10) / 10 : null,
        winner: played ? (homeScore > awayScore ? 'home' : 'away') : null,
      });
    }
  }
  const byWeek = new Map();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week).push(g);
  }
  return {
    leagueName: 'The Sunday Regulars',
    teams: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `${FIRST[i + 1]} ${LAST[i + 1]}` })),
    weeks: [...byWeek.keys()].sort((a, b) => a - b),
    byWeek,
    games,
  };
}

const WEEKS = Array.from({ length: 13 }, (_, i) => i + 1);

function makePayload() {
  const rosters = new Map();
  const wire = new Map();
  for (const w of WEEKS) {
    rosters.set(w, makeWeekRosters(w));
    wire.set(w, makeWire(w));
  }
  const schedule = makeSchedule();
  return {
    leagueName: 'The Sunday Regulars',
    teams: schedule.teams.map((t, i) => ({ ...t, teamName: `Squad ${i + 1}`, abbrev: `T${i + 1}` })),
    byes: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [i + 1, 5 + (i % 9)])),
    schedule,
    rosters,
    wire,
    isDemo: false,
  };
}

const LEAGUE = '476225250';
const SEASON = 2026;

// =========================================================================
// 1. SIZE — measured, not assumed
// =========================================================================
//
// The brief that commissioned this module said a week of rosters was about a
// megabyte and that one-document-per-week would therefore fail. That figure is
// about ESPN's raw payload. These are the decoded shapes, and the whole design
// turns on the difference, so it is checked here before anything else.

const payload = makePayload();

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const bytesOf = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');

const weekRosterBytes = bytesOf({ week: 7, teams: payload.rosters.get(7) });
const weekWireBytes = bytesOf({ week: 7, players: payload.wire.get(7) });
const { byWeek, ...scheduleForWire } = payload.schedule;
const scheduleBytes = bytesOf(scheduleForWire);

console.log('Measured against the realistic fixture (10 x 16, 150 on the wire):');
console.log(`  one week of rosters, as fetchWeekRosters returns it ... ${kb(weekRosterBytes)}`);
console.log(`  one week of the wire, 150 men ......................... ${kb(weekWireBytes)}`);
console.log(`  the full 13-week schedule, 65 games ................... ${kb(scheduleBytes)}`);
console.log(`  (the 1 MiB Firestore document cap is ${kb(ONE_MIB)})`);

ok(
  `a realistic week of rosters (${kb(weekRosterBytes)}) is under Firestore's 1 MiB document cap`,
  weekRosterBytes < ONE_MIB,
  `${weekRosterBytes} bytes`
);
ok(
  `a realistic week of rosters has real headroom, not a whisker (${kb(weekRosterBytes)})`,
  weekRosterBytes < ONE_MIB / 4,
  `${weekRosterBytes} bytes — if this fires, the per-week document needs sharding after all`
);
ok(
  `a realistic week of the wire (${kb(weekWireBytes)}) is under the cap with headroom`,
  weekWireBytes < ONE_MIB / 4,
  `${weekWireBytes} bytes`
);
ok(
  'the fixture is not accidentally tiny — a week of rosters is at least 25 KB',
  weekRosterBytes > 25 * 1024,
  `${weekRosterBytes} bytes; a fixture that understates the payload proves nothing`
);
ok(
  'the fixture carries 160 men a week, which is what a 10-team league holds',
  payload.rosters.get(7).reduce((n, t) => n + t.players.length, 0) === 160
);

// =========================================================================
// 2. THE ROUND TRIP
// =========================================================================

const fake = makeFake();
cloud.configure({ transport: fake, ownerUid: '' });

const before = Date.now();
const up = await cloud.syncUp(LEAGUE, SEASON, payload);

eq(up.ok, true, 'syncUp succeeds against a strict fake Firestore');
eq(up.reason, '', 'a successful sync reports no reason');
ok('syncUp writes something', up.wrote > 0);

// 1 meta + 1 schedule + 13 rosters + 13 wire
eq(up.wrote, 28, 'a full 13-week sync writes exactly 28 documents');

const stored = (p) => Buffer.byteLength(fake.docs.get(`leagues/${LEAGUE}/seasons/${SEASON}/${p}`), 'utf8');
const storedWeek = stored('rosters/7');
console.log('');
console.log('Measured as actually STORED, after the duplicated starters/bench views:');
console.log(`  one week of rosters, as the document Firestore holds ... ${kb(storedWeek)}`);
console.log(`  one week of the wire, as the document Firestore holds .. ${kb(stored('wire/7'))}`);
console.log(`  the schedule, as the document Firestore holds .......... ${kb(stored('parts/schedule'))}`);
console.log(`  the league index (what cloudStatus reads) .............. ${kb(Buffer.byteLength(fake.docs.get(`leagues/${LEAGUE}/seasons/${SEASON}`), 'utf8'))}`);
console.log(`  a full sync: ${up.wrote} documents, ${kb(up.bytes)} of payload in total`);
console.log(`  the largest single document is ${kb(up.largestDoc)}, ${(ONE_MIB / up.largestDoc).toFixed(0)}x under the cap`);
console.log('');

ok(
  `stripping the duplicated views really does pay (${kb(weekRosterBytes)} -> ${kb(storedWeek)})`,
  storedWeek < weekRosterBytes * 0.7,
  `${storedWeek} vs ${weekRosterBytes}`
);

ok(
  `the largest document written (${kb(up.largestDoc)}) is far under the cap`,
  up.largestDoc < ONE_MIB / 4,
  `${up.largestDoc} bytes`
);

// The meta document is written LAST, so a half-finished sync never promises a
// week whose document was not written.
eq(
  fake.log.paths[fake.log.paths.length - 1],
  `leagues/${LEAGUE}/seasons/${SEASON}`,
  'the league index is the LAST document written, never the first'
);

const down = await cloud.readDown(LEAGUE, SEASON);
eq(down.ok, true, 'readDown succeeds');
eq(down.found, true, 'readDown finds the league that was just synced');
same(down.missing, [], 'nothing is missing after a full sync');

// --- the rosters, week by week, deep-equal including starters and bench ---

eq(down.rosters.size, 13, 'every synced week comes back');
ok('readDown returns rosters as a Map, the shape fetchWeeksRosters returns', down.rosters instanceof Map);

for (const w of WEEKS) {
  same(down.rosters.get(w), payload.rosters.get(w), `week ${w} rosters round-trip unchanged`);
}

// Spelled out for one week, because "deep-equal" is only as good as the reader's
// belief in the helper, and these are the fields the pages actually read.
const t7 = down.rosters.get(7)[3];
const o7 = payload.rosters.get(7)[3];
eq(t7.players.length, 16, 'a squad still has sixteen men');
eq(t7.starters.length, 9, 'a squad still has nine starters');
eq(t7.bench.length, 7, 'a squad still has seven on the bench');
same(t7.starters.map((p) => p.playerId), o7.starters.map((p) => p.playerId), 'the starters come back in the same order');
same(t7.bench.map((p) => p.playerId), o7.bench.map((p) => p.playerId), 'the bench comes back in its best-projection-first order');
eq(t7.projectedTotal, o7.projectedTotal, 'projectedTotal survives');
eq(t7.actualTotal, o7.actualTotal, 'actualTotal survives, null and all');
eq(t7.benchActualTotal, o7.benchActualTotal, 'benchActualTotal survives');
eq(t7.seasonProjectedTotal, o7.seasonProjectedTotal, 'seasonProjectedTotal survives');
eq(t7.teamName, o7.teamName, 'the joke name survives alongside the person');

// Full float precision, NOT rounded. A rounded projection is a different
// number from the one the desktop was looking at, and nine of them add up.
const anyStarter = down.rosters.get(3)[0].starters[0];
const wasStarter = payload.rosters.get(3)[0].starters[0];
eq(anyStarter.projected, wasStarter.projected, 'a projection survives at full precision, unrounded');
eq(anyStarter.seasonProjected, wasStarter.seasonProjected, 'a season projection survives at full precision');
ok(
  'the fixture really does carry float noise, so that assertion means something',
  String(wasStarter.projected).length > 8,
  String(wasStarter.projected)
);

// `null` is not `0`, and this project has been bitten by that before: before
// kickoff every actual is null, and summing nulls as zero reports a real-
// looking 0.0 for a team that has not played.
const nulls = payload.rosters.get(5).flatMap((t) => t.players).filter((p) => p.actual === null).length;
ok('the fixture contains nulls to round-trip', nulls > 0, `${nulls}`);
const backNulls = down.rosters.get(5).flatMap((t) => t.players).filter((p) => p.actual === null).length;
eq(backNulls, nulls, 'a null actual comes back as null, never as 0');

// --- the wire ---

eq(down.wire.size, 13, 'every synced week of the wire comes back');
for (const w of WEEKS) {
  same(down.wire.get(w), payload.wire.get(w), `week ${w} of the wire round-trips unchanged`);
}
eq(down.wire.get(1).length, 150, 'a full wire is still 150 men');

// --- the schedule ---

same(down.schedule.games, payload.schedule.games, 'the schedule games round-trip unchanged');
same(down.schedule.weeks, payload.schedule.weeks, 'the schedule weeks round-trip unchanged');
ok('readDown rebuilds byWeek as a Map, the shape fetchSchedule returns', down.schedule.byWeek instanceof Map);
eq(down.schedule.byWeek.size, 13, 'byWeek is rebuilt for every week');
same(
  down.schedule.byWeek.get(4),
  payload.schedule.byWeek.get(4),
  'a rebuilt byWeek week matches the one fetchSchedule built'
);

// --- the league itself ---

eq(down.leagueName, payload.leagueName, 'the league name survives');
same(down.teams, payload.teams, 'the team list survives');
same(down.byes, payload.byes, 'the bye weeks survive');

// =========================================================================
// 3. WHAT A PAGE LOAD COSTS
// =========================================================================
//
// Firestore bills per DOCUMENT read. Free tier is 50,000 a day. The design
// claim is "tens of documents, not thousands", and a claim in a comment is
// worth nothing next to a counter.

fake.log.reads = 0;
await cloud.readDown(LEAGUE, SEASON);
eq(fake.log.reads, 28, 'the most expensive page load there is — everything, 13 weeks — costs 28 document reads');

fake.log.reads = 0;
await cloud.readDown(LEAGUE, SEASON, { shapes: ['rosters', 'schedule'] });
eq(fake.log.reads, 15, 'a page that does not need the wire costs 15 reads, because the wire is a separate document');

fake.log.reads = 0;
const short = await cloud.readDown(LEAGUE, SEASON, { weeks: [1, 2, 3] });
eq(fake.log.reads, 8, 'a three-week span costs 8 reads: index, schedule, three rosters, three wire');
eq(short.rosters.size, 3, 'a narrowed span returns only the weeks asked for');
same([...short.rosters.keys()], [1, 2, 3], 'and they are the right weeks');

fake.log.reads = 0;
await cloud.cloudStatus(LEAGUE, SEASON);
eq(fake.log.reads, 1, 'cloudStatus costs exactly ONE read — it is what a page asks before deciding to read at all');

// =========================================================================
// 4. THE SYNC TIMESTAMP, AND STALENESS PER SHAPE
// =========================================================================

const after = Date.now();
const stamped = Date.parse(up.syncedAt);
ok('syncUp reports when it ran', Number.isFinite(stamped));
ok('and the timestamp is actually now', stamped >= before - 1000 && stamped <= after + 1000, up.syncedAt);
eq(down.syncedAt, up.syncedAt, 'the sync timestamp survives the round trip');

const status = await cloud.cloudStatus(LEAGUE, SEASON);
eq(status.found, true, 'cloudStatus finds the synced league');
eq(status.syncedAt, up.syncedAt, 'cloudStatus reports the same timestamp');
eq(status.leagueName, payload.leagueName, 'cloudStatus reports the league name without reading any week');
eq(status.teamCount, 10, 'cloudStatus reports how many squads are up there');
same(status.weeks.rosters, WEEKS, 'cloudStatus lists which weeks of rosters exist');
same(status.weeks.wire, WEEKS, 'cloudStatus lists which weeks of the wire exist');

for (const shape of ['rosters', 'wire', 'schedule']) {
  eq(status.ages[shape].syncedAt, up.syncedAt, `${shape} carries its own timestamp`);
  eq(status.ages[shape].stale, false, `${shape} is not stale the moment it is written`);
}

// The whole point of per-shape ages: a wire and a roster of IDENTICAL age are
// NOT equally usable. The wire's question is "who can I add", and a week-old
// answer lists men claimed on Tuesday — confidently wrong, which is the one
// failure this site's house style exists to prevent.
const twoDays = Date.parse(up.syncedAt) + 2 * 24 * 60 * 60 * 1000;
const aged = await cloud.cloudStatus(LEAGUE, SEASON, { now: twoDays });
eq(aged.ages.wire.stale, true, 'a two-day-old wire is stale and a page must refuse to draw it');
eq(aged.ages.rosters.stale, false, 'two-day-old rosters are not stale — the season-shaped questions survive it');
eq(aged.ages.schedule.stale, false, 'a two-day-old schedule is not stale — fixtures do not move');
eq(aged.ages.wire.described, '2 days ago', 'the age comes back as words a banner can use');

const tenDays = Date.parse(up.syncedAt) + 10 * 24 * 60 * 60 * 1000;
const older = await cloud.cloudStatus(LEAGUE, SEASON, { now: tenDays });
eq(older.ages.rosters.stale, true, 'ten-day-old rosters ARE stale');
eq(older.ages.wire.stale, true, 'and so, still, is the wire');

// readDown reports the same ages, so a page that skipped the status call is
// not left without the one fact it must not render past.
const agedDown = await cloud.readDown(LEAGUE, SEASON, { now: twoDays, shapes: ['rosters'] });
eq(agedDown.ages.wire.stale, true, 'readDown reports staleness per shape too');
eq(agedDown.ages.rosters.stale, false, 'and agrees with cloudStatus about which');

// The policy itself, so no page can quietly invent a friendlier threshold.
ok('the wire tolerates a day', cloud.MAX_AGE.wire === 24 * 60 * 60 * 1000);
ok('rosters tolerate a week', cloud.MAX_AGE.rosters === 7 * 24 * 60 * 60 * 1000);
ok('the wire is the tightest of the three', cloud.MAX_AGE.wire < cloud.MAX_AGE.rosters);
eq(cloud.ageOf(null), null, 'an age with no timestamp is null, not zero');
eq(cloud.isStale('wire', null), true, '"never synced" counts as stale — it must not read as fresh by accident');
eq(cloud.describeAge(null), 'never', 'and describes itself honestly');

// =========================================================================
// 5. DEMO IS NEVER SYNCED
// =========================================================================
//
// Same rule as the snapshot archive, for the same reasons: demo data is
// generated rather than observed. A phone reading it back would be looking at
// a league that does not exist while the badge said "live".

const demoFake = makeFake();
cloud.configure({ transport: demoFake });

const demoUp = await cloud.syncUp('demo', 0, { ...payload, isDemo: true });
eq(demoUp.ok, false, 'syncing the demo league is refused');
eq(demoFake.log.writes, 0, 'and nothing at all is written');
ok('the refusal says why', /demo/i.test(demoUp.reason), demoUp.reason);

// The check is on the SHAPE of the id, not the literal string 'demo', so a
// future sample league cannot slip through by being called something else.
const otherSample = await cloud.syncUp('sample-2026', 2026, payload);
eq(otherSample.ok, false, 'any league id that is not a real ESPN number is refused');
eq(demoFake.log.writes, 0, 'still nothing written');

// And an explicitly-flagged demo payload is refused even under a real id,
// because `isDemo` is the page's own word for it and outranks a plausible id.
const flagged = await cloud.syncUp(LEAGUE, SEASON, { ...payload, isDemo: true });
eq(flagged.ok, false, 'a payload flagged isDemo is refused even with a real league id');
eq(demoFake.log.writes, 0, 'still nothing written');

// Reading is refused too, rather than spending a request to be told nothing.
const demoDown = await cloud.readDown('demo', 0);
eq(demoDown.ok, false, 'reading the demo league is refused');
eq(demoFake.log.reads, 0, 'and costs no reads');
ok('readDown still returns the empty shapes so a caller need not special-case it', demoDown.rosters instanceof Map);
eq(demoDown.rosters.size, 0, 'with nothing in them');

const demoStatus = await cloud.cloudStatus('demo', 0);
eq(demoStatus.ok, false, 'cloudStatus refuses the demo league');
eq(demoFake.log.reads, 0, 'and costs no reads either');

// =========================================================================
// 6. EVERY FAILURE RETURNS; NOTHING THROWS
// =========================================================================
//
// This is the established rule for `snapshots.fetchRemote` and it applies
// doubly here: the cloud is ABSENT on every page load between now and the day
// Tim finishes the console setup. None of these may stop a page rendering.

/** Run something that must not throw, and report what it returned instead. */
async function mustReturn(label, fn) {
  try {
    const res = await fn();
    ok(`${label} returns rather than throwing`, true);
    return res;
  } catch (err) {
    ok(`${label} returns rather than throwing`, false, String(err && err.message));
    return null;
  }
}

// --- no project configured at all: the state the site is in TODAY ---

cloud.configure({ transport: null, apiKey: '', projectId: '', ownerUid: '' });
eq(cloud.isConfigured(), false, 'with no apiKey and no project, the module reports itself unconfigured');

let r = await mustReturn('syncUp with no project', () => cloud.syncUp(LEAGUE, SEASON, payload));
eq(r.ok, false, 'syncUp with no project fails quietly');
ok('and points at the setup doc', /firebase-setup/.test(r.reason), r.reason);

r = await mustReturn('readDown with no project', () => cloud.readDown(LEAGUE, SEASON));
eq(r.ok, false, 'readDown with no project fails quietly');
ok('and still hands back the empty shapes, so a page can render', r.rosters instanceof Map && r.wire instanceof Map);
eq(r.schedule, null, 'with a null schedule rather than a missing key');

eq(r.ages.wire.stale, true, 'and reports the wire as stale, so a page that only checks staleness still refuses to draw it');
eq(r.ages.rosters.described, 'never', 'with an honest description rather than a missing field');
same(r.missing, [], 'and a missing list rather than an undefined one');

r = await mustReturn('cloudStatus with no project', () => cloud.cloudStatus(LEAGUE, SEASON));
eq(r.ok, false, 'cloudStatus with no project fails quietly');
eq(r.found, false, 'and reports nothing found');
eq(r.ages.wire.stale, true, 'and still carries a full age report');
same(r.weeks, { rosters: [], wire: [] }, 'and an empty week list rather than an undefined one');

r = await mustReturn('signIn with no project', () => cloud.signIn());
eq(r.ok, false, 'signIn with no project fails quietly');
r = await mustReturn('signOut with no project', () => cloud.signOut());
eq(r.ok, true, 'signOut with no project is a no-op that succeeds — you are, after all, signed out');
eq(cloud.currentUser(), null, 'and nobody is signed in');

await mustReturn('onAuth with no project', async () => {
  let saw = 'nothing';
  const off = cloud.onAuth((u) => { saw = u; });
  ok('onAuth returns an unsubscribe immediately, without awaiting the SDK', typeof off === 'function');
  await new Promise((res) => setTimeout(res, 20));
  eq(saw, null, 'and reports nobody signed in rather than staying silent');
  off();
});

// --- configured, but the CDN cannot be reached (offline, or Node) ---
//
// This is not a simulated failure: Node genuinely cannot import an https: URL,
// so `buildTransport` really does fail here exactly as it would on a phone in
// a tunnel. If the site still works in that case, it works offline.

cloud.configure({ transport: null, apiKey: 'AIzaNotARealKeyButTheRightShape', projectId: 'ff-test-project' });
eq(cloud.isConfigured(), true, 'a pasted config makes the module consider itself configured');

r = await mustReturn('syncUp with the SDK unreachable', () => cloud.syncUp(LEAGUE, SEASON, payload));
eq(r.ok, false, 'syncUp with no network fails quietly');
r = await mustReturn('readDown with the SDK unreachable', () => cloud.readDown(LEAGUE, SEASON));
eq(r.ok, false, 'readDown with no network fails quietly');
ok('and still hands back empty shapes', r.rosters instanceof Map);
r = await mustReturn('cloudStatus with the SDK unreachable', () => cloud.cloudStatus(LEAGUE, SEASON));
eq(r.ok, false, 'cloudStatus with no network fails quietly');
r = await mustReturn('signIn with the SDK unreachable', () => cloud.signIn());
eq(r.ok, false, 'signIn with no network fails quietly');

// --- signed out ---

cloud.configure({ transport: makeFake({ user: null }) });
r = await mustReturn('syncUp while signed out', () => cloud.syncUp(LEAGUE, SEASON, payload));
eq(r.ok, false, 'syncUp while signed out is refused');
ok('and says to sign in', /sign in/i.test(r.reason), r.reason);

// --- signed in as somebody else ---

cloud.configure({
  transport: makeFake({ user: { uid: 'uid-someone-else', email: 'nosy@example.com', name: 'Nosy' } }),
  ownerUid: 'uid-tim',
});
r = await mustReturn('syncUp as the wrong account', () => cloud.syncUp(LEAGUE, SEASON, payload));
eq(r.ok, false, 'syncUp as a different Google account is refused before it writes');
ok('and names the account, rather than showing a permission error', /nosy@example.com/.test(r.reason), r.reason);

// --- the write fails halfway (quota, a dropped connection) ---

const brokenWrites = makeFake({ failWrites: 'resource-exhausted' });
cloud.configure({ transport: brokenWrites, ownerUid: '' });
r = await mustReturn('syncUp when Firestore refuses the write', () => cloud.syncUp(LEAGUE, SEASON, payload));
eq(r.ok, false, 'a refused write fails quietly');
ok('and the reason is a sentence, not an error code', /quota/i.test(r.reason), r.reason);
eq(r.wrote, 0, 'and reports how far it got');

// --- the read fails ---

const brokenReads = makeFake({ failReads: 'unavailable' });
cloud.configure({ transport: brokenReads });
r = await mustReturn('readDown when Firestore refuses the read', () => cloud.readDown(LEAGUE, SEASON));
eq(r.ok, false, 'a refused read fails quietly');
ok('and still hands back empty shapes', r.rosters instanceof Map && r.wire instanceof Map);
r = await mustReturn('cloudStatus when Firestore refuses the read', () => cloud.cloudStatus(LEAGUE, SEASON));
eq(r.ok, false, 'a refused status read fails quietly');

// --- nothing has ever been synced ---

const bare = makeFake();
cloud.configure({ transport: bare });
r = await mustReturn('readDown against an empty project', () => cloud.readDown(LEAGUE, SEASON));
eq(r.ok, true, 'an empty project is not an ERROR — it is the normal state before the first sync');
eq(r.found, false, 'it is simply not found');
eq(r.rosters.size, 0, 'with no weeks');
eq(bare.log.reads, 1, 'and it costs one read to find out, not twenty-eight');

r = await mustReturn('cloudStatus against an empty project', () => cloud.cloudStatus(LEAGUE, SEASON));
eq(r.ok, true, 'cloudStatus on an empty project is not an error either');
eq(r.found, false, 'just nothing found');

// --- a single week's document is missing or corrupt ---
//
// A gap has to behave the way `fetchWeeksRosters` already behaves for a week
// ESPN refuses: absent from the Map, not an exception, and NAMED so a page can
// say which weeks it is missing.

const holed = makeFake();
cloud.configure({ transport: holed });
await cloud.syncUp(LEAGUE, SEASON, payload);
holed.docs.delete(`leagues/${LEAGUE}/seasons/${SEASON}/rosters/6`);
holed.docs.set(`leagues/${LEAGUE}/seasons/${SEASON}/rosters/9`, JSON.stringify({ v: 1, kind: 'rosters', json: ['{not json'] }));

r = await mustReturn('readDown across a hole', () => cloud.readDown(LEAGUE, SEASON, { shapes: ['rosters'] }));
eq(r.ok, true, 'a missing week does not fail the read');
eq(r.rosters.size, 11, 'the eleven good weeks come back');
ok('the missing week is absent from the Map, not present and empty', !r.rosters.has(6));
ok('the corrupt week is absent too', !r.rosters.has(9));
same(r.missing.sort(), ['week 6 rosters', 'week 9 rosters'], 'and both are named so a page can say which');

// --- a document written by a future version of this module ---

const future = makeFake();
cloud.configure({ transport: future });
future.docs.set(`leagues/${LEAGUE}/seasons/${SEASON}`, JSON.stringify({ v: 99, kind: 'meta' }));
r = await mustReturn('readDown against a newer schema', () => cloud.readDown(LEAGUE, SEASON));
eq(r.found, false, 'a document from a newer schema reads as absent, never as broken data');
ok('and says so', /version/i.test(r.reason), r.reason);

// =========================================================================
// 7. THE ENCODING ITSELF
// =========================================================================
//
// The fake already refuses nested arrays and undefined, so the round trip
// above is proof that the encoding is Firestore-legal. These check the two
// details that would otherwise only be visible in a comment.

const enc = makeFake();
cloud.configure({ transport: enc });
await cloud.syncUp(LEAGUE, SEASON, payload);

const rosterDoc = JSON.parse(enc.docs.get(`leagues/${LEAGUE}/seasons/${SEASON}/rosters/7`));
ok('a document body is stored as an array of string pieces', Array.isArray(rosterDoc.json) && typeof rosterDoc.json[0] === 'string');
ok('there is more than one piece for a 40 KB week', rosterDoc.json.length > 1, `${rosterDoc.json.length}`);
ok(
  'and every piece is small enough for Firestore to index without an exemption',
  rosterDoc.json.every((s) => Buffer.byteLength(s, 'utf8') <= 4096),
  `longest ${Math.max(...rosterDoc.json.map((s) => Buffer.byteLength(s, 'utf8')))} bytes`
);
eq(rosterDoc.json.join('').length, rosterDoc.chars, 'the pieces rejoin to exactly the length recorded');
eq(rosterDoc.kind, 'rosters', 'a document says what it is, for anyone reading it in the console');
eq(rosterDoc.id, '7', 'and which week');
ok('and when it was written, without unpacking it', Number.isFinite(Date.parse(rosterDoc.syncedAt)));

// The pieces must not split a surrogate pair. ESPN names are ASCII today; that
// is not a reason to write something that corrupts the day one is not.
const emojiFake = makeFake();
cloud.configure({ transport: emojiFake });
const wide = '\u{1F3C8}'.repeat(6000); // 12,000 UTF-16 units, split three ways
const wideTeams = [{ id: 1, name: wide, players: [], starters: [], bench: [] }];
await cloud.syncUp(LEAGUE, SEASON, { leagueName: wide, teams: [], rosters: new Map([[1, wideTeams]]) });
const wideBack = await cloud.readDown(LEAGUE, SEASON, { shapes: ['rosters'] });
eq(wideBack.rosters.get(1)[0].name, wide, 'a name that has to be split across pieces comes back whole');

// =========================================================================

console.log('');
if (fails.length) {
  console.log(`${pass} passed, ${fails.length} failed\n`);
  for (const f of fails) console.log('  FAIL  ' + f);
  process.exit(1);
}
console.log(`All ${pass} assertions passed`);
