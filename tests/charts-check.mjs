// js/charts.js — the hand-written inline-SVG charts, on their own (AUDIT §3.6).
//
// 967 lines, four exports, imported by no test until 2026-09-22: every chart on
// the site was only ever checked as a page effect, so a chart that drew nothing
// (or drew the wrong team in the wrong colour) failed nothing here.
//
// What is asserted is the part a reader depends on and a refactor can silently
// lose: that the marks exist and are placed from the DATA, that identity is
// never carried by hue alone (every mark carries a <title> naming it), that a
// highlight matches on the caller's ID and not on a name two managers can share
// (rule 9), that untrusted names are escaped into the markup, and that each
// chart's refusals draw a stated empty state instead of an empty box.
//
// Run:  node charts-check.mjs

import { parseHTML } from 'linkedom';
import { SERIES_COLORS, lineChart, histogram, boxPlot } from '../js/charts.js';

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

// ---------------------------------------------------------------- the harness
const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
globalThis.window = window;
globalThis.document = document;
globalThis.Event = window.Event;
// charts.js only asks for `position`, and only to decide whether it must set
// position:relative itself.
globalThis.getComputedStyle = () => ({ position: 'relative', getPropertyValue: () => '' });

const ros = [];
globalThis.ResizeObserver = class {
  constructor(cb) { this.cb = cb; this.observed = 0; this.disconnected = 0; ros.push(this); }
  observe() { this.observed++; }
  unobserve() {}
  disconnect() { this.disconnected++; }
};

/** A container with a real clientWidth, since that is what sets the viewBox. */
function host(width = 720) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: width, configurable: true });
  document.body.appendChild(el);
  return el;
}

const all = (root, sel) => Array.from(root.querySelectorAll(sel));
const texts = (root, sel) => all(root, sel).map((n) => (n.textContent || '').trim());
/** What a <text> element actually DRAWS: its own text nodes, not a nested <title>. */
const drawn = (el) => Array.from(el.childNodes)
  .filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
const num = (el, attr) => Number(el.getAttribute(attr));

// The harness must be able to draw one chart, or nothing below means anything.
{
  const c = host();
  const svg = lineChart(c, { series: [{ name: 'A', values: [1, 2, 3] }] });
  ok(svg && svg.tagName.toLowerCase() === 'svg', 'harness: lineChart mounts an <svg>');
  eq(all(c, 'svg').length, 1, 'harness: exactly one svg in the container');
}

