// The connection strip that appears on every page.
//
// Its whole job is to answer, at a glance, "is this showing my real league?" —
// because the failure mode that wasted the most time on this project was not
// knowing whether something was live data, demo data, or quietly broken.
//
// It mounts itself into <div id="connBar"></div> if the page has one, so a
// page opts in simply by including that div and this script.

import * as bridge from './bridge.js';
import * as cloud from './cloud.js';
import { configure, fetchLeague, AuthError } from './espn.js';

const KEY = 'ff.connection';
// index.html and the data pages predate this bar and speak this key.
const LEGACY_KEY = 'ff.config';

// What this browser knows about the cloud: when it last published, and whether
// that worked. One small blob, unlike the archive's key-per-reading — there is
// one record per league here, not one per week, and losing it costs a wasted
// sync rather than a season of history.
const CLOUD_KEY = 'ff.cloud';

/**
 * How often the desktop republishes, unasked.
 *
 * NOT on every page load. A sync is fourteen ESPN requests and twenty-eight
 * Firestore writes, and Tim opens five or six pages in a sitting — doing it
 * each time would spend two hundred requests to publish the same numbers.
 * NOT never, either: the whole feature is that he does not have to remember.
 *
 * Six hours is chosen against the thing that actually decays. `cloud.js` calls
 * the waiver wire stale after a DAY, because its question is "who can I add"
 * and a day-old answer lists men claimed on Tuesday. So the interval has to be
 * comfortably under that, or a synced wire would be at the edge of stale the
 * moment it arrived. Six hours means a morning sitting and an evening sitting
 * each publish once, and flicking between six pages in between publishes none.
 *
 * The button ignores it. A person pressing Sync has a reason, and the reason is
 * usually that he is about to pick up his phone.
 */
const SYNC_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Reading the cloud needs exactly one document: the league index.
 *
 * `readDown` fetches a shape only when it is named, so a list that names none
 * of the three data shapes reads the index and stops — one read, the same
 * price as `cloudStatus`, and this one also hands back the team list the
 * picker below needs. The pages get the rest through `js/season.js`.
 */
const INDEX_ONLY = ['index'];
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

  // --- the cloud ----------------------------------------------------------
  // Where `state.league` came from. 'espn' is live, through the bridge or a
  // direct fetch; 'cloud' is the copy the desktop published, which is what a
  // phone gets. The bar has to say which, every time, in words — a reader who
  // takes a week-old wire for today's has been actively misled, and that is
  // the same rule the time machine's banner exists for.
  source: 'espn',
  cloudUser: null,     // {uid, email, name} | null
  cloudKnown: false,   // has the auth listener answered at all yet?
  cloudAges: null,     // per-shape {syncedAt, ageMs, described, stale}
  syncing: false,
  syncLabel: '',
  lastSync: null,      // {at, ok, wrote, reason} for THIS league and season
};

/**
 * Has the extension been given its chance to answer yet?
 *
 * The bridge announces itself asynchronously and `bridge.ping()` allows it
 * 400ms, so "no extension" is not a fact until that has come back. Anything
 * that chooses a data source before then would be choosing on a coin toss.
 */
let bridgeChecked = false;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (saved.leagueId) state.leagueId = String(saved.leagueId);
    if (saved.season) state.season = Number(saved.season);
    if (saved.teamId != null) state.teamId = saved.teamId;
    if (saved.league) state.league = saved.league;
    if (saved.checkedAt) state.checkedAt = saved.checkedAt;
    // Remembered because the first paint happens before anything is probed,
    // and a phone whose last connection was the synced copy must not be shown
    // a green "Connected" for the second it takes to find that out again.
    if (saved.source === 'cloud' || saved.source === 'espn') state.source = saved.source;
  } catch { /* storage unavailable; defaults are fine */ }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      leagueId: state.leagueId, season: state.season,
      teamId: state.teamId, league: state.league, checkedAt: state.checkedAt,
      source: state.source,
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

