// Decisions review: replay the season as if one decision had gone the other way.
//
// Tim, 2026-10-05: "have a list of all the decisions they've made, and what
// would have happened if they hadn't made that that decision ... Because we
// know what every single player scored every single week, we can accurately
// create these 'mirror universes' as if they were real." Full ask, the contract
// and the replay rules: docs/decisions-review-plan.md.
//
// Pure functions only — no DOM, no fetching. The page assembles one `world`
// (rosters, games, moves and every named player's weekly points) and every
// display reads the one `mirror` object this file returns, so two charts can
// never disagree about the same hypothetical.
//
// HOW A MIRROR IS BUILT. The real week rosters are the baseline and are never
// rebuilt from the move list. The replay only tracks the players whose owner in
// the mirror DIFFERS from real life (the "divergence"), stamped with the week
// each difference starts to count. A week's mirror roster is the real roster
// with those few men taken out or put in. Two things follow, both wanted:
//   - a team-week the decision never reaches is the real one, to the decimal;
//   - a move ESPN's feed does not list (a commissioner edit) cannot corrupt
//     anything, because nothing depends on the feed being complete.
//
// IDS. Player and team ids are compared with ===, so `world` must use one type
// for each throughout (ESPN's numbers).
//
// Slot eligibility comes from js/espn.js rather than being restated here, for
// the reason js/forecast.js gives: a second copy of the table is how the flex
// quietly starts accepting a quarterback.

import { optimalLineup } from './forecast.js';
import { SLOT_ELIGIBILITY, SLOT_LABELS } from './espn.js';

/**
 * The noise constants, in one table so Tim can tune them by eye. They are
 * judgement, not measurement (the plan says so), which is why none of them is
 * buried in a formula.
 */
export const NOISE = {
  touchedPerWeek: 0.10,   // teams the decision touched: 0 in the first affected week, then this much a week
  otherFreeWeeks: 2,      // everyone else: this many affected weeks with no noise at all
  otherPerWeek: 0.03,     // ...then this much a week ("the longer the weeks, the more likely")
  freedPoints: 20,        // a freed player: points over a team's weakest replaceable starter that make noise 1
  freedMax: 0.6,          // ...capped here
  dim: 0.65,              // the page's dimming: opacity = 1 - dim * noise (display only, not used in here)
};

const BENCH_SLOT = 20;
const IR_SLOT = 21;

/** "The mirror agrees with real life from here on" in a player's timeline. */
const REAL = Symbol('real');

const num = (v) => (Number.isFinite(v) ? v : 0);
// ESPN scores carry two decimals; rounding there stops 58 - 21 + 8 reading as
// 45.00000000000001 and, more to the point, stops a real tie being missed.
const round2 = (v) => Math.round(v * 100) / 100;
const sum = (list, key) => list.reduce((a, p) => a + num(p[key]), 0);
const eligible = (slotId, position) => (SLOT_ELIGIBILITY[slotId] || []).includes(position);
const breadth = (slotId) => (SLOT_ELIGIBILITY[slotId] || []).length;

function teamLabel(world, teamId) {
  const t = (world.teams || []).find((x) => x.id === teamId);
  return t ? (t.name || t.teamName || `Team ${teamId}`) : `Team ${teamId}`;
}

function playerName(world, playerId) {
  const p = world.players && world.players.get(playerId);
  return (p && p.name) || `Player ${playerId}`;
}

function realRoster(world, teamId, week) {
  const list = (world.rosters && world.rosters.get(week)) || [];
  const entry = list.find((t) => t.id === teamId);
  return entry ? entry.players || [] : [];
}

/**
 * A team's real roster for a week — the list the what-if trade pickers offer.
 * It is the roster that week was SCORED with, so a trade "this week" swaps
 * exactly the men shown.
 *
 * @returns {Array} copies of the roster entries, [] when the week is not held
 */
export function rosterAt(world, teamId, week) {
  return realRoster(world, teamId, week).map((p) => ({ ...p }));
}

