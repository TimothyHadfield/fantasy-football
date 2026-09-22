// The front door: what is true about the league right now, on one screen.
//
// Written for week 1, which is the hard case. Almost every interesting number
// on this site — luck, skill, consistency, projection error — needs a stack of
// completed weeks before it means anything, and fetchSeasonData() keeps only
// games ESPN has DECIDED, so a stats-driven landing page is literally blank
// until the first week is final. That is the worst possible first
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
//
// The one exception is the win chance on the cards, which is the Schedule
// page's figure and is built by the same code (js/capture.js `matchupOdds`).
// That needs the played weeks' rosters as well, so it is filled in a moment
// after the cards themselves — see loadOdds().

// A namespace import, not named ones: some suites stand a stub in for
// season.js that lacks `fetchWeeksRosters`, and a missing NAMED import would
// fail the whole module at link time.
import * as season from './season.js';
import { generateDemoSchedule, generateDemoWeekRosters } from './demo-rosters.js';
import { savedConfig, onConnection } from './connection.js';
import * as espn from './espn.js';
import * as prefs from './prefs.js';
import * as capture from './capture.js';
import { DEFAULT_SIGMA, MIN_GAMES_TO_CALIBRATE } from './forecast.js';
import { enableSort } from './sortable.js';
// THE ONE RED/GREEN SCALE (HANDOFF rule 14, Tim 2026-09-19: "it needs to be
// added to all the other places a number is referred to across the whole
// site"). What it is put on here, and what it is deliberately NOT put on, is
// argued at each call site below — the decisions are the feature, not the
// import. Nothing here invents a comparison group: every scale on this page is
// one column of the same kind of number, across the same ten squads, in the
// same week.
import { heatScale, heatOf, heatMarkHtml, describeHeat } from './heat.js';
// The positional floor's one sentence, so Home states it in the same words as
// Analysis and Trade. See js/floor.js.
import { describeFloors } from './floor.js';

const $ = (id) => document.getElementById(id);
const store = prefs.scope('home');

const state = {
  // What the page is trying to show. Separate from `isDemo`, which is what is
  // actually on screen — they differ while a live load is still in flight.
  //
  // LIVE UNLESS SOMEONE CHOSE DEMO. It used to be demo unless a 'live'
  // preference had been saved, and that preference is per browser — so on a
  // new phone the page sat on the demo league under a bar saying Connected.
  // Only an explicit click on "Demo data" keeps it there now, the same rule
  // the schedule page follows.
  source: store.get('source') === 'demo' ? 'demo' : 'live',
  isDemo: true,
  schedule: null,   // { leagueName, teams, weeks, byWeek, games }
  rosters: null,    // { week, teams } for the selected week, or null
  week: null,
  // The bench panel's own week: the selected week once it has a final score,
  // else the latest week that has one. See benchWeekFor().
  benchWeek: null,
  benchRosters: null,
  teamId: savedConfig()?.teamId ?? null,
  // The win chance: capture.matchupOdds() for the league on screen, or null
  // while its played weeks are still being read (`oddsPending`).
  odds: null,
  oddsPending: false,
  // week -> teams, every roster week read for the odds so far. Reset with the
  // league; a week change only reads the weeks this map does not hold.
  oddsTeams: new Map(),
  oddsToken: 0,
};

// ------------------------------------------------------------------ formatting

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

const dash = '<span class="muted">—</span>';

/**
 * A reference to one specific NFL player — his name, or a number that is his.
 *
 * Wherever this page names a player it now sends you to his row on the Players
 * page, which is the only screen that shows his next thirteen weeks. These are
 * real `<a href>`s and not click handlers, deliberately: middle-click, ctrl-click
 * and "open in new tab" then behave the way they do everywhere else on the web.
 *
 * The target is ESPN's own `playerId` — never a name, never a row index —
 * because that is what the Players page addresses a row by, and two men in a
 * ten-team league really can share a name. A player ESPN gave us no id for is
 * rendered as plain text rather than pointed at `?player=undefined`.
 *
 * Note what does NOT get one of these: team and manager names. Tim's vocabulary
 * calls managers "players", but they have no ESPN playerId and no row on the
 * Players page, so the matchup cards, the strength bars, the standings and the
 * bench table's Team column stay plain text.
 *
 * @param {number|string|null|undefined} id  ESPN's playerId
 * @param {string} name   the player, for the title; escaped here
 * @param {string} inner  already-escaped HTML to sit inside the link
 */
function pref(id, name, inner) {
  if (id === null || id === undefined) return inner;
  return (
    `<a class="pref" href="waivers.html?player=${encodeURIComponent(id)}"` +
    ` title="${esc(name)} — open his next 13 weeks on the Players page">${inner}</a>`
  );
}

const isNum = (n) => typeof n === 'number' && !Number.isNaN(n);

/** A null total means "no player has a value yet", which is not zero. */
const fmt = (n, digits = 1) => (isNum(n) ? n.toFixed(digits) : '—');

const inline = (n, digits = 1) => (isNum(n) ? n.toFixed(digits) : dash);

/**
 * A numeric cell. When the value is missing the cell carries no data-v at all,
 * so sortable.js treats it as missing and sinks it — an empty data-v would
 * parse as 0 and rank "unknown" above every real negative.
 *
 * `wrap` decorates the rendered number without touching the cell: it is how a
 * number that belongs to one player becomes a link to him. It is applied to the
 * text only, never to the dash — there is no number there to refer to anybody —
 * and data-v stays on the <td>, so sorting reads the same value it always did.
 *
 * `scale` is a scale from js/heat.js, or null for no colour at all. When one is
 * given the cell takes THREE of the four "never colour alone" channels at once:
 * the class carries both the tint and a heavier weight, the ▲/▼ goes on the end
 * of the number at the end of the scale, and the `title` says where the number
 * stands in words (js/touch-titles.js makes that a tap on a phone). The fourth
 * — the key sentence under the table — is the caller's job and is not optional.
 *
 * `data-v` is emitted whatever else happens, which matters more than it looks:
 * sortable.js falls back to the cell's TEXT when there is no data-v and strips
 * only `, + $ %` and spaces, so a cell ending in ▲ would sort as a string and
 * scatter the best and worst rows of a column the first time a heading is
 * clicked. Every cell here has always carried one; the scale must not be the
 * thing that changes that.
 */
