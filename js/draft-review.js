// The draft, looked back on: what each pick is worth now, against where he went.
//
// Tim, 2026-10-08: "I also want to expand the draft section to show what our
// draft looked like and allow the user to select a specific user and see which
// big misses or steals they had based on current season proj and information."
//
// Pure functions only — no DOM, no fetching (tests/test-draft-review.mjs).
// js/draft-page.js reads the draft and the weeks and draws what these return.
//
// THE THREE NUMBERS ON A PICK
//
//   drafted at   his overall pick. In an AUCTION there is no pick order worth
//                the name (it is the order men were put up for bidding), so it
//                is his PRICE'S rank: the dearest man is 1, and men who cost
//                the same share the middle of the places they fill.
//   worth now    his place among everyone drafted if the same men were drafted
//                again today, by value (below).
//   difference   drafted at − worth now. Above zero he went later than he is
//                worth (a steal); below zero, earlier (a miss).
//
// THE OTHER COMPARISON (Tim, 2026-10-08: "instead of showing where the players
// should have been drafted, show where they were drafted relative to where they
// were ranked at the start of the season. for example if Jahmar gibbs was
// drafted 5th, then his number should show +4, because he was ranked #1 at the
// start of the season. If a player was drafted earlier than they were ranked
// then put it negative (-)"):
//
//   preseason    his place among everyone drafted by ESPN's own draft rank
//                (`draftRanksByRankType.PPR.rank`, which ESPN sets before the
//                season). AMONG THE MEN DRAFTED, not ESPN's number itself:
//                measured on league 1241838, its ranks run to 981 (16 of the
//                170 drafted are past 250 — every kicker and defence), so a
//                defence taken 140th would read −380. Gibbs is ESPN's 1 and
//                the first of the drafted either way.
//   difference   drafted at − preseason (`preDiff`). Above zero he went later
//                than he was ranked; below zero, earlier.
//
// VALUE is his season as it stands — points scored in the weeks that are over
// plus ESPN's projection for every week left — MINUS THE BAR AT HIS POSITION,
// so a quarterback's bigger totals do not make every quarterback a steal.
//
// THE BAR comes off the league's own lineup, the way js/trade.js sets its
// replacement level: fill every starting slot in the league with the best men
// drafted (the league's slots, once per team — `optimalLineup`), and whoever is
// left at a position is its backups. The bar is THE MIDDLE BACKUP (the better
// of the two when there are two): the man who would really take a starter's
// place.
//
// Why not the BEST backup, which is js/trade.js's bar exactly? Measured on the
// real league this was written against (1241838, 170 picks, 2026-10-08):
// against the best backup every starter is above zero and every backup below
// it, so the twenty kickers and defences that start rank 41st to 107th — and,
// having cost a dollar each, 8 of the 20 biggest "steals" in the league were
// kickers and defences. Against the middle backup a bench running back is
// worth more than a kicker, as he is in any real draft: they rank 78th to
// 138th, and 2 of the 20 are defences (the two best ones). Both bars are
// returned (`bar`, `starterBar`), and `against` picks one.

//
// "VS WORTH NOW" ON VALUE (Tim, 2026-10-09: "Instead of basing the "vs worth
// now" on position in the draft, base it off of their current value - their
// expected value based on their rank in the draft. … list all the players based
// on preseason rank, and then take their expected value (before the season
// started). This expected value can fluctuate quite a bit so make a smoothed
// equation line based on these numbers. … Then, to get the expected value just
// plug in that player's preseason rank in the draft."):
//
//   the line        the men drafted in ESPN's preseason-rank order (`pre`, 1 the
//                   best ranked), each at his PRESEASON Value — js/value.js's
//                   `valueOf` on what ESPN projected him for a week before the
//                   season — made into ONE line that never rises and never goes
//                   under 0 (`expectedCurve`).
//   expected        that line read at WHERE HE WAS DRAFTED (`at`: his pick, or
//                   his price's rank in an auction). Read at his own preseason
//                   rank it would grade the player; read at the slot it grades
//                   the pick, which is what a steal or a miss is.
//   value now       his Value today (js/season.js `fetchPlayerValues`).
//   difference      value now − expected (`valueDiff`), in points a week.
//
// All of it only when the league's frozen lines are known (`worth.base`);
// without them every row's three new numbers are null and nothing else moves.

import { optimalLineup, simulateSeason } from './forecast.js';
import { standingsKey } from './capture.js';
import { valueOf, isBase } from './value.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round1 = (v) => Math.round(v * 10) / 10;

// ------------------------------------------------------------------ the draft

/**
 * ESPN's `mDraftDetail` payload, as the picks the page draws.
 *
 * @returns {{ type:'snake'|'auction', done:boolean, order:number[],
 *   picks:Array<{overall:number, round:number, roundPick:number, teamId:number,
 *   playerId:number, bid:number|null, keeper:boolean}> }}
 *   `picks` in pick order; `order` is the teams left to right (a snake's first
 *   round; an auction's `pickOrder`). A pick nobody has made yet is left out.
 */
export function parseDraft(raw) {
  const dd = (raw && raw.draftDetail) || {};
  const settings = (raw && raw.settings && raw.settings.draftSettings) || {};
  const list = Array.isArray(dd.picks) ? dd.picks : [];
  const said = String(settings.type || '').toUpperCase();
  const type = said === 'AUCTION' || (!said && list.some((p) => Number(p && p.bidAmount) > 0))
    ? 'auction' : 'snake';

  const picks = list
    .filter((p) => p && Number(p.teamId) > 0 && Number(p.overallPickNumber) > 0 &&
      Number.isFinite(Number(p.playerId)) && Number(p.playerId) !== 0)
    .map((p) => ({
      overall: Number(p.overallPickNumber),
      round: Number(p.roundId) || 0,
      roundPick: Number(p.roundPickNumber) || 0,
      teamId: Number(p.teamId),
      playerId: Number(p.playerId),
      bid: type === 'auction' ? (Number(p.bidAmount) || 0) : null,
      keeper: p.keeper === true,
    }))
    .sort((a, b) => a.overall - b.overall);

  const seen = [];
  for (const p of picks) if (!seen.includes(p.teamId)) seen.push(p.teamId);
  const listed = type === 'auction' && Array.isArray(settings.pickOrder)
    ? settings.pickOrder.map(Number).filter((id) => seen.includes(id)) : [];
  const order = [...listed, ...seen.filter((id) => !listed.includes(id))];

  return { type, done: dd.drafted === true, order, picks };
}

