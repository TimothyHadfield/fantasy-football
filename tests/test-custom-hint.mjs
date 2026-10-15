// THE CUSTOM BOX'S ORANGE / RED BOXES AND EACH SIDE'S NEEDS —
// js/custom-hint.js and js/slot-needs.js.
//
//   node test-custom-hint.mjs
//
// Tim, 2026-10-15: "if there is a single player I can click on on either team
// that will make it so that the value is positive, the +/week for me is between
// +1 and +4, and the total is between 0 - +5, then fill that player's box in
// orange. Make sure it's not a player who's worth isn't 0 … If the current
// trade numbers are already in that range, keep the trade the same." / "don't
// highlight a player's box in orange if it's a player that was traded between
// those two teams already. Instead highlight that player's box in red." /
// "Show the position that each user needs in the custom trade section … Don't
// include K or DEF."

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const load = (f) => import(pathToFileURL(path.join(REPO, f)).href);
const { hintInRange, customHints, hintSteps } = await load('js/custom-hint.js');
const { slotAverages, positionNeeds, NEED_POSITIONS } = await load('js/slot-needs.js');

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ------------------------------------------------------------- the range rule
ok(hintInRange({ value: 0.4, myWeek: 2.1, total: 3.0 }), 'a deal inside every range is in range');
ok(hintInRange({ value: 0.1, myWeek: 1.0, total: 0 }), 'the low ends are inside (Value just over 0, +1.0/wk, Total 0)');
ok(hintInRange({ value: 6, myWeek: 4.0, total: 5.0 }), 'the high ends are inside (+4.0/wk, Total +5.0)');
ok(!hintInRange({ value: 0, myWeek: 2, total: 2 }), 'Value 0 is not positive');
ok(!hintInRange({ value: -1.2, myWeek: 2, total: 2 }), 'Value down is out');
ok(!hintInRange({ value: 1, myWeek: 0.9, total: 2 }), '+0.9/wk is under +1');
ok(!hintInRange({ value: 1, myWeek: 4.1, total: 2 }), '+4.1/wk is over +4');
ok(!hintInRange({ value: 1, myWeek: 2, total: -0.1 }), 'Total −0.1 is under 0');
ok(!hintInRange({ value: 1, myWeek: 2, total: 5.1 }), 'Total +5.1 is over +5');
ok(hintInRange({ value: 1, myWeek: 0.96, total: 5.04 }), 'compared as printed: +0.96 prints +1.0, +5.04 prints +5.0');
ok(!hintInRange({ value: 1, myWeek: 2, total: null }), 'no Total (no Appeal) is not in range');
ok(!hintInRange({ value: null, myWeek: 2, total: 2 }), 'no Values read is not in range');
ok(!hintInRange(null), 'no figures, no range');

// ---------------------------------------------------- the hint over two lists
// Two 16-man rosters (ids a1..a16, b1..b16), as the box lists them. You have
// ticked a3 for b5. The figures each extra man would give are made up per man.
const men = [
  ...Array.from({ length: 16 }, (_, i) => ({ id: `a${i + 1}`, side: 'a' })),
  ...Array.from({ length: 16 }, (_, i) => ({ id: `b${i + 1}`, side: 'b' })),
];
const ticked = ['a3', 'b5'];
const outOfRange = { value: -2, myWeek: -0.5, total: -3 };
const inRange = { value: 1.5, myWeek: 2.4, total: 2.2 };
const VALUES = Object.fromEntries(men.map((m, i) => [m.id, 3 + (i % 5)]));
VALUES.b9 = 0;          // filler: lands in range only because he moves nothing
VALUES.a12 = null;      // a man with no Value at all
const WITH = { b2: inRange, a7: inRange, b9: inRange, a12: inRange, b11: inRange, a14: { ...inRange, total: 5.3 } };
const barredIds = new Set(['b11', 'a3']);   // b11 you sent him earlier; a3 you got from him (and have ticked)
const base = {
  men,
  ticked,
  barred: (m) => barredIds.has(m.id),
  valueOf: (id) => VALUES[id],
  current: outOfRange,
  figuresWith: (m) => WITH[m.id] || outOfRange,
};
const r = customHints(base);
const list = (s) => [...s].sort().join(',');
ok(list(r.orange) === 'a7,b2', 'orange: the two men who each land the deal in range, on either list', list(r.orange));
ok(!r.orange.has('b9'), 'NOT a man whose Value is 0 (he keeps the numbers, he does not improve the deal)');
ok(!r.orange.has('a12'), 'NOT a man with no Value');
ok(!r.orange.has('a14'), 'NOT a man who leaves the Total over +5');
ok(!r.orange.has('b11') && r.red.has('b11'), 'a man traded between these two already is RED, never orange');
ok(r.red.has('a3'), 'red too when he is already ticked — he is marked so he can be seen');
ok(list(r.red) === 'a3,b11', 'red is exactly the men traded between the two', list(r.red));

