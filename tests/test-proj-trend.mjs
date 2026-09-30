// Checks js/proj-trend.js — the small arrow by a name when a man's per-week
// projection has moved more than 2 points since the preseason.
//
//   node test-proj-trend.mjs
//
// Tim, 2026-09-29: "put a up or down arrow by that player's name if their
// rest-of-season proj/week has increased or decreased by more than 2 than it
// was at the begginning of the season. make the down arrow red and up arrow
// green. make sure it's small so it's not too distracting."
//
// THREE QUESTIONS, each with an answer a reader can redo by hand:
//
//   1. IS THE PRESEASON RIGHT? The committed copy (data/baselines/) holds ESPN's
//      RAW projected stats. Re-scored with ESPN's own default PPR rules they must
//      land on ESPN's own `appliedTotal` for every man in it — every position,
//      kickers and defences included. That is what makes re-scoring them for a
//      half-PPR league trustworthy.
//   2. IS THE THRESHOLD "MORE THAN 2", strictly? +2.0 is no arrow, +2.1 is.
//   3. IS "NOT KNOWN" KEPT APART FROM "UNCHANGED"? A man not in the copy, a copy
//      with zero games, no league scoring: no arrow, never a flat one.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const trend = await import(pathToFileURL(path.join(REPO, 'js/proj-trend.js')).href);

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`); }
};

// ---- the committed copy, read the way the page reads it --------------------
//
// Under node a file: URL cannot be fetched, so this also proves the module's
// fallback (a JSON import) works — the path every page suite takes.
const loaded = await trend.loadBaseline();
ok(loaded && loaded.players && trend.ready(), 'the committed preseason copy loads through the module');
const file = JSON.parse(readFileSync(path.join(REPO, 'data/baselines/2026-preseason.json'), 'utf8'));
const ids = Object.keys(file.players);
ok(ids.length > 450, 'it holds the ~500 men ESPN projected above zero', ids.length);
ok(/web\.archive\.org\/web\/20260909/.test(file.source) && file.captured === '2026-09-09',
  'and says where it came from and when', `${file.source} ${file.captured}`);

// ---- 1. re-scoring lands on ESPN's own total --------------------------------
let worst = 0;
let worstWho = '';
const byPos = {};
for (const id of ids) {
  const e = file.players[id];
  const d = Math.abs(trend.scoreEntry(e, trend.DEFAULT_PPR) - e.t);
  byPos[e.p] = (byPos[e.p] || 0) + 1;
  if (d > worst) { worst = d; worstWho = `${e.n} (${id})`; }
}
ok(worst < 0.1, 'every man re-scored with ESPN\'s default PPR rules is within 0.1 of ESPN\'s own season total',
  `${worst.toFixed(4)} off for ${worstWho}`);
for (const pos of [1, 2, 3, 4, 5, 16]) {
  ok(byPos[pos] > 5, `position ${pos} is in the copy (QB, RB, WR, TE, K, D/ST all checked)`, JSON.stringify(byPos));
}

// Three real men by hand. ESPN's own total (`t`) beside the re-scored one.
const named = (name) => Object.entries(file.players).find(([, e]) => e.n === name) || [null, null];
const HALF = trend.DEFAULT_PPR.map((i) => (i.statId === 53
  ? { statId: 53, points: 0, pointsOverrides: { 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5 } }
  : i));
for (const [name, espnTotal] of [['Jahmyr Gibbs', 369.07], ['Puka Nacua', 353.57], ['Josh Allen', 370.03]]) {
  const [id, e] = named(name);
  ok(e && Math.abs(e.t - espnTotal) < 0.005, `${name} is in the copy with ESPN's own total ${espnTotal}`, e && e.t);
  ok(e && Math.abs(trend.scoreEntry(e, trend.DEFAULT_PPR) - espnTotal) < 0.1,
    `${name}: re-scored PPR lands on ${espnTotal}`, e && trend.scoreEntry(e, trend.DEFAULT_PPR));
  if (id) ok(trend.baselineOf(id, trend.DEFAULT_PPR).games === 17, `${name}: 17 projected games`);
}
// Half PPR by hand: the PPR total minus half his projected catches (stat 53).
{
  const [id, e] = named('Jahmyr Gibbs');
  const byHand = trend.scoreEntry(e, trend.DEFAULT_PPR) - 0.5 * e.s[53];
  ok(Math.abs(trend.scoreEntry(e, HALF) - byHand) < 1e-9,
    'Gibbs, half PPR = PPR total − ½ × his projected catches', `${trend.scoreEntry(e, HALF)} vs ${byHand}`);
  ok(trend.baselineOf(id, HALF).perWeek === 19.7 && trend.baselineOf(id, trend.DEFAULT_PPR).perWeek === 21.7,
    'Gibbs: 19.7 a week half PPR, 21.7 full PPR (÷ 17 games, to the tenth)',
    `${trend.baselineOf(id, HALF).perWeek} / ${trend.baselineOf(id, trend.DEFAULT_PPR).perWeek}`);
  const [qid] = named('Josh Allen');
  ok(trend.baselineOf(qid, HALF).perWeek === trend.baselineOf(qid, trend.DEFAULT_PPR).perWeek,
    'a quarterback catches nothing, so half PPR leaves Josh Allen unchanged');
}
// A position override wins over the flat value (ESPN's own rule, §3.3).
{
  const [id, e] = named('Puka Nacua');
  const tePremium = [{ statId: 53, points: 1, pointsOverrides: { 3: 0.25 } }];
  ok(Math.abs(trend.scoreEntry(e, tePremium) - 0.25 * e.s[53]) < 1e-9,
    'a receiver is scored at his position\'s override, not the flat points', id);
}
// D/ST: defensive points come from position-16 overrides with points 0.
{
  const dst = Object.entries(file.players).find(([, e]) => e.p === 16);
  const [, e] = dst;
  ok(Math.abs(trend.scoreEntry(e, trend.DEFAULT_PPR) - e.t) < 0.1 && e.t > 50,
    `a defence (${e.n}) re-scores through its overrides onto ESPN's total`, `${trend.scoreEntry(e, trend.DEFAULT_PPR)} vs ${e.t}`);
  const noOverrides = trend.DEFAULT_PPR.map(({ statId, points }) => ({ statId, points }));
  ok(trend.scoreEntry(e, noOverrides) < e.t - 30,
    'and without the overrides it would score far less — the override IS the D/ST scoring');
  ok(file.players[dst[0]] && Number(dst[0]) < 0, 'defences keep ESPN\'s negative ids', dst[0]);
}

