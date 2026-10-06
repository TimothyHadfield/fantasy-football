// The trade engine: who has a surplus, who has a hole, and which swaps make
// BOTH squads better.
//
// Pure — no DOM, no fetching — so it is node-testable the same way
// `js/forecast.js` and `js/projection.js` are. `js/trade-page.js` does the
// wiring; this decides what the numbers mean.
//
// ---------------------------------------------------------------------------
// The one idea the whole file is built on
//
// A manager's team is worth exactly what his STARTING LINEUP scores. His bench
// scores nothing. So a player who cannot crack his own lineup is worth zero to
// him and can be worth ten points a week to somebody starting a worse man at
// the same position — which is why a trade that genuinely helps both sides is
// not a paradox but the normal case. Every number below is a step towards
// finding those.
//
// That is also why nothing here has a "trade value" column. The published
// value charts exist because they cannot see your league; we can see all ten
// squads, so a trade is priced by simply re-filling both lineups and looking at
// what changed. There is no chart to disagree with.
//
// ---------------------------------------------------------------------------
// Replacement level, and why it is not a constant
//
// "Startable" needs a bar, and the honest bar is not a number somebody typed
// in. For each position it is **the best player at that position who is not
// starting anywhere in the league** — the man any manager could have instead.
// A player above that line is genuinely startable; one below it is a lineup
// spot going to waste. It falls straight out of the rosters, moves with the
// league, and needs no tuning constant of the kind `js/draft-model.js` has to
// carry.
//
// The Players page's STARTABLE bars are deliberately NOT reused here. Those are
// fixed per-position thresholds answering "is this week worth starting at all",
// which is the right question for a waiver claim and the wrong one for a trade:
// two managers can both be over that bar and still have an obvious trade
// between them.

import { SLOT_ELIGIBILITY } from './espn.js';
import { optimalLineup, slotsFromCounts, DEFAULT_SLOTS } from './forecast.js';
// THE POSITIONAL FLOOR (Tim, 2026-09-18), and it matters most here: a trade is
// priced on what each squad would field EACH REMAINING WEEK, so a bye-week hole
// assessed at zero makes a deal that papers over it look far better than it is.
// Pure, and a no-op when no floors are passed. See js/floor.js.
import { assessLineup } from './floor.js';

/** Reading order for a depth table: the lineup's own order, not alphabetical. */
export const POSITIONS_IN_ORDER = ['QB', 'RB', 'WR', 'TE', 'DST', 'K'];

// ESPN's season projection covers the 17-game regular season. Dividing by it is
// what turns a ~250-point number into the ~15-point one a manager thinks in.
// Same constant, and the same reasoning, as the first grid on the analysis page.
export const SEASON_GAMES = 17;

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * A player id, whether you were handed the player or just his id.
 *
 * The finder passes whole roster entries around; `bestCombo` and
 * `priceTradeAcrossWeeks` are called from a page that may only be holding ids.
 * One coercion in one place beats two call sites that disagree about which.
 */
const idOf = (p) => (p && typeof p === 'object' ? p.playerId : p);

// --------------------------------------------------------------- the measures

/**
 * A player's typical week: ESPN's season projection spread over the season.
 *
 * THE DEFAULT, and deliberately so. Every guide on trading says the same thing
 * — trade on rest-of-season value, never on last week's points — and a season
 * projection is the closest thing ESPN publishes to that. It also sidesteps
 * byes entirely: a bye is a 0.00 in one WEEK's projection, and pricing a trade
 * off a week where one side happens to be off would be nonsense.
 *
 * Falls back to this week's projection for anyone ESPN has no season line for
 * — a just-signed body, a deep bench flier — because a number on a slightly
 * different footing beats a hole in the table. Same rule as `avgWeek` on the
 * analysis page, so the two pages agree about how good a player is.
 */
export function typicalWeek(p) {
  if (p && typeof p.seasonProjected === 'number' && p.seasonProjected > 0) {
    return round1(p.seasonProjected / SEASON_GAMES);
  }
  return p && typeof p.projected === 'number' ? round1(p.projected) : null;
}

/**
 * The selected week's own projection.
 *
 * Offered because "who can I trade for to survive week 9" is a real question,
 * but it is not the default: a man on bye that week prices at 0.00 and would
 * look like a player worth nothing rather than a player worth nothing ONCE.
 */
export function weekProjection(p) {
  return p && typeof p.projected === 'number' ? round1(p.projected) : null;
}

// ------------------------------------------------------------- lineup filling

/**
 * What a set of players is worth: the best legal lineup they can field.
 *
 * `optimalLineup` is `js/forecast.js`'s, unchanged and unwrapped — it fills the
 * most restrictive slots first, which is provably optimal because the
 * eligibility sets nest, and it is already checked against brute-force
 * enumeration over 350 random rosters in `tests/test-forecast.mjs`. Reusing it
 * means the trade page and the season forecast can never disagree about what a
 * squad is worth.
 *
 * @param {Array} players roster entries as `fetchWeekRosters` returns them
 * @param {number[]} slots lineupSlotIds the league starts
 * @param {function} measure player -> number|null
 * @returns {{starters: Array, total: number}}
 */
export function lineupValue(players, slots, measure = typicalWeek) {
  return optimalLineup(scored(players, measure), slots);
}

/**
 * Re-price a roster under one measure. `projected` is what optimalLineup reads.
 *
 * The finder scores each roster ONCE and then works on the result, rather than
 * re-scoring inside its inner loop. That is not micro-optimisation: the loop
 * runs tens of thousands of times, and copying sixteen player objects on every
 * pass was most of the search's cost.
 */
function scored(players, measure) {
  return (players || []).map((p) => {
    const v = measure(p);
    return { ...p, projected: Number.isFinite(v) ? v : null };
  });
}

/** What each position contributes to a filled lineup. */
function pointsByPosition(lineup) {
  const out = new Map();
  for (const s of lineup.starters) {
    out.set(s.position, (out.get(s.position) || 0) + s.projected);
  }
  return out;
}

/**
 * Where a lineup actually gained points, and how many.
 *
 * NOT "which incoming player ended up in the lineup". Those are different
 * facts and the difference matters: trade your QB1 away for a worse QB and a
 * much better back, and the incoming quarterback does start — so a membership
 * test would report the deal as an upgrade at QB when quarterback is precisely
 * what you gave up to get the running back. Points before against points after,
 * position by position, cannot tell that lie.
 */
function positionDeltas(before, after) {
  const was = pointsByPosition(before);
  const now = pointsByPosition(after);
  const out = [];
  for (const position of new Set([...was.keys(), ...now.keys()])) {
    const delta = round1((now.get(position) || 0) - (was.get(position) || 0));
    if (delta !== 0) out.push({ position, delta });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

/**
 * Who walks into the starting lineup, and who walks out of it.
 *
 * This is what the offer actually SAYS, and the per-position deltas above are
 * not a substitute for it. A trade that turns a receiver slot into a running
 * back — which is most of what a flex does — reads as "RB +13.8, WR −12.0" for
 * a net of under two points, and that is a true sentence nobody can act on.
 * Two names and two numbers are the same fact without the arithmetic:
 *
 *     in   Barrett Gallardo  RB 13.8
 *     out  Tyrese Mallory    WR 12.0
 *
 * Both lists include men who were never in the trade — a bench player promoted
 * because the man above him left is part of what the offer does, and hiding him
 * would make the totals not add up.
 */
function lineupChurn(before, after) {
  const was = new Map(before.starters.map((s) => [s.playerId, s]));
  const now = new Map(after.starters.map((s) => [s.playerId, s]));

  const brief = (s) => ({
    playerId: s.playerId,
    name: s.name,
    position: s.position,
    value: round1(s.projected),
  });

  return {
    in: after.starters.filter((s) => !was.has(s.playerId)).map(brief)
      .sort((a, b) => b.value - a.value),
    out: before.starters.filter((s) => !now.has(s.playerId)).map(brief)
      .sort((a, b) => b.value - a.value),
  };
}

/**
 * How many slots the league dedicates to each position outright.
 *
 * FLEX is excluded on purpose — it belongs to no single position, and counting
 * it towards one would say a league needs three receivers when it needs two and
 * something. It is picked up instead by `starting`, which counts who ACTUALLY
 * fills the lineup, flex included.
 */
export function dedicatedSlots(slots) {
  const need = {};
  for (const id of slots || []) {
    const eligible = SLOT_ELIGIBILITY[id];
    if (!eligible || eligible.length !== 1) continue;
    need[eligible[0]] = (need[eligible[0]] || 0) + 1;
  }
  return need;
}

/** The league's slot shape, read off the lineups, with a stated fallback. */
export function slotsForLeague(counts) {
  return counts ? slotsFromCounts(counts) : DEFAULT_SLOTS.slice();
}

// ---------------------------------------------------------- replacement level

/**
 * The bar, per position: the best man at it who is not starting anywhere.
 *
 * Two facts come back with the number, because the UI has to be able to say
 * which case it is in:
 *
 *   - `exhausted` — every player at this position in the league is starting, so
 *     there is no spare man to set a bar with. Happens at D/ST and kicker in a
 *     league where everyone carries exactly one. The worst starter is used
 *     instead, which correctly reports "nobody has a surplus here" rather than
 *     inventing one.
 *   - `startedInLeague` — how many of them are in a lineup, which is what makes
 *     the bar explicable in the panel note rather than magic.
 *
 * @returns {Map<string, {value:number|null, startedInLeague:number, pooled:number, exhausted:boolean}>}
 */
export function replacementLevels(teams, slots, measure = typicalWeek) {
  const pool = new Map();   // position -> every value in the league, any roster
  const starts = new Map(); // position -> how many are in somebody's lineup

  for (const t of teams || []) {
    for (const p of t.players || []) {
      const v = measure(p);
      if (!Number.isFinite(v)) continue;
      if (!pool.has(p.position)) pool.set(p.position, []);
      pool.get(p.position).push(v);
    }
    for (const s of lineupValue(t.players, slots, measure).starters) {
      starts.set(s.position, (starts.get(s.position) || 0) + 1);
    }
  }

  const out = new Map();
  for (const [position, values] of pool) {
    values.sort((a, b) => b - a);
    const n = starts.get(position) || 0;
    const exhausted = n >= values.length;
    out.set(position, {
      // values[n] is the (n+1)-th best — the first man past the last starter.
      value: exhausted ? values[values.length - 1] : values[n],
      startedInLeague: n,
      pooled: values.length,
      exhausted,
    });
  }
  return out;
}

// ------------------------------------------------------------- the depth table
//
// Ten rows, six columns, one number per cell: how many startable players a
// manager has at that position MINUS how many he has to field there.
//
// Positive is a surplus and it is the thing you trade away — those players are
// scoring him nothing. Negative is a hole and it is the thing you trade for.
// Read down a column to find the manager whose sign is the opposite of yours;
// that is the conversation worth having, and it is the step every trading guide
// puts first and no public tool can do, because none of them can see the other
// nine rosters.

/**
 * One team's depth at one position.
 *
 * `needed` is the larger of what he actually starts there and what the league
 * forces him to start. The second half matters: a manager with no kicker at all
 * starts none, and `startable - starting` would read 0 — a clean bill of health
 * for an empty lineup slot. Against the league's dedicated slots it reads −1,
 * which is the truth.
 */
function depthCell(team, position, startingIds, measure, replacement, required) {
  const bar = replacement.get(position);
  const barValue = bar ? bar.value : null;

  const mine = (team.players || [])
    .map((p) => ({ p, v: measure(p) }))
    .filter((e) => e.p.position === position)
    .sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));

  const starting = mine.filter((e) => startingIds.has(e.p.playerId)).length;

  // Strictly above the bar. The bar-setter himself is by definition the best
  // man nobody is starting, so counting him as startable would hand every
  // manager in the league a phantom extra body at every position.
  //
  // EXCEPT when the position is exhausted, and this was a real bug rather than
  // a nicety. If every player at a position is already starting somewhere there
  // is no replacement to be had, so the bar falls back to the worst starter in
  // the league — and a strict test then rules that man out of being startable,
  // reporting a hole at a position his manager has perfectly well filled. In a
  // two-team stub where both squads carry one identical quarterback, BOTH were
  // told they were short at QB. With nobody available to replace him, every man
  // you hold is better than what you could get, so the test goes inclusive.
  const startableAt = (v) =>
    Number.isFinite(v) && Number.isFinite(barValue) && (bar.exhausted ? v >= barValue : v > barValue);
  const above = mine.filter((e) => startableAt(e.v));

  const needed = Math.max(starting, required[position] || 0);
  const net = above.length - needed;

  // The best startable man NOT in the lineup — what this manager can afford to
  // send. Null when he has none, which is most cells.
  const spare = above.find((e) => !startingIds.has(e.p.playerId)) || null;
  // The worst man he IS starting there — what an incoming player would replace.
  // Null when the slot is empty, which is itself the hole.
  const weakest = [...mine].reverse().find((e) => startingIds.has(e.p.playerId)) || null;

  // --------------------------------------------------------------------
  // Counts alone will not carry this table, and it took building it to see
  // why. The bar is set at the last man starting anywhere in the league, so
  // by construction the number of players above it is about the number of
  // lineup places for them — which makes `net` zero for nearly every cell in
  // a league of any balance. True, and useless to read down a column.
  //
  // So the number in the cell is POINTS, not bodies: how far this manager's
  // starters at this position are above the man anybody could have instead.
  // That is continuous, never zero by accident, and reading down a column
  // ranks the league at that position — which is the whole job of the table,
  // because the partner worth talking to is the one whose sign is the
  // opposite of yours.
  //
  // An unfilled slot counts as the whole bar against him: a manager with no
  // kicker is not neutral at kicker, he is scoring nothing there.
  const startersEdge = Number.isFinite(barValue)
    ? round1(
        mine
          .filter((e) => startingIds.has(e.p.playerId) && Number.isFinite(e.v))
          .reduce((a, e) => a + (e.v - barValue), 0) -
          Math.max(0, (required[position] || 0) - starting) * barValue
      )
    : null;

  // What this manager could send without touching his lineup — the surplus,
  // priced. Never negative: a man he is not starting can only be worth
  // something to somebody else or worth nothing at all.
  const surplusEdge = Number.isFinite(barValue)
    ? round1(
        above
          .filter((e) => !startingIds.has(e.p.playerId))
          .reduce((a, e) => a + (e.v - barValue), 0)
      )
    : null;

  return {
    position,
    starting,
    startable: above.length,
    needed,
    net,
    spare,
    weakest,
    startersEdge,
    surplusEdge,
  };
}

