// THE WEEK RECAP: one finished week, as it was when it finished.
//
// Tim, 2026-10-19: "I want you to make a weekly summary where you can choose
// which week it's summarizing. This will give relavent pices of information
// that are only core to this week. It will not only give facts about the
// fantasy league but also facts about player performances and avgs accross the
// board. Talk about new injuries (and how long theyll be out), Major
// busts/booms, each users missed points (reasonably and perfect foresight), and
// anything else you think is relevant to a weekly summary. Make sure that
// you're taking the summary informatoin off of that week after it was
// completely over (all week 1 games finished=week 1 summary)."
//
// PURE: no DOM, no fetching. js/week-summary-page.js gathers the inputs and
// draws the result. Every rule lives here so tests/test-week-summary.mjs can
// check it on fixtures.
//
// WHAT ESPN KEEPS, measured on public league 1241838 on 2026-10-19:
//   - a past week's roster read carries each man's projection FOR THAT WEEK
//     (statSourceId 1, scoringPeriodId = week) and what he scored. Both exact.
//   - `injuryStatus` on any roster read is TODAY's, identical in the week-1 and
//     the week-7 read for all 174 men. ESPN keeps no injury history, so the
//     page snapshots it (js/store.js `writeWeekSummary`) and reconstructs what
//     no snapshot holds — see `newInjuries`.

import { optimalLineup, slotsFromCounts } from './forecast.js';
import { slotCountsFromLineups } from './projection.js';
import { standingsKey } from './capture.js';
import { healthy, injuryLabel } from './injury.js';

const IR_SLOT = 21;
const round1 = (n) => Math.round(n * 10) / 10;
const num = (v) => typeof v === 'number' && Number.isFinite(v);
const pts = (p) => (num(p && p.actual) ? p.actual : 0);
const mean = (xs) => (xs.length ? xs.reduce((a, v) => a + v, 0) / xs.length : null);

/** The positions the recap reports, in the order ESPN lists them. */
export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];

/** Booms and busts listed. */
export const LIST_N = 5;

/** A bust needs an expectation: below this projection a quiet day is not news. */
export const BUST_MIN_PROJ = 5;

/** A free agent is "notable" from this projection, or from NOTABLE_FA_PTS scored. */
export const NOTABLE_FA_PROJ = 5;
export const NOTABLE_FA_PTS = 15;

// ------------------------------------------------------------ which weeks

/**
 * THE WEEKS THAT ARE COMPLETELY OVER, oldest first.
 *
 * A week counts only when ESPN has DECIDED every matchup in it — the `played`
 * flag js/season.js reads off ESPN's own winner, which is also what js/store.js
 * freezes a week on (`final`) — and not merely settled early by this site
 * (`early: true`, every starter of ONE game finished while others play on).
 * When the NFL schedule is known (`proGames`, js/espn.js `parseProGames`),
 * every NFL game of the week must also be official (`done`): a Monday game
 * still being played keeps the week out.
 *
 * @param {Array} games the regular season, `{week, played, early?}`
 * @param {Object} [proGames] `{ [proTeamId]: { [week]: { at, done } } }`; `{}` or null = unknown
 * @returns {number[]}
 */
export function completedWeeks(games, proGames = null) {
  const byWeek = new Map();
  for (const g of games || []) {
    if (!g || !Number.isFinite(Number(g.week))) continue;
    const w = Number(g.week);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(g);
  }
  const proKnown = proGames && typeof proGames === 'object' && Object.keys(proGames).length > 0;
  const nflOver = (w) => {
    if (!proKnown) return true;
    let any = false;
    for (const byWeek2 of Object.values(proGames)) {
      const g = byWeek2 && byWeek2[w];
      if (!g) continue;
      any = true;
      if (g.done !== true) return false;
    }
    return any;
  };
  return [...byWeek.keys()].sort((a, b) => a - b).filter((w) =>
    byWeek.get(w).every((g) => g.played === true && g.early !== true) && nflOver(w));
}

