// "Standings and season totals" — the Stats page's big table, as rows built
// from a `computeLeagueStats` result and nothing else.
//
// WHY IT IS ITS OWN FILE. The table was drawn by `renderMainTable()` in
// js/stats-page.js straight out of that page's state. The Decisions review
// (docs/decisions-review-plan.md, Tim 2026-10-05) needs the SAME table three
// times over — the season as it happened, the season in a mirror universe, and
// the difference between the two — and "the same columns as Stats" is only true
// for as long as there is one implementation. So the rows are built here, the
// Stats page calls this, and a second page gets the identical cells for free.
//
// THREE RENDERINGS OF ONE TABLE:
//
//   current / hypothetical   `standingsRowsHtml(stats, opts)` — exactly what the
//                            Stats page prints: the red/green scale down each
//                            column, the ± on the luck figures, dashes for a
//                            team with no finished game.
//   difference               the same call with `diffFrom` (the stats result
//                            being compared against): every numeric cell is
//                            `stats − diffFrom` for that team, signed, in the
//                            Trade page's difference classes.
//
// THE DIFFERENCE VIEW'S COLOUR IS "GOOD FOR THAT TEAM", the rule the table's
// own key already states ("Green is good for that team, red is bad … but Opp
// Avg and Opp proj are turned over"). So a rise is green in most columns, a
// rise in Opp Avg or Opp proj is red, and a rank is printed as PLACES GAINED
// (5th to 3rd is +2, green). Spread and PTW have no good end on the Stats page
// and get none here: their change is printed plain.
//
// NOTHING HERE READS PAGE STATE OR THE DOM. Everything a page knows that the
// stats result does not — whose row to mark, the in-play record, the opponent
// projections — comes in through `opts`.

import * as capture from './capture.js';
import { heatScale, heatOf, heatMarkHtml } from './heat.js';
import { esc, signedText, diffOf, diffClass, recordDiff, dimOf, dimStyle } from './view-switch.js';

export { esc };

// ------------------------------------------------------------------ formatting

export const fmt = (n, digits = 1) =>
  n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(digits);

/** Points for, as ESPN shows it: one decimal, thousands-separated (1,845.6).
 *  Whole points used to be shown, which read 1845.60 as 1,846. */
export const pf = (n) =>
  n === null || n === undefined || Number.isNaN(n)
    ? '—'
    : n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const dash = '<span class="muted">—</span>';

/**
 * ROUNDED FIRST, THEN SIGNED (2026-10-06). The sign used to be read off the
 * unrounded number, so −0.07 at whole points printed "-0" in red and 0.37
 * printed "+0" in green, beside a plain "0". A value that rounds to zero is
 * zero: no sign, and the neutral class.
 */
