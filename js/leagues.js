// The leagues this browser knows, and the switch between them.
//
// Tim, 2026-10-10: "I want to make a main menu that is outside all of our
// current sections where the user can add different leagues to their account
// as well as look into past leagues aswell. ... If you go inside any specific
// league it will look just like how the cite currently is but the information
// will reflect the information that is specific for that leauge."
//
// ---------------------------------------------------------------------------
// HOW A SWITCH WORKS (docs/main-menu-plan.md, "Park and restore")
//
// The site reads ONE league, through the connection slot (`ff.connection`,
// `ff.config`), and no page reacts to that slot changing. So a switch is a
// navigation: `open()` rewrites the slot and hands back the page to go to.
//
// Almost everything the site stores is already keyed by league and season
// (`ff.weeks.*`, `ff.snap.*`, `ff.projhist.*`, `ff.decisions.*`, `ff.value.*`).
// Two keys are single slots holding one league's choices: `ff.prefs` and
// `ff-draft-review-v1`. `open()` PARKS them under `<key>@<league>-<season>` and
// puts the target's back. A league-season never opened starts from the current
// preferences with everything that names a team, a week or a trade taken out.
//
// NOTHING IS EVER DELETED. `remove()` takes a league off the list; its weeks,
// readings and parked preferences stay where they are.
//
// A browser that has never seen the menu has no `ff.leagues` key; the list is
// then read off the saved connection, and nothing is written until something
// is added, removed or opened.

import * as bridge from './bridge.js';

/**
 * The earliest season offered. Measured 2026-10-10 on league 1241838: weekly
 * rosters, schedule and draft answer for 2019 on; 2018 and older are refused.
 */
export const SEASON_MIN = 2019;

/** The single-slot keys that belong to one league-season. */
export const PARKED = ['ff.prefs', 'ff-draft-review-v1'];

const KEY = 'ff.leagues';
const CONN_KEY = 'ff.connection';
const LEGACY_KEY = 'ff.config';
const PREFS_KEY = 'ff.prefs';
const REVIEW_KEY = 'ff-draft-review-v1';
/** js/prefs.js's mark of whose preferences these are. tests/test-leagues.mjs holds the two equal. */
const STAMP = '@league';
const HOST = 'https://lm-api-reads.fantasy.espn.com';

/** Every page that remembers which data it shows (`<page>.source`). */
const PAGES = ['home', 'analysis', 'schedule', 'stats', 'summary', 'trade', 'waivers', 'decisions', 'draft'];

/**
 * Is this preference about ONE league — a team, a week, a trade?
 *
 * Read off every `prefs`/`scope(` use in js/ (2026-10-10):
 *   <page>.team            analysis, trade, waivers
 *   <page>.week            analysis, trade, schedule
 *   trade.custom           saved trades (team and player ids)
 *   trade.assumed          the assumed trade
 *   stats.highlight        a team id
 *   schedule.forecastTeam  a team id
 *   decisions.team.<L-S>, decisions.all.<L-S>, decisions.whatif.<L-S>
 *   draft.team.<L-S>
 *   analysis.history.live:<L>:<S>, analysis.rows.live:…, analysis.changes.live:…
 * The `.demo` forms of the keyed ones are about the demo league and carry over,
 * as does every display choice (switches, sorts, filters, goal, runs).
 */
export function leagueSpecific(name) {
  if (name === STAMP) return true;
  if (/^[a-z]+\.(team|week)$/i.test(name)) return true;
  if (['trade.custom', 'trade.assumed', 'stats.highlight', 'schedule.forecastTeam'].includes(name)) return true;
  if (/^(decisions\.(team|all|whatif)|draft\.team)\./.test(name)) return !name.endsWith('.demo');
  if (/\.live:/.test(name)) return true;
  return false;
}

export const keyOf = (leagueId, season) => `${leagueId}-${season}`;

// ----------------------------------------------------------------- storage

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

function read(key) {
  try {
    const s = storage();
    return s ? s.getItem(key) : null;
  } catch {
    return null;
  }
}

