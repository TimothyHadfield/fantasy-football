// Projection history: every squad's roster with its projection in every week
// still projected, kept once a week — js/proj-history.js and the hook in
// js/capture.js that writes it.
//
//   node test-proj-history.mjs
//
// Why this suite exists: ESPN overwrites a future week's projection in place
// (PROGRESS rule 8), so "what the sheet looked like in week N" exists only if
// a copy was kept in week N. A week whose copy is missing, partial, taken from
// the wrong place or overwritten later is gone for good, and nothing on screen
// would say so. So: what is written and when, that the first copy wins, that
// it can never cost the weekly reading anything, and what comes back.
//
// Three layers, as in test-capture.mjs:
//   1. js/capture.js and js/proj-history.js driven directly on cap-stub-season.
//   2. The REAL Schedule page on the same stub (child process).
//   3. A bare page with only the connection bar and the extension simulated,
//      holding a reading but no copy — the state every browser is in the day
//      this ships.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { bootDom, waitFor, LEAGUE, SEASON } from './cap-harness.mjs';
import { emit } from './emit.mjs';

const self = fileURLToPath(import.meta.url);
const SNAP_KEY = `ff.snap.${LEAGUE}.${SEASON}.4`;
const HIST_KEY = `ff.projhist.1.${LEAGUE}.${SEASON}.4`;
const NOTE_KEY = `ff.snapnote.${LEAGUE}.${SEASON}`;
const TEAMS = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Manager ${i + 1}` }));
const AHEAD = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

// =========================================================================
// CHILDREN: real pages
// =========================================================================

const CHILDREN = {
  /** The Schedule page on live data: its reading, and the copy beside it. */
  async page() {
    const html = readFileSync(path.join(REPO, 'schedule.html'), 'utf8');
    const { document, map, fetchCalls } = bootDom({
      html,
      store: {
        'ff.prefs': { 'schedule.source': 'live', 'schedule.week': 'all' },
        'ff.connection': { leagueId: LEAGUE, season: SEASON, teamId: 1 },
      },
    });
    await import(moduleUrl('js/schedule-page.js'));
    await waitFor(() => map.get(SNAP_KEY) && /recorded/.test(text(document.getElementById('snapLine'))), 15000);
    const stub = await import('./cap-stub-season.mjs');
    return {
      hist: map.has(HIST_KEY) ? JSON.parse(map.get(HIST_KEY)) : null,
      snapAt: map.has(SNAP_KEY) ? JSON.parse(map.get(SNAP_KEY)).takenAt : null,
      keys: [...map.keys()].filter((k) => k.startsWith('ff.projhist')),
      line: text(document.getElementById('snapLine')),
      rosters: stub.calls.rosters,
      fetchCalls,
    };
  },

  /** The bar, in a browser that holds week 4's reading and no copy of it. */
  async barLate() {
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
    const { document, map, fetchCalls } = bootDom({
      html: '<!DOCTYPE html><html><body><div id="connBar"></div></body></html>',
      store: { 'ff.connection': { leagueId: LEAGUE, season: SEASON, teamId: 1 } },
      bridge: true,
      teams: TEAMS,
    });
    // The reading as an older build left it: taken, with no copy beside it.
    const capture = await import(moduleUrl('js/capture.js'));
    const stub = await import('./cap-stub-season.mjs');
    await capture.captureIfDue({
      leagueId: LEAGUE, season: SEASON, bridgePresent: true, teamId: 1,
      fetchSchedule: stub.fetchSchedule, fetchWeeksRosters: stub.fetchWeeksRosters,
      cloudSource: async () => null, fetchRemote: async () => ({ added: 0, kept: 0, found: 0 }),
    });
    map.delete(HIST_KEY);
    const snapBefore = map.get(SNAP_KEY);
    const noteBefore = map.get(NOTE_KEY);
    stub.calls.rosters.length = 0;
    stub.calls.schedule = 0;
    // PH_LATE_FAIL: ESPN refuses the rosters, so the late copy cannot be taken.
    if (process.env.PH_LATE_FAIL) process.env.CAP_ROSTERS_FAIL = '1';

    const events = [];
    document.addEventListener('ff:capture', (e) => events.push(e.detail));
    // What the quiet "saved" chip said: first when the bar had connected and
    // its attempt had not yet run (the bar announces the connection in between,
    // synchronously), then once the attempt was over.
    const said = [];
    const savedNow = () => {
      const el = document.getElementById('connSaved');
      return el && !el.hasAttribute('hidden') ? text(el) : '';
    };
    document.addEventListener('ff:connection', () => said.push(savedNow()));
    await import(moduleUrl('js/connection.js'));
    await waitFor(() => events.length, 15000);
    await new Promise((r) => setTimeout(r, 100));
    said.push(savedNow());
    const chip = document.getElementById('connCapture');
    const saved = document.getElementById('connSaved');
    return {
      saved: saved ? {
        text: savedNow(), title: saved.getAttribute('title'), tag: saved.tagName,
        after: saved.previousElementSibling && saved.previousElementSibling.id,
      } : null,
      said,
      had: Boolean(snapBefore),
      hist: map.has(HIST_KEY) ? JSON.parse(map.get(HIST_KEY)) : null,
      snapSame: map.get(SNAP_KEY) === snapBefore,
      snapAt: snapBefore ? JSON.parse(snapBefore).takenAt : null,
      noteSame: map.get(NOTE_KEY) === noteBefore,
      chip: chip ? text(chip) : null,
      events,
      rosters: stub.calls.rosters,
      schedule: stub.calls.schedule,
      fetchCalls,
    };
  },
};

if (process.argv[2]) {
  const name = process.argv[2];
  try {
    const out = await CHILDREN[name]();
    emit(out, 0);
  } catch (err) {
    emit({ boot: String((err && err.stack) || err) }, 1);
  }
}

function child(name, env = {}) {
  const res = spawnSync(process.execPath, ['--import', './cap-register.mjs', self, name], {
    encoding: 'utf8', cwd: path.dirname(self), env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024, timeout: 120000,
  });
  const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
  if (!line) return { boot: `no result\n${res.stdout}\n${(res.stderr || '').slice(0, 2000)}` };
  return JSON.parse(line.slice(2));
}

// =========================================================================
// SCORING
// =========================================================================

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`);
};
const eq = (a, b, name) => ok(name, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// =========================================================================
// 1. DRIVEN DIRECTLY
// =========================================================================

// A real Storage's five methods over a Map. `refuse` makes it the full browser:
// every write to a key it matches throws, as a QuotaExceededError does.
const storageOver = (map, refuse = null) => ({
  get length() { return map.size; },
  key: (i) => [...map.keys()][i] ?? null,
  getItem: (k) => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => {
    if (refuse && refuse(k)) throw new Error('QuotaExceededError');
    map.set(k, String(v));
  },
  removeItem: (k) => { map.delete(k); },
  clear: () => map.clear(),
});

let store = new Map();
const install = (refuse = null) => { globalThis.localStorage = storageOver(store, refuse); };
install();

const capture = await import(moduleUrl('js/capture.js'));
const snapshots = await import(moduleUrl('js/snapshots.js'));
const stub = await import('./cap-stub-season.mjs');
// Loaded softly, so that against a build without the module every assertion
// below fails by name instead of the suite dying on the import.
const history = await import(moduleUrl('js/proj-history.js')).catch(() => ({
  get: () => null, list: () => [], teamAsOf: () => null, save: () => ({ written: false }), keyOf: () => '',
}));
const keepHistory = capture.keepHistory || (() => false);
const historyFrom = capture.historyFrom || (() => null);

const remote = { calls: 0, fn: async () => { remote.calls++; return { added: 0, kept: 0, found: 0 }; } };
const floors = { calls: 0, fn: async () => { floors.calls++; return null; } };
const base = () => ({
  leagueId: LEAGUE, season: SEASON, bridgePresent: true, teamId: 1,
  fetchSchedule: stub.fetchSchedule, fetchWeeksRosters: stub.fetchWeeksRosters, fetchFloors: floors.fn,
  cloudSource: async () => null, fetchRemote: remote.fn,
});
const zero = () => { stub.calls.rosters.length = 0; stub.calls.schedule = 0; remote.calls = 0; floors.calls = 0; };
const reset = () => { store = new Map(); install(); zero(); };
const histKeys = () => [...store.keys()].filter((k) => k.startsWith('ff.projhist.1.')).sort();
const stored = (week = 4) => JSON.parse(store.get(`ff.projhist.1.${LEAGUE}.${SEASON}.${week}`) || 'null');

// The stub's own arithmetic, written out again here so a number in the copy is
// checked against the formula and not against the code that copied it.
const rnd = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
const stubProj = (teamId, i, base_, week) => Math.round(base_ * (0.7 + rnd(teamId * 13 + i, week) * 0.7) * 10) / 10;

// ---- a copy is written when the reading is taken ------------------------------
let first = null;
let F = {};   // the same copy, never null, for the blocks below
{
  reset();
  const r = await capture.captureIfDue(base());
  eq(r.code, 'recorded', 'the week is recorded, as before');
  eq(histKeys(), [HIST_KEY], 'and one copy of the projection history is written beside it, under the same week');
  eq(stub.calls.rosters, [1, 2, 3, ...AHEAD], 'from the rosters the reading read — not one request more');
  eq(stub.calls.schedule, 1, 'and one schedule read');

  first = stored();
  F = first || {};
  const snap = snapshots.get(LEAGUE, SEASON, 4);
  eq(first && [first.v, first.leagueId, first.season, first.week], [1, LEAGUE, SEASON, 4], 'it says which league, season and week it is');
  eq(first && first.takenAt, snap && snap.takenAt, 'and when: the moment the reading was taken');
  eq(first && first.weeks, AHEAD, 'it covers every week still projected, playoff weeks included');
  eq(first && first.cols, ['id', 'name', 'pos', 'team', 'slot', 'inj', 'proj'], 'each man is a row, named by cols');
  eq(first && Object.keys(first.teams).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'EVERY squad is in it, not just yours');
  ok('each with its whole roster, bench included (14 on this fixture)',
    first && Object.values(first.teams).every((rows) => rows.length === 14),
    first && Object.values(first.teams).map((rows) => rows.length).join(','));
  ok('and every man has a number for every one of the 13 weeks',
    first && Object.values(first.teams).every((rows) => rows.every((p) =>
      p[6].length === 13 && p[6].every((v) => typeof v === 'number'))));

  // Hand-checked: squad 3's fifth man (i = 4, a WR in slot 4, base 12).
  const row = first && first.teams[3].find((p) => p[0] === 304);
  eq(row && row.slice(0, 6), [304, 'Manager 3 WR4', 'WR', 'XX', 4, 'ACTIVE'], 'a row reads id, name, position, NFL team, slot, status');
  eq(row && row[6][0], stubProj(3, 4, 12, 4), 'his week-4 number is the one the stub gave');
  eq(row && row[6][5], stubProj(3, 4, 12, 9), 'his week-9 number is in week 9’s place');
  eq(row && row[6][12], stubProj(3, 4, 12, 16), 'and the last playoff week’s is last');
  // A bench man of another squad: squad 8's spare QB (i = 12, slot 20, base 19).
  const spare = first && first.teams[8].find((p) => p[0] === 812);
  eq(spare && [spare[4], spare[6][3]], [20, stubProj(8, 12, 19, 7)], 'a bench man of another squad is kept, with his week-7 number');
  {
    // And every number, against the rosters themselves.
    let wrong = 0;
    for (const [i, w] of AHEAD.entries()) {
      const { teams } = await stub.fetchWeekRosters(w);
      stub.calls.rosters.pop();
      for (const t of teams) {
        for (const p of t.players) {
          const kept = first && first.teams[t.id]?.find((x) => x[0] === p.playerId);
          if (!kept || kept[6][i] !== Math.round(p.projected * 100) / 100) wrong++;
        }
      }
    }
    eq(wrong, 0, 'all 1,820 numbers are the ones on the rosters (10 squads × 14 men × 13 weeks)');
  }
  ok('the reading itself is the shape it always was — no new field on it',
    snap && snap.v === 2 && !('history' in snap) && Object.keys(snap.players).join() === 'teamId,weeks,cols,mine,starters',
    snap && Object.keys(snap.players).join());
}

// ---- first copy wins ----------------------------------------------------------
{
  const before = store.get(HIST_KEY);
  zero();
  const again = await capture.captureIfDue(base());
  eq(again.code, 'recorded', 'a second page load finds the week recorded');
  eq(stub.calls.rosters.length, 0, 'and reads no rosters: the copy is already held');
  eq(store.get(HIST_KEY), before, 'the copy is exactly as it was');

  // Even a deliberate second reading of the same week — the Schedule page's
  // "Save this week" replaces the reading — leaves the first copy alone.
  const data = capture.normalizeSchedule(await stub.fetchSchedule(), { isDemo: false });
  const later = await capture.takeReading({
    leagueId: LEAGUE, season: SEASON, data, fetchWeeksRosters: stub.fetchWeeksRosters, myTeamId: 1,
  });
  ok('a second reading was really built', Boolean(later.snap));
  eq(store.get(HIST_KEY), before, 'and still the first copy stands, takenAt and all');
  eq(history.save({ ...first, takenAt: '2030-01-01T00:00:00.000Z' }), { written: false, held: true },
    'the store itself refuses a second copy of a week');
  ok('takenAt unchanged', Boolean(first) && stored()?.takenAt === first.takenAt);
}

// ---- the reading is held, the copy is not: taken late, on the next check ---------
{
  const snapBefore = store.get(SNAP_KEY);
  const noteBefore = store.get(NOTE_KEY);
  store.delete(HIST_KEY);
  zero();
  const at = Date.parse('2026-10-05T18:00:00.000Z');
  const r = await capture.captureIfDue({ ...base(), now: () => at });
  eq(r, { code: 'recorded', week: 4, recorded: true }, 'the answer is the one it always gave for a week already held');
  const late = stored();
  ok('and the missing copy is there now', Boolean(late));
  eq(late && late.takenAt, '2026-10-05T18:00:00.000Z', 'stamped with when it was REALLY taken, not when the reading was');
  ok('which is not the reading’s time', late && late.takenAt !== JSON.parse(snapBefore).takenAt);
  eq(stub.calls.rosters, AHEAD, 'only the weeks still projected were asked for — no decided week');
  eq([stub.calls.schedule, floors.calls, remote.calls], [1, 0, 0],
    'one schedule read, as any due check makes; no wire read, no archive fetch');
  eq(late && JSON.stringify(late.teams), JSON.stringify(F.teams), 'it holds what a copy taken with the reading holds');
  eq(store.get(SNAP_KEY), snapBefore, 'the reading is byte for byte what it was');
  eq(store.get(NOTE_KEY), noteBefore, 'and so is the note the status line reads');

  zero();
  await capture.captureIfDue({ ...base(), now: () => at + 1000 });
  eq(stub.calls.rosters.length, 0, 'the check after that asks for nothing');
}

// ---- a late copy ESPN will not give: silent, and not hammered ------------------
{
  store.delete(HIST_KEY);
  const snapBefore = store.get(SNAP_KEY);
  const noteBefore = store.get(NOTE_KEY);
  let clock = Date.parse('2026-10-05T18:00:00.000Z');
  process.env.CAP_ROSTERS_REFUSE = '4';
  zero();
  const r = await capture.captureIfDue({ ...base(), now: () => clock });
  eq(r, { code: 'recorded', week: 4, recorded: true }, 'week 4’s rosters refused: the reading is still reported held');
  eq(histKeys(), [], 'and weeks 5–16 are NOT filed as week 4’s history');
  eq([store.get(SNAP_KEY), store.get(NOTE_KEY)], [snapBefore, noteBefore], 'the reading and its note are untouched');
  const n = stub.calls.rosters.length;
  clock += 60 * 1000;
  await capture.captureIfDue({ ...base(), now: () => clock });
  eq(stub.calls.rosters.length, n, 'a page opened a minute later does not ask ESPN again');
  delete process.env.CAP_ROSTERS_REFUSE;
  clock += capture.RETRY_MS;
  await capture.captureIfDue({ ...base(), now: () => clock });
  eq(histKeys(), [HIST_KEY], 'after the retry interval it is taken');
}

// ---- demo, and the other places nothing may be written --------------------------
{
  reset();
  const d = await capture.captureIfDue({ ...base(), leagueId: 'demo' });
  eq([d.code, store.size], ['no-league', 0], 'demo writes nothing through the bar');

  const data = capture.normalizeSchedule(await stub.fetchSchedule(), { isDemo: false });
  const plan = capture.rosterPlan(data);
  const weekTeams = capture.pickWeeks(await stub.fetchWeeksRosters(plan.project), plan.project);
  const projection = capture.buildProjection(data, weekTeams, null);
  const args = { leagueId: LEAGUE, season: SEASON, week: 4, data, weeks: plan.project, weekTeams };

  // The Schedule page's "Save this week" works on demo, through readingFrom.
  const demoData = { ...data, isDemo: true };
  const demoSnap = capture.readingFrom({
    leagueId: 'demo', season: 0, week: 4, data: demoData, projection, strengthNote: '', spread: null, weekTeams, myTeamId: 1,
  });
  ok('a demo reading can still be built', Boolean(demoSnap));
  eq(store.size, 0, 'and it leaves no projection history behind');
  eq(keepHistory({ ...args, data: demoData }), false, 'nor does demo data under a real league’s number');
  eq(keepHistory({ ...args, week: 5 }), false, 'rosters starting at week 4 are never filed as week 5');
  eq(keepHistory({ ...args, weeks: plan.project.slice(1), week: 4 }), false, 'nor are weeks 5–16 filed as week 4');
  const short = new Map([...weekTeams].map(([w, teams]) => [w, teams.slice(0, 9)]));
  eq(keepHistory({ ...args, weekTeams: short }), false, 'a copy with a squad missing is not kept — it would block the whole one');
  eq(store.size, 0, 'none of those wrote anything');
  eq(keepHistory(args), true, 'the same call with everything in order writes');
  eq(histKeys(), [HIST_KEY], 'exactly one key');
}

// ---- what a row is, on rosters built by hand ------------------------------------
{
  const man = (playerId, name, position, lineupSlotId, projected, extra = {}) =>
    ({ playerId, name, position, proTeam: 'DET', lineupSlotId, projected, injuryStatus: 'ACTIVE', ...extra });
  const weekTeams = new Map([
    [5, [{ id: 7, players: [
      man(1, 'Finished Man', 'WR', 4, 31.4, { done: true, pregame: 12.345 }),
      man(2, 'On Bye Later', 'RB', 2, 14.001),
      man(3, 'Hurt', 'TE', 21, null, { injuryStatus: 'OUT' }),
    ] }]],
    [6, [{ id: 7, players: [
      man(1, 'Finished Man', 'WR', 20, 11.5),
      man(2, 'On Bye Later', 'RB', 2, 0),
      man(4, 'Arrives Later', 'K', 17, 8.2),
    ] }]],
  ]);
  const h = historyFrom(weekTeams, [5, 6]);
  eq(h && h.weeks, [5, 6], 'the weeks are the ones with rosters');
  eq(h && h.teams[7], [
    [1, 'Finished Man', 'WR', 'DET', 4, 'ACTIVE', [12.35, 11.5]],
    [2, 'On Bye Later', 'RB', 'DET', 2, 'ACTIVE', [14, 0]],
    [3, 'Hurt', 'TE', 'DET', 21, 'OUT', [null, null]],
    [4, 'Arrives Later', 'K', 'DET', null, 'ACTIVE', [null, 8.2]],
  ], 'a finished man keeps what he was PROJECTED (not his score), to the hundredth; a bye is 0, not null; ' +
     'no number is null; a man who arrives later has a null slot; slot and status are the first week’s');
  eq(historyFrom(new Map(), [5]), null, 'no rosters, no rows');
}

// ---- a full browser: the reading is saved, the status line says what it said ----
{
  reset();
  await capture.captureIfDue(base());
  const cleanNote = { ...snapshots.lastAttempt(LEAGUE, SEASON), at: 0 };
  const cleanLine = capture.statusLine({
    week: 4, snap: snapshots.get(LEAGUE, SEASON, 4), attempt: snapshots.lastAttempt(LEAGUE, SEASON),
  });

  reset();
  const older = JSON.stringify({ ...first, week: 3 });
  store.set(`ff.projhist.1.${LEAGUE}.${SEASON}.3`, older);
  store.set('ff.weeks.1.99.2026.2', '{"v":1,"at":1,"final":true,"teams":[{}]}');
  store.set('ff.prefs', '{"a":1}');
  install((k) => k.startsWith('ff.projhist'));
  let r = null;
  let threw = null;
  try { r = await capture.captureIfDue(base()); } catch (err) { threw = err; }
  ok('a storage that throws on the copy throws nothing at the page', threw === null, String(threw));
  eq(r, { code: 'recorded', week: 4, recorded: true, fresh: true }, 'the reading is reported taken, fresh');
  ok('and is really in storage', Boolean(snapshots.get(LEAGUE, SEASON, 4)));
  eq({ ...snapshots.lastAttempt(LEAGUE, SEASON), at: 0 }, cleanNote, 'the note of the attempt is the one a clean run leaves');
  eq(capture.statusLine({
    week: 4, snap: snapshots.get(LEAGUE, SEASON, 4), attempt: snapshots.lastAttempt(LEAGUE, SEASON),
  }), cleanLine, 'so the status line reads exactly as it does on a clean run');
  eq(store.has(HIST_KEY), false, 'the copy that would not fit is simply absent');
  eq([store.get(`ff.projhist.1.${LEAGUE}.${SEASON}.3`), store.has('ff.weeks.1.99.2026.2'), store.get('ff.prefs')],
    [older, true, '{"a":1}'], 'and nothing older was deleted to make room — not a copy, not a stored week, not a preference');

  // The same browser on its next load, still full: silent again.
  threw = null;
  try { r = await capture.captureIfDue(base()); } catch (err) { threw = err; }
  ok('the late attempt on a full browser is silent too', threw === null && r.code === 'recorded', `${threw} ${JSON.stringify(r)}`);

  // A storage that refuses everything: the old behaviour, a save-failed note.
  reset();
  install(() => true);
  threw = null;
  try { r = await capture.captureIfDue(base()); } catch (err) { threw = err; }
  ok('a storage that refuses every write still throws nothing', threw === null && r && r.code !== 'recorded', `${threw} ${JSON.stringify(r)}`);
  install();
}

// ---- reading it back ------------------------------------------------------------
const v1 = JSON.parse(readFileSync(new URL('./snap-v1-fixture.json', import.meta.url), 'utf8')).raw.map((s) => JSON.parse(s));
{
  reset();
  await capture.captureIfDue(base());
  const reading4 = snapshots.get(LEAGUE, SEASON, 4);
  // Week 3: a schema-2 reading from before this store existed (yours: squad 1).
  const reading3 = { ...reading4, week: 3, takenAt: '2026-09-22T15:00:00.000Z' };
  snapshots.save(reading3);
  // Week 2: schema 2, taken with no team chosen — starters only, no roster.
  snapshots.save({ ...reading4, week: 2, players: { ...reading4.players, teamId: null, mine: null } });
  // Week 1: a real schema-1 reading, refiled under this league.
  ok('the v1 fixture is a v1 reading', v1[0] && v1[0].v === 1 && !('players' in v1[0]));
  snapshots.save({ ...v1[0], leagueId: LEAGUE, season: SEASON, week: 1 });
  eq(snapshots.list(LEAGUE, SEASON).map((s) => [s.week, s.v]), [[1, 1], [2, 2], [3, 2], [4, 2]], 'four readings are held');

  eq(history.list(LEAGUE, SEASON), [
    { week: 3, takenAt: '2026-09-22T15:00:00.000Z', teams: [1], source: 'reading' },
    { week: 4, takenAt: reading4.takenAt, teams: 'all', source: 'store' },
  ], 'list: the reading-only week with the one squad it kept, then the stored week with all — in order; ' +
     'a schema-1 week and a week with no roster are not listed');
  eq(history.list(LEAGUE, SEASON + 1), [], 'another season has none');
  eq(history.list('98', SEASON), [], 'nor has another league');

  // From the store: any squad.
  const six = history.teamAsOf(LEAGUE, SEASON, 4, 6);
  eq(six && [six.week, six.takenAt, six.source, six.weeks, six.players.length],
    [4, reading4.takenAt, 'store', AHEAD, 14], 'teamAsOf from the store: another squad’s whole roster, as of week 4');
  const p = six && six.players.find((x) => x.playerId === 608);
  eq(p && [p.name, p.position, p.proTeam, p.slotId, p.injuryStatus], ['Manager 6 DST8', 'DST', 'XX', 16, 'ACTIVE'],
    'a player comes back as named fields');
  ok('with his projection as a Map of week to number', p && p.proj instanceof Map && p.proj.size === 13);
  eq(p && [p.proj.get(4), p.proj.get(11), p.proj.get(16)], [stubProj(6, 8, 7, 4), stubProj(6, 8, 7, 11), stubProj(6, 8, 7, 16)],
    'and the numbers are the stub’s for weeks 4, 11 and 16');
  eq(history.teamAsOf(LEAGUE, SEASON, 4, '6')?.players.length, 14, 'a team id given as text finds the same squad');
  eq(history.teamAsOf(LEAGUE, SEASON, 4, 11), null, 'a squad that is not in the league is null');

  // From a schema-2 reading: your own squad only.
  const mine = history.teamAsOf(LEAGUE, SEASON, 3, 1);
  eq(mine && [mine.week, mine.takenAt, mine.source, mine.weeks, mine.players.length],
    [3, '2026-09-22T15:00:00.000Z', 'reading', AHEAD, 14], 'teamAsOf from a schema-2 reading: your own roster');
  const qb = mine && mine.players.find((x) => x.playerId === 100);
  eq(qb && [qb.name, qb.slotId, qb.proj.get(7)], ['Manager 1 QB0', 0, stubProj(1, 0, 19, 7)], 'with the numbers the reading kept');
  eq(history.teamAsOf(LEAGUE, SEASON, 3, 2), null, 'another squad in a reading-only week is null — its bench was never kept');
  eq(history.teamAsOf(LEAGUE, SEASON, 2, 1), null, 'a schema-2 reading taken with no team chosen is null');
  eq(history.teamAsOf(LEAGUE, SEASON, 1, 1), null, 'a schema-1 reading is null');
  eq(history.teamAsOf(LEAGUE, SEASON, 9, 1), null, 'a week with nothing at all is null');

  // Injected storage and readings: no globals, no browser.
  const map = new Map([[history.keyOf('7', 2025, 2), JSON.stringify({ ...first, leagueId: '7', season: 2025, week: 2 })]]);
  const io = { storage: storageOver(map), readings: { list: () => [reading3], get: (l, s, w) => (w === 3 ? reading3 : null) } };
  eq(history.list('7', 2025, io).map((x) => [x.week, x.source]), [[2, 'store'], [3, 'reading']], 'both sources, through injected storage');
  eq(history.teamAsOf('7', 2025, 2, 9, io)?.players.length, 14, 'teamAsOf through injected storage');
  eq(history.teamAsOf('7', 2025, 3, 1, io)?.source, 'reading', 'and through injected readings');

  // Rubbish in the store is absent, never an exception.
  store.set(`ff.projhist.1.${LEAGUE}.${SEASON}.6`, '{not json');
  store.set(`ff.projhist.1.${LEAGUE}.${SEASON}.7`, '{"v":2,"weeks":[7],"teams":{}}');
  eq(history.list(LEAGUE, SEASON).map((x) => x.week), [3, 4], 'an unreadable key and another schema are not listed');
  eq(history.teamAsOf(LEAGUE, SEASON, 6, 1), null, 'and read as absent');
  globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  eq([history.list(LEAGUE, SEASON), history.teamAsOf(LEAGUE, SEASON, 4, 6)], [[], null], 'a browser that blocks storage gives nothing, quietly');
  install();
}

// ---- HOW BIG A WEEK IS: measured ------------------------------------------------
//
// The stub's league as stored (10 squads × 14 men × 13 weeks), and the worst a
// real one gets: week 1 of a 17-week season, 16 men a squad, names as long as
// real ones, numbers to the hundredth (test-capture.mjs's own size fixture).
{
  const stubBytes = JSON.stringify(first).length;
  const NAMES = ['Amon-Ra St. Brown', 'Christian McCaffrey', 'Justin Jefferson', 'Travis Kelce', 'Harrison Butker'];
  const SLOTS = [0, 2, 2, 4, 4, 6, 23, 23, 16, 17, 20, 20, 20, 20, 20, 21];
  const POS = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'RB', 'DST', 'K', 'QB', 'RB', 'WR', 'TE', 'RB', 'WR'];
  const weeks = Array.from({ length: 17 }, (_, i) => i + 1);
  const weekTeams = new Map(weeks.map((week) => [week, TEAMS.map((t) => ({
    id: t.id,
    players: SLOTS.map((slot, i) => ({
      playerId: 4000000 + t.id * 100 + i, name: NAMES[(t.id + i) % NAMES.length], position: POS[i],
      proTeam: 'DET', lineupSlotId: slot, injuryStatus: 'QUESTIONABLE',
      projected: 4 + ((t.id * 31 + i * 7 + week) % 19) + 0.37,
    })),
  }))]));
  reset();
  const wrote = keepHistory({ leagueId: LEAGUE, season: SEASON, week: 1, weeks, weekTeams });
  const worst = (store.get(`ff.projhist.1.${LEAGUE}.${SEASON}.1`) || '').length;
  console.log(`MEASURED: one week of projection history is ${stubBytes} bytes on the stub league ` +
    `(10 × 14 men × 13 weeks) and ${worst} bytes at its largest (10 × 16 men × 17 weeks, week 1)`);
  ok('the largest week is written', wrote === true && worst > 0);
  ok('the stub league’s week is well under 60KB', stubBytes > 5000 && stubBytes < 60 * 1024, `${stubBytes} bytes`);
  ok('and so is the largest week a season can have', worst < 60 * 1024, `${worst} bytes`);
  let season = 0;
  for (let asOf = 1; asOf <= 17; asOf++) {
    const h = historyFrom(weekTeams, weeks.slice(asOf - 1));
    season += JSON.stringify({ v: 1, leagueId: LEAGUE, season: SEASON, week: asOf, takenAt: F.takenAt, ...(h || {}) }).length;
  }
  console.log(`MEASURED: a whole 17-week season of them is ${Math.round(season / 1024)}KB`);
  ok('a whole season of copies stays under 600KB of a browser’s ~5MB', season > 0 && season < 600 * 1024, `${season} bytes`);
}

