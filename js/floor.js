// THE POSITIONAL FLOOR — a minimum standard for what a lineup slot is worth.
//
// Tim, 2026-09-18: "if you are determining your total proj for week 14, but
// your K has a BYE that week and you don't have a backup, don't assess that K
// position to be 0 pts, assess it to be the max number of points that is
// available on the waivers for that position at any given time (maybe 7-8 for
// K). This will allow us to have a better idea of what the true future proj is
// going to be."
//
// He is right, and the reason is worth stating: a projection of 0 for a bye
// week is a fact about a PLAYER, and every page here uses it as though it were
// a fact about a TEAM. No manager fields an empty kicker slot. What he actually
// does is stream whoever is on the wire, so the honest assessment of that slot
// is not zero — it is what the wire would give him.
//
// ===========================================================================
// THE THREE DECISIONS BEHIND IT, all Tim's
// ===========================================================================
//
// 1. WHERE THE FLOOR COMES FROM: one wire read, used flat for every remaining
//    week. The alternative was a wire read per week, which is exact — who is
//    available really does change — but doubles the request count on Analysis
//    and Trade, taking a rest-of-season trade from about 12 requests to about
//    24. A floor stands for "whoever I would stream", and the man you stream is
//    by definition one who is playing, so a flat floor is closer to right than
//    it looks. Pages must say which it is; `describeFloors` writes that line.
//
// 2. WHAT IT APPLIES TO: everything below it, not just the empty slots. A
//    kicker projecting 4.1 when the wire holds a 7.8 was never really worth
//    4.1 — you would have streamed the 7.8. So a slot is worth
//    `max(his projection, the floor)`. "A min standard for positions", in his
//    words, and the empty-slot case falls out of it rather than being special.
//
// 3. HOW DEEP INTO THE WIRE (Tim, 2026-09-19): "the assumed is a little higher
//    than I would've expected and I think we should set the bar lower,
//    especially considering there might be 5-6 users also wanting the player at
//    the top of the waivers. Try moving the line down to around the 3rd best
//    player in the waivers of that position."
//
//    He is right, and it is the difference between what is ON the wire and what
//    you would actually END UP WITH. The top free agent at a position is the one
//    every manager in the league has noticed; in a ten-team league he goes to
//    whoever has the waiver priority or the biggest bid, which is nine times out
//    of ten not you. The third-best is the one you can reasonably expect to get,
//    and a floor is a claim about what you could field, not about what exists.
//    So `FLOOR_RANK` is 3 — and where the wire is thinner than that, the floor
//    falls back to the deepest man it actually holds rather than inventing one.
//
// ===========================================================================
// WHAT THIS MODULE WILL NOT DO
// ===========================================================================
//
// - IT NEVER INVENTS A FLOOR. No hardcoded table of "a kicker is worth 7".
//   Every number here is the best real free agent at that position in a real
//   wire read, and with no wire read there are NO floors and every page shows
//   exactly the numbers it showed before. That is the same rule the bye
//   handling follows (rule 2: with byes unknown, projections stay as sent) and
//   it is what keeps demo, stubs and archived readings honest.
// - IT NEVER CHANGES WHO STARTS. The floor is applied when a lineup is
//   ASSESSED, never when it is chosen. `optimalLineup` still picks the best
//   legal lineup on ESPN's own numbers. Folding a floor into the selection
//   would flatten real differences — a FLEX choice between a 5 and a 4 becomes
//   a tie the moment both are lifted to 8 — and would quietly change which men
//   the site says to start, which is a different feature that nobody asked for.
// - IT NEVER FLOORS A PLAYED WEEK. A banked score is a fact; no streaming
//   decision can reach back into it. Callers pass floors only for weeks still
//   to come, and `assessLineup` is only ever run on projections.
//
// Pure, and node-testable: the wire comes IN. `season.fetchFloors` does the
// reading. See tests/test-floor.mjs.

import { SLOT_ELIGIBILITY } from './espn.js';

