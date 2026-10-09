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
import { INJURY_RANK, healthy, injuryLabel, injuryClass } from './injury.js';
// THE ONE RED/GREEN SCALE (HANDOFF rule 14, Tim 2026-09-19: "it needs to be
// added to all the other places a number is referred to across the whole
// site"). What it is put on here, and what it is deliberately NOT put on, is
// argued at each call site below — the decisions are the feature, not the
// import. Nothing here invents a comparison group: every scale on this page is
// one column of the same kind of number, across the same ten squads, in the
// same week.
import { heatScale, heatOf, heatStanding, heatMarkHtml, describeHeat, ordinal } from './heat.js';
// THE PREVIEWS (Tim, 2026-10-08: "a bad preview is any player reference in the
// home section"). A player's name opens the classic player card, built from the
// weeks this page already holds; a number opens a stat card of the parts it is
// made of; a click on either follows its connector (js/links.js).
import { statCard, registerPop, clearPops, wirePops, teamWeekSpec, POP_ATTR, POP_GO_ATTR } from './pop.js';
import {
  playerCardFromWeeks, registerRun, tipAttr, wireTips, clearRuns, reopenTip, setValueSource,
  zeroKind, byeWeekOf,
} from './player-card.js';
import { teamHref, playerHref, weekHref, statsHref } from './links.js';
// The positional floor's one sentence, so Home states it in the same words as
// Analysis and Trade. See js/floor.js.
import { describeFloors } from './floor.js';
// "Start A over B" on your own card: the swaps, their points and their share of
// the win chance are worked out in js/start-sit.js, which is pure.
import { startSit, hasPlayed } from './start-sit.js';
// "O. Hampton": the site's one short form of a player's name.
import { shortName } from './actual-season-table.js';

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
  // When waivers next clear (epoch ms) — the earliest date on the wire the
  // floor is read from — or null. `waiverRead` is the one read per league.
  waiverClears: null,
  waiverRead: null,
  // NFL kickoffs, `{ [proTeamId]: { [week]: epochMs } }`, or null until a swap
  // is on offer and they are needed to say who is locked. See readKickoffs().
  kickoffs: null,
  // Every NFL team's bye week, `{ [proTeamId]: week }`, or null: what tells a
  // bye's 0.00 from a ruled-out man's on the player cards. See readByes().
  byes: null,
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
 * Players page, so the matchup cards, the strength bars and the bench table's
 * Team column stay plain text.
 *
 * EVERY ONE OPENS THE CLASSIC PLAYER CARD (Tim, 2026-10-08) — his name, ESPN's
 * Avg · Proj · rank, and the Week / Proj / Act chart — built by
 * `playerCardFromWeeks` from the weeks this page already holds (`cur.held`):
 * the played weeks the win chance read, the week on screen and the bench
 * panel's. A week the page does not hold is drawn as waiting; nothing is read
 * for a card (rule 20). The link carries no `title`: one preview per reference.
 * A man with no id still gets the card, on a plain focusable span.
 *
 * @param {Object} p      the roster entry (`playerId`, `name`, `position`, …)
 * @param {string} inner  already-escaped HTML to sit inside the link
 * @param {Object} [o]
 * @param {boolean} [o.card=true] false for a number whose own cell opens a
 *        stat card instead — the link is then only the way to his row.
 */
function pref(p, inner, { card = true } = {}) {
  const id = p ? p.playerId : null;
  const none = id === null || id === undefined;
  let tip = '';
  if (card && cur) {
    const made = playerCardFromWeeks(cur.held, p, {
      weeks: cur.weeks,
      currentWeek: cur.currentWeek,
      byes: cur.byes,
      demo: cur.isDemo,
      id: `home:${none ? p.name : id}`,
    });
    // ESPN's word for a healthy man is "ACTIVE", which is no designation at
    // all: the card's top line names him and stops.
    made.ident = made.ident.replace(/ · ACTIVE$/, '');
    tip = tipAttr(registerRun(made, 'home'));
  }
  if (none) return tip ? `<span class="pref"${tip} tabindex="0">${inner}</span>` : inner;
  // Where the link goes, said as an `aria-label` — the `title` that used to
  // say it would be a second tooltip on top of the card.
  return (
    `<a class="pref" href="${esc(playerHref(id))}"${tip}` +
    ` aria-label="${esc(p.name)} — open his next 13 weeks on the Players page">${inner}</a>`
  );
}

/**
 * The page being painted — set by `render`, read by the helpers that hang a
 * card on something (`pref`, the spec builders below). The model is the only
 * thing they read, so a suite that renders a model of its own gets cards built
 * from that model and nothing else.
 */
let cur = null;

// ---------------------------------------------------------------- his Value
//
// Tim, 2026-10-09: "I want it to be displayed at the top of the player's
// preview." Every player card on this page is made by `playerCardFromWeeks`,
// which carries his `playerId`; this hands js/player-card.js the place to look
// his Value up when a card opens (js/season.js `fetchPlayerValues`). Nothing
// waits on it: the page paints first, and a card opened before the answer is
// in — or when there is none — is the card as it always was.
let valueFor = null;   // the league (or the sample) the cards' Values belong to

function wireValue(demo) {
  if (typeof season.fetchPlayerValues !== 'function') return;
  const { leagueId, season: year } = demo ? {} : espn.getConfig();
  const key = demo ? 'demo' : `${leagueId}::${year}`;
  // Another league's numbers are never shown against this one's men.
  if (key !== valueFor) setValueSource(null);
  valueFor = key;
  let asked;
  try { asked = season.fetchPlayerValues({ demo: Boolean(demo) }); } catch { return; }
  Promise.resolve(asked).then((v) => {
    if (valueFor === key && v && typeof v.lookup === 'function') setValueSource(v.lookup);
  }).catch(() => {});
}

