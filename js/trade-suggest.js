// SUGGESTED ADDITIONS — the men who would make a half-built trade more even.
//
// Tim, 2026-09-19: "I also want to add a 'suggested player' in the custom trade
// box which adds suggested players to send to make the trade more even. This
// only appears in the player's box after you select a player. Make sure that you
// do as many players that would be eligable to make the trade more even, and not
// just 1 to make it perfect. Allow for some leeway so that the user can do a
// 'fleece' trade and have the opponent have a -/week or something like that."
//
// Pure — no DOM, no page state, no fetching, and nothing imported from any
// `*-page.js`. The same discipline `js/trade.js` and `js/floor.js` keep, and the
// only reason any of this is node-testable.
//
// ===========================================================================
// WHAT "MORE EVEN" MEANS HERE, and why it is this and not something else
// ===========================================================================
//
// A half-built deal has exactly two numbers on it, and the page already prints
// both: `forA.delta` and `forB.delta` out of `priceTradeAcrossWeeks` — what each
// squad's own best-legal-lineup-every-week is worth after the deal minus what it
// is worth now, totalled over the weeks that are left.
//
// **Evenness is `|deltaA − deltaB|`, and a candidate improves it when adding him
// makes that number smaller.** `gap` below is the SIGNED version, `deltaA −
// deltaB`, so a caller can say which way the deal leans as well as by how much.
//
// THE OBJECTION, and it is a real one: two deltas measured on two different
// rosters are not obviously commensurable. A point added to a squad already
// fielding 130 a week is not worth the same, in games won, as a point added to
// one fielding 95. That is true, and it is the reason this file does NOT claim
// to measure fairness. What it measures is the thing the reader is looking at:
// two numbers in the same unit, from the same engine, over the same weeks, with
// the same floors, printed side by side in one panel. "Make the trade more even"
// is a sentence about those two numbers. Turning it into a sentence about win
// probability would be a different feature, would need each squad's schedule,
// and would answer a question Tim did not ask.
//
// THE SECOND OBJECTION, and it is why `candidates` carries more than a gap: a
// deal where both sides gain +8 is even, and so is one where both sides lose 8.
// The gap cannot tell them apart and it is not being asked to. Every candidate
// therefore comes back with `deltaA` AND `deltaB` in full, plus `bothGain`, so
// the caller prints what each manager actually ends up at and the reader decides.
// An engine that collapsed that into one "evenness score" would be hiding the
// half of the answer Tim explicitly asked to be able to see.
//
// TWO ALTERNATIVES CONSIDERED AND REJECTED:
//
//   - "Raise the worse-off side" (maximise `min(deltaA, deltaB)`). Reads well
//     until the deal is already win-win, where it then recommends piling more
//     men onto an even deal forever because the minimum keeps creeping up. It is
//     a rule about generosity, not evenness.
//   - "Both sides positive" (what `findTrades` requires). That is the FINDER's
//     question and this panel is deliberately not the finder — Tim built the
//     custom box to price the deal he already has in his head, good or bad, and
//     this must not quietly turn it back into a win-win search. See rule 4 in
//     the header of `suggestAdditions`.
//
// ===========================================================================
// WHICH SIDE'S MEN ARE THE SUGGESTIONS
// ===========================================================================
//
// He said "suggested players to SEND". If he is receiving a star, the men who
// even it up are his own — so the candidates come from the side that is
// currently AHEAD, because only that side can give more away. Get this backwards
// and the panel offers the opponent's squad as things for Tim to hand over,
// which is not a bug that looks like a bug: it reads as nonsense.
//
// `side: 'auto'` works it out from the sign of the gap. `'a'` / `'b'` force it,
// and forcing the side that is BEHIND correctly returns nothing — adding to the
// short side can only make the gap bigger, and saying so with an empty list is
// more honest than inventing suggestions that make the deal worse.
//
// ===========================================================================
// ONE MAN AT A TIME, AND THAT IS A DECISION
// ===========================================================================
//
// A suggestion is never a PAIR of men. Three reasons, in order of weight:
//
//   1. He can tick one and the list re-ranks around it, which is the same answer
//      arrived at one step at a time — and it is the step he was going to take
//      anyway, since every suggestion has to be ticked by hand in the end.
//   2. Pairs are quadratic in both the pool and the price. Sixteen spare men is
//      120 pairs, at ~4 lineup fills a week a candidate — see the COST note —
//      and this whole pass re-runs on every tick of a checkbox.
//   3. A pair priced as a unit hides which half of it was doing the work. Two
//      rows, each with its own resulting numbers, is the same information
//      without the reader having to take it on trust.
//
// The cost of the decision is real and worth stating: where no single man lands
// the deal even, the list will contain only men who get PART of the way, and
// the reader has to tick twice to see the rest. That is the behaviour, not an
// oversight.
//
// ===========================================================================
// ONE PRICING RULE
// ===========================================================================
//
// Every candidate is priced through `priceTradeAcrossWeeks` — the same function,
// the same `weeks`, the same `projFor`, the same `zeroIsBye` and the SAME
// `floors` the custom box priced the deal itself with. Nothing here has its own
// idea of what a roster is worth.
//
// That is not tidiness. `bestCombo` priced its packings without the positional
// floor while every row above it was floored, and the same deal came out +5.5 to
// the finder and −10.9 to the combo (HANDOFF rule 13, final paragraph). A
// suggestion priced on a different basis from the deal it is a suggestion FOR is
// that identical defect, one panel further down the page.
//
// ===========================================================================
// COST
// ===========================================================================
//
// One candidate = two `priceTradeAcrossWeeks` calls (his side and the other
// side) = 4 lineup fills per remaining week. MEASURED 2026-09-19 on the demo
// league, tests/test-trade-suggest.mjs, two 16-man squads over 9 remaining
// weeks, which is the shape Tim's league actually is:
//
//     24-31ms for the whole pass at the default limit of 14 candidates
//     ~1.9ms a candidate, and it scales linearly in candidates x weeks
//     5-6ms at limit 4, so the knob really is the lever it claims to be
//
// That is inside a checkbox tick's budget with room to spare, which is why the
// default limit is high enough to cover a whole roster rather than being tuned
// down: on a normal league the cap never binds and the answer is exhaustive.
// `limit` is there for a league with a pathological bench and for a caller that
// wants the panel to feel instant on a phone; when it binds, the pool is cut by
// the cheap pre-filter below and the result says `limited: true`.
//
// One redundancy is knowingly left in: `priceTradeAcrossWeeks` re-fills the
// BEFORE lineups on every call, and they never change across candidates, so
// about half the fills above are recomputed. Caching them would mean going round
// the shared entry point — which is precisely the seam where a second pricing
// basis gets in — and 12ms does not buy that risk.
//
// ===========================================================================
// THE GOAL (2026-09-21): EVEN IN THE CURRENCY THE FINDER USES
// ===========================================================================
//
// Tim: "the user should essentially open with a goal and all the data aligns
// with that goal." The finder keeps and orders deals by the GOAL-WEIGHTED gain
// — Σ weight × that week's change, one weight per priced week, from
// js/trade-odds.js `weekWeights` (mean 1, so it still reads in points). Until
// this change these suggestions evened the raw POINTS gap, so under "Win it all"
// a man worth nothing until the playoffs was priced like a man worth the same
// points in October — the one thing the goal exists to stop.
//
// So: hand in `weightsA` and/or `weightsB` (one per week in `weeks`; the Trade
// page passes the finder's own set for both sides — a second squad's own set
// is a fresh multi-second simulation on a checkbox tick) and each side's gain
// becomes its goal-weighted gain, and the
// gap, the "about even" band, `label`, `favours` and the ranking all work on
// that. A side with no weights (its goal is settled — `weekWeights` returned
// null) counts its weeks at 1 each, which is its points. With no weights at
// all this file is exactly what it was, and the result says which basis it
// used (`basis: 'goal' | 'points'`), so the page can say so (rule 7).
//
// THE PRINTED NUMBERS STAY POINTS: `deltaA` / `deltaB` / `opponentDelta` /
// `fleece` are still the lineups' points, because they are what the row prints
// ("then you +x · him −y /wk"). The weighted versions ride alongside as
// `goalA` / `goalB`.
//
// THE TIE-BREAK FOLLOWS THE FINDER TOO. With an `accept` function (the page's
// P(he says yes), js/trade-odds.js `acceptChance`), two additions that land the
// deal equally even are ordered by `expected` = A's goal-weighted gain × that
// chance — the same product the finder's `rankBy` keeps deals by. Without one,
// the old tie-break (total points the deal creates) stands. Nothing is ever
// filtered on it: rule 2 below — a fleece is still allowed — is untouched.

