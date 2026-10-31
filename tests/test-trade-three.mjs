// THREE-FOR-THREE TRADES (2026-10-31).
//
//   node test-trade-three.mjs
//
// Tim, 2026-10-31: "set up the new trade algorithm. Also check out the two
// trades I've saved before you do. notice how there's combinations of 3 for 3
// players." Both of his saved trades were 3-for-3 and mixed positions; one of
// them (with Robert Lane) is built here at its real numbers:
//   you send Cook RB 18.6, Warren TE 11.4, Pollard RB 14.7
//   you get  St. Brown WR 20.1, Pitts TE 10.6, Lawrence QB 20.6
// Pitts is a ~10-a-week TE, below several of Robert's bench men by rest-of-
// season total, which is what a flat "top N" cut would have lost.
//
// Checked (js/trade.js `findTrades`, the weekly measure):
//   1. the finder returns that exact 3-for-3, kind 'three';
//   2. its figures equal `priceTradeAcrossWeeks` on both rosters (a different
//      code path from the finder's inner loop);
//   3. the pruned search keeps exactly what an exhaustive one keeps;
//   4. `skip` still bars a man from every shape, 3-man ones included;
//   5. `keep` filters BEFORE the one-per-target dedupe: a gate that the best
//      version of a deal fails lets a passing sibling through;
//   6. a 3-for-1 makes the receiving side cut two men, both named.
// On the code before 2026-10-31 (packages of at most two) check 1 fails.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const T = await imp('js/trade.js');
const { findTrades, priceTradeAcrossWeeks, slotsForLeague } = T;

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 600)}` : ''}`); }
};
const round1 = (x) => Math.round(x * 10) / 10;

// QB, RB×2, WR×2, TE, FLEX (RB/WR/TE), K, D/ST — the shape of Tim's league.
const slots = slotsForLeague({ 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1 });
const WEEKS = [9, 10, 11, 12, 13, 14];

let nextId = 1;
const man = (name, position, perWeek) => ({ playerId: nextId++, name, position, perWeek, injuryStatus: 'ACTIVE', lineupSlotId: 20 });
const me = {
  id: 1, name: 'Tim',
  players: [
    man('Me QB', 'QB', 12),
    man('Cook', 'RB', 18.6),
    man('Pollard', 'RB', 14.7),
    man('Me RB3', 'RB', 13),
    man('Me RB4', 'RB', 12),
    man('Me WR1', 'WR', 12),
    man('Me WR2', 'WR', 11),
    man('Warren', 'TE', 11.4),
    man('Me TE2', 'TE', 10),
    man('Me K', 'K', 8),
    man('Me DST', 'DST', 7),
  ],
};
const robert = {
  id: 2, name: 'Robert Lane',
  players: [
    man('Lawrence', 'QB', 20.6),
    man('Rob QB2', 'QB', 19),
    man('Rob RB1', 'RB', 9),
    man('Rob RB2', 'RB', 8),
    man('St. Brown', 'WR', 20.1),
    man('Rob WR2', 'WR', 13),
    man('Rob WR3', 'WR', 12),
    man('Rob WR4', 'WR', 11),
    man('Pitts', 'TE', 10.6),
    man('Rob K', 'K', 8),
    man('Rob DST', 'DST', 7),
  ],
};
const teams = [me, robert];
const byId = new Map(teams.flatMap((t) => t.players).map((p) => [p.playerId, p]));
const projFor = (p, w) => (WEEKS.includes(w) ? byId.get(p.playerId).perWeek : null);
const id = (name) => teams.flatMap((t) => t.players).find((p) => p.name === name).playerId;
const names = (list) => list.map((p) => p.name).sort().join(', ');

const base = { teams, myTeamId: 1, slots, weeks: WEEKS, projFor, limit: 500 };

// ------------------------------------------------------------- 1. it is found
const SEND = ['Cook', 'Pollard', 'Warren'].sort().join(', ');
const GET = ['Lawrence', 'Pitts', 'St. Brown'].sort().join(', ');
const all = findTrades({ ...base, kinds: T.PACKAGE_KINDS });
ok(T.PACKAGE_KINDS.includes('three'), "PACKAGE_KINDS has 'three'", T.PACKAGE_KINDS);
// The finder keeps ONE way to get each set of men (`bestPerTarget`): here
// keeping Cook and sending Me RB3 is better for you than Tim's own version,
// so his three men come back for a 3-man package...
const best = all.offers.find((o) => names(o.receive) === GET);
ok(!!best && best.send.length === 3, "Robert's three men are found, for three of yours",
  all.offers.slice(0, 8).map((o) => `${names(o.send)} > ${names(o.receive)}`).join(' | '));
