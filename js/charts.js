/**
 * charts.js - hand-written inline-SVG charts for the fantasy football stats site.
 *
 * No dependencies, no build step. Every chart renders a fresh <svg> into the
 * container it is given (plus one absolutely-positioned tooltip <div> where the
 * chart has a hover layer).
 *
 * Theme colors are read from the page's CSS custom properties via var(...):
 *   --bg --panel --line --text --dim --accent --err
 * Only the categorical series palette below is owned by this file.
 *
 * Public API:
 *   SERIES_COLORS            10-slot categorical palette
 *   lineChart(container, opts)
 *   histogram(container, opts)
 *   boxPlot(container, opts)
 *   scatterChart(container, opts)   projected against actual, with y = x and
 *                                   the least-squares line; dots open a link
 *   leastSquares(points)            the line's maths, pure
 *   offPerfect(points, fit)         mean gap between that line and y = x, pure
 */

/* ------------------------------------------------------------------ *
 * Palette
 * ------------------------------------------------------------------ *
 * Ten categorical slots, stepped for a dark surface (validated against
 * --panel #171a21 and --bg #0f1115). Slots are assigned in fixed order and
 * never cycled: team 1 always gets slot 1, so a team keeps its color across
 * every chart on the page and across filters.
 *
 * Measured on this surface (OKLab dE x100, Machado-Oliveira-Fernandes CVD
 * at severity 1.0):
 *   - OKLCH lightness all inside the dark band 0.48-0.67
 *   - OKLCH chroma all >= 0.10 (nothing reads as gray)
 *   - worst *adjacent* pair: 9.4 under deuteranopia, 26.5 unsimulated
 *     (targets: >= 8 CVD, >= 15 unsimulated) -- passes
 *   - every slot >= 3:1 contrast against both --panel and --bg
 *   - the first three slots are also safe pairwise in any order
 *
 * Ten simultaneous hues cannot be pairwise-distinct under CVD -- no ten-color
 * palette can. That is why every chart here ships secondary encoding: a
 * legend, click-to-highlight (which dims all other series), hover tooltips
 * that name each series in text, and <title> elements on the marks for
 * screen readers. Identity is never carried by hue alone.
 *
 * The values now live in css/app.css as --series-1..10 so the same team colour
 * can be used outside a chart (swatches, table accents). Each slot below is a
 * var() with the original hex as its fallback, so the palette still renders
 * unchanged if the stylesheet is missing. Change a colour in BOTH places, and
 * only after re-checking the measurements above - they hold for the set, not
 * for any one slot.
 */
export const SERIES_COLORS = [
  'var(--series-1, #3987e5)',  // 1  blue
  'var(--series-2, #d95926)',  // 2  orange
  'var(--series-3, #199e70)',  // 3  aqua
  'var(--series-4, #a540bb)',  // 4  purple
  'var(--series-5, #c98500)',  // 5  yellow
  'var(--series-6, #9085e9)',  // 6  violet
  'var(--series-7, #008300)',  // 7  green
  'var(--series-8, #d55181)',  // 8  magenta
  'var(--series-9, #105fd9)',  // 9  deep blue
  'var(--series-10, #e66767)', // 10 red
];

/* ------------------------------------------------------------------ *
 * Theme tokens (roles, not raw hex)
 * ------------------------------------------------------------------ */
const C = {
  surface: 'var(--panel, #171a21)', // used for gaps/rings so marks separate
  grid: 'var(--line, #272c36)',
  axis: 'var(--line, #272c36)',
  text: 'var(--text, #e6e8ec)',
  dim: 'var(--dim, #8b93a1)',
  accent: 'var(--accent, #3ba55d)',
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TICK_SIZE = 11; // px floor for legibility
const LABEL_SIZE = 12;

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** Escape a value for safe interpolation into SVG markup (text or attribute). */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Compact, thousands-separated number for ticks and tooltips. */
function fmt(n) {
  if (!isNum(n)) return '--';
  const rounded = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return rounded.toLocaleString('en-US');
}

/**
 * "Nice" axis domain + ticks.
 *
 * Math: take the raw span / target-tick-count, drop it to its power of ten,
 * then snap the leading digit up to 1, 2, 5 or 10 so the step is a round
 * number. The domain is then widened outward to whole multiples of that step,
 * which is what makes the first and last gridline land on clean values.
 * A degenerate span (all values equal, or a single point) is padded so the
 * scale never divides by zero.
 */
function niceScale(lo, hi, target = 5) {
  if (!isNum(lo) || !isNum(hi)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (lo > hi) [lo, hi] = [hi, lo];
  if (hi - lo < 1e-9) {
    const pad = Math.abs(lo) > 1 ? Math.abs(lo) * 0.1 : 1;
    lo -= pad;
    hi += pad;
  }
  const raw = (hi - lo) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks = [];
  // guard the loop count in case of pathological inputs
  for (let v = start, i = 0; v <= end + step * 1e-6 && i < 200; v += step, i++) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toFixed(10));
  }
  return { lo: start, hi: end, ticks };
}

/**
 * A caller-pinned domain, in the same shape niceScale returns.
 *
 * The domain ends are used exactly as given - the whole point is that several
 * charts can share one axis, and widening it to "nice" bounds per chart would
 * undo that. Only the tick *positions* are borrowed from niceScale, then
 * clipped to the domain so no label is drawn off the plot.
 *
 * Returns null for anything unusable, so the caller can fall back.
 */
function fixedScale(domain) {
  if (!Array.isArray(domain) || domain.length !== 2) return null;
  let [lo, hi] = domain;
  if (!isNum(lo) || !isNum(hi)) return null;
  if (lo > hi) [lo, hi] = [hi, lo];
  if (hi - lo < 1e-9) return null; // degenerate: let niceScale pad it instead
  const eps = (hi - lo) * 1e-9;
  const ticks = niceScale(lo, hi, 5).ticks.filter((t) => t >= lo - eps && t <= hi + eps);
  return { lo, hi, ticks: ticks.length ? ticks : [lo, hi] };
}

/** Rendered width to use for the viewBox, so 1 user unit == 1 CSS px and
 *  font sizes stay at their stated pixel size on a phone. */
function measureWidth(container, fallback = 720) {
  const w = container && typeof container.clientWidth === 'number' ? container.clientWidth : 0;
  // Upper clamp tracks .wrap.wide (1600px) in css/app.css; if that grows and
  // this does not, every chart silently stops widening at the old number.
  return Math.max(280, Math.min(1600, w || fallback));
}

/** Approximate text width; good enough for legend wrapping and label fitting. */
const textWidth = (s, size) => String(s).length * size * 0.56;

/**
 * Shorten a label so its rendered width fits `maxPx`, with an ellipsis.
 * Used for row labels and legend entries on narrow screens - the full string
 * always stays available in the mark's <title> and in the tooltip, so
 * truncating never hides a value.
 */
function truncateToWidth(text, size, maxPx) {
  const s = String(text);
  if (maxPx <= 0) return '';
  if (textWidth(s, size) <= maxPx) return s;
  const perChar = size * 0.56;
  const keep = Math.max(1, Math.floor(maxPx / perChar) - 1);
  return s.slice(0, keep).replace(/\s+$/, '') + '…';
}

/** A vertical bar: square at the baseline, 4px rounded at the data end. */
function barPathUp(x, y, w, h, r = 4) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}L${x},${y + rr}Q${x},${y} ${x + rr},${y}` +
    `L${x + w - rr},${y}Q${x + w},${y} ${x + w},${y + rr}L${x + w},${y + h}Z`;
}

/** Replace the container's contents and reset any observer from a prior render. */
function resetContainer(container) {
  if (container.__ffChartRO && typeof container.__ffChartRO.disconnect === 'function') {
    container.__ffChartRO.disconnect();
    container.__ffChartRO = null;
  }
  container.innerHTML = '';
}

/** Render an SVG markup string into the container; returns the <svg> or null. */
function mount(container, markup) {
  container.innerHTML = markup;
  return typeof container.querySelector === 'function' ? container.querySelector('svg') : null;
}

/**
 * Re-render when the container's width changes materially. The guard on
 * `last` means re-rendering (which does not change the container width)
 * cannot retrigger the observer, so there is no feedback loop.
 */
function observeWidth(container, rerender) {
  if (typeof ResizeObserver !== 'function') return;
  let last = measureWidth(container);
  const ro = new ResizeObserver((entries) => {
    const w = Math.round(entries[0] && entries[0].contentRect ? entries[0].contentRect.width : 0);
    if (!w || Math.abs(w - last) < 12) return;
    last = w;
    rerender();
  });
  ro.observe(container);
  container.__ffChartRO = ro;
}

/** Empty / degenerate state: a bordered panel with a short message. */
function emptyState(container, message, height) {
  resetContainer(container);
  const w = measureWidth(container);
  const h = Math.max(80, height || 160);
  const markup =
    `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" ` +
    `aria-label="${esc(message)}" style="width:100%;height:auto;display:block;font-family:${FONT}">` +
    `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" fill="none" ` +
    `stroke="${C.grid}" stroke-width="1"/>` +
    `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" dominant-baseline="middle" ` +
    `fill="${C.dim}" font-size="${LABEL_SIZE}">${esc(message)}</text>` +
    `</svg>`;
  return mount(container, markup);
}

