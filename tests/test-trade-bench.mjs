// THE BENCH-VALUE SWITCH's two engine pieces — `myMin` and `myCut`.
//
//   node test-trade-bench.mjs
//
// Tim, 2026-10-14: "could you make a "bench value" trade switch that makes all
// the suggested trades made to increase your bench value instead of anything
// else?"
//
// The page ranks by bench value itself (js/trade-page.js `benchGainOf`); the
// engine (js/trade.js `findTrades`) has to hand it the deals to rank:
//   - `myMin: 0` keeps a deal that leaves YOUR lineup level (the default keeps
//     only a gain), on the week-by-week measure and on the one-lineup one, and
//     still drops a deal that costs your lineup;
//   - every offer names YOUR forced cut (`myCut`, ids), so the page can price
//     the bench after it.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const { findTrades } = await imp('js/trade.js');

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// Slots QB, RB. Weeks 1-3, every man the same each week.
//   A (you)  QB Qa 20 · RB Ra 10 · RB Rx 8 (idle) · WR Wa 5 (idle: no WR slot)
//   B        QB Qb 15 · WR Wb 3 · WR Wc 4 (no RB at all)
// Rx for Wb: your RB is still Ra (level), his empty RB slot gets 8; no cut.
// Ra for Wb: your RB falls to Rx, −2 a week: never kept.
const WEEKS = [1, 2, 3];
const SLOTS = [0, 2];
let id = 9100;
const pts = new Map();
const man = (name, position, v) => {
  const p = { playerId: id++, name, position, lineupSlotId: 20 };
  pts.set(p.playerId, v);
  return p;
};
const projFor = (p) => (pts.has(p.playerId) ? pts.get(p.playerId) : null);
const A = { id: 1, name: 'A', players: [man('Qa', 'QB', 20), man('Ra', 'RB', 10), man('Rx', 'RB', 8), man('Wa', 'WR', 5)] };
const B = { id: 2, name: 'B', players: [man('Qb', 'QB', 15), man('Wb', 'WR', 3), man('Wc', 'WR', 4)] };
const teams = [A, B];
const names = (list) => list.map((p) => p.name).sort().join('+');
const find = (offers, send, receive) => offers.find((o) => names(o.send) === send && names(o.receive) === receive) || null;

for (const [label, opts] of [
  ['weekly', { weeks: WEEKS, projFor }],
  ['one lineup', { measure: projFor }],
]) {
  const base = { teams, myTeamId: 1, slots: SLOTS, limit: Infinity, ...opts };
  const plain = findTrades(base).offers;
  ok(!find(plain, 'Rx', 'Wb'), `${label}: by default a deal that leaves your lineup level is not kept`);

  const level = findTrades({ ...base, myMin: 0 }).offers;
  const deal = find(level, 'Rx', 'Wb');
  ok(!!deal, `${label}: with myMin 0 the level deal is kept`, level.map((o) => `${names(o.send)}>${names(o.receive)}`).join(' '));
  if (deal) {
    eq(deal.myGain, 0, `${label}: its lineup gain is 0`);
    eq(deal.myCut, [], `${label}: a 1-for-1 has no forced drop (myCut empty)`);
  }
  ok(!find(level, 'Ra', 'Wb'), `${label}: with myMin 0 a deal that costs your lineup is still dropped`);
  ok(level.every((o) => Array.isArray(o.myCut)), `${label}: every offer carries myCut`);
  ok(plain.every((o) => Array.isArray(o.myCut)), `${label}: every default offer carries myCut too`);
}

// THE CUT, named. Slots QB, RB, RB.
//   C (you)  QB Qa 20 · RB Ra 10 · RB Rx 8 · WR Wa 5 · WR Wd 2
//   D        QB Qd 15 · RB Rb 12 · RB Rc 11 · RB Rd 9
// Ra for Rb + Rc: your backs go 10+8 → 12+11 (+5 a week); you end a man over
// and the idle man with the lowest season goes — Wd.
{
  const C = { id: 3, name: 'C', players: [man('Qa', 'QB', 20), man('Ra', 'RB', 10), man('Rx', 'RB', 8), man('Wa', 'WR', 5), man('Wd', 'WR', 2)] };
  const D = { id: 4, name: 'D', players: [man('Qd', 'QB', 15), man('Rb', 'RB', 12), man('Rc', 'RB', 11), man('Rd', 'RB', 9)] };
  const offers = findTrades({ teams: [C, D], myTeamId: 3, slots: [0, 2, 2], weeks: WEEKS, projFor, theirMinPerWeek: -100, limit: Infinity }).offers;
  const deal = find(offers, 'Ra', 'Rb+Rc');
  ok(!!deal, 'cut: the 1-for-2 is found', offers.map((o) => `${names(o.send)}>${names(o.receive)}`).join(' '));
  if (deal) eq(deal.myCut, [C.players[4].playerId], 'cut: myCut names your forced drop (Wd)');
}

console.log(`test-trade-bench.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
