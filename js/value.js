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
//                  A 0 AND A BYE COUNTED AS HIS POSITION'S WAIVER LINE (Tim,
//                  2026-10-22: "I do want to count the 0 everywhere, but not as
//                  a pure 0. Make the number the base of that position. For
//                  example if a 0 value equals 13 pts proj for a WR, then
//                  replace the 0 with 13 when counting for future proj. this is
//                  also the case for BYE weeks."). The base is the waiver line:
//                  the average where Value is 0 — what you could plug in from
//                  the wire while he is out. A week ESPN said nothing about is
//                  still skipped; a low real projection is still his. Until the
//                  lines are known it is the old rule (bye out, 0 counted).
//                  The card's Proj is this same average (`restProjAvg`).
//                  (Before 2026-10-22 his bye was left out and a 0 counted as
//                  0 — Tim, 2026-10-09.)
//   waiver line    at his position, the average of the top 3 free agents by
//                  the RAW average (`rawAvg`: bye out, a 0 counted as 0) — the
//                  lines are never made from the filled average, which would
//                  make them depend on themselves.
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

const isBye = (byeWeek, w) => byeWeek !== null && byeWeek !== undefined && Number(byeWeek) === Number(w);
const reader = (byWeek) => (w) => (byWeek instanceof Map ? byWeek.get(w) : byWeek ? byWeek[w] : null);

/**
 * THE RAW AVERAGE: the weeks he has left, his bye left out, a 0 counted as 0
 * (the rule before 2026-10-22). Only the LINES are made from this
 * (js/season.js `withRestAvg` -> `buildBase`), so they never depend on
 * themselves, and it is what `restAvg` falls back to while no line is known.
 *
 * @param {Object<number, number|null>|Map<number, number|null>} byWeek week ->
 *   ESPN's projection for him that week (null or absent: ESPN said nothing,
 *   and the week is not counted)
 * @param {number[]} weeks the weeks still to be played
 * @param {number|null} [byeWeek] his team's bye, when known
 * @returns {number|null} null when no week counts
 */
export function rawAvg(byWeek, weeks, byeWeek = null) {
  const get = reader(byWeek);
  let sum = 0;
  let n = 0;
  for (const w of weeks || []) {
    if (isBye(byeWeek, w)) continue;
    const v = num(get(w));
    if (v === null) continue;
    sum += v;
    n += 1;
  }
  return n ? sum / n : null;
}

/**
 * THE BASE A 0 OR A BYE COUNTS AS (Tim, 2026-10-22): his position's waiver
 * line, in points a week — the average where his Value is 0. null with no
 * lines or no line at his position (then nothing is filled).
 */
export function fillOf(base, position) {
  const line = lineOf(base, position);
  return line ? line.waiver : null;
}

/**
 * Tim's 2026-10-22 rule over a list of weeks: a week projected 0 (or less) and
 * his bye week count as `fill`; a week with no number is skipped; a positive
 * projection is his. `fill` must be a number.
 */
function filledAvg(byWeek, weeks, byeWeek, fill) {
  const get = reader(byWeek);
  let sum = 0;
  let n = 0;
  let read = 0;
  for (const w of weeks || []) {
    const v = num(get(w));
    if (v !== null) read += 1;
    if (isBye(byeWeek, w)) { sum += fill; n += 1; continue; }
    if (v === null) continue;
    sum += v > 0 ? v : fill;
    n += 1;
  }
  // A man nothing at all was read for has no average, not the base.
  return n && read ? sum / n : null;
}

/**
 * A MAN'S AVERAGE over the weeks he has left — what his Value is made from.
 *
 * With `fill` (his position's waiver line, `fillOf`): a 0 and his bye count as
 * that (Tim, 2026-10-22, see the top). Without it (no lines yet): `rawAvg`,
 * the old rule.
 *
 * @param {number|null} [fill] the base a 0 / bye counts as
 * @returns {number|null} null when no week counts
 */
export function restAvg(byWeek, weeks, byeWeek = null, fill = null) {
  return num(fill) !== null ? filledAvg(byWeek, weeks, byeWeek, fill) : rawAvg(byWeek, weeks, byeWeek);
}

/**
 * THE PREVIEW'S "Proj" (Tim, 2026-10-11: "make the proj stat in a players
 * preview reflect their rest-of-season proj avg … instead of just the proj for
 * that week"). Since 2026-10-22 it is THE SAME average as `restAvg` whenever
 * the base is known — a 0 and the bye counted as his position's waiver line —
 * so the card's Proj and the average behind his Value are one number. Without
 * a base it is the old rule: the bye and every week projected at nothing left
 * out.
 *
 * @param {number|null} [fill] the base a 0 / bye counts as
 * @returns {number|null} null when no week counts
 */