/* ------------------------------------------------------------------ *
 * Tooltip (one positioned <div> per chart, built with DOM nodes only -
 * series names are untrusted text, so they go in via textContent)
 *
 * THE TOOLTIP CAN BE A CONNECTOR (2026-10-08, "build any connectors by
 * clicking on the preview"). `show(…, href)` takes an optional fifth argument:
 * where the mark being previewed goes. While such a tooltip is up the chart
 * shows a pointer cursor and a click on it follows the link:
 *   a mouse   the hover already previewed the mark, so the click goes;
 *   a finger  the first tap only opens the tooltip (there was no hover to read
 *             it by) and a second tap on the same mark goes.
 * Ctrl/cmd/shift open a new tab. A tooltip shown with no href behaves exactly
 * as before, and a chart whose caller passes no `hrefFor` never has one.
 * `navigate(href, event)` replaces the page navigation (tests, or a page that
 * wants to scroll instead). The line chart, the histogram and the box plot
 * each say where their marks go through their own `hrefFor` / `href` option.
 * ------------------------------------------------------------------ */
function createTooltip(container, { navigate = null } = {}) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  // Whatever the last render in this container left listening.
  if (typeof container.__ffTipOff === 'function') container.__ffTipOff();
  container.__ffTipOff = null;
  // The tooltip is absolutely positioned inside the container.
  try {
    const pos = container.style && container.style.position;
    const computed = typeof getComputedStyle === 'function' ? getComputedStyle(container).position : pos;
    if (!computed || computed === 'static') container.style.position = 'relative';
  } catch (_) { /* non-DOM environment: skip */ }

  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.style.cssText =
    'position:absolute;pointer-events:none;opacity:0;transition:opacity .08s;' +
    'z-index:5;background:var(--bg,#0f1115);border:1px solid var(--line,#272c36);' +
    'border-radius:6px;padding:7px 9px;font:' + TICK_SIZE + 'px/1.5 ' + FONT + ';' +
    'color:var(--text,#e6e8ec);white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.45);' +
    'max-width:230px;left:0;top:0';
  container.appendChild(el);

  /**
   * @param {string} title    heading (e.g. "Week 7")
   * @param {Array}  rows     [{ color, name, value }] - value leads, name follows
   * @param {number} x,y      pointer position in container-local px
   * @param {string} [href]   where a click on the previewed mark goes
   */
  let curHref = null;      // the link of the mark the tooltip is showing
  let pressTouch = false;  // was the last press a finger?
  let pressHref = null;    // the link the last press was on
  let tapSeen = null;      // the link the finger's PREVIOUS tap was on
  let armed = false;       // should the click this press ends in follow it?
  function show(title, rows, x, y, href = null) {
    curHref = href ? String(href) : null;
    try { container.style.cursor = curHref ? 'pointer' : ''; } catch (_) { /* no style here */ }
    el.textContent = '';
    if (title) {
      const h = document.createElement('div');
      h.style.cssText = 'color:var(--dim,#8b93a1);margin-bottom:3px';
      h.textContent = title;
      el.appendChild(h);
    }
    for (const r of rows) {
      const line = document.createElement('div');
      line.style.cssText = 'display:flex;align-items:center;gap:6px';
      if (r.color) {
        const key = document.createElement('span');
        // a short stroke, not a filled box - a swatch is too much ink at this density
        key.style.cssText = 'display:inline-block;width:10px;height:2px;border-radius:1px;' +
          'flex:0 0 auto;background:' + r.color;
        line.appendChild(key);
      }
      const val = document.createElement('strong');
      val.style.cssText = 'font-weight:600';
      val.textContent = r.value;
      line.appendChild(val);
      const nm = document.createElement('span');
      nm.style.cssText = 'color:var(--dim,#8b93a1);overflow:hidden;text-overflow:ellipsis';
      nm.textContent = r.name;
      line.appendChild(nm);
      el.appendChild(line);
    }
    el.style.opacity = '1';
    // Flip to the left of the pointer when close to the right edge.
    const cw = container.clientWidth || 0;
    const tw = el.offsetWidth || 140;
    const th = el.offsetHeight || 40;
    const left = x + 14 + tw > cw ? Math.max(2, x - 14 - tw) : x + 14;
    el.style.left = left + 'px';
    el.style.top = Math.max(2, y - th - 10) + 'px';
  }

  function hide() {
    el.style.opacity = '0';
    curHref = null;
    try { container.style.cursor = ''; } catch (_) { /* no style here */ }
  }

  // One pair of listeners on the container, replaced on every re-render.
  //
  // They are on the CONTAINER and the chart's own are on marks inside it, so by
  // the time a press bubbles here the chart has already called `show` for it:
  // `curHref` is the mark under this press. That is what lets a finger be told
  // apart from a mouse without a hover: its tap is what opens the tooltip, so
  // the click that ends that same tap must not also follow it. A tap goes only
  // when the tap BEFORE it was on the same mark. (A lifted finger also fires
  // pointerleave, which hides the tooltip before the click arrives — so the
  // finger's link is remembered from the press, not read off the tooltip.)
  const go = typeof navigate === 'function'
    ? navigate
    : (href, evt) => {
      if (typeof window === 'undefined' || !window) return;
      const aside = evt && (evt.ctrlKey || evt.metaKey || evt.shiftKey);
      if (aside && typeof window.open === 'function') window.open(href, '_blank', 'noopener');
      else if (window.location) window.location.href = href;
    };
  const onDown = (evt) => {
    pressTouch = evt.pointerType === 'touch';
    pressHref = curHref;
    if (pressTouch) {
      armed = pressHref !== null && pressHref === tapSeen;
      tapSeen = pressHref;
    } else {
      armed = pressHref !== null;
    }
  };
  const onClick = (evt) => {
    const was = armed;
    armed = false;
    // A mouse must still be on the mark; a finger left it when it lifted.
    const href = pressTouch ? pressHref : curHref;
    if (!was || !href) return;
    if (pressTouch) tapSeen = null;   // gone: the next visit starts over
    go(href, evt);
  };
  if (typeof container.addEventListener === 'function') {
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('click', onClick);
    container.__ffTipOff = () => {
      container.removeEventListener('pointerdown', onDown);
      container.removeEventListener('click', onClick);
    };
  }

  return { el, show, hide, href: () => curHref };
}

/** Pointer position in SVG user units + container-local px. */
function pointerPos(svg, container, evt) {
  const r = svg.getBoundingClientRect();
  const cr = container.getBoundingClientRect();
  const vb = svg.viewBox && svg.viewBox.baseVal ? svg.viewBox.baseVal : null;
  const scale = vb && r.width ? vb.width / r.width : 1;
  return {
    ux: (evt.clientX - r.left) * scale,
    uy: (evt.clientY - r.top) * scale,
    px: evt.clientX - cr.left,
    py: evt.clientY - cr.top,
  };
}

/* ================================================================== *
 * 1. Line chart
 * ================================================================== */

/**
 * Multi-series line chart (weekly scores, cumulative luck, ...).
 *
 * @param {Element} container
 * @param {Object}  opts
 * @param {Array}   opts.series     [{ name, values:number[], color?, id? }]
 *                                  `id` is what `highlight` and the legend
 *                                  match on (rule 9: a squad is its team id,
 *                                  never its label); without one, the name.
 * @param {Array}   opts.xLabels    category labels, one per x position
 * @param {string}  opts.yLabel
 * @param {number}  [opts.height=300]   height of the plot block; the legend
 *                                      adds its own rows below it
 * @param {boolean} [opts.zeroLine]  draw a reference rule at y = 0
 * @param {string|number} [opts.highlight] series id (or name, for a series
 *                                   with no id) to emphasize; others dim
 * @param {number[]} [opts.yDomain]  explicit [lo, hi], replacing the computed
 *                                   scale. For giving several small charts one
 *                                   shared axis so their heights are comparable
 *                                   - which the per-chart "nice" scale, fitted
 *                                   to each chart's own data, cannot be.
 *                                   Ignored if not two finite, unequal numbers.
 * @param {Function} [opts.hrefFor]  (index, xLabel) -> href|null: where a
 *                                   click goes while the tooltip for that x
 *                                   position is up (see createTooltip). A
 *                                   line chart's tooltip is one x position
 *                                   across every series, so the link is the
 *                                   WEEK's, not one team's.
 * @param {Function} [opts.navigate] (href, event) - replaces the navigation
 * @returns {SVGElement|null}
 */
