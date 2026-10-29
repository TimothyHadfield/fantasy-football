// Player analysis (Players page): one man's future proj as it stood in each
// saved week, and each week's projection as it changed — js/player-history.js.
//
//   node test-player-history.mjs
//
// The copies here are the stored shape (js/proj-history.js) at a real size:
// ten squads of sixteen and 150 free agents under `wire`, with `weeks` from the
// copy's week through 17. Every expected number is worked by hand below.

import { moduleUrl } from './repo.mjs';

const ph = await import(moduleUrl('js/player-history.js'));

let pass = 0;
let fail = 0;
function check(ok, msg) {
  if (ok) pass++;
  else { fail++; console.log(`FAIL: ${msg}`); }
}
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-9;

const REGULAR = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const STAR = 3916387;      // invented id; a free agent in week 1, rostered from week 3
const BYE = 9;
const FILL = 7.5;
const STAR_ROS = 136.5;    // ESPN's rest-of-season total in the week 1 copy: 13 games left (14 weeks less his bye)

// What the copy of week `asOf` said about the star for week w (hand-checkable):
//   week 1 copy: 10 a week, 0 in his bye
//   week 3 copy: 12 a week, 0 in his bye, ESPN no number for week 13
//   week 4 copy: 14 a week, 0 in his bye, 0 (ruled out) in week 6
const starProj = (asOf, w) => {
  if (w === BYE) return 0;
  if (asOf === 1) return 10;
  if (asOf === 3) return w === 13 ? null : 12;
  if (asOf === 4) return w === 6 ? 0 : 14;
  return 5;
};

function copyOf(asOf, { starOnWire = false, withStar = true, withWire = true } = {}) {
  const weeks = [];
  for (let w = asOf; w <= 17; w++) weeks.push(w);
  const row = (id, name, pos, proj) => [id, name, pos, 'BUF', 20, 'ACTIVE', weeks.map(proj)];
  // A free agent's row as ff-wire writes it: no slot, only the copy's first
  // week filled (the wire is one week a request), ESPN's rest-of-season total last.
  const wireRow = (id, name, pos, proj, ros) =>
    [id, name, pos, 'BUF', null, 'ACTIVE', weeks.map((w, i) => (i === 0 ? proj(w) : null)), ros];
  const teams = {};
  for (let t = 1; t <= 10; t++) {
    teams[t] = [];
    for (let i = 0; i < 16; i++) teams[t].push(row(t * 100 + i, `T${t} Player ${i}`, 'WR', () => 8));
  }
  const wire = [];
  for (let i = 0; i < 150; i++) wire.push(wireRow(50000 + i, `FA ${i}`, 'RB', () => 3, 40));
  if (withStar) {
    if (starOnWire) wire.push(wireRow(STAR, 'Star Back', 'RB', (w) => starProj(asOf, w), STAR_ROS));
    else teams[4].push(row(STAR, 'Star Back', 'RB', (w) => starProj(asOf, w)));
  }
  const rec = { v: 1, leagueId: '1241838', season: 2026, week: asOf, takenAt: '2026-09-10T00:00:00.000Z',
    weeks, cols: ['id', 'name', 'pos', 'team', 'slot', 'inj', 'proj'], teams };
  if (withWire) {
    rec.wire = wire;
    rec.wireCols = ['id', 'name', 'pos', 'team', 'slot', 'inj', 'proj', 'ros'];
  }
  return rec;
}

// ---------------------------------------------------------------- rowsOf / manIn
{
  const rec = copyOf(3);
  check(ph.rowsOf(rec).length === 10 * 16 + 1 + 150, 'rowsOf: every squad row and every wire row');
  check(ph.rowsOf(copyOf(3, { withWire: false })).length === 161, 'rowsOf: a copy without `wire` is its squads');
  const man = ph.manIn(rec, STAR);
  check(man && man.name === 'Star Back' && man.pos === 'RB', 'manIn: finds him on a squad');
  check(man.byWeek.get(3) === 12 && man.byWeek.get(BYE) === 0 && man.byWeek.get(13) === null, 'manIn: his weeks, 0 in the bye, null kept null');
  const fa = ph.manIn(copyOf(1, { starOnWire: true }), String(STAR));
  check(fa?.byWeek.get(1) === 10 && fa.byWeek.get(2) === null, 'manIn: finds him on the wire, id as a string, only the first week filled');
  check(fa.onWire === true && fa.ros === STAR_ROS, 'manIn: a wire row carries ESPN’s rest-of-season total (wireCols)');
  check(man.onWire === false && man.ros === null, 'manIn: a squad row has no ros');
  {
    // An older wire row without wireCols / ros: no total, read as a squad row would be.
    const rec = copyOf(1, { starOnWire: true });
    delete rec.wireCols;
    rec.wire = rec.wire.map((r) => r.slice(0, 7));
    const old = ph.manIn(rec, STAR);
    check(old && old.ros === null && old.byWeek.get(1) === 10, 'manIn: a wire row without ros still reads');
  }
  check(ph.manIn(copyOf(1, { starOnWire: true, withWire: false }), STAR) === null, 'manIn: a wire man in a copy without `wire` is absent');
  check(ph.manIn(null, STAR) === null && ph.manIn({}, STAR) === null, 'manIn: no copy, no man');
}

