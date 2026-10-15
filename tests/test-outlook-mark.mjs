// Checks js/outlook-mark.js — the 💎 / 🪙 by a player's name on the Trade page.
//
//   node test-outlook-mark.mjs
//
// Tim, 2026-10-12: "If the player's future proj is 2 more than their current
// avg, then put a diamond symbol by their name. If it's 2 less, then put a coin
// symbol by their name."

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const o = await import(pathToFileURL(path.join(REPO, 'js/outlook-mark.js')).href);

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const kind = (proj, avg) => { const r = o.outlookOf(proj, avg); return r ? r.kind : null; };

// --- which mark -------------------------------------------------------------
eq(o.outlookOf(14.1, 11.0), { kind: 'diamond', delta: 3.1, avg: 11, proj: 14.1, games: null, skipped: [] }, 'projected 3.1 above his average: a diamond');
eq(o.outlookOf(9.5, 13.0), { kind: 'coin', delta: -3.5, avg: 13, proj: 9.5, games: null, skipped: [] }, 'projected 3.5 below: a coin');
eq(kind(13.0, 11.0), 'diamond', 'exactly 2.0 above counts ("2 more")');
eq(kind(11.0, 13.0), 'coin', 'exactly 2.0 below counts');
eq(kind(12.9, 11.0), null, '1.9 above is no mark');
eq(kind(11.1, 13.0), null, '1.9 below is no mark');
eq(kind(12.0, 12.0), null, 'the same is no mark');
// As printed: both sides go to the tenth first.
eq(kind(12.96, 11.0), 'diamond', '12.96 prints as 13.0, which is 2.0 above 11.0');
eq(kind(12.94, 11.0), null, '12.94 prints as 12.9: no mark');
eq(kind(13.0, 11.04), 'diamond', '11.04 prints as 11.0');
eq(kind(13.0, 11.06), null, '11.06 prints as 11.1: 1.9 apart');
ok(o.outlookOf(13.2, 11.1).delta === 2.1, 'the gap is a clean tenth, not 2.0999', o.outlookOf(13.2, 11.1).delta);

// --- not known is no mark ---------------------------------------------------
eq(kind(null, 11), null, 'no projection: no mark');
eq(kind(14, null), null, 'no average: no mark');
eq(kind(undefined, undefined), null, 'neither: no mark');
eq(kind(NaN, 11), null, 'NaN: no mark');
eq(kind('14', 11), null, 'text is not a number');
eq(kind(14, 0), null, 'a man who has not scored has no average to be above');
eq(kind(0, 12), null, 'a man projected at nothing (out for the season) gets no coin');
eq(kind(14, -1), null, 'a negative average is not one to compare to');

// --- the markup -------------------------------------------------------------
const up = o.outlookHtml(o.outlookOf(14.1, 11.0));
const dn = o.outlookHtml(o.outlookOf(9.5, 13.0));
ok(up.includes('💎') && up.includes('outlook-diamond') && !up.includes('🪙'), 'the diamond is a diamond', up);
ok(dn.includes('🪙') && dn.includes('outlook-coin') && !dn.includes('💎'), 'the coin is a coin', dn);
ok(up.includes('aria-hidden="true"') && up.includes('sr-only'), 'the symbol is hidden from a reader and the words are not');
ok(up.includes('3.1 a week above') && up.includes('11.0 so far → 14.1 projected'), 'the diamond’s words say both numbers', up);
ok(dn.includes('3.5 a week below') && dn.includes('13.0 so far → 9.5 projected'), 'the coin’s words say both numbers', dn);
ok(!/title=/.test(up), 'no title: the name it sits on opens his card');
eq(o.outlookHtml(null), '', 'no mark is no markup');
eq(o.outlookWords(null), '', 'and no words');
ok(o.hasOutlook(up) && o.hasOutlook(dn) && !o.hasOutlook('<span class="trend trend-up">▲</span>') && !o.hasOutlook(''),
  'hasOutlook finds either mark and nothing else');
ok(o.OUTLOOK_KEY.split(/\s+/).length <= 20 && o.OUTLOOK_KEY.includes('💎') && o.OUTLOOK_KEY.includes('🪙'),
  'the key is one short sentence naming both symbols', o.OUTLOOK_KEY);