/**
 * WHEN TODAY'S INJURY STATUSES STILL DESCRIBE `week`'s END: until the next
 * week's first kickoff. Has any NFL game of the week after `week` kicked off? Unknown (no NFL
 * schedule read) counts as yes: today's statuses are then not trusted.
 */
export function nextUnderWay(pro, week, now = Date.now()) {
  if (!pro || typeof pro !== 'object' || !Object.keys(pro).length) return true;
  return Object.values(pro).some((byWeek) => {
    const g = byWeek && byWeek[week + 1];
    return !!g && Number.isFinite(g.at) && g.at <= now;
  });
}

// ------------------------------------------------------------ missed points

/** The league's starting slots, read off the week's own lineups. */
export function slotsOf(teams) {
  return slotsFromCounts(slotCountsFromLineups(teams));
}

/**
 * ONE MANAGER'S MISSED POINTS.
 *
 *   reasonable  the best legal lineup by ESPN's projections for the week (the
 *               numbers known before kickoff), scored by what those men
 *               actually scored, minus what he scored. Negative when his own
 *               choices beat the projections.
 *   perfect     the best legal lineup by what every man actually scored,
 *               minus what he scored. Never negative.
 *
 * Men in the IR slot are left out: they could not have been started. A man
 * with no score that week scores 0. Lineups are `forecast.optimalLineup`, the
 * site's one best-lineup rule.
 */
export function missedPoints(team, slots) {
  const players = ((team && team.players) || []).filter((p) => p && p.lineupSlotId !== IR_SLOT);
  const scored = round1(players.filter((p) => p.started).reduce((a, p) => a + pts(p), 0));
  const byProj = optimalLineup(players.map((p) => ({ ...p, projected: num(p.projected) ? p.projected : 0 })), slots);
  const reasonable = round1(byProj.starters.reduce((a, p) => a + pts(p), 0));
  const best = optimalLineup(players.map((p) => ({ ...p, projected: pts(p) })), slots);
  const perfect = best.total;
  // Who would have come in, and who gone out, for each lineup.
  const swaps = (chosen) => {
    const inIds = new Set(chosen.map((p) => p.playerId));
    return {
      in: chosen.filter((p) => !p.started).map((p) => ({ name: p.name, pts: pts(p) })),
      out: players.filter((p) => p.started && !inIds.has(p.playerId)).map((p) => ({ name: p.name, pts: pts(p) })),
    };
  };
  return {
    teamId: team.id,
    name: team.name,
    scored,
    reasonable,
    perfect,
    missedReasonable: round1(reasonable - scored),
    missedPerfect: round1(perfect - scored),
    swapsReasonable: swaps(byProj.starters),
    swapsPerfect: swaps(best.starters),
  };
}

// ------------------------------------------------------------ booms, busts

/**
 * THE BIGGEST OVER- AND UNDER-PERFORMERS against ESPN's projection for the week.
 *
 * Who is in: every man on a roster that week with a projection above 0 (a man
 * ruled out or on bye was projected 0 and is not a bust), plus free agents
 * that week who were notable — projected NOTABLE_FA_PROJ or more, or scoring
 * NOTABLE_FA_PTS or more. A rostered man with no score scored 0. A bust must
 * have been projected BUST_MIN_PROJ or more.
 *
 * @param {Array} rostered `{playerId, name, position, projected, actual, owner}`
 * @param {Array} [freeAgents] same shape, owner null
 * @returns {{booms:Array, busts:Array}} each row adds `diff`
 */
export function boomsBusts(rostered, freeAgents = [], n = LIST_N) {
  const rows = [];
  for (const p of rostered || []) {
    if (!p || !num(p.projected) || p.projected <= 0) continue;
    rows.push({ ...p, actual: pts(p), diff: round1(pts(p) - p.projected) });
  }
  for (const p of freeAgents || []) {
    if (!p || !num(p.projected) || !num(p.actual)) continue;
    if (p.projected < NOTABLE_FA_PROJ && p.actual < NOTABLE_FA_PTS) continue;
    rows.push({ ...p, owner: null, diff: round1(p.actual - p.projected) });
  }
  const booms = rows.filter((r) => r.diff > 0)
    .sort((a, b) => b.diff - a.diff || b.actual - a.actual).slice(0, n);
  const busts = rows.filter((r) => r.diff < 0 && r.projected >= BUST_MIN_PROJ)
    .sort((a, b) => a.diff - b.diff || a.actual - b.actual).slice(0, n);
  return { booms, busts };
}

