// Checks the three tables the Decisions review shows as CURRENT, HYPOTHETICAL
// and DIFFERENCE (docs/decisions-review-plan.md, Tim 2026-10-05):
//
//   js/standings-table.js       "Standings and season totals" (the Stats page's)
//   js/summary-table.js         "The chart" (the Summary page's)
//   js/actual-season-table.js   "Season by week", in actual points
//   js/view-switch.js           the Hypothetical | Difference switch and the
//                               difference/dim helpers all three share
//
//   node shared-tables-check.mjs
//
// The renderers return strings, so there is no DOM here: a table is cut into
// rows and cells by its tags and the cells are read. For each of the three:
//
//   (a) the CURRENT render holds the cells a hand-made input must produce;
//   (b) an input's difference against ITSELF is every cell zero and `d-zero`;
//   (c) against a changed input, the cells carry numbers worked out by hand
//       below, signed, in `d-up` / `d-down`;
//   (d) a dim map sets the opacity, 1 − 0.65 × noise, and nothing else moves.
//
// THE FIXTURES ARE LEAGUE-SIZED: ten teams, four weeks, twenty games; a
// nine-slot lineup (QB, RB, RB, WR, WR, TE, FLEX, D/ST, K) over four weeks.
// Every score is a round number so the arithmetic in the comments can be redone
// by eye.
//
// That the Stats and Summary pages still draw what they drew before these
// modules existed is NOT asserted here — it was proved by diffing each page's
// table HTML before and after (byte-identical), and the pages' own suites
// (stats-weeks, stats-order, record-live-check, test-summary) read those tables.

import { computeLeagueStats } from '../js/stats.js';
import * as capture from '../js/capture.js';
import { slotRows } from '../js/lineup-slots.js';
import {
  standingsRowsHtml, standingsTableHtml, standingsScales, standingsExplain, EXPLAINED,
  signed as standingsSigned,
} from '../js/standings-table.js';
import { summaryRowsHtml, summaryTableHtml, signed as summarySigned } from '../js/summary-table.js';
import { actualSeasonTableHtml, weeksFromMirror, shortName } from '../js/actual-season-table.js';
import {
  viewSwitchHtml, signedText, diffOf, diffClass, recordDiff, dimOpacity, DIM_DEPTH,
} from '../js/view-switch.js';

let pass = 0, fail = 0;
const eq = (a, b, msg) => {
  if (Object.is(a, b)) { pass++; }
  else { fail++; console.log(`FAIL ${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};
const ok = (cond, msg, detail = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${msg}${detail ? ` — ${detail}` : ''}`); }
};

// ------------------------------------------------------------ reading a table

// Tags only: the Summary chart prints a bare "<1%", which is text, not a tag.
const strip = (html) => html.replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/&amp;/g, '&').trim();
const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};

/** Every `<tr>` of a piece of table HTML, as cells `{ text, cls, v, style, attrs }`. */
function rowsOf(html) {
  return [...html.matchAll(/<tr([^>]*)>([\s\S]*?)<\/tr>/g)].map((r) => ({
    attrs: r[1],
    cells: [...r[2].matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/g)].map((c) => ({
      attrs: c[1],
      html: c[2],
      text: strip(c[2]),
      cls: (attr(c[1], 'class') || '').split(/\s+/).filter(Boolean),
      v: attr(c[1], 'data-v'),
      style: attr(c[1], 'style'),
    })),
  }));
}
const rowNamed = (rows, name) => rows.find((r) => r.cells.length && r.cells[0].text === name);
const count = (html, re) => (html.match(re) || []).length;

// ===================================================================== helpers

eq(signedText(3.6), '+3.6', 'a rise is printed with its plus');
eq(signedText(-0.4), '−0.4', 'a fall with a real minus sign, as the Trade page prints it');
eq(signedText(0), '0.0', 'and no change with no sign');
// ROUNDED FIRST, THEN SIGNED (2026-10-06). The Stats grid printed "-0" in red
// for −0.07 and "+0" in green for 0.37: the sign was read off the unrounded
// number. What rounds to zero is a plain, neutral zero, at either precision,
// in both tables' `signed`.
{
  const span = (cls, text) => `<span class="${cls}">${text}</span>`;
  for (const [v, whole, tenth] of [
    [-0.04, span('muted', '0'), span('muted', '0.0')],
    [0.04, span('muted', '0'), span('muted', '0.0')],
    [-0.5, span('neg', '-1'), span('neg', '-0.5')],
    [0.5, span('pos', '+1'), span('pos', '+0.5')],
    [-0.07, span('muted', '0'), span('neg', '-0.1')],
    [0.37, span('muted', '0'), span('pos', '+0.4')],
    [0, span('muted', '0'), span('muted', '0.0')],
    [-12.34, span('neg', '-12'), span('neg', '-12.3')],
  ]) {
    eq(standingsSigned(v, 0), whole, `signed(${v}) at whole points`);
    eq(standingsSigned(v, 1), tenth, `signed(${v}) at a tenth`);
    eq(standingsSigned(v), tenth, `signed(${v}) defaults to a tenth`);
    eq(summarySigned(v), tenth, `the Summary chart's signed(${v}) is the same string`);
  }
  ok(standingsSigned(null) === summarySigned(null) && /—/.test(standingsSigned(null)), 'and nothing is still a dash');
}
eq(diffOf(122.75, 113.75), 9, 'a difference is the subtraction of the two PRINTED numbers (122.8 − 113.8)');
eq(diffOf(10.04, 9.96), 0, '…so two numbers that print the same differ by nothing (10.0 − 10.0)');
eq(diffOf(5, null), null, 'and a missing side is no difference at all');
eq(diffClass(2), 'd-up', 'up is d-up');
eq(diffClass(-2), 'd-down', 'down is d-down');
eq(diffClass(0), 'd-zero', 'none is d-zero');
eq(diffClass(2, -1), 'd-down', 'a column where a rise is bad turns the colour over');
eq(diffClass(-2, -1), 'd-up', '…both ways');
eq(diffClass(2, 0), '', 'a column with no good end is not coloured when it moves');
eq(diffClass(0, 0), 'd-zero', '…and is still dimmed when it does not');
eq(DIM_DEPTH, 0.65, 'the plan’s dimming constant');
eq(dimOpacity(0), 1, 'no noise is full opacity');
eq(dimOpacity(1), 0.35, 'full noise is 1 − 0.65');
eq(dimOpacity(0.4), 0.74, '0.4 noise is 1 − 0.26');
eq(recordDiff({ w: 1, l: 3, t: 0 }, { w: 0, l: 4, t: 0 }).text, '+1 W', 'one more win reads +1 W');
eq(recordDiff({ w: 2, l: 2, t: 0 }, { w: 4, l: 0, t: 0 }).text, '−2 W', 'two fewer reads −2 W');
eq(recordDiff({ w: 2, l: 2, t: 0 }, { w: 2, l: 2, t: 0 }).text, '0', 'no change reads 0');
eq(recordDiff({ w: 2, l: 2, t: 0 }, { w: 2, l: 1, t: 1 }).text, '+1 L', 'a tie that became a loss: wins level, so the loss is named');
eq(recordDiff({ w: 2, l: 2, t: 0 }, { w: 2, l: 1, t: 1 }).value, -0.5, '…and it counts as half a win lost');

