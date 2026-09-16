// The connection strip that appears on every page.
//
// Its whole job is to answer, at a glance, "is this showing my real league?" —
// because the failure mode that wasted the most time on this project was not
// knowing whether something was live data, demo data, or quietly broken.
//
// It mounts itself into <div id="connBar"></div> if the page has one, so a
// page opts in simply by including that div and this script.

import * as bridge from './bridge.js';
import { configure, fetchLeague, AuthError } from './espn.js';

const KEY = 'ff.connection';
// index.html and the data pages predate this bar and speak this key.
const LEGACY_KEY = 'ff.config';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * Is the thing pointing at this page a finger?
 *
 * Exported because two very different things need it and neither may grow its
 * own copy: the analysis grids decide whether their hover card opens as a
 * tap-opened sheet, and this bar decides whether "install the extension" is
 * advice a reader can actually act on.
 *
 * `hover: none` is deliberately not a width test. A narrow desktop window has a
 * mouse and can install an extension; an iPad in landscape is wide and can do
 * neither. It is also the closest honest signal available — there is no feature
 * query for "this browser can run extensions", and neither iOS Safari nor
 * Chrome on Android can load an unpacked one — so every sentence built on it is
 * worded as the likelihood it is rather than as a certainty.
 *
 * Guarded because the test harness has no `matchMedia`, and the honest answer
 * without one is "assume a pointer".
 */
export function coarsePointer() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(hover: none)').matches;
  } catch {
    return false;
  }
}

const state = {
  extension: false,
  leagueId: '',
  season: bridge.currentSeason(),
  league: null,      // { name, teams, ... } once probed
  teamId: null,
  checkedAt: null,
  error: '',
  busy: false,
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (saved.leagueId) state.leagueId = String(saved.leagueId);
    if (saved.season) state.season = Number(saved.season);
    if (saved.teamId != null) state.teamId = saved.teamId;
    if (saved.league) state.league = saved.league;
    if (saved.checkedAt) state.checkedAt = saved.checkedAt;
  } catch { /* storage unavailable; defaults are fine */ }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      leagueId: state.leagueId, season: state.season,
      teamId: state.teamId, league: state.league, checkedAt: state.checkedAt,
    }));
    // The pages read this second, older key, and index.html writes it. Keeping
    // both in step is what makes "Connected" in this bar actually mean the
    // Stats/Analysis/Schedule pages can go live — they silently could not
    // before, because the bar wrote one key and every page read the other.
    localStorage.setItem(LEGACY_KEY, JSON.stringify({
      leagueId: state.leagueId, season: state.season,
    }));
  } catch { /* nothing to do */ }
}

/** What other modules need: the connected league, or null. */
export function currentConnection() {
  if (!state.league) return null;
  return {
    leagueId: state.leagueId,
    season: state.season,
    teamId: state.teamId,
    name: state.league.name,
    teams: state.league.teams || [],
  };
}

/**
 * The saved league, whether or not it has been probed yet this page load.
 *
 * A page asking "can I go live?" wants this rather than `currentConnection()`,
 * which only answers once the bar has finished its own round trip.
 */
export function savedConfig() {
  for (const key of [KEY, LEGACY_KEY]) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || '{}');
      if (saved.leagueId) {
        return {
          leagueId: String(saved.leagueId),
          season: Number(saved.season) || bridge.currentSeason(),
          teamId: saved.teamId ?? null,
        };
      }
    } catch { /* try the next key */ }
  }
  return null;
}

/**
 * Run `cb` with the live connection now (if there already is one) and again
 * whenever it changes, so a page can switch itself to real data without the
 * user clicking a second toggle.
 */
export function onConnection(cb) {
  document.addEventListener('ff:connection', (e) => cb(e.detail));
  const now = currentConnection();
  if (now) cb(now);
}

function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/**
 * Identify the league WITHOUT the extension, by asking ESPN directly.
 *
 * This is the whole of what a public league needs, and until now nothing called
 * it: `connect()` went through `bridge.probe()` and only that, so with no
 * extension there was no way to connect at all — while `js/espn.js` has always
 * fallen back to a direct fetch for every actual data read. The transport layer
 * was ready and the bar in front of it was not, which meant a public league was
 * unreachable from any browser without the extension, phone or desktop.
 *
 * Returns the same `{ ok, data }` shape `bridge.probe()` does, deliberately, so
 * `connect()` below has one answer to handle rather than two.
 */
async function directProbe() {
  try {
    const raw = await fetchLeague(['mTeam', 'mSettings']);
    const teams = (raw.teams || []).map((t) => ({
      id: t.id,
      name: [t.location, t.nickname].filter(Boolean).join(' ').trim() || t.name || `Team ${t.id}`,
      abbrev: t.abbrev,
    }));
    return {
      ok: true,
      data: {
        leagueId: String(state.leagueId),
        season: Number(state.season),
        name: raw.settings?.name || `League ${state.leagueId}`,
        teamCount: raw.settings?.size ?? teams.length,
        currentWeek: raw.status?.currentMatchupPeriod ?? null,
        teams,
      },
    };
  } catch (err) {
    // espn.js's AuthError already carries the one useful sentence — the ESPN
    // setting that makes a league readable without any login — so it is passed
    // through rather than replaced with something shorter and less actionable.
    return { ok: false, error: err instanceof AuthError ? err.message : String(err.message || err) };
  }
}

