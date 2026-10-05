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

import { computeLeagueStats } from './stats.js';
import * as season from './season.js';
import * as espn from './espn.js';
import * as forecast from './forecast.js';
import * as capture from './capture.js';
import { listDecisions, mirror, rosterAt } from './decisions.js';
import { actualSeasonTableHtml, weeksFromMirror } from './actual-season-table.js';
import { standingsTableHtml } from './standings-table.js';
import { summaryTableHtml } from './summary-table.js';
import {
  viewSwitchHtml, viewFromClick, signedText, diffOf, diffClass, recordDiff, dimStyle, esc,
} from './view-switch.js';
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

const LINEUP_SAID = {
  'lineup-reasonable': 'Lineup: highest projections',
  'lineup-perfect': 'Lineup: perfect hindsight',
};

const state = {
  source: prefs.get('source', 'demo'),
  world: null,          // season.fetchDecisionWorld()
  leagueKey: 'demo',    // what this league's what-ifs and team are remembered under
  season: null,
  teamId: null,         // whose decisions are listed
  decisions: [],        // that team's, what-ifs first
  selectedId: null,
  seasonTeamId: null,   // whose lineup "Season by week" shows
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

/** A week's points as ESPN prints them: two decimals when it has two. */
function pts(n) {
  if (!Number.isFinite(n)) return '—';
  const s = n.toFixed(2);
  return s.endsWith('0') ? s.slice(0, -1) : s;
}

/** A difference of two of those, signed, with a real minus. */
const signedPts = (d) => (d === null ? '—' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${pts(Math.abs(d))}`);

/** "3-0", and a third number only with a tie — the Summary chart's form. */
const recText = (r) => (r ? `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}` : '—');

const teamOf = (id) => (state.world ? state.world.teams.find((t) => same(t.id, id)) || null : null);
const teamName = (id) => { const t = teamOf(id); return t ? t.name || t.teamName || `Team ${id}` : `Team ${id}`; };
const playerName = (id) => {
  const p = state.world && state.world.players && state.world.players.get(id);
  return (p && p.name) || `Player ${id}`;
};
const names = (ids) => (ids || []).map(playerName).join(' and ');

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

  if (!demo) {
    setStatus(world.weeks.length
      ? `Loaded ${esc(world.name)}: ${world.weeks.length} finished ` +
        `week${world.weeks.length === 1 ? '' : 's'}, ${world.moves.length} moves.`
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
  const first = state.decisions.find((d) => !d.empty) || state.decisions[0] || null;
  state.selectedId = first ? first.id : null;
  render();
}

function buildDecisions() {
  const world = state.world;
  const known = (w) => teamOf(w.teamId) && teamOf(w.withTeamId) && world.weeks.includes(w.week);
  const mineToo = (w) => same(w.teamId, state.teamId) || same(w.withTeamId, state.teamId);
  const extra = whatIfs().filter((w) => known(w) && mineToo(w)).map((w) => {
    const d = whatIfDecision(w, state.teamId);
    d.empty = !anyChanged(mirrorOf(d));
    return d;
  });
  state.decisions = [...extra, ...listDecisions(world, state.teamId)];
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
    : `${world.name} · ${n} finished week${n === 1 ? '' : 's'}`;

  $('teamSelect').innerHTML = world.teams
    .map((t) => `<option value="${esc(t.id)}"${same(t.id, state.teamId) ? ' selected' : ''}>${esc(teamName(t.id))}</option>`)
    .join('');
  $('noiseSwitch').checked = state.noise;

  // FEWER THAN ONE FINISHED WEEK: nothing has happened to replay.
  const any = n > 0 && state.teamId !== null;
  for (const id of ['main', 'panelSeason', 'panelStandings', 'panelSummary']) $(id).hidden = !any;
  if (!any) {
    $('panelNotes').hidden = true;
    if (world.isDemo) setStatus('No finished week yet.');
    return;
  }

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

/** The numbers a row of the list leads with, for the picked team. */
function headline(decision) {
  const m = mirrorOf(decision);
  const rec = m.records.get(state.teamId);
  const mine = m.teams.get(state.teamId);
  let hyp = 0;
  let real = 0;
  for (const c of Object.values((mine && mine.byWeek) || {})) { hyp += c.total; real += c.realTotal; }
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
      `<span class="dz-rec ${h.record ? diffClass(h.record.value) : ''}">${h.record ? esc(h.record.text) : '—'}</span>` +
      `<span class="dz-pts ${diffClass(h.points)}">${signedText(h.points)}</span>`;
  }
  return `<div class="dz-item">` +
    `<button type="button" class="dz-row" role="option" data-id="${esc(d.id)}" data-kind="${esc(d.kind)}"` +
    `${d.empty ? ' data-empty="1"' : ''} aria-selected="${d.id === state.selectedId}" title="${esc(d.label)}">` +
    `<span class="dz-wk">${wk}</span><span class="dz-what">${esc(what)}</span>${nums}</button>` +
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

/** What the hypothetical IS, in a few words, over the result. */
function ledeOf(d) {
  if (d.whatIf) return `If accepted from week ${d.week}: ${d.label}.`;
  if (LINEUP_SAID[d.kind]) return `${d.label}.`;
  return `Undone: ${d.label} (week ${d.week}).`;
}

function renderResult() {
  const world = state.world;
  const d = selected();
  const table = $('weekTable');
  const [body, foot] = table.querySelectorAll('tbody');
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

  body.innerHTML = world.weeks.map((week) => {
    const c = mine.byWeek[week];
    const g = gameOf(world.games, id, week);
    const mg = gameOf(m.games, id, week);
    const was = resultLetter(g, id);
    const is = resultLetter(mg, id);
    const flip = Boolean(was && is && was !== is);
    const diff = diffOf(c.total, c.realTotal, 2);
    const dim = dimStyle(noise[week]);
    hyp += c.total;
    real += c.realTotal;

    const opp = g ? teamName(g.homeId === id ? g.awayId : g.homeId) : '—';
    const rs = scores(g, id);
    const ms = scores(mg, id);
    const said = rs && ms
      ? `Actual ${pts(rs[0])} to ${pts(rs[1])}. Hypothetical ${pts(ms[0])} to ${pts(ms[1])}.`
      : '';
    const resCls = flip ? ` dz-flip ${RANK[is] > RANK[was] ? 'd-up' : 'd-down'}` : '';
    return `<tr data-wk="${week}"${flip ? ' data-flip="1"' : ''}>` +
      `<td>${week}</td>` +
      `<td class="dz-vs" title="${esc(opp)}">${esc(opp)}</td>` +
      `<td class="dz-act" data-v="${c.realTotal}">${pts(c.realTotal)}</td>` +
      `<td class="dz-hyp" data-v="${c.total}"${dim}>${pts(c.total)}</td>` +
      `<td class="dz-diff ${diffClass(diff)}" data-v="${diff}"${dim}>${signedPts(diff)}</td>` +
      `<td class="dz-res${resCls}"${dim} title="${esc(said)}">${flip ? `${was} → ${is}` : was || '—'}</td>` +
      `</tr>`;
  }).join('');

  const total = diffOf(hyp, real, 2);
  const change = rec ? recordDiff(rec.mirror, rec.real) : null;
  foot.innerHTML = `<tr><td colspan="2">Total</td>` +
    `<td class="dz-act">${pts(round2(real))}</td><td class="dz-hyp">${pts(round2(hyp))}</td>` +
    `<td class="dz-diff ${diffClass(total)}" data-v="${total}">${signedPts(total)}</td>` +
    `<td class="dz-res ${change ? diffClass(change.value) : ''}">${change ? esc(change.text) : '—'}</td></tr>`;

  $('resultLede').textContent = ledeOf(d) + (d.empty ? ' No change.' : '');
  const stat = (k, v, cls = '', key = '') =>
    `<div class="stat"><div class="k">${k}</div><div class="v${cls ? ` ${cls}` : ''}"` +
    `${key ? ` data-stat="${key}"` : ''}>${v}</div></div>`;
  $('resultStats').innerHTML =
    stat('Actual record', recText(rec && rec.real), '', 'real') +
    stat('Hypothetical', recText(rec && rec.mirror), change && change.value ? diffClass(change.value) : '', 'mirror') +
    stat('Points', signedPts(total), total ? diffClass(total) : '', 'points');
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
  // small select offers every squad whose lineup is not the real one.
  const others = changedTeams(m).filter((id) => !same(id, state.teamId));
  const offered = [state.teamId, ...others];
  if (!offered.some((id) => same(id, state.seasonTeamId))) state.seasonTeamId = state.teamId;
  $('seasonTeamRow').hidden = !others.length;
  $('seasonTeam').innerHTML = offered
    .map((id) => `<option value="${esc(id)}"${same(id, state.seasonTeamId) ? ' selected' : ''}>${esc(teamName(id))}</option>`)
    .join('');

  const cells = m.teams.get(state.seasonTeamId);
  const real = weeksFromMirror(cells, 'real');
  const hyp = weeksFromMirror(cells, 'mirror');
  const dim = state.noise ? m.noise.get(state.seasonTeamId) || null : null;
  $('seasonCur').innerHTML = actualSeasonTableHtml({ weeks: real, slots: world.slots }, { box: 'current' });
  $('seasonHyp').innerHTML = actualSeasonTableHtml({ weeks: hyp, slots: world.slots }, {
    box: 'hypothetical', dim, diffFrom: state.view.season === 'diff' ? real : null,
  });
}

/** One number per team for a chart with a row a team: its noisiest week. */
function teamDim(m) {
  if (!state.noise) return null;
  const out = new Map();
  for (const [id, byWeek] of m.noise) out.set(id, Math.max(0, ...Object.values(byWeek)));
  return out;
}

function standingsOf(games) {
  const world = state.world;
  const final = new Set(world.weeks);
  return computeLeagueStats({
    season: state.season, name: world.name, isDemo: world.isDemo,
    weeks: world.weeks.length, teams: world.teams,
    games: games.filter((g) => final.has(g.week)), injuries: [],
  });
}

function renderStandings() {
  const d = selected();
  $('standingsSwitch').innerHTML = viewSwitchHtml(state.view.standings, { box: 'standings' });
  if (!d) { $('standingsCur').innerHTML = ''; $('standingsHyp').innerHTML = ''; return; }
  const m = mirrorOf(d);
  const real = standingsOf(state.world.games);
  const hyp = standingsOf(m.games);
  // BOTH IN THE REAL STANDINGS' ORDER, so a row reads straight across the pair.
  real.teams.sort((a, b) => a.actualStanding - b.actualStanding);
  const byId = new Map(hyp.teams.map((t) => [t.id, t]));
  hyp.teams = real.teams.map((t) => byId.get(t.id)).filter(Boolean);

  $('standingsCur').innerHTML = standingsTableHtml(real, { highlightId: state.teamId });
  $('standingsHyp').innerHTML = standingsTableHtml(hyp, {
    highlightId: state.teamId, dim: teamDim(m),
    diffFrom: state.view.standings === 'diff' ? real : null,
  });
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
    });
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
    });
  } catch {
    if (stale()) return;
    // Record and LUCK from the world this page already holds; the two
    // percentages are left blank rather than guessed.
    state.odds = {
      data: null, played: world.games.slice(), teams: world.teams, started: null,
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
  }
  o.ready = true;
  renderSummary();
}

/** How far the mirror moved one team-week, or null where it did not. */
function deltaOf(m, teamId, week) {
  const t = m.teams.get(teamId);
  const c = t && t.byWeek[week];
  if (!c) return null;
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
 */
function mirrorSchedule(data, m) {
  const games = data.games.map((g) => {
    if (capture.gameState(g) !== 'final') return g;
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
  return played.map((g) => {
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
  $('summaryNote').innerHTML =
    '<p>Record and LUCK count finished weeks only.</p>' +
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
      if (!over.has(x.teamId)) over.set(x.teamId, { weeks: [], size: 0, limit: x.limit });
      const e = over.get(x.teamId);
      e.weeks.push(x.week);
      e.size = Math.max(e.size, x.size);
    }
    for (const [id, e] of over) {
      lines.push(`<p data-note="over"><strong>Over the roster limit:</strong> ${esc(teamName(id))} ` +
        `would hold ${e.size} players (limit ${e.limit}) in ${weeksText(e.weeks)}.</p>`);
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
  if (state.selectedId === id) {
    const first = state.decisions.find((d) => !d.empty) || state.decisions[0] || null;
    state.selectedId = first ? first.id : null;
  }
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
  setTeam(t.id);
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