/**
 * Where each man was drafted: `Map<playerId, number>`.
 * A snake: his overall pick. An auction: his price's rank (see the top).
 */
export function draftedAt(picks, type) {
  const out = new Map();
  if (type !== 'auction') {
    for (const p of picks || []) out.set(p.playerId, p.overall);
    return out;
  }
  const byPrice = (picks || []).slice().sort((a, b) => b.bid - a.bid || a.overall - b.overall);
  for (let i = 0; i < byPrice.length;) {
    let j = i;
    while (j + 1 < byPrice.length && byPrice[j + 1].bid === byPrice[i].bid) j++;
    // Places i+1 … j+1 are shared: everyone in them stands at their middle.
    const at = Math.round((i + 1 + j + 1) / 2);
    for (let k = i; k <= j; k++) out.set(byPrice[k].playerId, at);
    i = j + 1;
  }
  return out;
}

/**
 * Each drafted man's place among the men drafted, by ESPN's preseason rank:
 * `Map<playerId, number>`, 1 the best ranked. Equal ranks go in pick order; a
 * man ESPN did not rank (no rank, or 0) has no place.
 *
 * @param {Array} picks
 * @param {Map<number, number>|Object<number, number>|null} ranks playerId -> ESPN's rank
 */
export function preseasonPlaces(picks, ranks) {
  const get = (id) => {
    const v = ranks instanceof Map ? ranks.get(id) ?? ranks.get(String(id)) : ranks ? ranks[id] : null;
    return num(v) !== null && v > 0 ? v : null;
  };
  const ranked = (picks || []).map((p) => ({ p, rank: get(p.playerId) })).filter((x) => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.p.overall - b.p.overall);
  const out = new Map();
  ranked.forEach((x, i) => out.set(x.p.playerId, { place: i + 1, rank: x.rank }));
  return out;
}

/**
 * The board: one column a team (in `order`), one row a round.
 *
 * Row r of a column is that team's r-th pick — in a snake that IS round r; in
 * an auction it is the r-th dearest man it bought.
 *
 * @returns {{ teamIds:number[], rows:Array<Array<object|null>> }} `rows[r][c]`
 *   is the pick (one of `picks`' own objects) or null where a team has fewer.
 */
export function boardOf(draft) {
  const cols = new Map(draft.order.map((id) => [id, []]));
  for (const p of draft.picks) {
    if (!cols.has(p.teamId)) cols.set(p.teamId, []);
    cols.get(p.teamId).push(p);
  }
  if (draft.type === 'auction') {
    for (const list of cols.values()) list.sort((a, b) => b.bid - a.bid || a.overall - b.overall);
  }
  const teamIds = [...cols.keys()];
  const depth = Math.max(0, ...teamIds.map((id) => cols.get(id).length));
  const rows = Array.from({ length: depth }, (_, r) => teamIds.map((id) => cols.get(id)[r] || null));
  return { teamIds, rows };
}

// ------------------------------------------------------------- a man's season

/**
 * One man's season as it stands.
 *
 * @param {Object<number, {counts:number|null, done:boolean}>} byWeek what each
 *   week counts for him and whether it is behind him. A week with no entry
 *   counts nothing.
 * @param {number[]} weeks every week of the season
 * @returns {{ soFar:number, rest:number, total:number }}
 */
export function seasonOf(byWeek, weeks) {
  let soFar = 0;
  let rest = 0;
  for (const w of weeks || []) {
    const e = byWeek && byWeek[w];
    const v = e ? num(e.counts) : null;
    if (v === null) continue;
    if (e.done) soFar += v; else rest += v;
  }
  return { soFar, rest, total: soFar + rest };
}

// -------------------------------------------------------------------- the bar

/** The league's lineup from the lineups in use: the most of each slot any team starts. */
export function slotsFromLineups(teams) {
  const most = new Map();
  for (const t of teams || []) {
    const mine = new Map();
    for (const p of t.players || []) {
      if (!p.started) continue;
      mine.set(p.lineupSlotId, (mine.get(p.lineupSlotId) || 0) + 1);
    }
    for (const [slot, n] of mine) if (n > (most.get(slot) || 0)) most.set(slot, n);
  }
  const slots = [];
  for (const [slot, n] of [...most].sort((a, b) => a[0] - b[0])) {
    for (let i = 0; i < n; i++) slots.push(Number(slot));
  }
  return slots;
}

/**
 * The bar at each position — see "THE BAR" at the top.
 *
 * @param {Array<{position:string, total:number}>} pool everyone drafted
 * @param {number[]} slots ONE team's starting lineup, as lineupSlotIds
 * @param {number} teams how many teams fill it
 * @returns {Map<string, {bar:number, starterBar:number, starters:number, backups:number}>}
 *   `starterBar` is the best backup (js/trade.js's bar); with no backup at all
 *   both bars are the worst starter, as there.
 */
export function leagueBars(pool, slots, teams) {
  const men = (pool || []).filter((p) => p && p.position && num(p.total) !== null);
  const league = [];
  for (let i = 0; i < teams; i++) league.push(...(slots || []));
  const starting = new Map();
  for (const s of optimalLineup(men.map((p) => ({ position: p.position, projected: p.total })), league).starters) {
    starting.set(s.position, (starting.get(s.position) || 0) + 1);
  }

  const byPos = new Map();
  for (const p of men) {
    if (!byPos.has(p.position)) byPos.set(p.position, []);
    byPos.get(p.position).push(p.total);
  }
  const out = new Map();
  for (const [position, totals] of byPos) {
    totals.sort((a, b) => b - a);
    const n = Math.min(starting.get(position) || 0, totals.length);
    const backups = totals.slice(n);
    const worstStarter = totals[totals.length - 1];
    out.set(position, {
      bar: backups.length ? backups[Math.floor((backups.length - 1) / 2)] : worstStarter,
      starterBar: backups.length ? backups[0] : worstStarter,
      starters: n,
      backups: backups.length,
    });
  }
  return out;
}

