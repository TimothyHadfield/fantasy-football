// Wires the schedule page together: pick a data source, pick a week, and read
// the league four ways — standings, this week's matchups, every result, and a
// grid of who plays who.
//
// The page is read from week 1 onwards, so most of what it shows is a game that
// has NOT been played. Every view here therefore has to say something useful
// about an unplayed matchup: a layout that only comes alive once the season is
// over is the mistake this file used to make, and it went unnoticed because the
// demo season it always booted into was complete by definition.

import { fetchSchedule, fetchWeeksRosters } from './season.js';
import { generateDemoLeague } from './demo.js';
import * as espn from './espn.js';
import * as forecast from './forecast.js';
import { projectionsFromWeekTeams } from './projection.js';
import { histogram } from './charts.js';
import { enableSort, resort } from './sortable.js';
import { savedConfig, onConnection } from './connection.js';
import { scope } from './prefs.js';
import * as snapshots from './snapshots.js';

const $ = (id) => document.getElementById(id);
const prefs = scope('schedule');

/**
 * Run counts the simulation panel offers, and the seed it always uses.
 *
 * Measured on a 10-team, ~60-game season: 1,000 runs ≈ 15ms, 10,000 ≈ 120ms,
 * 50,000 ≈ 580ms. The default is the middle one — fast enough not to be worth
 * a spinner, and precise enough that the counting noise (see simNote) is under
 * a percentage point.
 *
 * The seed is fixed rather than random. Flicking to another team and back, or
 * reloading, must not quietly hand you different odds for the same season:
 * numbers that move on their own read as noise even when they are not.
 */
const SIM_RUNS = [1000, 10000, 50000];
const SIM_SEED = 20260901;
const SIM_RUN_CHOICE = (v) => (SIM_RUNS.includes(Number(v)) ? Number(v) : 10000);

const state = {
  source: prefs.get('source', 'demo'),
  data: null,               // normalised schedule (see normalizeSchedule)
  week: 'all',              // 'all' or a week number — drives the three week panels
  filterTeam: '',           // '' or a team id, for the results table only
  resultsView: prefs.get('results', 'played'),  // played | upcoming | all
  h2hView: prefs.get('h2h', null),              // null = decide from what's played
  myTeamId: null,           // highlights one row, when we know who you are
  // Whose season the forecast panel is about. null means "follow whoever I am",
  // so the panel tracks you until you deliberately look at someone else.
  forecastTeamId: prefs.get('forecastTeam', null),
  strength: null,           // Map teamId -> comparable strength, any scale
  strengthNote: '',         // how that strength was derived; shown, never implied
  strengthToken: 0,         // guards against a slow fetch landing after a reload
  projection: null,         // per-week optimal-lineup points; see buildProjection
  // How many times to play the season out. See SIM_RUNS for why the choice is
  // offered at all rather than fixed.
  runs: SIM_RUN_CHOICE(prefs.get('runs', 10000)),
  sim: null,                // {key, result} — see simInputs() for what invalidates it
  simToken: 0,              // guards against a slow run landing after the data changed

  // The time machine. `replay` is null when the page is showing now, and the
  // snapshot being replayed otherwise. It is deliberately the whole snapshot
  // rather than just a week number: forecastAsOf() reads the week off it, and
  // the banner needs to say when the reading was taken.
  replay: null,
  // The live season, put aside while an archived one is on screen, so coming
  // back costs no request. See leaveReplay().
  live: null,
  // Which weeks the committed archive already holds. Anything in the browser
  // and NOT in here has never been backed up anywhere.
  committedWeeks: new Set(),
  snapMsg: '',              // the last thing the archive controls did, in words
  snapErr: false,
};

// ------------------------------------------------------------------ formatting

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(digits);

const round1 = (n) => Math.round(n * 10) / 10;

const dash = '<span class="muted">—</span>';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The stats page writes records with an en dash; this page used a hyphen. One
// league, one way of writing 8–5.
const EN = '–';
const recordText = (r) => (r.t ? `${r.w}${EN}${r.l}${EN}${r.t}` : `${r.w}${EN}${r.l}`);

/** Margin with its sign kept: which way it went is the whole point. */
const signed = (n) => (n > 0 ? `+${fmt(n)}` : fmt(n));

/**
 * A probability as a whole percent.
 *
 * One decimal place on a forecast this soft is false precision — a 50% game is
 * a coin flip, not 50.3% — but rounding alone would print a live game as a
 * certainty, so the two ends are named rather than rounded away.
 */
function pctText(p) {
  if (!Number.isFinite(p)) return '—';
  const v = Math.min(100, Math.max(0, p * 100));
  if (v > 0 && v < 0.5) return '&lt;1%';
  if (v < 100 && v >= 99.5) return '&gt;99%';
  return `${Math.round(v)}%`;
}

/** First word of a team name, trimmed, for the head-to-head column headers. */
function shortName(name) {
  const full = String(name).trim();
  const first = full.split(/\s+/)[0];
  const s = first.length >= 3 ? first : full;
  return s.length > 11 ? s.slice(0, 10) + '…' : s;
}

// ----------------------------------------------------------------- game state

/**
 * final | live | upcoming, decided here rather than trusted from the source.
 *
 * season.js marks a game played when EITHER side has points. Mid-week that is
 * wrong in the worst possible way: one team's players have finished and the
 * other's have not, so the game flips to played, with a winner and an 80-point
 * margin, and the card confidently reports a final score for a game half of
 * which has not kicked off. Exactly one side on the board means in progress.
 */
function gameState(g) {
  const scored = (v) => typeof v === 'number' && v > 0;

  // A bye has no away side to compare against; trust the source there.
  if (g.awayId === null || g.awayId === undefined) return g.played ? 'final' : 'upcoming';

  if (scored(g.homeScore) !== scored(g.awayScore)) return 'live';
  if (!scored(g.homeScore) && !scored(g.awayScore)) return 'upcoming';
  return g.played ? 'final' : 'live';
}

/** Recomputed from the scores, so a mis-set `winner` upstream can't leak in. */
function winnerOf(g) {
  if (gameState(g) !== 'final') return null;
  if (typeof g.homeScore === 'number' && typeof g.awayScore === 'number') {
    return g.homeScore > g.awayScore ? 'home' : g.awayScore > g.homeScore ? 'away' : 'tie';
  }
  return g.winner;
}

/** Home points minus away points. Positive means the home team won. */
function marginOf(g) {
  if (typeof g.homeScore === 'number' && typeof g.awayScore === 'number') {
    return round1(g.homeScore - g.awayScore);
  }
  return null;
}

const finalGames = (games = state.data.games) => games.filter((g) => gameState(g) === 'final');

/** The games the week picker is currently pointing at. */
function weekGames() {
  const d = state.data;
  return state.week === 'all' ? d.games : d.byWeek.get(Number(state.week)) || [];
}

// -------------------------------------------------------------------- loading

/**
 * demo-rosters.js is being written alongside this page, so it may not exist.
 * Import it dynamically: if it's there we use its generateDemoSchedule(), and
 * if it isn't we derive the same shape from the demo league in demo.js. Either
 * way the page loads.
 */
async function demoSchedule() {
  try {
    const mod = await import('./demo-rosters.js');
    if (typeof mod.generateDemoSchedule === 'function') return mod.generateDemoSchedule();
  } catch {
    // Module missing or failed to parse — fall through to the local builder.
  }
  return scheduleFromDemoLeague(generateDemoLeague());
}

/** Turn demo.js's league (games with homeActual/awayActual) into schedule shape. */
function scheduleFromDemoLeague(league) {
  const nameById = new Map(league.teams.map((t) => [t.id, t.name]));

  const games = league.games.map((g) => {
    const home = g.homeActual;
    const away = g.awayActual;
    const played = typeof home === 'number' && typeof away === 'number';
    return {
      week: g.week,
      homeId: g.homeId,
      homeName: nameById.get(g.homeId) || `Team ${g.homeId}`,
      homeScore: played ? round1(home) : null,
      homeProjected: g.homeProjected ?? null,
      awayId: g.awayId,
      awayName: nameById.get(g.awayId) || `Team ${g.awayId}`,
      awayScore: played ? round1(away) : null,
      awayProjected: g.awayProjected ?? null,
      played,
      margin: played ? round1(home - away) : null,
      winner: played ? (home > away ? 'home' : away > home ? 'away' : 'tie') : null,
    };
  });

  return {
    leagueName: league.name,
    teams: league.teams.map((t) => ({ id: t.id, name: t.name })),
    games,
    isDemo: true,
  };
}

/**
 * demo.js scores every game with a projection as well as an actual, and both
 * schedule builders copy only the actuals across. The projection is the only
 * thing an unplayed demo game can show, so put it back by joining on week plus
 * home team — same seed, same fixtures, so the join is exact. A miss just
 * leaves the game without a projection rather than inventing one.
 */
function withDemoProjections(data) {
  const source = new Map();
  for (const g of generateDemoLeague().games) source.set(`${g.week}:${g.homeId}`, g);

  for (const g of data.games) {
    if (typeof g.homeProjected === 'number') continue;
    const src = source.get(`${g.week}:${g.homeId}`);
    if (!src || src.awayId !== g.awayId) continue;
    g.homeProjected = src.homeProjected;
    g.awayProjected = src.awayProjected;
  }
  return data;
}

/**
 * Fill in anything a source left out and guarantee byWeek is a real Map, so
 * the renderers never have to guess. Cheap insurance against a slightly
 * different demo-rosters.js.
 */
function normalizeSchedule(raw, { isDemo }) {
  const games = raw.games || [...(raw.byWeek?.values?.() || [])].flat();

  const byWeek = new Map();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week).push(g);
  }

  const weeks = [...byWeek.keys()].sort((a, b) => a - b);

  // Prefer the source's team list; otherwise recover it from the games.
  let teams = raw.teams;
  if (!teams || !teams.length) {
    const seen = new Map();
    for (const g of games) {
      if (g.homeId != null && !seen.has(g.homeId)) seen.set(g.homeId, g.homeName);
      if (g.awayId != null && !seen.has(g.awayId)) seen.set(g.awayId, g.awayName);
    }
    teams = [...seen].map(([id, name]) => ({ id, name }));
  }

  return {
    leagueName: raw.leagueName || (isDemo ? 'Demo League' : 'Your league'),
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    weeks,
    byWeek,
    games,
    isDemo,
  };
}

async function loadDemo() {
  setStatus('Generated sample data — not your real league.');
  state.myTeamId = null;
  const raw = await demoSchedule();
  adopt(withDemoProjections(normalizeSchedule(raw, { isDemo: true })));
}

async function loadLive() {
  // savedConfig() reads whichever key the connection bar or the Connection page
  // wrote; this page used to read one of them directly and silently never
  // found a league saved by the other.
  const saved = savedConfig();
  if (!saved) {
    setStatus('No league connected yet. Connect one in the bar above, or on the Connection page.', true);
    return;
  }

  espn.configure({ leagueId: saved.leagueId, season: saved.season });
  state.myTeamId = saved.teamId ?? null;
  setStatus('Loading your schedule from ESPN…');

  // Pull the committed archive down before anything else. This is what makes a
  // cleared browser recoverable rather than merely regrettable: the history
  // lives in the repo, and opening the page in a browser that has never seen
  // this league restores it. Awaited, so the picker is complete the first time
  // it is drawn rather than gaining rows a moment later. It is one request,
  // every failure is silent, and demo never asks — there is nothing committed
  // for a league that does not exist.
  try {
    const pulled = await snapshots.fetchRemote(saved.leagueId, saved.season);
    // Which weeks are safely in the repo, so the panel can say which are still
    // only in this browser. An empty set is the honest answer when the fetch
    // found nothing — including when it failed — and the panel then treats
    // every reading as un-backed-up, which is exactly what it is.
    state.committedWeeks = new Set(pulled.weeks || []);
    if (pulled.added) {
      state.snapMsg = `Restored ${plural(pulled.added, 'week')} from the archive committed to the site.`;
      state.snapErr = false;
    }
  } catch {
    /* the archive is a bonus, never a reason the page fails to load */
    state.committedWeeks = new Set();
  }

  try {
    const raw = await fetchSchedule();
    const data = normalizeSchedule(raw, { isDemo: false });

    if (!data.games.length) {
      setStatus(
        `Connected to ${esc(data.leagueName)}, but ESPN returned no matchups. ` +
        `If the season hasn't started, try an earlier season on the Connection page.`,
        true
      );
      return;
    }

    const done = finalGames(data.games).length;
    setStatus(
      `Loaded ${plural(data.games.length, 'matchup')} from ${esc(data.leagueName)} — ` +
      `${done} played, ${data.games.length - done} still to come.`
    );
    adopt(data);
  } catch (err) {
    setStatus(err.message, true);
  }
}