export function lineChart(container, opts) {
  if (!container || typeof container !== 'object') return null;
  const o = opts || {};
  const height = isNum(o.height) && o.height > 80 ? o.height : 300;

  // --- normalize input; drop unusable series, keep NaN holes as gaps -------
  const rawSeries = Array.isArray(o.series) ? o.series : [];
  const series = rawSeries
    .filter((s) => s && Array.isArray(s.values))
    .map((s, i) => {
      const name = String(s.name == null ? 'Series ' + (i + 1) : s.name);
      return {
        name,
        // WHAT A HIGHLIGHT MATCHES ON (AUDIT §1.9, rule 9): the caller's id
        // when it gives one, so two managers who render the same name are
        // still two series and only the chosen one is emphasised.
        key: s.id != null ? String(s.id) : name,
        values: s.values.map((v) => (isNum(v) ? v : NaN)),
        color: s.color || SERIES_COLORS[i % SERIES_COLORS.length],
      };
    })
    .filter((s) => s.values.some(isNum));

  if (!series.length) return emptyState(container, 'No data to chart', height);

  const nPoints = Math.max(...series.map((s) => s.values.length));
  if (nPoints < 1) return emptyState(container, 'No data to chart', height);

  const xLabels = Array.isArray(o.xLabels) ? o.xLabels : [];
  const want = o.highlight == null || o.highlight === '' ? null : String(o.highlight);
  const highlight = want !== null && series.some((s) => s.key === want) ? want : null;

  resetContainer(container);
  const W = measureWidth(container);

  // --- geometry -----------------------------------------------------------
  const M = { top: 14, right: 16, bottom: 30, left: 54 };
  const plotW = Math.max(10, W - M.left - M.right);
  const plotH = Math.max(40, height - M.top - M.bottom);

  // --- y scale ------------------------------------------------------------
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const v of s.values) if (isNum(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (o.zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const yS = fixedScale(o.yDomain) || niceScale(lo, hi, 5);
  const ySpan = yS.hi - yS.lo || 1;
  const y = (v) => M.top + plotH - ((v - yS.lo) / ySpan) * plotH;

  // --- x scale: evenly spaced categories. With a single point there is no
  //     interval to divide by, so it is centered instead. ------------------
  const single = nPoints === 1;
  const x = (i) => (single ? M.left + plotW / 2 : M.left + (i / (nPoints - 1)) * plotW);

  const parts = [];

  // gridlines + y ticks
  for (const t of yS.ticks) {
    const ty = y(t);
    parts.push(
      `<line x1="${M.left}" y1="${ty.toFixed(1)}" x2="${M.left + plotW}" y2="${ty.toFixed(1)}" ` +
      `stroke="${C.grid}" stroke-width="1"/>`,
      `<text x="${M.left - 8}" y="${(ty + 4).toFixed(1)}" text-anchor="end" fill="${C.dim}" ` +
      `font-size="${TICK_SIZE}" style="font-variant-numeric:tabular-nums">${esc(fmt(t))}</text>`
    );
  }

  // zero reference rule, one step stronger than the grid
  if (o.zeroLine && yS.lo <= 0 && yS.hi >= 0) {
    parts.push(
      `<line x1="${M.left}" y1="${y(0).toFixed(1)}" x2="${M.left + plotW}" y2="${y(0).toFixed(1)}" ` +
      `stroke="${C.dim}" stroke-width="1"/>`
    );
  }

  // x ticks - thinned so labels never collide (keep at most ~14)
  const everyN = Math.max(1, Math.ceil(nPoints / Math.max(2, Math.floor(plotW / 46))));
  for (let i = 0; i < nPoints; i++) {
    if (i % everyN !== 0 && i !== nPoints - 1) continue;
    const label = xLabels[i] == null ? String(i + 1) : xLabels[i];
    parts.push(
      `<text x="${x(i).toFixed(1)}" y="${M.top + plotH + 18}" text-anchor="middle" ` +
      `fill="${C.dim}" font-size="${TICK_SIZE}">${esc(label)}</text>`
    );
  }

  // y axis label (rotated)
  if (o.yLabel) {
    parts.push(
      `<text transform="translate(13,${M.top + plotH / 2}) rotate(-90)" text-anchor="middle" ` +
      `fill="${C.dim}" font-size="${TICK_SIZE}">${esc(o.yLabel)}</text>`
    );
  }

  // --- series paths -------------------------------------------------------
  // Non-finite values break the path into subpaths so a hole is a gap, not a
  // straight line through missing data. A run of length 1 gets a dot instead.
  const dimmed = (key) => highlight && key !== highlight;
  const backParts = [];  // dimmed series - painted first
  const frontParts = []; // emphasized (or all, when nothing is highlighted)
  const dotParts = [];
  const labelParts = [];

  series.forEach((s) => {
    const isDim = dimmed(s.key);
    const opacity = isDim ? 0.16 : 1;
    const width = highlight && !isDim ? 2.5 : 2;
    let d = '';
    let runLen = 0;
    let lastIdx = -1;
    for (let i = 0; i < nPoints; i++) {
      const v = s.values[i];
      if (!isNum(v)) { if (runLen === 1) singleDot(s, lastIdx, opacity); runLen = 0; continue; }
      d += (runLen === 0 ? 'M' : 'L') + x(i).toFixed(1) + ',' + y(v).toFixed(1);
      runLen++;
      lastIdx = i;
    }
    const endedIsolated = runLen === 1; // last point has no neighbour -> already a dot
    if (endedIsolated) singleDot(s, lastIdx, opacity);
    // A path made only of movetos draws nothing; skip it rather than emit dead ink.
    if (d.indexOf('L') !== -1) {
      (isDim ? backParts : frontParts).push(
        `<path d="${d}" fill="none" stroke="${esc(s.color)}" stroke-width="${width}" ` +
        `stroke-linejoin="round" stroke-linecap="round" opacity="${opacity}">` +
        `<title>${esc(s.name)}</title></path>`
      );
    }
    // Direct end-labels only when they cannot pile up: <= 4 series, or the
    // single highlighted one. Past that the legend and tooltip carry identity.
    const showLabel = (series.length <= 4 && !highlight) || (highlight && !isDim);
    if (showLabel && lastIdx >= 0 && isNum(s.values[lastIdx])) {
      const lx = x(lastIdx), ly = y(s.values[lastIdx]);
      if (!endedIsolated) { // don't stack a second dot on an isolated end point
        dotParts.push(
          `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" fill="${esc(s.color)}" ` +
          `stroke="${C.surface}" stroke-width="2"/>`
        );
      }
      const txt = fmt(s.values[lastIdx]);
      const fits = lx + 8 + textWidth(txt, TICK_SIZE) <= M.left + plotW;
      labelParts.push(
        `<text x="${(fits ? lx + 8 : lx - 8).toFixed(1)}" y="${(ly + 4).toFixed(1)}" ` +
        `text-anchor="${fits ? 'start' : 'end'}" fill="${C.text}" font-size="${TICK_SIZE}" ` +
        `style="font-variant-numeric:tabular-nums">${esc(txt)}</text>`
      );
    }

    function singleDot(ser, i, op) {
      dotParts.push(
        `<circle cx="${x(i).toFixed(1)}" cy="${y(ser.values[i]).toFixed(1)}" r="4" ` +
        `fill="${esc(ser.color)}" stroke="${C.surface}" stroke-width="2" opacity="${op}">` +
        `<title>${esc(ser.name)}</title></circle>`
      );
    }
  });

  // dimmed series first, so the emphasized one paints on top of them
  parts.push(...backParts, ...frontParts, ...dotParts, ...labelParts);

  // --- crosshair + hover markers (hidden until the pointer enters) ---------
  parts.push(
    `<line class="ff-cross" x1="0" y1="${M.top}" x2="0" y2="${M.top + plotH}" ` +
    `stroke="${C.dim}" stroke-width="1" opacity="0"/>`
  );
  parts.push(`<g class="ff-focus" opacity="0"></g>`);
  parts.push(
    `<rect class="ff-overlay" x="${M.left}" y="${M.top}" width="${plotW}" height="${plotH}" ` +
    `fill="transparent" style="cursor:crosshair"/>`
  );

  // plot frame baseline
  parts.push(
    `<line x1="${M.left}" y1="${M.top + plotH}" x2="${M.left + plotW}" y2="${M.top + plotH}" ` +
    `stroke="${C.axis}" stroke-width="1"/>`
  );

  // --- legend (always present for >= 2 series; click to highlight) ---------
  let legendH = 0;
  if (series.length >= 2) {
    const rowH = 20;
    const legendLeft = 4;
    const legendRight = W - 4;
    // Longest label a single legend entry may use before it is ellipsized.
    const maxLabel = Math.max(40, legendRight - legendLeft - 22 - 16);
    let cx = legendLeft, cy = height + 6, rows = 1;
    for (const s of series) {
      const label = truncateToWidth(s.name, LABEL_SIZE, maxLabel);
      const iw = 22 + textWidth(label, LABEL_SIZE) + 16;
      if (cx + iw > legendRight && cx > legendLeft) { cx = legendLeft; cy += rowH; rows++; }
      const isDim = dimmed(s.key);
      parts.push(
        `<g class="ff-legend-item" data-name="${esc(s.name)}" data-key="${esc(s.key)}" style="cursor:pointer" ` +
        `opacity="${isDim ? 0.4 : 1}" tabindex="0" role="button" aria-label="${esc(s.name)}">` +
        `<title>${esc(s.name)}</title>` +
        `<rect x="${cx}" y="${cy - 12}" width="${(iw - 10).toFixed(1)}" height="${rowH}" fill="transparent"/>` +
        `<line x1="${cx}" y1="${cy}" x2="${cx + 16}" y2="${cy}" stroke="${esc(s.color)}" ` +
        `stroke-width="${highlight === s.key ? 3 : 2}" stroke-linecap="round"/>` +
        `<text x="${cx + 22}" y="${cy + 4}" fill="${C.text}" font-size="${LABEL_SIZE}">${esc(label)}</text>` +
        `</g>`
      );
      cx += iw;
    }
    legendH = rows * rowH + 8;
  }

  const totalH = height + legendH;
  const title = o.yLabel ? String(o.yLabel) + ' by ' + (series.length) + ' teams' : 'Line chart';
  const markup =
    `<svg viewBox="0 0 ${W} ${totalH}" width="100%" role="img" aria-label="${esc(title)}" ` +
    `style="width:100%;height:auto;display:block;font-family:${FONT}">${parts.join('')}</svg>`;

  const svg = mount(container, markup);
  if (!svg) return null;

  // --- interactivity ------------------------------------------------------
  const tip = createTooltip(container, { navigate: o.navigate });
  const hrefFor = typeof o.hrefFor === 'function' ? o.hrefFor : null;
  const cross = svg.querySelector('.ff-cross');
  const focus = svg.querySelector('.ff-focus');
  const overlay = svg.querySelector('.ff-overlay');

  if (overlay && cross && focus && tip) {
    const nearestIndex = (ux) => {
      if (single) return 0;
      const t = (ux - M.left) / plotW;
      return Math.max(0, Math.min(nPoints - 1, Math.round(t * (nPoints - 1))));
    };
    const onMove = (evt) => {
      const p = pointerPos(svg, container, evt);
      const i = nearestIndex(p.ux);
      const px = x(i);
      cross.setAttribute('x1', px.toFixed(1));
      cross.setAttribute('x2', px.toFixed(1));
      cross.setAttribute('opacity', '1');

      // markers on every series at this x, and one tooltip listing them all
      const rows = [];
      let markers = '';
      for (const s of series) {
        const v = s.values[i];
        if (!isNum(v)) continue;
        if (!dimmed(s.key)) {
          markers += `<circle cx="${px.toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" ` +
            `fill="${esc(s.color)}" stroke="${C.surface}" stroke-width="2"/>`;
        }
        rows.push({ color: s.color, name: s.name, value: fmt(v) });
      }
      focus.innerHTML = markers;
      focus.setAttribute('opacity', '1');
      rows.sort((a, b) => parseFloat(String(b.value).replace(/,/g, '')) - parseFloat(String(a.value).replace(/,/g, '')));
      const heading = xLabels[i] == null ? String(i + 1) : String(xLabels[i]);
      tip.show(heading, rows, p.px, p.py, hrefFor ? hrefFor(i, heading) : null);
    };
    const onLeave = () => {
      cross.setAttribute('opacity', '0');
      focus.setAttribute('opacity', '0');
      tip.hide();
    };
    overlay.addEventListener('pointermove', onMove);
    overlay.addEventListener('pointerdown', onMove);
    overlay.addEventListener('pointerleave', onLeave);
  }

  // legend: click (or Enter/Space) a team to highlight it; again to clear
  const rerenderWith = (key) => lineChart(container, Object.assign({}, o, { highlight: key }));
  const items = typeof svg.querySelectorAll === 'function' ? svg.querySelectorAll('.ff-legend-item') : [];
  for (const item of items) {
    const toggle = () => {
      const key = item.getAttribute('data-key');
      rerenderWith(highlight === key ? null : key);
    };
    item.addEventListener('click', toggle);
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  }

  observeWidth(container, () => lineChart(container, o));
  return svg;
}

/* ================================================================== *
 * 2. Histogram
 * ================================================================== */

/**
 * Vertical bar histogram (score distribution).
 *
 * The bins are one nominal series, so every bar takes slot 1 - coloring bars
 * by their own height would re-encode what bar length already shows.
 *
 * @param {Element} container
 * @param {Object}  opts
 * @param {string[]} opts.bins
 * @param {number[]} opts.counts
 * @param {string}  opts.yLabel
 * @param {number}  [opts.height=240]
 * @param {Function} [opts.hrefFor]  (index, binLabel) -> href|null: where a
 *                                   click on that bar goes while its tooltip
 *                                   is up (see createTooltip)
 * @param {Function} [opts.navigate] (href, event) - replaces the navigation
 * @returns {SVGElement|null}
 */
export function histogram(container, opts) {
  if (!container || typeof container !== 'object') return null;
  const o = opts || {};
  const height = isNum(o.height) && o.height > 80 ? o.height : 240;

  const bins = Array.isArray(o.bins) ? o.bins.map((b) => String(b == null ? '' : b)) : [];
  const rawCounts = Array.isArray(o.counts) ? o.counts : [];
  const n = Math.min(bins.length, rawCounts.length);
  // Non-finite counts are treated as zero rather than poisoning the scale.
  const counts = [];
  for (let i = 0; i < n; i++) counts.push(isNum(rawCounts[i]) ? Math.max(0, rawCounts[i]) : 0);

  if (!n) return emptyState(container, 'No data to chart', height);
  const maxCount = Math.max(...counts);
  if (!(maxCount > 0)) return emptyState(container, 'No observations in range', height);

  resetContainer(container);
  const W = measureWidth(container);
  const M = { top: 16, right: 14, bottom: 34, left: 46 };
  const plotW = Math.max(10, W - M.left - M.right);
  const plotH = Math.max(40, height - M.top - M.bottom);

  const yS = niceScale(0, maxCount, 4);
  const ySpan = yS.hi - yS.lo || 1;
  const y = (v) => M.top + plotH - ((v - yS.lo) / ySpan) * plotH;

  // Band per bin; the bar is capped at 24px so the band's leftover is air,
  // and never wider than band - 2 (the surface gap between neighbours).
  const band = plotW / n;
  const barW = Math.max(2, Math.min(24, band - 2));

  const parts = [];
  for (const t of yS.ticks) {
    const ty = y(t);
    parts.push(
      `<line x1="${M.left}" y1="${ty.toFixed(1)}" x2="${M.left + plotW}" y2="${ty.toFixed(1)}" ` +
      `stroke="${C.grid}" stroke-width="1"/>`,
      `<text x="${M.left - 8}" y="${(ty + 4).toFixed(1)}" text-anchor="end" fill="${C.dim}" ` +
      `font-size="${TICK_SIZE}" style="font-variant-numeric:tabular-nums">${esc(fmt(t))}</text>`
    );
  }
  if (o.yLabel) {
    parts.push(
      `<text transform="translate(12,${M.top + plotH / 2}) rotate(-90)" text-anchor="middle" ` +
      `fill="${C.dim}" font-size="${TICK_SIZE}">${esc(o.yLabel)}</text>`
    );
  }

  const color = SERIES_COLORS[0];
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 42))));
  const peak = counts.indexOf(maxCount);

  for (let i = 0; i < n; i++) {
    const cx = M.left + band * (i + 0.5);
    const bx = cx - barW / 2;
    const by = y(counts[i]);
    const bh = Math.max(0, M.top + plotH - by);
    if (bh > 0) {
      parts.push(
        `<path class="ff-bar" data-i="${i}" d="${barPathUp(bx, by, barW, bh, 4)}" fill="${color}">` +
        `<title>${esc(bins[i])}: ${esc(fmt(counts[i]))}</title></path>`
      );
    }
    if (i % labelEvery === 0 || i === n - 1) {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${M.top + plotH + 18}" text-anchor="middle" ` +
        `fill="${C.dim}" font-size="${TICK_SIZE}">${esc(bins[i])}</text>`
      );
    }
    // Label selectively: only the peak bin gets a value on its cap.
    if (i === peak) {
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${(by - 6).toFixed(1)}" text-anchor="middle" fill="${C.text}" ` +
        `font-size="${TICK_SIZE}" style="font-variant-numeric:tabular-nums">${esc(fmt(counts[i]))}</text>`
      );
    }
    // Hit target is the whole band, not just the painted bar.
    parts.push(
      `<rect class="ff-hit" data-i="${i}" x="${(M.left + band * i).toFixed(1)}" y="${M.top}" ` +
      `width="${band.toFixed(1)}" height="${plotH}" fill="transparent"/>`
    );
  }

  parts.push(
    `<line x1="${M.left}" y1="${M.top + plotH}" x2="${M.left + plotW}" y2="${M.top + plotH}" ` +
    `stroke="${C.axis}" stroke-width="1"/>`
  );

  const markup =
    `<svg viewBox="0 0 ${W} ${height}" width="100%" role="img" ` +
    `aria-label="${esc((o.yLabel || 'Count') + ' by bin')}" ` +
    `style="width:100%;height:auto;display:block;font-family:${FONT}">${parts.join('')}</svg>`;

  const svg = mount(container, markup);
  if (!svg) return null;

  const tip = createTooltip(container, { navigate: o.navigate });
  const hrefFor = typeof o.hrefFor === 'function' ? o.hrefFor : null;
  const hits = typeof svg.querySelectorAll === 'function' ? svg.querySelectorAll('.ff-hit') : [];
  const bars = typeof svg.querySelectorAll === 'function' ? svg.querySelectorAll('.ff-bar') : [];
  const barByIndex = {};
  for (const b of bars) barByIndex[b.getAttribute('data-i')] = b;

  if (tip) {
    for (const hit of hits) {
      const i = hit.getAttribute('data-i');
      const bar = barByIndex[i];
      const enter = (evt) => {
        const p = pointerPos(svg, container, evt);
        if (bar) bar.setAttribute('opacity', '0.8');
        tip.show(bins[+i], [{ color, name: (o.yLabel || 'count'), value: fmt(counts[+i]) }], p.px, p.py,
          hrefFor ? hrefFor(+i, bins[+i]) : null);
      };
      hit.addEventListener('pointermove', enter);
      // A finger produces no `pointermove` before it lands, so on a phone a tap
      // on a bar did nothing at all and the counts behind this chart were
      // unreadable. `pointerdown` is what a tap actually is. The line chart
      // above already listens for both, for the same reason.
      hit.addEventListener('pointerdown', enter);
      hit.addEventListener('pointerleave', () => {
        if (bar) bar.removeAttribute('opacity');
        tip.hide();
      });
    }
  }

  observeWidth(container, () => histogram(container, o));
  return svg;
}

