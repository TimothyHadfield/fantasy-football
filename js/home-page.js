// The front door: what is true about the league right now, on one screen.
//
// Written for week 1, which is the hard case. Almost every interesting number
// on this site — luck, skill, consistency, projection error — needs a stack of
// completed weeks before it means anything, and fetchSeasonData() keeps only
// games where BOTH sides scored, so a stats-driven landing page is literally
// blank until the first Sunday night is over. That is the worst possible first
// impression: an empty dashboard reads as broken, not as early.
//
// So this page is built on the two reads that already have something to say
// before kickoff:
//
//   fetchSchedule()        one request — the slate, plus results as they land
//   fetchWeekRosters(week) one request — projections, lineups, injuries
//
// and it only shows quantities that are exact facts about a single week:
// this week's projected totals, each roster's season-long projection, injured
// starters, and — once a week is final — bench points and start/sit misses.
// No season-long averages over one game, which is noise wearing a number's suit.

import { fetchSchedule, fetchWeekRosters } from './season.js';
import { generateDemoSchedule, generateDemoWeekRosters } from './demo-rosters.js';
import { savedConfig, onConnection } from './connection.js';
import * as espn from './espn.js';
import * as prefs from './prefs.js';
import { enableSort } from './sortable.js';

const $ = (id) => document.getElementById(id);
const store = prefs.scope('home');

const state = {
  // What the user picked, persisted. Separate from `isDemo`, which is what is
  // actually on screen — they differ while a live load is still in flight.
  source: store.get('source') === 'live' ? 'live' : 'demo',
  isDemo: true,
  schedule: null,   // { leagueName, teams, weeks, byWeek, games }
  rosters: null,    // { week, teams } for the selected week, or null
  week: null,
  teamId: savedConfig()?.teamId ?? null,
};

// ------------------------------------------------------------------ formatting

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const dash = '<span class="muted">—</span>';

const isNum = (n) => typeof n === 'number' && !Number.isNaN(n);

/** A null total means "no player has a value yet", which is not zero. */
const fmt = (n, digits = 1) => (isNum(n) ? n.toFixed(digits) : '—');

const inline = (n, digits = 1) => (isNum(n) ? n.toFixed(digits) : dash);

/**
 * A numeric cell. When the value is missing the cell carries no data-v at all,
 * so sortable.js treats it as missing and sinks it — an empty data-v would
 * parse as 0 and rank "unknown" above every real negative.
 */
function numCell(n, { digits = 1, sign = false, cls = '' } = {}) {
  if (!isNum(n)) return `<td${cls ? ` class="${cls}"` : ''}>${dash}</td>`;
  const text = (sign && n > 0 ? '+' : '') + n.toFixed(digits);
  return `<td${cls ? ` class="${cls}"` : ''} data-v="${n}">${text}</td>`;
}

const round1 = (n) => Math.round(n * 10) / 10;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ------------------------------------------------------------------- injuries

// ESPN's status strings, worst first. Anything unrecognised is kept rather than
// hidden — a status we don't know the name of is still news.
const INJURY_RANK = {
  OUT: 3, INJURY_RESERVE: 3, SUSPENSION: 3, NOT_ACTIVE: 3,
  DOUBTFUL: 2,
  QUESTIONABLE: 1, DAY_TO_DAY: 1, PROBABLE: 1,
};

const INJURY_LABEL = {
  INJURY_RESERVE: 'IR', DAY_TO_DAY: 'Day to day', NOT_ACTIVE: 'Not active',
};

const healthy = (s) => !s || s === 'ACTIVE' || s === 'NORMAL';

function injuryLabel(status) {
  if (INJURY_LABEL[status]) return INJURY_LABEL[status];
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}

function injuryClass(status) {
  const rank = INJURY_RANK[status] ?? 1;
  return rank === 3 ? 'out' : rank === 2 ? 'doubt' : 'quest';
}

// ----------------------------------------------------------------- the model
//
// Every number the page shows is derived here, so the renderers below do no
// arithmetic and this half can be reasoned about without a browser.

/**
 * @param {object} input { schedule, rosters, week, teamId, isDemo }
 * @returns a plain object describing every panel on the page
 */
