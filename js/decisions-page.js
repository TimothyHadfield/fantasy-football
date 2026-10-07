// The Decisions review page: every decision a team made, and the season
// without it.
//
// Tim, 2026-10-05: "have a list of all the decisions they've made, and what
// would have happened if they hadn't made that that decision ... the biggest
// thing I want to see is the act weekly total for that team each previous week,
// whether that would have changed the outcome of a matchup, and how much it
// would have changed the overall record." Plan: docs/decisions-review-plan.md.
//
// THIS FILE DRAWS AND NOTHING ELSE. The world comes from
// `season.fetchDecisionWorld`, every hypothetical from `mirror()` in
// js/decisions.js, and the three charts from the shared renderers
// (js/actual-season-table.js, js/standings-table.js, js/summary-table.js) —
// each drawn twice, the season that happened beside the mirror, so two panels
// can never disagree about one hypothetical.
//
// THE CHART'S TWO PERCENTAGES are the Summary page's own simulation, asked
// twice: once with the real results banked and once with the mirror's, the
// weeks still to play scored from today's real rosters both times, on the same
// seed. The steps from `loadOdds` down are js/summary-page.js's, in its order,
// through the same js/capture.js builders — so "Current" here is the Summary
// page's chart to the digit. Change one, change the other.
//
// THE WEEK IN PLAY (`world.partialWeek`; Tim, 2026-10-05: "Could you just
// display everything you're able to, like we do across the rest of the cite?").
// It is on every panel, and (Tim, later that day: "just show what you have right
// now ... put a little 'live' sign by the week number") its POINTS always count:
// the weekly table, its Total row, the Points tile and the list all add up the
// same team-weeks, the one in play included. A RESULT is another matter. A
// matchup that is over counts like any other; one that is not final in both
// worlds is `mirror.pending`, reads "In play", and is left out of BOTH worlds
// wherever a record is added up — the tiles, Standings — so they always count
// the same games. A team-week with anything still to come carries the small
// LIVE tag (`cell.live`). The chart's "Current" side is not touched: it stays
// the Summary page's.
//
// ALL USERS (`state.all`; Tim, 2026-10-05: "add a button by the user selection
// that says 'all users'. This allows you to have all users to have done a
// reasonable lineup or perfect lineup and see the results."). The list is then
// the two lineup choices alone, each for every team at once, and the result is
// one row a TEAM instead of one row a week. A move or a trade belongs to one
// team, so those wait in that team's own list; nothing kept is thrown away.

import { computeLeagueStats } from './stats.js';
import * as season from './season.js';
import * as espn from './espn.js';
import * as forecast from './forecast.js';
import * as capture from './capture.js';
import { listDecisions, mirror, rosterAt, ALL_TEAMS } from './decisions.js';
// `weekSwaps` is newer than the names above, and it is read off the namespace
// so a browser still holding last deploy's copy of that file (PROGRESS.md,
// "Stale-module trap") loads this page without the previews instead of not at all.
import * as engine from './decisions.js';
import { actualSeasonTableHtml, weeksFromMirror, shortName } from './actual-season-table.js';
// `seasonHeat` is newer than those three: off the namespace, for the same reason.
import * as seasonTable from './actual-season-table.js';
import { projectionsFromWeekTeams, opponentProjections } from './projection.js';
import { standingsTableHtml } from './standings-table.js';
import { summaryTableHtml } from './summary-table.js';
import {
  viewSwitchHtml, viewFromClick, signedText, diffOf, diffClass, recordDiff, dimStyle, esc, round1,
} from './view-switch.js';
import { enableSort, resort, sortBy } from './sortable.js';
import { scope } from './prefs.js';
import { savedConfig, onConnection } from './connection.js';

const $ = (id) => document.getElementById(id);
const prefs = scope('decisions');

// ------------------------------------------------------------------ constants

/** The Summary page's run count and seed: one question, one answer. */
const SIM_RUNS = 100000;
const SIM_SEED = 20260901;
/** As on Summary: nothing before a decided week, LUCK unshaded before three. */
const MIN_WEEKS = 1;
const MIN_WEEKS_TO_SHADE_LUCK = 3;
/**
 * How long a newly picked decision waits before its seasons are simulated.
 * A run is a second or more of straight arithmetic, so somebody stepping down
 * the list must not pay for every row he passes.
 */
const SIM_DELAY_MS = 400;

/**
 * The small LIVE badge beside a week number: some of that week is still to
 * come. The same markup as js/actual-season-table.js's column heads — written
 * out here, not imported, so a browser still holding last deploy's copy of that
 * file (PROGRESS.md, "Stale-module trap") cannot stop this page loading.
 */
const LIVE_TAG = '<span class="badge live wk-live" title="Still being played: some of this is not final.">live</span>';

/** Tim's two words (2026-10-05). Each covers every week; there is no week's own. */
const LINEUP_SAID = {
  'lineup-reasonable': 'Reasonable',
  'lineup-perfect': 'Perfect hindsight',
};

const state = {
  source: prefs.get('source', 'demo'),
  world: null,          // season.fetchDecisionWorld()
  leagueKey: 'demo',    // what this league's what-ifs and team are remembered under
  season: null,
  teamId: null,         // whose decisions are listed
  all: false,           // "All users": every team's lineup at once, instead
  decisions: [],        // that team's, what-ifs first
  selectedId: null,
  seasonTeamId: null,   // whose lineup "Season by week" shows
  markWeek: null,       // the week whose column "Season by week" outlines (see goSeason)
  noise: prefs.get('noise', false) === true,
  view: { season: 'total', standings: 'total', summary: 'total' },
  odds: null,           // see loadOdds()
  oddsToken: 0,
  wi: { gives: [], gets: [] },   // the trade being put together in the form
};

/** decision id -> mirror(world, decision). Cleared with the world. */
const mirrors = new Map();
/** simulation key -> { result, ms }. Cleared with the world. */
const sims = new Map();

// ------------------------------------------------------------------ formatting

const round2 = (n) => Math.round(n * 100) / 100;
const commas = (n) => Number(n).toLocaleString('en-US');
const same = (a, b) => String(a) === String(b);

/** One MAN'S points as ESPN prints them: two decimals when he has two. */
function pts(n) {
  if (!Number.isFinite(n)) return '—';
  const s = n.toFixed(2);
  return s.endsWith('0') ? s.slice(0, -1) : s;
}

