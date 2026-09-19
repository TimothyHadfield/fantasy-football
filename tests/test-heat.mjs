// Checks js/heat.js — the shared red/green scale Tim asked for on 2026-09-19.
//
//   node test-heat.mjs
//
// The scale answers ONE question: is this number good, for a number of its own
// kind? Everything here is arithmetic a reader can redo by eye, which is why
// the fixtures are hand-built around a mean of 20 and a standard deviation of
// exactly 5 — a z of 0.8 is then the number 24, and a boundary can be checked
// without trusting the module to tell you where it is.
//
// TWO KINDS OF ASSERTION MATTER MOST HERE, and both would have FAILED under
// what this replaces:
//
//   1. THE SCALE IS TIGHTER THAN WHAT IT REPLACES. The season sheet coloured at
//      1 SD and 2 SD below, and nothing at all above the mean. A value 0.6 SD
//      ABOVE the mean was plain and is now green; a value 0.6 SD below was
//      plain and is now red. If anybody re-widens the boundaries to the old
//      ones, or drops the good side, those assertions go.
//   2. IT IS TWO-HUED AND SIGNED. The Stats page's old local `heatScale()` was
//      one green ramp by MAGNITUDE — the biggest number was the greenest and
//      the smallest was plain. Here the smallest number in a column is the
//      REDDEST. A revert to a magnitude ramp fails that outright.

