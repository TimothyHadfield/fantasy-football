// THE PLAYOFFS PAGE'S PLAYER LIST (Tim, 2026-10-16).
//
// "There will also be a list of players (taken or available) with their
// current avg, their future proj, and their playoff proj avg in collumns as
// well as their proj each week they play in the playoffs. Also show which user
// they currently belong to (just the user's first name). Also show some
// derived columns: (playoff proj avg) - (current avg). Include weeks that the
// player is proj 0 (either BYE or injured) in the avg calculations. And of
// course show the user's position aswell. This whole player display should look
// extreamly similar to the charts in the regular player's section without the
// regular season weeks and a few added columns."
//
// So this is the Players page's Taken table (js/waivers-page.js, waivers.html)
// with the regular-season week columns taken out and three averages put in:
//
//   Player · Pos · Tm · Owner · Avg · Future · Playoff · PO − Avg · PO − Fut · one column
//   per playoff week.
//
// THE DATA is the Players page's own reads, and no more of them: every week
// from the current one through the last playoff week, each week's rosters
// (`season.fetchWeeksRosters`) and each week's wire (`season.fetchWireWeek`,
// the same 100 most-owned free agents). That is exactly what the Players page
// buys on "Rest of season", through the same season.js calls — so the store,
// the phone's synced copy (rule 20: no ESPN request there) and the bye rule
// (`espn.byeAdjustedProjection`, applied inside season.js) all come with them.
// With no league connected it is the sample league (js/demo-rosters.js),
// which costs nothing.
//
// One export: `mountPlayoffPlayers(host)`. It never throws; a failure is the
// site's usual short red line inside `host`.

import * as season from './season.js';
import * as espn from './espn.js';
import { savedConfig, onConnection } from './connection.js';
// The ONE definition of the playoff weeks (the league's last regular week plus
// one per round), shared with the Players and Schedule pages.
import { playoffWeeks as leaguePlayoffWeeks } from './capture.js';
import { heatScale, heatOf, heatMarkHtml } from './heat.js';
import { enableSort, resort } from './sortable.js';
// The site's one zero rule — a 0.00 is a bye, a man ruled out, or a real zero.
import { zeroKind, byeWeekOf, outMark } from './player-card.js';
import { wirePops, hidePop } from './pop.js';
import { playerHref } from './links.js';
import { diffOf, diffClass } from './view-switch.js';
import { scope } from './prefs.js';

/** The Players page's wire depth: the same 100 most-owned free agents. */
const POOL_LIMIT = 100;

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const POS_ORDER = new Map(POSITIONS.map((p, i) => [p, i + 1]));
const FLEX = 'FLEX';
const FLEX_POSITIONS = ['RB', 'WR', 'TE'];
const FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', FLEX, 'K', 'DST'];
const FILTER_CHOICE = (v) => (FILTERS.includes(String(v)) ? String(v) : 'ALL');

// The Players page's own injury tags, word for word (js/waivers-page.js INJURY).
const INJURY = {
  OUT: { tag: 'OUT', cls: 'bad', dim: true, why: 'ESPN lists this player as out.' },
  INJURY_RESERVE: { tag: 'IR', cls: 'bad', dim: true, why: 'ESPN has this player on injured reserve.' },
  SUSPENSION: { tag: 'SUSP', cls: 'bad', dim: true, why: 'ESPN lists this player as suspended.' },
  DOUBTFUL: { tag: 'D', cls: 'warn', dim: false, why: 'ESPN lists this player as doubtful.' },
  QUESTIONABLE: { tag: 'Q', cls: 'warn', dim: false, why: 'ESPN lists this player as questionable.' },
  DAY_TO_DAY: { tag: 'DTD', cls: 'warn', dim: false, why: 'ESPN lists this player as day to day.' },
};

/** The word in the Owner column for a man nobody holds (the Players page's "Available players"). */
const AVAILABLE = 'Available';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(digits);
const round1 = (n) => Math.round(n * 10) / 10;
const dash = '<span class="muted">—</span>';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const weekRange = (weeks) => {
  if (!weeks.length) return 'no weeks';
  if (weeks.length === 1) return `week ${weeks[0]}`;
  return `weeks ${weeks[0]}–${weeks[weeks.length - 1]}`;
};

// ------------------------------------------------------------------ the maths

/**
 * THE MEAN OF A SPAN OF WEEKS, ZEROS INCLUDED.
 *
 * Tim, 2026-10-16: "Include weeks that the player is proj 0 (either BYE or
 * injured) in the avg calculations." So Future and Playoff divide by EVERY
 * week of their span: a bye's 0 and a ruled-out man's 0 count as 0. (This is
 * NOT the Players page's Avg, which leaves zeros out — rule D7 — and it is on
 * purpose: a man who sits out the championship week is worth less to you in
 * the playoffs, and an average that skipped the week would hide it.)
 *
 * The only weeks that leave the divisor are the ones with NO number at all — a
 * week not read, or one ESPN carried nothing for — because there is no
 * projection there to count, zero or otherwise. A blank in his known bye week
 * IS a bye (js/player-card.js `zeroKind`), so it counts as 0 like any bye.
 *
 * @param {Array<number|null|undefined>} values one per week of the span
 * @param {Array<boolean>} [byeBlank] per week: a blank that is a known bye
 * @returns {{mean:number|null, n:number}} mean unrounded; null when no week has a number
 */
