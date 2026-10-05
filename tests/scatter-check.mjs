// js/charts.js — the projected-vs-actual scatter and its regression line.
//
// Tim, 2026-10-04: "2 graphs in stats that shows proj accuracy ... the x axis
// as the proj points and the y axis as actual points. Show a dotted line as the
// perfect line ... as well as the true line based on the data (LSRL) ... If you
// hover over a dot ... show a preview ... If the user then clicks on that
// preview bring them straight to the section".
//
// Three things are held here, each with numbers worked by hand:
//   1. `leastSquares` — slope, intercept, r, n, and its two refusals;
//   2. `scatterChart` — dots placed from the data on ONE scale for both axes
//      (so y = x really is the diagonal), the dotted perfect line, the solid
//      fitted line clipped to the plot;
//   3. the preview — a real <a href>, opened by a hover or a tap, that stays
//      open while the pointer travels from the dot onto it.
//
// Tim, 2026-10-04 (later): "allow the new proj vs act boxes ... to be sorted by
// a variety of metricts ... highlight these specific moments (pick a specific
// one and have the others just be dimmed background and can't be previewed) or
// just colorized ... if you click at all while a specific point is selected (or
// being previewed) whatsoever, bring it to the specific reference" and "show
// ... how closely the true line is to the dotted line, as well as how closely
// the true line is to the dots (R^2 value I think?)". So also:
//   4. `r2` and `offPerfect`, by hand;
//   5. groups — a colour per group, chips for exactly the groups present, a
//      pressed chip that dims the rest out of the pointer's reach and refits
//      the solid line to its own dots;
//   6. any click on the chart follows the previewed dot — a mouse at once, a
//      finger on its second tap, and never when the tap lands on another dot.
//
// Run:  node scatter-check.mjs

import { parseHTML } from 'linkedom';
import { leastSquares, offPerfect, scatterChart, SERIES_COLORS } from '../js/charts.js';

let pass = 0, fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ' — ' + extra : ''}`); }
};
const eq = (a, b, msg) => {
  if (Object.is(a, b)) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const close = (a, b, tol, msg) => {
  if (Number.isFinite(a) && Math.abs(a - b) <= tol) pass++;
  else { fail++; console.log(`FAIL ${msg}: got ${a}, want ${b} ±${tol}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the harness
const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.window = window;
globalThis.document = document;
globalThis.Event = window.Event;
globalThis.getComputedStyle = () => ({ position: 'relative', getPropertyValue: () => '' });
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const W = 720;
/** A container whose svg fills it 1:1, so a client pixel IS a viewBox unit. */
function host(width = W) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width, height: 400 });
  document.body.appendChild(el);
  return el;
}
function draw(c, opts) {
  const svg = scatterChart(c, opts);
  if (svg) {
    const vb = (svg.getAttribute('viewBox') || '0 0 0 0').split(' ').map(Number);
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: vb[2], height: vb[3] });
    // linkedom has no SVGSVGElement.viewBox; charts.js falls back to 1:1.
  }
  return svg;
}
const all = (root, sel) => Array.from(root.querySelectorAll(sel));
const num = (el, attr) => Number(el.getAttribute(attr));
const dots = (svg) => all(svg, 'circle.ff-dot');
const fire = (el, type, props = {}) => {
  const e = new window.Event(type, { bubbles: true });
  Object.assign(e, { pointerType: 'mouse', clientX: 0, clientY: 0 }, props);
  el.dispatchEvent(e);
};
const tipOf = (c) => c.querySelector('.ff-scatter-tip');
const open = (c) => { const t = tipOf(c); return !!t && !t.hasAttribute('hidden'); };

