// THE WEEK RECAP on the Home page: gathers one finished week and draws it.
// (On Summary until 2026-10-19, when Tim looked for it on Home: "I don't see
// pretty much anything in the home weekly recap section except injured players
// and missed points".)
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
// off its buttons, so the page's own module needs no change.
//
// THE PHONE'S SYNCED COPY asks ESPN for nothing (rule 20) and still fills every
// block: it carries every week's rosters and wire, the byes, ESPN's injury
// details and (from 2026-10-19) the NFL kickoffs. What it lacks is said in one
// line: no transactions (the pickup is rebuilt from the rosters), and an older
// copy without the wire or the kickoffs (rostered men only; a return date
// shown as the date).

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
import { injuryRow, returnLabel, gainLabel, RETURN_TITLE, GAINS_TITLE } from './injury-gains.js';
import { healthy } from './injury.js';
// THE HOUSE PREVIEWS (Tim, 2026-10-22: "none of the players or anything in the
// new week recap section have previews or anything like that like the rest of
// the cite. fix it"). The same two cards Home's other panels use: a player's
// name opens the classic player card and is a link to his row on Players; a
// manager's name and a number open a stat card of what it is made of.
import { statCard, clearPops, wirePops, teamWeekSpec } from './pop.js';
import { playerCardFromWeeks, registerRun, tipAttr, wireTips, clearRuns } from './player-card.js';
import { teamHref, playerHref } from './links.js';
import { shortName } from './actual-season-table.js';
import { ordinal } from './heat.js';

const $ = (id) => document.getElementById(id);
const f1 = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : '—');
const signed = (n) => (typeof n === 'number' && Number.isFinite(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1) : '—');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
/** The regular season's last week when the schedule does not say. */
const LAST_WEEK = 14;

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
  return { playerId: p.playerId, name: p.name, position: p.position, proTeamId: p.proTeamId ?? null, projected: p.projected, actual: p.actual };
}

async function loadLeague(source) {
  if (source === 'demo') {
    const L = generateDemoLeague();
    const games = L.games.map((g) => ({
      week: g.week, homeId: g.homeId, awayId: g.awayId,
      homeScore: g.homeActual, awayScore: g.awayActual, played: true,
    }));
    return { demo: true, games, weeks: completedWeeks(games), last: Math.max(...L.games.map((g) => g.week)) };
  }
  const cfg = savedConfig();
  if (!cfg) return null;
  espn.configure({ leagueId: cfg.leagueId, season: cfg.season });
  const sched = await season.fetchSchedule({ settle: false });
  let down = null;
  try { down = (typeof season.cloudSource === 'function' && (await season.cloudSource())) || null; } catch { down = null; }
  // The NFL's games say when every game of a week is final. Not on the synced
  // copy (rule 20): there ESPN's own "played" on every matchup decides alone,
  // which ESPN sets only once the week is closed.
  const pro = down ? null : await season.fetchProGames();
  const games = sched.games || [];
  const weeks = completedWeeks(games, pro);
  const regular = (sched.weeks || []).map(Number).filter(Number.isFinite);
  return {
    demo: false, cfg, cloud: !!down, down, pro, games, weeks,
    last: regular.length ? Math.max(...regular) : LAST_WEEK,
  };
}