export function restProjAvg(byWeek, weeks, byeWeek = null, fill = null) {
  if (num(fill) !== null) return filledAvg(byWeek, weeks, byeWeek, fill);
  const get = reader(byWeek);
  let sum = 0;
  let n = 0;
  for (const w of weeks || []) {
    if (isBye(byeWeek, w)) continue;
    const v = num(get(w));
    if (v === null || v <= 0) continue;
    sum += v;
    n += 1;
  }
  return n ? sum / n : null;
}

/**
 * One week as a FUTURE average counts it (Tim, 2026-10-22), for a page that
 * holds a row of numbers rather than a week map: his bye or a 0 (or less) ->
 * `fill`; no number -> null (not counted); else the number. With no `fill`
 * it returns null for a bye and the number otherwise — callers keep their own
 * old rule then.
 */
export function filledWeek(v, bye, fill) {
  const x = num(v);
  if (num(fill) === null) return bye ? null : x;
  if (bye) return fill;
  if (x === null) return null;
  return x > 0 ? x : fill;
}

/**
 * The two lines at every position, from the league as it stands — run once a
 * season and kept (see the top).
 *
 * @param {Object} o
 * @param {Array<{position:string, avg:number|null}>} o.rostered every man on a squad, with `rawAvg`
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
 * @param {number|null} avg his `restAvg` (with the base filled in)
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
 * A MAN'S VALUE — THE ONE FIGURE EVERY PAGE PRINTS FOR HIM. `valueOf` his
 * `restAvg` over the weeks left, a 0 and his bye counted as his position's
 * waiver line (2026-10-22). Not the mean
 * of his weekly Values (the half-weight band and the floor at 0 bend that), and
 * not over a page's own span. js/season.js (every rostered man, the card) and
 * the Players page (a free agent) both come here, so the card, the Players
 * table and the Trade lists cannot print two Values for one man (Tim,
 * 2026-10-19: "I'm seeing players in the player section display a different
 * value than the same players in the trade section").
 *
 * @returns {number|null} as `valueOf`
 */
export function playerValue(base, position, byWeek, weeks, byeWeek = null) {
  return valueOf(base, position, restAvg(byWeek, weeks, byeWeek, fillOf(base, position)));
}

/**
 * A RUN OF WEEKS AS ONE VALUE (2026-10-22): an "Avg" on a Value switch is
 * `valueOf` of the run's average, never the mean of weekly Values (the half
 * band and the floor at 0 bend that). `weeks` is one entry a week:
 * `{ position, v, bye }` (v = the projection in points; bye = his bye week) or
 * null for a week not counted. A week to come at 0 or his bye counts as that
 * man's base (`filledWeek`); `past: true` marks a week whose number is kept
 * as it is. The Value is measured at the position that fills most of the
 * weeks (a FLEX). null when nothing counts or there is no line.
 */
export function runValue(base, weeks) {
  let sum = 0;
  let n = 0;
  const seen = new Map();
  for (const e of weeks || []) {
    if (!e || !e.position) continue;
    const x = e.past ? num(e.v) : filledWeek(e.v, Boolean(e.bye), fillOf(base, e.position));
    if (x === null) continue;
    sum += x;
    n += 1;
    seen.set(e.position, (seen.get(e.position) || 0) + 1);
  }
  if (!n) return null;
  const pos = [...seen].sort((a, b) => b[1] - a[1])[0][0];
  return valueOf(base, pos, sum / n);
}

/**
 * A VALUE LOOKUP THAT ALSO ANSWERS FOR FREE AGENTS (2026-10-22): the rostered
 * men's `lookup` (js/season.js `fetchPlayerValues`), and for a man it has no
 * number for, `playerValue` off the weeks a page holds for him — the Players
 * page's free-agent rule, so a free agent's card says the same Value on every
 * page. `wireOf(playerId)` -> `{ position, byWeek, bye }` or null (not held).
 * The returned function carries `.proj` and `.fill` like the lookup does.
 */
export function withFreeAgents(got, wireOf) {
  const own = got && typeof got.lookup === 'function' ? got.lookup : () => null;
  const base = got ? got.base : null;
  const weeks = got && Array.isArray(got.weeks) ? got.weeks : [];
  const man = (id) => {
    try { return typeof wireOf === 'function' ? wireOf(id) : null; } catch { return null; }
  };
  const first = (a, b) => (num(a) !== null ? a : b());
  const fn = (id) => first(own(id), () => {
    const m = man(id);
    return m && weeks.length ? playerValue(base, m.position, m.byWeek, weeks, m.bye ?? null) : null;
  });
  fn.proj = (id) => first(typeof own.proj === 'function' ? own.proj(id) : null, () => {
    const m = man(id);
    return m && weeks.length ? restProjAvg(m.byWeek, weeks, m.bye ?? null, fillOf(base, m.position)) : null;
  });
  fn.fill = (id) => first(typeof own.fill === 'function' ? own.fill(id) : null, () => {
    const m = man(id);
    return m ? fillOf(base, m.position) : null;
  });
  return fn;
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