import { priceTradeAcrossWeeks } from './trade.js';

/**
 * How close is "about even", PER WEEK.
 *
 * Per week because that is the scale Tim reads in (HANDOFF rule 10: per week
 * first, the rest-of-season total as the small sub-number), and a tolerance
 * quoted as a season total would mean something different in week 3 than in
 * week 12. Half a point a week is under a rounding step on a ~110-point lineup
 * and is not a deal anyone would renegotiate over.
 *
 * IT IS A LABEL, NEVER A FILTER. Nothing is hidden for being outside it — that
 * is rule 4 of `suggestAdditions` and the whole of what makes a fleece possible.
 */
export const EVEN_TOLERANCE_PER_WEEK = 0.5;

/**
 * How much the gap has to shrink before it counts as an improvement, per week.
 *
 * The same reasoning and the same number as `MIN_GAIN` in js/trade.js: a tenth
 * of a point a week is float noise wearing a suggestion's clothes, and across
 * nine weeks the noise adds up with the span, so the floor has to as well.
 */
export const MIN_IMPROVEMENT_PER_WEEK = 0.1;

/**
 * How many spare men get PRICED. Fourteen covers a 16-man roster with a man or
 * two already ticked, so in a normal league the cap never binds and the answer
 * is exhaustive. See the COST note above for what it buys.
 */
