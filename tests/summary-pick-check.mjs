// The Summary page's Chance column: which of Bye % / Playoff % / Loser % a
// manager's row shows.
//
//   node summary-pick-check.mjs
//
// Tim, 2026-11-10 (standing rule): "from now on for fantasy summary I want the
// columns to be record, luck, title, and then the most relevant % for that
// player (either bye, playoff, or loser). this means for users who have a 98%
// for playoffs, BYE will be shown. if you have 5% playoff and 29% loser, loser
// will be shown."
//
// Rule (js/summary-table.js `relevantChance`): Playoff % ≥ 90 -> Bye; ≤ 10 ->
// Loser; otherwise Playoff; a missing Bye/Loser falls back to Playoff; once
// every figure is settled (0/100%), the outcome is shown.
//
// Part 2 draws rows with `summaryRowsHtml(..., { pick: true })` and checks the
// cells: column order, the tag, data-pick, and that `pick` off leaves Loser %.

import { moduleUrl } from './repo.mjs';

let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`);
};
const eq = (a, b, msg) => ok(msg, Object.is(a, b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const mod = await import(moduleUrl('js/summary-table.js'));
const { relevantChance, summaryRowsHtml, PICK_KINDS } = mod;
ok('summary-table.js exports relevantChance', typeof relevantChance === 'function');
ok('and PICK_KINDS with a tag per kind',
  !!PICK_KINDS && PICK_KINDS.bye?.tag === 'BYE' && PICK_KINDS.playoffs?.tag === 'PLAYOFF' && PICK_KINDS.last?.tag === 'LOSER',
  JSON.stringify(PICK_KINDS));

const pick = (r) => (typeof relevantChance === 'function' ? relevantChance(r) : undefined);
const kind = (r) => pick(r)?.kind ?? null;

// ---- Tim's two examples (rule: Playoff ≥ 90% -> Bye, ≤ 10% -> Loser, else Playoff)
eq(kind({ playoffs: 0.98, bye: 0.61, last: 0 }), 'bye', "Tim's example 1: 98% playoffs shows BYE");
eq(kind({ playoffs: 0.98, bye: 0.02, last: 0.001 }), 'bye', '98% playoffs with a 2% bye still shows BYE');
eq(pick({ playoffs: 0.98, bye: 0.02, last: 0.001 })?.p, 0.02, 'and the figure shown is the bye chance itself');
eq(kind({ playoffs: 0.94, bye: 0.06, last: 0 }), 'bye', '94% playoffs with a 6% bye shows BYE (the demo Nolan case)');
eq(kind({ playoffs: 0.05, bye: 0.001, last: 0.29 }), 'last', "Tim's example 2: 5% playoffs and 29% loser shows LOSER");
eq(pick({ playoffs: 0.05, bye: 0.001, last: 0.29 })?.p, 0.29, 'and the figure shown is the loser chance itself');
eq(kind({ playoffs: 0.05, bye: 0, last: 0.01 }), 'last', '5% playoffs with only a 1% loser still shows LOSER');
eq(kind({ playoffs: 0.55, bye: 0.12, last: 0.02 }), 'playoffs', 'a bubble team shows PLAYOFF');
eq(kind({ playoffs: 0.30, bye: 0.01, last: 0.45 }), 'playoffs', '30% playoffs shows PLAYOFF however high the loser chance');

// ---- the 90 / 10 edges ------------------------------------------------------------
eq(kind({ playoffs: 0.90, bye: 0.40, last: 0 }), 'bye', 'exactly 90% playoffs -> BYE');
eq(kind({ playoffs: 0.8999, bye: 0.40, last: 0 }), 'playoffs', 'just under 90% -> PLAYOFF');
eq(kind({ playoffs: 0.10, bye: 0, last: 0.2 }), 'last', 'exactly 10% playoffs -> LOSER');
eq(kind({ playoffs: 0.1001, bye: 0, last: 0.2 }), 'playoffs', 'just over 10% -> PLAYOFF');
eq(kind({ playoffs: 0.995, bye: 0.5, last: 0 }), 'bye', '99.5% (prints 100%) -> BYE');

// ---- missing figures fall back to Playoff ---------------------------------------------
eq(kind({ playoffs: 0.98, bye: null, last: 0 }), 'playoffs', 'no Bye % (no byes): 98% playoffs shows PLAYOFF');
eq(kind({ playoffs: 0.04, bye: 0, last: null }), 'playoffs', 'no Loser %: 4% playoffs shows PLAYOFF');
eq(kind({ playoffs: null, bye: null, last: 0.3 }), 'last', 'no bracket: only Loser % is left');
eq(kind({ playoffs: 0.95, last: 0.01 }), 'playoffs', 'an absent key counts as missing');
eq(kind({ playoffs: NaN, bye: undefined, last: 0.2 }), 'last', 'NaN and undefined count as missing');
eq(pick({ playoffs: null, bye: null, last: null }), null, 'nothing at all gives null');
eq(pick(null), null, 'and no row gives null rather than throwing');

// ---- settled (regular season over, or clinched) -> the outcome -------------------
eq(kind({ playoffs: 1, bye: 1, last: 0 }), 'bye', 'season over, got a bye -> BYE');
eq(pick({ playoffs: 1, bye: 1, last: 0 })?.p, 1, 'at 100%');
eq(kind({ playoffs: 1, bye: 0, last: 0 }), 'playoffs', 'season over, made it without a bye -> PLAYOFF 100%');
eq(kind({ playoffs: 0, bye: 0, last: 1 }), 'last', 'season over, finished last -> LOSER 100%');
const out = pick({ playoffs: 0, bye: 0, last: 0 });
eq(out?.kind, 'playoffs', 'season over, missed out but not last -> PLAYOFF');
eq(out?.p, 0, 'at 0%');
eq(kind({ playoffs: null, bye: null, last: 1 }), 'last', 'no bracket, finished last -> LOSER');
eq(kind({ playoffs: null, bye: null, last: 0 }), 'last', 'no bracket, not last -> LOSER 0% (the only figure)');
// Not all settled: the 90/10 rule still runs.
eq(kind({ playoffs: 1, bye: 0.97, last: 0 }), 'bye', 'clinched playoffs, bye nearly sure -> BYE');

// ---- the rows ------------------------------------------------------------------
if (typeof summaryRowsHtml === 'function') {
  const rows = [
    { id: 1, name: 'Ann', teamName: 'A', record: { w: 7, l: 1, t: 0 }, rec: { text: '7-1', wins: 7 },
      luck: 3.2, luckMargin: 4, title: 0.31, last: 0, playoffs: 0.98, bye: 0.61 },
    { id: 2, name: 'Bo', teamName: 'B', record: { w: 1, l: 7, t: 0 }, rec: { text: '1-7', wins: 1 },
      luck: -2.1, luckMargin: 4, title: 0.002, last: 0.29, playoffs: 0.05, bye: 0.001 },
    { id: 3, name: 'Cy', teamName: 'C', record: { w: 4, l: 4, t: 0 }, rec: { text: '4-4', wins: 4 },
      luck: 0.4, luckMargin: 4, title: 0.08, last: 0.04, playoffs: 0.52, bye: 0.05 },
    { id: 4, name: 'Di', teamName: 'D', record: null, rec: null,
      luck: null, luckMargin: null, title: null, last: null, playoffs: null, bye: null },
  ];
  const html = summaryRowsHtml(rows, { pick: true });
  const trs = html.split('<tr').slice(1);
  eq(trs.length, 4, 'one row per manager');
  const cells = (tr) => tr.split('<td').slice(1);
  ok('five cells a row (Member, Record, LUCK, Title %, Chance)', trs.every((tr) => cells(tr).length === 5),
    trs.map((tr) => cells(tr).length).join(','));
  const last = (tr) => cells(tr)[4];
  ok("Ann's last cell is tagged BYE with her 61%", /data-pick="bye"/.test(last(trs[0])) &&
    /<span class="pick-tag">BYE<\/span> 61%/.test(last(trs[0])), last(trs[0]));
  ok("Bo's last cell is tagged LOSER with 29%", /data-pick="last"/.test(last(trs[1])) &&
    /<span class="pick-tag">LOSER<\/span> 29%/.test(last(trs[1])), last(trs[1]));
  ok("Cy's last cell is tagged PLAYOFF with 52%", /data-pick="playoffs"/.test(last(trs[2])) &&
    /<span class="pick-tag">PLAYOFF<\/span> 52%/.test(last(trs[2])), last(trs[2]));
  ok("the cell's data-v is the figure shown (sorts on it)", /data-v="0\.61"/.test(last(trs[0])), last(trs[0]));
  ok('a row with no figures shows a dash and no tag', !/pick-tag/.test(last(trs[3])) && /—/.test(last(trs[3])),
    last(trs[3]));
  ok('the title cell is still the fourth cell', /data-v="0\.31"/.test(cells(trs[0])[3]), cells(trs[0])[3]);
  // A LOSER cell is shaded on the inverted Loser scale: Bo has the highest, so red.
  ok('the LOSER cell is shaded red (the inverted scale)', /heat-dn-/.test(last(trs[1])), last(trs[1]));
  // Waiting for the simulation: "…", not a dash.
  const waiting = summaryRowsHtml([rows[3]], { pick: true, waiting: true });
  ok('a row still waiting on the simulation shows …', /…/.test(waiting.split('<td').slice(1)[4] || ''), waiting);
  // Off by default (the Decisions review): the fifth cell is Loser % as before.
  const plain = summaryRowsHtml(rows, {});
  ok('without pick the fifth cell is Loser % (no tag)', !/pick-tag|data-pick/.test(plain) &&
    /data-v="0\.29"/.test(plain.split('<tr').slice(1)[1].split('<td').slice(1)[4]), plain.slice(0, 400));
  // The card hook is `pick`.
  const carded = summaryRowsHtml(rows, { pick: true, cards: { pick: (r) => ` data-pop="pick:${r.id}"` } });
  ok('the Chance cell carries the `pick` card', /data-pop="pick:1"[^>]*data-pick|data-pick="bye"[^>]*data-pop="pick:1"|data-pop="pick:1"/.test(carded) &&
    /data-pick="bye"/.test(carded.split('<tr').slice(1)[0].split('<td').slice(1)[4]) &&
    /data-pop="pick:1"/.test(carded.split('<tr').slice(1)[0].split('<td').slice(1)[4]), carded.slice(0, 600));
} else {
  ok('summaryRowsHtml exists', false);
}

const total = pass + fails.length;
if (fails.length) {
  console.log(`${pass} passed, ${fails.length} failed`);
  for (const f of fails) console.log(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`All ${total} assertions passed`);
