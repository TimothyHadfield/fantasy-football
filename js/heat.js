// THE SHARED RED/GREEN SCALE — one number against the rest of its own kind.
//
// Tim, 2026-09-19: "I want to start being able to display data in a better way
// by colorizing everything red/green based on a comparison with other
// positions. For example in this All teams, proj avg 2026 chart, positions with
// higher proj than the others will be green and lower will be red. This should
// be very similar to the 'season week by week' where we do Standard Deviations
// above/below the mean or whatever, however, I want the range to be a lot
// tighter so it's easier to be in green/red, not just the extremes. We can also
// have it on a spectrum or something so that the more red or more green shows
// better information. This system will be used in virtually all charts across
// the site unless it conflicts with something else we already have built. Also,
// it will replace the current system we have with the colorization of the
// season week by week box."
//
// So this module is the one answer to "is this number good, for a number of
// this kind". It is deliberately small, deliberately pure, and deliberately
// the only place the thresholds are written down.
//
// ===========================================================================
// 1. WHAT A NUMBER IS COMPARED AGAINST — the decision everything else rests on
// ===========================================================================
//
// THE SAME SLOT, ACROSS THE LEAGUE. Never one position against another. A
// quarterback's 22 beside a kicker's 8 is not a comparison at all — it is two
// different units printed in the same font — and colouring a row of them would
// paint every kicker on the site red for being a kicker. What IS a comparison
// is a squad's WR2 against every squad's WR2, or one team's week-9 score
// against every team's week-9 score.
//
// That rule is enforced by the SHAPE of the API rather than by a comment: a
// scale is built from an explicit array of values, one column or one slot at a
// time, and there is no function here that takes a whole table. A caller that
// wanted to mix positions would have to go out of its way to build the mixed
// array first.
//
// The distribution is ALSO the reason this module refuses to hold a table of
// "a good QB is 17+". The league's scoring rules, its roster shape and the
// season itself all move what a good number is; a measured distribution
// follows them and a constant does not. That was already the decision behind
// the season sheet's low marks (the previous system, which this replaces) and
// it is kept.
//
// ===========================================================================
// 2. THE NUMBERS, AND WHY THESE NUMBERS
// ===========================================================================
//
// The old scale had two steps, both on the low side: amber below one standard
// deviation, red below two. Under a normal distribution that is 15.9% of cells
// amber-or-red and 2.3% red, and NOTHING at all is ever marked for being good.
// Tim's complaint is exactly that — "it's easier to be in green/red, not just
// the extremes" — so:
//
//   FULL SATURATION AT ±1 SD, WITH FOUR STEPS TO GET THERE:
//
//     |z| < 0.25   no colour     about 20% of cells    "this is normal"
//     0.25 – 0.50  step 1        about 19%
//     0.50 – 0.75  step 2        about 17%
//     0.75 – 1.00  step 3        about 13%
//     |z| ≥ 1.00   step 4        about 32% (16% a side) "the end of the scale"
//
// (Percentages are the normal distribution's, quoted so the choice can be
// argued with rather than taken on trust. Real slot distributions are skewed
// and the counts come out somewhat different — the season sheet's own key
// prints the thresholds in points so a reader can check a cell by hand.)
//
// FOUR STEPS, NOT MORE. Eight would be a smoother spectrum and a worse table:
// the steps have to be far enough apart that a reader can tell two ADJACENT
// cells apart without a legend, and on a dark surface four background tints is
// about where that stops being true. Four is also what lets the second channel
// below (font weight) move with them, since weight has roughly four usable
// stops in a table this dense.
//
// ±1 SD FOR THE END OF THE SCALE, NOT ±2. Two standard deviations is the right
// line for "this is alarming" and the wrong one for "this is better than the
// rest", which is what Tim is asking to see. At ±1 SD the end of the scale is
// about a sixth of cells each way — roughly the best and worst two squads in a
// ten-team column, which is the claim a reader of that column actually wants.
//
// ±0.25 SD FOR THE DEAD ZONE. Something has to be uncoloured or the scale says
// nothing; a fifth of cells reading as "normal" is enough to make the coloured
// ones mean something, and small enough that Tim's "easier to be in green/red"
// is honoured. It is not zero: a scale with no neutral band paints a cell a
// hundredth of a point above the mean, which is a claim the data cannot make.
//
// ===========================================================================
// 3. NEVER COLOUR ALONE — the hard rule on this site
// ===========================================================================
//
// HANDOFF is explicit about it, and a spectrum makes it harder than a two-step
// mark did: a word on every cell of a ten-by-fourteen grid is not an
// accessibility feature, it is noise, and it would destroy the one thing the
// colour is for. So the rule is honoured on FOUR channels at once, and three of
// them survive a reader who cannot separate red from green:
//
//   1. WEIGHT MOVES WITH INTENSITY. Every step raises the font weight, on both
//      sides. That is a hue-free reading of MAGNITUDE — "this cell is far from
//      normal" — available at a glance across a whole table, and it is why the
//      steps are few enough to be told apart.
//   2. A MARK AT THE END OF THE SCALE, and only there. Step 4 carries ▲ or ▼.
//      That is a hue-free reading of DIRECTION on the cells where direction
//      matters most, at about one cell in six a side rather than on all of
//      them. Steps 1–3 deliberately carry no glyph: marking 45% of a table is
//      the noise this rule is trying to avoid.
//   3. WORDS ON THE CELL. `heatOf().words` is one short clause for the cell's
//      preview — "2nd highest of 10 · avg 12.4 for a WR2 across the league" —
//      in PLAIN STANDING (rank and the group's average), never in standard
//      deviations: Tim, 2026-10-08, called the old wording "SD and info we
//      don't want or need". js/touch-titles.js makes a title a tap on a phone,
//      so it is not hover-only. Rule 7 (state the basis of every derived number) would
//      require this even if the colour rule did not.
//   4. WORDS IN THE KEY. `describeHeat()` writes the scale out under the table
//      in points, not in adjectives, so any cell can be checked by hand.
//
// THE SCALE OWNS THE BACKGROUND AND NOTHING ELSE. That is the other half of
// living beside what is already built. This site already spends the FOREGROUND
// of a cell on meanings that must not be overwritten — orange `--assumed`
// ("this number is not ESPN's"), the injury reds, "Bye" and "OUT" — so the new
// classes tint the background and step the weight, and leave text colour
// alone. A cell can therefore be green AND orange-assumed at once and both
// claims survive, which is what happens on the all-teams grid several times a
// season.
//
// ===========================================================================
// 4. WHAT THIS MODULE REFUSES TO DO
// ===========================================================================
//
// - IT NEVER COLOURS WITHOUT A DISTRIBUTION. `stdev` (js/stats.js) returns null
//   below two values, and `heatScale` returns null when it does — and also when
//   the column is FLAT, meaning the whole league sits inside the tenth the
//   numbers are printed at. See HEAT_MIN_SPREAD: that second refusal is not a
//   precaution, it is a defect this caught on its first real table. Callers
//   draw nothing. That is HANDOFF rule 5, and it is the same refusal the season
//   sheet already made on a slot with one value in the league.
// - IT NEVER GUESSES WHICH DIRECTION IS GOOD. `invert` is passed in at every
//   call site, because the answer is a fact about the COLUMN and not about the
//   arithmetic: a high projection is good, a high projected opponent is a hard
//   schedule. A column where neither direction is good — a raw count, a rank
//   that is already ordered — should not be given a scale at all rather than
//   given a misleading one.
// - IT NEVER READS PAGE STATE AND TOUCHES NO DOM. The values come in; class
//   names and strings go out. That is what makes it node-testable, and what
//   stops two pages drifting into two slightly different scales.
// - IT NEVER WRITES AN INLINE STYLE. The classes are in css/app.css so the
//   scale is themeable in one place and assertable in a test. The thing this
//   replaces on the Stats page was an inline `rgba()` ramp computed per render,
//   which could be neither.
//
// See tests/test-heat.mjs.