/**
 * A record from a list of games. Ties are their own number, as on Summary.
 *
 * @param {Array} games each with homeId/awayId/homeActual/awayActual/week
 * @param {*} teamId
 * @param {Iterable<number>} [weeks] count only these weeks (rule 5: a week
 *        counts only when every game in it is final)
 * @returns {{w:number, l:number, t:number}}
 */
export function recordOf(games, teamId, weeks = null) {
  const only = weeks ? new Set(weeks) : null;
  const rec = { w: 0, l: 0, t: 0 };
  for (const g of games || []) {
    if (only && !only.has(g.week)) continue;
    const r = resultOf(g, teamId);
    if (r === 'W') rec.w++;
    else if (r === 'L') rec.l++;
    else if (r === 'T') rec.t++;
  }
  return rec;
}

function resultOf(g, teamId) {
  const home = g.homeId === teamId;
  if (!home && g.awayId !== teamId) return null;
  const mine = home ? g.homeActual : g.awayActual;
  const theirs = home ? g.awayActual : g.homeActual;
  if (!Number.isFinite(mine) || !Number.isFinite(theirs)) return null;
  return mine > theirs ? 'W' : mine < theirs ? 'L' : 'T';
}

// ------------------------------------------------------------------- replay

/**
 * Rule 1: the week a move starts to count for one player. A man whose NFL game
 * had already kicked off when the move was made had his week settled on the
 * roster he was on, so the move counts for him from the next week. A bye (no
 * kickoff) counts from the week of the move.
 */
function effectiveWeek(world, playerId, move) {
  const p = world.players && world.players.get(playerId);
  const kick = p && p.byWeek && p.byWeek[move.week] ? p.byWeek[move.week].kickoff : null;
  return Number.isFinite(kick) && Number.isFinite(move.at) && kick <= move.at ? move.week + 1 : move.week;
}

function kindOf(move) {
  if (move.kind) return move.kind;
  if (move.trade) return 'trade';
  const a = (move.adds || []).length;
  const d = (move.drops || []).length;
  return a && d ? 'adddrop' : a ? 'add' : 'drop';
}

/**
 * Walk the real moves in time order with one of them undone (or a what-if
 * trade slipped in), tracking only the players whose mirror owner differs
 * from the real one.
 *
 * `owner` in a timeline entry is a team id, `null` (nobody has him in the
 * mirror) or REAL (the two worlds agree again).
 *
 * @returns {{timeline:Map, skipped:Array, firstWeek:number|null, touched:Set}}
 */
