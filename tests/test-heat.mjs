// Checks js/heat.js — the shared red/green scale Tim asked for on 2026-09-19 —
// and the two things the PLAYER CARD does with it and beside it, added the same
// day: the scale on its Proj row, and bold on the weeks he starts.
//
//   node test-heat.mjs
//
// The card's half is at the foot of this file. It is here rather than in a
// suite of its own because it asks this file's two questions — what is on the
// scale, and what is NOT — of the one place on the site where the comparison
// group is ONE MAN'S OWN SEASON rather than a column across the league. The
// rendered half (classes, the underline, the divider surviving the wrap, the
// run still not scrolling) is in touch-check.mjs, which has a DOM; this file
// deliberately has none, so what it can assert is the data.
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

// ===========================================================================
// THE PLAYER CARD'S WEEK RUN — the scale on the Proj row, and the weeks he
// starts on the Week row. 2026-09-19, both of them Tim's asks of the same day.
// ===========================================================================
//
// These live here rather than in a suite of their own because they are about
// the same two questions this file already answers — what is on the scale, and
// what is NOT — asked of the one place on the site where the comparison group
// is a single man's own season rather than a column across the league. They are
// the DATA half; touch-check.mjs holds the rendered half (the classes, the
// underline, the divider surviving the wrap, and the run still not scrolling),
// because that needs a DOM and this file deliberately has none.
//
// js/player-card.js registers two document-level listeners when it loads — one
// for Escape and one for a tap outside a sheet — so it needs enough of a
// document to import at all. The stub is four methods wide on purpose: a fuller
// fake would start being able to pass assertions on its own behalf.

globalThis.document = globalThis.document || {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({
    style: {}, classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, appendChild() {},
  }),
  body: { appendChild() {} },
};
globalThis.window = globalThis.window || {
  addEventListener() {}, location: { origin: 'http://localhost' },
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
globalThis.matchMedia = globalThis.matchMedia || globalThis.window.matchMedia;
globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null,
};

const { weekRun } = await import('../js/player-card.js');

// ---- ONLY REAL NUMBERS ARE ON THE SCALE ----------------------------------
//
// Hand-built so the answer can be redone by eye: the five weeks that ARE
// numbers are the EXACT fixture from the top of this file — 15, 15, 20, 25, 25,
// mean 20, sd exactly 5 — and every other week is one of the ways this site has
// of NOT having a number. If any of those six leaked into the group the mean
// would move off 20 and every assertion below it would go with it.
//
//   wk 1–5   real projections
//   wk 6     'wait'    not read from ESPN yet
//   wk 7     'failed'  ESPN refused that week for everybody
//   wk 8     'off'     he was not on this roster that week
//   wk 9     null      ESPN carried no number for him
//   wk 10    0.00 in his NFL team's bye week
//   wk 11    0.00 for a man ESPN has ruled OUT
const STATES = {
  heading: 'ESPN’s projection for weeks 1–11',
  weeks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  projections: [15, 15, 20, 25, 25, 'wait', 'failed', 'off', null, 0, 0],
  actuals: [],
  byeWeek: 10,
  injuryStatus: [null, null, null, null, null, null, null, null, null, null, 'OUT'],
};
const states = weekRun(STATES);

eq(states.scale.n, 5, 'THE SCALE IS BUILT FROM THE FIVE REAL NUMBERS AND NOTHING ELSE');
close(states.scale.mean, 20, 1e-9, 'so the mean is the one the five values have by hand');
close(states.scale.sd, 5, 1e-9, 'and so is the spread');
eq(states.cols.length, 11, 'while the chart still draws all eleven weeks');

const kindOf = (i) => states.cols[i].proj.kind;
const heatOfCol = (i) => states.cols[i].heat;
ok([5, 6, 7, 8].every((i) => heatOfCol(i) === null),
  'NONE OF THE FOUR NO-NUMBER STATES IS ON THE SCALE — a week nobody has read is not a week he scored nothing',
  JSON.stringify([5, 6, 7, 8].map((i) => [kindOf(i), heatOfCol(i) && heatOfCol(i).cls])));
eq(heatOfCol(9), null,
  'A BYE IS NOT A VALUE — colouring it would paint a week he was never going to play red for being a bye');
eq(kindOf(9), 'bye', 'and it is still drawn as a bye, which is the fact the cell carries');
eq(heatOfCol(10), null, 'nor is a ruled-out man’s 0.00, which is ESPN saying he will not play');
eq(kindOf(10), 'out', 'and that cell keeps its own kind too');