import { stdev } from './stats.js';

/**
 * The step boundaries, in standard deviations from the mean.
 *
 * Section 2 above is the defence of these four numbers. They are exported
 * because the key under a table prints the outermost one in points and a test
 * asserts against them; nothing should hard-code 0.25 or 1 anywhere else.
 */
export const HEAT_EDGES = [0.25, 0.5, 0.75, 1];

/** How many steps there are each side of neutral. Derived, never typed twice. */
export const HEAT_STEPS = HEAT_EDGES.length;

/**
 * The step from which a cell carries a glyph as well as a tint.
 *
 * The end of the scale only — see channel 2 above. It is a constant rather than
 * a literal because it is a JUDGEMENT about how much marking a table can carry,
 * and because `describeHeat` has to be able to say which cells are marked.
 */
export const HEAT_MARK_STEP = HEAT_STEPS;

/** The two glyphs. ▲/▼ rather than +/− because the season sheet's readers already know ▼. */
export const HEAT_UP = '▲';
export const HEAT_DOWN = '▼';

/**
 * THE FLAT-COLUMN GUARD, and it is a bug fix rather than a refinement.
 *
 * A z-score has no units and no sense of scale, which is exactly what makes it
 * the right measure — and exactly what makes it dangerous on a column where
 * every squad is the same. The all-teams grid found it the day this was
 * written: ten squads whose slot average was 22.1 to the tenth differed in the
 * FIFTEENTH decimal, because each is a sum of floats divided by a count. The
 * standard deviation of that is about 1e-15, every squad lands most of a
 * standard deviation from the mean, and the whole column came out in full
 * colour — a confident verdict painted on rounding noise. That is the failure
 * rule 5 in HANDOFF.md exists to prevent, arriving by a door nobody had
 * watched.
 *
 * SO: BELOW THIS SPREAD THERE IS NO SCALE AT ALL. 0.05 is not arbitrary. Every
 * number on this site is printed to a tenth, so a distribution narrower than
 * half of one is a distribution the reader CANNOT SEE — the cells all say
 * 22.1 — and colouring it would be telling him that identical numbers differ.
 * "The whole league is inside one printed digit" is a claim he can check by
 * looking at the column, which is the standard every other refusal here is
 * held to.
 *
 * It is an option rather than a constant in the loop because a caller measuring
 * something that is not points to a tenth (a percentage, a probability) has a
 * different precision and must be able to say so; passing 0 turns the guard off
 * and leaves only arithmetic, which is what the module's own tests use to
 * exercise the boundaries.
 */
