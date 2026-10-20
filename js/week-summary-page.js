// THE WEEK RECAP on the Summary page: gathers one finished week and draws it.
//
// Tim, 2026-10-19 (his words in full at the top of js/week-summary.js): "make
// a weekly summary where you can choose which week it's summarizing … taking
// the summary informatoin off of that week after it was completely over".
//
// Every rule is in js/week-summary.js; this file only reads and paints.
//
// WHAT IS EXACT AND WHAT IS NOT (said in the panel's "How the recap works"):
//   exact      results, standings, every man's projection and score that week
//              (ESPN keeps both per week), so missed points, booms and busts,
//              and the position table.
//   saved      injuries: ESPN keeps no injury history, so the latest finished
//              week's statuses are saved here (js/store.js `writeWeekSummary`)
//              and later looks at that week use the copy.
//   rebuilt    an older week with no saved copy: a man counts as newly hurt
//              when he missed the next week; no status is claimed for him.
//
// The source (sample or live) follows the page's own Data source switch, read
// off its buttons, so js/summary-page.js needs no change. The phone's synced
// copy asks ESPN for nothing (rule 20): the recap then uses rosters only.

import * as espn from './espn.js';
import * as season from './season.js';
import * as store from './store.js';
import { savedConfig } from './connection.js';
import { generateDemoLeague } from './demo.js';
import { generateDemoWeekRosters, generateDemoFreeAgents } from './demo-rosters.js';
import { esc } from './summary-table.js';
import {
  buildWeekSummary, completedWeeks, injurySnapshot, nextUnderWay,
} from './week-summary.js';
import { healthy } from './injury.js';

const $ = (id) => document.getElementById(id);
const f1 = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—');
const signed = (n) => (typeof n === 'number' && Number.isFinite(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1) : '—');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : '';
};
const dayOf = (ms) => {
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : '';
};

/**
 * The sample league opens on week 8, the week the season chart below opens on
 * (js/summary-page.js DEMO_THROUGH), so the two halves of the page agree.
 */
const DEMO_WEEK = 8;

/** How many weeks after the picked one are read to count weeks missed. */
const LATER_WEEKS = 5;

const state = {
  source: null,
  league: null,     // { games, weeks, cfg, cloud }
  week: null,
  token: 0,
};

// ------------------------------------------------------------------ sources

function sourceNow() {
  const on = document.querySelector('#sourceToggle button.on');
  return on ? on.getAttribute('data-src') : null;
}

/** One ESPN player entry, cut to what the recap needs (and what is saved). */
function compactLeader(entry, week) {
  const p = espn.parsePlayerWeek(entry, week);
  return { playerId: p.playerId, name: p.name, position: p.position, projected: p.projected, actual: p.actual };
}

async function loadLeague(source) {
  if (source === 'demo') {
    const L = generateDemoLeague();
    const games = L.games.map((g) => ({
      week: g.week, homeId: g.homeId, awayId: g.awayId,
      homeScore: g.homeActual, awayScore: g.awayActual, played: true,
    }));
    return { demo: true, games, weeks: completedWeeks(games) };
  }
  const cfg = savedConfig();
  if (!cfg) return null;
  espn.configure({ leagueId: cfg.leagueId, season: cfg.season });
  const sched = await season.fetchSchedule({ settle: false });
  const pro = await season.fetchProGames();
  const cloud = !!(await season.cloudSource());
  return { demo: false, cfg, cloud, pro, games: sched.games || [], weeks: completedWeeks(sched.games || [], pro) };
}

/** The demo week: its rosters carry a status per week, so the next week's is "after". */
function demoInputs(L, week) {
  const teams = generateDemoWeekRosters(week).teams;
  const last = L.weeks[L.weeks.length - 1];
  const next = week < last ? generateDemoWeekRosters(week + 1).teams : null;
  const later = [];
  for (let w = week + 1; w <= Math.min(last, week + LATER_WEEKS); w++) {
    later.push({ week: w, players: byId(generateDemoWeekRosters(w).teams) });
  }
  const all = (ts) => ts.flatMap((t) => t.players || []);
  return {
    teams,
    pool: all(teams).concat(generateDemoFreeAgents(week)),
    moves: [],
    injury: {
      after: next ? injurySnapshot(all(next)) : null,
      before: injurySnapshot(all(teams)),
      current: null,
      isLatest: false,
      later,
      byes: null,
    },
    savedAt: null,
  };
}

