// The website's half of the extension bridge.
//
// The site cannot read a private ESPN league by itself — its requests to
// espn.com carry third-party cookies, which browsers block, and a page cannot
// set the Cookie header. The Fantasy Football Bridge extension can, so when it
// is installed this module routes ESPN reads through it.
//
// Everything degrades: with no extension the site still runs on demo data, and
// a public league still works over a direct fetch. Nothing here is required for
// the site to load.

const SITE = 'ff-site';
const EXT = 'ff-ext';
const TIMEOUT_MS = 15000;
// "Is the extension there?" must fail fast — when it is absent nothing will
// ever answer, and the page should say so immediately rather than sit on a
// spinner for the full request timeout.
const PING_TIMEOUT_MS = 1200;

let detected = false;
let version = null;
const listeners = new Set();
const pending = new Map();

// The extension announces itself at document_start, which may be before this
// module runs, so listen immediately and also treat any reply as proof of life.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== EXT) return;

  if (msg.type === 'HELLO') {
    const first = !detected;
    detected = true;
    version = msg.version || null;
    if (first) emit();
    return;
  }

  const waiting = pending.get(msg.id);
  if (!waiting) return;
  pending.delete(msg.id);
  clearTimeout(waiting.timer);
  detected = true;
  waiting.resolve(msg);
});

function emit() {
  for (const fn of listeners) {
    try { fn({ available: detected, version }); } catch { /* a bad listener must not break the bridge */ }
  }
}

/** Fires whenever the extension appears. Call immediately for current state. */
export function onAvailability(fn) {
  listeners.add(fn);
  fn({ available: detected, version });
  return () => listeners.delete(fn);
}

export function isAvailable() {
  return detected;
}

/**
 * Ask the extension for something. Resolves to { ok, data } or { ok:false, error }.
 * Never throws — callers get a result object either way.
 */
function ask(request, { timeoutMs } = {}) {
  const limit = timeoutMs ?? TIMEOUT_MS;
  return new Promise((resolve) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({
        ok: false,
        error: detected
          ? 'The extension did not answer in time.'
          : 'The Fantasy Football Bridge extension is not installed, or is not enabled for this page.',
      });
    }, limit);

    pending.set(id, { resolve, timer });
    window.postMessage({ source: SITE, id, request }, window.location.origin);
  });
}

/**
 * Is the extension there? Cheap, and safe to call before anything else.
 * Waits briefly, because at first paint the extension may not have said hello.
 */
export async function ping({ waitMs = 400 } = {}) {
  if (!detected) await new Promise((r) => setTimeout(r, waitMs));
  const res = await ask({ type: 'PING' }, { timeoutMs: PING_TIMEOUT_MS });
  return res.ok ? { available: true, version: res.data?.version ?? null } : { available: false };
}

/**
 * The league ID entered in the extension's popup, if any.
 * Lets the site pick up where the popup left off instead of asking twice.
 */
export function getConfig({ timeoutMs } = {}) {
  return ask({ type: 'GET_CONFIG' }, { timeoutMs });
}

/**
 * The fantasy season is named for the year it starts, so from January until
 * the summer the current season is still last calendar year. Using
 * getFullYear() outright asks for a season that does not exist yet.
 */
export function currentSeason(now = new Date()) {
  return now.getMonth() < 6 ? now.getFullYear() - 1 : now.getFullYear();
}

/** League identity and team list — the "are we connected" check. */
export function probe({ leagueId, season, timeoutMs }) {
  return ask({ type: 'PROBE', leagueId: String(leagueId), season: Number(season) }, { timeoutMs });
}

/** A league read, e.g. views: ['mTeam','mRoster'] */
export function league({ leagueId, season, views = [], scoringPeriodId, filter, timeoutMs }) {
  return ask({
    type: 'LEAGUE',
    leagueId: String(leagueId),
    season: Number(season),
    views,
    scoringPeriodId,
    filter,
  }, { timeoutMs });
}

/** A season-level read, e.g. view: 'proTeamSchedules_wl' */
export function seasonView({ season, view, timeoutMs }) {
  return ask({ type: 'SEASON', season: Number(season), view }, { timeoutMs });
}