export const SUGGEST_LIMIT = 14;

const round1 = (n) => Math.round(n * 10) / 10;

/** A player id, whether you were handed the player or just his id. */
const idOf = (p) => (p && typeof p === 'object' ? p.playerId : p);

/**
 * Ticked men, resolved to the roster entries they name.
 *
 * `priceTradeAcrossWeeks` accepts ids on the SEND side but needs real entries on
 * the RECEIVE side — `projFor` is asked for that man's weekly projections and an
 * id carries none. Both sides of a custom trade are a receive side from the
 * other squad's point of view, so everything is resolved here, once.
 *
 * A ticked man who is not on the roster he was ticked from is counted rather
 * than priced. The page detects that case already and says so (a saved trade
 * outlives a waiver claim); pricing a deal with him silently dropped would quote
 * a number for a different deal from the one on screen.
 */
function resolveSide(list, roster) {
  const byId = new Map();
  for (const p of roster || []) if (p && p.playerId != null) byId.set(p.playerId, p);
  const out = [];
  let unresolved = 0;
  for (const entry of list || []) {
    const id = idOf(entry);
    if (id != null && byId.has(id)) out.push(byId.get(id));
    else unresolved++;
  }
  return { list: out, unresolved };
}

/**
 * The deal as it stands, priced from both managers' chairs.
 *
 * Symmetric by construction: A's send is B's receive. `findTrades` prices a
 * counterparty in exactly this way, and so does the Trade page's pop-up, so
 * three readers of one deal cannot disagree about it.
 */
function priceBothSides(rosterA, rosterB, sendA, sendB, pricing, weigh = null) {
  const forA = priceTradeAcrossWeeks({
    players: rosterA, send: sendA, receive: sendB, ...pricing,
  });
  const forB = priceTradeAcrossWeeks({
    players: rosterB, send: sendB, receive: sendA, ...pricing,
  });
  // THE BASIS the gap is measured on: goal-weighted gains when `weigh` is
  // given (see THE GOAL above), the points otherwise.
  const goalA = weigh ? weigh.a(forA) : null;
  const goalB = weigh ? weigh.b(forB) : null;
  return {
    forA,
    forB,
    deltaA: forA.delta,
    deltaB: forB.delta,
    goalA,
    goalB,
    gap: weigh ? round1(goalA - goalB) : round1(forA.delta - forB.delta),
  };
}

