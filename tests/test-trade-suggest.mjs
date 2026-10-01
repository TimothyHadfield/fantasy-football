// THE SUGGESTED LIST UNDER THE CUSTOM BUILDER — the completions of a part-built deal.
//
//   node test-trade-suggest.mjs
//
// Tim, 2026-10-01: "when I select player(s) in custom trades with another user,
// if it's an incomplete trade, or a trade that is able to have additions, show
// all the potential additions as suggested trades (with the players that are
// already selected) … Always show at least 3 different suggested trades in this
// list, even if there are no trades that are beneficial for either user."
//
// The engine side (js/trade.js `findTrades` with `partnerId`, `mustSend`,
// `mustReceive`, `complete`). Checked here against a BRUTE FORCE that builds
// every completion by hand inside the finder's own limits (1–2 men a side, a
// 2-for-2 only among each side's top ten by rest-of-season points plus the
// ticked men) and prices each one with `priceTradeAcrossWeeks` on both
// rosters — a different code path from the finder's inner loop:
//   1. the finder considers exactly the brute force's completions (count);
//   2. every row it hands back contains every ticked man, on his own side;
//   3. its figures (your gain, net, goal points, his gain) equal the brute force's;
//   4. the rows are exactly the ones the selection rule picks from the brute
//      force's list: finder order; a deal containing a smaller one that is at
//      least as good for both is skipped; the first 3 always; a 4th and 5th
//      only if the finder's own gates would keep them; topped up to 3 if fewer.
// Demo league, floors off and on, points and goal-weighted, every config netted.
// Also: the constrained finder WITHOUT `complete` (the gated search) keeps the
// same offers pruned as exhaustive — the prune bounds still hold with the ticks.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const T = await imp('js/trade.js');
const { findTrades, priceTradeAcrossWeeks, slotsForLeague } = T;
const { positionFloors } = await imp('js/floor.js');
const { generateDemoWeekRosters, generateDemoSchedule } = await imp('js/demo-rosters.js');
const { slotCountsFromLineups } = await imp('js/projection.js');

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 600)}` : ''}`); }
};
const round1 = (x) => Math.round(x * 10) / 10;

ok(T.SUGGEST_MIN === 3 && T.SUGGEST_MAX === 5, 'the list is 3 rows at least, 5 at most', `${T.SUGGEST_MIN}/${T.SUGGEST_MAX}`);

// --------------------------------------------------------------- the demo league
const WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
const idx = new Map();
for (const w of WEEKS) {
  const m = new Map();
  for (const t of generateDemoWeekRosters(w).teams) for (const p of t.players)
    m.set(p.playerId, typeof p.projected === 'number' ? p.projected : null);
  idx.set(w, m);
}
const projFor = (p, w) => { const v = idx.get(w)?.get(p.playerId); return Number.isFinite(v) ? v : null; };
const { teams } = generateDemoWeekRosters(5);
const slots = slotsForLeague(slotCountsFromLineups(teams));
const games = generateDemoSchedule().games;
const meetFor = (a) => (b) => games
  .filter((g) => (g.homeId === a && g.awayId === b) || (g.homeId === b && g.awayId === a))
  .map((g) => g.week);
const wire = [];
for (const [pos, top] of [['QB', 17], ['RB', 12], ['WR', 12], ['TE', 9], ['DST', 9], ['K', 9]])
  for (let i = 0; i < 5; i++) wire.push({ playerId: `wire-${pos}-${i}`, name: `W${pos}${i}`, position: pos, projected: top - i * 0.5, injuryStatus: 'ACTIVE' });
const FLOORS = positionFloors(wire, { week: WEEKS[0] });
ok(FLOORS.size >= 5, 'the demo wire makes floors', FLOORS.size);
// Goal-shaped weights and a partner reach, as the page passes under a goal.
const WEIGHTS = WEEKS.map((w, i) => round1(0.4 + (i % 3) * 0.5 + (w >= 15 ? 1.5 : 0)));
const REACH = WEEKS.map((w) => (w >= 15 ? 0.5 : 1));
// The page ranks by goal points × the chance he says yes; a stand-in of the same shape.
const RANK_BY = (o) => (Number.isFinite(o.goalPoints) ? o.goalPoints : o.netGain) * (o.theirGain >= 0 ? 1 : 0.4);