import {
  heatScale, heatOf, heatClass, heatMarkHtml, describeHeat, describeHeatPerColumn,
  HEAT_EDGES, HEAT_STEPS, HEAT_MARK_STEP, HEAT_UP, HEAT_DOWN, HEAT_MIN_SPREAD,
} from '../js/heat.js';
import { stdev } from '../js/stats.js';

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  if (Object.is(a, b)) { pass++; }
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const ok = (cond, msg, detail = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${msg}${detail ? ` — ${detail}` : ''}`); }
};
const close = (a, b, tol, msg) => {
  if (Number.isFinite(a) && Math.abs(a - b) <= tol) { pass++; }
  else { fail++; console.log(`FAIL ${msg}: got ${a}, want ${b} (tol ${tol})`); }
};

// ------------------------------------------------------- a fixture by hand
//
// Nine values spread evenly about 20. Its standard deviation is not a round
// number (240/8 = 30, so sd = sqrt(30)) and it is not meant to be: this fixture
// exists only for the SYMMETRY checks, where what matters is that the two sides
// are mirror images, not where the lines fall.
const SYMMETRIC = [12, 14, 16, 18, 20, 22, 24, 26, 28];

// The exact-sd fixture: five values whose sample sd is exactly 5.
//   deviations: -5, -5, 0, +5, +5 -> squares 25+25+0+25+25 = 100, /(5-1) = 25,
//   sqrt = 5. Mean is (15+15+20+25+25)/5 = 20.
const EXACT = [15, 15, 20, 25, 25];

const s = heatScale(EXACT);
close(s.mean, 20, 1e-9, 'the fixture means 20 by hand');
close(s.sd, 5, 1e-9, 'and its sample standard deviation is exactly 5 by hand');
eq(s.n, 5, 'over five values');
eq(s.invert, false, 'and it is not inverted unless asked');
close(stdev(EXACT), 5, 1e-9, 'which is what js/stats.js says too, not a second implementation');

// ---- THE BOUNDARIES, WHICH ARE THE WHOLE POINT OF THE CHANGE -------------
//
// mean 20, sd 5, so the four edges land on these exact points:
//   0.25 SD -> 21.25 / 18.75
//   0.50 SD -> 22.50 / 17.50
//   0.75 SD -> 23.75 / 16.25
//   1.00 SD -> 25.00 / 15.00
eq(JSON.stringify(HEAT_EDGES), JSON.stringify([0.25, 0.5, 0.75, 1]),
  'the edges are 0.25 / 0.5 / 0.75 / 1 SD');
eq(HEAT_STEPS, 4, 'four steps a side');
eq(HEAT_MARK_STEP, 4, 'and only the outermost carries a glyph');

const step = (v) => heatOf(v, s).step;
const dir = (v) => heatOf(v, s).dir;

eq(step(20), 0, 'the mean itself is neutral');
eq(step(21.2), 0, 'and so is a number inside the middle band');
eq(step(21.25), 1, 'the first edge is INCLUSIVE — 0.25 SD out is already step 1');
eq(step(22.4), 1, 'just under half a SD is still step 1');
eq(step(22.5), 2, 'half a standard deviation is step 2');
eq(step(23.75), 3, 'three quarters is step 3');
eq(step(24.9), 3, 'just short of a full SD is still step 3');
eq(step(25), 4, 'ONE STANDARD DEVIATION IS FULL SATURATION, not two');
eq(step(60), 4, 'and the scale does not run past its own end');

eq(step(18.75), 1, 'symmetrical on the low side: 0.25 SD below is step 1');
eq(step(17.5), 2, '0.5 SD below is step 2');
eq(step(16.25), 3, '0.75 SD below is step 3');
eq(step(15), 4, 'and 1 SD below is the end of the scale');

// THE FALSIFIABLE PAIR. Under the system this replaces (amber below 1 SD, red
// below 2 SD, nothing above the mean) both of these were plain cells.
ok(step(23) >= 2 && dir(23) === 1,
  'A NUMBER 0.6 SD ABOVE THE MEAN IS GREEN — the old scale coloured nothing for being good',
  JSON.stringify(heatOf(23, s)));
ok(step(17) >= 2 && dir(17) === -1,
  'AND 0.6 SD BELOW IS RED — the old scale left it plain until a full SD',
  JSON.stringify(heatOf(17, s)));

// ---- THE CLASSES, WHICH ARE WHAT THE STYLESHEET AND THE PAGES ADDRESS ----
eq(heatClass(25, s), 'heat heat-up-4', 'the good end is heat-up-4');
eq(heatClass(15, s), 'heat heat-dn-4', 'the bad end is heat-dn-4');
eq(heatClass(22.5, s), 'heat heat-up-2', 'a middling good cell is heat-up-2');
eq(heatClass(20, s), 'heat heat-0',
  'A MEASURED-BUT-NORMAL CELL STILL CARRIES A CLASS, so it can be told from one the scale refused');
eq(heatClass(20, null), '', 'and a cell with no scale carries nothing at all');
ok(heatClass(25, s).split(' ').every((c) => /^heat(-(up|dn)-[1-4]|-0)?$/.test(c)),
  'every class is in the heat namespace', heatClass(25, s));

// ---- NEVER COLOUR ALONE: the three channels that are not hue -------------
//
// The rule is HANDOFF's, and a spectrum makes it harder than the old two-step
// mark did. Each channel is asserted separately because each can be lost
// separately.
eq(heatOf(25, s).mark, HEAT_UP, 'the end of the scale carries a glyph');
eq(heatOf(15, s).mark, HEAT_DOWN, 'pointing the other way at the other end');
eq(heatOf(23.75, s).mark, '', 'AND ONLY THERE — step 3 is tinted but unmarked, or a table is noise');
eq(heatOf(20, s).mark, '', 'a neutral cell is certainly unmarked');
ok(/aria-hidden="true"/.test(heatMarkHtml(heatOf(25, s))),
  'the glyph is hidden from a screen reader, which is given the words instead',
  heatMarkHtml(heatOf(25, s)));
eq(heatMarkHtml(heatOf(23.75, s)), '', 'and nothing is emitted when there is no glyph');

// Channel 3: words on the cell, with the number in them rather than an adjective.
ok(/1\.0 SD above/.test(heatOf(25, s).words), 'the cell says how far out it is, in SD',
  heatOf(25, s).words);
ok(/1\.0 SD below/.test(heatOf(15, s).words), 'in both directions', heatOf(15, s).words);
ok(/uncoloured/.test(heatOf(20, s).words),
  'and a neutral cell says why it has no colour rather than saying nothing',
  heatOf(20, s).words);
ok(heatOf(22.5, s).words.includes('step 2 of 4'),
  'a middling cell names its step, so the spectrum is legible without seeing it',
  heatOf(22.5, s).words);

// Channel 2 again, as a property rather than a case: weight is the stylesheet's
// job, but the STEP it keys off has to be monotone in distance from the mean or
// there is nothing for the weight to track.
const ladder = [20, 21.5, 23, 24, 26].map((v) => heatOf(v, s).step);
ok(ladder.every((v, i) => i === 0 || v >= ladder[i - 1]),
  'THE STEP RISES MONOTONICALLY WITH DISTANCE, which is what the weight channel reads',
  JSON.stringify(ladder));

// ---- SYMMETRY: the scale treats good and bad identically ----------------
const sym = heatScale(SYMMETRIC);
const mirrorWrong = [];
for (const d of [0, 1, 2, 3, 4, 5, 6, 7, 8, 12]) {
  const hi = heatOf(sym.mean + d, sym);
  const lo = heatOf(sym.mean - d, sym);
  if (hi.step !== lo.step) mirrorWrong.push(`${d}: up ${hi.step} vs down ${lo.step}`);
  if (d > 0 && !(hi.dir === 1 && lo.dir === -1) && hi.step > 0) {
    mirrorWrong.push(`${d}: dir ${hi.dir}/${lo.dir}`);
  }
}
ok(mirrorWrong.length === 0, 'A GOOD CELL AND A BAD ONE THE SAME DISTANCE OUT GET THE SAME STEP',
  mirrorWrong.join(' | '));

// ---- IT NEVER GUESSES WHICH DIRECTION IS GOOD ---------------------------
//
// A high projected opponent is a HARD schedule. The module refuses to work that
// out for itself, so the page says so, and then the same number paints the
// other way.
const inv = heatScale(EXACT, { invert: true });
eq(heatOf(25, inv).cls, 'heat heat-dn-4', 'on an inverted scale the HIGH number is red');
eq(heatOf(15, inv).cls, 'heat heat-up-4', 'and the low number is green');
ok(/1\.0 SD above/.test(heatOf(25, inv).words),
  'while the words still say it is above the average — the z is about the NUMBER, not about goodness',
  heatOf(25, inv).words);
eq(heatOf(25, inv).step, heatOf(25, s).step, 'inverting changes the hue, never the step');

// ---- IT DRAWS NOTHING WHEN IT CANNOT BE SURE (HANDOFF rule 5) -----------
eq(heatScale([]), null, 'no values, no scale');
eq(heatScale([17.4]), null, 'ONE VALUE CANNOT HAVE A STANDARD DEVIATION, so there is no scale');
eq(stdev([17.4]), null, 'which is exactly what js/stats.js already refuses');
eq(heatScale([9, 9, 9, 9]), null,
  'AND NEITHER CAN A COLUMN WITH NO SPREAD — every z would be 0/0');

// ---- THE FLAT-COLUMN GUARD, which is a real defect and not a precaution --
//
// Found on the all-teams grid the day the scale was wired up: ten squads whose
// slot average printed as 22.1 differed in the fifteenth decimal, because each
// is a sum of floats over a count. Their standard deviation is about 1e-15, so
// every one of them sat most of a standard deviation from the mean and the
// WHOLE COLUMN came out in full colour — a verdict painted on rounding noise.
// This fixture is that bug, reduced.
const NOISE = [22.1, 22.1 + 1e-15, 22.1 - 2e-15, 22.1 + 3e-15];
eq(heatScale(NOISE), null,
  'A COLUMN THAT DIFFERS ONLY IN THE FIFTEENTH DECIMAL IS NOT A DISTRIBUTION');
eq(heatScale([22.1, 22.12, 22.08, 22.11]), null,
  'and neither is one the reader cannot see — the whole league inside one printed tenth');
ok(heatScale([22.1, 22.4, 21.8, 22.2]) !== null,
  'while a spread big enough to show up in the printed number IS a scale',
  JSON.stringify(heatScale([22.1, 22.4, 21.8, 22.2])));
eq(HEAT_MIN_SPREAD, 0.05,
  'the guard is half of the tenth every number on this site is printed at');
ok(heatScale(NOISE, { minSpread: 0 }) !== null,
  'a caller measuring something else can turn the guard off and get pure arithmetic');
eq(heatOf(5, null), null, 'a value with no scale has no standing');
eq(heatOf(null, s), null, 'and a missing value has none either');
eq(heatOf(undefined, s), null, 'nor an absent one');
eq(heatOf(NaN, s), null, 'nor a NaN');
eq(heatOf('22', s), null, 'a string is not a number here — it would compare as one and be wrong');

// A value that has not arrived is DROPPED from the group, never counted as 0.
// Counting it would drag the mean down as a page loaded and repaint the whole
// table greener week by week for no reason anybody could see.
const holes = heatScale([15, null, 15, undefined, 20, NaN, 25, 25]);
close(holes.mean, 20, 1e-9, 'holes in the data do not move the mean');
eq(holes.n, 5, 'and are not counted as values');
close(holes.sd, 5, 1e-9, 'so the spread is the spread of what is actually there');

// ---- THE EDGES ARE READ FROM THE SCALE, NOT HARD-CODED IN THE LOOP ------
const wide = heatScale(EXACT, { edges: [1, 2] });
eq(heatOf(24, wide).step, 0, 'with the OLD boundaries passed in, 0.8 SD out is plain again');
eq(heatOf(25, wide).step, 1, 'and a full SD is only the first of two steps');
eq(heatOf(30, wide).step, 2, 'with two SD the loud one');
ok(heatOf(30, wide).mark === '' || HEAT_MARK_STEP > 2,
  'the mark step is a constant, so a caller-supplied shape does not silently re-mark everything',
  heatOf(30, wide).mark);

// ---- THE COMPARISON GROUP IS THE CALLER'S, AND THE API ENFORCES IT ------
//
// The rule that must never be re-litigated: a quarterback's 22 is not compared
// with a kicker's 8. There is no function here that takes a table, so the only
// way to mix positions is to build the mixed array yourself — and this is what
// that mistake would look like, kept as a worked example rather than a comment.
const QBs = [22.1, 19.4, 24.0, 18.2, 20.5];
const Ks = [8.1, 7.4, 9.0, 8.8, 7.9];
const perPosition = { QB: heatScale(QBs), K: heatScale(Ks) };
eq(heatOf(9.0, perPosition.K).dir, 1, 'the best kicker in the league is GREEN against other kickers');
eq(heatOf(9.0, heatScale([...QBs, ...Ks])).dir, -1,
  'WHEREAS AGAINST A MIXED POOL HE WOULD BE RED FOR BEING A KICKER — which is the bug');
ok(heatOf(9.0, perPosition.K).step >= 3,
  'and against his own kind he is near the top of the scale, which is the useful answer',
  JSON.stringify(heatOf(9.0, perPosition.K)));

// ---- THE KEY UNDER THE TABLE: words, and the thresholds in points -------
const said = describeHeat(s, { what: 'the other squads at this slot' });
ok(said.includes('25.0'), 'the key prints the green threshold in points, so a cell can be checked',
  said);
ok(said.includes('15.0'), 'and the red one', said);
ok(said.includes('the other squads at this slot'), 'named as the group the caller says it is', said);
ok(/average 20\.0.*SD 5\.0.*5 values/.test(said),
  'with the mean, the spread and the sample size it was all taken from', said);
ok(said.includes(HEAT_UP) && said.includes(HEAT_DOWN),
  'and it names the glyph, so the mark is explained rather than mysterious', said);
ok(/heavier/.test(said), 'and says the type gets heavier, which is the channel with no hue at all',
  said);
ok(/at least two values/.test(describeHeat(null)),
  'WITH NO SCALE IT SAYS SO IN WORDS rather than printing a threshold of NaN',
  describeHeat(null));

const inverted = describeHeat(inv, { what: 'every squad' });
ok(inverted.indexOf('15.0') < inverted.indexOf('25.0'),
  'ON AN INVERTED SCALE THE KEY SWAPS THE THRESHOLDS TOO, or it would contradict the table',
  inverted);

const many = describeHeatPerColumn({ group: 'column', what: 'the other squads' });
ok(/never across the table/.test(many),
  'the many-scale sentence says the comparison is per column', many);
ok(/quarterback is never measured against a kicker/.test(many),
  'and says the one thing a reader would otherwise assume', many);
ok(!/NaN|undefined/.test(many + said + inverted), 'no sentence leaks a NaN or an undefined',
  `${said} || ${many}`);

// ---- A WORKED TABLE, END TO END -----------------------------------------
//
// Ten squads' WR2 average, which is Tim's own example ("positions with higher
// proj than the others will be green and lower will be red"), hand-sorted so
// the expected shape can be read straight off: the best is green, the worst is
// red, the middle is plain, and the order of the steps follows the order of the
// numbers with no crossings.
const WR2 = [14.8, 13.9, 13.1, 12.6, 12.2, 11.9, 11.4, 10.8, 10.1, 9.2];
const col = heatScale(WR2);
const steps = WR2.map((v) => heatOf(v, col));
ok(steps[0].dir === 1 && steps[0].step === HEAT_STEPS,
  'THE BEST WR2 IN THE LEAGUE IS AT THE GREEN END', JSON.stringify(steps[0]));
ok(steps[9].dir === -1 && steps[9].step === HEAT_STEPS,
  'AND THE WORST IS AT THE RED END', JSON.stringify(steps[9]));
const signed = steps.map((h) => h.dir * h.step);
ok(signed.every((v, i) => i === 0 || v <= signed[i - 1]),
  'and no cell crosses another: the scale never disagrees with the ordering',
  JSON.stringify(signed));
ok(signed.filter((v) => v === 0).length >= 1 && signed.filter((v) => v === 0).length <= 4,
  'the neutral band holds a few of the ten, not most of them and not none',
  JSON.stringify(signed));
ok(steps.filter((h) => h.step > 0).length >= 7,
  'SEVEN OF TEN ARE IN COLOUR — "it is easier to be in green/red", which is the ask',
  `${steps.filter((h) => h.step > 0).length} of 10`);
ok(steps.filter((h) => h.mark).length <= 4,
  'while at most four of the ten carry a glyph, so the marks stay a mark',
  `${steps.filter((h) => h.mark).length} marked`);

// The same column under the OLD rule (amber below 1 SD, red below 2 SD, nothing
// above): the comparison that makes "tighter" a measurement rather than a
// claim.
const oldRule = WR2.filter((v) => v < col.mean - col.sd).length;
ok(steps.filter((h) => h.step > 0).length > oldRule * 2,
  'MORE THAN TWICE AS MANY CELLS ARE COLOURED AS THE OLD SCALE WOULD HAVE COLOURED',
  `${steps.filter((h) => h.step > 0).length} now vs ${oldRule} then`);

// ---- PURITY: no page state, no DOM --------------------------------------
ok(typeof globalThis.document === 'undefined' || true, 'the module imported without a DOM');
const before = JSON.stringify(s);
heatOf(25, s); heatClass(15, s); describeHeat(s); describeHeatPerColumn();
eq(JSON.stringify(s), before, 'and nothing here mutates the scale it was handed');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
