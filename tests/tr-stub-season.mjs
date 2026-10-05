// Stands in for js/season.js for the Trade page's LIVE scenarios.
//
// Four squads, hand-built so the two measures genuinely disagree — which is the
// only way to prove the page is showing the one it says it is.
//
// THE SHAPE OF THE LEAGUE, and every number below exists to make one of these
// true:
//
//   Ana (team 1) carries TWO quarterbacks whose weeks alternate 19 / 7. On a
//   single scalar per man they are both worth 13, so her lineup shows a 13 at
//   quarterback and Bo's steady 17 looks like a +4 upgrade. Across the weeks
//   she starts whichever of them is on his high week, so she is ALREADY getting
//   19 every week and the 17 is worth exactly nothing. That is Tim's own
//   complaint — "getting a 19 proj QB doesn't really change my team" — built
//   into a fixture, and the Ana/Bo offer must therefore exist on the scalar
//   basis and be GONE on the weekly one.
//
//   Ana ↔ Cy is flat on both sides, so it survives both measures and the table
//   is never empty. Cy is thin at tight end AND at defence, and has backs and
//   receivers to spare; Ana is the other way round. Two holes rather than one
//   is what lets two DISJOINT Ana/Cy deals both be worth making, which is what
//   puts a merged row — two trades with one manager, shown as one offer — on
//   the page at all.
//
//   Di is filler: a balanced squad with a junk bench, so the league is four
//   teams rather than two.
//
// THREE MORE THINGS ARE BUILT IN, each so that an assertion about them can
// actually FAIL rather than passing by luck:
//
//   A PLAYED WEEK THAT WOULD CHANGE THE ANSWER. Cy's tight end projects 30 in
//   weeks 1-4 and 4 from week 5 on. Weeks 1-4 have results against them, so a
//   trade cannot reach them and none of those 30s may show up in any number on
//   the page. If the span ever slips back to including a played week — which is
//   exactly what it used to do, when the page opened on the last week PLAYED —
//   Cy stops looking thin at tight end for that week and the Ana/Cy deal is
//   priced differently. The test prices both spans and insists they differ,
//   so "played weeks are excluded" is falsifiable rather than decorative.
//
//   A BYE, IN AN UNPLAYED WEEK. `Bills D/ST` projects 11 in every week of the
//   span except week 8, where ESPN returns 0.00. Nine weeks are priced, so his
//   per-week figure must be 88 / 8 = 11.0 — not 88 / 9 = 9.8. Hand-computable,
//   and far enough apart that a page still dividing by the whole span cannot
//   round into agreement.
//
//   A D/ST WORTH TRADING. Ana carries TWO defences: she starts the 12 and the
//   11 sits on her bench, and Cy is on a 2. That is what puts a defence into a
//   rendered package at all, so the "no position tag on a D/ST" rule has
//   something to be tested against — and they are named the way ESPN names
//   them (`"<Franchise> D/ST"`, per docs/espn-draft-api.md), which is the whole
//   reason the tag is redundant.
//
// `calls` counts what the page actually spends, which is what the cost note is
// tested against. One request per week, and no bulk form — the same rule the
// real module documents.

export const calls = { schedule: 0, week: [], weeks: [] };

// FOURTEEN, not thirteen, and that is the point of the number.
//
// Tim's real league plays 14 regular-season matchups. The trade page used to
// cap its weekly span at week 13, citing a rule that claimed ESPN published
// nothing beyond it — a rule that turned out to be wrong. With a 13-week
// fixture that cap was invisible: the span ended at 13 either way, so the suite
// passed whether the page read the schedule or ignored it.
//
// At 14 the cap becomes visible. A page still enforcing it drops week 14 from
// every span, every request count and every offer it prices.
export const WEEKS = 14;
export const PLAYED_THROUGH = 4;   // so useLive() opens on week 5, the coming week
export const LEAGUE = '476225250';
export const SEASON = 2026;

