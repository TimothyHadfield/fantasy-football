// "ALL TEAMS · PROJ AVG" — the one copy, drawn on two pages.
//
// Tim, 2026-10-18: "in the trade section, the depth map is useless and I don't
// like it. Just show the all teams proj avg 2026 graph there instead. (make
// sure that it's only taking into account future weeks like I asked)."
//
// So the grid the Analysis page draws on its Proj avg measure is drawn again on
// the Trade page, where the depth map was. It has to be the SAME grid — same
// numbers, same weeks, same colours, same cards — and the only way two pages
// keep agreeing about that is to share the code. This file is that code, MOVED
// out of js/analysis-page.js: the per-slot averages over the weeks still to
// come, the per-column red/green scale, the cells, the two cards, the key.
//
// HOW A PAGE USES IT
//
//   js/who-to-start.js must be configured first (`configure` there): the weeks,
//   the season's rosters (`seasonWeeks`), the played weeks and the memo key all
//   come from it, which is what makes "a week still to come" one rule.
//
//   configure({ floors, valueOn, asValue, sheetWords })
//       floors      () => the page's positional floors (js/floor.js), or null
//       valueOn     () => true while the page shows Value instead of Proj
//       asValue     (p, v) => that projection as a Value
//       sheetWords  true on the Analysis page only: the sentences that point
//                   at its "Season by week" panel, which the Trade page has not
//
//   const g = gridHtml({ teams, rows, slots, weeks, nameCell, rowClass, prefix });
//   thead.innerHTML = g.head; tbody.innerHTML = g.body;
//   key.innerHTML = keyHtml(keyItems(tbody, g.bandCols), hint);
//
// IT COSTS NOTHING. Nothing in here fetches; every number is one the page
// already holds.

import {
  historyWeeks, isPlayoff, weeklyFills, fillsKey, regularAvg, regularCount,
  spanWeeks, round1, fmt, esc, plural, cardAttr, withCard, placeOf, valueWords,
} from './who-to-start.js';
import { assessSlot, lineupTotal } from './lineup-avg.js';
import { heatScale, heatOf, heatMarkHtml } from './heat.js';
import { teamWeekSpec } from './pop.js';
import { teamHref } from './links.js';

let floors = () => null;
let valueOn = () => false;
let asValue = () => null;
let sheetWords = false;

/** Point the grid at a page. Call it once, before anything here is drawn. */
export function configure(page) {
  floors = page.floors || (() => null);
  valueOn = page.valueOn || (() => false);
  asValue = page.asValue || (() => null);
  sheetWords = page.sheetWords === true;
}

const assessed = (entry, row) => assessSlot(entry, row, floors());

