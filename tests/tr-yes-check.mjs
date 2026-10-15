// Will he say yes, as WORDS on the Trade page (trade audit Phase 3, wave 2).
//
//   node tr-yes-check.mjs
//
// Tim, 2026-10-14, asked "Rebuild 'chance he accepts' around what he sees on
// ESPN, starting near 50% for an even deal, and show it as words (likely /
// maybe / unlikely) with a one-line why?": "Rebuild, show words".
//
// Drives tr-test.mjs's `yesWords` scenario (the real trade.html and
// js/trade-page.js on the demo league, "Win it all", in a child process) and
// checks what it read back:
//
//   1. every scored finder row prints a word where "62% yes" was, never a %;
//   2. the word is the percentage in its preview against js/accept.js's
//      cut-offs (likely at 60% or more, unlikely below 35%), green / red / plain;
//   3. the word's preview lists the parts, which ADD UP to "In all", and ends
//      on the word and its percentage — as the goal cell's own card does;
//   4. HIS LINEUP INPUT IS FLAT: the part "he loses / gains X a week" is his
//      unweighted change over the span (the "All N" line of his He gains card),
//      not the reach-weighted, netted figure the row prints as He gains — and
//      on at least one row the two differ, so the check can fail;
//   5. the pop-up and the custom box print the word with its one-line why;
//   6. the packing's line prints a word too.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIKELY_AT, UNLIKELY_BELOW } from '../js/accept.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const res = spawnSync(process.execPath, [path.join(HERE, 'tr-test.mjs'), 'yesWords'], {
  encoding: 'utf8', cwd: HERE, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, TR_GOAL: 'title' },
});
const line = (res.stdout || '').split('\n').find((l) => l.startsWith('@@'));
if (!line) {
  console.log(`FAIL the yesWords scenario gave no answer (exit ${res.status})`);
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
const num = (s) => Number(String(s).replace('−', '-'));
const WORD = /^(likely|maybe|unlikely)$/;

/** What a yes card says: its parts, "In all", the word and the %, its why. */
function readYesCard(card) {
  const c = String(card || '');
  const body = c.slice(0, c.indexOf(' In all '));
  // A part's value is signed ("+0.4", "−1.4") or a plain rounded "0.0"; the
  // figure inside a label ("He loses 1.3 a week") never carries a sign.
  const parts = [...`${body} `.matchAll(/ ([+−]\d+\.\d|0\.0)(?= )/g)].map((m) => ({ v: num(m[1]) }));
  const all = c.match(/ In all ([+−]?\d+\.\d) /);
  const end = c.match(/Chance he says yes (likely|maybe|unlikely) \((\d+)%\)/);
  const lineup = c.match(/ He (loses|gains) (\d+(?:\.\d)?) a week /);
  const why = c.match(/ Mostly: (.*)\.$/);
  return {
    parts, inAll: all ? num(all[1]) : null, word: end ? end[1] : null, pct: end ? Number(end[2]) : null,
    lineup: lineup ? (lineup[1] === 'loses' ? -1 : 1) * Number(lineup[2]) : null, why: why ? why[1] : null,
  };
}
/** The word the cut-offs give a whole percentage (either side of a cut-off it was rounded onto). */
const wordsFor = (pct) => {
  const at = (p) => (p >= LIKELY_AT ? 'likely' : p < UNLIKELY_BELOW ? 'unlikely' : 'maybe');
  return new Set([at((pct - 0.5) / 100), at((pct + 0.49) / 100)]);
};

// ------------------------------------------------------------------ 0. booted
ok('boots with no errors', (d.errors || []).length === 0, JSON.stringify(d.errors));
ok('the page is on "Win it all" (his playoff weeks are reach-weighted)', d.goalOn === 'Win it all', d.goalOn);

// ------------------------------------------------------------- 1. the rows
const rows = (d.rows || []).filter((r) => r.sub);
ok('at least five finder rows carry a goal figure', rows.length >= 5, rows.length);
ok('no row prints the chance as "NN% yes"', rows.every((r) => !/\d+% yes/.test(r.sub) && !/%\s*yes/.test(r.sub)),
  rows.map((r) => r.sub).slice(0, 3).join(' | '));
ok('every row says before → after and then the word',
  // Whole-percent chances since trade audit Phase 4 (2026-10-15).
  rows.every((r) => /^\d+% → \d+% · yes: (likely|maybe|unlikely)$/.test(r.sub)),
  rows.map((r) => r.sub).slice(0, 3).join(' | '));

// ------------------------------------------------- 2. the word is the number
for (const r of rows) {
  const c = readYesCard(r.card);
  ok(`${r.key}: the word has a preview ending on the word and its %`, WORD.test(r.word) && c.word === r.word && c.pct !== null,
    `${r.word} / ${r.card}`);
  ok(`${r.key}: the word is the % against the cut-offs (${c.pct}% → ${r.word})`, c.pct !== null && wordsFor(c.pct).has(r.word),
    `${c.pct}% ${r.word}`);
  const want = r.word === 'likely' ? 'pos' : r.word === 'unlikely' ? 'neg' : '';
  const has = String(r.wordCls).split(/\s+/);
  ok(`${r.key}: likely green, unlikely red, maybe plain`,
    want ? has.includes(want) : !has.includes('pos') && !has.includes('neg'), r.wordCls);
  // ------------------------------------------------ 3. the parts add up
  const sum = Math.round(c.parts.reduce((a, p) => a + p.v, 0) * 10) / 10;
  ok(`${r.key}: the parts add up to "In all"`, c.parts.length > 0 && c.inAll !== null && Math.abs(sum - c.inAll) <= 0.051,
    `${c.parts.map((p) => p.v).join(', ')} = ${sum} vs ${c.inAll}`);
  ok(`${r.key}: the goal cell's own card says the same word and %`,
    r.goalCard.includes(`Chance he says yes ${r.word} (${c.pct}%)`), r.goalCard);
}

// ------------------------------------------------- 4. his input is flat
let differs = 0;
for (const r of rows) {
  const c = readYesCard(r.card);
  const all = String(r.theirCard).match(/ All (\d+) (\d+\.\d) (\d+\.\d) /);
  if (!all) { ok(`${r.key}: his He gains card has its flat "All N" line`, false, r.theirCard.slice(-200)); continue; }
  const flat = (Number(all[3]) - Number(all[2])) / Number(all[1]);
  const shown = num((String(r.their).match(/^([+−]?\d+\.\d)\/wk/) || [])[1]);
  if (Number.isFinite(shown) && Math.abs(shown - flat) >= 0.15) differs++;
  if (Math.abs(flat) < 0.05) {
    ok(`${r.key}: no lineup part when his flat change is ~0`, c.lineup === null || Math.abs(c.lineup) <= 0.1, `${c.lineup} vs ${flat}`);
  } else {
    ok(`${r.key}: "he ${flat < 0 ? 'loses' : 'gains'} X a week" is his FLAT change (${flat.toFixed(2)}), not He gains (${r.their})`,
      c.lineup !== null && Math.abs(c.lineup - flat) <= 0.06, `${c.lineup} vs flat ${flat.toFixed(3)} / shown ${shown}`);
  }
}
ok('on at least one row the flat figure and the printed He gains differ (so the check above can fail)', differs > 0, differs);

// ------------------------------------------------- 5. pop-up and custom box
const top = rows.find((r) => r.key === 'f:0') || rows[0];
const dc = readYesCard(d.deal.card);
ok('the pop-up opens', d.deal.open === true);
ok('the pop-up says "he says yes: <word> — <why>", no %',
  /he says yes: (likely|maybe|unlikely) — \S/.test(d.deal.line) && !/\d+% he says yes/.test(d.deal.line), d.deal.line);
ok('the pop-up\'s word and % are the top row\'s', top && d.deal.word === top.word && dc.pct === readYesCard(top.card).pct,
  `${d.deal.word} ${dc.pct}% vs ${top && top.word} ${top && readYesCard(top.card).pct}%`);
ok('and its why is the why in the word\'s preview', !!dc.why && d.deal.line.includes(`— ${dc.why}`), `${d.deal.line} / ${dc.why}`);

const cc = readYesCard(d.custom.card);
ok('a custom deal was ticked', d.custom.ticked === true);
ok('the custom box says "Yes: <word> — <why>" under his figure', /^Yes: (likely|maybe|unlikely) — \S/.test(d.custom.yes), d.custom.yes);
ok('its word has a preview with the same word, its parts and the %',
  cc.word === d.custom.word && cc.pct !== null && cc.parts.length > 0 && wordsFor(cc.pct).has(cc.word), d.custom.card);
ok('and its why is the why in that preview', !!cc.why && d.custom.yes.endsWith(`— ${cc.why}`), `${d.custom.yes} / ${cc.why}`);
ok('the sentence under the box no longer prints "NN% he says yes"', !/he says yes|\d+% yes/.test(d.custom.preview), d.custom.preview);

// ------------------------------------------------------------- 6. the packing
ok('the packing\'s line prints a word, not a %',
  /say yes: (likely|maybe|unlikely)|· yes: (likely|maybe|unlikely)/.test(d.comboGoal) && !/yes: \d+%|\d+% yes/.test(d.comboGoal),
  d.comboGoal);
ok('and its preview names each manager and the chance they all say yes',
  /^Will (they|he) say yes\?/.test(d.comboCard) && (/All of them (likely|maybe|unlikely) \(\d+%\)/.test(d.comboCard) ||
    /Chance he says yes (likely|maybe|unlikely) \(\d+%\)/.test(d.comboCard)), d.comboCard);

if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  FAIL ${f}`);
}
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