/**
 * One side's weights, if they are usable: finite, non-negative, one per week.
 * Anything else is no weights, which is that side's points.
 */
function usableWeights(w, n) {
  return Array.isArray(w) && w.length === n && w.every((x) => Number.isFinite(x) && x >= 0) ? w : null;
}

/** Σ weight × that week's change — `findTrades`'s `goalPoints`, from a pricing. */
function weighedGain(pricing, w) {
  if (!w) return pricing.delta;
  let s = 0;
  (pricing.byWeek || []).forEach((x, i) => { s += w[i] * (Number.isFinite(x.delta) ? x.delta : 0); });
  return round1(s);
}

/**
 * A man's rest-of-season projection, added up. The CHEAP half of the work.
 *
 * Used only to decide who gets priced when `limit` binds — never to decide
 * whether he helps, which is always the real price. A null week is a week ESPN
 * was quiet about and contributes nothing, exactly as it does in the engine.
 */
function seasonTotalOf(player, weeks, projFor, weights = null) {
  let sum = 0;
  let known = 0;
  for (let i = 0; i < weeks.length; i++) {
    const v = projFor(player, weeks[i]);
    if (Number.isFinite(v)) { sum += (weights ? weights[i] : 1) * v; known++; }
  }
  return known ? round1(sum) : null;
}

/**
 * Rank the pool before paying to price it.
 *
 * A man worth `v` over the rest of the season moves the gap somewhere between
 * `v` and `2v`: `v` if he is on his own side's bench (leaving costs that side
 * nothing, arriving is worth up to `v` to the other), `2v` if he is a starter on
 * both (his side loses him AND the other side gains him). So the men worth
 * pricing first are the ones whose `[v, 2v]` band contains the gap that needs
 * closing, and the ordering is by distance from that band — zero for anyone
 * inside it.
 *
 * NO INVENTED CONSTANT, and deliberately: the band is derived from what the
 * lineup arithmetic can do, not from a tuning number somebody typed in. It is
 * also only ever a ranking — every man it puts first is still priced properly,
 * and the exact prices re-rank the survivors from scratch.
 */
function preFilterRank(value, gapAbs) {
  const v = Number.isFinite(value) ? Math.abs(value) : 0;
  const lo = Math.min(v, v * 2);
  const hi = Math.max(v, v * 2);
  if (gapAbs >= lo && gapAbs <= hi) return 0;
  return gapAbs < lo ? lo - gapAbs : gapAbs - hi;
}