/** A stat card's attribute for this page, or '' when there is no spec. */
const pop = (spec, focusable = true) => (spec ? statCard(spec, { prefix: 'home', focusable }) : '');

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
 * of the number at the end of the scale, and the cell's card (`card`, below)
 * says where the number stands in plain words. The fourth
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
  { digits = 1, sign = false, cls = '', wrap = null, scale = null, card = null } = {}
) {
  if (!isNum(n)) return `<td${cls ? ` class="${cls}"` : ''}>${dash}</td>`;
  const text = (sign && n > 0 ? '+' : '') + n.toFixed(digits);
  const h = scale ? heatOf(n, scale) : null;
  const klass = [cls, h ? h.cls : ''].filter(Boolean).join(' ');
  // WHERE THE NUMBER STANDS IS THE CARD'S JOB NOW, not a `title`'s (Tim,
  // 2026-10-08): `card(h)` returns the stat card's attribute, with the cell's
  // standing in plain words on it. The cell carries no `title` beside it.
  return (
    `<td${klass ? ` class="${klass}"` : ''} data-v="${n}"${card ? card(h) : ''}>` +
    `${wrap ? wrap(text, h) : text}${h ? heatMarkHtml(h) : ''}</td>`
  );
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * What a man was PROJECTED for the week his roster entry is from, or null.
 *
 * A man whose NFL game is over in a week still being played carries his SCORE
 * in `projected` and the projection he started with in `pregame` (js/season.js);
 * everybody else, and every week ESPN has decided, carries it in `projected`.
 */
const projOf = (p) => (p.done === true
  ? (isNum(p.pregame) ? p.pregame : null)
  : isNum(p.projected) ? p.projected : null);

/**
 * ESPN's own box score for one game — who scored what, which this site does
 * not rebuild (Tim, 2026-10-08: "Link to ESPN").
 *
 * LOCAL TO THIS PAGE on purpose: the Schedule page is getting the same link
 * from another hand at the same time, and the two can be folded into one
 * helper once both have landed.
 *
 * `week` goes in twice. A game's `week` is ESPN's `matchupPeriodId`
 * (js/season.js `normaliseGame`), and the site reads that week's rosters with
 * the same number as `scoringPeriodId` — one scoring week per matchup, which
 * is how both leagues this site has seen are set up. `teamId` is the home
 * side; ESPN opens the game that team played that week.
 *
 * null — and so no link — without a league id (the sample league), for a bye,
 * or for a game with no week.
 */
function boxScoreUrl(league, g) {
  const id = String(league?.leagueId ?? '').trim();
  const season = Number(league?.season);
  const week = Number(g?.week);
  if (!id || !Number.isInteger(season) || !Number.isInteger(week) || week < 1) return null;
  if (g.homeId == null || g.awayId == null) return null;
  return (
    'https://fantasy.espn.com/football/boxscore' +
    `?leagueId=${encodeURIComponent(id)}` +
    `&matchupPeriodId=${week}` +
    `&scoringPeriodId=${week}` +
    `&seasonId=${season}` +
    `&teamId=${encodeURIComponent(g.homeId)}`
  );
}

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

// The rank, label, class and "healthy" rule live in js/injury.js (2026-09-29),
// shared with the Trade page's underline so the two cannot disagree.

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
  odds = null, oddsPending = false, chances = null,
  waiverClears = null, kickoffs = null, now = Date.now(),
  // `{ leagueId, season }` of the league on screen, for the links out to ESPN;
  // null on the sample league, which has no ESPN page to open.
  league = null,
  // `{ week, teams }`: the last finished week before `week` and its rosters,
  // where the page already holds them (see lastScores) — the injury report's
  // "Last" column. null when no week is finished.
  last = null,
  // week -> teams: every roster week the page ALREADY holds beyond the ones
  // above (the played weeks read for the win chance; the sample league's
  // generated weeks). The player cards are drawn from these and nothing is
  // read for them. `byes` is `{ [proTeamId]: week }` or null.
  weekTeams = null,
  byes = null,
}) {
  const roster = new Map((rosters?.teams || []).map((t) => [t.id, t]));
  // THE WEEKS HELD, for the player cards: what was handed in, then the week on
  // screen, the bench panel's and the last finished one where they are held.
  const held = new Map();
  for (const [w, teams] of weekTeams || []) if (teams?.length) held.set(Number(w), teams);
  if (rosters?.teams?.length) held.set(Number(week), rosters.teams);
  if (benchRosters?.teams?.length && benchWeek !== week) held.set(Number(benchWeek), benchRosters.teams);
  if (last?.teams?.length && !held.has(Number(last.week))) held.set(Number(last.week), last.teams);
  // The record beside each name: banked W–L, and for a team whose game is
  // being played that game as its chance of winning it (`chances`).
  const banked = bankedRecords(schedule);
  const recordOf = (id) => (banked.has(id)
    ? capture.recordNow(banked.get(id), chances?.get(id) ?? null)
    : null);
  // "The lineup as set" means something only for the week being played next:
  // ESPN carries today's lineup forward into every later week unchanged.
  const thisWeek = currentWeek(schedule) === week;
  // Has his NFL game started? The roster reading's own evidence, plus the
  // kickoff time when the page holds it (a man minutes into his game may have
  // no stat line yet).
  const locked = (p) => {
    if (hasPlayed(p)) return true;
    const at = kickoffs?.[p.proTeamId]?.[week];
    return Number.isFinite(at) && at <= now;
  };

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

    // START A OVER B, on your own game while it can still be acted on. The
    // win figure is the SAME model as the chance above — same spread, same
    // opponent total — so it is only quoted where that chance is.
    let swaps = null;
    const squad = mine && !bye && !g.played && thisWeek ? roster.get(teamId) : null;
    if (squad) {
      swaps = startSit({
        players: squad.players || [...(squad.starters || []), ...(squad.bench || [])],
        slots: odds?.projection?.slots ?? null,
        isLocked: locked,
        oppPoints: hasOdds ? odds.points(g, g.homeId === teamId ? 'away' : 'home') : null,
        sigma: hasOdds ? odds.sigma : null,
      });
    }

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
      espnUrl: isDemo ? null : boxScoreUrl(league, g),
      homeRecord: recordOf(g.homeId),
      awayRecord: bye ? null : recordOf(g.awayId),
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
      swaps,
    };
  });
  // His own game leads the list; the rest keep ESPN's order.
  games.sort((a, b) => Number(b.mine) - Number(a.mine));

  // The bench panel may be reading an earlier week than the matchups — the
  // latest one with a final score. Its games are that week's.
  const benchSame = benchWeek === week;
  const benchGames = benchSame ? games : schedule.byWeek.get(benchWeek) || [];
  const benchFrom = benchSame ? rosters : benchRosters;

  // A TEAM, FOR ITS CARD: record, average and this week's projection, and the
  // games behind the record. The average's rank is among the teams that have
  // played; `proj` is the lineup as set for the week on screen.
  const ranked = [...banked.values()].filter((t) => t.games.length)
    .map((t) => t.pf / t.games.length).sort((a, b) => b - a);
  const teamInfo = new Map((schedule.teams || []).map((t) => {
    const b = banked.get(t.id);
    const avg = b && b.games.length ? b.pf / b.games.length : null;
    return [t.id, {
      id: t.id,
      name: t.name,
      record: recordOf(t.id),
      games: b ? b.games : [],
      avg,
      avgRank: avg === null ? null : ranked.findIndex((v) => v <= avg + 1e-9) + 1,
      avgOf: ranked.length,
      proj: roster.get(t.id)?.projectedTotal ?? null,
    }];
  }));

  return {
    isDemo,
    week,
    currentWeek: currentWeek(schedule),
    held,
    byes,
    squads: roster,
    benchSquads: new Map((benchFrom?.teams || []).map((t) => [t.id, t])),
    teamInfo,
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
    injuries: injuredStarters(rosters, last?.teams ?? null, { week, byes, isDemo }),
    lastWeek: last?.week ?? null,
    bench: benchReport(benchFrom, benchGames),
    benchWeek,
    // IS THE BENCH PANEL'S WEEK FINISHED FOR EVERYBODY? The red/green scale on
    // the Started column needs it: mid-Sunday the panel holds the four squads
    // whose games are over, and "above average" worked out from four teams is
    // not "above the league". A week where every fixture is final is the only
    // one where those ten scores are a comparison group.
    benchWeekComplete: benchGames.length > 0 && benchGames.every((g) => g.played),
    benchRostersMissing: !benchFrom?.teams?.length,
    deadlines: isDemo ? '' : deadlineText({ deadline: schedule.trades?.deadline, waiverClears, now }),
  };
}