const SLOT = { QB: 0, RB: 2, WR: 4, TE: 6, FLEX: 23, DST: 16, K: 17, BE: 20 };
const LABEL = { 0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 23: 'FLEX', 16: 'D/ST', 17: 'K', 20: 'BE' };

const flat = (v) => () => v;
/** 19 on odd weeks and 7 on even, or the other way round. Mean is the same. */
const swing = (hi, lo, oddHigh) => (w) => ((w % 2 === 1) === oddHigh ? hi : lo);
/** Loud in the weeks that are already played, ordinary in the ones that are not. */
const spike = (played, rest) => (w) => (w <= PLAYED_THROUGH ? played : rest);
/** ESPN's 0.00 for a bye — a real number, and not the same thing as a null. */
const bye = (v, week) => (w) => (w === week ? 0 : v);

/** The one unplayed week `Bills D/ST` is off. Named so a test can import it. */
export const BYE_WEEK = 8;

/** name, position, slot, the weekly projection, and the season mean per game. */
const P = (name, position, slot, week, mean) => ({ name, position, slot, week, mean });

export const TEAMS = [
  {
    id: 1,
    name: 'Ana',
    players: [
      P('Ana QB1', 'QB', SLOT.QB, swing(19, 7, true), 13),
      P('Ana RB1', 'RB', SLOT.RB, flat(14), 14),
      P('Ana RB2', 'RB', SLOT.RB, flat(13), 13),
      P('Ana WR1', 'WR', SLOT.WR, flat(14), 14),
      P('Ana WR2', 'WR', SLOT.WR, flat(12), 12),
      P('Ana TE1', 'TE', SLOT.TE, flat(12), 12),
      P('Ana WR3', 'WR', SLOT.FLEX, flat(12), 12),
      // Named as ESPN names one. The position is IN the name, which is the
      // whole of Tim's fourth ask.
      P('Ravens D/ST', 'DST', SLOT.DST, flat(12), 12),
      P('Ana K', 'K', SLOT.K, flat(7), 7),
      P('Ana QB2', 'QB', SLOT.BE, swing(19, 7, false), 13),
      P('Ana TE2', 'TE', SLOT.BE, flat(11), 11),
      P('Ana WR4', 'WR', SLOT.BE, flat(11), 11),
      // The second defence: on her bench, better than anyone else's starter,
      // and off in week 8. He is the man the bye arithmetic is checked on.
      P('Bills D/ST', 'DST', SLOT.BE, bye(11, BYE_WEEK), 11),
    ],
  },
  {
    id: 2,
    name: 'Bo',
    players: [
      P('Bo QB1', 'QB', SLOT.QB, flat(17), 17),
      P('Bo RB1', 'RB', SLOT.RB, flat(13), 13),
      P('Bo RB2', 'RB', SLOT.RB, flat(12), 12),
      P('Bo WR1', 'WR', SLOT.WR, flat(6), 6),
      P('Bo WR2', 'WR', SLOT.WR, flat(5), 5),
      P('Bo TE1', 'TE', SLOT.TE, flat(10), 10),
      P('Bo RB3', 'RB', SLOT.FLEX, flat(11), 11),
      P('Bears D/ST', 'DST', SLOT.DST, flat(7), 7),
      P('Bo K', 'K', SLOT.K, flat(7), 7),
      P('Bo QB2', 'QB', SLOT.BE, flat(14), 14),
      P('Bo WR3', 'WR', SLOT.BE, flat(4), 4),
      P('Bo RB4', 'RB', SLOT.BE, flat(4), 4),
    ],
  },
  {
    id: 3,
    name: 'Cy',
    players: [
      P('Cy QB1', 'QB', SLOT.QB, flat(15), 15),
      P('Cy RB1', 'RB', SLOT.RB, flat(17), 17),
      P('Cy RB2', 'RB', SLOT.RB, flat(16), 16),
      P('Cy WR1', 'WR', SLOT.WR, flat(16), 16),
      P('Cy WR2', 'WR', SLOT.WR, flat(15), 15),
      // Loud in the weeks already played, and ordinary in the ones a trade
      // can actually reach. See the note at the top of this file.
      P('Cy TE1', 'TE', SLOT.TE, spike(30, 4), 4),
      P('Cy WR3', 'WR', SLOT.FLEX, flat(16), 16),
      // Cy is thin at DEFENCE as well as at tight end, and that is what puts
      // Ana's spare D/ST into a rendered package — without it no defence ever
      // reaches the screen and the "no position tag on a D/ST" rule has
      // nothing to be tested against.
      P('Colts D/ST', 'DST', SLOT.DST, flat(2), 2),
      P('Cy K', 'K', SLOT.K, flat(7), 7),
      P('Cy RB3', 'RB', SLOT.BE, flat(15), 15),
      P('Cy WR4', 'WR', SLOT.BE, flat(5), 5),
      P('Cy QB2', 'QB', SLOT.BE, flat(6), 6),
    ],
  },
  {
    id: 4,
    name: 'Di',
    players: [
      P('Di QB1', 'QB', SLOT.QB, flat(12), 12),
      P('Di RB1', 'RB', SLOT.RB, flat(12), 12),
      P('Di RB2', 'RB', SLOT.RB, flat(11), 11),
      P('Di WR1', 'WR', SLOT.WR, flat(11), 11),
      P('Di WR2', 'WR', SLOT.WR, flat(10), 10),
      P('Di TE1', 'TE', SLOT.TE, flat(9), 9),
      P('Di WR3', 'WR', SLOT.FLEX, flat(10), 10),
      P('Dolphins D/ST', 'DST', SLOT.DST, flat(7), 7),
      P('Di K', 'K', SLOT.K, flat(7), 7),
      P('Di QB2', 'QB', SLOT.BE, flat(6), 6),
      P('Di RB3', 'RB', SLOT.BE, flat(5), 5),
      P('Di WR4', 'WR', SLOT.BE, flat(5), 5),
    ],
  },
];