function numCell(
  n,
  { digits = 1, sign = false, cls = '', wrap = null, scale = null, what = '' } = {}
) {
  if (!isNum(n)) return `<td${cls ? ` class="${cls}"` : ''}>${dash}</td>`;
  const text = (sign && n > 0 ? '+' : '') + n.toFixed(digits);
  const h = scale ? heatOf(n, scale, { what }) : null;
  const klass = [cls, h ? h.cls : ''].filter(Boolean).join(' ');
  return (
    `<td${klass ? ` class="${klass}"` : ''} data-v="${n}"` +
    `${h ? ` title="${esc(h.words)}"` : ''}>` +
    `${wrap ? wrap(text) : text}${h ? heatMarkHtml(h) : ''}</td>`
  );
}

const round1 = (n) => Math.round(n * 10) / 10;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A chance as the Schedule page prints it: whole percent, never 0% or 100%. */
function pctText(p) {
  if (!Number.isFinite(p)) return '—';
  const v = Math.min(100, Math.max(0, p * 100));
  if (v > 0 && v < 0.5) return '&lt;1%';
  if (v < 100 && v >= 99.5) return '&gt;99%';
  return `${Math.round(v)}%`;
}

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
export function buildModel({
  schedule, rosters, week, teamId = null, isDemo = false,
  benchWeek = week, benchRosters = null,
  odds = null, oddsPending = false,
}) {
  const roster = new Map((rosters?.teams || []).map((t) => [t.id, t]));

  const games = (schedule.byWeek.get(week) || []).map((g) => {
    // Proj on the card: the lineup AS SET, which is what the manager has
    // actually told ESPN and the number ESPN's own matchup page shows.
    const hp = roster.get(g.homeId)?.projectedTotal ?? null;
    const ap = roster.get(g.awayId)?.projectedTotal ?? null;

    // Only name a favourite when both sides have a projection; one-sided is not
    // a prediction, it is half a number.
    const both = isNum(hp) && isNum(ap);
    const mine = teamId != null && (g.homeId === teamId || g.awayId === teamId);
    const bye = g.awayId === null || g.awayId === undefined;

    // THE WIN CHANCE IS THE SCHEDULE PAGE'S, NOT A SECOND MODEL. It compares
    // the BEST legal lineup each side could field that week, read against the
    // spread measured from this league's played weeks (or 27 below twelve
    // team-weeks) — js/capture.js's `matchupOdds`, the same pieces Schedule
    // calls. Only for a game nobody has kicked off in, exactly as Schedule:
    // half a scoreline is neither a result nor a forecast.
    const upcoming = !bye && capture.gameState(g) === 'upcoming';
    let homeWinPct = null;
    let homeBest = null;
    let awayBest = null;
    if (odds && upcoming) {
      homeBest = odds.points(g, 'home');
      awayBest = odds.points(g, 'away');
      homeWinPct = odds.forGame(g);
    }
    const hasOdds = isNum(homeWinPct);
    const myWinPct = mine && hasOdds ? (g.homeId === teamId ? homeWinPct : 1 - homeWinPct) : null;

    // The favourite the card names is the one the percentage is about, so the
    // highlight, the margin and the chance can never point different ways.
    let favourite = null;
    let projectedMargin = null;
    if (hasOdds) {
      favourite = Math.abs(homeBest - awayBest) < 0.5 ? null : homeBest > awayBest ? 'home' : 'away';
      projectedMargin = round1(Math.abs(homeBest - awayBest));
    } else if (both) {
      favourite = hp !== ap ? (hp > ap ? 'home' : 'away') : null;
      projectedMargin = round1(Math.abs(hp - ap));
    }

    return {
      ...g,
      homeProjected: hp,
      awayProjected: ap,
      homeBest,
      awayBest,
      homeWinPct,
      favourite,
      projectedMargin,
      marginBasis: hasOdds ? 'best' : both ? 'set' : null,
      oddsPending: Boolean(oddsPending && upcoming && !hasOdds),
      mine,
      myWinPct,
    };
  });
  // His own game leads the list; the rest keep ESPN's order.
  games.sort((a, b) => Number(b.mine) - Number(a.mine));

  // The bench panel may be reading an earlier week than the matchups — the
  // latest one with a final score. Its games are that week's.
  const benchSame = benchWeek === week;
  const benchGames = benchSame ? games : schedule.byWeek.get(benchWeek) || [];
  const benchFrom = benchSame ? rosters : benchRosters;

  return {
    isDemo,
    week,
    weeks: schedule.weeks,
    leagueName: schedule.leagueName,
    teamCount: schedule.teams.length,
    teamId,
    games,
    spread: odds ? { sigma: odds.sigma, calibrated: odds.calibrated, sample: odds.sample } : null,
    // The positional floor behind the chance, in the words Analysis and Trade
    // use for it (rule 7) — empty when there is no floor to state.
    floorSaid: odds ? describeFloors(odds.floors, { week: odds.floorWeek ?? null }) : '',
    hasRosters: Boolean(rosters?.teams?.length),
    playedThisWeek: games.filter((g) => g.played).length,
    totalGames: schedule.games.length,
    playedOverall: schedule.games.filter((g) => g.played).length,
    strength: rosterStrength(rosters),
    standings: standingsThrough(schedule, week),
    weeksCounted: countedWeeks(schedule, week),
    injuries: injuredStarters(rosters),
    bench: benchReport(benchFrom, benchGames),
    benchWeek,
    // IS THE BENCH PANEL'S WEEK FINISHED FOR EVERYBODY? The red/green scale on
    // the Started column needs it: mid-Sunday the panel holds the four squads
    // whose games are over, and "above average" worked out from four teams is
    // not "above the league". A week where every fixture is final is the only
    // one where those ten scores are a comparison group.
    benchWeekComplete: benchGames.length > 0 && benchGames.every((g) => g.played),
    benchRostersMissing: !benchFrom?.teams?.length,
  };
}