/**
 * Positions that can be streamed off the wire in a way that makes a floor
 * meaningful, and the reason the list is explicit rather than "whatever the
 * wire contains":
 *
 * every one of these is a position a manager really does stream week to week.
 * A wire read also returns men at positions this league may not start at all,
 * and a floor for a position nobody fields would be a number applied to
 * nothing — harmless, but it would show up in a panel note as a claim about a
 * slot that does not exist.
 */
export const FLOOR_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DST', 'K'];

/** Statuses that mean he cannot be streamed this week, whatever ESPN projects. */
const CANNOT_PLAY = new Set(['OUT', 'IR', 'INJURY_RESERVE', 'SUSPENSION', 'NOT_ACTIVE']);

/**
 * How deep into the wire a floor is taken from — Tim, 2026-09-19. Decision 3
 * above: the best free agent at a position is the one every manager in the
 * league is bidding for, so he is not the man you would end up with. The third
 * is.
 *
 * It is a constant rather than a hard-coded 3 in the loop because it is the one
 * number in this module that is a JUDGEMENT rather than a measurement, and
 * because `describeFloors` has to be able to say it out loud.
 */
export const FLOOR_RANK = 3;

/** 1st, 2nd, 3rd, 4th — for the sentence a panel prints. */
function ordinal(n) {
  const i = Math.abs(Math.floor(n));
  if (i % 100 >= 11 && i % 100 <= 13) return `${i}th`;
  return `${i}${['th', 'st', 'nd', 'rd'][i % 10] || 'th'}`;
}

/**
 * The floor at each position: the Nth-best free agent there, from ONE wire read.
 *
 * @param {Array} freeAgents `season.fetchWireWeek()` output — each needs
 *   `position`, `projected`, and ideally `name` / `playerId` / `injuryStatus`.
 * @param {Object} [opts]
 * @param {number} [opts.week] the week the wire was read for, carried through
 *   so a page can say which week the floor was measured in.
 * @param {number} [opts.rank] how deep to go; defaults to `FLOOR_RANK`.
 * @returns {Map<string, {value:number, position:string, name:string, playerId:*,
 *                        pool:number, rank:number, want:number, week:number|null}>}
 *
 * `rank` in the result is the place the floor was ACTUALLY taken from, which is
 * `want` unless the wire is thinner than that — a position with only two men
 * gives its second. That distinction is carried rather than smoothed over
 * because a floor drawn from the last man on the wire is a weaker claim than
 * one drawn from the third of forty, and the cell that shows it says which.
 *
 * A position with nobody available is ABSENT from the map rather than present
 * at zero. Absent means "no floor known", which every reader below treats as
 * "leave the number alone"; a zero would be a floor that lifts nothing and
 * would read, in a panel note, as though the wire had been checked and found
 * to be worth nothing.
 *
 * Only men projected ABOVE zero count. A free agent on his own bye that week
 * projects 0 and is no use as a replacement for your man on HIS bye, and a
 * ruled-out man cannot be streamed at all — ESPN projects those at 0 too
 * (rule 2), so the `> 0` test catches most of it and `CANNOT_PLAY` catches the
 * rest.
 */
export function positionFloors(freeAgents, { week = null, rank = FLOOR_RANK } = {}) {
  const want = Math.max(1, Math.floor(rank) || 1);

  // Gathered per position first and ranked afterwards. The old "keep the best
  // one as you go" could not answer this question at all: the third-best is not
  // a running maximum, and there is no way to know who he is until the whole
  // wire has been read.
  const pools = new Map();
  for (const p of freeAgents || []) {
    if (!p || !FLOOR_POSITIONS.includes(p.position)) continue;
    const v = p.projected;
    if (!Number.isFinite(v) || v <= 0) continue;
    if (CANNOT_PLAY.has(String(p.injuryStatus || '').toUpperCase())) continue;
    if (!pools.has(p.position)) pools.set(p.position, []);
    pools.get(p.position).push(p);
  }

  const out = new Map();
  for (const [position, pool] of pools) {
    // The playerId tiebreak keeps two identical projections in a fixed order,
    // so the named man does not swap between reads of the same wire.
    pool.sort((a, b) =>
      b.projected - a.projected ||
      (Number(a.playerId) || 0) - (Number(b.playerId) || 0));
    const at = Math.min(want, pool.length);
    const p = pool[at - 1];
    out.set(position, {
      value: p.projected,
      position,
      name: p.name || '',
      playerId: p.playerId ?? null,
      pool: pool.length,
      rank: at,
      want,
      week: week === null ? null : Number(week),
    });
  }
  return out;
}

