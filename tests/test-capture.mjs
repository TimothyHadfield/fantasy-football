// The time machine's reading, taken from ANY page: js/capture.js, and the two
// routes that use it.
//
//   node test-capture.mjs
//
// Why this suite exists: ESPN keeps no history of its own projections, and
// until 2026-09-16 a reading was only taken when the Schedule page itself was
// opened on live data. Tim mostly reads the site on his phone; week 1 was lost.
// Now the connection bar takes it on every desktop page. That is only safe if
// the two routes write THE SAME RECORD for the same data, and if the bar never
// writes one it should not — from the synced copy, without the extension, over
// a week the committed archive already holds, or over a week already taken.
//
// Three layers:
//   1. js/capture.js driven directly against cap-stub-season.mjs — the gates,
//      first-write-wins, the throttle, the recorded reasons, the status line,
//      the standings order (the RULE; the Schedule page no longer draws a
//      standings table, but the bracket still seeds on this key).
//   2. The REAL Schedule page booted on the same stub (child process, with
//      cap-register.mjs), and the reading it takes compared field for field
//      with the one layer 1 took.
//   3. A bare page carrying only the connection bar, with the bridge extension
//      simulated, taking the reading by itself — and its chip when it cannot.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { REPO, moduleUrl } from './repo.mjs';
import { bootDom, waitFor, comparable, LEAGUE, SEASON } from './cap-harness.mjs';

const self = fileURLToPath(import.meta.url);
const SNAP_KEY = `ff.snap.${LEAGUE}.${SEASON}.4`;     // weeks 1–3 decided: week 4 is due
const NOTE_KEY = `ff.snapnote.${LEAGUE}.${SEASON}`;
const TEAMS = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `Manager ${i + 1}` }));
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

// =========================================================================
// CHILDREN: real pages
// =========================================================================

const CHILDREN = {
  /** The Schedule page on live data takes its own reading. */
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
      snap: map.has(SNAP_KEY) ? JSON.parse(map.get(SNAP_KEY)) : null,
      note: JSON.parse(map.get(NOTE_KEY) || 'null'),
      line: text(document.getElementById('snapLine')),
      rosters: stub.calls.rosters,
      fetchCalls,
    };
  },

  /** The same page, but the data is the synced cloud copy. */
  async pageCloud() {
    const html = readFileSync(path.join(REPO, 'schedule.html'), 'utf8');
    const { document, map } = bootDom({
      html,
      store: {
        'ff.prefs': { 'schedule.source': 'live', 'schedule.week': 'all' },
        'ff.connection': { leagueId: LEAGUE, season: SEASON, teamId: 1 },
      },
    });
    await import(moduleUrl('js/schedule-page.js'));
    await waitFor(() => map.get(NOTE_KEY), 15000);
    await new Promise((r) => setTimeout(r, 200));
    return {
      keys: [...map.keys()].filter((k) => k.startsWith('ff.snap.')),
      note: JSON.parse(map.get(NOTE_KEY) || 'null'),
      line: text(document.getElementById('snapLine')),
      lineClass: document.getElementById('snapLine').getAttribute('class'),
      forecastRows: document.querySelectorAll('#forecastTable tbody tr:not(.empty-row)').length,
    };
  },

  /** Any page: only the connection bar, with the extension present. */
  async bar() {
    const cloud = await import(moduleUrl('js/cloud.js'));
    cloud.configure({ apiKey: '', authDomain: '', projectId: '', appId: '', ownerUid: '' });
    const { document, map, fetchCalls, bridgeCalls } = bootDom({
      html: '<!DOCTYPE html><html><body><div id="connBar"></div></body></html>',
      store: { 'ff.connection': { leagueId: LEAGUE, season: SEASON, teamId: 1 } },
      bridge: !process.env.CAP_NO_BRIDGE,
      teams: TEAMS,
    });
    const events = [];
    document.addEventListener('ff:capture', (e) => events.push(e.detail));
    await import(moduleUrl('js/connection.js'));
    const settled = () => map.get(SNAP_KEY) || map.get(NOTE_KEY);
    await waitFor(() => settled() && events.length, process.env.CAP_NO_BRIDGE ? 3000 : 15000);
    await new Promise((r) => setTimeout(r, 100));
    const stub = await import('./cap-stub-season.mjs');
    const chip = document.getElementById('connCapture');
    return {
      snap: map.has(SNAP_KEY) ? JSON.parse(map.get(SNAP_KEY)) : null,
      note: JSON.parse(map.get(NOTE_KEY) || 'null'),
      keys: [...map.keys()].filter((k) => k.startsWith('ff.snap')),
      bar: text(document.getElementById('connBar')),
      chip: chip ? { text: text(chip), href: chip.getAttribute('href'), cls: chip.getAttribute('class') } : null,
      events,
      rosters: stub.calls.rosters,
      schedule: stub.calls.schedule,
      fetchCalls,
      bridgeCalls,
    };
  },
};