// ---- 2. the threshold -------------------------------------------------------
// A hand-built copy: 170 points over 17 games is 10.0 a week under a rule that
// scores stat 1 at one point.
trend.setBaseline({ players: {
  1: { p: 3, g: 17, s: { 1: 170 } },
  2: { p: 3, g: 0, s: { 1: 170 } },
  3: { p: 3, g: 17, s: {} },
  '-16001': { p: 16, g: 17, s: { 1: 119 } },
} });
const ONE = [{ statId: 1, points: 1 }];
ok(trend.baselineOf(1, ONE).perWeek === 10, 'hand-built: 170 over 17 games is 10.0 a week');
ok(trend.trendOf(1, 12.0, ONE) === null, '+2.0 exactly: no arrow (the rule is MORE than 2)');
ok(trend.trendOf(1, 8.0, ONE) === null, '−2.0 exactly: no arrow');
ok(trend.trendOf(1, 11.95, ONE) === null, '+1.95 (12.0 once rounded to the tenth): no arrow');
const up = trend.trendOf(1, 12.1, ONE);
ok(up && up.dir === 'up' && up.delta === 2.1 && up.from === 10 && up.to === 12.1, '+2.1: an up arrow', JSON.stringify(up));
const down = trend.trendOf(1, 7.9, ONE);
ok(down && down.dir === 'down' && down.delta === -2.1, '−2.1: a down arrow', JSON.stringify(down));
ok(trend.trendOf(1, 30, ONE).dir === 'up' && trend.trendOf(1, 0.5, ONE).dir === 'down', 'far either way: the right direction');
const dst = trend.trendOf(-16001, 4.3, ONE);
ok(dst && dst.dir === 'down' && dst.from === 7, 'a defence (negative id, 119 / 17 = 7.0) at 4.3 a week: down', JSON.stringify(dst));