/**
 * The whole map: every team, every position.
 *
 * @returns {{positions, replacement, required, rows: Array}}
 */
export function depthTable(teams, slots, measure = typicalWeek) {
  const replacement = replacementLevels(teams, slots, measure);
  const required = dedicatedSlots(slots);

  // Only positions this league actually has. A column of em dashes for a
  // position nobody starts and nobody rosters is not information, and the two
  // reasons to keep one are both covered: a dedicated slot means the league
  // demands the position even if a manager has nobody in it, and a player in
  // the pool means somebody is carrying one even if no slot names it.
  const positions = POSITIONS_IN_ORDER.filter(
    (p) => (required[p] || 0) > 0 || replacement.has(p)
  );

  const rows = (teams || []).map((team) => {
    // Filled once per team, not once per cell: every position asks the same
    // question of the same lineup, and six identical fills per row was most of
    // this table's cost for none of its meaning.
    const lineup = lineupValue(team.players, slots, measure);
    const startingIds = new Set(lineup.starters.map((s) => s.playerId));

    const cells = new Map();
    for (const position of positions) {
      cells.set(
        position,
        depthCell(team, position, startingIds, measure, replacement, required)
      );
    }
    return { team, cells, total: lineup.total, lineup };
  });

  return { positions, replacement, required, rows };
}

// ------------------------------------------------------------- the trade finder
//
// Brute force, and deliberately so. Ten squads of sixteen is a small enough
// space to simply try every swap and keep the ones that work, and an exhaustive
// search cannot miss the trade a heuristic would have pruned. The only pruning
// here is a cap on roster size, which exists to stop a pathological league
// hanging the page rather than to make the answer cleverer.

/** How many players from each side a package may hold. */
const MAX_PACKAGE = 2;

/** Ignore a gain smaller than this: it is float noise dressed as a trade. */
const MIN_GAIN = 0.1;

/**
 * Only the top N of a roster are considered as trade pieces.
 *
 * A 16-man roster gives 120 two-man packages, and both sides multiply. This
 * bounds a league carrying an unusually deep bench without changing the answer
 * in a normal one — the players it drops are the ones no lineup would ever want.
 */
const CANDIDATE_CAP = 18;

/**
 * The players a side might part with, best first, and only ones with a number.
 *
 * Takes an already-scored roster, so `projected` is the measure's value and
 * nothing is re-derived inside the search.
 */
function candidates(scoredPlayers) {
  return scoredPlayers
    .filter((p) => p.playerId !== null && p.playerId !== undefined)
    .filter((p) => Number.isFinite(p.projected))
    .slice()
    .sort((a, b) => b.projected - a.projected || a.playerId - b.playerId)
    .slice(0, CANDIDATE_CAP);
}

/** Every 1- and 2-man package from a candidate list. */
function packages(list, max = MAX_PACKAGE) {
  const out = list.map((p) => [p]);
  if (max < 2) return out;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  }
  return out;
}

/**
 * A roster after a trade, with the forced cut applied.
 *
 * A 2-for-1 does not just move players: the side receiving two and sending one
 * ends a man over the limit and HAS to drop somebody. Every guide flags this as
 * the thing that makes lopsided-looking packages bad deals, so the cut is
 * modelled rather than waved away.
 *
 * WHO GOES (2026-09-30, Tim: "if you recieve a player, some weeks your
 * projection actually decreases … you can just not start the player you're
 * recieving"). Until then the man with the lowest rest-of-season total went —
 * and that is very often the backup D/ST or kicker whose one job is the
 * starter's bye week, so the deal quietly lost that week (Tim's "DEF avg is
 * −0.6/week" on a WR/RB trade). Now the man whose removal costs the after-trade
 * lineups the FEWEST points over the priced weeks goes, each week assessed
 * exactly as the pricing assesses it (`optimalLineup`, then `assessLineup` with
 * the floors). A tie goes to the lower rest-of-season total, which was the
 * whole rule before; a further tie to roster order. Everyone on the after-trade
 * roster is eligible, the men just received included — as before.
 *
 * CHEAP IN THE USUAL CASE. A man who starts in NO priced week costs exactly 0
 * (taking a bench man off cannot change the lineup `optimalLineup` picks, so
 * nothing needs re-filling). So the lowest-ROS idle man is the answer unless a
 * STARTER with a lower season total also costs 0 — possible under the floor,
 * when the slot he leaves is assessed at the floor either way — and only those
 * starters are costed, and only in the weeks they start. With nobody idle,
 * every man is costed. More than one man over (a combo): one at a time,
 * cheapest first. Assumes no removal RAISES a week (cost ≥ 0); the brute force
 * in tests/test-trade-cut.mjs costs every man, floors on and off, to check it.
 *
 * The side that ends a man SHORT is simply left short. It could claim someone
 * off the wire, but that player is not in this page's data and inventing him
 * would flatter the trade. Being conservative understates a package's value,
 * which is the safe direction to be wrong in.
 *
 * `ctx` is how a week is solved: `{ slots, n, floors, view }` — `view(roster,
 * i)` is the roster as week i sees it (`atWeek` for the weekly measure, the
 * roster itself for the one-lineup scalar measure, n = 1).
 *
 * `preSolved`, when a caller already has it, is the same `{ total, ids }` per
 * week for the roster BEFORE the cut (outgoing gone, incoming in).
 *
 * Returns `{ roster, cut, solved }`: `solved[i]` is week i of the returned
 * roster, `{ total, ids }` (assessed total, starting ids), so a caller can use
 * the after-trade totals without filling again. When nobody is cut it is
 * `preSolved` as given (null if none was).
 */
function afterTrade(scoredPlayers, outgoing, incoming, ctx, preSolved = null) {
  const gone = new Set((outgoing || []).map(idOf));
  const kept = scoredPlayers.filter((p) => !gone.has(p.playerId)).concat(incoming);

  const over = kept.length - scoredPlayers.length;
  if (over <= 0) return { roster: kept, cut: [], solved: preSolved };
  return forcedCut(kept, over, ctx, preSolved || solveWeeks(kept, ctx));
}

/** One week of a roster: its assessed best-lineup total and who starts. */
function solveWeek(roster, i, ctx) {
  const lineup = optimalLineup(ctx.view(roster, i), ctx.slots);
  return {
    total: assessLineup(lineup.starters, ctx.slots, ctx.floors).total,
    ids: new Set(lineup.starters.map((s) => s.playerId)),
  };
}

function solveWeeks(roster, ctx) {
  const out = new Array(ctx.n);
  for (let i = 0; i < ctx.n; i++) out[i] = solveWeek(roster, i, ctx);
  return out;
}

/** The two ways a cut is judged — see `afterTrade`. */
const CUT_EPS = 1e-6;
const seasonOf = (p) => (Number.isFinite(p.projected) ? p.projected : -Infinity);

function forcedCut(kept, over, ctx, solved) {
  let roster = kept;
  let weeks = solved;
  const cut = [];
  for (let k = 0; k < over && roster.length; k++) {
    const starting = new Set();
    for (const w of weeks) for (const id of w.ids) starting.add(id);

    let best = null;
    let bestCost = Infinity;
    let bestWeeks = null;
    // Idle men first: cost 0, nothing to re-fill.
    for (const p of roster) {
      if (starting.has(p.playerId)) continue;
      if (best === null || seasonOf(p) < seasonOf(best)) best = p;
    }
    if (best) {
      bestCost = 0;
      bestWeeks = weeks;
    }
    // Then the starters. With an idle man in hand only a starter with a LOWER
    // season total can still win, and only by also costing 0 — which happens
    // under the floor, when the slot he leaves is assessed at the floor either
    // way (a bye-week backup projected below the wire's third man). So only
    // those are costed; with nobody idle, everyone is.
    for (const p of roster) {
      if (!starting.has(p.playerId)) continue;
      if (best !== null && bestCost <= CUT_EPS && !(seasonOf(p) < seasonOf(best))) continue;
      const rest = roster.filter((q) => q !== p);
      let cost = 0;
      const after = weeks.map((w, i) => {
        if (!w.ids.has(p.playerId)) return w;
        const x = solveWeek(rest, i, ctx);
        cost += w.total - x.total;
        return x;
      });
      if (cost < bestCost - CUT_EPS ||
          (Math.abs(cost - bestCost) <= CUT_EPS && seasonOf(p) < seasonOf(best))) {
        best = p;
        bestCost = cost;
        bestWeeks = after;
      }
    }
    cut.push(best);
    roster = roster.filter((q) => q !== best);
    weeks = bestWeeks;
  }
  return { roster, cut, solved: weeks };
}

/**
 * How a package reads from the point of view of the side proposing it.
 *
 * Named rather than left as "2-for-1" because which way round it goes changes
 * what kind of move it is: sending two for one is consolidation — turning
 * bench depth into a starter and accepting the forced cut — while sending one
 * for two is buying depth with a starter. Managers think in those terms, and a
 * bare ratio makes the reader work out which one they are looking at.
 */
function packageKind(send, receive) {
  // Two for two is its own shape (2026-09-21) — a different conversation from
  // a straight swap, and a filter button of its own on the page.
  if (send.length === 2 && receive.length === 2) return 'two';
  if (send.length === receive.length) return 'even';
  return send.length > receive.length ? 'consolidate' : 'depth';
}

/**
 * TWO FOR TWO, BOUNDED (Tim, 2026-09-21: it was "left out: it is rarely what
 * anyone proposes, and it multiplies the search by another two orders of
 * magnitude"). It is proposed often enough — two starters for two starters,
 * shoring up two positions at once — so it is searched now, but only among each
 * squad's top TWO_CAP pieces: 45 pairs a side instead of 153, which keeps the
 * search inside the same few seconds. A 2-for-2 built from a man outside that
 * group is almost always a 1-for-1 with a spare body bolted on, and
 * `dropRedundant` would delete it anyway.
 */
const TWO_CAP = 10;

/** Is this pair of packages a 2-for-2 the bounded search allows? */
function twoForTwoAllowed(send, receive, myTop, theirTop) {
  return send.every((p) => myTop.has(p.playerId)) && receive.every((p) => theirTop.has(p.playerId));
}

const topIds = (list) => new Set(list.slice(0, TWO_CAP).map((p) => p.playerId));

/**
 * Every trade with this partner that makes BOTH lineups better.
 *
 * Both sides are re-priced from scratch — fill the best legal lineup before,
 * fill it again after, subtract — so nothing here depends on a value chart or
 * on anyone agreeing about what a player is "worth". Two managers looking at
 * the same ESPN projections can both check it, which is the whole reason this
 * is a better argument than a number off a website.
 */
/**
 * Which package shapes to search. All three by default.
 *
 * This is a search option rather than something the page filters afterwards,
 * and that is not a detail. `bestPerTarget` keeps ONE offer per man you would
 * acquire, so a 1-for-1 and a 2-for-1 that bring in the same player compete for
 * the same slot in the list — and the 2-for-1 usually wins, because throwing in
 * a spare body is free to you. Filter after that and the 1-for-1 is already
 * gone. Filtering here means "show me only straight swaps" returns the best
 * straight swaps rather than the leftovers of a search that preferred
 * something else.
 */
export const PACKAGE_KINDS = ['even', 'consolidate', 'depth', 'two'];