// ------------------------------------------------- the expected-value line

/**
 * How far each side of a place the line is averaged over, for `n` places: about
 * a fortieth of the draft, at least 1. Twice over (see `expectedCurve`).
 */
export const curveRadius = (n) => Math.max(1, Math.round(n / 40));

/**
 * The expected-value line: what a place in the draft was worth before the
 * season — see "VS WORTH NOW ON VALUE" at the top.
 *
 * Three steps, each of which keeps the line from ever rising:
 *   1. the nearest never-rising line to the points (pool-adjacent-violators:
 *      wherever a later place is worth more than an earlier one, the run is
 *      replaced by its average). It comes out as flat steps;
 *   2. a place with no point is filled from the line either side of it;
 *   3. each place becomes the average of itself and its neighbours
 *      (`curveRadius` each side, fewer near an end), done twice, which turns
 *      the steps into slopes. An average of never-rising runs never rises.
 *
 * @param {Array<{place:number, value:number|null}>} points one a man drafted:
 *   his place by ESPN's preseason rank among the drafted (1 the best), and his
 *   preseason Value — null when ESPN had no preseason projection for him (he is
 *   skipped, and still counts as a place)
 * @param {Object} [o]
 * @param {number} [o.radius] the averaging in step 3 (0 for none)
 * @returns {{n:number, y:number[]}|null} `y[i]` is place `i + 1`; null with no
 *   point at all
 */
export function expectedCurve(points, { radius = null } = {}) {
  const all = (points || []).filter((p) => p && Number.isFinite(p.place) && p.place >= 1);
  const pts = all.filter((p) => num(p.value) !== null)
    .map((p) => ({ x: Math.round(p.place), y: Math.max(0, p.value) }))
    .sort((a, b) => a.x - b.x);
  if (!pts.length) return null;
  const n = Math.max(...all.map((p) => Math.round(p.place)));

  // 1. Pool adjacent violators, for a line that never rises.
  const blocks = [];
  for (const p of pts) {
    blocks.push({ sum: p.y, w: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.w >= b.sum / b.w) break;
      a.sum += b.sum; a.w += b.w;
      blocks.pop();
    }
  }
  const fit = [];
  for (const b of blocks) for (let i = 0; i < b.w; i++) fit.push(b.sum / b.w);

  // 2. Every place 1..n: the fitted places, and straight lines between them.
  const y = new Array(n).fill(null);
  pts.forEach((p, i) => { y[p.x - 1] = fit[i]; });
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (y[i] === null) continue;
    if (last < 0) for (let k = 0; k < i; k++) y[k] = y[i];
    else for (let k = last + 1; k < i; k++) y[k] = y[last] + ((y[i] - y[last]) * (k - last)) / (i - last);
    last = i;
  }
  for (let k = last + 1; k < n; k++) y[k] = y[last];

  // 3. The light smoothing.
  const r = radius === null ? curveRadius(n) : Math.max(0, Math.round(radius));
  let out = y;
  for (let pass = 0; pass < 2 && r > 0; pass++) {
    const src = out;
    out = src.map((_, i) => {
      // Near an end the window narrows to what there is on BOTH sides, so the
      // first and last places keep their own height (a window hanging over the
      // end would pull the top of the draft down) and the line still never rises.
      const k = Math.min(r, i, n - 1 - i);
      let sum = 0;
      for (let j = i - k; j <= i + k; j++) sum += src[j];
      return sum / (2 * k + 1);
    });
  }
  return { n, y: out.map((v) => Math.max(0, v)) };
}

/**
 * The line read at a place: held at its ends, and a place between two whole
 * ones (an auction's shared places) read off the straight line between them.
 * @returns {number|null} unrounded; null with no line or no place
 */
export function expectedAt(curve, place) {
  if (!curve || !Array.isArray(curve.y) || !curve.y.length || num(place) === null) return null;
  const p = Math.min(curve.y.length, Math.max(1, place));
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  const a = curve.y[lo - 1];
  return lo === hi ? a : a + (curve.y[hi - 1] - a) * (p - lo);
}

/**
 * Each team's total: the Value today of every man it DRAFTED, wherever he is
 * now. `Map<teamId, number>` to the tenth, in the order teams first picked; a
 * man with no Value adds nothing.
 *
 * `key` is which Value is added up: `valueNow` (today), or `valuePre` — each
 * man's OWN preseason Value, for the "vs preseason rank" view (Tim, 2026-10-09:
 * "put the value at the top … as what it was proj to be based on preseason
 * predictions (which is different than the preseason expected value we talked
 * about before)").
 */
export function teamValues(rows, key = 'valueNow', ownerOf = null) {
  const out = new Map();
  for (const r of rows || []) {
    // OWN NOW (`ownerOf`, playerId -> the team holding him today): a man counts
    // for that team instead, and a man nobody holds counts for nobody.
    const team = ownerOf ? ownerOf.get(r.playerId) : r.teamId;
    if (team === undefined || team === null) continue;
    out.set(team, (out.get(team) || 0) + (num(r[key]) ?? 0));
  }
  for (const [id, v] of out) out.set(id, round1(v));
  return out;
}

// ------------------------------------------------ the men nobody drafted
//
// Tim, 2026-10-22: "make sure that if the selection is on drafted, then it
// calculates the total value of the players the user drafted, but if it's on
// own now, it calculates the total value of the players that the user currently
// owns. … also because the players that user currently owns might've been
// undrafted, list them at the very bottom under that user's collumn bellow the
// last round of the draft."

/**
 * The men on a squad today whom nobody drafted, each once, in squad order.
 * @param {Array<{id:number, players:Array<{playerId:number}>}>} squads the week in play's
 * @param {Array<{playerId:number}>} picks the draft's
 * @returns {Array<{teamId:number, playerId:number}>}
 */
export function undraftedOwned(squads, picks) {
  const drafted = new Set((picks || []).map((p) => p.playerId));
  const seen = new Set();
  const out = [];
  for (const t of squads || []) {
    for (const p of t.players || []) {
      if (!p || drafted.has(p.playerId) || seen.has(p.playerId)) continue;
      seen.add(p.playerId);
      out.push({ teamId: t.id, playerId: p.playerId });
    }
  }
  return out;
}