// ---- "is this week saved?": what the connection bar's chip is told ----------
// SAVED MEANS BOTH the reading and every squad's copy. A chip that said "saved"
// on the reading alone would be reassuring about exactly the loss this store
// exists to stop.
{
  const savedStatus = history.savedStatus || (() => undefined);
  const weekSpan = history.weekSpan || (() => undefined);
  const ask = (o = {}) => savedStatus({ leagueId: LEAGUE, season: SEASON, week: 4, ...o });
  const SNAP4 = `ff.snap.${LEAGUE}.${SEASON}.4`;

  reset();
  eq(ask(), {
    saved: false, text: 'Week 4 not saved yet',
    title: 'Week 4 projections are not saved yet. No weeks held.',
  }, 'nothing held: not saved yet, and it says nothing is held');
  eq(ask({ pending: true }), null, 'while this page’s own attempt is still running it says nothing');

  await capture.captureIfDue(base());
  const both = ask();
  eq([both && both.saved, both && both.text], [true, 'Week 4 saved'], 'the reading and the copy both held: "Week 4 saved"');
  ok('its title says when, and which weeks are held',
    both && /^Week 4 projections saved \S.*\. Week 4 held\.$/.test(both.title), both && both.title);
  ok('the time in it is the reading’s own',
    both && both.title.includes(new Date(JSON.parse(store.get(SNAP4)).takenAt).toLocaleString(undefined, {
      weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
    })), both && both.title);
  eq(ask({ pending: true }), both, 'a week already saved says so even while an attempt is running');
  ok('the chip is four words at most', [ask(), both].every((v) => v && v.text.split(' ').length <= 4));

  // The reading without the copy — every browser the day the copies shipped.
  const copy = store.get(HIST_KEY);
  store.delete(HIST_KEY);
  eq(ask(), {
    saved: false, text: 'Week 4 not saved yet',
    title: 'Week 4 is half saved: every team’s projections are still missing. Week 4 held.',
  }, 'THE READING ALONE IS NOT SAVED, and the title names the missing half');
  eq(ask({ pending: true }), null, 'and nothing is said while the late copy still has its chance');

  // The copy without the reading.
  const reading = store.get(SNAP4);
  store.delete(SNAP4);
  store.set(HIST_KEY, copy);
  eq(ask(), {
    saved: false, text: 'Week 4 not saved yet',
    title: 'Week 4 is half saved: the weekly reading is still missing. Week 4 held.',
  }, 'nor is the copy alone');
  store.set(SNAP4, reading);

  // Which weeks are held in total: any reading, copy or one-team copy.
  store.set(`ff.snap.${LEAGUE}.${SEASON}.1`, reading.replace('"week":4', '"week":1'));
  store.set(`ff.snap.${LEAGUE}.${SEASON}.2`, reading.replace('"week":4', '"week":2'));
  store.set(`ff.projhist-part.1.${LEAGUE}.${SEASON}.3`, copy.replace('"week":4', '"week":3'));
  store.set(`ff.snapnote.${LEAGUE}.${SEASON}`, '{"at":1,"ok":true,"week":9}');
  store.set(`ff.snap.${LEAGUE}7.${SEASON}.8`, reading);
  ok('the title counts every week held, and no other league’s or note’s',
    /\. Weeks 1–4 held\.$/.test(ask().title), ask().title);
  eq(history.heldWeeks && history.heldWeeks(LEAGUE, SEASON),
    { readings: [1, 2, 4], copies: [4], parts: [3], all: [1, 2, 3, 4] }, 'by kind');
  eq([weekSpan([5]), weekSpan([3, 4, 5]), weekSpan([5, 1, 3, 4]), weekSpan([2, 4]), weekSpan([])],
    ['Week 5', 'Weeks 3–5', 'Weeks 1, 3–5', 'Weeks 2, 4', ''], 'weeks are named as runs');

  eq(ask({ week: 5 }), {
    saved: false, text: 'Week 5 not saved yet',
    title: 'Week 5 projections are not saved yet. Weeks 1–4 held.',
  }, 'a new week is not saved yet, whatever earlier weeks are held');
  eq([ask({ week: null }), ask({ week: 0 })], [null, null], 'no week known: nothing is said rather than guessed');
  eq([savedStatus({ leagueId: 'demo', season: 0, week: 4 }), savedStatus({ leagueId: '', season: SEASON, week: 4 })],
    [null, null], 'never for sample data, or with no league');

  // The phone: it reads the synced copy, takes nothing, and is not told the week.
  eq(ask({ week: null, synced: true }), {
    saved: true, text: 'Week 4 saved',
    title: 'Saved on your computer and sent here. Weeks 1–4 held.',
  }, 'ON THE PHONE it names the latest week it was sent a copy of');
  store.delete(HIST_KEY);
  eq(ask({ week: null, synced: true }).text, 'Week 3 saved', 'a one-team copy counts there');
  store.delete(`ff.projhist-part.1.${LEAGUE}.${SEASON}.3`);
  eq(ask({ week: null, synced: true }), null, 'and with no copy sent it says nothing, readings or not');
}

