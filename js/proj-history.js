// Projection history: what every roster was projected to score, week by week,
// as the sheet stood in an earlier week.
//
// ---------------------------------------------------------------------------
// WHY THIS IS ITS OWN STORE
//
// Tim, 2026-10-05: "I want to make a proj changes chart in the analysis section
// that basically shows how a player's proj has changed between a certain time
// period/range. ... will show you what your season by week chart looked like
// around week 3 or 2 or something so you can see how it changed."
//
// ESPN overwrites a future week's projection in place (PROGRESS rule 8), so
// "the sheet as of week N" exists only if a copy was kept in week N. The weekly
// reading (js/snapshots.js, schema 2) keeps YOUR roster that way and nobody
// else's. This keeps EVERY squad's whole roster, with each man's projection in
// every week still projected — the Season-by-week chart, for any team.
//
// It is deliberately NOT a field on the reading and NOT a schema bump there: a
// reading is never rewritten or reshaped, and a week of this is several times
// the size of a reading. One key per league, season and week
// (`ff.projhist.1.<league>.<season>.<week>`), so a full browser loses at most
// the week it could not write, and nothing here is ever deleted to make room.
//
// FIRST COPY WINS, as with a reading: the earliest copy of a week is the one
// nearest to what the sheet said before that week was played.
//
// WHAT A COPY LOOKS LIKE (written by `capture.keepHistory`):
//
//   { v: 1, leagueId: '1241838', season: 2026, week: 5,
//     takenAt: '2026-10-05T18:02:11.000Z',
//     weeks: [5, 6, ... 16],
//     cols: ['id', 'name', 'pos', 'team', 'slot', 'inj', 'proj'],
//     teams: { '1': [[4262921, 'Justin Jefferson', 'WR', 'MIN', 4, 'ACTIVE',
//                     [17.42, 16.9, 0, ...]], ...], '2': [...] } }
//
// A man is a row named by `cols`, the form `capture.playersFrom` uses, and
// `proj` lines up with `weeks`: null where he was not on the roster that week
// or ESPN gave no number, 0 in his bye. Slot and injury status are as of the
// first week; a man who only appears on a later week's roster has a null slot.
//
// No DOM and no fetching. Storage and the readings are reached through `io`,
// so the suites drive this in Node with a Map behind it.

import * as snapshots from './snapshots.js';

/** Bumped when the stored shape changes; a copy of another schema is absent. */
export const SCHEMA = 1;

const PREFIX = `ff.projhist.${SCHEMA}`;

/** Refuse to keep something absurd. A real week is about 30KB. */
const MAX_BYTES = 200 * 1024;

/** `ff.projhist.1.<league>.<season>.<week>` — one key, one week's copy. */
export function keyOf(leagueId, season, week) {
  return `${PREFIX}.${leagueId}.${season}.${week}`;
}

/** Where `io` is not given: the browser's own storage, and the real readings. */
const storageOf = (io) => {
  try {
    return (io && io.storage) || globalThis.localStorage || null;
  } catch {
    return null;
  }
};
const readingsOf = (io) => (io && io.readings) || snapshots;

const usable = (rec) =>
  Boolean(rec) && rec.v === SCHEMA && Array.isArray(rec.weeks) && rec.weeks.length > 0 &&
  Boolean(rec.teams) && typeof rec.teams === 'object';

/** One week's stored copy as it was written, or null. Unreadable is absent. */
export function get(leagueId, season, week, io) {
  const s = storageOf(io);
  if (!s) return null;
  try {
    const raw = s.getItem(keyOf(leagueId, season, week));
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return usable(rec) ? rec : null;
  } catch {
    return null;
  }
}

export const has = (leagueId, season, week, io) => get(leagueId, season, week, io) !== null;

/**
 * Keep one week's copy, unless that week already has one.
 *
 * Never throws and never makes room: a full or refusing browser answers
 * `written: false` and everything already held is left where it was.
 *
 * @returns {{written: boolean, held?: boolean, bytes?: number}}
 */
export function save(rec, io) {
  if (!usable(rec) || !Number.isFinite(rec.week)) return { written: false };
  if (has(rec.leagueId, rec.season, rec.week, io)) return { written: false, held: true };
  const s = storageOf(io);
  if (!s) return { written: false };
  try {
    const json = JSON.stringify(rec);
    if (json.length > MAX_BYTES) return { written: false };
    s.setItem(keyOf(rec.leagueId, rec.season, rec.week), json);
    return { written: true, bytes: json.length };
  } catch {
    return { written: false };
  }
}