// the switch
{
  const total = viewSwitchHtml('total');
  const diff = viewSwitchHtml('diff', { box: 'season' });
  ok(/^<div class="segmented sbw-view" role="group"/.test(total), 'the switch is the Trade page’s .segmented.sbw-view', total);
  eq(count(total, /<button type="button" data-sbw-view="/g), 2, 'holding two button[data-sbw-view]');
  ok(/data-sbw-view="total" class="on" aria-pressed="true">Hypothetical</.test(total), 'Hypothetical is on by default', total);
  ok(/data-sbw-view="diff" aria-pressed="false">Difference</.test(total), '…and Difference is off', total);
  ok(/data-sbw-view="diff" class="on" aria-pressed="true">Difference</.test(diff), 'asked for diff, Difference is on', diff);
  ok(/data-sbw-view="total" aria-pressed="false">Hypothetical</.test(diff), '…and Hypothetical is off', diff);
  ok(/data-sbw-box="season"/.test(diff), 'and it says which box it belongs to', diff);
}

// ============================================== 1. standings and season totals
//
// Ten teams, T1..T10. Team i scores 100 + 5i EVERY week and is projected 100.
// Four weeks; the higher-numbered team wins every game:
//
//   wk1  1-2  3-4  5-6  7-8  9-10
//   wk2  1-3  2-4  5-7  6-8  9-10
//   wk3  1-4  2-3  5-8  6-7  9-10
//   wk4  1-2  3-4  5-6  7-8  9-10
//
// Wins: T4, T8, T10 = 4 · T2, T3, T6, T7 = 2 · T1, T5, T9 = 0.
// Points for = 4 × (100 + 5i): T1 420 … T10 600.
// AS (wins, then points for): T10, T8, T4 | T7, T6, T3, T2 | T9, T5, T1
//                             = 1, 2, 3  | 4, 5, 6, 7      | 8, 9, 10.

const PAIRS = {
  1: [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]],
  2: [[1, 3], [2, 4], [5, 7], [6, 8], [9, 10]],
  3: [[1, 4], [2, 3], [5, 8], [6, 7], [9, 10]],
  4: [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]],
};
const score = (id) => 100 + 5 * id;

/** The league, with `bump[week][teamId]` replacing that team's score that week. */
function league(bump = {}) {
  const games = [];
  for (const [w, pairs] of Object.entries(PAIRS)) {
    const week = Number(w);
    const act = (id) => (bump[week] && bump[week][id] !== undefined ? bump[week][id] : score(id));
    for (const [h, a] of pairs) {
      games.push({
        week, homeId: h, awayId: a,
        homeActual: act(h), awayActual: act(a), homeProjected: 100, awayProjected: 100,
      });
    }
  }
  return {
    season: 2026, name: 'Fixture', isDemo: false, weeks: 14,
    teams: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name: `T${i + 1}` })),
    games,
  };
}

const real = computeLeagueStats(league());
eq(real.teams.length, 10, 'the fixture is a ten-team league');
eq(real.weekNumbers.length, 4, 'four weeks in');

// Column positions, as stats.html heads them.
const COL = {
  record: 1, avg: 2, proj: 3, total: 4, oppAvg: 5, fa: 6, spread: 7, oppProj: 8, luckWk: 9,
  ptw: 10, close: 11, luck: 12, skill: 13, sl: 14, ls: 15, ps: 16, as: 17,
};
// Every team's schedule is projected the same, so Opp proj has a number and no spread.
const oppProj = new Map(real.teams.map((t) => [t.id, { avgOpp: 100 }]));