function readJson(key) {
  const raw = read(key);
  if (raw == null) return null;
  try {
    const p = JSON.parse(raw);
    return p && typeof p === 'object' && !Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

const realId = (id) => /^\d+$/.test(String(id ?? ''));

function thisSeason() {
  try {
    if (typeof bridge.currentSeason === 'function') return bridge.currentSeason();
  } catch { /* fall through */ }
  const now = new Date();
  return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
}

const seasonList = (list) => [...new Set((Array.isArray(list) ? list : [])
  .map(Number).filter((s) => Number.isInteger(s) && s >= SEASON_MIN))].sort((a, b) => b - a);

const teamOf = (t) => (t && typeof t === 'object' && t.id != null
  ? { id: t.id, name: String(t.name ?? `Team ${t.id}`) } : null);

/** One stored league, made safe to use whatever was in storage. */
function clean(e) {
  if (!e || typeof e !== 'object' || !realId(e.leagueId)) return null;
  const teams = {};
  if (e.teams && typeof e.teams === 'object') {
    for (const [season, t] of Object.entries(e.teams)) {
      const team = teamOf(t);
      if (team && /^\d{4}$/.test(season)) teams[season] = team;
    }
  }
  const lo = e.lastOpened;
  const out = {
    leagueId: String(e.leagueId),
    name: typeof e.name === 'string' && e.name ? e.name : `League ${e.leagueId}`,
    teamCount: Number.isFinite(e.teamCount) ? e.teamCount : null,
    seasons: seasonList(e.seasons),
    teams,
    lastOpened: lo && typeof lo === 'object' && Number.isFinite(Number(lo.season))
      ? { season: Number(lo.season), at: Number(lo.at) || 0 } : null,
    addedAt: Number(e.addedAt) || 0,
  };
  // WHEN each thing was last changed, for the account's list (`mergeAccount`):
  // the name and size, and each season's "You are" team. Absent means "not
  // known", which loses to any time that is.
  const infoAt = stampOf(e.infoAt);
  if (infoAt) out.infoAt = infoAt;
  const teamAt = {};
  if (e.teamAt && typeof e.teamAt === 'object') {
    for (const season of Object.keys(teams)) {
      const at = stampOf(e.teamAt[season]);
      if (at) teamAt[season] = at;
    }
  }
  if (Object.keys(teamAt).length) out.teamAt = teamAt;
  return out;
}

/** A time in milliseconds, or 0 for anything that is not one. */
function stampOf(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The connection slot, as it is saved: `ff.connection`, then the older `ff.config`. */
function savedConnection() {
  for (const key of [CONN_KEY, LEGACY_KEY]) {
    const saved = readJson(key);
    if (saved && saved.leagueId) return saved;
  }
  return null;
}

/** What the connection slot holds, or null. */
export function current() {
  const saved = savedConnection();
  if (!saved) return null;
  return {
    leagueId: String(saved.leagueId),
    season: Number(saved.season) || thisSeason(),
    teamId: saved.teamId ?? null,
  };
}

/** The saved connection as a list entry — what a browser that never saw the menu has. */
function seedEntry() {
  const saved = savedConnection();
  const cur = current();
  if (!cur || !realId(cur.leagueId)) return null;
  const lg = saved.league && typeof saved.league === 'object' ? saved.league : {};
  const teams = Array.isArray(lg.teams) ? lg.teams : [];
  const mine = cur.teamId == null ? null : teams.find((t) => t && String(t.id) === String(cur.teamId));
  return clean({
    leagueId: cur.leagueId,
    name: lg.name,
    teamCount: Number.isFinite(lg.teamCount) ? lg.teamCount : (teams.length || null),
    seasons: [cur.season],
    teams: mine ? { [cur.season]: mine } : {},
    lastOpened: { season: cur.season, at: Number(saved.checkedAt) || 0 },
    addedAt: Number(saved.checkedAt) || 0,
  });
}

/**
 * The list and its notes, as they stand.
 *
 * `stored` is false when `ff.leagues` is absent or unreadable: the list is then
 * the saved connection alone. Either way the open league is in it — an older
 * cached build may have connected to one this file never heard about.
 */
function load() {
  const raw = readJson(KEY);
  const stored = Boolean(raw && Array.isArray(raw.leagues));
  const state = {
    v: 1,
    leagues: stored ? raw.leagues.map(clean).filter(Boolean) : [],
    removed: stored && Array.isArray(raw.removed) ? raw.removed.map(String).filter(realId) : [],
    probe: stored && typeof raw.probe === 'string' ? raw.probe : null,
    source: stored && (raw.source === 'cloud' || raw.source === 'espn') ? raw.source : null,
  };
  // When each removed league was taken off (`mergeAccount`). Kept only while
  // there is one, so a list nobody has removed from is stored as it always was.
  const removedAt = {};
  if (stored && raw.removedAt && typeof raw.removedAt === 'object') {
    for (const id of state.removed) {
      const at = stampOf(raw.removedAt[id]);
      if (at) removedAt[id] = at;
    }
  }
  if (Object.keys(removedAt).length) state.removedAt = removedAt;
  // One entry per league, whatever storage held.
  const seen = new Set();
  state.leagues = state.leagues.filter((e) => !seen.has(e.leagueId) && seen.add(e.leagueId));

  const seed = seedEntry();
  if (seed) {
    const mine = state.leagues.find((e) => e.leagueId === seed.leagueId);
    if (!mine) state.leagues.push(seed);
    else {
      mine.seasons = seasonList([...mine.seasons, ...seed.seasons]);
      if (!mine.lastOpened) mine.lastOpened = seed.lastOpened;
    }
  }
  return state;
}

function save(state, put = null) {
  const json = JSON.stringify(state);
  if (put) put(KEY, json);
  else storage().setItem(KEY, json);
}

const publicOf = (e) => ({
  leagueId: e.leagueId,
  name: e.name,
  teamCount: e.teamCount,
  seasons: e.seasons.slice(),
  teams: Object.fromEntries(Object.entries(e.teams).map(([s, t]) => [s, { ...t }])),
  lastOpened: e.lastOpened ? { ...e.lastOpened } : null,
});

// -------------------------------------------------------------------- the list

/** Every league, most recently opened first. Never throws. */
export function list() {
  try {
    const at = (e) => (e.lastOpened ? e.lastOpened.at : -1);
    return load().leagues
      .slice()
      .sort((a, b) => at(b) - at(a) || b.addedAt - a.addedAt)
      .map(publicOf);
  } catch {
    return [];
  }
}

/**
 * Add a league, or add to what is known about one. Never drops a known season
 * or a known team.
 *
 * @param {Object} l
 * @param {string|number} l.leagueId
 * @param {string} [l.name]
 * @param {number} [l.teamCount]
 * @param {number[]} [l.seasons]  every season known to exist
 * @param {number} [l.season]     the season `team` is for
 * @param {{id:number, name:string}} [l.team]  "You are", in `season`
 * @param {'cloud'|'espn'} [l.source]  where the league was just read from (the
 *   connection bar passes it; `lookup()` reads it back)
 * @returns {Object|null} the entry, as `list()` gives it; null for a league id that is not one
 */
export function add({ leagueId, name, teamCount, seasons, season, team, source } = {}) {
  if (!realId(leagueId)) return null;
  const id = String(leagueId);
  let state;
  try { state = load(); } catch { state = { v: 1, leagues: [], removed: [], probe: null, source: null }; }

  let e = state.leagues.find((x) => x.leagueId === id);
  if (!e) {
    e = clean({ leagueId: id, addedAt: Date.now() });
    state.leagues.push(e);
  }
  const infoBefore = `${e.name}|${e.teamCount}`;
  if (typeof name === 'string' && name) e.name = name;
  if (Number.isFinite(teamCount)) e.teamCount = teamCount;
  if (`${e.name}|${e.teamCount}` !== infoBefore) e.infoAt = Date.now();
  const forSeason = Number(season);
  e.seasons = seasonList([...e.seasons, ...(Array.isArray(seasons) ? seasons : []), forSeason]);
  const mine = teamOf(team);
  if (mine && Number.isInteger(forSeason)) {
    const was = e.teams[String(forSeason)];
    e.teams[String(forSeason)] = mine;
    // A different team (or a new name for it) is a newer choice than any the
    // account holds; the same one said again is not.
    if (!was || String(was.id) !== String(mine.id) || was.name !== mine.name) {
      e.teamAt = { ...(e.teamAt || {}), [String(forSeason)]: Date.now() };
    }
  }

  // A league the bar has just connected to IS the open one.
  const cur = current();
  if (cur && cur.leagueId === id && Number.isInteger(forSeason) && cur.season === forSeason &&
      (!e.lastOpened || e.lastOpened.season !== forSeason)) {
    e.lastOpened = { season: forSeason, at: Date.now() };
  }

  state.removed = state.removed.filter((x) => x !== id);
  forgetRemoval(state, id);
  if (Number.isInteger(forSeason) && state.probe === keyOf(id, forSeason)) state.probe = null;
  if (source === 'cloud' || source === 'espn') state.source = source;

  try { save(state); } catch { /* storage refused; the entry still stands for this call */ }
  return publicOf(e);
}

/**
 * Take a league off the list. NOTHING IT STORED IS DELETED — its weeks,
 * readings, saved projections and parked preferences all stay.
 *
 * Removing the league that is open also empties the connection slot, so the
 * site does not walk straight back into it. Its preferences are parked first
 * and the slot is left with the neutral ones a new league would start from.
 *
 * @param {string|number} leagueId
 * @param {number} [at] when it was removed; now, unless the account's list
 *   says another device removed it earlier (`mergeAccount`)
 * @returns {boolean} was it on the list
 */
export function remove(leagueId, at = Date.now()) {
  const id = String(leagueId ?? '');
  let state;
  try { state = load(); } catch { return false; }
  const had = state.leagues.some((e) => e.leagueId === id);
  state.leagues = state.leagues.filter((e) => e.leagueId !== id);
  if (realId(id)) {
    if (!state.removed.includes(id)) state.removed.push(id);
    state.removedAt = { ...(state.removedAt || {}), [id]: stampOf(at) || Date.now() };
  }

  const cur = current();
  const open = Boolean(cur && cur.leagueId === id);
  if (open && state.probe === keyOf(cur.leagueId, cur.season)) state.probe = null;

  try {
    const s = storage();
    if (open) {
      // The preferences: a copy is kept under the league's own name before
      // the slot is made neutral. If the copy cannot be written, the slot's
      // are left exactly as they are.
      try {
        const curKey = keyOf(cur.leagueId, cur.season);
        const prefsRaw = s.getItem(PREFS_KEY);
        if (prefsRaw != null) {
          s.setItem(`${PREFS_KEY}@${ownerOfPrefs(prefsRaw, curKey)}`, prefsRaw);
          s.setItem(PREFS_KEY, JSON.stringify(freshPrefs(prefsRaw, null, { live: false })));
        }
        const reviewRaw = s.getItem(REVIEW_KEY);
        if (reviewRaw != null) s.setItem(`${REVIEW_KEY}@${ownerOfReview(reviewRaw, curKey)}`, reviewRaw);
      } catch { /* full browser: nothing parked, nothing changed */ }
      s.removeItem(CONN_KEY);
      s.removeItem(LEGACY_KEY);
    }
    save(state);
  } catch { /* storage refused */ }
  return had;
}

function forgetRemoval(state, id) {
  if (!state.removedAt) return;
  delete state.removedAt[id];
  if (!Object.keys(state.removedAt).length) delete state.removedAt;
}

/** Was this league taken off the list (and not added back since)? */
export function isRemoved(leagueId) {
  try {
    return load().removed.includes(String(leagueId ?? ''));
  } catch {
    return false;
  }
}

/**
 * Did the menu just point the connection slot at this league-season?
 *
 * `open()` writes the slot without the league's name or teams, so the bar has
 * to ask again before it says "Connected". The bar reads this on load to know
 * it should; `add()` (a successful connect) clears it.
 */
export function awaitingProbe(leagueId, season) {
  try {
    return realId(leagueId) && load().probe === keyOf(String(leagueId), Number(season));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------- the account's list
//
// Tim, 2026-10-10: "add different leagues to their account". Signed in, the
// menu shows this device's leagues AND the account's (js/cloud.js keeps the
// account's at `users/{uid}/menu/leagues`; js/leagues-page.js does the one
// read and the one write). This is the merge, and it touches storage only.
//
//   IN OR OUT    a league is on the account's list while it was added later
//                than it was last removed. A league removed on any device goes
//                from the others when they next open the menu; adding it again
//                brings it back.
//   REMOVED HERE STAYS REMOVED HERE, whatever the account says, until it is
//                added again on this device.
//   SEASONS      every season either side knows. None is ever dropped.
//   "YOU ARE"    per season, whichever was chosen later. A team with no time
//                (chosen before times were kept) loses to one that has one.
//   NAME, SIZE   whichever was read later.
//
// The account's copy is { v, leagues: [{ leagueId, name, teamCount, seasons,
// teams, teamAt, infoAt, addedAt }], removed: { id: when } } — no "last
// opened", which is this device's own business and would cost a write on
// every switch. Whatever comes down is cleaned like anything read from
// storage. NOTHING STORED FOR A LEAGUE IS DELETED by any of it.

/** One league as the account keeps it, keys in a fixed order (it is compared as text). */
function accountEntry(e) {
  const seasons = Object.keys(e.teams).sort();
  return {
    leagueId: e.leagueId,
    name: e.name,
    teamCount: e.teamCount,
    seasons: e.seasons.slice(),
    teams: Object.fromEntries(seasons.map((s) => [s, { id: e.teams[s].id, name: e.teams[s].name }])),
    teamAt: Object.fromEntries(seasons.filter((s) => e.teamAt && e.teamAt[s]).map((s) => [s, e.teamAt[s]])),
    infoAt: e.infoAt || 0,
    addedAt: e.addedAt || 0,
  };
}

/** The account's copy, made safe: `{ leagues: Map<id, entry>, removed: { id: when } }`. */
function accountOf(remote) {
  const out = { leagues: new Map(), removed: {} };
  if (!remote || typeof remote !== 'object') return out;
  for (const raw of Array.isArray(remote.leagues) ? remote.leagues : []) {
    const e = clean(raw);
    if (e && !out.leagues.has(e.leagueId)) out.leagues.set(e.leagueId, e);
  }
  if (remote.removed && typeof remote.removed === 'object' && !Array.isArray(remote.removed)) {
    for (const [id, at] of Object.entries(remote.removed)) {
      if (realId(id) && stampOf(at)) out.removed[id] = stampOf(at);
    }
  }
  return out;
}

/** The account's copy as it is written, in one fixed order. */
function accountDoc(leagueList, removed) {
  return {
    v: 1,
    leagues: leagueList.slice().sort((a, b) => a.leagueId.localeCompare(b.leagueId)).map(accountEntry),
    removed: Object.fromEntries(Object.keys(removed).sort().map((id) => [id, removed[id]])),
  };
}

/** Two copies of one league as one. `mine` is this device's, `theirs` the account's; either may be null. */
function mergedEntry(mine, theirs) {
  if (!mine || !theirs) {
    const one = mine || theirs;
    return { ...one, seasons: one.seasons.slice(), teams: { ...one.teams }, teamAt: { ...(one.teamAt || {}) } };
  }
  const placeholder = `League ${mine.leagueId}`;
  let info = (mine.infoAt || 0) > (theirs.infoAt || 0) ? mine : theirs;
  if (info.name === placeholder && (info === mine ? theirs : mine).name !== placeholder) info = info === mine ? theirs : mine;
  const teams = {};
  const teamAt = {};
  for (const season of new Set([...Object.keys(mine.teams), ...Object.keys(theirs.teams)])) {
    const a = mine.teams[season];
    const b = theirs.teams[season];
    const aAt = (mine.teamAt && mine.teamAt[season]) || 0;
    const bAt = (theirs.teamAt && theirs.teamAt[season]) || 0;
    const mineWins = Boolean(a) && (!b || aAt > bAt);
    teams[season] = mineWins ? a : b;
    if (mineWins ? aAt : bAt) teamAt[season] = mineWins ? aAt : bAt;
  }
  return {
    leagueId: mine.leagueId,
    name: info.name,
    teamCount: info.teamCount ?? mine.teamCount ?? theirs.teamCount,
    seasons: seasonList([...mine.seasons, ...theirs.seasons]),
    teams,
    teamAt,
    infoAt: Math.max(mine.infoAt || 0, theirs.infoAt || 0),
    addedAt: Math.max(mine.addedAt || 0, theirs.addedAt || 0),
  };
}

/**
 * Bring this device's list and the account's together.
 *
 * Writes this device's list when it gained or lost anything, and hands back
 * the account's copy as it should now be. Asks the network nothing.
 *
 * @param {Object|null} remote the account's copy as it was read; null for none
 * @param {Object} [opts]
 * @param {number} [opts.now]
 * @returns {{ok:boolean, list:Object, changed:boolean, local:boolean}} `changed`:
 *   the account's copy is not `list` yet, so it wants writing. `local`: this
 *   device's list was changed by the merge.
 */
export function mergeAccount(remote, { now = Date.now() } = {}) {
  const theirs = accountOf(remote);
  const asRead = JSON.stringify(accountDoc([...theirs.leagues.values()], theirs.removed));
  let state;
  try { state = load(); } catch { return { ok: false, list: JSON.parse(asRead), changed: false, local: false }; }

  const before = JSON.stringify(state);
  const mineById = new Map(state.leagues.map((e) => [e.leagueId, e]));
  const cur = current();
  const outLeagues = [];
  const outRemoved = {};
  const goes = [];          // [id, when]: on this device's list, removed on another
  let slotTeam;             // the open league-season's team, if the account's is newer

  const ids = new Set([...mineById.keys(), ...theirs.leagues.keys(), ...state.removed, ...Object.keys(theirs.removed)]);
  for (const id of ids) {
    const mine = mineById.get(id) || null;
    const acct = theirs.leagues.get(id) || null;
    // Removed here, and when. A league that is on this device's list is not
    // removed here, whatever an older note says.
    let removedHere = 0;
    if (!mine && state.removed.includes(id)) {
      removedHere = (state.removedAt && state.removedAt[id]) || now;
      state.removedAt = { ...(state.removedAt || {}), [id]: removedHere };
    }
    const removedAt = Math.max(removedHere, theirs.removed[id] || 0);
    if (!mine && !acct) {
      if (removedAt) outRemoved[id] = removedAt;
      continue;
    }
    const addedAt = Math.max(mine ? mine.addedAt : 0, acct ? acct.addedAt : 0);
    if (removedAt && removedAt >= addedAt) {
      outRemoved[id] = removedAt;
      if (mine) goes.push([id, removedAt]);
      continue;
    }

    const both = mergedEntry(mine, acct);
    outLeagues.push(both);
    if (removedHere) continue;      // on the account, and still off this device's list

    if (!mine) {
      state.leagues.push(clean({ ...both, lastOpened: null }));
      continue;
    }
    const open = cur && cur.leagueId === id ? String(cur.season) : null;
    const was = open ? mine.teams[open] : null;
    mine.name = both.name;
    mine.teamCount = both.teamCount;
    mine.seasons = both.seasons;
    mine.teams = both.teams;
    if (Object.keys(both.teamAt).length) mine.teamAt = both.teamAt;
    if (both.infoAt) mine.infoAt = both.infoAt;
    mine.addedAt = both.addedAt;
    const is = open ? mine.teams[open] : null;
    if (is && (!was || String(was.id) !== String(is.id))) slotTeam = is.id;
  }

  const list = accountDoc(outLeagues, outRemoved);
  let local = JSON.stringify(state) !== before;
  try {
    if (local) save(state);
    // The open league-season follows a newer "You are" from the account, as
    // `open()` would have written it.
    if (slotTeam !== undefined) {
      const slot = readJson(CONN_KEY);
      if (slot && String(slot.leagueId) === cur.leagueId) {
        storage().setItem(CONN_KEY, JSON.stringify({ ...slot, teamId: slotTeam }));
      }
    }
  } catch { /* storage refused: the account's copy is still right */ }
  for (const [id, when] of goes) {
    try { if (remove(id, when)) local = true; } catch { /* stays listed here */ }
  }
  return { ok: true, list, changed: JSON.stringify(list) !== asRead, local };
}

// ------------------------------------------------------------------ switching

/** Whose preferences are these? Their own mark, else the league that is open. */
function ownerOfPrefs(raw, fallback) {
  try {
    const p = JSON.parse(raw);
    if (p && typeof p[STAMP] === 'string' && p[STAMP]) return p[STAMP];
  } catch { /* unreadable: filed under the open league */ }
  return fallback || 'none';
}

/** js/draft-page.js writes `{league: '<L>-<S>', kept}`. */
function ownerOfReview(raw, fallback) {
  try {
    const p = JSON.parse(raw);
    if (p && typeof p.league === 'string' && /^\d+-\d+$/.test(p.league)) return p.league;
  } catch { /* unreadable */ }
  return fallback || 'none';
}

/**
 * The preferences a league-season starts from: the ones in use now, minus
 * everything about one league, showing live data on every page.
 */
function freshPrefs(raw, stamp, { live = true } = {}) {
  let from = {};
  try {
    const p = JSON.parse(raw || '{}');
    if (p && typeof p === 'object' && !Array.isArray(p)) from = p;
  } catch { /* start empty */ }
  const out = {};
  for (const [name, value] of Object.entries(from)) {
    if (!leagueSpecific(name)) out[name] = value;
  }
  if (live) for (const page of PAGES) out[`${page}.source`] = 'live';
  if (stamp) out[STAMP] = stamp;
  return out;
}

/** A parked copy, marked as the league-season it is being put back for. */
function stamped(raw, stamp) {
  try {
    const p = JSON.parse(raw);
    if (p && typeof p === 'object' && !Array.isArray(p)) return JSON.stringify({ ...p, [STAMP]: stamp });
  } catch { /* put back as it was parked */ }
  return raw;
}

/**
 * Point the site at one league-season.
 *
 * Parks the single-slot keys of the league being left, restores the target's,
 * writes ONLY `{leagueId, season, teamId}` to the connection slot (so the bar
 * probes again and never says "Connected" unprobed) and notes the time. If any
 * write is refused — a full browser — everything is put back and nothing has
 * changed.
 *
 * @returns {{ok:true, href:string}|{ok:false, reason:string}}
 */
export function open(leagueId, season) {
  const id = String(leagueId ?? '');
  const yr = Number(season);
  const s = storage();
  if (!s) return { ok: false, reason: 'This browser is not letting the site save anything, so it cannot switch leagues.' };

  let state;
  try { state = load(); } catch { return { ok: false, reason: 'The list of leagues could not be read.' }; }
  const cur = current();
  if (cur && cur.leagueId === id && cur.season === yr) return { ok: true, href: 'index.html' };

  const entry = state.leagues.find((e) => e.leagueId === id);
  if (!entry) return { ok: false, reason: 'That league is not on your list.' };
  if (!entry.seasons.includes(yr)) return { ok: false, reason: `Season ${season} is not listed for that league.` };

  const target = keyOf(id, yr);
  const curKey = cur ? keyOf(cur.leagueId, cur.season) : null;

  // Every write goes through `put`, which remembers what was there.
  const undo = [];
  const put = (key, value) => {
    const before = s.getItem(key);
    s.setItem(key, value);
    undo.push([key, before]);
  };

  try {
    // 1. Park what is in the slots, under the league-season it belongs to.
    const prefsRaw = s.getItem(PREFS_KEY);
    if (prefsRaw != null) put(`${PREFS_KEY}@${ownerOfPrefs(prefsRaw, curKey)}`, prefsRaw);
    const reviewRaw = s.getItem(REVIEW_KEY);
    if (reviewRaw != null) put(`${REVIEW_KEY}@${ownerOfReview(reviewRaw, curKey)}`, reviewRaw);

    // 2. Put the target's back. One never opened starts from today's display
    //    choices; its draft copy is simply read again by the Draft page.
    const parkedPrefs = s.getItem(`${PREFS_KEY}@${target}`);
    put(PREFS_KEY, parkedPrefs != null ? stamped(parkedPrefs, target) : JSON.stringify(freshPrefs(prefsRaw, target)));
    const parkedReview = s.getItem(`${REVIEW_KEY}@${target}`);
    if (parkedReview != null) put(REVIEW_KEY, parkedReview);

    // 3. The connection slot: the league, the season, the team — nothing else.
    const mine = entry.teams[String(yr)];
    const slot = JSON.stringify({ leagueId: id, season: yr, teamId: mine ? mine.id : null });
    put(CONN_KEY, slot);
    put(LEGACY_KEY, slot);

    // 4. The list: when it was opened, and that the bar has yet to ask ESPN.
    entry.lastOpened = { season: yr, at: Date.now() };
    state.probe = target;
    save(state, put);
  } catch {
    for (const [key, before] of undo.reverse()) {
      try {
        if (before == null) s.removeItem(key);
        else s.setItem(key, before);
      } catch { /* the smaller, older value was refused too; nothing more to try */ }
    }
    return { ok: false, reason: 'This browser’s storage is full, so the league was not switched.' };
  }
  return { ok: true, href: 'index.html' };
}

// ------------------------------------------------------------------ looking up

/**
 * Is this browser showing the copy the computer sent (the phone)?
 *
 * Rule 20: a page on the synced copy makes zero ESPN requests. Three signs, the
 * cheapest first: the connection slot says so; the bar's last connect said so
 * (`add({source})`); js/season.js says so for the open league.
 */
async function onSyncedCopy() {
  const saved = savedConnection();
  if (saved && saved.source === 'cloud') return true;
  try { if (load().source === 'cloud') return true; } catch { /* next sign */ }
  const cur = current();
  if (!cur || !realId(cur.leagueId)) return false;
  try {
    const [espn, season] = await Promise.all([import('./espn.js'), import('./season.js')]);
    if (typeof season.cloudSource !== 'function') return false;
    // The menu has no page above it that has told js/espn.js the league yet.
    if (typeof espn.getConfig === 'function' && !espn.getConfig().leagueId) {
      espn.configure({ leagueId: cur.leagueId, season: cur.season });
    }
    return Boolean(await season.cloudSource());
  } catch {
    return false;
  }
}

/**
 * Find a league by its ESPN id, for the "Add a league" field.
 *
 * The connection bar's own route — the bridge extension when it is there (the
 * only reader of a private league), otherwise ESPN directly — asking for the
 * current season and, with it, the earlier seasons ESPN lists
 * (`status.previousSeasons`). On the phone's synced copy ESPN is NOT asked.
 *
 * @param {string|number} leagueId
 * @param {Object} [opts]  test seams: `bridge` (js/bridge.js's shape), `fetch`,
 *   `synced` (async () => boolean)
 * @returns {Promise<{ok:true, leagueId:string, name:string, teamCount:number,
 *   seasons:number[], teams:{id:number,name:string}[]}|{ok:false, reason:string}>}
 */
export async function lookup(leagueId, opts = {}) {
  const id = String(leagueId ?? '').trim();
  if (!realId(id)) return { ok: false, reason: 'Enter your league ID.' };
  const br = opts.bridge || bridge;
  const season = thisSeason();
  const views = ['mTeam', 'mSettings', 'mStatus'];

  try {
    if (typeof br.settled === 'function') await br.settled();
    let raw;
    if (typeof br.isAvailable === 'function' && br.isAvailable()) {
      const res = await br.league({ leagueId: id, season, views });
      if (!res || !res.ok) return { ok: false, reason: (res && res.error) || 'Could not read the league.' };
      raw = res.data;
    } else {
      const synced = typeof opts.synced === 'function' ? await opts.synced() : await onSyncedCopy();
      if (synced) {
        return {
          ok: false,
          reason: 'This is the synced copy from your computer, so ESPN is not asked here. Add the league on your computer.',
        };
      }
      const doFetch = opts.fetch || globalThis.fetch;
      const url = `${HOST}/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${id}?` +
        views.map((v) => `view=${v}`).join('&');
      let res;
      try {
        res = await doFetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
      } catch {
        return { ok: false, reason: 'Could not reach ESPN.' };
      }
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          reason: `ESPN will not show league ${id} to this site. A private league has to be added on your computer, with the bridge extension.`,
        };
      }
      if (res.status === 404) return { ok: false, reason: `League ${id} not found for season ${season}.` };
      if (!res.ok) return { ok: false, reason: `ESPN returned HTTP ${res.status}.` };
      raw = await res.json();
    }

    raw = raw && typeof raw === 'object' ? raw : {};
    const teams = (raw.teams || []).map((t) => ({
      id: t.id,
      name: [t.location, t.nickname].filter(Boolean).join(' ').trim() || t.name || `Team ${t.id}`,
    }));
    return {
      ok: true,
      leagueId: id,
      name: raw.settings?.name || `League ${id}`,
      teamCount: raw.settings?.size ?? teams.length,
      seasons: seasonList([season, ...(raw.status?.previousSeasons || [])]),
      teams,
    };
  } catch (err) {
    return { ok: false, reason: (err && err.message) || 'Could not read the league.' };
  }
}
