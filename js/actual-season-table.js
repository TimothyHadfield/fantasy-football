// "Season by week", in ACTUAL POINTS: slot rows down the side, a column a week,
// each cell the man who started there and what he scored, and a total row.
//
// Tim, 2026-10-05: "base it off of the trade section where we display the
// current season by week chart, and then the hypothetical season by week chart,
// as well as an option to switch the hypothetical season by week chart to a
// difference season by week chart which visually shows the change in what
// happened."
//
// THE TRADE PAGE'S BOX, NOT THE TRADE PAGE'S CODE. Its season boxes
// (`cuSeasonTableHtml` in js/trade-page.js) are priced on projections for weeks
// still to come and are deliberately left alone (the plan's "Deliberately NOT
// planned"). This is the same box for weeks ALREADY PLAYED: the same
// `table.sbw-table`, the same `.slot-tag` rows from `slotRows` / `fillSlots`,
// the same `tbody.split` band, the same `d-up` / `d-down` / `d-zero` on a
// difference — so with the `.sbw` rules now in css/app.css it looks like its
// sibling. Two things differ, because the question does: a cell names the man
// (a played week has one fact per slot, and who it was IS the hypothetical),
// and there is no Avg column or red/green scale (nothing here is a forecast to
// be judged against the league).
//
// INPUT — one squad's lineups, a week at a time:
//
//   weeks: [{ week, total,
//             starters: [{ playerId, name, position, slot, slotId,
//                          actual, projected, isNew }] }]
//
// which is `mirror.teams.get(id).byWeek[week]` of js/decisions.js, either its
// mirror half (`starters`, `total`) or its real half (`realStarters`,
// `realTotal`) — `weeksFromMirror` below picks one. `rows` is `slotRows(slots)`.
//
// WHO IS "RB1". `fillSlots` ranks the men sharing a slot on that week's
// PROJECTION, as it does everywhere on the site, so the row a man sits in does
// not depend on how the week turned out. A difference is taken ROW BY ROW: when
// a hypothetical lineup changes who the better-projected back is, both RB rows
// show a change, and the total row is what settles the week.
//
// NOTHING HERE READS PAGE STATE OR THE DOM.

import { slotRows, fillSlots } from './lineup-slots.js';
import { esc, signedText, diffOf, diffClass, dimOf, dimStyle } from './view-switch.js';

const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : '—');

/**
 * A man's name short enough for a week column: "J. Chase". The full name is the
 * cell's `title`. A defence ("Bills D/ST") and a one-word name are left whole.
 */
export function shortName(p) {
  const name = String((p && p.name) || '').trim();
  const sp = name.indexOf(' ');
  if (sp < 1 || /D\/?ST/i.test(`${p.position || ''} ${name}`)) return name;
  return `${name[0]}. ${name.slice(sp + 1)}`;
}

/**
 * One squad's weeks out of a `mirror(...)` result, in the shape this table
 * takes.
 *
 * @param {{byWeek:Object}} teamMirror `mirror.teams.get(teamId)`
 * @param {'real'|'mirror'} [which] the season that happened, or the hypothetical
 * @returns {Array<{week:number, total:number, starters:Array}>} ascending
 */
export function weeksFromMirror(teamMirror, which = 'mirror') {
  const real = which === 'real';
  return Object.entries((teamMirror && teamMirror.byWeek) || {})
    .map(([week, w]) => ({
      week: Number(week),
      total: real ? w.realTotal : w.total,
      starters: (real ? w.realStarters : w.starters) || [],
    }))
    .sort((a, b) => a.week - b.week);
}

/** The points a slot scored: its man's actual, 0 for a man with none, null when empty. */
const pointsOf = (entry) => (entry ? (Number.isFinite(entry.p.actual) ? entry.p.actual : 0) : null);

/** The two lines of a cell: who, then the number. */
const lines = (entry, shown) =>
  `<span class="sbw-name">${entry ? esc(shortName(entry.p)) : '—'}</span>` +
  `<span class="sbw-pts">${shown}</span>`;