// ------------------------------------------------------------------ brute force
const ros = (p) => {
  let s = 0; let c = 0;
  for (const w of WEEKS) { const v = projFor(p, w); if (v !== null) { s += v; c++; } }
  return c ? round1(s) : null;
};
const byRos = (list) => list.filter((p) => ros(p) !== null).slice()
  .sort((a, b) => ros(b) - ros(a) || a.playerId - b.playerId);
const pairs = (list) => {
  const out = list.map((p) => [p]);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  return out;
};
const key = (send, receive) => `${send.map((p) => p.playerId).sort((a, b) => a - b).join(',')}>${receive.map((p) => p.playerId).sort((a, b) => a - b).join(',')}`;

function bruteForce({ me, him, mustSend, mustReceive, floors, weighted }) {
  const myList = byRos(me.players);
  const hisList = byRos(him.players);
  // The demo's 16-man rosters sit under the finder's 18-piece cap, so every man
  // with a number is a piece; the cap that binds is the 2-for-2's top ten.
  ok(myList.length <= 18 && hisList.length <= 18, 'brute force: the demo rosters sit under the 18-piece cap');
  const top = (list, must) => new Set([...list.slice(0, 10).map((p) => p.playerId), ...must]);
  const myTop = top(myList, mustSend);
  const hisTop = top(hisList, mustReceive);
  const meet = meetFor(me.id)(him.id).filter((w) => WEEKS.includes(w));
  const mi = WEEKS.map((w, i) => (meet.includes(w) ? i : -1)).filter((i) => i >= 0);
  const out = [];
  for (const receive of pairs(hisList)) {
    if (!mustReceive.every((id) => receive.some((p) => p.playerId === id))) continue;
    for (const send of pairs(myList)) {
      if (!mustSend.every((id) => send.some((p) => p.playerId === id))) continue;
      if (send.length === 2 && receive.length === 2 &&
        !(send.every((p) => myTop.has(p.playerId)) && receive.every((p) => hisTop.has(p.playerId)))) continue;
      const mine = priceTradeAcrossWeeks({ players: me.players, send, receive, slots, weeks: WEEKS, projFor, floors });
      const his = priceTradeAcrossWeeks({ players: him.players, send: receive, receive: send, slots, weeks: WEEKS, projFor, floors });
      const myGain = mine.delta;
      const hisWeek = his.byWeek.map((x) => round1(x.after - x.before));
      const oppSum = round1(mi.reduce((a, i) => a + hisWeek[i], 0));
      const netGain = mi.length ? round1(myGain - oppSum) : myGain;
      let goalPoints = null;
      let theirGain = his.delta;
      if (weighted) {
        const myGoal = round1(mine.byWeek.reduce((a, x, i) => a + WEIGHTS[i] * (x.after - x.before), 0));
        goalPoints = round1(myGoal - mi.reduce((a, i) => a + WEIGHTS[i] * hisWeek[i], 0));
        theirGain = round1(his.byWeek.reduce((a, x, i) => a + REACH[i] * (x.after - x.before), 0));
      }
      const o = { send, receive, myGain, netGain, goalPoints, theirGain, partner: him };
      if (weighted) o.rank = RANK_BY(o);
      out.push(o);
    }
  }
  return out;
}

// The selection rule, written out from the brief (not from js/trade.js).
const rankOf = (o) => (Number.isFinite(o.rank) ? o.rank : Number.isFinite(o.goalPoints) ? o.goalPoints : o.netGain);
const order = (a, b) => rankOf(b) - rankOf(a) || b.theirGain - a.theirGain ||
  a.send.length + a.receive.length - (b.send.length + b.receive.length);
function select(all, { minGain, theirMin }) {
  const sorted = all.slice().sort(order);
  const contains = (big, small) => small.every((p) => big.some((q) => q.playerId === p.playerId));
  const size = (o) => o.send.length + o.receive.length;
  const redundant = (o) => all.some((p) => size(p) < size(o) && contains(o.send, p.send) && contains(o.receive, p.receive)
    && rankOf(p) >= rankOf(o) && p.theirGain >= o.theirGain);
  const good = (o) => (Number.isFinite(o.goalPoints) ? o.goalPoints : o.netGain) >= minGain && o.theirGain >= theirMin;
  const kept = [];
  for (const o of sorted) {
    if (kept.length >= 5) break;
    if (redundant(o)) continue;
    if (kept.length >= 3 && !good(o)) continue;
    kept.push(o);
  }
  if (kept.length < 3) {
    for (const o of sorted) { if (kept.length >= 3) break; if (!kept.includes(o)) kept.push(o); }
    kept.sort(order);
  }
  return kept;
}

