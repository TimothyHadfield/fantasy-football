// The Trade page's "This week" column (Tim, 2026-10-28: "Add a new column that
// shows this week's proj change with the top bar being mine and the bottom
// being theirs, just like many of the other columns").
//
//   node tr-thisweek-check.mjs
//
// Drives tr-test.mjs's `thisWeek` scenario (the real trade.html and
// js/trade-page.js on the demo league, in a child process) and checks:
//   1. the column sits right after Gain, in the finder, Suggested and saved heads;
//   2. every finder row has it as two halves, You on top, Him under;
//   3. each half prints a signed tenth, coloured by its sign, and its card says
//      the same week for both halves and adds up: with − now = the printed figure.
// Fails on the code before it (no `td.wkproj`, no head).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const res = spawnSync(process.execPath, [path.join(HERE, 'tr-test.mjs'), 'thisWeek'], {
  encoding: 'utf8', cwd: HERE, maxBuffer: 64 * 1024 * 1024,
});
const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
if (!line) {
  console.log(`FAIL the thisWeek scenario gave no answer (exit ${res.status})`);
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
const num = (s) => Number(String(s).replace('−', '-').replace('+', ''));
const r1 = (n) => Math.round(n * 10) / 10;

ok('boots with no errors', (d.errors || []).length === 0, JSON.stringify(d.errors));

// 1. heads
for (const [name, heads] of [['finder', d.finderHeads], ['Suggested', d.sugHeads], ['saved', d.savedHeads]]) {
  const i = heads.findIndex((h) => /^Gain\b/.test(h));
  ok(`${name}: "This week" is the head right after Gain`, i >= 0 && heads[i + 1] === 'This week', heads.join(' | '));
}

// 2. rows
const rows = d.rows || [];
ok('at least five finder rows', rows.length >= 5, rows.length);
ok('every row has the cell right after Gain', rows.every((r) => r.at > 0 && r.at === r.gainsAt + 1),
  rows.map((r) => `${r.gainsAt}/${r.at}`).join(' '));
ok('You on top, Him under', rows.every((r) => r.mine && r.theirs && r.mine.label === 'You' && r.theirs.label === 'Him'),
  JSON.stringify(rows[0] && [rows[0].mine && rows[0].mine.label, rows[0].theirs && rows[0].theirs.label]));

// 3. figures and cards
const SIGNED = /^([+−]\d+\.\d|0\.0)$/;
let weeks = new Set();
let nonZero = 0;
for (const r of rows) {
  for (const [side, h] of [['you', r.mine], ['him', r.theirs]]) {
    if (!h) continue;
    ok(`${r.key} ${side}: a signed tenth`, SIGNED.test(h.text), h.text);
    const v = num(h.text);
    if (v !== 0) nonZero++;
    const want = v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : '';
    const has = h.cls.split(/\s+/);
    ok(`${r.key} ${side}: green up, red down, plain at zero`,
      want ? has.includes(want) : !has.includes('pos') && !has.includes('neg'), `${h.text} ${h.cls}`);
    const wk = h.card.match(/Week (\d+), projected/);
    if (wk) weeks.add(wk[1]);
    const now = h.card.match(/Lineup now (\d+\.\d)/);
    const withIt = h.card.match(/With the trade (\d+\.\d)/);
    ok(`${r.key} ${side}: its card names the week and adds up (with − now = ${h.text})`,
      !!wk && !!now && !!withIt && r1(Number(withIt[1]) - Number(now[1])) === v && h.card.includes(`Change ${h.text}`),
      h.card);
  }
}
ok('every card names the same week', weeks.size === 1, [...weeks].join(','));
ok('and some figure is not zero (so the arithmetic check means something)', nonZero > 0, nonZero);

if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  FAIL ${f}`);
}
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