const byId = (teams) => {
  const m = new Map();
  for (const t of teams || []) for (const p of t.players || []) m.set(String(p.playerId), p);
  return m;
};

async function liveInputs(L, week) {
  const { cfg, cloud } = L;
  const latest = L.weeks[L.weeks.length - 1];
  // TODAY'S STATUSES STAND FOR THE WEEK'S END only between ESPN closing it and
  // the next week's first kickoff (Tuesday to Thursday night). After that they
  // carry the next week's injuries too, so the week is rebuilt instead and
  // nothing is saved for it (`nextUnderWay`).
  const isLatest = week === latest && !nextUnderWay(L.pro, week);
  const after = [];
  for (let w = week + 1; w <= week + LATER_WEEKS && w <= latest + 1; w++) after.push(w);
  // The week after the latest finished one is always read too: it is the
  // newest roster read, so it carries today's statuses.
  const asking = [...new Set([week, ...after, latest + 1])];
  const weekTeams = await season.fetchWeeksRosters(asking, { assumed: false });
  const teams = weekTeams.get(week) || [];
  if (!teams.length) throw new Error(`ESPN sent no rosters for week ${week}.`);
  let byes = null;
  try { byes = await season.fetchByeWeeks(); } catch { byes = null; }

  const snap = store.readWeekSummary(cfg.leagueId, cfg.season, week);
  const snapPrev = week > 1 ? store.readWeekSummary(cfg.leagueId, cfg.season, week - 1) : null;

  // The week's league-wide lines: the saved copy, else one ESPN read.
  let pool = snap && snap.pool ? snap.pool : null;
  if (!pool && !cloud) {
    try { pool = (await espn.fetchWeekLeaders(week)).map((e) => compactLeader(e, week)); } catch { pool = null; }
  }
  let moves = [];
  if (!cloud) {
    try { moves = espn.parseTransactions(await espn.fetchTransactions(week)); } catch { moves = []; }
  }

  // TODAY's statuses: the freshest roster read (the week after the latest
  // finished one is still open, so it is the newest), else the week's own.
  const fresh = weekTeams.get(latest + 1) || weekTeams.get(latest) || teams;
  const freshById = byId(fresh);
  const weekById = byId(teams);
  const current = new Map();
  for (const [id, p] of weekById) {
    const q = freshById.get(id) || p;
    current.set(id, { status: q.injuryStatus || 'ACTIVE', details: q.injuryDetails || null });
  }
  // ESPN's word on how long, for the men hurt today (one read, never on the phone's copy).
  const hurtIds = [...current].filter(([, c]) => !healthy(c.status) && !c.details).map(([id]) => Number(id));
  if (hurtIds.length && !cloud) {
    try {
      for (const e of await espn.fetchInjuryDetails(hurtIds)) {
        const d = espn.parseInjuryDetails(e);
        if (d && current.has(String(d.playerId))) current.get(String(d.playerId)).details = d;
      }
    } catch { /* status only */ }
  }

  // THE SNAPSHOT: the latest finished week, saved once, as it stands now.
  if (isLatest && !cloud) {
    const details = new Map([...current].map(([id, c]) => [id, c.details]).filter(([, d]) => d));
    const now = [...weekById.keys()].map((id) => ({ playerId: id, injuryStatus: current.get(id).status }));
    store.writeWeekSummary(cfg.leagueId, cfg.season, week, { injuries: injurySnapshot(now, details), pool });
  }
  const saved = store.readWeekSummary(cfg.leagueId, cfg.season, week);

  return {
    teams,
    pool,
    moves,
    injury: {
      after: saved && saved.injuries ? saved.injuries : null,
      before: snapPrev && snapPrev.injuries ? snapPrev.injuries : null,
      current,
      isLatest,
      later: after.filter((w) => weekTeams.has(w)).map((w) => ({ week: w, players: byId(weekTeams.get(w)) })),
      byes,
    },
    savedAt: saved && saved.injuries ? saved.at : null,
    cloud,
  };
}