ok(o.OUTLOOK_EXPLAIN.includes(String(o.THRESHOLD)) && o.THRESHOLD === 2, 'the explanation states the threshold, which is 2');

// --- the gap scales with games played (trade audit finding 9, Phase 4) -------
// One man's score moves about 6.7 a week, so an average of n games is good to
// about 6.7/√n: the gap needed is that, never under Tim's 2.
const kindG = (proj, avg, games) => { const r = o.outlookOf(proj, avg, games); return r ? r.kind : null; };
eq(kindG(13.5, 11.0, 4), null, 'a 4-game man 2.5 above his average: no mark (needs 3.4)');
eq(kindG(13.5, 11.0, 12), 'diamond', 'a 12-game man 2.5 above: a diamond (needs 2)');
eq(kindG(8.5, 11.0, 4), null, 'a 4-game man 2.5 below: no coin');
eq(kindG(8.5, 11.0, 12), 'coin', 'a 12-game man 2.5 below: a coin');
eq(kindG(14.0, 11.0, 5), 'diamond', '5 games needs 3.0 (6.7/√5 = 3.0), and exactly 3.0 counts');
eq(kindG(13.9, 11.0, 5), null, '5 games: 2.9 is not enough');
eq(kindG(13.0, 11.0, 30), 'diamond', 'never stricter than Tim’s 2, however many games');
eq(kindG(12.9, 11.0, 30), null, 'and never looser than 2 either');
eq(kindG(17.0, 11.0, 1), null, 'one game: 6.0 above is still inside 6.7');
ok(o.outlookOf(14.1, 11.0, 12).games === 12, 'the mark carries the games it was judged on');
ok(Math.abs(o.neededGap(4) - 3.35) < 0.01 && o.neededGap(12) === 2 && o.neededGap(null) === 2,
  'neededGap: 3.35 at 4 games, 2 at 12, Tim’s 2 when the count is not known', [o.neededGap(4), o.neededGap(12)]);
ok(o.SPREAD === 6.7, 'the spread is the measured 6.7 points a week');
ok(/6\.7/.test(o.OUTLOOK_EXPLAIN) && /games/.test(o.OUTLOOK_EXPLAIN) && /injur|ruled out/.test(o.OUTLOOK_EXPLAIN),
  'the explanation says the gap shrinks with games and how an injured game is left out', o.OUTLOOK_EXPLAIN);
ok(!/2 or more/.test(o.OUTLOOK_KEY), 'the key no longer promises a flat 2', o.OUTLOOK_KEY);

// --- the average leaves out a game cut short by injury ----------------------
// ESPN has no "left hurt" flag; it keeps each played week's final projection,
// which is 0 when he was ruled out. A game is left out only when he scored
// under half his other games' median AND was ruled out of his team's next game.
const wk = (week, actual, proj) => ({ week, actual, proj });
// 5 games 20, 18, 22, 2 (hurt), 0-line ruled out in week 5 … ESPN: 62/4 = 15.5.
const hurt = o.cleanAvgOf({ avg: 15.5, games: 4, weeks: [wk(1, 20, 15), wk(2, 18, 15), wk(3, 22, 15), wk(4, 2, 15), wk(5, 0, 0), wk(6, null, 15)] });
eq(hurt.skipped, [4], 'the 2 in week 4, then ruled out of week 5: left out');
ok(Math.abs(hurt.avg - 20) < 1e-9 && hurt.games === 3, 'his average is the other three: 60/3 = 20', JSON.stringify(hurt));
// Lamb's shape (1241838, 2026-10-15): 12.9, 31.3, 16.7, 32.8, then 1.9 — and
// ESPN projects him at 14.9 for week 6. Nothing says he was hurt: kept.
const lamb = o.cleanAvgOf({ avg: 19.12, games: 5, weeks: [wk(1, 12.9, 14.2), wk(2, 31.3, 14.9), wk(3, 16.7, 14), wk(4, 32.8, 13.7), wk(5, 1.9, 15.5), wk(6, null, 14.9)] });
eq(lamb.skipped, [], 'a bad game he played on from is NOT left out (Lamb, week 5)');
ok(lamb.avg === 19.12 && lamb.games === 5, 'and ESPN’s average stands', JSON.stringify(lamb));
// The mark: proj 20.5 against ESPN's 15.5 (5.0 above, 4 games: needs 3.4) would
// be a diamond; against the cleaned 20.0 it is no mark at all.
{
  const before = o.outlookOf(20.5, 15.5, 4);
  const after = o.outlookOf(20.5, hurt.avg, hurt.games, hurt.skipped);
  ok(before && before.kind === 'diamond' && after === null,
    'a man is not marked off an injury-shortened game alone', JSON.stringify([before, after]));
}
eq(o.cleanAvgOf({ avg: 15.5, games: 4, weeks: [wk(1, 20, 15), wk(2, 18, 15), wk(3, 22, 15), wk(4, 2, 15), wk(5, 12, 14)] }).skipped, [],
  'a low game he played the next week after: kept');