function* tradesWithSteps(myScored, theirScored, theirs, slots, kinds) {
  const myBase = optimalLineup(myScored, slots);
  const theirBase = optimalLineup(theirScored, slots);

  const myCands = candidates(myScored);
  const theirCands = candidates(theirScored);
  const myPackages = packages(myCands);
  const theirPackages = packages(theirCands);
  const myTop = topIds(myCands);
  const theirTop = topIds(theirCands);
  // One lineup, so the cut is judged on that one lineup (see `afterTrade`).
  const cutCtx = { slots, n: 1, floors: null, view: (roster) => roster };

  const found = [];
  for (const send of myPackages) {
    // One stop per package sent — the scalar twin of `tradesAcrossWeeksSteps`.
    yield;
    for (const receive of theirPackages) {
      // 2-for-2 only among the top TWO_CAP pieces a side — see TWO_CAP.
      if (send.length === 2 && receive.length === 2 &&
          !twoForTwoAllowed(send, receive, myTop, theirTop)) continue;

      const kind = packageKind(send, receive);
      if (!kinds.includes(kind)) continue;

      // Mine first, and bail before touching theirs. Most pairs fail here, and
      // the second lineup fill is the expensive half of the loop.
      const myAfter = optimalLineup(afterTrade(myScored, send, receive, cutCtx).roster, slots);
      const myGain = round1(myAfter.total - myBase.total);
      if (myGain < MIN_GAIN) continue;

      const theirAfter = optimalLineup(afterTrade(theirScored, receive, send, cutCtx).roster, slots);
      const theirGain = round1(theirAfter.total - theirBase.total);
      if (theirGain < MIN_GAIN) continue;

      found.push({
        partner: theirs,
        send,
        receive,
        kind,
        shape: `${send.length}-for-${receive.length}`,
        myGain,
        theirGain,
        myBefore: myBase.total,
        myAfter: myAfter.total,
        theirBefore: theirBase.total,
        theirAfter: theirAfter.total,
        yourMoves: positionDeltas(myBase, myAfter),
        theirMoves: positionDeltas(theirBase, theirAfter),
        yourChurn: lineupChurn(myBase, myAfter),
        theirChurn: lineupChurn(theirBase, theirAfter),
      });
    }
  }
  return found;
}

/**
 * The cheapest way to get each man, rather than every way.
 *
 * An exhaustive search returns the same acquisition over and over with a
 * different spare body attached — twenty rows that are one trade. Keyed on who
 * you would RECEIVE, so each row is a distinct answer to "who can I get", and
 * the kept offer is the one that gains you most, then sends fewest players,
 * then gives the partner most. The last term is not politeness: of two offers
 * identical to you, the one worth more to him is the one he accepts.
 */
/**
 * What an offer is kept and ordered by: its GOAL-WEIGHTED gain when the finder
 * was given the goal's per-week weights (`goalPoints`, 2026-09-21), and its
 * points otherwise — so every caller that passes no weights is untouched.
 */
const rankGain = (o) => (Number.isFinite(o.rank) ? o.rank
  : Number.isFinite(o.goalPoints) ? o.goalPoints
    : Number.isFinite(o.netGain) ? o.netGain : o.myGain);

/**
 * The indices into `weeks` of the week numbers in `list`, ascending, each once —
 * or null when there are none. How `meetWeeks` reaches the per-partner search.
 */
function meetIndices(weeks, list) {
  if (!Array.isArray(weeks) || !Array.isArray(list) || !list.length) return null;
  const want = new Set(list.map(Number));
  const out = [];
  weeks.forEach((w, i) => { if (want.has(Number(w))) out.push(i); });
  return out.length ? out : null;
}

function bestPerTarget(offers) {
  const best = new Map();
  for (const o of offers) {
    const key =
      `${o.partner.id}:` +
      o.receive.map((p) => p.playerId).sort((a, b) => a - b).join(',');
    const held = best.get(key);
    if (
      !held ||
      rankGain(o) > rankGain(held) ||
      (rankGain(o) === rankGain(held) && o.send.length < held.send.length) ||
      (rankGain(o) === rankGain(held) && o.send.length === held.send.length &&
        o.theirGain > held.theirGain)
    ) {
      best.set(key, o);
    }
  }
  return [...best.values()];
}

/**
 * Throw away an offer that another offer beats on every count.
 *
 * `bestPerTarget` keys on who you RECEIVE, so "get his receiver" and "get his
 * receiver plus a spare back" are different rows — and in a stub built to have
 * exactly one sensible trade in it, six rows came back that were all that trade
 * with different junk attached. An offer is redundant when some other offer
 * with the same partner is at least as good for BOTH sides and moves fewer
 * players; the simplest version of a deal is the one worth proposing, because
 * every extra name in it is another thing for the other manager to object to.
 *
 * Deliberately a SUBSET test and not merely a smaller-and-better one. Two
 * different trades with the same manager that happen to be the same size are
 * genuine alternatives — he may be willing to part with one of those men and
 * not the other — so neither may silently delete the other. Only a deal that
 * literally contains another deal is redundant.
 */
function dropRedundant(offers) {
  const ids = (list) => new Set(list.map((p) => p.playerId));
  const subset = (a, b) => [...a].every((id) => b.has(id));

  return offers.filter((o, i) => {
    const oSend = ids(o.send);
    const oReceive = ids(o.receive);
    return !offers.some((other, j) => {
      if (i === j || other.partner.id !== o.partner.id) return false;
      if (other.send.length + other.receive.length >= o.send.length + o.receive.length) {
        return false;
      }
      return (
        subset(ids(other.send), oSend) &&
        subset(ids(other.receive), oReceive) &&
        rankGain(other) >= rankGain(o) &&
        other.theirGain >= o.theirGain
      );
    });
  });
}

/** The finder's order: kept-by figure, then his gain, then fewer men, then partner. */
function compareOffers(a, b) {
  return rankGain(b) - rankGain(a) ||
    b.theirGain - a.theirGain ||
    a.send.length + a.receive.length - (b.send.length + b.receive.length) ||
    a.partner.id - b.partner.id;
}

/** Fill an offer's two churn lists (deferred until it is handed back). */
function finishOffer(o) {
  if (o && typeof o.finish === 'function') o.finish();
  if (o) delete o.finish;
}

/**
 * THE SUGGESTION LIST for a partly built deal (Tim, 2026-10-01: "show all the
 * potential additions as suggested trades … Always show at least 3 different
 * suggested trades in this list, even if there are no trades that are
 * beneficial for either user").
 *
 * `sorted` is every completion, in the finder's own order (`compareOffers`).
 *   - A completion that `dropRedundant`'s rule would drop — another completion
 *     with fewer men, contained in it, at least as good for both sides — is
 *     skipped, as the finder skips it.
 *   - The first SUGGEST_MIN that survive are shown whatever they are worth.
 *   - Up to SUGGEST_MAX in all: the rows past the minimum must pass the
 *     finder's own two gates (`gates`, filled by `tradesAcrossWeeks`), i.e. be
 *     deals the finder itself would keep.
 *   - Fewer than SUGGEST_MIN survivors: topped up from the skipped ones, in
 *     order, so the minimum holds whenever that many completions exist.
 */
export const SUGGEST_MIN = 3;
export const SUGGEST_MAX = 5;

const dealKey = (send, receive) =>
  `${send.map((p) => String(p.playerId)).sort().join(',')}>${receive.map((p) => String(p.playerId)).sort().join(',')}`;

/** Every non-empty subset of a list of at most two. */
const subsetsOf = (list) => (list.length === 2 ? [[list[0]], [list[1]], list] : [list]);

function pickCompletions(sorted, gates) {
  const byKey = new Map(sorted.map((o) => [dealKey(o.send, o.receive), o]));
  const size = (o) => o.send.length + o.receive.length;
  const redundant = (o) => {
    for (const s of subsetsOf(o.send)) {
      for (const r of subsetsOf(o.receive)) {
        if (s.length + r.length >= size(o)) continue;
        const p = byKey.get(dealKey(s, r));
        if (p && rankGain(p) >= rankGain(o) && p.theirGain >= o.theirGain) return true;
      }
    }
    return false;
  };
  const good = (o) => (Number.isFinite(o.goalPoints) ? o.goalPoints : o.netGain) >= gates.minGain &&
    o.theirGain >= gates.theirMin;

  const kept = [];
  for (const o of sorted) {
    if (kept.length >= SUGGEST_MAX) break;
    if (redundant(o)) continue;
    if (kept.length >= SUGGEST_MIN && !good(o)) continue;
    kept.push(o);
  }
  if (kept.length < SUGGEST_MIN) {
    const held = new Set(kept);
    for (const o of sorted) {
      if (kept.length >= SUGGEST_MIN) break;
      if (!held.has(o)) kept.push(o);
    }
    kept.sort(compareOffers);
  }
  return kept;
}

/**
 * Search the whole league for trades that make both squads better.
 *
 * @param {Object} opts
 * @param {Array}  opts.teams     every team, as `fetchWeekRosters` returns them
 * @param {number} opts.myTeamId  the squad to trade FROM
 * @param {number[]} opts.slots   the league's starting slots
 * @param {function} [opts.measure]
 * @param {string[]} [opts.kinds] package shapes to search — see PACKAGE_KINDS
 * @param {number} [opts.limit]   how many offers to return
 * @param {number[]} [opts.weeks] remaining weeks — switches to the WEEKLY measure
 * @param {function} [opts.projFor] `(player, week) -> number|null`, with `weeks`
 * @param {boolean|function} [opts.zeroIsBye] is a 0.00 a bye? See `isBye`.
 * @param {number[]} [opts.weights] GOAL WEIGHTS, one per week in `weeks`, all
 *   ≥ 0: how much a point in that week moves your chance at the goal
 *   (js/trade-odds.js `weekWeights`). With them, an offer is KEPT and ordered
 *   by its weighted gain (`goalPoints`) instead of its points — so a deal that
 *   loses points in October and wins them in the final is a candidate at all.
 *   Weekly measure only; omitted, nothing changes.
 * @param {number} [opts.theirMinPerWeek] the least the PARTNER's lineup may
 *   gain, per week — negative lets in deals he might still accept, which the
 *   page then discounts by the yes-chance. Default: must gain, as always.
 * @param {function} [opts.theirReach] `(partnerId) -> number[]|null`: one
 *   weight per week in `weeks`, the chance THAT PARTNER plays in it
 *   (js/trade-odds.js `playoffReach`). With it his side — `theirGain`, the
 *   `theirMinPerWeek` gate and the ceiling that prunes it — is priced over the
 *   weeks he will actually play; `theirPoints` keeps the flat figure and
 *   `theirWeeks` the expected number of weeks. Weekly measure only.
 * @param {function} [opts.rankBy] `(offer) -> number`: what an offer is KEPT
 *   and ordered by, when given. The goal-ranked page passes the weighted gain
 *   × the chance he says yes. WITHOUT IT, on 2026-09-21, the weighted finder
 *   kept its forty by YOUR gain alone and every one of them was a fleece at
 *   the edge of the partner tolerance — the fair deals that expected value
 *   prefers had been cut before the simulation ever saw them.
 * @param {function} [opts.meetWeeks] `(partnerId) -> number[]|null`: the WEEK
 *   NUMBERS (not indices) in which you play that partner and that count — the
 *   page passes the remaining regular-season meetings. With it every offer is
 *   NETTED (Tim, 2026-09-30): his lineup change in a week he plays you is your
 *   loss, so `netGain` = `myGain` − his change in those weeks, and the offer is
 *   kept and ranked on the net (`goalPoints` is the weighted net). Weeks not in
 *   `weeks` are ignored. Weekly measure only; omitted, nothing changes.
 * @param {boolean} [opts.exhaustive] TESTS ONLY: switch every ceiling off, so
 *   a suite can prove the pruned search keeps exactly what a full one keeps.
 * @param {number} [opts.partnerId] search with this one squad only.
 * @param {Array} [opts.mustSend] ids (or players) of YOUR men every package
 *   must send; [opts.mustReceive] the same for HIS men. Packages that do not
 *   contain them all are never tried. Weekly measure only.
 * @param {boolean} [opts.complete] THE COMPLETIONS OF A PARTLY BUILT DEAL
 *   (Tim, 2026-10-01 — the custom box's "Suggested" list). With `partnerId` and
 *   the ticked men in `mustSend`/`mustReceive`: no gain gate on either side
 *   (every completion is a candidate, a bad one too), and `offers` is the
 *   SUGGESTION LIST — see `pickCompletions`. Weekly measure only.
 * @returns {{offers: Array, mine: Object|null, considered: number, basis: string}}
 */
export function findTrades(opts) {
  return drain(findTradesSteps(opts));
}

/** Run a step generator straight through and hand back what it returns. */
function drain(steps) {
  let r = steps.next();
  while (!r.done) r = steps.next();
  return r.value;
}

/**
 * How long `findTradesSliced` works before it hands the page back, in
 * milliseconds. Short enough that a scroll or a tap in the middle of a search
 * is answered within a frame or two.
 */
export const SEARCH_SLICE_MS = 30;

/**
 * A PAUSE IS NOT FREE EVERYWHERE. Chrome hands control back in a tenth of a
 * millisecond; the Safari engine this is tested in took 17–25 ms per pause
 * (measured 2026-10-06, 712 pauses = 18 s on an 18 s search). So a slice grows
 * to ten times what the last pauses cost — a pause is then a tenth of the work
 * at most — up to this ceiling, which is about one simulated season, the
 * longest thing the page does in one go anyway.
 */
const SEARCH_SLICE_MAX_MS = 200;