// ------------------------------------------------------------------ flow

async function reload() {
  const source = sourceNow();
  if (!source) return;
  state.source = source;
  const token = ++state.token;
  status('Reading the finished weeks…');
  let L = null;
  try { L = await loadLeague(source); } catch (err) { if (token === state.token) status(esc(err.message), true); return; }
  if (token !== state.token) return;
  state.league = L;
  if (!L) { paintPicker([]); clearBody(); status('Connect a league on the bar above to see its weeks.'); return; }
  if (!L.weeks.length) { paintPicker([]); clearBody(); status('No week is completely over yet.'); return; }
  const want = L.demo ? Math.min(DEMO_WEEK, L.weeks[L.weeks.length - 1]) : L.weeks[L.weeks.length - 1];
  paintPicker(L.weeks, want);
  await showWeek(want);
}

async function showWeek(week) {
  const L = state.league;
  if (!L) return;
  state.week = week;
  const token = ++state.token;
  status(`Reading week ${week}…`);
  try {
    const inputs = L.demo ? demoInputs(L, week) : await liveInputs(L, week);
    if (token !== state.token) return;
    const s = buildWeekSummary({ week, games: L.games, teams: inputs.teams, pool: inputs.pool, moves: inputs.moves, injury: inputs.injury });
    paint(s, inputs, L);
  } catch (err) {
    if (token !== state.token) return;
    clearBody();
    status(esc(err.message || String(err)), true);
  }
}

// ------------------------------------------------------------------ painting

function status(html, bad = false) {
  const el = $('recapStatus');
  if (!el) return;
  el.innerHTML = html;
  el.classList.toggle('neg', !!bad);
}

function clearBody() {
  const el = $('recapBody');
  if (el) el.innerHTML = '';
}

function paintPicker(weeks, pick = null) {
  const sel = $('recapWeek');
  if (!sel) return;
  sel.innerHTML = weeks.slice().reverse()
    .map((w) => `<option value="${w}"${w === pick ? ' selected' : ''}>Week ${w}</option>`).join('');
  sel.disabled = !weeks.length;
}