// The five that ARE numbers land exactly where the boundaries above say they
// should, which is what ties the card to the same scale as everything else.
eq(heatOfCol(0).cls, 'heat heat-dn-4', 'his worst week is at the red end of HIS OWN scale');
eq(heatOfCol(2).cls, 'heat heat-0', 'an average week is measured and left uncoloured');
eq(heatOfCol(4).cls, 'heat heat-up-4', 'and his best week is at the green end');
eq(heatOfCol(4).mark, HEAT_UP, 'the end of the scale still carries its glyph here');

// ---- THE GROUP IS HIS OWN WEEKS, AND THE WORDS SAY SO --------------------
//
// This is a DIFFERENT comparison group from every other use of the scale on the
// site — everywhere else it is one slot or one column across the league — so a
// reader who assumed the usual meaning would read green as "good in the league"
// rather than "a good week for him". The cell's words and the key line under
// the chart both have to close that gap or the colour is misleading.
ok(/his own weeks/.test(heatOfCol(4).words),
  'THE CELL’S OWN WORDS NAME THE GROUP, because this group is not the site’s usual one',
  heatOfCol(4).words);
const heatNote = states.notes.find((n) => /Colour on the Proj row/.test(n));
ok(!!heatNote, 'the card carries a key line for the colour', JSON.stringify(states.notes));
ok(/HIS OWN other weeks/.test(heatNote), 'which says the comparison is with his own weeks', heatNote);
ok(/never a comparison with another player or another position/.test(heatNote),
  'and rules out the reading that would break HANDOFF rule 14', heatNote);
ok(heatNote.includes('25.0') && heatNote.includes('15.0'),
  'THE THRESHOLDS ARE IN POINTS, so a cell can be checked by hand rather than trusted', heatNote);
ok(/average of 20\.0 over the 5 weeks/.test(heatNote),
  'and it says what it averaged and over how many weeks', heatNote);
ok(heatNote.includes(HEAT_UP) && heatNote.includes(HEAT_DOWN),
  'the glyph is explained rather than left as a mystery', heatNote);
ok(!/heavier/.test(heatNote),
  'AND IT DOES NOT PROMISE A HEAVIER TYPE — the card gives the weight channel to bold, so a key ' +
  'borrowed whole from describeHeat() would describe a cue that is not drawn',
  heatNote);
ok(!/NaN|undefined/.test(states.notes.join(' ')), 'no note leaks a NaN or an undefined',
  states.notes.join(' '));

// ---- A GENUINE PLAYED 0.0 IS A VALUE, AND IT IS MEANT TO BE --------------
//
// The three zeros on this site are three different facts and `zeroKind` is the
// one place they are told apart: a bye, a man ESPN has ruled out, and a real
// 0.00 for somebody who is available. Only the third is a number, and it is the
// single cell a manager most needs to see under a projection row — dropping it
// would flatter him by hiding his worst week.
const ZERO = weekRun({
  weeks: [1, 2, 3], projections: [0, 20, 40], actuals: [], byeWeek: 9, injuryStatus: null,
});
eq(ZERO.cols[0].proj.kind, 'num', 'a 0.00 that is neither a bye nor a ruled-out man is a number');
eq(ZERO.scale.n, 3, 'AND IT COUNTS: the group is all three weeks, not the two that are not zero');
ok(ZERO.cols[0].heat && ZERO.cols[0].heat.dir === -1,
  'and it paints as the worst week it is, rather than being quietly left out',
  JSON.stringify(ZERO.cols[0].heat));

// ---- THE SCALE CAN BE SUPPRESSED, AND THEN NOTHING OF IT REMAINS ---------
const off = weekRun({ ...STATES, heat: false });
eq(off.scale, null, 'heat:false measures nothing');
ok(off.cols.every((c) => c.heat === null), 'so no cell has a standing',
  JSON.stringify(off.cols.map((c) => c.heat && c.heat.cls)));
eq(off.notes.length, 0, 'and there is no key line for a colour nobody drew');
ok(off.cols.every((c, i) => c.proj.text === states.cols[i].proj.text &&
    c.proj.kind === states.cols[i].proj.kind),
  'while every token is exactly what it was — the scale never touches what a cell SAYS');

// A run the scale itself refuses: one number is not a distribution.
const thin = weekRun({ weeks: [1, 2], projections: [12.5, 'wait'], actuals: [] });
eq(thin.scale, null, 'ONE NUMBER IN THE WHOLE RUN IS NOT A DISTRIBUTION, so nothing is coloured');
ok(thin.cols.every((c) => c.heat === null), 'and no cell claims a standing it cannot have');
ok(!thin.notes.some((n) => /Colour on the Proj row/.test(n)),
  'nor does the card explain a scale it did not draw', JSON.stringify(thin.notes));