// ------------------------------------------------------------ positions

/**
 * EACH POSITION THAT WEEK.
 *
 *   top       the best score at the position among every player read
 *   topAvg    the average of the top `depth` scores, where depth is the number
 *             of teams (QB, TE, K, D/ST) or twice it (RB, WR): roughly the men
 *             a league this size starts there
 *   startAvg  what this league's started men at the position averaged, and
 *   startProj what ESPN had projected them
 *
 * @param {Array} pool every player read for the week, `{position, actual, …}`
 * @param {Array} started this league's started men
 * @param {number} teamCount
 */
export function positionTable(pool, started, teamCount) {
  const out = [];
  for (const pos of POSITIONS) {
    const scored = (pool || []).filter((p) => p && p.position === pos && num(p.actual))
      .sort((a, b) => b.actual - a.actual);
    const depth = (pos === 'RB' || pos === 'WR' ? 2 : 1) * Math.max(1, teamCount || 0);
    const topN = scored.slice(0, depth).map((p) => p.actual);
    const mine = (started || []).filter((p) => p && p.position === pos);
    const startAvg = mean(mine.map(pts));
    const startProj = mean(mine.filter((p) => num(p.projected)).map((p) => p.projected));
    out.push({
      position: pos,
      top: scored[0] || null,
      depth: topN.length,
      topAvg: topN.length ? round1(mean(topN)) : null,
      startAvg: startAvg === null ? null : round1(startAvg),
      startProj: startProj === null ? null : round1(startProj),
    });
  }
  return out;
}

// ------------------------------------------------------------ injuries

/** A status worth reporting: not healthy. */
const hurt = (s) => !healthy(s);

/**
 * WHO PICKED UP AN INJURY THAT WEEK.
 *
 * Only a man who PLAYED that week (projected above 0 and a score on the board)
 * can be newly hurt in it; a man already out never played. Then, by what is
 * known about him after the week, best first:
 *
 *   1. SNAPSHOT  `after` holds his status as saved when the week ended. New
 *                when it is not healthy and `before` (the previous week's
 *                snapshot) did not already list him. Exact to the snapshot's
 *                time.
 *   2. CURRENT   no snapshot, but this IS the latest finished week: today's
 *                status stands for the week's end (`source: 'current'`).
 *   3. RECONSTRUCTED  an older week with no snapshot: ESPN's injury status
 *                has no history, so he is listed when he missed the NEXT week
 *                — on a roster, his team playing, projected 0 and no score —
 *                with no status claimed (`source: 'reconstructed'`).
 *
 * HOW LONG HE IS OUT, never invented:
 *   - ESPN's own word (`details`: out for the season, or an expected return
 *     date), from the snapshot when it has one, else today's for a man still
 *     hurt today;
 *   - else the weeks he has actually missed since, counted from the rosters
 *     (`later`) up to the week he played again ("missed 2", exact);
 *   - else nothing: the status only.
 *
 * @param {Object} o
 * @param {Array} o.played the week's rostered men, `{playerId, name, position, projected, actual, proTeamId, owner}`
 * @param {Object|null} o.after `{ [id]: {s, type, ret, ofs} }` saved at the week's end, or null
 * @param {Object|null} o.before the same for the week before, or null
 * @param {Map|null} o.current id -> `{status, details}` today, or null
 * @param {boolean} o.isLatest this is the latest finished week
 * @param {Array<{week:number, players:Map}>} o.later the following weeks' rostered men by id, oldest first
 * @param {Object|null} o.byes `{proTeamId: byeWeek}`
 */
