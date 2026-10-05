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
// Run:  node scatter-check.mjs

import { parseHTML } from 'linkedom';
import { leastSquares, scatterChart } from '../js/charts.js';

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
  eq(f.n, 4, 'n counts the points used');

  const perfect = leastSquares([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
  close(perfect.slope, 1, 1e-12, 'two points on y = x: slope 1');
  close(perfect.intercept, 0, 1e-12, 'and intercept 0');
  close(perfect.r, 1, 1e-12, 'and r = 1');
  eq(perfect.n, 2, 'two points is enough');

  const down = leastSquares([{ x: 0, y: 10 }, { x: 10, y: 0 }]);
  close(down.slope, -1, 1e-12, 'a falling line has a negative slope');
  close(down.intercept, 10, 1e-12, 'and its own intercept');
  close(down.r, -1, 1e-12, 'and r = -1');

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

  // Pairs with a missing half are skipped, not counted as zero.
  const holes = leastSquares([{ x: 1, y: 2 }, { x: NaN, y: 3 }, { x: 2, y: null }, { x: 3, y: 4 }]);
  eq(holes.n, 2, 'a pair missing either number is not a point');
  close(holes.slope, 1, 1e-12, 'and does not bend the line');
  close(holes.intercept, 1, 1e-12, 'nor move it');
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
  fire(svg, 'pointerdown', { pointerType: 'touch', clientX: d0.x + 150, clientY: d0.y - 100 });
  ok(!open(c), 'a tap on empty plot puts it away');
}
{
  // A team dot: no detail line, an Analysis link.
  const c = host();
  const svg = draw(c, {
    points: [{ x: 110, y: 131.5, name: 'Tim', week: 2, href: 'analysis.html?team=4&week=2#rosterDetail' },
      { x: 90, y: 80, name: 'Other', week: 2 }],
  });
  const [d0, d1] = dots(svg).map((el) => ({ x: num(el, 'cx'), y: num(el, 'cy') }));
  fire(svg, 'pointerdown', { clientX: d0.x, clientY: d0.y });
  eq(tipOf(c).getAttribute('href'), 'analysis.html?team=4&week=2#rosterDetail', 'a team dot links to its roster and week');
  ok(/Proj 110\.0 · Actual 131\.5/.test(tipOf(c).textContent), 'with its own numbers', tipOf(c).textContent);
  // A point with no href must not carry the last dot's link.
  fire(svg, 'pointerdown', { clientX: d1.x, clientY: d1.y });
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
