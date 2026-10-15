// THE ASSUMED TRADE, SITE-WIDE (Tim, 2026-10-15).
//
// "could you make it so that if a trade is assumed in the trade section, the
// other sections that talk about each user's current team or future predictions
// such as the analysis section, the future schedule, the current player on
// draft or anything else are adjusted so that that user has updated
// information?"
//
// The Trade page's Assume (js/trade-page.js, THE ASSUMED TRADE) takes one saved
// trade as done. The page works out the moves once — what each side sends, and
// the forced roster cut the trade's own pricing chose — and PERSISTS them here
// (`trade.assumedMoves` in js/prefs.js, so the main menu parks it with the
// league's other choices). Every other page reads that record and never prices
// anything again.
//
// ONE IMPLEMENTATION of "this week's squads with the trade made":
// `applyAssumed`. The Trade page calls it for its own rosters; js/season.js
// calls it on the way out of every roster read (`fetchWeekRosters`,
// `fetchWeeksRosters`), so a page needs no code of its own. What is stored in
// js/store.js or sent to the phone stays as ESPN sent it: the trade is made on
// copies, at read time.
//
// PLAYED WEEKS ARE NEVER REWRITTEN: a week with a result, or under way, keeps
// its real squads. Nor the weeks up to the entry's "send after week N".
//
// PER BROWSER. The record lives in this browser's storage; the phone's synced
// copy carries no assumption, and an assumption made on the phone stays there.
//
// Pure apart from `readMoves` / `stopAssuming` (storage, guarded) and
// `mountNotice` (the one-line notice, DOM, guarded).

import * as prefs from './prefs.js';

/** Where the Trade page keeps the worked-out moves (js/prefs.js key). */
export const MOVES_PREF = 'trade.assumedMoves';
/** The Trade page's own keys: the assumed entry and the saved list it came from. */
const ASSUMED_PREF = 'trade.assumed';
const SAVED_PREF = 'trade.custom';

const BENCH_SLOT = 20;

/** The Trade page's name for a live league-season (`sourceKey()` there). */
export const srcOf = (leagueId, season) => `live:${leagueId}:${season}`;

const ids = (v) => new Set((Array.isArray(v) ? v : v instanceof Set ? [...v] : []).map(String));
const finite = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * A stored record, checked, with Sets — or null. `{src, a, b, aName, bName,
 * sendA, sendB, cutA, cutB, after}`; `after` is the week the trade is sent
 * after (null = now).
 */
export function parseMoves(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const a = finite(raw.a);
  const b = finite(raw.b);
  if (a === null || b === null || a === b || typeof raw.src !== 'string' || !raw.src) return null;
  const sendA = ids(raw.sendA);
  const sendB = ids(raw.sendB);
  if (!sendA.size && !sendB.size) return null;
  return {
    src: raw.src,
    a,
    b,
    aName: typeof raw.aName === 'string' ? raw.aName : '',
    bName: typeof raw.bName === 'string' ? raw.bName : '',
    sendA,
    sendB,
    cutA: ids(raw.cutA),
    cutB: ids(raw.cutB),
    after: finite(raw.after),
  };
}

/** A record as it is stored: arrays, not Sets. */
export function serializeMoves(m) {
  if (!m) return null;
  const arr = (s) => [...(s || [])].map(String);
  return {
    src: m.src, a: m.a, b: m.b, aName: m.aName || '', bName: m.bName || '',
    sendA: arr(m.sendA), sendB: arr(m.sendB), cutA: arr(m.cutA), cutB: arr(m.cutB),
    after: Number.isFinite(m.after) ? m.after : null,
  };
}

/** The stored record, or null. Never throws. */
export function readMoves() {
  try { return parseMoves(prefs.get(MOVES_PREF, null)); } catch { return null; }
}

/** The stored record when it belongs to this league-season, or null. */
export function movesFor(leagueId, season) {
  if (leagueId === null || leagueId === undefined || leagueId === '') return null;
  const m = readMoves();
  return m && m.src === srcOf(leagueId, season) ? m : null;
}

/** Written by the Trade page only (null clears it). */
export function writeMoves(m) {
  try { prefs.set(MOVES_PREF, m ? serializeMoves(m) : null); } catch { /* storage refused */ }
}

const isPlayed = (played, week) => {
  if (!played) return false;
  if (typeof played === 'function') return !!played(week);
  if (played instanceof Set) return played.has(Number(week));
  return Array.isArray(played) && played.map(Number).includes(Number(week));
};

const total = (arr, key) => {
  const vals = arr.map((p) => p[key]).filter((v) => typeof v === 'number');
  if (!vals.length) return null;
  return Math.round(vals.reduce((s, v) => s + v, 0) * 10) / 10;
};

/**
 * One week's teams with the assumed trade made; THE SAME ARRAY when nothing
 * changes (no record, a played week, a week up to "send after", a squad
 * missing). What each side sends leaves it, what it receives arrives ON THE
 * BENCH (a lineup is the manager's to set), and the forced cuts leave both.
 * A team's set-lineup totals are worked out again from its new starters.
 *
 * @param {Array} teams one week's teams, as js/season.js returns them
 * @param {number} week
 * @param {Object|null} moves `parseMoves` output (or the Trade page's own)
 * @param {Object} [opts]
 * @param {Set|Array|Function} [opts.played] weeks that keep their real squads
 */