// ------------------------------------------------------------ the time machine
//
// Everything on this page that looks forward is a reading taken at a moment,
// and ESPN keeps no history of its own projections — ask it in week 9 what it
// thought week 13 would be back in week 2 and the number is simply gone. So a
// forecast that is not captured while it is on screen cannot be recovered.
//
// `js/snapshots.js` owns the format and the storage; this owns WHEN a reading
// is taken and what happens when one is put back. Replaying is a substitution:
// state.data and state.projection are swapped for the stored ones and the page
// re-renders through its ordinary path, so an archived week cannot drift into
// looking different from a live one.

/** Which archive this league's snapshots belong to. Demo never mixes with real. */
function archiveId() {
  if (!state.data) return null;
  if (state.data.isDemo) return { leagueId: 'demo', season: 0 };
  const cfg = espn.getConfig();
  if (!cfg.leagueId) return null;
  return { leagueId: String(cfg.leagueId), season: Number(cfg.season) };
}

/** Take a reading of what is on screen now. */
function captureNow() {
  const id = archiveId();
  if (!id || !state.data) return null;
  const spread = state.replay ? { sigma: null } : scoringSpread();
  return snapshots.snapshotFrom({
    leagueId: id.leagueId,
    season: id.season,
    week: forecastAsOf(),
    data: state.data,
    projection: state.projection,
    strengthNote: state.strengthNote,
    sigma: spread.sigma,
    calibrated: spread.calibrated,
    sample: spread.sample,
  });
}

/**
 * Save this week automatically, once, the first time it can be saved properly.
 *
 * FIRST WRITE WINS. Tim's ask is for what the app knew "before every week", so
 * the earliest complete reading of a week is the one worth keeping — a later
 * load the same week has already watched some of the games it was forecasting.
 * A deliberate "Save this week" overwrites; nothing else does.
 *
 * It waits for a real projection. A reading taken before ESPN's per-week
 * numbers arrive would be a schedule with no forecast in it, and because first
 * write wins it would then BLOCK the good one for the rest of the week. Better
 * to save nothing and say so.
 *
 * Demo is never captured automatically: it is generated, it would fill the
 * archive with weeks that never happened, and every reload would race to write
 * them. The button still works there, which is how the feature can be tried
 * before there is a real season to try it on.
 */
function autoCapture() {
  if (state.replay) return;                 // never record a recording
  if (!state.data || state.data.isDemo) return;
  if (!state.projection) return;            // no forecast in it yet — wait
  const id = archiveId();
  if (!id) return;

  const week = forecastAsOf();
  if (!Number.isFinite(week) || week <= 0) return;
  if (snapshots.get(id.leagueId, id.season, week)) return;   // already have it

  const snap = captureNow();
  if (!snap) return;
  const res = snapshots.save(snap);
  state.snapMsg = res.ok
    ? `Saved a reading of week ${week} automatically — this is what the app knew today.`
    : `Could not save week ${week}: ${res.reason}`;
  state.snapErr = !res.ok;
  renderArchive();
}

/** Put a stored week back on screen. */
function replaySnapshot(week) {
  const id = archiveId();
  if (!id) return;
  const snap = snapshots.get(id.leagueId, id.season, week);
  if (!snap) {
    state.snapMsg = `No reading was ever saved for week ${week}.`;
    state.snapErr = true;
    renderArchive();
    return;
  }
  const built = snapshots.hydrate(snap);
  if (!built) {
    state.snapMsg = `The saved week ${week} could not be read back.`;
    state.snapErr = true;
    renderArchive();
    return;
  }

  // Put the live season aside on the way in, so coming back is a repaint.
  //
  // Reloading instead would be correct and expensive: returning to now costs a
  // schedule request plus one per remaining week, which on a thirteen-week
  // run-in is a dozen calls every time somebody flicks back from an archived
  // week. This page's whole cost model is one request per week with no bulk
  // form; spending that on a control that only undoes a local substitution
  // would be the worst-value request on the site. The stash is only as fresh as
  // the last load, which is exactly as fresh as the page was anyway — nothing
  // here polls — and the data-source toggle forces a real reload.
  if (!state.replay) {
    state.live = {
      data: state.data,
      projection: state.projection,
      strength: state.strength,
      strengthNote: state.strengthNote,
      week: state.week,
    };
  }

  state.replay = snap;
  state.data = built.data;
  state.projection = built.projection;
  state.strength = built.projection ? built.projection.strength : null;
  state.strengthNote = built.strengthNote;
  // A run in flight is about the live season; retire it rather than letting it
  // land on top of an archived one.
  state.sim = null;
  state.simToken++;
  state.strengthToken++;   // and stop any live projection fetch from landing
  if (!state.data.weeks.includes(state.week)) state.week = currentWeek(state.data);
  state.snapMsg = '';
  state.snapErr = false;
  render();
}

/** Back to now: the season put aside on the way in, restored without a request. */
function leaveReplay() {
  if (!state.replay) return;
  state.replay = null;
  state.snapMsg = '';
  state.snapErr = false;

  const live = state.live;
  state.live = null;
  if (!live || !live.data) {
    // Nothing was put aside — a reload while replaying, say. Fetch it properly
    // rather than leaving the page on data it has just disowned.
    state.source === 'demo' ? loadDemo() : loadLive();
    return;
  }

  state.data = live.data;
  state.projection = live.projection;
  state.strength = live.strength;
  state.strengthNote = live.strengthNote;
  state.week = live.data.weeks.includes(live.week) ? live.week : currentWeek(live.data);
  state.sim = null;        // the cached run belongs to the archived season
  state.simToken++;
  render();
}