// ------------------------------------------------------- the sync record
//
// Kept per league and season, in ONE small key. It is not the truth about what
// is in the cloud — the cloud is — it is this browser's note of what IT last
// published, which is the only thing the throttle below needs and the only
// thing a desktop can show without spending a read to find out.

function syncRecords() {
  try {
    const all = JSON.parse(localStorage.getItem(CLOUD_KEY) || '{}');
    return all && typeof all === 'object' ? all : {};
  } catch {
    return {};
  }
}

const syncKey = (leagueId, season) => `${leagueId}::${season}`;

function loadSyncRecord() {
  state.lastSync = syncRecords()[syncKey(state.leagueId, state.season)] || null;
}

function saveSyncRecord(rec) {
  state.lastSync = rec;
  try {
    const all = syncRecords();
    all[syncKey(state.leagueId, state.season)] = rec;
    localStorage.setItem(CLOUD_KEY, JSON.stringify(all));
  } catch { /* storage refused; the sync still happened */ }
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

/**
 * Identify the league from the copy the desktop published.
 *
 * This is what makes the phone work at all. It is not a fallback for a flaky
 * network: a private league CANNOT be read from a phone, ever — ESPN's cookies
 * are third-party from github.io and no extension can be installed there — so
 * on that device this is the only probe that can succeed.
 *
 * Returns the same `{ ok, data }` shape `bridge.probe()` and `directProbe()`
 * do, for the same reason they match each other: `connect()` has one answer to
 * handle rather than three.
 *
 * Every failure is quiet and returns `{ ok: false }` — not configured (the
 * normal case until `docs/firebase-setup.md` has been worked through), not
 * signed in, offline, nothing synced yet.
 */
async function cloudProbe() {
  if (!cloud.isConfigured()) return { ok: false, error: '' };
  try {
    const down = await cloud.readDown(state.leagueId, state.season, { shapes: INDEX_ONLY });
    if (!down || !down.ok || !down.found) {
      state.cloudAges = down ? down.ages : null;
      return { ok: false, error: '' };
    }
    state.cloudAges = down.ages;
    return {
      ok: true,
      data: {
        leagueId: String(state.leagueId),
        season: Number(state.season),
        name: down.leagueName || `League ${state.leagueId}`,
        teamCount: (down.teams || []).length,
        currentWeek: null,
        teams: (down.teams || []).map((t) => ({ id: t.id, name: t.name, abbrev: t.abbrev || '' })),
      },
    };
  } catch {
    // `readDown` is documented never to throw. Guarded anyway, because the one
    // thing this bar may never do is take the page down with it.
    return { ok: false, error: '' };
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
  loadSyncRecord();

  // THE ORDER HERE MUST MATCH `js/season.js`'s, and that is not a nicety: the
  // bar says where the numbers came from and the pages fetch them, so if the
  // two disagreed the bar would be labelling the wrong thing. Both prefer the
  // bridge whenever it is there, and both prefer the synced copy over a direct
  // ESPN read when it is not.
  //
  //   bridge  — live, and the only one of the three that reads a PRIVATE
  //             league. Always first when present.
  //   cloud   — the copy the desktop published. On a phone this is the only
  //             one that can work, so it is tried before ESPN is asked for
  //             something it will refuse.
  //   direct  — a public league over a plain fetch, exactly as before. What is
  //             left when there is no extension and nothing has been synced.
  let source = 'espn';
  let res;
  if (bridge.isAvailable()) {
    res = await bridge.probe({ leagueId: state.leagueId, season: state.season });
  } else {
    res = await cloudProbe();
    if (res.ok) source = 'cloud';
    else res = await directProbe();
  }

  state.busy = false;
  if (res.ok) {
    state.source = source;
    state.league = res.data;
    state.checkedAt = Date.now();
    // If we only have one plausible team, do not make the user choose.
    if (state.teamId == null && res.data.teams?.length === 1) {
      state.teamId = res.data.teams[0].id;
    }
    save();
  } else {
    state.source = 'espn';
    state.league = null;
    state.error = res.error || 'Could not read the league.';
  }
  render();
  document.dispatchEvent(new CustomEvent('ff:connection', { detail: currentConnection() }));

  // Publishing is the desktop's job and it happens after the connection is
  // known good, never before: there is nothing to publish until we know the
  // league reads.
  if (res.ok && source === 'espn') maybeAutoSync();
}

// =========================================================================
// PUBLISHING TO THE CLOUD
// =========================================================================
//
// Only ever from the machine with the bridge. That is not a policy, it is the
// only machine that can see a private league — so it is the only one with
// anything worth publishing.

/** Is this browser in a position to publish anything at all? */
function canSync() {
  return Boolean(
    cloud.isConfigured() &&
    state.cloudUser &&
    state.league &&
    state.source === 'espn' &&
    /^\d+$/.test(String(state.leagueId))   // never demo; cloud.js refuses too
  );
}

/**
 * Publish, unless this browser already did recently.
 *
 * Silent in every direction: it is not asked for, so it must not interrupt,
 * and a failure leaves the page exactly as it was. What it leaves behind is a
 * record, which the bar shows, so a sync that has been failing all week is
 * visible rather than merely absent.
 */
function maybeAutoSync() {
  if (!canSync() || !bridge.isAvailable()) return;
  const last = state.lastSync;
  if (last && last.ok && Date.now() - last.at < SYNC_EVERY_MS) return;
  syncNow();
}

/**
 * Move the progress line WITHOUT rebuilding the bar.
 *
 * A sync reports about thirty times, and `render()` replaces the whole strip
 * each call — which would tear down and rebuild the team picker thirty times
 * while somebody may well have it open. Writing the one word that changed is
 * both cheaper and the only version that does not fight the reader.
 */
function setSyncLabel(text) {
  state.syncLabel = text;
  const note = $('connSyncNote');
  if (note) note.textContent = text;
  else render();
}

async function syncNow() {
  if (state.syncing || !canSync()) return;
  state.syncing = true;
  state.syncLabel = 'Reading the season…';
  render();

  try {
    // Imported here rather than at the top, and the guard below is why: the
    // test harnesses swap `js/season.js` for a stub that knows nothing about
    // the cloud, and a static named import of an export a stub does not have
    // fails at link time and takes the whole page with it. A dynamic import
    // fails to a missing function, which is something this can survive.
    const season = await import('./season.js');
    if (typeof season.buildCloudPayload !== 'function') {
      state.syncing = false;
      render();
      return;
    }

    const payload = await season.buildCloudPayload({
      onProgress: (done, total, label) => setSyncLabel(`${label} (${done} of ${total})…`),
    });

    setSyncLabel('Sending…');

    const res = await cloud.syncUp(state.leagueId, state.season, payload, {
      onProgress: (done, total) => setSyncLabel(`Sending ${done} of ${total}…`),
    });

    saveSyncRecord({
      at: Date.now(),
      ok: Boolean(res && res.ok),
      wrote: (res && res.wrote) || 0,
      reason: (res && res.reason) || '',
    });
  } catch (err) {
    // Reading the season can throw — a week ESPN refuses, a dropped
    // connection. It is recorded and shown; it never reaches the page.
    saveSyncRecord({
      at: Date.now(),
      ok: false,
      wrote: 0,
      reason: (err && err.message) || 'Could not read the league to send it.',
    });
  }

  state.syncing = false;
  state.syncLabel = '';
  render();
}

/**
 * Sign in with Google.
 *
 * WIRED TO A CLICK AND NOTHING ELSE. `cloud.signIn` opens a POPUP, and a popup
 * a person did not ask for is blocked by every browser — iOS Safari most
 * strictly of all. The redirect flow that would not need a gesture is worse
 * still: it bounces through `<project>.firebaseapp.com` and then has to read a
 * cookie back on github.io, which is third-party, which is the very wall that
 * stops this site reading ESPN. So it cannot be automatic, and no amount of
 * wanting it to be changes that.
 */
async function signIn() {
  if (state.busy || state.syncing) return;
  state.error = '';
  const res = await cloud.signIn();
  if (res && res.ok) {
    state.cloudUser = res.user;
    state.cloudKnown = true;
    render();
    // Signing in is usually the last thing standing between a phone and its
    // league, so try the connection again straight away rather than making him
    // press a second button.
    if (state.leagueId && (!state.league || state.source === 'cloud')) connect();
    else maybeAutoSync();
  } else {
    state.error = (res && res.reason) || 'Sign-in did not complete.';
    render();
  }
}

async function signOutOfCloud() {
  await cloud.signOut();
  state.cloudUser = null;
  render();
}

// ------------------------------------------------------------ what the bar says
//
// STALENESS IS NOT ONE NUMBER, and flattening it to one timestamp is the
// mistake this section exists to avoid. `cloud.js` calls the wire stale after a
// DAY and rosters after a WEEK, because they decay at wildly different rates:
// a four-day-old squad list answers the season-shaped questions the analysis
// and trade pages ask perfectly well, while a four-day-old wire lists men who
// were claimed on Tuesday, and its entire question is "who can I add".

/** One shape's age, as a chip. Loud when stale, quiet when it is not. */
function ageChip(label, info) {
  if (!info) return '';
  if (!info.syncedAt) return `<span class="conn-chip is-missing">${esc(label)} not synced</span>`;
  return `<span class="conn-chip${info.stale ? ' is-stale' : ''}">` +
    `${esc(label)} ${esc(info.described)}${info.stale ? ' &mdash; out of date' : ''}</span>`;
}

/**
 * The ages of what the PHONE is looking at.
 *
 * Squads and the schedule, because those are the two shapes `js/season.js`
 * actually substitutes — every page on the phone is drawing them.
 *
 * The wire appears here only when it is STALE, and that asymmetry is
 * deliberate. The Players page still reads ESPN's raw free-agent payload
 * directly rather than through `season.js`, so there is nothing yet on the
 * phone drawing a synced wire — a chip saying "wire 2 hours ago" would be
 * reassuring about a number nothing on screen is showing. A chip that only
 * ever appears to say something is OLD cannot mislead anyone into trusting it,
 * which is the failure the rule is about.
 */
function ages() {
  const a = state.cloudAges;
  if (!a) return '';
  const chips = [
    ageChip('Squads', a.rosters),
    ageChip('Schedule', a.schedule),
    a.wire && a.wire.syncedAt && a.wire.stale ? ageChip('Waiver wire', a.wire) : '',
  ].filter(Boolean);
  return chips.length ? `<span class="conn-chips">${chips.join('')}</span>` : '';
}

/**
 * The cloud's own controls, appended to whichever state the bar is in.
 *
 * Nothing at all when no Firebase project is configured, which is the normal
 * case and stays the normal case until Tim has worked through
 * `docs/firebase-setup.md`. The site must look exactly as it does today until
 * then — same rule as the committed archive's fetch.
 */
function cloudControls() {
  if (!cloud.isConfigured()) return '';

  if (!state.cloudUser) {
    // Nothing is said until the auth listener has answered once: a bar that
    // flashed "sign in" and then replaced it with his own address on every
    // load would be worse than a beat of silence.
    if (!state.cloudKnown) return '';
    const why = coarsePointer()
      ? 'to see the copy your computer sent'
      : 'to send this league to your phone';
    return `<button type="button" id="connSignIn" class="conn-btn conn-btn-ghost">Sign in with Google</button>` +
      `<span class="conn-note">Sign in ${why}.</span>`;
  }

  const who = esc(state.cloudUser.email || state.cloudUser.name || 'signed in');

  // No bridge means no private league to read, so there is nothing this
  // browser could publish that it did not get from the cloud in the first
  // place. It says who is signed in and stops.
  if (!bridge.isAvailable() || !state.league) {
    return `<span class="conn-note">Signed in as ${who}.</span>` +
      `<button type="button" id="connSignOut" class="conn-btn conn-btn-ghost">Sign out</button>`;
  }

  if (state.syncing) {
    return `<span class="conn-note" id="connSyncNote">${esc(state.syncLabel || 'Sending…')}</span>`;
  }

  const last = state.lastSync;
  let note;
  if (!last) note = 'Not sent to your phone yet.';
  else if (last.ok) note = `Sent to your phone ${ago(last.at)} &middot; ${last.wrote} files.`;
  // A sync that has been failing all week has to be visible. Absence would
  // look identical to never having tried, and the phone would quietly go on
  // showing last month.
  else note = `<span class="conn-bad">Last send failed ${ago(last.at)}: ${esc(last.reason || 'unknown reason')}</span>`;

  return `<span class="conn-note">${note}</span>` +
    `<button type="button" id="connCloudSync" class="conn-btn conn-btn-ghost">Send to phone</button>`;
}

function render() {
  const el = $('connBar');
  if (!el) return;

  const connected = Boolean(state.league);
  const synced = connected && state.source === 'cloud';
  // Stale synced squads turn the WHOLE bar, not a corner of it. Everything
  // below the bar is being drawn from those numbers, and a reader who skims
  // past a quiet note and takes nine-day-old projections for today's has been
  // actively misled — the same reason the time machine's archive banner is
  // loud on purpose.
  const stale = synced && Boolean(state.cloudAges && state.cloudAges.rosters && state.cloudAges.rosters.stale);
  const cls = stale
    ? 'conn stale'
    : connected ? 'conn ok' : state.extension ? 'conn warn' : 'conn off';

  let body;
  if (synced) {
    const options = (state.league.teams || [])
      .map((t) => `<option value="${t.id}"${t.id === state.teamId ? ' selected' : ''}>${esc(t.name)}</option>`)
      .join('');
    // Said in words, every time, and said FIRST. "Connected" would be a lie of
    // exactly the kind this bar was built to stop: these numbers are a copy,
    // they are as old as the last time he opened the site on his computer, and
    // nothing on any page will say so if this does not.
    const lead = stale
      ? `<strong>Out of date.</strong> These numbers were sent from your computer ` +
        `${esc((state.cloudAges.rosters || {}).described || 'a long time ago')} and nothing on this page is current. ` +
        `Open the site on your computer to refresh them.`
      : `<strong>Synced copy</strong> of ${esc(state.league.name)}, sent from your computer. ` +
        `Not live &mdash; a phone cannot read a private league.`;
    body = `
      <span class="conn-dot"></span>
      <span class="conn-main">${lead}</span>
      ${ages()}
      <label class="conn-team">You are
        <select id="connTeam">
          <option value="">choose your team…</option>
          ${options}
        </select>
      </label>
      ${cloudControls()}`;
  } else if (connected) {
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
      <button type="button" id="connSync" class="conn-btn">${state.busy ? 'Syncing…' : 'Sync now'}</button>
      ${cloudControls()}`;
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
    // And the third thing that can be true, which is new: his computer may
    // already have published this league. That is the one route to a private
    // league on a phone, so it is worth a sentence — but only once we know he
    // is not signed in, and only where there is a project to sign in to.
    const cloudLine = cloud.isConfigured() && state.cloudKnown && !state.cloudUser
      ? ' If you have already opened the site on your computer, sign in below to read the copy it sent.'
      : '';
    body = `
      <span class="conn-dot"></span>
      <span class="conn-main"><strong>Not connected.</strong> ${advice}${cloudLine}</span>
      <input id="connLeague" class="conn-input" inputmode="numeric" placeholder="League ID"
             value="${esc(state.leagueId)}">
      <button type="button" id="connSync" class="conn-btn">${state.busy ? 'Connecting…' : 'Connect'}</button>
      ${cloudControls()}`;
  }

  el.className = cls;
  el.innerHTML = body + (state.error ? `<span class="conn-err">${esc(state.error)}</span>` : '');

  const sync = $('connSync');
  if (sync) sync.addEventListener('click', connect);

  // A real click, and only a real click — see `signIn()` for why that is a
  // hard requirement rather than a preference.
  const signin = $('connSignIn');
  if (signin) signin.addEventListener('click', signIn);

  const signout = $('connSignOut');
  if (signout) signout.addEventListener('click', signOutOfCloud);

  // The button ignores the six-hour throttle: a person pressing it has a
  // reason, and the reason is usually that he is about to pick up his phone.
  const push = $('connCloudSync');
  if (push) push.addEventListener('click', () => syncNow());

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

/**
 * Start watching the signed-in Google account.
 *
 * Only when a project is configured, which today it is not — so until Tim has
 * worked through `docs/firebase-setup.md` this does nothing at all and the
 * Firebase SDK is never fetched. That matters: `firebase-firestore.js` alone is
 * 685 KB, and nobody on a phone should download it to look at a page that will
 * never sync.
 *
 * `onAuth` returns immediately and answers later, so the bar renders now and
 * gains its sign-in control a beat afterwards rather than waiting on a CDN.
 */
function watchCloudAuth() {
  if (!cloud.isConfigured()) return;
  cloud.onAuth((user) => {
    const was = state.cloudUser && state.cloudUser.uid;
    state.cloudUser = user || null;
    state.cloudKnown = true;
    render();
    if (!user || user.uid === was) return;
    // NEVER connect before the bridge question has been settled. A session
    // restored from a previous visit arrives within a few milliseconds, well
    // before the extension has had its 400ms to say hello — so acting on it
    // immediately would have a desktop WITH the extension probe ESPN directly,
    // or read the cloud, and then label itself as whichever answered first.
    // `init()` does the connecting once the ping is back; this callback only
    // has work to do when it arrives afterwards.
    if (!bridgeChecked) return;
    // A session restored from a previous visit arrives here, not through the
    // button. On a phone that is the moment the league becomes readable.
    if (state.leagueId && (!state.league || state.source === 'cloud')) connect();
    else maybeAutoSync();
  });
}

async function init() {
  if (!$('connBar')) return;
  load();
  loadSyncRecord();
  render();
  watchCloudAuth();

  bridge.onAvailability(({ available }) => {
    state.extension = available;
    render();
  });

  const { available } = await bridge.ping();
  state.extension = available;
  bridgeChecked = true;

  // Pick up a league ID entered in the extension's popup, so it only has to be
  // typed once.
  if (available && !state.leagueId) {
    const cfg = await bridge.getConfig();
    if (cfg.ok && cfg.data?.leagueId) state.leagueId = String(cfg.data.leagueId);
  }
  render();

  // Reconnect automatically when we already know which league to ask for.
  //
  // The second half is the phone: with no extension there is nothing to wait
  // for, and a saved league plus a signed-in account is everything the cloud
  // probe needs. Without this he would have to press Connect on every page
  // load on the one device where connecting cannot fail for any other reason.
  if (state.leagueId && (available || (cloud.isConfigured() && state.cloudUser))) connect();
}

// The bar is decoration around the page's own data, so a failure probing the
// bridge must never escape as an unhandled rejection and take the page with
// it. Show the disconnected state and let the page carry on with demo data.
init().catch((err) => {
  state.extension = false;
  state.error = err && err.message ? err.message : 'Could not reach the bridge.';
  render();
});
