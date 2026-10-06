// The whole archive in one file: Export archive, and Import, on the Schedule
// page's Time machine.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Tim, 2026-10-06: "can we make sure that we save it so that we don't lose it
// after every week and it changes?" The export used to write the weekly
// readings and nothing else, while four things live only in this browser and
// cannot be rebuilt once it is emptied:
//
//   - the readings                   js/snapshots.js     ff.snap.<L>.<S>.<week>
//   - every team's projection copy   js/proj-history.js  ff.projhist.1.<L>.<S>.<week>
//     and the one-team copies                            ff.projhist-part.1.<L>.<S>.<week>
//   - the Decisions review's weeks   js/store.js         ff.decisions.1.<L>.<S>.<week>
//   - the preferences, which is where saved and assumed trades are
//                                    js/prefs.js         ff.prefs
//
// THE FILE IS THE OLD FILE WITH MORE IN IT. `v`, `exportedAt`, `leagueId`,
// `season` and `snapshots` are exactly what `snapshots.exportAll` has always
// written, so a build from before this reads a new file's readings and ignores
// the rest; and a file from before this has no `backup` field and imports as
// readings alone. The additions sit one record to a line: a projection copy is
// thirteen numbers per man, and indented like the readings a season of them
// would be several megabytes of white space.
//
// IMPORT ONLY EVER ADDS. A week this browser already holds — a reading, a
// copy, a decisions week — is kept and the file's is ignored: the one here was
// taken at the time. Nothing is overwritten, deleted or reshaped.
//
// THE PREFERENCES ARE THE CAREFUL PART, because they are not a record, they
// are how the site is set up right now:
//
//   - a browser with NO preferences at all (emptied, or new) gets the file's,
//     whole;
//   - a browser that has any keeps every one of them untouched. The only
//     thing added is saved trades it does not already have — and a trade the
//     file had ASSUMED comes back as a saved trade, not an assumed one,
//     because assuming it rewrites both rosters on the Trade page and that is
//     not something a file should switch on behind anyone's back.
//
// Readings and copies go in through their own modules' `save`, so their own
// checks apply. A decisions week is written as it was read: js/store.js's
// writer stamps the time and replaces the record, and this may do neither.

import * as snapshots from './snapshots.js';
import * as projHistory from './proj-history.js';
import * as prefs from './prefs.js';

/** The version of the additions. A file without it is readings only. */
export const BACKUP = 1;

const PREFS_KEY = 'ff.prefs';
const DECISIONS_SCHEMA = 1;
const DECISIONS_PREFIX = `ff.decisions.${DECISIONS_SCHEMA}`;
/** Refuse to keep something absurd, as the other stores do. */
const MAX_DECISION_BYTES = 400 * 1024;

const decisionKeyOf = (leagueId, season, week) => `${DECISIONS_PREFIX}.${leagueId}.${season}.${week}`;

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/** js/store.js's own test of a decisions week. */
const decisionOk = (e) =>
  Boolean(e) && e.v === DECISIONS_SCHEMA && Array.isArray(e.moves) &&
  Boolean(e.players) && typeof e.players === 'object';

/** Every decided week's record held for a league and season, lowest week first. */
function decisionWeeks(leagueId, season) {
  const out = [];
  const s = storage();
  const want = `${DECISIONS_PREFIX}.${leagueId}.${season}.`;
  try {
    const n = s && typeof s.key === 'function' && typeof s.length === 'number' ? s.length : 0;
    for (let i = 0; i < n; i++) {
      const k = s.key(i);
      if (!k || !k.startsWith(want) || !/^\d+$/.test(k.slice(want.length))) continue;
      try {
        const record = JSON.parse(s.getItem(k));
        if (decisionOk(record)) {
          out.push({ leagueId: String(leagueId), season: Number(season), week: Number(k.slice(want.length)), record });
        }
      } catch { /* one unreadable key must not hide the rest */ }
    }
  } catch { /* what was found so far still stands */ }
  return out.sort((a, b) => a.week - b.week);
}