export function buildModel({ schedule, rosters, week, teamId = null, isDemo = false }) {
  const roster = new Map((rosters?.teams || []).map((t) => [t.id, t]));

  const games = (schedule.byWeek.get(week) || []).map((g) => {
    const hp = roster.get(g.homeId)?.projectedTotal ?? null;
    const ap = roster.get(g.awayId)?.projectedTotal ?? null;

    // Only name a favourite when both sides have a projection; one-sided is not
    // a prediction, it is half a number.
    const both = isNum(hp) && isNum(ap);
    return {
      ...g,
      homeProjected: hp,
      awayProjected: ap,
      favourite: both && hp !== ap ? (hp > ap ? 'home' : 'away') : null,
      projectedMargin: both ? round1(Math.abs(hp - ap)) : null,
      mine: teamId != null && (g.homeId === teamId || g.awayId === teamId),
    };
  });

  return {
    isDemo,
    week,
    weeks: schedule.weeks,
    leagueName: schedule.leagueName,
    teamCount: schedule.teams.length,
    teamId,
    games,
    hasRosters: Boolean(rosters?.teams?.length),
    playedThisWeek: games.filter((g) => g.played).length,
    totalGames: schedule.games.length,
    playedOverall: schedule.games.filter((g) => g.played).length,
    strength: rosterStrength(rosters),
    standings: standingsThrough(schedule, week),
    weeksCounted: countedWeeks(schedule, week),
    injuries: injuredStarters(rosters),
    bench: benchReport(rosters, games),
  };
}

/**
 * Who has the best roster, before anyone has played a down.
 *
 * seasonProjectedTotal is the sum of the season-long projections of whoever is
 * in the lineup this week. It is the closest thing to an objective talent
 * ranking that exists in week 1, and it needs zero completed games.
 */
function rosterStrength(rosters) {
  const rows = (rosters?.teams || []).map((t) => ({
    id: t.id,
    name: t.name,
    value: isNum(t.seasonProjectedTotal) ? t.seasonProjectedTotal : null,
  }));
  rows.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Records and points, counting only games finished on or before `week`. */
function standingsThrough(schedule, week) {
  const rows = new Map(
    schedule.teams.map((t) => [t.id, { id: t.id, name: t.name, w: 0, l: 0, t: 0, pf: 0, pa: 0 }])
  );

  for (const g of schedule.games) {
    if (!g.played || g.week > week) continue;
    if (g.awayId == null) continue;                       // bye
    const home = rows.get(g.homeId);
    const away = rows.get(g.awayId);
    if (!home || !away) continue;

    home.pf += g.homeScore; home.pa += g.awayScore;
    away.pf += g.awayScore; away.pa += g.homeScore;

    if (g.winner === 'tie') { home.t++; away.t++; }
    else if (g.winner === 'home') { home.w++; away.l++; }
    else { away.w++; home.l++; }
  }

  return [...rows.values()]
    .map((r) => ({ ...r, pf: round1(r.pf), pa: round1(r.pa), diff: round1(r.pf - r.pa) }))
    .sort((a, b) => (b.w - b.l) - (a.w - a.l) || b.pf - a.pf);
}

/** How many weeks the standings actually rest on — the sample size, stated. */
function countedWeeks(schedule, week) {
  const seen = new Set();
  for (const g of schedule.games) if (g.played && g.week <= week) seen.add(g.week);
  return seen.size;
}

/**
 * Starters carrying an injury designation.
 *
 * One of the very few things that is fully meaningful before kickoff: a
 * questionable starter is a decision the owner still has to make, this week,
 * whether or not a single game has been played.
 */
function injuredStarters(rosters) {
  const out = [];
  for (const team of rosters?.teams || []) {
    for (const p of team.starters || []) {
      if (healthy(p.injuryStatus)) continue;
      out.push({
        teamId: team.id,
        teamName: team.name,
        name: p.name,
        position: p.position,
        slot: p.slot,
        status: p.injuryStatus,
        rank: INJURY_RANK[p.injuryStatus] ?? 1,
        projected: isNum(p.projected) ? p.projected : null,
      });
    }
  }
  out.sort((a, b) => b.rank - a.rank || (b.projected ?? -1) - (a.projected ?? -1));
  return out;
}

/**
 * The single best player a team left on its bench, where "best" means he
 * outscored a starter he was actually eligible to replace.
 *
 * Eligibility is the whole point: a benched receiver who beat the kicker is not
 * a start/sit miss, because he could never have taken that slot. A slot we have
 * no eligibility rule for is skipped rather than guessed at.
 */
function biggestMiss(team) {
  let best = null;
  for (const b of team.bench || []) {
    if (!isNum(b.actual)) continue;
    if (b.slot === 'IR') continue;                        // was not startable
    for (const s of team.starters || []) {
      if (!isNum(s.actual)) continue;
      const eligible = espn.SLOT_ELIGIBILITY[s.lineupSlotId];
      if (!eligible || !eligible.includes(b.position)) continue;
      const gain = round1(b.actual - s.actual);
      if (gain > 0 && (!best || gain > best.gain)) best = { gain, benched: b, started: s };
    }
  }
  return best;
}

/** Bench points and start/sit misses, for teams whose week is actually over. */
function benchReport(rosters, games) {
  const finished = new Set();
  for (const g of games) {
    if (!g.played) continue;
    finished.add(g.homeId);
    if (g.awayId != null) finished.add(g.awayId);
  }

  const rows = (rosters?.teams || [])
    .filter((t) => finished.has(t.id) && isNum(t.benchActualTotal))
    .map((t) => ({
      id: t.id,
      name: t.name,
      started: isNum(t.actualTotal) ? t.actualTotal : null,
      bench: t.benchActualTotal,
      miss: biggestMiss(t),
    }));

  rows.sort((a, b) => (b.miss?.gain ?? -1) - (a.miss?.gain ?? -1) || b.bench - a.bench);
  return rows;
}

// -------------------------------------------------------------------- loading

/** The week to land on: the first one still to be played, else the last one. */
function currentWeek(schedule) {
  const pending = schedule.weeks.find((w) =>
    (schedule.byWeek.get(w) || []).some((g) => !g.played)
  );
  return pending ?? schedule.weeks[schedule.weeks.length - 1] ?? 1;
}

function setStatus(html, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = html;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

function setToggle(showing) {
  $('sourceToggle')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.src === showing));
}