// ---------------------------------------------------------------- futureWeeks
check(JSON.stringify(ph.futureWeeks(12, REGULAR)) === '[12,13,14]', 'futureWeeks: that week and on, regular season only');
check(JSON.stringify(ph.futureWeeks(16, REGULAR, [16, 17])) === '[16,17]', 'futureWeeks: no regular week left -> the copy’s weeks from then on');
check(ph.futureWeeks(18, REGULAR, [16, 17]).length === 0, 'futureWeeks: nothing at all -> none');

// ---------------------------------------------------------------- pointAt
{
  // Week 4 copy over weeks 4..14: 14 x 9 weeks own, week 6 (0) -> 7.5, week 9 (bye) -> 7.5.
  const man = ph.manIn(copyOf(4), STAR);
  const pt = ph.pointAt({ asOf: 4, byWeek: man.byWeek, weeks: ph.futureWeeks(4, REGULAR), byeWeek: BYE, fill: FILL });
  check(near(pt.avg, (14 * 9 + 7.5 * 2) / 11), `pointAt: 0 and bye count as the waiver line (${pt.avg})`);
  check(pt.weeks.length === 11, 'pointAt: one row per week counted');
  const w6 = pt.weeks.find((r) => r.week === 6);
  const w9 = pt.weeks.find((r) => r.week === 9);
  check(w6.how === 'base' && w6.used === FILL && w6.proj === 0, 'pointAt: a 0 is "base"');
  check(w9.how === 'base' && w9.used === FILL, 'pointAt: his bye is "base"');
  check(pt.weeks.find((r) => r.week === 5).how === 'own', 'pointAt: a number is his own');

  // Week 3 copy: week 13 has no number and is skipped (not a zero).
  const m3 = ph.manIn(copyOf(3), STAR);
  const p3 = ph.pointAt({ asOf: 3, byWeek: m3.byWeek, weeks: ph.futureWeeks(3, REGULAR), byeWeek: BYE, fill: FILL });
  check(near(p3.avg, (12 * 10 + 7.5) / 11), `pointAt: a week with no number is left out (${p3.avg})`);
  check(p3.weeks.find((r) => r.week === 13).how === 'none', 'pointAt: no number is "none"');

  // No base known: the old rule, byes and zeros left out.
  const p0 = ph.pointAt({ asOf: 4, byWeek: man.byWeek, weeks: ph.futureWeeks(4, REGULAR), byeWeek: BYE, fill: null });
  check(near(p0.avg, 14), `pointAt: without a base a 0 and the bye leave the average (${p0.avg})`);
  check(p0.weeks.find((r) => r.week === 9).how === 'none', 'pointAt: without a base the bye is "none"');
}

// ---------------------------------------------------------------- history
{
  const copies = [copyOf(4), copyOf(1, { starOnWire: true }), copyOf(3), copyOf(5, { withStar: false })];
  // Live: week 6, 16 a week except his bye.
  const live = new Map();
  for (const w of REGULAR) live.set(w, w === BYE ? 0 : 16);
  const h = ph.history({ copies, playerId: STAR, regularWeeks: REGULAR, byeWeek: BYE, fill: FILL, now: { week: 6, byWeek: live } });
  check(JSON.stringify(h.points.map((p) => p.asOf)) === '[1,3,4,6]', `history: one point per copy holding him, then now (${h.points.map((p) => p.asOf)})`);
  check(h.firstCopy === 1 && h.copies === 3, 'history: the earliest copy, and how many hold him');
  check(near(h.points[0].avg, STAR_ROS / 13) && h.points[0].ros === STAR_ROS && h.points[0].games === 13,
    `history: a free agent's point is ESPN's rest-of-season total over his games left (${h.points[0].avg})`);
  check(h.points[0].weeks.every((r) => r.how === 'ros'), 'history: a ros point says so on every week');
  const l1 = h.lines[0];
  check(l1.pts.filter((p) => p.proj !== null).length === 1 && l1.pts[0].proj === 10, 'history: a free agent’s line is that one week');
  check(h.points[3].live === true && near(h.points[3].avg, (16 * 8 + 7.5) / 9), 'history: the last point is the live sheet over weeks 6–14');
  check(!h.points.some((p) => p.asOf === 2 || p.asOf === 5), 'history: a week with no copy holding him is a gap, not a zero');

  // Graph 2: one line per as-of week, a 0 and no-number are gaps.
  check(JSON.stringify(h.lines.map((l) => l.asOf)) === '[1,3,4,6]', 'history: one line per as-of week, earliest first');
  const l4 = h.lines[2];
  check(l4.pts[0].week === 4 && l4.pts.length === 11, 'history: a line runs from its week to the last regular week');
  check(l4.pts.find((p) => p.week === 6).proj === null && l4.pts.find((p) => p.week === BYE).proj === null, 'history: graph 2 leaves a 0 and the bye as gaps');
  check(l4.pts.find((p) => p.week === 5).proj === 14, 'history: graph 2 draws what the copy projected');

  // The live sheet replaces a copy of the same week.
  const h2 = ph.history({ copies, playerId: STAR, regularWeeks: REGULAR, byeWeek: BYE, fill: FILL, now: { week: 4, byWeek: live } });
  const p4 = h2.points.find((p) => p.asOf === 4);
  check(h2.points.filter((p) => p.asOf === 4).length === 1 && p4.live && near(p4.avg, (16 * 10 + 7.5) / 11), 'history: now replaces the copy of its own week');

  // Nobody holds him: no points, no lines, no first copy.
  const h3 = ph.history({ copies: [copyOf(5, { withStar: false })], playerId: STAR, regularWeeks: REGULAR, fill: FILL });
  check(h3.points.length === 0 && h3.lines.length === 0 && h3.firstCopy === null, 'history: a man in no copy has nothing');
  // Live only.
  const h4 = ph.history({ copies: [], playerId: STAR, regularWeeks: REGULAR, byeWeek: BYE, fill: FILL, now: { week: 6, byWeek: live } });
  check(h4.points.length === 1 && h4.firstCopy === null, 'history: no copies, the live point alone');
}