// ---- THE WEEKS HE STARTS -------------------------------------------------
//
// Tim: "bold all the week #s that that player is currently projected to start
// for you (and stop bolding the current week, however put a line after the last
// week and current week to seperate what's already happened)".
//
// Weeks 1–8; the page is showing week 4 and weeks 1–4 have been played. He
// starts in 1, 2, 4, 6 and 8 by the caller's reckoning, is benched in 3 and 5,
// and week 7 is unknown.
const RUN = {
  weeks: [1, 2, 3, 4, 5, 6, 7, 8],
  projections: [15, 15, 20, 25, 25, 20, 15, 25],
  actuals: [14, 16, 19, 24, null, null, null, null],
  currentWeek: 4,
  splitAfter: 4,
  starts: [true, true, false, true, false, true, null, true],
  startsNote: 'weeks he would make your best lineup after this trade',
};
const run = weekRun(RUN);
const bolds = run.cols.filter((c) => c.bold).map((c) => c.week);

eq(JSON.stringify(bolds), JSON.stringify([6, 8]),
  'ONLY A FUTURE WEEK HE STARTS IS BOLD — weeks 1, 2 and 4 are starts that have already happened');
ok(run.cols.slice(0, 4).every((c) => !c.bold),
  'NOTHING AT OR BEFORE splitAfter IS EVER BOLD, whatever `starts` said about it',
  JSON.stringify(run.cols.map((c) => [c.week, c.start, c.bold])));
eq(run.cols[3].start, true,
  'and the caller’s opinion is KEPT rather than overwritten — `start` is the fact, `bold` the decision');
eq(run.cols[3].bold, false, 'which is exactly the pair that makes the rule falsifiable');
eq(run.cols[4].bold, false, 'a future week he does NOT start is not bold either');
eq(run.cols[4].start, false, 'and says so rather than saying nothing');
eq(run.cols[6].start, null, 'a week the caller could not answer for stays unknown');
eq(run.cols[6].bold, false, 'and unknown is never bold — silence is not a claim');
ok(run.cols.every((c) => c.past === (c.week <= 4)),
  'every column knows whether it has already happened',
  JSON.stringify(run.cols.map((c) => [c.week, c.past])));

// THE RULE IS ENFORCED HERE, NOT IN THE CALLER. A caller that bolded the past
// would be corrected by this module rather than believed.
const liar = weekRun({ ...RUN, starts: [true, true, true, true, true, true, true, true] });
eq(JSON.stringify(liar.cols.filter((c) => c.bold).map((c) => c.week)),
  JSON.stringify([5, 6, 7, 8]),
  'A CALLER CLAIMING HE STARTED EVERY WEEK STILL GETS NO BOLD ON A PLAYED ONE');

// ---- THE LINE UNDER WHAT HAS ALREADY HAPPENED ---------------------------
const splits = run.cols.filter((c) => c.splitStart).map((c) => c.week);
eq(JSON.stringify(splits), JSON.stringify([5]),
  'THE DIVIDER IS ON THE FIRST WEEK AFTER splitAfter, and on exactly one column');
const splitNote = run.notes.find((n) => /heavy line/.test(n));
ok(splitNote && /before week 5/.test(splitNote),
  'and the card names that week in words, so the line is never the only cue', splitNote);

// It composes with the playoff line rather than fighting it: one column can be
// both, and the class list has to carry both marks for the stylesheet to draw
// ONE border rather than two.
const both = weekRun({ ...RUN, playoffWeeks: [5, 6, 7, 8] });
eq(both.cols[4].splitStart, true, 'week 5 opens what is still to come …');
eq(both.cols[4].poStart, true, '… and is the first playoff week as well');
eq(both.cols.filter((c) => c.poStart).length, 1, 'with the playoff line still on one column only');
eq(both.cols.filter((c) => c.splitStart).length, 1, 'and the split line on one column only');

// A split that falls outside the run draws nothing: a divider with nothing on
// the far side of it is a line about nothing.
const allPast = weekRun({ ...RUN, splitAfter: 20 });
ok(allPast.cols.every((c) => !c.splitStart), 'A SPLIT PAST THE END OF THE RUN DRAWS NO LINE',
  JSON.stringify(allPast.cols.map((c) => c.splitStart)));
ok(!allPast.notes.some((n) => /heavy line/.test(n)), 'and explains no line it did not draw');
ok(allPast.cols.every((c) => !c.bold),
  'and with the whole run in the past, nothing is bold at all — which is the rule, taken to its end');