export function signed(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return dash;
  const r = Number(n.toFixed(digits)) + 0;   // + 0: a rounded −0 is 0
  const cls = r > 0 ? 'pos' : r < 0 ? 'neg' : 'muted';
  const sign = r > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${r.toFixed(digits)}</span>`;
}

/**
 * One cell on the red/green scale.
 *
 * @param {number|null} v the value the scale is asked about
 * @param {Object|null} scale a `heatScale(...)` result, or null for no colour
 * @param {Object} [opts]
 * @param {string} [opts.what] the comparison group, in words, for the title
 * @param {string} [opts.text] what to print, when it is not just the number
 * @param {string} [opts.extra] extra attributes (a `data-v` for the sort)
 *
 * The `title` is the "never colour alone" channel that carries the actual
 * standing — js/touch-titles.js turns it into a tap on a phone, so it is not
 * hover-only — and the ▲/▼ at the end of the scale is the one that needs no
 * interaction at all.
 *
 * A COLOURED CELL ALWAYS CARRIES A `data-v`, and that is a bug fix rather than
 * tidiness (2026-09-19). sortable.js's `parseCell` falls back to the cell's
 * TEXT when there is no `data-v`, and it strips `, + $ %` and whitespace — not
 * ▲ or ▼. So every cell at the end of this scale was sorting as the STRING
 * "22.1 ▲" while its uncoloured neighbours sorted as numbers, which quietly put
 * the best and worst rows of a column in the wrong places the moment anybody
 * clicked the heading. The value is written unrounded, exactly as every other
 * `data-v` on the page is; a caller that already supplies its own `data-v` in
 * `extra` (the Opp proj cell) keeps it.
 */
export function heatCell(v, scale, { what = 'the rest of the league', text = null, extra = '' } = {}) {
  const shown = text === null ? fmt(v) : text;
  const h = heatOf(v, scale, { what });
  const dv = typeof v === 'number' && Number.isFinite(v) && !/\bdata-v=/.test(extra)
    ? ` data-v="${v}"`
    : '';
  if (!h) return `<td${extra ? ` ${extra}` : ''}${dv}>${shown}</td>`;
  return `<td class="${h.cls}"${extra ? ` ${extra}` : ''}${dv} title="${esc(h.words)}">` +
    `${shown}${heatMarkHtml(h)}</td>`;
}

// ---------------------------------------------------------------- the record

/** The banked record in whole numbers — what a page with no live read prints. */
const bankedRecord = (t) => capture.recordNow({ w: t.wins, l: t.losses, t: t.ties });

/**
 * Win percentage the way ESPN ranks a standings table: a tie is half a win.
 * Null before a game is played. `rec` is a `capture.recordNow` result, so a
 * game being played counts as a game, won by its chance — the number the
 * Record cell shows.
 */
export const winPctOf = (rec) => (rec.games ? rec.wins / rec.games : null);

/** One sortable number for ESPN's order (win percentage, then points for). A
 *  step in win percentage is at least 1/30 of a game, which times 1e6 dwarfs
 *  any season's points for. */
export const recordSortKey = (rec, pointsFor) => (winPctOf(rec) ?? 0) * 1e6 + pointsFor;

// ------------------------------------------------------------------ the scales

/** A team with no finished game yet has no average of anything (stats.js says 0). */
const unplayed = (t) => !t.weekly.length;

const oppOf = (oppProj, id) => (oppProj ? oppProj.get(id) || null : null);

/**
 * The six scales the table is coloured with, one per column and never one
 * across the table, plus the two facts every cell turns on.
 *
 * A team whose first game is still being played has no result yet while others
 * do (the week in progress): it is left out of every scale and its result
 * columns are dashed, exactly as the whole table is before a game is played.
 *
 * WHICH COLUMNS, AND WHICH ARE DELIBERATELY NOT (moved here with the rows from
 * js/stats-page.js). F−A is the DIFFERENCE of the two coloured averages, so it
 * carries an ordering neither does; Luck/wk is high-is-good, as the week grid
 * already scales it. Left alone: Total (Avg times the same number of games for
 * everyone) and Skill (Proj minus the same league average) would repeat a
 * colour already in the row; Spread has no good end — a consistent bad team
 * and a volatile good one are both real — and js/heat.js's rule is that such a
 * column gets no scale rather than a misleading one.
 *
 * @param {Object} stats a `computeLeagueStats` result
 * @param {Object} [o]
 * @param {Map<*, {avgOpp:number}>|null} [o.oppProj] team id -> its average
 *        projected opponent (the Stats page's `oppProj.byTeam`)
 * @returns {{none:boolean, ghosts:boolean, avg, proj, opp, oppProj, fa, luckWk}}
 *          `opp` and `oppProj` are INVERTED: a high opponent average is a hard
 *          schedule.
 */
export function standingsScales(stats, { oppProj = null } = {}) {
  // With no completed weeks every one of these is an average of nothing, which
  // stats.js correctly computes as 0 and this must not print as a score.
  const none = stats.weekNumbers.length === 0;
  const withGames = none ? [] : stats.teams.filter((t) => !unplayed(t));
  const opps = stats.teams
    .map((t) => oppOf(oppProj, t.id))
    .filter(Boolean)
    .map((o) => o.avgOpp)
    .sort((a, b) => b - a);
  return {
    none,
    ghosts: !none && withGames.length < stats.teams.length,
    avg: heatScale(withGames.map((t) => t.avgActual)),
    proj: heatScale(withGames.map((t) => t.avgProjected)),
    opp: heatScale(withGames.map((t) => t.oppAvgActual), { invert: true }),
    oppProj: heatScale(opps, { invert: true }),
    fa: heatScale(withGames.map((t) => t.forMinusAgainst)),
    luckWk: heatScale(withGames.map((t) => t.avgLuck)),
  };
}

const W_AVG = 'what the league averages a week';
const W_PROJ = 'what the league is projected a week';
const W_OPP = 'the opponents the rest of the league has faced';
const W_OPP_PROJ = 'the schedules the rest of the league drew';
const W_FA = 'the margins the rest of the league is winning by';
const W_LUCK = 'how far the rest of the league is beating its projection';

// -------------------------------------------------------------------- the rows

/** The current (or hypothetical) cells of one team, name first. */
function teamCells(t, { scales, recordOf, oppProj }) {
  const { none, ghosts } = scales;
  // SHOWN FROM WEEK 1, WITH A MARGIN: each luck figure carries a ± (one
  // standard error — see attachLuckMargins in stats.js) that is huge after one
  // game and narrows every week.
  const luck = (v, m) => {
    if (none || v === null || v === undefined) return `<td>${dash}</td>`;
    const pm = m === null || m === undefined ? '' : `<span class="pm">±${Math.round(m)}</span>`;
    return `<td data-v="${v}">${signed(v)}${pm}</td>`;
  };
  const rank = (v) => (none || v === null ? dash : `<span class="rank">${v}</span>`);
  const num = (v) => (none ? dash : fmt(v));
  const sgn = (v) => (none ? dash : signed(v));

  // No finished game of his own yet: every result column is a dash.
  const off = none || unplayed(t);
  const n = (v) => (off ? dash : num(v));
  const g = (v) => (off ? dash : sgn(v));
  const lk = (v, m) => (off ? `<td>${dash}</td>` : luck(v, m));
  // LS, PS and AS wait for everybody: stats.js ranks all ten at once, and a
  // team with no game would be ranked on an average of nothing.
  const rk = (v) => (off || ghosts ? dash : rank(v));
  const rec = recordOf(t);
  // The Opp proj cell. data-v is omitted entirely when the number is unknown —
  // an empty data-v parses as 0 and would rank a team we know nothing about as
  // having the easiest schedule in the league.
  const o = oppOf(oppProj, t.id);
  return [
    `<td class="name">${esc(t.name)}</td>`,
    `<td data-v="${recordSortKey(rec, t.pointsFor)}"${rec.live ? ` title="${esc(rec.title)}"` : ''}>${rec.text}</td>`,
    heatCell(off ? null : t.avgActual, scales.avg, { what: W_AVG, text: n(t.avgActual) }),
    heatCell(off ? null : t.avgProjected, scales.proj, { what: W_PROJ, text: n(t.avgProjected) }),
    `<td${off ? '' : ` data-v="${t.pointsFor}"`}>${off ? dash : pf(t.totalActual)}</td>`,
    heatCell(off ? null : t.oppAvgActual, scales.opp, { what: W_OPP, text: n(t.oppAvgActual) }),
    heatCell(off ? null : t.forMinusAgainst, scales.fa, { what: W_FA, text: g(t.forMinusAgainst) }),
    `<td>${n(t.actualStdev)}</td>`,
    o ? heatCell(o.avgOpp, scales.oppProj, { what: W_OPP_PROJ, extra: `data-v="${o.avgOpp}"` }) : `<td>${dash}</td>`,
    heatCell(off ? null : t.avgLuck, scales.luckWk, { what: W_LUCK, text: g(t.avgLuck) }),
    `<td>${n(t.pointsToWin)}</td>`,
    lk(t.scoreDiffLuck, t.margins && t.margins.scoreDiffLuck),
    lk(t.luckScore, t.margins && t.margins.luckScore),
    `<td>${g(t.skill)}</td>`,
    lk(t.skillPlusLuck, t.margins && t.margins.skillPlusLuck),
    `<td>${rk(t.luckStanding)}</td>`,
    `<td>${rk(t.projectedStanding)}</td>`,
    `<td>${rk(t.actualStanding)}</td>`,
  ];
}

/** One difference cell: signed, classed, sortable — or a dash when unknown. */
function diffCell(d, good, text = null) {
  if (d === null) return `<td>${dash}</td>`;
  const cls = diffClass(d, good);
  return `<td${cls ? ` class="${cls}"` : ''} data-v="${d}">${text === null ? signedText(d) : text}</td>`;
}

/** The difference cells of one team: `t` (hypothetical) minus `c` (current). */
function teamDiffCells(t, c, { scales, base, oppProj, diffOppProj }) {
  const name = `<td class="name">${esc(t.name)}</td>`;
  const blank = `<td>${dash}</td>`;
  if (!c) return [name, ...Array(17).fill(blank)];

  const off = scales.none || base.none || unplayed(t) || unplayed(c);
  const pts = (key, good = 1) => (off ? blank : diffCell(diffOf(t[key], c[key]), good));
  // A rank, as places gained: 5th in the season that happened, 3rd in this
  // one, is +2. Whole numbers, and "up" is the smaller rank.
  const places = (key) => {
    if (off || scales.ghosts || base.ghosts || t[key] == null || c[key] == null) return blank;
    const d = c[key] - t[key];
    return diffCell(d, 1, signedText(d, 0));
  };
  const rec = recordDiff({ w: t.wins, l: t.losses, t: t.ties }, { w: c.wins, l: c.losses, t: c.ties });
  const o = oppOf(oppProj, t.id);
  const oc = oppOf(diffOppProj, t.id);
  return [
    name,
    diffCell(rec.value, 1, rec.text),
    pts('avgActual'),
    pts('avgProjected'),
    pts('totalActual'),
    pts('oppAvgActual', -1),
    pts('forMinusAgainst'),
    pts('actualStdev', 0),
    o && oc ? diffCell(diffOf(o.avgOpp, oc.avgOpp), -1) : blank,
    pts('avgLuck'),
    pts('pointsToWin', 0),
    pts('scoreDiffLuck'),
    pts('luckScore'),
    pts('skill'),
    pts('skillPlusLuck'),
    places('luckStanding'),
    places('projectedStanding'),
    places('actualStanding'),
  ];
}

/**
 * The table's body rows, one per team in `stats.teams` order.
 *
 * @param {Object} stats a `computeLeagueStats` result
 * @param {Object} [o]
 * @param {*} [o.highlightId] the team whose row is marked `me`
 * @param {(team) => Object} [o.recordOf] the record to PRINT for a team, as
 *        `capture.recordNow` returns it (`text`, `title`, `live`, `wins`,
 *        `games`). Default: the banked record in whole numbers. The Stats page
 *        passes its own, which counts a game being played as its win chance.
 * @param {Map<*, {avgOpp:number}>|null} [o.oppProj] team id -> average
 *        projected opponent; without it the Opp proj column is dashes
 * @param {Object|null} [o.scales] a `standingsScales(stats, { oppProj })`
 *        result, when the caller already has one (it also needs them for its
 *        key); built here otherwise
 * @param {Object|null} [o.diffFrom] another stats result. Given, every numeric
 *        cell is `stats − diffFrom` for the same team id: points signed to a
 *        tenth, the record as "+1 W", ranks as places gained, in `d-up` /
 *        `d-down` / `d-zero`. No heat colours and no ± in this view.
 * @param {Map<*, {avgOpp:number}>|null} [o.diffOppProj] `diffFrom`'s `oppProj`
 * @param {Map<*, number>|Object|null} [o.dim] team id -> noise 0..1; that
 *        team's cells (not its name) are drawn at opacity 1 − 0.65 × noise
 * @returns {string} `<tr>`s, for a `<tbody>`
 */
export function standingsRowsHtml(stats, {
  highlightId = null, recordOf = bankedRecord, oppProj = null, scales = null,
  diffFrom = null, diffOppProj = null, dim = null,
} = {}) {
  const sc = scales || standingsScales(stats, { oppProj });
  const base = diffFrom ? standingsScales(diffFrom, { oppProj: diffOppProj }) : null;
  const before = diffFrom ? new Map(diffFrom.teams.map((t) => [t.id, t])) : null;

  return stats.teams
    .map((t) => {
      const cells = diffFrom
        ? teamDiffCells(t, before.get(t.id) || null, { scales: sc, base, oppProj, diffOppProj })
        : teamCells(t, { scales: sc, recordOf, oppProj });
      const style = dimStyle(dimOf(dim, t.id));
      const drawn = style ? cells.map((c, i) => (i ? c.replace(/^<td/, `<td${style}`) : c)) : cells;
      return `
      <tr class="${highlightId === t.id ? 'me' : ''}">
        ${drawn.join('\n        ')}
      </tr>`;
    })
    .join('');
}

// ---------------------------------------------------------------- the headings

/** The label row: [label, title]. The same words stats.html prints. */
const HEAD = [
  ['Team', 'Click any header to sort by that column.'],
  ['W–L', 'Wins–losses, plus ties when there are any. Sorts the way ESPN ranks: win percentage with a tie as half a win, then points for.'],
  ['Avg', 'Average points you scored per week.'],
  ['Proj', 'Average of ESPN’s projection for you, per week.'],
  ['Total', 'Total points scored so far this season.'],
  ['Opp Avg', 'Average points your opponents scored against you.'],
  ['F−A', 'Points for minus points against, per week — your average weekly margin.'],
  ['Spread', 'Spread: the standard deviation of your weekly scores. Low means week-to-week consistency. Needs at least two weeks.'],
  ['Opp proj', 'Opponent projection: the average of what the teams on your schedule are projected to score, across every fixture you play in the whole season. High means a hard schedule.'],
  ['Luck/wk', 'Luck per week: your average score minus your average projection. Positive means you keep beating your projection.'],
  ['PTW', 'Points to win: your average opponent’s score minus your own average luck — what you needed to score to beat a typical opponent.'],
  ['Close luck', 'Close-game luck (your sheet’s SD): weights each result by how close it was, so a one-point game scores near ±50 and a blowout near zero.'],
  ['Luck score', 'Luck score (your sheet’s LUCK) = league average − (PTW − close luck). Above zero means the season has broken your way.'],
  ['Skill', 'Skill = your average projected score minus the league’s average projected score.'],
  ['S+L', 'Skill + luck score (your sheet’s S+L).'],
  ['LS', 'LS: rank in the league by luck score.'],
  ['PS', 'PS: rank by skill + luck score.'],
  ['AS', 'AS: rank by actual record, ties broken on total points.'],
];

/**
 * The single-week wording the Stats page uses: with one week played a column
 * is that week's score, not an average of anything.
 *
 * @returns {{group:string, avg:string, oppAvg:string}}
 */
export function standingsHeadings(stats) {
  const oneWeek = stats.weekNumbers.length === 1;
  return {
    group: oneWeek ? `Scoring — week ${stats.weekNumbers[0]} only` : 'Scoring',
    avg: oneWeek ? 'Score' : 'Avg',
    oppAvg: oneWeek ? 'Opp score' : 'Opp Avg',
  };
}

/**
 * The whole table — headings and rows — for a page that has no `<table>` of its
 * own to fill. Same columns, same group band, same heading words as stats.html.
 * `class="standings-table"`; the difference view adds `data-view="diff"`. The
 * heading row carries `data-sort`, so `enableSort(table)` works on it as is.
 *
 * @param {Object} stats a `computeLeagueStats` result
 * @param {Object} [opts] everything `standingsRowsHtml` takes, plus
 * @param {string} [opts.id] the table's id
 * @returns {string}
 */
export function standingsTableHtml(stats, opts = {}) {
  const h = standingsHeadings(stats);
  const label = (i, text) => (i === 2 ? h.avg : i === 5 ? h.oppAvg : text);
  const head =
    `<tr class="colgroup"><th></th><th>Record</th><th colspan="6">${esc(h.group)}</th>` +
    `<th colspan="7">Luck &amp; skill</th><th colspan="3">Ranks</th></tr>` +
    `<tr>${HEAD.map(([text, title], i) =>
      `<th${i ? '' : ' class="name"'} data-sort title="${esc(title)}">${esc(label(i, text))}</th>`).join('')}</tr>`;
  return `<table class="standings-table"${opts.id ? ` id="${esc(opts.id)}"` : ''}` +
    `${opts.diffFrom ? ' data-view="diff"' : ''}><thead>${head}</thead>` +
    `<tbody>${standingsRowsHtml(stats, opts)}</tbody></table>`;
}
