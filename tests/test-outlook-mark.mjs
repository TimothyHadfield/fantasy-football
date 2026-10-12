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

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