/** A difference of two of those, signed, with a real minus. */
const signedPts = (d) => (d === null ? '—' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${pts(Math.abs(d))}`);

/**
 * A TEAM'S week, or its season, to the tenth — as Analysis and Stats print the
 * same team-week (121.9, never 121.94 beside 106.1). Rounded the way `diffOf`
 * rounds its two sides, so the Diff beside two of these is their subtraction as
 * printed: `diffOf(hyp, real)`, drawn with `signedText`.
 */
const pts1 = (n) => (Number.isFinite(n) ? round1(n).toFixed(1) : '—');

/** "3-0", and a third number only with a tie — the Summary chart's form. */
const recText = (r) => (r ? `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}` : '—');

const teamOf = (id) => (state.world ? state.world.teams.find((t) => same(t.id, id)) || null : null);
const teamName = (id) => { const t = teamOf(id); return t ? t.name || t.teamName || `Team ${id}` : `Team ${id}`; };
const playerName = (id) => {
  const p = state.world && state.world.players && state.world.players.get(id);
  return (p && p.name) || `Player ${id}`;
};
const names = (ids) => (ids || []).map(playerName).join(' and ');

// --------------------------------------------------------------------- sorting
//
// Tim, 2026-10-06: "fix the decisions section so the formating and function of
// the graphs matches with the rest of the cite (especially column sorting ...)".
// Every table here sorts on a click of its heading through js/sortable.js, like
// every other table on the site — Season by week too, as the same sheet does on
// Analysis: by slot or by any week, its Total row a body of its own that stays
// at the foot.
//
// A PAIR SORTS TOGETHER. Season by week, Standings and the chart are each drawn
// twice, Current beside (or above) Hypothetical | Difference, and the point of
// the pair is to read one row across both. So a click on either table's heading sorts THAT
// table by its own numbers, and the other one takes the same row order and the
// same arrow — never its own order, which would put two different teams on one
// line.
//
// Both tables of a pair are redrawn from scratch on every render, so the choice
// is kept here and not in sortable.js (which keys it on the table element):
// box -> { index, asc, lead } — the column, the direction, and which of the two
// was clicked ('Cur' or 'Hyp').
const pairSort = { season: null, standings: null, summary: null };

/** The rows that sort: the first body's. Season by week's Total is a second body and stays put. */
const bodyRows = (table) => [...table.querySelector('tbody').children];

/** A pair's two tables, Current first; null for one that is not drawn. */
const pairTables = (box) => ['Cur', 'Hyp'].map((side) => $(`${box}${side}`).querySelector('table'));

/** Put `follower`'s rows in the order `leader`'s are in, by the place each was drawn at. */
function followRows(leader, follower) {
  const body = follower.querySelector('tbody');
  const byPlace = new Map(bodyRows(follower).map((tr) => [tr.getAttribute('data-place'), tr]));
  for (const tr of bodyRows(leader)) {
    const twin = byPlace.get(tr.getAttribute('data-place'));
    if (twin) body.appendChild(twin);
  }
}

/**
 * Wire a freshly drawn pair for sorting and put the kept sort back on it. Call
 * after BOTH tables are drawn, in the same team order (they always are).
 */
function sortPair(box) {
  const [cur, hyp] = pairTables(box);
  if (!cur || !hyp) return;
  for (const table of [cur, hyp]) bodyRows(table).forEach((tr, i) => tr.setAttribute('data-place', i));
  const st = pairSort[box];
  const opts = st ? { defaultIndex: st.index, defaultAsc: st.asc } : {};
  enableSort(cur, opts);
  enableSort(hyp, opts);
  if (st) followRows(st.lead === 'Hyp' ? hyp : cur, st.lead === 'Hyp' ? cur : hyp);
}

/**
 * A heading of one of a pair's tables was clicked (or keyed). sortable.js has
 * already sorted that table — its listener is on the table, this one further
 * out — so its heading says which column and which way.
 */
function onPairSort(box, e) {
  if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
  const th = e.target.closest && e.target.closest('th[data-sort]');
  const table = th && th.closest('table');
  const [cur, hyp] = pairTables(box);
  if (!table || !cur || !hyp || (table !== cur && table !== hyp)) return;
  const head = [...th.parentElement.children];
  const index = head.findIndex((h) => h.classList.contains('sorted'));
  if (index < 0) return;
  const asc = head[index].classList.contains('asc');
  pairSort[box] = { index, asc, lead: table === hyp ? 'Hyp' : 'Cur' };
  // Sorted again from the order it was DRAWN in, so teams level on this column
  // stand as they will after the next redraw and do not swap places then.
  const body = table.querySelector('tbody');
  bodyRows(table)
    .sort((a, b) => a.getAttribute('data-place') - b.getAttribute('data-place'))
    .forEach((tr) => body.appendChild(tr));
  sortBy(table, index, asc);
  const other = table === hyp ? cur : hyp;
  sortBy(other, index, asc);
  followRows(table, other);
}

/** "3 finished weeks", and the week in play after it when the world has one. */
function weeksSaid(world) {
  const partial = Number.isFinite(world.partialWeek) ? world.partialWeek : null;
  const n = world.weeks.length - (partial === null ? 0 : 1);
  const finished = `${n} finished week${n === 1 ? '' : 's'}`;
  if (partial === null) return finished;
  return n ? `${finished} + week ${partial} so far` : `Week ${partial} so far`;
}

// ------------------------------------------------------------------ the world

function setStatus(msg, isError = false) {
  const el = $('sourceStatus');
  if (!el) return;
  el.innerHTML = msg;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

/** Is this page's data the phone's synced copy? A stub without the read is "no". */
async function fromCloud() {
  if (typeof season.cloudSource !== 'function') return false;
  try { return Boolean(await season.cloudSource()); } catch { return false; }
}

/**
 * Read one source's world and put it on the page.
 *
 * @returns {Promise<boolean>} false when it could not be read; the reason is
 *          then in the status line and whatever was on screen is left there
 */
async function loadWorld(src) {
  const demo = src === 'demo';
  let cfg = null;
  if (!demo) {
    // Never read localStorage for the league directly — see PROGRESS.md rule 6.
    cfg = savedConfig();
    if (!cfg) {
      setStatus('No league connected yet. Connect one on the bar above first.', true);
      return false;
    }
    espn.configure({ leagueId: cfg.leagueId, season: cfg.season });
  }
  setStatus(demo
    ? 'Generated sample data — not your real league.'
    : '<span class="searching">Loading your league from ESPN…</span>');

  let world;
  try {
    world = await season.fetchDecisionWorld({
      demo,
      onProgress: (done, total, label) =>
        setStatus(`<span class="searching">${esc(label)} (${done}/${total})</span>`),
    });
  } catch (err) {
    // The phone's copy of a private league holds no moves yet (the plan's
    // Phase 4), so there the reason is said in this page's own words.
    setStatus((await fromCloud())
      ? 'This page needs the league read directly for now.'
      : esc(err.message), true);
    return false;
  }

  state.world = world;
  state.leagueKey = demo ? 'demo' : `${cfg.leagueId}-${cfg.season}`;
  state.season = demo ? null : cfg.season;
  mirrors.clear();
  sims.clear();
  simQueued = null;
  state.odds = null;
  state.oddsToken++;

  // Whose decisions: the team last picked for THIS league, else the saved "my
  // team", else the first. Team ids collide across leagues, so the memory is
  // per league.
  const remembered = prefs.get(`team.${state.leagueKey}`);
  const mine = demo ? null : cfg.teamId;
  const pick = [remembered, mine].map(teamOf).find(Boolean) || world.teams[0] || null;
  state.teamId = pick ? pick.id : null;
  // Remembered per league, like the team.
  state.all = prefs.get(`all.${state.leagueKey}`) === true;

  if (!demo) {
    setStatus(world.weeks.length
      ? `Loaded ${esc(world.name)}: ${weeksSaid(world)}, ${world.moves.length} moves.`
      : 'No finished week yet.');
  }
  setTeam(state.teamId);
  loadOdds();
  return true;
}

// ---------------------------------------------------------------- the decisions

/** This league's what-if trades, as kept in the page's prefs. */
function whatIfs() {
  const list = prefs.get(`whatif.${state.leagueKey}`, []);
  return Array.isArray(list) ? list : [];
}

function saveWhatIfs(list) {
  prefs.set(`whatif.${state.leagueKey}`, list.length ? list : null);
}

/** A kept what-if as a decision `mirror()` takes, worded from `teamId`'s side. */
function whatIfDecision(w, teamId) {
  const mine = same(w.teamId, teamId);
  const gives = mine ? w.gives : w.gets;
  const gets = mine ? w.gets : w.gives;
  return {
    id: w.id, kind: 'whatif-trade', week: w.week,
    teamId: w.teamId, withTeamId: w.withTeamId, gives: w.gives, gets: w.gets,
    label: `Trade ${names(gives)} for ${names(gets)} (${teamName(mine ? w.withTeamId : w.teamId)})`,
    whatIf: true,
  };
}

function mirrorOf(decision) {
  if (!mirrors.has(decision.id)) mirrors.set(decision.id, mirror(state.world, decision));
  return mirrors.get(decision.id);
}

const anyChanged = (m) =>
  [...m.teams.values()].some((t) => Object.values(t.byWeek).some((c) => c.changed));

/** The list's first decision that changes something, else its first. */
function firstId() {
  const first = state.decisions.find((d) => !d.empty) || state.decisions[0] || null;
  return first ? first.id : null;
}

/** Whose decisions are listed. Rebuilds the list and picks its first real one. */
function setTeam(teamId) {
  const world = state.world;
  state.teamId = teamId;
  state.seasonTeamId = teamId;
  state.wi = { gives: [], gets: [] };
  if (!world || teamId === null || !world.weeks.length) {
    state.decisions = [];
    state.selectedId = null;
    render();
    return;
  }
  buildDecisions();
  state.selectedId = firstId();
  render();
}

/** "All users" on or off. The team picked stays picked underneath. */
function setAll(on) {
  state.all = on;
  prefs.set(`all.${state.leagueKey}`, on ? true : null);
  simDelay = SIM_DELAY_MS;
  setTeam(state.teamId);
}

function buildDecisions() {
  const world = state.world;
  if (state.all) { state.decisions = listDecisions(world, ALL_TEAMS); return; }
  const known = (w) => teamOf(w.teamId) && teamOf(w.withTeamId) && world.weeks.includes(w.week);
  const mineToo = (w) => same(w.teamId, state.teamId) || same(w.withTeamId, state.teamId);
  const extra = whatIfs().filter((w) => known(w) && mineToo(w)).map((w) => {
    const d = whatIfDecision(w, state.teamId);
    d.empty = !anyChanged(mirrorOf(d));
    return d;
  });
  // The lineup is one choice of two, each over every week: the engine's
  // one-week entries are not offered here.
  const offered = (d) => !d.kind.startsWith('lineup-') || d.week === null;
  state.decisions = [...extra, ...listDecisions(world, state.teamId).filter(offered)];
}

const selected = () => state.decisions.find((d) => d.id === state.selectedId) || null;

// -------------------------------------------------------------------- rendering

function render() {
  const world = state.world;
  if (!world) return;

  $('modeBadge').className = 'badge ' + (world.isDemo ? 'demo' : 'live');
  $('modeBadge').textContent = world.isDemo ? 'Demo' : 'Live';
  const n = world.weeks.length;
  $('pageSub').textContent = world.isDemo
    ? `Demo League · ${n} finished weeks · generated data, so you can see the layout`
    : `${world.name} · ${weeksSaid(world)}`;

  // With all users on the picker says so, and picking a team in it — the one
  // it showed before included — goes back to that team.
  $('teamSelect').innerHTML = (state.all ? '<option value="" selected>All users</option>' : '') + world.teams
    .map((t) => `<option value="${esc(t.id)}"${!state.all && same(t.id, state.teamId) ? ' selected' : ''}>${esc(teamName(t.id))}</option>`)
    .join('');
  $('allSwitch').checked = state.all;
  $('noiseSwitch').checked = state.noise;

  // FEWER THAN ONE FINISHED WEEK: nothing has happened to replay.
  const any = n > 0 && state.teamId !== null;
  for (const id of ['main', 'panelSeason', 'panelStandings', 'panelSummary']) $(id).hidden = !any;
  if (!any) {
    $('panelNotes').hidden = true;
    if (world.isDemo) setStatus('No finished week yet.');
    return;
  }

  // A choice that is no longer in the list (one week's lineup used to be a
  // row of its own) falls back to the list's first.
  if (!selected()) state.selectedId = firstId();
  $('whatIfBox').hidden = state.all;
  renderList();
  renderWhatIfForm();
  renderDecision();
}

/** Everything that follows from WHICH decision is picked. The list is not redrawn. */
function renderDecision() {
  for (const b of $('decisionList').querySelectorAll('.dz-row')) {
    b.setAttribute('aria-selected', String(b.dataset.id === state.selectedId));
  }
  renderResult();
  renderSeason();
  renderStandings();
  renderSummary();
  renderNotes();
}

/** Is this team's week still live in this mirror — the week in play, with anything of it to come? */
function liveCell(m, teamId, week) {
  const t = m.teams.get(teamId);
  const c = t && t.byWeek[week];
  return Boolean(c && c.live);
}

/**
 * Does a row of the list wear the LIVE tag? A week's entry when that week is
 * live for the picked team; a whole-season entry when the week in play is.
 * With all users on: when it is live for any team.
 */
function liveRow(d) {
  const partial = state.world.partialWeek;
  if (!Number.isFinite(partial)) return false;
  const whole = d.week === null || d.week === undefined;
  if (!(whole || d.week === partial)) return false;
  const m = mirrorOf(d);
  return state.all
    ? state.world.teams.some((t) => liveCell(m, t.id, partial))
    : liveCell(m, state.teamId, partial);
}

/**
 * One team's season in a mirror: its points in each world, every week held, the
 * one in play included — and how many weeks that is.
 */
function seasonPoints(m, teamId) {
  const mine = m.teams.get(teamId);
  let hyp = 0;
  let real = 0;
  let weeks = 0;
  for (const c of Object.values((mine && mine.byWeek) || {})) {
    hyp += c.total;
    real += c.realTotal;
    weeks++;
  }
  return { hyp, real, weeks };
}

/**
 * POINTS A WEEK (Tim, 2026-10-06: "show the points in that box on the end as
 * points/week, not just points in general"): a season's difference over the
 * weeks it was added up from. Those are the weeks the Total row counts — every
 * week the world holds for that team, the one in play included — so the tile
 * times that many weeks is the Total row's Diff, to the rounding of one decimal.
 */
const perWeek = (points, weeks) => (points === null || !weeks ? null : round1(points / weeks));

/**
 * The numbers a row of the list leads with, for the picked team. With all
 * users on there is no one record to change (a win gained is a win lost
 * across the table), so the row leads with the league's points alone.
 */
function headline(decision) {
  const m = mirrorOf(decision);
  if (state.all) {
    let hyp = 0;
    let real = 0;
    for (const t of state.world.teams) { const p = seasonPoints(m, t.id); hyp += p.hyp; real += p.real; }
    return { record: null, points: diffOf(hyp, real) };
  }
  const rec = m.records.get(state.teamId);
  // The table's Total row.
  const { hyp, real } = seasonPoints(m, state.teamId);
  return {
    record: rec ? recordDiff(rec.mirror, rec.real) : null,
    points: diffOf(hyp, real),
  };
}

function rowHtml(d) {
  const wk = d.week === null || d.week === undefined ? 'All' : `Wk ${d.week}`;
  const what = LINEUP_SAID[d.kind] || d.label;
  let nums;
  if (d.empty) {
    nums = '<span class="dz-none">No change</span>';
  } else {
    const h = headline(d);
    nums =
      `<span class="dz-rec ${h.record ? diffClass(h.record.value) : ''}">${h.record ? esc(h.record.text) : state.all ? '' : '—'}</span>` +
      `<span class="dz-pts ${diffClass(h.points)}">${signedText(h.points)}</span>`;
  }
  return `<div class="dz-item">` +
    `<button type="button" class="dz-row" role="option" data-id="${esc(d.id)}" data-kind="${esc(d.kind)}"` +
    `${d.empty ? ' data-empty="1"' : ''} aria-selected="${d.id === state.selectedId}" title="${esc(d.label)}">` +
    `<span class="dz-wk">${wk}</span><span class="dz-what">${liveRow(d) ? LIVE_TAG : ''}${esc(what)}</span>${nums}</button>` +
    (d.whatIf
      ? `<button type="button" class="dz-x" data-remove="${esc(d.id)}" aria-label="Remove this trade" title="Remove this trade">×</button>`
      : '') +
    `</div>`;
}

function renderList() {
  const group = (label, list) =>
    (list.length ? `<div class="dz-group" role="presentation">${label}</div>${list.map(rowHtml).join('')}` : '');
  const lineup = (d) => d.kind === 'lineup-reasonable' || d.kind === 'lineup-perfect';
  const all = state.decisions;
  $('decisionList').innerHTML =
    group('What if', all.filter((d) => d.whatIf)) +
    group('Moves', all.filter((d) => !d.whatIf && !lineup(d))) +
    group('Lineups', all.filter(lineup));
}

// ------------------------------------------------------------ the biggest thing

const gameOf = (games, teamId, week) =>
  (games || []).find((g) => g.week === week && (g.homeId === teamId || g.awayId === teamId)) || null;

/** One side's score and the other's, as [mine, theirs], or null without a game. */
function scores(g, teamId) {
  if (!g) return null;
  return g.homeId === teamId ? [g.homeActual, g.awayActual] : [g.awayActual, g.homeActual];
}

function resultLetter(g, teamId) {
  const s = scores(g, teamId);
  if (!s || !Number.isFinite(s[0]) || !Number.isFinite(s[1])) return null;
  return s[0] > s[1] ? 'W' : s[0] < s[1] ? 'L' : 'T';
}

const RANK = { L: 0, T: 1, W: 2 };

/**
 * ` data-v="…"` for a cell that prints something js/sortable.js cannot rank
 * ("2-1", "W → L", "+1 W", a number beside a live tag) — or nothing at all for
 * a value that is not known, so the dash it prints sorts to the bottom.
 */
const sortV = (v) => (v === null || v === undefined || Number.isNaN(v) ? '' : ` data-v="${esc(v)}"`);

/** A record as ESPN ranks one — win share, a tie as half — then the points. The Stats page's key. */
function recordKey(r, points) {
  if (!r) return null;
  const games = r.w + r.l + (r.t || 0);
  return (games ? (r.w + (r.t || 0) / 2) / games : 0) * 1e6 + (Number.isFinite(points) ? points : 0);
}

/**
 * A week's result as a number: a flip the team's way on top, one against it at
 * the bottom, and between them W, T, L as they stand. A matchup still in play
 * has no result in both worlds yet and goes under them all.
 */
const resultKey = (was, is) => (was && is ? (RANK[is] - RANK[was]) * 10 + RANK[is] : null);
const PENDING_KEY = -99;

/** What the hypothetical IS, in a few words, over the result. */
function ledeOf(d) {
  if (d.whatIf) return `If accepted from week ${d.week}: ${d.label}.`;
  if (LINEUP_SAID[d.kind]) return `${d.label}.`;
  return `Undone: ${d.label} (week ${d.week}).`;
}

// ------------------------------------------------- the lineup counts
//
// Tim, 2026-10-07: "for perfect, could you add a column that shows how many
// players they should have benched (either just that week if the specific user
// is selected, or in total if it's on all users) ... for reasonable, show how
// many players they started that they should have benched based on highest
// proj (also weekly or total). Additionally for reasonable show how many
// players they started that were proj 0 points that week."
//
// Both are counted off the cell the table already prints: Benched is the real
// starters the hypothetical lineup leaves out, Proj 0 the real starters ESPN
// projected for nothing. A man the feed sent no projection for is not a zero.

const benchedIn = (c) => (c
  ? c.realStarters.filter((r) => !c.starters.some((s) => same(s.playerId, r.playerId))).length
  : 0);
const zeroIn = (c) => (c ? c.realStarters.filter((p) => p.projected === 0 && !p.noProj).length : 0);

/** The two count cells of a row; a column the picked decision has no use for stays hidden. */
function countCells(d, benched, zeros) {
  const lineup = Boolean(d && LINEUP_SAID[d.kind]);
  const zero = Boolean(d && d.kind === 'lineup-reasonable');
  return `<td class="dz-lu"${lineup ? '' : ' hidden'} data-v="${benched}">${benched}</td>` +
    `<td class="dz-lu0"${zero ? '' : ' hidden'} data-v="${zeros}">${zeros}</td>`;
}

/** The two headings follow the picked decision, in both tables. */
function showCountHeads(d) {
  const lineup = Boolean(d && LINEUP_SAID[d.kind]);
  const zero = Boolean(d && d.kind === 'lineup-reasonable');
  for (const th of document.querySelectorAll('#panelResult th.dz-lu')) th.hidden = !lineup;
  for (const th of document.querySelectorAll('#panelResult th.dz-lu0')) th.hidden = !zero;
}

/**
 * ALL USERS: one row a team — its record in each world, the change, and its
 * points — in the Standings order, so the two panels read alike.
 */
function renderTeams(d) {
  const world = state.world;
  const m = mirrorOf(d);
  const partial = Number.isFinite(world.partialWeek) ? world.partialWeek : null;
  const order = standingsOf(countedGames(m)).teams
    .slice().sort((a, b) => a.actualStanding - b.actualStanding).map((t) => t.id);
  $('teamTable').querySelector('tbody').innerHTML = order.map((id) => {
    const rec = m.records.get(id);
    const change = rec ? recordDiff(rec.mirror, rec.real) : null;
    const { hyp, real, weeks } = seasonPoints(m, id);
    const each = perWeek(diffOf(hyp, real, 2), weeks);
    const live = partial !== null && liveCell(m, id, partial);
    const cells = world.weeks.map((w) => m.teams.get(id).byWeek[w]);
    const count = (of) => cells.reduce((a, c) => a + of(c), 0);
    // What each cell SORTS on, where that is not what it prints: the name
    // without its live tag, a record the way ESPN ranks one, a change in wins.
    return `<tr data-team="${esc(id)}">` +
      `<td class="dz-team" data-v="${esc(teamName(id))}" title="${esc(teamName(id))}">${esc(teamName(id))}${live ? LIVE_TAG : ''}</td>` +
      `<td class="dz-act"${sortV(recordKey(rec && rec.real, real))}>${recText(rec && rec.real)}</td>` +
      `<td class="dz-hyp"${sortV(recordKey(rec && rec.mirror, hyp))}>${recText(rec && rec.mirror)}</td>` +
      `<td class="dz-res ${change ? diffClass(change.value) : ''}"${sortV(change && change.value)}>${change ? esc(change.text) : '—'}</td>` +
      `<td class="dz-diff ${diffClass(each)}"${sortV(each)}>` +
      whyHtml(`data-why="team" data-team="${esc(id)}"`, `${teamName(id)}: the weeks behind this number`, signedText(each)) +
      `</td>${countCells(d, count(benchedIn), count(zeroIn))}</tr>`;
  }).join('');
  resort($('teamTable'));
  $('resultLede').textContent = ledeOf(d) + (d.empty ? ' No change.' : '');
}

function renderResult() {
  const world = state.world;
  const d = selected();
  const table = $('weekTable');
  const [body, foot] = table.querySelectorAll('tbody');
  const teams = Boolean(d && state.all);
  closeWhy();
  showCountHeads(d);
  table.hidden = teams;
  $('resultStats').hidden = teams;
  $('resultBig').hidden = teams;
  $('teamTable').hidden = !teams;
  if (teams) { renderTeams(d); return; }
  renderBiggest(d);
  if (!d) {
    $('resultLede').textContent = 'No decisions yet.';
    $('resultStats').innerHTML = '';
    body.innerHTML = '';
    foot.innerHTML = '';
    return;
  }

  const m = mirrorOf(d);
  const id = state.teamId;
  const mine = m.teams.get(id);
  const rec = m.records.get(id);
  const noise = state.noise ? m.noise.get(id) || {} : {};
  let hyp = 0;
  let real = 0;
  let benched = 0;
  let zeros = 0;

  body.innerHTML = world.weeks.map((week) => {
    const c = mine.byWeek[week];
    const g = gameOf(world.games, id, week);
    // THE WEEK IN PLAY: its points always show and always count. Only the
    // RESULT waits, for a matchup not final in both worlds yet.
    const wk = `${week}${c.live ? LIVE_TAG : ''}`;
    const mg = gameOf(m.games, id, week);
    const was = resultLetter(g, id);
    const is = resultLetter(mg, id);
    const flip = Boolean(was && is && was !== is);
    const diff = diffOf(c.total, c.realTotal);
    const dim = dimStyle(noise[week]);
    hyp += c.total;
    real += c.realTotal;
    benched += benchedIn(c);
    zeros += zeroIn(c);

    const opp = g ? teamName(g.homeId === id ? g.awayId : g.homeId) : '—';
    const rs = scores(g, id);
    const ms = scores(mg, id);
    const said = rs && ms
      ? `Actual ${pts1(rs[0])} to ${pts1(rs[1])}. Hypothetical ${pts1(ms[0])} to ${pts1(ms[1])}.`
      : '';
    const resCls = flip ? ` dz-flip ${RANK[is] > RANK[was] ? 'd-up' : 'd-down'}` : '';
    const result = c.pending
      ? `<td class="dz-res muted"${sortV(PENDING_KEY)}>In play</td>`
      : `<td class="dz-res${resCls}"${sortV(resultKey(was, is))}${dim} title="${esc(said)}">${flip ? `${was} → ${is}` : was || '—'}</td>`;
    return `<tr data-wk="${week}"${flip ? ' data-flip="1"' : ''}${c.pending ? ' data-pending="1"' : ''}>` +
      `<td data-v="${week}">${wk}</td>` +
      `<td class="dz-vs" title="${esc(opp)}">${esc(opp)}</td>` +
      `<td class="dz-act"${sortV(c.realTotal)}>${pts1(c.realTotal)}</td>` +
      `<td class="dz-hyp"${sortV(c.total)}${dim}>${pts1(c.total)}</td>` +
      `<td class="dz-diff ${diffClass(diff)}"${sortV(diff)}${dim}>` +
      whyHtml(`data-why="week" data-wk="${week}"`, `Week ${week}: the players behind this difference`, signedText(diff)) +
      `</td>` +
      result + countCells(d, benchedIn(c), zeroIn(c)) +
      `</tr>`;
  }).join('');

  // The tile's season (to the cent, as before) and the Total row's: the two
  // totals as printed, and the Diff their subtraction.
  const total = diffOf(hyp, real, 2);
  const shown = diffOf(hyp, real);
  const change = rec ? recordDiff(rec.mirror, rec.real) : null;
  foot.innerHTML = `<tr><td colspan="2">Total</td>` +
    `<td class="dz-act">${pts1(real)}</td><td class="dz-hyp">${pts1(hyp)}</td>` +
    `<td class="dz-diff ${diffClass(shown)}" data-v="${shown}">${signedText(shown)}</td>` +
    `<td class="dz-res ${change ? diffClass(change.value) : ''}">${change ? esc(change.text) : '—'}</td>` +
    `${countCells(d, benched, zeros)}</tr>`;
  // The reader's column survives a new team, a new decision and the noise switch.
  resort(table);

  $('resultLede').textContent = ledeOf(d) + (d.empty ? ' No change.' : '');
  const stat = (k, v, cls = '', key = '') =>
    `<div class="stat"><div class="k">${k}</div><div class="v${cls ? ` ${cls}` : ''}"` +
    `${key ? ` data-stat="${key}"` : ''}>${v}</div></div>`;
  // The third tile is a week's worth; the season's is the Total row's Diff.
  const each = perWeek(total, world.weeks.length);
  $('resultStats').innerHTML =
    stat('Actual record', recText(rec && rec.real), '', 'real') +
    stat('Hypothetical', recText(rec && rec.mirror), change && change.value ? diffClass(change.value) : '', 'mirror') +
    stat('Points/wk', signedText(each), each ? diffClass(each) : '', 'points');
}

// ----------------------------------------- where a difference comes from
//
// Tim, 2026-10-06: "it shows valuable information, but it's really hard to know
// where that data is coming from or the specifics on when the user started
// someone with less points". A week's Diff is the men who started in one world
// and not the other, so it opens them: slot, who really started, who starts
// instead, and what that is worth — adding up to the Diff. With all users on, a
// team's Points/wk opens its weeks the same way. And the biggest of the picked
// decision's swaps is said in the box itself, on a button that opens its week.
//
// The Stats page's "where the last figure comes from", copied and not shared
// (a possible follow-up): a mouse hovers or focuses and gets a card beside the
// number; a finger has no hover, so a tap opens a sheet with a Close button. A
// tap outside or Escape shuts either. Nothing here is reachable only by hovering.

const swapsOf = typeof engine.weekSwaps === 'function' ? engine.weekSwaps : null;

/** A number that opens what it is made of — or the bare number, on an engine too old to say. */
function whyHtml(attrs, label, inner) {
  if (!swapsOf) return inner;
  return `<span class="dz-why" ${attrs} tabindex="0" role="button" aria-label="${esc(label)}">${inner}</span>`;
}

/** "J. Warren 8.7": a man and what he counts for. One still playing is his projection, drawn apart. */
const manHtml = (p) => (p
  ? `<span class="dz-man">${esc(shortName(p))} <span class="pv${p.known ? '' : ' dz-proj'}">${pts(p.points).replace('-', '−')}</span></span>`
  : '—');

/** "J. Warren 8.7 → O. Hampton 16.5": who really started, then who starts instead. */
const swapHtml = (r) => `${manHtml(r.out)} → ${manHtml(r.in)}`;

/** The picked team's cell for a week in the picked decision's mirror, or null. */
function cellOf(d, week) {
  const mine = d ? mirrorOf(d).teams.get(state.teamId) : null;
  return (mine && mine.byWeek[week]) || null;
}

/**
 * THE BIGGEST SWAP, in the box without hovering: the week whose Diff is
 * furthest from zero (the earliest of equals), and in it the swap worth most.
 * The line keeps its room when there is none, so the table under it does not
 * move from one decision to the next.
 */
function renderBiggest(d) {
  const el = $('resultBig');
  let best = null;
  if (d && swapsOf) {
    for (const week of state.world.weeks) {
      const c = cellOf(d, week);
      const size = c ? Math.abs(diffOf(c.total, c.realTotal, 2)) : 0;
      if (size > (best ? best.size : 0)) best = { week, size, cell: c };
    }
  }
  const row = best
    ? swapsOf(best.cell).rows.reduce((a, r) => (a && Math.abs(a.diff) >= Math.abs(r.diff) ? a : r), null)
    : null;
  el.classList.toggle('is-empty', !row);
  el.disabled = !row;
  if (!row) { el.removeAttribute('data-wk'); el.innerHTML = '<span class="k">Biggest swap</span>'; return; }
  el.setAttribute('data-wk', best.week);
  el.innerHTML = `<span class="k">Biggest swap</span>` +
    `<span class="dz-big-what">Wk ${best.week} · ${swapHtml(row)}</span>` +
    `<span class="dz-big-d ${diffClass(row.diff)}">${signedPts(row.diff)}</span>`;
}

/** One week of the picked team: its swaps, then Actual, Hypothetical and the Diff they add up to. */
function weekWhyHtml(week) {
  const d = selected();
  const c = cellOf(d, week);
  if (!c || !swapsOf) return '';
  const id = state.teamId;
  const g = gameOf(state.world.games, id, week);
  const w = swapsOf(c);
  const rows = w.rows.map((r) =>
    `<tr><td class="name">${esc(r.slot)}</td><td class="name">${manHtml(r.out)}</td>` +
    `<td class="name">${manHtml(r.in)}</td><td class="num ${diffClass(r.diff)}">${signedPts(r.diff)}</td></tr>`).join('');
  const foot = (label, value, cls = '') =>
    `<tr${cls ? ` class="${cls}"` : ''}><td class="name" colspan="3">${label}</td><td class="num">${value}</td></tr>`;
  // The foot is the table's row: Actual and Hypothetical to the tenth, and the
  // Diff of those two as printed. The men above keep ESPN's cents, so what
  // their swaps do not add up to — the engine's own gap, and now the cents the
  // row rounds away — is the Rounding line.
  const diff = diffOf(c.total, c.realTotal);
  const rest = round2(diff - w.sum);
  return (
    `<div class="op-h">Week ${week}${c.live ? LIVE_TAG : ''}` +
    (g ? ` <span class="muted">· vs ${esc(teamName(g.homeId === id ? g.awayId : g.homeId))}</span>` : '') + `</div>` +
    '<table><thead><tr><th class="name">Slot</th><th class="name">Started</th><th class="name">Instead</th><th class="num">+/−</th></tr></thead>' +
    `<tbody>${rows || '<tr><td class="name muted" colspan="4">Same lineup</td></tr>'}</tbody><tfoot>` +
    // The rows are the whole of the Diff. Were they ever not, the gap is said.
    (rest ? foot('Rounding', signedPts(rest)) : '') +
    foot('Actual', pts1(c.realTotal)) +
    foot('Hypothetical', pts1(c.total)) +
    foot('Diff', signedText(diff), 'op-gap') +
    '</tfoot></table>' + WHY_ACTS
  );
}

/** ALL USERS: one team's weeks, their Total, and the Points/wk that is the Total over those weeks. */
function teamWhyHtml(teamId) {
  const d = selected();
  const t = teamOf(teamId);
  const mine = d && t ? mirrorOf(d).teams.get(t.id) : null;
  if (!mine) return '';
  const weeks = state.world.weeks.filter((w) => mine.byWeek[w]);
  const rows = weeks.map((week) => {
    const c = mine.byWeek[week];
    const diff = diffOf(c.total, c.realTotal);
    return `<tr><td class="num">${week}${c.live ? LIVE_TAG : ''}</td><td class="num">${pts1(c.realTotal)}</td>` +
      `<td class="num">${pts1(c.total)}</td><td class="num ${diffClass(diff)}">${signedText(diff)}</td></tr>`;
  }).join('');
  const { hyp, real } = seasonPoints(mirrorOf(d), t.id);
  // Points/wk is the season to the cent over its weeks, as in the table.
  const total = diffOf(hyp, real, 2);
  return (
    `<div class="op-h">${esc(teamName(t.id))} <span class="muted">· ${weeks.length} week${weeks.length === 1 ? '' : 's'}</span></div>` +
    '<table><thead><tr><th class="num">Wk</th><th class="num">Actual</th><th class="num">Hypothetical</th><th class="num">Diff</th></tr></thead>' +
    `<tbody>${rows}</tbody><tfoot>` +
    `<tr><td class="num">Total</td><td class="num">${pts1(real)}</td><td class="num">${pts1(hyp)}</td>` +
    `<td class="num">${signedText(diffOf(hyp, real))}</td></tr>` +
    `<tr class="op-gap"><td class="num" colspan="3">Points/wk</td><td class="num">${signedText(perWeek(total, weeks.length))}</td></tr>` +
    '</tfoot></table>' + WHY_ACTS
  );
}

let whyPop = null;
/** What the open preview is of: { why, key } — a week's number, or a team's. */
let whyAt = null;
/** No card opens by hover or focus before this time: the page is moving under the mouse. */
let quietUntil = 0;

const whyKey = (el) => ({ why: el.dataset.why === 'team' ? 'team' : 'week', key: el.dataset.why === 'team' ? el.dataset.team : el.dataset.wk });
const whyOpenFor = (el) => {
  const k = whyKey(el);
  return Boolean(whyPop && !whyPop.hidden && whyAt && whyAt.why === k.why && same(whyAt.key, k.key));
};

function closeWhy() {
  if (whyPop) whyPop.hidden = true;
  whyAt = null;
}

function openWhy(el, sheet) {
  const html = el.dataset.why === 'team' ? teamWhyHtml(el.dataset.team) : weekWhyHtml(Number(el.dataset.wk));
  if (!html) return;
  if (!whyPop) {
    whyPop = document.createElement('div');
    whyPop.id = 'whyPop';
    document.body.appendChild(whyPop);
    whyPop.addEventListener('click', (e) => {
      if (!e.target.closest) return;
      if (e.target.closest('.op-go') && whyAt) goSeason(whyAt, e);
      else if (e.target.closest('.op-close')) closeWhy();
    });
  }
  whyAt = whyKey(el);
  whyPop.className = sheet ? 'dz-pop sheet' : 'dz-pop';
  whyPop.innerHTML = html;
  whyPop.hidden = false;
  whyPop.style.left = '';
  whyPop.style.top = '';
  if (sheet || typeof el.getBoundingClientRect !== 'function') return;
  // Beside the number: its right edge on the number's, below it unless only
  // above has the room.
  const r = el.getBoundingClientRect();
  const w = whyPop.offsetWidth;
  const h = whyPop.offsetHeight;
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
  const below = r.bottom + 6;
  const top = below + h <= window.innerHeight - 8 ? below : Math.max(8, r.top - h - 6);
  whyPop.style.left = `${left}px`;
  whyPop.style.top = `${top}px`;
}

// FROM A PREVIEW TO THE LINEUPS BEHIND IT (Tim, 2026-10-06: "if the user clicks
// on the number while the preview is open, then automatically pull up that
// player's season by week right below"). The number with its preview open — a
// second click, a tap, Enter — or the sheet's own button goes to Season by week:
// that team's lineups, scrolled to, and for a week's preview that week's column
// outlined in both halves until the next click anywhere.
//
// WITH ALL USERS ON the team is picked in the panel's own "Lineup of", not in
// the Team picker: that one leaves All users and swaps the decision, so the box
// just clicked in would be redrawn as something else.

/** The sheet's two buttons. A mouse's card has neither: it shuts as the mouse leaves the number. */
const WHY_ACTS = '<div class="op-acts"><button type="button" class="op-go">Season by week</button>' +
  '<button type="button" class="op-close">Close</button></div>';

/** The click that set `state.markWeek`, so that same click does not clear it. */
let markedBy = null;

/** Outline `state.markWeek`'s column in both halves of Season by week; none when it is null. */
function paintMark() {
  for (const id of ['seasonCur', 'seasonHyp']) {
    const table = $(id).querySelector('table');
    if (!table) continue;
    for (const c of table.querySelectorAll('.dz-at')) c.classList.remove('dz-at');
    if (state.markWeek === null) continue;
    const cells = [...table.querySelectorAll(`td[data-wk="${state.markWeek}"]`)];
    if (!cells.length) continue;
    const head = table.querySelector('thead tr').children[[...cells[0].parentElement.children].indexOf(cells[0])];
    for (const c of [head, ...cells]) if (c) c.classList.add('dz-at');
  }
}

/** @param {{why:string, key:*}} at what the preview was of  @param {Event} [e] the click, if one */
function goSeason(at, e = null) {
  const team = at.why === 'team' ? teamOf(at.key) : teamOf(state.teamId);
  if (!team) return;
  closeWhy();
  quietUntil = Date.now() + 900;
  state.markWeek = at.why === 'team' ? null : Number(at.key);
  markedBy = e;
  if (same(state.seasonTeamId, team.id)) paintMark();
  else { state.seasonTeamId = team.id; renderSeason(); }
  const panel = $('panelSeason');
  // Seen to move, never a jump (and nothing else on the page changes size).
  if (typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** One set of listeners on the panel, which outlives every redraw of its tables. */
function wireWhy(panel) {
  const target = (e) => (e.target && e.target.closest ? e.target.closest('[data-why]') : null);
  const noHover = () => !!(window.matchMedia && window.matchMedia('(hover: none)').matches);
  // Moving between the words of one number is not leaving it.
  const within = (e, el) => Boolean(e.relatedTarget && el.contains(e.relatedTarget));
  const quiet = () => Date.now() < quietUntil;
  // A number whose preview is open goes on to Season by week; any other opens its preview.
  const hit = (el, e) => (whyOpenFor(el) ? goSeason(whyKey(el), e) : openWhy(el, noHover()));
  panel.addEventListener('mouseover', (e) => {
    const el = target(e);
    if (el && !noHover() && !quiet() && !within(e, el)) openWhy(el, false);
  });
  panel.addEventListener('mouseout', (e) => {
    const el = target(e);
    if (el && !noHover() && !within(e, el)) closeWhy();
  });
  panel.addEventListener('click', (e) => {
    const el = target(e);
    if (el) hit(el, e);
  });
  panel.addEventListener('keydown', (e) => {
    const el = target(e);
    if (!el || el.tagName === 'BUTTON' || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    hit(el, e);
  });
  panel.addEventListener('focusin', (e) => {
    const el = target(e);
    // (A click focuses the number first: its preview is then open already, and
    // drawing it again would only move it.)
    if (el && !noHover() && !whyOpenFor(el)) openWhy(el, false);
  });
  panel.addEventListener('focusout', () => { if (!noHover()) closeWhy(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeWhy(); });
  document.addEventListener('click', (e) => {
    if (!whyPop || whyPop.hidden) return;
    if (whyPop.contains(e.target) || target(e)) return;
    closeWhy();
  });
  // The outlined week stays until the next click, wherever that is.
  document.addEventListener('click', (e) => {
    if (state.markWeek === null || e === markedBy) return;
    state.markWeek = null;
    paintMark();
  });
}

// ------------------------------------------------------------- the three charts

const changedTeams = (m) => state.world.teams
  .filter((t) => Object.values(m.teams.get(t.id).byWeek).some((c) => c.changed))
  .map((t) => t.id);

function renderSeason() {
  const world = state.world;
  const d = selected();
  $('seasonSwitch').innerHTML = viewSwitchHtml(state.view.season, { box: 'season' });
  if (!d) { $('seasonCur').innerHTML = ''; $('seasonHyp').innerHTML = ''; $('seasonTeamRow').hidden = true; return; }
  const m = mirrorOf(d);

  // A trade changes two lineups, and a freed player can change a third: the
  // small select offers every squad whose lineup is not the real one. With all
  // users on that is anybody's, so it offers them all.
  const others = (state.all ? state.world.teams.map((t) => t.id) : changedTeams(m))
    .filter((id) => !same(id, state.teamId));
  const offered = state.all ? state.world.teams.map((t) => t.id) : [state.teamId, ...others];
  if (!offered.some((id) => same(id, state.seasonTeamId))) state.seasonTeamId = state.teamId;
  $('seasonTeamRow').hidden = !others.length;
  $('seasonTeam').innerHTML = offered
    .map((id) => `<option value="${esc(id)}"${same(id, state.seasonTeamId) ? ' selected' : ''}>${esc(teamName(id))}</option>`)
    .join('');

  const cells = m.teams.get(state.seasonTeamId);
  // A week still in play: a man who has finished shows his points, one who has
  // not the projection he counts for meanwhile (drawn apart by the renderer),
  // and the column head carries the LIVE tag.
  const real = weeksFromMirror(cells, 'real');
  const hyp = weeksFromMirror(cells, 'mirror');
  const live = world.weeks.filter((w) => cells.byWeek[w].live);
  const dim = state.noise ? m.noise.get(state.seasonTeamId) || null : null;
  // THE SITE'S RED/GREEN SCALE, as on Analysis's own Season by week: each slot
  // against the other squads' same slot in that week. Each half is measured on
  // its own world's league (as each half of Standings is), and a week anybody
  // is still playing is left uncoloured, as it is there.
  const playing = world.weeks.filter((w) => world.teams.some((t) => liveCell(m, t.id, w)));
  const heat = (which) => (typeof seasonTable.seasonHeat === 'function'
    ? seasonTable.seasonHeat(world.teams.map((t) => weeksFromMirror(m.teams.get(t.id), which)),
      { slots: world.slots, skip: playing })
    : null);
  // Tim, 2026-10-06: "also highlight any positions/player's that changed in the
  // current graph so that you can look over and see what player they started in
  // real life and who they should have started instead ... show their proj score
  // to the left ... in a dimmer grey ... add a column ... that shows the avg for
  // each row" (on the right, he said after).
  //
  // WHO IS MARKED is `weekSwaps`' answer, the one the week's preview prints: its
  // Started men in Current, its Instead men in the hypothetical. So a man who
  // only moved to another slot is not marked, and the two never disagree.
  const outs = new Map();
  const ins = new Map();
  if (swapsOf) {
    for (const w of world.weeks) {
      const rows = cells.byWeek[w] ? swapsOf(cells.byWeek[w]).rows : [];
      outs.set(w, new Set(rows.filter((r) => r.out).map((r) => r.out.playerId)));
      ins.set(w, new Set(rows.filter((r) => r.in).map((r) => r.in.playerId)));
    }
  }
  const markOf = (sets) => (swapsOf ? (week, id) => Boolean(sets.get(week) && sets.get(week).has(id)) : null);
  // The Avg column on the same scale: a slot's Avg against the other squads'.
  const avgHeat = (which) => (typeof seasonTable.seasonAvgHeat === 'function'
    ? seasonTable.seasonAvgHeat(world.teams.map((t) => weeksFromMirror(m.teams.get(t.id), which)), { slots: world.slots })
    : null);
  $('seasonCur').innerHTML = actualSeasonTableHtml({ weeks: real, slots: world.slots }, {
    box: 'current', live, sortable: true, heat: heat('real'),
    proj: true, avg: true, avgHeat: avgHeat('real'), mark: markOf(outs),
  });
  $('seasonHyp').innerHTML = actualSeasonTableHtml({ weeks: hyp, slots: world.slots }, {
    box: 'hypothetical', dim, live, sortable: true, heat: heat('mirror'),
    proj: true, avg: true, avgHeat: avgHeat('mirror'), mark: markOf(ins),
    diffFrom: state.view.season === 'diff' ? real : null,
  });
  sortPair('season');
  fitSeason();
  paintMark();
}

/**
 * Season by week gains a column a week, so whether Current and Hypothetical fit
 * side by side is a fact about the tables and not about the screen. The wider
 * one's own width goes to the stylesheet as `--dz-need` (decisions.html,
 * `.dz-fit`), which puts them in two halves while that fits and one above the
 * other once it does not — so neither ever scrolls sideways on a laptop.
 */
function fitSeason() {
  let need = 0;
  for (const id of ['seasonCur', 'seasonHyp']) {
    const table = $(id).querySelector('table');
    if (!table) continue;
    // A table is drawn as wide as its box; `auto` is as wide as its columns.
    table.style.width = 'auto';
    need = Math.max(need, table.offsetWidth || 0);
    table.style.width = '';
  }
  const pair = $('seasonCur').closest('.dz-pair');
  if (need) pair.style.setProperty('--dz-need', `${Math.ceil(need)}px`);
  else pair.style.removeProperty('--dz-need');
}

/** One number per team for a chart with a row a team: its noisiest week. */
function teamDim(m) {
  if (!state.noise) return null;
  const out = new Map();
  for (const [id, byWeek] of m.noise) out.set(id, Math.max(0, ...Object.values(byWeek)));
  return out;
}

const gameKey = (g) => `${g.week}|${g.homeId}|${g.awayId}`;

/** The real games a mirror counts: all of them but the ones it holds as pending. */
function countedGames(m) {
  const held = new Set((m.pending || []).map(gameKey));
  return state.world.games.filter((g) => !held.has(gameKey(g)));
}

function standingsOf(games) {
  const world = state.world;
  const final = new Set(world.weeks);
  const counted = games.filter((g) => final.has(g.week));
  return computeLeagueStats({
    season: state.season, name: world.name, isDemo: world.isDemo,
    weeks: new Set(counted.map((g) => g.week)).size, teams: world.teams,
    games: counted, injuries: [],
  });
}

function renderStandings() {
  const d = selected();
  $('standingsSwitch').innerHTML = viewSwitchHtml(state.view.standings, { box: 'standings' });
  if (!d) { $('standingsCur').innerHTML = ''; $('standingsHyp').innerHTML = ''; return; }
  const m = mirrorOf(d);
  // The same games on both sides: a matchup pending in the mirror is in neither.
  const real = standingsOf(countedGames(m));
  const hyp = standingsOf(m.games);
  // BOTH IN THE REAL STANDINGS' ORDER, so a row reads straight across the pair.
  real.teams.sort((a, b) => a.actualStanding - b.actualStanding);
  const byId = new Map(hyp.teams.map((t) => [t.id, t]));
  hyp.teams = real.teams.map((t) => byId.get(t.id)).filter(Boolean);

  // No one team is "the picked one" with all users on.
  const highlightId = state.all ? null : state.teamId;
  // OPP PROJ is the fixture list against everybody's projections (`oppProjOf`),
  // which no decision here moves: the one figure on both halves, so 0.0 as a
  // difference. Dashes until the chart's read has landed.
  const oppProj = (state.odds && state.odds.oppProj) || null;
  $('standingsCur').innerHTML = standingsTableHtml(real, { highlightId, oppProj });
  $('standingsHyp').innerHTML = standingsTableHtml(hyp, {
    highlightId, dim: teamDim(m), oppProj,
    diffFrom: state.view.standings === 'diff' ? real : null, diffOppProj: oppProj,
  });
  sortPair('standings');
}

/**
 * OPP PROJ, the Stats page's column, from what this page has ALREADY read: each
 * team's average projected opponent over the whole fixture list, through the two
 * functions Stats forms it with (js/projection.js). No request of its own — the
 * squads of the weeks played are the world's, and the weeks still to come are
 * the ones `loadOdds` read for the chart.
 *
 * @param {Array} games the fixture list: [{ week, homeId, awayId }]
 * @param {Map<number, Array>|null} ahead week -> squads, the weeks `loadOdds` read
 * @param {Map|null} floors the positional floor read with them
 * @returns {Map<*, {avgOpp:number}>|null} null when it cannot be formed
 */
function oppProjOf(games, ahead, floors) {
  const world = state.world;
  const held = world.rosters instanceof Map ? world.rosters : new Map();
  const weeks = [...new Set((games || []).map((g) => Number(g.week)))].sort((a, b) => a - b);
  const weekTeams = new Map();
  for (const w of weeks) {
    // A week in play is in both: the chart's reading counts a finished man at
    // his score, as Stats does; the world's holds his pre-game projection.
    const teams = (ahead && ahead.get(w)) || held.get(w);
    if (teams && teams.length) weekTeams.set(w, teams);
  }
  const built = projectionsFromWeekTeams(weekTeams, floors);
  if (!built) return null;
  const byTeam = opponentProjections(games, built.proj, world.teams.map((t) => t.id));
  return byTeam.size ? byTeam : null;
}

// -------------------------------------------------- the chart: the two worlds
//
// `state.odds` is what the Summary page holds about the league, read the way
// it reads it:
//
//   data     the schedule in the Schedule page's shape (capture.normalizeSchedule)
//   played   the decided games, with the started lineups' projections (LUCK)
//   teams    [{id, name, teamName}]
//   started  week -> teamId -> started projection, for the scoring spread
//   through  the last decided week
//   proj     week -> teamId -> projection, for the weeks still to play
//   live     capture.liveWeek(): the week in progress, or null
//   sigma    the league's scoring spread, measured on the REAL results
//   ready    the projections have landed, so a simulation can be asked for
//   failed   the season could not be read: record and LUCK only
//   fixtures the whole fixture list, played or not, and
//   oppProj  team id -> its average projected opponent (`oppProjOf`): the
//            Standings pair's Opp proj column, null until `ready`

function isRemainingAt(through) {
  return (g) => g.week > through || capture.gameState(g) !== 'final';
}

function oddsStatus(html) {
  $('oddsStatus').innerHTML = html;
}

async function loadOdds() {
  const world = state.world;
  const token = ++state.oddsToken;
  const stale = () => token !== state.oddsToken;
  state.odds = null;
  if (!world || !world.weeks.length) return;

  const finish = (o) => {
    const through = o.data.weeks.length
      ? Math.max(o.data.weeks[0], Math.min(capture.regularSeasonLastWeek(o.data), capture.decidedWeeks(o.data).slice(-1)[0] || 0))
      : 0;
    o.through = through;
    o.isRemaining = isRemainingAt(through);
    o.played = o.played.filter((g) => g.week <= through);
    // The spread is the real league's in both worlds: one decision does not
    // change how far this league's scores land from their projections.
    o.sigma = capture.leagueSpread(o.data, (g) => !o.isRemaining(g), o.started).sigma;
    return o;
  };

  if (world.isDemo) {
    // The sample season is complete, and carries its own projections.
    const nameById = new Map(world.teams.map((t) => [t.id, t.name]));
    const data = capture.normalizeSchedule({
      leagueName: world.name,
      teams: world.teams.map((t) => ({ id: t.id, name: t.name })),
      games: world.games.map((g) => ({
        week: g.week,
        homeId: g.homeId, homeName: nameById.get(g.homeId), homeScore: g.homeActual, homeProjected: g.homeProjected,
        awayId: g.awayId, awayName: nameById.get(g.awayId), awayScore: g.awayActual, awayProjected: g.awayProjected,
        played: true,
      })),
    }, { isDemo: true });
    state.odds = finish({
      data, played: world.games.slice(), teams: world.teams, started: null,
      proj: null, live: null, ready: true, failed: false,
      fixtures: world.games, oppProj: oppProjOf(world.games, null, null),
    });
    if (selected()) renderStandings();
    renderSummary();
    return;
  }

  renderSummary();
  let o;
  try {
    // The Summary page's two readings of one schedule (see its loadLive): the
    // played games with their STARTED projections, and the whole fixture list.
    const data = await season.fetchSeasonData();
    const schedule = await season.fetchSchedule();
    if (stale()) return;
    const started = new Map();
    for (const g of data.games) {
      if (!started.has(g.week)) started.set(g.week, new Map());
      const row = started.get(g.week);
      if (g.homeProjected > 0) row.set(g.homeId, g.homeProjected);
      if (g.awayProjected > 0) row.set(g.awayId, g.awayProjected);
    }
    o = finish({
      data: capture.normalizeSchedule(schedule, { isDemo: false }),
      played: data.games, teams: data.teams, started,
      proj: null, live: null, ready: false, failed: false,
      fixtures: schedule.games, oppProj: null,
    });
  } catch {
    if (stale()) return;
    // Record and LUCK from the world this page already holds; the two
    // percentages are left blank rather than guessed.
    state.odds = {
      data: null, played: world.games.filter((g) => Number.isFinite(g.homeActual) && Number.isFinite(g.awayActual)),
      teams: world.teams, started: null,
      through: world.weeks[world.weeks.length - 1], proj: null, live: null, ready: false, failed: true,
    };
    renderSummary();
    return;
  }
  state.odds = o;
  renderSummary();

  // Every week with a game still to play out, then the bracket weeks.
  const ahead = o.data.weeks.filter((w) => (o.data.byWeek.get(w) || []).some(o.isRemaining));
  const asking = ahead.concat(ahead.length ? capture.playoffWeeks(o.data) : []);
  let aheadTeams = null;
  let aheadFloors = null;
  if (asking.length) {
    let weekTeams = new Map();
    try { weekTeams = await season.fetchWeeksRosters(asking); } catch { weekTeams = new Map(); }
    if (stale()) return;

    const floorWeek = capture.floorWeek(o.data);
    let floors = null;
    try {
      if (typeof season.fetchFloors === 'function' && floorWeek) {
        const got = await season.fetchFloors(floorWeek);
        floors = got && got.size ? got : null;
      }
    } catch { floors = null; }
    if (stale()) return;

    const built = capture.buildProjection(o.data, capture.pickWeeks(weekTeams, asking), floors);
    // The week in progress, exactly as the Summary page reads it.
    let live = null;
    if (built && typeof season.fetchProGames === 'function') {
      let proGames = null;
      try { proGames = await season.fetchProGames(); } catch { proGames = null; }
      if (stale()) return;
      if (proGames && Object.keys(proGames).length) {
        live = capture.liveWeek({
          data: o.data, weekTeams, slots: built.slots, floors, proGames,
          asOf: typeof season.weekReadAt === 'function'
            ? season.weekReadAt(capture.openWeeks(o.data)[0]) : null,
        });
      }
    }
    o.live = live;
    o.proj = built ? built.proj : null;
    aheadTeams = weekTeams;
    aheadFloors = floors;
  }
  o.ready = true;
  o.oppProj = oppProjOf(o.fixtures, aheadTeams, aheadFloors);
  if (o.oppProj && selected()) renderStandings();
  renderSummary();
}

/** How far the mirror moved one team-week, or null where it did not. */
function deltaOf(m, teamId, week) {
  const t = m.teams.get(teamId);
  const c = t && t.byWeek[week];
  if (!c || c.pending) return null;
  const points = round2(c.total - c.realTotal);
  const projected = round2(c.projected - c.realProjected);
  return points || projected ? { points, projected } : null;
}

/**
 * The schedule with the mirror's results in place of the real ones.
 *
 * ONLY WHERE THE MIRROR DIFFERS, and as the real number plus the difference —
 * so a decision that changes nothing hands the simulation the very same
 * season, and gets the very same answer.
 *
 * A matchup the mirror holds as PENDING is not a result in the hypothetical,
 * even when it really is over (the mirror starts a man still to play): it goes
 * back to being a game in progress, so it is not banked.
 */
function mirrorSchedule(data, m) {
  const held = new Set((m.pending || []).map(gameKey));
  const games = data.games.map((g) => {
    if (capture.gameState(g) !== 'final') return g;
    if (held.has(gameKey(g))) {
      const { early, winner, margin, ...open } = g;
      return { ...open, played: false };
    }
    const h = deltaOf(m, g.homeId, g.week);
    const a = deltaOf(m, g.awayId, g.week);
    if (!h && !a) return g;
    const homeScore = h && typeof g.homeScore === 'number' ? round2(g.homeScore + h.points) : g.homeScore;
    const awayScore = a && typeof g.awayScore === 'number' ? round2(g.awayScore + a.points) : g.awayScore;
    return {
      ...g, homeScore, awayScore,
      margin: round2(homeScore - awayScore),
      winner: homeScore > awayScore ? 'home' : awayScore > homeScore ? 'away' : 'tie',
    };
  });
  const byWeek = new Map();
  for (const g of games) {
    if (!byWeek.has(g.week)) byWeek.set(g.week, []);
    byWeek.get(g.week).push(g);
  }
  return { ...data, games, byWeek };
}

/** The played games (LUCK's input) with the mirror's scores and projections. */
function mirrorPlayed(played, m) {
  const held = new Set((m.pending || []).map(gameKey));
  return played.filter((g) => !held.has(gameKey(g))).map((g) => {
    const h = deltaOf(m, g.homeId, g.week);
    const a = deltaOf(m, g.awayId, g.week);
    if (!h && !a) return g;
    return {
      ...g,
      homeActual: h ? round2(g.homeActual + h.points) : g.homeActual,
      awayActual: a ? round2(g.awayActual + a.points) : g.awayActual,
      homeProjected: h ? round2(g.homeProjected + h.projected) : g.homeProjected,
      awayProjected: a ? round2(g.awayProjected + a.projected) : g.awayProjected,
    };
  });
}

/** The Summary page's `recordsOf`: the games the simulation banks. */
function recordsOf(data, isRemaining) {
  const rec = new Map(data.teams.map((t) => [t.id, { w: 0, l: 0, t: 0 }]));
  for (const g of data.games) {
    if (g.homeId == null || g.awayId == null) continue;
    const h = rec.get(g.homeId);
    const a = rec.get(g.awayId);
    if (!h || !a || isRemaining(g)) continue;
    const winner = capture.winnerOf(g);
    if (winner === 'home') { h.w++; a.l++; }
    else if (winner === 'away') { a.w++; h.l++; }
    else if (winner === 'tie') { h.t++; a.t++; }
  }
  return rec;
}

/** The record of a world that could not be read as a schedule: from its games. */
function recordsFromPlayed(teams, played) {
  const rec = new Map(teams.map((t) => [t.id, { w: 0, l: 0, t: 0 }]));
  for (const g of played) {
    const h = rec.get(g.homeId);
    const a = rec.get(g.awayId);
    if (!h || !a) continue;
    if (g.homeActual > g.awayActual) { h.w++; a.l++; }
    else if (g.awayActual > g.homeActual) { a.w++; h.l++; }
    else { h.t++; a.t++; }
  }
  return rec;
}

/**
 * One world's chart: its rows, and the simulation they are waiting on.
 *
 * @param {Object} o `state.odds`
 * @param {Object|null} m a mirror, or null for the season that happened
 */
function chartOf(o, m) {
  const data = o.data && m ? mirrorSchedule(o.data, m) : o.data;
  const played = m ? mirrorPlayed(o.played, m) : o.played;
  const weeksPlayed = new Set(played.map((g) => g.week)).size;
  const enough = weeksPlayed >= MIN_WEEKS;

  // LUCK, exactly as the Summary page's buildView computes it.
  const stats = computeLeagueStats({
    season: state.season, name: state.world.name, isDemo: state.world.isDemo,
    weeks: weeksPlayed, teams: o.teams, games: played, injuries: [],
  });
  const has = (t) => t.weekly.length > 0;
  const luck = new Map(stats.teams.map((t) => [t.id, has(t) ? t.luckScore : null]));
  const margin = new Map(stats.teams.map((t) => [t.id, has(t) ? (t.margins && t.margins.luckScore) ?? null : null]));

  const records = data ? recordsOf(data, o.isRemaining) : recordsFromPlayed(o.teams, played);
  // A game being played counts as its win chance in both worlds alike: the
  // decision is about weeks already finished.
  const chance = data && o.live && !data.isDemo
    ? capture.liveWinChances({ data: o.data, live: o.live, sigma: o.sigma })
    : new Map();

  let sim = null;
  let want = null;
  if (data && o.ready && enough) {
    const built = capture.simulationInputs({
      data, isRemaining: o.isRemaining, proj: o.proj, sigma: o.sigma,
      live: data.isDemo ? null : o.live || null,
    });
    if (built) {
      const key = JSON.stringify([SIM_RUNS, o.through, ...built.keyParts]);
      sim = sims.get(key) || null;
      if (!sim) want = { key, inputs: built, odds: o };
    }
  }

  const byId = new Map();
  if (sim && sim.result) {
    for (const row of sim.result.teams || []) {
      byId.set(row.teamId !== undefined ? row.teamId : row.id, row);
    }
  }
  const num = (v) => (Number.isFinite(v) ? v : null);
  const rows = o.teams.map((t) => {
    const s = byId.get(t.id) || null;
    const record = records.get(t.id) || null;
    return {
      id: t.id, name: t.name, teamName: t.teamName || null,
      record,
      rec: record ? capture.recordNow(record, chance.get(t.id) ?? null, { sep: '-' }) : null,
      luck: enough ? luck.get(t.id) ?? null : null,
      luckMargin: enough ? margin.get(t.id) ?? null : null,
      title: enough && s ? num(s.pTitle) : null,
      last: enough && s ? num(s.pLast) : null,
    };
  });
  return { rows, enough, shadeLuck: enough && weeksPlayed >= MIN_WEEKS_TO_SHADE_LUCK, sim, want };
}

// A run is asked for only while the chart is on screen. It is a second or more
// with the tab doing nothing else, and the chart is the last thing on the page:
// somebody reading the weekly totals must not wait on numbers he cannot see.
let chartVisible = typeof IntersectionObserver !== 'function';
if (!chartVisible) {
  new IntersectionObserver((entries) => {
    const now = entries.some((e) => e.isIntersecting);
    if (now === chartVisible) return;
    chartVisible = now;
    if (now) renderSummary();
  }, { rootMargin: '200px' }).observe($('panelSummary'));
}

let simQueued = null;
let simTimer = null;
let simDelay = 0;

/**
 * Run one simulation off the critical path — the Summary page's rAF +
 * setTimeout, so the "Simulating…" line is painted before the tab goes quiet.
 */
function wantSim(next) {
  if (simQueued && simQueued.key === next.key) return;
  simQueued = next;
  clearTimeout(simTimer);
  const later = (fn) => setTimeout(fn, 0);
  const kick = typeof requestAnimationFrame === 'function'
    ? (fn) => requestAnimationFrame(() => later(fn))
    : later;
  simTimer = setTimeout(() => kick(() => {
    if (simQueued !== next || state.odds !== next.odds) return;
    const t0 = Date.now();
    const result = forecast.simulateSeason({
      teamIds: next.inputs.teamIds,
      banked: next.inputs.banked,
      games: next.inputs.games,
      sigma: next.inputs.sigma,
      runs: SIM_RUNS,
      seed: SIM_SEED,
      playoff: next.inputs.playoff,
    });
    // Kept even when null, so a league the model cannot handle is asked once.
    sims.set(next.key, { result, ms: Date.now() - t0 });
    simQueued = null;
    simDelay = 0;
    renderSummary();
  }), simDelay);
}

function renderSummary() {
  const o = state.odds;
  const d = selected();
  $('summarySwitch').innerHTML = viewSwitchHtml(state.view.summary, { box: 'summary' });
  const inPlay = state.world && Number.isFinite(state.world.partialWeek);
  $('summaryNote').innerHTML =
    `<p>Record and LUCK count finished ${inPlay ? 'games' : 'weeks'} only.</p>` +
    `<p>Title % and Loser % play the rest of the season out ${commas(SIM_RUNS)} times, as Summary does. ` +
    'The hypothetical keeps its changed results; the weeks to come use today’s real rosters.</p>' +
    '<p>Both use the same random draws, so a difference is the decision and not the dice.</p>';
  if (!o || !d) {
    $('summaryCur').innerHTML = '';
    $('summaryHyp').innerHTML = '';
    oddsStatus(d ? '<span class="searching">Reading the season…</span>' : '');
    return;
  }

  const m = mirrorOf(d);
  const real = chartOf(o, null);
  const hyp = chartOf(o, m);

  // The Summary page's order — title chance, then LUCK — and the hypothetical
  // in the SAME order, so a row reads straight across the pair.
  real.rows.sort((a, b) =>
    (b.title ?? -1) - (a.title ?? -1) ||
    (b.luck ?? -Infinity) - (a.luck ?? -Infinity) ||
    String(a.name).localeCompare(String(b.name)));
  const byId = new Map(hyp.rows.map((r) => [r.id, r]));
  hyp.rows = real.rows.map((r) => byId.get(r.id)).filter(Boolean);

  const pending = o.data && !o.failed && real.enough;
  $('summaryCur').innerHTML = summaryTableHtml(real.rows, {
    enough: real.enough, waiting: Boolean(pending && !real.sim), shadeLuck: real.shadeLuck,
  });
  $('summaryHyp').innerHTML = summaryTableHtml(hyp.rows, {
    enough: hyp.enough, waiting: Boolean(pending && !hyp.sim), shadeLuck: hyp.shadeLuck,
    dim: teamDim(m), diffFrom: state.view.summary === 'diff' ? real.rows : null,
  });
  // Redrawn when the simulation lands, too: the reader's sort is put back.
  sortPair('summary');

  // The real season first: it is the same run whatever is picked.
  const next = real.want || hyp.want;
  if (next && chartVisible) wantSim(next);

  const done = real.sim || null;
  if (o.failed) {
    oddsStatus('The season could not be read, so Title % and Loser % are blank.');
  } else if (!real.enough) {
    oddsStatus('');
  } else if (!o.ready) {
    oddsStatus('<span class="searching">Reading projections…</span>');
  } else if (next) {
    oddsStatus(`<span class="searching">Simulating ${commas(SIM_RUNS)} seasons…</span>`);
  } else if (!done || !done.result) {
    oddsStatus('The simulation could not run on this season.');
  } else if (!done.result.games && done.result.skipped) {
    oddsStatus('No projections for the weeks to come, so nothing was simulated.');
  } else if (!done.result.games) {
    oddsStatus('The season is complete: nothing left to simulate.');
  } else {
    // Measured, as on Summary: a phone is slower than a laptop.
    const ms = Math.max(done.ms, hyp.sim ? hyp.sim.ms : 0);
    const took = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
    oddsStatus(`${commas(done.result.runs)} simulated seasons each, ${took} a run on this device.`);
  }
}

// ------------------------------------------------------------ knock-on effects

/** A real move in a few words, with its team: "Manager 4 added Somebody". */
function moveText(move) {
  const who = teamName(move.teamId);
  if (move.trade) {
    return `${who} traded ${names(move.trade.gives)} for ${names(move.trade.gets)}`;
  }
  const adds = move.adds || [];
  const drops = move.drops || [];
  if (adds.length && drops.length) return `${who} added ${names(adds)}, dropped ${names(drops)}`;
  return adds.length ? `${who} added ${names(adds)}` : `${who} dropped ${names(drops)}`;
}

/** [3, 4, 5, 9] -> "weeks 3–5 and 9". */
function weeksText(list) {
  const runs = [];
  for (const w of [...list].sort((a, b) => a - b)) {
    const last = runs[runs.length - 1];
    if (last && w === last[1] + 1) last[1] = w;
    else runs.push([w, w]);
  }
  const parts = runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`));
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `week${list.length === 1 ? '' : 's'} ${joined}`;
}

