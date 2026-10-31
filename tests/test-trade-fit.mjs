// Tim's own trade checklist (docs/trade-fit-plan.md) — js/trade-fit.js.
//
//   node test-trade-fit.mjs
//
// The two fixtures are Tim's own saved trades (2026-10-31, both 3-for-3, mixed
// positions), with the figures his screen printed; both must pass the gates.

import { moduleUrl } from './repo.mjs';

const fit = await import(moduleUrl('js/trade-fit.js'));

let pass = 0;
let fail = 0;
function check(ok, msg) {
  if (ok) pass++;
  else { fail++; console.log(`FAIL: ${msg}`); }
}
const checkOf = (f, key) => [...f.gates, ...f.checks].find((c) => c.key === key);

// ------------------------------------------------ Tim's two trades (ground truth)
// T1 with Nolan: You +3.8/wk, Him +1.2/wk; This week You +9.5, Him −1.1;
// Value +0.1, Appeal +1.5, Total +2.7. He sends Warren TE 🪙 and gets Bowers TE 🪙.
const T1 = {
  youGain: 3.8, hisGain: 1.2, hisThisWeek: -1.1, valueChange: 0.1,
  getPos: ['TE', 'WR', 'RB'], sendPos: ['TE', 'RB', 'WR'],
  myNeed: ['TE'], hisNeed: ['QB'],
  // Warren (sent) projects 2.4 under his average: a 🪙; Bowers (got) is a 🪙 too.
  getDeltas: [-2.1, 0.4, null], sendDeltas: [-2.4, 0.3, 1.1],
};
// T2 with Robert: You +3.2/wk, Him +1.9/wk; This week You +8.9, Him −0.8;
// Value −0.5, Appeal +3.4, Total +5.3.
const T2 = {
  youGain: 3.2, hisGain: 1.9, hisThisWeek: -0.8, valueChange: -0.5,
  getPos: ['RB', 'WR', 'QB'], sendPos: ['WR', 'RB', 'TE'],
  myNeed: ['RB'], hisNeed: ['TE', 'WR'],
  getDeltas: [2.3, 1.0, 0.1], sendDeltas: [-1.2, -0.2, 0],
};
{
  const a = fit.fitOf(T1);
  check(a.pass && !a.near && a.failed.length === 0, `T1 (Nolan) passes every gate (${a.failed})`);
  check(checkOf(a, 'hisWeek').ok === false, 'T1: his This week −1.1 is ✗ (a check, never a gate)');
  check(checkOf(a, 'hisGain').ok === true, 'T1: his future +1.2 is ✓');
  check(checkOf(a, 'valueUp').ok === true, 'T1: Value +0.1 ≥ 0 is ✓');
  check(checkOf(a, 'coin').ok === true, 'T1: sends Warren 🪙 (−2.4) is ✓');
  check(checkOf(a, 'diamond').ok === false, 'T1: gets Bowers 🪙, no 💎 or near: ✗');
  check(checkOf(a, 'myNeed').ok === true && checkOf(a, 'myNeed').pos.join() === 'TE', 'T1: you get a TE you need');
  check(checkOf(a, 'hisNeed').ok === false, 'T1: he needs QB and gets none: ✗');
  check(a.count === 4, `T1: 4 checks passed (${a.count})`);
  const b = fit.fitOf(T2);
  check(b.pass && !b.near, `T2 (Robert) passes every gate, Value −0.5 counts as equal (${b.failed})`);
  check(checkOf(b, 'value').ok === true && checkOf(b, 'valueUp').ok === false, 'T2: Value −0.5 passes the gate, not the 0-or-better check');
  check(checkOf(b, 'hisWeek').ok === false && checkOf(b, 'hisGain').ok === true, 'T2: his week ✗, his future ✓');
  check(checkOf(b, 'diamond').ok === true && checkOf(b, 'coin').ok === true, 'T2: 💎 +2.3 got; a near-🪙 −1.2 sent');
  check(checkOf(b, 'hisNeed').ok === true && checkOf(b, 'hisNeed').pos.join(' ') === 'WR TE', 'T2: he gets WR and TE he needs');
  check(fit.fitTag(a) === '✓ 4/7', `tag "${fit.fitTag(a)}"`);
}