/**
 * Where one floor came from, in words — "the 3rd-best WR on the waiver wire
 * (Voss)". ONE spelling of it, because it is printed on the season sheet's
 * cells, in its panel note and in the trade pop-up, and three hand-written
 * versions is how the pages start making slightly different claims about the
 * same number.
 */
export function floorSource(f, { withName = true } = {}) {
  if (!f) return '';
  const place = f.rank <= 1
    ? `the best ${f.position || ''}`.trim()
    : f.rank < f.want
      ? `the ${ordinal(f.rank)}-best (and last) ${f.position || ''}`.trim()
      : `the ${ordinal(f.rank)}-best ${f.position || ''}`.trim();
  return `${place} on the waiver wire${withName && f.name ? ` (${f.name})` : ''}`;
}

/** The floor for one position, or null when the wire said nothing about it. */
export function floorAt(position, floors) {
  if (!floors || typeof floors.get !== 'function') return null;
  const f = floors.get(position);
  return f && Number.isFinite(f.value) ? f : null;
}

/**
 * The floor for a SLOT, which is not the same question as the floor for a
 * position: a FLEX can be filled from RB, WR or TE, so what it is worth at
 * worst is the best of those three — that is the man you would actually put
 * in it. A slot whose eligible positions are all unknown to the wire has no
 * floor at all.
 */
export function slotFloor(slotId, floors) {
  const eligible = SLOT_ELIGIBILITY[slotId] || [];
  let best = null;
  for (const position of eligible) {
    const f = floorAt(position, floors);
    if (f && (best === null || f.value > best.value)) best = { ...f, position };
  }
  return best;
}

/**
 * One player's assessed value: his projection, or the floor at his position if
 * that is higher.
 *
 * @returns {{value:number|null, raw:number|null, assumed:boolean, floor:Object|null}}
 *
 * `assumed` is the whole point of the return shape. Every page that prints one
 * of these numbers has to be able to say it is not ESPN's — Tim asked for the
 * lifted ones to be coloured, and rule 7 (state the basis of every derived
 * number) would require it even if he had not.
 *
 * `slotId`, when given, is the slot he is STANDING IN, and for a slot that takes
 * more than one position (FLEX, RB/WR, WR/TE, OP) the floor is that SLOT's, not
 * his position's (AUDIT §1.8). A bye-week tight end in the FLEX is not replaced
 * by the wire's tight end — he is replaced by the best of RB/WR/TE, which is
 * exactly what an EMPTY flex is assessed at. Flooring him at the TE floor made a
 * flex with a useless man in it score below the same flex left empty. For a
 * single-position slot the slot's floor and the position's are the same number,
 * so nothing there moves; without `slotId` this is the position floor, as ever.
 */
export function flooredValue(player, floors, slotId = null) {
  const raw = player && Number.isFinite(player.projected) ? player.projected : null;
  const eligible = slotId === null || slotId === undefined ? null : SLOT_ELIGIBILITY[slotId];
  const combo = Boolean(player && eligible && eligible.length > 1 && eligible.includes(player.position));
  const f = !player ? null : combo
    ? (slotFloor(slotId, floors) || floorAt(player.position, floors))
    : floorAt(player.position, floors);
  if (!f) return { value: raw, raw, assumed: false, floor: null };
  if (raw === null) return { value: f.value, raw: null, assumed: true, floor: f };
  return raw >= f.value
    ? { value: raw, raw, assumed: false, floor: f }
    : { value: f.value, raw, assumed: true, floor: f };
}