/**
 * teamId -> `{ w, l, t }` over every game that is final, counted the way the
 * Schedule page counts the record on its own cards: `capture.gameState` says
 * what is final (a matchup settled early included) and `capture.winnerOf` who
 * won it, from the scores.
 */
function bankedRecords(schedule) {
  const out = new Map();
  // `games` and `pf` are the same final games one by one, for the record's
  // card (W–L by week) and the team card's average.
  const of = (id) => {
    if (!out.has(id)) out.set(id, { w: 0, l: 0, t: 0, pf: 0, games: [] });
    return out.get(id);
  };
  for (const t of schedule.teams || []) of(t.id);
  for (const g of schedule.games || []) {
    if (g.homeId == null || g.awayId == null) continue;        // bye
    if (capture.gameState(g) !== 'final') continue;
    const home = of(g.homeId);
    const away = of(g.awayId);
    const winner = capture.winnerOf(g);
    if (winner === 'tie') { home.t++; away.t++; }
    else if (winner === 'home') { home.w++; away.l++; }
    else { away.w++; home.l++; }
    const note = (side, mine, theirs, oppName, won) => {
      if (!isNum(mine) || !isNum(theirs)) return;
      side.pf += mine;
      side.games.push({
        week: g.week, opp: oppName, pf: mine, pa: theirs,
        result: winner === 'tie' ? 'T' : won ? 'W' : 'L',
      });
    };
    note(home, g.homeScore, g.awayScore, g.awayName, winner === 'home');
    note(away, g.awayScore, g.homeScore, g.homeName, winner === 'away');
  }
  for (const t of out.values()) t.games.sort((a, b) => a.week - b.week);
  return out;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * "Trade deadline in 12 days · waivers clear Wed" — only the parts the league
 * gave us, and '' when it gave neither.
 *
 * The deadline is `espn.parseTrades`'s, off the schedule read (the Trade
 * page's line), counted in days the way that page counts them. Waivers are the
 * `waiverClears` the Players page prints beside a man on waivers; a date that
 * has passed (a synced copy from before the run) is left out, never guessed
 * forward.
 */
export function deadlineText({ deadline = null, waiverClears = null, now = Date.now() } = {}) {
  const parts = [];
  if (Number.isFinite(deadline) && deadline > 0) {
    parts.push(now >= deadline
      ? 'Trade deadline passed'
      : `Trade deadline in ${plural(Math.ceil((deadline - now) / 86400000), 'day')}`);
  }
  if (Number.isFinite(waiverClears) && waiverClears > now) {
    parts.push(`${parts.length ? 'waivers' : 'Waivers'} clear ${DAYS[new Date(waiverClears).getDay()]}`);
  }
  return parts.join(' · ');
}

// (Roster strength — the set lineup's season projection over 17 games — was
// built here until 2026-10-08. Tim moved it to the Stats page, where it is the
// best lineup averaged over the weeks left: js/stats-page.js, js/lineup-avg.js.)

/**
 * Starters carrying an injury designation.
 *
 * One of the very few things that is fully meaningful before kickoff: a
 * questionable starter is a decision the owner still has to make, this week,
 * whether or not a single game has been played.
 */
function injuredStarters(rosters, lastTeams = null, { week = null, byes = null, isDemo = false } = {}) {
  // playerId -> what he scored in the last finished week, whichever squad (or
  // bench) he was on then. A man on nobody's roster that week has no entry.
  const scored = new Map();
  for (const t of lastTeams || []) {
    for (const p of t.players || [...(t.starters || []), ...(t.bench || [])]) {
      if (p.playerId != null && isNum(p.actual)) scored.set(p.playerId, p.actual);
    }
  }
  // THE POSITION SCALE (Tim, 2026-10-08, docs/colour-plan.md). Proj and Last
  // are each measured against THE LEAGUE'S STARTERS AT HIS POSITION that week —
  // the group the Analysis page's Player rows use — never against the other
  // injured men, who are a quarterback above a kicker. A zero that is a bye or
  // a ruled-out man's is not a projection of his play: it is left out of the
  // group, and his own cell is left plain.
  const real = (p) => {
    const v = projOf(p);
    if (v !== 0) return v;
    const kind = zeroKind(0, {
      week, byeWeek: byeWeekOf(p, byes), injuryStatus: p.injuryStatus, demo: isDemo,
    });
    return kind === 'zero' ? 0 : null;
  };
  const scalesBy = (teams, valueOf) => {
    const by = new Map();
    for (const t of teams || []) {
      for (const p of t.starters || []) {
        const v = valueOf(p);
        if (!isNum(v)) continue;
        if (!by.has(p.position)) by.set(p.position, []);
        by.get(p.position).push(v);
      }
    }
    return new Map([...by].map(([pos, vals]) => [pos, heatScale(vals)]));
  };
  const projScales = scalesBy(rosters?.teams, real);
  const lastScales = scalesBy(lastTeams, (p) => p.actual);
  const out = [];
  for (const team of rosters?.teams || []) {
    for (const p of team.starters || []) {
      if (healthy(p.injuryStatus)) continue;
      out.push({
        // The roster entry itself, for his card.
        player: p,
        projScale: isNum(real(p)) ? projScales.get(p.position) || null : null,
        lastScale: lastScales.get(p.position) || null,
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
        // A man whose NFL game is over carries his SCORE in `projected` (the
        // week in progress, js/season.js). This column is a projection, so he
        // shows the one he started with.
        projected: projOf(p),
        // His score in the last finished week, or null: none finished, or he
        // was on no roster this page holds for it.
        last: p.playerId != null && scored.has(p.playerId) ? scored.get(p.playerId) : null,
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

  // A matchup can be final while the week is still open: every STARTER has
  // finished, but a bench man may be mid-game (`done === false`), and his score
  // so far is not a bench point yet. That squad waits for him.
  const settled = (t) => !(t.players || [...(t.starters || []), ...(t.bench || [])])
    .some((p) => p.done === false);

  const rows = (rosters?.teams || [])
    .filter((t) => finished.has(t.id) && isNum(t.benchActualTotal) && settled(t))
    .map((t) => ({
      id: t.id,
      name: t.name,
      // The squad itself, for the cards that name its men.
      squad: t,
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
export function benchWeekFor(schedule, week, rosters = null) {
  const final = (w) => (schedule.byWeek.get(w) || []).some((g) => g.played);
  // `rosters` are `week`'s, when the caller holds them: a week whose only final
  // squads still have a bench man playing has no row to show yet, so it does
  // not take the panel away from the last week that does.
  const hasRow = !rosters?.teams?.length ||
    benchReport(rosters, schedule.byWeek.get(week) || []).length > 0;
  if (final(week) && hasRow) return week;
  const earlier = schedule.weeks.filter((w) => w < week && final(w));
  return earlier.length ? earlier[earlier.length - 1] : week;
}

/** The latest week before `week` with a final score, or null. */
export function lastFinalWeek(schedule, week) {
  const final = (w) => (schedule.byWeek.get(w) || []).some((g) => g.played);
  const earlier = schedule.weeks.filter((w) => w < week && final(w));
  return earlier.length ? earlier[earlier.length - 1] : null;
}

/** The sample league's last finished week, generated once per week shown. */
let demoLast = { week: null, teams: null };

/**
 * The last finished week and its rosters, FROM WHAT THE PAGE ALREADY HOLDS —
 * never a read of its own (rule 20: the phone's synced copy asks ESPN for
 * nothing, and a column is not worth a request on a laptop either).
 *
 * On the usual visit that week is the bench panel's, already read for it.
 * Otherwise it is among the played weeks the win chance read; until those land
 * the column shows dashes and the repaint that brings the chance fills it. The
 * sample league's weeks are generated, so they cost nothing.
 */
function lastScores() {
  const { schedule, week } = state;
  const lw = schedule ? lastFinalWeek(schedule, week) : null;
  if (lw === null) return null;
  let teams = null;
  if (state.benchWeek === lw && state.benchRosters?.teams?.length) {
    teams = state.benchRosters.teams;
  } else if (state.isDemo) {
    if (demoLast.week !== lw) {
      demoLast = { week: lw, teams: generateDemoWeekRosters(lw)?.teams || null };
    }
    teams = demoLast.teams;
  } else {
    teams = state.oddsTeams.get(lw) || null;
  }
  return { week: lw, teams };
}

/** The sample league's weeks, generated once: they cost nothing to make. */
let demoHeld = { schedule: null, weeks: null };

/**
 * week -> teams for the player cards, FROM WHAT THE PAGE ALREADY HOLDS: the
 * roster weeks the win chance read (its played weeks and the current one), or
 * the sample league's generated weeks. Never a read of its own — a card is not
 * worth a request, on a laptop or on the phone's synced copy (rule 20).
 * `buildModel` adds the week on screen and the bench panel's.
 */
function heldWeeks() {
  if (!state.isDemo) return state.oddsTeams;
  if (demoHeld.schedule !== state.schedule) {
    const weeks = new Map();
    for (const w of state.schedule?.weeks || []) {
      const teams = generateDemoWeekRosters(w)?.teams;
      if (teams?.length) weeks.set(w, teams);
    }
    demoHeld = { schedule: state.schedule, weeks };
  }
  return demoHeld.weeks;
}

function setStatus(html, isError = false) {
  const el = $('sourceStatus');
  el.innerHTML = html;
  el.style.color = isError ? 'var(--err)' : 'var(--dim)';
}

/** One live load at a time: boot and the connection bar can both ask. */
let liveLoading = false;
/** Which live load is the current one; "Demo data" moves it on (dropLive). */
let liveRun = 0;

/**
 * THE SOURCE BUTTONS SAY WHAT IS ON SCREEN — the league being read, while a
 * live load is on its way, and otherwise whatever `state.isDemo` says.
 *
 * Worked out from state on every paint, never set by whoever ran last. Each
 * loader used to light its own button, and with a saved league the order was
 * wrong on every reload: the connection bar answers at once from its saved
 * copy, so the live load started (lighting "My ESPN league") BEFORE the boot's
 * demo paint (lighting "Demo data"), and nothing lit the first again when the
 * league arrived. The page showed the live league under a lit "Demo data".
 */
function syncToggle() {
  const showing = liveLoading || !state.isDemo ? 'live' : 'demo';
  $('sourceToggle')
    .querySelectorAll('button')
    .forEach((b) => b.classList.toggle('on', b.dataset.src === showing));
}

/** "Demo data" was clicked: whatever a live load brings back now is not wanted. */
function dropLive() {
  liveRun++;
  liveLoading = false;
}

function loadDemo(note = '') {
  state.isDemo = true;

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

async function loadLive() {
  const cfg = savedConfig();
  if (!cfg) {
    loadDemo('No league connected yet — use the strip above.');
    return;
  }
  if (liveLoading) return;
  liveLoading = true;
  const run = ++liveRun;
  syncToggle();
  try {
    await loadLiveNow(cfg, () => run === liveRun);
  } finally {
    // A load that failed, or found no matchups, leaves the demo league on
    // screen, and the buttons then say so.
    if (run === liveRun) {
      liveLoading = false;
      syncToggle();
    }
  }
}

/**
 * `wanted()` turns false when "Demo data" is clicked while this is still
 * reading: nothing that arrives after that reaches the page or the status
 * line. Until the league and its rosters are both in hand the demo league
 * stays whole in `state`, so a repaint in between never mixes the two.
 */
async function loadLiveNow(cfg, wanted) {
  espn.configure({ leagueId: cfg.leagueId, season: cfg.season });
  if (cfg.teamId != null) state.teamId = cfg.teamId;

  setStatus('Loading your league from ESPN…');
  try {
    const schedule = await season.fetchSchedule();
    if (!wanted()) return;
    if (!schedule.games.length) {
      setStatus(
        `Connected to ${esc(schedule.leagueName)}, but ESPN has no matchups for ` +
        `${cfg.season} yet. The demo league is still shown below.`,
        true
      );
      return;
    }

    const week = currentWeek(schedule);
    const rosters = await loadRosters(week);
    if (!wanted()) return;
    state.schedule = schedule;
    state.week = week;
    state.isDemo = false;
    // A new schedule is a new league as far as the odds are concerned.
    state.odds = null;
    state.oddsTeams = new Map();
    state.waiverClears = null;
    state.waiverRead = null;
    state.byes = null;
    state.rosters = rosters;
    const odds = startOdds();
    await loadBench();
    if (!wanted()) return;
    await paintWhenOdds(odds);
  } catch (err) {
    if (!wanted()) return;
    // Demo data is already on screen from boot, so a failed live load costs the
    // user a sentence, not the page.
    setStatus(`${esc(err.message)} Still showing the demo league below.`, true);
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
  const { schedule, week } = state;
  const bw = benchWeekFor(schedule, week, state.rosters);
  let rosters = null;
  if (bw !== week) rosters = state.isDemo ? generateDemoWeekRosters(bw) : await loadRosters(bw);
  // The page moved on while that was being read (another league, another
  // week): these are not its bench rosters.
  if (state.schedule !== schedule || state.week !== week) return;
  state.benchWeek = bw;
  state.benchRosters = rosters;
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
  return { ...odds, floorWeek, chances: await liveChances(data, have, floors) };
}

/**
 * teamId -> its chance of winning the game it is playing right now, for the
 * record beside each name on the cards; empty when no matchup is under way.
 *
 * `capture.liveWinChancesFrom` off the rosters and floor just read — the call
 * the Stats page makes, so the same team reads the same record on both. The
 * NFL's games are the payload the roster read already fetched for byes, so it
 * asks ESPN for nothing more. A stub without the read, a failure, or the
 * synced copy (which has no NFL games) is simply a whole-number record.
 */
async function liveChances(data, weekTeams, floors) {
  try {
    if (typeof season.fetchProGames !== 'function') return new Map();
    if (await syncedCopy()) return new Map();
    const proGames = await season.fetchProGames();
    // Did the NFL's schedule land? `readByes` asks for the byes only when it
    // did, because then they are on the payload already held.
    proHeld = !!proGames && Object.keys(proGames).length > 0;
    const week = capture.openWeeks(data)[0];
    return capture.liveWinChancesFrom({
      data, weekTeams, floors, proGames,
      asOf: typeof season.weekReadAt === 'function' && week !== undefined
        ? season.weekReadAt(week) : null,
    });
  } catch {
    return new Map();
  }
}

/**
 * Is this page drawing the phone's synced copy? Asked of js/season.js, which
 * is the one place that knows; a stub without `cloudSource` is taken as "no".
 *
 * A PAGE ON THE SYNCED COPY ASKS ESPN FOR NOTHING. The copy carries the
 * rosters, the schedule and the wire's projections, but not the NFL's kickoffs
 * or when a free agent clears waivers, so the three reads here that want those
 * stand down rather than going to ESPN for them.
 */
async function syncedCopy() {
  if (typeof season.cloudSource !== 'function') return false;
  try {
    return Boolean(await season.cloudSource());
  } catch {
    return false;
  }
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
    state.waiverClears = null;
    return Promise.resolve();
  }
  state.oddsPending = true;
  const week = state.week;
  const odds = loadOdds(week).then(
    (got) => {
      if (token !== state.oddsToken) return;
      state.odds = got;
      state.oddsPending = false;
    },
    () => {
      if (token !== state.oddsToken) return;
      state.oddsPending = false;
    }
  );
  // The deadlines line and the lineup locks ride the same wait, so the first
  // paint carries them and nothing arrives a line late.
  if (!state.waiverRead) state.waiverRead = readWaiverClears();
  const waivers = state.waiverRead.then((at) => {
    if (token === state.oddsToken) state.waiverClears = at;
  });
  // After the odds, whose own read of the NFL's games (`liveChances`) is the
  // payload the byes come off — so they cost nothing by then.
  const byes = odds.then(() => readByes(token));
  return Promise.all([odds, waivers, readKickoffs(), byes]).then(() => {});
}

/**
 * Every NFL team's bye week, for the player cards: what tells a bye's 0.00
 * from a ruled-out man's. Kept for the visit.
 *
 * NOT ASKED ON THE SYNCED COPY (rule 20): `season.fetchByeWeeks` would go to
 * ESPN when a sync carried no byes, and a card's wording is not worth a
 * request. There a zero reads as the card has always read one with the byes
 * unknown. On a laptop it is the payload `liveChances` has just read, so it
 * adds no request — and when that read came back with no games in it
 * (`proHeld`), the byes are not asked for at all rather than asked for again.
 * Never throws.
 */
let proHeld = false;
async function readByes(token) {
  try {
    if (state.byes || state.isDemo || !proHeld) return;
    if (typeof season.fetchByeWeeks !== 'function') return;
    if (await syncedCopy()) return;
    const b = await season.fetchByeWeeks();
    if (token === state.oddsToken && b && Object.keys(b).length) state.byes = b;
  } catch {
    /* no byes: the cards fall back to the old rule for a zero */
  }
}

/**
 * When waivers next clear: the earliest date still ahead on the wire, or null.
 *
 * `season.fetchWireWeek` for the week the floor is read for — the same request
 * `loadOdds` has just made, which js/espn.js shares, so on a laptop this costs
 * nothing. The synced copy's wire does not carry the dates, so a phone is not
 * asked and the line simply leaves waivers out. Never throws.
 */
async function readWaiverClears() {
  try {
    if (typeof season.fetchWireWeek !== 'function') return null;
    if (await syncedCopy()) return null;
    const week = capture.floorWeek(capture.normalizeSchedule(state.schedule, { isDemo: false }));
    if (!week) return null;
    const wire = (await season.fetchWireWeek(week)) || [];
    const now = Date.now();
    let next = null;
    for (const p of wire) {
      const at = p && p.waiverClears;
      if (Number.isFinite(at) && at > now && (next === null || at < next)) next = at;
    }
    return next;
  } catch {
    return null;
  }
}

/**
 * NFL kickoffs, so a man whose game has started is not offered as a swap.
 *
 * ASKED FOR ONLY WHEN A SWAP IS ON OFFER. Locking a man can only take swaps
 * away, so a lineup with none to suggest needs no kickoffs at all. When it is
 * asked, `season.fetchProKickoffs` reuses the bye read's payload where this
 * page made one; otherwise it is one public read — except on the synced copy,
 * which is not asked: the roster's own evidence locks who has played. Kept for
 * the visit: the NFL schedule is the season's, not the league's. Never throws.
 */
async function readKickoffs() {
  try {
    if (state.kickoffs || state.isDemo || state.teamId == null) return;
    if (typeof season.fetchProKickoffs !== 'function') return;
    const squad = (state.rosters?.teams || []).find((t) => t.id === state.teamId);
    const s = squad && startSit({ players: squad.players || [] });
    if (!s || s.best) return;
    if (await syncedCopy()) return;
    const k = await season.fetchProKickoffs();
    if (k && Object.keys(k).length) state.kickoffs = k;
  } catch {
    /* no kickoffs: the roster's own evidence still locks who has played */
  }
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
  syncToggle();
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
    chances: state.isDemo ? null : state.odds?.chances ?? null,
    oddsPending: !state.isDemo && state.oddsPending,
    waiverClears: state.isDemo ? null : state.waiverClears,
    kickoffs: state.isDemo ? null : state.kickoffs,
    league: state.isDemo ? null : espn.getConfig(),
    last: lastScores(),
    weekTeams: heldWeeks(),
    byes: state.isDemo ? null : state.byes,
  }));
}

// --------------------------------------------------------------------- render

export function render(m) {
  // Every card registered by the last paint is dead: the markup that carried
  // its key is about to be replaced.
  clearRuns('home');
  clearPops('home');
  cur = m;
  wireValue(m.isDemo);
  renderHeader(m);
  renderWeekPicker(m);
  renderDeadlines(m);
  renderMatchups(m);
  renderInjuries(m);
  renderBench(m);
  // A player card open across the repaint that brings the win chance is
  // redrawn from the same man's new cell rather than left on a dead key.
  reopenTip();
}

// ------------------------------------------------------- the cards' contents
//
// One function per kind of card, each returning a `statCard` spec (js/pop.js)
// or null when the page does not hold what the card would say. Rows are a
// label and a number and come to the figure the card hangs off; a row of
// "Rounding" says so when one-decimal parts fall a tenth short of it.

/** A "Rounding" row when the printed parts miss the printed total, else none. */
function roundingRows(total, parts) {
  const t10 = (v) => Math.round(v * 10);
  if (!isNum(total) || !parts.every(isNum)) return [];
  const miss = t10(total) - parts.reduce((a, v) => a + t10(v), 0);
  return miss && Math.abs(miss) <= parts.length ? [{ label: 'Rounding', value: miss / 10 }] : [];
}

/** A number with a real minus sign, as the tables print a negative. */
const minus = (n) => `−${fmt(Math.abs(n))}`;

/**
 * A team: record, average, and the projection of its lineup for the week on
 * screen. Opens that team's roster on Analysis.
 */
function teamSpec(m, id) {
  const t = m.teamInfo?.get(id);
  if (!t) return null;
  return {
    title: t.name,
    rows: [
      { label: 'Record', value: t.record ? t.record.text : '—' },
      {
        label: 'Avg',
        note: t.avgRank ? `${ordinal(t.avgRank)} of ${t.avgOf}` : '',
        value: t.avg,
      },
      { label: `Week ${m.week} proj`, value: t.proj },
    ],
    href: teamHref(id, m.week),
    hrefLabel: 'Open roster',
  };
}

/** A team's record, game by game. Opens its row in the Stats standings. */
function recordSpec(m, id) {
  const t = m.teamInfo?.get(id);
  if (!t || !t.record) return null;
  return {
    title: t.name,
    sub: 'Record',
    head: t.games.length ? ['Wk', 'Opponent', 'Score'] : null,
    rows: t.games.map((g) => ({
      lead: g.week,
      label: g.opp,
      value: `${g.result} ${fmt(g.pf)}–${fmt(g.pa)}`,
    })),
    total: { label: 'Record', value: t.record.text },
    // The basis of a decimal record (rule 7), where its `title` used to be.
    foot: t.record.live ? t.record.title : '',
    href: statsHref(id),
    hrefLabel: 'Open standings',
  };
}

const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'OP', 'D/ST', 'DST', 'K'];

/**
 * A team's week in its starters: what each scored (`pts`), with his projection
 * beside his name, or what each is projected (`proj`). Opens that team and
 * week on Analysis.
 */
function weekSpec(squad, { name, week, total, kind }) {
  if (!squad?.starters?.length || !isNum(total)) return null;
  // In lineup order, as ESPN's own roster screen lists a team — the payload's
  // order is whatever order the men were added in.
  const at = (p) => { const i = SLOT_ORDER.indexOf(p.slot); return i < 0 ? SLOT_ORDER.length : i; };
  const lineup = squad.starters
    .map((p, i) => ({ p, i }))
    .sort((a, b) => at(a.p) - at(b.p) || a.i - b.i)
    .map((x) => x.p);
  const spec = teamWeekSpec({
    team: name,
    week,
    total,
    starters: lineup.map((p) => (kind === 'pts'
      ? { slot: p.slot, name: shortName(p), pts: p.actual, proj: projOf(p) }
      : { slot: p.slot, name: shortName(p), pts: projOf(p) })),
    href: teamHref(squad.id, week),
  });
  if (kind === 'proj') spec.total.label = 'Projected';
  return spec;
}

/** The bench's points, man by man. */
function benchSpec(r, week) {
  const men = (r.squad?.bench || []).filter((p) => isNum(p.actual));
  if (!men.length) return null;
  const spec = teamWeekSpec({
    team: r.name,
    week,
    total: r.bench,
    starters: men.map((p) => ({
      slot: p.position, name: shortName(p), pts: p.actual, proj: projOf(p),
    })),
    href: teamHref(r.id, week),
  });
  spec.sub = `Week ${week} bench`;
  spec.total.label = 'Bench';
  return spec;
}

/**
 * The cost of the biggest miss: the benched man's score less the starter's
 * ("benched 25.2 − started 1.5 = 23.7"), with the total as the cell prints it.
 */
function costSpec(r, week) {
  if (!r.miss) return null;
  const { started, benched, gain } = r.miss;
  return {
    title: r.name,
    sub: `Week ${week} biggest miss`,
    rows: [
      { label: shortName(benched), note: 'benched', value: benched.actual },
      { label: shortName(started), note: 'started', value: started.actual },
      ...roundingRows(gain, [benched.actual, -started.actual]),
    ],
    total: { label: 'Cost', html: minus(gain) },
    href: teamHref(r.id, week),
    hrefLabel: 'Open roster',
  };
}

/** "D/ST", not "DST", in words a reader sees. */
const posWord = (pos) => (pos === 'DST' ? 'D/ST' : pos);

/**
 * Where one man's number stands among the league's starters at his position —
 * the words behind a shaded Proj or Last cell. Opens his row on Players.
 */
function standingSpec(p, { label, value, h, scale, week }) {
  const group = `starting ${posWord(p.position)}s`;
  const st = heatStanding(value, scale);
  return {
    title: p.name,
    sub: `${posWord(p.position)} · week ${week}`,
    rows: [
      { label, value },
      { label: `Avg of ${group}`, value: h.avgText },
    ],
    // A man who was on a bench that week is not one of the starters he is
    // set against, and the count says so rather than passing him off as one.
    foot: st && !st.member ? `${h.standing}, counting him with the ${group}` : `${h.standing} ${group}`,
    href: playerHref(p.playerId),
    hrefLabel: 'His next 13 weeks',
  };
}

/** The line under a matchup: both totals, the gap, and the chance. */
function metaSpec(g, m) {
  if (g.awayId === null || g.awayId === undefined) return null;
  const base = {
    title: `${g.homeName} v ${g.awayName}`,
    sub: `Week ${m.week}`,
    href: weekHref(m.week),
    hrefLabel: `Week ${m.week} on Schedule`,
  };
  const projNote = (v) => (isNum(v) ? `proj ${fmt(v)}` : '');
  if (g.played) {
    if (!isNum(g.homeScore) || !isNum(g.awayScore)) return null;
    return {
      ...base,
      rows: [
        { label: g.homeName, note: projNote(g.homeProjected), value: g.homeScore },
        { label: g.awayName, note: projNote(g.awayProjected), value: g.awayScore },
      ],
      total: { label: g.winner === 'tie' ? 'Tied' : 'Margin', value: Math.abs(g.margin) },
    };
  }
  if (isNum(g.homeWinPct) && isNum(g.homeBest) && isNum(g.awayBest)) {
    const p = g.homeWinPct;
    const favName = g.favourite === 'home' ? g.homeName : g.favourite === 'away' ? g.awayName : '';
    const hi = Math.max(g.homeBest, g.awayBest);
    const lo = Math.min(g.homeBest, g.awayBest);
    return {
      ...base,
      rows: [
        { label: g.homeName, note: 'best lineup', value: g.homeBest },
        { label: g.awayName, note: 'best lineup', value: g.awayBest },
        ...roundingRows(g.projectedMargin, [hi, -lo]),
      ],
      totals: [{ label: 'Gap', value: g.projectedMargin }],
      total: isNum(g.myWinPct)
        ? { label: 'Your win chance', html: pctText(g.myWinPct) }
        : { label: favName ? `${favName} win chance` : 'Win chance', html: pctText(Math.max(p, 1 - p)) },
      // Rule 1: every percentage is ours and says so.
      foot: 'Our model, from ESPN’s projections.',
    };
  }
  if (g.marginBasis === 'set') {
    const hi = Math.max(g.homeProjected, g.awayProjected);
    const lo = Math.min(g.homeProjected, g.awayProjected);
    return {
      ...base,
      rows: [
        { label: g.homeName, note: 'lineup as set', value: g.homeProjected },
        { label: g.awayName, note: 'lineup as set', value: g.awayProjected },
        ...roundingRows(g.projectedMargin, [hi, -lo]),
      ],
      total: { label: 'Gap', value: g.projectedMargin },
    };
  }
  return null;
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

/** One line above the cards; hidden when the league gave us neither date. */
function renderDeadlines(m) {
  const el = $('deadlines');
  if (!el) return;
  el.textContent = m.deadlines || '';
  if (m.deadlines) el.removeAttribute('hidden');
  else el.setAttribute('hidden', '');
}

function renderWeekPicker(m) {
  const sel = $('weekSelect');
  sel.innerHTML = m.weeks
    .map((w) => `<option value="${w}">Week ${w} of ${m.weeks.length}</option>`)
    .join('');
  sel.value = String(m.week);
}

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
  // The week heading opens that week on the Schedule page. The card hangs off
  // a span, so it sits beside the words and not at the far end of the heading.
  const weekKey = registerPop({
    title: `Week ${m.week}`,
    rows: [{ label: 'Games final', value: `${m.playedThisWeek} of ${m.games.length}` }],
    href: weekHref(m.week),
    hrefLabel: `Week ${m.week} on Schedule`,
  }, 'home');
  $('matchupsTitle').innerHTML =
    `<span ${POP_ATTR}="${esc(weekKey)}" ${POP_GO_ATTR} tabindex="0">Week ${m.week} of ${m.weeks.length}</span>`;

  if (!m.games.length) {
    $('matchups').innerHTML = '<div class="empty">No matchups scheduled for this week.</div>';
    $('matchupsNote').textContent = '';
    tuck('matchupsExplain', false);
    return;
  }

  $('matchups').innerHTML =
    `<div class="games">${m.games.map((g) => gameCard(g, m)).join('')}</div>`;

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
  // The basis of the swap line (rule 7), behind the toggle with the rest.
  const withSwaps = m.games.some((g) => g.swaps && !g.swaps.best);
  if (withSwaps) $('matchupsExplain').innerHTML += (withChance ? ' ' : '') + SWAP_EXPLAIN;
  tuck('matchupsExplain', withChance || withSwaps);
}

const SWAP_EXPLAIN =
  '<strong>Start &hellip; over &hellip;</strong> is your lineup as set against the best legal ' +
  'one on ESPN&rsquo;s projections for this week; a player whose game has started stays where ' +
  'he is. <strong>pts</strong> is one projection minus the other. <strong>win</strong> is what ' +
  'the swap adds to your win chance, read against the same spread and the same opponent ' +
  'total, each swap on top of the one above it. The win chance on the card already assumes ' +
  'you make them.';

/** How many swaps the card prints, biggest first. */
const MAX_SWAPS = 2;

/** A gain in win chance, in whole points of percent; never "+0%". */
function winText(p) {
  const v = p * 100;
  return v < 0.5 ? '+&lt;1%' : `+${Math.round(v)}%`;
}

/**
 * The lines under your own card: one per swap, or three words when the lineup
 * as set is already the best one. The names link to the Players page like
 * every other player on this dashboard.
 */
function swapLines(s) {
  if (!s) return '';
  if (s.best) return '<div class="gswap">Best lineup set</div>';
  const who = (p) => pref(p, esc(shortName(p)));
  return s.swaps.slice(0, MAX_SWAPS).map((w) =>
    `<div class="gswap">Start ${who(w.in)}${w.out ? ` over ${who(w.out)}` : ''}: ` +
    `<span class="pos">+${fmt(w.points)} pts</span>` +
    `${w.win === null ? '' : `, ${winText(w.win)} win`}</div>`
  ).join('');
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

function gameCard(g, m) {
  const teamId = m.teamId;
  const bye = g.awayId === null || g.awayId === undefined;

  const side = (which, name, proj, score, id) => {
    const classes = ['side'];
    if (g.played && g.winner !== 'tie') classes.push(g.winner === which ? 'win' : 'lose');
    else if (!g.played && g.favourite === which) classes.push('fav');
    const you = teamId != null && id === teamId ? ' <span class="muted">(you)</span>' : '';
    // The record, small and dim beside the name as on the Schedule page's
    // cards. Its own element: on a narrow card the NAME shortens to "…",
    // never the record. Its card is the games behind it, and carries the
    // basis of a decimal one (rule 7) where a `title` used to.
    const rec = which === 'home' ? g.homeRecord : g.awayRecord;
    const record = rec
      ? `<span class="trec"${pop(recordSpec(m, id))}>${rec.text}</span>`
      : '';
    // THE TEAM'S WEEK, IN ITS STARTERS, on each of the three figures: what the
    // lineup is projected (Proj), what it scored (Pts), and on the name
    // whichever of the two the week has reached. Without that week's rosters
    // the name falls back to the team's own card.
    const squad = m.squads?.get(id);
    const asProj = weekSpec(squad, { name, week: m.week, total: proj, kind: 'proj' });
    const asPts = g.played
      ? weekSpec(squad, { name, week: m.week, total: score, kind: 'pts' })
      : null;
    return `<div class="${classes.join(' ')}">
        <span class="twho"><span class="tname"${pop(asPts || asProj || teamSpec(m, id))}>${esc(name)}${you}</span>${record}</span>
        <span class="tproj"${pop(asProj)}>${inline(proj)}</span>
        <span class="tscore"${pop(asPts)}>${g.played ? inline(score) : dash}</span>
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
  // Who scored what is ESPN's screen, so the card links to it rather than
  // rebuilding it. An element of its own between the two labels: the first
  // one stays the bare "Final" / "Upcoming" other code reads. Opens the way
  // the Trade page's ESPN link does.
  const box = g.espnUrl
    ? `<a class="gbox" href="${esc(g.espnUrl)}" target="_blank" rel="noopener">ESPN box score</a>`
    : '';
  return `<div class="game${g.played ? '' : ' upcoming'}${g.mine ? ' mine' : ''}"${exact}>
      <div class="ghead"><span>${g.played ? 'Final' : 'Upcoming'}</span>${box}<span>Proj · Pts</span></div>
      ${side('home', g.homeName, g.homeProjected, g.homeScore, g.homeId)}
      ${bye ? '' : side('away', g.awayName, g.awayProjected, g.awayScore, g.awayId)}
      <div class="gmeta"><span${pop(metaSpec(g, m))}>${meta}</span></div>
      ${swapLines(g.swaps)}
    </div>`;
}

/**
 * THE INJURY REPORT'S `Proj` AND `Last` TAKE THE POSITION SCALE (Tim,
 * 2026-10-08, docs/colour-plan.md) — and never a scale over the column.
 *
 * The column itself is a quarterback's 22.4 above a kicker's 7.9 above a
 * defence's 6.2, a list of whoever happens to be hurt: three different units
 * in one font, and a scale over it would paint every injured kicker red for
 * being a kicker. So each cell is measured against the group js/heat.js allows
 * — every STARTER AT HIS POSITION across the league that week, hurt or not
 * (`injuredStarters`), the group the Analysis page's Player rows use. A zero
 * that is a bye or a ruled-out man's is left plain.
 *
 * A shaded cell opens a stat card saying where the number stands in plain
 * words; a plain one opens his player card, like his name.
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
  // His number: shaded against the starters at his position, with the standing
  // on a stat card; or plain, and then the link opens his player card.
  const figure = (p, value, scale, label, week) => numCell(value, {
    scale,
    card: (h) => (h ? pop(standingSpec(p.player, { label, value, h, scale, week })) : ''),
    wrap: (t, h) => pref(p.player, t, { card: !h }),
  });
  const rows = m.injuries
    .map(
      (p) => `<tr${p.teamId === m.teamId ? ' class="me"' : ''}>
          <td class="name wrap">${pref(p.player, `${esc(p.name)} <span class="muted">${esc(p.position)}</span>`)}</td>
          <td class="left" data-v="${p.rank}"><span class="badge ${injuryClass(p.status)}">${esc(injuryLabel(p.status))}</span></td>
          <td class="left wrap"${pop(teamSpec(m, p.teamId))}>${esc(p.teamName)}</td>
          <td>${esc(p.slot)}</td>
          ${figure(p, p.projected, p.projScale, 'Projected', m.week)}
          ${figure(p, p.last, p.lastScale, 'Scored', m.lastWeek)}
        </tr>`
    )
    .join('');

  // One line a heading (docs/previews-plan.md): what the column is.
  const lastHead = m.lastWeek === null
    ? 'What he scored in the last finished week'
    : `What he scored in week ${m.lastWeek}, the last finished week`;
  $('injuries').innerHTML = `<div class="table-scroll"><table id="injuryTable">
      <thead><tr>
        <th class="name" data-sort title="A starter with an injury designation">Player</th>
        <th class="left" data-sort title="ESPN’s injury designation">Status</th>
        <th class="left wrap" data-sort title="The team starting him">Fantasy team</th>
        <th data-sort title="The lineup slot he is in">Slot</th>
        <th data-sort title="ESPN’s projection for week ${m.week}">Proj</th>
        <th data-sort title="${lastHead}">Last</th>
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
    'where his next 13 weeks are.' +
    (m.lastWeek === null
      ? ''
      : ` Last is what he scored in week ${m.lastWeek}, the last finished week; a dash means ` +
        'ESPN gave no score for him on a roster that week.') +
    // The colours' basis (rule 7), with the rest of the method.
    (m.injuries.some((p) => p.projScale || (p.lastScale && isNum(p.last)))
      ? ' Proj and Last are shaded against the league’s starters at his position that week: ' +
        'green above their average, red below. A bye or a ruled-out 0.0 is left plain.'
      : '');
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
  //
  // BY THE SHORT NAME ("B. Robinson Jr."), as on the swap line of the cards:
  // two full names and two scores made this table wider than its half of the
  // page at 1280 and far wider than a phone. The full name is the link's title.
  //
  // HIS PROJECTION FOR THAT WEEK rides beside his score, smaller (Tim,
  // 2026-10-08): whether the call looked wrong BEFORE the games is the half of
  // a miss the scores alone cannot say. Left off when ESPN gave none.
  const who = (p) => {
    const proj = projOf(p);
    return pref(p,
      `${esc(shortName(p))} <span class="muted">(${fmt(p.actual)}` +
      `${proj === null ? '' : `<span class="bproj"> · proj ${fmt(proj)}</span>`})</span>`);
  };

  // STARTED opens the team's week in its starters, and — where the week is
  // final for everybody — where that total stands: "9th of 10 · league avg
  // 121.7" (Tim, 2026-10-08: plain standing, never standard deviations).
  const startedCard = (r) => (h) => {
    const spec = weekSpec(r.squad, { name: r.name, week: m.benchWeek, total: r.started, kind: 'pts' });
    if (spec && h) spec.foot = `${ordinal(h.rank)} of ${h.of} · league avg ${h.avgText}`;
    return pop(spec);
  };

  const rows = m.bench
    .map((r) => {
      const miss = r.miss
        ? `${who(r.miss.benched)} over ${who(r.miss.started)}`
        : '<span class="muted">started the right nine</span>';
      return `<tr${r.id === m.teamId ? ' class="me"' : ''}>
          <td class="name wrap"${pop(teamSpec(m, r.id))}>${esc(r.name)}</td>
          ${numCell(r.started, { scale: heatStarted, card: startedCard(r) })}
          ${numCell(r.bench, { card: () => pop(benchSpec(r, m.benchWeek)) })}
          <td class="left wrap">${miss}</td>
          ${r.miss
            ? `<td class="neg" data-v="${r.miss.gain}"${pop(costSpec(r, m.benchWeek))}>−${fmt(r.miss.gain)}</td>`
            : `<td>${dash}</td>`}
        </tr>`;
    })
    .join('');

  const wk = m.benchWeek;
  $('bench').innerHTML = `<div class="table-scroll"><table id="benchTable">
      <thead><tr>
        <th class="name" data-sort title="The fantasy team">Team</th>
        <th data-sort title="Points its starting lineup scored in week ${wk}">Started</th>
        <th data-sort title="Points its bench scored in week ${wk}">Bench</th>
        <th class="left wrap" data-sort title="The benched player who most outscored a starter he could have replaced">Biggest miss</th>
        <th data-sort title="Points that one call cost">Cost</th>
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
  if (state.source === 'demo') {
    dropLive();
    loadDemo();
  } else {
    loadLive();
  }
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
  else {
    draw();
    // A newly chosen team may have a swap on offer, and so need the kickoffs.
    const had = state.kickoffs;
    readKickoffs().then(() => { if (state.kickoffs !== had) draw(); });
  }
});

// Sync now, or a roster move js/season.js noticed (`ff:refresh`, sent by
// js/connection.js): the league is read again, as on a first load.
document.addEventListener('ff:refresh', (e) => {
  if (state.source === 'live' && !state.isDemo) e.detail.waitUntil(loadLive());
});

// The cards, wired once on the three panels' own boxes: each is re-rendered
// freely afterwards. Every player card here is opt-out of the click connector
// because its element already is the link (an `a.pref`).
for (const box of [$('matchups')?.closest('section'), $('injuries'), $('bench')]) {
  if (!box) continue;
  wireTips(box);
  wirePops(box);
}

// Demo first, always: the page is never blank, and never shows an error before
// it has shown anything. A live load replaces it a moment later.
loadDemo();
if (state.source === 'live' && savedConfig()) loadLive();
