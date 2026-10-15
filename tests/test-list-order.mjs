// THE FINDER'S ORDER, WITH THE GOAL GUARD.
//
//   node test-list-order.mjs
//
// Tim, 2026-10-14, asked "List order: keep 'You + He gains' but never put a
// trade that lowers your goal chance above one that raises it?": "Yes, add that
// guard". The plan's note: "+1 gate also needs chance not to fall."
//
// The rule (js/trade-odds.js `orderWithGoalGuard`, `lowersGoal`, `goalGateOk`):
//   - a deal whose goal change is below −TIE_BAND never sits above one whose
//     change is at or above −TIE_BAND; inside each group the order is the key
//     (net increase, or bench gain under the bench-value switch), largest first;
//   - a deal with no goal change yet keeps today's place (it is not judged);
//   - the guard is the row's own figure against a fixed band, so the sort is a
//     plain two-key sort and never depends on which pairs were compared;
//   - the +1 a week gate also leaves out a deal whose change is not above
//     −TIE_BAND, once the change is known.
// And the Trade page's finder (js/trade-page.js) is wired to it, at both of
// the places it sorts by the goal and at its "=" marks.
//
// Rows are in the page's offer shape: `goalScore.mine.gain` is the change in
// your chance as a fraction (0.012 = +1.2 points), `net` stands in for the
// row's net increase in tenths (what `netIncreaseOf` returns).

import path from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const odds = await import(pathToFileURL(path.join(REPO, 'js/trade-odds.js')).href);
const { TIE_BAND } = odds;

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const have = ['lowersGoal', 'goalGateOk', 'orderWithGoalGuard'].every((k) => typeof odds[k] === 'function');
ok(have, 'js/trade-odds.js exports lowersGoal, goalGateOk and orderWithGoalGuard');

const row = (id, net, gain) => ({ id, net, goalScore: gain === undefined ? null : { mine: { gain } } });
const ids = (list) => list.map((o) => o.id);
const order = (list) => odds.orderWithGoalGuard(list.slice(), (o) => o.net);

if (have) {
  // ------------------------------------------------------------ 1. the guard
  // The audit's case (synthetic league, 2026-10-14): "you +1.5, your top rival
  // +8" summed to the biggest net and ranked first while it cost −1.16 points
  // of title chance; "you +4, a contender −1" summed lower at +6.24 points.
  {
    const fleece = row('lowers', 95, -0.0116);
    const good = row('raises', 30, 0.0624);
    eq(ids(order([fleece, good])), ['raises', 'lowers'],
      'a goal-lowering deal with the bigger net increase ends up BELOW a goal-raising one');
  }
  // Two goal-lowering deals keep net-increase order between them, and so do
  // two that do not lower it.
  {
    const list = [row('L-small', 10, -0.02), row('ok-small', 5, 0.001), row('L-big', 80, -0.009), row('ok-big', 40, 0.03)];
    eq(ids(order(list)), ['ok-big', 'ok-small', 'L-big', 'L-small'],
      'inside each group the order is net increase, largest first');
  }
  // Inside the band is not a fall: −0.3 points sorts with the raisers, by net.
  {
    const list = [row('raise', 10, 0.05), row('flat-down', 50, -0.003), row('fall', 90, -0.0041)];
    eq(ids(order(list)), ['flat-down', 'raise', 'fall'],
      'a change inside the band (−0.3 points) is not a fall: it stays in the net order');
  }
  // Exactly at the band's edge: −TIE_BAND is "at or above −TIE_BAND", so it
  // is not demoted (the brief's boundary).
  ok(!odds.lowersGoal(row('edge', 0, -TIE_BAND)), 'a change of exactly −TIE_BAND is not demoted');
  ok(odds.lowersGoal(row('past', 0, -TIE_BAND - 1e-9)), 'a change just past −TIE_BAND is demoted');
  // No score yet (unranked / still simulating): today's behaviour, not judged.
  {
    const list = [row('unscored', 70), row('lowers', 60, -0.05), row('raises', 20, 0.02)];
    eq(ids(order(list)), ['unscored', 'raises', 'lowers'],
      'a row with no goal change yet keeps its net-increase place');
    ok(!odds.lowersGoal(row('x', 1)) && !odds.lowersGoal({ goalScore: { mine: { gain: null } } }),
      'no goal change: not a lowering deal');
  }
  // Equal keys keep the order they came in (the sort is stable).
  {
    const list = [row('a', 10, 0.01), row('b', 10, 0.02), row('c', 10, -0.01), row('d', 10, -0.02)];
    eq(ids(order(list)), ['a', 'b', 'c', 'd'], 'equal net increases keep their incoming order (stable)');
  }
  // In place, as the page's `byNetIncrease` is.
  {
    const list = [row('L', 9, -0.01), row('R', 1, 0.01)];
    const back = odds.orderWithGoalGuard(list, (o) => o.net);
    ok(back === list && list[0].id === 'R', 'sorts in place and returns the same array');
  }

  // ------------------------------------------- 2. never a lowerer above a raiser
  // A spread of rows in real sizes: 40 offers (the finder's FINDER_ROWS), nets
  // from −30 to +250 tenths, changes from −3 to +6 points, some unscored. The
  // guarantee, checked over every pair, and the order a function of the row
  // alone: shuffling the input gives the same output up to ties.
  {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let trial = 0; trial < 50; trial++) {
      const list = Array.from({ length: 40 }, (_, i) =>
        row(`o${i}`, Math.round(-30 + rnd() * 280), rnd() < 0.1 ? undefined : -0.03 + rnd() * 0.09));
      const out = order(list);
      let bad = 0;
      for (let i = 0; i < out.length; i++) {
        for (let j = i + 1; j < out.length; j++) {
          if (odds.lowersGoal(out[i]) && !odds.lowersGoal(out[j])) bad++;
          if (odds.lowersGoal(out[i]) === odds.lowersGoal(out[j]) && out[i].net < out[j].net) bad++;
        }
      }
      ok(bad === 0, `trial ${trial}: no lowering deal above a non-lowering one, net order inside each`, `${bad} bad pairs`);
      const shuffled = list.slice().sort(() => rnd() - 0.5);
      eq(order(shuffled).map((o) => `${odds.lowersGoal(o) ? 1 : 0}:${o.net}`),
        out.map((o) => `${odds.lowersGoal(o) ? 1 : 0}:${o.net}`),
        `trial ${trial}: the order is a function of each row alone`);
    }
  }

  // ------------------------------------------------------------ 3. the +1 gate
  ok(!odds.goalGateOk(row('fall', 50, -0.0116)), 'the +1 gate rejects a deal whose chance falls by more than TIE_BAND');
  ok(!odds.goalGateOk(row('edge', 50, -TIE_BAND)), 'the +1 gate needs the change ABOVE −TIE_BAND (exactly −TIE_BAND fails)');
  ok(odds.goalGateOk(row('flat', 50, -0.003)), 'the +1 gate passes a change inside the band');
  ok(odds.goalGateOk(row('raise', 50, 0.02)), 'the +1 gate passes a raise');
  ok(odds.goalGateOk(row('unscored', 50)), 'the +1 gate passes a deal with no goal change yet');
}

