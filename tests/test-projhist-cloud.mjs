// THE SAVED PROJECTIONS, IN THE CLOUD — docs/proj-changes-plan.md, phase 4a.
//
//   node test-projhist-cloud.mjs             every scenario
//   node test-projhist-cloud.mjs <scenario>  one
//
// Tim, 2026-10-06: "can we make sure that we save it so that we don't lose it
// after every week and it changes?" ESPN overwrites a future week's projection
// in place, so the weekly copy js/proj-history.js keeps is the only record of
// what the sheet said — and it lived in one browser's storage, which is not
// durable and is not on his phone. So each copy rides the cloud sync
// (`…/projhist/<week>`), and this is whether that is TRUE:
//
//   once        a sync sends every stored week once; the next one neither
//               reads nor writes anything for them.
//   partial     a week only a schema-2 reading remembers goes up as a one-team
//               copy, `partial: true`, with exactly that team.
//   firstWins   a week that is already up is never written again — not by a
//               second browser with different numbers, not when the list was
//               lost, not by the Send button.
//   refused     Firestore refusing these documents costs the sync nothing, and
//               a list that could not be written mends itself.
//   demo        nothing of the sample league goes up or comes down.
//   phone       a browser with empty storage, after one read of the synced
//               copy, answers `list` and `teamAsOf` for the cloud's weeks,
//               whole and one-team; and it asks once per sync, not per page.
//   beside      a one-team copy never stops the whole copy of its week, here
//               or in the cloud, and the reader then takes the whole one.
//   size        a real-sized week as the document the sync writes.
//   payload     the real `season.buildCloudPayload` carries the stored weeks.
//   bar         the real connection bar: marks kept, the cloud's week kept.
//
// Every scenario also checks that nothing but `…/projhist/…` is written by
// this code (the sync's own league index aside) and that nothing is deleted.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { moduleUrl } from './repo.mjs';
import { emit } from './emit.mjs';

const self = fileURLToPath(import.meta.url);