const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

/**
 * `findTrades`, a slice at a time: the same search, the same options and the
 * same answer, for a page that must stay usable while it runs. On the weekly
 * measure the whole league is several seconds of lineup fills, and in one go
 * nothing on the page could be scrolled or tapped until it ended (measured
 * 2026-10-06 in headless Chrome and Safari's engine).
 *
 * @param {Object} opts exactly `findTrades`' options
 * @param {Object} [how]
 * @param {number} [how.sliceMs] work this long, then pause
 * @param {function} [how.pause] `() -> Promise`: hand the event loop back
 * @param {function} [how.stale] `() -> boolean`, asked after every pause: true
 *   abandons the search — the caller's cancel token
 * @returns {Promise<Object|null>} `findTrades`' result, or null when abandoned
 */
export function findTradesSliced(opts, how) {
  return runSliced(findTradesSteps(opts || {}), how);
}

/** Run a step generator a slice at a time; null when `stale` says to stop. */
async function runSliced(steps, { sliceMs = SEARCH_SLICE_MS, pause = null, stale = null } = {}) {
  const rest = pause || (() => new Promise((r) => setTimeout(r, 0)));
  // The cheapest of the last three pauses: one that was slow because the page
  // was busy answering a tap says nothing about what a pause costs.
  const costs = [0, 0, 0];
  let budget = sliceMs;
  let t0 = clock();
  for (let n = 0; ; ) {
    const r = steps.next();
    if (r.done) return r.value;
    const t1 = clock();
    if (t1 - t0 < budget) continue;
    await rest();
    if (stale && stale()) return null;
    t0 = clock();
    costs[n++ % 3] = t0 - t1;
    budget = n < 3 ? sliceMs : Math.min(SEARCH_SLICE_MAX_MS, Math.max(sliceMs, 10 * Math.min(...costs)));
  }
}

function* findTradesSteps({
  teams, myTeamId, slots, measure = typicalWeek, kinds = PACKAGE_KINDS, limit = 40,
  weeks = null, projFor = null, zeroIsBye = true, floors = null,
  weights = null, theirMinPerWeek = null, rankBy = null, theirReach = null,
  meetWeeks = null, exhaustive = false,
  partnerId = null, mustSend = null, mustReceive = null, complete = false,
}) {
  const mine = (teams || []).find((t) => t.id === myTeamId) || null;
  if (!mine) return { offers: [], mine: null, considered: 0, basis: 'measure' };
  const idSet = (list) => new Set((list || []).map((p) => String(idOf(p))));
  const must = { send: idSet(mustSend), receive: idSet(mustReceive) };
  const gates = {};

  // The weekly measure is opt-in and needs BOTH halves — a week list and a way
  // to read a projection for it. Anything less falls back to the scalar
  // measure, which is what every existing caller gets and must keep getting
  // byte for byte.
  const weekly = Array.isArray(weeks) && weeks.length > 0 && typeof projFor === 'function';

  const myScored = weekly
    ? scoreAcrossWeeks(mine.players, weeks, projFor, zeroIsBye).season
    : scored(mine.players, measure);

  let offers = [];
  for (const theirs of teams) {
    if (theirs.id === mine.id) continue;
    if (partnerId !== null && partnerId !== undefined && theirs.id !== partnerId) continue;
    offers = offers.concat(
      weekly
        ? yield* tradesAcrossWeeksSteps(
            myScored, scoreAcrossWeeks(theirs.players, weeks, projFor, zeroIsBye).season,
            theirs, slots, kinds, weeks, floors,
            { weights: Array.isArray(weights) && weights.length === weeks.length ? weights : null,
              theirMinPerWeek,
              theirReach: (() => {
                const r = typeof theirReach === 'function' ? theirReach(theirs.id) : null;
                return Array.isArray(r) && r.length === weeks.length ? r : null;
              })(),
              meet: meetIndices(weeks, typeof meetWeeks === 'function' ? meetWeeks(theirs.id) : null),
              exhaustive: !!exhaustive,
              must, complete: !!complete, gates }
          )
        : yield* tradesWithSteps(myScored, scored(theirs.players, measure), theirs, slots, kinds)
    );
  }

  const considered = offers.length;
  if (typeof rankBy === 'function') {
    for (const o of offers) {
      const r = rankBy(o);
      o.rank = Number.isFinite(r) ? r : null;
    }
  }
  if (complete && weekly) {
    const picked = pickCompletions(offers.slice().sort(compareOffers), gates);
    for (const o of picked) { finishOffer(o); yield; }
    for (const o of offers) delete o.finish;
    return { offers: picked, mine, considered, basis: 'weeks' };
  }
  const ranked = dropRedundant(bestPerTarget(offers)).sort(compareOffers).slice(0, limit);
  // The two churn lists are filled only for the offers handed back.
  for (const o of ranked) { finishOffer(o); yield; }
  for (const o of offers) delete o.finish;

  return {
    offers: ranked,
    mine,
    considered,
    basis: weekly ? 'weeks' : 'measure',
  };
}

// ===========================================================================
// The weekly measure: a roster is worth what it can field EVERY week
// ===========================================================================
//
// THE FLAW THIS FIXES, in the owner's words:
//
//   "I have 3 QBs that all avg low counts, however QB proj avg is much higher,
//    because their proj has wide ranges (15-19) and with 3 players I often can
//    always have a QB with a high (18-19) proj. This means getting a 19 proj QB
//    doesn't really change my team, even though my starter only ever has a
//    season proj of around 17."
//
// He is right, and `lineupValue` above is where it goes wrong. That function
// prices a squad ONCE, on one scalar per man — the season projection over 17 —
// and under a scalar only one quarterback can ever count. Three men averaging
// 16 are worth 16 a week, and a fourth averaging 19 looks like a +3 upgrade.
//
// A real season does not work like that. Each of those three has his own weekly
// number, they move independently, and the manager starts whichever of them is
// at the top of his range THAT WEEK. Three men whose weekly projections swing
// 15-19 will, between them, put an 18 or a 19 in the lineup most weeks — so the
// squad is already getting the value the fourth man was supposed to add, and the
// upgrade is worth almost nothing. That is exactly what he is describing.
//
// So: value a roster as the SUM, over every remaining week, of the best legal
// lineup it could field THAT WEEK on THAT WEEK's own projections. Positional
// depth then falls out with nothing to tune and no new constant — it is simply
// what a max-over-the-week does that a max-over-the-average cannot.
//
// Three consequences worth stating before the code:
//
//   - The numbers are SEASON TOTALS, not weekly ones. A +40 here is +40 over
//     the whole remaining season, roughly +4.4 a week over nine weeks. It is
//     not on the same scale as anything `typicalWeek` produces, and a page
//     showing both must say which one it is showing.
//   - Byes stop being a special case and become the point. ESPN returns 0.00
//     for a man on bye, which is a number and not a null, so `optimalLineup`
//     ranks him last and the week re-picks around him — which is what the
//     manager does. `typicalWeek` had to AVOID byes; this measure handles them
//     by construction, and a squad with no cover in week 12 is correctly worth
//     less than one that has some.
//   - `optimalLineup` is still `js/forecast.js`'s, run once per week. Three
//     features share that function so they cannot disagree about who a squad
//     ought to be starting; this is the fourth, and it does not get a copy
//     either.

/**
 * Score one roster ONCE for every remaining week.
 *
 * This is the weekly answer to the comment on `scored()` above, and for the
 * same reason: the finder's inner loop runs tens of thousands of times, and
 * doing nine lineup fills inside each is already nine times the work. Calling
 * `projFor` and rebuilding player objects in there as well would be nine times
 * the allocation on top, for numbers that never change.
 *
 * Each entry that comes back carries both views of the same man:
 *
 *   `projected`  his REST-OF-SEASON total — every week added up. That is what
 *                the existing `candidates()` ranks by and what `afterTrade()`
 *                breaks a tie between equally cheap cuts by (since 2026-09-30
 *                the cut itself is the man whose loss costs the weeks least).
 *   `weekly[i]`  a ready-made player object for `weeks[i]`, whose `projected`
 *                is that week's number. `optimalLineup` reads these directly.
 *   `perWeek`    what he is worth IN A WEEK HE SCORES — see below. DISPLAY
 *                ONLY: nothing in this file prices, ranks or cuts on it.
 *
 * A week ESPN has no number for is `null`, which `optimalLineup` drops from the
 * pool entirely — a different fact from a 0.00 bye, and that distinction is the
 * one rule 2 in HANDOFF.md exists to protect. IT IS STILL PROTECTED HERE, and
 * the change of 2026-09-20 below does not touch it: a null and a 0.00 remain
 * two different things in `weekly[i]`, in every lineup filled from it and in
 * `projected`. What changed is one printed average, which now excludes both.
 *
 * ---------------------------------------------------------------------------
 * `perWeek` IS THE MEAN OVER THE WEEKS THAT CARRY A PROJECTION ABOVE ZERO
 *
 * Tim, 2026-09-20, about a man on his own roster: "the weekly avg in the trade
 * menu of the player doesn't actually reflect the real future proj averages.
 * For example, Nico Collins displays 14.2, however 100% of his future weeks are
 * proj above 14.2, except for his BYE week … it should only calculate future
 * weeks that actually project any points at all, and then set the avg there."
 *
 * A printed average that is BELOW every week it was computed from is not a
 * rounding quibble; it is the number failing to mean anything. So the divisor
 * is now the weeks that actually carry a number greater than zero, and
 * everything else leaves it outright:
 *
 *   0.00   a bye. Points he genuinely will not score, so it stays in
 *          `projected` — and it is no evidence about what he is worth in a week
 *          he plays, so it is out of the divisor. (This half was already true.)
 *   0.00   a genuine zero — an OUT or IR man, whom ESPN also projects at
 *          exactly 0.00 in an ordinary week, or a demo player ruled out. OUT of
 *          the divisor now. See "the consequence" below; it is the one that
 *          flatters.
 *   null   ESPN carried no number for him that week — OR this page has not read
 *          that week yet, which `projFor` cannot tell apart from the first
 *          (a week absent from the cache reads null for everybody). OUT of the
 *          divisor now.
 *
 * THE NULL RULE WAS THE OPPOSITE OF THIS UNTIL 2026-09-20, DELIBERATELY, AND
 * TIM REVERSED IT. What stood here, at length, was: "a man ESPN is quiet about
 * is not a man on bye, and quietly promoting 'we do not know' into 'he does not
 * play' would inflate every player the data is thin on." That argument is not
 * wrong about what a null MEANS — it is wrong about what the printed number
 * CLAIMS. An average beside a man's name is read as "what he is worth in a week
 * he plays", and a divisor holding weeks with no number in them cannot mean
 * that: it prints a fact about how much of the span this browser happened to
 * have read as though it were a fact about the player. That is exactly what Tim
 * caught — the Trade page buys its weeks in batches, so a man's figure sagged
 * while the span filled in. His reading wins, and it wins on the meaning of the
 * words on screen rather than on the meaning of the data underneath.
 *
 * THE CONSEQUENCE, STATED RATHER THAN HIDDEN: a man who is OUT or on IR for
 * several of the remaining weeks no longer has those zeros dragging his average
 * down. His per-week figure becomes what he is worth in a week he actually
 * plays, which is what was asked for and is the right number to trade on — but
 * it is a FLATTERING number for an injured man, and it is not what he is worth
 * to a season. The number that does count those weeks is the deal's own gain,
 * which is a sum over every week in the span, zeros and all; the panel notes on
 * js/trade-page.js say so in those words.
 *
 * So `projected` is NOT `perWeek × weeks.length`, and it is further from it
 * than it used to be — the divisor is a smaller set of weeks than before. It is
 * `perWeek × weeksScoring`, give or take a rounding tenth and any week with a
 * negative projection in it, which is why `weeksScoring` comes back beside the
 * numbers rather than being left for a page to infer. A man with NO such week
 * has no per-week value at all and gets `null` — never a division by zero, and
 * never a 0.0 that would read as "he is worth nothing" rather than "there is
 * nothing to say". `optimalLineup` drops a null from the pool, which is the
 * existing and correct treatment.
 *
 * A NEGATIVE week (rare, and only a defence) is a real projection for a week he
 * plays, and it stays in `projected` — but the test is "more than zero", so it
 * is out of the divisor with the zeros. Stated because it is a real asymmetry
 * and not an oversight: it is the same flattering direction as the OUT rule
 * above, on a hundredth of the players.
 */
/**
 * `zeroIsBye` — a flag, or `(player, week) -> boolean` — IS STILL ACCEPTED AND
 * NO LONGER CHANGES A NUMBER.
 *
 * It existed for one job: deciding which zeros left the `perWeek` divisor, back
 * when a bye left it and a ruled-out zero did not. Under Tim's rule above EVERY
 * zero leaves it, so the distinction has nothing left to decide here.
 *
 * It stays in the signature because four exported functions in this file and
 * several call sites outside it pass it, and ripping a parameter out of a
 * public contract is a different change from the one being made today. It is
 * not dead weight in the caller either: js/trade-page.js needs the same
 * bye/ruled-out distinction to DRAW a week (`zeroKind` in js/player-card.js),
 * and the one it passes here is the one it already has.
 *
 * If it is ever removed, remove it from every exported signature at once — an
 * option that silently stops being read is how one caller ends up believing it
 * is asking for something.
 */