function renderNotes() {
  const d = selected();
  const m = d ? mirrorOf(d) : null;
  const lines = [];
  if (m) {
    for (const s of m.skipped) {
      const move = state.world.moves.find((x) => x.id === s.moveId);
      const what = move ? moveText(move) : `${teamName(s.teamId)}’s move`;
      const kept = s.kept && s.kept.length ? ` ${teamName(s.teamId)} keeps ${names(s.kept)}.` : '';
      lines.push(`<p data-note="skipped"><strong>Could not have happened:</strong> ` +
        `${esc(what)} (week ${s.week}). ${esc(s.reason)}.${esc(kept)}</p>`);
    }
    const over = new Map();
    for (const x of m.over) {
      if (!over.has(x.teamId)) over.set(x.teamId, { weeks: [], extra: 0 });
      const e = over.get(x.teamId);
      e.weeks.push(x.week);
      e.extra = Math.max(e.extra, x.extra || 1);
    }
    for (const [id, e] of over) {
      lines.push(`<p data-note="over"><strong>Over the roster limit:</strong> ${esc(teamName(id))} ` +
        `would hold ${e.extra} extra ${e.extra === 1 ? 'player' : 'players'} in ${weeksText(e.weeks)}.</p>`);
    }
  }
  $('panelNotes').hidden = !lines.length;
  $('mirrorNotes').innerHTML = lines.join('');
}