export function spanMean(values, byeBlank = []) {
  let sum = 0;
  let n = 0;
  values.forEach((v, i) => {
    if (typeof v === 'number' && Number.isFinite(v)) { sum += v; n++; }
    else if (byeBlank[i]) n++;          // a bye with no number: a 0 week
  });
  return { mean: n ? sum / n : null, n };
}

/**
 * Each squad's label as its owner's FIRST NAME (Tim: "just the user's first
 * name"). Two owners who share one get their last initial ("Andrew L",
 * "Andrew W"), the Schedule page's rule for its column heads, so two managers
 * are never one name. A one-word label is kept whole.
 *
 * @param {Array<{id, name}>} teams
 * @returns {Map<string, string>} String(team id) -> the short name
 */
export function firstNames(teams) {
  const full = teams.map((t) => String(t.name || `Team ${t.id}`).trim());
  const first = full.map((n) => n.split(/\s+/)[0] || n);
  const clash = (list, s) => list.filter((x) => x === s).length > 1;
  const out = new Map();
  teams.forEach((t, i) => {
    let s = first[i];
    if (clash(first, s)) {
      const words = full[i].split(/\s+/);
      if (words.length > 1) s = `${s} ${words[words.length - 1][0].toUpperCase()}`;
    }
    out.set(String(t.id), s);
  });
  return out;
}

// ------------------------------------------------------------------ the weeks

/** Weeks fully over: every regular game decided, every real bracket game decided. */
function playedWeeksOf(schedule) {
  const out = new Set();
  for (const w of schedule.weeks || []) {
    const games = (schedule.byWeek && schedule.byWeek.get(w)) || [];
    if (games.length && games.every((g) => g.played)) out.add(w);
  }
  const bracket = new Map();
  for (const g of schedule.playoffGames || []) {
    if (g.homeId == null || g.awayId == null) continue;
    bracket.set(g.week, (bracket.get(g.week) ?? true) && Boolean(g.played));
  }
  for (const [w, done] of bracket) if (done) out.add(w);
  return [...out].sort((x, y) => x - y);
}

/** The first week not fully over — the Players page's "current week", by its rule. */
function currentWeekOf(schedule) {
  const over = new Set(playedWeeksOf(schedule));
  const open = (schedule.weeks || []).find((w) => !over.has(w));
  if (open !== undefined) return open;
  const next = leaguePlayoffWeeks(schedule).find((w) => !over.has(w));
  if (next !== undefined) return next;
  return schedule.weeks[schedule.weeks.length - 1] ?? 1;
}

// ------------------------------------------------------------------ the mount

/**
 * Draw the player list into `host` (an empty `<section class="panel">`).
 * Returns a promise that settles once the first full read has been drawn; it
 * never rejects.
 */
export function mountPlayoffPlayers(host) {
  try {
    return mount(host).catch((err) => { failed(host, err); });
  } catch (err) {
    failed(host, err);
    return Promise.resolve();
  }
}

function failed(host, err) {
  try {
    const msg = err && err.message ? err.message : String(err || 'unknown error');
    const line = `<div class="status po-status"><p class="neg">Could not draw the player list. ${esc(msg)}</p></div>`;
    if (host && host.querySelector && host.querySelector('.po-status')) {
      host.querySelector('.po-status').outerHTML = line;
    } else if (host) {
      host.innerHTML = line;
    }
  } catch { /* nothing left to draw into */ }
}

const prefs = scope('playoffs');
// "Show my players" is the Players page's own setting (one setting, every
// switch: Tim, 2026-10-16, "synced to the available players switch").
const playersPrefs = scope('waivers');