/* ================================================================== *
 * 3. Box plot
 * ================================================================== */

/**
 * Horizontal box-and-whisker, one row per team.
 *
 * Whisker convention: this function draws exactly the five numbers it is
 * given. `min`/`max` are treated as the whisker ends (whatever rule the
 * caller used to compute them - full range, or the 1.5 x IQR fence), and
 * anything in `outliers` is drawn as a separate dot beyond them. Values are
 * repaired if they arrive unsorted, and the whiskers are clamped so they can
 * never point back inside the box.
 *
 * @param {Element} container
 * @param {Object}  opts
 * @param {Array}   opts.rows  [{ name, min, q1, median, q3, max, outliers?, color?, href? }]
 *                             `color` pins a row to its team's palette slot -
 *                             see the note on positional fallback below.
 *                             `href`: where a click on that row goes while
 *                             its tooltip is up (see createTooltip).
 * @param {Function} [opts.navigate] (href, event) - replaces the navigation
 * @param {string}  opts.xLabel
 * @param {number}  [opts.height]     overrides the row-derived height
 * @param {string|number} [opts.highlight] row id (or name, for a row with
 *                                    no id) to emphasize; the others dim,
 *                                    matching lineChart's legend behaviour
 * @returns {SVGElement|null}
 */
export function boxPlot(container, opts) {
  if (!container || typeof container !== 'object') return null;
  const o = opts || {};
  const rawRows = Array.isArray(o.rows) ? o.rows : [];

  const rows = [];
  rawRows.forEach((r, i) => {
    if (!r) return;
    const five = [r.min, r.q1, r.median, r.q3, r.max];
    if (!five.every(isNum)) return; // skip rows with missing/NaN summary stats
    const sorted = five.slice().sort((a, b) => a - b); // repair out-of-order input
    const outliers = (Array.isArray(r.outliers) ? r.outliers : []).filter(isNum);
    const name = String(r.name == null ? 'Row ' + (i + 1) : r.name);
    rows.push({
      name,
      // Matched by `highlight`: the caller's id when given (rule 9), else the name.
      key: r.id != null ? String(r.id) : name,
      min: sorted[0], q1: sorted[1], median: sorted[2], q3: sorted[3], max: sorted[4],
      outliers,
      // Prefer the caller's colour. Box-plot rows normally arrive sorted by
      // median, so colouring by position here handed a team a different colour
      // than the line charts gave it (which index the team list) - breaking the
      // "a team keeps its colour everywhere" rule the palette is built on. The
      // positional fallback only applies when the caller has no opinion.
      color: r.color || SERIES_COLORS[i % SERIES_COLORS.length],
      href: r.href ? String(r.href) : null,
    });
  });

  const rowH = 30;
  if (!rows.length) return emptyState(container, 'No data to chart', o.height || 200);

  resetContainer(container);
  const W = measureWidth(container);

  // Label gutter: enough for the longest name, but never more than 38% of width.
  const longest = rows.reduce((m, r) => Math.max(m, textWidth(r.name, LABEL_SIZE)), 0);
  const gutter = Math.min(Math.max(64, longest + 12), W * 0.38);
  const M = { top: 12, right: 18, bottom: 34, left: gutter };
  const plotW = Math.max(10, W - M.left - M.right);
  const plotH = rows.length * rowH;
  const height = isNum(o.height) && o.height > 60 ? o.height : M.top + plotH + M.bottom;
  const scaleH = Math.max(20, height - M.top - M.bottom);
  const actualRowH = scaleH / rows.length;

  // x domain covers whiskers AND outliers so no mark falls off the plot.
  let lo = Infinity, hi = -Infinity;
  for (const r of rows) {
    lo = Math.min(lo, r.min, ...r.outliers);
    hi = Math.max(hi, r.max, ...r.outliers);
  }
  const xS = niceScale(lo, hi, 5);
  const xSpan = xS.hi - xS.lo || 1;
  const x = (v) => M.left + ((v - xS.lo) / xSpan) * plotW;

  const parts = [];
  for (const t of xS.ticks) {
    const tx = x(t);
    parts.push(
      `<line x1="${tx.toFixed(1)}" y1="${M.top}" x2="${tx.toFixed(1)}" y2="${M.top + scaleH}" ` +
      `stroke="${C.grid}" stroke-width="1"/>`,
      `<text x="${tx.toFixed(1)}" y="${M.top + scaleH + 18}" text-anchor="middle" fill="${C.dim}" ` +
      `font-size="${TICK_SIZE}" style="font-variant-numeric:tabular-nums">${esc(fmt(t))}</text>`
    );
  }
  if (o.xLabel) {
    parts.push(
      `<text x="${(M.left + plotW / 2).toFixed(1)}" y="${height - 4}" text-anchor="middle" ` +
      `fill="${C.dim}" font-size="${TICK_SIZE}">${esc(o.xLabel)}</text>`
    );
  }

  const boxH = Math.max(8, Math.min(16, actualRowH * 0.52));
  // Same contract as lineChart: an unknown name highlights nothing rather than
  // dimming everything.
  const want = o.highlight == null || o.highlight === '' ? null : String(o.highlight);
  const highlight = want !== null && rows.some((r) => r.key === want) ? want : null;

  rows.forEach((r, i) => {
    const cy = M.top + actualRowH * (i + 0.5);
    const isDim = Boolean(highlight) && r.key !== highlight;
    const rowOp = isDim ? 0.22 : 1;
    // clamp: a whisker end that sits inside the box would draw backwards
    const wLo = Math.min(r.min, r.q1);
    const wHi = Math.max(r.max, r.q3);
    const x1 = x(wLo), x2 = x(wHi);
    const bx1 = x(r.q1), bx2 = x(r.q3);
    const boxW = Math.max(1.5, bx2 - bx1); // a zero-IQR team still shows a sliver

    const summary = `${r.name}: min ${fmt(r.min)}, Q1 ${fmt(r.q1)}, median ${fmt(r.median)}, ` +
      `Q3 ${fmt(r.q3)}, max ${fmt(r.max)}`;

    parts.push(
      `<g opacity="${rowOp}"><title>${esc(summary)}</title>` +
      // whisker rule + end caps
      `<line x1="${x1.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${cy.toFixed(1)}" ` +
      `stroke="${esc(r.color)}" stroke-width="1.5" opacity="0.75"/>` +
      `<line x1="${x1.toFixed(1)}" y1="${(cy - boxH * 0.32).toFixed(1)}" x2="${x1.toFixed(1)}" ` +
      `y2="${(cy + boxH * 0.32).toFixed(1)}" stroke="${esc(r.color)}" stroke-width="1.5" opacity="0.75"/>` +
      `<line x1="${x2.toFixed(1)}" y1="${(cy - boxH * 0.32).toFixed(1)}" x2="${x2.toFixed(1)}" ` +
      `y2="${(cy + boxH * 0.32).toFixed(1)}" stroke="${esc(r.color)}" stroke-width="1.5" opacity="0.75"/>` +
      // interquartile box
      `<rect x="${bx1.toFixed(1)}" y="${(cy - boxH / 2).toFixed(1)}" width="${boxW.toFixed(1)}" ` +
      `height="${boxH.toFixed(1)}" rx="3" fill="${esc(r.color)}"/>` +
      // median: a 2px gap in the surface color, not an extra stroke of ink
      `<line x1="${x(r.median).toFixed(1)}" y1="${(cy - boxH / 2).toFixed(1)}" ` +
      `x2="${x(r.median).toFixed(1)}" y2="${(cy + boxH / 2).toFixed(1)}" ` +
      `stroke="${C.surface}" stroke-width="2"/>` +
      `</g>`
    );

    for (const ov of r.outliers) {
      parts.push(
        `<circle cx="${x(ov).toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="${esc(r.color)}" ` +
        `stroke="${C.surface}" stroke-width="1.5" opacity="${(0.9 * rowOp).toFixed(2)}">` +
        `<title>${esc(r.name)} outlier: ${esc(fmt(ov))}</title></circle>`
      );
    }

    // Row label in the gutter, in text ink - the colored box beside it carries
    // identity. Truncated (never clipped) if the gutter is too narrow; the full
    // name stays in the row's <title>.
    const labelMax = M.left - 14;
    parts.push(
      `<text x="${(M.left - 10).toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="end" ` +
      `fill="${isDim ? C.dim : C.text}" font-size="${LABEL_SIZE}" ` +
      `font-weight="${highlight && !isDim ? 600 : 400}">` +
      `<title>${esc(r.name)}</title>${esc(truncateToWidth(r.name, LABEL_SIZE, labelMax))}</text>`
    );

    // A FULL-WIDTH INVISIBLE BAND PER ROW, so the five numbers can be read on a
    // phone. Everything above puts them in an SVG <title>, which iOS Safari
    // draws nothing for — so a box plot there was ten coloured smears against a
    // "Points" axis and no way to get a number out of it. The band is the whole
    // row rather than the box, because a whisker is 1.5px of ink and a median a
    // 2px gap: aiming a thumb at either is not a thing that happens.
    //
    // Drawn LAST so it sits above the marks and takes the pointer, and it
    // includes the label gutter so tapping a team's name works too, which is
    // the obvious thing to try.
    parts.push(
      `<rect class="ff-box-hit" data-i="${i}" x="0" y="${(cy - actualRowH / 2).toFixed(1)}" ` +
      `width="${W}" height="${actualRowH.toFixed(1)}" fill="transparent"/>`
    );
  });

  const markup =
    `<svg viewBox="0 0 ${W} ${height}" width="100%" role="img" ` +
    `aria-label="${esc('Distribution by team' + (o.xLabel ? ' (' + o.xLabel + ')' : ''))}" ` +
    `style="width:100%;height:auto;display:block;font-family:${FONT}">${parts.join('')}</svg>`;

  const svg = mount(container, markup);
  if (!svg) return null;

  // The same shared tooltip the line chart and the histogram use, so a box
  // plot's numbers arrive looking like every other number on the site. Five
  // rows, because a five-number summary is five facts and running them into one
  // sentence is what the <title> was already doing badly.
  const tip = createTooltip(container, { navigate: o.navigate });
  const hits = typeof svg.querySelectorAll === 'function' ? svg.querySelectorAll('.ff-box-hit') : [];
  if (tip) {
    for (const hit of hits) {
      const r = rows[+hit.getAttribute('data-i')];
      if (!r) continue;
      // `pointerdown` as well as `pointermove`: a finger produces no move before
      // it lands, so without it a tap does nothing at all. Same pair, and the
      // same reason, as the histogram's bars.
      const enter = (evt) => {
        const p = pointerPos(svg, container, evt);
        tip.show(r.name, [
          { color: r.color, name: 'median', value: fmt(r.median) },
          { name: 'Q1 – Q3', value: `${fmt(r.q1)} – ${fmt(r.q3)}` },
          { name: 'min – max', value: `${fmt(r.min)} – ${fmt(r.max)}` },
        ], p.px, p.py, r.href || null);
      };
      hit.addEventListener('pointermove', enter);
      hit.addEventListener('pointerdown', enter);
      hit.addEventListener('pointerleave', () => tip.hide());
    }
  }

  observeWidth(container, () => boxPlot(container, o));
  return svg;
}