function replay(world, { undoMove = null, whatIf = null }) {
  const moves = world.moves || [];
  const now = new Map();        // playerId -> mirror owner, only where it differs from real
  const timeline = new Map();   // playerId -> [{ from, owner }] in time order
  const skipped = [];
  const touched = new Set();
  let firstWeek = null;

  const stamp = (pid, from, owner) => {
    if (!timeline.has(pid)) timeline.set(pid, []);
    timeline.get(pid).push({ from, owner });
  };
  const diverge = (pid, from, owner) => { now.set(pid, owner); stamp(pid, from, owner); };
  const agree = (pid, from) => { now.delete(pid); stamp(pid, from, REAL); };
  // The real move happens, the mirror one does not: the mirror keeps whoever
  // had him. If he had already diverged, his mirror owner simply stays put.
  const stay = (pid, from, realOwnerBefore) => { if (!now.has(pid)) diverge(pid, from, realOwnerBefore); };
  const affects = (week) => { if (firstWeek === null || week < firstWeek) firstWeek = week; };

  const tradeSides = (m) => (m.trade ? [
    ...(m.trade.gives || []).map((pid) => ({ pid, from: m.teamId })),
    ...(m.trade.gets || []).map((pid) => ({ pid, from: m.trade.withTeamId })),
  ] : []);

  // The decision itself: nothing in it happens in the mirror.
  const undo = (m) => {
    touched.add(m.teamId);
    if (m.trade) touched.add(m.trade.withTeamId);
    for (const { pid, from } of tradeSides(m)) { const e = effectiveWeek(world, pid, m); affects(e); stay(pid, e, from); }
    for (const pid of m.adds || []) { const e = effectiveWeek(world, pid, m); affects(e); stay(pid, e, null); }
    for (const pid of m.drops || []) { const e = effectiveWeek(world, pid, m); affects(e); stay(pid, e, m.teamId); }
  };

  // Rule 2: a later real move, item by item.
  const apply = (m) => {
    const sides = tradeSides(m);
    if (sides.length) {
      // A trade needs every man where it expects him, or none of it happens.
      const missing = sides.find(({ pid, from }) => now.has(pid) && now.get(pid) !== from);
      if (missing) {
        skipped.push({
          moveId: m.id, teamId: m.teamId, week: m.week, playerId: missing.pid,
          reason: `${playerName(world, missing.pid)} was not on ${teamLabel(world, missing.from)}`,
        });
        touched.add(m.teamId);
        touched.add(m.trade.withTeamId);
        for (const { pid, from } of sides) stay(pid, effectiveWeek(world, pid, m), from);
      } else {
        for (const { pid } of sides) if (now.has(pid)) agree(pid, effectiveWeek(world, pid, m));
      }
    }
    for (const pid of m.adds || []) {
      if (!now.has(pid)) continue;                       // free in both worlds: the add happens
      const holder = now.get(pid);
      // Free in the mirror, or already his: either way the two worlds agree again.
      if (holder === null || holder === m.teamId) { agree(pid, effectiveWeek(world, pid, m)); continue; }
      skipped.push({
        moveId: m.id, teamId: m.teamId, week: m.week, playerId: pid,
        reason: `${playerName(world, pid)} was not free (${teamLabel(world, holder)} still had him)`,
      });
      touched.add(m.teamId);
    }
    for (const pid of m.drops || []) {
      if (!now.has(pid)) continue;                       // held in both worlds: the drop happens
      const holder = now.get(pid);
      if (holder === null || holder === m.teamId) agree(pid, effectiveWeek(world, pid, m));
      // Otherwise he is not this team's to drop in the mirror: a no-op, and the
      // add beside it still stands (it was handled on its own above).
    }
  };

  // A what-if trade is placed after the last real move that counts for its
  // week, so the men swapped are exactly the ones on that week's rosters (the
  // pickers' lists) and a waiver add earlier that week is not undone by it.
  let whatIfAfter = -1;
  if (whatIf) {
    moves.forEach((m, i) => {
      const ids = [...tradeSides(m).map((s) => s.pid), ...(m.adds || []), ...(m.drops || [])];
      if (ids.some((pid) => effectiveWeek(world, pid, m) <= whatIf.week)) whatIfAfter = i;
    });
  }
  const runWhatIf = () => {
    touched.add(whatIf.teamId);
    touched.add(whatIf.withTeamId);
    affects(whatIf.week);
    for (const pid of whatIf.gives || []) diverge(pid, whatIf.week, whatIf.withTeamId);
    for (const pid of whatIf.gets || []) diverge(pid, whatIf.week, whatIf.teamId);
  };

  if (whatIf && whatIfAfter === -1) runWhatIf();
  moves.forEach((m, i) => {
    if (undoMove && m.id === undoMove.id) undo(m);
    else apply(m);
    if (whatIf && i === whatIfAfter) runWhatIf();
  });

  return { timeline, skipped, firstWeek, touched };
}

/** Who differs from real life in one week: playerId -> mirror owner (or null). */
function divergenceAt(timeline, week) {
  const out = new Map();
  for (const [pid, entries] of timeline) {
    let owner = REAL;
    for (const e of entries) if (e.from <= week) owner = e.owner;   // time order: the last one that counts wins
    if (owner !== REAL) out.set(pid, owner);
  }
  return out;
}