// ---------------------------------------------------------------- colour
check(ph.rampColor(0, 5) === '#e0525f', 'rampColor: oldest is red');
check(ph.rampColor(4, 5) === '#3ba55d', 'rampColor: newest is green');
check(ph.rampColor(2, 5) === '#d9a441', 'rampColor: the middle is yellow');
check(ph.rampColor(0, 1) === '#3ba55d', 'rampColor: a single line is the newest');
{
  const reds = [0, 1, 2, 3, 4].map((i) => parseInt(ph.rampColor(i, 5).slice(1, 3), 16));
  const greens = [0, 1, 2, 3, 4].map((i) => parseInt(ph.rampColor(i, 5).slice(3, 5), 16));
  check(reds.every((v, i) => i === 0 || v <= reds[i - 1]), 'rampColor: red falls oldest to newest');
  check(greens[4] > greens[0], 'rampColor: green rises');
}

// ---------------------------------------------------------------- the two SVGs
{
  const copies = [copyOf(1, { starOnWire: true }), copyOf(3), copyOf(4)];
  const live = new Map(REGULAR.map((w) => [w, w === BYE ? 0 : 16]));
  const h = ph.history({ copies, playerId: STAR, regularWeeks: REGULAR, byeWeek: BYE, fill: FILL, now: { week: 6, byWeek: live } });
  const s1 = ph.trendSvg(h.points, { width: 340, fromWeek: 1, toWeek: 6 });
  const pts = [...s1.matchAll(/class="pa-pt[^"]*" data-asof="(\d+)" tabindex="0"/g)].map((m) => Number(m[1]));
  check(JSON.stringify(pts) === '[1,3,4,6]', `trendSvg: a focusable point per as-of week (${pts})`);
  check((s1.match(/ now"/g) || []).length === 1, 'trendSvg: the live point is marked');
  // The line breaks at the missing weeks 2 and 5: three M commands.
  const d = (s1.match(/class="pa-line" d="([^"]*)"/) || [])[1] || '';
  check((d.match(/M/g) || []).length === 3, `trendSvg: the line breaks where a week has no copy (${d})`);
  check(/viewBox="0 0 340 /.test(s1), 'trendSvg: drawn at the width asked');
  // The dots go higher up the page (smaller y) as the average rises.
  const ys = [...s1.matchAll(/class="pa-dot" cx="[\d.]+" cy="([\d.]+)"/g)].map((m) => Number(m[1]));
  const avgs = h.points.map((p) => p.avg);
  check(ys.every((y, i) => i === 0 || (avgs[i] > avgs[i - 1]) === (y < ys[i - 1])), 'trendSvg: higher average, higher dot');
  const s2 = ph.linesSvg(h.lines, { width: 340 });
  check((s2.match(/class="pa-wline/g) || []).length === 4, 'linesSvg: one line per as-of week');
  const strokes = [...s2.matchAll(/class="pa-wline[^"]*" d="[^"]*" stroke="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
  check(strokes[0] === '#e0525f' && strokes[strokes.length - 1] === '#3ba55d', 'linesSvg: oldest red, newest green');
  const cols = [...s2.matchAll(/class="pa-wk" data-week="(\d+)"/g)].map((m) => Number(m[1]));
  check(cols[0] === 1 && cols[cols.length - 1] === 14 && cols.length === 14, 'linesSvg: a focusable column per week projected');
  check(ph.trendSvg([], {}) === '' && ph.linesSvg([], {}) === '', 'nothing to draw: no SVG');
}

// ---------------------------------------------------------------- niceScale
{
  const s = ph.niceScale(17.3);
  check(s.top === 20 && s.ticks.join() === '0,5,10,15,20', `niceScale: 17.3 -> 0..20 by 5 (${s.ticks})`);
  check(ph.niceScale(3).top === 3 && ph.niceScale(0).top === 1, 'niceScale: small and empty');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