// ----------------------------------------------------------------------- runs
const me = teams[0];
const him = teams[3];
const mine = byRos(me.players);
const his = byRos(him.players);
const TICKS = [
  { label: 'his best man', send: [], receive: [his[0]] },
  { label: 'his 4th man', send: [], receive: [his[3]] },
  { label: 'one each', send: [mine[2]], receive: [his[1]] },
  { label: 'my man only', send: [mine[1]], receive: [] },
  { label: 'two of mine, one of his', send: [mine[0], mine[4]], receive: [his[2]] },
  // A bench man past the 2-for-2's top ten: still a piece, still in every row.
  { label: 'his 14th man (past the top ten)', send: [], receive: [his[13]] },
];
let rows = 0;
let shortLists = 0;
let topped = 0;
let fifth = 0;
let bad = 0;
const times = [];
for (const [flabel, floors] of [['no floors', null], ['floors', FLOORS]]) {
  for (const weighted of [false, true]) {
    for (const t of TICKS) {
      const tag = `${flabel}, ${weighted ? 'goal-weighted' : 'points'}, ${t.label}`;
      const mustSend = t.send.map((p) => p.playerId);
      const mustReceive = t.receive.map((p) => p.playerId);
      const opts = {
        teams, myTeamId: me.id, slots, weeks: WEEKS, projFor, floors, meetWeeks: meetFor(me.id),
        partnerId: him.id, mustSend, mustReceive,
        ...(weighted ? { weights: WEIGHTS, theirMinPerWeek: -2, theirReach: () => REACH, rankBy: RANK_BY } : {}),
      };
      const t0 = Date.now();
      const got = findTrades({ ...opts, complete: true });
      times.push(Date.now() - t0);
      const all = bruteForce({ me, him, mustSend, mustReceive, floors, weighted });

      ok(got.considered === all.length, `${tag}: the finder considers every completion`, `${got.considered} vs ${all.length}`);
      ok(got.offers.length === Math.min(3, all.length) || (got.offers.length >= 3 && got.offers.length <= 5),
        `${tag}: 3 to 5 rows`, got.offers.length);
      ok(got.offers.every((o) => o.partner.id === him.id), `${tag}: every row is with the chosen partner`);
      ok(got.offers.every((o) => mustSend.every((id) => o.send.some((p) => p.playerId === id))
        && mustReceive.every((id) => o.receive.some((p) => p.playerId === id))),
      `${tag}: every row carries every ticked man on his own side`);
      ok(got.offers.every((o) => o.send.length >= 1 && o.receive.length >= 1 && o.send.length <= 2 && o.receive.length <= 2),
        `${tag}: every row is 1–2 men a side`);
      ok(got.offers.every((o) => Array.isArray(o.yourChurn?.in) && Array.isArray(o.theirMoves) && !('finish' in o)),
        `${tag}: every row carries its churn lists`);

      const byKey = new Map(all.map((o) => [key(o.send, o.receive), o]));
      for (const o of got.offers) {
        const b = byKey.get(key(o.send, o.receive));
        const same = b && Math.abs(b.myGain - o.myGain) <= 0.11 && Math.abs(b.netGain - o.netGain) <= 0.11
          && Math.abs(b.theirGain - o.theirGain) <= 0.11
          && (!weighted || Math.abs(b.goalPoints - o.goalPoints) <= 0.15);
        ok(same, `${tag}: a row's figures equal the brute force's`,
          `${key(o.send, o.receive)} finder ${o.myGain}/${o.netGain}/${o.goalPoints}/${o.theirGain}`
          + ` brute ${b ? `${b.myGain}/${b.netGain}/${b.goalPoints}/${b.theirGain}` : 'missing'}`);
      }

      const minGain = round1(0.1 * WEEKS.length);
      const theirMin = weighted ? Math.min(minGain, -2 * REACH.reduce((a, r) => a + r, 0)) : minGain;
      const want = select(all, { minGain, theirMin }).map((o) => key(o.send, o.receive));
      const have = got.offers.map((o) => key(o.send, o.receive));
      ok(JSON.stringify(have) === JSON.stringify(want), `${tag}: exactly the rows the selection rule picks, in order`,
        `finder ${have.join(' | ')}\n      brute  ${want.join(' | ')}`);

      rows += got.offers.length;
      if (all.length < 3) shortLists++;
      if (got.offers.length === 5) fifth++;
      if (got.offers.some((o) => (Number.isFinite(o.goalPoints) ? o.goalPoints : o.netGain) < minGain || o.theirGain < theirMin)) bad++;
      // Topped-up: fewer than 3 survive the redundancy rule.
      if (all.length >= 3) {
        const sorted = all.slice().sort(order);
        const contains = (big, small) => small.every((p) => big.some((q) => q.playerId === p.playerId));
        const surv = sorted.filter((o) => !all.some((p) => p.send.length + p.receive.length < o.send.length + o.receive.length
          && contains(o.send, p.send) && contains(o.receive, p.receive) && rankOf(p) >= rankOf(o) && p.theirGain >= o.theirGain));
        if (surv.length < 3) topped++;
      }

      // The SAME ticks through the gated finder: pruned keeps what exhaustive keeps.
      const gp = findTrades({ ...opts, limit: Infinity });
      const ge = findTrades({ ...opts, limit: Infinity, exhaustive: true });
      const sum = (r) => r.offers.map((o) => `${key(o.send, o.receive)}:${o.myGain}:${o.netGain}:${o.goalPoints}:${o.theirGain}`);
      ok(gp.considered === ge.considered && JSON.stringify(sum(gp)) === JSON.stringify(sum(ge)),
        `${tag}: the gated finder with the ticks keeps the same offers pruned as exhaustive`,
        `${gp.considered} vs ${ge.considered}`);
      ok(gp.offers.every((o) => o.partner.id === him.id && mustSend.every((id) => o.send.some((p) => p.playerId === id))
        && mustReceive.every((id) => o.receive.some((p) => p.playerId === id))), `${tag}: and every gated offer carries the ticks`);
    }
  }
}
ok(rows >= 3 * 4 * TICKS.length - 2, 'nearly every search filled at least 3 rows', rows);
ok(bad > 0, 'some rows are bad for one side or both (the minimum shows them anyway)', bad);
ok(fifth > 0, 'some searches earned a 4th and 5th row', fifth);
console.log(`suggest: ${rows} rows over ${4 * TICKS.length} searches, ${fifth} with five, ${bad} with a bad row, `
  + `${shortLists} with under 3 completions, ${topped} topped up`);
