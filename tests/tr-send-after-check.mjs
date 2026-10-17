// Send: now / after week N, at the top of the Trade page's custom box.
//
//   node tr-send-after-check.mjs
//
// Tim, 2026-10-15: "make a button at the top of the custom trade menu that says
// "send ___" that says now, but can be changed so that it says "after week ___"
// so that it only considers the difference in proj if the trade is sent after
// that time ... Adjust all data so it behaves as if the trade is actually sent
// after that date."
//
// Drives the real control through tr-test.mjs's `sendAfter` scenario (the real
// trade.html and js/trade-page.js on the demo league, in a child process) and
// checks what it read back:
//
//   1. the control is there: "Send", first option "now", then "after week N"
//      for every week left but the last;
//   2. after week N, the week-by-week breakdown shows the weeks up to N as no
//      change (before = after, 0.0) and prices only the weeks after N;
//   3. the per-week figures, the total, the chance and the Suggested list all
//      move off what "now" shows, and the sub-line names the weeks after N;
//   4. the pop-up of the deal shows the same weeks as no change;
//   5. Save keeps the week on the entry, and opening the entry brings it back.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const res = spawnSync(process.execPath, [path.join(HERE, 'tr-test.mjs'), 'sendAfter'], {
  encoding: 'utf8', cwd: HERE, maxBuffer: 64 * 1024 * 1024,
});
const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
if (!line) {
  console.log(`FAIL the sendAfter scenario gave no answer (exit ${res.status})`);
  console.log(String(res.stderr || '').trimEnd().split('\n').slice(-8).join('\n'));
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}
const d = JSON.parse(line.slice(2));

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`);
};
const num = (s) => Number(String(s || '').replace('−', '-').replace(/[^0-9.+-]/g, ''));

// ------------------------------------------------------------- 1. the control
ok('boots with no errors', (d.errors || []).length === 0, JSON.stringify(d.errors));
ok('the Send control is in the custom box', d.present === true);
ok('its label reads "Send"', d.label === 'Send', d.label);
const opts = d.optionsAtFirst || [];
ok('first option is "now", and it starts there', opts[0] && opts[0].text === 'now' && opts[0].value === '' && d.selectedAtFirst === '',
  JSON.stringify([opts[0], d.selectedAtFirst]));
// The weeks the "now" breakdown prices (its plain rows), so the choices are
// checked against the page's own span, not a guess.
const nowWeeks = (d.now?.inline || []).filter((r) => r.cls === '' || r.cls === 'peeking').map((r) => Number(r.wk));
ok('"now" prices at least three weeks', nowWeeks.length >= 3, JSON.stringify(nowWeeks));
ok('the choices are every week left but the last', JSON.stringify(d.choices) === JSON.stringify(nowWeeks.slice(0, -1)),
  JSON.stringify([d.choices, nowWeeks]));
ok('each choice reads "after week N"', opts.slice(1).every((o) => o.text === `after week ${o.value}`), JSON.stringify(opts.slice(1, 4)));
const n = d.n;
ok('the scenario picked a week with weeks on both sides', Number.isFinite(n) && nowWeeks.some((w) => w <= n) && nowWeeks.some((w) => w > n), n);
ok('the control shows the chosen week', d.later?.selected === String(n), d.later?.selected);
// Sweep 2026-10-16 #4: the orange hint was priced with no send week and keyed
// under a different one, so after week N it never finished.
ok('after week N the orange hint finishes (data-hint "done")', d.laterHint?.hint === 'done', JSON.stringify(d.laterHint));

// ----------------------------------------------------- 2. the inline breakdown
const L = d.later || {};
for (const [side, rows] of [['you', L.inline || []], ['him', L.inlineB || []]]) {
  const pre = rows.filter((r) => /\bpre\b/.test(r.cls) && r.wk);
  const priced = rows.filter((r) => (r.cls === '' || r.cls === 'peeking') && r.wk).map((r) => Number(r.wk));
  ok(`${side}: the weeks up to ${n} are shown as no change`,
    JSON.stringify(pre.map((r) => Number(r.wk))) === JSON.stringify(nowWeeks.filter((w) => w <= n)),
    JSON.stringify(pre.map((r) => r.wk)));
  ok(`${side}: each of them has before = after and a 0.0 difference`,
    pre.length > 0 && pre.every((r) => r.cells[1] === r.cells[2] && num(r.cells[3]) === 0),
    JSON.stringify(pre.map((r) => r.cells)));
  ok(`${side}: only the weeks after ${n} are priced`,
    JSON.stringify(priced) === JSON.stringify(nowWeeks.filter((w) => w > n)), JSON.stringify(priced));
}
const divider = (L.inline || []).find((r) => /pre-divider/.test(r.cls));
ok('a line says when it is sent and which weeks count',
  divider && divider.cells[0].startsWith(`Sent after week ${n}`) && divider.cells[0].includes(`${nowWeeks.filter((w) => w > n).length} weeks below`),
  divider && divider.cells[0]);
const total = (L.inline || []).find((r) => /sub-row/.test(r.cls));
ok('the total names the weeks after it', total && total.cells[0] === `All ${nowWeeks.filter((w) => w > n).length} weeks after it`, total && total.cells[0]);
// The priced weeks are the SAME numbers as "now" showed for them: only the cut moved.
const byWk = (rows) => new Map(rows.filter((r) => r.wk).map((r) => [r.wk, r.cells.slice(1, 3).join('|')]));
const nowMap = byWk(d.now.inline);
const laterPriced = (L.inline || []).filter((r) => (r.cls === '' || r.cls === 'peeking') && r.wk);
ok('a week after N reads exactly as it did for now', laterPriced.length > 0 && laterPriced.every((r) => nowMap.get(r.wk) === r.cells.slice(1, 3).join('|')),
  JSON.stringify(laterPriced.slice(0, 2)));
ok('a week up to N shows the old lineup on both sides (before = now\'s before)',
  (L.inline || []).filter((r) => /\bpre\b/.test(r.cls) && r.wk).every((r) => nowMap.get(r.wk).split('|')[0] === r.cells[1]));
// The per-week average is over the priced weeks: recompute it from the rows'
// difference column (its first number: the netted gain, as the headline uses).
const diffs = laterPriced.map((r) => num(r.delta));
const avg = diffs.reduce((s, x) => s + x, 0) / diffs.length;
ok('your per-week gain is the average over the weeks after N', Math.abs(num(L.gainA?.num) - avg) < 0.06, `${L.gainA?.num} vs ${avg.toFixed(2)}`);

// ------------------------------------------------- 3. every figure has moved
ok('your per-week gain differs from now', L.gainA?.num !== d.now.gainA.num, `${L.gainA?.num} vs ${d.now.gainA.num}`);
ok('your total differs from now', L.gainA?.sub !== d.now.gainA.sub, `${L.gainA?.sub} vs ${d.now.gainA.sub}`);
const after = nowWeeks.filter((w) => w > n);
ok('the sub-line names the weeks after N', String(L.gainA?.sub).includes(`weeks ${after[0]}–${after[after.length - 1]}`), L.gainA?.sub);
ok('his total differs from now', L.gainB?.sub !== d.now.gainB.sub, `${L.gainB?.sub} vs ${d.now.gainB.sub}`);
ok('the preview says the weeks after N', String(L.preview).includes(`priced over weeks ${after[0]}–`), L.preview);
ok('the chance in the preview has moved', L.preview !== d.now.preview, L.preview);
ok('the Suggested list is up both times', d.now.sug && !d.now.sug.hidden && d.now.sug.rows.length > 0 && !L.sug.hidden && L.sug.rows.length > 0,
  JSON.stringify([d.now.sug, L.sug]));
ok('the Suggested list was searched again under the week', JSON.stringify(L.sug.rows) !== JSON.stringify(d.now.sug.rows));

// ------------------------------------------------------------- 4. the pop-up
const pop = d.pop || {};
ok('the pop-up opens', pop.open === true);
const popPre = (pop.rows || []).filter((r) => /\bpre\b/.test(r.cls) && r.wk);
ok('the pop-up shows the weeks up to N as no change',
  JSON.stringify(popPre.map((r) => Number(r.wk))) === JSON.stringify(nowWeeks.filter((w) => w <= n)) &&
  popPre.every((r) => r.cells[1] === r.cells[2] && num(r.cells[3]) === 0),
  JSON.stringify(popPre.map((r) => r.cells)));

// --------------------------------------------------------- 5. saved, reopened
const stored = Array.isArray(d.stored) ? d.stored : [];
ok('Save keeps the week on the entry', stored.length === 1 && stored[0].sendAfter === n, JSON.stringify(stored));
ok('the saved row is priced under its week', (d.savedRow || []).length === 1 &&
  d.savedRow[0].gainText.startsWith(L.gainA.num), JSON.stringify([d.savedRow, L.gainA]));
ok('Clear and Send back on now', d.clearedSelected === '', d.clearedSelected);
ok('opening the saved trade brings its week back', d.reopened?.selected === String(n), JSON.stringify(d.reopened));
ok('... with the same men ticked', JSON.stringify(d.reopened?.a.concat(d.reopened?.b).sort()) === JSON.stringify(d.reopened?.men.slice().sort()),
  JSON.stringify(d.reopened));
ok('... and the same per-week gain', d.reopened?.gainA === L.gainA?.num, JSON.stringify([d.reopened?.gainA, L.gainA?.num]));

if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  FAIL ${f}`);
}
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
