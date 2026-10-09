// A player's VALUE: what he is worth in points a week over what is free.
//
// Tim, 2026-10-09: "I want to start calculating the "Value" of a player. I
// think this should heavily be based on the line of where top waiver players of
// that position are, aswell as where the line of where actual league mates are
// starting that position or not. Players low inside the waiver will have no
// value and there will be no players with negative value. This number will have
// no base on how well they connect with your team or anything like that, just
// how much their worth numberically."
//
// Pure functions only — no DOM, no fetching, no storage (tests/test-value.mjs).
// js/season.js reads what these need and keeps the baselines; pages draw.
//
// THE NUMBER (his four picks, 2026-10-09)
//
//   his average    ESPN's projection averaged over the weeks he has left,
//                  HIS BYE LEFT OUT (so a bye going by does not move him). A
//                  week he is projected 0 for any other reason — hurt,
//                  suspended — counts as the 0 it is.
//   waiver line    at his position, the average of the top 3 free agents by
//                  that same average.
//   starter line   at his position, the worst man the league starts: every
//                  starting slot of every team filled with the best men
//                  rostered (`optimalLineup`, the league's own slots, once per
//                  team), and the lowest of those at the position. Never below
//                  the waiver line.
//   value          points over the waiver line; the ones BELOW the starter
//                  line count half, the ones above it in full. Never below 0.
//                  Points a week, so a receiver and a tight end compare.
//
// THE LINES ARE FROZEN. Tim, 2026-10-09: "I only want a player's value to
// change if their actual future projections have changed for some reason, not
// because we're moving the baselines or whatnot. This means you'll have to pick
// specific baselines and stick to them throughout the season." So `buildBase`
// is run ONCE for a league's season and what it returns is kept (js/season.js);
// nothing here reads a free agent or a lineup again after that.
//
// "a player worth twice as much as another player is worth two of that other
// player" (Tim, same day) is what measuring from a line buys: the slot the one
// man leaves empty is filled from the waiver line.

import { optimalLineup } from './forecast.js';

export const VALUE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
/** How many free agents make the waiver line. */
export const WAIVER_TOP = 3;
/** What a point between the two lines counts for. */
export const BENCH_WEIGHT = 0.5;
export const BASE_VERSION = 1;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * A man's average over the weeks he has left, his bye left out.
 *
 * @param {Object<number, number|null>|Map<number, number|null>} byWeek week ->
 *   ESPN's projection for him that week (null or absent: ESPN said nothing,
 *   and the week is not counted)
 * @param {number[]} weeks the weeks still to be played
 * @param {number|null} [byeWeek] his team's bye, when known
 * @returns {number|null} null when no week counts
 */
export function restAvg(byWeek, weeks, byeWeek = null) {
  const get = (w) => (byWeek instanceof Map ? byWeek.get(w) : byWeek ? byWeek[w] : null);
  let sum = 0;
  let n = 0;
  for (const w of weeks || []) {
    if (byeWeek !== null && byeWeek !== undefined && Number(byeWeek) === Number(w)) continue;
    const v = num(get(w));
    if (v === null) continue;
    sum += v;
    n += 1;
  }
  return n ? sum / n : null;
}

/**
 * The two lines at every position, from the league as it stands — run once a
 * season and kept (see the top).
 *
 * @param {Object} o
 * @param {Array<{position:string, avg:number|null}>} o.rostered every man on a squad, with `restAvg`
 * @param {Array<{position:string, avg:number|null}>} o.freeAgents every free agent read, the same
 * @param {number[]} o.slots ONE team's starting lineup, as lineupSlotIds
 * @param {number} o.teams how many teams fill it
 * @param {number|null} [o.week] the week it was set in
 * @param {number} [o.now] when (ms)
 * @returns {{ v:number, setAt:number, week:number|null, lines:Object<string,
 *   {waiver:number, starter:number, agents:number, starters:number}> }}
 *   a position with no free agent to measure from has no line (and its men no value)
 */
export function buildBase({ rostered, freeAgents, slots, teams, week = null, now = Date.now() }) {
  const known = (list) => (list || []).filter((p) => p && VALUE_POSITIONS.includes(p.position) && num(p.avg) !== null);
  const own = known(rostered);
  const free = known(freeAgents);

  const league = [];
  for (let i = 0; i < (teams || 0); i++) league.push(...(slots || []));
  const lowest = new Map();
  const started = new Map();
  for (const s of optimalLineup(own.map((p) => ({ position: p.position, projected: p.avg })), league).starters) {
    started.set(s.position, (started.get(s.position) || 0) + 1);
    if (!lowest.has(s.position) || s.projected < lowest.get(s.position)) lowest.set(s.position, s.projected);
  }

  const lines = {};
  for (const pos of VALUE_POSITIONS) {
    const top = free.filter((p) => p.position === pos).map((p) => p.avg).sort((a, b) => b - a).slice(0, WAIVER_TOP);
    if (!top.length) continue;
    const waiver = top.reduce((a, b) => a + b, 0) / top.length;
    const starter = Math.max(waiver, lowest.has(pos) ? lowest.get(pos) : waiver);
    lines[pos] = {
      waiver: Math.round(waiver * 100) / 100,
      starter: Math.round(starter * 100) / 100,
      agents: top.length,
      starters: started.get(pos) || 0,
    };
  }
  return { v: BASE_VERSION, setAt: now, week, lines };
}

/** Is this a baseline this code can read? */
export function isBase(base) {
  return Boolean(base && base.v === BASE_VERSION && base.lines && typeof base.lines === 'object' &&
    Object.values(base.lines).every((l) => l && num(l.waiver) !== null && num(l.starter) !== null));
}

/** The line at a position, or null. */
export function lineOf(base, position) {
  return isBase(base) && base.lines[position] ? base.lines[position] : null;
}

/**
 * A man's value: see the top.
 *
 * @param {object|null} base what `buildBase` returned
 * @param {string} position
 * @param {number|null} avg his `restAvg`
 * @returns {number|null} to the tenth; null when it cannot be said (no
 *   baseline, no line at his position, no average)
 */
export function valueOf(base, position, avg) {
  const line = lineOf(base, position);
  const a = num(avg);
  if (!line || a === null) return null;
  if (a <= line.waiver) return 0;
  const bench = Math.min(a, line.starter) - line.waiver;
  const over = Math.max(0, a - line.starter);
  return Math.round((bench * BENCH_WEIGHT + over) * 10) / 10;
}

/**
 * What the value is made of, for a preview: the average, the two lines, the
 * points between them (at half) and over the starter line (in full).
 * @returns {{avg:number, waiver:number, starter:number, bench:number, over:number, value:number}|null}
 */
export function valueParts(base, position, avg) {
  const line = lineOf(base, position);
  const a = num(avg);
  if (!line || a === null) return null;
  const bench = Math.max(0, Math.min(a, line.starter) - line.waiver);
  const over = Math.max(0, a - line.starter);
  return { avg: a, waiver: line.waiver, starter: line.starter, bench, over, value: valueOf(base, position, a) };
}

/** A value as the site prints it: "5.5", and "—" when it cannot be said. */
export function valueText(v) {
  return num(v) === null ? '—' : v.toFixed(1);
}
