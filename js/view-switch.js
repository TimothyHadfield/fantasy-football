// CURRENT / HYPOTHETICAL / DIFFERENCE — the small kit the three shared tables
// (js/standings-table.js, js/summary-table.js, js/actual-season-table.js) and
// the page that shows them all agree on.
//
// Tim, 2026-10-05: "base it off of the trade section where we display the
// current season by week chart, and then the hypothetical season by week chart,
// as well as an option to switch the hypothetical season by week chart to a
// difference season by week chart which visually shows the change in what
// happened."
//
// So everything here is the Trade page's own, under the Trade page's own names:
// the switch is its `.segmented.sbw-view` with `button[data-sbw-view]`, a
// difference prints as its `signedText` does ("+3.6" / "−0.4", a real minus),
// and a difference cell takes its `d-up` / `d-down` / `d-zero` classes. The
// Trade page itself is NOT refactored onto this file (its season boxes are
// projection-based and 9,000 lines deep); these are the same strings, written
// once more for the pages that are not it.
//
// NOTHING HERE READS PAGE STATE, and nothing imports anything, so it is
// node-testable (tests/shared-tables-check.mjs).

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

export const round1 = (n) => Math.round(n * 10) / 10;

/** "+3.6" / "−0.4" / "0.0" — a real minus sign, and the sign is always printed. */
export function signedText(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const v = Number(n);
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(digits);
}

/**
 * A difference of two PRINTED numbers: each side rounded to the digits it is
 * shown at, then subtracted — so a difference cell is the subtraction of the
 * two cells a reader can see, to the last digit. Null when either is missing.
 */
export function diffOf(hyp, cur, digits = 1) {
  if (!Number.isFinite(hyp) || !Number.isFinite(cur)) return null;
  const k = 10 ** digits;
  return Math.round(Math.round(hyp * k) - Math.round(cur * k)) / k;
}

/**
 * A difference cell's colour class: `d-up` green, `d-down` red, `d-zero` dim.
 *
 * `good` says which way is GOOD for the team the cell is about: +1 a rise
 * (points, wins), −1 a fall (an opponent's average, a chance of finishing
 * last), 0 neither (the cell is only marked changed or not). Null is no class.
 */
export function diffClass(d, good = 1) {
  if (d === null || d === undefined || Number.isNaN(d)) return '';
  if (Math.abs(d) < 1e-9) return 'd-zero';
  if (!good) return '';
  return d * good > 0 ? 'd-up' : 'd-down';
}

/**
 * A record's change, hypothetical − current: "+1 W", "−2 W", or "0".
 *
 * The WINS are what is printed (Tim's "how much it would have changed the
 * overall record"); a flipped game moves the losses the other way and saying
 * both would be one fact twice. Only when the wins are level and something
 * else moved (a tie that became a loss) is that printed instead. `value` is
 * the change in wins with a tie as half, which is what the cell is coloured
 * and sorted on.
 *
 * @param {{w:number,l:number,t?:number}|null} hyp
 * @param {{w:number,l:number,t?:number}|null} cur
 * @returns {{text:string, value:number, dw:number, dl:number, dt:number}|null}
 */
export function recordDiff(hyp, cur) {
  if (!hyp || !cur) return null;
  const d = (k) => (hyp[k] || 0) - (cur[k] || 0);
  const [dw, dl, dt] = [d('w'), d('l'), d('t')];
  const part = (n, letter) => `${n > 0 ? '+' : '−'}${Math.abs(n)} ${letter}`;
  const text = dw ? part(dw, 'W') : dl ? part(dl, 'L') : dt ? part(dt, 'T') : '0';
  return { text, value: dw + dt / 2, dw, dl, dt };
}

/** How far full noise dims a cell: opacity 1 − 0.65 × noise (the plan's constant). */
export const DIM_DEPTH = 0.65;

/** One entry of a dim map — a `Map` or a plain object keyed by week or team id. */
export function dimOf(dim, key) {
  if (!dim) return 0;
  const v = typeof dim.get === 'function' ? dim.get(key) ?? dim.get(String(key)) : dim[key];
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** The opacity a noise level of `d` (0..1) is drawn at; 1 for none. */
export const dimOpacity = (d) => Math.round((1 - DIM_DEPTH * Math.min(1, Math.max(0, d || 0))) * 1000) / 1000;

/** ` style="opacity:0.74"` for a dimmed cell, or nothing at all for a clear one. */
export const dimStyle = (d) => (d > 0 ? ` style="opacity:${dimOpacity(d)}"` : '');

/**
 * The "Hypothetical | Difference" switch, as the Trade page draws its
 * "Total | Difference": `.segmented.sbw-view` holding `button[data-sbw-view]`
 * with the values `total` and `diff`.
 *
 * @param {'total'|'diff'} view which one is on
 * @param {Object} [o]
 * @param {[string, string]} [o.labels] the two words, total first
 * @param {string} [o.label] the group's aria-label
 * @param {string} [o.box] written as `data-sbw-box`, so one page can tell
 *        three switches apart in one click handler
 */
export function viewSwitchHtml(view, { labels = ['Hypothetical', 'Difference'], label = 'Hypothetical numbers', box = '' } = {}) {
  const on = view === 'diff' ? 'diff' : 'total';
  const btn = (v, text) =>
    `<button type="button" data-sbw-view="${v}"${on === v ? ' class="on"' : ''} ` +
    `aria-pressed="${on === v}">${esc(text)}</button>`;
  return `<div class="segmented sbw-view" role="group" aria-label="${esc(label)}"` +
    `${box ? ` data-sbw-box="${esc(box)}"` : ''}>` +
    `${btn('total', labels[0])}${btn('diff', labels[1])}</div>`;
}

/**
 * Which view a click asked for, or null when the click was not on a switch.
 * For one delegated listener: `const v = viewFromClick(e); if (v) …`.
 *
 * @returns {{view:'total'|'diff', box:string}|null}
 */
export function viewFromClick(event) {
  const t = event && event.target;
  const b = t && typeof t.closest === 'function' ? t.closest('button[data-sbw-view]') : null;
  if (!b) return null;
  const group = b.closest('.sbw-view');
  return {
    view: b.getAttribute('data-sbw-view') === 'diff' ? 'diff' : 'total',
    box: (group && group.getAttribute('data-sbw-box')) || '',
  };
}