// ------------------------------------------------------------------ lineups

const asStarter = (p, slotId) => ({ p, slotId });

/**
 * Rule 3: the lineup of a team whose roster differs in the mirror, changed as
 * little as possible. Real starters still on the roster keep their slots; a
 * slot a departed starter left takes the highest-projected eligible man from
 * the bench (arrivals included); an arrival otherwise starts only if his
 * projection beats the weakest starter in a slot he can fill.
 *
 * @param {Array} real the real roster
 * @param {Array} kept real roster entries still on the mirror roster
 * @param {Array} arrivals men on the mirror roster who were not on the real one
 * @param {number[]} slots the league's lineup slots
 * @returns {Array<{p:object, slotId:number}>}
 */
function minimalLineup(real, kept, arrivals, slots) {
  const keptSet = new Set(kept);
  const realStarters = real.filter((p) => p.started);
  let lineup = realStarters.filter((p) => keptSet.has(p)).map((p) => asStarter(p, p.lineupSlotId));
  const vacated = realStarters.filter((p) => !keptSet.has(p)).map((p) => p.lineupSlotId)
    .sort((a, b) => breadth(a) - breadth(b));

  // IR-slot players are not eligible to start.
  const byProjection = (a, b) => num(b.projected) - num(a.projected) || (a.playerId > b.playerId ? 1 : -1);
  let pool = [...kept.filter((p) => !p.started && p.lineupSlotId !== IR_SLOT), ...arrivals].sort(byProjection);

  let hole = false;
  const filled = [];
  for (const slotId of vacated) {
    const pick = pool.find((p) => eligible(slotId, p.position));
    if (!pick) { hole = true; break; }
    pool = pool.filter((p) => p !== pick);
    filled.push(asStarter(pick, slotId));
  }

  if (hole) {
    // The plan is silent here: a vacated slot nobody on the bench can fill
    // (his WR left and the only spare men are backs, while a WR sits in the
    // FLEX). Leaving it empty would be a lineup no manager sets, so the kept
    // starters all still start but may shift slots to let the bench in.
    const KEEP = 1e6;   // a kept starter always outranks a bench man for a slot
    const bench = [...kept.filter((p) => !p.started && p.lineupSlotId !== IR_SLOT), ...arrivals].sort(byProjection);
    const cands = [
      ...lineup.map(({ p }) => ({ ref: p, position: p.position, projected: num(p.projected) + KEEP })),
      ...bench.map((p) => ({ ref: p, position: p.position, projected: num(p.projected) })),
    ];
    lineup = optimalLineup(cands, realStarters.map((p) => p.lineupSlotId)).starters.map((s) => asStarter(s.ref, s.slotId));
    pool = bench.filter((p) => !lineup.some((s) => s.p === p));
  } else {
    lineup = [...lineup, ...filled];
  }

  // Arrivals not yet starting, best first.
  for (const a of pool.filter((p) => arrivals.includes(p))) {
    // A league slot the team has nobody in at all is his for the taking.
    const open = slots.slice();
    for (const s of lineup) { const i = open.indexOf(s.slotId); if (i !== -1) open.splice(i, 1); }
    const empty = open.filter((slotId) => eligible(slotId, a.position)).sort((x, y) => breadth(x) - breadth(y))[0];
    if (empty !== undefined) { lineup.push(asStarter(a, empty)); continue; }

    let weakest = null;
    for (const s of lineup) {
      if (!eligible(s.slotId, a.position)) continue;
      if (!weakest || num(s.p.projected) < num(weakest.p.projected)) weakest = s;
    }
    if (weakest && num(a.projected) > num(weakest.p.projected)) {
      lineup = lineup.map((s) => (s === weakest ? asStarter(a, s.slotId) : s));
    }
  }
  return lineup;
}

