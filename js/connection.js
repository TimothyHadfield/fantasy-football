// The connection strip that appears on every page.
//
// Its whole job is to answer, at a glance, "is this showing my real league?" —
// because the failure mode that wasted the most time on this project was not
// knowing whether something was live data, demo data, or quietly broken.
//
// It mounts itself into <div id="connBar"></div> if the page has one, so a
// page opts in simply by including that div and this script.

import * as bridge from './bridge.js';
import { configure, AuthError } from './espn.js';

const KEY = 'ff.connection';
// index.html and the data pages predate this bar and speak this key.
const LEGACY_KEY = 'ff.config';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

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
  const res = await bridge.probe({ leagueId: state.leagueId, season: state.season });

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
    body = `
      <span class="conn-dot"></span>
      <span class="conn-main">
        <strong>Not connected.</strong> Showing demo data. Install the Fantasy Football
        Bridge extension to read your real league.
      </span>`;
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

init();