const already = customHints({ ...base, current: { value: 0.5, myWeek: 1.4, total: 1.0 } });
ok(already.orange.size === 0, 'the deal as ticked is already in range: no orange ("keep the trade the same")');
ok(list(already.red) === 'a3,b11', 'and the red marks stay');

const none = customHints({ ...base, ticked: [], current: null });
ok(none.orange.size === 0, 'nothing ticked: no orange');
ok(none.red.size === 2, 'nothing ticked: the red marks still show');

// It prices only the men it has to, one per step, so the page can slice it.
let priced = 0;
const it = hintSteps({ ...base, figuresWith: (m) => { priced++; return base.figuresWith(m); } });
let steps = 0;
let res;
for (;;) { const s = it.next(); if (s.done) { res = s.value; break; } steps++; }
// 32 men − 2 ticked − 1 more barred (b11) − b9 (Value 0) − a12 (no Value) = 27
ok(priced === 27 && steps === 27, 'each unticked, unbarred man with a Value is priced once, one per step', `${priced} priced, ${steps} steps`);
ok(list(res.orange) === 'a7,b2', 'and the sliced run gives the same answer');

// ------------------------------------------------------------ positions needed
// A ten-squad league, Tim's shape: QB, RB×2, WR×3, TE, FLEX, D/ST, K, six on the
// bench (16 men). Squad 1 has the league's best QB and WRs and its worst RBs
// and TE; every other squad is ordinary with a little spread.
const SLOTS = [0, 2, 2, 4, 4, 4, 6, 23, 16, 17];
const P = (id, position, pts) => ({ playerId: id, name: `P${id}`, position, pts });
function squad(t, adj) {
  const a = (pos) => adj[pos] || 0;
  const wobble = (t % 3) * 0.6;
  return {
    id: t,
    players: [
      P(t * 100 + 1, 'QB', 18 + a('QB') + wobble), P(t * 100 + 2, 'QB', 9),
      P(t * 100 + 3, 'RB', 15 + a('RB') + wobble), P(t * 100 + 4, 'RB', 12 + a('RB') + wobble), P(t * 100 + 5, 'RB', 6),
      P(t * 100 + 6, 'WR', 14 + a('WR') + wobble), P(t * 100 + 7, 'WR', 12 + a('WR') + wobble), P(t * 100 + 8, 'WR', 10 + a('WR') + wobble),
      P(t * 100 + 9, 'WR', 7), P(t * 100 + 10, 'WR', 5),
      P(t * 100 + 11, 'TE', 9 + a('TE') + wobble), P(t * 100 + 12, 'TE', 4),
      P(t * 100 + 13, 'DST', 7 + a('DST')), P(t * 100 + 14, 'K', 8 + a('K')),
      P(t * 100 + 15, 'RB', 3), P(t * 100 + 16, 'WR', 3),
    ],
  };
}
const teams = [squad(1, { QB: 8, WR: 6, RB: -7, TE: -5, K: -5, DST: -5 }),
  ...Array.from({ length: 9 }, (_, i) => squad(i + 2, {}))];
const weeks = [6, 7, 8, 9, 10, 11, 12, 13, 14];
const projOf = (p, w) => (w === 8 && p.position === 'K' ? 0 : p.pts);   // a kicker bye, ESPN sends 0
const avgs = slotAverages({ teams, weeks, slots: SLOTS, projOf, floors: null });
ok(avgs.rows.length === 10 && avgs.byTeam.size === 10, 'one average per slot per squad', `${avgs.rows.length} rows, ${avgs.byTeam.size} squads`);
ok(avgs.byTeam.get(2).get('QB') === 19.2, 'a slot average is the mean of its weeks, to the tenth', String(avgs.byTeam.get(2).get('QB')));
const needs = positionNeeds(avgs, 1);
ok(needs.need.join(',') === 'RB,TE', 'squad 1 needs RB and TE (red in the Analysis grid)', JSON.stringify(needs));
ok(needs.has.join(',') === 'QB,WR', 'and has QB and WR (green)', JSON.stringify(needs));
ok(![...needs.need, ...needs.has].some((p) => p === 'K' || p === 'DST' || p === 'D/ST' || p === 'FLEX'),
  'K, D/ST and FLEX are never named, though squad 1 is worst at K and D/ST');
ok(NEED_POSITIONS.join(',') === 'QB,RB,WR,TE', 'the positions it can name');
const mid = positionNeeds(avgs, 5);
ok(mid.need.length === 0, 'an ordinary squad needs nothing loudly', JSON.stringify(mid));
const unread = slotAverages({ teams, weeks, slots: SLOTS, projOf: () => null });
ok(positionNeeds(unread, 1).need.length === 0, 'no week read: no needs (a week of nulls is not a week of zeros)');
ok(positionNeeds(avgs, 99).need.length === 0, 'a squad not in the league: nothing');

console.log(`test-custom-hint.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