// ------------------------------------------------- add a trade as if accepted

const rosterOptions = (teamId, week, taken) => {
  const list = rosterAt(state.world, teamId, week)
    .filter((p) => !taken.some((id) => same(id, p.playerId)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return `<option value="">Add a player…</option>` +
    list.map((p) => `<option value="${esc(p.playerId)}">${esc(p.name)} (${esc(p.position || '')})</option>`).join('');
};

function renderWhatIfForm() {
  const world = state.world;
  const keep = (el, fallback) => {
    const now = el.value;
    return [...el.options].some((o) => o.value === now) ? now : fallback;
  };

  const weekEl = $('wiWeek');
  const wasWeek = weekEl.value;
  weekEl.innerHTML = world.weeks.map((w) => `<option value="${w}">Week ${w}</option>`).join('');
  weekEl.value = wasWeek;
  weekEl.value = keep(weekEl, String(world.weeks[world.weeks.length - 1]));

  const teamEl = $('wiTeam');
  const wasTeam = teamEl.value;
  teamEl.innerHTML = world.teams
    .filter((t) => !same(t.id, state.teamId))
    .map((t) => `<option value="${esc(t.id)}">${esc(teamName(t.id))}</option>`).join('');
  teamEl.value = wasTeam;
  teamEl.value = keep(teamEl, teamEl.options.length ? teamEl.options[0].value : '');

  renderWhatIfSides();
}

/** The form's week and other team, as the world's own ids. */
function whatIfTarget() {
  const week = Number($('wiWeek').value);
  const other = teamOf($('wiTeam').value);
  return { week, withTeamId: other ? other.id : null };
}

function renderWhatIfSides() {
  const { week, withTeamId } = whatIfTarget();
  const chip = (side) => (id) =>
    `<button type="button" class="dz-chip" data-side="${side}" data-pid="${esc(id)}" ` +
    `title="Remove ${esc(playerName(id))}">${esc(playerName(id))}</button>`;
  $('wiGiveLabel').textContent = `${teamName(state.teamId)} gives`;
  $('wiGetLabel').textContent = withTeamId === null ? 'Gets' : `${teamName(withTeamId)} gives`;
  $('wiGive').innerHTML = rosterOptions(state.teamId, week, state.wi.gives);
  $('wiGet').innerHTML = withTeamId === null ? '' : rosterOptions(withTeamId, week, state.wi.gets);
  $('wiGives').innerHTML = state.wi.gives.map(chip('gives')).join('');
  $('wiGets').innerHTML = state.wi.gets.map(chip('gets')).join('');
  $('wiAdd').disabled = !(state.wi.gives.length && state.wi.gets.length && withTeamId !== null);
}

/** A picker's choice, as the id the world itself uses for that player. */
function pickPlayer(el, teamId, side) {
  const { week } = whatIfTarget();
  const p = rosterAt(state.world, teamId, week).find((x) => same(x.playerId, el.value));
  if (p) state.wi[side].push(p.playerId);
  renderWhatIfSides();
}

function addWhatIf() {
  const { week, withTeamId } = whatIfTarget();
  if (withTeamId === null || !state.wi.gives.length || !state.wi.gets.length) return;
  const entry = {
    id: `whatif:${Date.now().toString(36)}`,
    week, teamId: state.teamId, withTeamId,
    gives: state.wi.gives.slice(), gets: state.wi.gets.slice(),
  };
  saveWhatIfs([...whatIfs(), entry]);
  state.wi = { gives: [], gets: [] };
  buildDecisions();
  state.selectedId = entry.id;
  simDelay = SIM_DELAY_MS;
  render();
  $('decisionList').scrollTop = 0;
}

function removeWhatIf(id) {
  saveWhatIfs(whatIfs().filter((w) => w.id !== id));
  mirrors.delete(id);
  buildDecisions();
  if (state.selectedId === id) state.selectedId = firstId();
  render();
}

// -------------------------------------------------------------------- controls

function paintSource() {
  $('sourceToggle')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.src === state.source));
}

