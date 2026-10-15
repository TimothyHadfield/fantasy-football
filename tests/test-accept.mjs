// WILL HE SAY YES? — the rebuilt estimate (trade audit Phase 3).
//
//   node test-accept.mjs
//
// Tim, 2026-10-14: "Rebuild, show words". The constants are judgements, so this
// pins DIRECTION and the plan's Done-when, not levels:
//
//   1. an even deal is near 50% (the old curve said 88%)
//   2. the Allen + Charbonnet shape — he loses ~2 a week and receives an RB
//      tagged Out — scores below an even deal and reads unlikely / maybe, with a
//      why naming the injury or the loss
//   3. adding an Out man to his side lowers the chance
//   4. a deal that fills his empty position raises it
//   5. a contender and an out-of-it manager differ the documented way (out of
//      it: less likely)
//   6. ESPN's look reads AVG / LAST / rank, not summed projections
//   7. the words and their cut-offs; null with nothing to go on
//
// The p figures go through js/trade-odds.js `acceptChance` — the number every
// caller on the Trade page reads — so this file fails on the old curve.

import { acceptChance } from '../js/trade-odds.js';
import {
  acceptVerdict, screenValue, packageValue, engagement, LIKELY_AT, UNLIKELY_BELOW,
  INJURED_OUT_PENALTY, HOLE_EMPTY_BONUS, OUT_OF_IT_SHIFT,
} from '../js/accept.js';

let pass = 0;
const fails = [];
const ok = (msg, cond, extra = '') => {
  if (cond) pass++;
  else fails.push(`${msg}${extra !== '' ? ` — ${String(extra).slice(0, 260)}` : ''}`);
};

// Real-looking men (2025-season-like PPR numbers, as ESPN's glance line shows them).
const man = (name, pos, avg, last, rank, status = null, extra = {}) =>
  ({ name, pos, avg, last, rank, proj: avg, status, ...extra });
const ALLEN = man('Josh Allen', 'QB', 21.8, 24.1, 3);
const CHARBONNET = man('Zach Charbonnet', 'RB', 9.6, 11.2, 31, 'OUT');
const HURTS = man('Jalen Hurts', 'QB', 20.9, 18.4, 5);
const PITTMAN = man('Michael Pittman Jr.', 'WR', 12.4, 9.0, 28);
const LAPORTA = man('Sam LaPorta', 'TE', 11.8, 13.0, 6);
const NJOKU = man('David Njoku', 'TE', 9.1, 6.2, 14);
const WR_A = man('WR A', 'WR', 12.0, 12.0, 24);
const WR_B = man('WR B', 'WR', 12.0, 12.0, 25);

const P = (o) => acceptChance(o);

// ------------------------------------------------------------ 1. an even deal
{
  const even = P({ lineupPerWeek: 0, lookPerWeek: 0 });
  ok('an even deal on the numbers alone is 50%, not 88%', Math.abs(even - 0.5) < 0.01, even);
  const swap = P({ lineupPerWeek: 0, gets: [WR_A], sends: [WR_B] });
  ok('a one-for-one swap of two equal 12-a-week starters is near 50% (40–55%)',
    swap > 0.4 && swap < 0.55, swap);
  ok('and it reads "maybe"', acceptVerdict({ lineupPerWeek: 0, gets: [WR_A], sends: [WR_B] }).word === 'maybe');
}

// ------------------------------------------------------------ 2. Allen + Charbonnet
//
// Built like Tim's real offer: the partner receives Allen and Charbonnet (RB,
// tagged Out) for Hurts and Pittman, and his best lineup loses about 2 a week.
{
  const allen = { lineupPerWeek: -2.1, gets: [ALLEN, CHARBONNET], sends: [HURTS, PITTMAN], standing: 0.55 };
  const even = P({ lineupPerWeek: 0, gets: [WR_A], sends: [WR_B], standing: 0.55 });
  const p = P(allen);
  const v = acceptVerdict(allen);
  ok('Allen + Charbonnet scores below an even deal', p < even, `${p} vs ${even}`);
  ok('…and well below the old 73%', p < 0.5, p);
  ok('it reads unlikely or maybe', v.word === 'unlikely' || v.word === 'maybe', v.word);
  ok('its why names the injury or the loss', /injured RB|loses 2/.test(v.why), v.why);
  ok('the why is one short line', v.why.length < 80 && !/\n/.test(v.why), v.why);
}

