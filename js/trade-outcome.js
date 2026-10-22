// A TRADE YOU SENT THAT ENDED WITHOUT GOING THROUGH — declined, expired,
// vetoed, or simply no longer pending.
//
// Tim, 2026-10-22: "in fantasy, If a sent trade is either expired or denied,
// put it in the notifications section where it asks the user if they want to
// follow up or not, or dismiss it, just so the user can best go forward with
// the scenario."
//
// HOW IT IS NOTICED. ESPN's waiting list (`view=mPendingTransactions`,
// js/pending.js) shows an offer only WHILE it waits. So the offers you sent are
// remembered each time that list is read on the computer (`ff.trades.sent.
// <leagueId>-<season>`), and one remembered last time but missing now has
// ended. Why it ended is then asked of ESPN's own history, one read
// (`view=mTransactions2` + `mRoster` + `mTeam`, js/season.js), only when an
// offer went missing:
//
//   accepted   a `TRADE_ACCEPT` / `TRADE_UPHOLD` naming it by
//              `relatedTransactionId`, or the rosters already show the swap
//              (every man you asked for is yours, every man you offered is
//              not): NEVER LISTED.
//   vetoed     a `TRADE_VETO` naming it, or `status: 'VETOED'`; and an accepted
//              trade in review that vanished BEFORE its process time.
//   declined   a `TRADE_DECLINE` (or `TRADE_REJECT`) naming it, `status:
//              'DECLINED' / 'REJECTED'`, or ESPN's CANCEL copy of it written by
//              the other manager's member id.
//   withdrawn  the CANCEL copy written by YOUR member id: you took it back
//              yourself, so it is NOT LISTED.
//   expired    ESPN's CANCEL copy written by a member id that owns no team
//              (ESPN's own job, about a minute after `expirationDate`),
//              `status: 'EXPIRED'`, or — with nothing in the history — its
//              `expirationDate` has passed.
//   gone       none of that could be told: "No longer pending".
//
// SOURCES (read 2026-10-22):
//   github.com/dustinJ15/fantasy  src/ff/sources/espn.py  `trade_resolutions`
//     — "How ESPN closed each trade proposal, from the `mTransactions2`
//     history view", "Probed live 2026-10-08 (three leagues)": TRADE_ACCEPT
//     wins; TRADE_DECLINE next; else the proposal's CANCEL copy, "withdrawn if
//     by == my_team_id else declined if by is not None else expired", `by`
//     being the team that owns the copy's `memberId`; "A lapse is the CANCEL
//     copy alone under a member id that owns no team (ESPN's job, 51 s after
//     `expirationDate`)". A withdrawal "has not been observed".
//   js/espn.js `parseTransactions` — TRADE_VETO / TRADE_DECLINE / TRADE_CANCEL
//     name the trade they close by `relatedTransactionId`.
//   The `status` words DECLINED / REJECTED / EXPIRED / VETOED are NOT seen in
//   any source; they are read only in case ESPN ever sends them.
//
// NOTHING HERE WAS MEASURED ON A REAL TRADE (no league we may read has one).
//
// THE PHONE never asks ESPN (rule 20): the computer sends the ended offers up
// with the synced copy (`schedule.pendingTrades.ended`), and the phone shows
// those. Dismissing one is remembered in that browser only.
//
// Pure, except the small storage section at the bottom.

/** How many ended offers are kept and synced, and how many handled ids remembered. */
export const MAX_ENDED = 10;
const MAX_HANDLED = 200;
const MAX_NAME = 60;

export const REASONS = ['declined', 'expired', 'vetoed', 'gone'];

/** The words for each reason, for the line's title. */
export const REASON_WORDS = {
  declined: 'Declined', expired: 'Expired', vetoed: 'Vetoed', gone: 'No longer pending',
};

const teamOf = (v) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const playerOf = (v) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isInteger(n) && n !== 0 ? n : null;
};
const idOf = (v) => {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  const s = String(v).trim();
  return s && s.length <= 80 ? s : '';
};
function stamp(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n > 0 ? n : null;
  const t = Date.parse(v);
  return Number.isFinite(t) && t > 0 ? t : null;
}
const nameOf = (v) => (typeof v === 'string' && v.trim() && v.length <= MAX_NAME ? v.trim() : null);
const member = (v) => (typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : '');
const sorted = (ids) => [...(ids || [])].map(Number).sort((a, b) => a - b).join('.');

/** Two offers are the same deal: same id, or the same manager and the same men both ways. */
export function sameDeal(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && String(a.id) === String(b.id)) return true;
  return String(a.withTeamId) === String(b.withTeamId) &&
    sorted(a.get) === sorted(b.get) && sorted(a.send) === sorted(b.send);
}

