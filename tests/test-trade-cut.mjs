// THE FORCED CUT — who goes when a deal leaves a squad a man over the limit.
//
//   node test-trade-cut.mjs
//
// Tim, 2026-09-30: "I've found that sometimes when you send a player away, some
// weeks your projection actually increases, and if you recieve a player, some
// weeks your projection actually decreases. Neither of these outcomes should be
// possible … you can just not start the player you're recieving" — and then
// "the players are only WRs and RBs, but in the difference season by week box,
// it says my DEF avg is -0.6/week."
//
// The cause, measured on the demo league: the cut was the man with the lowest
// rest-of-season TOTAL, and that is very often the backup D/ST (or K) whose one
// job is the starter's bye week. Cut him and the lineup loses that week.
//
// The rule now: cut the man whose removal costs the after-trade lineups the
// FEWEST points over the priced weeks (each week the best lineup, assessed with
// the floors exactly as the pricing assesses it); a tie goes to the lower
// rest-of-season total, which was the whole rule before. One cut for the season.
//
// Three parts:
//   1. A hand fixture where the old rule cuts the backup D/ST and loses the
//      starter's bye week, and the new one cuts a man who never starts.
//   2. Brute force on random small rosters, with and without floors: the cut
//      chosen costs no more than any other man on the after-trade roster, and
//      among the cheapest it is the lowest rest-of-season total.
//   3. The demo league, receive-only deals, weeks 5-13: a week may drop only
//      when every man on the roster starts somewhere (no free cut existed).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './repo.mjs';

const imp = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);
const { priceTradeAcrossWeeks, findTrades, slotsForLeague } = await imp('js/trade.js');
const { optimalLineup } = await imp('js/forecast.js');
const { assessLineup, positionFloors } = await imp('js/floor.js');
const { generateDemoWeekRosters } = await imp('js/demo-rosters.js');
const { slotCountsFromLineups } = await imp('js/projection.js');