if (process.argv[2]) {
  const name = process.argv[2];
  try {
    const out = await CHILDREN[name]();
    console.log('@@' + JSON.stringify(out));
    process.exit(0);
  } catch (err) {
    console.log('@@' + JSON.stringify({ boot: String((err && err.stack) || err) }));
    process.exit(1);
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
// 1. js/capture.js, driven directly
// =========================================================================

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
const stub = await import('./cap-stub-season.mjs');

const quietRemote = { calls: 0, fn: async () => { quietRemote.calls++; return { added: 0, kept: 0, found: 0 }; } };
const base = () => ({
  leagueId: LEAGUE, season: SEASON, bridgePresent: true,
  fetchSchedule: stub.fetchSchedule, fetchWeeksRosters: stub.fetchWeeksRosters,
  cloudSource: async () => null, fetchRemote: quietRemote.fn,
});
const reset = () => { store = new Map(); stub.calls.rosters.length = 0; stub.calls.schedule = 0; };

// ---- the gates --------------------------------------------------------------
{
  reset();
  const r = await capture.captureIfDue({ ...base(), bridgePresent: false });
  eq(r.code, 'no-bridge', 'without the extension the bar takes nothing');
  eq(stub.calls.schedule + stub.calls.rosters.length, 0, 'and asks ESPN for nothing');
  eq(store.size, 0, 'and writes nothing — not even a note');

  const d = await capture.captureIfDue({ ...base(), leagueId: 'demo' });
  eq(d.code, 'no-league', 'demo is never captured by the bar');
  eq(store.size, 0, 'and leaves nothing behind');
}

// ---- the synced copy is refused ---------------------------------------------
{
  reset();
  const r = await capture.captureIfDue({ ...base(), cloudSource: async () => ({ found: true }) });
  eq(r.code, 'cloud', 'a synced copy is never recorded as a reading');
  eq(stub.calls.rosters.length, 0, 'and no rosters are read for it');
  ok('no reading is written', ![...store.keys()].some((k) => k.startsWith('ff.snap.')), [...store.keys()].join(','));
  const note = snapshots.lastAttempt(LEAGUE, SEASON);
  ok('the refusal is recorded, in words that say where readings ARE taken',
    note && note.code === 'cloud' && /only taken on your computer/.test(note.text), JSON.stringify(note));
}

// ---- the happy path -----------------------------------------------------------
let direct = null;
{
  reset();
  quietRemote.calls = 0;
  const r = await capture.captureIfDue(base());
  eq(r.code, 'recorded', 'with the extension and a live league, the week is recorded');
  eq(r.week, 4, 'filed under the first week still open (weeks 1–3 are decided)');
  direct = snapshots.get(LEAGUE, SEASON, 4);
  ok('the reading is in storage under this league, season and week', Boolean(direct));
  eq(stub.calls.rosters, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    'decided weeks once each (for the spread), then the weeks to play, then the two playoff weeks');
  eq(quietRemote.calls, 1, 'the committed archive is consulted before deciding the week is missing');
  ok('the reading carries the playoff weeks', direct && ['15', '16'].every((w) => direct.proj[w]),
    direct && Object.keys(direct.proj).join(','));
  ok('and the league’s own bracket settings, so a replay seeds four teams, not six',
    direct && direct.playoffs && direct.playoffs.playoffTeams === 4, JSON.stringify(direct && direct.playoffs));
  ok('the spread is MEASURED from the decided weeks, not assumed',
    direct && direct.sigmaCalibrated === true && direct.sigmaSample === 30 && direct.sigma !== 27,
    direct && `${direct.sigma} / ${direct.sigmaCalibrated} / ${direct.sigmaSample}`);
  ok('it is a week-4 reading with every game in it', direct && direct.week === 4 && direct.games.length === 70);
  const note = snapshots.lastAttempt(LEAGUE, SEASON);
  ok('the success is noted, by the bar', note && note.ok && note.week === 4 && note.source === 'bar', JSON.stringify(note));

  // FIRST WRITE WINS.
  const before = store.get(`ff.snap.${LEAGUE}.${SEASON}.4`);
  stub.calls.rosters.length = 0;
  const again = await capture.captureIfDue(base());
  eq(again.code, 'recorded', 'a second page load finds the week already recorded');
  eq(stub.calls.rosters.length, 0, 'and reads no rosters to find that out');
  eq(store.get(`ff.snap.${LEAGUE}.${SEASON}.4`), before, 'and the first reading is left exactly as it was');
}

// ---- a week the committed archive already holds --------------------------------
{
  reset();
  const committed = { ...direct, takenAt: '2026-09-15T09:00:00.000Z', sigma: 5 };
  const remote = async () => snapshots.importAll([committed]);
  const r = await capture.captureIfDue({ ...base(), fetchRemote: remote });
  eq(r.code, 'recorded', 'a week already in the repo counts as recorded');
  eq(stub.calls.rosters.length, 0, 'and no later reading is taken to replace it');
  eq(snapshots.get(LEAGUE, SEASON, 4).sigma, 5, 'the committed reading is the one kept');
}

// ---- ESPN refuses the rosters -------------------------------------------------
{
  reset();
  let clock = 1_000_000;
  process.env.CAP_ROSTERS_FAIL = '1';
  const r = await capture.captureIfDue({ ...base(), now: () => clock });
  eq(r.code, 'no-projection', 'no rosters, no reading');
  ok('and the reason counts the refused weeks',
    r.text === 'ESPN refused 13 of 13 roster weeks, so there was no projection to record.', r.text);
  ok('nothing hollow was saved in the week’s place', !snapshots.get(LEAGUE, SEASON, 4));
  const note = snapshots.lastAttempt(LEAGUE, SEASON);
  ok('the failure is kept for the Schedule page and the chip',
    note && note.ok === false && note.week === 4 && note.code === 'no-projection', JSON.stringify(note));

  const n = stub.calls.rosters.length;
  clock += 60 * 1000;
  const soon = await capture.captureIfDue({ ...base(), now: () => clock });
  ok('a page opened a minute later does not hammer ESPN again', soon.throttled && stub.calls.rosters.length === n,
    `${JSON.stringify(soon)} / ${stub.calls.rosters.length - n} extra reads`);
  eq(soon.code, 'no-projection', 'and still reports the same failure');

  delete process.env.CAP_ROSTERS_FAIL;
  clock += capture.RETRY_MS;
  const later = await capture.captureIfDue({ ...base(), now: () => clock });
  eq(later.code, 'recorded', 'after the retry interval it tries again, and succeeds once ESPN answers');
}

// ---- the schedule itself refused -------------------------------------------------
{
  reset();
  const r = await capture.captureIfDue({ ...base(), fetchSchedule: async () => { throw new Error('401'); } });
  eq(r.code, 'schedule-failed', 'a refused schedule is its own reason');
  ok('and says so', /ESPN refused the schedule \(401\)/.test(r.text), r.text);
}

// ---- the status line ----------------------------------------------------------
{
  const snap = { takenAt: '2026-09-15T12:00:00.000Z' };
  const s1 = capture.statusLine({ week: 4, snap });
  ok('recorded: "Week N: recorded <day date>"', /^Week 4: recorded \S+/.test(s1.text) && s1.recorded && s1.tone === 'pos', JSON.stringify(s1));

  const fail = { ok: false, week: 4, code: 'no-projection', text: 'ESPN refused 13 of 13 roster weeks, so there was no projection to record.' };
  const s2 = capture.statusLine({ week: 4, attempt: fail });
  eq(s2.text, 'Week 4: NOT recorded — ESPN refused 13 of 13 roster weeks, so there was no projection to record.',
    'a failed attempt gives the real reason');
  eq(s2.tone, 'neg', 'in red');

  eq(capture.statusLine({ week: 4, context: { code: 'cloud' } }).text,
    'Week 4: NOT recorded — this is the synced copy from your computer, and readings are only taken on your computer.',
    'the synced copy says where readings are taken');
  eq(capture.statusLine({ week: null, context: { code: 'demo' } }).text,
    'This week: NOT recorded — demo data is on. Readings are taken from your live league, on your computer.',
    'demo says so');
  eq(capture.statusLine({ week: 4, context: { code: 'replay' }, attempt: fail }).text, s2.text,
    'while replaying, a real failure for this week outranks "you are replaying"');
  ok('replaying with no failure says so', /replaying an archived week/.test(
    capture.statusLine({ week: 4, context: { code: 'replay' } }).text));
  const pend = capture.statusLine({ week: 4, context: { code: 'pending' } });
  ok('still loading is not a red failure', pend.tone === 'dim' && /not recorded yet/.test(pend.text), JSON.stringify(pend));
  eq(capture.statusLine({ week: 4, context: { code: 'no-live', text: 'ESPN refused the schedule (401).' } }).text,
    'Week 4: NOT recorded — ESPN refused the schedule (401).', 'a failed live load gives its reason');
  ok('a week from another attempt does not lend its reason',
    /no reading has been attempted/.test(capture.statusLine({ week: 5, attempt: fail }).text));
}

// ---- standings order: win % with a tie as half a win, then points --------------
{
  const k = capture.standingsKey;
  ok('2–0–1 ranks above 2–1 even with fewer points',
    k({ w: 2, l: 0, t: 1 }, 300) > k({ w: 2, l: 1, t: 0 }, 450));
  ok('1–0–1 (75%) ranks above 2–1 (67%) although it has fewer wins',
    k({ w: 1, l: 0, t: 1 }, 200) > k({ w: 2, l: 1, t: 0 }, 400));
  ok('level on percentage, points for decides',
    k({ w: 2, l: 1, t: 0 }, 401) > k({ w: 2, l: 1, t: 0 }, 400));
  ok('and a tie is worth exactly half a win: 1–1–2 equals 2–2 on percentage',
    Math.abs(k({ w: 1, l: 1, t: 2 }, 0) - k({ w: 2, l: 2, t: 0 }, 0)) < 1e-12);
  ok('points can never outweigh a percentage step, even over a full season',
    k({ w: 9, l: 8, t: 0 }, 0) > k({ w: 8, l: 8, t: 1 }, 5000) &&
    k({ w: 8, l: 8, t: 1 }, 0) > k({ w: 8, l: 9, t: 0 }, 5000));
}

// ---- the banked table counts a tie as half a win --------------------------------
{
  const data = capture.normalizeSchedule(await stub.fetchSchedule(), { isDemo: false });
  const tie = data.games.find((g) => g.week === 2 && g.homeScore === g.awayScore);
  const inp = capture.simulationInputs({ data, isRemaining: (g) => capture.gameState(g) !== 'final', proj: null, sigma: 27 });
  const wins = (id) => inp.banked.get(id).wins;
  ok('the stub really has a tie', Boolean(tie));
  ok('each side of it banks half a win', tie && [wins(tie.homeId), wins(tie.awayId)].every((w) => w % 1 === 0.5),
    tie && `${wins(tie.homeId)} / ${wins(tie.awayId)}`);
  eq(inp.playoff.teams, 4, 'the bracket is the league’s four teams');
  eq(inp.playoff.weeks, [15, 16], 'in two rounds after the fourteen-week season');
}

// =========================================================================
// 2. THE SCHEDULE PAGE WRITES THE SAME READING
// =========================================================================

const page = child('page');
ok('the Schedule page boots on the stub', !page.boot, page.boot);
if (!page.boot) {
  ok('it takes its own reading of week 4', Boolean(page.snap), JSON.stringify(page.note));
  ok('THE PAGE’S READING IS IDENTICAL TO THE BAR’S, field for field (takenAt aside)',
    comparable(page.snap) === comparable(direct),
    diffHint(page.snap, direct));
  eq(page.rosters, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 'and it read the same weeks to get there');
  ok('the status line says week 4 was recorded', /^Week 4: recorded \S/.test(page.line), page.line);
  ok('the page noted its own success', page.note && page.note.ok && page.note.source === 'page', JSON.stringify(page.note));
  ok('its only raw fetch was the committed archive',
    page.fetchCalls.every((u) => /^data\/snapshots\//.test(u)), page.fetchCalls.join(' | '));

  // The Schedule page's standings TABLE was deleted on 2026-09-17 — Tim's
  // direction that the site adds to ESPN rather than rebuilding it — so the
  // four assertions that used to read it off that page are gone. The rule they
  // were really about is `capture.standingsKey`, which is unchanged and is
  // still exercised directly above; it is what seeds the simulated bracket.
}

const cloudPage = child('pageCloud', { CAP_CLOUD: '1' });
ok('the Schedule page boots on a synced copy', !cloudPage.boot, cloudPage.boot);
if (!cloudPage.boot) {
  eq(cloudPage.keys, [], 'NO reading is taken from the synced copy');
  ok('the refusal is noted', cloudPage.note && cloudPage.note.code === 'cloud', JSON.stringify(cloudPage.note));
  eq(cloudPage.line,
    'Week 4: NOT recorded — this is the synced copy from your computer, and readings are only taken on your computer.',
    'and the status line says why, in those words');
  ok('in red', /\bneg\b/.test(cloudPage.lineClass || ''), cloudPage.lineClass);
  ok('while the page itself still works from the copy', cloudPage.forecastRows > 0, cloudPage.forecastRows);
}

// =========================================================================
// 3. ANY PAGE: THE CONNECTION BAR TAKES IT
// =========================================================================

const bar = child('bar');
ok('a page with only the connection bar boots', !bar.boot, bar.boot);
if (!bar.boot) {
  ok('with the extension present, the bar took the week’s reading by itself', Boolean(bar.snap),
    `${bar.bar} / ${JSON.stringify(bar.note)}`);
  ok('and it is the same reading the Schedule page takes',
    comparable(bar.snap) === comparable(direct), diffHint(bar.snap, direct));
  ok('the bar says nothing about it when it worked', !bar.chip, JSON.stringify(bar.chip));
  ok('it told the page it had finished', bar.events.length === 1 && bar.events[0].code === 'recorded',
    JSON.stringify(bar.events));
  ok('it went through the extension, never a direct probe',
    bar.bridgeCalls.includes('PROBE') && bar.fetchCalls.every((u) => /^data\/snapshots\//.test(u)),
    `${bar.bridgeCalls.join(',')} | ${bar.fetchCalls.join(' | ')}`);
}

const barFail = child('bar', { CAP_ROSTERS_FAIL: '1' });
ok('the bar boots when ESPN refuses the rosters', !barFail.boot, barFail.boot);
if (!barFail.boot) {
  ok('no reading is written', !barFail.snap);
  ok('the bar shows a loud chip naming the week', barFail.chip && barFail.chip.text === 'Week 4 NOT recorded',
    JSON.stringify(barFail.chip) + ' / ' + barFail.bar);
  ok('which links to the Schedule page’s time machine',
    barFail.chip && barFail.chip.href === 'schedule.html#timePanel', JSON.stringify(barFail.chip));
  ok('styled as the bar’s stale warning', barFail.chip && /\bis-stale\b/.test(barFail.chip.cls), JSON.stringify(barFail.chip));
  ok('and the reason is kept for the Schedule page',
    barFail.note && barFail.note.code === 'no-projection' && barFail.note.source === 'bar', JSON.stringify(barFail.note));
}

const noBridge = child('bar', { CAP_NO_BRIDGE: '1' });
ok('the bar boots with no extension', !noBridge.boot, noBridge.boot);
if (!noBridge.boot) {
  eq(noBridge.keys, [], 'without the extension nothing is written — no reading, no note');
  eq(noBridge.schedule + noBridge.rosters.length, 0, 'and nothing is asked of ESPN for a reading');
  ok('and there is no chip', !noBridge.chip, JSON.stringify(noBridge.chip));
}

// ---------------------------------------------------------------------------

function diffHint(a, b) {
  if (!a || !b) return `a=${Boolean(a)} b=${Boolean(b)}`;
  const out = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'takenAt') continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      out.push(`${k}: ${JSON.stringify(a[k]).slice(0, 120)} vs ${JSON.stringify(b[k]).slice(0, 120)}`);
    }
  }
  return out.join(' | ') || 'identical';
}

for (const f of fails) console.log('FAIL ' + f);
console.log(fails.length ? `${pass} passed, ${fails.length} failed` : `All ${pass} assertions passed`);
process.exit(fails.length ? 1 : 0);
