// The Trade page's Chance cell, you over them (Tim, 2026-11-10: "In the trade
// setion, instead of having the chance be shown of your chance of winning and
// your chance of loosing change, if your win it all is selected, do your
// chance to win it all change vs his chance to win it all change, and if don't
// lose is selected, do the same with yours and their change in chance to
// lose") — and "Make all language reffering to other users non-binary".
//
//   node tr-them-check.mjs
//
// Drives tr-test.mjs's `chanceThem` scenario (the real trade.html and
// js/trade-page.js on the demo league, in a child process), under the goal the
// page opens on and then the other one, and checks:
//   1. every finder row's Chance cell is two halves, "You" (the ranked goal
//      cell) over "Them" (the other manager's chance at the SAME goal); the old
//      other-goal preview is gone;
//   2. "Them" prints before → after and a whole-percent change that is the
//      difference of those two printed ends (round first, then sign), coloured
//      by what is good for them under that goal;
//   3. its before → after is the very line the "You" card gives for the other
//      manager (one simulated run, not a second one), and its own card says so;
//   4. no split cell anywhere is labelled "Him"; the lower halves say "Them".
// Fails on the code before it (First / Last halves, both yours).

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const res = spawnSync(process.execPath, [path.join(HERE, 'tr-test.mjs'), 'chanceThem'], {
  encoding: 'utf8', cwd: HERE, maxBuffer: 64 * 1024 * 1024,
});
const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
if (!line) {
  console.log(`FAIL the chanceThem scenario gave no answer (exit ${res.status})`);
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
const SUB = /^(\d+)% → (\d+)%$/;
const CHANGE = /^([+−])?(\d+)%$/;
const signedPct = (n) => (n > 0 ? `+${n}%` : n < 0 ? `−${-n}%` : '0%');

ok('boots with no errors', (d.errors || []).length === 0, JSON.stringify(d.errors));
ok('the goal switched', d.first && d.second && d.first.goal && d.second.goal && d.first.goal !== d.second.goal,
  `${d.first && d.first.goal} → ${d.second && d.second.goal}`);

let moved = 0;
for (const run of [d.first, d.second].filter(Boolean)) {
  const g = run.goal;
  const up = g === 'title';
  ok(`${g}: at least three finder rows`, run.rows.length >= 3, run.rows.length);
  ok(`${g}: no other-goal preview cell left on the page`, run.altCells === 0, run.altCells);
  for (const r of run.rows) {
    const [you, them] = r.halves;
    ok(`${g} ${r.key}: two halves, You over Them`,
      r.halves.length === 2 && you && them && you.label === 'You' && them.label === 'Them',
      JSON.stringify(r.halves.map((h) => h && h.label)));
    if (!you || !them) continue;
    ok(`${g} ${r.key}: You is the ranked goal cell, Them its own`,
      /\bgoal-cell\b/.test(you.cls) && you.rc === 'goal' && /\btheir-goal-cell\b/.test(them.cls) && them.rc === 'goalt',
      `${you.cls} / ${them.cls}`);
    const m = them.sub.match(SUB);
    const c = them.head.match(CHANGE);
    ok(`${g} ${r.key}: Them prints a whole-percent change over before → after`, !!m && !!c, `${them.head} | ${them.sub}`);
    if (!m || !c) continue;
    const diff = Number(m[2]) - Number(m[1]);
    ok(`${g} ${r.key}: Them's change is its printed ends subtracted`, them.head === signedPct(diff), `${them.head} vs ${them.sub}`);
    if (diff !== 0) moved++;
    const good = up ? diff > 0 : diff < 0;
    const bad = up ? diff < 0 : diff > 0;
    const has = them.cls.split(/\s+/);
    ok(`${g} ${r.key}: coloured by what is good for them under this goal`,
      good ? has.includes('pos') && !has.includes('neg') : bad ? has.includes('neg') && !has.includes('pos')
        : !has.includes('pos') && !has.includes('neg'), `${them.head} ${them.cls}`);
    // The "You" card's line for the other manager: "<name> now → with a% → b%".
    ok(`${g} ${r.key}: the same before → after as the You card gives for ${r.partner}`,
      you.card.includes(`${r.partner} now → with ${them.sub}`), `${them.sub} | ${you.card}`);
    ok(`${g} ${r.key}: Them's own card names them and the same line`,
      them.card.includes(r.partner) && them.card.includes(them.sub) && /chance/i.test(them.card), them.card);
  }
  ok(`${g}: no split cell labelled Him`, !run.labelsAll.includes('Him'), [...new Set(run.labelsAll)].join(','));
  ok(`${g}: every lower half says Them`, run.rows.every((r) => {
    const l = r.labels;
    return l.length >= 6 && l.every((x, i) => (i % 2 === 0 ? x === 'You' : x === 'Them'));
  }), JSON.stringify(run.rows[0] && run.rows[0].labels));
}
ok('some Them figure is not 0% (so the arithmetic checks mean something)', moved > 0, moved);

if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  FAIL ${f}`);
}
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