/**
 * Every spare man whose addition would make a half-built trade more even.
 *
 * @param {Object} opts
 * @param {Array}  opts.rosterA   squad A's players
 * @param {Array}  opts.rosterB   squad B's players
 * @param {Array}  opts.sendA     what A is already sending (players or ids)
 * @param {Array}  opts.sendB     what B is already sending (players or ids)
 * @param {number[]} opts.slots   the league's starting slots
 * @param {number[]} opts.weeks   the remaining weeks, ascending
 * @param {function} opts.projFor `(player, week) -> number|null`
 * @param {boolean|function} [opts.zeroIsBye] is a 0.00 a bye? See js/trade.js
 * @param {Map}    [opts.floors]  the positional floor — THE SAME MAP the deal
 *   itself was priced with. See the ONE PRICING RULE note above.
 * @param {'auto'|'a'|'b'|'both'} [opts.side] whose spare men to consider
 * @param {number} [opts.limit]   how many spare men get priced
 * @param {number} [opts.tolerance] the "about even" band, as a rest-of-season
 *   TOTAL. Defaults to `EVEN_TOLERANCE_PER_WEEK x weeks.length`, because every
 *   other number in this file is a total and mixing the two scales is how a
 *   page ends up wrong by a factor of nine and looks fine doing it.
 * @param {number} [opts.minImprovement] likewise, as a total.
 * @param {number[]} [opts.weightsA] squad A's goal weights, one per week in
 *   `weeks` (js/trade-odds.js `weekWeights`). See THE GOAL note above.
 * @param {number[]} [opts.weightsB] squad B's, likewise.
 * @param {function} [opts.accept] `({sendA, sendB, forA, forB}) -> number|null`
 *   — the chance B says yes to the deal with the man added; orders ties by
 *   A's goal-weighted gain × it, as the finder's `rankBy` does.
 *
 * `basis` in the result is 'goal' when either side's weights were used, else
 * 'points'. Each candidate also carries `goalA`, `goalB` (null on points),
 * `accept` and `expected` (null without an `accept`).
 *
 * @returns {{
 *   ok: boolean, reason: string|null, side: string, weeks: number[],
 *   tolerance: number, minImprovement: number,
 *   base: {deltaA:number, deltaB:number, gap:number, gapAbs:number,
 *          favours:'a'|'b'|null, even:boolean, bothGain:boolean,
 *          forA:Object, forB:Object},
 *   candidates: Array<Candidate>, rejected: Array<Candidate>,
 *   pool: number, considered: number, limited: boolean, unresolved: number
 * }}
 *
 * A Candidate is:
 *
 *   player        the roster entry, so the caller can draw him without a lookup
 *   playerId, name, position
 *   side          'a' | 'b' — whose squad he leaves
 *   deltaA, deltaB    what EACH side ends up at with him added (totals)
 *   gap, gapAbs       signed `deltaA - deltaB` afterwards, and its size
 *   gapBefore, gapAbsBefore   the same two before he was added
 *   shrink        `gapAbsBefore - gapAbs` — how much evener he makes it
 *   improves      always true in `candidates`, always false in `rejected`
 *   even          lands inside the tolerance band
 *   favours       'a' | 'b' | null (null inside the band)
 *   label         'even' | 'ahead' | 'behind', RELATIVE TO THE SIDE ADDING HIM
 *                 — 'ahead' means the adder is still winning the deal
 *   fleece        the OTHER side ends up NEGATIVE. A different fact from
 *                 'ahead': the other manager can be up on the deal and still
 *                 be getting the worse half of it.
 *   opponentDelta the other side's resulting delta, spelled out so the panel
 *                 can print "he ends up at −1.2 a week" without working out
 *                 which of deltaA/deltaB that is.
 *   bothGain      both sides end up positive
 *   value         his rest-of-season projection total (the pre-filter's number)
 *   rank          1-based, in the returned order
 *   pricing       {forA, forB} — the full `priceTradeAcrossWeeks` results,
 *                 already computed, so a pop-up costs no second pricing pass
 *
 * FOUR RULES THIS FUNCTION KEEPS:
 *
 *  1. ALL OF THEM, NOT THE BEST ONE. Every man who improves evenness comes
 *     back, ranked. The caller decides how many to draw. Tim asked for this in
 *     those words and a list of one would not answer him.
 *  2. IT NEVER FILTERS TO FAIR DEALS. A candidate that leaves the other manager
 *     well under water is returned, ranked and labelled, with both resulting
 *     numbers on it. The tolerance band is for ranking and for saying "this one
 *     lands it about even" — never for hiding anything. That is the whole of
 *     "allow for some leeway so that the user can do a fleece trade".
 *  3. IT DOES EXCLUDE A MAN WHO DOES NOT HELP. Adding him and getting a wider
 *     gap, or the same gap, is not a suggestion — it is noise in a list Tim has
 *     to read. Those men come back in `rejected` with their numbers, so a panel
 *     can say "nothing else here helps" with evidence rather than in silence.
 *  4. IT NEVER CHANGES WHO STARTS, because it never picks a lineup: every
 *     lineup here is `optimalLineup`'s, reached through `priceTradeAcrossWeeks`,
 *     and the floors are applied where they always are — to the assessment.
 */