// =========================================================================
// 2. THE SCHEDULE PAGE WRITES THE SAME COPY
// =========================================================================

const page = child('page');
ok('the Schedule page boots on the stub', !page.boot, page.boot);
if (!page.boot) {
  eq(page.keys, [HIST_KEY], 'taking its own reading, the page writes the copy too — one key');
  eq(page.hist && page.hist.takenAt, page.snapAt, 'stamped with the reading’s own time');
  eq(page.hist && JSON.stringify([page.hist.weeks, page.hist.cols, page.hist.teams]),
    JSON.stringify([F.weeks, F.cols, F.teams]), 'and it is the copy the bar’s route writes, row for row');
  eq(page.rosters, [1, 2, 3, ...AHEAD], 'the page read each week once, as it always has');
  ok('its only raw fetch was the committed archive',
    page.fetchCalls.every((u) => /^data\/snapshots\//.test(u)), page.fetchCalls.join(' | '));
  ok('the status line says week 4 was recorded', /^Week 4: recorded \S/.test(page.line), page.line);
}

// =========================================================================
// 3. THE BAR, IN A BROWSER THAT HOLDS THE READING AND NO COPY
// =========================================================================

const bar = child('barLate');
ok('a page with only the connection bar boots', !bar.boot, bar.boot);
if (!bar.boot) {
  ok('the browser really held week 4’s reading beforehand', bar.had);
  ok('the bar took the missing copy by itself', Boolean(bar.hist), JSON.stringify(bar.events));
  eq(bar.hist && Object.keys(bar.hist.teams).length, 10, 'with all ten squads');
  ok('stamped later than the reading it sits beside', bar.hist && bar.hist.takenAt > bar.snapAt, `${bar.hist && bar.hist.takenAt} vs ${bar.snapAt}`);
  eq(bar.rosters, AHEAD, 'asking only for the weeks still projected');
  eq(bar.schedule, 1, 'and the schedule once');
  ok('no raw network call beyond the committed archive',
    bar.fetchCalls.every((u) => /^data\/snapshots\//.test(u)), bar.fetchCalls.join(' | '));
  ok('the reading and its note are untouched', bar.snapSame && bar.noteSame);
  ok('the bar says nothing', !bar.chip, bar.chip);
  eq(bar.events.map((e) => e.code), ['recorded'], 'and tells the page what it always told it');
  // The quiet chip (Tim, 2026-10-06): it waits for the late copy, then says so.
  eq(bar.saved && bar.saved.text, 'Week 4 saved', 'once the late copy is in, the bar’s quiet chip says "Week 4 saved"');
  ok('with a title saying when and which weeks are held',
    bar.saved && /^Week 4 projections saved \S.* Week 4 held\.$/.test(bar.saved.title || ''), JSON.stringify(bar.saved));
  eq(bar.saved && [bar.saved.tag, bar.saved.after], ['SPAN', 'connSync'],
    'a plain span (so a tap opens its title), straight after the Sync button');
  eq(bar.said, ['', 'Week 4 saved'], 'and it said nothing — not "not saved yet" — while the copy still had its chance');
}

const barHalf = child('barLate', { PH_LATE_FAIL: '1' });
ok('the same page boots when ESPN refuses the rosters', !barHalf.boot, barHalf.boot);
if (!barHalf.boot) {
  ok('the late copy could not be taken', barHalf.had && !barHalf.hist, JSON.stringify(barHalf.events));
  eq(barHalf.saved && barHalf.saved.text, 'Week 4 not saved yet', 'with the reading held and no copy, the chip says "Week 4 not saved yet"');
  eq(barHalf.saved && barHalf.saved.title, 'Week 4 is half saved: every team’s projections are still missing. Week 4 held.',
    'and its title names the missing half');
  eq(barHalf.said, ['', 'Week 4 not saved yet'], 'said once the attempt had finished, not before');
  ok('the loud chip stays out of it: the reading itself did not fail', !barHalf.chip, barHalf.chip);
}

// ---------------------------------------------------------------------------

for (const f of fails) console.log('FAIL ' + f);
console.log(fails.length ? `${pass} passed, ${fails.length} failed` : `All ${pass} assertions passed`);
process.exit(fails.length ? 1 : 0);
