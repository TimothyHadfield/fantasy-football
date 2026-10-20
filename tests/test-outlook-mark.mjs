// Checks js/outlook-mark.js — the 💎 / 🪙 by a player's name on the Trade page.
//
//   node test-outlook-mark.mjs
//
// Tim, 2026-10-12: "If the player's future proj is 2 more than their current
// avg, then put a diamond symbol by their name. If it's 2 less, then put a coin
// symbol by their name."

import path from 'node:path';
import { readFileSync } from 'node:fs';
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
eq(o.outlookOf(14.1, 11.0), { kind: 'diamond', delta: 3.1, avg: 11, proj: 14.1 }, 'projected 3.1 above his average: a diamond');
eq(o.outlookOf(9.5, 13.0), { kind: 'coin', delta: -3.5, avg: 13, proj: 9.5 }, 'projected 3.5 below: a coin');
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

// --- a flat 2, on his plain average (Tim, 2026-10-19) ------------------------
// "I don't like what you did with changing my formula to remove luck with the
// coins and diamonds in the trade menu. I use that as a form of appeal from
// other players and to measure how expensive/valueable they are. Keep it at the
// +2/-2 mark". Phase 4 (3255389) scaled the gap with games played and left
// injury-shortened games out of the average; both are gone.

eq(kind(13.5, 11.0), 'diamond', '2.5 above is a diamond, however few games he has played');
eq(o.outlookOf(13.5, 11.0, 4) && o.outlookOf(13.5, 11.0, 4).kind, 'diamond', 'a games count passed in changes nothing (no 3.4 needed after 4 games)');
eq(o.outlookOf(8.5, 11.0, 4) && o.outlookOf(8.5, 11.0, 4).kind, 'coin', 'and 2.5 below is a coin after 4 games too');
eq(o.outlookOf(13.0, 11.0, 1) && o.outlookOf(13.0, 11.0, 1).kind, 'diamond', 'exactly 2 after one game still counts');
eq(o.outlookOf(12.9, 11.0, 30), null, '1.9 is no mark, whatever the games');
ok(typeof o.neededGap === 'undefined' && typeof o.SPREAD === 'undefined', 'no games-played scaling left');
ok(typeof o.cleanAvgOf === 'undefined' && typeof o.SHORT_SHARE === 'undefined', 'no injury cleaning of the average left');
// The plain average: a man whose 2 in a game he left hurt drags ESPN's 15.5
// down is still read at 15.5 — that game is part of his luck and cost.
eq(kind(17.5, 15.5), 'diamond', 'his plain average 15.5, projected 17.5: a diamond');
ok(/2 or more a week above \/ below his average/.test(o.OUTLOOK_KEY), 'the key says 2 or more a week above / below his average', o.OUTLOOK_KEY);
ok(/2 or more points a week/.test(o.OUTLOOK_EXPLAIN) && !/√|games he has played|injur|ruled out/.test(o.OUTLOOK_EXPLAIN),
  'the explanation states the flat 2 and nothing about games or injuries', o.OUTLOOK_EXPLAIN);
ok(!/injur/.test(o.APPEAL_EXPLAIN), 'Appeal reads the plain average, and says nothing of injuries', o.APPEAL_EXPLAIN);
ok(!/without week/.test(o.outlookWords(o.outlookOf(26, 15.5))), 'the mark’s words name no left-out game');
// Both pages hand the mark and Appeal the plain average: no cleaning step.
for (const f of ['js/trade-page.js', 'js/waivers-page.js']) {
  const src = readFileSync(path.join(REPO, f), 'utf8');
  ok(!/cleanAvgOf|markAvgOf|seasonGames/.test(src), `${f}: no cleaned average and no games count`);
}
{
  const src = readFileSync(path.join(REPO, 'js/trade-page.js'), 'utf8');
  ok(/function appealOfOffer[\s\S]{0,400}avg: g\.avg/.test(src), 'trade page: Appeal reads each man’s plain average (g.avg)');
}

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