function scoreAcrossWeeks(players, weeks, projFor, zeroIsBye = true) {
  const ws = (weeks || []).slice();
  const read = typeof projFor === 'function' ? projFor : () => null;

  const season = (players || []).map((p) => {
    const weekly = new Array(ws.length);
    let sum = 0;
    let counted = 0;
    // The two halves of the average, kept apart from `sum` on purpose: a
    // negative week belongs in the season total and not in the divisor, so
    // adding `sum` up and dividing by a count of the positive weeks would be a
    // third number that is neither.
    let scoringSum = 0;
    let scoring = 0;
    for (let i = 0; i < ws.length; i++) {
      const raw = read(p, ws[i]);
      const v = Number.isFinite(raw) ? raw : null;
      weekly[i] = { ...p, projected: v, week: ws[i] };
      if (v !== null) {
        sum += v;
        counted++;
        if (v > 0) {
          scoringSum += v;
          scoring++;
        }
      }
    }
    return {
      ...p,
      projected: counted ? round1(sum) : null,
      // The weeks that carry a number above zero, and only those. A bye, a
      // ruled-out zero, a week ESPN is quiet about and a week this page has not
      // read yet are all absent from the divisor — see the note above.
      perWeek: scoring > 0 ? round1(scoringSum / scoring) : null,
      weeksCounted: counted,
      // WAS `weeksPlayable` until 2026-09-20, and the rename is the point: the
      // divisor is no longer "the weeks he could play", it is the weeks he is
      // projected to score in. A man ruled out for three weeks is playable in
      // none of them and the old name would now be a lie about the number
      // beside it.
      weeksScoring: scoring,
      weekly,
    };
  });

  return { weeks: ws, season };
}

/** The roster as it looks in one week — the objects `optimalLineup` reads. */
const atWeek = (roster, i) => roster.map((p) => p.weekly[i]);

/**
 * Totals only, for the inner loop. The lineups are thrown away, because nothing
 * in the search reads them and ten thousand discarded lineups is ten thousand
 * arrays of nine copied players.
 */
function totalAcrossWeeks(roster, slots, weekCount, floors = null) {
  const weekTotals = new Array(weekCount);
  let total = 0;
  for (let i = 0; i < weekCount; i++) {
    const best = optimalLineup(atWeek(roster, i), slots);
    const t = assessLineup(best.starters, slots, floors).total;
    weekTotals[i] = t;
    total += t;
  }
  return { total: round1(total), weekTotals };
}

/** The same thing with the lineups kept — for the handful of results reported. */
function fillAcrossWeeks(roster, slots, ws, floors = null) {
  const byWeek = [];
  let total = 0;
  for (let i = 0; i < ws.length; i++) {
    const lineup = optimalLineup(atWeek(roster, i), slots);
    // The floor is applied to the ASSESSMENT, never to the choice: `lineup`
    // is still the best legal lineup on ESPN's own numbers. `cells` carries
    // which slots were lifted, so the pop-up can mark them.
    const a = assessLineup(lineup.starters, slots, floors);
    total += a.total;
    byWeek.push({
      week: ws[i], total: a.total, starters: lineup.starters,
      raw: a.rawTotal, assumed: a.assumed, cells: a.cells,
    });
  }
  return { total: round1(total), byWeek };
}

/**
 * What a roster is worth across the rest of the season.
 *
 * The sum, over every remaining week, of the best legal lineup that roster
 * could field in that week on that week's own projections.
 *
 * @param {Array}  players roster entries as `fetchWeekRosters` returns them
 * @param {number[]} slots lineupSlotIds the league starts
 * @param {number[]} weeks the remaining weeks, ascending
 * @param {(player:Object, week:number) => number|null} projFor
 * @param {Map} [floors] the positional floor; omit for none (js/floor.js)
 * @returns {{total:number, byWeek: Array<{week:number, total:number, starters:Array}>}}
 */
export function seasonLineupValue(players, slots, weeks, projFor, floors = null) {
  // No `zeroIsBye` here on purpose: this returns totals and lineups, neither of
  // which the zero rule touches. A bye is a real 0 in a real week either way —
  // and since 2026-09-20 the option decides nothing at all (see
  // `scoreAcrossWeeks`), so passing it would be theatre.
  const { weeks: ws, season } = scoreAcrossWeeks(players, weeks, projFor);
  return fillAcrossWeeks(season, slots, ws, floors);
}

// --------------------------------------------------------- pricing one trade

/**
 * ONE forced cut for the whole season, not a fresh one every week.
 *
 * `afterTrade` already models the cut a lopsided package forces: take two, send
 * one, and you are a man over the limit, so your worst man goes. Across weeks
 * there is a choice about WHEN that decision is made, and it matters:
 *
 *   - Cut per week, and the model quietly keeps the best sixteen available in
 *     every single week — a manager who drops his fifth receiver in week 9 and
 *     has him back in week 10. That flatters every package that forces a cut,
 *     which is the wrong direction to be wrong in.
 *   - Cut once, on rest-of-season value, and the same man is gone for all of
 *     them. That is what actually happens, and it is what this does.
 *
 * Since 2026-09-30 WHICH man goes is the one whose removal costs the lineups
 * the fewest points over exactly these weeks (see `afterTrade`), with the
 * rest-of-season total (`projected` on these entries) as the tie-break — so the
 * weeks, slots and floors being priced are handed to it here.
 */
function rosterAcrossWeeksAfter(season, send, joining, slots, n, floors) {
  return afterTrade(season, send || [], joining, { slots, n, floors, view: atWeek }).roster;
}

/**
 * Price one trade across every remaining week.
 *
 * `send` may be players or bare ids; `receive` must be the partner's actual
 * roster entries, because `projFor` is asked for THEIR projections and an id
 * carries none.
 *
 * @param {Object} opts
 * @param {Array}  opts.players  your roster
 * @param {Array}  opts.send     what leaves (players or ids)
 * @param {Array}  opts.receive  what arrives (the partner's roster entries)
 * @param {number[]} opts.slots
 * @param {number[]} opts.weeks
 * @param {function} opts.projFor
 * @param {boolean|function} [opts.zeroIsBye] is a 0.00 a bye? See `isBye`.
 * @returns {{before:Object, after:Object, delta:number,
 *            byWeek:Array<{week:number, before:number, after:number, delta:number}>,
 *            churn:{in:Array, out:Array}, cut:Array, roster:Array}}
 */
export function priceTradeAcrossWeeks({
  players, send = [], receive = [], slots, weeks, projFor, zeroIsBye = true, floors = null,
}) {
  const { weeks: ws, season } = scoreAcrossWeeks(players, weeks, projFor, zeroIsBye);
  const joining = scoreAcrossWeeks(receive, ws, projFor, zeroIsBye).season;

  const before = fillAcrossWeeks(season, slots, ws, floors);
  const kept = rosterAcrossWeeksAfter(season, send, joining, slots, ws.length, floors);
  const after = fillAcrossWeeks(kept, slots, ws, floors);

  // Who the roster limit forced out, as distinct from who was traded away — a
  // page that does not name him is hiding the cost of the deal.
  const survived = new Set(kept);
  const gone = new Set((send || []).map(idOf));
  const cut = season.concat(joining)
    .filter((p) => !survived.has(p) && !gone.has(p.playerId));

  return {
    before,
    after,
    delta: round1(after.total - before.total),
    byWeek: ws.map((week, i) => ({
      week,
      before: before.byWeek[i].total,
      after: after.byWeek[i].total,
      delta: round1(after.byWeek[i].total - before.byWeek[i].total),
    })),
    // Who gains lineup time and who loses it, in the same shape the finder's
    // rows print. It is computed here rather than by the caller because the two
    // fills it needs are already in hand — asking a page to rebuild them would
    // be nine more lineup fills for numbers that are sitting right there, and a
    // second way of deriving one answer. Same `in` minus `out` IS the gain
    // property the finder's own churn has.
    churn: weeklyChurn(contributions(before), contributions(after)),
    cut,
    roster: kept,
  };
}

// --------------------------------------- explaining a weekly trade in words
//
// The scalar finder explains an offer with `positionDeltas` and `lineupChurn`,
// both of which compare ONE lineup against ONE lineup. Across nine weeks there
// are nine lineups a side, and a man can start in six of them before and eight
// of them after. So the weekly versions work on what each man and each position
// actually CONTRIBUTED over the whole span, and each entry carries the CHANGE
// in that contribution rather than a projection.
//
// That keeps the property the scalar version has and the tests lean on: what
// walks in minus what walks out IS the gain. A list that does not add up to the
// number beside it is decoration.

/** Season points each man and each position put into the lineups. */
function contributions(fill) {
  const byPlayer = new Map();
  const byPosition = new Map();
  for (const wk of fill.byWeek) {
    for (const s of wk.starters) {
      const held = byPlayer.get(s.playerId);
      if (held) {
        held.points += s.projected;
        held.weeks += 1;
      } else {
        byPlayer.set(s.playerId, {
          playerId: s.playerId,
          name: s.name,
          position: s.position,
          points: s.projected,
          weeks: 1,
        });
      }
      byPosition.set(s.position, (byPosition.get(s.position) || 0) + s.projected);
    }
  }
  return { byPlayer, byPosition };
}

/** Where the season's points moved, position by position. */
function weeklyPositionDeltas(was, now) {
  const out = [];
  for (const position of new Set([...was.byPosition.keys(), ...now.byPosition.keys()])) {
    const delta = round1(
      (now.byPosition.get(position) || 0) - (was.byPosition.get(position) || 0)
    );
    if (delta !== 0) out.push({ position, delta });
  }
  return out.sort((a, b) => b.delta - a.delta);
}

/**
 * Who gains lineup time and who loses it.
 *
 * `value` is the CHANGE in a man's season contribution, not his projection, so
 * a starter who merely picks up two extra weeks appears with what those two
 * weeks are worth rather than with his whole season. `weeks` beside it is how
 * many weeks he starts afterwards (in) or beforehand (out), which is what makes
 * the number readable, and `wasStarting`/`nowStarting` separate "he is new to
 * the lineup" from "he is in it more often".
 */
function weeklyChurn(was, now) {
  const ids = new Set([...was.byPlayer.keys(), ...now.byPlayer.keys()]);
  const gained = [];
  const lost = [];
  for (const id of ids) {
    const a = was.byPlayer.get(id);
    const b = now.byPlayer.get(id);
    const delta = round1((b ? b.points : 0) - (a ? a.points : 0));
    if (delta === 0) continue;
    const who = b || a;
    const entry = {
      playerId: who.playerId,
      name: who.name,
      position: who.position,
      value: Math.abs(delta),
      weeks: delta > 0 ? (b ? b.weeks : 0) : (a ? a.weeks : 0),
      wasStarting: !!a,
      nowStarting: !!b,
    };
    (delta > 0 ? gained : lost).push(entry);
  }
  const bySize = (x, y) => y.value - x.value;
  return { in: gained.sort(bySize), out: lost.sort(bySize) };
}

// --------------------------------------------- the finder, on weekly numbers

/**
 * Every trade with this partner that makes BOTH squads better over the rest of
 * the season — the weekly twin of `tradesWith`.
 *
 * Shape for shape it is the same search and the same offer object, so a page
 * can render either. Three things differ, all of them forced by the measure:
 *
 *   - Nine lineup fills replace one, hence `totalAcrossWeeks` in the loop and
 *     the full `fillAcrossWeeks` only for the offers that survive it.
 *   - The gain floor scales with the span. `MIN_GAIN` is 0.1 because a tenth of
 *     a point a week is float noise; across nine weeks the same noise adds up to
 *     nearly a point, so the floor has to add up with it.
 *   - `myBefore`/`myAfter`/`myGain` are SEASON totals. `basis: 'weeks'` says so
 *     on every offer, because a page that mixed the two scales would be wrong by
 *     a factor of nine and look perfectly plausible doing it.
 *
 * THE FREE-GIFT CEILING is what keeps this affordable. A package cannot
 * possibly be worth more to you than being handed those players for nothing —
 * nobody sent back, nobody cut — because the roster a trade actually leaves you
 * is a SUBSET of your roster plus theirs, and a best lineup over a subset can
 * never beat the best lineup over the whole. So the ceiling is computed ONCE per
 * incoming package, and every package whose ceiling is below the floor is thrown
 * out before a single send is tried. Same for the partner, per outgoing package.
 * That is 342 extra fills a partner to skip tens of thousands, and it cannot
 * change the answer — it only ever rules out packages that could not have made
 * the floor anyway.
 */
function tradesAcrossWeeks(myScored, theirScored, theirs, slots, kinds, weeks, floors = null, options = {}) {
  return drain(tradesAcrossWeeksSteps(myScored, theirScored, theirs, slots, kinds, weeks, floors, options));
}

/**
 * The search itself, as STEPS: a generator that stops (`yield`, no value) after
 * each piece of real work — a ceiling, a gifted roster, one send priced — and
 * returns the offers found. Run straight through (`drain`) it is the search
 * exactly as it always was; `findTradesSliced` runs the same steps a few
 * milliseconds at a time, so one body serves both and they cannot disagree.
 */
