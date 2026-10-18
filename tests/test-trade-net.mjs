// THE NETTED GAIN — his change in the week he plays you is your loss.
//
//   node test-trade-net.mjs
//
// Tim, 2026-09-30: "could you now start to add the change in opponent proj to
// the total +/- gain used to calculate the +/week for each player? This will be
// used for all trades, and when the suggested trades will also calculate these,
// finding better trades."
//
// The rule (js/trade.js `findTrades` / `bestCombo`, option `meetWeeks`):
//   net = your lineup change over the priced weeks
//         − the partner's lineup change in the priced weeks you play HIM
// (each week weighted by the goal weight when there is one). `myGain`,
// `byWeek` and `theirByWeek` stay raw — the season simulation plays both
// squads' own changes and would count his twice.
//
// Three parts:
//   1. A hand fixture: a deal worth exactly nothing to your lineup that strips
//      his only running back in the week he plays you. Not found before; found
//      now at +10, and only when that week is a meeting week.
//   2. The demo league, every squad, floors off and on, points and goal-weighted:
//      the PRUNED finder keeps exactly what an unpruned one (`exhaustive`)
//      keeps — the netting can lift a deal over its own-lineup ceiling, so this
//      is what proves the new bound is a true bound. Every offer's `netGain` is
//      `myGain` minus its own `theirByWeek` in the meeting weeks.
//   3. `bestCombo`: `netDelta` is `delta` minus each partner's change in the
//      weeks you play THAT partner, and with no meeting weeks nothing moves.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const { findTrades, priceTradeAcrossWeeks, slotsForLeague } = await imp('js/trade.js');
const { positionFloors } = await imp('js/floor.js');
const { generateDemoWeekRosters, generateDemoSchedule } = await imp('js/demo-rosters.js');
const { slotCountsFromLineups } = await imp('js/projection.js');

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 400)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
const round1 = (x) => Math.round(x * 10) / 10;

// ===========================================================================
// 1. By hand
// ===========================================================================
//
// Slots QB, RB. Weeks 1-3. You play B in week 2.
//   A (you)  QB Qa 20 20 20 · RB Ra 10 10 10 · WR Wa 5 5 5 (no WR slot: idle)
//   B        QB Qb 15 15 15 · RB Rb 12  0 12 (bye wk 2) · RB Rc 10 10 10
// Send Wa, get Rc: your RB slot is 10 either way — your lineup gains 0.
// B loses Rc, whom he starts only in week 2 (Rb's bye):
//   before 27 / 25 / 27, after 27 / 15 / 27 (no RB in week 2): −10 in week 2.
// Net to you: 0 − (−10) = +10.
{
  const WEEKS = [1, 2, 3];
  const SLOTS = [0, 2];
  const table = new Map();
  let id = 7000;
  const man = (name, position, weekly) => {
    const p = { playerId: id++, name, position, lineupSlotId: 20 };
    weekly.forEach((v, i) => table.set(`${p.playerId}:${WEEKS[i]}`, v));
    return p;
  };
  const projFor = (p, w) => {
    const v = table.get(`${p.playerId}:${w}`);
    return Number.isFinite(v) ? v : null;
  };
  const A = { id: 1, name: 'A', players: [man('Qa', 'QB', [20, 20, 20]), man('Ra', 'RB', [10, 10, 10]), man('Wa', 'WR', [5, 5, 5])] };
  const B = { id: 2, name: 'B', players: [man('Qb', 'QB', [15, 15, 15]), man('Rb', 'RB', [12, 0, 12]), man('Rc', 'RB', [10, 10, 10])] };
  const teams = [A, B];
  const base = { teams, myTeamId: 1, slots: SLOTS, weeks: WEEKS, projFor, theirMinPerWeek: -4, limit: Infinity };
  const isDeal = (o) => o.send.map((p) => p.name).join() === 'Wa' && o.receive.map((p) => p.name).join() === 'Rc';

  const plain = findTrades(base);
  ok(!plain.offers.some(isDeal), 'by hand: without meeting weeks the zero-gain deal is not found (your lineup gains nothing)',
    plain.offers.map((o) => `${o.send[0].name}>${o.receive[0].name} ${o.myGain}`).join(', '));

  const met = findTrades({ ...base, meetWeeks: (pid) => (pid === 2 ? [2] : []) });
  const deal = met.offers.find(isDeal);
  ok(!!deal, 'by hand: playing him in week 2, the deal that strips his week-2 back is found',
    met.offers.map((o) => `${o.send[0].name}>${o.receive[0].name} ${o.myGain}/${o.netGain}`).join(', '));
  if (deal) {
    eq(deal.myGain, 0, 'by hand: your lineup alone gains 0 (myGain stays raw)');
    eq(deal.theirByWeek.map((w) => w.delta), [0, -10, 0], 'by hand: his lineup, week by week: 0 / −10 / 0 (raw)');
    eq(deal.byWeek.map((w) => w.delta), [0, 0, 0], 'by hand: yours, week by week: 0 / 0 / 0 (raw)');
    eq(deal.meetWeeks, [2], 'by hand: the meeting week counted is week 2');
    eq(deal.oppChange, -10, 'by hand: his change in it is −10');
    eq(deal.netGain, 10, 'by hand: net = 0 − (−10) = +10');
    eq(deal.goalPoints, null, 'by hand: no weights, no goal points');
  }

  // A meeting week where he loses nothing: net equals your own gain, so the
  // deal is no more findable than before.
  const wk1 = findTrades({ ...base, meetWeeks: (pid) => (pid === 2 ? [1] : []) });
  ok(!wk1.offers.some(isDeal), 'by hand: meeting him only in week 1 (he loses nothing there) the deal is still not found');
  ok(wk1.offers.every((o) => o.netGain === round1(o.myGain - (o.oppChange || 0))),
    'by hand: every offer is net = myGain − oppChange');

  // A week outside the priced span is ignored.
  const out = findTrades({ ...base, meetWeeks: (pid) => (pid === 2 ? [9] : []) });
  ok(out.offers.every((o) => o.netGain === o.myGain && o.oppChange === null && o.meetWeeks.length === 0),
    'by hand: a meeting week outside the span nets nothing');

  // Goal weights: his week-2 change at week 2's weight.
  const W = [0.5, 2, 0.5];
  const wd = findTrades({ ...base, weights: W, meetWeeks: (pid) => (pid === 2 ? [2] : []) }).offers.find(isDeal);
  ok(!!wd && wd.goalPoints === 20 && wd.myGoalPoints === 0,
    'by hand, weighted: goal points = 0 − 2 × (−10) = +20 (weight of week 2), yours alone 0',
    wd && `${wd.goalPoints} / ${wd.myGoalPoints}`);

}