// ------------------------------------------------------------ 3. an Out man to his side
{
  const base = { lineupPerWeek: 0.5, gets: [WR_A], sends: [WR_B] };
  const hurt = { lineupPerWeek: 0.5, gets: [{ ...WR_A, status: 'OUT' }], sends: [WR_B] };
  const ir = { lineupPerWeek: 0.5, gets: [{ ...WR_A, status: 'INJURY_RESERVE' }], sends: [WR_B] };
  const q = { lineupPerWeek: 0.5, gets: [{ ...WR_A, status: 'QUESTIONABLE' }], sends: [WR_B] };
  ok('the same man tagged Out lowers the chance', P(hurt) < P(base), `${P(hurt)} vs ${P(base)}`);
  ok('IR counts as Out', Math.abs(P(ir) - P(hurt)) < 1e-12);
  ok('Questionable is not discounted (the site never discounts it)', Math.abs(P(q) - P(base)) < 1e-12);
  // Adding an Out man (a throw-in) to his side of an otherwise identical deal.
  const plus = { ...base, gets: [WR_A, man('Hurt RB', 'RB', 8, 0, 40, 'OUT')] };
  ok('adding an Out man to what he receives lowers it, even as a throw-in', P(plus) < P(base),
    `${P(plus)} vs ${P(base)}`);
  ok('…and the why says so', /injured RB/.test(acceptVerdict(plus).why), acceptVerdict(plus).why);
}

// ------------------------------------------------------------ 4. a hole filled
{
  const plain = { lineupPerWeek: 0, gets: [LAPORTA], sends: [WR_B] };
  const need = { lineupPerWeek: 0, gets: [{ ...LAPORTA, fills: 'empty' }], sends: [WR_B] };
  const thin = { lineupPerWeek: 0, gets: [{ ...LAPORTA, fills: 'weak' }], sends: [WR_B] };
  ok('filling his empty TE spot raises the chance', P(need) > P(plain), `${P(need)} vs ${P(plain)}`);
  ok('a thin spot raises it less than an empty one', P(plain) < P(thin) && P(thin) < P(need));
  const v = acceptVerdict({ lineupPerWeek: 1.5, gets: [{ ...LAPORTA, fills: 'empty' }], sends: [NJOKU] });
  ok('a deal that helps him and fills his hole reads likely', v.word === 'likely', `${v.word} ${v.p}`);
  ok('…and the why names a reason for him', /fills his empty TE spot|gains 1\.5|gets more/.test(v.why), v.why);
  const outFill = { lineupPerWeek: 0, gets: [{ ...LAPORTA, fills: 'empty', status: 'OUT' }], sends: [WR_B] };
  ok('an Out man fills no hole', acceptVerdict(outFill).parts.every((x) => x.key !== 'need'));
}

// ------------------------------------------------------------ 5. contender vs out of it
{
  const deal = { lineupPerWeek: 1, gets: [WR_A], sends: [WR_B] };
  const contender = P({ ...deal, standing: 0.8 });
  const out = P({ ...deal, standing: 0.05 });
  const mid = P({ ...deal, standing: 0.3 });
  ok('an out-of-it manager is less likely to accept than a contender', out < contender, `${out} vs ${contender}`);
  ok('…and the middle of the table sits between', out < mid && mid < contender, `${out} ${mid} ${contender}`);
  ok('unknown standing reads as a contender (no shift)', Math.abs(P(deal) - contender) < 1e-12);
  const v = acceptVerdict({ lineupPerWeek: 0, gets: [WR_A], sends: [WR_B], standing: 0.02 });
  ok('the out-of-it why says so when it is the biggest thing', /out of the race/.test(v.why), v.why);
  ok('engagement is 0 out of it, 1 a contender', engagement(0.05) === 0 && engagement(0.9) === 1 && engagement(null) === 1);
}