let pass = 0;
const fails = [];
let scenario = '';
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`[${scenario}] ${msg}${extra !== '' ? ` — ${String(typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400)}` : ''}`);
};
const eq = (a, b, msg) =>
  ok(msg, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const LEAGUE_ID = '424242';
const SEASON = 2026;
const BASE = `leagues/${LEAGUE_ID}/seasons/${SEASON}`;
const HIST = (w) => `${BASE}/projhist/${w}`;
const isHist = (p) => /\/projhist\//.test(p);
const tail = (p) => p.split('/').pop();

function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
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
// A WEEK'S COPY AT REAL SIZE
// ===========================================================================
//
// Ten squads of seventeen, real-length names, a projection to two places in
// every week still to come: what `capture.keepHistory` writes. The live one
// (1241838, week 5, weeks 5–17) measured 21 KB.

const NAMES = ['Amon-Ra St. Brown', 'Christian McCaffrey', 'Justin Jefferson', 'Ja\'Marr Chase', 'Bijan Robinson',
  'Jahmyr Gibbs', 'CeeDee Lamb', 'Puka Nacua', 'Saquon Barkley', 'Lamar Jackson', 'Brock Bowers', 'Trey McBride',
  'Marvin Harrison Jr.', 'Kenneth Walker III', 'Brian Thomas Jr.', 'Jaxon Smith-Njigba', '49ers D/ST'];
const POS = ['WR', 'RB', 'WR', 'WR', 'RB', 'RB', 'WR', 'WR', 'RB', 'QB', 'TE', 'TE', 'WR', 'RB', 'WR', 'WR', 'D/ST'];
const SLOTS = [4, 2, 4, 23, 2, 23, 20, 20, 20, 0, 6, 20, 20, 20, 20, 21, 16];
const COLS = ['id', 'name', 'pos', 'team', 'slot', 'inj', 'proj'];

/** `bump` shifts every number: a second browser's later look at the same week. */
function rowsOf(teamId, weeks, bump = 0) {
  return NAMES.map((name, i) => [
    4000000 + teamId * 100 + i, name, POS[i], ['DET', 'SF', 'MIN', 'CIN'][i % 4], SLOTS[i],
    i === 5 ? 'QUESTIONABLE' : 'ACTIVE',
    weeks.map((w) => (w === 9 && i % 4 === 0 ? 0 : Math.round((8 + i * 0.73 + teamId * 0.31 + w * 0.17 + bump) * 100) / 100)),
  ]);
}

function makeRec(week, { bump = 0, takenAt = null } = {}) {
  const weeks = [];
  for (let w = week; w <= 17; w++) weeks.push(w);
  const teams = {};
  for (let t = 1; t <= 10; t++) teams[t] = rowsOf(t, weeks, bump);
  return {
    v: 1, leagueId: LEAGUE_ID, season: SEASON, week,
    takenAt: takenAt || `2026-10-${String(week).padStart(2, '0')}T18:02:11.000Z`,
    weeks, cols: COLS.slice(), teams,
  };
}

/** A schema-2 reading as js/snapshots.js keeps one: the reader's own roster only. */
function makeReading(week, teamId) {
  const weeks = [];
  for (let w = week; w <= 17; w++) weeks.push(w);
  return {
    v: 2, leagueId: LEAGUE_ID, season: SEASON, week, takenAt: `2026-09-${10 + week}T15:30:00.000Z`,
    players: { teamId, weeks, cols: COLS.slice(), mine: rowsOf(teamId, weeks, 0.5) },
  };
}

/** The `io` js/proj-history.js takes: a storage, and readings by week. */
function browser({ stored = [], readings = [] } = {}) {
  const storage = makeStorage();
  for (const rec of stored) storage.setItem(`ff.projhist.1.${LEAGUE_ID}.${SEASON}.${rec.week}`, JSON.stringify(rec));
  const byWeek = new Map(readings.map((r) => [r.week, r]));
  return {
    storage,
    readings: {
      list: () => [...byWeek.values()].sort((a, b) => a.week - b.week),
      get: (l, s, w) => byWeek.get(Number(w)) || null,
    },
  };
}

// ===========================================================================
// THE CLOUD, FAKED AS tests/test-decision-cloud.mjs FAKES IT
// ===========================================================================

function assertFirestoreLegal(value, at = '', inArray = false) {
  if (value === undefined) throw new Error(`undefined at ${at} (Firestore rejects it)`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite number at ${at}`);
    return;
  }
  if (Array.isArray(value)) {
    if (inArray) throw new Error(`nested array at ${at} (Firestore rejects arrays inside arrays)`);
    value.forEach((v, i) => assertFirestoreLegal(v, `${at}[${i}]`, true));
    return;
  }
  if (typeof value !== 'object') throw new Error(`unstorable ${typeof value} at ${at}`);
  for (const [k, v] of Object.entries(value)) assertFirestoreLegal(v, at ? `${at}.${k}` : k, false);
}

const ALL_FAKES = [];

/** `refuse(path)` true is a rules refusal of a write; `shut(path)` of a read. */
function makeFake({ refuse = null, shut = null } = {}) {
  const user = { uid: 'uid-claude-test', email: 'claude-test@example.com', name: 'claude-test' };
  const docs = new Map();
  const log = { reads: [], writes: [], deletes: [], rewrites: [], biggest: 0 };
  const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  const fake = {
    docs, log, refuse, shut,
    async signIn() { return user; },
    async signOut() {},
    currentUser() { return user; },
    onAuth(cb) { cb(user); return () => {}; },
    async getDoc(p) {
      log.reads.push(p);
      if (fake.shut && fake.shut(p)) throw denied();
      const raw = docs.get(p);
      return raw === undefined ? null : JSON.parse(raw);
    },
    async setDoc(p, data) {
      log.writes.push(p);
      if (fake.refuse && fake.refuse(p)) throw denied();
      assertFirestoreLegal(data, '');
      const raw = JSON.stringify(data);
      if (docs.has(p) && docs.get(p) !== raw) log.rewrites.push(p);
      log.biggest = Math.max(log.biggest, Buffer.byteLength(raw, 'utf8'));
      docs.set(p, raw);
    },
    // Nothing here may call it. It exists so that a call would be seen.
    async deleteDoc(p) { log.deletes.push(p); docs.delete(p); },
  };
  ALL_FAKES.push(fake);
  return fake;
}

const bodyOf = (fake, p) => {
  const raw = fake.docs.get(p);
  return raw === undefined ? null : JSON.parse(JSON.parse(raw).json.join(''));
};

const cloud = await import(moduleUrl('js/cloud.js'));
const H = await import(moduleUrl('js/proj-history.js'));

/** One sync of a browser's copies. `sent` is what that browser remembers. */
async function sync(fake, io, sent = null, extra = {}) {
  cloud.configure({ transport: fake, ownerUid: '' });
  const payload = { leagueName: 'Seam League', teams: [], ...extra };
  if (io) payload.projhist = H.uploads(LEAGUE_ID, SEASON, io);
  return cloud.syncUp(LEAGUE_ID, SEASON, payload, { projhistSent: sent });
}

/** A phone: empty storage of its own, its own js/season.js, no ESPN. */
let phones = 0;
async function phone(fake, storage = makeStorage()) {
  if (storage === null) delete globalThis.localStorage;
  else globalThis.localStorage = storage;
  const espn = await import(moduleUrl('js/espn.js'));
  cloud.configure({ transport: fake, ownerUid: '' });
  espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
  globalThis.fetch = async (u) => { throw new Error(`a phone cannot ask ESPN: ${u}`); };
  const season = await import(`${moduleUrl('js/season.js')}?phone=${++phones}`);
  fake.log.reads.length = 0;
  const source = await season.cloudSource();
  return { storage, found: Boolean(source), reads: fake.log.reads.filter(isHist).map(tail) };
}

// ===========================================================================
// SCENARIOS
// ===========================================================================

const SCENARIOS = {
  async once() {
    const io = browser({ stored: [makeRec(5), makeRec(6)] });
    const plain = makeFake();
    const without = await sync(plain, null);

    const fake = makeFake();
    const first = await sync(fake, io);
    ok('the sync succeeded', first.ok === true, first.reason);
    eq([first.wrote, first.bytes, first.reason], [without.wrote, without.bytes, without.reason],
      'and reports exactly what a sync without them reports');
    eq(first.projhist && [first.projhist.wrote, first.projhist.reason], [2, ''], 'two weeks held, two written');
    eq(fake.log.writes, [HIST(5), HIST(6), HIST('index'), BASE], 'each at …/projhist/<week>, then their list, the league index LAST');
    eq(fake.log.reads.map(tail), ['index', '5', '6'], 'one look at the list, one look per week before writing it');
    eq(bodyOf(fake, HIST(5)), makeRec(5), 'what is up is the stored copy, number for number');
    eq(Object.keys(bodyOf(fake, HIST('index')).docs).sort(), ['5', '6'], 'and the list names both');
    eq(Object.keys(first.projhist.marks).sort(), ['5', '6', 'index'], 'the sync hands back a mark for each');

    fake.log.writes.length = 0;
    fake.log.reads.length = 0;
    const second = await sync(fake, io, first.projhist.marks);
    ok('the next sync succeeds', second.ok === true, second.reason);
    eq(fake.log.writes, [BASE], 'and writes nothing but the league index');
    eq(fake.log.reads, [], 'and reads nothing at all');
    eq([second.projhist.wrote, second.projhist.skipped, second.projhist.reads], [0, 2, 0], 'both weeks skipped unread');

    // A new week arrives: it alone goes.
    io.storage.setItem(`ff.projhist.1.${LEAGUE_ID}.${SEASON}.7`, JSON.stringify(makeRec(7)));
    fake.log.writes.length = 0;
    fake.log.reads.length = 0;
    const third = await sync(fake, io, second.projhist.marks);
    eq(fake.log.writes, [HIST(7), HIST('index'), BASE], 'a new week is one document and the list');
    eq(fake.log.reads.map(tail), ['index', '7'], 'for two reads');
    eq(Object.keys(bodyOf(fake, HIST('index')).docs).sort(), ['5', '6', '7'], 'and the list now names three');
    eq(fake.log.rewrites.filter((p) => p !== HIST('index') && p !== BASE), [], 'no copy was ever written over');
    ok('a third sync was a sync', third.ok === true);
  },

  async partial() {
    // Weeks 3 and 4: only the reading's own roster (team 7). Week 5: the store.
    const io = browser({ stored: [makeRec(5)], readings: [makeReading(3, 7), makeReading(4, 7), makeReading(5, 7)] });
    const up = H.uploads(LEAGUE_ID, SEASON, io);
    eq(up.map((r) => [r.week, r.partial === true]), [[3, true], [4, true], [5, false]],
      'the store where it has the week, else the reading\'s roster');

    const fake = makeFake();
    const res = await sync(fake, io);
    ok('the sync succeeded', res.ok === true, res.reason);
    eq(fake.log.writes.filter(isHist).map(tail), ['3-part', '4-part', '5', 'index'], 'one-team weeks go to an id of their own');
    const doc = bodyOf(fake, HIST('3-part'));
    eq([doc.partial, Object.keys(doc.teams), doc.takenAt], [true, ['7'], makeReading(3, 7).takenAt],
      'partial, exactly the one team, stamped when the reading was taken');
    eq(doc.teams['7'], makeReading(3, 7).players.mine, 'in the same rows the reading kept');
    eq([doc.weeks, doc.cols, doc.v, doc.week], [makeReading(3, 7).players.weeks, COLS, 1, 3], 'in the stored shape');
    eq(bodyOf(fake, HIST('index')).docs['3-part'], { week: 3, partial: true, takenAt: makeReading(3, 7).takenAt, teams: [7] },
      'and the list says whose it is');
    ok('no whole-week document was invented for a one-team week', !fake.docs.has(HIST(3)) && !fake.docs.has(HIST(4)));
    ok('week 5 went up whole, the reading beside it not at all', bodyOf(fake, HIST(5)).partial === undefined && !fake.docs.has(HIST('5-part')));
  },

  async firstWins() {
    const fake = makeFake();
    const a = browser({ stored: [makeRec(5)] });
    const first = await sync(fake, a);
    const original = fake.docs.get(HIST(5));
    const listed = fake.docs.get(HIST('index'));

    // Another browser took its own, later copy of week 5. Different numbers.
    const b = browser({ stored: [makeRec(5, { bump: 3, takenAt: '2026-10-08T09:00:00.000Z' })] });
    fake.log.writes.length = 0;
    const second = await sync(fake, b);
    ok('the second browser\'s sync succeeded', second.ok === true, second.reason);
    eq(fake.log.writes.filter(isHist), [], 'and wrote no projection document at all');
    ok('week 5 in the cloud is byte for byte the first copy', fake.docs.get(HIST(5)) === original);
    eq(second.projhist.marks['5'], makeRec(5).takenAt, 'the second browser is told the week is up (the first copy\'s time)');

    // The list is lost (a write that never landed). The copy must still not be written over.
    fake.docs.delete(HIST('index'));
    fake.log.writes.length = 0;
    fake.log.reads.length = 0;
    await sync(fake, b);
    eq(fake.log.reads.map(tail), ['index', '5'], 'not listed, so it looks before it writes');
    eq(fake.log.writes.filter(isHist), [HIST('index')], 'finds the copy there, and writes only the list');
    ok('week 5 is still the first copy', fake.docs.get(HIST(5)) === original);
    ok('and the mended list is the list it was', JSON.parse(fake.docs.get(HIST('index'))).json.join('') === JSON.parse(listed).json.join(''));

    // The Send button forgets the marks. Nothing is written again.
    fake.log.writes.length = 0;
    fake.log.reads.length = 0;
    const forced = await sync(fake, a, null);
    eq(fake.log.writes.filter(isHist), [], 'a forced sync rewrites nothing');
    eq(fake.log.reads.map(tail), ['index'], 'for one read of the list');
    ok('and the marks come back', Boolean(forced.projhist.marks['5']) && Boolean(first.projhist.marks['5']));
    eq(fake.log.rewrites.filter((p) => p !== HIST('index') && p !== BASE), [], 'no copy was ever replaced with different content');
  },

  async refused() {
    const io = browser({ stored: [makeRec(5), makeRec(6)] });
    const plain = makeFake();
    const without = await sync(plain, null);

    // The project's rules do not cover the new path.
    const shutOut = makeFake({ refuse: isHist });
    const res = await sync(shutOut, io);
    ok('the sync still succeeds', res.ok === true, res.reason);
    eq([res.wrote, res.bytes, res.reason], [without.wrote, without.bytes, without.reason], 'with the status it always had');
    eq(shutOut.log.writes[shutOut.log.writes.length - 1], BASE, 'the league index written, last');
    eq(shutOut.log.writes.filter(isHist).length, 1, 'one refusal is enough: the other week is not tried');
    ok('the refusal is a reason on the side', /not the one this league belongs to|permission/i.test(res.projhist.reason), res.projhist.reason);
    eq(Object.keys(res.projhist.marks), ['index'], 'and no week is marked as up');
    eq([...shutOut.docs.keys()], [BASE], 'nothing but the league index is in the cloud');

    // Reads refused as well.
    const blind = makeFake({ shut: isHist, refuse: isHist });
    const dark = await sync(blind, io);
    ok('a refused read costs the sync nothing either', dark.ok === true && dark.wrote === without.wrote, dark.reason);
    eq(blind.log.writes, [BASE], 'and then nothing is even tried');
    eq(Object.keys(dark.projhist.marks), [], 'nothing marked');

    // The transport itself blowing up in an unexpected way.
    const broken = makeFake();
    broken.getDoc = async (p) => { if (isHist(p)) throw new TypeError('boom'); return null; };
    const odd = await sync(broken, io);
    ok('nor does an exception nobody planned for', odd.ok === true && odd.wrote === without.wrote, odd.reason);
    // …nor one thrown outside every guard the writer has of its own.
    const trap = Object.defineProperty({}, 'v', { get() { throw new Error('boom'); } });
    const wild = await sync(makeFake(), null, null, { projhist: [trap] });
    eq([wild.ok, wild.wrote, wild.reason, 'projhist' in wild], [true, without.wrote, '', false],
      'a copy that throws when looked at leaves the sync exactly as it was');

    // Only the LIST is refused: the copies land, unlisted. Not marked, so the
    // next sync finds them up, writes neither again, and lists them.
    const half = makeFake({ refuse: (p) => p === HIST('index') });
    const one = await sync(half, io);
    ok('a sync whose list write failed is still a sync', one.ok === true, one.reason);
    eq(Object.keys(one.projhist.marks), ['index'], 'its weeks are not marked as done');
    const five = half.docs.get(HIST(5));
    half.refuse = null;
    half.log.writes.length = 0;
    const two = await sync(half, io, one.projhist.marks);
    eq(half.log.writes.filter(isHist), [HIST('index')], 'the next sync writes the list and no copy');
    ok('the copy is untouched', half.docs.get(HIST(5)) === five);
    eq(Object.keys(two.projhist.marks).sort(), ['5', '6', 'index'], 'and now they are marked');
  },

  async demo() {
    const fake = makeFake();
    cloud.configure({ transport: fake, ownerUid: '' });
    const rec = { ...makeRec(5), leagueId: 'demo' };
    const a = await cloud.syncUp('demo', SEASON, { leagueName: 'Sample', teams: [], projhist: [rec] });
    ok('the sample league is refused', a.ok === false, a.reason);
    const b = await cloud.syncUp(LEAGUE_ID, SEASON, { isDemo: true, leagueName: 'Sample', teams: [], projhist: [makeRec(5)] });
    ok('and so is a payload that says it is demo data', b.ok === false, b.reason);
    eq([fake.log.writes, fake.log.reads], [[], []], 'nothing written, nothing read');
    const down = await cloud.readProjhist('demo', SEASON);
    eq([down.ok, down.copies.length, fake.log.reads.length], [false, 0, 0], 'and nothing is asked for on the way down');
    // The gatherer never offers a copy that is not a copy.
    const junk = await sync(makeFake(), null, null, { projhist: [null, { v: 9 }, { ...makeRec(5), teams: [] }, 'x'] });
    eq([junk.ok, junk.projhist.wrote], [true, 0], 'a malformed copy is not sent, and is nobody\'s problem');
    // A browser that holds no copy: the sync is, to the key, what it was.
    const bare = makeFake();
    const none = await sync(bare, browser());
    eq([none.ok, 'projhist' in none, bare.log.reads, bare.log.writes], [true, false, [], [BASE]],
      'a browser holding no copy asks for nothing, and its sync has no projhist key');
  },

  async phone() {
    const fake = makeFake();
    const laptop = browser({ stored: [makeRec(5), makeRec(6)], readings: [makeReading(4, 7)] });
    const first = await sync(fake, laptop);
    ok('the laptop synced', first.ok === true, first.reason);

    const P = await phone(fake);
    ok('the phone read the synced copy', P.found);
    eq(P.reads.slice().sort(), ['4-part', '5', '6', 'index'], 'one read of the list and one per week it lacked');
    const got = H.list(LEAGUE_ID, SEASON);
    eq(got.map((e) => [e.week, e.teams, e.source]), [[4, [7], 'cloud'], [5, 'all', 'store'], [6, 'all', 'store']],
      'an empty browser now lists the cloud\'s weeks, the one-team week as one team');
    const want = H.teamAsOf(LEAGUE_ID, SEASON, 5, 3, laptop);
    const have = H.teamAsOf(LEAGUE_ID, SEASON, 5, 3);
    eq(have && [have.takenAt, have.weeks, have.players.map((p) => [p.playerId, p.name, p.slotId, [...p.proj]])],
      [want.takenAt, want.weeks, want.players.map((p) => [p.playerId, p.name, p.slotId, [...p.proj]])],
      'any team of a whole week reads back exactly as on the laptop');
    ok('seventeen men, thirteen weeks', have && have.players.length === 17 && have.weeks.length === 13);
    const mine = H.teamAsOf(LEAGUE_ID, SEASON, 4, 7);
    const laptopMine = H.teamAsOf(LEAGUE_ID, SEASON, 4, 7, laptop);
    eq(mine && [mine.source, mine.takenAt, mine.players.map((p) => [p.playerId, [...p.proj]])],
      ['cloud', laptopMine.takenAt, laptopMine.players.map((p) => [p.playerId, [...p.proj]])],
      'the one-team week answers for its team, with the reading\'s numbers');
    eq(H.teamAsOf(LEAGUE_ID, SEASON, 4, 3), null, 'and for no other team: nothing is made up');
    ok('a one-team copy is not a "first copy" of its week', H.has(LEAGUE_ID, SEASON, 4) === false);

    // The next page: same sync, same storage. Not one read.
    const again = await phone(fake, P.storage);
    eq(again.reads, [], 'the next page load against the same sync reads nothing for them');

    // The laptop syncs a new week. The phone takes the list and that week.
    laptop.storage.setItem(`ff.projhist.1.${LEAGUE_ID}.${SEASON}.7`, JSON.stringify(makeRec(7)));
    await new Promise((r) => setTimeout(r, 5));   // a later `syncedAt`
    await sync(fake, laptop, first.projhist.marks);
    const later = await phone(fake, P.storage);
    eq(later.reads.slice().sort(), ['7', 'index'], 'after a new sync: the list, and the one new week');
    eq(H.list(LEAGUE_ID, SEASON).map((e) => e.week), [4, 5, 6, 7], 'which is then listed');

    // A copy of a league synced before any of this: one read, then none.
    const old = makeFake();
    await sync(old, null);
    const bare = await phone(old);
    eq([bare.found, bare.reads], [true, ['index']], 'a copy with no saved projections costs one read');
    eq(H.list(LEAGUE_ID, SEASON), [], 'and lists nothing');
    eq((await phone(old, bare.storage)).reads, [], 'once');

    // A week the list names that cannot be read is asked for again next time.
    const holed = makeFake();
    await sync(holed, browser({ stored: [makeRec(5), makeRec(6)] }));
    holed.shut = (p) => p === HIST(6);
    const gap = await phone(holed);
    eq(H.list(LEAGUE_ID, SEASON).map((e) => e.week), [5], 'a week that would not read is a gap, not an error');
    holed.shut = null;
    const mended = await phone(holed, gap.storage);
    eq(mended.reads.slice().sort(), ['6', 'index'], 'and the next page asks again, for that week only');

    // Nowhere to keep a copy: do not ask.
    const none = await phone(fake, null);
    eq([none.found, none.reads], [true, []], 'a browser with no storage is not asked at all');

    // The laptop itself, in a browser that lost week 5: the sync brings it back.
    const wiped = browser({ stored: [makeRec(6)] });
    const back = await sync(fake, wiped);
    eq(back.projhist.down.map((r) => r.week), [4, 5, 7], 'a sync hands back the weeks the cloud has and this browser lacks');
    eq(H.keepCloud(LEAGUE_ID, SEASON, back.projhist.down, wiped), { kept: 3, held: 0, failed: 0 }, 'and they are kept');
    eq(H.get(LEAGUE_ID, SEASON, 5, wiped), makeRec(5), 'week 5 is back, number for number');
    eq(H.keepCloud(LEAGUE_ID, SEASON, [makeRec(5, { bump: 9 })], wiped), { kept: 0, held: 1, failed: 0 }, 'first copy wins here too');
    eq(H.get(LEAGUE_ID, SEASON, 5, wiped), makeRec(5), 'a later download never replaces a held week');
    eq(H.keepCloud('999', SEASON, back.projhist.down, browser()), { kept: 0, held: 0, failed: 3 }, 'another league\'s copies are not kept');
  },

  async beside() {
    // --- in the browser ------------------------------------------------------
    const fake = makeFake();
    const laptop = browser({ readings: [makeReading(4, 7)] });
    const first = await sync(fake, laptop);
    const part = fake.docs.get(HIST('4-part'));
    ok('the one-team week went up', Boolean(part));

    const io = browser();
    const down = await cloud.readProjhist(LEAGUE_ID, SEASON, { lacks: (w, p) => H.lacks(LEAGUE_ID, SEASON, w, p, io) });
    H.keepCloud(LEAGUE_ID, SEASON, down.copies, io);
    eq(H.list(LEAGUE_ID, SEASON, io).map((e) => [e.week, e.teams, e.source]), [[4, [7], 'cloud']], 'a browser holding only the one-team copy');
    // js/capture.js keeps a week only when `has` says there is none.
    ok('is still free to take the whole copy of that week', H.has(LEAGUE_ID, SEASON, 4, io) === false);
    const full = makeRec(4, { bump: 2, takenAt: '2026-10-04T20:00:00.000Z' });
    eq(H.save(full, io).written, true, 'and the whole copy is kept');
    eq(H.list(LEAGUE_ID, SEASON, io).map((e) => [e.week, e.teams, e.source]), [[4, 'all', 'store']], 'the week is then listed as whole');
    const t7 = H.teamAsOf(LEAGUE_ID, SEASON, 4, 7, io);
    eq([t7.source, t7.takenAt, t7.players[0].proj.get(4)], ['store', full.takenAt, full.teams[7][0][6][0]],
      'the reader takes the whole copy, for the one-team copy\'s own team too');
    eq(H.teamAsOf(LEAGUE_ID, SEASON, 4, 3, io).players[0].proj.get(4), full.teams[3][0][6][0], 'and every other team answers');
    ok('the one-team copy is still held: nothing was deleted', io.storage.getItem(H.partKeyOf(LEAGUE_ID, SEASON, 4)) !== null);

    // --- in the cloud --------------------------------------------------------
    // The laptop gets a whole copy of week 4 after its one-team copy went up.
    laptop.storage.setItem(`ff.projhist.1.${LEAGUE_ID}.${SEASON}.4`, JSON.stringify(full));
    fake.log.writes.length = 0;
    const second = await sync(fake, laptop, first.projhist.marks);
    eq(fake.log.writes.filter(isHist), [HIST(4), HIST('index')], 'the whole copy is written BESIDE the one-team copy');
    ok('which is byte for byte what it was', fake.docs.get(HIST('4-part')) === part);
    eq(Object.keys(bodyOf(fake, HIST('index')).docs).sort(), ['4', '4-part'], 'the list names both: no number was dropped');
    ok('the sync was a sync', second.ok === true);

    const P = await phone(fake);
    eq(P.reads.slice().sort(), ['4', 'index'], 'a new phone takes the whole copy and does not pay for the other');
    eq(H.list(LEAGUE_ID, SEASON).map((e) => [e.week, e.teams, e.source]), [[4, 'all', 'store']], 'and lists the week as whole');
    eq(H.teamAsOf(LEAGUE_ID, SEASON, 4, 7).players[0].proj.get(4), full.teams[7][0][6][0], 'team 7 from the whole copy');

    // A browser that only has the reading does not send a one-team copy now.
    fake.log.writes.length = 0;
    await sync(fake, browser({ readings: [makeReading(4, 7)] }));
    eq(fake.log.writes.filter(isHist), [], 'a one-team copy is not sent for a week whose whole copy is up');
    eq(fake.log.rewrites.filter((p) => p !== HIST('index') && p !== BASE), [], 'no copy was written over');
  },

  async size() {
    const fake = makeFake();
    const res = await sync(fake, browser({ stored: [makeRec(5)] }));
    const bytes = Buffer.byteLength(fake.docs.get(HIST(5)), 'utf8');
    // The live week measured 21 KB as stored; the packed document adds the
    // chunk array's own quotes and escapes.
    ok('a real-sized week is tens of kilobytes', bytes > 12 * 1024 && bytes < 60 * 1024, `${bytes} bytes`);
    ok('at least seventeen times under Firestore\'s 1 MiB document limit', bytes * 17 < 1024 * 1024, `${bytes} bytes`);
    eq(res.projhist.largestDoc, bytes, 'and the sync reports the size it measured');
    const packed = JSON.parse(fake.docs.get(HIST(5)));
    ok('in pieces Firestore will index', packed.json.every((s) => s.length <= 4000) && packed.kind === 'projhist' && packed.id === '5');

    // Something absurd is refused before it is sent, and costs nothing.
    const huge = makeRec(6);
    huge.teams[1][0][1] = 'x'.repeat(800 * 1024);
    const big = makeFake();
    const out = await sync(big, null, null, { projhist: [huge, makeRec(7)] });
    ok('the sync succeeds around an oversized copy', out.ok === true, out.reason);
    eq(big.log.writes.filter(isHist).map(tail), ['7', 'index'], 'which is not sent; the week after it is');
    ok('and says why, on the side', /too big/.test(out.projhist.reason), out.projhist.reason);
  },

  async payload() {
    // The real gatherer, with ESPN answering for the schedule and nothing else.
    globalThis.localStorage = makeStorage({
      [`ff.projhist.1.${LEAGUE_ID}.${SEASON}.5`]: makeRec(5),
      [`ff.projhist.1.${LEAGUE_ID}.${SEASON}.6`]: makeRec(6),
      [`ff.projhist.1.999.${SEASON}.5`]: { ...makeRec(5), leagueId: '999' },
    });
    const espn = await import(moduleUrl('js/espn.js'));
    const season = await import(`${moduleUrl('js/season.js')}?laptop=1`);
    cloud.configure({ transport: makeFake(), ownerUid: '' });
    espn.configure({ leagueId: LEAGUE_ID, season: SEASON });
    espn.clearReadCache();
    globalThis.fetch = async (url) => {
      const views = new URL(String(url)).searchParams.getAll('view');
      if (views.includes('mRoster') || views.includes('kona_player_info') || views.includes('mTransactions2') ||
          views.includes('proTeamSchedules_wl')) throw new Error('not in this scenario');
      const schedule = [];
      for (let w = 1; w <= 4; w++) {
        for (const [h, a] of [[1, 2], [3, 4]]) {
          schedule.push({ matchupPeriodId: w, playoffTierType: 'NONE', home: { teamId: h, totalPoints: 0 }, away: { teamId: a, totalPoints: 0 }, winner: 'UNDECIDED' });
        }
      }
      const body = {
        settings: { name: 'Seam League', rosterSettings: { lineupSlotCounts: { 0: 1, 2: 1, 20: 1 } } },
        members: [], teams: [1, 2, 3, 4].map((id) => ({ id, name: `Squad ${id}` })), schedule,
      };
      return { ok: true, status: 200, async json() { return JSON.parse(JSON.stringify(body)); } };
    };
    const payload = await season.buildCloudPayload();
    eq(Array.isArray(payload.projhist) && payload.projhist.map((r) => [r.leagueId, r.week]), [[LEAGUE_ID, 5], [LEAGUE_ID, 6]],
      'the sync\'s payload carries this league\'s stored weeks, and no other league\'s');
    eq(payload.projhist && payload.projhist[0], makeRec(5), 'as they are stored');

    const fake = makeFake();
    cloud.configure({ transport: fake, ownerUid: '' });
    const res = await cloud.syncUp(LEAGUE_ID, SEASON, payload);
    ok('the real payload syncs', res.ok === true, res.reason);
    eq(fake.log.writes.filter(isHist).map(tail), ['5', '6', 'index'], 'and both weeks go up');
    eq(fake.log.writes[fake.log.writes.length - 1], BASE, 'before the league index');
    const plain = makeFake();
    cloud.configure({ transport: plain, ownerUid: '' });
    const { projhist, ...rest } = payload;
    const without = await cloud.syncUp(LEAGUE_ID, SEASON, rest);
    eq(fake.log.writes.filter((p) => !isHist(p)), plain.log.writes, 'every other document is written as it is without them, in the same order');
    eq([res.wrote, res.bytes], [without.wrote, without.bytes], 'and the sync reports the same');
  },

  /** The real connection bar, on the capture stub (child process). */
  async bar() {
    const res = spawnSync(process.execPath, ['--import', './cap-register.mjs', self, '--bar-child'], {
      encoding: 'utf8', cwd: path.dirname(self), env: { ...process.env, CAP_CLOUD_PAYLOAD: '1' },
      maxBuffer: 16 * 1024 * 1024, timeout: 120000,
    });
    const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
    const r = line ? JSON.parse(line.slice(2)) : { boot: `no result\n${res.stdout}\n${(res.stderr || '').slice(0, 1500)}` };
    ok('the bar booted and synced', !r.boot, r.boot);
    if (r.boot) return;
    ok('the first sync was recorded as a success', r.first.ok === true, r.first);
    ok('weeks 2 and 3, held in this browser, went up', ['2', '3'].every((w) => r.cloudDocs.includes(w)), r.cloudDocs);
    ok('and the bar kept the marks', ['2', '3', 'index'].every((k) => r.sentAfterFirst.includes(k)), r.sentAfterFirst);
    ok('week 1, which only the cloud had, is now in this browser\'s store', r.heldWeek1 === true);
    eq(r.week1Same, true, 'exactly as it was sent');
    ok('the second sync was a success', r.second.ok === true, r.second);
    eq(r.secondTouched.filter((w) => ['1', '2', '3'].includes(w)), [], 'and neither read nor wrote weeks 1 to 3 again');
    eq([r.thirdReads, r.thirdWrites], [[], []], 'a third sync, with nothing new, touches no projection document');
    eq(r.rewrites, [], 'no copy was ever written over');
    eq(r.deletes, [], 'and nothing was deleted');
    ok('the sync record is what the bar has always kept', r.recordKeys.join(',') === 'at,ok,reason,wrote', r.recordKeys);
  },
};

// ===========================================================================
// THE BAR, AS A CHILD
// ===========================================================================

async function barChild() {
  const { bootDom, waitFor, LEAGUE, SEASON: S } = await import('./cap-harness.mjs');
  const TEAMS = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Manager ${i + 1}` }));
  const rec = (w) => ({ ...makeRec(w), leagueId: LEAGUE, season: S });
  const base = `leagues/${LEAGUE}/seasons/${S}`;
  const fake = makeFake();
  cloud.configure({ transport: fake, ownerUid: '' });

  // Another browser sent week 1 some time ago.
  const seeded = await cloud.syncUp(LEAGUE, S, { leagueName: 'x', teams: [], projhist: [rec(1)] });
  if (!seeded.ok) throw new Error(`seed failed: ${seeded.reason}`);
  const week1 = fake.docs.get(`${base}/projhist/1`);

  const { document, map } = bootDom({
    html: '<!DOCTYPE html><html><body><div id="connBar"></div></body></html>',
    store: {
      'ff.connection': { leagueId: LEAGUE, season: S, teamId: 1 },
      [`ff.projhist.1.${LEAGUE}.${S}.2`]: rec(2),
      [`ff.projhist.1.${LEAGUE}.${S}.3`]: rec(3),
    },
    bridge: true,
    teams: TEAMS,
  });
  const captured = [];
  document.addEventListener('ff:capture', (e) => captured.push(e.detail));
  const record = () => (JSON.parse(map.get('ff.cloud') || '{}'))[`${LEAGUE}::${S}`] || null;
  const sent = () => Object.keys(((JSON.parse(map.get('ff.cloud.projhist') || '{}'))[`${LEAGUE}::${S}`] || {}).sent || {});
  const histTouched = (list, from) => list.slice(from).filter(isHist).map(tail);

  fake.log.reads.length = 0;
  fake.log.writes.length = 0;
  await import(moduleUrl('js/connection.js'));
  const first = await waitFor(record, 20000);
  await waitFor(() => captured.length, 20000);
  await new Promise((r) => setTimeout(r, 100));
  const sentAfterFirst = sent();
  const cloudDocs = [...fake.docs.keys()].filter(isHist).map(tail);

  /** Another auto-sync: forget the throttle's record and reconnect. */
  const again = async () => {
    const marks = [fake.log.reads.length, fake.log.writes.length];
    map.delete('ff.cloud');
    const btn = document.getElementById('connSync');
    btn.dispatchEvent(new globalThis.Event('click'));
    const rec2 = await waitFor(record, 20000);
    await new Promise((r) => setTimeout(r, 100));
    return { rec: rec2, reads: histTouched(fake.log.reads, marks[0]), writes: histTouched(fake.log.writes, marks[1]) };
  };
  const second = await again();
  const third = await again();

  const held1 = map.get(`ff.projhist.1.${LEAGUE}.${S}.1`);
  return {
    first, sentAfterFirst, cloudDocs,
    heldWeek1: Boolean(held1),
    week1Same: Boolean(held1) && held1 === JSON.stringify(rec(1)) && fake.docs.get(`${base}/projhist/1`) === week1,
    second: second.rec,
    secondTouched: [...second.reads, ...second.writes],
    thirdReads: third.reads, thirdWrites: third.writes,
    rewrites: fake.log.rewrites.filter((p) => isHist(p) && tail(p) !== 'index'),
    deletes: fake.log.deletes,
    recordKeys: first ? Object.keys(first).sort() : [],
  };
}