eq(o.cleanAvgOf({ avg: 15.5, games: 4, weeks: [wk(1, 20, 15), wk(2, 18, 15), wk(3, 22, 15), wk(4, 11, 15), wk(5, 0, 0)] }).skipped, [],
  'ruled out next week but the game was not far below his usual (11 vs median 20): kept');
eq(o.cleanAvgOf({ avg: 15.5, games: 4, weeks: [wk(1, 20, 15), wk(2, 18, 15), wk(3, 22, 15), wk(4, 2, 15)] }).skipped, [],
  'the week after not held: nothing says he was out — kept');
eq(o.cleanAvgOf({ avg: 15.5, games: 4, bye: 5, weeks: [wk(1, 20, 15), wk(2, 18, 15), wk(3, 22, 15), wk(4, 2, 15), wk(5, 0, 0), wk(6, 14, 15)] }).skipped, [],
  'his bye is not "ruled out of the next game"');
eq(o.cleanAvgOf({ avg: 15.5, games: 4, bye: 5, weeks: [wk(1, 20, 15), wk(2, 18, 15), wk(3, 22, 15), wk(4, 2, 15), wk(5, 0, 0), wk(6, 0, 0)] }).skipped, [4],
  'over a bye, his team’s next game is the week after it');
{
  const few = o.cleanAvgOf({ avg: 11, games: 2, weeks: [wk(1, 20, 15), wk(2, 2, 15), wk(3, 0, 0)] });
  eq(few.skipped, [], 'two games are too few to call one of them short');
}
{
  const unk = o.cleanAvgOf({ avg: 15.5, games: null, weeks: [wk(1, 20, 15), wk(2, 18, 15), wk(3, 22, 15), wk(4, 2, 15), wk(5, 0, 0)] });
  ok(unk.skipped.length === 0 && unk.avg === 15.5 && unk.games === 4,
    'games not known: nothing left out, the games held are the count', JSON.stringify(unk));
}
eq(o.cleanAvgOf({ avg: null, games: 3, weeks: [] }), { avg: null, games: 3, skipped: [] }, 'no average: nothing to clean');
ok(/without week 4, cut short by injury/.test(o.outlookWords(o.outlookOf(26, hurt.avg, hurt.games, hurt.skipped))),
  'the mark’s words say which game was left out', o.outlookWords(o.outlookOf(26, hurt.avg, hurt.games, hurt.skipped)));
ok(/injury/.test(o.APPEAL_EXPLAIN), 'Appeal says it reads the same cleaned average', o.APPEAL_EXPLAIN);

// --- Appeal ------------------------------------------------------------------
// Tim, 2026-10-12: "high appeal correlates with their players having a diamond
// and my players having a coin" / "If a player has never played a game so their
// act avg is 0 … essentially don't calculate their number at all."
const M = (proj, avg) => ({ proj, avg });
eq(o.appealOf([M(14.1, 11.0)], [M(9.5, 13.0)]), 6.6, 'you get a diamond (+3.1) for a coin (−3.5): +6.6');
eq(o.appealOf([M(9.5, 13.0)], [M(14.1, 11.0)]), -6.6, 'the same trade from the other side: −6.6');
ok(o.appealOf([M(14.1, 11.0)], [M(9.5, 13.0)]) > o.appealOf([M(12, 12)], [M(12, 12)]),
  'his diamond for your coin is higher than a trade of men on their averages');