// A late copy that could not be taken (js/capture.js) is noted here so the
// next page does not ask ESPN for the same weeks again at once. Not under
// `ff.projhist.1.`, which `list` scans: a note is not a copy.
const MISS_PREFIX = 'ff.projhistnote';

/** When a late copy last failed, `{at, week}`, or null. */
export function lastMiss(leagueId, season, io) {
  const s = storageOf(io);
  if (!s) return null;
  try {
    const rec = JSON.parse(s.getItem(`${MISS_PREFIX}.${leagueId}.${season}`) || 'null');
    return rec && typeof rec === 'object' ? rec : null;
  } catch {
    return null;
  }
}

export function noteMiss(leagueId, season, rec, io) {
  const s = storageOf(io);
  if (!s) return false;
  try {
    s.setItem(`${MISS_PREFIX}.${leagueId}.${season}`, JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}

/** A stored row as the object the pages read. `proj` is week -> number|null. */
function playerOf(row, cols, weeks) {
  const at = (k) => row[cols.indexOf(k)];
  const proj = at('proj') || [];
  return {
    playerId: at('id') ?? null,
    name: at('name') || '',
    position: at('pos') || '',
    proTeam: at('team') || '',
    slotId: at('slot') ?? null,
    injuryStatus: at('inj') || 'ACTIVE',
    proj: new Map(weeks.map((w, i) => [w, typeof proj[i] === 'number' ? proj[i] : null])),
  };
}

const COLS = ['id', 'name', 'pos', 'team', 'slot', 'inj', 'proj'];

/** The one roster a schema-2 reading keeps week by week, or null. */
function readingRoster(snap) {
  const p = snap && snap.v === 2 ? snap.players : null;
  if (!p || p.teamId == null || !Array.isArray(p.mine) || !Array.isArray(p.weeks)) return null;
  return p;
}

/**
 * The weeks that have any history, earliest first.
 *
 * A stored copy covers every team; a week with only a schema-2 reading covers
 * the one roster that reading kept. A schema-1 reading, and a schema-2 one
 * taken with no team chosen, keep no roster and are not listed.
 *
 * A week with only a one-team copy from the cloud (below) is listed last of
 * all, as `source: 'cloud'`.
 *
 * @returns {Array<{week:number, takenAt:string, teams:'all'|number[], source:'store'|'reading'|'cloud'}>}
 */
export function list(leagueId, season, io) {
  const out = new Map();
  // Lowest first: a one-team copy that came down from the cloud is listed only
  // for a week that has neither a reading's roster nor a whole copy here.
  for (const rec of parts(leagueId, season, io)) {
    out.set(rec.week, { week: rec.week, takenAt: rec.takenAt, teams: Object.keys(rec.teams).map(Number), source: 'cloud' });
  }
  let snaps = [];
  try { snaps = readingsOf(io).list(leagueId, season) || []; } catch { snaps = []; }
  for (const snap of snaps) {
    const p = readingRoster(snap);
    if (p) out.set(snap.week, { week: snap.week, takenAt: snap.takenAt, teams: [Number(p.teamId)], source: 'reading' });
  }

  // Scanned, not indexed, as the readings are. A harness storage without
  // `length`/`key(i)` lists nothing here rather than throwing (tests/README).
  const s = storageOf(io);
  const want = `${PREFIX}.${leagueId}.${season}.`;
  try {
    const n = s && typeof s.key === 'function' && typeof s.length === 'number' ? s.length : 0;
    for (let i = 0; i < n; i++) {
      const k = s.key(i);
      if (!k || !k.startsWith(want)) continue;
      const week = Number(k.slice(want.length));
      const rec = Number.isFinite(week) ? get(leagueId, season, week, io) : null;
      if (rec) out.set(week, { week, takenAt: rec.takenAt, teams: 'all', source: 'store' });
    }
  } catch { /* what was found so far still stands */ }

  return [...out.values()].sort((a, b) => a.week - b.week);
}

/**
 * One team's whole roster as the sheet stood in `week`, or null.
 *
 * From the stored copy when that week has one. Otherwise from a schema-2
 * reading, which can answer for the one team it kept and no other. A schema-1
 * reading kept no players at all.
 *
 * @returns {{week:number, takenAt:string, weeks:number[], players:Array, source:'store'|'reading'}|null}
 */
export function teamAsOf(leagueId, season, week, teamId, io) {
  const rec = get(leagueId, season, week, io);
  if (rec) {
    const rows = rec.teams[teamId];
    if (!Array.isArray(rows)) return null;
    const cols = Array.isArray(rec.cols) ? rec.cols : COLS;
    const weeks = rec.weeks.slice();
    return {
      week: Number(week), takenAt: rec.takenAt, weeks,
      players: rows.map((r) => playerOf(r, cols, weeks)), source: 'store',
    };
  }

  let snap = null;
  try { snap = readingsOf(io).get(leagueId, season, week); } catch { snap = null; }
  const p = readingRoster(snap);
  if (p && Number(p.teamId) === Number(teamId)) {
    const cols = Array.isArray(p.cols) ? p.cols : COLS;
    const weeks = p.weeks.slice();
    return {
      week: Number(week), takenAt: snap.takenAt, weeks,
      players: p.mine.map((r) => playerOf(r, cols, weeks)), source: 'reading',
    };
  }

  // Last, a one-team copy from the cloud (see "THE CLOUD COPY" below).
  const part = getPart(leagueId, season, week, io);
  const rows = part ? part.teams[teamId] : null;
  if (!Array.isArray(rows)) return null;
  const cols = Array.isArray(part.cols) ? part.cols : COLS;
  const weeks = part.weeks.slice();
  return {
    week: Number(week), takenAt: part.takenAt, weeks,
    players: rows.map((r) => playerOf(r, cols, weeks)), source: 'cloud',
  };
}

// ---------------------------------------------------------------------------
// THE CLOUD COPY
//
// Tim, 2026-10-06: "can we make sure that we save it so that we don't lose it
// after every week and it changes?" Browser storage is one browser's, and can
// be emptied; so each week's copy also rides the cloud sync (js/cloud.js,
// `…/projhist/<week>`), and a browser that lacks a week takes it back from
// there — his phone, which never captures anything, most of all.
//
// A WHOLE copy that comes down is kept with `save`, in the store above, and is
// from then on indistinguishable from one taken here.
//
// A ONE-TEAM copy (`partial: true` — a week from before the store existed,
// which only a schema-2 reading's `mine` remembers) is kept under A KEY OF ITS
// OWN, `ff.projhist-part.1.<league>.<season>.<week>`. `has` does not see it, so
// it can never be the "first copy" that stops js/capture.js keeping the whole
// one, and the readers consult it last.

const PART_PREFIX = `ff.projhist-part.${SCHEMA}`;

/** `ff.projhist-part.1.<league>.<season>.<week>` — a one-team copy from the cloud. */
export function partKeyOf(leagueId, season, week) {
  return `${PART_PREFIX}.${leagueId}.${season}.${week}`;
}

function getPart(leagueId, season, week, io) {
  const s = storageOf(io);
  if (!s) return null;
  try {
    const raw = s.getItem(partKeyOf(leagueId, season, week));
    if (!raw) return null;
    const rec = JSON.parse(raw);
    return usable(rec) ? rec : null;
  } catch {
    return null;
  }
}

/** Every one-team copy held for a league and season. Scanned, as `list` scans. */
function parts(leagueId, season, io) {
  const out = [];
  const s = storageOf(io);
  const want = `${PART_PREFIX}.${leagueId}.${season}.`;
  try {
    const n = s && typeof s.key === 'function' && typeof s.length === 'number' ? s.length : 0;
    for (let i = 0; i < n; i++) {
      const k = s.key(i);
      if (!k || !k.startsWith(want)) continue;
      const week = Number(k.slice(want.length));
      const rec = Number.isFinite(week) ? getPart(leagueId, season, week, io) : null;
      if (rec) out.push({ ...rec, week });
    }
  } catch { /* what was found so far still stands */ }
  return out;
}

/** Is there anywhere to keep a copy at all? */
export function canKeep(io) {
  return storageOf(io) !== null;
}

/**
 * What the cloud sync sends: one copy per week this browser can answer for,
 * earliest first.
 *
 * The stored copy where the week has one. Otherwise the roster a schema-2
 * reading kept, in the same rows, with that one team under `teams`,
 * `partial: true` and the reading's own `takenAt`. Nothing is written here.
 *
 * @returns {Array<Object>} copies in the stored shape
 */
export function uploads(leagueId, season, io) {
  const out = [];
  for (const e of list(leagueId, season, io)) {
    if (e.source === 'store') {
      const rec = get(leagueId, season, e.week, io);
      if (rec) out.push(rec);
    } else if (e.source === 'reading') {
      let snap = null;
      try { snap = readingsOf(io).get(leagueId, season, e.week); } catch { snap = null; }
      const p = readingRoster(snap);
      if (!p || !p.weeks.length) continue;
      out.push({
        v: SCHEMA, leagueId: String(leagueId), season: Number(season), week: Number(e.week),
        takenAt: snap.takenAt, weeks: p.weeks.slice(),
        cols: Array.isArray(p.cols) ? p.cols.slice() : COLS.slice(),
        teams: { [p.teamId]: p.mine }, partial: true,
      });
    }
  }
  return out;
}

/**
 * Would a copy of this week from the cloud add anything here?
 *
 * A whole one: when the store has none. A one-team one: when there is no whole
 * copy, no one-team copy and no reading's roster for that week already.
 */
export function lacks(leagueId, season, week, partial, io) {
  if (has(leagueId, season, week, io)) return false;
  if (!partial) return true;
  if (getPart(leagueId, season, week, io)) return false;
  let snap = null;
  try { snap = readingsOf(io).get(leagueId, season, week); } catch { snap = null; }
  return !readingRoster(snap);
}

/**
 * Keep copies that came down from the cloud. FIRST COPY WINS, here too: a week
 * already held is left exactly as it is. Never throws.
 *
 * @returns {{kept:number, held:number, failed:number}}
 */
export function keepCloud(leagueId, season, copies, io) {
  const out = { kept: 0, held: 0, failed: 0 };
  for (const rec of copies || []) {
    try {
      if (!usable(rec) || !Number.isFinite(Number(rec.week)) ||
          String(rec.leagueId) !== String(leagueId) || Number(rec.season) !== Number(season)) {
        out.failed++;
        continue;
      }
      const week = Number(rec.week);
      let res;
      if (rec.partial !== true) {
        res = save({ ...rec, week }, io);
      } else if (getPart(leagueId, season, week, io)) {
        res = { written: false, held: true };
      } else {
        const s = storageOf(io);
        const json = JSON.stringify({ ...rec, week });
        if (!s || json.length > MAX_BYTES) res = { written: false };
        else { s.setItem(partKeyOf(leagueId, season, week), json); res = { written: true }; }
      }
      if (res.written) out.kept++;
      else if (res.held) out.held++;
      else out.failed++;
    } catch {
      out.failed++;
    }
  }
  return out;
}

// What this browser knows about the cloud's copies, one small key like
// js/connection.js's `ff.cloud.decisions`: `sent` is js/cloud.js's own marks
// for the weeks known to be up (so a sync neither reads nor writes them again),
// `seen` the cloud sync whose copies have already been taken down.
const CLOUD_NOTE_KEY = 'ff.cloud.projhist';

/** @returns {{sent:Object|null, seen:string|null}} */
export function cloudNote(leagueId, season, io) {
  const s = storageOf(io);
  try {
    const all = JSON.parse((s && s.getItem(CLOUD_NOTE_KEY)) || '{}');
    const mine = all && all[`${leagueId}::${season}`];
    return {
      sent: mine && mine.sent && typeof mine.sent === 'object' ? mine.sent : null,
      seen: mine && typeof mine.seen === 'string' ? mine.seen : null,
    };
  } catch {
    return { sent: null, seen: null };
  }
}

/** Merge `{sent}` and/or `{seen}` into the note. A refusing browser forgets. */
export function noteCloud(leagueId, season, patch, io) {
  const s = storageOf(io);
  if (!s) return false;
  try {
    const all = JSON.parse(s.getItem(CLOUD_NOTE_KEY) || '{}') || {};
    const key = `${leagueId}::${season}`;
    all[key] = { ...(all[key] && typeof all[key] === 'object' ? all[key] : {}), ...patch };
    s.setItem(CLOUD_NOTE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}
