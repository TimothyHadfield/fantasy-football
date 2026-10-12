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
const { priceTradeAcrossWeeks } = await imp('js/trade.js');
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

console.log(fail ? `\n${pass} passed, ${fail} failed` : `\nAll ${pass} assertions passed`);
process.exit(fail ? 1 : 0);