// ...and Tim's exact deal is found when it is the version asked for.
const exact = findTrades({ ...base, kinds: T.PACKAGE_KINDS, keep: (o) => names(o.send) === SEND });
const t2 = exact.offers.find((o) => names(o.receive) === GET);
ok(!!t2, "Tim's own 3-for-3 with Robert is found", exact.offers.map((o) => `${names(o.send)} > ${names(o.receive)}`).join(' | '));
ok(t2 && t2.kind === 'three' && t2.shape === '3-for-3', 'it is kind three, shape 3-for-3', t2 && `${t2.kind} ${t2.shape}`);
const threeOnly = findTrades({ ...base, kinds: ['three'] });
ok(threeOnly.offers.length > 0 && threeOnly.offers.every((o) => o.send.length === 3 || o.receive.length === 3),
  "kinds ['three'] returns only deals with a 3-man side", threeOnly.offers.map((o) => o.shape).join(','));
const twoOnly = findTrades({ ...base, kinds: ['even', 'consolidate', 'depth', 'two'] });
ok(twoOnly.offers.every((o) => o.send.length <= 2 && o.receive.length <= 2),
  'the four old kinds never return a 3-man side', twoOnly.offers.map((o) => o.shape).join(','));

// ------------------------------------------------------------ 2. it is priced
if (t2) {
  const mine = priceTradeAcrossWeeks({ players: me.players, send: t2.send, receive: t2.receive, slots, weeks: WEEKS, projFor });
  const his = priceTradeAcrossWeeks({ players: robert.players, send: t2.receive, receive: t2.send, slots, weeks: WEEKS, projFor });
  ok(t2.myGain === mine.delta, 'your gain = priceTradeAcrossWeeks', `${t2.myGain} vs ${mine.delta}`);
  ok(t2.theirGain === his.delta, 'his gain = priceTradeAcrossWeeks', `${t2.theirGain} vs ${his.delta}`);
  // By hand, per week: you 92.7 -> 99.3 (+6.6), Robert 93.3 -> 99.7 (+6.4).
  ok(round1(t2.myGain / WEEKS.length) === 6.6, 'you +6.6 a week, by hand', t2.myGain / WEEKS.length);
  ok(round1(t2.theirGain / WEEKS.length) === 6.4, 'Robert +6.4 a week, by hand', t2.theirGain / WEEKS.length);
  ok(t2.myCut.length === 0, 'an even 3-for-3 cuts nobody', t2.myCut);
}

// ----------------------------------------------- 3. pruned = exhaustive, netted
const key = (o) => `${names(o.send)}>${names(o.receive)}|${o.myGain}|${o.theirGain}|${o.netGain}`;
for (const meet of [null, [10, 13]]) {
  for (const theirMinPerWeek of [null, -2]) {
    const opts = { ...base, kinds: T.PACKAGE_KINDS, meetWeeks: meet ? () => meet : null, theirMinPerWeek };
    const a = findTrades(opts).offers.map(key).sort();
    const b = findTrades({ ...opts, exhaustive: true }).offers.map(key).sort();
    ok(a.length > 0 && a.join('\n') === b.join('\n'), `pruned search = exhaustive (meet ${meet}, his min ${theirMinPerWeek})`,
      `${a.length} vs ${b.length}`);
  }
}

// --------------------------------------------------------------- 4. skip holds
{
  const skip = new Set([String(id('Pitts'))]);
  const r = findTrades({ ...base, kinds: T.PACKAGE_KINDS, skip });
  ok(r.offers.length > 0 && r.offers.every((o) => !o.send.concat(o.receive).some((p) => p.name === 'Pitts')),
    'skip: Pitts is in no offer, of any shape');
  const ref = findTrades(base).offers.filter((o) => !o.send.concat(o.receive).some((p) => p.name === 'Pitts'));
  // Same answer as filtering a skip-free search afterwards, deal for deal
  // (the 3-man pool may promote another man into Pitts's place, so compare
  // only deals without a 3-man side, whose pool is untouched).
  const small = (list) => list.filter((o) => o.send.length < 3 && o.receive.length < 3).map(key).sort().join('\n');
  ok(small(r.offers) === small(ref), 'skip: the 1- and 2-man answer equals filtering afterwards');
}