/** ESPN's own id, the way the real payload carries it: team * 100 + slot index. */
export const playerId = (teamId, i) => teamId * 100 + i;

/** Every id on one squad — what the ESPN deep link is allowed to name. */
export function rosterIds(teamId) {
  const team = TEAMS.find((t) => t.id === teamId);
  return team ? team.players.map((_, i) => playerId(teamId, i)) : [];
}

/** What the stub says ESPN projects for one man in one week. */
export function projectionFor(teamId, i, week) {
  const team = TEAMS.find((t) => t.id === teamId);
  return team ? team.players[i].week(week) : null;
}

/**
 * A WAIVER MOVE IN THE COMING WEEK, only when TR_PICKUP is set.
 *
 * Ana drops `Ana WR4` (id 111) and picks up `Ana WR Pickup` (id 150) for
 * week PLAYED_THROUGH + 1 onwards — same slot, same numbers, a new man. That
 * is the whole of it: the prices do not move, so the only thing that can
 * differ is WHICH man the page names. A page reading the last PLAYED week's
 * rosters still offers the dropped 111 and has never heard of 150; a page on
 * the coming week offers 150 and cannot name 111. Unset, nothing changes and
 * every other scenario is untouched.
 */
export const PICKUP = { dropped: 111, added: 150, name: 'Ana WR Pickup' };

function pickupApplies(team, i, week) {
  return !!process.env.TR_PICKUP && team.id === 1 && i === PICKUP.dropped - 100 &&
    week > PLAYED_THROUGH;
}