// (a) current
{
  const html = standingsRowsHtml(real, { highlightId: 10, oppProj });
  const rows = rowsOf(html);
  eq(rows.length, 10, 'standings: a row a team');
  ok(rows.every((r) => r.cells.length === 18), 'standings: eighteen cells a row, the Stats page’s columns');
  const t10 = rowNamed(rows, 'T10');
  const t1 = rowNamed(rows, 'T1');
  ok(/class="me"/.test(t10.attrs), 'standings: the highlighted team’s row is marked me', t10.attrs);
  ok(!/class="me"/.test(t1.attrs), 'standings: and nobody else’s is', t1.attrs);
  eq(t10.cells[COL.record].text, '4–0', 'standings: T10 won all four');
  eq(t1.cells[COL.record].text, '0–4', 'standings: T1 lost all four');
  eq(t10.cells[COL.avg].text.replace(/[▲▼\s]/g, ''), '150.0', 'standings: T10 averages 150.0');
  eq(t10.cells[COL.total].text, '600.0', 'standings: T10 total 600.0');
  eq(t1.cells[COL.total].text, '420.0', 'standings: T1 total 420.0');
  eq(t10.cells[COL.proj].text, '100.0', 'standings: everyone is projected 100.0');
  eq(t10.cells[COL.oppProj].text, '100.0', 'standings: Opp proj comes from the oppProj map');
  eq(t10.cells[COL.as].text, '1', 'standings: T10 is first on record');
  eq(t1.cells[COL.as].text, '10', 'standings: T1 is last');
  eq(rowNamed(rows, 'T7').cells[COL.as].text, '4', 'standings: T7 leads the two-win teams on points');
  ok(t10.cells[COL.avg].cls.some((c) => /^heat-/.test(c)), 'standings: the best average is on the red/green scale',
    JSON.stringify(t10.cells[COL.avg].cls));
  eq(count(html, /d-up|d-down|d-zero/g), 0, 'standings: no difference classes in the current view');
  eq(count(html, /style="opacity/g), 0, 'standings: and nothing dimmed without a dim map');
  eq(rowsOf(standingsRowsHtml(real, {}))[0].cells[COL.oppProj].text, '—',
    'standings: without an oppProj map that column is a dash');

  const whole = standingsTableHtml(real, { id: 'standCur', highlightId: 10, oppProj });
  ok(/^<table class="standings-table" id="standCur"><thead>/.test(whole), 'standings: the whole table carries its class and id');
  const heads = rowsOf(whole.slice(0, whole.indexOf('<tbody>')));
  eq(heads[1].cells.map((c) => c.text).join('|'),
    'Team|W–L|Avg|Proj|Total|Opp Avg|F−A|Spread|Opp proj|Luck/wk|PTW|Close luck|Luck score|Skill|S+L|LS|PS|AS',
    'standings: the headings are the Stats page’s');
  eq(count(whole, /<th[^>]* data-sort /g), 18, 'standings: every heading sorts');
  ok(whole.includes(html), 'standings: and its body is the same rows');
  ok(!/data-view=/.test(whole), 'standings: the current table is not marked as a difference');
}

// (b) against itself
{
  const html = standingsRowsHtml(real, { diffFrom: real, oppProj, diffOppProj: oppProj });
  const rows = rowsOf(html);
  const numeric = rows.flatMap((r) => r.cells.slice(1));
  eq(numeric.length, 170, 'standings diff: 17 numeric cells for each of ten teams');
  eq(numeric.filter((c) => c.cls.includes('d-zero')).length, 170, 'standings diff against itself: every cell is d-zero');
  eq(count(html, /d-up|d-down/g), 0, 'standings diff against itself: nothing up, nothing down');
  ok(numeric.every((c) => Number(c.v) === 0), 'standings diff against itself: every data-v is 0');
  eq(rows[0].cells[COL.record].text, '0', 'standings diff against itself: the record reads 0');
  eq(rows[0].cells[COL.avg].text, '0.0', 'standings diff against itself: points read 0.0');
  eq(rows[0].cells[COL.as].text, '0', 'standings diff against itself: ranks read 0');
  eq(count(html, /heat-|class="pm"|class="rank"/g), 0, 'standings diff: no heat colours, no ±, no rank chips');
}

// (c) against a changed season. In the hypothetical T1 scores 141 in week 2
// instead of 105, and so beats T3 (115).
//
//   T1  record 0–4 -> 1–3            +1 W
//       total 420 -> 456             +36.0
//       avg 105.0 -> 114.0           +9.0
//       AS 10th -> 8th               +2   (T3 and T1 have one win; T3 460 > T1 456)
//   T3  record 2–2 -> 1–3            −1 W
//       opponents 120,105,110,120 = 113.75 -> 113.8
//                 120,141,110,120 = 122.75 -> 122.8      Opp Avg +9.0, and that is BAD
//       AS 6th -> 7th                −1
//   T2  AS 7th -> 6th                +1   (T3 fell behind it)
//   T9  AS 8th -> 9th, T5 9th -> 10th   −1 each (T1 passed them)
//   T10 nothing changed
{
  const hyp = computeLeagueStats(league({ 2: { 1: 141 } }));
  const html = standingsRowsHtml(hyp, { diffFrom: real, oppProj, diffOppProj: oppProj });
  const rows = rowsOf(html);
  const cell = (team, col) => rowNamed(rows, team).cells[col];
  const is = (team, col, text, cls, what) => {
    const c = cell(team, col);
    eq(c.text, text, `standings diff: ${what}`);
    ok(c.cls.includes(cls), `standings diff: ${what} is ${cls}`, JSON.stringify(c.cls));
  };
  is('T1', COL.record, '+1 W', 'd-up', 'T1 gains a win');
  eq(cell('T1', COL.record).v, '1', 'standings diff: and sorts as +1');
  is('T1', COL.total, '+36.0', 'd-up', 'T1 total +36.0');
  is('T1', COL.avg, '+9.0', 'd-up', 'T1 average +9.0');
  is('T1', COL.proj, '0.0', 'd-zero', 'T1 projection unchanged');
  is('T1', COL.as, '+2', 'd-up', 'T1 climbs two places');
  is('T3', COL.record, '−1 W', 'd-down', 'T3 loses a win');
  is('T3', COL.oppAvg, '+9.0', 'd-down', 'T3’s opponents averaged 9.0 more, which is red');
  is('T3', COL.total, '0.0', 'd-zero', 'T3’s own total unchanged');
  is('T3', COL.as, '−1', 'd-down', 'T3 drops a place');
  is('T2', COL.as, '+1', 'd-up', 'T2 gains the place T3 lost');
  is('T9', COL.as, '−1', 'd-down', 'T9 is passed by T1');
  is('T5', COL.as, '−1', 'd-down', 'T5 is passed by T1');
  is('T10', COL.record, '0', 'd-zero', 'T10’s record unchanged');
  is('T10', COL.total, '0.0', 'd-zero', 'T10’s total unchanged');
  is('T10', COL.as, '0', 'd-zero', 'T10 still first');
  // Spread has no good end: T1's rose, and the cell is neither green nor red.
  const spread = cell('T1', COL.spread);
  ok(Number(spread.v) > 0, 'standings diff: T1’s spread rose', spread.v);
  ok(!spread.cls.includes('d-up') && !spread.cls.includes('d-down'),
    'standings diff: and a spread is not coloured good or bad', JSON.stringify(spread.cls));
  ok(/ data-view="diff"/.test(standingsTableHtml(hyp, { diffFrom: real })),
    'standings: the whole table says when it is a difference');
  // The other way round is the mirror image.
  const back = rowsOf(standingsRowsHtml(real, { diffFrom: hyp }));
  eq(rowNamed(back, 'T1').cells[COL.total].text, '−36.0', 'standings diff: turned round, T1 is −36.0');
  ok(rowNamed(back, 'T1').cells[COL.total].cls.includes('d-down'), 'standings diff: and red');
}

// (d) dim
{
  const html = standingsRowsHtml(real, { oppProj, dim: new Map([[1, 0.5], [3, 1]]) });
  const rows = rowsOf(html);
  const t1 = rowNamed(rows, 'T1');
  eq(t1.cells.slice(1).filter((c) => c.style === 'opacity:0.675').length, 17,
    'standings dim: T1 at 0.5 noise has all 17 numeric cells at opacity 0.675');
  eq(t1.cells[0].style, null, 'standings dim: the name is never dimmed');
  eq(rowNamed(rows, 'T3').cells.slice(1).filter((c) => c.style === 'opacity:0.35').length, 17,
    'standings dim: T3 at full noise is at 0.35');
  eq(count(html, /style="opacity/g), 34, 'standings dim: and no other team is touched');
  const plain = standingsRowsHtml(real, { oppProj });
  eq(html.replace(/ style="opacity:[\d.]+"/g, ''), plain, 'standings dim: dimming changes nothing but the opacity');
  eq(count(standingsRowsHtml(real, { diffFrom: real, dim: { 1: 0.5 } }), /style="opacity:0\.675"/g), 17,
    'standings dim: it applies to the difference view too, from a plain object');
}
ok(standingsScales(real).avg && standingsScales(real).opp.invert !== standingsScales(real).avg.invert,
  'standings: the opponent scale is turned over');

// (e) explain: the Stats page asks for the hook that opens a cell's parts; a
// caller that does not ask (Decisions) gets the rows it always got.
{
  const plain = standingsRowsHtml(real, { highlightId: 10, oppProj });
  eq(count(plain, /data-explain|data-team|tabindex/g), 0, 'standings explain: off unless asked for, so Decisions is unchanged');
  eq(count(standingsTableHtml(real, { highlightId: 10, oppProj }), /data-explain/g), 0,
    'standings explain: and the whole-table form never carries it');
  eq(count(standingsRowsHtml(real, { diffFrom: real, oppProj, diffOppProj: oppProj, explain: true }), /data-explain/g), 0,
    'standings explain: a difference is not a figure with parts');
  const html = standingsRowsHtml(real, { highlightId: 10, oppProj, explain: true });
  eq(html.replace(/ data-explain="[a-zA-Z]+" data-team="\d+" tabindex="0"/g, ''), plain,
    'standings explain: asking for it adds three attributes and changes nothing else');
  const rows = rowsOf(html);
  const marked = (r) => r.cells.map((c, i) => (/data-explain="/.test(c.attrs) ? i : -1)).filter((i) => i >= 0);
  ok(rows.every((r) => marked(r).join() === [COL.ptw, COL.close, COL.luck, COL.skill, COL.sl].join()),
    'standings explain: PTW, Close luck, Luck score, Skill and S+L, on every row', JSON.stringify(marked(rows[0])));
  ok(rows.every((r) => r.cells.every((c) => !(/data-explain="/.test(c.attrs) && /title="/.test(c.attrs)))),
    'standings explain: a cell with parts carries no title, one preview a cell');
  eq(EXPLAINED.length, 5, 'standings explain: five figures are accounted for');

  // The rows add up to what the cell prints, in whole tenths.
  const tenths = (v) => Math.round(v * 10);
  let cellsChecked = 0;
  for (const t of real.teams) {
    for (const key of EXPLAINED) {
      const ex = standingsExplain(real, t, key);
      const parts = ex.rows.filter((r) => r.label !== 'Rounding');
      const fix = ex.rows.filter((r) => r.label === 'Rounding');
      const sum = parts.reduce((a, r) => a + tenths(r.value), 0);
      const total = (ex.mean ? Math.round(sum / parts.length) : sum) + fix.reduce((a, r) => a + tenths(r.value), 0);
      if (total === tenths(t[key]) && tenths(ex.foot.value) === tenths(t[key]) && fix.length <= 1) cellsChecked++;
      else ok(false, `standings explain: T${t.id} ${key} adds up`, JSON.stringify(ex));
    }
  }
  eq(cellsChecked, 50, 'standings explain: all fifty cells add up to the tenth');
  // By hand, T10: four wins, scoring 150 against opponents averaging 117.5,
  // everyone projected 100, so Luck/wk is +50.0 and PTW is 117.5 − 50.0.
  const t10 = real.teams.find((t) => t.id === 10);
  const parts = (key) => JSON.stringify(standingsExplain(real, t10, key).rows.map((r) => [r.label, r.value]));
  eq(parts('pointsToWin'), JSON.stringify([['Opp Avg', t10.oppAvgActual], ['Luck/wk', -t10.avgLuck]]),
    'standings explain: PTW is Opp Avg less Luck/wk');
  eq(parts('skillPlusLuck'), JSON.stringify([['Skill', t10.skill], ['Luck score', t10.luckScore]]),
    'standings explain: S+L is the two cells beside it');
  eq(standingsExplain(real, t10, 'scoreDiffLuck').rows.map((r) => r.label).slice(0, 4).join(), 'Wk 1,Wk 2,Wk 3,Wk 4',
    'standings explain: Close luck is one row a game');
  // No projection read for any game: the record and the points are printed,
  // every figure formed from a projection is a dash, and nothing opens.
  const base = league();
  const bare = computeLeagueStats({ ...base, games: base.games.map((g) => ({ ...g, homeProjected: 0, awayProjected: 0 })) });
  const bareHtml = standingsRowsHtml(bare, { oppProj, explain: true });
  const bareT10 = rowNamed(rowsOf(bareHtml), 'T10');
  eq([COL.record, COL.total, COL.close].map((c) => bareT10.cells[c].text.replace(/±.*/, '')).join('|'),
    `4–0|600.0|${t10.scoreDiffLuck > 0 ? '+' : ''}${t10.scoreDiffLuck.toFixed(1)}`,
    'standings, no projections: record, points and Close luck still count every game');
  eq([COL.proj, COL.luckWk, COL.ptw, COL.luck, COL.skill, COL.sl, COL.ls, COL.ps].map((c) => bareT10.cells[c].text).join(''),
    '————————', 'standings, no projections: every figure formed from one is a dash');
  eq(count(bareHtml, /NaN|undefined|null/g), 0, 'standings, no projections: no NaN');
  eq(count(bareHtml, /data-explain="scoreDiffLuck"/g) + '/' + count(bareHtml, /data-explain=/g), '10/10',
    'standings, no projections: only Close luck, which needs none, still opens');
  ok(bare.teams.every((t) => standingsExplain(bare, t, 'scoreDiffLuck') && !standingsExplain(bare, t, 'luckScore')),
    'standings, no projections: and it has its games to show');
  const unplayed = computeLeagueStats({ ...league(), games: [] });
  eq(standingsExplain(unplayed, unplayed.teams[0], 'luckScore'), null,
    'standings explain: nothing played, nothing to open');
}

// ============================================================ 2. the summary chart
//
// Ten managers. Only the two the hypothetical touches matter by hand:
//
//   Tim       record 3-1 -> 4-0   luck +12.3 -> +15.0   title 31% -> 35.4%   last 0.4% -> 0.1%
//             difference:  +1 W        +2.7                  +4.4%                −0.3% (GOOD)
//   Mitchell  record 3-1 -> 2-2   luck  +5.0 ->  +1.5   title 20% -> 18%     last 5% -> 8%
//             difference:  −1 W        −3.5                  −2.0%                +3.0% (BAD)

const person = (id, name, w, l, luck, title, last) => ({
  id, name, teamName: `${name} FC`,
  record: { w, l, t: 0 },
  rec: capture.recordNow({ w, l, t: 0 }, null, { sep: '-' }),
  luck, luckMargin: 14, title, last,
});
const OTHERS = [
  [3, 'Ava', 2, 2, 3.1, 0.12, 0.06], [4, 'Ben', 2, 2, -1.4, 0.09, 0.09], [5, 'Cal', 2, 2, 0.0, 0.08, 0.1],
  [6, 'Dee', 2, 2, -6.2, 0.07, 0.12], [7, 'Eli', 2, 2, 4.4, 0.06, 0.11], [8, 'Fay', 1, 3, -9.9, 0.04, 0.15],
  [9, 'Gus', 1, 3, -3.3, 0.02, 0.16], [10, 'Hal', 0, 4, -4.0, 0.01, 0.166],
].map((a) => person(...a));
const chartNow = [person(1, 'Tim', 3, 1, 12.3, 0.31, 0.004), person(2, 'Mitchell', 3, 1, 5.0, 0.2, 0.05), ...OTHERS];
const chartHyp = [person(1, 'Tim', 4, 0, 15.0, 0.354, 0.001), person(2, 'Mitchell', 2, 2, 1.5, 0.18, 0.08), ...OTHERS];
const S = { record: 1, luck: 2, title: 3, last: 4 };

// (a) current
{
  const html = summaryRowsHtml(chartNow);
  const rows = rowsOf(html);
  eq(rows.length, 10, 'summary: a row a manager');
  ok(rows.every((r) => r.cells.length === 5), 'summary: five cells a row');
  const tim = rowNamed(rows, 'Tim');
  eq(tim.cells[S.record].text, '3-1', 'summary: Tim is 3-1');
  eq(tim.cells[S.luck].text.replace(/[▲▼]/g, '').replace(/\s+/g, ' ').trim(), '+12.3 ±14', 'summary: his luck with its ±');
  eq(tim.cells[S.title].text.replace(/[▲▼\s]/g, ''), '31%', 'summary: his title chance');
  eq(tim.cells[S.last].text.replace(/[▲▼\s]/g, ''), '<1%', 'summary: a chance under half a percent reads <1%');
  ok(/title="ESPN team name: Tim FC"/.test(tim.cells[0].attrs), 'summary: the ESPN team name is on the name cell');
  ok(tim.cells.slice(1).every((c) => c.cls.includes('num')), 'summary: every figure is a num cell');
  ok(tim.cells[S.title].cls.some((c) => /^heat-/.test(c)), 'summary: the favourite is on the red/green scale');
  eq(count(html, /d-up|d-down|d-zero|style="opacity/g), 0, 'summary: no difference classes and no dimming in the current view');
  ok(/…/.test(summaryRowsHtml([person(1, 'Tim', 3, 1, 1, null, null)], { waiting: true })),
    'summary: a simulation still running prints … for the chances');
  ok(!/\+1\.0/.test(summaryRowsHtml([person(1, 'Tim', 0, 0, 1, null, null)], { enough: false })),
    'summary: before a week is decided the luck is a dash, not a number');
  const whole = summaryTableHtml(chartNow, { id: 'chartCur' });
  ok(/^<table class="summary-table" id="chartCur"><thead>/.test(whole), 'summary: the whole table carries its class and id');
  eq(rowsOf(whole)[0].cells.map((c) => c.text).join('|'), 'Member|Record|LUCK|Title %|Loser %', 'summary: the headings are the Summary page’s');
  ok(whole.includes(html), 'summary: and its body is the same rows');
}

// (b) against itself
{
  const html = summaryRowsHtml(chartNow, { diffFrom: chartNow });
  const numeric = rowsOf(html).flatMap((r) => r.cells.slice(1));
  eq(numeric.length, 40, 'summary diff: four numeric cells for each of ten');
  eq(numeric.filter((c) => c.cls.includes('d-zero')).length, 40, 'summary diff against itself: every cell is d-zero');
  eq(count(html, /d-up|d-down/g), 0, 'summary diff against itself: nothing up, nothing down');
  ok(numeric.every((c) => Number(c.v) === 0), 'summary diff against itself: every data-v is 0');
  const tim = rowNamed(rowsOf(html), 'Tim');
  eq(tim.cells.slice(1).map((c) => c.text).join('|'), '0|0.0|0.0%|0.0%', 'summary diff against itself: the cells read zero');
  eq(count(html, /heat-|class="muted pm"/g), 0, 'summary diff: no heat colours and no ±');
}

// (c) against the hypothetical
{
  const html = summaryRowsHtml(chartHyp, { diffFrom: chartNow });
  const rows = rowsOf(html);
  const is = (who, col, text, cls, what) => {
    const c = rowNamed(rows, who).cells[col];
    eq(c.text, text, `summary diff: ${what}`);
    ok(c.cls.includes(cls) && c.cls.includes('num'), `summary diff: ${what} is ${cls}`, JSON.stringify(c.cls));
  };
  is('Tim', S.record, '+1 W', 'd-up', 'Tim gains a win');
  is('Tim', S.luck, '+2.7', 'd-up', 'Tim’s luck +2.7');
  is('Tim', S.title, '+4.4%', 'd-up', 'Tim’s title chance +4.4 points');
  is('Tim', S.last, '−0.3%', 'd-up', 'Tim’s chance of last falls 0.3, which is GOOD');
  is('Mitchell', S.record, '−1 W', 'd-down', 'Mitchell loses a win');
  is('Mitchell', S.luck, '−3.5', 'd-down', 'Mitchell’s luck −3.5');
  is('Mitchell', S.title, '−2.0%', 'd-down', 'Mitchell’s title chance −2.0 points');
  is('Mitchell', S.last, '+3.0%', 'd-down', 'Mitchell’s chance of last rises 3.0, which is BAD');
  is('Ava', S.record, '0', 'd-zero', 'Ava’s record unchanged');
  is('Ava', S.title, '0.0%', 'd-zero', 'Ava’s title chance unchanged');
  eq(rowNamed(rows, 'Tim').cells[S.title].v, '4.4', 'summary diff: and it sorts on the difference');
  const lost = rowsOf(summaryRowsHtml(chartHyp, { diffFrom: chartNow.slice(1) }));
  eq(rowNamed(lost, 'Tim').cells[S.title].text, '—', 'summary diff: a manager the other chart lacks is a dash');
  ok(/ data-view="diff"/.test(summaryTableHtml(chartHyp, { diffFrom: chartNow })),
    'summary: the whole table says when it is a difference');
}

// (d) dim
{
  const html = summaryRowsHtml(chartNow, { dim: { 2: 0.4 } });
  const mitch = rowNamed(rowsOf(html), 'Mitchell');
  eq(mitch.cells.slice(1).filter((c) => c.style === 'opacity:0.74').length, 4,
    'summary dim: Mitchell at 0.4 noise has his four figures at opacity 0.74');
  eq(mitch.cells[0].style, null, 'summary dim: the name is never dimmed');
  eq(count(html, /style="opacity/g), 4, 'summary dim: and nobody else is touched');
  eq(html.replace(/ style="opacity:[\d.]+"/g, ''), summaryRowsHtml(chartNow), 'summary dim: dimming changes nothing but the opacity');
}

// ================================================= 3. season by week, actual points
//
// One squad, four weeks, the standard nine-slot lineup. Every week the same
// nine men start; `pts[w]` is what each scored. The week's total is their sum.
//
//               proj   wk1   wk2   wk3   wk4
//   Allen   QB   22    24.3  18.0  30.1  21.0
//   Robinson RB  18    20.1  20.1  12.0  16.5      (RB1: the higher projection)
//   Cook    RB   12     8.4   8.4  15.5   9.0      (RB2)
//   Chase   WR   19    22.0  11.2  25.3  17.7      (WR1)
//   Wilson  WR   13    10.0  14.4   6.1  12.2      (WR2)
//   Kelce   TE   10     7.5   9.9   4.0  11.0
//   Hampton FLEX 11    12.6   5.5   9.9  13.3      (an RB, in the FLEX slot)
//   Bills D/ST    7     9.0   4.0  11.0   6.0
//   Butker  K     8    10.0   8.0   7.0   9.0
//                     -----  ----- ----- -----
//   total             123.9  99.5 120.9 115.7

const SLOTS = [0, 2, 2, 4, 4, 6, 23, 16, 17];
const MEN = [
  [1, 'Josh Allen', 'QB', 0, 22, [24.3, 18.0, 30.1, 21.0]],
  [2, 'Bijan Robinson', 'RB', 2, 18, [20.1, 20.1, 12.0, 16.5]],
  [3, 'James Cook III', 'RB', 2, 12, [8.4, 8.4, 15.5, 9.0]],
  [4, 'Ja\'Marr Chase', 'WR', 4, 19, [22.0, 11.2, 25.3, 17.7]],
  [5, 'Garrett Wilson', 'WR', 4, 13, [10.0, 14.4, 6.1, 12.2]],
  [6, 'Travis Kelce', 'TE', 6, 10, [7.5, 9.9, 4.0, 11.0]],
  [7, 'Omarion Hampton', 'RB', 23, 11, [12.6, 5.5, 9.9, 13.3]],
  [8, 'Bills D/ST', 'DST', 16, 7, [9.0, 4.0, 11.0, 6.0]],
  [9, 'Harrison Butker', 'K', 17, 8, [10.0, 8.0, 7.0, 9.0]],
];
const TOTALS = [123.9, 99.5, 120.9, 115.7];
const starter = ([playerId, name, position, slotId, projected, pts], i) => ({
  playerId, name, position, slot: position, slotId, actual: pts[i], projected, isNew: false,
});
const seasonNow = [1, 2, 3, 4].map((week, i) => ({
  week, total: TOTALS[i], starters: MEN.map((m) => starter(m, i)),
}));
const rows9 = slotRows(SLOTS);
eq(rows9.map((r) => r.key).join(' '), 'QB RB1 RB2 WR1 WR2 TE FLEX D/ST K', 'season: the fixture is the standard nine-slot lineup');
eq(Math.round(MEN.reduce((s, m) => s + m[5][1], 0) * 10) / 10, 99.5, 'season: week 2’s total is the sum of its nine starters');

/** Slot rows of a rendered box, keyed by slot, each an array of week cells. */
function seasonOf(html) {
  const all = rowsOf(html);
  const head = all[0].cells.map((c) => c.text);
  const bySlot = new Map(all.slice(1).map((r) => [r.cells[0].text, r.cells.slice(1)]));
  return { head, bySlot, cells: all.slice(1).flatMap((r) => r.cells.slice(1)) };
}

// (a) current
{
  const html = actualSeasonTableHtml({ weeks: seasonNow, rows: rows9 }, { box: 'current' });
  ok(/^<table class="sbw-table sbw-actual" data-box="current"><thead>/.test(html), 'season: it is the Trade page’s table.sbw-table', html.slice(0, 80));
  ok(/<tbody class="split"><tr class="split-row"><td class="name split-label">Total<\/td>/.test(html), 'season: with the split band as its total row');
  eq(count(html, /<span class="slot-tag">/g), 9, 'season: nine slot rows, tagged as the Trade page tags them');
  const s = seasonOf(html);
  eq(s.head.join('|'), 'Slot|1|2|3|4', 'season: a column a week');
  eq(s.cells.length, 40, 'season: 9 slots × 4 weeks, plus 4 totals');
  eq(s.bySlot.get('QB')[0].text, 'J. Allen24.3', 'season: QB week 1 is J. Allen, 24.3');
  ok(/<span class="sbw-name">J\. Allen<\/span><span class="sbw-pts">24\.3<\/span>/.test(s.bySlot.get('QB')[0].html), 'season: name over points');
  ok(/title="Josh Allen"/.test(s.bySlot.get('QB')[0].attrs), 'season: the full name is the title');
  eq(s.bySlot.get('RB1')[1].text, 'B. Robinson20.1', 'season: RB1 is the better-projected back');
  eq(s.bySlot.get('RB2')[1].text, 'J. Cook III8.4', 'season: RB2 the other');
  eq(s.bySlot.get('WR1')[2].text, 'J. Chase25.3', 'season: WR1 week 3');
  eq(s.bySlot.get('FLEX')[3].text, 'O. Hampton13.3', 'season: the flex is who sits in the flex slot');
  eq(s.bySlot.get('D/ST')[0].text, 'Bills D/ST9.0', 'season: a defence keeps its whole name');
  eq(s.bySlot.get('Total').map((c) => c.text).join('|'), '123.9|99.5|120.9|115.7', 'season: the total row is each week’s total');
  eq(s.bySlot.get('K')[2].v, '7', 'season: a cell sorts on its points');
  eq(count(html, /d-up|d-down|d-zero|sbw-new|style="opacity/g), 0, 'season: no difference classes and no dimming in the current view');
  eq(actualSeasonTableHtml({ weeks: seasonNow, slots: SLOTS }, { box: 'current' }), html, 'season: slots may be passed instead of rows');
  eq(shortName({ name: 'Amon-Ra St. Brown', position: 'WR' }), 'A. St. Brown', 'season: a short name keeps everything after the first name');
  // An empty slot is an answer, not a missing cell.
  const short = [{ week: 1, total: 99.6, starters: MEN.filter((m) => m[0] !== 1).map((m) => starter(m, 0)) }];
  eq(seasonOf(actualSeasonTableHtml({ weeks: short, rows: rows9 })).bySlot.get('QB')[0].text, '—', 'season: nobody at QB is a dash');
}

// (b) against itself
{
  const html = actualSeasonTableHtml({ weeks: seasonNow, rows: rows9 }, { diffFrom: seasonNow });
  const s = seasonOf(html);
  eq(s.cells.length, 40, 'season diff: the same forty cells');
  eq(s.cells.filter((c) => c.cls.includes('d-zero')).length, 40, 'season diff against itself: every cell is d-zero');
  eq(count(html, /d-up|d-down|sbw-new/g), 0, 'season diff against itself: nothing up, down or swapped');
  ok(s.cells.every((c) => Number(c.v) === 0), 'season diff against itself: every data-v is 0');
  eq(s.bySlot.get('QB')[0].text, 'J. Allen0.0', 'season diff against itself: the man, and 0.0');
  eq(s.bySlot.get('Total').map((c) => c.text).join('|'), '0.0|0.0|0.0|0.0', 'season diff against itself: totals 0.0');
  ok(/ data-view="diff"/.test(html), 'season: the table says when it is a difference');
}

// (c) against a hypothetical. Two changes:
//
//   wk2  RB2 is Kyren Williams (projected 11.5, scored 19.9) instead of Cook (8.4):
//          RB2  19.9 − 8.4 = +11.5      total 99.5 -> 111.0   = +11.5
//        (11.5 projected is still under Robinson's 18, so the rows do not swap)
//   wk3  K is Jake Bates (scored 3.0) instead of Butker (7.0):
//          K    3.0 − 7.0 = −4.0        total 120.9 -> 116.9  = −4.0
{
  const swap = (week, outId, man) => seasonNow[week - 1].starters.map((p) => (p.playerId === outId ? man : p));
  const seasonHyp = seasonNow.map((w) => ({ ...w }));
  seasonHyp[1] = {
    week: 2, total: 111.0,
    starters: swap(2, 3, { playerId: 30, name: 'Kyren Williams', position: 'RB', slot: 'RB', slotId: 2, actual: 19.9, projected: 11.5, isNew: true }),
  };
  seasonHyp[2] = {
    week: 3, total: 116.9,
    starters: swap(3, 9, { playerId: 90, name: 'Jake Bates', position: 'K', slot: 'K', slotId: 17, actual: 3.0, projected: 7.5, isNew: true }),
  };
  const hypHtml = actualSeasonTableHtml({ weeks: seasonHyp, rows: rows9 }, { box: 'hypothetical' });
  eq(seasonOf(hypHtml).bySlot.get('RB2')[1].text, 'K. Williams19.9', 'season: the hypothetical box shows the new man and his points');
  eq(seasonOf(hypHtml).bySlot.get('Total')[1].text, '111.0', 'season: and its own total');

  const html = actualSeasonTableHtml({ weeks: seasonHyp, rows: rows9 }, { diffFrom: seasonNow, box: 'hypothetical' });
  const s = seasonOf(html);
  const rb2 = s.bySlot.get('RB2')[1];
  eq(rb2.text, 'K. Williams+11.5', 'season diff: RB2 week 2 is the NEW man and +11.5');
  ok(rb2.cls.includes('d-up') && rb2.cls.includes('sbw-new'), 'season diff: green, and marked as a changed player', JSON.stringify(rb2.cls));
  eq(rb2.v, '11.5', 'season diff: sorting on the difference');
  ok(/title="Kyren Williams instead of James Cook III"/.test(rb2.attrs), 'season diff: the title says who replaced whom', rb2.attrs);
  const k = s.bySlot.get('K')[2];
  eq(k.text, 'J. Bates−4.0', 'season diff: K week 3 is the new kicker and −4.0');
  ok(k.cls.includes('d-down') && k.cls.includes('sbw-new'), 'season diff: red, and marked as a changed player', JSON.stringify(k.cls));
  eq(s.bySlot.get('Total').map((c) => c.text).join('|'), '0.0|+11.5|−4.0|0.0', 'season diff: the totals move by the same amounts');
  eq(s.bySlot.get('Total').map((c) => c.cls.filter((x) => /^d-/.test(x)).join()).join('|'), 'd-zero|d-up|d-down|d-zero', 'season diff: and are coloured the same way');
  const rb1 = s.bySlot.get('RB1')[1];
  eq(rb1.text, 'B. Robinson0.0', 'season diff: RB1 that week did not change');
  ok(rb1.cls.includes('d-zero') && !rb1.cls.includes('sbw-new'), 'season diff: so it is dim and not marked', JSON.stringify(rb1.cls));
  eq(s.cells.filter((c) => c.cls.includes('d-zero')).length, 36, 'season diff: the other 36 cells are zero');
  eq(count(html, /sbw-new/g), 2, 'season diff: exactly two cells changed hands');
  // A week the other side does not have has nothing to subtract.
  const gap = seasonOf(actualSeasonTableHtml({ weeks: seasonHyp, rows: rows9 }, { diffFrom: seasonNow.slice(0, 3) }));
  eq(gap.bySlot.get('QB')[3].text, '—', 'season diff: a week missing from the other side is a dash');
  eq(gap.bySlot.get('Total')[3].text, '—', 'season diff: …in the total row too');

  // (d) dim, by week
  const dimmed = actualSeasonTableHtml({ weeks: seasonHyp, rows: rows9 }, { diffFrom: seasonNow, box: 'hypothetical', dim: { 2: 0.4, 3: 1 } });
  const d = seasonOf(dimmed);
  const col = (i) => [...d.bySlot.values()].map((cells) => cells[i].style);
  eq(col(0).filter(Boolean).length, 0, 'season dim: week 1 has no noise and no style');
  eq(col(1).filter((x) => x === 'opacity:0.74').length, 10, 'season dim: week 2 at 0.4 noise — all ten cells at 0.74');
  eq(col(2).filter((x) => x === 'opacity:0.35').length, 10, 'season dim: week 3 at full noise — all ten at 0.35');
  eq(col(3).filter(Boolean).length, 0, 'season dim: week 4 untouched');
  eq(dimmed.replace(/ style="opacity:[\d.]+"/g, ''), html, 'season dim: dimming changes nothing but the opacity');
  const byMap = actualSeasonTableHtml({ weeks: seasonNow, rows: rows9 }, { dim: new Map([[4, 0.2]]) });
  eq(count(byMap, /style="opacity:0\.87"/g), 10, 'season dim: a Map works too, and on the current view (0.2 -> 0.87)');
}

// The engine's shape, read straight off a `mirror(...)` team.
{
  const teamMirror = {
    byWeek: {
      2: { total: 111.0, realTotal: 99.5, starters: [{ playerId: 30 }], realStarters: [{ playerId: 3 }] },
      1: { total: 123.9, realTotal: 123.9, starters: [{ playerId: 1 }], realStarters: [{ playerId: 1 }] },
    },
  };
  const m = weeksFromMirror(teamMirror, 'mirror');
  const r = weeksFromMirror(teamMirror, 'real');
  eq(m.map((w) => w.week).join(), '1,2', 'weeksFromMirror: weeks ascending');
  eq(m[1].total, 111.0, 'weeksFromMirror: the mirror half is total / starters');
  eq(m[1].starters[0].playerId, 30, 'weeksFromMirror: …its starters');
  eq(r[1].total, 99.5, 'weeksFromMirror: the real half is realTotal / realStarters');
  eq(r[1].starters[0].playerId, 3, 'weeksFromMirror: …its starters');
}

// THE WEEK IN PLAY (Tim, 2026-10-05: "just show what you have right now ... put
// a little 'live' sign by the week number"). Week 4 with Allen still playing:
// he has no score, is `known: false`, and counts for his projection, 22. The
// total handed in is the other eight's, 115.7 − 21.0 = 94.7.
{
  const allen = { ...starter(MEN[0], 3), actual: null, done: false, known: false, value: 22 };
  const rest = MEN.slice(1).map((m) => ({ ...starter(m, 3), done: true, known: true, value: m[5][3] }));
  const liveNow = [...seasonNow.slice(0, 3), { week: 4, total: 94.7, starters: [allen, ...rest] }];
  const html = actualSeasonTableHtml({ weeks: liveNow, rows: rows9 }, { box: 'current', live: [4] });
  const s = seasonOf(html);
  const qb = s.bySlot.get('QB')[3];
  eq(qb.text, 'J. Allen22.0', 'season live: a man still playing shows the projection he counts for');
  ok(qb.cls.includes('sbw-proj') && qb.v === '22', 'season live: marked as not a real score, and sorting on it', JSON.stringify([qb.cls, qb.v]));
  ok(/title="Josh Allen \(projected, still to play\)"/.test(qb.attrs), 'season live: the title says so', qb.attrs);
  const rb1 = s.bySlot.get('RB1')[3];
  ok(rb1.text === 'B. Robinson16.5' && !rb1.cls.includes('sbw-proj'), 'season live: a finished man in the same week is a plain score', JSON.stringify(rb1));
  eq(count(html, /sbw-proj/g), 1, 'season live: only the one cell is marked');
  eq(s.head.join('|'), 'Slot|1|2|3|4live', 'season live: the week’s column head carries the live tag');
  ok(/<th class="wk">4<span class="badge live wk-live"[^>]*>live<\/span><\/th>/.test(html), 'season live: as the site’s LIVE badge, small', html.slice(0, 400));
  eq(s.bySlot.get('Total')[3].text, '94.7', 'season live: the total is the one handed in');
  eq(actualSeasonTableHtml({ weeks: seasonNow, rows: rows9 }, { box: 'current', live: [] }),
    actualSeasonTableHtml({ weeks: seasonNow, rows: rows9 }, { box: 'current' }), 'season live: nothing live, nothing added');
  ok(!/wk-live|sbw-proj/.test(actualSeasonTableHtml({ weeks: liveNow.slice(0, 3), rows: rows9 }, { live: new Set([4]) })), 'season live: a Set works, and a week not shown tags nothing');

  // Difference: a finished QB who scored 29.0 instead of Allen, 29 − 22 = +7.0.
  const spare = { playerId: 99, name: 'Sam Spare', position: 'QB', slot: 'QB', slotId: 0, actual: 29.0, projected: 12, isNew: true, done: true, known: true, value: 29.0 };
  const liveHyp = [...seasonNow.slice(0, 3), { week: 4, total: 101.7, starters: [spare, ...rest] }];
  const d = seasonOf(actualSeasonTableHtml({ weeks: liveHyp, rows: rows9 }, { diffFrom: liveNow, live: [4] }));
  eq([d.bySlot.get('QB')[3].text, d.bySlot.get('Total')[3].text].join('|'), 'S. Spare+7.0|+7.0', 'season live diff: the swap is his score less the other’s projection');
  // ...and the other way round the cell is still marked: the number is not a score.
  const back = seasonOf(actualSeasonTableHtml({ weeks: liveNow, rows: rows9 }, { diffFrom: liveHyp, live: [4] }));
  ok(back.bySlot.get('QB')[3].text === 'J. Allen−7.0' && back.bySlot.get('QB')[3].cls.includes('sbw-proj'), 'season live diff: a projected man in is marked there too', JSON.stringify(back.bySlot.get('QB')[3]));
  eq(d.bySlot.get('RB1')[3].text, 'B. Robinson0.0', 'season live diff: an unchanged finished man is zero');
}

if (fail) console.log(`${pass} passed, ${fail} failed`);
else console.log(`All ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
