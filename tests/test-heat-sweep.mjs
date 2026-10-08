// THE SWEEP: does the colour ever get WEAKER as a number moves further out?
//
// Tim, 2026-10-08: "it gets darker green or darker red up to a certain point
// and then if you go past that it actually goes back to grey or something
// like that."
//
// tests/test-heat.mjs pins the boundaries one at a time. This suite walks a
// value outward from the middle of many differently-shaped comparison groups
// — to ten standard deviations and far beyond, on both sides, on plain and
// inverted scales — and asserts the three things that claim would break:
//
//   1. DEPTH NEVER FALLS WITH DISTANCE. Walking away from the mean, the step
//      is non-decreasing; once a cell is coloured it never returns to none.
//   2. PAST THE END OF THE SCALE THE DEEPEST STEP HOLDS, whatever the size of
//      the number: 1 SD out, 10 SD out, 1e300 out, ±Infinity.
//   3. THE CLASS IS ALWAYS ONE THE STYLESHEET PAINTS. Every class `heatOf` can
//      emit has a `background-image` rule in css/app.css, and no value —
//      NaN, null, a string, an overflowing sum — produces a class outside
//      that set or a step outside 0…HEAT_STEPS.
//
// It also covers the groups a scale must refuse (one value, ties, nothing
// finite) so that "no colour" is only ever the answer to "no distribution",
// never to "too far out".
import { readFileSync } from 'node:fs';
import { repoFile } from './repo.mjs';
import { heatScale, heatOf, heatClass, heatMarkHtml, HEAT_STEPS, HEAT_EDGES } from '../js/heat.js';

let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++; else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};