function loadDemo(note = '') {
  state.isDemo = true;
  setToggle('demo');

  const schedule = generateDemoSchedule();
  const week = currentWeek(schedule);
  state.schedule = schedule;
  state.week = week;
  state.rosters = generateDemoWeekRosters(week);

  setStatus(
    (note ? `${note} ` : '') +
    'Showing generated sample data — invented teams, invented players, not your league.'
  );
  draw();
}

async function loadLive() {
  const cfg = savedConfig();
  if (!cfg) {
    loadDemo('No league connected yet — use the strip above.');
    return;
  }

  setToggle('live');
  espn.configure({ leagueId: cfg.leagueId, season: cfg.season });
  if (cfg.teamId != null) state.teamId = cfg.teamId;

  setStatus('Loading your league from ESPN…');
  try {
    const schedule = await fetchSchedule();
    if (!schedule.games.length) {
      setStatus(
        `Connected to ${esc(schedule.leagueName)}, but ESPN has no matchups for ` +
        `${cfg.season} yet. The demo league is still shown below.`,
        true
      );
      setToggle('demo');
      return;
    }

    const week = currentWeek(schedule);
    state.schedule = schedule;
    state.week = week;
    state.isDemo = false;
    state.rosters = await loadRosters(week);
    reportLive();
    draw();
  } catch (err) {
    // Demo data is already on screen from boot, so a failed live load costs the
    // user a sentence, not the page.
    setStatus(`${esc(err.message)} Still showing the demo league below.`, true);
    setToggle('demo');
  }
}

/**
 * Rosters are a second request, and a week ESPN has not opened yet can fail on
 * its own. Losing them costs three panels, not the whole dashboard.
 */
async function loadRosters(week) {
  try {
    return await fetchWeekRosters(week);
  } catch {
    return null;
  }
}

