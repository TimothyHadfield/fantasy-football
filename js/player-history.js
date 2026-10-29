// PLAYER ANALYSIS: one man's projections as they stood in earlier weeks.
//
// Tim, 2026-10-28: "I want to make a graph for each player that shows their
// data movement over week progress. The biggest thing I want to see is change
// in future proj over time. The X axis would be weeks and Y axis be future
// proj. This means that it's reffering to what that player's future proj was
// at that week. ... the farthest right week would be whatever the current week
// is. When you hover over a point on the graph, show that player's 13 week
// proj at the time of that point, which is what that future proj was based
// off of. ... Underneath that, make another graph that basically shows what
// each future proj was for each future week. ... Colorize the lines from red
// to green (red being earlier weeks, green being more current)."
//
// THE DATA is the saved projection copies (js/proj-history.js,
// `ff.projhist.1.<league>.<season>.<week>`): each holds every squad's men
// (`teams`) and, from 2026-10-28, the free agents (`wire`), as rows
// `[id, name, pos, team, slot, inj, [proj per week]]` lined up with `weeks`.
// A wire row (named by `wireCols`) has only the copy's first week filled and
// an 8th column `ros`, ESPN's rest-of-season total; his point is that total
// over the regular-season games left (`pointAt`). A copy without `wire` simply
// has no free agents.
// A week with no copy that holds him is a GAP, never a zero.
//
// FUTURE PROJ AT AN AS-OF WEEK is js/value.js `restProjAvg` over the
// regular-season weeks not yet started then (that week and on), a 0 and his
// bye counted as his position's waiver line (`fill`), a week with no number
// skipped — the rule the card's Proj uses, applied to that copy.
//
// Pure: no DOM, no storage. The page hands in the copies and the live weeks.

import { restProjAvg } from './value.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const COLS = ['id', 'name', 'pos', 'team', 'slot', 'inj', 'proj'];

/** Every man's row in a copy: every squad's, then the free agents' when it has them. */
export function rowsOf(rec) {
  const out = [];
  if (!rec || typeof rec !== 'object') return out;
  for (const rows of Object.values(rec.teams || {})) if (Array.isArray(rows)) out.push(...rows);
  if (Array.isArray(rec.wire)) out.push(...rec.wire);
  return out;
}

/**
 * One man in one copy: `{id, name, pos, team, byWeek}` with `byWeek` a Map of
 * week -> projection (null = no number, 0 = bye), or null when the copy does
 * not hold him.
 */
export function manIn(rec, playerId) {
  if (!rec || !Array.isArray(rec.weeks)) return null;
  const want = String(playerId);
  const squadCols = Array.isArray(rec.cols) ? rec.cols : COLS;
  // A free agent's row is named by `wireCols` when the copy has them (its 8th
  // column `ros` is ESPN's rest-of-season total), else by `cols`.
  const wireCols = Array.isArray(rec.wireCols) ? rec.wireCols : squadCols;
  const look = (rows, cols, onWire) => {
    const at = (name) => cols.indexOf(name);
    const iId = at('id');
    for (const row of rows) {
      if (!Array.isArray(row) || String(row[iId]) !== want) continue;
      const proj = Array.isArray(row[at('proj')]) ? row[at('proj')] : [];
      return {
        id: row[iId],
        name: row[at('name')] ?? '',
        pos: row[at('pos')] ?? '',
        team: row[at('team')] ?? '',
        byWeek: new Map(rec.weeks.map((w, i) => [Number(w), num(proj[i])])),
        onWire: onWire,
        ros: onWire && at('ros') >= 0 ? num(row[at('ros')]) : null,
      };
    }
    return null;
  };
  const squads = [];
  for (const rows of Object.values(rec.teams || {})) if (Array.isArray(rows)) squads.push(...rows);
  return look(squads, squadCols, false) || (Array.isArray(rec.wire) ? look(rec.wire, wireCols, true) : null);
}

/** The weeks a future proj at `asOf` is over: the regular weeks from then on (else every week of `fallback` from then on). */
export function futureWeeks(asOf, regularWeeks, fallback = []) {
  const ahead = (regularWeeks || []).map(Number).filter((w) => w >= asOf);
  if (ahead.length) return ahead;
  return (fallback || []).map(Number).filter((w) => w >= asOf);
}