/**
 * Rule 4: the lineup a team "should" have set from the roster it really had.
 * `key` is 'projected' (reasonable) or 'actual' (perfect hindsight). The real
 * lineup is returned untouched whenever it already scores as well on `key`,
 * so a tie in projection counts as matching and shows no swap.
 */
function bestLineup(real, slots, key) {
  const realStarters = real.filter((p) => p.started);
  const realLineup = realStarters.map((p) => asStarter(p, p.lineupSlotId));
  // Real starters first: optimalLineup's sort is stable, so on an equal number
  // the man who really started keeps his place and no phantom swap is shown.
  const cands = [...realStarters, ...real.filter((p) => !p.started && p.lineupSlotId !== IR_SLOT)]
    .map((p) => ({ ref: p, position: p.position, projected: num(p[key]) }));
  const best = optimalLineup(cands, slots).starters.map((s) => asStarter(s.ref, s.slotId));
  const score = (lineup) => lineup.reduce((a, s) => a + num(s.p[key]), 0);
  return score(best) > score(realLineup) + 1e-9 ? best : realLineup;
}

function lineupFor(real, slots, kind) {
  const realLineup = real.filter((p) => p.started).map((p) => asStarter(p, p.lineupSlotId));
  const reasonable = bestLineup(real, slots, 'projected');
  if (kind === 'lineup-reasonable') return reasonable;
  // Hindsight can never do worse than what happened or than the projections'
  // pick; said outright rather than left to the solver, whose greedy fill is
  // only proven optimal for slot sets that nest.
  const act = (lineup) => lineup.reduce((a, s) => a + num(s.p.actual), 0);
  let best = bestLineup(real, slots, 'actual');
  if (act(reasonable) > act(best) + 1e-9) best = reasonable;
  return act(best) > act(realLineup) + 1e-9 ? best : realLineup;
}

function shapeStarters(lineup, slots, realIds) {
  const order = (slotId) => { const i = slots.indexOf(slotId); return i === -1 ? 99 : i; };
  return lineup
    .map(({ p, slotId }) => ({
      playerId: p.playerId, name: p.name, position: p.position,
      slot: SLOT_LABELS[slotId] ?? String(slotId), slotId,
      actual: num(p.actual), projected: num(p.projected),
      isNew: !realIds.has(p.playerId),
    }))
    .sort((a, b) => order(a.slotId) - order(b.slotId) || b.projected - a.projected || (a.playerId > b.playerId ? 1 : -1));
}

// ------------------------------------------------------------------- mirror

function resolve(world, decision) {
  const d = decision || {};
  if (d.kind === 'whatif-trade') return { mode: 'whatif', whatIf: d };
  if (d.kind === 'lineup-reasonable' || d.kind === 'lineup-perfect') return { mode: 'lineup', kind: d.kind, teamId: d.teamId, week: d.week ?? null };
  const moveId = d.moveId !== undefined ? d.moveId : (typeof d.id === 'string' && d.id.startsWith('move:') ? d.id.slice(5) : d.id);
  const undoMove = (world.moves || []).find((m) => m.id === moveId || String(m.id) === String(moveId));
  return undoMove ? { mode: 'undo', undoMove } : { mode: 'none' };
}

/**
 * One mirror universe: the season with one decision changed.
 *
 * @param {object} world see docs/decisions-review-plan.md, "The contract"
 * @param {object} decision an entry from `listDecisions`, or
 *        `{ kind:'whatif-trade', week, teamId, withTeamId, gives, gets }`
 * @returns {{teams:Map, games:Array, flips:Array, records:Map, skipped:Array,
 *            noise:Map, over:Array}} `over` (not in the plan's contract) lists
 *            the team-weeks left above `world.limits.roster`, for the note.
 */