export function applyAssumed(teams, week, moves, { played = null } = {}) {
  const m = moves;
  if (!m || !Array.isArray(teams) || !teams.length) return teams;
  if (isPlayed(played, week)) return teams;
  if (Number.isFinite(m.after) && Number(week) <= m.after) return teams;
  const ta = teams.find((t) => t && t.id === m.a);
  const tb = teams.find((t) => t && t.id === m.b);
  if (!ta || !tb) return teams;
  const sendA = ids(m.sendA);
  const sendB = ids(m.sendB);
  const cutA = ids(m.cutA);
  const cutB = ids(m.cutB);
  // 'BE' is js/espn.js SLOT_LABELS[20], as a roster read labels a bench man.
  const bench = (p) => ({ ...p, started: false, lineupSlotId: BENCH_SLOT, slot: 'BE' });
  const remake = (team, send, cut, from, gets) => {
    const kept = (team.players || []).filter((p) =>
      !send.has(String(p.playerId)) && !cut.has(String(p.playerId)));
    const arriving = (from.players || [])
      .filter((p) => gets.has(String(p.playerId)) && !cut.has(String(p.playerId)))
      .map(bench);
    const players = kept.concat(arriving);
    const starters = players.filter((p) => p.started);
    const out = { ...team, players, starters, bench: players.filter((p) => !p.started) };
    // The set lineup's own totals, as js/season.js makes them, where it made them.
    if ('projectedTotal' in team) out.projectedTotal = total(starters, 'projected');
    if ('actualTotal' in team) out.actualTotal = total(starters, 'actual');
    if ('benchActualTotal' in team) out.benchActualTotal = total(out.bench, 'actual');
    if ('seasonProjectedTotal' in team) out.seasonProjectedTotal = total(starters, 'seasonProjected');
    return out;
  };
  const na = remake(ta, sendA, cutA, tb, sendB);
  const nb = remake(tb, sendB, cutB, ta, sendA);
  return teams.map((t) => (t === ta ? na : t === tb ? nb : t));
}

/**
 * STOP, from any page: the same as Remove on the Trade page — the trade goes
 * back into the saved list where it was, and nothing is assumed any more.
 */
export function stopAssuming() {
  try {
    const held = prefs.get(ASSUMED_PREF, null);
    if (held && typeof held === 'object' && held.entry && typeof held.entry === 'object') {
      const saved = prefs.get(SAVED_PREF, []);
      const list = Array.isArray(saved) ? saved.slice() : [];
      const at = Math.max(0, Math.min(Number.isFinite(Number(held.at)) ? Number(held.at) : 0, list.length));
      list.splice(at, 0, held.entry);
      prefs.set(SAVED_PREF, list);
    }
    prefs.set(ASSUMED_PREF, null);
    prefs.set(MOVES_PREF, null);
  } catch { /* storage refused: nothing more can be done from here */ }
}

/** The open league-season from the connection slot (js/prefs.js reads it the same way). */
function openLeague() {
  try {
    const saved = JSON.parse(localStorage.getItem('ff.connection') || '{}');
    if (!saved || !saved.leagueId) return null;
    const now = new Date();
    const season = Number(saved.season) || (now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear());
    const teamId = saved.teamId === null || saved.teamId === undefined || saved.teamId === '' ? null : Number(saved.teamId);
    return { leagueId: String(saved.leagueId), season, teamId };
  } catch {
    return null;
  }
}

/** The notice's words: "Assuming your trade with <name>" (or both names when it is not yours). */
export function noticeText(m, myTeamId = null) {
  if (!m) return '';
  const a = m.aName || `Team ${m.a}`;
  const b = m.bName || `Team ${m.b}`;
  if (myTeamId === m.a) return `Assuming your trade with ${b}`;
  if (myTeamId === m.b) return `Assuming your trade with ${a}`;
  return `Assuming ${a}'s trade with ${b}`;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * THE ONE-LINE NOTICE under the connection bar, on every page whose numbers
 * the assumption changes, so a figure that differs from ESPN's is explained:
 * "Assuming your trade with <name> · Stop". Stop clears it and loads the page
 * again. Not on the Trade page (it has its own block) nor on Decisions (a
 * review of what was done, read off the real squads). Nothing when no trade
 * is assumed for the open league.
 */
export function mountNotice(doc = typeof document === 'undefined' ? null : document) {
  try {
    if (!doc) return null;
    const bar = doc.getElementById('connBar');
    if (!bar || doc.getElementById('assumedPanel') || doc.getElementById('assumeSite')) return null;
    const path = String((doc.location && doc.location.pathname) || (typeof location !== 'undefined' && location.pathname) || '');
    if (/decisions\.html$/.test(path)) return null;
    const open = openLeague();
    const m = open ? movesFor(open.leagueId, open.season) : null;
    if (!m) return null;
    const p = doc.createElement('p');
    p.id = 'assumeSite';
    p.className = 'panel-note assume-site';
    p.innerHTML = `${esc(noticeText(m, open.teamId))} &middot; ` +
      '<button type="button" class="assume-stop" id="assumeStop">Stop</button>';
    bar.insertAdjacentElement('afterend', p);
    const stop = doc.getElementById('assumeStop');
    if (stop) {
      stop.addEventListener('click', () => {
        stopAssuming();
        try { if (typeof location !== 'undefined' && typeof location.reload === 'function') location.reload(); } catch { /* the notice is gone either way */ }
        p.remove();
      });
    }
    return p;
  } catch {
    return null;
  }
}