// ---- 3. not known is not unchanged ------------------------------------------
ok(trend.trendOf(999, 30, ONE) === null, 'a man not in the copy: no arrow');
ok(trend.trendOf(2, 30, ONE) === null, 'zero projected games in the copy: no arrow');
ok(trend.trendOf(3, 30, ONE) === null, 'a zero preseason total: no arrow');
ok(trend.trendOf(1, 30, null) === null, 'no league scoring known: no arrow');
ok(trend.trendOf(1, null, ONE) === null && trend.trendOf(1, 0, ONE) === null,
  'no current figure (null, or nothing above zero): no arrow');
trend.setBaseline(null);
ok(!trend.ready() && trend.trendOf(1, 30, ONE) === null, 'before the copy is read: no arrow');

// ---- the mark itself ---------------------------------------------------------
const html = trend.trendHtml({ dir: 'up', delta: 4.4, from: 21.7, to: 26.1, over: 'weeks 5–14' });
ok(/class="trend trend-up"/.test(html) && /▲/.test(html) && !/▼/.test(html), 'up is a ▲ with trend-up (green in CSS)', html);
// "Now" is the SITE'S average of ESPN's weekly projections — ESPN publishes no
// rest-of-season per-week number, and the words must not say it does.
ok(html.includes('title="Up 4.4 a week since preseason: 21.7 (ESPN’s 9 Sep projection per game) → ' +
  '26.1 (the site’s average of ESPN’s weekly projections over weeks 5–14)"'),
  'its tooltip says how far, from ESPN’s preseason, to the site’s own average over which weeks', html);
ok(!/rest-of-season projection/.test(html), 'and never implies ESPN published a rest-of-season number', html);
ok(/<span class="sr-only"> \(Up 4\.4 a week since preseason: 21\.7/.test(html) &&
  html.indexOf('sr-only') > html.indexOf('class="trend'),
  'the same words for a screen reader, INSIDE the positioned arrow', html);
ok(/aria-hidden="true">▲</.test(html), 'the glyph itself is hidden from a screen reader');
const dn = trend.trendHtml({ dir: 'down', delta: -3.2, from: 10, to: 6.8 });
ok(/trend-down/.test(dn) && /▼/.test(dn) && /Down 3\.2 a week/.test(dn) &&
  /weekly projections\)"/.test(dn), 'down is a ▼ with trend-down (red), "Down 3.2"; no weeks, no "over"', dn);
ok(trend.trendHtml(null) === '', 'no trend, no markup');
ok(trend.hasTrend(html) && trend.hasTrend(dn) && !trend.hasTrend('<span class="heatmark">▲</span>'),
  'the key test finds an arrow and ignores the heat scale\'s ▲');
ok(trend.TREND_KEY.split(/\s+/).length <= 20 && trend.TREND_KEY.split('. ').length === 1,
  'the key is one short sentence (rule 16)', trend.TREND_KEY);
ok(/9 Sep/.test(trend.trendExplain('weeks 5–14')) && /weeks 5–14/.test(trend.trendExplain('weeks 5–14')) &&
  /re-scored/.test(trend.trendExplain('')), 'the How-this-works line names the basis and the weeks (rule 7)');

// ---- the league's rules, cut down -------------------------------------------
const cut = trend.compactScoring([
  { statId: 53, points: 0, pointsOverrides: { 1: 0.5, 3: 0.5 }, isReverseItem: false, leagueRanking: 0 },
  { statId: 3, points: 0.04, pointsOverrides: {} },
]);
ok(JSON.stringify(cut) === JSON.stringify([
  { statId: 53, points: 0, pointsOverrides: { 1: 0.5, 3: 0.5 } }, { statId: 3, points: 0.04 },
]), 'compactScoring keeps statId, points and a non-empty override map, and nothing else', JSON.stringify(cut));
ok(trend.compactScoring(null) === null && trend.compactScoring([]) === null, 'and no rules is null, not []');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