// ============================================================ leastSquares
{
  // BY HAND. (1,2) (2,3) (3,5) (4,4): mean x 2.5, mean y 3.5.
  //   Sxx = 2.25 + .25 + .25 + 2.25 = 5
  //   Sxy = 2.25 + .25 + .75 + .75  = 4
  //   Syy = 2.25 + .25 + 2.25 + .25 = 5
  //   slope 4/5 = 0.8, intercept 3.5 - 0.8*2.5 = 1.5, r = 4/sqrt(25) = 0.8
  const f = leastSquares([{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 5 }, { x: 4, y: 4 }]);
  ok(f && typeof f === 'object', 'four points give a fit');
  close(f.slope, 0.8, 1e-12, 'slope, by hand');
  close(f.intercept, 1.5, 1e-12, 'intercept, by hand');
  close(f.r, 0.8, 1e-12, 'r, by hand');
  close(f.r2, 0.64, 1e-12, 'r squared, by hand: 0.8 × 0.8');
  eq(f.n, 4, 'n counts the points used');

  const perfect = leastSquares([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  close(perfect.slope, 1, 1e-12, 'two points on y = x: slope 1');
  close(perfect.intercept, 0, 1e-12, 'and intercept 0');
  close(perfect.r, 1, 1e-12, 'and r = 1');
  close(perfect.r2, 1, 1e-12, 'and R² = 1: every point is on the line');
  eq(perfect.n, 2, 'two points is enough');

  const down = leastSquares([{ x: 0, y: 10 }, { x: 10, y: 0 }]);
  close(down.slope, -1, 1e-12, 'a falling line has a negative slope');
  close(down.intercept, 10, 1e-12, 'and its own intercept');
  close(down.r, -1, 1e-12, 'and r = -1');
  close(down.r2, 1, 1e-12, 'whose square is still 1 — R² has no sign');

  // The refusals.
  eq(leastSquares([]), null, 'no points: null');
  eq(leastSquares([{ x: 3, y: 4 }]), null, 'one point: null');
  eq(leastSquares([{ x: 3, y: 1 }, { x: 3, y: 9 }]), null, 'zero x-variance: null (a vertical line has no slope)');
  eq(leastSquares(null), null, 'rubbish in: null');

  // A flat cloud has a slope (0) but no correlation to speak of.
  const flat = leastSquares([{ x: 1, y: 5 }, { x: 2, y: 5 }, { x: 9, y: 5 }]);
  close(flat.slope, 0, 1e-12, 'every y equal: slope 0');
  close(flat.intercept, 5, 1e-12, 'intercept is that y');
  eq(flat.r, null, 'and r is null, not NaN or 0 — there is no y-variance to correlate');
  eq(flat.r2, null, 'and so is R², never NaN');

  // Pairs with a missing half are skipped, not counted as zero.
  const holes = leastSquares([{ x: 1, y: 2 }, { x: NaN, y: 3 }, { x: 2, y: null }, { x: 3, y: 4 }]);
  eq(holes.n, 2, 'a pair missing either number is not a point');
  close(holes.slope, 1, 1e-12, 'and does not bend the line');
  close(holes.intercept, 1, 1e-12, 'nor move it');
}

// ============================================================ offPerfect
{
  // BY HAND. The four points above fit actual = 1.5 + 0.8 × projected. The gap
  // to y = x at each point's x is |1.5 + 0.8x − x| = |1.5 − 0.2x|:
  //   x = 1: 1.3   x = 2: 1.1   x = 3: 0.9   x = 4: 0.7      mean 4.0 / 4 = 1.0
  const four = [{ x: 1, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 5 }, { x: 4, y: 4 }];
  eq(typeof offPerfect, 'function', 'offPerfect is exported');
  close(offPerfect(four), 1.0, 1e-12, 'the mean gap to the perfect line, by hand');
  close(offPerfect(four, leastSquares(four)), 1.0, 1e-12, 'the same when handed the fit');
  close(offPerfect([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 4, y: 4 }]), 0, 1e-12,
    'a fit that IS y = x is 0 off perfect');
  // A line that CROSSES y = x: on y = 10 + 0.5x the gap is |10 − 0.5x|, which
  // is +10 at x = 0, −10 at x = 40 and −40 at x = 100. As distances that is
  // (10 + 10 + 40) / 3 = 20; signed they would cancel to −13.3, and a line
  // through the middle of the perfect one would read as "close".
  close(offPerfect([{ x: 0, y: 10 }, { x: 40, y: 30 }, { x: 100, y: 60 }]), 20, 1e-9,
    'gaps either side of the perfect line add up, they do not cancel');
  // Averaged over the DOTS: two more dots at x = 0 pull it to (10×3 + 10 + 40) / 5.
  close(offPerfect([{ x: 0, y: 10 }, { x: 0, y: 10 }, { x: 0, y: 10 }, { x: 40, y: 30 }, { x: 100, y: 60 }]),
    16, 1e-9, 'and it is averaged over the dots, not along the axis');
  eq(offPerfect([]), null, 'no points: null, never NaN');
  eq(offPerfect([{ x: 3, y: 4 }]), null, 'one point: no line, so null');
  eq(offPerfect([{ x: 3, y: 1 }, { x: 3, y: 9 }]), null, 'no slope: null');
  eq(offPerfect(null), null, 'rubbish in: null');
}

// ============================================================ scatterChart
// --- refusals ---------------------------------------------------------------
{
  eq(scatterChart(null, { points: [] }), null, 'no container, no chart');
  const c = host();
  const svg = draw(c, { points: [], empty: 'No finished weeks yet' });
  ok(svg && /No finished weeks yet/.test(svg.getAttribute('aria-label') || ''),
    'no points draws the caller\'s STATED empty state, not an empty box');
  eq(dots(svg).length, 0, 'and no dots');
  const c2 = host();
  const svg2 = draw(c2, { points: [{ x: null, y: 4 }, { x: 3, y: NaN }] });
  ok(/No data to chart/.test(svg2.getAttribute('aria-label') || ''),
    'points with a missing half are not points, and then there is no chart');
}

// --- dots from the data, ONE scale on both axes ----------------------------
{
  const c = host();
  const svg = draw(c, {
    points: [
      { x: 0, y: 0, name: 'A' }, { x: 100, y: 100, name: 'B' },
      { x: 50, y: 50, name: 'C' }, { x: 100, y: 0, name: 'D' },
    ],
    xLabel: 'Projected', yLabel: 'Actual',
  });
  const d = dots(svg);
  eq(d.length, 4, 'one dot per point');
  const [a, b, m, r] = d.map((el) => ({ x: num(el, 'cx'), y: num(el, 'cy') }));
  ok(b.x > a.x, 'x grows to the right');
  ok(b.y < a.y, 'y grows UP the screen');
  close(m.x, (a.x + b.x) / 2, 0.11, '50 sits halfway across');
  close(m.y, (a.y + b.y) / 2, 0.11, 'and halfway up');
  close(r.x, b.x, 0.11, '(100, 0) shares its x with (100, 100)');
  close(r.y, a.y, 0.11, 'and its y with (0, 0)');

  // The perfect line: dotted, and corner to corner of the SAME domain.
  const perfect = all(svg, 'line.ff-perfect');
  eq(perfect.length, 1, 'one perfect-projection line');
  ok(/\d/.test(perfect[0].getAttribute('stroke-dasharray') || ''), 'and it is DOTTED');
  close(num(perfect[0], 'x1'), a.x, 0.11, 'it starts on the (0, 0) dot');
  close(num(perfect[0], 'y1'), a.y, 0.11, '…exactly');
  close(num(perfect[0], 'x2'), b.x, 0.11, 'and ends on the (100, 100) dot');
  close(num(perfect[0], 'y2'), b.y, 0.11, '…exactly');

  const fit = all(svg, 'line.ff-fit');
  eq(fit.length, 1, 'one fitted line');
  ok(!fit[0].getAttribute('stroke-dasharray'), 'and it is SOLID');

  const t = all(svg, 'text').map((n) => (n.textContent || '').trim());
  ok(t.includes('Projected') && t.includes('Actual'), 'both axes are labelled', t.join('|'));
  ok(t.includes('Perfect projection') && t.includes('Best-fit line'),
    'and both lines are named in the chart\'s own key', t.join('|'));
  // Same numbers along the bottom as up the side.
  const ticks = t.map(Number).filter((n, i) => t[i] !== '' && Number.isFinite(n));
  eq(ticks.filter((n) => n === 100).length, 2, 'the top of the scale is labelled on BOTH axes');
  eq(ticks.filter((n) => n === 0).length, 2, 'and so is the bottom');
}
{
  // Lopsided data: x runs 100–150, y runs 50–200. One domain, 50–200 (already
  // round, so the "nice" scale leaves it alone), serves both — or the dotted
  // line is not y = x.
  const c = host();
  const svg = draw(c, {
    points: [{ x: 100, y: 200 }, { x: 150, y: 50 }, { x: 125, y: 125 }],
  });
  const p = all(svg, 'line.ff-perfect')[0];
  const left = num(p, 'x1'), right = num(p, 'x2'), bottom = num(p, 'y1'), top = num(p, 'y2');
  const [hi, lo, mid] = dots(svg).map((el) => ({ x: num(el, 'cx'), y: num(el, 'cy') }));
  close(hi.y, top, 0.11, 'y = 200 is the top of the plot');
  close(lo.y, bottom, 0.11, 'y = 50 is the bottom');
  close(lo.x, left + (right - left) * (150 - 50) / 150, 0.11,
    'x = 150 is placed on the 50–200 scale too, not on its own 100–150');
  close(mid.x, left + (right - left) * 0.5, 0.11, '(125, 125) is halfway across');
  close(mid.y, (top + bottom) / 2, 0.11, 'and halfway up — on the dotted line');
}

// --- the fitted line is the least-squares line, drawn where it belongs ------
{
  // Three points exactly on y = 0.5x + 10. Domain 0–100.
  const c = host();
  const svg = draw(c, { points: [{ x: 0, y: 10 }, { x: 100, y: 60 }, { x: 40, y: 30 }] });
  const d = dots(svg).map((el) => ({ x: num(el, 'cx'), y: num(el, 'cy') }));
  const fit = all(svg, 'line.ff-fit')[0];
  close(num(fit, 'x1'), d[0].x, 0.11, 'the fit starts at x = 0');
  close(num(fit, 'y1'), d[0].y, 0.11, 'at y = 10, on the first dot');
  close(num(fit, 'x2'), d[1].x, 0.11, 'and ends at x = 100');
  close(num(fit, 'y2'), d[1].y, 0.11, 'at y = 60, on the second');
}
{
  // y = 3x - 100 through (40,20) (50,50) (60,80): domain 20–80, and at x = 20
  // the line is at -40. It must be CLIPPED to the plot, not drawn through the
  // axis labels.
  const c = host();
  const svg = draw(c, { points: [{ x: 40, y: 20 }, { x: 50, y: 50 }, { x: 60, y: 80 }] });
  const p = all(svg, 'line.ff-perfect')[0];
  const left = num(p, 'x1'), right = num(p, 'x2'), bottom = num(p, 'y1'), top = num(p, 'y2');
  const fit = all(svg, 'line.ff-fit')[0];
  ok(fit, 'a steep fit still draws');
  const ys = [num(fit, 'y1'), num(fit, 'y2')], xs = [num(fit, 'x1'), num(fit, 'x2')];
  ok(ys.every((y) => y >= top - 0.11 && y <= bottom + 0.11), 'and stays inside the plot, top to bottom', ys.join(','));
  ok(xs.every((x) => x >= left - 0.11 && x <= right + 0.11), 'and side to side', xs.join(','));
  // It leaves through the floor at x = 40 (y = 20) and the ceiling at x = 60.
  const d = dots(svg).map((el) => ({ x: num(el, 'cx'), y: num(el, 'cy') }));
  close(xs[0], d[0].x, 0.11, 'clipped at the floor where y = 20, i.e. x = 40');
  close(xs[1], d[2].x, 0.11, 'and at the ceiling where y = 80, i.e. x = 60');
}
{
  // No line where there is no line to fit — but the dots and y = x still draw.
  const one = draw(host(), { points: [{ x: 5, y: 7 }] });
  eq(dots(one).length, 1, 'one point is still a dot');
  eq(all(one, 'line.ff-fit').length, 0, 'with no fitted line');
  eq(all(one, 'line.ff-perfect').length, 1, 'and the perfect line regardless');
  const t1 = all(one, 'text').map((n) => (n.textContent || '').trim());
  ok(!t1.includes('Best-fit line'), 'and the key does not name a line that is not there');
  const vert = draw(host(), { points: [{ x: 5, y: 7 }, { x: 5, y: 9 }] });
  eq(all(vert, 'line.ff-fit').length, 0, 'zero x-variance: no fitted line either');
  ok(!/NaN|Infinity/.test(vert.outerHTML || ''), 'and nothing renders as NaN');
}

// --- highlight: on the key, painted last -----------------------------------
{
  const svg = draw(host(), {
    points: [
      { x: 1, y: 1, key: 7 }, { x: 2, y: 2, key: 9 }, { x: 3, y: 3, key: 7 },
    ],
    highlight: 9,
  });
  const d = dots(svg);
  const hi = d.filter((el) => /\bff-dot-hi\b/.test(el.getAttribute('class')));
  eq(hi.length, 1, 'exactly the highlighted key\'s dot is emphasised');
  eq(d[d.length - 1], hi[0], 'and it is painted last, over the rest');
  eq(hi[0].getAttribute('data-i'), '1', 'while still pointing at its own point');
  const none = draw(host(), { points: [{ x: 1, y: 1, key: 7 }, { x: 2, y: 2, key: 8 }], highlight: 'nobody' });
  eq(all(none, 'circle.ff-dot-hi').length, 0, 'an unknown highlight emphasises nothing');
}

// --- many dots: fast, and see-through --------------------------------------
{
  const pts = [];
  for (let i = 0; i < 2700; i++) pts.push({ x: (i * 37) % 45, y: (i * 91) % 52, name: 'P' + i, week: 1 + (i % 17) });
  const c = host();
  const t0 = Date.now();
  const svg = draw(c, { points: pts });
  const ms = Date.now() - t0;
  eq(dots(svg).length, 2700, 'a season of players is one dot each');
  ok(ms < 2000, 'drawn quickly', `${ms} ms`);
  const g = svg.querySelector('g.ff-dots');
  ok(g && Number(g.getAttribute('fill-opacity')) <= 0.5, 'and semi-transparent, so a pile-up reads as density',
    g ? g.getAttribute('fill-opacity') : 'no group');
  eq(all(svg, 'circle.ff-dot > title').length, 0, 'no per-dot <title>: 2,700 of them is markup nobody reads');
}

// --- the preview ------------------------------------------------------------
const POINTS = [
  { x: 12.34, y: 15.06, name: 'Sam Example', detail: 'RB · KC', week: 3, href: 'waivers.html?player=4242&week=3' },
  { x: 40, y: 2, name: 'Far Away', detail: 'QB · BUF', week: 9, href: 'waivers.html?player=7&week=9' },
];
{
  const c = host();
  const svg = draw(c, { points: POINTS });
  const [d0, d1] = dots(svg).map((el) => ({ x: num(el, 'cx'), y: num(el, 'cy') }));
  ok(!open(c), 'nothing is open before the pointer arrives');

  fire(svg, 'pointermove', { clientX: d0.x + 2, clientY: d0.y - 1 });
  ok(open(c), 'hovering a dot opens its preview');
  const tip = tipOf(c);
  eq(tip.tagName, 'A', 'the preview is a real link');
  eq(tip.getAttribute('href'), 'waivers.html?player=4242&week=3', 'to that performance');
  const text = tip.textContent.replace(/\s+/g, ' ');
  ok(/Sam Example/.test(text), 'it names the player', text);
  ok(/RB · KC/.test(text), 'with his position and team', text);
  ok(/Week 3/.test(text), 'and the week', text);
  ok(/Proj 12\.3 · Actual 15\.1/.test(text), 'and both numbers, to a tenth', text);
  ok(/absolute/.test(tip.getAttribute('style') || ''), 'it is an overlay, so nothing under it moves');

  // Off the dot, towards the preview: it must NOT vanish on the way.
  fire(svg, 'pointermove', { clientX: d0.x + 60, clientY: d0.y - 60 });
  ok(open(c), 'leaving the dot does not close the preview at once');
  fire(svg, 'pointerleave', {});
  fire(tip, 'pointerenter', {});
  await sleep(700);
  ok(open(c), 'and it stays open while the pointer is on it');
  eq(tipOf(c).getAttribute('href'), 'waivers.html?player=4242&week=3', 'still the same performance');
  fire(tip, 'pointerleave', {});
  await sleep(700);
  ok(!open(c), 'leaving the preview closes it');

  // Leaving the chart without going to the preview closes it too.
  fire(svg, 'pointermove', { clientX: d1.x, clientY: d1.y });
  ok(open(c), 'the other dot opens');
  eq(tipOf(c).getAttribute('href'), 'waivers.html?player=7&week=9', 'on its own link');
  fire(svg, 'pointerleave', {});
  await sleep(700);
  ok(!open(c), 'and closes once the pointer has gone');

  // Nowhere near a dot: nothing.
  fire(svg, 'pointermove', { clientX: (d0.x + d1.x) / 2, clientY: (d0.y + d1.y) / 2 });
  ok(!open(c), 'empty plot opens nothing');
  eq(all(c, '.ff-scatter-tip').length, 1, 'one preview element per chart, reused');
}
{
  // A FINGER. No hover exists; the tap is the pointerdown, and the pointerleave
  // that follows a lifted finger must not take the preview away again.
  const c = host();
  const svg = draw(c, { points: POINTS });
  const [d0] = dots(svg).map((el) => ({ x: num(el, 'cx'), y: num(el, 'cy') }));
  fire(svg, 'pointerdown', { pointerType: 'touch', clientX: d0.x + 9, clientY: d0.y + 9 });
  ok(open(c), 'a tap near a dot opens its preview');
  fire(svg, 'pointerup', { pointerType: 'touch' });
  fire(svg, 'pointerleave', { pointerType: 'touch' });
  await sleep(700);
  ok(open(c), 'and it is still there to be tapped after the finger lifts');
  fire(document.body, 'pointerdown', { pointerType: 'touch', clientX: 5, clientY: 900 });
  ok(!open(c), 'a tap somewhere else on the page puts it away');
}
{
  // A team dot: no detail line, an Analysis link.
  const c = host();
  const svg = draw(c, {
    points: [{ x: 110, y: 131.5, name: 'Tim', week: 2, href: 'analysis.html?team=4&week=2#rosterDetail' },
      { x: 90, y: 80, name: 'Other', week: 2 }],
  });
  const [d0, d1] = dots(svg).map((el) => ({ x: num(el, 'cx'), y: num(el, 'cy') }));
  fire(svg, 'pointerdown', { pointerType: 'touch', clientX: d0.x, clientY: d0.y });
  eq(tipOf(c).getAttribute('href'), 'analysis.html?team=4&week=2#rosterDetail', 'a team dot links to its roster and week');
  ok(/Proj 110\.0 · Actual 131\.5/.test(tipOf(c).textContent), 'with its own numbers', tipOf(c).textContent);
  // A point with no href must not carry the last dot's link.
  fire(svg, 'pointerdown', { pointerType: 'touch', clientX: d1.x, clientY: d1.y });
  ok(open(c) && /Other/.test(tipOf(c).textContent), 'a point with no link still previews');
  ok(!tipOf(c).hasAttribute('href'), 'and does not borrow the previous dot\'s link');
}
{
  // Untrusted names go in as text.
  const c = host();
  const nasty = '<script>alert(1)</script>" onload="x';
  const svg = draw(c, { points: [{ x: 1, y: 2, name: nasty, detail: nasty, week: 1, href: 'a.html' }, { x: 3, y: 4 }] });
  const d0 = dots(svg)[0];
  fire(svg, 'pointerdown', { clientX: num(d0, 'cx'), clientY: num(d0, 'cy') });
  eq(all(c, 'script').length, 0, 'a name cannot open an element of its own');
  const attrs = [];
  for (const el of all(c, '*')) for (const a of el.attributes || []) attrs.push(a.name);
  ok(!attrs.some((n) => /^on/i.test(n)), 'nor add an event handler', attrs.join(','));
  ok(tipOf(c).textContent.includes(nasty), 'and still reads back as written');
}
{
  // Re-rendering replaces the chart and its preview rather than stacking them.
  const c = host();
  draw(c, { points: POINTS });
  const svg = draw(c, { points: POINTS });
  eq(all(c, 'svg').length, 1, 'a second render replaces the first');
  eq(all(c, '.ff-scatter-tip').length, 1, 'and there is still one preview element');
  ok(svg && !open(c), 'which starts closed');
}

// ============================================================ groups
const chips = (c) => all(c, '.ff-scatter-legend button[data-group]');
const press = (el) => el.dispatchEvent(new window.Event('click', { bubbles: true }));
const GROUPS = [
  { key: 'QB', label: 'QB', color: SERIES_COLORS[6] },
  { key: 'RB', label: 'RB', color: SERIES_COLORS[9] },
  { key: 'WR', label: 'WR', color: SERIES_COLORS[0] },
  { key: 'TE', label: 'TE', color: SERIES_COLORS[1] },   // nobody below is a TE
];
// RB on y = x; QB on y = 2x; one WR. Far enough apart to aim at one dot.
const GPOINTS = [
  { x: 10, y: 10, group: 'RB', name: 'rb1', href: 'r1.html' },
  { x: 20, y: 40, group: 'QB', name: 'qb1', href: 'q1.html' },
  { x: 30, y: 30, group: 'RB', name: 'rb2', href: 'r2.html' },
  { x: 40, y: 80, group: 'QB', name: 'qb2', href: 'q2.html' },
  { x: 50, y: 50, group: 'RB', name: 'rb3', href: 'r3.html' },
  { x: 70, y: 20, group: 'WR', name: 'wr1', href: 'w1.html' },
];
const lineOf = (svg, sel) => {
  const l = all(svg, sel)[0];
  return l ? ['x1', 'y1', 'x2', 'y2'].map((a) => l.getAttribute(a)).join(',') : null;
};
const byI = (svg) => {
  const m = [];
  for (const el of dots(svg)) m[Number(el.getAttribute('data-i'))] = el;
  return m;
};
const xy = (el) => ({ x: num(el, 'cx'), y: num(el, 'cy') });

// --- default: no grouping draws exactly what it drew before ------------------
{
  const plain = draw(host(), { points: GPOINTS.map(({ group, ...p }) => p) });
  eq(all(plain.parentNode, '.ff-scatter-legend').length, 0, 'no groups: no legend');
  eq(all(plain, 'circle.ff-dot-dim').length, 0, 'and no dimmed dots');
  ok(dots(plain).every((el) => !el.hasAttribute('fill')), 'and every dot takes the one base colour');
  eq(plain.querySelector('g.ff-dots').getAttribute('fill-opacity'), '0.7', 'at the opacity it always had');
  // Points that carry a group but a chart given no groups: still the plain chart.
  const same = draw(host(), { points: GPOINTS, groups: [], focus: 'RB' });
  eq(same.outerHTML, plain.outerHTML, 'an empty group list (and a focus with nothing to focus) changes nothing');
}

// --- colourised --------------------------------------------------------------
{
  const c = host();
  const svg = draw(c, { points: GPOINTS, groups: GROUPS, groupLabel: 'Position' });
  const d = byI(svg);
  GPOINTS.forEach((p, i) => {
    const want = GROUPS.find((g) => g.key === p.group).color;
    eq(d[i].getAttribute('fill'), want, `dot ${p.name} takes its group's colour`);
  });
  eq(d[0].getAttribute('fill'), SERIES_COLORS[9], 'RB is the same slot whoever else is plotted');
  eq(all(svg, 'circle.ff-dot-dim').length, 0, 'colouring alone dims nothing');
  const ch = chips(c);
  eq(ch.map((b) => b.getAttribute('data-group')).join(','), 'QB,RB,WR',
    'the legend lists exactly the groups that own a dot, in the caller\'s order (no TE)');
  eq(ch.map((b) => b.textContent.trim()).join(','), 'QB,RB,WR', 'each chip carries its label');
  ok(ch.every((b) => b.tagName === 'BUTTON' && b.getAttribute('aria-pressed') === 'false'),
    'chips are buttons, none pressed');
  ok(ch.every((b, i) => (b.querySelector('.ff-chip-sw').getAttribute('style') || '')
    .includes(GROUPS[i].color)), 'and each shows its colour');
  eq(c.querySelector('.ff-scatter-legend').getAttribute('aria-label'), 'Position', 'the row is named');
  ok(!svg.contains(c.querySelector('.ff-scatter-legend')), 'the legend sits outside the svg: it is not the chart');
  // The fit is every dot's until something is focused.
  const fit = leastSquares(GPOINTS);
  close(svg.__ffFit.slope, fit.slope, 1e-12, 'unfocused, the line is fitted to every dot');
  eq(svg.__ffFitPoints.length, 6, 'all six of them');
  close(svg.__ffGap, offPerfect(GPOINTS), 1e-12, 'and the gap to perfect is theirs');

  // A label is untrusted text.
  const c2 = host();
  const nasty = '<img src=x onerror=alert(1)>';
  draw(c2, { points: [{ x: 1, y: 2, group: 'a' }, { x: 3, y: 5, group: 'a' }], groups: [{ key: 'a', label: nasty, color: 'red' }] });
  eq(all(c2, 'img').length, 0, 'a group label cannot open an element');
  ok(chips(c2)[0].textContent.includes(nasty), 'and reads back as written');
}

// --- highlight one -----------------------------------------------------------
{
  const c = host();
  const seen = [];
  const first = draw(c, {
    points: GPOINTS, groups: GROUPS,
    onFocus: (key, svg) => seen.push([key, svg]),
    navigate: () => {},
  });
  const perfect0 = lineOf(first, 'line.ff-perfect');
  const fit0 = lineOf(first, 'line.ff-fit');
  const place0 = dots(first).map((el) => `${el.getAttribute('data-i')}:${el.getAttribute('cx')},${el.getAttribute('cy')}`).sort().join(' ');

  press(chips(c).find((b) => b.getAttribute('data-group') === 'RB'));
  const svg = c.querySelector('svg');
  eq(seen.length, 1, 'pressing a chip tells the caller once');
  eq(seen[0] && seen[0][0], 'RB', 'which group is focused');
  eq(seen[0] && seen[0][1], svg, 'and hands over the redrawn chart');
  eq(all(c, 'svg').length, 1, 'still one chart');
  eq(chips(c).map((b) => `${b.getAttribute('data-group')}=${b.getAttribute('aria-pressed')}`).join(' '),
    'QB=false RB=true WR=false', 'the pressed chip says so (aria-pressed)');

  const d = byI(svg);
  const dimmed = (el) => /\bff-dot-dim\b/.test(el.getAttribute('class'));
  eq(GPOINTS.map((p, i) => (dimmed(d[i]) ? 'dim' : 'on')).join(','), 'on,dim,on,dim,on,dim',
    'the focused group keeps its dots; every other dot is dimmed');
  ok([0, 2, 4].every((i) => d[i].getAttribute('fill') === SERIES_COLORS[9]), 'the focused dots keep their colour');
  ok([1, 3, 5].every((i) => d[i].getAttribute('fill') !== GROUPS[0].color && d[i].getAttribute('fill') !== GROUPS[2].color),
    'the dimmed ones lose theirs');
  ok([1, 3, 5].every((i) => Number(d[i].getAttribute('fill-opacity')) <= 0.2), 'and fade into the background');
  const order = dots(svg).map(dimmed);
  eq(order.lastIndexOf(true) < order.indexOf(false), true, 'dimmed dots are painted first, under the focused ones');
  const place1 = dots(svg).map((el) => `${el.getAttribute('data-i')}:${el.getAttribute('cx')},${el.getAttribute('cy')}`).sort().join(' ');
  eq(place1, place0, 'no dot moves: the axes are still fitted to every dot');
  eq(lineOf(svg, 'line.ff-perfect'), perfect0, 'the dotted perfect line never changes');

  // The solid line is the focused group's own: RB sit exactly on y = x.
  close(svg.__ffFit.slope, 1, 1e-12, 'the solid line is refitted to the focused dots: slope 1');
  close(svg.__ffFit.intercept, 0, 1e-9, 'intercept 0');
  eq(svg.__ffFit.n, 3, 'from three dots');
  eq(svg.__ffFitPoints.length, 3, 'which the chart hands back');
  close(svg.__ffGap, 0, 1e-9, 'and on y = x it is 0 off perfect');
  ok(lineOf(svg, 'line.ff-fit') !== fit0, 'so the drawn line moved');
  eq(lineOf(svg, 'line.ff-fit'), perfect0.split(',').join(','), 'onto the diagonal');

  // A dimmed dot cannot be previewed, by hover or by tap.
  const q = xy(d[3]);             // qb2 at (40, 80): nothing focused within reach
  fire(svg, 'pointermove', { clientX: q.x, clientY: q.y });
  ok(!open(c), 'hovering a dimmed dot opens nothing');
  fire(svg, 'pointerdown', { pointerType: 'touch', clientX: q.x, clientY: q.y });
  ok(!open(c), 'nor does tapping it');
  const r = xy(d[2]);
  fire(svg, 'pointermove', { clientX: r.x, clientY: r.y });
  ok(open(c) && /rb2/.test(tipOf(c).textContent), 'a focused dot still previews');

  // Pressing the same chip again clears the focus.
  press(chips(c).find((b) => b.getAttribute('data-group') === 'RB'));
  const back = c.querySelector('svg');
  eq(seen.length, 2, 'pressing it again tells the caller again');
  eq(seen[1] && seen[1][0], null, 'that nothing is focused');
  eq(all(back, 'circle.ff-dot-dim').length, 0, 'and every dot is back');
  ok(chips(c).every((b) => b.getAttribute('aria-pressed') === 'false'), 'no chip pressed');
  eq(lineOf(back, 'line.ff-fit'), fit0, 'the line is every dot\'s again');
  const q2 = xy(byI(back)[3]);
  fire(back, 'pointermove', { clientX: q2.x, clientY: q2.y });
  ok(open(c) && /qb2/.test(tipOf(c).textContent), 'and the dot that was dimmed previews again');

  // Another chip moves the focus rather than adding to it.
  press(chips(c).find((b) => b.getAttribute('data-group') === 'RB'));
  press(chips(c).find((b) => b.getAttribute('data-group') === 'QB'));
  eq(chips(c).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-group')).join(','),
    'QB', 'one group is focused at a time');
  close(c.querySelector('svg').__ffFit.slope, 2, 1e-12, 'and the line follows it (QB sit on y = 2x)');
  // (20,40) and (40,80) on y = 2x: gap to y = x is x itself, mean 30.
  close(c.querySelector('svg').__ffGap, 30, 1e-9, 'as does the gap to perfect, by hand');

  // A focus the caller passes in is honoured; one that names no group is not.
  const pre = draw(host(), { points: GPOINTS, groups: GROUPS, focus: 'WR' });
  eq(all(pre, 'circle.ff-dot-dim').length, 5, 'opts.focus focuses on the first draw');
  eq(pre.__ffFit, null, 'one focused dot has no line');
  eq(pre.__ffGap, null, 'and no gap — null, not NaN');
  eq(all(pre, 'line.ff-fit').length, 0, 'so none is drawn');
  const bad = draw(host(), { points: GPOINTS, groups: GROUPS, focus: 'TE' });
  eq(all(bad, 'circle.ff-dot-dim').length, 0, 'a focus on a group with no dots dims nothing');
}

// --- 2,700 dots, one group focused: only that group is searched --------------
{
  const pts = [];
  for (let i = 0; i < 2700; i++) pts.push({ x: (i * 37) % 45, y: (i * 91) % 52, name: 'P' + i, group: i % 17, href: `p${i}.html` });
  const groups = [];
  for (let w = 0; w < 17; w++) groups.push({ key: w, label: `Wk ${w + 1}`, color: SERIES_COLORS[w % 10] });
  const c = host();
  const svg = draw(c, { points: pts, groups, focus: 4 });
  eq(chips(c).length, 17, 'a chip per week');
  eq(dots(svg).length - all(svg, 'circle.ff-dot-dim').length, pts.filter((p) => p.group === 4).length,
    'only the focused week stays lit');
  // Sweep the whole plot: whatever opens is in the focused group.
  let opened = 0, wrong = 0;
  for (const el of dots(svg)) {
    const at = xy(el);
    fire(svg, 'pointerdown', { pointerType: 'touch', clientX: at.x, clientY: at.y });
    if (!open(c)) continue;
    opened++;
    const m = /^P(\d+)/.exec(tipOf(c).textContent);
    if (!m || Number(m[1]) % 17 !== 4) wrong++;
  }
  ok(opened > 0, 'taps across the plot do open previews', String(opened));
  eq(wrong, 0, 'and never one for a dimmed dot');
}

// ============================================================ any click goes
{
  // A MOUSE: the hover previews; a click anywhere on the chart follows it.
  const c = host();
  const went = [];
  const svg = draw(c, { points: POINTS, navigate: (href) => went.push(href) });
  const [d0, d1] = dots(svg).map(xy);
  const empty = { clientX: (d0.x + d1.x) / 2, clientY: (d0.y + d1.y) / 2 };

  fire(svg, 'pointerdown', empty);
  fire(svg, 'click', empty);
  eq(went.length, 0, 'with nothing previewed a click on the chart goes nowhere');

  fire(svg, 'pointermove', { clientX: d0.x, clientY: d0.y });
  ok(open(c), 'hovering previews');
  eq(went.length, 0, 'and a hover alone goes nowhere');
  fire(svg, 'pointermove', empty);                 // off the dot, preview still up
  fire(svg, 'pointerdown', empty);
  fire(svg, 'click', empty);
  eq(went.join('|'), 'waivers.html?player=4242&week=3',
    'a click on EMPTY chart, away from the dot and the preview box, follows the previewed dot');

  // …and on the dot itself.
  went.length = 0;
  fire(svg, 'pointermove', { clientX: d1.x, clientY: d1.y });
  await sleep(200);
  fire(svg, 'pointerdown', { clientX: d1.x, clientY: d1.y });
  fire(svg, 'click', { clientX: d1.x, clientY: d1.y });
  eq(went.join('|'), 'waivers.html?player=7&week=9', 'a click on the dot follows that dot');

  // The press holds the preview: it cannot time out between press and click.
  went.length = 0;
  fire(svg, 'pointermove', { clientX: d0.x, clientY: d0.y });
  await sleep(200);
  fire(svg, 'pointermove', empty);                 // starts the 350 ms put-away
  fire(svg, 'pointerdown', empty);
  await sleep(600);
  fire(svg, 'click', empty);
  eq(went.join('|'), 'waivers.html?player=4242&week=3', 'a slow click still lands on what was previewed');

  // Once the preview has gone, the chart is not a link any more.
  went.length = 0;
  fire(svg, 'pointerleave', {});
  await sleep(700);
  ok(!open(c), 'the preview has timed out');
  fire(svg, 'pointerdown', empty);
  fire(svg, 'click', empty);
  eq(went.length, 0, 'so a click goes nowhere');

  // The preview is still a real link for keyboards and "open in new tab".
  fire(svg, 'pointermove', { clientX: d0.x, clientY: d0.y });
  eq(tipOf(c).tagName, 'A', 'the preview is still an <a>');
  eq(tipOf(c).getAttribute('href'), 'waivers.html?player=4242&week=3', 'with its own href');
}
{
  // A FINGER: tap selects; the next tap anywhere goes; another dot switches.
  const c = host();
  const went = [];
  const svg = draw(c, { points: POINTS, navigate: (href) => went.push(href) });
  const [d0, d1] = dots(svg).map(xy);
  const empty = { pointerType: 'touch', clientX: (d0.x + d1.x) / 2, clientY: (d0.y + d1.y) / 2 };
  const tapAt = (at) => {
    fire(svg, 'pointerdown', { pointerType: 'touch', ...at });
    fire(svg, 'pointerup', { pointerType: 'touch', ...at });
    fire(svg, 'click', { pointerType: 'touch', ...at });
  };

  tapAt(empty);
  eq(went.length, 0, 'a tap on empty chart with nothing selected goes nowhere');
  ok(!open(c), 'and opens nothing');

  tapAt({ clientX: d0.x + 6, clientY: d0.y + 6 });
  ok(open(c) && /Sam Example/.test(tipOf(c).textContent), 'the first tap on a dot selects it');
  eq(went.length, 0, 'and does NOT navigate — the click that ends that same tap is not a second tap');

  tapAt({ clientX: d1.x, clientY: d1.y });
  ok(open(c) && /Far Away/.test(tipOf(c).textContent), 'a tap on a DIFFERENT dot switches the selection');
  eq(went.length, 0, 'and does not navigate');

  tapAt({ clientX: d0.x, clientY: d0.y });
  ok(/Sam Example/.test(tipOf(c).textContent), 'and back again');
  eq(went.length, 0, 'still without navigating');

  tapAt(empty);
  eq(went.join('|'), 'waivers.html?player=4242&week=3', 'the next tap ANYWHERE on the chart follows the selected dot');

  went.length = 0;
  tapAt({ clientX: d0.x, clientY: d0.y });
  eq(went.join('|'), 'waivers.html?player=4242&week=3', 'and so does a second tap on the selected dot itself');

  // A tap outside the chart dismisses, and then the chart is inert again.
  went.length = 0;
  fire(document.body, 'pointerdown', { pointerType: 'touch', clientX: 5, clientY: 900 });
  ok(!open(c), 'a tap outside the chart dismisses the selection');
  tapAt(empty);
  eq(went.length, 0, 'after which a tap on the chart goes nowhere');

  // A selected dot with no link has nowhere to go.
  const c2 = host();
  const went2 = [];
  const svg2 = draw(c2, { points: [{ x: 1, y: 1, name: 'No link' }, { x: 9, y: 9, name: 'b' }], navigate: (h) => went2.push(h) });
  const e0 = xy(dots(svg2)[0]);
  fire(svg2, 'pointerdown', { pointerType: 'touch', clientX: e0.x, clientY: e0.y });
  fire(svg2, 'click', { pointerType: 'touch', clientX: e0.x, clientY: e0.y });
  fire(svg2, 'pointerdown', { pointerType: 'touch', clientX: e0.x, clientY: e0.y });
  fire(svg2, 'click', { pointerType: 'touch', clientX: e0.x, clientY: e0.y });
  eq(went2.length, 0, 'a dot without an href never navigates');
}
{
  // The chips are not the chart: pressing one never follows a selected dot.
  const c = host();
  const went = [];
  const svg = draw(c, { points: GPOINTS, groups: GROUPS, navigate: (href) => went.push(href) });
  const at = xy(byI(svg)[0]);
  fire(svg, 'pointerdown', { pointerType: 'touch', clientX: at.x, clientY: at.y });
  fire(svg, 'click', { pointerType: 'touch', clientX: at.x, clientY: at.y });
  ok(open(c), 'a dot is selected');
  const chip = chips(c)[0];
  fire(chip, 'pointerdown', { pointerType: 'touch' });
  ok(!open(c), 'a press on a chip is a press outside the chart: the selection goes');
  press(chip);
  eq(went.length, 0, 'and the chip press does not navigate');
  eq(chips(c)[0].getAttribute('aria-pressed'), 'true', 'it focuses its group instead');
}
{
  // Without a `navigate` hook the page itself is sent there.
  const c = host();
  const svg = draw(c, { points: POINTS });
  const d0 = xy(dots(svg)[0]);
  const had = window.location;
  window.location = { href: 'about:blank' };
  fire(svg, 'pointermove', { clientX: d0.x, clientY: d0.y });
  fire(svg, 'pointerdown', { clientX: d0.x + 80, clientY: d0.y - 50 });
  fire(svg, 'click', { clientX: d0.x + 80, clientY: d0.y - 50 });
  eq(window.location.href, 'waivers.html?player=4242&week=3', 'the default navigation sets the page\'s location');
  window.location = had;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