export const HEAT_MIN_SPREAD = 0.05;

const round1 = (v) => Math.round(v * 10) / 10;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Build a scale from one comparison group.
 *
 * @param {Array<number|null|undefined>} values every value of the SAME KIND —
 *   one slot across the league, one column across the teams, one metric across
 *   every team-week. Non-numbers are dropped rather than treated as zero: a
 *   week nobody has read is not a week somebody scored nothing, and counting it
 *   would drag every mean down as a page loaded.
 * @param {Object} [opts]
 * @param {boolean} [opts.invert=false] true when a LOW value is the good one
 *   (a projected opponent, a bench points-left-on figure). Never guessed.
 * @param {number[]} [opts.edges=HEAT_EDGES] for a caller that needs a different
 *   shape; nothing on the site passes it today, and a test uses it to prove the
 *   boundaries are read from here rather than hard-coded in the loop.
 * @param {number} [opts.minSpread=HEAT_MIN_SPREAD] below this standard
 *   deviation the column counts as flat and gets no scale — see the long note
 *   on HEAT_MIN_SPREAD, which is a real defect this caught rather than a
 *   precaution.
 * @param {(n:number)=>string} [opts.fmt] how to PRINT a number of this kind in
 *   the cell's words (the group's average). Default: one decimal, or two when
 *   the whole group sits inside ±1 (a share or a chance). A column of
 *   percentages passes e.g. `(v) => Math.round(v * 100) + '%'`.
 * @returns {{n:number, mean:number, sd:number, invert:boolean, edges:number[],
 *            sorted:number[], fmt:Function|null}|null}
 *   null when there is not enough to be sure — see section 4. `sorted` is every
 *   value of the group, highest first, kept so `heatOf` can say where one value
 *   RANKS without the caller handing the group in a second time.
 */
export function heatScale(
  values,
  { invert = false, edges = HEAT_EDGES, minSpread = HEAT_MIN_SPREAD, fmt = null } = {}
) {
  const xs = (values || []).filter(finite);
  const sd = stdev(xs);
  // `stdev` is null under two values. Too little spread is the second kind of
  // "cannot say" and the one that bites in practice: a table where every cell
  // prints the same number has no good and bad cells in it to find, whatever
  // the fifteenth decimal says.
  if (sd === null || !(sd > 0) || sd < minSpread) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  // Numbers so large their sum overflows have no readable spread either: an
  // infinite SD would put every z at 0 and an infinite mean at NaN — a whole
  // column measured and left grey (tests/test-heat-sweep.mjs).
  if (!finite(sd) || !finite(mean)) return null;
  return {
    n: xs.length, mean, sd, invert: Boolean(invert), edges: edges.slice(),
    sorted: xs.slice().sort((a, b) => b - a),
    fmt: typeof fmt === 'function' ? fmt : null,
  };
}

// Two values printed alike are the same value to a reader, and a sum of floats
// must not be ranked apart from its twin by the fifteenth decimal.
const SAME = 1e-9;