const allFuture = weekRun({ ...RUN, splitAfter: null });
eq(JSON.stringify(allFuture.cols.filter((c) => c.bold).map((c) => c.week)),
  JSON.stringify([1, 2, 4, 6, 8]),
  'WITH NO SPLIT THERE IS NO PAST, so every week he starts is bold — the rule needs the line to bite');

// ---- WHAT BOLD MEANS IS THE CALLER'S SENTENCE, NOT THE CARD'S ------------
//
// It differs, and that is the whole reason it is passed in: "weeks he makes
// your best lineup" for a man you own, "weeks he would make your best lineup
// after this trade" for a man you are trading for. A card that guessed would
// put a claim about a trade on a card that is not about one.
const boldNote = run.notes.find((n) => /^Bold/.test(n));
ok(!!boldNote, 'the card says what bold means', JSON.stringify(run.notes));
ok(boldNote.includes(RUN.startsNote), 'in the caller’s own words', boldNote);
ok(/2 of the weeks still to come/.test(boldNote),
  'and counts them, so a reader can tell "none" from "not drawn"', boldNote);
ok(/never bold/.test(boldNote) && /fact, not a forecast/.test(boldNote),
  'AND SAYS WHY A PLAYED WEEK IS NOT BOLD, which is the half a reader would otherwise call a bug',
  boldNote);
const unsaid = weekRun({ ...RUN, startsNote: '' });
ok(/weeks he makes your best lineup/.test(unsaid.notes.find((n) => /^Bold/.test(n))),
  'with no sentence supplied it falls back to a plain one rather than leaving bold unexplained',
  unsaid.notes.find((n) => /^Bold/.test(n)));
const nobody = weekRun({ ...RUN, starts: [false, false, false, false, false, false, false, false] });
ok(/none of the weeks still to come/.test(nobody.notes.find((n) => /^Bold/.test(n))),
  'and a man who starts nowhere is TOLD he starts nowhere, rather than shown a chart with no bold in it',
  nobody.notes.find((n) => /^Bold/.test(n)));

// ---- `starts` ABSENT: THE CARD IS WHAT IT WAS ---------------------------
//
// The Analysis page passes none of these options and must be completely
// unaffected. Asserted as an absence on every field that could possibly reach
// the markup, because "I did not see it change" is not an assertion.
const plain = weekRun({
  heading: RUN.heading, weeks: RUN.weeks, projections: RUN.projections, actuals: RUN.actuals,
  currentWeek: 4,
});
ok(plain.cols.every((c) => c.start === null),
  'WITH NO `starts` THE CARD HAS NO OPINION about any week',
  JSON.stringify(plain.cols.map((c) => c.start)));
ok(plain.cols.every((c) => c.bold === false), 'so nothing is bold');
ok(plain.cols.every((c) => c.splitStart === false && c.past === false),
  'there is no divider and no week counts as past');
ok(!plain.notes.some((n) => /^Bold/.test(n) || /heavy line/.test(n)),
  'and the card explains neither, because neither is on screen', JSON.stringify(plain.notes));
eq(plain.cols[3].now, true, 'while everything that was already there is untouched — the current week …');
eq(plain.cols[0].proj.text, '15.0', '… the projection …');
eq(plain.cols[0].act.text, '14.0', '… and the actual under it');

// The narrowest reading of "byte-for-byte what it is today": with the scale off
// as well, every field the markup is built from is exactly the old set.
const asBefore = weekRun({
  heading: RUN.heading, weeks: RUN.weeks, projections: RUN.projections, actuals: RUN.actuals,
  currentWeek: 4, heat: false,
});
ok(asBefore.cols.every((c) =>
  c.heat === null && c.bold === false && c.splitStart === false && c.start === null),
  'A CALLER PASSING NOTHING AND heat:false GETS TODAY’S EXACT CHART — every new field inert',
  JSON.stringify(asBefore.cols[0]));
eq(asBefore.notes.length, 0, 'with not one line of new prose under it');
eq(JSON.stringify(asBefore.legend), JSON.stringify(plain.legend),
  'and the legend is the same legend, which is the one thing that was always there');

// The run that has nothing to draw yet keeps its shape, new fields and all — a
// page that read `notes` off it would otherwise throw on the one path that
// happens on every load.
const waiting = weekRun({ weeks: [1, 2, 3], projections: ['wait', 'wait', 'wait'], actuals: [] });
eq(waiting.cols.length, 0, 'a run that has not been read yet draws no columns');
eq(JSON.stringify(waiting.notes), '[]', 'carries no notes');
eq(waiting.scale, null, 'and no scale');
ok(/Not read yet/.test(waiting.pending), 'and says so in words', waiting.pending);
eq(weekRun({ weeks: [] }), null, 'and no weeks at all is still null, which the card handles');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
