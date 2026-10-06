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
import { heatScale, heatOf, heatMarkHtml } from './heat.js';

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

/**
 * THE WEEK IN PLAY: a starter the engine marks `known: false` has not finished.
 * He has no score, and counts for his `value` (his pre-game projection); his
 * cell is drawn `sbw-proj` so it does not read as one.
 */
const unknown = (entry) => Boolean(entry && entry.p.known === false);
const scoreOf = (p) => (p.known === false ? p.value : p.actual);

/** The points a slot scored: its man's actual, 0 for a man with none, null when empty. */
const pointsOf = (entry) => (entry ? (Number.isFinite(scoreOf(entry.p)) ? scoreOf(entry.p) : 0) : null);

/** The small LIVE badge beside a week number: some of that week is still to come. */
export const LIVE_TAG ='<span class="badge live wk-live" title="Still being played: some of this is not final.">live</span>';

/** A cell's title: the man's full name, and a word when his number is not a score. */
const saidOf = (entry) => (unknown(entry) ? `${entry.p.name} (projected, still to play)` : entry.p.name);

/** The two lines of a cell: who, then the number. */
const lines = (entry, shown) =>
  `<span class="sbw-name">${entry ? esc(shortName(entry.p)) : '—'}</span>` +
  `<span class="sbw-pts">${shown}</span>`;

/**
 * `o.proj` BELOW: what a man was projected for, the number his week is judged
 * against. Null for one still playing (his cell's own number IS his projection,
 * and it is not printed twice) and for one the feed sent no projection for
 * (`noProj`, js/decisions.js) — nothing is drawn then, never a 0.
 */
const projOf = (entry) => (!entry || unknown(entry) || entry.p.noProj || !Number.isFinite(entry.p.projected)
  ? null : entry.p.projected);

/**
 * The mean of the numbers a row shows — each to the tenth it is printed at, so
 * it is the Avg a reader gets adding the row up — its blanks left out; null for
 * a row of blanks.
 */
const meanOf = (list) => {
  const got = list.filter((v) => typeof v === 'number' && Number.isFinite(v)).map((v) => Number(fmt(v)));
  return got.length ? got.reduce((a, b) => a + b, 0) / got.length : null;
};
const tenth = (v) => Math.round(v * 10) / 10;

/**
 * THE SCALES FOR `o.heat` BELOW: the site's one red/green scale (js/heat.js),
 * measured the way Analysis measures the same sheet's history weeks — each slot
 * row against the other squads' same slot IN THAT WEEK, and the total against
 * the other squads' totals that week. Never one position against another.
 *
 * @param {Array<Array<{week:number, total:number, starters:Array}>>} squads
 *        every squad's weeks, one array a squad (`weeksFromMirror` of each)
 * @param {Object} [o]
 * @param {Array} [o.rows] `slotRows(slots)`; or pass
 * @param {number[]} [o.slots] the league's lineup slot ids instead
 * @param {Iterable<number>|null} [o.skip] weeks left uncoloured: one still
 *        being played is part totals, which Analysis and Stats do not colour
 * @returns {(week:number, slotKey:string|null) => Object|null} a `heatScale`
 *          for that week's slot row, or with `null` for that week's totals
 */
export function seasonHeat(squads = [], { rows = null, slots = null, skip = null } = {}) {
  const slotList = rows || slotRows(slots);
  const left = new Set(skip || []);
  const byWeek = new Map(); // week -> { fills: Map[], totals: number[] }
  for (const weeks of squads) {
    for (const w of weeks || []) {
      if (!byWeek.has(w.week)) byWeek.set(w.week, { fills: [], totals: [] });
      const got = byWeek.get(w.week);
      got.fills.push(fillSlots(w.starters, slotList));
      got.totals.push(w.total);
    }
  }
  const made = new Map();
  return (week, slotKey = null) => {
    const got = byWeek.get(week);
    if (!got || left.has(week)) return null;
    const key = `${week}|${slotKey === null ? '' : slotKey}`;
    if (!made.has(key)) {
      made.set(key, heatScale(slotKey === null
        ? got.totals
        : got.fills.map((fill) => pointsOf(fill.get(slotKey) || null))));
    }
    return made.get(key);
  };
}

/**
 * THE SCALES FOR `o.avgHeat` BELOW: the Avg column on the same scale, the same
 * way — a slot row's Avg against the other squads' Avg in that slot, the total's
 * against their totals'. Each Avg is the one the table prints (`meanOf`).
 *
 * @param {Array<Array<{week:number, total:number, starters:Array}>>} squads
 * @param {Object} [o] `rows` or `slots`, as `seasonHeat`
 * @returns {(slotKey:string|null) => Object|null} a `heatScale`
 */