/**
 * Where one value stands in its group, as the pieces a card can lay out.
 *
 * @returns {{rank:number, lowRank:number, of:number, mean:number, member:boolean}|null}
 *   `rank` counts from the HIGHEST value (1 = the highest number, whatever
 *   direction is good — it is about the number, like `z`); `lowRank` counts
 *   from the lowest. Tied values share a rank. `of` is the size of the group,
 *   plus one when the value asked about is not itself one of its members.
 */
export function heatStanding(value, scale) {
  if (!scale || !finite(value)) return null;
  const sorted = scale.sorted || [];
  let above = 0;
  let below = 0;
  let member = false;
  for (const x of sorted) {
    if (x > value + SAME) above += 1;
    else if (x < value - SAME) below += 1;
    else member = true;
  }
  return {
    rank: above + 1,
    lowRank: below + 1,
    of: sorted.length + (member ? 0 : 1),
    mean: scale.mean,
    member,
  };
}

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 22 -> "22nd". */
export function ordinal(n) {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;
}

/** The group's average as that group's numbers are printed. */
function meanText(scale, fmt) {
  const f = typeof fmt === 'function' ? fmt : scale.fmt;
  if (f) return String(f(scale.mean));
  const sorted = scale.sorted || [];
  const small = sorted.length > 0 &&
    Math.max(Math.abs(sorted[0]), Math.abs(sorted[sorted.length - 1])) <= 1;
  return scale.mean.toFixed(small ? 2 : 1);
}

/**
 * One value's standing on a scale, or null when it has none.
 *
 * @returns {{z:number, dir:-1|0|1, step:number, cls:string, mark:string,
 *            words:string, rank:number, lowRank:number, of:number, mean:number,
 *            standing:string, avgText:string}|null}
 *
 * `z` is signed against the RAW value (above the mean is positive) and `dir` is
 * signed against GOODNESS (+1 is the good end, whichever end that is). Keeping
 * the two apart is what lets `words` say "Highest of 10" on an inverted column
 * while the cell is still painted red.
 *
 * THE PIECES, for a caller laying them out in a card rather than a sentence:
 * `rank` (1 = the highest number), `lowRank` (1 = the lowest), `of` (the size
 * of the group), `mean` (its average, unrounded), `standing` ("2nd highest of
 * 10") and `avgText` (the average as printed, "118.2"). `words` is
 * `standing · avg avgText for <what>`, or `standing · league avg avgText` with
 * no `what`. Options: `what` names the group; `fmt` prints the average (else
 * the scale's own `fmt`, else one decimal).
 */
export function heatOf(value, scale, { what = '', fmt = null } = {}) {
  if (!scale || !finite(value)) return null;
  // A scale without a real spread places nothing: a NaN z clears no edge and
  // would come back as a measured, uncoloured cell however far out it sits.
  if (!finite(scale.mean) || !finite(scale.sd) || !(scale.sd > 0)) return null;
  const z = (value - scale.mean) / scale.sd;
  const mag = Math.abs(z);

  // The step is the number of edges this value has cleared, which is how the
  // boundaries stay in HEAT_EDGES rather than in a chain of ifs here.
  let step = 0;
  for (const e of scale.edges) if (mag >= e) step += 1;

  const good = scale.invert ? -Math.sign(z) : Math.sign(z);
  const dir = step === 0 ? 0 : (good || 1);

  return {
    z,
    dir,
    step,
    cls: heatClassOf(dir, step),
    mark: step >= HEAT_MARK_STEP ? (dir > 0 ? HEAT_UP : HEAT_DOWN) : '',
    ...heatWords(value, scale, what, fmt),
  };
}

/**
 * The class list for a step, and the ONE place the class names are spelled.
 *
 * `heat` is always present so a stylesheet (and a test) can address "cells on
 * the scale" without enumerating the eight, and so a neutral cell is still
 * marked as having been MEASURED — which is a different thing from a cell the
 * scale refused, and the two look identical without it.
 */
function heatClassOf(dir, step) {
  if (!step || !dir) return 'heat heat-0';
  return `heat heat-${dir > 0 ? 'up' : 'dn'}-${step}`;
}

/**
 * The clause the cell's preview carries — channel 3 of "never colour alone".
 *
 * PLAIN STANDING: where the number ranks in its group and what the group
 * averages. Tim, 2026-10-08: "a bad preview is … the numbers in the week by
 * week chart that talk about SD and info we don't want or need". So no
 * standard deviations, no step numbers and nothing about the scale itself
 * here — the key under a table explains the colours; this says where the
 * number stands, in figures a reader can check against the column. The top
 * half of a group counts down from the highest ("2nd highest of 10"), the
 * bottom half up from the lowest ("2nd lowest of 10"), so the count is always
 * the short one and never needs "which end is 1st?" answered.
 */