/**
 * THE BYE-IN-A-MEETING-WEEK FIXTURE (2026-09-29), both halves off unless set.
 *
 * `TR_PRO_SPLIT` gives each squad its own NFL team (team id = pro team id), so
 * one squad's men can be on bye while the other's are not. `TR_MEET` is a comma
 * list of weeks in which Ana plays CY (and Bo plays Di) instead of the usual
 * Ana-Bo / Cy-Di pairing, so the finder's Ana-Cy deals have meeting weeks.
 */
const PRO_ABBREV = { 1: 'BUF', 2: 'CHI', 3: 'IND', 4: 'MIA' };
const proSplit = () => !!process.env.TR_PRO_SPLIT;
const meetWeeks = () => new Set(String(process.env.TR_MEET || '').split(',')
  .map((w) => Number(w)).filter((w) => Number.isFinite(w) && w > 0));

function injuredAs(id) {
  for (const pair of String(process.env.TR_INJURED || '').split(',')) {
    const [pid, status] = pair.split(':');
    if (status && Number(pid) === id) return status;
  }
  return null;
}

/**
 * THE PRESEASON ARROWS (Tim, 2026-09-29), off unless `TR_TREND` is set.
 *
 * Five stub men take a real ESPN id from the committed preseason copy
 * (data/baselines/2026-preseason.json) and keep their stub names and flat
 * projections. The league is half PPR (`fetchSchedule` below), so by hand
 * (tests/test-proj-trend.mjs) the preseason per week and the arrow are:
 *   105 Ana TE1      → Tyler Warren  9.9, flat 12 = +2.1  green ▲ (the edge)
 *   107 Ravens D/ST  → Ravens D/ST   7.0, flat 12 = +5.0  green ▲
 *   108 Ana K        → Wil Lutz      8.0, flat 7  = −1.0  none
 *   309 Cy RB3       → Jahmyr Gibbs 19.7, flat 15 = −4.7  red ▼
 *   303 Cy WR1       → Puka Nacua   17.2, flat 16 = −1.2  none
 * Every other man keeps a stub id the copy has never heard of: no arrow.
 */
export const TREND_IDS = {
  105: { id: 4431459, want: 'up' },
  107: { id: -16033, want: 'up' },
  108: { id: 2985659, want: null },
  309: { id: 4429795, want: 'down' },
  303: { id: 4426515, want: null },
};
const trendId = (id) => (process.env.TR_TREND && TREND_IDS[id] ? TREND_IDS[id].id : id);

import { pathToFileURL as toUrl } from 'node:url';
import nodePath from 'node:path';
import { REPO as ROOT } from './repo.mjs';
// The same module the page imports, so the page and the stub agree on ESPN's
// default rules; the league's own are those with a catch cut to half a point.
const { DEFAULT_PPR } = await import(toUrl(nodePath.join(ROOT, 'js/proj-trend.js')).href);
export const HALF_PPR = DEFAULT_PPR.map((it) => (it.statId === 53
  ? { statId: 53, points: 0, pointsOverrides: { 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5 } }
  : it));

/**
 * THE WEEK IN PROGRESS (Tim, 2026-10-04: "any games that are completely
 * finished are counted … for singular players that have finished their game,
 * their numbers are individually updated"), only when `TR_PROGRESS` is set.
 *
 * Week PLAYED_THROUGH + 1 is then under way, in js/season.js's own contract for
 * a week ESPN has not yet marked final — every player carries `done`, and a
 * finished man also `pregame` (the projection as it was) with `projected`
 * OVERWRITTEN by his score:
 *
 *   TR_PROGRESS=1      Ana and Bo: every starter has finished, so their matchup
 *                      is `early: true, played: true` with a winner — ONE GAME
 *                      OF TWO decided. Cy: his QB and first RB have finished,
 *                      `Cy WR1` is mid-game (`done:false` with a RUNNING
 *                      `actual` — not a result), the rest have not kicked off.
 *                      Di: his QB has finished. `Ana QB2`, on her bench, is
 *                      mid-game too. Cy–Di carries running scores, not played.
 *   TR_PROGRESS=quiet  nobody's starter has played: only `Ana TE2`, on her
 *                      bench, has finished. No matchup shows a point and the
 *                      schedule is exactly the ordinary one — the week is under
 *                      way and only the rosters say so.
 *
 * A man with no game is `done` as well, in any week not yet final: `Bills D/ST`
 * in his bye (week 8), with a `pregame` of 0 and no `actual`. Weeks 1–4 are
 * final and carry neither field, as before; unset, nothing here changes.
 *
 * A finished man scores projection × 1.5 + 1 — far from his projection and from
 * the 0.9 the played weeks use, so a test can tell the three numbers apart.
 */