export function mirror(world, decision) {
  const plan = resolve(world, decision);
  const slots = world.slots || [];
  const weeks = world.weeks || [];
  const finalWeeks = new Set(weeks);
  const teamIds = (world.teams || []).map((t) => t.id);

  const { timeline, skipped, firstWeek, touched } = plan.mode === 'undo' || plan.mode === 'whatif'
    ? replay(world, plan)
    : { timeline: new Map(), skipped: [], firstWeek: null, touched: new Set() };

  const gameOf = (teamId, week) => (world.games || []).find((g) => g.week === week && (g.homeId === teamId || g.awayId === teamId));
  const teams = new Map(teamIds.map((id) => [id, { byWeek: {} }]));
  const over = [];
  const divergence = new Map();
  const limit = world.limits && world.limits.roster;

  for (const week of weeks) {
    const div = divergenceAt(timeline, week);
    divergence.set(week, div);

    for (const teamId of teamIds) {
      const real = realRoster(world, teamId, week);
      const realStarters = real.filter((p) => p.started);
      const realLineup = realStarters.map((p) => asStarter(p, p.lineupSlotId));
      const realIds = new Set(realStarters.map((p) => p.playerId));
      let lineup = realLineup;

      if (plan.mode === 'lineup') {
        // Rule 4: only the picked team changes, in the picked week (or every week).
        if (teamId === plan.teamId && (plan.week === null || plan.week === week)) lineup = lineupFor(real, slots, plan.kind);
      } else if (div.size) {
        const kept = real.filter((p) => !div.has(p.playerId) || div.get(p.playerId) === teamId);
        const arrivals = [];
        for (const [pid, owner] of div) {
          if (owner !== teamId || real.some((p) => p.playerId === pid)) continue;
          const info = (world.players && world.players.get(pid)) || {};
          // A player the feed has no line for that week counts as 0 and 0.
          const wk = (info.byWeek && info.byWeek[week]) || {};
          arrivals.push({
            playerId: pid, name: info.name || `Player ${pid}`, position: info.position,
            slot: SLOT_LABELS[BENCH_SLOT], lineupSlotId: BENCH_SLOT, started: false,
            projected: num(wk.projected), actual: num(wk.actual),
          });
        }
        // Rule 3: a roster the decision did not reach keeps its real lineup.
        if (kept.length !== real.length || arrivals.length) {
          lineup = minimalLineup(real, kept, arrivals, slots);
          const size = kept.length + arrivals.length;
          if (Number.isFinite(limit) && size > limit && size > real.length) over.push({ teamId, week, size, limit });
        }
      }

      const ids = new Set(lineup.map((s) => s.p.playerId));
      const changed = ids.size !== realIds.size || [...ids].some((id) => !realIds.has(id));
      const mine = lineup.map((s) => s.p);

      const g = gameOf(teamId, week);
      const home = g && g.homeId === teamId;
      const gameActual = g ? (home ? g.homeActual : g.awayActual) : null;
      const gameProjected = g ? (home ? g.homeProjected : g.awayProjected) : null;
      const realTotal = Number.isFinite(gameActual) ? gameActual : round2(sum(realStarters, 'actual'));
      const realProjected = Number.isFinite(gameProjected) ? gameProjected : round2(sum(realStarters, 'projected'));

      teams.get(teamId).byWeek[week] = {
        // The real total plus the difference the lineup makes, never a fresh
        // sum: ESPN's total is the one Tim checks against, and an untouched
        // team-week has to equal it exactly.
        total: changed ? round2(realTotal + (sum(mine, 'actual') - sum(realStarters, 'actual'))) : realTotal,
        realTotal,
        projected: changed ? round2(realProjected + (sum(mine, 'projected') - sum(realStarters, 'projected'))) : realProjected,
        realProjected,
        changed,
        starters: shapeStarters(changed ? lineup : realLineup, slots, realIds),
        realStarters: shapeStarters(realLineup, slots, realIds),
      };
    }
  }

  // Rule 5: only weeks with every game final are replayed; other games pass through.
  const games = (world.games || []).map((g) => {
    if (!finalWeeks.has(g.week)) return { ...g };
    const h = teams.get(g.homeId) && teams.get(g.homeId).byWeek[g.week];
    const a = teams.get(g.awayId) && teams.get(g.awayId).byWeek[g.week];
    return {
      ...g,
      homeActual: h ? h.total : g.homeActual, awayActual: a ? a.total : g.awayActual,
      homeProjected: h ? h.projected : g.homeProjected, awayProjected: a ? a.projected : g.awayProjected,
    };
  });

  // One entry per team per flipped game, so a page can filter on its own team.
  const flips = [];
  (world.games || []).forEach((g, i) => {
    if (!finalWeeks.has(g.week)) return;
    for (const [teamId, oppId] of [[g.homeId, g.awayId], [g.awayId, g.homeId]]) {
      const was = resultOf(g, teamId);
      const is = resultOf(games[i], teamId);
      if (was && is && was !== is) flips.push({ week: g.week, teamId, oppId, real: was, mirror: is });
    }
  });

  const records = new Map(teamIds.map((id) => [id, {
    real: recordOf(world.games, id, finalWeeks),
    mirror: recordOf(games, id, finalWeeks),
  }]));

  const noise = new Map(teamIds.map((id) => [id, {}]));
  for (const week of weeks) {
    for (const teamId of teamIds) {
      noise.get(teamId)[week] = noiseFor(world, { teamId, week, firstWeek, touched, div: divergence.get(week), teams });
    }
  }

  return { teams, games, flips, records, skipped, noise, over };
}