export function newInjuries({ played, after = null, before = null, current = null, isLatest = false, later = [], byes = null }) {
  const out = [];
  const onBye = (p, w) => !!byes && p.proTeamId !== null && p.proTeamId !== undefined &&
    Number(byes[p.proTeamId]) === Number(w);
  // Weeks missed in a row after the week, and whether he has played since.
  const missedRun = (p) => {
    let missed = 0;
    for (const { week, players } of later || []) {
      const q = players && players.get(String(p.playerId));
      if (!q) return { missed, back: null };          // off every roster: not known
      if (onBye(q, week)) continue;
      if (num(q.actual) && (q.projected > 0 || q.actual !== 0)) return { missed, back: week };
      missed++;
    }
    return { missed, back: null };
  };

  for (const p of played || []) {
    if (!p || !(num(p.projected) && p.projected > 0) || !num(p.actual)) continue;
    const id = String(p.playerId);
    let status = null;
    let source = null;
    let saved = null;
    if (after) {
      saved = after[id] || null;
      status = saved ? saved.s : 'ACTIVE';
      source = 'snapshot';
    } else if (isLatest && current) {
      status = (current.get(id) && current.get(id).status) || 'ACTIVE';
      source = 'current';
    }
    const run = missedRun(p);
    if (status !== null) {
      if (!hurt(status)) continue;
      const was = before ? (before[id] ? before[id].s : 'ACTIVE') : null;
      if (was !== null && hurt(was)) continue;
    } else {
      // Reconstructed: he missed the very next week.
      const next = (later || [])[0];
      const q = next && next.players && next.players.get(id);
      // ESPN files a man who sat out as 0.0 scored, not as no line (measured on
      // 1241838, week 6: Montgomery, Warren, Love all 0.0 projected and scored).
      if (!q || onBye(q, next.week) || (num(q.actual) && q.actual !== 0) || (num(q.projected) && q.projected > 0)) continue;
      source = 'reconstructed';
    }
    const now = current && current.get(id);
    const stillHurt = !!now && hurt(now.status);
    const word = saved && (saved.ofs !== undefined || saved.ret) ? { outForSeason: saved.ofs === true, returnDate: saved.ret || null, type: saved.type || null }
      : stillHurt ? (now.details || null) : null;
    out.push({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      proTeamId: p.proTeamId ?? null,
      proTeam: p.proTeam ?? null,
      owner: p.owner,
      status,                                   // null when reconstructed
      label: status ? injuryLabel(status) : null,
      type: (saved && saved.type) || (word && word.type) || null,
      outForSeason: !!(word && word.outForSeason),
      returnDate: word && !word.outForSeason ? word.returnDate || null : null,
      missed: run.missed,
      back: run.back,                           // the week he played again, or null
      stillOut: stillHurt,
      source,
      actual: p.actual,
    });
  }
  return out.sort((a, b) => Number(b.outForSeason) - Number(a.outForSeason) ||
    (b.missed - a.missed) || (b.actual - a.actual));
}

/** What a snapshot keeps of a week's men: the hurt ones, `{ [id]: {s, type, ret, ofs} }`. */
export function injurySnapshot(players, details = null) {
  const out = {};
  for (const p of players || []) {
    if (!p || p.playerId === null || p.playerId === undefined || !hurt(p.injuryStatus)) continue;
    const d = (details && details.get(String(p.playerId))) || p.injuryDetails || null;
    const e = { s: String(p.injuryStatus) };
    if (d) {
      if (d.type) e.type = d.type;
      if (d.returnDate) e.ret = d.returnDate;
      if (typeof d.outForSeason === 'boolean') e.ofs = d.outForSeason;
    }
    out[String(p.playerId)] = e;
  }
  return out;
}

// ------------------------------------------------------------ the league