// One load at a time: the connection bar can announce a league while the page
// is already fetching one, and two runs would race.
let loading = false;

async function selectSource(src) {
  if (loading) return;
  loading = true;
  try {
    if (await loadWorld(src)) {
      state.source = src;
      prefs.set('source', src);
    }
  } finally {
    loading = false;
  }
  paintSource();
}

// Whether the reader chose a source by hand this page load. A league that
// connects a second later must not yank them off a choice they just made.
let sourcePicked = false;

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  sourcePicked = true;
  selectSource(btn.dataset.src);
});

$('teamSelect').addEventListener('change', (e) => {
  const t = teamOf(e.target.value);
  if (!t) return;
  prefs.set(`team.${state.leagueKey}`, t.id);
  simDelay = SIM_DELAY_MS;
  // Picking a team is asking for that team: all users goes off.
  if (state.all) {
    state.all = false;
    prefs.set(`all.${state.leagueKey}`, null);
  }
  setTeam(t.id);
});

$('allSwitch').addEventListener('change', (e) => {
  if (state.world) setAll(e.target.checked);
});

$('noiseSwitch').addEventListener('change', (e) => {
  state.noise = e.target.checked;
  prefs.set('noise', state.noise);
  if (state.world && selected()) {
    renderResult();
    renderSeason();
    renderStandings();
    renderSummary();
  }
});

