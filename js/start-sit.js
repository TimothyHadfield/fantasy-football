// "START A OVER B": the swaps that would turn the lineup a manager has SET into
// the best legal one this week, and what each is worth.
//
// Tim asked chat for lineup advice twice before the site could give it; ESPN's
// app shows the two projections side by side but never the swap, the points or
// what it does to the week. Home prints it on his own matchup card. Kept here,
// apart from any page, so Analysis can say the same thing from the same code.
//
// THE RULE
//   - The best lineup is `forecast.optimalLineup` over the men who can still be
//     moved, in the slots still open — the solver every other page uses.
//   - A man whose NFL game has started or finished is LOCKED: a locked starter
//     keeps his slot (it is taken out of the slots to fill) and a locked bench
//     man is not offered. IR is not a lineup choice.
//   - A swap is one man in for one man out, paired same position first, then a
//     man who fits the other's slot, then whoever is left. The pairing is only
//     how the change is SAID: the total gained is the same however it is paired.
//   - Points = his projection minus the other man's.
//   - Win = what the swap adds to this week's win chance: `forecast.winProbability`
//     at the caller's sigma against the caller's opponent total, lineup as set
//     plus the swaps above it in the list. Each swap is counted on top of the
//     bigger ones, so the figures add up to the whole change. Null when the
//     caller has no chance to quote (no sigma or no opponent total).
//
// Pure: no DOM, no clock (the caller says who is locked), no request.

import { SLOT_ELIGIBILITY } from './espn.js';
import { optimalLineup, winProbability } from './forecast.js';

const IR_SLOT = 21;

/** A swap worth less than this prints as +0.0 and is not one. */
const MIN_GAIN = 0.05;

const round1 = (n) => Math.round(n * 10) / 10;
const num = (n) => (Number.isFinite(n) ? n : 0);

/**
 * Has this man kicked off, as far as the roster reading itself can tell?
 * `done` is js/season.js's mark on a finished player; a score beside a man
 * (even 0) means ESPN has opened his stat line, which it does at kickoff.
 */
export const hasPlayed = (p) => !!p && (p.done === true || typeof p.actual === 'number');

/**
 * @param {Object} o
 * @param {Array} o.players     one squad's players for the week (js/season.js shape:
 *                              `started`, `lineupSlotId`, `position`, `projected`)
 * @param {number[]|null} [o.slots]  the league's starting slots; null = the slots
 *                              this squad's own starters sit in
 * @param {(p) => boolean} [o.isLocked]  true for a man who cannot be moved
 * @param {number|null} [o.oppPoints]    the opponent's projected total
 * @param {number|null} [o.sigma]        the scoring spread the win chance is read against
 * @returns {null | {best:boolean, setTotal:number, gain:number,
 *   swaps:Array<{in:Object, out:Object|null, points:number, win:number|null}>}}
 *   null when there is no lineup to judge, or none of it can still be moved. `swaps` is biggest first and holds
 *   every swap; the caller prints as many as it wants. `out` is null for a man
 *   who fills a slot left empty.
 */
export function startSit({ players, slots = null, isLocked = hasPlayed, oppPoints = null, sigma = null } = {}) {
  const all = (players || []).filter((p) => p && p.lineupSlotId !== IR_SLOT && p.slot !== 'IR');
  const starters = all.filter((p) => p.started);
  if (!starters.length) return null;

  const open = Array.isArray(slots) && slots.length
    ? slots.slice()
    : starters.map((p) => p.lineupSlotId);
  for (const p of starters) {
    if (!isLocked(p)) continue;
    const i = open.indexOf(p.lineupSlotId);
    if (i >= 0) open.splice(i, 1);
  }

  // Starters ahead of the bench, so the solver's stable sort keeps the man
  // already starting when two project the same.
  const free = starters.filter((p) => !isLocked(p));
  if (!free.length && !open.length) return null;   // every starter has kicked off
  const bench = all.filter((p) => !p.started && !isLocked(p) && Number.isFinite(p.projected));
  const pool = [...free, ...bench].map((p, i) => ({
    position: p.position, projected: num(p.projected), i, p,
  }));

  const setTotal = starters.reduce((a, p) => a + num(p.projected), 0);
  const none = { best: true, setTotal: round1(setTotal), gain: 0, swaps: [] };

  const chosen = new Set(optimalLineup(pool, open).starters.map((s) => s.i));
  const ins = pool.filter((e) => chosen.has(e.i) && !e.p.started);
  const outs = pool.filter((e) => !chosen.has(e.i) && e.p.started);
  // The whole change, whatever the pairing below makes of it.
  const gain = ins.reduce((a, e) => a + e.projected, 0) - outs.reduce((a, e) => a + e.projected, 0);
  if (!ins.length || gain < MIN_GAIN) return none;

  // Pair each man coming in with one going out.
  ins.sort((a, b) => b.projected - a.projected);
  outs.sort((a, b) => a.projected - b.projected);
  const fits = (e, o) => (SLOT_ELIGIBILITY[o.p.lineupSlotId] || []).includes(e.position);
  const pairs = [];
  const take = (rule) => {
    for (const e of ins) {
      if (e.out !== undefined) continue;
      const j = outs.findIndex((o) => !o.used && rule(e, o));
      if (j < 0) continue;
      outs[j].used = true;
      e.out = outs[j];
    }
  };
  take((e, o) => o.position === e.position);
  take(fits);
  take(() => true);
  for (const e of ins) {
    const out = e.out || null;
    const points = e.projected - (out ? out.projected : 0);
    if (points >= MIN_GAIN) pairs.push({ in: e.p, out: out ? out.p : null, raw: points });
  }
  if (!pairs.length) return none;
  pairs.sort((a, b) => b.raw - a.raw);

  const chance = (total) =>
    (Number.isFinite(oppPoints) && Number.isFinite(sigma) ? winProbability(total, oppPoints, sigma) : null);
  let running = setTotal;
  const swaps = pairs.map(({ raw, ...s }) => {
    const before = chance(running);
    running += raw;
    const after = chance(running);
    return {
      ...s,
      points: round1(raw),
      win: before === null || after === null ? null : after - before,
    };
  });

  return { best: false, setTotal: round1(setTotal), gain: round1(gain), swaps };
}