/**
 * ESPN's season projection covers the 17-game regular season, so dividing by it
 * turns a season total into a typical week.
 *
 * There are two other copies of this number — `js/trade.js` exports one and
 * `js/analysis-page.js` keeps its own — and all three should be one constant.
 * They were left alone deliberately today: both of those files are being worked
 * on elsewhere as this goes in, and a shared constant landing under somebody
 * mid-edit is how a one-line change becomes a merge nobody asked for.
 */
const SEASON_GAMES = 17;

/**
 * Who has the best roster, before anyone has played a down.
 *
 * seasonProjectedTotal is the sum of the season-long projections of whoever is
 * in the lineup this week. It is the closest thing to an objective talent
 * ranking that exists in week 1, and it needs zero completed games.
 *
 * SHOWN PER WEEK, NOT PER SEASON (Tim, 2026-09-19: "right now the roster
 * strength box has the numbers on the right displayed as across the season.
 * This means nothing to the user. Show it as per week."). He is right, and the
 * reason is that nobody has a feel for 1,780: a fantasy manager reads scores in
 * the hundred-and-something a week that ESPN puts under a lineup, so a
 * four-figure season total has to be divided by something in the reader's head
 * before it says anything at all. The RANKING and the BARS are untouched by it
 * — dividing every row by the same 17 cannot reorder them — so this changes
 * what the column says, not what the panel claims.
 *
 * The season total is kept alongside it, because the note still has to be able
 * to say where the per-week figure came from.
 */
function rosterStrength(rosters) {
  const rows = (rosters?.teams || []).map((t) => ({
    id: t.id,
    name: t.name,
    raw: isNum(t.seasonProjectedTotal) ? t.seasonProjectedTotal : null,
    seasonTotal: isNum(t.seasonProjectedTotal) ? round1(t.seasonProjectedTotal) : null,
    value: isNum(t.seasonProjectedTotal)
      ? round1(t.seasonProjectedTotal / SEASON_GAMES)
      : null,
  }));
  // RANKED ON THE RAW TOTAL, rounded for display only (AUDIT §1.9): sorted on
  // the rounded week, two squads 1.8 season points apart tied at 104.7 and fell
  // back to ESPN's team order, while their own titles showed them differing.
  rows.sort((a, b) => (b.raw ?? -Infinity) - (a.raw ?? -Infinity));
  return rows.map(({ raw, ...r }, i) => ({ ...r, rank: i + 1 }));
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

  // ESPN's order: win percentage with a tie as half a win, then points for.
  // This league has no matchup tie-breaker, so a tie stands and has to count —
  // wins minus losses ranked a 1-0-1 team level with a 1-0, and a 0-0-2 team
  // level with a 1-1.
  return [...rows.values()]
    .map((r) => ({
      ...r,
      pf: round1(r.pf), pa: round1(r.pa), diff: round1(r.pf - r.pa),
      pct: winPct(r),
    }))
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0) || b.pf - a.pf);
}