function renderArchive() {
  const id = archiveId();
  const sel = $('asOfSelect');
  const banner = $('replayBanner');
  const status = $('snapStatus');

  if (!id) {
    sel.innerHTML = '<option value="live">Right now</option>';
    banner.classList.add('hidden');
    $('snapDelete').classList.add('hidden');
    status.innerHTML =
      'Connect a league to start keeping a weekly record of the forecast.';
    return;
  }

  const saved = snapshots.list(id.leagueId, id.season);
  const current = state.replay ? String(state.replay.week) : 'live';

  sel.innerHTML =
    `<option value="live"${current === 'live' ? ' selected' : ''}>Right now</option>` +
    saved
      .slice()
      .reverse()
      .map((s) => {
        const when = new Date(s.takenAt);
        const stamp = Number.isNaN(when.getTime())
          ? ''
          : ` · saved ${when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
        return (
          `<option value="${s.week}"${current === String(s.week) ? ' selected' : ''}>` +
          `Week ${s.week}${esc(stamp)}</option>`
        );
      })
      .join('');
  if (sel.value !== current) sel.value = current;

  $('snapDelete').classList.toggle('hidden', !state.replay);
  $('snapSave').textContent = state.replay ? 'Re-save this week' : 'Save this week';
  $('snapSave').disabled = Boolean(state.replay);

  // The banner. Loud, because every number below it is historical and a reader
  // who skims past it and reads the forecast as current has been misled.
  if (state.replay) {
    const when = new Date(state.replay.takenAt);
    const stamp = Number.isNaN(when.getTime()) ? 'an earlier date' : when.toLocaleString();
    banner.classList.remove('hidden');
    banner.innerHTML =
      `<strong>You are looking at the season as of week ${state.replay.week}</strong>, recorded on ` +
      `${esc(stamp)}. Every number on this page — the standings, the results, the win ` +
      `percentages, the forecast and the simulation — is what the app knew then, not what it ` +
      `knows now. Choose <em>Right now</em> above to come back.`;
  } else {
    banner.classList.add('hidden');
    banner.innerHTML = '';
  }

  renderArchiveNote(id, saved);
}

function renderArchiveNote(id, saved) {
  const el = $('snapStatus');
  const weeks = saved.map((s) => s.week);
  const kb = Math.round(snapshots.sizeOf(id.leagueId, id.season) / 1024);

  const held = weeks.length
    ? `<strong>${plural(weeks.length, 'week')} kept</strong> (${weeks.join(', ')}) · about ${kb}KB.`
    : '<strong>Nothing kept yet.</strong>';

  const why =
    'ESPN publishes a projection for every future week, but keeps no record of what it ' +
    '<em>used</em> to project — ask it in week 9 what it thought of week 13 back in week 2 and ' +
    'the number is gone. So a reading of the forecast that is not saved while it is on screen ' +
    'cannot be recovered afterwards.';

  const when = state.data && state.data.isDemo
    ? 'Sample data is never recorded automatically — it is generated, not observed — but ' +
      '<strong>Save this week</strong> works here so the feature can be tried before there is a ' +
      'real season to try it on.'
    : 'A reading is taken <strong>automatically, once per week</strong>, the first time the page ' +
      'loads with ESPN&rsquo;s projections in it. The earliest complete reading of a week is the ' +
      'one kept, because that is the one taken before any of the games it forecasts were played.';

  // Which readings exist only in this browser. THE ONE THING TO ACT ON, so it
  // is worked out rather than left to the reader to keep track of: an export is
  // cumulative, so "do it every week" was never true and saying so would have
  // made a monthly job feel like a weekly one.
  const loose = weeks.filter((w) => !state.committedWeeks.has(w));

  const durability = state.data && state.data.isDemo
    ? '<strong>Sample readings live in this browser only</strong> and are not worth keeping — they ' +
      'describe a season that never happened.'
    : 'Readings are <strong>taken</strong> in this browser and <strong>kept</strong> in the site&rsquo;s ' +
      'own repository. Once a file is committed this page pulls it back by itself — on this machine, on ' +
      'your phone, and in a browser that has never seen the league before. ' +
      (!weeks.length
        ? ''
        : loose.length
          ? `<br><span class="neg"><strong>${plural(loose.length, 'week')} ` +
            `(${loose.join(', ')}) ${loose.length === 1 ? 'exists' : 'exist'} only in this browser.</strong></span> ` +
            'Press <strong>Export archive</strong> and hand the file over; clearing site data before you ' +
            'do would delete ' + (loose.length === 1 ? 'it' : 'them') + '. ' +
            'One export covers every week at once, so this is not a weekly job.'
          : '<br><span class="pos"><strong>Every reading is backed up.</strong></span> Nothing to export ' +
            'until a new week is recorded.');

  const limit =
    'What is kept is the schedule, the results as they stood, one projected total per team per ' +
    'week, and the spread the win percentages were read against — the <em>inputs</em>. ' +
    '<strong>The forecast and the simulation are worked out again from those when you look back</strong>, ' +
    'so there is nothing you have to run for a week to save properly, and nothing to do per team: one ' +
    'simulation covers all ten at once, and the picker only chooses whose chart is drawn. ' +
    '<strong>The rosters behind those numbers are not kept</strong>, so an archived week can be ' +
    're-read but not re-derived — the other pages always show today.';

  el.innerHTML =
    `${held} ${why}<br>${when}<br>${durability}<br>${limit}` +
    (state.snapMsg
      ? `<br><span class="${state.snapErr ? 'neg' : 'pos'}">${esc(state.snapMsg)}</span>`
      : '');
}

/** Take on a freshly loaded schedule and reset what belongs to the old one. */
function adopt(data) {
  // Adopting a freshly loaded league is by definition leaving an archived one,
  // and the season put aside belongs to the league being replaced.
  state.replay = null;
  state.live = null;
  state.data = data;
  state.week = restoreWeek(data);
  state.filterTeam = '';
  state.strength = null;
  state.strengthNote = '';
  state.projection = null;
  // A run still in flight is about the league we just replaced; retire it here
  // rather than letting it land and be discarded on a key mismatch later.
  state.sim = null;
  state.simToken++;
  render();
  refreshStrength();
}

/** The remembered week if it still exists in this league, else the live one. */
function restoreWeek(data) {
  const saved = prefs.get('week', null);
  if (saved === 'all') return 'all';
  if (typeof saved === 'number' && data.weeks.includes(saved)) return saved;
  return currentWeek(data);
}

/**
 * The week the league is actually on: the last one with something on the board,
 * or the first week of the season if nothing has been played at all.
 */
function currentWeek(data = state.data) {
  const started = data.weeks.filter((w) =>
    (data.byWeek.get(w) || []).some((g) => gameState(g) !== 'upcoming')
  );
  return started.length ? started[started.length - 1] : data.weeks[0] ?? 'all';
}

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

// ------------------------------------------------------------------ projection
//
// A projected score for every team in every week, built from ONE roster fetch
// per week.
//
// The arithmetic itself now lives in js/projection.js — best legal lineup
// rather than the one currently set, starting slots counted off the lineups,
// byes already carried at 0.00 — because the stats page needs the same answer
// and a second copy is how the two pages would start quietly disagreeing about
// how good a team is. What is decided HERE is what this page does with it:
// which weeks to ask for, whether the answer covers enough of the league to be
// worth printing, and the sentence that explains it to the reader.
//
// Each week's projection is ESPN's OWN per-week number for that week, fetched
// per week. ESPN publishes one for every player in every future week — a
// week-13 figure is there in week 1 — so there is nothing to extrapolate.
//
// This is deliberately the same number the ESPN site shows when you page a
// lineup forward to a week and read the "proj" total under the starters, which
// is what makes it checkable by hand. Injury status is left alone for the same
// reason — ESPN's own projection carries availability, and second guessing it
// would move our totals away from the ones being checked against.
//
// The cost is one request per remaining week. There is no bulk form; that was
// checked rather than assumed.

/**
 * Turn per-week rosters into everything this page needs from a projection.
 *
 * projection.js works out the points; the rest is what only a page can judge —
 * a comparable strength per team, a refusal to hand back a projection with a
 * hole in it, and a note saying where the numbers came from.
 *
 * That note has to state how the starting slots were decided, because they can
 * be either read or guessed: projection.js counts them off the lineups ESPN
 * already sent (a fourth request for `parseLeague().starterSlots` buys nothing
 * an illegal lineup could not already rule out), and only falls back to
 * DEFAULT_SLOTS when the lineups say nothing at all. Guessing a two-receiver
 * league when it has three understates every team by a whole starter, so that
 * fallback is admitted in the note rather than passed off as read.
 *
 * @param {Map<number, Array>} weekTeams week -> teams, from fetchWeeksRosters
 * @returns {Object|null} null when the projection cannot cover the league
 */
function buildProjection(weekTeams) {
  const built = projectionsFromWeekTeams(weekTeams);
  if (!built) return null;
  const { proj, slots, countsKnown } = built;

  // A projection that only covers some of the league would rank a run-in
  // against a hole. Better to hand back nothing and let the fallbacks speak.
  const covered = proj.get([...proj.keys()][0]);
  if (!covered || covered.size < state.data.teams.length) return null;

  // The comparable number per team: how many points they average over the
  // weeks still to play. Per WEEK, unlike the season-total basis below it,
  // which is what makes it safe to print on a card as a score.
  const ahead = [...proj.keys()].filter((w) =>
    (state.data.byWeek.get(w) || []).some((g) => gameState(g) !== 'final')
  );
  const over = ahead.length ? ahead : [...proj.keys()];
  const strength = new Map();
  for (const t of state.data.teams) {
    let total = 0;
    let n = 0;
    for (const w of over) {
      const v = proj.get(w)?.get(t.id);
      if (typeof v === 'number') { total += v; n++; }
    }
    if (n) strength.set(t.id, total / n);
  }
  if (strength.size < state.data.teams.length) return null;

  const starters = slots.length;
  const slotSource = countsKnown
    ? `${plural(starters, 'starter')} read from the current lineups`
    : `${plural(starters, 'starter')} assumed — this league’s own lineup settings could not be read`;

  const got = built.weeks;
  const reach =
    got.length > 1 ? `weeks ${got[0]} to ${got[got.length - 1]}` : `week ${got[0]}`;

  return {
    proj,
    slots,
    strength,
    weeksCovered: got,
    note:
      `Strength is ESPN’s own projection for each week (${reach}), with the best ` +
      `legal lineup filled rather than the one currently set (${slotSource}) — ` +
      `the same total the ESPN site shows under a lineup paged forward to that ` +
      `week, except that a bench player projected above a starter is counted as ` +
      `starting. Players on bye come back at zero from ESPN, so they sit down on ` +
      `their own.`,
  };
}

// -------------------------------------------------------------------- strength
//
// One number per team, used only to rank how hard the rest of the schedule
// looks. The scale never matters — a rank is scale-free — but where it came
// from does, so every basis carries the sentence that explains it.

function strengthFromGameProjections() {
  const acc = new Map();
  for (const g of state.data.games) {
    const add = (id, v) => {
      if (id == null || typeof v !== 'number' || v <= 0) return;
      const cur = acc.get(id) || { total: 0, n: 0 };
      cur.total += v;
      cur.n++;
      acc.set(id, cur);
    };
    add(g.homeId, g.homeProjected);
    add(g.awayId, g.awayProjected);
  }
  if (acc.size < state.data.teams.length) return null;
  return new Map([...acc].map(([id, a]) => [id, a.total / a.n]));
}

/** Points per game so far. Honest, but nearly meaningless in September. */
function strengthFromScoring() {
  const acc = new Map();
  for (const g of finalGames()) {
    const add = (id, v) => {
      if (id == null || typeof v !== 'number') return;
      const cur = acc.get(id) || { total: 0, n: 0 };
      cur.total += v;
      cur.n++;
      acc.set(id, cur);
    };
    add(g.homeId, g.homeScore);
    add(g.awayId, g.awayScore);
  }
  if (acc.size < state.data.teams.length) return null;
  return new Map([...acc].map(([id, a]) => [id, a.total / a.n]));
}

/** How many weeks have a completed game in them — the thinness of the sample. */
function weeksPlayed() {
  return new Set(finalGames().map((g) => g.week)).size;
}

/**
 * Fill in state.strength, then repaint just the two panels that use it. Nothing
 * else waits for this, so the page appears immediately and the run-in column
 * fills in a moment later rather than everything blocking on ESPN.
 */
async function refreshStrength() {
  const token = ++state.strengthToken;
  const stale = () => token !== state.strengthToken;

  // Four bases, best first. There is exactly one state.strengthNote, and every
  // branch sets it, because a second unexplained notion of "how good is this
  // team" is how two panels end up disagreeing with each other in silence.
  //
  // 1. ESPN's own projection for each week, with the best legal lineup filled.
  //    Forward-looking, per WEEK, and checkable against the ESPN site by hand,
  //    which is the property that matters most here. It costs a request per
  //    week, so it asks only for the weeks still to play. The demo has no
  //    endpoint for it and does not need one: its games carry projections.
  if (!state.data.isDemo) {
    const wanted = state.data.weeks.filter((w) =>
      (state.data.byWeek.get(w) || []).some((g) => gameState(g) !== 'final')
    );
    const weeks = wanted.length ? wanted : [currentWeek()];

    let weekTeams = new Map();
    try {
      weekTeams = await fetchWeeksRosters(weeks, {
        onProgress: (done, total) => {
          if (stale() || done >= total) return;
          setStatus(`Reading ESPN’s projections… week ${done} of ${total}.`);
        },
      });
    } catch {
      weekTeams = new Map();   // ESPN said no; the bases below need no network
    }
    if (stale()) return;

    const teams = weekTeams.get(weeks[0]) || [...weekTeams.values()][0] || null;

    if (weekTeams.size) {
      const built = buildProjection(weekTeams);
      if (stale()) return;
      if (built) {
        state.projection = built;
        apply(built.strength, built.note);
        return;
      }
    }

    if (teams && teams.length) {

      // 1b. ESPN's season projection for the current starters, from the payload
      //    we already have — so this costs no extra request. A season TOTAL
      //    rather than a per-week number, so it
      //    can rank a run-in but must never be shown as a score — see the note
      //    in cardContext().
      const m = new Map(
        teams
          .filter((t) => typeof t.seasonProjectedTotal === 'number' && t.seasonProjectedTotal > 0)
          .map((t) => [t.id, t.seasonProjectedTotal])
      );
      if (m.size >= state.data.teams.length) {
        apply(m, 'Strength is ESPN’s season projection for each team’s current starters.');
        return;
      }
    }
  }

  // 2. Projections already attached to the games themselves. Also per week.
  const fromProjections = strengthFromGameProjections();
  if (fromProjections) {
    apply(fromProjections, 'Strength is each team’s average projected points.');
    return;
  }

  if (stale()) return;

  // 4. What actually happened.
  const fromScoring = strengthFromScoring();
  if (!fromScoring) {
    apply(null, 'No projections available and not every team has played, so the run-in is not ranked yet.');
    return;
  }

  const w = weeksPlayed();
  const thin = w < 4 ? ` Thin this early — it is ${plural(w, 'week')} of scoring.` : '';
  apply(fromScoring, `No projections available, so strength is points per game so far.${thin}`);

  function apply(map, note) {
    if (stale() || !state.data) return;
    state.strength = map;
    state.strengthNote = note;
    renderStandings();
    renderMatchups();   // an unplayed card falls back to the strength ranking
    renderResults();    // the win-% column arrives with the projection
    renderForecast();   // and so does the whole season forecast
    renderSimulation(); // which the simulation is built on top of, so it waits too
    // Last, and only now: this is the first moment the page holds a complete
    // reading, and a reading is the thing worth keeping. See autoCapture().
    autoCapture();
  }
}

/**
 * Remaining strength of schedule: the mean strength of the opponents a team has
 * still to play, shown as a rank because the raw mean means nothing on its own
 * and changes units with the basis. Rank 1 is the hardest run-in.
 */
function remainingSos() {
  if (!state.strength) return null;

  const acc = new Map(state.data.teams.map((t) => [t.id, { total: 0, n: 0 }]));
  for (const g of state.data.games) {
    if (gameState(g) === 'final') continue;          // only what is left to play
    if (g.homeId == null || g.awayId == null) continue;
    const add = (id, oppId) => {
      const s = state.strength.get(oppId);
      const cur = acc.get(id);
      if (!cur || typeof s !== 'number') return;
      cur.total += s;
      cur.n++;
    };
    add(g.homeId, g.awayId);
    add(g.awayId, g.homeId);
  }

  const means = [...acc]
    .filter(([, a]) => a.n > 0)
    .map(([id, a]) => ({ id, mean: a.total / a.n }));
  if (!means.length) return null;

  means.sort((a, b) => b.mean - a.mean);            // hardest first
  return new Map(means.map((m, i) => [m.id, { rank: i + 1, mean: m.mean, of: means.length }]));
}

// --------------------------------------------------------------------- render

function render() {
  const d = state.data;
  if (!d) return;

  syncSource();

  // The badge says WHEN as well as what, because "Live" over a week-3 archive
  // is the one label on this page that could actively mislead.
  if (state.replay) {
    $('modeBadge').className = 'badge archive';
    $('modeBadge').textContent = `Week ${state.replay.week} archive`;
  } else {
    $('modeBadge').className = 'badge ' + (d.isDemo ? 'demo' : 'live');
    $('modeBadge').textContent = d.isDemo ? 'Demo' : 'Live';
  }
  $('pageSub').textContent = state.replay
    ? `${d.leagueName} · as the app saw it in week ${state.replay.week}`
    : d.isDemo
      ? 'Showing a generated sample season so you can see the layout with real-looking results in it.'
      : `${d.leagueName} · ${d.weeks.length} week${d.weeks.length === 1 ? '' : 's'} · ${d.teams.length} teams`;

  renderArchive();
  renderWeekPicker();
  renderTeamPicker();
  renderStandings();
  renderSummary();
  renderMatchups();
  renderResults();
  renderH2H();
  renderForecast();
  renderSimulation();
}

function syncSource() {
  $('sourceToggle')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.src === state.source));
}

/** Mark the one button in a segmented control that matches `value`. */
function syncSegmented(id, value) {
  $(id)
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.view === value));
}

function renderWeekPicker() {
  const sel = $('weekSelect');
  const weeks = state.data.weeks;

  // Only rebuild when the league itself changed: rewriting the options under a
  // select the user is in the middle of using is needlessly jumpy.
  const signature = weeks.join(',');
  if (sel.dataset.weeks !== signature) {
    sel.innerHTML =
      '<option value="all">All weeks</option>' +
      weeks.map((w) => `<option value="${w}">Week ${w}</option>`).join('');
    sel.dataset.weeks = signature;
  }
  sel.value = String(state.week);

  const i = weeks.indexOf(Number(state.week));
  $('weekPrev').disabled = state.week !== 'all' && i <= 0;
  $('weekNext').disabled = state.week !== 'all' && i >= weeks.length - 1;

  const where =
    state.week === 'all' ? 'All weeks' : `Week ${state.week} of ${weeks[weeks.length - 1]}`;

  // The forecast panel is season-wide on live data but week-driven in the demo,
  // whose season is already complete — so the contract has to be stated for the
  // data actually on screen rather than asserted once and hoped for.
  const reach = state.data.isDemo
    ? 'sets the summary, matchups and results below, and the week the forecast is made from. ' +
      'Standings and the grid stay season-to-date.'
    : 'sets the summary, matchups and results below. ' +
      'Standings, the grid and the season forecast stay season-to-date.';
  $('weekNote').textContent = `${where} · ${reach}`;
}

function renderTeamPicker() {
  const sel = $('filterTeam');
  sel.innerHTML =
    '<option value="">Every team</option>' +
    state.data.teams.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  sel.value = state.filterTeam === '' ? '' : String(state.filterTeam);
}

// ------------------------------------------------------------------ standings

/** Season-to-date record, points for and against, and the run-in rank. */
function standingsRows() {
  const record = headToHead();
  const totals = new Map(state.data.teams.map((t) => [t.id, { pf: 0, pa: 0, gp: 0 }]));

  for (const g of finalGames()) {
    const add = (id, mine, theirs) => {
      const cur = totals.get(id);
      if (!cur || typeof mine !== 'number' || typeof theirs !== 'number') return;
      cur.pf += mine;
      cur.pa += theirs;
      cur.gp++;
    };
    add(g.homeId, g.homeScore, g.awayScore);
    add(g.awayId, g.awayScore, g.homeScore);
  }

  const sos = remainingSos();

  return state.data.teams.map((t) => {
    const row = record.get(t.id);
    const rec = { w: 0, l: 0, t: 0 };
    for (const opp of state.data.teams) {
      if (opp.id === t.id) continue;
      const r = row.get(opp.id);
      rec.w += r.w;
      rec.l += r.l;
      rec.t += r.t;
    }
    const tot = totals.get(t.id);
    return { team: t, rec, pf: round1(tot.pf), pa: round1(tot.pa), sos: sos?.get(t.id) || null };
  });
}

function renderStandings() {
  const table = $('standingsTable');
  const tbody = table.querySelector('tbody');
  const rows = standingsRows();

  tbody.innerHTML = rows
    .map(({ team, rec, pf, pa, sos }) => {
      const cls = rec.w > rec.l ? 'pos' : rec.w < rec.l ? 'neg' : 'muted';
      // Wins first, points for as the tie-break — the same order the league
      // itself uses, packed into the one number sortable.js reads.
      const sortKey = rec.w + pf / 100000;

      let sosCell = `<td>${dash}</td>`;
      if (sos) {
        // Rank 1 is the hardest run-in, so the warning colour goes at the top.
        const tone = sos.rank <= 3 ? 'neg' : sos.rank > sos.of - 3 ? 'pos' : '';
        sosCell =
          `<td data-v="${sos.rank}" class="${tone}" ` +
          `title="Opponents still to play average ${fmt(sos.mean)} on this measure.">` +
          `${sos.rank}<span class="muted">/${sos.of}</span></td>`;
      }

      return `<tr${team.id === state.myTeamId ? ' class="me"' : ''}>
          <td class="name">${esc(team.name)}</td>
          <td data-v="${sortKey}" class="${cls}">${recordText(rec)}</td>
          <td data-v="${pf}">${fmt(pf)}</td>
          <td data-v="${pa}">${fmt(pa)}</td>
          ${sosCell}
        </tr>`;
    })
    .join('');

  resort(table);

  const done = finalGames().length;
  const left = state.data.games.length - done;
  const runIn = left
    ? `“Rest of season” ranks the average strength of the opponents each team has still ` +
      `to play; 1 is the hardest run-in. ${state.strengthNote || 'Working out how hard the run-ins are…'}`
    : 'Every game has been played, so there is no run-in left to rank.';

  $('standingsNote').textContent =
    `Season to date — ${done} of ${state.data.games.length} games decided. ${runIn}`;
}

// -------------------------------------------------------------------- summary

function renderSummary() {
  const scoped = weekGames();
  const played = finalGames(scoped);
  const live = scoped.filter((g) => gameState(g) === 'live').length;
  const scopeLabel = state.week === 'all' ? 'the season to date' : `week ${state.week}`;

  $('summaryTitle').textContent = state.week === 'all' ? 'Season so far' : `Week ${state.week}`;

  if (!played.length) {
    $('summary').innerHTML =
      `<div class="stat"><div class="k">Games played</div><div class="v">0</div></div>` +
      `<div class="stat"><div class="k">Scheduled</div><div class="v">${scoped.length}</div></div>`;
    $('summaryNote').textContent = live
      ? `${plural(live, 'game')} in progress; nothing is final yet, so there is nothing to compare.`
      : `Nothing has been played in ${scopeLabel}, so there is nothing to compare.`;
    return;
  }

  const combined = (g) => g.homeScore + g.awayScore;
  const gap = (g) => Math.abs(marginOf(g));

  const highest = played.reduce((a, b) => (combined(b) > combined(a) ? b : a));
  const blowout = played.reduce((a, b) => (gap(b) > gap(a) ? b : a));
  const closest = played.reduce((a, b) => (gap(b) < gap(a) ? b : a));

  const items = [
    ['Highest-scoring game', fmt(combined(highest))],
    ['Biggest blowout', fmt(gap(blowout))],
    ['Closest game', fmt(gap(closest))],
    ['Games played', `${played.length}<span class="muted"> / ${scoped.length}</span>`],
  ];

  $('summary').innerHTML = items
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');

  // The headline numbers are meaningless without the games behind them — and,
  // three weeks into a season, without the size of the pool they came from.
  const line = (label, g) =>
    `<strong>${label}:</strong> ${esc(g.homeName)} ${fmt(g.homeScore)} – ` +
    `${fmt(g.awayScore)} ${esc(g.awayName)} (week ${g.week})`;

  $('summaryNote').innerHTML = [
    `Best and worst of ${plural(played.length, 'game')} in ${scopeLabel}` +
      (live ? `, with ${plural(live, 'game')} still in progress` : '') + '.',
    line('Highest scoring', highest),
    line('Biggest blowout', blowout),
    line('Closest', closest),
  ].join('<br>');
}

// ------------------------------------------------------------------- matchups

/**
 * Everything a card needs that isn't in the game itself: each team's record so
 * far, and a per-week points number to put against an unplayed matchup.
 * Computed once per render rather than once per card.
 */
function cardContext() {
  const record = headToHead();
  const records = new Map();
  for (const t of state.data.teams) {
    const rec = { w: 0, l: 0, t: 0 };
    for (const opp of state.data.teams) {
      if (opp.id === t.id) continue;
      const r = record.get(t.id).get(opp.id);
      rec.w += r.w;
      rec.l += r.l;
      rec.t += r.t;
    }
    records.set(t.id, rec);
  }
  // Season strength can be a season-long total (basis 1b in refreshStrength),
  // which would be nonsense printed as a score, so the fallback for a card is
  // always points per game.
  const ppg = strengthFromScoring();

  // Before anyone has scored there is no per-week number to show at all. The
  // strength ranking survives that, and a rank is safe to show whatever the
  // underlying measure is.
  let ranks = null;
  if (state.strength) {
    const order = [...state.strength].sort((a, b) => b[1] - a[1]);
    ranks = new Map(order.map(([id], i) => [id, i + 1]));
  }

  return { records, ppg, ranks, sigma: scoringSpread().sigma };
}

/** 1st, 2nd, 3rd… */
function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

/**
 * Projected points for one side of one game — the single number the cards, the
 * results table and the season forecast all read, so they cannot disagree.
 *
 * A projection carried on the game itself wins (the demo season has real ones);
 * otherwise it is the optimal lineup that team could field that week.
 */
function projectedPoints(g, side) {
  const own = side === 'home' ? g.homeProjected : g.awayProjected;
  if (typeof own === 'number' && own > 0) return own;

  const id = side === 'home' ? g.homeId : g.awayId;
  const v = state.projection?.proj.get(g.week)?.get(id);
  return typeof v === 'number' && v > 0 ? v : null;
}

/** A per-week points number for one side, and where it came from. */
function expectedFor(g, side, ctx) {
  const proj = projectedPoints(g, side);
  if (proj !== null) return { v: proj, basis: 'Projected' };

  const id = side === 'home' ? g.homeId : g.awayId;
  const p = ctx.ppg?.get(id);
  return typeof p === 'number' ? { v: p, basis: 'Points so far' } : null;
}

/**
 * The chance the home team wins, or null when the two projections needed to
 * say anything do not exist.
 *
 * This is DERIVED. ESPN publishes projections, never a win probability, so the
 * number below is ours: the gap between two projected totals read against how
 * far this league's scores have historically landed from their projections.
 * Every panel that shows one carries a sentence saying exactly that.
 */
function homeWinChance(g, sigma) {
  const h = projectedPoints(g, 'home');
  const a = projectedPoints(g, 'away');
  if (h === null || a === null) return null;
  return forecast.winProbability(h, a, sigma);
}

function renderMatchups() {
  const d = state.data;
  const weeks = state.week === 'all' ? d.weeks : [Number(state.week)];
  const ctx = cardContext();

  $('matchupsTitle').textContent =
    state.week === 'all' ? 'Matchups — all weeks' : `Week ${state.week} matchups`;

  const blocks = weeks
    .map((w) => {
      const games = d.byWeek.get(w) || [];
      if (!games.length) return '';
      const cards = games.map((g) => gameCard(g, ctx)).join('');
      // Only label the week when several are on screen at once.
      const head = state.week === 'all' ? `<p class="week-head">Week ${w}</p>` : '';
      return `<div class="week-block">${head}<div class="matchups">${cards}</div></div>`;
    })
    .filter(Boolean)
    .join('');

  $('matchups').innerHTML = blocks || '<div class="empty">No matchups to show.</div>';

  // An unplayed card carries a number, and a number whose basis isn't stated is
  // a number nobody can trust.
  const scoped = weeks.flatMap((w) => d.byWeek.get(w) || []);
  const upcoming = scoped.filter((g) => gameState(g) === 'upcoming');
  let basis = '';
  if (upcoming.length) {
    if (upcoming.some((g) => typeof g.homeProjected === 'number')) {
      basis = 'The number against an unplayed game is that team’s projection.';
    } else if (state.projection) {
      basis =
        'The number against an unplayed game is the most points that team’s current ' +
        'roster could be projected to score in that week.';
    } else if (ctx.ppg) {
      basis = 'With no projections available, an unplayed game shows each team’s points per game so far.';
    } else if (ctx.ranks) {
      basis = 'Nobody has scored yet, so unplayed games are compared by strength ranking.';
    }
  }
  const chance = upcoming.some((g) => homeWinChance(g, ctx.sigma) !== null)
    ? ` ${derivedCaveat()}`
    : '';
  $('matchupsNote').textContent = `Records are season-to-date. ${basis}${chance}`.trim();
}

function gameCard(g, ctx) {
  const st = gameState(g);
  const bye = g.awayId === null || g.awayId === undefined;
  const winner = winnerOf(g);

  // Winner emphasised, loser dimmed. An unplayed or in-progress game gets
  // neither, so it never reads as a settled result.
  const sideClass = (side) =>
    st !== 'final' || winner === 'tie' ? '' : ` ${winner === side ? 'win' : 'lose'}`;

  const recordOf = (id) => {
    const r = ctx.records.get(id);
    return r ? `<span class="trec">${recordText(r)}</span>` : '';
  };

  const side = (which, name, id) =>
    `<div class="side ${which}${sideClass(which)}">
       <span class="tname">${esc(name)}</span>
       ${id == null ? '' : recordOf(id)}
     </div>`;

  const scoreCell = (which, score) => {
    if (st === 'final' || (st === 'live' && typeof score === 'number' && score > 0)) {
      const win = st === 'final' && winner === which ? ' win' : '';
      return `<div class="tscore ${which}${win}">${fmt(score)}</div>`;
    }
    const e = st === 'upcoming' ? expectedFor(g, which, ctx) : null;
    return `<div class="tscore ${which} proj">${e ? fmt(e.v) : '—'}</div>`;
  };

  let meta = '';
  let metaClass = 'gmeta';
  let metaTitle = '';
  if (bye) {
    meta = 'Bye week';
  } else if (st === 'live') {
    // Half a scoreline is not a result. Say so instead of crowning anyone.
    metaClass += ' live';
    meta = 'In progress — one side still to play';
  } else if (st === 'final') {
    meta =
      winner === 'tie'
        ? 'Tied'
        : `${esc(winner === 'home' ? g.homeName : g.awayName)} by ${fmt(Math.abs(marginOf(g)))}`;
  } else {
    const h = expectedFor(g, 'home', ctx);
    const a = expectedFor(g, 'away', ctx);
    const hr = ctx.ranks?.get(g.homeId);
    const ar = ctx.ranks?.get(g.awayId);
    if (h && a) {
      const diff = h.v - a.v;
      const level = Math.abs(diff) < 0.5;
      // The margin and the percentage are the same statement twice — the
      // percentage IS that margin read against the scoring spread — so they can
      // never point opposite ways. The basis moves into the tooltip to keep the
      // cell short; the panel note carries it for everyone else.
      const p = homeWinChance(g, ctx.sigma);
      if (p === null) {
        meta = level
          ? `${h.basis} · level`
          : `${h.basis} · ${esc(diff > 0 ? g.homeName : g.awayName)} by ${fmt(Math.abs(diff))}`;
        metaTitle = `${h.basis} points.`;
      } else {
        meta = level
          ? `Level · ${pctText(0.5)}`
          : `${esc(diff > 0 ? g.homeName : g.awayName)} by ${fmt(Math.abs(diff))} · ` +
            `${pctText(Math.max(p, 1 - p))}`;
        metaTitle =
          `${h.basis} points. The percentage is the favourite’s chance of winning, ` +
          `derived here from that gap — ESPN publishes projections, not odds.`;
      }
    } else if (hr && ar) {
      // Week 1, nobody has scored: a ranking is the only honest comparison left.
      meta = `Strength ${ordinal(hr)} v ${ordinal(ar)}`;
    } else {
      meta = 'Upcoming';
    }
  }

  return `<div class="game ${st}">
      ${side('home', g.homeName, g.homeId)}
      ${scoreCell('home', g.homeScore)}
      <div class="vs">–</div>
      ${bye ? '<div class="tscore away">—</div>' : scoreCell('away', g.awayScore)}
      ${bye ? '<div class="side away"><span class="tname muted">Bye</span></div>'
            : side('away', g.awayName, g.awayId)}
      <div class="${metaClass}"${metaTitle ? ` title="${esc(metaTitle)}"` : ''}>${meta}</div>
    </div>`;
}

// -------------------------------------------------------------------- results

const VIEW_LABEL = { played: 'Played games', upcoming: 'Upcoming games', all: 'All games' };

function renderResults() {
  const table = $('resultsTable');
  const tbody = table.querySelector('tbody');
  syncSegmented('resultsView', state.resultsView);

  const id = state.filterTeam === '' ? null : Number(state.filterTeam);
  const scoped = weekGames().filter((g) => id === null || g.homeId === id || g.awayId === id);

  // Without this the table is mostly blank rows: at week 2 of a 13-week season
  // it listed ten results followed by fifty-five rows of em dashes.
  const rows = scoped.filter((g) => {
    const st = gameState(g);
    if (state.resultsView === 'played') return st !== 'upcoming';
    if (state.resultsView === 'upcoming') return st === 'upcoming';
    return true;
  });

  const counts = {
    final: scoped.filter((g) => gameState(g) === 'final').length,
    live: scoped.filter((g) => gameState(g) === 'live').length,
    upcoming: scoped.filter((g) => gameState(g) === 'upcoming').length,
  };

  const sigma = scoringSpread().sigma;

  if (!rows.length) {
    const where = state.week === 'all' ? 'this league' : `week ${state.week}`;
    const hint =
      state.resultsView === 'played'
        ? `Nothing has been played in ${where} yet — try Upcoming.`
        : state.resultsView === 'upcoming'
          ? `Every game in ${where} has been played.`
          : `No games match that filter.`;
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">${hint}</td></tr>`;
  } else {
    tbody.innerHTML = rows.map((g) => resultRow(g, sigma)).join('');
  }

  // Keep whatever sort the user picked when the row set changes.
  resort(table);

  const parts = [];
  if (counts.final) parts.push(`${counts.final} final`);
  if (counts.live) parts.push(`${counts.live} in progress`);
  if (counts.upcoming) parts.push(`${counts.upcoming} upcoming`);

  const anyChance = rows.some(
    (g) => gameState(g) === 'upcoming' && homeWinChance(g, sigma) !== null
  );

  $('resultsNote').textContent =
    `${VIEW_LABEL[state.resultsView]} — ${rows.length} of ${scoped.length} in scope: ` +
    `${parts.join(', ') || 'nothing scheduled'}. Click any header to sort.` +
    (anyChance
      ? ` “Home win” is only filled in for games still to be played. ${derivedCaveat()}`
      : '');
}

const STATE_CELL = {
  final: '<td class="left muted" data-v="2">Final</td>',
  live: '<td class="left state-live" data-v="1">In progress</td>',
  upcoming: '<td class="left muted" data-v="0">Upcoming</td>',
};

function resultRow(g, sigma) {
  const st = gameState(g);
  const winner = winnerOf(g);

  // The win/lose classes are what makes the winner visible at all: they used to
  // be emitted here and only ever styled as `.side.win` on the cards, so every
  // row in this table rendered in the same colour.
  const nameCell = (which, name, extra) => {
    const cls = st !== 'final' || winner === 'tie' ? '' : winner === which ? 'win' : 'lose';
    return `<td class="${`${extra} ${cls}`.trim()}">${esc(name)}</td>`;
  };

  const score = (v) =>
    (st === 'final' || st === 'live') && typeof v === 'number' && v > 0 ? fmt(v) : dash;

  // Signed from the home team's point of view. The old absolute margin left the
  // Home, Away and Margin columns with no direction in them at all.
  const m = st === 'final' ? marginOf(g) : null;
  const marginCell = m === null ? `<td>${dash}</td>` : `<td data-v="${m}">${signed(m)}</td>`;

  // Only an undecided game has a chance attached to it; a played one has a
  // result, and printing a forecast beside it would invite reading the forecast
  // as a verdict on the result. `data-v` is omitted (never blanked) so the
  // unknowns sink whichever way the column is sorted.
  const p = st === 'upcoming' ? homeWinChance(g, sigma) : null;
  const chanceCell =
    p === null
      ? `<td>${dash}</td>`
      : `<td data-v="${p}" class="${p >= 0.6 ? 'pos' : p <= 0.4 ? 'neg' : 'muted'}">${pctText(p)}</td>`;

  return `<tr>
      <td data-v="${g.week}">${g.week}</td>
      ${nameCell('home', g.homeName, 'name')}
      <td>${score(g.homeScore)}</td>
      ${nameCell('away', g.awayName, 'left')}
      <td>${score(g.awayScore)}</td>
      ${marginCell}
      ${chanceCell}
      ${STATE_CELL[st]}
    </tr>`;
}

// ---------------------------------------------------------------- head to head

/**
 * record.get(a).get(b) is team a's {w, l, t} against team b.
 * Every completed game writes both directions at once, so the matrix is always
 * symmetric: a's win is b's loss.
 */
function headToHead() {
  const ids = state.data.teams.map((t) => t.id);
  const record = new Map(
    ids.map((a) => [a, new Map(ids.map((b) => [b, { w: 0, l: 0, t: 0 }]))])
  );

  for (const g of state.data.games) {
    if (gameState(g) !== 'final') continue;
    if (g.homeId == null || g.awayId == null) continue;      // bye
    if (!record.has(g.homeId) || !record.has(g.awayId)) continue;

    const home = record.get(g.homeId).get(g.awayId);
    const away = record.get(g.awayId).get(g.homeId);
    const winner = winnerOf(g);

    if (winner === 'tie') { home.t++; away.t++; }
    else if (winner === 'home') { home.w++; away.l++; }
    else { away.w++; home.l++; }
  }

  return record;
}

/** "a:b" -> the weeks those two teams meet, in order. */
function pairWeeks() {
  const map = new Map();
  const push = (a, b, g) => {
    const key = `${a}:${b}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(g);
  };
  for (const g of state.data.games) {
    if (g.homeId == null || g.awayId == null) continue;
    push(g.homeId, g.awayId, g);
    push(g.awayId, g.homeId, g);
  }
  for (const list of map.values()) list.sort((a, b) => a.week - b.week);
  return map;
}

/**
 * Records or fixtures?
 *
 * A records matrix needs a season behind it. At week 2 seventy of its ninety
 * comparative cells are empty, and even a finished season only has 25 of the 45
 * pairings meeting more than once. Early on, the same ten-by-ten grid answers a
 * question that actually has an answer: who does everyone still have to play?
 */
function h2hMode() {
  if (state.h2hView) return state.h2hView;
  const total = state.data.games.length;
  return total && finalGames().length / total >= 0.4 ? 'records' : 'schedule';
}

function renderH2H() {
  const teams = state.data.teams;
  const mode = h2hMode();
  syncSegmented('h2hView', mode);

  if (!teams.length) {
    $('h2hGrid').innerHTML = '<div class="empty">No teams to compare.</div>';
    $('h2hNote').textContent = '';
    return;
  }

  const cols = teams
    .map((t) => `<th data-sort title="${esc(t.name)}">${esc(shortName(t.name))}</th>`)
    .join('');

  const grid = mode === 'records' ? recordsGrid(teams, cols) : scheduleGrid(teams, cols);

  $('h2hTitle').textContent = mode === 'records' ? 'Head to head' : 'Who plays who';
  $('h2hNote').innerHTML = grid.note;

  // The header cells are team names, so they change with the data. Rebuilding
  // the whole table is fine here: this only runs on a full re-render, and
  // sortable.js is re-enabled on the fresh node below.
  $('h2hGrid').innerHTML =
    `<table class="h2h"><thead><tr>${grid.head}</tr></thead><tbody>${grid.body}</tbody></table>`;
  enableSort($('h2hGrid').querySelector('table'), grid.sort);
}

function recordsGrid(teams, cols) {
  const record = headToHead();

  const body = teams
    .map((row) => {
      let w = 0, l = 0, t = 0;
      const cells = teams
        .map((col) => {
          if (col.id === row.id) return '<td class="self">·</td>';
          const r = record.get(row.id).get(col.id);
          w += r.w; l += r.l; t += r.t;
          if (!r.w && !r.l && !r.t) return `<td>${dash}</td>`;
          const cls = r.w > r.l ? 'pos' : r.w < r.l ? 'neg' : 'muted';
          // Sort a column by how far ahead the row team is against that opponent.
          return `<td data-v="${r.w - r.l}" class="${cls}">${recordText(r)}</td>`;
        })
        .join('');

      // The overall record is the most important number in the row, so it gets
      // at least the colour the individual cells already had.
      const cls = w > l ? 'pos' : w < l ? 'neg' : 'muted';
      return `<tr>
          <td class="name">${esc(row.name)}</td>
          <td data-v="${w - l}" class="${cls}">${recordText({ w, l, t })}</td>
          ${cells}
        </tr>`;
    })
    .join('');

  return {
    head: '<th class="name" data-sort>Team</th><th data-sort>Overall</th>' + cols,
    body,
    sort: { defaultIndex: 1 },
    note:
      'Each row is a team, each column an opponent: the cell is that row team&rsquo;s ' +
      'record <em>against</em> that opponent. Green means a winning record, red a ' +
      'losing one. Blank means they haven&rsquo;t met yet. Click a header to sort ' +
      'by win differential in that column.',
  };
}

function scheduleGrid(teams, cols) {
  const pairs = pairWeeks();
  const week = state.week === 'all' ? null : Number(state.week);

  const body = teams
    .map((row) => {
      const cells = teams
        .map((col) => {
          if (col.id === row.id) return '<td class="self">·</td>';
          const games = pairs.get(`${row.id}:${col.id}`) || [];
          if (!games.length) return `<td>${dash}</td>`;

          const weeks = games.map((g) => g.week);
          const next = games.find((g) => gameState(g) !== 'final');

          // Two teams can meet twice, and one of those meetings is often
          // already played, so the state belongs on the week number rather
          // than on the cell.
          // The selected week wins over "already played": finding this week's
          // fixture in the grid is the reason to look at it.
          const label = games
            .map((g) => {
              const cls = g.week === week ? 'now' : gameState(g) === 'final' ? 'done' : '';
              return cls ? `<span class="${cls}">${g.week}</span>` : String(g.week);
            })
            .join(', ');

          // Sorting a column puts the teams who play that opponent soonest
          // first, which is the only ordering a fixture list can usefully have.
          const sortKey = next ? next.week : weeks[weeks.length - 1];
          return `<td data-v="${sortKey}" class="${next ? '' : 'done'}" ` +
            `title="${esc(row.name)} v ${esc(col.name)} — week ${weeks.join(', week ')}">` +
            `${label}</td>`;
        })
        .join('');

      return `<tr><td class="name">${esc(row.name)}</td>${cells}</tr>`;
    })
    .join('');

  return {
    head: '<th class="name" data-sort>Team</th>' + cols,
    body,
    sort: { defaultIndex: 0, defaultAsc: true },
    note:
      'Each cell is the week that row team plays that opponent — the whole season ' +
      'of fixtures at once. Dimmed weeks are already played; the week you have ' +
      'selected above is highlighted. Records take over from fixtures here once ' +
      'about 40% of the season has been played, or switch now with the buttons above.',
  };
}

// -------------------------------------------------------------------- forecast
//
// Four questions in one panel: what is my next matchup, what are the ones after
// it, what are my chances in each, and how many games am I likely to win.
//
// THE WIN CHANCE IS NOT ESPN'S. ESPN publishes projections; it publishes no win
// probability through any endpoint a page like this can read. Every percentage
// on this page is derived by forecast.js from two projected totals and the
// spread this league's scores have shown around their projections, and every
// panel that prints one carries derivedCaveat() saying exactly that.

/**
 * The week the forecast is made from: the first one still open.
 *
 * The demo season is 100% played, so on live data this is simply the next
 * unplayed week, and in the demo it is whichever week the picker is on. That
 * makes the demo a backtest — the identical code path, run against real
 * projections, with the real results sitting underneath it.
 */
function forecastAsOf() {
  const d = state.data;
  if (!d || !d.weeks.length) return 0;
  // Replaying: the week is a recorded fact, not something to re-derive. Reading
  // it back off the stored games would agree on live data and quietly disagree
  // on demo, where "as of" follows the week picker rather than the results.
  if (state.replay) return state.replay.week;
  if (d.isDemo) return state.week === 'all' ? d.weeks[0] : Number(state.week);
  const open = d.weeks.filter((w) =>
    (d.byWeek.get(w) || []).some((g) => gameState(g) !== 'final')
  );
  return open.length ? open[0] : d.weeks[d.weeks.length - 1] + 1;
}

/** Is this game still ahead of the point the forecast is made from? */
function isRemaining(g, asOf) {
  return state.data.isDemo ? g.week >= asOf : gameState(g) !== 'final';
}

/**
 * The per-team scoring spread, and whether it was measured or assumed.
 *
 * Only banked games feed it: a forecast may not learn from the results it is
 * being asked to forecast. On live data early in the season there is usually
 * nothing to learn from at all — ESPN's matchup payload carries no projections
 * — so this falls back to forecast.js's default, and says which it did.
 */
function scoringSpread() {
  // Sigma is LEARNED FROM RESULTS, so it moves as the season goes on. Replaying
  // week 3 with the spread measured in week 12 would re-forecast the past with
  // knowledge it did not have — a subtler version of the same mistake as
  // showing today's projections against an old schedule. Every snapshot carries
  // the figure that was in force when it was taken.
  if (state.replay && typeof state.replay.sigma === 'number') {
    return {
      sigma: state.replay.sigma,
      calibrated: Boolean(state.replay.sigmaCalibrated),
      sample: state.replay.sigmaSample || 0,
    };
  }
  const asOf = forecastAsOf();
  const games = (state.data?.games || [])
    .filter((g) => gameState(g) === 'final' && !isRemaining(g, asOf))
    .map((g) => ({
      homeActual: g.homeScore,
      homeProjected: g.homeProjected,
      awayActual: g.awayScore,
      awayProjected: g.awayProjected,
    }));
  return forecast.calibrateSigma(games);
}

/** The sentence that stops a derived number being read as ESPN's own. */
function derivedCaveat() {
  const { sigma, calibrated, sample } = scoringSpread();
  const basis = calibrated
    ? `, measured from ${plural(sample, 'completed team-week')} in this league.`
    : ` — assumed, because ${
        sample
          ? `only ${plural(sample, 'completed team-week')} carries`
          : 'no completed game here carries'
      } a projection to measure it from.`;
  return (
    'Win chances are worked out here, not published by ESPN: ESPN gives projections, ' +
    `never odds. Each one is the projected gap read against a ${fmt(sigma)}-point ` +
    `per-team scoring spread${basis}`
  );
}

/** Where the projected team totals came from, and what they cannot know. */
function projectionCaveat(lastWeek) {
  if (!state.projection) {
    return state.data.isDemo
      ? 'Team totals are the projections ESPN carried for those games at the time.'
      : '';
  }
  return (
    'Team totals are ESPN’s own projection for that week — the same number the ESPN ' +
    'site shows under a lineup paged forward to it — with the best legal lineup filled ' +
    'rather than the one currently set, so a bench player projected above a starter is ' +
    'counted as starting. Players on bye are projected zero by ESPN, so they sit down on ' +
    'their own. It is still a snapshot of the rosters as they stand today: the week ' +
    `${lastWeek} line is the squad owned now, not the one that will be owned then.`
  );
}

/**
 * The team the forecast is about.
 *
 * An explicit pick wins. Otherwise it follows whoever you are, so the panel
 * opens on your own season without being asked and moves with you if you set
 * yourself later — but stays put once you have deliberately looked at someone
 * else. Falling back to the first team rather than nothing matters: every
 * team's projection is already computed, so there is no reason to show an
 * empty panel just because nobody has said who they are.
 */
function forecastTeam() {
  const d = state.data;
  if (!d || !d.teams.length) return null;
  const picked = d.teams.find((t) => t.id === state.forecastTeamId);
  if (picked) return picked;
  const mine = d.teams.find((t) => t.id === state.myTeamId);
  return mine || d.teams[0];
}

/** Fill the "Forecast for" menu, marking which one is you. */
function renderForecastPicker() {
  const sel = $('forecastTeam');
  const current = forecastTeam();
  sel.innerHTML = (state.data?.teams || [])
    .map(
      (t) =>
        `<option value="${t.id}"${t.id === current?.id ? ' selected' : ''}>` +
        `${esc(t.name)}${t.id === state.myTeamId ? ' (you)' : ''}</option>`
    )
    .join('');
  if (current) sel.value = String(current.id);
}

/** One team's games, split into what is banked and what is still ahead. */
function forecastGames(teamId, asOf) {
  const remaining = [];
  const banked = { w: 0, l: 0, t: 0 };

  for (const g of state.data.games) {
    if (g.homeId == null || g.awayId == null) continue;      // bye: no opponent
    const mineHome = g.homeId === teamId;
    if (!mineHome && g.awayId !== teamId) continue;

    if (isRemaining(g, asOf)) {
      remaining.push({
        g,
        mineHome,
        oppName: mineHome ? g.awayName : g.homeName,
        mine: projectedPoints(g, mineHome ? 'home' : 'away'),
        theirs: projectedPoints(g, mineHome ? 'away' : 'home'),
      });
      continue;
    }

    const winner = winnerOf(g);
    if (winner === null) continue;                            // in progress
    if (winner === 'tie') banked.t++;
    else if ((winner === 'home') === mineHome) banked.w++;
    else banked.l++;
  }

  remaining.sort((a, b) => a.g.week - b.g.week);
  return { remaining, banked };
}

function renderForecast() {
  const d = state.data;
  if (!d) return;

  const table = $('forecastTable');
  const tbody = table.querySelector('tbody');
  const stats = $('forecastStats');
  const chart = $('forecastChart');
  const team = forecastTeam();
  const isMine = Boolean(team) && team.id === state.myTeamId;

  renderForecastPicker();
  // The picker names the team too, but a heading that reads "Season forecast"
  // alone loses the one word you scan for when flicking between teams.
  $('forecastTitle').textContent = team
    ? `${isMine ? 'My season' : 'Season forecast'} — ${team.name}`
    : 'Season forecast';

  // The two point columns are "You"/"Them" only when it really is you.
  $('thForecastMine').textContent = isMine ? 'You' : 'Them';
  $('thForecastTheirs').textContent = isMine ? 'Them' : 'Opp';

  const blank = (reason, note) => {
    stats.innerHTML = '';
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${reason}</td></tr>`;
    chart.innerHTML = '';
    $('forecastNote').innerHTML = note;
    resort(table);
  };

  if (!team) {
    blank(
      'No teams in this league yet, so there is no season to forecast.',
      'This panel lists every matchup a team has left, a win chance for each, and the ' +
      'spread of season win totals they add up to.'
    );
    return;
  }

  const asOf = forecastAsOf();
  const { remaining, banked } = forecastGames(team.id, asOf);

  if (!remaining.length) {
    blank(
      d.isDemo
        ? `Week ${asOf} is the last week of the demo season, and it is already played, ` +
          'so there is nothing left to forecast. Step the week picker back to forecast ' +
          'from an earlier point in the season.'
        : 'Every game on this schedule has been decided, so there is nothing left to forecast.',
      `Final record ${recordText(banked)}.`
    );
    return;
  }

  const sigma = scoringSpread().sigma;

  const rows = remaining.map((r) => ({
    ...r,
    p:
      r.mine !== null && r.theirs !== null
        ? forecast.winProbability(r.mine, r.theirs, sigma)
        : null,
  }));

  const probs = rows.map((r) => r.p).filter((p) => Number.isFinite(p));
  const missing = rows.length - probs.length;
  const nextWeek = rows[0].g.week;
  const lastWeek = rows[rows.length - 1].g.week;

  // Banked wins alone are not a forecast. Printing them as "expected wins" with
  // an 80% range of exactly themselves would report certainty about a season
  // with games left in it.
  if (!probs.length) {
    // state.strengthNote is empty only while the roster read is still in
    // flight, so this can tell "not yet" from "not going to happen" instead of
    // reporting a failure that has not occurred.
    const pending = !d.isDemo && !state.strengthNote;
    blank(
      pending
        ? 'Working out what every roster is projected to score…'
        : `${plural(rows.length, 'game')} left to play, but no projection to put against ` +
          'any of them, so there is nothing to forecast from.',
      pending
        ? 'Reading this week’s rosters from ESPN.'
        : `${recordText(banked)} so far. ` +
          (d.isDemo
            ? 'These games carry no projections, so there is nothing to forecast from.'
            : 'ESPN’s matchup feed carries no projected scores, and this league’s rosters ' +
              'could not be read, which is where the projections would otherwise come from. ' +
              'Reload the page to try the roster read again.')
    );
    return;
  }

  // data-v is omitted, never blanked, so a missing projection sinks to the
  // bottom whichever way the column is sorted.
  const pts = (v) => (v === null ? `<td>${dash}</td>` : `<td data-v="${v}">${fmt(v)}</td>`);

  tbody.innerHTML = rows
    .map((r) => {
      const w = r.g.week;
      const gap = r.mine !== null && r.theirs !== null ? round1(r.mine - r.theirs) : null;
      const chance =
        r.p === null
          ? `<td>${dash}</td>`
          : `<td data-v="${r.p}" class="${r.p >= 0.6 ? 'pos' : r.p <= 0.4 ? 'neg' : 'muted'}" ` +
            `title="A projected ${signed(gap)} against ${esc(r.oppName)}, read against a ` +
            `${fmt(sigma)}-point scoring spread.">${pctText(r.p)}</td>`;

      return `<tr${w === nextWeek ? ' class="now"' : ''}>
          <td data-v="${w}">${w}</td>
          <td class="name">${esc(r.oppName)}</td>
          <td class="left muted" data-v="${r.mineHome ? 1 : 0}">${r.mineHome ? 'Home' : 'Away'}</td>
          ${pts(r.mine)}
          ${pts(r.theirs)}
          ${chance}
        </tr>`;
    })
    .join('');
  resort(table);

  const dist = forecast.winTotalDistribution(probs, banked.w);
  const range = forecast.credibleRange(dist, 0.8);
  const expected = forecast.expectedWins(probs, banked.w);

  stats.innerHTML = [
    ['Banked', recordText(banked)],
    ['Games left', String(rows.length)],
    ['Expected wins', fmt(expected)],
    ['80% range', range ? (range.lo === range.hi ? `${range.lo}` : `${range.lo}${EN}${range.hi}`) : '—'],
  ]
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');

  // Percentages, not 0..1 probabilities: the y-axis tick formatter prints one
  // decimal place, so a 0..1 axis renders as 0, 0.1, 0.2 and reads as broken.
  histogram(chart, {
    bins: dist.map((x) => String(x.wins)),
    counts: dist.map((x) => x.p * 100),
    yLabel: 'Chance (%)',
    height: 240,
  });

  const played = banked.w + banked.l + banked.t;
  const timing = d.isDemo
    ? `The demo season is already complete, so this is the forecast as it stood before ` +
      `week ${asOf} was played — the same model, run where the results can be checked against it.`
    : 'Weeks already decided are banked; everything still open is forecast.';

  const shape = range
    ? `Each bar is a final win total and its height is the chance of finishing on exactly ` +
      `that many. ${range.lo === range.hi ? `${range.lo} wins alone holds` : `The ${range.lo}${EN}${range.hi} band holds`} ` +
      `${pctText(range.p)} of it, which is how wide the honest answer is.`
    : '';

  const gaps = missing
    ? `${plural(missing, 'game')} ${missing === 1 ? 'has' : 'have'} no projection on one ` +
      'side, so they are listed but left out of the chart and the expected total.'
    : '';

  $('forecastNote').innerHTML = [
    `${esc(team.name)} — ${plural(played, 'game')} banked at ${recordText(banked)}, ` +
      `${plural(rows.length, 'game')} from week ${nextWeek} to week ${lastWeek} still to play. ${timing}` +
      // Only explain whose season this is when nobody has said who YOU are.
      // Once you have, picking another team is a deliberate act and needs no
      // apology for itself.
      (isMine || state.myTeamId != null
        ? ''
        : ' Nobody is set as you, so this opens on the first team — set yourself in the ' +
          '“You are” menu in the connection bar, or pick any team above.'),
    shape,
    derivedCaveat(),
    projectionCaveat(lastWeek),
    gaps,
  ]
    .filter(Boolean)
    .join('<br>');
}

// ------------------------------------------------------------ season simulation
//
// The forecast panel answers "how many games will this team win", which has an
// exact answer: the remaining games are independent coin flips, so the win
// total is a Poisson-binomial and forecast.js convolves it.
//
// WHERE YOU FINISH has no such answer. A placing depends on the joint outcome
// of every game in the league at once — a rival losing moves you up without you
// playing — and then on the tiebreak, which is total points scored. So this
// panel plays the rest of the season out many times and counts. Everything in
// it is a count, and the note says so; none of it is solved for.
//
// It is the same model as the win percentages above, drawing each score as its
// projection plus normal noise of the same sigma, so the two panels agree by
// construction rather than by luck. The consistency that matters: a team's
// simulated Proj. wins must land on the forecast panel's Expected wins.

/** 10000 -> "10,000". A run count is a quantity, so it gets separators. */
const commas = (n) => Number(n).toLocaleString('en-US');

/**
 * Everything simulateSeason needs, plus a key that changes exactly when the
 * answer would.
 *
 * WHAT INVALIDATES THE CACHED RUN: the run count, the as-of week, the scoring
 * spread, the set of teams, each team's banked wins and points, and every
 * remaining game's two projections. All of those are in the key. Nothing else
 * is — in particular NOT which team the picker is on, because that changes
 * nothing about the season being simulated, only which row's distribution gets
 * drawn. Re-running for that would burn half a second to redraw one chart.
 *
 * Banked results are split from remaining ones with isRemaining(), the same
 * rule the forecast panel uses, rather than with the season-to-date split in
 * standingsRows(). On live data the two are identical (isRemaining is exactly
 * "not final"). In the demo, whose season is complete, they are not: the week
 * picker chooses the point in time both panels forecast from, and a simulation
 * that banked results the forecast above had not seen yet would contradict it.
 */
function simInputs() {
  const d = state.data;
  if (!d || !d.teams.length) return null;

  const asOf = forecastAsOf();
  const teamIds = d.teams.map((t) => t.id);
  const banked = new Map(teamIds.map((id) => [id, { wins: 0, pointsFor: 0 }]));
  const games = [];
  let playable = 0;

  for (const g of d.games) {
    if (g.homeId == null || g.awayId == null) continue;        // bye: nothing to play out
    if (!banked.has(g.homeId) || !banked.has(g.awayId)) continue;

    if (isRemaining(g, asOf)) {
      // The same projectedPoints() the cards, the results table and the
      // forecast table read, so a game cannot be worth one thing here and
      // another thing four panels up.
      const homeProj = projectedPoints(g, 'home');
      const awayProj = projectedPoints(g, 'away');
      if (homeProj !== null && awayProj !== null) playable++;
      games.push({ homeId: g.homeId, awayId: g.awayId, homeProj, awayProj });
      continue;
    }

    // A game in progress is neither banked nor played out: half a scoreline is
    // not a result, and winnerOf() returns null for it.
    const winner = winnerOf(g);
    if (winner === null) continue;

    const h = banked.get(g.homeId);
    const a = banked.get(g.awayId);
    if (typeof g.homeScore === 'number') h.pointsFor += g.homeScore;
    if (typeof g.awayScore === 'number') a.pointsFor += g.awayScore;
    if (winner === 'tie') { h.wins += 0.5; a.wins += 0.5; }
    else if (winner === 'home') h.wins += 1;
    else a.wins += 1;
  }

  const sigma = scoringSpread().sigma;

  const key = JSON.stringify([
    state.runs,
    asOf,
    Math.round(sigma * 1000),
    teamIds,
    [...banked].map(([id, b]) => [id, b.wins, Math.round(b.pointsFor * 10)]),
    games.map((g) => [g.homeId, g.awayId, g.homeProj, g.awayProj]),
  ]);

  return { teamIds, banked, games, sigma, asOf, playable, key };
}

/** Mark the run-count button that matches the current setting. */
function syncRuns() {
  $('simRuns')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', Number(b.dataset.runs) === state.runs));
}

/**
 * Run the simulation off the critical path.
 *
 * 50,000 runs is well over half a second of straight-line arithmetic, and doing
 * it inline would freeze the page with the "Simulating…" state never painted —
 * the one frame that exists to say the wait is deliberate. rAF fires BEFORE the
 * next paint, so it alone would not help; the setTimeout inside it is what
 * lands the work in a fresh task after the browser has drawn.
 *
 * The token is the same guard refreshStrength() uses: a run that finishes after
 * the data underneath it changed is thrown away rather than published.
 */
function runSimulation(inputs) {
  const token = ++state.simToken;
  const later = (fn) => setTimeout(fn, 0);
  const kick = typeof requestAnimationFrame === 'function'
    ? (fn) => requestAnimationFrame(() => later(fn))
    : later;

  kick(() => {
    if (token !== state.simToken || !state.data) return;
    const result = forecast.simulateSeason({
      teamIds: inputs.teamIds,
      banked: inputs.banked,
      games: inputs.games,
      sigma: inputs.sigma,
      runs: state.runs,
      seed: SIM_SEED,
    });
    if (token !== state.simToken || !state.data) return;
    // Cached even when null, so a league the model cannot handle is reported
    // once instead of being retried on every repaint.
    state.sim = { key: inputs.key, result };
    renderSimulation();
  });
}

function renderSimulation() {
  const d = state.data;
  if (!d) return;

  const table = $('simTable');
  const tbody = table.querySelector('tbody');

  syncRuns();

  const blank = (reason, note) => {
    $('simStats').innerHTML = '';
    $('simCap').textContent = '';
    $('simChart').innerHTML = '';
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6">${reason}</td></tr>`;
    $('simNote').innerHTML = note;
    resort(table);
  };

  const inputs = simInputs();
  if (!inputs) {
    blank(
      'No teams in this league yet, so there is no season to simulate.',
      'This panel plays the rest of the season out thousands of times and counts where ' +
      'everyone finishes.'
    );
    return;
  }

  if (!inputs.games.length) {
    blank(
      d.isDemo
        ? `Week ${inputs.asOf} is the last week of the demo season and it is already ` +
          'played, so there is no season left to simulate. Step the week picker back to ' +
          'simulate from an earlier point.'
        : 'Every game on this schedule has been decided, so the table above is the final ' +
          'one — there is nothing left to simulate.',
      'A finished season has a result, not a distribution.'
    );
    return;
  }

  // Three distinct states, because "not yet" and "not going to happen" deserve
  // different sentences. state.strengthNote is empty only while the roster read
  // is still in flight.
  if (!inputs.playable) {
    const pending = !d.isDemo && !state.strengthNote;
    blank(
      pending
        ? 'Working out what every roster is projected to score…'
        : `${plural(inputs.games.length, 'game')} left to play, but no projection to put ` +
          'against any of them, so there is no season to play out.',
      pending
        ? 'Reading this league’s rosters from ESPN. The simulation needs a projected score ' +
          'for both sides of every remaining game.'
        : d.isDemo
          ? 'These games carry no projections, so there is nothing to simulate from.'
          : 'ESPN’s matchup feed carries no projected scores, and this league’s rosters ' +
            'could not be read, which is where the projections would otherwise come from. ' +
            'Reload the page to try the roster read again.'
    );
    return;
  }

  // The cache. A miss shows the waiting state and hands off; the run repaints
  // through here on the way back, and hits.
  if (!state.sim || state.sim.key !== inputs.key) {
    blank(
      `Simulating ${commas(state.runs)} seasons…`,
      `Playing the ${plural(inputs.playable, 'remaining game')} out ` +
      `${commas(state.runs)} times and counting where everyone finishes.`
    );
    runSimulation(inputs);
    return;
  }

  const sim = state.sim.result;
  if (!sim) {
    blank(
      'This season could not be simulated.',
      'The model needs at least one team and a positive scoring spread, and this league ' +
      'gave neither.'
    );
    return;
  }

  paintSimulation(sim, inputs);
}

function paintSimulation(sim, inputs) {
  const d = state.data;
  const table = $('simTable');
  const tbody = table.querySelector('tbody');
  const nameById = new Map(d.teams.map((t) => [t.id, t.name]));
  const team = forecastTeam();
  const mine = team ? sim.teams.find((t) => t.teamId === team.id) : null;

  // ---- headline: who wins it, who props it up, and where you stand ---------
  const who = (id) => `<div class="who">${esc(nameById.get(id) || `Team ${id}`)}</div>`;
  const stat = (k, v, id) =>
    `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${id == null ? '' : who(id)}</div>`;

  $('simStats').innerHTML = [
    stat('Wins the season most', pctText(sim.champion.pFirst), sim.champion.teamId),
    stat('Finishes last most', pctText(sim.wooden.pLast), sim.wooden.teamId),
    mine ? stat('Title chance', pctText(mine.pFirst), mine.teamId) : '',
    mine ? stat('Last-place chance', pctText(mine.pLast), mine.teamId) : '',
  ]
    .filter(Boolean)
    .join('');

  // ---- the selected team's own place distribution -------------------------
  const chart = $('simChart');
  if (mine) {
    $('simCap').innerHTML =
      `Where <strong>${esc(team.name)}</strong> finished across ${commas(sim.runs)} simulated ` +
      `seasons. Most likely ${ordinal(mine.modePlace)}, averaging ${fmt(mine.meanPlace)}.`;
    // Percentages, not 0..1 probabilities: the y-axis tick formatter prints one
    // decimal place, so a 0..1 axis renders as 0, 0.1, 0.2 and reads as broken.
    histogram(chart, {
      bins: mine.places.map((_, i) => ordinal(i + 1)),
      counts: mine.places.map((p) => p * 100),
      yLabel: 'Chance (%)',
      height: 240,
    });
  } else {
    $('simCap').textContent = '';
    chart.innerHTML = '';
  }

  // ---- the projected final table ------------------------------------------
  // Emitted in average-place order so the default view is already the answer
  // to "what is the most likely finishing order", before anyone clicks a header.
  tbody.innerHTML = sim.byMean
    .map((t) => {
      const isMe = t.teamId === state.myTeamId;
      const isPicked = Boolean(team) && t.teamId === team.id;
      const cls = [isMe ? 'me' : '', isPicked ? 'picked' : ''].filter(Boolean).join(' ');
      const tone = (p) => (p >= 0.25 ? 'pos' : p <= 0.02 ? 'muted' : '');

      return `<tr${cls ? ` class="${cls}"` : ''}>
          <td class="name">${esc(nameById.get(t.teamId) || `Team ${t.teamId}`)}</td>
          <td data-v="${t.meanWins}">${fmt(t.meanWins)}</td>
          <td data-v="${t.meanPlace}">${fmt(t.meanPlace)}</td>
          <td data-v="${t.modePlace}">${ordinal(t.modePlace)}</td>
          <td data-v="${t.pFirst}" class="${tone(t.pFirst)}">${pctText(t.pFirst)}</td>
          <td data-v="${t.pLast}" class="${t.pLast >= 0.25 ? 'neg' : t.pLast <= 0.02 ? 'muted' : ''}">${pctText(t.pLast)}</td>
        </tr>`;
    })
    .join('');
  resort(table);

  // ---- what this is, and what it is not -----------------------------------
  const lastWeek = d.weeks[d.weeks.length - 1];

  // Two standard errors at the worst case (p = 0.5): 100/sqrt(runs) points.
  // Quoting it stops two teams a point apart being read as ranked.
  const noise = 100 / Math.sqrt(sim.runs);

  const timing = d.isDemo
    ? `The demo season is already complete, so this simulates it forward from week ` +
      `${inputs.asOf} — the same as-of point the forecast panel above uses, so the two ` +
      `always agree. Step the week picker to move it.`
    : 'Weeks already decided are banked exactly as they stand; everything still open is ' +
      'simulated. Same as-of point as the forecast panel above.';

  const gaps = sim.skipped
    ? `${plural(sim.skipped, 'remaining game')} ${sim.skipped === 1 ? 'has' : 'have'} no ` +
      'projection on one side, so ' + (sim.skipped === 1 ? 'it was' : 'they were') +
      ' left out of every simulated season. Those wins are missing from every number here.'
    : '';

  $('simNote').innerHTML = [
    `Every number in this panel is counted from a simulation, not solved for: the ` +
      `${plural(sim.games, 'game')} still to play ${sim.games === 1 ? 'was' : 'were'} played ` +
      `out ${commas(sim.runs)} times and the finishing order counted. There is no closed ` +
      `form for a final placing — where you finish turns on everyone else’s results as much ` +
      `as your own. “Wins the season” here means finishing first in the regular-season ` +
      `standings after week ${lastWeek}; no playoffs are modelled, so it is not the same ` +
      `question as who lifts the trophy.`,
    timing,
    `Each simulated season is ranked on wins first and total points scored second — this ` +
      `league’s own tiebreak — which is why points are simulated as well as results. The run ` +
      `is seeded, so the same inputs always give the same numbers.`,
    `Counting noise: at ${commas(sim.runs)} runs a percentage here is good to roughly ` +
      `±${fmt(noise)} points, so gaps narrower than that are not real. Raise the run count ` +
      `to shrink it.`,
    derivedCaveat(),
    projectionCaveat(lastWeek),
    gaps,
  ]
    .filter(Boolean)
    .join('<br>');
}

// ----------------------------------------------------------------- interaction

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  state.source = btn.dataset.src;
  prefs.set('source', state.source);   // so the page comes back the way you left it
  // Team ids mean different things in the two leagues -- demo counts from 1,
  // ESPN uses its own -- so a remembered pick would silently land on a
  // stranger. Forget it and fall back to following whoever you are.
  state.forecastTeamId = null;
  prefs.set('forecastTeam', null);
  syncSource();
  state.source === 'demo' ? loadDemo() : loadLive();
});