/* ================================================================== *
 * 4. Scatter: projected against actual
 * ================================================================== */

/**
 * The least-squares regression line (LSRL) through a set of points.
 *
 *   slope     = Sxy / Sxx
 *   intercept = mean(y) - slope * mean(x)
 *   r         = Sxy / sqrt(Sxx * Syy)
 *
 * where Sxx, Syy and Sxy are the sums of squared (and cross) deviations from
 * the two means. A pair with either half missing or non-finite is not a point
 * and is skipped, never counted as zero.
 *
 * @param {Array} points  [{ x, y }]
 * @returns {{slope:number, intercept:number, r:number|null, r2:number|null, n:number}|null}
 *   null with fewer than two points, or when every x is the same (a vertical
 *   cloud has no slope). `r` is null when every y is the same: the line is
 *   flat and real, but there is no y-variance to correlate with. `r2` is r
 *   squared - the share of the differences in y the line accounts for, 1 when
 *   every point is on it - and null whenever r is.
 */
export function leastSquares(points) {
  if (!Array.isArray(points)) return null;
  let n = 0, sx = 0, sy = 0;
  const kept = [];
  for (const p of points) {
    if (!p || !isNum(p.x) || !isNum(p.y)) continue;
    kept.push(p);
    n++; sx += p.x; sy += p.y;
  }
  if (n < 2) return null;
  const mx = sx / n, my = sy / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of kept) {
    const dx = p.x - mx, dy = p.y - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  if (!(sxx > 1e-12)) return null;
  const slope = sxy / sxx;
  const r = syy > 1e-12 ? sxy / Math.sqrt(sxx * syy) : null;
  return {
    slope,
    intercept: my - slope * mx,
    r,
    r2: r === null ? null : r * r,
    n,
  };
}