export const LIVE_WEEK = PLAYED_THROUGH + 1;
const progress = () => process.env.TR_PROGRESS || '';
const r1 = (v) => Math.round(v * 10) / 10;
export const doneScore = (proj) => r1(proj * 1.5 + 1);
export const runningScore = (proj) => r1(proj * 0.3);

/** 'done' | 'mid' | 'wait' for one man in the week in progress. */
export function liveStatus(teamId, i) {
  const team = TEAMS.find((t) => t.id === teamId);
  const spec = team && team.players[i];
  if (!spec || !progress()) return 'wait';
  const bench = spec.slot === SLOT.BE;
  if (progress() === 'quiet') return spec.name === 'Ana TE2' ? 'done' : 'wait';
  if (spec.name === 'Ana QB2' || spec.name === 'Cy WR1') return 'mid';
  if (teamId === 1 || teamId === 2) return bench ? 'wait' : 'done';
  if (spec.name === 'Cy QB1' || spec.name === 'Cy RB1' || spec.name === 'Di QB1') return 'done';
  return 'wait';
}

// One NFL "team" per state, so the kickoffs and games below agree with the
// rosters: 11 has finished, 12 is playing, 13 kicks off tomorrow, and 14 is
// `Bills D/ST`'s own (it kicks off tomorrow too, and is off in BYE_WEEK).
const PROGRESS_PRO = { done: 11, mid: 12, wait: 13 };
const HOUR = 3600000;
const progressPro = (team, i) =>
  (team.players[i].name === 'Bills D/ST' ? 14 : PROGRESS_PRO[liveStatus(team.id, i)]);

/** When pro team `t` kicks off in `week`, or null for no game. Relative to now. */
function progressKickoff(t, week, now) {
  if (t === 14 && week === BYE_WEEK) return null;
  const first = { 11: -5 * HOUR, 12: -1 * HOUR, 13: 24 * HOUR, 14: 24 * HOUR }[t];
  return now + first + (week - LIVE_WEEK) * 7 * 24 * HOUR;
}

/** The contract's fields for one man in one week not yet final. */
function progressFields(team, i, week, proj) {
  if (!progress() || week <= PLAYED_THROUGH) return {};
  if (team.players[i].name === 'Bills D/ST' && week === BYE_WEEK) {
    return { done: true, pregame: proj, projected: 0, actual: null };
  }
  if (week !== LIVE_WEEK) return { done: false };
  const s = liveStatus(team.id, i);
  if (s === 'done') return { done: true, pregame: proj, projected: doneScore(proj), actual: doneScore(proj) };
  if (s === 'mid') return { done: false, actual: runningScore(proj) };
  return { done: false };
}