/**
 * An undrafted man as a row of the review (`reviewDraft`'s shape), so the
 * board, a card and a total read him as they read a pick. Nothing was spent on
 * him, so NOTHING WAS EXPECTED OF HIM: `expected` is 0 (when there is a line at
 * all) and his difference is his Value today. He has no pick, no price, no
 * place and no rank, so every figure made of those is null.
 *
 * @param {Object} o
 * @param {boolean} o.valued whether the expected-value line exists (`reviewDraft(...).curve`)
 */
export function undraftedRow({ teamId, playerId, name = '', position = '', soFar = null, rest = null, total = null,
  valueNow = null, valuePre = null, valued = false }) {
  const now = valued ? num(valueNow) : null;
  return {
    overall: null, round: null, roundPick: null, teamId, playerId, bid: null, keeper: false, undrafted: true,
    at: null, name, position, soFar: num(soFar), rest: num(rest), total: num(total),
    value: null, now: null, diff: null,
    espnRank: null, pre: null, preDiff: null,
    valueNow: now, expected: valued ? 0 : null, valueDiff: now === null ? null : round1(now),
    valuePre: num(valuePre),
  };
}

/**
 * The mean of the numbers in a list, unrounded; null when it holds none. What
 * is not a finite number (null, undefined, a dash) is left out, not counted 0.
 */