/** Wins plus half the ties, over games played; null before any. */
export function winPct(r) {
  const games = r.w + r.l + r.t;
  return games ? (r.w + r.t / 2) / games : null;
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
        // ESPN's own id, carried through so the row can link to the man rather
        // than to a name lookup. Both season.js and demo-rosters.js supply it,
        // and this is the only reason it survives the reduction. `?? null` is
        // for a roster entry that arrives without one — that row renders
        // unlinked rather than pointing at `?player=undefined`.
        playerId: p.playerId ?? null,
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
 *
 * `benched` and `started` are the roster player objects as they came from
 * season.js, not reduced copies, which is what keeps their `playerId` available
 * to the renderer. Do not narrow them to { name, actual } — the two names in
 * this cell are links, and they would lose their target.
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

/**
 * The week the bench panel reads: `week` itself once any of its games is
 * final, otherwise the latest earlier week with a final score. Bench points
 * are exact facts that only exist once a week is decided, so on a Thursday the
 * useful answer is last week's, not "has not finished" for five days. Falls
 * back to `week` when nothing at all is final, which is week 1's honest state.
 */
export function benchWeekFor(schedule, week) {
  const final = (w) => (schedule.byWeek.get(w) || []).some((g) => g.played);
  if (final(week)) return week;
  const earlier = schedule.weeks.filter((w) => w < week && final(w));
  return earlier.length ? earlier[earlier.length - 1] : week;
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
  state.benchWeek = benchWeekFor(schedule, week);
  state.benchRosters =
    state.benchWeek === week ? null : generateDemoWeekRosters(state.benchWeek);
  startOdds();   // clears any live odds: demo games are all final

  setStatus(
    (note ? `${note} ` : '') +
    'Showing generated sample data — invented teams, invented players, not your league.'
  );
  draw();
}

/** One live load at a time: boot and the connection bar can both ask. */
let liveLoading = false;

async function loadLive() {
  const cfg = savedConfig();
  if (!cfg) {
    loadDemo('No league connected yet — use the strip above.');
    return;
  }
  if (liveLoading) return;
  liveLoading = true;
  try {
    await loadLiveNow(cfg);
  } finally {
    liveLoading = false;
  }
}

async function loadLiveNow(cfg) {
  setToggle('live');
  espn.configure({ leagueId: cfg.leagueId, season: cfg.season });
  if (cfg.teamId != null) state.teamId = cfg.teamId;

  setStatus('Loading your league from ESPN…');
  try {
    const schedule = await season.fetchSchedule();
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
    // A new schedule is a new league as far as the odds are concerned.
    state.odds = null;
    state.oddsTeams = new Map();
    state.rosters = await loadRosters(week);
    const odds = startOdds();
    await loadBench();
    await paintWhenOdds(odds);
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
    return await season.fetchWeekRosters(week);
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

/**
 * The bench panel's week and, when it differs from the selected week, its
 * rosters — one more request, made only on the days it is needed.
 */
async function loadBench() {
  const bw = benchWeekFor(state.schedule, state.week);
  state.benchWeek = bw;
  if (bw === state.week) state.benchRosters = null;
  else if (state.isDemo) state.benchRosters = generateDemoWeekRosters(bw);
  else state.benchRosters = await loadRosters(bw);
}

async function changeWeek(week) {
  state.week = week;
  state.rosters = state.isDemo ? generateDemoWeekRosters(week) : await loadRosters(week);
  const odds = startOdds();
  await loadBench();
  await paintWhenOdds(odds);
}

// ------------------------------------------------------------ the win chance

/**
 * How long the first paint waits for the win chance. Long enough that on the
 * usual visit — the played weeks already shared from another page's read in
 * the last minute, or coming down from the synced copy in one go — the cards
 * arrive with their percentages and nothing jumps; short enough that a slow
 * ESPN never holds the matchups back. Past it the cards are drawn without the
 * percentage ("working out…") and it is filled in when it lands.
 */
const ODDS_GRACE_MS = 400;

/** Every roster week asked for, in one call where season.js has one. */
async function readWeeks(weeks) {
  if (typeof season.fetchWeeksRosters === 'function') {
    return (await season.fetchWeeksRosters(weeks)) || new Map();
  }
  const out = new Map();
  for (const w of weeks) {
    const r = await loadRosters(w);
    if (r?.teams?.length) out.set(w, r.teams);
  }
  return out;
}

/**
 * The Schedule page's odds for `week`, reading only the roster weeks this page
 * does not already hold. See `capture.oddsWeeks` for which weeks, and why.
 */
async function loadOdds(week) {
  const data = capture.normalizeSchedule(state.schedule, { isDemo: false });
  const have = state.oddsTeams;
  const r = state.rosters;
  if (r && Number(r.week) === week && r.teams?.length) have.set(week, r.teams);

  // THE FLOOR, read exactly as Schedule reads it: one wire read for the first
  // week still being projected (`capture.floorWeek`), whatever week is on
  // screen here. Started alongside the rosters so it adds no round trip; a
  // failure is no floor, never an error. Without it Home quoted the unfloored
  // chance beside Schedule's floored one (AUDIT §1.3).
  const floorWeek = capture.floorWeek(data);
  const floorRead = readFloors(floorWeek);

  const missing = capture.oddsWeeks(data, week).filter((w) => !have.has(w));
  if (missing.length) {
    for (const [w, teams] of await readWeeks(missing)) {
      if (teams?.length) have.set(Number(w), teams);
    }
  }
  const floors = await floorRead;
  const odds = capture.matchupOdds(data, have, { floors });
  return { ...odds, floorWeek };
}

/** The positional floor for `week`, or null — never throws. */
async function readFloors(week) {
  try {
    if (typeof season.fetchFloors !== 'function' || !week) return null;
    const f = await season.fetchFloors(week);
    return f && f.size ? f : null;
  } catch {
    return null;
  }
}

/**
 * Start working out the odds for the week on screen. Resolves when they are
 * in `state` (or have failed, which leaves the cards without a percentage —
 * the same as Schedule when ESPN refuses the rosters). Never rejects.
 */
function startOdds() {
  const token = ++state.oddsToken;
  if (state.isDemo || !state.schedule) {
    // Every demo game is final, so there is no chance to quote.
    state.odds = null;
    state.oddsPending = false;
    return Promise.resolve();
  }
  state.oddsPending = true;
  const week = state.week;
  return loadOdds(week).then(
    (odds) => {
      if (token !== state.oddsToken) return;
      state.odds = odds;
      state.oddsPending = false;
    },
    () => {
      if (token !== state.oddsToken) return;
      state.oddsPending = false;
    }
  );
}

/** Paint now if the odds come within the grace period; otherwise paint, then again when they do. */
async function paintWhenOdds(odds) {
  const token = state.oddsToken;
  let settled = false;
  const done = odds.then(() => { settled = true; });
  await Promise.race([done, new Promise((r) => setTimeout(r, ODDS_GRACE_MS))]);
  if (!state.isDemo) reportLive();
  draw();
  if (settled) return;
  await done;
  if (token === state.oddsToken && !state.isDemo) draw();
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
    benchWeek: state.benchWeek ?? state.week,
    benchRosters: state.benchRosters,
    odds: state.isDemo ? null : state.odds,
    oddsPending: !state.isDemo && state.oddsPending,
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

/**
 * How many finished weeks the standings need before the scale will paint them.
 *
 * THIS IS NOT A NEW JUDGEMENT — it is the threshold the panel has always
 * published in its own note ("far too thin to rank anyone by ... until about
 * week 4"), now used rather than merely said. HANDOFF rule 5: a page that has
 * decided it cannot yet rank anyone must not then rank them in colour. Two
 * weeks of points-for is one good game and one bad one, and a full-colour ▲ on
 * it is a confident verdict on a coin toss.
 */
const MIN_WEEKS_TO_RANK = 4;

/**
 * The key line under a coloured table — channel four, and the one that makes a
 * colour checkable rather than decorative.
 *
 * IT IS SPLIT IN TWO, exactly as the Stats page splits it, and the split is the
 * house style rather than a preference: the SHORT line is visible because it
 * changes what a number means (which end is good, and that one column is turned
 * over), while `describeHeat`'s full sentence — the thresholds in points, which
 * is what lets a cell be checked by hand — goes inside "How this works" with
 * the rest of the method. HANDOFF: put new explanation behind the toggle, and
 * keep visible only what changes what a number means. Putting the whole of
 * `describeHeat` on screen added about ninety words to every panel here, which
 * is the prose creep `tests/text-audit.mjs` exists to measure.
 *
 * A panel whose scale refused to draw says so on the visible line instead,
 * because "nothing is coloured" and "the colours failed to appear" are
 * different facts and look identical.
 */
function setKey(id, html) {
  const el = $(id);
  if (!el) return;
  el.innerHTML = html || '';
  if (html) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

/** Show or hide the "How this works" toggle a note sits in. An empty panel has
 *  nothing to explain, so it offers no toggle. */
function tuck(noteId, on) {
  const box = $(noteId) && $(noteId).closest('details');
  if (!box) return;
  if (on) box.removeAttribute('hidden');
  else box.setAttribute('hidden', '');
}

/**
 * THE CARDS TAKE NO RED/GREEN SCALE, and this is the reason rather than an
 * oversight (2026-09-19).
 *
 * Ten projections for one week ARE a comparison group — it is the same shape as
 * the Stats page's week grid, which is coloured. What stops it is which ten
 * numbers these are: `Proj` on a card is each side's lineup **as set**, and the
 * card's own verdict — the favourite, the margin and the win chance — is
 * deliberately built on the **best legal lineup** instead (`capture.matchupOdds`
 * — see the note in buildModel). Those two disagree all week, because half the
 * league has not opened ESPN since Tuesday: a squad with its bye-week kicker
 * still in the lineup projects low for a reason that is about logging in, not
 * about the roster. Painting that column would rank the league on a measure the
 * card itself refuses to trust, and it could hand a full-colour ▲ to the side
 * the same card says is going to lose.
 *
 * "Roster strength", directly below, IS that comparison done honestly — one
 * number per squad, on one basis, for all ten — and it carries the scale.
 *
 * The win chance is not scaled either, for a different reason: a card prints
 * ONE percentage for a GAME (the favourite's, or yours), so five cards are five
 * numbers about five fixtures rather than ten numbers about ten squads — and a
 * favourite's chance is bounded below at 50% by construction, so a scale over
 * them would paint "this game is a mismatch" in the colours this site uses for
 * "this team is good".
 */
function renderMatchups(m) {
  $('matchupsTitle').textContent = `Week ${m.week} of ${m.weeks.length}`;

  if (!m.games.length) {
    $('matchups').innerHTML = '<div class="empty">No matchups scheduled for this week.</div>';
    $('matchupsNote').textContent = '';
    tuck('matchupsExplain', false);
    return;
  }

  $('matchups').innerHTML =
    `<div class="games">${m.games.map((g) => gameCard(g, m.teamId)).join('')}</div>`;

  const withChance = m.games.some((g) => g.homeWinPct !== null);
  if (!m.playedThisWeek) {
    $('matchupsNote').innerHTML = withChance
      ? 'Nothing has kicked off. <strong>Proj</strong> is each lineup as set.'
      : m.games.some((g) => g.projectedMargin !== null)
        ? 'Nothing has kicked off. <strong>Proj</strong> is each starting lineup&rsquo;s projection for this week, summed; whoever projects higher is the favourite.'
        : 'Nothing has kicked off, and ESPN has published no projections for this week yet.';
  } else {
    $('matchupsNote').innerHTML =
      `${plural(m.playedThisWeek, 'game')} final of ${m.games.length}. ` +
      '<strong>Proj</strong> is what the starting lineup was projected to score, <strong>Pts</strong> what it did.';
  }
  // The basis of the percentages, in the words rule 1 asks for: they are
  // ours, built from ESPN's projections, not quoted — and they are the
  // Schedule page's, on the best lineups rather than the ones set.
  if (withChance) {
    $('matchupsNote').innerHTML +=
      ' The win chance compares each side&rsquo;s <strong>best</strong> lineup, as the ' +
      'Schedule page does &mdash; our model, not ESPN&rsquo;s.';
    $('matchupsExplain').innerHTML = oddsExplain(m.spread, m.floorSaid);
  } else {
    $('matchupsExplain').textContent = '';
  }
  tuck('matchupsExplain', withChance);
}

/** The method behind the percentages, including where the spread came from. */
function oddsExplain(spread, floorSaid = '') {
  const sigma = spread?.sigma ?? DEFAULT_SIGMA;
  const sample = spread?.sample ?? 0;
  const spreadText = spread?.calibrated
    ? `a per-team scoring spread of ${fmt(sigma)} points, measured from ` +
      `${plural(sample, 'completed team-week')} in this league (each score set against ` +
      'the projection of the lineup that team actually started)'
    : `a per-team scoring spread of ${fmt(sigma, 0)} points &mdash; assumed, a general figure ` +
      'and not one measured on this league, because ' +
      (sample
        ? `only ${plural(sample, 'completed team-week')} carries`
        : 'no completed game here carries') +
      ` a projection to measure it from (${MIN_GAMES_TO_CALIBRATE} are needed)`;
  return (
    'Each win chance compares the <strong>best legal lineup</strong> each team could ' +
    'field this week, on ESPN&rsquo;s projections &mdash; a bench player projected above ' +
    'a starter counts as starting &mdash; so the margin under a card can differ from the ' +
    `two <strong>Proj</strong> figures, which are the lineups as set. The gap is read against ${spreadText}. ` +
    'The Schedule page works its percentages out the same way from the same numbers, so ' +
    'the two pages agree. A game already under way gets none. ESPN publishes ' +
    'projections, never odds.' +
    (floorSaid ? ` ${floorSaid}` : '')
  );
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
  } else if (isNum(g.homeWinPct)) {
    // Schedule's wording: the favourite on the best lineups, and his chance.
    // The margin and the percentage are one statement, so they agree.
    const p = g.homeWinPct;
    const lead = g.favourite
      ? `Best lineups: ${esc(g.favourite === 'home' ? g.homeName : g.awayName)} by ${fmt(g.projectedMargin)}`
      : 'Best lineups: level';
    meta = isNum(g.myWinPct)
      ? `${lead} · <strong>your win chance ${pctText(g.myWinPct)}</strong>`
      : `${lead} · ${pctText(Math.max(p, 1 - p))}`;
  } else if (g.favourite) {
    const fav = g.favourite === 'home' ? g.homeName : g.awayName;
    meta = `Projected: ${esc(fav)} by ${fmt(g.projectedMargin)}`;
    if (g.oddsPending && g.mine) meta += ' · <span class="muted">win chance: working out…</span>';
  } else {
    meta = 'Upcoming · no projection yet';
  }

  // The unrounded chance rides on the card, so a suite can hold it to the
  // Schedule page's figure more finely than the whole percent printed.
  const exact = isNum(g.homeWinPct) ? ` data-home-win="${g.homeWinPct}"` : '';
  return `<div class="game${g.played ? '' : ' upcoming'}${g.mine ? ' mine' : ''}"${exact}>
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
    setKey('strengthKey', '');
    tuck('strengthNote', false);
    return;
  }

  // THE SCALE, on the one column this panel has. Comparison group: every
  // squad's points in a typical week, which is the same number computed the
  // same way for all ten — the textbook case for js/heat.js and the reason
  // this panel was the easiest of the four here to decide.
  //
  // NOT INVERTED: more points a week is better, with nothing to argue about.
  //
  // It does NOT make the bars redundant and it is not a second drawing of
  // them. The bars are scaled from the WEAKEST roster to the strongest, so bar
  // length answers "how far apart are first and last"; the tint is measured in
  // standard deviations from the mean, so it answers "is this squad unusual".
  // A league where nine squads are level and one is miles clear draws nine
  // near-full bars and nine uncoloured cells with one ▲ — which is the true
  // shape, and neither channel shows it alone.
  const strengthHeat = heatScale(rows.map((r) => r.value));

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
        const h = heatOf(r.value, strengthHeat, { what: 'a starting lineup in this league' });
        // ONE `title` PER ROW, not two. The row already carried a sentence —
        // where the per-week figure came from — and a second `title` on the
        // value span would give a phone two sheets to open from one tap
        // (js/touch-titles.js walks up to the nearest titled element). So the
        // scale's words are appended to the sentence that is already there,
        // and the row keeps carrying ESPN's published season total either way.
        const words = [
          r.seasonTotal === null
            ? ''
            : `${r.name} projects ${r.value.toFixed(1)} points in a typical week — ` +
              `ESPN's season-long projection for this lineup, ${r.seasonTotal.toFixed(0)} points, ` +
              `over ${SEASON_GAMES} games.`,
          h ? h.words : '',
        ].filter(Boolean).join(' ');
        const says = words ? ` title="${esc(words)}"` : '';
        // The tint sits on the value, never on the whole row: the row is a name
        // and a bar as well as a number, and only the number is the thing being
        // compared.
        //
        // AND IT SITS ON AN ELEMENT INSIDE `.vv`, NOT ON `.vv` ITSELF — that is
        // a specificity fix, not decoration. This page's own stylesheet has
        // `.rank .vv { font-weight: 600 }`, which is two classes and therefore
        // beats the scale's single-class `font-weight` outright. Put the step
        // on `.vv` and the TINT would show while the WEIGHT silently did not,
        // which is the scale losing one of its two hue-free channels without
        // anything looking broken. Nothing in this page's CSS selects an
        // element inside `.vv`, so the step lands there intact — and the fix
        // needs no change to css/app.css, which another agent owns.
        const num = h
          ? `<span class="${h.cls}">${r.value.toFixed(1)}</span>${heatMarkHtml(h)}`
          : r.value.toFixed(1);
        return `<li${r.id === m.teamId ? ' class="me"' : ''}${says}>
            <span class="rk">${r.rank}</span>
            <span class="nm">${esc(r.name)}</span>
            <span class="bar"><i style="width:${width.toFixed(1)}%"></i></span>
            <span class="vv">${num}</span>
          </li>`;
      })
      .join('') +
    '</ol>';

  // ONE LINE, NOT FOUR (2026-09-19). What it has to carry is the comparison
  // group and the two hue-free channels; "in four steps", "full colour is one
  // SD out" and "tap a row" are all method, and the toggle below already says
  // every one of them. The long version measured 45 words here against a panel
  // that showed 51 in total before the scale landed — `node
  // tests/text-audit.mjs index.html` is the meter.
  setKey('strengthKey', strengthHeat
    ? '<strong>Green beats the other nine lineups, red trails.</strong> ' +
      'Ends carry ▲▼ and bold.'
    : '<strong>Nothing is shaded</strong>: the ten lineups are inside a tenth of a point ' +
      'of each other.');

  tuck('strengthNote', true);
  $('strengthNote').innerHTML =
    // The thresholds, in points, so a shaded row can be checked by hand rather
    // than believed — tucked, because it is method rather than meaning.
    (strengthHeat
      ? `<strong>The colours.</strong> ${describeHeat(strengthHeat, {
        what: 'the other nine starting lineups',
        high: 'a stronger squad', low: 'a weaker one',
      })} Tap or hover a row for exactly where it stands. `
      : '') +
    `<strong>Points in a typical week</strong>: ESPN&rsquo;s season-long projection for each ` +
    `team&rsquo;s <em>current</em> starting lineup, divided by the ${SEASON_GAMES} games of an ` +
    'NFL season. The season totals themselves are four figures, which nobody has a feel for; ' +
    'a lineup is read in the hundred-and-something a week ESPN prints under it. Dividing every ' +
    'team by the same number changes no rank and no bar. ' +
    'It needs no completed games, which makes it the only honest answer to ' +
    '&ldquo;who is good&rdquo; this early. Bar length shows the gap between first and last ' +
    `(${(max - min).toFixed(1)} points a week), not the totals. ` +
    '<strong>This is the lineup as it is set, averaged flat</strong> — it cannot see a bye week ' +
    'or a squad whose depth never starts, so it will not match the ' +
    '<a href="analysis.html">Analysis</a> page&rsquo;s <strong>Proj avg</strong>, which is built ' +
    'from the best legal lineup in every individual week.';
}

function renderStandings(m) {
  if (!m.weeksCounted) {
    $('standings').innerHTML =
      '<div class="empty">Nothing has been played yet. Standings appear once the first week is final.</div>';
    $('standingsNote').textContent = '';
    $('standingsScale').textContent = '';
    tuck('standingsScale', false);
    return;
  }

  // THREE SCALES, ONE PER COLUMN, and one of them is turned over.
  //
  //   PF   — points for. High is good.
  //   PA   — points against. INVERTED: the league scoring 900 points AT you is
  //          the schedule-luck mistake in its plainest form, and it is exactly
  //          the column the Stats page's old local ramp used to paint its
  //          greenest for being worst. Low is good.
  //   Diff — PF minus PA. High is good. It is not a rescaling of either of the
  //          other two, so it says something neither of them does.
  //
  // W–L IS NOT COLOURED. Its data-v is a compound sort key (win percentage
  // times a million, plus points for), which is a number built to order rows
  // and not a quantity anybody should be measured in standard deviations of —
  // and the record is already the thing the table is sorted by.
  //
  // AND NONE OF IT PAINTS BEFORE WEEK 4. See MIN_WEEKS_TO_RANK: this panel has
  // always said in words that two weeks is too thin to rank anyone by, and a
  // scale that ignored its own note would be the page contradicting itself in
  // colour. Until then the numbers are shown, uncoloured, and the key says why.
  const ranked = m.weeksCounted >= MIN_WEEKS_TO_RANK;
  const heatPf = ranked ? heatScale(m.standings.map((r) => r.pf)) : null;
  const heatPa = ranked ? heatScale(m.standings.map((r) => r.pa), { invert: true }) : null;
  const heatDiff = ranked ? heatScale(m.standings.map((r) => r.diff)) : null;

  const rows = m.standings
    .map((r) => {
      const record = r.t ? `${r.w}-${r.l}-${r.t}` : `${r.w}-${r.l}`;
      const diffCls = r.diff > 0 ? 'pos' : r.diff < 0 ? 'neg' : 'muted';
      return `<tr${r.id === m.teamId ? ' class="me"' : ''}>
          <td class="name">${esc(r.name)}</td>
          <td data-v="${(r.pct ?? 0) * 1e6 + r.pf}">${record}</td>
          ${numCell(r.pf, { scale: heatPf, what: 'what the rest of the league has scored' })}
          ${numCell(r.pa, { scale: heatPa, what: 'what the rest of the league has conceded' })}
          ${numCell(r.diff, {
    sign: true, cls: diffCls, scale: heatDiff,
    what: 'the rest of the league’s points difference',
  })}
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

  // The key line, and it has to carry two different messages: before week 4 it
  // explains an ABSENCE of colour, which a reader would otherwise read as the
  // feature being broken.
  $('standingsNote').innerHTML =
    `Through week ${m.week}: ${plural(m.weeksCounted, 'week')} played, ` +
    `so ${plural(m.weeksCounted, 'game')} per team. ` +
    (!ranked
      ? '<strong>Far too thin to rank anyone by</strong> — roster strength is the better guide ' +
        `until about week ${MIN_WEEKS_TO_RANK}, and nothing here is shaded red or green until ` +
        'then for the same reason.'
      : 'Ordered as ESPN orders them: win percentage, a tie counting half a win, then points for. ' +
        // THE INVERTED COLUMN STAYS ON SCREEN. Everything else about the scale
        // moved into the toggle below, but "PA turned over" is not method — it
        // changes what a colour MEANS, and a reader who misses it reads the
        // team conceding fewest as the team conceding most. "W–L is left plain"
        // went with the method: an absent colour misleads nobody.
        (heatPf
          ? '<strong>Green good, red bad</strong>, down each column — <strong>PA</strong> ' +
            'turned over, so green concedes <em>fewer</em>. Ends carry ▲▼ and bold.'
          : 'Nothing is shaded: the ten totals are inside a tenth of a point of each other.'));

  // The thresholds in points, tucked with the method: visible above is what
  // changes what a number MEANS, and this is what lets a cell be checked.
  $('standingsScale').innerHTML = heatPf
    ? `<strong>PF:</strong> ${describeHeat(heatPf, {
      what: 'what the other nine teams have scored',
      high: 'scoring more', low: 'scoring less',
    })} <strong>PA</strong> is the same scale inverted, so its green end is the LOW one, and ` +
      '<strong>Diff</strong> is measured on its own spread rather than on either of theirs. ' +
      '<strong>W&ndash;L</strong> is left plain: what it sorts on is a compound key (win ' +
      'percentage, then points for), which is a number built to order rows rather than a ' +
      'quantity anybody should be measured in standard deviations of.'
    : '';
  tuck('standingsScale', Boolean(heatPf));
}

/**
 * THE INJURY REPORT'S `Proj` COLUMN TAKES NO SCALE, and refusing it is the
 * clearest illustration on this page of the one rule js/heat.js enforces by the
 * shape of its own API.
 *
 * The column is a quarterback's 22.4 above a kicker's 7.9 above a defence's
 * 6.2, because it is a list of whoever happens to be hurt this week. That is
 * not a comparison group, it is three different units printed in the same font,
 * and a scale over it would paint every injured kicker on the site red for
 * being a kicker. There is no honest version of it either: ten squads do not
 * each have an injured tight end to measure against each other, and "this WR is
 * 1.2 SD below the other injured WRs" is a sentence about a sample of two.
 *
 * The one thing that WOULD be a group here — every starter at a position across
 * the league — is not on this panel at all, and it lives on the Analysis page,
 * which already colours it.
 */
function renderInjuries(m) {
  if (!m.injuries.length) {
    $('injuries').innerHTML = `<div class="empty">${
      m.hasRosters
        ? 'Every starter in the league is listed active.'
        : 'Rosters for this week are unavailable, so injuries cannot be checked.'
    }</div>`;
    $('injuryNote').textContent = '';
    tuck('injuryNote', false);
    return;
  }

  // Two references per row, both to the same man: his name, and the projection
  // that is his. The fantasy team column is a manager, not a player, so it is
  // left as plain text.
  const rows = m.injuries
    .map(
      (p) => `<tr${p.teamId === m.teamId ? ' class="me"' : ''}>
          <td class="name">${pref(p.playerId, p.name, `${esc(p.name)} <span class="muted">${esc(p.position)}</span>`)}</td>
          <td class="left" data-v="${p.rank}"><span class="badge ${injuryClass(p.status)}">${esc(injuryLabel(p.status))}</span></td>
          <td class="left">${esc(p.teamName)}</td>
          <td>${esc(p.slot)}</td>
          ${numCell(p.projected, { wrap: (t) => pref(p.playerId, p.name, t) })}
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
  tuck('injuryNote', true);
  $('injuryNote').textContent =
    `${plural(m.injuries.length, 'starter')} across the league ` +
    `${m.injuries.length === 1 ? 'carries' : 'carry'} a designation` +
    `${out ? `, ${out} of them ruled out` : ''}. Bench players are left out on purpose — ` +
    'these are players someone is currently planning to start. ' +
    'Every name and projection here links to that player on the Players page, ' +
    'where his next 13 weeks are.';
}

function renderBench(m) {
  // Visible, not tucked: it changes which week every number here is about.
  const earlier = m.benchWeek !== m.week;
  const key = $('benchKey');
  if (key) {
    key.textContent = earlier
      ? `Week ${m.benchWeek}, the latest final week — week ${m.week} is not final yet.`
      : '';
    if (earlier) key.removeAttribute('hidden');
    else key.setAttribute('hidden', '');
  }

  if (!m.bench.length) {
    let why;
    if (earlier && m.benchRostersMissing) {
      why = `Rosters for week ${m.benchWeek} could not be read, so its bench points are unavailable.`;
    } else if (earlier || m.playedThisWeek) {
      why = `No final bench scores for week ${m.benchWeek}.`;
    } else {
      why = `Week ${m.week} has not finished. Bench points are exact facts, so they wait for final scores.`;
    }
    $('bench').innerHTML = `<div class="empty">${why}</div>`;
    $('benchNote').textContent = '';
    setKey('benchScaleKey', '');
    tuck('benchNote', false);
    return;
  }

  // ONE OF THE THREE COLUMNS IS SCALED, AND THE OTHER TWO ARE REFUSED.
  //
  // STARTED — every squad's actual points in one week. This is the same
  //   comparison group the Stats page's week grid is built on, one week wide,
  //   and it is the only thing on this panel that ever says whether 118 was a
  //   good week or a poor one. High is good. Gated on the whole week being
  //   final (see `benchWeekComplete`): four squads are not a league.
  //
  // BENCH — refused. js/heat.js's own docstring names "a bench points-left-on
  //   figure" as an inverted column, and this is NOT quite that number: it is
  //   what the bench scored, which moves with roster depth and with who happens
  //   to be on bye at least as much as with any decision the manager made. A
  //   manager holding two starting-calibre handcuffs banks a big bench every
  //   week and has done nothing wrong; a manager whose bench is all on bye
  //   banks nothing and has not done anything right. Neither direction is
  //   reliably good, so js/heat.js's rule is no scale rather than a misleading
  //   one — and the caveat it would need in the key is itself the proof.
  //
  // COST — refused, for an arithmetic reason rather than a judgemental one. The
  //   best possible value in that column is "no miss at all", which the table
  //   prints as a dash and not as 0.0. A scale built from the rows that DO
  //   carry a miss would therefore call the median mistake normal and leave
  //   every manager who made none uncoloured — the good end of the column
  //   painted as nothing at all. Rendering those as a green 0.0 instead would
  //   fix the scale by changing what the table says, which is the wrong way
  //   round.
  const heatStarted = m.benchWeekComplete
    ? heatScale(m.bench.map((r) => r.started))
    : null;

  // The two men in a miss are the only players named in this panel — the Team
  // column is a manager, and Started/Bench/Cost are team-level or two-player
  // quantities, so none of those is a reference to anybody. Name and score go
  // inside one link each, because the score is that player's just as much as
  // his name is.
  const who = (p) =>
    pref(p.playerId, p.name, `${esc(p.name)} <span class="muted">(${fmt(p.actual)})</span>`);

  const rows = m.bench
    .map((r) => {
      const miss = r.miss
        ? `${who(r.miss.benched)} over ${who(r.miss.started)}`
        : '<span class="muted">started the right nine</span>';
      return `<tr${r.id === m.teamId ? ' class="me"' : ''}>
          <td class="name">${esc(r.name)}</td>
          ${numCell(r.started, {
    scale: heatStarted, what: `what the league scored in week ${m.benchWeek}`,
  })}
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

  // WHICH column is shaded stays visible — a reader comparing two shaded
  // numbers has to know the other three columns were never measured. WHY Bench
  // and Cost are not is method, and the note below already gives both reasons
  // at length, so it no longer says it twice.
  setKey('benchScaleKey', heatStarted
    ? `Only <strong>Started</strong> is shaded: green beat the league in week ` +
      `${m.benchWeek}, red fell short. Ends carry ▲▼ and bold.`
    : m.bench.length
      ? `<strong>Started is not shaded</strong>: week ${m.benchWeek} is not final for every ` +
        'squad, and an average taken from the ones that have finished is not the league.'
      : '');

  const total = round1(m.bench.reduce((a, r) => a + r.bench, 0));
  const missed = m.bench.filter((r) => r.miss).length;
  tuck('benchNote', true);
  $('benchNote').innerHTML =
    // The thresholds, and why the other two columns get nothing. Tucked with
    // the method, the same split the Stats page uses.
    (heatStarted
      ? `<strong>The colours.</strong> ${describeHeat(heatStarted, {
        what: 'what the other nine squads started with that week',
        high: 'a big week', low: 'a poor one',
      })} <strong>Bench</strong> is not shaded because a big bench is depth, and byes, as ` +
        'often as it is a mistake — neither direction is reliably good. <strong>Cost</strong> ' +
        'is not shaded because its best possible value is “no miss at all”, which this table ' +
        'prints as a dash rather than as 0.0, so the good end of the column is not a number in ' +
        'it. '
      : '') +
    `${fmt(total)} points sat on benches in week ${m.benchWeek}. A <em>miss</em> counts only ` +
    'when the benched player was eligible for the slot he would have taken, so a receiver ' +
    `out-scoring a kicker is not one. ${plural(missed, 'team')} left points behind. ` +
    'Both men in a miss link to their next 13 weeks on the Players page.';
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
//
// Going live needs no saved preference — only the absence of an explicit
// "Demo data" click (see `state.source`). That is what makes a fresh phone
// show the league its bar says is connected.
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