/** "5 and 7" / "5, 7 and 9" — for naming the weeks that failed. */
export function andList(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The one dim line under a card's rows: the rank, and what the group averages. */
export const standingFoot = (h, group = '') =>
  (h ? `${placeOf(h)}${group ? ` ${group}` : ''} · league avg ${h.avgText}` : '');

/**
 * The two points where a column's colour reaches full saturation, rounded to
 * the tenth — the numbers printed in the key, so a reader checking a cell by
 * hand gets the same answer the page did.
 *
 * A COLUMN WHOSE SPREAD ROUNDS TO NOTHING IS NOT COLOURED (js/heat.js's own
 * refusal), so a band is never printed with its two ends equal and looking
 * like it disagreed with the colour. `slotThresholds` has computed the same two
 * numbers since the season sheet's first low marks; this is that arithmetic
 * lifted out so the all-teams grid can print its own bands the same way.
 */
export function heatBand(scale) {
  if (!scale) return null;
  const edge = scale.edges[scale.edges.length - 1];
  return { lo: round1(scale.mean - edge * scale.sd), hi: round1(scale.mean + edge * scale.sd) };
}

/**
 * The "full colour at" line — one pair of points per column, the same shape as
 * the season sheet's `seasonBars`. '' when no column took a scale.
 *
 * It is the channel that makes a colour CHECKABLE rather than decorative, and
 * it is why a per-column table can honour "never colour alone" without printing
 * a sentence in every cell: the words are on the cell's card, the ▲/▼ is on the
 * ends, the weight moves with the step, and the arithmetic is here. It draws
 * inside each panel's "How this works" toggle (2026-09-19c).
 */
// `titled: false` leaves the lead without its `title` (the Trade page keeps
// raw titles off its panels; its note says the same thing in words).
export function heatBandsHtml(cols, lead = 'Full colour at (red / green):', { titled = true } = {}) {
  const drawn = cols.filter(([, scale]) => scale);
  if (!drawn.length) return '';
  const body = cols.map(([key, scale]) => {
    const band = heatBand(scale);
    return band
      ? `<span class="lg"><strong>${esc(key)}</strong> ${fmt(band.lo)} / ${fmt(band.hi)}</span>`
      : `<span class="lg"><strong>${esc(key)}</strong> —</span>`;
  }).join('');
  if (!titled) return `<span class="lg lg-lead">${esc(lead)}</span>${body}`;
  return `<span class="lg lg-lead" title="At or below the first number a cell in that column is fully ` +
    `red and marked ▼; at or above the second it is fully green and marked ▲. Both sit the same ` +
    `distance from that column's own average across the league, and the shades between them ` +
    `deepen evenly. A column the whole league sits inside one printed tenth ` +
    `of shows a dash and is never coloured.">${esc(lead)}</span>${body}`;
}

/**
 * THE SHORT VISIBLE KEY FOR THE SCALE, and it is one chip on the legend line.
 *
 * What it has to say is only this: the colour is not the only cue. The two
 * swatches beside it already name the comparison group, so what is missing is
 * the pair of hue-free channels — the ▲/▼ at the end of the scale and the
 * weight that moves with every step — and where the numbers went.
 *
 * It says where the points are rather than assuming they will be found: a
 * reader who checks a cell by hand and cannot see the thresholds concludes they
 * were dropped, which is exactly the thing this must not look like.
 */
export const HEAT_CUES_KEY = 'ends carry an arrow and heavier type; the points are in the toggle below';

/**
 * The columns a scale was REFUSED on, named on screen.
 *
 * A refusal is not method, it is a fact about the table: nine coloured columns
 * beside one bare one is a reader's first question, so it stays in view.
 *
 * `anyColour` is whether the table draws the scale ANYWHERE, and it is passed in
 * rather than inferred from `cols` because the two are not the same question:
 * the season sheet's Starting lineup band can be coloured while every slot row
 * above it is too thin to scale, which is the one case where naming the
 * uncoloured columns matters most.
 *
 * Empty, and so free, whenever every column is coloured — the usual case.
 */
export function heatRefusedHtml(cols, anyColour) {
  const refused = cols.filter(([, scale]) => !scale).map(([key]) => key);
  if (!anyColour || !refused.length) return '';
  return `${andList(refused.map((k) => `<strong>${esc(k)}</strong>`))} ` +
    `${refused.length === 1 ? 'is' : 'are'} not coloured — too few numbers, or the whole ` +
    `league inside one printed tenth`;
}

/**
 * The compact key under a table: each mark as the table draws it, then a few
 * words. `items` may hold falsy entries for marks not on screen; they are
 * dropped. `hint` is how to use the table, said in a few words, last.
 */
export function keyHtml(items, hint = '') {
  const parts = items
    .filter(Boolean)
    .map(([mark, words]) => `<span class="lg">${mark}<span>${words}</span></span>`);
  if (hint) parts.push(`<span class="lg lg-hint">${hint}</span>`);
  return parts.join('');
}

// ------------------------------------ what a squad averages, slot by slot
//
// TIM, 2026-09-19: "In the analysis section, in week by week, there is an Avg
// column that shows the avg proj points of the players who are going to play
// that position, not just the same player every week. This is really good and I
// like it a lot. ... I want to use this exact information and apply it to the
// box above it (all teams, season proj avg), so that for that season avg, it
// doesn't use a single player's proj avg across a season, it uses the avg proj
// points for each position that was calculated and predicted in the box below."
//
// So this is the Avg column of "Season by week", computed for EVERY squad
// rather than only the one on screen. It is the same pass, the same slot rows,
// the same floor and the same regular-season-only rule — "this exact
// information" — and the all-teams grid reads it straight off.
//
// WHY IT IS BETTER THAN WHAT IT REPLACES, in one line: the old Proj avg was
// each man's own season projection over 17 games, so a squad's QB slot was
// worth its quarterback's average even in the week he is on bye, and a manager
// with two useful backs was credited for both in RB1 and RB2 every week whether
// or not they play the same one. This asks a different question — what will
// this SLOT actually be worth, week by week, given whoever fills it — and byes,
// depth and the waiver floor all fall out of it instead of being ignored.

// ONLY THE WEEKS STILL TO COME (Tim, 2026-10-17): "Fix the proj avg 2026 box
// so that it only considers proj of future weeks, not past weeks."
//
// A week is past exactly when the season sheet files it under "Actual
// history" (`historyWeeks`): every matchup in it played on the schedule, or
// somebody in it already finished (`done`, js/season.js) — from that moment
// a finished man's `projected` IS his score, so the week is no projection any
// more. Until then the week in progress still counts. Preseason that is every
// week. Once no regular-season week is left the box falls back to the whole
// season, the figure it showed before, rather than going blank; the note says so.

/** The weeks the Proj avg counts, out of `weeks`. */
export function projAvgWeeks(weeks) {
  const hist = historyWeeks(weeks);
  const ahead = weeks.filter((w) => !hist.has(w));
  return ahead.some((w) => !isPlayoff(w)) ? ahead : weeks;
}

/** True when no regular-season week is left and the Proj avg is the whole season again. */
export function projAvgSeasonOver(weeks) {
  return historyWeeks(weeks).size > 0 && projAvgWeeks(weeks) === weeks;
}

/** How a Proj avg tooltip names its weeks: 'still to come' once a week is history. */
export function projAvgWord(weeks = spanWeeks()) {
  return historyWeeks(weeks).size && !projAvgSeasonOver(weeks) ? 'still to come' : 'read';
}

/** Memoised on the same key as the fills, plus the floors, which move the numbers. */
let slotAvgs = { key: null, byTeam: new Map() };

/** A signature for the floors, so a late wire read repaints rather than being cached over. */
export function floorsKey() {
  const f = floors();
  if (!f) return 'nofloor';
  return [...f.entries()].map(([k, x]) => `${k}${x.value}`).join(',');
}

/**
 * Every squad's per-slot average over the regular-season weeks on screen.
 *
 * @returns {Map<number, {slots: Map<string, {avg:number|null, n:number,
 *   assumed:number, who:Array<{name:string, n:number, playerId:*}>}>,
 *   total:number|null, weeks:number}>}
 *
 * The TOTAL is the whole lineup averaged — each week's assessed starting
 * eleven added up, then those totals averaged — and NOT the sum of the ten
 * column averages. They are the same arithmetic in principle and can differ by
 * a tenth in practice, because each column is rounded before it is printed and
 * because a week nobody could fill a slot in leaves that column one week short.
 * Taking it this way is what makes the grid's Total the very number the season
 * sheet's "Starting lineup" band shows for that squad; the note says so.
 */
export function teamSlotAverages(rows, slots, weeks) {
  const ahead = new Set(projAvgWeeks(weeks));
  const key = `${fillsKey(rows, weeks)}|${floorsKey()}|c${[...ahead].join(',')}`;
  if (slotAvgs.key === key) return slotAvgs.byTeam;

  // The fills are the whole season's (shared with the sheet); a past week is
  // simply left out of every average below, as if it had not been read.
  const all = weeklyFills(rows, slots, weeks);
  const byWeek = new Map([...all].filter(([w]) => ahead.has(w)));
  const teamIds = new Set();
  for (const perTeam of byWeek.values()) for (const id of perTeam.keys()) teamIds.add(id);

  const byTeam = new Map();
  for (const id of teamIds) {
    const cells = new Map();
    for (const row of rows) {
      // Aligned to `weeks` so `regularAvg` can drop the playoff columns by
      // index — the same function the sheet's own Avg column uses, which is
      // what keeps "not counted in Avg" meaning one thing on this page.
      const values = [];
      const who = new Map();
      let assumedWeeks = 0;
      for (const w of weeks) {
        const perTeam = byWeek.get(w);
        const fill = perTeam ? perTeam.get(id) : null;
        if (!fill) { values.push(null); continue; }
        const e = fill.get(row.key) || null;
        const a = assessed(e, row);
        values.push(a.value);
        if (a.assumed && !isPlayoff(w)) assumedWeeks += 1;
        if (e && !isPlayoff(w)) {
          const k = String(e.p.playerId ?? e.p.name);
          const held = who.get(k);
          if (held) held.n += 1;
          else who.set(k, { name: e.p.name, playerId: e.p.playerId ?? null, n: 1 });
        }
      }
      const counted = values.filter((v, i) => !isPlayoff(weeks[i]) && typeof v === 'number').length;
      cells.set(row.key, {
        avg: regularAvg(values, weeks),
        n: counted,
        assumed: assumedWeeks,
        who: [...who.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)),
      });
    }

    // The week totals, exactly as the season sheet's band builds them.
    const totals = weeks.map((w) => {
      const perTeam = byWeek.get(w);
      const fill = perTeam ? perTeam.get(id) : null;
      return fill ? lineupTotal(fill, rows, floors()) : null;
    });

    byTeam.set(id, {
      slots: cells,
      total: regularAvg(totals, weeks),
      weeks: totals.filter((v, i) => !isPlayoff(weeks[i]) && typeof v === 'number').length,
    });
  }

  slotAvgs = { key, byTeam };
  return byTeam;
}