export function suggestAdditions({
  rosterA, rosterB, sendA = [], sendB = [],
  slots, weeks, projFor, zeroIsBye = true, floors = null,
  side = 'auto',
  limit = SUGGEST_LIMIT,
  tolerance = null,
  minImprovement = null,
  weightsA = null,
  weightsB = null,
  accept = null,
} = {}) {
  const ws = Array.isArray(weeks) ? weeks.slice() : [];
  const span = Math.max(1, ws.length);
  const wA = usableWeights(weightsA, ws.length);
  const wB = usableWeights(weightsB, ws.length);
  const basis = wA || wB ? 'goal' : 'points';
  const weigh = basis === 'goal'
    ? { a: (p) => weighedGain(p, wA), b: (p) => weighedGain(p, wB) }
    : null;
  // For the cheap pre-filter only: a man's value in the weeks that matter to
  // the two squads together.
  const wBoth = basis === 'goal'
    ? ws.map((_, i) => ((wA ? wA[i] : 1) + (wB ? wB[i] : 1)) / 2)
    : null;
  const band = Number.isFinite(tolerance) ? Math.abs(tolerance) : EVEN_TOLERANCE_PER_WEEK * span;
  const minShrink = Number.isFinite(minImprovement)
    ? Math.abs(minImprovement)
    : MIN_IMPROVEMENT_PER_WEEK * span;

  const empty = (reason) => ({
    ok: false, reason, side: 'none', weeks: ws, basis,
    tolerance: round1(band), minImprovement: round1(minShrink),
    base: null, candidates: [], rejected: [],
    pool: 0, considered: 0, limited: false, unresolved: 0,
  });

  // The weekly measure needs BOTH halves, exactly as `findTrades` does. Anything
  // less is a question this module cannot answer, and it says so rather than
  // falling back to a scalar — there is no scalar version of this panel, and a
  // suggestion priced on a different basis from the deal is the defect above.
  if (!Array.isArray(rosterA) || !Array.isArray(rosterB)) return empty('no rosters');
  if (!ws.length) return empty('no weeks left to price');
  if (typeof projFor !== 'function') return empty('no way to read a projection');

  const a = resolveSide(sendA, rosterA);
  const b = resolveSide(sendB, rosterB);
  const unresolved = a.unresolved + b.unresolved;

  // NOTHING IS TICKED, SO THERE IS NO DEAL TO EVEN UP. Tim's own condition —
  // "this only appears in the player's box after you select a player" — and it
  // is also the only honest answer: with both sides empty every candidate is a
  // gift, every gift makes the gap wider, and the list would be empty anyway
  // after a full pricing pass nobody needed to pay for.
  if (!a.list.length && !b.list.length) return empty('nothing is ticked yet');

  const pricing = { slots, weeks: ws, projFor, zeroIsBye, floors };
  const base = priceBothSides(rosterA, rosterB, a.list, b.list, pricing, weigh);
  const gapBefore = base.gap;
  const gapAbsBefore = Math.abs(gapBefore);

  // WHICH SIDE'S SPARES. The side that is ahead is the side that can give more
  // away; an exactly level deal has no ahead side, so both are offered and the
  // pricing decides (in practice nothing improves on a gap of zero, and an empty
  // list is the right answer).
  const wanted = side === 'auto'
    ? (gapBefore > 0 ? 'a' : gapBefore < 0 ? 'b' : 'both')
    : side;

  const tickedIds = new Set([...a.list, ...b.list].map((p) => p.playerId));
  const spares = [];
  const gather = (roster, which) => {
    for (const p of roster) {
      if (!p || p.playerId == null || tickedIds.has(p.playerId)) continue;
      const value = seasonTotalOf(p, ws, projFor, wBoth);
      // A man ESPN carries no number for in any remaining week cannot change
      // either lineup, so pricing him is a guaranteed rejection at full cost.
      if (value === null) continue;
      spares.push({ player: p, side: which, value });
    }
  };
  if (wanted === 'a' || wanted === 'both') gather(rosterA, 'a');
  if (wanted === 'b' || wanted === 'both') gather(rosterB, 'b');

  const pool = spares.length;
  spares.sort(
    (x, y) =>
      preFilterRank(x.value, gapAbsBefore) - preFilterRank(y.value, gapAbsBefore) ||
      y.value - x.value ||
      (Number(x.player.playerId) || 0) - (Number(y.player.playerId) || 0)
  );
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : pool;
  const priced = spares.slice(0, cap);

  const candidates = [];
  const rejected = [];

  for (const spare of priced) {
    const nextA = spare.side === 'a' ? a.list.concat(spare.player) : a.list;
    const nextB = spare.side === 'b' ? b.list.concat(spare.player) : b.list;
    const after = priceBothSides(rosterA, rosterB, nextA, nextB, pricing, weigh);
    let yes = null;
    if (typeof accept === 'function') {
      try {
        const v = accept({ sendA: nextA, sendB: nextB, forA: after.forA, forB: after.forB });
        yes = Number.isFinite(v) ? v : null;
      } catch { yes = null; }
    }
    const mineGain = weigh ? after.goalA : after.deltaA;

    const gapAbs = Math.abs(after.gap);
    const shrink = round1(gapAbsBefore - gapAbs);
    const improves = shrink >= minShrink;
    const even = gapAbs <= band;
    const favours = even ? null : after.gap > 0 ? 'a' : 'b';
    // Relative to the man's own side — he is the one being asked to throw in
    // more, so "ahead" means the throw-in still leaves him winning the deal.
    const label = even ? 'even' : favours === spare.side ? 'ahead' : 'behind';
    const opponentDelta = spare.side === 'a' ? after.deltaB : after.deltaA;

    const entry = {
      player: spare.player,
      playerId: spare.player.playerId,
      name: spare.player.name,
      position: spare.player.position,
      side: spare.side,
      value: spare.value,
      deltaA: after.deltaA,
      deltaB: after.deltaB,
      goalA: after.goalA,
      goalB: after.goalB,
      accept: yes,
      expected: yes === null ? null : round1(mineGain * yes),
      gap: after.gap,
      gapAbs: round1(gapAbs),
      gapBefore,
      gapAbsBefore: round1(gapAbsBefore),
      shrink,
      improves,
      even,
      favours,
      label,
      fleece: opponentDelta < 0,
      opponentDelta,
      bothGain: after.deltaA > 0 && after.deltaB > 0,
      rank: 0,
      pricing: { forA: after.forA, forB: after.forB },
    };
    (improves ? candidates : rejected).push(entry);
  }

  // Evenest first, because that is what was asked for. The tie-break is the
  // TOTAL the deal creates between the two squads (`deltaA + deltaB`): of two
  // additions that land the deal equally even, the one that makes more points
  // out of the same men is the better trade and the one the other manager is
  // likelier to take. Id last, so the order does not shuffle between renders of
  // the same deal. With an `accept` the first tie-break is instead the finder's
  // own product — A's gain (goal-weighted when there are weights) × the chance
  // B says yes — and the total points only after it.
  const ev = (c) => (Number.isFinite(c.expected) ? c.expected : -Infinity);
  candidates.sort(
    (x, y) =>
      x.gapAbs - y.gapAbs ||
      (ev(y) - ev(x) || 0) ||
      (y.deltaA + y.deltaB) - (x.deltaA + x.deltaB) ||
      (Number(x.playerId) || 0) - (Number(y.playerId) || 0)
  );
  candidates.forEach((c, i) => { c.rank = i + 1; });

  return {
    ok: true,
    reason: null,
    side: wanted,
    weeks: ws,
    basis,
    weighted: { a: !!wA, b: !!wB },
    tolerance: round1(band),
    minImprovement: round1(minShrink),
    base: {
      deltaA: base.deltaA,
      deltaB: base.deltaB,
      goalA: base.goalA,
      goalB: base.goalB,
      gap: gapBefore,
      gapAbs: round1(gapAbsBefore),
      favours: gapAbsBefore <= band ? null : gapBefore > 0 ? 'a' : 'b',
      even: gapAbsBefore <= band,
      bothGain: base.deltaA > 0 && base.deltaB > 0,
      forA: base.forA,
      forB: base.forB,
    },
    candidates,
    rejected,
    pool,
    considered: priced.length,
    limited: priced.length < pool,
    unresolved,
  };
}