/** Standings after `week`: `[{teamId, w, l, t, pf, rank}]`, best first. */
export function standingsThrough(games, teamIds, week) {
  const rec = new Map((teamIds || []).map((id) => [id, { teamId: id, w: 0, l: 0, t: 0, pf: 0 }]));
  for (const g of games || []) {
    if (!g || Number(g.week) > week || g.awayId === null || g.awayId === undefined) continue;
    if (!num(g.homeScore) || !num(g.awayScore) || g.played !== true) continue;
    const h = rec.get(g.homeId);
    const a = rec.get(g.awayId);
    if (!h || !a) continue;
    h.pf += g.homeScore; a.pf += g.awayScore;
    if (g.homeScore > g.awayScore) { h.w++; a.l++; } else if (g.awayScore > g.homeScore) { a.w++; h.l++; } else { h.t++; a.t++; }
  }
  const rows = [...rec.values()].sort((x, y) => standingsKey(y, y.pf) - standingsKey(x, x.pf));
  rows.forEach((r, i) => { r.rank = i + 1; r.pf = round1(r.pf); });
  return rows;
}

/**
 * The week's games and the league's headline facts.
 *
 * `proj` is each team's projected total for the week — its STARTED lineup at
 * ESPN's projections, the number ESPN's matchup page showed before kickoff. An
 * UPSET is a win by the side projected lower.
 */
export function matchupFacts(games, proj, nameOf) {
  const rows = [];
  for (const g of games || []) {
    if (!g || g.awayId === null || g.awayId === undefined || !num(g.homeScore) || !num(g.awayScore)) continue;
    const homeWon = g.homeScore >= g.awayScore;
    const w = homeWon ? { id: g.homeId, pts: g.homeScore } : { id: g.awayId, pts: g.awayScore };
    const l = homeWon ? { id: g.awayId, pts: g.awayScore } : { id: g.homeId, pts: g.homeScore };
    const wp = proj.get(w.id);
    const lp = proj.get(l.id);
    rows.push({
      winnerId: w.id, winner: nameOf(w.id), winnerPts: w.pts, winnerProj: num(wp) ? round1(wp) : null,
      loserId: l.id, loser: nameOf(l.id), loserPts: l.pts, loserProj: num(lp) ? round1(lp) : null,
      tie: g.homeScore === g.awayScore,
      margin: round1(w.pts - l.pts),
      upset: g.homeScore !== g.awayScore && num(wp) && num(lp) && wp < lp,
    });
  }
  rows.sort((a, b) => b.winnerPts - a.winnerPts);
  const scores = rows.flatMap((r) => [{ id: r.winnerId, name: r.winner, pts: r.winnerPts }, { id: r.loserId, name: r.loser, pts: r.loserPts }]);
  const projs = rows.flatMap((r) => [r.winnerProj, r.loserProj]).filter(num);
  const by = (f) => (rows.length ? rows.slice().sort(f)[0] : null);
  return {
    games: rows,
    high: scores.length ? scores.reduce((a, s) => (s.pts > a.pts ? s : a)) : null,
    low: scores.length ? scores.reduce((a, s) => (s.pts < a.pts ? s : a)) : null,
    biggest: by((a, b) => b.margin - a.margin),
    closest: by((a, b) => a.margin - b.margin),
    avg: scores.length ? round1(mean(scores.map((s) => s.pts))) : null,
    avgProj: projs.length === scores.length && projs.length ? round1(mean(projs)) : null,
    upsets: rows.filter((r) => r.upset).length,
  };
}

// ------------------------------------------------------------ the whole week

/**
 * Everything the recap shows for one finished week.
 *
 * @param {Object} o
 * @param {number} o.week
 * @param {Array} o.games the regular season, `{week, homeId, awayId, homeScore, awayScore, played}`
 * @param {Array} o.teams the week's rosters (js/season.js `fetchWeekRosters().teams` shape)
 * @param {Array|null} o.pool every player ESPN listed for the week, `{playerId, name, position, projected, actual}`; null = rosters only
 * @param {Array} [o.moves] the week's transactions (js/espn.js `parseTransactions`)
 *   — null when they were not read (the synced copy): pickups come from `prevTeams`
 * @param {Array|null} [o.prevTeams] the week before's rosters
 * @param {Object} [o.injury] `newInjuries` inputs other than `played`
 */