/** Memoised like the averages; only ever filled while the page shows Value. */
let slotValueAvgs = { key: null, byTeam: new Map() };

/**
 * `teamSlotAverages` AS THE GRID DRAWS IT. On Proj that is the thing itself.
 * On Value every slot's average is the mean of its weeks' VALUES — each week's
 * man at his own position's lines — over the same regular-season weeks, and
 * nothing is floored: a man under the waiver line is simply worth 0. A week
 * nobody fills the slot has no man to value and is not counted. The Total is
 * the projection it always was.
 */
export function drawnSlotAverages(rows, slots, weeks) {
  const plain = teamSlotAverages(rows, slots, weeks);
  if (!valueOn()) return plain;
  const ahead = new Set(projAvgWeeks(weeks));
  const key = `${fillsKey(rows, weeks)}|value|c${[...ahead].join(',')}`;
  if (slotValueAvgs.key === key) return slotValueAvgs.byTeam;

  const byWeek = new Map([...weeklyFills(rows, slots, weeks)].filter(([w]) => ahead.has(w)));
  const byTeam = new Map();
  for (const [id, got] of plain) {
    const cells = new Map();
    for (const row of rows) {
      const values = weeks.map((w) => {
        const perTeam = byWeek.get(w);
        const fill = perTeam ? perTeam.get(id) : null;
        const e = fill ? fill.get(row.key) : null;
        return e && typeof e.v === 'number' ? asValue(e.p, e.v) : null;
      });
      const avg = regularAvg(values, weeks);
      cells.set(row.key, {
        ...got.slots.get(row.key),
        avg: avg === null ? null : round1(avg),
        n: regularCount(values, weeks),
        assumed: 0,
        value: true,
      });
    }
    byTeam.set(id, { ...got, slots: cells });
  }

  slotValueAvgs = { key, byTeam };
  return byTeam;
}