// --------------------------------------------------- 5. keep filters before dedupe
{
  // The best way to get Tim's three men is kept by `bestPerTarget`; a gate that
  // refuses that version must let the NEXT-best version of the same target
  // through, not leave the target empty.
  const target = all.offers.find((o) => names(o.receive) === GET);
  const without = findTrades({ ...base, kinds: T.PACKAGE_KINDS, keep: (o) => key(o) !== key(target) });
  const again = without.offers.find((o) => names(o.receive) === GET);
  ok(!!again && key(again) !== key(target), 'keep: a refused best version lets a sibling through', again && key(again));
  ok(without.passed === without.considered - 1, 'keep: passed = considered − the one refused', `${without.passed}/${without.considered}`);
  const none = findTrades({ ...base, kinds: T.PACKAGE_KINDS, keep: () => false });
  ok(none.offers.length === 0 && none.passed === 0, 'keep: () => false leaves nothing');
  const thrower = findTrades({ ...base, kinds: T.PACKAGE_KINDS, keep: () => { throw new Error('x'); } });
  ok(thrower.offers.length === 0, 'keep: a gate that throws keeps nothing');
}

// --------------------------------------------------- 6. a 3-for-1 cuts two men
{
  // Robert takes three of yours for St. Brown: he is two men over and must cut two.
  const r = findTrades({ ...base, kinds: ['three'], theirMinPerWeek: -100, myMin: -1e9, limit: 5000,
    partnerId: 2, mustReceive: [id('St. Brown')], mustSend: [id('Cook'), id('Pollard'), id('Warren')],
    keep: (x) => x.receive.length === 1 });
  const o = r.offers.find((x) => x.send.length === 3 && x.receive.length === 1);
  ok(!!o, 'a 3-for-1 is priced', r.offers.map((x) => x.shape).join(','));
  if (o) {
    const his = priceTradeAcrossWeeks({ players: robert.players, send: o.receive, receive: o.send, slots, weeks: WEEKS, projFor });
    ok(his.cut.length === 2, 'the side taking three for one cuts two', his.cut.map((p) => p.name));
    ok(o.theirGain === his.delta, 'his gain on a 3-for-1 = priceTradeAcrossWeeks', `${o.theirGain} vs ${his.delta}`);
    const mine = priceTradeAcrossWeeks({ players: me.players, send: o.send, receive: o.receive, slots, weeks: WEEKS, projFor });
    ok(o.myGain === mine.delta && mine.cut.length === 0, 'your side of a 3-for-1: priced, nobody cut', `${o.myGain} vs ${mine.delta}`);
  }
}

// ------------------------------------- 7. the custom box's Suggested list
{
  // His exact deal ticked in full: its one completion is itself, priced.
  const full = findTrades({ ...base, partnerId: 2, complete: true,
    mustSend: [id('Cook'), id('Pollard'), id('Warren')], mustReceive: [id('St. Brown'), id('Pitts'), id('Lawrence')] });
  ok(full.considered === 1 && full.offers.length === 1 && names(full.offers[0].receive) === GET,
    "Tim's 3-for-3 ticked in full: its only completion is itself", `${full.considered} / ${full.offers.length}`);
  // Two ticked a side: the list may finish it with a third man each way.
  const part = findTrades({ ...base, partnerId: 2, complete: true,
    mustSend: [id('Cook'), id('Warren')], mustReceive: [id('St. Brown'), id('Pitts')] });
  ok(part.offers.some((o) => o.send.length === 3 || o.receive.length === 3),
    'two ticked a side: a completion adds a third man', part.offers.map((o) => o.shape).join(','));
  let priced = 0;
  for (const o of part.offers) {
    const mine = priceTradeAcrossWeeks({ players: me.players, send: o.send, receive: o.receive, slots, weeks: WEEKS, projFor });
    const his = priceTradeAcrossWeeks({ players: robert.players, send: o.receive, receive: o.send, slots, weeks: WEEKS, projFor });
    if (o.myGain === mine.delta && o.theirGain === his.delta) priced++;
  }
  ok(priced === part.offers.length && priced > 0, 'every completion is priced as priceTradeAcrossWeeks prices it', `${priced}/${part.offers.length}`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
