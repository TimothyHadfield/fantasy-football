// "The chart" — the Summary page's table (member, record, LUCK, title %, loser
// %), as rows built from plain row objects and nothing else.
//
// WHY IT IS ITS OWN FILE. `renderTable()` in js/summary-page.js drew this out of
// that page's state. The Decisions review (docs/decisions-review-plan.md, Tim
// 2026-10-05: "this style of current, hypothetical, and difference should be
// shown for … 'the chart' in the summary section") needs the same chart for the
// season that happened, for a mirror universe, and for the difference between
// them. One implementation, here; the Summary page calls it.
//
// A ROW is what `buildRows()` on the Summary page makes:
//
//   { id, name, teamName,          // who
//     record: { w, l, t } | null,  // banked games
//     rec,                         // capture.recordNow(record, chance, { sep: '-' }) | null — what is PRINTED
//     luck, luckMargin,            // points | null
//     title, last }                // 0..1 | null
//
// THE DIFFERENCE VIEW (`diffFrom`, the rows being compared against) is
// row − diffFrom row for the same `id`: the record as "+1 W", LUCK in points to
// a tenth, the two chances in percentage points to a tenth ("+2.4%" — a tenth,
// where the chart itself prints whole percents, because the change one decision
// makes to a title chance is usually smaller than one). Coloured GOOD FOR THAT
// MANAGER, the chart's own rule: a rise is green, except Loser %, which is
// turned over exactly as its red/green scale is.
//
// NOTHING HERE READS PAGE STATE OR THE DOM.

import { heatScale, heatOf, heatMarkHtml } from './heat.js';
import { esc, signedText, diffOf, diffClass, recordDiff, dimOf, dimStyle } from './view-switch.js';

export { esc };

export const dash = '<span class="muted">—</span>';

/** A signed one-decimal number, coloured. Same renderer as the stats page's
 *  LUCK column, so the two pages print the identical string for one team. */
export function signed(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return dash;
  // Rounded first, then signed: −0.04 is "0.0" in the neutral class, not "-0.0".
  const r = Number(n.toFixed(1)) + 0;
  const cls = r > 0 ? 'pos' : r < 0 ? 'neg' : 'muted';
  return `<span class="${cls}">${r > 0 ? '+' : ''}${r.toFixed(1)}</span>`;
}

/**
 * A probability as a percentage.
 *
 * "<1%" rather than "0%" for anything that happened at all, and "0" only for
 * something that happened in none of a hundred thousand seasons. At this run
 * count that really does mean "never once", which is worth distinguishing from
 * "rounds down".
 */
export function pct(p) {
  if (!Number.isFinite(p)) return null;
  if (p <= 0) return '0%';
  if (p < 0.005) return '<1%';
  return `${Math.round(p * 100)}%`;
}

/** "4-2", and a third number ("4-2-1") only for a manager who has a tie.
 *  While his game is being played it counts as his chance of winning it
 *  ("3.2-2.8"); `row.rec` is `capture.recordNow`. */
export const recordText = (row) => (row.rec ? row.rec.text : '—');

/** The smallest spread a percentage column is shaded on: half of one printed digit. */
export const PCT_MIN_SPREAD = 0.005;

/**
 * THREE SCALES, ONE PER COLUMN, AND ONE OF THEM IS INVERTED.
 *
 *   LUCK    — high is good. Only when `shadeLuck` (the Summary page holds it
 *             back for the first weeks, when one close game swings it further
 *             than a season does).
 *   Title % — high is good.
 *   Loser % — INVERTED: low is good. The one column where getting the
 *             direction wrong would paint the wooden-spoon favourite the
 *             brightest green in the chart.
 *
 * @returns {{luck:Object|null, title:Object|null, last:Object|null}}
 */
export function summaryScales(rows, { shadeLuck = true, minSpread = PCT_MIN_SPREAD } = {}) {
  return {
    luck: shadeLuck ? heatScale(rows.map((r) => r.luck)) : null,
    title: heatScale(rows.map((r) => r.title), { minSpread }),
    last: heatScale(rows.map((r) => r.last), { invert: true, minSpread }),
  };
}

/** One shaded cell. The `title` is channel 3 of "never colour alone". */
const shaded = (v, scale, fmt, inner) => {
  // No group is named: each column is one figure across the league, so the
  // title reads "2nd highest of 10 · league avg 12%", the average printed the
  // way the column prints it.
  const h = heatOf(v, scale, { fmt });
  return `<td class="num${h ? ` ${h.cls}` : ''}" data-v="${v ?? ''}"` +
    `${h ? ` title="${esc(h.words)}"` : ''}>${inner}${heatMarkHtml(h)}</td>`;
};

const nameCell = (r) =>
  `<td class="name"${r.teamName ? ` title="ESPN team name: ${esc(r.teamName)}"` : ''}>${esc(r.name)}</td>`;

function rowCells(r, { enough, waiting, scales }) {
  // Three different reasons a percentage cell can be empty, and they are not the
  // same fact. Saying which is the whole of the early-season honesty rule.
  const pctCell = (p) => {
    if (p === null || p === undefined) {
      return waiting ? '<span class="muted">…</span>' : dash;
    }
    return `${pct(p)}`;
  };
  return [
    nameCell(r),
    `<td class="num" data-v="${r.rec ? r.rec.wins : ''}"${
      r.rec && r.rec.live ? ` title="${esc(r.rec.title)}"` : ''}>${recordText(r)}</td>`,
    shaded(r.luck, scales.luck, null,
      `${enough ? signed(r.luck) : dash}${
        enough && r.luck !== null && r.luckMargin ? ` <span class="muted pm">±${r.luckMargin.toFixed(0)}</span>` : ''}`),
    shaded(r.title, scales.title, pct, pctCell(r.title)),
    shaded(r.last, scales.last, pct, pctCell(r.last)),
  ];
}