/**
 * THE PER-SLOT SCALES FOR A SEASON AVERAGE, and the one place they are built.
 *
 * Two panels draw the same numbers: the all-teams grid on its Proj avg measure
 * draws all ten squads, and "Season by week" draws one squad's column of them
 * as its Avg. They must therefore be on ONE scale, and the only way to be sure
 * of that is for there to be one function — HANDOFF's "a floor that reaches one
 * panel and not its neighbour is worse than no floor", applied to a colour.
 *
 * THE GROUP IS THE COLUMN: a squad's WR2 average against the other nine squads'
 * WR2 averages, never against its own QB column.
 *
 * @returns {{byTeam:Map, cols:Map<string,Object|null>, total:Object|null}}
 */
export function slotAvgScales(teams, rows, slots, weeks) {
  // As DRAWN: on Value the columns are scaled on the Values in them.
  const byTeam = drawnSlotAverages(rows, slots, weeks);
  const cols = new Map(rows.map((r) => [r.key, heatScale(
    teams.map((t) => {
      const got = byTeam.get(t.id);
      const cell = got ? got.slots.get(r.key) : null;
      return cell ? cell.avg : null;
    })
  )]));
  // The Total column is a comparison group of exactly the same kind — ten whole
  // starting lineups in an average week — so it takes the scale too. Leaving it
  // plain in a coloured table would read as "this one could not be measured".
  const total = heatScale(teams.map((t) => {
    const got = byTeam.get(t.id);
    return got ? got.total : null;
  }));
  return { byTeam, cols, total };
}