/** The demo week: its rosters carry a status per week, so the next week's is "after". */
function demoInputs(L, week) {
  const teams = generateDemoWeekRosters(week).teams;
  const last = L.weeks[L.weeks.length - 1];
  const next = week < last ? generateDemoWeekRosters(week + 1).teams : null;
  const later = [];
  // The weeks a player card draws (js/player-card.js `playerCardFromWeeks`).
  const weekTeams = new Map();
  if (week > 1) weekTeams.set(week - 1, generateDemoWeekRosters(week - 1).teams);
  weekTeams.set(week, teams);
  for (let w = week + 1; w <= Math.min(last, week + LATER_WEEKS); w++) {
    const ts = generateDemoWeekRosters(w).teams;
    weekTeams.set(w, ts);
    later.push({ week: w, players: byId(ts) });
  }
  const all = (ts) => ts.flatMap((t) => t.players || []);
  const poolOf = (w) => (w >= 1 && w <= L.last ? all(generateDemoWeekRosters(w).teams).concat(generateDemoFreeAgents(w)) : []);
  return {
    teams,
    weekTeams,
    pool: all(teams).concat(generateDemoFreeAgents(week)),
    moves: null,
    prevTeams: week > 1 ? generateDemoWeekRosters(week - 1).teams : null,
    poolOf,
    kickoffs: null,
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
  // The week before too: who was on a roster then is how a pickup is told
  // apart when the week's transactions are not read (the synced copy).
  const down = L.down;
  // On the synced copy only the weeks it holds are asked for: a week it lacks
  // would fall through to ESPN (rule 20).
  const held = (shape) => new Set(((down && down.weeks && down.weeks[shape]) || []).map(Number));
  const rosterWeeks = held('rosters');
  const wireWeeks = held('wire');
  const canRead = (w) => w >= 1 && (!cloud || rosterWeeks.has(w));
  const asking = [...new Set([week - 1, week, ...after, latest + 1])].filter(canRead);
  const weekTeams = await season.fetchWeeksRosters(asking, { assumed: false });
  const teams = weekTeams.get(week) || [];
  if (!teams.length) throw new Error(`ESPN sent no rosters for week ${week}.`);
  // Byes and kickoffs: the copy's own on the phone, else one public read each
  // (the kickoffs ride the byes' payload, so they cost nothing more).
  let byes = null;
  let kickoffs = null;
  if (cloud) {
    byes = down.byes && Object.keys(down.byes).length ? { ...down.byes } : null;
    const k = down.schedule && down.schedule.proKickoffs;
    kickoffs = k && typeof k === 'object' && Object.keys(k).length ? k : null;
  } else {
    try { byes = await season.fetchByeWeeks(); } catch { byes = null; }
    try { kickoffs = typeof season.fetchProKickoffs === 'function' ? await season.fetchProKickoffs() : null; } catch { kickoffs = null; }
    if (kickoffs && !Object.keys(kickoffs).length) kickoffs = null;
  }

  const snap = store.readWeekSummary(cfg.leagueId, cfg.season, week);
  const snapPrev = week > 1 ? store.readWeekSummary(cfg.leagueId, cfg.season, week - 1) : null;

  // THE WIRE of a week, kept for the visit: on the copy only a week it holds;
  // on a laptop one read a week (js/season.js shares and stores it).
  const wireMemo = new Map();
  const wireOf = (w) => {
    if (w < 1 || (cloud && !wireWeeks.has(w)) || typeof season.fetchWireWeek !== 'function') return Promise.resolve(null);
    if (!wireMemo.has(w)) wireMemo.set(w, season.fetchWireWeek(w).then((x) => (Array.isArray(x) ? x : null), () => null));
    return wireMemo.get(w);
  };

  // The week's league-wide lines: the saved copy, else one ESPN read for the
  // top scorers; on the synced copy, that week's wire.
  let pool = snap && snap.pool ? snap.pool : null;
  if (!pool && !cloud) {
    try { pool = (await espn.fetchWeekLeaders(week)).map((e) => compactLeader(e, week)); } catch { pool = null; }
  }
  if (!pool && cloud) pool = await wireOf(week);
  // The week's transactions. null = not read: the pickup is rebuilt from the rosters.
  let moves = null;
  if (!cloud) {
    try { moves = espn.parseTransactions(await espn.fetchTransactions(week)); } catch { moves = null; }
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

  // UP WHILE OUT: everyone this page can see in the week and the few after it
  // (rosters, the wire, the week's top scorers), for js/injury-gains.js.
  const gainWeeks = [];
  for (let w = week; w <= Math.min(week + 3, L.last); w++) gainWeeks.push(w);
  const wires = new Map();
  await Promise.all(gainWeeks.map(async (w) => { const x = await wireOf(w); if (x) wires.set(w, x); }));
  const poolOf = (w) => {
    const out = [];
    for (const t of weekTeams.get(w) || []) out.push(...(t.players || []));
    out.push(...(wires.get(w) || []));
    if (w === week && pool) out.push(...pool);
    return out;
  };

  return {
    teams,
    weekTeams,
    pool,
    moves,
    prevTeams: weekTeams.get(week - 1) || null,
    poolOf,
    kickoffs,
    wireMissing: cloud && !wireWeeks.has(week),
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
    const s = buildWeekSummary({
      week, games: L.games, teams: inputs.teams, pool: inputs.pool,
      moves: inputs.moves, prevTeams: inputs.prevTeams, injury: inputs.injury,
    });
    // Est. return and Up while out, per injured man (js/injury-gains.js).
    s.injuries = s.injuries.map((i) => {
      const back = i.back !== null && i.back !== undefined ? i.back
        : i.outForSeason ? 'season' : undefined;
      const details = i.outForSeason || i.returnDate ? { outForSeason: i.outForSeason, returnDate: i.returnDate } : null;
      return {
        ...i,
        ...injuryRow({
          hurt: i, from: week + 1, last: L.last, kickoffs: inputs.kickoffs,
          byes: inputs.injury && inputs.injury.byes, poolOf: inputs.poolOf, details, back,
        }),
      };
    });
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

const posLabel = (p) => (p === 'DST' ? 'D/ST' : p || '');
const returnText = (i) => esc(returnLabel(i));
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

// ------------------------------------------------------------ the previews
//
// `ctx` is the week on screen: { week, weekTeams, byes, demo, teamsById,
// idByName, standing }. Set by `paint`, read by the helpers below.
let ctx = null;
const PREFIX = 'recap';

/**
 * A player's name: the classic player card (his weeks the recap read), on a
 * link to his row on Players — Home's `pref`, in the recap. `ident` replaces
 * the card's top line where the recap knows more (an injury's owner and type).
 */
function man(p, inner, { ident = null } = {}) {
  if (!p || !ctx) return inner;
  const id = p.playerId;
  const noId = id === null || id === undefined;
  const made = playerCardFromWeeks(ctx.weekTeams, p, {
    currentWeek: ctx.week, byes: ctx.byes, demo: ctx.demo,
    id: `recap:${noId ? p.name : id}`,
  });
  made.ident = ident || made.ident.replace(/ · ACTIVE$/, '');
  const tip = tipAttr(registerRun(made, PREFIX));
  if (noId) return `<span class="pref"${tip} tabindex="0">${inner}</span>`;
  return `<a class="pref" href="${esc(playerHref(id))}"${tip}` +
    ` aria-label="${esc(p.name)} — open his next 13 weeks on the Players page">${inner}</a>`;
}

/** A stat card's attribute for the recap, or '' when there is no spec. */
const pop = (spec) => (spec ? statCard(spec, { prefix: PREFIX }) : '');
const span = (spec, inner) => (spec ? `<span${pop(spec)}>${inner}</span>` : inner);

/** A team after the week: record and rank, and its score that week. Opens its roster. */
function teamSpec(teamId) {
  if (!ctx || teamId === null || teamId === undefined) return null;
  const t = ctx.teamsById.get(teamId);
  if (!t) return null;
  const st = ctx.standing.get(teamId);
  const g = ctx.scoreOf.get(teamId);
  return {
    title: t.name,
    sub: `After week ${ctx.week}`,
    rows: [
      ...(st ? [{ label: 'Record', note: `${ordinal(st.rank)} of ${ctx.standing.size}`, value: `${st.w}-${st.l}${st.t ? `-${st.t}` : ''}` }] : []),
      ...(st ? [{ label: 'PF', value: st.pf }] : []),
      ...(g ? [{ label: `Week ${ctx.week}`, note: isNum(g.proj) ? `proj ${g.proj.toFixed(1)}` : '', value: g.pts }] : []),
    ],
    href: teamHref(teamId, ctx.week),
    hrefLabel: 'Open roster',
  };
}
const team = (teamId, name) => span(teamSpec(teamId), esc(name));
const teamByName = (name) => (ctx ? ctx.idByName.get(name) : undefined);

const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'OP', 'D/ST', 'DST', 'K'];
/** A team's score that week, in its starters (with each man's projection). */
function scoreSpec(teamId, total) {
  const t = ctx && ctx.teamsById.get(teamId);
  if (!t || !isNum(total)) return null;
  const slotOf = (p) => p.slot || posLabel(p.position);
  const at = (p) => { const i = SLOT_ORDER.indexOf(slotOf(p)); return i < 0 ? SLOT_ORDER.length : i; };
  const starters = (t.players || []).filter((p) => p && p.started)
    .map((p, i) => ({ p, i })).sort((a, b) => at(a.p) - at(b.p) || a.i - b.i).map((x) => x.p);
  if (!starters.length) return null;
  return teamWeekSpec({
    team: t.name, week: ctx.week, total,
    starters: starters.map((p) => ({ slot: slotOf(p), name: shortName(p), pts: isNum(p.actual) ? p.actual : 0, proj: isNum(p.projected) ? p.projected : null })),
    href: teamHref(teamId, ctx.week),
  });
}
const score = (teamId, total) => span(scoreSpec(teamId, total), f1(total));

/** Missed points: who would have come in and gone out, adding up to the figure. */
function swapSpec(m, which) {
  const sw = which === 'perfect' ? m.swapsPerfect : m.swapsReasonable;
  const total = which === 'perfect' ? m.missedPerfect : m.missedReasonable;
  if (!sw) return null;
  const rows = [
    ...sw.in.map((x) => ({ label: x.name, note: 'start', value: x.pts })),
    ...sw.out.map((x) => ({ label: x.name, note: 'sit', html: x.pts ? `−${x.pts.toFixed(1)}` : '0.0' })),
  ];
  const t10 = (v) => Math.round(v * 10);
  const miss = isNum(total) ? t10(total) - (sw.in.reduce((a, x) => a + t10(x.pts), 0) - sw.out.reduce((a, x) => a + t10(x.pts), 0)) : 0;
  if (miss && Math.abs(miss) <= rows.length) rows.push({ label: 'Rounding', value: miss / 10 });
  return {
    title: m.name,
    sub: `Week ${ctx.week} · ${which === 'perfect' ? 'Perfect' : 'Reasonable'}`,
    rows,
    total: { label: 'Missed', html: signed(total) },
    foot: rows.length ? '' : 'No change.',
    href: teamHref(m.teamId, ctx.week),
    hrefLabel: 'Open roster',
  };
}

/** Up while out: a teammate's rise, as his two projections. */
function gainSpec(g) {
  return {
    title: g.name,
    sub: 'Up while out',
    rows: [
      { label: 'While out', note: `avg of ${g.weeks} wk${g.weeks === 1 ? '' : 's'}`, value: g.during },
      { label: 'Before', html: `−${g.before.toFixed(1)}` },
    ],
    total: { label: 'Up', html: gainLabel(g) },
  };
}
const gainsText = (gains) => (gains && gains.length
  ? gains.map((g) => `${man(g, esc(g.name))} <span class="pos"${pop(gainSpec(g))}>${gainLabel(g)}</span>`).join('<br>')
  : '<span class="muted">—</span>');
const INJURY_HEAD = `<th class="name">Player</th><th class="txt" title="${esc(RETURN_TITLE)}">Est. return</th>` +
  `<th class="txt" title="${esc(GAINS_TITLE)}">Up while out</th>`;
const table = (head, rows, cls = '') =>
  `<div class="table-scroll"><table class="recap-table ${cls}"><thead><tr>${head}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const block = (title, inner, id, cls = '') => `<div class="recap-block ${cls}" id="${id}"><h3>${title}</h3>${inner}</div>`;
const none = (cols, text) => [`<tr><td colspan="${cols}" class="muted name-less">${text}</td></tr>`];
const who = (p) => man(p, esc(p.name));
/** An owner by name (the rows carry his team id when they came off a roster). */
const ownerOf = (p) => (p.owner ? team(p.teamId ?? teamByName(p.owner), p.owner) : '<span class="muted">FA</span>');

function paint(s, inputs, L) {
  // Every card of the last paint is dead: their markup is about to go.
  clearRuns(PREFIX);
  clearPops(PREFIX);
  const teams = inputs.teams || [];
  const scoreOf = new Map();
  for (const g of s.facts.games) {
    scoreOf.set(g.winnerId, { pts: g.winnerPts, proj: g.winnerProj });
    scoreOf.set(g.loserId, { pts: g.loserPts, proj: g.loserProj });
  }
  ctx = {
    week: s.week,
    weekTeams: inputs.weekTeams || new Map([[s.week, teams]]),
    byes: (inputs.injury && inputs.injury.byes) || null,
    demo: !!L.demo,
    teamsById: new Map(teams.map((t) => [t.id, t])),
    idByName: new Map(teams.map((t) => [t.name, t.id])),
    standing: new Map(s.standings.map((r) => [r.teamId, r])),
    scoreOf,
  };

  const F = s.facts;
  const facts = [
    ['High score', F.high ? `${team(F.high.id, F.high.name)} ${score(F.high.id, F.high.pts)}` : '—'],
    ['Low score', F.low ? `${team(F.low.id, F.low.name)} ${score(F.low.id, F.low.pts)}` : '—'],
    ['Biggest win', F.biggest ? `${team(F.biggest.winnerId, F.biggest.winner)} by ${f1(F.biggest.margin)}` : '—'],
    ['Closest', F.closest ? `${team(F.closest.winnerId, F.closest.winner)} by ${f1(F.closest.margin)}` : '—'],
    ['League avg', F.avg === null ? '—' : `${f1(F.avg)}${F.avgProj === null ? '' : ` (proj ${f1(F.avgProj)})`}`],
    ['Upsets', String(F.upsets)],
    ['Best bench', s.bench ? `${who(s.bench)} ${f1(s.bench.actual)} · ${ownerOf(s.bench)}` : '—'],
    ['Best pickup', s.pickup ? `${who(s.pickup)} ${f1(s.pickup.actual)} · ${ownerOf(s.pickup)}`
      : s.pickupFrom ? 'None started' : '<span class="muted">Not known</span>'],
  ].map(([k, v]) => `<tr><th scope="row" class="name">${k}</th><td class="txt">${v}</td></tr>`);

  const games = F.games.map((g) => `<tr${g.upset ? ' class="upset"' : ''}>
    <td class="name">${team(g.winnerId, g.winner)}${g.upset ? ' <span class="tag" title="Won though projected lower">Upset</span>' : ''}</td>
    <td>${score(g.winnerId, g.winnerPts)}</td><td class="txt">${team(g.loserId, g.loser)}</td><td>${score(g.loserId, g.loserPts)}</td>
    <td class="muted">${f1(g.winnerProj)}–${f1(g.loserProj)}</td></tr>`);

  const standings = s.standings.map((r) => {
    const mv = r.move === null ? '' : r.move > 0 ? `▲${r.move}` : r.move < 0 ? `▼${-r.move}` : '–';
    const cls = r.move > 0 ? 'd-up' : r.move < 0 ? 'd-down' : 'd-zero';
    return `<tr><td>${r.rank}</td><td class="name">${team(r.teamId, r.name)}</td><td>${r.w}-${r.l}${r.t ? `-${r.t}` : ''}</td><td class="${cls}">${mv}</td><td>${f1(r.pf)}</td></tr>`;
  });

  const missed = s.missed.map((m) => `<tr><td class="name">${team(m.teamId, m.name)}</td><td>${score(m.teamId, m.scored)}</td>
    <td${pop(swapSpec(m, 'reasonable'))}>${signed(m.missedReasonable)}</td>
    <td${pop(swapSpec(m, 'perfect'))}>${signed(m.missedPerfect)}</td></tr>`);

  const playerRows = (rows) => rows.map((p) => `<tr><td class="name">${who(p)}</td><td class="txt">${esc(p.position)}</td>
    <td class="txt">${ownerOf(p)}</td><td>${f1(p.projected)}</td><td>${f1(p.actual)}</td>
    <td class="${p.diff > 0 ? 'pos' : 'neg'}">${signed(p.diff)}</td></tr>`);
  const pHead = '<th class="name">Player</th><th class="txt">Pos</th><th class="txt">Owner</th><th>Proj</th><th>Pts</th><th>±</th>';

  const positions = s.positions.map((r) => `<tr><td class="txt">${r.position === 'DST' ? 'D/ST' : r.position}</td>
    <td class="name">${r.top ? `${who(r.top)} <span class="muted">${f1(r.top.actual)}</span>` : '—'}</td>
    <td title="Average of the top ${r.depth}">${f1(r.topAvg)}</td><td>${f1(r.startAvg)}</td><td class="muted">${f1(r.startProj)}</td></tr>`);

  // His owner, status and injury: on his card's top line (once a `title` here).
  const hurtIdent = (i) => [i.name, posLabel(i.position), i.proTeam, i.label || `Missed week ${s.week + 1}`, i.type, i.owner]
    .filter(Boolean).join(' · ');
  const injuries = s.injuries.map((i) => `<tr${i.source === 'reconstructed' ? ' class="rebuilt"' : ''}>
    <td class="name">${man(i, `${esc(i.name)} <span class="muted">${esc(posLabel(i.position))}</span>`, { ident: hurtIdent(i) })}</td>
    <td class="txt">${returnText(i)}</td><td class="txt gains">${gainsText(i.gains)}</td></tr>`);

  // A block is never left blank: an empty one says why in one line.
  const or = (rows, cols, why) => (rows.length ? rows : none(cols, why));
  $('recapBody').innerHTML = [
    block('The week', table('<th class="name">Fact</th><th class="txt">Who</th>', facts, 'recap-facts'), 'recapFacts'),
    block('Results', table('<th class="name">Winner</th><th>Pts</th><th class="txt">Loser</th><th>Pts</th><th title="Projected before kickoff, winner–loser">Proj</th>', or(games, 5, 'ESPN has no results for this week.')), 'recapGames'),
    block('Standings', table('<th>#</th><th class="name">Manager</th><th>Record</th><th title="Places moved this week">Move</th><th>PF</th>', or(standings, 5, 'No standings yet.')), 'recapStandings'),
    block('Missed points', table('<th class="name">Manager</th><th>Pts</th><th title="Best lineup by ESPN\'s projections, minus what you scored">Reasonable</th><th title="Best possible lineup, minus what you scored">Perfect</th>', or(missed, 4, 'No lineups for this week.')), 'recapMissed'),
    block('Booms', table(pHead, s.booms.length ? playerRows(s.booms) : none(6, 'None')), 'recapBooms'),
    block('Busts', table(pHead, s.busts.length ? playerRows(s.busts) : none(6, 'None')), 'recapBusts'),
    block('Positions', table('<th class="txt">Pos</th><th class="name">Top scorer</th><th title="Average of the top scorers league-wide">Top avg</th><th title="This league\'s starters">Started</th><th title="What ESPN projected those starters">Proj</th>', or(positions, 5, 'No scores for this week.')), 'recapPositions'),
    block('New injuries', table(INJURY_HEAD, injuries.length ? injuries : none(3, 'Nobody new was hurt.')), 'recapInjuries'),
  ].join('');

  const bits = [];
  if (L.demo) { /* the Demo badge already says so */ }
  else if (!inputs.pool) bits.push(inputs.cloud ? 'Phone copy has no free agents for this week: rostered players only.' : 'League-wide players not read: rostered only.');
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
    'Injuries: ESPN keeps no injury history. The latest finished week’s statuses are saved on this device and used from then on. A week with no saved copy is rebuilt: a man who played and then missed the next week. Hover or tap a name for his owner, status and injury.',
    '<b>Est. return</b> is the week he played again, ESPN’s season-ending flag, or ESPN’s expected return date placed in the first week his NFL team plays on or after it (the date itself when the NFL schedule is not held). Nothing else is guessed.',
    '<b>Up while out</b>: teammates at his position (same NFL team) whose ESPN projection for the weeks he is out, up to three, averages at least 0.5 a week above their projection in the week he was hurt. Both are ESPN’s numbers; that the rise is because of him is a reading, not a measurement.',
  ].map((t) => `<p>${t}</p>`).join('');
}

// ------------------------------------------------------------------ wiring

if ($('recapWeek')) {
  // The cards, wired once on the recap's own box (re-rendered freely after).
  if ($('recapBody')) { wireTips($('recapBody')); wirePops($('recapBody')); }
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