// ------------------------------------------------------------------ the gates
{
  const base = { youGain: 2.5, valueChange: 0 };
  check(fit.fitOf({ ...base, youGain: 2.0 }).pass, 'You +2.0 exactly passes');
  check(!fit.fitOf({ ...base, youGain: 1.9 }).pass, 'You +1.9 fails');
  check(fit.fitOf({ ...base, youGain: 1.94 }).youGain === 1.9, 'You gain judged as printed (to the tenth)');
  check(fit.fitOf({ ...base, youGain: 1.96 }).pass, 'You +1.96 prints +2.0: passes');
  check(fit.fitOf({ ...base, valueChange: -1.0 }).pass, 'Value −1.0 passes');
  check(!fit.fitOf({ ...base, valueChange: -1.1 }).pass, 'Value −1.1 fails');
  check(fit.fitOf({ ...base, valueChange: null }).pass, 'no Values read: the Value gate is not judged');
  check(!fit.fitOf({ ...base, youGain: null }).pass, 'no You gain: fails');
  check(fit.fitOf({ ...base, youGain: 9 }).pass, 'above +4 still passes (ranked after, not hidden)');
  // Near misses: one gate, by a little.
  const n1 = fit.fitOf({ ...base, youGain: 1.4 });
  check(n1.near && n1.failed.join() === 'you', 'You +1.4: a near miss on You gain');
  check(fit.fitTag(n1) === '✗ You gain +1.4', `near tag "${fit.fitTag(n1)}"`);
  check(!fit.fitOf({ ...base, youGain: 0.9 }).near, 'You +0.9: too far, not a near miss');
  const n2 = fit.fitOf({ ...base, valueChange: -1.8 });
  check(n2.near && n2.failed.join() === 'value', 'Value −1.8: a near miss on Value');
  check(fit.fitTag(n2) === '✗ Value -1.8' || fit.fitTag(n2) === '✗ Value −1.8', `near tag "${fit.fitTag(n2)}"`);
  check(!fit.fitOf({ ...base, valueChange: -2.5 }).near, 'Value −2.5: not near');
  check(!fit.fitOf({ youGain: 1.5, valueChange: -1.5 }).near, 'two gates failed: not a near miss');
  check(!fit.fitOf({ ...base }).near, 'a pass is not a near miss');
}

// ------------------------------------------------------- checks not judged (—)
{
  const f = fit.fitOf({ youGain: 3, valueChange: null, hisThisWeek: null, hisGain: null });
  check(f.checks.every((c) => c.ok === null), 'nothing known: every check is — (null), never ✗');
  check(f.count === 0, 'nothing known: 0 passed');
  const rows = fit.checklistRows(f);
  check(rows.length === 9 && rows.filter((r) => r.value === '—').length === 8 && rows[0].value === '✓',
    `checklist rows: 2 gates + 7 checks (${rows.map((r) => r.value).join('')})`);
  const g = fit.fitOf({ youGain: 3, hisThisWeek: 0 });
  check(checkOf(g, 'hisWeek').ok === false, 'his This week exactly 0 is ✗ (not > 0)');
  check(checkOf(fit.fitOf({ youGain: 3, hisThisWeek: 0.04 }), 'hisWeek').ok === false, '+0.04 prints 0.0: ✗');
  check(checkOf(fit.fitOf({ youGain: 3, getDeltas: [1.0] }), 'diamond').ok === true, 'proj − avg +1.0 is near a 💎');
  check(checkOf(fit.fitOf({ youGain: 3, getDeltas: [0.9] }), 'diamond').ok === false, '+0.9 is not near');
  check(checkOf(fit.fitOf({ youGain: 3, sendDeltas: [-1.0] }), 'coin').ok === true, '−1.0 is near a 🪙');
  check(checkOf(fit.fitOf({ youGain: 3, myNeed: [] , getPos: ['QB'] }), 'myNeed').ok === false, 'no need at all: ✗');
}

// ------------------------------------------------------------------ the order
{
  const item = (key, f, lowers = false) => ({ key, lowers, fit: fit.fitOf(f) });
  const list = [
    item('a', { youGain: 3, hisThisWeek: 1 }),                                     // 1 check
    item('b', { youGain: 3, hisThisWeek: 2, hisGain: 1, valueChange: 0 }),         // 3 checks
    item('c', { youGain: 3, hisThisWeek: 5, hisGain: 1, valueChange: 0 }, true),   // 3, lowers goal
    item('d', { youGain: 3, hisThisWeek: 3, hisGain: 1, valueChange: 0 }),         // 3, his week 3
    item('e', { youGain: 6, hisThisWeek: 3, hisGain: 1, valueChange: 0 }),         // 3, his week 3, You > 4
    item('f', { youGain: 2.2, hisThisWeek: 3, hisGain: 1, valueChange: 0 }),       // same place as d
  ];
  const order = list.slice().sort(fit.compareFit).map((x) => x.key).join('');
  check(order === 'dfebac', `order: count, his week, You band, strict key, goal guard last (${order})`);
  check(fit.sameFitPlace(list[3], list[5]) && !fit.sameFitPlace(list[3], list[4]), 'd and f share a place; e does not');
  const shuffled = [list[5], list[1], list[4], list[0], list[3], list[2]];
  check(shuffled.sort(fit.compareFit).map((x) => x.key).join('') === order, 'the order does not depend on the input order (strict)');
  check(fit.youBand(2) === 0 && fit.youBand(4) === 0 && fit.youBand(4.1) === 1 && fit.youBand(1) === 2, 'You bands');
}