$('decisionList').addEventListener('click', (e) => {
  const x = e.target.closest('button[data-remove]');
  if (x) { removeWhatIf(x.dataset.remove); return; }
  const row = e.target.closest('button.dz-row');
  if (!row || row.dataset.id === state.selectedId) return;
  state.selectedId = row.dataset.id;
  simDelay = SIM_DELAY_MS;
  renderDecision();
});

$('seasonTeam').addEventListener('change', (e) => {
  const t = teamOf(e.target.value);
  if (!t) return;
  state.seasonTeamId = t.id;
  renderSeason();
});

// The three Hypothetical | Difference switches, told apart by their box.
document.addEventListener('click', (e) => {
  const v = viewFromClick(e);
  if (!v || !(v.box in state.view)) return;
  state.view[v.box] = v.view;
  if (v.box === 'season') renderSeason();
  else if (v.box === 'standings') renderStandings();
  else renderSummary();
});

// SORTING. The two tables the page owns are wired once and re-sorted after each
// redraw; a pair's tables are new elements every time, so `sortPair` wires
// those and these listeners keep the two halves in step (see `pairSort`).
enableSort($('weekTable'));
enableSort($('teamTable'));
wireWhy($('panelResult'));
for (const [box, panel] of [['season', 'panelSeason'], ['standings', 'panelStandings'], ['summary', 'panelSummary']]) {
  $(panel).addEventListener('click', (e) => onPairSort(box, e));
  $(panel).addEventListener('keydown', (e) => onPairSort(box, e));
}

