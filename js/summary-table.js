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
//     title, last,                 // 0..1 | null
//     playoffs, bye }              // 0..1 | null — the Summary page's Chance column (`pick`)
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
 * THE ONE CHANCE COLUMN (Tim, 2026-11-10, a standing rule: "the columns to be
 * record, luck, title, and then the most relevant % for that player (either
 * bye, playoff, or loser). this means for users who have a 98% for playoffs,
 * BYE will be shown. if you have 5% playoff and 29% loser, loser will be
 * shown.").
 *
 * Read as: the most relevant of the three is the LEAST SETTLED one, the one
 * closest to 50%. 98% playoffs is nearly settled, so the bye is the live
 * question; 5% playoffs is nearly settled, so 29% loser is. Ties go Playoff,
 * then Bye, then Loser (`PICK_ORDER`). A figure that is missing (null: no
 * bracket, or a bracket with no byes) is skipped. Once every figure there is
 * is settled (0 or 100%, a finished regular season or a clinched spot), the
 * OUTCOME is shown instead: Bye if they got one, else Playoff if they made it,
 * else Loser if they finished last, else Playoff (0%).
 */
export const PICK_ORDER = ['playoffs', 'bye', 'last'];
export const PICK_KINDS = {
  playoffs: { tag: 'PLAYOFF', label: 'Playoff %', counted: 'Seasons in the playoffs' },
  bye: { tag: 'BYE', label: 'Bye %', counted: 'Seasons with a bye' },
  last: { tag: 'LOSER', label: 'Loser %', counted: 'Seasons last' },
};

/**
 * @param {{playoffs?:number|null, bye?:number|null, last?:number|null}} r
 *        probabilities in 0..1, or null/undefined when missing
 * @returns {{kind:'playoffs'|'bye'|'last', p:number}|null} null when all three are missing
 */
export function relevantChance(r) {
  const fig = r || {};
  const have = PICK_ORDER.filter((k) => Number.isFinite(fig[k]));
  if (!have.length) return null;
  if (have.every((k) => fig[k] <= 0 || fig[k] >= 1)) {
    const k = ['bye', 'playoffs', 'last'].find((x) => have.includes(x) && fig[x] >= 1) ?? have[0];
    return { kind: k, p: fig[k] };
  }
  let best = null;
  for (const k of have) {
    const d = Math.abs(fig[k] - 0.5);
    // Strictly closer wins; a tie (to float noise) keeps the earlier kind.
    if (best === null || d < best.d - 1e-12) best = { k, d };
  }
  return { kind: best.k, p: fig[best.k] };
}

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
    // For the Chance column: a cell is shaded on its OWN figure's scale across
    // the league, so a BYE cell is ranked against everyone's Bye %.
    playoffs: heatScale(rows.map((r) => r.playoffs), { minSpread }),
    bye: heatScale(rows.map((r) => r.bye), { minSpread }),
  };
}

/** One shaded cell. The `title` is channel 3 of "never colour alone" — unless
 *  the page hangs a card on the cell (`card`), which then says where the number
 *  stands: one preview a number, so the card's attribute REPLACES the title. */
const shaded = (v, scale, fmt, inner, card = '', extra = '') => {
  // No group is named: each column is one figure across the league, so the
  // title reads "2nd highest of 10 · league avg 12%", the average printed the
  // way the column prints it.
  const h = heatOf(v, scale, { fmt });
  return `<td class="num${h ? ` ${h.cls}` : ''}"${extra} data-v="${v ?? ''}"` +
    `${card || (h ? ` title="${esc(h.words)}"` : '')}>${inner}${heatMarkHtml(h)}</td>`;
};

const nameCell = (r, card = '') =>
  `<td class="name"${card || (r.teamName ? ` title="ESPN team name: ${esc(r.teamName)}"` : '')}>${esc(r.name)}</td>`;