// ------------------------------------------------------------ cap per manager
{
  const rows = [1, 1, 2, 1, 2, 2, 3].map((p, i) => ({ p, i }));
  const kept = fit.capPerManager(rows, (r) => r.p);
  check(kept.map((r) => r.i).join() === '0,1,2,4,6', `at most 2 per manager, first kept (${kept.map((r) => r.i)})`);
  check(fit.capPerManager(rows, (r) => r.p, 1).length === 3, 'cap 1');
}

// ---------------------------------------------------------------------- flip
{
  const needs = [{ teamId: 1, need: ['WR'] }, { teamId: 2, need: ['QB'] }, { teamId: 3, need: ['QB'] }, { teamId: 4, need: [] }];
  const qb = { id: 77, pos: 'QB', value: 3.1, bench: true };
  const base = { youGain: -0.4, valueChange: 3.0, get: [qb, { id: 78, pos: 'WR', value: 1, bench: false }], sellerId: 2, myId: 1, needs };
  const f = fit.flipOf(base);
  check(f && f.manId === 77 && f.pos === 'QB' && f.to.join() === '3', `flip: buy the QB, Jonas (3) needs one (${JSON.stringify(f)})`);
  check(fit.flipOf({ ...base, needs: needs.filter((n) => n.teamId !== 3) }) === null, 'only the seller needs a QB: no flip');
  check(fit.flipOf({ ...base, youGain: -1.2 }) === null, 'You −1.2: too costly');
  check(fit.flipOf({ ...base, youGain: -1.0 }) !== null && fit.flipOf({ ...base, youGain: 0 }) !== null, 'You −1.0 and 0 flip');
  check(fit.flipOf({ ...base, youGain: 2.0 }) === null, 'You +2.0: an ordinary deal, not a flip');
  check(fit.flipOf({ ...base, valueChange: 1.9 }) === null && fit.flipOf({ ...base, valueChange: 4.1 }) === null, 'Value change outside +2..+4: no flip');
  check(fit.flipOf({ ...base, get: [{ ...qb, bench: false }] }) === null, 'a starter for the seller: no flip');
  check(fit.flipOf({ ...base, get: [{ ...qb, value: 4.5 }] }) === null && fit.flipOf({ ...base, get: [{ ...qb, value: 1.5 }] }) === null, 'his own Value outside 2..4: no flip');
  const a = { key: 'a', valueChange: 3, youGain: -1 };
  const b = { key: 'b', valueChange: 3.5, youGain: -1 };
  const c = { key: 'c', valueChange: 3, youGain: 0 };
  check([a, b, c].sort(fit.compareFlip).map((x) => x.key).join('') === 'bca', 'flip order: Value change, then You gain');
}

// ------------------------------------------------------------ not sent twice
{
  const DAY = 86400000;
  const now = Date.UTC(2026, 9, 31, 18);
  const sent = [
    { withTeamId: 5, get: [11, 12, 13], send: [21, 22, 23], proposedAt: now - 5 * DAY },
    { withTeamId: 6, get: [31], send: [41], proposedAt: now - 10 * DAY },
  ];
  const deal = (partnerId, getIds, sendIds) => ({ partnerId, getIds, sendIds });
  const hit = fit.sentCopyOf(deal(5, [12, 99], [23, 98]), sent, now);
  check(hit && hit.when === now - 5 * DAY, 'a man each way in common with a 5-day-old offer: a near-copy');
  check(fit.sentCopyOf(deal(5, [12], [97]), sent, now) === null, 'only one way in common: not a copy');
  check(fit.sentCopyOf(deal(6, [31], [41]), sent, now) === null, 'sent 10 days ago: not counted');
  check(fit.sentCopyOf(deal(7, [12], [23]), sent, now) === null, 'another manager: not a copy');
  check(fit.sentCopyOf(deal(5, ['12'], ['21']), [{ ...sent[0], proposedAt: null, at: now - DAY }], now) !== null, 'string ids, `at` when no proposedAt');
  check(fit.shortDate(new Date(2026, 9, 26, 12).getTime()) === 'Oct 26', 'shortDate');
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