function playersFor(team, week) {
  return team.players.map((spec, i) => ({
    playerId: pickupApplies(team, i, week) ? PICKUP.added : trendId(playerId(team.id, i)),
    name: pickupApplies(team, i, week) ? PICKUP.name : spec.name,
    position: spec.position,
    proTeam: proSplit() ? PRO_ABBREV[team.id] : 'BUF',
    proTeamId: progress() ? progressPro(team, i) : proSplit() ? team.id : 1,
    lineupSlotId: spec.slot,
    slot: LABEL[spec.slot],
    started: spec.slot !== SLOT.BE,
    projected: spec.week(week),
    // A played week has a result; a week still to come does not. That is what
    // the card's Act row reads, and it must stay a fact about the DATA rather
    // than about the calendar.
    actual: week <= PLAYED_THROUGH ? Math.round(spec.week(week) * 0.9 * 10) / 10 : null,
    seasonProjected: spec.mean * 17,
    // `TR_INJURED` ("112:QUESTIONABLE,304:INJURY_RESERVE") puts named men on
    // the injury report; unset, everybody is ACTIVE as before.
    injuryStatus: injuredAs(playerId(team.id, i)) || 'ACTIVE',
    percentOwned: null,
    ...progressFields(team, i, week, spec.week(week)),
  }));
}

/** A squad's starters' points on the board in `week` (TR_PROGRESS's schedule). */
function boardScore(teamId, week) {
  const team = TEAMS.find((t) => t.id === teamId);
  return r1(playersFor(team, week)
    .filter((p) => p.started && typeof p.actual === 'number')
    .reduce((a, p) => a + p.actual, 0));
}

export async function fetchWeekRosters(week) {
  calls.week.push(week);
  // `TR_WEEK_DELAY` ms per week, like a network. With every read instant, the
  // page's reads finish before its first search starts and a search that runs
  // too early is invisible — which is exactly how the double weekly search
  // (trade plan Phase 3) hid from this suite while it cost a real load a minute.
  const delay = Number(process.env.TR_WEEK_DELAY) || 0;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  const teams = TEAMS.map((team) => {
    const players = playersFor(team, week);
    const starters = players.filter((p) => p.started);
    const bench = players.filter((p) => !p.started);
    const total = (arr, key) => {
      const vals = arr.map((p) => p[key]).filter((v) => typeof v === 'number');
      return vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) * 10) / 10 : null;
    };
    return {
      id: team.id,
      name: team.name,
      teamName: `${team.name}'s squad`,
      abbrev: team.name.slice(0, 2).toUpperCase(),
      players,
      starters,
      bench,
      projectedTotal: total(starters, 'projected'),
      actualTotal: total(starters, 'actual'),
      benchActualTotal: total(bench, 'actual'),
      seasonProjectedTotal: total(starters, 'seasonProjected'),
    };
  });
  return { week, teams };
}

/**
 * One request per week, exactly as the real module does it — the count is the
 * point of this stub, so nothing here is batched away.
 */
export async function fetchWeeksRosters(weeks, { onProgress } = {}) {
  calls.weeks.push([...weeks]);
  const out = new Map();
  let done = 0;
  for (const week of weeks) {
    const { teams } = await fetchWeekRosters(week);
    out.set(week, teams);
    done++;
    if (onProgress) onProgress(done, weeks.length, week);
  }
  return out;
}

export async function fetchSchedule() {
  calls.schedule++;
  const weeks = Array.from({ length: WEEKS }, (_, i) => i + 1);
  const games = [];
  const swap = meetWeeks();
  for (const week of weeks) {
    const played = week <= PLAYED_THROUGH;
    games.push(...(swap.has(week)
      ? [{ week, homeId: 1, awayId: 3, played }, { week, homeId: 2, awayId: 4, played }]
      : [{ week, homeId: 1, awayId: 2, played }, { week, homeId: 3, awayId: 4, played }]));
  }
  // TR_PROGRESS=1: the scores a real schedule carries — final ones on the
  // played weeks, and in the week in progress Ana–Bo final EARLY (every starter
  // on both sides has finished) while Cy–Di shows running scores and no result.
  if (progress() === '1') {
    for (const g of games) {
      if (g.week > LIVE_WEEK) continue;
      g.homeScore = boardScore(g.homeId, g.week);
      g.awayScore = boardScore(g.awayId, g.week);
      const early = g.week === LIVE_WEEK && g.homeId === 1;
      if (early) { g.early = true; g.played = true; }
      if (g.played) {
        g.margin = r1(g.homeScore - g.awayScore);
        g.winner = g.homeScore > g.awayScore ? 'home' : g.awayScore > g.homeScore ? 'away' : 'tie';
      }
    }
  }
  return {
    // TR_TREND: the league's scoring rules, as js/season.js keeps them.
    ...(process.env.TR_TREND ? { scoringItems: HALF_PPR } : {}),
    leagueName: 'Stub League',
    // The trade rules, as espn.parseTrades hands them over. TR_DEADLINE (epoch
    // ms) sets a deadline; unset, ESPN "did not say" and the page says nothing.
    trades: process.env.TR_DEADLINE
      ? { deadline: Number(process.env.TR_DEADLINE), reviewHours: 24 }
      : null,
    teams: TEAMS.map((t) => ({ id: t.id, name: t.name })),
    weeks,
    byWeek: new Map(),
    games,
  };
}