function heatWords(value, scale, what, fmt) {
  const st = heatStanding(value, scale);
  const top = st.rank <= st.lowRank;
  const r = top ? st.rank : st.lowRank;
  const end = top ? 'highest' : 'lowest';
  const place = r === 1 ? end[0].toUpperCase() + end.slice(1) : `${ordinal(r)} ${end}`;
  const standing = `${place} of ${st.of}`;
  const avgText = meanText(scale, fmt);
  const words = what
    ? `${standing} · avg ${avgText} for ${what}`
    : `${standing} · league avg ${avgText}`;
  return { words, rank: st.rank, lowRank: st.lowRank, of: st.of, mean: st.mean, standing, avgText };
}

/** Just the class, for a caller that wants nothing else. '' when there is no scale. */
export function heatClass(value, scale) {
  const h = heatOf(value, scale);
  return h ? h.cls : '';
}

/**
 * The glyph as a cell would draw it, already wrapped and hidden from screen
 * readers — the `title` and the `aria-label` say it in words, and a reader
 * hearing "black up-pointing triangle" in the middle of a number is worse off.
 *
 * Returns '' below the mark step, so a caller can concatenate it unconditionally.
 */
export function heatMarkHtml(h) {
  return h && h.mark ? ` <span class="heatmark" aria-hidden="true">${h.mark}</span>` : '';
}

/**
 * The scale written out under a table — channel 4, and the thing that makes a
 * colour checkable rather than decorative.
 *
 * In POINTS, not in adjectives: a reader looking at a green cell can read the
 * number off this line and decide for themselves whether the cell deserves it.
 *
 * @param {Object|null} scale
 * @param {Object} [opts]
 * @param {string} [opts.what] what the group is, e.g. "this slot across the league"
 * @param {string} [opts.high] what a high number means, e.g. "a better slot"
 * @param {string} [opts.low] what a low number means
 * @param {boolean} [opts.unit] append " pts" to the printed thresholds
 */
export function describeHeat(scale, { what = 'the same column across the league', high = '', low = '', unit = true } = {}) {
  if (!scale) {
    return 'Nothing here is coloured: a scale needs at least two values to compare, and there ' +
      'are not two yet.';
  }
  const edge = scale.edges[scale.edges.length - 1];
  const u = unit ? ' pts' : '';
  const top = round1(scale.mean + edge * scale.sd);
  const bottom = round1(scale.mean - edge * scale.sd);
  const goodHigh = !scale.invert;
  const greenAt = goodHigh ? top : bottom;
  const redAt = goodHigh ? bottom : top;
  const meaning = high && low
    ? ` Green is ${high}; red is ${low}.`
    : '';
  return `Colour compares each number with ${what}: green above the average, red below, ` +
    `deepening in ${HEAT_STEPS} steps and reaching full colour at ` +
    `${greenAt.toFixed(1)}${u} or better, ${redAt.toFixed(1)}${u} or worse ` +
    `(average ${round1(scale.mean).toFixed(1)}${u}, ${scale.n} values). Cells at the end of the scale carry ${HEAT_UP} or ${HEAT_DOWN} as well ` +
    `as a colour, and the type gets heavier the further out a number is, so the scale can be ` +
    `read without separating the hues.${meaning}`;
}

/**
 * The same sentence for a table with MANY scales — one per column or per slot —
 * where printing every column's thresholds would be longer than the table.
 *
 * It is a different sentence rather than the one above with the numbers cut
 * out, because a reader has to be told that each column was measured on its own
 * or they will assume one scale across the whole grid and read every kicker as
 * a disaster. That misreading is the exact thing section 1 exists to prevent.
 */
export function describeHeatPerColumn({ group = 'column', what = 'the other squads' } = {}) {
  return `Colour is per ${group} and never across the table: each number is compared only with ` +
    `${what} in that same ${group}, so a quarterback is never measured against a kicker. Green is ` +
    `above that ${group}'s average and red below, in ${HEAT_STEPS} steps, reaching full colour ` +
    `at about the best and worst sixth of it. Cells at the end of the scale carry ${HEAT_UP} or ` +
    `${HEAT_DOWN}, and the type gets heavier the further out a number is, so none of it depends ` +
    `on telling red from green. Tap or hover any number for exactly where it stands.`;
}
