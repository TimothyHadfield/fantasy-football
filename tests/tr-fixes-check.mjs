// Trade page: three small fixes from the 2026-10-16 sweep, checked on the real
// trade.html and js/trade-page.js (demo league) through tr-test.mjs's
// `trFixes` scenario, in a child process.
//
//   node tr-fixes-check.mjs
//
//   row 5   "Ask AI": the offers behind the buttons are let go on every repaint,
//           as the ESPN links' are, so a key from an earlier paint copies nothing
//           (the map used to grow for the life of the tab).
//   row 15  Closing the pop-up puts focus back on what opened it, not <body>
//           (the custom box's Week by week button since the Best combo went,
//           2026-10-18).
//   row 16  Enter on a saved custom trade does what a click does.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const res = spawnSync(process.execPath, [path.join(HERE, 'tr-test.mjs'), 'trFixes'], {
  encoding: 'utf8', cwd: HERE, maxBuffer: 64 * 1024 * 1024,
});
const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
if (!line) {
  console.log(`FAIL the trFixes scenario gave no answer (exit ${res.status})`);
  console.log(String(res.stderr || '').trimEnd().split('\n').slice(-8).join('\n'));
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}
const d = JSON.parse(line.slice(2));
if (d.boot) {
  console.log(`FAIL the scenario threw: ${String(d.boot).slice(0, 600)}`);
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fails.push(name); console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`); }
};

ok('boots with no errors', (d.errors || []).length === 0, JSON.stringify(d.errors));

// row 5
ok('the finder drew an Ask AI button', typeof d.oldKey === 'string' && d.oldKey.length > 0, d.oldKey);
ok('after a repaint its key is no longer on the page', d.oldKeyInPage === false);
ok('ROW 5: A KEY FROM AN EARLIER PAINT COPIES NOTHING (the map was cleared)', d.staleCopied === false, d.staleCopied);
ok('and a button drawn by this paint still copies', d.liveCopied === true, d.liveCopied);

// row 15
ok('the custom box\'s Week by week button is there to open the pop-up', d.headKey === 'cu-build', d.headKey);
ok('it opened and closed', d.opened === true && d.closed === true, JSON.stringify([d.opened, d.closed]));
ok('ROW 15: CLOSING PUTS FOCUS BACK ON THE BUTTON THAT OPENED IT',
  !!d.focusBack && d.focusBack.id === 'cuOpen' && d.focusBack.key === d.headKey, JSON.stringify(d.focusBack));

// row 16
ok('a one-for-one deal was saved and the ticks cleared',
  d.saved && d.saved.rows >= 1 && d.saved.ticks.every(Boolean) && d.saved.tickedAfterSave.length === 0, JSON.stringify(d.saved));
ok('ROW 16: ENTER ON A SAVED ROW LOADS IT INTO THE BOX, AS A CLICK DOES',
  d.enter && JSON.stringify(d.enter.tickedAfterEnter) === JSON.stringify(d.enter.want), JSON.stringify(d.enter));

console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