// ---------------------------------------------------------- archive controls

$('asOfSelect').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v === 'live') leaveReplay();
  else replaySnapshot(Number(v));
});

$('snapSave').addEventListener('click', () => {
  const id = archiveId();
  if (!id) {
    state.snapMsg = 'Connect a league first.';
    state.snapErr = true;
    renderArchive();
    return;
  }
  const snap = captureNow();
  if (!snap) {
    state.snapMsg = 'There is nothing on screen to record yet.';
    state.snapErr = true;
    renderArchive();
    return;
  }
  const had = snapshots.get(id.leagueId, id.season, snap.week);
  const res = snapshots.save(snap);
  state.snapErr = !res.ok;
  state.snapMsg = res.ok
    ? `${had ? 'Replaced' : 'Saved'} the reading for week ${snap.week}` +
      (state.projection ? '.' : ' — but ESPN’s per-week projections are not in it yet, so it has no forecast.')
    : res.reason;
  renderArchive();
});

$('snapDelete').addEventListener('click', () => {
  const id = archiveId();
  if (!id || !state.replay) return;
  const week = state.replay.week;
  snapshots.remove(id.leagueId, id.season, week);
  leaveReplay();
  state.snapMsg = `Deleted the reading for week ${week}.`;
  state.snapErr = false;
  renderArchive();
});