/** The preferences as stored, or null when there are none. */
function storedPrefs() {
  try {
    const raw = storage()?.getItem(PREFS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

/** A JSON array with one record to a line, at the envelope's indent. */
const lines = (list) => (list.length
  ? `[\n${list.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]`
  : '[]');

// ------------------------------------------------------------------ export

/**
 * Everything this browser holds for one league and season, as one file.
 *
 * @returns {{name:string, json:string, count:number, weeks:number[]}}
 *   `count` is how many weeks have anything in the file
 */
export function exportBackup(leagueId, season) {
  const base = snapshots.exportAll(leagueId, season);
  const readings = snapshots.list(leagueId, season);
  const held = typeof projHistory.stored === 'function'
    ? projHistory.stored(leagueId, season)
    : { whole: [], part: [] };
  const decisions = decisionWeeks(leagueId, season);
  const mine = storedPrefs();

  const weeks = [...new Set([
    ...readings.map((r) => r.week),
    ...held.whole.map((r) => r.week),
    ...held.part.map((r) => r.week),
    ...decisions.map((d) => d.week),
  ])].sort((a, b) => a - b);

  // The readings' own envelope, opened at its last brace and added to.
  const json = `${base.json.replace(/\n\}$/, '')},\n` +
    `  "backup": ${BACKUP},\n` +
    `  "projhist": ${lines(held.whole)},\n` +
    `  "projhistPart": ${lines(held.part)},\n` +
    `  "decisions": ${lines(decisions)},\n` +
    `  "prefs": ${JSON.stringify(mine)}\n}`;

  return { name: base.name, json, count: weeks.length, weeks };
}

// ------------------------------------------------------------------ import

/**
 * Read a file back: this build's, an older one's, or a bare reading.
 *
 * @returns {{snapshots:Array, projhist:Array, projhistPart:Array, decisions:Array,
 *            prefs:Object|null, error:string|null}}
 */
export function parseBackup(text) {
  const out = { snapshots: [], projhist: [], projhistPart: [], decisions: [], prefs: null, error: null };
  const readings = snapshots.parseImport(text);
  out.snapshots = readings.snapshots;

  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.backup != null) {
    const rows = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
    out.projhist = rows(parsed.projhist);
    out.projhistPart = rows(parsed.projhistPart);
    out.decisions = rows(parsed.decisions);
    const p = parsed.prefs;
    out.prefs = p && typeof p === 'object' && !Array.isArray(p) ? p : null;
  }

  const anything = out.snapshots.length || out.projhist.length || out.projhistPart.length ||
    out.decisions.length || out.prefs;
  if (!anything) out.error = readings.error;   // always set when it found no readings
  return out;
}

/** One trade, whichever side it was written from and in whatever order. */
function tradeKey(e) {
  if (!e || typeof e !== 'object') return null;
  const a = Number(e.a);
  const b = Number(e.b);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const ids = (v) => (Array.isArray(v) ? v.map(String).sort().join(',') : '');
  return a < b ? `${a}|${b}|${ids(e.sendA)}|${ids(e.sendB)}` : `${b}|${a}|${ids(e.sendB)}|${ids(e.sendA)}`;
}

/**
 * The preferences, by the rule in the header.
 *
 * @returns {{mode:'none'|'restored'|'merged', trades:number}}
 */
function importPrefs(filePrefs) {
  if (!filePrefs) return { mode: 'none', trades: 0 };
  const s = storage();
  if (!s) return { mode: 'none', trades: 0 };

  let here = null;
  try { here = s.getItem(PREFS_KEY); } catch { here = null; }
  if (here == null) {
    // Through js/prefs.js, so a page that has already read its preferences
    // does not write an older picture back over these on its next change.
    for (const [name, value] of Object.entries(filePrefs)) prefs.set(name, value);
    return { mode: 'restored', trades: 0 };
  }

  const mineRaw = prefs.get('trade.custom', []);
  if (!Array.isArray(mineRaw)) return { mode: 'merged', trades: 0 };
  const assumedHere = prefs.get('trade.assumed', null);
  const have = new Set([...mineRaw, assumedHere && assumedHere.entry].map(tradeKey).filter(Boolean));

  const theirs = Array.isArray(filePrefs['trade.custom']) ? filePrefs['trade.custom'].slice() : [];
  const assumedThere = filePrefs['trade.assumed'];
  if (assumedThere && assumedThere.entry) theirs.push(assumedThere.entry);

  const add = [];
  for (const e of theirs) {
    const k = tradeKey(e);
    if (!k || have.has(k)) continue;
    have.add(k);
    add.push({ a: e.a, b: e.b, sendA: e.sendA || [], sendB: e.sendB || [] });
  }
  if (add.length) prefs.set('trade.custom', [...mineRaw, ...add]);
  return { mode: 'merged', trades: add.length };
}

/**
 * Put a parsed file into this browser. ADDS ONLY — see the header.
 *
 * A WEEK counts as added when anything of it was (its reading, its copy, its
 * decisions), and as kept when the file had it and all of it was here already.
 *
 * @param {Object} file  `parseBackup()`'s answer
 * @returns {{added:number, kept:number, failed:string[],
 *            parts:Object, prefs:{mode:string, trades:number}}}
 */
export function importBackup(file) {
  const weeks = new Map();   // "<league>.<season>.<week>" -> 'added' | 'kept'
  const failed = [];
  const parts = {
    readings: { added: 0, kept: 0 },
    projhist: { added: 0, kept: 0 },
    projhistPart: { added: 0, kept: 0 },
    decisions: { added: 0, kept: 0 },
  };
  const mark = (kind, rec, outcome) => {
    const k = `${rec.leagueId}.${rec.season}.${rec.week}`;
    if (outcome === 'failed') return;
    parts[kind][outcome]++;
    if (outcome === 'added' || !weeks.has(k)) weeks.set(k, outcome);
  };

  // The readings, one at a time through their own importer (first copy wins).
  for (const snap of file.snapshots || []) {
    const res = snapshots.importAll([snap]);
    if (res.failed.length) failed.push(...res.failed);
    mark('readings', snap, res.added ? 'added' : res.kept ? 'kept' : 'failed');
  }

  // The projection copies, through `keepCloud`: it is already the "a copy has
  // arrived from elsewhere, keep it unless this week has one" path.
  for (const [kind, list, partial] of [['projhist', file.projhist, false], ['projhistPart', file.projhistPart, true]]) {
    for (const rec of list || []) {
      let res = { kept: 0, held: 0, failed: 1 };
      // A copy filed in the wrong list is not trusted to say which it is.
      if ((rec.partial === true) === partial && typeof projHistory.keepCloud === 'function') {
        res = projHistory.keepCloud(rec.leagueId, rec.season, [rec]);
      }
      if (res.kept) mark(kind, rec, 'added');
      else if (res.held) mark(kind, rec, 'kept');
      else failed.push(`week ${rec.week}: its saved projections could not be kept`);
    }
  }

  // The Decisions weeks, exactly as they were stored.
  const s = storage();
  for (const d of file.decisions || []) {
    const week = Number(d.week);
    const fits = /^\d+$/.test(String(d.leagueId ?? '')) && Number.isFinite(Number(d.season)) &&
      Number.isInteger(week) && week > 0 && decisionOk(d.record);
    let outcome = 'failed';
    if (fits && s) {
      try {
        const key = decisionKeyOf(d.leagueId, Number(d.season), week);
        if (s.getItem(key) != null) outcome = 'kept';
        else {
          const json = JSON.stringify(d.record);
          if (json.length <= MAX_DECISION_BYTES) { s.setItem(key, json); outcome = 'added'; }
        }
      } catch { outcome = 'failed'; }
    }
    if (outcome === 'failed') failed.push(`week ${d.week}: its decisions could not be kept`);
    mark('decisions', { leagueId: d.leagueId, season: Number(d.season), week }, outcome);
  }

  let prefsDone = { mode: 'none', trades: 0 };
  try { prefsDone = importPrefs(file.prefs); } catch { /* the weeks are in either way */ }

  const outcomes = [...weeks.values()];
  return {
    added: outcomes.filter((o) => o === 'added').length,
    kept: outcomes.filter((o) => o === 'kept').length,
    failed,
    parts,
    prefs: prefsDone,
  };
}