function reportLive() {
  const played = state.schedule.games.filter((g) => g.played).length;
  const missing = state.rosters
    ? ''
    : ' Rosters for this week could not be read, so projections, injuries and bench points are unavailable.';
  setStatus(
    `${esc(state.schedule.leagueName)} · week ${state.week} of ${state.schedule.weeks.length} · ` +
    `${played} of ${state.schedule.games.length} games played.${missing}`,
    Boolean(missing)
  );
}

async function changeWeek(week) {
  state.week = week;
  state.rosters = state.isDemo ? generateDemoWeekRosters(week) : await loadRosters(week);
  if (!state.isDemo) reportLive();
  draw();
}

/** Build the model from current state and paint it. */
function draw() {
  if (!state.schedule) return;
  render(buildModel({
    schedule: state.schedule,
    rosters: state.rosters,
    week: state.week,
    teamId: state.teamId,
    isDemo: state.isDemo,
  }));
}

// --------------------------------------------------------------------- render

export function render(m) {
  renderHeader(m);
  renderWeekPicker(m);
  renderMatchups(m);
  renderStrength(m);
  renderStandings(m);
  renderInjuries(m);
  renderBench(m);
}

function renderHeader(m) {
  const badge = $('modeBadge');
  badge.className = 'badge ' + (m.isDemo ? 'demo' : 'live');
  badge.textContent = m.isDemo ? 'Demo' : 'Live';

  $('pageSub').textContent = m.isDemo
    ? 'A generated sample league, so the dashboard is never empty while you set yours up.'
    : `${m.leagueName} · ${m.teamCount} teams · week ${m.week} of ${m.weeks.length}`;

  const pct = m.weeks.length ? Math.round((m.week / m.weeks.length) * 100) : 0;
  $('progressBar').setAttribute('style', `width:${pct}%`);
}

function renderWeekPicker(m) {
  const sel = $('weekSelect');
  sel.innerHTML = m.weeks
    .map((w) => `<option value="${w}">Week ${w} of ${m.weeks.length}</option>`)
    .join('');
  sel.value = String(m.week);
}

function renderMatchups(m) {
  $('matchupsTitle').textContent = `Week ${m.week} of ${m.weeks.length}`;

  if (!m.games.length) {
    $('matchups').innerHTML = '<div class="empty">No matchups scheduled for this week.</div>';
    $('matchupsNote').textContent = '';
    return;
  }

  $('matchups').innerHTML =
    `<div class="games">${m.games.map((g) => gameCard(g, m.teamId)).join('')}</div>`;

  if (!m.playedThisWeek) {
    $('matchupsNote').innerHTML = m.games.some((g) => g.projectedMargin !== null)
      ? 'Nothing has kicked off. <strong>Proj</strong> is the sum of each starting lineup&rsquo;s projection for this week; the favourite is whoever projects higher, nothing cleverer than that.'
      : 'Nothing has kicked off, and ESPN has published no projections for this week yet.';
  } else {
    $('matchupsNote').innerHTML =
      `${plural(m.playedThisWeek, 'game')} final of ${m.games.length}. ` +
      '<strong>Proj</strong> is what the starting lineup was projected to score, <strong>Pts</strong> what it did.';
  }
}

function gameCard(g, teamId) {
  const bye = g.awayId === null || g.awayId === undefined;

  const side = (which, name, proj, score, id) => {
    const classes = ['side'];
    if (g.played && g.winner !== 'tie') classes.push(g.winner === which ? 'win' : 'lose');
    else if (!g.played && g.favourite === which) classes.push('fav');
    const you = teamId != null && id === teamId ? ' <span class="muted">(you)</span>' : '';
    return `<div class="${classes.join(' ')}">
        <span class="tname">${esc(name)}${you}</span>
        <span class="tproj">${inline(proj)}</span>
        <span class="tscore">${g.played ? inline(score) : dash}</span>
      </div>`;
  };

  let meta;
  if (bye) meta = 'Bye week';
  else if (g.played && g.winner === 'tie') meta = 'Tied';
  else if (g.played) {
    const winner = g.winner === 'home' ? g.homeName : g.awayName;
    meta = `${esc(winner)} by ${fmt(Math.abs(g.margin))}`;
  } else if (g.favourite) {
    const fav = g.favourite === 'home' ? g.homeName : g.awayName;
    meta = `Projected: ${esc(fav)} by ${fmt(g.projectedMargin)}`;
  } else {
    meta = 'Upcoming · no projection yet';
  }

  return `<div class="game${g.played ? '' : ' upcoming'}${g.mine ? ' mine' : ''}">
      <div class="ghead"><span>${g.played ? 'Final' : 'Upcoming'}</span><span>Proj · Pts</span></div>
      ${side('home', g.homeName, g.homeProjected, g.homeScore, g.homeId)}
      ${bye ? '' : side('away', g.awayName, g.awayProjected, g.awayScore, g.awayId)}
      <div class="gmeta">${meta}</div>
    </div>`;
}