$('snapExport').addEventListener('click', () => {
  const id = archiveId();
  if (!id) return;
  const file = snapshots.exportAll(id.leagueId, id.season);
  if (!file.count) {
    state.snapMsg = 'There is nothing in the archive to export yet.';
    state.snapErr = true;
    renderArchive();
    return;
  }
  try {
    const blob = new Blob([file.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on a timer rather than immediately: some browsers have not
    // started reading the blob by the time click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    state.snapMsg = `Exported ${plural(file.count, 'week')} to ${file.name}. Keep it somewhere that is not this browser.`;
    state.snapErr = false;
  } catch (err) {
    state.snapMsg = `Could not export: ${err.message}`;
    state.snapErr = true;
  }
  renderArchive();
});

$('snapImport').addEventListener('click', () => $('snapFile').click());

$('snapFile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';   // so choosing the same file twice fires again
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch (err) {
    state.snapMsg = `Could not read that file: ${err.message}`;
    state.snapErr = true;
    renderArchive();
    return;
  }

  const { snapshots: found, error } = snapshots.parseImport(text);
  if (error) {
    state.snapMsg = error;
    state.snapErr = true;
    renderArchive();
    return;
  }
  const res = snapshots.importAll(found);
  state.snapErr = res.failed.length > 0;
  state.snapMsg =
    `Imported ${plural(res.added, 'week')}` +
    (res.kept ? `, kept ${res.kept} already here` : '') +
    (res.failed.length ? ` — ${res.failed.join('; ')}` : '.');
  renderArchive();
});

/** The week picker drives the whole page, so changing it re-renders the page. */
function setWeek(value) {
  state.week = value === 'all' ? 'all' : Number(value);
  prefs.set('week', state.week);
  render();
}

$('weekSelect').addEventListener('change', (e) => setWeek(e.target.value));

// Every team's projection is already built, so switching whose season this is
// costs nothing and repaints only this panel.
$('forecastTeam').addEventListener('change', (e) => {
  const id = Number(e.target.value);
  state.forecastTeamId = Number.isFinite(id) ? id : null;
  prefs.set('forecastTeam', state.forecastTeamId);
  renderForecast();
  // The simulation panel follows the same pick. Nothing about the season being
  // simulated changed, so this hits the cache and only redraws the chart, the
  // two "your chances" stats and the row highlight.
  renderSimulation();
});

$('simRuns').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-runs]');
  if (!btn) return;
  const runs = SIM_RUN_CHOICE(btn.dataset.runs);
  if (runs === state.runs) return;
  state.runs = runs;
  prefs.set('runs', runs);
  renderSimulation();   // the run count IS in the cache key, so this re-runs
});