// --- the classes the stylesheet paints ---------------------------------------
const css = readFileSync(repoFile('css/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const painted = new Set(['heat heat-0']);
for (const side of ['up', 'dn']) {
  for (let n = 1; n <= HEAT_STEPS; n++) {
    const rule = new RegExp(`\\.heat-${side}-${n}\\s*\\{[^}]*background-image\\s*:\\s*linear-gradient`).test(css);
    ok(rule, `css/app.css paints .heat-${side}-${n} with a background-image`);
    const weight = new RegExp(`\\.heat\\.heat-${side}-${n}:not\\(html\\)`).test(css);
    ok(weight, `css/app.css steps the weight on .heat-${side}-${n}`);
    if (rule) painted.add(`heat heat-${side}-${n}`);
  }
}
// The deepest alpha really is the deepest: a step-4 rule fainter than step 3
// would be "darker up to a point, then paler" with every class correct.
for (const side of ['up', 'dn']) {
  const alphas = [];
  for (let n = 1; n <= HEAT_STEPS; n++) {
    const m = new RegExp(`\\.heat-${side}-${n}\\s*\\{[^}]*rgba\\([^)]*,\\s*([\\d.]+)\\)`).exec(css);
    alphas.push(m ? Number(m[1]) : NaN);
  }
  ok(alphas.every((a, i) => Number.isFinite(a) && (i === 0 || a > alphas[i - 1])),
    `the ${side} tints deepen with every step`, alphas.join(' '));
}

// --- the comparison groups ---------------------------------------------------
// Real shapes: ten squads' weekly scores, a kicker column a point wide, luck
// (signed, with one −90 week), win chances 0–1, a position pool of 150, and
// the degenerate ends — two values, three, a tie plus one, huge and tiny.
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rnd = seeded(20261008);
const GROUPS = {
  'ten weekly scores': [134.3, 129.0, 128.3, 113.0, 122.2, 114.5, 113.7, 114.1, 109.7, 115.6],
  'kicker column': [9.3, 9.3, 9.4, 9.2, 10.6, 9.4, 9.5, 9.1, 9.1, 9.1],
  'luck with a −90 week': [12, -4, 7, -90, 3, 21, -11, 0, 5, -8],
  'win chances': [0.39, 0.52, 0.61, 0.08, 0.77, 0.45, 0.5, 0.33, 0.91, 0.12],
  'title odds, percent': [25, 24, 18, 11, 9, 6, 4, 2, 1, 0],
  'position pool of 150': Array.from({ length: 150 }, () => 4 + rnd() * 20),
  'two values': [10, 20],
  'three values': [0, 5, 10],
  'a tie plus one': [7, 7, 7, 7, 30],
  'two clusters': [0, 0, 0, 10, 10, 10],
  'negative numbers': [-30, -22, -41, -18, -25],
  'huge magnitudes': [1e12, 1.2e12, 0.9e12, 1.4e12, 1.1e12],
  'tiny magnitudes': [1e-9, 2e-9, 3e-9, 5e-9, 4e-9],
  'with gaps': [12, null, 15, undefined, NaN, 9, 20],
};

// Distances walked, in SD: fine steps through the scale, then far past its end.
const NEAR = Array.from({ length: 201 }, (_, i) => i * 0.05);               // 0 … 10 SD
const FAR = [12, 25, 50, 100, 1e3, 1e6, 1e9, 1e12, 1e15, 1e100, 1e300];
const DISTANCES = [...NEAR, ...FAR];

for (const [name, values] of Object.entries(GROUPS)) {
  for (const invert of [false, true]) {
    for (const minSpread of [undefined, 0]) {
      const scale = heatScale(values, minSpread === undefined ? { invert } : { invert, minSpread });
      const label = `${name}${invert ? ' (inverted)' : ''}${minSpread === 0 ? ' (guard off)' : ''}`;
      if (!scale) {
        // Only the tiny-magnitude group is narrower than the printed tenth.
        ok(name === 'tiny magnitudes' && minSpread === undefined, `${label}: a scale was built`);
        continue;
      }
      ok(Number.isFinite(scale.mean) && Number.isFinite(scale.sd) && scale.sd > 0,
        `${label}: mean and SD are finite`, `${scale.mean} ${scale.sd}`);

      for (const sign of [1, -1]) {
        let last = 0, coloured = false, worst = '';
        let monotonic = true, neverBack = true, clsOk = true, dirOk = true, markOk = true, endOk = true;
        for (const d of DISTANCES) {
          const v = scale.mean + sign * d * scale.sd;
          if (!Number.isFinite(v)) continue;   // the walk itself overflowed; ±Infinity is below
          const h = heatOf(v, scale, { what: 'the sweep' });
          if (!h) { neverBack = false; worst ||= `null at ${d} SD (v=${v})`; continue; }
          if (!(Number.isInteger(h.step) && h.step >= 0 && h.step <= HEAT_STEPS)) { clsOk = false; worst ||= `step ${h.step} at ${d} SD`; }
          if (!painted.has(h.cls)) { clsOk = false; worst ||= `class "${h.cls}" at ${d} SD`; }
          if (h.cls !== heatClass(v, scale)) { clsOk = false; worst ||= `heatClass disagrees at ${d} SD`; }
          if (h.step < last) { monotonic = false; worst ||= `step ${last} → ${h.step} at ${d} SD (v=${v})`; }
          if (coloured && h.step === 0) { neverBack = false; worst ||= `back to none at ${d} SD (v=${v})`; }
          if (h.step > 0) {
            coloured = true;
            const want = (invert ? -sign : sign) > 0 ? 1 : -1;
            if (h.dir !== want) { dirOk = false; worst ||= `dir ${h.dir} at ${d} SD`; }
            if (!h.cls.includes(want > 0 ? 'heat-up-' : 'heat-dn-')) { dirOk = false; worst ||= `class "${h.cls}" on the wrong side at ${d} SD`; }
          }
          // Clear of the last edge by more than float error: the deepest step.
          if (d >= HEAT_EDGES[HEAT_EDGES.length - 1] + 0.01) {
            if (h.step !== HEAT_STEPS) { endOk = false; worst ||= `step ${h.step} at ${d} SD (v=${v})`; }
            if (!h.mark || !heatMarkHtml(h)) { markOk = false; worst ||= `no end mark at ${d} SD`; }
          }
          last = Math.max(last, h.step);
        }
        const side = sign > 0 ? 'above' : 'below';
        ok(monotonic, `${label}, ${side}: depth never falls with distance`, worst);
        ok(neverBack, `${label}, ${side}: never back to none once coloured`, worst);
        ok(endOk, `${label}, ${side}: the deepest step holds past the end of the scale`, worst);
        ok(markOk, `${label}, ${side}: the end mark holds past the end of the scale`, worst);
        ok(clsOk, `${label}, ${side}: every class is one the stylesheet paints`, worst);
        ok(dirOk, `${label}, ${side}: the side never flips`, worst);
      }

      // The largest doubles are "further out than anything": the deepest step
      // on their own side, never grey and never a crash. ±Infinity is not a
      // number at all (a division by zero upstream) and has no standing.
      for (const [v, sign] of [[Number.MAX_VALUE, 1], [-Number.MAX_VALUE, -1], [1e300, 1], [-1e300, -1]]) {
        const h = heatOf(v, scale, { what: 'the sweep' });
        const want = (invert ? -sign : sign) > 0 ? 'up' : 'dn';
        ok(h && h.step === HEAT_STEPS && h.cls === `heat heat-${want}-${HEAT_STEPS}` && h.mark,
          `${label}: ${v} is the deepest ${want} step`, h ? `${h.cls} step ${h.step}` : 'null');
        ok(h && typeof h.words === 'string' && !/NaN|undefined/.test(h.words),
          `${label}: ${v} has words without NaN`, h ? h.words : 'null');
      }
      ok(heatOf(Infinity, scale) === null && heatOf(-Infinity, scale) === null,
        `${label}: ±Infinity has no standing`);

      // The members of the group themselves: the furthest one out on each side
      // is at least as deep as every member nearer the mean.
      const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
      const byDist = xs.map((v) => ({ v, d: Math.abs(v - scale.mean), h: heatOf(v, scale) }))
        .sort((a, b) => a.d - b.d);
      let memberOk = true, why = '';
      for (const side of [1, -1]) {
        let deep = 0;
        for (const m of byDist.filter((x) => Math.sign(x.v - scale.mean) === side)) {
          if (m.h.step < deep) { memberOk = false; why ||= `${m.v} is step ${m.h.step} after step ${deep}`; }
          deep = Math.max(deep, m.h.step);
        }
      }
      ok(memberOk, `${label}: among its own members depth follows distance`, why);
    }
  }
}

// --- a scale whose own numbers overflow --------------------------------------
// A sum that overflows used to give a scale with an infinite SD (every z is 0,
// so the whole column grey) or an infinite mean (every z is NaN — grey again,
// with "NaN SD" in the title). There is no distribution to read: no scale.
for (const [name, values] of Object.entries({
  'values near the largest double': [1e308, 1.5e308, 1.7e308, 0.5e308],
  'one value overflowing the variance': [1, 2, 3, 1e200],
  'an infinity in the group': [10, 12, Infinity, 14],
})) {
  const scale = heatScale(values);
  const usable = scale === null ||
    (Number.isFinite(scale.mean) && Number.isFinite(scale.sd) && scale.sd > 0);
  ok(usable, `${name}: the scale is finite or refused`, scale ? `mean ${scale.mean} sd ${scale.sd}` : '');
  for (const v of values) {
    const h = heatOf(v, scale);
    ok(h === null || (painted.has(h.cls) && Number.isFinite(h.z)),
      `${name}: ${v} gets a finite standing or none`, h ? `${h.cls} z=${h.z}` : '');
  }
}

// --- what must stay uncoloured, and only this --------------------------------
ok(heatScale([5]) === null, 'one value: no scale');
ok(heatScale([]) === null, 'no values: no scale');
ok(heatScale(null) === null, 'null: no scale');
ok(heatScale([7, 7, 7, 7]) === null, 'all tied: no scale');
ok(heatScale([NaN, null, undefined, 'x']) === null, 'nothing finite: no scale');
const s = heatScale(GROUPS['ten weekly scores']);
for (const bad of [NaN, null, undefined, '120', {}, []]) {
  ok(heatOf(bad, s) === null, `${String(bad) || '[]'} (${typeof bad}): no standing`);
  ok(heatClass(bad, s) === '', `${String(bad) || '[]'} (${typeof bad}): no class`);
}
ok(heatOf(120, null) === null, 'no scale: no standing');
// A hand-made scale with a broken spread must not hand out a class either.
for (const sd of [0, NaN, Infinity, -1]) {
  const h = heatOf(150, { ...s, sd });
  ok(h === null, `a scale with SD ${sd}: no standing`, h ? `${h.cls} z=${h.z}` : '');
}
{
  const h = heatOf(150, { ...s, mean: NaN });
  ok(h === null, 'a scale with a NaN mean: no standing', h ? `${h.cls} z=${h.z}` : '');
}

console.log(`\ntest-heat-sweep: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