// ===========================================================================
// 2. The demo league: pruned == exhaustive, and net == raw − his meeting weeks
// ===========================================================================
const WEEKS = [5, 6, 7, 8, 9, 10, 11, 12, 13];
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

// Goal-shaped weights (mean ~1, a heavy late week) and a partner reach, like
// the page passes under "Win it all".
const WEIGHTS = WEEKS.map((w, i) => round1(0.4 + (i % 3) * 0.5 + (w === 13 ? 1.5 : 0)));
const REACH = WEEKS.map((w) => (w >= 12 ? 0.6 : 1));

const keyOf = (o) => `${o.partner.id}|${o.send.map((p) => p.playerId).join(',')}>${o.receive.map((p) => p.playerId).join(',')}`;
const summary = (r) => r.offers.map((o) => `${keyOf(o)}:${o.myGain}:${o.netGain}:${o.goalPoints}:${o.theirGain}`);

let meetingOffers = 0;
let checkedNet = 0;
let lifted = 0;
const times = { pruned: 0, full: 0, old: 0 };
let searches = 0;
let config = 0;
for (const [label, floors] of [['no floors', null], ['floors', FLOORS]]) {
  for (const weighted of [false, true]) {
    const tag = `${label}, ${weighted ? 'goal-weighted' : 'points'}`;
    // Each config takes two squads, rotating, so the four configs together
    // cover eight of the ten squads inside run-all's time cap (the exhaustive
    // search is the slow half: ~10 s a squad).
    const squads = [0, 1].map((k) => teams[(config * 2 + k) % teams.length]);
    config++;
    for (const me of squads) {
      searches++;
      const opts = {
        teams, myTeamId: me.id, slots, weeks: WEEKS, projFor, floors, limit: Infinity,
        meetWeeks: meetFor(me.id),
        ...(weighted ? { weights: WEIGHTS, theirMinPerWeek: -2, theirReach: () => REACH } : {}),
      };
      let t = Date.now();
      const pruned = findTrades(opts);
      times.pruned += Date.now() - t;
      t = Date.now();
      const full = findTrades({ ...opts, exhaustive: true });
      times.full += Date.now() - t;

      ok(pruned.considered === full.considered,
        `${tag} · ${me.name}: the pruned search finds as many deals as the exhaustive one`,
        `${pruned.considered} vs ${full.considered}`);
      eq(summary(pruned), summary(full), `${tag} · ${me.name}: and keeps exactly the same offers, same figures`);

      for (const o of pruned.offers) {
        const meet = meetFor(me.id)(o.partner.id).filter((w) => WEEKS.includes(w));
        const his = o.theirByWeek.filter((w) => meet.includes(w.week)).reduce((a, w) => a + w.delta, 0);
        if (meet.length) meetingOffers++;
        const want = round1(o.myGain - round1(his));
        if (o.netGain !== want || JSON.stringify(o.meetWeeks) !== JSON.stringify(meet)) {
          ok(false, `${tag} · ${me.name}: net = myGain − his theirByWeek in the meeting weeks`, `${keyOf(o)} ${o.netGain} vs ${want}`);
        } else checkedNet++;
        if (weighted) {
          const mine = o.byWeek.reduce((a, w, i) => a + WEIGHTS[i] * w.delta, 0);
          const opp = o.theirByWeek.reduce((a, w, i) => a + (meet.includes(w.week) ? WEIGHTS[i] * w.delta : 0), 0);
          // ±0.15: goalPoints is weighted on unrounded week totals, these on the printed tenths.
          if (Math.abs(o.goalPoints - (mine - opp)) > 0.15) {
            ok(false, `${tag} · ${me.name}: goal points are the weighted net`, `${keyOf(o)} ${o.goalPoints} vs ${(mine - opp).toFixed(2)}`);
          }
        }
        // Raw fields stay raw: the week-by-week sums are your lineup's own.
        if (Math.abs(o.byWeek.reduce((a, w) => a + w.delta, 0) - o.myGain) > 0.15) {
          ok(false, `${tag} · ${me.name}: byWeek still sums to myGain (raw)`, keyOf(o));
        }
      }
      lifted += pruned.offers.filter((o) => (weighted ? o.myGoalPoints : o.myGain) < 0.1 * WEEKS.length).length;
    }
  }
}
ok(checkedNet > 0 && meetingOffers > 50, 'enough offers with a meeting week to make the net checks bite', `${meetingOffers} of ${checkedNet}`);
ok(lifted > 0, 'some kept deals clear the bar only because of the netting (so the bound is exercised)', lifted);
console.log(`demo: ${checkedNet} offers checked, ${meetingOffers} with a meeting week, ${lifted} kept only by the net`);
console.log(`timing over ${searches} searches: pruned ${times.pruned} ms, exhaustive ${times.full} ms`);