// Walking the season one week at a time used to mean thirteen trips through a
// dropdown.
function stepWeek(delta) {
  const weeks = state.data?.weeks || [];
  if (!weeks.length) return;
  if (state.week === 'all') {
    setWeek(delta > 0 ? weeks[0] : weeks[weeks.length - 1]);
    return;
  }
  const i = weeks.indexOf(Number(state.week));
  const next = weeks[i + delta];
  if (next !== undefined) setWeek(next);
}

$('weekPrev').addEventListener('click', () => stepWeek(-1));
$('weekNext').addEventListener('click', () => stepWeek(1));

$('resultsView').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  state.resultsView = btn.dataset.view;
  prefs.set('results', state.resultsView);
  renderResults();
});

$('h2hView').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (!btn) return;
  state.h2hView = btn.dataset.view;
  prefs.set('h2h', state.h2hView);
  renderH2H();
});

$('filterTeam').addEventListener('change', (e) => {
  state.filterTeam = e.target.value;
  renderResults();
});

// Sorted by week, ascending, until the user says otherwise.
enableSort($('resultsTable'), { defaultIndex: 0, defaultAsc: true });
// Standings open on the standings order: most wins first.
enableSort($('standingsTable'), { defaultIndex: 1 });
// The forecast reads forwards in time, so it opens in week order.
enableSort($('forecastTable'), { defaultIndex: 0, defaultAsc: true });
// The projected table opens on the most likely finishing order: average place,
// lowest first. That IS the ranking the panel exists to give.
enableSort($('simTable'), { defaultIndex: 2, defaultAsc: true });

/**
 * Go live on our own when the connection bar finds a league, so the page shows
 * real data without a second click — unless the user has parked it on demo.
 */
onConnection((conn) => {
  if (!conn) return;
  if (state.source === 'live') {
    // Already live: this is a team change. The highlight moves — and so does
    // the whole forecast, which is the one panel that is entirely about whose
    // season it is.
    state.myTeamId = conn.teamId ?? null;
    if (state.data) {
      renderStandings();
      renderForecast();
      renderSimulation();   // moves the "you" highlight and the selected team with it
    }
    return;
  }
  if (prefs.get('source') === 'demo') return;
  state.source = 'live';
  syncSource();
  loadLive();
});

syncSource();
if (state.source === 'live' && savedConfig()) loadLive();
else { state.source = 'demo'; loadDemo(); }