// ============================================================== the palette
{
  eq(SERIES_COLORS.length, 10, 'ten categorical slots');
  const hexes = SERIES_COLORS.map((s) => (s.match(/#[0-9a-fA-F]{6}/) || [''])[0]);
  ok(hexes.every(Boolean), 'every slot names a 6-digit fallback hex', SERIES_COLORS.join(' '));
  eq(new Set(hexes).size, 10, 'and all ten fallbacks are different colours');
  const vars = SERIES_COLORS.map((s) => (s.match(/--series-\d+/) || [''])[0]);
  ok(vars.every(Boolean), 'every slot reads a --series-N custom property first');
  eq(new Set(vars).size, 10, 'and each reads its own');
  // Slots are assigned in fixed order and never cycled: series 1 -> slot 1,
  // which is the whole reason a team keeps its colour across the page.
  const c = host();
  lineChart(c, {
    series: [{ name: 'One', values: [1, 2] }, { name: 'Two', values: [3, 4] }],
  });
  const paths = all(c, 'path');
  eq(paths[0].getAttribute('stroke'), SERIES_COLORS[0], 'the first series takes slot 1');
  eq(paths[1].getAttribute('stroke'), SERIES_COLORS[1], 'the second takes slot 2');
}

// ============================================================== lineChart
// --- refusals ---------------------------------------------------------------
{
  eq(lineChart(null, { series: [] }), null, 'no container, no chart');
  const c = host();
  const svg = lineChart(c, { series: [] });
  ok(svg && /No data to chart/.test(svg.getAttribute('aria-label') || ''),
    'no series draws a STATED empty state, not an empty box');
  ok(/No data to chart/.test(c.textContent), 'and says so on the face of it');

  // A series of nothing but holes is not data.
  const c2 = host();
  const svg2 = lineChart(c2, { series: [{ name: 'A', values: [null, NaN, undefined] }] });
  ok(/No data to chart/.test(svg2.getAttribute('aria-label') || ''),
    'a series of nothing but holes is dropped, and then there is no chart');
}

// --- the marks come from the data ------------------------------------------
{
  const c = host(720);
  const svg = lineChart(c, {
    series: [
      { name: 'Alpha', values: [10, 20, 30] },
      { name: 'Beta', values: [30, 20, 10] },
    ],
    xLabels: ['W1', 'W2', 'W3'],
    yLabel: 'Points',
    height: 300,
  });
  eq(all(svg, 'path').length, 2, 'one path per series');
  const titles = all(svg, 'path > title').map((t) => t.textContent);
  ok(titles.includes('Alpha') && titles.includes('Beta'),
    'every line names itself in a <title> — identity is never hue alone', titles.join('|'));

  // Both series span 10..30, so the two lines must cross: Alpha's first point
  // is below Beta's first and above its last.
  const d = all(svg, 'path').map((p) => p.getAttribute('d'));
  const pts = (s) => s.slice(1).split(/[ML]/).filter(Boolean).map((p) => p.split(',').map(Number));
  const a = pts(d[0]), b = pts(d[1]);
  eq(a.length, 3, 'three points on the line');
  ok(a[0][1] > b[0][1], 'y is inverted: a smaller value is lower down the screen');
  close(a[0][0], b[0][0], 0.05, 'the two series share the same x for week 1');
  ok(a[2][0] > a[0][0], 'x advances across the weeks');
  close(a[1][1], (a[0][1] + a[2][1]) / 2, 0.6, '20 sits halfway between 10 and 30');

  // The x labels the caller gave, not 1..n.
  const t = texts(svg, 'text');
  ok(t.includes('W1') && t.includes('W3'), 'the caller\'s x labels are drawn', t.join('|'));
  ok(t.includes('Points'), 'and the y axis label');
  // The y axis is labelled in numbers that bracket the data.
  const ticks = t.map(Number).filter((n) => Number.isFinite(n));
  ok(Math.min(...ticks) <= 10 && Math.max(...ticks) >= 30,
    'the y ticks bracket the data', ticks.join(','));

  eq(all(svg, '.ff-legend-item').length, 2, 'two series get a legend');
  eq(all(svg, '.ff-overlay').length, 1, 'and a hover layer');
}
{
  // One series needs no legend; the line is the only thing on the chart.
  const c = host();
  const svg = lineChart(c, { series: [{ name: 'Solo', values: [1, 2] }] });
  eq(all(svg, '.ff-legend-item').length, 0, 'one series gets no legend');
}

// --- holes are gaps, not straight lines through missing data ---------------
{
  const c = host();
  const svg = lineChart(c, { series: [{ name: 'A', values: [1, 2, NaN, 4, 5] }] });
  const d = all(svg, 'path')[0].getAttribute('d');
  eq((d.match(/M/g) || []).length, 2, 'a hole breaks the path into two subpaths');
  ok(!/M[\d.,]+M/.test(d), 'and neither subpath is a lone moveto');
}
{
  // A run of one has no line to draw, so it becomes a dot — otherwise the value
  // would be invisible.
  const c = host();
  const svg = lineChart(c, { series: [{ name: 'A', values: [1, NaN, 5, NaN, 2] }] });
  eq(all(svg, 'path').length, 0, 'three isolated points draw no line at all');
  eq(all(svg, 'circle').length, 3, 'each becomes a dot instead');
  const ct = all(svg, 'circle > title').map((t) => t.textContent);
  ok(ct.every((x) => x === 'A'), 'and each dot names its series', ct.join('|'));
}

// --- the highlight matches on ID, not on a name two managers can share -----
{
  const c = host();
  const svg = lineChart(c, {
    series: [
      { id: 7, name: 'The Team', values: [1, 2, 3] },
      { id: 9, name: 'The Team', values: [3, 2, 1] },
    ],
    highlight: 9,
  });
  const ops = all(svg, 'path').map((p) => Number(p.getAttribute('opacity')));
  eq(ops.filter((o) => o === 1).length, 1, 'exactly one of two same-named series is emphasised');
  eq(ops.filter((o) => o < 0.5).length, 1, 'and exactly one is dimmed (rule 9: id, never label)');
  const front = all(svg, 'path').find((p) => Number(p.getAttribute('opacity')) === 1);
  eq(front ? front.getAttribute('stroke-width') : null, '2.5',
    'the emphasised line is drawn heavier');
  // Painted last, so it sits on top of what it is being compared with.
  const order = all(svg, 'path').map((p) => Number(p.getAttribute('opacity')));
  ok(order[order.length - 1] === 1, 'and painted last, over the dimmed one');
}
{
  const c = host();
  const svg = lineChart(c, {
    series: [{ id: 1, name: 'A', values: [1, 2] }, { id: 2, name: 'B', values: [2, 1] }],
    highlight: 'nobody',
  });
  const ops = all(svg, 'path').map((p) => Number(p.getAttribute('opacity')));
  ok(ops.every((o) => o === 1),
    'an unknown highlight emphasises nothing rather than dimming everything', ops.join(','));
}
{
  // Clicking a legend entry highlights that team; clicking it again clears it.
  const c = host();
  lineChart(c, {
    series: [{ id: 1, name: 'A', values: [1, 2] }, { id: 2, name: 'B', values: [2, 1] }],
  });
  // The legend entry is addressed by the series ID it carries, so a legend that
  // went back to keying on the name is a failure here rather than a crash.
  const legendFor = (key) => all(c, '.ff-legend-item')
    .find((g) => g.getAttribute('data-key') === key);
  ok(legendFor('2'), 'the legend carries each series id, not just its name',
    all(c, '.ff-legend-item').map((g) => g.getAttribute('data-key')).join('|'));
  if (legendFor('2')) legendFor('2').dispatchEvent(new window.Event('click', { bubbles: true }));
  let ops = all(c, 'path').map((p) => Number(p.getAttribute('opacity')));
  eq(ops.filter((o) => o < 0.5).length, 1, 'a legend click dims the other team');
  if (legendFor('2')) legendFor('2').dispatchEvent(new window.Event('click', { bubbles: true }));
  ops = all(c, 'path').map((p) => Number(p.getAttribute('opacity')));
  ok(ops.every((o) => o === 1), 'and clicking it again clears the highlight', ops.join(','));
}

// --- zeroLine and a pinned domain -----------------------------------------
{
  const cNo = host();
  const svgNo = lineChart(cNo, { series: [{ name: 'A', values: [5, 9] }] });
  const cYes = host();
  const svgYes = lineChart(cYes, { series: [{ name: 'A', values: [5, 9] }], zeroLine: true });
  const zero = (svg) => texts(svg, 'text').includes('0');
  ok(!zero(svgNo), 'without zeroLine the axis need not reach 0');
  ok(zero(svgYes), 'zeroLine pulls 0 into the domain so the sign is readable');
  ok(all(svgYes, 'line').length > all(svgNo, 'line').length,
    'and draws one extra reference rule');
}
{
  // Several charts sharing one axis: the domain ends are used EXACTLY as given,
  // because widening each to "nice" bounds would undo the sharing.
  const c = host();
  const svg = lineChart(c, { series: [{ name: 'A', values: [2, 4] }], yDomain: [0, 100] });
  const ticks = texts(svg, 'text').map(Number).filter(Number.isFinite);
  ok(Math.min(...ticks) >= 0 && Math.max(...ticks) <= 100,
    'no tick is drawn outside a caller-pinned domain', ticks.join(','));
  ok(ticks.includes(100), 'the pinned top is labelled');
}
{
  // Every value identical: the scale is padded rather than dividing by zero.
  const c = host();
  const svg = lineChart(c, { series: [{ name: 'A', values: [7, 7, 7] }] });
  const d = all(svg, 'path')[0].getAttribute('d');
  ok(/L/.test(d), 'a flat series still draws a line');
  ok(!/NaN/.test(c.innerHTML), 'and nothing anywhere renders as NaN');
}

// --- untrusted names -------------------------------------------------------
{
  const c = host();
  const nasty = '<script>alert(1)</script>" onload="x';
  const svg = lineChart(c, { series: [{ name: nasty, values: [1, 2] }], yLabel: nasty });
  eq(all(c, 'script').length, 0, 'a series name cannot open an element of its own');
  const attrs = [];
  for (const el of all(c, '*')) for (const a of el.attributes || []) attrs.push(a.name);
  ok(!attrs.some((n) => /^on/i.test(n)),
    'nor close an attribute and add an event handler', attrs.join(','));
  const title = all(svg, 'path > title')[0];
  eq(title ? title.textContent : null, nasty,
    'and it still reads back as the name the caller gave');
}

// --- re-rendering into the same container ---------------------------------
{
  const c = host();
  lineChart(c, { series: [{ name: 'A', values: [1, 2] }] });
  const first = ros[ros.length - 1];
  lineChart(c, { series: [{ name: 'A', values: [1, 2, 3] }] });
  eq(all(c, 'svg').length, 1, 'a second render replaces the first rather than stacking');
  eq(first.disconnected, 1, 'and the old width observer is disconnected, so there is no feedback loop');
  ok(ros[ros.length - 1] !== first && ros[ros.length - 1].observed === 1,
    'the new render observes the container itself');
}

// --- width -----------------------------------------------------------------
{
  const narrow = host(320);
  const wide = host(1200);
  const w = (c) => Number((c.querySelector('svg').getAttribute('viewBox') || '').split(' ')[2]);
  lineChart(narrow, { series: [{ name: 'A', values: [1, 2] }] });
  lineChart(wide, { series: [{ name: 'A', values: [1, 2] }] });
  eq(w(narrow), 320, 'a phone-width container gets a phone-width viewBox (1 unit = 1 CSS px)');
  eq(w(wide), 1200, 'and a laptop-width one gets its own');
  const tiny = host(50);
  lineChart(tiny, { series: [{ name: 'A', values: [1, 2] }] });
  eq(w(tiny), 280, 'below 280 the viewBox floors rather than collapsing');
}

// ============================================================== histogram
{
  const c = host();
  eq(histogram(null, {}), null, 'no container, no histogram');
  const empty = histogram(c, { bins: [], counts: [] });
  ok(/No data to chart/.test(empty.getAttribute('aria-label') || ''), 'no bins: stated empty state');

  const c2 = host();
  const zeros = histogram(c2, { bins: ['a', 'b'], counts: [0, 0] });
  ok(/No observations in range/.test(zeros.getAttribute('aria-label') || ''),
    'bins with nothing in them say SO — a flat axis would look like a drawn chart');
}
{
  const c = host(720);
  const svg = histogram(c, {
    bins: ['60-70', '70-80', '80-90', '90-100'],
    counts: [1, 0, 4, 2],
    yLabel: 'Weeks',
  });
  eq(all(svg, '.ff-bar').length, 3, 'one bar per bin that has observations, and none for the empty bin');
  eq(all(svg, '.ff-hit').length, 4, 'but every bin keeps a full-band hit target, empty included');

  const bars = all(svg, '.ff-bar');
  const height = (bar) => {
    const d = bar.getAttribute('d');
    const ys = [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
    return Math.max(...ys) - Math.min(...ys);
  };
  const [h1, h4, h2] = bars.map(height);
  close(h1 / h4, 1 / 4, 0.02, 'a bar four times the count is four times the height');
  close(h2 / h4, 2 / 4, 0.02, 'and two times, twice');

  const titles = all(svg, '.ff-bar > title').map((t) => t.textContent);
  ok(titles.includes('80-90: 4'), 'each bar names its bin and its count in words', titles.join('|'));
  const t = texts(svg, 'text');
  ok(t.includes('Weeks'), 'the y label is drawn');
  ok(t.includes('4'), 'and the peak bin carries its value on the cap');
  ok(t.includes('60-70') && t.includes('90-100'), 'the first and last bins are labelled');
}
{
  // Ragged input: the shorter of bins/counts wins, and rubbish counts as zero
  // rather than poisoning the y scale.
  const c = host();
  const svg = histogram(c, { bins: ['a', 'b', 'c'], counts: [3, 5] });
  eq(all(svg, '.ff-hit').length, 2, 'a bin with no count is not drawn');
  const c2 = host();
  const svg2 = histogram(c2, { bins: ['a', 'b'], counts: [4, Infinity] });
  eq(all(svg2, '.ff-bar').length, 1, 'a non-finite count is treated as zero');
  ok(!/NaN|Infinity/.test(c2.innerHTML), 'and never reaches the markup');
  const c3 = host();
  const svg3 = histogram(c3, { bins: ['a', 'b'], counts: [4, -9] });
  eq(all(svg3, '.ff-bar').length, 1, 'and so is a negative one');
}

// ============================================================== boxPlot
{
  eq(boxPlot(null, {}), null, 'no container, no box plot');
  const c = host();
  ok(/No data to chart/.test((boxPlot(c, { rows: [] }).getAttribute('aria-label') || '')),
    'no rows: stated empty state');

  // A row missing one of its five numbers is skipped, not guessed at.
  const c2 = host();
  const svg = boxPlot(c2, {
    rows: [
      { name: 'Full', min: 1, q1: 2, median: 3, q3: 4, max: 5 },
      { name: 'Partial', min: 1, q1: 2, median: null, q3: 4, max: 5 },
    ],
  });
  const summaries = all(svg, 'g > title').map((t) => t.textContent);
  eq(summaries.length, 1, 'a row with a missing summary stat is dropped');
  ok(/^Full:/.test(summaries[0]), 'and the complete row is the one kept', summaries[0]);
}
{
  const c = host(720);
  const svg = boxPlot(c, {
    rows: [
      { id: 3, name: 'Ants', min: 80, q1: 95, median: 100, q3: 110, max: 130, outliers: [40] },
      { id: 4, name: 'Bees', min: 85, q1: 90, median: 92, q3: 99, max: 120 },
    ],
    xLabel: 'Points',
  });
  const summaries = all(svg, 'g > title').map((t) => t.textContent);
  eq(summaries.length, 2, 'one group per row');
  eq(summaries[0], 'Ants: min 80, Q1 95, median 100, Q3 110, max 130',
    'and its five numbers are readable in words, not only as ink');

  const boxes = all(svg, 'rect').filter((r) => r.getAttribute('fill') !== 'transparent');
  eq(boxes.length, 2, 'two interquartile boxes');
  // The Aardvarks' box is wider (IQR 15 against 9) and starts further right.
  ok(num(boxes[0], 'width') > num(boxes[1], 'width'),
    'a wider IQR draws a wider box', `${num(boxes[0], 'width')} vs ${num(boxes[1], 'width')}`);
  ok(num(boxes[0], 'x') > num(boxes[1], 'x'), 'and a higher Q1 starts further right');
  ok(num(boxes[0], 'y') < num(boxes[1], 'y'), 'rows are drawn top to bottom in the order given');

  // The outlier is a mark of its own, named, and inside the plot.
  const dots = all(svg, 'circle');
  eq(dots.length, 1, 'one outlier, one dot');
  const dotTitle = all(svg, 'circle > title')[0];
  ok(dotTitle && /outlier: 40/.test(dotTitle.textContent),
    'named, with its value', dotTitle ? dotTitle.textContent : '(no title)');
  ok(num(dots[0], 'cx') < num(boxes[0], 'x'), 'drawn left of the box it belongs to');
  // The x domain must reach out to COVER the outlier, or the dot lands outside
  // the plot: the leftmost vertical rule is the axis origin.
  const plotLeft = Math.min(...all(svg, 'line')
    .filter((l) => l.getAttribute('x1') === l.getAttribute('x2'))
    .map((l) => num(l, 'x1')));
  ok(num(dots[0], 'cx') >= plotLeft - 0.5,
    'and inside the plot, because the domain was widened to take it in',
    `cx ${num(dots[0], 'cx')} vs plot left ${plotLeft}`);

  const t = texts(svg, 'text');
  ok(t.includes('Points'), 'the x label is drawn');
  const gutter = all(svg, 'text').map(drawn);
  ok(gutter.includes('Ants') && gutter.includes('Bees'),
    'and every row is named in the gutter', gutter.join('|'));
}
{
  // Out-of-order input is repaired rather than drawn backwards.
  const c = host();
  const svg = boxPlot(c, {
    rows: [{ name: 'Muddle', min: 130, q1: 110, median: 100, q3: 95, max: 80 }],
  });
  eq(all(svg, 'g > title')[0].textContent,
    'Muddle: min 80, Q1 95, median 100, Q3 110, max 130',
    'a five-number summary handed over backwards is sorted, not drawn inside out');
  const box = all(svg, 'rect').filter((r) => r.getAttribute('fill') !== 'transparent')[0];
  ok(num(box, 'width') > 0, 'so the box has a positive width');
}
{
  // A team whose quartiles are identical still shows a sliver, or it vanishes.
  const c = host();
  const svg = boxPlot(c, { rows: [{ name: 'Flat', min: 5, q1: 5, median: 5, q3: 5, max: 5 }] });
  const box = all(svg, 'rect').filter((r) => r.getAttribute('fill') !== 'transparent')[0];
  ok(num(box, 'width') >= 1.5, 'a zero-IQR row is still visible', String(num(box, 'width')));
}
{
  // Highlight, again on the id — and the caller's colour wins, so a team keeps
  // the colour the line charts gave it even though box rows arrive sorted by
  // median.
  const c = host();
  const svg = boxPlot(c, {
    rows: [
      { id: 3, name: 'Same', min: 1, q1: 2, median: 3, q3: 4, max: 5, color: SERIES_COLORS[6] },
      { id: 4, name: 'Same', min: 1, q1: 2, median: 3, q3: 4, max: 5 },
    ],
    highlight: 4,
  });
  const groups = all(svg, 'g').filter((g) => g.querySelector('title'));
  const ops = groups.map((g) => Number(g.getAttribute('opacity')));
  eq(ops.filter((o) => o === 1).length, 1, 'one of two same-named rows is emphasised');
  eq(ops.filter((o) => o < 0.5).length, 1, 'and one dimmed — matched on the id (rule 9)');
  const boxes = all(svg, 'rect').filter((r) => r.getAttribute('fill') !== 'transparent');
  eq(boxes[0].getAttribute('fill'), SERIES_COLORS[6],
    'the caller\'s colour is kept, not overwritten by the row\'s position');
  eq(boxes[1].getAttribute('fill'), SERIES_COLORS[1],
    'and a row with no opinion falls back to its positional slot');

  const svg2 = boxPlot(host(), {
    rows: [{ id: 3, name: 'A', min: 1, q1: 2, median: 3, q3: 4, max: 5 }],
    highlight: 'nobody',
  });
  const g2 = all(svg2, 'g').filter((g) => g.querySelector('title'));
  eq(Number(g2[0].getAttribute('opacity')), 1, 'an unknown highlight dims nothing here either');
}
{
  // A long name is truncated, never clipped, and the full one stays in the title.
  const c = host(300);
  const long = 'A preposterously long team name that cannot possibly fit the gutter';
  const svg = boxPlot(c, { rows: [{ name: long, min: 1, q1: 2, median: 3, q3: 4, max: 5 }] });
  // The full name sits beside the drawn label in a <title>, which is what makes
  // truncating safe rather than lossy.
  const label = all(svg, 'text').find((t) => /…$/.test(drawn(t)));
  ok(label, 'a name too long for the gutter is ellipsized');
  ok(drawn(label).length < long.length, 'and really is shorter',
    label ? `${drawn(label).length} vs ${long.length}` : '');
  const kept = all(svg, 'title').map((t) => t.textContent);
  ok(kept.some((s) => s === long), 'while the full name stays available in a <title>');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