/**
 * One point of the first graph.
 *
 * @returns {{asOf:number, avg:number|null, weeks:Array<{week:number, proj:number|null, used:number|null, how:'own'|'base'|'none'}>}}
 *   `used` is what the week counted as; `how` says why
 */
export function pointAt({ asOf, byWeek, weeks, byeWeek = null, fill = null, ros = null }) {
  const get = (w) => (byWeek instanceof Map ? byWeek.get(w) : byWeek ? byWeek[w] : null);
  const hasFill = num(fill) !== null;
  const isBye = (w) => byeWeek !== null && byeWeek !== undefined && Number(byeWeek) === Number(w);
  // A FREE AGENT IN A COPY has only the copy's first week (ESPN's wire is one
  // week a request), so his point is ESPN's rest-of-season total over the
  // regular-season games he has left then (his bye is not a game).
  if (num(ros) !== null) {
    const games = (weeks || []).filter((w) => !isBye(w)).length;
    return {
      asOf: Number(asOf), avg: games ? ros / games : null, ros, games,
      weeks: (weeks || []).map((w) => ({ week: w, proj: num(get(w)), used: null, how: 'ros' })),
    };
  }
  const rows = (weeks || []).map((w) => {
    const proj = num(get(w));
    if (hasFill && (isBye(w) || (proj !== null && proj <= 0))) return { week: w, proj, used: fill, how: 'base' };
    if (proj === null || proj <= 0 || isBye(w)) return { week: w, proj, used: null, how: 'none' };
    return { week: w, proj, used: proj, how: 'own' };
  });
  return { asOf: Number(asOf), avg: num(restProjAvg(byWeek, weeks, byeWeek, fill)), weeks: rows };
}

/**
 * EVERYTHING BOTH GRAPHS DRAW, for one man.
 *
 * @param {Object} o
 * @param {Array<Object>} o.copies     the stored copies (js/proj-history.js shape), any order
 * @param {*}             o.playerId
 * @param {number[]}      o.regularWeeks the league's regular-season weeks
 * @param {number|null}   [o.byeWeek]
 * @param {number|null}   [o.fill]     his position's waiver line
 * @param {{week:number, byWeek:Map|Object}|null} [o.now] the live sheet; its
 *   point replaces a copy of the same week
 * @returns {{points:Array, lines:Array<{asOf:number, live:boolean, pts:Array<{week:number, proj:number|null}>}>, firstCopy:number|null, copies:number}}
 *   `points` (graph 1) earliest first, only weeks with an average; `lines`
 *   (graph 2) earliest first; `firstCopy` the earliest copy that holds him
 */
export function history({ copies = [], playerId, regularWeeks = [], byeWeek = null, fill = null, now = null }) {
  const regular = (regularWeeks || []).map(Number).sort((a, b) => a - b);
  const sources = [];
  for (const rec of copies || []) {
    const week = Number(rec && rec.week);
    if (!Number.isFinite(week)) continue;
    const man = manIn(rec, playerId);
    if (!man) continue;
    sources.push({ asOf: week, live: false, byWeek: man.byWeek, weeks: rec.weeks.map(Number), ros: man.ros });
  }
  const held = sources.map((s) => s.asOf);
  const firstCopy = held.length ? Math.min(...held) : null;
  if (now && Number.isFinite(Number(now.week)) && now.byWeek) {
    const w = Number(now.week);
    for (let i = sources.length - 1; i >= 0; i--) if (sources[i].asOf === w) sources.splice(i, 1);
    sources.push({ asOf: w, live: true, byWeek: now.byWeek, weeks: regular });
  }
  // One per week, earliest first (two copies of one week: the first kept wins, as in the store).
  sources.sort((a, b) => a.asOf - b.asOf || Number(b.live) - Number(a.live));
  const seen = new Set();
  const uniq = sources.filter((s) => (seen.has(s.asOf) ? false : (seen.add(s.asOf), true)));

  const points = [];
  const lines = [];
  for (const s of uniq) {
    const weeks = futureWeeks(s.asOf, regular, s.weeks);
    const pt = pointAt({ asOf: s.asOf, byWeek: s.byWeek, weeks, byeWeek, fill, ros: s.ros ?? null });
    if (pt.avg !== null) points.push({ ...pt, live: s.live });
    const get = (w) => (s.byWeek instanceof Map ? s.byWeek.get(w) : s.byWeek[w]);
    // Graph 2 draws what ESPN projected: a 0 (his bye, or ruled out) and a week
    // with no number are gaps in the line, not points at 0.
    const pts = weeks.map((w) => {
      const v = num(get(w));
      return { week: w, proj: v !== null && v > 0 ? v : null };
    });
    if (pts.some((p) => p.proj !== null)) lines.push({ asOf: s.asOf, live: s.live, pts });
  }
  return { points, lines, firstCopy, copies: held.length };
}