/**
 * ALL TEAMS, PROJ AVG — one slot's average: who fills it and for how many
 * weeks, how many of those weeks are counted at the waiver floor, the rank.
 */
export function slotAvgCard(team, row, cell, heat) {
  const shown = cell.who.slice(0, 5);
  const rest = cell.who.slice(5).reduce((n, p) => n + p.n, 0);
  const rows = shown.map((p) => ({ label: p.name, value: plural(p.n, 'week') }));
  if (rest) rows.push({ label: `${plural(cell.who.length - 5, 'other')}`, value: plural(rest, 'week') });
  return {
    title: team.name,
    sub: `${row.key} · ${cell.value ? 'Value avg' : 'Proj avg'}`,
    rows,
    totals: cell.assumed
      ? [{ label: 'Counted at the waiver floor', value: plural(cell.assumed, 'week') }]
      : [],
    total: { label: `Avg of ${plural(cell.n, 'week')}`, value: cell.avg },
    foot: standingFoot(heat),
    href: teamHref(team.id),
    hrefLabel: 'Open roster',
  };
}

/** ALL TEAMS, PROJ AVG — the Total as the slot averages it is the sum of. */
export function avgTotalCard(team, rows, got, heat) {
  if (!got || got.total === null) return null;
  const lines = rows.map((r) => {
    const cell = got.slots.get(r.key);
    if (!cell || cell.avg === null) return null;
    const top = cell.who[0];
    return {
      slot: r.key,
      name: top ? top.name : 'Waiver floor',
      pts: round1(cell.avg),
      note: cell.who.length > 1 ? `+${cell.who.length - 1} more` : '',
    };
  }).filter(Boolean);
  if (!lines.length) return null;
  const spec = teamWeekSpec({
    team: team.name,
    total: got.total,
    starters: lines.map((l) => ({ slot: l.slot, name: l.name, pts: l.pts })),
    href: teamHref(team.id),
  });
  lines.forEach((l, i) => { if (l.note && spec.rows[i]) spec.rows[i].note = l.note; });
  spec.sub = 'Proj avg';
  spec.total = { label: `Avg of ${plural(got.weeks, 'week')}`, value: got.total };
  spec.foot = standingFoot(heat);
  return spec;
}

/**
 * One squad's average at one slot. A number about a SLOT, so it names nobody.
 * `waiting`: none of the weeks it counts has been read yet.
 */
