// The time machine's storage: js/snapshots.js.
//
//   node test-snapshots.mjs
//
// This module exists because ESPN keeps no history of its own projections, so a
// forecast that is not captured while it is on screen is gone permanently.
// Everything below is therefore about ONE property: what comes back out has to
// be what went in, months later, through a file, and after the live numbers
// have moved on underneath it.

let store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

const snapshots = await import('../js/snapshots.js');

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra ? ` — ${String(extra).slice(0, 240)}` : ''}`);
};
const eq = (a, b, msg) => ok(msg, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const same = (a, b, msg) =>
  ok(msg, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---------------------------------------------------------------- a fixture
//
// A three-team, four-week league, small enough that every number below can be
// checked by eye.

function makeState(week, { scores = true } = {}) {
  const games = [
    { week: 1, homeId: 1, homeName: 'A', homeScore: 110, awayId: 2, awayName: 'B', awayScore: 100, played: true },
    { week: 1, homeId: 3, homeName: 'C', homeScore: 90, awayId: null, awayName: 'BYE', awayScore: null, played: true },
    { week: 2, homeId: 1, homeName: 'A', homeScore: scores ? 120 : null, awayId: 3, awayName: 'C', awayScore: scores ? 95 : null, played: scores },
    { week: 3, homeId: 2, homeName: 'B', homeScore: null, awayId: 3, awayName: 'C', awayScore: null, played: false },
    { week: 4, homeId: 1, homeName: 'A', homeScore: null, awayId: 2, awayName: 'B', awayScore: null, played: false },
  ];
  const byWeek = new Map();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week).push(g);
  }
  return {
    data: {
      leagueName: 'Test League',
      teams: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }],
      weeks: [1, 2, 3, 4],
      byWeek,
      games,
      isDemo: false,
    },
    projection: {
      proj: new Map([
        [3, new Map([[1, 110.5], [2, 101.25], [3, 99.4]])],
        [4, new Map([[1, 112.1], [2, 103.6], [3, 97.2]])],
      ]),
      slots: [0, 2, 2, 4, 4, 6, 16, 17, 23],
      strength: new Map([[1, 111.3], [2, 102.4], [3, 98.3]]),
      weeksCovered: [3, 4],
      note: 'the projection note',
    },
    strengthNote: 'the strength note',
    week,
  };
}

const LEAGUE = { leagueId: '476225250', season: 2026 };

function capture(week, extra = {}) {
  const s = makeState(week);
  return snapshots.snapshotFrom({
    ...LEAGUE,
    week,
    data: s.data,
    projection: s.projection,
    strengthNote: s.strengthNote,
    sigma: 26.4,
    calibrated: true,
    sample: 18,
    ...extra,
  });
}

// ------------------------------------------------------------- what is kept

const snap = capture(3);
eq(snap.v, snapshots.SCHEMA, 'a snapshot carries its schema version');
eq(snap.week, 3, 'and the week it is a view as of');
eq(snap.leagueId, '476225250', 'and which league');
eq(snap.season, 2026, 'and which season');
ok('and when it was taken', !Number.isNaN(new Date(snap.takenAt).getTime()), snap.takenAt);
eq(snap.games.length, 5, 'every game is kept, byes included');
eq(snap.teams.length, 3, 'every team is kept');

// SIGMA IS KEPT, and this is not incidental. It is learned from results, so it
// moves as the season goes on; replaying week 3 with week 12's spread would
// re-forecast the past with knowledge it did not have.
eq(snap.sigma, 26.4, 'the scoring spread in force at the time is kept');
eq(snap.sigmaCalibrated, true, 'and whether it was measured or assumed');
eq(snap.sigmaSample, 18, 'and how much it was measured from');

same(snap.proj['3'], { 1: 110.5, 2: 101.3, 3: 99.4 }, 'per-week projections are kept, rounded to a tenth');
same(snap.strength, { 1: 111.3, 2: 102.4, 3: 98.3 }, 'and the strength derived from them');
same(snap.slots, [0, 2, 2, 4, 4, 6, 16, 17, 23], 'and the lineup shape they were filled against');
eq(snap.projNote, 'the projection note', 'and the note that explains them');
eq(snap.strengthNote, 'the strength note', 'and the one that explains the strength');

// A bye survives as a bye. `played` matters as much as the scores: it is what
// separates a finished game from one still being played.
const bye = snap.games.find((g) => g.awayId === null);
ok('a bye keeps its null opponent rather than becoming a zero', bye && bye.awayScore === null, JSON.stringify(bye));
ok('every game keeps its played flag',
  snap.games.every((g) => typeof g.played === 'boolean'));

// It has to be small, or a season of them will not fit in a browser.
const bytes = JSON.stringify(snap).length;
ok('a snapshot is kilobytes, not megabytes', bytes < 8000, `${bytes} bytes`);

// ---- IT IS A COPY, NOT A VIEW ------------------------------------------
//
// The snapshot is built by spreading live objects, so the one thing that would
// silently destroy the whole feature is a shared reference: the archive would
// then quietly change every time the live season did.
{
  const live = makeState(3);
  const taken = snapshots.snapshotFrom({
    ...LEAGUE, week: 3, data: live.data, projection: live.projection,
    strengthNote: live.strengthNote, sigma: 26.4, calibrated: true, sample: 18,
  });
  const before = JSON.stringify(taken);

  // The season moves on underneath it.
  live.data.games[3].homeScore = 130;
  live.data.games[3].awayScore = 88;
  live.data.games[3].played = true;
  live.data.teams[0].name = 'A renamed';
  live.projection.proj.get(4).set(1, 999);
  live.projection.strength.set(1, 999);

  eq(JSON.stringify(taken), before, 'the archive does not move when the live season does');
  eq(taken.games[3].homeScore, null, 'a game played after the reading is still unplayed in it');
  eq(taken.teams[0].name, 'A', 'a team renamed afterwards keeps its old name');
  eq(taken.proj['4'][1], 112.1, 'a projection revised afterwards keeps the old number');
}

// ---------------------------------------------------------------- hydrating

{
  const built = snapshots.hydrate(snap);
  ok('a snapshot hydrates', Boolean(built), 'null');
  eq(built.data.leagueName, 'Test League', 'the league name comes back');
  same(built.data.weeks, [1, 2, 3, 4], 'the weeks come back in order');
  eq(built.data.byWeek.get(1).length, 2, 'byWeek is rebuilt, not stored');
  eq(built.data.isDemo, false, 'and it remembers it was real data');
  eq(built.data.games.length, 5, 'every game comes back');

  // The shapes have to be the ones the page already renders from, or replaying
  // becomes a second rendering path that can disagree with the first.
  ok('proj comes back as a Map of Maps', built.projection.proj instanceof Map &&
    built.projection.proj.get(3) instanceof Map);
  eq(built.projection.proj.get(3).get(1), 110.5, 'with the numbers intact');
  eq(built.projection.proj.get(4).get(2), 103.6, 'for every week');
  ok('strength comes back as a Map', built.projection.strength instanceof Map);
  eq(built.projection.strength.get(2), 102.4, 'with the numbers intact');
  ok('team ids come back as NUMBERS, not the strings JSON made of them',
    [...built.projection.proj.get(3).keys()].every((k) => typeof k === 'number'),
    [...built.projection.proj.get(3).keys()].map((k) => typeof k).join(','));
  ok('and so do week keys',
    [...built.projection.proj.keys()].every((k) => typeof k === 'number'));
  eq(built.strengthNote, 'the strength note', 'the strength note comes back');

  // Hydrating twice must not share state either.
  const a = snapshots.hydrate(snap);
  const b = snapshots.hydrate(snap);
  a.data.games[0].homeScore = 1;
  eq(b.data.games[0].homeScore, 110, 'two hydrations do not share their games');
}

eq(snapshots.hydrate(null), null, 'nothing hydrates to nothing');
eq(snapshots.hydrate({ v: 999 }), null, 'a future schema is refused rather than half-read');

// A snapshot taken before any projection existed still hydrates — it is a
// schedule with no forecast in it, which is a real thing to have recorded.
{
  const bare = snapshots.snapshotFrom({
    ...LEAGUE, week: 1, data: makeState(1).data, projection: null, strengthNote: '',
    sigma: null, calibrated: false, sample: 0,
  });
  const built = snapshots.hydrate(bare);
  ok('a reading with no forecast still hydrates', Boolean(built));
  eq(built.projection, null, 'and reports having no projection rather than an empty one');
  eq(bare.sigma, null, 'and no spread');
}

// ------------------------------------------------------------------ storage

store.clear();
eq(snapshots.available(), true, 'storage is available in this harness');
same(snapshots.list(LEAGUE.leagueId, LEAGUE.season), [], 'an empty archive lists nothing');
eq(snapshots.get(LEAGUE.leagueId, LEAGUE.season, 3), null, 'and holds nothing');

ok('saving works', snapshots.save(capture(3)).ok);
ok('saving a second week works', snapshots.save(capture(5)).ok);
ok('and a first week', snapshots.save(capture(1)).ok);
same(snapshots.list(LEAGUE.leagueId, LEAGUE.season).map((s) => s.week), [1, 3, 5],
  'the archive lists in week order, however it was written');
eq(snapshots.get(LEAGUE.leagueId, LEAGUE.season, 3).week, 3, 'one week reads back');

// ONE KEY PER SNAPSHOT. A single key for the whole archive would mean a quota
// failure while saving week 9 takes weeks 1 to 8 with it.
eq(store.size, 3, 'one storage key per snapshot');
ok('and the keys name what they hold',
  [...store.keys()].every((k) => /^ff\.snap\.476225250\.2026\.\d+$/.test(k)),
  [...store.keys()].join(','));

// Two leagues, and a demo archive, must not see each other.
snapshots.save(snapshots.snapshotFrom({
  leagueId: 'demo', season: 0, week: 3, data: makeState(3).data, projection: null,
}));
snapshots.save(snapshots.snapshotFrom({
  leagueId: '999', season: 2026, week: 3, data: makeState(3).data, projection: null,
}));
same(snapshots.list(LEAGUE.leagueId, LEAGUE.season).map((s) => s.week), [1, 3, 5],
  'another league does not appear in this one');
same(snapshots.list('demo', 0).map((s) => s.week), [3], 'and the sample data has its own archive');
same(snapshots.list('999', 2026).map((s) => s.week), [3], 'and so does the other league');

eq(snapshots.remove(LEAGUE.leagueId, LEAGUE.season, 3), true, 'one week can be deleted');
same(snapshots.list(LEAGUE.leagueId, LEAGUE.season).map((s) => s.week), [1, 5], 'and it goes');
ok('deleting a week that was never there is not an error',
  snapshots.remove(LEAGUE.leagueId, LEAGUE.season, 99) === true);

ok('the archive reports roughly what it is taking up',
  snapshots.sizeOf(LEAGUE.leagueId, LEAGUE.season) > 100 &&
  snapshots.sizeOf(LEAGUE.leagueId, LEAGUE.season) < 20000,
  snapshots.sizeOf(LEAGUE.leagueId, LEAGUE.season));

// ---- one bad key must not hide the rest --------------------------------
store.set('ff.snap.476225250.2026.7', '{ this is not json');
same(snapshots.list(LEAGUE.leagueId, LEAGUE.season).map((s) => s.week), [1, 5],
  'an unreadable key is skipped rather than throwing the whole list away');
eq(snapshots.get(LEAGUE.leagueId, LEAGUE.season, 7), null, 'and reads back as absent');
store.delete('ff.snap.476225250.2026.7');

// ---- a full or hostile browser -----------------------------------------
{
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    get length() { return 0; },
    key: () => null,
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => { throw new Error('blocked'); },
  };
  eq(snapshots.available(), false, 'a browser that blocks storage reports as unavailable');
  const res = snapshots.save(capture(3));
  eq(res.ok, false, 'saving fails rather than throwing');
  ok('and says what to do about it', /store|Export/.test(res.reason), res.reason);
  same(snapshots.list(LEAGUE.leagueId, LEAGUE.season), [], 'listing returns nothing rather than throwing');
  eq(snapshots.get(LEAGUE.leagueId, LEAGUE.season, 1), null, 'reading returns nothing rather than throwing');
  eq(snapshots.sizeOf(LEAGUE.leagueId, LEAGUE.season), 0, 'and the size is zero, not an exception');
  globalThis.localStorage = real;
}

eq(snapshots.save(null).ok, false, 'saving nothing is refused');
eq(snapshots.save({ leagueId: 'x' }).ok, false, 'saving something shapeless is refused');

// ---------------------------------------------------------- export / import

store.clear();
snapshots.save(capture(1));
snapshots.save(capture(2));
snapshots.save(capture(3));

const file = snapshots.exportAll(LEAGUE.leagueId, LEAGUE.season);
eq(file.count, 3, 'the export carries every week');
ok('and is named after the league and season',
  file.name === 'fantasy-archive-476225250-2026.json', file.name);
ok('and is readable JSON', (() => { try { JSON.parse(file.json); return true; } catch { return false; } })());
ok('and is pretty-printed, because a person may open it',
  file.json.includes('\n  '), file.json.slice(0, 40));

// THE ROUND TRIP THAT MATTERS: through a file, into an empty browser, back out.
{
  const text = file.json;
  store.clear();
  same(snapshots.list(LEAGUE.leagueId, LEAGUE.season), [], 'the browser is empty again');

  const parsed = snapshots.parseImport(text);
  eq(parsed.error, null, 'the file parses');
  eq(parsed.snapshots.length, 3, 'with every week in it');

  const res = snapshots.importAll(parsed.snapshots);
  eq(res.added, 3, 'every week is restored');
  eq(res.kept, 0, 'nothing was already there to keep');
  same(res.failed, [], 'and nothing failed');
  same(snapshots.list(LEAGUE.leagueId, LEAGUE.season).map((s) => s.week), [1, 2, 3],
    'the archive is back');

  const back = snapshots.get(LEAGUE.leagueId, LEAGUE.season, 2);
  eq(back.sigma, 26.4, 'and the spread survived the trip');
  eq(back.proj['3'][1], 110.5, 'and so did the projections');
  const built = snapshots.hydrate(back);
  eq(built.projection.proj.get(4).get(3), 97.2, 'and it still hydrates into the page shapes');
}

// An import is a RESTORE: a week this browser already recorded is the closer
// reading of the two, so it is kept rather than overwritten.
{
  const mine = capture(2, { sigma: 11.1 });
  snapshots.remove(LEAGUE.leagueId, LEAGUE.season, 2);
  snapshots.save(mine);
  const res = snapshots.importAll(snapshots.parseImport(file.json).snapshots);
  // All three weeks are already here, so all three are kept — including the
  // week 2 this browser recorded itself, which is the one that matters.
  eq(res.kept, 3, 'a week already here is kept, not overwritten');
  eq(res.added, 0, 'nothing needed adding');
  eq(snapshots.get(LEAGUE.leagueId, LEAGUE.season, 2).sigma, 11.1, 'and it is still this browser’s copy');

  const forced = snapshots.importAll(snapshots.parseImport(file.json).snapshots, { replace: true });
  eq(forced.added, 3, 'replace: true overwrites deliberately');
  eq(snapshots.get(LEAGUE.leagueId, LEAGUE.season, 2).sigma, 26.4, 'and the file wins that time');
}

// ---- what a person might actually drop on it ---------------------------
eq(snapshots.parseImport('not json at all').error, 'That file is not JSON.', 'a non-JSON file is named as such');
eq(snapshots.parseImport('{}').snapshots.length, 0, 'an empty object holds no snapshots');
ok('and says so', /No snapshots/.test(snapshots.parseImport('{}').error));
ok('a bare snapshot imports as readily as an envelope',
  snapshots.parseImport(JSON.stringify(capture(4))).snapshots.length === 1);
ok('so does a bare array of them',
  snapshots.parseImport(JSON.stringify([capture(4), capture(5)])).snapshots.length === 2);
{
  const future = snapshots.parseImport(JSON.stringify({ v: 99, snapshots: [] }));
  ok('a file from a newer build says so by version rather than "no snapshots"',
    /version 99/.test(future.error), future.error);
}
{
  // Half a file: the good snapshots come through, the rubbish does not.
  const mixed = JSON.stringify({ v: snapshots.SCHEMA, snapshots: [capture(6), { nope: true }, null] });
  const got = snapshots.parseImport(mixed);
  eq(got.snapshots.length, 1, 'a partly-corrupt file yields what is readable');
  eq(got.error, null, 'and is not rejected wholesale');
}

// ---------------------------------------------------------------------------

if (fails.length) {
  for (const f of fails.slice(0, 25)) console.log('FAIL ' + f);
  if (fails.length > 25) console.log(`… and ${fails.length - 25} more`);
}
console.log(`${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
