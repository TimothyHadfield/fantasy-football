// Checks js/send-after.js: the weeks a trade sent "after week N" is priced over.
//
//   node test-send-after.mjs
//
// Tim, 2026-10-15: "make a button at the top of the custom trade menu that says
// "send ___" that says now, but can be changed so that it says "after week ___"
// so that it only considers the difference in proj if the trade is sent after
// that time."
//
// Every expected list below is written out by hand.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const { sendAfterChoices, liveSendAfter, weeksAfter, weeksBefore } =
  await import(pathToFileURL(path.join(REPO, 'js/send-after.js')).href);

let pass = 0;
let fail = 0;
const eq = (a, b, name) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.log(`FAIL ${name} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
};

const SPAN = [5, 6, 7, 8, 9]; // weeks 5-9 still to play, as a real mid-season span

// The choices: every week left but the last (sending after the last changes nothing).
eq(sendAfterChoices(SPAN), [5, 6, 7, 8], 'choices: all but the last week');
eq(sendAfterChoices([12]), [], 'choices: one week left, nothing to send after');
eq(sendAfterChoices([]), [], 'choices: no weeks');
eq(sendAfterChoices(null), [], 'choices: no span');

// "now" in every spelling.
for (const v of [null, undefined, '', 'now', NaN]) eq(liveSendAfter(v, SPAN), null, `live: ${String(v)} is now`);
// A week that is still ahead holds, number or string.
eq(liveSendAfter(6, SPAN), 6, 'live: week 6 holds');
eq(liveSendAfter('7', SPAN), 7, 'live: "7" from a select holds');
eq(liveSendAfter(5, SPAN), 5, 'live: the first week left holds');
// A week since played counts as now (Tim's saved trade, a few weeks later).
eq(liveSendAfter(4, SPAN), null, 'live: week 4, already played, is now');
eq(liveSendAfter(1, SPAN), null, 'live: week 1 is now');

// The weeks priced, and the weeks played on the old rosters.
eq(weeksAfter(SPAN, null), [5, 6, 7, 8, 9], 'after: now prices every week');
eq(weeksBefore(SPAN, null), [], 'before: now has none');
eq(weeksAfter(SPAN, 6), [7, 8, 9], 'after week 6: weeks 7-9');
eq(weeksBefore(SPAN, 6), [5, 6], 'before week 6: weeks 5-6');
eq(weeksAfter(SPAN, 5), [6, 7, 8, 9], 'after week 5: weeks 6-9');
eq(weeksBefore(SPAN, 5), [5], 'before week 5: week 5');
eq(weeksAfter(SPAN, 4), [5, 6, 7, 8, 9], 'after a played week: all of them');
eq(weeksBefore(SPAN, 4), [], 'before a played week: none');
eq(weeksAfter(SPAN, 9), [], 'after the last week: nothing left (the page says so)');
eq(weeksBefore(SPAN, 9), [5, 6, 7, 8, 9], 'before the last week: all of them');
// The two halves always make the whole span, in order, and never overlap.
for (const n of [null, 4, 5, 6, 7, 8, 9]) {
  eq([...weeksBefore(SPAN, n), ...weeksAfter(SPAN, n)], SPAN, `split at ${n}: the halves make the span`);
}
// It never edits the span it is handed.
const copy = SPAN.slice();
weeksAfter(SPAN, 6); weeksBefore(SPAN, 6); sendAfterChoices(SPAN);
eq(SPAN, copy, 'the span is left alone');
eq(weeksAfter(SPAN, null) === SPAN, false, 'now hands back a copy, not the span');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