export function avgCell(cell, row, team, scale, { waiting = false, prefix = 'ov' } = {}) {
  const base = 'slot-avg';
  if (!cell || cell.avg === null) {
    // Nothing read yet is not the same as nothing there, and the two must not
    // share a mark: one resolves itself in a few seconds, the other never does.
    // Only the weeks it counts matter: played weeks landing first is still "loading".
    return waiting
      ? `<td class="${base} wait" title="No week has been read from ESPN yet, so there is nothing ` +
        `to average.${sheetWords ? ' The Season by week panel below reports the progress.' : ''}">·</td>`
      : `<td class="${base} muted" title="No week read so far gives ${esc(team.name)} an ` +
        `${esc(row.key)} at all.">—</td>`;
  }

  const who = cell.who.slice(0, 3)
    .map((p) => `${p.name} (${p.n})`)
    .join(', ');
  const more = cell.who.length > 3 ? `, and ${cell.who.length - 3} more` : '';
  const says = (cell.value
    ? `${team.name}'s ${row.key} has a Value of ${fmt(cell.avg)} in an average week — each ` +
      `week's man at his own Value, averaged over ${plural(cell.n, 'regular-season week')} ` +
      projAvgWord()
    : `${team.name}'s ${row.key} is worth ${fmt(cell.avg)} in an average week — that slot's ` +
      `projection over ${plural(cell.n, 'regular-season week')} ` +
      `${projAvgWord()}, whoever fills it`) +
    (who ? `: ${who}${more}.` : '.') +
    (cell.assumed
      ? ` ${cell.assumed} of those ${cell.assumed === 1 ? 'is' : 'are'} assessed at the waiver ` +
        `floor rather than ESPN's own number.`
      : '');

  // The scale, and the sentence that goes with it. Both claims can be on one
  // cell — green because it is a good slot, orange because some of the weeks in
  // it are the site's assumption rather than ESPN's number — and they survive
  // together because the scale owns the background and `assumed` owns the text.
  const h = heatOf(cell.avg, scale, { what: `the other squads’ ${row.key}` });

  // THE CARD says it as rows (who, for how many weeks, the floor, the rank);
  // the sentence stays as the cell's `aria-label`. Not a tab stop: ten of these
  // a row, and the row's Total and name are.
  return withCard(`<td class="${base}${cell.assumed ? ' assumed' : ''}${h ? ` ${h.cls}` : ''}" ` +
    `data-v="${cell.avg}" title="${esc(says + (h ? ` ${h.words}` : ''))}">` +
    `${fmt(cell.avg)}${heatMarkHtml(h)}</td>`, cardAttr(slotAvgCard(team, row, cell, h), prefix, false));
}

/** The Total cell's sentence — it is the one number that ties the two panels together. */
export function totalAvgLabel(team, got) {
  if (!got || got.total === null) {
    return `No week has been read yet, so ${team.name}'s lineup has nothing to average.`;
  }
  return `${team.name}'s best legal lineup projects ${fmt(got.total)} in an average week, over ` +
    `${plural(got.weeks, 'regular-season week')} ${projAvgWord()}.` +
    (sheetWords && !historyWeeks().size ? ` It is the same figure the Season by week ` +
    `panel's Starting lineup band shows for this squad.` : '');
}

/**
 * THE GRID ITSELF: its header row, its body rows, and the columns the scale
 * was measured on (for the key and the thresholds strip).
 *
 * One row per squad, one column per LINEUP SLOT, and every cell the season
 * sheet's own Avg for that slot over the weeks still to come. A cell names
 * nobody and links nowhere — who actually filled it, and how often, is on its
 * card. There is no bench: the man covering RB1's bye IS the RB1 average that
 * week.
 *
 * @param {Object} o
 * @param {Array} o.teams      the squads, in the order to draw them
 * @param {Array} o.rows       `slotRows(slots)`
 * @param {Object} o.slots     the league's lineup slots
 * @param {number[]} o.weeks   `spanWeeks()`
 * @param {string} o.teamHead  the Team column's title
 * @param {Function} o.nameCell  team -> its `<td class="name">`
 * @param {Function} o.rowClass  team -> the row's classes ('picked', 'me')
 * @param {string} [o.prefix]  the stat-card prefix this table registers under
 */