/**
 * How unsure one team-week of the mirror is, 0..1: `1 - Π(1 - sᵢ)` over the
 * plan's sources. A lineup decision has no first affected week, so it is 0
 * everywhere: nobody else could have reacted to a lineup.
 */
function noiseFor(world, { teamId, week, firstWeek, touched, div, teams }) {
  if (firstWeek === null || week < firstWeek) return 0;
  const since = week - firstWeek;
  const sources = [];

  // Time. A team with a skipped move runs on the decision's clock: the plan
  // lists it with the touched teams and gives them one rule.
  sources.push(touched.has(teamId)
    ? since * NOISE.touchedPerWeek
    : Math.max(0, since - NOISE.otherFreeWeeks + 1) * NOISE.otherPerWeek);

  // A freed player: unowned in the mirror, really on somebody's roster. Every
  // team but the one that really had him might have picked him up.
  for (const [pid, owner] of div) {
    if (owner !== null) continue;
    const realOwner = (world.teams || []).find((t) => realRoster(world, t.id, week).some((p) => p.playerId === pid));
    if (!realOwner || realOwner.id === teamId) continue;
    const info = (world.players && world.players.get(pid)) || {};
    const points = num(info.byWeek && info.byWeek[week] && info.byWeek[week].actual);
    const starters = teams.get(teamId).byWeek[week].starters;
    const open = (world.slots || []).slice();
    let lowest = null;
    for (const s of starters) {
      const i = open.indexOf(s.slotId);
      if (i !== -1) open.splice(i, 1);
      if (eligible(s.slotId, info.position) && (lowest === null || s.actual < lowest)) lowest = s.actual;
    }
    // A slot he could fill that the team left empty is a starter scoring 0.
    if (open.some((slotId) => eligible(slotId, info.position)) && (lowest === null || lowest > 0)) lowest = 0;
    if (lowest === null) continue;
    sources.push(Math.min(NOISE.freedMax, Math.max(0, (points - lowest) / NOISE.freedPoints)));
  }

  const quiet = sources.reduce((a, s) => a * (1 - Math.min(1, Math.max(0, s))), 1);
  return Math.round((1 - quiet) * 1e4) / 1e4;
}

// ---------------------------------------------------------------- decisions

const names = (world, ids) => ids.map((id) => playerName(world, id)).join(' and ');