// ------------------------------------------------------------------ colour

const RAMP = [[0xe0, 0x52, 0x5f], [0xd9, 0xa4, 0x41], [0x3b, 0xa5, 0x5d]];   // --err, --warn, --accent

/** Line `i` of `n`, red (oldest) through yellow to green (newest). One line is green. */
export function rampColor(i, n) {
  const t = n <= 1 ? 1 : Math.max(0, Math.min(1, i / (n - 1)));
  const seg = t <= 0.5 ? 0 : 1;
  const u = seg === 0 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = RAMP[seg];
  const b = RAMP[seg + 1];
  const hex = (k) => Math.round(a[k] + (b[k] - a[k]) * u).toString(16).padStart(2, '0');
  return `#${hex(0)}${hex(1)}${hex(2)}`;
}

// ------------------------------------------------------------------ drawing

const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

/** 0 up to a round top, and the ticks between. */
export function niceScale(max) {
  const top0 = Math.max(1, num(max) ?? 1);
  const step = [1, 2, 5, 10, 20, 50].find((s) => top0 / s <= 5) || 100;
  const top = Math.ceil(top0 / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return { top, ticks };
}

function frame({ width, height, weeks, top, ticks, xLabel }) {
  const L = 30, R = 10, T = 10, B = 30;
  const w = Math.max(200, width);
  const iw = w - L - R;
  const ih = height - T - B;
  const lo = weeks[0];
  const hi = weeks[weeks.length - 1];
  const x = (wk) => L + (hi === lo ? iw / 2 : ((wk - lo) / (hi - lo)) * iw);
  const y = (v) => T + ih - (v / top) * ih;
  // Every week labelled while they fit, else every other one.
  const every = iw / Math.max(1, weeks.length - 1) < 18 ? 2 : 1;
  let g = '';
  for (const t of ticks) {
    g += `<line class="pa-grid" x1="${L}" x2="${w - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>` +
      `<text class="pa-tick" x="${L - 5}" y="${(y(t) + 3.5).toFixed(1)}" text-anchor="end">${t}</text>`;
  }
  weeks.forEach((wk, i) => {
    if (i % every && wk !== hi) return;
    g += `<text class="pa-tick" x="${x(wk).toFixed(1)}" y="${T + ih + 13}" text-anchor="middle">${wk}</text>`;
  });
  g += `<text class="pa-axis" x="${L + iw / 2}" y="${height - 3}" text-anchor="middle">${xLabel}</text>`;
  return { w, x, y, g, L, R, T, ih };
}

/** A run of points as path segments, broken wherever a week is missing. */
function pathOf(pts, x, y, gapAt) {
  let d = '';
  let prev = null;
  for (const p of pts) {
    if (p.v === null) { prev = null; continue; }
    const cmd = prev !== null && !gapAt(prev, p.week) ? 'L' : 'M';
    d += `${cmd}${x(p.week).toFixed(1)},${y(p.v).toFixed(1)}`;
    prev = p.week;
  }
  return d;
}

/**
 * GRAPH 1: future proj by as-of week. Each point is a focusable
 * `g.pa-pt[data-asof]` the page hangs its preview off.
 *
 * @param {Array} points `history().points`
 * @param {{width?:number, height?:number, fromWeek:number, toWeek:number}} o
 */
export function trendSvg(points, { width = 360, height = 190, fromWeek, toWeek } = {}) {
  if (!points.length) return '';
  const lo = Math.min(fromWeek ?? points[0].asOf, points[0].asOf);
  const hi = Math.max(toWeek ?? points[points.length - 1].asOf, points[points.length - 1].asOf);
  const weeks = [];
  for (let w = lo; w <= hi; w++) weeks.push(w);
  const { top, ticks } = niceScale(Math.max(...points.map((p) => p.avg)) * 1.1);
  const fr = frame({ width, height, weeks, top, ticks, xLabel: 'As of week' });
  const run = points.map((p) => ({ week: p.asOf, v: p.avg }));
  const d = pathOf(run, fr.x, fr.y, (a, b) => b - a > 1);
  let dots = '';
  for (const p of points) {
    const cx = fr.x(p.asOf).toFixed(1);
    const cy = fr.y(p.avg).toFixed(1);
    const label = `As of week ${p.asOf}${p.live ? ' (now)' : ''}: future proj ${f1(p.avg)} a week`;
    dots += `<g class="pa-pt${p.live ? ' now' : ''}" data-asof="${p.asOf}" tabindex="0" role="img" aria-label="${label}">` +
      `<circle class="pa-hit" cx="${cx}" cy="${cy}" r="12"/>` +
      `<circle class="pa-dot" cx="${cx}" cy="${cy}" r="${p.live ? 4.5 : 3.5}"/></g>`;
  }
  return `<svg class="pa-svg" viewBox="0 0 ${fr.w} ${height}" width="${fr.w}" height="${height}" role="group" aria-label="Future proj by week">` +
    `${fr.g}<path class="pa-line" d="${d}"/>${dots}</svg>`;
}

/**
 * GRAPH 2: each target week's projection, one line per as-of week, red (oldest)
 * to green (newest). Each target week is a focusable `g.pa-wk[data-week]`
 * column the page hangs its preview off.
 *
 * @param {Array} lines `history().lines`
 * @param {{width?:number, height?:number}} o
 */
export function linesSvg(lines, { width = 360, height = 190 } = {}) {
  if (!lines.length) return '';
  const all = [...new Set(lines.flatMap((l) => l.pts.map((p) => p.week)))].sort((a, b) => a - b);
  const weeks = [];
  for (let w = all[0]; w <= all[all.length - 1]; w++) weeks.push(w);
  const vals = lines.flatMap((l) => l.pts.map((p) => p.proj)).filter((v) => v !== null);
  const { top, ticks } = niceScale(Math.max(...vals) * 1.1);
  const fr = frame({ width, height, weeks, top, ticks, xLabel: 'Week projected' });
  let body = '';
  lines.forEach((l, i) => {
    const color = rampColor(i, lines.length);
    const run = l.pts.map((p) => ({ week: p.week, v: p.proj }));
    const d = pathOf(run, fr.x, fr.y, (a, b) => b - a > 1);
    const lone = run.filter((p, k) => p.v !== null &&
      (k === 0 || run[k - 1].v === null) && (k === run.length - 1 || run[k + 1].v === null));
    body += `<path class="pa-wline${l.live ? ' now' : ''}" d="${d}" stroke="${color}" data-asof="${l.asOf}"/>`;
    for (const p of lone) body += `<circle class="pa-wdot" cx="${fr.x(p.week).toFixed(1)}" cy="${fr.y(p.v).toFixed(1)}" r="2.5" fill="${color}"/>`;
  });
  const colW = weeks.length > 1 ? (fr.x(weeks[1]) - fr.x(weeks[0])) : 40;
  let hits = '';
  for (const wk of weeks) {
    const x0 = (fr.x(wk) - colW / 2).toFixed(1);
    hits += `<g class="pa-wk" data-week="${wk}" tabindex="0" role="img" aria-label="Week ${wk}: its projection as of each week">` +
      `<rect class="pa-hit" x="${x0}" y="${fr.T}" width="${colW.toFixed(1)}" height="${fr.ih}"/></g>`;
  }
  return `<svg class="pa-svg" viewBox="0 0 ${fr.w} ${height}" width="${fr.w}" height="${height}" role="group" aria-label="Each week's proj over time">` +
    `${fr.g}${body}${hits}</svg>`;
}