export function seasonAvgHeat(squads = [], { rows = null, slots = null } = {}) {
  const slotList = rows || slotRows(slots);
  const fills = squads.map((weeks) => (weeks || []).map((w) => fillSlots(w.starters, slotList)));
  const made = new Map();
  return (slotKey = null) => {
    if (!made.has(slotKey)) {
      made.set(slotKey, heatScale(squads.map((weeks, i) => {
        const m = meanOf(slotKey === null
          ? (weeks || []).map((w) => w.total)
          : fills[i].map((fill) => pointsOf(fill.get(slotKey) || null)));
        return m === null ? null : tenth(m);
      })));
    }
    return made.get(slotKey);
  };
}

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
 * @param {Iterable<number>|null} [o.live] the weeks still being played for this
 *        squad: each one's column head carries `LIVE_TAG` beside the number
 * @param {boolean} [o.sortable] every heading carries `data-sort` and a slot's
 *        name sorts in lineup order, for `enableSort` (js/sortable.js). The
 *        total row is a body of its own, which sortable.js never moves.
 * @param {((week:number, slotKey:string|null) => Object|null)|null} [o.heat]
 *        `seasonHeat(...)`: each points cell, and the total, is drawn on that
 *        scale — class, ▲/▼ at the end of it, and the words in its title. Not
 *        in the difference view, whose colour already says up or down.
 * @param {boolean} [o.proj] each man's projection is printed before his score,
 *        dim (`.sbw-pj`, with `data-r` the same to the whole point for a page
 *        short of room), and said in the cell's title. Not in the difference view.
 * @param {((week:number, playerId:*) => boolean)|null} [o.mark] true for a man
 *        who starts in one world and not the other: his cell is `sbw-chg`.
 * @param {boolean} [o.avg] a last column, Avg: the mean of the numbers the row
 *        shows, blanks left out; the total row's is the mean of the totals. In
 *        the difference view it is this lineup's Avg minus `diffFrom`'s, as printed.
 * @param {((slotKey:string|null) => Object|null)|null} [o.avgHeat]
 *        `seasonAvgHeat(...)`: the Avg column on the scale. Not in the difference view.
 * @returns {string} `<table class="sbw-table">…`, to sit inside `.sbw`
 */