function moveLabel(world, move, teamId) {
  if (move.trade) {
    // Said from the side of whoever is being reviewed.
    const mine = move.teamId === teamId;
    const gives = mine ? move.trade.gives : move.trade.gets;
    const gets = mine ? move.trade.gets : move.trade.gives;
    return `Traded ${names(world, gives || [])} for ${names(world, gets || [])}`;
  }
  const adds = move.adds || [];
  const drops = move.drops || [];
  if (adds.length && drops.length) return `Added ${names(world, adds)}, dropped ${names(world, drops)}`;
  return adds.length ? `Added ${names(world, adds)}` : `Dropped ${names(world, drops)}`;
}

/** The swaps that differ in one team-week: who sat and who started instead. */
function swapsOf(week, cell) {
  const realIds = new Set(cell.realStarters.map((p) => p.playerId));
  const mineIds = new Set(cell.starters.map((p) => p.playerId));
  const outs = cell.realStarters.filter((p) => !mineIds.has(p.playerId));
  const ins = cell.starters.filter((p) => !realIds.has(p.playerId));
  const swaps = [];
  for (const out of outs) {
    // Pair like with like where it can be, so the line reads as one swap.
    let i = ins.findIndex((p) => p.position === out.position);
    if (i === -1) i = ins.length ? 0 : -1;
    const inn = i === -1 ? null : ins.splice(i, 1)[0];
    swaps.push({ week, out: out.name, in: inn ? inn.name : null, outId: out.playerId, inId: inn ? inn.playerId : null });
  }
  for (const inn of ins) swaps.push({ week, out: null, in: inn.name, outId: null, inId: inn.playerId });
  return swaps;
}

/**
 * Every decision one team made, each ready to hand to `mirror`.
 *
 * Order: the team's moves in time order, then the two whole-season lineup
 * entries, then each week's two. The week's lineup is the decision (not each
 * of the ~28 lineup moves ESPN logs); the swaps that differ are its `detail`.
 *
 * Besides the plan's fields each entry carries `teamId`, and a move carries
 * `moveId` and `at`, which is what `mirror` reads.
 *
 * @returns {Array<{id:string, kind:string, week:number|null, label:string,
 *           detail:Array|null, empty:boolean, teamId:*, moveId?:*, at?:number}>}
 */
export function listDecisions(world, teamId) {
  const out = [];
  const anyChanged = (m) => [...m.teams.values()].some((t) => Object.values(t.byWeek).some((c) => c.changed));

  for (const move of world.moves || []) {
    const mine = move.teamId === teamId || (move.trade && move.trade.withTeamId === teamId);
    if (!mine) continue;
    const decision = {
      id: `move:${move.id}`, kind: kindOf(move), week: move.week,
      label: moveLabel(world, move, teamId), detail: null, empty: false,
      teamId, moveId: move.id, at: move.at,
    };
    // Empty when no lineup anywhere changes: undoing the pickup of a man who
    // never started is a different roster and the same season.
    decision.empty = !anyChanged(mirror(world, decision));
    out.push(decision);
  }

  const weeks = world.weeks || [];
  const said = { 'lineup-reasonable': 'highest projections', 'lineup-perfect': 'perfect hindsight' };
  const lineup = (kind, week) => {
    const decision = {
      id: `${kind}:${teamId}:${week === null ? 'all' : week}`, kind, week,
      label: week === null ? `Every week's lineup, ${said[kind]}` : `Week ${week} lineup, ${said[kind]}`,
      detail: [], empty: true, teamId,
    };
    const cells = mirror(world, decision).teams.get(teamId);
    for (const w of weeks) {
      const cell = cells && cells.byWeek[w];
      if (cell && cell.changed) decision.detail.push(...swapsOf(w, cell));
    }
    decision.empty = decision.detail.length === 0;
    return decision;
  };
  for (const kind of ['lineup-reasonable', 'lineup-perfect']) out.push(lineup(kind, null));
  for (const week of weeks) for (const kind of ['lineup-reasonable', 'lineup-perfect']) out.push(lineup(kind, week));

  return out;
}