export function meanOf(values) {
  const xs = (values || []).map(num).filter((v) => v !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

/**
 * THE BOARD'S "AVG" COLUMN (Tim, 2026-10-10: "add a column on the far left
 * that is just the avg of that row or that line of drafting"): for each row of
 * the board, the mean across teams of one figure of its picks.
 *
 * @param {Array<Array<object|null>>} boardRows `boardOf(draft).rows`
 * @param {Array} rows `reviewDraft(...).rows` (the picks with their figures)
 * @param {string} key the figure on show: `diff`, `valueDiff`, `expected`,
 *   `valueNow` or `preDiff`
 * @returns {Array<number|null>} one a row, unrounded. An empty slot and a pick
 *   with no such figure are left out; a row with none is null.
 */
export function roundAverages(boardRows, rows, key = 'diff') {
  const byId = new Map((rows || []).map((r) => [r.playerId, r]));
  return (boardRows || []).map((row) => meanOf((row || []).map((pk) => {
    const r = pk ? byId.get(pk.playerId) : null;
    return r ? r[key] : null;
  })));
}

// ----------------------------------------------------------------- the review

/**
 * Every pick with its three numbers.
 *
 * @param {Object} o
 * @param {ReturnType<typeof parseDraft>} o.draft
 * @param {Map<number, {name:string, position:string, soFar:number, rest:number, total:number}>} o.players
 *   by playerId; a drafted man who is not in it gets no rank and no difference
 * @param {number[]} o.slots one team's starting lineup
 * @param {number} [o.teams] defaults to the teams that drafted
 * @param {'bar'|'starterBar'} [o.against] which bar value is measured from
 * @param {Map|Object|null} [o.ranks] playerId -> ESPN's preseason rank
 * @param {Object|null} [o.worth] the league's Value, when its lines are known:
 *   `{ base, now, pre }` — `base` js/value.js's frozen lines; `now` playerId ->
 *   his Value today; `pre` playerId -> what ESPN projected him for a week
 *   before the season (points, not Value). Each a Map or a function.
 * @returns {{ rows:Array, bars:Map, ranked:number, curve:Object|null }} `rows`
 *   in pick order, each the pick plus `{ at, name, position, soFar, rest, total,
 *   value, now, diff, espnRank, pre, preDiff, valueNow, expected, valueDiff,
 *   valuePre }` (`value`, `now`, `diff` null for a man with no numbers; the next
 *   three null for a man ESPN did not rank; the next three null without `worth`
 *   or without a line — see the top; `valuePre`, his own preseason Value — the
 *   raw point the line is drawn through, not the line — null without `worth` or
 *   for a man ESPN projected nothing before the season); `ranked` is how many
 *   men have a place; `curve` is the expected-value line (`expectedCurve`).
 */
export function reviewDraft({ draft, players, slots, teams = null, against = 'bar', ranks = null, worth = null }) {
  const at = draftedAt(draft.picks, draft.type);
  const pre = preseasonPlaces(draft.picks, ranks);
  const read = (src, id) => num(typeof src === 'function' ? src(id) : src instanceof Map ? src.get(id) : null);
  const rows = draft.picks.map((pk) => {
    const p = players.get(pk.playerId) || null;
    const known = Boolean(p && p.position && num(p.total) !== null);
    return {
      ...pk,
      at: at.get(pk.playerId),
      name: (p && p.name) || '',
      position: (p && p.position) || '',
      soFar: known ? p.soFar : null,
      rest: known ? p.rest : null,
      total: known ? p.total : null,
      value: null, now: null, diff: null,
      // ESPN's preseason rank, his place by it among the drafted, and the difference.
      espnRank: pre.has(pk.playerId) ? pre.get(pk.playerId).rank : null,
      pre: pre.has(pk.playerId) ? pre.get(pk.playerId).place : null,
      preDiff: pre.has(pk.playerId) ? at.get(pk.playerId) - pre.get(pk.playerId).place : null,
      // His Value today, what his slot was expected to be worth, and the difference.
      valueNow: null, expected: null, valueDiff: null,
      // What ESPN's own preseason projection made him worth (not the line).
      valuePre: null,
    };
  });

  // VS WORTH NOW ON VALUE — see the top.
  let curve = null;
  if (worth && isBase(worth.base)) {
    for (const r of rows) r.valuePre = r.position ? valueOf(worth.base, r.position, read(worth.pre, r.playerId)) : null;
    curve = expectedCurve(rows.filter((r) => r.pre !== null).map((r) => ({ place: r.pre, value: r.valuePre })));
    for (const r of curve ? rows : []) {
      const e = expectedAt(curve, r.at);
      r.valueNow = read(worth.now, r.playerId);
      r.expected = e === null ? null : round1(e);
      // The printed difference is its two printed ends subtracted.
      r.valueDiff = r.valueNow === null || r.expected === null ? null : round1(r.valueNow - r.expected);
    }
  }

  const pool = rows.filter((r) => r.total !== null);
  const bars = leagueBars(pool, slots, teams || draft.order.length);
  for (const r of pool) r.value = r.total - bars.get(r.position)[against];
  // A strict order: value, then points, then the earlier pick.
  const order = pool.slice().sort((a, b) => b.value - a.value || b.total - a.total || a.overall - b.overall);
  order.forEach((r, i) => { r.now = i + 1; r.diff = r.at - r.now; });

  return { rows, bars, ranked: order.length, curve };
}

/**
 * One team's picks, with its best steal and its biggest miss (null when it has
 * none). `key` is the difference they are the ends of: `diff` (worth now, by
 * place), `valueDiff` (worth now, on Value) or `preDiff` (preseason rank).
 *
 * `plain` is for a figure that is not a difference (`expected`, `valueNow` —
 * the "Expected value" and "Value now" views): the two ends are then simply
 * the team's highest and lowest, whatever their sign; of equals, the earlier pick.
 */
export function teamReview(rows, teamId, key = 'diff', { plain = false } = {}) {
  const picks = (rows || []).filter((r) => String(r.teamId) === String(teamId));
  const rated = picks.filter((r) => r[key] !== null && r[key] !== undefined);
  const best = rated.reduce((a, r) => (a === null || r[key] > a[key] ? r : a), null);
  const worst = rated.reduce((a, r) => (a === null || r[key] < a[key] ? r : a), null);
  return {
    picks,
    steal: best && (plain || best[key] > 0) ? best : null,
    miss: worst && (plain || worst[key] < 0) ? worst : null,
  };
}

// ------------------------------------------------------------ the perfect draft
//
// Tim, 2026-10-22: "could you add a hypothetical "perfect draft" that
// automatically selects the most currently valuable players that you could've
// drafted for that round, and then shifts all the players down to even out the
// draft? Make sure it only selects the player that was between that pick and
// your current pick. For example, I picked Omarian Hampton at 14 and Jenty at
// 27. The perfect draft simply chooses the player with the highest value
// between position 12-26 and shifts all the players down accordingly. this
// means that I would hypothetically choose Walker (pos 23), and positions 14-22
// would shift so that it all lines up acordingly."
//
// And, after the first build re-drafted every team (Tim, 2026-10-22: "What I
// wanted was that the perfect draft is rhetrospectively chosen based on the
// curren't player's value and optimized only for the current user selected.
// It's basically trying to say that if the user that is currently selected
// drafted the best ("best" based on current player value), for each round of
// the draft that they were actually in, what would their team look like?"):
//
// ONLY THE SELECTED TEAM picks. Its own picks are walked in order. At its pick
// P its window is the men on the board at picks P … its next pick, that pick
// included — to the end of the draft for its last pick. (Tim, 2026-10-22:
// "include youre next draft position as a potential selection. This will
// hopefully remove "traps" where the user picks twice in a row so the
// calculation just keeps the origional first pick.") It takes the one worth most today;
// he moves to P and the men from P to where he stood each slide one pick
// later, so every slot stays filled and the others keep their order. Other
// teams' slots just get whoever slides into them. Of equals the earlier man is
// taken, so when the best in the window is already at P nothing moves.
// ("12-26" in his words is taken as 14-26: his example moves Walker up and
// shifts 14-22.) NO MAN'S NUMBERS CHANGE: only where he sits on the board.

/**
 * The perfect draft's order, for one team.
 *
 * @param {Array<{overall:number, teamId:number, playerId:number}>} picks in pick order
 * @param {function(number):number|null} worthOf playerId -> what he is worth
 *   today; a man with none is never taken over a man with one
 * @param {number|string} teamId the team that picks perfectly; no other does
 * @returns {Array<object>} one a slot, in pick order: the slot's own pick
 *   (overall, round, roundPick, teamId, bid, keeper) with the man who fills it
 *   (`playerId`) and where he was really taken (`from`, his overall pick)
 */
export function perfectOrder(picks, worthOf, teamId) {
  const slots = (picks || []).slice().sort((a, b) => a.overall - b.overall);
  const from = new Map(slots.map((p) => [p.playerId, p.overall]));
  const worth = (id) => {
    const v = num(worthOf ? worthOf(id) : null);
    return v === null ? -Infinity : v;
  };
  const men = slots.map((p) => p.playerId);
  for (let i = 0; i < slots.length; i++) {
    if (String(slots[i].teamId) !== String(teamId)) continue;
    // The window runs to its next pick AND INCLUDES IT (the last pick: to the end).
    let end = slots.length - 1;
    for (let j = i + 1; j < slots.length; j++) if (slots[j].teamId === slots[i].teamId) { end = j; break; }
    let best = i;
    for (let k = i + 1; k <= end; k++) if (worth(men[k]) > worth(men[best])) best = k;
    shiftUp(men, i, best);
  }
  return slots.map((p, i) => ({ ...p, playerId: men[i], from: from.get(men[i]) }));
}

/**
 * THE SHIFT, the one both the perfect draft and the what-if make: the man in
 * place `k` moves up to place `i`, and the men in places `i … k − 1` each slide
 * one place later, so every slot stays filled and the others keep their order.
 * Nothing moves when `k` is not after `i`. Changes `men` in place and returns it.
 */
export function shiftUp(men, i, k) {
  if (Number.isInteger(i) && Number.isInteger(k) && k > i && i >= 0 && k < men.length) {
    men.splice(i, 0, men.splice(k, 1)[0]);
  }
  return men;
}

/**
 * The review's rows as the perfect draft has them: each man in his new slot
 * (`overall`, `round`, `roundPick`, and the slot's team) and where he was
 * really taken (`from`). EVERY FIGURE OF HIS IS LEFT AS IT IS — `at`, expected
 * value, Value now, both differences — so he shows what he shows on Drafted.
 * Snake drafts only: an auction has no pick order.
 *
 * @param {ReturnType<typeof reviewDraft>} rv
 * @param {Array<object>} order `perfectOrder(...)`
 */
export function perfectRows(rv, order) {
  const byId = new Map(((rv && rv.rows) || []).map((r) => [r.playerId, r]));
  return (order || []).map((slot) => {
    const r = byId.get(slot.playerId);
    if (!r) return null;
    return {
      ...r,
      overall: slot.overall, round: slot.round, roundPick: slot.roundPick, teamId: slot.teamId, from: slot.from,
    };
  }).filter(Boolean);
}

// ------------------------------------------------------------------ what if
//
// Tim, 2026-10-26: "add a "what if" feature in the draft section where you can
// click on a single player while a user is selected, and then you can replace
// that player with any other player that was drafted after that player and the
// what if will calculate the outcomes as if that user drafted that player. Add
// a "what if" box underneath the draft board that shows each user's record, avg
// scoring, etc. do a similar thing to the perfect draft where the player they
// take, shift all the other players down between the two player so it lines up
// correctly. … allow the user to keep switching their draft picks with other
// players as much as they want. When they're done allow the player to go back
// to normal aswell. Add as many details as you can to the simulated season in
// the what if box."
//
// THE BOARD. A swap is `{overall, playerId}`: at that pick, its team takes that
// man, who was on the board LATER; the men in between each slide one pick later
// (`shiftUp`, the perfect draft's own shift). Swaps stack: each is made on the
// board the earlier ones left, in the order they were made, so undo is "drop
// the last one" and back to normal is "none". A swap whose man is not later on
// that board (an earlier swap moved him up past it) is skipped.
//
// THE SEASON. Every slot whose man changed is one change for the team that
// owns the slot: out goes the man it really drafted there, in comes the man
// the what-if puts there. Week by week, against the real schedule:
//   - THE ROSTER: the team's real squad that week, with each man it drafted
//     swapped for his what-if man — only in weeks it really still held him (a
//     man it traded or dropped takes his replacement with him), and only when
//     the new man is free that week: on nobody's squad, or on one losing him
//     to a swap that same week. Otherwise that swap is off for the week, so
//     no man ever plays for two teams.
//   - A PLAYED WEEK'S SCORE: the real score, plus what the change does to the
//     lineup — ESPN's own projections pick the best legal lineup of the squad
//     with the change and without it, and the difference between what those
//     two lineups ACTUALLY scored is added. An unchanged squad scores exactly
//     its real score; the manager's own choices stay in it. Injured reserve
//     is left out of both.
//   - A WEEK STILL TO COME (and the week under way): the best lineup's
//     projection, with and without the change, played out by the site's season
//     simulation (js/forecast.js `simulateSeason`: same spread, same seed for
//     both) for the playoff chance. Only played weeks make the record.
// Standings: win percentage (a tie half a win), then points for — ESPN's order,
// js/capture.js `standingsKey`.

const IR_SLOT = 21;

/**
 * The board after a list of swaps, in pick order: each slot's own pick with
 * the man who fills it (`playerId`) and where he was really taken (`from`) —
 * `perfectOrder`'s shape, so `perfectRows` and `boardOf` read it as they read that.
 *
 * @param {Array<{overall:number, teamId:number, playerId:number}>} picks the real draft
 * @param {Array<{overall:number, playerId:number}>} swaps in the order made
 */
export function whatIfOrder(picks, swaps) {
  const slots = (picks || []).slice().sort((a, b) => a.overall - b.overall);
  const from = new Map(slots.map((p) => [p.playerId, p.overall]));
  const men = slots.map((p) => p.playerId);
  for (const s of swaps || []) {
    const i = slots.findIndex((p) => p.overall === Number(s && s.overall));
    const k = men.findIndex((id) => String(id) === String(s && s.playerId));
    shiftUp(men, i, k);
  }
  return slots.map((p, i) => ({ ...p, playerId: men[i], from: from.get(men[i]) }));
}

/** The swaps of a list that `whatIfOrder` really makes (each on the board the ones before it left). */
export function whatIfApplied(picks, swaps) {
  const out = [];
  for (const s of swaps || []) {
    const order = whatIfOrder(picks, out);
    const i = order.findIndex((p) => p.overall === Number(s && s.overall));
    const k = order.findIndex((p) => String(p.playerId) === String(s && s.playerId));
    if (i >= 0 && k > i) out.push({ overall: Number(s.overall), playerId: order[k].playerId });
  }
  return out;
}

/** Who can be taken at a pick on a (what-if) board: every man after it, in board order. */
export function whatIfCandidates(order, overall) {
  const list = order || [];
  const i = list.findIndex((p) => p.overall === Number(overall));
  return i < 0 ? [] : list.slice(i + 1);
}

/**
 * Each team's changes: `Map<teamId, Array<{overall, out, in}>>` — at each of
 * its slots whose man the what-if changed, the man it really drafted (`out`)
 * and the what-if's man (`in`). A team with no change has no entry.
 */
export function whatIfChanges(picks, order) {
  const real = new Map((picks || []).map((p) => [p.overall, p]));
  const out = new Map();
  for (const slot of order || []) {
    const r = real.get(slot.overall);
    if (!r || String(r.playerId) === String(slot.playerId)) continue;
    const key = r.teamId;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ overall: slot.overall, out: r.playerId, in: slot.playerId });
  }
  return out;
}