console.log(`timing: complete-mode search ${Math.min(...times)}–${Math.max(...times)} ms (13 weeks)`);

// Nothing to add: a full 2-for-2 ticked has exactly one completion, itself.
{
  const full = findTrades({ teams, myTeamId: me.id, slots, weeks: WEEKS, projFor, partnerId: him.id,
    mustSend: [mine[0].playerId, mine[1].playerId], mustReceive: [his[0].playerId, his[1].playerId], complete: true });
  ok(full.considered === 1 && full.offers.length === 1, 'a full 2-for-2 ticked: its only completion is itself',
    `${full.considered} / ${full.offers.length}`);
}
// Three of his ticked: past the package limit, no completion at all.
{
  const over = findTrades({ teams, myTeamId: me.id, slots, weeks: WEEKS, projFor, partnerId: him.id,
    mustReceive: [his[0].playerId, his[1].playerId, his[2].playerId], complete: true });
  ok(over.offers.length === 0, 'three of his ticked: no completion within 2 a side', over.offers.length);
}
// Without `complete` and the ticks, nothing changes for the existing finder.
{
  const plain = findTrades({ teams, myTeamId: me.id, slots, weeks: WEEKS, projFor, limit: Infinity });
  const ex = findTrades({ teams, myTeamId: me.id, slots, weeks: WEEKS, projFor, limit: Infinity, exhaustive: true });
  ok(plain.offers.length > 0 && plain.considered === ex.considered, 'the plain finder is unchanged (pruned == exhaustive)');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