async function mount(host) {
  if (!host) throw new Error('no host');

  const state = {
    token: 0,
    isDemo: true,
    loading: true,
    leagueId: null,
    currentWeek: null,
    futureWeeks: [],          // the regular-season weeks left, the current one first
    poWeeks: [],              // the playoff weeks
    byes: {},
    teams: [],                // [{id, name}] off the anchor week
    owners: new Map(),        // String(team id) -> first name
    men: new Map(),           // playerId -> { p, ownerId|null, seasonAvg }
    proj: new Map(),          // week -> Map(playerId -> number|null)
    status: new Map(),        // week -> Map(playerId -> his injury status THAT week)
    failed: new Set(),        // weeks with neither read
    read: { done: 0, of: 0 },
    error: '',
    position: FILTER_CHOICE(prefs.get('position', 'ALL')),
    showMine: playersPrefs.get('showMine', true) !== false,
  };

  host.innerHTML = shellHtml();
  const $ = (sel) => host.querySelector(sel);
  const table = $('#poPlayersTable');

  // ------------------------------------------------------------- reading

  function reset() {
    state.token++;
    state.men = new Map();
    state.proj = new Map();
    state.status = new Map();
    state.failed = new Set();
    state.teams = [];
    state.owners = new Map();
    state.byes = {};
    state.error = '';
    state.read = { done: 0, of: 0 };
  }

  /** Every week a column or an average needs: the regular weeks left, then the playoffs. */
  const neededWeeks = () => [...new Set([...state.futureWeeks, ...state.poWeeks])].sort((a, b) => a - b);

  /**
   * Fold one week's squads and one week's wire into the cache. A man in a
   * squad that week is read off the squad; a free agent off the wire. In a
   * week under way a man whose game is over carries his SCORE as `projected`
   * (js/season.js "done") — a projection average wants what was projected,
   * so `pregame` is used for him.
   */
  function absorb(week, teams, wire) {
    const byId = state.proj.get(week) || new Map();
    const status = state.status.get(week) || new Map();
    const take = (p) => {
      if (p.playerId === null || p.playerId === undefined) return;
      const v = p.done === true && num(p.pregame) !== null ? p.pregame : p.projected;
      if (!byId.has(p.playerId) || byId.get(p.playerId) === null) {
        byId.set(p.playerId, num(v));
        status.set(p.playerId, p.injuryStatus || null);
      }
    };
    for (const t of teams || []) for (const p of t.players || []) take(p);
    for (const p of wire || []) take(p);
    state.proj.set(week, byId);
    state.status.set(week, status);
  }

  /** Who is listed, and whose: the anchor week's squads, then the wire's men nobody holds. */
  function settleMen(anchorTeams, wireWeeks, avgOf) {
    state.teams = (anchorTeams || []).map((t) => ({ id: t.id, name: t.name }));
    state.owners = firstNames(state.teams);
    for (const t of anchorTeams || []) {
      for (const p of t.players || []) {
        if (p.playerId === null || p.playerId === undefined || state.men.has(p.playerId)) continue;
        state.men.set(p.playerId, { p, ownerId: t.id, seasonAvg: avgOf(p) });
      }
    }
    for (const list of wireWeeks) {
      for (const p of list || []) {
        if (p.playerId === null || p.playerId === undefined || state.men.has(p.playerId)) continue;
        state.men.set(p.playerId, { p, ownerId: null, seasonAvg: avgOf(p) });
      }
    }
  }

  async function loadDemo() {
    reset();
    const token = state.token;
    state.isDemo = true;
    state.loading = true;
    state.leagueId = null;
    render();
    const mod = await import('./demo-rosters.js');
    if (token !== state.token) return;
    const sched = mod.generateDemoSchedule();
    const weeks = sched.weeks.slice();
    state.currentWeek = mod.DEMO_CURRENT_WEEK;
    state.futureWeeks = weeks.filter((w) => w >= state.currentWeek);
    // The sample season's own bracket weeks, by the same rule as live.
    state.poWeeks = leaguePlayoffWeeks({ weeks });
    const glance = mod.demoGlance();
    const avgOf = (p) => {
      if (num(p.seasonAvg) !== null) return p.seasonAvg;
      const g = glance.byId.get(p.playerId);
      return g && num(g.avg) !== null ? g.avg : null;
    };
    const need = neededWeeks();
    const teamsBy = new Map();
    const wireBy = new Map();
    // The sample wire: the 100 most-owned men nobody holds in the current
    // week, the Players page's depth. Their later weeks come off that week's
    // wire, or off a squad if somebody picks one up.
    const pool = new Set(mod.generateDemoFreeAgents(state.currentWeek)
      .slice().sort((a, b) => (b.percentOwned ?? 0) - (a.percentOwned ?? 0) || a.playerId - b.playerId)
      .slice(0, POOL_LIMIT).map((p) => p.playerId));
    for (const w of need) {
      try {
        const built = mod.generateDemoWeekRosters(w);
        if (!built || Number(built.week) !== Number(w)) throw new Error(`no demo week ${w}`);
        teamsBy.set(w, built.teams);
        wireBy.set(w, mod.generateDemoFreeAgents(w).filter((p) => pool.has(p.playerId)));
        absorb(w, built.teams, wireBy.get(w));
      } catch {
        state.failed.add(w);
      }
    }
    const anchor = need.find((w) => teamsBy.has(w));
    settleMen(teamsBy.get(anchor), anchor === undefined ? [] : [wireBy.get(anchor)], avgOf);
    state.loading = false;
    render();
  }

  async function loadLive(saved) {
    reset();
    const token = state.token;
    state.isDemo = false;
    state.loading = true;
    state.leagueId = String(saved.leagueId);
    espn.configure({ leagueId: saved.leagueId, season: saved.season });
    render();

    let schedule;
    try {
      schedule = await season.fetchSchedule();
    } catch (err) {
      if (token !== state.token) return;
      state.loading = false;
      state.error = `Could not read this league’s schedule. ${err && err.message ? err.message : ''}`.trim();
      render();
      return;
    }
    if (token !== state.token) return;
    const weeks = (schedule.weeks || []).slice();
    if (!weeks.length) {
      state.loading = false;
      state.error = 'ESPN returned no weeks for this season.';
      render();
      return;
    }
    state.currentWeek = currentWeekOf(schedule);
    state.futureWeeks = weeks.filter((w) => w >= state.currentWeek);
    state.poWeeks = leaguePlayoffWeeks(schedule);
    const need = neededWeeks();
    state.read = { done: 0, of: need.length * 2 };
    render();

    // The bye weeks only decide how a 0.00 (or a blank) is drawn and counted;
    // unknown is an empty map, never an error.
    const byes = typeof season.fetchByeWeeks === 'function'
      ? Promise.resolve().then(() => season.fetchByeWeeks()).catch(() => ({}))
      : Promise.resolve({});

    // The squads: one call, store- and cloud-aware; a week ESPN refuses is
    // simply absent from the answer.
    let rosters = new Map();
    try {
      rosters = await season.fetchWeeksRosters(need, {
        onProgress: () => { if (token === state.token) { state.read.done++; renderStatus(); } },
      });
    } catch { rosters = new Map(); }
    if (token !== state.token) return;
    state.read.done = Math.max(state.read.done, need.length);

    // The wire, two weeks at a time, as the Players page reads it.
    const wire = new Map();
    for (let i = 0; i < need.length; i += 2) {
      await Promise.all(need.slice(i, i + 2).map(async (w) => {
        try { wire.set(w, await season.fetchWireWeek(w, POOL_LIMIT)); } catch { /* a gap */ }
        if (token === state.token) { state.read.done++; renderStatus(); }
      }));
      if (token !== state.token) return;
    }

    for (const w of need) {
      if (!rosters.has(w) && !wire.has(w)) { state.failed.add(w); continue; }
      absorb(w, rosters.get(w), wire.get(w));
    }
    // Owners as of the current week (the first week read): who holds him now.
    const anchor = need.find((w) => rosters.has(w));
    settleMen(anchor === undefined ? [] : rosters.get(anchor),
      need.filter((w) => wire.has(w)).map((w) => wire.get(w)),
      (p) => num(p.seasonAvg));
    // ESPN's season average: the anchor read's, else the latest read carrying it.
    for (const [id, man] of state.men) {
      if (man.seasonAvg !== null) continue;
      for (const w of need.slice().reverse()) {
        const hit = findIn(rosters.get(w), wire.get(w), id);
        if (hit && num(hit.seasonAvg) !== null) { man.seasonAvg = hit.seasonAvg; break; }
      }
    }
    try { state.byes = (await byes) || {}; } catch { state.byes = {}; }
    if (token !== state.token) return;
    state.loading = false;
    render();
  }

  // --------------------------------------------------------------- rows

  /** His projection in a week: a number, null (none carried) or undefined (not read). */
  function projOf(id, week) {
    const m = state.proj.get(week);
    if (!m) return undefined;
    return m.has(id) ? m.get(id) : null;
  }

  /** His injury status in that week's read (a zero is judged by who he was THAT week). */
  function statusFor(p, week) {
    const m = state.status.get(week);
    return (m && m.get(p.playerId)) || p.injuryStatus || null;
  }

  /** Is a week with no number his known bye (then it is a 0 week)? */
  const byeBlank = (p, week, v) => v === null &&
    zeroKind(v, { week, byeWeek: byeWeekOf(p, state.byes), demo: state.isDemo }) === 'bye';

  function myTeamId() {
    const picked = playersPrefs.get('team', null);
    if (picked !== null && state.teams.some((t) => String(t.id) === String(picked))) return String(picked);
    if (state.isDemo) return state.teams.length ? String(state.teams[0].id) : null;
    const saved = savedConfig();
    return saved && saved.teamId !== null && saved.teamId !== undefined ? String(saved.teamId) : null;
  }

  function buildRows() {
    const rows = [];
    for (const [id, man] of state.men) {
      const p = man.p;
      const future = state.futureWeeks.map((w) => projOf(id, w));
      const po = state.poWeeks.map((w) => projOf(id, w));
      const f = spanMean(future, state.futureWeeks.map((w, i) => byeBlank(p, w, future[i])));
      const pl = spanMean(po, state.poWeeks.map((w, i) => byeBlank(p, w, po[i])));
      const avg = num(man.seasonAvg);
      // Printed to the tenth, and the difference is of the two printed figures
      // (the site's rule: a printed difference is its two printed ends subtracted).
      const avgShown = avg === null ? null : round1(avg);
      const poShown = pl.mean === null ? null : round1(pl.mean);
      const futShown = f.mean === null ? null : round1(f.mean);
      rows.push({
        id, p, man,
        owner: man.ownerId === null ? null : (state.owners.get(String(man.ownerId)) || `Team ${man.ownerId}`),
        avg: avgShown, future: futShown, futureN: f.n, playoff: poShown, playoffN: pl.n,
        diff: diffOf(poShown, avgShown),
        // Tim, 2026-10-16: "make another derived column for these playoff
        // players that is playoff avg - future proj avg."
        diffFut: diffOf(poShown, futShown),
        futureValues: future, poValues: po,
      });
    }
    return rows;
  }

  const matches = (r) => {
    if (state.position === 'ALL') return true;
    if (state.position === FLEX) return FLEX_POSITIONS.includes(r.p.position);
    return r.p.position === state.position;
  };

  /** position -> a scale over one number per row (all rows, never the filtered ones). */
  function scalesByPosition(rows, pick) {
    const by = new Map();
    for (const r of rows) {
      if (!by.has(r.p.position)) by.set(r.p.position, []);
      const v = pick(r);
      if (num(v) !== null) by.get(r.p.position).push(v);
    }
    return new Map([...by].map(([pos, vals]) => [pos, heatScale(vals)]));
  }

  // --------------------------------------------------------------- render

  function render() {
    try {
      renderControls();
      renderTable();
      renderStatus();
      renderNote();
    } catch (err) {
      failed(host, err);
    }
  }

  function renderControls() {
    host.querySelectorAll('#poPosFilter button[data-pos]').forEach((b) => {
      b.classList.toggle('on', b.dataset.pos === state.position);
    });
    const sw = $('#poShowMine');
    if (sw) sw.checked = state.showMine;
  }

  let view = { rows: new Map() };

  function renderTable() {
    const weeks = state.poWeeks;
    const all = buildRows();
    const me = myTeamId();
    const mineOk = (r) => state.showMine || me === null || r.man.ownerId === null || String(r.man.ownerId) !== me;
    const shown = all.filter((r) => matches(r) && mineOk(r));

    // Counts on the position buttons: this table's own rows (after the switch).
    const counts = { ALL: 0, [FLEX]: 0 };
    for (const pos of POSITIONS) counts[pos] = 0;
    for (const r of all.filter(mineOk)) {
      counts.ALL++;
      if (FLEX_POSITIONS.includes(r.p.position)) counts[FLEX]++;
      if (POS_ORDER.has(r.p.position)) counts[r.p.position]++;
    }
    host.querySelectorAll('#poPosFilter button[data-pos]').forEach((b) => {
      const slot = b.querySelector('.seg-count');
      if (slot) slot.textContent = counts.ALL ? String(counts[b.dataset.pos] ?? 0) : '';
    });

    const avgScales = scalesByPosition(all, (r) => r.avg);
    const futScales = scalesByPosition(all, (r) => r.future);
    const poScales = scalesByPosition(all, (r) => r.playoff);
    const weekScales = new Map();
    for (const pos of new Set(all.map((r) => r.p.position))) {
      const men = all.filter((r) => r.p.position === pos);
      weekScales.set(pos, weeks.map((_, i) =>
        heatScale(men.map((r) => r.poValues[i]).filter((v) => num(v) !== null && v > 0))));
    }
    view = { rows: new Map(all.map((r) => [String(r.id), r])) };

    table.querySelector('thead').innerHTML = headHtml(weeks);
    const cols = 8 + weeks.length;
    const tbody = table.querySelector('tbody');
    if (!shown.length) {
      const why = state.loading ? 'Reading the league’s players…'
        : state.error ? state.error
          : all.length ? 'Nobody at this position. Switch the filter back to All.'
            : 'No players to list.';
      tbody.innerHTML = `<tr class="empty-row"><td colspan="${cols}">${esc(why)}</td></tr>`;
    } else {
      tbody.innerHTML = shown.map((r) => rowHtml(r, weeks, {
        avg: heatOf(r.avg, avgScales.get(r.p.position)),
        future: heatOf(r.future, futScales.get(r.p.position)),
        playoff: heatOf(r.playoff, poScales.get(r.p.position)),
        weeks: weekScales.get(r.p.position) || [],
      })).join('');
    }
    resort(table);

    // A key names a mark only while the table draws it (the Players page's `syncKeys`).
    host.querySelectorAll('#poLegend [data-when]').forEach((el) => {
      if (tbody.querySelector(el.getAttribute('data-when'))) el.removeAttribute('hidden');
      else el.setAttribute('hidden', '');
    });
    const heatKey = $('#poHeatKey');
    if (heatKey) {
      heatKey.innerHTML = shown.length && tbody.querySelector('td.heat')
        ? '<strong>Colour compares men at the same position</strong>; ends carry an arrow and heavier type.'
        : '';
    }
  }

  function headHtml(weeks) {
    const futTitle = state.futureWeeks.length
      ? `His average projection over ${weekRange(state.futureWeeks)}, the regular season left. Every week counts — a bye or a ruled-out 0 included.`
      : 'The regular season is over: no weeks left to average.';
    const poTitle = `His average projection over the playoff weeks (${weekRange(weeks)}). Every week counts — a bye or a ruled-out 0 included.`;
    const wk = weeks.map((w, i) => {
      const start = i === 0;
      const failedWeek = state.failed.has(w);
      const title = failedWeek
        ? `Week ${w} did not load — ESPN refused it. Reload the page to try again.`
        : `ESPN’s projected points for week ${w}, a playoff week.`;
      const cls = [start ? 'po-start' : '', failedWeek ? 'muted' : ''].filter(Boolean).join(' ');
      return `<th data-sort${cls ? ` class="${cls}"` : ''} title="${title}">${w}` +
        `${start ? '<span class="po-tag" aria-hidden="true">PO</span>' : ''}` +
        '<span class="sr-only"> (playoffs)</span></th>';
    }).join('');
    return `<tr>
       <th class="name" data-sort title="Every player on a roster, and the free agents the Players page lists. Click a name for his row there.">Player</th>
       <th class="left" data-sort title="His position.">Pos</th>
       <th class="left" data-sort title="His NFL team.">Tm</th>
       <th class="left" data-sort title="Whose roster he is on this week, by first name.">Owner</th>
       <th class="grouped" data-sort title="His season average so far — ESPN’s figure.">Avg</th>
       <th data-sort title="${futTitle}">Future</th>
       <th data-sort title="${poTitle}">Playoff</th>
       <th data-sort title="Playoff minus Avg, as printed: green = projected above his average in the playoffs.">PO − Avg</th>
       <th data-sort title="Playoff minus Future, as printed: green = projected higher in the playoffs than in the rest of the regular season.">PO − Fut</th>
       ${wk}
     </tr>`;
  }

  function nameCell(r) {
    const { p } = r;
    const status = INJURY[p.injuryStatus] || null;
    const tag = status
      ? ` <span class="tag ${status.cls}" title="${esc(status.why)}">${status.tag}</span>`
      : '';
    const href = playerHref(p.playerId);
    // `aria-label`, never `title`, on the link (js/touch-titles.js leaves links alone).
    const link = href
      ? `<a class="pref" href="${esc(href)}" aria-label="${esc(p.name)} — open his row on the Players page">${esc(p.name)}</a>`
      : esc(p.name);
    return `<td class="name" data-v="${esc(String(p.name || '').toLowerCase())}">${link}${tag}</td>`;
  }

  /** A mean cell, coloured on its position's scale; it opens the weeks it is the mean of. */
  function meanCell(value, heat, kind, cls = '') {
    const classes = [cls, heat ? heat.cls : ''].filter(Boolean).join(' ');
    if (value === null) return `<td${cls ? ` class="${cls}"` : ''}>${dash}</td>`;
    return `<td${classes ? ` class="${classes}"` : ''} data-v="${value}" data-c="${kind}">` +
      `${fmt(value)}${heatMarkHtml(heat)}</td>`;
  }

  /** One playoff week's cell: the Players page's own Bye / 0.0 OUT / — / number. */
  function weekCell(r, week, v, scale) {
    const { p } = r;
    if (v === undefined) {
      return state.failed.has(week)
        ? `<td class="muted" title="Week ${week} did not load — ESPN refused it. Reload the page to try again.">${dash}</td>`
        : `<td class="wait" title="Week ${week} has not been read yet.">·</td>`;
    }
    const zero = zeroKind(v, {
      week, byeWeek: byeWeekOf(p, state.byes), injuryStatus: statusFor(p, week), demo: state.isDemo,
    });
    if (zero === 'bye') {
      return `<td class="bye" data-v="0" title="${esc(p.name)} is on bye in week ${week}. It counts as 0 in Playoff.">Bye</td>`;
    }
    if (v === null) {
      return `<td title="ESPN carried no projection for ${esc(p.name)} in week ${week}.">${dash}</td>`;
    }
    if (v === 0) {
      const why = `${esc(p.name)} is projected at 0.0 in week ${week}. It counts as 0 in Playoff.`;
      if (zero === 'out') {
        return `<td class="zero-out" data-v="0" title="${why}">0.0 <span class="zmark">${esc(outMark(statusFor(p, week)))}</span></td>`;
      }
      return `<td class="zero" data-v="0" title="${why}">0.0</td>`;
    }
    const heat = heatOf(v, scale);
    return `<td${heat ? ` class="${heat.cls}"` : ''} data-v="${v}">${fmt(v)}${heatMarkHtml(heat)}</td>`;
  }

  function rowHtml(r, weeks, heat) {
    const { p } = r;
    const status = INJURY[p.injuryStatus] || null;
    const ownerCell = r.owner === null
      ? `<td class="left owner fa" data-v="~">${esc(AVAILABLE)}</td>`
      : `<td class="left owner" data-v="${esc(r.owner.toLowerCase())}">${esc(r.owner)}</td>`;
    const diffTd = (d, c) => (d === null
      ? `<td>${dash}</td>`
      : `<td class="${diffClass(d)}" data-v="${d}" data-c="${c}">${Math.abs(d) < 1e-9 ? '0' : (d > 0 ? '+' : '−') + Math.abs(d).toFixed(1)}</td>`);
    const diffCell = diffTd(r.diff, 'diff') + diffTd(r.diffFut, 'diffFut');
    return `<tr data-player="${esc(r.id)}"${status && status.dim ? ' class="unavailable"' : ''}>
      ${nameCell(r)}
      <td class="left" data-v="${POS_ORDER.get(p.position) ?? 9}">${esc(p.position)}</td>
      <td class="left">${esc(p.proTeam || '')}</td>
      ${ownerCell}
      ${meanCell(r.avg, heat.avg, 'avg', 'grouped')}
      ${meanCell(r.future, heat.future, 'fut')}
      ${meanCell(r.playoff, heat.playoff, 'po', 'avg')}
      ${diffCell}
      ${weeks.map((w, i) => {
        const c = weekCell(r, w, r.poValues[i], heat.weeks[i] || null);
        return i === 0 ? c.replace(/^<td(?: class="([^"]*)")?/, (m, cls) => `<td class="${cls ? `${cls} ` : ''}po-start"`) : c;
      }).join('')}
    </tr>`;
  }

  // --------------------------------------------------------------- the previews

  /** Where a mean comes from: each week of its span, and the mean of them. */
  function spanCard(r, weeks, values, mean, n, what) {
    const rows = weeks.map((w, i) => {
      const v = values[i];
      if (v === undefined) return { label: `Week ${w}`, note: 'not read, left out', value: null };
      const zero = zeroKind(v, { week: w, byeWeek: byeWeekOf(r.p, state.byes), injuryStatus: statusFor(r.p, w), demo: state.isDemo });
      if (zero === 'bye') return { label: `Week ${w}`, note: 'bye, counts 0', value: 0 };
      if (v === null) return { label: `Week ${w}`, note: 'no projection, left out', value: null };
      if (v === 0) return { label: `Week ${w}`, note: zero === 'out' ? 'ruled out, counts 0' : 'counts 0', value: 0 };
      return { label: `Week ${w}`, value: v };
    });
    return {
      title: r.p.name,
      sub: `${what}, ${weekRange(weeks)}`,
      rows,
      total: { label: `Mean of ${plural(n, 'week')}`, value: mean },
    };
  }

  function cardFor(el) {
    const tr = el.closest && el.closest('tr');
    const r = tr ? view.rows.get(String(tr.getAttribute('data-player'))) : null;
    if (!r) return null;
    switch (el.getAttribute('data-c')) {
      case 'avg':
        return {
          title: r.p.name,
          sub: 'Avg',
          rows: [{ label: 'Season average so far', note: 'ESPN', value: r.avg }],
        };
      case 'fut':
        return spanCard(r, state.futureWeeks, r.futureValues, r.future, r.futureN, 'Future');
      case 'po':
        return spanCard(r, state.poWeeks, r.poValues, r.playoff, r.playoffN, 'Playoff');
      case 'diff':
        return {
          title: r.p.name,
          sub: 'PO − Avg',
          rows: [{ label: 'Playoff', value: r.playoff }, { label: 'Avg', value: r.avg }],
          total: { label: 'Difference', html: esc((r.diff > 0 ? '+' : r.diff < 0 ? '−' : '') + (r.diff === 0 ? '0' : Math.abs(r.diff).toFixed(1))), value: r.diff },
        };
      case 'diffFut':
        return {
          title: r.p.name,
          sub: 'PO − Fut',
          rows: [{ label: 'Playoff', value: r.playoff }, { label: 'Future', value: r.future }],
          total: { label: 'Difference', html: esc((r.diffFut > 0 ? '+' : r.diffFut < 0 ? '−' : '') + (r.diffFut === 0 ? '0' : Math.abs(r.diffFut).toFixed(1))), value: r.diffFut },
        };
      default:
        return null;
    }
  }

  // --------------------------------------------------------------- status and note

  function renderStatus() {
    const el = $('#poStatus');
    if (!el) return;
    const bits = [];
    if (state.error) bits.push(`<p class="neg">${esc(state.error)}</p>`);
    else if (state.isDemo && !state.loading) bits.push('<p>Demo data: invented squads, not your real league.</p>');
    if (state.loading && !state.isDemo && state.read.of) {
      bits.push(`<p class="muted">Reading ESPN’s weekly projections… ${Math.min(state.read.done, state.read.of)} of ${state.read.of}.</p>`);
    }
    const failedWeeks = [...state.failed].sort((a, b) => a - b);
    if (failedWeeks.length && !state.loading) {
      bits.push(`<p class="neg">ESPN did not return week${failedWeeks.length === 1 ? '' : 's'} ${failedWeeks.join(', ')}. Reload the page to try again.</p>`);
    }
    el.innerHTML = bits.join('');
  }

  function renderNote() {
    const el = $('#poNote');
    if (!el) return;
    const lead = (s) => `<span class="lead">${s}.</span> `;
    const parts = [
      lead('Who is listed') + 'Everyone on a roster this week, under his owner’s first name, and the ' +
        `${POOL_LIMIT} most-owned free agents — the Players page’s list — as “${AVAILABLE}”.`,
      lead('Avg') + 'His season average so far: ESPN’s own figure, the one on his player card.',
      lead('Future and Playoff') + 'His average projection over the regular-season weeks left ' +
        `(${weekRange(state.futureWeeks)}) and over the playoff weeks (${weekRange(state.poWeeks)}). ` +
        'Every week counts: a bye or a man ruled out is a 0 in the average, not left out. ' +
        'Only a week with no projection at all is left out. Tap a figure for its weeks.',
      lead('PO − Avg') + 'Playoff minus Avg, as printed: green means projected above his average in the playoffs.',
      lead('PO − Fut') + 'Playoff minus Future, as printed: green means projected higher in the playoffs than in the regular weeks left.',
      lead('Colour') + 'Avg, Future, Playoff and each week compare men at the same position, ' +
        'the whole list at once — a filter never moves a colour.',
      state.isDemo
        ? lead('Cost') + 'Demo data costs nothing.'
        : lead('Cost') + `Each week from ${state.currentWeek ?? 'now'} through the last playoff week is read twice ` +
          '(rosters + wire) — the Players page’s Rest of season — and kept in this browser.',
    ];
    el.innerHTML = parts.map((s) => `<p>${s}</p>`).join('');
  }

  // --------------------------------------------------------------- wiring

  host.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('#poPosFilter button[data-pos]');
    if (!btn || btn.dataset.pos === state.position) return;
    state.position = FILTER_CHOICE(btn.dataset.pos);
    prefs.set('position', state.position);
    hidePop();
    render();
  });
  const sw = $('#poShowMine');
  if (sw) {
    sw.addEventListener('change', (e) => {
      state.showMine = Boolean(e.target.checked);
      playersPrefs.set('showMine', state.showMine);
      render();
    });
  }
  // Best playoff average first (the Playoff column).
  enableSort(table, { defaultIndex: 6 });
  wirePops(table, { selector: 'td[data-c]', card: cardFor });

  // A league connected later turns the list live; a Sync re-reads it.
  // Started BEFORE the listener goes on: onConnection answers at once when a
  // league is already connected, and by then this read has claimed it.
  const saved = savedConfig();
  const first = saved ? loadLive(saved) : loadDemo();
  try {
    onConnection((conn) => {
      if (!conn) return;
      const saved = savedConfig();
      if (!saved || (!state.isDemo && state.leagueId === String(saved.leagueId))) return;
      if (state.loading && !state.isDemo) return;
      loadLive(saved).catch((err) => failed(host, err));
    });
    document.addEventListener('ff:refresh', (e) => {
      if (state.isDemo) return;
      const saved = savedConfig();
      if (!saved) return;
      const go = loadLive(saved).catch((err) => failed(host, err));
      if (e && e.detail && typeof e.detail.waitUntil === 'function') e.detail.waitUntil(go);
    });
  } catch { /* no connection bar: the first read below still happens */ }

  await first;
}