/**
 * How far the fitted line sits from the perfect one, y = x, in the units of
 * the axes (points): the mean of |(slope * x + intercept) - x| taken at every
 * point's x. It is averaged over the POINTS, not along the axis, so it answers
 * "for the projections that were actually made, how far off perfect was the
 * line on average". 0 means the two lines coincide wherever there is a dot.
 *
 * @param {Array} points  [{ x, y }] - the same points the line was fitted to
 * @param {Object|null} [fit]  a leastSquares() result; fitted here if omitted
 * @returns {number|null}  null when there is no line (see leastSquares)
 */
export function offPerfect(points, fit) {
  if (!Array.isArray(points)) return null;
  const f = fit === undefined ? leastSquares(points) : fit;
  if (!f || !isNum(f.slope) || !isNum(f.intercept)) return null;
  let n = 0, sum = 0;
  for (const p of points) {
    if (!p || !isNum(p.x) || !isNum(p.y)) continue;
    sum += Math.abs(f.slope * p.x + f.intercept - p.x);
    n++;
  }
  return n ? sum / n : null;
}

/** The part of y = slope*x + intercept that lies inside the square [lo, hi]². */
function clipToSquare(slope, intercept, lo, hi) {
  let x1 = lo, x2 = hi;
  if (Math.abs(slope) < 1e-12) {
    if (intercept < lo || intercept > hi) return null;
  } else {
    const xa = (lo - intercept) / slope, xb = (hi - intercept) / slope;
    x1 = Math.max(lo, Math.min(xa, xb));
    x2 = Math.min(hi, Math.max(xa, xb));
    if (!(x2 > x1)) return null;
  }
  return { x1, y1: slope * x1 + intercept, x2, y2: slope * x2 + intercept };
}

/** Points to a tenth, always with the decimal: 110.0, not 110. */
const tenth = (v) => (Math.round(v * 10) / 10).toFixed(1);

/**
 * Scatter of actual (up) against projected (across), with two lines on it:
 * the DOTTED y = x a perfect projection would sit on, and the SOLID
 * least-squares line the dots actually make.
 *
 * ONE SCALE SERVES BOTH AXES. The domain is fitted to every x and every y
 * together, so y = x runs corner to corner of the plot and a dot above the
 * dotted line really did beat its projection. Two separately "nice" axes would
 * tilt that line and make the picture a lie.
 *
 * THE PREVIEW IS A LINK. Hovering a dot (or tapping it - a finger has no
 * hover) opens a small overlay naming it; the overlay is an <a href> to that
 * performance and stays open while the pointer travels from the dot onto it.
 * It is absolutely positioned inside the container, so nothing on the page
 * moves or resizes. There is ONE set of listeners on the svg, not one per dot:
 * a season of players is ~2,700 dots, found by a nearest-dot scan.
 *
 * ANY CLICK ON THE CHART FOLLOWS THE PREVIEWED DOT (Tim, 2026-10-04: "if you
 * click at all while a specific point is selected (or being previewed)
 * whatsoever, bring it to the specific reference, not just if you click on the
 * preview box"). A mouse: hover previews, a click anywhere on the chart goes.
 * A finger: the first tap on a dot selects it, the next tap anywhere on the
 * chart goes - except a tap on a DIFFERENT dot, which moves the selection so
 * dots can be browsed. The preview stays a real link (keyboard, new tab).
 *
 * GROUPS (optional). With `groups`, each dot takes its group's colour and a
 * row of chips under the chart names the groups that have a dot. Pressing a
 * chip FOCUSES that group: the rest turn into a dim grey background that the
 * pointer cannot find, and the solid line is refitted to the focused dots
 * alone (the dotted perfect line and the axes never change). Pressing it again
 * clears the focus. The chips are HTML under the svg, so they are not "the
 * chart" for the click rule above.
 *
 * @param {Element} container
 * @param {Object}  opts
 * @param {Array}   opts.points   [{ x, y, name, detail?, week?, href?, key?, color? }]
 *                                x = projected, y = actual. `name` and `detail`
 *                                are untrusted text. `key` is what `highlight`
 *                                matches (rule 9: a team id, never a label).
 * @param {string}  [opts.xLabel]
 * @param {string}  [opts.yLabel]
 * @param {number}  [opts.height=320]  height of the plot block; the key adds a
 *                                     row below it
 * @param {string|number} [opts.highlight] key to emphasise
 * @param {string}  [opts.empty]   what to say when there is nothing to plot
 * @param {string}  [opts.perfectLabel='Perfect projection']
 * @param {string}  [opts.fitLabel='Best-fit line']
 * @param {Array}   [opts.groups]  [{ key, label, color }] in legend order; a
 *                                 point joins one through its `group`. Labels
 *                                 are untrusted text.
 * @param {string|number} [opts.focus]  group key to focus (see above)
 * @param {Function} [opts.onFocus]  (key|null, svg) after a chip changed the
 *                                 focus and the chart redrew itself
 * @param {string}  [opts.groupLabel]  accessible name of the chip row
 * @param {Function} [opts.navigate]  (href, event) - replaces the page
 *                                 navigation a click on the chart performs
 * @param {Object}  [opts.card]    A DOT CAN CARRY A PLAYER CARD (2026-10-08).
 *                                 `{ show(key, dotEl, point), hide() }` - pass
 *                                 js/player-card.js `{ show: showCard, hide:
 *                                 hideTip }`. A point with a `card` (the key
 *                                 `registerRun` returned) then opens that card
 *                                 beside its dot INSTEAD of the small text
 *                                 preview; a point without one previews as
 *                                 before. Selecting, the ring and the
 *                                 click-through to `href` do not change. This
 *                                 file imports nothing: the page hands the
 *                                 card in.
 * @returns {SVGElement|null}  on the svg: `__ffFit` (the line, or null),
 *   `__ffFitPoints` (the points it was fitted to: all of them, or the focused
 *   group) and `__ffGap` (offPerfect of those)
 */