// --------------------------------------------- 4. the finder is wired to it
// The page module cannot be imported on its own (it boots on a document), so
// its sorting sites are read off the source: both goal sorts go through the
// guarded order after the +1 gate's goal half, and the "=" marks keep the two
// groups apart. The custom box's Suggested list takes the same guarded order
// (wave 2, 2026-10-15) but NOT the +1 gate: it has no floor and keeps its
// "at least 3", so nothing may be dropped from it.
{
  const src = readFileSync(path.join(REPO, 'js/trade-page.js'), 'utf8');
  const body = (name) => {
    const at = src.indexOf(`function ${name}(`);
    if (at < 0) return '';
    const next = src.indexOf('\nfunction ', at + 10);
    return src.slice(at, next < 0 ? undefined : next);
  };
  const finish = src.slice(src.indexOf('const finish = () => {'), src.indexOf('const finish = () => {') + 900);
  ok(/byNetIncreaseGuarded\(offers\.filter\(finderGoalOk\)/.test(finish),
    'the final ranking (runGoalRank finish) gates and orders with the guard', finish.slice(0, 300));
  ok(/byNetIncreaseGuarded\(offers\.slice\(0, scored\)\.filter\(finderGoalOk\)/.test(body('stageGoalRank')),
    'the staged top ten (stageGoalRank) gates and orders with the guard');
  ok(/orderWithGoalGuard\(/.test(body('byNetIncreaseGuarded')), 'byNetIncreaseGuarded is orderWithGoalGuard on the row key');
  ok(/lowersGoal\(o\)/.test(body('markTies')), 'markTies never joins a lowering row to the group above it');
  ok(/goalGateOk\(o\)/.test(src) && /const finderGoalOk = \(o\) => state\.benchValue \|\| goalGateOk\(o\)/.test(src),
    'the +1 gate\'s goal half applies when the bench-value switch is off');

  // ------------------------------------------- 5. the custom box's Suggested list
  const sug = body('findSuggestions');
  ok(sug.length > 0, 'findSuggestions is found in js/trade-page.js');
  ok(/return byNetIncreaseGuarded\(offers\);/.test(sug),
    'the Suggested list is put in the guarded order (byNetIncreaseGuarded), not plain byNetIncrease',
    (sug.match(/return [^\n]*/g) || []).join(' | '));
  ok(!/finderGoalOk|goalGateOk|\.filter\(/.test(sug.slice(sug.indexOf('const offers = result.offers'))),
    'the Suggested list drops nothing after the search: no +1 gate, no goal gate, so its "at least 3" holds');

  // ----------------------------------------------- 6. the Notifications note
  const keep = body('keepTradeNotes');
  ok(/lowersGoal: lowersGoal\(o\)/.test(keep),
    'keepTradeNotes hands each row\'s goal guard (lowersGoal) to the note, so a lowering deal is never kept');
}

// A Suggested list in its real shape (3 to 5 rows, the "at least 3" kept when
// none is good): the guarded order moves the lowering one down and drops nothing.
if (have) {
  const list = [row('lowers-big', 120, -0.021), row('raises', 40, 0.018), row('flat', 15, 0.001)];
  const out = order(list);
  eq(ids(out), ['raises', 'flat', 'lowers-big'],
    'Suggested: a goal-lowering suggestion with the largest net increase ends below the goal-raising ones');
  ok(out.length === 3, 'Suggested: the guard drops nothing (three in, three out)');
  const allLow = [row('a', 9, -0.05), row('b', 30, -0.02), row('c', 3, -0.01)];
  eq(ids(order(allLow)), ['b', 'a', 'c'], 'Suggested: when every one lowers the chance, all three stay, by net increase');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