// Without meeting weeks nothing changes: net == raw everywhere.
{
  const r = findTrades({ teams, myTeamId: teams[0].id, slots, weeks: WEEKS, projFor, limit: Infinity });
  ok(r.offers.length > 0 && r.offers.every((o) => o.netGain === o.myGain && o.oppChange === null),
    'no meetWeeks: every offer nets to its own gain');
}

// ===========================================================================
// 4. IR slots (2026-10-14): pruned == exhaustive still
// ===========================================================================
//
// A man sent from an IR slot frees no roster spot, so a 2-for-2 that takes two
// of his IR men leaves him TWO active men over — the netting bound must allow
// two cuts there. Every demo squad gets three men moved into IR slots (status
// IR / Out, as ESPN marks them), the league has four IR slots (one open each),
// and the pruned search must keep exactly what the exhaustive one keeps.
{
  const T = await imp('js/trade.js');
  const irTeams = teams.map((t) => {
    const bench = t.players.filter((p) => !p.started).slice(-3).map((p) => p.playerId);
    return {
      ...t,
      players: t.players.map((p) => (bench.includes(p.playerId)
        ? { ...p, lineupSlotId: 21, started: false, injuryStatus: bench.indexOf(p.playerId) === 0 ? 'OUT' : 'INJURY_RESERVE' }
        : p)),
    };
  });
  ok(irTeams.every((t) => t.players.filter((p) => p.lineupSlotId === 21).length === 3), 'IR demo: three IR-slot men a squad');
  T.setIrSlots(4);
  let irOffers = 0;
  for (const me of irTeams.slice(0, 2)) {
    const opts = { teams: irTeams, myTeamId: me.id, slots, weeks: WEEKS, projFor, floors: FLOORS, limit: Infinity, meetWeeks: meetFor(me.id) };
    const pruned = findTrades(opts);
    const full = findTrades({ ...opts, exhaustive: true });
    eq(summary(pruned), summary(full), `IR demo · ${me.name}: the pruned search keeps exactly the exhaustive one's offers`);
    irOffers += pruned.offers.filter((o) => o.send.concat(o.receive).some((p) => p.lineupSlotId === 21)).length;
  }
  T.setIrSlots(null);
  ok(irOffers > 0, 'IR demo: some kept offers move an IR-slot man (so the two-cut bound is exercised)', irOffers);
  console.log(`IR demo: ${irOffers} kept offers move an IR-slot man`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