/** member id (upper case) -> team id, out of a payload's `teams[].owners`. */
export function ownersOf(teams) {
  const out = new Map();
  for (const t of Array.isArray(teams) ? teams : []) {
    const id = teamOf(t && t.id);
    if (id === null) continue;
    for (const m of Array.isArray(t.owners) ? t.owners : []) {
      const k = member(typeof m === 'string' ? m : m && m.id);
      if (k) out.set(k, id);
    }
  }
  return out;
}

/** playerId -> the team holding him, out of a payload's `teams[].roster.entries`; null with no rosters. */
export function holdersOf(teams) {
  const out = new Map();
  let any = false;
  for (const t of Array.isArray(teams) ? teams : []) {
    const id = teamOf(t && t.id);
    const entries = t && t.roster && Array.isArray(t.roster.entries) ? t.roster.entries : null;
    if (id === null || !entries) continue;
    any = true;
    for (const e of entries) {
      const p = playerOf(e && (e.playerId ?? (e.playerPoolEntry && e.playerPoolEntry.id)));
      if (p !== null) out.set(p, id);
    }
  }
  return any ? out : null;
}

/** playerId -> full name, out of the same rosters. */
export function rosterNames(teams) {
  const out = new Map();
  for (const t of Array.isArray(teams) ? teams : []) {
    for (const e of (t && t.roster && Array.isArray(t.roster.entries)) ? t.roster.entries : []) {
      const pl = e && e.playerPoolEntry && e.playerPoolEntry.player;
      const p = playerOf(e && (e.playerId ?? (e.playerPoolEntry && e.playerPoolEntry.id)));
      const n = nameOf(pl && pl.fullName);
      if (p !== null && n) out.set(p, n);
    }
  }
  return out;
}

const RANK = { accepted: 5, vetoed: 4, declined: 3, withdrawn: 2, expired: 1 };

/**
 * How ESPN closed each proposal, out of any records it sent (the history's
 * `transactions`, the waiting list's `pendingTransactions`, or both).
 *
 * @param {Array} records
 * @param {Object} o
 * @param {number} o.myTeamId
 * @param {Map} [o.owners] `ownersOf(teams)`: whose member id wrote a CANCEL copy
 * @returns {Map<string, {status:string, at:number|null}>} proposal id -> what
 *   ended it; the strongest word wins (accepted > vetoed > declined > withdrawn
 *   > expired). Never throws.
 */
export function resolutions(records, { myTeamId, owners = null } = {}) {
  const out = new Map();
  const me = teamOf(myTeamId);
  const put = (id, status, at) => {
    if (!id) return;
    const had = out.get(id);
    if (had && RANK[had.status] >= RANK[status]) return;
    out.set(id, { status, at: at ?? null });
  };
  try {
    for (const t of Array.isArray(records) ? records : []) {
      if (!t || typeof t !== 'object') continue;
      const type = String(t.type || '');
      const own = idOf(t.id);
      const rel = idOf(t.relatedTransactionId);
      const at = stamp(t.processDate) ?? stamp(t.proposedDate);
      const status = String(t.status || '').toUpperCase();
      // What a record says of the proposal it names.
      if (rel && rel !== own) {
        if (type === 'TRADE_ACCEPT' || type === 'TRADE_UPHOLD') put(rel, 'accepted', at);
        else if (type === 'TRADE_VETO') put(rel, 'vetoed', at);
        else if (type === 'TRADE_DECLINE' || type === 'TRADE_REJECT') put(rel, 'declined', at);
      }
      // The proposal's own copy: its status word, or ESPN's CANCEL copy.
      if (type !== 'TRADE_PROPOSAL') continue;
      const target = t.executionType === 'CANCEL' && rel ? rel : own;
      if (status === 'VETOED') put(target, 'vetoed', at);
      else if (status === 'DECLINED' || status === 'REJECTED') put(target, 'declined', at);
      else if (status === 'EXPIRED') put(target, 'expired', at);
      if (t.executionType !== 'CANCEL') continue;
      const by = owners && member(t.memberId) ? owners.get(member(t.memberId)) ?? null : undefined;
      if (by === undefined) {
        // Nobody to say who wrote it: only its clock can. Past its expiry, it lapsed.
        const exp = stamp(t.expirationDate);
        if (exp !== null && at !== null && at >= exp) put(target, 'expired', at);
        continue;
      }
      put(target, by === null ? 'expired' : by === me ? 'withdrawn' : 'declined', at);
    }
  } catch { /* what was read so far stands */ }
  return out;
}

/** Did the swap happen? Every man asked for is mine and every man offered is not. null = cannot tell. */
export function swapDone(offer, holders, myTeamId) {
  if (!holders || !offer) return null;
  const me = teamOf(myTeamId);
  const get = (offer.get || []).map(Number);
  const send = (offer.send || []).map(Number);
  if (!get.length && !send.length) return null;
  if (get.length) return get.every((p) => holders.get(p) === me) && send.every((p) => holders.get(p) !== me);
  return send.every((p) => holders.get(p) === teamOf(offer.withTeamId));
}

