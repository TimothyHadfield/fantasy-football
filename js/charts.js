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
 * ------------------------------------------------------------------ */
function createTooltip(container) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
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
   */
  function show(title, rows, x, y) {
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

  function hide() { el.style.opacity = '0'; }

  return { el, show, hide };
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
 * @param {Array}   opts.series     [{ name, values:number[], color? }]
 * @param {Array}   opts.xLabels    category labels, one per x position
 * @param {string}  opts.yLabel
 * @param {number}  [opts.height=300]   height of the plot block; the legend
 *                                      adds its own rows below it
 * @param {boolean} [opts.zeroLine]  draw a reference rule at y = 0
 * @param {string}  [opts.highlight] series name to emphasize; others dim
 * @param {number[]} [opts.yDomain]  explicit [lo, hi], replacing the computed
 *                                   scale. For giving several small charts one
 *                                   shared axis so their heights are comparable
 *                                   - which the per-chart "nice" scale, fitted
 *                                   to each chart's own data, cannot be.
 *                                   Ignored if not two finite, unequal numbers.
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
    .map((s, i) => ({
      name: String(s.name == null ? 'Series ' + (i + 1) : s.name),
      values: s.values.map((v) => (isNum(v) ? v : NaN)),
      color: s.color || SERIES_COLORS[i % SERIES_COLORS.length],
    }))
    .filter((s) => s.values.some(isNum));

  if (!series.length) return emptyState(container, 'No data to chart', height);

  const nPoints = Math.max(...series.map((s) => s.values.length));
  if (nPoints < 1) return emptyState(container, 'No data to chart', height);

  const xLabels = Array.isArray(o.xLabels) ? o.xLabels : [];
  const highlight = o.highlight && series.some((s) => s.name === o.highlight) ? o.highlight : null;

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
  const dimmed = (name) => highlight && name !== highlight;
  const backParts = [];  // dimmed series - painted first
  const frontParts = []; // emphasized (or all, when nothing is highlighted)
  const dotParts = [];
  const labelParts = [];

  series.forEach((s) => {
    const isDim = dimmed(s.name);
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
      const isDim = dimmed(s.name);
      parts.push(
        `<g class="ff-legend-item" data-name="${esc(s.name)}" style="cursor:pointer" ` +
        `opacity="${isDim ? 0.4 : 1}" tabindex="0" role="button" aria-label="${esc(s.name)}">` +
        `<title>${esc(s.name)}</title>` +
        `<rect x="${cx}" y="${cy - 12}" width="${(iw - 10).toFixed(1)}" height="${rowH}" fill="transparent"/>` +
        `<line x1="${cx}" y1="${cy}" x2="${cx + 16}" y2="${cy}" stroke="${esc(s.color)}" ` +
        `stroke-width="${highlight === s.name ? 3 : 2}" stroke-linecap="round"/>` +
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
  const tip = createTooltip(container);
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
        if (!dimmed(s.name)) {
          markers += `<circle cx="${px.toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" ` +
            `fill="${esc(s.color)}" stroke="${C.surface}" stroke-width="2"/>`;
        }
        rows.push({ color: s.color, name: s.name, value: fmt(v) });
      }
      focus.innerHTML = markers;
      focus.setAttribute('opacity', '1');
      rows.sort((a, b) => parseFloat(String(b.value).replace(/,/g, '')) - parseFloat(String(a.value).replace(/,/g, '')));
      const heading = xLabels[i] == null ? String(i + 1) : String(xLabels[i]);
      tip.show(heading, rows, p.px, p.py);
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
  const rerenderWith = (name) => lineChart(container, Object.assign({}, o, { highlight: name }));
  const items = typeof svg.querySelectorAll === 'function' ? svg.querySelectorAll('.ff-legend-item') : [];
  for (const item of items) {
    const toggle = () => {
      const name = item.getAttribute('data-name');
      rerenderWith(highlight === name ? null : name);
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

  const tip = createTooltip(container);
  const hits = typeof svg.querySelectorAll === 'function' ? svg.querySelectorAll('.ff-hit') : [];
  const bars = typeof svg.querySelectorAll === 'function' ? svg.querySelectorAll('.ff-bar') : [];
  const barByIndex = {};
  for (const b of bars) barByIndex[b.getAttribute('data-i')] = b;

  if (tip) {
    for (const hit of hits) {
      const i = hit.getAttribute('data-i');
      const bar = barByIndex[i];
      hit.addEventListener('pointermove', (evt) => {
        const p = pointerPos(svg, container, evt);
        if (bar) bar.setAttribute('opacity', '0.8');
        tip.show(bins[+i], [{ color, name: (o.yLabel || 'count'), value: fmt(counts[+i]) }], p.px, p.py);
      });
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
 * @param {Array}   opts.rows  [{ name, min, q1, median, q3, max, outliers?, color? }]
 *                             `color` pins a row to its team's palette slot -
 *                             see the note on positional fallback below.
 * @param {string}  opts.xLabel
 * @param {number}  [opts.height]     overrides the row-derived height
 * @param {string}  [opts.highlight]  row name to emphasize; the others dim,
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
    rows.push({
      name: String(r.name == null ? 'Row ' + (i + 1) : r.name),
      min: sorted[0], q1: sorted[1], median: sorted[2], q3: sorted[3], max: sorted[4],
      outliers,
      // Prefer the caller's colour. Box-plot rows normally arrive sorted by
      // median, so colouring by position here handed a team a different colour
      // than the line charts gave it (which index the team list) - breaking the
      // "a team keeps its colour everywhere" rule the palette is built on. The
      // positional fallback only applies when the caller has no opinion.
      color: r.color || SERIES_COLORS[i % SERIES_COLORS.length],
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
  const highlight = o.highlight && rows.some((r) => r.name === o.highlight) ? o.highlight : null;

  rows.forEach((r, i) => {
    const cy = M.top + actualRowH * (i + 0.5);
    const isDim = Boolean(highlight) && r.name !== highlight;
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
  });

  const markup =
    `<svg viewBox="0 0 ${W} ${height}" width="100%" role="img" ` +
    `aria-label="${esc('Distribution by team' + (o.xLabel ? ' (' + o.xLabel + ')' : ''))}" ` +
    `style="width:100%;height:auto;display:block;font-family:${FONT}">${parts.join('')}</svg>`;

  const svg = mount(container, markup);
  if (!svg) return null;
  observeWidth(container, () => boxPlot(container, o));
  return svg;
}