export function actualSeasonTableHtml({ weeks = [], rows = null, slots = null } = {}, {
  diffFrom = null, dim = null, box = '', totalLabel = 'Total', live = null,
  sortable = false, heat = null, proj = false, mark = null, avg = false, avgHeat = null,
} = {}) {
  const slotList = rows || slotRows(slots);
  const cols = [...weeks].sort((a, b) => a.week - b.week);
  const liveWeeks = new Set(live || []);
  const beforeOf = diffFrom ? new Map(diffFrom.map((w) => [w.week, w])) : null;
  const fills = cols.map((c) => fillSlots(c.starters, slotList));
  const beforeFills = cols.map((c) => {
    const b = beforeOf && beforeOf.get(c.week);
    return b ? fillSlots(b.starters, slotList) : null;
  });
  const styles = cols.map((c) => dimStyle(dimOf(dim, c.week)));

  const sort = sortable ? ' data-sort' : '';
  const scaleOf = heat && !diffFrom ? heat : () => null;
  const head = `<tr><th class="name"${sort}>Slot</th>` +
    cols.map((c) => `<th class="wk"${sort}>${esc(c.week)}${liveWeeks.has(c.week) ? LIVE_TAG : ''}</th>`).join('') +
    `${avg ? `<th class="avg"${sort}>Avg</th>` : ''}</tr>`;

  // `o.mark` and `o.avg`. Without them `chg` and `avgCell` add nothing at all.
  const chg = (e, week) => (mark && e && mark(week, e.p.playerId) ? ' sbw-chg' : '');
  const avgCell = (mine, theirs, key, what) => {
    if (!avg) return '';
    const split = key === null ? ' split-total' : '';
    if (!diffFrom) {
      if (mine === null) return `<td class="avg${split} muted">—</td>`;
      const v = tenth(mine);
      const h = heatOf(v, avgHeat ? avgHeat(key) : null, { what });
      return `<td class="avg${split}${h ? ` ${h.cls}` : ''}" data-v="${v}"` +
        `${h ? ` title="${esc(h.words)}"` : ''}>${fmt(v)}${heatMarkHtml(h)}</td>`;
    }
    const d = mine === null || theirs === null ? null : diffOf(mine, theirs);
    if (d === null) return `<td class="avg${split} muted">—</td>`;
    return `<td class="avg${split} ${diffClass(d)}" data-v="${d}">${signedText(d)}</td>`;
  };
  const rowAvg = (list, key) => meanOf(list.map((fill) => (fill ? pointsOf(fill.get(key) || null) : null)));

  const body = slotList.map((row, place) => {
    const cells = cols.map((c, i) => {
      const e = fills[i].get(row.key) || null;
      const at = ` data-wk="${esc(c.week)}"${styles[i]}`;
      if (!diffFrom) {
        if (!e) return `<td class="wk muted"${at}>—</td>`;
        const v = pointsOf(e);
        const h = heatOf(v, scaleOf(c.week, row.key), { what: `the other squads’ ${row.key} in week ${c.week}` });
        const pj = proj ? projOf(e) : null;
        const both = pj === null ? '' : `: proj ${fmt(pj)}, scored ${fmt(scoreOf(e.p))}`;
        return `<td class="wk${unknown(e) ? ' sbw-proj' : ''}${h ? ` ${h.cls}` : ''}${chg(e, c.week)}" data-v="${v}" data-pid="${esc(e.p.playerId ?? '')}"${at} ` +
          `title="${esc(saidOf(e) + both + (h ? `. ${h.words}` : ''))}">` +
          `${lines(e, (pj === null ? '' : `<span class="sbw-pj" data-r="${Math.round(pj)}">${fmt(pj)}</span> `) + fmt(scoreOf(e.p)) + heatMarkHtml(h))}</td>`;
      }
      // DIFFERENCE: this lineup minus the other, in the same slot row. An
      // empty slot scored nothing, so a slot filled in one and empty in the
      // other is the whole of that man's points; a week `diffFrom` does not
      // have at all has nothing to subtract.
      const b = beforeFills[i] ? beforeFills[i].get(row.key) || null : null;
      if (!beforeFills[i] || (!e && !b)) return `<td class="wk muted"${at}>—</td>`;
      const d = diffOf(pointsOf(e) ?? 0, pointsOf(b) ?? 0);
      const swapped = (e ? e.p.playerId : null) !== (b ? b.p.playerId : null);
      const cls = ['wk', diffClass(d), swapped ? 'sbw-new' : '', unknown(e) ? 'sbw-proj' : ''].filter(Boolean).join(' ') + chg(e, c.week);
      const title = swapped
        ? `${e ? saidOf(e) : 'Nobody'} instead of ${b ? b.p.name : 'nobody'}`
        : saidOf(e);
      return `<td class="${cls}" data-v="${d}"${e ? ` data-pid="${esc(e.p.playerId ?? '')}"` : ''}${at} ` +
        `title="${esc(title)}">${lines(e, signedText(d))}</td>`;
    });
    return `<tr data-slot="${esc(row.key)}"><td class="name"${sortable ? ` data-v="${place}"` : ''}><span class="slot-tag">${esc(row.key)}</span></td>` +
      `${cells.join('')}` +
      `${avgCell(rowAvg(fills, row.key), rowAvg(beforeFills, row.key), row.key, `the other squads’ ${row.key} average`)}</tr>`;
  }).join('');

  const band = `<tr class="split-row"><td class="name split-label">${esc(totalLabel)}</td>` +
    cols.map((c, i) => {
      const at = ` data-wk="${esc(c.week)}"${styles[i]}`;
      if (!diffFrom) {
        const h = heatOf(c.total, scaleOf(c.week, null), { what: `the other squads’ totals in week ${c.week}` });
        return `<td class="wk split-total${h ? ` ${h.cls}` : ''}" data-v="${c.total}"${at}` +
          `${h ? ` title="${esc(h.words)}"` : ''}>${fmt(c.total)}${heatMarkHtml(h)}</td>`;
      }
      const b = beforeOf.get(c.week);
      const d = b ? diffOf(c.total, b.total) : null;
      if (d === null) return `<td class="wk split-total muted"${at}>—</td>`;
      return `<td class="wk split-total ${diffClass(d)}" data-v="${d}"${at}>${signedText(d)}</td>`;
    }).join('') +
    avgCell(meanOf(cols.map((c) => c.total)),
      meanOf(cols.map((c) => { const b = beforeOf && beforeOf.get(c.week); return b ? b.total : null; })),
      null, 'the other squads’ average totals') + `</tr>`;

  return `<table class="sbw-table sbw-actual"${box ? ` data-box="${esc(box)}"` : ''}` +
    `${diffFrom ? ' data-view="diff"' : ''}><thead>${head}</thead>` +
    `<tbody>${body}</tbody><tbody class="split">${band}</tbody></table>`;
}
