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
//
// ---------------------------------------------------------------------------
// THE CONTRACT FOR stageTrade() — this comment is the spec, read it before
// wiring a page into it.
// ---------------------------------------------------------------------------
//
//   const res = await stageTrade({
//     leagueId,        // digits, as a string or a number
//     season,          // four-digit year
//     myTeamId,        // YOUR team id in the league (digits)
//     theirTeamId,     // the counterparty's team id (digits)
//     myPlayers: [     // the men YOU give up — the side ESPN cannot pre-tick
//       { id: 4362628, name: 'Jahmyr Gibbs' },
//       ...
//     ],
//     theirPlayerIds: [3139477, ...],   // the men you RECEIVE, ids only
//   });
//
//   if (res.ok) window.open(res.data.url, '_blank', 'noopener');
//
// `res.data` is `{ url, expiresAt, count }`:
//   url        the ESPN deep link to open — BUILT BY THE EXTENSION, with their
//              side already in `players=`. Open this one; do not build your own,
//              or the two halves will drift.
//   expiresAt  epoch ms. The staged trade is thrown away a few minutes after
//              staging, so open the link now, not later.
//   count      how many of your players were staged.
//
// `res.ok === false` gives `res.error`, a sentence fit to show a person. The
// commonest one is simply that the extension is not installed, which is not an
// error worth shouting about — the deep link still works, it just opens with
// only their side ticked, which is what the Trade page does today.
//
// WHY THE SHAPE IS LIKE THIS, and why `myPlayers` carries names while
// `theirPlayerIds` does not:
//
//   Their side is ticked by ESPN, from the id, server-side. Ours is ticked by
//   a content script reading the rendered page — and a player's ESPN id is not
//   written into that page as an attribute anywhere. It is recoverable from the
//   headshot URL (.../players/full/<id>.png), which covers everybody EXCEPT a
//   D/ST, whose row carries a team logo instead. The name is the fallback that
//   makes a D/ST work, and it is also what the on-page badge says when a man
//   cannot be found at all. Pass ESPN's own `fullName` — anything else risks
//   not matching.
//
// NOTHING IS SENT TO ESPN BY THIS CALL. It stores a note in the extension for
// a few minutes. The single write is still the owner's own click on ESPN's own
// Propose Trade button, on a page he opened himself.

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

// There is no bridge outside a browser. Guarding here rather than at each use
// keeps this module importable from node, which is what lets the pure logic
// modules that transitively import it (via espn.js) be unit-tested at all.
const hasWindow = typeof window !== 'undefined';

// The extension announces itself at document_start, which may be before this
// module runs, so listen immediately and also treat any reply as proof of life.
if (hasWindow) window.addEventListener('message', (event) => {
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

/** The extension's manifest version, as it announced itself; null if unknown. */
export function extensionVersion() {
  return version;
}

/**
 * Ask the extension for something. Resolves to { ok, data } or { ok:false, error }.
 * Never throws — callers get a result object either way.
 */
function ask(request, { timeoutMs } = {}) {
  const limit = timeoutMs ?? TIMEOUT_MS;
  if (!hasWindow) {
    return Promise.resolve({ ok: false, error: 'No browser context, so no bridge.' });
  }
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

/**
 * Stage a trade so ESPN's own trade page opens with BOTH sides ticked.
 *
 * See the contract at the top of this file. In one line: this hands the deal to
 * the extension, which hands it to a content script on ESPN's trade page, which
 * ticks your own side's checkboxes — the one thing ESPN's `players=` parameter
 * cannot do. It ticks, and stops. The trade is still proposed by hand.
 *
 * Coercion here is deliberately shallow: ids are turned into numbers and names
 * into strings, and everything else is left for the worker to refuse. The
 * worker is the only side that can be trusted to validate, so it does — this is
 * a convenience layer, not a gate.
 */
export function stageTrade({
  leagueId, season, myTeamId, theirTeamId, myPlayers, theirPlayerIds, timeoutMs,
}) {
  const one = (p) => {
    const entry = (p && typeof p === 'object') ? p : { id: p };
    const out = { id: Number(entry.id) };
    if (entry.name != null) out.name = String(entry.name);
    return out;
  };

  return ask({
    type: 'STAGE_TRADE',
    leagueId: String(leagueId),
    season: Number(season),
    myTeamId: String(myTeamId),
    theirTeamId: String(theirTeamId),
    myPlayers: (myPlayers || []).map(one),
    theirPlayerIds: (theirPlayerIds || []).map(Number),
  }, { timeoutMs });
}