function* tradesAcrossWeeksSteps(myScored, theirScored, theirs, slots, kinds, weeks, floors = null, options = {}) {
  const n = weeks.length;
  // `minGain`, not `floor`. Since 2026-09-18 "the floor" means the POSITIONAL
  // floor everywhere on this site — the wire's best man at a position, which
  // no slot is assessed below — and two different floors in one function is
  // how somebody later passes the wrong one.
  const minGain = MIN_GAIN * Math.max(1, n);

  const myBase = totalAcrossWeeks(myScored, slots, n, floors);
  const theirBase = totalAcrossWeeks(theirScored, slots, n, floors);

  // Hoisted for the same reason `scored()` is: these two never change, and
  // re-filling eighteen lineups inside the loop would be most of the cost.
  const myBaseFill = fillAcrossWeeks(myScored, slots, weeks, floors);
  const theirBaseFill = fillAcrossWeeks(theirScored, slots, weeks, floors);
  const mineWas = contributions(myBaseFill);
  const theirsWas = contributions(theirBaseFill);

  // THE MEN A PACKAGE MUST CARRY (`mustSend`/`mustReceive`, the custom box's
  // ticks). They are pieces whatever the caps say — a man ticked from the
  // bottom of a roster is still in the deal — and they count as top pieces
  // for the 2-for-2 rule. Every other piece and every limit is the finder's.
  const must = options.must || { send: new Set(), receive: new Set() };
  const withMust = (scoredList, need) => {
    const list = candidates(scoredList);
    if (!need.size) return list;
    const have = new Set(list.map((p) => String(p.playerId)));
    for (const p of scoredList) {
      if (need.has(String(p.playerId)) && !have.has(String(p.playerId))) list.push(p);
    }
    return list;
  };
  const myCands = withMust(myScored, must.send);
  const theirCands = withMust(theirScored, must.receive);
  const holds = (need) => (pkg) => {
    if (!need.size) return true;
    let n = 0;
    for (const p of pkg) if (need.has(String(p.playerId))) n++;
    return n === need.size;
  };
  const myPackages = packages(myCands).filter(holds(must.send));
  const theirPackages = packages(theirCands).filter(holds(must.receive));
  const myTop = topIds(myCands);
  const theirTop = topIds(theirCands);
  for (const id of must.send) myTop.add(myCands.find((p) => String(p.playerId) === id)?.playerId);
  for (const id of must.receive) theirTop.add(theirCands.find((p) => String(p.playerId) === id)?.playerId);
  // COMPLETIONS (`complete`): no gate on either side, so nothing to prune by.
  const complete = !!options.complete;

  // THE GOAL WEIGHTS (2026-09-21). With them, MY side is judged on the
  // weighted gain — Σ weight × (after − before), a week at a time — and the
  // points are kept alongside for printing. Weights are ≥ 0, so the gifted
  // roster's weighted gain is still a ceiling on any real trade's, and the
  // pruning below stays exact.
  const w = options.weights;
  const weigh = (after, before) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += w[i] * (after[i] - before[i]);
    return round1(s);
  };
  // HIS side: the least his lineup may gain. By default he must gain, as
  // always; the goal-ranked page lets in deals he might still accept at a
  // small loss, and discounts them by the yes-chance instead of hiding them.
  //
  // AND OVER THE WEEKS HE WILL PLAY (trade plan Phase 3). `reach` is the chance
  // he plays each week — 1 in the regular season, less in the bracket — so his
  // gain is Σ reach × (after − before), and the tolerance is per week he is
  // EXPECTED to play rather than per week of the span. Without it a partner's
  // gain added up a final he reaches one season in four as if it were certain.
  const reach = options.theirReach;
  const theirWeeks = reach ? reach.reduce((a, r) => a + r, 0) : n;
  const theirOf = (after) => {
    if (!reach) return round1(after.total - theirBase.total);
    let s = 0;
    for (let i = 0; i < n; i++) s += reach[i] * (after.weekTotals[i] - theirBase.weekTotals[i]);
    return round1(s);
  };
  const theirMin = Number.isFinite(options.theirMinPerWeek)
    ? Math.min(minGain, options.theirMinPerWeek * theirWeeks)
    : minGain;
  // The two gates as the finder applies them — handed back for the
  // suggestion list's "good enough for a fourth row" test (`pickCompletions`).
  if (options.gates) { options.gates.minGain = minGain; options.gates.theirMin = theirMin; }
  const keepMin = complete ? -Infinity : minGain;
  const keepTheirMin = complete ? -Infinity : theirMin;

  // How a week is solved for the forced cut — the same fill and assessment as
  // every total in this search (see `afterTrade`).
  const cutCtx = { slots, n, floors, view: atWeek };

  // What each of my packages is worth to HIM at the very most. Still a ceiling
  // with `reach`: the gifted roster fields at least as much in every week, and
  // every reach is ≥ 0.
  const prune = !options.exhaustive && !complete;
  const ceilingForThem = prune ? new Array(myPackages.length) : null;
  if (prune) {
    for (let k = 0; k < myPackages.length; k++) {
      ceilingForThem[k] = theirOf(totalAcrossWeeks(theirScored.concat(myPackages[k]), slots, n, floors));
      yield;
    }
  }

  // THE WEEKS YOU PLAY HIM, NETTED (Tim, 2026-09-30: "add the change in
  // opponent proj to the total +/- gain"). `meet` holds the indices of the
  // priced weeks in which this partner is your opponent; his lineup change in
  // each of them is your loss, so the figure an offer is KEPT and RANKED by is
  //   net = Σ w·(your change) − Σ_meet w·(his change)
  // (w = 1 without goal weights; his change rounded to the tenth, exactly as
  // `theirByWeek` prints it, so the page's "His proj vs you" adds up to it).
  // `myGain`, `byWeek` and `theirByWeek` stay RAW — the season simulation plays
  // both squads' own changes (D2) and would count his twice otherwise.
  const meet = Array.isArray(options.meet) && options.meet.length ? options.meet : null;
  const wAt = (i) => (w ? w[i] : 1);
  const oppOf = (theirWeekTotals) => {
    let s = 0;
    let weighted = 0;
    for (const i of meet) {
      const d = round1(theirWeekTotals[i] - theirBase.weekTotals[i]);
      s += d;
      weighted += wAt(i) * d;
    }
    return { sum: round1(s), weighted };
  };
  // THE CEILING ON WHAT NETTING CAN ADD. Netting can make a deal worth MORE
  // to you than your own lineup gain — he gets weaker in the week he plays
  // you — so the gifted ceiling below is no longer a ceiling on the net, and
  // pruning on it alone would silently drop deals. What it adds is at most
  // Σ_meet w·(his week before − the least his week can be after the deal).
  //
  // The least it can be: he keeps his roster minus what he sends you, plus
  // what you send him, minus at most ONE forced cut — and only when you send
  // more men than you take (two for one; MAX_PACKAGE caps the overshoot at
  // one). With no cut his after roster CONTAINS (his − sent), so a week is at
  // least that roster's best. With the cut it contains (his − sent − one
  // man), so a week is at least the worst of those removals — whichever man
  // the season-long cut picks, which is chosen on ALL the priced weeks and so
  // can be the one this week needs most. Both bounds lean on the gifted
  // ceiling's own premise: a best lineup over a subset never beats the
  // superset's. tests/test-trade-net.mjs proves the pruned search keeps the
  // exact set an unpruned one keeps, floors on and off.
  //
  // `NET_SLACK` covers the rounding of the netted figure (each meeting week
  // rounded to a tenth on its own), so a bound is never beaten by a hair.
  const NET_SLACK = meet ? 0.05 * (meet.length + 2) : 0;
  const meetCeilings = (receive) => {
    if (!meet) return { noCut: 0, cut: 0 };
    const taken = new Set(receive.map((p) => p.playerId));
    const left = theirScored.filter((p) => !taken.has(p.playerId));
    let noCut = 0;
    let cut = 0;
    for (const i of meet) {
      const base = solveWeek(left, i, cutCtx);
      let least = base.total;
      // A cut is only possible if I can send more than I take.
      if (receive.length < MAX_PACKAGE) {
        for (const id of base.ids) {
          const t = solveWeek(left.filter((p) => p.playerId !== id), i, cutCtx).total;
          if (t < least) least = t;
        }
      }
      noCut += wAt(i) * (theirBase.weekTotals[i] - base.total);
      cut += wAt(i) * (theirBase.weekTotals[i] - least);
    }
    return { noCut, cut };
  };

  const found = [];
  // Receive is the outer loop now, so a package that cannot help me at all
  // skips every send rather than being re-rejected once per send.
  for (const receive of theirPackages) {
    // The gifted roster — mine plus theirs, nothing sent, nobody cut. Its
    // lineups are the ceiling AND, below, the shortcut.
    const giftedPool = myScored.concat(receive);
    const gifted = fillAcrossWeeks(giftedPool, slots, weeks, floors);
    const giftedCeiling = w
      ? weigh(gifted.byWeek.map((x) => x.total), myBase.weekTotals)
      : round1(gifted.total - myBase.total);
    // Only a bound for pruning — not needed when nothing is pruned.
    const extra = prune ? meetCeilings(receive) : { noCut: 0, cut: 0 };
    const extraMax = Math.max(extra.noCut, extra.cut);
    yield;
    if (prune && giftedCeiling + extraMax + NET_SLACK < minGain) continue;
    const giftedStarters = gifted.byWeek.map((wk) => new Set(wk.starters.map((s) => s.playerId)));

    for (let k = 0; k < myPackages.length; k++) {
      const send = myPackages[k];
      if (prune && ceilingForThem[k] < theirMin) continue;
      if (send.length === 2 && receive.length === 2 &&
          !twoForTwoAllowed(send, receive, myTop, theirTop)) continue;

      const kind = packageKind(send, receive);
      if (!kinds.includes(kind)) continue;
      // One stop per send that is actually priced; the skips above cost nothing.
      yield;

      // Mine first, and bail before touching theirs — the same reason as the
      // scalar search, and nine times as good a reason.
      //
      // The roster BEFORE the forced cut is the gifted one minus what is sent.
      // A week where no sent man was going to START is a week the send does
      // not touch: taking a bench player off a roster cannot change the best
      // lineup that roster could field, because the lineup it already fields
      // is still available. So that week's fill is skipped outright and the
      // gifted week stands. Exact, not an approximation — and it is most of
      // the loop, because most packages move men who were not starting.
      const sentIds = send.map((p) => p.playerId);
      const preRoster = myScored.filter((p) => !sentIds.includes(p.playerId)).concat(receive);
      const preSolved = new Array(n);
      for (let i = 0; i < n; i++) {
        preSolved[i] = sentIds.some((id) => giftedStarters[i].has(id))
          ? solveWeek(preRoster, i, cutCtx)
          : { total: gifted.byWeek[i].total, ids: giftedStarters[i] };
      }
      // Then the cut, chosen on those same weeks (see `afterTrade`). It hands
      // back the after-trade weeks, re-filled only where the man cut started.
      const myCut = afterTrade(myScored, send, receive, cutCtx, preSolved);
      const myRoster = myCut.roster;
      let total = 0;
      const weekTotals = new Array(n);
      for (let i = 0; i < n; i++) {
        weekTotals[i] = myCut.solved[i].total;
        total += weekTotals[i];
      }
      const myAfter = { total: round1(total), weekTotals };
      const myGain = round1(myAfter.total - myBase.total);
      const myGoal = w ? weigh(weekTotals, myBase.weekTotals) : null;
      // Your own side, plus the most netting could still add for this shape
      // (a cut on his side only when you send more than you take).
      const mineOnly = w ? myGoal : myGain;
      const canAdd = send.length > receive.length ? extra.cut : extra.noCut;
      if (prune && mineOnly + canAdd + NET_SLACK < minGain) continue;

      const takenIds = receive.map((p) => p.playerId);
      const hisCut = afterTrade(theirScored, receive, send, cutCtx,
        solveWeeks(theirScored.filter((p) => !takenIds.includes(p.playerId)).concat(send), cutCtx));
      const theirRoster = hisCut.roster;
      let theirTotal = 0;
      const theirWeekTotals = new Array(n);
      for (let i = 0; i < n; i++) {
        theirWeekTotals[i] = hisCut.solved[i].total;
        theirTotal += theirWeekTotals[i];
      }
      const theirAfter = { total: round1(theirTotal), weekTotals: theirWeekTotals };
      // Netted: his change in the weeks he plays you comes off your side.
      const opp = meet ? oppOf(theirWeekTotals) : null;
      const netGain = opp ? round1(myGain - opp.sum) : myGain;
      const goalPoints = w ? (opp ? round1(myGoal - opp.weighted) : myGoal) : null;
      if ((w ? goalPoints : netGain) < keepMin) continue;
      const theirGain = theirOf(theirAfter);
      if (theirGain < keepTheirMin) continue;

      const offer = {
        partner: theirs,
        send,
        receive,
        kind,
        shape: `${send.length}-for-${receive.length}`,
        basis: 'weeks',
        weeks: weeks.slice(),
        // YOUR LINEUP's change over the span — raw, his side not in it.
        myGain,
        // NETTED (2026-09-30): `myGain` minus his lineup change in the weeks
        // he plays you (`meetWeeks`, the week numbers; `oppChange`, their
        // sum). The figure the page prints as the gain and the finder keeps
        // and ranks by. Equal to `myGain` with no meeting weeks.
        netGain,
        meetWeeks: meet ? meet.map((i) => weeks[i]) : [],
        oppChange: opp ? opp.sum : null,
        // The goal-weighted gain the offer was kept and ranked by, or null
        // when no weights were given. Points-equivalent: a week of average
        // weight counts its points once. NETTED like `netGain` when meeting
        // weeks were given (his change in a meeting week at that week's
        // weight); `myGoalPoints` is your side alone.
        goalPoints,
        myGoalPoints: myGoal,
        // His gain over the weeks he will play when `reach` was given, and his
        // flat points over the span either way. `theirWeeks` is what a per-week
        // figure of `theirGain` divides by: the weeks he is expected to play.
        theirGain,
        theirPoints: round1(theirAfter.total - theirBase.total),
        theirWeeks: reach ? theirWeeks : null,
        myBefore: myBase.total,
        myAfter: myAfter.total,
        theirBefore: theirBase.total,
        theirAfter: theirAfter.total,
        // Per week, so a deal that is +5 on average and −12 in the weeks that
        // decide the season is visible rather than averaged away.
        byWeek: weeks.map((week, i) => ({
          week,
          before: myBase.weekTotals[i],
          after: myAfter.weekTotals[i],
          delta: round1(myAfter.weekTotals[i] - myBase.weekTotals[i]),
        })),
        // HIS side, the same shape. js/trade-odds.js plays both changes out
        // in the season simulation: a deal that strengthens a rival is a
        // different deal from one that strengthens a team you never meet.
        theirByWeek: weeks.map((week, i) => ({
          week,
          before: theirBase.weekTotals[i],
          after: theirAfter.weekTotals[i],
          delta: round1(theirAfter.weekTotals[i] - theirBase.weekTotals[i]),
        })),
      };
      // The two lists the row prints need both lineups kept, a fill a side —
      // so they are filled only for the offers `findTrades` hands back.
      offer.finish = () => {
        const mineNow = contributions(fillAcrossWeeks(myRoster, slots, weeks, floors));
        const theirsNow = contributions(fillAcrossWeeks(theirRoster, slots, weeks, floors));
        offer.yourMoves = weeklyPositionDeltas(mineWas, mineNow);
        offer.theirMoves = weeklyPositionDeltas(theirsWas, theirsNow);
        offer.yourChurn = weeklyChurn(mineWas, mineNow);
        offer.theirChurn = weeklyChurn(theirsWas, theirsNow);
      };
      found.push(offer);
    }
  }
  return found;
}