/**
 * Which remembered offers have ended without going through.
 *
 * @param {Object} o
 * @param {Array} o.seen    the offers you sent, as remembered last time
 * @param {Array} o.offers  everything waiting now (js/pending.js `pendingTrades`)
 * @param {Map|null} [o.resolved] `resolutions(...)`
 * @param {Map|null} [o.holders]  `holdersOf(teams)`: who holds each man now
 * @param {number} o.myTeamId
 * @param {number} o.now
 * @returns {{ended:Array, waiting:Array, missing:Array}}
 *   `ended` `{ id, withTeamId, get, send, reason, at, proposedAt, expiresAt }`;
 *   `waiting` what to remember for next time (still listed, or missing with
 *   nothing known yet); `missing` the remembered offers not on the list now.
 */
export function judge({ seen = [], offers = [], resolved = null, holders = null, myTeamId, now } = {}) {
  const ended = [];
  const waiting = [];
  const missing = [];
  const listed = Array.isArray(offers) ? offers : [];
  for (const s of Array.isArray(seen) ? seen : []) {
    if (!s || !s.id) continue;
    if (listed.some((o) => sameDeal(o, s))) continue;     // still waiting (or turned into a review)
    missing.push(s);
    const r = resolved ? resolved.get(String(s.id)) : null;
    let reason = null;
    if (r && r.status === 'accepted') continue;           // went through
    if (r && r.status === 'withdrawn') continue;          // you took it back yourself
    if (r && (r.status === 'declined' || r.status === 'vetoed' || r.status === 'expired')) reason = r.status;
    if (!reason) {
      const done = swapDone(s, holders, myTeamId);
      if (done === true) continue;                        // the rosters show it went through
      if (done === null) { waiting.push(s); continue; }   // nothing to tell by: ask again next time
      if (s.review === true) {
        // Accepted and in review: past its process time it went through (the
        // rosters may simply be behind); gone before it, the league stopped it.
        if (!(Number.isFinite(s.processAt) && now < s.processAt)) continue;
        reason = 'vetoed';
      } else if (Number.isFinite(s.expiresAt) && s.expiresAt <= now) reason = 'expired';
      else reason = 'gone';
    }
    const at = (r && r.at) ?? (reason === 'expired' && Number.isFinite(s.expiresAt) ? s.expiresAt : now);
    ended.push({
      id: String(s.id), withTeamId: s.withTeamId, get: [...(s.get || [])], send: [...(s.send || [])],
      reason, at, proposedAt: s.proposedAt ?? null, expiresAt: s.expiresAt ?? null,
      ...(s.getNames ? { getNames: s.getNames } : {}), ...(s.sendNames ? { sendNames: s.sendNames } : {}),
    });
  }
  return { ended, waiting, missing };
}

/**
 * The offers to remember now: every one I sent that is still listed, plus any
 * listed deal matching one remembered (an offer of mine turned into an accepted
 * trade in review keeps being watched, whoever ESPN says proposed it).
 */
export function sentNow(offers, seen = []) {
  const out = [];
  for (const o of Array.isArray(offers) ? offers : []) {
    if (!o || !o.id) continue;
    if (o.fromMe === true || (Array.isArray(seen) && seen.some((s) => sameDeal(s, o)))) out.push(o);
  }
  return out;
}

/** Ended offers cut to the contract's fields; what goes up with the sync and is believed coming back. */
export function cleanEnded(list, max = MAX_ENDED) {
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (out.length >= max) break;
    try {
      if (!e || typeof e !== 'object') continue;
      const id = idOf(e.id);
      const withTeamId = teamOf(e.withTeamId);
      if (!id || withTeamId === null || !REASONS.includes(e.reason)) continue;
      if (!Array.isArray(e.get) || !Array.isArray(e.send) || e.get.length > 24 || e.send.length > 24) continue;
      const get = e.get.map(playerOf);
      const send = e.send.map(playerOf);
      if (get.includes(null) || send.includes(null) || (!get.length && !send.length)) continue;
      const clean = {
        id, withTeamId, get, send, reason: e.reason,
        at: stamp(e.at), proposedAt: stamp(e.proposedAt), expiresAt: stamp(e.expiresAt),
      };
      for (const k of ['getNames', 'sendNames']) {
        if (Array.isArray(e[k]) && e[k].length <= 24) {
          const names = e[k].map((n) => nameOf(n) || '');
          if (names.some(Boolean)) clean[k] = names;
        }
      }
      out.push(clean);
    } catch { /* not one */ }
  }
  return out;
}