// ------------------------------------------------------------ 6. the ESPN look
{
  ok('screen value: AVG with a quarter of LAST, plus the rank bonus',
    Math.abs(screenValue({ avg: 20, last: 12, rank: 30 }) - 18) < 1e-12 &&
    Math.abs(screenValue({ avg: 20, last: 12, rank: 4 }) - 19) < 1e-12 &&
    Math.abs(screenValue({ avg: 20, last: 12, rank: 10 }) - 18.5) < 1e-12);
  ok('no games: his PROJ stands in', screenValue({ avg: null, proj: 9, rank: null }) === 9);
  ok('nothing at all: null', screenValue({}) === null);
  ok('two-for-one: the second man counts half', Math.abs(packageValue([{ avg: 10 }, { avg: 16 }]) - 21) < 1e-12);
  // A hot LAST game makes the same man look better — recency.
  const cold = P({ lineupPerWeek: 0, gets: [man('X', 'WR', 12, 4, 30)], sends: [WR_B] });
  const hot = P({ lineupPerWeek: 0, gets: [man('X', 'WR', 12, 25, 30)], sends: [WR_B] });
  ok('a big LAST game for the man he gets raises the chance', hot > cold, `${hot} vs ${cold}`);
  // Men carry values: the passed-in projection look is ignored.
  ok('with screen values on the men, a summed-projection look is not used',
    Math.abs(P({ lineupPerWeek: 0, lookPerWeek: -9, gets: [WR_A], sends: [WR_B] }) -
      P({ lineupPerWeek: 0, gets: [WR_A], sends: [WR_B] })) < 1e-12);
}

// ------------------------------------------------------------ 7. words, monotone, null
{
  ok('cut-offs as documented', LIKELY_AT === 0.6 && UNLIKELY_BELOW === 0.35);
  const ladder = [-6, -3, -1, 0, 1, 3, 6].map((x) => P({ lineupPerWeek: x, lookPerWeek: x }));
  ok('it never goes up as the deal gets worse for him', ladder.every((p, i) => i === 0 || p > ladder[i - 1]),
    ladder.map((p) => p.toFixed(3)).join(' '));
  const w = (x) => acceptVerdict({ lineupPerWeek: x, lookPerWeek: x }).word;
  ok('+3/+3 likely, 0 maybe, −3/−3 unlikely', w(3) === 'likely' && w(0) === 'maybe' && w(-3) === 'unlikely',
    `${w(3)} ${w(0)} ${w(-3)}`);
  ok('with nothing to go on it says nothing', acceptChance({}) === null && acceptVerdict({}) === null);
  ok('an even deal\'s why says so', acceptVerdict({ lineupPerWeek: 0, lookPerWeek: 0 }).why === 'about even for him');
  ok('the penalties are the ones documented', INJURED_OUT_PENALTY === 3 && HOLE_EMPTY_BONUS === 1.5 && OUT_OF_IT_SHIFT === 0.75);
}

// ------------------------------------------------------------ sample outputs (for the report)
if (process.argv.includes('--samples')) {
  const show = (label, o) => { const v = acceptVerdict(o); console.log(`${label}: ${(v.p * 100).toFixed(0)}% ${v.word} — ${v.why}`); };
  show('Allen + Charbonnet for Hurts + Pittman, he loses 2.1/wk', { lineupPerWeek: -2.1, gets: [ALLEN, CHARBONNET], sends: [HURTS, PITTMAN], standing: 0.55 });
  show('WR for WR, even', { lineupPerWeek: 0, gets: [WR_A], sends: [WR_B], standing: 0.55 });
  show('LaPorta for Njoku, fills his empty TE, +1.5/wk', { lineupPerWeek: 1.5, gets: [{ ...LAPORTA, fills: 'empty' }], sends: [NJOKU], standing: 0.6 });
  show('2-for-1: Pittman + Njoku for Hurts, he gains 0.8/wk, out of it', { lineupPerWeek: 0.8, gets: [PITTMAN, NJOKU], sends: [HURTS], standing: 0.08 });
}

console.log(`test-accept: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
console.log(`ASSERTIONS ${pass + fails.length}`);
if (fails.length) process.exit(1);
