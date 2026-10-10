// Small persistent preferences, shared by every page.
//
// Before this existed, nothing survived a reload or a page switch: the data
// source reset to demo, the week reset, "which team am I" reset, and every
// table snapped back to its default sort. On a site whose whole job is to be
// glanced at repeatedly during a season, re-making the same four choices on
// every visit was the most repetitive irritation on it.
//
// One key, one shallow object. Storage can be unavailable (private windows,
// blocked site data), so every access is guarded and falls back to defaults
// rather than throwing.

//
// ---------------------------------------------------------------------------
// WHOSE PREFERENCES THESE ARE
//
// The key is one slot, and since the main menu (js/leagues.js) it holds ONE
// league-season's choices at a time: the menu parks them and puts another
// league's in their place. So the object carries a mark, `@league`
// ("<leagueId>-<season>"), written with every save.
//
// A page keeps the whole object in memory and writes the whole object back. A
// page of the league that was left — another tab, or one come back to with the
// back button — would therefore write its old league's saved trades and team
// over the new league's. It cannot: before every write the mark in storage is
// compared with the one this page read, and when they differ the write is
// DROPPED and the page's picture is read again from storage.
//
// Preferences from before the mark existed have none. They belong to the
// league that is open and take its mark on their next save; with no league
// open nothing is marked and the key is written exactly as it always was.

const KEY = 'ff.prefs';

/** The mark's name. Not a preference: `set()` never writes it by hand. */
export const STAMP = '@league';

let cache = null;
/** The league-season this page's picture belongs to; '' for none. */
let stamp = '';

function stored() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}');
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  } catch {
    return {};
  }
}

/**
 * The league-season the connection slot holds, as js/leagues.js `keyOf` names
 * it; '' when nothing is connected. Read here, not through js/connection.js,
 * because that module is the bar itself and cannot be loaded by this one.
 */
function openLeague() {
  for (const key of ['ff.connection', 'ff.config']) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      if (saved && saved.leagueId) {
        const now = new Date();
        const season = Number(saved.season) || (now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear());
        return `${saved.leagueId}-${season}`;
      }
    } catch { /* try the next key */ }
  }
  return '';
}

function all() {
  if (cache) return cache;
  cache = stored();
  stamp = typeof cache[STAMP] === 'string' ? cache[STAMP] : openLeague();
  return cache;
}

/**
 * May this page write? False when storage now holds another league-season's
 * preferences; this page's picture is then replaced with what is there.
 */
function stillMine() {
  let there = null;
  try {
    // Nothing stored at all (never saved, or the browser was emptied): there
    // is nothing of another league's to protect, so this is written as it
    // always was, for the league that is open.
    if (localStorage.getItem(KEY) == null) {
      stamp = openLeague();
      return true;
    }
    const p = stored();
    if (typeof p[STAMP] === 'string') there = p[STAMP];
  } catch { /* unreadable counts as unmarked */ }

  if (there !== null) {
    if (there === stamp) return true;
    cache = stored();
    stamp = there;
    return false;
  }
  // Unmarked: preferences from before the mark, or a league just removed on
  // the menu. A page that belonged to a league which is no longer the open one
  // must not put that league's choices there.
  const open = openLeague();
  if (stamp && stamp !== open) {
    cache = stored();
    stamp = open;
    return false;
  }
  stamp = open;
  return true;
}

/** Read one preference, or `fallback` when it has never been set. */
export function get(name, fallback = null) {
  const v = all()[name];
  return v === undefined ? fallback : v;
}

/** Write one preference. Writing `null` or `undefined` clears it. */
export function set(name, value) {
  if (name === STAMP) return;
  all();
  if (!stillMine()) return;
  const data = cache;
  if (value === null || value === undefined) delete data[name];
  else data[name] = value;
  if (stamp) data[STAMP] = stamp;
  else delete data[STAMP];
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* nothing to do; the in-memory cache still serves this page load */
  }
}

/**
 * Namespaced accessors, so two pages can both remember "week" without
 * colliding: prefs.scope('schedule').get('week').
 */
export function scope(prefix) {
  return {
    get: (name, fallback = null) => get(`${prefix}.${name}`, fallback),
    set: (name, value) => set(`${prefix}.${name}`, value),
  };
}
