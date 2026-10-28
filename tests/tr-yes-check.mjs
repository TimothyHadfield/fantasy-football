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
// Tim, 2026-10-28: "Also remove the "yes:unlikely" showing in the trade bars".
// The row prints before → after only; the word lives in the goal cell's card.
ok('every row says before → after and nothing else (no yes word, no ±)',
  // Whole-percent chances since trade audit Phase 4 (2026-10-15).
  rows.every((r) => /^\d+% → \d+%$/.test(r.sub) && !r.word && !/±/.test(r.all)),
  rows.map((r) => `${r.sub} [${r.all}]`).slice(0, 3).join(' | '));

// ------------------------------------- 2. the goal card's word is the number
const cardWord = (r) => {
  const m = String(r.goalCard).match(/Chance he says yes (likely|maybe|unlikely) \((\d+)%\)/);
  return m ? { word: m[1], pct: Number(m[2]) } : null;
};
for (const r of rows) {
  const g = cardWord(r);
  ok(`${r.key}: the goal cell's card ends on the word and its %`, !!g && WORD.test(g.word), r.goalCard);
  ok(`${r.key}: that word is the % against the cut-offs`, !!g && wordsFor(g.pct).has(g.word), g && `${g.pct}% ${g.word}`);
}

// ------------------------------------------------- 3/4. pop-up: parts add up, his input is flat
const top = rows.find((r) => r.key === 'f:0') || rows[0];
const dc = readYesCard(d.deal.card);
{
  const sum = Math.round(dc.parts.reduce((a, p) => a + p.v, 0) * 10) / 10;
  ok('the top row\'s yes preview: the parts add up to "In all"',
    dc.parts.length > 0 && dc.inAll !== null && Math.abs(sum - dc.inAll) <= 0.051,
    `${dc.parts.map((p) => p.v).join(', ')} = ${sum} vs ${dc.inAll}`);
  const want = dc.word === 'likely' ? 'pos' : dc.word === 'unlikely' ? 'neg' : '';
  const has = String(d.deal.wordCls).split(/\s+/);
  ok('the pop-up\'s word: likely green, unlikely red, maybe plain',
    want ? has.includes(want) : !has.includes('pos') && !has.includes('neg'), d.deal.wordCls);
}
let differs = 0;
for (const r of rows) {
  const all = String(r.theirCard).match(/ All (\d+) (\d+\.\d) (\d+\.\d) /);
  if (!all) { ok(`${r.key}: his He gains card has its flat "All N" line`, false, r.theirCard.slice(-200)); continue; }
  const flat = (Number(all[3]) - Number(all[2])) / Number(all[1]);
  const shown = num((String(r.their).match(/^([+−]?\d+\.\d)\/wk/) || [])[1]);
  if (Number.isFinite(shown) && Math.abs(shown - flat) >= 0.15) differs++;
  if (r !== top) continue;
  if (Math.abs(flat) < 0.05) {
    ok(`${r.key}: no lineup part when his flat change is ~0`, dc.lineup === null || Math.abs(dc.lineup) <= 0.1, `${dc.lineup} vs ${flat}`);
  } else {
    ok(`${r.key}: "he ${flat < 0 ? 'loses' : 'gains'} X a week" is his FLAT change (${flat.toFixed(2)}), not He gains (${r.their})`,
      dc.lineup !== null && Math.abs(dc.lineup - flat) <= 0.06, `${dc.lineup} vs flat ${flat.toFixed(3)} / shown ${shown}`);
  }
}
ok('on at least one row the flat figure and the printed He gains differ (so the flat check means something)', differs > 0, differs);

// ------------------------------------------------- 5. pop-up and custom box
ok('the pop-up opens', d.deal.open === true);
ok('the pop-up says "he says yes: <word> — <why>", no %',
  /he says yes: (likely|maybe|unlikely) — \S/.test(d.deal.line) && !/\d+% he says yes/.test(d.deal.line), d.deal.line);
ok('the pop-up\'s word and % are the top row\'s (its goal card)', !!top && !!cardWord(top) &&
  d.deal.word === cardWord(top).word && dc.pct === cardWord(top).pct,
  `${d.deal.word} ${dc.pct}% vs ${top && JSON.stringify(cardWord(top))}`);
ok('and its why is the why in the word\'s preview', !!dc.why && d.deal.line.includes(`— ${dc.why}`), `${d.deal.line} / ${dc.why}`);

const cc = readYesCard(d.custom.card);
ok('a custom deal was ticked', d.custom.ticked === true);
ok('the custom box says "Yes: <word> — <why>" under his figure', /^Yes: (likely|maybe|unlikely) — \S/.test(d.custom.yes), d.custom.yes);
ok('its word has a preview with the same word, its parts and the %',
  cc.word === d.custom.word && cc.pct !== null && cc.parts.length > 0 && wordsFor(cc.pct).has(cc.word), d.custom.card);
ok('and its why is the why in that preview', !!cc.why && d.custom.yes.endsWith(`— ${cc.why}`), `${d.custom.yes} / ${cc.why}`);
ok('the sentence under the box no longer prints "NN% he says yes"', !/he says yes|\d+% yes/.test(d.custom.preview), d.custom.preview);

if (fails.length) {
  console.log(`\n${fails.length} FAILED:`);
  for (const f of fails) console.log(`  FAIL ${f}`);
}
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