/**
 * A week's swaps that are on: `Map<teamId, Array<{out, in}>>` — see "THE
 * SEASON" above. A swap is on when the team holds its `out` man that week and
 * its `in` man is free (on no squad, or leaving his own through a swap that is on).
 *
 * @param {Array<{id:number, players:Array<{playerId:number}>}>} teams the week's real squads
 * @param {Map<number, Array<{out:number, in:number}>>} changes `whatIfChanges(...)`
 */
export function whatIfWeekSwaps(teams, changes) {
  const holder = new Map();
  for (const t of teams || []) for (const p of t.players || []) holder.set(String(p.playerId), String(t.id));
  let on = [];
  for (const [teamId, list] of changes || []) {
    for (const c of list) if (holder.get(String(c.out)) === String(teamId)) on.push({ teamId, ...c });
  }
  for (;;) {
    const leaving = new Set(on.map((c) => String(c.out)));
    const keep = on.filter((c) => !holder.has(String(c.in)) || leaving.has(String(c.in)));
    if (keep.length === on.length) break;
    on = keep;
  }
  const out = new Map();
  for (const c of on) {
    if (!out.has(c.teamId)) out.set(c.teamId, []);
    out.get(c.teamId).push({ out: c.out, in: c.in });
  }
  return out;
}