eq(o.appealOf([M(12, 12)], [M(8, 8)]), 0, 'everybody on his average: 0');
eq(o.appealOf([M(13, 11), M(10, 9.5)], [M(12, 12.4)]), 2.9, 'added up over each side: (2.0 + 0.5) − (−0.4)');
eq(o.appealOf([M(12.5, 11)], [M(12.5, 11)]), 0, 'the same gap both ways cancels, and is 0 not −0');
ok(Object.is(o.appealOf([M(12.5, 11)], [M(12.5, 11)]), 0), 'a plain 0');
eq(o.appealOf([M(12.2, 11.1)], []), 1.1, 'a clean tenth, not 1.0999');
// A man who has never played adds nothing (Tim's own case).
eq(o.appealOf([M(11.4, 0), M(14.1, 11.0)], [M(9.5, 13.0)]), 6.6, 'a man with a 0 average adds nothing');
eq(o.appealOf([M(14.1, 11.0)], [M(11.4, 0), M(9.5, 13.0)]), 6.6, 'on either side');
eq(o.appealOf([M(11.4, null)], [M(9.5, 13.0)]), 3.5, 'no average at all is the same as never played');
eq(o.appealOf([M(null, 12)], [M(9.5, 13.0)]), 3.5, 'no projection: nothing from him either');
eq(o.appealOf([M(0, 12)], [M(9.5, 13.0)]), 3.5, 'projected at nothing (out): nothing from him');
eq(o.appealOf([M(11.4, 0)], [M(8, null)]), null, 'nobody with both numbers: not known, never 0');
eq(o.appealOf([], []), null, 'nobody at all: not known');
eq(o.appealOf(null, undefined), null, 'no lists: not known, not a crash');
// It moves with the marks: a diamond got is at least +2, a coin sent at least +2.
ok(o.outlookOf(13, 11).kind === 'diamond' && o.appealOf([M(13, 11)], [M(10, 10)]) >= 2, 'a diamond you get is worth 2 or more of appeal');
ok(o.outlookOf(11, 13).kind === 'coin' && o.appealOf([M(10, 10)], [M(11, 13)]) >= 2, 'a coin you send is worth 2 or more of appeal');
ok(o.appealOf([M(11, 13)], [M(10, 10)]) <= -2, 'a coin you GET counts against it');
ok(o.APPEAL_EXPLAIN.includes('💎') && o.APPEAL_EXPLAIN.includes('🪙'), 'the explanation ties it to both marks');

// --- Total: Appeal plus both gains a week --------------------------------------
// Tim, 2026-10-12: "Ex: appeal=+4, my pts/week dif = +2, opp pts/week dif = -1,
// total=+5."
eq(o.totalOf(4, 2, -1), 5, 'his own example: +4, +2 and −1 is +5');
eq(o.totalOf(4, 2, 1), 7, 'a trade he gains from too is higher');
eq(o.totalOf(-3.5, 1.2, 0.4), -1.9, 'a clean tenth');
eq(o.totalOf(5.2, 2.84, -1.14), 6.9, 'each gain goes in as printed (+2.8, −1.1)');
eq(o.totalOf(1, -3, 2), 0, 'cancelling out is 0');
ok(Object.is(o.totalOf(1, -3, 2), 0), 'a plain 0, never −0');
eq(o.totalOf(null, 2, -1), null, 'no Appeal known: no Total');
eq(o.totalOf(6.6, null, -1), 5.6, 'no figure for you: the rest');
eq(o.totalOf(6.6, 2, NaN), 8.6, 'no figure for him: the rest');
ok(o.totalOf(4, 2, -1) !== o.appealOf([M(14, 10)], []), 'Total is not Appeal: Appeal alone stays +4');
ok(o.APPEAL_EXPLAIN.includes('Total') && !/plus the other manager’s gain a week\. High/.test(o.APPEAL_EXPLAIN),
  'the explanation gives Total its own sentence and takes his gain back out of Appeal');
ok(typeof o.appealShown === 'undefined', 'the Appeal that added his gain is gone');

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