export function gridHtml({ teams, rows, slots, weeks, teamHead, nameCell, rowClass, prefix = 'ov' }) {
  const head =
    `<tr>
       <th class="name" data-sort title="${teamHead}">Team</th>
       ${rows.map((r) => `<th data-sort title="What this squad's ${esc(r.key)} is worth in an ` +
         `average week: that slot's projection in every regular-season week ` +
         `${projAvgWord(weeks)}, averaged. ` +
         `Whoever fills it — it is a slot, not a man.${valueWords()}">${esc(r.key)}</th>`).join('')}
       <th class="grid-total grouped" data-sort title="What this squad's whole starting lineup ` +
         `projects in an average week. It is the week-by-week lineup total averaged` +
         (!sheetWords || historyWeeks(weeks).size ? '' : `, which is the ` +
         `same number the Season by week panel's ‘Starting lineup’ band shows`) + ` — so rounding can ` +
         `leave it a tenth off adding the columns.">Total</th>
     </tr>`;

  // ------------------------------------------- the red/green scale, per COLUMN
  //
  // Tim's words are the specification: "in this All teams, proj avg 2026
  // chart, positions with higher proj than the others will be green and lower
  // will be red." So a column is a comparison group and the table is not: a
  // squad's WR2 average against the other nine squads' WR2 averages, never
  // against its own QB column. Measured on the numbers actually DRAWN in the
  // cells — the ten cells in a column ARE the distribution.
  const { byTeam, cols: colScale, total: totalScale } = slotAvgScales(teams, rows, slots, weeks);
  const fills = weeklyFills(rows, slots, weeks);
  const waiting = !projAvgWeeks(weeks).some((w) => fills.has(w));

  const body = teams
    .map((t) => {
      const got = byTeam.get(t.id);
      const cls = rowClass(t);
      const cells = rows
        .map((r) => avgCell(got ? got.slots.get(r.key) : null, r, t, colScale.get(r.key), { waiting, prefix }))
        .join('');
      const total = got ? got.total : null;
      const th = heatOf(total, totalScale, { what: 'the other squads’ lineups' });
      return `
      <tr class="${cls}" data-team="${t.id}">
        ${nameCell(t)}
        ${cells}
        ${withCard(`<td class="grid-total grouped${th ? ` ${th.cls}` : ''}"` +
        `${total === null ? '' : ` data-v="${total}"`} ` +
        `title="${esc(totalAvgLabel(t, got) + (th ? ` ${th.words}` : ''))}">` +
        `<strong>${fmt(total)}</strong>${heatMarkHtml(th)}</td>`,
        cardAttr(avgTotalCard(t, rows, got, th), prefix))}
      </tr>`;
    })
    .join('');

  // Named once: the key says which columns took no scale, the strip inside the
  // toggle prints the ones that did.
  const bandCols = [...rows.map((r) => [r.key, colScale.get(r.key)]), ['Total', totalScale]];
  return { head, body, bandCols };
}

/** The key's marks for a drawn grid body, each only when the table draws it. */
export function keyItems(body, bandCols) {
  const refused = heatRefusedHtml(bandCols, !!body.querySelector('td.heat'));
  return [
    // THE SCALE FIRST, because it is the loudest thing on the table and a
    // colour with no key is the one thing this site never ships. Two swatches,
    // the two ends; the shades between them are the steps.
    body.querySelector('td.heat-up-4') &&
      ['<span class="lg-mark heat heat-up-4">14.8 <span class="heatmark">▲</span></span>',
        'best in that COLUMN — never compared across columns'],
    body.querySelector('td.heat-dn-4') &&
      ['<span class="lg-mark heat heat-dn-4">9.2 <span class="heatmark">▼</span></span>',
        'worst in it; paler shades are the steps between'],
    // The hue-free cues and where the thresholds are; see HEAT_CUES_KEY.
    body.querySelector('td.heat') && ['', HEAT_CUES_KEY],
    refused && ['', refused],
    body.querySelector('td.assumed') &&
      ['<span class="lg-mark assumed">7.8</span>',
        'some of those weeks are assessed at the waiver floor'],
    body.querySelector('td.wait') && ['<span class="lg-mark faint">·</span>', 'weeks still loading'],
    body.querySelector('td.slot-avg.muted') &&
      ['<span class="lg-mark faint">—</span>', 'no week read for this slot yet'],
  ];
}