/** One difference cell: signed, classed, sortable — or a dash when unknown. */
function diffCell(d, good, text) {
  if (d === null) return `<td class="num">${dash}</td>`;
  const cls = diffClass(d, good);
  return `<td class="num${cls ? ` ${cls}` : ''}" data-v="${d}">${text}</td>`;
}

function rowDiffCells(r, c, { enough }) {
  const blank = `<td class="num">${dash}</td>`;
  if (!c || !enough) return [nameCell(r), blank, blank, blank, blank];
  const rec = recordDiff(r.record, c.record);
  const luck = diffOf(r.luck, c.luck);
  // Percentage points, to a tenth.
  const pp = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? diffOf(a * 100, b * 100) : null);
  const title = pp(r.title, c.title);
  const last = pp(r.last, c.last);
  return [
    nameCell(r),
    rec ? diffCell(rec.value, 1, rec.text) : blank,
    diffCell(luck, 1, signedText(luck)),
    diffCell(title, 1, `${signedText(title)}%`),
    diffCell(last, -1, `${signedText(last)}%`),
  ];
}

/**
 * The chart's body rows, one per entry of `rows`, in the order given.
 *
 * @param {Array<Object>} rows see the head of this file
 * @param {Object} [o]
 * @param {boolean} [o.enough] false before any week is decided: LUCK prints a
 *        dash rather than a number that happens to be zero. Default true.
 * @param {boolean} [o.waiting] a simulation is still running: an empty
 *        percentage prints "…" instead of a dash. Default false.
 * @param {boolean} [o.shadeLuck] colour the LUCK column. Default true.
 * @param {Object|null} [o.scales] a `summaryScales(rows, …)` result the caller
 *        already has (it prints their thresholds in its key)
 * @param {Array<Object>|null} [o.diffFrom] the rows to subtract, matched on
 *        `id`. Given, every numeric cell is the signed difference in `d-up` /
 *        `d-down` / `d-zero`; no heat colours and no ±.
 * @param {Map<*, number>|Object|null} [o.dim] row id -> noise 0..1; that row's
 *        cells (not the name) are drawn at opacity 1 − 0.65 × noise
 * @param {*} [o.me] the reader's own team id: that row is `<tr class="me">`,
 *        the class the Stats standings put on it (css/app.css `tbody tr.me`).
 *        Left out, no row carries a class.
 * @returns {string} `<tr>`s, for a `<tbody>`
 */
export function summaryRowsHtml(rows, {
  enough = true, waiting = false, shadeLuck = true, scales = null, diffFrom = null, dim = null,
  me = null,
} = {}) {
  const sc = diffFrom ? null : scales || summaryScales(rows, { shadeLuck });
  const before = diffFrom ? new Map(diffFrom.map((r) => [r.id, r])) : null;
  const mine = (r) => me !== null && me !== undefined && String(r.id) === String(me);
  return rows.map((r) => {
    const cells = diffFrom
      ? rowDiffCells(r, before.get(r.id) || null, { enough })
      : rowCells(r, { enough, waiting, scales: sc });
    const style = dimStyle(dimOf(dim, r.id));
    const drawn = style ? cells.map((c, i) => (i ? c.replace(/^<td/, `<td${style}`) : c)) : cells;
    return `
    <tr${mine(r) ? ' class="me"' : ''}>
      ${drawn.join('\n      ')}
    </tr>`;
  }).join('');
}

/** The heading row: [label, title]. The same words summary.html prints. */
const HEAD = [
  ['Member', 'The person, not their ESPN team name. Resolved from ESPN\'s own member list.'],
  ['Record', 'Wins and losses in the weeks counted as decided. A tie adds a third number (7-1-1) and sorts as half a win.'],
  ['LUCK', 'Your sheet\'s LUCK column, for the season so far: league average actual − (points to win − close-game luck). One week counts ±50 at most. Above zero means the season has broken your way.'],
  ['Title %', 'How often this manager wins the CHAMPIONSHIP ROUND across the simulated seasons. Not the same as topping the table.'],
  ['Loser %', 'How often this manager finishes LAST IN THE REGULAR-SEASON STANDINGS. Tim\'s league rule, and nothing to do with the consolation ladder.'],
];

/**
 * The whole chart — headings and rows — for a page with no `<table>` of its
 * own. `class="summary-table"`; the difference view adds `data-view="diff"`.
 * The headings carry `data-sort`, so `enableSort(table)` works on it as is.
 *
 * @param {Array<Object>} rows
 * @param {Object} [opts] everything `summaryRowsHtml` takes, plus
 * @param {string} [opts.id] the table's id
 * @returns {string}
 */
export function summaryTableHtml(rows, opts = {}) {
  const head = `<tr>${HEAD.map(([text, title], i) =>
    `<th class="${i ? 'num' : 'name'}" data-sort title="${esc(title)}">${esc(text)}</th>`).join('')}</tr>`;
  return `<table class="summary-table"${opts.id ? ` id="${esc(opts.id)}"` : ''}` +
    `${opts.diffFrom ? ' data-view="diff"' : ''}><thead>${head}</thead>` +
    `<tbody>${summaryRowsHtml(rows, opts)}</tbody></table>`;
}