/**
 * The best legal lineup by ESPN's projection (js/forecast.js `optimalLineup`),
 * with what it projected and what its men actually scored.
 * @param {Array<{playerId, position, proj, act}>} pool
 */
export function lineupOf(pool, slots) {
  const men = (pool || []).filter((p) => p && p.position && num(p.proj) !== null)
    .map((p) => ({ ...p, projected: p.proj }));
  const { starters } = optimalLineup(men, slots);
  return {
    starters,
    proj: starters.reduce((a, p) => a + p.proj, 0),
    act: starters.reduce((a, p) => a + (num(p.act) ?? 0), 0),
  };
}

/**
 * The season again, with the draft's changes — see "THE SEASON" above.
 *
 * @param {Object} o
 * @param {Array} o.teamIds
 * @param {Array<{week, homeId, awayId, homeScore, awayScore, final:boolean}>} o.games
 *   the regular season; `final` = the game is decided
 * @param {Map<number, Array>} o.rosters week -> that week's real squads (js/season.js shape)
 * @param {number[]} o.slots one team's starting lineup
 * @param {Map} o.changes `whatIfChanges(...)`
 * @param {function(number):{position:string, byWeek:Object}|null} o.manOf a drafted man's
 *   weeks: `byWeek[w] = {proj, act, counts, done}` (js/draft-page.js `assemble`)
 * @param {Object|null} [o.playoff] `{teams, weeks}`: how many make it, and the bracket's weeks
 * @param {number|null} [o.sigma] the league's spread; no sim without it
 * @returns {{ teams: Array, changed: Set, left: number, simulated: boolean }}
 *   one entry a team, in `teamIds` order: `{ teamId, real, whatIf, weeks }`;
 *   `real`/`whatIf` = `{ w, l, t, games, pf, pa, avg, best, worst, rank, pPlayoffs }`;
 *   `weeks` one a played or coming game: `{ week, oppId, final, real:{pts, opp, res},
 *   whatIf:{pts, opp, res}, delta, ins, outs }` (`ins`/`outs`: the swapped men
 *   with what they scored and whether the lineup started them)
 */