/** A man in one week's reads (squads, then wire), or null. */
function findIn(teams, wire, id) {
  for (const t of teams || []) for (const p of t.players || []) if (p.playerId === id) return p;
  for (const p of wire || []) if (p.playerId === id) return p;
  return null;
}

/** The panel's fixed markup: the Taken panel's shape (waivers.html #takenPanel). */
function shellHtml() {
  const btn = (pos, label = pos, title = '') =>
    `<button type="button" data-pos="${pos}"${title ? ` title="${title}"` : ''}>${label}<span class="seg-count"></span></button>`;
  return `
    <div class="panel-head">
      <h2>Players</h2>
      <label class="switch" for="poShowMine">
        <input type="checkbox" role="switch" id="poShowMine" checked>
        <span class="switch-track" aria-hidden="true"></span>
        <span class="switch-text">Show my players</span>
      </label>
    </div>
    <p class="lede">Taken and available players, projected through the playoffs.</p>
    <div class="toolbar">
      <div class="ctl">
        <span class="ctl-label" id="poPosLabel">Position</span>
        <div class="segmented seg-sm" id="poPosFilter" role="group" aria-labelledby="poPosLabel">
          ${btn('ALL', 'All')}${btn('QB')}${btn('RB')}${btn('WR')}${btn('TE')}
          ${btn('FLEX', 'FLEX', 'Every running back, receiver and tight end at once. A filter only: each keeps his own position.')}
          ${btn('K')}${btn('DST')}
        </div>
      </div>
    </div>
    <div class="status po-status" id="poStatus"></div>
    <div class="legend" id="poLegend">
      <span class="key" data-when="td.bye" hidden><span class="sw bye">Bye</span> no game, counts 0</span>
      <span class="key" data-when="td.zero-out" hidden><span class="sw zero-out">0.0 <span class="zmark">OUT</span></span> ruled out, counts 0</span>
      <span class="key" data-when="td.zero" hidden><span class="sw">0.0</span> projected at zero</span>
      <span class="key"><span class="sw">&mdash;</span> no projection</span>
      <span class="key" data-when="td.heat-up-4" hidden><span class="sw heat heat-up-4">18.7 <span class="heatmark">&#9650;</span></span> best at his position</span>
      <span class="key" data-when="td.heat-dn-4" hidden><span class="sw heat heat-dn-4">9.8 <span class="heatmark">&#9660;</span></span> worst of them</span>
    </div>
    <div class="table-scroll"><table id="poPlayersTable">
      <thead></thead>
      <tbody></tbody>
    </table></div>
    <p class="panel-note" id="poHeatKey"></p>
    <details class="explain">
      <summary>How to read this table</summary>
      <div class="panel-note" id="poNote"></div>
    </details>`;
}
