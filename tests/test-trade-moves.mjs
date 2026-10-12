// What a trade makes a manager do next (js/trade-moves.js), and the pricing bug
// Tim found on the way to asking for it.
//
//   node test-trade-moves.mjs
//
// Tim, 2026-10-12: "I simulated a trade with Autumn and when I added the kicker
// to her side it showed her gain +0.7 pts/week, which doesn't make sense …
// if the trade needs a player to drop someone, put it at the top as a list of
// players that user needs to drop. If it also shows you need to add a player,
// show the position you need to add from the waivers after the trade."
//
// The squad is a real shape: 16 men, the league's nine starting slots, a wire
// read ranked the way js/floor.js ranks it. The week is under way — the roster
// rows carry `done` and `pregame` exactly as js/season.js sends them.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const { priceTradeAcrossWeeks, setCutValue, findTrades } = await imp('js/trade.js');
const { positionFloors } = await imp('js/floor.js');
const { SLOT_ELIGIBILITY } = await imp('js/espn.js');
const { positionsToAdd, movesFor } = await imp('js/trade-moves.js');

let pass = 0;
let fail = 0;
const ok = (c, msg, extra = '') => {
  if (c) pass++;
  else { fail++; console.log(`FAIL ${msg}${extra ? ` — ${String(extra).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, msg) => ok(Object.is(a, b), msg, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// QB, RB, RB, WR, WR, TE, FLEX, D/ST, K — nine starters.
const SLOTS = [0, 2, 2, 4, 4, 6, 23, 16, 17];
const WEEKS = [6, 7, 8, 9, 10, 11, 12, 13, 14];
const SHAPE = ['QB', 'QB', 'RB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE', 'DST', 'K', 'RB'];
const BASE = { QB: 18, RB: 12, WR: 11, TE: 8, DST: 6, K: 7.1 };

/** A squad of 16; `done` says whose game this week is over (all of them, by default). */
function squad(teamId, { done = true, outForSeason = [] } = {}) {
  const seen = {};
  return SHAPE.map((position, i) => {
    const n = (seen[position] = (seen[position] || 0) + 1);
    const playerId = teamId * 100 + i;
    const out = outForSeason.includes(i);
    return {
      playerId, name: `T${teamId} ${position}${n}`, position, proTeamId: (playerId % 30) + 1,
      perGame: out ? 0 : Math.max(1, BASE[position] - (n - 1) * 2.5),
      // This week's row, as sent in a week under way: the score once he is done.
      projected: out ? 0 : BASE[position] + 3, pregame: out ? 0 : BASE[position],
      ...(done === null ? {} : { done }),
    };
  });
}
const projFor = (p) => p.perGame;
// The wire: its third-best kicker is 7.8, above this squad's 7.1 starter.
const FLOORS = positionFloors([
  ...[9.4, 8.6, 7.8, 7.0].map((v, i) => ({ playerId: 9000 + i, name: `FA K${i}`, position: 'K', projected: v })),
  ...[7.5, 6.9, 6.2].map((v, i) => ({ playerId: 9100 + i, name: `FA D${i}`, position: 'DST', projected: v })),
], { week: 6 });
eq(FLOORS.get('K').value, 7.8, 'the waiver line for a kicker is the third best on the wire');

const price = (players, send, receive, floors = FLOORS) => priceTradeAcrossWeeks({
  players, send, receive, slots: SLOTS, weeks: WEEKS, projFor, zeroIsBye: true, floors,
});
const kickerOf = (t) => t.find((p) => p.position === 'K');

// ------------------------------------------ giving a kicker away is never a gain
for (const done of [true, false, null]) {
  const mine = squad(1, { done });
  const said = `(this week's rows ${done === true ? 'finished' : done === false ? 'not finished' : 'unmarked'})`;
  const away = price(mine, [kickerOf(mine)], []);
  ok(away.delta <= 0, `sending your only kicker for nobody gains nothing ${said}`, away.delta);
  eq(away.delta, 0, `it costs exactly nothing when he sat under the waiver line anyway ${said}`);
  ok(away.byWeek.every((w) => w.delta <= 1e-9), `and no single week goes up ${said}`,
    JSON.stringify(away.byWeek.map((w) => w.delta)));
  // The same deal, the same price, whatever this week's games have done.
  eq(away.before.total, price(squad(1, { done: false }), [], []).before.total,
    `the squad is worth the same before the trade ${said}`);
}
{
  // A kicker ABOVE the line is a real loss.
  const mine = squad(1).map((p) => (p.position === 'K' ? { ...p, perGame: 9.9 } : p));
  const away = price(mine, [kickerOf(mine)], []);
  eq(away.delta, Math.round((7.8 - 9.9) * WEEKS.length * 10) / 10, 'a kicker above the waiver line costs the gap, every week');
  // And with no wire read there is no line: his whole projection goes.
  const bare = price(squad(1), [kickerOf(squad(1))], [], null);
  eq(bare.delta, Math.round(-7.1 * WEEKS.length * 10) / 10, 'with no waiver line he costs his whole projection');
}

// ------------------------------------------------------- who must be dropped
{
  const mine = squad(1, { outForSeason: [15] });        // the 5th RB is out for the season
  const his = squad(2);
  const two = his.filter((p) => p.position === 'WR').slice(0, 2);
  const priced = price(mine, [], two);
  const m = movesFor({ before: mine, priced, slots: SLOTS, eligibility: SLOT_ELIGIBILITY });
  eq(m.drop.length, 2, 'taking two men for nobody forces two drops');
  ok(m.drop.some((p) => p.playerId === mine[15].playerId), 'and the man out for the season is one of them',
    JSON.stringify(m.drop));
  eq(m.add.length, 0, 'with nothing to add');
  eq(priced.roster.length, mine.length, 'the roster is back at its size');
  const even = movesFor({ before: mine, priced: price(mine, [mine[6]], [two[0]]), slots: SLOTS, eligibility: SLOT_ELIGIBILITY });
  eq(even.drop.length + even.add.length, 0, 'a one-for-one asks for neither');
}

// ---------------------------------------------- what must be added afterwards
{
  const mine = squad(1);
  const add = (send, receive = []) => movesFor({
    before: mine, priced: price(mine, send, receive), slots: SLOTS, eligibility: SLOT_ELIGIBILITY,
  }).add;
  const k = add([kickerOf(mine)]);
  eq(k.map((a) => `${a.count} ${a.label}`).join(), '1 K', 'sending your only kicker: add a K');
  eq(add([mine.find((p) => p.position === 'DST')]).map((a) => a.label).join(), 'D/ST', 'a defence is printed D/ST');
  eq(add([mine.find((p) => p.position === 'TE')]).length, 0, 'sending one of two tight ends: nothing to add');
  eq(add(mine.filter((p) => p.position === 'TE')).map((a) => a.label).join(), 'TE', 'sending both: add a TE');
  const rbs = mine.filter((p) => p.position === 'RB');
  eq(add(rbs.slice(0, 4)).map((a) => `${a.count} ${a.label}`).join(), '1 RB', 'left with one RB where two start: add one');
  eq(add(rbs).map((a) => `${a.count} ${a.label}`).join(), '2 RB', 'left with none: add two');
  eq(add([kickerOf(mine)], [kickerOf(squad(2))]).length, 0, 'a kicker for a kicker: nothing to add');
  eq(add([kickerOf(mine), mine[0]]).map((a) => a.label).join(), 'K', 'listed in lineup order, and only what is short');
}
{
  // Short before the trade and no shorter after it: not this trade's doing.
  const noK = squad(1).filter((p) => p.position !== 'K');
  eq(positionsToAdd(noK, noK.slice(1), SLOTS, SLOT_ELIGIBILITY).length, 0, 'a squad already without a kicker is not told to add one');
  eq(positionsToAdd([], [], SLOTS, SLOT_ELIGIBILITY).length, 0, 'nothing in, nothing out');
  eq(movesFor({ before: [], priced: null, slots: SLOTS, eligibility: SLOT_ELIGIBILITY }).drop.length, 0, 'no pricing, no lists');
}

// ------------------------------------------- Value decides who is dropped
//
// Tim, 2026-10-12: "I have Kyler murray who has a value of 0.1, but it suggests
// me to drop Juwan Jhonson, the #3 TE avg 13pts and a value of 0.8. I think
// Value should probably be the biggest priority when choosing who to drop".
// His case, in the fixture: the second TE starts nowhere and is worth 0.8; the
// second QB starts nowhere either and is worth 0.1.
{
  const mine = squad(1, { done: null });
  const his = squad(2, { done: null });
  const te2 = mine.filter((p) => p.position === 'TE')[1];
  const qb2 = mine.filter((p) => p.position === 'QB')[1];
  const k = kickerOf(mine);
  const got = his.filter((p) => p.position === 'WR').slice(0, 1);
  const VALUES = new Map(mine.concat(his).map((p) => [p.playerId, 3]));
  VALUES.set(te2.playerId, 0.8);
  VALUES.set(qb2.playerId, 0.1);
  VALUES.set(k.playerId, 0);                       // a kicker: worth nothing, and the only one
  const dropOf = (receive) => price(mine, [], receive).cut.map((p) => p.playerId).join();

  setCutValue(null);
  const old = dropOf(got);
  ok(old !== '' && old !== String(qb2.playerId), 'with no Values the old rule stands, and it is not the second QB', old);

  setCutValue((id) => VALUES.get(id) ?? null);
  eq(dropOf(got), String(qb2.playerId), 'with Values, the lowest Value goes: the 0.1, not the 0.8');
  ok(!dropOf(got).split(',').includes(String(k.playerId)), 'the only kicker is not dropped, though his Value is the lowest of all');
  const two = his.filter((p) => p.position === 'WR').slice(0, 2);
  eq(dropOf(two).split(',').sort().join(), [qb2.playerId, te2.playerId].map(String).sort().join(), 'two over: the two lowest go');
  VALUES.delete(te2.playerId);
  eq(dropOf(got), String(te2.playerId), 'a man with no Value counts 0');
  VALUES.set(te2.playerId, 0.8);
  // Values are compared as printed (to the tenth): level ones leave it to the old rule.
  for (const p of mine) VALUES.set(p.playerId, 0.84);
  VALUES.set(got[0].playerId, 0.8);
  eq(dropOf(got), old, 'level Values (0.84 and 0.8 both print 0.8): the old rule settles it');
  VALUES.set(got[0].playerId, 0);
  eq(dropOf(got), String(got[0].playerId), 'the man just received goes, when his is the lowest Value');
  setCutValue(() => { throw new Error('no'); });
  eq(dropOf(got), old, 'a lookup that throws is no Value, not a crash');
  setCutValue(null);
  eq(dropOf(got), old, 'and taking the Values away puts the old rule back');
}

// ------------------------------------------- one row per trade, not per version
//
// Tim, 2026-10-12: "stop makeing suggested trades that are just virtually
// identical different versions of the same trade. Just do the best version and
// that's it." And: "a switch … that makes it so that all suggested trades are
// beneficial for both teams" — which is the finder with no tolerance for the
// other manager's loss.
{
  // Two squads weak in opposite places, so there is a real swap to be had and
  // a bench of spare men to hang on it.
  const lift = (players, by) => players.map((p) => ({ ...p, perGame: Math.max(1, p.perGame + (by[p.position] || 0)) }));
  const teams = [
    { id: 1, name: 'A', players: lift(squad(1, { done: null }), { QB: -8, WR: 5 }) },
    { id: 2, name: 'B', players: lift(squad(2, { done: null }), { QB: 3, WR: -6 }) },
  ];
  const find = (extra) => findTrades({
    teams, myTeamId: 1, slots: SLOTS, weeks: WEEKS, projFor, zeroIsBye: true, floors: FLOORS, limit: 400, ...extra,
  }).offers;
  const shares = (a, b) => a.some((p) => b.some((q) => q.playerId === p.playerId));
  const twins = (list) => list.filter((o, i) => list.some((k, j) => j < i &&
    k.partner.id === o.partner.id && shares(k.send, o.send) && shares(k.receive, o.receive))).length;
  const key = (o) => `${o.send.map((p) => p.playerId).sort()}>${o.receive.map((p) => p.playerId).sort()}`;

  const plain = find({});
  const one = find({ distinct: true });
  ok(plain.length > 3 && twins(plain) > 0, 'the fixture has versions of one trade in it', `${plain.length} offers, ${twins(plain)} twins`);
  eq(twins(one), 0, 'asked for one row per trade, no two rows share a man going each way');
  ok(one.length < plain.length, 'so the list is shorter', `${one.length} of ${plain.length}`);
  // Every row left out is a version of a row that was KEPT, and ranked below it.
  ok(plain.every((o, i) => one.some((k) => key(k) === key(o)) || one.some((k) =>
    plain.findIndex((x) => key(x) === key(k)) < i && k.partner.id === o.partner.id &&
    shares(k.send, o.send) && shares(k.receive, o.receive))),
  'each row left out is a version of a better row that stayed');
  eq(key(one[0]), key(plain[0]), 'the best version is the one kept');
  ok(one.every((o) => plain.some((k) => key(k) === key(o))), 'nothing is added, only left out');
  ok(one.every((o, i) => i === 0 || plain.findIndex((k) => key(k) === key(one[i - 1])) < plain.findIndex((k) => key(k) === key(o))),
    'and the order is the finder’s own');

  // The switch: a tolerance lets in deals that cost him; without it he gains.
  const loose = find({ theirMinPerWeek: -2 });
  ok(loose.some((o) => o.theirGain < 0), 'with a tolerance, some offers cost the other manager', loose.length);
  ok(plain.length > 0 && plain.every((o) => o.theirGain > 0 && o.myGain > 0), 'without one, every offer raises both lineups');
}

console.log(fail ?`\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