/**
 * The bye-week map, keyed by pro team id (every stub player is team 1).
 *
 * TR_BYES unset means "unknown" — `{}` — which keeps the old reading, a live
 * 0.00 is a bye, and so every scenario that predates the rule is unchanged. Set
 * it to put team 1's bye somewhere else, and `Bills D/ST`'s week-8 zero stops
 * being a bye: it is then a real zero, and it counts in his per-week figure.
 */
export async function fetchByeWeeks() {
  const raw = process.env.TR_BYES || '';
  return raw ? JSON.parse(raw) : {};
}

/**
 * NFL kickoffs for the "accept by" line, only when `TR_KICKOFFS` is set (epoch
 * ms of pro team 1's week-5 kickoff, the coming week). Pro team t kicks off
 * (t − 1) days after team 1 each week, a week apart, so with TR_PRO_SPLIT Ana's
 * men (team 1) are first and Cy's (team 3) two days later. `TR_KICK_BYE`
 * ("3:5") leaves team 3 without a game in week 5. Unset: `{}`, unknown, and
 * every other scenario draws no line.
 */
export const KICK_DAY = 86400000;
export async function fetchProKickoffs() {
  if (progress()) {
    const now = Date.now();
    const out = {};
    for (const t of [11, 12, 13, 14]) {
      out[t] = {};
      for (let w = 1; w <= WEEKS + 3; w++) {
        const at = progressKickoff(t, w, now);
        if (at !== null) out[t][w] = at;
      }
    }
    return out;
  }
  const anchor = Number(process.env.TR_KICKOFFS);
  if (!anchor) return {};
  const [byeTeam, byeWeek] = String(process.env.TR_KICK_BYE || '').split(':').map(Number);
  const out = {};
  for (const t of [1, 2, 3, 4]) {
    out[t] = {};
    for (let w = 1; w <= WEEKS + 3; w++) {
      if (t === byeTeam && w === byeWeek) continue;
      out[t][w] = anchor + (w - (PLAYED_THROUGH + 1)) * 7 * KICK_DAY + (t - 1) * KICK_DAY;
    }
  }
  return out;
}

/**
 * The NFL's games, `{ [proTeamId]: { [week]: { at, done } } }` as
 * `season.fetchProGames` hands them over — only under TR_PROGRESS=1, where the
 * page plays the week in progress out from its score so far. `{}` otherwise
 * (and under `quiet`): unknown, and no week is treated as in progress.
 */
export async function fetchProGames() {
  if (progress() !== '1') return {};
  const now = Date.now();
  const out = {};
  for (const t of [11, 12, 13, 14]) {
    out[t] = {};
    for (let w = 1; w <= WEEKS + 3; w++) {
      const at = progressKickoff(t, w, now);
      if (at !== null) out[t][w] = { at, done: w < LIVE_WEEK || (w === LIVE_WEEK && t === 11) };
    }
  }
  return out;
}

export async function fetchSeasonData() {
  throw new Error('fetchSeasonData is not used by the Trade page');
}