const table = (head, rows, cls = '') =>
  `<div class="table-scroll"><table class="recap-table ${cls}"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const block = (title, inner, id, cls = '') => `<div class="recap-block ${cls}" id="${id}"><h3>${title}</h3>${inner}</div>`;
const none = (cols, text) => [`<tr><td colspan="${cols}" class="muted name-less">${text}</td></tr>`];
const who = (p) => `${esc(p.name)}`;
const swapText = (sw) => {
  if (!sw || (!sw.in.length && !sw.out.length)) return 'No change.';
  const list = (xs) => xs.map((x) => `${x.name} ${x.pts.toFixed(1)}`).join(', ');
  return `Start ${list(sw.in)} · sit ${list(sw.out)}`;
};

function paint(s, inputs, L) {
  const F = s.facts;
  const facts = [
    ['High score', F.high ? `${esc(F.high.name)} ${f1(F.high.pts)}` : '—'],
    ['Low score', F.low ? `${esc(F.low.name)} ${f1(F.low.pts)}` : '—'],
    ['Biggest win', F.biggest ? `${esc(F.biggest.winner)} by ${f1(F.biggest.margin)}` : '—'],
    ['Closest', F.closest ? `${esc(F.closest.winner)} by ${f1(F.closest.margin)}` : '—'],
    ['League avg', F.avg === null ? '—' : `${f1(F.avg)}${F.avgProj === null ? '' : ` (proj ${f1(F.avgProj)})`}`],
    ['Upsets', String(F.upsets)],
    ['Best bench', s.bench ? `${who(s.bench)} ${f1(s.bench.actual)} · ${esc(s.bench.owner)}` : '—'],
    ['Best pickup', s.pickup ? `${who(s.pickup)} ${f1(s.pickup.actual)} · ${esc(s.pickup.owner)}` : '—'],
  ].map(([k, v]) => `<tr><th scope="row" class="name">${k}</th><td class="txt">${v}</td></tr>`);

  const games = F.games.map((g) => `<tr${g.upset ? ' class="upset"' : ''}>
    <td class="name">${esc(g.winner)}${g.upset ? ' <span class="tag" title="Won though projected lower">Upset</span>' : ''}</td>
    <td>${f1(g.winnerPts)}</td><td class="txt">${esc(g.loser)}</td><td>${f1(g.loserPts)}</td>
    <td class="muted">${f1(g.winnerProj)}–${f1(g.loserProj)}</td></tr>`);

  const standings = s.standings.map((r) => {
    const mv = r.move === null ? '' : r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : '–';
    const cls = r.move > 0 ? 'd-up' : r.move < 0 ? 'd-down' : 'd-zero';
    return `<tr><td>${r.rank}</td><td class="name">${esc(r.name)}</td><td>${r.w}-${r.l}${r.t ? `-${r.t}` : ''}</td><td class="${cls}">${mv}</td><td>${f1(r.pf)}</td></tr>`;
  });

  const missed = s.missed.map((m) => `<tr><td class="name">${esc(m.name)}</td><td>${f1(m.scored)}</td>
    <td title="${esc(swapText(m.swapsReasonable))}">${signed(m.missedReasonable)}</td>
    <td title="${esc(swapText(m.swapsPerfect))}">${signed(m.missedPerfect)}</td></tr>`);

  const playerRows = (rows) => rows.map((p) => `<tr><td class="name">${who(p)}</td><td class="txt">${esc(p.position)}</td>
    <td class="txt">${p.owner ? esc(p.owner) : '<span class="muted">FA</span>'}</td><td>${f1(p.projected)}</td><td>${f1(p.actual)}</td>
    <td class="${p.diff > 0 ? 'pos' : 'neg'}">${signed(p.diff)}</td></tr>`);
  const pHead = '<th class="name">Player</th><th class="txt">Pos</th><th class="txt">Owner</th><th>Proj</th><th>Pts</th><th>±</th>';

  const positions = s.positions.map((r) => `<tr><td class="txt">${r.position === 'DST' ? 'D/ST' : r.position}</td>
    <td class="name">${r.top ? `${who(r.top)} <span class="muted">${f1(r.top.actual)}</span>` : '—'}</td>
    <td title="Average of the top ${r.depth}">${f1(r.topAvg)}</td><td>${f1(r.startAvg)}</td><td class="muted">${f1(r.startProj)}</td></tr>`);

  const outFor = (i) => {
    if (i.outForSeason) return 'Season';
    if (i.back) return `Missed ${i.missed}`;
    if (i.stillOut && i.returnDate) return `Back ~${day(i.returnDate)}`;
    if (i.returnDate && i.source === 'snapshot') return `Back ~${day(i.returnDate)}`;
    if (i.missed) return `${i.missed}+ wk`;
    return '—';
  };
  const injuries = s.injuries.map((i) => `<tr${i.source === 'reconstructed' ? ' class="rebuilt"' : ''}>
    <td class="name">${who(i)}</td><td class="txt">${esc(i.owner || '')}</td>
    <td class="txt">${i.label ? esc(i.label) : `<span class="muted" title="Rebuilt: missed week ${s.week + 1}">Missed</span>`}</td>
    <td class="txt">${i.type ? esc(i.type) : '—'}</td><td class="txt">${outFor(i)}</td></tr>`);

  $('recapBody').innerHTML = [
    block('The week', table('<th class="name">Fact</th><th class="txt">Who</th>', facts, 'recap-facts'), 'recapFacts'),
    block('Results', table('<th class="name">Winner</th><th>Pts</th><th class="txt">Loser</th><th>Pts</th><th title="Projected before kickoff, winner–loser">Proj</th>', games), 'recapGames'),
    block('Standings', table('<th>#</th><th class="name">Manager</th><th>Record</th><th title="Places moved this week">Move</th><th>PF</th>', standings), 'recapStandings'),
    block('Missed points', table('<th class="name">Manager</th><th>Pts</th><th title="Best lineup by ESPN\'s projections, minus what you scored">Reasonable</th><th title="Best possible lineup, minus what you scored">Perfect</th>', missed), 'recapMissed'),
    block('Booms', table(pHead, s.booms.length ? playerRows(s.booms) : none(6, 'None')), 'recapBooms'),
    block('Busts', table(pHead, s.busts.length ? playerRows(s.busts) : none(6, 'None')), 'recapBusts'),
    block('Positions', table('<th class="txt">Pos</th><th class="name">Top scorer</th><th title="Average of the top scorers league-wide">Top avg</th><th title="This league\'s starters">Started</th><th title="What ESPN projected those starters">Proj</th>', positions), 'recapPositions'),
    block('New injuries', table('<th class="name">Player</th><th class="txt">Owner</th><th class="txt">Status</th><th class="txt">Injury</th><th class="txt">Out</th>', injuries.length ? injuries : none(5, 'None')), 'recapInjuries'),
  ].join('');

  const bits = [];
  if (L.demo) { /* the Demo badge already says so */ }
  else if (inputs.cloud) bits.push('Phone copy: rostered players only.');
  else if (!inputs.pool) bits.push('League-wide players not read: rostered only.');
  if (!L.demo && inputs.savedAt) bits.push(`Injuries as saved ${dayOf(inputs.savedAt)}.`);
  status(bits.join(' '));
  paintNote(s, inputs, L);
}

function paintNote(s, inputs, L) {
  const el = $('recapNote');
  if (!el) return;
  el.innerHTML = [
    'Only weeks ESPN has closed, with every NFL game final, are offered.',
    'Results, standings, every projection and every score are ESPN\'s own for that week. Projections are the ones set before kickoff.',
    'Missed points: <b>Reasonable</b> is the best legal lineup by ESPN\'s projections, scored by what those men scored, minus your score; below zero means your calls beat the projections. <b>Perfect</b> is the best lineup possible from what everyone scored. IR slots are left out. Hover or tap a figure for the swaps.',
    `Booms and busts: points against projection, for rostered men and free agents projected ${5}+ or scoring 15+. A bust was projected 5+.`,
    'Positions: Top avg is the average of the top scorers league-wide — as many as teams at QB, TE, K and D/ST, twice that at RB and WR. Started is this league\'s starters.',
    'Injuries: ESPN keeps no injury history. The latest finished week\'s statuses are saved on this device and used from then on. A week with no saved copy is rebuilt: a man who played and then missed the next week, with his status unknown. "Out" is ESPN\'s expected return or season-ending flag, or the weeks he actually missed; nothing else is guessed.',
  ].map((t) => `<p>${t}</p>`).join('');
}

// ------------------------------------------------------------------ wiring

if ($('recapWeek')) {
  $('recapWeek').addEventListener('change', (e) => {
    const w = Number(e.target.value);
    if (Number.isFinite(w)) showWeek(w);
  });
  // Follow the page's Data source switch: js/summary-page.js marks the chosen
  // button `.on` once its source has loaded (or fallen back).
  const toggle = $('sourceToggle');
  if (toggle && typeof MutationObserver === 'function') {
    new MutationObserver(() => {
      const s = sourceNow();
      if (s && s !== state.source) reload();
    }).observe(toggle, { subtree: true, attributes: true, attributeFilter: ['class'] });
  }
  document.addEventListener('ff:refresh', () => { if (state.source === 'live') reload(); });
  reload();
}