$('wiWeek').addEventListener('change', () => { state.wi = { gives: [], gets: [] }; renderWhatIfSides(); });
$('wiTeam').addEventListener('change', () => { state.wi.gets = []; renderWhatIfSides(); });
$('wiGive').addEventListener('change', (e) => pickPlayer(e.target, state.teamId, 'gives'));
$('wiGet').addEventListener('change', (e) => pickPlayer(e.target, whatIfTarget().withTeamId, 'gets'));
$('whatIfForm').addEventListener('click', (e) => {
  const chip = e.target.closest('button.dz-chip');
  if (!chip) return;
  const side = chip.dataset.side;
  state.wi[side] = state.wi[side].filter((id) => !same(id, chip.dataset.pid));
  renderWhatIfSides();
});
$('whatIfForm').addEventListener('submit', (e) => { e.preventDefault(); addWhatIf(); });

// ------------------------------------------------------------------------ boot

paintSource();
for (const id of ['main', 'panelSeason', 'panelStandings', 'panelSummary']) $(id).hidden = true;

/**
 * The remembered source, but never a blank page — the Summary page's `start`,
 * for its reasons: live is tried first, and a failed read keeps its reason on
 * screen over the sample data.
 */
async function start() {
  if (prefs.get('source') === 'live' && savedConfig()) {
    loading = true;
    try {
      if (await loadWorld('live')) {
        state.source = 'live';
        return;
      }
      const why = $('sourceStatus').innerHTML;
      await loadWorld('demo');
      state.source = 'demo';
      setStatus(`${why} Showing demo data instead.`, true);
    } finally {
      loading = false;
      paintSource();
    }
    return;
  }

  await loadWorld('demo');
  state.source = 'demo';
  paintSource();
}

start();

// The connection bar probes in the background, so a league arriving after the
// page has booted is the normal case rather than the exception.
let triedLive = false;
onConnection((conn) => {
  if (!conn) return;
  if (triedLive || sourcePicked || state.source === 'live') return;
  triedLive = true;
  selectSource('live');
});