export function scatterChart(container, opts) {
  if (!container || typeof container !== 'object') return null;
  const o = opts || {};
  const height = isNum(o.height) && o.height > 120 ? o.height : 320;

  // Whatever the last render in this container left running.
  if (typeof container.__ffScatterOff === 'function') container.__ffScatterOff();
  container.__ffScatterOff = null;

  const pts = (Array.isArray(o.points) ? o.points : [])
    .filter((p) => p && isNum(p.x) && isNum(p.y));
  if (!pts.length) return emptyState(container, o.empty || 'No data to chart', height);

  resetContainer(container);
  const W = measureWidth(container);
  const M = { top: 14, right: 16, bottom: 46, left: 54 };
  const plotW = Math.max(10, W - M.left - M.right);
  const plotH = Math.max(40, height - M.top - M.bottom);

  // --- one domain for both axes ------------------------------------------
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) {
    if (p.x < lo) lo = p.x; if (p.y < lo) lo = p.y;
    if (p.x > hi) hi = p.x; if (p.y > hi) hi = p.y;
  }
  const S = niceScale(lo, hi, 5);
  const span = S.hi - S.lo || 1;
  const x = (v) => M.left + ((v - S.lo) / span) * plotW;
  const y = (v) => M.top + plotH - ((v - S.lo) / span) * plotH;

  const parts = [];
  const xEvery = Math.max(1, Math.ceil(S.ticks.length / Math.max(2, Math.floor(plotW / 40))));
  S.ticks.forEach((t, i) => {
    const ty = y(t), tx = x(t);
    parts.push(
      `<line x1="${M.left}" y1="${ty.toFixed(1)}" x2="${M.left + plotW}" y2="${ty.toFixed(1)}" ` +
      `stroke="${C.grid}" stroke-width="1"/>`,
      `<text x="${M.left - 8}" y="${(ty + 4).toFixed(1)}" text-anchor="end" fill="${C.dim}" ` +
      `font-size="${TICK_SIZE}" style="font-variant-numeric:tabular-nums">${esc(fmt(t))}</text>`
    );
    if (i % xEvery === 0 || i === S.ticks.length - 1) {
      parts.push(
        `<text x="${tx.toFixed(1)}" y="${M.top + plotH + 18}" text-anchor="middle" fill="${C.dim}" ` +
        `font-size="${TICK_SIZE}" style="font-variant-numeric:tabular-nums">${esc(fmt(t))}</text>`
      );
    }
  });
  if (o.yLabel) {
    parts.push(
      `<text transform="translate(13,${M.top + plotH / 2}) rotate(-90)" text-anchor="middle" ` +
      `fill="${C.dim}" font-size="${TICK_SIZE}">${esc(o.yLabel)}</text>`
    );
  }
  if (o.xLabel) {
    parts.push(
      `<text x="${(M.left + plotW / 2).toFixed(1)}" y="${M.top + plotH + 38}" text-anchor="middle" ` +
      `fill="${C.dim}" font-size="${TICK_SIZE}">${esc(o.xLabel)}</text>`
    );
  }
  parts.push(
    `<line x1="${M.left}" y1="${M.top + plotH}" x2="${M.left + plotW}" y2="${M.top + plotH}" ` +
    `stroke="${C.axis}" stroke-width="1"/>`
  );

  // --- dots ---------------------------------------------------------------
  // Smaller and more see-through as they multiply, so a pile-up reads as
  // density instead of a solid blot. No <title> per dot: the preview carries
  // identity, and thousands of titles are markup nobody reads.
  const n = pts.length;
  const r = n > 600 ? 2.5 : n > 150 ? 3 : 4;
  let alpha = n > 600 ? 0.25 : n > 150 ? 0.5 : 0.7;
  const base = SERIES_COLORS[0];
  const want = o.highlight == null || o.highlight === '' ? null : String(o.highlight);
  const isHi = (p) => want !== null && p.key != null && String(p.key) === want;

  // Groups: only the ones that own a dot are offered, in the caller's order.
  const gkey = (p) => (p.group == null ? null : String(p.group));
  const seen = new Set();
  for (const p of pts) { const k = gkey(p); if (k !== null) seen.add(k); }
  const groups = (Array.isArray(o.groups) ? o.groups : [])
    .filter((g) => g && g.key != null && seen.has(String(g.key)));
  const colorOf = new Map(groups.map((g) => [String(g.key), g.color]));
  const grouped = groups.length > 0;
  const focusKey = grouped && o.focus != null && colorOf.has(String(o.focus)) ? String(o.focus) : null;
  // The dots a pointer can find and the line is fitted to.
  const live = [];
  pts.forEach((p, i) => { if (focusKey === null || gkey(p) === focusKey) live.push(i); });
  const isLive = focusKey === null ? null : new Set(live);
  if (grouped) {
    // Colour has to be told apart, which a quarter-opaque dot cannot do.
    const m = live.length;
    alpha = m > 600 ? 0.5 : m > 150 ? 0.7 : 0.85;
  }

  const px = new Array(n), py = new Array(n);
  const dim = [], back = [], front = [];
  pts.forEach((p, i) => {
    px[i] = x(p.x); py[i] = y(p.y);
    const at = `data-i="${i}" cx="${px[i].toFixed(1)}" cy="${py[i].toFixed(1)}"`;
    if (isLive && !isLive.has(i)) {
      dim.push(`<circle class="ff-dot ff-dot-dim" ${at} r="${r}" fill="${C.dim}" ` +
        `fill-opacity="${n > 600 ? 0.07 : 0.18}"/>`);
      return;
    }
    const own = p.color || (grouped ? colorOf.get(gkey(p)) : null);
    const fill = own ? ` fill="${esc(own)}"` : '';
    if (isHi(p)) {
      front.push(
        `<circle class="ff-dot ff-dot-hi" ${at} r="${r + 1.5}"${fill} fill-opacity="1" ` +
        `stroke="${C.text}" stroke-width="1.5"/>`
      );
    } else {
      back.push(`<circle class="ff-dot" ${at} r="${r}"${fill}/>`);
    }
  });
  parts.push(`<g class="ff-dots" fill="${base}" fill-opacity="${alpha}">${dim.join('')}${back.join('')}${front.join('')}</g>`);

  // --- the two lines, over the dots so neither is buried ------------------
  parts.push(
    `<line class="ff-perfect" x1="${x(S.lo).toFixed(1)}" y1="${y(S.lo).toFixed(1)}" ` +
    `x2="${x(S.hi).toFixed(1)}" y2="${y(S.hi).toFixed(1)}" stroke="${C.dim}" stroke-width="2" ` +
    `stroke-dasharray="1 6" stroke-linecap="round" pointer-events="none"/>`
  );
  // Fitted to what is highlighted: every dot, or the focused group alone.
  const fitPts = isLive ? live.map((i) => pts[i]) : pts;
  const fit = leastSquares(fitPts);
  const seg = fit ? clipToSquare(fit.slope, fit.intercept, S.lo, S.hi) : null;
  if (seg) {
    parts.push(
      `<line class="ff-fit" x1="${x(seg.x1).toFixed(1)}" y1="${y(seg.y1).toFixed(1)}" ` +
      `x2="${x(seg.x2).toFixed(1)}" y2="${y(seg.y2).toFixed(1)}" stroke="${C.text}" stroke-width="2" ` +
      `stroke-linecap="round" pointer-events="none"/>`
    );
  }

  // the ring that marks the dot a preview belongs to
  parts.push(
    `<circle class="ff-scatter-focus" cx="0" cy="0" r="${r + 3.5}" fill="none" stroke="${C.text}" ` +
    `stroke-width="2" opacity="0" pointer-events="none"/>`
  );

  // --- key: which line is which ------------------------------------------
  const ky = height + 8;
  let kx = 4;
  const keyItem = (label, dashed) => {
    const out =
      `<line x1="${kx}" y1="${ky}" x2="${kx + 20}" y2="${ky}" stroke="${dashed ? C.dim : C.text}" ` +
      `stroke-width="2" stroke-linecap="round"${dashed ? ' stroke-dasharray="1 6"' : ''}/>` +
      `<text x="${kx + 26}" y="${ky + 4}" fill="${C.text}" font-size="${LABEL_SIZE}">${esc(label)}</text>`;
    kx += 26 + textWidth(label, LABEL_SIZE) + 18;
    return out;
  };
  parts.push(keyItem(o.perfectLabel || 'Perfect projection', true));
  if (seg) parts.push(keyItem(o.fitLabel || 'Best-fit line', false));

  const totalH = height + 22;
  const label = `${o.yLabel || 'Actual'} against ${o.xLabel || 'projected'}, ${n} dots`;
  const markup =
    `<svg viewBox="0 0 ${W} ${totalH}" width="100%" role="img" aria-label="${esc(label)}" ` +
    `style="width:100%;height:auto;display:block;font-family:${FONT}">${parts.join('')}</svg>`;

  const svg = mount(container, markup);
  if (!svg) return null;
  svg.__ffFit = fit;
  svg.__ffFitPoints = fitPts;
  svg.__ffGap = offPerfect(fitPts, fit);

  // --- the preview --------------------------------------------------------
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return svg;
  try {
    const computed = typeof getComputedStyle === 'function' ? getComputedStyle(container).position : '';
    if (!computed || computed === 'static') container.style.position = 'relative';
  } catch (_) { /* non-DOM environment: skip */ }

  const tip = document.createElement('a');
  tip.setAttribute('class', 'ff-scatter-tip');
  tip.setAttribute('hidden', '');
  tip.style.cssText =
    'position:absolute;left:0;top:0;z-index:5;display:none;text-decoration:none;' +
    'background:var(--bg,#0f1115);border:1px solid var(--line,#272c36);border-radius:6px;' +
    'padding:7px 10px;font:' + LABEL_SIZE + 'px/1.5 ' + FONT + ';color:var(--text,#e6e8ec);' +
    'white-space:nowrap;box-shadow:0 4px 14px rgba(0,0,0,.45);max-width:240px;' +
    'overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums';
  container.appendChild(tip);
  const focus = svg.querySelector('.ff-scatter-focus');

  // --- the group chips ------------------------------------------------------
  // HTML under the svg (css/app.css `.ff-scatter-legend`), built from text
  // nodes. One listener on the row. A press redraws this chart with the new
  // focus and then tells the caller, whose numbers follow the solid line.
  if (grouped) {
    const legend = document.createElement('div');
    legend.setAttribute('class', 'ff-scatter-legend');
    legend.setAttribute('role', 'group');
    legend.setAttribute('aria-label', o.groupLabel || 'Groups');
    for (const g of groups) {
      const b = document.createElement('button');
      b.setAttribute('type', 'button');
      b.setAttribute('class', 'ff-chip');
      b.setAttribute('data-group', String(g.key));
      b.setAttribute('aria-pressed', focusKey === String(g.key) ? 'true' : 'false');
      const sw = document.createElement('span');
      sw.setAttribute('class', 'ff-chip-sw');
      sw.setAttribute('style', 'background:' + String(g.color || base));
      b.appendChild(sw);
      const lb = document.createElement('span');
      lb.setAttribute('class', 'ff-chip-label');
      lb.textContent = g.label == null ? String(g.key) : String(g.label);
      b.appendChild(lb);
      legend.appendChild(b);
    }
    legend.addEventListener('click', (evt) => {
      const t = evt.target;
      const b = t && typeof t.closest === 'function' ? t.closest('button[data-group]') : null;
      if (!b) return;
      const k = b.getAttribute('data-group');
      const g = groups.find((it) => String(it.key) === k);
      o.focus = !g || focusKey === k ? null : g.key;
      const next = scatterChart(container, o);
      // The chip pressed was replaced by the redraw: hand the keyboard back.
      for (const nb of container.querySelectorAll('button[data-group]')) {
        if (nb.getAttribute('data-group') === k && typeof nb.focus === 'function') {
          try { nb.focus({ preventScroll: true }); } catch (_) { /* not focusable here */ }
        }
      }
      if (typeof o.onFocus === 'function') o.onFocus(o.focus, next);
    });
    container.appendChild(legend);
  }

  const cardHook = o.card && typeof o.card.show === 'function' ? o.card : null;
  let cardOpen = false;   // is the caller's card (not the text preview) what is showing?
  let active = -1;        // index of the dot the preview is showing
  let pending = -1;       // a different dot the pointer has moved onto
  let hideTimer = null, switchTimer = null;
  let overTip = false;

  const geometry = () => {
    const has = typeof svg.getBoundingClientRect === 'function' &&
      typeof container.getBoundingClientRect === 'function';
    const sr = has ? svg.getBoundingClientRect() : { left: 0, top: 0, width: W };
    const cr = has ? container.getBoundingClientRect() : { left: 0, top: 0 };
    return { sr, cr, scale: sr.width ? W / sr.width : 1 };
  };

  /** Nearest dot to a client position, within `reach` CSS px; -1 for none. */
  const nearest = (evt, reach) => {
    const g = geometry();
    const ux = (evt.clientX - g.sr.left) * g.scale;
    const uy = (evt.clientY - g.sr.top) * g.scale;
    const lim = reach * g.scale;
    let best = -1, bestD = lim * lim;
    // Only the previewable dots: a dimmed one is background, not a target.
    for (let k = 0; k < live.length; k++) {
      const i = live[k];
      const dx = px[i] - ux, dy = py[i] - uy;
      const d = dx * dx + dy * dy;
      if (d <= bestD) { bestD = d; best = i; }
    }
    return best;
  };

  const line = (text, dim) => {
    const el = document.createElement('div');
    if (dim) el.style.cssText = 'color:var(--dim,#8b93a1)';
    el.textContent = text;
    return el;
  };

  function show(i) {
    clearTimeout(hideTimer); hideTimer = null;
    clearTimeout(switchTimer); switchTimer = null;
    pending = -1;
    active = i;
    const p = pts[i];

    // Built from text nodes only: names are untrusted.
    tip.textContent = '';
    const head = document.createElement('div');
    const nm = document.createElement('strong');
    nm.style.cssText = 'font-weight:600';
    nm.textContent = p.name == null ? '' : String(p.name);
    head.appendChild(nm);
    if (p.detail) {
      const d = document.createElement('span');
      d.style.cssText = 'color:var(--dim,#8b93a1);margin-left:6px';
      d.textContent = String(p.detail);
      head.appendChild(d);
    }
    tip.appendChild(head);
    if (p.week != null) tip.appendChild(line(`Week ${p.week}`, true));
    tip.appendChild(line(`Proj ${tenth(p.x)} · Actual ${tenth(p.y)}`, false));
    if (p.href) tip.setAttribute('href', String(p.href));
    else tip.removeAttribute('href');
    // A dot that carries a card opens the card, and the text preview stays shut.
    const carded = cardHook && p.card != null && p.card !== '';
    if (cardOpen && !carded) { cardOpen = false; if (typeof cardHook.hide === 'function') cardHook.hide(); }
    if (carded) {
      tip.setAttribute('hidden', '');
      tip.style.display = 'none';
      const dot = typeof svg.querySelector === 'function' ? svg.querySelector(`circle[data-i="${i}"]`) : null;
      cardOpen = true;
      cardHook.show(p.card, dot || focus || svg, p);
    } else {
      tip.removeAttribute('hidden');
      tip.style.display = 'block';
    }

    if (focus) {
      focus.setAttribute('cx', px[i].toFixed(1));
      focus.setAttribute('cy', py[i].toFixed(1));
      focus.setAttribute('opacity', '1');
    }
    // While a preview is up the whole chart is its link.
    if (svg.style) svg.style.cursor = p.href ? 'pointer' : '';

    // Beside the DOT, not the pointer, so it holds still and can be reached:
    // above-right by default, flipped where it would leave the container.
    const g = geometry();
    const dotX = g.sr.left - g.cr.left + px[i] / g.scale;
    const dotY = g.sr.top - g.cr.top + py[i] / g.scale;
    const cw = container.clientWidth || W;
    const tw = tip.offsetWidth || 170;
    const th = tip.offsetHeight || 64;
    let left = dotX + 10;
    if (left + tw > cw - 2) left = dotX - 10 - tw;
    left = Math.max(2, Math.min(left, cw - tw - 2));
    let top = dotY - th - 8;
    if (top < 2) top = dotY + 10;
    tip.style.left = left.toFixed(0) + 'px';
    tip.style.top = top.toFixed(0) + 'px';
  }

  function hide() {
    clearTimeout(hideTimer); hideTimer = null;
    clearTimeout(switchTimer); switchTimer = null;
    pending = -1;
    active = -1;
    // Both: the inline `display` is what actually hides it (an inline display
    // outranks the browser's own [hidden] rule); the attribute says so.
    tip.setAttribute('hidden', '');
    tip.style.display = 'none';
    if (cardOpen) { cardOpen = false; if (typeof cardHook.hide === 'function') cardHook.hide(); }
    if (focus) focus.setAttribute('opacity', '0');
    if (svg.style) svg.style.cursor = '';
  }

  const hideSoon = (ms) => {
    if (hideTimer) return;
    hideTimer = setTimeout(() => { hideTimer = null; if (!overTip) hide(); }, ms);
  };

  // A MOUSE. The first dot opens at once. Once a preview is open, a different
  // dot under the pointer waits a moment before taking over: on the way from a
  // dot to its preview the pointer crosses other dots, and a preview that
  // jumped to each of them could never be clicked.
  const onMove = (evt) => {
    if (evt.pointerType === 'touch') return;
    const i = nearest(evt, 12);
    if (svg.style) svg.style.cursor = i >= 0 || active >= 0 ? 'pointer' : '';
    if (i < 0) {
      clearTimeout(switchTimer); switchTimer = null; pending = -1;
      if (active >= 0) hideSoon(350);
      return;
    }
    if (i === active) {
      clearTimeout(hideTimer); hideTimer = null;
      clearTimeout(switchTimer); switchTimer = null; pending = -1;
      return;
    }
    if (active < 0) { show(i); return; }
    clearTimeout(hideTimer); hideTimer = null;
    pending = i;
    if (!switchTimer) {
      switchTimer = setTimeout(() => {
        switchTimer = null;
        if (pending >= 0 && !overTip) show(pending);
      }, 140);
    }
  };

  // A PRESS. `armed` says whether the click this press ends in should follow
  // the previewed dot's link.
  //   finger  no hover exists, so the first tap on a dot only SELECTS it. With
  //           a dot selected, a tap on a different dot moves the selection
  //           (browsing), and a tap anywhere else on the chart goes.
  //   mouse   the dot is already previewed by the hover, so any press goes to
  //           it - including one that lands on another dot on the way.
  let armed = false;
  const onDown = (evt) => {
    const touch = evt.pointerType === 'touch';
    const i = nearest(evt, touch ? 24 : 12);
    if (touch) {
      if (i >= 0 && i !== active) { armed = false; show(i); return; }
      armed = active >= 0;
    } else {
      if (active < 0 && i >= 0) show(i);
      armed = active >= 0;
    }
    // The press has claimed the preview: it must still be there at the click.
    if (armed) { clearTimeout(hideTimer); hideTimer = null; }
  };

  const go = typeof o.navigate === 'function'
    ? o.navigate
    : (href, evt) => {
      if (typeof window === 'undefined' || !window) return;
      const aside = evt && (evt.ctrlKey || evt.metaKey || evt.shiftKey);
      if (aside && typeof window.open === 'function') window.open(href, '_blank', 'noopener');
      else if (window.location) window.location.href = href;
    };
  const onClick = (evt) => {
    const was = armed;
    armed = false;
    if (!was || active < 0) return;
    const href = pts[active].href;
    if (!href) return;
    go(String(href), evt);
  };

  // A lifted finger also "leaves" - which must not take away the preview the
  // tap just opened, or there would be nothing left to tap.
  const onLeave = (evt) => {
    if (evt.pointerType === 'touch') return;
    clearTimeout(switchTimer); switchTimer = null; pending = -1;
    if (active >= 0) hideSoon(350);
  };

  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerdown', onDown);
  svg.addEventListener('pointerleave', onLeave);
  svg.addEventListener('click', onClick);
  tip.addEventListener('pointerenter', () => {
    overTip = true;
    clearTimeout(hideTimer); hideTimer = null;
    clearTimeout(switchTimer); switchTimer = null; pending = -1;
  });
  tip.addEventListener('pointerleave', (evt) => {
    overTip = false;
    if (evt.pointerType === 'touch') return;
    hideSoon(250);
  });

  // A press anywhere else on the page dismisses it (the phone's "tap away").
  const onDoc = (evt) => {
    if (active < 0) return;
    // The chart is the svg and its preview; the chips under it are not.
    const t = evt.target;
    const inside = (el) => !!t && !!el && typeof el.contains === 'function' && el.contains(t);
    if (inside(svg) || inside(tip)) return;
    hide();
  };
  const canDoc = typeof document.addEventListener === 'function';
  if (canDoc) document.addEventListener('pointerdown', onDoc);
  container.__ffScatterOff = () => {
    clearTimeout(hideTimer); clearTimeout(switchTimer);
    if (cardOpen) { cardOpen = false; if (typeof cardHook.hide === 'function') cardHook.hide(); }
    if (canDoc) document.removeEventListener('pointerdown', onDoc);
  };

  observeWidth(container, () => scatterChart(container, o));
  return svg;
}