export function buildWeekSummary({ week, games, teams, pool = null, moves = [], prevTeams = null, injury = {} }) {
  const nameById = new Map((teams || []).map((t) => [t.id, t.name]));
  const nameOf = (id) => nameById.get(id) || `Team ${id}`;
  const slots = slotsOf(teams);

  const rostered = [];
  const started = [];
  const ownerOf = new Map();
  for (const t of teams || []) {
    for (const p of t.players || []) {
      if (!p) continue;
      const row = { ...p, owner: t.name, teamId: t.id };
      rostered.push(row);
      ownerOf.set(String(p.playerId), t);
      if (p.started) started.push(row);
    }
  }

  const proj = new Map((teams || []).map((t) => [t.id,
    (t.players || []).filter((p) => p.started && num(p.projected)).reduce((a, p) => a + p.projected, 0)]));
  const weekGames = (games || []).filter((g) => Number(g.week) === Number(week));
  const facts = matchupFacts(weekGames, proj, nameOf);

  const ids = (teams || []).map((t) => t.id);
  const now = standingsThrough(games, ids, week);
  const prev = week > 1 ? new Map(standingsThrough(games, ids, week - 1).map((r) => [r.teamId, r.rank])) : null;
  const standings = now.map((r) => ({ ...r, name: nameOf(r.teamId), move: prev ? prev.get(r.teamId) - r.rank : null }));

  const missed = (teams || []).map((t) => missedPoints(t, slots))
    .sort((a, b) => b.missedPerfect - a.missedPerfect || b.missedReasonable - a.missedReasonable);

  const freeAgents = (pool || []).filter((p) => p && !ownerOf.has(String(p.playerId)));
  const { booms, busts } = boomsBusts(rostered.filter((p) => p.lineupSlotId !== IR_SLOT), freeAgents);
  const positions = positionTable(pool ? rostered.concat(freeAgents) : rostered, started, ids.length);

  // The best man left on a bench, and the best pickup of the week who started.
  const benched = rostered.filter((p) => !p.started && p.lineupSlotId !== IR_SLOT && num(p.actual));
  const bench = benched.length ? benched.reduce((a, p) => (p.actual > a.actual ? p : a)) : null;
  const { pickup, pickupFrom } = bestPickup(teams, ownerOf, moves, prevTeams);

  const injuries = newInjuries({ ...injury, played: rostered });

  return { week, facts, standings, missed, booms, busts, positions, injuries, bench, pickup, pickupFrom, slots };
}

/**
 * The best pickup of the week who started, and where that came from.
 *
 * `moves` (the week's transactions) decide when they were read. Without them —
 * the phone's synced copy carries none — the pickups are the started men on NO
 * roster the week before (`prevTeams`): exact for a free-agent or waiver claim,
 * and a man who came by trade (on another roster) is not one. Neither known:
 * `pickupFrom` null, and the page says it cannot tell rather than leaving a blank.
 */
function bestPickup(teams, ownerOf, moves, prevTeams) {
  let adds = null;
  let from = null;
  if (Array.isArray(moves)) {
    adds = [];
    for (const m of moves) {
      if (m && Array.isArray(m.adds)) for (const id of m.adds) adds.push({ id: String(id), teamId: m.teamId });
    }
    from = 'moves';
  } else if (Array.isArray(prevTeams) && prevTeams.length) {
    const before = new Set();
    for (const t of prevTeams) for (const p of (t && t.players) || []) if (p) before.add(String(p.playerId));
    adds = [];
    for (const t of teams || []) {
      for (const p of t.players || []) if (p && !before.has(String(p.playerId))) adds.push({ id: String(p.playerId), teamId: t.id });
    }
    from = 'rosters';
  }
  let pickup = null;
  for (const { id, teamId } of adds || []) {
    const t = ownerOf.get(id);
    if (!t || t.id !== teamId) continue;
    const p = (t.players || []).find((q) => String(q.playerId) === id);
    if (!p || !p.started || !num(p.actual)) continue;
    if (!pickup || p.actual > pickup.actual) pickup = { ...p, owner: t.name };
  }
  return { pickup, pickupFrom: from };
}