export function whatIfSeason({ teamIds, games, rosters, slots, changes, manOf, playoff = null, sigma = null, runs = 4000, seed = 1 }) {
  const ids = (teamIds || []).slice();
  const key = (id) => String(id);
  const weekCache = new Map();

  /** One week, both ways: per team `{ real, whatIf, ins, outs, swapped }` (lineups as `lineupOf`). */
  const weekOf = (w, final) => {
    const ck = `${w}|${final}`;
    if (weekCache.has(ck)) return weekCache.get(ck);
    const teams = (rosters && rosters.get(w)) || [];
    const on = whatIfWeekSwaps(teams, changes);
    const out = new Map();
    for (const t of teams) {
      const pool = (t.players || []).filter((p) => p && p.lineupSlotId !== IR_SLOT).map((p) => ({
        playerId: p.playerId,
        position: p.position,
        proj: num(final ? (p.done === true ? p.pregame : p.projected) : p.projected),
        act: final ? (num(p.actual) ?? 0) : null,
      }));
      const swaps = on.get(t.id) || on.get(Number(t.id)) || on.get(String(t.id)) || [];
      const outIds = new Set(swaps.map((s) => String(s.out)));
      const ins = swaps.map((s) => {
        const m = manOf ? manOf(s.in) : null;
        const e = m && m.byWeek ? m.byWeek[w] : null;
        return {
          playerId: s.in,
          position: (m && m.position) || '',
          proj: e ? num(final ? e.proj : e.counts) : null,
          act: final ? (e ? num(e.act) ?? 0 : 0) : null,
        };
      });
      const real = lineupOf(pool, slots);
      const wi = swaps.length ? lineupOf([...pool.filter((p) => !outIds.has(String(p.playerId))), ...ins], slots) : real;
      const startedIn = (lu, id) => lu.starters.some((s) => String(s.playerId) === String(id));
      out.set(key(t.id), {
        real, whatIf: wi, swapped: swaps.length > 0,
        ins: ins.map((p) => ({ playerId: p.playerId, act: p.act, proj: p.proj, start: startedIn(wi, p.playerId) })),
        outs: swaps.map((s) => {
          const p = pool.find((x) => String(x.playerId) === String(s.out)) || {};
          return { playerId: s.out, act: p.act ?? null, proj: p.proj ?? null, start: startedIn(real, s.out) };
        }),
      });
    }
    weekCache.set(ck, out);
    return out;
  };

  const blank = () => ({ w: 0, l: 0, t: 0, games: 0, pf: 0, pa: 0, best: null, worst: null });
  const stand = new Map(ids.map((id) => [key(id), { real: blank(), whatIf: blank(), weeks: [] }]));
  const changed = new Set();
  const remaining = { real: [], whatIf: [] };
  let left = 0;

  for (const g of games || []) {
    if (g.homeId === null || g.homeId === undefined || g.awayId === null || g.awayId === undefined) continue;
    const h = stand.get(key(g.homeId));
    const a = stand.get(key(g.awayId));
    if (!h || !a) continue;
    const wk = weekOf(g.week, g.final === true);
    const side = (id) => wk.get(key(id)) || null;
    const hs = side(g.homeId);
    const as = side(g.awayId);
    if (hs && hs.swapped) changed.add(key(g.homeId));
    if (as && as.swapped) changed.add(key(g.awayId));

    if (g.final !== true) {
      left++;
      for (const v of ['real', 'whatIf']) {
        remaining[v].push({
          week: g.week, homeId: g.homeId, awayId: g.awayId,
          homeProj: hs ? hs[v].proj : null, awayProj: as ? as[v].proj : null,
        });
      }
      for (const [me, mine, them, theirs] of [[h, hs, g.awayId, as], [a, as, g.homeId, hs]]) {
        me.weeks.push({
          week: g.week, oppId: them, final: false,
          real: { pts: mine ? mine.real.proj : null, opp: theirs ? theirs.real.proj : null, res: null },
          whatIf: { pts: mine ? mine.whatIf.proj : null, opp: theirs ? theirs.whatIf.proj : null, res: null },
          delta: mine ? mine.whatIf.proj - mine.real.proj : 0,
          ins: mine ? mine.ins : [], outs: mine ? mine.outs : [],
        });
      }
      continue;
    }

    const real = { home: num(g.homeScore) ?? 0, away: num(g.awayScore) ?? 0 };
    // A changed side: its real score plus what the change does to its lineup's actual points.
    const shift = (s) => (s && s.swapped ? s.whatIf.act - s.real.act : 0);
    const wi = { home: real.home + shift(hs), away: real.away + shift(as) };
    const res = (mine, theirs) => (mine > theirs + 1e-9 ? 'W' : theirs > mine + 1e-9 ? 'L' : 'T');
    for (const [me, mine, them, theirs, my, their] of [
      [h, hs, g.awayId, as, 'home', 'away'], [a, as, g.homeId, hs, 'away', 'home']]) {
      for (const v of ['real', 'whatIf']) {
        const pts = v === 'real' ? real[my] : wi[my];
        const opp = v === 'real' ? real[their] : wi[their];
        const s = me[v];
        const r = res(pts, opp);
        if (r === 'W') s.w++; else if (r === 'L') s.l++; else s.t++;
        s.games++;
        s.pf += pts;
        s.pa += opp;
        if (!s.best || pts > s.best.pts) s.best = { week: g.week, pts };
        if (!s.worst || pts < s.worst.pts) s.worst = { week: g.week, pts };
      }
      me.weeks.push({
        week: g.week, oppId: them, final: true,
        real: { pts: real[my], opp: real[their], res: res(real[my], real[their]) },
        whatIf: { pts: wi[my], opp: wi[their], res: res(wi[my], wi[their]) },
        delta: wi[my] - real[my],
        ins: mine ? mine.ins : [], outs: mine ? mine.outs : [],
      });
    }
  }

  // Ranks: the standings each way.
  for (const v of ['real', 'whatIf']) {
    const order = ids.slice().sort((x, y) => {
      const a = stand.get(key(x))[v];
      const b = stand.get(key(y))[v];
      return standingsKey(b, b.pf) - standingsKey(a, a.pf);
    });
    order.forEach((id, i) => {
      const s = stand.get(key(id))[v];
      s.rank = i + 1;
      s.avg = s.games ? s.pf / s.games : null;
    });
  }

  // The playoff chance, our model: the site's season simulation, both ways, same spread and seed.
  let simulated = false;
  for (const s of stand.values()) { s.real.pPlayoffs = null; s.whatIf.pPlayoffs = null; }
  if (playoff && Number.isFinite(sigma) && sigma > 0 && ids.length) {
    for (const v of ['real', 'whatIf']) {
      const banked = new Map(ids.map((id) => {
        const s = stand.get(key(id))[v];
        return [id, { wins: s.w + s.t / 2, pointsFor: s.pf }];
      }));
      const proj = new Map();
      for (const w of playoff.weeks || []) {
        const wk = weekOf(w, false);
        proj.set(w, new Map(ids.map((id) => [id, wk.has(key(id)) ? wk.get(key(id))[v].proj : null])));
      }
      const res = simulateSeason({
        teamIds: ids, banked, games: remaining[v], sigma, runs, seed,
        playoff: { teams: playoff.teams, weeks: playoff.weeks || [], proj },
      });
      if (!res) continue;
      simulated = true;
      for (const t of res.teams) stand.get(key(t.teamId))[v].pPlayoffs = t.pPlayoffs;
    }
  }

  return {
    teams: ids.map((id) => ({ teamId: id, ...stand.get(key(id)) })),
    changed, left, simulated,
  };
}

// ------------------------------------------------------------ the sample draft

/** What was expected of a sample man before the season, over the bar at his position. */
function sampleWorth(list, slots) {
  const pool = list.flatMap((t) => (t.players || []).map((p) => ({ position: p.position, total: num(p.seasonProjected) ?? 0 })));
  const bars = leagueBars(pool, slots, list.length);
  return (p) => (num(p.seasonProjected) ?? 0) - ((bars.get(p.position) || {}).bar || 0);
}

/**
 * The sample league's preseason ranks, which no one ever published: every man
 * in it best first by the same worth `sampleDraft` drafts on. `Map<playerId, rank>`.
 */
export function sampleRanks(teams, slots) {
  const list = teams || [];
  const worth = sampleWorth(list, slots);
  const all = list.flatMap((t) => t.players || []).slice().sort((a, b) => worth(b) - worth(a) || a.playerId - b.playerId);
  return new Map(all.map((p, i) => [p.playerId, i + 1]));
}

/**
 * A draft for the sample league, which never had one: a snake in the order the
 * teams are listed, each team taking its own men best first by what was
 * expected of them before the season (`seasonProjected` over the bar).
 *
 * @param {Array<{id:number, players:Array}>} teams week 1's squads
 * @param {number[]} slots one team's starting lineup
 * @returns {ReturnType<typeof parseDraft>}
 */
export function sampleDraft(teams, slots) {
  const list = teams || [];
  const worth = sampleWorth(list, slots);
  const lists = list.map((t) => (t.players || []).slice().sort((a, b) => worth(b) - worth(a) || a.playerId - b.playerId));
  const rounds = Math.max(0, ...lists.map((l) => l.length));
  const n = list.length;
  const picks = [];
  for (let r = 0; r < rounds; r++) {
    for (let k = 0; k < n; k++) {
      const col = r % 2 === 0 ? k : n - 1 - k;
      const p = lists[col][r];
      if (!p) continue;
      picks.push({
        overall: r * n + k + 1, round: r + 1, roundPick: k + 1,
        teamId: list[col].id, playerId: p.playerId, bid: null, keeper: false,
      });
    }
  }
  return { type: 'snake', done: true, order: list.map((t) => t.id), picks };
}
