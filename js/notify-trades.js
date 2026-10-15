// The Trade page's best deals, kept for the Notifications page.
//
// Tim, 2026-10-11: "… messages on any trade notifications you have, or elete
// trade opportunities, these will all be shown in the notifications setting."
//
// The Trade page's ranked list takes 20 to 27 seconds to work out and its
// inputs are private to js/trade-page.js, so Notifications does not run it
// again (docs/notifications-plan.md, "After review" 1 and 3). Instead, when
// that list has FINISHED, the Trade page hands its rows here and the top of
// them is kept in this browser:
//
//   localStorage['ff.notes.trades.<leagueId>-<season>'] =
//     { v: 1, team, week, at, perWeek,
//       deals: [{ withTeamId, withName, get: [{id, name}], send: [{id, name}], gain, theirGain }] }
//
//   team      the squad the list was searched from (a team id)
//   week      the first week still to play when it was searched
//   at        when, epoch ms
//   perWeek   true when `gain` / `theirGain` are points A WEEK (the page's
//             usual "/wk" figures), false when they are totals
//   deals     at most MAX_DEALS, in the page's own final order; [] means the
//             list finished and had nothing to offer ("none right now")
//
// WHICH DEALS. No threshold is invented here. A deal is kept when BOTH numbers
// its row prints — "You gain" and "He gains", to the tenth, in the units the
// row shows — are above zero: the rows whose two gain cells the page colours
// as gains. The order is the page's (net increase, largest first), so "the
// best" is simply the first few of those.
//
// The league is in the key's NAME, so js/leagues.js (which parks the two
// single-slot keys on a switch) has nothing to do for it, and js/backup.js
// (which exports named prefixes only) never carries it. It is a note about a
// list that can be worked out again; losing it costs a visit to the Trade page.
//
// The picking and shaping are pure and take plain rows, so they are tested
// without the page (tests/test-notify-trades.mjs). Storage is reached only in
// `saveTradesNote` / `readTradesNote`, each inside a try.

export const NOTE_VERSION = 1;
export const MAX_DEALS = 3;

/** The key one league-season's note is kept under. */
export const tradesKey = (leagueId, season) => `ff.notes.trades.${leagueId}-${Number(season)}`;

/** The number a row prints: one decimal, `toFixed` as the page's own `fmt` does it. */
const tenth = (n) => Number(Number(n).toFixed(1));

const men = (list) => (Array.isArray(list) ? list : [])
  .filter((p) => p && p.playerId != null)
  .map((p) => ({ id: p.playerId, name: String(p.name ?? '') }));

/**
 * Is this row good for both sides, as the row itself shows it?
 *
 * `gain` and `theirGain` are the two figures the row prints. A figure that is
 * missing, or prints as "0.0" or below, is not a gain.
 */
export function goodForBoth(row) {
  if (!row || !Number.isFinite(row.gain) || !Number.isFinite(row.theirGain)) return false;
  return tenth(row.gain) > 0 && tenth(row.theirGain) > 0;
}

/**
 * The deals to keep, out of the ranked list.
 *
 * @param {Array<{partner:{id:number,name:string}, send:Array, receive:Array,
 *                gain:number, theirGain:number}>} rows
 *   the Trade page's offers IN THEIR FINAL ORDER — `partner`, `send` (the men
 *   you give) and `receive` (the men you get) exactly as an offer carries them,
 *   with the two gain figures as the row prints them
 * @param {number} [max] how many to keep
 * @returns {Array<{withTeamId, withName, get, send, gain, theirGain}>}
 */
/**
 * Is this row worth a line on Notifications? You gain, and the two squads
 * together gain (the Trade page's own order is by that net increase).
 *
 * Measured 2026-10-11 on a real league: none of 40 ranked deals gained for BOTH
 * sides — the finder lets the other manager lose a little — so "good for both"
 * left the line empty nearly always.
 */
export function worthSaving(row) {
  if (!row || !Number.isFinite(row.gain) || !Number.isFinite(row.theirGain)) return false;
  return tenth(row.gain) > 0 && tenth(tenth(row.gain) + tenth(row.theirGain)) > 0;
}

export function pickDeals(rows, max = MAX_DEALS) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (out.length >= max) break;
    if (!row || !row.partner || row.partner.id == null || !worthSaving(row)) continue;
    const get = men(row.receive);
    const send = men(row.send);
    // A deal with nobody on one side is not a trade anybody can open.
    if (!get.length || !send.length) continue;
    out.push({
      withTeamId: row.partner.id,
      withName: String(row.partner.name ?? ''),
      get,
      send,
      gain: tenth(row.gain),
      theirGain: tenth(row.theirGain),
    });
  }
  return out;
}

/**
 * The whole note, ready to store.
 *
 * @param {{team:number, week:number|null, at:number, perWeek?:boolean, rows:Array}} p
 */
export function tradesNote({ team, week, at, perWeek = true, rows, max = MAX_DEALS }) {
  return {
    v: NOTE_VERSION,
    team,
    week: Number.isFinite(week) ? week : null,
    at,
    perWeek: !!perWeek,
    deals: pickDeals(rows, max),
  };
}

/** A stored note that can be trusted to have the shape above. */
export function validNote(n) {
  return Boolean(n) && typeof n === 'object' && n.v === NOTE_VERSION &&
    Number.isFinite(n.at) && Array.isArray(n.deals) &&
    n.deals.every((d) => d && d.withTeamId != null && Array.isArray(d.get) && Array.isArray(d.send) &&
      Number.isFinite(d.gain) && Number.isFinite(d.theirGain));
}

function storageOf(given) {
  if (given) return given;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/** Keep a note. False when there was nowhere to put it, or the browser refused. */
export function saveTradesNote(leagueId, season, note, storage = null) {
  if (leagueId == null || leagueId === '' || !Number.isFinite(Number(season)) || !validNote(note)) return false;
  try {
    const s = storageOf(storage);
    if (!s) return false;
    s.setItem(tradesKey(leagueId, season), JSON.stringify(note));
    return true;
  } catch {
    return false;   // full, or private browsing: the note is simply not kept
  }
}

/**
 * SEND LATER (2026-10-15): the Trade page's saved custom trades that carry a
 * `sendAfter` week, for js/notify.js `sendLaterNotes`. They live in
 * `ff.prefs` → `trade.custom` (js/trade-page.js `saveCustomTrades`), and that
 * slot holds ONE league-season's preferences at a time (js/prefs.js), marked
 * `@league`: another league's mark → []. An unmarked slot is the open league's.
 */
export function readSendLater(leagueId, season, storage = null) {
  try {
    const s = storageOf(storage);
    const p = s ? JSON.parse(s.getItem('ff.prefs') || 'null') : null;
    if (!p || typeof p !== 'object' || Array.isArray(p)) return [];
    const mark = p['@league'];
    if (typeof mark === 'string' && mark !== `${leagueId}-${Number(season)}`) return [];
    const list = p['trade.custom'];
    return Array.isArray(list)
      ? list.filter((e) => e && typeof e === 'object' && e.sendAfter !== null && e.sendAfter !== undefined)
      : [];
  } catch {
    return [];
  }
}

/** The note kept for a league-season, or null when there is none worth reading. */
export function readTradesNote(leagueId, season, storage = null) {
  try {
    const s = storageOf(storage);
    const raw = s ? s.getItem(tradesKey(leagueId, season)) : null;
    if (!raw) return null;
    const n = JSON.parse(raw);
    return validNote(n) ? n : null;
  } catch {
    return null;
  }
}