/**
 * The season box.
 *
 * @param {Object} season
 * @param {Array<{week:number, total:number, starters:Array}>} season.weeks
 * @param {Array} [season.rows] `slotRows(slots)`; or pass
 * @param {number[]} [season.slots] the league's lineup slot ids instead
 * @param {Object} [o]
 * @param {Array|null} [o.diffFrom] the weeks to subtract (same shape, matched
 *        on `week`). Given, a cell is this lineup's points minus that one's in
 *        the same slot row, signed, in `d-up` / `d-down` / `d-zero`; the name
 *        printed is THIS lineup's man, and the cell is marked `sbw-new` where
 *        he is not the man `diffFrom` had there. The total row is the totals'
 *        difference.
 * @param {Map<number, number>|Object|null} [o.dim] week -> noise 0..1; every
 *        cell of that week's column is drawn at opacity 1 − 0.65 × noise
 * @param {string} [o.box] written as `data-box` ("current", "hypothetical")
 * @param {string} [o.totalLabel] the total row's label. Default "Total".
 * @returns {string} `<table class="sbw-table">…`, to sit inside `.sbw`
 */
export function actualSeasonTableHtml({ weeks = [], rows = null, slots = null } = {}, {
  diffFrom = null, dim = null, box = '', totalLabel = 'Total',
} = {}) {
  const slotList = rows || slotRows(slots);
  const cols = [...weeks].sort((a, b) => a.week - b.week);
  const beforeOf = diffFrom ? new Map(diffFrom.map((w) => [w.week, w])) : null;
  const fills = cols.map((c) => fillSlots(c.starters, slotList));
  const beforeFills = cols.map((c) => {
    const b = beforeOf && beforeOf.get(c.week);
    return b ? fillSlots(b.starters, slotList) : null;
  });
  const styles = cols.map((c) => dimStyle(dimOf(dim, c.week)));

  const head = `<tr><th class="name">Slot</th>` +
    cols.map((c) => `<th class="wk">${esc(c.week)}</th>`).join('') + `</tr>`;

  const body = slotList.map((row) => {
    const cells = cols.map((c, i) => {
      const e = fills[i].get(row.key) || null;
      const at = ` data-wk="${esc(c.week)}"${styles[i]}`;
      if (!diffFrom) {
        if (!e) return `<td class="wk muted"${at}>—</td>`;
        const v = pointsOf(e);
        return `<td class="wk" data-v="${v}" data-pid="${esc(e.p.playerId ?? '')}"${at} ` +
          `title="${esc(e.p.name)}">${lines(e, fmt(e.p.actual))}</td>`;
      }
      // DIFFERENCE: this lineup minus the other, in the same slot row. An
      // empty slot scored nothing, so a slot filled in one and empty in the
      // other is the whole of that man's points; a week `diffFrom` does not
      // have at all has nothing to subtract.
      const b = beforeFills[i] ? beforeFills[i].get(row.key) || null : null;
      if (!beforeFills[i] || (!e && !b)) return `<td class="wk muted"${at}>—</td>`;
      const d = diffOf(pointsOf(e) ?? 0, pointsOf(b) ?? 0);
      const swapped = (e ? e.p.playerId : null) !== (b ? b.p.playerId : null);
      const cls = ['wk', diffClass(d), swapped ? 'sbw-new' : ''].filter(Boolean).join(' ');
      const title = swapped
        ? `${e ? e.p.name : 'Nobody'} instead of ${b ? b.p.name : 'nobody'}`
        : e.p.name;
      return `<td class="${cls}" data-v="${d}"${e ? ` data-pid="${esc(e.p.playerId ?? '')}"` : ''}${at} ` +
        `title="${esc(title)}">${lines(e, signedText(d))}</td>`;
    });
    return `<tr data-slot="${esc(row.key)}"><td class="name"><span class="slot-tag">${esc(row.key)}</span></td>` +
      `${cells.join('')}</tr>`;
  }).join('');

  const band = `<tr class="split-row"><td class="name split-label">${esc(totalLabel)}</td>` +
    cols.map((c, i) => {
      const at = ` data-wk="${esc(c.week)}"${styles[i]}`;
      if (!diffFrom) {
        return `<td class="wk split-total" data-v="${c.total}"${at}>${fmt(c.total)}</td>`;
      }
      const b = beforeOf.get(c.week);
      const d = b ? diffOf(c.total, b.total) : null;
      if (d === null) return `<td class="wk split-total muted"${at}>—</td>`;
      return `<td class="wk split-total ${diffClass(d)}" data-v="${d}"${at}>${signedText(d)}</td>`;
    }).join('') + `</tr>`;

  return `<table class="sbw-table sbw-actual"${box ? ` data-box="${esc(box)}"` : ''}` +
    `${diffFrom ? ' data-view="diff"' : ''}><thead>${head}</thead>` +
    `<tbody>${body}</tbody><tbody class="split">${band}</tbody></table>`;
}