function renderStrength(m) {
  const rows = m.strength.filter((r) => r.value !== null);

  if (!rows.length) {
    $('strength').innerHTML = `<div class="empty">${
      m.hasRosters
        ? 'ESPN has no season projections for these lineups yet.'
        : 'Rosters for this week are unavailable, so there is nothing to rank.'
    }</div>`;
    $('strengthNote').textContent = '';
    return;
  }

  // Bars run from the weakest roster to the strongest, not from zero: every
  // team's season projection is within a few percent of every other's, so
  // zero-based bars would all be the same length and say nothing.
  const values = rows.map((r) => r.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  $('strength').innerHTML =
    '<ol class="rank">' +
    rows
      .map((r) => {
        const width = 8 + 92 * ((r.value - min) / span);
        return `<li${r.id === m.teamId ? ' class="me"' : ''}>
            <span class="rk">${r.rank}</span>
            <span class="nm">${esc(r.name)}</span>
            <span class="bar"><i style="width:${width.toFixed(1)}%"></i></span>
            <span class="vv">${Math.round(r.value)}</span>
          </li>`;
      })
      .join('') +
    '</ol>';

  $('strengthNote').innerHTML =
    'Season-long projected points for each team&rsquo;s <em>current</em> starting lineup, ' +
    'straight from ESPN. It needs no completed games, which makes it the only honest ' +
    'answer to &ldquo;who is good&rdquo; this early. Bar length shows the gap between ' +
    `first and last (${Math.round(max - min)} points), not the totals.`;
}

function renderStandings(m) {
  if (!m.weeksCounted) {
    $('standings').innerHTML =
      '<div class="empty">Nothing has been played yet. Standings appear once the first week is final.</div>';
    $('standingsNote').textContent = '';
    return;
  }

  const rows = m.standings
    .map((r) => {
      const record = r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
      const diffCls = r.diff > 0 ? 'pos' : r.diff < 0 ? 'neg' : 'muted';
      return `<tr${r.id === m.teamId ? ' class="me"' : ''}>
          <td class="name">${esc(r.name)}</td>
          <td data-v="${r.w - r.l}">${record}</td>
          ${numCell(r.pf)}
          ${numCell(r.pa)}
          ${numCell(r.diff, { sign: true, cls: diffCls })}
        </tr>`;
    })
    .join('');

  $('standings').innerHTML = `<div class="table-scroll"><table id="standingsTable">
      <thead><tr>
        <th class="name" data-sort>Team</th>
        <th data-sort>W-L</th>
        <th data-sort>PF</th>
        <th data-sort>PA</th>
        <th data-sort>Diff</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  enableSort($('standingsTable'));

  $('standingsNote').innerHTML =
    `Through week ${m.week}: ${plural(m.weeksCounted, 'week')} played, ` +
    `so ${plural(m.weeksCounted, 'game')} per team. ` +
    (m.weeksCounted < 4
      ? '<strong>Far too thin to rank anyone by</strong> — roster strength is the better guide until about week 4.'
      : 'Ordered by win differential, then points for.');
}

function renderInjuries(m) {
  if (!m.injuries.length) {
    $('injuries').innerHTML = `<div class="empty">${
      m.hasRosters
        ? 'Every starter in the league is listed active.'
        : 'Rosters for this week are unavailable, so injuries cannot be checked.'
    }</div>`;
    $('injuryNote').textContent = '';
    return;
  }

  const rows = m.injuries
    .map(
      (p) => `<tr${p.teamId === m.teamId ? ' class="me"' : ''}>
          <td class="name">${esc(p.name)} <span class="muted">${esc(p.position)}</span></td>
          <td class="left" data-v="${p.rank}"><span class="badge ${injuryClass(p.status)}">${esc(injuryLabel(p.status))}</span></td>
          <td class="left">${esc(p.teamName)}</td>
          <td>${esc(p.slot)}</td>
          ${numCell(p.projected)}
        </tr>`
    )
    .join('');

  $('injuries').innerHTML = `<div class="table-scroll"><table id="injuryTable">
      <thead><tr>
        <th class="name" data-sort>Player</th>
        <th class="left" data-sort>Status</th>
        <th class="left" data-sort>Fantasy team</th>
        <th data-sort>Slot</th>
        <th data-sort>Proj</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  enableSort($('injuryTable'));

  const out = m.injuries.filter((p) => p.rank === 3).length;
  $('injuryNote').textContent =
    `${plural(m.injuries.length, 'starter')} across the league carries a designation` +
    `${out ? `, ${out} of them ruled out` : ''}. Bench players are left out on purpose — ` +
    'these are players someone is currently planning to start.';
}

function renderBench(m) {
  if (!m.bench.length) {
    $('bench').innerHTML = `<div class="empty">${
      m.playedThisWeek
        ? 'No final bench scores for this week.'
        : `Week ${m.week} has not finished. Bench points are exact facts, so they wait for final scores.`
    }</div>`;
    $('benchNote').textContent = '';
    return;
  }

  const rows = m.bench
    .map((r) => {
      const miss = r.miss
        ? `${esc(r.miss.benched.name)} <span class="muted">(${fmt(r.miss.benched.actual)})</span> over ` +
          `${esc(r.miss.started.name)} <span class="muted">(${fmt(r.miss.started.actual)})</span>`
        : '<span class="muted">started the right nine</span>';
      return `<tr${r.id === m.teamId ? ' class="me"' : ''}>
          <td class="name">${esc(r.name)}</td>
          ${numCell(r.started)}
          ${numCell(r.bench)}
          <td class="left">${miss}</td>
          ${r.miss
            ? `<td class="neg" data-v="${r.miss.gain}">−${fmt(r.miss.gain)}</td>`
            : `<td>${dash}</td>`}
        </tr>`;
    })
    .join('');

  $('bench').innerHTML = `<div class="table-scroll"><table id="benchTable">
      <thead><tr>
        <th class="name" data-sort>Team</th>
        <th data-sort>Started</th>
        <th data-sort>Bench</th>
        <th class="left" data-sort>Biggest miss</th>
        <th data-sort>Cost</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  enableSort($('benchTable'));

  const total = round1(m.bench.reduce((a, r) => a + r.bench, 0));
  const missed = m.bench.filter((r) => r.miss).length;
  $('benchNote').innerHTML =
    `${fmt(total)} points sat on benches in week ${m.week}. A <em>miss</em> counts only ` +
    'when the benched player was eligible for the slot he would have taken, so a receiver ' +
    `out-scoring a kicker is not one. ${plural(missed, 'team')} left points behind.`;
}

// ----------------------------------------------------------------- interaction

$('sourceToggle').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-src]');
  if (!btn) return;
  state.source = btn.dataset.src;
  store.set('source', state.source);
  state.source === 'demo' ? loadDemo() : loadLive();
});

// The week is deliberately NOT persisted. This is the page you open to see what
// is happening now, so it should always land on the current week rather than on
// whatever week you were reading three days ago.
$('weekSelect').addEventListener('change', (e) => {
  changeWeek(Number(e.target.value));
});

// The connection strip does its own round trip after this module has already
// drawn the demo league. Take its answer when it lands: switch to the real
// league the first time, and on later events — picking which team is yours —
// just repaint the highlight.
onConnection((conn) => {
  if (!conn) return;
  const stillDemo = state.isDemo;
  if (conn.teamId != null) state.teamId = conn.teamId;
  if (stillDemo && state.source === 'live') loadLive();
  else draw();
});

// Demo first, always: the page is never blank, and never shows an error before
// it has shown anything. A live load replaces it a moment later.
loadDemo();
if (state.source === 'live' && savedConfig()) loadLive();
