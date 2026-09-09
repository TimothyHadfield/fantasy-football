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

const KEY = 'ff.prefs';

let cache = null;

function all() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    cache = {};
  }
  return cache;
}

/** Read one preference, or `fallback` when it has never been set. */
export function get(name, fallback = null) {
  const v = all()[name];
  return v === undefined ? fallback : v;
}

/** Write one preference. Writing `null` or `undefined` clears it. */
export function set(name, value) {
  const data = all();
  if (value === null || value === undefined) delete data[name];
  else data[name] = value;
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