/**
 * A whole lineup, assessed against the floor.
 *
 * @param {Array} starters `optimalLineup(...).starters`, each carrying `slotId`
 * @param {Array} slots the league's own slot ids, one entry per starting spot
 * @param {Map} floors from `positionFloors`, or null for no floor at all
 * @returns {{total:number, rawTotal:number, assumed:number, cells:Array}}
 *
 * EVERY SLOT IN `slots` PRODUCES A CELL, filled or not. That is what makes the
 * empty-kicker case work: `optimalLineup` simply omits a slot it cannot fill,
 * so a lineup with no kicker at all used to total as though the slot were not
 * there — which is the same mistake as calling it zero, just quieter.
 *
 * With no floors this returns exactly what summing the starters returns, to the
 * same rounding, so a page that has no wire read is unchanged.
 */
export function assessLineup(starters, slots, floors) {
  const bySlot = new Map();
  for (const s of starters || []) {
    if (!bySlot.has(s.slotId)) bySlot.set(s.slotId, []);
    bySlot.get(s.slotId).push(s);
  }
  // A league can start two RBs, so the same slot id appears twice and the two
  // men in it have to be handed out one apiece rather than both reading the
  // first. Taken in the order optimalLineup filled them, best first.
  const queues = new Map([...bySlot].map(([k, v]) => [k, v.slice()]));

  const cells = [];
  let total = 0;
  let rawTotal = 0;
  let assumed = 0;

  for (const slotId of slots || []) {
    const q = queues.get(slotId);
    const player = q && q.length ? q.shift() : null;

    if (player) {
      // Floored at the SLOT's floor, the same one an empty slot gets below, so
      // a filled FLEX can never be worth less than an empty one (AUDIT §1.8).
      const a = flooredValue(player, floors, slotId);
      const value = a.value === null ? 0 : a.value;
      cells.push({ slotId, player, raw: a.raw, value, assumed: a.assumed, floor: a.floor });
      total += value;
      rawTotal += a.raw === null ? 0 : a.raw;
      if (a.assumed) assumed += 1;
      continue;
    }

    // NOBODY TO FILL IT. Not a bye and not a bad week — this squad has no
    // eligible man at all, which is the case Tim's kicker example is really
    // about once his backup is gone too. Worth the floor, because that is the
    // waiver claim he would make before Sunday.
    const f = slotFloor(slotId, floors);
    cells.push({
      slotId,
      player: null,
      raw: null,
      value: f ? f.value : 0,
      assumed: Boolean(f),
      floor: f,
    });
    if (f) { total += f.value; assumed += 1; }
  }

  return {
    total: Math.round(total * 10) / 10,
    rawTotal: Math.round(rawTotal * 10) / 10,
    assumed,
    cells,
  };
}

/**
 * The sentence a panel prints so a reader can check the numbers by hand.
 *
 * Rule 7, and it matters more here than usual: these floors move totals that
 * Tim checks against ESPN's own site, so anything he cannot reproduce reads as
 * a bug in the arithmetic rather than as a deliberate assumption.
 */
export function describeFloors(floors, { week = null } = {}) {
  if (!floors || floors.size === 0) return '';
  const parts = FLOOR_POSITIONS
    .filter((p) => floorAt(p, floors))
    .map((p) => `${p} ${floors.get(p).value.toFixed(1)}`);
  if (!parts.length) return '';
  const w = week === null ? null : Number(week);
  // The rank the floors were actually asked for, taken off the floors
  // themselves rather than from the constant — a stub or an archived reading
  // may carry floors built at a different depth, and the sentence has to
  // describe the numbers beside it rather than what this build would do.
  const want = [...floors.values()].map((f) => f.want).find((n) => Number.isFinite(n)) || FLOOR_RANK;
  const depth = want > 1
    ? `Each is the ${ordinal(want)}-best free agent at that position on the wire` +
      `${w ? ` in week ${w}` : ''} — not the best, because the top of the wire is the man every ` +
      `manager in the league is bidding for, and the ${ordinal(want)} is the one you could ` +
      `actually expect to get — read once and used for every week.`
    : `Each is the best free agent at that position on the wire${w ? ` in week ${w}` : ''}, ` +
      `read once and used for every week.`;
  return `No slot is assessed below what the waiver wire would give you at that ` +
    `position: ${parts.join(', ')}. ${depth} A slot worth ` +
    `less than its floor is shown at the floor instead, because that is the man you ` +
    `would stream. Averages and totals use the assessed number.`;
}