/** Remembered offers cut to js/pending.js `cleanOffers`' fields (plus the names). */
function cleanSeen(list) {
  const out = [];
  for (const o of Array.isArray(list) ? list : []) {
    if (out.length >= 20) break;
    if (!o || typeof o !== 'object' || !idOf(o.id) || teamOf(o.withTeamId) === null) continue;
    if (!Array.isArray(o.get) || !Array.isArray(o.send)) continue;
    const get = o.get.map(playerOf);
    const send = o.send.map(playerOf);
    if (get.includes(null) || send.includes(null)) continue;
    const s = {
      id: idOf(o.id), withTeamId: teamOf(o.withTeamId), get, send,
      proposedAt: stamp(o.proposedAt), expiresAt: stamp(o.expiresAt),
    };
    if (o.review === true) { s.review = true; s.processAt = stamp(o.processAt); }
    for (const k of ['getNames', 'sendNames']) {
      if (Array.isArray(o[k]) && o[k].length <= 24) s[k] = o[k].map((n) => nameOf(n) || '');
    }
    out.push(s);
  }
  return out;
}

// ------------------------------------------------------------------ storage
//
// `ff.trades.sent.<leagueId>-<season>` = { v:1, team, seen:[offer], ended:[outcome], handled:[id] }
//   seen     the offers you sent, as last read on the computer
//   ended    the ones that ended without going through, until handled
//   handled  ids dismissed or followed up: never shown again (league in the
//            key's NAME, so js/leagues.js's parking is not involved)

export const sentKey = (leagueId, season) => `ff.trades.sent.${leagueId}-${season}`;

const storageOf = (s) => {
  if (s) return s;
  try { return globalThis.localStorage || null; } catch { return null; }
};

/** The record for this league and team; an empty one for anything else. Never throws. */
export function readSent(leagueId, season, teamId, storage = null) {
  const empty = { v: 1, team: teamOf(teamId), seen: [], ended: [], handled: [] };
  try {
    const s = storageOf(storage);
    const r = s ? JSON.parse(s.getItem(sentKey(leagueId, season)) || 'null') : null;
    if (!r || r.v !== 1 || String(r.team) !== String(teamId)) return empty;
    return {
      v: 1, team: teamOf(teamId),
      seen: cleanSeen(r.seen),
      ended: cleanEnded(r.ended),
      handled: Array.isArray(r.handled) ? r.handled.map(idOf).filter(Boolean).slice(-MAX_HANDLED) : [],
    };
  } catch {
    return empty;
  }
}

export function writeSent(leagueId, season, rec, storage = null) {
  try {
    const s = storageOf(storage);
    if (!s) return;
    s.setItem(sentKey(leagueId, season), JSON.stringify({
      v: 1, team: rec.team, seen: cleanSeen(rec.seen), ended: cleanEnded(rec.ended),
      handled: (rec.handled || []).slice(-MAX_HANDLED),
    }));
  } catch { /* storage refused: it is asked again next time */ }
}

/** The ended offers still to show: not handled. */
export function activeEnded(list, handled) {
  const done = new Set((handled || []).map(String));
  return cleanEnded(list).filter((e) => !done.has(e.id));
}

/**
 * Dismissed or followed up: never shown again in this browser. Returns true
 * when it was written.
 */
export function markHandled(leagueId, season, teamId, id, storage = null) {
  const key = idOf(id);
  if (!key) return false;
  const rec = readSent(leagueId, season, teamId, storage);
  if (!rec.handled.includes(key)) rec.handled.push(key);
  rec.ended = rec.ended.filter((e) => e.id !== key);
  writeSent(leagueId, season, rec, storage);
  return true;
}

/**
 * One update after the waiting list was read on the computer: remember what is
 * waiting, add what ended. Pure over the record handed in; returns the new one.
 */
export function advance(rec, { offers, resolved = null, holders = null, myTeamId, now, names = null }) {
  const { ended, waiting } = judge({ seen: rec.seen, offers, resolved, holders, myTeamId, now });
  const named = (ids) => (names ? ids.map((id) => names.get(Number(id)) || '') : null);
  const seen = sentNow(offers, rec.seen).map((o) => {
    const keep = rec.seen.find((s) => sameDeal(s, o));
    const getNames = named(o.get) || (keep && keep.getNames) || null;
    const sendNames = named(o.send) || (keep && keep.sendNames) || null;
    return { ...o, ...(getNames ? { getNames } : {}), ...(sendNames ? { sendNames } : {}) };
  });
  for (const w of waiting) if (!seen.some((s) => sameDeal(s, w))) seen.push(w);
  const handled = new Set(rec.handled || []);
  const all = [...ended.filter((e) => !handled.has(e.id)), ...rec.ended.filter((e) => !ended.some((n) => n.id === e.id))];
  return { ...rec, seen, ended: all.slice(0, MAX_ENDED) };
}