if (process.argv[2] === '--bar-child') {
  try {
    emit(await barChild(), 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

// ===========================================================================
// RUN
// ===========================================================================

const asked = process.argv[2];
const names = asked ? [asked] : Object.keys(SCENARIOS);
for (const name of names) {
  scenario = name;
  if (!SCENARIOS[name]) { fails.push(`no scenario named ${name}`); continue; }
  const before = fails.length;
  const passedBefore = pass;
  try {
    await SCENARIOS[name]();
  } catch (err) {
    fails.push(`[${name}] threw — ${String((err && err.stack) || err).slice(0, 500)}`);
  }
  console.log(`${fails.length === before ? 'PASS' : 'FAIL'} ${name}  (${pass - passedBefore} passed, ${fails.length - before} failed)`);
}

// Everything this code wrote, across every scenario: only `…/projhist/…`
// (the league index is the sync's own and always was), and nothing deleted.
scenario = 'all';
const everyWrite = ALL_FAKES.flatMap((f) => f.log.writes);
// (the payload scenario's sync also writes its schedule, as it always did.)
eq(everyWrite.filter((p) => !isHist(p) && p !== BASE && p !== BASE + '/parts/schedule'), [], 'no path outside …/projhist/ was written');
eq(ALL_FAKES.flatMap((f) => f.log.deletes), [], 'nothing was deleted anywhere');
eq(ALL_FAKES.flatMap((f) => f.log.rewrites).filter((p) => p !== BASE && !/\/projhist\/index$/.test(p)), [],
  'and no copy was ever replaced by different content');

for (const f of fails) console.log(`   ✗ ${f}`);
console.log(fails.length ? `\n${fails.length} FAILED, ${pass} passed` : `\nall ${pass} assertions passed`);
process.exit(fails.length ? 1 : 0);
