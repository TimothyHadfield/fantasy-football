// Export archive / Import: the whole of what this browser keeps, in one file —
// js/backup.js.
//
//   node test-backup.mjs
//
// Why this suite exists: ESPN overwrites its projections, so the readings, the
// projection copies and the Decisions weeks in this browser are the only copy
// there is, and the export is what outlives the browser. An export that leaves
// one kind out, or an import that overwrites the week already here, loses data
// nobody can fetch again — and would say "Imported" while doing it. So: the
// file holds every kind; it comes back byte for byte; nothing here is ever
// overwritten; the old file still imports; an old build still reads the new
// file; and the preferences follow their own, more careful, rule.
//
// The reading and the projection copy are REAL ones: js/capture.js run on
// cap-stub-season.mjs (ten squads, weeks 4–16), plus the two v1 readings in
// snap-v1-fixture.json exactly as an old build stored them.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { HERE, moduleUrl } from './repo.mjs';
import { LEAGUE, SEASON } from './cap-harness.mjs';

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`);
};
const eq = (a, b, name) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// A real Storage's methods over a Map.
let store = new Map();
globalThis.localStorage = {
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
  clear: () => store.clear(),
};

const capture = await import(moduleUrl('js/capture.js'));
const snapshots = await import(moduleUrl('js/snapshots.js'));
const history = await import(moduleUrl('js/proj-history.js'));
const prefs = await import(moduleUrl('js/prefs.js'));
const stub = await import('./cap-stub-season.mjs');
// Loaded softly, so that against a build without the module every assertion
// below fails by name instead of the suite dying on the import.
const backup = await import(moduleUrl('js/backup.js')).catch(() => ({
  exportBackup: (l, s) => snapshots.exportAll(l, s),
  parseBackup: (t) => ({ ...snapshots.parseImport(t), projhist: [], projhistPart: [], decisions: [], prefs: null }),
  importBackup: (f) => ({ ...snapshots.importAll(f.snapshots), parts: {}, prefs: { mode: 'none', trades: 0 } }),
}));

const KEPT = /^ff\.(snap\.|projhist\.1\.|projhist-part\.1\.|decisions\.1\.|prefs$)/;
const dump = () => Object.fromEntries([...store.keys()].filter((k) => KEPT.test(k)).sort().map((k) => [k, store.get(k)]));
const SNAP = (w) => `ff.snap.${LEAGUE}.${SEASON}.${w}`;
const HIST = (w) => `ff.projhist.1.${LEAGUE}.${SEASON}.${w}`;
const PART = (w) => `ff.projhist-part.1.${LEAGUE}.${SEASON}.${w}`;
const DEC = (w) => `ff.decisions.1.${LEAGUE}.${SEASON}.${w}`;

// ---- what a real browser holds, mid-season -----------------------------------
const TRADE_1 = { a: 1, b: 2, sendA: ['4262921'], sendB: ['3116406', '15847'] };
const TRADE_2 = { a: 3, b: 7, sendA: ['4426348'], sendB: ['4241389'] };
const ASSUMED = { entry: { a: 4, b: 5, sendA: ['2976212'], sendB: ['4047365'] }, src: 'saved', at: 1759700000000 };
const PREFS = {
  'schedule.source': 'live', 'schedule.week': 4, 'trade.goal': 'title',
  'trade.custom': [TRADE_1, TRADE_2], 'trade.assumed': ASSUMED, 'waivers.team': 7,
};
store.set('ff.prefs', JSON.stringify(PREFS));

// Week 4: the reading and every squad's copy, as the bar's route writes them.
const taken = await capture.captureIfDue({
  leagueId: LEAGUE, season: SEASON, bridgePresent: true, teamId: 1,
  fetchSchedule: stub.fetchSchedule, fetchWeeksRosters: stub.fetchWeeksRosters,
  cloudSource: async () => null, fetchRemote: async () => ({ added: 0, kept: 0, found: 0 }),
});
eq(taken.code, 'recorded', 'the fixture: week 4 was really recorded');
ok('with its reading and its copy', store.has(SNAP(4)) && store.has(HIST(4)), [...store.keys()].join(' '));
ok('the copy is a real size (ten squads, thirteen weeks)', store.get(HIST(4)).length > 10000, store.get(HIST(4)).length);

// Weeks 1 and 2: v1 readings, exactly as an old build stored them.
const V1 = JSON.parse(readFileSync(path.join(HERE, 'snap-v1-fixture.json'), 'utf8')).raw;
V1.forEach((raw, i) => store.set(SNAP(i + 1), raw.replace('"leagueId":"476225250"', `"leagueId":"${LEAGUE}"`)));

// Week 3: a one-team copy that came down from the cloud, and a decided week.
const whole = JSON.parse(store.get(HIST(4)));
store.set(PART(3), JSON.stringify({ ...whole, week: 3, takenAt: '2026-09-22T17:00:00.000Z', teams: { 1: whole.teams[1] }, partial: true }));
const players = {};
for (let i = 0; i < 60; i++) players[4000000 + i * 37] = { name: `Free Agent ${i}`, position: 'WR', proTeamId: (i % 32) + 1, projected: 7.25 + i / 10, actual: i % 9 };
for (const w of [2, 3]) {
  store.set(DEC(w), JSON.stringify({
    v: 1, at: 1759000000000 + w, players, draft: w === 2 ? { 1: [4262921, 15847] } : null,
    moves: [{ type: 'FREEAGENT', teamId: 3, week: w, items: [{ type: 'ADD', playerId: 4000037 }, { type: 'DROP', playerId: 15847 }] }],
  }));
}
// Things that are NOT the archive, and must be left out of the file.
store.set(`ff.snapnote.${LEAGUE}.${SEASON}`, JSON.stringify({ at: 1, ok: true, week: 4 }));
store.set(`ff.decisions-open.1.${LEAGUE}.${SEASON}`, JSON.stringify({ v: 1, week: 4, at: 5, moves: [], players: {} }));
store.set('ff.snap.777.2026.4', store.get(SNAP(4)).replace(`"leagueId":"${LEAGUE}"`, '"leagueId":"777"'));

const OTHER = 'ff.snap.777.2026.4';
const before = dump();
delete before[OTHER];
eq(Object.keys(before).length, 8, 'the fixture holds eight things for this league: 3 readings, 1 copy, 1 one-team copy, 2 decisions weeks, the preferences');

// =========================================================================
// 1. THE FILE
// =========================================================================

const oldFile = snapshots.exportAll(LEAGUE, SEASON);   // what Export archive wrote before
const file = backup.exportBackup(LEAGUE, SEASON);
const body = JSON.parse(file.json);
// Against a build that writes readings only, these are empty rather than absent.
const held = { projhist: body.projhist || [], projhistPart: body.projhistPart || [], decisions: body.decisions || [] };

eq(file.name, oldFile.name, 'the file keeps its name');
eq([body.v, body.leagueId, body.season], [snapshots.SCHEMA, LEAGUE, SEASON], 'and the envelope an old build wrote');
eq(body.snapshots, JSON.parse(oldFile.json).snapshots, 'the readings are in it exactly as before');
ok('the readings still sit at the front, in the same text',
  file.json.startsWith(oldFile.json.replace(/"exportedAt": "[^"]+"/, `"exportedAt": "${body.exportedAt}"`).replace(/\n\}$/, '')));
eq(body.backup, 1, 'it says it is a backup, version 1');
eq(held.projhist.map((r) => r.week), [4], 'every team’s projection copy is in it');
eq(held.projhistPart.map((r) => [r.week, r.partial]), [[3, true]], 'and the one-team copy');
eq(held.decisions.map((d) => [d.leagueId, d.season, d.week]), [[LEAGUE, SEASON, 2], [LEAGUE, SEASON, 3]], 'and both decided weeks');
eq(body.prefs, PREFS, 'and the preferences, saved and assumed trades included');
eq([file.count, file.weeks], [4, [1, 2, 3, 4]], 'it counts the weeks it holds anything for');
ok('another league’s reading is not in it', !file.json.includes('"leagueId": "777"') && !file.json.includes('"leagueId":"777"'));
ok('nor the week in play’s decisions, nor the attempt note', !/decisions-open|snapnote/.test(file.json) && held.decisions.length === 2);
ok('a copy is one line, not thirteen numbers down the page',
  file.json.split('\n').some((l) => l.startsWith('    {"v":1,') && l.length > 10000));

eq(snapshots.parseImport(file.json).snapshots.map((s) => s.week), [1, 2, 4],
  'A BUILD FROM BEFORE THIS reads the new file’s readings');

// =========================================================================
// 2. EVERYTHING GONE, THEN THE FILE BACK
// =========================================================================
{
  store.clear();
  const parsed = backup.parseBackup(file.json);
  eq(parsed.error, null, 'the file parses');
  const res = backup.importBackup(parsed);
  const after = dump();
  eq(Object.keys(after), Object.keys(before), 'every key is back');
  for (const k of Object.keys(before)) ok(`${k} is back byte for byte`, after[k] === before[k], `${(after[k] || '').length} vs ${before[k].length} chars`);
  eq([res.added, res.kept, res.failed], [4, 0, []], 'it reports four weeks added, none already here');
  eq(res.parts, {
    readings: { added: 3, kept: 0 }, projhist: { added: 1, kept: 0 },
    projhistPart: { added: 1, kept: 0 }, decisions: { added: 2, kept: 0 },
  }, 'and each kind’s own count');
  eq(res.prefs, { mode: 'restored', trades: 0 }, 'a browser with no preferences got the file’s, whole');
  ok('the v1 readings are still v1', JSON.parse(after[SNAP(1)]).v === 1 && JSON.parse(after[SNAP(2)]).v === 1);
  eq(history.list(LEAGUE, SEASON).map((e) => [e.week, e.source]), [[3, 'cloud'], [4, 'store']],
    'and the projection history reads them as it did');
}

// =========================================================================
// 3. IMPORT NEVER OVERWRITES
// =========================================================================
{
  // Every kind here differs from the file's. All of it must survive.
  const mark = (k, from, to) => { if (store.has(k)) store.set(k, store.get(k).replace(from, to)); };
  mark(SNAP(4), /"takenAt":"[^"]+"/, '"takenAt":"2001-01-01T00:00:00.000Z"');
  mark(SNAP(1), /"takenAt":"[^"]+"/, '"takenAt":"2001-01-01T00:00:00.000Z"');
  mark(HIST(4), /"takenAt":"[^"]+"/, '"takenAt":"2001-01-01T00:00:00.000Z"');
  mark(PART(3), /"takenAt":"[^"]+"/, '"takenAt":"2001-01-01T00:00:00.000Z"');
  mark(DEC(2), '"at":1759000000002', '"at":1');
  prefs.set('schedule.week', 9);
  const mine = dump();
  ok('the fixture really differs from the file', Object.keys(before).filter((k) => mine[k] !== before[k]).length === 6);

  const res = backup.importBackup(backup.parseBackup(file.json));
  eq(dump(), mine, 'importing over a browser that holds every week changes NOTHING');
  eq([res.added, res.kept, res.failed], [0, 4, []], 'it reports none added, four already here');
  eq(res.prefs, { mode: 'merged', trades: 0 }, 'and no trade added: they were all here');

  // One week missing here, the rest present.
  store.delete(HIST(4));
  store.delete(DEC(3));
  const partRes = backup.importBackup(backup.parseBackup(file.json));
  eq([partRes.added, partRes.kept], [2, 2], 'a week with one thing missing counts as added; the others as already here');
  eq(partRes.parts.projhist, { added: 1, kept: 0 }, 'the missing copy went in');
  ok('exactly as the file had it', store.get(HIST(4)) === before[HIST(4)] && store.get(DEC(3)) === before[DEC(3)]);
  ok('and the reading beside it was left alone', store.get(SNAP(4)) === mine[SNAP(4)]);
}

// =========================================================================
// 4. THE PREFERENCES
// =========================================================================
{
  // This browser: one trade the file has (written from the other side), one of
  // its own, and its own assumed trade.
  const flipped = { a: 2, b: 1, sendA: ['15847', '3116406'], sendB: ['4262921'] };
  const own = { a: 6, b: 8, sendA: ['1'], sendB: ['2'] };
  const assumedHere = { entry: { a: 9, b: 10, sendA: ['3'], sendB: ['4'] }, src: 'saved', at: 5 };
  prefs.set('trade.custom', [flipped, own]);
  prefs.set('trade.assumed', assumedHere);
  prefs.set('trade.goal', 'last');
  prefs.set('waivers.team', null);
  const mine = JSON.parse(store.get('ff.prefs'));

  const res = backup.importBackup(backup.parseBackup(file.json));
  const now = JSON.parse(store.get('ff.prefs'));
  eq(res.prefs, { mode: 'merged', trades: 2 }, 'two trades were added: the one it lacked, and the one the file had assumed');
  eq(now['trade.custom'], [flipped, own, TRADE_2, ASSUMED.entry],
    'its own saved trades first and untouched, the same trade from the other side not doubled');
  eq(now['trade.assumed'], assumedHere, 'ITS ASSUMED TRADE IS NOT REPLACED by the file’s');
  eq([now['trade.goal'], now['schedule.week']], ['last', 9], 'no setting it has is overwritten');
  ok('and a setting it does not have is not brought in', !('waivers.team' in now), JSON.stringify(now));
  eq(Object.keys(now), Object.keys(mine), 'no preference was added or removed');

  const again = backup.importBackup(backup.parseBackup(file.json));
  eq(again.prefs, { mode: 'merged', trades: 0 }, 'importing the same file twice adds nothing the second time');
  eq(JSON.parse(store.get('ff.prefs'))['trade.custom'].length, 4, 'and the list does not grow');

  // Nothing assumed here: the file's assumed trade must not switch itself on.
  prefs.set('trade.assumed', null);
  prefs.set('trade.custom', []);
  backup.importBackup(backup.parseBackup(file.json));
  const quiet = JSON.parse(store.get('ff.prefs'));
  ok('with nothing assumed here, the file’s assumed trade comes back SAVED, not assumed',
    !('trade.assumed' in quiet) && quiet['trade.custom'].length === 3, JSON.stringify(quiet));

  // A list this build cannot read is left exactly as it is.
  prefs.set('trade.custom', 'not a list');
  const odd = backup.importBackup(backup.parseBackup(file.json));
  eq([odd.prefs.trades, JSON.parse(store.get('ff.prefs'))['trade.custom']], [0, 'not a list'], 'a saved-trades list it cannot read is not touched');
}

// =========================================================================
// 5. THE OLD FILE, AND FILES THAT ARE WRONG
// =========================================================================
{
  store.clear();
  prefs.set('schedule.week', 9);
  const prefsBefore = store.get('ff.prefs');
  const parsed = backup.parseBackup(oldFile.json);
  eq([parsed.error, parsed.snapshots.length, parsed.projhist.length, parsed.decisions.length, parsed.prefs], [null, 3, 0, 0, null],
    'THE OLD FILE parses: three readings and nothing else');
  const res = backup.importBackup(parsed);
  eq([res.added, res.kept, res.failed], [3, 0, []], 'and imports: three weeks added');
  for (const w of [1, 2, 4]) ok(`its week ${w} reading is byte for byte`, store.get(SNAP(w)) === before[SNAP(w)]);
  eq(res.prefs, { mode: 'none', trades: 0 }, 'it has no preferences to bring');
  ok('so these are untouched', store.get('ff.prefs') === prefsBefore);
  eq(Object.keys(dump()).length, 4, 'and nothing else was written');

  // A bare reading, and an array of them, as `snapshots.parseImport` takes.
  store.clear();
  eq(backup.importBackup(backup.parseBackup(before[SNAP(4)])).added, 1, 'a bare reading still imports');
  eq(backup.importBackup(backup.parseBackup(`[${before[SNAP(1)]},${before[SNAP(4)]}]`)).parts.readings, { added: 1, kept: 1 }, 'and a plain list of them');

  eq(backup.parseBackup('not json at all').error, 'That file is not JSON.', 'a non-JSON file is named as such');
  eq(backup.parseBackup('{}').error, 'No snapshots in that file.', 'an empty file says it holds nothing');
  eq(backup.parseBackup(JSON.stringify({ v: 2, snapshots: [], backup: 1, projhist: held.projhist })).error, null,
    'a backup with copies and no readings is still worth importing');

  // Records that are not what they claim to be are refused, one by one.
  store.clear();
  const bad = backup.importBackup(backup.parseBackup(JSON.stringify({
    v: 2, snapshots: [], backup: 1,
    projhist: [{ ...held.projhistPart[0] }, { v: 9, leagueId: LEAGUE, season: SEASON, week: 6, weeks: [6], teams: {} }],
    projhistPart: [{ ...held.projhist[0] }],
    decisions: [
      { leagueId: LEAGUE, season: SEASON, week: 5, record: { v: 1, moves: 'none', players: {} } },
      { leagueId: 'demo', season: SEASON, week: 5, record: held.decisions[0]?.record },
      { leagueId: LEAGUE, season: SEASON, week: 'x', record: held.decisions[0]?.record },
    ],
  })));
  eq([bad.added, bad.kept, bad.failed.length], [0, 0, 6], 'a one-team copy filed as whole, a whole one filed as one-team, another schema and three bad decisions weeks: none kept');
  eq(Object.keys(dump()), [], 'and nothing was written');

  // An empty browser exports an empty, well-formed file.
  const none = backup.exportBackup(LEAGUE, SEASON);
  eq([none.count, JSON.parse(none.json).snapshots, JSON.parse(none.json).prefs], [0, [], null], 'an empty browser exports a well-formed file that counts no weeks');
}

// ---------------------------------------------------------------------------

for (const f of fails) console.log('FAIL ' + f);
console.log(fails.length ? `${pass} passed, ${fails.length} failed` : `All ${pass} assertions passed`);
process.exit(fails.length ? 1 : 0);