// ===========================================================================
// bestCombo — the best set of offers that can all be made at once
// ===========================================================================
//
// THE TRAP THIS EXISTS TO AVOID, and it produces confident wrong numbers in
// silence: a combo's gain is NOT the sum of its trades' gains.
//
// Every offer's `myGain` was measured against your CURRENT roster. Make two of
// them and the second one's gain was measured against a roster that no longer
// exists. Both of them re-fill the same lineup, so their benefits OVERLAP: two
// trades that each upgrade your quarterback do not both upgrade it — they
// compete for the same slot, and the better one wins. Add the two gains up and
// you have promised the manager twice what he is going to get.
//
// So there is exactly one way to price a combo, and it is the one below: apply
// every send and every receive TOGETHER, and price the resulting roster ONCE
// with `priceTradeAcrossWeeks`. The naive sum is still computed — as
// `naiveDelta`, so a page can SHOW the gap rather than the engine hiding it.
//
// ---------------------------------------------------------------------------
// What makes two offers compatible
//
// A player can only be traded once. That is the owner's constraint, and it is a
// disjointness condition over the UNION of `send` and `receive` ids: you cannot
// send the same man to two managers, you cannot receive him from two, and you
// cannot send a man you have just traded away.
//
// TWO OFFERS WITH THE SAME PARTNER are treated as compatible when their player
// sets are disjoint, and that is a DECISION rather than an obvious truth. In
// practice one manager proposes one deal, and two separate trades with the same
// man on the same day is not how a league tends to work — but they are not
// illegal, and two disjoint deals with him are genuinely one bigger deal he
// might take. So the engine allows them, flags any packing that repeats a
// partner as `repeatPartners`, and takes `onePerPartner: true` for a page that
// would rather not offer something socially odd. Worth confirming with the
// owner; it is the one place here where the rule is a judgement call.
//
// ---------------------------------------------------------------------------
// Roster size
//
// A combo moves several players at once, so the forced cut has to be applied to
// the COMBINED result and not offer by offer. Two 1-for-2s leave you two men
// over the limit and cost you two players; pricing them separately would charge
// you one cut twice over, which is a different and smaller number.
// `priceTradeAcrossWeeks` takes the whole package, so it gets this right by
// construction, and the `cut` list it returns names who went.
//
// ---------------------------------------------------------------------------
// And the partner has to still want it
//
// Each offer was a win-win on its own. Two of them with the SAME manager can
// still leave him worse off together, for exactly the reason above running the
// other way. When `teams` is supplied every partner's combined result is priced
// too, and a packing any partner would refuse is dropped. Without `teams` that
// check cannot be made and the packing is reported unchecked.

/**
 * How many offers the exhaustive search will consider.
 *
 * Every subset of the offers is a candidate packing, so the work is 2^n before
 * disjointness prunes it. Twelve is comfortably exhaustive and is already more
 * trades than any league makes in a week — and because the pool is sorted by
 * gain first, the offers dropped are the ones nobody would have proposed.
 *
 * MEASURED 2026-09-19, because "the offers dropped are the ones nobody would
 * have proposed" was an argument rather than a number, and it is only half
 * true. Demo league, weeks 5-13, best packing at cap 12 against cap 24:
 *
 *   no floors     avg pool 34 offers / 6.4 partners
 *                 the cap costs gain on 7 of 10 squads, +1.31 a week on average
 *                 (worst: 5.99 -> 8.64 a week, 2 trades -> 6)
 *   floors x0.85  avg pool 16 offers / 5.2 partners — 1 squad, +0.31 a week
 *   floors x1.0   avg pool 13 offers / 4.2 partners — none at all
 *
 * So the cap binds on an UNFLOORED pool and stops binding once the positional
 * floor is in, because the floor legitimately thins the pool below twelve: a
 * marginal upgrade over a man you could stream off the wire really is worth
 * almost nothing, and the finder stops reporting it. Tim's real league reads a
 * live wire, so it is the floored column he is on.
 *
 * IT IS DELIBERATELY NOT WIDENED. Twenty-four offers is 2^24 subsets before
 * disjointness, the packing cap below starts tripping, and the gain it buys is
 * on the one configuration (no floors) that no live league is in. If demo ever
 * grows a waiver wire of its own — noted as open in PROGRESS.md — this stops
 * being an asymmetry worth thinking about at all.
 */
const COMBO_OFFER_CAP = 12;

/**
 * A hard stop on packings priced, so a pathological offer set cannot hang the
 * page. Reached only when the offers barely overlap, which a real league's do
 * not. When it trips, `exhaustive: false` comes back and the answer is at worst
 * the greedy packing below.
 */
const COMBO_PACKING_CAP = 4000;

/** Take offers best-first, skipping any that clashes — the documented fallback. */
function greedyPacking(pool) {
  const used = new Set();
  const chosen = [];
  for (const o of pool) {
    if ([...o.ids].some((id) => used.has(id))) continue;
    chosen.push(o);
    for (const id of o.ids) used.add(id);
  }
  return chosen;
}

/**
 * The best set of offers that can all be made at once.
 *
 * Returns BOTH answers, because the owner asked for "the most trades possible"
 * and the section is called "best combo", and those two disagree: three trades
 * worth +2 between them is a worse season than two worth +15. Rather than pick
 * one and be quietly wrong for him, both packings come back — `best` maximises
 * the gain and is the headline, `most` maximises the NUMBER of disjoint trades
 * and is tie-broken by gain — with `mostIsBest` saying whether they are the same
 * packing, so the page never has to compare them itself.
 *
 * @param {Array} offers offers as `findTrades` returns them
 * @param {Object} opts
 * @param {Array}    opts.players  your roster
 * @param {number[]} opts.slots
 * @param {number[]} opts.weeks    the remaining weeks
 * @param {function} opts.projFor  `(player, week) -> number|null`
 * @param {Array}   [opts.teams]   every squad — makes the partner side checked too
 * @param {boolean} [opts.requirePartnersGain] drop a packing a partner would refuse
 * @param {boolean} [opts.onePerPartner] never combine two deals with one manager
 * @param {boolean|function} [opts.zeroIsBye] is a 0.00 a bye? See `isBye`.
 * @param {number}  [opts.maxOffers]
 * @param {number}  [opts.maxPackings]
 * @returns {{combo:Array, count:number, delta:number, pricing:Object,
 *            naiveDelta:number, best:Object, most:Object, mostIsBest:boolean,
 *            considered:number, exhaustive:boolean, offers:Array}}
 */
export function bestCombo(offers, opts) {
  return drain(bestComboSteps(offers, opts));
}

/**
 * `bestCombo`, a slice at a time — the same packings priced in the same order
 * and the same answer, for a page that must stay usable meanwhile. `how` is
 * `findTradesSliced`'s: `{ sliceMs, pause, stale }`; null when abandoned.
 */
export function bestComboSliced(offers, opts, how) {
  return runSliced(bestComboSteps(offers, opts), how);
}