async function connect() {
  if (!state.leagueId) {
    state.error = 'Enter your league ID.';
    render();
    return;
  }
  state.busy = true;
  state.error = '';
  render();

  configure({ leagueId: state.leagueId, season: state.season });
  // The extension when it is there, ESPN directly when it is not. The bridge is
  // preferred because it is the only one of the two that can read a PRIVATE
  // league; the direct path is what makes a public one work with no extension
  // at all, which is the only way a phone can ever show live numbers.
  const res = bridge.isAvailable()
    ? await bridge.probe({ leagueId: state.leagueId, season: state.season })
    : await directProbe();

  state.busy = false;
  if (res.ok) {
    state.league = res.data;
    state.checkedAt = Date.now();
    // If we only have one plausible team, do not make the user choose.
    if (state.teamId == null && res.data.teams?.length === 1) {
      state.teamId = res.data.teams[0].id;
    }
    save();
  } else {
    state.league = null;
    state.error = res.error || 'Could not read the league.';
  }
  render();
  document.dispatchEvent(new CustomEvent('ff:connection', { detail: currentConnection() }));
}

function render() {
  const el = $('connBar');
  if (!el) return;

  const connected = Boolean(state.league);
  const cls = connected ? 'conn ok' : state.extension ? 'conn warn' : 'conn off';

  let body;
  if (connected) {
    const options = (state.league.teams || [])
      .map((t) => `<option value="${t.id}"${t.id === state.teamId ? ' selected' : ''}>${esc(t.name)}</option>`)
      .join('');
    body = `
      <span class="conn-dot"></span>
      <span class="conn-main">
        Connected to <strong>${esc(state.league.name)}</strong>
        &middot; ${state.league.teams?.length || 0} teams
        &middot; checked ${ago(state.checkedAt)}
      </span>
      <label class="conn-team">You are
        <select id="connTeam">
          <option value="">choose your team…</option>
          ${options}
        </select>
      </label>
      <button type="button" id="connSync" class="conn-btn">${state.busy ? 'Syncing…' : 'Sync now'}</button>`;
  } else if (state.extension) {
    body = `
      <span class="conn-dot"></span>
      <span class="conn-main">
        Bridge extension detected. Enter your league ID to connect.
      </span>
      <input id="connLeague" class="conn-input" inputmode="numeric" placeholder="League ID"
             value="${esc(state.leagueId)}">
      <button type="button" id="connSync" class="conn-btn">${state.busy ? 'Connecting…' : 'Connect'}</button>`;
  } else {
    // NO EXTENSION. This used to be a dead end: a sentence and no input, so
    // there was no way to connect at all — which quietly meant a PUBLIC league
    // was unreachable from any browser without the extension, even though
    // js/espn.js has always read one over a plain fetch. The field is here now,
    // and `connect()` probes ESPN directly when the bridge is absent.
    //
    // Two different sentences, because the advice really is different. On a
    // phone, "install the extension" is advice nobody can take: the bridge is
    // an unpacked Manifest V3 extension and neither iOS Safari nor Chrome on
    // Android can load one. Sending a reader to look for a button that does not
    // exist is how they conclude the site is broken, when in fact every page
    // works there — it is only a PRIVATE league that cannot be read, because
    // ESPN's cookies are third-party from github.io and a page cannot set the
    // Cookie header. That is a browser wall, not a layout problem.
    const phone = coarsePointer();
    const advice = phone
      ? 'A phone cannot install the bridge extension, so a <strong>private</strong> league ' +
        'has to be read on your computer. A public league works here &mdash; try your ID:'
      : 'Showing demo data. Install the Fantasy Football Bridge extension to read a ' +
        'private league, or enter the ID of a public one:';
    body = `
      <span class="conn-dot"></span>
      <span class="conn-main"><strong>Not connected.</strong> ${advice}</span>
      <input id="connLeague" class="conn-input" inputmode="numeric" placeholder="League ID"
             value="${esc(state.leagueId)}">
      <button type="button" id="connSync" class="conn-btn">${state.busy ? 'Connecting…' : 'Connect'}</button>`;
  }

  el.className = cls;
  el.innerHTML = body + (state.error ? `<span class="conn-err">${esc(state.error)}</span>` : '');

  const sync = $('connSync');
  if (sync) sync.addEventListener('click', connect);

  const input = $('connLeague');
  if (input) {
    input.addEventListener('input', (e) => { state.leagueId = e.target.value.trim(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
  }

  const team = $('connTeam');
  if (team) {
    team.addEventListener('change', (e) => {
      state.teamId = e.target.value ? Number(e.target.value) : null;
      save();
      document.dispatchEvent(new CustomEvent('ff:connection', { detail: currentConnection() }));
    });
  }
}

async function init() {
  if (!$('connBar')) return;
  load();
  render();

  bridge.onAvailability(({ available }) => {
    state.extension = available;
    render();
  });

  const { available } = await bridge.ping();
  state.extension = available;

  // Pick up a league ID entered in the extension's popup, so it only has to be
  // typed once.
  if (available && !state.leagueId) {
    const cfg = await bridge.getConfig();
    if (cfg.ok && cfg.data?.leagueId) state.leagueId = String(cfg.data.leagueId);
  }
  render();

  // Reconnect automatically when we already know which league to ask for.
  if (available && state.leagueId) connect();
}

// The bar is decoration around the page's own data, so a failure probing the
// bridge must never escape as an unhandled rejection and take the page with
// it. Show the disconnected state and let the page carry on with demo data.
init().catch((err) => {
  state.extension = false;
  state.error = err && err.message ? err.message : 'Could not reach the bridge.';
  render();
});