function rowCells(r, { enough, waiting, scales, cards, pick }) {
  // A PREVIEW CARD PER CELL (`cards`, off unless a page asks for it — the
  // Summary page does, the Decisions review does not): the attribute the page
  // made for this row's cell, or '' for none.
  const card = (key) => (cards && typeof cards[key] === 'function' ? cards[key](r) || '' : '');
  // The decimal record's basis (rule 7) is the one title a card does not
  // replace on the way out: the card says it too, but a record that reads
  // "3.2-2.8" must carry its reason wherever the row is drawn. js/pop.js takes
  // the title off as the card opens, so the two are never on screen together.
  const recordCard = card('record');
  const liveTitle = r.rec && r.rec.live ? ` title="${esc(r.rec.title)}"` : '';
  // Three different reasons a percentage cell can be empty, and they are not the
  // same fact. Saying which is the whole of the early-season honesty rule.
  const pctCell = (p) => {
    if (p === null || p === undefined) {
      return waiting ? '<span class="muted">…</span>' : dash;
    }
    return `${pct(p)}`;
  };
  return [
    nameCell(r, card('name')),
    `<td class="num" data-v="${r.rec ? r.rec.wins : ''}"${recordCard}${liveTitle}>${recordText(r)}</td>`,
    shaded(r.luck, scales.luck, null,
      `${enough ? signed(r.luck) : dash}${
        enough && r.luck !== null && r.luckMargin ? ` <span class="muted pm">±${r.luckMargin.toFixed(0)}</span>` : ''}`,
      card('luck')),
    shaded(r.title, scales.title, pct, pctCell(r.title), card('title')),
    pick ? chanceCell(r, scales, waiting, card('pick'))
      : shaded(r.last, scales.last, pct, pctCell(r.last), card('last')),
  ];
}

/** The Chance cell: the `relevantChance` figure with a tag saying which it is,
 *  shaded on that figure's own scale (Loser turned over, as its column was). */
function chanceCell(r, scales, waiting, card) {
  const c = relevantChance(r);
  if (!c) return `<td class="num" data-v="">${waiting ? '<span class="muted">…</span>' : dash}</td>`;
  return shaded(c.p, scales[c.kind] || null, pct,
    `<span class="pick-tag">${PICK_KINDS[c.kind].tag}</span> ${pct(c.p)}`, card, ` data-pick="${c.kind}"`);
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
 * @param {Object|null} [o.cards] a preview card per cell, for a page that opens
 *        them (js/pop.js): `{ name, record, luck, title, last }`, each
 *        `(row) => attribute string` (a `statCard(...)` result) or '' for no
 *        card. A cell given one carries it INSTEAD of its `title` (the decimal
 *        record's basis excepted). Off by default: without it not a byte of the
 *        rows differs. The difference view takes none.
 * @param {boolean} [o.pick] the Summary page's column set (Tim, 2026-11-10):
 *        the last column is the Chance column (`relevantChance`: Bye, Playoff
 *        or Loser %, tagged, `data-pick` = which) instead of Loser %. Rows then
 *        need `playoffs` and `bye` too; its card key is `pick`. Off by default
 *        (the Decisions review keeps Loser %).
 * @returns {string} `<tr>`s, for a `<tbody>`
 */
export function summaryRowsHtml(rows, {
  enough = true, waiting = false, shadeLuck = true, scales = null, diffFrom = null, dim = null,
  me = null, cards = null, pick = false,
} = {}) {
  const sc = diffFrom ? null : scales || summaryScales(rows, { shadeLuck });
  const before = diffFrom ? new Map(diffFrom.map((r) => [r.id, r])) : null;
  const mine = (r) => me !== null && me !== undefined && String(r.id) === String(me);
  return rows.map((r) => {
    const cells = diffFrom
      ? rowDiffCells(r, before.get(r.id) || null, { enough })
      : rowCells(r, { enough, waiting, scales: sc, cards, pick });
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