/** The packing search as steps: one stop per packing priced. See `tradesAcrossWeeksSteps`. */
function* bestComboSteps(offers, {
  players, slots, weeks, projFor,
  teams = null,
  requirePartnersGain = true,
  onePerPartner = false,
  zeroIsBye = true,
  // THE POSITIONAL FLOOR, AND ITS ABSENCE HERE WAS A REAL DEFECT (Tim,
  // 2026-09-19: "the best combination is actually really bad and doesn't select
  // the best combination at all ... the best combo gives me a single trade that
  // is a 2-1 that has a lower +/week than the top trade").
  //
  // He is right, and this option is the whole of why. `findTrades` has taken
  // `floors` since the floor landed on 2026-09-18 and js/trade-page.js passes
  // it, so every row in the finder is priced with the waiver floor applied.
  // This function did not accept the option at all, so `price()` below was
  // pricing every packing WITHOUT it — for his side and for the partner check.
  // **One page, two different questions, and no warning.** Measured on the demo
  // league over weeks 5–13: the top offer priced the finder's way came out at
  // mine +5.5 / theirs +4.0, and the very same offer priced the combo's way
  // came out at mine −10.9 / theirs +18.0. A packing ranked on the second basis
  // and printed beside rows ranked on the first cannot agree with them, and the
  // number it prints is one nobody can reconcile against the table above it.
  //
  // It is `null` by default, which is a no-op — every function it reaches is a
  // no-op without floors — so demo, every stub and every archived reading are
  // byte-for-byte what they were. That is the same guarantee js/floor.js makes
  // everywhere else.
  floors = null,
  // THE GOAL WEIGHTS, the same ones `findTrades` was given (2026-09-21). With
  // them a packing is CHOSEN by its goal-weighted gain — Σ weight × that week's
  // change — so the combo answers the same question as the rows above it. The
  // points are still what `delta` reports.
  weights = null,
  // HOW MUCH A PARTNER MAY LOSE (a total over the weeks) before a packing is
  // refused. 0 by default: he must not lose, as always. The goal-ranked page
  // passes the SAME tolerance its finder uses (THEIR_MIN_PER_WEEK × weeks) —
  // left at 0, every offer the finder had let in at a small loss to him was a
  // packing this function refused, and on 2026-09-21 that emptied the combo
  // entirely: "making none of them is the best answer", under a list of forty.
  partnerMin = 0,
  // THE WEEKS YOU PLAY EACH PARTNER (2026-09-30), the same `(partnerId) ->
  // week numbers` `findTrades` takes. With it (and `teams`, which prices each
  // partner's side) a packing is NETTED: each partner's lineup change in the
  // weeks you play THAT partner comes off your side — `netDelta`, and the
  // score a packing is chosen by. `delta` stays your lineup alone.
  meetWeeks = null,
  maxOffers = COMBO_OFFER_CAP,
  maxPackings = COMBO_PACKING_CAP,
} = {}) {
  const ws = Array.isArray(weeks) ? weeks.slice() : [];
  const w = Array.isArray(weights) && weights.length === ws.length ? weights : null;
  const weighed = (byWeek) =>
    round1(byWeek.reduce((a, x, i) => a + w[i] * x.delta, 0));
  const meetOf = (partnerId) =>
    (typeof meetWeeks === 'function' ? meetIndices(ws, meetWeeks(partnerId)) : null) || [];

  // Every offer, reduced to the only two things a packing cares about: which
  // players it moves, and how good it looked on its own.
  const pool = (offers || [])
    .filter((o) => o && Array.isArray(o.send) && Array.isArray(o.receive))
    .map((offer) => ({
      offer,
      ids: new Set([...offer.send, ...offer.receive].map(idOf).filter((id) => id != null)),
      // The offer's own figure as its row prints it: netted when it was.
      gain: Number.isFinite(offer.netGain) ? offer.netGain
        : Number.isFinite(offer.myGain) ? offer.myGain : 0,
      // Which twelve get considered: the finder's own keep-order when it had
      // one (expected value on the goal page), else the weighted gain, else points.
      rank: w && Number.isFinite(offer.rank) ? offer.rank
        : w && Number.isFinite(offer.goalPoints) ? offer.goalPoints
          : Number.isFinite(offer.myGain) ? offer.myGain : 0,
    }))
    .sort((a, b) => b.rank - a.rank)
    .slice(0, Math.max(0, maxOffers));

  const byId = new Map();
  for (const t of teams || []) byId.set(t.id, t);

  /** Price one packing properly: everything applied together, once. */
  const price = (chosen) => {
    const send = chosen.flatMap((c) => c.offer.send);
    const receive = chosen.flatMap((c) => c.offer.receive);
    const pricing = priceTradeAcrossWeeks({
      players, send, receive, slots, weeks: ws, projFor, zeroIsBye, floors,
    });

    const partners = [];
    if (byId.size) {
      const byPartner = new Map();
      for (const c of chosen) {
        const id = c.offer.partner && c.offer.partner.id;
        if (!byPartner.has(id)) byPartner.set(id, { out: [], in: [] });
        const side = byPartner.get(id);
        side.out.push(...c.offer.receive); // what he sends me
        side.in.push(...c.offer.send);     // what I send him
      }
      for (const [id, side] of byPartner) {
        const team = byId.get(id);
        if (!team) continue;
        // THE PARTNER'S SIDE TAKES THE FLOOR TOO, and it has to be the same
        // floor. `requirePartnersGain` drops a packing that leaves a manager
        // worse off, and with his side unfloored it was rejecting packings
        // built out of deals the finder had already certified as win-wins —
        // two functions disagreeing about one manager's own lineup.
        const p = priceTradeAcrossWeeks({
          players: team.players, send: side.out, receive: side.in,
          slots, weeks: ws, projFor, zeroIsBye, floors,
        });
        // His change in the weeks he plays you, which nets off your side.
        const meet = meetOf(id);
        const opp = meet.length
          ? round1(meet.reduce((a, i) => a + p.byWeek[i].delta, 0))
          : null;
        partners.push({
          partner: team, delta: p.delta,
          before: p.before.total, after: p.after.total,
          // Week by week, so the page can play the packing out in the season
          // simulation with each partner's side changed as well as yours.
          byWeek: p.byWeek,
          meetWeeks: meet.map((i) => ws[i]),
          oppChange: opp,
          oppWeighted: meet.reduce((a, i) => a + (w ? w[i] : 1) * p.byWeek[i].delta, 0),
        });
      }
    }

    return { pricing, partners };
  };

  let considered = 0;
  let exhaustive = true;
  let best = null;
  let most = null;

  const consider = (chosen) => {
    considered++;
    const { pricing, partners } = price(chosen);
    if (requirePartnersGain && partners.some((p) => p.delta < Math.min(0, partnerMin))) return;

    const opp = partners.reduce((a, p) => a + (p.oppChange || 0), 0);
    const netDelta = round1(pricing.delta - opp);
    const entry = {
      combo: chosen.map((c) => c.offer),
      count: chosen.length,
      // Your lineup alone, and netted (see `meetWeeks`).
      delta: pricing.delta,
      netDelta,
      oppChange: partners.some((p) => p.oppChange !== null) ? round1(opp) : null,
      // What the packing is chosen by: the goal-weighted NET gain with
      // weights, the net points without.
      score: w
        ? round1(weighed(pricing.byWeek) - partners.reduce((a, p) => a + p.oppWeighted, 0))
        : netDelta,
      pricing,
      partners,
      // The trap, reported rather than buried: what you would have believed if
      // you had added the offers' own gains up.
      naiveDelta: round1(chosen.reduce((a, c) => a + c.gain, 0)),
      repeatPartners:
        new Set(chosen.map((c) => c.offer.partner && c.offer.partner.id)).size < chosen.length,
    };

    // Ties on gain go to the SMALLER packing. Two trades that buy exactly what
    // one trade buys is one more manager to talk round for nothing, and the
    // second deal is the one the page should not be recommending.
    if (!best || entry.score > best.score ||
        (entry.score === best.score && entry.count < best.count)) {
      best = entry;
    }
    if (!most || entry.count > most.count ||
        (entry.count === most.count && entry.score > most.score)) {
      most = entry;
    }
  };

  // Depth-first over disjoint subsets, best-first. EVERY subset is a candidate
  // — a bigger packing is not always a better one, because two upgrades can
  // compete for the same lineup slot — so nothing here prunes on value, only on
  // compatibility. The empty packing is priced too: "make none of them" is a
  // real answer when every offer turns out to be worth less on the weekly
  // numbers than it looked on the season average.
  const chosen = [];
  const used = new Set();
  const partnersUsed = new Set();

  const walk = function* walk(from) {
    if (considered >= maxPackings) { exhaustive = false; return; }
    consider(chosen);
    yield;
    for (let i = from; i < pool.length; i++) {
      if (considered >= maxPackings) { exhaustive = false; return; }
      const c = pool[i];
      if ([...c.ids].some((id) => used.has(id))) continue;
      const partnerId = c.offer.partner && c.offer.partner.id;
      if (onePerPartner && partnersUsed.has(partnerId)) continue;

      chosen.push(c);
      for (const id of c.ids) used.add(id);
      const hadPartner = partnersUsed.has(partnerId);
      partnersUsed.add(partnerId);

      yield* walk(i + 1);

      chosen.pop();
      for (const id of c.ids) used.delete(id);
      if (!hadPartner) partnersUsed.delete(partnerId);
    }
  };
  yield* walk(0);

  // The cap tripped, so the search was not exhaustive. Make sure the greedy
  // packing has at least been priced, so the answer is never worse than the
  // obvious one a manager would have reached by hand.
  if (!exhaustive) {
    const greedy = greedyPacking(pool);
    if (greedy.length) consider(greedy);
  }

  const same = !!best && !!most &&
    best.count === most.count &&
    best.combo.every((o, i) => o === most.combo[i]);

  return {
    // The headline IS the best-gain packing, so a caller that reads
    // `combo`/`count`/`delta` and nothing else still gets the right answer.
    combo: best ? best.combo : [],
    count: best ? best.count : 0,
    delta: best ? best.delta : 0,
    netDelta: best ? best.netDelta : 0,
    pricing: best ? best.pricing : null,
    naiveDelta: best ? best.naiveDelta : 0,
    best,
    most,
    mostIsBest: same,
    considered,
    exhaustive,
    offers: pool.map((c) => c.offer),
  };
}

// ===========================================================================
// One packing, read as OFFERS — merged per manager
// ===========================================================================
//
// The owner's ask: "In the best combo box, it should display the trades as a
// list just like the regular trade box, and you should be able to click on the
// link to fantasy in the same way as well. If there are multiple trades with a
// single user in the best combo box, combine them."
//
// THE MERGING IS NOT COSMETIC — IT IS MORE CORRECT THAN LISTING THEM APART.
//
// `bestCombo` deliberately allows two disjoint deals with the SAME manager
// (see the note above `COMBO_OFFER_CAP`), because they are legal and are
// genuinely one bigger deal he might take. But nothing about them is two
// transactions: they are proposed on one ESPN screen, accepted or refused
// together, and — this is the part that matters — the engine has already priced
// them as ONE combined roster change. That is the whole point of
// `priceTradeAcrossWeeks` taking a package rather than a trade, and the whole
// reason `naiveDelta` exists. So presenting them as two rows with two gains
// would be showing the reader the exact arithmetic the engine refuses to do.
//
// Hence one row per manager: the send lists unioned, the receive lists unioned,
// one ESPN link carrying every id of his that is coming to you, and ONE gain.
//
// WHERE THAT GAIN COMES FROM, because this is the trap. It is NOT the two
// offers' gains added together. It is a fresh `priceTradeAcrossWeeks` of the
// merged move — everything sent and everything received, applied at once,
// against your roster as it is today. Two upgrades competing for one lineup
// slot cancel here exactly as they do in the combo total above.
//
// And the merged gains still do not add up to the combo's own figure, for the
// same reason one level up: each merged deal was priced against the CURRENT
// roster, and after the first of them that roster is gone. The combo's headline
// stays the only number that prices the whole slate, and the page says so.

/**
 * One packing, as one offer per manager.
 *
 * @param {Object} entry a `best`/`most` entry out of `bestCombo`
 * @param {Object} opts
 * @param {Array}    opts.players your roster
 * @param {number[]} opts.slots
 * @param {number[]} opts.weeks
 * @param {function} opts.projFor
 * @param {boolean|function} [opts.zeroIsBye]
 * @param {Map} [opts.floors] the positional floor — THE SAME ONE `bestCombo`
 *   and `findTrades` were given. A merged row priced without it would carry a
 *   gain the packing it belongs to does not agree with, which is the defect
 *   Tim found one level up on 2026-09-19.
 * @returns {Array} offers shaped like `findTrades`', plus `merged`/`mergedFrom`
 */
export function mergeComboByPartner(entry, {
  players, slots, weeks, projFor, zeroIsBye = true, floors = null,
} = {}) {
  if (!entry || !Array.isArray(entry.combo) || !entry.combo.length) return [];
  const ws = Array.isArray(weeks) ? weeks.slice() : [];

  // Grouped in the order the packing chose them, so a page that prints them in
  // this order is printing the engine's own preference rather than a re-sort
  // that could disagree with the list above it.
  const groups = [];
  const seenPartner = new Map();
  for (const offer of entry.combo) {
    const id = offer.partner ? offer.partner.id : null;
    let group = seenPartner.get(id);
    if (!group) {
      group = { partner: offer.partner, offers: [] };
      seenPartner.set(id, group);
      groups.push(group);
    }
    group.offers.push(offer);
  }

  // What each partner's COMBINED side came out at, already priced by
  // `bestCombo` when it was handed the squads. Re-deriving it here would be a
  // second way of knowing one number, and the two could drift.
  const hisSide = new Map();
  for (const p of entry.partners || []) {
    if (p && p.partner) hisSide.set(p.partner.id, p);
  }

  /** A man can only be traded once, so a repeat here would be a bug upstream. */
  const uniqueById = (list) => {
    const seen = new Set();
    const out = [];
    for (const p of list) {
      const id = idOf(p);
      if (id !== null && id !== undefined && seen.has(id)) continue;
      if (id !== null && id !== undefined) seen.add(id);
      out.push(p);
    }
    return out;
  };

  return groups
    .map((group) => {
      const send = uniqueById(group.offers.flatMap((o) => o.send));
      const receive = uniqueById(group.offers.flatMap((o) => o.receive));

      // THE RE-PRICE. Everything at once, against the roster as it stands.
      const pricing = priceTradeAcrossWeeks({
        players, send, receive, slots, weeks: ws, projFor, zeroIsBye, floors,
      });
      const his = hisSide.get(group.partner ? group.partner.id : null) || null;

      return {
        partner: group.partner,
        // The entries the offers already carry, so `perWeek` and every other
        // derived field is the one the finder's rows are printing. Re-scoring
        // them here would compute the same numbers a second way.
        send,
        receive,
        kind: packageKind(send, receive),
        shape: `${send.length}-for-${receive.length}`,
        basis: 'weeks',
        weeks: ws,
        // Said on the row, because a four-player trade is a different
        // conversation from two two-player ones and the reader has to know
        // which one he is about to send.
        merged: group.offers.length > 1,
        mergedFrom: group.offers.length,
        myGain: pricing.delta,
        // Netted by this manager's change in the weeks he plays you, when
        // `bestCombo` was given `meetWeeks` (see there).
        netGain: his && Number.isFinite(his.oppChange)
          ? round1(pricing.delta - his.oppChange) : pricing.delta,
        meetWeeks: his && Array.isArray(his.meetWeeks) ? his.meetWeeks : [],
        oppChange: his && Number.isFinite(his.oppChange) ? his.oppChange : null,
        myBefore: pricing.before.total,
        myAfter: pricing.after.total,
        theirGain: his ? his.delta : null,
        theirBefore: his ? his.before : null,
        theirAfter: his ? his.after : null,
        // His week by week, so a page can price his side over the weeks he
        // will actually play (js/trade-odds.js `playoffReach`).
        theirByWeek: his && Array.isArray(his.byWeek) ? his.byWeek : null,
        yourChurn: pricing.churn,
        byWeek: pricing.byWeek,
        cut: pricing.cut,
        pricing,
      };
    })
    // Best first, the same order and the same tie-breaks the finder uses, so
    // the two tables read the same way down the page.
    .sort((a, b) => b.netGain - a.netGain || a.send.length + a.receive.length - (b.send.length + b.receive.length));
}