let pass = 0;
let fail = 0;
const ok = (cond, name, detail = '') => {
  if (cond) pass++;
  else { fail++; console.log(`FAIL ${name}${detail ? ` — ${String(detail).slice(0, 300)}` : ''}`); }
};
const eq = (a, b, name) => ok(JSON.stringify(a) === JSON.stringify(b), name, `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ===========================================================================
// 1. The backup D/ST, by hand
// ===========================================================================
//
// Slots QB, RB, D/ST. Weeks 1-3.
//   QB  Qb      20 20 20                    starts every week
//   RB  Rb      12 12 12                    starts every week
//   DST Def      8  0  8   (bye in week 2)  ROS 16
//   DST Backup   3  3  3                    ROS  9 — the lowest; starts week 2
//   RB  Spare    5  5  5                    ROS 15 — never starts
//   WR  Wr       4  4  4                    ROS 12 — never starts (no WR slot)
//
// Before: 40 / 35 / 40.
{
  const WEEKS = [1, 2, 3];
  const SLOTS = [0, 2, 16];
  const table = new Map();
  let id = 9000;
  const man = (name, position, weekly) => {
    const p = { playerId: id++, name, position, lineupSlotId: 20 };
    weekly.forEach((v, i) => table.set(`${p.playerId}:${WEEKS[i]}`, v));
    return p;
  };
  const projFor = (p, w) => {
    const v = table.get(`${p.playerId}:${w}`);
    return Number.isFinite(v) ? v : null;
  };
  const qb = man('Qb', 'QB', [20, 20, 20]);
  const rb = man('Rb', 'RB', [12, 12, 12]);
  const def = man('Def', 'DST', [8, 0, 8]);
  const backup = man('Backup', 'DST', [3, 3, 3]);
  const spare = man('Spare', 'RB', [5, 5, 5]);
  const wr = man('Wr', 'WR', [4, 4, 4]);
  const roster = [qb, rb, def, backup, spare, wr];

  const newRb = man('New RB', 'RB', [13, 13, 13]);
  const newQb = man('New QB', 'QB', [21, 21, 21]);

  // RECEIVE ONLY: one man in, nothing out. Old rule: Backup (ROS 9) goes and
  // week 2 falls 35 -> 33. New: the cheapest never-starter, Wr (ROS 12).
  const recv = priceTradeAcrossWeeks({ players: roster, send: [], receive: [newRb], slots: SLOTS, weeks: WEEKS, projFor });
  eq(recv.cut.map((p) => p.name), ['Wr'], 'receive-only: the cut is the never-starting Wr, not the bye-week Backup D/ST');
  eq(recv.byWeek.map((r) => r.before), [40, 35, 40], 'before, by hand: 20+12+8 / 20+12+3 / 20+12+8');
  eq(recv.byWeek.map((r) => r.after), [41, 36, 41], 'after, by hand: Rb gives way to New RB, +1 every week');
  ok(recv.byWeek.every((r) => r.delta >= 0), 'receive-only: no priced week goes down',
    recv.byWeek.map((r) => `wk${r.week} ${r.delta}`).join(', '));

  // 2-FOR-1 THE OTHER WAY (send one, receive two). Send Wr, get New QB + New RB.
  // After the move the never-starters are Qb (60), Rb (36) and Spare (15):
  // Spare goes. Old rule: Backup (9) goes, and week 2 reads 21+13+0 = 34 < 35.
  const two = priceTradeAcrossWeeks({ players: roster, send: [wr], receive: [newQb, newRb], slots: SLOTS, weeks: WEEKS, projFor });
  eq(two.cut.map((p) => p.name), ['Spare'], 'receive two, send one: Spare goes (cheapest never-starter)');
  eq(two.byWeek.map((r) => r.after), [42, 37, 42], 'after, by hand: 21+13+8 / 21+13+3 / 21+13+8');
  ok(two.byWeek.every((r) => r.delta >= 0), 'and no week falls', two.byWeek.map((r) => r.delta).join(', '));
  ok(two.roster.some((p) => p.name === 'Backup'), 'the backup D/ST survives the deal');

  // EVERY MAN STARTS SOMEWHERE — the case the cheap path cannot answer.
  // Roster: Qb, Rb, Def, Backup only, slots QB/RB/DST. Receive New RB: the
  // after roster is Qb, Rb, Def, Backup, New RB; Rb now starts nowhere, so he
  // goes (cost 0) — the received man stays.
  const tight = priceTradeAcrossWeeks({ players: [qb, rb, def, backup], send: [], receive: [newRb], slots: SLOTS, weeks: WEEKS, projFor });
  eq(tight.cut.map((p) => p.name), ['Rb'], 'tight roster: the man the new one displaces goes');

  // And a real cost: receive a second D/ST who projects 2 a week, roster Qb,
  // Rb, Def, Backup. Never-starter: New DST (2 < Backup's 3 in week 2).
  const weak = man('Weak DST', 'DST', [2, 2, 2]);
  const w2 = priceTradeAcrossWeeks({ players: [qb, rb, def, backup], send: [], receive: [weak], slots: SLOTS, weeks: WEEKS, projFor });
  eq(w2.cut.map((p) => p.name), ['Weak DST'], 'a received man who would never start is the one cut');
  ok(w2.byWeek.every((r) => r.delta === 0), 'so nothing changes in any week');

  // A received D/ST who starts only in the bye week: Better DST 1 / 6 / 1.
  //   Remove Backup: week 2 is still Better's 6 -> cost 0.
  //   Remove Better: week 2 falls back to Backup's 3 -> cost 3.
  // Backup costs 0 and goes, even though his ROS (9) is above Better's (8) —
  // the old rule cut Better.
  const better = man('Better DST', 'DST', [1, 6, 1]);
  const w3 = priceTradeAcrossWeeks({ players: [qb, rb, def, backup], send: [], receive: [better], slots: SLOTS, weeks: WEEKS, projFor });
  eq(w3.cut.map((p) => p.name), ['Backup'], 'cheapest cut wins over the lowest season total (Better DST has the lower ROS but starts week 2)');
  ok(w3.byWeek.every((r) => r.delta >= 0), 'and no week falls', w3.byWeek.map((r) => r.delta).join(', '));
}

// ===========================================================================
// 2. Brute force: the cut is the cheapest, ties to the lower season total
// ===========================================================================
let seed = 20260930;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const round1 = (x) => Math.round(x * 10) / 10;

{
  const WEEKS = [5, 6, 7, 8];
  // QB, RB, RB, WR, WR, FLEX, D/ST, K — ten-ish like a real league, small enough to brute force.
  const SLOTS = [0, 2, 2, 4, 4, 23, 16, 17];
  const POS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'DST', 'K', 'RB', 'QB', 'DST', 'K'];
  const BASE = { QB: 17, RB: 11, WR: 11, TE: 8, DST: 7, K: 8 };
  const wire = [];
  for (const [pos, top] of [['QB', 15], ['RB', 9], ['WR', 9], ['TE', 7], ['DST', 7], ['K', 8]]) {
    for (let i = 0; i < 4; i++) wire.push({ playerId: `w-${pos}-${i}`, name: `W${pos}${i}`, position: pos, projected: top - i * 0.5, injuryStatus: 'ACTIVE' });
  }
  const FLOORS = positionFloors(wire, { week: WEEKS[0] });
  ok(FLOORS.size >= 5, 'the brute-force wire makes floors', FLOORS.size);

  let id = 20000;
  const trials = 400;
  let costly = 0;   // trials where every man started somewhere (no free cut)
  let checked = 0;
  for (let t = 0; t < trials; t++) {
    const table = new Map();
    const projFor = (p, w) => { const v = table.get(`${p.playerId}:${w}`); return Number.isFinite(v) ? v : null; };
    const make = (position) => {
      const p = { playerId: id++, name: `P${id}`, position, lineupSlotId: 20 };
      const bye = rnd() < 0.35 ? pick(WEEKS) : null;
      const level = BASE[position] * (0.3 + rnd() * 1.1);
      for (const w of WEEKS) table.set(`${p.playerId}:${w}`, w === bye ? 0 : round1(level * (0.6 + rnd() * 0.8)));
      return p;
    };
    // Small rosters (9-11) so most men start somewhere and the costly path runs.
    const size = 9 + Math.floor(rnd() * 3);
    const mine = POS.slice(0, size).map(make);
    const theirs = Array.from({ length: 4 }, () => make(pick(['QB', 'RB', 'WR', 'TE', 'DST', 'K'])));
    const send = rnd() < 0.4 ? [pick(mine)] : [];
    const receive = send.length ? [theirs[0], theirs[1]] : [theirs[0]];
    const floors = t % 2 ? FLOORS : null;

    const priced = priceTradeAcrossWeeks({ players: mine, send, receive, slots: SLOTS, weeks: WEEKS, projFor, floors });
    if (priced.cut.length !== 1) { ok(false, `trial ${t}: one man over, one cut`, priced.cut.length); continue; }

    // The after-trade roster before the cut, and what each candidate costs.
    const gone = new Set(send.map((p) => p.playerId));
    const pre = mine.filter((p) => !gone.has(p.playerId)).concat(receive);
    const weekTotal = (roster, w) => {
      const pool = roster.map((p) => ({ ...p, projected: projFor(p, w) }));
      return assessLineup(optimalLineup(pool, SLOTS).starters, SLOTS, floors).total;
    };
    const base = WEEKS.map((w) => weekTotal(pre, w));
    const ros = (p) => round1(WEEKS.reduce((a, w) => a + (projFor(p, w) ?? 0), 0));
    const costs = pre.map((c) => {
      const rest = pre.filter((p) => p !== c);
      return WEEKS.reduce((a, w, i) => a + base[i] - weekTotal(rest, w), 0);
    });
    const min = Math.min(...costs);
    if (min > 1e-6) costly++;
    const chosen = pre.findIndex((p) => p.playerId === priced.cut[0].playerId);
    ok(chosen >= 0, `trial ${t}: the cut man was on the after-trade roster`);
    ok(costs[chosen] <= min + 1e-6, `trial ${t}${floors ? ' (floors)' : ''}: the cut costs no more than any other man`,
      `chose ${priced.cut[0].position} cost ${round1(costs[chosen])}, cheapest ${round1(min)} (${pre[costs.indexOf(min)].position})`);
    const cheapest = pre.filter((p, i) => costs[i] <= min + 1e-6);
    ok(ros(pre[chosen]) <= Math.min(...cheapest.map(ros)) + 0.05,
      `trial ${t}: among the cheapest, the lowest season total goes`);
    // The pricing really is priced with that cut.
    const kept = pre.filter((p, i) => i !== chosen);
    ok(Math.abs(priced.after.total - round1(WEEKS.reduce((a, w) => a + weekTotal(kept, w), 0))) <= 0.05,
      `trial ${t}: the after total is the roster without the cut man`);
    checked++;
  }
  ok(checked === trials, 'every brute-force trial checked', `${checked}/${trials}`);
  ok(costly >= 10, 'enough trials had no free cut to exercise the costed path', costly);
  console.log(`brute force: ${checked} trials, ${costly} with no free cut`);
}

// ===========================================================================
// 3. The demo league, receive-only, weeks 5-13
// ===========================================================================
{
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
  const wire = [];
  for (const [pos, top] of [['QB', 17], ['RB', 12], ['WR', 12], ['TE', 9], ['DST', 9], ['K', 9]])
    for (let i = 0; i < 5; i++) wire.push({ playerId: `wire-${pos}-${i}`, name: `W${pos}${i}`, position: pos, projected: top - i * 0.5, injuryStatus: 'ACTIVE' });
  const FLOORS = positionFloors(wire, { week: WEEKS[0] });

  for (const [label, floors] of [['no floors', null], ['floors', FLOORS]]) {
    let weeks = 0;
    let drops = 0;
    let unexplained = 0;
    let rises = 0;
    for (const me of teams) {
      for (const them of teams) {
        if (me === them) continue;
        for (const p of them.players) {
          const r = priceTradeAcrossWeeks({ players: me.players, send: [], receive: [p], slots, weeks: WEEKS, projFor, floors });
          const dropped = r.byWeek.filter((b) => b.delta < -0.05);
          weeks += r.byWeek.length;
          drops += dropped.length;
          if (dropped.length) {
            // Allowed only when no man on the after-trade roster was free to cut.
            const pre = me.players.concat([p]);
            const starts = new Set();
            WEEKS.forEach((w) => {
              const pool = pre.map((q) => ({ ...q, projected: projFor(q, w) }));
              for (const s of optimalLineup(pool, slots).starters) starts.add(s.playerId);
            });
            if (pre.some((q) => !starts.has(q.playerId))) unexplained++;
          }
        }
      }
      for (const p of me.players) {
        const r = priceTradeAcrossWeeks({ players: me.players, send: [p], receive: [], slots, weeks: WEEKS, projFor, floors });
        rises += r.byWeek.filter((b) => b.delta > 0.05).length;
      }
    }
    ok(unexplained === 0, `demo (${label}): a receive-only week drops only when no free cut existed`, `${unexplained} deals`);
    // Measured 2026-09-30: 503 (no floors) and 281 (floors) of 12,960 weeks
    // dropped under the old lowest-season-total cut; none now.
    ok(drops === 0, `demo (${label}): no receive-only week drops at all`, drops);
    ok(rises === 0, `demo (${label}): a send-only deal never raises a week`, rises);
    ok(weeks === 12960, `demo (${label}): every receive-only week priced`, weeks);
    console.log(`demo ${label}: receive-only ${drops}/${weeks} weeks drop; send-only ${rises} weeks rise`);
  }

  // The finder's own numbers agree with the pricing's (same cut both ways).
  let offers = 0;
  let agree = 0;
  for (const me of teams.slice(0, 3)) {
    const res = findTrades({ teams, myTeamId: me.id, slots, weeks: WEEKS, projFor, floors: FLOORS });
    for (const o of res.offers) {
      offers++;
      const r = priceTradeAcrossWeeks({ players: me.players, send: o.send, receive: o.receive, slots, weeks: WEEKS, projFor, floors: FLOORS });
      if (r.byWeek.every((b, i) => Math.abs(b.after - o.byWeek[i].after) <= 0.05)) agree++;
    }
  }
  ok(offers > 0 && agree === offers, 'the finder prices every offer week by week as the pricing does', `${agree}/${offers}`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
